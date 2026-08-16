# Claude Session Opener
# 毎朝決まった時刻に最小トークンのタスクを送信し、Claude Pro/Max の
# 5時間セッションを起点にすることを狙うアドオン。
ARG BUILD_ARCH=amd64
ARG BUILD_FROM=ghcr.io/home-assistant/${BUILD_ARCH}-base:latest
FROM ${BUILD_FROM}

# util-linux-misc は `script`（疑似端末）用。`claude setup-token` は
# 端末が無いと動かないため、長期トークンの発行に必要。
RUN apk add --no-cache nodejs npm util-linux-misc \
    && npm install -g @anthropic-ai/claude-code \
    && npm cache clean --force

COPY run.sh /run.sh
COPY server.js /server.js
RUN chmod +x /run.sh

CMD ["/run.sh"]
