/** Elapsed simulation duration only, never an absolute date or a persisted clock value. */
export function formatDemoDuration(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) return '–';
  const total = Math.floor(value); // Never display a future second before the simulation reaches it.
  const hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60), seconds = total % 60;
  return [hours ? `${hours} h` : '', minutes ? `${minutes} min` : '', seconds || !total ? `${seconds} s` : ''].filter(Boolean).join(' ');
}
