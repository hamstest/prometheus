import test from 'node:test';
import assert from 'node:assert/strict';
import { Library } from '../src/store.ts';
import { seed } from '../src/seeds.ts';
import { Knowledge } from '../src/knowledge.ts';
import { sampleClip } from '../src/motion.ts';
import { applyPose } from '../src/rig.ts';
import { avatarRig } from './vrm-fixture.ts';
import { restPose } from '../src/model.ts';

test('generic two-hand parts compose into repeated approaching palms, retain facing directions and return without foot movement',()=>{
  const library=new Library(':memory:');seed(library);const knowledge=new Knowledge(library),rig=avatarRig();
  const set=(pose:ReturnType<typeof restPose>)=>{applyPose(rig.bone,pose);rig.humanoid.update();rig.root.updateMatrixWorld(true);};
  const palms=()=>({right:rig.point('rightHand').lerp(rig.point('rightMiddleProximal'),.5),left:rig.point('leftHand').lerp(rig.point('leftMiddleProximal'),.5)});
  try{
    const keys=['ready','close','open','close','open','close','open','lower'];
    const selections=keys.map(key=>{const ref={id:'primitive.hands.'+key,version:1};return {ref,revision:knowledge.ensure(ref).revision,component:'whole'};});
    const composed=knowledge.derive({name:'両手の協調の確認',meanings:['両手'],mode:'sequence',selections}).motion;
    assert.ok(Math.abs(composed.duration-3.6)<1e-10);
    set(restPose());const feet=[rig.point('leftFoot'),rig.point('rightFoot')];
    for(let i=0;i<=360;i++){
      const t=i/100;set(sampleClip(composed,t));const p=palms();
      assert.ok(rig.point('leftFoot').distanceTo(feet[0])<1e-9);assert.ok(rig.point('rightFoot').distanceTo(feet[1])<1e-9);
      if(t>=.9&&t<=2.7){assert.ok(p.right.x<p.left.x);assert.ok(p.left.distanceTo(p.right)>=.011);assert.ok(rig.hand('right').palm.x>.97);assert.ok(rig.hand('left').palm.x<-.97);assert.ok(p.right.y>1.22&&p.right.y<1.26);}
    }
    for(const t of [1.2,1.8,2.4]){set(sampleClip(composed,t));const p=palms();assert.ok(p.right.distanceTo(p.left)<.013);}
    for(const t of [.9,1.5,2.1,2.7]){set(sampleClip(composed,t));const p=palms();assert.ok(Math.abs(p.right.distanceTo(p.left)-.2)<.001);}
    for(const [c,s] of Object.entries(sampleClip(composed,composed.duration)))assert.ok(Math.abs(s.p-restPose()[c].p)<1e-10);
    assert.equal(knowledge.search({query:'拍手',concepts:['hands-close']}).items.length,0,'unrelated keyword must not match solely because a concept filter matched');
    for(const id of ['primitive.hands.ready','primitive.hands.close','primitive.hands.open','primitive.hands.lower'])assert.ok(knowledge.search({query:'両手',abstraction:'primitive',limit:50}).items.some(i=>i.ref.id===id));
  }finally{library.close();}
});
