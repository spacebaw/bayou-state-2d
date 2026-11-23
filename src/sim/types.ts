export const MAP_SIZE = 64;
export const TILE_COUNT = MAP_SIZE * MAP_SIZE;
export const TILE_WORLD = 4; // meters per tile (256m x 256m world)
export const ELEV_SCALE = 0.55; // world Y units per foot of elevation

export enum TileType {
  OpenWater = 0,
  Bayou = 1,
  Marsh = 2,
  Wet = 3,
  Dry = 4,
  High = 5,
  Drained = 6,
  Pond = 7,
}

export enum SurfaceType {
  None = 0,
  Path = 1,
  Road = 2,
  Boardwalk = 3,
  Bridge = 4,
  Quad = 5,
  ParadeGround = 6,
  GatorFence = 7,
}

export enum TileFlag {
  None = 0,
  WetlandOriginal = 1 << 0,
  Preserve = 1 << 1,
  Canal = 1 << 2,
  Floodgate = 1 << 3,
  PondSink = 1 << 4,
  Bayou = 1 << 5,
  OpenWater = 1 << 6,
  Highway = 1 << 7,
  Protected = 1 << 8,
  Floodwall = 1 << 9,
}

export enum OverlayMode {
  None = 0,
  FloodRisk = 1,
  Elevation = 2,
  Utilities = 3,
  Ecology = 4,
  Mosquito = 5,
}

export type SkyPhase = 'dawn' | 'day' | 'golden' | 'dusk' | 'night';
export type Season = 'spring' | 'summer' | 'fall' | 'winter';
export type BuildingCategory =
  | 'paths'
  | 'academics'
  | 'colleges'
  | 'life'
  | 'venues'
  | 'town'
  | 'defense'
  | 'athletics'
  | 'nature';

export type BuildingId =
  // Paths & crossings
  | 'path'
  | 'road'
  | 'boardwalk'
  | 'road_bridge'
  | 'parade_ground'
  // Core Academics & Landmarks
  | 'founders_hall'
  | 'bell_tower'
  | 'lecture_hall'
  | 'library'
  | 'engineering'
  | 'coastal_institute'
  // Slice 2: Full LSU-inspired Colleges & Schools
  | 'business_college'
  | 'humanities_college'
  | 'science_college'
  | 'ag_college'
  | 'music_college'
  | 'art_college'
  | 'law_center'
  | 'vet_school'
  | 'honors_college'
  | 'education_college'
  | 'masscomm_school'
  | 'rotc_armory'
  // Campus Life
  | 'dorm'
  | 'res_tower'
  | 'dining_hall'
  | 'poboy'
  | 'quad'
  | 'union'
  | 'rec_center'
  | 'parking'
  | 'campus_store'
  // Signature Venues & Decorations
  | 'concert_hall'
  | 'nat_museum'
  | 'tiger_statue'
  // Slice 4: College Town District (Unlocks at Campus Level 10)
  | 'town_center'
  | 'coffee_roaster'
  | 'music_club'
  | 'student_lofts'
  | 'boutique_hotel'
  | 'crawfish_house'
  // Utilities & Swamp Defense
  | 'substation'
  | 'water_tower'
  | 'generator'
  | 'levee'
  | 'floodwall'
  | 'canal'
  | 'pump'
  | 'pond'
  | 'preserve'
  | 'gator_fence'
  | 'abatement'
  | 'bat_house'
  | 'wildlife_post'
  | 'health_center'
  | 'surge_barrier'
  | 'rookery'
  // Athletics & Spirit
  | 'practice_field'
  | 'stadium'
  | 'arena'
  | 'tiger_habitat'
  // Nature
  | 'live_oak'
  | 'cypress'
  | 'azalea';

export interface BuildingDef {
  id: BuildingId;
  name: string;
  shortName: string;
  category: BuildingCategory;
  w: number;
  h: number;
  cost: number;
  upkeep: number; // per month
  drag?: boolean;
  isSurface?: boolean;
  isNature?: boolean;
  canPilings?: boolean;
  autoPilings?: boolean;
  needsPower?: boolean;
  needsWater?: boolean;
  windRating: number; // 1..5
  seats?: number;
  beds?: number;
  dining?: number;
  shelter?: number;
  landmark?: number;
  happiness?: number;
  happyRadius?: number;
  powerRadius?: number;
  powerCap?: number;
  waterRadius?: number;
  waterCap?: number;
  researchPerMonth?: number;
  incomePerMonth?: number;
  ecologyDelta?: number;
  programs?: string[]; // Academic departments / schools housed here
  unlockLevel?: number; // Campus Level required (e.g. 10 for College Town)
  description: string;
  accentColor: string;
  buildDays: number;
  maxTier?: number;
  tierNames?: string[];
  tierCosts?: number[];
  tierUpkeep?: number[];
  tierDesc?: string[];
}

