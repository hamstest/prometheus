import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { call } from '../src/client.ts';

const latest=(await call('search',{query:'',limit:50})).items;
const selected=latest.filter((i:any)=>i.abstraction==='primitive'||i.abstraction==='motion'||i.name==='基本操作から組み立てた右手の挨拶');
const results=[];
for(const item of selected){
  const definition=await call('knowledge-inspect',{ref:item.ref});
  const run=await call('execute',{ref:item.ref});
  let state:any,frames=0;const started=performance.now();
  do{
    state=await call('state');assert.equal(state.run.id,run.id);assert.ok(Object.values(state.pose).every((p:any)=>[p.p,p.v,p.a].every(Number.isFinite)));frames++;
    assert.ok(performance.now()-started<20000);
    if(state.run.status==='running')await new Promise(r=>setTimeout(r,120));
  }while(state.run.status==='running');
  assert.equal(state.run.status,'completed');
  const result={ref:item.ref,name:item.name,seconds:state.duration,frames,components:definition.knowledge.definition.components.length,sources:definition.derivation?.selections??[]};results.push(result);console.log(JSON.stringify({name:item.name,status:'completed'}));
}
const conversations=await call('chat/list'),conversation=await call('chat/read',{id:conversations[0].id});
writeFileSync(new URL('../docs/hierarchy-verification.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),results,conversation},null,2)+'\n');
