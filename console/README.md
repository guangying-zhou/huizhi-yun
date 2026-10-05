# Console

企业控制台，基于 `@hzy/foundation` Nuxt Layer。Console 是无状态 BFF 和管理界面，
不拥有、连接或迁移租户业务数据库。

## 数据边界

- Platform 保存平台级租户注册、订阅、授权和签名 policy bundle。
- Tenant Runtime（Data Runtime）保存并处理 Directory、Auth、Vault、Integration、
  Notification、Audit、生命周期与兼容运行态等租户数据。
- Console 只通过
  `foundation/server/utils/consoleTenantRuntimeClient.ts`
  调用 Tenant Runtime，并使用精确 capability、租户/deployment 绑定、
  idempotency key、CAS/fencing 和审计回执。
- Collab 如启用，使用独立的 `COLLAB_DB_*`；它不构成 Console 对租户业务库的直连。

禁止在 Console 配置或进程中注入：

```text
DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME
HZY_CONSOLE_HYPERDRIVE_ID
HZY_CONSOLE_VAULT_MASTER_KEY CONSOLE_VAULT_MASTER_KEY
CONSOLE_AUTH_SIGNING_PRIVATE_JWK
```

## 本地开发

```bash
cp .env.dev.example .env.dev
pnpm install
pnpm dev:console
```

默认端口为 `3000`。本地 Console 也应连接本地 Tenant Runtime，不允许回退数据库。
用于授权模拟的 `CONSOLE_AUTH_SIMULATION_SECRET` 是 Console 自身 cookie 签名密钥，
不是 OIDC 私钥。

## 运行实例

| 实例 | 用途 | 默认端口 | 数据访问 |
|---|---|---:|---|
| `console-prod` | PM2 生产入口 | `3030` | Tenant Runtime |
| `console-test` | 共享集成/E2E | `3031` | Tenant Runtime |
| `console-dev` | 开发实例 | `3000` | 本地 Tenant Runtime |
| Cloudflare Worker | 托管多租户入口 | HTTPS | Tenant Gateway → Tenant Runtime |

PM2：

```bash
pnpm --dir console run build:prod
pnpm --dir console run pm2:start:prod
```

Cloudflare 部署见
[`deploy/cloudflare/README.md`](deploy/cloudflare/README.md)。

## 验证

```bash
pnpm run audit:console-db-boundary
pnpm run verify:console-zero-db-cutover
pnpm --dir console run typecheck
pnpm --dir console run test
pnpm run validate:console-cloudflare
```

静态门禁必须证明：

- Console 生产代码没有 DB helper 或 SQL 调用；
- `console/package.json` 不依赖 MySQL driver；
- Nuxt、PM2、Cloudflare 配置不接收数据库、Hyperdrive、Vault 主密钥或 OIDC 私钥；
- Cloudflare 使用 isolate-memory policy cache；
- Runtime 不可用时 fail closed，不存在 DB fallback。

生产上线还必须完成 Runtime schema/data 校验、双租户隔离测试、Console 数据库
grant 和网络 ACL 撤销，以及观察窗口。具体步骤见
[`docs/Console-Tenant-Runtime-Wiztek-Cutover-Runbook.md`](docs/Console-Tenant-Runtime-Wiztek-Cutover-Runbook.md)。
