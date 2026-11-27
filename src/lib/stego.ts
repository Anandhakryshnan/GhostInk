import {
  buildPayloadFrame,
  CipherAlgorithm,
  StegoError,
  StegoVersion,
  unpackPayloadFrame,
  VERSION_CTR_HMAC,
  VERSION_CTR_HMAC_TTL,
  VERSION_ENCRYPTED,
  VERSION_ENCRYPTED_TTL,
  VERSION_UNENCRYPTED,
  VERSION_UNENCRYPTED_TTL,
} from "./crypto";

export const ZERO_WIDTH_CHARS = {
  ZWSP: "\u200B", // 00
  ZWNJ: "\u200C", // 01
  ZWJ: "\u200D", // 10
  WJ: "\u2060", // 11
} as const;

export const BITS_TO_ZW: readonly [string, string, string, string] = [
  ZERO_WIDTH_CHARS.ZWSP, // 00
  ZERO_WIDTH_CHARS.ZWNJ, // 01
  ZERO_WIDTH_CHARS.ZWJ, // 10
  ZERO_WIDTH_CHARS.WJ, // 11
];

export const ZW_TO_BITS: Readonly<Record<string, number>> = {
  [ZERO_WIDTH_CHARS.ZWSP]: 0,
  [ZERO_WIDTH_CHARS.ZWNJ]: 1,
  [ZERO_WIDTH_CHARS.ZWJ]: 2,
  [ZERO_WIDTH_CHARS.WJ]: 3,
};

export const CARRIER_EMOJIS = [
  "👻",
  "🔐",
  "🫥",
  "✨",
  "🎭",
  "🫧",
  "🚀",
  "👀",
] as const;

export type StegoEncoding = "zero-width" | "emoji-vs";

const ZW_REGEX = /[\u200B\u200C\u200D\u2060]/g;
const ZW_RUN_REGEX = /[\u200B\u200C\u200D\u2060]{2,}/g;
const VS_REGEX = /[\uFE00-\uFE0F]/g;
const ALL_HIDDEN_REGEX = /[\u200B\u200C\u200D\u2060\uFE00-\uFE0F]/g;

const VS_BASE_CODE = 0xfe00;

export interface HideResult {
  stegoText: string;
  encoding: StegoEncoding;
  originalBytes: number;
  compressedBytes: number;
  framedBytes: number;
  hiddenCharCount: number;
  version: StegoVersion;
  algorithm: "none" | CipherAlgorithm;
  expiresAt: number | null;
}

export interface RevealResult {
  secret: string;
  encoding: StegoEncoding;
  version: StegoVersion;
  algorithm: "none" | CipherAlgorithm;
  hiddenCharCount: number;
  framedBytes: number;
  compressedBytes: number;
  originalBytes: number;
  expiresAt: number | null;
}

export interface PayloadDetection {
  hasPayload: boolean;
  encoding: StegoEncoding | null;
  hiddenCharCount: number;
  isAligned: boolean;
  rawBytes: number;
  versionByte: number | null;
  algorithm: "none" | CipherAlgorithm | null;
  hasTtl: boolean;
  status: "none" | "encrypted" | "unencrypted" | "corrupted";
}

export function encodeBase4ZeroWidth(bytes: Uint8Array): string {
  const chunks: string[] = new Array(bytes.byteLength * 4);
  let cursor = 0;

  for (let i = 0; i < bytes.byteLength; i++) {
    const byte = bytes[i];
    chunks[cursor++] = BITS_TO_ZW[(byte >> 6) & 0b11];
    chunks[cursor++] = BITS_TO_ZW[(byte >> 4) & 0b11];
    chunks[cursor++] = BITS_TO_ZW[(byte >> 2) & 0b11];
    chunks[cursor++] = BITS_TO_ZW[byte & 0b11];
  }

  return chunks.join("");
}

/**
 * Base-16 Variation Selector encoding (U+FE00..U+FE0F): 2 invisible selectors per byte.
 */
