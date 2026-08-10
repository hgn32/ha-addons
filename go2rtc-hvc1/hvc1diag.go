package h265

import (
	"fmt"
	"os"
	"sort"
	"sync"
	"time"
)

// H.265 の映像がブラウザに1枚も届かないときに、原因を Home Assistant の
// ログタブだけで切り分けられるようにするための診断。
//
// go2rtc は「最初のキーフレームが来るまで何も送らない」ので、キーフレームが
// 検出できないとブラウザ側はエラーも出さずに無音で止まる。そのとき原因は
// 大きく2つあり、外からは区別できない。
//
//  1. RTP からアクセスユニット(AU)を1つも組み立てられていない
//     (マーカービットの扱い、シーケンス番号の不連続など)
//  2. AU は出来ているが IsKeyframe が鍵フレームと認識していない
//     (カメラが使う NAL unit type が go2rtc の想定外)
//
// 正常に再生できているときは何も出力しない。問題が起きたときだけ、
// 実際に観測した NAL unit type の内訳を1行にまとめて出す。

const (
	diagFirstReport  = 10 * time.Second // 最初の報告までの猶予
	diagRepeatEvery  = 60 * time.Second // 2回目以降の間隔
	diagMaxReports   = 5                // 出しすぎない
	diagMaxNALSample = 12               // 記録する NAL type の種類数の上限
)

type hvc1Diag struct {
	mu sync.Mutex

	armedAt     time.Time // MP4/MSE のコンシューマが接続した時刻
	firstPacket time.Time
	lastReport  time.Time
	reports     int

	rtpPackets uint64
	nalSeen    map[byte]uint64 // NAL unit type -> 個数 (FU は中身の型で記録)
	nalMarker  map[byte]uint64 // そのうち RTP marker 付きだったもの

	auEmitted   uint64
	auNotKey    uint64
	lastAUTypes []byte
	keyframes   uint64
}

var diag = &hvc1Diag{
	nalSeen:   make(map[byte]uint64),
	nalMarker: make(map[byte]uint64),
}

// DiagArm は MP4/MSE のコンシューマが接続したことを知らせる。
//
// 診断はこれが呼ばれて初めて有効になる。WebRTC や RTSP で視聴している場合は
// そもそも「最初のキーフレーム待ち」の仕組みを通らないので、キーフレームが
// 記録されないのは正常であり、警告を出してはいけない。
func DiagArm() {
	diag.mu.Lock()
	if diag.armedAt.IsZero() {
		diag.armedAt = time.Now()
	}
	diag.mu.Unlock()
}

// DiagRTP は RTP パケット1つ分を記録する。RTPDepay の先頭から呼ばれる。
func DiagRTP(nuType byte, marker bool, payload []byte) {
	// FU (49) は断片なので、開始断片からは中身の本当の型を取り出す
	if nuType == NALUTypeFU && len(payload) >= 3 && payload[2]>>6 == 0b10 {
		nuType = payload[2] & 0x3F
	}

	diag.mu.Lock()
	defer diag.mu.Unlock()

	if diag.firstPacket.IsZero() {
		diag.firstPacket = time.Now()
	}
	diag.rtpPackets++
	if len(diag.nalSeen) < diagMaxNALSample || diag.nalSeen[nuType] > 0 {
		diag.nalSeen[nuType]++
		if marker {
			diag.nalMarker[nuType]++
		}
	}

	diag.reportLocked()
}

// DiagAU はアクセスユニットが1つ組み上がったことを記録する。
func DiagAU(au []byte) {
	diag.mu.Lock()
	defer diag.mu.Unlock()

	diag.auEmitted++
	if diag.auEmitted <= 20 || diag.keyframes == 0 {
		diag.lastAUTypes = Types(au)
	}
}

// IsKeyframeDiag は IsKeyframe と同じ判定を返しつつ、結果を記録する。
// consumer 側の「最初のキーフレーム待ち」から呼ばれる。
func IsKeyframeDiag(au []byte) bool {
	ok := IsKeyframe(au)

	diag.mu.Lock()
	if ok {
		diag.keyframes++
	} else {
		diag.auNotKey++
	}
	diag.mu.Unlock()

	return ok
}

// reportLocked は問題があるときだけ1行出力する。diag.mu を保持して呼ぶこと。
func (d *hvc1Diag) reportLocked() {
	if d.armedAt.IsZero() {
		return // MP4/MSE のコンシューマがいない = キーフレーム待ちをしていない
	}
	if d.keyframes > 0 || d.reports >= diagMaxReports {
		return // 正常に流れている / report しすぎ
	}
	if d.rtpPackets == 0 {
		return // H.265 の RTP がまだ来ていない
	}

	now := time.Now()
	since := d.armedAt
	if d.firstPacket.After(since) {
		since = d.firstPacket
	}
	if now.Sub(since) < diagFirstReport {
		return
	}
	if !d.lastReport.IsZero() && now.Sub(d.lastReport) < diagRepeatEvery {
		return
	}
	d.lastReport = now
	d.reports++

	var cause string
	switch {
	case d.auEmitted == 0:
		cause = "RTP は届いているがアクセスユニットが1つも組み立てられていない"
	default:
		cause = "アクセスユニットは組み立てられているがキーフレームと判定されていない"
	}

	fmt.Fprintf(os.Stderr,
		"[hvc1-diag] H265 のキーフレームを %.0fs 検出できていません: %s"+
			" (rtp_packets=%d access_units=%d not_keyframe=%d nal_types=%s last_au=%v)\n",
		now.Sub(since).Seconds(), cause,
		d.rtpPackets, d.auEmitted, d.auNotKey, d.formatNALs(), d.lastAUTypes,
	)
}

func (d *hvc1Diag) formatNALs() string {
	types := make([]int, 0, len(d.nalSeen))
	for t := range d.nalSeen {
		types = append(types, int(t))
	}
	sort.Ints(types)

	s := "{"
	for i, t := range types {
		if i > 0 {
			s += " "
		}
		s += fmt.Sprintf("%d:%d", t, d.nalSeen[byte(t)])
		if m := d.nalMarker[byte(t)]; m > 0 {
			s += fmt.Sprintf("(marker:%d)", m)
		}
	}
	return s + "}"
}
