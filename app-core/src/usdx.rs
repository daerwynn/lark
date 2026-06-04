//! UltraStar Deluxe (USDX) song-file support.
//!
//! Implements just enough of the [usdx.eu/format](https://usdx.eu/format/) spec to:
//!   - Parse the header tags + note body (absolute and `#RELATIVE:yes` timing).
//!   - Resolve sibling media (`#AUDIO`/`#MP3`, `#VOCALS`, `#INSTRUMENTAL`, `#VIDEO`, `#COVER`).
//!   - Synthesize a transcript JSON identical in shape to what the analyzer pipeline writes,
//!     so the rest of the playback pipeline reuses the cache transparently.

use std::path::{Path, PathBuf};

use lofty::file::{AudioFile, TaggedFileExt};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::cache::CacheDir;
use crate::error::NightingaleError;
use crate::library_db;
use crate::song::{Song, TranscriptSource, compute_file_hash};

/// Parsed USDX file, reduced to the fields that drive transcript synthesis and
/// sibling-file resolution. Note kinds (golden / freestyle / rap / …) and unread
/// tags are discarded at parse time.
struct UsdxFile {
    title: String,
    artist: String,
    audio_filename: String,
    vocals_filename: Option<String>,
    instrumental_filename: Option<String>,
    video_filename: Option<String>,
    cover_filename: Option<String>,
    language: Option<String>,
    edition: Option<String>,
    end_ms: Option<f64>,
    bpm: f64,
    gap_ms: f64,
    phrases: Vec<Vec<UsdxNote>>,
}

struct UsdxNote {
    /// Absolute beat (relative-mode files have already had the line offset folded in).
    beat: i64,
    length: i64,
    pitch: i32,
    text: String,
}

