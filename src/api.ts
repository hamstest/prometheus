import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BODY, PROFILE, channels } from './model.ts';
import { compile, sample, editOccurrence, Player } from './motion.ts';
import { Library } from './store.ts';
import { draftSchema, editSchema, executeSchema, inspectSchema, playSchema, reviewSchema, sampleSchema, saveSchema, searchSchema, stopSchema } from './validation.ts';
import { ExpressionPlayer, expressionNames, expressionLabels } from './expression.ts';
import { ontology } from './ontology.ts';
import { Knowledge, knowledgeSearchSchema, knowledgeInspectSchema, knowledgeDefineSchema, deriveSchema, parametersSchema } from './knowledge.ts';
import { compactCatalog } from './agent-motion.ts';
import { semanticSearch, semanticInspect, buildSemantic, semanticSearchSchema, semanticInspectSchema, semanticBuildSchema } from './semantic.ts';

const empty = z.object({}).strict();
const expressionSchema=z.object({name:z.enum(expressionNames),intensity:z.number().min(0).max(1).default(.65),hold:z.number().min(0).max(60).default(6)}).strict();
export const operations = {
  'semantic-search':{schema:semanticSearchSchema,readOnly:true,description:'Find parameterized operations by meaning (twist forearm, bend elbow, turn head). Returns only operation:ID@version and description. Request semantic-inspect before setting parameters.'},
  'semantic-inspect':{schema:semanticInspectSchema,readOnly:true,description:'On-demand semantic parameter definition: body side, direction and reference frame, angle in degrees, duration or average speed in degrees/second, hold and return. Read before semantic-build.'},
  'semantic-build':{schema:semanticBuildSchema,readOnly:true,description:'Create an unsaved ordinary clip from a pinned semantic operation and named parameters. Optional base uses the pose of a fixed motion version at a time. Keeps the semantic recipe for editing, saving and composition.'},
  ontology: { schema: empty, readOnly: true, description: 'Read the typed body/behavior ontology, aliases, isA/partOf relations, coordinate scope and available body channels.' },
  'knowledge-search': { schema: knowledgeSearchSchema, readOnly: true, description: 'Retrieve relevant fixed versions by meaning and abstraction (primitive/motion/expression). Returns only key (ID@version) and short description, at most 8 entries / 3600 UTF-8 bytes. Request knowledge-inspect for composition/conditions, motion-parameters only for numeric editing.' },
  'motion-parameters': {schema:parametersSchema,readOnly:true,description:'On-demand numeric details for one pinned component: paged curve samples, selected channels, speed/amplitude ranges. Does not modify the source.'},
  'knowledge-inspect': { schema: knowledgeInspectSchema, readOnly: true, description: 'Read the versioned definition and graph: meanings, temporal phases, body components, preconditions, effects, source versions and scoped reviews.' },
  'knowledge-define': { schema: knowledgeDefineSchema, readOnly: false, description: 'Create an immutable knowledge revision for an exact motion version. Define component intervals, body groups and conditions. This is an authored claim, never human acceptance.' },
  derive: { schema: deriveSchema, readOnly: true, description: 'Extract and compose pinned knowledge components into an unsaved clip. Sequence connects continuously; parallel requires disjoint body groups and equal durations after speed scaling. Conditions and lineage are retained. Validate, preview and save via normal motion operations.' },
  capabilities: { schema: empty, readOnly: true, description: 'Read supported profile, coordinates, authoring bounds, edit capabilities and tool input schemas.' },
  search: { schema: searchSchema, readOnly: true, description: 'Search meanings, aliases, subtypes, phases and body parts using the shared ontology. Returns fixed versions, reasons and reusable components; suitability remains a scoped judgment.' },
  inspect: { schema: inspectSchema, readOnly: true, description: 'Read an exact motion version, source and body/context-scoped human reviews.' },
  validate: { schema: draftSchema, readOnly: true, description: 'Check an unsaved clip or score and resolve its immutable source intervals. Does not save or play.' },
  edit: { schema: editSchema, readOnly: true, description: 'Change one score occurrence by key: source reference, interval, speed or transition. Returns an unsaved candidate; shared clips stay unchanged.' },
  sample: { schema: sampleSchema, readOnly: true, description: 'Sample the exact candidate timeline for numerical inspection, without changing live playback.' },
  save: { schema: saveSchema, readOnly: false, description: 'Save an immutable candidate version. expectedVersion=0 creates a new identity; stale edits are rejected. Saving does not mean human acceptance.' },
  review: { schema: reviewSchema, readOnly: false, description: 'Record a human-provided verdict for an exact version, body and context. Never invent human approval.' },
  play: { schema: playSchema, readOnly: false, description: 'Preview an unsaved motion on the local avatar, connecting directly from current position, velocity and acceleration.' },
  execute: { schema: executeSchema, readOnly: false, description: 'Play an exact saved version on the local avatar. A new run interrupts the previous run continuously.' },
  stop: { schema: stopSchema, readOnly: false, description: 'Brake the matching active run continuously in place. Use state to obtain the current runId.' },
  state: { schema: empty, readOnly: true, description: 'Read live pose, clock, active run and recent completion/interruption history.' },
  expression: { schema: expressionSchema, readOnly: false, description: 'Preview a supported facial expression with bounded intensity and a hold in seconds; fades back to neutral. Does not alter saved motion data.' },
} as const;
export type Operation = keyof typeof operations;
export class Service {
  readonly library: Library;
  readonly player = new Player();
  readonly face = new ExpressionPlayer();
  readonly knowledge: Knowledge;
  constructor(library: Library) { this.library = library; this.knowledge=new Knowledge(library); }
  state() { return {...this.player.state(),expression:this.face.state(this.player.time)}; }
  dispatch(operation: Operation, input: unknown): unknown {
    const entry = operations[operation];
    if (!entry) throw new Error('Unknown operation');
    const args = entry.schema.parse(input);
    const resolve = (ref: Parameters<Library['get']>[0]) => this.library.get(ref);
    switch (operation) {
      case 'semantic-search':return semanticSearch(args);
      case 'semantic-inspect':return semanticInspect(args);
      case 'semantic-build':return buildSemantic(this.library,args);
      case 'ontology': return ontology();
      case 'knowledge-search': {const a=knowledgeSearchSchema.parse(args),found=this.knowledge.search({...a,limit:Math.min(a.limit,8)}),items=compactCatalog(found.items);return {items,nextOffset:items.length<found.items.length?a.offset+items.length:found.nextOffset};}
      case 'motion-parameters': return this.knowledge.parameters(args);
      case 'knowledge-inspect': return this.knowledge.inspect(args);
      case 'knowledge-define': return this.knowledge.define(args);
      case 'derive': return this.knowledge.derive(args);
      case 'capabilities': return {
        profile: PROFILE, body: BODY, channels, expressions:expressionNames.map(name=>({name,label:expressionLabels[name]})),
        scope: 'Fixed standing upper-body clips; local XYZ Euler radians on the normalized VRM rig. Missing tracks use the documented rest pose.',
        limits: 'Motion API: no locomotion, automatic retargeting, collision guarantee, learned transitions, or general semantic reasoning. Character chat is a separate Codex-backed HTTP feature.',
        tools: Object.entries(operations).map(([name, op]) => ({ name, description: op.description, inputSchema: z.toJSONSchema(op.schema, { io: 'input' }) })),
      };
      case 'search': return this.knowledge.search(args);
      case 'inspect': { const a = inspectSchema.parse(args); return { ...resolve(a.ref), reviews: this.library.reviews(a.ref) }; }
      case 'save': { const a = saveSchema.parse(args); return this.library.save(a.id, a.expectedVersion, a.motion); }
      case 'review': return this.library.review(reviewSchema.parse(args));
      case 'state': return this.state();
      case 'stop': this.player.stop(stopSchema.parse(args).runId); return this.state();
      case 'expression': { const a=expressionSchema.parse(args);return this.face.play(a,a.hold,this.player.time); }
      case 'edit': {
        const a = editSchema.parse(args), motion = editOccurrence(a.motion, a.key, a.change);
        this.library.validate(motion); return { motion };
      }
      case 'validate': {
        const a = draftSchema.parse(args), motion = this.library.validate(a.motion), timeline = compile(motion, resolve);
        return { duration: timeline.duration, segments: timeline.segments.length, profile: motion.profile, assessment: 'coordinate-bounds-only; human review is separate' };
      }
      case 'sample': {
        const a = sampleSchema.parse(args), motion = this.library.validate(a.motion), timeline = compile(motion, resolve);
        return { ...sample(timeline, a.time), duration: timeline.duration };
      }
      case 'play': {
        const a = playSchema.parse(args), motion = this.library.validate(a.motion);
        return this.player.play(compile(motion, resolve), motion.name, randomUUID(), a.transition);
      }
      case 'execute': {
        const a = executeSchema.parse(args), motion = resolve(a.ref).motion;
        return this.player.play(compile(motion, resolve), motion.name, randomUUID(), a.transition);
      }
    }
  }
}
