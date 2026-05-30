FROM voicevox/voicevox_engine:cpu-latest
# FROM voicevox/voicevox_engine:nvidia-amd64-latest

RUN python3 -m pip install --no-cache-dir zeroconf

COPY advertise.py /advertise.py
COPY run.sh /run.sh
RUN chmod +x /run.sh

CMD ["/run.sh"]
