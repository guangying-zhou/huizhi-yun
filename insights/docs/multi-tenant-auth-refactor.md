# 多租户认证改造方案（Proposal）

本方案旨在将现有“全平台单用户表”的模型，升级为“全局身份 + 租户成员关系”的多租户认证体系，实现租户级隔离、角色授权与更清晰的权限边界，同时兼容现有数据与登录流程。

## 目标与非目标

- 目标
  - 租户隔离：用户在不同租户（Business/Tenant）下拥有不同角色与权限。
  - 统一身份：全平台保留一个用户身份（users），支持多租户成员关系（memberships）。
  - 兼容 OAuth：支持 Google 等 OAuth，依据 Host（子域/自定义域）识别目标租户。
  - 细粒度授权：以“成员关系 + 角色”为授权依据（USER/TENANT/ADMIN 等）。
  - 平滑迁移：支持无停机迁移与回滚。
- 非目标
  - 不在本阶段引入“库/Schema 级多租户隔离”（database-per-tenant/schema-per-tenant）。
  - 不强制改变邮箱唯一性策略（默认“全局唯一邮箱”）。

## 术语

- 用户（User）：全局身份，承载基础资料与安全属性（邮箱、口令、OAuth 绑定等）。
- 租户（Tenant/Business）：企业/站点实体，对应 `businesses` 表记录。
- 成员关系（Membership）：`user_id` 与 `tenant_id` 的关联，携带角色、状态等。
- 角色（Role）：ADMIN、TENANT、USER（可扩展 OWNER/STAFF/VIEWER 等）。

## 数据模型（变更与新增）

保持现有：
- `users`（全局）：保留全局唯一身份（建议继续保持 email 全局唯一）。
- `businesses`：作为租户实体。

新增：
- `memberships`（新表）
  - id: string (cuid)
  - userId: string → FK users.id
  - businessId: string → FK businesses.id
  - role: 'ADMIN' | 'TENANT' | 'USER' | ...
  - status: 'invited' | 'active' | 'suspended'
  - isDefault: boolean（可选，用作“首选/默认租户”）
  - createdAt / updatedAt
  - 约束：unique(userId, businessId)

字段迁移/收敛：
- `users.businessId`（现有）：
  - 第一阶段保留用于回填 membership；
  - 第二阶段改读 membership.isDefault；
  - 第三阶段标记弃用/删除。

多租户外键约束建议：
- 所有“租户范围的数据表”增加 `businessId` 字段并建立索引，服务端查询必须包含租户过滤条件。

## 认证与授权流程（改造点）

### 发起与回调（与当前实现配合）
- 发起：保持使用 `auth.repoinsight.com`，`/api/auth/prepare-google` 写入 `href`（含 returnUrl），并 302 至 `/api/auth/google`。
- 回调：`/api/auth/google` 成功后：
  1) 根据回调 Host（`X-Forwarded-Host` 或 `Host`）与 `DomainService` 解析目标租户 `businessId`：
     - 平台子域：从 `<sub>.repoinsight.com` → 业务名/公司映射。
     - 自定义域：通过 Custom Domains 反查公司。
  2) 校验/创建成员关系（membership）：
     - 若用户在该租户无成员关系：
       - 公共站点策略：自动创建 USER 成员；
       - 私有/邀请制：拒绝或跳引导页（按产品策略选择）。
  3) 设置 Session/Cookie：
     - 平台根域：`user`（最小化、无敏感字段）、`activeTenantId`（可选）
     - 目标为“自定义域”时，额外为该域设置 `user` Cookie（domain=custom-host, secure）
  4) 角色感知跳转：
     - 平台子域：TENANT/ADMIN → 主域 `/dashboard`；USER → 子域 `/`
     - 自定义域：统一回该域首页 `/`（后续可扩展为域内 dashboard）

### 授权与中间件
- 新增中间件：`requireTenantMembership`（伪代码）
  - 解析 Host → businessId
  - 从 Session 中拿 userId
  - 查询 `memberships`（userId, businessId）是否存在且 status=active
  - 校验角色是否满足访问所需权限（如 TENANT/ADMIN 才能访问 `/[business]/dashboard/**`）
- 路由分层：
  - 主域管理台 `/dashboard/**`：平台级（TENANT/ADMIN）
  - 租户域内管理台 `/dashboard/**`（如未来支持租户内管理页）：租户级（由 `requireTenantMembership` 强制）

