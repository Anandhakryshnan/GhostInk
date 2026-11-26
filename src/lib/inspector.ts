import {
  detectPayload,
  PayloadDetection,
  stripAllHiddenChars,
  ZERO_WIDTH_CHARS,
} from "./stego";

export type ZeroWidthSymbol = "ZWSP" | "ZWNJ" | "ZWJ" | "WJ";

export type XRaySegment =
  | { type: "text"; value: string }
  | {
      type: "zw";
      symbol: ZeroWidthSymbol;
      char: string;
      codePoint: string;
      bits: string;
    }
  | {
      type: "vs";
      symbol: string;
      char: string;
      codePoint: string;
      nibble: string;
    };

export interface XRayAnalysis {
  segments: XRaySegment[];
  visibleChars: number;
  hiddenChars: number;
  vsChars: number;
  rawPayloadBytes: number;
  isAligned: boolean;
  edgeExposed: boolean;
  detection: PayloadDetection;
  counts: Record<ZeroWidthSymbol, number>;
  sanitizedText: string;
}

const ZW_META: Record<
  string,
  { symbol: ZeroWidthSymbol; codePoint: string; bits: string }
> = {
  [ZERO_WIDTH_CHARS.ZWSP]: { symbol: "ZWSP", codePoint: "U+200B", bits: "00" },
  [ZERO_WIDTH_CHARS.ZWNJ]: { symbol: "ZWNJ", codePoint: "U+200C", bits: "01" },
  [ZERO_WIDTH_CHARS.ZWJ]: { symbol: "ZWJ", codePoint: "U+200D", bits: "10" },
  [ZERO_WIDTH_CHARS.WJ]: { symbol: "WJ", codePoint: "U+2060", bits: "11" },
};

function countVisibleGraphemes(text: string): number {
  if (!text.length) return 0;
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
    const iterator = segmenter.segment(text)[Symbol.iterator]();
    let count = 0;
    while (!iterator.next().done) {
      count += 1;
    }
    return count;
  }
  return Array.from(text).length;
}

export function inspectStegoText(input: string): XRayAnalysis {
  const segments: XRaySegment[] = [];
  const counts: Record<ZeroWidthSymbol, number> = {
    ZWSP: 0,
    ZWNJ: 0,
    ZWJ: 0,
    WJ: 0,
  };
  let vsChars = 0;
  let textBuffer = "";

  for (const ch of input) {
    const zwMeta = ZW_META[ch];
    const code = ch.charCodeAt(0);
    const isVs = ch.length === 1 && code >= 0xfe00 && code <= 0xfe0f;

    if (zwMeta) {
      if (textBuffer.length > 0) {
        segments.push({ type: "text", value: textBuffer });
        textBuffer = "";
      }
      counts[zwMeta.symbol] += 1;
      segments.push({
        type: "zw",
        symbol: zwMeta.symbol,
        char: ch,
        codePoint: zwMeta.codePoint,
        bits: zwMeta.bits,
      });
    } else if (isVs) {
      if (textBuffer.length > 0) {
        segments.push({ type: "text", value: textBuffer });
        textBuffer = "";
      }
      const index = code - 0xfe00;
      vsChars += 1;
      segments.push({
        type: "vs",
        symbol: `VS${index + 1}`,
        char: ch,
        codePoint: `U+${code.toString(16).toUpperCase()}`,
        nibble: `0x${index.toString(16).toUpperCase()}`,
      });
    } else {
      textBuffer += ch;
    }
  }

  if (textBuffer.length > 0) {
    segments.push({ type: "text", value: textBuffer });
  }

  const sanitizedText = stripAllHiddenChars(input);
  const detection = detectPayload(input);
  const totalZw = counts.ZWSP + counts.ZWNJ + counts.ZWJ + counts.WJ;
  const hiddenChars =
    detection.encoding === "emoji-vs" ? vsChars : totalZw || vsChars;

  // Variation selectors are expected after an emoji; only flag ZW chars on edges
  const edgeExposed =
    totalZw > 0 &&
    (segments[0]?.type === "zw" ||
      segments[segments.length - 1]?.type === "zw");

  return {
    segments,
    visibleChars: countVisibleGraphemes(sanitizedText),
    hiddenChars,
    vsChars,
    rawPayloadBytes: detection.rawBytes,
    isAligned: detection.isAligned,
    edgeExposed,
    detection,
    counts,
    sanitizedText,
  };
}
