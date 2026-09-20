import test from 'node:test';
import assert from 'node:assert/strict';
import { examples,legacyExamples,seed } from '../src/seeds.ts';
import { sampleClip } from '../src/motion.ts';
import { applyPose } from '../src/rig.ts';
import { avatarRig } from './vrm-fixture.ts';
import { Library } from '../src/store.ts';

test('greetings face the other person, presentations face up, and left gestures mirror the actual rig',()=>{
  const rig=avatarRig(),clips=new Map(examples().map(e=>[e.id,e.clip]));
  const at=(id:string,t:number)=>{applyPose(rig.bone,sampleClip(clips.get(id)!,t));rig.humanoid.update();rig.root.updateMatrixWorld(true);};
  for(const [id,start,end,axis,sides] of [
    ['greeting',1.05,2.1,'z',['right']],['greeting-left',1.05,2.1,'z',['left']],
    ['present',1.1,1.8,'y',['right']],['present-left',1.1,1.8,'y',['left']],
    ['welcome',1.2,2.05,'y',['right','left']],['surprise',.6,1.1,'z',['right','left']],
  ] as const)for(let t=start;t<=end;t+=1/60){
    at(id,t);
    for(const side of sides){const h=rig.hand(side);assert.ok(h.palm[axis]>.93,`${id}@${t}: palm=${h.palm.toArray()}`);if(axis==='z')assert.ok(h.fingers.y>.9);else assert.ok(h.fingers.x*(side==='right'?-1:1)>.8);}
  }
  at('greeting',1.4);const right=rig.hand('right');at('greeting-left',1.4);const left=rig.hand('left');
  assert.ok(Math.abs(right.wrist.x+left.wrist.x)<.02);assert.ok(Math.abs(right.wrist.y-left.wrist.y)<.02);assert.ok(Math.abs(right.palm.z-left.palm.z)<.02);
});
test('starter upgrades preserve old fixed versions and reviews, and never overwrite user-edited starters',()=>{
  const library=new Library(':memory:');
  try{
    for(const old of legacyExamples())library.save(old.id,0,old.clip);
    const old=library.get({id:'greeting',version:1});library.review({ref:old.ref,verdict:'rejected',body:'test',context:'test',note:'palm faces down'});
    seed(library);assert.deepEqual(library.get(old.ref),old);
    const corrected=library.get({id:'greeting',version:2});assert.notEqual(corrected.hash,old.hash);assert.equal(library.reviews(corrected.ref).length,0);
    const count=library.db.prepare('SELECT count(*) n FROM motions').get()!.n;seed(library);assert.equal(library.db.prepare('SELECT count(*) n FROM motions').get()!.n,count);
    const user={...corrected.motion,name:'User edit'};library.save('greeting',2,user);seed(library);assert.deepEqual(library.get({id:'greeting',version:3}).motion,user);
    assert.equal(library.db.prepare("SELECT MAX(version) v FROM motions WHERE id='greeting'").get()!.v,3);
  }finally{library.close();}
});
