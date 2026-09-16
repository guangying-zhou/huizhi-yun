# Finance Cloudflare 部署

Finance 默认部署到 Cloudflare Worker，并由 Tenant Gateway 通过
`https://<tenant>.huizhi.yun/finance/` 统一访问：

- Cloudflare Worker `hzy-finance` 承载 Finance 页面和 BFF API。
- Tenant Gateway 注入租户、部署和 tenant-runtime 路由上下文。
- Finance Worker 不直连 MySQL；所有 `/api/v1/finance/**` 数据访问通过 tenant-runtime/data-runtime 执行。

## 前置条件

- Cloudflare 账号可创建 Worker。
- 已有可访问的 tenant-runtime/data-runtime endpoint，并已登记到 Platform 租户部署配置。
- Finance Worker 的 `HZY_CLOUDFLARE_INTERNAL_TOKEN` secret 必须与 Tenant Gateway 同值，否则 Worker 会拒绝 Gateway 注入的 runtime 地址，Finance 数据 API 将返回 503。

## 部署

```bash
cd /Users/gavin/Dev/huizhi-yun/finance
pnpm run deploy:cloudflare
```

首次部署或统一内部 token 轮换后，从安全保存的 token 文件同步 Finance
Worker secret（命令不会打印 token）：

```bash
cd /Users/gavin/Dev/huizhi-yun
pnpm run token:cloudflare-internal -- \
  --apply \
  --target finance \
  --token-file "$HOME/.huizhi-yun/cloudflare-internal.token"
```

共享 Cloudflare 应用 Worker 不要写入租户域名；`HZY_DEPLOYMENT_PUBLIC_URL`
仅用于 self-hosted 或单租户独立部署。托管模式下应用 URL 由 Gateway 请求
Host 推导，`HZY_CONSOLE_URL` 默认是 `https://console.huizhi.yun`。

`pnpm run deploy:cloudflare` 会先生成 `.wrangler.generated.jsonc`，再执行 `nuxt build --preset=cloudflare_module` 和 `wrangler deploy`。

## 兼容旧式服务器反代

旧环境如果仍由服务器反代 Finance，可在 Cloudflare 中为 Worker 增加自定义域名，例如：

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
