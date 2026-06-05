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
import { Slider } from "@/components/ui/slider";
import { useConfigMutation } from "@/mutations/use-config-mutation";
import {
  DEFAULT_PITCH_GREEN_CENTS,
  DEFAULT_PITCH_ORANGE_CENTS,
  DEFAULT_PITCH_YELLOW_CENTS,
  MAX_MIC_LATENCY_MS,
  MAX_PITCH_THRESHOLD_CENTS,
  MIN_MIC_LATENCY_MS,
  MIN_PITCH_THRESHOLD_CENTS,
  normalizePitchFeedbackSettings,
  practiceSettingsFromConfig,
} from "@/lib/practice/practice-settings";
import type { AppConfig } from "@/types/AppConfig";

interface PlaybackSettingsPanelProps {
  config: AppConfig | null;
  open: boolean;
  onClose: () => void;
}

function pct(value: number): string {
  return `${value} cents`;
}

export function PlaybackSettingsPanel({ config, open, onClose }: PlaybackSettingsPanelProps) {
  const { mutate } = useConfigMutation();
  const settings = practiceSettingsFromConfig(config);
  const { greenCents, yellowCents, orangeCents } = settings.pitchFeedback;

  const updatePitchThresholds = (
    next: Partial<{
      greenCents: number;
      yellowCents: number;
      orangeCents: number;
    }>,
  ) => {
    const normalized = normalizePitchFeedbackSettings(
      next.greenCents ?? greenCents,
      next.yellowCents ?? yellowCents,
      next.orangeCents ?? orangeCents,
    );

    mutate({
      practice_pitch_green_cents: normalized.greenCents,
      practice_pitch_yellow_cents: normalized.yellowCents,
      practice_pitch_orange_cents: normalized.orangeCents,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[88vh] overflow-y-auto bg-black text-white ring-white/20">
        <DialogHeader>
          <DialogTitle className="text-2xl">Playback Settings</DialogTitle>
          <DialogDescription className="text-white/60">
            Practice feedback and microphone timing.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <Label>Green pitch window</Label>
            <FieldDescription>Near-perfect match: {pct(greenCents)}</FieldDescription>
            <Slider
              min={MIN_PITCH_THRESHOLD_CENTS}
              max={MAX_PITCH_THRESHOLD_CENTS}
              step={1}
              value={[greenCents]}
              onValueChange={([value]) => updatePitchThresholds({ greenCents: value })}
            />
          </Field>

          <Field>
            <Label>Yellow pitch window</Label>
            <FieldDescription>Close match: {pct(yellowCents)}</FieldDescription>
            <Slider
              min={MIN_PITCH_THRESHOLD_CENTS}
              max={MAX_PITCH_THRESHOLD_CENTS}
              step={1}
              value={[yellowCents]}
              onValueChange={([value]) => updatePitchThresholds({ yellowCents: value })}
            />
          </Field>

          <Field>
            <Label>Orange pitch window</Label>
            <FieldDescription>Outer match: {pct(orangeCents)}</FieldDescription>
            <Slider
              min={MIN_PITCH_THRESHOLD_CENTS}
              max={MAX_PITCH_THRESHOLD_CENTS}
              step={1}
              value={[orangeCents]}
              onValueChange={([value]) => updatePitchThresholds({ orangeCents: value })}
            />
          </Field>

          <Field>
            <Label>Microphone latency</Label>
            <FieldDescription>{settings.micLatencyMs}ms</FieldDescription>
            <Slider
              min={MIN_MIC_LATENCY_MS}
              max={MAX_MIC_LATENCY_MS}
              step={5}
              value={[settings.micLatencyMs]}
              onValueChange={([value]) => mutate({ practice_mic_latency_ms: value })}
            />
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() =>
              mutate({
                practice_pitch_green_cents: DEFAULT_PITCH_GREEN_CENTS,
                practice_pitch_yellow_cents: DEFAULT_PITCH_YELLOW_CENTS,
                practice_pitch_orange_cents: DEFAULT_PITCH_ORANGE_CENTS,
                practice_mic_latency_ms: null,
              })
            }
          >
            Restore Defaults
          </Button>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
