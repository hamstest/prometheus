import { z } from 'zod';
import { Euler, Quaternion, Vector3 } from 'three';
import { PROFILE, channels, restPose, MotionError, type Clip, type Pose } from './model.ts';
import { refSchema } from './validation.ts';
import { compile, sample, boundaryTimes } from './motion.ts';
import { ownedChannels, normalize } from './ontology.ts';
import type { Library } from './store.ts';
import type { SemanticInvocation } from './semantic-contract.ts';

type Binding={bone:string;axis:'x'|'y'|'z';weight:number;local?:boolean;sideSign?:boolean};
type Operation={id:string;label:string;description:string;aliases:string[];body:string;bilateral:boolean;maxAngle:number;directions:{id:string;label:string;sign:number}[];bindings:Binding[];frame:string};
const twistDirections=[{id:'clockwise',label:'右回り',sign:1},{id:'counterclockwise',label:'左回り',sign:-1}];
const turnDirections=[{id:'right',label:'右へ',sign:-1},{id:'left',label:'左へ',sign:1}];
export const semanticOperations:Operation[]=[
  {id:'forearm-twist',label:'前腕をひねる',description:'肘から手首までの軸に沿って前腕をひねる。腕の左右と回転方向、角度、時間または速度を指定できる。',aliases:['腕をひねる','腕を捻る','ねじる','twist','forearm'],body:'Arm',bilateral:true,maxAngle:75,directions:twistDirections,bindings:[{bone:'LowerArm',axis:'x',weight:1,local:true,sideSign:true}],frame:'肘から手先を見た右回り・左回り。画面の左右とは別。'},
  {id:'upper-arm-twist',label:'上腕をひねる',description:'肩から肘までの軸に沿って上腕をひねる。肘が曲がっていれば手先の位置も変わる。',aliases:['上腕','肩をひねる','upper arm twist'],body:'Arm',bilateral:true,maxAngle:60,directions:twistDirections,bindings:[{bone:'UpperArm',axis:'x',weight:1,local:true,sideSign:true}],frame:'肩から肘を見た右回り・左回り。画面の左右とは別。'},
  {id:'elbow-bend',label:'肘を曲げ伸ばしする',description:'選んだ腕の肘を、開始姿勢から指定角度だけ曲げる、または伸ばす。',aliases:['肘','曲げる','伸ばす','elbow'],body:'Arm',bilateral:true,maxAngle:90,directions:[{id:'bend',label:'曲げる',sign:1},{id:'extend',label:'伸ばす',sign:-1}],bindings:[{bone:'LowerArm',axis:'y',weight:-1,sideSign:true}],frame:'開始姿勢からの変化量。伸ばす場合も座標範囲内の候補として検査する。'},
  {id:'head-turn',label:'顔を左右へ向ける',description:'頭と首を分担して、キャラクター自身の右または左へ顔を向ける。',aliases:['顔','頭','首','向く','向ける','turn head'],body:'head',bilateral:false,maxAngle:60,directions:turnDirections,bindings:[{bone:'head',axis:'y',weight:.8},{bone:'neck',axis:'y',weight:.2}],frame:'キャラクター自身の右・左。正面画面では左右が逆になる。'},
  {id:'head-nod',label:'頭を上下に動かす',description:'頭と首を分担して下げる、または上げる。「元へ戻る」で一回のうなずきになる。',aliases:['うなずく','頷く','頭を下げる','頭を上げる','nod'],body:'head',bilateral:false,maxAngle:30,directions:[{id:'down',label:'下げる',sign:1},{id:'up',label:'上げる',sign:-1}],bindings:[{bone:'head',axis:'x',weight:.8},{bone:'neck',axis:'x',weight:.2}],frame:'正面基準の上下。角度は頭と首の配分の合計。'},
  {id:'torso-turn',label:'体幹をひねる',description:'背骨と胸を分担して、体幹をキャラクター自身の右または左へひねる。',aliases:['体幹','胴体','胸','身体をひねる','torso'],body:'torso',bilateral:false,maxAngle:40,directions:turnDirections,bindings:[{bone:'spine',axis:'y',weight:.5},{bone:'chest',axis:'y',weight:.5}],frame:'キャラクター自身の右・左。背骨と胸の配分の合計角度。'},
];
export const semanticSearchSchema=z.object({query:z.string().max(300).default('')}).strict();
export const semanticInspectSchema=z.object({id:z.string().max(80),version:z.literal(1).default(1)}).strict();
const parameters=z.object({side:z.enum(['right','left']).optional(),direction:z.string().max(40),angleDeg:z.number().min(1).max(120),timing:z.discriminatedUnion('mode',[
  z.object({mode:z.literal('duration'),durationSec:z.number().min(.25).max(10)}).strict(),
  z.object({mode:z.literal('speed'),speedDegPerSec:z.number().min(1).max(180)}).strict(),
]),holdSec:z.number().min(0).max(10).default(0),returnToStart:z.boolean().default(false)}).strict();
export const semanticBuildSchema=z.object({id:z.string().max(80),version:z.literal(1),parameters,base:z.object({ref:refSchema,time:z.number().nonnegative()}).strict().optional(),name:z.string().min(1).max(100).optional()}).strict();
function operation(id:string){const op=semanticOperations.find(o=>o.id===id);if(!op)throw new MotionError('NOT_FOUND','意味付き操作が見つかりません。semantic-searchから選んでください。');return op;}
export function semanticSearch(input:unknown){
  const {query}=semanticSearchSchema.parse(input),q=normalize(query),terms=[...new Intl.Segmenter('ja',{granularity:'word'}).segment(q)].filter(t=>t.isWordLike&&t.segment.length>=2).map(t=>t.segment);
  return {items:semanticOperations.map(op=>({op,rank:[op.id,op.label,...op.aliases].reduce((n,t)=>n+(q.includes(normalize(t))?5:0),0)+terms.filter(t=>normalize(op.label+' '+op.aliases.join(' ')).includes(t)).length})).filter(x=>!q||x.rank>0).sort((a,b)=>b.rank-a.rank).map(({op})=>({key:`operation:${op.id}@1`,description:`${op.label}。${op.description}`}))};
}
export function semanticInspect(input:unknown){
  const a=semanticInspectSchema.parse(input),op=operation(a.id);
  return {id:op.id,version:1,name:op.label,description:op.description,frame:op.frame,
    parameters:{...(op.bilateral?{side:{label:'動かす腕',choices:[{id:'right',label:'右腕'},{id:'left',label:'左腕'}],default:'right'}}:{}),direction:{label:'方向',choices:op.directions.map(({id,label})=>({id,label})),default:op.directions[0].id},angleDeg:{label:'開始姿勢からの角度',unit:'度',min:1,max:op.maxAngle,default:30},timing:{label:'時間または平均角速度',modes:['duration','speed'],durationSec:{label:'片道の時間',unit:'秒',min:.25,max:10,default:1},speedDegPerSec:{label:'平均角速度',unit:'度/秒',min:1,max:180,default:30},note:'角度÷平均角速度で片道時間を計算。開始・終了では滑らかに加減速するため、瞬間速度は一定ではない。'},holdSec:{label:'到達後の保持時間',unit:'秒',min:0,max:10,default:0},returnToStart:{label:'元の姿勢へ戻る',default:false}},
    base:'省略時は休息姿勢。base.refとtimeを指定すると保存版の指定時刻の姿勢から動かす。指定部位以外は所有しない。',bodyPart:op.bilateral?'指定側の腕と手':op.body,
    effects:'指定方向へ回転し、終了姿勢を保持する。returnToStartの場合は同じ時間をかけて開始姿勢へ戻る。',semanticParameterAccess:true,inputSchema:z.toJSONSchema(semanticBuildSchema,{io:'input'})};
}

