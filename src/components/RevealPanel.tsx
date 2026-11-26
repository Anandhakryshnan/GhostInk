"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Check,
  ClipboardPaste,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Lock,
  ShieldAlert,
  ShieldCheck,
  TimerOff,
  Trash2,
  Unlock,
} from "lucide-react";
import {
  StegoError,
  VERSION_CTR_HMAC,
  VERSION_CTR_HMAC_TTL,
  VERSION_ENCRYPTED,
  VERSION_ENCRYPTED_TTL,
  VERSION_UNENCRYPTED_TTL,
} from "@/lib/crypto";
import { useSessionState } from "@/lib/sessionPersist";
import { detectPayload, revealMessage, RevealResult } from "@/lib/stego";
import { CountdownText } from "./CountdownBadge";

interface RevealPanelProps {
  stegoInput: string;
  onStegoInputChange: (value: string) => void;
  onShowToast: (message: string) => void;
}

export function RevealPanel({
  stegoInput,
  onStegoInputChange,
  onShowToast,
}: RevealPanelProps) {
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [error, setError] = useState<{
    message: string;
    isExpired: boolean;
  } | null>(null);
  const [revealed, setRevealed] = useSessionState<RevealResult | null>(
    "ghostink.reveal.result",
    null
  );
  const [copied, setCopied] = useState(false);

  const detection = useMemo(() => detectPayload(stegoInput), [stegoInput]);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      onStegoInputChange(text);
      setError(null);
      setRevealed(null);
      onShowToast("Pasted text from clipboard");
    } catch {
      onShowToast("Clipboard read blocked — paste manually with Ctrl+V");
    }
  };

  const handleClear = () => {
    onStegoInputChange("");
    setPassphrase("");
    setError(null);
    setRevealed(null);
  };

  const handleReveal = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setRevealed(null);
    setCopied(false);

    if (!detection.hasPayload) {
      setError({
        message: "No hidden payload found in the pasted text.",
        isExpired: false,
      });
      return;
    }

    if (detection.status === "encrypted" && !passphrase.length) {
      setError({
        message: `This payload is encrypted (0x${detection.versionByte?.toString(16).padStart(2, "0") ?? "01"}). Enter the passphrase to decrypt.`,
        isExpired: false,
      });
      return;
    }

    setIsDecrypting(true);
    try {
      const output = await revealMessage({
        stegoText: stegoInput,
        passphrase,
      });
      setRevealed(output);
    } catch (err) {
      if (err instanceof StegoError) {
        setError({
          message: err.message,
          isExpired: err.code === "PAYLOAD_EXPIRED",
        });
      } else {
        setError({
          message:
            "Incorrect passphrase or payload was corrupted/stripped by a messaging platform.",
          isExpired: false,
        });
      }
    } finally {
      setIsDecrypting(false);
    }
  };

  const handleCopySecret = async () => {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.secret);
      setCopied(true);
      onShowToast("Revealed secret copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onShowToast("Clipboard permission denied — select and copy manually");
    }
  };

  const versionBadge =
    detection.versionByte !== null
      ? `0x${detection.versionByte.toString(16).padStart(2, "0")}`
      : "ERR";

  return (
    <form onSubmit={handleReveal} className="space-y-6">
      {/* Pasted Textarea */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label
            htmlFor="reveal-stego-input"
            className="text-xs font-mono uppercase tracking-widest text-neutral-600 dark:text-white/60"
          >
            01 / Paste Suspect or Stego Text
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePaste}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/[0.04] dark:bg-white/5 border border-black/10 dark:border-white/10 text-[11px] font-mono uppercase tracking-wider text-neutral-600 dark:text-white/70 hover:text-neutral-950 dark:hover:text-white hover:border-black/20 dark:border-white/25 hover:bg-black/[0.06] dark:bg-white/10 transition-all cursor-pointer"
            >
              <ClipboardPaste className="w-3 h-3" />
              Paste
            </button>
            {stegoInput.length > 0 && (
              <button
                type="button"
                onClick={handleClear}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/[0.04] dark:bg-white/5 border border-black/10 dark:border-white/10 text-[11px] font-mono uppercase tracking-wider text-neutral-500 dark:text-white/55 hover:text-neutral-950 dark:hover:text-white hover:border-black/20 dark:border-white/25 transition-all cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                Clear
              </button>
            )}
          </div>
        </div>
        <textarea
          id="reveal-stego-input"
          rows={4}
          value={stegoInput}
          onChange={(e) => {
            onStegoInputChange(e.target.value);
            setError(null);
            setRevealed(null);
          }}
          placeholder="Paste text received from chat, email, or social media..."
          className="w-full rounded-2xl bg-white/80 dark:bg-black/40 border border-black/10 dark:border-white/10 px-4 py-3 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-400 dark:text-white/30 focus:outline-none focus:border-black/30 dark:border-white/35 focus:bg-neutral-100/90 dark:bg-black/60 transition-all resize-y subtle-scroll"
        />
      </div>

      {/* Auto-Detection Banner */}
      <AnimatePresence mode="wait">
        {stegoInput.length > 0 && (
          <motion.div
            key={`${detection.status}-${detection.hasTtl}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className={`rounded-2xl border px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              detection.status === "encrypted"
                ? "bg-black/[0.04] dark:bg-white/[0.05] border-black/15 dark:border-white/20"
                : detection.status === "unencrypted"
                  ? "bg-emerald-500/10 border-emerald-500/30"
                  : detection.status === "corrupted"
                    ? "bg-amber-500/10 border-amber-500/30"
                    : "bg-black/[0.02] dark:bg-white/[0.02] border-black/10 dark:border-white/10"
            }`}
          >
            <div className="flex items-start sm:items-center gap-3">
              {detection.status === "encrypted" && (
                <Lock className="w-4 h-4 text-neutral-900 dark:text-white shrink-0 mt-0.5 sm:mt-0" />
              )}
              {detection.status === "unencrypted" && (
                <Unlock className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5 sm:mt-0" />
              )}
              {detection.status === "corrupted" && (
                <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
              )}
              {detection.status === "none" && (
                <AlertCircle className="w-4 h-4 text-neutral-400 dark:text-white/40 shrink-0 mt-0.5 sm:mt-0" />
              )}

              <div>
                <p className="text-sm font-medium text-neutral-900 dark:text-white">
                  {detection.status === "encrypted" &&
                    `Encrypted Payload Detected (Header ${versionBadge})`}
                  {detection.status === "unencrypted" &&
                    `Unencrypted Payload Detected (Header ${versionBadge})`}
                  {detection.status === "corrupted" &&
                    "Damaged or Misaligned Zero-Width Sequence"}
                  {detection.status === "none" && "No Hidden Payload Found"}
                </p>
                <p className="text-xs text-neutral-500 dark:text-white/55 font-mono mt-0.5">
                  {detection.status === "encrypted" &&
                    `${detection.hiddenCharCount.toLocaleString()} ${
                      detection.encoding === "emoji-vs"
                        ? "variation selectors"
                        : "invisible chars"
                    } • ${detection.rawBytes} B • ${
                      detection.algorithm === "aes-ctr-hmac"
                        ? "AES-256-CTR + HMAC-SHA256"
                        : "AES-256-GCM"
                    } passphrase required${
                      detection.hasTtl ? " • Self-destruct TTL active" : ""
                    }`}
                  {detection.status === "unencrypted" &&
                    `${detection.hiddenCharCount.toLocaleString()} ${
                      detection.encoding === "emoji-vs"
                        ? "variation selectors"
                        : "invisible chars"
                    } • ${detection.rawBytes} B • Ready to decode${
                      detection.hasTtl ? " • Self-destruct TTL active" : ""
                    }`}
                  {detection.status === "corrupted" &&
                    `${detection.hiddenCharCount.toLocaleString()} invisible chars • ${
                      detection.isAligned
                        ? "Invalid header or truncated frame"
                        : "Bit alignment broken (chars stripped)"
                    }`}
                  {detection.status === "none" &&
                    "Zero steganographic Unicode characters (ZWSP/ZWNJ/ZWJ/WJ) detected."}
                </p>
              </div>
            </div>

            {detection.hasPayload && (
              <div className="self-start sm:self-center flex items-center gap-2 shrink-0">
                {detection.hasTtl && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-[10px] font-mono uppercase tracking-wider text-amber-700 dark:text-amber-300">
                    <Clock className="w-2.5 h-2.5" />
                    TTL
                  </span>
                )}
                <span className="px-3 py-1 rounded-full bg-white/90 dark:bg-black/50 border border-black/10 dark:border-white/10 text-[10px] font-mono uppercase tracking-widest text-neutral-700 dark:text-white/80">
                  {versionBadge}
                </span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Passphrase Input when 0x01/0x02 detected */}
      <AnimatePresence initial={false}>
        {detection.status === "encrypted" && (
          <motion.div
            key="reveal-passphrase"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="space-y-2.5 pt-1">
              <label
                htmlFor="reveal-passphrase-input"
                className="block text-xs font-mono uppercase tracking-widest text-neutral-600 dark:text-white/60"
              >
                02 / Decryption Passphrase
              </label>
              <div className="relative">
                <input
                  id="reveal-passphrase-input"
                  type={showPassphrase ? "text" : "password"}
                  value={passphrase}
                  onChange={(e) => {
                    setPassphrase(e.target.value);
                    setError(null);
                  }}
                  placeholder="Enter the passphrase used to lock this message..."
                  autoComplete="current-password"
                  className="w-full rounded-xl bg-white/90 dark:bg-black/50 border border-black/10 dark:border-white/10 pl-4 pr-11 py-3 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-400 dark:text-white/30 focus:outline-none focus:border-black/30 dark:border-white/35 transition-all"
                />
                <button
                  type="button"
                  aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"}
                  onClick={() => setShowPassphrase((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-neutral-500 dark:text-white/50 hover:text-neutral-950 dark:hover:text-white hover:bg-black/[0.06] dark:bg-white/10 transition-colors cursor-pointer"
                >
                  {showPassphrase ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error / Expired Banner */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className={`flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm ${
              error.isExpired
                ? "bg-amber-500/10 border-amber-500/35 text-amber-800 dark:text-amber-200"
                : "bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-200"
            }`}
          >
            {error.isExpired ? (
              <TimerOff className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            )}
            <span>{error.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reveal CTA */}
      <div>
        <button
          type="submit"
          disabled={isDecrypting || !stegoInput.length}
          className="inline-flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-black text-sm font-semibold tracking-wide shadow-lg shadow-black/15 hover:shadow-xl dark:shadow-[0_0_30px_rgba(255,255,255,0.16)] dark:hover:shadow-[0_0_50px_rgba(255,255,255,0.32)] hover:scale-[1.01] active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none transition-all cursor-pointer"
        >
          {isDecrypting ? (
            <>
              <span className="w-4 h-4 border-2 border-black/20 dark:border-white/25 border-t-white dark:border-black/25 dark:border-t-black rounded-full animate-spin" />
              <span>Deriving Key &amp; Verifying Tag...</span>
            </>
          ) : (
            <>
              <ShieldCheck className="w-4 h-4" />
              <span>
                {detection.status === "unencrypted"
                  ? `Decode Payload (${versionBadge})`
                  : "Decrypt & Reveal"}
              </span>
            </>
          )}
        </button>
      </div>

      {/* Revealed Secret Output */}
      <AnimatePresence>
        {revealed && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.25 }}
            className="rounded-3xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/15 dark:border-white/15 p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                <span className="text-xs font-mono uppercase tracking-widest text-neutral-800 dark:text-white/85">
                  Revealed Secret
                </span>
                {revealed.expiresAt !== null && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-[10px] font-mono text-amber-700 dark:text-amber-300">
                    <Clock className="w-2.5 h-2.5" />
                    <CountdownText
                      expiresAt={revealed.expiresAt}
                      prefix="Expires in "
                    />
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={handleCopySecret}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-black text-xs font-semibold uppercase tracking-wider hover:bg-neutral-800 dark:hover:bg-white/90 active:scale-95 transition-all cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy Secret
                  </>
                )}
              </button>
            </div>

            <div className="rounded-2xl bg-neutral-100/90 dark:bg-black/60 border border-black/10 dark:border-white/10 p-4 text-sm text-neutral-900 dark:text-white whitespace-pre-wrap break-words font-sans leading-relaxed select-all">
              {revealed.secret}
            </div>

            <p className="text-[11px] font-mono text-neutral-500 dark:text-white/45">
              Verified{" "}
              {revealed.version === VERSION_CTR_HMAC_TTL
                ? "AES-256-CTR + HMAC-SHA256 + TTL (0x05)"
                : revealed.version === VERSION_CTR_HMAC
                  ? "AES-256-CTR + HMAC-SHA256 (0x04)"
                  : revealed.version === VERSION_ENCRYPTED_TTL
                    ? "AES-256-GCM + TTL (0x02)"
                    : revealed.version === VERSION_UNENCRYPTED_TTL
                      ? "deflate-raw + TTL (0x03)"
                      : revealed.version === VERSION_ENCRYPTED
                        ? "AES-256-GCM (0x01)"
                        : "deflate-raw (0x00)"}{" "}
              • {revealed.hiddenCharCount.toLocaleString()}{" "}
              {revealed.encoding === "emoji-vs" ? "VS selectors" : "ZW chars"} →{" "}
              {revealed.framedBytes} B frame → {revealed.originalBytes} B UTF-8 plaintext
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </form>
  );
}
