/**
 * ALPHA ENGINE — turns the model's opaque output into a real PNG-32 with alpha.
 *
 * Image models physically cannot emit an alpha channel: they always return an
 * opaque RGB image. That is why "transparent" areas come back as white, light
 * gray, or a painted fake checkerboard. So we ask the model to paint every
 * transparent region in pure chroma magenta (#FF00FF) and strip it here,
 * plus we defensively remove white/gray backgrounds and fake checkerboards.
 */

export type AlphaOptions = {
  chroma: boolean;
  killCheckerboard: boolean;
  killWhiteBackground: boolean;
};

export const DEFAULT_ALPHA: AlphaOptions = {
  chroma: true,
  killCheckerboard: true,
  killWhiteBackground: true,
};

export const CHROMA_HEX = "#FF00FF";

function lum(r: number, g: number, b: number) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
function sat(r: number, g: number, b: number) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}

/** magenta-ish: strong R and B, weak G */
function isChroma(r: number, g: number, b: number) {
  return r > 150 && b > 150 && g < 110 && r - g > 60 && b - g > 60;
}

/** near-white or light neutral gray (typical fake-transparency fill) */
function isNeutralLight(r: number, g: number, b: number) {
  return sat(r, g, b) < 0.09 && lum(r, g, b) > 0.7;
}

/**
 * Removes chroma-key pixels and despills the surrounding fringe.
 */
function applyChroma(data: Uint8ClampedArray) {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (isChroma(r, g, b)) {
      data[i + 3] = 0;
      continue;
    }
    // Despill: soft magenta fringe around the keyed area.
    if (r > 120 && b > 120 && g < r - 35 && g < b - 35) {
      const avg = Math.round((r + b) / 2);
      const spill = Math.min(255, avg - g);
      if (spill > 25) {
        const k = Math.min(1, (spill - 25) / 70);
        data[i] = Math.round(r - (r - g) * k);
        data[i + 2] = Math.round(b - (b - g) * k);
        data[i + 3] = Math.round(data[i + 3] * (1 - k * 0.85));
      }
    }
  }
}

/**
 * Flood fill from the canvas borders, clearing any connected neutral-light
 * background (white sheet / gray backdrop / connected fake checkerboard).
 * Stops at saturated or dark pixels, so light garment art inside closed
 * template cells is preserved.
 */
function killBackground(data: Uint8ClampedArray, w: number, h: number) {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (seen[p]) return;
    seen[p] = 1;
    const i = p * 4;
    if (data[i + 3] === 0) {
      stack.push(p);
      return;
    }
    if (!isNeutralLight(data[i], data[i + 1], data[i + 2])) return;
    data[i + 3] = 0;
    stack.push(p);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p - x) / w;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
}

/**
 * Detect painted checkerboards (the model's fake "transparency") anywhere in
 * the image and clear them. Works on an 8px block grid: a block is a checker
 * candidate when it is uniform, neutral and light; a candidate is cleared when
 * its horizontal/vertical neighbours alternate brightness consistently.
 */
function killCheckerboard(data: Uint8ClampedArray, w: number, h: number) {
  const B = 8;
  const bw = Math.ceil(w / B);
  const bh = Math.ceil(h / B);
  const avg = new Float32Array(bw * bh);
  const cand = new Uint8Array(bw * bh);

  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let sum = 0, n = 0, ok = 1, mn = 1, mx = 0;
      for (let y = by * B; y < Math.min((by + 1) * B, h); y++) {
        for (let x = bx * B; x < Math.min((bx + 1) * B, w); x++) {
          const i = (y * w + x) * 4;
          if (data[i + 3] === 0) { ok = 0; continue; }
          const r = data[i], g = data[i + 1], b = data[i + 2];
          if (sat(r, g, b) > 0.1) ok = 0;
          const l = lum(r, g, b);
          mn = Math.min(mn, l);
          mx = Math.max(mx, l);
          sum += l;
          n++;
        }
      }
      const bi = by * bw + bx;
      avg[bi] = n ? sum / n : 0;
      cand[bi] = ok && n > 0 && mx - mn < 0.06 && avg[bi] > 0.55 ? 1 : 0;
    }
  }

  const clear = new Uint8Array(bw * bh);
  const alt = (a: number, b: number) => Math.abs(avg[a] - avg[b]) > 0.035;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const bi = by * bw + bx;
      if (!cand[bi]) continue;
      const l = bx > 0 ? bi - 1 : -1;
      const r = bx < bw - 1 ? bi + 1 : -1;
      const u = by > 0 ? bi - bw : -1;
      const d = by < bh - 1 ? bi + bw : -1;
      let hits = 0;
      if (l >= 0 && cand[l] && alt(bi, l)) hits++;
      if (r >= 0 && cand[r] && alt(bi, r)) hits++;
      if (u >= 0 && cand[u] && alt(bi, u)) hits++;
      if (d >= 0 && cand[d] && alt(bi, d)) hits++;
      if (hits >= 3) {
        clear[bi] = 1;
        if (l >= 0 && cand[l]) clear[l] = 1;
        if (r >= 0 && cand[r]) clear[r] = 1;
        if (u >= 0 && cand[u]) clear[u] = 1;
        if (d >= 0 && cand[d]) clear[d] = 1;
      }
    }
  }

  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      if (!clear[by * bw + bx]) continue;
      for (let y = by * B; y < Math.min((by + 1) * B, h); y++) {
        for (let x = bx * B; x < Math.min((bx + 1) * B, w); x++) {
          data[(y * w + x) * 4 + 3] = 0;
        }
      }
    }
  }
}

/** Softens hard alpha edges by 1px so the wrap on the avatar doesn't alias. */
function featherEdges(data: Uint8ClampedArray, w: number, h: number) {
  const alphaCopy = new Uint8ClampedArray(w * h);
  for (let p = 0; p < w * h; p++) alphaCopy[p] = data[p * 4 + 3];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (alphaCopy[p] !== 255) continue;
      let transparentNeighbors = 0;
      if (alphaCopy[p - 1] === 0) transparentNeighbors++;
      if (alphaCopy[p + 1] === 0) transparentNeighbors++;
      if (alphaCopy[p - w] === 0) transparentNeighbors++;
      if (alphaCopy[p + w] === 0) transparentNeighbors++;
      if (transparentNeighbors >= 1) data[p * 4 + 3] = 200;
    }
  }
}

export type AlphaStats = { transparentPct: number };

/**
 * Runs the full alpha pipeline over an ImageData in place.
 */
export function processAlpha(
  img: ImageData,
  opts: AlphaOptions = DEFAULT_ALPHA,
): AlphaStats {
  const { data, width, height } = img;
  if (opts.chroma) applyChroma(data);
  if (opts.killCheckerboard) killCheckerboard(data, width, height);
  if (opts.killWhiteBackground) killBackground(data, width, height);
  featherEdges(data, width, height);

  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] === 0) clear++;
  return { transparentPct: (clear / (width * height)) * 100 };
}
