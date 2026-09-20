import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Library } from '../src/store.ts';
import { examples } from '../src/seeds.ts';
import { PROFILE, BODY, type Score } from '../src/model.ts';
import { compile, sample } from '../src/motion.ts';

test('restart, concurrent writers and source revisions cannot change a saved composition or transfer an old review', () => {
  const folder = mkdtempSync(join(tmpdir(), 'prometheus-v3-test-')), path = join(folder, 'library.sqlite');
  let library = new Library(path); const other = new Library(path);
  try {
    const saved = library.save('greeting', 0, examples()[0].clip);
    const score: Score = { kind: 'score', profile: PROFILE, name: '固定した挨拶', meanings: ['挨拶'], context: 'fixed standing', source: 'test', license: 'test', parts: [{ key: 'wave', ref: saved.ref, from: .3, to: 2.5, speed: 1, transition: .6 }] };
    const composition = library.save('composition', 0, score);
    const before = sample(compile(composition.motion, r => library.get(r)), 1).pose;
    library.review({ ref: saved.ref, verdict: 'accepted', body: BODY, context: 'test only', note: 'Synthetic test fixture, not a human assessment' });
    const change = structuredClone(saved.motion); change.name = 'Updated example';
    const newer = other.save('greeting', 1, change);
    assert.throws(() => library.save('greeting', 1, { ...change, name: 'lost update' }), /latest is 2/);
    library.close(); library = new Library(path);
    assert.equal(library.get(saved.ref).hash, saved.hash); assert.equal(library.get(newer.ref).motion.name, 'Updated example');
    assert.deepEqual(sample(compile(library.get(composition.ref).motion, r => library.get(r)), 1).pose, before);
    assert.equal(library.reviews(saved.ref).length, 1); assert.equal(library.reviews(newer.ref).length, 0);
    const search = library.search({ query: '相手に挨拶する', limit: 1 }); assert.equal(search.items.length, 1); assert.notEqual(search.nextOffset, null);
    const second = library.search({ query: '相手に挨拶する', offset: search.nextOffset, limit: 1 }); assert.equal(second.items.length, 1); assert.notEqual(second.items[0].ref.id, search.items[0].ref.id);
    assert.ok(!('motion' in search.items[0]), 'Search must not dump full animation tracks');
  } finally { library.close(); other.close(); rmSync(folder, { recursive: true, force: true }); }
});
