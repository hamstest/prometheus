import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { call } from '../src/client.ts';

const results=[];
for(const item of (await call('semantic-search',{query:''})).items){
  const id=item.key.slice('operation:'.length).split('@')[0],d=await call('semantic-inspect',{id,version:1});
  const made=await call('semantic-build',{id,version:1,parameters:{...(d.parameters.side?{side:'right'}:{}),direction:d.parameters.direction.default,angleDeg:20,timing:{mode:'duration',durationSec:1},holdSec:.2,returnToStart:true}});
  const run=await call('play',{motion:made.motion});let state:any,frames=0;const start=performance.now();
  do{state=await call('state');assert.equal(state.run.id,run.id);assert.ok(Object.values(state.pose).every((p:any)=>[p.p,p.v,p.a].every(Number.isFinite)));frames++;assert.ok(performance.now()-start<15000);if(state.run.status==='running')await new Promise(r=>setTimeout(r,100));}while(state.run.status==='running');
  assert.equal(state.run.status,'completed');results.push({id,duration:state.duration,frames,status:state.run.status});console.log(id+': completed');
}
const conversations=await call('chat/list'),conversation=await call('chat/read',{id:conversations.find((c:any)=>c.title.startsWith('意味付き操作で作って試演してください。右前腕')).id});
const message=conversation.messages.at(-1);assert.equal(message.status,'completed');
const original=await call('inspect',{ref:JSON.parse(message.motion).ref});assert.equal(original.motion.semantic.angleDeg,30);
const edited=(await call('search',{query:'右前腕を45度ひねって戻す',limit:50})).items.find((i:any)=>i.name==='右前腕を45度ひねって戻す');assert.ok(edited);
const second=await call('inspect',{ref:edited.ref});assert.equal(second.motion.semantic.angleDeg,45);assert.equal(second.motion.semantic.timing.speedDegPerSec,30);assert.equal(second.motion.duration,3.3);assert.notEqual(original.ref.id,second.ref.id);
writeFileSync(new URL('../docs/semantic-verification.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),results,conversation,uiEdit:{original:original.ref,edited:second.ref,parameters:second.motion.semantic}},null,2)+'\n');
