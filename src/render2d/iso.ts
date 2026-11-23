import { idx, inBounds } from '../sim/terrain';
import { GameState, MAP_SIZE } from '../sim/types';

export const TILE_W = 64;
export const TILE_H = 32;
export const HALF_W = TILE_W * 0.5;
export const HALF_H = TILE_H * 0.5;
export const ELEV_PX = 5.4; // vertical pixels per foot of elevation

export function tileToIso(tx: number, ty: number, elevFt = 0): { x: number; y: number } {
  return {
    x: (tx - ty) * HALF_W,
    y: (tx + ty) * HALF_H - elevFt * ELEV_PX,
  };
}

export class Camera2D {
  x = 0;
  y = 0;
  zoom = 1.05;
  desiredX = 0;
  desiredY = 0;
  desiredZoom = 1.05;
  shakeAmount = 0;
  brightNight = true;

  constructor() {
    this.focusOnTile(41, 16, 1.05);
    this.x = this.desiredX;
    this.y = this.desiredY;
    this.zoom = this.desiredZoom;
  }

  focusOnTile(tx: number, ty: number, zoom = 1.15): void {
    const p = tileToIso(tx, ty, 3.5);
    this.desiredX = p.x;
    this.desiredY = p.y;
    this.desiredZoom = Math.max(0.45, Math.min(2.35, zoom));
  }

  snapDefault(): void {
    this.focusOnTile(36, 18, 0.92);
  }

  addShake(intensity: number): void {
    this.shakeAmount = Math.min(18, this.shakeAmount + intensity * 9);
  }

  panByScreenDelta(dxPx: number, dyPx: number): void {
    this.desiredX -= dxPx / this.zoom;
    this.desiredY -= dyPx / this.zoom;
    this.clamp();
  }

  panByKeys(fwd: number, right: number, dt: number): void {
    const speed = (620 / this.zoom) * dt;
    this.desiredX += right * speed;
    this.desiredY -= fwd * speed;
    this.clamp();
  }

  zoomBy(factor: number): void {
    this.desiredZoom = Math.max(0.45, Math.min(2.4, this.desiredZoom * factor));
  }

  private clamp(): void {
    this.desiredX = Math.max(-MAP_SIZE * HALF_W, Math.min(MAP_SIZE * HALF_W, this.desiredX));
    this.desiredY = Math.max(-180, Math.min(MAP_SIZE * TILE_H + 140, this.desiredY));
  }

  update(dt: number): void {
    const damp = 1 - Math.exp(-dt * 10);
    this.x += (this.desiredX - this.x) * damp;
    this.y += (this.desiredY - this.y) * damp;
    this.zoom += (this.desiredZoom - this.zoom) * damp;
    if (this.shakeAmount > 0.05) {
      this.shakeAmount *= Math.exp(-dt * 7.5);
    } else {
      this.shakeAmount = 0;
    }
  }

  worldToScreen(wx: number, wy: number, viewW: number, viewH: number): { sx: number; sy: number } {
    return {
      sx: (wx - this.x) * this.zoom + viewW * 0.5,
      sy: (wy - this.y) * this.zoom + viewH * 0.5,
    };
  }

  screenToWorld(sx: number, sy: number, viewW: number, viewH: number): { wx: number; wy: number } {
    return {
      wx: (sx - viewW * 0.5) / this.zoom + this.x,
      wy: (sy - viewH * 0.5) / this.zoom + this.y,
    };
  }

  /**
   * Elevation-aware screen -> tile picker using 3 refinement iterations
   * so clicking elevated ridges and bayou banks hits the exact visual tile.
   */
  screenToTile(sx: number, sy: number, viewW: number, viewH: number, state: GameState): { tx: number; ty: number } | null {
    const { wx, wy } = this.screenToWorld(sx, sy, viewW, viewH);
    let estElev = 3.0;
    let tx = 0;
    let ty = 0;

    for (let iter = 0; iter < 3; iter++) {
      const adjY = wy + estElev * ELEV_PX;
      const fx = (wx / HALF_W + adjY / HALF_H) * 0.5;
      const fy = (adjY / HALF_H - wx / HALF_W) * 0.5;
      tx = Math.floor(fx);
      ty = Math.floor(fy);
      if (inBounds(tx, ty)) {
        estElev = Math.max(0, state.tiles.elev[idx(tx, ty)]);
      }
    }

    return inBounds(tx, ty) ? { tx, ty } : null;
  }
}

// ===== HANDCRAFTED HD ISOMETRIC DRAWING PRIMITIVES =====

