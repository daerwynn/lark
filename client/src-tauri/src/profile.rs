use app_core::{ProfileStore, VocalCalibration};

#[tauri::command]
pub fn load_profiles() -> ProfileStore {
    ProfileStore::load()
}

#[tauri::command]
pub fn create_profile(name: String) {
    let mut profile_store = ProfileStore::load();

    profile_store.create_profile(name);
}

#[tauri::command]
pub fn switch_profile(name: String) {
    let mut profile_store = ProfileStore::load();

    profile_store.switch_profile(&name);
}

#[tauri::command]
pub fn delete_profile(name: String) {
    let mut profile_store = ProfileStore::load();

    profile_store.delete_profile(&name);
}

#[tauri::command]
pub fn add_score(song_hash: String, score: u32) {
    let mut profile_store = ProfileStore::load();

    profile_store.add_score(&song_hash, score);
}

#[tauri::command]
pub fn save_vocal_calibration(profile: String, calibration: VocalCalibration) -> ProfileStore {
    let mut profile_store = ProfileStore::load();

    profile_store.save_vocal_calibration(&profile, calibration);
    profile_store
}

#[tauri::command]
pub fn clear_vocal_calibration(profile: String) -> ProfileStore {
    let mut profile_store = ProfileStore::load();

    profile_store.clear_vocal_calibration(&profile);
    profile_store
}
