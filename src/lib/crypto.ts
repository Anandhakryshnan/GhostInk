export const VERSION_UNENCRYPTED = 0x00;
export const VERSION_ENCRYPTED = 0x01;
export const VERSION_ENCRYPTED_TTL = 0x02;
export const VERSION_UNENCRYPTED_TTL = 0x03;
export const VERSION_CTR_HMAC = 0x04;
export const VERSION_CTR_HMAC_TTL = 0x05;

export type StegoVersion =
  | typeof VERSION_UNENCRYPTED
  | typeof VERSION_ENCRYPTED
  | typeof VERSION_ENCRYPTED_TTL
  | typeof VERSION_UNENCRYPTED_TTL
  | typeof VERSION_CTR_HMAC
  | typeof VERSION_CTR_HMAC_TTL;

export type CipherAlgorithm = "aes-gcm" | "aes-ctr-hmac";

export const CIPHER_ALGORITHMS: ReadonlyArray<{
  id: CipherAlgorithm;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    id: "aes-gcm",
    label: "AES-256-GCM",
    shortLabel: "AES-GCM",
    description: "Single-pass AEAD • Compact 44B overhead",
  },
  {
    id: "aes-ctr-hmac",
    label: "AES-256-CTR + HMAC-SHA256",
    shortLabel: "CTR + HMAC",
    description: "Encrypt-then-MAC • 512-bit PBKDF2 key split",
  },
];

export const SALT_LENGTH = 16;
export const IV_LENGTH = 12;
export const GCM_TAG_LENGTH = 16;
export const CTR_NONCE_LENGTH = 16;
export const HMAC_TAG_LENGTH = 32;
export const TTL_HEADER_LENGTH = 8;
export const PBKDF2_ITERATIONS = 250_000;

export type TtlPreset = "none" | "10m" | "1h" | "24h" | "7d";

export const TTL_PRESETS: ReadonlyArray<{
  id: TtlPreset;
  label: string;
  seconds: number;
}> = [
  { id: "none", label: "Never", seconds: 0 },
  { id: "10m", label: "10m", seconds: 10 * 60 },
  { id: "1h", label: "1h", seconds: 60 * 60 },
  { id: "24h", label: "24h", seconds: 24 * 60 * 60 },
  { id: "7d", label: "7d", seconds: 7 * 24 * 60 * 60 },
];

export type StegoErrorCode =
  | "UNSUPPORTED_ENV"
  | "EMPTY_SECRET"
  | "MISSING_PASSPHRASE"
  | "NO_PAYLOAD"
  | "CORRUPTED_PAYLOAD"
  | "UNSUPPORTED_VERSION"
  | "DECRYPT_FAILED"
  | "PAYLOAD_EXPIRED";

export class StegoError extends Error {
  readonly code: StegoErrorCode;
  readonly expiredAt?: number;

  constructor(code: StegoErrorCode, message: string, expiredAt?: number) {
    super(message);
    this.name = "StegoError";
    this.code = code;
    this.expiredAt = expiredAt;
  }
}

export interface EncryptFrameResult {
  frame: Uint8Array;
  originalBytes: number;
  compressedBytes: number;
  version: StegoVersion;
  algorithm: "none" | CipherAlgorithm;
  expiresAt: number | null;
}

