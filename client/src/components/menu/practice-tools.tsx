import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDialog } from "@/hooks/use-dialog";
import { useProfiles } from "@/queries/use-profiles";
import { ActivityIcon, MicVocalIcon } from "lucide-react";

export function PracticeTools() {
  const { setMode } = useDialog();
  const { data: profiles } = useProfiles();
  const active = profiles?.active ?? null;
  const calibration = active ? profiles?.vocal_calibrations[active] : null;

  return (
    <section className="rounded-lg border border-border/70 bg-card/65 p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Practice Tools</h2>
          <p className="text-sm text-muted-foreground">
            Calibrate pitch tracking or run guided vocal warmups before choosing a song.
          </p>
        </div>
        {calibration ? (
          <Badge variant="secondary">Calibrated: {Math.round(calibration.quality_score)}%</Badge>
        ) : (
          <Badge variant="outline">No calibration</Badge>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          variant="outline"
          className="h-auto justify-start gap-3 p-3 text-left"
          onClick={() => setMode("vocal-calibration")}
        >
          <MicVocalIcon className="size-5 shrink-0" />
          <span>
            <span className="block font-semibold">Calibrate Voice</span>
            <span className="block text-xs text-muted-foreground">
              Sing a familiar warmup to tune pitch and latency.
            </span>
          </span>
        </Button>
        <Button
          variant="outline"
          className="h-auto justify-start gap-3 p-3 text-left"
          onClick={() => setMode("vocal-warmups")}
        >
          <ActivityIcon className="size-5 shrink-0" />
          <span>
            <span className="block font-semibold">10 Vocal Warmups</span>
            <span className="block text-xs text-muted-foreground">
              Traditional coaching patterns across a larger range.
            </span>
          </span>
        </Button>
      </div>
    </section>
  );
}
