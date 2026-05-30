FROM voicevox/voicevox_engine:cpu-latest
# FROM voicevox/voicevox_engine:nvidia-amd64-latest

RUN pip install zeroconf

COPY advertise.py /advertise.py
COPY run.sh /run.sh
COPY custom_components/ /custom_components/
RUN chmod +x /run.sh

CMD ["/run.sh"]
