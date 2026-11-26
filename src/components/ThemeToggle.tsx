"use client";

import { useSyncExternalStore } from "react";
import { motion } from "framer-motion";

export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "ghostink.theme";
const themeSubscribers = new Set<() => void>();

function readTheme(): ThemeMode {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

function subscribeTheme(cb: () => void): () => void {
  themeSubscribers.add(cb);
  return () => {
    themeSubscribers.delete(cb);
  };
}

function applyThemeClass(next: ThemeMode): void {
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  root.classList.add(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Ignore storage restriction
  }
  for (const cb of themeSubscribers) {
    cb();
  }
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeTheme,
    readTheme,
    () => "dark" as ThemeMode
  );
  const isDark = theme === "dark";

  const handleToggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    const next: ThemeMode = isDark ? "light" : "dark";
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    if (typeof document.startViewTransition !== "function" || prefersReduced) {
      applyThemeClass(next);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const maxRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    const transition = document.startViewTransition(() => {
      applyThemeClass(next);
    });

    void transition.ready.then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${maxRadius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 420,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          pseudoElement: "::view-transition-new(root)",
        }
      );
    });
  };

  return (
    <motion.button
      type="button"
      onClick={handleToggle}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.94 }}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to Daylight Mode" : "Switch to Stealth Dark Mode"}
      className={`relative inline-flex h-8 w-[62px] shrink-0 items-center rounded-full p-1 border transition-colors duration-300 cursor-pointer overflow-hidden ${
        isDark
          ? "bg-[#0a0a0d] border-white/15 shadow-inner"
          : "bg-neutral-200/95 border-black/10 shadow-inner"
      }`}
    >
      {/* Celestial Backdrop: Stars (Dark) / Horizon Glow (Light) */}
      <span
        aria-hidden="true"
        className={`absolute left-2.5 flex items-center gap-1 transition-opacity duration-300 ${
          isDark ? "opacity-90" : "opacity-0"
        }`}
      >
        <span className="w-1 h-1 rounded-full bg-white/80 animate-pulse" />
        <span className="w-0.5 h-0.5 rounded-full bg-emerald-300/90 -translate-y-1.5" />
        <span className="w-0.5 h-0.5 rounded-full bg-white/60 translate-y-1.5" />
      </span>

      <span
        aria-hidden="true"
        className={`absolute right-2.5 flex items-center gap-1 transition-opacity duration-300 ${
          isDark ? "opacity-0" : "opacity-80"
        }`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500/70" />
        <span className="w-1 h-1 rounded-full bg-neutral-400/70 translate-y-1" />
      </span>

      {/* Sliding Eclipse / Sun Orb */}
      <motion.span
        animate={{ x: isDark ? 28 : 0, rotate: isDark ? 0 : 180 }}
        transition={{ type: "spring", stiffness: 420, damping: 26 }}
        className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center transition-colors duration-300 ${
          isDark
            ? "bg-white text-neutral-950 shadow-[0_0_14px_rgba(255,255,255,0.5)]"
            : "bg-neutral-900 text-amber-300 shadow-[0_2px_10px_rgba(0,0,0,0.25)]"
        }`}
      >
        {isDark ? (
          /* Crescent / Eclipse Moon */
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-3.5 h-3.5"
            aria-hidden="true"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79Z" />
          </svg>
        ) : (
          /* Sun with Crisp Rays */
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-3.5 h-3.5"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
          </svg>
        )}
      </motion.span>
    </motion.button>
  );
}
