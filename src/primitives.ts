import { readFileSync } from 'node:fs';
import { PROFILE, channels, type Clip, type Knot } from './model.ts';
import { sampleClip } from './motion.ts';
import { ownedChannels } from './ontology.ts';
import { flowingKeys } from './authoring.ts';

// Authoring data, compiled by the same curve player as every other motion.
// Each primitive ends at its named pose; returning is an explicit next operation.
export function primitiveExamples(examples:{id:string;clip:Clip}[]){
  const result:{id:string;clip:Clip}[]=[];
  function add(id:string,name:string,description:string,meanings:string[],source:string,part:string,points:number[],duration:number){
    const original=examples.find(e=>e.id===source)!.clip;
    const tracks=Object.fromEntries(ownedChannels([part]).map(c=>[c,flowingKeys(points.map((p,i)=>({t:duration*i/(points.length-1),p:sampleClip(original,p)[c].p,v:0,a:0} satisfies Knot)))]));
    result.push({id:`primitive.${id}`,clip:{kind:'clip',profile:PROFILE,abstraction:'primitive',name,description,meanings,duration,tracks,context:'同梱VRM・固定立位。開始姿勢への接続を検査し、終了姿勢を保持する。',source:'V3の検査済みキーポーズを使った基本操作。実行は共通クリップ。',license:original.license}});
  }
  for(const [side,label,suffix] of [['right','右',''],['left','左','-left']] as const){
    const group=`${side}Arm`,greeting=`greeting${suffix}`,present=`present${suffix}`;
    add(`${side}.arm.raise`,`${label}腕を上げる`,`${label}手を挨拶の高さへ上げ、その姿勢で終わる。`,['腕を上げる','挨拶の準備',`${label}腕`],greeting,group,[0,1.05],1);
    add(`${side}.arm.wave`,`${label}手を左右に振る`,`上げた${label}腕を保ち、手首を左右に2往復する。腕を上げる操作の後に使う。`,['手を振る','往復',`${label}手`],greeting,group,[1.05,1.4,1.75,2.1,1.75],1.4);
    add(`${side}.arm.lower`,`${label}腕を下ろす`,`挨拶の高さから${label}腕を下ろし、休息姿勢で終わる。`,['腕を下ろす','戻し',`${label}腕`],greeting,group,[1.05,3.15],1);
    add(`${side}.arm.present`,`${label}腕を開いて示す`,`${label}手のひらを上に向けて開き、その姿勢で終わる。`,['示す','開く','説明',`${label}腕`],present,group,[0,1.1],1);
    add(`${side}.arm.recover`,`${label}腕を示す姿勢から戻す`,`開いた${label}腕を休息姿勢へ戻す。`,['戻し','腕を下ろす',`${label}腕`],present,group,[1.1,2.7],1);
    add(`${side}.arm.hold`,`${label}腕を上げて保つ`,`挨拶の高さの${label}腕を動かさず保つ。`,['保持',`${label}腕`],greeting,group,[1.05,1.05],1);
  }
  add('head.down','頭を下げる','正面から頭と首を小さく下に向け、その姿勢で終わる。',['頭を下げる','うなずく'], 'acknowledge','head',[0,.65],.7);
  add('head.up','頭を戻す','下げた頭と首を正面へ戻す。',['頭を戻す','うなずく','戻し'],'acknowledge','head',[.65,1.4],.7);
  add('head.left','顔を左へ向ける','正面からキャラクター自身の左へ頭と首を向ける。',['顔を左へ向ける','首を横に振る'],'shake-head','head',[0,.4],.7);
  add('head.right','顔を右へ向ける','正面からキャラクター自身の右へ頭と首を向ける。',['顔を右へ向ける','首を横に振る'],'shake-head','head',[0,.8],.7);
  add('head.center-left','左向きから正面に戻す','左へ向けた頭と首を正面へ戻す。',['正面','戻し'],'shake-head','head',[.4,2.2],.7);
  add('head.center-right','右向きから正面に戻す','右へ向けた頭と首を正面へ戻す。',['正面','戻し'],'shake-head','head',[.8,2.2],.7);
  add('head.tilt','首をかしげる','頭と首を横に傾けて保つ。',['首をかしげる','思案'],'think','head',[0,1.2],1);
  add('head.untilt','首の傾きを戻す','かしげた頭と首を正面へ戻す。',['戻し','首を戻す'],'think','head',[1.2,2.8],1);
  add('torso.lean','体幹を前に傾ける','背骨と胸を小さく前に傾けて保つ。',['お辞儀','前に傾ける'],'bow','torso',[0,.95],1);
  add('torso.upright','体幹を起こす','前に傾けた背骨と胸を直立に戻す。',['お辞儀','戻し'],'bow','torso',[.95,2.4],1);
  const authored=JSON.parse(readFileSync(new URL('../examples/hand-poses.json',import.meta.url),'utf8')) as {open:Record<string,number>;close:Record<string,number>};
  const poses:Record<string,Record<string,number>>={rest:Object.fromEntries(ownedChannels(['rightArm','leftArm']).map(c=>[c,channels[c].rest]))};
  for(const key of ['open','close'] as const){poses[key]={...poses.rest,...authored[key]};for(const [c,p] of Object.entries(authored[key]))poses[key][c.replace('right','left')]=p*(c.endsWith('.x')?1:-1);}
  for(const [id,name,description,meanings,from,to,duration] of [
    ['hands.ready','両手を胸の前に構える','休息姿勢から胸の前へ両手を上げる。手のひらを向かい合わせ、間隔約20cmで保つ。',['両手','胸の前','構える','準備'],'rest','open',.9],
    ['hands.close','両手のひらを近づける','胸の前の向かい合う両手を、間隔約20cmから約1cmまで寄せる。両手を胸の前に構えた後に使う。',['両手','手を合わせる','近づける','寄せる'],'open','close',.3],
    ['hands.open','両手の間を開く','胸の前で近づけた両手を間隔約20cmへ離す。手のひらの向きと高さを保つ。近づける操作と交互に繰り返せる。',['両手','離す','開く','繰り返し'],'close','open',.3],
    ['hands.lower','両手を胸の前から下ろす','胸の前で両手の間を開いた姿勢から休息姿勢へ戻す。',['両手','下ろす','戻し'],'open','rest',.9],
  ] as const){
    const tracks=Object.fromEntries(Object.keys(poses.rest).map(c=>[c,[{t:0,p:poses[from][c],v:0,a:0},{t:duration,p:poses[to][c],v:0,a:0}]]));
    result.push({id:`primitive.${id}`,clip:{kind:'clip',profile:PROFILE,abstraction:'primitive',name,description,meanings:[...meanings],duration,tracks,context:'同梱VRM・固定立位。両手の協調部品。手指はモデル既定の開いた形を使う。',source:'同梱VRMの手の位置と向きを確認して制作した共通クリップ。',license:'Project-local authored operation'}});
  }
  return result;
}
