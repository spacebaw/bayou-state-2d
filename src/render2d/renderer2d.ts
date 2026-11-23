import { CATALOG } from '../sim/catalog';
import { idx, inBounds } from '../sim/terrain';
import {
  BuildingId,
  GameState,
  MAP_SIZE,
  OverlayMode,
  SurfaceType,
  TileFlag,
  TileType,
} from '../sim/types';
import {
  drawBuilding2D,
  drawPixelGator,
  drawPixelPirogue,
  drawPixelStudent,
  drawPixelVehicle,
  drawTree2D,
  LightGlow,
} from './buildings2d';
import {
  Camera2D,
  drawPoly,
  ELEV_PX,
  footprintCorners,
  HALF_H,
  HALF_W,
  tileToIso,
} from './iso';
import {
  CachedSprite,
  drawPxHippedRoof,
  drawPxPrism,
  getTerrainAtlas,
  PAL,
  PixelBuffer,
} from './pixel';

interface Particle2D {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

const structCache = new Map<string, CachedSprite>();

function getStructureSprite(
  kind: 'levee' | 'floodwall' | 'floodgate_open' | 'floodgate_closed' | 'fence' | 'breezeway_x' | 'breezeway_y',
): CachedSprite {
  const hit = structCache.get(kind);
  if (hit) return hit;

  const pb = new PixelBuffer(76, 68);
  const cx = 38;
  const by = 48;

  if (kind === 'levee') {
    drawPxPrism(pb, cx, by, 1.0, 1.0, 12, '#629c3a', '#75bf45', { inset: 0.02, cornice: false });
    pb.line(cx - 30, by + 1, cx, by + 15, PAL.cliffMid);
    pb.line(cx, by + 15, cx + 30, by + 1, PAL.cliffDark);
  } else if (kind === 'floodwall') {
    drawPxPrism(pb, cx, by, 0.94, 0.94, 21, '#b8bec7', '#d8dee6', { inset: 0.08, cornice: true });
    pb.line(cx - 10, by - 12, cx - 10, by + 6, PAL.roadShade);
    pb.line(cx + 10, by - 12, cx + 10, by + 6, PAL.roadShade);
  } else if (kind === 'floodgate_open' || kind === 'floodgate_closed') {
    drawPxPrism(pb, cx - 14, by - 3, 0.34, 0.34, 24, '#b8bec7', '#d8dee6', { inset: 0.02 });
    drawPxPrism(pb, cx + 14, by + 3, 0.34, 0.34, 24, '#b8bec7', '#d8dee6', { inset: 0.02 });
    if (kind === 'floodgate_closed') {
      drawPxPrism(pb, cx, by, 0.88, 0.34, 21, '#d95432', '#f2784b', { inset: 0.04, cornice: false });
      pb.line(cx - 12, by - 12, cx + 12, by - 4, PAL.goldHi);
    }
  } else if (kind === 'breezeway_x' || kind === 'breezeway_y') {
    // Iconic LSU Theodore Link Covered Terracotta Arched Colonnade Breezeway!
    const bw = kind === 'breezeway_x' ? 0.98 : 0.62;
    const bh = kind === 'breezeway_x' ? 0.62 : 0.98;
    drawPxPrism(pb, cx, by, bw, bh, 14, '#f0dcb4', '#d95e38', { inset: 0.02, arches: true, cornice: true });
    drawPxHippedRoof(pb, cx, by - 14, bw + 0.06, bh + 0.06, 9, '#d95e38', 0.0);
  } else if (kind === 'fence') {
    for (const [ox, oy] of [[-12, -2], [0, 4], [12, -2]] as [number, number][]) {
      pb.rect(cx + ox - 1, by + oy - 11, 2, 11, PAL.roadShade);
    }
    pb.line(cx - 12, by - 9, cx, by - 3, PAL.stoneHi);
    pb.line(cx, by - 3, cx + 12, by - 9, PAL.stoneMid);
    pb.line(cx - 12, by - 5, cx, by + 1, PAL.stoneHi);
    pb.line(cx, by + 1, cx + 12, by - 5, PAL.stoneMid);
  }

  pb.applyOutline(PAL.outline);
  const sp = pb.toSprite(cx, by);
  structCache.set(kind, sp);
  return sp;
}

export class Renderer2D {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private readonly pxCanvas: HTMLCanvasElement;
  private readonly pxCtx: CanvasRenderingContext2D;
  private readonly shadowCanvas: HTMLCanvasElement;
  private readonly shadowCtx: CanvasRenderingContext2D;
  readonly camera: Camera2D;
  private readonly container: HTMLElement;
  private viewW = 1280;
  private viewH = 720;
  private pxScale = 1.0; // 1:1 razor-sharp pixel-art buffer for crisp architectural detail!
  private particles: Particle2D[] = [];
  private lastFireworkTick = -1;
  private confettiTimer = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.canvas.style.imageRendering = 'pixelated';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;

    this.pxCanvas = document.createElement('canvas');
    this.pxCtx = this.pxCanvas.getContext('2d')!;
    this.pxCtx.imageSmoothingEnabled = false;

    this.shadowCanvas = document.createElement('canvas');
    this.shadowCtx = this.shadowCanvas.getContext('2d')!;
    this.shadowCtx.imageSmoothingEnabled = false;

    this.camera = new Camera2D();
    this.onResize();
    window.addEventListener('resize', this.onResize);
  }

