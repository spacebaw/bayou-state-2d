import { BuildingInstance, GameState } from '../sim/types';
import {
  drawIsoDome,
  drawIsoHippedRoof,
  drawIsoPrism,
  drawPoly,
  ELEV_PX,
  footprintCorners,
  HALF_H,
  HALF_W,
  shadeColor,
  tileToIso,
} from './iso';

export interface LightGlow {
  x: number;
  y: number;
  r: number;
  color: string;
  alpha: number;
}

/**
 * Handcrafted HD 2D Isometric Architectural Painter for all 50+ Bayou State buildings,
 * upgrade tiers, pilings foundations, construction scaffolding, and glowing night lamps!
 */
export function drawBuilding2D(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  b: BuildingInstance,
  baseElevFt: number,
  elapsed: number,
  nightAmount: number,
  lightsOut: LightGlow[],
): void {
  const centerTx = b.tx + b.w * 0.5;
  const centerTy = b.ty + b.h * 0.5;
  const pos = tileToIso(centerTx, centerTy, baseElevFt);
  const cx = pos.x;
  const groundY = pos.y;
  const lit = b.powered && !b.blackout && b.built >= 1;
  const pilingsLift = b.pilings ? 3.0 * ELEV_PX : 0;
  const baseY = groundY - pilingsLift;

  // 1. Soft isometric contact AO shadow on the ground
  const sh = footprintCorners(cx + 5, groundY + 4, b.w + 0.15, b.h + 0.15, 0.05);
  drawPoly(ctx, [sh.n, sh.e, sh.s, sh.w], 'rgba(26, 20, 52, 0.24)');

  // 2. 3D-looking Isometric Pilings Foundation if elevated!
  if (b.pilings) {
    const fc = footprintCorners(cx, groundY, b.w, b.h, 0.14);
    ctx.strokeStyle = '#6e4e32';
    ctx.lineWidth = 3.2;
    for (const pt of [fc.w, fc.s, fc.e]) {
      ctx.beginPath();
      ctx.moveTo(pt[0], pt[1]);
      ctx.lineTo(pt[0], pt[1] - pilingsLift);
      ctx.stroke();
    }
    // Mid-span timber piers along SW & SE edges
    for (const [a, e] of [[fc.w, fc.s], [fc.s, fc.e]]) {
      const mx = (a[0] + e[0]) * 0.5;
      const my = (a[1] + e[1]) * 0.5;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx, my - pilingsLift);
      ctx.stroke();
    }
    drawIsoPrism(ctx, cx, baseY + 3, b.w, b.h, 4, '#cfc5b0', '#e2dac6', { inset: 0.05 });
  }

  // 3. Construction scaffolding if still building
  if (b.built < 1) {
    const h = 14 + b.built * 24;
    drawIsoPrism(ctx, cx, baseY, b.w, b.h, h, '#c99b5b', '#ddb67c', { inset: 0.12 });
    const c = footprintCorners(cx, baseY, b.w, b.h, 0.08);
    ctx.strokeStyle = '#7a5229';
    ctx.lineWidth = 1.6;
    for (const pt of [c.n, c.e, c.s, c.w]) {
      ctx.beginPath();
      ctx.moveTo(pt[0], pt[1]);
      ctx.lineTo(pt[0], pt[1] - h - 8);
      ctx.stroke();
    }
    return;
  }

  // Register warm night ambient glow for lit buildings
  if (lit && nightAmount > 0.15) {
    lightsOut.push({
      x: cx,
      y: baseY - 14,
      r: (b.w + b.h) * 14,
      color: '255, 206, 110',
      alpha: nightAmount * 0.24,
    });
  }

  const win = (rows: number, cols: number) => ({ rows, cols, lit, night: nightAmount });

  switch (b.type) {
    case 'founders_hall': {
      // 1920s Italian Renaissance Revival Centerpiece!
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, 28, '#ede3ce', '#d8ccb2', {
        windows: win(2, 4),
        eaveShadow: true,
      });
      drawIsoHippedRoof(ctx, cx, baseY - 28, b.w, b.h, 19, '#c2543a');
      // Central Golden Cupola
      drawIsoPrism(ctx, cx, baseY - 43, 0.85, 0.85, 11, '#dfd5be', '#eee6d4', { inset: 0.02 });
      drawIsoDome(ctx, cx, baseY - 54, 11, 10, '#f5b700');
      // Purple & Gold front banners
      const c = footprintCorners(cx, baseY, b.w, b.h, 0.08);
      drawPoly(
        ctx,
        [
          [c.s[0] - 12, c.s[1] - 16],
          [c.s[0] - 7, c.s[1] - 18],
          [c.s[0] - 7, c.s[1] - 4],
          [c.s[0] - 12, c.s[1] - 2],
        ],
        '#461d7c',
      );
      drawPoly(
        ctx,
        [
          [c.s[0] + 7, c.s[1] - 18],
          [c.s[0] + 12, c.s[1] - 16],
          [c.s[0] + 12, c.s[1] - 2],
          [c.s[0] + 7, c.s[1] - 4],
        ],
        '#f5b700',
      );
      break;
    }

    case 'bell_tower': {
      // Iconic 175-ft LSU Memorial Campanile!
      drawIsoPrism(ctx, cx, baseY, 1.5, 1.5, 12, '#d8ceb8', '#eae2d0');
      drawIsoPrism(ctx, cx, baseY - 12, 0.92, 0.92, 68, '#ebe2ce', '#d8ceb8', { inset: 0.04 });
      // Golden clock medallions
      ctx.fillStyle = '#f5b700';
      ctx.beginPath();
      ctx.arc(cx - 8, baseY - 64, 4.5, 0, Math.PI * 2);
      ctx.arc(cx + 8, baseY - 64, 4.5, 0, Math.PI * 2);
      ctx.fill();
      // Glowing arched belfry!
      drawIsoPrism(ctx, cx, baseY - 80, 0.96, 0.96, 16, lit ? '#ffdf85' : '#8a7e6e', '#d8ceb8', { inset: 0.04 });
      drawIsoHippedRoof(ctx, cx, baseY - 96, 1.05, 1.05, 18, '#c2543a');
      ctx.fillStyle = '#f5b700';
      ctx.beginPath();
      ctx.arc(cx, baseY - 115, 3, 0, Math.PI * 2);
      ctx.fill();
      if (lit && nightAmount > 0.1) {
        lightsOut.push({ x: cx, y: baseY - 88, r: 78, color: '255, 214, 110', alpha: nightAmount * 0.55 });
      }
      break;
    }

    case 'library': {
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, 32, '#ede3ce', '#d8ccb2', {
        windows: win(2, 5),
        eaveShadow: true,
      });
      drawIsoHippedRoof(ctx, cx, baseY - 32, b.w, b.h, 20, '#c2543a');
      if (b.tier >= 1) {
        // Tier 1: Flagship Research Library with Glowing Gold & Glass Reading Rotunda!
        drawIsoPrism(ctx, cx, baseY - 46, 1.35, 1.35, 14, lit ? '#ffe294' : '#4a5c72', '#f5b700', { inset: 0.05 });
        drawIsoDome(ctx, cx, baseY - 60, 22, 18, '#f5b700');
        if (lit && nightAmount > 0.1) {
          lightsOut.push({ x: cx, y: baseY - 54, r: 65, color: '255, 220, 120', alpha: nightAmount * 0.4 });
        }
      } else {
        drawIsoPrism(ctx, cx, baseY - 48, 1.4, 1.1, 8, lit ? '#f8dc8c' : '#4a5c72', '#ded5c0');
      }
      break;
    }

    case 'science_college': {
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, 30, '#e3dac6', '#d6cbb4', {
        windows: win(2, 4),
        eaveShadow: true,
      });
      drawIsoHippedRoof(ctx, cx, baseY - 30, b.w, b.h, 16, '#b84c35');
      // Gleaming Silver Astronomical Observatory Dome!
      drawIsoPrism(ctx, cx + 14, baseY - 40, 1.0, 1.0, 11, '#d8d0bc', '#c8c0ac', { inset: 0.05 });
      drawIsoDome(ctx, cx + 14, baseY - 51, 16, 15, '#ced8e2');
      ctx.strokeStyle = '#2c3440';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx + 14, baseY - 65);
      ctx.lineTo(cx + 21, baseY - 53);
      ctx.stroke();
      break;
    }

    case 'ag_college': {
      drawIsoPrism(ctx, cx - 14, baseY - 4, b.w * 0.58, b.h * 0.9, 26, '#ece2cd', '#d8ccb2', {
        windows: win(2, 3),
        eaveShadow: true,
      });
      drawIsoHippedRoof(ctx, cx - 14, baseY - 30, b.w * 0.62, b.h * 0.94, 15, '#c2543a');
      // Sunlit Translucent Glass Greenhouses!
      drawIsoPrism(ctx, cx + 22, baseY + 8, b.w * 0.42, b.h * 0.78, 13, '#9bd8df', '#c6f0f5', { inset: 0.08 });
      drawIsoDome(ctx, cx + 22, baseY - 5, 18, 10, '#bfeaf0');
      break;
    }

    case 'business_college': {
      drawIsoPrism(ctx, cx - 10, baseY - 3, b.w * 0.62, b.h * 0.92, 30, '#ede3ce', '#d8ccb2', {
        windows: win(2, 4),
        eaveShadow: true,
      });
      drawIsoHippedRoof(ctx, cx - 10, baseY - 33, b.w * 0.66, b.h * 0.96, 16, '#c2543a');
      // Classical Rotunda Wing
      drawIsoPrism(ctx, cx + 24, baseY + 6, 1.4, 1.4, 30, '#dfd6c1', '#c8c0ac');
      drawIsoDome(ctx, cx + 24, baseY - 24, 21, 13, '#c2543a');
      break;
    }

    case 'engineering': {
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, 34, '#e6ddca', '#d8ccb2', {
        windows: win(3, 5),
        eaveShadow: true,
      });
      // Modern glass skybridge stripe
      drawIsoPrism(ctx, cx, baseY - 12, 1.2, b.h * 0.6, 12, lit ? '#ffdf88' : '#4a627a', '#6a829a', { inset: 0.05 });
      drawIsoHippedRoof(ctx, cx, baseY - 34, b.w, b.h, 16, '#bd5038');
      break;
    }

    case 'coastal_institute': {
      // Timber & Glass Bayou Pavilion on Stilts + Weather Radar Dome
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, 22, '#6d8d99', '#5a636d', {
        windows: win(1, 4),
        inset: 0.14,
      });
      drawIsoHippedRoof(ctx, cx, baseY - 22, b.w, b.h, 13, '#4c5661');
      ctx.strokeStyle = '#8b95a1';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + 12, baseY - 30);
      ctx.lineTo(cx + 12, baseY - 46);
      ctx.stroke();
      drawIsoDome(ctx, cx + 12, baseY - 46, 5, 5, '#ece8dc');
      break;
    }

    case 'law_center': {
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, 36, '#e2dac6', '#d4cab0', {
        windows: win(2, 5),
        eaveShadow: true,
      });
      drawIsoHippedRoof(ctx, cx, baseY - 36, b.w, b.h, 18, '#b84c35');
      break;
    }

    case 'vet_school': {
      drawIsoPrism(ctx, cx - 18, baseY - 6, b.w * 0.56, b.h * 0.88, 28, '#ebe2ce', '#d8ccb2', {
        windows: win(2, 4),
        eaveShadow: true,
      });
      drawIsoHippedRoof(ctx, cx - 18, baseY - 34, b.w * 0.6, b.h * 0.92, 16, '#c2543a');
      // Red Teaching Barn & Paddock
      drawIsoPrism(ctx, cx + 26, baseY + 6, b.w * 0.4, b.h * 0.48, 20, '#a43e32', '#525862');
      drawIsoHippedRoof(ctx, cx + 26, baseY - 14, b.w * 0.44, b.h * 0.52, 14, '#4b515c');
      break;
    }

    case 'masscomm_school': {
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, 26, '#ebe2ce', '#d8ccb2', {
        windows: win(2, 3),
        eaveShadow: true,
      });
      drawIsoHippedRoof(ctx, cx, baseY - 26, b.w, b.h, 14, '#c2543a');
      // Tall Broadcast Spire with Blinking Red Beacon
      ctx.strokeStyle = '#7c8794';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(cx + 8, baseY - 35);
      ctx.lineTo(cx + 8, baseY - 82);
      ctx.stroke();
      const blink = Math.sin(elapsed * 4.5) > -0.2;
      if (blink) {
        ctx.fillStyle = '#ff3838';
        ctx.beginPath();
        ctx.arc(cx + 8, baseY - 84, 3.2, 0, Math.PI * 2);
        ctx.fill();
        lightsOut.push({ x: cx + 8, y: baseY - 84, r: 22, color: '255, 50, 50', alpha: 0.55 });
      }
      break;
    }

    case 'rotc_armory': {
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, 28, '#96483d', '#c8bfa8', {
        windows: win(2, 4),
        eaveShadow: true,
      });
      drawIsoDome(ctx, cx, baseY - 28, b.w * 15, 16, '#4d545e');
      break;
    }

    case 'dorm': {
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, 30, '#ebe1cc', '#d8ccb2', {
        windows: win(3, 4),
        eaveShadow: true,
      });
      drawIsoHippedRoof(ctx, cx, baseY - 30, b.w, b.h, 15, '#c2543a');
      break;
    }

    case 'res_tower': {
      // Towering 9-story Residence Hall glowing like a jewel box at night!
      drawIsoPrism(ctx, cx, baseY, b.w * 0.84, b.h * 0.84, 78, '#ede3ce', '#d8ccb2', {
        windows: win(7, 4),
        eaveShadow: true,
      });
      drawIsoHippedRoof(ctx, cx, baseY - 78, b.w * 0.88, b.h * 0.88, 16, '#c2543a');
      break;
    }

    case 'dining_hall': {
      const h = b.tier === 0 ? 22 : b.tier === 1 ? 28 : 34;
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, h, '#ede3ce', '#d8ccb2', {
        windows: win(1 + b.tier, 4),
        eaveShadow: true,
      });
      drawIsoHippedRoof(ctx, cx, baseY - h, b.w, b.h, 15, '#c2543a');
      // Purple & gold outdoor umbrellas!
      const c = footprintCorners(cx, baseY, b.w, b.h, 0.04);
      for (let u = 0; u < 3; u++) {
        const ux = c.s[0] - 18 + u * 16;
        const uy = c.s[1] - 4 + (u % 2) * 3;
        drawIsoDome(ctx, ux, uy - 5, 6, 4, u === 1 ? '#f5b700' : '#461d7c');
      }
      break;
    }

    case 'union': {
      const h = b.tier >= 1 ? 36 : 28;
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, h, '#ede3ce', '#d8ccb2', {
        windows: win(2, 5),
        eaveShadow: true,
      });
      drawIsoHippedRoof(ctx, cx, baseY - h, b.w, b.h, 17, '#c2543a');
      if (b.tier >= 1) drawIsoDome(ctx, cx, baseY - h - 12, 14, 11, '#f5b700');
      // Purple & gold entrance awning
      drawIsoPrism(ctx, cx - 10, baseY + 12, 1.8, 0.45, 4, '#461d7c', '#f5b700', { inset: 0.02 });
      break;
    }

    case 'rec_center': {
      drawIsoPrism(ctx, cx - 14, baseY - 4, b.w * 0.56, b.h * 0.9, 26, '#ece2ce', '#d8ccb2', {
        windows: win(2, 3),
        eaveShadow: true,
      });
      drawIsoHippedRoof(ctx, cx - 14, baseY - 30, b.w * 0.6, b.h * 0.94, 14, '#c2543a');
      // Sparkling Outdoor Turquoise Lagoon Pool!
      const pc = footprintCorners(cx + 22, baseY + 8, b.w * 0.4, b.h * 0.78, 0.08);
      drawPoly(ctx, [pc.n, pc.e, pc.s, pc.w], '#d8d0be');
      const pool = footprintCorners(cx + 22, baseY + 8, b.w * 0.32, b.h * 0.66, 0.08);
      drawPoly(ctx, [pool.n, pool.e, pool.s, pool.w], '#29a8ba');
      break;
    }

    case 'parking': {
      if (b.tier === 0) {
        const pc = footprintCorners(cx, baseY, b.w, b.h, 0.06);
        drawPoly(ctx, [pc.n, pc.e, pc.s, pc.w], '#454a54', '#d8d0be', 1.2);
        // Cute parked cars
        const cols = ['#461d7c', '#f5b700', '#e8e2d4', '#c2543a'];
        for (let k = 0; k < 4; k++) {
          drawIsoPrism(ctx, cx - 22 + k * 14, baseY - 2 + (k % 2) * 8, 0.42, 0.28, 5, cols[k], cols[k], { inset: 0.01 });
        }
      } else {
        // 3-Story Concrete Garage or 5-Story Parking Tower!
        const floors = b.tier === 1 ? 3 : 5;
        for (let f = 0; f < floors; f++) {
          drawIsoPrism(ctx, cx, baseY - f * 9, b.w * 0.94, b.h * 0.92, 6, '#b8b3a8', '#cfc9be', { inset: 0.06 });
        }
      }
      break;
    }

    case 'poboy':
    case 'campus_store': {
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, 18, '#ede3ce', '#461d7c', {
        windows: win(1, 2),
      });
      drawIsoPrism(ctx, cx, baseY - 18, b.w + 0.06, b.h + 0.06, 4, '#461d7c', '#f5b700', { inset: 0.04 });
      break;
    }

    case 'concert_hall': {
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, 30, '#e2dac6', '#d0c8b4', { windows: win(2, 5) });
      drawIsoDome(ctx, cx, baseY - 30, b.w * 16, 20, '#d0d8e0');
      break;
    }

    case 'nat_museum': {
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, 28, '#e3dac6', '#d4cab0', { windows: win(2, 4), eaveShadow: true });
      drawIsoHippedRoof(ctx, cx, baseY - 28, b.w, b.h, 16, '#c2543a');
      drawIsoDome(ctx, cx, baseY + 12, 6, 6, '#f5b700');
      break;
    }

    case 'tiger_statue': {
      drawIsoPrism(ctx, cx, baseY, 0.72, 0.72, 8, '#d8ceb8', '#eae2d0', { inset: 0.05 });
      drawIsoPrism(ctx, cx, baseY - 8, 0.45, 0.24, 7, '#a87234', '#c99044', { inset: 0.02 });
      break;
    }

    case 'substation': {
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, 5, '#a8a49c', '#c2beb5');
      drawIsoPrism(ctx, cx - 10, baseY - 5, 0.65, 0.65, 14, '#5c6670', '#7c8794');
      drawIsoPrism(ctx, cx + 10, baseY - 5, 0.65, 0.65, 14, '#5c6670', '#7c8794');
      // Glowing green or red blackout status beacon!
      ctx.fillStyle = b.flooded ? '#ff2a3c' : '#28e07c';
      ctx.beginPath();
      ctx.arc(cx, baseY - 24, 4.5, 0, Math.PI * 2);
      ctx.fill();
      lightsOut.push({
        x: cx,
        y: baseY - 24,
        r: 24,
        color: b.flooded ? '255, 40, 50' : '40, 230, 120',
        alpha: 0.45,
      });
      break;
    }

    case 'water_tower': {
      // Tall steel legs + Iconic Purple & Gold LSU Water Tower!
      ctx.strokeStyle = '#5a6470';
      ctx.lineWidth = 2.6;
      for (const ox of [-11, 0, 11]) {
        ctx.beginPath();
        ctx.moveTo(cx + ox, baseY);
        ctx.lineTo(cx + ox * 0.7, baseY - 38);
        ctx.stroke();
      }
      drawIsoPrism(ctx, cx, baseY - 36, 1.15, 1.15, 22, '#461d7c', '#5e2ca5', { inset: 0.08 });
      drawIsoPrism(ctx, cx, baseY - 43, 1.19, 1.19, 5, '#f5b700', '#f5b700', { inset: 0.08 });
      drawIsoDome(ctx, cx, baseY - 58, 22, 11, '#ded7c6');
      break;
    }

    case 'generator': {
      drawIsoPrism(ctx, cx, baseY, 0.85, 0.72, 12, '#e89d24', '#f5b700');
      break;
    }

    case 'pump': {
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, 18, '#9fa6ae', '#b8bfc7', { eaveShadow: true });
      drawIsoHippedRoof(ctx, cx, baseY - 18, b.w, b.h, 10, '#4c5460');
      break;
    }

    case 'pond': {
      const rim = footprintCorners(cx, baseY, b.w, b.h, 0.06);
      drawPoly(ctx, [rim.n, rim.e, rim.s, rim.w], '#c4bba4');
      const wat = footprintCorners(cx, baseY, b.w, b.h, 0.22);
      drawPoly(ctx, [wat.n, wat.e, wat.s, wat.w], '#2b8896');
      break;
    }

    case 'abatement': {
      drawIsoPrism(ctx, cx, baseY, 0.9, 0.85, 14, '#eaf0f4', '#389cb5');
      break;
    }

    case 'bat_house': {
      ctx.strokeStyle = '#6e4e32';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, baseY);
      ctx.lineTo(cx, baseY - 26);
      ctx.stroke();
      drawIsoPrism(ctx, cx, baseY - 24, 0.52, 0.52, 9, '#ebe2ce', '#c2543a');
      break;
    }

    case 'wildlife_post': {
      drawIsoPrism(ctx, cx, baseY, 0.9, 0.9, 14, '#8c623d', '#5d843c', { windows: win(1, 2) });
      drawIsoHippedRoof(ctx, cx, baseY - 14, 1.0, 1.0, 10, '#497336');
      break;
    }

    case 'health_center': {
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, 24, '#f0eae0', '#d8ccb2', { windows: win(2, 3), eaveShadow: true });
      drawIsoHippedRoof(ctx, cx, baseY - 24, b.w, b.h, 13, '#c2543a');
      // Glowing green medical cross
      ctx.fillStyle = '#20b872';
      ctx.fillRect(cx - 6, baseY - 20, 12, 4);
      ctx.fillRect(cx - 2, baseY - 24, 4, 12);
      break;
    }

    case 'surge_barrier': {
      // FORTRESS CAPSTONE: Towering Concrete Towers & Steel Storm Sector Gates!
      drawIsoPrism(ctx, cx - 28, baseY - 6, 0.95, 1.4, 52, '#a8afb8', '#c6cdd6');
      drawIsoPrism(ctx, cx + 28, baseY + 6, 0.95, 1.4, 52, '#a8afb8', '#c6cdd6');
      drawIsoPrism(ctx, cx, baseY, b.w * 0.65, 0.55, 32, '#5c6978', '#798796');
      drawIsoPrism(ctx, cx, baseY - 46, b.w * 0.95, 0.7, 7, '#d8d0be', '#ebe4d4');
      break;
    }

    case 'rookery': {
      // LIVING WITH WATER CAPSTONE: Cypress Marsh Observation Platform & Nesting Blind
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, 5, '#8a623c', '#a3784e');
      drawIsoPrism(ctx, cx - 10, baseY - 5, 1.1, 1.0, 14, '#7d5634', '#4a7538');
      drawIsoHippedRoof(ctx, cx - 10, baseY - 19, 1.25, 1.15, 10, '#4b7838');
      break;
    }

    case 'practice_field': {
      thisField2D(ctx, cx, baseY, b.w, b.h);
      if (b.tier >= 1) {
        drawIsoPrism(ctx, cx - 26, baseY - 16, b.w * 0.8, 0.55, 12, '#a8a298', '#461d7c');
      }
      break;
    }

    case 'stadium': {
      // THE CAULDRON — Showstopping 2D Isometric Football Cathedral!
      const wallH = b.tier === 0 ? 22 : b.tier === 1 ? 36 : 48;
      // Outer bowl shell
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, wallH, '#a49e96', '#461d7c', { inset: 0.04 });
      // Recessed green football field drawn cleanly on top of the stadium bowl!
      thisField2D(ctx, cx, baseY - wallH + 6, b.w * 0.7, b.h * 0.64);

      // Stepped Purple & Gold Crowd Rim (animated wave during live games!)
      const wave = state.football.active ? Math.sin(elapsed * 8) * 2.5 : 0;
      const topC = footprintCorners(cx, baseY - wallH - wave, b.w * 0.92, b.h * 0.92, 0.04);
      ctx.strokeStyle = '#f5b700';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(topC.w[0], topC.w[1]);
      ctx.lineTo(topC.s[0], topC.s[1]);
      ctx.lineTo(topC.e[0], topC.e[1]);
      ctx.stroke();

      ctx.strokeStyle = '#5e2ca5';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(topC.w[0], topC.w[1]);
      ctx.lineTo(topC.n[0], topC.n[1]);
      ctx.lineTo(topC.e[0], topC.e[1]);
      ctx.stroke();

      // Glowing Scoreboard
      drawIsoPrism(ctx, topC.e[0] - 8, topC.e[1], 0.4, 1.5, 18, '#262a34', '#f5b700');

      // Tier 1+: 6 Iconic Towering Stadium Light Masts!
      if (b.tier >= 1) {
        const gameNight = state.football.active && state.football.nightGame;
        const mastPts: [number, number][] = [
          [topC.n[0] - 18, topC.n[1] + 8],
          [topC.n[0] + 18, topC.n[1] + 8],
          [topC.w[0] + 12, topC.w[1] - 4],
          [topC.e[0] - 12, topC.e[1] - 4],
          [topC.s[0] - 24, topC.s[1] - 6],
          [topC.s[0] + 24, topC.s[1] - 6],
        ];
        for (const [mx, my] of mastPts) {
          ctx.strokeStyle = '#525b66';
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.moveTo(mx, my);
          ctx.lineTo(mx, my - 38);
          ctx.stroke();
          ctx.fillStyle = gameNight || nightAmount > 0.2 ? '#fff8d6' : '#dfe4ea';
          ctx.fillRect(mx - 7, my - 43, 14, 6);
          if (gameNight || nightAmount > 0.2) {
            lightsOut.push({
              x: mx,
              y: my - 40,
              r: gameNight ? 66 : 48,
              color: '255, 240, 185',
              alpha: gameNight ? 0.24 : nightAmount * 0.22,
            });
          }
        }
        if (gameNight) {
          lightsOut.push({ x: cx, y: baseY - wallH, r: 120, color: '255, 236, 175', alpha: 0.16 });
        }
      }
      break;
    }

    case 'arena': {
      // THE ASSEMBLY — Iconic Circular Ribbed White-Concrete Dome Basketball Arena!
      const rx = b.w * 14.5;
      drawIsoDome(ctx, cx, baseY - 12, rx, rx * 0.48, '#ede6d6');
      // Drum base + purple & gold fascia ring
      ctx.fillStyle = '#461d7c';
      ctx.beginPath();
      ctx.ellipse(cx, baseY - 12, rx * 1.01, rx * 0.44, 0, 0, Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#f5b700';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(cx, baseY - 13, rx * 1.01, rx * 0.44, 0, 0, Math.PI);
      ctx.stroke();
      drawIsoDome(ctx, cx, baseY - 16, rx * 0.96, rx * 0.44, '#f0e9db');
      break;
    }

    case 'tiger_habitat': {
      // Roux's Lush Sanctuary with Rock Grotto, Lagoon Pool & Animated 2D Bengal Tiger!
      const fc = footprintCorners(cx, baseY, b.w, b.h, 0.08);
      drawPoly(ctx, [fc.n, fc.e, fc.s, fc.w], '#5a8f3d', '#cfc5b0', 3);
      // Lagoon pool
      ctx.fillStyle = '#2c96a4';
      ctx.beginPath();
      ctx.ellipse(cx + 14, baseY + 4, 18, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      // Sandstone rock grotto
      drawIsoDome(ctx, cx - 18, baseY - 4, 16, 12, '#c8bba0');
      // Animated pacing Roux the Bengal Tiger!
      const rx = cx + Math.cos(elapsed * 0.7) * 14;
      const ry = baseY + Math.sin(elapsed * 0.7) * 6;
      ctx.fillStyle = '#e87e22';
      ctx.beginPath();
      ctx.ellipse(rx, ry - 4, 7, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#221a15';
      ctx.fillRect(rx - 2, ry - 7, 2, 5);
      ctx.fillRect(rx + 2, ry - 7, 2, 5);
      break;
    }

    // ===== COLLEGE TOWN DISTRICT =====
    case 'town_center': {
      const fc = footprintCorners(cx, baseY, b.w, b.h, 0.05);
      drawPoly(ctx, [fc.n, fc.e, fc.s, fc.w], '#dfd5c0', '#b8ae98', 1.5);
      // Twin flanking brick College Town buildings
      drawIsoPrism(ctx, cx - 28, baseY - 8, 1.25, b.h * 0.85, 28, '#9e4b3d', '#c2543a', { windows: win(2, 3) });
      drawIsoHippedRoof(ctx, cx - 28, baseY - 36, 1.32, b.h * 0.9, 12, '#c2543a');
      drawIsoPrism(ctx, cx + 28, baseY + 8, 1.25, b.h * 0.85, 28, '#9e4b3d', '#c2543a', { windows: win(2, 3) });
      drawIsoHippedRoof(ctx, cx + 28, baseY - 20, 1.32, b.h * 0.9, 12, '#c2543a');
      // Sparkling Central Limestone Fountain!
      ctx.fillStyle = '#cfc5b0';
      ctx.beginPath();
      ctx.ellipse(cx, baseY + 2, 15, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#36a8bd';
      ctx.beginPath();
      ctx.ellipse(cx, baseY + 1, 12, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'coffee_roaster': {
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, 20, '#9e4b3d', '#48505a', { windows: win(1, 3) });
      drawIsoHippedRoof(ctx, cx, baseY - 20, b.w, b.h, 11, '#444c56');
      drawIsoPrism(ctx, cx - 4, baseY + 8, 1.5, 0.45, 4, '#227a52', '#f5b700', { inset: 0.02 });
      break;
    }

    case 'music_club': {
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, 26, '#8f4338', '#461d7c', { windows: win(2, 3) });
      drawIsoPrism(ctx, cx, baseY - 26, b.w + 0.04, b.h + 0.04, 4, '#461d7c', '#f5b700');
      // Glowing Neon Marquee!
      drawIsoPrism(ctx, cx - 6, baseY + 10, 1.4, 0.4, 9, '#461d7c', lit ? '#ffe680' : '#f5b700', { inset: 0.02 });
      if (lit && nightAmount > 0.15) {
        lightsOut.push({ x: cx, y: baseY - 8, r: 54, color: '185, 110, 255', alpha: nightAmount * 0.4 });
      }
      break;
    }

    case 'student_lofts': {
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, 12, '#dfd5c0', '#cfc5b0', { windows: win(1, 4) });
      drawIsoPrism(ctx, cx, baseY - 12, b.w * 0.96, b.h * 0.96, 36, '#a44c3d', '#c2543a', {
        windows: win(3, 4),
        eaveShadow: true,
      });
      drawIsoHippedRoof(ctx, cx, baseY - 48, b.w, b.h, 12, '#c2543a');
      break;
    }

    case 'boutique_hotel': {
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, 62, '#ede3ce', '#d8ccb2', {
        windows: win(5, 5),
        eaveShadow: true,
      });
      drawIsoHippedRoof(ctx, cx, baseY - 62, b.w, b.h, 16, '#c2543a');
      drawIsoDome(ctx, cx, baseY - 74, 14, 10, '#f5b700');
      break;
    }

    case 'crawfish_house': {
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, 18, '#8a5d38', '#9e4336', { windows: win(1, 3) });
      drawIsoHippedRoof(ctx, cx, baseY - 18, b.w, b.h, 12, '#b04032');
      break;
    }

    default: {
      // Lecture Hall, Humanities, Music, Art, Honors, Education
      const h = b.type === 'humanities_college' ? 30 : 26;
      drawIsoPrism(ctx, cx, baseY, b.w, b.h, h, '#ede3ce', '#d8ccb2', {
        windows: win(2, Math.max(3, b.w)),
        eaveShadow: true,
      });
      drawIsoHippedRoof(ctx, cx, baseY - h, b.w, b.h, 16, '#c2543a');
      if (b.type === 'honors_college') drawIsoDome(ctx, cx, baseY - h - 10, 9, 8, '#f5b700');
      if (b.type === 'music_college') {
        drawIsoPrism(ctx, cx - 8, baseY + 12, 1.8, 0.4, 4, '#461d7c', '#f5b700');
      }
      break;
    }
  }
}

