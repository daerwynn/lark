import type { AppConfig } from "@/types/AppConfig";

export type PlaybackShortcutAction =
  | "playPause"
  | "pauseMenu"
  | "restart"
  | "skipBack5"
  | "skipForward5"
  | "volumeUp"
  | "volumeDown"
  | "fullscreen"
  | "practiceMode"
  | "usdxTiming"
  | "speedReset"
  | "speedDown"
  | "speedUp"
  | "loopStart"
  | "loopEnd"
  | "loopClear"
  | "loopRetry"
  | "guideToggle"
  | "guideUp"
  | "guideDown"
  | "micToggle"
  | "micCycle"
  | "micMonitorToggle"
  | "themeCycle"
  | "videoFlavorCycle";

export type PlaybackShortcutBindings = Record<PlaybackShortcutAction, string | null>;

export interface PlaybackShortcutDefinition {
  action: PlaybackShortcutAction;
  label: string;
  description: string;
  group: string;
  defaultShortcut: string;
}

export const PLAYBACK_SHORTCUTS: PlaybackShortcutDefinition[] = [
  {
    action: "playPause",
    label: "Play / pause",
    description: "Toggle song playback.",
    group: "Transport",
    defaultShortcut: "Space",
  },
  {
    action: "pauseMenu",
    label: "Pause menu",
    description: "Open or close the playback pause menu.",
    group: "Transport",
    defaultShortcut: "Escape",
  },
  {
    action: "restart",
    label: "Restart",
    description: "Seek to the beginning of the song.",
    group: "Transport",
    defaultShortcut: "Home",
  },
  {
    action: "skipBack5",
    label: "Back 5 seconds",
    description: "Jump backward during playback.",
    group: "Transport",
    defaultShortcut: "ArrowLeft",
  },
  {
    action: "skipForward5",
    label: "Forward 5 seconds",
    description: "Jump forward during playback.",
    group: "Transport",
    defaultShortcut: "ArrowRight",
  },
  {
    action: "volumeUp",
    label: "Volume up",
    description: "Raise master playback volume.",
    group: "Transport",
    defaultShortcut: "ArrowUp",
  },
  {
    action: "volumeDown",
    label: "Volume down",
    description: "Lower master playback volume.",
    group: "Transport",
    defaultShortcut: "ArrowDown",
  },
  {
    action: "fullscreen",
    label: "Fullscreen",
    description: "Toggle fullscreen/windowed mode.",
    group: "Transport",
    defaultShortcut: "F11",
  },
  {
    action: "speedReset",
    label: "Reset speed",
    description: "Reset practice playback speed to normal.",
    group: "Practice",
    defaultShortcut: "Digit0",
  },
  {
    action: "speedDown",
    label: "Slow down",
    description: "Lower the pitch-preserving playback speed.",
    group: "Practice",
    defaultShortcut: "Comma",
  },
  {
    action: "speedUp",
    label: "Speed up",
    description: "Raise the pitch-preserving playback speed.",
    group: "Practice",
    defaultShortcut: "Period",
  },
  {
    action: "practiceMode",
    label: "Practice mode",
    description: "Show or hide the Practice Mode overlay.",
    group: "Practice",
    defaultShortcut: "KeyP",
  },
  {
    action: "usdxTiming",
    label: "USDX timing panel",
    description: "Show or hide UltraStar timing calibration tools.",
    group: "Practice",
    defaultShortcut: "KeyU",
  },
  {
    action: "loopStart",
    label: "Loop start",
    description: "Mark the current practice loop start.",
    group: "Practice loop",
    defaultShortcut: "BracketLeft",
  },
  {
    action: "loopEnd",
    label: "Loop end",
    description: "Mark the current practice loop end.",
    group: "Practice loop",
    defaultShortcut: "BracketRight",
  },
  {
    action: "loopClear",
    label: "Clear loop",
    description: "Clear the active practice loop.",
    group: "Practice loop",
    defaultShortcut: "Backslash",
  },
  {
    action: "loopRetry",
    label: "Retry loop",
    description: "Restart the current practice loop.",
    group: "Practice loop",
    defaultShortcut: "Enter",
  },
  {
    action: "guideToggle",
    label: "Guide toggle",
    description: "Toggle guide vocals on or off.",
    group: "Audio and visuals",
    defaultShortcut: "KeyG",
  },
  {
    action: "guideUp",
    label: "Guide louder",
    description: "Raise guide-vocal volume.",
    group: "Audio and visuals",
    defaultShortcut: "Equal",
  },
  {
    action: "guideDown",
    label: "Guide quieter",
    description: "Lower guide-vocal volume.",
    group: "Audio and visuals",
    defaultShortcut: "Minus",
  },
  {
    action: "micToggle",
    label: "Microphone toggle",
    description: "Turn live pitch input on or off.",
    group: "Audio and visuals",
    defaultShortcut: "KeyM",
  },
  {
    action: "micCycle",
    label: "Cycle microphone",
    description: "Switch to the next microphone.",
    group: "Audio and visuals",
    defaultShortcut: "KeyN",
  },
  {
    action: "micMonitorToggle",
    label: "Mic monitor toggle",
    description: "Turn microphone monitoring on or off.",
    group: "Audio and visuals",
    defaultShortcut: "KeyR",
  },
  {
    action: "themeCycle",
    label: "Cycle theme",
    description: "Switch the background theme.",
    group: "Audio and visuals",
    defaultShortcut: "KeyT",
  },
  {
    action: "videoFlavorCycle",
    label: "Cycle video flavor",
    description: "Switch the current Pixabay video style.",
    group: "Audio and visuals",
    defaultShortcut: "KeyF",
  },
];

