// Offline pose authoring only. The generated poses are ordinary clip data;
// no inverse kinematics or gesture-specific controller runs in the app.
import { writeFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { avatarRig } from '../tests/vrm-fixture.ts';
import { applyPose } from '../src/rig.ts';
import { channels, restPose } from '../src/model.ts';

const rig=avatarRig(),pose=restPose();
const keys=['UpperArm','LowerArm','Hand'].flatMap(b=>['x','y','z'].map(a=>'right'+b+'.'+a));
function fit(gap:number,start:number[]){
  let values=[...start];const target=new Vector3(-gap/2,1.24,.27),elbow=new Vector3(-.22,1.10,.11);
  const score=(x:number[])=>{
    keys.forEach((k,i)=>pose[k].p=x[i]);applyPose(rig.bone,pose);rig.humanoid.update();rig.root.updateMatrixWorld(true);
    const h=rig.hand('right'),center=h.wrist.clone().lerp(rig.point('rightMiddleProximal'),.5);
    return 500*center.distanceToSquared(target)+2*h.fingers.distanceToSquared(new Vector3(0,1,0))+2*h.palm.distanceToSquared(new Vector3(1,0,0))+.1*rig.point('rightLowerArm').distanceToSquared(elbow)+.00005*x.reduce((s,v)=>s+v*v,0);
  };
  let best=score(values);
  for(let step=.4;step>.00001;step*=.7)for(let round=0;round<50;round++){
    let changed=false;
    for(let i=0;i<keys.length;i++)for(const sign of [-1,1]){
      const candidate=[...values],bounds=channels[keys[i]];candidate[i]=Math.max(bounds.min+.01,Math.min(bounds.max-.01,candidate[i]+sign*step));
      const error=score(candidate);if(error<best){values=candidate;best=error;changed=true;}
    }
    if(!changed)break;
  }
  score(values);return {values,error:best,center:rig.hand('right').wrist.clone().lerp(rig.point('rightMiddleProximal'),.5),palm:rig.hand('right').palm,fingers:rig.hand('right').fingers};
}
const starts=[[0,.6,1.0,0,1.2,0,0,0,0],[-.8,.6,.6,0,1.4,0,0,0,0],[0,1.2,.9,0,1.8,0,0,0,0]];
const close=starts.map(s=>fit(.012,s)).sort((a,b)=>a.error-b.error)[0];
const open=fit(.20,close.values);
console.log(JSON.stringify({close,open},null,2));
const result={description:'Offline authored chest-height facing palms. Runtime uses ordinary clip interpolation.',close:Object.fromEntries(keys.map((k,i)=>[k,Number(close.values[i].toFixed(6))])),open:Object.fromEntries(keys.map((k,i)=>[k,Number(open.values[i].toFixed(6))]))};
writeFileSync(new URL('../examples/hand-poses.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
