#!/bin/sh
# go2rtc の H.265 (HEVC) MSE 再生バグを修正するビルド時パッチ。
# go2rtc issue #2205 / PR #2253 + hvcC (HEVCDecoderConfigurationRecord) の修正。
#
# 実行位置: go2rtc のソースツリーのルート (Dockerfile の /build)
# 第1引数: 追加ソース (hvcc.go / hvcc_test.go) が置いてあるディレクトリ
#
# 重要: sed は「1件も置換しなかった」場合でも終了コード 0 を返す。
# 上流のソースが変わってパターンに当たらなくなったとき、パッチが当たっていない
# のにビルドが成功してしまうのが最悪のケースなので、置換の前後を必ず grep で
# 検証し、想定と違えば非 0 で終了してビルドを失敗させる。
#
# 移植性: busybox sh / busybox sed (alpine) で動くよう、GNU 拡張 (\s など) は
# 使わずに POSIX の範囲で書く。

set -eu

PATCH_DIR="${1:-/patch}"

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
# Bug A-2 (本命その2): hvcC (HEVCDecoderConfigurationRecord) を正しく埋める
#
# 上流の h265.EncodeConfig は profile_tier_level の先頭 3 バイトしか書かず、
# general_level_idc / chromaFormat / bitDepth を 0 のまま残す。
# `hev1` ならブラウザは in-band のパラメータセットを読むので再生できるが、
# `hvc1` ではブラウザは hvcC だけを信頼するため、サンプルエントリ名を直しただけ
# では Chrome/Edge が
#   "Invalid video decoder config: ... level: not available, ... chroma ..."
# で init セグメントを拒否する。
#
# 完全な hvcC を組み立てる EncodeConfigHVC1 を pkg/h265 に追加し、MP4 muxer の
# 呼び出しをそちらに差し替える。同じ SPS に対して ffmpeg が書く hvcC と先頭 23
# バイトが一致することを hvcc_test.go でビルド時に検証する。
# ---------------------------------------------------------------------------
[ -f "$PATCH_DIR/hvcc.go" ] || fail "missing $PATCH_DIR/hvcc.go"
[ -f "$PATCH_DIR/hvcc_test.go" ] || fail "missing $PATCH_DIR/hvcc_test.go"
[ -d pkg/h265 ] || fail "pkg/h265 not found"

# 追加先が既に存在する = 上流が同名の実装を入れた可能性があるので止める
if [ -e pkg/h265/hvcc.go ]; then
    fail "pkg/h265/hvcc.go already exists upstream; review the patch"
fi

# EncodeConfigHVC1 は上流の EncodeConfig を土台にするので、存在を確認する
expect_present pkg/h265/mpeg4.go 'func EncodeConfig(vps, sps, pps []byte) []byte'

cp "$PATCH_DIR/hvcc.go" pkg/h265/hvcc.go
cp "$PATCH_DIR/hvcc_test.go" pkg/h265/hvcc_test.go

SRC_MUXER="pkg/mp4/muxer.go"
expect_present "$SRC_MUXER" 'h265.EncodeConfig(vps, sps, pps)'
sed -i 's/h265\.EncodeConfig(vps, sps, pps)/h265.EncodeConfigHVC1(vps, sps, pps)/' "$SRC_MUXER"
expect_present "$SRC_MUXER" 'h265.EncodeConfigHVC1(vps, sps, pps)'
expect_absent  "$SRC_MUXER" 'h265.EncodeConfig(vps, sps, pps)'

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
grep -n 'h265.EncodeConfigHVC1' "$SRC_MUXER"
grep -n 'app.Version =' "$SRC_MAIN"
