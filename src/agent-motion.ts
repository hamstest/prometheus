import { randomUUID } from 'node:crypto';
import { Library } from './store.ts';
import { Knowledge, deriveSchema } from './knowledge.ts';
import { type Ref, type Clip, type Saved, MotionError } from './model.ts';
import { buildSemantic, semanticBuildSchema } from './semantic.ts';

export const CATALOG_LIMIT=8, CATALOG_BYTES=3600;
export function compactCatalog(items:{ref:Ref;name:string;description:string}[]){
  const result:{key:string;description:string}[]=[];
  for(const i of items){
    const entry={key:`${i.ref.id}@${i.ref.version}`,description:`${i.name}。${i.description}`.slice(0,180)};
    if(Buffer.byteLength(JSON.stringify([...result,entry]),'utf8')>CATALOG_BYTES)continue;
    result.push(entry);if(result.length===CATALOG_LIMIT)break;
  }
  return result;
}
export function retrievalQuery(messages:{role:string;text:string}[]){
  const users=messages.filter(m=>m.role==='user'),latest=users.at(-1)?.text??'';
  // History only resolves explicit references; unrelated old intents do not leak in.
  return (/もう一度|もう一回|それを|さっきの|先ほどの/.test(latest)?`${latest} ${users.at(-2)?.text??''}`:latest).slice(0,300);
}

// All experimental intermediate nodes live in an isolated, request-local database.
// Only the selected root's dependency closure is committed, atomically.
export class MotionWorkspace {
  readonly library=new Library(':memory:');
  readonly knowledge=new Knowledge(this.library);
  readonly drafts=new Map<string,Ref>();
  private imported=new Set<string>();
  private nonce=randomUUID();
  readonly source:Library;
  constructor(source:Library){this.source=source;}
  import(ref:Ref,depth=0){
    const key=`${ref.id}@${ref.version}`;
    if(this.imported.has(key)||[...this.drafts.values()].some(r=>r.id===ref.id&&r.version===ref.version))return;
    if(depth>16||this.imported.size>=512)throw new MotionError('BUDGET','構成の深さまたは参照数の上限です。');
    const saved=this.source.get(ref);this.imported.add(key);
    for(const s of saved.motion.derivation?.selections??[])this.import(s.ref,depth+1);
    if(saved.motion.semantic?.base)this.import(saved.motion.semantic.base.ref,depth+1);
    if(saved.motion.kind==='score')for(const s of saved.motion.parts)this.import(s.ref,depth+1);
    const row=this.source.db.prepare('SELECT * FROM motions WHERE id=? AND version=?').get(ref.id,ref.version)!;
    this.library.db.prepare('INSERT INTO motions VALUES (?,?,?,?,?,?,?,?,?,?)').run(...Object.values(row));
    for(const r of this.source.db.prepare('SELECT * FROM knowledge WHERE motionId=? AND version=?').all(ref.id,ref.version))this.library.db.prepare('INSERT INTO knowledge VALUES (?,?,?,?,?)').run(...Object.values(r));
  }
  derive(input:unknown){
    const args=deriveSchema.parse(input);for(const s of args.selections)this.import(s.ref);
    const result=this.knowledge.derive(args);return this.add(result.motion,result.warnings);
  }
  semantic(input:unknown){
    const args=semanticBuildSchema.parse(input);if(args.base)this.import(args.base.ref);
    const result=buildSemantic(this.library,args);return {...this.add(result.motion,[]),parameters:result.parameters};
  }
  private add(motion:Clip,warnings:string[]){
    const draftKey=`draft-${this.drafts.size+1}`;
    const saved=this.library.save(`draft-${this.nonce}-${this.drafts.size+1}`,0,motion);
    this.drafts.set(draftKey,saved.ref);
    const annotation=this.knowledge.ensure(saved.ref);
    return {draftKey,ref:saved.ref,revision:annotation.revision,name:saved.motion.name,description:saved.motion.description??saved.motion.meanings.join('、'),duration:motion.duration,warnings,assessment:'coordinate-bounds-only; semantic suitability requires review'};
  }
  candidate(key:string){return this.library.get(this.drafts.get(key)!).motion as Clip;}
  commit(key:string,id:string):Saved {
    const root=this.drafts.get(key);if(!root)throw new MotionError('NOT_FOUND','Unknown draft');
    const mapped=new Map<string,Ref>(),destination=new Knowledge(this.source);
    const persist=(ref:Ref,depth=0):Ref=>{
      const draft=[...this.drafts.entries()].find(([,r])=>r.id===ref.id&&r.version===ref.version);
      if(!draft)return ref;
      if(depth>16)throw new MotionError('BUDGET','構成が深すぎます。');
      if(mapped.has(ref.id))return mapped.get(ref.id)!;
      const motion=structuredClone(this.library.get(ref).motion);
      for(const s of motion.derivation?.selections??[])s.ref=persist(s.ref,depth+1);
      if(motion.semantic?.base)motion.semantic.base.ref=persist(motion.semantic.base.ref,depth+1);
      const target=ref.id===root.id?id:`${id}-part-${draft[0].slice(6)}`;
      const saved=this.source.save(target,0,motion);mapped.set(ref.id,saved.ref);
      // Preserve component keys and revision numbers used by parents.
      for(const row of this.library.db.prepare('SELECT json FROM knowledge WHERE motionId=? AND version=? ORDER BY revision').all(ref.id,ref.version)){
        const old=JSON.parse(String(row.json));destination.define({ref:saved.ref,expectedRevision:old.revision-1,definition:old.definition},'agent-composed');
      }
      return saved.ref;
    };
    this.source.db.exec('BEGIN IMMEDIATE');
    try{const ref=persist(root);this.source.db.exec('COMMIT');return this.source.get(ref);}
    catch(e){this.source.db.exec('ROLLBACK');throw e;}
  }
  close(){this.library.close();}
}
