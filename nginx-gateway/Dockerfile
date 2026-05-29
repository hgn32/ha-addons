FROM ghcr.io/home-assistant/amd64-base:latest

RUN apk add --no-cache nginx

COPY run.sh /
RUN chmod +x /run.sh

CMD ["/run.sh"]
