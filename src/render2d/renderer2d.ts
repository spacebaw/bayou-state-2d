import { CATALOG } from '../sim/catalog';
import { idx, inBounds } from '../sim/terrain';
import {
  BuildingId,
  BuildingInstance,
  GameState,
  MAP_SIZE,
  OverlayMode,
  SurfaceType,
  TileFlag,
  TileType,
} from '../sim/types';
import { drawBuilding2D, drawTree2D, LightGlow } from './buildings2d';
import {
  Camera2D,
  drawIsoDome,
  drawIsoPrism,
  drawPoly,
  ELEV_PX,
  footprintCorners,
  HALF_H,
  HALF_W,
  shadeColor,
  tileToIso,
} from './iso';

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

interface DrawItem {
  depth: number;
  draw: () => void;
}

export class Renderer2D {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  camera: Camera2D;
  nightAmount = 0;

  private container: HTMLElement;
  private particles: Particle2D[] = [];
  private lastBurstTick = -100;
  private confettiAccum = 0;
  private viewW = 1280;
  private viewH = 800;

  constructor(container: HTMLElement) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
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
    this.nightAmount = night;
    return { night, golden, storm };
  }

  private spawnFireworks(wx: number, wy: number): void {
    const cols = ['#ffd228', '#a35cff', '#ffffff', '#f5b700'];
    for (let burst = 0; burst < 3; burst++) {
      const bx = wx + (Math.random() - 0.5) * 90;
      const by = wy - 55 - Math.random() * 45;
      const col = cols[burst % cols.length];
      for (let i = 0; i < 28; i++) {
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
          size: 3.2,
        });
      }
    }
  }

  private spawnConfetti(wx: number, wy: number): void {
    const cols = ['#9c42f5', '#ffd228', '#22cc66'];
    for (let i = 0; i < 6; i++) {
      this.particles.push({
        x: wx + (Math.random() - 0.5) * 14,
        y: wy - 20,
        vx: (Math.random() - 0.5) * 35,
        vy: -25 - Math.random() * 35,
        life: 1.1 + Math.random() * 0.5,
        maxLife: 1.6,
        color: cols[i % 3],
        size: 2.6,
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
    const ctx = this.ctx;
    const dpr = this.canvas.width / Math.max(1, this.viewW);
    const { night, golden, storm } = this.computeNightAmount(state);
    const lightning = state.storm.active ? state.storm.lightningFlash : 0;

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Atmospheric Sky/Bayou Backdrop Gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, this.viewH);
    if (storm > 0.45) {
      bgGrad.addColorStop(0, '#2a3745');
      bgGrad.addColorStop(1, '#3b4e5c');
    } else if (night > 0.5) {
      bgGrad.addColorStop(0, this.camera.brightNight ? '#1b2448' : '#111630');
      bgGrad.addColorStop(1, this.camera.brightNight ? '#28365c' : '#1c2444');
    } else if (golden > 0.25) {
      bgGrad.addColorStop(0, '#5a6fa8');
      bgGrad.addColorStop(1, '#e0a572');
    } else {
      bgGrad.addColorStop(0, '#5a99c8');
      bgGrad.addColorStop(1, '#8cc0d8');
    }
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    // Camera transform + shake
    const sxShake = this.camera.shakeAmount > 0 ? (Math.random() - 0.5) * this.camera.shakeAmount : 0;
    const syShake = this.camera.shakeAmount > 0 ? (Math.random() - 0.5) * this.camera.shakeAmount : 0;

    ctx.save();
    ctx.translate(this.viewW * 0.5 + sxShake, this.viewH * 0.5 + syShake);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    // Compute visible world bounds for crisp viewport culling
    const pad = 180 / this.camera.zoom;
    const minWX = this.camera.x - (this.viewW * 0.5) / this.camera.zoom - pad;
    const maxWX = this.camera.x + (this.viewW * 0.5) / this.camera.zoom + pad;
    const minWY = this.camera.y - (this.viewH * 0.5) / this.camera.zoom - pad;
    const maxWY = this.camera.y + (this.viewH * 0.5) / this.camera.zoom + pad;

    const { tiles } = state;
    const rawSurge = state.storm.active ? state.storm.currentSurgeFt : 0;
    const hasBarrier = state.buildings.some(
      (b) => b && b.type === 'surge_barrier' && b.built >= 1 && b.powered && !b.blackout,
    );
    const surge = hasBarrier && rawSurge > 1.5 ? rawSurge * 0.45 : rawSurge;
    const waterStage = Math.max(state.riverStage, state.bayouStage) + surge;

    const lights: LightGlow[] = [];

    const surfAt = (x: number, y: number): SurfaceType =>
      inBounds(x, y) ? (tiles.surface[idx(x, y)] as SurfaceType) : SurfaceType.None;
    const isRoadLike = (x: number, y: number): boolean => {
      const sf = surfAt(x, y);
      return sf === SurfaceType.Road || sf === SurfaceType.Bridge;
    };
    const isWalkConnect = (x: number, y: number): boolean => {
      if (!inBounds(x, y)) return false;
      const sf = surfAt(x, y);
      if (sf !== SurfaceType.None && sf !== SurfaceType.GatorFence) return true;
      return tiles.owner[idx(x, y)] >= 0;
    };

    // ===== PASS 1: TERRAIN DIAMONDS, CLIFF SKIRTS, ANIMATED WATER, SURFACES & OVERLAYS =====
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

        const cN: [number, number] = [p.x, p.y - HALF_H];
        const cE: [number, number] = [p.x + HALF_W, p.y];
        const cS: [number, number] = [p.x, p.y + HALF_H];
        const cW: [number, number] = [p.x - HALF_W, p.y];

        // Determine rich natural Louisiana tile color
        let fill: string;
        if (isWater) {
          const shimmer = 0.5 + 0.5 * Math.sin(elapsed * 2.2 + tx * 0.7 - ty * 0.45);
          fill = f & TileFlag.Bayou
            ? shimmer > 0.65 ? '#357978' : '#2a6568'
            : shimmer > 0.68 ? '#235966' : '#1b4754';
        } else if (isCanal) {
          fill = '#2d6870';
        } else {
          const t = tiles.type[i];
          const toneShift = ((tx * 37 + ty * 17) % 5) * 0.015 - 0.03;
          if (t === TileType.High) fill = shadeColor('#80a64b', 1 + toneShift);
          else if (t === TileType.Dry) fill = shadeColor('#6f9440', 1 + toneShift);
          else if (t === TileType.Wet) fill = shadeColor('#5c783b', 1 + toneShift);
          else if (t === TileType.Pond) fill = '#2e7e8c';
          else fill = f & TileFlag.Preserve ? '#3f7644' : '#4a5c36';
        }

        // Draw subtle earthen cliff skirts when higher than SE/SW neighbors
        if (!isWater) {
          const eS = inBounds(tx, ty + 1) ? tiles.elev[idx(tx, ty + 1)] : 0;
          const eE = inBounds(tx + 1, ty) ? tiles.elev[idx(tx + 1, ty)] : 0;
          const dropW = Math.max(0, elev - Math.max(0, eS)) * ELEV_PX;
          const dropE = Math.max(0, elev - Math.max(0, eE)) * ELEV_PX;
          if (dropW > 1.2) {
            drawPoly(
              ctx,
              [cW, cS, [cS[0], cS[1] + dropW + 2], [cW[0], cW[1] + dropW + 2]],
              '#6b573e',
            );
          }
          if (dropE > 1.2) {
            drawPoly(
              ctx,
              [cS, cE, [cE[0], cE[1] + dropE + 2], [cS[0], cS[1] + dropE + 2]],
              '#4d3d2f',
            );
          }
        }

        // Paint tile diamond with seam-free overlap stroke across all zoom levels
        drawPoly(ctx, [cN, cE, cS, cW], fill, fill, 1.85);

        // Animated water ripple glints on Bayous & Rivers
        if (isWater && (tx + ty) % 2 === 0) {
          const rx = p.x + Math.sin(elapsed * 1.8 + tx * 1.1) * 7;
          ctx.strokeStyle = night > 0.4 ? 'rgba(180,205,255,0.28)' : 'rgba(225,250,255,0.34)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(rx - 6, p.y);
          ctx.lineTo(rx + 6, p.y);
          ctx.stroke();
        }

        // Translucent rising Overland Floodwater!
        const depth = tiles.depth[i];
        if (!isWater && !isCanal && depth >= 0.14) {
          const alpha = Math.min(0.76, 0.25 + depth * 0.25);
          drawPoly(ctx, [cN, cE, cS, cW], `rgba(48, 128, 148, ${alpha})`);
        }

        // Unowned State Land subtle misty veil & dashed border
        const pIdx = Math.floor(ty / 16) * 4 + Math.floor(tx / 16);
        if (state.ownedParcels && !state.ownedParcels[pIdx] && !isWater) {
          drawPoly(ctx, [cN, cE, cS, cW], 'rgba(42, 54, 82, 0.20)');
          if (tx % 16 === 0 || ty % 16 === 0) {
            ctx.strokeStyle = 'rgba(232, 222, 255, 0.52)';
            ctx.lineWidth = 1.2;
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
            if (f & TileFlag.Protected) ovColor = 'rgba(32, 214, 154, 0.50)';
            else if (tiles.risk[i] > 0.1) {
              const sev = Math.min(1, tiles.risk[i] / 4.2);
              ovColor = sev > 0.55 ? 'rgba(230, 57, 70, 0.56)' : 'rgba(245, 166, 35, 0.52)';
            }
          } else if (state.overlay === OverlayMode.Elevation) {
            const t = Math.max(0, Math.min(1, elev / 8.5));
            ovColor = `hsla(${Math.round(28 + t * 110)}, 75%, 48%, 0.48)`;
          } else if (state.overlay === OverlayMode.Ecology) {
            ovColor = f & TileFlag.Preserve
              ? 'rgba(32, 224, 112, 0.45)'
              : tiles.type[i] === TileType.Marsh
                ? 'rgba(59, 168, 107, 0.35)'
                : null;
          } else if (state.overlay === OverlayMode.Mosquito) {
            const mq = tiles.mosq[i];
            ovColor = mq > 0.14
              ? `rgba(217, 38, 98, ${Math.min(0.65, mq * 0.8)})`
              : 'rgba(40, 184, 120, 0.22)';
          } else if (state.overlay === OverlayMode.Utilities) {
            for (const b of state.buildings) {
              if (!b || b.built < 1 || b.flooded) continue;
              if (b.type === 'substation' || b.type === 'generator') {
                const r = b.type === 'substation' ? 18 : 7;
                if (Math.max(Math.abs(tx - (b.tx + 1)), Math.abs(ty - (b.ty + 1))) <= r) {
                  ovColor = 'rgba(245, 200, 66, 0.40)';
                  break;
                }
              }
            }
          }
          if (ovColor) drawPoly(ctx, [cN, cE, cS, cW], ovColor);
        }

        // ===== SURFACE LAYER (Connected Paths, Smart Roads + Crosswalks, Bridges/Boardwalks, Quads!) =====
        const surf = tiles.surface[i] as SurfaceType;
        if (surf === SurfaceType.Quad || surf === SurfaceType.ParadeGround) {
          const qCol = surf === SurfaceType.ParadeGround ? '#64a348' : '#58983e';
          drawPoly(ctx, [cN, cE, cS, cW], qCol, qCol, 0.8);
          // Limestone perimeter kerbs around outer quad edges
          ctx.strokeStyle = '#dfd3b8';
          ctx.lineWidth = 2.4;
          const same = (nx: number, ny: number) => inBounds(nx, ny) && tiles.surface[idx(nx, ny)] === surf;
          if (!same(tx, ty - 1)) { ctx.beginPath(); ctx.moveTo(cN[0], cN[1]); ctx.lineTo(cE[0], cE[1]); ctx.stroke(); }
          if (!same(tx, ty + 1)) { ctx.beginPath(); ctx.moveTo(cW[0], cW[1]); ctx.lineTo(cS[0], cS[1]); ctx.stroke(); }
          if (!same(tx - 1, ty)) { ctx.beginPath(); ctx.moveTo(cN[0], cN[1]); ctx.lineTo(cW[0], cW[1]); ctx.stroke(); }
          if (!same(tx + 1, ty)) { ctx.beginPath(); ctx.moveTo(cE[0], cE[1]); ctx.lineTo(cS[0], cS[1]); ctx.stroke(); }
        } else if (surf === SurfaceType.Path) {
          // Continuous warm brick walkway with connecting arms!
          const core = footprintCorners(p.x, p.y, 0.56, 0.56, 0);
          drawPoly(ctx, [core.n, core.e, core.s, core.w], '#dec6a0', '#c4aa82', 0.8);
          ctx.strokeStyle = '#dec6a0';
          ctx.lineWidth = 10;
          ctx.lineCap = 'round';
          if (isWalkConnect(tx, ty - 1)) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo((cN[0] + cE[0]) * 0.5, (cN[1] + cE[1]) * 0.5); ctx.stroke(); }
          if (isWalkConnect(tx, ty + 1)) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo((cW[0] + cS[0]) * 0.5, (cW[1] + cS[1]) * 0.5); ctx.stroke(); }
          if (isWalkConnect(tx - 1, ty)) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo((cN[0] + cW[0]) * 0.5, (cN[1] + cW[1]) * 0.5); ctx.stroke(); }
          if (isWalkConnect(tx + 1, ty)) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo((cE[0] + cS[0]) * 0.5, (cE[1] + cS[1]) * 0.5); ctx.stroke(); }
          ctx.lineCap = 'butt';

          if ((tx + ty) % 5 === 0 && night > 0.18) {
            lights.push({ x: p.x + 8, y: p.y - 10, r: 28, color: '255, 220, 130', alpha: night * 0.35 });
          }
        } else if (surf === SurfaceType.Road) {
          drawPoly(ctx, [cN, cE, cS, cW], '#3d424b', '#3d424b', 1.1);
          const nR = isRoadLike(tx, ty - 1);
          const sR = isRoadLike(tx, ty + 1);
          const wR = isRoadLike(tx - 1, ty);
          const eR = isRoadLike(tx + 1, ty);
          const hasNS = nR || sR;
          const hasEW = wR || eR;

          // Dashed gold centerline on straight stretches
          ctx.strokeStyle = '#f0c748';
          ctx.lineWidth = 1.8;
          if (hasNS && !hasEW) {
            ctx.beginPath();
            ctx.moveTo(p.x + 8, p.y - 4);
            ctx.lineTo(p.x - 8, p.y + 4);
            ctx.stroke();
          } else if (hasEW && !hasNS) {
            ctx.beginPath();
            ctx.moveTo(p.x - 8, p.y - 4);
            ctx.lineTo(p.x + 8, p.y + 4);
            ctx.stroke();
          }

          // White pedestrian crosswalk bars where paths intercept roads!
          const isPed = (x: number, y: number) => {
            const sf = surfAt(x, y);
            return sf === SurfaceType.Path || sf === SurfaceType.Boardwalk || sf === SurfaceType.Quad;
          };
          if ((isPed(tx - 1, ty) || isPed(tx + 1, ty)) && hasNS) {
            ctx.strokeStyle = 'rgba(244,240,230,0.85)';
            ctx.lineWidth = 2.2;
            for (const o of [-5, 0, 5]) {
              ctx.beginPath();
              ctx.moveTo(p.x - 7 + o, p.y - 3 + o * 0.5);
              ctx.lineTo(p.x + 7 + o, p.y + 3 + o * 0.5);
              ctx.stroke();
            }
          } else if ((isPed(tx, ty - 1) || isPed(tx, ty + 1)) && hasEW) {
            ctx.strokeStyle = 'rgba(244,240,230,0.85)';
            ctx.lineWidth = 2.2;
            for (const o of [-5, 0, 5]) {
              ctx.beginPath();
              ctx.moveTo(p.x + 7 - o, p.y - 3 + o * 0.5);
              ctx.lineTo(p.x - 7 - o, p.y + 3 + o * 0.5);
              ctx.stroke();
            }
          }

          if ((tx + ty) % 4 === 0 && night > 0.18) {
            lights.push({ x: p.x - 10, y: p.y - 12, r: 34, color: '255, 218, 130', alpha: night * 0.38 });
          }
        } else if (surf === SurfaceType.Boardwalk) {
          const deckP = tileToIso(tx + 0.5, ty + 0.5, Math.max(elev + 0.9, 2.2));
          // Timber pilings
          ctx.strokeStyle = '#634529';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(deckP.x - 12, deckP.y);
          ctx.lineTo(deckP.x - 12, p.y + 4);
          ctx.moveTo(deckP.x + 12, deckP.y);
          ctx.lineTo(deckP.x + 12, p.y + 4);
          ctx.stroke();
          drawIsoPrism(ctx, deckP.x, deckP.y + 2, 0.86, 0.86, 3, '#8c643f', '#a67a52', { inset: 0.02 });
        } else if (surf === SurfaceType.Bridge) {
          const deckP = tileToIso(tx + 0.5, ty + 0.5, Math.max(elev + 1.1, 3.6));
          // Concrete piers
          ctx.strokeStyle = '#9c968b';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(deckP.x - 14, deckP.y + 2);
          ctx.lineTo(deckP.x - 14, p.y + 6);
          ctx.moveTo(deckP.x + 14, deckP.y + 2);
          ctx.lineTo(deckP.x + 14, p.y + 6);
          ctx.stroke();
          drawIsoPrism(ctx, deckP.x, deckP.y + 3, 1.0, 0.96, 4, '#5a606b', '#4d535e', { inset: 0.01 });
          // Centerline
          ctx.strokeStyle = '#f0c748';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(deckP.x - 8, deckP.y - 4);
          ctx.lineTo(deckP.x + 8, deckP.y + 4);
          ctx.stroke();
          if ((tx + ty) % 2 === 0 && night > 0.18) {
            lights.push({ x: deckP.x, y: deckP.y - 12, r: 34, color: '255, 224, 145', alpha: night * 0.42 });
          }
        } else if (surf === SurfaceType.GatorFence) {
          ctx.strokeStyle = '#333a36';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(cW[0], cW[1] - 6);
          ctx.lineTo(cE[0], cE[1] - 6);
          ctx.moveTo(cN[0], cN[1] - 6);
          ctx.lineTo(cS[0], cS[1] - 6);
          ctx.stroke();
        }
      }
    }

    // ===== PASS 2: DEPTH-SORTED LEVEES, BUILDINGS, TREES, STUDENTS, VEHICLES, GATORS & PIROGUES =====
    const drawList: DrawItem[] = [];
    const autumnAmt = state.month === 11 ? 1 : state.month === 10 ? 0.45 : 0;
    const windSway = Math.sin(elapsed * (2.2 + state.windStrength * 4.5)) * (1.2 + state.windStrength * 5.5);

    // 2a. Continuous Earthen Levees (+6 ft), Concrete Floodwalls (+12 ft) & Floodgates
    for (let ty = 0; ty < MAP_SIZE; ty++) {
      for (let tx = 0; tx < MAP_SIZE; tx++) {
        const i = idx(tx, ty);
        if (tiles.crest[i] <= 0) continue;
        const p = tileToIso(tx + 0.5, ty + 0.5, tiles.elev[i]);
        if (p.x < minWX || p.x > maxWX || p.y < minWY || p.y > maxWY) continue;
        const isWall = (tiles.flags[i] & TileFlag.Floodwall) !== 0;
        const isGate = (tiles.flags[i] & TileFlag.Floodgate) !== 0;
        const hPx = isWall ? 34 : 18;
        drawList.push({
          depth: tx + ty + 0.5,
          draw: () => {
            if (isGate) {
              drawIsoPrism(ctx, p.x, p.y, 0.96, 0.96, hPx + 4, '#7d8691', '#9aa3ae', { inset: 0.02 });
            } else if (isWall) {
              drawIsoPrism(ctx, p.x, p.y, 0.82, 0.82, hPx, '#b8bdc4', '#d4d8de', { inset: 0.08 });
            } else {
              drawIsoPrism(ctx, p.x, p.y, 1.0, 1.0, hPx, '#5f7e3c', '#769a4a', { inset: 0.02 });
            }
          },
        });
      }
    }

    // 2b. Buildings
    for (const b of state.buildings) {
      if (!b) continue;
      let sumE = 0;
      let cnt = 0;
      for (let dy = 0; dy < b.h; dy++) {
        for (let dx = 0; dx < b.w; dx++) {
          if (inBounds(b.tx + dx, b.ty + dy)) {
            sumE += tiles.elev[idx(b.tx + dx, b.ty + dy)];
            cnt++;
          }
        }
      }
      const baseE = Math.max(0.2, sumE / Math.max(1, cnt));
      const pos = tileToIso(b.tx + b.w * 0.5, b.ty + b.h * 0.5, baseE);
      if (pos.x < minWX - 120 || pos.x > maxWX + 120 || pos.y < minWY - 120 || pos.y > maxWY + 120) continue;

      drawList.push({
        depth: b.tx + b.w - 0.5 + (b.ty + b.h - 0.5),
        draw: () => drawBuilding2D(ctx, state, b, baseE, elapsed, night, lights),
      });
    }

    // 2c. Vegetation (Live Oaks, Bald Cypress, Azaleas, Palmettos)
    for (const v of state.veg) {
      const e = tiles.elev[idx(v.tx, v.ty)];
      const p = tileToIso(v.tx + 0.5, v.ty + 0.5, e);
      if (p.x < minWX || p.x > maxWX || p.y < minWY || p.y > maxWY) continue;
      drawList.push({
        depth: v.tx + v.ty + 0.65,
        draw: () => drawTree2D(ctx, v.kind, p.x, p.y, v.scale, windSway * (0.7 + (v.id % 5) * 0.12), autumnAmt),
      });
    }

    // 2d. Strolling 2D Students (purple/gold/white/lavender shirts + umbrellas in rain!)
    for (const a of state.agents) {
      const tx = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(a.x)));
      const ty = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(a.y)));
      const ti = idx(tx, ty);
      const surf = tiles.surface[ti];
      const elev =
        surf === SurfaceType.Bridge
          ? Math.max(tiles.elev[ti] + 1.1, 3.6)
          : surf === SurfaceType.Boardwalk
            ? Math.max(tiles.elev[ti] + 0.9, 2.2)
            : tiles.elev[ti];
      const p = tileToIso(a.x, a.y, elev);
      if (p.x < minWX || p.x > maxWX || p.y < minWY || p.y > maxWY) continue;
      const bob = Math.abs(Math.sin(elapsed * 5.0 + a.phaseOffset)) * 2.2;
      const col =
        a.shirt === 'purple' ? '#5e2ca5' : a.shirt === 'gold' ? '#f5b700' : a.shirt === 'lavender' ? '#a67de8' : '#f2eff7';

      drawList.push({
        depth: a.x + a.y + 0.1,
        draw: () => {
          ctx.fillStyle = 'rgba(20,16,40,0.28)';
          ctx.beginPath();
          ctx.ellipse(p.x, p.y + 1, 3.2, 1.6, 0, 0, Math.PI * 2);
          ctx.fill();
          // Shirt body + head
          ctx.fillStyle = col;
          ctx.fillRect(p.x - 2.3, p.y - 7.5 - bob, 4.6, 6.2);
          ctx.fillStyle = '#ebcaa8';
          ctx.beginPath();
          ctx.arc(p.x, p.y - 9.5 - bob, 2.3, 0, Math.PI * 2);
          ctx.fill();
          if (a.hasUmbrella) {
            drawIsoDome(ctx, p.x, p.y - 11.5 - bob, 5.5, 3.5, '#5e2ca5');
          }
        },
      });
    }

    // 2e. Alligators (with glowing red night eyes!)
    for (const g of state.gators) {
      const tx = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(g.x)));
      const ty = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(g.y)));
      const elev = Math.max(tiles.elev[idx(tx, ty)], waterStage);
      const p = tileToIso(g.x, g.y, elev);
      if (p.x < minWX || p.x > maxWX || p.y < minWY || p.y > maxWY) continue;
      drawList.push({
        depth: g.x + g.y + 0.15,
        draw: () => {
          ctx.fillStyle = '#3b522a';
          ctx.beginPath();
          ctx.ellipse(p.x, p.y - 2, 9 * g.size, 3.5 * g.size, 0, 0, Math.PI * 2);
          ctx.fill();
          // Signature glowing red alligator eyes on the water at night!
          ctx.fillStyle = '#ff2828';
          ctx.fillRect(p.x + 5, p.y - 4.5, 2, 2);
          ctx.fillRect(p.x + 8, p.y - 3.5, 2, 2);
          if (night > 0.3) {
            lights.push({ x: p.x + 6, y: p.y - 4, r: 10, color: '255, 40, 40', alpha: night * 0.65 });
          }
        },
      });
    }

    // 2f. Pirogues & Cajun Navy Rescue Flatboats
    const spline = state.plot.bayouSpline;
    for (const pr of state.pirogues) {
      if (spline.length < 2) continue;
      const sIdx = Math.max(0, Math.min(spline.length - 2, Math.floor(pr.splinePos)));
      const frac = pr.splinePos - sIdx;
      const i0 = spline[sIdx];
      const i1 = spline[sIdx + 1];
      const fx = (i0 % MAP_SIZE) + ((i1 % MAP_SIZE) - (i0 % MAP_SIZE)) * frac + 0.5;
      const fy = ((i0 / MAP_SIZE) | 0) + (((i1 / MAP_SIZE) | 0) - ((i0 / MAP_SIZE) | 0)) * frac + 0.5;
      const p = tileToIso(fx, fy, waterStage);
      if (p.x < minWX || p.x > maxWX || p.y < minWY || p.y > maxWY) continue;
      drawList.push({
        depth: fx + fy + 0.2,
        draw: () => {
          const bob = Math.sin(elapsed * 3 + pr.id) * 1.2;
          ctx.fillStyle = pr.cajunNavy ? '#c8d2dc' : '#7a5230';
          ctx.beginPath();
          ctx.ellipse(p.x, p.y - 2 + bob, 11, 4.5, -0.35, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = pr.cajunNavy ? '#ff6b22' : '#5e2ca5';
          ctx.fillRect(p.x - 3, p.y - 8 + bob, 4, 5);
          ctx.fillStyle = pr.cajunNavy ? '#ff9f1c' : '#f5b700';
          ctx.fillRect(p.x + 2, p.y - 7 + bob, 4, 5);
        },
      });
    }

    // 2g. Road-Only Vehicles (Campus Shuttles, Fogger Trucks, Wildlife Officers & Mardi Gras Floats!)
    this.confettiAccum += dt;
    const emitConfetti = this.confettiAccum > 0.16;
    if (emitConfetti) this.confettiAccum = 0;

    for (const v of state.vehicles) {
      const tx = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(v.x)));
      const ty = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(v.y)));
      const ti = idx(tx, ty);
      const surf = tiles.surface[ti];
      const elev = surf === SurfaceType.Bridge ? Math.max(tiles.elev[ti] + 1.1, 3.6) : tiles.elev[ti];
      const p = tileToIso(v.x, v.y, elev);
      if (p.x < minWX || p.x > maxWX || p.y < minWY || p.y > maxWY) continue;

      if (v.kind === 'parade_float' && emitConfetti) {
        this.spawnConfetti(p.x, p.y);
      }

      drawList.push({
        depth: v.x + v.y + 0.25,
        draw: () => {
          if (v.kind === 'shuttle') {
            drawIsoPrism(ctx, p.x, p.y - 1, 0.42, 0.72, 10, '#461d7c', '#f5b700', { inset: 0.01 });
            if (night > 0.2) lights.push({ x: p.x, y: p.y - 4, r: 24, color: '255, 240, 175', alpha: night * 0.42 });
          } else if (v.kind === 'fogger') {
            drawIsoPrism(ctx, p.x, p.y - 1, 0.38, 0.62, 8, '#edf2f7', '#389cb5', { inset: 0.01 });
            if (v.active) {
              ctx.fillStyle = 'rgba(220, 246, 255, 0.45)';
              ctx.beginPath();
              ctx.arc(p.x - 10, p.y - 6, 8 + Math.sin(elapsed * 6) * 2, 0, Math.PI * 2);
              ctx.fill();
            }
          } else if (v.kind === 'officer') {
            ctx.fillStyle = '#2d6b3e';
            ctx.fillRect(p.x - 2.6, p.y - 9, 5.2, 7.5);
            ctx.fillStyle = '#9e7545';
            ctx.fillRect(p.x - 4.5, p.y - 12, 9, 2.2);
          } else if (v.kind === 'parade_float') {
            const cols = ['#6b28b8', '#f5b700', '#1ca65c'];
            const c = cols[(v.floatIndex ?? 0) % 3];
            drawIsoPrism(ctx, p.x, p.y - 1, 0.65, 1.0, 14, c, '#ffd228', { inset: 0.01 });
            drawIsoDome(ctx, p.x, p.y - 15, 9, 9, v.floatIndex === 1 ? '#1ca65c' : '#ffd228');
            lights.push({ x: p.x, y: p.y - 10, r: 42, color: '255, 210, 90', alpha: 0.42 });
          }
        },
      });
    }

    // Sort all objects strictly back-to-front and draw!
    drawList.sort((a, b) => a.depth - b.depth);
    for (const item of drawList) item.draw();

    // ===== PASS 3: CIRCLING PINK ROSEATE SPOONBILLS OVER ROOKERY =====
    if (state.spoonbillCount > 0) {
      const rookery = state.buildings.find((b) => b && b.type === 'rookery' && b.built >= 1);
      const rPos = rookery ? tileToIso(rookery.tx + 1, rookery.ty + 1, 2) : tileToIso(22, 36, 2);
      const count = Math.min(10, state.spoonbillCount);
      for (let i = 0; i < count; i++) {
        const ang = elapsed * (0.55 + (i % 3) * 0.1) + (i / count) * Math.PI * 2;
        const bx = rPos.x + Math.cos(ang) * (58 + (i % 3) * 20);
        const by = rPos.y - 72 + Math.sin(ang) * 26;
        const flap = Math.sin(elapsed * 9 + i * 1.5) * 4;
        ctx.strokeStyle = '#ff85b5';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(bx - 7, by + flap);
        ctx.lineTo(bx, by);
        ctx.lineTo(bx + 7, by + flap);
        ctx.stroke();
      }
    }

    // ===== PASS 4: PLACEMENT GHOST PREVIEW =====
    if ((ghost.toolId || ghost.bulldoze) && inBounds(ghost.tx, ghost.ty)) {
      const def = ghost.toolId ? CATALOG[ghost.toolId] : null;
      const w = def ? (ghost.rot % 2 === 1 ? def.h : def.w) : 1;
      const h = def ? (ghost.rot % 2 === 1 ? def.w : def.h) : 1;
      const baseE = Math.max(0.2, tiles.elev[idx(ghost.tx, ghost.ty)]);
      const gp = tileToIso(ghost.tx + w * 0.5, ghost.ty + h * 0.5, baseE);
      const lift = ghost.pilings && def?.canPilings ? 3.0 * ELEV_PX : 0;
      const fillCol = ghost.bulldoze || !ghost.valid
        ? 'rgba(255, 72, 92, 0.45)'
        : ghost.snapped
          ? 'rgba(245, 200, 66, 0.50)'
          : 'rgba(62, 240, 142, 0.45)';
      const strokeCol = ghost.bulldoze || !ghost.valid ? '#ff384c' : ghost.snapped ? '#f5b700' : '#24d678';
      const fc = footprintCorners(gp.x, gp.y - lift, w, h, 0.04);
      drawPoly(ctx, [fc.n, fc.e, fc.s, fc.w], fillCol, strokeCol, 2.2);
      if (lift > 0) {
        const gf = footprintCorners(gp.x, gp.y, w, h, 0.04);
        drawPoly(ctx, [gf.n, gf.e, gf.s, gf.w], 'rgba(245, 200, 66, 0.20)', strokeCol, 1.2);
      }
    }

    // ===== PASS 5: TOUCHDOWN FIREWORKS & MARDI GRAS CONFETTI PARTICLES =====
    if (state.football.fireworkBurstTick !== this.lastBurstTick && state.football.fireworkBurstTick > 0) {
      this.lastBurstTick = state.football.fireworkBurstTick;
      const stad = state.buildings.find((b) => b && (b.type === 'stadium' || b.type === 'practice_field'));
      if (stad) {
        const sp = tileToIso(stad.tx + stad.w * 0.5, stad.ty + stad.h * 0.5, tiles.elev[idx(stad.tx, stad.ty)]);
        this.spawnFireworks(sp.x, sp.y - 36);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      pt.vy += 85 * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size * 0.5, pt.y - pt.size * 0.5, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    // ===== PASS 6: LUMINOUS MOONLIT NIGHT TINT, WARM ADDITIVE GLOWS & FIREFLIES =====
    // Soft night cursor lantern under hovered tile!
    if (night > 0.15 && cursorTile && inBounds(cursorTile.tx, cursorTile.ty)) {
      const cp = tileToIso(cursorTile.tx + 0.5, cursorTile.ty + 0.5, tiles.elev[idx(cursorTile.tx, cursorTile.ty)]);
      lights.push({ x: cp.x, y: cp.y, r: 95, color: '255, 232, 175', alpha: night * 0.34 });
    }

    // Golden marsh fireflies at night!
    if (night > 0.25 && !state.storm.active) {
      ctx.fillStyle = `rgba(255, 234, 120, ${(night - 0.25) * 0.95})`;
      for (let f = 0; f < 45; f++) {
        const fx = this.camera.x + Math.sin(elapsed * 0.45 + f * 3.7) * 460;
        const fy = this.camera.y + Math.cos(elapsed * 0.38 + f * 2.3) * 260;
        const r = 1.6 + Math.sin(elapsed * 4 + f) * 0.9;
        ctx.beginPath();
        ctx.arc(fx, fy, Math.max(0.5, r), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore(); // End world camera transform

    // Screen-space atmospheric tint (DIM moonlit indigo — NEVER super dark!)
    if (night > 0.04) {
      const maxAlpha = this.camera.brightNight ? 0.24 : 0.38;
      ctx.fillStyle = `rgba(22, 26, 68, ${night * maxAlpha})`;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }
    if (golden > 0.05) {
      ctx.fillStyle = `rgba(255, 160, 75, ${golden * 0.12})`;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }
    if (storm > 0.15) {
      ctx.fillStyle = `rgba(28, 42, 58, ${storm * 0.28})`;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }

    // Additive warm light halos (streetlamps, windows, bell tower, 6 stadium masts, cursor lantern!)
    if (lights.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(this.viewW * 0.5 + sxShake, this.viewH * 0.5 + syShake);
      ctx.scale(this.camera.zoom, this.camera.zoom);
      ctx.translate(-this.camera.x, -this.camera.y);
      for (const l of lights) {
        const g = ctx.createRadialGradient(l.x, l.y, 1, l.x, l.y, l.r);
        g.addColorStop(0, `rgba(${l.color}, ${l.alpha})`);
        g.addColorStop(1, `rgba(${l.color}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(l.x, l.y, l.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Slanted 2D Rain Streaks + Lightning Flash
    const rainRate = Math.max(state.rainRate, state.storm.active ? state.storm.rainRate : 0);
    if (rainRate > 0.08) {
      const drops = Math.floor(140 * rainRate);
      const slant = 12 + state.windStrength * 26;
      ctx.strokeStyle = 'rgba(205, 228, 248, 0.44)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let d = 0; d < drops; d++) {
        const rx = ((d * 97 + elapsed * 420) % (this.viewW + 120)) - 60;
        const ry = ((d * 131 + elapsed * 780) % (this.viewH + 120)) - 60;
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - slant * 0.45, ry + 18);
      }
      ctx.stroke();
    }

    if (lightning > 0.05) {
      ctx.fillStyle = `rgba(225, 240, 255, ${lightning * 0.42})`;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }

    ctx.restore();
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

    c.fillStyle = '#fbf7ef';
    c.fillRect(0, 0, out.width, out.height);
    c.strokeStyle = '#d9a400';
    c.lineWidth = 4;
    c.strokeRect(pad - 4, pad - 4, src.width + 8, src.height + 8);
    c.drawImage(src, pad, pad);

    c.fillStyle = '#461D7C';
    c.font = `700 ${Math.round(Math.max(22, out.width * 0.022))}px Georgia, serif`;
    c.textBaseline = 'middle';
    c.fillText('GREETINGS FROM BAYOU STATE UNIVERSITY', pad, src.height + pad + footer * 0.42);

    c.fillStyle = '#5c536b';
    c.font = `600 ${Math.round(Math.max(13, out.width * 0.012))}px system-ui, sans-serif`;
    c.fillText(
      `Year ${state.year}  ·  ${state.economy.students.toLocaleString()} Students  ·  Prestige ${state.economy.prestige}  ·  Campus Lv.${state.economy.campusLevel}`,
      pad,
      src.height + pad + footer * 0.76,
    );

    c.fillStyle = '#F5B700';
    c.beginPath();
    c.arc(out.width - pad - 24, src.height + pad + footer * 0.5, 22, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#461D7C';
    c.font = 'bold 18px Georgia, serif';
    c.textAlign = 'center';
    c.fillText('BSU', out.width - pad - 24, src.height + pad + footer * 0.51);

    return out.toDataURL('image/png');
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
  }
}
