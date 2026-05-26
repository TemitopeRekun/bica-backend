/**
 * Masks a NIN reference to comply with NDPR regulations (e.g., *******3456).
 * Replaces all but the last 4 characters with asterisks.
 */
export function maskNin(nin?: string | null): string | null {
  if (!nin) {
    return null;
  }
  const trimmed = nin.trim();
  if (trimmed.length <= 4) {
    return trimmed;
  }
  return '*'.repeat(trimmed.length - 4) + trimmed.slice(-4);
}
