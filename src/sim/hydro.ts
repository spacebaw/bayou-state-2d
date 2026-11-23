import { idx, inBounds } from './terrain';
import {
  GameState,
  MAP_SIZE,
  TILE_COUNT,
  TileFlag,
  TileType,
} from './types';

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

// Reusable scratch buffer so hydrology ticks allocate zero garbage
const deltaBuf = new Float32Array(TILE_COUNT);
const bfsQueue = new Int32Array(TILE_COUNT);
const bfsVisited = new Uint8Array(TILE_COUNT);

function effectiveCrest(state: GameState, i: number): number {
  const c = state.tiles.crest[i];
  if (c <= 0) return 0;
  const integ = state.tiles.integrity[i];
  const sandbag = state.storm.active && state.storm.sandbagged ? 1.5 : 0;
  if (integ <= 0) return 0;
  if (integ < 50) return c * 0.5 + sandbag;
  return c + sandbag;
}

/**
 * Feet-based Cellular Automaton Hydrology Step.
 * Handles rain intake, soil infiltration, overland head-difference flow,
 * 8x canal conductance, auto-closing floodgates, pump station drainage,
 * retention ponds, and hurricane storm surge fronts.
 */
export function stepHydrology(state: GameState, dtDay: number): void {
  const { tiles } = state;
  const rawSurge = state.storm.active ? state.storm.currentSurgeFt : 0;
  // Fortress Capstone: Powered Bayou Surge Barrier closes automatically > 1.5 ft and cuts surge by 55%!
  const hasBarrier = state.buildings.some(
    (b) => b && b.type === 'surge_barrier' && b.built >= 1 && b.powered && !b.blackout,
  );
  const surge = hasBarrier && rawSurge > 1.5 ? rawSurge * 0.45 : rawSurge;
  const stage = Math.max(state.riverStage, state.bayouStage) + surge;
  const floodgateClosed = stage > 1.0;

  // Rain rate in feet per calendar day (heavy hurricane ~0.85 ft/day = ~10 inches)
  const rainRate = Math.max(state.rainRate, state.storm.active ? state.storm.rainRate : 0);
  const rainFt = rainRate * 0.85 * dtDay;

  deltaBuf.fill(0);

  // 1. Boundary water stages + rain intake + infiltration/evaporation
  for (let i = 0; i < TILE_COUNT; i++) {
    const f = tiles.flags[i];
    const isWater = (f & (TileFlag.OpenWater | TileFlag.Bayou)) !== 0;

    if (isWater) {
      // Water surface rises to `stage`
      const targetDepth = Math.max(0.3, stage - tiles.elev[i]);
      tiles.depth[i] += (targetDepth - tiles.depth[i]) * Math.min(1, dtDay * 18);
      tiles.sat[i] = 1;
      continue;
    }

    // Rain lands on land tiles (levees shed rain off their crown)
    if (rainFt > 0 && tiles.crest[i] <= 0) {
      const absorb = (1 - tiles.sat[i]) * 0.45 * rainFt;
      tiles.sat[i] = Math.min(1, tiles.sat[i] + rainFt * 0.9);
      tiles.depth[i] += Math.max(0, rainFt - absorb);
    } else if (rainFt === 0) {
      // Natural drainage & evaporation on dry/high land
      const drainRate =
        tiles.type[i] === TileType.High
          ? 0.42
          : tiles.type[i] === TileType.Dry
            ? 0.30
            : tiles.type[i] === TileType.Wet
              ? 0.16
              : 0.05;
      const evap = drainRate * dtDay;
      if (tiles.depth[i] > 0) {
        const minMarsh = tiles.type[i] === TileType.Marsh && !(f & TileFlag.Canal) ? 0.08 : 0;
        tiles.depth[i] = Math.max(minMarsh, tiles.depth[i] - evap);
      }
      tiles.sat[i] = Math.max(0.25, tiles.sat[i] - 0.14 * dtDay);
    }
  }

  // 2. Head-difference orthogonal flow pass
  for (let ty = 0; ty < MAP_SIZE; ty++) {
    for (let tx = 0; tx < MAP_SIZE; tx++) {
      const i = idx(tx, ty);
      const dA = tiles.depth[i];
      if (dA <= 0.002) continue;

      const fA = tiles.flags[i];
      const isCanalA = (fA & TileFlag.Canal) !== 0;
      const bedA = isCanalA ? tiles.elev[i] - 2.0 : tiles.elev[i];
      const headA = bedA + dA;
      const barrierA = tiles.elev[i] + effectiveCrest(state, i);

      // Only iterate East and South to process each edge once symmetrically
      for (let d = 0; d < 2; d++) {
        const nx = tx + (d === 0 ? 1 : 0);
        const ny = ty + (d === 1 ? 1 : 0);
        if (!inBounds(nx, ny)) continue;
        const j = idx(nx, ny);

        const dB = tiles.depth[j];
        const fB = tiles.flags[j];
        const isCanalB = (fB & TileFlag.Canal) !== 0;
        const bedB = isCanalB ? tiles.elev[j] - 2.0 : tiles.elev[j];
        const headB = bedB + dB;

        const diff = headA - headB;
        if (Math.abs(diff) < 0.004) continue;

        // Check floodgates & levee crests blocking the edge
        const isGateA = (fA & TileFlag.Floodgate) !== 0;
        const isGateB = (fB & TileFlag.Floodgate) !== 0;
        if ((isGateA || isGateB) && floodgateClosed) continue;

        const barrierB = tiles.elev[j] + effectiveCrest(state, j);
        const crestWall = Math.max(
          tiles.crest[i] > 0 && !isGateA ? barrierA : -99,
          tiles.crest[j] > 0 && !isGateB ? barrierB : -99,
        );

        const higherHead = diff > 0 ? headA : headB;
        if (crestWall > -50 && higherHead <= crestWall) {
          continue; // Levee holds!
        }

        // Conductance: canals carry water 8x faster; marsh/preserve attenuates surge
        let cond = 0.24;
        if (isCanalA && isCanalB) cond = 0.72;
        else if (isCanalA || isCanalB) cond = 0.48;
        else if ((fA & TileFlag.Preserve) || (fB & TileFlag.Preserve)) cond = 0.07;
        else if (tiles.type[i] === TileType.Marsh || tiles.type[j] === TileType.Marsh) cond = 0.11;

        const effDiff =
          crestWall > -50 ? Math.sign(diff) * Math.max(0, higherHead - crestWall) : diff;
        let flow = effDiff * cond * Math.min(1, dtDay * 16);

        // Clamp flow to available depth on donor tile (conservation & stability)
        if (flow > 0) {
          const isWaterA = (fA & (TileFlag.OpenWater | TileFlag.Bayou)) !== 0;
          if (!isWaterA) flow = Math.min(flow, dA * 0.22);
        } else {
          const isWaterB = (fB & (TileFlag.OpenWater | TileFlag.Bayou)) !== 0;
          if (!isWaterB) flow = Math.max(flow, -dB * 0.22);
        }

        deltaBuf[i] -= flow;
        deltaBuf[j] += flow;
      }
    }
  }

  // Apply flow deltas (boundary water tiles remain governed by river/bayou stage)
  for (let i = 0; i < TILE_COUNT; i++) {
    const f = tiles.flags[i];
    if (f & (TileFlag.OpenWater | TileFlag.Bayou)) continue;
    tiles.depth[i] = Math.max(0, Math.min(12, tiles.depth[i] + deltaBuf[i]));
  }

  // 3. Pump Stations actively drain water from nearby tiles & connected canals when powered
  for (const b of state.buildings) {
    if (!b || b.built < 1) continue;
    if (b.type === 'pump' && b.powered && !b.blackout && !b.flooded) {
      let budget = 18 * dtDay; // 18 tile-ft per day
      const cx = b.tx + 1;
      const cy = b.ty + 1;
      for (let r = 1; r <= 7 && budget > 0.01; r++) {
        for (let dy = -r; dy <= r && budget > 0.01; dy++) {
          for (let dx = -r; dx <= r && budget > 0.01; dx++) {
            const tx = cx + dx;
            const ty = cy + dy;
            if (!inBounds(tx, ty)) continue;
            const i = idx(tx, ty);
            if (tiles.flags[i] & (TileFlag.OpenWater | TileFlag.Bayou)) continue;
            if (tiles.depth[i] > 0.02) {
              const take = Math.min(tiles.depth[i], budget, 0.25);
              tiles.depth[i] -= take;
              budget -= take;
            }
          }
        }
      }
    } else if (b.type === 'pond') {
      // Retention ponds passively soak up runoff within radius 4
      let budget = 5.5 * dtDay;
      const cx = b.tx + 1;
      const cy = b.ty + 1;
      for (let dy = -4; dy <= 4 && budget > 0.01; dy++) {
        for (let dx = -4; dx <= 4 && budget > 0.01; dx++) {
          const tx = cx + dx;
          const ty = cy + dy;
          if (!inBounds(tx, ty)) continue;
          const i = idx(tx, ty);
          if (tiles.flags[i] & (TileFlag.OpenWater | TileFlag.Bayou | TileFlag.PondSink)) continue;
          if (tiles.depth[i] > 0.04) {
            const take = Math.min(tiles.depth[i] - 0.02, budget, 0.12);
            tiles.depth[i] -= take;
            budget -= take;
          }
        }
      }
    }
  }

  // 4. Update building flood state
  for (const b of state.buildings) {
    if (!b) continue;
    let maxDepth = 0;
    for (let dy = 0; dy < b.h; dy++) {
      for (let dx = 0; dx < b.w; dx++) {
        const ti = idx(b.tx + dx, b.ty + dy);
        if (tiles.depth[ti] > maxDepth) maxDepth = tiles.depth[ti];
      }
    }
    const threshold = b.pilings ? 3.0 : b.type === 'substation' ? 0.3 : 0.45;
    b.flooded = maxDepth >= threshold;
  }

  state.waterDirty = true;
}

