import bellTowerUrl from '../assets/sprites/bell_tower.png';
import bellTowerGlowUrl from '../assets/sprites/bell_tower_glow.png';
import collegeBlueUrl from '../assets/sprites/college_blue.png';
import collegeBlueGlowUrl from '../assets/sprites/college_blue_glow.png';
import collegeHallUrl from '../assets/sprites/college_hall.png';
import collegeHallGlowUrl from '../assets/sprites/college_hall_glow.png';
import collegePurpleUrl from '../assets/sprites/college_purple.png';
import collegePurpleGlowUrl from '../assets/sprites/college_purple_glow.png';
import collegeTealUrl from '../assets/sprites/college_teal.png';
import collegeTealGlowUrl from '../assets/sprites/college_teal_glow.png';
import dormBrickUrl from '../assets/sprites/dorm_brick.png';
import dormBrickGlowUrl from '../assets/sprites/dorm_brick_glow.png';
import foundersHallUrl from '../assets/sprites/founders_hall.png';
import foundersHallGlowUrl from '../assets/sprites/founders_hall_glow.png';
import libraryUrl from '../assets/sprites/library.png';
import libraryGlowUrl from '../assets/sprites/library_glow.png';
import stadiumUrl from '../assets/sprites/stadium.png';
import stadiumGlowUrl from '../assets/sprites/stadium_glow.png';
import unionHallUrl from '../assets/sprites/union_hall.png';
import unionHallGlowUrl from '../assets/sprites/union_hall_glow.png';
import { BuildingId } from '../sim/types';

export type SpriteKey =
  | 'bell_tower'
  | 'founders_hall'
  | 'union_hall'
  | 'library'
  | 'stadium'
  | 'college_hall'
  | 'college_blue'
  | 'college_purple'
  | 'college_teal'
  | 'dorm_brick';

export interface LoadedBuildingSprite {
  img: HTMLImageElement;
  glowImg: HTMLImageElement;
  loaded: boolean;
  glowLoaded: boolean;
}

const URLS: Record<SpriteKey, { day: string; glow: string }> = {
  bell_tower: { day: bellTowerUrl, glow: bellTowerGlowUrl },
  founders_hall: { day: foundersHallUrl, glow: foundersHallGlowUrl },
  union_hall: { day: unionHallUrl, glow: unionHallGlowUrl },
  library: { day: libraryUrl, glow: libraryGlowUrl },
  stadium: { day: stadiumUrl, glow: stadiumGlowUrl },
  college_hall: { day: collegeHallUrl, glow: collegeHallGlowUrl },
  college_blue: { day: collegeBlueUrl, glow: collegeBlueGlowUrl },
  college_purple: { day: collegePurpleUrl, glow: collegePurpleGlowUrl },
  college_teal: { day: collegeTealUrl, glow: collegeTealGlowUrl },
  dorm_brick: { day: dormBrickUrl, glow: dormBrickGlowUrl },
};

const SPRITES: Partial<Record<SpriteKey, LoadedBuildingSprite>> = {};

export function initSpriteAtlas(): void {
  if (typeof Image === 'undefined') return;
  for (const key of Object.keys(URLS) as SpriteKey[]) {
    if (SPRITES[key]) continue;
    const img = new Image();
    const glowImg = new Image();
    const entry: LoadedBuildingSprite = { img, glowImg, loaded: false, glowLoaded: false };
    img.onload = () => {
      entry.loaded = true;
    };
    glowImg.onload = () => {
      entry.glowLoaded = true;
    };
    img.src = URLS[key].day;
    glowImg.src = URLS[key].glow;
    SPRITES[key] = entry;
  }
}

export function getHeroSprite(key: SpriteKey): HTMLImageElement | null {
  if (!SPRITES[key]) initSpriteAtlas();
  const entry = SPRITES[key];
  return entry && entry.loaded && entry.img.naturalWidth > 0 ? entry.img : null;
}

export function getHeroGlowSprite(key: SpriteKey): HTMLImageElement | null {
  if (!SPRITES[key]) initSpriteAtlas();
  const entry = SPRITES[key];
  return entry && entry.glowLoaded && entry.glowImg.naturalWidth > 0 ? entry.glowImg : null;
}

export interface HeroSpriteSpec {
  key: SpriteKey;
  widthFactor: number;
  footSinkPx: number;
  rooftopAccent?: 'observatory' | 'antenna' | 'flag' | 'health_cross' | 'neon';
}

export function getHeroSpriteSpec(type: BuildingId, tier: number): HeroSpriteSpec | null {
  switch (type) {
    case 'bell_tower':
      return { key: 'bell_tower', widthFactor: 1.06, footSinkPx: 14 };
    case 'founders_hall':
      return { key: 'founders_hall', widthFactor: 1.08, footSinkPx: 6, rooftopAccent: 'flag' };
    case 'library':
      return {
        key: tier >= 1 ? 'library' : 'founders_hall',
        widthFactor: 1.12,
        footSinkPx: 8,
      };
    case 'stadium':
      return { key: 'stadium', widthFactor: 1.14, footSinkPx: 12 };

    case 'lecture_hall':
    case 'humanities_college':
    case 'law_center':
    case 'honors_college':
    case 'nat_museum':
      return { key: 'college_hall', widthFactor: 1.04, footSinkPx: 6 };

    case 'engineering':
      return { key: 'college_blue', widthFactor: 1.05, footSinkPx: 6 };
    case 'science_college':
      return { key: 'college_blue', widthFactor: 1.05, footSinkPx: 6, rooftopAccent: 'observatory' };
    case 'masscomm_school':
      return { key: 'college_blue', widthFactor: 1.04, footSinkPx: 6, rooftopAccent: 'antenna' };

    case 'coastal_institute':
    case 'wildlife_post':
      return { key: 'college_teal', widthFactor: 1.05, footSinkPx: 6 };
    case 'health_center':
      return { key: 'college_teal', widthFactor: 1.04, footSinkPx: 6, rooftopAccent: 'health_cross' };

    case 'union':
    case 'concert_hall':
    case 'boutique_hotel':
      return { key: 'union_hall', widthFactor: 1.08, footSinkPx: 6 };
    case 'business_college':
    case 'music_college':
    case 'art_college':
    case 'campus_store':
    case 'town_center':
      return { key: 'college_purple', widthFactor: 1.05, footSinkPx: 6 };
    case 'music_club':
      return { key: 'college_purple', widthFactor: 1.02, footSinkPx: 6, rooftopAccent: 'neon' };

    case 'dorm':
    case 'res_tower':
    case 'student_lofts':
    case 'ag_college':
    case 'vet_school':
    case 'education_college':
    case 'rotc_armory':
    case 'dining_hall':
    case 'poboy':
    case 'coffee_roaster':
    case 'crawfish_house':
      return { key: 'dorm_brick', widthFactor: 1.04, footSinkPx: 6 };

    default:
      return null;
  }
}
