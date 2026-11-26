"use client";

import { useSyncExternalStore } from "react";

let currentNow = Date.now();
const subscribers = new Set<() => void>();
let intervalHandle: ReturnType<typeof setInterval> | null = null;

function subscribeTicker(callback: () => void): () => void {
  subscribers.add(callback);
  if (subscribers.size === 1 && typeof window !== "undefined") {
    currentNow = Date.now();
    intervalHandle = setInterval(() => {
      currentNow = Date.now();
      for (const sub of subscribers) {
        sub();
      }
    }, 1000);
  }

  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0 && intervalHandle !== null) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  };
}

function getClientSnapshot(): number {
  return currentNow;
}

function getServerSnapshot(): number | null {
  return null;
}

export function useLiveNow(): number | null {
  return useSyncExternalStore(
    subscribeTicker,
    getClientSnapshot,
    getServerSnapshot
  );
}

export function formatRemainingMs(remainingMs: number): string {
  if (remainingMs <= 0) return "Expired";
  const totalSec = Math.ceil(remainingMs / 1000);

  if (totalSec < 60) {
    return `${totalSec}s`;
  }

  const days = Math.floor(totalSec / 86_400);
  const hours = Math.floor((totalSec % 86_400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${mins}m`;
  }
  if (hours > 0) {
    return `${hours}h ${mins}m ${secs}s`;
  }
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

export function CountdownText({
  expiresAt,
  prefix = "",
  expiredLabel = "Expired",
}: {
  expiresAt: number;
  prefix?: string;
  expiredLabel?: string;
}) {
  const now = useLiveNow();
  if (now === null) {
    return <span>{prefix}...</span>;
  }
  const remaining = expiresAt - now;
  if (remaining <= 0) {
    return <span>{expiredLabel}</span>;
  }
  return (
    <span>
      {prefix}
      {formatRemainingMs(remaining)}
    </span>
  );
}