export interface BuildingInstance {
  id: number;
  type: BuildingId;
  tx: number;
  ty: number;
  w: number;
  h: number;
  rot: 0 | 1 | 2 | 3;
  name: string;
  tier: number; // 0-based
  built: number; // 0..1
  hp: number; // 0..1
  pilings: boolean;
  powered: boolean;
  watered: boolean;
  blackout: boolean;
  flooded: boolean;
  boarded: boolean;
  fuelDays: number; // for generator
  seed: number;
  builtDay: number;
}

export interface VegInstance {
  id: number;
  kind: 'oak' | 'cypress' | 'azalea' | 'palmetto';
  tx: number;
  ty: number;
  scale: number;
  rot: number;
  planted: boolean;
}

export interface Agent {
  id: number;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  route: number[];
  routeIdx: number;
  goal: 'class' | 'dining' | 'home' | 'quad' | 'stadium' | 'flee' | 'shelter';
  targetTile: number;
  waitTicks: number;
  shirt: 'purple' | 'gold' | 'white' | 'lavender';
  hasUmbrella: boolean;
  wading: boolean;
  phaseOffset: number;
}

export interface Gator {
  id: number;
  name: string;
  x: number;
  y: number;
  angle: number;
  state: 'sun' | 'swim' | 'wander' | 'retreat';
  homeTile: number;
  targetX: number;
  targetY: number;
  timer: number;
  size: number;
}

export interface Pirogue {
  id: number;
  splinePos: number;
  direction: 1 | -1;
  passengers: number;
  delivered: boolean;
  cajunNavy?: boolean;
}

export interface ServiceVehicle {
  id: number;
  kind: 'fogger' | 'officer' | 'parade_float' | 'shuttle';
  x: number;
  y: number;
  angle: number;
  targetX: number;
  targetY: number;
  prevTile?: number;
  timer: number;
  active: boolean;
  floatIndex?: number; // 0..2 for Mardi Gras floats
}

export interface MardiGrasState {
  active: boolean;
  tick: number;
  duration: number;
  route: number[]; // tile indices along campus road
  revenue: number;
}

export interface DilemmaChoice {
  label: string;
  effectText: string;
  cashDelta?: number;
  prestigeDelta?: number;
  happinessDelta?: number;
  ecologyDelta?: number;
  grantInsurance?: boolean;
  repairLevees?: boolean;
}

export interface DilemmaCard {
  id: string;
  source: 'Board of Regents' | 'Student Voice';
  title: string;
  body: string;
  choices: DilemmaChoice[];
}

export type StormPhase = 'none' | 'cone' | 'bands' | 'eyewall' | 'eye' | 'backwall' | 'clearing';

export interface DecisionToast {
  id: string;
  title: string;
  body: string;
  yesLabel: string;
  noLabel: string;
  yesCost?: number;
  ticksLeft: number;
  maxTicks: number;
  kind: 'storm' | 'football' | 'campus';
}

export interface StormReport {
  name: string;
  category: number;
  peakSurgeFt: number;
  floodedCount: number;
  protectedTiles: number;
  damageCost: number;
  blackoutOccurred: boolean;
  held: boolean;
}

export interface StormState {
  active: boolean;
  name: string;
  category: number;
  phase: StormPhase;
  tick: number;
  duration: number;
  targetSurgeFt: number;
  currentSurgeFt: number;
  windIntensity: number;
  rainRate: number;
  lightningFlash: number;
  sandbagged: boolean;
  sheltered: boolean;
  toastsFired: Record<string, boolean>;
  lastReport: StormReport | null;
}

export interface FootballPlay {
  quarter: number;
  clock: string;
  text: string;
  scoring: 'home' | 'away' | 'none';
}