  private onResize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewW = this.container.clientWidth || window.innerWidth;
    this.viewH = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.canvas.width = Math.round(this.viewW * dpr);
    this.canvas.height = Math.round(this.viewH * dpr);
    this.pxCanvas.width = Math.max(320, Math.round(this.viewW / this.pxScale));
    this.pxCanvas.height = Math.max(200, Math.round(this.viewH / this.pxScale));
    this.shadowCanvas.width = this.pxCanvas.width;
    this.shadowCanvas.height = this.pxCanvas.height;
    this.ctx.imageSmoothingEnabled = false;
    this.pxCtx.imageSmoothingEnabled = false;
    this.shadowCtx.imageSmoothingEnabled = false;
  };

  getSize(): { w: number; h: number } {
    return { w: this.viewW, h: this.viewH };
  }

  private computeNightAmount(state: GameState): { night: number; golden: number; storm: number } {
    const p = state.skyProgress;
    const storm = state.storm.active
      ? Math.min(1, 0.55 + state.storm.windIntensity * 0.45)
      : state.rainRate * 0.4;
    let night = 0;
    let golden = 0;
    if (p < 0.1) {
      const t = p / 0.1;
      night = 1 - t;
      golden = Math.sin(t * Math.PI);
    } else if (p < 0.5) {
      night = 0;
    } else if (p < 0.62) {
      const t = (p - 0.5) / 0.12;
      golden = Math.sin(t * Math.PI);
      night = t * 0.35;
    } else if (p < 0.72) {
      const t = (p - 0.62) / 0.1;
      golden = (1 - t) * 0.65;
      night = 0.35 + t * 0.65;
    } else {
      night = 1;
    }
    return { night, golden, storm };
  }

  private spawnFireworks(wx: number, wy: number): void {
    const cols = ['#ffe45e', '#a35cff', '#fff5dc', '#f5b700'];
    for (let burst = 0; burst < 3; burst++) {
      const bx = wx + (Math.random() - 0.5) * 90;
      const by = wy - 55 - Math.random() * 45;
      const col = cols[burst % cols.length];
      for (let i = 0; i < 26; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 25 + Math.random() * 75;
        this.particles.push({
          x: bx,
          y: by,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 20,
          life: 1.2 + Math.random() * 0.6,
          maxLife: 1.8,
          color: col,
          size: 3,
        });
      }
    }
  }

  private spawnConfetti(wx: number, wy: number): void {
    const cols = ['#8746d4', '#ffd84d', '#34c966'];
    for (let i = 0; i < 6; i++) {
      this.particles.push({
        x: wx + (Math.random() - 0.5) * 14,
        y: wy - 20,
        vx: (Math.random() - 0.5) * 35,
        vy: -25 - Math.random() * 35,
        life: 1.1 + Math.random() * 0.5,
        maxLife: 1.6,
        color: cols[i % 3],
        size: 3,
      });
    }
  }

  renderFrame(
    state: GameState,
    dt: number,
    elapsed: number,
    ghost: {
      toolId: BuildingId | null;
      bulldoze: boolean;
      tx: number;
      ty: number;
      rot: 0 | 1 | 2 | 3;
      pilings: boolean;
      valid: boolean;
      snapped: boolean;
    },
    cursorTile: { tx: number; ty: number } | null,
  ): void {
    const pw = this.pxCanvas.width;
    const ph = this.pxCanvas.height;
    const ctx = this.pxCtx;
    ctx.imageSmoothingEnabled = false;

    const { night, golden, storm } = this.computeNightAmount(state);
    const lightning = state.storm.active ? state.storm.lightningFlash : 0;

    ctx.save();

    // 1. Crisp 16-bit Banded Horizon Sky Backdrop
    const skyTop = storm > 0.3
      ? '#26344a'
      : night > 0.5
        ? '#1a2442'
        : golden > 0.35
          ? '#6e528a'
          : '#3d7cc9';
    const skyMid = storm > 0.3
      ? '#3a4b63'
      : night > 0.5
        ? '#26345c'
        : golden > 0.35
          ? '#d67e56'
          : '#68b0e3';
    const skyBot = storm > 0.3
      ? '#4e6078'
      : night > 0.5
        ? '#314575'
        : golden > 0.35
          ? '#f5c278'
          : '#9be0f2';
    ctx.fillStyle = skyTop;
    ctx.fillRect(0, 0, pw, Math.ceil(ph * 0.34));
    ctx.fillStyle = skyMid;
    ctx.fillRect(0, Math.floor(ph * 0.34), pw, Math.ceil(ph * 0.34));
    ctx.fillStyle = skyBot;
    ctx.fillRect(0, Math.floor(ph * 0.68), pw, ph);

    const shakeX = this.camera.shakeAmount > 0 ? Math.round((Math.random() - 0.5) * this.camera.shakeAmount) : 0;
    const shakeY = this.camera.shakeAmount > 0 ? Math.round((Math.random() - 0.5) * this.camera.shakeAmount) : 0;
    const z = this.camera.zoom / this.pxScale;

    ctx.save();
    ctx.translate(Math.round(pw * 0.5 + shakeX), Math.round(ph * 0.5 + shakeY));
    ctx.scale(z, z);
    ctx.translate(Math.round(-this.camera.x), Math.round(-this.camera.y));

    const padW = (pw * 0.5) / z + 150;
    const padH = (ph * 0.5) / z + 170;
    const minWX = this.camera.x - padW;
    const maxWX = this.camera.x + padW;
    const minWY = this.camera.y - padH;
    const maxWY = this.camera.y + padH;

    const tiles = state.tiles;
    const waterStage = Math.max(0.25, state.bayouStage);
    const atlas = getTerrainAtlas();
    const waterFrame = Math.floor(elapsed * 3.2) & 3;
    const lights: LightGlow[] = [];

    // ===== PASS 1: CACHED 16-BIT TERRAIN TILES, CLIFF SKIRTS, SURFACES & OVERLAYS =====
    for (let sum = 0; sum <= (MAP_SIZE - 1) * 2; sum++) {
      const txMin = Math.max(0, sum - (MAP_SIZE - 1));
      const txMax = Math.min(MAP_SIZE - 1, sum);

      for (let tx = txMin; tx <= txMax; tx++) {
        const ty = sum - tx;
        const i = idx(tx, ty);
        const f = tiles.flags[i];
        const isWater = (f & (TileFlag.OpenWater | TileFlag.Bayou)) !== 0;
        const isCanal = (f & TileFlag.Canal) !== 0;
        const elev = isWater ? waterStage : isCanal ? tiles.elev[i] - 1.7 : tiles.elev[i];

        const p = tileToIso(tx + 0.5, ty + 0.5, elev);
        if (p.x < minWX || p.x > maxWX || p.y < minWY || p.y > maxWY) continue;

        const ix = Math.round(p.x);
        const iy = Math.round(p.y);
        const cN: [number, number] = [ix, iy - HALF_H];
        const cE: [number, number] = [ix + HALF_W, iy];
        const cS: [number, number] = [ix, iy + HALF_H];
        const cW: [number, number] = [ix - HALF_W, iy];

        // Pixel earthen cliff skirts when higher than SE/SW neighbors!
        if (!isWater) {
          const eS = inBounds(tx, ty + 1) ? tiles.elev[idx(tx, ty + 1)] : 0;
          const eE = inBounds(tx + 1, ty) ? tiles.elev[idx(tx + 1, ty)] : 0;
          const dropW = Math.max(0, elev - Math.max(0, eS)) * ELEV_PX;
          const dropE = Math.max(0, elev - Math.max(0, eE)) * ELEV_PX;
          if (dropW > 1.2) {
            drawPoly(ctx, [cW, cS, [cS[0], Math.round(cS[1] + dropW + 2)], [cW[0], Math.round(cW[1] + dropW + 2)]], '#7d5c3e', '#23152b', 1);
          }
          if (dropE > 1.2) {
            drawPoly(ctx, [cS, cE, [cE[0], Math.round(cE[1] + dropE + 2)], [cS[0], Math.round(cS[1] + dropE + 2)]], '#573d2c', '#23152b', 1);
          }
        }

        const variant = (tx * 5 + ty * 13) & 3;
        let tileSprite: CachedSprite;
        if (isWater) {
          tileSprite = f & TileFlag.Bayou ? atlas.bayou[waterFrame] : atlas.river[waterFrame];
        } else if (isCanal) {
          tileSprite = atlas.canal;
        } else {
          const t = tiles.type[i];
          if (t === TileType.High) tileSprite = atlas.high[variant];
          else if (t === TileType.Dry || t === TileType.Drained) tileSprite = atlas.dry[variant];
          else if (t === TileType.Wet) tileSprite = atlas.wet[variant];
          else if (t === TileType.Pond) tileSprite = atlas.pond;
          else tileSprite = f & TileFlag.Preserve ? atlas.preserve[variant] : atlas.swamp[variant];
        }

        ctx.drawImage(tileSprite.canvas, ix - 32, iy - 16);

        // Organic 16-state auto-tiled Bayou Riverbanks: exposed earthen cliff + overhanging emerald grass lip + reeds & lily pads!
        if (isWater) {
          const isLand = (nx: number, ny: number): boolean =>
            inBounds(nx, ny) && (tiles.flags[idx(nx, ny)] & (TileFlag.OpenWater | TileFlag.Bayou)) === 0;
          const landN = isLand(tx, ty - 1);
          const landW = isLand(tx - 1, ty);
          const landS = isLand(tx, ty + 1);
          const landE = isLand(tx + 1, ty);

          if (landN) {
            // Exposed earthen mud bank + dark turquoise water shadow + wavy overhanging emerald grass fringe!
            drawPoly(ctx, [cN, cE, [cE[0], cE[1] + 5], [cN[0], cN[1] + 5]], '#6e4d32', '#23152b', 1);
            ctx.strokeStyle = '#40a628';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(cN[0] + 1, cN[1] + 1);
            ctx.lineTo(cE[0] - 1, cE[1] + 1);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(184, 255, 247, 0.85)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cN[0] + 3, cN[1] + 7);
            ctx.lineTo(cE[0] - 3, cE[1] + 7);
            ctx.stroke();
          }
          if (landW) {
            drawPoly(ctx, [cW, cN, [cN[0], cN[1] + 5], [cW[0], cW[1] + 5]], '#523828', '#23152b', 1);
            ctx.strokeStyle = '#52bf30';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(cW[0] + 1, cW[1] + 1);
            ctx.lineTo(cN[0] - 1, cN[1] + 1);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(184, 255, 247, 0.85)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cW[0] + 3, cW[1] + 7);
            ctx.lineTo(cN[0] - 3, cN[1] + 7);
            ctx.stroke();
          }
          if (landS) {
            // Subtle dark-outlined foreground bank edge where emerald grass hugs the south bank
            ctx.strokeStyle = '#23152b';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cW[0], cW[1]);
            ctx.lineTo(cS[0], cS[1]);
            ctx.stroke();
          }
          if (landE) {
            ctx.strokeStyle = '#23152b';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cS[0], cS[1]);
            ctx.lineTo(cE[0], cE[1]);
            ctx.stroke();
          }

          if ((landN || landW) && (tx * 7 + ty * 11) % 2 === 0) {
            // Lush pixel cattail & marsh reed cluster along bank!
            const rx = landN ? ix + 9 : ix - 11;
            const ry = iy - 4;
            ctx.fillStyle = '#23152b';
            ctx.fillRect(rx - 3, ry - 11, 9, 12);
            ctx.fillStyle = '#3ca128';
            ctx.fillRect(rx - 2, ry - 9, 2, 9);
            ctx.fillRect(rx + 1, ry - 10, 2, 10);
            ctx.fillRect(rx + 4, ry - 7, 2, 7);
            ctx.fillStyle = '#7a4424';
            ctx.fillRect(rx + 1, ry - 11, 2, 4);
            ctx.fillRect(rx - 2, ry - 9, 2, 3);
          } else if (!landN && !landW && (tx * 13 + ty * 7) % 9 === 0) {
            // Floating bright green lily pad cluster w/ pink lotus blossom!
            ctx.fillStyle = '#23152b';
            ctx.fillRect(ix - 6, iy - 2, 11, 6);
            ctx.fillStyle = '#52bf30';
            ctx.fillRect(ix - 5, iy - 1, 9, 4);
            ctx.fillStyle = '#ff7eb6';
            ctx.fillRect(ix - 2, iy - 2, 3, 2);
          }
        }

        // Translucent rising Overland Floodwater!
        const depth = tiles.depth[i];
        if (!isWater && !isCanal && depth >= 0.14) {
          const alpha = Math.min(0.78, 0.30 + depth * 0.26);
          drawPoly(ctx, [cN, cE, cS, cW], `rgba(36, 152, 168, ${alpha})`);
        }

        // Unowned State Land misty indigo parcel veil + dashed gold boundary
        const pIdx = Math.floor(ty / 16) * 4 + Math.floor(tx / 16);
        if (state.ownedParcels && !state.ownedParcels[pIdx] && !isWater) {
          drawPoly(ctx, [cN, cE, cS, cW], 'rgba(28, 34, 62, 0.24)');
          if (tx % 16 === 0 || ty % 16 === 0) {
            ctx.strokeStyle = 'rgba(255, 224, 138, 0.55)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            if (tx % 16 === 0) {
              ctx.moveTo(cN[0], cN[1]);
              ctx.lineTo(cW[0], cW[1]);
            }
            if (ty % 16 === 0) {
              ctx.moveTo(cN[0], cN[1]);
              ctx.lineTo(cE[0], cE[1]);
            }
            ctx.stroke();
          }
        }

        // Diagnostic Overlays (Flood Risk, Elevation, Power Grid, Ecology, Mosquitoes)
        if (state.overlay !== OverlayMode.None && !isWater) {
          let ovColor: string | null = null;
          if (state.overlay === OverlayMode.FloodRisk) {
            const isProt = (f & TileFlag.Protected) !== 0;
            if (isProt) ovColor = 'rgba(46, 212, 118, 0.52)';
            else if (tiles.elev[i] < 3.0) ovColor = 'rgba(242, 62, 62, 0.62)';
            else if (tiles.elev[i] < 5.0) ovColor = 'rgba(248, 158, 42, 0.54)';
            else ovColor = 'rgba(245, 224, 92, 0.28)';
          } else if (state.overlay === OverlayMode.Elevation) {
            const e = tiles.elev[i];
            if (e > 6.5) ovColor = 'rgba(54, 184, 72, 0.54)';
            else if (e > 4.0) ovColor = 'rgba(218, 206, 62, 0.48)';
            else if (e > 2.0) ovColor = 'rgba(240, 134, 48, 0.50)';
            else ovColor = 'rgba(224, 52, 64, 0.54)';
          } else if (state.overlay === OverlayMode.Utilities) {
            const bid = tiles.owner[i];
            const b = bid > 0 ? state.buildings[bid] : null;
            if (b) ovColor = b.powered ? 'rgba(66, 228, 128, 0.62)' : 'rgba(242, 54, 54, 0.72)';
          } else if (state.overlay === OverlayMode.Ecology) {
            if (f & TileFlag.Preserve) ovColor = 'rgba(48, 226, 124, 0.58)';
            else if (tiles.type[i] === TileType.Wet || tiles.type[i] === TileType.Marsh) ovColor = 'rgba(38, 178, 146, 0.42)';
          } else if (state.overlay === OverlayMode.Mosquito) {
            const m = tiles.mosq[i];
            if (m > 0.55) ovColor = 'rgba(214, 56, 224, 0.62)';
            else if (m > 0.25) ovColor = 'rgba(245, 168, 42, 0.46)';
          }
          if (ovColor) drawPoly(ctx, [cN, cE, cS, cW], ovColor);
        }

        // ===== HANDCRAFTED 16-BIT SURFACES =====
        const surf = tiles.surface[i];
        if (surf !== SurfaceType.None && surf !== SurfaceType.GatorFence) {
          this.drawSurfaceTile(ctx, state, tx, ty, ix, iy, elev, waterStage, surf, night, lights, atlas);
        }
      }
    }

    // ===== PASS 1.5: UNIFIED SUNLIT GROUND SHADOW PASS (ZERO OVERLAPPING DARK BLOBS!) =====
    const sCtx = this.shadowCtx;
    sCtx.save();
    sCtx.setTransform(1, 0, 0, 1, 0, 0);
    sCtx.clearRect(0, 0, pw, ph);
    sCtx.translate(Math.round(pw * 0.5 + shakeX), Math.round(ph * 0.5 + shakeY));
    sCtx.scale(z, z);
    sCtx.translate(Math.round(-this.camera.x), Math.round(-this.camera.y));
    sCtx.fillStyle = '#0c201b';

    // Building SE cast shadows (sun from upper-left!)
    for (const b of state.buildings) {
      if (!b || b.type === 'practice_field' || b.type === 'pond' || b.type === 'rookery') continue;
      let maxElev = 0;
      for (let dy = 0; dy < b.h; dy++) {
        for (let dx = 0; dx < b.w; dx++) {
          const ii = idx(b.tx + dx, b.ty + dy);
          if (tiles.elev[ii] > maxElev) maxElev = tiles.elev[ii];
        }
      }
      const p = tileToIso(b.tx + b.w * 0.5, b.ty + b.h * 0.5, maxElev);
      if (p.x < minWX - 140 || p.x > maxWX + 140 || p.y < minWY - 160 || p.y > maxWY + 160) continue;
      const fp = footprintCorners(p.x, p.y, b.w, b.h, 0.04);
      const shDist = b.type === 'bell_tower' ? 42 : Math.min(36, 15 + Math.max(b.w, b.h) * 6);
      const shY = Math.round(shDist * 0.34);
      drawPoly(
        sCtx,
        [
          fp.n,
          [fp.n[0] + shDist, fp.n[1] + shY],
          [fp.e[0] + shDist, fp.e[1] + shY],
          [fp.s[0] + shDist, fp.s[1] + shY],
          fp.s,
          fp.e,
        ],
        '#0c201b',
      );
    }

    // Tree canopy ground shadows
    for (const tree of state.veg) {
      const txI = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(tree.tx)));
      const tyI = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(tree.ty)));
      const elev = Math.max(0.25, tiles.elev[idx(txI, tyI)]);
      const p = tileToIso(tree.tx, tree.ty, elev);
      if (p.x < minWX || p.x > maxWX || p.y < minWY || p.y > maxWY) continue;
      const rx = tree.kind === 'oak' ? 29 : tree.kind === 'cypress' ? 17 : 8;
      const ry = tree.kind === 'oak' ? 12 : tree.kind === 'cypress' ? 7 : 4;
      sCtx.beginPath();
      sCtx.ellipse(Math.round(p.x + 7), Math.round(p.y + 2), rx, ry, 0, 0, Math.PI * 2);
      sCtx.fill();
    }

    // Student drop shadows
    for (const s of state.agents) {
      const txI = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(s.x)));
      const tyI = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(s.y)));
      const tileI = idx(txI, tyI);
      const isBoard = tiles.surface[tileI] === SurfaceType.Boardwalk || tiles.surface[tileI] === SurfaceType.Bridge;
      const elev = isBoard ? Math.max(tiles.elev[tileI], waterStage + 0.9) : Math.max(0.25, tiles.elev[tileI]);
      const p = tileToIso(s.x, s.y, elev);
      if (p.x < minWX || p.x > maxWX || p.y < minWY || p.y > maxWY) continue;
      sCtx.beginPath();
      sCtx.ellipse(Math.round(p.x + 2), Math.round(p.y + 1), 4, 2, 0, 0, Math.PI * 2);
      sCtx.fill();
    }
    sCtx.restore();

    // Composite unified ground shadow mask ONCE cleanly over terrain & brick paths!
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = Math.max(0.14, 0.34 * (1 - night * 0.55) * (1 - storm * 0.35));
    ctx.drawImage(this.shadowCanvas, 0, 0);
    ctx.restore();

    // ===== PASS 2: DEPTH-SORTED 16-BIT SPRITES =====
    type RenderItem = { depth: number; draw: () => void };
    const items: RenderItem[] = [];

    // 2a. Levees, Floodwalls, Floodgates, Gator Fences & Auto-Linked LSU Covered Breezeways!
    for (let ty = 0; ty < MAP_SIZE; ty++) {
      for (let tx = 0; tx < MAP_SIZE; tx++) {
        const i = idx(tx, ty);
        const f = tiles.flags[i];
        const hasLevee = tiles.crest[i] > 0.3;
        const hasWall = (f & TileFlag.Floodwall) !== 0;
        const hasGate = (f & TileFlag.Floodgate) !== 0;
        const hasFence = tiles.surface[i] === SurfaceType.GatorFence;

        // Auto-link adjacent academic buildings with iconic LSU Covered Terracotta Arched Breezeways!
        let breezeDir: 'breezeway_x' | 'breezeway_y' | null = null;
        if (tiles.surface[i] === SurfaceType.Path && tiles.owner[i] === 0 && !hasLevee && !hasWall) {
          const ownL = inBounds(tx - 1, ty) ? tiles.owner[idx(tx - 1, ty)] : 0;
          const ownR = inBounds(tx + 1, ty) ? tiles.owner[idx(tx + 1, ty)] : 0;
          const ownU = inBounds(tx, ty - 1) ? tiles.owner[idx(tx, ty - 1)] : 0;
          const ownD = inBounds(tx, ty + 1) ? tiles.owner[idx(tx, ty + 1)] : 0;
          if (ownL > 0 && ownR > 0 && ownL !== ownR) breezeDir = 'breezeway_x';
          else if (ownU > 0 && ownD > 0 && ownU !== ownD) breezeDir = 'breezeway_y';
        }

        if (!hasLevee && !hasWall && !hasGate && !hasFence && !breezeDir) continue;
        const elev = tiles.elev[i];
        const p = tileToIso(tx + 0.5, ty + 0.5, elev);
        if (p.x < minWX || p.x > maxWX || p.y < minWY || p.y > maxWY) continue;

        items.push({
          depth: tx + ty + 0.45,
          draw: () => {
            const sp = breezeDir
              ? getStructureSprite(breezeDir)
              : hasGate
                ? getStructureSprite(state.storm.active ? 'floodgate_closed' : 'floodgate_open')
                : hasWall
                  ? getStructureSprite('floodwall')
                  : hasLevee
                    ? getStructureSprite('levee')
                    : getStructureSprite('fence');
            ctx.drawImage(sp.canvas, Math.round(p.x - sp.anchorX), Math.round(p.y - sp.anchorY));
          },
        });
      }
    }

    // 2b. Buildings
    for (const b of state.buildings) {
      if (!b) continue;
      const cxT = b.tx + b.w * 0.5;
      const cyT = b.ty + b.h * 0.5;
      let maxElev = 0;
      for (let dy = 0; dy < b.h; dy++) {
        for (let dx = 0; dx < b.w; dx++) {
          const ii = idx(b.tx + dx, b.ty + dy);
          if (tiles.elev[ii] > maxElev) maxElev = tiles.elev[ii];
        }
      }
      const p = tileToIso(cxT, cyT, maxElev);
      if (p.x < minWX - 140 || p.x > maxWX + 140 || p.y < minWY - 160 || p.y > maxWY + 160) continue;

      items.push({
        depth: b.tx + b.w - 0.5 + (b.ty + b.h - 0.5),
        draw: () => drawBuilding2D(ctx, b, p.x, p.y, state, elapsed, night, lights),
      });
    }

    // 2c. Louisiana Trees & Flora
    const isAutumn = state.season === 'fall';
    for (const tree of state.veg) {
      const txI = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(tree.tx)));
      const tyI = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(tree.ty)));
      const elev = Math.max(0.25, tiles.elev[idx(txI, tyI)]);
      const p = tileToIso(tree.tx, tree.ty, elev);
      if (p.x < minWX || p.x > maxWX || p.y < minWY || p.y > maxWY) continue;

      items.push({
        depth: tree.tx + tree.ty - 0.15,
        draw: () => drawTree2D(ctx, tree, p.x, p.y, elapsed, isAutumn),
      });
    }

    // 2d. Roaming 4-Direction Animated 16-Bit Pixel Students!
    for (const s of state.agents) {
      const txI = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(s.x)));
      const tyI = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(s.y)));
      const tileI = idx(txI, tyI);
      const isBoard = tiles.surface[tileI] === SurfaceType.Boardwalk || tiles.surface[tileI] === SurfaceType.Bridge;
      const elev = isBoard ? Math.max(tiles.elev[tileI], waterStage + 0.9) : Math.max(0.25, tiles.elev[tileI]);
      const p = tileToIso(s.x, s.y, elev);
      if (p.x < minWX || p.x > maxWX || p.y < minWY || p.y > maxWY) continue;
      const facingRight = (s.vx - s.vy) >= 0;

      items.push({
        depth: s.x + s.y + 0.05,
        draw: () =>
          drawPixelStudent(
            ctx,
            p.x,
            p.y,
            s.shirt,
            elapsed * 6.5 + s.phaseOffset,
            s.hasUmbrella && state.rainRate > 0.2,
            facingRight,
            s.id,
          ),
      });
    }

    // 2e. Bayou Alligators w/ Animated Swimming V-Wake Ripples!
    for (const g of state.gators) {
      const txI = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(g.x)));
      const tyI = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(g.y)));
      const elev = Math.max(waterStage, tiles.elev[idx(txI, tyI)]);
      const p = tileToIso(g.x, g.y, elev);
      if (p.x < minWX || p.x > maxWX || p.y < minWY || p.y > maxWY) continue;
      items.push({
        depth: g.x + g.y,
        draw: () => {
          // Animated sparkling V-wake ripples behind swimming gator!
          const r = 4 + ((elapsed * 8 + g.id * 3) % 8);
          ctx.strokeStyle = 'rgba(184, 255, 247, 0.72)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(Math.round(p.x - 10 - r), Math.round(p.y - 3));
          ctx.lineTo(Math.round(p.x - 6), Math.round(p.y + 1));
          ctx.lineTo(Math.round(p.x - 10 - r), Math.round(p.y + 5));
          ctx.stroke();
          drawPixelGator(ctx, p.x, p.y, elapsed + g.id);
        },
      });
    }

    // 2f. Cajun Pirogues (along bayou spline w/ gentle water wakes!)
    const spline = state.plot.bayouSpline;
    if (spline.length >= 2) {
      for (const pr of state.pirogues) {
        const fIdx = Math.max(0, Math.min(spline.length - 1.001, pr.splinePos * (spline.length - 1)));
        const k0 = Math.floor(fIdx);
        const frac = fIdx - k0;
        const t0 = spline[k0];
        const t1 = spline[Math.min(spline.length - 1, k0 + 1)];
        const x0 = (t0 % MAP_SIZE) + 0.5;
        const y0 = Math.floor(t0 / MAP_SIZE) + 0.5;
        const x1 = (t1 % MAP_SIZE) + 0.5;
        const y1 = Math.floor(t1 / MAP_SIZE) + 0.5;
        const bx = x0 + (x1 - x0) * frac;
        const by = y0 + (y1 - y0) * frac;
        const bob = Math.sin(elapsed * 2.5 + pr.id) * 1.2;
        const p = tileToIso(bx, by, waterStage);
        if (p.x < minWX || p.x > maxWX || p.y < minWY || p.y > maxWY) continue;
        items.push({
          depth: bx + by,
          draw: () => {
            ctx.strokeStyle = 'rgba(184, 255, 247, 0.65)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(Math.round(p.x - 14), Math.round(p.y + 2));
            ctx.lineTo(Math.round(p.x - 22), Math.round(p.y + 5));
            ctx.moveTo(Math.round(p.x - 14), Math.round(p.y + 2));
            ctx.lineTo(Math.round(p.x - 20), Math.round(p.y - 2));
            ctx.stroke();
            drawPixelPirogue(ctx, p.x, p.y + bob, pr.cajunNavy);
          },
        });
      }
    }

    // 2g. Road-Only 16-Bit Vehicles (Fogger Trucks, Shuttles & Mardi Gras Floats!)
    for (const v of state.vehicles) {
      if (!v.active) continue;
      const txI = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(v.x)));
      const tyI = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(v.y)));
      const tileI = idx(txI, tyI);
      const isBr = tiles.surface[tileI] === SurfaceType.Bridge;
      const elev = isBr ? Math.max(tiles.elev[tileI], waterStage + 1.0) : Math.max(0.25, tiles.elev[tileI]);
      const p = tileToIso(v.x, v.y, elev);
      if (p.x < minWX || p.x > maxWX || p.y < minWY || p.y > maxWY) continue;

      if (v.kind === 'parade_float') {
        this.confettiTimer += dt;
        if (this.confettiTimer > 0.09) {
          this.confettiTimer = 0;
          this.spawnConfetti(p.x, p.y);
        }
        lights.push({ x: p.x, y: p.y - 16, r: 42, color: '255, 224, 110', alpha: 0.35 });
      }

      items.push({
        depth: v.x + v.y + 0.12,
        draw: () => {
          drawPixelVehicle(ctx, p.x, p.y, v.kind, v.floatIndex ?? 0);
          if (v.kind === 'fogger') {
            ctx.fillStyle = 'rgba(220, 250, 255, 0.55)';
            ctx.fillRect(Math.round(p.x - 16), Math.round(p.y - 8), 6, 4);
            ctx.fillRect(Math.round(p.x - 22), Math.round(p.y - 11), 5, 4);
          }
        },
      });
    }

    items.sort((a, b) => a.depth - b.depth);
    for (const it of items) it.draw();

    // 2h. Circling Roseate Spoonbills (crisp 16-bit pink birds above marshes!)
    const birdCount = Math.min(8, Math.max(2, state.spoonbillCount));
    const cc = state.plot.chenierCenter;
    for (let bi = 0; bi < birdCount; bi++) {
      const ang = elapsed * (0.28 + (bi % 3) * 0.07) + bi * 1.3;
      const rad = 7 + (bi % 4) * 3.5;
      const bxT = cc.tx + Math.cos(ang) * rad;
      const byT = cc.ty + Math.sin(ang) * rad;
      const p = tileToIso(bxT, byT, 12 + Math.sin(elapsed * 2 + bi) * 1.5);
      if (p.x < minWX || p.x > maxWX || p.y < minWY || p.y > maxWY) continue;
      const flap = Math.round(Math.sin(elapsed * 10 + bi * 2) * 2.5);
      const bx = Math.round(p.x);
      const by = Math.round(p.y);
      ctx.fillStyle = '#23152b';
      ctx.fillRect(bx - 5, by - 1, 10, 3);
      ctx.fillStyle = '#ff7eb6';
      ctx.fillRect(bx - 4, by - flap, 3, 2);
      ctx.fillRect(bx - 1, by, 3, 2);
      ctx.fillRect(bx + 2, by - flap, 3, 2);
    }

    // ===== PASS 3: PIXEL PLACEMENT GHOST & MAGNETIC SNAP PREVIEW =====
    if (ghost.toolId || ghost.bulldoze) {
      const spec = ghost.toolId ? CATALOG[ghost.toolId] : null;
      const w = spec ? (ghost.rot % 2 === 1 ? spec.h : spec.w) : 1;
      const h = spec ? (ghost.rot % 2 === 1 ? spec.w : spec.h) : 1;
      if (inBounds(ghost.tx, ghost.ty)) {
        const elev = Math.max(0.25, tiles.elev[idx(ghost.tx, ghost.ty)]);
        const p = tileToIso(ghost.tx + w * 0.5, ghost.ty + h * 0.5, elev);
        const c = footprintCorners(p.x, p.y, w, h, 0.02);
        const fill = ghost.bulldoze
          ? 'rgba(235, 62, 62, 0.44)'
          : !ghost.valid
            ? 'rgba(235, 62, 62, 0.42)'
            : ghost.snapped
              ? 'rgba(255, 212, 52, 0.46)'
              : 'rgba(66, 224, 120, 0.40)';
        const stroke = ghost.bulldoze || !ghost.valid ? '#ff5252' : ghost.snapped ? '#ffe45e' : '#58f28d';
        drawPoly(ctx, [c.n, c.e, c.s, c.w], fill, stroke, 2);
      }
    }

    // ===== PASS 4: PIXEL FIREWORKS & CONFETTI =====
    if (state.football.fireworkBurstTick > 0 && state.football.fireworkBurstTick !== this.lastFireworkTick) {
      this.lastFireworkTick = state.football.fireworkBurstTick;
      const stad = state.buildings.find((b) => b && b.type === 'stadium');
      if (stad) {
        const sp = tileToIso(stad.tx + stad.w * 0.5, stad.ty + stad.h * 0.5, 4);
        this.spawnFireworks(sp.x, sp.y - 30);
      }
    }
    for (let pi = this.particles.length - 1; pi >= 0; pi--) {
      const pt = this.particles[pi];
      pt.life -= dt;
      if (pt.life <= 0) {
        this.particles.splice(pi, 1);
        continue;
      }
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += 46 * dt;
      ctx.globalAlpha = Math.max(0, Math.min(1, pt.life / pt.maxLife));
      ctx.fillStyle = pt.color;
      ctx.fillRect(Math.round(pt.x), Math.round(pt.y), pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    // ===== PASS 5: LUMINOUS BAYOU NIGHT, ADDITIVE GLOWS & PIXEL FIREFLIES =====
    if (night > 0.05 || storm > 0.15) {
      const nightAlpha = this.camera.brightNight
        ? night * 0.34 + storm * 0.18
        : night * 0.56 + storm * 0.22;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(18, 26, 56, ${Math.min(0.62, nightAlpha)})`;
      ctx.fillRect(0, 0, pw, ph);
      ctx.restore();
    } else if (golden > 0.08) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(255, 162, 68, ${golden * 0.12})`;
      ctx.fillRect(0, 0, pw, ph);
      ctx.restore();
    }

    if (lights.length > 0 && (night > 0.15 || state.football.active || state.parade.active)) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const lg of lights) {
        const g = ctx.createRadialGradient(lg.x, lg.y, 2, lg.x, lg.y, lg.r);
        g.addColorStop(0, `rgba(${lg.color}, ${lg.alpha})`);
        g.addColorStop(0.55, `rgba(${lg.color}, ${lg.alpha * 0.42})`);
        g.addColorStop(1, `rgba(${lg.color}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(lg.x, lg.y, lg.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Crisp Glowing Pixel Fireflies!
    if (night > 0.3) {
      ctx.fillStyle = '#fff08a';
      for (let fi = 0; fi < 38; fi++) {
        const fx = ((fi * 97.3) % 52) + 6 + Math.sin(elapsed * 0.9 + fi) * 1.4;
        const fy = ((fi * 53.7) % 52) + 6 + Math.cos(elapsed * 1.1 + fi * 1.7) * 1.4;
        const fp = tileToIso(fx, fy, 4 + Math.sin(elapsed * 2 + fi) * 1.2);
        if (fp.x < minWX || fp.x > maxWX || fp.y < minWY || fp.y > maxWY) continue;
        if (Math.sin(elapsed * 3.8 + fi * 2.1) > 0.15) {
          ctx.fillRect(Math.round(fp.x), Math.round(fp.y), 2, 2);
        }
      }
    }

    // Warm Pointer Lantern at night
    if (night > 0.25 && cursorTile && inBounds(cursorTile.tx, cursorTile.ty)) {
      const cp = tileToIso(cursorTile.tx + 0.5, cursorTile.ty + 0.5, Math.max(0.5, tiles.elev[idx(cursorTile.tx, cursorTile.ty)]));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const lg = ctx.createRadialGradient(cp.x, cp.y, 4, cp.x, cp.y, 82);
      lg.addColorStop(0, `rgba(255, 224, 150, ${night * 0.24})`);
      lg.addColorStop(1, 'rgba(255, 224, 150, 0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, 82, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();

    // Crisp Pixel Slanted Rain Streaks + Lightning Flash!
    const rainRate = Math.max(state.rainRate, state.storm.active ? state.storm.rainRate : 0);
    if (rainRate > 0.08) {
      const drops = Math.floor(110 * rainRate);
      const slant = Math.round(6 + state.windStrength * 14);
      ctx.strokeStyle = 'rgba(195, 232, 255, 0.52)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let d = 0; d < drops; d++) {
        const rx = Math.round(((d * 73 + elapsed * 290) % (pw + 80)) - 40);
        const ry = Math.round(((d * 109 + elapsed * 540) % (ph + 80)) - 40);
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - Math.round(slant * 0.45), ry + 11);
      }
      ctx.stroke();
    }

    if (lightning > 0.05) {
      ctx.fillStyle = `rgba(230, 245, 255, ${lightning * 0.42})`;
      ctx.fillRect(0, 0, pw, ph);
    }

    ctx.restore();

    // Upscale the crisp 16-bit virtual buffer onto the display canvas with ZERO blur!
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.pxCanvas, 0, 0, pw, ph, 0, 0, this.canvas.width, this.canvas.height);
  }

  private drawSurfaceTile(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    tx: number,
    ty: number,
    ix: number,
    iy: number,
    elev: number,
    waterStage: number,
    surf: SurfaceType,
    night: number,
    lights: LightGlow[],
    atlas: ReturnType<typeof getTerrainAtlas>,
  ): void {
    const tiles = state.tiles;
    const isRoadLike = (x: number, y: number): boolean =>
      inBounds(x, y) &&
      (tiles.surface[idx(x, y)] === SurfaceType.Road || tiles.surface[idx(x, y)] === SurfaceType.Bridge);
    const isPathLike = (x: number, y: number): boolean =>
      inBounds(x, y) &&
      (tiles.surface[idx(x, y)] === SurfaceType.Path ||
        tiles.surface[idx(x, y)] === SurfaceType.Boardwalk ||
        tiles.surface[idx(x, y)] === SurfaceType.Quad ||
        tiles.surface[idx(x, y)] === SurfaceType.ParadeGround);

    if (surf === SurfaceType.Path) {
      ctx.drawImage(atlas.brick.canvas, ix - 32, iy - 16);
      // Crisp cream-stone edge curbs where brick meets open grass!
      ctx.strokeStyle = '#e8dcc2';
      ctx.lineWidth = 1.5;
      if (!isPathLike(tx, ty - 1)) { ctx.beginPath(); ctx.moveTo(ix, iy - HALF_H); ctx.lineTo(ix + HALF_W, iy); ctx.stroke(); }
      if (!isPathLike(tx - 1, ty)) { ctx.beginPath(); ctx.moveTo(ix, iy - HALF_H); ctx.lineTo(ix - HALF_W, iy); ctx.stroke(); }

      const propHash = (tx * 7 + ty * 13) % 12;
      if (propHash === 0) {
        // Ornate black Victorian campus streetlamp!
        ctx.fillStyle = '#23152b';
        ctx.fillRect(ix + 11, iy - 20, 4, 18);
        ctx.fillRect(ix + 10, iy - 22, 6, 4);
        ctx.fillStyle = night > 0.2 ? '#fff08a' : '#f5ebd2';
        ctx.fillRect(ix + 11, iy - 21, 4, 3);
        if (night > 0.2) {
          lights.push({ x: ix + 13, y: iy - 20, r: 40, color: '255, 224, 130', alpha: night * 0.38 });
        }
      } else if (propHash === 5) {
        // Purple & gold Bayou State campus wayfinding sign!
        ctx.fillStyle = '#23152b';
        ctx.fillRect(ix - 15, iy - 11, 2, 9);
        ctx.fillRect(ix - 9, iy - 11, 2, 9);
        ctx.fillRect(ix - 17, iy - 13, 12, 7);
        ctx.fillStyle = '#6128a8';
        ctx.fillRect(ix - 16, iy - 12, 10, 5);
        ctx.fillStyle = '#ffe45e';
        ctx.fillRect(ix - 14, iy - 10, 6, 2);
      }
      return;
    }

    if (surf === SurfaceType.Quad) {
      ctx.drawImage(atlas.quad.canvas, ix - 32, iy - 16);
      const qHash = (tx * 5 + ty * 9) % 10;
      if (qHash === 0) {
        // Slatted wooden campus park bench with dark cast-iron legs!
        ctx.fillStyle = 'rgba(18, 30, 32, 0.35)';
        ctx.fillRect(ix - 6, iy + 1, 14, 3);
        ctx.fillStyle = '#23152b';
        ctx.fillRect(ix - 7, iy - 6, 14, 8);
        ctx.fillStyle = '#c48143';
        ctx.fillRect(ix - 6, iy - 5, 12, 3);
        ctx.fillStyle = '#9e6230';
        ctx.fillRect(ix - 6, iy - 1, 12, 2);
      } else if (qHash === 6) {
        // Campus bike rack populated with colorful tiny parked pixel bicycles!
        ctx.fillStyle = '#23152b';
        for (let bx = -8; bx <= 6; bx += 5) {
          ctx.fillRect(ix + bx, iy - 5, 4, 6);
          ctx.fillStyle = '#d4dce6';
          ctx.fillRect(ix + bx + 1, iy - 4, 2, 4);
          // Colorful parked bike frame!
          ctx.fillStyle = bx === -8 ? '#e84848' : bx === -3 ? '#f7c21b' : '#46a8e0';
          ctx.fillRect(ix + bx, iy - 6, 3, 2);
          ctx.fillStyle = '#23152b';
        }
      }
      return;
    }

    if (surf === SurfaceType.ParadeGround) {
      ctx.drawImage(atlas.plaza.canvas, ix - 32, iy - 16);
      return;
    }

    if (surf === SurfaceType.Road) {
      ctx.drawImage(atlas.road.canvas, ix - 32, iy - 16);
      const rE = isRoadLike(tx + 1, ty);
      const rW = isRoadLike(tx - 1, ty);
      const rS = isRoadLike(tx, ty + 1);
      const rN = isRoadLike(tx, ty - 1);

      ctx.strokeStyle = '#9e978a';
      ctx.lineWidth = 1.5;
      if (!rN) { ctx.beginPath(); ctx.moveTo(ix, iy - HALF_H); ctx.lineTo(ix + HALF_W, iy); ctx.stroke(); }
      if (!rS) { ctx.beginPath(); ctx.moveTo(ix - HALF_W, iy); ctx.lineTo(ix, iy + HALF_H); ctx.stroke(); }
      if (!rW) { ctx.beginPath(); ctx.moveTo(ix, iy - HALF_H); ctx.lineTo(ix - HALF_W, iy); ctx.stroke(); }
      if (!rE) { ctx.beginPath(); ctx.moveTo(ix + HALF_W, iy); ctx.lineTo(ix, iy + HALF_H); ctx.stroke(); }

      ctx.strokeStyle = '#ffd84d';
      ctx.lineWidth = 2;
      if (rE || rW) {
        ctx.beginPath();
        ctx.moveTo(ix - (rW ? 14 : 3), iy - (rW ? 7 : 1));
        ctx.lineTo(ix + (rE ? 14 : 3), iy + (rE ? 7 : 1));
        ctx.stroke();
      }
      if (rN || rS) {
        ctx.beginPath();
        ctx.moveTo(ix + (rN ? 14 : 3), iy - (rN ? 7 : 1));
        ctx.lineTo(ix - (rS ? 14 : 3), iy + (rS ? 7 : 1));
        ctx.stroke();
      }

      const cross = (dx: number, dy: number) => {
        ctx.fillStyle = '#f5eedc';
        for (let s = -1; s <= 1; s++) {
          ctx.fillRect(Math.round(ix + dx + s * 4 - 1), Math.round(iy + dy - s * 2 - 1), 3, 2);
        }
      };
      if (isPathLike(tx + 1, ty)) cross(12, 6);
      if (isPathLike(tx - 1, ty)) cross(-12, -6);
      if (isPathLike(tx, ty + 1)) cross(-12, 6);
      if (isPathLike(tx, ty - 1)) cross(12, -6);

      if ((tx + ty) % 7 === 0) {
        ctx.fillStyle = '#23152b';
        ctx.fillRect(ix - 14, iy - 16, 2, 14);
        ctx.fillStyle = night > 0.2 ? '#fff08a' : '#dfe4ea';
        ctx.fillRect(ix - 15, iy - 18, 4, 3);
        if (night > 0.2) {
          lights.push({ x: ix - 13, y: iy - 16, r: 38, color: '255, 224, 130', alpha: night * 0.36 });
        }
      }
      return;
    }

    if (surf === SurfaceType.Boardwalk || surf === SurfaceType.Bridge) {
      const isBr = surf === SurfaceType.Bridge;
      const deckElev = Math.max(elev, waterStage + (isBr ? 1.0 : 0.7));
      const liftPx = Math.round(Math.max(4, (deckElev - elev) * ELEV_PX + 4));
      const dy = iy - liftPx;

      ctx.fillStyle = isBr ? '#6e6a64' : '#472a1c';
      for (const ox of [-14, 0, 14]) {
        ctx.fillRect(ix + ox - 2, dy + 4, 4, liftPx + 6);
        ctx.fillStyle = isBr ? '#9c968c' : '#855832';
        ctx.fillRect(ix + ox - 2, dy + 4, 2, liftPx + 6);
        ctx.fillStyle = isBr ? '#6e6a64' : '#472a1c';
      }

      const dN: [number, number] = [ix, dy - HALF_H];
      const dE: [number, number] = [ix + HALF_W, dy];
      const dS: [number, number] = [ix, dy + HALF_H];
      const dW: [number, number] = [ix - HALF_W, dy];
      drawPoly(ctx, [dW, dS, [dS[0], dS[1] + 5], [dW[0], dW[1] + 5]], isBr ? '#8c867a' : '#6e4628', '#23152b', 1);
      drawPoly(ctx, [dS, dE, [dE[0], dE[1] + 5], [dS[0], dS[1] + 5]], isBr ? '#69635a' : '#472a1c', '#23152b', 1);
      drawPoly(ctx, [dN, dE, dS, dW], isBr ? '#525666' : '#b8824c', '#23152b', 1);

      if (isBr) {
        ctx.strokeStyle = '#ffd84d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ix - 12, dy - 6);
        ctx.lineTo(ix + 12, dy + 6);
        ctx.stroke();
        ctx.strokeStyle = '#e2d7c2';
        ctx.lineWidth = 2;
        if (!isRoadLike(tx, ty - 1)) {
          ctx.beginPath(); ctx.moveTo(dN[0], dN[1] - 3); ctx.lineTo(dE[0], dE[1] - 3); ctx.stroke();
        }
        if (!isRoadLike(tx, ty + 1)) {
          ctx.beginPath(); ctx.moveTo(dW[0], dW[1] - 3); ctx.lineTo(dS[0], dS[1] - 3); ctx.stroke();
        }
      } else {
        // Concept-Art Arched Stone-and-Timber Footbridge w/ Wooden Planks, Lattice Railings & Stone Piers!
        ctx.strokeStyle = '#6e4628';
        ctx.lineWidth = 1.5;
        for (let k = -12; k <= 12; k += 5) {
          ctx.beginPath();
          ctx.moveTo(ix + k - 8, dy + k * 0.5 + 4);
          ctx.lineTo(ix + k + 8, dy + k * 0.5 - 4);
          ctx.stroke();
        }
        // Timber lattice handrail fences along exposed sides + stone corner posts!
        const hasBW = (nx: number, ny: number): boolean =>
          inBounds(nx, ny) && tiles.surface[idx(nx, ny)] === SurfaceType.Boardwalk;
        const drawRail = (pA: [number, number], pB: [number, number]) => {
          ctx.strokeStyle = '#23152b';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(pA[0], pA[1] - 7); ctx.lineTo(pB[0], pB[1] - 7); ctx.stroke();
          ctx.strokeStyle = '#c4864b';
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(pA[0], pA[1] - 7); ctx.lineTo(pB[0], pB[1] - 7); ctx.stroke();
          // Vertical timber balusters + stone end pillars
          for (let s = 0; s <= 3; s++) {
            const t = s / 3;
            const rx = Math.round(pA[0] + (pB[0] - pA[0]) * t);
            const ry = Math.round(pA[1] + (pB[1] - pA[1]) * t);
            const isPost = s === 0 || s === 3;
            ctx.fillStyle = '#23152b';
            ctx.fillRect(rx - (isPost ? 2 : 1), ry - (isPost ? 9 : 7), isPost ? 5 : 2, isPost ? 9 : 7);
            ctx.fillStyle = isPost ? '#d6c6a5' : '#9e6b3b';
            ctx.fillRect(rx - (isPost ? 1 : 0), ry - (isPost ? 8 : 6), isPost ? 3 : 1, isPost ? 7 : 5);
          }
        };
        if (!hasBW(tx, ty - 1) && !isPathLike(tx, ty - 1)) drawRail(dN, dE);
        if (!hasBW(tx, ty + 1) && !isPathLike(tx, ty + 1)) drawRail(dW, dS);
        if (!hasBW(tx - 1, ty) && !isPathLike(tx - 1, ty)) drawRail(dW, dN);
        if (!hasBW(tx + 1, ty) && !isPathLike(tx + 1, ty)) drawRail(dS, dE);
      }
    }
  }

  capturePostcard(state: GameState, framed: boolean): string {
    if (!framed) return this.canvas.toDataURL('image/png');
    const src = this.canvas;
    const pad = 28;
    const footer = 74;
    const out = document.createElement('canvas');
    out.width = src.width + pad * 2;
    out.height = src.height + pad + footer;
    const c = out.getContext('2d')!;
    c.imageSmoothingEnabled = false;

    c.fillStyle = '#f5ebd2';
    c.fillRect(0, 0, out.width, out.height);
    c.strokeStyle = '#23152b';
    c.lineWidth = 6;
    c.strokeRect(pad - 6, pad - 6, src.width + 12, src.height + 12);
    c.strokeStyle = '#f7c21b';
    c.lineWidth = 3;
    c.strokeRect(pad - 2, pad - 2, src.width + 4, src.height + 4);
    c.drawImage(src, pad, pad);

    c.fillStyle = '#2e1a4a';
    c.font = `700 ${Math.round(Math.max(20, out.width * 0.020))}px "Courier New", monospace`;
    c.textBaseline = 'middle';
    c.fillText('GREETINGS FROM BAYOU STATE UNIVERSITY', pad, src.height + pad + footer * 0.40);

    c.fillStyle = '#5c4b6e';
    c.font = `700 ${Math.round(Math.max(12, out.width * 0.012))}px "Courier New", monospace`;
    c.fillText(
      `YEAR ${state.year}  |  ${state.economy.students.toLocaleString()} STUDENTS  |  PRESTIGE ${state.economy.prestige}  |  LV.${state.economy.campusLevel}`,
      pad,
      src.height + pad + footer * 0.76,
    );

    c.fillStyle = '#23152b';
    c.fillRect(out.width - pad - 52, src.height + pad + 14, 48, 44);
    c.fillStyle = '#f7c21b';
    c.fillRect(out.width - pad - 49, src.height + pad + 17, 42, 38);
    c.fillStyle = '#401775';
    c.font = 'bold 16px "Courier New", monospace';
    c.textAlign = 'center';
    c.fillText('BSU', out.width - pad - 28, src.height + pad + 37);

    return out.toDataURL('image/png');
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
  }
}
