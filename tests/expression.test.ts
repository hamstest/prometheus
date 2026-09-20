import test from 'node:test';
import assert from 'node:assert/strict';
import { ExpressionPlayer, expressionNames, emptyExpression, blinkWeight } from '../src/expression.ts';
import { avatarRig } from './vrm-fixture.ts';
import { Library } from '../src/store.ts';
import { Service } from '../src/api.ts';

test('expression interruption keeps weights continuous and bounded, then returns to neutral',()=>{
  const player=new ExpressionPlayer();let time=0;
  for(let repeat=0;repeat<15;repeat++)for(const name of expressionNames){
    const before=player.state(time);player.play({name,intensity:.8},.5,time);
    assert.deepEqual(player.state(time).weights,before.weights);
    for(let i=0;i<20;i++){time+=.007;const w=Object.values(player.state(time).weights);assert.ok(w.every(x=>x>=0&&x<=1));assert.ok(w.reduce((s,x)=>s+x,0)<=1+1e-12);}
  }
  assert.deepEqual(player.state(time+5).weights,emptyExpression());assert.equal(player.state(time+5).name,'neutral');
  assert.throws(()=>player.play({name:'happy',intensity:2},1,time));
  assert.throws(()=>player.play({name:'happy',intensity:1},NaN,time));
});
test('all offered expressions bind to actual avatar morph targets; invalid commands cannot change a face',()=>{
  const {gltf}=avatarRig();
  for(const name of [...expressionNames,'blink']){
    const binds=gltf.extensions.VRMC_vrm.expressions.preset[name]?.morphTargetBinds;
    assert.ok(binds?.length,'Missing morph binding '+name);
    for(const bind of binds){const mesh=gltf.meshes[gltf.nodes[bind.node].mesh];assert.ok(mesh.primitives.some((p:any)=>p.targets?.[bind.index]?.POSITION!==undefined));}
  }
  for(let t=0;t<5;t+=.001)assert.ok(blinkWeight(t,emptyExpression())>=0&&blinkWeight(t,emptyExpression())<=1);
  const library=new Library(':memory:'),service=new Service(library);
  try{service.dispatch('expression',{name:'happy',intensity:.7});service.player.advance(.5);const before=service.state().expression;
    assert.throws(()=>service.dispatch('expression',{name:'unsupported',intensity:1}));
    assert.throws(()=>service.dispatch('expression',{name:'happy',intensity:1.01}));
    assert.deepEqual(service.state().expression,before);
  }finally{library.close();}
});
