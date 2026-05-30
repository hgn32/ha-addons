#!/usr/bin/env python3
import socket
import time
import logging
from zeroconf import ServiceInfo, Zeroconf

logging.basicConfig(level=logging.INFO, format="%(message)s")


def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return socket.gethostbyname(socket.gethostname())
    finally:
        s.close()


ip = get_local_ip()
logging.info(f"[mDNS] advertising _voicevox._tcp.local. at {ip}:50021")

zc = Zeroconf()
info = ServiceInfo(
    "_voicevox._tcp.local.",
    "VOICEVOX-Engine._voicevox._tcp.local.",
    addresses=[socket.inet_aton(ip)],
    port=50021,
)
zc.register_service(info)

try:
    while True:
        time.sleep(3600)
except KeyboardInterrupt:
    zc.unregister_service(info)
    zc.close()
