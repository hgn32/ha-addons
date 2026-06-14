FROM ghcr.io/home-assistant/base:latest

RUN apk add --no-cache \
    nginx \
    nginx-mod-stream-geoip2 \
    nginx-mod-http-geoip2 \
    nginx-mod-stream-js \
    ca-certificates \
    curl \
    tzdata

ENV GEOIPUPDATE_VERSION=7.0.0
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
