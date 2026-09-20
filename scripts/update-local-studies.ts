// One-time, explicitly scoped follow-up for the two studies already present in
// this workspace. Dry-run by default; all previous versions remain inspectable.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { call } from '../src/client.ts';
import { avatarRig } from '../tests/vrm-fixture.ts';
import { applyPose } from '../src/rig.ts';
import { sampleClip } from '../src/motion.ts';
import type { Clip, Saved } from '../src/model.ts';

const apply=process.argv.includes('--apply');
const [clipSource,scoreSource]=await Promise.all(['ember-greeting-study','greeting-study'].map(id=>call('inspect',{ref:{id,version:1}}))) as Saved[];
assert.equal(clipSource.motion.kind,'clip');assert.equal(scoreSource.motion.kind,'score');
const clip=structuredClone(clipSource.motion) as Clip;
assert.equal(clip.duration,3.15);assert.ok(!clip.tracks['rightHand.x'],'This study already has wrist roll; inspect it manually.');
clip.tracks['rightHand.x']=[{t:0,p:0,v:0,a:0},{t:.65,p:-1.2,v:0,a:0},{t:2.5,p:-1.2,v:0,a:0},{t:3.15,p:0,v:0,a:0}];
clip.source+=' 2026-09-09: 編集済みの時刻・関節曲線を保ち、手のひらを相手へ向ける手首の回転軸を追加。';
const rig=avatarRig();
function facing(clip:Clip){let min=1;for(let t=.65;t<=2.5;t+=1/120){applyPose(rig.bone,sampleClip(clip,t));rig.humanoid.update();rig.root.updateMatrixWorld(true);min=Math.min(min,rig.hand('right').palm.z);}return min;}
const minFacing=facing(clip);assert.ok(minFacing>.9,'Inspect the study before publishing: palm does not face forward.');
for(const [axis,keys] of Object.entries((clipSource.motion as Clip).tracks))assert.deepEqual(clip.tracks[axis],keys);
const score=structuredClone(scoreSource.motion);assert.equal(score.kind,'score');if(score.kind!=='score')throw new Error('Expected score');
for(const part of score.parts){assert.ok(['greeting','present'].includes(part.ref.id));assert.equal(part.ref.version,1);part.ref.version=2;}
score.source+=' 2026-09-09: 区間・速度を保ち、手のひらの向きを修正した見本v2へ参照を更新。';
await call('validate',{motion:clip});await call('validate',{motion:score});
const report:any={applied:apply,clip:{ref:clipSource.ref,changedAxes:['rightHand.x'],minPalmForwardBefore:facing(clipSource.motion as Clip),minPalmForwardAfter:minFacing,originalTracksPreserved:true},score:{ref:scoreSource.ref,parts:score.parts}};
if(apply){report.clip.saved=(await call('save',{id:clipSource.ref.id,expectedVersion:1,motion:clip})).ref;report.score.saved=(await call('save',{id:scoreSource.ref.id,expectedVersion:1,motion:score})).ref;writeFileSync(new URL('../docs/palm-upgrade-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
