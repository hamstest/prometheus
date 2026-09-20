import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Object3D, Vector3 } from 'three';
import { VRMHumanoid } from '@pixiv/three-vrm';
import { applyPose } from '../src/rig.ts';
import { compile, sample } from '../src/motion.ts';
import { examples } from '../src/seeds.ts';

test('the shipped VRM retains foot contacts and bone lengths across every authored clip; the gesture actually raises its hand', () => {
  const bytes = readFileSync(new URL('../models/avatar.vrm', import.meta.url));
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const nodes = gltf.nodes.map((data: { translation?: number[]; rotation?: number[]; scale?: number[] }) => {
    const node = new Object3D(); if (data.translation) node.position.fromArray(data.translation); if (data.rotation) node.quaternion.fromArray(data.rotation); if (data.scale) node.scale.fromArray(data.scale); return node;
  });
  gltf.nodes.forEach((data: { children?: number[] }, i: number) => data.children?.forEach(child => nodes[i].add(nodes[child])));
  const root = new Object3D(); nodes.filter((n: Object3D) => !n.parent).forEach((n: Object3D) => root.add(n)); root.updateMatrixWorld(true);
  const humanBones = Object.fromEntries(Object.entries(gltf.extensions.VRMC_vrm.humanoid.humanBones).map(([name, data]) => [name, { node: nodes[(data as { node: number }).node] }]));
  const humanoid = new VRMHumanoid(humanBones); root.add(humanoid.normalizedHumanBonesRoot); root.updateMatrixWorld(true);
  const bone = (name: string): Object3D => humanoid.getNormalizedBoneNode(name);
  const feet = ['leftFoot', 'rightFoot'].map(name => bone(name).getWorldPosition(new Vector3()));
  const positions = Object.fromEntries(Object.keys(humanBones).map(name => [name, bone(name).position.clone()]));
  let low = Infinity, high = -Infinity;
  for (const example of examples()) {
    const timeline = compile(example.clip, () => { throw new Error('No references in a clip'); });
    for (let t = 0; t <= timeline.duration; t += 1 / 120) {
      applyPose(bone, sample(timeline, t).pose); humanoid.update(); root.updateMatrixWorld(true);
      for (const [i, name] of ['leftFoot', 'rightFoot'].entries()) assert.ok(bone(name).getWorldPosition(new Vector3()).distanceTo(feet[i]) < 1e-8, 'Foot slid during an upper-body motion');
      for (const [name, position] of Object.entries(positions)) assert.ok(bone(name).position.distanceTo(position) < 1e-9, 'Bone length changed');
      if (example.id === 'greeting') { const y = humanoid.getRawBoneNode('rightHand').getWorldPosition(new Vector3()).y; low = Math.min(low, y); high = Math.max(high, y); }
    }
  }
  assert.ok(high - low > .25, `The rendered hand did not rise: ${high - low}m`);
});
