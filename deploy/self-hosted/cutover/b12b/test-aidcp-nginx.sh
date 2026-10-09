#!/bin/sh
# Local behavioural test of the B12b/B19 vhost shapes with a throw-away nginx on loopback (no ssl, stub upstream). Never touches a real nginx.
set -eu
here=$(cd "$(dirname "$0")" && pwd); work=$(mktemp -d); trap 'kill $(cat "$work/nginx.pid" 2>/dev/null) $(cat "$work/up.pid" 2>/dev/null) 2>/dev/null || true; rm -rf "$work"' EXIT
mkdir -p "$work/maint"; echo MAINTENANCE > "$work/maint/index.html"
cat > "$work/up.py" <<'PY'
import http.server, json
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/bigheaders'):  # ~24KB of response headers, like an SSO callback setting session + token cookies
            self.send_response(200)
            for i in range(12): self.send_header('Set-Cookie', 'c%d=%s; Path=/; HttpOnly' % (i, 'x' * 2000))
            self.send_header('Content-Length', '2'); self.end_headers(); self.wfile.write(b'ok'); return
        body = json.dumps({k.lower(): v for k, v in self.headers.items()}).encode()
        self.send_response(200); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
http.server.HTTPServer(('127.0.0.1', 18999), H).serve_forever()
PY
python3 "$work/up.py" &
echo $! > "$work/up.pid"; sleep 1
render() { # $1 template, $2 user lines -> local test vhost (listen 18443 plain, loopback upstream, local maintenance root)
  python3 - "$1" "$2" "$work" <<'PY'
import sys,re
t=open(sys.argv[1]).read().replace('@USER_LINES@',sys.argv[2])
t=t.replace('http://100.64.72.59:8780','http://127.0.0.1:18999').replace('root /var/www/aidcp-maintenance;','root '+sys.argv[3]+'/maint;')
t=re.sub(r'server \{\n    listen 80;.*?\n\}\n\n','',t,flags=re.S)
t=t.replace('listen 443 ssl;','listen 127.0.0.1:18443;')
t=re.sub(r'    ssl_certificate[^\n]*\n','',t)
open(sys.argv[3]+'/vhost.conf','w').write(t)
PY
  cat > "$work/nginx.conf" <<CONF
worker_processes 1; pid $work/nginx.pid; error_log $work/err.log;
events {}
http { access_log off; client_body_temp_path $work/t1; proxy_temp_path $work/t2; fastcgi_temp_path $work/t3; uwsgi_temp_path $work/t4; scgi_temp_path $work/t5;
  include $work/vhost.conf; }
CONF
  nginx -t -c "$work/nginx.conf" >/dev/null 2>&1 || { nginx -t -c "$work/nginx.conf"; exit 1; }
  if [ -f "$work/nginx.pid" ] && kill -0 "$(cat "$work/nginx.pid")" 2>/dev/null; then kill "$(cat "$work/nginx.pid")"; sleep 1.5; fi
  nginx -c "$work/nginx.conf"; sleep 1
}
code() { c=$(curl -s -o "$work/body" -w "%{http_code}" -H "Host: aidcp.wiztek.cn" "http://127.0.0.1:18443$1"); echo "$c" > "$work/last"; echo "$c"; }
fail() { echo "FAIL: $1 (last code=$(cat "$work/last" 2>/dev/null))"; tail -5 "$work/err.log" 2>/dev/null; exit 1; }
# 1. denied source (template variant without 127.0.0.1): maintenance page, nothing proxied
sed 's/^    127\.0\.0\.1 1;$//' "$here/aidcp.allowlist.conf.tmpl" > "$work/deny.tmpl"; render "$work/deny.tmpl" ''
[ "$(code /)" = 503 ] && grep -q MAINTENANCE "$work/body" || fail 'denied source must get 503 maintenance page'
[ "$(code /codocs/ws)" = 503 ] || fail 'denied source must get 503 on /codocs/ws'
# 2. allowlisted (127.0.0.1 present): proxied
render "$here/aidcp.allowlist.conf.tmpl" '    203.0.113.9 1;'
[ "$(code /)" = 200 ] && grep -q x-forwarded-proto "$work/body" || fail 'allowlisted source must reach upstream'
# 2b. forged trusted-context headers never reach the upstream; the audit address is the real peer
curl -s -H 'Host: aidcp.wiztek.cn' -H 'X-Hzy-Actor-Uid: admin' -H 'X-Hzy-Gateway: tenant-gateway' -H 'X-Hzy-Gateway-Token: forged' -H 'X-Hzy-Tenant: OTHER' -H 'X-Hzy-App-Code: finance' -H 'X-Hzy-Deployment: forged' -H 'X-Forwarded-Prefix: /evil' -H 'X-Forwarded-Host: evil' -H 'Forwarded: for=1.2.3.4' -H 'X-Forwarded-For: 1.2.3.4' -H 'X-Real-IP: 5.6.7.8' http://127.0.0.1:18443/ > "$work/echo.json"
python3 - "$work/echo.json" <<'PY' || fail 'forged headers reached the upstream'
import json,sys
h=json.load(open(sys.argv[1]))
bad=[k for k in h if k.startswith('x-hzy-') or k in ('x-forwarded-prefix','x-forwarded-host','forwarded')]
assert not bad, bad
assert h['x-forwarded-for']=='127.0.0.1' and h['x-real-ip']=='127.0.0.1', h
PY
# 2c. a response with ~24KB of headers passes (the default proxy_buffer_size, 4k/8k on Linux and 16k where the page is 16k, would answer 502 -> maintenance page)
[ "$(code /bigheaders)" = 200 ] || fail 'large response headers must pass'
# 3. open state: everyone proxied; upstream down -> maintenance 503
render "$here/aidcp.open.conf" ''
[ "$(code /bigheaders)" = 200 ] || fail 'open state: large response headers must pass'
[ "$(code /)" = 200 ] && grep -q x-forwarded-proto "$work/body" || fail 'open state must proxy'
kill "$(cat "$work/up.pid")"; sleep 0.3
[ "$(code /)" = 503 ] && grep -q MAINTENANCE "$work/body" || fail 'upstream down must show maintenance 503'
echo 'aidcp nginx shapes: OK (deny=503 page, allow=proxy, open=proxy, upstream down=503 page)'
