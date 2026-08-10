# go2rtc (hvc1 patched)

[go2rtc](https://github.com/AlexxIT/go2rtc) の公式 **ハードウェア版** イメージをベースに、
H.265 (HEVC) がブラウザの MSE で再生できない問題を修正したアドオンです。

H.265 のメインストリームを **トランスコードなし・画質劣化なし・CPU 負荷ほぼゼロ** で
ブラウザ表示できます。

✅ SwitchBot カメラ（2592×1620 / H.265 / Main profile）+ Edge で**再生できることを実機確認済み**。

## 何を直しているか

原因は1つではなく、**4つの問題が重なっていました**。上流の go2rtc 側の問題が2つ、
カメラが規格から外れた送り方をしている問題が2つです。どれか1つでも残っていると
再生できません。

### 問題1: サンプルエントリ名が `hev1` になっている

go2rtc は fMP4 の init セグメントに `hev1` サンプルエントリを書きながら、ブラウザには
MIME で `hvc1.1.6.L153.B0` と宣言していました。ISO/IEC 14496-15 §8.4.1 ではこの 2 つは
別物です。

| ボックス名 | 意味 |
|---|---|
| `hvc1` | パラメータセット (VPS/SPS/PPS) を `hvcC` に out-of-band で格納 |
| `hev1` | パラメータセットは in-band でも `hvcC` でも可 |

Chrome / Edge 120 以降は宣言と実物の不一致を理由に init セグメントを拒否します
（[go2rtc issue #2205](https://github.com/AlexxIT/go2rtc/issues/2205)）。

> 上流の [PR #2253](https://github.com/AlexxIT/go2rtc/pull/2253)（Draft, 未マージ）は
> この1行だけを直すものです。本アドオンの調査では、**それだけでは再生できません**でした。

### 問題2: `hvcC` の中身が不完全

上流の go2rtc は `hvcC` (HEVCDecoderConfigurationRecord) に profile_tier_level の
先頭 3 バイトしか書いておらず、**`general_level_idc` / `chromaFormat` / `bitDepth` が
0 のまま**でした。

`hev1` ではブラウザが in-band のパラメータセットを読むので表面化しませんが、
`hvc1` ではブラウザは `hvcC` **だけ**を信頼します。結果:

```
CHUNK_DEMUXER_ERROR_APPEND_FAILED: Invalid video decoder config:
codec: hevc, profile: hevc main, level: not available,
coded size: [0,8], has extra data: false
```

`level: not available` が `general_level_idc = 0` を指しています。
そこで `hvcC` を SPS から正しく組み立て直しています。

### 問題3: カメラが SDP の `sprop-*` のラベルを取り違えている

`sprop-*` のラベルと中身がずれている H.265 カメラが実在します。
実例（SwitchBot カメラ）:

| SDP のラベル | 実際の中身 |
|---|---|
| `sprop-vps` | **PPS**（NAL type 34） |
| `sprop-sps` | **VPS**（NAL type 32） |
| `sprop-pps` | **SPS**（NAL type 33） |

上流はラベルをそのまま信じるため **VPS を SPS としてパース**してしまい、

- サンプルエントリの解像度が `0x8` になる → Chrome の `coded size: [0,8]`
- `hvcC` の `general_level_idc` が `0` になる → Chrome の `level: not available`

となります。**幅 0 の動画設定はブラウザにとって無条件で不正**なので、問題1と2を
直しても拒否され続けます。

そのため、パラメータセットは**ラベルではなく NAL unit type で振り分けて**います。
ラベルが正しいカメラでは何も変わりません。

### 問題4: アクセスユニットが丸ごと1つの NAL として届く

ここまで直すとブラウザは init セグメントを受理しますが、**今度はエラーも出ずに
画面が真っ暗**になります。go2rtc のグラフでは `mse/fmp4 → ブラウザ` が **0 B** のまま。

go2rtc は「最初のキーフレームが来るまで1バイトも送らない」設計です。つまり
**キーフレームが検出できていない**状態でした。

このカメラは VPS/SPS/PPS/IDR を連結したものを「1つの NAL」として送ってきます。
go2rtc はそれを型 32 (VPS) の単一 NAL として組み立てるため、`h265.IsKeyframe` が

```go
switch NALUType(b) { case 1: return false; case 19, 20, 21: return true }
size := binary.BigEndian.Uint32(b) + 4
if size < len(b) { b = b[size:]; continue } else { return false }
```

で、先頭の型 32 では判定がつかず、宣言長が AU 全体を覆っているため
`size < len(b)` が偽になって **false** を返していました。

そこで、この形の AU を検出して正しい AVCC（4 バイト長 + NAL）の並びに組み直します。
誤爆しないよう、次を **すべて** 満たすときだけ組み直します。

- AU がちょうど 1 つの NAL でできている（宣言長 + 4 == AU 長）
- その NAL の型が 32 (VPS) / 33 (SPS) / 34 (PPS)
- 中身に Annex-B の開始コード（`00 00 01` / `00 00 00 01`）が含まれている

普通のカメラではこの条件に当たらないので、何も変わりません。

## 当てているパッチ

ビルド時に上流ソースへ以下を当てています（[patch-hvc1.sh](./patch-hvc1.sh)）。

| ファイル | 変更 |
|---|---|
| `pkg/iso/codecs.go` | `m.StartAtom("hev1")` → `m.StartAtom("hvc1")`（問題1） |
| `pkg/iso/reader.go` | MP4 パーサが `hvc1` も受け付けるよう追加（`hev1` の互換は維持） |
| `pkg/h265/hvcc.go`（新規） | `EncodeConfigHVC1`（問題2）、`GetParameterSetHVC1`、`DecodeSPSHVC1`（問題3） |
| `pkg/h265/hvc1repair.go`（新規） | `RepairAggregatedAU`（問題4） |
| `pkg/h265/hvc1diag.go`（新規） | 映像が出ないときの診断（下記） |
| `pkg/mp4/muxer.go` | 上記を使うよう差し替え |
| `pkg/h265/rtp.go` | デペイロード直後に修復と計測を挟む |
| `pkg/mp4/consumer.go` | キーフレーム判定に計測を挟む |
| `main.go` | バージョン文字列に `-hvc1` を付与 |

`hvcc.go` がやっていること:

- SPS から emulation prevention byte (`0x03`) を除去したうえで、
  profile_tier_level の 12 バイト（profile/tier/idc + 互換フラグ 32bit +
  制約フラグ 48bit + `general_level_idc`）を `hvcC` の `[1]..[12]` に転記
  （生の NAL からコピーすると `0x03` の分だけ値がずれます）
- `chroma_format_idc` / `bit_depth_luma_minus8` / `bit_depth_chroma_minus8` /
  `numTemporalLayers` を SPS から解析して設定
- 解像度を conformance window 込みで計算（上流は CTU 境界に切り上げられた値を
  そのまま書くため、1620 の映像が 1624 になります）
- 予約ビットを規格どおり 1 で埋め、`array_completeness` を 1 にする

## 映像が出ないときの診断

go2rtc は最初のキーフレームが来るまで何も送らないため、キーフレームを検出できないと
**ブラウザ側はエラーも出さずに無音で止まります**。原因が外から分からないので、
アドオンの**ログタブ**に出るようにしてあります。

MSE / MP4 で視聴中に 10 秒キーフレームを検出できないと、こう出ます。

```
[hvc1-diag] H265 のキーフレームを 10s 検出できていません: <原因>
(rtp_packets=... access_units=... not_keyframe=... nal_types={型:個数(marker:個数)} last_au=[...])
[hvc1-diag]   キーフレーム候補の AU: count=... len=... types=[...] single_nal=... annexb_inside=... head=<先頭96バイトのhex>
```

- `access_units=0` なら RTP からアクセスユニットを組み立てられていない
- `access_units>0` かつ `not_keyframe>0` ならキーフレームと判定できていない
- `nal_types` にカメラが実際に使っている NAL unit type の内訳が出ます

正常に再生できているときは何も出しません。WebRTC / RTSP で視聴しているときも
出しません（そもそもキーフレーム待ちを通らないため）。最大 5 回・60 秒間隔です。

**この診断は問題4の特定にそのまま使えました。** 上流に報告する際にも、この1行が
あれば話が早いはずです。

## 検証済みの効果

同梱の Dockerfile でビルドしたイメージを実際に起動し、libx265 の H.265 ストリーム
（Main profile / yuv420p）を流して fMP4 を取得し、**同じ映像を ffmpeg が
`-tag:v hvc1` で multiplex した結果と突き合わせて**確認しています。

| `hvcC` のフィールド | 公式イメージ | 本アドオン | ffmpeg（基準） |
|---|---|---|---|
| サンプルエントリ名 | `hev1` | `hvc1` | `hvc1` |
| `general_level_idc` | **0** | **93** | 93 |
| `chromaFormat` | **0**（モノクロ） | **1**（4:2:0） | 1 |
| `bitDepthLuma` | 未設定 | 8 | 8 |
| `array_completeness` | 0 | 1 | 1 |
| ヘッダ + VPS/SPS/PPS 配列 | 不完全 | **ffmpeg とバイト単位で一致** | — |

さらに、**SwitchBot カメラが実際に返した SDP と、実機の診断が出した数値**を
テストデータとして使い、次を検証しています。

- 上流の挙動（サンプルエントリが `0x8` になること）を再現できること
- 振り分け修正後に `2592x1620` / `level 150` になること
- ラベルが正しい SDP では振り分けが何も変えないこと
- AU 丸ごと1 NAL の再現（`types=[32]` / `keyframe=false`）と、修復後に
  `types=[32 33 34 19]` / `keyframe=true` になること
- 修復が**触ってはいけないケース**（正常な AVCC / 通常の P フレーム /
  パラメータセット単体 / 開始コードの無い単一 VPS / スライス中にたまたま
  `00 00 01` が現れる場合）で無変更であること
- 診断が正常時・猶予時間内・MP4 コンシューマ未接続時に何も出さないこと

これらは `hvcc_test.go` としてビルドに組み込んであり、**通らなければイメージは
作られません**。H.264 ストリームは従来どおり `avc1` / `avcC` のままで、影響はありません。

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

> この文字列は**アドオンの版を区別しません**。どの版が入っているかは
> HA のアドオン画面のバージョン（例: `1.9.14.6`）で確認してください。

### 2. H.265 が再生できるか

`/config/go2rtc.yaml` にメインストリーム（H.265）をそのまま登録します。

```yaml
streams:
  security01: rtsp://Admin:***@192.168.100.212:554/live0
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
2. `config.json` の `version` を上げる（例: go2rtc 1.9.15 ベースの1回目なら `1.9.15.1`）
3. `CHANGELOG.md` に追記する

### バージョン表記について（重要）

`<上流バージョン>.<パッチ版の通し番号>` という**単純な数値表記**を使います。

`1.9.14-hvc1.1` のような `-` 付きの表記にしてはいけません。HA が比較に使う
`AwesomeVersion` はこれを SemVer と解釈し `-` 以降をプレリリース修飾子として扱うため、
基準の `1.9.14` 同士が同値になり `1.9.14-hvc1.2 > 1.9.14-hvc1.1` が **False** に
なります。その結果 HA が更新を検知せず、アップデートのたびにアンインストールが
必要になります（1.9.14.3 で修正済み）。

パッチが当たらなくなった場合（上流が該当箇所を書き換えた、あるいは本家で修正された
場合）は、`patch-hvc1.sh` が **ビルドを失敗させます**。パッチ未適用のイメージが
黙って出来上がることはありません。本家で修正が取り込まれたら、このアドオンは
不要になります。

## 既知の制限

- **HA 標準のカメラカードには効果が出ない場合があります。** ここで直しているのは MSE
  (`video-rtc.js` 経由 = go2rtc の Web UI や WebRTC Camera カード) の経路です。
  HA 標準カードが使う WebRTC は Chrome が H.265 に対応していないため、別の理由で
  再生できないことがあります
- H.265 の codec 文字列は上流が Level 5.1 (`hvc1.1.6.L153.B0`) 固定です。
  Level 5.1 の輝度サンプル数上限は 8,912,896 なので、4K (3840×2160 = 8,294,400) までは
  範囲内ですが、それを超える解像度では別途対応が必要です
- 問題3・問題4 は**カメラ側が規格から外れている**ことへの対処です。ここで想定して
  いない外れ方をするカメラでは、また別の対処が要るかもしれません。その場合は
  上記の診断ログが手がかりになります
- amd64 のみ対応です（ベースにしている公式ハードウェア版が amd64 のみのため）

## 参照

- go2rtc Issue #2205: https://github.com/AlexxIT/go2rtc/issues/2205
- go2rtc PR #2253 (Draft, 未マージ): https://github.com/AlexxIT/go2rtc/pull/2253
- go2rtc 本体: https://github.com/AlexxIT/go2rtc
- 公式アドオン: https://github.com/AlexxIT/hassio-addons
