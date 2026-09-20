import { channels, BODY, PROFILE } from './model.ts';

export const ONTOLOGY = 'prometheus-body-behavior-4';
export type Concept = { id: string; label: string; kind: 'intent' | 'action' | 'phase'; aliases: string[]; broader: string[]; related: string[] };
const concept = (id: string, label: string, kind: Concept['kind'], aliases: string[], broader: string[] = [], related: string[] = []): Concept => ({ id, label, kind, aliases, broader, related });
export const concepts: Concept[] = [
  concept('communication','対話表現','intent', ['communication']),
  concept('greeting','挨拶','intent',['こんにちは','やあ','greet','greeting'],['communication']),
  concept('farewell','別れの挨拶','intent',['さようなら','バイバイ','別れ','farewell'],['greeting']),
  concept('welcome','歓迎','intent',['ようこそ','迎える','お迎え','welcome'],['communication'],['greeting']),
  concept('explain','説明','intent',['紹介','explain','説明する'],['communication']),
  concept('guide','案内','intent',['案内する','どうぞ','guide'],['explain']),
  concept('agree','同意','intent',['了解','肯定','賛成','yes','agree'],['communication']),
  concept('deny','否定','intent',['いいえ','違う','遠慮','no','deny'],['communication']),
  concept('thanks','感謝','intent',['ありがとう','お礼','thanks'],['communication']),
  concept('apology','謝罪','intent',['ごめん','謝る','すみません','apology'],['communication']),
  concept('thinking','思案','intent',['考える','考えて','迷う','疑問','think'],['communication']),
  concept('listening','傾聴','intent',['聞く','聞いて','話を聞く','寄り添う','listen'],['communication']),
  concept('surprise','驚き','intent',['びっくり','驚く','驚いて','surprise'],['communication']),
  concept('rest','休息','action',['休む','戻す','休める','rest']),
  concept('wave','手を振る','action',['手振り','手を振って','振る','wave']),
  concept('present','開いた手で示す','action',['示す','示して','手で案内','present']),
  concept('nod','うなずく','action',['うなずき','頷く','うなずいて','相づち','nod']),
  concept('bow','お辞儀','action',['会釈','礼','お辞儀して','bow']),
  concept('shake','首を横に振る','action',['首振り','首を振る','shake head']),
  concept('tilt','首をかしげる','action',['首を傾げる','首をかしげて','tilt']),
  concept('open-arms','両腕を開く','action',['両手を開く','両手を広げる','open arms']),
  concept('raise-hands','両手を上げる','action',['両手を上げて','raise hands']),
  concept('raise-arm','腕を上げる','action',['腕を上げて','手を上げる','raise arm']),
  concept('lower-arm','腕を下ろす','action',['腕を下ろして','手を下ろす','lower arm']),
  concept('hold','姿勢を保つ','action',['保持','保つ','hold']),
  concept('lower-head','頭を下げる','action',['頭を下げて','lower head']),
  concept('raise-head','頭を戻す','action',['頭を戻して','raise head']),
  concept('lean','体幹を傾ける','action',['前に傾ける','lean']),
  concept('upright','体幹を起こす','action',['起こす','upright']),
  concept('arm-twist','腕をひねる','action',['腕を捻る','腕をねじる','arm twist']),
  concept('forearm-twist','前腕をひねる','action',['前腕を捻る','forearm twist'],['arm-twist']),
  concept('upper-arm-twist','上腕をひねる','action',['上腕を捻る','upper arm twist'],['arm-twist']),
  concept('elbow-bend','肘を曲げ伸ばしする','action',['肘を曲げる','肘を伸ばす','elbow bend']),
  concept('head-turn','顔を左右へ向ける','action',['顔を向ける','head turn']),
  concept('head-nod','頭を上下に動かす','action',['head pitch'],[],['nod']),
  concept('torso-turn','体幹をひねる','action',['胴体をひねる','torso turn']),
  concept('hands-ready','両手を胸の前に構える','action',['両手を構える','hands ready']),
  concept('hands-close','両手のひらを近づける','action',['手を合わせる','両手を寄せる','hands together']),
  concept('hands-open','両手の間を開く','action',['両手を離す','hands apart']),
  concept('prepare','準備','phase',['準備区間','立ち上がり','prepare']),
  concept('stroke','主動作','phase',['動きの本体','stroke']),
  concept('recover','戻し','phase',['回収','戻す区間','recover']),
];
export const bodyGroups: Record<string, { label: string; bones: string[]; aliases: string[] }> = {
  torso: { label:'体幹', bones:['spine','chest'], aliases:['胸','胴体','torso'] },
  head: { label:'頭と首', bones:['neck','head'], aliases:['頭','首','head','neck'] },
  rightArm: { label:'右腕と手', bones:['rightShoulder','rightUpperArm','rightLowerArm','rightHand'], aliases:['右腕','右手','right arm','right hand'] },
  leftArm: { label:'左腕と手', bones:['leftShoulder','leftUpperArm','leftLowerArm','leftHand'], aliases:['左腕','左手','left arm','left hand'] },
};
export function ownedChannels(parts: string[]) { return Object.keys(channels).filter(c => parts.some(p => bodyGroups[p]?.bones.includes(c.split('.')[0]))); }
export function usedParts(tracks: Record<string, unknown>) { return Object.keys(bodyGroups).filter(p => ownedChannels([p]).some(c => Object.hasOwn(tracks,c))); }
export const normalize = (s: string) => s.normalize('NFKC').toLowerCase();
function contains(text: string, term: string) {
  return /^[a-z ]+$/i.test(term) ? new RegExp(`(?:^|[^a-z])${term}(?:$|[^a-z])`,'i').test(text) : text.includes(term);
}
export function identify(text: string) { const t=normalize(text); return concepts.filter(c=>[c.id,c.label,...c.aliases].some(a=>contains(t,normalize(a)))).map(c=>c.id); }
export function ancestors(id: string): string[] { const c=concepts.find(c=>c.id===id); return c ? [...new Set(c.broader.flatMap(p=>[p,...ancestors(p)]))] : []; }
export function ontology() {
  const nodes: Record<string, unknown>[] = [{id:'body',kind:'body',label:'同梱VRMの身体',body:BODY,profile:PROFILE},...concepts];
  const edges: {from:string;relation:string;to:string}[] = [];
  for(const c of concepts){for(const p of c.broader)edges.push({from:c.id,relation:'isA',to:p});for(const p of c.related)edges.push({from:c.id,relation:'relatedTo',to:p});}
  for(const [id,g] of Object.entries(bodyGroups)) {
    nodes.push({id,kind:'bodyPart',label:g.label,aliases:g.aliases});edges.push({from:id,relation:'partOf',to:'body'});
    for(const bone of g.bones){
      const boneId=bone===id?`${bone}Bone`:bone;
      const names:Record<string,string>={spine:'背骨',chest:'胸',neck:'首',head:'頭',Shoulder:'肩',UpperArm:'上腕',LowerArm:'前腕',Hand:'手首'};
      const side=bone.startsWith('right')?'右':bone.startsWith('left')?'左':'';
      const suffix=bone.replace(/^(right|left)/,'');
      nodes.push({id:boneId,kind:'bone',label:side+(names[suffix]??bone),coordinateFrame:'normalized parent-local XYZ',channels:Object.fromEntries(Object.entries(channels).filter(([c])=>c.startsWith(bone+'.')))});
      edges.push({from:boneId,relation:'partOf',to:id});
    }
  }
  return {version:ONTOLOGY,coordinates:'左右はキャラクター自身。局所XYZ Eulerラジアン。身体の正面+Z、上+Y。',scope:'固定立位・上半身。手指の個別関節、脚、root移動は操作対象外。腕は肩・上腕・前腕・手首を一組で抽出する。',nodes,edges};
}