/**
 * Flood-fill from all open water / bayou boundary tiles at a test surge height (ft).
 * Identifies tiles physically protected by closed levee rings vs exposed low ground,
 * and computes predicted Flood Risk depth for the `F` overlay.
 */
export function analyzeProtectionAndRisk(state: GameState, testSurgeFt = 5.0): void {
  const { tiles } = state;
  bfsVisited.fill(0);
  let head = 0;
  let tail = 0;

  // Seed BFS with all water/bayou boundary tiles
  for (let i = 0; i < TILE_COUNT; i++) {
    tiles.flags[i] &= ~TileFlag.Protected;
    if (tiles.flags[i] & (TileFlag.OpenWater | TileFlag.Bayou)) {
      bfsVisited[i] = 1;
      bfsQueue[tail++] = i;
    }
  }

  // BFS: surge spreads into any adjacent tile whose elev + effectiveCrest < testSurgeFt
  while (head < tail) {
    const cur = bfsQueue[head++];
    const cx = cur % MAP_SIZE;
    const cy = (cur / MAP_SIZE) | 0;

    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (bfsVisited[ni]) continue;

      const barrier = tiles.elev[ni] + effectiveCrest(state, ni);
      if (barrier < testSurgeFt) {
        bfsVisited[ni] = 1;
        bfsQueue[tail++] = ni;
      }
    }
  }

  let protectedCount = 0;
  const gaps: number[] = [];

  for (let i = 0; i < TILE_COUNT; i++) {
    const isWater = (tiles.flags[i] & (TileFlag.OpenWater | TileFlag.Bayou)) !== 0;
    if (isWater) {
      tiles.risk[i] = 0;
      continue;
    }
    const e = tiles.elev[i];
    if (!bfsVisited[i] && e < testSurgeFt && tiles.crest[i] <= 0) {
      // Below surge height, yet water could NOT reach it => protected by a closed levee ring!
      tiles.flags[i] |= TileFlag.Protected;
      protectedCount++;
      tiles.risk[i] = 0; // Safe from surge!
    } else if (bfsVisited[i]) {
      tiles.risk[i] = Math.max(0, testSurgeFt - e);
      // Detect narrow 1-tile gap adjacent to two levee tiles
      if (tiles.crest[i] <= 0 && e < testSurgeFt) {
        const tx = i % MAP_SIZE;
        const ty = (i / MAP_SIZE) | 0;
        let adjLevee = 0;
        for (const [dx, dy] of DIRS) {
          if (inBounds(tx + dx, ty + dy) && tiles.crest[idx(tx + dx, ty + dy)] > 0) adjLevee++;
        }
        if (adjLevee >= 2) gaps.push(i);
      }
    } else {
      // Naturally high dry ground (>= testSurgeFt)
      tiles.risk[i] = 0;
    }
  }

  state.protectedCount = protectedCount;
  state.leveeGaps = gaps;
}

