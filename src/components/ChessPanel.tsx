"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Check,
  Clock,
  Copy,
  Crown,
  Eye,
  EyeOff,
  Lock,
  ShieldCheck,
  TimerOff,
  Unlock,
} from "lucide-react";
import {
  ChessDecodeResult,
  ChessEncodeResult,
  decodeSecretFromPgn,
  encodeSecretToPgn,
} from "@/lib/chessCipher";
import {
  CIPHER_ALGORITHMS,
  CipherAlgorithm,
  StegoError,
  TTL_PRESETS,
  TtlPreset,
} from "@/lib/crypto";
import { useSessionState } from "@/lib/sessionPersist";
import { CountdownText } from "./CountdownBadge";

interface PersistedChessEncode extends Omit<ChessEncodeResult, "finalBoard"> {
  finalBoard: number[];
}

interface PersistedChessDecode extends Omit<ChessDecodeResult, "finalBoard"> {
  finalBoard: number[];
}

interface ChessPanelProps {
  onShowToast: (message: string) => void;
}

const PIECE_GLYPHS: Record<number, string> = {
  1: "♙",
  2: "♘",
  3: "♗",
  4: "♖",
  5: "♕",
  6: "♔",
  [-1]: "♟",
  [-2]: "♞",
  [-3]: "♝",
  [-4]: "♜",
  [-5]: "♛",
  [-6]: "♚",
};

function MiniChessBoard({ squares }: { squares: number[] | Int8Array }) {
  const ranks = [7, 6, 5, 4, 3, 2, 1, 0];
  const files = [0, 1, 2, 3, 4, 5, 6, 7];

  return (
    <div className="inline-grid grid-cols-8 rounded-xl overflow-hidden border border-black/15 dark:border-white/15 shadow-xl select-none">
      {ranks.map((r) =>
        files.map((f) => {
          const isLight = (r + f) % 2 === 1;
          const piece = squares[r * 8 + f];
          return (
            <div
              key={`${r}-${f}`}
              className={`w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center text-sm sm:text-base leading-none ${
                isLight ? "bg-neutral-100 dark:bg-white/15" : "bg-neutral-300 dark:bg-black/70"
              } ${piece > 0 ? "text-neutral-900 dark:text-white" : "text-emerald-700 dark:text-emerald-300/90"}`}
            >
              {piece !== 0 ? PIECE_GLYPHS[piece] : ""}
            </div>
          );
        })
      )}
    </div>
  );
}

