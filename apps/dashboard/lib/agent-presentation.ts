/**
 * Formats a byte count using binary operator-friendly units.
 */
export function formatBytes(
  bytes:
    number | null,
): string {
  if (
    bytes === null ||
    !Number.isFinite(
      bytes,
    )
  ) {
    return "Unavailable";
  }

  if (bytes < 1024) {
    return `${Math.round(
      bytes,
    )} B`;
  }

  const units = [
    "KB",
    "MB",
    "GB",
    "TB",
  ];

  let value =
    bytes / 1024;

  let unitIndex = 0;

  while (
    value >= 1024 &&
    unitIndex <
      units.length - 1
  ) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(
    value >= 10
      ? 1
      : 2,
  )} ${units[unitIndex]}`;
}
