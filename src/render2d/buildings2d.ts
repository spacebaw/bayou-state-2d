import { CATALOG } from '../sim/catalog';
import { BuildingId, BuildingInstance, GameState, VegInstance } from '../sim/types';
import { footprintCorners } from './iso';
import {
  bayer4,
  CachedSprite,
  drawPxDome,
  drawPxHippedRoof,
  drawPxPrism,
  hash2,
  hexToRGBA,
  PAL,
  PixelBuffer,
  pxFootprint,
  RGBA,
  shadeRGBA,
} from './pixel';
import { getHeroGlowSprite, getHeroSprite, getHeroSpriteSpec, initSpriteAtlas } from './sprites';

initSpriteAtlas();

export interface LightGlow {
  x: number;
  y: number;
  r: number;
  color: string;
  alpha: number;
}

// ===== SPRITE CACHES (ZERO PER-FRAME RASTERIZATION!) =====
const buildingCache = new Map<string, CachedSprite>();
const treeCache = new Map<string, CachedSprite>();
const entityCache = new Map<string, CachedSprite>();

function drawPxField(
  pb: PixelBuffer,
  cx: number,
  baseY: number,
  wTiles: number,
  hTiles: number,
): void {
  const c = pxFootprint(cx, baseY, wTiles, hTiles, 0.04);
  pb.fillPoly([c.n, c.e, c.s, c.w], (x, y) => {
    const stripe = Math.floor(((x - cx) * 0.14 + (y - baseY) * 0.28) + 20) & 1;
    return stripe ? PAL.grassHi : PAL.grassLit;
  });

  const lerpPt = (a: [number, number], b: [number, number], t: number): [number, number] => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ];
  const ez1A = lerpPt(c.n, c.e, 0.15);
  const ez1B = lerpPt(c.w, c.s, 0.15);
  pb.fillPoly([c.n, ez1A, ez1B, c.w], PAL.purpleLit);

  const ez2A = lerpPt(c.n, c.e, 0.85);
  const ez2B = lerpPt(c.w, c.s, 0.85);
  pb.fillPoly([ez2A, c.e, c.s, ez2B], PAL.goldLit);

  for (let k = 2; k <= 8; k++) {
    const t = k / 10;
    const p1 = lerpPt(c.n, c.e, t);
    const p2 = lerpPt(c.w, c.s, t);
    pb.line(p1[0], p1[1], p2[0], p2[1], PAL.stuccoHi);
  }
  pb.fillEllipse(cx, baseY, Math.max(4, wTiles * 2.1), Math.max(2, wTiles * 1.1), PAL.goldHi);
  pb.fillEllipse(cx, baseY, Math.max(2, wTiles * 1.2), Math.max(1, wTiles * 0.6), PAL.purpleLit);
  pb.strokePoly([c.n, c.e, c.s, c.w], PAL.stuccoHi);

  const g1 = lerpPt(c.n, c.w, 0.5);
  const g2 = lerpPt(c.e, c.s, 0.5);
  for (const g of [g1, g2]) {
    pb.line(g[0], g[1], g[0], g[1] - 7, PAL.goldHi);
    pb.hline(g[0] - 3, g[0] + 3, g[1] - 7, PAL.goldHi);
    pb.line(g[0] - 3, g[1] - 7, g[0] - 3, g[1] - 12, PAL.goldHi);
    pb.line(g[0] + 3, g[1] - 7, g[0] + 3, g[1] - 12, PAL.goldHi);
  }
}

/**
 * Rasterizes a single handcrafted 16-bit outlined pixel-art building sprite once and caches it.
 */
