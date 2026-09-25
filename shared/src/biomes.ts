/** Biome ids and properties, shared so the client can tint foliage consistently. */
export interface BiomeDef {
  id: number;
  name: string;
  displayName: string;
  grass: [number, number, number];
  foliage: [number, number, number];
  water: [number, number, number];
  /** Fog / sky tint multiplier */
  sky: [number, number, number];
  temperature: number;
  snowy: boolean;
}

const list: BiomeDef[] = [];
function biome(name: string, displayName: string, grass: string, foliage: string, water: string, temperature: number, snowy = false, sky = '#78a7ff') {
  const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const def: BiomeDef = { id: list.length, name, displayName, grass: hex(grass), foliage: hex(foliage), water: hex(water), sky: hex(sky), temperature, snowy };
  list.push(def);
  return def.id;
}

export const Biome = {
  Ocean: biome('ocean', 'Ocean', '#8eb971', '#71a74d', '#3f76e4', 0.5),
  DeepOcean: biome('deep_ocean', 'Deep Ocean', '#8eb971', '#71a74d', '#3a5fd6', 0.5),
  Beach: biome('beach', 'Beach', '#91bd59', '#77ab2f', '#3f86e4', 0.8),
  Plains: biome('plains', 'Plains', '#91bd59', '#77ab2f', '#3f76e4', 0.8),
  Forest: biome('forest', 'Forest', '#79c05a', '#59ae30', '#3f76e4', 0.7),
  BirchForest: biome('birch_forest', 'Birch Forest', '#88bb67', '#6ba941', '#3f76e4', 0.6),
  Taiga: biome('taiga', 'Taiga', '#86b783', '#68a464', '#287082', 0.25),
  SnowyTaiga: biome('snowy_taiga', 'Snowy Taiga', '#80b497', '#60a17b', '#205e83', -0.5, true),
  SnowyPlains: biome('snowy_plains', 'Snowy Plains', '#80b497', '#60a17b', '#3938c9', 0, true),
  Desert: biome('desert', 'Desert', '#bfb755', '#aea42a', '#32a598', 2),
  Savanna: biome('savanna', 'Savanna', '#bfb755', '#aea42a', '#2c8b9c', 1.2),
  Mountains: biome('mountains', 'Windswept Hills', '#8ab689', '#6da36b', '#3f76e4', 0.2),
  SnowyPeaks: biome('snowy_peaks', 'Snowy Peaks', '#80b497', '#60a17b', '#3f76e4', -0.7, true),
  Swamp: biome('swamp', 'Swamp', '#6a7039', '#6a7039', '#617b64', 0.8),
  Jungle: biome('jungle', 'Jungle', '#59c93c', '#30bb0b', '#14a2c5', 0.95),
  Meadow: biome('meadow', 'Meadow', '#83bb6d', '#63a948', '#0e4ecf', 0.5),
} as const;

export const BIOMES: readonly BiomeDef[] = list;
