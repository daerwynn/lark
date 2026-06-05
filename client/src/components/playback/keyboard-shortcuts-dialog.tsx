import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfigMutation } from "@/mutations/use-config-mutation";
import {
  assignPlaybackShortcut,
  playbackKeybindingsFromConfig,
  playbackKeybindingsToConfig,
  PLAYBACK_SHORTCUTS,
  shortcutDisplay,
  shortcutFromKeyboardEvent,
  type PlaybackShortcutAction,
  type PlaybackShortcutBindings,
  type PlaybackShortcutDefinition,
} from "@/lib/playback/keybindings";
import type { AppConfig } from "@/types/AppConfig";
import { useEffect, useMemo, useState } from "react";

interface KeyboardShortcutsDialogProps {
  config: AppConfig | null;
  open: boolean;
  onClose: () => void;
}

function groupedShortcuts() {
  const groups: { group: string; actions: PlaybackShortcutDefinition[] }[] = [];

  for (const shortcut of PLAYBACK_SHORTCUTS) {
    let group = groups.find((entry) => entry.group === shortcut.group);
    if (!group) {
      group = { group: shortcut.group, actions: [] };
      groups.push(group);
    }
    group.actions.push(shortcut);
  }

  return groups;
}

function nextBindingConfig(
  bindings: PlaybackShortcutBindings,
  action: PlaybackShortcutAction,
  shortcut: string | null,
): Record<string, string> {
  return playbackKeybindingsToConfig(assignPlaybackShortcut(bindings, action, shortcut));
}

export function KeyboardShortcutsDialog({ config, open, onClose }: KeyboardShortcutsDialogProps) {
  const { mutate } = useConfigMutation();
  const [captureAction, setCaptureAction] = useState<PlaybackShortcutAction | null>(null);
  const bindings = useMemo(() => playbackKeybindingsFromConfig(config), [config]);
  const groups = useMemo(groupedShortcuts, []);

  useEffect(() => {
    if (!open) {
      setCaptureAction(null);
    }
  }, [open]);

  useEffect(() => {
    if (!captureAction) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setCaptureAction(null);
        return;
      }

      const shortcut = shortcutFromKeyboardEvent(event);
      if (!shortcut) return;

      mutate({
        playback_keybindings: nextBindingConfig(bindings, captureAction, shortcut),
      });
      setCaptureAction(null);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [bindings, captureAction, mutate]);

  const clearShortcut = (action: PlaybackShortcutAction) => {
    mutate({ playback_keybindings: nextBindingConfig(bindings, action, null) });
  };

  const restoreDefaults = () => {
    mutate({ playback_keybindings: null });
    setCaptureAction(null);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[88vh] overflow-y-auto bg-black text-white ring-white/20">
        <DialogHeader>
          <DialogTitle className="text-2xl">Keyboard Shortcuts</DialogTitle>
          <DialogDescription className="text-white/60">
            Choose Change, then press the key or key combination to use. Escape cancels capture.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.group} className="space-y-2">
              <h3 className="text-sm tracking-[0.16em] text-white/55 uppercase">{group.group}</h3>
              <div className="overflow-hidden rounded-sm border border-white/12">
                {group.actions.map((shortcut) => {
                  const capturing = captureAction === shortcut.action;

                  return (
                    <div
                      key={shortcut.action}
                      className="grid grid-cols-[minmax(0,1fr)_8rem_auto_auto] items-center gap-3 border-b border-white/10 bg-white/[0.035] px-3 py-2 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <p className="text-base font-semibold text-white">{shortcut.label}</p>
                        <p className="text-sm text-white/55">{shortcut.description}</p>
                      </div>

                      <p className="rounded-sm border border-white/15 bg-black/45 px-2 py-1 text-center font-mono text-sm text-white/90">
                        {capturing ? "Press key" : shortcutDisplay(bindings[shortcut.action])}
                      </p>

                      <Button
                        type="button"
                        variant={capturing ? "default" : "outline"}
                        onClick={() => setCaptureAction(shortcut.action)}
                      >
                        Change
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        disabled={bindings[shortcut.action] == null}
                        onClick={() => clearShortcut(shortcut.action)}
                      >
                        Clear
                      </Button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

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
  );
}
