"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Check,
  Clock,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
  Split,
  TimerOff,
  Unlock,
} from "lucide-react";
import {
  CIPHER_ALGORITHMS,
  CipherAlgorithm,
  StegoError,
  TTL_PRESETS,
  TtlPreset,
} from "@/lib/crypto";
import { useSessionState } from "@/lib/sessionPersist";
import {
  parseShardList,
  reconstructSecretFromShards,
  ReconstructResult,
  splitSecretIntoShards,
  SplitSecretResult,
} from "@/lib/shamir";
import { CountdownText } from "./CountdownBadge";

interface ShamirPanelProps {
  onShowToast: (message: string) => void;
}

export function ShamirPanel({ onShowToast }: ShamirPanelProps) {
  const [mode, setMode] = useSessionState<"split" | "reconstruct">(
    "ghostink.shamir.mode",
    "split"
  );

  // Split state
  const [secret, setSecret] = useSessionState("ghostink.shamir.secret", "");
  const [totalShares, setTotalShares] = useSessionState(
    "ghostink.shamir.total",
    3
  );
  const [threshold, setThreshold] = useSessionState(
    "ghostink.shamir.threshold",
    2
  );
  const [noPassword, setNoPassword] = useSessionState(
    "ghostink.shamir.noPass",
    false
  );
  const [algorithm, setAlgorithm] = useSessionState<CipherAlgorithm>(
    "ghostink.shamir.algo",
    "aes-gcm"
  );
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [ttlPreset, setTtlPreset] = useSessionState<TtlPreset>(
    "ghostink.shamir.ttl",
    "none"
  );
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);
  const [splitResult, setSplitResult] =
    useSessionState<SplitSecretResult | null>("ghostink.shamir.splitRes", null);
  const [copiedShardIdx, setCopiedShardIdx] = useState<number | null>(null);

  // Reconstruct state
  const [shardInput, setShardInput] = useSessionState(
    "ghostink.shamir.shardIn",
    ""
  );
  const [reconstructPass, setReconstructPass] = useState("");
  const [showReconstructPass, setShowReconstructPass] = useState(false);
  const [isCombining, setIsCombining] = useState(false);
  const [combineError, setCombineError] = useState<{
    message: string;
    isExpired: boolean;
  } | null>(null);
  const [reconstructed, setReconstructed] =
    useSessionState<ReconstructResult | null>("ghostink.shamir.recRes", null);
  const [copiedSecret, setCopiedSecret] = useState(false);

  const activeTtl = useMemo(
    () => TTL_PRESETS.find((p) => p.id === ttlPreset) ?? TTL_PRESETS[0],
    [ttlPreset]
  );

  const parsedInput = useMemo(() => parseShardList(shardInput), [shardInput]);
  const distinctIndices = useMemo(() => {
    const seen = new Set<number>();
    for (const s of parsedInput.valid) {
      seen.add(s.index);
    }
    return Array.from(seen).sort((a, b) => a - b);
  }, [parsedInput.valid]);

  const expectedThreshold = parsedInput.valid[0]?.threshold ?? null;
  const readyToUnlock =
    expectedThreshold !== null && distinctIndices.length >= expectedThreshold;

  const handleTotalChange = (nextTotal: number) => {
    setTotalShares(nextTotal);
    if (threshold > nextTotal) setThreshold(nextTotal);
  };

  const handleSplit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSplitError(null);
    setSplitResult(null);

    if (!secret.length) {
      setSplitError("Enter a secret to split into cryptographic shards.");
      return;
    }

    if (!noPassword && !passphrase.length) {
      setSplitError("Enter a passphrase or enable No-Password mode.");
      return;
    }

    setIsSplitting(true);
    try {
      const res = await splitSecretIntoShards({
        secret,
        passphrase,
        noPassword,
        threshold,
        totalShares,
        ttlSeconds: activeTtl.seconds,
        algorithm,
      });
      setSplitResult(res);
    } catch (err) {
      setSplitError(
        err instanceof StegoError ? err.message : "Failed to split secret."
      );
    } finally {
      setIsSplitting(false);
    }
  };

  const handleCopyShard = async (shard: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(shard);
      setCopiedShardIdx(idx);
      onShowToast(`Shard #${idx + 1} copied`);
      setTimeout(() => setCopiedShardIdx(null), 1800);
    } catch {
      onShowToast("Clipboard permission denied");
    }
  };

  const handleTestSubset = () => {
    if (!splitResult) return;
    const subset = splitResult.shards.slice(0, splitResult.threshold);
    setShardInput(subset.join("\n"));
    setMode("reconstruct");
    setCombineError(null);
    setReconstructed(null);
    onShowToast(
      `Loaded ${subset.length}-of-${splitResult.totalShares} shards into Reconstruct`
    );
  };

  const handleReconstruct = async (e: React.FormEvent) => {
    e.preventDefault();
    setCombineError(null);
    setReconstructed(null);
    setCopiedSecret(false);

    if (parsedInput.valid.length < 2) {
      setCombineError({
        message: "Paste at least 2 valid gi1 shards (one per line).",
        isExpired: false,
      });
      return;
    }

    setIsCombining(true);
    try {
      const res = await reconstructSecretFromShards({
        shardTokens: parsedInput.valid.map((s) => s.raw),
        passphrase: reconstructPass,
      });
      setReconstructed(res);
    } catch (err) {
      if (err instanceof StegoError) {
        setCombineError({
          message: err.message,
          isExpired: err.code === "PAYLOAD_EXPIRED",
        });
      } else {
        setCombineError({
          message: "Failed to reconstruct secret from shards.",
          isExpired: false,
        });
      }
    } finally {
      setIsCombining(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-mode Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-white tracking-tight">
            Shamir GF(256) Split-Key Vault
          </h2>
          <p className="text-xs text-neutral-500 dark:text-white/50">
            Split a secret across N channels—any single shard reveals zero mathematical data.
          </p>
        </div>

        <div className="inline-flex rounded-full bg-black/[0.04] dark:bg-white/5 border border-black/10 dark:border-white/10 p-1">
          <button
            type="button"
            onClick={() => setMode("split")}
            className={`px-4 py-1.5 rounded-full text-xs font-mono transition-all cursor-pointer ${
              mode === "split"
                ? "bg-neutral-900 text-white dark:bg-white dark:text-black font-semibold"
                : "text-neutral-600 dark:text-white/65 hover:text-neutral-950 dark:hover:text-white"
            }`}
          >
            Split Secret
          </button>
          <button
            type="button"
            onClick={() => setMode("reconstruct")}
            className={`px-4 py-1.5 rounded-full text-xs font-mono transition-all cursor-pointer ${
              mode === "reconstruct"
                ? "bg-neutral-900 text-white dark:bg-white dark:text-black font-semibold"
                : "text-neutral-600 dark:text-white/65 hover:text-neutral-950 dark:hover:text-white"
            }`}
          >
            Reconstruct
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {mode === "split" ? (
          <motion.form
            key="shamir-split"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            onSubmit={handleSplit}
            className="space-y-5"
          >
            {/* Quorum Config */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/10 dark:border-white/10 p-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-neutral-600 dark:text-white/60 uppercase tracking-wider">
                    Total Shards (N)
                  </span>
                  <span className="text-neutral-900 dark:text-white font-semibold">{totalShares}</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={8}
                  value={totalShares}
                  onChange={(e) => handleTotalChange(Number(e.target.value))}
                  className="w-full accent-neutral-900 dark:accent-white cursor-pointer"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-neutral-600 dark:text-white/60 uppercase tracking-wider">
                    Required Quorum (K)
                  </span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                    {threshold} of {totalShares}
                  </span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={totalShares}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="w-full accent-emerald-400 cursor-pointer"
                />
              </div>
            </div>

            {/* Secret Input */}
            <div className="space-y-2">
              <label
                htmlFor="shamir-secret"
                className="block text-xs font-mono uppercase tracking-widest text-neutral-600 dark:text-white/60"
              >
                Secret to Split
              </label>
              <textarea
                id="shamir-secret"
                rows={3}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Seed phrase, API root key, recovery note, or confidential payload..."
                className="w-full rounded-2xl bg-white/80 dark:bg-black/40 border border-black/10 dark:border-white/10 px-4 py-3 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-400 dark:text-white/30 focus:outline-none focus:border-black/30 dark:border-white/35 transition-all resize-y subtle-scroll"
              />
            </div>

            {/* Optional Encryption Layer & TTL */}
            <div className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/10 dark:border-white/10 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {noPassword ? (
                    <Unlock className="w-4 h-4 text-amber-700 dark:text-amber-300" />
                  ) : (
                    <Lock className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  )}
                  <span className="text-xs font-medium text-neutral-900 dark:text-white">
                    {noPassword
                      ? "Pure Shamir Split (No Extra Passphrase)"
                      : "Encrypted Layer + Shamir Split"}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setNoPassword((prev) => !prev)}
                  className="px-3 py-1 rounded-full bg-black/[0.04] dark:bg-white/5 border border-black/10 dark:border-white/10 text-[11px] font-mono text-neutral-700 dark:text-white/75 hover:text-neutral-950 dark:hover:text-white hover:border-black/20 dark:border-white/25 transition-all cursor-pointer"
                >
                  {noPassword ? "Enable Passphrase" : "Skip Passphrase"}
                </button>
              </div>

              {!noPassword && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {CIPHER_ALGORITHMS.map((cipher) => {
                      const selected = cipher.id === algorithm;
                      return (
                        <button
                          key={cipher.id}
                          type="button"
                          onClick={() => setAlgorithm(cipher.id)}
                          className={`text-left rounded-xl px-3.5 py-2 border text-xs font-mono transition-all cursor-pointer ${
                            selected
                              ? "bg-neutral-900 text-white dark:bg-white dark:text-black border-neutral-900 dark:border-white font-semibold"
                              : "bg-white/80 dark:bg-black/40 text-neutral-600 dark:text-white/70 border-black/10 dark:border-white/10 hover:border-black/20 dark:border-white/25"
                          }`}
                        >
                          {cipher.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="relative">
                    <input
                      type={showPassphrase ? "text" : "password"}
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="Optional passphrase lock inside shards..."
                      className="w-full rounded-xl bg-white/90 dark:bg-black/50 border border-black/10 dark:border-white/10 pl-4 pr-11 py-2.5 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-400 dark:text-white/30 focus:outline-none focus:border-black/30 dark:border-white/35"
                    />
                    <button
                      type="button"
                      aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"}
                      onClick={() => setShowPassphrase((p) => !p)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-neutral-500 dark:text-white/50 hover:text-neutral-950 dark:hover:text-white cursor-pointer"
                    >
                      {showPassphrase ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              <div className="pt-2 border-t border-black/10 dark:border-white/10 flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs text-neutral-600 dark:text-white/65">
                  <Clock className="w-3.5 h-3.5" />
                  Self-Destruct TTL
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {TTL_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setTtlPreset(preset.id)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-mono border cursor-pointer transition-all ${
                        ttlPreset === preset.id
                          ? "bg-neutral-900 text-white dark:bg-white dark:text-black border-neutral-900 dark:border-white font-semibold"
                          : "bg-black/[0.04] dark:bg-white/5 text-neutral-600 dark:text-white/60 border-black/10 dark:border-white/10 hover:text-neutral-950 dark:hover:text-white"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {splitError && (
              <div className="flex items-start gap-2.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <span>{splitError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSplitting}
              className="inline-flex items-center gap-2.5 px-7 py-3.5 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-black text-sm font-semibold shadow-lg shadow-black/15 hover:shadow-xl dark:shadow-[0_0_30px_rgba(255,255,255,0.16)] dark:hover:shadow-[0_0_50px_rgba(255,255,255,0.3)] active:scale-[0.98] disabled:opacity-50 transition-all cursor-pointer"
            >
              <Split className="w-4 h-4" />
              <span>
                {isSplitting
                  ? "Generating Shards..."
                  : `Split into ${threshold}-of-${totalShares} Shards`}
              </span>
            </button>

            {splitResult && (
              <div className="rounded-3xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/15 dark:border-white/15 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-mono uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                        {splitResult.threshold}-of-{splitResult.totalShares} Shards Ready
                      </p>
                      {splitResult.expiresAt !== null && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-[10px] font-mono text-amber-700 dark:text-amber-300">
                          <Clock className="w-2.5 h-2.5" />
                          <CountdownText
                            expiresAt={splitResult.expiresAt}
                            prefix="Expires in "
                          />
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] font-mono text-neutral-500 dark:text-white/45 mt-0.5">
                      Distribute each shard over a separate channel (WhatsApp, Email, Slack).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleTestSubset}
                    className="px-3.5 py-1.5 rounded-full bg-black/[0.06] dark:bg-white/10 border border-black/15 dark:border-white/15 text-[11px] font-mono uppercase tracking-wider text-neutral-900 dark:text-white hover:bg-black/10 dark:bg-white/15 cursor-pointer"
                  >
                    Test {splitResult.threshold} Shards in Reconstruct
                  </button>
                </div>

                <div className="space-y-2.5">
                  {splitResult.shards.map((shard, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-3 rounded-2xl bg-neutral-50/90 dark:bg-black/55 border border-black/10 dark:border-white/10 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 dark:text-white/45">
                          Shard #{idx + 1}
                        </span>
                        <p className="text-xs font-mono text-neutral-800 dark:text-white/90 truncate mt-0.5 select-all">
                          {shard}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopyShard(shard, idx)}
                        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-black text-[11px] font-semibold cursor-pointer"
                      >
                        {copiedShardIdx === idx ? (
                          <>
                            <Check className="w-3 h-3" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.form>
        ) : (
          <motion.form
            key="shamir-reconstruct"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            onSubmit={handleReconstruct}
            className="space-y-5"
          >
            <div className="space-y-2">
              <label
                htmlFor="shamir-shards-input"
                className="block text-xs font-mono uppercase tracking-widest text-neutral-600 dark:text-white/60"
              >
                Paste Shards (One gi1... Token Per Line)
              </label>
              <textarea
                id="shamir-shards-input"
                rows={4}
                value={shardInput}
                onChange={(e) => {
                  setShardInput(e.target.value);
                  setCombineError(null);
                }}
                placeholder={"gi1.2.1....\ngi1.2.3...."}
                className="w-full rounded-2xl bg-white/80 dark:bg-black/40 border border-black/10 dark:border-white/10 px-4 py-3 text-xs font-mono text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-400 dark:text-white/30 focus:outline-none focus:border-black/30 dark:border-white/35 transition-all resize-y subtle-scroll"
              />
            </div>

            {parsedInput.valid.length > 0 && (
              <div
                className={`rounded-2xl border px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs font-mono ${
                  readyToUnlock
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-200"
                    : "bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-200"
                }`}
              >
                <span>
                  Detected {distinctIndices.length} of {expectedThreshold ?? "?"} required shards (
                  {distinctIndices.map((i) => `#${i}`).join(", ")})
                </span>
                <span>{readyToUnlock ? "Quorum met" : "Need more shards"}</span>
              </div>
            )}

            <div className="space-y-2">
              <label
                htmlFor="shamir-reconstruct-pass"
                className="block text-xs font-mono uppercase tracking-widest text-neutral-600 dark:text-white/60"
              >
                Passphrase (Leave blank if split without password)
              </label>
              <div className="relative">
                <input
                  id="shamir-reconstruct-pass"
                  type={showReconstructPass ? "text" : "password"}
                  value={reconstructPass}
                  onChange={(e) => setReconstructPass(e.target.value)}
                  placeholder="Enter passphrase if shards were encrypted..."
                  className="w-full rounded-xl bg-white/90 dark:bg-black/50 border border-black/10 dark:border-white/10 pl-4 pr-11 py-2.5 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-400 dark:text-white/30 focus:outline-none focus:border-black/30 dark:border-white/35"
                />
                <button
                  type="button"
                  aria-label={showReconstructPass ? "Hide passphrase" : "Show passphrase"}
                  onClick={() => setShowReconstructPass((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-neutral-500 dark:text-white/50 hover:text-neutral-950 dark:hover:text-white cursor-pointer"
                >
                  {showReconstructPass ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {combineError && (
              <div
                className={`flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm ${
                  combineError.isExpired
                    ? "bg-amber-500/10 border-amber-500/35 text-amber-800 dark:text-amber-200"
                    : "bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-200"
                }`}
              >
                {combineError.isExpired ? (
                  <TimerOff className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                )}
                <span>{combineError.message}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isCombining || !shardInput.trim().length}
              className="inline-flex items-center gap-2.5 px-7 py-3.5 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-black text-sm font-semibold shadow-lg shadow-black/15 hover:shadow-xl dark:shadow-[0_0_30px_rgba(255,255,255,0.16)] dark:hover:shadow-[0_0_50px_rgba(255,255,255,0.3)] active:scale-[0.98] disabled:opacity-40 transition-all cursor-pointer"
            >
              <KeyRound className="w-4 h-4" />
              <span>
                {isCombining ? "Interpolating GF(256)..." : "Reconstruct Secret"}
              </span>
            </button>

            {reconstructed && (
              <div className="rounded-3xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/15 dark:border-white/15 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-xs font-mono uppercase tracking-widest text-neutral-900 dark:text-white">
                      Reconstructed Secret ({reconstructed.usedShards}-of-N Quorum)
                    </span>
                    {reconstructed.expiresAt !== null && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-[10px] font-mono text-amber-700 dark:text-amber-300">
                        <Clock className="w-2.5 h-2.5" />
                        <CountdownText
                          expiresAt={reconstructed.expiresAt}
                          prefix="Expires in "
                        />
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(reconstructed.secret);
                      setCopiedSecret(true);
                      onShowToast("Reconstructed secret copied");
                      setTimeout(() => setCopiedSecret(false), 1800);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-black text-xs font-semibold cursor-pointer"
                  >
                    {copiedSecret ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy
                      </>
                    )}
                  </button>
                </div>

                <div className="rounded-2xl bg-neutral-100/90 dark:bg-black/60 border border-black/10 dark:border-white/10 p-4 text-sm text-neutral-900 dark:text-white whitespace-pre-wrap break-words select-all">
                  {reconstructed.secret}
                </div>
              </div>
            )}
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
