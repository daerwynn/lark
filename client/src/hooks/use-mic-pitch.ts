import {
  microphoneAdapter,
  type MicCaptureOptions,
  type MicrophoneAdapter,
} from "@/bridge/microphone";
import { useMicSamples } from "@/hooks/use-mic-samples";
import { PITCH_WINDOW_SAMPLES } from "@/lib/pitch/constants";
import {
  createMicPitchDetector,
  detectPitchFrameFromSamplesMic,
  type PitchDetectionFrame,
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
  const [latestPitchFrame, setLatestPitchFrame] = useState<PitchDetectionFrame | null>(null);
  const [active, setActive] = useState(false);
  const ringRef = useRef<SampleRing | null>(null);
  const sampleRateRef = useRef(0);

  if (ringRef.current === null) {
    ringRef.current = new SampleRing(RING_CAPACITY);
  }

  useMicSamples((frame) => {
    sampleRateRef.current = frame.sample_rate;
    ringRef.current?.push(frame.samples);
  }, enabled);

  useEffect(() => {
    if (!enabled) {
      setLatestPitchFrame(null);
      setActive(false);
      ringRef.current?.reset();
      sampleRateRef.current = 0;
      return;
    }

    setActive(true);
    const detector = createMicPitchDetector();
    const window = new Float32Array(PITCH_WINDOW_SAMPLES);

    const tick = () => {
      const ring = ringRef.current;
      const sr = sampleRateRef.current;
      if (!ring || sr === 0) return;
      if (!ring.readMostRecent(window)) return;
      const frame = detectPitchFrameFromSamplesMic(detector, window, sr);
      setLatestPitchFrame(frame);
    };

    const id = setInterval(tick, PITCH_TICK_MS);

    return () => {
      clearInterval(id);
      setLatestPitchFrame(null);
      setActive(false);
    };
  }, [enabled]);

  return {
    latestPitch: latestPitchFrame?.hz ?? null,
    latestPitchFrame,
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