## Cookie/Session 策略
- 平台 Cookie（`.repoinsight.com`）：`user`、`href`、`activeTenantId`（可选）
- 自定义域场景：在回调阶段为该域追加 `user` Cookie，保证跨域访问可用。
- Secure/SameSite：
  - `SameSite=Lax`
  - `Secure` 依据 `X-Forwarded-Proto` 决定；自定义域强制 `Secure`。

## OAuth 与账号策略
- 邮箱唯一性：默认“全局唯一邮箱”，一个用户可加入多个租户。
- 允许同邮箱跨租户重复注册：若未来需要，可在第二阶段支持“按租户唯一”策略（需额外区分身份主体）。
- 邀请/加入：
  - 新增 `invitations` 表（可选第一阶段暂缓）：`(email, businessId, role, status, token, expiresAt)`
  - 回调时若存在有效邀请，则按邀请角色创建 membership。

## 迁移计划（分阶段）

- 阶段 A：引入表结构与读写逻辑（可灰度）
  1) 新建 `memberships` 表（DDL）。
  2) 在“公司创建”与“用户登录回调”处补充 membership 写入：
     - 公司创建者：创建 `role=TENANT` 的 membership。
     - 登录回调：按 Host 识别租户并补齐 USER 关系（取决于策略）。
  3) 在访问敏感路由的服务端 API 中增加 `businessId` 过滤（或校验 membership），新增慢慢覆盖现有逻辑。

- 阶段 B：回填与切换
  1) 根据 `users.businessId` 批量回填 membership（TENANT），并为其它用户按历史业务规则补齐。
  2) 逐步将读取 `users.businessId` 的代码替换为 membership 查询。
  3) 增加只读告警：检测仍在使用 `users.businessId` 的路径。

- 阶段 C：收敛与移除
  1) 将 `users.businessId` 改名为 `defaultBusinessId` 或移除（视兼容期）。
  2) 对所有“租户范围数据表”补齐 `businessId` 外键与索引，确保服务端查询全部带租户过滤。

## 回滚策略
- DDL 升级采用向后兼容：先加表，不删旧字段。
- 读新写双：在关键入口（登录回调/公司创建）同时维护旧字段与新 membership。
- 若出现故障，可切回旧字段读取路径（开关控制）。

## 实施清单（第一阶段 “最小可用”）

- [ ] DDL：新增 `memberships` 表与索引。
- [ ] 服务端：
  - [ ] `server/api/businesses/index.post.js` 公司创建时写入 membership（TENANT）。
  - [ ] `server/api/auth/google.get.js` 回调时：
    - [ ] 解析 Host→businessId
    - [ ] 若无 membership：按策略创建 USER（或拒绝/引导）
    - [ ] 仍按现有逻辑设置 Cookie 与重定向（已具备角色感知，可继续复用）
  - [ ] 新增 `requireTenantMembership` 中间件与 Role 守卫工具函数。
- [ ] Platform/自定义域：验证 USER 与 TENANT/ADMIN 在子域登录后的跳转是否符合预期（现逻辑已部分满足）。

## 测试与验收

- 单元测试
  - memberships 写入、去重（unique(userId, businessId)）
  - 角色判断工具函数
- 集成测试
  - 主域/子域/自定义域 的登录回调 → membership 自动创建 & 跳转
  - 邀请/加入（如有）、拒绝未授权加入
- 回归测试
  - 现有 Dashboard 与媒体上传/内容写入接口在租户过滤开启后仍正常

## 安全与合规
- 服务端查询必须带 `businessId` 过滤（或通过 membership 校验推导出 `businessId`）。
- 对外 API/Webhook 必须显式包含 `businessId` 或 host 上下文。
- 审计：记录 membership 变更与授权敏感操作日志（后续阶段）。

## 辅助建议
- 类型约束：
  - 为所有租户范围的服务/仓储方法添加 `(businessId: string)` 参数签名。
  - 通过 TypeScript 与 ESLint 规则约束必须显式传递 `businessId`。
- 模块化：
  - `authz/` 子模块：封装角色判断、路由守卫、租户解析。
  - `domain/` 子模块：封装 Host→business 映射与缓存。

---

如认可上述方向，我可以立即：
1) 提交 Drizzle 迁移（memberships 表）；
2) 在“公司创建”与“OAuth 回调”接入 membership 写入；
3) 提供 `requireTenantMembership` 中间件与最小 RBAC 工具；
4) 给出一套迁移脚本与回滚开关，支持灰度发布。
