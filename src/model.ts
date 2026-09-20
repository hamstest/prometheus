// One explicitly bounded coordinate chart: local XYZ Euler radians on the
// normalized VRM rig. These are authoring bounds, not anatomical guarantees.
export const PROFILE = 'vrm1-upper-body-xyz-v1';
export const channels: Record<string, { rest: number; min: number; max: number }> = {};
function bone(name: string, rest: number[], low: number[], high: number[]) {
  ['x', 'y', 'z'].forEach((axis, i) => { channels[`${name}.${axis}`] = { rest: rest[i], min: low[i], max: high[i] }; });
}
bone('spine', [0, 0, 0], [-.35, -.5, -.3], [.35, .5, .3]);
bone('chest', [0, 0, 0], [-.35, -.5, -.3], [.35, .5, .3]);
bone('neck', [0, 0, 0], [-.35, -.55, -.3], [.35, .55, .3]);
bone('head', [0, 0, 0], [-.6, -.8, -.4], [.6, .8, .4]);
for (const side of ['left', 'right']) {
  const sign = side === 'left' ? 1 : -1;
  bone(`${side}Shoulder`, [0, 0, 0], [-.35, -.45, -.45], [.35, .45, .45]);
  bone(`${side}UpperArm`, [0, 0, -sign * 1.15], [-1.5, -1.5, -2.7], [1.5, 1.5, 2.7]);
  bone(`${side}LowerArm`, [0, -sign * .15, 0], [-1.5, -2.6, -1.5], [1.5, 2.6, 1.5]);
  bone(`${side}Hand`, [0, 0, 0], [-1.2, -1.2, -1.2], [1.2, 1.2, 1.2]);
}
export type State = { p: number; v: number; a: number };
export type Pose = Record<string, State>;
export type Knot = State & { t: number };
export type Ref = { id: string; version: number };
export type Metadata = {
  name: string; meanings: string[]; context: string; source: string; license: string;
  abstraction?: 'primitive' | 'motion' | 'expression';
  description?: string;
  semantic?: import('./semantic-contract.ts').SemanticInvocation;
  derivation?: { mode: 'sequence' | 'parallel'; selections: {ref:Ref;revision:number;component:string;speed:number;amplitude?:number}[]; conditions:string[]; layout?: {from:number;to:number;bodyParts:string[]}[] };
};
export type Clip = Metadata & {
  kind: 'clip'; profile: typeof PROFILE; duration: number; tracks: Record<string, Knot[]>;
};
export type Part = {
  key: string; ref: Ref; from: number; to: number; speed: number; transition: number;
};
export type Score = Metadata & { kind: 'score'; profile: typeof PROFILE; parts: Part[] };
export type Motion = Clip | Score;
export type Saved = { ref: Ref; hash: string; motion: Motion; createdAt: string };
export type Review = { ref: Ref; verdict: 'accepted' | 'rejected'; body: string; context: string; note: string; createdAt: string };
export const BODY = 'AvatarSample_Y_VRM10:25b05e3415bb35a7';
export function restPose(): Pose {
  return Object.fromEntries(Object.entries(channels).map(([name, value]) => [name, { p: value.rest, v: 0, a: 0 }]));
}
export class MotionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
