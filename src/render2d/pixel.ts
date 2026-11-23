// ===== 16-BIT TACTILE PIXEL ART ENGINE =====
// Authentic crisp pixel-art rasterizer with hue-shifted shading ramps,
// 4x4 Bayer dithering, per-pixel architectural shaders (shingles, stucco, brick,
// arched colonnades, glass panes), and automatic 1px dark-plum pixel outlines.

export type RGBA = number; // packed ABGR little-endian uint32 for fast ImageData writes

export function hexToRGBA(hex: string, alpha = 255): RGBA {
  const clean = hex.charCodeAt(0) === 35 ? hex.slice(1) : hex;
  const n = parseInt(clean, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return ((alpha & 255) << 24) | (b << 16) | (g << 8) | r;
}

export function rgbToRGBA(r: number, g: number, b: number, a = 255): RGBA {
  return (
    ((Math.max(0, Math.min(255, a | 0)) & 255) << 24) |
    ((Math.max(0, Math.min(255, b | 0)) & 255) << 16) |
    ((Math.max(0, Math.min(255, g | 0)) & 255) << 8) |
    (Math.max(0, Math.min(255, r | 0)) & 255)
  );
}

/**
 * Hue-shifted pixel-art color adjustment:
 * Brightening shifts subtly warm (golden sunlight); darkening shifts subtly cool (deep plum shadow).
 */
export function shadeRGBA(hex: string, mult: number, alpha = 255): RGBA {
  const clean = hex.charCodeAt(0) === 35 ? hex.slice(1) : hex;
  const n = parseInt(clean, 16);
  let r = ((n >> 16) & 255) * mult;
  let g = ((n >> 8) & 255) * mult;
  let b = (n & 255) * mult;
  if (mult < 0.92) {
    // Cool violet-plum shadow shift
    const cool = (1 - mult) * 28;
    r -= cool * 0.25;
    g -= cool * 0.45;
    b += cool * 0.55;
  } else if (mult > 1.05) {
    // Warm sunlit golden shift
    const warm = (mult - 1) * 32;
    r += warm * 0.65;
    g += warm * 0.35;
    b -= warm * 0.25;
  }
  return rgbToRGBA(r, g, b, alpha);
}

// 4x4 Bayer ordered dither matrix normalized to 0..15
const BAYER_4X4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

export function bayer4(x: number, y: number): number {
  return BAYER_4X4[((y & 3) << 2) | (x & 3)] / 16;
}

export function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

// Curated 16-bit Bayou State Master Palette (hue-shifted for SNES/Kairosoft vibrancy!)
export const PAL = {
  outline: hexToRGBA('#23152b'),
  outlineSoft: hexToRGBA('#362240'),
  shadow: hexToRGBA('#192230', 112),
  shadowDeep: hexToRGBA('#141928', 155),

  // LSU Cream Stucco & Limestone (4-tone ramp)
  stuccoHi: hexToRGBA('#fff5dc'),
  stuccoLit: hexToRGBA('#f0dcb4'),
  stuccoMid: hexToRGBA('#d4ba92'),
  stuccoShade: hexToRGBA('#a88c7a'),
  stuccoDark: hexToRGBA('#7a605e'),

  // Terracotta Shingle Roofs (4-tone ramp)
  terraHi: hexToRGBA('#f58c56'),
  terraLit: hexToRGBA('#d95e38'),
  terraMid: hexToRGBA('#b8412a'),
  terraShade: hexToRGBA('#872822'),
  terraDark: hexToRGBA('#59181d'),

  // LSU Royal Purple & Gold
  purpleHi: hexToRGBA('#8746d4'),
  purpleLit: hexToRGBA('#6128a8'),
  purpleShade: hexToRGBA('#401775'),
  purpleDark: hexToRGBA('#270d4d'),

  goldHi: hexToRGBA('#fff08a'),
  goldLit: hexToRGBA('#f7c21b'),
  goldMid: hexToRGBA('#d6920c'),
  goldShade: hexToRGBA('#9e600c'),

  // Windows & Arches
  archDark: hexToRGBA('#2d1b33'),
  winDay: hexToRGBA('#36526e'),
  winDayHi: hexToRGBA('#6894b8'),
  winNight: hexToRGBA('#ffe57a'),
  winNightCore: hexToRGBA('#fffbe0'),

  // Lush Louisiana Grass & Bayou Flora
  grassHi: hexToRGBA('#7cd44c'),
  grassLit: hexToRGBA('#5db53b'),
  grassMid: hexToRGBA('#459432'),
  grassShade: hexToRGBA('#31732c'),
  grassDark: hexToRGBA('#215226'),

  // Cypress / Wetland Moss
  wetLit: hexToRGBA('#4b8c3b'),
  wetMid: hexToRGBA('#386e34'),
  wetShade: hexToRGBA('#274f2b'),
  mudLit: hexToRGBA('#63543b'),
  mudShade: hexToRGBA('#45372a'),

  // Sparkling Teal Bayou & Deep River
  waterSpark: hexToRGBA('#9bf5eb'),
  waterHi: hexToRGBA('#43cfc7'),
  waterMid: hexToRGBA('#24a6ad'),
  waterDeep: hexToRGBA('#17788a'),
  waterAbyss: hexToRGBA('#105166'),

  // Red Brick Quad Walkways & Masonry
  brickHi: hexToRGBA('#de7e59'),
  brickLit: hexToRGBA('#c25d40'),
  brickMid: hexToRGBA('#9c4432'),
  brickMortar: hexToRGBA('#6e2f2b'),

  // Warm Cobble / Limestone Trim
  stoneHi: hexToRGBA('#ece3cc'),
  stoneMid: hexToRGBA('#c9bca2'),
  stoneShade: hexToRGBA('#968878'),

  // Wood / Pilings / Boardwalk
  woodHi: hexToRGBA('#c48e54'),
  woodLit: hexToRGBA('#9e6b3b'),
  woodShade: hexToRGBA('#6e4628'),
  woodDark: hexToRGBA('#472a1c'),

  // Asphalt Roads
  roadHi: hexToRGBA('#666a78'),
  roadMid: hexToRGBA('#4d5161'),
  roadShade: hexToRGBA('#383b4a'),
  roadLine: hexToRGBA('#ffd84d'),
  roadCross: hexToRGBA('#f0ecdc'),

  // Spanish Moss & Blossoms
  mossHi: hexToRGBA('#a8ba8c'),
  mossMid: hexToRGBA('#7d946c'),
  mossShade: hexToRGBA('#576b4f'),
  azaleaHi: hexToRGBA('#ff7eb6'),
  azaleaMid: hexToRGBA('#e04688'),
  azaleaShade: hexToRGBA('#a12562'),

  // Earth Cliffs
  cliffLit: hexToRGBA('#876747'),
  cliffMid: hexToRGBA('#694b36'),
  cliffDark: hexToRGBA('#4a3329'),
};

export interface CachedSprite {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  anchorX: number;
  anchorY: number;
}

/**
 * Software 16-bit Pixel Buffer for zero-anti-alias crisp sprite & tile rasterization.
 */
export class PixelBuffer {
  readonly w: number;
  readonly h: number;
  readonly data: Uint32Array;
  private readonly img: ImageData;

  constructor(w: number, h: number) {
    this.w = Math.max(1, Math.ceil(w));
    this.h = Math.max(1, Math.ceil(h));
    this.img = new ImageData(this.w, this.h);
    this.data = new Uint32Array(this.img.data.buffer);
  }

  px(x: number, y: number, color: RGBA): void {
    const ix = x | 0;
    const iy = y | 0;
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return;
    const a = (color >>> 24) & 255;
    if (a === 0) return;
    const off = iy * this.w + ix;
    if (a === 255) {
      this.data[off] = color;
      return;
    }
    // Crisp alpha blend for soft shadows / glows inside sprite buffer
    const dst = this.data[off];
    const da = (dst >>> 24) & 255;
    if (da === 0) {
      this.data[off] = color;
      return;
    }
    const sr = color & 255;
    const sg = (color >>> 8) & 255;
    const sb = (color >>> 16) & 255;
    const dr = dst & 255;
    const dg = (dst >>> 8) & 255;
    const db = (dst >>> 16) & 255;
    const inv = 255 - a;
    const rr = (sr * a + dr * inv) / 255;
    const rg = (sg * a + dg * inv) / 255;
    const rb = (sb * a + db * inv) / 255;
    const ra = Math.min(255, da + a);
    this.data[off] = ((ra & 255) << 24) | ((rb & 255) << 16) | ((rg & 255) << 8) | (rr & 255);
  }

  rect(x: number, y: number, w: number, h: number, color: RGBA): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w));
    const y1 = Math.min(this.h, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        this.px(xx, yy, color);
      }
    }
  }

  hline(x0: number, x1: number, y: number, color: RGBA): void {
    const iy = Math.round(y);
    if (iy < 0 || iy >= this.h) return;
    const a = Math.max(0, Math.round(Math.min(x0, x1)));
    const b = Math.min(this.w - 1, Math.round(Math.max(x0, x1)));
    for (let xx = a; xx <= b; xx++) this.px(xx, iy, color);
  }

  line(x0: number, y0: number, x1: number, y1: number, color: RGBA): void {
    let ix0 = Math.round(x0);
    let iy0 = Math.round(y0);
    const ix1 = Math.round(x1);
    const iy1 = Math.round(y1);
    const dx = Math.abs(ix1 - ix0);
    const dy = Math.abs(iy1 - iy0);
    const sx = ix0 < ix1 ? 1 : -1;
    const sy = iy0 < iy1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      this.px(ix0, iy0, color);
      if (ix0 === ix1 && iy0 === iy1) break;
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        ix0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        iy0 += sy;
      }
    }
  }

  /**
   * Scanline fills an arbitrary polygon with either a flat RGBA or a per-pixel procedural shader!
   */
  fillPoly(pts: [number, number][], shader: RGBA | ((x: number, y: number) => RGBA)): void {
    if (pts.length < 3) return;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    const yStart = Math.max(0, Math.floor(minY));
    const yEnd = Math.min(this.h - 1, Math.ceil(maxY));
    const isFn = typeof shader === 'function';
    const xs: number[] = [];

    for (let y = yStart; y <= yEnd; y++) {
      xs.length = 0;
      const sy = y + 0.5;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const y1 = pts[j][1];
        const y2 = pts[i][1];
        if ((y1 <= sy && y2 > sy) || (y2 <= sy && y1 > sy)) {
          const x1 = pts[j][0];
          const x2 = pts[i][0];
          xs.push(x1 + ((sy - y1) * (x2 - x1)) / (y2 - y1));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let k = 0; k < xs.length - 1; k += 2) {
        const x0 = Math.max(0, Math.floor(xs[k]));
        const x1 = Math.min(this.w - 1, Math.ceil(xs[k + 1]));
        for (let x = x0; x <= x1; x++) {
          this.px(x, y, isFn ? shader(x, y) : shader);
        }
      }
    }
  }

  strokePoly(pts: [number, number][], color: RGBA): void {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      this.line(a[0], a[1], b[0], b[1], color);
    }
  }

  fillEllipse(cx: number, cy: number, rx: number, ry: number, shader: RGBA | ((x: number, y: number, nx: number, ny: number) => RGBA)): void {
    if (rx <= 0 || ry <= 0) return;
    const x0 = Math.max(0, Math.floor(cx - rx));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + rx));
    const y0 = Math.max(0, Math.floor(cy - ry));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + ry));
    const isFn = typeof shader === 'function';
    for (let y = y0; y <= y1; y++) {
      const ny = (y + 0.5 - cy) / ry;
      const ny2 = ny * ny;
      if (ny2 > 1) continue;
      for (let x = x0; x <= x1; x++) {
        const nx = (x + 0.5 - cx) / rx;
        if (nx * nx + ny2 <= 1) {
          this.px(x, y, isFn ? shader(x, y, nx, ny) : shader);
        }
      }
    }
  }

  /**
   * Automatic 1px 16-bit silhouette outline around all opaque pixels!
   * Skips semi-transparent shadow pixels so cast shadows stay clean without outlines.
   */
  applyOutline(outlineColor: RGBA = PAL.outline): void {
    const src = new Uint32Array(this.data);
    const w = this.w;
    const h = this.h;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const curA = (src[row + x] >>> 24) & 255;
        if (curA >= 220) continue; // already solid sprite interior
        // Check 4 cardinal neighbors for solid sprite pixels
        let touch = false;
        if (x > 0 && ((src[row + x - 1] >>> 24) & 255) >= 220) touch = true;
        else if (x < w - 1 && ((src[row + x + 1] >>> 24) & 255) >= 220) touch = true;
        else if (y > 0 && ((src[row - w + x] >>> 24) & 255) >= 220) touch = true;
        else if (y < h - 1 && ((src[row + w + x] >>> 24) & 255) >= 220) touch = true;
        if (touch) {
          this.data[row + x] = outlineColor;
        }
      }
    }
  }

  toSprite(anchorX: number, anchorY: number): CachedSprite {
    const canvas = document.createElement('canvas');
    canvas.width = this.w;
    canvas.height = this.h;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(this.img, 0, 0);
    return { canvas, w: this.w, h: this.h, anchorX, anchorY };
  }
}

