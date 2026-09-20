import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { call } from '../src/client.ts';
import { sampleClip } from '../src/motion.ts';
import { applyPose } from '../src/rig.ts';
import { restPose } from '../src/model.ts';
import { avatarRig } from '../tests/vrm-fixture.ts';

async function conversation(text:string){
  const c=await call('chat/new'),requestId=crypto.randomUUID();console.log('conversation '+c.id);
  let last='',busy=false;
  const timer=setInterval(()=>{if(busy)return;busy=true;void call('chat/read',{id:c.id}).then(d=>{const m=d.messages.at(-1),trace=JSON.parse(m?.knowledgeTrace??'[]'),line=trace.at(-1)?.summary??m?.status;if(line!==last){console.log(line);last=line;}}).finally(()=>{busy=false;});},10000);
  try{
    const r=await fetch('http://127.0.0.1:4319/api/chat/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:c.id,requestId,text,model:'gpt-5.6-luna'}),signal:AbortSignal.timeout(600000)});
    const d=await r.json();assert.ok(r.ok,JSON.stringify(d));assert.equal(d.messages.at(-1).status,'completed',d.messages.at(-1).text);return d;
  }finally{clearInterval(timer);}
}

const before=await call('search',{query:'拍手',limit:50});assert.equal(before.items.length,0,'This regression run requires no completed clap in its fixture library');
const clap=await conversation('拍手してください');
writeFileSync(new URL('../data/clap-reaction-check.json',import.meta.url),JSON.stringify(clap,null,2)+'\n');
const m=clap.messages.at(-1);assert.ok(m.motion,'A motion-required reply must produce a motion');assert.ok(m.text.includes('イメージに合っていますか'));
const proposal=JSON.parse(m.motion);assert.ok(proposal.candidate);const saved=await call('inspect',{ref:proposal.ref});assert.ok(saved.motion.derivation);
const rig=avatarRig();applyPose(rig.bone,restPose());rig.humanoid.update();rig.root.updateMatrixWorld(true);const foot=rig.point('leftFoot');
let minGap=Infinity,maxGap=0,contactTime=0,opposition=0;
for(let i=0;i<=360;i++){
  const t=saved.motion.duration*i/360;applyPose(rig.bone,sampleClip(saved.motion,t));rig.humanoid.update();rig.root.updateMatrixWorld(true);
  assert.ok(rig.point('leftFoot').distanceTo(foot)<1e-8);
  const right=rig.point('rightHand').lerp(rig.point('rightMiddleProximal'),.5),left=rig.point('leftHand').lerp(rig.point('leftMiddleProximal'),.5),gap=left.distanceTo(right);
  if(gap<minGap){minGap=gap;contactTime=t;opposition=rig.hand('right').palm.dot(rig.hand('left').palm);}maxGap=Math.max(maxGap,gap);
}
assert.ok(minGap<.03,`Palms never approach: ${minGap}m`);assert.ok(opposition<-.95,`Palms do not face each other: ${opposition}`);
const initialState=await call('state'),runId=initialState.run?.id;
const plain=await conversation('本の話をしてもいい？');const p=plain.messages.at(-1);
assert.equal(JSON.parse(p.reaction).kind,'chat');assert.equal(p.motion,null);assert.equal(p.expression,null);
assert.ok(!JSON.parse(p.knowledgeTrace).some((t:any)=>t.operation.includes('search')||t.operation==='derive'||t.operation==='semantic-build'));
assert.equal((await call('state')).run?.id,runId);
writeFileSync(new URL('../docs/chat-reaction-verification.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),clap,plain,physical:{minGap,maxGap,contactTime,opposition}},null,2)+'\n');
console.log(JSON.stringify({clap:proposal,plain:p.text,physical:{minGap,opposition}},null,2));
