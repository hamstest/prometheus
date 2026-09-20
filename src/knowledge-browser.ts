import type { Motion, Ref } from './model.ts';
import { setupSemantic } from './semantic-browser.ts';

type Component={key:string;label:string;from:number;to:number;bodyParts:string[];concepts:string[];requires:string[];effects:string[]};
export function setupKnowledge(api:<T=any>(op:string,input?:unknown)=>Promise<T>,report:(s:string,error?:boolean)=>void,load:(m:Motion)=>void){
  const dialog=document.createElement('dialog');dialog.className='knowledge-dialog';
  dialog.innerHTML='<div class="section-title"><h2>身体・意味・動作の知識</h2><button data-close>閉じる</button></div><p class="muted">意味から動作を探し、版を固定した部品を組み合わせます。左右はキャラクター自身の左右です。</p><details><summary>身体と意味のオントロジー</summary><div data-ontology></div></details><h3>選択した動作の定義</h3><div data-definition>ライブラリで動作を選んでください。</div><h3>部品から組み立てる</h3><div data-queue></div><div class="knowledge-compose"><label>新しい動作の名前<input data-name value="部品から作った動作"></label><label>意味・呼び方<input data-meanings value="挨拶"></label><label>組み合わせ方<select data-mode><option value="sequence">順番に行う</option><option value="parallel">同時に行う（異なる部位）</option></select></label><button data-derive class="primary">編集案を作る</button></div><p data-status role="status"></p>';
  document.body.append(dialog);
  const el=<T extends HTMLElement=HTMLElement>(selector:string)=>dialog.querySelector(selector) as T;
  const status=(s:string,error=false)=>{el('[data-status]').textContent=s;report(s,error);};
  const act=(fn:()=>Promise<void>|void)=>()=>{try{void Promise.resolve(fn()).catch(e=>status(e.message,true));}catch(e){status((e as Error).message,true);}};
  const button=(name:string,fn:()=>void|Promise<void>)=>{const b=document.createElement('button');b.textContent=name;b.onclick=act(fn);return b;};
  const line=(text:string)=>{const p=document.createElement('p');p.textContent=text;return p;};
  const launch=button('身体・意味・部品の知識',()=>dialog.showModal());launch.className='knowledge-launch';document.getElementById('selection')!.before(launch);
  el('[data-close]').onclick=()=>dialog.close();
  let labels=new Map<string,string>(),queue:{ref:Ref;revision:number;component:string;speed:number;amplitude:number;name:string;duration:number}[]=[];
  const browse=document.createElement('section');
  browse.innerHTML='<h3>意味から材料を探す</h3><div class="knowledge-compose"><label>動作の意味<input data-find placeholder="腕を上げる、うなずく、挨拶…"></label><label>動作の段階<select data-level><option value="all">すべて</option><option value="primitive">基本操作</option><option value="motion">組み合わせた動作</option><option value="expression">表現・見本</option></select></label><button data-search>材料を検索</button></div><div data-results></div>';
  el('[data-definition]').previousElementSibling!.before(browse);
  const semanticUI=setupSemantic(browse,api,status,load,ref=>select(ref));
  let searchEpoch=0;
  el('[data-search]').onclick=act(async()=>{
    const ticket=++searchEpoch,found=await api('search',{query:el<HTMLInputElement>('[data-find]').value,abstraction:el<HTMLSelectElement>('[data-level]').value,limit:50});
    if(ticket!==searchEpoch)return;
    const target=el('[data-results]');target.replaceChildren();
    for(const item of found.items)target.append(button(`${item.name} · ${item.abstraction==='primitive'?'基本操作':item.abstraction==='motion'?'組み合わせ':'表現'} v${item.ref.version}`,()=>select(item.ref)));
    if(!found.items.length)target.append(line('該当する動作はありません。別の意味で検索できます。'));
  });
  const label=(id:string)=>labels.get(id)??id;
  void api('ontology').then(data=>{
    labels=new Map(data.nodes.map((n:any)=>[n.id,n.label]));
    const panel=el('[data-ontology]');panel.append(line(data.coordinates),line(data.scope));
    for(const kind of ['bodyPart','intent','action','phase']){
      const group=document.createElement('div');group.className='knowledge-concepts';
      for(const n of data.nodes.filter((n:any)=>n.kind===kind)){const card=document.createElement('div');card.className='knowledge-concept';card.append(line(n.label));const small=document.createElement('small');small.textContent=[n.id,...(n.aliases??[]).slice(0,4)].join(' · ');card.append(small);const relations=data.edges.filter((e:any)=>e.from===n.id&&e.relation==='isA').map((e:any)=>label(e.to));if(relations.length)card.append(line('上位概念 → '+relations.join('、')));group.append(card);}panel.append(group);
    }
  }).catch(e=>report(e.message,true));
  function drawQueue(){
    const target=el('[data-queue]');target.replaceChildren();if(!queue.length)target.append(line('上の部品一覧から「追加」で選びます。別の動作に切り替えても部品は保持します。'));
    queue.forEach((q,i)=>{const row=document.createElement('div');row.className='knowledge-component';row.append(line(`${i+1}. ${q.name} · ${q.duration.toFixed(2)}秒 · ${q.ref.id}@${q.ref.version} / ${q.component}`));
      for(const [key,label,min,max] of [['speed','速度倍率',.25,3],['amplitude','開始姿勢からの変位倍率',.1,2]] as const){const wrap=document.createElement('label');wrap.textContent=label;const value=document.createElement('input');value.type='number';value.min=String(min);value.max=String(max);value.step='.05';value.value=String(q[key]);value.onchange=()=>q[key]=Number(value.value);wrap.append(value);row.append(wrap);}
      row.append(button('上へ',()=>{if(i){[queue[i-1],queue[i]]=[queue[i],queue[i-1]];drawQueue();}}),button('外す',()=>{queue.splice(i,1);drawQueue();}));target.append(row);});
  }
  drawQueue();
  const derive=()=>api('derive',{name:el<HTMLInputElement>('[data-name]').value,meanings:el<HTMLInputElement>('[data-meanings]').value.split(/[,、]/).map(s=>s.trim()).filter(Boolean),mode:el<HTMLSelectElement>('[data-mode]').value,selections:queue.map(({ref,revision,component,speed,amplitude})=>({ref,revision,component,speed,amplitude}))});
  el('[data-derive]').before(button('組み立てて部品として保存',async()=>{
    const result=await derive(),saved=await api('save',{id:'composed-'+crypto.randomUUID(),expectedVersion:0,motion:result.motion});
    queue=[];drawQueue();await select(saved.ref);status('中間動作として保存しました。全体や構成部品を追加して、さらに上位の動作を作れます。');
  }));
  el('[data-derive]').onclick=act(async()=>{
    const result=await derive();
    load(result.motion);dialog.close();report('部品から編集案を作りました。「試演」で確認してから、新版を保存できます。');
  });
  let epoch=0;
  const trail:{ref:Ref;revision?:number}[]=[];
  async function select(ref:Ref,revision?:number,back=false){
    const current=++epoch;const data=await api('knowledge-inspect',{ref,...(revision?{revision}:{})});if(current!==epoch)return;
    await semanticUI.selected(ref,data);if(current!==epoch)return;
    if(!back)trail.push({ref,revision});
    const k=data.knowledge,target=el('[data-definition]');target.replaceChildren();
    const h=document.createElement('h4');h.textContent=`${data.name} · v${ref.version} / 定義 r${k.revision}`;
    if(trail.length>1)target.append(button('前の動作へ戻る',async()=>{trail.pop();const prev=trail.at(-1)!;await select(prev.ref,prev.revision,true);}));
    target.append(h,line(data.description),line('意図・意味 → '+k.definition.concepts.map(label).join('、')),line('由来：'+(k.source==='starter-authored'?'見本の制作定義':k.source==='metadata-derived'?'保存データから導出':'追加された定義')),line(k.definition.note));
    const conditions=document.createElement('details');const summary=document.createElement('summary');summary.textContent='適用条件';conditions.append(summary,...k.definition.conditions.map(line));target.append(conditions);
    for(const c of k.definition.components as Component[]){
      const row=document.createElement('div');row.className='knowledge-component';const title=document.createElement('strong');title.textContent=`${c.label} · ${c.from.toFixed(2)}–${c.to.toFixed(2)}秒`;
      row.append(title,line('使用部位 → '+c.bodyParts.map(label).join('、')));
      const details=document.createElement('details'),s=document.createElement('summary');s.textContent='意味と再利用条件';details.append(s,line(c.concepts.map(label).join('、')||'部品単体の意味は未定義'),...c.requires.map(line),...c.effects.map(line));row.append(details);
      row.append(button('この部品を追加',()=>{queue.push({ref:{...ref},revision:k.revision,component:c.key,speed:1,amplitude:1,name:data.name+' / '+c.label,duration:c.to-c.from});drawQueue();status(c.label+'を部品列に追加しました。');}));target.append(row);
    }
    if(data.derivation){const source=document.createElement('section');source.append(line('構成を一段下までたどる（基本操作まで繰り返し開けます）'));
      for(const [i,s] of data.derivation.selections.entries())source.append(button(`${i+1}. ${s.ref.id}@${s.ref.version} / ${s.component} を開く`,()=>select(s.ref,s.revision)));
      target.append(source);
    }
    const graph=document.createElement('details'),gs=document.createElement('summary');gs.textContent='グラフの関係と派生元';graph.append(gs);
    const names=new Map(data.nodes.map((n:any)=>[n.id,n.label]));const rel:Record<string,string>={partOf:'の一部',usesBodyPart:'使用部位',intendedMeaning:'意図',describedAs:'概念',usesVersion:'固定元',derivedFrom:'派生元',instantiates:'意味付き操作',usesPose:'開始姿勢の元'};
    for(const e of data.edges)graph.append(line(`${names.get(e.from)??label(e.from)} → ${rel[e.relation]??e.relation} → ${names.get(e.to)??label(e.to)}`));target.append(graph);
    const edit=document.createElement('details'),es=document.createElement('summary');es.textContent='定義を編集';const json=document.createElement('textarea');json.rows=12;json.value=JSON.stringify(k.definition,null,2);json.setAttribute('aria-label','意味と部品の定義JSON');edit.append(es,line('conceptsはオントロジーのID、bodyPartsは身体グループのIDです。時間区間・使用条件を編集できます。保存すると定義の新版を作ります。'),json,button('定義の新版を保存',async()=>{await api('knowledge-define',{ref,expectedRevision:k.revision,definition:JSON.parse(json.value)});await select(ref);status('定義の新版を保存しました。選択済み部品は元の定義版を維持します。');}));target.append(edit);
  }
  return {select,open:()=>dialog.showModal()};
}
