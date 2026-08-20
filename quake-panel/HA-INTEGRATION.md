# Quake Panel の Home Assistant 連携（アドオン側で持つ）

## これは何か

Quake Panel の HA 連携（通知・センサー）を、**上流のパネル本体ではなく
このアドオン側で実装している**。実体は `ha-bridge.mjs` の 1 ファイル。

上流 [hgn32/quake-panel](https://github.com/hgn32/quake-panel) は HA 連携を
落とした（`7703f2c`）。パネルは「地震速報を表示するだけのアプリ」で、HA に依存する
部分はアドオンが持つ。パネルを HA 以外で動かす人に HA の都合を背負わせないため。

## 構成

同じコンテナ内で 2 つのプロセスが動く。受け口は 2 つある。

```
パネル本体（上流をそのまま。HA のことは何も知らない）
   │
   ├─ EEW webhook (EEW_WEBHOOK_URL) ──▶ ha-bridge.mjs :8099/eew
   │                                          │
   └─ WebSocket /ws  ◀───────────────────────┘（地震情報・津波・EEW）
                                              │
                                              ▼
                                   http://supervisor/core/api
```

| 情報 | 受け取り方 |
|---|---|
| 緊急地震速報 | **webhook**（上流が `EewCoordinator` の `onEewEvent` として用意した口）。`kind` で new / update / cancel / expired が分かる。デモ再生もここを通る |
| 地震情報・津波予報 | **WebSocket**。この 2 つには webhook が無い |

- 続報は毎秒のように来るので、**意味が変わったときだけ**流す。鍵は id・警報種別・
  予想最大震度・取消・最終報。`kind` は鍵に入れない（同じ内容で `new`→`update` と
  変わっただけのときに二重に流れてしまうため。取消と表示終了は内容自体が変わる
  ので取りこぼさない）
- ブリッジは WebSocket に「ブラウザと同じ立場で」つなぐ。パネル側に手を入れる
  必要はなく、上流をそのまま使える
- `run.sh` は `BRIDGE_NOTIFY=true` のときだけブリッジを起こす。落ちたら
  5 秒おきに起こし直し、その旨をログタブに残す
- 通知を切ると `EEW_WEBHOOK_URL` が空になり、パネルは webhook を作らない

## 上流のコードを写していない

上流の `server/src/haNotify.ts` はパネルのプロセス内で Hub から直接イベントを
受ける前提の実装で、前提が違う。作り直した箇所は次のとおり。

| 上流 | このアドオン |
|---|---|
| `Hub` からイベントを直接受ける | webhook と WebSocket で受ける。**接続が切れるという概念が上流には無い**ので、指数バックオフ（1〜30秒）での再接続と、繋ぎ直した後の入れ直しを足した |
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
| 属性名 | `max_intensity` / `is_warning` / `is_training` / `areas` など |

上流から引き継いだ振る舞い:

- 訓練報・取消報では `binary_sensor.quake_panel_eew` を `on` にしない
  （訓練でダッシュボードが切り替わると困るため）
- 続報のたびには流さず、**意味が変わったときだけ**イベントを流す
- States API で作った状態は HA を再起動すると消えるので、60 秒ごとに入れ直す
- 送信は 1 本ずつ順番に。並行に投げると古い状態が後から届いて上書きする

繋ぎ直したときの `hello`（現況一括）では、センサーの値だけ現況に合わせて
**イベントは流さない**。過去の発表でオートメーションを走らせないため。

## 既知の割り切り

上流の [docs/eew-events.md](https://github.com/hgn32/quake-panel/blob/main/docs/eew-events.md)
が受け側に求めている項目のうち、意図的にやっていないことがある。

| 上流の求め | このアドオン | 理由 |
|---|---|---|
| §9「`cancel` / `expired` を落とすと表示が残るので、受け側でも保持期限を持つこと」 | **持っていない** | webhook はコンテナ内の 127.0.0.1 で、落ちる可能性が低い。取りこぼしたときは `binary_sensor.quake_panel_eew` が `on` のまま残るが、次の地震の `new` で正しくなる。ブリッジ自身が落ちた場合は、繋ぎ直しの `hello`（現況一括）で入れ直される |
| §5「地域別の最新値が要るなら WebSocket の `eew` を見ること」 | **見ていない** | EEW は webhook 一本にしている（二重に受けると同じ内容で二重にイベントが飛ぶ）。`regions` は件数が変わったときにしか更新されない。この制約は README のイベント節に書いてある |

## 引き取っていないもの

- **「HA の自宅位置を使う」** — パネルが HA の `/api/config` を読んで自宅の
  緯度経度を取っていた機能。パネルが HA を呼ぶ方向なので外側からは実装できない。
  上流の `54f94ba` で `server/src/haLocation.ts` ごと削除され、**この機能は無くなった**。
  利用地は「直接入力 / 地図をクリック / 現在地」の 3 つで決める。
  README・設定タブの説明からも記述を削除済み
  （`homeassistant_api: true` は通知側で引き続き必要なので残している）

## 上流が更新されたときの手順

0. 上流のドキュメントを先に読む。`docs/eew-events.md`（webhook の発火条件）と
   `docs/area-codes.md`（電文に入る地名の値域）が一次資料で、ここが変わると
   ブリッジの読み方と README のオートメーション例が古くなる
1. `upstream.env` の `UPSTREAM_REF` を新しいコミットに更新する
2. `server/src/config.ts` が読む環境変数に変更が無いか見る
   （`EEW_WEBHOOK_URL` の名前が変わればここが壊れる）
3. webhook の本文（`server/src/notify/webhookNotifier.ts` の `WebhookPayload`）と、
   WebSocket のプロトコル（`shared/src/protocol.ts` の `ServerEvent`・`ENDPOINTS.ws`・
   `StateSnapshot`）に変更が無いか見る
4. `shared/src/models.ts` の `EewState` / `QuakeInfo` / `TsunamiInfo` の
   フィールド名に変更が無いか見る（ブリッジがそのまま読んでいる）
5. `config.json` の `version` を上げ、`CHANGELOG.md` を書く
   （リポジトリ直下の `CLAUDE.md` のリリース手順に従う）
6. マージ後、GitHub Actions のビルドが通ることを確認する

### イメージのビルドで `npm test` を使わない理由

上流のテストには実行環境を選ぶものが 2 つあり、素の Docker ビルドでは通らない
（どちらもアプリの不具合ではない）。上流自身の `release/Dockerfile` も
`npm run build` だけを走らせている。

- `server/test/staticRoot.test.mjs` — `/workspaces/server` へ `chdir` する
- `server/test/shutdown.test.mjs` — `listening` のログを見た直後に SIGTERM を
  送るため、終了ハンドラの登録が間に合わず `received SIGTERM` が出ないことがある

## 検証

`CLAUDE.md` の「推測でリリースしない」に従い、実際にイメージをビルドして確認する。

1. **実パネルと一緒に起動**して、ブリッジが `/ws` につながり、`hello` を受けて
   4 つのエンティティがコア API へ入ること。パネルのログに
   `eew webhook to http://127.0.0.1:8099/eew` が出ること
2. **パネルのデモ再生**（設定画面、または WebSocket へ `{"type":"demo",…}`）を
   流して、実際の配信経路で EEW・津波が HA まで届くこと。EEW は
   `new` → `update` → `cancel` → `expired` と流れ、同じ内容の続報が
   間引かれていること
3. **webhook を直接叩いて** new / update / cancel / expired の各 `kind`、
   同じ内容の再送を捨てること、壊れた本文でも落ちないことを確かめる
4. 通知を無効にしたときに、ブリッジが起動せず、パネルも webhook を作らないこと
5. HA のコア API はモックを立て、送られる JSON を実際に突き合わせる
