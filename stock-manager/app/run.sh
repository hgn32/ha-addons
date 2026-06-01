#!/bin/sh
mkdir -p /config/stock-manager/images
/app/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8099
