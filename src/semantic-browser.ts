import type { Motion, Ref } from './model.ts';

export function setupSemantic(panel:HTMLElement,api:<T=any>(op:string,input?:unknown)=>Promise<T>,report:(s:string)=>void,load:(motion:Motion)=>void,select:(ref:Ref)=>Promise<void>){
  const section=document.createElement('details');
  section.innerHTML='<summary>意味付きパラメーターから作る・編集する</summary><p>操作と方向を選び、角度・時間・速度を指定します。作った動作は部品として合成できます。</p><label>操作<select data-operation><option value="">操作を選んでください</option></select></label><div data-fields></div>';
  panel.prepend(section);
  const el=<T extends HTMLElement=HTMLElement>(s:string)=>section.querySelector(s) as T;
  const pick=el<HTMLSelectElement>('[data-operation]');
  const line=(s:string)=>{const p=document.createElement('p');p.textContent=s;return p;};
  const act=(fn:()=>Promise<void>)=>()=>{void fn().catch(e=>report(e.message));};
  const button=(label:string,fn:()=>Promise<void>)=>{const b=document.createElement('button');b.textContent=label;b.onclick=act(fn);return b;};
  let epoch=0,currentBase:{ref:Ref;time:number}|undefined,refreshBase:()=>void=()=>{};
  const ready=api('semantic-search',{query:''}).then(data=>{for(const item of data.items){const option=document.createElement('option');option.value=item.key.slice('operation:'.length).split('@')[0];option.textContent=item.description.split('。')[0];pick.append(option);}}).catch(e=>report(e.message));
  async function form(id:string,saved?:any,name?:string){
    const ticket=++epoch,definition=await api('semantic-inspect',{id,version:1});if(ticket!==epoch)return;
    const target=el('[data-fields]');target.replaceChildren();target.append(line(definition.description),line(definition.frame));
    const fields=document.createElement('div');fields.className='knowledge-compose';target.append(fields);
    const input=(label:string,value:string,type='text',min?:number,max?:number)=>{const wrap=document.createElement('label');wrap.textContent=label;const v=document.createElement('input');v.type=type;v.value=value;if(min!==undefined)v.min=String(min);if(max!==undefined)v.max=String(max);if(type==='number')v.step='any';wrap.append(v);fields.append(wrap);return v;};
    const choice=(label:string,choices:{id:string;label:string}[],value:string)=>{const wrap=document.createElement('label');wrap.textContent=label;const v=document.createElement('select');for(const c of choices){const o=document.createElement('option');o.value=c.id;o.textContent=c.label;v.append(o);}v.value=value;wrap.append(v);fields.append(wrap);return v;};
    const checkbox=(label:string,checked:boolean)=>{const wrap=document.createElement('label');wrap.textContent=label;const v=document.createElement('input');v.type='checkbox';v.checked=checked;wrap.append(v);fields.append(wrap);return v;};
    const p=definition.parameters;
    const side=p.side?choice(p.side.label,p.side.choices,saved?.side??p.side.default):undefined;
    const direction=choice(p.direction.label,p.direction.choices,saved?.direction??p.direction.default);
    const angle=input(p.angleDeg.label+'（度）',String(saved?.angleDeg??p.angleDeg.default),'number',p.angleDeg.min,p.angleDeg.max);
    const timing=choice('時間の決め方',[{id:'duration',label:'片道の時間で指定'},{id:'speed',label:'平均角速度で指定'}],saved?.timing.mode??'duration');
    const seconds=input('片道の時間（秒）',String(saved?.durationSec??1),'number',.25,10);
    const speed=input('平均角速度（度/秒）',String(saved?.timing.speedDegPerSec??30),'number',1,180);
    const timingNote=line(p.timing.note);target.append(timingNote);
    function updateTiming(){seconds.parentElement!.hidden=timing.value!=='duration';speed.parentElement!.hidden=timing.value!=='speed';timingNote.textContent=p.timing.note+(timing.value==='speed'?` 指定値からの片道時間：${(Number(angle.value)/Number(speed.value)).toFixed(2)}秒`:'');}
    timing.onchange=updateTiming;angle.oninput=updateTiming;speed.oninput=updateTiming;updateTiming();
    const hold=input('到達後に保つ時間（秒）',String(saved?.holdSec??0),'number',0,10);
    const returns=checkbox('元の姿勢へ戻る',saved?.returnToStart??false);
    const useBase=checkbox('下記の保存版・時刻の姿勢から始める',Boolean(saved?.base));
    let base=saved?.base??currentBase;
    const baseNote=line('');target.append(baseNote);
    const showBase=()=>{useBase.disabled=!base;baseNote.textContent=base?`開始姿勢の候補：${base.ref.id}@${base.ref.version}・${base.time.toFixed(2)}秒。未選択時は休息姿勢。`:'開始姿勢：休息姿勢。既存動作の姿勢を使う場合は先に動作を選んでください。';};
    refreshBase=()=>{base=currentBase;showBase();};showBase();
    const title=input('保存する名前',name??definition.name);
    if(saved)target.append(line('生成時の意味と数値を読み込みました。ここからの試演・保存は再生成です。曲線を直接編集した変更は引き継ぎません。'));
    const args=()=>({id,version:1,name:title.value,parameters:{...(side?{side:side.value}:{}),direction:direction.value,angleDeg:Number(angle.value),timing:timing.value==='duration'?{mode:'duration',durationSec:Number(seconds.value)}:{mode:'speed',speedDegPerSec:Number(speed.value)},holdSec:Number(hold.value),returnToStart:returns.checked},...(useBase.checked&&base?{base}:{})});
    const actions=document.createElement('div');actions.className='knowledge-compose';target.append(actions);
    actions.append(button('パラメーターで試演',async()=>{const result=await api('semantic-build',args());await api('play',{motion:result.motion});report('意味付きパラメーターで試演しています。');}),button('部品として保存',async()=>{const result=await api('semantic-build',args()),saved=await api('save',{id:'semantic-'+crypto.randomUUID(),expectedVersion:0,motion:result.motion});await select(saved.ref);report('意味とパラメーターを保持した部品として保存しました。');}),button('曲線の編集案へ',async()=>{const result=await api('semantic-build',args());load(result.motion);section.closest('dialog')?.close();report('意味付き操作を曲線の編集案にしました。');}));
  }
  pick.onchange=act(async()=>{if(pick.value)await form(pick.value);});
  return {selected:async(ref:Ref,data:any)=>{
    currentBase={ref,time:Math.max(...data.knowledge.definition.components.map((c:any)=>c.to))};
    if(data.semantic){section.open=true;await ready;pick.value=data.semantic.operation;await form(data.semantic.operation,data.semantic,data.name);}else refreshBase();
  }};
}
