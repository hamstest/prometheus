import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PROFILE, type Clip, type Score, type Pose } from '../src/model.ts';
import { compile, sample, Player, editOccurrence } from '../src/motion.ts';
import { Library } from '../src/store.ts';
import { examples, seed } from '../src/seeds.ts';

const near = (actual: number, expected: number, eps = 1e-7) => assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);
function compare(a: Pose, b: Pose, eps = 1e-7) { for (const name of Object.keys(a)) for (const k of ['p', 'v', 'a'] as const) near(a[name][k], b[name][k], eps); }
const polynomial = (t: number) => ({ p: .02 * t ** 3 - .05 * t ** 2 + .07 * t + .1, v: .06 * t ** 2 - .1 * t + .07, a: .12 * t - .1 });
const source: Clip = { kind: 'clip', profile: PROFILE, name: 'Nonzero boundary example', meanings: ['example'], context: 'test', source: 'analytic cubic', license: 'test', duration: 2, tracks: { 'head.x': [0, .8, 2].map(t => ({ t, ...polynomial(t) })) } };

test('arbitrary cuts and reassembly preserve an independently specified trajectory, including derivatives at different speeds', () => {
  const library = new Library(':memory:');
  try {
    const saved = library.save('source', 0, source);
    for (const speed of [.6, 1, 1.7]) {
      const times = [0, .317, .911, 1.483, 2];
      const score: Score = { ...source, kind: 'score', parts: times.slice(1).map((to, i) => ({ key: `cut-${i}`, ref: saved.ref, from: times[i], to, speed, transition: .6 })) };
      // Object construction is deliberately explicit here because clip-only
      // fields are not part of the score contract.
      delete (score as unknown as Record<string, unknown>).tracks; delete (score as unknown as Record<string, unknown>).duration;
      const timeline = compile(library.validate(score), ref => library.get(ref));
      near(timeline.duration, 2 / speed);
      for (let i = 0; i <= 400; i++) {
        const t = 2 * i / 400, expected = polynomial(t), actual = sample(timeline, t / speed).pose['head.x'];
        near(actual.p, expected.p); near(actual.v, expected.v * speed); near(actual.a, expected.a * speed ** 2);
      }
    }
  } finally { library.close(); }
});

test('mid-motion switching preserves C2 state and hands off to a moving clip interval without visiting rest', () => {
  const library = new Library(':memory:'); seed(library);
  try {
    const wave = compile(library.get({ id: 'greeting', version: 1 }).motion, r => library.get(r));
    const moving = library.save('moving', 0, source);
    const next: Score = { kind: 'score', profile: PROFILE, name: 'moving', meanings: ['test'], context: 'test', source: 'test', license: 'test', parts: [{ key: 'entry', ref: moving.ref, from: .45, to: 1.55, speed: 1.4, transition: .6 }] };
    const target = compile(next, r => library.get(r));
    for (const at of [.15, .8, 1.25, 2.1, 3.0]) {
      const player = new Player(), firstId = randomUUID(); player.play(wave, 'wave', firstId); player.advance(at);
      const before = structuredClone(player.pose); const secondId = randomUUID();
      player.play(target, 'moving', secondId, .7); compare(player.pose, before);
      player.advance(0); compare(player.pose, before);
      player.advance(1e-5);
      for (const name of Object.keys(before)) near((player.pose[name].p - before[name].p) / 1e-5, before[name].v, .005);
      player.advance(.7 - 1e-5); compare(player.pose, sample(target, 0).pose);
      assert.equal(player.history[0].status, 'interrupted'); assert.equal(player.history[0].id, firstId);
      player.advance(target.duration + .6); assert.equal(player.run?.status, 'completed');
      for (const s of Object.values(player.pose)) { near(s.v, 0); near(s.a, 0); }
    }
  } finally { library.close(); }
});

test('stop brakes the current motion and a stale stop cannot affect its replacement', () => {
  const library = new Library(':memory:'); seed(library);
  try {
    const timeline = compile(library.get({ id: 'greeting', version: 1 }).motion, r => library.get(r));
    const player = new Player(), old = randomUUID(), current = randomUUID();
    player.play(timeline, 'old', old);
    near(player.state().duration, timeline.duration); // Matching entry must not add a stationary pause.
    player.advance(1); player.play(timeline, 'new', current); player.advance(.3);
    const before = structuredClone(player.state()); assert.throws(() => player.stop(old), /active run has changed/); assert.deepEqual(player.state(), before);
    player.stop(current); player.advance(0); compare(player.pose, before.pose);
    player.advance(.6); assert.equal(player.run?.status, 'stopped');
    const stopped = structuredClone(player.pose); player.advance(5); compare(player.pose, stopped);
    for (const s of Object.values(stopped)) { near(s.v, 0); near(s.a, 0); }
  } finally { library.close(); }
});

test('validation catches between-key overshoot and rejects unsupported profiles before playback changes', () => {
  const library = new Library(':memory:');
  try {
    const invalid = structuredClone(source);
    invalid.tracks['head.x'] = [{ t: 0, p: 0, v: 8, a: 0 }, { t: 2, p: 0, v: -8, a: 0 }];
    assert.throws(() => library.validate(invalid), /curve exceeds/);
    assert.throws(() => library.validate({ ...source, profile: 'unknown-body' }));
    const player = new Player(), clip = examples()[0].clip;
    player.play(compile(clip, () => { throw new Error('unused'); }), 'good', randomUUID()); player.advance(.4);
    const before = structuredClone(player.state());
    // This clip is itself valid, but its nonzero entry speed makes a long
    // connection from the current pose overshoot the head's supported range.
    const difficultEntry: Clip = { ...source, duration: .4, tracks: { 'head.x': [{ t: 0, p: .59, v: -1, a: 0 }, { t: .4, p: .3, v: 0, a: 0 }] } };
    const unsafe = compile(library.validate(difficultEntry), () => { throw new Error('unused'); });
    assert.throws(() => player.play(unsafe, 'bad', randomUUID(), 2), /connection leaves supported range/); assert.deepEqual(player.state(), before);
  } finally { library.close(); }
});

test('editing a repeated occurrence changes only that use; source versions and other uses are unchanged', () => {
  const library = new Library(':memory:');
  try {
    const saved = library.save('source', 0, source);
    const score: Score = { kind: 'score', profile: PROFILE, name: 'repeat', meanings: ['repeat'], context: 'test', source: 'test', license: 'test', parts: ['first', 'second'].map(key => ({ key, ref: saved.ref, from: 0, to: 2, speed: 1, transition: .6 })) };
    const original = structuredClone(score), edited = editOccurrence(score, 'second', { speed: .5, from: .8 });
    library.validate(edited);
    assert.deepEqual(score, original); assert.deepEqual(edited.parts[0], score.parts[0]); assert.equal(edited.parts[1].speed, .5);
    assert.deepEqual(library.get(saved.ref).motion, source);
    assert.throws(() => editOccurrence(score, 'missing', { speed: .5 }), /Unknown occurrence/);
  } finally { library.close(); }
});
