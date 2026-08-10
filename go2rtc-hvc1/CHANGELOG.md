## 1.9.14.4

- **修正: SwitchBot カメラで H.265 が再生できなかった真の原因**
  - 症状: Chrome/Edge が `CHUNK_DEMUXER_ERROR_APPEND_FAILED: Invalid video
    decoder config: ... level: not available, coded size: [0,8],
    has extra data: false` で init セグメントを拒否する
  - 原因: **カメラが SDP の `sprop-*` のラベルを取り違えて送っていた**

    | SDP のラベル | 実際の中身 |
    |---|---|
    | `sprop-vps` | PPS (NAL type 34) |
    | `sprop-sps` | VPS (NAL type 32) |
    | `sprop-pps` | SPS (NAL type 33) |

    上流の go2rtc はラベルをそのまま信じるため、**VPS を SPS としてパース**して
    しまい、サンプルエントリの解像度が `0x8` に、`hvcC` の
    `general_level_idc` が `0` になっていた。Chrome の
    `coded size: [0,8]` / `level: not available` はこれをそのまま表している
  - 対策: パラメータセットを **ラベルではなく NAL unit type で振り分ける**
    ようにした。ラベルが正しいカメラでは挙動は変わらない
  - 併せて解像度を conformance window 込みで求めるようにした
    (上流は CTU 境界に切り上げられた値をそのまま書くため 1620 の映像が 1624 になる)
  - `array_completeness` を 1 にした (`hvc1` ではパラメータセットは全て `hvcC` に
    ある、という意味。ffmpeg も同じ)
- 検証: このカメラの実際の SDP を使ったテストをビルドに組み込んだ。
  上流の挙動 (0x8 になること) の再現と、修正後に 2592x1620 / level 150 になること、
  および `hvcC` が **ffmpeg の出力とバイト単位で一致**することを検証している

## 1.9.14.3

- **修正: アップデートが検知されず、毎回アンインストールが必要だった問題**
  - 原因: バージョン表記 `1.9.14-hvc1.N` を HA の `AwesomeVersion` が SemVer と
    解釈し、`-` 以降をプレリリース修飾子として扱うため
    `1.9.14-hvc1.2 > 1.9.14-hvc1.1` が **False** になっていた
  - 対策: `<上流バージョン>.<パッチ版の通し番号>` という数値のみの表記に変更
- 中身は 1.9.14-hvc1.2 と同じ(バージョン表記のみの変更)

## 1.9.14-hvc1.2

- **修正: `hvcC` (HEVCDecoderConfigurationRecord) が不完全だった問題**
  - 上流は profile_tier_level の先頭 3 バイトしか書かず、
    `general_level_idc` / `chromaFormat` / `bitDepth` が 0 のままだった。
    `hev1` ではブラウザが in-band のパラメータセットを読むので表面化しないが、
    `hvc1` ではブラウザは `hvcC` だけを信頼するため設定不正として弾かれる
  - 対策: `hvcC` を SPS から正しく組み立て直すようにした
