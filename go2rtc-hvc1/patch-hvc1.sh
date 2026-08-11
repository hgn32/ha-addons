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
SRC_MUXER_CONSUMER="pkg/mp4/consumer.go"
expect_present "$SRC_MUXER" 'h265.EncodeConfig(vps, sps, pps)'
sed -i 's/h265\.EncodeConfig(vps, sps, pps)/h265.EncodeConfigHVC1(vps, sps, pps)/' "$SRC_MUXER"
expect_present "$SRC_MUXER" 'h265.EncodeConfigHVC1(vps, sps, pps)'
expect_absent  "$SRC_MUXER" 'h265.EncodeConfig(vps, sps, pps)'

# ---------------------------------------------------------------------------
# Bug C: SDP の sprop-* のラベルを信用しない
#
# SDP のラベルと中身がずれているカメラが実在する。実例 (SwitchBot):
#   sprop-vps の中身が PPS / sprop-sps の中身が VPS / sprop-pps の中身が SPS
#
# 上流はラベルをそのまま信じるため VPS を SPS としてパースしてしまい、
#   - サンプルエントリの解像度が 0x8 になる (Chrome: "coded size: [0,8]")
#   - hvcC の general_level_idc が 0 になる (Chrome: "level: not available")
# となってブラウザが init セグメントを拒否する。NAL unit type で振り分ける。
#
# 併せて解像度も conformance window 込みで求める (上流は CTU 境界に切り上げられた
# pic_height をそのまま書くため、1620 の映像が 1624 になる)。
# ---------------------------------------------------------------------------
expect_present "$SRC_MUXER" 'h265.GetParameterSet(codec.FmtpLine)'
sed -i 's/h265\.GetParameterSet(codec\.FmtpLine)/h265.GetParameterSetHVC1(codec.FmtpLine)/' "$SRC_MUXER"
expect_present "$SRC_MUXER" 'h265.GetParameterSetHVC1(codec.FmtpLine)'
expect_absent  "$SRC_MUXER" 'h265.GetParameterSet(codec.FmtpLine)'

expect_present "$SRC_MUXER" 'if s := h265.DecodeSPS(sps); s != nil {'
sed -i 's/if s := h265\.DecodeSPS(sps); s != nil {/if s := h265.DecodeSPSHVC1(sps); s != nil {/' "$SRC_MUXER"
expect_present "$SRC_MUXER" 'if s := h265.DecodeSPSHVC1(sps); s != nil {'
expect_absent  "$SRC_MUXER" 'if s := h265.DecodeSPS(sps); s != nil {'

# ---------------------------------------------------------------------------
# 診断: H.265 のキーフレームが検出できないときに原因をログに出す
#
# go2rtc は最初のキーフレームが来るまで何も送らないため、キーフレームを検出
# できないとブラウザ側はエラーも出ずに無音で止まる。原因が
#   (1) アクセスユニットが組み立てられていない
#   (2) 組み立てられているが IsKeyframe が false
# のどちらなのかは外から区別できないので、HA のログタブで分かるようにする。
# 正常時は何も出力しない。
# ---------------------------------------------------------------------------
[ -f "$PATCH_DIR/hvc1diag.go" ] || fail "missing $PATCH_DIR/hvc1diag.go"
[ -f "$PATCH_DIR/hvc1repair.go" ] || fail "missing $PATCH_DIR/hvc1repair.go"
if [ -e pkg/h265/hvc1diag.go ]; then
    fail "pkg/h265/hvc1diag.go already exists upstream; review the patch"
fi
if [ -e pkg/h265/hvc1repair.go ]; then
    fail "pkg/h265/hvc1repair.go already exists upstream; review the patch"
fi
cp "$PATCH_DIR/hvc1diag.go" pkg/h265/hvc1diag.go
cp "$PATCH_DIR/hvc1repair.go" pkg/h265/hvc1repair.go

# 診断が使う上流の関数が存在すること
expect_present pkg/h265/helper.go 'func IsKeyframe(b []byte) bool {'
expect_present pkg/h265/helper.go 'func Types(data []byte) []byte {'

SRC_RTP="pkg/h265/rtp.go"
expect_present "$SRC_RTP" 'nuType := (data[0] >> 1) & 0x3F'
sed -i 's/nuType := (data\[0\] >> 1) \& 0x3F/nuType := (data[0] >> 1) \& 0x3F; DiagRTP(nuType, packet.Marker, data)/' "$SRC_RTP"
expect_present "$SRC_RTP" 'DiagRTP(nuType, packet.Marker, data)'

expect_present "$SRC_RTP" 'clone.Version = h264.RTPPacketVersionAVC'
sed -i 's/clone\.Version = h264\.RTPPacketVersionAVC/clone.Version = h264.RTPPacketVersionAVC; buf = RepairAggregatedAU(buf); DiagAU(buf)/' "$SRC_RTP"
expect_present "$SRC_RTP" 'RepairAggregatedAU(buf); DiagAU(buf)'

expect_present "$SRC_MUXER_CONSUMER" 'if !h265.IsKeyframe(packet.Payload) {'
sed -i 's/if !h265\.IsKeyframe(packet\.Payload) {/if !h265.IsKeyframeDiag(packet.Payload) {/' "$SRC_MUXER_CONSUMER"
expect_present "$SRC_MUXER_CONSUMER" 'if !h265.IsKeyframeDiag(packet.Payload) {'
expect_absent  "$SRC_MUXER_CONSUMER" 'if !h265.IsKeyframe(packet.Payload) {'

# 診断は MP4/MSE のコンシューマが接続したときだけ有効にする。WebRTC や RTSP で
# 視聴している場合は「最初のキーフレーム待ち」を通らないので、キーフレームが
# 記録されないのは正常であり、警告を出してはいけない。
expect_present "$SRC_MUXER_CONSUMER" 'init, err := c.muxer.GetInit()'
sed -i 's/init, err := c\.muxer\.GetInit()/h265.DiagArm(); init, err := c.muxer.GetInit()/' "$SRC_MUXER_CONSUMER"
expect_present "$SRC_MUXER_CONSUMER" 'h265.DiagArm(); init, err := c.muxer.GetInit()'

# ---------------------------------------------------------------------------
# go2rtc の app.Version は **書き換えない**。
#
# 以前は "-hvc1" を足してパッチ版だと分かるようにしていたが、Home Assistant コアの
# go2rtc 統合がサーバのバージョンを
#     if version < AwesomeVersion(RECOMMENDED_VERSION)   # "1.9.14"
# で比較しており、AwesomeVersion は "1.9.14-hvc1+dev..." を SemVer と解釈して
# "-" 以降をプレリリース修飾子として扱う。その結果 1.9.14 より古いと判定され、
# 「古い go2rtc サーバーが検出されました」の修理項目が出てしまった。
#
# 識別は pkg/h265/hvc1diag.go の init() が出す "[hvc1] patched build: ..." の行で行う。
# ---------------------------------------------------------------------------
expect_absent main.go 'app.Version = "1.9.14-hvc1"'

echo "patch-hvc1: applied successfully"
grep -n 'StartAtom("hvc1")' "$SRC_WRITER"
grep -n 'case "avc1", "hev1", "hvc1":' "$SRC_READER"
grep -n 'h265.EncodeConfigHVC1\|h265.GetParameterSetHVC1\|h265.DecodeSPSHVC1' "$SRC_MUXER"
grep -n 'h265.IsKeyframeDiag' "$SRC_MUXER_CONSUMER"
grep -n 'DiagRTP\|RepairAggregatedAU' "$SRC_RTP"
grep -n 'app.Version =' main.go
