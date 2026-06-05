import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMicCapture } from "@/hooks/use-mic-pitch";
import { useMicSamples } from "@/hooks/use-mic-samples";
import { useDialog } from "@/hooks/use-dialog";
import { useVocalCalibrationMutation } from "@/mutations/use-profile-mutations";
import { useConfig } from "@/queries/use-config";
import { useProfiles } from "@/queries/use-profiles";
import { createMicPitchDetector, detectPitchFrameFromSamplesMic } from "@/lib/pitch/detect";
import { PITCH_WINDOW_SAMPLES } from "@/lib/pitch/constants";
import { SampleRing } from "@/lib/mic/sample-ring";
import {
  activeExpectedMidi,
  estimateVocalCalibration,
  type CalibrationPitchFrame,
  type VocalCalibrationEstimate,
} from "@/lib/practice/vocal-calibration";
import {
  buildCalibrationSequence,
  midiToNoteName,
  sequenceDuration,
  VOICE_RANGE_PRESETS,
  type VoiceRangePreset,
} from "@/lib/practice/vocal-warmups";
import { startToneSequence, type ToneSequenceController } from "./vocal-tone-player";
import { CheckCircle2Icon, MicVocalIcon, RotateCcwIcon, SquareIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const RANGE_OPTIONS: VoiceRangePreset[] = ["low", "medium", "high"];
const RING_CAPACITY = PITCH_WINDOW_SAMPLES * 2;

function formatMs(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}ms` : "--";
}

function formatCents(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)} cents` : "--";
}

