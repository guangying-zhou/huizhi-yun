# 数据库迁移与校验指南（companies → businesses）

本项目使用 Drizzle ORM + Turso（libsql）。以下步骤帮助你在本地与生产环境平滑应用 memberships 多租户用户体系相关的变更，并完成核心模型从 businesses 重命名为 businesses 的迁移。

## 重要变更一览

- 核心租户表已由 `businesses` 迁移为 `businesses`（数据库与代码层均已切换）。
- 为兼容历史代码，`server/database/schema.ts` 继续导出 `businesses = businesses` 的别名；老代码可暂时不改路径。
- 所有外键（如 `users.businessId`、`domains.businessId`、`memberships.businessId`）均指向 `businesses.id`。
- 鉴权从历史“creator/role”切换到“memberships（OWNER/ADMIN/USER）”。相关工具位于 `server/utils/membership.ts`。

## 一、准备环境变量

确保以下变量在对应环境文件中（开发一般在 `.env.dev`，生产在 CI/Cloudflare Secrets）：

- TURSO_DB_URL
- TURSO_DB_TOKEN

可用脚本快速检查：

```bash
pnpm node scripts/check-db.mjs
```

## 二、应用迁移（DDL）

项目采用“幂等 DDL + 版本化迁移”混合策略，避免重复执行失败。

1) 首次上线或数据库缺少 memberships 相关结构时：
- 添加 `memberships` 表（含唯一约束 `unique(user_id, business_id)` 与索引）
- 为 `users` 增加 `platform_role` 字段（USER/STAFF 等）

这些结构已体现在 `server/database/schema.ts` 与现有迁移文件中（`server/database/migrations`）。如果你未开启自动迁移，请手动执行：

```bash
# 根据你的迁移工具配置执行（示例）
# drizzle-kit push
# 或在 Turso 控制台执行迁移 SQL
```

2) 验证结构：
- 确认存在 `memberships` 表，含字段：id, user_id, business_id, role, status, created_at, updated_at
- 确认 `users.platform_role` 存在且默认值为 USER
 - 确认业务表为 `businesses`，并且 `users/businessId`、`domains/businessId`、`memberships/businessId` 均引用 `businesses.id`

## 三、数据回填与一致性

- 兼容策略：创建企业（business）时自动写入 OWNER membership；OAuth 成功后可按访问域自动 ensure USER membership（behind flag：`FEATURE_AUTO_JOIN_MEMBERSHIP`）
- 如需为历史数据回填 OWNER：可在 `scripts/` 下补充一次性回填脚本（根据 legacy `businesses.creator` 写入 OWNER membership）

## 四、服务端鉴权切换

- 新的鉴权入口在 `server/utils/membership.ts`：
  - `requireMembership(event, { businessId })`
  - `requireAdmin(event, { businessId })`
  - `requireOwner(event, { businessId })`
- 已将 domains/* 与 business/business 更新等接口切换到 membership 检查（见 `server/api/domains/*.ts`, `server/api/businesses/index.put.js`）。注意 `/api/businesses/*` 路由暂保留以兼容前端，但内部已基于 `businesses` 实现。

## 四点实践建议

1) 短期内保留 `businesses` 别名，逐步替换导入为 `businesses`，避免大规模改动导致回归。
2) 服务端新增/改造接口时，优先使用 `requireAdmin/requireOwner` 做授权校验；避免再基于 `creator` 字段判定权限。
3) 数据写路径：创建 enterprise 时调用 `membershipActions.ensureOwner`，确保管理权限与成员列表一致。
4) 文档与可观察性：记录重要迁移步骤与回滚点，并在 Worker/服务端日志中明确打印域名解析/授权来源，方便排障。

## 五、登录重定向与自定义域

- 自定义域登录回跳统一到 `/user/profile`
- 平台子域维持“管理员 → /dashboard，普通用户 → 子域首页”的分流
- 相关逻辑位于 `server/api/auth/google.get.js`

## 六、常见问题（FAQ）

- Q: Dev 环境登录出现 redirect_uri_mismatch
  - A: dev 下回调 host:port 与协议强制按来访 host:port + http 处理，确保与 Google 控制台一致。确认 nuxt.config.ts 的 dev redirectURL 默认值。

- Q: 自定义域登录后 Cookie 不生效
  - A: 使用了平台域 + 自定义域双写 Cookie，且按协议设置 secure。确认 Worker 透传了 `x-forwarded-proto` 与 `x-original-host`。

- Q: 回跳到 pages.dev
  - A: 生产环境固定回调为 `https://auth.repoinsight.com/api/auth/google`，Worker 透传 host，服务端避免跳到 pages.dev。

## 九、脚本与任务

- 一键 DDL 迁移脚本：`pnpm db:apply-memberships-ddl`
  - 行为：将 `businesses` 重命名为 `companies_legacy`、创建并回填 `businesses`、重建外键到 `businesses`、尝试删除 legacy 表（幂等）。
  - 幂等设计：多次执行安全；遇到已存在/不存在的结构会跳过或忽略错误。


## 七、回滚与灰度

- 可通过环境变量关闭自动加入 membership（`FEATURE_AUTO_JOIN_MEMBERSHIP=0`）
- 端点层面保留了旧角色字段的软兼容（TENANT/ADMIN），但不再作为最终鉴权源

## 八、附录：目录索引

- 迁移 SQL：`server/database/migrations/`
- Schema：`server/database/schema.ts`
- 鉴权工具：`server/utils/membership.ts`
- OAuth：`server/api/auth/google.get.js`, `server/api/auth/prepare-google.get.ts`
- Worker：`worker.js`
- 文档：`docs/membership-authorization-plan.md`
