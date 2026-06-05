import { usePlaybackTransportActions, usePlaybackTransportState } from "@/contexts/playback";
import {
  findPlaybackSegmentIndex,
  getPlaybackPhrasePair,
  isPlaybackSegmentVisible,
  type LyricDisplayTiming,
} from "@/lib/playback/lyric-phrases";
import type { Segment, Word } from "@/types/Transcript";
import { memo, useEffect, useRef, useState } from "react";

const WORD_HIGHLIGHT_LEAD = 0.25;

const COUNTDOWN_DURATION = 3.0;
const COUNTDOWN_GAP_THRESHOLD = 3.5;

interface WordStyle {
  rgb: string;
  opacity: number;
}

const STYLES = {
  unsung: { rgb: "rgb(255,255,255)", opacity: 0.5 },
  unsungEstimated: { rgb: "rgb(255,200,100)", opacity: 0.4 },
  sung: { rgb: "rgb(255,255,255)", opacity: 1.0 },
  nextLine: { rgb: "rgb(156,163,175)", opacity: 0.72 },
  nextLineEstimated: { rgb: "rgb(184,154,104)", opacity: 0.62 },
} as const;

const unsungStyle = (word: Word): WordStyle =>
  word.estimated ? STYLES.unsungEstimated : STYLES.unsung;

const nextLineStyle = (word: Word): WordStyle =>
  word.estimated ? STYLES.nextLineEstimated : STYLES.nextLine;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function interpolateStyle(from: WordStyle, to: WordStyle, t: number): WordStyle {
  const p = Math.max(0, Math.min(1, t));
  if (from.rgb === to.rgb) {
    return { rgb: to.rgb, opacity: lerp(from.opacity, to.opacity, p) };
  }
  const fm = from.rgb.match(/\d+/g)!;
  const tm = to.rgb.match(/\d+/g)!;
  const r = Math.round(lerp(+fm[0], +tm[0], p));
  const g = Math.round(lerp(+fm[1], +tm[1], p));
  const b = Math.round(lerp(+fm[2], +tm[2], p));
  return {
    rgb: `rgb(${r},${g},${b})`,
    opacity: lerp(from.opacity, to.opacity, p),
  };
}

// --- Per-frame DOM updates (called via rAF subscriber, no React re-renders) ---

function computeWordStyle(word: Word, time: number, isActive: boolean): WordStyle {
  const base = unsungStyle(word);
  if (!isActive) return base;

  const wStart = word.start - WORD_HIGHLIGHT_LEAD;
  const wEnd = word.end - WORD_HIGHLIGHT_LEAD;

  if (time >= wEnd) return STYLES.sung;
  if (time >= wStart) {
    return interpolateStyle(base, STYLES.sung, (time - wStart) / (wEnd - wStart));
  }
  return base;
}

function updateWordSpans(
  spans: (HTMLSpanElement | null)[],
  words: Word[],
  time: number,
  isActive: boolean,
) {
  for (let i = 0; i < words.length; i++) {
    const span = spans[i];
    if (!span) continue;
    const s = computeWordStyle(words[i], time, isActive);
    span.style.color = s.rgb;
    span.style.opacity = String(s.opacity);
  }
}

function updateCountdown(el: HTMLSpanElement | null, showCountdown: boolean, timeUntil: number) {
  if (!el) {
    return;
  }

  if (showCountdown) {
    el.style.display = "";
    el.textContent = String(Math.ceil(timeUntil));
  } else {
    el.style.display = "none";
  }
}

// --- Word rendering ---

interface WordTokenProps {
  word: Word;
  hasReading: boolean;
  isLast: boolean;
  readingClass: string;
  refSetter?: (el: HTMLSpanElement | null) => void;
  style: WordStyle;
}

function WordToken({ word, hasReading, isLast, readingClass, refSetter, style }: WordTokenProps) {
  const displayText = word.display ?? word.word;
  const hasDisplaySpacing = word.display != null;

  return (
    <span
      ref={refSetter}
      className={hasReading ? "inline-flex flex-col items-center leading-tight" : undefined}
      style={{ color: style.rgb, opacity: style.opacity }}
    >
      {hasReading && (
        <span className={`block leading-tight font-medium opacity-80 ${readingClass}`}>
          {word.reading ?? "\u00A0"}
        </span>
      )}
      <span>{displayText}</span>
      {!hasReading && !hasDisplaySpacing && !isLast ? " " : ""}
    </span>
  );
}

const lineClass = (hasReading: boolean, base: string, gap: string) =>
  hasReading ? `flex flex-wrap items-end justify-center ${gap} ${base}` : `text-center ${base}`;

