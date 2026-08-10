package h265

import (
	"encoding/base64"
	"encoding/hex"
	"io"
	"os"
	"strings"
	"testing"
	"time"
)

// --- 基準1: ffmpeg ---
// libx265 (Main / 1280x720 / yuv420p) の同じ映像を go2rtc に通したときの
// VPS/SPS/PPS と、それを ffmpeg が -tag:v hvc1 で multiplex したときの hvcC。
// ffmpeg は SEI 配列も足すので、先頭3配列 (VPS/SPS/PPS) までを比較対象とし、
// numOfArrays は 3 に直してある。
const (
	testVPS  = "40010c01ffff01600000030090000003000003005d959409"
	testSPS  = "42010101600000030090000003000003005da00280802d16595952930bc05a020000030002000003001e10"
	testPPS  = "4401c073c089"
	wantHVCC = "0101600000009000000000005df000fcfdf8f800000f03a00001001840010c01ffff01600000030090000003000003005d959409a10001002b42010101600000030090000003000003005da00280802d16595952930bc05a020000030002000003001e10a2000100064401c073c089"
	// 上流 go2rtc が書く壊れた hvcC ヘッダ (level/chroma/bitDepth が 0)
	upstreamHVCC = "0101600000000000000000000000000000000000000303"
)

// --- 基準2: 実機カメラ ---
// SwitchBot カメラ (/live0) が実際に返した SDP の fmtp 行。
// sprop-* のラベルと中身がずれている。
const camFmtp = "sprop-vps=RAHA98Dm2Q==;sprop-sps=QAEMAf//IUAAAAMAkAAAAwAAAwCWJQJA;sprop-pps=QgEBIUAAAAMAkAAAAwAAAwCWoAFEIAZZ956W5EoXNQEBAQQAAAMABAAAAwA8IA=="

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatalf("bad hex: %v", err)
	}
	return b
}

func TestEncodeConfigHVC1MatchesFFmpeg(t *testing.T) {
	vps := mustHex(t, testVPS)
	sps := mustHex(t, testSPS)
	pps := mustHex(t, testPPS)

	// 上流が壊れていることの回帰検知
	if got := hex.EncodeToString(EncodeConfig(vps, sps, pps)[:23]); got != upstreamHVCC {
		t.Fatalf("上流の出力が想定と違う: %s", got)
	}
	if b := mustHex(t, upstreamHVCC); b[12] != 0 {
		t.Fatalf("上流の general_level_idc が 0 でない: %d", b[12])
	}

	// ヘッダ + VPS/SPS/PPS の3配列まで ffmpeg と完全一致すること
	want := mustHex(t, wantHVCC)
	got := EncodeConfigHVC1(vps, sps, pps)
	if len(got) != len(want) {
		t.Fatalf("長さ不一致: got %d want %d", len(got), len(want))
	}
	if hex.EncodeToString(got) != hex.EncodeToString(want) {
		t.Fatalf("hvcC が ffmpeg と不一致\n got: % x\nwant: % x", got, want)
	}
	t.Logf("ffmpeg と完全一致 (%d bytes): % x ...", len(got), got[:23])
}

func TestCameraMislabeledSprop(t *testing.T) {
	// 上流の挙動: ラベルを信じる -> VPS を SPS としてパースしてしまう
	_, badSPS, _ := GetParameterSet(camFmtp)
	if nalType(badSPS) != nalVPS {
		t.Fatalf("この再現テストの前提が崩れている: sprop-sps の NAL type = %d", nalType(badSPS))
	}
	s := DecodeSPS(badSPS)
	if s == nil {
		t.Fatal("上流の DecodeSPS が nil を返した (再現の前提と違う)")
	}
	if s.Width() != 0 || s.Height() != 8 {
		t.Fatalf("再現失敗: got %dx%d, want 0x8 (Chrome の coded size: [0,8])", s.Width(), s.Height())
	}
	t.Logf("上流の挙動を再現: サンプルエントリに %dx%d が書かれる", s.Width(), s.Height())

	// 修正後: NAL type で振り分ける
	vps, sps, pps := GetParameterSetHVC1(camFmtp)
	if nalType(vps) != nalVPS || nalType(sps) != nalSPS || nalType(pps) != nalPPS {
		t.Fatalf("振り分け失敗: vps=%d sps=%d pps=%d", nalType(vps), nalType(sps), nalType(pps))
	}

	size := DecodeSPSHVC1(sps)
	if size == nil {
		t.Fatal("DecodeSPSHVC1 が nil")
	}
	if size.Width() != 2592 || size.Height() != 1620 {
		t.Fatalf("解像度が違う: got %dx%d, want 2592x1620", size.Width(), size.Height())
	}
	t.Logf("修正後: %dx%d (conformance window 適用済み)", size.Width(), size.Height())

	rec := EncodeConfigHVC1(vps, sps, pps)
	if rec[12] == 0 {
		t.Fatal("general_level_idc がまだ 0")
	}
	if rec[16]&3 != 1 {
		t.Fatalf("chromaFormat が 4:2:0 でない: %d", rec[16]&3)
	}
	t.Logf("修正後の hvcC: level=%d chroma=%d bitDepth=%d", rec[12], rec[16]&3, 8+(rec[17]&7))

	// 宣言している codec 文字列 hvc1.1.6.L153.B0 (level 5.1 = 153) の範囲内であること
	if rec[12] > 153 {
		t.Fatalf("実レベル %d が宣言 153 を超えている", rec[12])
	}
}

