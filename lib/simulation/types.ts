import type { Feature, FeatureCollection, Polygon } from 'geojson';

export type TerritoryMetricKey =
  | 'waterIndex'
  | 'soilIndex'
  | 'biodiversityIndex'
  | 'resilienceIndex';

export interface SimulationSnapshot {
  month: number;
  date: string;
  label: string;
  areaHa: number;
  coffeeAreaDeltaPercent: number;
  expansionHa: number;
  retiredHa: number;
  co2eKt: number;
  co2eDeltaPercent: number;
  waterIndex: number;
  soilIndex: number;
  biodiversityIndex: number;
  resilienceIndex: number;
}

export interface FrontierProperties {
  id: string;
  municipality: string;
  municipalCode: string;
  focus: boolean;
  origin: 'initial' | 'expansion';
  startMonth: number;
  entryEndMonth?: number;
  retireMonth: number | null;
  retirementStartMonth?: number;
  retirementFraction?: number;
  hectares: number;
  aptitude2026: string;
  aptitude2035: string;
  confidence: 'Media' | 'Media-alta';
  sourceCover: string;
  nearWater: boolean;
  steepSlope: boolean;
  lowSoc: boolean;
  nearProtected: boolean;
  score: number;
}

export type FrontierFeature = Feature<Polygon, FrontierProperties>;
export type FrontierCollection = FeatureCollection<Polygon, FrontierProperties>;

export interface ModelSource {
  name: string;
  url: string;
  accessedAt: string;
  license: string;
  use: string;
}

export interface ModelManifest {
  model: string;
  version: string;
  generatedAt: string;
  coordinateSystems: Record<string, string>;
  scenario: {
    start: string;
    end: string;
    climate: string;
    timeSteps: number;
    deterministic: boolean;
  };
  sources: ModelSource[];
  assumptions: string[];
  checks: Record<string, string | number | boolean>;
  files: Array<{ name: string; sha256: string }>;
}
