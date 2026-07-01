# Claude Session Opener
# 毎朝決まった時刻に最小トークンのタスクを送信し、Claude Pro/Max の
# 5時間セッションを起点にすることを狙うアドオン。
ARG BUILD_ARCH=amd64
ARG BUILD_FROM=ghcr.io/home-assistant/${BUILD_ARCH}-base:latest
FROM ${BUILD_FROM}

RUN apk add --no-cache nodejs npm \
    && npm install -g @anthropic-ai/claude-code \
    && npm cache clean --force

COPY run.sh /run.sh
COPY ping.sh /ping.sh
COPY login_server.js /login_server.js
RUN chmod +x /run.sh /ping.sh

CMD ["/run.sh"]
