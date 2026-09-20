import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Library } from '../src/store.ts';
import { Service } from '../src/api.ts';
import { seed } from '../src/seeds.ts';
import { MotionWorkspace, compactCatalog, CATALOG_BYTES, retrievalQuery } from '../src/agent-motion.ts';
import { sampleClip } from '../src/motion.ts';
import { Chat } from '../src/chat.ts';
import type { Reply } from '../src/codex.ts';
import type { Clip, Ref } from '../src/model.ts';
import { avatarRig } from './vrm-fixture.ts';
import { applyPose } from '../src/rig.ts';

function setup(){const library=new Library(':memory:');seed(library);return {library,service:new Service(library)};}
function request(operation:string,args:unknown):Reply{return {reaction:{kind:'motion',goal:'組み合わせ',reason:'動作の依頼'},unavailable:null,text:'',motion:null,expression:{name:'neutral',intensity:0},request:{operation:operation as 'derive',arguments:JSON.stringify(args)}};}

test('three levels preserve executable ownership, source components, immutable dependencies and actual rig contacts',()=>{
  const {library,service}=setup(),w=new MotionWorkspace(library),foot=avatarRig();
  const initialFoot=foot.point('leftFoot');
  const selection=(id:string)=>{const ref={id,version:1};service.knowledge.ensure(ref);w.import(ref);return {ref,revision:1,component:'whole',speed:1};};
  try{
    for(const p of service.knowledge.search({abstraction:'primitive',limit:50}).items){const clip=library.get(p.ref).motion as Clip;for(let i=0;i<=30;i++){applyPose(foot.bone,sampleClip(clip,clip.duration*i/30));foot.humanoid.update();foot.root.updateMatrixWorld(true);assert.ok(initialFoot.distanceTo(foot.point('leftFoot'))<1e-8);}}
    const down=selection('primitive.head.down'),up=selection('primitive.head.up'),raise=selection('primitive.right.arm.raise'),wave=selection('primitive.right.arm.wave'),lower=selection('primitive.right.arm.lower');
    const nod=w.derive({name:'基本操作でうなずく',meanings:['同意'],mode:'sequence',selections:[down,up]});
    const greeting=w.derive({name:'基本操作で手を振る',meanings:['挨拶'],mode:'sequence',selections:[raise,wave,lower]});
    const root=w.derive({name:'丁寧な挨拶',meanings:['挨拶','丁寧'],abstraction:'expression',mode:'parallel',selections:[{ref:greeting.ref,revision:1,component:'whole'},{ref:nod.ref,revision:1,component:'whole',speed:nod.duration/greeting.duration}]});
    const candidate=w.candidate(root.draftKey),baseline=JSON.stringify(candidate.tracks);
    for(let i=0;i<=200;i++){const p=sampleClip(candidate,candidate.duration*i/200);applyPose(foot.bone,p);foot.humanoid.update();foot.root.updateMatrixWorld(true);assert.ok(initialFoot.distanceTo(foot.point('leftFoot'))<1e-8);}
    const saved=w.commit(root.draftKey,'hierarchy-test');assert.equal(JSON.stringify((saved.motion as Clip).tracks),baseline);
    const sources=saved.motion.derivation!.selections;assert.equal(sources.length,2);assert.ok(sources.every(s=>!s.ref.id.startsWith('draft-')));
    for(const s of sources){const g=service.knowledge.inspect({ref:s.ref,revision:s.revision});assert.ok(g.knowledge.definition.components.some(c=>c.key==='element-1'));assert.ok(g.derivation!.selections.every(c=>c.ref.id.startsWith('primitive.')));}
    const held=w.derive({name:'腕を保って頭を下げる',meanings:['組み合わせ'],mode:'sequence',selections:[raise,down]});
    const heldClip=w.candidate(held.draftKey),arm=sampleClip(library.get(raise.ref).motion as Clip,1);
    for(let t=held.duration-.65;t<=held.duration;t+=.05)assert.ok(Math.abs(sampleClip(heldClip,t)['rightUpperArm.z'].p-arm['rightUpperArm.z'].p)<1e-9);
    const original=library.get(sources[0].ref),changed={...original.motion,name:'後から変更'};library.save(original.ref.id,1,changed);
    assert.equal(library.get(saved.ref).hash,saved.hash);assert.equal(library.reviews(saved.ref).length,0);
  }finally{w.close();library.close();}
});

test('failed final save rolls back every intermediate and abandoned work leaves no motion rows',()=>{
  const {library,service}=setup(),w=new MotionWorkspace(library);
  try{
    const ref={id:'primitive.head.down',version:1};service.knowledge.ensure(ref);w.import(ref);
    const one=w.derive({name:'一段',meanings:['同意'],mode:'sequence',selections:[{ref,revision:1,component:'whole'}]});
    const two=w.derive({name:'二段',meanings:['同意'],mode:'sequence',selections:[{ref:one.ref,revision:1,component:'whole'}]});
    library.save('collision',0,library.get(ref).motion);
    const count=library.db.prepare('SELECT COUNT(*) AS n FROM motions').get()!.n;
    assert.throws(()=>w.commit(two.draftKey,'collision'),/Expected/);
    assert.equal(library.db.prepare('SELECT COUNT(*) AS n FROM motions').get()!.n,count);
    assert.equal(library.db.prepare("SELECT COUNT(*) AS n FROM motions WHERE id LIKE 'draft-%' OR id LIKE 'collision-part-%'").get()!.n,0);
  }finally{w.close();library.close();}
});