const PURE_MODIFIER_CODES = new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "MetaLeft",
  "MetaRight",
  "ShiftLeft",
  "ShiftRight",
]);

const CODE_LABELS: Record<string, string> = {
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Digit0: "0",
  Equal: "=",
  Escape: "Esc",
  Minus: "-",
  Period: ".",
  Slash: "/",
  Space: "Space",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
};

const ACTIONS = PLAYBACK_SHORTCUTS.map((definition) => definition.action);

function isPlaybackShortcutAction(value: string): value is PlaybackShortcutAction {
  return ACTIONS.includes(value as PlaybackShortcutAction);
}

function normalizeShortcut(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function playbackKeybindingsFromConfig(
  config: AppConfig | null | undefined,
): PlaybackShortcutBindings {
  const overrides = config?.playback_keybindings;
  const bindings = Object.fromEntries(
    PLAYBACK_SHORTCUTS.map((definition) => [definition.action, definition.defaultShortcut]),
  ) as PlaybackShortcutBindings;

  if (!overrides) {
    return bindings;
  }

  for (const [action, shortcut] of Object.entries(overrides)) {
    if (!isPlaybackShortcutAction(action)) continue;
    bindings[action] = normalizeShortcut(shortcut);
  }

  return bindings;
}

export function playbackKeybindingsToConfig(
  bindings: PlaybackShortcutBindings,
): Record<string, string> {
  return Object.fromEntries(
    PLAYBACK_SHORTCUTS.map((definition) => [definition.action, bindings[definition.action] ?? ""]),
  );
}

export function assignPlaybackShortcut(
  bindings: PlaybackShortcutBindings,
  action: PlaybackShortcutAction,
  shortcut: string | null,
): PlaybackShortcutBindings {
  const next = { ...bindings };
  const normalized = normalizeShortcut(shortcut);

  if (normalized) {
    for (const definition of PLAYBACK_SHORTCUTS) {
      if (definition.action !== action && next[definition.action] === normalized) {
        next[definition.action] = null;
      }
    }
  }

  next[action] = normalized;
  return next;
}

export function resetPlaybackShortcuts(): PlaybackShortcutBindings {
  return playbackKeybindingsFromConfig(null);
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent): string | null {
  if (!event.code || PURE_MODIFIER_CODES.has(event.code)) return null;

  const modifiers = [
    event.ctrlKey ? "Ctrl" : null,
    event.altKey ? "Alt" : null,
    event.shiftKey ? "Shift" : null,
    event.metaKey ? "Meta" : null,
  ].filter((modifier): modifier is string => modifier != null);

  return [...modifiers, event.code].join("+");
}

function parseShortcut(shortcut: string | null): {
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
} | null {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) return null;

  const parts = normalized.split("+");
  const code = parts[parts.length - 1];

  return {
    code,
    ctrl: parts.includes("Ctrl"),
    alt: parts.includes("Alt"),
    shift: parts.includes("Shift"),
    meta: parts.includes("Meta"),
  };
}

export function keyboardEventMatchesShortcut(
  event: KeyboardEvent,
  shortcut: string | null,
): boolean {
  const parsed = parseShortcut(shortcut);
  if (!parsed || event.code !== parsed.code) return false;

  const requiresModifiers = parsed.ctrl || parsed.alt || parsed.shift || parsed.meta;
  if (!requiresModifiers) return true;

  return (
    event.ctrlKey === parsed.ctrl &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift &&
    event.metaKey === parsed.meta
  );
}

export function actionForShortcutCode(
  bindings: PlaybackShortcutBindings,
  code: string,
): PlaybackShortcutAction | null {
  const match = PLAYBACK_SHORTCUTS.find((definition) => {
    const parsed = parseShortcut(bindings[definition.action]);
    return parsed?.code === code && !parsed.ctrl && !parsed.alt && !parsed.shift && !parsed.meta;
  });

  return match?.action ?? null;
}

function codeDisplay(code: string): string {
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  if (code.startsWith("Key") && code.length === 4) return code.slice(3);
  if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
  return code;
}

export function shortcutDisplay(shortcut: string | null): string {
  const parsed = parseShortcut(shortcut);
  if (!parsed) return "Unassigned";

  const modifiers = [
    parsed.ctrl ? "Ctrl" : null,
    parsed.alt ? "Alt" : null,
    parsed.shift ? "Shift" : null,
    parsed.meta ? "Meta" : null,
  ].filter((modifier): modifier is string => modifier != null);

  return [...modifiers, codeDisplay(parsed.code)].join("+");
}

export function shortcutHint(
  bindings: PlaybackShortcutBindings,
  action: PlaybackShortcutAction,
): string {
  return `[${shortcutDisplay(bindings[action])}]`;
}

export function shortcutListHint(
  bindings: PlaybackShortcutBindings,
  actions: PlaybackShortcutAction[],
): string {
  return `[${actions.map((action) => shortcutDisplay(bindings[action])).join(" / ")}]`;
}
