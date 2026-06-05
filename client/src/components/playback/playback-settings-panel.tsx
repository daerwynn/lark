import { isFullScreen as tauriIsFullScreen, setFullScreen } from "@/bridge/fullScreen";
import { usePlaybackTransportActions, usePlaybackTransportState } from "@/contexts/playback";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { KeyboardShortcutsDialog } from "@/components/playback/keyboard-shortcuts-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useConfigMutation } from "@/mutations/use-config-mutation";
import {
  clampPlaybackVolume,
  formatPlaybackVolume,
  MAX_PLAYBACK_VOLUME,
  MIN_PLAYBACK_VOLUME,
} from "@/lib/playback/playback-volume";
import { playbackKeybindingsFromConfig, shortcutHint } from "@/lib/playback/keybindings";
import {
  DEFAULT_PITCH_GREEN_CENTS,
  DEFAULT_PITCH_ORANGE_CENTS,
  DEFAULT_PITCH_YELLOW_CENTS,
  DEFAULT_USDX_LYRIC_DISPLAY_OFFSET_MS,
  MAX_MIC_LATENCY_MS,
  MAX_PITCH_THRESHOLD_CENTS,
  MAX_USDX_LYRIC_DISPLAY_OFFSET_MS,
  MIN_MIC_LATENCY_MS,
  MIN_PITCH_THRESHOLD_CENTS,
  MIN_USDX_LYRIC_DISPLAY_OFFSET_MS,
  normalizeUsdxLyricDisplayOffsetMs,
  normalizePitchFeedbackSettings,
  practiceSettingsFromConfig,
} from "@/lib/practice/practice-settings";
import type { AppConfig } from "@/types/AppConfig";
import { useEffect, useState } from "react";

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
  const { playbackVolume } = usePlaybackTransportState();
  const { setPlaybackVolume } = usePlaybackTransportActions();
  const [isFullScreen, setIsFullScreen] = useState<boolean | null | undefined>(config?.fullscreen);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const settings = practiceSettingsFromConfig(config);
  const keybindings = playbackKeybindingsFromConfig(config);
  const { greenCents, yellowCents, orangeCents } = settings.pitchFeedback;

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    void tauriIsFullScreen().then((fullscreen) => {
      if (!cancelled) setIsFullScreen(fullscreen);
    });

    return () => {
      cancelled = true;
    };
  }, [open]);

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

  const updatePlaybackVolume = (value: number) => {
    const next = clampPlaybackVolume(value);
    setPlaybackVolume(next);
    mutate({ playback_volume: next });
  };

  const updateUsdxOffset = (value: number) => {
    mutate({ usdx_lyric_display_offset_ms: normalizeUsdxLyricDisplayOffsetMs(value) });
  };

  const toggleWindowMode = (fullscreen: boolean) => {
    setIsFullScreen(fullscreen);
    void setFullScreen(fullscreen);
    mutate({ fullscreen });
  };

  const restoreDefaults = () => {
    setPlaybackVolume(1);
    mutate({
      practice_pitch_green_cents: DEFAULT_PITCH_GREEN_CENTS,
      practice_pitch_yellow_cents: DEFAULT_PITCH_YELLOW_CENTS,
      practice_pitch_orange_cents: DEFAULT_PITCH_ORANGE_CENTS,
      practice_mic_latency_ms: null,
      usdx_lyric_display_offset_ms: DEFAULT_USDX_LYRIC_DISPLAY_OFFSET_MS,
      playback_volume: 1,
    });
  };

  return (
    <>
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
              <Label>Keyboard shortcuts</Label>
              <FieldDescription>
                Customize playback and practice shortcuts shown on screen.
              </FieldDescription>
              <Button variant="outline" onClick={() => setShortcutsOpen(true)}>
                Open Keyboard Shortcuts
              </Button>
            </Field>

            <Field>
              <Label>Window mode</Label>
              <FieldDescription>
                {shortcutHint(keybindings, "fullscreen")} toggles this during playback.
              </FieldDescription>
              <ButtonGroup>
                <Button
                  variant={isFullScreen === true ? "outline" : "default"}
                  onClick={() => toggleWindowMode(false)}
                >
                  Windowed
                </Button>
                <Button
                  variant={isFullScreen === false ? "outline" : "default"}
                  onClick={() => toggleWindowMode(true)}
                >
                  Fullscreen
                </Button>
              </ButtonGroup>
            </Field>

            <Field>
              <Label>Master volume</Label>
              <FieldDescription>
                {formatPlaybackVolume(playbackVolume)}. {shortcutHint(keybindings, "volumeUp")} /
                {shortcutHint(keybindings, "volumeDown")} adjust this while singing.
              </FieldDescription>
              <Slider
                min={MIN_PLAYBACK_VOLUME * 100}
                max={MAX_PLAYBACK_VOLUME * 100}
                step={1}
                value={[Math.round(playbackVolume * 100)]}
                onValueChange={([value]) => updatePlaybackVolume(value / 100)}
              />
            </Field>

            <Field>
              <Label>USDX lyric display offset</Label>
              <FieldDescription>
                Positive values delay USDX lyrics; negative values show them earlier.
              </FieldDescription>
              <div className="flex items-center gap-3">
                <Slider
                  min={MIN_USDX_LYRIC_DISPLAY_OFFSET_MS}
                  max={MAX_USDX_LYRIC_DISPLAY_OFFSET_MS}
                  step={10}
                  value={[settings.usdxLyricDisplayOffsetMs]}
                  onValueChange={([value]) => updateUsdxOffset(value)}
                />
                <Input
                  className="w-28 bg-white/10 text-right text-white"
                  type="number"
                  min={MIN_USDX_LYRIC_DISPLAY_OFFSET_MS}
                  max={MAX_USDX_LYRIC_DISPLAY_OFFSET_MS}
                  step={10}
                  value={settings.usdxLyricDisplayOffsetMs}
                  onChange={(event) => updateUsdxOffset(event.currentTarget.valueAsNumber)}
                  aria-label="USDX lyric display offset in milliseconds"
                />
                <span className="text-sm text-white/60">ms</span>
              </div>
            </Field>

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
            <Button variant="ghost" onClick={restoreDefaults}>
              Restore Defaults
            </Button>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <KeyboardShortcutsDialog
        config={config}
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </>
  );
}
