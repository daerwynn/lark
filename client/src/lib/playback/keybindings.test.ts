import { describe, expect, it } from "vitest";

import {
  actionForShortcutCode,
  assignPlaybackShortcut,
  keyboardEventMatchesShortcut,
  playbackKeybindingsFromConfig,
  shortcutDisplay,
  shortcutFromKeyboardEvent,
  shortcutHint,
} from "./keybindings";

function keyboardEvent(init: Partial<KeyboardEventInit> & { code: string }): KeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...init,
    code: init.code,
  } as KeyboardEvent;
}

describe("playback keybindings", () => {
  it("loads default playback shortcuts", () => {
    const bindings = playbackKeybindingsFromConfig(null);

    expect(bindings.playPause).toBe("Space");
    expect(bindings.skipBack5).toBe("ArrowLeft");
    expect(shortcutHint(bindings, "volumeUp")).toBe("[Up]");
  });

  it("applies config overrides and unassigned shortcuts", () => {
    const bindings = playbackKeybindingsFromConfig({
      playback_keybindings: {
        playPause: "KeyK",
        volumeUp: "",
      },
    } as never);

    expect(bindings.playPause).toBe("KeyK");
    expect(bindings.volumeUp).toBeNull();
    expect(shortcutDisplay(bindings.volumeUp)).toBe("Unassigned");
  });

  it("captures keyboard events as shortcut strings", () => {
    expect(shortcutFromKeyboardEvent(keyboardEvent({ code: "KeyK" }))).toBe("KeyK");
    expect(shortcutFromKeyboardEvent(keyboardEvent({ code: "KeyK", ctrlKey: true }))).toBe(
      "Ctrl+KeyK",
    );
    expect(
      shortcutFromKeyboardEvent(keyboardEvent({ code: "ShiftLeft", shiftKey: true })),
    ).toBeNull();
  });

  it("matches shortcuts by physical code and optional exact modifiers", () => {
    expect(
      keyboardEventMatchesShortcut(keyboardEvent({ code: "KeyP", shiftKey: true }), "KeyP"),
    ).toBe(true);
    expect(
      keyboardEventMatchesShortcut(keyboardEvent({ code: "KeyP", ctrlKey: true }), "Ctrl+KeyP"),
    ).toBe(true);
    expect(keyboardEventMatchesShortcut(keyboardEvent({ code: "KeyP" }), "Ctrl+KeyP")).toBe(false);
  });

  it("steals duplicate shortcuts from the previous action", () => {
    const bindings = playbackKeybindingsFromConfig(null);
    const next = assignPlaybackShortcut(bindings, "playPause", "ArrowLeft");

    expect(next.playPause).toBe("ArrowLeft");
    expect(next.skipBack5).toBeNull();
    expect(actionForShortcutCode(next, "ArrowLeft")).toBe("playPause");
  });

  it("formats shortcut labels for display", () => {
    expect(shortcutDisplay("KeyP")).toBe("P");
    expect(shortcutDisplay("Ctrl+Shift+KeyP")).toBe("Ctrl+Shift+P");
    expect(shortcutDisplay("ArrowLeft")).toBe("Left");
  });
});
