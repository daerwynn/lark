export interface MicTraceVisibilityInput {
  chartNoteAvailable: boolean;
  comparisonHz: number | null | undefined;
  stabilizedHz: number | null | undefined;
}

function isFinitePositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function shouldDisplayMainMicTrace({
  chartNoteAvailable,
  comparisonHz,
  stabilizedHz,
}: MicTraceVisibilityInput): boolean {
  return isFinitePositive(stabilizedHz) && (chartNoteAvailable || isFinitePositive(comparisonHz));
}

export function shouldScoreMainMicTrace({
  comparisonHz,
  stabilizedHz,
}: MicTraceVisibilityInput): boolean {
  return isFinitePositive(stabilizedHz) && isFinitePositive(comparisonHz);
}
