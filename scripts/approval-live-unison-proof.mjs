export function buildApprovalResolutionProof(input = {}) {
  const surfaces = Array.isArray(input.surfaces) ? input.surfaces : [];
  const surfaceCount = surfaces.length;
  const clearedCount = surfaces.filter((surface) => Boolean(surface?.cleared)).length;
  const uncleared = surfaces
    .filter((surface) => !Boolean(surface?.cleared))
    .map((surface) => surface?.name)
    .filter(Boolean);

  return {
    approvalId: input.approvalId,
    surfaceCount,
    clearedCount,
    allCleared: surfaceCount > 0 && clearedCount === surfaceCount,
    uncleared,
  };
}
