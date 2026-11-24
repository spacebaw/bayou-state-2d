import { BUILDING_NAME_PREFIXES, CATALOG, GATOR_NAMES, OPPONENTS, STORM_NAMES } from './catalog';
import { analyzeProtectionAndRisk, stepHydrology, updateMosquitoField } from './hydro';
import { SeededRNG } from './rng';
import { classifyTiles, generateTerrain, idx, inBounds } from './terrain';
import {
  Agent,
  BuildingId,
  BuildingInstance,
  DecisionToast,
  DilemmaCard,
  FootballGameState,
  GameState,
  Gator,
  GoalDef,
  MAP_SIZE,
  MardiGrasState,
  OverlayMode,
  Pirogue,
  Season,
  ServiceVehicle,
  SimEvent,
  SkyPhase,
  StormState,
  SurfaceType,
  TILE_COUNT,
  TileFlag,
  TileType,
} from './types';

const DILEMMA_POOL: DilemmaCard[] = [
  {
    id: 'regents_grant',
    source: 'Board of Regents',
    title: 'Legislature Offers Matching Grant',
    body: 'Lawmakers want Bayou State on national TV. Choose how to direct the $1.2M state appropriation:',
    choices: [
      {
        label: 'Athletics & Stadium Boost',
        effectText: '+$1.20M cash · +3 Prestige · -3 Ecology optics',
        cashDelta: 1_200_000,
        prestigeDelta: 3,
        ecologyDelta: -3,
      },
      {
        label: 'Joint Coastal & Academic Pact',
        effectText: '+$700k cash · +5 Prestige · +5 Ecology',
        cashDelta: 700_000,
        prestigeDelta: 5,
        ecologyDelta: 5,
      },
    ],
  },
  {
    id: 'voice_gator',
    source: 'Student Voice',
    title: 'Students Adopted a Quad Alligator',
    body: 'Freshmen named the 7-foot gator sunning near the library "Boudreaux" and started an Instagram page.',
    choices: [
      {
        label: 'Build a Safe Viewing Rail ($25k)',
        effectText: '-$25k · +7 Happiness · +2 Prestige',
        cashDelta: -25_000,
        happinessDelta: 7,
        prestigeDelta: 2,
      },
      {
        label: 'Relocate Gently to Bayou Preserve',
        effectText: 'Free · +3 Ecology · +2 Prestige',
        ecologyDelta: 3,
        prestigeDelta: 2,
      },
    ],
  },
  {
    id: 'regents_insurance',
    source: 'Board of Regents',
    title: 'Gulf Storm Insurance Pool',
    body: 'Hurricane season is heating up. Join the multi-campus state storm indemnity pool?',
    choices: [
      {
        label: 'Enroll in Storm Pool ($120k)',
        effectText: '-$120k · Halves next hurricane repair bill!',
        cashDelta: -120_000,
        grantInsurance: true,
      },
      {
        label: 'Self-Insure & Keep Treasury',
        effectText: '$0 cost · Rely on levees & pilings',
      },
    ],
  },
  {
    id: 'voice_crawfish',
    source: 'Student Voice',
    title: 'Spring Quad Crawfish Boil',
    body: 'Student Government wants to boil 8,000 pounds of Louisiana crawfish on the Main Quad before finals!',
    choices: [
      {
        label: 'Sponsor Live Zydeco Band ($45k)',
        effectText: '-$45k · +10 Happiness · +3 Prestige',
        cashDelta: -45_000,
        happinessDelta: 10,
        prestigeDelta: 3,
      },
      {
        label: 'Approve Student-Funded Boil',
        effectText: 'Free · +4 Happiness',
        happinessDelta: 4,
      },
    ],
  },
  {
    id: 'regents_corps',
    source: 'Board of Regents',
    title: 'Corps of Engineers Inspection',
    body: 'Federal flood engineers visited campus and offered a one-time infrastructure partnership.',
    choices: [
      {
        label: 'Restore All Levee Integrity',
        effectText: 'Repairs all nutria burrows to 100% + $300k',
        cashDelta: 300_000,
        repairLevees: true,
      },
      {
        label: 'Marsh Restoration Stipend',
        effectText: '+$550k cash · +6 Ecology',
        cashDelta: 550_000,
        ecologyDelta: 6,
      },
    ],
  },
];

function defaultParade(): MardiGrasState {
  return {
    active: false,
    tick: 0,
    duration: 280,
    route: [],
    revenue: 0,
  };
}

export const PARCEL_INFO: { name: string; price: number }[] = [
  { name: 'NW Cypress Woods', price: 650_000 },
  { name: 'Upper Bayou Bend', price: 850_000 },
  { name: 'Northgate District', price: 0 }, // Starter parcel 2 (tx 32..47, ty 0..15)
  { name: 'High River Crown', price: 0 },   // Starter parcel 3 (tx 48..63, ty 0..15)
  { name: 'West Chenier Bluff', price: 950_000 },
  { name: 'Bayou Crossing', price: 750_000 },
  { name: 'Main Quad Charter', price: 0 },  // Starter parcel 6 (tx 32..47, ty 16..31)
  { name: 'East Ridge Terrace', price: 0 }, // Starter parcel 7 (tx 48..63, ty 16..31)
  { name: 'South Chenier', price: 700_000 },
  { name: 'Swamp Preserve Belt', price: 550_000 },
  { name: 'Crevasse Cove', price: 620_000 },
  { name: 'Big Muddy Bend', price: 680_000 },
  { name: 'Cypress Lake West', price: 500_000 },
  { name: 'Gulf Marsh Delta', price: 480_000 },
  { name: 'Lower Bayou Mouth', price: 520_000 },
  { name: 'River Delta Point', price: 580_000 },
];

export function parcelIndexAt(tx: number, ty: number): number {
  const px = Math.max(0, Math.min(3, Math.floor(tx / 16)));
  const py = Math.max(0, Math.min(3, Math.floor(ty / 16)));
  return py * 4 + px;
}

function defaultOwnedParcels(all: boolean): boolean[] {
  if (all) return Array(16).fill(true);
  return PARCEL_INFO.map((p) => p.price === 0);
}

export interface PlaceResult {
  ok: boolean;
  reason?: string;
  cost: number;
  warning?: string;
  buildingId?: number;
}

function defaultStorm(): StormState {
  return {
    active: false,
    name: 'Amélie',
    category: 2,
    phase: 'none',
    tick: 0,
    duration: 540,
    targetSurgeFt: 4.5,
    currentSurgeFt: 0,
    windIntensity: 0,
    rainRate: 0,
    lightningFlash: 0,
    sandbagged: false,
    sheltered: false,
    toastsFired: {},
    lastReport: null,
  };
}

function defaultFootball(): FootballGameState {
  return {
    active: false,
    opponent: 'Delta A&M',
    opponentColor: '#8b2635',
    nightGame: true,
    tick: 0,
    duration: 440,
    quarter: 1,
    homeScore: 0,
    awayScore: 0,
    attendance: 0,
    capacity: 45000,
    winProb: 0.58,
    halftimeAsked: false,
    aggressiveCall: false,
    playLog: [],
    fireworkBurstTick: -100,
    shakeTrigger: 0,
    finished: false,
    revenue: 0,
  };
}

function buildStarterGoals(): GoalDef[] {
  return [
    {
      id: 'founders',
      title: "Charter Founders' Hall",
      subtitle: "Place Founders' Hall on the dry natural-levee ridge (free charter grant).",
      rewardCash: 250_000,
      rewardPrestige: 4,
      buildHint: 'founders_hall',
      completed: false,
      progressText: '0 / 1',
      progressFrac: 0,
    },
    {
      id: 'campus_core',
      title: 'Welcome the First Class',
      subtitle: 'Build a Freshman Dorm, Dining Commons, Power Substation & Water Tower.',
      rewardCash: 450_000,
      rewardPrestige: 6,
      buildHint: 'dorm',
      completed: false,
      progressText: '0 / 4',
      progressFrac: 0,
    },
    {
      id: 'quad_life',
      title: 'Shape the Main Quad',
      subtitle: 'Paint at least 8 Quad Lawn tiles and connect campus with Brick Quad Paths.',
      rewardCash: 300_000,
      rewardPrestige: 5,
      buildHint: 'quad',
      completed: false,
      progressText: '0 / 8 tiles',
      progressFrac: 0,
    },
    {
      id: 'swamp_defense',
      title: 'Outsmart the Bayou',
      subtitle: 'Build 8+ Earthen Levee tiles, a Drainage Canal, and a Pump Station (or 2 Pilings buildings).',
      rewardCash: 600_000,
      rewardPrestige: 8,
      buildHint: 'levee',
      completed: false,
      progressText: '0 / 3',
      progressFrac: 0,
    },
    {
      id: 'cross_bayou',
      title: 'Bridge the Bayou',
      subtitle: 'Span the bayou with a Bayou Road Bridge or Cypress Boardwalk to reach the western cheniers.',
      rewardCash: 500_000,
      rewardPrestige: 6,
      buildHint: 'road_bridge',
      completed: false,
      progressText: '0 / 3 spans',
      progressFrac: 0,
    },
    {
      id: 'landmarks',
      title: 'Flagship Icons',
      subtitle: "Erect the Memorial Bell Tower or Roux's Tiger Habitat to put Bayou State on the map.",
      rewardCash: 800_000,
      rewardPrestige: 10,
      buildHint: 'bell_tower',
      completed: false,
      progressText: '0 / 1',
      progressFrac: 0,
    },
    {
      id: 'cauldron',
      title: 'Saturday Night in The Cauldron',
      subtitle: 'Build Red Stick Stadium, upgrade it to The Cauldron, and play a Saturday Night Game!',
      rewardCash: 1_500_000,
      rewardPrestige: 15,
      buildHint: 'stadium',
      completed: false,
      progressText: 'Build Stadium',
      progressFrac: 0,
    },
  ];
}

export class SimEngine {
  state: GameState;
  rng: SeededRNG;
  private nextBuildingId = 1;
  private nextVegId = 10000;
  private nextTickerId = 1;
  private stormNameCursor = 0;
  private listeners: ((ev: SimEvent) => void)[] = [];

  constructor(seed = 1860, showcase = false) {
    this.rng = new SeededRNG(seed);
    this.state = this.createInitialState(seed, showcase);
  }

