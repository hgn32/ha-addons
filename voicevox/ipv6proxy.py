#!/usr/bin/env python3
# IPv6 -> IPv4 中継プロキシ。
#
# VOICEVOX Engine(uvicorn)は run.sh から `--host 0.0.0.0` で起動しており、
# これは IPv4 のみの待ち受けになる。HA で IPv6 を有効にすると、クライアント
# (HA 本体・ha-voicevox-tts・ブラウザ等)がエンジンへ IPv6 で接続しようとして
# 失敗する(エンジンが IPv6 を待ち受けていないため)。
#
# そこで [::]:50021 を IPv6 専用(IPV6_V6ONLY=1)で待ち受け、受けた接続を
# 127.0.0.1:50021 のエンジンへそのまま中継する。IPv4 は従来どおりエンジンが
# 直接処理し、IPv6 専用ソケットと IPv4 の 0.0.0.0 ソケットは同一ポートでも
# 衝突しないため、IPv4 の既存動作は一切変わらない。
#
# カーネルで IPv6 が無効(ipv6.disable=1 等)な環境では bind に失敗するが、
# その場合はプロキシを起動せず IPv4 のみで動作を継続する(既存動作を壊さない)。
import asyncio
import logging
import socket

LISTEN_PORT = 50021
TARGET_HOST = "127.0.0.1"
TARGET_PORT = 50021

logging.basicConfig(level=logging.INFO, format="%(message)s")


async def _pipe(reader, writer):
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def _handle(client_reader, client_writer):
    try:
        server_reader, server_writer = await asyncio.open_connection(
            TARGET_HOST, TARGET_PORT
        )
    except Exception as e:
        # エンジンがまだ待ち受け開始前だと接続に失敗する。クライアントが再試行するため
        # ここでは接続を閉じるだけにする。
        logging.info(f"[ipv6proxy] エンジンへの接続に失敗(起動中?): {e}")
        try:
            client_writer.close()
        except Exception:
            pass
        return
    await asyncio.gather(
        _pipe(client_reader, server_writer),
        _pipe(server_reader, client_writer),
    )


async def _main():
    sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    # IPv6 専用にして、IPv4(エンジンの 0.0.0.0)と同一ポートで共存させる
    sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
    sock.bind(("::", LISTEN_PORT))
    sock.setblocking(False)
    server = await asyncio.start_server(_handle, sock=sock)
    logging.info(
        f"[ipv6proxy] [::]:{LISTEN_PORT} で待ち受け開始 -> "
        f"{TARGET_HOST}:{TARGET_PORT} へ中継(IPv6 でのアクセスに対応)"
    )
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(_main())
    except OSError as e:
        # カーネルで IPv6 が無効など bind 不可の場合は IPv4 のみで継続する
        logging.info(
            f"[ipv6proxy] IPv6 の待ち受けを開始できませんでした(IPv6 無効環境?)。"
            f"IPv4 のみで動作します: {e}"
        )
    except Exception as e:
        logging.info(f"[ipv6proxy] 予期しないエラーで終了しました: {e}")
