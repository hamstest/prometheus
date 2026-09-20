import { z } from 'zod';

export const semanticInvocationSchema=z.object({
  operation:z.string().min(1).max(80),version:z.literal(1),side:z.enum(['right','left']).optional(),
  direction:z.string().min(1).max(40),angleDeg:z.number().min(1).max(120),
  durationSec:z.number().min(.25).max(10),holdSec:z.number().min(0).max(10),returnToStart:z.boolean(),
  timing:z.discriminatedUnion('mode',[
    z.object({mode:z.literal('duration'),durationSec:z.number().min(.25).max(10)}).strict(),
    z.object({mode:z.literal('speed'),speedDegPerSec:z.number().min(1).max(180)}).strict(),
  ]),
  base:z.object({ref:z.object({id:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/),version:z.number().int().positive()}).strict(),time:z.number().nonnegative()}).strict().optional(),
}).strict();
export type SemanticInvocation=z.infer<typeof semanticInvocationSchema>;