// --- Component ---

interface LyricsDisplayProps {
  segments: Segment[];
  timing?: LyricDisplayTiming;
}

function LyricsDisplayImpl({ segments, timing }: LyricsDisplayProps) {
  const { isPlaying, paused } = usePlaybackTransportState();
  const { subscribe, getCurrentTime } = usePlaybackTransportActions();
  const animate = isPlaying && !paused;

  const [segIdx, setSegIdx] = useState(() =>
    segments.length === 0 ? 0 : findPlaybackSegmentIndex(segments, getCurrentTime(), 0, timing),
  );

  const hintRef = useRef(0);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const countdownRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nextContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (segments.length === 0) return;

    let raf = 0;
    let cancelled = false;

    const apply = (time: number) => {
      const pair = getPlaybackPhrasePair(segments, time, hintRef.current, timing);
      const idx = pair.activeIndex;
      if (idx !== hintRef.current) {
        hintRef.current = idx;
        setSegIdx(idx);
      }

      const seg = pair.active;
      if (!seg) return;
      const isActive = isPlaybackSegmentVisible(seg, time, timing);

      const gapBefore = idx === 0 ? seg.start : seg.start - segments[idx - 1].end;
      const timeUntil = seg.start - time;
      const showCountdown =
        gapBefore >= COUNTDOWN_GAP_THRESHOLD && timeUntil > 0 && timeUntil <= COUNTDOWN_DURATION;

      const showCurrent = isActive || showCountdown;
      const hasNext = pair.next != null;

      if (containerRef.current) containerRef.current.style.display = showCurrent ? "" : "none";
      if (nextContainerRef.current)
        nextContainerRef.current.style.display = showCurrent && hasNext ? "" : "none";

      updateCountdown(countdownRef.current, showCountdown, timeUntil);
      updateWordSpans(wordRefs.current, seg.words, time, isActive);
    };

    if (animate) {
      const loop = () => {
        if (cancelled) return;
        apply(getCurrentTime());
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      return () => {
        cancelled = true;
        cancelAnimationFrame(raf);
      };
    }

    apply(getCurrentTime());
    return subscribe((time) => apply(time));
  }, [segments, subscribe, getCurrentTime, animate, timing]);

  if (segments.length === 0) {
    return null;
  }

  const safeSegIdx = Math.min(Math.max(0, segIdx), segments.length - 1);
  const seg = segments[safeSegIdx];
  const nextSeg = safeSegIdx + 1 < segments.length ? segments[safeSegIdx + 1] : null;

  wordRefs.current = [];

  const segHasReading = seg.words.some((w) => w.reading);
  const nextHasReading = nextSeg?.words.some((w) => w.reading) ?? false;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-40 z-10 flex flex-col items-center gap-2 px-10">
      <div
        ref={containerRef}
        className="relative max-w-full rounded-lg bg-black/40 px-5 py-2.5"
        style={{ display: "none" }}
      >
        <span
          ref={countdownRef}
          className="absolute -left-9 -top-9 z-10 flex size-10 items-center justify-center rounded-full bg-black/40 text-[1rem] font-bold text-white"
          style={{ display: "none" }}
        />
        {seg.words.length > 0 && (
          <p
            className={lineClass(
              segHasReading,
              "text-[2.5rem] leading-tight font-bold",
              "gap-x-3 gap-y-1",
            )}
          >
            {seg.words.map((word, wi) => (
              <WordToken
                key={`${segIdx}-${wi}`}
                word={word}
                hasReading={segHasReading}
                isLast={wi === seg.words.length - 1}
                readingClass="text-[1rem]"
                refSetter={(el) => {
                  wordRefs.current[wi] = el;
                }}
                style={STYLES.unsung}
              />
            ))}
          </p>
        )}
      </div>

      {nextSeg && (
        <div
          ref={nextContainerRef}
          className="max-w-full rounded-md bg-black/25 px-5 py-2"
          style={{ display: "none" }}
        >
          <p
            className={lineClass(
              nextHasReading,
              "text-[1.85rem] leading-tight font-semibold",
              "gap-x-2 gap-y-0.5",
            )}
          >
            {nextSeg.words.map((word, wi) => (
              <WordToken
                key={wi}
                word={word}
                hasReading={nextHasReading}
                isLast={wi === nextSeg.words.length - 1}
                readingClass="text-[0.7rem]"
                style={nextLineStyle(word)}
              />
            ))}
          </p>
        </div>
      )}
    </div>
  );
}

export const LyricsDisplay = memo(LyricsDisplayImpl);
