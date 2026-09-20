import { readFileSync } from 'node:fs';
import { Object3D, Vector3 } from 'three';
import { VRMHumanoid, type VRMHumanBoneName } from '@pixiv/three-vrm';

export function avatarRig() {
  const bytes = readFileSync(new URL('../models/avatar.vrm', import.meta.url));
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const nodes: Object3D[] = gltf.nodes.map((data: { translation?: number[]; rotation?: number[]; scale?: number[] }) => {
    const node = new Object3D();
    if (data.translation) node.position.fromArray(data.translation); if (data.rotation) node.quaternion.fromArray(data.rotation); if (data.scale) node.scale.fromArray(data.scale);
    return node;
  });
  gltf.nodes.forEach((data: { children?: number[] }, i: number) => data.children?.forEach(child => nodes[i].add(nodes[child])));
  const root = new Object3D(); nodes.filter(n => !n.parent).forEach(n => root.add(n)); root.updateMatrixWorld(true);
  const humanBones = Object.fromEntries(Object.entries(gltf.extensions.VRMC_vrm.humanoid.humanBones).map(([name, data]) => [name, { node: nodes[(data as { node: number }).node] }]));
  const humanoid = new VRMHumanoid(humanBones); root.add(humanoid.normalizedHumanBonesRoot); root.updateMatrixWorld(true);
  const bone = (name: string) => humanoid.getNormalizedBoneNode(name as VRMHumanBoneName)!;
  const point = (name: string) => humanoid.getRawBoneNode(name as VRMHumanBoneName)!.getWorldPosition(new Vector3());
  function hand(side: 'right' | 'left') {
    const wrist = point(side+'Hand'), middle = point(side+'MiddleProximal');
    const fingers = middle.clone().sub(wrist).normalize();
    const across = point(side+'IndexProximal').sub(point(side+'LittleProximal')).normalize();
    // Index edge crossed with the finger direction points out of the right palm.
    const palm = across.cross(fingers).multiplyScalar(side === 'right' ? 1 : -1).normalize();
    return { wrist, fingers, palm };
  }
  return { root, humanoid, bone, point, hand, gltf };
}
