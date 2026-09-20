import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { call } from '../src/client.ts';

const items=(await call('search',{query:'',limit:50})).items;
const results=[];
for(const item of items){
  const run=await call('execute',{ref:item.ref});
  const started=performance.now();let frames=0,state:any;
  do{
    state=await call('state');
    assert.equal(state.run.id,run.id,'Another actor changed playback; stop the smoke run.');
    assert.ok(Object.values(state.pose).every((p:any)=>[p.p,p.v,p.a].every(Number.isFinite)));
    assert.ok(performance.now()-started<20000,'Playback did not finish.');
    frames++;
    if(state.run.status==='running')await new Promise(r=>setTimeout(r,150));
  }while(state.run.status==='running');
  assert.equal(state.run.status,'completed');
  const result={ref:item.ref,name:item.name,duration:state.duration,wallSeconds:(performance.now()-started)/1000,observedFrames:frames,status:state.run.status};
  results.push(result);console.log(JSON.stringify(result));
}
writeFileSync(new URL(process.argv.includes('--smoothness')?'../docs/smoothness-playback.json':'../docs/performance-smoke.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),results},null,2)+'\n');
