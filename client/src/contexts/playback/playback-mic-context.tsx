/**
 * Owns everything mic-shaped during playback: device selection, pitch capture,
 * monitor toggle, reactive shader uniforms, and the pitch-scoring series/score.
 *
 * Reads playback state (isReady, isPlaying, paused) from the transport context
 * to gate hardware capture, and persists user toggles to the app config.
 */

import { useMicCapture, useMicDevices, useMicPitch } from "@/hooks/use-mic-pitch";
import { useMicReactive, type MicReactiveRef } from "@/hooks/use-mic-reactive";
import { usePitchScoring, type PitchScoringDebug } from "@/hooks/use-pitch-scoring";
import { micMonitorStatus } from "@/bridge/microphone";
import { usePlaybackConfigPersist } from "@/hooks/playback/use-playback-config-persist";
import type { GuideVocalTimingDiagnostics } from "@/lib/pitch/guide-vocal-calibration";
import type { PitchSeries } from "@/lib/pitch/state";
import { practiceSettingsFromConfig } from "@/lib/practice/practice-settings";
import {
  effectiveMicLatencyMs,
  micCalibrationDeviceName,
  vocalCalibrationMatchesDevice,
} from "@/lib/practice/vocal-calibration";
import { useProfiles } from "@/queries/use-profiles";
import type { AppConfig } from "@/types/AppConfig";
import type { MicMonitorStatus } from "@/types/MicMonitorStatus";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from "./playback-transport-context";
import { usePlaybackTranscriptState } from "./playback-transcript-context";

export interface PlaybackMicState {
  micUserEnabled: boolean;
  micMonitorUserEnabled: boolean;
  selectedMicId: string | null;
  micName: string;
  pitchScore: number | null;
  rawScore: number;
  series: PitchSeries;
  attemptSeries: PitchSeries;
  micDebug: PitchScoringDebug;
  timingDiagnostics: GuideVocalTimingDiagnostics;
  micCaptureActive: boolean;
  micPitchActive: boolean;
  monitorStatus: MicMonitorStatus | null;
  micReady: boolean;
}

export interface PlaybackMicActions {
  reactiveRef: MicReactiveRef;
  handleToggleMic: () => void;
  handleCycleMic: () => void;
  handleToggleMicMonitor: () => void;
  handleClearPracticeAttempt: () => void;
}

const MicStateContext = createContext<PlaybackMicState | null>(null);
const MicActionsContext = createContext<PlaybackMicActions | null>(null);

interface PlaybackMicProviderProps {
  config: AppConfig | null;
  children: ReactNode;
}

