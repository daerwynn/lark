import { MIC_LATENCY_COMPENSATION_SEC } from "@/lib/pitch/constants";
import type { AppConfig } from "@/types/AppConfig";

export type PitchFeedbackLevel = "orange" | "yellow" | "green";

export interface PracticePitchFeedbackSettings {
  greenCents: number;
  yellowCents: number;
  orangeCents: number;
}

export interface PracticeSettings {
  pitchFeedback: PracticePitchFeedbackSettings;
  micLatencyMs: number;
  liveTraceOffsetMs: number;
  usdxLyricDisplayOffsetMs: number;
}

export const DEFAULT_PITCH_GREEN_CENTS = 10;
export const DEFAULT_PITCH_YELLOW_CENTS = 25;
export const DEFAULT_PITCH_ORANGE_CENTS = 50;
export const MIN_PITCH_THRESHOLD_CENTS = 1;
export const MAX_PITCH_THRESHOLD_CENTS = 200;
export const MIN_MIC_LATENCY_MS = 0;
export const MAX_MIC_LATENCY_MS = 500;
export const DEFAULT_MIC_LATENCY_MS = Math.round(MIC_LATENCY_COMPENSATION_SEC * 1000);
export const DEFAULT_LIVE_TRACE_OFFSET_MS = 0;
export const MIN_LIVE_TRACE_OFFSET_MS = -1000;
export const MAX_LIVE_TRACE_OFFSET_MS = 1000;
export const DEFAULT_USDX_LYRIC_DISPLAY_OFFSET_MS = 0;
export const MIN_USDX_LYRIC_DISPLAY_OFFSET_MS = -3000;
export const MAX_USDX_LYRIC_DISPLAY_OFFSET_MS = 3000;

function finiteOrDefault(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizePitchFeedbackSettings(
  greenCents: number | null | undefined,
  yellowCents: number | null | undefined,
  orangeCents: number | null | undefined,
): PracticePitchFeedbackSettings {
  const green = clamp(
    Math.round(finiteOrDefault(greenCents, DEFAULT_PITCH_GREEN_CENTS)),
    MIN_PITCH_THRESHOLD_CENTS,
    MAX_PITCH_THRESHOLD_CENTS,
  );
  const yellow = clamp(
    Math.round(finiteOrDefault(yellowCents, DEFAULT_PITCH_YELLOW_CENTS)),
    green,
    MAX_PITCH_THRESHOLD_CENTS,
  );
  const orange = clamp(
    Math.round(finiteOrDefault(orangeCents, DEFAULT_PITCH_ORANGE_CENTS)),
    yellow,
    MAX_PITCH_THRESHOLD_CENTS,
  );

  return { greenCents: green, yellowCents: yellow, orangeCents: orange };
}

export function normalizeMicLatencyMs(value: number | null | undefined): number {
  return clamp(
    Math.round(finiteOrDefault(value, DEFAULT_MIC_LATENCY_MS)),
    MIN_MIC_LATENCY_MS,
    MAX_MIC_LATENCY_MS,
  );
}

export function normalizeLiveTraceOffsetMs(value: number | null | undefined): number {
  return clamp(
    Math.round(finiteOrDefault(value, DEFAULT_LIVE_TRACE_OFFSET_MS)),
    MIN_LIVE_TRACE_OFFSET_MS,
    MAX_LIVE_TRACE_OFFSET_MS,
  );
}

export function normalizeUsdxLyricDisplayOffsetMs(value: number | null | undefined): number {
  return clamp(
    Math.round(finiteOrDefault(value, DEFAULT_USDX_LYRIC_DISPLAY_OFFSET_MS)),
    MIN_USDX_LYRIC_DISPLAY_OFFSET_MS,
    MAX_USDX_LYRIC_DISPLAY_OFFSET_MS,
  );
}

export function practiceSettingsFromConfig(config: AppConfig | null | undefined): PracticeSettings {
  return {
    pitchFeedback: normalizePitchFeedbackSettings(
      config?.practice_pitch_green_cents,
      config?.practice_pitch_yellow_cents,
      config?.practice_pitch_orange_cents,
    ),
    micLatencyMs: normalizeMicLatencyMs(config?.practice_mic_latency_ms),
    liveTraceOffsetMs: normalizeLiveTraceOffsetMs(config?.practice_live_trace_offset_ms),
    usdxLyricDisplayOffsetMs: normalizeUsdxLyricDisplayOffsetMs(
      config?.usdx_lyric_display_offset_ms,
    ),
  };
}

export function pitchFeedbackLevelFromCents(
  centsDifference: number | null | undefined,
  settings: PracticePitchFeedbackSettings,
): PitchFeedbackLevel | null {
  if (typeof centsDifference !== "number" || !Number.isFinite(centsDifference)) {
    return null;
  }

  const abs = Math.abs(centsDifference);
  if (abs <= settings.greenCents) return "green";
  if (abs <= settings.yellowCents) return "yellow";
  if (abs <= settings.orangeCents) return "orange";
  return null;
}
