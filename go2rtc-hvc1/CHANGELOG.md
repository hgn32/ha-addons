## 1.9.14-hvc1.1

- 初期リリース(go2rtc 1.9.14 ベース)
- H.265(HEVC) が MSE で再生できないバグを修正
  ([go2rtc issue #2205](https://github.com/AlexxIT/go2rtc/issues/2205))
  - fMP4 の init セグメントのサンプルエントリ名を `hev1` → `hvc1` に変更。
    go2rtc はブラウザに `hvc1.1.6.L153.B0` と宣言しながら `hev1` を書いていたため、
    Chrome/Edge 120 以降が init セグメントを拒否していた
  - 併せて MP4 パーサ側も `hvc1` を受け付けるようにした(`hev1` の互換は維持)
- 公式の **go2rtc (hardware)** イメージがベース。ffmpeg と
  Intel VAAPI/QSV・AMD VAAPI・NVIDIA CUDA のハードウェア支援はそのまま使える
- 公式アドオンと同じ `/config/go2rtc.yaml` を読むため設定の移行は不要
- 公式アドオンとポート(:1984 / :8554 / :8555)が衝突するため、既定では
  自動起動しない(`boot: manual`)
