// Explicitly scoped follow-up for the studies and derived gesture made in this
// workspace. Dry-run first. This never edits a stored version or a chat record.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { call } from '../src/client.ts';
import { flowClip } from '../src/authoring.ts';
import { examples, previousExamples } from '../src/seeds.ts';
import { coefficients } from '../src/curve.ts';
import type { Clip, Motion, Saved } from '../src/model.ts';

const apply=process.argv.includes('--apply');
const items=(await call('search',{query:'',limit:50})).items;
const latest=(id:string)=>{const found=items.find((i:any)=>i.ref.id===id);assert.ok(found,`Missing ${id}`);return found.ref;};
const targets=[['ember-greeting-study',2],['greeting-study',2],['chat-657cfc76-f18b-4a21-8d27-cb74f8928b63',1]] as const;
const changes:{before:Saved;motion:Motion}[]=[];
for(const [id,version] of targets){
  assert.equal(latest(id).version,version,`${id}: inspect later edits before applying this migration`);
  const saved=await call('inspect',{ref:{id,version}}) as Saved;
  let motion=structuredClone(saved.motion);
  if(id==='ember-greeting-study'){
    assert.equal(motion.kind,'clip');motion=flowClip(motion as Clip);
    motion.source+=' 2026-09-10: 時刻・ポーズ・保持区間を保ち、通過点と折り返しの速度・加速度を調整。';
  }else if(motion.kind==='score'){
    for(const p of motion.parts){assert.ok(['greeting','present'].includes(p.ref.id));assert.equal(p.ref.version,2);p.ref=latest(p.ref.id);}
    motion.source+=' 2026-09-10: 区間・速度を維持し、滑らかにした見本の新版を参照。';
  }else{
    assert.equal(motion.derivation?.mode,'parallel');
    const selections=[];
    for(const s of motion.derivation!.selections){
      assert.ok(['greeting','acknowledge'].includes(s.ref.id));
      const ref=latest(s.ref.id),info=await call('knowledge-inspect',{ref});
      selections.push({...s,ref,revision:info.knowledge.revision});
    }
    motion=(await call('derive',{name:motion.name,meanings:motion.meanings,mode:'parallel',selections})).motion;
  }
  await call('validate',{motion});changes.push({before:saved,motion});
}
function jerkEnergy(clip:Clip){let sum=0;for(const keys of Object.values(clip.tracks))for(let i=1;i<keys.length;i++){const h=keys[i].t-keys[i-1].t,c=coefficients(keys[i-1],keys[i],h),j=[6*c[3],24*c[4],60*c[5]];for(let a=0;a<3;a++)for(let b=0;b<3;b++)sum+=j[a]*j[b]/(a+b+1)/h**5;}return sum;}
const templates=new Map(examples().map(e=>[e.id,e.clip]));
const report:any={applied:apply,templates:previousExamples().filter(e=>e.id!=='rest').map(({id,clip})=>({id,jerkEnergyBefore:jerkEnergy(clip),jerkEnergyAfter:jerkEnergy(templates.get(id)!)})),changes:[]};
for(const c of changes){
  const row:any={oldRef:c.before.ref,name:c.motion.name,newKind:c.motion.kind};
  if(c.motion.kind==='clip'&&c.before.motion.kind==='clip'){row.jerkEnergyBefore=jerkEnergy(c.before.motion);row.jerkEnergyAfter=jerkEnergy(c.motion);}
  if(apply){row.newRef=(await call('save',{id:c.before.ref.id,expectedVersion:c.before.ref.version,motion:c.motion})).ref;assert.equal((await call('inspect',{ref:c.before.ref})).hash,c.before.hash);}
  report.changes.push(row);
}
if(apply)writeFileSync(new URL('../docs/smoothness-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
