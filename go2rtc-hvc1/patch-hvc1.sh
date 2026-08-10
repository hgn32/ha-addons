#!/bin/sh
# go2rtc の H.265 (HEVC) MSE 再生バグを修正するビルド時パッチ。
# go2rtc issue #2205 / PR #2253 相当。
#
# 実行位置: go2rtc のソースツリーのルート (Dockerfile の /build)
#
# 重要: sed は「1件も置換しなかった」場合でも終了コード 0 を返す。
# 上流のソースが変わってパターンに当たらなくなったとき、パッチが当たっていない
# のにビルドが成功してしまうのが最悪のケースなので、置換の前後を必ず grep で
# 検証し、想定と違えば非 0 で終了してビルドを失敗させる。
#
# 移植性: busybox sh / busybox sed (alpine) で動くよう、GNU 拡張 (\s など) は
# 使わずに POSIX の範囲で書く。

set -eu

fail() {
    echo "patch-hvc1: ERROR: $1" >&2
    exit 1
}

# 固定文字列が存在することを確認する
expect_present() {
    grep -qF "$2" "$1" || fail "expected pattern not found in $1: $2"
}

# 固定文字列が消えていることを確認する
# ( `! grep` は set -e が効かない文脈になり得るため if 文で明示的に書く )
expect_absent() {
    if grep -qF "$2" "$1"; then
        fail "pattern should have been replaced in $1: $2"
    fi
}

# 正規表現にマッチする行が存在することを確認する
expect_match() {
    grep -qE "$2" "$1" || fail "expected regexp not matched in $1: $2"
}

# ---------------------------------------------------------------------------
# Bug A (本命): fMP4 の init セグメントに書くサンプルエントリ名を hev1 -> hvc1
#
# go2rtc はブラウザに `hvc1.1.6.L153.B0` と宣言し、パラメータセットも hvcC に
# out-of-band で書いているのに、サンプルエントリ名だけ hev1 になっている。
# Chrome/Edge 120+ はこの不一致で init セグメントを拒否する。
# ---------------------------------------------------------------------------
SRC_WRITER="pkg/iso/codecs.go"
expect_present "$SRC_WRITER" 'm.StartAtom("hev1")'
sed -i 's/m\.StartAtom("hev1")/m.StartAtom("hvc1")/' "$SRC_WRITER"
expect_present "$SRC_WRITER" 'm.StartAtom("hvc1")'
expect_absent  "$SRC_WRITER" 'm.StartAtom("hev1")'

# ---------------------------------------------------------------------------
# 併せて MP4 パーサ側も hvc1 を受け付けるようにする。
#
# go2rtc の MP4 リーダは avc1 / hev1 しか解釈しないため、書き出し側だけ hvc1 に
# すると「go2rtc が自分で書いた MP4 (や hvc1 の MP4 入力) を読み戻せない」状態に
# なる。hev1 のパース互換は保ったまま hvc1 を追加する。
# ---------------------------------------------------------------------------
SRC_READER="pkg/iso/reader.go"
expect_present "$SRC_READER" 'case "avc1", "hev1":'
sed -i 's/case "avc1", "hev1":/case "avc1", "hev1", "hvc1":/' "$SRC_READER"
expect_present "$SRC_READER" 'case "avc1", "hev1", "hvc1":'
expect_absent  "$SRC_READER" 'case "avc1", "hev1":'

# ---------------------------------------------------------------------------
# バージョン文字列にパッチ済みであることを埋め込む。
#
# ユーザーが確認できるのは HA の画面 (アドオンのログタブ / go2rtc の Web UI) だけ
# なので、そこに出るバージョン表記でパッチ版だと分かるようにしておく。
# ---------------------------------------------------------------------------
SRC_MAIN="main.go"
expect_match "$SRC_MAIN" '^[[:space:]]*app\.Version = "[0-9][0-9.]*"$'
sed -i 's/app\.Version = "\([0-9][0-9.]*\)"/app.Version = "\1-hvc1"/' "$SRC_MAIN"
expect_match "$SRC_MAIN" '^[[:space:]]*app\.Version = "[0-9][0-9.]*-hvc1"$'

echo "patch-hvc1: applied successfully"
grep -n 'StartAtom("hvc1")' "$SRC_WRITER"
grep -n 'case "avc1", "hev1", "hvc1":' "$SRC_READER"
grep -n 'app.Version =' "$SRC_MAIN"
