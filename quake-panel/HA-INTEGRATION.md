# Quake Panel の Home Assistant 連携（アドオン側で持つ）

## これは何か

Quake Panel の HA 連携（通知・センサー）を、**上流のパネル本体ではなく
このアドオン側で実装する**ための方針を書いたもの。

上流 [hgn32/quake-panel](https://github.com/hgn32/quake-panel) からは HA 連携を
取り除く。パネルは「地震速報を表示するだけのアプリ」に戻し、HA に依存する部分は
すべてアドオンが持つ。パネルを HA 以外で動かす人に HA の都合を背負わせないため。

## 原則: 上流のコードをそのまま持ってこない

上流の HA 連携はパネルのサーバープロセスの**内側**に置かれた実装で、
アドオンが置かれる環境とは前提が違う。写して動かすのではなく、
アドオン側の前提に合わせて作り直す。前提の違いは主に3つ:

1. **別プロセスになる。** 上流は Hub からイベントを直接受け取っていたので、
   接続が切れる・取りこぼすという概念が無い。アドオンは WebSocket 越しになるので、
   再接続と再同期を自分で面倒みる必要がある
2. **設定の入口が違う。** 上流は環境変数。アドオンは `/data/options.json` を直接読める
3. **ログの出口が違う。** アドオンのログは HA の「ログ」タブに出る。
   ユーザーはそこしか見られない（リポジトリ直下の `CLAUDE.md` を参照）

## 外から見える契約（変えないもの）

ユーザーのオートメーションが壊れるので、次は上流にあったものをそのまま維持する。

| 種類 | 名前 |
|---|---|
| エンティティ | `binary_sensor.quake_panel_eew` |
| | `sensor.quake_panel_eew_intensity` |
| | `binary_sensor.quake_panel_tsunami` |
| | `sensor.quake_panel_last_quake` |
| イベント | `quake_panel_eew` / `quake_panel_tsunami` / `quake_panel_quake` |
| 設定タブ | `notify_home_assistant` / `notify_min_intensity` / `notify_prefectures` / `notify_areas` |

## 構成

同じコンテナ内で 2 つのプロセスを動かす。

```
パネル本体 (上流のまま。HA を一切知らない)
   :8080  ── WebSocket /ws ──▶  HA連携プロセス (このリポジトリ)
                                     │
                                     ▼
                          http://supervisor/core/api
                          （SUPERVISOR_TOKEN。config.json の
                            homeassistant_api: true が必要）
```

WebSocket は認証なしでパネルが公開しているもの（キオスク端末が直接開くのと同じ口）。
`eew` / `quake` / `tsunami` が流れてくるので、HA 連携に必要な材料はここで揃う。

## 上流から引き取るもの と、どう作り直すか

| 上流 | アドオンでどうするか |
|---|---|
| `server/src/haNotify.ts` の `HomeAssistantNotifier`（`Hub` と `Config` を受け取るクラス） | Hub 依存を外し、WebSocket の受信ループから駆動する形に組み直す。**上流には無い再接続の考慮を足す**: 切断時の指数バックオフと、つなぎ直した後に `hello` の snapshot で現在値を入れ直す処理 |
| `server/src/config.ts` の HA 設定（env から組む） | `/data/options.json` を直接読む。`options-env.mjs` から HA 関連の受け渡しを削る |
| `shared/src/haFilter.ts` | 受け取るのは WebSocket に出てきた確定イベントだけなので、パネル内部の状態を前提にした分岐は要らない。震度・都道府県・細分区域の判定だけに絞って書き直す |
| `server/src/data/seismicAreas.ts`（4412行の TypeScript） | 丸写ししない。使うのは `seismicAreaOf`（観測点名・市区町村名 → 細分区域名）だけなので、**判定に必要なデータへ整形して持つ**。上流のファイルから生成するスクリプトを置き、上流が更新されたら作り直せるようにする。生成物は `config.json` の `notify_areas` の選択肢（188区）も同時に吐かせて、いま手で二重管理になっている並びを一本化する |
| `server/src/logger.ts` | 使わない。HA のログタブで読める形式に合わせる |
| States API の定期入れ直し | **残す。** HA を再起動すると States API で作った状態は消えるため |
| 上流の HA 関連テスト（計 568 行） | 写さない。入力が Hub から WebSocket に変わるので、WebSocket のモックから通知内容を確かめるテストとして書き直す |

## 引き取らないもの

- **`server/src/haLocation.ts`（HA の自宅位置を使う）** — パネルが HA の `/api/config` を
  読んで自宅の緯度経度を取る機能。これはパネルが HA を呼ぶ方向なので、外側にいる
  アドオンからは戻せない。**機能ごと廃止する。** 利用地はパネルの設定で手動指定になる。
  廃止にあわせて、README・設定タブの説明・`run.sh` の起動メッセージから
  「HA の自宅位置を使う」の記述を消すこと（`homeassistant_api: true` は通知側で
  引き続き必要なので残す）

## 上流が更新されたときの手順

1. `upstream.env` の `UPSTREAM_REF` を新しいコミットに更新する
2. WebSocket のプロトコル（`shared/src/protocol.ts` の `ServerEvent`、`ENDPOINTS.ws`）に
   変更が無いか見る。`eew` / `quake` / `tsunami` の形が変わっていれば HA 連携側も直す
3. `server/src/data/seismicAreas.ts` が変わっていれば、生成スクリプトを流し直す
4. `config.json` の `version` を上げ、`CHANGELOG.md` を書く（リポジトリ直下の
   `CLAUDE.md` のリリース手順に従う）
5. マージ後、GitHub Actions のビルドが通ることを確認する

## 検証

`CLAUDE.md` の「推測でリリースしない」に従い、実際にイメージをビルドして確認する。

- HA のコア API はモックを立てて、送られる JSON（エンティティ名・イベント名・属性）を確かめる
- **パネルを落とした状態から起こす**など、WebSocket が切れた場合に再接続し、
  つなぎ直した後にエンティティの値が現在の状態に戻ることを確かめる
- 絞り込み（震度・都道府県・細分区域）が効いていることを、実際の電文の形で確かめる
- 通知を無効にしたときに HA へ一切送らないことを確かめる
