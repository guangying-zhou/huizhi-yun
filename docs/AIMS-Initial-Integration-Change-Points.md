# AIMS 首批接入改造点

## 1. 文档目标

本文档用于把 `AIMS` 从当前接入方式切到：

- `hzy_platform`
- `platform-sdk`
- `platform-adapter-nuxt`

所需的首批改造点明确下来。

这里不再泛谈目标架构，而是基于当前 `AIMS` 的真实代码接入点，列出：

- 哪些文件要优先改
- 每个文件当前承担什么职责
- 应改到哪一层
- 应如何分阶段替换

---

## 2. 当前 AIMS 接入现状

结合当前代码，`AIMS` 的平台接入主要集中在以下几个点：

### 2.1 权限定义仍是本地静态配置

当前文件：

- `app/config/permissions.ts`

当前职责：

- 定义 `appCode`
- 定义资源清单
- 定义路由权限规则
- 定义审批动作

当前问题：

- 资源定义已切到 manifest 视角；不再服务 runtime 旧 Account 资源同步
- route rule 只覆盖 `/projects/**` 和 `/admin/**`
- 资源定义还没有完全转成新平台 manifest 视角

### 2.2 前端仍通过旧 `usePermissions()` 消费权限

当前文件：

- `app/middleware/permission.global.ts`
- `app/layouts/default.vue`

当前职责：

- 路由守卫中直接调用 `usePermissions().hasPermission`
- layout 挂载时调用 `loadPermissions()`

当前问题：

- 权限加载时机偏晚
- 依赖旧 `foundation` 的 `/api/auth/permissions` 代理语义
- 尚未切到新 adapter 的统一 auth / authorization context

### 2.3 服务端仍依赖旧 `/api/auth/permissions` 代理

当前文件：

- `server/api/auth/permissions.get.ts`

当前职责：

- 读取 `auth_user` Cookie
- 转调旧 Account API 的 `/api/v1/users/:uid/permissions`

当前问题：

- 这是典型的旧平台权限代理链路
- 未来 `AIMS` 不应再以这个接口作为主权限来源

### 2.4 启动期资源同步已下线

当前文件：

- `server/plugins/sync-resources.ts`（已删除）

原职责：

- 启动后把本地资源清单同步到旧 Account 的 `/api/v1/resources/sync`

处理结果：

- 这是旧 `account` 时代的资源同步模型，已从 Aims runtime 移除。
- Aims manifest 注册改由 Platform 发布/导入流程承接。

### 2.5 服务端大量接口仍写死项目成员 `manager` 判断

当前文件类型：

- `server/api/v1/projects/[id].put.ts`
- `server/api/v1/projects/[id].delete.ts`
- `server/api/v1/projects/[id]/members.post.ts`
- `server/api/v1/projects/[id]/members.delete.ts`
- `server/api/v1/projects/[id]/repos.post.ts`
- `server/api/v1/projects/[id]/repos.delete.ts`

当前问题：

- 平台 app permission 与项目成员权限未统一收口
- 仍然是“接口内各写一套判断”

---

## 3. 首批改造目标

第一批改造不追求把 `AIMS` 全部改完，而只追求完成这条新链路：

`AIMS -> platform-adapter-nuxt -> platform-sdk -> hzy_platform`

首批目标固定为：

### 3.1 登录与身份消费切到新平台

- 不再依赖旧 `/api/auth/permissions`
- 不再继续以旧 `account` 作为未来平台宿主

### 3.2 app permission 切到 adapter / SDK

- 前端路由守卫
- 菜单过滤
- 服务端平台级 permission helper

### 3.3 项目级权限继续由 AIMS 本地负责

- 项目成员角色
- 项目级 resolver
- 业务规则

### 3.4 资源定义改成 manifest 驱动

- 不再以旧 `sync-resources` 作为未来主入口；该启动插件已删除。

---

## 4. 推荐改造顺序