// ===== HIGH-CRAFT PIXEL ARCHITECTURAL PRIMITIVES =====

export interface PxBoxOpts {
  inset?: number;
  windows?: boolean;
  arches?: boolean;
  nightLit?: boolean;
  brickTex?: boolean;
  cornice?: boolean;
  castShadow?: boolean;
  shadowOffsetX?: number;
}

/**
 * Draws an isometric footprint diamond centered at (cx, cy) in PixelBuffer coordinates.
 */
export function pxFootprint(
  cx: number,
  cy: number,
  wTiles: number,
  hTiles: number,
  inset = 0.08,
): { n: [number, number]; e: [number, number]; s: [number, number]; w: [number, number] } {
  const w = Math.max(0.12, wTiles - inset * 2);
  const h = Math.max(0.12, hTiles - inset * 2);
  const dxE = w * 16; // w * 0.5 * 32
  const dyE = w * 8;  // w * 0.5 * 16
  const dxS = -h * 16;
  const dyS = h * 8;
  return {
    n: [cx - dxE - dxS, cy - dyE - dyS],
    e: [cx + dxE - dxS, cy + dyE - dyS],
    s: [cx + dxE + dxS, cy + dyE + dyS],
    w: [cx - dxE + dxS, cy - dyE + dyS],
  };
}

