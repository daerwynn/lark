import { ProfileStore } from "@/types/ProfileStore";
import type { VocalCalibration } from "@/types/VocalCalibration";
import { invoke } from "./runtime";

export const loadProfiles = async (): Promise<ProfileStore> => {
  return await invoke<ProfileStore>("load_profiles");
};

export const createProfile = async (name: string): Promise<void> => {
  return await invoke<void>("create_profile", { name });
};

export const switchProfile = async (name: string): Promise<void> => {
  return await invoke<void>("switch_profile", { name });
};

export const deleteProfile = async (name: string): Promise<void> => {
  return await invoke<void>("delete_profile", { name });
};

export const addScore = async (songHash: string, score: number): Promise<void> => {
  return await invoke<void>("add_score", { songHash, score });
};

export const saveVocalCalibration = async (
  profile: string,
  calibration: VocalCalibration,
): Promise<ProfileStore> => {
  return await invoke<ProfileStore>("save_vocal_calibration", { profile, calibration });
};

export const clearVocalCalibration = async (profile: string): Promise<ProfileStore> => {
  return await invoke<ProfileStore>("clear_vocal_calibration", { profile });
};
