import { fbm2D, SeededRNG } from './rng';
import {
  MAP_SIZE,
  PlotInfo,
  SurfaceType,
  TILE_COUNT,
  TileFlag,
  TileGrid,
  TileType,
  VegInstance,
} from './types';

export function idx(tx: number, ty: number): number {
  return ty * MAP_SIZE + tx;
}

export function inBounds(tx: number, ty: number): boolean {
  return tx >= 0 && tx < MAP_SIZE && ty >= 0 && ty < MAP_SIZE;
}

export function createEmptyGrid(): TileGrid {
  const owner = new Int16Array(TILE_COUNT);
  owner.fill(-1);
  return {
    elev: new Float32Array(TILE_COUNT),
    depth: new Float32Array(TILE_COUNT),
    sat: new Float32Array(TILE_COUNT),
    crest: new Float32Array(TILE_COUNT),
    integrity: new Uint8Array(TILE_COUNT),
    surface: new Uint8Array(TILE_COUNT),
    type: new Uint8Array(TILE_COUNT),
    flags: new Uint16Array(TILE_COUNT),
    owner,
    risk: new Float32Array(TILE_COUNT),
    mosq: new Float32Array(TILE_COUNT),
  };
}

export function classifyTiles(tiles: TileGrid): void {
  for (let i = 0; i < TILE_COUNT; i++) {
    const f = tiles.flags[i];
    const e = tiles.elev[i];
    if (f & TileFlag.OpenWater) {
      tiles.type[i] = TileType.OpenWater;
    } else if (f & TileFlag.Bayou) {
      tiles.type[i] = TileType.Bayou;
    } else if (f & TileFlag.PondSink) {
      tiles.type[i] = TileType.Pond;
    } else if (e < 1.55 && !(f & TileFlag.Canal)) {
      tiles.type[i] = TileType.Marsh;
    } else if (e < 3.4) {
      tiles.type[i] = TileType.Wet;
    } else if (e < 5.4) {
      tiles.type[i] = TileType.Dry;
    } else {
      tiles.type[i] = TileType.High;
    }
  }
}

