export const expressionNames = ['neutral','happy','relaxed','surprised','sad','angry'] as const;
export type ExpressionName = typeof expressionNames[number];
export type ExpressionChoice = { name: ExpressionName; intensity: number };
export const expressionLabels: Record<ExpressionName,string> = {neutral:'自然',happy:'笑顔',relaxed:'やわらかい笑み',surprised:'驚き',sad:'悲しみ',angry:'怒り'};
export type ExpressionWeights = Record<Exclude<ExpressionName,'neutral'>,number>;
export type ExpressionFrame = ExpressionChoice & { weights: ExpressionWeights; phase: 'enter'|'hold'|'leave'|'idle' };
export function emptyExpression(): ExpressionWeights { return {happy:0,relaxed:0,surprised:0,sad:0,angry:0}; }
const ease = (time:number) => { const t=Math.max(0,Math.min(1,time));return t*t*t*(10+t*(-15+6*t)); };
// Expression weights have a separate ownership domain from joint rotations.
// A convex fade keeps morph weights and their sum bounded even when interrupted.
export class ExpressionPlayer {
  private from=emptyExpression();
  private target=emptyExpression();
  private name:ExpressionName='neutral';
  private intensity=0;
  private started=-Infinity;
  private hold=0;
  play(choice:ExpressionChoice,hold:number,time:number) {
    if(!expressionNames.includes(choice.name)||!Number.isFinite(choice.intensity)||choice.intensity<0||choice.intensity>1||!Number.isFinite(hold)||hold<0||hold>60||!Number.isFinite(time))throw new Error('Invalid expression');
    this.from=this.state(time).weights;this.target=emptyExpression();this.name=choice.name;this.intensity=choice.name==='neutral'?0:choice.intensity;
    if(choice.name!=='neutral')this.target[choice.name]=this.intensity;
    this.started=time;this.hold=hold;
    return this.state(time);
  }
  state(time:number):ExpressionFrame {
    const elapsed=time-this.started,weights=emptyExpression();
    const phase=elapsed<.35?'enter':elapsed<.35+this.hold?'hold':elapsed<.95+this.hold?'leave':'idle';
    for(const name of Object.keys(weights) as (keyof ExpressionWeights)[]) {
      weights[name]=phase==='enter'?this.from[name]+(this.target[name]-this.from[name])*ease(elapsed/.35):phase==='hold'?this.target[name]:phase==='leave'?this.target[name]*(1-ease((elapsed-.35-this.hold)/.6)):0;
    }
    return {name:phase==='idle'?'neutral':this.name,intensity:phase==='idle'?0:this.intensity,phase,weights};
  }
}
// A short, eased double-lid blink; no mouth animation without actual speech.
export function blinkWeight(time:number,weights:ExpressionWeights) {
  const cycle=(time%4.7+4.7)%4.7;
  const blink=cycle<.075?ease(cycle/.075):cycle<.19?1-ease((cycle-.075)/.115):0;
  return blink*(1-Math.max(weights.happy,weights.relaxed)*.85);
}
