"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Crown,
  Eye,
  Lock,
  Radio,
  ScanSearch,
  Split,
} from "lucide-react";
import { useSessionState } from "@/lib/sessionPersist";
import { ChessPanel } from "./ChessPanel";
import { HidePanel } from "./HidePanel";
import { RevealPanel } from "./RevealPanel";
import { ShamirPanel } from "./ShamirPanel";
import { WhisperPanel } from "./WhisperPanel";
import { XRayInspector } from "./XRayInspector";

type WorkspaceTab = "hide" | "reveal" | "xray" | "shamir" | "chess" | "whisper";

const TABS: Array<{
  id: WorkspaceTab;
  label: string;
  icon: typeof Lock;
}> = [
  { id: "hide", label: "Hide", icon: Lock },
  { id: "reveal", label: "Reveal", icon: Eye },
  { id: "xray", label: "X-Ray", icon: ScanSearch },
  { id: "shamir", label: "Split Vault", icon: Split },
  { id: "chess", label: "Chess PGN", icon: Crown },
  { id: "whisper", label: "P2P Whisper", icon: Radio },
];

const subscribeNoop = () => () => {};
const getCryptoWarningServerSnapshot = (): string | null => null;

function getCryptoWarningSnapshot(): string | null {
  if (!window.crypto?.subtle) {
    return "Web Crypto API (crypto.subtle) is unavailable in this insecure context. Use HTTPS or localhost for AES-256-GCM encryption.";
  }
  if (
    typeof CompressionStream === "undefined" ||
    typeof DecompressionStream === "undefined"
  ) {
    return "CompressionStream API is unavailable in this browser. Update your browser to enable deflate-raw framing.";
  }
  return null;
}