test('relevant catalog is bounded and numeric detail is disclosed only after an explicit parameter request',async()=>{
  const {library,service}=setup();let step=0;
  const ref={id:'primitive.head.down',version:1};
  const instructions=[request('knowledge-search',{query:'頭を下げる',abstraction:'primitive'}),request('knowledge-inspect',{ref}),request('motion-parameters',{ref,revision:1,component:'whole',channels:['head.x'],limit:1}),{text:'確認できました。',motion:null,expression:{name:'neutral',intensity:0},request:null} as Reply];
  const chat=new Chat(service,{status:async()=>({connected:true,models:[]}),login:async()=>({authUrl:''}),close(){},reply:async(messages,catalog)=>{
    assert.ok(catalog.length<=8);assert.ok(Buffer.byteLength(JSON.stringify(catalog),'utf8')<=CATALOG_BYTES);
    for(const card of catalog)assert.deepEqual(Object.keys(card as object).sort(),['description','key']);
    if(step===1){const out=JSON.parse(messages.at(-1)!.text).hostKnowledgeResult;assert.ok(out.items.every((i:any)=>i.key.startsWith('primitive.')));assert.ok(!JSON.stringify(out).includes('bodyParts'));}
    if(step===2){const out=JSON.parse(messages.at(-1)!.text).hostKnowledgeResult;assert.ok(out.components.length);assert.ok(!('tracks' in out));assert.ok(!('samples' in out));}
    if(step===3){const out=JSON.parse(messages.at(-1)!.text).hostKnowledgeResult;assert.equal(out.samples.length,1);assert.deepEqual(Object.keys(out.samples[0].pose),['head.x']);}
    return {...instructions[step++],reaction:{kind:'chat',goal:'パラメーターの確認',reason:'動作の実行は不要'},unavailable:null};
  }});
  try{
    const query=retrievalQuery([{role:'user',text:'挨拶して'},{role:'user',text:'天気の話'}]);assert.equal(query,'天気の話');
    assert.equal(compactCatalog(service.knowledge.search({query:'量子コンピューターxyz'}).items).length,0);
    const {id}=await chat.dispatch('new',{}) as any,result=await chat.dispatch('send',{id,requestId:randomUUID(),text:'頭を下げる基本操作のパラメータを調べて',model:'test'}) as any;
    assert.equal(result.messages.at(-1).status,'completed',result.messages.at(-1).text);assert.equal(step,4);
  }finally{chat.close();library.close();}
});

test('agent reuses an inspected draft in a later composition and saves its dependency closure',async()=>{
  const {library,service}=setup();let step=0,first:Ref;const ref={id:'primitive.head.down',version:1};
  const chat=new Chat(service,{status:async()=>({connected:true,models:[]}),login:async()=>({authUrl:''}),close(){},reply:async messages=>{
    const out=step?JSON.parse(messages.at(-1)!.text).hostKnowledgeResult:null;
    switch(step++){
      case 0:return request('knowledge-search',{query:'頭を下げる',abstraction:'primitive'});
      case 1:return request('knowledge-inspect',{ref});
      case 2:return request('derive',{name:'小さく下げる',meanings:['うなずく'],mode:'sequence',selections:[{ref,revision:1,component:'whole',amplitude:.5}]});
      case 3:assert.ok(out.ref,JSON.stringify(out));first=out.ref;return request('knowledge-inspect',{ref:first});
      case 4:return request('derive',{name:'二回下げる',meanings:['同意'],mode:'sequence',selections:[1,2].map(()=>({ref:first,revision:1,component:'whole'}))});
      default:return {reaction:{kind:'motion',goal:'組み合わせ',reason:'動作の依頼'},unavailable:null,text:'基本操作を組み合わせて試してみます。',motion:'draft-2',expression:{name:'neutral',intensity:0},request:null};
    }
  }});
  try{
    const {id}=await chat.dispatch('new',{}) as any,result=await chat.dispatch('send',{id,requestId:randomUUID(),text:'基本操作を二段に組み合わせて',model:'test'}) as any;
    const m=result.messages.at(-1);assert.equal(m.status,'completed',m.text);
    const saved=library.get(JSON.parse(m.motion).ref),s=saved.motion.derivation!.selections;
    assert.equal(s[0].ref.id,s[1].ref.id);assert.ok(library.get(s[0].ref).motion.derivation);assert.equal(service.player.run!.status,'running');
  }finally{chat.close();library.close();}
});
