package h265

import (
	"encoding/base64"
	"encoding/hex"
	"testing"
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
