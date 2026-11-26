"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";

const memoryCache = new Map<string, unknown>();
const listeners = new Map<string, Set<() => void>>();

function subscribeKey(key: string, callback: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(callback);
  return () => {
    set?.delete(callback);
  };
}

function notifyKey(key: string): void {
  const set = listeners.get(key);
  if (!set) return;
  for (const cb of set) {
    cb();
  }
}

function readSnapshot<T>(key: string, fallback: T): T {
  if (memoryCache.has(key)) {
    return memoryCache.get(key) as T;
  }

  if (typeof window !== "undefined") {
    try {
      const raw = window.sessionStorage.getItem(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as T;
        memoryCache.set(key, parsed);
        return parsed;
      }
    } catch {
      // Ignore corrupt sessionStorage entries
    }
  }

  memoryCache.set(key, fallback);
  return fallback;
}

export function clearSessionKeys(keys: string[]): void {
  for (const key of keys) {
    memoryCache.delete(key);
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        // Ignore storage errors
      }
    }
    notifyKey(key);
  }
}

/**
 * Hydration-safe state backed by sessionStorage so page refreshes preserve
 * active drafts, outputs, and chat history while closing the tab clears it.
 */
export function useSessionState<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  const fallbackRef = useRef(initialValue);

  const subscribe = useCallback(
    (cb: () => void) => subscribeKey(key, cb),
    [key]
  );

  const getSnapshot = useCallback(
    () => readSnapshot(key, fallbackRef.current),
    [key]
  );

  const getServerSnapshot = useCallback(() => fallbackRef.current, []);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (updater: T | ((prev: T) => T)) => {
      const current = readSnapshot(key, fallbackRef.current);
      const next =
        typeof updater === "function"
          ? (updater as (prev: T) => T)(current)
          : updater;

      memoryCache.set(key, next);
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.setItem(key, JSON.stringify(next));
        } catch {
          // Ignore quota/private-mode storage failures
        }
      }
      notifyKey(key);
    },
    [key]
  );

  return [value, setValue];
}
