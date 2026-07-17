# feat(collections): 外部データ (CSV) を実体とする read-only コレクション — DuckDB クエリエンジン

Date: 2026-07-17
背景: ベータユーザーのフィードバック「データさえあれば可視化が作れる。Tableau も Looker もいらないのでは」。
BI ツール代替のユースケース（学校の生徒管理、HR 系データの分析等）を、Collections の自然な拡張として取り込む。

## ゴール

ユーザーが外から持ち込んだデータファイル（まず CSV）を**取り込み（コピー/変換）せず**、その上に
コレクションを定義できるようにする。実体はユーザーの CSV のまま、DuckDB がクエリエンジンとして
間を繋ぐ。**BI 向け read-only と割り切る** — UI からの編集口は閉じ、更新は「CSV を差し替える」か
「Claude にファイル編集として頼む」経路に一本化する。

体験: ユーザーが CSV をワークスペースに置いて「これ管理したい」→ Claude が CSV を覗いてスキーマ
（列の型・意味・キー列）を推論し、コレクション定義を書く → 既存のコレクション UI / custom view /
リモートビューがそのまま使える。列の意味を会話で訂正すればコレクション定義が育つ（self-improving）。

## 方針（会話で確定済み）

1. **別物ではなく同一抽象** — 「データの束 + スキーマ + ビュー」概念を 2 系統併存させない。
   既存のファイル実体コレクションと外部データ実体コレクションは、ストレージ層の 2 実装。
   micro-package 化をやめて core に集約した流れ（plans/done/refactor-shared-core.md）と同じ判断。
2. **read-only と割り切る**（フェーズ1）— 書き込み系の難所（atomic write、O_EXCL 競合、mutate、
   spawn、draft、kanban 移動）が全部消え、capability は実質 `readonly` 1 個に縮退する。
   Tableau/Looker の「データソースは read-only、更新は上流で」というモデルとも一致。
3. **read-only ≠ データ不変** — 真実の源は CSV。ユーザー/Claude がファイルを更新すれば
   ビューが追随する（file watch → `publishCollectionChange`）。
4. **将来 UI 編集が欲しくなったら**、CSV ソースに書き込みを足すのではなく
   「ネイティブコレクションへの昇格（取り込み）」で応える。同一抽象だから 1 操作で済む。

## 現状マップ（実装の足場）

- **アイテム I/O は 4 関数に完全集約**: `listItems` / `readItem` / `writeItem` / `deleteItem`
  — `packages/core/src/collection/server/io.ts:72,105,152,199`。全呼び出し側（約15箇所）は
  `collection.dataDir` を渡すだけで、「実体が `<dataDir>/<itemId>.json`」を知るのは io.ts の中だけ。
  - 呼び出し側: `server/api/routes/collections.ts:165,241,285,315,455,501,926`、
    `server/workspace/collections/remoteView.ts:138,166,169,274`、
    `server/remoteHost/handlers/getCollection.ts:28` / `getFeed.ts:31`、
    core 内 `manageTool.ts` / `mutate.ts` / `derive.ts:64` / `dynamicIcon.ts:46` / `spawn.ts:236`、
    `packages/core/src/collection-watchers/reconciler.ts:26`。
- **`source` は名前が既に使われている**: `LoadedCollection.source: CollectionSource`
  （`"user" | "project" | "feed"`、`packages/core/src/collection/core/schema.ts:88`）は
  スキルの出どころの意味。→ 新フィールドは **`dataSource`** と命名して衝突回避。
- **スキーマ**: zod 定義 `packages/core/src/collection/core/schemaZ.ts:709-710`
  （`dataPath` / `primaryKey` 必須）。`dataPath` は `resolveDataDir`
  （`packages/core/src/collection/server/paths.ts:106`）で workspace 封じ込め検証。
- **行 ID の制約**: `safeRecordId`（`paths.ts:32`）— 英数/ハイフン/アンダースコア/内部ドットのみ、
  `..`・パス区切り不可。詳細ビュー URL・リモートビューの item 参照がこの ID を前提にする。