function thisField2D(ctx: CanvasRenderingContext2D, cx: number, cy: number, wTiles: number, hTiles: number): void {
  const fc = footprintCorners(cx, cy, wTiles, hTiles, 0.08);
  drawPoly(ctx, [fc.n, fc.e, fc.s, fc.w], '#34853c', '#ffffff', 1.5);

  // Purple & Gold End Zones along the long axis
  const lerp = (a: [number, number], b: [number, number], t: number): [number, number] => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ];
  drawPoly(ctx, [fc.n, lerp(fc.n, fc.e, 0.14), lerp(fc.w, fc.s, 0.14), fc.w], '#461d7c');
  drawPoly(ctx, [lerp(fc.n, fc.e, 0.86), fc.e, fc.s, lerp(fc.w, fc.s, 0.86)], '#f5b700');

  // Crisp white yard lines
  ctx.strokeStyle = 'rgba(255,255,255,0.72)';
  ctx.lineWidth = 1;
  for (let y = 1; y <= 7; y++) {
    const t = 0.14 + (0.72 * y) / 8;
    const p1 = lerp(fc.n, fc.e, t);
    const p2 = lerp(fc.w, fc.s, t);
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.stroke();
  }

  // Midfield Gold Tiger Medallion
  ctx.fillStyle = '#f5b700';
  ctx.beginPath();
  ctx.ellipse(cx, cy, 7, 3.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#461d7c';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Yellow 2D goalposts at both end zones!
  const g1 = lerp(fc.n, fc.w, 0.5);
  const g2 = lerp(fc.e, fc.s, 0.5);
  ctx.strokeStyle = '#ffd11a';
  ctx.lineWidth = 1.8;
  for (const gp of [g1, g2]) {
    ctx.beginPath();
    ctx.moveTo(gp[0], gp[1]);
    ctx.lineTo(gp[0], gp[1] - 11);
    ctx.moveTo(gp[0] - 4, gp[1] - 7);
    ctx.lineTo(gp[0] + 4, gp[1] - 7);
    ctx.moveTo(gp[0] - 4, gp[1] - 7);
    ctx.lineTo(gp[0] - 4, gp[1] - 15);
    ctx.moveTo(gp[0] + 4, gp[1] - 7);
    ctx.lineTo(gp[0] + 4, gp[1] - 15);
    ctx.stroke();
  }
}