  onEvent(fn: (ev: SimEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private emit(ev: SimEvent): void {
    for (const l of this.listeners) l(ev);
  }

  private pushTicker(text: string, kind: GameState['ticker'][0]['kind'] = 'info'): void {
    this.state.ticker.unshift({
      id: this.nextTickerId++,
      day: this.state.day,
      text,
      kind,
    });
    if (this.state.ticker.length > 24) this.state.ticker.length = 24;
  }

  private createInitialState(seed: number, showcase: boolean): GameState {
    this.rng = new SeededRNG(seed);
    this.nextBuildingId = 0;
    this.nextVegId = 10000;
    this.stormNameCursor = 0;

    const { tiles, plot, veg } = generateTerrain(seed);
    const state: GameState = {
      seed,
      tick: 0,
      day: 0,
      dayTick: 0,
      year: 1,
      month: 1,
      dom: 1,
      season: 'winter',
      skyTick: 75, // Start in bright morning sunshine!
      skyPhase: 'day',
      skyProgress: 0.25,
      speed: 1,
      tiles,
      plot,
      buildings: [],
      veg,
      agents: [],
      gators: [],
      pirogues: [],
      vehicles: [],
      economy: {
        cash: 4_500_000,
        students: 0,
        alumni: 0,
        prestige: 12,
        happiness: 68,
        ecology: 78,
        capacity: { beds: 0, seats: 0, dining: 0 },
        breakdown: {
          tuition: 0,
          state: 0,
          alumni: 0,
          research: 0,
          venues: 0,
          upkeep: 0,
          staff: 0,
        },
        collegesFounded: 0,
        activePrograms: 0,
        monthlyIncome: 0,
        monthlyExpense: 0,
        lastNet: 0,
        wins: 0,
        losses: 0,
        teamRating: 48,
        xp: 0,
        campusLevel: 1,
      },
      storm: defaultStorm(),
      football: defaultFootball(),
      parade: defaultParade(),
      activeDilemma: null,
      stormInsurance: false,
      mosquitoIndex: 12,
      gatorRelocations: 0,
      nutriaBurrows: 0,
      spoonbillCount: 0,
      ownedParcels: defaultOwnedParcels(showcase),
      collegeTownUnlocked: showcase,
      levelUpToast: null,
      goals: buildStarterGoals(),
      activeGoalIdx: 0,
      activeToast: null,
      ticker: [],
      overlay: OverlayMode.None,
      rainRate: 0,
      windStrength: 0.14,
      riverStage: 0,
      bayouStage: 0,
      protectedCount: 0,
      leveeGaps: [],
      terrainDirty: true,
      buildingsDirty: true,
      vegDirty: true,
      waterDirty: true,
      showcaseMode: showcase,
    };

    this.state = state;
    this.spawnInitialWildlife();
    analyzeProtectionAndRisk(state, 5.0);

    if (showcase) {
      this.buildShowcaseCampus();
    } else {
      this.evaluateGoals();
      this.pushTicker("Welcome, Chancellor! Charter Founders' Hall on the high ridge to begin.", 'info');
    }

    return state;
  }

  newGame(seed = Math.floor(Math.random() * 89999 + 10000), showcase = false): void {
    this.state = this.createInitialState(seed, showcase);
  }

  private spawnInitialWildlife(): void {
    const { tiles, gators, plot } = this.state;
    // Place 4 gators along marsh/bayou banks
    let count = 0;
    for (let attempt = 0; attempt < 200 && count < 4; attempt++) {
      const tx = this.rng.int(6, 52);
      const ty = this.rng.int(12, 52);
      const i = idx(tx, ty);
      if (tiles.type[i] === TileType.Marsh || tiles.flags[i] & TileFlag.Bayou) {
        gators.push({
          id: count + 1,
          name: GATOR_NAMES[count % GATOR_NAMES.length],
          x: tx + 0.5,
          y: ty + 0.5,
          angle: this.rng.range(0, Math.PI * 2),
          state: 'sun',
          homeTile: i,
          targetX: tx + 0.5,
          targetY: ty + 0.5,
          timer: this.rng.int(30, 120),
          size: this.rng.range(0.9, 1.25),
        });
        count++;
      }
    }

    // Spawn 2 scenic pirogues gliding on the bayou
    if (plot.bayouSpline.length > 20) {
      this.state.pirogues.push(
        { id: 1, splinePos: 4, direction: 1, passengers: 60, delivered: false },
        { id: 2, splinePos: Math.min(35, plot.bayouSpline.length - 6), direction: -1, passengers: 0, delivered: true },
      );
    }
  }

  /**
   * Builds a breathtaking, living flagship LSU-inspired campus immediately
   * so players or students can tour, trigger Saturday Night in The Cauldron,
   * or unleash a Category 4 Hurricane right out of the box!
   */
  private buildShowcaseCampus(): void {
    const s = this.state;
    const fx = s.plot.foundersTx; // 41
    const fy = s.plot.foundersTy; // 12

    // Give flagship treasury & stats
    s.economy.cash = 14_500_000;
    s.economy.students = 2_450;
    s.economy.alumni = 820;
    s.economy.prestige = 62;
    s.economy.happiness = 82;
    s.economy.wins = 7;
    s.economy.losses = 1;
    s.economy.campusLevel = 10;
    s.economy.xp = 4950;
    s.collegeTownUnlocked = true;
    s.ownedParcels = defaultOwnedParcels(true);
    s.year = 3;
    s.month = 10; // October — football & hurricane peak!
    s.dom = 4;
    s.season = 'fall';
    s.skyTick = 158; // Warm golden hour approaching twilight!
    s.skyPhase = 'golden';

    // 1. Main Quad Lawns south of Founders' Hall (6x4 lush merged quad)
    for (let ty = fy + 4; ty <= fy + 7; ty++) {
      for (let tx = fx - 1; tx <= fx + 4; tx++) {
        this.place('quad', tx, ty, 0, false, true);
      }
    }

    // 2. Brick Quad Paths framing the quad and linking buildings
    for (let tx = fx - 4; tx <= fx + 7; tx++) {
      this.place('path', tx, fy + 3, 0, false, true);
      this.place('path', tx, fy + 8, 0, false, true);
    }
    for (let ty = fy - 1; ty <= fy + 11; ty++) {
      this.place('path', fx - 2, ty, 0, false, true);
      this.place('path', fx + 5, ty, 0, false, true);
    }

    // 3. Campus Road spine from Highway 1 down and west across the bayou to The Cauldron!
    for (let ty = 10; ty <= 23; ty++) {
      this.place('road', 36, ty, 0, false, true);
    }
    for (let tx = 36; tx <= 42; tx++) {
      this.place('road', tx, 10, 0, false, true);
    }
    // Bridge across bayou along ty = 22 from tx = 36 west to chenier tx = 18
    for (let tx = 18; tx <= 35; tx++) {
      const i = idx(tx, 22);
      const needsBridge =
        (s.tiles.flags[i] & (TileFlag.Bayou | TileFlag.OpenWater)) !== 0 ||
        s.tiles.type[i] === TileType.Marsh;
      this.place(needsBridge ? 'road_bridge' : 'road', tx, 22, 0, false, true);
    }

    // Scenic Cypress Boardwalk from Founders' west to Pirogue Landing & Coastal Institute
    for (let tx = s.plot.landingTx - 1; tx <= fx - 2; tx++) {
      this.place('boardwalk', tx, 14, 0, false, true);
    }

    // 4. Italian Renaissance Revival Academic Heart + Slice 2 Colleges!
    this.place('founders_hall', fx, fy, 0, false, true);
    this.place('bell_tower', fx + 1, fy + 5, 0, false, true); // Centerpiece in the quad!
    const libRes = this.place('library', fx + 6, fy + 3, 0, false, true);
    if (libRes.buildingId !== undefined && s.buildings[libRes.buildingId]) {
      s.buildings[libRes.buildingId]!.tier = 1; // Flagship Research Library with glass rotunda!
      s.buildings[libRes.buildingId]!.name = 'Flagship Research Library';
    }
    this.place('lecture_hall', 33, 15, 0, false, true);
    this.place('engineering', fx + 6, fy + 7, 0, false, true);
    this.place('business_college', fx + 6, fy - 1, 0, false, true);
    this.place('science_college', 37, 11, 0, false, true);
    this.place('union', 41, 24, 0, false, true);
    this.place('rec_center', 37, 6, 0, false, true);
    this.place('tiger_statue', fx + 2, fy + 3, 0, false, true);
    const parkRes = this.place('parking', 37, 21, 0, false, true);
    if (parkRes.buildingId !== undefined && s.buildings[parkRes.buildingId]) {
      s.buildings[parkRes.buildingId]!.tier = 1; // 3-story concrete garage!
      s.buildings[parkRes.buildingId]!.name = 'North Parking Garage';
    }

    // Coastal Studies Institute perched over the bayou edge on stilts
    this.place('coastal_institute', s.plot.landingTx - 1, 15, 0, true, true);

    // 5. Residential & Student Life
    this.place('dorm', 33, 18, 0, false, true);
    this.place('dorm', 33, 23, 0, false, true);
    this.place('res_tower', 47, 23, 0, false, true);
    this.place('dining_hall', 41, 21, 0, false, true);
    this.place('poboy', 45, 21, 0, false, true);

    // 6. Utilities (with Substation on pilings + Backup Generator!)
    this.place('substation', 46, 8, 0, true, true);
    this.place('water_tower', 49, 8, 0, false, true);
    this.place('generator', 45, 9, 0, true, true);
    // West campus power & water for The Cauldron & Basketball Arena
    this.place('substation', 19, 25, 0, true, true);
    this.place('water_tower', 19, 19, 0, false, true);

    // 7. Roux's Tiger Habitat overlooking the quad & bayou road!
    const tigerRes = this.place('tiger_habitat', 37, 24, 0, false, true);
    if (tigerRes.buildingId !== undefined) {
      const tb = s.buildings[tigerRes.buildingId];
      if (tb) tb.tier = 1;
    }

    // 8. THE CAULDRON + BASKETBALL ARENA on the Western Chenier!
    const stadRes = this.place('stadium', 12, 20, 0, false, true);
    if (stadRes.buildingId !== undefined) {
      const sb = s.buildings[stadRes.buildingId];
      if (sb) {
        sb.tier = 1; // The Cauldron (6 light masts, night games!)
        sb.name = 'The Cauldron';
      }
    }
    this.place('arena', 13, 15, 0, true, true);
    this.place('practice_field', 13, 26, 0, false, true);

    // 9. Southern Cove Levee Ring + Drainage Canal + Pump Station (demonstrates live flood protection!)
    // Fully closed earthen ring enclosing x=37..49, y=28..37!
    for (let tx = 37; tx <= 49; tx++) {
      this.place('levee', tx, 28, 0, false, true);
      this.place('levee', tx, 37, 0, false, true);
    }
    for (let ty = 28; ty <= 37; ty++) {
      this.place('levee', 37, ty, 0, false, true);
      this.place('levee', 49, ty, 0, false, true);
    }
    // Drainage canal cutting through the cove out to the bayou (forming an automatic Floodgate at tx=37!)
    for (let tx = 31; tx <= 45; tx++) {
      this.place('canal', tx, 33, 0, false, true);
    }
    this.place('pump', 40, 31, 0, false, true);
    this.place('pond', 44, 29, 0, false, true);

    // Paint a Wetland Preserve along the SW bayou marsh + Slice 3 Capstones & Wildlife Services!
    let rookeryPlaced = false;
    for (let ty = 34; ty <= 43; ty++) {
      for (let tx = 19; tx <= 26; tx++) {
        const i = idx(tx, ty);
        if (s.tiles.type[i] === TileType.Marsh) {
          this.place('preserve', tx, ty, 0, false, true);
          if (!rookeryPlaced) {
            const r = this.place('rookery', tx, ty, 0, true, true);
            if (r.ok) rookeryPlaced = true;
          }
        }
      }
    }
    this.place('wildlife_post', 37, 27, 0, true, true);
    this.place('abatement', 35, 20, 0, true, true);
    this.place('bat_house', 38, 17, 0, false, true);
    this.place('health_center', 45, 18, 0, false, true);

    // Slice 4 College Town Strip along Northgate Highway 1 (high dry ridge north of Founders')!
    this.place('town_center', 43, 4, 0, true, true);
    this.place('coffee_roaster', 39, 4, 0, true, true);
    this.place('music_club', 43, 7, 0, false, true);

    // Line the main quad with vibrant azaleas & live oaks
    this.place('azalea', fx - 1, fy + 4, 0, false, true);
    this.place('azalea', fx + 4, fy + 4, 0, false, true);
    this.place('azalea', fx - 1, fy + 7, 0, false, true);
    this.place('azalea', fx + 4, fy + 7, 0, false, true);
    this.place('live_oak', fx - 1, fy + 5, 0, false, true);
    this.place('live_oak', fx + 4, fy + 6, 0, false, true);

    // Mark all buildings finished
    for (const b of s.buildings) {
      if (b) b.built = 1;
    }

    classifyTiles(s.tiles);
    this.recomputeCoverage();
    analyzeProtectionAndRisk(s, 5.0);
    updateMosquitoField(s);
    this.syncServiceVehicles();
    this.recomputeStats();
    this.syncAgents();
    this.evaluateGoals();
    // Keep final spectacle goal active in Flagship Showcase so players have an instant call-to-action!
    const cauldronGoal = s.goals.find((g) => g.id === 'cauldron');
    if (cauldronGoal) {
      cauldronGoal.completed = false;
      cauldronGoal.progressText = 'Click Director → Night Game!';
      cauldronGoal.progressFrac = 0.67;
      s.activeGoalIdx = s.goals.indexOf(cauldronGoal);
    }

    this.pushTicker('Flagship Campus loaded! Try launching a Saturday Night Game or Hurricane in Director Mode.', 'sports');
  }

  private hasEngineering(): boolean {
    return this.state.buildings.some((b) => b && b.type === 'engineering' && b.built >= 1);
  }

  computeCost(id: BuildingId, tx: number, ty: number, pilings: boolean): number {
    const def = CATALOG[id];
    let cost = def.cost;
    if (id === 'founders_hall') {
      const exists = this.state.buildings.some((b) => b && b.type === 'founders_hall');
      return exists ? 1_200_000 : 0;
    }

    const i = inBounds(tx, ty) ? idx(tx, ty) : 0;
    const t = this.state.tiles.type[i];

    // Terrain modifiers
    if (!def.drag && !def.isNature) {
      if (t === TileType.Wet) cost = Math.round(cost * 1.15);
      else if (t === TileType.High) cost = Math.round(cost * 0.92);
    }
    if (pilings && def.canPilings && !def.autoPilings) {
      cost = Math.round(cost * 1.4);
    }
    if ((id === 'levee' || id === 'canal' || id === 'pump') && this.hasEngineering()) {
      cost = Math.round(cost * 0.85);
    }
    return cost;
  }

  /**
   * Magnetic snap helper: when hovering near an existing Path, Road, Quad, or Parade Ground,
   * snaps a footprint building to the closest valid placement flush against that path!
   */
  findSnapPosition(
    id: BuildingId,
    tx: number,
    ty: number,
    rot: 0 | 1 | 2 | 3 = 0,
    pilings = false,
  ): { tx: number; ty: number; snapped: boolean } {
    const def = CATALOG[id];
    if (def.drag || def.isSurface || def.isNature) {
      return { tx, ty, snapped: false };
    }
    const w = rot % 2 === 1 ? def.h : def.w;
    const h = rot % 2 === 1 ? def.w : def.h;

    const touchesPathOrRoad = (bx: number, by: number): boolean => {
      const { tiles } = this.state;
      for (let dx = 0; dx < w; dx++) {
        for (const ey of [by - 1, by + h]) {
          if (inBounds(bx + dx, ey)) {
            const sf = tiles.surface[idx(bx + dx, ey)];
            if (
              sf === SurfaceType.Path ||
              sf === SurfaceType.Road ||
              sf === SurfaceType.Quad ||
              sf === SurfaceType.ParadeGround ||
              sf === SurfaceType.Boardwalk
            ) {
              return true;
            }
          }
        }
      }
      for (let dy = 0; dy < h; dy++) {
        for (const ex of [bx - 1, bx + w]) {
          if (inBounds(ex, by + dy)) {
            const sf = tiles.surface[idx(ex, by + dy)];
            if (
              sf === SurfaceType.Path ||
              sf === SurfaceType.Road ||
              sf === SurfaceType.Quad ||
              sf === SurfaceType.ParadeGround ||
              sf === SurfaceType.Boardwalk
            ) {
              return true;
            }
          }
        }
      }
      return false;
    };

    // If current cursor tile is already valid AND flush against a path, lock it!
    if (this.canPlace(id, tx, ty, rot, pilings).ok && touchesPathOrRoad(tx, ty)) {
      return { tx, ty, snapped: true };
    }

    // Search within +-2 tiles for the nearest valid spot flush against a path/road
    let best: { tx: number; ty: number; dist: number } | null = null;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx === 0 && dy === 0) continue;
        const cx = tx + dx;
        const cy = ty + dy;
        const dist = Math.hypot(dx, dy);
        if (best && dist >= best.dist) continue;
        if (this.canPlace(id, cx, cy, rot, pilings).ok && touchesPathOrRoad(cx, cy)) {
          best = { tx: cx, ty: cy, dist };
        }
      }
    }

