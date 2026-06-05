import { triggerFrontendReady } from "@/bridge/window";
import { isFullScreen as tauriIsFullScreen, setFullScreen } from "@/bridge/fullScreen";
import { loadConfig, saveConfig } from "@/bridge/config";
import { isTauri } from "@/bridge/runtime";
import {
  keyboardEventMatchesShortcut,
  playbackKeybindingsFromConfig,
} from "@/lib/playback/keybindings";
import { useEffect } from "react";

function isManagedShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest("[role='dialog'], [role='slider'], [role='menu'], [role='listbox']")) {
    return true;
  }
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

export function TauriAppShell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    triggerFrontendReady();
  }, []);

  useEffect(() => {
    if (!isTauri) return;

    const onKeyDown = async (e: KeyboardEvent) => {
      if (isManagedShortcutTarget(e.target)) return;

      const config = await loadConfig();
      const keybindings = playbackKeybindingsFromConfig(config);
      if (!keyboardEventMatchesShortcut(e, keybindings.fullscreen)) return;
      e.preventDefault();
      e.stopPropagation();

      const current = await tauriIsFullScreen();
      const next = !current;

      await Promise.all([setFullScreen(next), saveConfig({ ...config, fullscreen: next })]);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return children;
}
