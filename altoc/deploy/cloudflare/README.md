# Altoc Cloudflare 部署

Altoc 可作为 Cloudflare Worker 挂在租户网关后：

```text
https://hzy.wiztek.cn/altoc/
```

Worker 不直连 MySQL，也不再使用 Hyperdrive。所有 `/api/v1/**` Altoc
业务数据访问都通过 tenant-runtime/data-runtime 完成。租户网关可注入 runtime
endpoint；单租户或本地预览也可以显式设置 `HZY_TENANT_RUNTIME_URL`。

## 部署

```bash
cd /Users/gavin/Dev/huizhi-yun/altoc

export HZY_TENANT_RUNTIME_URL="https://<tenant-runtime-host>"

pnpm run deploy:cloudflare
```

共享 Cloudflare 应用 Worker 不要写入租户域名；`HZY_DEPLOYMENT_PUBLIC_URL`
仅用于 self-hosted 或单租户独立部署。托管模式下应用 URL 由 Gateway 请求
Host 推导，`HZY_CONSOLE_URL` 默认是 `https://console.huizhi.yun`。

## 验证

```bash
curl -I https://hzy.wiztek.cn/altoc/
```

登录 Console 后从应用菜单进入经营应用，检查 `/altoc/api/v1/dashboard/summary`
是否通过 tenant-runtime 返回业务数据。
