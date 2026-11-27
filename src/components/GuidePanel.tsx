"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  ChevronDown,
  Crown,
  Eye,
  Lock,
  Pause,
  Play,
  Radio,
  ScanSearch,
  Split,
} from "lucide-react";

export type GuideTargetTab =
  | "hide"
  | "reveal"
  | "xray"
  | "shamir"
  | "chess"
  | "whisper";

interface GuidePanelProps {
  onNavigateTab: (tab: GuideTargetTab) => void;
}

interface PipelineStage {
  label: string;
  chip: string;
  detail: string;
}

interface ModeGuide {
  id: GuideTargetTab;
  label: string;
  tagline: string;
  icon: typeof Lock;
  stages: [PipelineStage, PipelineStage, PipelineStage, PipelineStage];
  steps: [string, string, string];
  tip: string;
}

const MODES: ModeGuide[] = [
  {
    id: "hide",
    label: "Hide",
    tagline: "Compress, encrypt, and weave secrets invisibly inside text or one emoji.",
    icon: Lock,
    stages: [
      {
        label: "Secret + TTL",
        chip: '"Meet @ 5"',
        detail: "Optional 8-byte UTC self-destruct timer is prepended before compression.",
      },
      {
        label: "Deflate + AEAD",
        chip: "AES-256-GCM",
        detail: "deflate-raw shrinks payload; 250k PBKDF2 + AES-GCM (or CTR+HMAC) seals frame 0x01.",
      },
      {
        label: "Unicode Cloak",
        chip: "ZWSP..WJ / VS",
        detail: "Encodes bytes as 4 zero-width chars/byte or 2 compact Variation Selectors/byte.",
      },
      {
        label: "Safe Anchor",
        chip: "Hey [..] team",
        detail: "Injects payload between word 1 & word 2 (or 1 emoji) so copy-paste won't trim it.",
      },
    ],
    steps: [
      "Enter a secret, choose Zero-Width (sentence) or Single Emoji (50% shorter), and set a passphrase.",
      "Pick a cover sentence with 2+ words (for Zero-Width) or a carrier emoji, plus an optional TTL timer.",
      "Check the green Platform Limit bars, copy the output, and send it naturally.",
    ],
    tip: "Strict apps like WhatsApp or X may strip invisible chars — switch to Single Emoji or Chess PGN there.",
  },
  {
    id: "reveal",
    label: "Reveal",
    tagline: "Auto-detect invisible carriers, verify integrity, and unlock your secret.",
    icon: Eye,
    stages: [
      {
        label: "Paste Cover",
        chip: "👻 / text",
        detail: "Inspects pasted text synchronously; ignores stray 1-char joiners in emojis like 👨‍💻.",
      },
      {
        label: "Detect Header",
        chip: "0x01 • AES-GCM",
        detail: "Reads the first byte to identify cipher, No-Pass mode, TTL presence, and alignment.",
      },
      {
        label: "Verify & Decrypt",
        chip: "250k PBKDF2",
        detail: "Re-derives key with embedded 16B salt and verifies the GCM/HMAC authentication tag.",
      },
      {
        label: "TTL & Inflate",
        chip: "Plaintext",
        detail: "Rejects expired timestamps (PAYLOAD_EXPIRED) and decompresses valid secrets cleanly.",
      },
    ],
    steps: [
      "Paste any received message or single carrier emoji into the Reveal input box.",
      "Confirm the live detection pill (cipher mode, alignment, and self-destruct status).",
      "Enter the passphrase if locked and click Decrypt & Reveal.",
    ],
    tip: "Wrong passphrases or edited characters trigger DECRYPT_FAILED instead of corrupted text.",
  },
  {
    id: "xray",
    label: "X-Ray",
    tagline: "Expose hidden Unicode tokens inline and strip trackers in one click.",
    icon: ScanSearch,
    stages: [
      {
        label: "Scan String",
        chip: "UTF-16 stream",
        detail: "Walks every code point to separate visible graphemes from hidden formatting marks.",
      },
      {
        label: "Tokenize Marks",
        chip: "[ZWSP] [VS4]",
        detail: "Highlights invisible U+200B..U+2060 symbols and U+FE00..U+FE0F Variation Selectors.",
      },
      {
        label: "Audit Safety",
        chip: "edgeExposed",
        detail: "Counts visible graphemes via Intl.Segmenter and flags risky leading/trailing glyphs.",
      },
      {
        label: "Sanitize",
        chip: "Clean Copy",
        detail: "Strips all hidden stego code points cleanly while keeping readable text intact.",
      },
    ],
    steps: [
      "Paste any suspicious message or copied text into X-Ray.",
      "Inspect highlighted zero-width or Variation Selector chips inline.",
      "Click Copy Clean Text to strip invisible payloads cleanly.",
    ],
    tip: "Use X-Ray to check whether an app preserved your hidden payload before sending.",
  },
  {
    id: "shamir",
    label: "Split Vault",
    tagline: "Split a secret into N shards over GF(2^8) where any K unlock it.",
    icon: Split,
    stages: [
      {
        label: "Frame Secret",
        chip: "Deflate + GCM",
        detail: "Compresses and optionally encrypts your secret + TTL into a unified byte frame.",
      },
      {
        label: "Polynomials",
        chip: "deg(f) = K-1",
        detail: "Generates a random degree K-1 polynomial per byte over GF(2^8) modulo 0x11B.",
      },
      {
        label: "Mint N Shards",
        chip: "gi1.3.1.xK..",
        detail: "Evaluates f(1)..f(N) via Horner's method — fewer than K shards reveal zero bits.",
      },
      {
        label: "Lagrange x=0",
        chip: "Recovered",
        detail: "Paste any K distinct shards to interpolate f(0) and unpack the original secret.",
      },
    ],
    steps: [
      "Enter your secret, set Total Shares (N) and Threshold (K), plus an optional passphrase.",
      "Distribute each gi1.<K>.<index>.<payload> token to different backups or people.",
      "To recover later, switch to Reconstruct and paste any K shards from the same split.",
    ],
    tip: "Even with K-1 shards, an attacker learns mathematically zero information about your secret.",
  },
  {
    id: "chess",
    label: "Chess PGN",
    tagline: "Hide encrypted secrets inside 100% legal chess games with zero hidden chars.",
    icon: Crown,
    stages: [
      {
        label: "Length + Frame",
        chip: "[len16][frame]",
        detail: "Prefixes a 16-bit byte length onto the compressed/encrypted binary frame.",
      },
      {
        label: "Rank Moves",
        chip: "M legal moves",
        detail: "Computes all legal FIDE moves at the current board and sorts canonically.",
      },
      {
        label: "Pack Variable Bits",
        chip: "4–5 bits/ply",
        detail: "Reads floor(log2 M) bits from the stream and picks move[value] (e.g. Nf3, e4).",
      },
      {
        label: "Emit Legal PGN",
        chip: "1. e4 c5 ...",
        detail: "Resets cleanly after 80 plies into Casual Match 2..N until all bits are packed.",
      },
    ],
    steps: [
      "Enter your secret and passphrase in Encode mode (optional player names).",
      "Copy the generated ASCII PGN games — there are zero invisible characters anywhere.",
      "To recover, paste all PGN games in Decode mode with the same passphrase.",
    ],
    tip: "Because it's pure printable text, Chess PGN survives SMS, email, copy-paste, and OCR.",
  },
  {
    id: "whisper",
    label: "P2P Whisper",
    tagline: "Direct browser-to-browser encrypted chat with WebRTC and burning timers.",
    icon: Radio,
    stages: [
      {
        label: "Signal Swap",
        chip: "GHOST-INVITE",
        detail: "Host bundles WebRTC ICE/SDP + ephemeral ECDH P-256 public JWK into one token.",
      },
      {
        label: "ECDH Key Gen",
        chip: "AES-256-GCM",
        detail: "Peer returns GHOST-ANSWER; both derive an identical session key + SHA-256 fingerprint.",
      },
      {
        label: "Chunked Wire",
        chip: "24k slices",
        detail: "Encrypts messages, reactions & up to 4MB files with fresh 12B IVs across DataChannels.",
      },
      {
        label: "Burn on Read",
        chip: "0 history",
        detail: "Live 1s ticker expires timed messages; closing the tab wipes volatile session memory.",
      },
    ],
    steps: [
      "Host clicks Create Invite and sends GHOST-INVITE-... to the peer.",
      "Peer imports the invite, sends back GHOST-ANSWER-..., and Host connects.",
      "Match the 6-byte Safety Fingerprint together, then chat directly peer-to-peer.",
    ],
    tip: "Zero signaling servers or databases — messages never touch any backend.",
  },
];