export function shadeColor(hex: string, factor: number, tintHex?: string, tintAmt = 0): string {
  const n = parseInt(hex.slice(1), 16);
  let r = ((n >> 16) & 255) * factor;
  let g = ((n >> 8) & 255) * factor;
  let b = (n & 255) * factor;
  if (tintHex && tintAmt > 0) {
    const tn = parseInt(tintHex.slice(1), 16);
    const tr = (tn >> 16) & 255;
    const tg = (tn >> 8) & 255;
    const tb = tn & 255;
    r = r * (1 - tintAmt) + tr * tintAmt;
    g = g * (1 - tintAmt) + tg * tintAmt;
    b = b * (1 - tintAmt) + tb * tintAmt;
  }
  const cr = Math.max(0, Math.min(255, Math.round(r)));
  const cg = Math.max(0, Math.min(255, Math.round(g)));
  const cb = Math.max(0, Math.min(255, Math.round(b)));
  return `rgb(${cr},${cg},${cb})`;
}

/**
 * Draws an isometric footprint diamond centered at tile corner (tx0, ty0) spanning (w, h) tiles.
 */
export function footprintCorners(
  cx: number,
  cy: number,
  wTiles: number,
  hTiles: number,
  inset = 0.08,
): { n: [number, number]; e: [number, number]; s: [number, number]; w: [number, number] } {
  const w = Math.max(0.1, wTiles - inset * 2);
  const h = Math.max(0.1, hTiles - inset * 2);
  // Half-vectors along +tx (SE) and +ty (SW)
  const dxE = w * 0.5 * HALF_W;
  const dyE = w * 0.5 * HALF_H;
  const dxS = -h * 0.5 * HALF_W;
  const dyS = h * 0.5 * HALF_H;

  return {
    n: [cx - dxE - dxS, cy - dyE - dyS],
    e: [cx + dxE - dxS, cy + dyE - dyS],
    s: [cx + dxE + dxS, cy + dyE + dyS],
    w: [cx - dxE + dxS, cy - dyE + dyS],
  };
}

export function drawPoly(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  fill: string | CanvasGradient,
  stroke?: string,
  lineWidth = 0.8,
): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

/**
 * Draws an isometric 3D box prism with warm upper-left lighting, cool-indigo shaded right wall,
 * subtle top bevel highlight, and optional glowing windows!
 */
export function drawIsoPrism(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  wTiles: number,
  hTiles: number,
  heightPx: number,
  wallHex: string,
  topHex?: string,
  opts?: {
    inset?: number;
    windows?: { rows: number; cols: number; lit: boolean; night: number; warm?: boolean };
    eaveShadow?: boolean;
  },
): { topCenter: [number, number]; corners: ReturnType<typeof footprintCorners> } {
  const c = footprintCorners(cx, baseY, wTiles, hTiles, opts?.inset ?? 0.08);
  const topN: [number, number] = [c.n[0], c.n[1] - heightPx];
  const topE: [number, number] = [c.e[0], c.e[1] - heightPx];
  const topS: [number, number] = [c.s[0], c.s[1] - heightPx];
  const topW: [number, number] = [c.w[0], c.w[1] - heightPx];

  // Left-facing (SW) lit wall gradient
  const leftGrad = ctx.createLinearGradient(topW[0], topW[1], c.s[0], c.s[1]);
  leftGrad.addColorStop(0, shadeColor(wallHex, 1.03, '#fff0cc', 0.08));
  leftGrad.addColorStop(1, shadeColor(wallHex, 0.86, '#2b2550', 0.12));
  drawPoly(ctx, [topW, topS, c.s, c.w], leftGrad);

  // Right-facing (SE) shadow wall gradient (cool indigo bounce)
  const rightGrad = ctx.createLinearGradient(topS[0], topS[1], c.e[0], c.e[1]);
  rightGrad.addColorStop(0, shadeColor(wallHex, 0.78, '#2b2550', 0.22));
  rightGrad.addColorStop(1, shadeColor(wallHex, 0.64, '#2b2550', 0.30));
  drawPoly(ctx, [topS, topE, c.e, c.s], rightGrad);

  // Optional glowing windows painted cleanly in perspective on both visible facades!
  if (opts?.windows) {
    const { rows, cols, lit, night } = opts.windows;
    const winCol = lit
      ? night > 0.2
        ? `rgba(255, 224, 130, ${0.55 + night * 0.45})`
        : '#3d5169'
      : '#262c38';

    const drawFaceWindows = (
      tl: [number, number],
      tr: [number, number],
      bl: [number, number],
      br: [number, number],
      countCols: number,
    ) => {
      for (let r = 0; r < rows; r++) {
        const v0 = (r + 0.28) / (rows + 0.35);
        const v1 = (r + 0.72) / (rows + 0.35);
        for (let k = 0; k < countCols; k++) {
          const u0 = (k + 0.22) / (countCols + 0.12);
          const u1 = (k + 0.74) / (countCols + 0.12);
          const lerp2 = (u: number, v: number): [number, number] => {
            const topX = tl[0] + (tr[0] - tl[0]) * u;
            const topY = tl[1] + (tr[1] - tl[1]) * u;
            const botX = bl[0] + (br[0] - bl[0]) * u;
            const botY = bl[1] + (br[1] - bl[1]) * u;
            return [topX + (botX - topX) * v, topY + (botY - topY) * v];
          };
          drawPoly(ctx, [lerp2(u0, v0), lerp2(u1, v0), lerp2(u1, v1), lerp2(u0, v1)], winCol);
        }
      }
    };

    drawFaceWindows(topW, topS, c.w, c.s, Math.max(2, cols));
    drawFaceWindows(topS, topE, c.s, c.e, Math.max(2, Math.round(cols * (hTiles / Math.max(0.5, wTiles)))));
  }

  // Subtle roof eave shadow line
  if (opts?.eaveShadow) {
    ctx.strokeStyle = 'rgba(28, 22, 54, 0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(topW[0], topW[1] + 2);
    ctx.lineTo(topS[0], topS[1] + 2);
    ctx.lineTo(topE[0], topE[1] + 2);
    ctx.stroke();
  }

  // Top face
  const topColor = topHex ?? shadeColor(wallHex, 1.12, '#ffe8b8', 0.12);
  drawPoly(ctx, [topN, topE, topS, topW], topColor, 'rgba(255,248,225,0.28)', 0.7);

  return {
    topCenter: [cx, baseY - heightPx],
    corners: { n: topN, e: topE, s: topS, w: topW },
  };
}