export function PlaybackMicProvider({ config, children }: PlaybackMicProviderProps) {
  const { isReady, isPlaying, paused, duration } = usePlaybackTransportState();
  const { subscribe, getVocalsBuffer } = usePlaybackTransportActions();
  const { segments } = usePlaybackTranscriptState();
  const { data: profileStore } = useProfiles();

  const persistConfig = usePlaybackConfigPersist(config);

  const [micUserEnabled, setMicUserEnabled] = useState(config?.mic_active ?? true);
  const [micMonitorUserEnabled, setMicMonitorUserEnabled] = useState(
    config?.mic_monitoring ?? false,
  );
  const [selectedMicId, setSelectedMicId] = useState<string | null>(config?.preferred_mic ?? null);
  const [monitorStatus, setMonitorStatus] = useState<MicMonitorStatus | null>(null);
  const lastKnownMicDeviceNameRef = useRef<string | null>(config?.preferred_mic ?? null);

  const micDevices = useMicDevices();

  const micPitchEnabled = isReady && isPlaying && !paused && micUserEnabled;
  const micMonitorEnabled = isReady && isPlaying && !paused && micMonitorUserEnabled;
  const captureEnabled = micPitchEnabled || micMonitorEnabled;

  const captureOptions = useMemo(() => ({ emit_audio: micMonitorEnabled }), [micMonitorEnabled]);

  const {
    active: micCaptureActive,
    error: micCaptureError,
    deviceName: activeMicDeviceName,
  } = useMicCapture(selectedMicId, captureEnabled, captureOptions);
  const {
    latestAnalysisFrame,
    active: micPitchActive,
    error: micPitchError,
  } = useMicPitch(micPitchEnabled);
  const reactiveRef = useMicReactive(micPitchEnabled);
  const practiceSettings = useMemo(() => practiceSettingsFromConfig(config), [config]);

  useEffect(() => {
    if (activeMicDeviceName) {
      lastKnownMicDeviceNameRef.current = activeMicDeviceName;
    } else if (selectedMicId) {
      lastKnownMicDeviceNameRef.current = selectedMicId;
    }
  }, [activeMicDeviceName, selectedMicId]);

  const calibrationDeviceName = micCalibrationDeviceName({
    activeDeviceName: activeMicDeviceName,
    selectedDeviceName: selectedMicId,
    lastKnownDeviceName: lastKnownMicDeviceNameRef.current,
  });
  const profileCalibration =
    profileStore?.active == null
      ? null
      : (profileStore.vocal_calibrations[profileStore.active] ?? null);
  const matchedCalibration = vocalCalibrationMatchesDevice(
    profileCalibration,
    calibrationDeviceName,
  )
    ? profileCalibration
    : null;
  const effectiveLatencyMs = effectiveMicLatencyMs({
    profileCalibration,
    activeDeviceName: calibrationDeviceName,
    fallbackMs: practiceSettings.micLatencyMs,
  });

  const {
    series,
    attemptSeries,
    score,
    debug: micDebug,
    timingDiagnostics,
    resetPracticeAttempt,
  } = usePitchScoring(
    {
      isReady,
      duration,
      micLatencySec: effectiveLatencyMs / 1000,
      getVocalsBuffer,
      subscribe,
      segments,
      micPitchOffsetCents: matchedCalibration?.pitch_offset_cents ?? null,
    },
    latestAnalysisFrame,
  );

  const micErrorShown = useRef(false);
  useEffect(() => {
    if (!captureEnabled && !micMonitorUserEnabled) {
      setMonitorStatus(null);
      return;
    }

    let cancelled = false;
    const update = () => {
      void micMonitorStatus()
        .then((status) => {
          if (!cancelled) setMonitorStatus(status);
        })
        .catch(() => {
          if (!cancelled) setMonitorStatus(null);
        });
    };

    update();
    const id = window.setInterval(update, 500);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [captureEnabled, micMonitorUserEnabled]);

  useEffect(() => {
    const micError = micCaptureError ?? micPitchError;
    if (micError && !micErrorShown.current) {
      micErrorShown.current = true;
      toast.error(`Microphone: ${micError}`);
    }
    if (!micError) {
      micErrorShown.current = false;
    }
  }, [micCaptureError, micPitchError]);

  const handleToggleMic = useCallback(() => {
    setMicUserEnabled((prev) => {
      const next = !prev;
      if (!next && micMonitorUserEnabled) {
        setMicMonitorUserEnabled(false);
        persistConfig({ mic_active: false, mic_monitoring: false });
      } else {
        persistConfig({ mic_active: next });
      }
      return next;
    });
  }, [persistConfig, micMonitorUserEnabled]);

  const handleCycleMic = useCallback(() => {
    if (micDevices.length <= 1) return;
    const currentIdx = micDevices.findIndex((d) => d.deviceId === selectedMicId);
    const nextIdx = (currentIdx + 1) % micDevices.length;
    const next = micDevices[nextIdx];
    setSelectedMicId(next.deviceId);
    persistConfig({ preferred_mic: next.deviceId });
  }, [micDevices, selectedMicId, persistConfig]);

  const handleToggleMicMonitor = useCallback(() => {
    setMicMonitorUserEnabled((prev) => {
      const next = !prev;
      persistConfig({ mic_monitoring: next });
      if (next && !micUserEnabled) {
        setMicUserEnabled(true);
        persistConfig({ mic_active: true });
      }
      return next;
    });
  }, [persistConfig, micUserEnabled]);

  const stateValue = useMemo<PlaybackMicState>(() => {
    const micReady = micCaptureActive && micPitchActive && micUserEnabled;
    return {
      micUserEnabled,
      micMonitorUserEnabled,
      selectedMicId,
      micName: activeMicDeviceName ?? calibrationDeviceName ?? "Default",
      pitchScore: micReady ? score : null,
      rawScore: score,
      series,
      attemptSeries,
      micDebug,
      timingDiagnostics,
      micCaptureActive,
      micPitchActive,
      monitorStatus,
      micReady,
    };
  }, [
    micUserEnabled,
    micMonitorUserEnabled,
    selectedMicId,
    activeMicDeviceName,
    calibrationDeviceName,
    score,
    series,
    attemptSeries,
    micDebug,
    timingDiagnostics,
    micCaptureActive,
    micPitchActive,
    monitorStatus,
  ]);

  const actionsValue = useMemo<PlaybackMicActions>(
    () => ({
      reactiveRef,
      handleToggleMic,
      handleCycleMic,
      handleToggleMicMonitor,
      handleClearPracticeAttempt: resetPracticeAttempt,
    }),
    [reactiveRef, handleToggleMic, handleCycleMic, handleToggleMicMonitor, resetPracticeAttempt],
  );

  return (
    <MicStateContext.Provider value={stateValue}>
      <MicActionsContext.Provider value={actionsValue}>{children}</MicActionsContext.Provider>
    </MicStateContext.Provider>
  );
}

export function usePlaybackMicState(): PlaybackMicState {
  const ctx = useContext(MicStateContext);
  if (!ctx) {
    throw new Error("usePlaybackMicState must be used within a PlaybackMicProvider");
  }
  return ctx;
}

export function usePlaybackMicActions(): PlaybackMicActions {
  const ctx = useContext(MicActionsContext);
  if (!ctx) {
    throw new Error("usePlaybackMicActions must be used within a PlaybackMicProvider");
  }
  return ctx;
}
