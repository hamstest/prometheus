import { channels, type Motion, type Clip } from './model.ts';
import { compile, sample, type Timeline } from './motion.ts';
import type { Viewer } from './viewer.ts';

export class CurveEditor {
  private motion: Motion | null = null;
  private timeline: Timeline | null = null;
  private axis = '';
  private selected = 0;
  private undo: Clip[] = [];
  private dragging: { index: number; original: Clip } | null = null;
  private viewer: Viewer;
  private change: (motion: Clip, time: number) => void;
  private report: (s: string, error?: boolean) => void;
  private $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  constructor(viewer: Viewer, change: (motion: Clip, time: number) => void, report: (s: string, error?: boolean) => void) {
    this.viewer = viewer; this.change = change; this.report = report;
    this.$('curve-channel').onchange = () => { this.axis = this.$<HTMLSelectElement>('curve-channel').value; this.selected = 0; this.draw(); };
    this.$('show-path').onchange = () => this.drawPath();
    this.$('undo-curve').onclick = () => { const previous = this.undo.pop(); if (previous) { this.motion = previous; this.timeline = compile(previous, () => { throw new Error('Unexpected reference'); }); this.change(previous, 0); this.draw(); } };
    for (const id of ['knot-time', 'knot-value']) this.$(id).onchange = () => {
      if (this.motion?.kind !== 'clip') return;
      const before = structuredClone(this.motion);
      this.edit(this.selected, Number(this.$<HTMLInputElement>('knot-time').value), Number(this.$<HTMLInputElement>('knot-value').value));
      this.undo.push(before); this.draw();
    };
    const svg = this.$('curve');
    svg.addEventListener('pointerdown', event => {
      const target = event.target as SVGElement, index = Number(target.dataset.knot);
      if (!target.hasAttribute('data-knot') || this.motion?.kind !== 'clip') return;
      event.preventDefault(); this.selected = index; this.dragging = { index, original: structuredClone(this.motion) }; svg.setPointerCapture(event.pointerId); this.draw();
    });
    svg.addEventListener('pointermove', event => {
      if (!this.dragging || this.motion?.kind !== 'clip') return;
      const rect = svg.getBoundingClientRect(), bound = channels[this.axis];
      this.edit(this.dragging.index, ((event.clientX - rect.left) / rect.width * 800 - 42) / 740 * this.motion.duration,
        bound.max - ((event.clientY - rect.top) / rect.height * 160 - 12) / 123 * (bound.max - bound.min));
    });
    const end = () => { if (this.dragging) this.undo.push(this.dragging.original); this.dragging = null; this.draw(); };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', () => { if (this.dragging) { this.motion = this.dragging.original; this.change(this.motion, 0); } this.dragging = null; this.draw(); });
  }
  set(motion: Motion, timeline: Timeline | null, reset = false) {
    this.motion = motion; this.timeline = timeline; if (reset) { this.undo = []; this.selected = 0; }
    const names = motion.kind === 'clip' ? Object.keys(motion.tracks) : Object.keys(channels);
    if (!names.includes(this.axis)) this.axis = names[0] ?? '';
    const select = this.$<HTMLSelectElement>('curve-channel'); select.replaceChildren();
    for (const name of names) { const option = document.createElement('option'); option.value = name; option.textContent = name; select.append(option); }
    select.value = this.axis; this.draw();
  }
  seek(time: number) {
    const svg = this.$('curve'), duration = this.timeline?.duration ?? (this.motion?.kind === 'clip' ? this.motion.duration : 1);
    let line = svg.querySelector('[data-playhead]');
    if (!line) { line = document.createElementNS('http://www.w3.org/2000/svg','line'); line.setAttribute('data-playhead','true'); line.setAttribute('stroke','#e97852'); line.setAttribute('stroke-width','1'); line.setAttribute('pointer-events','none'); line.setAttribute('y1','5'); line.setAttribute('y2','138'); svg.append(line); }
    const x = String(42 + Math.max(0,Math.min(duration,time))/duration*740); line.setAttribute('x1',x); line.setAttribute('x2',x);
  }
  private edit(index: number, time: number, value: number) {
    if (this.motion?.kind !== 'clip' || !Number.isFinite(time) || !Number.isFinite(value)) return;
    const copy = structuredClone(this.motion), knots = copy.tracks[this.axis], point = knots[index], bound = channels[this.axis];
    point.t = index === 0 ? 0 : index === knots.length - 1 ? copy.duration : Math.max(knots[index - 1].t + .001, Math.min(knots[index + 1].t - .001, time));
    point.p = Math.max(bound.min, Math.min(bound.max, value));
    try {
      const timeline = compile(copy, () => { throw new Error('Unexpected reference'); });
      this.motion = copy; this.timeline = timeline; this.selected = index; this.change(copy, point.t); this.draw();
    } catch { this.report('この位置では曲線が編集範囲を超えます。点を少し戻してください。', true); }
  }
  private draw() {
    const svg = this.$('curve'); svg.replaceChildren();
    this.$<HTMLButtonElement>('undo-curve').disabled = !this.undo.length;
    const motion = this.motion, bound = channels[this.axis]; if (!motion || !bound) return;
    const duration = this.timeline?.duration ?? (motion.kind === 'clip' ? motion.duration : 1);
    const x = (t: number) => 42 + t / duration * 740, y = (p: number) => 12 + (bound.max - p) / (bound.max - bound.min) * 123;
    const node = (name: string, attributes: Record<string, string | number>) => { const n = document.createElementNS('http://www.w3.org/2000/svg', name); for (const [k, v] of Object.entries(attributes)) n.setAttribute(k, String(v)); svg.append(n); return n; };
    for (let i = 0; i <= 4; i++) {
      const p = bound.min + (bound.max - bound.min) * i / 4;
      node('line', { x1: 42, x2: 782, y1: y(p), y2: y(p), stroke: '#ffffff0c' });
      node('text', { x: 2, y: y(p) + 3, fill: '#8d8889', 'font-size': 10 }).textContent = p.toFixed(1);
      node('line', { x1: x(duration * i / 4), x2: x(duration * i / 4), y1: 12, y2: 135, stroke: '#ffffff0c' });
      node('text', { x: x(duration * i / 4) - 6, y: 153, fill: '#8d8889', 'font-size': 10 }).textContent = (duration * i / 4).toFixed(1) + 's';
    }
    let timeline = this.timeline;
    if (!timeline && motion.kind === 'clip') { try { timeline = compile(motion, () => { throw new Error('Unexpected reference'); }); } catch { /* Retain invalid JSON draft until validation. */ } }
    if (timeline) {
      const d = Array.from({ length: 161 }, (_, i) => { const t = duration * i / 160; return (i ? 'L' : 'M') + x(t).toFixed(2) + ',' + y(sample(timeline!, t).pose[this.axis].p).toFixed(2); }).join(' ');
      node('path', { d, fill: 'none', stroke: '#e6b568', 'stroke-width': 2 });
    }
    const points = motion.kind === 'clip' ? motion.tracks[this.axis] : [];
    this.selected = Math.min(this.selected, points.length - 1);
    points.forEach((p, i) => {
      const dot = node('circle', { cx: x(p.t), cy: y(p.p), r: i === this.selected ? 5.5 : 4, fill: i === this.selected ? '#e97852' : '#e6b568', stroke: '#28272b', 'stroke-width': 1, 'data-knot': i, tabindex: 0, role: 'button', 'aria-label': '制御点 ' + (i + 1) });
      dot.addEventListener('keydown', event => {
        const e = event as KeyboardEvent; if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) return;
        e.preventDefault(); this.selected = i; this.undo.push(structuredClone(motion as Clip));
        this.edit(i, p.t + (e.key === 'ArrowRight' ? .01 : e.key === 'ArrowLeft' ? -.01 : 0), p.p + (e.key === 'ArrowUp' ? .01 : e.key === 'ArrowDown' ? -.01 : 0));
        (svg.querySelector('[data-knot="' + i + '"]') as SVGElement | null)?.focus();
      });
    });
    const point = points[this.selected];
    this.$('curve-hint').textContent = point ? '点をドラッグ · 時間 / 角度' : '構成は下の区間・速度で編集';
    this.$('knot-label').textContent = point ? '制御点 ' + (this.selected + 1) : '構成の軌跡';
    this.$<HTMLInputElement>('knot-time').disabled = !point || this.selected === 0 || this.selected === points.length - 1;
    this.$<HTMLInputElement>('knot-value').disabled = !point;
    this.$<HTMLInputElement>('knot-time').value = point ? point.t.toFixed(3) : '';
    this.$<HTMLInputElement>('knot-value').value = point ? point.p.toFixed(3) : '';
    this.drawPath(timeline); this.seek(Number(this.$<HTMLInputElement>('scrub').value));
  }
  private drawPath(compiled: Timeline | null = this.timeline) {
    if (document.body.dataset.mode !== 'motion' || !this.$<HTMLInputElement>('show-path').checked || !compiled || !this.axis) { this.viewer.trajectory(null); return; }
    const clip = this.motion?.kind === 'clip' ? this.motion : null, axis = this.axis;
    this.viewer.trajectory({ axis, poses: Array.from({ length: 81 }, (_, i) => sample(compiled, compiled.duration * i / 80).pose),
      knots: clip ? clip.tracks[axis].map(p => sample(compiled, p.t).pose) : [],
      select: index => { this.selected = index; if (clip) this.change(clip, clip.tracks[axis][index].t); },
      move: (index, delta, commit) => {
        if (!clip) return; const p = clip.tracks[axis][index];
        if (commit) this.undo.push(structuredClone(clip));
        this.edit(index, p.t, p.p + delta);
      } });
  }
}
