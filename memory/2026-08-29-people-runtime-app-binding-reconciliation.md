# People 已登录但员工页 401/503：Runtime 应用绑定漂移

## 现象

- 用户已经完成 People OIDC 登录，其他应用可正常访问。
- People 的员工搜索、部门目录、通知和待办同时出现 401/503。
- 页面把服务端的 `People operation requires login` 显示为登录问题，但重新登录不能恢复。

## 生产证据

- People Worker 实时日志显示 OIDC callback 成功，access token 的 issuer、audience、
  `token_use` 和 subject 类型均正确。
- 后续 JWKS、`Console /auth/me`、service token 和 People Data Runtime 请求统一失败为
  `Console tenant-runtime is required for tenant data access.`。
- 生产 Data Runtime `/runtime/healthz` 返回 0.3.198，People adapter 为
  `enabled=true, db=ok`；实例本身并未宕机。
- Tenant Gateway 只有在 `tenant_runtime_instance_apps` 中对应应用达到
  `schema_ready|active` 时才向该应用下发 Runtime endpoint，因此缺少 People 绑定会只破坏
  People 请求上下文，同时保留 Console 和已有应用的正常访问。

## 根因链

`issueTenantRuntimeEnrollment()` 只在首次注册时为当时已存在的 active deployment 创建
`tenant_runtime_instance_apps`。People deployment 在 Runtime 注册完成后才加入时，不会自动
生成绑定。

Agent heartbeat 虽然持续上报 `people: enabled, schemaStatus=ok`，旧处理器却只执行
`UPDATE tenant_runtime_instance_apps ... WHERE app_code = 'people'`。缺失行导致每次更新都影响
0 行，People 永远无法进入 `schema_ready`，Gateway 也就永远不下发 People Runtime endpoint。
同一缺陷还会让 enrollment 后替换 deployment 的绑定继续指向旧 deployment。

heartbeat 补建绑定后，生产 People binding 仍处于
`blocked/schema_mismatch/schema_migration_required`。Data Runtime 0.3.198 已把
`people_ranks.rank_series` 及其复合索引列入 People schema readiness，但生产数据库尚未执行
`people/docs/migrations/20260829_rank_series.sql`。因此，应用绑定漂移是第一个故障，缺失的
People rank migration 是绑定被补建后仍不能进入 `schema_ready` 的第二个故障；两者共同造成
Tenant Gateway 不下发 Runtime endpoint。原先把全部现象归因为单一绑定漂移并不完整。

## 修复

- heartbeat 在应用就绪状态更新前，按受信的 Runtime 应用清单、租户、环境和当前 active
  deployment 执行幂等补建/换绑。
- Console 绑定继续保持 `schema_ready/not_applicable`；业务应用随后仍由本次 heartbeat 的
  `enabled + schemaStatus=ok` 决定是否进入 `schema_ready`，没有放宽 Gateway 的失败关闭规则。
- 增加回归契约，固定“先补建绑定，再应用 readiness”的顺序，并补充 Runtime 绑定生命周期文档。
- Platform heartbeat 对仍不可用的 active binding 记录只包含 Runtime code、应用、部署、状态、
  schema 状态和错误码的结构化告警；不记录 heartbeat 原始 `apps`、令牌或业务数据。这样后续可
  直接区分“绑定缺失”和“绑定存在但 schema migration 未完成”。
- 在生产 `people_ranks` 表级备份并校验 gzip 后执行 rank series migration，再运行
  `20260829_rank_series_verify.sql`。四项 metadata、NULL 数据、索引顺序和 CHECK constraint
  校验均通过；随后 heartbeat 将 People binding 恢复为 ready。

## 验证

- 绑定生命周期回归在修复前失败，修复后通过；readiness 结构化告警另有回归覆盖。
- Platform：252/252 tests、lint、typecheck 全部通过。
- Platform Cloudflare production build 通过；仅出现既有 sourcemap warning。
- 生产备份：
  `/var/backups/hzy-data-runtime/hzy_people_people_ranks_before_rank_series_20260829T2136Z.sql.gz`，
  SHA-256
  `17316c8bba5494797aaf3d8a7a3a7c3aa0c34b8b885a2d1e500911acf77ca936`，权限 `0600`，
  `gzip -t` 通过。