export interface DecryptFrameResult {
  plaintext: string;
  version: StegoVersion;
  algorithm: "none" | CipherAlgorithm;
  compressedBytes: number;
  originalBytes: number;
  expiresAt: number | null;
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: "Empty" | "Weak" | "Fair" | "Strong" | "Fortress";
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function encodeTtlPrefix(expiresAtMs: number): Uint8Array {
  const buf = new Uint8Array(TTL_HEADER_LENGTH);
  const view = new DataView(buf.buffer);
  const high = Math.floor(expiresAtMs / 0x100000000);
  const low = expiresAtMs >>> 0;
  view.setUint32(0, high, false);
  view.setUint32(4, low, false);
  return buf;
}

function decodeTtlPrefix(bytes: Uint8Array): {
  expiresAtMs: number;
  secretBytes: Uint8Array;
} {
  if (bytes.byteLength < TTL_HEADER_LENGTH) {
    throw new StegoError(
      "CORRUPTED_PAYLOAD",
      "Payload expiration header is incomplete or corrupted."
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, TTL_HEADER_LENGTH);
  const high = view.getUint32(0, false);
  const low = view.getUint32(4, false);
  const expiresAtMs = high * 0x100000000 + low;
  return {
    expiresAtMs,
    secretBytes: bytes.slice(TTL_HEADER_LENGTH),
  };
}

export function assertCryptoCapabilities(requireSubtle: boolean): void {
  if (
    typeof CompressionStream === "undefined" ||
    typeof DecompressionStream === "undefined"
  ) {
    throw new StegoError(
      "UNSUPPORTED_ENV",
      "Compression Streams API is not supported in this browser."
    );
  }

  if (
    requireSubtle &&
    (typeof globalThis.crypto === "undefined" || !globalThis.crypto.subtle)
  ) {
    throw new StegoError(
      "UNSUPPORTED_ENV",
      "Web Crypto API (crypto.subtle) requires a secure HTTPS or localhost context."
    );
  }
}

export async function compressDeflateRaw(data: Uint8Array): Promise<Uint8Array> {
  assertCryptoCapabilities(false);
  const stream = new Blob([toArrayBuffer(data)])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

export async function decompressDeflateRaw(data: Uint8Array): Promise<Uint8Array> {
  assertCryptoCapabilities(false);
  try {
    const stream = new Blob([toArrayBuffer(data)])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    throw new StegoError(
      "CORRUPTED_PAYLOAD",
      "Payload was corrupted or stripped by a messaging platform."
    );
  }
}

async function deriveAesGcmKey(
  passphrase: string,
  salt: Uint8Array,
  usage: KeyUsage
): Promise<CryptoKey> {
  assertCryptoCapabilities(true);
  const encoder = new TextEncoder();
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    "raw",
    toArrayBuffer(encoder.encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return globalThis.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    [usage]
  );
}

async function deriveCtrHmacKeys(
  passphrase: string,
  salt: Uint8Array,
  encUsage: KeyUsage,
  macUsage: KeyUsage
): Promise<{ encKey: CryptoKey; macKey: CryptoKey }> {
  assertCryptoCapabilities(true);
  const encoder = new TextEncoder();
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    "raw",
    toArrayBuffer(encoder.encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await globalThis.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    512
  );

  const derivedBytes = new Uint8Array(derivedBits);
  const [encKey, macKey] = await Promise.all([
    globalThis.crypto.subtle.importKey(
      "raw",
      toArrayBuffer(derivedBytes.slice(0, 32)),
      { name: "AES-CTR" },
      false,
      [encUsage]
    ),
    globalThis.crypto.subtle.importKey(
      "raw",
      toArrayBuffer(derivedBytes.slice(32, 64)),
      { name: "HMAC", hash: "SHA-256" },
      false,
      [macUsage]
    ),
  ]);

  return { encKey, macKey };
}

/**
 * Compresses the UTF-8 secret (with optional authenticated 8-byte TTL timestamp)
 * using deflate-raw and frames it as:
 * - 0x00 / 0x03: [1B Version][Compressed Plaintext]
 * - 0x01 / 0x02: [1B Version][16B Salt][12B IV][AES-256-GCM Ciphertext + 16B Tag]
 * - 0x04 / 0x05: [1B Version][16B Salt][16B Counter][AES-256-CTR Ciphertext][32B HMAC-SHA256 Tag]
 */
export async function buildPayloadFrame(
  secret: string,
  passphrase: string,
  noPassword: boolean,
  ttlSeconds = 0,
  algorithm: CipherAlgorithm = "aes-gcm"
): Promise<EncryptFrameResult> {
  if (!secret.length) {
    throw new StegoError("EMPTY_SECRET", "Secret message cannot be empty.");
  }

  const rawSecretBytes = new TextEncoder().encode(secret);
  const hasTtl = ttlSeconds > 0;
  const expiresAt = hasTtl ? Date.now() + ttlSeconds * 1000 : null;

  let innerPlaintext = rawSecretBytes;
  if (expiresAt !== null) {
    const ttlPrefix = encodeTtlPrefix(expiresAt);
    innerPlaintext = new Uint8Array(
      ttlPrefix.byteLength + rawSecretBytes.byteLength
    );
    innerPlaintext.set(ttlPrefix, 0);
    innerPlaintext.set(rawSecretBytes, ttlPrefix.byteLength);
  }

  const compressed = await compressDeflateRaw(innerPlaintext);

  if (noPassword) {
    const version = hasTtl ? VERSION_UNENCRYPTED_TTL : VERSION_UNENCRYPTED;
    const frame = new Uint8Array(1 + compressed.byteLength);
    frame[0] = version;
    frame.set(compressed, 1);

    return {
      frame,
      originalBytes: rawSecretBytes.byteLength,
      compressedBytes: compressed.byteLength,
      version,
      algorithm: "none",
      expiresAt,
    };
  }

  if (!passphrase.length) {
    throw new StegoError(
      "MISSING_PASSPHRASE",
      "Enter a passphrase or enable Quick Hide (No Password)."
    );
  }

  assertCryptoCapabilities(true);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

  if (algorithm === "aes-ctr-hmac") {
    const version = hasTtl ? VERSION_CTR_HMAC_TTL : VERSION_CTR_HMAC;
    const counter = globalThis.crypto.getRandomValues(
      new Uint8Array(CTR_NONCE_LENGTH)
    );
    const { encKey, macKey } = await deriveCtrHmacKeys(
      passphrase,
      salt,
      "encrypt",
      "sign"
    );

    const encryptedBuffer = await globalThis.crypto.subtle.encrypt(
      { name: "AES-CTR", counter: toArrayBuffer(counter), length: 64 },
      encKey,
      toArrayBuffer(compressed)
    );
    const ciphertext = new Uint8Array(encryptedBuffer);

    const macInputLength = 1 + SALT_LENGTH + CTR_NONCE_LENGTH + ciphertext.byteLength;
    const frame = new Uint8Array(macInputLength + HMAC_TAG_LENGTH);
    frame[0] = version;
    frame.set(salt, 1);
    frame.set(counter, 1 + SALT_LENGTH);
    frame.set(ciphertext, 1 + SALT_LENGTH + CTR_NONCE_LENGTH);

    const macBuffer = await globalThis.crypto.subtle.sign(
      "HMAC",
      macKey,
      toArrayBuffer(frame.subarray(0, macInputLength))
    );
    frame.set(new Uint8Array(macBuffer), macInputLength);

    return {
      frame,
      originalBytes: rawSecretBytes.byteLength,
      compressedBytes: compressed.byteLength,
      version,
      algorithm: "aes-ctr-hmac",
      expiresAt,
    };
  }

  const version = hasTtl ? VERSION_ENCRYPTED_TTL : VERSION_ENCRYPTED;
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveAesGcmKey(passphrase, salt, "encrypt");

  const encryptedBuffer = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(compressed)
  );
  const ciphertext = new Uint8Array(encryptedBuffer);

  const frame = new Uint8Array(
    1 + SALT_LENGTH + IV_LENGTH + ciphertext.byteLength
  );
  frame[0] = version;
  frame.set(salt, 1);
  frame.set(iv, 1 + SALT_LENGTH);
  frame.set(ciphertext, 1 + SALT_LENGTH + IV_LENGTH);

  return {
    frame,
    originalBytes: rawSecretBytes.byteLength,
    compressedBytes: compressed.byteLength,
    version,
    algorithm: "aes-gcm",
    expiresAt,
  };
}

function finalizeDecompressedPayload(
  decompressed: Uint8Array,
  hasTtl: boolean
): { plaintext: string; originalBytes: number; expiresAt: number | null } {
  let payloadBytes = decompressed;
  let expiresAt: number | null = null;

  if (hasTtl) {
    const parsed = decodeTtlPrefix(decompressed);
    expiresAt = parsed.expiresAtMs;
    payloadBytes = parsed.secretBytes;

    if (Date.now() > expiresAt) {
      const formatted = new Date(expiresAt).toLocaleString();
      throw new StegoError(
        "PAYLOAD_EXPIRED",
        `This self-destructing payload expired on ${formatted}.`,
        expiresAt
      );
    }
  }

  try {
    const plaintext = new TextDecoder("utf-8", { fatal: true }).decode(
      payloadBytes
    );
    return {
      plaintext,
      originalBytes: payloadBytes.byteLength,
      expiresAt,
    };
  } catch {
    throw new StegoError(
      "CORRUPTED_PAYLOAD",
      "Decoded stream is not valid UTF-8 text."
    );
  }
}

/**
 * Unpacks a framed binary payload, verifies/decrypts (AES-GCM or AES-CTR+HMAC),
 * decompresses, and enforces authenticated TTL expiration if present.
 */
export async function unpackPayloadFrame(
  frame: Uint8Array,
  passphrase: string
): Promise<DecryptFrameResult> {
  if (frame.byteLength < 2) {
    throw new StegoError(
      "CORRUPTED_PAYLOAD",
      "Payload header is incomplete or was truncated by a messaging platform."
    );
  }

  const version = frame[0];

  if (version === VERSION_UNENCRYPTED || version === VERSION_UNENCRYPTED_TTL) {
    const hasTtl = version === VERSION_UNENCRYPTED_TTL;
    const compressed = frame.slice(1);
    const decompressed = await decompressDeflateRaw(compressed);
    const { plaintext, originalBytes, expiresAt } = finalizeDecompressedPayload(
      decompressed,
      hasTtl
    );

    return {
      plaintext,
      version,
      algorithm: "none",
      compressedBytes: compressed.byteLength,
      originalBytes,
      expiresAt,
    };
  }

  if (version === VERSION_ENCRYPTED || version === VERSION_ENCRYPTED_TTL) {
    const hasTtl = version === VERSION_ENCRYPTED_TTL;
    const minEncryptedLength = 1 + SALT_LENGTH + IV_LENGTH + GCM_TAG_LENGTH;
    if (frame.byteLength < minEncryptedLength) {
      throw new StegoError(
        "CORRUPTED_PAYLOAD",
        "Encrypted payload is incomplete or was corrupted/stripped by a messaging platform."
      );
    }

    if (!passphrase.length) {
      throw new StegoError(
        "MISSING_PASSPHRASE",
        "This payload is AES-256-GCM encrypted. Enter the passphrase to decrypt."
      );
    }

    const salt = frame.slice(1, 1 + SALT_LENGTH);
    const iv = frame.slice(1 + SALT_LENGTH, 1 + SALT_LENGTH + IV_LENGTH);
    const ciphertext = frame.slice(1 + SALT_LENGTH + IV_LENGTH);

    const key = await deriveAesGcmKey(passphrase, salt, "decrypt");

    let decryptedBuffer: ArrayBuffer;
    try {
      decryptedBuffer = await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: toArrayBuffer(iv) },
        key,
        toArrayBuffer(ciphertext)
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "OperationError") {
        throw new StegoError(
          "DECRYPT_FAILED",
          "Incorrect passphrase or payload was corrupted/stripped by a messaging platform."
        );
      }
      throw error;
    }

    const compressed = new Uint8Array(decryptedBuffer);
    const decompressed = await decompressDeflateRaw(compressed);
    const { plaintext, originalBytes, expiresAt } = finalizeDecompressedPayload(
      decompressed,
      hasTtl
    );

    return {
      plaintext,
      version,
      algorithm: "aes-gcm",
      compressedBytes: compressed.byteLength,
      originalBytes,
      expiresAt,
    };
  }

