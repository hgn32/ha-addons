## 1.9.14.3

- **修正: アップデートが検知されず、毎回アンインストールが必要だった問題**
  - 症状: 新しいバージョンを公開しても HA が「最新」と表示し、
    アップデートボタンが押せない
  - 原因: バージョン表記 `1.9.14-hvc1.N` が悪かった。HA が比較に使う
    `AwesomeVersion` はこれを SemVer と解釈し、`-` 以降をプレリリース修飾子として
    扱う。基準の `1.9.14` 同士が同値になるため
    `1.9.14-hvc1.2 > 1.9.14-hvc1.1` が **False** になっていた
  - 対策: 単純な数値表記 `<上流バージョン>.<パッチ版の通し番号>` に変更した
    (例: go2rtc 1.9.14 ベースの3回目 → `1.9.14.3`)。
    これは `AwesomeVersion` が SimpleVer として素直に比較でき、
    `1.9.14.3 > 1.9.14-hvc1.2` も `True` になるため、
    **今回はアンインストールなしで更新できる**
- 中身は 1.9.14-hvc1.2 と同じ(バージョン表記のみの変更)

## 1.9.14-hvc1.2

- **修正: 1.9.14-hvc1.1 では H.265 がまだ再生できなかった問題**
  - 症状: Chrome/Edge が
    `CHUNK_DEMUXER_ERROR_APPEND_FAILED: Invalid video decoder config:
    codec: hevc, profile: hevc main, level: not available,
    coded size: [0,8], has extra data: false` で init セグメントを拒否する
  - 原因: サンプルエントリ名を `hvc1` に直すだけでは足りなかった。上流の
    go2rtc は `hvcC` (HEVCDecoderConfigurationRecord) に profile_tier_level の
    先頭 3 バイトしか書いておらず、**general_level_idc / chromaFormat /
    bitDepth が 0 のまま**だった。`hev1` ならブラウザは in-band の
    パラメータセットを読むので問題にならないが、`hvc1` ではブラウザは `hvcC`
    だけを信頼するため設定不正として弾かれる
  - 対策: `hvcC` を SPS から正しく組み立て直すようにした
    (emulation prevention byte を除去したうえで profile_tier_level 12 バイトを
    転記し、chroma_format_idc / bit_depth / numTemporalLayers を SPS から解析)
  - 同じ SPS に対して **ffmpeg が書く `hvcC` と先頭 23 バイトが一致する**ことを
    ビルド時のテストで検証している(一致しなければイメージは作られない)

## 1.9.14-hvc1.1

- 初期リリース(go2rtc 1.9.14 ベース)
- H.265(HEVC) が MSE で再生できないバグの修正
  ([go2rtc issue #2205](https://github.com/AlexxIT/go2rtc/issues/2205))
  - fMP4 の init セグメントのサンプルエントリ名を `hev1` → `hvc1` に変更
  - 併せて MP4 パーサ側も `hvc1` を受け付けるようにした(`hev1` の互換は維持)
- 公式の **go2rtc (hardware)** イメージがベース
- 公式アドオンと同じ `/config/go2rtc.yaml` を読むため設定の移行は不要