func TestGetParameterSetHVC1NoopWhenLabelsCorrect(t *testing.T) {
	// ラベルが正しいカメラでは何も変えないこと
	enc := base64.StdEncoding.EncodeToString
	fmtp := "sprop-vps=" + enc(mustHex(t, testVPS)) +
		";sprop-sps=" + enc(mustHex(t, testSPS)) +
		";sprop-pps=" + enc(mustHex(t, testPPS))

	v1, s1, p1 := GetParameterSet(fmtp)
	v2, s2, p2 := GetParameterSetHVC1(fmtp)
	if hex.EncodeToString(v1) != hex.EncodeToString(v2) ||
		hex.EncodeToString(s1) != hex.EncodeToString(s2) ||
		hex.EncodeToString(p1) != hex.EncodeToString(p2) {
		t.Fatal("ラベルが正しいのに入れ替わってしまった")
	}
}

// --- 診断のテスト ---
// 「正常なときは何も出さない」「壊れているときだけ原因を出す」を固定する。

func captureStderr(f func()) string {
	old := os.Stderr
	r, w, err := os.Pipe()
	if err != nil {
		panic(err)
	}
	os.Stderr = w
	f()
	_ = w.Close()
	os.Stderr = old
	b, _ := io.ReadAll(r)
	return string(b)
}

func newDiag(age time.Duration) *hvc1Diag {
	d := &hvc1Diag{
		nalSeen:   make(map[byte]uint64),
		nalMarker: make(map[byte]uint64),
	}
	d.firstPacket = time.Now().Add(-age)
	d.armedAt = d.firstPacket // MP4/MSE のコンシューマが接続済みの想定
	return d
}

func report(d *hvc1Diag) string {
	return captureStderr(func() {
		d.mu.Lock()
		d.reportLocked()
		d.mu.Unlock()
	})
}

func TestDiagSilentWhenHealthy(t *testing.T) {
	d := newDiag(60 * time.Second)
	d.rtpPackets = 10000
	d.auEmitted = 300
	d.keyframes = 10 // 再生できている
	if out := report(d); out != "" {
		t.Fatalf("正常時に出力があった: %q", out)
	}

	// キーフレームがまだでも猶予時間内なら黙っている
	d2 := newDiag(2 * time.Second)
	d2.rtpPackets = 100
	if out := report(d2); out != "" {
		t.Fatalf("猶予時間内に出力があった: %q", out)
	}
}

func TestDiagReportsNoAccessUnit(t *testing.T) {
	d := newDiag(15 * time.Second)
	d.rtpPackets = 5000
	d.nalSeen[19] = 20
	d.nalSeen[1] = 4000
	d.nalSeen[40] = 20
	d.nalMarker[40] = 20 // suffix SEI がマーカーを持っている
	// auEmitted = 0

	out := report(d)
	if out == "" {
		t.Fatal("AU が0なのに何も出なかった")
	}
	for _, want := range []string{"アクセスユニットが1つも", "rtp_packets=5000", "access_units=0", "40:20(marker:20)"} {
		if !strings.Contains(out, want) {
			t.Fatalf("出力に %q が含まれない:\n%s", want, out)
		}
	}
	t.Log(strings.TrimSpace(out))
}

func TestDiagReportsNotKeyframe(t *testing.T) {
	d := newDiag(15 * time.Second)
	d.rtpPackets = 5000
	d.auEmitted = 150
	d.auNotKey = 150
	d.nalSeen[1] = 5000
	d.lastAUTypes = []byte{1}

	out := report(d)
	if out == "" {
		t.Fatal("キーフレーム未検出なのに何も出なかった")
	}
	for _, want := range []string{"キーフレームと判定されていない", "access_units=150", "not_keyframe=150"} {
		if !strings.Contains(out, want) {
			t.Fatalf("出力に %q が含まれない:\n%s", want, out)
		}
	}
	t.Log(strings.TrimSpace(out))
}

func TestDiagRTPUnwrapsFU(t *testing.T) {
	// FU (49) の開始断片からは中身の本当の型 (19) を記録すること
	saved := diag
	defer func() { diag = saved }()
	diag = newDiag(0)

	fuStart := []byte{49 << 1, 1, 0b10<<6 | 19, 0xAA}
	DiagRTP(49, false, fuStart)

	diag.mu.Lock()
	defer diag.mu.Unlock()
	if diag.nalSeen[19] != 1 {
		t.Fatalf("FU の中身が展開されていない: %v", diag.nalSeen)
	}
	if diag.nalSeen[49] != 0 {
		t.Fatalf("FU の型のまま記録されている: %v", diag.nalSeen)
	}
}

func TestDiagSilentWhenNotArmed(t *testing.T) {
	// WebRTC / RTSP で視聴中: MP4 コンシューマがいないので警告してはいけない
	d := newDiag(60 * time.Second)
	d.armedAt = time.Time{} // 未 arm
	d.rtpPackets = 10000
	d.nalSeen[1] = 10000
	if out := report(d); out != "" {
		t.Fatalf("MP4 コンシューマがいないのに出力があった: %q", out)
	}

	// arm すれば出る
	d.armedAt = time.Now().Add(-60 * time.Second)
	if out := report(d); out == "" {
		t.Fatal("arm 後も出力がない")
	}
}

func TestDiagArmSetsOnce(t *testing.T) {
	saved := diag
	defer func() { diag = saved }()
	diag = newDiag(0)
	diag.armedAt = time.Time{}

	DiagArm()
	first := diag.armedAt
	if first.IsZero() {
		t.Fatal("DiagArm で armedAt が設定されていない")
	}
	time.Sleep(2 * time.Millisecond)
	DiagArm()
	if !diag.armedAt.Equal(first) {
		t.Fatal("2回目の DiagArm で armedAt が上書きされた")
	}
}
