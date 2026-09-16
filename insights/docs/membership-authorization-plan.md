# Membership 授权改造方案与进度

最后更新：2025-09-19

## 目标
- 以 memberships(user_id, business_id, role, status) 作为租户内授权唯一事实来源。
- 平台级权限只保留 `platform_role`（USER/STAFF_ADMIN），不再复用 legacy `role` 进行租户授权。
- 逐步替换接口中对 `users.role` 或 `business.creator` 的判断为 membership 校验（OWNER/ADMIN/USER）。

## 设计要点
- Schema：
  - 新表 `memberships`，唯一约束 (user_id, business_id)，索引 business_id / user_id。
  - 枚举：MembershipRole(OWNER/ADMIN/USER)、MembershipStatus(active/disabled)，PlatformRole(USER/STAFF_ADMIN)。
  - `users.platform_role` 新增列（默认 USER）。
- 写路径：
  - 公司创建 → 写入 OWNER membership（创建者）。
  - OAuth 成功回调 → 基于访问 host 解析 business，按需自动加入 USER（FEATURE_AUTO_JOIN_MEMBERSHIP）。
- 读路径：
  - 新增工具 `server/utils/membership.ts`，提供 `requireUser/requireAdmin/requireOwner/requireMembership`。
  - 解析公司优先使用 `event.context.tenant`（由 unified-tenant 注入），回退 Host→DomainService。
- 兼容/灰度：
  - 授权取 membership；业务不依赖 `users.businessId`。暂保留 legacy role 以兼容旧逻辑读取。

## 已完成
- 数据结构
  - `server/database/schema.ts`：新增 memberships & platform_role；导出相应类型。
  - 迁移/DDL：`server/database/migrations/0001_*.sql`、`scripts/apply-memberships-ddl.mjs`（幂等），`scripts/verify-memberships.mjs`（校验）。
- 写路径接入
  - `server/services/db/UserActions.js#createBusiness`：创建者写 OWNER membership。
  - `server/api/auth/google.get.js`：登录成功读取 adminBusinessIds，依据 membership 决定跳转；按 host 自动加 USER（开启时）。
- 读路径与中间件
  - 新增 `server/utils/membership.ts`：封装授权校验与公司解析。
  - 接口改造（DOMAINS）：
    - `server/api/domains/add.post.ts` → requireAdmin(event, { businessId })
    - `server/api/domains/remove.delete.ts` → requireAdmin(event, { businessId: domain.businessId })
    - `server/api/domains/verify.post.ts` → requireAdmin(event, { businessId: domain.businessId })
    - `server/api/domains/check-status.post.ts` → requireAdmin(event, { businessId: domain.businessId })
  - 企业更新：
    - `server/api/businesses/index.put.js` → requireAdmin；支持 body.id/businessId 指定目标企业，或从 tenant 推断。
- 质量
  - Typecheck 通过；DB 已应用 DDL 并经脚本验证。

## 接口行为变化摘要（Breaking/Non-breaking）
- 域名管理接口从“creator 专属”改为“OWNER/ADMIN 皆可”。若依赖 creator 判定的外部逻辑，请同步调整。
- 授权失败错误码统一为 403 Forbidden（未登录仍返回 401）。

## 灰度与回滚
- Feature flags：
  - FEATURE_AUTO_JOIN_MEMBERSHIP（默认开启）。
  - 可新增 FEATURE_MEMBERSHIP_AUTH 以快速回退到 cookies/creator 检查（建议待测试完成后再移除旧分支）。
- 回滚策略：
  - 保留 legacy 代码路径与 `users.role` 读取，不影响平台登录与基本信息展示。

## 待办与计划
- 会话增强（UX）
  - 登录成功时写入 adminBusinessIds/currentBusinessId（仅供前端导航/展示）。
- 接口继续迁移
  - 模板、内容、媒体写接口等与企业绑定的 API 全量改造为 requireAdmin/requireOwner。
- 测试
  - 脚本化最小路径：注册→创建企业→OWNER 写入→添加域名→检查状态→删除域名；成员邀请/加入→USER 权限校验。
- 文档
  - 在 `docs/PROJECT.md` 补充一节“Membership 授权”，并指向本文档。
