import { PROFILES } from "@/queries/keys";
import {
  clearVocalCalibration,
  createProfile,
  deleteProfile,
  saveVocalCalibration,
  switchProfile,
} from "@/bridge/profile";
import type { ProfileStore } from "@/types/ProfileStore";
import type { VocalCalibration } from "@/types/VocalCalibration";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const useProfileMutations = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, type }: { name: string; type: "create" | "switch" | "delete" }) => {
      switch (type) {
        case "create":
          return createProfile(name);
        case "switch":
          return switchProfile(name);
        case "delete":
          return deleteProfile(name);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROFILES });
    },
    onError: (error: Error) => {
      toast.error(`Error updating profiles: ${error.message}`);
    },
  });
};

export const useVocalCalibrationMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      profile,
      calibration,
      type,
    }: {
      profile: string;
      calibration?: VocalCalibration;
      type: "save" | "clear";
    }) => {
      if (type === "clear") {
        return clearVocalCalibration(profile);
      }
      if (!calibration) {
        throw new Error("Missing vocal calibration");
      }
      return saveVocalCalibration(profile, calibration);
    },
    onSuccess: (profileStore: ProfileStore) => {
      queryClient.setQueryData(PROFILES, profileStore);
    },
    onError: (error: Error) => {
      toast.error(`Error updating vocal calibration: ${error.message}`);
    },
  });
};
