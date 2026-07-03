# feat(collections): dynamic collection icons based on data state

Date: 2026-07-02
Issue: #1900 (beta-feedback)

## ゴール

コレクションのショートカットアイコンを、**データの状態に応じて動的に切り替える**。
例: 天気予報コレクションのアイコンが最新予報（晴れ/雨/曇り）で変わる。

## 現状マップ（実装の足場）

- **アイコン定義**: `CollectionSchema.icon`（Material Symbols 名の**静的文字列**）
  — `packages/core/src/collection/core/schema.ts:367-368`。
  スキルフォルダ内 `schema.json` に保存（`server/paths.ts` / `discovery.ts`）。
- **配信**: `CollectionSummary.icon = collection.schema.icon`
  — `packages/core/src/collection/server/discovery.ts:937`。
- **描画**: `src/components/PluginLauncher.vue:70`
  `<span class="material-symbols-outlined">{{ shortcut.icon }}</span>`。
  `shortcut.icon` は `config/shortcuts.json` の**キャッシュ**（`src/composables/useShortcuts.ts`）で、
  **Collections index を開いた時の `reconcile()` でしか更新されない**（pub/sub 未購読）。
- **データ変更通知**: 書込み→`publishCollectionChange`→pub/sub `collection:<slug>`
  （`src/config/pubsubChannels.ts` の `collectionChannel`）→ ビューが再取得
  （`src/composables/collections/uiHost.ts:161` `subscribeChanges`）。
- **再利用できる述語評価**: `when` / `CollectionWhen`
  — `packages/core/src/collection/core/actionVisible.ts`（フィールド値の比較・条件が既にある）。
- **値→視覚トークンの前例**: enum値→色（`packages/core/src/collection/core/enumColors.ts`）。
- **導出の限界**: 既存 `derived`/`formula` は**数値専用・文字列/条件なし**（`derivedFormula.ts`）→ formula 拡張ではなく宣言的 mapping を新設。

## 設計（確定）

`dynamicIcon` は**任意**。無ければ従来どおり静的 `schema.icon`。使う場合は **`source` 必須**。

```jsonc
"dynamicIcon": {
  "source": {                    // 必須
    "collection": "weather",     //   必須（自身/他コレクションどちらも可＝クロスコレクション）
    "from": "latest",            //   任意・既定 latest(日付で最新) | first | when
    "orderBy": "date",           //   任意（latest の基準。既定は schema の date/datetime フィールド）
    "when": { "field": "region", "eq": "tokyo" }  // 任意（from="when" の絞り込み）
  },
  "rules": [                     // when述語の先勝ちリスト（CollectionWhen 流用）
    { "when": { "field": "condition", "eq": "rain" }, "icon": "rainy" },
    { "when": { "field": "temp", "gt": 30 }, "icon": "sunny" }
  ],
  "fallback": "partly_cloudy_day" // 任意・既定 schema.icon
}
```

### 評価ロジック（サーバ）
`discovery.ts` の summary 生成（`icon` セット箇所, :937）で:
1. `dynamicIcon` 無し → `schema.icon`。
2. あり → `source.collection` のレコード群から `from`(+`orderBy`/`when`) で対象1件を解決
   → `rules` を上から `CollectionWhen` 評価、最初に当たった `icon`。
3. どれも当たらない / 対象レコード無し / source コレクション未発見 → `fallback ?? schema.icon`。

クロスコレクション読み取りは discovery が全コレクションを走査済みなので追加コスト小。

## 実装ステップ

### v1（アイコン計算 + 既存契機で反映）
- `schema.ts`: `DynamicIconSpec`（`source` / `rules` / `fallback`）を型追加、`CollectionSchema.dynamicIcon?`。
- `discovery.ts`: zod に `dynamicIcon` を追加（`icon` の zod は :461 付近）。summary の `icon` 計算を上記ロジックに。
  - 対象レコード解決 + `rules` 評価は純関数に切り出し（`core/` に `resolveDynamicIcon.ts`、`actionVisible` 流用、ユニットテスト）。
- 反映タイミングは既存 `reconcile()`（Collections index 訪問 / shortcut 再照合）に乗る＝「次に Collections を見たら反映」。
- テスト: `resolveDynamicIcon`（rule先勝ち / no-match→fallback / from=latest,first,when / 自身&他コレクション / レコード0件）。

### v2（ライブ更新・追加）
- `useShortcuts` / launcher を `collection:<source.collection>` に**購読**させ、変更時にその slug を再 reconcile → リアルタイム切替。
- 依存: dynamicIcon を持つショートカットの `source.collection` 一覧を購読対象にする（クロスコレクションも slug キーでそのまま乗る）。

## Open questions / 注意
- `source.from` 既定 `latest` の `orderBy` 未指定時: schema に date/datetime フィールドが無いコレクションは `first`（or id順末尾）にフォールバック。
- `rules[].icon` は Material Symbols 名のみ（既存と統一。任意画像は対象外）。
- `dynamicIcon` の妥当性検査（存在しない `source.collection`/`field`/icon名）は discovery 時に warn 
  （`packages/core/assets/helps/error-recovery.md` に診断を1項目追記するか検討）。

## Out of scope
- 数値formula の文字列/条件拡張（不要。宣言的 rules で足りる）。
- アイコン以外（色/バッジ）の動的化。
- v2 の細かいデバウンス最適化（まず動くもの）。
