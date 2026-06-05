import { midiToFrequency, type WarmupTone } from "@/lib/practice/vocal-warmups";

export interface ToneSequenceController {
  startMs: number;
  durationSec: number;
  stop: () => void;
}

function scheduleEnvelope(gain: AudioParam, start: number, end: number, level: number): void {
  const attack = 0.04;
  const release = 0.09;
  gain.setValueAtTime(0, start);
  gain.linearRampToValueAtTime(level, start + attack);
  gain.setValueAtTime(level, Math.max(start + attack, end - release));
  gain.linearRampToValueAtTime(0, end);
}

export function startToneSequence(
  sequence: WarmupTone[],
  onEnded: () => void,
): ToneSequenceController {
  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new AudioContextCtor();
  const master = context.createGain();
  const durationSec = sequence.reduce((max, tone) => Math.max(max, tone.endSec), 0);
  const startAt = context.currentTime + 0.12;
  const startMs = performance.now() + 120;
  const nodes: Array<OscillatorNode | GainNode> = [master];

  master.gain.value = 0.18;
  master.connect(context.destination);

  for (const tone of sequence) {
    if (tone.kind === "rest" || tone.startMidi == null) continue;

    const osc = context.createOscillator();
    const gain = context.createGain();
    const start = startAt + tone.startSec;
    const end = startAt + tone.endSec;
    const endMidi = tone.endMidi ?? tone.startMidi;

    osc.type = "sine";
    osc.frequency.setValueAtTime(midiToFrequency(tone.startMidi), start);
    if (tone.kind === "glide" && endMidi !== tone.startMidi) {
      osc.frequency.linearRampToValueAtTime(midiToFrequency(endMidi), end);
    }
    scheduleEnvelope(gain.gain, start, end, tone.calibrate ? 0.9 : 0.75);
    osc.connect(gain).connect(master);
    osc.start(start);
    osc.stop(end + 0.03);
    nodes.push(osc, gain);
  }

  const endTimer = window.setTimeout(onEnded, (durationSec + 0.25) * 1000);

  return {
    startMs,
    durationSec,
    stop: () => {
      window.clearTimeout(endTimer);
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch {
          // Already stopped or disconnected.
        }
      }
      void context.close().catch(() => {});
    },
  };
}
