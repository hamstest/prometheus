import test from 'node:test';
import assert from 'node:assert/strict';
import { examples, previousExamples, seed } from '../src/seeds.ts';
import { coefficients, range } from '../src/curve.ts';
import { sampleClip } from '../src/motion.ts';
import { Library } from '../src/store.ts';
import { PlaybackBuffer } from '../src/playback-buffer.ts';
import { restPose, type Clip } from '../src/model.ts';

function jerkEnergy(clip:Clip){
  let energy=0;
  for(const keys of Object.values(clip.tracks))for(let i=1;i<keys.length;i++){
    const h=keys[i].t-keys[i-1].t,c=coefficients(keys[i-1],keys[i],h),j=[6*c[3],24*c[4],60*c[5]];
    for(let a=0;a<3;a++)for(let b=0;b<3;b++)energy+=j[a]*j[b]/(a+b+1)/h**5;
  }
  return energy;
}
test('flowing examples retain every pose, time and hold, stay within local angles and remove false stops with less jerk',()=>{
  const current=new Map(examples().map(e=>[e.id,e.clip]));
  for(const {id,clip:old} of previousExamples()){
    const clip=current.get(id)!;assert.equal(clip.duration,old.duration);
    for(const [axis,keys] of Object.entries(clip.tracks)){
      assert.deepEqual(keys.map(k=>[k.t,k.p]),old.tracks[axis].map(k=>[k.t,k.p]));
      for(let i=1;i<keys.length;i++){
        const a=keys[i-1],b=keys[i],bounds=range(coefficients(a,b,b.t-a.t));
        assert.ok(bounds[0]>=Math.min(a.p,b.p)-1e-9&&bounds[1]<=Math.max(a.p,b.p)+1e-9,`${id}/${axis} overshoot`);
        if(a.p===b.p)assert.deepEqual([a.v,a.a,b.v,b.a],[0,0,0,0]);
      }
      for(let i=1;i<keys.length-1;i++){
        const before=keys[i].p-keys[i-1].p,after=keys[i+1].p-keys[i].p;
        if(before*after>1e-10)assert.ok(Math.abs(keys[i].v)>1e-8,`${id}/${axis} false stop`);
        if(before*after< -1e-10){assert.equal(keys[i].v,0);assert.ok(Math.abs(keys[i].a)>1e-8,`${id}/${axis} flat turn`);}
        const left=sampleClip(clip,keys[i].t-1e-7)[axis],right=sampleClip(clip,keys[i].t+1e-7)[axis];
        assert.ok(Math.abs(left.v-right.v)<1e-4&&Math.abs(left.a-right.a)<1e-3);
      }
    }
    if(id!=='rest')assert.ok(jerkEnergy(clip)<jerkEnergy(old)*.9,`${id} did not reduce jerk`);
  }
});
test('previous starter versions remain immutable after smoothness upgrade, and user edits are not rewritten',()=>{
  const lib=new Library(':memory:');try{
    for(const e of previousExamples())lib.save(e.id,0,e.clip);
    const old=lib.get({id:'greeting',version:1}),custom=lib.get({id:'present',version:1});custom.motion.name='Explicit user edit';lib.save('present',1,custom.motion);
    seed(lib);assert.deepEqual(lib.get(old.ref),old);assert.notEqual(lib.get({id:'greeting',version:2}).hash,old.hash);assert.equal(lib.get({id:'present',version:2}).motion.name,'Explicit user edit');
    const count=lib.db.prepare('SELECT COUNT(*) n FROM motions').get()!.n;seed(lib);assert.equal(lib.db.prepare('SELECT COUNT(*) n FROM motions').get()!.n,count);
  }finally{lib.close();}
});
test('presentation time never rewinds under ordered jitter, freezes on outage and recovers on a new server clock',()=>{
  const buffer=new PlaybackBuffer(),snap=(time:number)=>{const pose=restPose();pose['head.y']={p:time*.02,v:.02,a:0};return {time,pose};};
  const delays=[.01,.025,.052,.035,.02,.04],packets=Array.from({length:120},(_,i)=>({time:i/30,arrival:(i/30+delays[i%delays.length])*1000}));
  let index=0,previous=-Infinity;
  for(let now=0;now<4200;now+=1000/120){
    while(index<packets.length&&packets[index].arrival<=now){const p=packets[index++];buffer.push(snap(p.time),p.arrival);}
    const frame=buffer.sample(now);if(!frame)continue;
    assert.ok(frame.time>=previous-1e-12);previous=frame.time;
    assert.ok(Math.abs(frame.pose['head.y'].p-frame.time*.02)<1e-10);
    assert.ok(frame.time<=packets[index-1].time+1e-12);
  }
  const frozen=buffer.sample(8000)!;assert.equal(frozen.time,packets.at(-1)!.time);
  buffer.push(snap(0),9000);assert.equal(buffer.sample(9000)!.time,0);
  buffer.push(snap(.1),9100);assert.ok(buffer.sample(9150)!.time<=.1);
});
