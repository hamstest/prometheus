import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MotionError, type Motion, type Ref, type Saved, type Review } from './model.ts';
import { motionSchema, refSchema, searchSchema, validateClip } from './validation.ts';
import { compile } from './motion.ts';
import { bodyGroups } from './ontology.ts';
import { semanticInspect } from './semantic.ts';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase();

export class Library {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS motions (
        id TEXT NOT NULL, version INTEGER NOT NULL, hash TEXT NOT NULL, json TEXT NOT NULL,
        name TEXT NOT NULL, kind TEXT NOT NULL, meanings TEXT NOT NULL, context TEXT NOT NULL,
        search TEXT NOT NULL, createdAt TEXT NOT NULL, PRIMARY KEY(id,version)
      );
      CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY, motionId TEXT NOT NULL, version INTEGER NOT NULL,
        verdict TEXT NOT NULL, body TEXT NOT NULL, context TEXT NOT NULL, note TEXT NOT NULL, createdAt TEXT NOT NULL
      );`);
  }
  close() { this.db.close(); }
  get(ref: Ref): Saved {
    refSchema.parse(ref);
    const row = this.db.prepare('SELECT hash,json,createdAt FROM motions WHERE id=? AND version=?').get(ref.id, ref.version);
    if (!row) throw new MotionError('NOT_FOUND', `${ref.id}@${ref.version} does not exist`);
    return { ref: { ...ref }, hash: String(row.hash), motion: JSON.parse(String(row.json)), createdAt: String(row.createdAt) };
  }
  validate(input: unknown): Motion {
    const motion = motionSchema.parse(input);
    if (motion.kind === 'clip') validateClip(motion);
    if(motion.semantic){
      const s=motion.semantic,definition=semanticInspect({id:s.operation,version:s.version});
      if(s.angleDeg>definition.parameters.angleDeg.max||!definition.parameters.direction.choices.some(d=>d.id===s.direction)||Boolean(definition.parameters.side)!==Boolean(s.side))throw new MotionError('INVALID_PARAMETER','意味付きパラメーターが定義と一致しません。');
      const duration=s.timing.mode==='duration'?s.timing.durationSec:s.angleDeg/s.timing.speedDegPerSec;
      if(Math.abs(duration-s.durationSec)>1e-8)throw new MotionError('INVALID_PARAMETER','角度・速度・時間が一致しません。');
      if(s.base){const source=compile(this.get(s.base.ref).motion,r=>this.get(r));if(s.base.time>source.duration)throw new MotionError('INVALID_INTERVAL','開始姿勢の時刻が元の範囲外です。');}
    }
    for(const source of motion.derivation?.selections??[]){
      const saved=this.get(source.ref);
      const table=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge'").get();
      const row=table?this.db.prepare('SELECT json,hash FROM knowledge WHERE motionId=? AND version=? AND revision=?').get(source.ref.id,source.ref.version,source.revision):undefined;
      if(!row||row.hash!==saved.hash||!JSON.parse(String(row.json)).definition.components.some((c:{key:string})=>c.key===source.component))throw new MotionError('INVALID_DERIVATION','派生元の固定版・知識の版・部品を確認できません。');
    }
    const timeline=compile(motion, ref => this.get(ref));
    if(motion.derivation?.layout){
      if(motion.derivation.layout.length!==motion.derivation.selections.length||motion.derivation.layout.some(p=>p.to-p.from<.02||p.to>timeline.duration+1e-8||p.bodyParts.some(b=>!Object.hasOwn(bodyGroups,b))))throw new MotionError('INVALID_DERIVATION','構成部品の配置を確認できません。');
    }
    return motion;
  }
  save(id: string, expectedVersion: number, input: unknown): Saved {
    refSchema.shape.id.parse(id);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new MotionError('INVALID_VERSION', 'expectedVersion must be a nonnegative integer');
    const motion = this.validate(input), json = canonical(motion);
    const hash = createHash('sha256').update(json).digest('hex'), createdAt = new Date().toISOString();
    this.db.exec('SAVEPOINT motion_save');
    try {
      const latest = Number(this.db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM motions WHERE id=?').get(id)!.version);
      if (latest !== expectedVersion) throw new MotionError('VERSION_CONFLICT', `Expected ${expectedVersion}; latest is ${latest}. Reload before saving.`);
      const ref = { id, version: latest + 1 };
      this.db.prepare('INSERT INTO motions VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, ref.version, hash, json, motion.name, motion.kind, JSON.stringify(motion.meanings), motion.context, normalize([motion.name, ...motion.meanings, motion.context].join(' ')), createdAt);
      this.db.exec('RELEASE motion_save');
      return { ref, hash, motion, createdAt };
    } catch (e) { this.db.exec('ROLLBACK TO motion_save; RELEASE motion_save'); throw e; }
  }
  search(input: unknown) {
    const { query, offset, limit } = searchSchema.parse(input);
    const words = [...new Set([normalize(query).trim(), ...[...new Intl.Segmenter('ja', { granularity: 'word' }).segment(normalize(query))].filter(s => s.isWordLike && s.segment.length >= 2).map(s => s.segment)])].filter(Boolean).slice(0, 16);
    const score = words.length ? words.map(() => '(CASE WHEN instr(search, ?) > 0 THEN 1 ELSE 0 END)').join('+') : '1';
    const sql = `WITH latest AS (SELECT id,MAX(version) AS version FROM motions GROUP BY id),
      found AS (SELECT m.id,m.version,m.name,m.kind,m.meanings,m.context,m.hash,(${score}) AS rank
      FROM motions m JOIN latest l ON m.id=l.id AND m.version=l.version)
      SELECT * FROM found WHERE rank>0 ORDER BY rank DESC,name,id LIMIT ? OFFSET ?`;
    const rows = this.db.prepare(sql).all(...words, limit + 1, offset);
    return {
      items: rows.slice(0, limit).map(r => ({ ref: { id: String(r.id), version: Number(r.version) }, name: r.name, kind: r.kind, meanings: JSON.parse(String(r.meanings)), context: r.context, hash: r.hash })),
      nextOffset: rows.length > limit ? offset + limit : null,
      searchMethod: 'meaning-tags-and-keywords',
    };
  }
  review(value: Omit<Review, 'createdAt'>): Review {
    this.get(value.ref);
    const createdAt = new Date().toISOString();
    this.db.prepare('INSERT INTO reviews(motionId,version,verdict,body,context,note,createdAt) VALUES (?,?,?,?,?,?,?)').run(value.ref.id, value.ref.version, value.verdict, value.body, value.context, value.note, createdAt);
    return { ...value, createdAt };
  }
  reviews(ref: Ref) {
    return this.db.prepare('SELECT verdict,body,context,note,createdAt FROM reviews WHERE motionId=? AND version=? ORDER BY id').all(ref.id, ref.version);
  }
}
