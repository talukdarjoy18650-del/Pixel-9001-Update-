import { MINECRAFT_BLOCKS, type MinecraftBlock } from './minecraft-colors';

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const POW25_7 = 6103515625; // 25^7

function srgbToLinear(c: number): number {
  const v = c / 255.0;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function srgbToLab(rgb: [number, number, number]): [number, number, number] {
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);

  const x0 = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y0 = (r * 0.2126729 + g * 0.7151522 + b * 0.072175) / 1.0;
  const z0 = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;

  const fx = x0 > 0.008856 ? Math.cbrt(x0) : 7.787 * x0 + 16 / 116;
  const fy = y0 > 0.008856 ? Math.cbrt(y0) : 7.787 * y0 + 16 / 116;
  const fz = z0 > 0.008856 ? Math.cbrt(z0) : 7.787 * z0 + 16 / 116;

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE2000(
  l1: number,
  a1: number,
  b1: number,
  l2: number,
  a2: number,
  b2: number
): number {
  const c1 = Math.sqrt(a1 * a1 + b1 * b1);
  const c2 = Math.sqrt(a2 * a2 + b2 * b2);
  const cBar = (c1 + c2) * 0.5;
  const cBar2 = cBar * cBar;
  const cBar7 = cBar2 * cBar2 * cBar2 * cBar;

  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + POW25_7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;

  const c1p = Math.sqrt(a1p * a1p + b1 * b1);
  const c2p = Math.sqrt(a2p * a2p + b2 * b2);

  let h1p = Math.atan2(b1, a1p) * RAD_TO_DEG;
  if (h1p < 0) h1p += 360;
  let h2p = Math.atan2(b2, a2p) * RAD_TO_DEG;
  if (h2p < 0) h2p += 360;

  const dlp = l2 - l1;
  const dcp = c2p - c1p;

  let dhp = 0;
  const c1c2 = c1p * c2p;
  if (c1c2 !== 0) {
    const hDiff = h2p - h1p;
    if (Math.abs(hDiff) <= 180) {
      dhp = hDiff;
    } else if (hDiff > 180) {
      dhp = hDiff - 360;
    } else {
      dhp = hDiff + 360;
    }
  }

  const dHp = 2 * Math.sqrt(c1c2) * Math.sin(dhp * 0.5 * DEG_TO_RAD);

  const Lbp = (l1 + l2) * 0.5;
  const Cbp = (c1p + c2p) * 0.5;

  let Hbp: number;
  if (c1c2 === 0) {
    Hbp = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    Hbp = (h1p + h2p) * 0.5;
  } else {
    const hSum = h1p + h2p;
    Hbp = hSum < 360 ? (hSum + 360) * 0.5 : (hSum - 360) * 0.5;
  }

  const T =
    1 -
    0.17 * Math.cos((Hbp - 30) * DEG_TO_RAD) +
    0.24 * Math.cos(2 * Hbp * DEG_TO_RAD) +
    0.32 * Math.cos((3 * Hbp + 6) * DEG_TO_RAD) -
    0.2 * Math.cos((4 * Hbp - 63) * DEG_TO_RAD);

  const lDiff = Lbp - 50;
  const lDiff2 = lDiff * lDiff;
  const SL = 1 + (0.015 * lDiff2) / Math.sqrt(20 + lDiff2);
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;

  const Cbp2 = Cbp * Cbp;
  const Cbp7 = Cbp2 * Cbp2 * Cbp2 * Cbp;
  const hExp = (Hbp - 275) / 25;
  const RT =
    -2 *
    Math.sqrt(Cbp7 / (Cbp7 + POW25_7)) *
    Math.sin(60 * Math.exp(-(hExp * hExp)) * DEG_TO_RAD);

  const termL = dlp / SL;
  const termC = dcp / SC;
  const termH = dHp / SH;

  return termL * termL + termC * termC + termH * termH + RT * termC * termH;
}

// Precompute palette Lab arrays for fast zero-allocation lookup
const PALETTE_LEN = MINECRAFT_BLOCKS.length;
const PALETTE_L = new Float64Array(PALETTE_LEN);
const PALETTE_A = new Float64Array(PALETTE_LEN);
const PALETTE_B = new Float64Array(PALETTE_LEN);

for (let i = 0; i < PALETTE_LEN; i++) {
  const lab = srgbToLab(MINECRAFT_BLOCKS[i].rgb);
  PALETTE_L[i] = lab[0];
  PALETTE_A[i] = lab[1];
  PALETTE_B[i] = lab[2];
}

export interface MaterialEntry {
  id: string;
  rgb: [number, number, number];
  count: number;
}

export interface ProcessedBlockArt {
  pixels: Uint8ClampedArray;
  blockIds: string[];
  materials: MaterialEntry[];
  totalBlocks: number;
}

const MAX_CACHE_ENTRIES = 100_000;

function findNearestBlockIndex(
  r: number,
  g: number,
  b: number,
  cache: Map<number, number>
): number {
  const ir = r < 0 ? 0 : r > 255 ? 255 : Math.round(r);
  const ig = g < 0 ? 0 : g > 255 ? 255 : Math.round(g);
  const ib = b < 0 ? 0 : b > 255 ? 255 : Math.round(b);
  const key = (ir << 16) | (ig << 8) | ib;

  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const [l1, a1, b1] = srgbToLab([ir, ig, ib]);
  let minDistance = Infinity;
  let bestIdx = 0;

  for (let i = 0; i < PALETTE_LEN; i++) {
    const dist = deltaE2000(l1, a1, b1, PALETTE_L[i], PALETTE_A[i], PALETTE_B[i]);
    if (dist < minDistance) {
      minDistance = dist;
      bestIdx = i;
    }
  }

  if (cache.size < MAX_CACHE_ENTRIES) {
    cache.set(key, bestIdx);
  }
  return bestIdx;
}

const yieldToMainThread = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function processImageAsync(
  imageData: ImageData,
  useDithering: boolean,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<ProcessedBlockArt> {
  const { data, width, height } = imageData;
  const pixels = new Uint8ClampedArray(data.length);
  const blockIds = new Array<string>(width * height);
  const counts = new Int32Array(PALETTE_LEN);
  const cache = new Map<number, number>();
  let totalBlocks = 0;

  // Target ~12,000 pixels per chunk before yielding so UI remains smooth
  const rowsPerChunk = Math.max(2, Math.floor(12000 / Math.max(1, width)));

  if (useDithering) {
    const work = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      work[i] = data[i];
    }

    for (let y = 0; y < height; y++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      for (let x = 0; x < width; x++) {
        const cell = y * width + x;
        const i = cell * 4;

        if (work[i + 3] < 128) {
          pixels[i] = 0;
          pixels[i + 1] = 0;
          pixels[i + 2] = 0;
          pixels[i + 3] = 0;
          blockIds[cell] = 'minecraft:air';
          continue;
        }

        const oldR = work[i];
        const oldG = work[i + 1];
        const oldB = work[i + 2];

        const nearestIdx = findNearestBlockIndex(oldR, oldG, oldB, cache);
        const nearest: MinecraftBlock = MINECRAFT_BLOCKS[nearestIdx];

        const nr = nearest.rgb[0];
        const ng = nearest.rgb[1];
        const nb = nearest.rgb[2];

        pixels[i] = nr;
        pixels[i + 1] = ng;
        pixels[i + 2] = nb;
        pixels[i + 3] = 255;
        blockIds[cell] = nearest.id;
        counts[nearestIdx]++;
        totalBlocks++;

        const errR = oldR - nr;
        const errG = oldG - ng;
        const errB = oldB - nb;

        // Floyd-Steinberg error diffusion
        if (x + 1 < width) {
          const idx = i + 4;
          if (work[idx + 3] >= 128) {
            work[idx] = Math.max(0, Math.min(255, work[idx] + errR * (7 / 16)));
            work[idx + 1] = Math.max(0, Math.min(255, work[idx + 1] + errG * (7 / 16)));
            work[idx + 2] = Math.max(0, Math.min(255, work[idx + 2] + errB * (7 / 16)));
          }
        }
        if (y + 1 < height) {
          const nextRowOffset = i + width * 4;
          if (x - 1 >= 0) {
            const idx = nextRowOffset - 4;
            if (work[idx + 3] >= 128) {
              work[idx] = Math.max(0, Math.min(255, work[idx] + errR * (3 / 16)));
              work[idx + 1] = Math.max(0, Math.min(255, work[idx + 1] + errG * (3 / 16)));
              work[idx + 2] = Math.max(0, Math.min(255, work[idx + 2] + errB * (3 / 16)));
            }
          }
          {
            const idx = nextRowOffset;
            if (work[idx + 3] >= 128) {
              work[idx] = Math.max(0, Math.min(255, work[idx] + errR * (5 / 16)));
              work[idx + 1] = Math.max(0, Math.min(255, work[idx + 1] + errG * (5 / 16)));
              work[idx + 2] = Math.max(0, Math.min(255, work[idx + 2] + errB * (5 / 16)));
            }
          }
          if (x + 1 < width) {
            const idx = nextRowOffset + 4;
            if (work[idx + 3] >= 128) {
              work[idx] = Math.max(0, Math.min(255, work[idx] + errR * (1 / 16)));
              work[idx + 1] = Math.max(0, Math.min(255, work[idx + 1] + errG * (1 / 16)));
              work[idx + 2] = Math.max(0, Math.min(255, work[idx + 2] + errB * (1 / 16)));
            }
          }
        }
      }

      if ((y + 1) % rowsPerChunk === 0 || y === height - 1) {
        onProgress?.(Math.round(((y + 1) / height) * 100));
        await yieldToMainThread();
      }
    }
  } else {
    for (let y = 0; y < height; y++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      for (let x = 0; x < width; x++) {
        const cell = y * width + x;
        const i = cell * 4;

        if (data[i + 3] < 128) {
          pixels[i] = 0;
          pixels[i + 1] = 0;
          pixels[i + 2] = 0;
          pixels[i + 3] = 0;
          blockIds[cell] = 'minecraft:air';
          continue;
        }

        const nearestIdx = findNearestBlockIndex(data[i], data[i + 1], data[i + 2], cache);
        const nearest: MinecraftBlock = MINECRAFT_BLOCKS[nearestIdx];

        pixels[i] = nearest.rgb[0];
        pixels[i + 1] = nearest.rgb[1];
        pixels[i + 2] = nearest.rgb[2];
        pixels[i + 3] = 255;
        blockIds[cell] = nearest.id;
        counts[nearestIdx]++;
        totalBlocks++;
      }

      if ((y + 1) % rowsPerChunk === 0 || y === height - 1) {
        onProgress?.(Math.round(((y + 1) / height) * 100));
        await yieldToMainThread();
      }
    }
  }

  const materials: MaterialEntry[] = [];
  for (let i = 0; i < PALETTE_LEN; i++) {
    if (counts[i] > 0) {
      materials.push({
        id: MINECRAFT_BLOCKS[i].id,
        rgb: MINECRAFT_BLOCKS[i].rgb,
        count: counts[i],
      });
    }
  }
  materials.sort((a, b) => b.count - a.count);

  return { pixels, blockIds, materials, totalBlocks };
}
