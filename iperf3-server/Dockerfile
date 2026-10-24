# iperf3 は Alpine のパッケージではなく公式のソースからビルドする。
# Alpine 3.24 の iperf3 は 3.20 で、3.22 で直ったサーバー側の脆弱性が残る
# （CVE-2026-101283 iperf_server_api.c の use-after-free ほか）
# https://github.com/esnet/iperf/releases/tag/3.22
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest

FROM ${BUILD_FROM} AS iperf-build

# ハッシュは公式の .sha256（downloads.es.net）と一致することを確かめて固定した
ENV IPERF_VERSION=3.22 \
    IPERF_SHA256=1c0d0fb02c52626111d6e132db80edfbf27bbaff8bd9245df2a371dcb0b35a92

RUN apk add --no-cache build-base curl openssl-dev linux-headers
WORKDIR /src
RUN curl -fsSL -o iperf.tar.gz "https://downloads.es.net/pub/iperf/iperf-${IPERF_VERSION}.tar.gz" \
  && echo "${IPERF_SHA256}  iperf.tar.gz" | sha256sum -c - \
  && tar xzf iperf.tar.gz \
  && cd "iperf-${IPERF_VERSION}" \
  && ./configure --prefix=/usr --disable-static \
  && make -j"$(nproc)" \
  && make install DESTDIR=/out \
  && strip /out/usr/bin/iperf3 /out/usr/lib/libiperf.so.*

FROM ${BUILD_FROM}

RUN apk add --no-cache openssl
COPY --from=iperf-build /out/usr/bin/iperf3 /usr/bin/iperf3
COPY --from=iperf-build /out/usr/lib/libiperf.so* /usr/lib/
RUN iperf3 --version

COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