    if (best) return { tx: best.tx, ty: best.ty, snapped: true };
    return { tx, ty, snapped: false };
  }

  canPlace(id: BuildingId, tx: number, ty: number, rot: 0 | 1 | 2 | 3 = 0, pilings = false): PlaceResult {
    const def = CATALOG[id];
    const w = rot % 2 === 1 ? def.h : def.w;
    const h = rot % 2 === 1 ? def.w : def.h;
    const { tiles } = this.state;
    const usePilings = Boolean((pilings && def.canPilings) || def.autoPilings);
    const cost = this.computeCost(id, tx, ty, usePilings);

    // Bounds check
    if (!inBounds(tx, ty) || !inBounds(tx + w - 1, ty + h - 1)) {
      return { ok: false, reason: 'Out of campus bounds', cost };
    }

    // Slice 4: College Town Level Unlock check
    if (def.unlockLevel && !this.state.collegeTownUnlocked && this.state.economy.campusLevel < def.unlockLevel) {
      return {
        ok: false,
        reason: `Unlocks at Campus Level ${def.unlockLevel} (currently Lv.${this.state.economy.campusLevel})`,
        cost,
      };
    }

    // Slice 4: Land Office Charter Parcel check (for footprint tiles)
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const pIdx = parcelIndexAt(tx + dx, ty + dy);
        if (!this.state.ownedParcels[pIdx]) {
          return {
            ok: false,
            reason: `State Land (${PARCEL_INFO[pIdx].name}) — purchase in Land Office`,
            cost,
          };
        }
      }
    }

    if (id === 'founders_hall' && this.state.buildings.some((b) => b && b.type === 'founders_hall')) {
      return { ok: false, reason: "Founders' Hall is already built", cost };
    }

    // Drag / Tile-layer tools
    if (id === 'path' || id === 'road' || id === 'quad' || id === 'parade_ground') {
      const i = idx(tx, ty);
      if (tiles.owner[i] >= 0) return { ok: false, reason: 'Occupied by building', cost };
      if (tiles.flags[i] & (TileFlag.OpenWater | TileFlag.Bayou)) {
        return { ok: false, reason: 'Use a Boardwalk or Road Bridge over water', cost };
      }
      if (tiles.flags[i] & TileFlag.Preserve) {
        return { ok: false, reason: 'Protected Wetland Preserve', cost };
      }
      const targetSurf =
        id === 'path'
          ? SurfaceType.Path
          : id === 'road'
            ? SurfaceType.Road
            : id === 'quad'
              ? SurfaceType.Quad
              : SurfaceType.ParadeGround;
      if (tiles.surface[i] === targetSurf) {
        return { ok: false, reason: 'Already placed here', cost: 0 };
      }
      return { ok: true, cost };
    }

    if (id === 'boardwalk' || id === 'road_bridge') {
      const i = idx(tx, ty);
      if (tiles.owner[i] >= 0) return { ok: false, reason: 'Occupied by building', cost };
      const targetSurf = id === 'boardwalk' ? SurfaceType.Boardwalk : SurfaceType.Bridge;
      if (tiles.surface[i] === targetSurf) return { ok: false, reason: 'Already placed', cost: 0 };
      return { ok: true, cost };
    }

    if (id === 'levee' || id === 'floodwall') {
      const i = idx(tx, ty);
      if (tiles.owner[i] >= 0) return { ok: false, reason: 'Occupied by building', cost };
      if (tiles.flags[i] & (TileFlag.OpenWater | TileFlag.Bayou)) {
        return { ok: false, reason: 'Build barriers on land or marsh banks', cost };
      }
      if (id === 'levee' && tiles.crest[i] >= 6) return { ok: false, reason: 'Levee already here', cost: 0 };
      if (id === 'floodwall' && (tiles.flags[i] & TileFlag.Floodwall)) {
        return { ok: false, reason: 'Floodwall already here', cost: 0 };
      }
      return { ok: true, cost };
    }

    if (id === 'gator_fence') {
      const i = idx(tx, ty);
      if (tiles.owner[i] >= 0) return { ok: false, reason: 'Occupied by building', cost };
      if (tiles.flags[i] & (TileFlag.OpenWater | TileFlag.Bayou)) {
        return { ok: false, reason: 'Place Gator Fence on land or marsh edge', cost };
      }
      if (tiles.surface[i] === SurfaceType.GatorFence) return { ok: false, reason: 'Fence already here', cost: 0 };
      return { ok: true, cost };
    }

    if (id === 'canal') {
      const i = idx(tx, ty);
      if (tiles.owner[i] >= 0) return { ok: false, reason: 'Occupied by building', cost };
      if (tiles.flags[i] & (TileFlag.OpenWater | TileFlag.Bayou)) {
        return { ok: false, reason: 'Already open water', cost };
      }
      if (tiles.flags[i] & TileFlag.Canal) return { ok: false, reason: 'Canal already dug', cost: 0 };
      const warning = tiles.crest[i] > 0 ? 'Creates automatic Floodgate in levee!' : undefined;
      return { ok: true, cost, warning };
    }

    if (id === 'preserve') {
      const i = idx(tx, ty);
      if (tiles.owner[i] >= 0) return { ok: false, reason: 'Occupied by building', cost };
      if (tiles.type[i] !== TileType.Marsh && tiles.type[i] !== TileType.Wet) {
        return { ok: false, reason: 'Paint Preserves on Marsh or Wet ground', cost };
      }
      if (tiles.flags[i] & TileFlag.Preserve) return { ok: false, reason: 'Already preserved', cost: 0 };
      return { ok: true, cost };
    }

    if (id === 'live_oak' || id === 'cypress' || id === 'azalea') {
      const i = idx(tx, ty);
      if (tiles.owner[i] >= 0) return { ok: false, reason: 'Occupied by building', cost };
      if (tiles.flags[i] & (TileFlag.OpenWater | TileFlag.Bayou)) {
        return { ok: false, reason: 'Cannot plant in deep water', cost };
      }
      return { ok: true, cost };
    }

    // Footprint buildings
    let minElev = 99;
    let hasWater = false;
    let hasMarsh = false;
    let touchesWetOrWater = false;

    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const cx = tx + dx;
        const cy = ty + dy;
        const i = idx(cx, cy);
        if (tiles.owner[i] >= 0) return { ok: false, reason: 'Overlaps existing building', cost };
        if ((tiles.flags[i] & TileFlag.Preserve) && id !== 'rookery') {
          return { ok: false, reason: 'Protected Wetland Preserve', cost };
        }
        if (tiles.crest[i] > 0) return { ok: false, reason: 'Clear levee first', cost };
        if (tiles.flags[i] & (TileFlag.OpenWater | TileFlag.Bayou)) hasWater = true;
        if (tiles.type[i] === TileType.Marsh) hasMarsh = true;
        if (tiles.elev[i] < minElev) minElev = tiles.elev[i];
      }
    }

    // Coastal Studies Institute, Bayou Surge Barrier, and Spoonbill Rookery have special marsh/water placement rules!
    if (id === 'coastal_institute') {
      for (let dy = -1; dy <= h; dy++) {
        for (let dx = -1; dx <= w; dx++) {
          const cx = tx + dx;
          const cy = ty + dy;
          if (!inBounds(cx, cy)) continue;
          const i = idx(cx, cy);
          if (
            tiles.type[i] === TileType.Marsh ||
            (tiles.flags[i] & (TileFlag.Bayou | TileFlag.OpenWater)) !== 0
          ) {
            touchesWetOrWater = true;
          }
        }
      }
      if (!touchesWetOrWater) {
        return { ok: false, reason: 'Must sit near Marsh or Bayou', cost };
      }
    } else if (id === 'surge_barrier') {
      // Fortress Capstone: placed directly across Bayou or Marsh water edges!
      if (!hasWater && !hasMarsh) {
        return { ok: false, reason: 'Span the Bayou Surge Barrier across Bayou or Marsh water', cost };
      }
    } else if (id === 'rookery') {
      // Living With Water Capstone: placed on Marsh, Wet bank, or Wetland Preserve!
      if (hasWater) return { ok: false, reason: 'Place Rookery on Marsh or Wetland Preserve', cost };
      if (!hasMarsh && minElev >= 3.4) return { ok: false, reason: 'Rookery must sit on Marsh, Wet bank, or Preserve', cost };
    } else {
      if (hasWater) return { ok: false, reason: 'Cannot build in deep water', cost };
      if (hasMarsh && !usePilings && id !== 'pond') {
        return { ok: false, reason: 'Marsh requires Pilings (press P)', cost };
      }
    }

    let warning: string | undefined;
    if (!usePilings && minElev < 3.4 && id !== 'pond') {
      warning = `Low ground (${minElev.toFixed(1)} ft) — floods in storms! Press P for Pilings.`;
    } else if (usePilings) {
      warning = 'On Pilings — elevated 3 ft above floodwater (+40%)';
    }

    return { ok: true, cost, warning };
  }

  place(
    id: BuildingId,
    tx: number,
    ty: number,
    rot: 0 | 1 | 2 | 3 = 0,
    pilings = false,
    free = false,
  ): PlaceResult {
    const check = this.canPlace(id, tx, ty, rot, pilings);
    if (!check.ok) return check;
    if (!free && this.state.economy.cash < check.cost) {
      return { ok: false, reason: `Need $${(check.cost / 1000).toFixed(0)}k`, cost: check.cost };
    }

    const def = CATALOG[id];
    const { tiles } = this.state;
    const i = idx(tx, ty);

    if (!free) {
      this.state.economy.cash -= check.cost;
      this.state.economy.xp += Math.max(5, Math.round(check.cost / 15_000));
      this.updateCampusLevel();
    }

    // Tile-layer tools
    if (
      id === 'path' ||
      id === 'road' ||
      id === 'boardwalk' ||
      id === 'road_bridge' ||
      id === 'quad' ||
      id === 'parade_ground'
    ) {
      tiles.surface[i] =
        id === 'path'
          ? SurfaceType.Path
          : id === 'road'
            ? SurfaceType.Road
            : id === 'boardwalk'
              ? SurfaceType.Boardwalk
              : id === 'road_bridge'
                ? SurfaceType.Bridge
                : id === 'quad'
                  ? SurfaceType.Quad
                  : SurfaceType.ParadeGround;
      if (id !== 'quad' && id !== 'parade_ground') this.clearVegAt(tx, ty, 1, 1);
      this.state.terrainDirty = true;
      if (!free) this.emit({ type: 'place', x: tx, y: ty });
      this.evaluateGoals();
      return { ok: true, cost: check.cost };
    }

    if (id === 'levee' || id === 'floodwall') {
      tiles.crest[i] = id === 'floodwall' ? 12.0 : 6.0;
      tiles.integrity[i] = 100;
      if (id === 'floodwall') tiles.flags[i] |= TileFlag.Floodwall;
      else tiles.flags[i] &= ~TileFlag.Floodwall;
      if (tiles.flags[i] & TileFlag.Canal) {
        tiles.flags[i] |= TileFlag.Floodgate;
      }
      this.clearVegAt(tx, ty, 1, 1);
      if (!free) {
        analyzeProtectionAndRisk(this.state, 5.0);
        this.emit({ type: 'place', x: tx, y: ty });
        this.evaluateGoals();
      }
      this.state.terrainDirty = true;
      this.state.buildingsDirty = true;
      return { ok: true, cost: check.cost };
    }

    if (id === 'gator_fence') {
      tiles.surface[i] = SurfaceType.GatorFence;
      this.state.terrainDirty = true;
      if (!free) this.emit({ type: 'place', x: tx, y: ty });
      return { ok: true, cost: check.cost };
    }

    if (id === 'canal') {
      tiles.flags[i] |= TileFlag.Canal;
      if (tiles.crest[i] > 0) {
        tiles.flags[i] |= TileFlag.Floodgate;
      }
      this.clearVegAt(tx, ty, 1, 1);
      if (!free) {
        classifyTiles(tiles);
        analyzeProtectionAndRisk(this.state, 5.0);
        this.emit({ type: 'place', x: tx, y: ty });
        this.evaluateGoals();
      }
      this.state.terrainDirty = true;
      this.state.waterDirty = true;
      return { ok: true, cost: check.cost };
    }

    if (id === 'preserve') {
      tiles.flags[i] |= TileFlag.Preserve;
      this.state.terrainDirty = true;
      if (!free) {
        this.emit({ type: 'place', x: tx, y: ty });
        this.recomputeStats();
      }
      return { ok: true, cost: check.cost };
    }

    if (id === 'live_oak' || id === 'cypress' || id === 'azalea') {
      this.state.veg.push({
        id: this.nextVegId++,
        kind: id === 'live_oak' ? 'oak' : id === 'cypress' ? 'cypress' : 'azalea',
        tx,
        ty,
        scale: this.rng.range(0.95, 1.25),
        rot: this.rng.range(0, Math.PI * 2),
        planted: true,
      });
      this.state.vegDirty = true;
      if (!free) {
        this.emit({ type: 'place', x: tx, y: ty });
        this.recomputeStats();
      }
      return { ok: true, cost: check.cost };
    }

    // Footprint building placement
    const w = rot % 2 === 1 ? def.h : def.w;
    const h = rot % 2 === 1 ? def.w : def.h;
    const usePilings = Boolean((pilings && def.canPilings) || def.autoPilings);
    const bId = this.nextBuildingId++;

    const autoName =
      id === 'founders_hall'
        ? "Founders' Hall"
        : id === 'bell_tower'
          ? 'Memorial Bell Tower'
          : id === 'stadium'
            ? 'Red Stick Stadium'
            : id === 'tiger_habitat'
              ? "Roux's Tiger Habitat"
              : `${this.rng.pick(BUILDING_NAME_PREFIXES)} ${def.shortName}`;

    const inst: BuildingInstance = {
      id: bId,
      type: id,
      tx,
      ty,
      w,
      h,
      rot,
      name: autoName,
      tier: 0,
      built: free || def.buildDays === 0 ? 1 : 0.12,
      hp: 1,
      pilings: usePilings,
      powered: !def.needsPower,
      watered: !def.needsWater,
      blackout: false,
      flooded: false,
      boarded: false,
      fuelDays: id === 'generator' ? 3 : 0,
      seed: this.rng.int(1, 999999),
      builtDay: this.state.day,
    };

    this.state.buildings[bId] = inst;

    // 1. Bulldoze & level the ground uniformly beneath every newly constructed building!
    this.prepareBuildingSite(tx, ty, w, h, id, bId);

    // 2. Immediately snap & tie a brick walkway spur from the new building to the nearest existing path/road!
    const pathTied = !free ? this.autoConnectPathToNearest(tx, ty, w, h, id) : false;

    if (!free) {
      classifyTiles(tiles);
      this.recomputeCoverage();
      updateMosquitoField(this.state);
      this.syncServiceVehicles();
      this.recomputeStats();
      this.syncAgents();
      this.evaluateGoals();
    }

    this.state.buildingsDirty = true;
    this.state.terrainDirty = true;
    this.state.vegDirty = true;

    if (!free) {
      this.emit({ type: 'place', x: tx + w * 0.5, y: ty + h * 0.5 });
      this.pushTicker(
        `Constructed ${inst.name}${usePilings ? ' on pilings' : ''}${pathTied ? ' — path connected!' : '.'}`,
        'info',
      );
    }

    return { ok: true, cost: check.cost, buildingId: bId };
  }

  /**
   * Prepares land beneath a newly placed building:
   * - Bulldozes all trees/shrubs, old non-highway paths/roads/fences/quads, and canals inside the footprint
   * - Levels every footprint tile uniformly to the pad mean elevation
   * - Gently feathers steep 1-tile neighbor slopes so the graded pad blends cleanly into surrounding ground
   */
  private prepareBuildingSite(
    tx: number,
    ty: number,
    w: number,
    h: number,
    id: BuildingId,
    bId: number,
  ): void {
    const { tiles } = this.state;
    const keepNaturalTerrain = id === 'pond' || id === 'surge_barrier' || id === 'rookery';

    // Compute mean elevation across footprint for clean leveling (preserves floodplain realism)
    let sumElev = 0;
    let count = 0;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const ti = idx(tx + dx, ty + dy);
        sumElev += tiles.elev[ti];
        count++;
      }
    }
    const padElev = count > 0 ? Math.round((sumElev / count) * 100) / 100 : 3.0;

    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const ti = idx(tx + dx, ty + dy);
        tiles.owner[ti] = bId;

        if (id === 'pond') {
          tiles.flags[ti] |= TileFlag.PondSink;
          tiles.elev[ti] = Math.min(tiles.elev[ti], 0.2);
          tiles.depth[ti] = 1.4;
          if (!(tiles.flags[ti] & TileFlag.Highway)) tiles.surface[ti] = SurfaceType.None;
          continue;
        }

        // Bulldoze existing non-highway paths/surfaces/fences/canals under the building pad
        if (!(tiles.flags[ti] & TileFlag.Highway)) {
          tiles.surface[ti] = SurfaceType.None;
        }
        if (!keepNaturalTerrain) {
          tiles.flags[ti] &= ~TileFlag.Canal;
          tiles.elev[ti] = padElev;
          if (tiles.depth[ti] < 0.8) tiles.depth[ti] = 0;
          tiles.mosq[ti] = 0;
        }
      }
    }

    // Gently grade steep 1-tile perimeter skirt tiles so the leveled pad sits cleanly without jagged cliff edges
    if (!keepNaturalTerrain) {
      for (let dy = -1; dy <= h; dy++) {
        for (let dx = -1; dx <= w; dx++) {
          if (dx >= 0 && dx < w && dy >= 0 && dy < h) continue;
          const nx = tx + dx;
          const ny = ty + dy;
          if (!inBounds(nx, ny)) continue;
          const ni = idx(nx, ny);
          if (tiles.owner[ni] >= 0 || tiles.crest[ni] > 0) continue;
          if (tiles.flags[ni] & (TileFlag.OpenWater | TileFlag.Bayou | TileFlag.Canal | TileFlag.Preserve)) continue;
          const diff = padElev - tiles.elev[ni];
          if (Math.abs(diff) > 1.0) {
            tiles.elev[ni] = Math.round((tiles.elev[ni] + diff * 0.45) * 100) / 100;
          }
        }
      }
    }

    // Clear all trees/shrubs inside the footprint (and any wild non-planted tree encroaching on tile boundary)
    this.clearVegAt(tx, ty, w, h);
  }

  /**
   * Immediately ties a newly placed building into the nearest existing campus path/road/quad
   * within 14 tiles using bounded shortest-path BFS (automatically clearing trees along the spur).
   */
  private autoConnectPathToNearest(
    tx: number,
    ty: number,
    w: number,
    h: number,
    id: BuildingId,
  ): boolean {
    if (id === 'pond' || id === 'surge_barrier' || id === 'rookery' || id === 'bat_house') {
      return false;
    }

    const { tiles } = this.state;
    const isNetworkSurface = (sf: number): boolean =>
      sf === SurfaceType.Path ||
      sf === SurfaceType.Road ||
      sf === SurfaceType.Boardwalk ||
      sf === SurfaceType.Bridge ||
      sf === SurfaceType.Quad ||
      sf === SurfaceType.ParadeGround;

    // Collect perimeter seed tiles ordered with front/south-east entrances first!
    const seeds: number[] = [];
    // South edge (ty + h)
    for (let dx = 0; dx < w; dx++) {
      if (inBounds(tx + dx, ty + h)) seeds.push(idx(tx + dx, ty + h));
    }
    // East edge (tx + w)
    for (let dy = 0; dy < h; dy++) {
      if (inBounds(tx + w, ty + dy)) seeds.push(idx(tx + w, ty + dy));
    }
    // West edge (tx - 1)
    for (let dy = 0; dy < h; dy++) {
      if (inBounds(tx - 1, ty + dy)) seeds.push(idx(tx - 1, ty + dy));
    }
    // North edge (ty - 1)
    for (let dx = 0; dx < w; dx++) {
      if (inBounds(tx + dx, ty - 1)) seeds.push(idx(tx + dx, ty - 1));
    }

    // If building already touches an existing walkable path/road/quad, it's already connected!
    for (const si of seeds) {
      if (isNetworkSurface(tiles.surface[si])) return false;
    }

    const MAX_DIST = 14;
    const visited = new Uint8Array(TILE_COUNT);
    const parent = new Int32Array(TILE_COUNT).fill(-1);
    const dist = new Uint8Array(TILE_COUNT);
    const queue: number[] = [];

    const canTraverse = (ti: number): boolean => {
      const cx = ti % MAP_SIZE;
      const cy = Math.floor(ti / MAP_SIZE);
      const pIdx = Math.floor(cy / 16) * 4 + Math.floor(cx / 16);
      if (this.state.ownedParcels && !this.state.ownedParcels[pIdx]) return false;
      if (tiles.owner[ti] >= 0) return false;
      if (tiles.crest[ti] > 0) return false;
      if (tiles.flags[ti] & (TileFlag.OpenWater | TileFlag.Preserve)) return false;
      if (tiles.surface[ti] === SurfaceType.GatorFence) return false;
      return true;
    };

    // Mark building footprint as visited so BFS never routes back through the building
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        visited[idx(tx + dx, ty + dy)] = 1;
      }
    }

    for (const si of seeds) {
      if (visited[si] || !canTraverse(si)) continue;
      visited[si] = 1;
      dist[si] = 1;
      parent[si] = -2; // marks start perimeter tile
      queue.push(si);
    }

    let targetTile = -1;
    let qHead = 0;
    const dirs = [
      [0, 1],
      [1, 0],
      [-1, 0],
      [0, -1],
    ];

    while (qHead < queue.length) {
      const cur = queue[qHead++];
      const d = dist[cur];
      const cx = cur % MAP_SIZE;
      const cy = Math.floor(cur / MAP_SIZE);

      if (d >= MAX_DIST) continue;

      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!inBounds(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (visited[ni]) continue;

        // Found an existing path/road/quad/bridge to tie directly into!
        if (isNetworkSurface(tiles.surface[ni]) && tiles.owner[ni] < 0) {
          parent[ni] = cur;
          targetTile = ni;
          break;
        }

        if (!canTraverse(ni)) continue;
        visited[ni] = 1;
        dist[ni] = d + 1;
        parent[ni] = cur;
        queue.push(ni);
      }
      if (targetTile >= 0) break;
    }

    if (targetTile < 0) return false;

    // Backtrack from junction tile (don't overwrite the existing junction tile itself) back to building edge
    let step = parent[targetTile];
    let laid = 0;
    while (step >= 0) {
      const sx = step % MAP_SIZE;
      const sy = Math.floor(step / MAP_SIZE);
      const isWetCross =
        (tiles.flags[step] & (TileFlag.Bayou | TileFlag.Canal)) !== 0 ||
        tiles.type[step] === TileType.Marsh;
      tiles.surface[step] = isWetCross ? SurfaceType.Boardwalk : SurfaceType.Path;
      this.clearVegAt(sx, sy, 1, 1);
      laid++;
      step = parent[step];
    }

    return laid > 0;
  }

  private clearVegAt(tx: number, ty: number, w: number, h: number): void {
    const before = this.state.veg.length;
    this.state.veg = this.state.veg.filter(
      (v) => v.tx < tx || v.tx >= tx + w || v.ty < ty || v.ty >= ty + h,
    );
    if (this.state.veg.length !== before) this.state.vegDirty = true;
  }

  demolish(tx: number, ty: number): boolean {
    if (!inBounds(tx, ty)) return false;
    const { tiles } = this.state;
    const i = idx(tx, ty);

    // Remove building if present
    const owner = tiles.owner[i];
    if (owner >= 0) {
      const b = this.state.buildings[owner];
      if (!b || b.type === 'founders_hall') return false;
      for (let dy = 0; dy < b.h; dy++) {
        for (let dx = 0; dx < b.w; dx++) {
          const ti = idx(b.tx + dx, b.ty + dy);
          tiles.owner[ti] = -1;
          tiles.flags[ti] &= ~TileFlag.PondSink;
        }
      }
      const refund = Math.round(CATALOG[b.type].cost * 0.35);
      this.state.economy.cash += refund;
      this.state.buildings[owner] = null;
      this.recomputeCoverage();
      this.recomputeStats();
      this.state.buildingsDirty = true;
      this.state.terrainDirty = true;
      this.emit({ type: 'demolish', x: tx, y: ty });
      this.pushTicker(`Demolished ${b.name} (+$${(refund / 1000).toFixed(0)}k salvage).`, 'info');
      return true;
    }

    // Remove levee, canal, surface, preserve, or vegetation/trees!
    let changed = false;
    if (tiles.crest[i] > 0) {
      tiles.crest[i] = 0;
      tiles.integrity[i] = 0;
      tiles.flags[i] &= ~(TileFlag.Floodgate | TileFlag.Floodwall);
      changed = true;
    } else if (tiles.flags[i] & TileFlag.Canal) {
      tiles.flags[i] &= ~(TileFlag.Canal | TileFlag.Floodgate);
      changed = true;
    } else if (tiles.surface[i] !== SurfaceType.None && !(tiles.flags[i] & TileFlag.Highway)) {
      tiles.surface[i] = SurfaceType.None;
      changed = true;
    } else if (tiles.flags[i] & TileFlag.Preserve) {
      tiles.flags[i] &= ~TileFlag.Preserve;
      changed = true;
    } else {
      const beforeVeg = this.state.veg.length;
      this.clearVegAt(tx, ty, 1, 1);
      if (this.state.veg.length !== beforeVeg) changed = true;
    }

    if (changed) {
      classifyTiles(tiles);
      analyzeProtectionAndRisk(this.state, 5.0);
      this.state.terrainDirty = true;
      this.state.buildingsDirty = true;
      this.emit({ type: 'demolish', x: tx, y: ty });
      return true;
    }
    return false;
  }

  upgradeBuilding(buildingId: number): { ok: boolean; reason?: string } {
    const b = this.state.buildings[buildingId];
    if (!b) return { ok: false, reason: 'Building not found' };
    const def = CATALOG[b.type];
    if (!def.maxTier || b.tier >= def.maxTier) return { ok: false, reason: 'Already at max tier' };
    const nextTier = b.tier + 1;
    const cost = def.tierCosts?.[nextTier] ?? 1_000_000;
    if (this.state.economy.cash < cost) return { ok: false, reason: `Need $${(cost / 1e6).toFixed(1)}M` };

    this.state.economy.cash -= cost;
    b.tier = nextTier;
    b.built = 1;
    if (def.tierNames?.[nextTier]) {
      b.name = def.tierNames[nextTier].split(' (')[0];
    }
    this.state.economy.xp += Math.round(cost / 10_000);
    this.updateCampusLevel();
    this.state.buildingsDirty = true;
    this.recomputeStats();
    this.evaluateGoals();
    this.emit({ type: 'upgrade', x: b.tx + b.w * 0.5, y: b.ty + b.h * 0.5 });
    this.pushTicker(`Upgraded to ${b.name}!`, 'sports');
    return { ok: true };
  }

  retrofitPilings(buildingId: number): { ok: boolean; reason?: string } {
    const b = this.state.buildings[buildingId];
    if (!b) return { ok: false, reason: 'Not found' };
    const def = CATALOG[b.type];
    if (!def.canPilings || b.pilings) return { ok: false, reason: 'Already elevated' };
    const cost = Math.round(def.cost * 0.4);
    if (this.state.economy.cash < cost) return { ok: false, reason: `Need $${(cost / 1000).toFixed(0)}k` };
    this.state.economy.cash -= cost;
    b.pilings = true;
    b.flooded = false;
    this.state.buildingsDirty = true;
    this.recomputeCoverage();
    this.emit({ type: 'upgrade', x: b.tx + b.w * 0.5, y: b.ty + b.h * 0.5 });
    this.pushTicker(`Retrofitted ${b.name} onto 3-ft flood pilings.`, 'water');
    return { ok: true };
  }

  repairBuilding(buildingId: number): boolean {
    const b = this.state.buildings[buildingId];
    if (!b || b.hp >= 0.99) return false;
    const cost = Math.round(CATALOG[b.type].cost * (1 - b.hp) * 0.45);
    if (this.state.economy.cash < cost) return false;
    this.state.economy.cash -= cost;
    b.hp = 1;
    this.state.buildingsDirty = true;
    this.emit({ type: 'place', x: b.tx, y: b.ty });
    return true;
  }

  refuelGenerator(buildingId: number): boolean {
    const b = this.state.buildings[buildingId];
    if (!b || b.type !== 'generator') return false;
    if (this.state.economy.cash < 5_000) return false;
    this.state.economy.cash -= 5_000;
    b.fuelDays = Math.min(6, b.fuelDays + 3);
    this.recomputeCoverage();
    return true;
  }

  recomputeCoverage(): void {
    const buildings = this.state.buildings;
    const powerSources: { b: BuildingInstance; radius: number; backup: boolean }[] = [];
    const waterSources: { b: BuildingInstance; radius: number }[] = [];

    for (const b of buildings) {
      if (!b || b.built < 1) continue;
      const def = CATALOG[b.type];
      if (b.type === 'substation') {
        if (!b.flooded && b.hp > 0.25) {
          powerSources.push({ b, radius: def.powerRadius ?? 14, backup: false });
        }
      } else if (b.type === 'generator') {
        if (!b.flooded && b.fuelDays > 0) {
          powerSources.push({ b, radius: def.powerRadius ?? 7, backup: true });
        }
      }
    }

    // Assign power
    let anyBlackout = false;
    for (const b of buildings) {
      if (!b) continue;
      const def = CATALOG[b.type];
      if (!def.needsPower) {
        b.powered = true;
        b.blackout = false;
        continue;
      }
      const cx = b.tx + b.w * 0.5;
      const cy = b.ty + b.h * 0.5;
      let hasPower = false;
      for (const src of powerSources) {
        const sx = src.b.tx + src.b.w * 0.5;
        const sy = src.b.ty + src.b.h * 0.5;
        if (Math.max(Math.abs(cx - sx), Math.abs(cy - sy)) <= src.radius) {
          hasPower = true;
          break;
        }
      }
      const wasPowered = b.powered;
      b.powered = hasPower;
      b.blackout = !hasPower && this.state.buildings.some((x) => x && x.type === 'substation');
      if (wasPowered && b.blackout) anyBlackout = true;
    }

    if (anyBlackout) {
      this.emit({ type: 'blackout' });
      this.pushTicker('POWER BLACKOUT! A substation flooded — elevate it on pilings or place a Backup Generator.', 'danger');
    }

    // Water towers require power to pump
    for (const b of buildings) {
      if (!b || b.built < 1) continue;
      if (b.type === 'water_tower' && b.powered && !b.flooded && b.hp > 0.25) {
        waterSources.push({ b, radius: CATALOG.water_tower.waterRadius ?? 15 });
      }
    }

    for (const b of buildings) {
      if (!b) continue;
      const def = CATALOG[b.type];
      if (!def.needsWater) {
        b.watered = true;
        continue;
      }
      const cx = b.tx + b.w * 0.5;
      const cy = b.ty + b.h * 0.5;
      let hasWater = false;
      for (const src of waterSources) {
        const sx = src.b.tx + src.b.w * 0.5;
        const sy = src.b.ty + src.b.h * 0.5;
        if (Math.max(Math.abs(cx - sx), Math.abs(cy - sy)) <= src.radius) {
          hasWater = true;
          break;
        }
      }
      b.watered = hasWater;
    }
  }

  recomputeStats(): void {
    const s = this.state;
    let beds = 0;
    let seats = 0;
    let dining = 0;
    let landmarkPts = 0;
    let happyBonus = 0;
    let upkeep = 0;
    let research = 0;
    let miscIncome = 0;
    let teamRating = 42;
    let ecoBonus = 0;
    const foundedTypes = new Set<string>();
    const activeProgSet = new Set<string>();

    for (const b of s.buildings) {
      if (!b || b.built < 1) continue;
      const def = CATALOG[b.type];
      const eff = (b.powered ? 1 : 0.45) * (b.watered ? 1 : 0.55) * (b.flooded ? 0.25 : 1) * Math.max(0.3, b.hp);

      // Tier multipliers for multi-tier buildings (Slice 2)
      const tierDiningBoost = b.type === 'dining_hall' ? b.tier * 900 : 0;
      const tierSeatBoost = b.type === 'library' ? b.tier * 250 : 0;
      const tierResearchMult = b.type === 'library' && b.tier >= 1 ? 2.0 : 1.0;
      const tierIncomeMult =
        b.type === 'parking'
          ? b.tier === 2
            ? 4.5
            : b.tier === 1
              ? 2.6
              : 1
          : b.type === 'union' && b.tier >= 1
            ? 2.0
            : 1.0;
      const tierIncomeBonus = b.type === 'dining_hall' && b.tier >= 2 ? 12_000 : 0;
      const tierHappyBoost =
        b.type === 'dining_hall' || b.type === 'union' || b.type === 'rec_center' ? b.tier * 3 : 0;

      beds += Math.round((def.beds ?? 0) * eff);
      seats += Math.round(((def.seats ?? 0) + tierSeatBoost) * eff);
      dining += Math.round(((def.dining ?? 0) + tierDiningBoost) * eff);
      landmarkPts += (def.landmark ?? 0) + b.tier * 5;
      happyBonus += ((def.happiness ?? 0) + tierHappyBoost) * 0.85 * eff;
      upkeep += def.tierUpkeep?.[b.tier] ?? def.upkeep;
      research += Math.round((def.researchPerMonth ?? 0) * tierResearchMult * eff * (0.7 + s.economy.prestige / 100));
      miscIncome += Math.round(((def.incomePerMonth ?? 0) * tierIncomeMult + tierIncomeBonus) * eff);
      ecoBonus += def.ecologyDelta ?? 0;

      if (def.programs && def.programs.length > 0) {
        foundedTypes.add(b.type);
        for (const p of def.programs) activeProgSet.add(p);
      }

      if (b.type === 'practice_field') teamRating += 6 + b.tier * 5;
      if (b.type === 'stadium') teamRating += 12 + b.tier * 9;
      if (b.type === 'tiger_habitat') teamRating += 5 + b.tier * 3;
      if (b.type === 'rec_center' && b.tier >= 1) teamRating += 4;
      if (b.type === 'music_college') teamRating += 3;
    }

    // Count preserves, quads, levees, planted trees
    let preserveTiles = 0;
    let quadTiles = 0;
    let leveeTiles = 0;
    for (let i = 0; i < TILE_COUNT; i++) {
      if (s.tiles.flags[i] & TileFlag.Preserve) preserveTiles++;
      if (s.tiles.surface[i] === SurfaceType.Quad || s.tiles.surface[i] === SurfaceType.ParadeGround) quadTiles++;
      if (s.tiles.crest[i] > 0) leveeTiles++;
    }
    let plantedTrees = 0;
    for (const v of s.veg) if (v.planted) plantedTrees++;

    const eco = Math.max(
      15,
      Math.min(100, Math.round(72 + preserveTiles * 0.55 + plantedTrees * 0.8 + ecoBonus - leveeTiles * 0.15)),
    );

    const students = s.economy.students;
    const tuitionPerMonth = Math.round(students * 420);
    const stateFunding = Math.round(45_000 + students * 85 + s.economy.prestige * 1_600);
    const alumniDonations = Math.round(s.economy.alumni * 42 * (0.6 + s.economy.prestige / 80));
    const staffCost = Math.round(students * 145);

    s.economy.capacity = { beds, seats, dining };
    s.economy.collegesFounded = foundedTypes.size;
    s.economy.activePrograms = activeProgSet.size;
    s.economy.breakdown = {
      tuition: tuitionPerMonth,
      state: stateFunding,
      alumni: alumniDonations,
      research,
      venues: miscIncome,
      upkeep,
      staff: staffCost,
    };
    s.economy.ecology = eco;
    s.economy.monthlyIncome = tuitionPerMonth + stateFunding + alumniDonations + research + miscIncome;
    s.economy.monthlyExpense = upkeep + staffCost;
    s.economy.teamRating = Math.min(98, teamRating + Math.round(s.economy.prestige * 0.12));

    const targetPrestige = Math.min(
      100,
      Math.round(
        12 +
          landmarkPts * 0.95 +
          foundedTypes.size * 2.2 +
          Math.min(28, students / 140) +
          s.economy.wins * 1.8 +
          eco * 0.12,
      ),
    );
    s.economy.prestige = Math.round(s.economy.prestige + (targetPrestige - s.economy.prestige) * 0.25);

    const floodedBuildings = s.buildings.filter((b) => b && b.flooded).length;
    const blackoutCount = s.buildings.filter((b) => b && b.blackout).length;
    const hasHealth = s.buildings.some((b) => b && b.type === 'health_center' && b.built >= 1 && b.powered);
    const mosqPenalty = Math.round(Math.max(0, s.mosquitoIndex - 22) * (hasHealth ? 0.08 : 0.2));
    s.spoonbillCount = s.buildings.filter((b) => b && b.type === 'rookery' && b.built >= 1).length * 6;
    const targetHappy = Math.max(
      15,
      Math.min(
        100,
        Math.round(
          54 +
            Math.min(36, happyBonus + quadTiles * 0.45) +
            (eco - 60) * 0.15 -
            floodedBuildings * 7 -
            blackoutCount * 5 -
            mosqPenalty,
        ),
      ),
    );
    s.economy.happiness = Math.round(s.economy.happiness + (targetHappy - s.economy.happiness) * 0.35);
  }

  private updateCampusLevel(): void {
    const prev = this.state.economy.campusLevel;
    const lvl = Math.max(1, 1 + Math.floor(Math.sqrt(this.state.economy.xp / 55)));
    this.state.economy.campusLevel = lvl;
    if (lvl > prev) {
      const unlockedTown = lvl >= 10 && !this.state.collegeTownUnlocked;
      if (unlockedTown) this.state.collegeTownUnlocked = true;
      this.state.levelUpToast = { level: lvl, unlockedTown, ticksLeft: 75 };
      this.emit({ type: 'goal_complete', text: `Campus Level ${lvl}` });
      this.pushTicker(
        unlockedTown
          ? `CAMPUS LEVEL ${lvl}! COLLEGE TOWN DISTRICT UNLOCKED — build Town Center, Beignet Café & Zydeco Hall!`
          : `CAMPUS LEVEL UP! Reached Campus Level ${lvl}.`,
        'sports',
      );
    }
  }

  buyParcel(parcelIdx: number): { ok: boolean; reason?: string } {
    if (parcelIdx < 0 || parcelIdx >= 16) return { ok: false, reason: 'Invalid parcel' };
    if (this.state.ownedParcels[parcelIdx]) return { ok: false, reason: 'Already owned' };
    const info = PARCEL_INFO[parcelIdx];
    if (this.state.economy.cash < info.price) {
      return { ok: false, reason: `Need $${(info.price / 1000).toFixed(0)}k` };
    }
    this.state.economy.cash -= info.price;
    this.state.ownedParcels[parcelIdx] = true;
    this.state.economy.xp += 180;
    this.updateCampusLevel();
    this.state.terrainDirty = true;
    this.emit({ type: 'upgrade' });
    this.pushTicker(`Land Office: Acquired ${info.name} charter parcel!`, 'money');
    return { ok: true };
  }

  unlockCollegeTown(): void {
    this.state.collegeTownUnlocked = true;
    if (this.state.economy.campusLevel < 10) {
      this.state.economy.xp = Math.max(this.state.economy.xp, 4950);
      this.state.economy.campusLevel = 10;
    }
    this.state.levelUpToast = { level: this.state.economy.campusLevel, unlockedTown: true, ticksLeft: 75 };
    this.emit({ type: 'goal_complete' });
    this.pushTicker('College Town District unlocked! Build Town Center, Beignet Café & Alumni Hotel.', 'sports');
  }

  /**
   * Main fixed-step simulation tick (called at 10 Hz * speed).
   */
  stepTick(): void {
    const s = this.state;
    s.tick++;

    // Sky clock: 300 ticks = full 30-second cycle at 1x (dawn -> day -> golden -> dusk -> night)
    if (s.football.active && s.football.nightGame) {
      // Lock night sky dramatically during Saturday Night in The Cauldron!
      s.skyTick = 240;
      s.skyPhase = 'night';
      s.skyProgress = 0.8;
    } else if (s.storm.active) {
      // Stormy brooding twilight sky
      s.skyTick = (s.skyTick + 0.35) % 300;
      this.updateSkyPhase();
    } else {
      s.skyTick = (s.skyTick + 1) % 300;
      this.updateSkyPhase();
    }

    // Bell Tower chimes at noon (skyTick ~ 90) and dusk (skyTick ~ 185)
    if (
      Math.floor(s.skyTick) === 90 ||
      Math.floor(s.skyTick) === 185
    ) {
      if (s.buildings.some((b) => b && b.type === 'bell_tower' && b.built >= 1)) {
        this.emit({ type: 'bell_chime' });
      }
    }

    // Active set pieces
    if (s.storm.active) {
      this.stepStorm();
    }
    if (s.football.active) {
      this.stepFootball();
    }
    if (s.parade.active) {
      this.stepParade();
    }

    // Decision toast & Level-up banner countdown
    if (s.activeToast) {
      s.activeToast.ticksLeft--;
      if (s.activeToast.ticksLeft <= 0) {
        this.resolveToast(false);
      }
    }
    if (s.levelUpToast) {
      s.levelUpToast.ticksLeft--;
      if (s.levelUpToast.ticksLeft <= 0) s.levelUpToast = null;
    }

    // Hydrology CA runs every 3 ticks (plus faster during storms)
    if (s.tick % 3 === 0) {
      const dtDay = s.storm.active ? 0.045 : 0.03;
      stepHydrology(s, dtDay);
      if (s.tick % 12 === 0) {
        this.recomputeCoverage();
      }
    }

    // Calendar advances when not frozen inside a set piece
    if (!s.storm.active && !s.football.active && !s.parade.active) {
      s.dayTick++;
      if (s.dayTick >= 100) {
        s.dayTick = 0;
        this.onNewDay();
      }
    }

    // Living entities
    this.stepAgents();
    this.stepGators();
    this.stepPirogues();
    this.stepServiceVehicles();
  }

  private updateSkyPhase(): void {
    const t = this.state.skyTick;
    this.state.skyProgress = t / 300;
    if (t < 28) this.state.skyPhase = 'dawn';
    else if (t < 150) this.state.skyPhase = 'day';
    else if (t < 178) this.state.skyPhase = 'golden';
    else if (t < 204) this.state.skyPhase = 'dusk';
    else this.state.skyPhase = 'night';
  }

  private onNewDay(): void {
    const s = this.state;
    s.day++;
    s.year = Math.floor(s.day / 120) + 1;
    s.month = (Math.floor(s.day / 10) % 12) + 1;
    s.dom = (s.day % 10) + 1;

    if (s.month >= 3 && s.month <= 5) s.season = 'spring';
    else if (s.month >= 6 && s.month <= 8) s.season = 'summer';
    else if (s.month >= 9 && s.month <= 11) s.season = 'fall';
    else s.season = 'winter';

    // Advance building construction
    let anyFinished = false;
    for (const b of s.buildings) {
      if (!b || b.built >= 1) continue;
      const days = Math.max(1, CATALOG[b.type].buildDays);
      b.built = Math.min(1, b.built + 1 / days);
      if (b.built >= 1) {
        anyFinished = true;
        this.pushTicker(`${b.name} is now open!`, 'info');
      }
    }
    if (anyFinished) {
      this.recomputeCoverage();
      this.state.buildingsDirty = true;
    }

    // Occasional afternoon Louisiana showers
    const rainChance = s.season === 'summer' ? 0.34 : s.season === 'spring' ? 0.22 : 0.12;
    s.rainRate = this.rng.next() < rainChance ? this.rng.range(0.28, 0.65) : 0;
    s.windStrength = s.rainRate > 0 ? 0.42 : 0.14;

    // Spring High Water on the Big Muddy (Year 2+, April-May)
    if (s.year >= 2 && (s.month === 4 || s.month === 5)) {
      s.riverStage = 1.6;
      s.bayouStage = 1.2;
    } else {
      s.riverStage = 0;
      s.bayouStage = 0;
    }

    // 1st of month: Economy settlement
    if (s.dom === 1) {
      this.recomputeStats();
      const net = s.economy.monthlyIncome - s.economy.monthlyExpense;
      s.economy.cash += net;
      s.economy.lastNet = net;
      const sign = net >= 0 ? '+' : '-';
      this.pushTicker(
        `Monthly ledger: ${sign}$${(Math.abs(net) / 1000).toFixed(0)}k (Tuition & grants vs upkeep).`,
        'money',
      );
      analyzeProtectionAndRisk(s, 5.0);
    }

    // 5th of month: Pirogue student arrival!
    if (s.dom === 5) {
      this.recomputeStats();
      const cap = Math.min(
        Math.max(120, s.economy.capacity.beds || 120),
        Math.max(120, s.economy.capacity.seats || 120),
        Math.max(180, s.economy.capacity.dining || 180),
      );
      if (s.buildings.some((b) => b && b.type === 'founders_hall')) {
        const room = Math.max(0, cap - s.economy.students);
        if (room > 0) {
          const arriving = Math.min(room, Math.max(40, Math.round(65 + s.economy.prestige * 3.5)));
          s.economy.students += arriving;
          this.state.pirogues.push({
            id: this.nextBuildingId + this.state.tick,
            splinePos: 2,
            direction: 1,
            passengers: arriving,
            delivered: false,
          });
          this.pushTicker(`Pirogues landed at the bayou with ${arriving} new freshmen!`, 'info');
          this.syncAgents();
        }
      }
    }

    // Graduation on May 5
    if (s.month === 5 && s.dom === 5 && s.economy.students > 150) {
      const grads = Math.round(s.economy.students * 0.18);
      s.economy.alumni += grads;
      s.economy.students = Math.max(100, s.economy.students - Math.round(grads * 0.5));
      this.pushTicker(`Commencement! ${grads} Bayou State Tigers graduated into lifelong alumni.`, 'sports');
    }

    // Daily Slice 3 Ecosystem: Mosquito breeding + Nutria levee burrowing
    updateMosquitoField(s);
    if (s.overlay === OverlayMode.Mosquito) s.terrainDirty = true;
    this.stepNutriaBurrows();

    // Mardi Gras Parade every Feb 6!
    if (s.month === 2 && s.dom === 6 && !s.parade.active && !s.storm.active && !s.football.active && s.economy.students >= 100) {
      this.triggerMardiGras();
    }

    // Board of Regents / Student Voice Dilemma on 1st of odd months (when idle)
    if (s.dom === 1 && s.month % 2 === 1 && s.day > 15 && !s.activeDilemma && !s.storm.active && !s.football.active) {
      if (this.rng.next() < 0.45) this.triggerDilemma();
    }

    // Auto-schedule an exciting Hurricane in September if none active
    if (s.month === 9 && s.dom === 3 && !s.storm.active && !s.football.active && s.economy.students >= 200) {
      const cat = Math.min(4, 1 + s.year);
      this.triggerHurricane(cat);
    }

    this.evaluateGoals();
  }

  // ===== SLICE 3: NUTRIA, WILDLIFE OFFICERS, FOGGER TRUCKS, MARDI GRAS & DILEMMAS =====
  private stepNutriaBurrows(): void {
    const s = this.state;
    const { tiles } = s;
    const leveeTiles: number[] = [];
    for (let i = 0; i < TILE_COUNT; i++) {
      // Concrete Floodwalls are 100% nutria-proof!
      if (tiles.crest[i] > 0 && !(tiles.flags[i] & TileFlag.Floodwall) && tiles.integrity[i] > 20) {
        leveeTiles.push(i);
      }
    }
    if (leveeTiles.length === 0) return;

    const officers = s.buildings.filter((b): b is BuildingInstance => Boolean(b && b.type === 'wildlife_post' && b.built >= 1));
    const targetIdx = this.rng.pick(leveeTiles);
    const tx = targetIdx % MAP_SIZE;
    const ty = (targetIdx / MAP_SIZE) | 0;
    const guarded = officers.some((o) => Math.hypot(o.tx - tx, o.ty - ty) <= 14);
    const chance = guarded ? 0.03 : 0.14;

    if (this.rng.next() < chance) {
      tiles.integrity[targetIdx] = Math.max(20, tiles.integrity[targetIdx] - 15);
      s.nutriaBurrows++;
      this.emit({ type: 'nutria_burrow', x: tx, y: ty });
      this.pushTicker(
        `Nutria burrowed into earthen levee at (${tx},${ty}) — integrity ${tiles.integrity[targetIdx]}%! (Wildlife Post or Floodwalls stop them)`,
        'wildlife',
      );
    }
  }

  repairAllLevees(): { repaired: number; cost: number } {
    const { tiles } = this.state;
    let count = 0;
    for (let i = 0; i < TILE_COUNT; i++) {
      if (tiles.crest[i] > 0 && tiles.integrity[i] < 100) count++;
    }
    const cost = count * 4_500;
    if (count === 0 || this.state.economy.cash < cost) return { repaired: 0, cost };
    this.state.economy.cash -= cost;
    for (let i = 0; i < TILE_COUNT; i++) {
      if (tiles.crest[i] > 0 && tiles.integrity[i] < 100) tiles.integrity[i] = 100;
    }
    analyzeProtectionAndRisk(this.state, 5.0);
    this.pushTicker(`Repaired ${count} weakened levee tiles ($${(cost / 1000).toFixed(0)}k).`, 'water');
    return { repaired: count, cost };
  }

  private findNearestRoadTile(cx: number, cy: number, maxRadius = 10): number {
    const { tiles } = this.state;
    let best = -1;
    let bestD = Infinity;
    for (let r = 0; r <= maxRadius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const tx = Math.floor(cx) + dx;
          const ty = Math.floor(cy) + dy;
          if (!inBounds(tx, ty)) continue;
          const ti = idx(tx, ty);
          const sf = tiles.surface[ti];
          if (sf === SurfaceType.Road || sf === SurfaceType.Bridge) {
            const d = dx * dx + dy * dy;
            if (d < bestD) {
              bestD = d;
              best = ti;
            }
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  private isRoadTile(tx: number, ty: number): boolean {
    if (!inBounds(tx, ty)) return false;
    const sf = this.state.tiles.surface[idx(tx, ty)];
    return sf === SurfaceType.Road || sf === SurfaceType.Bridge;
  }

  private syncServiceVehicles(): void {
    const s = this.state;
    const floats = s.vehicles.filter((v) => v.kind === 'parade_float');
    const next: ServiceVehicle[] = [...floats];
    let vid = 500;

    for (const b of s.buildings) {
      if (!b || b.built < 1) continue;
      if (b.type === 'abatement') {
        // Strictly spawn Fogger Truck on the nearest Road/Bridge tile!
        const roadTile = this.findNearestRoadTile(b.tx + 0.5, b.ty + 0.5, 14);
        if (roadTile >= 0) {
          const rx = (roadTile % MAP_SIZE) + 0.5;
          const ry = ((roadTile / MAP_SIZE) | 0) + 0.5;
          next.push({
            id: vid++,
            kind: 'fogger',
            x: rx,
            y: ry,
            angle: 0,
            targetX: rx,
            targetY: ry,
            prevTile: roadTile,
            timer: 2,
            active: b.powered && !b.blackout,
          });
        }
      } else if (b.type === 'wildlife_post') {
        const spawn = this.findPerimeterTile(b);
        const sx = (spawn % MAP_SIZE) + 0.5;
        const sy = ((spawn / MAP_SIZE) | 0) + 0.5;
        next.push({
          id: vid++,
          kind: 'officer',
          x: sx,
          y: sy,
          angle: 0,
          targetX: sx,
          targetY: sy,
          timer: 15,
          active: true,
        });
      }
    }

    // Add 2 charming LSU Campus Shuttle cars strictly on Roads & Bridges when campus has roads!
    const roadTiles: number[] = [];
    for (let i = 0; i < TILE_COUNT; i++) {
      const sf = s.tiles.surface[i];
      if (sf === SurfaceType.Road || sf === SurfaceType.Bridge) roadTiles.push(i);
    }
    if (roadTiles.length >= 8 && s.economy.students >= 100) {
      for (let k = 0; k < 2; k++) {
        const rt = roadTiles[Math.floor(((k + 0.35) / 2) * roadTiles.length) % roadTiles.length];
        const rx = (rt % MAP_SIZE) + 0.5;
        const ry = ((rt / MAP_SIZE) | 0) + 0.5;
        next.push({
          id: 700 + k,
          kind: 'shuttle',
          x: rx,
          y: ry,
          angle: 0,
          targetX: rx,
          targetY: ry,
          prevTile: rt,
          timer: 0,
          active: true,
        });
      }
    }

    s.vehicles = next;
  }

  private stepRoadCar(v: ServiceVehicle, speed: number): void {
    const dx = v.targetX - v.x;
    const dy = v.targetY - v.y;
    const d = Math.hypot(dx, dy);

    if (d <= speed * 1.15) {
      // Snap cleanly to tile center and pick an orthogonal connected Road/Bridge neighbor!
      v.x = v.targetX;
      v.y = v.targetY;
      const cx = Math.floor(v.x);
      const cy = Math.floor(v.y);
      const curTile = idx(cx, cy);

      // If road beneath was demolished, relocate cleanly to nearest road tile
      if (!this.isRoadTile(cx, cy)) {
        const nearest = this.findNearestRoadTile(cx, cy, 20);
        if (nearest >= 0) {
          v.x = (nearest % MAP_SIZE) + 0.5;
          v.y = ((nearest / MAP_SIZE) | 0) + 0.5;
          v.targetX = v.x;
          v.targetY = v.y;
          v.prevTile = nearest;
        }
        return;
      }

      const neighbors: number[] = [];
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + ox;
        const ny = cy + oy;
        if (this.isRoadTile(nx, ny)) neighbors.push(idx(nx, ny));
      }
      if (neighbors.length === 0) return;

      // Prefer continuing forward rather than immediately U-turning
      const forward = neighbors.filter((ni) => ni !== v.prevTile);
      const chosen = forward.length > 0 ? this.rng.pick(forward) : neighbors[0];
      v.prevTile = curTile;
      v.targetX = (chosen % MAP_SIZE) + 0.5;
      v.targetY = ((chosen / MAP_SIZE) | 0) + 0.5;
      v.angle = Math.atan2(v.targetX - v.x, v.targetY - v.y);
    } else {
      v.x += (dx / d) * speed;
      v.y += (dy / d) * speed;
      v.angle = Math.atan2(dx, dy);
    }
  }

  private stepServiceVehicles(): void {
    const s = this.state;
    const { gators } = s;

    for (const v of s.vehicles) {
      if (v.kind === 'parade_float') continue; // moved along connected road route in stepParade()

      if (v.kind === 'fogger') {
        v.active = s.skyPhase === 'dusk' || s.skyPhase === 'night' || s.skyPhase === 'golden' || s.mosquitoIndex > 15;
        this.stepRoadCar(v, 0.085);
        continue;
      }

      if (v.kind === 'shuttle') {
        this.stepRoadCar(v, 0.095);
        continue;
      }

      if (v.kind === 'officer') {
        // Patrol campus walkways (never under buildings!) and relocate wandering gators
        const rogue = gators.find((g) => g.state === 'wander' && Math.hypot(g.x - v.x, g.y - v.y) < 16);
        if (rogue) {
          v.targetX = rogue.x;
          v.targetY = rogue.y;
          if (Math.hypot(rogue.x - v.x, rogue.y - v.y) < 1.3) {
            rogue.state = 'retreat';
            rogue.targetX = (rogue.homeTile % MAP_SIZE) + 0.5;
            rogue.targetY = ((rogue.homeTile / MAP_SIZE) | 0) + 0.5;
            rogue.timer = 200;
            s.gatorRelocations++;
            this.pushTicker(`Wildlife Officer safely relocated ${rogue.name} the alligator back to the bayou!`, 'wildlife');
          }
        } else {
          v.timer--;
          if (v.timer <= 0) {
            v.targetX = Math.max(6, Math.min(MAP_SIZE - 6, v.x + this.rng.range(-5, 5)));
            v.targetY = Math.max(6, Math.min(MAP_SIZE - 6, v.y + this.rng.range(-5, 5)));
            v.timer = this.rng.int(55, 110);
          }
        }

        const dx = v.targetX - v.x;
        const dy = v.targetY - v.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.15) {
          const spd = 0.068;
          const nx = v.x + (dx / d) * spd;
          const ny = v.y + (dy / d) * spd;
          if (this.isWalkableForAgent(Math.floor(nx), Math.floor(ny))) {
            v.x = nx;
            v.y = ny;
            v.angle = Math.atan2(dx, dy);
          } else {
            v.timer = 0;
          }
        }
      }
    }
  }

  triggerMardiGras(): { ok: boolean; reason?: string } {
    const s = this.state;
    if (s.parade.active) return { ok: false, reason: 'Parade already rolling!' };
    if (s.storm.active) return { ok: false, reason: 'Too stormy for a parade!' };

    // Build a continuous connected Road/Bridge path (DFS/walk from Highway 1 start so floats NEVER leave roads!)
    const startRoad = this.findNearestRoadTile(42, 1, 20);
    const route: number[] = [];
    if (startRoad >= 0) {
      const visited = new Set<number>();
      let cur = startRoad;
      for (let step = 0; step < 60; step++) {
        route.push(cur);
        visited.add(cur);
        const cx = cur % MAP_SIZE;
        const cy = (cur / MAP_SIZE) | 0;
        // Prefer going south then west toward The Cauldron!
        const dirs = [[0, 1], [-1, 0], [1, 0], [0, -1]];
        let next = -1;
        for (const [ox, oy] of dirs) {
          const nx = cx + ox;
          const ny = cy + oy;
          if (this.isRoadTile(nx, ny)) {
            const ni = idx(nx, ny);
            if (!visited.has(ni)) {
              next = ni;
              break;
            }
          }
        }
        if (next < 0) break;
        cur = next;
      }
    }
    if (route.length < 3) {
      return { ok: false, reason: 'Build at least 3 connected Campus Road tiles for the Mardi Gras parade!' };
    }

    const hasUnion = s.buildings.some((b) => b && b.type === 'union' && b.built >= 1);
    const revenue = hasUnion ? 190_000 : 95_000;

    s.parade = {
      active: true,
      tick: 0,
      duration: 280,
      route,
      revenue,
    };

    // Spawn 3 festive Purple, Gold & Green Mardi Gras Floats strictly on the road route!
    s.vehicles = s.vehicles.filter((v) => v.kind !== 'parade_float');
    for (let k = 0; k < 3; k++) {
      const startTile = route[0];
      s.vehicles.push({
        id: 900 + k,
        kind: 'parade_float',
        x: (startTile % MAP_SIZE) + 0.5,
        y: ((startTile / MAP_SIZE) | 0) + 0.5,
        angle: 0,
        targetX: (startTile % MAP_SIZE) + 0.5,
        targetY: ((startTile / MAP_SIZE) | 0) + 0.5,
        timer: 0,
        active: true,
        floatIndex: k,
      });
    }

    this.emit({ type: 'parade_start' });
    this.pushTicker("LAISSEZ LES BONS TEMPS ROULER! The Bayou State Mardi Gras Parade is rolling down campus!", 'sports');
    return { ok: true };
  }

  private stepParade(): void {
    const p = this.state.parade;
    p.tick++;

    const floats = this.state.vehicles.filter((v) => v.kind === 'parade_float');
    const n = p.route.length;
    for (const fl of floats) {
      const k = fl.floatIndex ?? 0;
      const frac = Math.max(0, Math.min(1, (p.tick - k * 18) / Math.max(1, p.duration - 40)));
      const pos = frac * (n - 1);
      const i0 = p.route[Math.floor(pos)];
      const i1 = p.route[Math.min(n - 1, Math.floor(pos) + 1)];
      const f = pos - Math.floor(pos);
      const nx = (i0 % MAP_SIZE) + ((i1 % MAP_SIZE) - (i0 % MAP_SIZE)) * f + 0.5;
      const ny = ((i0 / MAP_SIZE) | 0) + (((i1 / MAP_SIZE) | 0) - ((i0 / MAP_SIZE) | 0)) * f + 0.5;
      const dx = nx - fl.x;
      const dy = ny - fl.y;
      if (Math.hypot(dx, dy) > 0.01) fl.angle = Math.atan2(dx, dy);
      fl.x = nx;
      fl.y = ny;
    }

    if (p.tick >= p.duration) {
      p.active = false;
      this.state.vehicles = this.state.vehicles.filter((v) => v.kind !== 'parade_float');
      this.state.economy.cash += p.revenue;
      this.state.economy.happiness = Math.min(100, this.state.economy.happiness + 10);
      this.state.economy.prestige = Math.min(100, this.state.economy.prestige + 2);
      this.state.economy.xp += 220;
      this.updateCampusLevel();
      this.pushTicker(
        `Mardi Gras Parade complete! +$${(p.revenue / 1000).toFixed(0)}k festival revenue & +10 Happiness!`,
        'sports',
      );
    }
  }

  triggerDilemma(): void {
    if (this.state.activeDilemma) return;
    const card = this.rng.pick(DILEMMA_POOL);
    this.state.activeDilemma = card;
    this.emit({ type: 'dilemma' });
  }

  resolveDilemma(choiceIdx: number): void {
    const card = this.state.activeDilemma;
    if (!card) return;
    const choice = card.choices[choiceIdx];
    this.state.activeDilemma = null;
    if (!choice) return;

    const eco = this.state.economy;
    if (choice.cashDelta) eco.cash += choice.cashDelta;
    if (choice.prestigeDelta) eco.prestige = Math.max(0, Math.min(100, eco.prestige + choice.prestigeDelta));
    if (choice.happinessDelta) eco.happiness = Math.max(0, Math.min(100, eco.happiness + choice.happinessDelta));
    if (choice.ecologyDelta) eco.ecology = Math.max(0, Math.min(100, eco.ecology + choice.ecologyDelta));
    if (choice.grantInsurance) this.state.stormInsurance = true;
    if (choice.repairLevees) {
      for (let i = 0; i < TILE_COUNT; i++) {
        if (this.state.tiles.crest[i] > 0) this.state.tiles.integrity[i] = 100;
      }
    }
    this.pushTicker(`${card.source}: Chose "${choice.label}".`, 'info');
  }

  // ===== SET PIECE 1: HURRICANE LANDFALL =====
  triggerHurricane(category = 3): void {
    const s = this.state;
    if (s.storm.active) return;
    const cat = Math.max(1, Math.min(5, Math.round(category)));
    const name = STORM_NAMES[this.stormNameCursor++ % STORM_NAMES.length];
    const surges = [0, 3.2, 4.6, 6.2, 7.8, 9.5];

    s.storm = {
      active: true,
      name,
      category: cat,
      phase: 'bands',
      tick: 0,
      duration: 500,
      targetSurgeFt: surges[cat],
      currentSurgeFt: 0.4,
      windIntensity: 0.55,
      rainRate: 0.65,
      lightningFlash: 0,
      sandbagged: false,
      sheltered: false,
      toastsFired: {},
      lastReport: s.storm.lastReport,
    };

    analyzeProtectionAndRisk(s, surges[cat]);
    this.emit({ type: 'storm_warn', intensity: cat });
    this.pushTicker(
      `HURRICANE ${name.toUpperCase()} (Cat ${cat}) making landfall! Forecast surge: ${surges[cat].toFixed(1)} ft.`,
      'danger',
    );
  }

  private stepStorm(): void {
    const st = this.state.storm;
    st.tick++;
    const t = st.tick / st.duration;

    // Storm phase & surge curve: outer bands -> eyewall -> eerie eye -> backwall -> clearing
    if (t < 0.2) {
      st.phase = 'bands';
      st.currentSurgeFt = st.targetSurgeFt * (t / 0.2) * 0.55;
      st.windIntensity = 0.55 + t * 1.5;
      st.rainRate = 0.7;
    } else if (t < 0.48) {
      st.phase = 'eyewall';
      const u = (t - 0.2) / 0.28;
      st.currentSurgeFt = st.targetSurgeFt * (0.55 + u * 0.45);
      st.windIntensity = 0.95;
      st.rainRate = 1.0;
    } else if (t < 0.6) {
      st.phase = 'eye';
      st.currentSurgeFt = st.targetSurgeFt * 0.92;
      st.windIntensity = 0.2;
      st.rainRate = 0.1;
    } else if (t < 0.85) {
      st.phase = 'backwall';
      const u = (t - 0.6) / 0.25;
      st.currentSurgeFt = st.targetSurgeFt * (0.92 - u * 0.52);
      st.windIntensity = 0.88;
      st.rainRate = 0.92;
    } else {
      st.phase = 'clearing';
      const u = (t - 0.85) / 0.15;
      st.currentSurgeFt = Math.max(0, st.targetSurgeFt * 0.4 * (1 - u));
      st.windIntensity = Math.max(0.15, 0.6 * (1 - u));
      st.rainRate = Math.max(0, 0.45 * (1 - u));
    }

    this.state.windStrength = st.windIntensity;
    this.state.rainRate = st.rainRate;

    // Lightning flashes during eyewall / backwall
    st.lightningFlash = Math.max(0, st.lightningFlash - 0.14);
    if ((st.phase === 'eyewall' || st.phase === 'backwall') && this.rng.next() < 0.045) {
      st.lightningFlash = 1.0;
      this.emit({ type: 'lightning', intensity: st.category / 5 });
    }

    // Interactive Decision Toasts
    if (st.tick === 65 && !st.toastsFired.sandbags && !this.state.activeToast) {
      st.toastsFired.sandbags = true;
      this.state.activeToast = {
        id: 'storm_sandbags',
        title: `Hurricane ${st.name}: Deploy Sandbag Crews?`,
        body: 'Add +1.5 ft emergency crest to every levee before the eyewall hits.',
        yesLabel: 'Deploy Sandbags ($45k)',
        noLabel: 'Hold Reserves',
        yesCost: 45_000,
        ticksLeft: 95,
        maxTicks: 95,
        kind: 'storm',
      };
      this.emit({ type: 'toast' });
    } else if (st.tick === 190 && !st.toastsFired.shelter && !this.state.activeToast) {
      st.toastsFired.shelter = true;
      this.state.activeToast = {
        id: 'storm_shelter',
        title: 'Eyewall Approaching — Open Campus Shelters?',
        body: 'Move all students into Founders\' Hall & The Cauldron to protect morale.',
        yesLabel: 'Open Shelters ($20k)',
        noLabel: 'Shelter in Dorms',
        yesCost: 20_000,
        ticksLeft: 95,
        maxTicks: 95,
        kind: 'storm',
      };
      this.emit({ type: 'toast' });
    }

    // Storm concludes -> Damage & Defense Report
    if (st.tick >= st.duration) {
      let floodedCount = 0;
      let damageCost = 0;
      let blackoutOccurred = false;

      for (const b of this.state.buildings) {
        if (!b) continue;
        if (b.blackout) blackoutOccurred = true;
        if (b.flooded) {
          floodedCount++;
          const dmg = Math.min(0.45, 0.08 * st.category);
          b.hp = Math.max(0.35, b.hp - dmg);
          damageCost += Math.round(CATALOG[b.type].cost * dmg * 0.25);
        } else if (st.category >= 3 && CATALOG[b.type].windRating <= 2) {
          b.hp = Math.max(0.55, b.hp - 0.18);
          damageCost += Math.round(CATALOG[b.type].cost * 0.06);
        }
      }

      if (this.state.stormInsurance && damageCost > 0) {
        damageCost = Math.round(damageCost * 0.5);
        this.state.stormInsurance = false;
        this.pushTicker('State Storm Insurance Pool covered 50% of hurricane cleanup!', 'money');
      }

      // Cajun Navy Recovery! If a Wildlife Officer Post exists after a Cat 3+ storm, launch rescue boats & halve cleanup!
      const hasWildlifePost = this.state.buildings.some((b) => b && b.type === 'wildlife_post' && b.built >= 1);
      if (st.category >= 3 && hasWildlifePost) {
        damageCost = Math.round(damageCost * 0.5);
        this.state.economy.happiness = Math.min(100, this.state.economy.happiness + 5);
        this.state.pirogues.push(
          { id: 800 + this.state.tick, splinePos: 6, direction: 1, passengers: 0, delivered: true, cajunNavy: true },
          { id: 801 + this.state.tick, splinePos: 22, direction: -1, passengers: 0, delivered: true, cajunNavy: true },
        );
        this.pushTicker('CAJUN NAVY LAUNCHED! Volunteer flatboats accelerated storm recovery (-50% cleanup, +5 Happiness).', 'water');
      }

      if (damageCost > 0) {
        this.state.economy.cash -= Math.min(damageCost, Math.max(0, this.state.economy.cash));
      }

      const held = floodedCount === 0;
      st.lastReport = {
        name: st.name,
        category: st.category,
        peakSurgeFt: st.targetSurgeFt,
        floodedCount,
        protectedTiles: this.state.protectedCount,
        damageCost,
        blackoutOccurred,
        held,
      };
      st.active = false;
      st.phase = 'none';
      st.currentSurgeFt = 0;
      this.state.rainRate = 0;
      this.state.windStrength = 0.14;
      this.state.buildingsDirty = true;

      if (held) {
        this.state.economy.prestige = Math.min(100, this.state.economy.prestige + 4);
        this.pushTicker(
          `Hurricane ${st.name} passed — CAMPUS HELD DRY! +4 Prestige.`,
          'water',
        );
      } else {
        this.pushTicker(
          `Hurricane ${st.name} cleared: ${floodedCount} buildings flooded ($${(damageCost / 1000).toFixed(0)}k cleanup).`,
          'danger',
        );
      }
      this.recomputeStats();
    }
  }

  // ===== SET PIECE 2: SATURDAY NIGHT IN THE CAULDRON =====
  triggerHomeGame(forceNight?: boolean): { ok: boolean; reason?: string } {
    const s = this.state;
    if (s.football.active) return { ok: false, reason: 'Game already in progress' };

    const stadium = s.buildings.find((b) => b && b.type === 'stadium' && b.built >= 1);
    const field = s.buildings.find((b) => b && b.type === 'practice_field' && b.built >= 1 && b.tier >= 1);

    if (!stadium && !field) {
      return { ok: false, reason: 'Build Red Stick Stadium (or upgrade Practice Field to Bayou Field) first!' };
    }

    const opp = this.rng.pick(OPPONENTS);
    const tier = stadium ? stadium.tier : 0;
    const capacity = stadium ? (tier === 0 ? 15_000 : tier === 1 ? 45_000 : 80_000) : 6_000;
    const canNight = Boolean(stadium && tier >= 1);
    const nightGame = forceNight !== undefined ? forceNight : canNight;
    const fillRate = Math.min(1, 0.58 + s.economy.prestige / 140 + (nightGame ? 0.16 : 0));
    const attendance = Math.round(capacity * fillRate);

    const hasTiger = s.buildings.some((b) => b && b.type === 'tiger_habitat' && b.built >= 1);
    const homeBonus = (nightGame ? 9 : 4) + (hasTiger ? 6 : 0) + tier * 5;
    const ratingDiff = s.economy.teamRating + homeBonus - opp.rating;
    const winProb = Math.max(0.22, Math.min(0.88, 0.5 + ratingDiff * 0.014));

    s.football = {
      active: true,
      opponent: opp.name,
      opponentColor: opp.color,
      nightGame,
      tick: 0,
      duration: 420,
      quarter: 1,
      homeScore: 0,
      awayScore: 0,
      attendance,
      capacity,
      winProb,
      halftimeAsked: false,
      aggressiveCall: false,
      playLog: [
        {
          quarter: 1,
          clock: '15:00',
          text: `${nightGame ? 'Saturday Night in The Cauldron!' : 'Kickoff under the Louisiana sun!'} ${attendance.toLocaleString()} fans roar as Bayou State faces ${opp.name}.`,
          scoring: 'none',
        },
      ],
      fireworkBurstTick: -100,
      shakeTrigger: 0,
      finished: false,
      revenue: Math.round(attendance * 34),
    };

    this.emit({ type: 'kickoff' });
    this.pushTicker(`KICKOFF! Bayou State vs ${opp.name} (${attendance.toLocaleString()} fans).`, 'sports');
    return { ok: true };
  }

  private stepFootball(): void {
    const fg = this.state.football;
    fg.tick++;

    const q = Math.min(4, Math.floor((fg.tick / fg.duration) * 4) + 1) as 1 | 2 | 3 | 4;
    fg.quarter = q;

    // Halftime decision toast at tick 200
    if (fg.tick === 200 && !fg.halftimeAsked && !this.state.activeToast) {
      fg.halftimeAsked = true;
      this.state.activeToast = {
        id: 'football_halftime',
        title: `Halftime: BSU ${fg.homeScore} — ${fg.opponent} ${fg.awayScore}`,
        body: 'The Golden Band just fired up the crowd! Call the 2nd-half game plan:',
        yesLabel: 'Unleash Deep Passing (+risk/reward)',
        noLabel: 'Ground & Pound Control',
        ticksLeft: 85,
        maxTicks: 85,
        kind: 'football',
      };
      this.emit({ type: 'toast' });
    }

    // Scoring drives every ~42 ticks
    if (fg.tick % 42 === 20 && fg.tick < fg.duration - 12) {
      const clockMin = Math.max(0, 14 - Math.floor(((fg.tick % 105) / 105) * 14));
      const clock = `${clockMin}:${String(this.rng.int(10, 58)).padStart(2, '0')}`;
      const prob = Math.min(0.92, fg.winProb + (fg.aggressiveCall ? 0.08 : 0));

      const roll = this.rng.next();
      if (roll < prob * 0.62) {
        const isTd = this.rng.next() < (fg.aggressiveCall ? 0.78 : 0.66);
        const pts = isTd ? 7 : 3;
        fg.homeScore += pts;
        const linesTd = [
          'TOUCHDOWN TIGERS! 44-yard strike into the purple-and-gold end zone — the stadium shakes!',
          'TOUCHDOWN BAYOU STATE! Breaks two tackles down the sideline and dives for the pylon!',
          'PICK-SIX! The defense jumps the slant and houses it as fireworks light up the bayou!',
        ];
        const linesFg = [
          'Field goal is GOOD from 47 yards! The student section erupts.',
          'Drills a 41-yarder straight through the uprights!',
        ];
        fg.playLog.unshift({
          quarter: q,
          clock,
          text: isTd ? this.rng.pick(linesTd) : this.rng.pick(linesFg),
          scoring: 'home',
        });
        if (isTd) {
          fg.fireworkBurstTick = fg.tick;
          fg.shakeTrigger++;
          this.emit({ type: 'touchdown', intensity: 1 });
        }
      } else if (roll < 0.84) {
        const isTd = this.rng.next() < 0.58;
        const pts = isTd ? 7 : 3;
        fg.awayScore += pts;
        fg.playLog.unshift({
          quarter: q,
          clock,
          text: isTd
            ? `${fg.opponent} answers with a touchdown drive (+7).`
            : `${fg.opponent} settles for a 38-yard field goal (+3).`,
          scoring: 'away',
        });
      } else {
        fg.playLog.unshift({
          quarter: q,
          clock,
          text: 'SACK on third down! The Cauldron crowd noise forces a false start and punt.',
          scoring: 'none',
        });
      }
      if (fg.playLog.length > 8) fg.playLog.length = 8;
    }

    if (fg.tick >= fg.duration) {
      // Break ties dramatically for Bayou State in overtime!
      if (fg.homeScore === fg.awayScore) {
        fg.homeScore += 7;
        fg.fireworkBurstTick = fg.tick;
        fg.shakeTrigger++;
        fg.playLog.unshift({
          quarter: 4,
          clock: '0:00',
          text: 'WALK-OFF TOUCHDOWN! Bayou State wins it as the clock hits zero!',
          scoring: 'home',
        });
      }

      const won = fg.homeScore > fg.awayScore;
      fg.finished = true;
      fg.active = false;
      this.state.economy.cash += fg.revenue;
      this.state.economy.xp += won ? 450 : 180;
      this.updateCampusLevel();

      if (won) {
        this.state.economy.wins++;
        this.state.economy.prestige = Math.min(100, this.state.economy.prestige + 4);
        this.state.economy.happiness = Math.min(100, this.state.economy.happiness + 8);
        this.emit({ type: 'game_win' });
        this.pushTicker(
          `FINAL: Bayou State ${fg.homeScore}, ${fg.opponent} ${fg.awayScore}! +$${(fg.revenue / 1000).toFixed(0)}k gate revenue.`,
          'sports',
        );
      } else {
        this.state.economy.losses++;
        this.emit({ type: 'game_loss' });
        this.pushTicker(
          `FINAL: ${fg.opponent} ${fg.awayScore}, Bayou State ${fg.homeScore}. +$${(fg.revenue / 1000).toFixed(0)}k gate.`,
          'sports',
        );
      }

      this.evaluateGoals();
    }
  }

  resolveToast(accepted: boolean): void {
    const toast = this.state.activeToast;
    if (!toast) return;
    this.state.activeToast = null;

    if (toast.id === 'storm_sandbags' && accepted) {
      if (this.state.economy.cash >= (toast.yesCost ?? 0)) {
        this.state.economy.cash -= toast.yesCost ?? 0;
        this.state.storm.sandbagged = true;
        analyzeProtectionAndRisk(this.state, this.state.storm.targetSurgeFt);
        this.pushTicker('Emergency sandbags stacked! All levees reinforced by +1.5 ft.', 'water');
      }
    } else if (toast.id === 'storm_shelter' && accepted) {
      if (this.state.economy.cash >= (toast.yesCost ?? 0)) {
        this.state.economy.cash -= toast.yesCost ?? 0;
        this.state.storm.sheltered = true;
        this.state.economy.happiness = Math.min(100, this.state.economy.happiness + 5);
        this.pushTicker('Campus shelters opened — students are dry and playing euchre in the gym.', 'info');
      }
    } else if (toast.id === 'football_halftime') {
      this.state.football.aggressiveCall = accepted;
      this.pushTicker(
        accepted
          ? 'Halftime call: Airing it out deep downfield!'
          : 'Halftime call: Power run game between the tackles!',
        'sports',
      );
    }
  }

  skipActiveSetPiece(): void {
    if (this.state.storm.active) {
      this.state.storm.tick = this.state.storm.duration - 1;
      this.stepStorm();
    } else if (this.state.football.active) {
      this.state.football.tick = this.state.football.duration - 1;
      this.stepFootball();
    } else if (this.state.parade.active) {
      this.state.parade.tick = this.state.parade.duration - 1;
      this.stepParade();
    }
  }

  // ===== AGENTS, GATORS & PIROGUES =====
  private isWalkableForAgent(tx: number, ty: number): boolean {
    if (!inBounds(tx, ty)) return false;
    const { tiles } = this.state;
    const i = idx(tx, ty);
    // NEVER allow NPCs inside or under ANY building footprint (including buildings on pilings!)
    if (tiles.owner[i] >= 0) return false;
    // Block floodwalls and open water without bridges/boardwalks
    if (tiles.flags[i] & TileFlag.Floodwall) return false;
    const sf = tiles.surface[i];
    const onDeck = sf === SurfaceType.Bridge || sf === SurfaceType.Boardwalk;
    if ((tiles.flags[i] & (TileFlag.OpenWater | TileFlag.Bayou)) && !onDeck) return false;
    return true;
  }

  private findPerimeterTile(b: BuildingInstance): number {
    const candidates: number[] = [];
    const preferred: number[] = [];
    for (let dy = -1; dy <= b.h; dy++) {
      for (let dx = -1; dx <= b.w; dx++) {
        if (dx >= 0 && dx < b.w && dy >= 0 && dy < b.h) continue;
        const tx = b.tx + dx;
        const ty = b.ty + dy;
        if (!this.isWalkableForAgent(tx, ty)) continue;
        const ti = idx(tx, ty);
        candidates.push(ti);
        const sf = this.state.tiles.surface[ti];
        if (
          sf === SurfaceType.Path ||
          sf === SurfaceType.Quad ||
          sf === SurfaceType.ParadeGround ||
          sf === SurfaceType.Boardwalk ||
          sf === SurfaceType.Road
        ) {
          preferred.push(ti);
        }
      }
    }
    if (preferred.length > 0) return this.rng.pick(preferred);
    if (candidates.length > 0) return this.rng.pick(candidates);
    return idx(this.state.plot.foundersTx - 2, this.state.plot.foundersTy + 3);
  }

  // Zero-allocation reusable typed-array scratchpad for ultra-fast bounded A* pathfinding
  private astarEpoch = 1;
  private astarSeen = new Uint32Array(TILE_COUNT);
  private astarClosed = new Uint32Array(TILE_COUNT);
  private astarG = new Float32Array(TILE_COUNT);
  private astarF = new Float32Array(TILE_COUNT);
  private astarParent = new Int16Array(TILE_COUNT);
  private astarOpen = new Int16Array(TILE_COUNT);

  /**
   * Ultra-fast zero-allocation bounded A* pathfinder along campus sidewalks, boardwalks, bridges & quads.
   * Strictly avoids ALL building footprints (so NPCs never clip through or walk under pilings!).
   */
  private findAgentRoute(startTile: number, goalTile: number): number[] {
    if (startTile === goalTile) return [goalTile];
    const { tiles } = this.state;
    const gx = goalTile % MAP_SIZE;
    const gy = (goalTile / MAP_SIZE) | 0;

    const epoch = ++this.astarEpoch;
    const seen = this.astarSeen;
    const closed = this.astarClosed;
    const gScore = this.astarG;
    const fScore = this.astarF;
    const parent = this.astarParent;
    const open = this.astarOpen;

    let openLen = 1;
    open[0] = startTile;
    seen[startTile] = epoch;
    gScore[startTile] = 0;
    fScore[startTile] = Math.abs((startTile % MAP_SIZE) - gx) + Math.abs(((startTile / MAP_SIZE) | 0) - gy);
    parent[startTile] = -1;

    let steps = 0;
    while (openLen > 0 && steps < 140) {
      steps++;
      let bestIdx = 0;
      let bestF = fScore[open[0]];
      for (let k = 1; k < openLen; k++) {
        const f = fScore[open[k]];
        if (f < bestF) {
          bestF = f;
          bestIdx = k;
        }
      }
      const cur = open[bestIdx];
      open[bestIdx] = open[--openLen];

      if (cur === goalTile) {
        const path: number[] = [];
        let node = cur;
        while (node >= 0 && node !== startTile) {
          path.push(node);
          node = parent[node];
        }
        path.reverse();
        return path;
      }
      closed[cur] = epoch;

      const cx = cur % MAP_SIZE;
      const cy = (cur / MAP_SIZE) | 0;
      const curG = gScore[cur];

      for (let d = 0; d < 4; d++) {
        const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
        const ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (!this.isWalkableForAgent(nx, ny)) continue;
        const ni = ny * MAP_SIZE + nx;
        if (closed[ni] === epoch) continue;

        const sf = tiles.surface[ni];
        const stepCost =
          sf === SurfaceType.Path ||
          sf === SurfaceType.Quad ||
          sf === SurfaceType.ParadeGround ||
          sf === SurfaceType.Boardwalk ||
          sf === SurfaceType.Bridge
            ? 1.0
            : sf === SurfaceType.Road
              ? 1.4
              : 3.4;

        const tentative = curG + stepCost;
        if (seen[ni] !== epoch || tentative < gScore[ni]) {
          parent[ni] = cur;
          gScore[ni] = tentative;
          fScore[ni] = tentative + Math.abs(nx - gx) + Math.abs(ny - gy);
          if (seen[ni] !== epoch) {
            seen[ni] = epoch;
            open[openLen++] = ni;
          }
        }
      }
    }
    return [];
  }

  private syncAgents(): void {
    const target = Math.min(
      260,
      this.state.economy.students > 0 ? Math.max(24, Math.round(28 + this.state.economy.students / 16)) : 0,
    );
    const hubs = this.state.buildings.filter((b): b is BuildingInstance => Boolean(b && b.built >= 1));
    if (hubs.length === 0) return;

    const shirts: Agent['shirt'][] = ['purple', 'gold', 'white', 'lavender'];
    while (this.state.agents.length < target) {
      const h = this.rng.pick(hubs);
      const spawnTile = this.findPerimeterTile(h);
      const sx = (spawnTile % MAP_SIZE) + this.rng.range(0.25, 0.75);
      const sy = ((spawnTile / MAP_SIZE) | 0) + this.rng.range(0.25, 0.75);
      this.state.agents.push({
        id: this.state.agents.length + 1,
        x: sx,
        y: sy,
        px: sx,
        py: sy,
        vx: 0,
        vy: 0,
        route: [],
        routeIdx: 0,
        goal: 'class',
        targetTile: spawnTile,
        waitTicks: this.rng.int(0, 35),
        shirt: this.rng.pick(shirts),
        hasUmbrella: false,
        wading: false,
        phaseOffset: this.rng.range(0, Math.PI * 2),
      });
    }
    if (this.state.agents.length > target) {
      this.state.agents.length = target;
    }
  }

  private stepAgents(): void {
    const { agents, buildings, tiles, gators } = this.state;
    if (agents.length === 0) return;

    const activeBuildings = buildings.filter((b): b is BuildingInstance => Boolean(b && b.built >= 1));
    if (activeBuildings.length === 0) return;

    const stadium = activeBuildings.find((b) => b.type === 'stadium' || b.type === 'practice_field');
    const raining = this.state.rainRate > 0.15 || this.state.storm.active;
    let routeBudget = 3; // Zero-GC A* budget keeps frame time silky smooth!

    for (const a of agents) {
      a.px = a.x;
      a.py = a.y;
      a.hasUmbrella = raining;

      const curTx = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(a.x)));
      const curTy = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(a.y)));
      const ti = idx(curTx, curTy);

      // Safety ejection: if a new building was placed on top of a student, step them right outside onto the perimeter!
      if (!this.isWalkableForAgent(curTx, curTy)) {
        const owner = tiles.owner[ti];
        const b = owner >= 0 ? buildings[owner] : null;
        const safeTile = b ? this.findPerimeterTile(b) : this.findPerimeterTile(activeBuildings[0]);
        a.x = (safeTile % MAP_SIZE) + 0.5;
        a.y = ((safeTile / MAP_SIZE) | 0) + 0.5;
        a.route = [];
        a.routeIdx = 0;
        continue;
      }

      const surf = tiles.surface[ti];
      const onDeck = surf === SurfaceType.Bridge || surf === SurfaceType.Boardwalk;
      a.wading = !onDeck && tiles.depth[ti] >= 0.25;

      // Flee nearby wandering alligator (respecting walkability so they never clip under buildings!)
      let fleeDx = 0;
      let fleeDy = 0;
      for (const g of gators) {
        if (g.state !== 'wander') continue;
        const dx = a.x - g.x;
        const dy = a.y - g.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 7.0 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          fleeDx += dx / d;
          fleeDy += dy / d;
        }
      }
      if (fleeDx !== 0 || fleeDy !== 0) {
        const nx = Math.max(1, Math.min(MAP_SIZE - 2, a.x + fleeDx * 0.14));
        const ny = Math.max(1, Math.min(MAP_SIZE - 2, a.y + fleeDy * 0.14));
        if (this.isWalkableForAgent(Math.floor(nx), Math.floor(ny))) {
          a.x = nx;
          a.y = ny;
          a.vx = fleeDx * 0.14;
          a.vy = fleeDy * 0.14;
          a.goal = 'flee';
          a.route = [];
        }
        continue;
      }

      if (a.waitTicks > 0) {
        a.waitTicks--;
        continue;
      }

      // Need a new destination route?
      if (a.routeIdx >= a.route.length) {
        if (routeBudget <= 0) continue;
        routeBudget--;
        const dest =
          this.state.football.active && stadium && this.rng.next() < 0.72
            ? stadium
            : this.rng.pick(activeBuildings);
        const goalTile = this.findPerimeterTile(dest);
        a.route = this.findAgentRoute(ti, goalTile);
        a.routeIdx = 0;
        a.targetTile = goalTile;
        if (a.route.length === 0) {
          a.waitTicks = this.rng.int(25, 65);
        }
        continue;
      }

      const nextTile = a.route[a.routeIdx];
      const ntx = nextTile % MAP_SIZE;
      const nty = (nextTile / MAP_SIZE) | 0;

      // Replan if next waypoint became blocked by a newly built structure
      if (!this.isWalkableForAgent(ntx, nty)) {
        a.route = [];
        a.routeIdx = 0;
        continue;
      }

      const dx = ntx + 0.5 - a.x;
      const dy = nty + 0.5 - a.y;
      const dist = Math.hypot(dx, dy);

      // Relaxed, natural campus stroll speed (slowed down ~3x per playtester feedback!)
      const speed =
        surf !== SurfaceType.None ? 0.095 : a.wading ? 0.04 : 0.062;

      if (dist <= speed * 1.15) {
        a.x = ntx + 0.5;
        a.y = nty + 0.5;
        a.routeIdx++;
        if (a.routeIdx >= a.route.length) {
          a.waitTicks = this.rng.int(28, 85);
        }
      } else {
        const stepX = (dx / dist) * speed;
        const stepY = (dy / dist) * speed;
        const nx = a.x + stepX;
        const ny = a.y + stepY;
        if (this.isWalkableForAgent(Math.floor(nx), Math.floor(ny))) {
          a.x = nx;
          a.y = ny;
          a.vx = stepX;
          a.vy = stepY;
        } else {
          a.route = [];
          a.routeIdx = 0;
        }
      }
    }
  }

  private stepGators(): void {
    const { gators, tiles, buildings } = this.state;
    const tigerHabitat = buildings.find((b) => b && b.type === 'tiger_habitat' && b.built >= 1);

    for (const g of gators) {
      g.timer--;
      if (g.timer <= 0) {
        if (g.state === 'sun' && this.rng.next() < 0.35) {
          g.state = 'wander';
          const angle = this.rng.range(0, Math.PI * 2);
          const dist = this.rng.range(3, 8);
          g.targetX = Math.max(3, Math.min(MAP_SIZE - 4, g.x + Math.cos(angle) * dist));
          g.targetY = Math.max(3, Math.min(MAP_SIZE - 4, g.y + Math.sin(angle) * dist));
          g.timer = this.rng.int(90, 180);
        } else {
          g.state = 'sun';
          const hx = g.homeTile % MAP_SIZE;
          const hy = (g.homeTile / MAP_SIZE) | 0;
          g.targetX = hx + 0.5;
          g.targetY = hy + 0.5;
          g.timer = this.rng.int(120, 260);
        }
      }

      // Repelled by Roux's Tiger Habitat!
      if (tigerHabitat) {
        const d = Math.hypot(g.x - (tigerHabitat.tx + 1.5), g.y - (tigerHabitat.ty + 1.5));
        if (d < 9) {
          g.state = 'retreat';
          g.targetX = (g.homeTile % MAP_SIZE) + 0.5;
          g.targetY = ((g.homeTile / MAP_SIZE) | 0) + 0.5;
        }
      }

      const dx = g.targetX - g.x;
      const dy = g.targetY - g.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.2) {
        const spd = 0.055;
        const nx = g.x + (dx / dist) * spd;
        const ny = g.y + (dy / dist) * spd;
        const ni = inBounds(Math.floor(nx), Math.floor(ny)) ? idx(Math.floor(nx), Math.floor(ny)) : 0;
        if (tiles.owner[ni] < 0 && tiles.surface[ni] !== SurfaceType.GatorFence) {
          g.x = nx;
          g.y = ny;
          g.angle = Math.atan2(dy, dx);
        } else {
          g.timer = 0;
        }
      }
    }
  }

  private stepPirogues(): void {
    const spline = this.state.plot.bayouSpline;
    if (spline.length < 4) return;
    for (const p of this.state.pirogues) {
      p.splinePos += p.direction * 0.08;
      if (p.splinePos >= spline.length - 2) {
        p.splinePos = spline.length - 2;
        p.direction = -1;
      } else if (p.splinePos <= 1) {
        p.splinePos = 1;
        p.direction = 1;
      }
    }
    if (this.state.pirogues.length > 5) {
      this.state.pirogues.splice(2, this.state.pirogues.length - 5);
    }
  }

  // ===== GOALS =====
  evaluateGoals(): void {
    const s = this.state;
    const bList = s.buildings.filter((b): b is BuildingInstance => Boolean(b));

    let quadCount = 0;
    let pathCount = 0;
    let leveeCount = 0;
    let canalCount = 0;
    let bridgeCount = 0;
    for (let i = 0; i < TILE_COUNT; i++) {
      if (s.tiles.surface[i] === SurfaceType.Quad || s.tiles.surface[i] === SurfaceType.ParadeGround) quadCount++;
      if (s.tiles.surface[i] === SurfaceType.Path) pathCount++;
      if (s.tiles.crest[i] > 0) leveeCount++;
      if (s.tiles.flags[i] & TileFlag.Canal) canalCount++;
      if (s.tiles.surface[i] === SurfaceType.Bridge || s.tiles.surface[i] === SurfaceType.Boardwalk) bridgeCount++;
    }

    for (const g of s.goals) {
      if (g.completed) continue;
      let done = false;

      if (g.id === 'founders') {
        const has = bList.some((b) => b.type === 'founders_hall');
        g.steps = [{ label: "Place Founders' Hall on the ridge", done: has, buildHint: 'founders_hall' }];
        g.buildHint = 'founders_hall';
        g.progressText = has ? '1 / 1' : '0 / 1';
        g.progressFrac = has ? 1 : 0;
        done = has;
      } else if (g.id === 'campus_core') {
        const hasDorm = bList.some((b) => b.type === 'dorm' || b.type === 'res_tower' || b.type === 'student_lofts');
        const hasDining = bList.some((b) => b.type === 'dining_hall' || b.type === 'poboy');
        const hasPower = bList.some((b) => b.type === 'substation');
        const hasWater = bList.some((b) => b.type === 'water_tower');
        g.steps = [
          { label: 'Build a Freshman Dorm', done: hasDorm, buildHint: 'dorm' },
          { label: 'Build Dining Commons', done: hasDining, buildHint: 'dining_hall' },
          { label: 'Build Power Substation', done: hasPower, buildHint: 'substation' },
          { label: 'Build Water Tower', done: hasWater, buildHint: 'water_tower' },
        ];
        const nextStep = g.steps.find((st) => !st.done);
        g.buildHint = nextStep?.buildHint;
        const count = g.steps.filter((st) => st.done).length;
        g.progressText = `${count} / 4 steps`;
        g.progressFrac = count / 4;
        done = count === 4;
      } else if (g.id === 'quad_life') {
        const qDone = quadCount >= 8;
        const pDone = pathCount >= 6;
        g.steps = [
          { label: `Paint Quad Lawns (${Math.min(8, quadCount)}/8)`, done: qDone, buildHint: 'quad' },
          { label: `Lay Brick Quad Paths (${Math.min(6, pathCount)}/6)`, done: pDone, buildHint: 'path' },
        ];
        g.buildHint = !qDone ? 'quad' : 'path';
        const count = (qDone ? 1 : 0) + (pDone ? 1 : 0);
        g.progressText = `${count} / 2 steps`;
        g.progressFrac = (Math.min(8, quadCount) + Math.min(6, pathCount)) / 14;
        done = qDone && pDone;
      } else if (g.id === 'swamp_defense') {
        const pilingsCount = bList.filter((b) => b.pilings).length;
        const lDone = leveeCount >= 8;
        const cDone = canalCount >= 3;
        const pDone = bList.some((b) => b.type === 'pump');
        g.steps = [
          { label: `Build Earthen Levee / Floodwall (${Math.min(8, leveeCount)}/8)`, done: lDone || pilingsCount >= 2, buildHint: 'levee' },
          { label: `Dig Drainage Canal (${Math.min(3, canalCount)}/3)`, done: cDone || pilingsCount >= 2, buildHint: 'canal' },
          { label: 'Build a Pump Station (or 2 Pilings halls)', done: pDone || pilingsCount >= 2, buildHint: 'pump' },
        ];
        const nextStep = g.steps.find((st) => !st.done);
        g.buildHint = nextStep?.buildHint;
        const count = g.steps.filter((st) => st.done).length;
        g.progressText = pilingsCount >= 2 ? 'Pilings strategy!' : `${count} / 3 steps`;
        g.progressFrac = pilingsCount >= 2 ? 1 : count / 3;
        done = count === 3 || pilingsCount >= 2;
      } else if (g.id === 'cross_bayou') {
        const b = Math.min(3, bridgeCount);
        g.steps = [{ label: `Span bayou with Bridge or Boardwalk (${b}/3)`, done: bridgeCount >= 3, buildHint: 'road_bridge' }];
        g.buildHint = 'road_bridge';
        g.progressText = `${b} / 3 spans`;
        g.progressFrac = b / 3;
        done = bridgeCount >= 3;
      } else if (g.id === 'landmarks') {
        const has = bList.some((b) => b.type === 'bell_tower' || b.type === 'tiger_habitat');
        g.steps = [{ label: "Build Memorial Bell Tower or Roux's Habitat", done: has, buildHint: 'bell_tower' }];
        g.buildHint = 'bell_tower';
        g.progressText = has ? '1 / 1' : '0 / 1';
        g.progressFrac = has ? 1 : 0;
        done = has;
      } else if (g.id === 'cauldron') {
        const stad = bList.find((b) => b.type === 'stadium');
        const hasCauldron = Boolean(stad && stad.tier >= 1);
        const played = s.economy.wins + s.economy.losses > 0 && !s.showcaseMode;
        g.steps = [
          { label: 'Build Red Stick Stadium', done: Boolean(stad), buildHint: 'stadium' },
          { label: 'Upgrade Stadium to The Cauldron', done: hasCauldron },
          { label: 'Play a Saturday Night Game', done: played },
        ];
        g.buildHint = !stad ? 'stadium' : undefined;
        const pts = (stad ? 1 : 0) + (hasCauldron ? 1 : 0) + (played ? 1 : 0);
        g.progressText = !stad ? 'Step 1 of 3' : !hasCauldron ? 'Step 2 of 3' : played ? 'Done!' : 'Step 3 of 3';
        g.progressFrac = pts / 3;
        done = pts === 3;
      }

      if (done) {
        g.completed = true;
        if (!s.showcaseMode) {
          s.economy.cash += g.rewardCash;
          s.economy.prestige = Math.min(100, s.economy.prestige + g.rewardPrestige);
          s.economy.xp += 250;
          this.updateCampusLevel();
          this.emit({ type: 'goal_complete', text: g.title });
          this.pushTicker(
            `GOAL COMPLETE: ${g.title}! +$${(g.rewardCash / 1000).toFixed(0)}k & +${g.rewardPrestige} Prestige.`,
            'money',
          );
        }
      }
    }

    const nextIdx = s.goals.findIndex((g) => !g.completed);
    s.activeGoalIdx = nextIdx === -1 ? s.goals.length - 1 : nextIdx;
  }

  // ===== SAVE / LOAD =====
  serialize(): string {
    const s = this.state;
    return JSON.stringify({
      v: 1,
      seed: s.seed,
      tick: s.tick,
      day: s.day,
      dayTick: s.dayTick,
      year: s.year,
      month: s.month,
      dom: s.dom,
      season: s.season,
      skyTick: s.skyTick,
      economy: s.economy,
      plot: s.plot,
      buildings: s.buildings,
      veg: s.veg,
      goals: s.goals,
      ownedParcels: s.ownedParcels,
      collegeTownUnlocked: s.collegeTownUnlocked,
      tiles: {
        elev: Array.from(s.tiles.elev, (n) => Math.round(n * 100) / 100),
        depth: Array.from(s.tiles.depth, (n) => Math.round(n * 100) / 100),
        crest: Array.from(s.tiles.crest),
        integrity: Array.from(s.tiles.integrity),
        surface: Array.from(s.tiles.surface),
        flags: Array.from(s.tiles.flags),
        owner: Array.from(s.tiles.owner),
      },
    });
  }

  deserialize(raw: string): boolean {
    try {
      const data = JSON.parse(raw);
      if (!data || data.v !== 1 || !data.tiles) return false;
      this.newGame(data.seed || 1860, false);
      const s = this.state;
      s.tick = data.tick ?? 0;
      s.day = data.day ?? 0;
      s.dayTick = data.dayTick ?? 0;
      s.year = data.year ?? 1;
      s.month = data.month ?? 1;
      s.dom = data.dom ?? 1;
      s.season = data.season ?? 'spring';
      s.skyTick = data.skyTick ?? 75;
      s.economy = { ...s.economy, ...data.economy };
      s.plot = data.plot ?? s.plot;
      s.buildings = data.buildings ?? [];
      this.nextBuildingId = s.buildings.length;
      s.veg = data.veg ?? s.veg;
      if (Array.isArray(data.goals)) s.goals = data.goals;
      if (Array.isArray(data.ownedParcels)) s.ownedParcels = data.ownedParcels;
      if (typeof data.collegeTownUnlocked === 'boolean') s.collegeTownUnlocked = data.collegeTownUnlocked;

      s.tiles.elev.set(data.tiles.elev);
      s.tiles.depth.set(data.tiles.depth);
      s.tiles.crest.set(data.tiles.crest);
      s.tiles.integrity.set(data.tiles.integrity);
      s.tiles.surface.set(data.tiles.surface);
      s.tiles.flags.set(data.tiles.flags);
      s.tiles.owner.set(data.tiles.owner);

      classifyTiles(s.tiles);
      this.recomputeCoverage();
      analyzeProtectionAndRisk(s, 5.0);
      this.recomputeStats();
      this.syncAgents();
      this.evaluateGoals();
      s.terrainDirty = true;
      s.buildingsDirty = true;
      s.vegDirty = true;
      s.waterDirty = true;
      return true;
    } catch {
      return false;
    }
  }
}
