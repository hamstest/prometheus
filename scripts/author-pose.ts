// Offline authoring aid: fit a few key poses on the bundled rig, then store
// ordinary joint-angle tracks. No optimizer runs in the app or motion player.
import { Vector3 } from 'three';
import { avatarRig } from '../tests/vrm-fixture.ts';
import { applyPose } from '../src/rig.ts';
import { restPose, channels } from '../src/model.ts';

const rig = avatarRig(), pose = restPose();
const names = ['rightUpperArm.x','rightUpperArm.y','rightUpperArm.z','rightLowerArm.x','rightLowerArm.y','rightLowerArm.z','rightHand.x','rightHand.y','rightHand.z'];
const goal = process.argv[2] ?? 'present';
const wrist = new Vector3(...(goal === 'wave' ? [-.35,1.39,.13] : [-.48,1.1,.16]) as [number,number,number]);
const normal = new Vector3(...(goal === 'wave' ? [0,0,1] : [0,1,0]) as [number,number,number]);
const fingers = new Vector3(...(goal === 'wave' ? [-.1,1,0] : [-.9,.05,.35]) as [number,number,number]).normalize();
let seed=5183; const random=()=> {seed=(Math.imul(seed,1664525)+1013904223)|0;return (seed>>>0)/4294967296;};
function cost(values: number[]) {
  values.forEach((v,i)=>pose[names[i]].p=v); applyPose(rig.bone,pose);rig.humanoid.update();rig.root.updateMatrixWorld(true);
  const hand=rig.hand('right'), elbow=rig.point('rightLowerArm');
  return 35*hand.wrist.distanceToSquared(wrist)+4*(1-hand.palm.dot(normal))+2*(1-hand.fingers.dot(fingers))
    +15*Math.max(0,-hand.wrist.z)**2+20*Math.max(0,elbow.z-hand.wrist.z)**2
    +.025*values.reduce((s,v,i)=>s+(v-(i===2?.7:0))**2,0);
}
let best: {score:number;values:number[]}|null=null;
for(let start=0;start<18;start++) {
  const values=names.map((name,i)=>{const v=start===0?(i===2?.7:0):(channels[name].min+(channels[name].max-channels[name].min)*random())*.8; return i===6?Math.max(-.35,Math.min(.35,v)):v;});
  let score=cost(values);
  for(const step of [.3,.15,.07,.03,.012,.004]) for(let round=0;round<35;round++){
    let moved=false;
    for(let i=0;i<names.length;i++) {const original=values[i];let optimum=original;
      for(const sign of [-1,1]) { values[i]=Math.max(i===6?-.35:channels[names[i]].min+.03,Math.min(i===6?.35:channels[names[i]].max-.03,original+sign*step));const c=cost(values);if(c<score){score=c;optimum=values[i];moved=true;} }
      values[i]=optimum;
    }
    if(!moved)break;
  }
  if(!best||score<best.score)best={score,values:[...values]};
}
cost(best!.values);
const h=rig.hand('right');
console.log(JSON.stringify({goal,score:best!.score,angles:Object.fromEntries(names.map((n,i)=>[n,+best!.values[i].toFixed(3)])),wrist:h.wrist.toArray(),palm:h.palm.toArray(),fingers:h.fingers.toArray()},null,2));