- **計算列**: `deriveItems`（`server/derive.ts`）は `listItems` の**結果**にメモリ上で適用
  → 行の出どころが CSV でもそのまま動く。
- **変更通知**: 書き込み → `publishCollectionChange`（`server/host.ts`）→ pub/sub
  `collection:<slug>` → ビュー再取得。CSV ソースでは書き込み契機がないので、
  **ファイル監視**からこのイベントを発行する必要がある（collection-watchers に足場あり）。
- **read-only の前例なし**: UI / manageTool / ルートは全コレクションを書き込み可能と仮定している。

## 設計

### schema.json 追加（最小）

```jsonc
{
  "dataSource": {              // 任意。無ければ従来どおり dataPath の JSON ファイル群
    "type": "csv",             //   v1 は csv のみ。将来: xlsx | json | parquet | sqlite
    "path": "data/students.csv", //   workspace 相対（resolveDataDir と同じ封じ込め検証）
    "key": "student_id"        //   行 ID に使う列。必須（Claude がスキーマ推論時に提案）
  }
}
```

`dataSource` があるコレクションは:
- 自動的に **read-only**（capability として summary / detail に載せ、UI が出し分け）
- `dataPath` は不要（zod で `dataSource` と `dataPath` は排他 or `dataSource` 優先を明示）
- `fields` は従来どおり宣言。CSV の列名 → フィールド名の対応はフィールド名一致を基本とする

### ストレージ抽象（io.ts の裏に 1 枚）

`CollectionStore` インターフェースを導入し、`storeFor(collection)` ファクトリで
ファイル実装 / DuckDB-CSV 実装を選ぶ:

```ts
interface CollectionStore {
  list(): Promise<CollectionItem[]>;
  read(itemId: string): Promise<CollectionItem | null>;
  readonly capabilities: { writable: boolean };
  // writable=true の store のみ:
  write?(itemId: string, item: CollectionItem, opts): Promise<WriteItemResult>;
  delete?(itemId: string): Promise<DeleteItemResult>;
}
```

- 既存 4 関数はファイル store の実装として残す（呼び出し側の移行は段階的でよい —
  `dataSource` 無しのコレクションは従来経路のまま動く）。
- 書き込み系ルート / manageTool / mutate / spawn は `capabilities.writable` を見て
  明確なエラー（HTTP 405 / MCP エラーメッセージ）を返す。**サーバー側で強制**
  （UI の出し分けだけに頼らない — singleton の refuseOverwrite と同じ思想）。

### DuckDB-CSV store（v1）

- `list()`: `SELECT * FROM read_csv('<path>')` → 列名→フィールドのマッピング → `CollectionItem[]`。
  `key` 列の値を `safeRecordId` に通し、通らない値の行はサニタイズ（後述 Open questions）。
- `read(id)`: `WHERE <key> = ?` の 1 行クエリ（プリペアドステートメント必須 — 文字列連結で SQL を組まない）。
- パス検証は `resolveDataDir` と同じ realpath 封じ込め（symlink 防御を含めて再利用）。
- 行数上限: v1 は `LIMIT`（例 5,000 行 + 超過 warn）。全件 materialize が前提の既存 UI を
  壊さないためのガード。大規模データは v2 の集計クエリで扱う（一覧ではなく集計を見せる）。

### 変更追随

- `dataSource.path` を collection-watchers の監視対象に追加 → 変更検知で
  `publishCollectionChange({ slug, op: "upsert" })`（全件再取得で十分、行差分は取らない）。
- CSV 差し替え → 開いているビューが自動更新、が受け入れ基準。

### 依存とパッケージ配置

- DuckDB は `@duckdb/node-api`（公式 Node バインディング）を **@mulmoclaude/core の server 専用
  サブパス**に置く（browser-safe surface に混ぜない）。プラグインからは core 経由（uphill 禁止）。
- ネイティブモジュールなので、npm launcher / Docker sandbox での install 検証が必要
  （→ Open questions。問題が出た検知/回避は `packages/core/assets/helps/error-recovery.md` に追記）。

## 実装ステップ

