package h265

import (
	"bytes"

	"github.com/AlexxIT/go2rtc/pkg/bits"
)

// HEVC の NAL unit type (ISO/IEC 23008-2 Table 7-1)
const (
	nalVPS = 32
	nalSPS = 33
	nalPPS = 34
)

func nalType(b []byte) byte {
	if len(b) == 0 {
		return 0
	}
	return (b[0] >> 1) & 0x3F
}

// GetParameterSetHVC1 は SDP の fmtp からパラメータセットを取り出し、
// **ラベルではなく NAL unit type で** VPS/SPS/PPS に振り分ける。
//
// SDP のラベルを取り違えて送ってくるカメラが実在する。実例 (SwitchBot):
//
//	sprop-vps=... の中身が PPS (type 34)
//	sprop-sps=... の中身が VPS (type 32)
//	sprop-pps=... の中身が SPS (type 33)
//
// 上流の go2rtc はラベルをそのまま信じるため、VPS を SPS としてパースしてしまい、
//   - サンプルエントリの解像度が 0x8 になる (Chrome: "coded size: [0,8]")
//   - hvcC の general_level_idc が 0 になる (Chrome: "level: not available")
//
// となって、ブラウザが init セグメントを設定不正として拒否する。
//
// ラベルが正しいカメラでは、この関数は何も変えない。
func GetParameterSetHVC1(fmtpLine string) (vps, sps, pps []byte) {
	vps, sps, pps = GetParameterSet(fmtpLine)

	var fixedVPS, fixedSPS, fixedPPS []byte
	for _, b := range [][]byte{vps, sps, pps} {
		switch nalType(b) {
		case nalVPS:
			if fixedVPS == nil {
				fixedVPS = b
			}
		case nalSPS:
			if fixedSPS == nil {
				fixedSPS = b
			}
		case nalPPS:
			if fixedPPS == nil {
				fixedPPS = b
			}
		}
	}

	// 3 つとも識別できたときだけ入れ替える。識別できない NAL が混ざっている
	// 場合は上流の挙動 (ラベルどおり) を変えない。
	if fixedVPS != nil && fixedSPS != nil && fixedPPS != nil {
		return fixedVPS, fixedSPS, fixedPPS
	}
	return vps, sps, pps
}

// SizeHVC1 は SPS から求めた表示解像度。
type SizeHVC1 struct {
	width, height uint16
}

func (s *SizeHVC1) Width() uint16  { return s.width }
func (s *SizeHVC1) Height() uint16 { return s.height }

// DecodeSPSHVC1 は SPS から表示解像度を求める。
//
// 上流の DecodeSPS と違い、
//   - general_profile_idc != 1 でも失敗しない
//   - conformance window を適用する (上流は pic_*_in_luma_samples をそのまま返すので
//     CTU 境界に切り上げられた値になる。例: 1620 の映像で 1624)
//
// パースできなければ nil を返す (呼び出し側が 1920x1080 にフォールバックする)。
func DecodeSPSHVC1(sps []byte) *SizeHVC1 {
	if len(sps) < 3 {
		return nil
	}
	rbsp := bytes.ReplaceAll(sps[2:], []byte{0, 0, 3}, []byte{0, 0})
	p := parseSPSChromaDepth(rbsp)
	if p == nil || p.picWidth == 0 || p.picHeight == 0 {
		return nil
	}

	// SubWidthC / SubHeightC (ISO/IEC 23008-2 Table 6-1)
	var subW, subH uint32 = 1, 1
	switch p.chromaFormatIDC {
	case 1: // 4:2:0
		subW, subH = 2, 2
	case 2: // 4:2:2
		subW, subH = 2, 1
	}

	w := p.picWidth
	h := p.picHeight
	if cw := subW * (p.confWinLeft + p.confWinRight); cw < w {
		w -= cw
	}
	if ch := subH * (p.confWinTop + p.confWinBottom); ch < h {
		h -= ch
	}

	return &SizeHVC1{width: uint16(w), height: uint16(h)}
}

