# Platform Nginx Templates

Current prod/dev PM2 deployment should use:

- `platform-wiztek.conf` before certificates are issued.
- `platform-wiztek.ssl.conf` after certificates are issued.

Default routing:

```text
platform.wiztek.cn     -> 127.0.0.1:3010 -> hzy-platform-prod
platform-dev.wiztek.cn -> 127.0.0.1:3011 -> hzy-platform-dev
```

Before changing DNS or Nginx, generate the rollout checklist from the repository
root:

```bash
HZY_SERVER_PUBLIC_IP=8.130.81.31 pnpm run plan:public-routing -- --server-ip-env HZY_SERVER_PUBLIC_IP
```

After copying the server config, validate the actual file from the repository root:

```bash
pnpm run validate:nginx-routing -- --platform-conf /etc/nginx/conf.d/platform-wiztek.conf
sudo nginx -t
```

`huizhi-yun-platform.conf` and `huizhi-yun-platform.ssl.conf` are legacy single-domain examples for older standalone Platform deployment notes. Do not use them for the current prod/dev isolation rollout.

The SSL template expects one Let's Encrypt certificate directory per domain:

```bash
sudo certbot certonly --webroot -w /var/www/certbot -d platform.wiztek.cn
sudo certbot certonly --webroot -w /var/www/certbot -d platform-dev.wiztek.cn
```