### v1（read-only CSV ソース）
1. `schemaZ.ts`: `dataSource` 追加（type/path/key、zod、`dataPath` との排他規則）。
2. `CollectionStore` 抽象 + ファイル store（既存 io.ts のラップ）+ `storeFor()`。
3. DuckDB-CSV store（list/read、プリペアドステートメント、封じ込め検証、行数ガード）。
   純関数部（列マッピング、行→ID 変換）は切り出してユニットテスト。
4. 書き込み経路の capability ガード（routes / manageTool / mutate / spawn / remoteView）
   — read-only コレクションへの write は 405 / 明確な MCP エラー。
5. UI: read-only コレクションで作成/編集/削除/kanban 操作を非表示（capability を summary に載せる）。
6. watcher: `dataSource.path` の変更 → `publishCollectionChange`。
7. スキーマ推論スキル: 「CSV を読んで dataSource 付き schema.json を提案する」レシピを
   collection 作成フローの help / skill に追記（キー列の提案を含む）。
8. テスト: store 差し替えのユニット + read-only ガードのハンドラテスト。
   e2e-live は既存 collections カテゴリに 1 シナリオ追加を検討。

### v2（BI の本丸: クエリ/集計）
- store にオプショナルな `query()`（集計）を追加。DuckDB store はネイティブ、
  ファイル store は非対応から始める。
- 集計結果を custom view のチャートに流す口（ダッシュボード as データ）。
- `LIMIT` ガードを「一覧はページング / 集計はフル」に置き換え。

### v3 以降（このプランのスコープ外、方向だけ記録）
- フォーマット追加: xlsx / json / parquet / sqlite（DuckDB 拡張で読める）。
- ネイティブコレクションへの昇格（取り込み）操作。
- メトリクス定義（セマンティックレイヤー）のワークスペース内ファイル化。

## Open questions / 注意

- **キー列の値が `safeRecordId` を通らない場合**（日本語名、スペース、記号）: 候補は
  (a) 行を落として warn、(b) エンコード（hex 化）した ID を使い表示は displayField、
  (c) キー列なし時は行ハッシュ。**(b) を推奨** — 日本語データ（生徒名簿等）が主要ユース
  ケースなので落とすのは論外、行番号はソートで壊れる。詳細ビュー URL の見た目は劣化するが
  displayField で吸収できる。
- **キー列の重複値**: DuckDB で `COUNT(*) GROUP BY key HAVING > 1` を discovery 時に検査し、
  重複があれば warn + 後勝ち（それとも discovery エラーにする?）。
- **ネイティブモジュール（DuckDB）の配布**: npm launcher（`npx mulmoclaude`）と Docker で
  prebuilt binary が落ちるか。落ちない環境向けに「dataSource コレクションだけ無効化して
  他は動く」graceful degradation にする（core 全体を巻き込まない dynamic import）。
- **文字コード**: 日本語 CSV は Shift_JIS がまだ現役。DuckDB は UTF-8 前提なので、
  推論時に Claude が検知して UTF-8 に変換して置き直すか、store 側で iconv するか。
- **derive / dynamicIcon との合流**: どちらも `listItems` 結果ベースなのでそのまま動く見込みだが、
  行数ガードと組み合わせたときの意味（5,000 行に切った上での集計は嘘になる）は v2 で整理。
- MulmoTerminal もコレクションデータを共有する（@mulmoclaude/core のバンプ・公開が必要 —
  version skew はクロスアプリのデータバグになる）。

## Out of scope（意図的に入れない）

- **UI からの書き込み**（CSV への UPDATE/INSERT）— read-only の割り切りが本プランの骨格。
  編集ニーズは「Claude にファイル編集を頼む」+ 将来の「ネイティブ昇格」で受ける。
- **外部 DB 接続**（Postgres/MySQL アタッチ）— DuckDB 拡張で技術的には可能だが、
  「workspace is the database」の外に真実の源を持つ話は別プランで。
- **チャートビルダー UI / ドリルダウン設計 UI** — BI ツールが「対話できない」ことの補償機能。
  会話 + custom view で代替するのが MulmoClaude の差別化。
- **ダッシュボードの共有/権限管理ポータル**。
