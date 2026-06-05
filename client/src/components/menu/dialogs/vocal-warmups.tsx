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
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDialog } from "@/hooks/use-dialog";
import {
  buildVocalWarmupSequence,
  midiToNoteName,
  sequenceDuration,
  VOCAL_WARMUPS,
  VOICE_RANGE_PRESETS,
  type VoiceRangePreset,
} from "@/lib/practice/vocal-warmups";
import { startToneSequence, type ToneSequenceController } from "./vocal-tone-player";
import { ActivityIcon, PlayIcon, SquareIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const RANGE_OPTIONS: VoiceRangePreset[] = ["low", "medium", "high"];

export function VocalWarmupsDialog() {
  const { mode, close } = useDialog();
  const open = mode === "vocal-warmups";
  const [rangePreset, setRangePreset] = useState<VoiceRangePreset>("medium");
  const [exerciseId, setExerciseId] = useState(VOCAL_WARMUPS[0].id);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const controllerRef = useRef<ToneSequenceController | null>(null);
  const startMsRef = useRef<number | null>(null);
  const exercise = VOCAL_WARMUPS.find((item) => item.id === exerciseId) ?? VOCAL_WARMUPS[0];
  const sequence = useMemo(
    () => buildVocalWarmupSequence(exercise, rangePreset),
    [exercise, rangePreset],
  );
  const durationSec = sequenceDuration(sequence);

  const stop = () => {
    controllerRef.current?.stop();
    controllerRef.current = null;
    startMsRef.current = null;
    setRunning(false);
  };

  const play = () => {
    stop();
    setElapsed(0);
    const controller = startToneSequence(sequence, () => {
      stop();
      setElapsed(durationSec);
    });
    controllerRef.current = controller;
    startMsRef.current = controller.startMs;
    setRunning(true);
  };

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      if (startMsRef.current == null) return;
      setElapsed(Math.max(0, (performance.now() - startMsRef.current) / 1000));
    }, 80);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (!open) {
      stop();
      setElapsed(0);
    }
  }, [open]);

  const currentTone = sequence.find((tone) => elapsed >= tone.startSec && elapsed <= tone.endSec);
  const progress = Math.min(100, (elapsed / Math.max(1, durationSec)) * 100);
  const currentMidi = currentTone?.startMidi ?? null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <ActivityIcon className="size-6" />
            Vocal Warmups
          </DialogTitle>
          <DialogDescription>
            Guided traditional warmups for getting ready to sing. These do not change calibration or
            scoring.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/25 p-3">
              <Select
                value={rangePreset}
                disabled={running}
                onValueChange={(value) => setRangePreset(value as VoiceRangePreset)}
              >
                <SelectTrigger className="w-36">
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
              <Badge variant={exercise.largerRange ? "secondary" : "outline"}>
                {exercise.largerRange ? "Larger range" : "Middle range"}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Stay relaxed and skip notes that feel uncomfortable.
              </span>
            </div>

            <div className="rounded-lg border bg-card/70 p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-2xl font-semibold">{exercise.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{exercise.description}</p>
                </div>
                <Badge>{exercise.syllable}</Badge>
              </div>
              <Progress className="h-3" value={progress} />
              <div className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
                <span>
                  {Math.round(elapsed)}s / {Math.round(durationSec)}s
                </span>
                <span>{currentTone?.label ?? "Ready"}</span>
                <span>{currentMidi == null ? "--" : midiToNoteName(currentMidi)}</span>
              </div>
            </div>
          </div>

          <div className="grid max-h-[28rem] gap-2 overflow-y-auto pr-1">
            {VOCAL_WARMUPS.map((warmup, index) => (
              <Button
                key={warmup.id}
                variant={warmup.id === exerciseId ? "default" : "outline"}
                className="h-auto justify-start p-3 text-left"
                disabled={running}
                onClick={() => {
                  setExerciseId(warmup.id);
                  setElapsed(0);
                }}
              >
                <span>
                  <span className="block font-semibold">
                    {index + 1}. {warmup.title}
                  </span>
                  <span className="block text-xs opacity-75">{warmup.syllable}</span>
                </span>
              </Button>
            ))}
          </div>
        </div>

        <DialogFooter>
          {running ? (
            <Button variant="outline" onClick={stop}>
              <SquareIcon /> Stop
            </Button>
          ) : (
            <Button onClick={play}>
              <PlayIcon /> Play Warmup
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