impl UsdxFile {
    fn original_timing(&self) -> UsdxTiming {
        UsdxTiming {
            gap_ms: self.gap_ms,
            bpm: self.bpm,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct UsdxTiming {
    gap_ms: f64,
    bpm: f64,
}

/// Local, non-destructive USDX timing correction. Values are effective chart
/// values, not deltas, so reset can always return to the parsed TXT values.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq)]
#[ts(export)]
pub struct UsdxTimingOverride {
    pub gap_ms: f64,
    pub bpm: f64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct UsdxTimingInfo {
    pub file_hash: String,
    pub txt_path: PathBuf,
    pub txt_file_name: String,
    pub audio_path: PathBuf,
    pub audio_file_name: String,
    pub parsed_bpm: f64,
    pub parsed_gap_ms: f64,
    pub effective_bpm: f64,
    pub effective_gap_ms: f64,
    pub offset_ms: f64,
    pub audio_duration_secs: f64,
    pub first_note_time_secs: Option<f64>,
    pub last_note_end_secs: Option<f64>,
    /// `last_note_end_secs - audio_duration_secs`; positive means the chart
    /// extends past the audio, negative means it ends before the audio.
    pub chart_audio_mismatch_secs: Option<f64>,
    pub has_override: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UsdxCalibrationAnchor {
    pub beat: f64,
    pub audio_time_secs: f64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct UsdxCalibrationPreview {
    pub timing_override: UsdxTimingOverride,
    pub offset_ms: f64,
    pub bpm_delta: f64,
    pub first_note_time_secs: Option<f64>,
    pub last_note_end_secs: Option<f64>,
    pub chart_audio_mismatch_secs: Option<f64>,
}

#[derive(Debug, Clone, Copy)]
struct UsdxChartMetrics {
    first_note_time_secs: Option<f64>,
    last_note_end_secs: Option<f64>,
    chart_audio_mismatch_secs: Option<f64>,
}

/// Sibling-file paths referenced by a USDX song, resolved relative to the .txt file's
/// parent directory. Stored on the Song row and consulted by playback to bypass the
/// stem-cache lookup entirely.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[ts(export)]
pub struct UsdxBundle {
    pub txt_path: PathBuf,
    pub audio: PathBuf,
    #[serde(default)]
    pub vocals: Option<PathBuf>,
    #[serde(default)]
    pub instrumental: Option<PathBuf>,
    #[serde(default)]
    pub video: Option<PathBuf>,
    #[serde(default)]
    pub timing_override: Option<UsdxTimingOverride>,
}

/// `#BPM` counts UltraStar quarter-note beats per minute, and a note beat is
/// 1/4 of one of those, so seconds per note beat is `60 / (BPM * 4)`.
fn beat_to_seconds(beat: f64, timing: UsdxTiming) -> f64 {
    timing.gap_ms / 1000.0 + beat * 60.0 / (timing.bpm * 4.0)
}

fn timing_from_override(
    original: UsdxTiming,
    timing_override: Option<UsdxTimingOverride>,
) -> UsdxTiming {
    timing_override
        .and_then(|o| sanitize_timing(o.gap_ms, o.bpm))
        .unwrap_or(original)
}

fn sanitize_timing(gap_ms: f64, bpm: f64) -> Option<UsdxTiming> {
    if !gap_ms.is_finite() || !bpm.is_finite() || bpm <= 0.0 {
        return None;
    }
    Some(UsdxTiming { gap_ms, bpm })
}

fn sanitize_override(
    timing_override: UsdxTimingOverride,
) -> Result<UsdxTimingOverride, NightingaleError> {
    if sanitize_timing(timing_override.gap_ms, timing_override.bpm).is_none() {
        return Err(NightingaleError::Other(
            "USDX timing override requires a finite GAP and positive BPM".into(),
        ));
    }
    Ok(timing_override)
}

#[cfg(test)]
fn apply_offset(timing: UsdxTiming, delta_ms: f64) -> Option<UsdxTiming> {
    sanitize_timing(timing.gap_ms + delta_ms, timing.bpm)
}

#[cfg(test)]
fn apply_bpm(timing: UsdxTiming, bpm: f64) -> Option<UsdxTiming> {
    sanitize_timing(timing.gap_ms, bpm)
}

fn first_last_note_beats(file: &UsdxFile) -> (Option<f64>, Option<f64>) {
    let mut first: Option<f64> = None;
    let mut last: Option<f64> = None;

    for note in file.phrases.iter().flatten() {
        let start = note.beat as f64;
        let end = (note.beat + note.length) as f64;
        first = Some(first.map_or(start, |value| value.min(start)));
        last = Some(last.map_or(end, |value| value.max(end)));
    }

    (first, last)
}

fn chart_metrics(
    file: &UsdxFile,
    timing: UsdxTiming,
    audio_duration_secs: f64,
) -> UsdxChartMetrics {
    let (first_beat, last_beat) = first_last_note_beats(file);
    let first_note_time_secs = first_beat.map(|beat| round3(beat_to_seconds(beat, timing)));
    let last_note_end_secs = last_beat.map(|beat| round3(beat_to_seconds(beat, timing)));
    let chart_audio_mismatch_secs = last_note_end_secs
        .filter(|_| audio_duration_secs.is_finite() && audio_duration_secs > 0.0)
        .map(|end| round3(end - audio_duration_secs));

    UsdxChartMetrics {
        first_note_time_secs,
        last_note_end_secs,
        chart_audio_mismatch_secs,
    }
}

fn solve_two_anchor_timing(
    early: UsdxCalibrationAnchor,
    late: UsdxCalibrationAnchor,
) -> Result<UsdxTiming, NightingaleError> {
    if !early.beat.is_finite()
        || !late.beat.is_finite()
        || !early.audio_time_secs.is_finite()
        || !late.audio_time_secs.is_finite()
    {
        return Err(NightingaleError::Other(
            "Calibration anchors must use finite beat and audio times".into(),
        ));
    }

    let beat_delta = late.beat - early.beat;
    let time_delta = late.audio_time_secs - early.audio_time_secs;
    if beat_delta.abs() < f64::EPSILON || time_delta <= 0.0 {
        return Err(NightingaleError::Other(
            "Calibration needs two different chart beats with the later lyric marked later in audio"
                .into(),
        ));
    }

    let seconds_per_beat = time_delta / beat_delta;
    if seconds_per_beat <= 0.0 || !seconds_per_beat.is_finite() {
        return Err(NightingaleError::Other(
            "Calibration anchors produced an invalid time scale".into(),
        ));
    }

    let bpm = 60.0 / (seconds_per_beat * 4.0);
    let gap_ms = (early.audio_time_secs - early.beat * seconds_per_beat) * 1000.0;
    sanitize_timing(gap_ms, bpm).ok_or_else(|| {
        NightingaleError::Other("Calibration anchors produced invalid USDX timing".into())
    })
}

// ─── Parsing ─────────────────────────────────────────────────────────

fn parse_usdx_path(path: &Path) -> Result<UsdxFile, NightingaleError> {
    let bytes = std::fs::read(path)?;
    let content = decode_text(&bytes);
    parse_usdx_str(&content)
}

fn parse_usdx_str(content: &str) -> Result<UsdxFile, NightingaleError> {
    let mut title: Option<String> = None;
    let mut artist: Option<String> = None;
    let mut audio_filename: Option<String> = None;
    let mut vocals_filename: Option<String> = None;
    let mut instrumental_filename: Option<String> = None;
    let mut video_filename: Option<String> = None;
    let mut cover_filename: Option<String> = None;
    let mut language: Option<String> = None;
    let mut edition: Option<String> = None;
    let mut end_ms: Option<f64> = None;
    let mut bpm: Option<f64> = None;
    let mut gap_ms: f64 = 0.0;
    let mut relative = false;

    let mut phrases: Vec<Vec<UsdxNote>> = Vec::new();
    let mut current: Vec<UsdxNote> = Vec::new();
    let mut line_offset: i64 = 0;
    let mut in_notes = false;

    for raw in content.lines() {
        let line = raw.trim_end_matches('\r');
        let trimmed = line.trim_start();

        if trimmed.is_empty() {
            continue;
        }

        if !in_notes && trimmed.starts_with('#') {
            if let Some((key, value)) = parse_tag(trimmed) {
                match key.to_ascii_uppercase().as_str() {
                    "TITLE" => title = non_empty(value),
                    "ARTIST" => artist = non_empty(value),
                    // `#AUDIO` is the v1.1.0 successor to `#MP3`; prefer it when both are set.
                    "AUDIO" => audio_filename = non_empty(value),
                    "MP3" if audio_filename.is_none() => audio_filename = non_empty(value),
                    "VOCALS" => vocals_filename = non_empty(value),
                    "INSTRUMENTAL" => instrumental_filename = non_empty(value),
                    "VIDEO" => video_filename = non_empty(value),
                    "COVER" => cover_filename = non_empty(value),
                    "LANGUAGE" => {
                        language = value
                            .split(',')
                            .next()
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty());
                    }
                    "EDITION" => {
                        edition = value
                            .split(',')
                            .next()
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty());
                    }
                    "BPM" => {
                        bpm = value.trim().replace(',', ".").parse::<f64>().ok();
                    }
                    "GAP" => {
                        gap_ms = value.trim().replace(',', ".").parse::<f64>().unwrap_or(0.0);
                    }
                    "END" => {
                        end_ms = value.trim().replace(',', ".").parse::<f64>().ok();
                    }
                    "RELATIVE" => {
                        relative = value.trim().eq_ignore_ascii_case("yes");
                    }
                    _ => {}
                }
            }
            continue;
        }

        in_notes = true;

        let Some(first) = trimmed.chars().next() else {
            continue;
        };

        match first {
            ':' | '*' | 'F' | 'R' | 'G' => {
                if let Some(note) = parse_note(&trimmed[first.len_utf8()..], line_offset, relative)
                {
                    current.push(note);
                }
            }
            '-' => {
                if !current.is_empty() {
                    phrases.push(std::mem::take(&mut current));
                }
                if relative {
                    if let Some(delta) = leading_int(&trimmed[1..]) {
                        line_offset += delta;
                    }
                }
            }
            'E' => break,
            _ => continue,
        }
    }

    if !current.is_empty() {
        phrases.push(current);
    }

    let title = title.ok_or_else(|| NightingaleError::Other("Missing #TITLE tag".into()))?;
    let artist = artist.ok_or_else(|| NightingaleError::Other("Missing #ARTIST tag".into()))?;
    let audio_filename =
        audio_filename.ok_or_else(|| NightingaleError::Other("Missing #AUDIO/#MP3 tag".into()))?;
    let bpm = bpm
        .filter(|v| *v > 0.0)
        .ok_or_else(|| NightingaleError::Other("Missing or invalid #BPM tag".into()))?;

    Ok(UsdxFile {
        title,
        artist,
        audio_filename,
        vocals_filename,
        instrumental_filename,
        video_filename,
        cover_filename,
        language,
        edition,
        end_ms,
        bpm,
        gap_ms,
        phrases,
    })
}

fn non_empty(value: String) -> Option<String> {
    Some(value).filter(|s| !s.is_empty())
}

fn parse_tag(line: &str) -> Option<(String, String)> {
    let after_hash = line.strip_prefix('#')?;
    let (key, value) = after_hash.split_once(':')?;
    Some((key.trim().to_string(), value.trim().to_string()))
}

fn parse_note(rest: &str, line_offset: i64, relative: bool) -> Option<UsdxNote> {
    let mut s = rest;
    let beat = consume_int(&mut s)?;
    let length = consume_int(&mut s)?;
    let pitch = consume_int(&mut s)? as i32;
    let text = consume_text_remainder(s);

    Some(UsdxNote {
        beat: if relative { line_offset + beat } else { beat },
        length: length.max(0),
        pitch,
        text,
    })
}

fn leading_int(rest: &str) -> Option<i64> {
    let mut s = rest;
    consume_int(&mut s)
}

fn consume_int(s: &mut &str) -> Option<i64> {
    *s = s.trim_start_matches([' ', '\t']);
    let bytes = s.as_bytes();
    if bytes.is_empty() {
        return None;
    }
    let mut i = 0usize;
    if bytes[0] == b'-' || bytes[0] == b'+' {
        i = 1;
    }
    let digits_start = i;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i == digits_start {
        return None;
    }
    let n = s[..i].parse::<i64>().ok()?;
    *s = &s[i..];
    Some(n)
}

/// Consume exactly one separator (space or tab) and return the rest verbatim.
/// USDX preserves leading spaces in note text as a "new word starts here" marker.
fn consume_text_remainder(s: &str) -> String {
    if let Some(rest) = s.strip_prefix([' ', '\t']) {
        rest.to_string()
    } else {
        s.to_string()
    }
}

// ─── Encoding ────────────────────────────────────────────────────────

fn decode_text(bytes: &[u8]) -> String {
    let stripped = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &bytes[3..]
    } else {
        bytes
    };

    if let Ok(s) = std::str::from_utf8(stripped) {
        return s.to_string();
    }

    stripped.iter().map(|&b| cp1252_to_char(b)).collect()
}

fn cp1252_to_char(b: u8) -> char {
    match b {
        0x80 => '\u{20AC}',
        0x82 => '\u{201A}',
        0x83 => '\u{0192}',
        0x84 => '\u{201E}',
        0x85 => '\u{2026}',
        0x86 => '\u{2020}',
        0x87 => '\u{2021}',
        0x88 => '\u{02C6}',
        0x89 => '\u{2030}',
        0x8A => '\u{0160}',
        0x8B => '\u{2039}',
        0x8C => '\u{0152}',
        0x8E => '\u{017D}',
        0x91 => '\u{2018}',
        0x92 => '\u{2019}',
        0x93 => '\u{201C}',
        0x94 => '\u{201D}',
        0x95 => '\u{2022}',
        0x96 => '\u{2013}',
        0x97 => '\u{2014}',
        0x98 => '\u{02DC}',
        0x99 => '\u{2122}',
        0x9A => '\u{0161}',
        0x9B => '\u{203A}',
        0x9C => '\u{0153}',
        0x9E => '\u{017E}',
        0x9F => '\u{0178}',
        _ => b as char,
    }
}

// ─── Sibling resolution ──────────────────────────────────────────────

fn resolve_sibling(parent: &Path, name: Option<&str>) -> Option<PathBuf> {
    let trimmed = name.map(str::trim).filter(|s| !s.is_empty())?;
    let candidate = parent.join(trimmed);
    candidate.is_file().then_some(candidate)
}

fn resolve_bundle(file: &UsdxFile, txt_path: &Path) -> Result<UsdxBundle, NightingaleError> {
    let parent = txt_path
        .parent()
        .ok_or_else(|| NightingaleError::Other("USDX file has no parent directory".into()))?;

    let audio = parent.join(file.audio_filename.trim());
    if !audio.is_file() {
        return Err(NightingaleError::Other(format!(
            "USDX audio file not found: {}",
            audio.display()
        )));
    }

    Ok(UsdxBundle {
        txt_path: txt_path.to_path_buf(),
        audio,
        vocals: resolve_sibling(parent, file.vocals_filename.as_deref()),
        instrumental: resolve_sibling(parent, file.instrumental_filename.as_deref()),
        video: resolve_sibling(parent, file.video_filename.as_deref()),
        timing_override: None,
    })
}

/// Sibling media filenames a USDX descriptor "claims" — used by the scanner so we
/// don't end up with a duplicate raw audio/video song row alongside the USDX one.
pub struct UsdxSiblings {
    pub audio: PathBuf,
    pub vocals: Option<PathBuf>,
    pub instrumental: Option<PathBuf>,
    pub video: Option<PathBuf>,
}

pub fn read_siblings(path: &Path) -> Option<UsdxSiblings> {
    let file = parse_usdx_path(path).ok()?;
    let parent = path.parent()?.to_path_buf();
    Some(UsdxSiblings {
        audio: parent.join(file.audio_filename.trim()),
        vocals: file
            .vocals_filename
            .as_deref()
            .map(|n| parent.join(n.trim())),
        instrumental: file
            .instrumental_filename
            .as_deref()
            .map(|n| parent.join(n.trim())),
        video: file
            .video_filename
            .as_deref()
            .map(|n| parent.join(n.trim())),
    })
}

// ─── Detection sniff (for scanner) ───────────────────────────────────

/// Cheap content sniff: is this `.txt` actually a USDX song descriptor?
/// Reads the first ~2 KB of the file and looks for the minimum required tags.
pub fn looks_like_usdx(path: &Path) -> bool {
    let Ok(mut f) = std::fs::File::open(path) else {
        return false;
    };
    let mut buf = [0u8; 2048];
    use std::io::Read;
    let n = match f.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return false,
    };
    let head = decode_text(&buf[..n]);
    let upper = head.to_ascii_uppercase();
    upper.contains("#TITLE") && (upper.contains("#MP3") || upper.contains("#AUDIO"))
}

// ─── Transcript synthesis ────────────────────────────────────────────

fn round3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

fn usdx_display_fragment(text: &str) -> String {
    let trimmed = text.trim();
    if let Some(rest) = trimmed.strip_prefix('~') {
        if rest.is_empty() {
            return String::new();
        }
        if rest
            .chars()
            .all(|ch| !ch.is_alphanumeric() && !ch.is_whitespace())
        {
            return rest.to_string();
        }
    }

    text.to_string()
}

/// Produce a transcript JSON shaped exactly like what `transcribe.py` emits, so the
/// existing client + playback pipeline reuses cached files transparently.
fn synthesize_transcript_with_timing(file: &UsdxFile, timing: UsdxTiming) -> serde_json::Value {
    use serde_json::json;

    let mut segments: Vec<serde_json::Value> = Vec::new();

    for phrase in &file.phrases {
        if phrase.is_empty() {
            continue;
        }

        let mut words: Vec<serde_json::Value> = Vec::new();
        let mut text_buf = String::new();
        let mut first_start: Option<f64> = None;
        let mut last_end: f64 = 0.0;

        for note in phrase {
            let start = beat_to_seconds(note.beat as f64, timing);
            let end = beat_to_seconds((note.beat + note.length) as f64, timing);
            if first_start.is_none() {
                first_start = Some(start);
            }
            last_end = end;

            let word = note.text.trim();
            let display = usdx_display_fragment(&note.text);
            text_buf.push_str(&display);

            words.push(json!({
                "word": word,
                "display": display,
                "start": round3(start),
                "end": round3(end),
                "pitch": note.pitch,
                "beat": note.beat as f64,
                "length": note.length as f64,
            }));
        }

        if words.is_empty() {
            continue;
        }

        segments.push(json!({
            "text": text_buf.trim(),
            "start": round3(first_start.unwrap_or(0.0)),
            "end": round3(last_end),
            "words": words,
        }));
    }

    let language = file.language.clone().unwrap_or_else(|| "Unknown".into());

    json!({
        "language": language,
        "segments": segments,
        "source": "usdx",
    })
}

fn synthesize_transcript(file: &UsdxFile) -> serde_json::Value {
    synthesize_transcript_with_timing(file, file.original_timing())
}

pub fn synthesize_transcript_for_song(song: &Song) -> Result<serde_json::Value, NightingaleError> {
    let bundle = song
        .usdx
        .as_ref()
        .ok_or_else(|| NightingaleError::Other("Song is not a USDX song".into()))?;
    let file = parse_usdx_path(&bundle.txt_path)?;
    let timing = timing_from_override(file.original_timing(), bundle.timing_override);
    Ok(synthesize_transcript_with_timing(&file, timing))
}

fn usdx_song_for_hash(file_hash: &str) -> Result<Song, NightingaleError> {
    let song = library_db::load_song_by_hash(file_hash)
        .map_err(|e| NightingaleError::Other(e.to_string()))?
        .ok_or_else(|| NightingaleError::Other("Song not found".into()))?;
    if song.usdx.is_none() {
        return Err(NightingaleError::Other("Song is not a USDX song".into()));
    }
    Ok(song)
}

fn path_file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn audio_duration_for_song(song: &Song, file: &UsdxFile, bundle: &UsdxBundle) -> f64 {
    if song.duration_secs.is_finite() && song.duration_secs > 0.0 {
        return song.duration_secs;
    }

    let (duration, _) = read_audio_metadata(&bundle.audio);
    if duration.is_finite() && duration > 0.0 {
        return duration;
    }

    file.end_ms.map(|ms| ms / 1000.0).unwrap_or(0.0)
}

fn timing_info_for_song(file_hash: &str, song: &Song) -> Result<UsdxTimingInfo, NightingaleError> {
    let bundle = song
        .usdx
        .as_ref()
        .ok_or_else(|| NightingaleError::Other("Song is not a USDX song".into()))?;
    let file = parse_usdx_path(&bundle.txt_path)?;
    let original = file.original_timing();
    let effective = timing_from_override(original, bundle.timing_override);
    let audio_duration_secs = audio_duration_for_song(song, &file, bundle);
    let metrics = chart_metrics(&file, effective, audio_duration_secs);

    Ok(UsdxTimingInfo {
        file_hash: file_hash.to_string(),
        txt_path: bundle.txt_path.clone(),
        txt_file_name: path_file_name(&bundle.txt_path),
        audio_path: bundle.audio.clone(),
        audio_file_name: path_file_name(&bundle.audio),
        parsed_bpm: original.bpm,
        parsed_gap_ms: original.gap_ms,
        effective_bpm: effective.bpm,
        effective_gap_ms: effective.gap_ms,
        offset_ms: effective.gap_ms - original.gap_ms,
        audio_duration_secs: round3(audio_duration_secs),
        first_note_time_secs: metrics.first_note_time_secs,
        last_note_end_secs: metrics.last_note_end_secs,
        chart_audio_mismatch_secs: metrics.chart_audio_mismatch_secs,
        has_override: bundle.timing_override.is_some(),
    })
}

pub fn load_usdx_timing_info(file_hash: &str) -> Result<UsdxTimingInfo, NightingaleError> {
    let song = usdx_song_for_hash(file_hash)?;
    timing_info_for_song(file_hash, &song)
}

pub fn preview_usdx_calibration(
    file_hash: &str,
    early_anchor: UsdxCalibrationAnchor,
    late_anchor: UsdxCalibrationAnchor,
) -> Result<UsdxCalibrationPreview, NightingaleError> {
    let song = usdx_song_for_hash(file_hash)?;
    let bundle = song
        .usdx
        .as_ref()
        .ok_or_else(|| NightingaleError::Other("Song is not a USDX song".into()))?;
    let file = parse_usdx_path(&bundle.txt_path)?;
    let original = file.original_timing();
    let solved = solve_two_anchor_timing(early_anchor, late_anchor)?;
    let audio_duration_secs = audio_duration_for_song(&song, &file, bundle);
    let metrics = chart_metrics(&file, solved, audio_duration_secs);

    Ok(UsdxCalibrationPreview {
        timing_override: UsdxTimingOverride {
            gap_ms: solved.gap_ms,
            bpm: solved.bpm,
        },
        offset_ms: solved.gap_ms - original.gap_ms,
        bpm_delta: solved.bpm - original.bpm,
        first_note_time_secs: metrics.first_note_time_secs,
        last_note_end_secs: metrics.last_note_end_secs,
        chart_audio_mismatch_secs: metrics.chart_audio_mismatch_secs,
    })
}

pub fn save_usdx_timing_override(
    file_hash: &str,
    timing_override: UsdxTimingOverride,
) -> Result<UsdxTimingInfo, NightingaleError> {
    let mut song = usdx_song_for_hash(file_hash)?;
    let timing_override = sanitize_override(timing_override)?;
    let bundle = song
        .usdx
        .as_mut()
        .ok_or_else(|| NightingaleError::Other("Song is not a USDX song".into()))?;
    bundle.timing_override = Some(timing_override);
    library_db::update_song_fields(file_hash, &song).map_err(|e| e.to_string())?;
    timing_info_for_song(file_hash, &song)
}

pub fn reset_usdx_timing_override(file_hash: &str) -> Result<UsdxTimingInfo, NightingaleError> {
    let mut song = usdx_song_for_hash(file_hash)?;
    let bundle = song
        .usdx
        .as_mut()
        .ok_or_else(|| NightingaleError::Other("Song is not a USDX song".into()))?;
    bundle.timing_override = None;
    library_db::update_song_fields(file_hash, &song).map_err(|e| e.to_string())?;
    timing_info_for_song(file_hash, &song)
}

// ─── Song construction ───────────────────────────────────────────────

/// Read the audio file's container metadata for duration + embedded album art.
/// Used as a fallback when USDX doesn't ship a `#COVER` sibling file.
fn read_audio_metadata(path: &Path) -> (f64, Option<Vec<u8>>) {
    let Ok(tagged) = lofty::read_from_path(path) else {
        return (0.0, None);
    };
    let duration_secs = tagged.properties().duration().as_secs_f64();
    let cover_bytes = tagged
        .primary_tag()
        .or_else(|| tagged.first_tag())
        .and_then(|tag| tag.pictures().first().map(|pic| pic.data().to_vec()));
    (duration_secs, cover_bytes)
}

fn cache_album_art(cache: &CacheDir, bytes: &[u8]) -> Option<PathBuf> {
    if bytes.is_empty() {
        return None;
    }
    let cover_hash = blake3::hash(bytes).to_hex()[..32].to_string();
    let cover_path = cache.cover_path(&cover_hash);
    if !cover_path.exists() {
        std::fs::write(&cover_path, bytes).ok()?;
    }
    Some(cover_path)
}

/// Scan-time entry point. Parses the .txt, resolves sibling media, writes the
/// synthesized transcript JSON to the cache, and returns a fully-formed Song row
/// with `is_analyzed = true` so the analyzer queue never sees it.
pub fn build_usdx_song(path: &Path, cache: &CacheDir) -> Result<Song, NightingaleError> {
    let file = parse_usdx_path(path)?;
    let bundle = resolve_bundle(&file, path)?;

    let file_hash = compute_file_hash(path)?;

    let transcript_json = synthesize_transcript(&file);
    let transcript_path = cache.transcript_path(&file_hash);
    std::fs::write(
        &transcript_path,
        serde_json::to_string_pretty(&transcript_json)?,
    )?;

    let (audio_duration, embedded_cover) = read_audio_metadata(&bundle.audio);
    let duration_secs = if audio_duration > 0.0 {
        audio_duration
    } else {
        file.end_ms.map(|ms| ms / 1000.0).unwrap_or(0.0)
    };

    let cover_bytes = file
        .cover_filename
        .as_deref()
        .and_then(|name| {
            let p = path.parent()?.join(name.trim());
            std::fs::read(p).ok()
        })
        .or(embedded_cover);
    let album_art_path = cover_bytes
        .as_deref()
        .and_then(|b| cache_album_art(cache, b));

    let album = file.edition.clone().unwrap_or_else(|| "USDX".to_string());

    let song = Song {
        path: path.to_path_buf(),
        file_hash,
        title: file.title.clone(),
        artist: file.artist.clone(),
        album,
        duration_secs,
        album_art_path,
        is_analyzed: true,
        language: file.language.clone(),
        transcript_source: Some(TranscriptSource::Usdx),
        key: None,
        override_key: None,
        tempo: 1.0,
        key_offset: 0,
        is_video: false,
        usdx: Some(bundle),
        origin: crate::song::SongOrigin::LocalFile,
    };

    Ok(song)
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 0.001,
            "expected {expected}, got {actual}"
        );
    }

