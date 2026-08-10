# go2rtc (hvc1 patched)
#
# 公式の go2rtc「ハードウェア版」イメージをベースに、H.265(HEVC) を MSE で
# 再生できないバグ (go2rtc issue #2205) を修正した go2rtc バイナリを
# 差し替えたイメージ。
#
# バグの内容:
#   go2rtc は fMP4 の init セグメントに `hev1` サンプルエントリを書きながら、
#   ブラウザには MIME で `hvc1.1.6.L153.B0` と宣言している。ISO 14496-15 §8.4.1
#   では hev1 と hvc1 は別物で、Chrome/Edge 120 以降は宣言と実物の不一致を理由に
#   init セグメントを拒否する (CHUNK_DEMUXER_ERROR_APPEND_FAILED)。
#   go2rtc はパラメータセットを既に `hvcC` に out-of-band で書いているため、
#   ボックス名を `hvc1` に直すのが正しい修正。
#
#   ただしボックス名だけでは足りない。上流の hvcC は profile_tier_level の先頭
#   3 バイトしか書いておらず、general_level_idc / chromaFormat / bitDepth が 0 の
#   ままになっている。`hev1` ではブラウザが in-band のパラメータセットを読むので
#   問題にならないが、`hvc1` ではブラウザは hvcC だけを信頼するため、
#   "Invalid video decoder config: ... level: not available" で拒否される。
#   そのため hvcC も SPS から正しく組み立て直している (hvcc.go)。
#
#   Issue: https://github.com/AlexxIT/go2rtc/issues/2205
#   PR (Draft, 未マージ): https://github.com/AlexxIT/go2rtc/pull/2253

ARG GO_VERSION="1.25"
ARG GO2RTC_VERSION="1.9.14"

# ---- stage 1: パッチ適用済み go2rtc をビルド ----
# CGO_ENABLED=0 の静的バイナリなので、alpine でビルドして debian ベースの
# ランタイムイメージに置いてよい。
FROM golang:${GO_VERSION}-alpine AS build

ARG GO2RTC_VERSION

RUN apk add --no-cache git

WORKDIR /build
RUN git clone --depth 1 --branch "v${GO2RTC_VERSION}" https://github.com/AlexxIT/go2rtc.git .

# パッチ適用。行番号はバージョンで動くため、必ず文字列で検索・置換する。
# sed は「1件も置換しなくても成功する」ため、置換前後を grep で検証し、
# 想定外のソース変更で無言のうちに未パッチのイメージが出来ることを防ぐ。
COPY patch-hvc1.sh hvcc.go hvcc_test.go hvc1diag.go /patch/
RUN sh /patch/patch-hvc1.sh /patch

# 生成される hvcC が ffmpeg (基準実装) と一致することをビルド時に検証する。
# ここが落ちたらイメージは出来上がらない。
RUN go test ./pkg/h265/... ./pkg/iso/... ./pkg/mp4/...

# 上流 (docker/hardware.Dockerfile) と同じビルドオプション
RUN CGO_ENABLED=0 go build -ldflags "-s -w" -trimpath -o /out/go2rtc .

# ---- stage 2: ランタイム ----
# 公式ハードウェア版 (Intel VAAPI/QSV, AMD VAAPI, NVIDIA CUDA + ffmpeg) を
# そのまま使い、go2rtc バイナリだけ差し替える。
# ENTRYPOINT ["/usr/bin/tini","--"] / CMD ["go2rtc","-config","/config/go2rtc.yaml"]
# / WORKDIR /config はベースイメージのものをそのまま使うので上書きしない。
FROM ghcr.io/alexxit/go2rtc:${GO2RTC_VERSION}-hardware

COPY --from=build /out/go2rtc /usr/local/bin/go2rtc

# パッチが本当に入ったイメージかを、コンテナを起動しなくても確認できるようにする
RUN go2rtc --version
