import bellTowerUrl from '../assets/sprites/bell_tower.png';
import collegeBlueUrl from '../assets/sprites/college_blue.png';
import collegeHallUrl from '../assets/sprites/college_hall.png';
import collegePurpleUrl from '../assets/sprites/college_purple.png';
import collegeTealUrl from '../assets/sprites/college_teal.png';
import dormBrickUrl from '../assets/sprites/dorm_brick.png';
import foundersHallUrl from '../assets/sprites/founders_hall.png';
import libraryUrl from '../assets/sprites/library.png';
import stadiumUrl from '../assets/sprites/stadium.png';
import unionHallUrl from '../assets/sprites/union_hall.png';
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
  loaded: boolean;
}

const URLS: Record<SpriteKey, string> = {
  bell_tower: bellTowerUrl,
  founders_hall: foundersHallUrl,
  union_hall: unionHallUrl,
  library: libraryUrl,
  stadium: stadiumUrl,
  college_hall: collegeHallUrl,
  college_blue: collegeBlueUrl,
  college_purple: collegePurpleUrl,
  college_teal: collegeTealUrl,
  dorm_brick: dormBrickUrl,
};

const SPRITES: Partial<Record<SpriteKey, LoadedBuildingSprite>> = {};

export function initSpriteAtlas(): void {
  if (typeof Image === 'undefined') return;
  for (const key of Object.keys(URLS) as SpriteKey[]) {
    if (SPRITES[key]) continue;
    const img = new Image();
    const entry: LoadedBuildingSprite = { img, loaded: false };
    img.onload = () => {
      entry.loaded = true;
    };
    img.src = URLS[key];
    SPRITES[key] = entry;
  }
}

export function getHeroSprite(key: SpriteKey): HTMLImageElement | null {
  if (!SPRITES[key]) initSpriteAtlas();
  const entry = SPRITES[key];
  return entry && entry.loaded && entry.img.naturalWidth > 0 ? entry.img : null;
}

export interface HeroSpriteSpec {
  key: SpriteKey;
  /** Target width multiplier relative to the isometric footprint width `(w + h) * 32` */
  widthFactor: number;
  /** Vertical shift of bottom anchor relative to footprint south tip */
  footSinkPx: number;
  /** Optional small rooftop badge drawn after sprite */
  rooftopAccent?: 'observatory' | 'antenna' | 'flag' | 'health_cross' | 'neon';
}

/**
 * Maps Bayou State buildings to our museum-grade 16-bit pixel-art PNG sprites.
 * Specialized open-air/utility buildings (water tower, arena, rec center w/ pool,
 * practice field, tiger habitat, surge barrier, rookery, pond) stay bespoke procedural pixel art.
 */
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

    // Classic LSU Renaissance Revival Terracotta Colleges
    case 'lecture_hall':
    case 'humanities_college':
    case 'law_center':
    case 'honors_college':
    case 'nat_museum':
      return { key: 'college_hall', widthFactor: 1.04, footSinkPx: 6 };

    // Slate-Blue Roofed STEM / Observatory / Media Colleges
    case 'engineering':
      return { key: 'college_blue', widthFactor: 1.05, footSinkPx: 6 };
    case 'science_college':
      return { key: 'college_blue', widthFactor: 1.05, footSinkPx: 6, rooftopAccent: 'observatory' };
    case 'masscomm_school':
      return { key: 'college_blue', widthFactor: 1.04, footSinkPx: 6, rooftopAccent: 'antenna' };

    // Bayou Copper-Teal Roofed Coastal & Health Colleges
    case 'coastal_institute':
    case 'wildlife_post':
      return { key: 'college_teal', widthFactor: 1.05, footSinkPx: 6 };
    case 'health_center':
      return { key: 'college_teal', widthFactor: 1.04, footSinkPx: 6, rooftopAccent: 'health_cross' };

    // Royal Purple Roofed Commons, Business, Arts & College Town Flagships
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

    // Warm Rose-Terracotta Brick Dorms, Ag, Vet, Education & College Town Lofts
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
