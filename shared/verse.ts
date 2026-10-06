// Shared between the browser and the server: the settings a verse request can carry.

export const DENSITIES = ['LOW', 'MID', 'HIGH'] as const;
export const ORBITS = ['TIGHT', 'MID', 'LOOSE'] as const;
export const GRIDS = ['POCKET', 'MID', 'CHOPPER'] as const;

export type Density = (typeof DENSITIES)[number];
export type Orbit = (typeof ORBITS)[number];
export type Grid = (typeof GRIDS)[number];

export interface VerseConfig {
  seed: string;
  density: Density;
  orbit: Orbit;
  grid: Grid;
  tone?: string;
}

/** Maximum lengths, enforced by the server and mirrored by the UI inputs. */
export const LIMITS = { seed: 200, tone: 60 } as const;
