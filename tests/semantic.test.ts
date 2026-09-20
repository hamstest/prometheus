import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Vector3 } from 'three';
import { Library } from '../src/store.ts';
import { semanticSearch, semanticInspect, buildSemantic, semanticOperations } from '../src/semantic.ts';
import { sampleClip } from '../src/motion.ts';
import { restPose, type Ref } from '../src/model.ts';
import { applyPose } from '../src/rig.ts';
import { avatarRig } from './vrm-fixture.ts';
import { MotionWorkspace } from '../src/agent-motion.ts';
import { Service } from '../src/api.ts';
import { Chat } from '../src/chat.ts';
import type { Reply } from '../src/codex.ts';

const args=(side='right',direction='clockwise')=>({id:'forearm-twist',version:1,parameters:{side,direction,angleDeg:30,timing:{mode:'speed',speedDegPerSec:30},holdSec:.3,returnToStart:true}});
test('semantic twists rotate the actual palm by the signed angle around each forearm and preserve contacts and C2 endpoints',()=>{
  const library=new Library(':memory:'),rig=avatarRig();
  const set=(pose:ReturnType<typeof restPose>)=>{applyPose(rig.bone,pose);rig.humanoid.update();rig.root.updateMatrixWorld(true);};
  try{
    for(const side of ['right','left'] as const)for(const direction of ['clockwise','counterclockwise']){
      set(restPose());const start=rig.hand(side),axis=start.wrist.clone().sub(rig.point(side+'LowerArm')).normalize(),feet=rig.point('leftFoot');
      const {motion}=buildSemantic(library,args(side,direction));assert.equal(motion.duration,2.3);
      const byDuration=args(side,direction) as any;byDuration.parameters.timing={mode:'duration',durationSec:1};assert.deepEqual(buildSemantic(library,byDuration).motion.tracks,motion.tracks);
      for(let i=0;i<=230;i++){const pose=sampleClip(motion,i/100);set(pose);assert.ok(rig.hand(side).wrist.distanceTo(start.wrist)<.00002);assert.ok(rig.point('leftFoot').distanceTo(feet)<1e-9);}
      set(sampleClip(motion,1));const end=rig.hand(side);
      const project=(v:Vector3)=>v.clone().addScaledVector(axis,-v.dot(axis)).normalize(),a=project(start.palm),b=project(end.palm);
      const signed=Math.atan2(axis.dot(new Vector3().crossVectors(a,b)),a.dot(b))*180/Math.PI;
      assert.ok(Math.abs(signed-(direction==='clockwise'?30:-30))<.01,`${side} ${direction}: ${signed}`);
      for(const t of [0,1,1.3,2.3])for(const s of Object.values(sampleClip(motion,t))){assert.ok(Math.abs(s.v)<1e-8);assert.ok(Math.abs(s.a)<1e-7);}
      for(const c of Object.keys(motion.tracks))assert.ok(Math.abs(sampleClip(motion,2.3)[c].p-restPose()[c].p)<1e-12);
      for(const c of Object.keys(motion.tracks))assert.equal(sampleClip(motion,1)[c].p,sampleClip(motion,1.15)[c].p);
    }
    set(restPose());const foot=rig.point('leftFoot');
    for(const op of semanticOperations){const def=semanticInspect({id:op.id});const {motion}=buildSemantic(library,{id:op.id,version:1,parameters:{...(op.bilateral?{side:'right'}:{}),direction:def.parameters.direction.default,angleDeg:20,timing:{mode:'duration',durationSec:1}}});for(let i=0;i<=100;i++){set(sampleClip(motion,i/100));assert.ok(rig.point('leftFoot').distanceTo(foot)<1e-9);}}
  }finally{library.close();}
});

