# Console on Cloudflare Workers

可选 [Runtime 数据库持久策略包与独立同步](POLICY_BUNDLE_STORAGE.md)：默认 memory 不自动迁移。启用 runtime 前完成目标 Console 库迁移、Runtime 升级和精确 grant 验证、Gateway 同步目标并完成首包同步；5 分钟是同步新鲜度硬上限。

2026-09-07 生产因分钟同步触发 Workers Free CPU 限制已回滚到旧 memory 版本，Gateway 分钟策略同步已停用。未经实际容量及持续运行验证不得重新启用；具体版本与恢复证据见上述运行手册。

Console 是无状态 BFF 和管理界面。租户业务数据、Vault 加密材料、OIDC
签名私钥和持久化任务状态均由客户侧 Tenant Runtime（Data Runtime）持有。
Cloudflare Worker 不绑定 Hyperdrive，不持有数据库账号，也不直接访问租户数据库。

## 运行边界

- Console SSR/API 通过 Tenant Gateway 获得经过校验的租户上下文。
- Console 使用 Platform internal token 拉取并验签 policy bundle。
- 默认 memory 模式在 Worker isolate 内短期缓存策略包，冷启动重新获取；显式 runtime 模式由独立同步写入租户 Console 库，冷启动读库验封，普通授权不向 Platform 拉包。
- Directory、Auth、Vault、Integration、Notification、Audit 与生命周期操作全部调用 Tenant Runtime。
- Cloudflare 上关闭 PM2 控制、embedded Collab、后台 job 和本地密钥生成。

共享 Worker 的租户、deployment 与环境由带内部 token 的 Tenant Gateway 请求注入。
`HZY_CONSOLE_TRUST_TENANT_GATEWAY` 必须保持 `false`，旧的无 token 请求头不受信任。

## 配置

```bash
cp console/.env.cloudflare.example console/.env.cloudflare
```

填写 Worker 名称、路由、Platform signing kid/public key，以及 Connector Runtime
发布公钥。Cloudflare Console 的关键固定值如下：

```env
HZY_CONSOLE_ACTIVATION_MODE=managed-cloud-multitenant
HZY_PLATFORM_BUNDLE_CACHE_BACKEND=memory
HZY_PLATFORM_BUNDLE_CACHE_SCOPE=managed-cloud-console
HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK=false
HZY_CONSOLE_TRUST_TENANT_GATEWAY=false
HZY_CONSOLE_DATA_ACCESS_MODE=tenant-runtime
CONSOLE_COLLAB_MODE=disabled
```

以下配置禁止出现在 Console Worker 中：

- `DB_HOST`、`DB_USER`、`DB_PASSWORD`、`DB_NAME` 等数据库参数；
- `HZY_CONSOLE_HYPERDRIVE_ID` 或任何 Hyperdrive binding；
- `HZY_CONSOLE_VAULT_MASTER_KEY` / `CONSOLE_VAULT_MASTER_KEY`；
- `CONSOLE_AUTH_SIGNING_PRIVATE_JWK`；
- 单租户 `HZY_PLATFORM_TENANT_CODE`、`HZY_PLATFORM_DEPLOYMENT_CODE`、
  `HZY_PLATFORM_RUNTIME_TOKEN` 和 `HZY_PLATFORM_LICENSE_TOKEN`。

这些材料分别属于 Tenant Runtime 或私有单租户部署，不属于共享 Console。

## Worker secrets

只把 Console 自身所需的内部通信和诊断密钥写入 Worker secrets：

```bash
pnpm dlx wrangler@4 secret put HZY_CLOUDFLARE_INTERNAL_TOKEN \
  --config console/.wrangler.generated.jsonc
pnpm dlx wrangler@4 secret put HZY_CONSOLE_DIAGNOSTICS_TOKEN \
  --config console/.wrangler.generated.jsonc
pnpm dlx wrangler@4 secret put CONSOLE_AUTH_SIMULATION_SECRET \
  --config console/.wrangler.generated.jsonc
```

`HZY_CLOUDFLARE_INTERNAL_TOKEN` 必须与 Platform 和 Tenant Gateway 配置一致。
旧 `HZY_CONSOLE_PLATFORM_SERVICE_TOKEN` / `HZY_TENANT_GATEWAY_INTERNAL_TOKEN`
仅作为迁移期兼容变量。

## 生成、校验与部署

从仓库根目录执行：

```bash
pnpm run validate:console-cloudflare -- --env-file console/.env.cloudflare
pnpm run validate:console-cloudflare -- \
  --env-file console/.env.cloudflare \
  --strict-env
pnpm --dir console run cloudflare:config
pnpm --dir console run deploy:cloudflare
```

校验器会拒绝数据库缓存、Hyperdrive、数据库变量、Vault/OIDC 私钥、
legacy unscoped cache、无 token Tenant Gateway 信任、非生产路由、embedded
Collab 和不安全的运行模式。

上游 OIDC client 需要允许回调：

```text
https://console.huizhi.yun/api/auth/oidc-callback
```

## 上线验证

```bash
curl -I https://console.huizhi.yun/
curl -I https://console.huizhi.yun/api/auth/me
pnpm run audit:console-db-boundary
```

验收条件：

- Console 首页返回 `200` 或预期登录跳转；
- 登录、目录查询、权限变更、Vault 与通知操作经 Tenant Runtime 成功完成；
- 生成的 wrangler 配置没有 `hyperdrive`，也没有任何 `DB_*` 变量；
- Console 运行身份没有租户数据库网络通路或数据库 grant；
- Tenant Runtime 不可用时操作明确失败，不回退直连数据库。
