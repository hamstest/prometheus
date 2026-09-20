import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { BODY, PROFILE, MotionError, restPose, type Clip, type Ref, type Knot } from './model.ts';
import { refSchema } from './validation.ts';
import { compile, sample, boundaryTimes, type Timeline } from './motion.ts';
import type { Library } from './store.ts';
import { concepts, bodyGroups, ownedChannels, usedParts, identify, ancestors, normalize, ONTOLOGY } from './ontology.ts';
import { examples } from './seeds.ts';

const conceptId=z.enum(concepts.map(c=>c.id) as [string,...string[]]);
const bodyPart=z.enum(Object.keys(bodyGroups) as [string,...string[]]);
const texts=z.array(z.string().min(1).max(2000)).max(512);
export const componentSchema=z.object({key:z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),label:z.string().min(1).max(100),concepts:z.array(conceptId).max(20),from:z.number().nonnegative(),to:z.number().positive(),bodyParts:z.array(bodyPart).min(1).max(4),requires:texts,effects:texts}).strict();
const definitionSchema=z.object({concepts:z.array(conceptId).max(20),conditions:texts,components:z.array(componentSchema).max(128),note:z.string().max(2000)}).strict();
export const knowledgeDefineSchema=z.object({ref:refSchema,expectedRevision:z.number().int().nonnegative(),definition:definitionSchema}).strict();
export const knowledgeInspectSchema=z.object({ref:refSchema,revision:z.number().int().positive().optional()}).strict();
export const knowledgeSearchSchema=z.object({query:z.string().max(300).default(''),concepts:z.array(conceptId).max(12).default([]),bodyParts:z.array(bodyPart).max(4).default([]),abstraction:z.enum(['all','primitive','motion','expression']).default('all'),includeRelated:z.boolean().default(false),offset:z.number().int().min(0).max(100000).default(0),limit:z.number().int().min(1).max(50).default(20)}).strict();
export const selectionSchema=z.object({ref:refSchema,revision:z.number().int().positive(),component:z.string().min(1).max(60),speed:z.number().min(.25).max(3).default(1),amplitude:z.number().min(.1).max(2).optional()}).strict();
export const deriveSchema=z.object({name:z.string().min(1).max(100),meanings:z.array(z.string().min(1).max(100)).min(1).max(20),description:z.string().max(500).optional(),abstraction:z.enum(['motion','expression']).default('motion'),mode:z.enum(['sequence','parallel']),selections:z.array(selectionSchema).min(1).max(12),transition:z.number().min(.1).max(3).default(.6)}).strict();
export const parametersSchema=knowledgeInspectSchema.extend({component:z.string().min(1).max(60),channels:z.array(z.string()).max(36).default([]),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(100).default(20)}).strict();
type Definition=z.infer<typeof definitionSchema>;
type Component=z.infer<typeof componentSchema>;
type Annotation={ref:Ref;revision:number;hash:string;ontology:string;source:string;definition:Definition};

