import { channels, restPose, MotionError, type Clip, type Motion, type Pose, type Saved, type Ref, type Score } from './model.ts';
import { coefficients, evaluate, range } from './curve.ts';

export type Segment = { start: number; duration: number; curves: Record<string, number[]>; occurrence: string };
export type Timeline = { duration: number; segments: Segment[] };
export type Resolver = (ref: Ref) => Saved;

// Speed-scaled branches can produce the same boundary a few ulps apart.
// Coalesce only numerical noise; genuine sub-millisecond input still fails validation.
export function boundaryTimes(values:number[]){
  const sorted=[...new Set(values)].sort((a,b)=>a-b),result:number[]=[];
  for(const t of sorted){if(result.length&&t-result.at(-1)!<1e-9)result[result.length-1]=t;else result.push(t);}
  return result;
}

export function sampleClip(clip: Clip, time: number, speed = 1): Pose {
  const result = restPose();
  for (const [name, keys] of Object.entries(clip.tracks)) {
    const t = Math.max(0, Math.min(clip.duration, time));
    let lo = 1, hi = keys.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (keys[mid].t < t) lo = mid + 1; else hi = mid; }
    const i = lo;
    const state = evaluate(coefficients(keys[i - 1], keys[i], keys[i].t - keys[i - 1].t), t - keys[i - 1].t, keys[i].t - keys[i - 1].t);
    result[name] = { p: state.p, v: state.v * speed, a: state.a * speed ** 2 };
  }
  return result;
}
export function bridge(start: Pose, end: Pose, duration: number, occurrence = 'transition'): Segment {
  const curves = Object.fromEntries(Object.keys(channels).map(name => {
    const c = coefficients(start[name], end[name], duration), limits = range(c), bound = channels[name];
    if (limits[0] < bound.min - 1e-8 || limits[1] > bound.max + 1e-8) throw new MotionError('TRANSITION_RANGE', `${name}: connection leaves supported range; change time or entry interval`);
    return [name, c];
  }));
  return { start: 0, duration, curves, occurrence };
}
export function sample(timeline: Timeline, time: number): { pose: Pose; occurrence: string } {
  const t = Math.max(0, Math.min(timeline.duration, time));
  const segment = timeline.segments.find(s => t < s.start + s.duration - 1e-10) ?? timeline.segments.at(-1);
  if (!segment) return { pose: restPose(), occurrence: 'idle' };
  return { pose: Object.fromEntries(Object.entries(segment.curves).map(([name, c]) => [name, evaluate(c, t - segment.start, segment.duration)])), occurrence: segment.occurrence };
}
function equal(a: Pose, b: Pose) {
  return Object.keys(channels).every(name => ['p', 'v', 'a'].every(key => Math.abs(a[name][key as 'p'] - b[name][key as 'p']) < 1e-8));
}
export function compile(motion: Motion, resolve: Resolver): Timeline {
  const timeline: Timeline = { duration: 0, segments: [] };
  const append = (s: Segment) => {
    s.start = timeline.duration; timeline.segments.push(s); timeline.duration += s.duration;
    if (timeline.duration > 600 || timeline.segments.length > 20000) throw new MotionError('BUDGET', 'Composition exceeds 600 seconds or 20000 segments');
  };
  const add = (clip: Clip, from: number, to: number, speed: number, transition: number, occurrence: string) => {
    if (from < 0 || to > clip.duration || to - from < .001) throw new MotionError('INVALID_INTERVAL', `${occurrence}: select an interval within the source clip`);
    const begin = sampleClip(clip, from, speed);
    if (timeline.segments.length) {
      const previous = sample(timeline, timeline.duration).pose;
      // Adjacent unmodified slices reconstruct the original polynomial exactly.
      if (!equal(previous, begin)) append(bridge(previous, begin, transition, `${occurrence}:transition`));
    }
    const times = boundaryTimes([from, to, ...Object.values(clip.tracks).flatMap(keys => keys.map(k => k.t).filter(t => t > from && t < to))]);
    for (let i = 1; i < times.length; i++) append(bridge(sampleClip(clip, times[i - 1], speed), sampleClip(clip, times[i], speed), (times[i] - times[i - 1]) / speed, occurrence));
  };
  if (motion.kind === 'clip') add(motion, 0, motion.duration, 1, .6, 'clip');
  else {
    const keys = new Set<string>();
    for (const part of motion.parts) {
      if (keys.has(part.key)) throw new MotionError('DUPLICATE_PART', part.key);
      keys.add(part.key);
      const source = resolve(part.ref).motion;
      if (source.kind !== 'clip') throw new MotionError('CLIP_REQUIRED', 'Scores reference clips directly; nested graphs are not supported');
      add(source, part.from, part.to, part.speed, part.transition, part.key);
    }
  }
  return timeline;
}
export function editOccurrence(motion: Score, key: string, change: Partial<Omit<Score['parts'][number], 'key'>>): Score {
  if (!motion.parts.some(part => part.key === key)) throw new MotionError('NOT_FOUND', `Unknown occurrence: ${key}`);
  const copy = structuredClone(motion);
  copy.parts = copy.parts.map(part => part.key === key ? { ...part, ...change } : part);
  return copy;
}

