# Console Nginx Templates

Current prod/test PM2 deployment should use:

- `console-wiztek.conf` before certificates are issued.
- `console-wiztek.ssl.conf` after certificates are issued.

Default routing:

```text
hzy.wiztek.cn      -> 127.0.0.1:3030 -> hzy-console-prod
hzy-test.wiztek.cn -> 127.0.0.1:3031 -> hzy-console-test
```

Before changing DNS or Nginx, generate the rollout checklist from the repository
root:

```bash
HZY_SERVER_PUBLIC_IP=8.130.81.31 pnpm run plan:public-routing -- --server-ip-env HZY_SERVER_PUBLIC_IP
```

If `console-prod` is deployed to Cloudflare Worker, use the test-only templates instead:

- `console-test-only.conf` before the `hzy-test.wiztek.cn` certificate is issued.
- `console-test-only.ssl.conf` after the certificate is issued.

Do not route `hzy.wiztek.cn` through this PM2 server in that mode.

After copying the server config, validate the actual file from the repository root:

```bash
# Full PM2 prod/test mode
pnpm run validate:nginx-routing -- --console-conf /etc/nginx/conf.d/console-wiztek.conf

# Cloudflare prod + PM2 console-test mode
pnpm run validate:nginx-routing -- --console-test-only-conf /etc/nginx/conf.d/console-wiztek.conf

sudo nginx -t
```

For that mode, generate the checklist with:

```bash
HZY_SERVER_PUBLIC_IP=8.130.81.31 pnpm run plan:public-routing -- --server-ip-env HZY_SERVER_PUBLIC_IP --console-prod-cloudflare
```

The SSL template expects one Let's Encrypt certificate directory per domain:

```bash
sudo certbot certonly --webroot -w /var/www/certbot -d hzy.wiztek.cn
sudo certbot certonly --webroot -w /var/www/certbot -d hzy-test.wiztek.cn
```