export function encodeVariationSelectors(bytes: Uint8Array): string {
  const chunks: string[] = new Array(bytes.byteLength * 2);
  let cursor = 0;

  for (let i = 0; i < bytes.byteLength; i++) {
    const byte = bytes[i];
    chunks[cursor++] = String.fromCharCode(VS_BASE_CODE + ((byte >> 4) & 0x0f));
    chunks[cursor++] = String.fromCharCode(VS_BASE_CODE + (byte & 0x0f));
  }

  return chunks.join("");
}

export function extractZeroWidthChars(text: string): string {
  const runs = text.match(ZW_RUN_REGEX);
  if (!runs || runs.length === 0) return "";
  // Pick the longest contiguous zero-width sequence so isolated ZWJs inside emojis (e.g. 👨‍💻) are ignored
  let longest = runs[0];
  for (let i = 1; i < runs.length; i++) {
    if (runs[i].length > longest.length) {
      longest = runs[i];
    }
  }
  return longest;
}

export function extractVariationSelectors(text: string): string {
  const matches = text.match(VS_REGEX);
  return matches ? matches.join("") : "";
}

export function stripZeroWidthChars(text: string): string {
  return text.replace(ZW_REGEX, "");
}

export function stripAllHiddenChars(text: string): string {
  return text.replace(ALL_HIDDEN_REGEX, "");
}

export function decodeBase4ZeroWidth(zwPayload: string): Uint8Array {
  if (!zwPayload.length) {
    throw new StegoError("NO_PAYLOAD", "No hidden payload found.");
  }

  if (zwPayload.length % 4 !== 0) {
    throw new StegoError(
      "CORRUPTED_PAYLOAD",
      "Bit alignment mismatch: hidden payload was partially stripped or corrupted by a messaging platform."
    );
  }

  const byteCount = zwPayload.length / 4;
  const bytes = new Uint8Array(byteCount);

  for (let i = 0; i < byteCount; i++) {
    const base = i * 4;
    const b0 = ZW_TO_BITS[zwPayload[base]];
    const b1 = ZW_TO_BITS[zwPayload[base + 1]];
    const b2 = ZW_TO_BITS[zwPayload[base + 2]];
    const b3 = ZW_TO_BITS[zwPayload[base + 3]];

    if (
      b0 === undefined ||
      b1 === undefined ||
      b2 === undefined ||
      b3 === undefined
    ) {
      throw new StegoError(
        "CORRUPTED_PAYLOAD",
        "Encountered invalid zero-width symbol while decoding payload."
      );
    }

    bytes[i] = (b0 << 6) | (b1 << 4) | (b2 << 2) | b3;
  }

  return bytes;
}

export function decodeVariationSelectors(vsPayload: string): Uint8Array {
  if (!vsPayload.length) {
    throw new StegoError("NO_PAYLOAD", "No hidden payload found.");
  }

  if (vsPayload.length % 2 !== 0) {
    throw new StegoError(
      "CORRUPTED_PAYLOAD",
      "Nibble alignment mismatch: variation selectors were partially stripped or corrupted."
    );
  }

  const byteCount = vsPayload.length / 2;
  const bytes = new Uint8Array(byteCount);

  for (let i = 0; i < byteCount; i++) {
    const hi = vsPayload.charCodeAt(i * 2) - VS_BASE_CODE;
    const lo = vsPayload.charCodeAt(i * 2 + 1) - VS_BASE_CODE;

    if (hi < 0 || hi > 15 || lo < 0 || lo > 15) {
      throw new StegoError(
        "CORRUPTED_PAYLOAD",
        "Encountered invalid variation selector while decoding payload."
      );
    }

    bytes[i] = (hi << 4) | lo;
  }

  return bytes;
}

function splitFirstGrapheme(word: string): [string, string] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
    const iterator = segmenter.segment(word)[Symbol.iterator]();
    const first = iterator.next();
    if (!first.done && first.value) {
      const end = first.value.segment.length;
      return [word.slice(0, end), word.slice(end)];
    }
  }

  const codePoints = Array.from(word);
  if (!codePoints.length) return ["", ""];
  return [codePoints[0], codePoints.slice(1).join("")];
}

/**
 * Anchors the invisible zero-width payload between the first and second word
 * (or after the first visible character if single-word) so messaging platforms
 * and mobile OSes do not strip leading/trailing invisible characters.
 */