/**
 * Renders a richly shaded 16-bit isometric architectural box with:
 * - Optional dithered SE ground cast shadow
 * - Hue-shifted sunlit left wall vs. cool shaded right wall
 * - Subtle stucco/stone pixel texture + mortar dithering
 * - Optional shaded arched ground colonnade & multi-pane glowing windows
 * - Crisp limestone cornice trim + internal dark-plum corner ridge line
 */
export function drawPxPrism(
  pb: PixelBuffer,
  cx: number,
  baseY: number,
  wTiles: number,
  hTiles: number,
  heightPx: number,
  wallHex: string,
  roofHex: string,
  opts: PxBoxOpts = {},
): { n: [number, number]; e: [number, number]; s: [number, number]; w: [number, number] } {
  const bot = pxFootprint(cx, baseY, wTiles, hTiles, opts.inset ?? 0.08);
  const top = {
    n: [bot.n[0], bot.n[1] - heightPx] as [number, number],
    e: [bot.e[0], bot.e[1] - heightPx] as [number, number],
    s: [bot.s[0], bot.s[1] - heightPx] as [number, number],
    w: [bot.w[0], bot.w[1] - heightPx] as [number, number],
  };

  // Optional grounded SE cast shadow (checkerboard pixel-dithered for authentic 16-bit look!)
  if (opts.castShadow) {
    const shX = opts.shadowOffsetX ?? Math.min(26, Math.round(heightPx * 0.52) + 4);
    const shY = Math.round(shX * 0.34);
    const shPts: [number, number][] = [
      bot.n,
      [bot.n[0] + shX, bot.n[1] + shY],
      [bot.e[0] + shX, bot.e[1] + shY],
      [bot.s[0] + shX, bot.s[1] + shY],
      bot.s,
      bot.e,
    ];
    pb.fillPoly(shPts, (x, y) => ((x + y) & 1) === 0 ? PAL.shadowDeep : PAL.shadow);
  }

  // Hue-shifted wall ramps: Sunlit left (SW) face vs Cool shaded right (SE) face!
  const leftHi = shadeRGBA(wallHex, 1.07);
  const leftMid = shadeRGBA(wallHex, 0.97);
  const leftShade = shadeRGBA(wallHex, 0.87);

  const rightHi = shadeRGBA(wallHex, 0.80);
  const rightMid = shadeRGBA(wallHex, 0.72);
  const rightDark = shadeRGBA(wallHex, 0.62);

  const roofHi = shadeRGBA(roofHex, 1.08);
  const roofMid = shadeRGBA(roofHex, 0.96);

  // LEFT WALL (SW — catches warm Louisiana sunlight from upper-left)
  pb.fillPoly([bot.w, bot.s, top.s, top.w], (x, y) => {
    const relY = bot.s[1] - y;
    // Ground ambient occlusion band at base of wall
    if (relY < 3 && bayer4(x, y) > 0.35) return leftShade;
    // Eave shadow right under roofline
    const eaveY = top.w[1] + ((x - top.w[0]) / Math.max(1, top.s[0] - top.w[0])) * (top.s[1] - top.w[1]);
    if (y - eaveY < 2.2) return leftShade;
    // Subtle stone/brick course texture
    if (opts.brickTex) {
      if ((y & 3) === 0) return leftShade;
      if (((x + ((y >> 2) & 1) * 3) % 6) === 0) return leftMid;
    } else if (hash2(x >> 1, y >> 1) > 0.82) {
      return leftMid;
    }
    return bayer4(x, y) > 0.72 ? leftHi : leftMid;
  });

  // RIGHT WALL (SE — cool violet-tinted shade)
  pb.fillPoly([bot.s, bot.e, top.e, top.s], (x, y) => {
    const relY = bot.s[1] - y;
    if (relY < 3 && bayer4(x, y) > 0.3) return rightDark;
    const eaveY = top.s[1] + ((x - top.s[0]) / Math.max(1, top.e[0] - top.s[0])) * (top.e[1] - top.s[1]);
    if (y - eaveY < 2.5) return rightDark;
    if (opts.brickTex) {
      if ((y & 3) === 0) return rightDark;
      if (((x + ((y >> 2) & 1) * 3) % 6) === 0) return rightDark;
    } else if (hash2(x >> 1, y >> 1) > 0.78) {
      return rightDark;
    }
    return bayer4(x, y) > 0.75 ? rightHi : rightMid;
  });

  // TOP ROOF DECK
  pb.fillPoly([top.n, top.e, top.s, top.w], (x, y) => {
    return bayer4(x, y) > 0.6 ? roofHi : roofMid;
  });

  // Architectural Windows & Recessed Arched Colonnades!
  if ((opts.windows || opts.arches) && heightPx >= 12) {
    const floors = Math.max(1, Math.min(5, Math.floor((heightPx - 4) / 9)));
    const drawWallDetails = (
      pA: [number, number],
      pB: [number, number],
      spanTiles: number,
      isLitSide: boolean,
    ) => {
      const cols = Math.max(1, Math.min(7, Math.round(spanTiles * 2.1)));
      for (let fl = 0; fl < floors; fl++) {
        const fy = 4 + fl * 9;
        const isGroundArch = opts.arches && fl === 0;
        for (let c = 0; c < cols; c++) {
          const t = (c + 0.5) / cols;
          const wx = Math.round(pA[0] + (pB[0] - pA[0]) * t);
          const wy = Math.round(pA[1] + (pB[1] - pA[1]) * t - fy);

          if (isGroundArch) {
            // Deep recessed Renaissance Revival loggia arch!
            pb.rect(wx - 2, wy - 5, 5, 6, PAL.archDark);
            pb.hline(wx - 1, wx + 1, wy - 6, PAL.archDark);
            // Bright sunlit inner pillar edge
            pb.line(wx + 2, wy - 5, wx + 2, wy, isLitSide ? PAL.stuccoHi : PAL.stuccoMid);
            if (opts.nightLit) {
              pb.rect(wx - 1, wy - 3, 3, 3, PAL.winNight);
            }
          } else {
            // Crisp 3x4 multi-pane pixel window with sill & header!
            const lit = opts.nightLit && ((c * 7 + fl * 11 + (isLitSide ? 1 : 2)) % 5 !== 0);
            const glass = lit ? PAL.winNight : isLitSide ? PAL.winDay : PAL.archDark;
            pb.rect(wx - 1, wy - 4, 3, 4, glass);
            if (lit) {
              pb.px(wx, wy - 3, PAL.winNightCore);
            } else if (isLitSide) {
              pb.px(wx - 1, wy - 4, PAL.winDayHi); // sunlit glass glint
            }
            // Limestone sill highlight
            pb.hline(wx - 1, wx + 1, wy, isLitSide ? PAL.stuccoHi : PAL.stuccoMid);
          }
        }
      }
    };
    drawWallDetails(bot.w, bot.s, hTiles, true);
    drawWallDetails(bot.s, bot.e, wTiles, false);
  }

  // Cornice trim & crisp internal corner creases (huge anti-flatness upgrade!)
  if (opts.cornice !== false) {
    pb.line(top.w[0], top.w[1], top.s[0], top.s[1], PAL.stuccoHi);
    pb.line(top.s[0], top.s[1], top.e[0], top.e[1], PAL.stuccoMid);
    pb.line(top.w[0], top.w[1] + 1, top.s[0], top.s[1] + 1, PAL.outlineSoft);
    pb.line(top.s[0], top.s[1] + 1, top.e[0], top.e[1] + 1, PAL.outlineSoft);
  }
  // Center vertical corner edge
  pb.line(bot.s[0], bot.s[1], top.s[0], top.s[1], PAL.outlineSoft);
  // Subtle base plinth line
  pb.line(bot.w[0], bot.w[1], bot.s[0], bot.s[1], PAL.outlineSoft);
  pb.line(bot.s[0], bot.s[1], bot.e[0], bot.e[1], PAL.outlineSoft);

  return top;
}

