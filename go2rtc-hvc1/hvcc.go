package h265

import (
	"bytes"

	"github.com/AlexxIT/go2rtc/pkg/bits"
)

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

	return buf
}

type spsChromaDepth struct {
	chromaFormatIDC  byte
	bitDepthLumaM8   byte
	bitDepthChromaM8 byte
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

	_ = r.ReadUEGolomb() // pic_width_in_luma_samples
	_ = r.ReadUEGolomb() // pic_height_in_luma_samples

	if r.ReadBit() != 0 { // conformance_window_flag
		_ = r.ReadUEGolomb() // conf_win_left_offset
		_ = r.ReadUEGolomb() // conf_win_right_offset
		_ = r.ReadUEGolomb() // conf_win_top_offset
		_ = r.ReadUEGolomb() // conf_win_bottom_offset
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
