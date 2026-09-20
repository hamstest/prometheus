import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { PROFILE, channels, type Clip, type Knot, type Motion, type Ref, type Score } from './model.ts';
import type { Library } from './store.ts';
import { flowClip } from './authoring.ts';
import { primitiveExamples } from './primitives.ts';

// Release data only: gesture names never select a different runtime controller.
const meta = { profile: PROFILE, kind: 'clip', source: 'Prometheus V3で新規作成した手付けの操作例。収録・学習済みモーションではない。', license: 'Project-local authored example', context: '同梱VRM・固定立位・正面。人による採用評価は未実施。' } as const;
const palmSource = meta.source + ' 2026-09-09: 同梱VRMの指骨格から手のひらの向きを検査し、肩・肘・手首の配分を修正。';
function track(times: number[], values: number[], stationary = true): Knot[] {
  return times.map((t,i)=>({t,p:values[i],v:stationary||i===0||i===times.length-1?0:(values[i+1]-values[i-1])/(times[i+1]-times[i-1]),a:0}));
}
function envelope(times: number[], weights: number[], targets: Record<string, number>): Record<string,Knot[]> {
  return Object.fromEntries(Object.entries(targets).map(([axis,target])=>[axis,track(times,weights.map(w=>channels[axis].rest+(target-channels[axis].rest)*w))]));
}
function mirror(clip: Clip, name: string, meanings: string[]): Clip {
  return {...structuredClone(clip),name,meanings,context:clip.context.replaceAll('自身の右（画面左）','自身の左（画面右）'),tracks:Object.fromEntries(Object.entries(clip.tracks).map(([axis,keys])=>{
    const target=axis.startsWith('right')?axis.replace('right','left'):axis;
    const sign=axis.endsWith('.x')?1:-1;
    return [target,keys.map(k=>({...k,p:k.p*sign,v:k.v*sign,a:k.a*sign}))];
  }))};
}
// Rounded key poses fitted offline to the bundled rig. Desired directions:
// greeting: palm +Z, fingers +Y; present: palm +Y, fingers toward character-right.
const waveArm = {'rightUpperArm.x':-.464,'rightUpperArm.y':.316,'rightUpperArm.z':.246,'rightLowerArm.x':-.524,'rightLowerArm.y':1.232,'rightLowerArm.z':-.328,'rightHand.x':.234,'rightHand.y':.15,'rightHand.z':-.27};
const presentArm = {'rightUpperArm.x':-1.297,'rightUpperArm.y':-.311,'rightUpperArm.z':.51,'rightLowerArm.x':-1.324,'rightLowerArm.y':.052,'rightLowerArm.z':.202,'rightHand.x':-.35,'rightHand.y':.059,'rightHand.z':.318};
export function examples(): {id:string;clip:Clip}[] {
  const wt=[0,.65,1.05,1.4,1.75,2.1,2.5,3.15], ww=[0,.9,1,1,1,1,.8,0];
  const greeting: Clip={...meta,source:palmSource,name:'右手で挨拶',meanings:['挨拶','手を振る','こんにちは','別れ','wave','greet'],context:meta.context+' 自身の右（画面左）の手。手のひらを相手へ向ける。',duration:3.15,tracks:{
    ...envelope(wt,ww,waveArm),
    'rightHand.y':track(wt,[0,.13,.02,.28,.02,.28,.12,0]),
    'rightHand.z':track(wt,[0,-.24,-.37,-.17,-.37,-.17,-.2,0]),
    'chest.y':track(wt,[0,-.03,-.04,-.04,-.04,-.04,-.02,0]),
    'head.z':track(wt,[0,.025,.04,.04,.04,.04,.02,0]),
  }};
  const pt=[0,.8,1.1,1.8,2.7],pw=[0,.9,1,1,0];
  const present:Clip={...meta,source:palmSource,name:'右側を手で示す',meanings:['示す','紹介','説明','案内','present','explain'],context:meta.context+' 自身の右（画面左）を開いた手で示す。手のひらは上向き。',duration:2.7,tracks:{
    ...envelope(pt,pw,presentArm),'chest.y':track(pt,[0,-.06,-.08,-.08,0]),'head.y':track(pt,[0,-.12,-.18,-.10,0]),
  }};
  const slow=[0,.75,1.2,2.05,2.8],hold=[0,.8,1,1,0];
  const openArms=envelope(slow,hold,presentArm);
  const leftOpen=mirror({...present,tracks:openArms},'',[]).tracks;
  const surpriseTimes=[0,.3,.6,1.1,1.7,2.5],surpriseWeights=[0,.8,1,1,.5,0];
  const surpriseRight=envelope(surpriseTimes,surpriseWeights,waveArm);
  const clips: {id:string;clip:Clip}[] = [
    {id:'greeting',clip:greeting},
    {id:'acknowledge',clip:{...meta,name:'小さくうなずく',meanings:['うなずく','同意','了解','返事','nod','yes'],duration:1.4,tracks:{
      'head.x':track([0,.35,.65,.9,1.4],[0,-.1,.23,-.04,0],false),
      'neck.x':track([0,.35,.65,.9,1.4],[0,-.025,.055,-.01,0],false),
      'chest.x':track([0,.35,.65,.9,1.4],[0,0,.025,.015,0],false),
    }}},
    {id:'present',clip:present},
    {id:'rest',clip:{...meta,name:'休む姿勢',meanings:['休む','戻す','rest'],duration:.3,tracks:{'head.x':track([0,.3],[0,0])}}},
    {id:'greeting-left',clip:mirror(greeting,'左手で挨拶',['左手','挨拶','手を振る','左で挨拶'])},
    {id:'present-left',clip:mirror(present,'左側を手で示す',['左側','示す','案内','紹介','左を示す'])},
    {id:'bow',clip:{...meta,name:'軽くお辞儀する',meanings:['お辞儀','ありがとう','感謝','よろしく','謝る','礼'],duration:2.4,tracks:envelope([0,.55,.95,1.45,2.4],[0,.8,1,1,0],{'spine.x':.14,'chest.x':.16,'neck.x':.04,'head.x':.12})}},
    {id:'shake-head',clip:{...meta,name:'やさしく首を横に振る',meanings:['いいえ','違う','首を振る','否定','遠慮','no'],duration:2.2,tracks:{
      'head.y':track([0,.4,.8,1.2,1.6,2.2],[0,.27,-.27,.22,-.13,0]),
      'neck.y':track([0,.4,.8,1.2,1.6,2.2],[0,.04,-.04,.03,-.02,0]),
    }}},
    {id:'think',clip:{...meta,name:'考えるように首をかしげる',meanings:['考える','首をかしげる','疑問','どうだろう','迷う','think'],duration:2.8,tracks:envelope(slow,hold,{'head.z':.17,'head.y':-.12,'neck.z':.04,'chest.z':.025})}},
    {id:'listen',clip:{...meta,name:'ゆっくり相づちを打つ',meanings:['聞く','話を聞く','相づち','寄り添う','傾聴','listen'],duration:3.2,tracks:{
      'head.x':track([0,.6,1,1.5,1.95,2.4,3.2],[0,.07,.14,.04,.12,.05,0]),
      'head.z':track([0,.6,1,1.5,1.95,2.4,3.2],[0,-.04,-.05,-.05,-.05,-.03,0]),
      'neck.x':track([0,.6,1,1.5,1.95,2.4,3.2],[0,.01,.025,.01,.02,.01,0]),
    }}},
    {id:'welcome',clip:{...meta,name:'両手を開いて迎える',meanings:['歓迎','ようこそ','両手','迎える','どうぞ','welcome'],duration:2.8,tracks:{...openArms,...leftOpen,...envelope(slow,hold,{'head.x':-.04,'chest.x':-.035})}}},
    {id:'surprise',clip:{...meta,name:'両手を上げて驚く',meanings:['驚く','びっくり','両手を上げる','驚き','surprise'],duration:2.5,tracks:{
      ...surpriseRight,...mirror({...greeting,tracks:surpriseRight},'',[]).tracks,
      ...envelope(surpriseTimes,surpriseWeights,{'chest.x':-.07,'neck.x':-.035,'head.x':-.05}),
    }}},
  ];
  return clips.map(({id,clip})=>{
    const flowing=flowClip(clip);
    if(!isDeepStrictEqual(flowing.tracks,clip.tracks))flowing.source+=' 2026-09-10: ポーズ・時刻・保持区間を維持し、通過点の停止と折り返しの停滞を減らした。';
    return {id,clip:flowing};
  });
}
export function legacyExamples(): {id:string;clip:Clip}[] {
  return JSON.parse(readFileSync(new URL('../examples/starter-v1.json',import.meta.url),'utf8'));
}
export function previousExamples(): {id:string;clip:Clip}[] {
  return JSON.parse(readFileSync(new URL('../examples/starter-v2.json',import.meta.url),'utf8'));
}
function composition(greeting:Ref,present:Ref):Score {
  return {kind:'score',profile:PROFILE,name:'挨拶から紹介へ',meanings:['挨拶','紹介','説明を始める'],
    context:'同梱VRM・固定立位。挨拶の回収と紹介の準備を省き、手を上げた区間同士をつなぐ操作例。',
    source:`V3の手付け例 greeting@${greeting.version} と present@${present.version} の時間区間を再利用`,license:'Project-local authored example',
    parts:[{key:'greet',ref:greeting,from:.65,to:2.1,speed:1,transition:.6},{key:'present',ref:present,from:.8,to:1.8,speed:1,transition:.6}]};
}
export function seed(library:Library) {
  // Upgrade only an exact, unchanged starter release. User edits and all old
  // fixed references/reviews remain intact; re-running seed does not add versions.
  const legacy=legacyExamples(),previous=previousExamples(),refs=new Map<string,Ref>();
  const prior=(id:string):Ref=>({id,version:Number(library.db.prepare('SELECT COALESCE(MAX(version),1) AS version FROM motions WHERE id=?').get(id)!.version)});
  const priorComposition=composition(prior('greeting'),prior('present'));
  function install(id:string,motion:Motion,old:Motion[] = []) {
    const row=library.db.prepare('SELECT MAX(version) AS version FROM motions WHERE id=?').get(id);
    const version=Number(row?.version??0);
    if(!version)return library.save(id,0,motion).ref;
    const saved=library.get({id,version});
    if(old.some(candidate=>isDeepStrictEqual(saved.motion,candidate))&&!isDeepStrictEqual(saved.motion,motion))return library.save(id,version,motion).ref;
    return saved.ref;
  }
  for(const {id,clip} of examples())refs.set(id,install(id,clip,[...legacy,...previous].filter(e=>e.id===id).map(e=>e.clip)));
  install('greet-and-present',composition(refs.get('greeting')!,refs.get('present')!),[priorComposition,composition({id:'greeting',version:1},{id:'present',version:1})]);
  for(const {id,clip} of primitiveExamples(examples()))install(id,clip);
}