/**
 * Renders a 16-bit Italian Renaissance Revival Terracotta Hipped Roof
 * with individual pixel-art barrel shingle ribs, ridge highlight, and overhanging eaves!
 */
export function drawPxHippedRoof(
  pb: PixelBuffer,
  cx: number,
  baseY: number,
  wTiles: number,
  hTiles: number,
  roofH: number,
  roofHex = '#d95e38',
  inset = 0.02,
): void {
  const c = pxFootprint(cx, baseY, wTiles, hTiles, inset);
  const alongX = wTiles >= hTiles;
  const ridgeFrac = 0.30;
  let rA: [number, number];
  let rB: [number, number];
  if (alongX) {
    rA = [
      cx - (wTiles * ridgeFrac) * 16,
      baseY - roofH - (wTiles * ridgeFrac) * 8,
    ];
    rB = [
      cx + (wTiles * ridgeFrac) * 16,
      baseY - roofH + (wTiles * ridgeFrac) * 8,
    ];
  } else {
    rA = [
      cx + (hTiles * ridgeFrac) * 16,
      baseY - roofH - (hTiles * ridgeFrac) * 8,
    ];
    rB = [
      cx - (hTiles * ridgeFrac) * 16,
      baseY - roofH + (hTiles * ridgeFrac) * 8,
    ];
  }

  const hi = shadeRGBA(roofHex, 1.26);
  const lit = shadeRGBA(roofHex, 1.04);
  const mid = shadeRGBA(roofHex, 0.82);
  const shade = shadeRGBA(roofHex, 0.62);
  const deep = shadeRGBA(roofHex, 0.42);

  // Shingle texture shader: alternating ribbed tile flutes + horizontal shingle courses!
  const shingleShader = (cBright: RGBA, cBase: RGBA, cGroove: RGBA, dir: number) => (x: number, y: number): RGBA => {
    const flute = ((x + y * dir) % 4 + 4) % 4;
    const course = (y % 4 + 4) % 4;
    if (course === 0 && flute === 0) return cGroove;
    if (flute === 0) return cGroove;
    if (flute === 1 && course !== 0) return cBright;
    return cBase;
  };

  if (alongX) {
    // Back NE slope (darkest)
    pb.fillPoly([c.n, c.e, rB, rA], shingleShader(mid, shade, deep, 1));
    // Left NW hip (sunlit!)
    pb.fillPoly([c.w, c.n, rA], shingleShader(hi, lit, mid, -1));
    // Front SW slope (warm mid-lit!)
    pb.fillPoly([c.w, c.s, rB, rA], shingleShader(hi, lit, mid, 1));
    // Right SE hip (shaded!)
    pb.fillPoly([c.s, c.e, rB], shingleShader(mid, shade, deep, -1));
  } else {
    pb.fillPoly([c.n, c.e, rA], shingleShader(mid, shade, deep, 1));
    pb.fillPoly([c.w, c.n, rA, rB], shingleShader(hi, lit, mid, -1));
    pb.fillPoly([c.w, c.s, rB], shingleShader(hi, lit, mid, 1));
    pb.fillPoly([c.s, c.e, rA, rB], shingleShader(mid, shade, deep, -1));
  }

  // Hip seams & sunlit terracotta ridge cap!
  pb.line(c.w[0], c.w[1], alongX ? rA[0] : rB[0], alongX ? rA[1] : rB[1], deep);
  pb.line(c.s[0], c.s[1], rB[0], rB[1], deep);
  pb.line(c.e[0], c.e[1], alongX ? rB[0] : rA[0], alongX ? rB[1] : rA[1], deep);
  pb.line(rA[0], rA[1], rB[0], rB[1], hi);
  pb.line(rA[0], rA[1] + 1, rB[0], rB[1] + 1, deep);

  // Crisp overhanging dark eave border
  pb.line(c.w[0], c.w[1], c.s[0], c.s[1], PAL.outline);
  pb.line(c.s[0], c.s[1], c.e[0], c.e[1], PAL.outline);
}

