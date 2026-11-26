export interface WhisperSignalEnvelope {
  kind: "invite" | "answer";
  sdp: RTCSessionDescriptionInit;
  pubKeyJwk: JsonWebKey;
  displayName?: string;
}

export interface WhisperAttachment {
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
}

export interface WhisperReplyRef {
  id: string;
  senderName: string;
  excerpt: string;
}

export type WhisperPayload =
  | {
      type: "chat";
      id: string;
      text: string;
      sentAt: number;
      burnAfterSec: number;
      senderName: string;
      replyTo?: WhisperReplyRef;
      attachment?: WhisperAttachment;
    }
  | { type: "hello"; displayName: string }
  | { type: "typing"; isTyping: boolean }
  | { type: "ack"; messageId: string; status: "delivered" | "read" }
  | { type: "reaction"; messageId: string; emoji: string; reactor: "me" | "peer" }
  | { type: "delete"; messageId: string };

export type WhisperWireFrame =
  | { kind: "single"; iv: string; ct: string }
  | {
      kind: "chunk";
      transferId: string;
      iv: string;
      index: number;
      total: number;
      slice: string;
    };

const INVITE_PREFIX = "GHOST-INVITE-";
const ANSWER_PREFIX = "GHOST-ANSWER-";
const MAX_CHUNK_CHARS = 24_000;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
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

export function encodeSignalToken(envelope: WhisperSignalEnvelope): string {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(envelope));
  const prefix = envelope.kind === "invite" ? INVITE_PREFIX : ANSWER_PREFIX;
  return `${prefix}${toBase64Url(jsonBytes)}`;
}

export function decodeSignalToken(
  token: string,
  expectedKind: "invite" | "answer"
): WhisperSignalEnvelope {
  const trimmed = token.trim();
  const expectedPrefix =
    expectedKind === "invite" ? INVITE_PREFIX : ANSWER_PREFIX;

  if (!trimmed.startsWith(expectedPrefix)) {
    throw new Error(
      `Invalid token. Expected a ${expectedPrefix}... token from your peer.`
    );
  }

  const encoded = trimmed.slice(expectedPrefix.length);
  const bytes = fromBase64Url(encoded);
  const parsed = JSON.parse(
    new TextDecoder().decode(bytes)
  ) as WhisperSignalEnvelope;

  if (parsed.kind !== expectedKind || !parsed.sdp || !parsed.pubKeyJwk) {
    throw new Error("Malformed WebRTC / ECDH handshake token.");
  }

  return parsed;
}

export async function generateEphemeralEcdh(): Promise<{
  keyPair: CryptoKeyPair;
  publicJwk: JsonWebKey;
}> {
  if (!globalThis.crypto?.subtle) {
    throw new Error(
      "Web Crypto API requires HTTPS or localhost for ECDH key exchange."
    );
  }
  const keyPair = await globalThis.crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveKey"]
  );
  const publicJwk = await globalThis.crypto.subtle.exportKey(
    "jwk",
    keyPair.publicKey
  );
  return { keyPair, publicJwk };
}

export async function deriveWhisperSessionKey(
  ownPrivateKey: CryptoKey,
  peerPublicJwk: JsonWebKey
): Promise<CryptoKey> {
  const peerPublicKey = await globalThis.crypto.subtle.importKey(
    "jwk",
    peerPublicJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  return globalThis.crypto.subtle.deriveKey(
    { name: "ECDH", public: peerPublicKey },
    ownPrivateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function computeSafetyFingerprint(
  localJwk: JsonWebKey,
  remoteJwk: JsonWebKey
): Promise<string> {
  const pair = [
    `${localJwk.x ?? ""}:${localJwk.y ?? ""}`,
    `${remoteJwk.x ?? ""}:${remoteJwk.y ?? ""}`,
  ].sort();
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    toArrayBuffer(new TextEncoder().encode(pair.join("|")))
  );
  const bytes = new Uint8Array(digest);
  return Array.from(bytes.slice(0, 6))
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join("-");
}

export async function encryptWhisperFrames(
  sessionKey: CryptoKey,
  payload: WhisperPayload
): Promise<WhisperWireFrame[]> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    sessionKey,
    toArrayBuffer(encoded)
  );

  const ivB64 = toBase64Url(iv);
  const ctB64 = toBase64Url(new Uint8Array(encrypted));

  if (ctB64.length <= MAX_CHUNK_CHARS) {
    return [{ kind: "single", iv: ivB64, ct: ctB64 }];
  }

  const total = Math.ceil(ctB64.length / MAX_CHUNK_CHARS);
  const transferId = crypto.randomUUID();
  const frames: WhisperWireFrame[] = [];

  for (let i = 0; i < total; i++) {
    frames.push({
      kind: "chunk",
      transferId,
      iv: ivB64,
      index: i,
      total,
      slice: ctB64.slice(i * MAX_CHUNK_CHARS, (i + 1) * MAX_CHUNK_CHARS),
    });
  }

  return frames;
}

export async function decryptWhisperCiphertext(
  sessionKey: CryptoKey,
  ivB64: string,
  ctB64: string
): Promise<WhisperPayload> {
  const iv = fromBase64Url(ivB64);
  const ct = fromBase64Url(ctB64);
  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    sessionKey,
    toArrayBuffer(ct)
  );
  const json = new TextDecoder("utf-8", { fatal: true }).decode(decrypted);
  return JSON.parse(json) as WhisperPayload;
}

export function waitForIceGathering(
  pc: RTCPeerConnection,
  timeoutMs = 2500
): Promise<void> {
  if (pc.iceGatheringState === "complete") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    }, timeoutMs);

    function onStateChange() {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timer);
        pc.removeEventListener("icegatheringstatechange", onStateChange);
        resolve();
      }
    }

    pc.addEventListener("icegatheringstatechange", onStateChange);
  });
}

export function playSoftWhisperChime(): void {
  if (typeof window === "undefined") return;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) return;

  try {
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    osc.onended = () => {
      void ctx.close();
    };
  } catch {
    // Ignore autoplay restriction errors
  }
}