export function VocalCalibrationDialog() {
  const { mode, close, setMode } = useDialog();
  const open = mode === "vocal-calibration";
  const { data: config } = useConfig();
  const { data: profiles } = useProfiles();
  const { mutate } = useVocalCalibrationMutation();
  const activeProfile = profiles?.active ?? null;
  const existingCalibration = activeProfile
    ? (profiles?.vocal_calibrations[activeProfile] ?? null)
    : null;

  const [rangePreset, setRangePreset] = useState<VoiceRangePreset>("medium");
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [latestHz, setLatestHz] = useState<number | null>(null);
  const [estimate, setEstimate] = useState<VocalCalibrationEstimate | null>(null);
  const sequence = useMemo(() => buildCalibrationSequence(rangePreset), [rangePreset]);
  const durationSec = useMemo(() => sequenceDuration(sequence), [sequence]);
  const ringRef = useRef(new SampleRing(RING_CAPACITY));
  const detectorRef = useRef(createMicPitchDetector());
  const windowRef = useRef(new Float32Array(PITCH_WINDOW_SAMPLES));
  const startMsRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const framesRef = useRef<CalibrationPitchFrame[]>([]);
  const controllerRef = useRef<ToneSequenceController | null>(null);

  const {
    active: micActive,
    error: micError,
    deviceName,
  } = useMicCapture(config?.preferred_mic ?? null, open, { emit_audio: false });

  const finishCalibration = useCallback(
    (cancelled: boolean) => {
      controllerRef.current?.stop();
      controllerRef.current = null;
      runningRef.current = false;
      setRunning(false);

      if (cancelled || !activeProfile) {
        return;
      }

      const nextEstimate = estimateVocalCalibration({
        profile: activeProfile,
        deviceName: deviceName ?? config?.preferred_mic ?? "Default",
        rangePreset,
        sequence,
        frames: framesRef.current,
      });
      setEstimate(nextEstimate);
    },
    [activeProfile, config?.preferred_mic, deviceName, rangePreset, sequence],
  );

  useMicSamples((frame) => {
    if (!runningRef.current || startMsRef.current == null) return;

    ringRef.current.push(frame.samples);
    if (!ringRef.current.readMostRecent(windowRef.current)) return;

    const pitchFrame = detectPitchFrameFromSamplesMic(
      detectorRef.current,
      windowRef.current,
      frame.sample_rate,
    );
    if (!pitchFrame) return;

    const timeSec = Math.max(0, (performance.now() - startMsRef.current) / 1000);
    framesRef.current.push({ ...pitchFrame, timeSec });
    setLatestHz(pitchFrame.hz);
    if (framesRef.current.length % 5 === 0) {
      setFrameCount(framesRef.current.length);
    }
  }, open);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      if (startMsRef.current == null) return;
      setElapsed(Math.max(0, (performance.now() - startMsRef.current) / 1000));
    }, 60);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (!open) {
      finishCalibration(true);
      setElapsed(0);
      setEstimate(null);
      setFrameCount(0);
      setLatestHz(null);
    }
  }, [finishCalibration, open]);

  const handleStart = () => {
    if (!activeProfile) {
      setMode("select-profile");
      return;
    }
    if (!micActive) {
      toast.error(micError ? `Microphone: ${micError}` : "Microphone is not ready yet.");
      return;
    }

    controllerRef.current?.stop();
    detectorRef.current = createMicPitchDetector();
    ringRef.current.reset();
    framesRef.current = [];
    setEstimate(null);
    setFrameCount(0);
    setLatestHz(null);
    setElapsed(0);
    const controller = startToneSequence(sequence, () => finishCalibration(false));
    controllerRef.current = controller;
    startMsRef.current = controller.startMs;
    runningRef.current = true;
    setRunning(true);
  };

  const handleSave = () => {
    if (!activeProfile || !estimate?.calibration) return;
    mutate(
      { type: "save", profile: activeProfile, calibration: estimate.calibration },
      {
        onSuccess: () => {
          toast.success("Voice calibration saved.");
          close();
        },
      },
    );
  };

  const handleClear = () => {
    if (!activeProfile) return;
    mutate(
      { type: "clear", profile: activeProfile },
      {
        onSuccess: () => {
          toast.success("Voice calibration cleared.");
          setEstimate(null);
        },
      },
    );
  };

  const currentMidi = activeExpectedMidi(sequence, elapsed);
  const currentTone = sequence.find((tone) => elapsed >= tone.startSec && elapsed <= tone.endSec);
  const progress = Math.min(100, (elapsed / durationSec) * 100);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <MicVocalIcon className="size-6" />
            Voice Calibration
          </DialogTitle>
          <DialogDescription>
            Sing along gently like a normal vocal warmup. Stay comfortable; the result calibrates
            profile pitch correction and practical microphone latency.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <div className="grid gap-3 md:grid-cols-3">
            <Field>
              <Label>Profile</Label>
              <FieldDescription>
                {activeProfile ?? "Select a profile before saving"}
              </FieldDescription>
            </Field>
            <Field>
              <Label>Microphone</Label>
              <FieldDescription>
                {micActive
                  ? (deviceName ?? "Default")
                  : micError
                    ? `Error: ${micError}`
                    : "Opening"}
              </FieldDescription>
            </Field>
            <Field>
              <Label>Range</Label>
              <Select
                value={rangePreset}
                disabled={running}
                onValueChange={(value) => setRangePreset(value as VoiceRangePreset)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RANGE_OPTIONS.map((preset) => (
                    <SelectItem key={preset} value={preset}>
                      {VOICE_RANGE_PRESETS[preset].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="rounded-lg border bg-muted/25 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">
                  {currentTone?.label ?? "Ready"}
                  {currentMidi != null ? ` · ${midiToNoteName(currentMidi)}` : ""}
                </p>
                <p className="text-sm text-muted-foreground">
                  {currentTone?.syllable
                    ? `Sing "${currentTone.syllable}" with the tone.`
                    : "Listen, breathe, and prepare for the next tone."}
                </p>
              </div>
              <Badge variant={running ? "default" : "outline"}>
                {running ? "Calibrating" : "Stopped"}
              </Badge>
            </div>
            <Progress className="h-3" value={progress} />
            <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
              <span>
                {Math.round(elapsed)}s / {Math.round(durationSec)}s
              </span>
              <span>Detected frames: {frameCount}</span>
              <span>Latest pitch: {latestHz == null ? "--" : `${Math.round(latestHz)}Hz`}</span>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <Field>
              <Label>Pitch Offset</Label>
              <FieldDescription>{formatCents(estimate?.pitchOffsetCents)}</FieldDescription>
            </Field>
            <Field>
              <Label>Mic Latency</Label>
              <FieldDescription>{formatMs(estimate?.micLatencyMs)}</FieldDescription>
            </Field>
            <Field>
              <Label>Quality</Label>
              <FieldDescription>
                {estimate ? `${Math.round(estimate.qualityScore)}%` : "--"}
              </FieldDescription>
            </Field>
            <Field>
              <Label>Status</Label>
              <FieldDescription>
                {estimate?.reason ?? (estimate ? "Ready to save" : "--")}
              </FieldDescription>
            </Field>
          </div>
        </FieldGroup>

        <DialogFooter className="items-center justify-between sm:justify-between">
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleClear}
              disabled={!existingCalibration || running}
            >
              Clear Saved
            </Button>
          </div>
          <div className="flex gap-2">
            {running ? (
              <Button variant="outline" onClick={() => finishCalibration(true)}>
                <SquareIcon /> Stop
              </Button>
            ) : (
              <Button variant="outline" onClick={handleStart}>
                <RotateCcwIcon /> Start
              </Button>
            )}
            <Button onClick={handleSave} disabled={!estimate?.calibration || running}>
              <CheckCircle2Icon /> Save Calibration
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