/**
 * Renders a 16-bit Ribbed Golden / Ivory Dome with crisp specular pixel highlight & lantern finial!
 */
export function drawPxDome(
  pb: PixelBuffer,
  cx: number,
  baseY: number,
  rx: number,
  ry: number,
  hex: string,
  withCupola = false,
): void {
  const hi = shadeRGBA(hex, 1.24);
  const lit = shadeRGBA(hex, 1.04);
  const mid = shadeRGBA(hex, 0.86);
  const shade = shadeRGBA(hex, 0.65);
  const dark = shadeRGBA(hex, 0.48);

  // Base rim
  pb.fillEllipse(cx, baseY, rx, Math.max(3, rx * 0.44), shade);

  // Upper dome hemisphere with spherical sunlight shading + vertical ribs!
  const x0 = Math.floor(cx - rx);
  const x1 = Math.ceil(cx + rx);
  const y0 = Math.floor(baseY - ry);
  const y1 = Math.ceil(baseY + rx * 0.25);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - baseY) / (y < baseY ? ry : rx * 0.44);
      if (nx * nx + ny * ny > 1) continue;
      // Spherical lighting dot product (sun at top-left: -0.45, -0.55)
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const dot = -nx * 0.52 - ny * 0.55 + nz * 0.65;
      // Subtle vertical golden dome ribs
      const ribAngle = Math.atan2(nx, Math.max(0.15, nz));
      const isRib = Math.abs(Math.sin(ribAngle * 6)) < 0.14;
      let col: RGBA;
      if (dot > 0.82) col = hi;
      else if (dot > 0.52) col = isRib ? mid : lit;
      else if (dot > 0.22) col = isRib ? shade : mid;
      else if (dot > -0.05) col = isRib ? dark : shade;
      else col = dark;
      pb.px(x, y, col);
    }
  }

  // Rim crease
  pb.hline(cx - rx + 1, cx + rx - 1, baseY + Math.round(rx * 0.22), dark);

  if (withCupola) {
    pb.rect(cx - 2, baseY - ry - 5, 5, 5, PAL.stuccoHi);
    pb.rect(cx - 1, baseY - ry - 4, 3, 3, PAL.archDark);
    pb.rect(cx - 2, baseY - ry - 7, 5, 2, hi);
    pb.line(cx, baseY - ry - 11, cx, baseY - ry - 7, hi);
  }
}

