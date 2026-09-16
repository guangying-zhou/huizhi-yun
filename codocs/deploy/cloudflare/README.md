# Codocs Cloudflare 部署骨架

Codocs 迁移按灰度方式执行：先发布 Worker 和 staging 路由，不直接切生产流量。协同编辑通过平台级 Collab Runtime 提供，Cloudflare Durable Objects provider 单独灰度。

## 前置条件

- Codocs tenant-runtime/data-runtime 已提供文档元数据、版本、文件柜、部门柜、分享和协作上下文合同。
- Console 已有 Codocs OIDC redirect URI：
  - `https://wiztek.huizhi.yun/codocs/api/auth/oidc-callback`
  - `https://wiztek.huizhi.yun/codocs/api/auth/oidc-post-logout`
- Console `oss.default` 集成已配置阿里 OSS 访问参数和 secret。
- Worker 环境优先设置 `HZY_OBJECT_STORAGE_PROVIDER=aliyun-oss-s3`，避免依赖 Node `ali-oss` SDK。
- Codocs Worker 固定使用 `managed-cloud-agent`，不配置 `DB_*`、Hyperdrive 或直连 MySQL。

## 部署

```bash
cd /Users/gavin/Dev/huizhi-yun/codocs

export HZY_TENANT_RUNTIME_URL="https://<tenant-runtime-host>"
export HZY_OBJECT_STORAGE_PROVIDER="aliyun-oss-s3"

pnpm run deploy:cloudflare
```

共享 Cloudflare 应用 Worker 不要写入租户域名；`HZY_DEPLOYMENT_PUBLIC_URL`
仅用于 self-hosted 或单租户独立部署。托管模式下应用 URL 由 Gateway 请求
Host 推导，`HZY_CONSOLE_URL` 默认是 `https://console.huizhi.yun`。

如需先绑定自定义域名：

```bash
export HZY_CODOCS_ROUTE_PATTERN="codocs.isme.dev/*"
export HZY_CODOCS_ZONE_NAME="isme.dev"
pnpm run deploy:cloudflare
```

## 验证

```bash
curl -I https://codocs.isme.dev/codocs/
curl -I https://wiztek.huizhi.yun/codocs/
```

端到端灰度顺序：

1. 登录 Console。
2. 打开 `/codocs/`。
3. 拉取文档列表。
4. 打开一个测试文档。
5. 上传图片或附件，验证对象存储 `put/get/list`。
6. 走 `/codocs/ws` 灰度协同 provider 后再验证双人协作。