// EncodeConfigHVC1 は完全な HEVCDecoderConfigurationRecord (hvcC) を組み立てる。
//
// 上流の EncodeConfig は profile_tier_level の先頭 3 バイトしか書かず、
// general_level_idc / chromaFormat / bitDepth などを 0 のまま残す。
// `hev1` サンプルエントリならブラウザは in-band のパラメータセットを読むため
// これでも再生できるが、`hvc1` ではブラウザは hvcC だけを信頼するため、
// Chrome/Edge は "Invalid video decoder config: ... level: not available" で
// init セグメントを拒否する。
//
// ISO/IEC 14496-15 §8.3.3.1 の全フィールドを SPS から埋める。
// 出力は同じ SPS に対して ffmpeg が書く hvcC と先頭 23 バイトが一致する。
func EncodeConfigHVC1(vps, sps, pps []byte) []byte {
	// 配列 (VPS/SPS/PPS) の書き出しは上流の実装をそのまま使う
	buf := EncodeConfig(vps, sps, pps)

	if len(buf) < 23 {
		return buf
	}

	// SPS から emulation prevention byte (0x03) を除去する。
	// profile_tier_level は 0x00 が連続するため実際に 0x03 が挿入されており、
	// 生の NAL からコピーすると値がずれる。
	rbsp := bytes.ReplaceAll(sps[2:], []byte{0, 0, 3}, []byte{0, 0})
	if len(rbsp) < 13 {
		return buf
	}

	// rbsp[0]  : sps_video_parameter_set_id(4) + sps_max_sub_layers_minus1(3)
	//            + sps_temporal_id_nesting_flag(1)
	// rbsp[1:13]: profile_tier_level の固定長部分 12 バイト
	//            general_profile_space(2)+general_tier_flag(1)+general_profile_idc(5)
	//            + general_profile_compatibility_flags(32)
	//            + general_constraint_indicator_flags(48)
	//            + general_level_idc(8)
	// この 12 バイトは hvcC の [1]..[12] とレイアウトが完全に一致する。
	// sps_max_sub_layers_minus1 の値に関わらず位置は変わらない。
	copy(buf[1:13], rbsp[1:13])

	// rbsp[0] = sps_video_parameter_set_id(4) + sps_max_sub_layers_minus1(3)
	//           + sps_temporal_id_nesting_flag(1)
	// この 2 つは固定位置なので Exp-Golomb 解析なしで取れる。
	numTemporalLayers := ((rbsp[0] >> 1) & 0x07) + 1
	temporalIDNested := rbsp[0] & 0x01

	// chroma_format_idc と bit_depth は SPS の可変長部分にあるので解析が要る。
	// 取れなければカメラで一般的な 4:2:0 / 8bit を既定値にする
	// (上流が書く 0 = monochrome より確実に妥当)。
	var (
		chromaFormatIDC  byte = 1 // 4:2:0
		bitDepthLumaM8   byte = 0 // 8 bit
		bitDepthChromaM8 byte = 0 // 8 bit
	)
	if p := parseSPSChromaDepth(rbsp); p != nil {
		chromaFormatIDC = p.chromaFormatIDC
		bitDepthLumaM8 = p.bitDepthLumaM8
		bitDepthChromaM8 = p.bitDepthChromaM8
	}

	buf[13] = 0xF0 // reserved(4)=1111 + min_spatial_segmentation_idc(12) の上位
	buf[14] = 0x00 // min_spatial_segmentation_idc = 0 (未知)
	buf[15] = 0xFC // reserved(6)=111111 + parallelismType(2) = 0 (未知)
	buf[16] = 0xFC | (chromaFormatIDC & 0x03)
	buf[17] = 0xF8 | (bitDepthLumaM8 & 0x07)
	buf[18] = 0xF8 | (bitDepthChromaM8 & 0x07)
	buf[19] = 0x00 // avgFrameRate = 0 (未知)
	buf[20] = 0x00
	// constantFrameRate(2)=0 + numTemporalLayers(3) + temporalIdNested(1)
	// + lengthSizeMinusOne(2)=3 (NAL 長は 4 バイト)
	buf[21] = (numTemporalLayers&0x07)<<3 | (temporalIDNested&0x01)<<2 | 0x03

	// array_completeness = 1。hvc1 ではパラメータセットは全て hvcC にあり
	// ストリーム中には無い、という意味。ffmpeg も hvc1 では 1 にする
	// (上流 go2rtc は 0 のまま)。
	setArrayCompleteness(buf)

	return buf
}

