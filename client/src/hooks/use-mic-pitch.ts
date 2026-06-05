import {
  microphoneAdapter,
  type MicCaptureOptions,
  type MicrophoneAdapter,
} from "@/bridge/microphone";
import { useMicSamples } from "@/hooks/use-mic-samples";
import { PITCH_WINDOW_SAMPLES } from "@/lib/pitch/constants";
import {
  analyzePitchFrameFromSamplesMic,
  createMicPitchDetector,
  type TimedPitchAnalysisFrame,
  type TimedPitchDetectionFrame,
} from "@/lib/pitch/detect";
import { SampleRing } from "@/lib/mic/sample-ring";
import type { MicrophoneInfo } from "@/types/MicrophoneInfo";
import { useCallback, useEffect, useRef, useState } from "react";

/** ~30 Hz pitch updates: more than enough for vocal pitch tracking. */
const PITCH_TICK_MS = 33;
const RING_CAPACITY = PITCH_WINDOW_SAMPLES * 2;

export interface MicDevice {
  deviceId: string;
  label: string;
}

const defaultAdapter = microphoneAdapter;

export function useMicDevices(adapter: MicrophoneAdapter = defaultAdapter) {
  const [devices, setDevices] = useState<MicDevice[]>([]);

  const refresh = useCallback(async () => {
    try {
      const mics = await adapter.listDevices();
      setDevices(
        mics.map((m: MicrophoneInfo) => ({
          deviceId: m.name,
          label: m.name,
        })),
      );
    } catch {
      setDevices([]);
    }
  }, [adapter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return devices;
}

export function useMicPitch(enabled: boolean) {
  const [latestPitchFrame, setLatestPitchFrame] = useState<TimedPitchDetectionFrame | null>(null);
  const [latestAnalysisFrame, setLatestAnalysisFrame] = useState<TimedPitchAnalysisFrame | null>(
    null,
  );
  const [active, setActive] = useState(false);
  const ringRef = useRef<SampleRing | null>(null);
  const sampleRateRef = useRef(0);
  const sampleVersionRef = useRef(0);
  const frameIdRef = useRef(0);

  if (ringRef.current === null) {
    ringRef.current = new SampleRing(RING_CAPACITY);
  }

  useMicSamples((frame) => {
    sampleRateRef.current = frame.sample_rate;
    ringRef.current?.push(frame.samples);
    sampleVersionRef.current += 1;
  }, enabled);

  useEffect(() => {
    if (!enabled) {
      setLatestPitchFrame(null);
      setActive(false);
      ringRef.current?.reset();
      sampleRateRef.current = 0;
      sampleVersionRef.current = 0;
      frameIdRef.current = 0;
      setLatestAnalysisFrame(null);
      return;
    }

    setActive(true);
    const detector = createMicPitchDetector();
    const window = new Float32Array(PITCH_WINDOW_SAMPLES);
    let analyzedSampleVersion = 0;

    const tick = () => {
      const ring = ringRef.current;
      const sr = sampleRateRef.current;
      if (!ring || sr === 0) return;
      if (sampleVersionRef.current === analyzedSampleVersion) return;
      if (!ring.readMostRecent(window)) return;
      analyzedSampleVersion = sampleVersionRef.current;
      const analysis = analyzePitchFrameFromSamplesMic(detector, window, sr);
      frameIdRef.current += 1;
      const timedAnalysis = {
        ...analysis,
        id: frameIdRef.current,
        detectedAtMs: performance.now(),
      };
      setLatestAnalysisFrame(timedAnalysis);
      setLatestPitchFrame(
        analysis.voiced && analysis.hz != null && analysis.clarity != null
          ? {
              hz: analysis.hz,
              clarity: analysis.clarity,
              rms: analysis.rms,
              id: timedAnalysis.id,
              detectedAtMs: timedAnalysis.detectedAtMs,
            }
          : null,
      );
    };

    const id = setInterval(tick, PITCH_TICK_MS);

    return () => {
      clearInterval(id);
      setLatestPitchFrame(null);
      setLatestAnalysisFrame(null);
      setActive(false);
      analyzedSampleVersion = 0;
    };
  }, [enabled]);

  return {
    latestPitch: latestPitchFrame?.hz ?? null,
    latestPitchFrame,
    latestAnalysisFrame,
    active,
    error: null as string | null,
  };
}

export function useMicCapture(
  deviceId: string | null,
  enabled: boolean,
  options: MicCaptureOptions,
  adapter: MicrophoneAdapter = defaultAdapter,
) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      if (startedRef.current) {
        adapter.stopCapture().catch(() => {});
        startedRef.current = false;
      }
      setError(null);
      setActive(false);
      setDeviceName(null);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const activeDeviceName = await adapter.startCapture(deviceId, options);

        if (cancelled) {
          await adapter.stopCapture().catch(() => {});
          return;
        }

        startedRef.current = true;
        setActive(true);
        setDeviceName(activeDeviceName);
        setError(null);
      } catch (e) {
        void adapter.stopCapture().catch(() => {});
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg);
          setActive(false);
          setDeviceName(null);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (startedRef.current) {
        adapter.stopCapture().catch(() => {});
        startedRef.current = false;
      }
      setActive(false);
      setDeviceName(null);
    };
  }, [enabled, options.emit_audio, deviceId, adapter]);

  return { active, error, deviceName };
}