export function generateTerrain(seed: number): {
  tiles: TileGrid;
  plot: PlotInfo;
  veg: VegInstance[];
} {
  const rng = new SeededRNG(seed);
  const tiles = createEmptyGrid();

  // Compute meandering bayou centerline x(y)
  const bayouX = new Float32Array(MAP_SIZE);
  const phase1 = rng.range(0, Math.PI * 2);
  const phase2 = rng.range(0, Math.PI * 2);
  for (let y = 0; y < MAP_SIZE; y++) {
    const t = y / MAP_SIZE;
    bayouX[y] =
      27.5 +
      Math.sin(t * Math.PI * 2.1 + phase1 * 0.25) * 3.4 +
      Math.cos(t * Math.PI * 4.2 + phase2 * 0.2) * 1.1;
  }

  // Big Muddy River west bank edge x(y)
  const riverBank = new Float32Array(MAP_SIZE);
  for (let y = 0; y < MAP_SIZE; y++) {
    const t = y / MAP_SIZE;
    riverBank[y] = 55.5 + Math.sin(t * Math.PI * 1.6 + 0.5) * 2.1;
  }

  // Gulf coastline y(x)
  const gulfCoast = new Float32Array(MAP_SIZE);
  for (let x = 0; x < MAP_SIZE; x++) {
    const t = x / MAP_SIZE;
    gulfCoast[x] = 57.5 + Math.sin(t * Math.PI * 2.3 + 0.8) * 1.7;
  }

  // Western Chenier centers (elevated ancient shell ridges across the bayou)
  const chenier1 = { cx: 14, cy: 23, rx: 7.5, ry: 8.5, peak: 6.2 };
  const chenier2 = { cx: 15, cy: 36, rx: 6.0, ry: 5.5, peak: 5.1 };
  const lakeCenter = { cx: 11.5, cy: 48.5, rx: 6.8, ry: 5.0 };

  for (let ty = 0; ty < MAP_SIZE; ty++) {
    for (let tx = 0; tx < MAP_SIZE; tx++) {
      const i = idx(tx, ty);
      const n = fbm2D(tx * 0.085, ty * 0.085, seed + 13, 4);
      const micro = fbm2D(tx * 0.22, ty * 0.22, seed + 101, 2) - 0.5;

      const dBayou = Math.abs(tx - bayouX[ty]);
      const dRiver = riverBank[ty] - tx;
      const dGulf = gulfCoast[tx] - ty;

      // Cypress Lake in SW
      const dlx = (tx - lakeCenter.cx) / lakeCenter.rx;
      const dly = (ty - lakeCenter.cy) / lakeCenter.ry;
      const dLake = Math.sqrt(dlx * dlx + dly * dly) + (n - 0.5) * 0.28;

      // Determine Open Water (Big Muddy, Gulf, Cypress Lake)
      if (dRiver <= 0 || dGulf <= 0 || dLake < 0.92) {
        tiles.flags[i] |= TileFlag.OpenWater;
        const depthBias =
          dRiver <= 0
            ? Math.min(3.5, 1.4 + -dRiver * 0.35)
            : dGulf <= 0
              ? Math.min(3.5, 1.4 + -dGulf * 0.35)
              : Math.min(2.6, (1 - dLake) * 3.0);
        tiles.elev[i] = -depthBias;
        tiles.depth[i] = Math.max(0.4, -tiles.elev[i]);
        tiles.sat[i] = 1;
        continue;
      }

      // Determine Bayou channel (width ~1.7 tiles half-width -> 3-4 tiles wide)
      if (dBayou < 1.65) {
        tiles.flags[i] |= TileFlag.Bayou;
        const centerFactor = 1 - dBayou / 1.65;
        tiles.elev[i] = -0.6 - centerFactor * 1.5;
        tiles.depth[i] = Math.max(0.3, -tiles.elev[i]);
        tiles.sat[i] = 1;
        continue;
      }

      // Land elevation profile
      let elev = 1.0 + (n - 0.45) * 1.6 + micro * 0.35;

      // East of bayou: Natural-levee High Ridge (North crown) + Vulnerable Cove (South)
      if (tx > bayouX[ty]) {
        // Crown centered around tx=42, ty=16
        const dxCrown = (tx - 43) / 11.5;
        const dyCrown = (ty - 15.5) / 13.5;
        const crownDist = Math.sqrt(dxCrown * dxCrown + dyCrown * dyCrown);
        const crownBoost = Math.max(0, 1 - crownDist) * 6.4;

        // Secondary gentler southern shelf (Crevasse Reach, vulnerable 2.0-3.3 ft)
        const dxShelf = (tx - 44) / 10.5;
        const dyShelf = (ty - 35) / 12.5;
        const shelfDist = Math.sqrt(dxShelf * dxShelf + dyShelf * dyShelf);
        const shelfBoost = Math.max(0, 1 - shelfDist) * 2.15;

        // Natural river levee lip along Big Muddy
        const riverLip = dRiver < 7 ? Math.sin((1 - dRiver / 7) * Math.PI) * 1.3 : 0;

        elev += crownBoost + shelfBoost + riverLip;

        // Smooth taper toward bayou bank and gulf
        if (dBayou < 4.5) {
          const bankT = Math.max(0, (dBayou - 1.65) / 2.85);
          elev = elev * (0.25 + 0.75 * bankT);
        }
      } else {
        // West of bayou: Cypress Backswamp + Chenier Islands
        const dx1 = (tx - chenier1.cx) / chenier1.rx;
        const dy1 = (ty - chenier1.cy) / chenier1.ry;
        const c1 = Math.max(0, 1 - Math.sqrt(dx1 * dx1 + dy1 * dy1));

        const dx2 = (tx - chenier2.cx) / chenier2.rx;
        const dy2 = (ty - chenier2.cy) / chenier2.ry;
        const c2 = Math.max(0, 1 - Math.sqrt(dx2 * dx2 + dy2 * dy2));

        elev += c1 * chenier1.peak + c2 * chenier2.peak;

        if (dBayou < 3.5) {
          const bankT = Math.max(0, (dBayou - 1.65) / 1.85);
          elev = elev * (0.35 + 0.65 * bankT);
        }
      }

      // Coastal taper near Gulf & Cypress Lake
      if (dGulf < 5) {
        elev *= Math.max(0.15, dGulf / 5);
      }
      if (dLake < 1.45) {
        const lt = Math.max(0, (dLake - 0.92) / 0.53);
        elev *= 0.25 + 0.75 * lt;
      }

      // Clamp to realistic Louisiana elevation range
      elev = Math.max(0.45, Math.min(9.5, elev));
      tiles.elev[i] = elev;

      // Initial wetness / marsh standing water
      if (elev < 1.55) {
        tiles.flags[i] |= TileFlag.WetlandOriginal;
        tiles.sat[i] = 0.92;
        tiles.depth[i] = Math.max(0.05, (1.55 - elev) * 0.22);
      } else if (elev < 3.4) {
        tiles.sat[i] = 0.62;
        tiles.depth[i] = 0;
      } else {
        tiles.sat[i] = 0.35;
        tiles.depth[i] = 0;
      }
    }
  }

  // Guarantee a flat, prime Founders' Hall plateau at (40..44, 11..15)
  const foundersTx = 41;
  const foundersTy = 12;
  for (let ty = foundersTy - 2; ty <= foundersTy + 5; ty++) {
    for (let tx = foundersTx - 2; tx <= foundersTx + 5; tx++) {
      if (!inBounds(tx, ty)) continue;
      const i = idx(tx, ty);
      if (!(tiles.flags[i] & (TileFlag.Bayou | TileFlag.OpenWater))) {
        tiles.elev[i] = Math.max(tiles.elev[i], 6.3 + (fbm2D(tx * 0.3, ty * 0.3, seed, 2) - 0.5) * 0.35);
        tiles.depth[i] = 0;
        tiles.sat[i] = 0.3;
        tiles.flags[i] &= ~TileFlag.WetlandOriginal;
      }
    }
  }

  // Guarantee Chenier 1 stadium-ready plateau on the west bank!
  for (let ty = 19; ty <= 27; ty++) {
    for (let tx = 11; tx <= 19; tx++) {
      const i = idx(tx, ty);
      if (!(tiles.flags[i] & (TileFlag.Bayou | TileFlag.OpenWater))) {
        tiles.elev[i] = Math.max(tiles.elev[i], 5.3 + (fbm2D(tx * 0.25, ty * 0.25, seed + 5, 2) - 0.5) * 0.4);
        tiles.depth[i] = 0;
        tiles.flags[i] &= ~TileFlag.WetlandOriginal;
      }
    }
  }

  // Pre-build Highway 1 approach along x = 42 from north edge down to Founders' plateau
  for (let ty = 0; ty <= 10; ty++) {
    const i = idx(42, ty);
    tiles.elev[i] = Math.max(tiles.elev[i], 5.6);
    tiles.depth[i] = 0;
    tiles.surface[i] = SurfaceType.Road;
    tiles.flags[i] |= TileFlag.Highway;
    tiles.flags[i] &= ~TileFlag.WetlandOriginal;
  }

  // Bayou spline list (one center tile per row from y=0 to gulf)
  const bayouSpline: number[] = [];
  for (let ty = 0; ty < MAP_SIZE - 4; ty++) {
    const bx = Math.round(bayouX[ty]);
    if (inBounds(bx, ty)) {
      bayouSpline.push(idx(bx, ty));
    }
  }

  // Pirogue Landing spot on east bank of bayou at ty = 14
  const landingTy = 14;
  const landingTx = Math.round(bayouX[landingTy]) + 2;
  for (let dy = -1; dy <= 1; dy++) {
    const i = idx(landingTx, landingTy + dy);
    if (inBounds(landingTx, landingTy + dy) && !(tiles.flags[i] & TileFlag.Bayou)) {
      tiles.elev[i] = Math.max(tiles.elev[i], 2.8);
      tiles.depth[i] = 0;
    }
  }

  classifyTiles(tiles);

  // Scatter lush procedural vegetation (Live Oaks on dry/high, Bald Cypress in wet/marsh, Palmettos)
  const veg: VegInstance[] = [];
  let vegId = 1;
  for (let ty = 2; ty < MAP_SIZE - 2; ty++) {
    for (let tx = 2; tx < MAP_SIZE - 2; tx++) {
      const i = idx(tx, ty);
      if (tiles.surface[i] !== SurfaceType.None) continue;
      if (tiles.flags[i] & (TileFlag.OpenWater | TileFlag.Bayou)) continue;

      // Keep Founders' immediate 5x5 clear except two sentinel oaks flanking the south
      if (tx >= foundersTx - 1 && tx <= foundersTx + 3 && ty >= foundersTy - 1 && ty <= foundersTy + 3) {
        continue;
      }

      const t = tiles.type[i];
      const r = rng.next();
      if (t === TileType.Marsh) {
        if (r < 0.24) {
          veg.push({
            id: vegId++,
            kind: 'cypress',
            tx,
            ty,
            scale: rng.range(0.85, 1.35),
            rot: rng.range(0, Math.PI * 2),
            planted: false,
          });
        } else if (r < 0.36) {
          veg.push({
            id: vegId++,
            kind: 'palmetto',
            tx,
            ty,
            scale: rng.range(0.8, 1.25),
            rot: rng.range(0, Math.PI * 2),
            planted: false,
          });
        }
      } else if (t === TileType.Wet) {
        if (r < 0.14) {
          veg.push({
            id: vegId++,
            kind: 'cypress',
            tx,
            ty,
            scale: rng.range(0.8, 1.2),
            rot: rng.range(0, Math.PI * 2),
            planted: false,
          });
        } else if (r < 0.20) {
          veg.push({
            id: vegId++,
            kind: 'oak',
            tx,
            ty,
            scale: rng.range(0.85, 1.25),
            rot: rng.range(0, Math.PI * 2),
            planted: false,
          });
        }
      } else if (t === TileType.Dry || t === TileType.High) {
        if (r < 0.11) {
          veg.push({
            id: vegId++,
            kind: 'oak',
            tx,
            ty,
            scale: rng.range(0.9, 1.35),
            rot: rng.range(0, Math.PI * 2),
            planted: false,
          });
        } else if (r < 0.13) {
          veg.push({
            id: vegId++,
            kind: 'azalea',
            tx,
            ty,
            scale: rng.range(0.85, 1.2),
            rot: rng.range(0, Math.PI * 2),
            planted: false,
          });
        }
      }
    }
  }

  // Signature twin sentinel Live Oaks flanking Founders' Hall
  veg.push(
    { id: vegId++, kind: 'oak', tx: foundersTx - 1, ty: foundersTy + 3, scale: 1.35, rot: 0.4, planted: false },
    { id: vegId++, kind: 'oak', tx: foundersTx + 3, ty: foundersTy + 3, scale: 1.3, rot: 2.1, planted: false },
  );

  return {
    tiles,
    plot: {
      foundersTx,
      foundersTy,
      landingTx,
      landingTy,
      bayouSpline,
      chenierCenter: { tx: chenier1.cx, ty: chenier1.cy },
    },
    veg,
  };
}