export function anchorPayload(coverText: string, hiddenPayload: string): string {
  const cleanCover = coverText.replace(ZW_RUN_REGEX, "").replace(VS_REGEX, "");
  const trimmed = cleanCover.trim();

  if (!trimmed.length) {
    return `Hi${hiddenPayload} there`;
  }

  const multiWordMatch = cleanCover.match(/^(\s*\S+)(\s+)([\s\S]*)$/);
  if (multiWordMatch && multiWordMatch[3].length > 0) {
    const [, firstWord, spacing, rest] = multiWordMatch;
    return `${firstWord}${hiddenPayload}${spacing}${rest}`;
  }

  const leadingWhitespaceMatch = cleanCover.match(/^(\s*)([\s\S]*)$/);
  const leading = leadingWhitespaceMatch?.[1] ?? "";
  const body = leadingWhitespaceMatch?.[2] ?? cleanCover;
  const [firstChar, remainder] = splitFirstGrapheme(body);
  return `${leading}${firstChar}${hiddenPayload}${remainder}`;
}

/**
 * Binds variation selectors directly onto a single base emoji grapheme.
 */
export function anchorEmojiPayload(
  carrierEmoji: string,
  vsPayload: string
): string {
  const clean = stripAllHiddenChars(carrierEmoji).trim();
  const [first] = splitFirstGrapheme(clean || "👻");
  const baseEmoji = first || "👻";
  return `${baseEmoji}${vsPayload}`;
}

function classifyVersionHeader(
  firstByte: number,
  rawBytes: number
): Pick<PayloadDetection, "algorithm" | "hasTtl" | "status"> {
  if (firstByte === VERSION_ENCRYPTED || firstByte === VERSION_ENCRYPTED_TTL) {
    return {
      algorithm: "aes-gcm",
      hasTtl: firstByte === VERSION_ENCRYPTED_TTL,
      status: rawBytes >= 45 ? "encrypted" : "corrupted",
    };
  }

  if (firstByte === VERSION_CTR_HMAC || firstByte === VERSION_CTR_HMAC_TTL) {
    return {
      algorithm: "aes-ctr-hmac",
      hasTtl: firstByte === VERSION_CTR_HMAC_TTL,
      status: rawBytes >= 66 ? "encrypted" : "corrupted",
    };
  }

  if (
    firstByte === VERSION_UNENCRYPTED ||
    firstByte === VERSION_UNENCRYPTED_TTL
  ) {
    return {
      algorithm: "none",
      hasTtl: firstByte === VERSION_UNENCRYPTED_TTL,
      status: "unencrypted",
    };
  }

  return {
    algorithm: null,
    hasTtl: false,
    status: "corrupted",
  };
}

/**
 * Lightweight synchronous header inspector for live UI auto-detection and X-Ray analysis.
 */
export function detectPayload(text: string): PayloadDetection {
  const zw = extractZeroWidthChars(text);
  if (zw.length > 0) {
    const isAligned = zw.length % 4 === 0;
    const rawBytes = Math.floor(zw.length / 4);

    if (!isAligned || rawBytes < 2) {
      return {
        hasPayload: true,
        encoding: "zero-width",
        hiddenCharCount: zw.length,
        isAligned,
        rawBytes,
        versionByte: null,
        algorithm: null,
        hasTtl: false,
        status: "corrupted",
      };
    }

    const firstByte =
      (ZW_TO_BITS[zw[0]] << 6) |
      (ZW_TO_BITS[zw[1]] << 4) |
      (ZW_TO_BITS[zw[2]] << 2) |
      ZW_TO_BITS[zw[3]];

    return {
      hasPayload: true,
      encoding: "zero-width",
      hiddenCharCount: zw.length,
      isAligned: true,
      rawBytes,
      versionByte: firstByte,
      ...classifyVersionHeader(firstByte, rawBytes),
    };
  }

  const vs = extractVariationSelectors(text);
  if (vs.length > 0) {
    // Ignore isolated standard emoji presentation selectors (e.g., 1-2 U+FE0F chars)
    if (vs.length < 4 && vs.split("").every((c) => c === "\uFE0F")) {
      return {
        hasPayload: false,
        encoding: null,
        hiddenCharCount: 0,
        isAligned: true,
        rawBytes: 0,
        versionByte: null,
        algorithm: null,
        hasTtl: false,
        status: "none",
      };
    }

    const isAligned = vs.length % 2 === 0;
    const rawBytes = Math.floor(vs.length / 2);

    if (!isAligned || rawBytes < 2) {
      return {
        hasPayload: true,
        encoding: "emoji-vs",
        hiddenCharCount: vs.length,
        isAligned,
        rawBytes,
        versionByte: null,
        algorithm: null,
        hasTtl: false,
        status: "corrupted",
      };
    }

    const hi = vs.charCodeAt(0) - VS_BASE_CODE;
    const lo = vs.charCodeAt(1) - VS_BASE_CODE;
    const firstByte = (hi << 4) | lo;

    return {
      hasPayload: true,
      encoding: "emoji-vs",
      hiddenCharCount: vs.length,
      isAligned: true,
      rawBytes,
      versionByte: firstByte,
      ...classifyVersionHeader(firstByte, rawBytes),
    };
  }

  return {
    hasPayload: false,
    encoding: null,
    hiddenCharCount: 0,
    isAligned: true,
    rawBytes: 0,
    versionByte: null,
    algorithm: null,
    hasTtl: false,
    status: "none",
  };
}