export type Run = { id: string; status: 'running' | 'completed' | 'interrupted' | 'stopped'; name: string; startedAt: number; endedAt?: number };
export class Player {
  time = 0;
  pose = restPose();
  run: Run | null = null;
  history: Run[] = [];
  private timeline: Timeline | null = null;
  private elapsed = 0;
  private stopping = false;
  occurrence = 'idle';
  play(timeline: Timeline, name: string, id: string, transition = .6) {
    const entry = sample(timeline, 0).pose;
    const entrance = equal(this.pose, entry) ? null : bridge(this.pose, entry, transition);
    const lead = entrance?.duration ?? 0;
    const end = sample(timeline, timeline.duration).pose;
    // A sliced moving endpoint needs explicit braking instead of zeroing its derivatives.
    const stopped = Object.fromEntries(Object.entries(end).map(([key, s]) => [key, { p: s.p, v: 0, a: 0 }]));
    const tail = equal(end, stopped) ? null : bridge(end, stopped, .6, 'settle');
    const prepared: Timeline = {
      duration: lead + timeline.duration + (tail?.duration ?? 0),
      segments: [...(entrance ? [entrance] : []), ...timeline.segments.map(s => ({ ...s, start: s.start + lead })), ...(tail ? [{ ...tail, start: lead + timeline.duration }] : [])],
    };
    // Validate everything before replacing the current run.
    this.finish('interrupted');
    this.timeline = prepared; this.elapsed = 0; this.stopping = false;
    this.run = { id, name, status: 'running', startedAt: this.time };
    this.occurrence = entrance ? 'transition' : sample(timeline, 0).occurrence;
    return this.run;
  }
  stop(runId: string) {
    if (this.run?.id !== runId || this.run.status !== 'running') throw new MotionError('STALE_RUN', 'The active run has changed');
    const target = Object.fromEntries(Object.entries(this.pose).map(([k, s]) => [k, { p: s.p, v: 0, a: 0 }]));
    const connection = bridge(this.pose, target, .6, 'stop');
    this.timeline = { duration: .6, segments: [connection] }; this.elapsed = 0; this.stopping = true;
  }
  advance(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new MotionError('INVALID_TIME', 'Time must be finite and nonnegative');
    this.time += seconds;
    if (!this.timeline || this.run?.status !== 'running') return;
    this.elapsed = Math.min(this.timeline.duration, this.elapsed + seconds);
    if (this.timeline.duration - this.elapsed < 1e-10) this.elapsed = this.timeline.duration;
    const frame = sample(this.timeline, this.elapsed); this.pose = frame.pose; this.occurrence = frame.occurrence;
    if (this.elapsed >= this.timeline.duration) this.finish(this.stopping ? 'stopped' : 'completed');
  }
  private finish(status: Run['status']) {
    if (this.run?.status !== 'running') return;
    this.run.status = status; this.run.endedAt = this.time;
    this.history.push({ ...this.run }); this.history = this.history.slice(-30);
  }
  state() { return { time: this.time, pose: this.pose, run: this.run, occurrence: this.occurrence, elapsed: this.elapsed, duration: this.timeline?.duration ?? 0, history: this.history }; }
}
