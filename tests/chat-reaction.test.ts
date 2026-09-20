import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Library } from '../src/store.ts';
import { Service } from '../src/api.ts';
import { Chat } from '../src/chat.ts';
import { seed } from '../src/seeds.ts';
import { buildSemantic } from '../src/semantic.ts';
import type { Reply, ConversationEngine } from '../src/codex.ts';

const motionReaction={kind:'motion' as const,goal:'二度うなずく',reason:'具体的な身振りを依頼された'};
const response=(extra:Partial<Reply>={}):Reply=>({reaction:motionReaction,unavailable:null,text:'候補を試します。',motion:null,expression:{name:'neutral',intensity:0},request:null,...extra});
const request=(operation:string,args:unknown)=>response({text:'',request:{operation:operation as any,arguments:JSON.stringify(args)}});
function setup(reply:ConversationEngine['reply']){const library=new Library(':memory:');seed(library);const service=new Service(library);const chat=new Chat(service,{reply,status:async()=>({connected:true,models:[]}),login:async()=>({authUrl:''}),close(){}});return {library,service,chat};}
async function send(chat:Chat,text:string){const c=await chat.dispatch('new',{}) as any;return (await chat.dispatch('send',{id:c.id,requestId:randomUUID(),text,model:'test'}) as any).messages.at(-1);}

test('empty search and a false action promise continue into construction, save a candidate, and ask for feedback',async()=>{
  let step=0;const ref={id:'primitive.head.down',version:1};
  const sequence=[request('knowledge-search',{query:'unregistered-xyz'}),response({text:'二度うなずきますね。'}),response({reaction:{kind:'chat',goal:'',reason:'候補がなかった'},text:'返事しますね。'}),request('knowledge-search',{query:'頭を下げる',abstraction:'primitive'}),request('knowledge-inspect',{ref}),request('derive',{name:'未知の返事候補',meanings:['返事'],mode:'sequence',selections:[1,2].map(()=>({ref,revision:1,component:'whole'}))}),response({motion:'draft-1'})];
  const {library,service,chat}=setup(async(messages,catalog)=>{
    if(step===0)assert.deepEqual(catalog,[]);
    const output=step?JSON.parse(messages.at(-1)!.text).hostKnowledgeResult:null;
    if(step===1){assert.equal(output.items.length,0);assert.ok(output.nextAction.includes('組み立て'));assert.ok(output.operations.every((o:any)=>Object.keys(o).length===2));}
    if(step===2)assert.ok(output.error.includes('再生する候補'));
    if(step===3)assert.ok(output.error.includes('不要へ変更できません'));
    return sequence[step++];
  });
  try{
    const m=await send(chat,'まだない返事を身振りでしてください');assert.equal(m.status,'completed',m.text);assert.equal(step,7);assert.ok(m.text.includes('イメージに合っていますか'));
    const saved=JSON.parse(m.motion);assert.ok(saved.candidate);assert.ok(library.get(saved.ref).motion.derivation);assert.ok(service.player.run);assert.equal(library.reviews(saved.ref).length,0);
    assert.equal(JSON.parse(m.reaction).kind,'motion');
  }finally{chat.close();library.close();}
});

test('ordinary chat performs no retrieval, save, playback or facial change; expression-only response stays separate',async()=>{
  let kind:'chat'|'expression'='chat',calls=0;
  const {library,service,chat}=setup(async(_messages,catalog)=>{calls++;assert.deepEqual(catalog,[]);return response({reaction:{kind,goal:'',reason:'文章または表情で応じる'},text:'話を続けてください。',expression:{name:'happy',intensity:.8}});});
  try{
    service.dispatch('execute',{ref:{id:'greeting',version:1}});service.dispatch('expression',{name:'sad',intensity:.4,hold:20});
    const run=service.player.run,face=JSON.stringify(service.face),count=library.db.prepare('SELECT COUNT(*) AS n FROM motions').get()!.n;
    service.knowledge.search=()=>{throw new Error('ordinary chat must not retrieve motion data');};
    const m=await send(chat,'拍手という言葉の意味を教えて。動く必要はありません');assert.equal(m.status,'completed',m.text);assert.equal(m.motion,null);assert.equal(m.expression,null);assert.equal(m.text,'話を続けてください。');assert.equal(service.player.run,run);assert.equal(JSON.stringify(service.face),face);assert.equal(calls,1);
    assert.equal(library.db.prepare('SELECT COUNT(*) AS n FROM motions').get()!.n,count);
    kind='expression';const n=await send(chat,'笑顔にして');assert.equal(n.motion,null);assert.equal(JSON.parse(n.expression).name,'happy');assert.equal(service.player.run,run);
  }finally{chat.close();library.close();}
});

test('genuine capability limits return an honest no-action result only after exploring available material',async()=>{
  let step=0;const sequence=[response({text:'歩きます。',unavailable:'見本がありません。'}),request('semantic-search',{query:''}),request('semantic-inspect',{id:'head-nod',version:1}),response({text:'歩きます。',unavailable:'現在の部品は固定立位の上半身に対応しており、脚の移動を作れません。'})];
  const {library,service,chat}=setup(async()=>sequence[step++]);
  try{const m=await send(chat,'歩いてください');assert.equal(m.status,'completed',m.text);assert.equal(step,4);assert.equal(m.motion,null);assert.equal(m.expression,null);assert.ok(m.text.startsWith('今回は動作を実行できませんでした。'));assert.ok(!m.text.includes('歩きます。'));assert.equal(service.player.run,null);}finally{chat.close();library.close();}
});

test('failure to supply a candidate stays bounded and cannot publish an unsupported performance claim',async()=>{
  let calls=0;const {library,service,chat}=setup(async()=>{calls++;return response({text:'拍手しますね。'});});
  try{const m=await send(chat,'拍手してください');assert.equal(calls,24);assert.equal(m.status,'failed');assert.ok(m.text.includes('動作は実行していません'));assert.equal(m.motion,null);assert.equal(service.player.run,null);}finally{chat.close();library.close();}
});

test('follow-up references resolve to the prior fixed candidate and reuse still asks for confirmation',async()=>{
  const ref={id:'prior-candidate',version:1};let calls=0;
  const {library,service,chat}=setup(async(messages,catalog)=>{calls++;assert.deepEqual(catalog,[]);assert.ok(messages.some(m=>m.text.includes('associatedMotion')&&m.text.includes(ref.id)));return response({motion:ref.id+'@1',text:'先ほどの候補をもう一度試します。'});});
  try{
    const made=buildSemantic(library,{id:'head-nod',version:1,parameters:{direction:'down',angleDeg:20,timing:{mode:'duration',durationSec:1},returnToStart:true}});
    const original=library.save(ref.id,0,made.motion),c=await chat.dispatch('new',{}) as any;
    library.db.prepare("INSERT INTO messages(conversation,requestId,role,text,status,motion,createdAt) VALUES (?,?,'assistant',?,'completed',?,?)").run(c.id,randomUUID(),'候補を試しました。',JSON.stringify({ref,name:made.motion.name,candidate:true}),new Date().toISOString());
    const result=await chat.dispatch('send',{id:c.id,requestId:randomUUID(),text:'それをもう一度',model:'test'}) as any,m=result.messages.at(-1);
    assert.equal(m.status,'completed',m.text);assert.equal(calls,1);assert.ok(JSON.parse(m.motion).candidate);assert.ok(m.text.includes('イメージに合っていますか'));assert.equal(library.get(ref).hash,original.hash);assert.equal(library.reviews(ref).length,0);assert.ok(service.player.run);
  }finally{chat.close();library.close();}
});
