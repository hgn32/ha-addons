ARG BUILD_FROM
FROM $BUILD_FROM

RUN apk add --no-cache python3 py3-pip

WORKDIR /app
COPY discord_cleanup.py .
COPY run.sh .

RUN pip3 install --no-cache-dir requests --break-system-packages || \
    pip3 install --no-cache-dir requests

RUN chmod +x run.sh

CMD ["/app/run.sh"]