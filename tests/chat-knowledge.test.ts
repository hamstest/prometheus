import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Library } from '../src/store.ts';
import { Service } from '../src/api.ts';
import { Chat } from '../src/chat.ts';
import { seed } from '../src/seeds.ts';
import type { ConversationEngine, Reply } from '../src/codex.ts';
const reply=(operation:string,args:unknown):Reply=>({reaction:{kind:'motion',goal:'挨拶',reason:'動作の依頼'},unavailable:null,text:'',motion:null,expression:{name:'neutral',intensity:0},request:{operation:operation as 'derive',arguments:JSON.stringify(args)}});
test('conversation agent searches, inspects, derives, saves a reusable candidate and records its source graph',async()=>{
  const library=new Library(':memory:');seed(library);const service=new Service(library);let step=0;
  const sequence=[reply('knowledge-search',{query:'挨拶'}),reply('knowledge-inspect',{ref:{id:'greeting',version:1}}),reply('derive',{name:'挨拶の主動作を2回',meanings:['挨拶'],mode:'sequence',selections:[1,2].map(()=>({ref:{id:'greeting',version:1},revision:1,component:'stroke',speed:1}))}),{text:'組み合わせて試してみます。',motion:'draft-1',expression:{name:'happy',intensity:.5},request:null} as Reply];
  const engine:ConversationEngine={status:async()=>({connected:true,models:[]}),login:async()=>({authUrl:''}),close(){},reply:async(messages)=>{if(step>0)assert.ok(messages.at(-1)!.text.includes('hostKnowledgeResult'));return {...sequence[step++],reaction:{kind:'motion',goal:'挨拶',reason:'動作の依頼'},unavailable:null};}};
  const chat=new Chat(service,engine);
  try{
    const {id}=await chat.dispatch('new',{}) as any,requestId=randomUUID();
    const response=await chat.dispatch('send',{id,requestId,text:'挨拶の主動作を2回組み合わせて新しい動作を作って',model:'test'}) as any;
    const message=response.messages.at(-1);assert.equal(message.status,'completed',message.text);assert.equal(step,4);
    const saved=library.get(JSON.parse(message.motion).ref);assert.equal(saved.motion.derivation!.selections.length,2);assert.equal(library.reviews(saved.ref).length,0);
    assert.ok(service.player.run);assert.ok(JSON.parse(message.knowledgeTrace).some((t:any)=>t.operation==='save'));
    const graph=service.knowledge.inspect({ref:saved.ref});assert.equal(graph.edges.filter(e=>e.relation==='derivedFrom').length,2);
  }finally{chat.close();library.close();}
});
test('cancelled late derivation cannot save or play',async()=>{
  const library=new Library(':memory:');seed(library);const service=new Service(library);let finish!:(r:Reply)=>void,ready!:()=>void;
  const started=new Promise<void>(r=>ready=r);
  const chat=new Chat(service,{status:async()=>({connected:true,models:[]}),login:async()=>({authUrl:''}),close(){},reply:async()=>{ready();return new Promise<Reply>(r=>finish=r);}});
  try{
    const {id}=await chat.dispatch('new',{}) as any,count=library.db.prepare('SELECT COUNT(*) AS n FROM motions').get()!.n;
    const sending=chat.dispatch('send',{id,requestId:randomUUID(),text:'作成して',model:'test'});await started;await chat.dispatch('cancel',{id});finish(reply('derive',{}));
    assert.equal((await sending as any).messages.at(-1).status,'cancelled');assert.equal(library.db.prepare('SELECT COUNT(*) AS n FROM motions').get()!.n,count);assert.equal(service.player.run,null);
  }finally{chat.close();library.close();}
});
test('agent requests cannot cross into direct save, review or execution operations',async()=>{
  const library=new Library(':memory:');seed(library);const service=new Service(library);
  const chat=new Chat(service,{status:async()=>({connected:true,models:[]}),login:async()=>({authUrl:''}),close(){},reply:async()=>reply('execute',{ref:{id:'greeting',version:1}})});
  try{
    const {id}=await chat.dispatch('new',{}) as any;
    const result=await chat.dispatch('send',{id,requestId:randomUUID(),text:'試験',model:'test'}) as any;
    assert.equal(result.messages.at(-1).status,'failed');assert.equal(service.player.run,null);
    assert.equal(library.db.prepare('SELECT COUNT(*) AS n FROM reviews').get()!.n,0);
  }finally{chat.close();library.close();}
});
