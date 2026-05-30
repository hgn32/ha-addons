FROM voicevox/voicevox_engine:cpu-latest
# FROM voicevox/voicevox_engine:nvidia-amd64-latest

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && python3 -m pip install --no-cache-dir --break-system-packages zeroconf \
    && rm -rf /var/lib/apt/lists/*

COPY advertise.py /advertise.py
COPY run.sh /run.sh
RUN chmod +x /run.sh

CMD ["/run.sh"]
