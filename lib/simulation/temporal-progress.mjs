/** Shared by model, map and surface generator. A bounded, gradual scenario assumption. */
export function temporalProgress(month, start, end) {
  if (end <= start) return month >= end ? 1 : 0;
  const t = Math.min(1, Math.max(0, (month - start) / (end - start)));
  return 0.8 * t + 0.2 * t * t * (3 - 2 * t);
}

export function monthAtProgress(fraction, start, end) {
  let low = start, high = end;
  for (let i = 0; i < 32; i++) {
    const mid = (low + high) / 2;
    if (temporalProgress(mid, start, end) < fraction) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export function frontierWeights(properties, month) {
  const entry = properties.origin === 'initial' ? 1 : properties.entryEndMonth == null
    ? temporalProgress(month, properties.startMonth - 1, properties.startMonth)
    : temporalProgress(month, properties.startMonth, properties.entryEndMonth);
  const retirement = properties.retireMonth == null ? 0 : properties.retirementStartMonth == null
    ? temporalProgress(month, properties.retireMonth - 1, properties.retireMonth)
    : (properties.retirementFraction ?? 1) * temporalProgress(month, properties.retirementStartMonth, properties.retireMonth);
  return { entry, active: entry * (1 - retirement), expansion: properties.origin === 'expansion' ? entry * (1 - retirement) : 0, retired: entry * retirement };
}
