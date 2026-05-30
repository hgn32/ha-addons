"""Advertise VOICEVOX Engine via mDNS so HA can auto-discover it."""
import socket
import time
from zeroconf import ServiceInfo, Zeroconf

def _local_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.168.0.1", 1))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()

ip = _local_ip()
print(f"[VOICEVOX] Advertising _voicevox._tcp.local. at {ip}:50021", flush=True)

zc = Zeroconf()
info = ServiceInfo(
    "_voicevox._tcp.local.",
    "VOICEVOX Engine._voicevox._tcp.local.",
    addresses=[socket.inet_aton(ip)],
    port=50021,
    properties={"version": "1.0"},
)
zc.register_service(info)
try:
    while True:
        time.sleep(60)
except (KeyboardInterrupt, SystemExit):
    zc.unregister_service(info)
    zc.close()