    fn transcript_for_notes(notes: &str) -> Value {
        let content =
            format!("#TITLE:Test\n#ARTIST:Tester\n#MP3:test.mp3\n#BPM:60\n#GAP:0\n{notes}\nE\n");
        let file = parse_usdx_str(&content).expect("USDX should parse");
        synthesize_transcript(&file)
    }

    #[test]
    fn converts_usdx_bpm_and_gap_to_seconds() {
        let timing = UsdxTiming {
            bpm: 60.0,
            gap_ms: 1500.0,
        };

        assert_close(beat_to_seconds(132.0, timing), 34.5);
        assert_close(beat_to_seconds(136.0, timing), 35.5);
    }

    #[test]
    fn applies_offset_adjustment_to_timing() {
        let timing = UsdxTiming {
            bpm: 60.0,
            gap_ms: 500.0,
        };
        let adjusted = apply_offset(timing, -250.0).expect("valid offset");

        assert_close(adjusted.gap_ms, 250.0);
        assert_close(beat_to_seconds(4.0, adjusted), 1.25);
    }

    #[test]
    fn applies_bpm_adjustment_to_time_scale() {
        let timing = UsdxTiming {
            bpm: 60.0,
            gap_ms: 0.0,
        };
        let adjusted = apply_bpm(timing, 120.0).expect("valid bpm");

        assert_close(adjusted.bpm, 120.0);
        assert_close(beat_to_seconds(8.0, timing), 2.0);
        assert_close(beat_to_seconds(8.0, adjusted), 1.0);
    }