## Step 1：改权限定义文件

### 当前文件

- `app/config/permissions.ts`

### 目标

将当前静态权限定义，逐步改造成面向 manifest 的结构。

### 具体动作

1. 保留 `appCode`
2. 把 `resources` 结构收敛成与 manifest 一致的资源定义
3. 把 `routeRules` 从“临时前端守卫配置”转成“adapter 消费映射”
4. 将审批动作定义和 app manifest 资源定义明确拆开

### 结果

- `AIMS` 的资源定义成为 app manifest 的单一来源

---

## Step 2：替换前端权限加载入口

### 当前文件

- `app/layouts/default.vue`

### 当前问题

- 页面挂载时才 `loadPermissions()`
- 权限上下文与项目上下文初始化混在一起

### 目标

改为通过 `platform-adapter-nuxt` 的统一 context 消费：

- `useAuth()`
- `useAuthorization()`
- `usePermission()`

### 具体动作

1. 去掉对旧 `usePermissions().loadPermissions()` 的直接依赖
2. 让 layout 只做：
   - 项目上下文初始化
   - 菜单/项目切换 UI 初始化
3. 平台权限上下文改由 adapter 统一注入

### 结果

- `AIMS` layout 不再自己负责拉权限

---

## Step 3：替换路由守卫

### 当前文件

- `app/middleware/permission.global.ts`

### 当前问题

- 守卫直接依赖旧 `usePermissions()`
- 无法区分未登录、无 app permission、项目上下文不足等状态

### 目标

路由守卫改为使用 `platform-adapter-nuxt`：

- `defineAuthMiddleware()`
- `definePermissionMiddleware()`

### 具体动作

1. 保留当前 route rule 语义
2. 守卫内部不再直接调旧 `usePermissions()`
3. 先只做 app 级入口权限控制
4. 项目级范围继续留给页面数据和服务端判断

### 结果

- 路由守卫与新平台权限链路对齐

---

## Step 4：废弃旧 `/api/auth/permissions` 主路径

### 当前文件

- `server/api/auth/permissions.get.ts`

### 当前问题

- 读取旧 `auth_user` Cookie
- 代理旧 Account API

### 目标

逐步让该接口退出主链路。

### 具体动作

1. 第一阶段可保留该接口做兼容 fallback
2. 新路径改为：
   - 服务端从 request context 获取 `AuthorizationSnapshot`
   - 前端从 adapter composables 获取授权结果
3. 当 `AIMS` 页面和接口都不再依赖它后，再正式降级为兼容桥

### 结果

- `AIMS` 不再把旧 Account 权限接口当主数据源

---

## Step 5：下线启动期资源同步插件

### 当前文件

- `server/plugins/sync-resources.ts`（已删除）

### 已处理问题

- 旧实现会在 Aims runtime 启动时注册 Platform manifest，并在失败后回退到 Account `/api/v1/resources/sync`。
- runtime 启动不应写治理数据；manifest 注册应由 Platform 发布/导入流程承接。
- Account 资源同步是旧权限模型，不再作为演进方向。

### 目标

资源能力声明保留在 `app/config/permissions.ts` 的 `appManifest` 中，但 Aims 启动时不再主动同步资源或注册 manifest。

### 具体动作

1. 删除 `server/plugins/sync-resources.ts`。
2. 移除 `permissions.ts` 中仅服务旧资源同步的 `resources` 轻量导出。
3. 后续由 Platform release/import 流程读取 Aims manifest 并登记资源。
4. runtime 启动只允许做配置读取、认证、版本/心跳上报，不创建新的 manifest registration。

### 结果

- `AIMS` 的资源定义不再由应用启动同步。
- Account `/api/v1/resources/sync` 不再被 Aims runtime 调用。

---

## Step 6：新增服务端统一平台权限入口

### 当前情况

多个接口仍在本地直接查询 `aims_project_members` 判断 `manager`。

