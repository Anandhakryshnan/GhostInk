"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  ClipboardPaste,
  Copy,
  Eraser,
  ScanSearch,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  VERSION_CTR_HMAC,
  VERSION_CTR_HMAC_TTL,
  VERSION_ENCRYPTED,
  VERSION_ENCRYPTED_TTL,
  VERSION_UNENCRYPTED,
  VERSION_UNENCRYPTED_TTL,
} from "@/lib/crypto";
import { inspectStegoText, ZeroWidthSymbol } from "@/lib/inspector";
import { evaluatePlatformCompatibility } from "@/lib/platforms";

interface XRayInspectorProps {
  input: string;
  onInputChange: (value: string) => void;
  onShowToast: (message: string) => void;
}

const BADGE_STYLES: Record<ZeroWidthSymbol, string> = {
  ZWSP: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35",
  ZWNJ: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/35",
  ZWJ: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35",
  WJ: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/35",
};

const LEGEND_ITEMS: Array<{
  symbol: ZeroWidthSymbol;
  bits: string;
  codePoint: string;
}> = [
  { symbol: "ZWSP", bits: "00", codePoint: "U+200B" },
  { symbol: "ZWNJ", bits: "01", codePoint: "U+200C" },
  { symbol: "ZWJ", bits: "10", codePoint: "U+200D" },
  { symbol: "WJ", bits: "11", codePoint: "U+2060" },
];

const INITIAL_TOKEN_LIMIT = 800;

