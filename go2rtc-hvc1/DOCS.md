# go2rtc (hvc1 patched)

公式 go2rtc の **ハードウェア版** に、H.265 (HEVC) がブラウザの MSE で再生できない
バグ ([go2rtc issue #2205](https://github.com/AlexxIT/go2rtc/issues/2205)) の修正を
当てたアドオンです。

H.265 のメインストリームを **トランスコードなし・画質劣化なし** でブラウザ表示
できるようになります。

---

## ⚠️ 最初に必ず読んでください

**公式 go2rtc アドオンと同時に起動できません。**

どちらも `host_network` で :1984 / :8554 / :8555 を使うため、同時に動かすと
ポートが衝突して片方が起動に失敗します。この事故を防ぐため、本アドオンは
**既定では自動起動しません**（起動時に開始 = オフ）。

設定ファイルは公式アドオンと同じ `/config/go2rtc.yaml` を読みます。
**設定の移行作業は不要** です。

---

## 切り替え手順

1. **設定 → システム → バックアップ** でバックアップを取る
   （`/config/go2rtc.yaml` が含まれます）
2. 公式の go2rtc アドオンを開き、**停止** して「**起動時に開始**」を **オフ**
3. 本アドオンをインストール
4. 本アドオンの「**保護モード**」を **オフ** にする
   - ハードウェア支援（VAAPI / QSV / CUDA）のために `full_access` を使うため必要です。
     公式のハードウェア版と同じ要件です
5. 本アドオンを **起動**
6. 下の「動作確認」が通ったら、「**起動時に開始**」を **オン** にする

> 手順 6 を忘れると、Home Assistant を再起動したときにカメラが映らなくなります。

---

## 動作確認

### 1. パッチ版が動いているか（ログタブ）

このアドオンの **ログ** タブを開くと、起動時に次の行が出ます。

```
INF go2rtc platform=linux/amd64 revision=... version=1.9.14-hvc1+dev....
```

`version` に **`-hvc1`** が入っていれば、パッチ版のバイナリが動いています。

`+dev.<commit>.dirty` の部分は「上流のタグ付きリリースにローカル修正を加えた
ビルド」であることを Go が自動で付ける表記です。異常ではありません。

> この go2rtc 側のバージョン文字列は**アドオンの版を区別しません**（1.9.14.3 でも
> 1.9.14-hvc1.1 でも同じ `1.9.14-hvc1+dev...` になります）。どの版が入っているかは
> HA のアドオン画面に出るバージョン（例: `1.9.14.3`）で確認してください。

### 2. H.265 が再生できるか（Ingress パネル）

`/config/go2rtc.yaml` に H.265 のメインストリームをそのまま登録します。

```yaml
streams:
  security01_h265: rtsp://Admin:パスワード@192.168.100.212:554/live0
```

保存したらアドオンを再起動し、サイドバーの **go2rtc (hvc1 patched)** パネルを開いて、
該当ストリームの **`stream`** または **`mse`** リンクから映像が出ることを確認します。

公式アドオンでは、ここで映像が出ずにブラウザのコンソールに
`CHUNK_DEMUXER_ERROR_APPEND_FAILED` が出ていました。

### 3. トランスコードが走っていないこと

Ingress パネルのストリーム一覧で、該当ストリームの `producers` に **ffmpeg が
現れないこと** を確認します。RTSP が直接 producer になっていれば、
デコード・エンコードは一切行われていません（CPU 負荷は転送のみ）。

---

## 元に戻す（ロールバック）

1. 本アドオンを **停止**、「起動時に開始」を **オフ**
2. 公式 go2rtc アドオンを **起動**、「起動時に開始」を **オン**
3. `/config/go2rtc.yaml` の H.265 直参照を元に戻す
   （例: H.264 のサブストリーム `rtsp://.../live1` に戻す）

> ⚠️ 設定ファイルは公式アドオンと共有です。**H.265 直参照のまま公式版に戻すと
> 再生できなくなります。** 手順 3 を忘れないでください。

---

## 修正の内容

go2rtc は fMP4 の init セグメントに `hev1` サンプルエントリを書きながら、ブラウザには
MIME で `hvc1.1.6.L153.B0` と宣言していました。ISO/IEC 14496-15 §8.4.1 では、

- `hvc1` … パラメータセット (VPS/SPS/PPS) を `hvcC` に out-of-band で格納
- `hev1` … パラメータセットは in-band でも `hvcC` でも可

という別物です。Chrome / Edge 120 以降は宣言と実物の不一致を理由に init セグメントを
拒否します。go2rtc はパラメータセットを既に `hvcC` に正しく書いているため、
ボックス名を `hvc1` に直すのが正しい修正になります。

さらに、ボックス名を直すだけでは足りませんでした。上流の go2rtc は `hvcC`
(HEVCDecoderConfigurationRecord) に profile_tier_level の先頭 3 バイトしか書いて
おらず、`general_level_idc` / `chromaFormat` / `bitDepth` が 0 のままです。
`hev1` ならブラウザは in-band のパラメータセットを読むので表面化しませんが、
`hvc1` ではブラウザは `hvcC` だけを信頼するため、

```
CHUNK_DEMUXER_ERROR_APPEND_FAILED: Invalid video decoder config:
codec: hevc, profile: hevc main, level: not available, coded size: [0,8]
```

で拒否されます。そこで `hvcC` も SPS から組み立て直しています。

さらに、`sprop-*` のラベルと中身がずれている H.265 カメラが実在します
（SwitchBot カメラで確認: `sprop-vps` の中身が PPS、`sprop-sps` の中身が VPS、
`sprop-pps` の中身が SPS）。上流はラベルを信じるため **VPS を SPS としてパース**
してしまい、サンプルエントリの解像度が `0x8`、`general_level_idc` が `0` になります。
Chrome の `coded size: [0,8]` / `level: not available` はこれをそのまま表しています。
そのため、パラメータセットはラベルではなく **NAL unit type で振り分け**ています。

ビルド時に上流ソースへ当てている変更:

| ファイル | 変更 |
|---|---|
| `pkg/iso/codecs.go` | `m.StartAtom("hev1")` → `m.StartAtom("hvc1")` |
| `pkg/iso/reader.go` | MP4 パーサが `hvc1` も受け付けるよう追加（`hev1` 互換は維持） |
| `pkg/h265/hvcc.go`（新規） | 完全な `hvcC` の組み立て、NAL type による振り分け、conformance window 込みの解像度 |
| `pkg/mp4/muxer.go` | 上記を使うよう差し替え |
| `main.go` | バージョン文字列に `-hvc1` を付与 |

実イメージで検証した結果（同じ映像を ffmpeg が `-tag:v hvc1` で multiplex した
ものを基準にした比較）:

| `hvcC` のフィールド | 公式イメージ | 本アドオン | ffmpeg（基準） |
|---|---|---|---|
| サンプルエントリ名 | `hev1` | `hvc1` | `hvc1` |
| `general_level_idc` | **0** | **93** | 93 |
| `chromaFormat` | **0**（モノクロ） | **1**（4:2:0） | 1 |
| `bitDepthLuma` | 未設定 | 8 | 8 |
| 先頭 23 バイト | 不完全 | ffmpeg と一致 | — |
| H.264 ストリーム | `avc1` / `avcC` | `avc1` / `avcC`（影響なし） | — |

---

## 既知の制限

- **Home Assistant 標準のカメラカードでは効果が出ない場合があります。**
  このバグは MSE（go2rtc の Web UI や WebRTC Camera カードが使う経路）のものです。
  HA 標準カードが使う WebRTC は Chrome が H.265 に対応していないため、別の理由で
  再生できないことがあります
- H.265 の codec 文字列は上流が Level 5.1 (`hvc1.1.6.L153.B0`) 固定です。
  4K (3840×2160) までは Level 5.1 の範囲内ですが、それを超える解像度では別途対応が
  必要です
- 自前ビルドのため、go2rtc の更新には自動追従しません
- amd64 のみ対応です（ベースにしている公式ハードウェア版が amd64 のみのため）