export function StegoWorkspace() {
  const [activeTab, setActiveTab] = useSessionState<WorkspaceTab>(
    "ghostink.workspace.tab",
    "hide"
  );
  const [revealInput, setRevealInput] = useSessionState(
    "ghostink.reveal.input",
    ""
  );
  const [xrayInput, setXrayInput] = useSessionState("ghostink.xray.input", "");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cryptoWarning = useSyncExternalStore(
    subscribeNoop,
    getCryptoWarningSnapshot,
    getCryptoWarningServerSnapshot
  );

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
    }, 2600);
  }, []);

  const handleHandoffReveal = useCallback(
    (stegoText: string) => {
      setRevealInput(stegoText);
      setActiveTab("reveal");
    },
    [setRevealInput, setActiveTab]
  );

  const handleHandoffXRay = useCallback(
    (stegoText: string) => {
      setXrayInput(stegoText);
      setActiveTab("xray");
    },
    [setXrayInput, setActiveTab]
  );

  return (
    <div className="relative min-h-screen flex flex-col bg-background text-foreground overflow-x-clip">
      {/* Subtle Film Grain Overlay matching reference portfolio */}
      <div className="pointer-events-none fixed inset-0 z-50 h-full w-full opacity-[0.03] mix-blend-difference">
        <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
          <filter id="stegoNoiseFilter">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.8"
              numOctaves="3"
              stitchTiles="stitch"
            />
          </filter>
          <rect width="100%" height="100%" filter="url(#stegoNoiseFilter)" />
        </svg>
      </div>

      {/* Radial Dot Matrix Grid matching reference portfolio */}
      <div
        className="fixed inset-0 z-0 pointer-events-none opacity-[0.4]"
        style={{
          backgroundImage:
            "radial-gradient(rgba(255, 255, 255, 0.5) 1px, transparent 1px)",
          backgroundSize: "2rem 2rem",
          maskImage:
            "radial-gradient(ellipse at center, black 10%, transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 10%, transparent 80%)",
        }}
      />

      {/* Floating Glass Pill Header */}
      <header className="sticky top-0 z-40 px-4 sm:px-6 pt-5 pb-2">
        <div className="mx-auto max-w-4xl flex items-center justify-between gap-4 px-4 sm:px-6 py-2.5 rounded-full bg-white/5 border border-white/10 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-white">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="w-4.5 h-4.5"
                aria-hidden="true"
              >
                <path
                  d="M9 10h.01"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M15 10h.01"
                  stroke="#34d399"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"
                  stroke="currentColor"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <span className="text-sm font-bold tracking-tight text-white">
              GhostInk
            </span>
          </div>

          <span className="text-[11px] font-medium tracking-wide text-white/60">
            Invisible Ink • End-to-End Encrypted
          </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 pt-8 pb-16">
        {/* Hero Intro */}
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mb-10 space-y-3"
        >
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-white">
            Invisible Unicode{" "}
            <span className="text-white/50 font-light">Steganography.</span>
          </h1>

          <p className="max-w-2xl mx-auto text-sm sm:text-base text-white/55 font-normal leading-relaxed">
            Zero-width steganography, single-emoji cloaking, Shamir split-key
            shards, legal chess PGN ciphers, and ephemeral WebRTC whispers—100%
            inside your browser.
          </p>
        </motion.section>

        {/* Secure Context / API Guard Warning */}
        {cryptoWarning && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-sm text-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>{cryptoWarning}</span>
          </div>
        )}

        {/* Segmented Pill Tab Switcher (Portfolio Interactive-Zone Style) */}
        <div className="flex justify-center mb-6">
          <div
            role="tablist"
            aria-label="GhostInk Workspace Tabs"
            className="inline-flex flex-wrap justify-center gap-1 bg-white/5 p-1.5 rounded-3xl sm:rounded-full border border-white/10 backdrop-blur-xl shadow-xl"
          >
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={isActive}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative z-10 inline-flex items-center gap-1.5 px-3.5 sm:px-4 py-2 rounded-full text-xs sm:text-sm font-medium transition-colors duration-200 cursor-pointer ${
                    isActive
                      ? "text-black"
                      : "text-white/60 hover:text-white"
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="activeTabPill"
                      transition={{
                        type: "spring",
                        stiffness: 420,
                        damping: 32,
                      }}
                      className="absolute inset-0 bg-white rounded-full -z-10 shadow-[0_0_25px_rgba(255,255,255,0.25)]"
                    />
                  )}
                  <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Workspace Card Surface */}
        <section className="glass-card rounded-3xl p-5 sm:p-8 md:p-10">
          <AnimatePresence mode="wait">
            {activeTab === "hide" && (
              <motion.div
                key="tab-hide"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <HidePanel
                  onShowToast={showToast}
                  onHandoffReveal={handleHandoffReveal}
                  onHandoffXRay={handleHandoffXRay}
                />
              </motion.div>
            )}

            {activeTab === "reveal" && (
              <motion.div
                key="tab-reveal"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <RevealPanel
                  stegoInput={revealInput}
                  onStegoInputChange={setRevealInput}
                  onShowToast={showToast}
                />
              </motion.div>
            )}

            {activeTab === "xray" && (
              <motion.div
                key="tab-xray"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <XRayInspector
                  input={xrayInput}
                  onInputChange={setXrayInput}
                  onShowToast={showToast}
                />
              </motion.div>
            )}

            {activeTab === "shamir" && (
              <motion.div
                key="tab-shamir"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <ShamirPanel onShowToast={showToast} />
              </motion.div>
            )}

            {activeTab === "chess" && (
              <motion.div
                key="tab-chess"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <ChessPanel onShowToast={showToast} />
              </motion.div>
            )}

            {activeTab === "whisper" && (
              <motion.div
                key="tab-whisper"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <WhisperPanel onShowToast={showToast} />
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </main>

      {/* Creative Footer Credit */}
      <footer className="relative z-10 w-full flex justify-center px-4 pb-8 pt-2">
        <a
          href="https://anandhakrishnan-portfolio.vercel.app/"
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs text-white/45 hover:text-white/90 hover:bg-white/[0.04] transition-all duration-300"
        >
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400/70 group-hover:bg-emerald-400 group-hover:shadow-[0_0_8px_rgba(52,211,153,0.8)] transition-all" />
          <span className="font-light tracking-wide">
            Hidden in plain sight by{" "}
            <span className="font-medium text-white/75 group-hover:text-white transition-colors">
              Anandhakrishnan
            </span>
          </span>
          <ArrowUpRight className="w-3.5 h-3.5 text-white/35 group-hover:text-white group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
        </a>
      </footer>

      {/* Confirmation Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-6 right-6 z-50 inline-flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-white text-black text-xs font-semibold shadow-2xl"
          >
            <Check className="w-3.5 h-3.5 text-emerald-600" />
            <span>{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