export function drawTree2D(
  ctx: CanvasRenderingContext2D,
  kind: 'oak' | 'cypress' | 'azalea' | 'palmetto',
  x: number,
  y: number,
  scale: number,
  swayPx: number,
  autumnAmt: number,
): void {
  // Soft contact shadow
  ctx.fillStyle = 'rgba(24, 20, 48, 0.22)';
  ctx.beginPath();
  ctx.ellipse(x + 4, y + 2, 11 * scale, 5.5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  if (kind === 'oak') {
    // Southern Live Oak with spreading gnarled canopy & hanging Spanish moss!
    ctx.strokeStyle = '#4e3928';
    ctx.lineWidth = 4 * scale;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + swayPx * 0.25, y - 13 * scale);
    ctx.stroke();

    const cx = x + swayPx;
    const cy = y - 17 * scale;
    const grad = ctx.createRadialGradient(cx - 6 * scale, cy - 5 * scale, 2, cx, cy, 18 * scale);
    grad.addColorStop(0, '#5a823f');
    grad.addColorStop(0.55, '#385e2a');
    grad.addColorStop(1, '#233b22');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 16 * scale, 10 * scale, 0, 0, Math.PI * 2);
    ctx.ellipse(cx - 8 * scale, cy + 2 * scale, 10 * scale, 7 * scale, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + 8 * scale, cy + 2 * scale, 10 * scale, 7 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hanging Spanish Moss Drapes!
    ctx.strokeStyle = 'rgba(176, 190, 152, 0.85)';
    ctx.lineWidth = 1.6 * scale;
    for (const ox of [-9, -3, 4, 10]) {
      ctx.beginPath();
      ctx.moveTo(cx + ox * scale, cy + 5 * scale);
      ctx.lineTo(cx + ox * scale + swayPx * 0.4, cy + 12 * scale);
      ctx.stroke();
    }
  } else if (kind === 'cypress') {
    // Bald Cypress (turns fiery rust-orange in November!)
    ctx.fillStyle = '#4a3525';
    ctx.beginPath();
    ctx.moveTo(x - 3.5 * scale, y);
    ctx.lineTo(x + 3.5 * scale, y);
    ctx.lineTo(x + 1.4 * scale + swayPx * 0.3, y - 15 * scale);
    ctx.lineTo(x - 1.4 * scale + swayPx * 0.3, y - 15 * scale);
    ctx.closePath();
    ctx.fill();

    const baseHex = autumnAmt > 0.5 ? '#cc6c2b' : autumnAmt > 0.1 ? '#7d6b34' : '#3d663e';
    const tx = x + swayPx;
    drawPoly(
      ctx,
      [
        [tx, y - 34 * scale],
        [tx + 10 * scale, y - 11 * scale],
        [tx - 10 * scale, y - 11 * scale],
      ],
      shadeColor(baseHex, 1.04),
    );
    drawPoly(
      ctx,
      [
        [tx, y - 34 * scale],
        [tx + 10 * scale, y - 11 * scale],
        [tx, y - 10 * scale],
      ],
      shadeColor(baseHex, 0.78, '#2b2550', 0.2),
    );
  } else if (kind === 'azalea') {
    ctx.fillStyle = '#2d5c2b';
    ctx.beginPath();
    ctx.ellipse(x, y - 3, 8.5 * scale, 5.5 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ee5588';
    for (const [ox, oy] of [[-4, -4], [0, -6], [4, -4], [-1, -2]]) {
      ctx.beginPath();
      ctx.arc(x + ox * scale, y + oy * scale, 2.6 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Marsh palmetto fan
    ctx.fillStyle = '#4e7e36';
    ctx.beginPath();
    ctx.ellipse(x, y - 3, 7 * scale, 4 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

export { HALF_H, HALF_W };
