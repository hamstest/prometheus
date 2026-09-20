import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Library } from '../src/store.ts';
import { Service } from '../src/api.ts';
import { Chat } from '../src/chat.ts';
import { seed } from '../src/seeds.ts';
import type { ConversationEngine, Reply } from '../src/codex.ts';

function setup(reply: ConversationEngine['reply']) {
  const library = new Library(':memory:'); seed(library); const service = new Service(library);
  const engine: ConversationEngine = { reply, status: async () => ({ connected: true, models: [{ id:'test',name:'test' }] }), login: async () => ({ authUrl: 'https://chatgpt.com' }), close() {} };
  return { library, service, chat: new Chat(service, engine) };
}
test('chat validates generated motion references before any playback, and preserves literal message text', async () => {
  let valid = false;
  const { library, service, chat } = setup(async (_messages, catalog) => ({reaction:{kind:'motion',goal:'挨拶',reason:'身振りの依頼'},unavailable:null, text: '<script>literal</script>', motion: valid&&catalog.length ? (catalog[0] as {key:string}).key : valid?null:'unlisted@9',expression:{name:'happy',intensity:.65},request:valid&&!catalog.length?{operation:'knowledge-search',arguments:JSON.stringify({query:'手を振る'})}:null }));
  try {
    const conversation = await chat.dispatch('new', {}) as {id:string};
    const first = await chat.dispatch('send', { id:conversation.id,requestId:randomUUID(),text:'こんにちは',model:'test' }) as any;
    assert.equal(first.messages.at(-1).status,'failed'); assert.equal(service.player.run,null);
    valid = true;
    const next = await chat.dispatch('send', { id:conversation.id,requestId:randomUUID(),text:'手を振って',model:'test' }) as any;
    assert.equal(next.messages.at(-1).text,'<script>literal</script>'); assert.equal(next.messages.at(-1).status,'completed'); assert.ok(service.player.run);
    assert.deepEqual(JSON.parse(next.messages.at(-1).expression),{name:'happy',intensity:.65});
    service.player.advance(.5);assert.equal(service.state().expression.weights.happy,.65);
  } finally { chat.close(); library.close(); }
});
test('cancellation suppresses a late model reply and duplicate sends never execute twice', async () => {
  let finish!: (reply: Reply) => void, ready!: () => void;
  const started = new Promise<void>(yes => ready=yes);
  const { library, service, chat } = setup(async () => { ready(); return new Promise<Reply>(yes => finish=yes); });
  try {
    const {id} = await chat.dispatch('new', {}) as {id:string}, requestId=randomUUID();
    const sending=chat.dispatch('send',{id,requestId,text:'挨拶して',model:'test'}); await started;
    await assert.rejects(chat.dispatch('send',{id,requestId,text:'重複',model:'test'}),/すでに/);
    await assert.rejects(chat.dispatch('send',{id,requestId:randomUUID(),text:'同時送信',model:'test'}),/待って/);
    await chat.dispatch('cancel',{id}); finish({reaction:{kind:'motion',goal:'挨拶',reason:'身振りの依頼'},unavailable:null,text:'late',motion:'greeting@1',expression:{name:'happy',intensity:1}});
    const result=await sending as any;
    assert.equal(result.messages.length,2); assert.equal(result.messages[1].status,'cancelled'); assert.equal(service.player.run,null);assert.equal(service.state().expression.name,'neutral');
  } finally { chat.close(); library.close(); }
});
test('conversation history is isolated, persistent in storage and interrupted replies are recoverable', async () => {
  const histories: unknown[]=[];
  const {library,chat,service}=setup(async messages => { histories.push(messages); return {reaction:{kind:'chat',goal:'',reason:'文章で会話'},unavailable:null,text:'応答',motion:null,expression:{name:'neutral',intensity:0}}; });
  try {
    const a=await chat.dispatch('new',{}) as any, b=await chat.dispatch('new',{}) as any;
    await chat.dispatch('send',{id:a.id,requestId:randomUUID(),text:'会話A',model:'test'});
    await chat.dispatch('send',{id:b.id,requestId:randomUUID(),text:'会話B',model:'test'});
    assert.deepEqual(JSON.parse(JSON.stringify(histories[1])),[{role:'user',text:'会話B'}]);
    assert.equal((await chat.dispatch('read',{id:a.id}) as any).messages.length,2);
    library.db.prepare("INSERT INTO messages(conversation,requestId,role,text,status,createdAt) VALUES (?,?, 'assistant','', 'pending',?)").run(a.id,randomUUID(),new Date().toISOString());
    chat.close();
    const recovered=new Chat(service,{status:async()=>({connected:false,models:[]}),login:async()=>({authUrl:''}),reply:async()=>({reaction:{kind:'chat',goal:'',reason:'文章で会話'},unavailable:null,text:'',motion:null,expression:{name:'neutral',intensity:0}}),close(){}});
    assert.equal((await recovered.dispatch('read',{id:a.id}) as any).messages.at(-1).status,'failed'); recovered.close();
  } finally {chat.close();library.close();}
});