export async function hideMessage(options: {
  coverText: string;
  secret: string;
  passphrase: string;
  noPassword: boolean;
  ttlSeconds?: number;
  algorithm?: CipherAlgorithm;
  encoding?: StegoEncoding;
  carrierEmoji?: string;
}): Promise<HideResult> {
  const encoding: StegoEncoding = options.encoding ?? "zero-width";
  const { frame, originalBytes, compressedBytes, version, algorithm, expiresAt } =
    await buildPayloadFrame(
      options.secret,
      options.passphrase,
      options.noPassword,
      options.ttlSeconds ?? 0,
      options.algorithm ?? "aes-gcm"
    );

  if (encoding === "emoji-vs") {
    const vsPayload = encodeVariationSelectors(frame);
    const stegoText = anchorEmojiPayload(options.carrierEmoji ?? "👻", vsPayload);
    return {
      stegoText,
      encoding,
      originalBytes,
      compressedBytes,
      framedBytes: frame.byteLength,
      hiddenCharCount: vsPayload.length,
      version,
      algorithm,
      expiresAt,
    };
  }

  const zwPayload = encodeBase4ZeroWidth(frame);
  const stegoText = anchorPayload(options.coverText, zwPayload);

  return {
    stegoText,
    encoding,
    originalBytes,
    compressedBytes,
    framedBytes: frame.byteLength,
    hiddenCharCount: zwPayload.length,
    version,
    algorithm,
    expiresAt,
  };
}

export async function revealMessage(options: {
  stegoText: string;
  passphrase: string;
}): Promise<RevealResult> {
  const zw = extractZeroWidthChars(options.stegoText);
  if (zw.length > 0) {
    const frame = decodeBase4ZeroWidth(zw);
    const {
      plaintext,
      version,
      algorithm,
      compressedBytes,
      originalBytes,
      expiresAt,
    } = await unpackPayloadFrame(frame, options.passphrase);

    return {
      secret: plaintext,
      encoding: "zero-width",
      version,
      algorithm,
      hiddenCharCount: zw.length,
      framedBytes: frame.byteLength,
      compressedBytes,
      originalBytes,
      expiresAt,
    };
  }

  const vs = extractVariationSelectors(options.stegoText);
  if (vs.length > 0) {
    const frame = decodeVariationSelectors(vs);
    const {
      plaintext,
      version,
      algorithm,
      compressedBytes,
      originalBytes,
      expiresAt,
    } = await unpackPayloadFrame(frame, options.passphrase);

    return {
      secret: plaintext,
      encoding: "emoji-vs",
      version,
      algorithm,
      hiddenCharCount: vs.length,
      framedBytes: frame.byteLength,
      compressedBytes,
      originalBytes,
      expiresAt,
    };
  }

  throw new StegoError(
    "NO_PAYLOAD",
    "No hidden payload found in the pasted text."
  );
}
