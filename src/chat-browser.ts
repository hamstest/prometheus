import { expressionLabels, type ExpressionChoice } from './expression.ts';
type ChatMessage = { role: string; text: string; status: string; createdAt: string; motion?: string; expression?:string; knowledgeTrace?:string;reaction?:string };
type Conversation = { id: string; title: string; messages: ChatMessage[] };
export function setupChat(api: <T = any>(op: string, input?: unknown) => Promise<T>, report: (text: string, error?: boolean) => void, perform: () => void) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  let current: Conversation | null = null, connected = false, epoch = 0, sending: string | null = null;
  const act = (work: () => Promise<void>) => () => { void work().catch(e => report(e.message, true)); };
  function controls() { const busy = current?.id === sending || current?.messages.some(m => m.status === 'pending'); $<HTMLButtonElement>('chat-send').disabled = !connected || !!busy || !!sending; $('chat-cancel').hidden = !busy; }
  function draw() {
    $('chat-title').textContent = current?.title ?? '新しい会話'; $('messages').replaceChildren();
    if (!current?.messages.length) {
      const empty = document.createElement('div'); empty.className = 'chat-empty';
      empty.innerHTML = '<div class="empty-symbol">◈</div><h3>ひと息ついて、<br>話していきませんか。</h3><p>今日の出来事も、まだまとまらない考えも。<br>あなたの言葉から、はじめましょう。</p>';
      const suggestions = document.createElement('div'); suggestions.className = 'suggestions';
      for (const text of ['少し話を聞いて', '手を振って', '一緒に考えてほしい']) { const b = document.createElement('button'); b.textContent = text; b.onclick = () => { $<HTMLTextAreaElement>('chat-input').value = text; $('chat-input').focus(); }; suggestions.append(b); }
      empty.append(suggestions); $('messages').append(empty);
    } else for (const m of current.messages) {
      const row = document.createElement('article'); row.className = 'chat-message ' + m.role + ' ' + m.status;
      const avatar = document.createElement('div'); avatar.className = 'message-avatar'; avatar.textContent = m.role === 'user' ? '私' : 'E';
      const content = document.createElement('div'); content.className = 'message-content';
      const meta = document.createElement('span'); meta.className = 'message-meta'; meta.textContent = (m.role === 'user' ? 'あなた' : 'エンバー') + ' · ' + new Date(m.createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.textContent = m.status === 'pending' ? '考えています …' : m.text; content.append(meta, bubble);
      if (m.motion) { const motion = JSON.parse(m.motion), b = document.createElement('button'); b.className = 'motion-tag'; b.textContent = '↻ ' + motion.name + ' · v' + motion.ref.version+(motion.candidate?' · 確認用の候補':''); b.title='この会話で使った固定版をもう一度再生'; b.onclick = act(async () => { await api('execute', { ref: motion.ref });if(m.expression)await api('expression',JSON.parse(m.expression)); perform(); }); content.append(b); }
      if(m.expression){const face=JSON.parse(m.expression) as ExpressionChoice;if(face.name!=='neutral'){const b=document.createElement('button');b.className='motion-tag expression-tag';b.textContent=expressionLabels[face.name]+' · '+Math.round(face.intensity*100)+'%';b.onclick=act(async()=>{await api('expression',face);});content.append(b);}}
      if(m.knowledgeTrace){const trace=JSON.parse(m.knowledgeTrace) as {summary:string}[];if(trace.length){if(m.status==='pending')bubble.textContent='動作を検討しています …\n'+trace.at(-1)!.summary;const d=document.createElement('details'),s=document.createElement('summary');d.className='knowledge-trace';s.textContent='反応の判断・動作の作成記録';d.append(s);for(const entry of trace){const p=document.createElement('p');p.textContent=entry.summary;d.append(p);}content.append(d);}}
      row.append(avatar, content); $('messages').append(row);
    }
    $('messages').scrollTop = $('messages').scrollHeight; controls();
  }
  async function list() {
    const rows = await api<{ id: string; title: string }[]>('chat/list');
    $('conversations').replaceChildren();
    for (const row of rows) { const b = document.createElement('button'); b.className = 'conversation-row' + (row.id === current?.id ? ' selected' : ''); b.textContent = row.title; b.onclick = act(() => open(row.id)); $('conversations').append(b); }
    return rows;
  }
  async function open(id: string) { const version = ++epoch, value = await api<Conversation>('chat/read', { id }); if (epoch !== version) return; current = value; localStorage.setItem('ember-conversation', id); draw(); await list(); }
  async function create() { const version = ++epoch, value = await api<Conversation>('chat/new'); if (epoch !== version) return; current = value; localStorage.setItem('ember-conversation', value.id); draw(); await list(); }
  async function connect() {
    $('chat-status').textContent = 'Codex接続を確認中…';
    try {
      const state = await api<{ connected: boolean; models: { id: string; name: string }[] }>('chat/status'); connected = state.connected;
      const select = $<HTMLSelectElement>('chat-model'), previous = select.value || localStorage.getItem('ember-model'); select.replaceChildren();
      for (const m of state.models) { const option = document.createElement('option'); option.value = m.id; option.textContent = m.name; select.append(option); }
      if (state.models.some(m => m.id === previous)) select.value = previous!;
      else if (state.models.some(m => m.id === 'gpt-5.6-luna')) select.value = 'gpt-5.6-luna';
      $('chat-status').textContent = connected ? '● ChatGPT 接続済み' : 'ChatGPTログインが必要です'; $('chat-connect').textContent = connected ? '再接続' : 'ログイン'; $('login-link').hidden = connected || !$<HTMLAnchorElement>('login-link').hasAttribute('href');
    } catch (e) { connected = false; $('chat-status').textContent = (e as Error).message; }
    controls();
  }
  $('chat-connect').onclick = act(async () => {
    if ($('chat-connect').textContent === 'ログイン') { const result = await api<{ authUrl: string }>('chat/login'); const link = $<HTMLAnchorElement>('login-link'); link.href = result.authUrl; link.hidden = false; $('chat-connect').textContent = '再接続'; $('chat-status').textContent = 'リンクからログイン後、再接続してください'; }
    else await connect();
  });
  $('new-chat').onclick = act(create);
  $('chat-model').onchange = () => localStorage.setItem('ember-model', $<HTMLSelectElement>('chat-model').value);
  $('chat-cancel').onclick = act(async () => { if (current) await api('chat/cancel', { id: current.id }); });
  $('chat-form').onsubmit = event => {
    event.preventDefault();
    void (async () => {
      const input = $<HTMLTextAreaElement>('chat-input'), text = input.value.trim(); if (!text || !connected || sending || current?.messages.some(m => m.status === 'pending')) return;
      if (!current) { const before = epoch; await create(); if (epoch !== before+1) return; } const id = current!.id; sending = id; input.value = '';
      const now = new Date().toISOString(); current!.messages.push({ role: 'user', text, status: 'completed', createdAt: now }, { role: 'assistant', text: '', status: 'pending', createdAt: now }); draw();
      try { const result = await api<Conversation>('chat/send', { id, requestId: crypto.randomUUID(), text, model: $<HTMLSelectElement>('chat-model').value }); if (current?.id === id) { current = result; draw(); } perform(); await list(); }
      catch (e) { if (current?.id === id) await open(id); report((e as Error).message, true); }
      finally { sending = null; controls(); }
    })().catch(e => report(e.message, true));
  };
  $('chat-input').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $<HTMLFormElement>('chat-form').requestSubmit(); } };
  // Also recover completion after a reload or a response in another browser tab.
  let polling=false;
  setInterval(() => {
    if(polling||!current?.messages.some(m=>m.status==='pending'))return;
    const id=current.id,version=epoch;polling=true;
    void api<Conversation>('chat/read',{id}).then(value=>{if(current?.id===id&&epoch===version&&current.messages.some(m=>m.status==='pending')){current=value;draw();}}).catch(()=>{}).finally(()=>{polling=false;});
  }, 2000);
  draw(); void connect();
  void list().then(async rows => { const id = localStorage.getItem('ember-conversation'); if (rows.length) await open(rows.find(r => r.id === id)?.id ?? rows[0].id); }).catch(e => report(e.message, true));
}
