import { describe, expect, it } from 'vitest';
import { SimEngine } from './engine';
import { analyzeProtectionAndRisk, stepHydrology } from './hydro';
import { idx } from './terrain';
import { MAP_SIZE, SurfaceType, TileFlag, TileType } from './types';

describe('Bayou State 3D Simulation Core', () => {
  it('generates valid Louisiana terrain with ridge, bayou, river, gulf, and cheniers', () => {
    const sim = new SimEngine(1860, false);
    const { tiles, plot } = sim.state;

    let openWater = 0;
    let bayou = 0;
    let high = 0;
    let marsh = 0;
    for (let i = 0; i < tiles.type.length; i++) {
      if (tiles.type[i] === TileType.OpenWater) openWater++;
      if (tiles.type[i] === TileType.Bayou) bayou++;
      if (tiles.type[i] === TileType.High) high++;
      if (tiles.type[i] === TileType.Marsh) marsh++;
      expect(Number.isFinite(tiles.elev[i])).toBe(true);
      expect(Number.isFinite(tiles.depth[i])).toBe(true);
    }

    expect(openWater).toBeGreaterThan(300);
    expect(bayou).toBeGreaterThan(100);
    expect(high).toBeGreaterThan(80);
    expect(marsh).toBeGreaterThan(200);
    expect(tiles.elev[idx(plot.foundersTx, plot.foundersTy)]).toBeGreaterThan(5.5);
  });

  it('builds a closed levee ring that protects low ground from a 5-ft hurricane surge', () => {
    const sim = new SimEngine(42, false);
    const s = sim.state;
    // Acquire Crevasse Cove parcel (parcel 10) for southern levee ring test
    sim.buyParcel(10);
    // Build a closed levee ring around a low pocket on the southern shelf (tx 39..45, ty 32..37)
    for (let tx = 39; tx <= 45; tx++) {
      s.tiles.elev[idx(tx, 32)] = 2.4;
      s.tiles.elev[idx(tx, 37)] = 2.4;
      sim.place('levee', tx, 32, 0, false, true);
      sim.place('levee', tx, 37, 0, false, true);
    }
    for (let ty = 32; ty <= 37; ty++) {
      s.tiles.elev[idx(39, ty)] = 2.4;
      s.tiles.elev[idx(45, ty)] = 2.4;
      sim.place('levee', 39, ty, 0, false, true);
      sim.place('levee', 45, ty, 0, false, true);
    }
    for (let ty = 33; ty <= 36; ty++) {
      for (let tx = 40; tx <= 44; tx++) {
        s.tiles.elev[idx(tx, ty)] = 2.2;
        s.tiles.depth[idx(tx, ty)] = 0;
      }
    }

    analyzeProtectionAndRisk(s, 5.0);
    expect(s.protectedCount).toBeGreaterThanOrEqual(20);
    expect((s.tiles.flags[idx(42, 34)] & TileFlag.Protected) !== 0).toBe(true);
    expect(s.tiles.risk[idx(42, 34)]).toBe(0);

    // Run storm surge hydrology: interior stays dry while unprotected exterior floods
    s.storm.active = true;
    s.storm.currentSurgeFt = 5.0;
    s.storm.rainRate = 0;
    for (let step = 0; step < 30; step++) {
      stepHydrology(s, 0.05);
    }
    expect(s.tiles.depth[idx(42, 34)]).toBeLessThan(0.05);
  });

  it('triggers a substation blackout cascade when flooded, prevented by pilings or generator', () => {
    const sim = new SimEngine(100, false);
    const fx = sim.state.plot.foundersTx;
    const fy = sim.state.plot.foundersTy;

    const fh = sim.place('founders_hall', fx, fy, 0, false, true);
    const sub = sim.place('substation', fx + 4, fy, 0, false, true);
    expect(fh.ok && sub.ok).toBe(true);

    sim.recomputeCoverage();
    const founders = sim.state.buildings[fh.buildingId!]!;
    expect(founders.powered).toBe(true);

    // Flood the substation tiles (0.5 ft >= 0.3 ft blackout threshold)
    sim.state.tiles.depth[idx(fx + 4, fy)] = 0.6;
    stepHydrology(sim.state, 0.01);
    sim.recomputeCoverage();
    expect(sim.state.buildings[sub.buildingId!]!.flooded).toBe(true);
    expect(founders.powered).toBe(false);
    expect(founders.blackout).toBe(true);

    // Retrofit substation onto pilings -> power restored!
    sim.retrofitPilings(sub.buildingId!);
    stepHydrology(sim.state, 0.01);
    sim.recomputeCoverage();
    expect(sim.state.buildings[sub.buildingId!]!.flooded).toBe(false);
    expect(founders.powered).toBe(true);
  });

  it('boots Flagship Showcase cleanly and runs Hurricane + Saturday Night Game without NaN', () => {
    const sim = new SimEngine(1860, true);
    expect(sim.state.buildings.filter(Boolean).length).toBeGreaterThan(15);
    expect(sim.state.agents.length).toBeGreaterThan(50);

    // Launch Saturday Night in The Cauldron
    const gameRes = sim.triggerHomeGame(true);
    expect(gameRes.ok).toBe(true);
    for (let i = 0; i < 450; i++) sim.stepTick();
    expect(sim.state.football.active).toBe(false);
    expect(sim.state.football.finished).toBe(true);
    expect(sim.state.economy.wins + sim.state.economy.losses).toBeGreaterThanOrEqual(9);

    // Launch Category 3 Hurricane
    sim.triggerHurricane(3);
    expect(sim.state.storm.active).toBe(true);
    for (let i = 0; i < 520; i++) sim.stepTick();
    expect(sim.state.storm.active).toBe(false);
    expect(sim.state.storm.lastReport).not.toBeNull();
    expect(Number.isFinite(sim.state.economy.cash)).toBe(true);
    expect(Number.isFinite(sim.state.economy.prestige)).toBe(true);
  }, 15_000);

  it('serializes and deserializes full state cleanly', () => {
    const sim = new SimEngine(777, true);
    const json = sim.serialize();
    const sim2 = new SimEngine(1, false);
    expect(sim2.deserialize(json)).toBe(true);
    expect(sim2.state.seed).toBe(777);
    expect(sim2.state.economy.students).toBe(sim.state.economy.students);
    expect(sim2.state.buildings.filter(Boolean).length).toBe(sim.state.buildings.filter(Boolean).length);
    expect(sim2.state.tiles.elev.length).toBe(MAP_SIZE * MAP_SIZE);
  });

  it('tracks Slice 2 colleges, degree programs, and multi-tier upgrade bonuses', () => {
    const sim = new SimEngine(1860, true);
    expect(sim.state.economy.collegesFounded).toBeGreaterThanOrEqual(5);
    expect(sim.state.economy.activePrograms).toBeGreaterThanOrEqual(20);

    // Upgrade Dining Hall through all 2 tiers and confirm dining capacity increases
    const dining = sim.state.buildings.find((b) => b && b.type === 'dining_hall');
    expect(dining).toBeTruthy();
    const beforeDining = sim.state.economy.capacity.dining;
    expect(sim.upgradeBuilding(dining!.id).ok).toBe(true);
    expect(sim.state.economy.capacity.dining).toBeGreaterThan(beforeDining);
    expect(sim.upgradeBuilding(dining!.id).ok).toBe(true);
    expect(sim.state.buildings[dining!.id]!.tier).toBe(2);

    // Upgrade Parking Garage -> 5-story Parking Tower and confirm venue income rises
    const parking = sim.state.buildings.find((b) => b && b.type === 'parking');
    expect(parking).toBeTruthy();
    const beforeVenues = sim.state.economy.breakdown.venues;
    expect(sim.upgradeBuilding(parking!.id).ok).toBe(true);
    expect(sim.state.economy.breakdown.venues).toBeGreaterThan(beforeVenues);
  });

  it('runs Slice 3 ecosystem: mosquitoes, Mardi Gras parade, dilemmas, floodwalls & capstones', () => {
    const sim = new SimEngine(1860, true);
    // Showcase includes Spoonbill Rookery, Wildlife Post & Abatement station
    expect(sim.state.spoonbillCount).toBeGreaterThanOrEqual(6);
    expect(sim.state.vehicles.some((v) => v.kind === 'fogger')).toBe(true);
    expect(sim.state.vehicles.some((v) => v.kind === 'officer')).toBe(true);

    // Concrete Floodwall places with 12-ft crest and Floodwall flag
    const fw = sim.place('floodwall', 36, 29, 0, false, true);
    expect(fw.ok).toBe(true);
    expect(sim.state.tiles.crest[idx(36, 29)]).toBe(12);
    expect((sim.state.tiles.flags[idx(36, 29)] & TileFlag.Floodwall) !== 0).toBe(true);

    // Mardi Gras Parade spawns 3 floats and pays festival revenue on completion
    const cashBefore = sim.state.economy.cash;
    expect(sim.triggerMardiGras().ok).toBe(true);
    expect(sim.state.vehicles.filter((v) => v.kind === 'parade_float').length).toBe(3);
    sim.skipActiveSetPiece();
    expect(sim.state.parade.active).toBe(false);
    expect(sim.state.economy.cash).toBeGreaterThan(cashBefore);

    // Board of Regents / Student Voice Dilemma resolves cleanly
    sim.triggerDilemma();
    expect(sim.state.activeDilemma).not.toBeNull();
    sim.resolveDilemma(0);
    expect(sim.state.activeDilemma).toBeNull();
  });

  it('supports Slice 4 College Town unlock at Lv.10 and Land Office parcel expansion', () => {
    // Fresh Charter starts at Lv.1 with 4 starter parcels and College Town locked
    const charter = new SimEngine(1860, false);
    expect(charter.state.ownedParcels.filter(Boolean).length).toBe(4);
    expect(charter.state.collegeTownUnlocked).toBe(false);

    // Trying to place on unowned Western Chenier parcel (parcel 4: tx=12, ty=20) is rejected
    const blockedParcel = charter.canPlace('dorm', 12, 20, 0, false);
    expect(blockedParcel.ok).toBe(false);
    expect(blockedParcel.reason).toContain('Land Office');

    // Buying parcel 4 succeeds and unlocks building there!
    expect(charter.buyParcel(4).ok).toBe(true);
    expect(charter.state.ownedParcels[4]).toBe(true);
    expect(charter.canPlace('dorm', 12, 20, 0, false).ok).toBe(true);

    // College Town building is gated until Level 10, then unlocks cleanly
    expect(charter.canPlace('town_center', 43, 7, 0, false).ok).toBe(false);
    charter.unlockCollegeTown();
    expect(charter.state.collegeTownUnlocked).toBe(true);
    expect(charter.state.economy.campusLevel).toBeGreaterThanOrEqual(10);
    expect(charter.place('town_center', 43, 7, 0, false, true).ok).toBe(true);
    expect(charter.place('coffee_roaster', 39, 7, 0, false, true).ok).toBe(true);
  });

  it('prevents NPCs from walking under buildings, keeps NPC cars strictly on roads, and snaps buildings to paths', () => {
    const sim = new SimEngine(1860, true);
    // Step 120 ticks with active vehicles and students
    for (let t = 0; t < 120; t++) {
      sim.stepTick();
      // Every student must NEVER stand inside or under ANY building (including pilings!)
      for (const a of sim.state.agents) {
        const ti = idx(Math.floor(a.x), Math.floor(a.y));
        expect(sim.state.tiles.owner[ti]).toBe(-1);
      }
      // Every NPC car (fogger & shuttle) must stay strictly on Road or Bridge tiles!
      for (const v of sim.state.vehicles) {
        if (v.kind === 'fogger' || v.kind === 'shuttle') {
          const ti = idx(Math.floor(v.x), Math.floor(v.y));
          const sf = sim.state.tiles.surface[ti];
          expect(sf === SurfaceType.Road || sf === SurfaceType.Bridge).toBe(true);
        }
      }
    }

    // Verify magnetic building-to-path snap
    const charter = new SimEngine(1860, false);
    // Lay a horizontal path along ty = 15, tx = 40..46
    for (let tx = 40; tx <= 46; tx++) charter.place('path', tx, 15, 0, false, true);
    // Hovering a 3x2 dorm 1 tile south of the path (ty = 17) snaps flush up against ty = 16!
    const snapped = charter.findSnapPosition('dorm', 41, 17, 0, false);
    expect(snapped.snapped).toBe(true);
    expect(snapped.ty).toBe(16);

    // Verify Goal 2 step progression: building Founders -> Dorm advances buildHint from 'dorm' -> 'dining_hall' -> 'substation' -> 'water_tower'!
    expect(charter.place('founders_hall', charter.state.plot.foundersTx, charter.state.plot.foundersTy, 0, false).ok).toBe(true);
    expect(charter.state.goals[charter.state.activeGoalIdx].id).toBe('campus_core');
    expect(charter.state.goals[charter.state.activeGoalIdx].buildHint).toBe('dorm');

    expect(charter.place('dorm', 41, 16, 0, false).ok).toBe(true);
    const g2 = charter.state.goals[charter.state.activeGoalIdx];
    expect(g2.steps![0].done).toBe(true);
    expect(g2.buildHint).toBe('dining_hall');
    expect(g2.progressText).toBe('1 / 4 steps');

    // Verify Bulldoze clears natural trees too!
    const tree = charter.state.veg[0];
    const vegBefore = charter.state.veg.length;
    expect(charter.demolish(tree.tx, tree.ty)).toBe(true);
    expect(charter.state.veg.length).toBeLessThan(vegBefore);
  });

  it('bulldozes trees/surfaces, levels ground under new buildings, and auto-connects a path to the nearest path', () => {
    const sim = new SimEngine(1860, false);
    sim.state.economy.cash = 20_000_000;
    const { tiles } = sim.state;

    // Create an existing campus path along ty = 13, tx = 40..46
    for (let tx = 40; tx <= 46; tx++) {
      sim.place('path', tx, 13, 0, false, true);
    }

    // Prepare an uneven, wooded, cluttered site 3 tiles south of that path (tx = 41..43, ty = 17..18)
    const siteTx = 41;
    const siteTy = 17;
    tiles.elev[idx(siteTx, siteTy)] = 6.4;
    tiles.elev[idx(siteTx + 1, siteTy)] = 5.1;
    tiles.elev[idx(siteTx + 2, siteTy)] = 4.2;
    tiles.elev[idx(siteTx, siteTy + 1)] = 5.8;
    tiles.elev[idx(siteTx + 1, siteTy + 1)] = 4.6;
    tiles.elev[idx(siteTx + 2, siteTy + 1)] = 3.9;
    tiles.surface[idx(siteTx + 1, siteTy)] = SurfaceType.Quad;
    // Plant trees right inside the building site AND along the auto-connect corridor
    sim.state.veg.push(
      { id: 99001, kind: 'oak', tx: siteTx + 1, ty: siteTy, scale: 1.1, rot: 0, planted: false },
      { id: 99002, kind: 'cypress', tx: siteTx + 2, ty: siteTy + 1, scale: 1.0, rot: 0, planted: false },
      { id: 99003, kind: 'oak', tx: siteTx + 1, ty: 15, scale: 1.0, rot: 0, planted: false },
    );

    const res = sim.place('dorm', siteTx, siteTy, 0, false, false);
    expect(res.ok).toBe(true);

    // 1. Every tile under the 3x2 dorm must be leveled to identical elevation and have no leftover surface
    const leveledElev = tiles.elev[idx(siteTx, siteTy)];
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        const ti = idx(siteTx + dx, siteTy + dy);
        expect(tiles.elev[ti]).toBe(leveledElev);
        expect(tiles.surface[ti]).toBe(SurfaceType.None);
      }
    }

    // 2. Zero trees remain inside the building footprint
    const treesInside = sim.state.veg.filter(
      (v) => v.tx >= siteTx && v.tx < siteTx + 3 && v.ty >= siteTy && v.ty < siteTy + 2,
    );
    expect(treesInside.length).toBe(0);

    // 3. An auto-connected brick walkway now ties the dorm's north edge (ty = 16) straight up to ty = 13!
    let connectedCol = -1;
    for (let dx = 0; dx < 3; dx++) {
      const cx = siteTx + dx;
      if (
        tiles.surface[idx(cx, 16)] === SurfaceType.Path &&
        tiles.surface[idx(cx, 15)] === SurfaceType.Path &&
        tiles.surface[idx(cx, 14)] === SurfaceType.Path
      ) {
        connectedCol = cx;
        break;
      }
    }
    expect(connectedCol).toBeGreaterThanOrEqual(siteTx);
    // And any tree standing on the newly auto-connected path spur was cleared too!
    expect(sim.state.veg.some((v) => v.tx === connectedCol && v.ty === 15)).toBe(false);
  });
});
