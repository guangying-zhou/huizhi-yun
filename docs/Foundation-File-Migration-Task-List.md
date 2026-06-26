# foundation 文件迁移任务清单

## 1. 文档目标

本文档将 `Foundation-Auth-Code-Split-Checklist.md` 中的拆分建议进一步落为可执行任务。

每个任务按以下维度描述：

- 当前文件
- 目标归属
- 改造动作
- 前置依赖
- 风险点
- 完成标准

目标是让 `foundation` 的拆分工作可以按任务逐项推进，而不是停留在架构层讨论。

---

## 2. 总体执行原则

执行时统一遵循以下原则：

### 2.1 先新增，不先替换

优先新增：

- `platform-sdk`
- `platform-adapter-nuxt`
- `legacy-auth-bridge`

然后再逐步把旧文件逻辑迁过去。  
不要一开始就直接改坏现有 `foundation` 入口。

### 2.2 先包裹旧实现，再替换内部实现

第一阶段优先做 facade 和 adapter 包装。  
对旧应用来说，入口尽量不变，内部再逐步替换。

### 2.3 先收口权限，再收口登录

从执行顺序看，权限消费入口比登录桥更适合先拆。  
原因是：

- 风险更低
- 更利于 `AIMS` 首个接入
- 更容易快速验证 `platform-sdk`

### 2.4 bridge 明确保留

旧 CAS / account 逻辑不是“立即删除对象”，而是“先封存为 bridge，再逐步退出”。

---

## 3. Phase 1：权限消费入口拆分

这一阶段的目标是让 `platform-sdk` 和 `platform-adapter-nuxt` 先有第一批真实消费者。

## Task 1.1：拆 `usePermissions.ts` 为 SDK + Adapter + 兼容 facade

### 当前文件

- `foundation/app/composables/usePermissions.ts`

### 目标归属

- `platform-sdk`
- `platform-adapter-nuxt`
- 兼容版 `usePermissions()` facade

### 改造动作

1. 把纯权限判断逻辑抽到 `platform-sdk`
   - `hasPermission`
   - `hasRole`
   - 菜单递归过滤核心
   - 动作继承逻辑

2. 在 `platform-adapter-nuxt` 中新增：
   - `useAuthorization()`
   - `usePermission()`

3. 旧 `usePermissions()` 改成 facade
   - 内部转调新 adapter
   - 暂时保留旧返回结构

### 前置依赖

- `platform-sdk API 草案`
- `platform-adapter-nuxt API 草案`

### 风险点

- 当前实现“未加载默认允许”，新实现若改成更严格，可能影响旧页面行为
- 当前 roles 假定是 `string[]`，未来新模型是结构化角色对象，需要兼容层转换

### 完成标准

- 旧页面继续可用
- 新 adapter composable 可被 `AIMS` 直接消费
- 纯权限判断逻辑不再依赖 Vue/Nuxt

---

## 4. Phase 2：认证态 facade 拆分

目标是把当前 `useAuth.ts` 从“Cookie + CAS logout + localStorage 清理”的混合体，拆成新 auth facade 与旧 bridge。

## Task 2.1：拆 `useAuth.ts`

### 当前文件

- `foundation/app/composables/useAuth.ts`

### 目标归属

- `platform-adapter-nuxt`
- `legacy-auth-bridge`

### 改造动作

1. 在 `platform-adapter-nuxt` 中新增新的 auth facade
   - 暴露 `authenticated`
   - 暴露 `claims`
   - 暴露标准 `logout()`

2. 把以下旧逻辑保留在 bridge：
   - `auth_*` Cookie 命名兼容
   - localStorage 清理约定
   - CAS logout URL 拼接

3. 旧 `useAuth()` 内部逐步转调：
   - 新 auth facade
   - bridge 清理逻辑

### 前置依赖

- adapter request context 已可用

### 风险点

- 当前多个组件直接依赖 `useAuth()` 暴露的 cookie 值字段
- logout 行为如果变更，容易影响现网登录体验

### 完成标准

- `useAuth()` 外部接口短期兼容
- 新应用可直接使用新 auth facade
- 旧 CAS 相关清理逻辑不再污染 adapter core

---

## 5. Phase 3：全局登录守卫拆分

## Task 3.1：拆 `auth.global.ts`

### 当前文件

- `foundation/app/middleware/auth.global.ts`

### 目标归属

- `platform-adapter-nuxt`
- `legacy-auth-bridge`

### 改造动作

1. 在 `platform-adapter-nuxt` 中提供：
   - `defineAuthMiddleware()`
   - `definePermissionMiddleware()`
   - `defineCapabilityMiddleware()`

2. 把以下逻辑保留在 bridge：
   - 企业微信 `wecom_checked` 流程
   - 旧 `/login` 路由兼容
   - `accountUrl` 旧跳转拼接

3. 旧 `auth.global.ts` 改为：
   - 优先走新 adapter auth middleware
   - 对未迁移场景再回落旧 bridge 分支

### 前置依赖

- 新 auth facade 已可用

### 风险点

- 这是最敏感的入口之一
- 登录跳转路径稍有差异，就会影响所有 app

### 完成标准

- 旧 app 仍能登录
- `AIMS` 可直接使用新 middleware
- adapter middleware 不再直接理解 CAS 语义

---

## 6. Phase 4：旧登录桥封存

