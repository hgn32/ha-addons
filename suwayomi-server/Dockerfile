# https://github.com/Suwayomi/Suwayomi-Server-docker/pkgs/container/suwayomi-server
FROM ghcr.io/suwayomi/suwayomi-server:v2.3.2223

USER root

# --- Integrated Suwayomi Summary viewer (FastAPI/uvicorn) ---
# Installed into an isolated venv so it doesn't touch the system Python.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/summary/venv
COPY summary_requirements.txt /opt/summary/requirements.txt
RUN /opt/summary/venv/bin/pip install --no-cache-dir -r /opt/summary/requirements.txt
COPY summary_app /opt/summary/app

COPY startup_script_org.sh /home/suwayomi/startup_script_org.sh
RUN chmod +x /home/suwayomi/startup_script_org.sh

# 4567: Suwayomi Server web UI (direct port). 8099: Summary viewer (ingress).
EXPOSE 4567 8099

ENTRYPOINT ["tini", "--"]
CMD ["/home/suwayomi/startup_script_org.sh"]