  if (version === VERSION_CTR_HMAC || version === VERSION_CTR_HMAC_TTL) {
    const hasTtl = version === VERSION_CTR_HMAC_TTL;
    const minLength = 1 + SALT_LENGTH + CTR_NONCE_LENGTH + 1 + HMAC_TAG_LENGTH;
    if (frame.byteLength < minLength) {
      throw new StegoError(
        "CORRUPTED_PAYLOAD",
        "Encrypted payload is incomplete or was corrupted/stripped by a messaging platform."
      );
    }

    if (!passphrase.length) {
      throw new StegoError(
        "MISSING_PASSPHRASE",
        "This payload is AES-256-CTR + HMAC-SHA256 encrypted. Enter the passphrase to decrypt."
      );
    }

    const salt = frame.slice(1, 1 + SALT_LENGTH);
    const counter = frame.slice(
      1 + SALT_LENGTH,
      1 + SALT_LENGTH + CTR_NONCE_LENGTH
    );
    const macSplit = frame.byteLength - HMAC_TAG_LENGTH;
    const ciphertext = frame.slice(1 + SALT_LENGTH + CTR_NONCE_LENGTH, macSplit);
    const tag = frame.slice(macSplit);
    const macTarget = frame.slice(0, macSplit);

    const { encKey, macKey } = await deriveCtrHmacKeys(
      passphrase,
      salt,
      "decrypt",
      "verify"
    );

    const isAuthentic = await globalThis.crypto.subtle.verify(
      "HMAC",
      macKey,
      toArrayBuffer(tag),
      toArrayBuffer(macTarget)
    );

    if (!isAuthentic) {
      throw new StegoError(
        "DECRYPT_FAILED",
        "Incorrect passphrase or payload was corrupted/stripped by a messaging platform."
      );
    }

    const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
      { name: "AES-CTR", counter: toArrayBuffer(counter), length: 64 },
      encKey,
      toArrayBuffer(ciphertext)
    );

