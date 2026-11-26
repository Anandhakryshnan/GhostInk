"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Lock,
  ScanSearch,
  ShieldCheck,
  Smile,
  Sparkles,
  Unlock,
  X,
} from "lucide-react";
import {
  CIPHER_ALGORITHMS,
  CipherAlgorithm,
  compressDeflateRaw,
  CTR_NONCE_LENGTH,
  evaluatePasswordStrength,
  GCM_TAG_LENGTH,
  HMAC_TAG_LENGTH,
  IV_LENGTH,
  SALT_LENGTH,
  StegoError,
  TTL_HEADER_LENGTH,
  TTL_PRESETS,
  TtlPreset,
} from "@/lib/crypto";
import {
  assessCoverSurvival,
  evaluatePlatformCompatibility,
} from "@/lib/platforms";
import { useSessionState } from "@/lib/sessionPersist";
import {
  anchorEmojiPayload,
  CARRIER_EMOJIS,
  hideMessage,
  HideResult,
  StegoEncoding,
  stripAllHiddenChars,
} from "@/lib/stego";
import { CountdownText } from "./CountdownBadge";
import { EmojiPicker } from "./EmojiPicker";

const SAMPLE_COVERS = [
  "Hey! Just checking in on the deployment schedule for tomorrow morning.",
  "Looks good to me — let's merge the PR after the afternoon standup.",
  "Quick reminder: the design review notes are pinned in the team channel.",
  "Coffee at 4pm? Let me know if the usual spot works for you.",
];

interface HidePanelProps {
  onShowToast: (message: string) => void;
  onHandoffReveal: (stegoText: string) => void;
  onHandoffXRay: (stegoText: string) => void;
}

interface LiveTelemetry {
  originalBytes: number;
  compressedBytes: number;
  framedBytes: number;
  hiddenCharCount: number;
}

const STRENGTH_BAR_COLORS: Record<number, string> = {
  0: "bg-white/10",
  1: "bg-rose-400",
  2: "bg-amber-400",
  3: "bg-emerald-400",
  4: "bg-white",
};

const STRENGTH_TEXT_COLORS: Record<number, string> = {
  0: "text-white/40",
  1: "text-rose-400",
  2: "text-amber-300",
  3: "text-emerald-400",
  4: "text-white",
};