export function XRayInspector({
  input,
  onInputChange,
  onShowToast,
}: XRayInspectorProps) {
  const [showAllTokens, setShowAllTokens] = useState(false);
  const [copiedClean, setCopiedClean] = useState(false);

  const analysis = useMemo(() => inspectStegoText(input), [input]);
  const platformFitsCount = useMemo(() => {
    if (!input.length) return 0;
    return evaluatePlatformCompatibility(input.length).filter((p) => p.fits)
      .length;
  }, [input.length]);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      onInputChange(text);
      setShowAllTokens(false);
      onShowToast("Pasted text into X-Ray inspector");
    } catch {
      onShowToast("Clipboard read blocked — paste manually with Ctrl+V");
    }
  };

  const handleStrip = () => {
    if (analysis.hiddenChars === 0) {
      onShowToast("No hidden zero-width characters to strip");
      return;
    }
    const strippedCount = analysis.hiddenChars;
    onInputChange(analysis.sanitizedText);
    setShowAllTokens(false);
    onShowToast(`Stripped ${strippedCount.toLocaleString()} hidden characters`);
  };

  const handleCopySanitized = async () => {
    try {
      await navigator.clipboard.writeText(analysis.sanitizedText);
      setCopiedClean(true);
      onShowToast("Sanitized text copied to clipboard");
      setTimeout(() => setCopiedClean(false), 2000);
    } catch {
      onShowToast("Clipboard permission denied");
    }
  };

  const headerVersionLabel = useMemo(() => {
    const { status, versionByte } = analysis.detection;
    if (status === "none") return "None";
    if (versionByte === VERSION_ENCRYPTED) return "0x01 • AES-GCM";
    if (versionByte === VERSION_ENCRYPTED_TTL) return "0x02 • AES + TTL";
    if (versionByte === VERSION_UNENCRYPTED) return "0x00 • Deflate";
    if (versionByte === VERSION_UNENCRYPTED_TTL) return "0x03 • TTL";
    if (versionByte === VERSION_CTR_HMAC) return "0x04 • CTR+HMAC";
    if (versionByte === VERSION_CTR_HMAC_TTL) return "0x05 • CTR+TTL";
    if (versionByte !== null) {
      return `0x${versionByte.toString(16).padStart(2, "0")} • Invalid`;
    }
    return "Corrupted";
  }, [analysis.detection]);

  const renderedSegments = useMemo(() => {
    if (showAllTokens || analysis.segments.length <= INITIAL_TOKEN_LIMIT) {
      return analysis.segments;
    }
    return analysis.segments.slice(0, INITIAL_TOKEN_LIMIT);
  }, [analysis.segments, showAllTokens]);

  const hiddenRemaining = analysis.segments.length - renderedSegments.length;

  return (
    <div className="space-y-6">
      {/* Input Area */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label
            htmlFor="xray-input"
            className="text-xs font-mono uppercase tracking-widest text-neutral-600 dark:text-white/60"
          >
            01 / Text to Inspect (Steganalysis)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePaste}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/[0.04] dark:bg-white/5 border border-black/10 dark:border-white/10 text-[11px] font-mono uppercase tracking-wider text-neutral-600 dark:text-white/70 hover:text-neutral-950 dark:hover:text-white hover:border-black/25 dark:hover:border-white/25 hover:bg-black/[0.08] dark:hover:bg-white/10 transition-all cursor-pointer"
            >
              <ClipboardPaste className="w-3 h-3" />
              Paste
            </button>
            {input.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onInputChange("");
                  setShowAllTokens(false);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/[0.04] dark:bg-white/5 border border-black/10 dark:border-white/10 text-[11px] font-mono uppercase tracking-wider text-neutral-500 dark:text-white/55 hover:text-neutral-950 dark:hover:text-white hover:border-black/25 dark:hover:border-white/25 transition-all cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                Clear
              </button>
            )}
          </div>
        </div>
        <textarea
          id="xray-input"
          rows={3}
          value={input}
          onChange={(e) => {
            onInputChange(e.target.value);
            setShowAllTokens(false);
          }}
          placeholder="Paste any suspicious text to reveal invisible ZWSP, ZWNJ, ZWJ, and WJ code points..."
          className="w-full rounded-2xl bg-white/80 dark:bg-black/40 border border-black/10 dark:border-white/10 px-4 py-3 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-white/30 focus:outline-none focus:border-neutral-900/45 dark:focus:border-white/35 focus:bg-white dark:focus:bg-black/60 transition-all resize-y subtle-scroll"
        />
      </div>

      {/* Telemetry Summary Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/10 dark:border-white/10 px-4 py-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 dark:text-white/45">
            Visible Chars
          </p>
          <p className="text-lg font-mono font-semibold text-neutral-900 dark:text-white mt-1">
            {analysis.visibleChars.toLocaleString()}
          </p>
        </div>

        <div className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/10 dark:border-white/10 px-4 py-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 dark:text-white/45">
            Hidden Chars
          </p>
          <p
            className={`text-lg font-mono font-semibold mt-1 ${
              analysis.hiddenChars > 0 ? "text-amber-700 dark:text-amber-300" : "text-neutral-600 dark:text-white/70"
            }`}
          >
            {analysis.hiddenChars.toLocaleString()}
          </p>
        </div>

        <div className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/10 dark:border-white/10 px-4 py-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 dark:text-white/45">
            Raw Payload
          </p>
          <div className="flex items-baseline gap-2 mt-1">
            <p className="text-lg font-mono font-semibold text-neutral-900 dark:text-white">
              {analysis.rawPayloadBytes} B
            </p>
            {analysis.hiddenChars > 0 && (
              <span
                className={`text-[10px] font-mono uppercase ${
                  analysis.isAligned ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                }`}
              >
                {analysis.isAligned ? "aligned" : "skewed"}
              </span>
            )}
          </div>
        </div>

        <div className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/10 dark:border-white/10 px-4 py-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 dark:text-white/45">
            Header Version
          </p>
          <p className="text-sm sm:text-base font-mono font-semibold text-neutral-900 dark:text-white mt-1.5 truncate">
            {headerVersionLabel}
          </p>
        </div>
      </div>

      {/* Survival Guard Banner when hidden chars exist */}
      {analysis.hiddenChars > 0 && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-4 py-2.5 text-xs font-mono ${
            analysis.edgeExposed
              ? "bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-200"
              : "bg-emerald-500/10 border-emerald-500/25 text-emerald-800 dark:text-emerald-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {analysis.edgeExposed ? (
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            )}
            <span>
              {analysis.edgeExposed
                ? "Edge-exposed invisible characters detected — messaging apps may trim leading/trailing glyphs."
                : analysis.detection.encoding === "emoji-vs"
                  ? "Survival Guard: grapheme-bound Emoji Variation Selectors (2 chars/B Base-16)."
                  : "Survival Guard: hidden payload is safely anchored inside visible text."}
            </span>
          </div>
          <span className="text-neutral-600 dark:text-white/70">
            Fits {platformFitsCount}/7 platforms ({input.length.toLocaleString()} chars)
          </span>
        </div>
      )}

      {/* Base-4 Legend & Counts */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {LEGEND_ITEMS.map((item) => (
            <span
              key={item.symbol}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-mono ${BADGE_STYLES[item.symbol]}`}
            >
              <span>[{item.symbol}]</span>
              <span className="opacity-65">{item.bits}</span>
              <span className="opacity-90 font-semibold">
                ×{analysis.counts[item.symbol]}
              </span>
            </span>
          ))}
          {analysis.vsChars > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-mono bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/35">
              <span>[VS1–16]</span>
              <span className="opacity-65">U+FE00..0F</span>
              <span className="opacity-90 font-semibold">
                ×{analysis.vsChars}
              </span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleStrip}
            disabled={analysis.hiddenChars === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-black text-xs font-semibold uppercase tracking-wider hover:bg-neutral-800 dark:hover:bg-white/90 active:scale-95 disabled:opacity-35 disabled:pointer-events-none transition-all cursor-pointer"
          >
            <Eraser className="w-3.5 h-3.5" />
            Strip Hidden Characters
          </button>

          {input.length > 0 && analysis.hiddenChars === 0 && (
            <button
              type="button"
              onClick={handleCopySanitized}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black/[0.06] dark:bg-white/10 border border-black/15 dark:border-white/15 text-neutral-900 dark:text-white text-xs font-semibold uppercase tracking-wider hover:bg-black/10 dark:hover:bg-white/15 transition-all cursor-pointer"
            >
              {copiedClean ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Copied Clean
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy Clean Text
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Inline X-Ray Viewport */}
      <div className="rounded-3xl bg-neutral-50/90 dark:bg-black/55 border border-black/10 dark:border-white/10 p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-neutral-600 dark:text-white/60">
            <ScanSearch className="w-3.5 h-3.5 text-neutral-600 dark:text-white/70" />
            <span>Inline Code-Point X-Ray Stream</span>
          </div>
          <span className="text-[11px] font-mono text-neutral-400 dark:text-white/40">
            {analysis.hiddenChars > 0
              ? "Invisible glyphs exposed inline"
              : "Clean stream"}
          </span>
        </div>

        <div className="min-h-[140px] max-h-[340px] overflow-y-auto subtle-scroll rounded-2xl bg-neutral-50 dark:bg-neutral-950/80 border border-black/5 dark:border-white/5 p-4 text-sm leading-7 text-neutral-800 dark:text-white/90 break-words">
          {input.length === 0 ? (
            <p className="text-neutral-400 dark:text-white/30 font-mono text-xs">
              Paste text above or generate a stego message in the Hide tab to inspect its anchored zero-width structure...
            </p>
          ) : (
            <motion.div
              initial={{ opacity: 0.6 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
              className="whitespace-pre-wrap"
            >
              {renderedSegments.map((seg, idx) =>
                seg.type === "text" ? (
                  <span key={idx}>{seg.value}</span>
                ) : seg.type === "zw" ? (
                  <span
                    key={idx}
                    title={`${seg.codePoint} (bits ${seg.bits})`}
                    className={`inline-flex items-center mx-0.5 px-1.5 py-0.5 rounded-md border font-mono text-[10px] leading-none align-middle select-none ${BADGE_STYLES[seg.symbol]}`}
                  >
                    [{seg.symbol}]
                  </span>
                ) : (
                  <span
                    key={idx}
                    title={`${seg.codePoint} (nibble ${seg.nibble})`}
                    className="inline-flex items-center mx-0.5 px-1.5 py-0.5 rounded-md border font-mono text-[10px] leading-none align-middle select-none bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/35"
                  >
                    [{seg.symbol}]
                  </span>
                )
              )}

              {hiddenRemaining > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllTokens(true)}
                  className="ml-2 inline-flex items-center px-3 py-1 rounded-full bg-black/[0.06] dark:bg-white/10 border border-black/15 dark:border-white/20 text-xs font-mono text-neutral-900 dark:text-white hover:bg-black/15 dark:hover:bg-white/20 transition-colors cursor-pointer"
                >
                  +{hiddenRemaining.toLocaleString()} more tokens (Show all)
                </button>
              )}
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
