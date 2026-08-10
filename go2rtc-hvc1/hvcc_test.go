package h265

import (
	"encoding/hex"
	"testing"
)

// 実機由来のデータ: libx265 (Main profile / 1280x720 / yuv420p) を go2rtc に
// 通したときの VPS/SPS/PPS。期待値は「同じ映像を ffmpeg が -tag:v hvc1 で
// multiplex したときの hvcC 先頭 23 バイト」で、numOfArrays だけ
// ffmpeg=4 (SEI 含む) / go2rtc=3 (VPS,SPS,PPS) の差があるので 3 に直してある。
const (
	testVPS = "40010c01ffff01600000030090000003000003005d959409"
	testSPS = "42010101600000030090000003000003005da00280802d16595952930bc05a020000030002000003001e10"
	testPPS = "4401c073c089"

	// ffmpeg が書く hvcC ヘッダ (基準実装)
	wantHVCC = "0101600000009000000000005df000fcfdf8f800000f03"
	// 上流 go2rtc が書く hvcC ヘッダ (level/chroma/bitDepth が 0 のまま)
	upstreamHVCC = "0101600000000000000000000000000000000000000303"
)

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

	// まず上流の実装が壊れていることを確認する (回帰検知)
	if got := hex.EncodeToString(EncodeConfig(vps, sps, pps)[:23]); got != upstreamHVCC {
		t.Fatalf("上流の出力が想定と違う: %s", got)
	}
	if b := mustHex(t, upstreamHVCC); b[12] != 0 {
		t.Fatalf("上流の general_level_idc が 0 でない: %d", b[12])
	}

	got := EncodeConfigHVC1(vps, sps, pps)[:23]
	want := mustHex(t, wantHVCC)
	if hex.EncodeToString(got) != hex.EncodeToString(want) {
		t.Fatalf("hvcC ヘッダ不一致\n got: % x\nwant: % x", got, want)
	}

	t.Logf("upstream: % x", mustHex(t, upstreamHVCC))
	t.Logf("patched : % x", got)
	t.Logf("ffmpeg  : % x", mustHex(t, wantHVCC))

	// 配列 (VPS/SPS/PPS) 部分は上流と完全に同じであること
	full := EncodeConfigHVC1(vps, sps, pps)
	old := EncodeConfig(vps, sps, pps)
	if len(full) != len(old) {
		t.Fatalf("長さが変わった: %d != %d", len(full), len(old))
	}
	if hex.EncodeToString(full[23:]) != hex.EncodeToString(old[23:]) {
		t.Fatal("NAL 配列部分が変わってしまっている")
	}
}
