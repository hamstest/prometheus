# V3 操作API

サーバー起動後、`POST http://127.0.0.1:4319/api/{operation}` へJSONを送る。`state` と `capabilities` はGETでも取得できる。stdio MCPは同じ操作を `motion_{operation}` という名前で公開する。

`GET /api/capabilities` が入力JSON Schemaと座標・編集能力の正本。ブラウザ以外から使う場合も、まずこれを読む。初期化と改行区切りJSONの実装は [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) と [stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#stdio) に従う。公開しているMCP機能はtoolsのみ。

| 操作 | 入力・用途 |
|---|---|
| capabilities | `{}`。対応座標、編集能力、各入力Schema |
| search | `{query, offset?, limit?}`。オントロジーの別名・上位概念・段階・部位を使う意味検索。最大50件 |
| ontology | `{}`。身体・骨・意味・動作・段階の定義と型付きの関係 |
| semantic-search | `{query?}`。関連する意味付き操作のID@定義版と説明のみ |
| semantic-inspect | `{id,version?:1}`。操作の方向基準、パラメーターの単位・範囲・既定値、生成入力Schema |
| semantic-build | `{id,version:1,name?,parameters,base?}`。意味付きの角度・時間／平均速度から未保存クリップを生成。[詳細と入力例](semantic-operations.md) |
| knowledge-search | `{query?,concepts?,bodyParts?,abstraction?,includeRelated?,offset?,limit?}`。関連する最大8件・3,600 UTF-8バイト以内の`key`（ID@版）と`description`のみ |
| motion-parameters | `{ref,revision?,component,channels?,offset?,limit?}`。明示要求した部品・チャンネルの曲線境界をページ取得。速度・変位倍率の編集範囲も返す |
| knowledge-inspect | `{ref,revision?}`。意味、区間・身体部位の分解、関係グラフ、派生元、その版の評価 |
| knowledge-define | `{ref,expectedRevision,definition}`。動作の固定版に結び付く定義を新版として保存。旧定義は保持 |
| derive | `{name,meanings,description?,abstraction?,mode,selections,transition?}`。固定ref・revision・component・speed・amplitudeから抽出／合成。layoutに各部品の配置を残し、保存後は全体やelement-Nを次のderiveへ再利用可能 |
| inspect | `{ref:{id,version}}`。固定版の正本、SHA-256、出典とその版の評価 |
| validate | `{motion}`。保存せずに形式・曲線範囲・参照・区間を検査 |
| sample | `{motion,time}`。ライブ状態を変えず、候補の指定時刻を数値確認 |
| edit | `{motion:score,key,change}`。一つの使用箇所のref/from/to/speed/transitionを変更。未保存案を返す |
| save | `{id,expectedVersion,motion}`。新IDはexpectedVersion=0。新版は現在の最新版番号を指定 |
| review | `{ref,verdict,body,context,note}`。人が示した採否と理由をその版へ記録 |
| play | `{motion,transition?}`。未保存案を現在の状態から試演 |
| execute | `{ref,transition?}`。保存版を現在の状態から試演 |
| stop | `{runId}`。現在の実行だけを0.6秒で連続的に制動。古い実行への操作は409 |
| state | `{}`。姿勢、時計、実行ID、進捗と直近30件の完了・中断・停止履歴 |

HTTPの状態配信は `/api/events` のSSE。MCP自体のHTTP transportではない。サーバーはloopbackへバインドし、Host/Origin/Content-Typeを検査する。Tailscale Serve経由のHTTPS接続は`config/access.json`に列挙した正確なoriginだけを追加で許可する。任意のHost、別ポート、他のorigin、cross-site要求は拒否し、転送ヘッダーだけを根拠に許可しない。ブラウザーは相対URLでAPI・モデル・SSEへ接続する。MCP/CLIは引き続きloopbackへ接続する。

知識の定義・部品の指定例・版管理と合成の条件は[知識と部品](knowledge.md)を参照。`knowledge-define`の保存は人による採用評価ではない。`derive`の結果は通常の`validate / play / save`へ渡せる。

## 見本の登録

[register.json](../examples/register.json) はそのままsaveへ送れる。見本の各トラックは先頭0、末尾duration、単調増加する `{t,p,v,a}` の列。単位は秒・rad・rad/s・rad/s²。未指定のチャンネルにはcapabilitiesのrest値が入る。

意図しない瞬間的な停止を避けるため、速度・加速度は省略不可。手付けでも、途中の通過点を止めたいのか通過させたいのかを明示する。

現行の制限：見本0.02〜120秒、全16,000点まで、1トラック2,000点まで。構成は最大64区間・600秒。HTTP/stdioのJSONは2 MBまで。速度0.25〜3倍、接続0.1〜3秒。これらは運用上の処理予算・対応範囲であり、自然な動作の定義ではない。

## 区間の抽出と構成

```json
{
  "kind": "score",
  "profile": "vrm1-upper-body-xyz-v1",
  "name": "挨拶して紹介する",
  "meanings": ["挨拶", "紹介"],
  "context": "同梱VRM・固定立位・正面",
  "source": "greeting@1 と present@1 の区間",
  "license": "Project-local authored example",
  "parts": [
    {"key":"hello","ref":{"id":"greeting","version":1},"from":0.65,"to":2.1,"speed":1,"transition":0.6},
    {"key":"show","ref":{"id":"present","version":1},"from":0.8,"to":1.8,"speed":1,"transition":0.6}
  ]
}
```

partを一つだけ持つScoreが抽出した部品になる。保存したScoreを別の構成へ取り込む際は、partsを複製して使用箇所keyだけを新しくする。元のclipの版とfrom/toは固定のまま。ブラウザの「構成に追加」はこの展開を行う。

後続partのtransitionは直前区間との接続時間。最初の入口はplay/executeのtransitionで指定する（既定0.6秒）。隣接状態が一致する場合は区間間の接続を省く。ライブ再生終了時に速度が残る場合は制動が追加されるため、state.durationとvalidate.durationは異なる場合がある。

## 言葉による局所修正の例

利用者が「紹介するところだけ、もう少しゆっくり」と指示した場合、会話ホストはinspectで構成とkeyを確認し、`motion_edit` に構成全体と `key:"show", change:{speed:0.7}` を渡す。返ったmotionをplayし、確認後にsaveで新版を保存する。helloの速度、共有元のpresent@1、別作品の同じ部品は変わらない。

前腕・上腕のひねり、肘の曲げ伸ばし、頭の左右・上下、体幹のひねりは、`semantic-search → semantic-inspect → semantic-build` で意味付きパラメーターから生成できる。「肘を外へ」等の未定義の指示は自動的に関節修正へ翻訳できるとは扱わず、公開定義の方向基準と区別する。保存動作の生成時の値は`knowledge-inspect.semantic`から取得できる。

固定参照の取得失敗、未対応座標、範囲外の曲線、保存競合などは構造化エラーで返す。playは全区間と入口・制動を検査してから現在の実行を置き換える。保存で失敗した場合も旧版は保持する。

## 評価と履歴

reviewのacceptedは人の判定を記録するための値。エージェントの数値テスト結果を人の承認として保存しない。評価は追記であり、昔の判定も消さない。複数記録の表示は記録件数のみで、単一の普遍的な「習得済み」状態にまとめない。

実行の直近履歴はプロセス内。モーション固定版と評価は永続化する。実行ログの長期保存が必要になった時は、目的と記録量を確認して追加する。

## 表情

POST /api/expression : {"name":"happy","intensity":0.65,"hold":6}

name は neutral / happy / relaxed / surprised / sad / angry。intensity は0〜1（既定0.65）、holdは0〜60秒（既定6）。現在の表情から0.35秒で切り替え、保持後0.6秒で自然に戻す。骨格の保存版や実行中モーションは変更しない。/api/state と /api/events の expression に現在の名前・強さ・phase・weightsを含める。MCPにも共通の操作定義から expression 操作を提供する。

会話の完了メッセージには expression JSONを保存する。過去の表情のない履歴はそのまま読み込める。会話応答の表情名・強さ・動作固定参照を検証してから実行する。

## 会話の反応判断

`POST /api/chat/send {id,requestId,text,model}` はエージェントの `reaction:{kind,goal,reason}` を記録する。kindはchat（文章のみ）・expression（表情）・motion（身体動作）。初回に動作を一律検索せず、必要と判断した動作をエージェントが検索する。motion判定のまま未生成・未選択で最終返答しようとした場合は作成を続けるよう戻す。基本部品の検討後も対応できない場合の`unavailable`は、未実行の理由として表示する。

生成した動作は保存・実行に成功したものだけ`messages.motion`へ記録し、確認が必要なものは`candidate:true`を付ける。確認の問いはホストが付け、未採用の生成動作を再利用する場合も表示する。文章のみならmotionとexpressionはnullで、現在の実行や表情を変更しない。`messages.reaction`と`knowledgeTrace`は`chat/read`で作成中も取得できる。古いメッセージの新項目はnullで読み込める。
