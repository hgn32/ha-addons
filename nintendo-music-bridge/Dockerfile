# Nintendo Music Bridge（フェーズ0）
# 公式 Google Chrome（Widevine 同梱）を Xvfb 上で常駐させ、画面は noVNC で Ingress に出す。
# Chrome の音声は PipeWire の VBAN 送信シンクへ出し、Music Assistant の VBAN Receiver で受ける。
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-debian:trixie
FROM ${BUILD_FROM}

# Chromium ではなく公式 Chrome を使う（Widevine が同梱されているのは公式 Chrome だけ）
# https://www.google.com/linuxrepositories/
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gpg \
    && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
       | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
       > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
       google-chrome-stable \
       xvfb x11vnc novnc xdotool \
       pipewire pipewire-pulse wireplumber libpipewire-0.3-modules pulseaudio-utils dbus \
       python3-aiohttp fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

COPY run.sh /run.sh
COPY server.py discover.py /
COPY www/ /www/
RUN chmod +x /run.sh

CMD ["/run.sh"]
