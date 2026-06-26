# Finance Cloudflare 试点部署

本目录记录 `finance` 作为 Cloudflare Workers 试点应用的部署方式。当前推荐先按 `workers.dev` 发布，再由自有服务器把 `/finance/` 反代到 Worker：

- `https://hzy.wiztek.cn/`、`/api/**`、`/workflow/**` 继续回源到自有服务器上的 Console/Workflow。
- Cloudflare Worker `hzy-finance` 先发布到 `workers.dev`。
- `https://hzy.wiztek.cn/finance/**` 由服务器 Nginx/Caddy 反代到 Worker，保持 Console 入口和 OIDC 回调地址不变。
- Finance Worker 不直连 MySQL；所有 `/api/v1/finance/**` 数据访问通过 tenant-runtime/data-runtime 执行。

## 前置条件

- Cloudflare 账号可创建 Worker。
- 已有可访问的 tenant-runtime/data-runtime endpoint，或由租户 Gateway 通过请求头下发 runtime 路由。

如果要让 Worker 直接绑定 `hzy.wiztek.cn/finance/*`，还需要当前 Cloudflare 账号已经接管 `wiztek.cn` DNS Zone。当前账号没有该 Zone 时，部署脚本会默认走 `workers.dev`，避免路由绑定失败。

## 部署

```bash
cd /Users/gavin/Dev/huizhi-yun/finance

export HZY_TENANT_RUNTIME_URL="https://<tenant-runtime-host>"

pnpm run deploy:cloudflare
```

共享 Cloudflare 应用 Worker 不要写入租户域名；`HZY_DEPLOYMENT_PUBLIC_URL`
仅用于 self-hosted 或单租户独立部署。托管模式下应用 URL 由 Gateway 请求
Host 推导，`HZY_CONSOLE_URL` 默认是 `https://console.huizhi.yun`。

`pnpm run deploy:cloudflare` 会先生成 `.wrangler.generated.jsonc`，再执行 `nuxt build --preset=cloudflare_module` 和 `wrangler deploy`。

如果以后 `wiztek.cn` 已接入同一个 Cloudflare 账号，可以改为直接绑定路由：

```bash
export HZY_FINANCE_WORKERS_DEV=false
export HZY_FINANCE_ROUTE_PATTERN="hzy.wiztek.cn/finance/*"
export HZY_FINANCE_ZONE_NAME="wiztek.cn"
pnpm run deploy:cloudflare
```

## 服务器反代

默认 `workers.dev` 部署完成后，如果服务器无法访问 `workers.dev`，建议在 Cloudflare 中为 Worker 增加自定义域名，例如：

```text
https://finance.isme.dev
```

如果服务器使用 `deploy/dev-stack`，推荐保持 Nginx 只反代到 Caddy，由 Caddy 负责 `/finance/` 到 Worker 的转发。仓库中的 `deploy/dev-stack/Caddyfile.staging` 已配置为：

```caddyfile
@finance path /finance /finance/ /finance/*
handle @finance {
    reverse_proxy https://finance.isme.dev {
        header_up Host finance.isme.dev
        header_up -Cookie
        header_up X-Forwarded-Proto {http.request.header.X-Forwarded-Proto}
        header_up X-Forwarded-Host {http.request.header.X-Forwarded-Host}
        header_up X-Forwarded-Port {http.request.header.X-Forwarded-Port}
        header_up X-Forwarded-Prefix /finance
        transport http {
            tls_server_name finance.isme.dev
        }
    }
}
```

实际 staging 配置中 `/finance/api/*` 会保留 Cookie，页面和静态资源会移除 Cookie，避免共享域名下历史 Cookie 过大导致 Worker 上游返回 502。

修改后执行：

```bash
sudo caddy reload --config deploy/dev-stack/Caddyfile.staging
```

如果不使用 Caddy，也可以在 Nginx 的 `hzy.wiztek.cn` 站点中直接增加 `/finance/` 反代。该 `location` 必须放在通用 `location /` 前：

```nginx
location ^~ /finance/ {
    proxy_pass https://finance.isme.dev/finance/;
    proxy_ssl_server_name on;
    proxy_ssl_name finance.isme.dev;
    proxy_set_header Host finance.isme.dev;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Port 443;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffer_size 32k;
    proxy_buffers 8 64k;
    proxy_busy_buffers_size 128k;
}
```

修改后执行：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 本地预览 Worker

```bash
cd /Users/gavin/Dev/huizhi-yun/finance
export HZY_TENANT_RUNTIME_URL="https://<tenant-runtime-host>"
pnpm run preview:cloudflare
```

## 验证

```bash
curl -I https://hzy.wiztek.cn/finance/
```

登录 Console 后从应用菜单进入财务应用，检查 `/finance/api/v1/finance/dashboard/summary` 是否返回业务数据。