function getBuildingSprite(
  type: BuildingId,
  w: number,
  h: number,
  tier: number,
  onPilings: boolean,
  nightLit: boolean,
  underConstruction: boolean,
  flooded: boolean,
): CachedSprite {
  const key = `${type}|${w}x${h}|t${tier}|p${onPilings ? 1 : 0}|n${nightLit ? 1 : 0}|c${underConstruction ? 1 : 0}|f${flooded ? 1 : 0}`;
  const hit = buildingCache.get(key);
  if (hit) return hit;

  const span = Math.max(w, h);
  const tallBonus = type === 'bell_tower' || type === 'masscomm_school' || type === 'stadium' || type === 'res_tower' ? 46 : 0;
  const canvasW = Math.ceil((w + h) * 32 + 76);
  const canvasH = Math.ceil((w + h) * 16 + 150 + tallBonus);
  const anchorX = Math.floor(canvasW * 0.5);
  const anchorY = canvasH - Math.ceil((w + h) * 8 + 18);

  const pb = new PixelBuffer(canvasW, canvasH);
  const cx = anchorX;
  const baseY = onPilings ? anchorY - 12 : anchorY;

  // Timber Pilings / Stilts (+6 ft flood immunity!)
  if (onPilings) {
    const pC = pxFootprint(cx, anchorY, w, h, 0.14);
    const pilings: [number, number][] = [
      pC.n,
      pC.e,
      pC.s,
      pC.w,
      [(pC.w[0] + pC.s[0]) * 0.5, (pC.w[1] + pC.s[1]) * 0.5],
      [(pC.s[0] + pC.e[0]) * 0.5, (pC.s[1] + pC.e[1]) * 0.5],
    ];
    for (const [px0, py0] of pilings) {
      pb.rect(px0 - 2, py0 - 13, 3, 14, PAL.woodLit);
      pb.line(px0 + 1, py0 - 13, px0 + 1, py0, PAL.woodDark);
    }
    pb.line(pC.w[0], pC.w[1] - 4, pC.s[0], pC.s[1] - 10, PAL.woodShade);
    pb.line(pC.s[0], pC.s[1] - 4, pC.e[0], pC.e[1] - 10, PAL.woodShade);
    drawPxPrism(pb, cx, anchorY - 9, w, h, 4, '#9e7044', '#b88858', { inset: 0.06, cornice: false });
  }

  // Under Construction Pixel Timber Scaffolding!
  if (underConstruction) {
    drawPxPrism(pb, cx, baseY, w, h, 8, '#c2ad88', '#d9c8a4', { inset: 0.08, cornice: false });
    const sc = pxFootprint(cx, baseY - 8, w, h, 0.14);
    for (const pt of [sc.n, sc.e, sc.s, sc.w]) {
      pb.rect(pt[0] - 1, pt[1] - 20, 2, 20, PAL.woodLit);
    }
    pb.line(sc.w[0], sc.w[1] - 10, sc.s[0], sc.s[1] - 10, PAL.woodHi);
    pb.line(sc.s[0], sc.s[1] - 10, sc.e[0], sc.e[1] - 10, PAL.woodLit);
    pb.line(sc.w[0], sc.w[1] - 19, sc.s[0], sc.s[1] - 19, PAL.goldLit);
    pb.line(sc.s[0], sc.s[1] - 19, sc.e[0], sc.e[1] - 19, PAL.goldMid);
    pb.applyOutline(PAL.outline);
    const sp = pb.toSprite(anchorX, anchorY);
    buildingCache.set(key, sp);
    return sp;
  }

  const stucco = '#f0dcb4';
  const warmStone = '#f5e7c6';
  const terra = '#d95e38';
  const darkTerra = '#b5432a';
  const spec = CATALOG[type];

  switch (type) {
    case 'founders_hall': {
      drawPxPrism(pb, cx, baseY, w, h, 26, stucco, '#c8603a', {
        windows: true,
        arches: true,
        nightLit,
      });
      drawPxHippedRoof(pb, cx, baseY - 26, w, h, 16, terra, 0.01);
      drawPxPrism(pb, cx, baseY - 2, w * 0.44, h * 0.88, 29, warmStone, terra, {
        windows: true,
        arches: true,
        nightLit,
      });
      drawPxHippedRoof(pb, cx, baseY - 31, w * 0.48, h * 0.90, 12, '#e66c42', 0.0);
      pb.rect(cx - 2, baseY - 46, 5, 5, PAL.stuccoHi);
      pb.line(cx, baseY - 56, cx, baseY - 46, PAL.goldHi);
      pb.rect(cx + 1, baseY - 55, 6, 4, PAL.purpleLit);
      pb.hline(cx + 1, cx + 6, baseY - 53, PAL.goldHi);
      break;
    }

    case 'bell_tower': {
      drawPxPrism(pb, cx, baseY, 1.38, 1.38, 7, '#e2d2b0', '#f0e2c2', { inset: 0.02 });
      drawPxPrism(pb, cx, baseY - 7, 0.78, 0.78, 54, warmStone, '#e8d8b6', { inset: 0.04, cornice: true });
      for (const ox of [-7, -3, 3, 7]) {
        pb.line(cx + ox, baseY - 55, cx + ox, baseY - 14, ox < 0 ? PAL.stuccoMid : PAL.stuccoDark);
      }
      // Twin outlined golden clock faces on SW and SE upper faces!
      pb.fillEllipse(cx - 6, baseY - 48, 5, 6, PAL.outline);
      pb.fillEllipse(cx - 6, baseY - 48, 4, 5, PAL.goldHi);
      pb.line(cx - 6, baseY - 48, cx - 6, baseY - 51, PAL.outline);
      pb.line(cx - 6, baseY - 48, cx - 4, baseY - 48, PAL.outline);
      pb.fillEllipse(cx + 6, baseY - 48, 5, 6, PAL.outline);
      pb.fillEllipse(cx + 6, baseY - 48, 4, 5, PAL.stuccoLit);
      pb.line(cx + 6, baseY - 48, cx + 6, baseY - 51, PAL.outline);
      // Open arched belfry gallery
      drawPxPrism(pb, cx, baseY - 61, 0.72, 0.72, 13, '#f7eccf', '#d95e38', { inset: 0.04 });
      pb.rect(cx - 8, baseY - 71, 4, 7, nightLit ? PAL.winNight : PAL.archDark);
      pb.rect(cx - 2, baseY - 70, 3, 7, nightLit ? PAL.winNight : PAL.archDark);
      pb.rect(cx + 4, baseY - 71, 4, 7, nightLit ? PAL.winNight : PAL.archDark);
      // Ribbed pyramidal terracotta spire!
      const spTop: [number, number] = [cx, baseY - 96];
      const spC = pxFootprint(cx, baseY - 74, 0.84, 0.84, 0.0);
      pb.fillPoly([spC.w, spC.s, spTop], (x, y) => ((x + y) % 3 === 0 ? PAL.terraHi : PAL.terraLit));
      pb.fillPoly([spC.s, spC.e, spTop], (x, y) => ((x - y) % 3 === 0 ? PAL.terraShade : PAL.terraMid));
      pb.line(spC.s[0], spC.s[1], spTop[0], spTop[1], PAL.terraDark);
      pb.line(cx, baseY - 103, cx, baseY - 96, PAL.goldHi);
      // Flanking cypress shrubs!
      for (const sx of [-14, 14]) {
        pb.fillEllipse(cx + sx, baseY - 6, 3, 7, PAL.grassShade);
        pb.fillEllipse(cx + sx - 1, baseY - 8, 2, 5, PAL.grassLit);
      }
      break;
    }

    case 'library': {
      const bh = tier >= 2 ? 32 : tier === 1 ? 26 : 20;
      drawPxPrism(pb, cx, baseY, w, h, bh, warmStone, terra, {
        windows: true,
        arches: true,
        nightLit,
      });
      drawPxHippedRoof(pb, cx, baseY - bh, w, h, 12, terra, 0.02);
      if (tier >= 1) {
        drawPxPrism(pb, cx, baseY - bh - 3, w * 0.50, h * 0.50, 12, warmStone, '#e8d7b2', {
          windows: true,
          nightLit,
          inset: 0.04,
        });
        drawPxDome(
          pb,
          cx,
          baseY - bh - 15,
          tier >= 2 ? 23 : 18,
          tier >= 2 ? 19 : 14,
          tier >= 2 ? '#f7c21b' : '#e6a825',
          true,
        );
      }
      break;
    }

    case 'lecture_hall':
    case 'engineering':
    case 'coastal_institute':
    case 'business_college':
    case 'humanities_college':
    case 'law_center':
    case 'music_college':
    case 'art_college':
    case 'education_college':
    case 'honors_college':
    case 'rotc_armory':
    case 'health_center':
    case 'wildlife_post': {
      const roofMap: Partial<Record<BuildingId, string>> = {
        engineering: '#5e768f',
        coastal_institute: '#32828a',
        business_college: '#6d5e94',
        law_center: '#8c3b36',
        music_college: '#a34474',
        art_college: '#c45e78',
        honors_college: '#c98e26',
        rotc_armory: '#5e6b54',
        health_center: '#2e8c78',
        wildlife_post: '#4c7a3e',
      };
      const wallMap: Partial<Record<BuildingId, string>> = {
        engineering: '#e4dfd0',
        business_college: '#e8e2d8',
        health_center: '#eef4f0',
      };
      const rHex = roofMap[type] ?? terra;
      const wHex = wallMap[type] ?? stucco;
      const bh = type === 'business_college' || type === 'law_center' || type === 'engineering' ? 25 : 21;
      drawPxPrism(pb, cx, baseY, w, h, bh, wHex, rHex, {
        windows: true,
        arches: type === 'law_center' || type === 'honors_college' || type === 'humanities_college' || type === 'lecture_hall',
        nightLit,
        brickTex: type === 'education_college' || type === 'rotc_armory',
      });
      drawPxHippedRoof(pb, cx, baseY - bh, w, h, 13, rHex, 0.01);

      if (type === 'coastal_institute') {
        drawPxPrism(pb, cx, baseY - bh - 6, 0.9, 0.7, 7, '#58c8d8', '#8cf0f5', { inset: 0.05 });
      } else if (type === 'law_center' || type === 'honors_college') {
        drawPxDome(pb, cx, baseY - bh - 12, 11, 9, type === 'honors_college' ? '#f7c21b' : '#c9bca2', true);
      } else if (type === 'health_center') {
        pb.rect(cx - 2, baseY - bh - 11, 5, 11, PAL.stuccoHi);
        pb.rect(cx - 5, baseY - bh - 8, 11, 5, PAL.stuccoHi);
        pb.rect(cx - 1, baseY - bh - 10, 3, 9, hexToRGBA('#d93838'));
        pb.rect(cx - 4, baseY - bh - 7, 9, 3, hexToRGBA('#d93838'));
      }
      break;
    }

    case 'science_college': {
      drawPxPrism(pb, cx, baseY, w, h, 24, '#e6e8ec', '#4b688a', { windows: true, nightLit });
      drawPxHippedRoof(pb, cx, baseY - 24, w, h, 11, '#4b688a', 0.02);
      // Astronomical Observatory Dome with telescope slit!
      drawPxDome(pb, cx + 4, baseY - 32, 14, 12, '#f5f2e8', false);
      pb.rect(cx + 2, baseY - 43, 4, 10, PAL.archDark);
      pb.line(cx + 4, baseY - 40, cx + 10, baseY - 46, PAL.stoneMid);
      break;
    }

    case 'ag_college': {
      drawPxPrism(pb, cx - 12, baseY + 5, w * 0.56, h * 0.85, 18, '#cf6f4a', darkTerra, {
        windows: true,
        nightLit,
        brickTex: true,
      });
      drawPxHippedRoof(pb, cx - 12, baseY - 13, w * 0.56, h * 0.85, 10, darkTerra, 0.02);
      drawPxPrism(pb, cx + 14, baseY - 5, w * 0.44, h * 0.78, 14, '#8ee8db', '#baf7ed', { inset: 0.05 });
      drawPxHippedRoof(pb, cx + 14, baseY - 19, w * 0.44, h * 0.78, 8, '#66d4c4', 0.03);
      break;
    }

    case 'vet_school': {
      drawPxPrism(pb, cx, baseY, w, h, 20, '#c7523a', '#6b2822', {
        windows: true,
        nightLit,
        brickTex: true,
      });
      drawPxHippedRoof(pb, cx, baseY - 20, w, h, 14, '#5c4b47', 0.01);
      pb.rect(cx - 12, baseY - 9, 8, 9, PAL.stuccoHi);
      pb.rect(cx - 11, baseY - 8, 6, 7, hexToRGBA('#a83a28'));
      pb.line(cx - 11, baseY - 8, cx - 6, baseY - 2, PAL.stuccoHi);
      pb.line(cx - 6, baseY - 8, cx - 11, baseY - 2, PAL.stuccoHi);
      break;
    }

    case 'masscomm_school': {
      drawPxPrism(pb, cx, baseY, w, h, 22, '#e2ded2', '#4c596b', { windows: true, nightLit });
      drawPxHippedRoof(pb, cx, baseY - 22, w, h, 9, '#4c596b', 0.03);
      for (let sy = 0; sy < 34; sy += 6) {
        const col = (sy / 6) % 2 === 0 ? hexToRGBA('#e83838') : PAL.stuccoHi;
        pb.rect(cx - 1, baseY - 31 - sy - 6, 3, 6, col);
      }
      pb.rect(cx - 2, baseY - 68, 5, 3, hexToRGBA('#ff3b4e'));
      break;
    }

    case 'dorm':
    case 'res_tower': {
      const baseH = type === 'res_tower' ? 42 : 20;
      const bh = baseH + tier * 10;
      drawPxPrism(pb, cx, baseY, w, h, bh, '#db9f76', darkTerra, {
        windows: true,
        arches: tier >= 1 || type === 'res_tower',
        nightLit,
        brickTex: true,
      });
      drawPxHippedRoof(pb, cx, baseY - bh, w, h, 12, darkTerra, 0.01);
      break;
    }

    case 'dining_hall':
    case 'poboy':
    case 'campus_store': {
      const bh = type === 'dining_hall' ? 19 + tier * 5 : 16;
      const wallC = type === 'poboy' ? '#f5d2a4' : type === 'campus_store' ? '#ede4f5' : '#f2d9aa';
      const roofC = type === 'campus_store' ? '#6128a8' : '#d96338';
      drawPxPrism(pb, cx, baseY, w, h, bh, wallC, roofC, {
        windows: true,
        arches: type === 'dining_hall',
        nightLit,
      });
      drawPxHippedRoof(pb, cx, baseY - bh, w, h, 10, roofC, 0.01);
      for (let k = -8; k <= 8; k += 4) {
        pb.rect(cx - 12 + k, baseY - 6 + Math.round(k * 0.4), 3, 4, (k / 4) % 2 === 0 ? PAL.purpleLit : PAL.goldLit);
      }
      break;
    }

    case 'union': {
      const bh = tier >= 1 ? 28 : 22;
      drawPxPrism(pb, cx, baseY, w, h, bh, warmStone, '#461d7c', {
        windows: true,
        arches: true,
        nightLit,
      });
      drawPxHippedRoof(pb, cx, baseY - bh, w, h, 12, '#6934ad', 0.02);
      drawPxPrism(pb, cx, baseY - bh - 5, w * 0.38, h * 0.38, 8, '#f7c21b', '#ffe066', { inset: 0.05 });
      break;
    }

    case 'rec_center': {
      // Grand LSU Natatorium Pavilion + Sunlit Olympic Swimming Pool & Striped Patio Umbrellas!
      drawPxPrism(pb, cx - 14, baseY - 5, w * 0.56, h * 0.90, 24, warmStone, '#3d72a8', {
        windows: true,
        arches: true,
        nightLit,
      });
      drawPxHippedRoof(pb, cx - 14, baseY - 29, w * 0.56, h * 0.90, 12, '#3d72a8', 0.01);
      // Warm cream limestone pool terrace + coping border
      const pDeck = pxFootprint(cx + 18, baseY + 8, w * 0.48, h * 0.80, 0.03);
      pb.fillPoly([pDeck.n, pDeck.e, pDeck.s, pDeck.w], (x, y) => ((x + y) % 5 === 0 ? PAL.stoneMid : PAL.stoneHi));
      pb.strokePoly([pDeck.n, pDeck.e, pDeck.s, pDeck.w], PAL.outlineSoft);
      // Sparkling turquoise Olympic pool with lane lines!
      const pWat = pxFootprint(cx + 18, baseY + 8, w * 0.36, h * 0.60, 0.05);
      pb.fillPoly([pWat.n, pWat.e, pWat.s, pWat.w], (x, y) => {
        if ((x - y * 2) % 9 === 0) return PAL.waterSpark;
        return bayer4(x, y) > 0.65 ? PAL.waterHi : PAL.waterMid;
      });
      pb.strokePoly([pWat.n, pWat.e, pWat.s, pWat.w], PAL.waterAbyss);
      // Cheerful LSU Purple & Gold striped poolside umbrellas!
      for (const [ux, uy] of [[cx + 2, baseY + 14], [cx + 24, baseY - 4]] as [number, number][]) {
        pb.line(ux, uy, ux, uy - 9, PAL.woodDark);
        pb.fillEllipse(ux, uy - 9, 6, 4, (x, _y) => ((x - ux) & 2 ? PAL.purpleLit : PAL.goldHi));
      }
      break;
    }

    case 'parking': {
      // LSU Italian Renaissance Revival Architectural Parking Garage (arched cream limestone + stairwell tower!)
      const floors = tier >= 2 ? 4 : tier === 1 ? 3 : 2;
      const bh = floors * 10 + 4;
      drawPxPrism(pb, cx, baseY, w, h, bh, warmStone, '#b8b0a2', { inset: 0.05, arches: true, cornice: true });
      const bot = pxFootprint(cx, baseY, w, h, 0.05);
      const carColors = [PAL.purpleLit, PAL.goldLit, hexToRGBA('#d9483b'), hexToRGBA('#3b88c9')];
      for (let fl = 1; fl <= floors; fl++) {
        const dy = fl * 10 - 2;
        // Shaded open concrete parking bays with little colorful parked pixel cars!
        pb.line(bot.w[0] + 3, bot.w[1] - dy, bot.s[0] - 3, bot.s[1] - dy, PAL.archDark);
        pb.line(bot.w[0] + 3, bot.w[1] - dy - 1, bot.s[0] - 3, bot.s[1] - dy - 1, PAL.archDark);
        pb.line(bot.w[0] + 3, bot.w[1] - dy - 2, bot.s[0] - 3, bot.s[1] - dy - 2, PAL.archDark);
        pb.line(bot.s[0] + 3, bot.s[1] - dy, bot.e[0] - 3, bot.e[1] - dy, PAL.archDark);
        pb.line(bot.s[0] + 3, bot.s[1] - dy - 1, bot.e[0] - 3, bot.e[1] - dy - 1, PAL.archDark);
        // Parked cars peeking between cream columns
        for (let c = 0; c < 3; c++) {
          const t = 0.22 + c * 0.26;
          const px0 = Math.round(bot.w[0] + (bot.s[0] - bot.w[0]) * t);
          const py0 = Math.round(bot.w[1] + (bot.s[1] - bot.w[1]) * t - dy);
          pb.rect(px0 - 2, py0 - 2, 4, 2, carColors[(fl + c) % carColors.length]);
        }
      }
      // Classic terracotta-roofed corner stairwell pavilion on top deck!
      drawPxPrism(pb, bot.n[0] + 4, bot.n[1] - bh + 8, 0.65, 0.65, 13, warmStone, terra, { inset: 0.04, windows: true, nightLit });
      drawPxHippedRoof(pb, bot.n[0] + 4, bot.n[1] - bh - 5, 0.72, 0.72, 7, terra, 0.01);
      break;
    }

    case 'substation': {
      drawPxPrism(pb, cx, baseY, w, h, 10, '#8f98a3', '#a6afb8', { inset: 0.10 });
      drawPxPrism(pb, cx - 7, baseY - 10, 0.36, 0.36, 12, '#626d78', '#7e8994', { inset: 0.02 });
      drawPxPrism(pb, cx + 7, baseY - 10, 0.36, 0.36, 12, '#626d78', '#7e8994', { inset: 0.02 });
      pb.rect(cx - 2, baseY - 25, 5, 5, flooded ? hexToRGBA('#ff3842') : hexToRGBA('#36e885'));
      break;
    }

    case 'water_tower': {
      // Iconic Tall Steel-Lattice LSU Varsity Water Tower with Catwalk & Conical Silver Cap!
      const legs: [number, number][] = [[-13, 2], [-5, 6], [5, 6], [13, 2]];
      for (const [ox, oy] of legs) {
        // Concrete footing block
        pb.rect(cx + ox - 2, baseY + oy - 2, 4, 3, PAL.stoneMid);
        // Angled dark steel trestle leg
        pb.line(cx + ox, baseY + oy - 2, cx + Math.round(ox * 0.68), baseY - 34, PAL.roadShade);
        pb.line(cx + ox + 1, baseY + oy - 2, cx + Math.round(ox * 0.68) + 1, baseY - 34, PAL.roadHi);
      }
      // Steel X-cross bracing
      pb.line(cx - 11, baseY - 6, cx + 10, baseY - 19, PAL.roadHi);
      pb.line(cx + 11, baseY - 6, cx - 10, baseY - 19, PAL.roadHi);
      pb.line(cx - 9, baseY - 19, cx + 9, baseY - 32, PAL.roadHi);
      pb.line(cx + 9, baseY - 19, cx - 9, baseY - 32, PAL.roadHi);
      // Central riser pipe
      pb.rect(cx - 2, baseY - 34, 4, 36, PAL.roadMid);
      pb.line(cx - 2, baseY - 34, cx - 2, baseY + 2, PAL.stoneHi);
      // Cylindrical steel catwalk ring
      pb.fillEllipse(cx, baseY - 33, 22, 9, PAL.roadShade);
      pb.fillEllipse(cx, baseY - 35, 20, 8, PAL.roadHi);
      // Rounded Cylindrical Royal Purple & Gold Tank with specular highlight!
      for (let ty = 0; ty < 22; ty++) {
        const isGold = ty >= 8 && ty <= 13;
        pb.fillEllipse(cx, baseY - 36 - ty, 17, 7, (x, _y, nx) => {
          if (isGold) return nx < -0.2 ? PAL.goldHi : nx < 0.3 ? PAL.goldLit : PAL.goldShade;
          return nx < -0.25 ? PAL.purpleHi : nx < 0.25 ? PAL.purpleLit : PAL.purpleDark;
        });
      }
      // Conical ribbed silver-cream dome + finial!
      drawPxDome(pb, cx, baseY - 58, 18, 12, '#e8e0cc', true);
      break;
    }

    case 'generator': {
      drawPxPrism(pb, cx, baseY, 0.85, 0.72, 12, '#e69b24', '#f7c21b', { inset: 0.08 });
      pb.rect(cx - 4, baseY - 9, 4, 4, PAL.archDark);
      pb.line(cx + 5, baseY - 12, cx + 5, baseY - 19, PAL.roadShade);
      break;
    }

    case 'pump': {
      drawPxPrism(pb, cx, baseY, w, h, 18, '#9aa4b0', '#b5bec9', { windows: true, nightLit });
      drawPxHippedRoof(pb, cx, baseY - 18, w, h, 10, '#495463', 0.02);
      pb.rect(cx - 12, baseY - 12, 4, 12, PAL.waterMid);
      pb.rect(cx + 8, baseY - 12, 4, 12, PAL.waterDeep);
      break;
    }

    case 'pond': {
      const rim = pxFootprint(cx, baseY, w, h, 0.04);
      pb.fillPoly([rim.n, rim.e, rim.s, rim.w], (x, y) => (bayer4(x, y) > 0.5 ? PAL.stoneMid : PAL.grassShade));
      const wat = pxFootprint(cx, baseY, w, h, 0.22);
      pb.fillPoly([wat.n, wat.e, wat.s, wat.w], (x, y) => (bayer4(x, y) > 0.65 ? PAL.waterHi : PAL.waterMid));
      pb.fillEllipse(cx - 6, baseY - 2, 4, 2, PAL.grassHi);
      pb.fillEllipse(cx + 7, baseY + 3, 3, 2, PAL.grassLit);
      pb.px(cx - 6, baseY - 3, PAL.azaleaHi);
      break;
    }

    case 'abatement': {
      drawPxPrism(pb, cx, baseY, 0.92, 0.85, 14, '#e6f0f2', '#349db8', { windows: true, nightLit });
      drawPxHippedRoof(pb, cx, baseY - 14, 0.92, 0.85, 6, '#349db8', 0.04);
      break;
    }

    case 'bat_house': {
      pb.rect(cx - 1, baseY - 25, 3, 25, PAL.woodShade);
      drawPxPrism(pb, cx, baseY - 23, 0.54, 0.54, 10, '#e8dcc4', '#c7523a', { inset: 0.04 });
      break;
    }

    case 'surge_barrier': {
      drawPxPrism(pb, cx - 26, baseY - 5, 0.95, 1.35, 52, '#a6aeb8', '#c8d0d9', { inset: 0.04 });
      drawPxPrism(pb, cx + 26, baseY + 5, 0.95, 1.35, 52, '#a6aeb8', '#c8d0d9', { inset: 0.04 });
      drawPxPrism(pb, cx, baseY, w * 0.65, 0.55, 30, '#5a6778', '#788696', { inset: 0.05 });
      drawPxPrism(pb, cx, baseY - 45, w * 0.96, 0.68, 7, '#dcd4c0', '#efe8d6', { inset: 0.03 });
      break;
    }

    case 'rookery': {
      drawPxPrism(pb, cx, baseY, w, h, 5, '#8c623a', '#a87b4f', { inset: 0.04 });
      drawPxPrism(pb, cx - 8, baseY - 5, 1.05, 1.0, 14, '#7d5432', '#4c7d3b', { windows: true, nightLit });
      drawPxHippedRoof(pb, cx - 8, baseY - 19, 1.18, 1.12, 10, '#4c7d3b', 0.02);
      break;
    }

    case 'practice_field': {
      drawPxField(pb, cx, baseY, w, h);
      if (tier >= 1) {
        drawPxPrism(pb, cx - 24, baseY - 14, w * 0.72, 0.50, 11, '#b0aa9e', '#5e2ca5', { inset: 0.04 });
      }
      break;
    }

    case 'stadium': {
      const wallH = tier === 0 ? 22 : tier === 1 ? 34 : 44;
      drawPxPrism(pb, cx, baseY, w, h, wallH, '#aba49c', '#4b1e85', {
        inset: 0.04,
        arches: true,
        windows: tier >= 1,
        nightLit,
      });
      drawPxField(pb, cx, baseY - wallH + 5, w * 0.70, h * 0.64);
      const rim = pxFootprint(cx, baseY - wallH, w * 0.94, h * 0.94, 0.03);
      for (let off = 0; off < 4; off++) {
        const col = off % 2 === 0 ? PAL.goldLit : PAL.purpleLit;
        pb.line(rim.w[0], rim.w[1] - off, rim.s[0], rim.s[1] - off, col);
        pb.line(rim.s[0], rim.s[1] - off, rim.e[0], rim.e[1] - off, col);
        pb.line(rim.w[0], rim.w[1] - off, rim.n[0], rim.n[1] - off, off % 2 === 0 ? PAL.purpleHi : PAL.goldHi);
        pb.line(rim.n[0], rim.n[1] - off, rim.e[0], rim.e[1] - off, off % 2 === 0 ? PAL.purpleHi : PAL.goldHi);
      }
      drawPxPrism(pb, rim.e[0] - 8, rim.e[1] - 2, 0.38, 1.4, 17, '#262b38', '#f7c21b', { inset: 0.02 });
      pb.rect(rim.e[0] - 13, rim.e[1] - 15, 9, 7, PAL.winNight);
      if (tier >= 1) {
        const masts: [number, number][] = [
          [rim.n[0] - 18, rim.n[1] + 6],
          [rim.n[0] + 18, rim.n[1] + 6],
          [rim.w[0] + 12, rim.w[1] - 4],
          [rim.e[0] - 12, rim.e[1] - 4],
          [rim.s[0] - 22, rim.s[1] - 5],
          [rim.s[0] + 22, rim.s[1] - 5],
        ];
        for (const [mx, my] of masts) {
          pb.rect(mx - 1, my - 34, 2, 34, PAL.roadShade);
          pb.rect(mx - 6, my - 39, 13, 6, nightLit ? PAL.winNightCore : PAL.stoneHi);
          pb.rect(mx - 5, my - 38, 11, 4, nightLit ? PAL.winNight : PAL.stuccoHi);
        }
      }
      break;
    }

    case 'arena': {
      // THE ASSEMBLY — Monumental Circular Colonnaded Basketball Arena w/ Ribbed Saucer Dome!
      const rx = Math.round(w * 15.5);
      const ry = Math.round(rx * 0.48);
      // Cream limestone cylindrical drum with shaded side + dark arched entrance bays!
      for (let dy = 0; dy < 16; dy++) {
        pb.fillEllipse(cx, baseY - dy, rx, ry, (x, _y, nx) => {
          const isArch = dy >= 2 && dy <= 10 && Math.abs(((x - cx) % 10 + 10) % 10 - 5) <= 2 && nx > -0.85 && nx < 0.85;
          if (isArch) return nightLit ? PAL.winNight : PAL.archDark;
          return nx < -0.1 ? PAL.stuccoHi : nx < 0.35 ? PAL.stuccoMid : PAL.stuccoShade;
        });
      }
      // Bold LSU Royal Purple & Bright Gold Fascia Rings!
      pb.fillEllipse(cx, baseY - 16, rx + 1, ry + 1, (_x, _y, nx) => (nx < 0 ? PAL.purpleHi : PAL.purpleDark));
      pb.fillEllipse(cx, baseY - 19, rx + 1, ry + 1, (_x, _y, nx) => (nx < 0 ? PAL.goldHi : PAL.goldMid));
      // Radially ribbed white-concrete saucer dome + golden lantern oculus!
      drawPxDome(pb, cx, baseY - 21, rx, Math.round(rx * 0.54), '#f2ead8', true);
      break;
    }

    case 'tiger_habitat': {
      // ROUX'S TIGER SANCTUARY — Limestone Arched Wall, Waterfall Rock Grotto, Turquoise Lagoon & Palms!
      drawPxPrism(pb, cx, baseY, w, h, 9, warmStone, '#48b52c', { inset: 0.03, brickTex: true, arches: true });
      // Sparkling turquoise swimming lagoon inside sanctuary
      const pool = pxFootprint(cx + 10, baseY - 7, w * 0.44, h * 0.50, 0.04);
      pb.fillPoly([pool.n, pool.e, pool.s, pool.w], (x, y) => ((x + y) % 4 === 0 ? PAL.waterSpark : PAL.waterHi));
      pb.strokePoly([pool.n, pool.e, pool.s, pool.w], PAL.waterAbyss);
      // Naturalistic terraced rock cave grotto + cascading white waterfall!
      drawPxDome(pb, cx - 12, baseY - 11, 14, 10, '#a69884', false);
      pb.rect(cx - 16, baseY - 15, 7, 6, PAL.archDark);
      pb.rect(cx - 2, baseY - 14, 4, 8, PAL.waterSpark);
      pb.rect(cx - 1, baseY - 14, 2, 8, PAL.waterHi);
      // Lush tropical sanctuary palms & azalea blossoms!
      for (const [bx, by] of [[-26, -6], [24, -15], [-4, -24], [19, 5], [-18, 8]] as [number, number][]) {
        pb.line(cx + bx, baseY + by + 2, cx + bx, baseY + by - 8, PAL.woodShade);
        pb.fillEllipse(cx + bx, baseY + by - 8, 7, 5, (x, y, nx, ny) => {
          if (hash2(x + bx, y) > 0.85) return PAL.azaleaHi;
          return -nx - ny > 0 ? PAL.grassHi : PAL.grassDark;
        });
      }
      break;
    }

    case 'nat_museum': {
      drawPxPrism(pb, cx, baseY, w, h, 24, '#f5f0e2', '#e0d8c8', { windows: true, arches: true, nightLit });
      drawPxDome(pb, cx, baseY - 24, 15, 11, '#78d8e6', false);
      break;
    }

    case 'concert_hall': {
      const rx = Math.round(w * 14);
      pb.fillEllipse(cx, baseY - 2, rx, Math.round(rx * 0.48), PAL.stoneMid);
      pb.fillEllipse(cx, baseY - 5, Math.round(rx * 0.72), Math.round(rx * 0.34), PAL.stoneHi);
      drawPxDome(pb, cx - 8, baseY - 10, 14, 12, '#efe5cf', false);
      break;
    }

    case 'tiger_statue': {
      // Heroic Bronze Tiger Monument on Stepped Limestone Plinth!
      drawPxPrism(pb, cx, baseY, 0.9, 0.9, 9, '#e8dec8', '#f5ebd2', { inset: 0.08 });
      pb.rect(cx - 7, baseY - 17, 14, 8, hexToRGBA('#b87e30'));
      pb.rect(cx - 5, baseY - 21, 6, 5, hexToRGBA('#d99b38'));
      pb.rect(cx + 6, baseY - 15, 4, 2, hexToRGBA('#8c5920'));
      break;
    }

    // ===== SLICE 4: COLLEGE TOWN STRIP =====
    case 'town_center': {
      drawPxPrism(pb, cx, baseY, w, h, 24, '#f2e0be', '#5e2ca5', { windows: true, arches: true, nightLit });
      drawPxHippedRoof(pb, cx, baseY - 24, w, h, 11, '#552494', 0.02);
      drawPxDome(pb, cx, baseY - 35, 10, 8, '#f7c21b', true);
      break;
    }
    case 'coffee_roaster': {
      drawPxPrism(pb, cx, baseY, w, h, 18, '#f5d2a4', '#d95e38', { windows: true, nightLit });
      drawPxHippedRoof(pb, cx, baseY - 18, w, h, 9, '#c7523a', 0.02);
      for (let k = -8; k <= 8; k += 4) {
        pb.rect(cx - 10 + k, baseY - 6 + Math.round(k * 0.4), 3, 4, (k / 4) % 2 === 0 ? hexToRGBA('#d93848') : PAL.stuccoHi);
      }
      break;
    }
    case 'music_club': {
      drawPxPrism(pb, cx, baseY, w, h, 21, '#4c2c73', '#2d194d', { windows: true, nightLit: true });
      drawPxHippedRoof(pb, cx, baseY - 21, w, h, 8, '#381e5c', 0.03);
      pb.rect(cx - 12, baseY - 15, 12, 5, hexToRGBA('#ff42a1'));
      pb.hline(cx - 11, cx - 2, baseY - 13, PAL.goldHi);
      break;
    }
    case 'student_lofts': {
      drawPxPrism(pb, cx, baseY, w, h, 30, '#e6b88a', '#7c4c3a', { windows: true, nightLit, brickTex: true });
      drawPxHippedRoof(pb, cx, baseY - 30, w, h, 10, '#6e4032', 0.02);
      break;
    }
    case 'crawfish_house': {
      drawPxPrism(pb, cx, baseY, w, h, 20, '#d65c3e', '#4a3f3a', { windows: true, nightLit, brickTex: true });
      drawPxHippedRoof(pb, cx, baseY - 20, w, h, 9, '#423732', 0.02);
      pb.rect(cx - 8, baseY - 14, 16, 4, PAL.goldHi);
      break;
    }
    case 'boutique_hotel': {
      drawPxPrism(pb, cx, baseY, w, h, 34, '#f5e8cc', '#5e2ca5', {
        windows: true,
        arches: true,
        nightLit,
      });
      drawPxHippedRoof(pb, cx, baseY - 34, w, h, 12, '#552494', 0.01);
      pb.rect(cx - 5, baseY - 47, 10, 4, PAL.goldLit);
      break;
    }

    default: {
      const hex = spec?.accentColor ?? stucco;
      drawPxPrism(pb, cx, baseY, w, h, 20, stucco, hex, { windows: true, nightLit });
      drawPxHippedRoof(pb, cx, baseY - 20, w, h, 11, hex, 0.02);
    }
  }

  // Automatic 1px dark-plum 16-bit silhouette outline around the finished building!
  pb.applyOutline(PAL.outline);

  const sprite = pb.toSprite(anchorX, anchorY);
  buildingCache.set(key, sprite);
  return sprite;
}