export function ChessPanel({ onShowToast }: ChessPanelProps) {
  const [mode, setMode] = useSessionState<"encode" | "decode">(
    "ghostink.chess.mode",
    "encode"
  );

  // Encode state
  const [secret, setSecret] = useSessionState("ghostink.chess.secret", "");
  const [whiteName, setWhiteName] = useSessionState(
    "ghostink.chess.white",
    "Tal"
  );
  const [blackName, setBlackName] = useSessionState(
    "ghostink.chess.black",
    "Fischer"
  );
  const [noPassword, setNoPassword] = useSessionState(
    "ghostink.chess.noPass",
    false
  );
  const [algorithm, setAlgorithm] = useSessionState<CipherAlgorithm>(
    "ghostink.chess.algo",
    "aes-gcm"
  );
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [ttlPreset, setTtlPreset] = useSessionState<TtlPreset>(
    "ghostink.chess.ttl",
    "none"
  );
  const [isEncoding, setIsEncoding] = useState(false);
  const [encodeError, setEncodeError] = useState<string | null>(null);
  const [encoded, setEncoded] = useSessionState<PersistedChessEncode | null>(
    "ghostink.chess.encRes",
    null
  );
  const [copiedPgn, setCopiedPgn] = useState(false);

  // Decode state
  const [pgnInput, setPgnInput] = useSessionState("ghostink.chess.pgnIn", "");
  const [decodePass, setDecodePass] = useState("");
  const [showDecodePass, setShowDecodePass] = useState(false);
  const [isDecoding, setIsDecoding] = useState(false);
  const [decodeError, setDecodeError] = useState<{
    message: string;
    isExpired: boolean;
  } | null>(null);
  const [decoded, setDecoded] = useSessionState<PersistedChessDecode | null>(
    "ghostink.chess.decRes",
    null
  );
  const [copiedSecret, setCopiedSecret] = useState(false);

  const activeTtl = useMemo(
    () => TTL_PRESETS.find((p) => p.id === ttlPreset) ?? TTL_PRESETS[0],
    [ttlPreset]
  );

  const handleEncode = async (e: React.FormEvent) => {
    e.preventDefault();
    setEncodeError(null);
    setEncoded(null);
    setCopiedPgn(false);

    if (!secret.length) {
      setEncodeError("Enter a secret to disguise as a chess match.");
      return;
    }

    if (!noPassword && !passphrase.length) {
      setEncodeError("Enter a passphrase or enable No-Password mode.");
      return;
    }

    setIsEncoding(true);
    try {
      const res = await encodeSecretToPgn({
        secret,
        passphrase,
        noPassword,
        ttlSeconds: activeTtl.seconds,
        algorithm,
        whiteName,
        blackName,
      });
      setEncoded({
        ...res,
        finalBoard: Array.from(res.finalBoard),
      });
    } catch (err) {
      setEncodeError(
        err instanceof StegoError ? err.message : "Failed to encode chess PGN."
      );
    } finally {
      setIsEncoding(false);
    }
  };

  const handleDecode = async (e: React.FormEvent) => {
    e.preventDefault();
    setDecodeError(null);
    setDecoded(null);
    setCopiedSecret(false);

    if (!pgnInput.trim().length) {
      setDecodeError({
        message: "Paste a PGN chess match to decode.",
        isExpired: false,
      });
      return;
    }

    setIsDecoding(true);
    try {
      const res = await decodeSecretFromPgn({
        pgn: pgnInput,
        passphrase: decodePass,
      });
      setDecoded({
        ...res,
        finalBoard: Array.from(res.finalBoard),
      });
    } catch (err) {
      if (err instanceof StegoError) {
        setDecodeError({
          message: err.message,
          isExpired: err.code === "PAYLOAD_EXPIRED",
        });
      } else {
        setDecodeError({
          message: "Failed to decode chess PGN.",
          isExpired: false,
        });
      }
    } finally {
      setIsDecoding(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-mode Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-white tracking-tight">
            Chess Game Cipher (Legal PGN Disguise)
          </h2>
          <p className="text-xs text-neutral-500 dark:text-white/50">
            Zero invisible chars—your encrypted payload becomes a 100% legal chess match.
          </p>
        </div>

        <div className="inline-flex rounded-full bg-black/[0.04] dark:bg-white/5 border border-black/10 dark:border-white/10 p-1">
          <button
            type="button"
            onClick={() => setMode("encode")}
            className={`px-4 py-1.5 rounded-full text-xs font-mono transition-all cursor-pointer ${
              mode === "encode"
                ? "bg-neutral-900 text-white dark:bg-white dark:text-black font-semibold"
                : "text-neutral-600 dark:text-white/65 hover:text-neutral-950 dark:hover:text-white"
            }`}
          >
            Encode PGN
          </button>
          <button
            type="button"
            onClick={() => setMode("decode")}
            className={`px-4 py-1.5 rounded-full text-xs font-mono transition-all cursor-pointer ${
              mode === "decode"
                ? "bg-neutral-900 text-white dark:bg-white dark:text-black font-semibold"
                : "text-neutral-600 dark:text-white/65 hover:text-neutral-950 dark:hover:text-white"
            }`}
          >
            Decode PGN
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {mode === "encode" ? (
          <motion.form
            key="chess-encode"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            onSubmit={handleEncode}
            className="space-y-5"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="chess-white"
                  className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 dark:text-white/50"
                >
                  White Player Tag
                </label>
                <input
                  id="chess-white"
                  type="text"
                  value={whiteName}
                  onChange={(e) => setWhiteName(e.target.value)}
                  className="w-full rounded-xl bg-white/80 dark:bg-black/40 border border-black/10 dark:border-white/10 px-3.5 py-2 text-sm text-neutral-900 dark:text-white focus:outline-none focus:border-black/30 dark:border-white/35"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="chess-black"
                  className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 dark:text-white/50"
                >
                  Black Player Tag
                </label>
                <input
                  id="chess-black"
                  type="text"
                  value={blackName}
                  onChange={(e) => setBlackName(e.target.value)}
                  className="w-full rounded-xl bg-white/80 dark:bg-black/40 border border-black/10 dark:border-white/10 px-3.5 py-2 text-sm text-neutral-900 dark:text-white focus:outline-none focus:border-black/30 dark:border-white/35"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="chess-secret"
                className="block text-xs font-mono uppercase tracking-widest text-neutral-600 dark:text-white/60"
              >
                Secret Message
              </label>
              <textarea
                id="chess-secret"
                rows={3}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Type a message to transform into a real chess game..."
                className="w-full rounded-2xl bg-white/80 dark:bg-black/40 border border-black/10 dark:border-white/10 px-4 py-3 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-400 dark:text-white/30 focus:outline-none focus:border-black/30 dark:border-white/35 transition-all resize-y subtle-scroll"
              />
            </div>

            {/* Encryption & TTL */}
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
                      ? "Unencrypted PGN Encoding"
                      : "Encrypted PGN Encoding"}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setNoPassword((p) => !p)}
                  className="px-3 py-1 rounded-full bg-black/[0.04] dark:bg-white/5 border border-black/10 dark:border-white/10 text-[11px] font-mono text-neutral-700 dark:text-white/75 hover:text-neutral-950 dark:hover:text-white cursor-pointer"
                >
                  {noPassword ? "Enable Passphrase" : "No Password"}
                </button>
              </div>

              {!noPassword && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {CIPHER_ALGORITHMS.map((cipher) => (
                      <button
                        key={cipher.id}
                        type="button"
                        onClick={() => setAlgorithm(cipher.id)}
                        className={`text-left rounded-xl px-3.5 py-2 border text-xs font-mono transition-all cursor-pointer ${
                          algorithm === cipher.id
                            ? "bg-neutral-900 text-white dark:bg-white dark:text-black border-neutral-900 dark:border-white font-semibold"
                            : "bg-white/80 dark:bg-black/40 text-neutral-600 dark:text-white/70 border-black/10 dark:border-white/10 hover:border-black/20 dark:border-white/25"
                        }`}
                      >
                        {cipher.label}
                      </button>
                    ))}
                  </div>

                  <div className="relative">
                    <input
                      type={showPassphrase ? "text" : "password"}
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="Passphrase..."
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

            {encodeError && (
              <div className="flex items-start gap-2.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <span>{encodeError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isEncoding}
              className="inline-flex items-center gap-2.5 px-7 py-3.5 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-black text-sm font-semibold shadow-lg shadow-black/15 hover:shadow-xl dark:shadow-[0_0_30px_rgba(255,255,255,0.16)] dark:hover:shadow-[0_0_50px_rgba(255,255,255,0.3)] active:scale-[0.98] disabled:opacity-50 transition-all cursor-pointer"
            >
              <Crown className="w-4 h-4" />
              <span>
                {isEncoding ? "Generating Chess Match..." : "Encode as PGN Match"}
              </span>
            </button>

            {encoded && (
              <div className="rounded-3xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/15 dark:border-white/15 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-mono uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                        {encoded.moveCount} Legal Plies • {encoded.gameCount}{" "}
                        {encoded.gameCount === 1 ? "Game" : "Games"}
                      </p>
                      {encoded.expiresAt !== null && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-[10px] font-mono text-amber-700 dark:text-amber-300">
                          <Clock className="w-2.5 h-2.5" />
                          <CountdownText
                            expiresAt={encoded.expiresAt}
                            prefix="Expires in "
                          />
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] font-mono text-neutral-500 dark:text-white/45 mt-0.5">
                      Survives screenshots, OCR, SMS, and any zero-width scrubber.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPgnInput(encoded.pgn);
                        setMode("decode");
                        setDecodeError(null);
                        setDecoded(null);
                      }}
                      className="px-3 py-1.5 rounded-full bg-black/[0.06] dark:bg-white/10 border border-black/15 dark:border-white/15 text-[11px] font-mono text-neutral-900 dark:text-white hover:bg-black/10 dark:bg-white/15 cursor-pointer"
                    >
                      Test in Decode
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await navigator.clipboard.writeText(encoded.pgn);
                        setCopiedPgn(true);
                        onShowToast("PGN chess match copied");
                        setTimeout(() => setCopiedPgn(false), 1800);
                      }}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-black text-xs font-semibold cursor-pointer"
                    >
                      {copiedPgn ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          Copy PGN
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col md:flex-row gap-4 items-center md:items-start">
                  <MiniChessBoard squares={encoded.finalBoard} />
                  <pre className="flex-1 w-full max-h-[224px] overflow-y-auto subtle-scroll rounded-2xl bg-neutral-100/90 dark:bg-black/60 border border-black/10 dark:border-white/10 p-4 text-xs font-mono text-neutral-800 dark:text-white/85 whitespace-pre-wrap select-all">
                    {encoded.pgn}
                  </pre>
                </div>
              </div>
            )}
          </motion.form>
        ) : (
          <motion.form
            key="chess-decode"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            onSubmit={handleDecode}
            className="space-y-5"
          >
            <div className="space-y-2">
              <label
                htmlFor="chess-pgn-input"
                className="block text-xs font-mono uppercase tracking-widest text-neutral-600 dark:text-white/60"
              >
                Paste Chess PGN Match
              </label>
              <textarea
                id="chess-pgn-input"
                rows={5}
                value={pgnInput}
                onChange={(e) => {
                  setPgnInput(e.target.value);
                  setDecodeError(null);
                }}
                placeholder={'[Event "Casual Match 1"]\n1. e4 c5 2. Nf3 ...'}
                className="w-full rounded-2xl bg-white/80 dark:bg-black/40 border border-black/10 dark:border-white/10 px-4 py-3 text-xs font-mono text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-400 dark:text-white/30 focus:outline-none focus:border-black/30 dark:border-white/35 transition-all resize-y subtle-scroll"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="chess-decode-pass"
                className="block text-xs font-mono uppercase tracking-widest text-neutral-600 dark:text-white/60"
              >
                Passphrase (Leave blank if unencrypted)
              </label>
              <div className="relative">
                <input
                  id="chess-decode-pass"
                  type={showDecodePass ? "text" : "password"}
                  value={decodePass}
                  onChange={(e) => setDecodePass(e.target.value)}
                  placeholder="Enter passphrase if encrypted..."
                  className="w-full rounded-xl bg-white/90 dark:bg-black/50 border border-black/10 dark:border-white/10 pl-4 pr-11 py-2.5 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-400 dark:text-white/30 focus:outline-none focus:border-black/30 dark:border-white/35"
                />
                <button
                  type="button"
                  aria-label={showDecodePass ? "Hide passphrase" : "Show passphrase"}
                  onClick={() => setShowDecodePass((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-neutral-500 dark:text-white/50 hover:text-neutral-950 dark:hover:text-white cursor-pointer"
                >
                  {showDecodePass ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {decodeError && (
              <div
                className={`flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm ${
                  decodeError.isExpired
                    ? "bg-amber-500/10 border-amber-500/35 text-amber-800 dark:text-amber-200"
                    : "bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-200"
                }`}
              >
                {decodeError.isExpired ? (
                  <TimerOff className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                )}
                <span>{decodeError.message}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isDecoding || !pgnInput.trim().length}
              className="inline-flex items-center gap-2.5 px-7 py-3.5 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-black text-sm font-semibold shadow-lg shadow-black/15 hover:shadow-xl dark:shadow-[0_0_30px_rgba(255,255,255,0.16)] dark:hover:shadow-[0_0_50px_rgba(255,255,255,0.3)] active:scale-[0.98] disabled:opacity-40 transition-all cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>
                {isDecoding ? "Replaying Board..." : "Replay & Decode Secret"}
              </span>
            </button>

            {decoded && (
              <div className="rounded-3xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/15 dark:border-white/15 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                    <span className="text-xs font-mono uppercase tracking-widest text-neutral-900 dark:text-white">
                      Decoded from {decoded.moveCount} Legal Plies
                    </span>
                    {decoded.expiresAt !== null && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-[10px] font-mono text-amber-700 dark:text-amber-300">
                        <Clock className="w-2.5 h-2.5" />
                        <CountdownText
                          expiresAt={decoded.expiresAt}
                          prefix="Expires in "
                        />
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(decoded.secret);
                      setCopiedSecret(true);
                      onShowToast("Decoded secret copied");
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

                <div className="flex flex-col md:flex-row gap-4 items-center md:items-start">
                  <MiniChessBoard squares={decoded.finalBoard} />
                  <div className="flex-1 w-full rounded-2xl bg-neutral-100/90 dark:bg-black/60 border border-black/10 dark:border-white/10 p-4 text-sm text-neutral-900 dark:text-white whitespace-pre-wrap break-words select-all">
                    {decoded.secret}
                  </div>
                </div>
              </div>
            )}
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