/**
 * Draws an authentic 1920s Italian Renaissance Revival terracotta hipped roof!
 */
export function drawIsoHippedRoof(
  ctx: CanvasRenderingContext2D,
  cx: number,
  eaveY: number,
  wTiles: number,
  hTiles: number,
  peakPx: number,
  roofHex = '#c2543a',
): void {
  const c = footprintCorners(cx, eaveY, wTiles, hTiles, 0.02);
  // Compute ridge line along the longer axis
  const ridgeFrac = 0.28;
  let r1: [number, number];
  let r2: [number, number];
  if (wTiles >= hTiles) {
    const dx = (wTiles - hTiles * 0.65) * 0.36 * HALF_W;
    const dy = (wTiles - hTiles * 0.65) * 0.36 * HALF_H;
    r1 = [cx - dx, eaveY - peakPx - dy];
    r2 = [cx + dx, eaveY - peakPx + dy];
  } else {
    const dx = -(hTiles - wTiles * 0.65) * 0.36 * HALF_W;
    const dy = (hTiles - wTiles * 0.65) * 0.36 * HALF_H;
    r1 = [cx - dx, eaveY - peakPx - dy];
    r2 = [cx + dx, eaveY - peakPx + dy];
  }
  void ridgeFrac;

  // Back-lit NW slope
  drawPoly(ctx, [c.n, c.e, r2, r1], shadeColor(roofHex, 1.06, '#ffe0a0', 0.14));
  // Left-lit SW slope (brightest terracotta!)
  const swGrad = ctx.createLinearGradient(r1[0], r1[1], c.s[0], c.s[1]);
  swGrad.addColorStop(0, shadeColor(roofHex, 1.18, '#ffe0a0', 0.22));
  swGrad.addColorStop(1, shadeColor(roofHex, 0.94));
  drawPoly(ctx, [c.w, c.s, r2, r1], swGrad);
  // Shadowed SE end hip
  drawPoly(ctx, [c.s, c.e, r2], shadeColor(roofHex, 0.72, '#2b2550', 0.26));
  // Left NW hip
  drawPoly(ctx, [c.n, c.w, r1], shadeColor(roofHex, 1.12, '#ffe0a0', 0.16));

  // Crisp terracotta ridge highlight
  ctx.strokeStyle = shadeColor(roofHex, 1.32, '#ffe8b0', 0.35);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(r1[0], r1[1]);
  ctx.lineTo(r2[0], r2[1]);
  ctx.stroke();
}

export function drawIsoDome(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  rx: number,
  ry: number,
  colorHex: string,
): void {
  const grad = ctx.createRadialGradient(cx - rx * 0.35, baseY - ry * 0.65, rx * 0.1, cx, baseY - ry * 0.2, rx * 1.15);
  grad.addColorStop(0, shadeColor(colorHex, 1.35, '#fff6d0', 0.35));
  grad.addColorStop(0.55, colorHex);
  grad.addColorStop(1, shadeColor(colorHex, 0.62, '#2b2550', 0.28));

  ctx.beginPath();
  ctx.ellipse(cx, baseY, rx, rx * 0.42, 0, 0, Math.PI);
  ctx.ellipse(cx, baseY, rx, ry, 0, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
}
