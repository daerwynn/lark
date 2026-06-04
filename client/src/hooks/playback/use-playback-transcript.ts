/**
 * Loads the transcript for the current track and normalizes segments for display.
 */

import { loadTranscript } from "@/bridge/playback";
import type { Segment, Transcript } from "@/types/Transcript";
import { useCallback, useEffect, useState } from "react";
import { splitLongSegments } from "@/utils/playback/transcript-segments";

export function usePlaybackTranscript(fileHash: string) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [transcriptSource, setTranscriptSource] = useState("generated");

  const reloadTranscript = useCallback(async () => {
    const transcript: Transcript = await loadTranscript(fileHash);
    setSegments(splitLongSegments(transcript.segments));
    setTranscriptSource(transcript.source ?? "generated");
  }, [fileHash]);

  useEffect(() => {
    let cancelled = false;
    loadTranscript(fileHash).then((transcript: Transcript) => {
      if (cancelled) return;
      setSegments(splitLongSegments(transcript.segments));
      setTranscriptSource(transcript.source ?? "generated");
    });
    return () => {
      cancelled = true;
    };
  }, [fileHash]);

  return { segments, transcriptSource, reloadTranscript };
}