export interface FootballGameState {
  active: boolean;
  opponent: string;
  opponentColor: string;
  nightGame: boolean;
  tick: number;
  duration: number;
  quarter: 1 | 2 | 3 | 4;
  homeScore: number;
  awayScore: number;
  attendance: number;
  capacity: number;
  winProb: number;
  halftimeAsked: boolean;
  aggressiveCall: boolean;
  playLog: FootballPlay[];
  fireworkBurstTick: number;
  shakeTrigger: number;
  finished: boolean;
  revenue: number;
}

export interface GoalStep {
  label: string;
  done: boolean;
  buildHint?: BuildingId;
}

export interface GoalDef {
  id: string;
  title: string;
  subtitle: string;
  rewardCash: number;
  rewardPrestige: number;
  buildHint?: BuildingId;
  steps?: GoalStep[];
  completed: boolean;
  progressText: string;
  progressFrac: number;
}

export interface TickerItem {
  id: number;
  day: number;
  text: string;
  kind: 'info' | 'water' | 'sports' | 'wildlife' | 'danger' | 'money';
}

export interface SimEvent {
  type:
    | 'place'
    | 'demolish'
    | 'upgrade'
    | 'touchdown'
    | 'kickoff'
    | 'game_win'
    | 'game_loss'
    | 'lightning'
    | 'bell_chime'
    | 'gator_alert'
    | 'goal_complete'
    | 'storm_warn'
    | 'blackout'
    | 'toast'
    | 'parade_start'
    | 'dilemma'
    | 'nutria_burrow';
  x?: number;
  y?: number;
  intensity?: number;
  text?: string;
}

export interface EconomyState {
  cash: number;
  students: number;
  alumni: number;
  prestige: number;
  happiness: number;
  ecology: number;
  capacity: {
    beds: number;
    seats: number;
    dining: number;
  };
  breakdown: {
    tuition: number;
    state: number;
    alumni: number;
    research: number;
    venues: number;
    upkeep: number;
    staff: number;
  };
  collegesFounded: number;
  activePrograms: number;
  monthlyIncome: number;
  monthlyExpense: number;
  lastNet: number;
  wins: number;
  losses: number;
  teamRating: number;
  xp: number;
  campusLevel: number;
}

export interface TileGrid {
  elev: Float32Array;
  depth: Float32Array;
  sat: Float32Array;
  crest: Float32Array;
  integrity: Uint8Array;
  surface: Uint8Array;
  type: Uint8Array;
  flags: Uint16Array;
  owner: Int16Array;
  risk: Float32Array;
  mosq: Float32Array; // 0..1 mosquito breeding density
}

export interface PlotInfo {
  foundersTx: number;
  foundersTy: number;
  landingTx: number;
  landingTy: number;
  bayouSpline: number[];
  chenierCenter: { tx: number; ty: number };
}

export interface GameState {
  seed: number;
  tick: number;
  day: number;
  dayTick: number;
  year: number;
  month: number;
  dom: number;
  season: Season;
  skyTick: number;
  skyPhase: SkyPhase;
  skyProgress: number;
  speed: 0 | 1 | 2 | 4;
  tiles: TileGrid;
  plot: PlotInfo;
  buildings: (BuildingInstance | null)[];
  veg: VegInstance[];
  agents: Agent[];
  gators: Gator[];
  pirogues: Pirogue[];
  vehicles: ServiceVehicle[];
  economy: EconomyState;
  storm: StormState;
  football: FootballGameState;
  parade: MardiGrasState;
  activeDilemma: DilemmaCard | null;
  stormInsurance: boolean;
  mosquitoIndex: number; // 0..100 campus average
  gatorRelocations: number;
  nutriaBurrows: number;
  spoonbillCount: number;
  ownedParcels: boolean[]; // 4x4 grid of 16x16 tile parcels
  collegeTownUnlocked: boolean;
  levelUpToast: { level: number; unlockedTown: boolean; ticksLeft: number } | null;
  goals: GoalDef[];
  activeGoalIdx: number;
  activeToast: DecisionToast | null;
  ticker: TickerItem[];
  overlay: OverlayMode;
  rainRate: number;
  windStrength: number;
  riverStage: number;
  bayouStage: number;
  protectedCount: number;
  leveeGaps: number[];
  terrainDirty: boolean;
  buildingsDirty: boolean;
  vegDirty: boolean;
  waterDirty: boolean;
  showcaseMode: boolean;
}
