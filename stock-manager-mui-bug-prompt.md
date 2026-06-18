stock-manager アドオン（リポジトリ: hgn32/ha-addons, ブランチ: claude/nice-bardeen-tdi9f7）の
frontend (`stock-manager/frontend/`) で、MUI のシステム短縮 props が効かなくなっているバグを調査・修正してほしい。

## 背景・前提

- リポジトリは `/home/user/ha-addons`（ローカル作業ディレクトリ前提。違う場所にcloneしてる場合はパスを置き換えて）
- `stock-manager/frontend/package.json` の主要バージョン: `react@^19.2.7`, `@mui/material@^9.0.1`,
  `@mui/icons-material@^9.0.1`, `typescript@^6.0.3`, `vite@^8.0.16`
- 実際のビルドコマンドは `package.json` の `"build": "vite build"` のみで、**tscによる型チェックを一切行わない**
  （esbuildが型を握って消すだけ）。そのため下記の型エラーがあってもDockerビルド・本番ビルドは exit 0 で成功する。
  型エラーが出ているからといってビルドが落ちているわけではない。

## 不具合の内容

`stock-manager/frontend/src/` 配下の複数ファイルで、`Box` / `Stack` / `Typography` などのMUIコンポーネントに対して
`alignItems` / `fontWeight` / `flexWrap` / `mt` / `mb` / `gridColumn` / `display` / `textAlign` のような
CSS短縮プロパティを **直接propsとして** 渡しているが、これは古いMUIメジャーバージョンの書き方であり、
現在インストールされている `@mui/material@9.0.1` ではもう機能しない。

`npx tsc --noEmit`（frontendディレクトリで実行、事前に `npm install` が必要）を通すとこれらが型エラーとして
73件検出される（実行時点のスナップショット。正確な現状は再実行して確認すること）。

### 確認済みの根本原因（node_modules配下のソースまで遡って実機確認済み）

1. `node_modules/@mui/system/styleFunctionSx/styleFunctionSx.js`
   ```js
   function styleFunctionSx(props) {
     if (!props.sx) { return null; }   // props.sx 以外は一切処理しない
   ```
   → `sx` プロパティの中身しかCSS化されない。

2. `node_modules/@mui/system/Stack/createStack.js` の `style()` 関数は
   `direction` / `spacing` / `useFlexGap` だけを処理し、`alignItems` / `flexWrap` 等は
   分割代入で吸収されずそのまま `...other` に残り、最終的に素のDOM `<div>` にHTML属性として
   そのまま渡るだけ（CSSとして効かない。ブラウザは無効な属性として無視する）。

3. `node_modules/@mui/material/Typography/Typography.d.ts` に `fontWeight` は存在しない
   （`TypographyOwnProps` に定義なし）。`noWrap` 等の本来のownプロパティは生きている。

4. `node_modules/@mui/system/createBox/createBox.js` の `BoxRoot` も
   `shouldForwardProp` で `theme`/`sx`/`as` 以外は素通しし、スタイル関数は `styleFunctionSx` のみ
   （= 上記1と同じ理由で `mt` / `gridColumn` 等は効かない）。

5. TextFieldの `InputProps`（大文字、1件）は `slotProps={{ input: {...} }}` に、
   `inputProps`（小文字、2件）は `slotProps={{ htmlInput: {...} }}` に置き換える必要がある
   （`node_modules/@mui/material/TextField/TextField.d.ts` の `TextFieldSlotsAndSlotProps` 参照）。

**結論：これは型エラーだけの問題ではなく、実際の画面で意図したスタイル（中央揃え・太字・折り返し・余白等）が
当たっていない可能性がある実害バグ。** ただし実機ブラウザでの見た目確認はまだ行っていないので、
修正後に必ず実際に画面を見て確認すること（Playwright等でもいいし、`npm run dev` 起動して目視でもいい）。

### 別件・無関係なエラー（混同しないこと）

`src/components/ProductDialog.tsx:376` 付近で `FormData.append()` に `string | number` 型の値を渡していて
型エラーになっている（`fd.append(k, data[k] ?? "")` で `data[k]` が `string | number` 推論）。
これは上記のMUI system-propsの話とは無関係の別の小さな型の緩さで、ブラウザの `FormData.append` は実行時に
数値を暗黙的に文字列化するため実害はほぼ無いはずだが、ついでに `String(data[k] ?? "")` 等で直しても良い。

## 影響範囲（調査時点のスナップショット。再調査推奨）

エラー件数の多い順（ファイル単位）：

| ファイル | 件数 |
|---|---|
| src/pages/Dashboard.tsx | 16 |
| src/components/ProductDialog.tsx | 13 |
| src/pages/AmazonImport.tsx | 12 |
| src/pages/Stocktake.tsx | 10 |
| src/pages/Products.tsx | 5 |
| src/pages/Transactions.tsx | 4 |
| src/components/AmazonManageDialog.tsx | 4 |
| src/components/IconPicker.tsx | 3 |
| src/components/StockDialog.tsx | 2 |
| src/components/MasterTablePage.tsx | 2 |
| src/components/SimpleMasterDialog.tsx | 1 |
| src/App.tsx | 1 |

プロパティ別件数：`alignItems`(35) / `fontWeight`(20) / `flexWrap`(4) / `display`(4) / `mb`(3) /
`inputProps`小文字(2) / `textAlign`(1) / `mt`(1) / `gridColumn`(1) / `InputProps`大文字(1)

## 再現・調査コマンド

```sh
cd stock-manager/frontend
npm install                      # ネットワークアクセス可能。問題なく完了する
npx tsc --noEmit                 # 73件の型エラーが出る（現状の正確な一覧はこれで再取得）
npm run build                    # vite build は exit 0 で成功する（型チェックしないため）
```

backend側は無関係（`cd stock-manager/backend && npm install && DATABASE_URL=file:./dev.db npx prisma generate && npx tsc --noEmit --noUnusedLocals --noUnusedParameters` でエラー0件、クリーン済み・対応不要）。

## やってほしいこと

1. 上記の再現コマンドで現状の全エラーを洗い出す
2. 各箇所を `sx={{ ... }}` （または `InputProps`→`slotProps.input`、`inputProps`→`slotProps.htmlInput`）に書き換えて修正
3. 修正後 `npx tsc --noEmit` でMUI system-props起因のエラーが0件になることを確認
   （ProductDialog.tsx:376のFormData型エラーは別件なので直しても直さなくてもいいが、直すなら明記すること）
4. 実際に `npm run dev` 等でアプリを起動し、修正箇所（中央揃え・太字・折り返し等のレイアウト）が
   見た目上崩れていないか、Dashboard / ProductDialog / Stocktake / AmazonImport を中心に目視確認する
5. `stock-manager/config.json` の `version` をパッチバンプ（CI の version-guard.yaml が
   stock-manager配下の変更時にバージョンアップを要求するため）
6. ブランチ `claude/nice-bardeen-tdi9f7` 上で作業しているはずなので、新しいブランチを作らずそこに
   コミット・push する（このリポジトリの既存ルール）
