FROM ghcr.io/home-assistant/base-python:3.13-alpine3.23

WORKDIR /app
COPY discord_cleanup.py .
COPY run.sh .

RUN pip3 install --no-cache-dir requests --break-system-packages || \
    pip3 install --no-cache-dir requests

RUN chmod +x run.sh

CMD ["/app/run.sh"]
