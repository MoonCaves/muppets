#!/usr/bin/env python3
"""Query OBS WebSocket v5 for streaming/recording status. Pure stdlib, no deps.
Returns JSON: {"streaming": bool, "recording": bool, "connected": bool}
Exits cleanly (<500ms) if OBS is unreachable."""

import json
import socket
import struct
import hashlib
import base64
import os
import sys

HOST = os.environ.get("OBS_WS_HOST", "localhost")
PORT = int(os.environ.get("OBS_WS_PORT", "4455"))
TIMEOUT = 0.5  # seconds — keep statusline fast

def ws_frame(payload: bytes) -> bytes:
    """Build a masked WebSocket text frame."""
    mask_key = os.urandom(4)
    header = b"\x81"  # FIN + text opcode
    length = len(payload)
    if length < 126:
        header += struct.pack("B", 0x80 | length)
    elif length < 65536:
        header += struct.pack("!BH", 0x80 | 126, length)
    else:
        header += struct.pack("!BQ", 0x80 | 127, length)
    header += mask_key
    masked = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
    return header + masked

def ws_read(sock) -> dict:
    """Read a single WebSocket frame, return parsed JSON."""
    head = sock.recv(2)
    if len(head) < 2:
        return {}
    length = head[1] & 0x7F
    if length == 126:
        length = struct.unpack("!H", sock.recv(2))[0]
    elif length == 127:
        length = struct.unpack("!Q", sock.recv(8))[0]
    data = b""
    while len(data) < length:
        chunk = sock.recv(length - len(data))
        if not chunk:
            break
        data += chunk
    return json.loads(data)

def main():
    fail = '{"streaming":false,"recording":false,"connected":false}'
    try:
        sock = socket.create_connection((HOST, PORT), timeout=TIMEOUT)
    except (ConnectionRefusedError, OSError, socket.timeout):
        print(fail)
        return

    try:
        # WebSocket upgrade handshake
        ws_key = base64.b64encode(os.urandom(16)).decode()
        upgrade = (
            f"GET / HTTP/1.1\r\n"
            f"Host: {HOST}:{PORT}\r\n"
            f"Upgrade: websocket\r\n"
            f"Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {ws_key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n"
            f"\r\n"
        )
        sock.sendall(upgrade.encode())

        # Read HTTP response (consume until \r\n\r\n)
        resp = b""
        while b"\r\n\r\n" not in resp:
            resp += sock.recv(4096)
        if b"101" not in resp.split(b"\r\n")[0]:
            print(fail)
            return

        # Step 1: Receive Hello (op: 0)
        hello = ws_read(sock)
        if hello.get("op") != 0:
            print(fail)
            return

        # Step 2: Send Identify (op: 1) — no auth
        identify = {"op": 1, "d": {"rpcVersion": 1}}
        sock.sendall(ws_frame(json.dumps(identify).encode()))

        # Step 3: Receive Identified (op: 2)
        identified = ws_read(sock)
        if identified.get("op") != 2:
            print(fail)
            return

        # Step 4: Request GetStreamStatus
        req = {"op": 6, "d": {"requestType": "GetStreamStatus", "requestId": "s1"}}
        sock.sendall(ws_frame(json.dumps(req).encode()))
        stream_resp = ws_read(sock)
        streaming = stream_resp.get("d", {}).get("responseData", {}).get("outputActive", False)

        # Step 5: Request GetRecordStatus
        req2 = {"op": 6, "d": {"requestType": "GetRecordStatus", "requestId": "s2"}}
        sock.sendall(ws_frame(json.dumps(req2).encode()))
        rec_resp = ws_read(sock)
        recording = rec_resp.get("d", {}).get("responseData", {}).get("outputActive", False)

        result = {"streaming": streaming, "recording": recording, "connected": True}
        print(json.dumps(result))

    except Exception:
        print(fail)
    finally:
        sock.close()

if __name__ == "__main__":
    main()
