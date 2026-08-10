# go2rtc (hvc1 patched)

[go2rtc](https://github.com/AlexxIT/go2rtc) の公式 **ハードウェア版** イメージをベースに、
H.265 (HEVC) がブラウザの MSE で再生できないバグ
([issue #2205](https://github.com/AlexxIT/go2rtc/issues/2205)) を修正したアドオンです。

H.265 のメインストリームを **トランスコードなし・画質劣化なし・CPU 負荷ほぼゼロ** で
ブラウザ表示できるようになります。

## 何を直しているか

go2rtc は fMP4 の init セグメントに `hev1` サンプルエントリを書きながら、ブラウザには
MIME で `hvc1.1.6.L153.B0` と宣言していました。ISO/IEC 14496-15 §8.4.1 ではこの 2 つは
別物です。

| ボックス名 | 意味 |
|---|---|
| `hvc1` | パラメータセット (VPS/SPS/PPS) を `hvcC` に out-of-band で格納 |
| `hev1` | パラメータセットは in-band でも `hvcC` でも可 |

Chrome / Edge 120 以降は宣言と実物の不一致を理由に init セグメントを拒否し、
`CHUNK_DEMUXER_ERROR_APPEND_FAILED` で即切断されます。
go2rtc はパラメータセットを既に `hvcC` に正しく書いているため、**ボックス名を `hvc1` に
直すのが正しい修正** です。

ビルド時に上流ソースへ以下を当てています（[patch-hvc1.sh](./patch-hvc1.sh)）。

| ファイル | 変更 |
|---|---|
| `pkg/iso/codecs.go` | `m.StartAtom("hev1")` → `m.StartAtom("hvc1")` |
| `pkg/iso/reader.go` | MP4 パーサが `hvc1` も受け付けるよう追加（`hev1` の互換は維持） |
| `main.go` | バージョン文字列に `-hvc1` を付与（HA のログタブで判別できるようにするため） |

### 検証済みの効果

同梱の Dockerfile でビルドしたイメージを実際に起動し、H.265 ストリームの fMP4 を
取得して確認しています。

| | 公式イメージ | 本アドオン |
|---|---|---|
| offset 421 のボックス名 | `hev1` | `hvc1` |
| `hvcC`(パラメータセット) | offset 507 | offset 507（変化なし） |
| `Content-Type` の宣言 | `hvc1.1.6.L153.B0` | `hvc1.1.6.L153.B0` |
| 宣言と実物の整合 | ❌ 不一致 | ✅ 一致 |

H.264 ストリームは従来どおり `avc1` / `avcC` のままで、影響はありません。

## 公式アドオンとの違い

- ベースイメージ: 公式 **go2rtc (hardware)** (`ghcr.io/alexxit/go2rtc:1.9.14-hardware`)。
  ffmpeg、Intel VAAPI/QSV、AMD VAAPI、NVIDIA CUDA のハードウェア支援はそのまま使えます
- 設定ファイルは公式と同じ `/config/go2rtc.yaml`。**設定の移行は不要** です
- 既定では自動起動しません（`boot: manual`）。公式アドオンとポートが衝突するためです

## インストールと切り替え

⚠️ **公式 go2rtc アドオンと同時に起動できません。**
どちらも `host_network` で :1984 / :8554 / :8555 を使うため、同時に動かすと
ポートが衝突します。

1. 念のため **設定 → システム → バックアップ** でバックアップを取る
   （`/config/go2rtc.yaml` が含まれます）
2. 公式の go2rtc アドオンを **停止** し、「起動時に開始」を **オフ** にする
3. 本アドオンをインストールする
4. `full_access` を使うため、**「保護モード」をオフ** にする
   （公式のハードウェア版と同じ要件です）
5. 本アドオンを **起動** する
6. 動作を確認したら、本アドオンの「起動時に開始」を **オン** にする

## 動作確認（すべて Home Assistant の画面内で完結します）

### 1. パッチ版が動いているか

アドオンの **ログ** タブに、起動時のバージョン行が出ます。

```
INF go2rtc platform=linux/amd64 revision=... version=1.9.14-hvc1+dev....
```

`version` に **`-hvc1`** が入っていればパッチ版です。
（`+dev.<commit>.dirty` は「上流のタグ付きリリースにローカル修正を加えたビルド」を
Go が自動で付ける表記で、異常ではありません）

### 2. H.265 が再生できるか

`/config/go2rtc.yaml` にメインストリーム（H.265）をそのまま登録します。

```yaml
streams:
  security01_h265: rtsp://Admin:***@192.168.100.212:554/live0
```

アドオンを再起動し、サイドバーの **go2rtc (hvc1 patched)** パネル（Ingress）を開いて、
該当ストリームの **`stream`** / **`mse`** リンクから再生できることを確認します。

再生できていれば、ffmpeg によるトランスコードは走っていません（ストリーム一覧の
`producers` に ffmpeg が現れず、CPU 使用率も転送のみの水準になります）。

## 元に戻す（ロールバック）

1. 本アドオンを停止し、「起動時に開始」をオフにする
2. 公式 go2rtc アドオンを起動し、「起動時に開始」をオンに戻す
3. `/config/go2rtc.yaml` の H.265 直参照を元の設定に戻す
   （例: `security01: rtsp://.../live1` などの H.264 サブストリーム）

⚠️ 設定ファイルは公式アドオンと共有しています。**H.265 直参照のまま公式版に戻すと
再生できなくなります。** 設定の戻し忘れに注意してください。

## 上流バージョンの追従

自前ビルドなので、go2rtc の更新は手動で追う必要があります。

1. `Dockerfile` の `ARG GO2RTC_VERSION` を新しいバージョンに上げる
2. `config.json` の `version` を上げる（例: `1.9.15-hvc1.1`）
3. `CHANGELOG.md` に追記する

パッチが当たらなくなった場合（上流が該当箇所を書き換えた、あるいは本家で修正された
場合）は、`patch-hvc1.sh` が **ビルドを失敗させます**。パッチ未適用のイメージが
黙って出来上がることはありません。本家で修正が取り込まれたら、このアドオンは
不要になります。

## 既知の制限

- **HA 標準のカメラカードには効果が出ない場合があります。** このバグは MSE
  (`video-rtc.js` 経由 = go2rtc の Web UI や WebRTC Camera カード) の経路のものです。
  HA 標準カードが使う WebRTC は Chrome が H.265 に対応していないため、別の理由で
  再生できないことがあります
- H.265 の codec 文字列は上流が Level 5.1 (`hvc1.1.6.L153.B0`) 固定です。
  Level 5.1 の輝度サンプル数上限は 8,912,896 なので、4K (3840×2160 = 8,294,400) までは
  範囲内ですが、それを超える解像度では別途対応が必要です

## 参照

- go2rtc Issue #2205: https://github.com/AlexxIT/go2rtc/issues/2205
- go2rtc PR #2253 (Draft, 未マージ): https://github.com/AlexxIT/go2rtc/pull/2253
- go2rtc 本体: https://github.com/AlexxIT/go2rtc
- 公式アドオン: https://github.com/AlexxIT/hassio-addons
