# Suwayomi Server

[Mihon](https://mihon.app/)(旧 Tachiyomi)互换のセルフホスト型マンガサーバー [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server) を Home Assistant アドオンとして動作させます。

## 機能

- Mihon / Tachiyomi からリモートサーバーとして接続可能
- 拡張機能(エクステンション)でさまざまなマンガソースに対応
- Web UI でブラウザから直接読書可能
- ダウンロード・既読管理
- **`.tachibk` バックアップビューア内蔵**(旧 Suwayomi Summary アドオンを統合)

## 対応アーキテクチャ

| アーキテクチャ | 対応状況 |
|---|---|
| amd64 | ✅ |
| aarch64 | ✅ |

## インストール

1. Home Assistant の **設定 → アドオン → アドオンストア** を開く
2. 右上のメニューから **リポジトリを追加** を選択し、以下の URL を入力する
   ```
   https://github.com/hgn32/ha-addons
   ```
3. **Suwayomi Server** を選択して **インストール**
4. アドオンを起動後、`http://<HA のアドレス>:4567` にアクセス

## ポート / 画面

| アクセス方法 | 用途 |
|---|---|
| ポート `4567` | Suwayomi Server 本体の Web UI / API |
| サイドバーパネル「Suwayomi Summary」(ingress) | `.tachibk` バックアップビューア |

## バックアップビューア(Suwayomi Summary)

旧 Suwayomi Summary アドオンの機能を本体に統合しました。サイドバーの
**Suwayomi Summary** パネル(ingress)から、`.tachibk` / `.proto.gz` バックアップの
内容表示や、ダウンロード済みチャプターの一括削除などを行えます。

- 「サーバ上のフォルダから選択」が参照するのは Suwayomi 本体のバックアップ出力先。
  0.20 からこの実体はコンテナ内(非永続領域)にあり、アドオン更新のたびに
  空になります。自動バックアップや手動で置いた `.tachibk` / `.proto.gz` は
  同一コンテナが動いている間は一覧表示されます。
- 変換テーブルは `/config/aliases.json`
- Suwayomi Server への接続は同一コンテナ内の `localhost:4567` を既定で使用します。
  BASIC 認証を有効にしている場合のみ、アドオンの **設定** タブで
  `suwayomi_username` / `suwayomi_password` を設定してください。

## アドオン設定

| 設定キー | 型 | 既定値 | 説明 |
|---|---|---|---|
| `suwayomi_url` | url | `http://localhost:4567` | Suwayomi Summary(バックアップビューア)が接続する Suwayomi Server の URL |
| `suwayomi_username` | str | (空) | BASIC 認証を有効にしている場合の認証ユーザ名 |
| `suwayomi_password` | password | (空) | BASIC 認証を有効にしている場合の認証パスワード |
| `max_memory_mb` | int | `2048` | Suwayomi Server(JVM)の最大ヒープサイズ(`-Xmx`、単位 MB) |

拡張機能でのマンガ取得やページ画像の処理量が多い場合は `max_memory_mb` を大きくしてください。

## データの保存先

`startup_script_org.sh` により、Suwayomi の Tachidesk データディレクトリ全体がアドオン専用の設定ディレクトリ(コンテナ内 `/config`、ホスト実体 `/addon_configs/<slug>/`、バックアップ対象)に永続化されます。ただし容量が大きい・キャッシュ・バージョン依存・(ユーザー希望により)バックアップに含めたくないものは、コンテナ内の非永続領域への symlink にして対象外にしています。

| 種類 | 永続化・バックアップ対象 | コンテナ内パス |
|---|---|---|
| データベース・サーバー設定・拡張機能・マイグレーション設定 | ✅ 対象 | `/config/tachidesk/` |
| `webUI`(静的アセット) | ✅ 対象 | `/config/tachidesk/webUI` |
| `bin`(KCEF 等バージョン依存バイナリ)・`cache`・`logs`・`downloads`・`thumbnails` | ❌ 対象外(非永続) | `/config/tachidesk/<各名>` は symlink |
| バックアップ (.tachibk) | ❌ 対象外(非永続) | `/config/tachidesk/backups` は symlink |
| Summary viewer の変換テーブル | ✅ 対象 | `/config/aliases.json` |

`webUI` がバックアップ対象なのは、Suwayomi 本体が起動のたびに webUI ディレクトリを
削除→実ディレクトリとして作り直して静的アセットを展開し直すためです。symlink を
張って対象外にしても起動時に実体へ置き換わってしまうため、symlink 方式では
対象外にできず(0.20 で試みたが機能していなかった)、対象(数MB 程度)として
扱っています。

個々のファイルを個別にシンボリックリンクする方式は、Suwayomi 本体や上流起動スクリプトの
「一時ファイル + rename」型の書き込みでリンクが実ファイルに置き換わり、以後のデータが
コンテナ内に落ちてアップデートで失われるため使用していません(0.17 で修正)。

「対象外(非永続)」のディレクトリは、コンテナの**再起動では残り、アドオンの更新では消えます**。
`bin` は本体が起動時に自動で再取得するため実害はありませんが、
**`backups`(.tachibk)は更新のたびに消えるため、アップデート前後の運用が変わります**:

1. アドオン更新の**前**に、Suwayomi WebUI でバックアップを作成し、
   ブラウザから**手元の PC にダウンロード**しておく
2. アドオンを更新する
3. 更新**後**に、Suwayomi WebUI の復元機能で、手順1でダウンロードした
   **ファイルをアップロードして復元**する(「サーバ上のフォルダから選択」は
   更新を跨いでは使えません)

なお `backups` の実体はコンテナ内にあるため、ホストの `/addon_configs/<slug>/backups` から直接
`.tachibk` ファイルを見ることはできません。閲覧は Suwayomi WebUI か、本アドオンの
Summary viewer(サイドバー「Suwayomi Summary」パネル)から行ってください。

## Mihon との連携

Mihon アプリの **設定 → バックアップと同期 → Suwayomi** からサーバーの URL を設定することで、スマートフォンから利用できます。
