export interface PlatformLimit {
  id: string;
  name: string;
  limit: number;
}

export interface PlatformCompatibility extends PlatformLimit {
  fits: boolean;
  usagePct: number;
}

export interface SurvivalAssessment {
  status: "optimal" | "caution" | "fallback";
  message: string;
}

export const PLATFORM_LIMITS: readonly PlatformLimit[] = [
  { id: "sms", name: "SMS", limit: 160 },
  { id: "x", name: "X / Twitter", limit: 280 },
  { id: "ig", name: "IG DM", limit: 1_000 },
  { id: "discord", name: "Discord", limit: 2_000 },
  { id: "telegram", name: "Telegram", limit: 4_096 },
  { id: "slack", name: "Slack", limit: 40_000 },
  { id: "whatsapp", name: "WhatsApp", limit: 65_536 },
] as const;

export function evaluatePlatformCompatibility(
  totalStegoChars: number
): PlatformCompatibility[] {
  return PLATFORM_LIMITS.map((platform) => ({
    ...platform,
    fits: totalStegoChars <= platform.limit,
    usagePct: Math.min(100, Math.round((totalStegoChars / platform.limit) * 100)),
  }));
}

export function assessCoverSurvival(coverText: string): SurvivalAssessment {
  const clean = coverText.replace(/[\u200B\u200C\u200D\u2060]/g, "");
  const trimmed = clean.trim();

  if (!trimmed.length) {
    return {
      status: "fallback",
      message:
        'Empty cover will fall back to "Hi there" so zero-width chars stay anchored.',
    };
  }

  const hasInternalWordGap = /\S+\s+\S+/.test(trimmed);
  if (hasInternalWordGap) {
    return {
      status: "optimal",
      message:
        "Optimal interior anchor: payload embeds between word 1 & word 2.",
    };
  }

  const charCount = Array.from(trimmed).length;
  if (charCount <= 1) {
    return {
      status: "caution",
      message:
        "1-char cover places hidden chars at the trailing edge — chat apps may trim them.",
    };
  }

  return {
    status: "caution",
    message:
      "Single-word cover embeds after char 1; adding a 2nd word maximizes survival.",
  };
}
