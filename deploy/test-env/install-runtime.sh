#!/usr/bin/env bash
set -euo pipefail
[[ ${1:-} == --execute && $(hostname) == iZcqwiqyhp9u8rZ ]] || exit 1
test -f /wiztek/hzy-test/provisioned.json
test ! -f /etc/systemd/system/hzy-test-data-runtime.service
cd /wiztek/hzy-test/runtime
curl -fsS --max-time 60 -o release-0.3.215.sig https://downloads.huizhi.yun/packages/hzy-data-runtime/0.3.215/hzy-data-runtime_0.3.215_linux_amd64.tar.gz.sig
echo '85ea75938c2ef43f090ecb871e0c12b38d11f61424313a5b7be1a01bd224b0a0  release-0.3.215.tar.gz' | sha256sum --check
openssl pkeyutl -verify -pubin -inkey /wiztek/hzy-test/release-signing-public.pem -rawin -in release-0.3.215.tar.gz -sigfile release-0.3.215.sig
mkdir release-0.3.215
tar -xzf release-0.3.215.tar.gz -C release-0.3.215
test -f release-0.3.215/hzy-data-runtime
id hzy-test-runtime >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin hzy-test-runtime
install -o root -g hzy-test-runtime -m 750 release-0.3.215/hzy-data-runtime hzy-data-runtime
chown root:hzy-test-runtime /wiztek/hzy-test /wiztek/hzy-test/secrets
chmod 750 /wiztek/hzy-test /wiztek/hzy-test/secrets
chown hzy-test-runtime:hzy-test-runtime /wiztek/hzy-test/runtime /wiztek/hzy-test/runtime/config.json
chmod 700 /wiztek/hzy-test/runtime
chmod 600 /wiztek/hzy-test/runtime/config.json
chown root:hzy-test-runtime /wiztek/hzy-test/secrets/vault-key
chmod 640 /wiztek/hzy-test/secrets/vault-key
install -o root -g root -m 644 /wiztek/hzy-test/hzy-test-data-runtime.service /etc/systemd/system/hzy-test-data-runtime.service
systemctl daemon-reload
systemctl enable --now hzy-test-data-runtime
sleep 2
curl -fsS --max-time 10 http://127.0.0.1:18084/runtime/health