### 目标

新增统一入口，例如：

- `requireAimsPermission(resource, action)`
- `requireProjectPermission(projectId, resource, action, options)`

### 具体动作

1. 新增平台级 helper
   - 依赖 adapter request context
   - 依赖 SDK `checkPermission()`

2. 新增项目级 helper
   - 调用平台级 helper
   - 再叠加项目成员 resolver

3. 先挑最关键接口改造：
   - 项目详情
   - 项目更新
   - 成员管理
   - 仓库关联

### 结果

- 服务端开始从“接口内散写权限”走向统一收口

---

## Step 7：统一项目成员角色语义

### 当前情况

当前数据库与页面中已有：

- `manager`
- `developer`
- `tester`
- `viewer`

同时页面和其他字段中还有：

- `leaderUid`
- `created_by`
- `currentUserRole`

### 目标

明确第一阶段项目内最终授权主语义：

- 以 `aims_project_members.role` 为主
- 其他字段只作业务辅助，不直接代替授权

### 具体动作

1. 在服务端 helper 中统一解释项目角色
2. 页面只消费统一输出的角色/权限态
3. 对 `leaderUid` 等字段做显式规则投影，而不是各页面自行解释

### 结果

- `AIMS` 项目内权限语义稳定，可与平台 app permission 清晰分层

---

## 5. 文件迁移映射

## 5.1 直接优先改造

- `app/config/permissions.ts`
- `app/layouts/default.vue`
- `app/middleware/permission.global.ts`
- `server/api/auth/permissions.get.ts`
- `server/plugins/sync-resources.ts`（已删除）

## 5.2 首批新增

- `server/utils/permissions/*` 或类似目录
- `server/utils/project-scope-resolver.ts`
- `server/utils/require-project-permission.ts`

## 5.3 第二批逐步接入

- 各 `projects/[id]/*` 写接口
- 各项目详情/成员/仓库/需求/工作项相关页面

---

## 6. 建议的任务拆分

### Epic 1：Manifest & Permission Config

- Task 1.1：重构 `app/config/permissions.ts`
- Task 1.2：抽离审批动作与资源定义

### Epic 2：Frontend Adapter Integration

- Task 2.1：layout 切到新 adapter context
- Task 2.2：路由守卫切到 adapter middleware
- Task 2.3：菜单过滤切到 adapter permission API

### Epic 3：Server Permission Refactor

- Task 3.1：新增平台级 permission helper
- Task 3.2：新增项目级 permission helper
- Task 3.3：改造项目详情/更新/成员管理/仓库接口

### Epic 4：Legacy Path Decommission

- Task 4.1：`/api/auth/permissions` 退化为兼容路径
- Task 4.2：删除 `sync-resources`，manifest 注册改由 Platform 发布/导入路径承接

---

## 7. 验收标准

`AIMS` 首批接入完成后，应满足以下标准：

### 7.1 前端

- layout 不再主动拉旧权限接口
- 路由守卫不再直接依赖旧 `usePermissions`
- 菜单可通过新 adapter 做基础过滤

### 7.2 服务端

- 至少核心项目接口已接入统一权限 helper
- 平台级 permission 与项目级 resolver 已开始分层

### 7.3 平台接入

- 资源定义已从旧 sync 思路转向 manifest 思路
- `AIMS` 已不再继续加深对旧 Account 权限接口的依赖

---

## 8. 结论

`AIMS` 的首批改造，不需要一开始就改完整个应用。  
最关键的是先把这五个接入点切掉：

- 本地权限配置
- layout 中旧权限加载
- 路由守卫中的旧权限判断
- 服务端旧 `/api/auth/permissions` 代理
- 旧资源同步插件（已删除）

只要这五个点先切到 `hzy_platform + platform-sdk + platform-adapter-nuxt`，`AIMS` 就能成为新平台的第一个真实消费者，后面再逐步收口项目级接口权限就顺了。
