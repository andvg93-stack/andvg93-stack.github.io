import type { FrontierProperties } from './types';

export function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function theilSen(
  observations: Array<{ year: number; plantedHa: number }>,
) {
  const slopes: number[] = [];
  for (let first = 0; first < observations.length; first += 1) {
    for (let second = first + 1; second < observations.length; second += 1) {
      const years = observations[second].year - observations[first].year;
      if (years) {
        slopes.push(
          (observations[second].plantedHa - observations[first].plantedHa) / years,
        );
      }
    }
  }
  return median(slopes);
}

export function classifyCoffeeAptitude(
  temperatureCelsius: number,
  annualPrecipitationMm: number,
) {
  const temperatureClass =
    temperatureCelsius >= 17 && temperatureCelsius <= 22
      ? 'S1'
      : (temperatureCelsius >= 15 && temperatureCelsius < 17) ||
          (temperatureCelsius > 22 && temperatureCelsius <= 25)
        ? 'S2'
        : (temperatureCelsius >= 12 && temperatureCelsius < 15) ||
            (temperatureCelsius > 25 && temperatureCelsius <= 28)
          ? 'S3'
          : 'N';
  const precipitationClass =
    annualPrecipitationMm >= 1400 && annualPrecipitationMm <= 1800
      ? 'S1'
      : (annualPrecipitationMm >= 1000 && annualPrecipitationMm < 1400) ||
          (annualPrecipitationMm > 1800 && annualPrecipitationMm <= 2300)
        ? 'S2'
        : (annualPrecipitationMm >= 750 && annualPrecipitationMm < 1000) ||
            (annualPrecipitationMm > 2300 && annualPrecipitationMm <= 4200)
          ? 'S3'
          : 'N';
  const ranking = ['S1', 'S2', 'S3', 'N'];
  return ranking[Math.max(ranking.indexOf(temperatureClass), ranking.indexOf(precipitationClass))];
}

export function isFrontierActive(
  feature: Pick<FrontierProperties, 'startMonth' | 'retireMonth'>,
  month: number,
) {
  return feature.startMonth <= month && (feature.retireMonth == null || feature.retireMonth > month);
}

export function clampIndex(value: number) {
  return Math.min(100, Math.max(0, value));
}

