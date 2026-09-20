import { Viewer } from './viewer.ts';
import { BODY, PROFILE, type Motion, type Saved, type Ref, type Score, type Pose } from './model.ts';
import { compile, sample, type Timeline } from './motion.ts';
import { PlaybackBuffer } from './playback-buffer.ts';
import { setupChat } from './chat-browser.ts';
import { CurveEditor } from './curve-editor.ts';
import { expressionLabels, type ExpressionFrame } from './expression.ts';
import { setupKnowledge } from './knowledge-browser.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const message = (text: string, error = false) => { $('message').textContent = text; $('message').classList.toggle('error', error); };
async function api<T = any>(operation: string, input: unknown = {}): Promise<T> {
  const response = await fetch(`/api/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error?.message ?? response.statusText); return value;
}
function task(work: () => Promise<void> | void) { return () => { try { void Promise.resolve(work()).catch(e => message(e.message, true)); } catch (e) { message((e as Error).message, true); } }; }
const viewer = new Viewer($('stage'), $('model-status'));
let draft: Motion = newScore(), revision = 0, draftSession = 0, selectionEpoch = 0;
let saving = false, savedIdentity: Ref | null = null, timeline: Timeline | null = null, live = true;
const cache = new Map<string, Saved>(), key = (ref: Ref) => `${ref.id}@${ref.version}`;
const curve = new CurveEditor(viewer, (motion, time) => {
  draft = motion; changed(); timeline = compile(draft, ref => cache.get(key(ref))!);
  live = false; viewer.setPose(sample(timeline, time).pose);
  $<HTMLInputElement>('scrub').max = String(timeline.duration); $<HTMLInputElement>('scrub').value = String(time);
  $('scrub-time').textContent = time.toFixed(2) + ' s'; $('duration').textContent = timeline.duration.toFixed(2) + ' s'; $('view-mode').textContent = '軌跡を編集中';
}, message);
function mode(value: 'chat' | 'motion') {
  document.body.dataset.mode = value; viewer.mode(value);
  $('mode-chat').classList.toggle('active', value === 'chat'); $('mode-motion').classList.toggle('active', value === 'motion');
  $('stage-title').textContent = value === 'chat' ? 'エンバー' : draft.name;
  if (value === 'chat') live = true; else { curve.set(draft, timeline);void search().catch(e=>message(e.message,true)); }
  viewer.showPalms(value==='motion'&&$<HTMLInputElement>('show-palms').checked);
}
$('mode-chat').onclick = () => mode('chat');
$('mode-motion').onclick = () => mode('motion');
setupChat(api, message, () => { live = true; });
const knowledgeUI=setupKnowledge(api,message,motion=>{
  rememberDraft();draftSession++;draft=motion;savedIdentity=null;$<HTMLInputElement>('save-id').value='derived-'+Date.now();changed();renderDraft();$('stage-title').textContent=motion.name;mode('motion');
});
for(const [name,label] of Object.entries(expressionLabels)){const option=document.createElement('option');option.value=name;option.textContent=label;$('expression-name').append(option);}
$('expression-preview').addEventListener('click',task(async()=>{
  await api('expression',{name:$<HTMLSelectElement>('expression-name').value,intensity:Number($<HTMLInputElement>('expression-intensity').value),hold:6});
}));
$('expression-intensity').addEventListener('input',()=>{$('expression-strength').textContent=Math.round(Number($<HTMLInputElement>('expression-intensity').value)*100)+'%';});
$('show-palms').addEventListener('change',()=>viewer.showPalms($<HTMLInputElement>('show-palms').checked));
$('auto-blink').addEventListener('change',()=>{viewer.blinking=$<HTMLInputElement>('auto-blink').checked;});
function newScore(): Score { return { kind: 'score', profile: PROFILE, name: '新しい挨拶', meanings: ['挨拶', '紹介'], context: '同梱VRM・固定立位・正面', source: 'V3で見本の固定版から構成', license: 'Source clip terms apply', parts: [] }; }
function changed() {
  revision++; timeline = null;
  if (!live) $('view-mode').textContent = '変更前の静止確認';
  $('save-state').textContent = '未保存の編集案'; $('duration').textContent = '未検証';
  $('json').textContent = ''; $<HTMLTextAreaElement>('json').value = JSON.stringify(draft, null, 2);
}
function syncMetadata() {
  draft.name = $<HTMLInputElement>('draft-name').value;
  draft.meanings = $<HTMLInputElement>('meanings').value.split(/[,、]/).map(s => s.trim()).filter(Boolean);
  draft.context = $<HTMLTextAreaElement>('context').value;
  changed();
}
for (const id of ['draft-name', 'meanings', 'context']) $(id).addEventListener('input', syncMetadata);
function button(label: string, action: () => void | Promise<void>, cls = '') {
  const b = document.createElement('button'); b.textContent = label; b.className = cls; b.addEventListener('click', task(action)); return b;
}
const restore = button('前の編集案', () => {
  const previous = sessionStorage.getItem('ember-previous-draft'); if (!previous) return;
  const value = JSON.parse(previous) as { motion: Motion; identity: Ref | null; id: string };
  rememberDraft(); draft = value.motion; savedIdentity = value.identity; $<HTMLInputElement>('save-id').value = value.id;
  draftSession++; changed(); curve.set(draft, null, true); renderDraft(); $('stage-title').textContent = draft.name;
  message('前の編集案を復元しました。');
}, 'small');
restore.hidden = !sessionStorage.getItem('ember-previous-draft'); $('new-draft').before(restore);
function rememberDraft() {
  sessionStorage.setItem('ember-previous-draft', JSON.stringify({ motion: draft, identity: savedIdentity, id: $<HTMLInputElement>('save-id').value })); restore.hidden = false;
}
function addToScore(value: Saved) {
  if (draft.kind !== 'score') { rememberDraft(); draftSession++; draft = newScore(); savedIdentity = null; $<HTMLInputElement>('save-id').value = 'my-motion'; }
  if (value.motion.kind === 'clip') draft.parts.push({ key: 'part-' + crypto.randomUUID().slice(0, 8), ref: { ...value.ref }, from: 0, to: value.motion.duration, speed: 1, transition: .6 });
  else draft.parts.push(...value.motion.parts.map(part => ({ ...structuredClone(part), key: 'part-' + crypto.randomUUID().slice(0,8) })));
  changed(); renderDraft(); $('stage-title').textContent = draft.name; message('構成に追加しました。一覧の＋で次の動作を追加できます。');
}
function renderDraft() {
  $<HTMLInputElement>('draft-name').value = draft.name; $<HTMLInputElement>('meanings').value = draft.meanings.join(', '); $<HTMLTextAreaElement>('context').value = draft.context;
  $('parts').replaceChildren();
  if (draft.kind === 'clip') {
    const text = document.createElement('p'); text.className = 'muted'; text.textContent = `見本クリップ · ${draft.duration.toFixed(2)}秒 · ${Object.keys(draft.tracks).length}軸。曲線または3D軌跡の点をドラッグして編集できます。`; $('parts').append(text);
  } else if (!draft.parts.length) {
    const text = document.createElement('p'); text.className = 'muted'; text.textContent = 'ライブラリから動作を追加してください。'; $('parts').append(text);
  } else draft.parts.forEach((part, index) => {
    const row = document.createElement('div'); row.className = 'part';
    const title = document.createElement('div'); title.className = 'part-title';
    const name = document.createElement('strong'); name.textContent = `${index + 1}. ${cache.get(key(part.ref))?.motion.name ?? part.ref.id}`; title.append(name);
    title.append(button('↑', () => { if (draft.kind !== 'score' || index === 0) return; [draft.parts[index - 1], draft.parts[index]] = [draft.parts[index], draft.parts[index - 1]]; changed(); renderDraft(); }, 'small'));
    title.append(button('×', () => { if (draft.kind === 'score') { draft.parts.splice(index, 1); changed(); renderDraft(); } }, 'small'));
    const ref = document.createElement('div'); ref.className = 'part-ref'; ref.textContent = `${key(part.ref)} · ${part.key}`;
    const fields = document.createElement('div'); fields.className = 'part-fields';
    for (const [field, label] of [['from', '開始（秒）'], ['to', '終了（秒）'], ['speed', '速度（倍）'], ['transition', '接続（秒）']] as const) {
      const wrap = document.createElement('label'); wrap.textContent = label;
      const input = document.createElement('input'); input.type = 'number'; input.step = '.05'; input.value = String(part[field]); input.min = field === 'speed' ? '.25' : field === 'transition' ? '.1' : '0';
      input.addEventListener('change', () => { part[field] = Number(input.value); changed(); }); wrap.append(input); fields.append(wrap);
    }
    row.append(title, ref, fields); $('parts').append(row);
  });
  $<HTMLTextAreaElement>('json').value = JSON.stringify(draft, null, 2);
  curve.set(draft, timeline);
}
async function ensureTimeline() {
  const current = revision, candidate = structuredClone(draft);
  const report = await api<{ duration: number }>('validate', { motion: candidate });
  if (candidate.kind === 'score') for (const part of candidate.parts) if (!cache.has(key(part.ref))) cache.set(key(part.ref), await api<Saved>('inspect', { ref: part.ref }));
  if (current !== revision) throw new Error('編集案が変わりました。もう一度操作してください。');
  timeline = compile(candidate, ref => { const source = cache.get(key(ref)); if (!source) throw new Error('Source missing'); return source; });
  renderDraft();
  $<HTMLInputElement>('scrub').max = String(report.duration); $('duration').textContent = `${report.duration.toFixed(2)} s`; return timeline;
}
async function select(ref: Ref) {
  const epoch = ++selectionEpoch;
  const value = await api<Saved & { reviews: { verdict: string; note: string }[] }>('inspect', { ref });
  if (value.motion.kind === 'score') for (const part of value.motion.parts) if (!cache.has(key(part.ref))) cache.set(key(part.ref), await api<Saved>('inspect', { ref: part.ref }));
  if (epoch !== selectionEpoch) return;
  cache.set(key(ref), value);
  if ($('save-state').textContent?.includes('未保存') && revision > 0) {
    // Opening another motion is explicit; keep a recoverable copy of the current draft.
    rememberDraft();
  }
  draftSession++; draft = structuredClone(value.motion); savedIdentity = { ...ref };
  $<HTMLInputElement>('save-id').value = ref.id; revision++; timeline = null;
  $('save-state').textContent = key(ref); $('stage-title').textContent = draft.name;
  timeline = compile(draft, source => cache.get(key(source)) ?? (() => { throw new Error('構成を検証して参照を読み込んでください。'); })());
  curve.set(draft, timeline, true); renderDraft();
  live = false; viewer.setPose(sample(timeline, 0).pose);
  $('view-mode').textContent = '編集案 · 静止確認';
  $<HTMLInputElement>('scrub').max = String(timeline.duration); $<HTMLInputElement>('scrub').value = '0';
  $('duration').textContent = timeline.duration.toFixed(2) + ' s'; $('scrub-time').textContent = '0.00 s';
  document.querySelectorAll('.motion-card').forEach(e => e.classList.toggle('selected', (e as HTMLElement).dataset.ref === key(ref)));
  const panel = $('selection'); panel.replaceChildren();
  const title = document.createElement('h3'); title.textContent = value.motion.name;
  const info = document.createElement('p'); info.textContent = `${key(ref)}\n${value.motion.context}\n${value.motion.source}`;
  const review = document.createElement('p'); review.textContent = value.reviews.length ? `評価記録 ${value.reviews.length}件（この版・身体・場面に限定）` : '人による採用評価は未記録';
  const actions = document.createElement('div'); actions.className = 'actions';
  actions.append(button('試演', async () => { await api('execute', { ref }); live = true; message('保存した版を試演しています。'); }));
  actions.append(button('構成に追加', () => addToScore(value)));
  const edit = button('この版を編集案へ', () => { draftSession++; draft = structuredClone(value.motion); savedIdentity = { ...ref }; $<HTMLInputElement>('save-id').value = ref.id; changed(); renderDraft(); });
  const notes = document.createElement('textarea'); notes.rows = 2; notes.placeholder = '試演で確認したこと・修正したいこと'; notes.setAttribute('aria-label', '評価メモ');
  const reviews = document.createElement('div'); reviews.className = 'actions';
  for (const [verdict, label] of [['accepted', 'この条件で採用'], ['rejected', '修正が必要']] as const) reviews.append(button(label, async () => {
    if (!notes.value.trim()) throw new Error('確認した内容を評価メモに記入してください。');
    await api('review', { ref, verdict, body: BODY, context: value.motion.context || '同梱VRM・固定立位', note: notes.value.trim() }); message('この版・身体・場面に評価を記録しました。'); await select(ref);
  }));
  const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = '出典と採用の記録'; details.append(summary, info, review, notes, reviews);
  panel.append(title, actions, edit, details);
  await knowledgeUI.select(ref);
  if(epoch===selectionEpoch)panel.append(button('意味・分解・部品を開く',()=>knowledgeUI.open()));
}
let searchEpoch = 0, nextOffset: number | null = null;
async function search(append = false) {
  const epoch = ++searchEpoch, query = $<HTMLInputElement>('search').value;
  const result = await api<{ items: { ref: Ref; name: string; kind: string; abstraction:string; meanings: string[] }[]; nextOffset: number | null }>('search', { query, offset: append ? nextOffset ?? 0 : 0 });
  if (epoch !== searchEpoch) return;
  if (!append) $('library-list').replaceChildren(); nextOffset = result.nextOffset;
  for (const item of result.items) {
    const card = button('', () => select(item.ref), 'motion-card'); card.dataset.ref = key(item.ref);
    const title = document.createElement('strong'); title.textContent = item.name;
    const meta = document.createElement('span'); meta.textContent = `${item.abstraction==='primitive'?'基本操作':item.abstraction==='motion'?'合成動作':item.kind === 'clip' ? '表現' : '構成'} · v${item.ref.version}`;
    const meaning = document.createElement('span'); meaning.className = 'tag'; meaning.textContent = item.meanings.slice(0, 3).join(' / ');
    card.title = item.meanings.join(' / '); card.append(title, meta, meaning);
    const row = document.createElement('div'); row.className = 'motion-row';
    const add = button('＋', async () => { const value = await api<Saved>('inspect', { ref: item.ref }); cache.set(key(item.ref), value); addToScore(value); }, 'row-add');
    add.setAttribute('aria-label', item.name + 'を構成に追加'); row.append(card, add); $('library-list').append(row);
  }
  $('library-count').textContent = `${$('library-list').children.length}件`; $('more').hidden = nextOffset === null;
  if (!$('library-list').children.length) message('一致する名前・意味タグがありません。短い言葉で検索してください。');
}
let searchTimer: ReturnType<typeof setTimeout>;
$('search').addEventListener('input', () => { searchEpoch++; clearTimeout(searchTimer); searchTimer = setTimeout(task(() => search()), 200); });
$('more').addEventListener('click', task(() => search(true)));
$('new-draft').addEventListener('click', () => { rememberDraft(); draftSession++; draft = newScore(); savedIdentity = null; $<HTMLInputElement>('save-id').value = 'my-motion'; changed(); curve.set(draft, null, true); renderDraft(); });
$('validate').addEventListener('click', task(async () => { await ensureTimeline(); message('曲線・区間・固定参照を確認しました。見た目の採用は試演で判断してください。'); }));
$('preview').addEventListener('click', task(async () => { await ensureTimeline(); await api('play', { motion: structuredClone(draft) }); live = true; message('未保存の編集案を試演しています。'); }));
$('save').addEventListener('click', task(async () => {
  if (saving) return;
  const snapshot = structuredClone(draft), current = revision, session = draftSession, id = $<HTMLInputElement>('save-id').value, expectedVersion = savedIdentity?.id === id ? savedIdentity.version : 0;
  saving = true; $<HTMLButtonElement>('save').disabled = true;
  try {
    const saved = await api<Saved>('save', { id, expectedVersion, motion: snapshot }); cache.set(key(saved.ref), saved);
    // Preserve edits made while the save was in flight; they build on this new version.
    if (draftSession === session && $<HTMLInputElement>('save-id').value === id) {
      savedIdentity = saved.ref;
      $('save-state').textContent = revision === current ? `${key(saved.ref)} を候補として保存` : `${key(saved.ref)} を保存。その後の編集は未保存です。`;
    }
    message('新版を保存しました。元の版と採用記録は保持されています。'); await search();
  } finally { saving = false; $<HTMLButtonElement>('save').disabled = false; }
}));
$('apply-json').addEventListener('click', task(async () => {
  const current = revision, text = $<HTMLTextAreaElement>('json').value, motion = JSON.parse(text) as Motion;
  await api('validate', { motion });
  if (revision !== current || $<HTMLTextAreaElement>('json').value !== text) throw new Error('編集案が変わりました。もう一度反映してください。');
  draft = motion; changed(); renderDraft(); message('JSONを未保存の編集案へ反映しました。');
}));
$('import-file').addEventListener('change', task(async () => {
  const file = $<HTMLInputElement>('import-file').files?.[0]; if (!file) return;
  if (file.size > 2_000_000) throw new Error('2 MB以下のJSONを選んでください。');
  const current = revision, text = await file.text();
  if (revision !== current) throw new Error('読み込み中に編集案が変わりました。もう一度選んでください。');
  $<HTMLTextAreaElement>('json').value = text; message('JSONを読み込みました。「編集案へ反映」で検証・適用できます。');
}));
$('export').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `${$<HTMLInputElement>('save-id').value || 'motion'}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
let scrubEpoch = 0;
$('scrub').addEventListener('input', task(async () => {
  const epoch = ++scrubEpoch, t = Number($<HTMLInputElement>('scrub').value), compiled = timeline ?? await ensureTimeline();
  if (epoch !== scrubEpoch) return; live = false; viewer.setPose(sample(compiled, t).pose); curve.seek(t); $('scrub-time').textContent = `${t.toFixed(2)} s`; $('view-mode').textContent = '編集案 · 静止確認';
}));
$('live').addEventListener('click', () => { live = true; });
document.querySelectorAll('[data-camera]').forEach(b => b.addEventListener('click', () => viewer.view((b as HTMLElement).dataset.camera as 'front')));
type Frame = { time: number; pose: Pose; expression?:ExpressionFrame; run: { id: string; name: string; status: string } | null; occurrence: string; elapsed: number; duration: number };
let latestFrame:Frame|undefined;
const playback=new PlaybackBuffer();
const events = new EventSource('/api/events');
events.onopen = () => { $('connection').textContent = '● 接続済み'; $('connection').classList.add('connected'); };
events.onerror = () => { $('connection').textContent = '再接続中'; $('connection').classList.remove('connected'); };
events.onmessage = event => {
  const frame = JSON.parse(event.data) as Frame;
  latestFrame=frame;playback.push(frame,performance.now());
  if(frame.expression){viewer.setExpression(frame.expression.weights,frame.time);$('expression-current').textContent=expressionLabels[frame.expression.name];}
  $('run-name').textContent = frame.run?.name ?? '待機';
  const states: Record<string, string> = { running: '再生中', completed: '完了', interrupted: '切り替え', stopped: '停止済み' };
  $('run-state').textContent = frame.run ? `${states[frame.run.status]} · ${frame.elapsed.toFixed(1)} / ${frame.duration.toFixed(1)} s${frame.occurrence.includes('transition') ? ' · 接続中' : ''}` : document.body.dataset.mode === 'chat' ? '会話に合わせて身振りを添えます' : '動作を選んで試演できます';
  $<HTMLButtonElement>('stop').disabled = frame.run?.status !== 'running';
  if (live && document.body.dataset.mode === 'motion' && timeline && frame.run?.name === draft.name) {
    const t = Math.max(0,Math.min(timeline.duration,frame.elapsed-(frame.duration-timeline.duration)));
    $<HTMLInputElement>('scrub').value = String(t); $('scrub-time').textContent = t.toFixed(2) + ' s'; curve.seek(t);
  }
};
$('stop').addEventListener('click', task(async () => { const run = latestFrame?.run; if (run) { await api('stop', { runId: run.id }); live = true; } }));
let previous = performance.now();
function render(now: number) {
  const frame=playback.sample(now);
  if (live && frame) {
    $('view-mode').textContent = 'ライブ表示';
    viewer.setPose(frame.pose);
  }
  viewer.render(Math.min(.05, (now - previous) / 1000)); previous = now; requestAnimationFrame(render);
}
requestAnimationFrame(render);
renderDraft(); void search().catch(e => message(e.message, true));