    const compressed = new Uint8Array(decryptedBuffer);
    const decompressed = await decompressDeflateRaw(compressed);
    const { plaintext, originalBytes, expiresAt } = finalizeDecompressedPayload(
      decompressed,
      hasTtl
    );

    return {
      plaintext,
      version,
      algorithm: "aes-ctr-hmac",
      compressedBytes: compressed.byteLength,
      originalBytes,
      expiresAt,
    };
  }

  throw new StegoError(
    "UNSUPPORTED_VERSION",
    `Unsupported payload version byte (0x${version.toString(16).padStart(2, "0")}). Payload may be corrupted.`
  );
}

export function evaluatePasswordStrength(passphrase: string): PasswordStrength {
  if (!passphrase.length) {
    return { score: 0, label: "Empty" };
  }

  let points = 0;
  if (passphrase.length >= 8) points += 1;
  if (passphrase.length >= 12) points += 1;
  if (passphrase.length >= 18) points += 1;
  if (/[a-z]/.test(passphrase) && /[A-Z]/.test(passphrase)) points += 1;
  if (/\d/.test(passphrase)) points += 1;
  if (/[^a-zA-Z0-9]/.test(passphrase)) points += 1;

  if (passphrase.length < 6 || points <= 2) return { score: 1, label: "Weak" };
  if (points === 3) return { score: 2, label: "Fair" };
  if (points === 4 || points === 5) return { score: 3, label: "Strong" };
  return { score: 4, label: "Fortress" };
}
