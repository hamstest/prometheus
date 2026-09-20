import type { Clip, Knot } from './model.ts';

// Offline key authoring only. Keep every authored time/angle and genuine hold;
// compute C2 tangents, then constrain the quintic Bezier controls to the local
// endpoint range. The common player still evaluates ordinary saved curves.
export function flowingKeys(input: Knot[]): Knot[] {
  const keys=input.map(k=>({...k,p:k.p===0?0:k.p,v:0,a:0}));
  const h=keys.slice(1).map((k,i)=>k.t-keys[i].t);
  const slope=h.map((dt,i)=>(keys[i+1].p-keys[i].p)/dt);
  for(let i=1;i<keys.length-1;i++){
    const left=slope[i-1],right=slope[i];
    if(Math.abs(left)<1e-12||Math.abs(right)<1e-12)continue; // authored hold
    if(left*right>0){
      const w1=2*h[i]+h[i-1],w2=h[i]+2*h[i-1];
      keys[i].v=(w1+w2)/(w1/left+w2/right);
      keys[i].v=Math.sign(left)*Math.min(Math.abs(keys[i].v),1.2*Math.min(Math.abs(left),Math.abs(right)),20);
    }
    let low=-100,high=100;
    // End/start control-polygon edges must have the segment's direction.
    if(left>0)high=Math.min(high,4*keys[i].v/h[i-1]);else low=Math.max(low,4*keys[i].v/h[i-1]);
    if(right>0)low=Math.max(low,-4*keys[i].v/h[i]);else high=Math.min(high,-4*keys[i].v/h[i]);
    keys[i].a=Math.max(low,Math.min(high,2*(right-left)/(h[i-1]+h[i])));
  }
  // Only the middle Bezier edge couples neighbouring knots. Scaling their
  // derivatives toward zero preserves all the other inequalities and C2 joins.
  for(let pass=0;pass<64;pass++){
    let changed=false;
    for(let i=0;i<h.length;i++){
      const a=keys[i],b=keys[i+1],dt=h[i],sign=Math.sign(b.p-a.p);
      const middle=b.p-a.p-.4*dt*(a.v+b.v)+dt*dt*(b.a-a.a)/20;
      if(sign*middle< -1e-12){for(const k of [a,b]){k.v*=.8;k.a*=.8;}changed=true;}
    }
    if(!changed)return keys;
  }
  throw new Error('Could not bound authored curve tangents');
}
export function flowClip(clip:Clip):Clip {
  return {...structuredClone(clip),tracks:Object.fromEntries(Object.entries(clip.tracks).map(([axis,keys])=>[axis,flowingKeys(keys)]))};
}