    #[test]
    fn solves_two_anchor_calibration() {
        let timing = solve_two_anchor_timing(
            UsdxCalibrationAnchor {
                beat: 100.0,
                audio_time_secs: 27.0,
            },
            UsdxCalibrationAnchor {
                beat: 500.0,
                audio_time_secs: 127.0,
            },
        )
        .expect("anchors should solve");

        assert_close(timing.bpm, 60.0);
        assert_close(timing.gap_ms, 2000.0);
        assert_close(beat_to_seconds(100.0, timing), 27.0);
        assert_close(beat_to_seconds(500.0, timing), 127.0);
    }

    #[test]
    fn preserves_usdx_syllable_spacing_and_hides_standalone_continuation() {
        let transcript = transcript_for_notes(
            ": 132 2 -2 A\n\
             : 136 2 -2 greed \n\
             : 140 2 0 po\n\
             * 144 4 2 lite\n\
             : 150 1 5 ~\n\
             : 152 8 2 ly ",
        );
        let segment = &transcript["segments"][0];
        let words = segment["words"]
            .as_array()
            .expect("words should be present");

        assert_eq!(segment["text"].as_str(), Some("Agreed politely"));
        assert_eq!(words.len(), 6);
        assert_eq!(words[1]["word"].as_str(), Some("greed"));
        assert_eq!(words[1]["display"].as_str(), Some("greed "));
        assert_eq!(words[4]["word"].as_str(), Some("~"));
        assert_eq!(words[4]["display"].as_str(), Some(""));
        assert_eq!(words[5]["display"].as_str(), Some("ly "));

        let expected = [
            (33.0, 33.5, -2, 132.0, 2.0),
            (34.0, 34.5, -2, 136.0, 2.0),
            (35.0, 35.5, 0, 140.0, 2.0),
            (36.0, 37.0, 2, 144.0, 4.0),
            (37.5, 37.75, 5, 150.0, 1.0),
            (38.0, 40.0, 2, 152.0, 8.0),
        ];
        for (word, (start, end, pitch, beat, length)) in words.iter().zip(expected) {
            assert_eq!(word["start"].as_f64(), Some(start));
            assert_eq!(word["end"].as_f64(), Some(end));
            assert_eq!(word["pitch"].as_i64(), Some(pitch));
            assert_eq!(word["beat"].as_f64(), Some(beat));
            assert_eq!(word["length"].as_f64(), Some(length));
        }
    }

    #[test]
    fn preserves_punctuation_carried_by_tilde_continuations() {
        let transcript = transcript_for_notes(
            ": 0 1 0 Hi\n\
             : 1 1 0 ~,\n\
             -\n\
             : 4 1 0 Stop\n\
             : 5 1 0 ~!",
        );
        let segments = transcript["segments"]
            .as_array()
            .expect("segments should be present");

        assert_eq!(segments[0]["text"].as_str(), Some("Hi,"));
        assert_eq!(segments[0]["words"][1]["word"].as_str(), Some("~,"));
        assert_eq!(segments[0]["words"][1]["display"].as_str(), Some(","));
        assert_eq!(segments[1]["text"].as_str(), Some("Stop!"));
        assert_eq!(segments[1]["words"][1]["word"].as_str(), Some("~!"));
        assert_eq!(segments[1]["words"][1]["display"].as_str(), Some("!"));
    }
}
