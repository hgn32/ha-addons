ARG BUILD_FROM=python:3.12-slim
FROM ${BUILD_FROM}

WORKDIR /app

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app
COPY app ./app
COPY run.sh /run.sh
RUN chmod +x /run.sh

# Ingress port (must match config.json -> ingress_port)
EXPOSE 8099

CMD ["/run.sh"]
