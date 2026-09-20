import { z } from 'zod';
import { channels, PROFILE, MotionError, type Clip } from './model.ts';
import { coefficients, range } from './curve.ts';
import { semanticInvocationSchema } from './semantic-contract.ts';

const number = z.number().finite();
export const refSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/), version: z.number().int().positive() }).strict();
const metadata = {
  name: z.string().trim().min(1).max(100), meanings: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
  context: z.string().max(1000), source: z.string().min(1).max(1000), license: z.string().min(1).max(1000),
  abstraction:z.enum(['primitive','motion','expression']).optional(), description:z.string().max(500).optional(),
  semantic:semanticInvocationSchema.optional(),
  derivation: z.object({mode:z.enum(['sequence','parallel']),selections:z.array(z.object({ref:refSchema,revision:z.number().int().positive(),component:z.string().min(1).max(60),speed:z.number().min(.25).max(3),amplitude:z.number().min(.1).max(2).optional()}).strict()).min(1).max(12),conditions:z.array(z.string().max(2000)).max(512),layout:z.array(z.object({from:number.min(0),to:number.positive(),bodyParts:z.array(z.string()).min(1).max(4)}).strict()).max(12).optional()}).strict().optional(),
};
const knot = z.object({ t: number.min(0), p: number, v: number.min(-20).max(20), a: number.min(-100).max(100) }).strict();
export const clipSchema = z.object({
  ...metadata, kind: z.literal('clip'), profile: z.literal(PROFILE), duration: number.min(.02).max(120),
  tracks: z.record(z.string(), z.array(knot).min(2).max(2000)),
}).strict();
export const partSchema = z.object({
  key: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/), ref: refSchema, from: number.min(0), to: number.positive(),
  speed: number.min(.25).max(3), transition: number.min(.1).max(3),
}).strict();
export const scoreSchema = z.object({ ...metadata, kind: z.literal('score'), profile: z.literal(PROFILE), parts: z.array(partSchema).min(1).max(64) }).strict();
export const motionSchema = z.discriminatedUnion('kind', [clipSchema, scoreSchema]);
export const draftSchema = z.object({ motion: motionSchema }).strict();
export const saveSchema = z.object({ id: refSchema.shape.id, expectedVersion: z.number().int().min(0), motion: motionSchema }).strict();
export const searchSchema = z.object({ query: z.string().max(300).default(''), abstraction:z.enum(['all','primitive','motion','expression']).default('all'), offset: z.number().int().min(0).max(100000).default(0), limit: z.number().int().min(1).max(50).default(20) }).strict();
export const inspectSchema = z.object({ ref: refSchema }).strict();
export const playSchema = z.object({ motion: motionSchema, transition: number.min(.1).max(3).default(.6) }).strict();
export const executeSchema = z.object({ ref: refSchema, transition: number.min(.1).max(3).default(.6) }).strict();
export const stopSchema = z.object({ runId: z.string().uuid() }).strict();
export const reviewSchema = z.object({ ref: refSchema, verdict: z.enum(['accepted', 'rejected']), body: z.string().min(1).max(200), context: z.string().min(1).max(1000), note: z.string().min(1).max(2000) }).strict();
export const sampleSchema = z.object({ motion: motionSchema, time: number.min(0) }).strict();
export const editSchema = z.object({
  motion: scoreSchema, key: partSchema.shape.key,
  change: partSchema.omit({ key: true }).partial(),
}).strict();
export function validateClip(clip: Clip) {
  const entries = Object.entries(clip.tracks);
  if (!entries.length || entries.length > Object.keys(channels).length) throw new MotionError('INVALID_CLIP', 'At least one supported channel is required');
  let count = 0;
  for (const [name, keys] of entries) {
    const bound = channels[name];
    if (!Object.hasOwn(channels, name)) throw new MotionError('UNSUPPORTED_CHANNEL', name);
    count += keys.length;
    if (count > 16000) throw new MotionError('BUDGET', 'Clip exceeds 16000 knots');
    if (keys[0].t !== 0 || keys.at(-1)!.t !== clip.duration) throw new MotionError('INVALID_CLIP', `${name}: tracks must span the full clip`);
    for (let i = 1; i < keys.length; i++) {
      const duration = keys[i].t - keys[i - 1].t;
      if (duration < .001) throw new MotionError('INVALID_CLIP', `${name}: times must increase by at least 1 ms`);
      const limits = range(coefficients(keys[i - 1], keys[i], duration));
      if (limits[0] < bound.min - 1e-8 || limits[1] > bound.max + 1e-8) throw new MotionError('JOINT_RANGE', `${name}: curve exceeds authoring bounds`);
    }
  }
}