test('semantic parameter validation, fixed base poses and dependency commits preserve reproducibility',()=>{
  const library=new Library(':memory:'),w=new MotionWorkspace(library);
  try{
    const first=w.semantic(args());const second=w.semantic({...args('left'),base:{ref:first.ref,time:1}});
    const final=w.derive({name:'左右の腕',meanings:['ひねる'],mode:'sequence',selections:[{ref:first.ref,revision:1,component:'whole'},{ref:second.ref,revision:1,component:'whole'}]});
    const saved=w.commit(final.draftKey,'semantic-composed'),children=saved.motion.derivation!.selections;
    const child=library.get(children[1].ref);assert.deepEqual(child.motion.semantic!.base!.ref,children[0].ref);
    const original=library.get(children[0].ref),hash=original.hash;library.save(original.ref.id,1,{...original.motion,name:'別の版'});assert.equal(library.get(original.ref).hash,hash);
    const input={...args(),base:{ref:original.ref,time:1}},built=buildSemantic(library,input);
    for(const c of Object.keys(built.motion.tracks))assert.ok(Math.abs(built.motion.tracks[c][0].p-sampleClip(original.motion as any,1)[c].p)<1e-12);
    const savedDirect=library.save('semantic-direct',0,built.motion);assert.deepEqual(library.get(savedDirect.ref).motion.semantic,built.parameters);
    const bad:any[]=[{...args(),parameters:{...args().parameters,angleDeg:76}},{...args(),parameters:{...args().parameters,side:undefined}},{...args(),parameters:{...args().parameters,direction:'screen-right'}},{...args(),parameters:{...args().parameters,timing:{mode:'speed',speedDegPerSec:180}}},{...args(),id:'head-nod'},{...args(),base:{ref:original.ref,time:99}}];
    for(const input of bad)assert.throws(()=>buildSemantic(library,input));
    const count=library.db.prepare('SELECT COUNT(*) AS n FROM motions').get()!.n;assert.throws(()=>w.commit(final.draftKey,'semantic-composed'));assert.equal(library.db.prepare('SELECT COUNT(*) AS n FROM motions').get()!.n,count);
  }finally{w.close();library.close();}
});

test('agent discovers semantic definitions lazily, cannot build before inspection, and saves reusable parameters',async()=>{
  const library=new Library(':memory:'),service=new Service(library);let step=0;
  const request=(operation:string,input:unknown):Reply=>({reaction:{kind:'motion',goal:'前腕のひねり',reason:'動作の依頼'},unavailable:null,text:'',motion:null,expression:{name:'neutral',intensity:0},request:{operation:operation as any,arguments:JSON.stringify(input)}});
  const sequence=[request('semantic-build',args()),request('semantic-search',{query:'前腕をひねる'}),request('semantic-inspect',{id:'forearm-twist',version:1}),request('semantic-build',args()),{text:'右前腕を30度ひねって戻します。',motion:'draft-1',expression:{name:'neutral',intensity:0},request:null} as Reply];
  const chat=new Chat(service,{status:async()=>({connected:true,models:[]}),login:async()=>({authUrl:''}),close(){},reply:async messages=>{
    const out=step?JSON.parse(messages.at(-1)!.text).hostKnowledgeResult:null;
    if(step===1)assert.ok(JSON.stringify(out).includes('semantic-inspect'));
    if(step===2){assert.ok(out.items.some((i:any)=>i.key==='operation:forearm-twist@1'));for(const c of out.items)assert.deepEqual(Object.keys(c).sort(),['description','key']);assert.ok(!JSON.stringify(out).includes('angleDeg'));}
    if(step===3){assert.equal(out.parameters.angleDeg.unit,'度');assert.ok(out.semanticParameterAccess);}
    return {...sequence[step++],reaction:{kind:'motion',goal:'前腕のひねり',reason:'動作の依頼'},unavailable:null};
  }});
  try{
    assert.ok(semanticSearch({query:'quantum xyz'}).items.length===0);
    const {id}=await chat.dispatch('new',{}) as any,result=await chat.dispatch('send',{id,requestId:randomUUID(),text:'右前腕を右回り30度、平均30度毎秒でひねって戻して',model:'test'}) as any;
    const m=result.messages.at(-1);assert.equal(m.status,'completed',m.text);assert.equal(step,5);
    const saved=library.get(JSON.parse(m.motion).ref);assert.equal(saved.motion.semantic!.angleDeg,30);assert.equal(saved.motion.semantic!.timing.mode,'speed');
    const knowledge=service.knowledge.inspect({ref:saved.ref});assert.ok(knowledge.edges.some(e=>e.relation==='instantiates'));assert.ok(knowledge.knowledge.definition.concepts.includes('forearm-twist'));assert.ok(!knowledge.knowledge.definition.concepts.includes('rest'));assert.equal(library.reviews(saved.ref).length,0);
    assert.ok(service.knowledge.search({concepts:['arm-twist']}).items.some(i=>i.ref.id===saved.ref.id));
  }finally{chat.close();library.close();}
});
