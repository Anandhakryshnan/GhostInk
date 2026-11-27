"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { EMOJI_CATEGORIES } from "@/lib/emojis";

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose?: () => void;
  /** Exclude composite (U+FE0F/ZWJ) emojis when used for Variation-Selector cloaking */
  singleCodepointOnly?: boolean;
  selectedEmoji?: string;
}

export function EmojiPicker({
  onSelect,
  onClose,
  singleCodepointOnly = false,
  selectedEmoji,
}: EmojiPickerProps) {
  const [activeCategoryId, setActiveCategoryId] = useState<string>("smileys");
  const [query, setQuery] = useState("");

  const categories = useMemo(
    () =>
      EMOJI_CATEGORIES.map((cat) => ({
        ...cat,
        items: singleCodepointOnly
          ? cat.items.filter((item) => !item.composite)
          : cat.items,
      })).filter((cat) => cat.items.length > 0),
    [singleCodepointOnly]
  );

  const visibleItems = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (trimmed) {
      return categories.flatMap((cat) =>
        cat.items.filter(
          (item) =>
            item.name.toLowerCase().includes(trimmed) ||
            item.char.includes(trimmed)
        )
      );
    }
    return (
      categories.find((cat) => cat.id === activeCategoryId)?.items ??
      categories[0]?.items ??
      []
    );
  }, [categories, activeCategoryId, query]);

  return (
    <div className="rounded-2xl bg-white/95 dark:bg-neutral-950/95 border border-black/15 dark:border-white/15 p-3 shadow-2xl backdrop-blur-xl space-y-2.5">
      {/* Search + Close */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-neutral-400 dark:text-white/40 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search emojis (ghost, lock, fire, heart...)"
            className="w-full rounded-xl bg-black/[0.04] dark:bg-white/5 border border-black/10 dark:border-white/10 pl-8 pr-7 py-1.5 text-xs text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-white/35 focus:outline-none focus:border-neutral-900/40 dark:focus:border-white/30"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 dark:text-white/45 hover:text-neutral-950 dark:hover:text-white cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close emoji picker"
            className="p-1.5 rounded-xl bg-black/[0.04] dark:bg-white/5 border border-black/10 dark:border-white/10 text-neutral-600 dark:text-white/60 hover:text-neutral-950 dark:hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Category Tabs */}
      {!query.trim() && (
        <div className="flex items-center gap-1 overflow-x-auto subtle-scroll pb-1">
          {categories.map((cat) => {
            const active = cat.id === activeCategoryId;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategoryId(cat.id)}
                title={cat.label}
                className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-mono border transition-colors cursor-pointer ${
                  active
                    ? "bg-neutral-900 text-white dark:bg-white dark:text-black border-neutral-900 dark:border-white font-semibold"
                    : "bg-black/[0.04] dark:bg-white/5 text-neutral-600 dark:text-white/65 border-black/10 dark:border-white/10 hover:text-neutral-950 dark:hover:text-white"
                }`}
              >
                <span>{cat.icon}</span>
                <span className="hidden sm:inline">{cat.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Emoji Grid */}
      <div className="max-h-48 overflow-y-auto subtle-scroll pr-0.5">
        {visibleItems.length === 0 ? (
          <p className="text-xs font-mono text-neutral-400 dark:text-white/40 text-center py-6">
            No emojis match &ldquo;{query}&rdquo;
          </p>
        ) : (
          <div className="grid grid-cols-8 sm:grid-cols-10 gap-1">
            {visibleItems.map((item) => {
              const isSelected = selectedEmoji === item.char;
              return (
                <button
                  key={`${item.char}-${item.name}`}
                  type="button"
                  title={item.name}
                  onClick={() => onSelect(item.char)}
                  className={`h-9 rounded-xl text-lg flex items-center justify-center transition-all cursor-pointer ${
                    isSelected
                      ? "bg-black/15 dark:bg-white/20 border border-neutral-900 dark:border-white scale-105"
                      : "hover:bg-black/[0.08] dark:hover:bg-white/10 active:scale-95"
                  }`}
                >
                  {item.char}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
