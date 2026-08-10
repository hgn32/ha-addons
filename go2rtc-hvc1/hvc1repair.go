package h265

import (
	"bytes"
	"encoding/binary"
)

// RepairAggregatedAU は「アクセスユニット全体が1つの NAL として届いてしまう」
// カメラへの対処。
//
// 実機 (SwitchBot カメラ) で観測した挙動:
//
//	すべてのアクセスユニットが FU (RFC 7798 の断片化ユニット) 1本として届き、
//	キーフレームの AU は FU ヘッダの型が 32 (VPS) になっている。
//	go2rtc はこれを「型 32 の単一 NAL」として組み立てるため、
//	IsKeyframe が先頭の型 32 を見て次の NAL へ進もうとするが、宣言長が AU 全体を
//	覆っているので進めず false を返す。結果、最初のキーフレームが永久に検出できず、
//	ブラウザには 1 バイトも送られない (エラーも出ない)。
//
// カメラは VPS/SPS/PPS/IDR を Annex-B (開始コード区切り) で連結したものを、
// まるごと1つの NAL であるかのように送っている。ここではそれを検出して、
// 正しい AVCC (4 バイト長 + NAL) の並びに組み直す。
//
// 誤爆しないよう、次を **すべて** 満たすときだけ組み直す:
//   - AU がちょうど 1 つの NAL でできている (宣言長 + 4 == AU 長)
//   - その NAL の型がパラメータセット系 (32=VPS / 33=SPS / 34=PPS)
//   - 中身に Annex-B の開始コードが含まれている
//
// 普通のカメラではこの条件に当たらないので、何も変わらない。
func RepairAggregatedAU(au []byte) []byte {
	if len(au) < 6 {
		return au
	}

	// AU 全体がちょうど 1 つの NAL か
	size := binary.BigEndian.Uint32(au)
	if int(size)+4 != len(au) {
		return au
	}

	switch (au[4] >> 1) & 0x3F {
	case nalVPS, nalSPS, nalPPS:
	default:
		return au
	}

	nalus := splitAnnexB(au[4:])
	if len(nalus) < 2 {
		return au // 開始コードが無い = 連結ではない
	}

	out := make([]byte, 0, len(au)+4*len(nalus))
	for _, nalu := range nalus {
		if len(nalu) == 0 {
			continue
		}
		out = binary.BigEndian.AppendUint32(out, uint32(len(nalu)))
		out = append(out, nalu...)
	}
	return out
}

// splitAnnexB は Annex-B (00 00 01 / 00 00 00 01 区切り) のバイト列を
// NAL 単位に分割する。先頭に開始コードが無い場合、そこまでを最初の NAL とする。
// 開始コードが 1 つも無ければ nil を返す。
func splitAnnexB(b []byte) [][]byte {
	idx := indexStartCode(b, 0)
	if idx < 0 {
		return nil
	}

	var nalus [][]byte
	if idx > 0 {
		nalus = append(nalus, b[:idx])
	}

	for idx >= 0 {
		start := idx + startCodeLen(b, idx)
		next := indexStartCode(b, start)
		if next < 0 {
			nalus = append(nalus, b[start:])
			break
		}
		nalus = append(nalus, b[start:next])
		idx = next
	}
	return nalus
}

func indexStartCode(b []byte, from int) int {
	if from >= len(b) {
		return -1
	}
	i := bytes.Index(b[from:], []byte{0, 0, 1})
	if i < 0 {
		return -1
	}
	i += from
	// 直前が 0 なら 4 バイト開始コード (00 00 00 01) の一部
	if i > 0 && b[i-1] == 0 {
		i--
	}
	return i
}

func startCodeLen(b []byte, at int) int {
	if at+3 < len(b) && b[at] == 0 && b[at+1] == 0 && b[at+2] == 0 && b[at+3] == 1 {
		return 4
	}
	return 3
}