/**
 * Computes tile-by-tile mosquito breeding density (0..1) from standing water,
 * season, and counterplay buildings (Abatement Fogger Stations, Purple Martin
 * Towers, Retention Ponds, and Preserves).
 */
export function updateMosquitoField(state: GameState): void {
  const { tiles } = state;
  const seasonMult =
    state.season === 'winter' ? 0.15 : state.season === 'summer' ? 1.15 : state.season === 'spring' ? 0.9 : 0.7;

  // Gather active abatement & martin towers
  const abaters: { cx: number; cy: number; r: number; mult: number }[] = [];
  for (const b of state.buildings) {
    if (!b || b.built < 1) continue;
    const cx = b.tx + b.w * 0.5;
    const cy = b.ty + b.h * 0.5;
    if (b.type === 'abatement' && b.powered && !b.blackout && !b.flooded) {
      abaters.push({ cx, cy, r: 9, mult: 0.25 });
    } else if (b.type === 'bat_house') {
      abaters.push({ cx, cy, r: 5, mult: 0.65 });
    } else if (b.type === 'pond') {
      abaters.push({ cx, cy, r: 4, mult: 0.45 });
    }
  }

  let campusSum = 0;
  let campusCount = 0;

  for (let ty = 0; ty < MAP_SIZE; ty++) {
    for (let tx = 0; tx < MAP_SIZE; tx++) {
      const i = idx(tx, ty);
      const f = tiles.flags[i];
      if (f & (TileFlag.OpenWater | TileFlag.Bayou)) {
        tiles.mosq[i] = 0.08 * seasonMult;
        continue;
      }

      let m = 0;
      const d = tiles.depth[i];
      if (d >= 0.05) {
        m = Math.min(1, 0.35 + d * 0.85) * seasonMult;
      } else if (tiles.type[i] === TileType.Marsh) {
        m = 0.55 * seasonMult;
      } else if (tiles.type[i] === TileType.Wet) {
        m = 0.25 * seasonMult;
      } else {
        m = 0.05 * seasonMult;
      }

      if (f & TileFlag.Preserve) m *= 0.78;

      for (const ab of abaters) {
        if (Math.abs(tx - ab.cx) <= ab.r && Math.abs(ty - ab.cy) <= ab.r) {
          m *= ab.mult;
        }
      }

      tiles.mosq[i] = Math.max(0, Math.min(1, m));

      if (tiles.owner[i] >= 0) {
        campusSum += tiles.mosq[i];
        campusCount++;
      }
    }
  }

  state.mosquitoIndex = campusCount > 0 ? Math.round((campusSum / campusCount) * 100) : 0;
}

