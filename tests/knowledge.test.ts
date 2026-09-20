import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Library } from '../src/store.ts';
import { Service } from '../src/api.ts';
import { seed } from '../src/seeds.ts';
import { channels, type Clip } from '../src/model.ts';
import { sampleClip } from '../src/motion.ts';
import { ownedChannels, ontology } from '../src/ontology.ts';
import { avatarRig } from './vrm-fixture.ts';
import { applyPose } from '../src/rig.ts';

function setup(path=':memory:'){const library=new Library(path);seed(library);const service=new Service(library);return {library,k:service.knowledge,service};}
test('meaning retrieval expands aliases and subtypes without treating related concepts or sibling intents as equal',()=>{
  const {library,k}=setup();try{
    const search=(query:string)=>k.search({query}).items;
    assert.ok(search('さようなら').some(i=>i.ref.id==='greeting'));
    assert.ok(search('対話表現').some(i=>i.ref.id==='acknowledge'));
    assert.ok(search('お礼').some(i=>i.ref.id==='bow'));
    assert.ok(!search('歓迎').some(i=>i.ref.id==='greeting'));
    assert.ok(k.search({query:'歓迎',includeRelated:true}).items.find(i=>i.ref.id==='greeting')?.reasons.some(r=>r.relation==='related-only'));
    assert.ok(search('右腕').length>0);assert.ok(search('右腕').every(i=>i.components.every(c=>c.bodyParts.includes('rightArm'))));
    assert.ok(search('準備').length>0);assert.ok(search('準備').every(i=>i.components.every(c=>c.concepts.includes('prepare'))));
    assert.equal(search('存在しない語xyz').length,0);
    const graph=ontology(),ids=new Set(graph.nodes.map(n=>n.id));
    assert.equal(ids.size,graph.nodes.length);for(const e of graph.edges){assert.ok(ids.has(e.from));assert.ok(ids.has(e.to));}
  }finally{library.close();}
});
test('component extraction preserves continuous source curves and parallel composition keeps disjoint ownership on the actual rig',()=>{
  const {library,k}=setup();try{
    const wave=k.inspect({ref:{id:'greeting',version:1}}).knowledge,nod=k.inspect({ref:{id:'acknowledge',version:1}}).knowledge;
    const select=(id:string,component:string,speed=1)=>({ref:{id,version:1},revision:1,component,speed});
    const stroke=k.derive({name:'抽出',meanings:['手を振る'],mode:'sequence',selections:[select('greeting','stroke',1.2)]}).motion;
    const source=library.get(wave.ref).motion as Clip,c=wave.definition.components.find(c=>c.key==='stroke')!;
    for(let i=0;i<=150;i++){
      const t=stroke.duration*i/150,a=sampleClip(stroke,t),b=sampleClip(source,c.from+t*1.2,1.2);
      for(const axis of Object.keys(channels))for(const d of ['p','v','a'] as const)assert.ok(Math.abs(a[axis][d]-b[axis][d])<1e-7,`${axis}.${d}`);
    }
    const composed=k.derive({name:'うなずきながら右手を振る',meanings:['挨拶','同意'],mode:'parallel',selections:[select('greeting','body-rightArm'),select('acknowledge','body-head',1.4/3.15)]}).motion;
    const head=library.get(nod.ref).motion as Clip,rig=avatarRig(),foot=rig.point('leftFoot');
    for(let i=0;i<=150;i++){
      const t=composed.duration*i/150,p=sampleClip(composed,t),w=sampleClip(source,t),n=sampleClip(head,t*1.4/3.15,1.4/3.15);
      for(const axis of ownedChannels(['rightArm']))for(const d of ['p','v','a'] as const)assert.ok(Math.abs(p[axis][d]-w[axis][d])<1e-7);
      for(const axis of ownedChannels(['head']))for(const d of ['p','v','a'] as const)assert.ok(Math.abs(p[axis][d]-n[axis][d])<1e-7);
      applyPose(rig.bone,p);rig.humanoid.update();rig.root.updateMatrixWorld(true);assert.ok(rig.point('leftFoot').distanceTo(foot)<1e-8);
    }
    assert.ok(composed.derivation?.conditions.some(c=>c.includes('協調')));
    assert.throws(()=>k.derive({name:'競合',meanings:['挨拶'],mode:'parallel',selections:[select('greeting','whole'),select('greeting','body-rightArm')]}),/複数/);
    assert.throws(()=>k.derive({name:'長さ不一致',meanings:['挨拶'],mode:'parallel',selections:[select('greeting','body-rightArm'),select('acknowledge','body-head')]}),/長さ/);
  }finally{library.close();}
});
test('knowledge revisions, derived references and old reviews survive restart and reject stale or fabricated lineage',()=>{
  const dir=mkdtempSync(join(tmpdir(),'prometheus-knowledge-')),path=join(dir,'test.sqlite');let state=setup(path);
  try{
    const ref={id:'greeting',version:1},old=state.k.inspect({ref}).knowledge,definition=structuredClone(old.definition),before=state.library.get(ref);
    definition.note='別の定義';definition.components.find(c=>c.key==='stroke')!.from=.8;
    state.k.define({ref,expectedRevision:1,definition});
    assert.throws(()=>state.k.define({ref,expectedRevision:1,definition}),/再読込/);
    assert.deepEqual(state.k.inspect({ref,revision:1}).knowledge,old);assert.deepEqual(state.library.get(ref),before);
    const motion=state.k.derive({name:'以前の区間を使う',meanings:['挨拶'],mode:'sequence',selections:[{ref,revision:1,component:'stroke'}]}).motion;
    const saved=state.library.save('derived',0,motion);state.library.close();state=setup(path);
    assert.deepEqual(state.library.get(saved.ref),saved);assert.equal(state.k.inspect({ref,revision:1}).knowledge.definition.note,old.definition.note);
    const bad=structuredClone(motion);bad.derivation!.selections[0].revision=999;assert.throws(()=>state.library.save('invalid',0,bad),/派生元/);
    const next=structuredClone(before.motion);next.name='新版';state.library.save(ref.id,1,next);assert.equal(state.k.inspect({ref:{id:ref.id,version:2}}).knowledge.revision,1);
    assert.equal(state.library.reviews(saved.ref).length,0);
  }finally{state.library.close();rmSync(dir,{recursive:true,force:true});}
});