// setArrayCompleteness は hvcC の各配列の array_completeness ビットを立てる。
// 配列の構造 (ISO/IEC 14496-15 §8.3.3.1):
//
//	array_completeness(1) + reserved(1) + NAL_unit_type(6)
//	numNalus(16)
//	{ nalUnitLength(16) + nalUnit } * numNalus
func setArrayCompleteness(buf []byte) {
	pos := 23
	for i := byte(0); i < buf[22]; i++ {
		if pos+3 > len(buf) {
			return
		}
		buf[pos] |= 0x80
		count := int(buf[pos+1])<<8 | int(buf[pos+2])
		pos += 3
		for n := 0; n < count; n++ {
			if pos+2 > len(buf) {
				return
			}
			pos += 2 + (int(buf[pos])<<8 | int(buf[pos+1]))
		}
	}
}

type spsChromaDepth struct {
	chromaFormatIDC  byte
	bitDepthLumaM8   byte
	bitDepthChromaM8 byte

	picWidth      uint32
	picHeight     uint32
	confWinLeft   uint32
	confWinRight  uint32
	confWinTop    uint32
	confWinBottom uint32
}

// parseSPSChromaDepth は RBSP 化済みの SPS から chroma_format_idc と
// bit_depth_*_minus8 を読む。上流の DecodeSPS は general_profile_idc != 1 で
// nil を返し bit depth も読まないため、ここで独自に解析する。
func parseSPSChromaDepth(rbsp []byte) *spsChromaDepth {
	r := bits.NewReader(rbsp)

	s := &spsChromaDepth{}

	_ = r.ReadBits8(4) // sps_video_parameter_set_id
	maxSubLayersMinus1 := r.ReadBits8(3)
	_ = r.ReadBit() // sps_temporal_id_nesting_flag

	if !skipProfileTierLevel(r, maxSubLayersMinus1) {
		return nil
	}

	_ = r.ReadUEGolomb() // sps_seq_parameter_set_id

	chroma := r.ReadUEGolomb()
	if chroma > 3 {
		return nil
	}
	s.chromaFormatIDC = byte(chroma)
	if chroma == 3 {
		_ = r.ReadBit() // separate_colour_plane_flag
	}

	s.picWidth = r.ReadUEGolomb()
	s.picHeight = r.ReadUEGolomb()

	if r.ReadBit() != 0 { // conformance_window_flag
		s.confWinLeft = r.ReadUEGolomb()
		s.confWinRight = r.ReadUEGolomb()
		s.confWinTop = r.ReadUEGolomb()
		s.confWinBottom = r.ReadUEGolomb()
	}

	luma := r.ReadUEGolomb()
	chromaDepth := r.ReadUEGolomb()
	if r.EOF || luma > 7 || chromaDepth > 7 {
		return nil
	}
	s.bitDepthLumaM8 = byte(luma)
	s.bitDepthChromaM8 = byte(chromaDepth)

	return s
}

// skipProfileTierLevel は profile_tier_level(1, maxSubLayersMinus1) を読み飛ばす。
// 上流の SPS.profile_tier_level と違い general_profile_idc の値で失敗しない。
func skipProfileTierLevel(r *bits.Reader, maxSubLayersMinus1 byte) bool {
	_ = r.ReadBits8(2)   // general_profile_space
	_ = r.ReadBit()      // general_tier_flag
	_ = r.ReadBits8(5)   // general_profile_idc
	_ = r.ReadBits(32)   // general_profile_compatibility_flag[32]
	_ = r.ReadBits64(48) // general_progressive_source_flag ほか
	_ = r.ReadBits8(8)   // general_level_idc

	subLayerProfilePresent := make([]byte, maxSubLayersMinus1)
	subLayerLevelPresent := make([]byte, maxSubLayersMinus1)
	for i := byte(0); i < maxSubLayersMinus1; i++ {
		subLayerProfilePresent[i] = r.ReadBit()
		subLayerLevelPresent[i] = r.ReadBit()
	}
	if maxSubLayersMinus1 > 0 {
		for i := maxSubLayersMinus1; i < 8; i++ {
			_ = r.ReadBits8(2) // reserved_zero_2bits
		}
	}
	for i := byte(0); i < maxSubLayersMinus1; i++ {
		if subLayerProfilePresent[i] != 0 {
			_ = r.ReadBits8(2)   // sub_layer_profile_space
			_ = r.ReadBit()      // sub_layer_tier_flag
			_ = r.ReadBits8(5)   // sub_layer_profile_idc
			_ = r.ReadBits(32)   // sub_layer_profile_compatibility_flag
			_ = r.ReadBits64(48) // ほかのフラグ
		}
		if subLayerLevelPresent[i] != 0 {
			_ = r.ReadBits8(8) // sub_layer_level_idc
		}
	}

	return !r.EOF
}
