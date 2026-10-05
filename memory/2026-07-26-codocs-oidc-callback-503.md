# Codocs OIDC callback 503 调试报告

日期：2026-07-26  
租户：C000001 / wiztek.huizhi.yun  
状态：DONE

## 现象

- Console Shell 内的 Codocs iframe 显示“拒绝连接”。
- `GET /codocs/api/auth/oidc-callback` 返回 503。
- 浏览器随后显示 Console 根页面的 `X-Frame-Options: deny` 错误；这是 503
  认证回调失败后的次生现象。

## 根因

当前 Data Runtime 的 Codocs schema readiness 要求
`service_command_receipt` 存在。生产 `hzy_codocs` 数据库缺少该表，因此：

1. Data Runtime 控制面快照将 Codocs schema 标记为未就绪。
2. Platform 将 Codocs runtime binding 标记为 blocked。
3. Tenant Gateway 按 fail-closed 规则不再向 Codocs 注入
   `x-hzy-data-runtime-url`。
4. Codocs 调用 Console 的 `auth/me` 与 OIDC token endpoint 时，Console 无法解析
   Tenant Runtime endpoint，返回
   `Console tenant-runtime is required for tenant data access.`（503）。
5. OIDC callback 失败后，iframe 最终落到禁止嵌入的 Console 错误页面，浏览器显示
   `X-Frame-Options: deny`。

## 修复

- 对生产 `hzy_codocs` 执行可重复迁移：
  `codocs/docs/migration_v1.4_service_command_receipt.sql`。
- 验证 `service_command_receipt` 已创建。
- 等待 Data Runtime 五分钟控制面心跳把 Codocs 恢复为 `schema_ready`，并等待
  Tenant Gateway 五分钟注册缓存刷新。
- 重新构建并部署 Codocs Cloudflare Worker：
  `e5f47b4a-1965-4af1-adb7-85ecd44c7646`。

## 验证

- Foundation 全量测试：275/275。
- Foundation typecheck：通过。
- Codocs lint、typecheck：通过。
- Codocs 测试：149/149。
- Codocs Cloudflare build、dry-run、正式部署：通过。
- 生产请求重新包含：
  `x-hzy-data-runtime-url: https://wiztek-data-runtime.huizhi.yun`。
- `/codocs/api/auth/me`：200。
- OIDC callback：成功完成，无 503。
- `/codocs/api/auth/permissions`、`/codocs/api/heartbeat`：200。
- 真实登录浏览器中，Codocs 正常显示文档中心、部门文档及开放文档内容。

## 非阻断项

本机构建 Node.js 为 25.8.1，仓库要求 `>=24.18.0 <25`。本次检查与构建均通过，
但后续应统一发布机 Node 版本。