export function buildSemantic(library:Library,input:unknown){
  const a=semanticBuildSchema.parse(input),op=operation(a.id),p=a.parameters,direction=op.directions.find(d=>d.id===p.direction);
  if(!direction||p.angleDeg>op.maxAngle||op.bilateral&&!p.side||!op.bilateral&&p.side)throw new MotionError('INVALID_PARAMETER','方向・角度・対象の左右を操作の定義に合わせてください。');
  const duration=p.timing.mode==='duration'?p.timing.durationSec:p.angleDeg/p.timing.speedDegPerSec;
  if(duration<.25||duration>10)throw new MotionError('INVALID_PARAMETER','角度と速度から求めた片道時間は0.25〜10秒にしてください。');
  let base=restPose();
  if(a.base){const t=compile(library.get(a.base.ref).motion,r=>library.get(r));if(a.base.time>t.duration)throw new MotionError('INVALID_INTERVAL','開始姿勢の時刻が元の動作の範囲外です。');base=sample(t,a.base.time).pose;}
  const parts=[op.bilateral?`${p.side}Arm`:op.body],owned=ownedChannels(parts),radians=p.angleDeg*Math.PI/180*direction.sign;
  const bindings=op.bindings.map(b=>({...b,bone:op.bilateral?`${p.side}${b.bone}`:b.bone,weight:b.weight*(b.sideSign?(p.side==='right'?-1:1):1)}));
  function atAngle(theta:number):Record<string,number>{
    const pose=Object.fromEntries(owned.map(c=>[c,base[c].p]));
    for(const b of bindings){
      if(b.local){const q=new Quaternion().setFromEuler(new Euler(base[b.bone+'.x'].p,base[b.bone+'.y'].p,base[b.bone+'.z'].p,'XYZ'));const axis=new Vector3(b.axis==='x'?1:0,b.axis==='y'?1:0,b.axis==='z'?1:0);q.multiply(new Quaternion().setFromAxisAngle(axis,theta*b.weight));const e=new Euler().setFromQuaternion(q,'XYZ');for(const axis of ['x','y','z'] as const)pose[`${b.bone}.${axis}`]=e[axis];}
      else pose[`${b.bone}.${b.axis}`]+=theta*b.weight;
    }
    return pose;
  }
  const total=duration+p.holdSec+(p.returnToStart?duration:0);
  const times=boundaryTimes([0,total,...Array.from({length:33},(_,i)=>duration*i/32),duration+p.holdSec,...(p.returnToStart?Array.from({length:33},(_,i)=>duration+p.holdSec+duration*i/32):[])]);
  function scalar(t:number){let u=t/duration,sign=1;if(t>duration){if(t<=duration+p.holdSec)return {p:radians,v:0,a:0};u=(t-duration-p.holdSec)/duration;sign=-1;}u=Math.max(0,Math.min(1,u));const w=10*u**3-15*u**4+6*u**5;return {p:radians*(sign===1?w:1-w),v:radians*sign*(30*u*u-60*u**3+30*u**4)/duration,a:radians*sign*(60*u-180*u*u+120*u**3)/duration**2};}
  const tracks:Clip['tracks']=Object.fromEntries(owned.map(c=>[c,[]]));
  for(const t of times){const s=scalar(t),at=atAngle(s.p),h=1e-4,minus=atAngle(s.p-h),plus=atAngle(s.p+h);for(const c of owned){const first=(plus[c]-minus[c])/(2*h),second=(plus[c]-2*at[c]+minus[c])/(h*h);tracks[c].push({t,p:at[c],v:first*s.v,a:second*s.v*s.v+first*s.a});}}
  const side=op.bilateral?(p.side==='right'?'右腕':'左腕'):'';
  const name=a.name??`${side}${op.label}・${direction.label}${p.angleDeg}度`;
  const semantic:SemanticInvocation={operation:a.id,version:1,...(p.side?{side:p.side}:{}),direction:p.direction,angleDeg:p.angleDeg,durationSec:duration,timing:p.timing,holdSec:p.holdSec,returnToStart:p.returnToStart,...(a.base?{base:a.base}:{})};
  const motion:Clip={kind:'clip',profile:PROFILE,name,description:`${side}${op.label}。${direction.label}に${p.angleDeg}度、片道${duration.toFixed(2)}秒${p.returnToStart?'で動いて元へ戻る':'で動いて保持する'}。${op.frame}`,abstraction:'primitive',meanings:[op.label,direction.label,`${p.angleDeg}度`,...(side?[side]:[])],context:'同梱VRM・固定立位。意味付きの角度操作から生成した候補。自然さ・干渉は未評価。',source:'意味付き操作の固定定義とパラメーターから共通クリップへ変換',license:a.base?library.get(a.base.ref).motion.license:'Project-local authored operation',duration:total,tracks,semantic};
  library.validate(motion);return {motion,parameters:semantic,bodyParts:parts,assessment:'coordinate-bounds-only; semantic suitability requires review'};
}
