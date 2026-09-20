import { Euler, type Object3D } from 'three';
import { channels, type Pose } from './model.ts';

const bones = [...new Set(Object.keys(channels).map(c => c.split('.')[0]))];
const euler = new Euler();
// Apply only local rotations. The model's original joint translations, hips,
// legs and bind matrices remain the source of body proportions and support.
export function applyPose(getBone: (name: string) => Object3D | null, pose: Pose) {
  for (const name of bones) getBone(name)?.quaternion.setFromEuler(euler.set(pose[`${name}.x`].p, pose[`${name}.y`].p, pose[`${name}.z`].p, 'XYZ'));
}
