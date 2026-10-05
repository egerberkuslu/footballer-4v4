import json, socket, sys
def call(cmd, params=None, timeout=900):
    s = socket.create_connection(("127.0.0.1", 9876), timeout=timeout)
    s.sendall(json.dumps({"type": cmd, "params": params or {}}).encode())
    buf = b""
    while True:
        chunk = s.recv(65536)
        if not chunk: break
        buf += chunk
        try:
            return json.loads(buf)
        except json.JSONDecodeError:
            continue
if __name__ == "__main__":
    if sys.argv[1] == "file":
        print(json.dumps(call("execute_code", {"code": open(sys.argv[2]).read()}))[:3000])
    else:
        print(json.dumps(call(sys.argv[1]))[:3000])
