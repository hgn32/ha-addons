# nginx は Alpine のパッケージではなくソースからビルドする。
# - Alpine 3.24 の nginx は 1.30.4 で止まっていて、1.30.5 / 1.30.6 で直った脆弱性が残る
#   （CVE-2026-15176 / 93479 / 95101 / 97629 / 97205 / 90439）
#   https://nginx.org/en/security_advisories.html
# - nginx.org の公式 Alpine パッケージ（1.30.6 あり）は GeoIP2 モジュールが無く、stream が
#   静的組み込みのため ngx_stream_module.so が無い（/share/nginx/nginx.conf が load_module している）
# Alpine のパッケージと同じパス・同じ主要オプションで組み、使っている動的モジュール
# （stream・GeoIP2・njs）を .so で作る。Alpine の構成は nginx -V で確認した。
ARG BUILD_FROM=ghcr.io/home-assistant/base:latest

FROM ${BUILD_FROM} AS nginx-build

# 署名（nginx.org/keys/pluknet.key・Sergey Kandaurov）を確かめたうえでハッシュを固定する
ENV NGINX_VERSION=1.30.6 \
    NGINX_SHA256=3cf46f5ed7504d460125866b7bea99fb357f31d887e2e63b35503310e9b8b6c8 \
    NJS_VERSION=1.0.2 \
    NJS_COMMIT=72e6a980b9bf2a28ae2d568bbc3b6830a5d7c39e \
    GEOIP2_MODULE_VERSION=3.4 \
    GEOIP2_MODULE_COMMIT=cbaa35461c62a99d2577e6bae3273492502d8769

RUN apk add --no-cache build-base curl git linux-headers \
       openssl-dev pcre2-dev zlib-dev libmaxminddb-dev libxml2-dev libxslt-dev

WORKDIR /src
RUN curl -fsSL -o nginx.tar.gz "https://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz" \
  && echo "${NGINX_SHA256}  nginx.tar.gz" | sha256sum -c - \
  && tar xzf nginx.tar.gz \
  && git clone -q --branch "${NJS_VERSION}" https://github.com/nginx/njs njs \
  && test "$(git -C njs rev-parse HEAD)" = "${NJS_COMMIT}" \
  && git clone -q --branch "${GEOIP2_MODULE_VERSION}" https://github.com/leev/ngx_http_geoip2_module geoip2 \
  && test "$(git -C geoip2 rev-parse HEAD)" = "${GEOIP2_MODULE_COMMIT}"

RUN cd "nginx-${NGINX_VERSION}" \
  && ./configure \
       --prefix=/var/lib/nginx \
       --sbin-path=/usr/sbin/nginx \
       --modules-path=/usr/lib/nginx/modules \
       --conf-path=/etc/nginx/nginx.conf \
       --pid-path=/run/nginx/nginx.pid \
       --lock-path=/run/nginx/nginx.lock \
       --http-client-body-temp-path=/var/lib/nginx/tmp/client_body \
       --http-proxy-temp-path=/var/lib/nginx/tmp/proxy \
       --http-fastcgi-temp-path=/var/lib/nginx/tmp/fastcgi \
       --http-uwsgi-temp-path=/var/lib/nginx/tmp/uwsgi \
       --http-scgi-temp-path=/var/lib/nginx/tmp/scgi \
       --user=nginx --group=nginx \
       --with-threads --with-file-aio --with-compat \
       --with-http_ssl_module --with-http_v2_module --with-http_v3_module \
       --with-http_realip_module --with-http_addition_module --with-http_sub_module \
       --with-http_dav_module --with-http_flv_module --with-http_mp4_module \
       --with-http_gunzip_module --with-http_gzip_static_module --with-http_auth_request_module \
       --with-http_random_index_module --with-http_secure_link_module \
       --with-http_degradation_module --with-http_slice_module --with-http_stub_status_module \
       --with-stream=dynamic --with-stream_ssl_module --with-stream_realip_module \
       --with-stream_ssl_preread_module \
       --add-dynamic-module=/src/njs/nginx \
       --add-dynamic-module=/src/geoip2 \
  && make -j"$(nproc)" \
  && make install DESTDIR=/out \
  && strip /out/usr/sbin/nginx /out/usr/lib/nginx/modules/*.so

FROM ${BUILD_FROM}

RUN apk add --no-cache \
    openssl pcre2 zlib libmaxminddb libxml2 libxslt \
    ca-certificates \
    curl \
    tzdata

COPY --from=nginx-build /out/usr/sbin/nginx /usr/sbin/nginx
COPY --from=nginx-build /out/usr/lib/nginx/modules/ /usr/lib/nginx/modules/
COPY --from=nginx-build /out/etc/nginx/ /etc/nginx/

# Alpine の nginx パッケージと同じユーザー・ディレクトリを作る
# （ログの既定の出力先 /var/lib/nginx/logs は /var/log/nginx へのリンク）
RUN addgroup -S nginx \
  && adduser -S -D -H -h /var/lib/nginx -s /sbin/nologin -G nginx -g nginx nginx \
  && mkdir -p /var/lib/nginx/tmp /var/log/nginx /run/nginx \
  && ln -s /var/log/nginx /var/lib/nginx/logs \
  && chown -R nginx:nginx /var/lib/nginx/tmp \
  && nginx -V

ENV GEOIPUPDATE_VERSION=7.1.0
RUN set -e \
  && cd /tmp \
  && curl -L -o geoipupdate.tar.gz \
       "https://github.com/maxmind/geoipupdate/releases/download/v${GEOIPUPDATE_VERSION}/geoipupdate_${GEOIPUPDATE_VERSION}_linux_amd64.tar.gz" \
  && tar xzf geoipupdate.tar.gz \
  && mv geoipupdate_${GEOIPUPDATE_VERSION}_linux_amd64/geoipupdate /usr/local/bin/geoipupdate \
  && chmod +x /usr/local/bin/geoipupdate \
  && rm -rf /tmp/geoipupdate*

# 定期更新に busybox crond を使うため、ベースイメージに存在することを確認する
RUN command -v crond >/dev/null || (echo "crond not found in base image" && exit 1)

COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
