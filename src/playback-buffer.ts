import { restPose, type Pose } from './model.ts';
import { coefficients, evaluate } from './curve.ts';

type Snapshot={time:number;pose:Pose};
// A presentation clock, separate from packet arrival. Delayed packets may slow
// it gently, but cannot rewind an already displayed movement. No pose low-pass
// filter: interpolate the source's position/velocity/acceleration directly.
export class PlaybackBuffer {
  private frames:Snapshot[]=[];
  private arrival=0;
  private previous=0;
  private time=0;
  private readonly delay=.08;
  push(frame:Snapshot,now:number){
    if(this.frames.length&&frame.time<this.frames.at(-1)!.time)this.frames=[];
    if(this.frames.length&&frame.time===this.frames.at(-1)!.time)return;
    if(!this.frames.length){this.time=frame.time-this.delay;this.previous=now;}
    this.frames.push(frame);this.frames=this.frames.slice(-64);this.arrival=now;
  }
  sample(now:number):Snapshot|null {
    if(!this.frames.length)return null;
    const newest=this.frames.at(-1)!,first=this.frames[0];
    const dt=Math.max(0,(now-this.previous)/1000);this.previous=now;
    const target=newest.time+Math.max(0,(now-this.arrival)/1000)-this.delay;
    const rate=Math.max(.85,Math.min(1.15,1+4*(target-this.time)));
    this.time=Math.min(newest.time,this.time+dt*rate);
    const t=Math.max(first.time,this.time);
    if(t>=newest.time)return {time:newest.time,pose:newest.pose};
    let a=first,b=newest;
    for(let i=1;i<this.frames.length;i++)if(this.frames[i].time>=t){a=this.frames[i-1];b=this.frames[i];break;}
    const pose=restPose(),duration=b.time-a.time;
    for(const axis of Object.keys(pose))pose[axis]=duration>0?evaluate(coefficients(a.pose[axis],b.pose[axis],duration),t-a.time,duration):b.pose[axis];
    return {time:t,pose};
  }
}
