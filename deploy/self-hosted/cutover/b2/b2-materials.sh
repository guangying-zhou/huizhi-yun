#!/bin/bash
# S4 B2: the four raw read-only observation sets, stored on the new host in a 0700 directory with 0600 files and a sha256 list.
# Runs on the operator's Mac: every command below only reads; the results are streamed into the new host (nothing is written locally).
#   usage: b2-materials.sh <evidence-dir-on-new-host>      e.g. /root/.hzy-s4/b2-evidence
set -u
D=${1:?evidence dir}
NEW=root@100.64.72.59; GL=root@gitlab.wiztek.cn; JP=root@oa.wiztek.cn
SSH="ssh -o BatchMode=yes -o LogLevel=ERROR"
put() { $SSH $NEW "umask 077; mkdir -p '$D'; cat > '$D/$1'"; }
{ date -u +%FT%TZ; for h in wiztek.huizhi.yun hzy-test.huizhi.yun; do echo "== HEAD https://$h/"; curl -sI -m10 "https://$h/" | tr -d '\r' | grep -Ei '^(HTTP|server|cf-ray|x-hzy|content-type|location)'; done; } | put m1-cloudflare-readback.txt
$SSH $JP 'date -u +%FT%TZ; hostname; echo "== units"; systemctl list-units --all --no-pager --no-legend "hzy*"; echo "== timers"; systemctl list-timers --all --no-pager "hzy*"; for u in hzy-data-runtime hzy-data-runtime-directory hzy-data-runtime-update.timer hzy-data-runtime-update-request.path hzy-data-runtime-ctr812 hzy-connector-runtime hzy-notification-runtime; do echo "$u active=$(systemctl is-active $u 2>&1) enabled=$(systemctl is-enabled $u 2>&1)"; done' | put m2-japan-systemd.txt
{ date -u +%FT%TZ; echo "== japan connections to mysql :3306 (count by process)"; $SSH $JP 'ss -tnp 2>/dev/null | grep -E ":3306\\b" | grep -oE "users:\\(\\(\"[^\"]+\"" | sort | uniq -c; echo "-- established total: $(ss -tn state established "( sport = :3306 )" 2>/dev/null | tail -n +2 | wc -l)"'; echo "== gitlab connector"; $SSH $GL 'for u in hzy-connector-runtime.service hzy-connector-runtime-update.timer; do echo "$u active=$(systemctl is-active $u) enabled=$(systemctl is-enabled $u)"; done; ss -ltn | grep -c ":18082 " | sed "s/^/18082 listeners: /"'; } | put m3-source-db-and-connector.txt
{ date -u +%FT%TZ; $SSH $GL 'sha256sum /etc/nginx/vhost/aidcp.wiztek.cn.conf; nginx -T 2>/dev/null | sha256sum | cut -c1-64 | sed "s/^/nginx -T sha256: /"; curl -s -o /dev/null -w "aidcp / %{http_code}\n" -m10 https://aidcp.wiztek.cn/; curl -sI -m10 https://aidcp.wiztek.cn/ | tr -d "\r" | grep -Ei "^(HTTP|retry-after|cache-control)"; tailscale ping -c 1 100.64.72.59 2>&1 | tail -1'; } | put m4-nginx-and-entry.txt
$SSH $NEW "cd '$D' && chmod 700 . && chmod 600 m*.txt && sha256sum m*.txt | tee SHA256SUMS-materials && stat -c '%a %n' . m*.txt"
