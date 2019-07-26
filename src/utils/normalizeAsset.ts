export function normalizeAsset (
  iScale: number,
  oScale: number,
  val: bigint
): bigint {
  const scaleRange = BigInt(oScale) - BigInt(iScale)
  return scaleRange > 0
    ? val * 10n ** scaleRange
    : val / 10n ** (-1n * scaleRange)
}
