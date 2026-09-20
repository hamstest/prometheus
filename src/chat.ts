import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { agentRequestSchema, reactionSchema, type ConversationEngine, type Reply } from './codex.ts';
import { Service } from './api.ts';
import { BODY, MotionError, type Clip, type Saved } from './model.ts';
import { compile, Player } from './motion.ts';
import { deriveSchema } from './knowledge.ts';
import { expressionNames } from './expression.ts';
import { compactCatalog, MotionWorkspace, CATALOG_LIMIT } from './agent-motion.ts';
import { semanticSearch, semanticInspect, semanticBuildSchema } from './semantic.ts';

const idSchema = z.object({ id: z.string().uuid() }).strict();
const sendSchema = z.object({ id: z.string().uuid(), requestId: z.string().uuid(), text: z.string().trim().min(1).max(8000), model: z.string().min(1).max(100) }).strict();
export class Chat {
  private active = new Map<string, AbortController>();
  private closed = false;
  private engine: ConversationEngine;
  private service: Service;
  constructor(service: Service, engine: ConversationEngine) {
    this.service = service; this.engine = engine;
    this.db.exec(`CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,title TEXT NOT NULL,updatedAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,conversation TEXT NOT NULL,requestId TEXT NOT NULL,role TEXT NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL,motion TEXT,createdAt TEXT NOT NULL,UNIQUE(requestId,role));
      UPDATE messages SET status='failed',text='アプリが終了したため返答を完了できませんでした。' WHERE status='pending';`);
    if(!this.db.prepare('PRAGMA table_info(messages)').all().some(row=>row.name==='expression'))this.db.exec('ALTER TABLE messages ADD COLUMN expression TEXT');
    if(!this.db.prepare('PRAGMA table_info(messages)').all().some(row=>row.name==='knowledgeTrace'))this.db.exec('ALTER TABLE messages ADD COLUMN knowledgeTrace TEXT');
    if(!this.db.prepare('PRAGMA table_info(messages)').all().some(row=>row.name==='reaction'))this.db.exec('ALTER TABLE messages ADD COLUMN reaction TEXT');
  }
  private get db() { return this.service.library.db; }
  private inspect(id: string) {
    const conversation = this.db.prepare('SELECT * FROM conversations WHERE id=?').get(id);
    if (!conversation) throw new MotionError('NOT_FOUND', '会話が見つかりません。');
    return { ...conversation, messages: this.db.prepare('SELECT * FROM messages WHERE conversation=? ORDER BY id').all(id) };
  }
  async dispatch(operation: string, input: unknown): Promise<unknown> {
    if (this.closed) throw new Error('チャットは終了しました。');
    if (operation === 'status') return this.engine.status();
    if (operation === 'login') return this.engine.login();
    if (operation === 'list') return this.db.prepare('SELECT * FROM conversations ORDER BY updatedAt DESC').all();
    if (operation === 'new') {
      z.object({}).strict().parse(input); const id = randomUUID();
      this.db.prepare('INSERT INTO conversations VALUES (?,?,?)').run(id, '新しい会話', new Date().toISOString()); return this.inspect(id);
    }
    if (operation === 'read') return this.inspect(idSchema.parse(input).id);
    if (operation === 'cancel') { const { id } = idSchema.parse(input); this.inspect(id); this.active.get(id)?.abort(); return { cancelled: true }; }
    if (operation !== 'send') throw new MotionError('NOT_FOUND', 'Unknown chat operation');
    const a = sendSchema.parse(input); this.inspect(a.id);
    if (this.db.prepare('SELECT id FROM messages WHERE requestId=?').get(a.requestId)) throw new MotionError('VERSION_CONFLICT', 'この送信はすでに受け付けています。会話を再読込してください。');
    if (this.active.has(a.id)) throw new MotionError('VERSION_CONFLICT', 'この会話の返答を待ってください。');
    const abort = new AbortController(); this.active.set(a.id, abort);
    const now = new Date().toISOString();
    const insert = this.db.prepare('INSERT INTO messages(conversation,requestId,role,text,status,createdAt) VALUES (?,?,?,?,?,?)');
    insert.run(a.id, a.requestId, 'user', a.text, 'completed', now); insert.run(a.id, a.requestId, 'assistant', '', 'pending', now);
    this.db.prepare("UPDATE conversations SET title=CASE WHEN title='新しい会話' THEN ? ELSE title END,updatedAt=? WHERE id=?").run(a.text.slice(0, 30), now, a.id);
    const workspace=new MotionWorkspace(this.service.library);
    try {
      const history = this.db.prepare("SELECT role,text,motion FROM messages WHERE conversation=? AND status='completed' ORDER BY id DESC LIMIT 40").all(a.id).reverse() as { role: string; text: string;motion:string|null }[];
      const messages=history.map(m=>({role:m.role,text:m.text+(m.motion?'\n'+JSON.stringify({associatedMotion:JSON.parse(m.motion)}):'')}));
      let catalog:ReturnType<typeof compactCatalog>=[];
      const available=new Map<string,Saved['ref']>();
      for(const m of history)if(m.motion){const {ref}=JSON.parse(m.motion);available.set(`${ref.id}@${ref.version}`,ref);}
      const inspected=new Set<string>(),trace:{operation:string;summary:string}[]=[];
      const knownOperations=new Set<string>(),inspectedOperations=new Set<string>();
      const responseSchema=z.object({reaction:reactionSchema,unavailable:z.string().trim().min(1).max(1500).nullable(), text: z.string().trim().max(12000), motion: z.string().nullable(),expression:z.object({name:z.enum(expressionNames),intensity:z.number().min(0).max(1)}).strict(),request:agentRequestSchema.nullable().optional() }).strict();
      let reaction:Reply['reaction']|undefined,materialSearch=false,constructionAttempted=false;
      const remember=()=>this.db.prepare("UPDATE messages SET knowledgeTrace=?,reaction=? WHERE requestId=? AND role='assistant'").run(JSON.stringify(trace),reaction?JSON.stringify(reaction):null,a.requestId);
      const continueWith=(message:string,step:number)=>{
        messages.push({role:'user',text:JSON.stringify({hostKnowledgeResult:{error:message,reaction},remainingSteps:23-step})});
        trace.push({operation:'continue',summary:message});remember();
      };
      let result:Reply|undefined;
      for(let step=0;step<24;step++){
        const reply=responseSchema.parse(await this.engine.reply(messages,catalog,a.model,abort.signal));
        abort.signal.throwIfAborted();
        if(!reaction){reaction=reply.reaction;trace.push({operation:'reaction',summary:`${reaction.kind==='motion'?'身体動作が必要':reaction.kind==='expression'?'表情で反応':'文章で応答'}：${reaction.reason}`});remember();}
        if(reply.reaction.kind!==reaction.kind){continueWith('最初に判断した反応を保ってください。候補がないことを理由に身体動作を不要へ変更できません。',step);continue;}
        if(!reply.request){
          if(!reply.text.trim())throw new Error('返答が空です。');
          if(reaction.kind==='motion'&&!reply.motion){
            if(reply.unavailable&&materialSearch&&(constructionAttempted||inspected.size>0||inspectedOperations.size>0)){result=reply;break;}
            continueWith('身体動作が必要ですが再生する候補がありません。完成動作を検索し、見つからなければ目標を分解して基本操作を検索・確認し、deriveまたはsemantic-buildで作成してください。実行せずに「動きます」と返答して終わらないでください。',step);continue;
          }
          if(reaction.kind!=='motion'&&reply.motion){continueWith('文章・表情だけの判断では身体動作を指定しないでください。',step);continue;}
          if(reply.motion&&reply.unavailable){continueWith('実行する候補と実行できない理由が矛盾しています。結果を確認してください。',step);continue;}
          result=reply;break;
        }
        const request=reply.request;
        let output:unknown;
        try {
          const args=JSON.parse(request.arguments);
          if(reaction.kind!=='motion'&&['derive','semantic-build'].includes(request.operation))throw new Error('文章・表情だけで応答する判断では身体動作を作成できません。');
          if(request.operation==='semantic-search'){
            materialSearch=true;
            const found=semanticSearch(args);for(const item of found.items)knownOperations.add(item.key);
            output=found;trace.push({operation:request.operation,summary:`「${args.query??''}」から意味付き操作${found.items.length}件（IDと説明のみ）`});
          }else if(request.operation==='semantic-inspect'){
            if(!knownOperations.has(`operation:${args.id}@${args.version??1}`))throw new Error('先にsemantic-searchか保存動作の定義から操作IDを取得してください。');
            const found=semanticInspect(args);inspectedOperations.add(`${found.id}@${found.version}`);output=found;
            trace.push({operation:request.operation,summary:`${found.name}：方向の基準、角度・速度・時間・保持・復帰の意味を取得`});
          }else if(request.operation==='semantic-build'){
            constructionAttempted=true;
            const parsed=semanticBuildSchema.parse(args);
            if(!inspectedOperations.has(`${parsed.id}@${parsed.version}`))throw new Error('先にsemantic-inspectでパラメーターの意味を取得してください。');
            if(parsed.base&&![...inspected].some(k=>k.startsWith(`${parsed.base!.ref.id}@${parsed.base!.ref.version}#`)))throw new Error('開始姿勢の元をknowledge-inspectで取得してください。');
            const made=workspace.semantic(parsed);available.set(`${made.ref.id}@${made.ref.version}`,made.ref);output=made;
            trace.push({operation:request.operation,summary:`${made.name}：${made.parameters.angleDeg}度・片道${made.parameters.durationSec.toFixed(2)}秒で作成`});
          }else if(request.operation==='derive'){
            constructionAttempted=true;
            const parsed=deriveSchema.parse(args);
            if(parsed.selections.some(s=>!inspected.has(`${s.ref.id}@${s.ref.version}#${s.revision}`)))throw new Error('先にknowledge-inspectで使用する版と部品の条件を読んでください。');
            const derived=workspace.derive(parsed);output=derived;
            available.set(`${derived.ref.id}@${derived.ref.version}`,derived.ref);
            trace.push({operation:'derive',summary:`${derived.name}：${parsed.mode==='parallel'?'同時':'順番'}に${parsed.selections.length}部品を合成（${derived.duration.toFixed(2)}秒）。次の合成にも再利用できます。`});
          }else if(request.operation==='knowledge-search'){
            if(args.abstraction==='primitive')materialSearch=true;
            const found=this.service.knowledge.search({...args,limit:Math.min(args.limit??CATALOG_LIMIT,CATALOG_LIMIT)});
            catalog=compactCatalog(found.items);
            for(const item of found.items)if(catalog.some(c=>c.key===`${item.ref.id}@${item.ref.version}`))available.set(`${item.ref.id}@${item.ref.version}`,item.ref);
            output={items:catalog,nextOffset:catalog.length<found.items.length?(args.offset??0)+catalog.length:found.nextOffset};
            if(!catalog.length&&reaction.kind==='motion'){
              const alternatives=semanticSearch({query:''}).items;for(const item of alternatives)knownOperations.add(item.key);
              output={...output as object,nextAction:'完成した動作がなくても、必要な部位と順序に分解して基本操作を探し、既存の部品または下記の意味付き操作から候補を組み立ててください。操作の数値はsemantic-inspectで取得できます。',operations:alternatives};
            }
            trace.push({operation:request.operation,summary:`「${args.query??''}」から${catalog.length}件（IDと説明のみ）。${found.items.slice(0,4).map(i=>i.name).join('、')}`});
          }else if(request.operation==='knowledge-inspect'){
            if(!available.has(`${args.ref?.id}@${args.ref?.version}`))throw new Error('先に検索または親の構成から固定版を取得してください。');
            if(![...workspace.drafts.values()].some(r=>r.id===args.ref.id))this.service.knowledge.ensure(args.ref);
            workspace.import(args.ref);
            const found=workspace.knowledge.inspect(args),k=found.knowledge;
            if(JSON.stringify(found).length>60000)throw new Error('定義が会話で取得できる量を超えています。編集画面で定義を整理してください。');
            inspected.add(`${k.ref.id}@${k.ref.version}#${k.revision}`);
            for(const s of found.derivation?.selections??[])available.set(`${s.ref.id}@${s.ref.version}`,s.ref);
            if(found.semantic){knownOperations.add(`operation:${found.semantic.operation}@${found.semantic.version}`);if(found.semantic.base)available.set(`${found.semantic.base.ref.id}@${found.semantic.base.ref.version}`,found.semantic.base.ref);}
            output={name:found.name,description:found.description,abstraction:found.abstraction,ref:k.ref,revision:k.revision,concepts:k.definition.concepts,conditions:k.definition.conditions,components:k.definition.components.map(c=>({...c,requires:c.requires.filter(r=>!k.definition.conditions.includes(r))})),sources:found.derivation,semantic:found.semantic,parameterAccess:'motion-parametersで部品とチャンネルを指定すると曲線の数値を取得できます。semanticがある動作はsemantic-inspect→semantic-buildで意味付きパラメーターを編集できます。'};
            trace.push({operation:request.operation,summary:`${found.name}：意味、使用部位、${k.definition.components.length}部品と使用条件を確認`});
          }else if(request.operation==='motion-parameters'){
            if(!inspected.has(`${args.ref?.id}@${args.ref?.version}#${args.revision}`))throw new Error('先にknowledge-inspectで定義を取得してください。');
            output=workspace.knowledge.parameters(args);trace.push({operation:request.operation,summary:`${args.ref.id} / ${args.component} の要求された曲線パラメータを取得`});
          }else output=this.service.dispatch('ontology',args);
        }catch(e){output={error:e instanceof Error?e.message:String(e)};trace.push({operation:request.operation,summary:e instanceof z.ZodError?'指定された概念・部位・条件を確認し直しています。':`修正が必要：${(output as {error:string}).error}`});}
        const encoded=JSON.stringify(output);
        messages.push({role:'assistant',text:JSON.stringify({request})},{role:'user',text:JSON.stringify({hostKnowledgeResult:encoded.length<=60000?output:{error:'結果が大きすぎます。部品・チャンネル・limitを絞ってください。'},remainingSteps:23-step})});
        remember();
      }
      if(!result)throw new Error('今回は再生できる動作候補を作れませんでした。動作は実行していません。部位・順序・速さなどを指定して修正できます。');
      abort.signal.throwIfAborted();
      let motion: {ref:Saved['ref'];name:string;candidate?:boolean}|null=null;
      if(result.motion&&workspace.drafts.has(result.motion)){
        const candidate=workspace.candidate(result.motion);
        const probe=new Player();probe.pose=structuredClone(this.service.player.pose);probe.play(compile(candidate,r=>this.service.library.get(r)),candidate.name,'preflight');
        const saved=workspace.commit(result.motion,'chat-'+a.requestId);motion={ref:saved.ref,name:saved.motion.name,candidate:true};
        trace.push({operation:'save',summary:`候補として保存：${saved.motion.name}（${saved.ref.id}@${saved.ref.version}）。人による採用評価は未記録。`});
      }else if(result.motion&&available.has(result.motion)){
        const ref=available.get(result.motion)!,saved=this.service.library.get(ref);
        const accepted=this.service.library.reviews(ref).filter(r=>r.body===BODY&&r.context===saved.motion.context).at(-1)?.verdict==='accepted';
        motion={ref,name:saved.motion.name,...((saved.motion.derivation||saved.motion.semantic)&&!accepted?{candidate:true}:{})};
      }
      if (result.motion !== null && !motion) throw new Error('返答の動作参照を検証できませんでした。再送してください。');
      if (motion) this.service.dispatch('execute', { ref: motion.ref });
      const expression=reaction!.kind==='chat'||result.unavailable?null:result.expression;
      if(expression)this.service.dispatch('expression',{...expression,hold:Math.max(4,Math.min(10,result.text.length*.075))});
      const responseText=result.unavailable?`今回は動作を実行できませんでした。${result.unavailable}`:motion?.candidate?`${result.text}\n\n既存の部品・操作から作った候補を試演しています。${result.text.includes('イメージに合っていますか')?'':'この動きはイメージに合っていますか？'}`:result.text;
      this.db.prepare("UPDATE messages SET text=?,status='completed',motion=?,expression=? WHERE requestId=? AND role='assistant'").run(responseText, motion ? JSON.stringify(motion) : null, expression?JSON.stringify(expression):null,a.requestId);
      trace.push({operation:'outcome',summary:motion?.candidate?'未確認の候補を試演し、利用者へ確認':motion?'保存済みの固定版を試演':result.unavailable?'候補を実行できず、理由を返答':reaction!.kind==='expression'?'表情だけで反応':'身体・表情を操作せず文章で応答'});remember();
    } catch (e) {
      if (!this.closed) this.db.prepare("UPDATE messages SET text=?,status=? WHERE requestId=? AND role='assistant'").run(abort.signal.aborted ? '返答を中止しました。' : e instanceof Error ? e.message : '返答を完了できませんでした。', abort.signal.aborted ? 'cancelled' : 'failed', a.requestId);
    } finally { workspace.close();this.active.delete(a.id); }
    return this.closed ? { cancelled: true } : this.inspect(a.id);
  }
  close() {
    if (this.closed) return; this.closed = true;
    for (const [id, abort] of this.active) { this.db.prepare("UPDATE messages SET status='cancelled',text='アプリの終了により返答を中止しました。' WHERE conversation=? AND status='pending'").run(id); abort.abort(); }
    this.engine.close();
  }
}