export function drawBuilding2D(
  ctx: CanvasRenderingContext2D,
  b: BuildingInstance,
  cx: number,
  baseY: number,
  state: GameState,
  elapsed: number,
  nightAmount: number,
  lightsOut: LightGlow[],
): void {
  const underConstruction = b.built < 1;
  const nightLit = nightAmount > 0.22 && b.powered && !b.flooded && !b.blackout;
  const drawY = b.pilings ? baseY - 12 : baseY;

  const heroSpec = !underConstruction ? getHeroSpriteSpec(b.type, b.tier) : null;
  const heroImg = heroSpec ? getHeroSprite(heroSpec.key) : null;

  if (heroSpec && heroImg) {
    // (Cast ground shadow is drawn cleanly in Pass 1.5 Unified Shadow Mask!)
    // 1. Timber pilings stilts if elevated against bayou surge!
    if (b.pilings) {
      const pC = footprintCorners(cx, baseY, b.w, b.h, 0.14);
      const pts: [number, number][] = [
        pC.w,
        pC.s,
        pC.e,
        [(pC.w[0] + pC.s[0]) * 0.5, (pC.w[1] + pC.s[1]) * 0.5],
        [(pC.s[0] + pC.e[0]) * 0.5, (pC.s[1] + pC.e[1]) * 0.5],
      ];
      for (const [px0, py0] of pts) {
        ctx.fillStyle = '#23152b';
        ctx.fillRect(Math.round(px0 - 3), Math.round(py0 - 14), 6, 15);
        ctx.fillStyle = '#ab713b';
        ctx.fillRect(Math.round(px0 - 2), Math.round(py0 - 13), 4, 13);
      }
    }

    // 2. Blit our museum-grade 16-bit PNG sprite razor-sharp onto the exact isometric footprint!
    const footW = (b.w + b.h) * 32;
    const drawW = Math.round(footW * heroSpec.widthFactor);
    const drawH = Math.round((heroImg.naturalHeight / heroImg.naturalWidth) * drawW);
    const footSouthY = drawY + (b.w + b.h) * 8 + heroSpec.footSinkPx;
    const dx = Math.round(cx - drawW * 0.5);
    const dy = Math.round(footSouthY - drawH);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(heroImg, dx, dy, drawW, drawH);

    // 3. Pixel-exact warm golden night-window & floodlight glow overlay!
    const gameNight = b.type === 'stadium' && state.football.active && state.football.nightGame;
    if (nightLit || gameNight) {
      const glowImg = getHeroGlowSprite(heroSpec.key);
      if (glowImg) {
        const prevAlpha = ctx.globalAlpha;
        ctx.globalAlpha = gameNight ? 0.98 : Math.min(0.95, 0.45 + nightAmount * 0.55);
        ctx.drawImage(glowImg, dx, dy, drawW, drawH);
        ctx.globalAlpha = prevAlpha;
      }
    }

    // 4. Optional signature rooftop accents for specialized colleges
    if (heroSpec.rooftopAccent === 'observatory') {
      // Crisp pixel-outlined astronomical observatory dome perched on Science Hall!
      const ox = Math.round(cx + 2);
      const oy = Math.round(dy + drawH * 0.25);
      ctx.fillStyle = '#23152b';
      ctx.fillRect(ox - 16, oy - 1, 32, 4);
      ctx.beginPath();
      ctx.arc(ox, oy, 15, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#f5f0e2';
      ctx.beginPath();
      ctx.arc(ox, oy, 13, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#c8c2b6';
      ctx.beginPath();
      ctx.arc(ox + 3, oy, 10, Math.PI * 1.5, 0);
      ctx.fill();
      ctx.fillStyle = '#23152b';
      ctx.fillRect(ox - 2, oy - 13, 4, 12);
      ctx.fillStyle = '#d4cbb8';
      ctx.fillRect(ox - 14, oy, 28, 2);
    } else if (heroSpec.rooftopAccent === 'antenna') {
      const ax = Math.round(cx);
      const ay = Math.round(dy + 6);
      for (let sy = 0; sy < 30; sy += 6) {
        ctx.fillStyle = '#23152b';
        ctx.fillRect(ax - 2, ay - sy - 6, 5, 6);
        ctx.fillStyle = (sy / 6) % 2 === 0 ? '#e83838' : '#fff5dc';
        ctx.fillRect(ax - 1, ay - sy - 5, 3, 5);
      }
      ctx.fillStyle = '#ff384c';
      ctx.fillRect(ax - 2, ay - 34, 5, 4);
    } else if (heroSpec.rooftopAccent === 'flag') {
      const fx = Math.round(cx + 2);
      const fy = Math.round(dy + 12);
      const wave = Math.round(Math.sin(elapsed * 5) * 1.5);
      ctx.fillStyle = '#23152b';
      ctx.fillRect(fx - 1, fy - 16, 2, 16);
      ctx.fillStyle = '#6128a8';
      ctx.fillRect(fx + 1, fy - 15 + wave, 9, 6);
      ctx.fillStyle = '#f7c21b';
      ctx.fillRect(fx + 1, fy - 12 + wave, 9, 2);
    } else if (heroSpec.rooftopAccent === 'health_cross') {
      const hx = Math.round(cx);
      const hy = Math.round(dy + drawH * 0.24);
      ctx.fillStyle = '#23152b';
      ctx.fillRect(hx - 6, hy - 3, 12, 6);
      ctx.fillRect(hx - 3, hy - 6, 6, 12);
      ctx.fillStyle = '#fff5dc';
      ctx.fillRect(hx - 5, hy - 2, 10, 4);
      ctx.fillRect(hx - 2, hy - 5, 4, 10);
      ctx.fillStyle = '#e03434';
      ctx.fillRect(hx - 4, hy - 1, 8, 2);
      ctx.fillRect(hx - 1, hy - 4, 2, 8);
    } else if (heroSpec.rooftopAccent === 'neon') {
      const nx = Math.round(cx - 12);
      const ny = Math.round(dy + drawH * 0.56);
      ctx.fillStyle = '#23152b';
      ctx.fillRect(nx - 1, ny - 1, 20, 8);
      ctx.fillStyle = '#ff42a1';
      ctx.fillRect(nx, ny, 18, 6);
      ctx.fillStyle = '#ffe878';
      ctx.fillRect(nx + 2, ny + 2, 14, 2);
    }

    // 5. Warm golden pixel window glow accents at night!
    if (nightLit) {
      lightsOut.push({
        x: cx,
        y: dy + drawH * 0.58,
        r: b.type === 'stadium' ? 120 : b.type === 'bell_tower' ? 68 : 54,
        color: b.type === 'music_club' ? '255, 110, 200' : '255, 224, 130',
        alpha: b.type === 'stadium' ? 0.26 : nightAmount * 0.34,
      });
    }
  } else {
    // Specialized procedural 16-bit sprites (Water Tower, Arena, Rec Center w/ Pool, Practice Field, Tiger Habitat, Utilities)
    const sprite = getBuildingSprite(
      b.type,
      b.w,
      b.h,
      b.tier,
      b.pilings,
      nightLit,
      underConstruction,
      b.flooded,
    );
    const ix = Math.round(cx - sprite.anchorX);
    const iy = Math.round(baseY - sprite.anchorY);
    ctx.drawImage(sprite.canvas, ix, iy);
  }

  // Animated pacing pixel Bengal Tiger ("Roux")!
  if (b.type === 'tiger_habitat' && !underConstruction) {
    const pace = Math.sin(elapsed * 1.4) * 10;
    const tx = Math.round(cx + pace);
    const ty = Math.round(drawY - 9 + pace * 0.25);
    ctx.fillStyle = '#23152b';
    ctx.fillRect(tx - 5, ty - 4, 10, 6);
    ctx.fillStyle = '#f58c28';
    ctx.fillRect(tx - 4, ty - 3, 8, 4);
    ctx.fillStyle = '#23152b';
    ctx.fillRect(tx - 2, ty - 3, 1, 3);
    ctx.fillRect(tx + 1, ty - 3, 1, 3);
    ctx.fillStyle = '#fff5dc';
    ctx.fillRect(tx + 3, ty - 2, 2, 2);
  }

  // Night & Game-Night warm additive glow halos!
  if (!underConstruction) {
    if (b.type === 'bell_tower' && nightAmount > 0.2) {
      lightsOut.push({ x: cx, y: drawY - 68, r: 58, color: '255, 224, 130', alpha: nightAmount * 0.42 });
    } else if (b.type === 'library' && b.tier >= 1 && nightAmount > 0.2) {
      lightsOut.push({ x: cx, y: drawY - 46, r: 64, color: '255, 215, 110', alpha: nightAmount * 0.36 });
    } else if (b.type === 'substation') {
      lightsOut.push({
        x: cx,
        y: drawY - 22,
        r: 22,
        color: b.flooded ? '255, 50, 55' : '50, 235, 130',
        alpha: 0.40,
      });
    } else if (b.type === 'stadium' && b.tier >= 1) {
      const gameNight = state.football.active && state.football.nightGame;
      if (gameNight || nightAmount > 0.2) {
        lightsOut.push({
          x: cx,
          y: drawY - 48,
          r: gameNight ? 115 : 80,
          color: '255, 240, 185',
          alpha: gameNight ? 0.24 : nightAmount * 0.20,
        });
      }
    } else if (nightLit && (b.type === 'founders_hall' || b.type === 'union' || b.type === 'music_club' || b.type === 'boutique_hotel')) {
      lightsOut.push({
        x: cx,
        y: drawY - 18,
        r: 44,
        color: b.type === 'music_club' ? '255, 110, 200' : '255, 222, 130',
        alpha: nightAmount * 0.30,
      });
    }
  }

  // Crisp pixel Flooded / Unpowered status badge icon above building!
  if (b.flooded || (!b.powered && !underConstruction && CATALOG[b.type].needsPower)) {
    const bob = Math.round(Math.sin(elapsed * 5 + cx * 0.1) * 2);
    const bx = Math.round(cx - 7);
    const by = Math.round(drawY - 42 + bob);
    ctx.fillStyle = '#23152b';
    ctx.fillRect(bx - 1, by - 1, 16, 15);
    ctx.fillStyle = b.flooded ? '#2882c8' : '#e83838';
    ctx.fillRect(bx, by, 14, 13);
    ctx.fillStyle = '#fff5dc';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(b.flooded ? '~' : '!', bx + 7, by + 10);
  }
}

// ===== 16-BIT PIXEL ART LOUISIANA TREES & FLORA (CONCEPT-ART GNARLED OAKS & CYPRESSES!) =====

function drawLeafCluster(
  pb: PixelBuffer,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  hi: RGBA,
  lit: RGBA,
  mid: RGBA,
  shade: RGBA,
  dark: RGBA,
  seed: number,
): void {
  // Draw chunky dark-outlined foliage puff so internal leaf tiers have crisp 16-bit pixel depth!
  pb.fillEllipse(cx, cy + 1, rx + 1, ry + 1, PAL.outline);
  pb.fillEllipse(cx, cy, rx, ry, (x, y, nx, ny) => {
    const light = -nx * 0.55 - ny * 0.65;
    const g = hash2(x + seed * 17, y + seed * 9);
    if (light > 0.36 && g > 0.22) return hi;
    if (light > 0.02) return g > 0.65 ? hi : lit;
    if (light > -0.35) return bayer4(x, y) > 0.45 ? mid : shade;
    return dark;
  });
}

function getTreeSprite(
  kind: VegInstance['kind'],
  variant: number,
  autumn: boolean,
): CachedSprite {
  const key = `${kind}|v${variant}|a${autumn ? 1 : 0}`;
  const hit = treeCache.get(key);
  if (hit) return hit;

  const isOak = kind === 'oak';
  const isCypress = kind === 'cypress';
  const w = isOak ? 84 : isCypress ? 56 : 30;
  const h = isOak ? 76 : isCypress ? 72 : 30;
  const cx = Math.floor(w * 0.5);
  const baseY = h - 11;

  const pb = new PixelBuffer(w, h);

  if (isOak) {
    // Massive gnarled spreading Live Oak trunk, thick splayed surface roots & dark boughs!
    pb.fillPoly(
      [
        [cx - 12, baseY + 2],
        [cx - 6, baseY - 4],
        [cx - 6, baseY - 22],
        [cx + 6, baseY - 22],
        [cx + 7, baseY - 4],
        [cx + 13, baseY + 2],
        [cx + 4, baseY + 3],
        [cx, baseY],
        [cx - 5, baseY + 3],
      ],
      (x, y) => {
        if (x < cx - 2) return ((x + y) & 1) === 0 ? PAL.woodLit : PAL.woodShade;
        if (x < cx + 2) return PAL.woodShade;
        return PAL.woodDark;
      },
    );
    // Thick gnarled lower spreading limbs visible under the canopy!
    pb.line(cx - 3, baseY - 16, cx - 22, baseY - 29, PAL.woodDark);
    pb.line(cx - 3, baseY - 17, cx - 22, baseY - 30, PAL.woodShade);
    pb.line(cx - 3, baseY - 18, cx - 20, baseY - 31, PAL.woodLit);

    pb.line(cx + 3, baseY - 16, cx + 22, baseY - 28, PAL.woodDark);
    pb.line(cx + 3, baseY - 17, cx + 21, baseY - 29, PAL.woodShade);
    pb.line(cx, baseY - 18, cx - 2, baseY - 35, PAL.woodDark);

    // 11 individually dark-outlined dappled pixel foliage puffs for authentic SNES depth!
    const clusters: [number, number, number, number][] = [
      // Back dark crown layer
      [cx - 21, baseY - 31, 13, 9],
      [cx + 21, baseY - 30, 13, 9],
      [cx, baseY - 45, 16, 11],
      // Mid spreading boughs
      [cx - 14, baseY - 38, 14, 10],
      [cx + 14, baseY - 37, 14, 10],
      [cx - 24, baseY - 26, 10, 7],
      [cx + 24, baseY - 25, 10, 7],
      // Front sunlit canopy puffs
      [cx - 7, baseY - 42, 13, 9],
      [cx + 8, baseY - 40, 12, 9],
      [cx - 12, baseY - 30, 11, 7],
      [cx + 11, baseY - 29, 11, 7],
      [cx, baseY - 36, 13, 9],
    ];
    for (let k = 0; k < clusters.length; k++) {
      const [px0, py0, rx, ry] = clusters[k];
      drawLeafCluster(pb, px0, py0, rx, ry, PAL.grassHi, PAL.grassLit, PAL.grassMid, PAL.grassShade, PAL.grassDark, variant * 11 + k);
    }

    // Lush silver-sage curtains of hanging Spanish Moss with dark edges!
    const mossDrape: [number, number, number][] = [
      [-26, -21, 11],
      [-20, -23, 14],
      [-13, -24, 12],
      [-7, -26, 10],
      [7, -25, 13],
      [14, -24, 14],
      [21, -22, 12],
      [26, -20, 9],
    ];
    for (let m = 0; m < mossDrape.length; m++) {
      const [ox, oy, baseLen] = mossDrape[m];
      const mx = cx + ox;
      const topY = baseY + oy;
      const len = baseLen + ((m * 3 + variant) % 4);
      pb.line(mx - 1, topY, mx - 1, topY + len - 2, PAL.mossShade);
      pb.line(mx, topY, mx, topY + len, PAL.mossHi);
      pb.line(mx + 1, topY + 1, mx + 1, topY + len - 1, PAL.mossMid);
    }
  } else if (isCypress) {
    // Dramatic widely-buttressed Bald Cypress trunk + 5 wooden swamp cypress knees!
    pb.fillPoly(
      [
        [cx - 9, baseY + 2],
        [cx - 5, baseY - 8],
        [cx - 3, baseY - 36],
        [cx + 3, baseY - 36],
        [cx + 5, baseY - 8],
        [cx + 9, baseY + 2],
      ],
      (x, y) => {
        if (x < cx - 1) return ((x + y) & 1) === 0 ? PAL.woodHi : PAL.woodLit;
        if (x < cx + 2) return PAL.woodShade;
        return PAL.woodDark;
      },
    );
    // 5 crisp wooden Cypress Knees poking up beside the flared roots!
    for (const [kx, kh] of [[-14, 6], [-10, 8], [10, 7], [14, 5], [-6, 5]] as [number, number][]) {
      pb.rect(cx + kx - 1, baseY - kh + 2, 3, kh, PAL.woodShade);
      pb.line(cx + kx - 1, baseY - kh + 2, cx + kx - 1, baseY + 1, PAL.woodLit);
    }

    const cHi = autumn ? hexToRGBA('#f5a638') : PAL.grassHi;
    const cLit = autumn ? hexToRGBA('#d96e28') : PAL.grassLit;
    const cMid = autumn ? hexToRGBA('#ad4422') : PAL.wetLit;
    const cShade = autumn ? hexToRGBA('#802d1d') : PAL.wetMid;
    const cDark = autumn ? hexToRGBA('#571d1a') : PAL.grassDark;

    // Layered flat feathery Bald Cypress bough tiers!
    const tiers: [number, number, number, number][] = [
      [cx - 10, baseY - 24, 11, 5],
      [cx + 10, baseY - 23, 11, 5],
      [cx, baseY - 26, 13, 6],
      [cx - 8, baseY - 35, 10, 5],
      [cx + 8, baseY - 34, 10, 5],
      [cx, baseY - 38, 12, 6],
      [cx - 5, baseY - 46, 8, 5],
      [cx + 5, baseY - 45, 8, 5],
      [cx, baseY - 52, 9, 5],
    ];
    for (let k = 0; k < tiers.length; k++) {
      const [px0, py0, rx, ry] = tiers[k];
      drawLeafCluster(pb, px0, py0, rx, ry, cHi, cLit, cMid, cShade, cDark, variant * 7 + k);
    }
    // Delicate hanging Spanish moss wisps
    for (const [ox, oy, len] of [[-12, -20, 8], [11, -19, 9], [-9, -31, 7], [9, -30, 8]] as [number, number, number][]) {
      pb.line(cx + ox, baseY + oy, cx + ox, baseY + oy + len, PAL.mossHi);
      pb.line(cx + ox + 1, baseY + oy + 1, cx + ox + 1, baseY + oy + len - 2, PAL.mossMid);
    }
  } else if (kind === 'azalea') {
    pb.fillEllipse(cx, baseY - 5, 10, 7, (x, y, nx, ny) => {
      const h = hash2(x + variant * 17, y);
      if (h > 0.68) return ny < 0 ? PAL.azaleaHi : PAL.azaleaMid;
      if (h > 0.54) return PAL.azaleaShade;
      return -nx - ny > 0 ? PAL.grassLit : PAL.grassDark;
    });
  } else {
    const angles = [-2.5, -2.0, -1.55, -1.1, -0.65];
    for (const a of angles) {
      const ex = cx + Math.round(Math.cos(a) * 11);
      const ey = baseY - 3 + Math.round(Math.sin(a) * 10);
      pb.line(cx, baseY - 2, ex, ey, PAL.grassHi);
      pb.line(cx, baseY - 1, ex, ey + 1, PAL.grassShade);
    }
  }

  pb.applyOutline(PAL.outline);
  const sprite = pb.toSprite(cx, baseY);
  treeCache.set(key, sprite);
  return sprite;
}

export function drawTree2D(
  ctx: CanvasRenderingContext2D,
  tree: VegInstance,
  cx: number,
  baseY: number,
  elapsed: number,
  autumn: boolean,
): void {
  const variant = (Math.round(tree.tx * 7 + tree.ty * 13) & 3);
  const sprite = getTreeSprite(tree.kind, variant, autumn && tree.kind === 'cypress');
  const sway = Math.round(Math.sin(elapsed * 1.6 + tree.tx * 0.9) * (tree.kind === 'oak' ? 0.6 : 0.4));
  ctx.drawImage(sprite.canvas, Math.round(cx - sprite.anchorX + sway), Math.round(baseY - sprite.anchorY));
}

// ===== 16-BIT PIXEL ART LIVING ENTITIES (CONCEPT-ART DETAILED STUDENTS!) =====

export function drawPixelStudent(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  shirt: 'purple' | 'gold' | 'white' | 'lavender',
  walkPhase: number,
  umbrella = false,
  facingRight = true,
  variant = 0,
): void {
  const step = Math.floor(walkPhase) % 3;
  const v = variant & 3;
  const key = `stu4|${shirt}|${step}|u${umbrella ? 1 : 0}|f${facingRight ? 1 : 0}|v${v}`;
  let sp = entityCache.get(key);
  if (!sp) {
    const hexMap: Record<typeof shirt, string[]> = {
      purple: ['#6e32c4', '#7d3bd6', '#56219e', '#8b45de'],
      gold: ['#f7c21b', '#f59c24', '#ffe052', '#e0a214'],
      white: ['#e85a48', '#f2e8cf', '#d94862', '#f08238'],
      lavender: ['#369cd4', '#46b89e', '#9b72cf', '#3876c4'],
    };
    const hairPalette = ['#3b241d', '#d49a42', '#21161c', '#7a3f24'];
    const skinPalette = ['#f5c99b', '#e6b282', '#9e6844', '#f7d6b2'];
    const shirtHex = hexMap[shirt][v];
    const pb = new PixelBuffer(16, 22);
    const col = hexToRGBA(shirtHex);
    const colDark = shadeRGBA(shirtHex, 0.72);
    const legA = step === 0 ? 0 : step === 1 ? 1 : -1;
    const legB = -legA;
    // Walking legs + sneakers (3-frame stride!)
    pb.rect(6, 14 + Math.max(0, legA), 2, 4, hexToRGBA('#364d7a'));
    pb.rect(8, 14 + Math.max(0, legB), 2, 4, hexToRGBA('#253559'));
    pb.px(6, 18 + Math.max(0, legA), PAL.stuccoHi);
    pb.px(9, 18 + Math.max(0, legB), PAL.stuccoHi);
    // Torso shirt + shaded side
    pb.rect(5, 9, 6, 5, col);
    pb.rect(facingRight ? 5 : 8, 9, 3, 5, colDark);
    // Varsity backpack on trailing shoulder!
    pb.rect(facingRight ? 4 : 10, 9, 2, 4, v % 2 === 0 ? PAL.goldLit : PAL.purpleLit);
    // Head + skin + hair + eye direction
    pb.rect(6, 4, 4, 5, hexToRGBA(skinPalette[v]));
    pb.rect(5, 3, 6, 3, hexToRGBA(hairPalette[v]));
    pb.px(facingRight ? 9 : 6, 6, PAL.outline);
    if (umbrella) {
      pb.fillEllipse(8, 4, 6, 3, PAL.purpleHi);
    }
    pb.applyOutline(PAL.outline);
    sp = pb.toSprite(8, 19);
    entityCache.set(key, sp);
  }
  ctx.drawImage(sp.canvas, Math.round(x - sp.anchorX), Math.round(y - sp.anchorY));
}

export function drawPixelGator(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  elapsed: number,
): void {
  const frame = Math.floor(elapsed * 2.5) & 1;
  const key = `gator|${frame}`;
  let sp = entityCache.get(key);
  if (!sp) {
    const pb = new PixelBuffer(26, 14);
    pb.hline(3, 22, 9, PAL.waterSpark);
    pb.fillEllipse(12, 7, 8, 3, PAL.grassShade);
    pb.fillEllipse(12, 6, 7, 2, PAL.grassLit);
    pb.hline(2, 6, 7 + (frame ? 0 : 1), PAL.grassShade);
    pb.hline(2, 5, 6 + (frame ? 0 : 1), PAL.grassHi);
    pb.rect(18, 6, 5, 2, PAL.grassLit);
    pb.px(18, 5, PAL.goldHi);
    pb.px(16, 5, PAL.goldHi);
    pb.px(9, 5, PAL.grassHi);
    pb.px(12, 5, PAL.grassHi);
    pb.px(15, 5, PAL.grassHi);
    pb.applyOutline(PAL.outline);
    sp = pb.toSprite(13, 8);
    entityCache.set(key, sp);
  }
  ctx.drawImage(sp.canvas, Math.round(x - sp.anchorX), Math.round(y - sp.anchorY));
}

export function drawPixelPirogue(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cajunNavy = false,
): void {
  const key = cajunNavy ? 'pirogue_cn' : 'pirogue';
  let sp = entityCache.get(key);
  if (!sp) {
    const pb = new PixelBuffer(26, 16);
    pb.fillEllipse(13, 10, 10, 3, PAL.shadow);
    pb.fillEllipse(13, 8, 10, 3, cajunNavy ? hexToRGBA('#e85638') : PAL.woodLit);
    pb.fillEllipse(13, 7, 7, 2, PAL.woodDark);
    pb.rect(11, 4, 4, 4, cajunNavy ? PAL.goldHi : PAL.purpleLit);
    pb.rect(10, 2, 6, 2, PAL.goldHi);
    pb.applyOutline(PAL.outline);
    sp = pb.toSprite(13, 9);
    entityCache.set(key, sp);
  }
  ctx.drawImage(sp.canvas, Math.round(x - sp.anchorX), Math.round(y - sp.anchorY));
}

export function drawPixelVehicle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: 'fogger' | 'officer' | 'parade_float' | 'shuttle',
  floatIndex = 0,
): void {
  const key = `veh|${kind}|${floatIndex}`;
  let sp = entityCache.get(key);
  if (!sp) {
    const isFloat = kind === 'parade_float';
    const pb = new PixelBuffer(isFloat ? 44 : 28, isFloat ? 38 : 24);
    const cx = Math.floor(pb.w * 0.5);
    const by = pb.h - 7;
    if (kind === 'fogger') {
      drawPxPrism(pb, cx, by, 0.55, 0.35, 8, '#f0f2f5', '#42b8c8', { inset: 0.02, cornice: false, castShadow: true });
      pb.rect(cx - 5, by - 9, 4, 3, PAL.winDayHi);
    } else if (kind === 'officer') {
      drawPxPrism(pb, cx, by, 0.52, 0.34, 8, '#4e7a46', '#385c34', { inset: 0.02, cornice: false, castShadow: true });
      pb.rect(cx - 3, by - 10, 4, 2, PAL.goldHi);
    } else if (kind === 'shuttle') {
      drawPxPrism(pb, cx, by, 0.68, 0.36, 9, '#5e2ca5', '#f7c21b', { inset: 0.02, cornice: false, castShadow: true });
      pb.hline(cx - 7, cx + 6, by - 5, PAL.goldHi);
    } else {
      const bodyHex = floatIndex === 0 ? '#692eb8' : floatIndex === 1 ? '#1fa85c' : '#f5b700';
      const trimHex = floatIndex === 1 ? '#f5b700' : '#ffd84d';
      drawPxPrism(pb, cx, by, 1.05, 0.58, 12, bodyHex, trimHex, { inset: 0.03, castShadow: true });
      drawPxDome(pb, cx, by - 13, 9, 9, floatIndex === 1 ? '#36c96c' : '#f7c21b', floatIndex === 0);
      for (let k = -8; k <= 8; k += 4) {
        pb.px(cx + k, by - 4, k % 8 === 0 ? PAL.goldHi : PAL.azaleaHi);
      }
    }
    pb.applyOutline(PAL.outline);
    sp = pb.toSprite(cx, by);
    entityCache.set(key, sp);
  }
  ctx.drawImage(sp.canvas, Math.round(x - sp.anchorX), Math.round(y - sp.anchorY));
}
