import {
  buildPayloadFrame,
  CipherAlgorithm,
  StegoError,
  StegoVersion,
  unpackPayloadFrame,
} from "./crypto";

export interface SplitSecretResult {
  shards: string[];
  threshold: number;
  totalShares: number;
  framedBytes: number;
  version: StegoVersion;
  algorithm: "none" | CipherAlgorithm;
  expiresAt: number | null;
}

export interface ParsedShard {
  raw: string;
  threshold: number;
  index: number;
  data: Uint8Array;
}

export interface ReconstructResult {
  secret: string;
  threshold: number;
  usedShards: number;
  version: StegoVersion;
  algorithm: "none" | CipherAlgorithm;
  expiresAt: number | null;
}

const SHARD_PREFIX = "gi1";

// GF(2^8) multiplication modulo AES irreducible polynomial x^8 + x^4 + x^3 + x + 1 (0x11B)
function gfMul(a: number, b: number): number {
  let res = 0;
  let aa = a;
  let bb = b;
  for (let i = 0; i < 8; i++) {
    if (bb & 1) res ^= aa;
    const hiBit = aa & 0x80;
    aa = (aa << 1) & 0xff;
    if (hiBit) aa ^= 0x1b;
    bb >>= 1;
  }
  return res;
}

function gfPow(base: number, exp: number): number {
  let res = 1;
  let b = base;
  let e = exp;
  while (e > 0) {
    if (e & 1) res = gfMul(res, b);
    b = gfMul(b, b);
    e >>= 1;
  }
  return res;
}

function gfInv(a: number): number {
  if (a === 0) {
    throw new StegoError("CORRUPTED_PAYLOAD", "Division by zero in GF(256).");
  }
  return gfPow(a, 254);
}