// ===== CACHED 16-BIT PIXEL TERRAIN TILE ATLAS =====

export interface TerrainAtlas {
  high: CachedSprite[];
  dry: CachedSprite[];
  wet: CachedSprite[];
  swamp: CachedSprite[];
  preserve: CachedSprite[];
  pond: CachedSprite;
  canal: CachedSprite;
  bayou: CachedSprite[]; // 4 animated frames
  river: CachedSprite[]; // 4 animated frames
  brick: CachedSprite;
  quad: CachedSprite;
  plaza: CachedSprite;
  road: CachedSprite;
}

function makeDiamondTile(shader: (x: number, y: number, u: number, v: number) => RGBA): CachedSprite {
  // 64x32 exact isometric diamond
  const pb = new PixelBuffer(64, 32);
  const pts: [number, number][] = [
    [32, 0],
    [64, 16],
    [32, 32],
    [0, 16],
  ];
  pb.fillPoly(pts, (x, y) => {
    const dx = x - 32;
    const dy = y - 16;
    const u = (dx / 32 + dy / 16) * 0.5 + 0.5;
    const v = (dy / 16 - dx / 32) * 0.5 + 0.5;
    return shader(x, y, u, v);
  });
  return pb.toSprite(32, 16);
}

let cachedAtlas: TerrainAtlas | null = null;