export function HidePanel({
  onShowToast,
  onHandoffReveal,
  onHandoffXRay,
}: HidePanelProps) {
  const [encoding, setEncoding] = useSessionState<StegoEncoding>(
    "ghostink.hide.encoding",
    "zero-width"
  );
  const [carrierEmoji, setCarrierEmoji] = useSessionState<string>(
    "ghostink.hide.emoji",
    "👻"
  );
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [coverText, setCoverText] = useSessionState("ghostink.hide.cover", "");
  const [sampleIndex, setSampleIndex] = useSessionState(
    "ghostink.hide.sampleIdx",
    -1
  );
  const [secret, setSecret] = useSessionState("ghostink.hide.secret", "");
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [noPassword, setNoPassword] = useSessionState(
    "ghostink.hide.noPass",
    false
  );
  const [algorithm, setAlgorithm] = useSessionState<CipherAlgorithm>(
    "ghostink.hide.algo",
    "aes-gcm"
  );
  const [ttlPreset, setTtlPreset] = useSessionState<TtlPreset>(
    "ghostink.hide.ttl",
    "none"
  );

  const [telemetry, setTelemetry] = useState<LiveTelemetry>({
    originalBytes: 0,
    compressedBytes: 0,
    framedBytes: 0,
    hiddenCharCount: 0,
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useSessionState<HideResult | null>(
    "ghostink.hide.result",
    null
  );
  const [copied, setCopied] = useState(false);

  const strength = evaluatePasswordStrength(passphrase);
  const activeTtl = useMemo(
    () => TTL_PRESETS.find((preset) => preset.id === ttlPreset) ?? TTL_PRESETS[0],
    [ttlPreset]
  );

  const survival = useMemo(() => assessCoverSurvival(coverText), [coverText]);
  const cleanCoverLength = useMemo(() => {
    if (encoding === "emoji-vs") {
      return anchorEmojiPayload(carrierEmoji, "").length;
    }
    const stripped = stripAllHiddenChars(coverText);
    return stripped.trim().length ? stripped.length : "Hi there".length;
  }, [coverText, encoding, carrierEmoji]);

  const totalProjectedChars = cleanCoverLength + telemetry.hiddenCharCount;
  const platformCompatibility = useMemo(
    () => evaluatePlatformCompatibility(totalProjectedChars),
    [totalProjectedChars]
  );

  useEffect(() => {
    let cancelled = false;

    async function computeTelemetry() {
      if (!secret.length) {
        if (!cancelled) {
          setTelemetry({
            originalBytes: 0,
            compressedBytes: 0,
            framedBytes: 0,
            hiddenCharCount: 0,
          });
        }
        return;
      }

      const raw = new TextEncoder().encode(secret);
      const innerInput =
        activeTtl.seconds > 0
          ? new Uint8Array(raw.byteLength + TTL_HEADER_LENGTH)
          : raw;
      if (activeTtl.seconds > 0) {
        innerInput.set(raw, TTL_HEADER_LENGTH);
      }

      try {
        const compressed = await compressDeflateRaw(innerInput);
        if (cancelled) return;

        const overhead = noPassword
          ? 1
          : algorithm === "aes-ctr-hmac"
            ? 1 + SALT_LENGTH + CTR_NONCE_LENGTH + HMAC_TAG_LENGTH
            : 1 + SALT_LENGTH + IV_LENGTH + GCM_TAG_LENGTH;
        const framedBytes = compressed.byteLength + overhead;
        const charsPerByte = encoding === "emoji-vs" ? 2 : 4;

        setTelemetry({
          originalBytes: raw.byteLength,
          compressedBytes: compressed.byteLength,
          framedBytes,
          hiddenCharCount: framedBytes * charsPerByte,
        });
      } catch {
        if (!cancelled) {
          setTelemetry({
            originalBytes: raw.byteLength,
            compressedBytes: 0,
            framedBytes: 0,
            hiddenCharCount: 0,
          });
        }
      }
    }

    const timer = setTimeout(() => {
      void computeTelemetry();
    }, 60);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [secret, noPassword, activeTtl.seconds, algorithm, encoding]);

  const handleCycleSampleCover = () => {
    const nextIdx = (sampleIndex + 1) % SAMPLE_COVERS.length;
    setSampleIndex(nextIdx);
    setCoverText(SAMPLE_COVERS[nextIdx]);
  };

  const handleHide = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCopied(false);

    if (!secret.trim().length && !secret.length) {
      setError("Enter a secret message to embed.");
      return;
    }

    if (!noPassword && !passphrase.length) {
      setError("Enter a passphrase or toggle Quick Hide (No Password).");
      return;
    }

    setIsProcessing(true);
    try {
      const output = await hideMessage({
        coverText,
        secret,
        passphrase,
        noPassword,
        ttlSeconds: activeTtl.seconds,
        algorithm,
        encoding,
        carrierEmoji,
      });
      setResult(output);
    } catch (err) {
      if (err instanceof StegoError) {
        setError(err.message);
      } else {
        setError("Failed to encode secret. Ensure your browser supports Web Crypto.");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopyOutput = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.stegoText);
      setCopied(true);
      onShowToast("Stego text copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onShowToast("Clipboard permission denied — select and copy manually");
    }
  };

  const compressionRatio =
    telemetry.originalBytes > 0 && telemetry.compressedBytes > 0
      ? Math.round((1 - telemetry.compressedBytes / telemetry.originalBytes) * 100)
      : 0;

  const activeVersionLabel = noPassword
    ? activeTtl.seconds > 0
      ? "0x03"
      : "0x00"
    : algorithm === "aes-ctr-hmac"
      ? activeTtl.seconds > 0
        ? "0x05"
        : "0x04"
      : activeTtl.seconds > 0
        ? "0x02"
        : "0x01";

  const activeCipherMeta = useMemo(
    () =>
      CIPHER_ALGORITHMS.find((entry) => entry.id === algorithm) ??
      CIPHER_ALGORITHMS[0],
    [algorithm]
  );

  return (
    <form onSubmit={handleHide} className="space-y-6">
      {/* Carrier & Cloaking Mode */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label
            htmlFor={
              encoding === "zero-width"
                ? "hide-cover-text"
                : "hide-custom-emoji"
            }
            className="text-xs font-mono uppercase tracking-widest text-white/60"
          >
            01 / Carrier (
            {encoding === "emoji-vs" ? "Single Emoji" : "Cover Text"})
          </label>

          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-full bg-white/5 border border-white/10 p-0.5">
              <button
                type="button"
                onClick={() => {
                  setEncoding("zero-width");
                  setResult(null);
                }}
                className={`px-3 py-1 rounded-full text-[11px] font-mono transition-all cursor-pointer ${
                  encoding === "zero-width"
                    ? "bg-white text-black font-semibold"
                    : "text-white/60 hover:text-white"
                }`}
              >
                Text Cover
              </button>
              <button
                type="button"
                onClick={() => {
                  setEncoding("emoji-vs");
                  setResult(null);
                }}
                className={`px-3 py-1 rounded-full text-[11px] font-mono transition-all cursor-pointer ${
                  encoding === "emoji-vs"
                    ? "bg-white text-black font-semibold"
                    : "text-white/60 hover:text-white"
                }`}
              >
                Single Emoji
              </button>
            </div>

            {encoding === "zero-width" && (
              <button
                type="button"
                onClick={handleCycleSampleCover}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] font-mono uppercase tracking-wider text-white/70 hover:text-white hover:border-white/25 hover:bg-white/10 transition-all cursor-pointer"
              >
                <Sparkles className="w-3 h-3" />
                Sample
              </button>
            )}
          </div>
        </div>

        {encoding === "zero-width" ? (
          <>
            <textarea
              id="hide-cover-text"
              rows={2}
              value={coverText}
              onChange={(e) => setCoverText(e.target.value)}
              placeholder="Enter your message..."
              className="w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/35 focus:bg-black/60 transition-all resize-y subtle-scroll"
            />
            <div className="flex items-center gap-2 text-[11px] font-mono">
              {survival.status === "optimal" ? (
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              )}
              <span
                className={
                  survival.status === "optimal"
                    ? "text-emerald-300/80"
                    : "text-amber-300/80"
                }
              >
                {survival.message}
              </span>
            </div>
          </>
        ) : (
          <div className="rounded-2xl bg-black/40 border border-white/10 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {CARRIER_EMOJIS.map((emoji) => {
                  const selected = carrierEmoji === emoji;
                  return (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setCarrierEmoji(emoji)}
                      className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center border transition-all cursor-pointer ${
                        selected
                          ? "bg-white/15 border-white shadow-[0_0_20px_rgba(255,255,255,0.16)] scale-105"
                          : "bg-white/[0.03] border-white/10 hover:border-white/30 hover:bg-white/10"
                      }`}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker((prev) => !prev)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-mono transition-all cursor-pointer ${
                    showEmojiPicker
                      ? "bg-white text-black border-white font-semibold"
                      : "bg-white/5 text-white/75 border-white/10 hover:border-white/30 hover:text-white"
                  }`}
                >
                  <Smile className="w-3.5 h-3.5" />
                  All Emojis
                </button>
                <span className="text-[11px] font-mono text-white/45 uppercase">
                  Custom:
                </span>
                <input
                  id="hide-custom-emoji"
                  type="text"
                  value={carrierEmoji}
                  onChange={(e) => setCarrierEmoji(e.target.value)}
                  maxLength={8}
                  aria-label="Custom carrier emoji"
                  className="w-16 text-center text-lg rounded-xl bg-black/60 border border-white/15 py-1.5 text-white focus:outline-none focus:border-white/40"
                />
              </div>
            </div>

            {showEmojiPicker && (
              <EmojiPicker
                singleCodepointOnly
                selectedEmoji={carrierEmoji}
                onSelect={(emoji) => {
                  setCarrierEmoji(emoji);
                  setShowEmojiPicker(false);
                }}
                onClose={() => setShowEmojiPicker(false)}
              />
            )}

            <div className="flex items-center gap-2 text-[11px] font-mono text-emerald-300/85">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>
                Variation Selectors (U+FE00–U+FE0F) bind directly to 1 emoji as a single grapheme (2 chars/B — 50% shorter).
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Secret Message Input */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor="hide-secret-text"
            className="text-xs font-mono uppercase tracking-widest text-white/60"
          >
            02 / Secret Message
          </label>
          <span className="text-[11px] font-mono text-white/40">
            UTF-8 • deflate-raw
          </span>
        </div>
        <textarea
          id="hide-secret-text"
          rows={3}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Type or paste the confidential message, API token, or note to conceal..."
          className="w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/35 focus:bg-black/60 transition-all resize-y subtle-scroll"
        />
      </div>

      {/* Encryption Mode, Passphrase & Self-Destruct TTL */}
      <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4 md:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/80">
              {noPassword ? (
                <Unlock className="w-4 h-4 text-amber-300" />
              ) : (
                <Lock className="w-4 h-4 text-emerald-400" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-white">
                {noPassword
                  ? "Quick Hide (No Password)"
                  : `${activeCipherMeta.label} + PBKDF2 (250k)`}
              </p>
              <p className="text-xs text-white/50 font-mono">
                {noPassword
                  ? `Header ${activeVersionLabel} • Compression + Base-4 encoding`
                  : `Header ${activeVersionLabel} • ${activeCipherMeta.description}`}
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={noPassword}
            onClick={() => {
              setNoPassword((prev) => !prev);
              setError(null);
            }}
            className="inline-flex items-center gap-2.5 self-start sm:self-center px-3 py-1.5 rounded-full bg-white/5 border border-white/10 hover:border-white/25 transition-all cursor-pointer"
          >
            <span className="text-[11px] font-mono uppercase tracking-wider text-white/70">
              No Password
            </span>
            <span
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                noPassword ? "bg-white" : "bg-white/15"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
                  noPassword
                    ? "translate-x-4.5 bg-black"
                    : "translate-x-1 bg-white/80"
                }`}
              />
            </span>
          </button>
        </div>

        <AnimatePresence initial={false}>
          {!noPassword && (
            <motion.div
              key="passphrase-field"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="pt-1 space-y-3">
                {/* Cipher Algorithm Selector */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {CIPHER_ALGORITHMS.map((cipher) => {
                    const selected = cipher.id === algorithm;
                    return (
                      <button
                        key={cipher.id}
                        type="button"
                        onClick={() => setAlgorithm(cipher.id)}
                        className={`text-left rounded-xl px-3.5 py-2.5 border transition-all cursor-pointer ${
                          selected
                            ? "bg-white text-black border-white shadow-[0_0_20px_rgba(255,255,255,0.12)]"
                            : "bg-black/40 text-white/75 border-white/10 hover:border-white/25 hover:text-white"
                        }`}
                      >
                        <p className="text-xs font-mono font-semibold tracking-wide">
                          {cipher.label}
                        </p>
                        <p
                          className={`text-[10px] font-mono mt-0.5 ${
                            selected ? "text-black/70" : "text-white/45"
                          }`}
                        >
                          {cipher.description}
                        </p>
                      </button>
                    );
                  })}
                </div>

                <div className="relative">
                  <input
                    id="hide-passphrase"
                    type={showPassphrase ? "text" : "password"}
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="Enter strong encryption passphrase..."
                    autoComplete="new-password"
                    className="w-full rounded-xl bg-black/50 border border-white/10 pl-4 pr-11 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/35 transition-all"
                  />
                  <button
                    type="button"
                    aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"}
                    onClick={() => setShowPassphrase((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    {showPassphrase ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>

                {/* Strength Bar */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 grid grid-cols-4 gap-1.5">
                    {[1, 2, 3, 4].map((level) => (
                      <div
                        key={level}
                        className={`h-1 rounded-full transition-colors duration-300 ${
                          strength.score >= level
                            ? STRENGTH_BAR_COLORS[strength.score]
                            : "bg-white/10"
                        }`}
                      />
                    ))}
                  </div>
                  <span
                    className={`text-[11px] font-mono uppercase tracking-wider ${
                      STRENGTH_TEXT_COLORS[strength.score]
                    }`}
                  >
                    {strength.label}
                  </span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Self-Destruct TTL Selector */}
        <div className="pt-3 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-white/70">
            <Clock className="w-3.5 h-3.5 text-white/60" />
            <span>Self-Destruct TTL</span>
            {activeTtl.seconds > 0 && (
              <span className="text-[10px] font-mono text-emerald-400">
                (authenticated)
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {TTL_PRESETS.map((preset) => {
              const selected = preset.id === ttlPreset;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setTtlPreset(preset.id)}
                  className={`px-3 py-1 rounded-full text-[11px] font-mono transition-all cursor-pointer border ${
                    selected
                      ? "bg-white text-black border-white font-semibold"
                      : "bg-white/5 text-white/65 border-white/10 hover:text-white hover:border-white/25"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Live Payload Telemetry & Platform Limit Guard */}
      <div className="rounded-2xl bg-black/50 border border-white/10 px-4 py-3.5 space-y-3.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/45">
            Live Payload Telemetry
          </span>
          {telemetry.originalBytes > 0 && (
            <span className="text-[10px] font-mono text-white/50">
              {compressionRatio >= 0
                ? `${compressionRatio}% deflate savings`
                : `+${Math.abs(compressionRatio)}% deflate framing`}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2">
            <p className="text-[10px] font-mono uppercase tracking-wider text-white/45">
              Original Secret
            </p>
            <p className="text-sm font-mono font-semibold text-white mt-0.5">
              {telemetry.originalBytes} B
            </p>
          </div>
          <div className="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2">
            <p className="text-[10px] font-mono uppercase tracking-wider text-white/45">
              Compressed
            </p>
            <p className="text-sm font-mono font-semibold text-white mt-0.5">
              {telemetry.compressedBytes} B
            </p>
          </div>
          <div className="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2">
            <p className="text-[10px] font-mono uppercase tracking-wider text-white/45">
              Framed ({activeVersionLabel})
            </p>
            <p className="text-sm font-mono font-semibold text-white mt-0.5">
              {telemetry.framedBytes} B
            </p>
          </div>
          <div className="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2">
            <p className="text-[10px] font-mono uppercase tracking-wider text-white/45">
              {encoding === "emoji-vs" ? "Variation Selectors" : "Invisible Chars"}
            </p>
            <p className="text-sm font-mono font-semibold text-emerald-400 mt-0.5">
              {telemetry.hiddenCharCount.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Platform Limit & Survival Guard */}
        <div className="pt-2.5 border-t border-white/10 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/45">
              Platform Limit Guard
            </span>
            <span className="text-[11px] font-mono text-white/60">
              {totalProjectedChars.toLocaleString()} total chars
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {platformCompatibility.map((platform) => (
              <span
                key={platform.id}
                title={`${platform.name}: ${totalProjectedChars.toLocaleString()} / ${platform.limit.toLocaleString()} chars`}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[10px] font-mono transition-colors ${
                  platform.fits
                    ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-300"
                    : "bg-rose-500/10 border-rose-500/25 text-rose-300"
                }`}
              >
                {platform.fits ? (
                  <Check className="w-2.5 h-2.5" />
                ) : (
                  <X className="w-2.5 h-2.5" />
                )}
                <span>{platform.name}</span>
                <span className="opacity-65">
                  {platform.limit >= 1000
                    ? `${Math.round(platform.limit / 1000)}k`
                    : platform.limit}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Error Message */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="flex items-start gap-2.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-sm text-rose-200"
          >
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Primary Action */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="submit"
          disabled={isProcessing}
          className="group relative inline-flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-full bg-white text-black text-sm font-semibold tracking-wide shadow-[0_0_30px_rgba(255,255,255,0.16)] hover:shadow-[0_0_50px_rgba(255,255,255,0.32)] hover:scale-[1.01] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all cursor-pointer"
        >
          {isProcessing ? (
            <>
              <span className="w-4 h-4 border-2 border-black/25 border-t-black rounded-full animate-spin" />
              <span>Deriving Key &amp; Embedding...</span>
            </>
          ) : (
            <>
              {noPassword ? (
                <Unlock className="w-4 h-4" />
              ) : (
                <Lock className="w-4 h-4" />
              )}
              <span>
                {noPassword
                  ? `Embed Secret (${activeVersionLabel})`
                  : `Encrypt & Hide (${activeVersionLabel})`}
              </span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </>
          )}
        </button>

        {result && (
          <span className="text-xs font-mono text-white/50">
            Payload ready • {result.hiddenCharCount.toLocaleString()}{" "}
            {result.encoding === "emoji-vs"
              ? "variation selectors"
              : "invisible chars"}{" "}
            injected
          </span>
        )}
      </div>

      {/* Stego Output Box */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.25 }}
            className="rounded-3xl bg-white/[0.04] border border-white/15 p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span className="text-xs font-mono uppercase tracking-widest text-white/80">
                  Stego Output (Ready to Share)
                </span>
                {result.expiresAt !== null && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-[10px] font-mono text-emerald-300">
                    <Clock className="w-2.5 h-2.5" />
                    <CountdownText
                      expiresAt={result.expiresAt}
                      prefix="Expires in "
                    />
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={handleCopyOutput}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white text-black text-xs font-semibold uppercase tracking-wider hover:bg-white/90 active:scale-95 transition-all cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy to Clipboard
                  </>
                )}
              </button>
            </div>

            <div
              className={`rounded-2xl bg-black/60 border border-white/10 p-4 text-white/90 break-words select-all font-sans ${
                result.encoding === "emoji-vs"
                  ? "text-4xl text-center py-5 tracking-normal"
                  : "text-sm leading-relaxed"
              }`}
            >
              {result.stegoText}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <p className="text-[11px] font-mono text-white/45">
                {result.originalBytes} B raw → {result.compressedBytes} B compressed →{" "}
                {result.framedBytes} B framed ({result.hiddenCharCount}{" "}
                {result.encoding === "emoji-vs" ? "VS selectors" : "ZW chars"})
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onHandoffReveal(result.stegoText)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[11px] font-mono uppercase tracking-wider text-white/75 hover:text-white hover:border-white/25 transition-all cursor-pointer"
                >
                  Test in Reveal
                </button>
                <button
                  type="button"
                  onClick={() => onHandoffXRay(result.stegoText)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[11px] font-mono uppercase tracking-wider text-white/75 hover:text-white hover:border-white/25 transition-all cursor-pointer"
                >
                  <ScanSearch className="w-3 h-3" />
                  Inspect X-Ray
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </form>
  );
}
