use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ts_rs::TS;

use crate::cache::profiles_path;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ScoreRecord {
    pub profile: String,
    pub song_hash: String,
    pub score: u32,
    pub played_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VocalCalibration {
    pub profile: String,
    pub device_name: String,
    pub range_preset: String,
    pub pitch_offset_cents: f64,
    pub mic_latency_ms: f64,
    pub quality_score: f64,
    pub valid_frame_count: u32,
    pub transition_count: u32,
    pub offset_mad_cents: f64,
    pub latency_mad_ms: f64,
    pub sequence_version: u32,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[ts(export)]
pub struct ProfileStore {
    pub active: Option<String>,
    pub profiles: Vec<String>,
    #[serde(default)]
    pub scores: Vec<ScoreRecord>,
    #[serde(default)]
    pub vocal_calibrations: HashMap<String, VocalCalibration>,
}

impl ProfileStore {
    pub fn load() -> Self {
        let path = profiles_path();

        if path.is_file() {
            std::fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            Self::default()
        }
    }

    pub fn save(&self) {
        let path = profiles_path();

        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        if let Ok(json) = serde_json::to_string_pretty(self) {
            let _ = std::fs::write(path, json);
        }
    }

    pub fn create_profile(&mut self, name: String) {
        if !self.profiles.contains(&name) {
            self.profiles.push(name.clone());
        }

        self.active = Some(name);

        self.save();
    }

    pub fn switch_profile(&mut self, name: &str) {
        if self.profiles.contains(&name.to_string()) {
            self.active = Some(name.to_string());

            self.save();
        }
    }

    pub fn delete_profile(&mut self, name: &str) {
        self.profiles.retain(|n| n != name);

        self.scores.retain(|r| r.profile != name);
        self.vocal_calibrations.remove(name);

        if self.active.as_deref() == Some(name) {
            self.active = self.profiles.first().cloned();
        }

        self.save();
    }

    pub fn save_vocal_calibration(&mut self, profile: &str, mut calibration: VocalCalibration) {
        if !self.profiles.contains(&profile.to_string()) {
            return;
        }

        self.set_vocal_calibration(profile, &mut calibration);
        self.save();
    }

    fn set_vocal_calibration(&mut self, profile: &str, calibration: &mut VocalCalibration) {
        let now = current_unix_secs();
        let created_at = self
            .vocal_calibrations
            .get(profile)
            .map(|existing| existing.created_at)
            .unwrap_or(now);

        calibration.profile = profile.to_string();
        calibration.created_at = created_at;
        calibration.updated_at = now;
        self.vocal_calibrations
            .insert(profile.to_string(), calibration.clone());
    }

    pub fn clear_vocal_calibration(&mut self, profile: &str) {
        self.vocal_calibrations.remove(profile);
        self.save();
    }

    pub fn add_score(&mut self, song_hash: &str, score: u32) {
        let profile = match &self.active {
            Some(p) => p.clone(),
            None => return,
        };
        let played_at = current_unix_secs();
        self.scores.push(ScoreRecord {
            profile,
            song_hash: song_hash.to_string(),
            score,
            played_at,
        });
        self.save();
    }

    pub fn best_score(&self, song_hash: &str, profile: &str) -> Option<u32> {
        self.scores
            .iter()
            .filter(|r| r.song_hash == song_hash && r.profile == profile)
            .map(|r| r.score)
            .max()
    }

    pub fn top_scores_for_song(&self, song_hash: &str, limit: usize) -> Vec<(String, u32)> {
        let mut best: std::collections::HashMap<&str, u32> = std::collections::HashMap::new();
        for record in &self.scores {
            if record.song_hash == song_hash {
                let entry = best.entry(&record.profile).or_insert(0);
                if record.score > *entry {
                    *entry = record.score;
                }
            }
        }
        let mut sorted: Vec<(String, u32)> = best
            .into_iter()
            .map(|(name, score)| (name.to_string(), score))
            .collect();
        sorted.sort_by(|a, b| b.1.cmp(&a.1));
        sorted.truncate(limit);
        sorted
    }
}

fn current_unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{ProfileStore, VocalCalibration};

    fn calibration(profile: &str) -> VocalCalibration {
        VocalCalibration {
            profile: profile.to_string(),
            device_name: "Mic".into(),
            range_preset: "medium".into(),
            pitch_offset_cents: 12.0,
            mic_latency_ms: 85.0,
            quality_score: 92.0,
            valid_frame_count: 100,
            transition_count: 8,
            offset_mad_cents: 9.0,
            latency_mad_ms: 22.0,
            sequence_version: 1,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn loads_legacy_profile_store_without_calibrations() {
        let json = r#"{"active":"Ada","profiles":["Ada"],"scores":[]}"#;
        let store: ProfileStore = serde_json::from_str(json).unwrap();

        assert!(store.vocal_calibrations.is_empty());
    }

    #[test]
    fn saves_and_clears_vocal_calibration() {
        let mut store = ProfileStore {
            active: Some("Ada".into()),
            profiles: vec!["Ada".into()],
            scores: vec![],
            vocal_calibrations: Default::default(),
        };

        let mut entry = calibration("Ada");
        store.set_vocal_calibration("Ada", &mut entry);
        assert!(store.vocal_calibrations.contains_key("Ada"));

        store.vocal_calibrations.remove("Ada");
        assert!(!store.vocal_calibrations.contains_key("Ada"));
    }

    #[test]
    fn deleting_profile_removes_vocal_calibration() {
        let mut store = ProfileStore {
            active: Some("Ada".into()),
            profiles: vec!["Ada".into(), "Lin".into()],
            scores: vec![],
            vocal_calibrations: Default::default(),
        };
        let mut entry = calibration("Ada");
        store.set_vocal_calibration("Ada", &mut entry);

        store.profiles.retain(|n| n != "Ada");
        store.vocal_calibrations.remove("Ada");
        if store.active.as_deref() == Some("Ada") {
            store.active = store.profiles.first().cloned();
        }

        assert!(!store.vocal_calibrations.contains_key("Ada"));
        assert_eq!(store.active.as_deref(), Some("Lin"));
    }
}
