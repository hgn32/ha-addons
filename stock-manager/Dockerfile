ARG BUILD_FROM=ghcr.io/hassio-addons/base:15.0.1
FROM $BUILD_FROM

RUN apk add --no-cache python3 py3-pip py3-virtualenv

WORKDIR /app
COPY app/requirements.txt .
RUN python3 -m venv /app/venv && \
    /app/venv/bin/pip install --no-cache-dir -r requirements.txt

COPY app/ .

RUN chmod +x /app/run.sh
CMD ["/app/run.sh"]
