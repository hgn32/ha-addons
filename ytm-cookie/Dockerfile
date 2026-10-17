# YouTube Music Cookie
# HA の Ingress パネルに Chromium の画面（Xvfb + x11vnc + noVNC）を出し、
# そこでログインしてもらってから Cookie を読み出す。
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM ${BUILD_FROM}

# font-noto-cjk は Google のログイン画面の日本語表示用
# xdotool はブラウザのウィンドウを閉じる（Cookie を書き出させる）ために使う
RUN apk add --no-cache chromium xvfb x11vnc novnc xdotool py3-aiohttp font-noto-cjk

COPY run.sh /run.sh
COPY server.py /server.py
COPY www/ /www/
RUN chmod +x /run.sh

CMD ["/run.sh"]