export class Knowledge {
  readonly library:Library;
  constructor(library:Library) {
    this.library=library;
    library.db.exec('CREATE TABLE IF NOT EXISTS knowledge(motionId TEXT NOT NULL,version INTEGER NOT NULL,revision INTEGER NOT NULL,hash TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(motionId,version,revision))');
  }
  private latest(ref:Ref){return Number(this.library.db.prepare('SELECT COALESCE(MAX(revision),0) AS revision FROM knowledge WHERE motionId=? AND version=?').get(ref.id,ref.version)!.revision);}
  define(input:unknown,source='authored'):Annotation {
    const a=knowledgeDefineSchema.parse(input),saved=this.library.get(a.ref),timeline=compile(saved.motion,r=>this.library.get(r));
    const keys=new Set<string>();
    for(const c of a.definition.components){
      if(keys.has(c.key))throw new MotionError('DUPLICATE_COMPONENT',c.key);keys.add(c.key);
      if(c.to>timeline.duration+1e-8||c.to-c.from<.02)throw new MotionError('INVALID_INTERVAL',c.key);
      if(new Set(c.bodyParts).size!==c.bodyParts.length)throw new MotionError('INVALID_BODY_PART',c.key);
    }
    this.library.db.exec('SAVEPOINT knowledge_define');
    try {
      if(this.latest(a.ref)!==a.expectedRevision)throw new MotionError('VERSION_CONFLICT','知識の版が変わりました。再読込してください。');
      const result={ref:a.ref,revision:a.expectedRevision+1,hash:saved.hash,ontology:ONTOLOGY,source,definition:a.definition};
      this.library.db.prepare('INSERT INTO knowledge VALUES (?,?,?,?,?)').run(a.ref.id,a.ref.version,result.revision,saved.hash,JSON.stringify(result));
      this.library.db.exec('RELEASE knowledge_define');return result;
    }catch(e){this.library.db.exec('ROLLBACK TO knowledge_define; RELEASE knowledge_define');throw e;}
  }
  ensure(ref:Ref):Annotation {
    const revision=this.latest(ref);if(revision)return this.annotation(ref,revision);
    const saved=this.library.get(ref),motion=saved.motion,timeline=compile(motion,r=>this.library.get(r));
    const parts=motion.kind==='clip'?usedParts(motion.tracks):Object.keys(bodyGroups);
    const bodies=parts.length?parts:Object.keys(bodyGroups);
    const conditions=[...new Set([`身体 ${BODY}、固定立位、元の場面: ${motion.context}`,'意味・自然さは未評価。開始状態からの接続は実行時に検査する。',...(motion.derivation?.conditions??[])])];
    const exact=examples().find(e=>isDeepStrictEqual(e.clip,motion));
    const identified=identify([motion.name,...motion.meanings].join(' '));
    const ids=motion.semantic?[...new Set([motion.semantic.operation,...identified.filter(id=>id!=='rest')])]:identified;
    const components:Component[]=[{key:'whole',label:'全体',concepts:ids,from:0,to:timeline.duration,bodyParts:bodies,requires:conditions,effects:['元の動作全体の曲線を再利用する。']}];
    if(exact){
      const phases:Record<string,[number,number]>={greeting:[.65,2.1],'greeting-left':[.65,2.1],present:[.8,1.8],'present-left':[.8,1.8],acknowledge:[.35,.9],bow:[.55,1.45],'shake-head':[.4,1.6],think:[.75,2.05],listen:[.6,2.4],welcome:[.75,2.05],surprise:[.3,1.7]};
      const times=phases[exact.id];
      if(times)for(const [key,label,from,to] of [['prepare','準備',0,times[0]],['stroke','主動作',times[0],times[1]],['recover','戻し',times[1],timeline.duration]] as const)components.push({key,label,concepts:[key,...(key==='stroke'?ids:[])],from,to,bodyParts:bodies,requires:[...conditions,...(from>0?['元の途中姿勢・速度から始まる。入口接続を省略しない。']:[])],effects:[`${label}の時間区間。全体の意図がこの区間だけで成立するとは限らない。`]});
    }
    if(motion.kind==='score'){
      for(const [i,p] of motion.parts.entries()){const segments=timeline.segments.filter(s=>s.occurrence===p.key);if(segments.length)components.push({key:`part-${i+1}`,label:`使用箇所 ${p.key}`,concepts:[],from:segments[0].start,to:segments.at(-1)!.start+segments.at(-1)!.duration,bodyParts:bodies,requires:conditions,effects:[`固定元 ${p.ref.id}@${p.ref.version} の ${p.from}–${p.to}秒、速度${p.speed}。全体の意味を自動継承しない。`]});}
    }
    for(const [i,placement] of (motion.derivation?.layout??[]).entries()){
      const s=motion.derivation!.selections[i],source=this.annotation(s.ref,s.revision),c=source.definition.components.find(c=>c.key===s.component)!;
      components.push({key:`element-${i+1}`,label:this.library.get(s.ref).motion.name.slice(0,100),concepts:c.concepts,from:placement.from,to:placement.to,bodyParts:placement.bodyParts,requires:[...source.definition.conditions,...c.requires],effects:c.effects});
    }
    if(bodies.length>1)for(const part of bodies)components.push({key:`body-${part}`,label:bodyGroups[part].label,concepts:[],from:0,to:timeline.duration,bodyParts:[part],requires:[...conditions,'他の部位との協調を切り離した部品。掌の世界方向や表現の意味は合成後に再確認する。'],effects:[`${bodyGroups[part].label}の局所回転だけを保持。順番の合成では操作しない部位の直前姿勢を保持する。`]});
    return this.define({ref,expectedRevision:0,definition:{concepts:ids,conditions,components,note:motion.semantic?'生成時の意味付き操作IDと意味タグを使用。数値は生成時の記録で、曲線を直接編集した場合は再確認する。':exact?'同梱見本と内容が一致する版に、制作時の区間を定義。':'意味タグとの辞書照合と、保存曲線の構造から導出。未知の動作の段階は推測しない。'}},exact?'starter-authored':'metadata-derived');
  }
  annotation(ref:Ref,revision:number):Annotation {
    const saved=this.library.get(ref),row=this.library.db.prepare('SELECT json,hash FROM knowledge WHERE motionId=? AND version=? AND revision=?').get(ref.id,ref.version,revision);
    if(!row)throw new MotionError('NOT_FOUND','Knowledge revision not found');
    if(row.hash!==saved.hash)throw new MotionError('STALE_KNOWLEDGE','Knowledge does not match the motion hash');
    return JSON.parse(String(row.json));
  }
  inspect(input:unknown){
    const a=knowledgeInspectSchema.parse(input),saved=this.library.get(a.ref),knowledge=a.revision?this.annotation(a.ref,a.revision):this.ensure(a.ref);
    const prefix=`${a.ref.id}@${a.ref.version}#${knowledge.revision}`;
    const nodes:unknown[]=[{id:prefix,kind:'motion',label:saved.motion.name},...knowledge.definition.components.map(c=>({id:`${prefix}/${c.key}`,kind:'component',...c}))];
    const edges:{from:string;relation:string;to:string}[]=[];
    for(const c of knowledge.definition.concepts)edges.push({from:prefix,relation:'intendedMeaning',to:c});
    for(const c of knowledge.definition.components){const id=`${prefix}/${c.key}`;edges.push({from:id,relation:'partOf',to:prefix});for(const p of c.bodyParts)edges.push({from:id,relation:'usesBodyPart',to:p});for(const meaning of c.concepts)edges.push({from:id,relation:'describedAs',to:meaning});}
    if(saved.motion.kind==='score')for(const p of saved.motion.parts)edges.push({from:prefix,relation:'usesVersion',to:`${p.ref.id}@${p.ref.version}`});
    for(const [i,s] of (saved.motion.derivation?.selections??[]).entries()){
      const id=`${prefix}/source-use-${i+1}`;
      nodes.push({id,kind:'sourceUse',label:`再利用 ${i+1}`,speed:s.speed});
      edges.push({from:id,relation:'partOf',to:prefix},{from:id,relation:'derivedFrom',to:`${s.ref.id}@${s.ref.version}#${s.revision}/${s.component}`});
    }
    if(saved.motion.semantic){const s=saved.motion.semantic;nodes.push({id:`operation:${s.operation}@${s.version}`,kind:'parameterizedOperation',label:s.operation});edges.push({from:prefix,relation:'instantiates',to:`operation:${s.operation}@${s.version}`});if(s.base)edges.push({from:prefix,relation:'usesPose',to:`${s.base.ref.id}@${s.base.ref.version}`});}
    return {name:saved.motion.name,description:saved.motion.description??saved.motion.meanings.join('、'),abstraction:saved.motion.abstraction??'expression',knowledge,nodes,edges,reviews:this.library.reviews(a.ref),derivation:saved.motion.derivation??null,semantic:saved.motion.semantic??null};
  }
  search(input:unknown){
    const a=knowledgeSearchSchema.parse(input),requested=[...new Set([...a.concepts,...identify(a.query)])];
    const requestedBodies=[...new Set([...a.bodyParts,...Object.entries(bodyGroups).filter(([,g])=>g.aliases.some(s=>normalize(a.query).includes(s))).map(([id])=>id)])];
    const rows=this.library.db.prepare('SELECT id,MAX(version) AS version FROM motions GROUP BY id').all();
    const hits=rows.flatMap(row=>{
      const ref={id:String(row.id),version:Number(row.version)},s=this.library.get(ref),k=this.ensure(ref),d=k.definition;
      const abstraction=s.motion.abstraction??'expression';
      if(a.abstraction!=='all'&&abstraction!==a.abstraction)return [];
      const ids=[...new Set([...d.concepts,...d.components.flatMap(c=>c.concepts)])];
      const has=(id:string)=>ids.some(c=>c===id||ancestors(c).includes(id));
      const reasons=requested.filter(has).map(id=>({concept:id,relation:ids.includes(id)?'explicit-or-alias':'subtype'}));
      if(a.includeRelated)for(const id of requested)if(!has(id)&&d.concepts.some(c=>concepts.find(x=>x.id===c)?.related.includes(id)||concepts.find(x=>x.id===id)?.related.includes(c)))reasons.push({concept:id,relation:'related-only'});
      const text=normalize([ref.id,s.motion.name,s.motion.description??'',...s.motion.meanings].join(' ')),lexical=!!a.query.trim()&&text.includes(normalize(a.query.trim()));
      const terms=[...new Intl.Segmenter('ja',{granularity:'word'}).segment(normalize(a.query))].filter(t=>t.isWordLike&&t.segment.length>=2&&!['動作','基本','ください','組み合わせ','作って','する','して','です','ます','から','よう','だけ','モーション'].includes(t.segment)).map(t=>t.segment);
      const matches=terms.filter(t=>text.includes(t)).length;
      if(a.concepts.some(id=>!has(id)))return [];
      // Explicit concept filters constrain results; they must not make an
      // unrelated textual query match by themselves.
      if(a.query.trim()&&!lexical&&!reasons.some(r=>identify(a.query).includes(r.concept))&&!matches)return [];
      const phases=requested.filter(id=>concepts.find(c=>c.id===id)?.kind==='phase');
      const components=d.components.filter(c=>requestedBodies.every(p=>c.bodyParts.includes(p))&&phases.every(id=>c.concepts.includes(id)));
      if(!components.length)return [];
      const rank=reasons.reduce((sum,r)=>sum+(r.relation==='related-only'?1:5),0)+(lexical?8:0)+matches;
      return [{ref,name:s.motion.name,description:s.motion.description??s.motion.meanings.join('、'),abstraction,kind:s.motion.kind,meanings:s.motion.meanings,context:s.motion.context,hash:s.hash,revision:k.revision,concepts:d.concepts,conditions:d.conditions,components,reasons,rank,source:k.source,evaluation:'unreviewed-unless-scoped-review-exists'}];
    }).sort((a,b)=>b.rank-a.rank||Number(a.kind==='score')-Number(b.kind==='score')||a.ref.id.localeCompare(b.ref.id));
    return {items:hits.slice(a.offset,a.offset+a.limit),nextOffset:hits.length>a.offset+a.limit?a.offset+a.limit:null,requestedConcepts:requested,requestedBodyParts:requestedBodies,searchMethod:ONTOLOGY};
  }
  parameters(input:unknown){
    const a=parametersSchema.parse(input),k=a.revision?this.annotation(a.ref,a.revision):this.ensure(a.ref),c=k.definition.components.find(c=>c.key===a.component);
    if(!c)throw new MotionError('NOT_FOUND','Unknown component');
    const allowed=ownedChannels(c.bodyParts);
    if(a.channels.some(c=>!allowed.includes(c)))throw new MotionError('UNSUPPORTED_CHANNEL','部品が操作するチャンネルだけ指定できます。');
    const selected=a.channels.length?a.channels:allowed,timeline=compile(this.library.get(a.ref).motion,r=>this.library.get(r));
    const times=[...new Set([c.from,c.to,...timeline.segments.flatMap(s=>[s.start,s.start+s.duration]).filter(t=>t>c.from&&t<c.to)])].sort((a,b)=>a-b);
    return {ref:a.ref,revision:k.revision,component:c.key,duration:c.to-c.from,channels:allowed,units:'seconds; local XYZ radians; derivatives per second',adjustments:{speed:{min:.25,max:3,default:1},amplitude:{min:.1,max:2,default:1,anchor:'component entry pose'}},samples:times.slice(a.offset,a.offset+a.limit).map(t=>({time:t-c.from,pose:Object.fromEntries(selected.map(c=>[c,sample(timeline,t).pose[c]]))})),nextOffset:times.length>a.offset+a.limit?a.offset+a.limit:null};
  }
  derive(input:unknown){
    const a=deriveSchema.parse(input),warnings=new Set<string>();
    const sources=a.selections.map(s=>{
      const annotation=this.annotation(s.ref,s.revision),component=annotation.definition.components.find(c=>c.key===s.component);
      if(!component)throw new MotionError('NOT_FOUND',`Unknown component ${s.component}`);
      for(const condition of [...annotation.definition.conditions,...component.requires,...component.effects])warnings.add(condition);
      const source=this.library.get(s.ref),timeline=compile(source.motion,r=>this.library.get(r));
      const duration=(component.to-component.from)/s.speed;
      const times=boundaryTimes([component.from,component.to,...timeline.segments.flatMap(t=>[t.start,t.start+t.duration]).filter(t=>t>component.from&&t<component.to)]);
      const entry=sample(timeline,component.from).pose,amplitude=s.amplitude??1;
      const tracks=Object.fromEntries(ownedChannels(component.bodyParts).map(c=>[c,times.map(t=>{const p=sample(timeline,t).pose[c];return {t:(t-component.from)/s.speed,p:entry[c].p+(p.p-entry[c].p)*amplitude,v:p.v*s.speed*amplitude,a:p.a*s.speed**2*amplitude};})]));
      const clip:Clip={kind:'clip',profile:PROFILE,name:component.label,meanings:['抽出部品'],context:source.motion.context,source:'固定版からの区間・部位抽出',license:source.motion.license,duration,tracks};
      return {clip,component,source,selection:s};
    });
    let timeline:Timeline;
    if(a.mode==='parallel'){
      const owner=new Set<string>();
      for(const s of sources){if(Math.abs(s.clip.duration-sources[0].clip.duration)>1e-7)throw new MotionError('DURATION_MISMATCH','同時合成する部品の長さを速度倍率で揃えてください。');for(const c of Object.keys(s.clip.tracks)){if(owner.has(c))throw new MotionError('BODY_CONFLICT',`${c}を複数の部品が同時に操作します。部位を分けるか順番にしてください。`);owner.add(c);}}
      const merged={...sources[0].clip,tracks:Object.assign({},...sources.map(s=>s.clip.tracks))};timeline=compile(merged,()=>{throw new Error('No references');});
    }else{
      // An operation owns only its declared groups. Other groups retain the preceding
      // endpoint; the existing quintic bridge settles any moving derivatives.
      let held=restPose();
      for(const s of sources){const original=compile(s.clip,()=>{throw new Error('No refs');});
        const end=sample(original,original.duration).pose;
        for(const c of Object.keys(held))if(!Object.hasOwn(s.clip.tracks,c))s.clip.tracks[c]=[0,s.clip.duration].map(t=>({t,p:held[c].p,v:0,a:0}));
        for(const c of ownedChannels(s.component.bodyParts))held[c]=end[c];
      }
      const map=new Map(sources.map((s,i)=>[String(i),s]));
      timeline=compile({kind:'score',profile:PROFILE,name:a.name,meanings:a.meanings,context:'',source:'derive',license:'Source terms apply',parts:sources.map((s,i)=>({key:`element-${i+1}`,ref:{id:String(i),version:1},from:0,to:s.clip.duration,speed:1,transition:a.transition}))},ref=>({ref,hash:'',motion:map.get(ref.id)!.clip,createdAt:''}));
    }
    if(timeline.duration>120)throw new MotionError('BUDGET','派生クリップは120秒以下にしてください。');
    const times=[0,...timeline.segments.map(s=>s.start+s.duration)];
    const tracks:Record<string,Knot[]>={};
    for(const c of ownedChannels(sources.flatMap(s=>s.component.bodyParts)))tracks[c]=times.map(t=>({t,...sample(timeline,t).pose[c]}));
    const layout=sources.map((s,i)=>{const segments=a.mode==='parallel'?timeline.segments:timeline.segments.filter(t=>t.occurrence===`element-${i+1}`);return {from:segments[0].start,to:segments.at(-1)!.start+segments.at(-1)!.duration,bodyParts:s.component.bodyParts};});
    const motion:Clip={kind:'clip',profile:PROFILE,name:a.name,meanings:a.meanings,abstraction:a.abstraction,...(a.description?{description:a.description}:{}),context:'固定立位・同梱VRM。部品から作成した候補。意味・自然さは未評価。',source:'版と部品を指定して曲線を抽出・合成。由来はderivationを参照。',license:[...new Set(sources.map(s=>s.source.motion.license))].join('; ').slice(0,1000),duration:timeline.duration,tracks,derivation:{mode:a.mode,selections:a.selections,conditions:[...warnings],layout}};
    this.library.validate(motion);
    return {motion,warnings:[...warnings],assessment:'coordinate-bounds-only; semantic suitability and collisions require review'};
  }
}
