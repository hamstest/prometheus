import { avatarRig } from '../tests/vrm-fixture.ts';
import { applyPose } from '../src/rig.ts';
import { examples } from '../src/seeds.ts';
import { sampleClip } from '../src/motion.ts';

const rig = avatarRig();
const rounded = (a: { toArray(): number[] }) => a.toArray().map(x=>Number(x.toFixed(3)));
for (const [id,time] of [['greeting',1.4],['present',1.1],['acknowledge',.65],['rest',0]] as const) {
  const clip = examples().find(e=>e.id===id)!.clip;
  const pose = sampleClip(clip,time);
  applyPose(rig.bone,pose); rig.humanoid.update(); rig.root.updateMatrixWorld(true);
  const hand = rig.hand('right');
  console.log(JSON.stringify({id,time,wrist:rounded(hand.wrist),palm:rounded(hand.palm),fingers:rounded(hand.fingers)}));
}
