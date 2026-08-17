# Quake Panel の Home Assistant 連携（アドオン側で持つ）

## これは何か

Quake Panel の HA 連携（通知・センサー）を、**上流のパネル本体ではなく
このアドオン側で実装している**。実体は `ha-bridge.mjs` の 1 ファイル。

上流 [hgn32/quake-panel](https://github.com/hgn32/quake-panel) はいずれ HA 連携を
落とす。パネルは「地震速報を表示するだけのアプリ」に戻し、HA に依存する部分は
アドオンが持つ。パネルを HA 以外で動かす人に HA の都合を背負わせないため。

## 構成

同じコンテナ内で 2 つのプロセスが動く。

```
パネル本体（上流をそのまま。HA_NOTIFY=false で HA を触らせない）
   :8080  ── WebSocket /ws ──▶  ha-bridge.mjs（このリポジトリ）
                                     │
                                     ▼
                          http://supervisor/core/api
```

- ブリッジはパネルが公開している WebSocket に、**ブラウザと同じ立場で**つなぐ。
  パネル側に手を入れる必要はなく、上流をそのまま使える
- `run.sh` は `BRIDGE_NOTIFY=true` のときだけブリッジを起こす。落ちたら
  5 秒おきに起こし直し、その旨をログタブに残す
- パネル本体が持っている HA 通知は `options-env.mjs` が **常に `HA_NOTIFY=false`**
  を渡して止める。両方が動くと同じ通知が二重に飛ぶ

## 上流のコードを写していない

上流の `server/src/haNotify.ts` はパネルのプロセス内で Hub から直接イベントを
受ける前提の実装で、前提が違う。作り直した箇所は次のとおり。

| 上流 | このアドオン |
|---|---|
| `Hub` からイベントを直接受ける | WebSocket で受ける。**接続が切れるという概念が上流には無い**ので、指数バックオフ（1〜30秒）での再接続と、繋ぎ直した後の入れ直しを足した |
| `Config`（環境変数から組む） | `run.sh` が渡す `HA_API_URL` / `SUPERVISOR_TOKEN` を直接読む |
| `shared/src/haFilter.ts` による絞り込み | **持たない**（下記） |
| `server/src/data/seismicAreas.ts`（4412行の細分区域表） | **持たない**。絞り込みをやめたので不要になった |
| `server/src/logger.ts` | 使わない。HA のログタブで読める `[quake-panel][ha]` 付きの 1 行に揃えた |
| 震度ラベルの変換（`shared/src/intensity.ts`） | 使うのは 10 個の対応表だけなので、その表だけを持つ |

依存は増やしていない。WebSocket クライアントは Node 22 の組み込みを使う。

## 絞り込みを持たない

震度・都道府県・細分区域での絞り込みはしない。受け取ったものをそのまま流す。
**同じことは HA のオートメーションの条件で書けるため**、アドオン側に気象庁の
区域表（4000 行超）と判定ロジックを抱える必要がない。README にオートメーション
での絞り方の例を置いてある。

## 変えていないもの（外から見える契約）

ユーザーのオートメーションが壊れるので、上流にあったものをそのまま維持する。

| 種類 | 名前 |
|---|---|
| エンティティ | `binary_sensor.quake_panel_eew` / `sensor.quake_panel_eew_intensity` / `binary_sensor.quake_panel_tsunami` / `sensor.quake_panel_last_quake` |
| イベント | `quake_panel_eew` / `quake_panel_tsunami` / `quake_panel_quake` |
| 属性名 | `max_intensity` / `is_warning` / `is_training` / `areas` / `grades` など |

上流から引き継いだ振る舞い:

- 訓練報・取消報では `binary_sensor.quake_panel_eew` を `on` にしない
  （訓練でダッシュボードが切り替わると困るため）
- 続報のたびには流さず、**意味が変わったときだけ**イベントを流す
- States API で作った状態は HA を再起動すると消えるので、60 秒ごとに入れ直す
- 送信は 1 本ずつ順番に。並行に投げると古い状態が後から届いて上書きする

繋ぎ直したときの `hello`（現況一括）では、センサーの値だけ現況に合わせて
**イベントは流さない**。過去の発表でオートメーションを走らせないため。

## 引き取っていないもの

- **`server/src/haLocation.ts`（HA の自宅位置を使う）** — パネルが HA の
  `/api/config` を読んで自宅の緯度経度を取る機能。パネルが HA を呼ぶ方向なので、
  外側にいるアドオンからは実装できない。いまは上流にこの機能が残っていて、
  `HA_API_URL` を渡しているので動く。**上流から HA 連携が消えた時点で
  この機能も消える。** そのときは README・設定タブの説明から
  「HA の自宅位置を使う」の記述を削ること（`homeassistant_api: true` は
  通知側で引き続き必要なので残す）

## 上流が更新されたときの手順

1. `upstream.env` の `UPSTREAM_REF` を新しいコミットに更新する
2. WebSocket のプロトコル（`shared/src/protocol.ts` の `ServerEvent`、
   `ENDPOINTS.ws`、`StateSnapshot`）に変更が無いか見る。
   `eew` / `quake` / `tsunami` / `hello` の形が変わっていればブリッジも直す
3. 上流から HA 連携が消えたら、`options-env.mjs` の `HA_NOTIFY` は不要になる
   （消しても残しても害はない）
4. `config.json` の `version` を上げ、`CHANGELOG.md` を書く
   （リポジトリ直下の `CLAUDE.md` のリリース手順に従う）
5. マージ後、GitHub Actions のビルドが通ることを確認する

## 検証

`CLAUDE.md` の「推測でリリースしない」に従い、実際にイメージをビルドして確認する。

1. **実パネルと一緒に起動**して、ブリッジが `/ws` につながり、`hello` を受けて
   4 つのエンティティがコア API へ入ること。パネル本体からは何も送られない
   （二重通知になっていない）こと
2. **パネル役のダミー WebSocket** から実際の形の電文を流して、
   イベントの発火（意味が変わったときだけ）・訓練報で `off` のまま・
   `frame` を流さない・切断からの再接続・再接続時にイベントを流さないこと
3. HA のコア API はモックを立て、送られる JSON を実際に突き合わせる
