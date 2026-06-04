export type Word = {
  word: string;
  display?: string;
  start: number;
  end: number;
  pitch?: number;
  beat?: number;
  length?: number;
  score?: number;
  estimated?: boolean;
  reading?: string;
};

export type Segment = {
  text: string;
  start: number;
  end: number;
  words: Word[];
};

export type Transcript = {
  language: string;
  segments: Segment[];
  source?: string;
};

export type AudioPaths = {
  instrumental: string;
  vocals: string;
};
