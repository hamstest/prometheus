import type { State } from './model.ts';

// Quintic Hermite in normalized time; both endpoints include real-time
// velocity and acceleration. No quaternion component interpolation.
export function coefficients(start: State, end: State, duration: number): number[] {
  const c0 = start.p, c1 = start.v * duration, c2 = start.a * duration ** 2 / 2;
  const d = end.p - c0 - c1 - c2;
  const v = end.v * duration - c1 - 2 * c2;
  const a = end.a * duration ** 2 - 2 * c2;
  return [c0, c1, c2, 10 * d - 4 * v + a / 2, -15 * d + 7 * v - a, 6 * d - 3 * v + a / 2];
}
export function evaluate(c: number[], t: number, duration: number): State {
  const s = Math.max(0, Math.min(1, t / duration));
  let p = 0, v = 0, a = 0;
  for (let i = c.length - 1; i >= 0; i--) p = p * s + c[i];
  for (let i = c.length - 1; i >= 1; i--) v = v * s + i * c[i];
  for (let i = c.length - 1; i >= 2; i--) a = a * s + i * (i - 1) * c[i];
  return { p, v: v / duration, a: a / duration ** 2 };
}
// Recursively isolate polynomial roots on [0,1] using derivative roots.
// Checking these extrema catches narrow between-frame overshoots.
function roots(c: number[]): number[] {
  while (c.length > 1 && Math.abs(c.at(-1)!) < 1e-12) c = c.slice(0, -1);
  if (c.length <= 1) return [];
  if (c.length === 2) { const r = -c[0] / c[1]; return r > 0 && r < 1 ? [r] : []; }
  const value = (x: number) => c.reduceRight((y, k) => y * x + k, 0);
  const critical = roots(c.slice(1).map((v, i) => v * (i + 1)));
  const points = [0, ...critical, 1], result = critical.filter(x => Math.abs(value(x)) < 1e-9);
  for (let i = 1; i < points.length; i++) {
    let lo = points[i - 1], hi = points[i], flo = value(lo);
    if (flo * value(hi) >= 0) continue;
    for (let n = 0; n < 55; n++) {
      const mid = (lo + hi) / 2, f = value(mid);
      if (flo * f <= 0) hi = mid; else { lo = mid; flo = f; }
    }
    result.push((lo + hi) / 2);
  }
  return result.sort((a, b) => a - b);
}
export function range(c: number[]): [number, number] {
  const times = [0, 1, ...roots(c.slice(1).map((v, i) => v * (i + 1)))];
  const values = times.map(t => evaluate(c, t, 1).p);
  return [Math.min(...values), Math.max(...values)];
}