function gfDiv(a: number, b: number): number {
  return gfMul(a, gfInv(b));
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const mod = padded.length % 4;
  const normalized = mod ? padded + "=".repeat(4 - mod) : padded;
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function splitBytesShamir(
  secretBytes: Uint8Array,
  threshold: number,
  totalShares: number
): Uint8Array[] {
  if (threshold < 2 || totalShares < threshold || totalShares > 255) {
    throw new StegoError(
      "UNSUPPORTED_ENV",
      "Threshold must be at least 2 and at most total shares (max 255)."
    );
  }

  if (typeof globalThis.crypto === "undefined" || !globalThis.crypto.getRandomValues) {
    throw new StegoError(
      "UNSUPPORTED_ENV",
      "Secure random number generator unavailable."
    );
  }

  const len = secretBytes.byteLength;
  const shares = Array.from({ length: totalShares }, () => new Uint8Array(len));
  const randomCoeffs = new Uint8Array((threshold - 1) * len);
  globalThis.crypto.getRandomValues(randomCoeffs);

  for (let byteIdx = 0; byteIdx < len; byteIdx++) {
    const coeffOffset = byteIdx * (threshold - 1);

    for (let shareIdx = 0; shareIdx < totalShares; shareIdx++) {
      const x = shareIdx + 1;
      // Evaluate f(x) = secret + c1*x + c2*x^2 + ... using Horner's method
      let y = 0;
      for (let deg = threshold - 2; deg >= 0; deg--) {
        y = gfMul(y, x) ^ randomCoeffs[coeffOffset + deg];
      }
      y = gfMul(y, x) ^ secretBytes[byteIdx];
      shares[shareIdx][byteIdx] = y;
    }
  }

  return shares;
}

export function combineBytesShamir(parsedShards: ParsedShard[]): Uint8Array {
  if (parsedShards.length < 2) {
    throw new StegoError(
      "CORRUPTED_PAYLOAD",
      "At least 2 shards are required to reconstruct a secret."
    );
  }

  const threshold = parsedShards[0].threshold;
  const byteLength = parsedShards[0].data.byteLength;

  if (parsedShards.length < threshold) {
    throw new StegoError(
      "CORRUPTED_PAYLOAD",
      `Need at least ${threshold} shards (currently provided ${parsedShards.length}).`
    );
  }

  const seenIndices = new Set<number>();
  const subset: ParsedShard[] = [];

  for (const shard of parsedShards) {
    if (shard.threshold !== threshold || shard.data.byteLength !== byteLength) {
      throw new StegoError(
        "CORRUPTED_PAYLOAD",
        "Shards do not belong to the same split session (mismatched threshold or length)."
      );
    }
    if (!seenIndices.has(shard.index)) {
      seenIndices.add(shard.index);
      subset.push(shard);
    }
    if (subset.length === threshold) break;
  }

  if (subset.length < threshold) {
    throw new StegoError(
      "CORRUPTED_PAYLOAD",
      `Duplicate shards detected. Need ${threshold} distinct shards.`
    );
  }

  const out = new Uint8Array(byteLength);

  // Precompute Lagrange basis coefficients l_i(0) = prod_{j != i} x_j / (x_i ^ x_j)
  const lagrangeAtZero = subset.map((si, i) => {
    let num = 1;
    let den = 1;
    for (let j = 0; j < subset.length; j++) {
      if (i === j) continue;
      const xj = subset[j].index;
      num = gfMul(num, xj);
      den = gfMul(den, si.index ^ xj);
    }
    return gfDiv(num, den);
  });

  for (let byteIdx = 0; byteIdx < byteLength; byteIdx++) {
    let acc = 0;
    for (let i = 0; i < subset.length; i++) {
      acc ^= gfMul(subset[i].data[byteIdx], lagrangeAtZero[i]);
    }
    out[byteIdx] = acc;
  }

  return out;
}

export function parseShardToken(raw: string): ParsedShard {
  const trimmed = raw.trim();
  const parts = trimmed.split(".");
  if (parts.length !== 4 || parts[0] !== SHARD_PREFIX) {
    throw new StegoError(
      "CORRUPTED_PAYLOAD",
      "Invalid shard format. Expected gi1.<threshold>.<index>.<payload>."
    );
  }

  const threshold = Number.parseInt(parts[1], 10);
  const index = Number.parseInt(parts[2], 10);

  if (
    !Number.isInteger(threshold) ||
    threshold < 2 ||
    !Number.isInteger(index) ||
    index < 1 ||
    index > 255
  ) {
    throw new StegoError("CORRUPTED_PAYLOAD", "Invalid shard index or threshold.");
  }

  try {
    const data = fromBase64Url(parts[3]);
    if (!data.byteLength) {
      throw new Error("Empty shard");
    }
    return { raw: trimmed, threshold, index, data };
  } catch {
    throw new StegoError("CORRUPTED_PAYLOAD", "Corrupted base64url shard payload.");
  }
}

export function parseShardList(input: string): {
  valid: ParsedShard[];
  invalidLines: number;
} {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const valid: ParsedShard[] = [];
  let invalidLines = 0;

  for (const line of lines) {
    try {
      valid.push(parseShardToken(line));
    } catch {
      invalidLines += 1;
    }
  }

  return { valid, invalidLines };
}

export async function splitSecretIntoShards(options: {
  secret: string;
  passphrase: string;
  noPassword: boolean;
  threshold: number;
  totalShares: number;
  ttlSeconds?: number;
  algorithm?: CipherAlgorithm;
}): Promise<SplitSecretResult> {
  const { frame, version, algorithm, expiresAt } = await buildPayloadFrame(
    options.secret,
    options.passphrase,
    options.noPassword,
    options.ttlSeconds ?? 0,
    options.algorithm ?? "aes-gcm"
  );

  const rawShards = splitBytesShamir(
    frame,
    options.threshold,
    options.totalShares
  );

  const shards = rawShards.map(
    (bytes, idx) =>
      `${SHARD_PREFIX}.${options.threshold}.${idx + 1}.${toBase64Url(bytes)}`
  );

  return {
    shards,
    threshold: options.threshold,
    totalShares: options.totalShares,
    framedBytes: frame.byteLength,
    version,
    algorithm,
    expiresAt,
  };
}

export async function reconstructSecretFromShards(options: {
  shardTokens: string[];
  passphrase: string;
}): Promise<ReconstructResult> {
  if (!options.shardTokens.length) {
    throw new StegoError("NO_PAYLOAD", "Paste at least 2 shards to reconstruct.");
  }

  const parsed = options.shardTokens.map(parseShardToken);
  const frame = combineBytesShamir(parsed);
  const { plaintext, version, algorithm, expiresAt } = await unpackPayloadFrame(
    frame,
    options.passphrase
  );

  return {
    secret: plaintext,
    threshold: parsed[0].threshold,
    usedShards: parsed[0].threshold,
    version,
    algorithm,
    expiresAt,
  };
}