目标是把旧 CAS / account 相关逻辑显式标记为桥接层，而不是继续混在 foundation 主路径里。

## Task 4.1：封存 `casAuth.ts`

### 当前文件

- `foundation/server/utils/casAuth.ts`

### 目标归属

- `legacy-auth-bridge`

### 改造动作

1. 明确标记为旧 bridge
2. 停止新增任何新平台逻辑进入该文件
3. 将未来 `hzy_platform` Identity Plane 替代路线写入注释或文档

### 风险点

- 该文件仍是现网登录关键路径
- 不能在封存过程中改动行为

### 完成标准

- 文件职责明确为 legacy
- 新应用不再新增对其依赖

## Task 4.2：封存 CAS API 入口

### 当前文件

- `foundation/server/api/auth/cas-login.get.ts`
- `foundation/server/api/auth/cas-callback.get.ts`

### 目标归属

- `legacy-auth-bridge`

### 改造动作

1. 入口保留
2. 文档标明仅供旧链路使用
3. 新平台不再复用该接口命名作为未来主协议入口

### 完成标准

- 现网链路不变
- 新平台 Identity Plane 有独立入口设计

## Task 4.3：封存 `accountApi.ts`

### 当前文件

- `foundation/server/utils/accountApi.ts`

### 目标归属

- `legacy-auth-bridge`
- 少量 API client 模式可作为未来 `platform-client` 参考

### 改造动作

1. 将以下能力标记为 legacy：
   - `getUserByUid`
   - `reportOperationAudit`
   - `reportLoginAudit`

2. 把真正可复用的 client 模式单独整理出来，供未来 `hzy_platform` client 参考

### 风险点

- 当前已有不少 server utils 依赖它

### 完成标准

- 不再把它当未来平台 SDK 的组成部分
- 可清楚识别哪些调用仍在依赖旧 account

---

## 7. Phase 5：Adapter 配套清理

## Task 5.1：处理 `useCookieOptions.ts`

### 当前文件

- `foundation/app/composables/useCookieOptions.ts`

### 目标归属

- `platform-adapter-nuxt`
- 或共享 util

### 改造动作

1. 把 cookie policy 归入 adapter
2. 若前后端都要复用 domain 推导规则，则抽成共享 util

### 完成标准

- cookie 选项逻辑不再散落在 app composable 层

## Task 5.2：处理 `useHeartbeat.ts`

### 当前文件

- `foundation/app/composables/useHeartbeat.ts`

### 目标归属

- `platform-adapter-nuxt`
- `platform-sdk`（仅 heartbeat client）

### 改造动作

1. SDK 提供 heartbeat client
2. adapter 保留：
   - DOM activity 监听
   - route 读取
   - 生命周期挂载

### 风险点

- 与 auth 状态依赖较深，应在 auth facade 稳定后再做

### 完成标准

- 上报 client 与前端调度逻辑边界清晰

---

## 8. Phase 6：UI 消费点清理

## Task 6.1：清理 `UserMenu.vue` 等 UI 组件

### 当前文件

- `foundation/app/components/UserMenu.vue`
- 其他直接依赖 `useAuth()` / `usePermissions()` 的 UI 文件

### 目标归属

- `foundation-ui`

### 改造动作

1. 只允许消费 adapter 暴露的稳定状态
2. 不允许组件内部再直接理解 token / CAS / bundle

### 风险点

- UI 组件分散，容易漏清

### 完成标准

- UI 层只消费 adapter facade

---

## 9. 推荐执行顺序

建议实际按以下顺序建任务和实施：

1. `usePermissions.ts`
2. `useAuth.ts`
3. `auth.global.ts`
4. `casAuth.ts` + CAS API 入口 + `accountApi.ts`
5. `useCookieOptions.ts`
6. `useHeartbeat.ts`
7. UI 消费点清理

这个顺序的关键好处是：

- 先服务 `AIMS`
- 后处理现网桥接
- 最后再动 UI

---

## 10. 建议任务粒度

建议后续真正进入开发排期时，按下面粒度建卡：

### Epic 1：Permission Split

- Task 1.1：抽 `platform-sdk` permission helper
- Task 1.2：实现 adapter `useAuthorization/usePermission`
- Task 1.3：改旧 `usePermissions` facade

### Epic 2：Auth Facade Split

- Task 2.1：实现 adapter auth facade
- Task 2.2：改旧 `useAuth`
- Task 2.3：补 adapter request context

### Epic 3：Middleware Split

- Task 3.1：实现 adapter auth middleware
- Task 3.2：旧 `auth.global` 回落桥接

### Epic 4：Legacy Bridge Freeze

- Task 4.1：封存 CAS 工具
- Task 4.2：封存 CAS API 入口
- Task 4.3：封存 `accountApi`

### Epic 5：Adapter Cleanup

- Task 5.1：处理 cookie policy
- Task 5.2：处理 heartbeat

### Epic 6：UI Cleanup

- Task 6.1：清理 `UserMenu`
- Task 6.2：清理菜单过滤消费点

---

## 11. 结论

这份清单的核心判断只有一句话：

`foundation` 的拆分应先从权限消费入口和 auth facade 开始，而不是先改 UI，也不是先删 CAS。`

这样推进，既能让 `AIMS` 尽快成为新平台首个消费者，也不会过早打断 `Codocs` 和现有 account 兼容链路。