export function getTerrainAtlas(): TerrainAtlas {
  if (cachedAtlas) return cachedAtlas;

  const makeGrassVariants = (
    hi: RGBA,
    lit: RGBA,
    mid: RGBA,
    shade: RGBA,
    flowerChance: number,
    seedBase: number,
  ): CachedSprite[] =>
    [0, 1, 2, 3].map((vIdx) =>
      makeDiamondTile((x, y) => {
        const h = hash2(x + vIdx * 71 + seedBase, y + vIdx * 37);
        const h2 = hash2((x >> 1) + vIdx * 19 + seedBase, (y >> 1) + vIdx * 23);
        // Subtle 16-bit pixel grass tufts & clover dots
        if (flowerChance > 0 && h > 1 - flowerChance) {
          return (x + y) % 2 === 0 ? PAL.goldHi : PAL.stuccoHi;
        }
        if (h2 > 0.78) return bayer4(x, y) > 0.5 ? hi : lit;
        if (h2 < 0.20) return bayer4(x, y) > 0.45 ? mid : shade;
        return h > 0.68 ? hi : h < 0.25 ? shade : mid;
      }),
    );

  const makeWaterFrames = (spark: RGBA, hi: RGBA, mid: RGBA, deep: RGBA): CachedSprite[] =>
    [0, 1, 2, 3].map((frame) =>
      makeDiamondTile((x, y) => {
        const wave = Math.sin((x + frame * 4) * 0.22 + Math.sin((y + frame * 2) * 0.35) * 1.4);
        const crest = ((x + frame * 3 + y * 2) % 13 === 0) && ((y + frame) % 5 === 0);
        if (crest && wave > 0.35) return spark;
        if (wave > 0.45) return bayer4(x, y) > 0.4 ? hi : mid;
        if (wave < -0.45) return bayer4(x, y) > 0.5 ? deep : mid;
        return mid;
      }),
    );

  cachedAtlas = {
    high: makeGrassVariants(PAL.grassHi, PAL.grassLit, PAL.grassMid, PAL.grassShade, 0.008, 10),
    dry: makeGrassVariants(PAL.grassLit, PAL.grassMid, PAL.grassShade, PAL.grassDark, 0.003, 50),
    wet: makeGrassVariants(PAL.wetLit, PAL.wetMid, PAL.wetShade, PAL.mudShade, 0, 90),
    swamp: makeGrassVariants(PAL.wetMid, PAL.wetShade, PAL.mudLit, PAL.mudShade, 0, 130),
    preserve: makeGrassVariants(PAL.grassLit, PAL.wetLit, PAL.wetMid, PAL.grassDark, 0.012, 170),
    pond: makeDiamondTile((x, y) => (bayer4(x, y) > 0.65 ? PAL.waterHi : PAL.waterMid)),
    canal: makeDiamondTile((x, y, u, v) => {
      if (u < 0.1 || u > 0.9 || v < 0.1 || v > 0.9) return PAL.stoneMid;
      return bayer4(x, y) > 0.55 ? PAL.waterMid : PAL.waterDeep;
    }),
    bayou: makeWaterFrames(PAL.waterSpark, PAL.waterHi, PAL.waterMid, PAL.waterDeep),
    river: makeWaterFrames(PAL.waterHi, PAL.waterMid, PAL.waterDeep, PAL.waterAbyss),

    // Crisp running-bond red brick walkway tile!
    brick: makeDiamondTile((x, y, u, v) => {
      const bu = Math.floor(u * 8);
      const bv = Math.floor(v * 8);
      const fu = (u * 8) - bu;
      const fv = (v * 8) - bv;
      const offset = (bv & 1) * 0.5;
      const fuOff = ((u * 8 + offset) % 1 + 1) % 1;
      if (fv < 0.16 || fuOff < 0.16) return PAL.brickMortar;
      const h = hash2(bu + 11, bv + 29);
      if (h > 0.72) return PAL.brickHi;
      if (h < 0.28) return PAL.brickMid;
      return fu < 0.5 ? PAL.brickLit : PAL.brickMid;
    }),

    // Lush manicured LSU Quad turf with subtle mowing stripes & stone kerb!
    quad: makeDiamondTile((x, y, u, v) => {
      if (u < 0.08 || u > 0.92 || v < 0.08 || v > 0.92) {
        return (x + y) % 3 === 0 ? PAL.stoneMid : PAL.stoneHi;
      }
      const stripe = Math.floor((u + v) * 4) & 1;
      const h = hash2(x, y);
      if (h > 0.985) return PAL.goldHi; // tiny dandelion/clover accent
      return stripe ? (bayer4(x, y) > 0.7 ? PAL.grassHi : PAL.grassLit) : PAL.grassMid;
    }),

    // Limestone Ceremonial Plaza tile
    plaza: makeDiamondTile((_x, _y, u, v) => {
      const pu = (u * 4) % 1;
      const pv = (v * 4) % 1;
      if (pu < 0.1 || pv < 0.1) return PAL.stoneShade;
      return ((Math.floor(u * 4) + Math.floor(v * 4)) & 1) ? PAL.stoneHi : PAL.stoneMid;
    }),

    // Asphalt Road base tile
    road: makeDiamondTile((x, y) => {
      const h = hash2(x, y);
      if (h > 0.85) return PAL.roadHi;
      if (h < 0.18) return PAL.roadShade;
      return PAL.roadMid;
    }),
  };

  return cachedAtlas;
}