const QUICK_SPEC = [
  { code: "0x00 / 0x03", desc: "Unencrypted deflate-raw (+ optional 8B TTL)" },
  { code: "0x01 / 0x02", desc: "PBKDF2 (250k) + AES-256-GCM AEAD (min 45 B)" },
  { code: "0x04 / 0x05", desc: "PBKDF2 (512b) + AES-256-CTR + HMAC-SHA256 (min 66 B)" },
  { code: "Base-4 ZW", desc: "00=U+200B, 01=U+200C, 10=U+200D, 11=U+2060 (4 ch/byte)" },
  { code: "Base-16 VS", desc: "U+FE00..U+FE0F nibbles bound onto 1 emoji (2 ch/byte)" },
];

export function GuidePanel({ onNavigateTab }: GuidePanelProps) {
  const [selectedId, setSelectedId] = useState<GuideTargetTab>("hide");
  const [activeStage, setActiveStage] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [showSpec, setShowSpec] = useState(false);

  const mode = MODES.find((m) => m.id === selectedId) ?? MODES[0];
  const currentStage = mode.stages[activeStage];

  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setInterval(() => {
      setActiveStage((prev) => (prev + 1) % 4);
    }, 1900);
    return () => window.clearInterval(id);
  }, [isPlaying, selectedId]);

  const handleSelectMode = (id: GuideTargetTab) => {
    setSelectedId(id);
    setActiveStage(0);
    setIsPlaying(true);
  };

  return (
    <div className="space-y-6">
      {/* Minimal Header + Mode Selector */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-xs sm:text-sm text-neutral-600 dark:text-white/60">
            Select a module to watch its live pipeline and 3-step workflow.
          </p>
          <button
            type="button"
            onClick={() => onNavigateTab(mode.id)}
            className="inline-flex items-center gap-1.5 self-start sm:self-auto px-3.5 py-1.5 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-black text-xs font-medium shadow-sm hover:opacity-90 transition-opacity cursor-pointer"
          >
            <span>Open {mode.label}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = m.id === selectedId;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => handleSelectMode(m.id)}
                className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                  active
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-black"
                    : "border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] text-neutral-600 dark:text-white/65 hover:text-neutral-950 dark:hover:text-white"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Animated Pipeline Visualizer */}
      <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.025] p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-semibold text-neutral-900 dark:text-white">
                {mode.label} — Live Pipeline
              </span>
            </div>
            <p className="text-[11px] text-neutral-500 dark:text-white/50">
              {mode.tagline}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsPlaying((p) => !p)}
            aria-label={isPlaying ? "Pause pipeline animation" : "Play pipeline animation"}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-black/10 dark:border-white/10 text-[11px] font-medium text-neutral-600 dark:text-white/65 hover:text-neutral-950 dark:hover:text-white transition-colors cursor-pointer shrink-0"
          >
            {isPlaying ? (
              <>
                <Pause className="w-3 h-3" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-3 h-3" />
                <span>Play</span>
              </>
            )}
          </button>
        </div>

        {/* 4-Stage Animated Track */}
        <div className="relative pt-1">
          {/* Desktop horizontal signal line */}
          <div
            aria-hidden="true"
            className="hidden sm:block absolute left-10 right-10 top-[26px] h-px bg-black/10 dark:bg-white/10"
          >
            <motion.div
              className="h-full bg-emerald-500/80 dark:bg-emerald-400/80 origin-left"
              initial={false}
              animate={{ scaleX: activeStage / 3 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            />
            <motion.div
              className="absolute -top-[3px] -ml-1 w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.9)]"
              initial={false}
              animate={{ left: `${(activeStage / 3) * 100}%` }}
              transition={{ type: "spring", stiffness: 280, damping: 26 }}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {mode.stages.map((stage, idx) => {
              const isCurrent = idx === activeStage;
              const isPassed = idx < activeStage;
              return (
                <button
                  key={`${mode.id}-${idx}`}
                  type="button"
                  onClick={() => {
                    setActiveStage(idx);
                    setIsPlaying(false);
                  }}
                  className={`relative text-left rounded-xl p-3 border transition-colors cursor-pointer ${
                    isCurrent
                      ? "border-emerald-500/50 bg-white dark:bg-white/[0.07] shadow-sm"
                      : isPassed
                        ? "border-black/10 dark:border-white/10 bg-white/50 dark:bg-white/[0.03]"
                        : "border-black/8 dark:border-white/[0.07] bg-transparent opacity-70 hover:opacity-100"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span
                      className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-mono font-bold ${
                        isCurrent
                          ? "bg-emerald-500 text-white dark:text-black"
                          : isPassed
                            ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                            : "bg-black/[0.06] dark:bg-white/10 text-neutral-500 dark:text-white/50"
                      }`}
                    >
                      {idx + 1}
                    </span>
                    {isCurrent && (
                      <motion.span
                        layoutId="guideStageDot"
                        className="w-1.5 h-1.5 rounded-full bg-emerald-500"
                      />
                    )}
                  </div>

                  <div className="text-xs font-semibold text-neutral-900 dark:text-white truncate">
                    {stage.label}
                  </div>
                  <div className="mt-1 inline-block max-w-full truncate rounded-md bg-black/[0.05] dark:bg-black/40 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700 dark:text-emerald-300">
                    {stage.chip}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Animated Stage Explanation */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`${mode.id}-stage-${activeStage}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="rounded-xl bg-white/75 dark:bg-black/35 border border-black/8 dark:border-white/10 px-3.5 py-2.5 flex items-center gap-2.5 text-xs text-neutral-700 dark:text-white/80"
          >
            <span className="font-mono text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
              Step 0{activeStage + 1}:
            </span>
            <span>{currentStage.detail}</span>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Minimal 3-Step Quick Guide */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {mode.steps.map((step, idx) => (
          <div
            key={`${mode.id}-how-${idx}`}
            className="rounded-xl border border-black/8 dark:border-white/10 bg-black/[0.015] dark:bg-white/[0.02] p-3.5 space-y-1.5"
          >
            <div className="font-mono text-[10px] font-semibold text-neutral-400 dark:text-white/40 uppercase tracking-wider">
              How to use • 0{idx + 1}
            </div>
            <p className="text-xs text-neutral-700 dark:text-white/75 leading-relaxed">
              {step}
            </p>
          </div>
        ))}
      </div>

      {/* Minimal Tip + Collapsible Technical Spec */}
      <div className="rounded-xl border border-black/10 dark:border-white/10 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowSpec((s) => !s)}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-xs bg-black/[0.02] dark:bg-white/[0.02] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors cursor-pointer"
        >
          <span className="text-neutral-700 dark:text-white/75">
            <span className="font-semibold text-neutral-900 dark:text-white">
              Tip:{" "}
            </span>
            {mode.tip}
          </span>
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-neutral-500 dark:text-white/50 shrink-0">
            <span>Spec</span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                showSpec ? "rotate-180" : ""
              }`}
            />
          </span>
        </button>

        <AnimatePresence>
          {showSpec && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden border-t border-black/10 dark:border-white/10"
            >
              <div className="p-4 space-y-2 text-[11px] bg-white/50 dark:bg-black/25">
                {QUICK_SPEC.map((item) => (
                  <div
                    key={item.code}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b last:border-b-0 border-black/5 dark:border-white/5"
                  >
                    <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                      {item.code}
                    </span>
                    <span className="text-neutral-600 dark:text-white/65">
                      {item.desc}
                    </span>
                  </div>
                ))}
                <p className="pt-1 text-[10px] text-neutral-500 dark:text-white/45">
                  100% client-side via Web Crypto API & CompressionStream • Zero backend • Drafts clear when tab closes.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
