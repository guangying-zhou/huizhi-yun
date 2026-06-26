# foundation 现有鉴权代码拆分清单

## 1. 文档目标

本文档基于当前 `foundation` 代码现状，梳理与认证、权限、路由守卫、服务端鉴权相关的文件，并给出推荐拆分去向。

本文档解决的问题是：

- 当前哪些文件真正属于平台协议能力
- 哪些文件只是 Nuxt 适配层
- 哪些文件属于旧系统兼容桥接
- 拆分时先动哪些文件、后动哪些文件

---

## 2. 当前代码现状总结

从当前 `foundation` 代码来看，鉴权逻辑主要散落在以下几个区域：

### 2.1 前端 composables

- `app/composables/useAuth.ts`
- `app/composables/usePermissions.ts`
- `app/composables/useCookieOptions.ts`
- `app/composables/useHeartbeat.ts`

### 2.2 前端 route middleware

- `app/middleware/auth.global.ts`

### 2.3 服务端鉴权工具

- `server/utils/casAuth.ts`
- `server/utils/accountApi.ts`
- `server/utils/cookie-domain.ts`

### 2.4 服务端认证入口

- `server/api/auth/cas-login.get.ts`
- `server/api/auth/cas-callback.get.ts`

这说明当前 `foundation` 的问题不是“缺能力”，而是“能力分层不清”：

- Cookie 与登录态直接暴露在 composable 里
- 权限加载和菜单过滤直接写在 `usePermissions`
- CAS 登录协议直接写在 foundation server utils
- route middleware 直接理解 CAS / 企业微信登录分流
- 审计与 account API 调用和身份增强耦合在一起

---

## 3. 推荐拆分目标结构

建议最终拆成以下四层：

- `platform-sdk`
- `platform-adapter-nuxt`
- `legacy-auth-bridge`
- `foundation-ui`

本清单主要覆盖前三层。

---

## 4. 文件级拆分建议

## 4.1 应进入 `platform-sdk` 的能力

原则：

- 不依赖 Vue / Nuxt
- 不依赖 Cookie composables
- 不依赖页面跳转
- 不直接理解 `AIMS` / `Codocs` 业务语义

### 4.1.1 从 `usePermissions.ts` 中抽出的能力

当前文件：

- `app/composables/usePermissions.ts`

建议抽出到 `platform-sdk`：

- permission snapshot 数据结构
- `hasPermission` 的核心动作继承逻辑
- `hasRole` 的基础角色命中逻辑
- `filterMenus` 中纯权限判断的核心递归逻辑

不应继续留在 SDK 的部分：

- 直接调用 `/api/auth/permissions`
- 依赖 `useRuntimeConfig()`
- 依赖 Vue `ref`

也就是说，这个文件应被拆成：

- `platform-sdk`：纯权限判断函数
- `platform-adapter-nuxt`：负责加载权限快照
- `foundation-ui` / app：消费菜单过滤结果

### 4.1.2 从 `useHeartbeat.ts` 中抽出的能力

当前文件：

- `app/composables/useHeartbeat.ts`

建议抽出到 `platform-sdk`：

- heartbeat client 的上报接口定义
- 状态枚举和 payload 结构

不应继续留在 SDK 的部分：

- `onMounted/onUnmounted`
- DOM 事件监听
- `useRoute()`
- `useAuth()`

结论：

- 心跳调度逻辑留在 adapter
- heartbeat 上报 client 进入 SDK

### 4.1.3 从 `accountApi.ts` 中抽出的能力

当前文件：

- `server/utils/accountApi.ts`

建议抽出到 `platform-sdk` 或未来 `platform-client` 的能力：

- 标准化的 Control Plane API client 模式
- 统一 headers / timeout / error wrapping

但本文件当前大部分内容仍属于旧 `account` 时代桥接，不建议原样搬进 SDK。

特别是这些不应进入 SDK：

- `getUserByUid`
- `reportOperationAudit`
- `reportLoginAudit`

因为它们是“当前 foundation 对 account 的旧依赖”，不是未来平台 core 协议。

结论：

- 保留为旧桥接参考
- 不作为 `platform-sdk` 主实现直接迁移

---

## 4.2 应进入 `platform-adapter-nuxt` 的能力

原则：

- 依赖 Nuxt/Nitro
- 依赖 request / cookie / route / composables
- 负责把 SDK 接到框架运行时

### 4.2.1 `useAuth.ts`

当前文件：

- `app/composables/useAuth.ts`

当前职责：

- 直接消费 `token` / `auth_user` 等 Cookie
- 暴露用户信息
- 负责 logout 行为
- 清理 localStorage
- 直接拼 CAS logout URL

拆分建议：

- 进入 `platform-adapter-nuxt` 的部分：
  - auth state 暴露
  - logout orchestration
  - Cookie 读写包装
  - SSR/CSR 统一 auth context

- 留在 `legacy-auth-bridge` 的部分：
  - 现有 `auth_*` Cookie 命名
  - 现有 localStorage 清理约定
  - 现有 CAS logout 拼接逻辑

结论：

- `useAuth.ts` 不能直接作为未来 adapter API 保留原样
- 应拆为“新 adapter auth facade” + “旧 bridge 清理逻辑”

### 4.2.2 `auth.global.ts`

当前文件：

- `app/middleware/auth.global.ts`

当前职责：

- 检查 `token` / `auth_user` Cookie
- 根据 `casEnable / accountUrl / appName` 做登录跳转
- 处理企业微信特殊自动登录逻辑

拆分建议：

- 进入 `platform-adapter-nuxt` 的部分：
  - 通用 `requireAuthenticated` middleware
  - 登录重定向入口
  - request/route 到 auth decision 的适配

- 留在 `legacy-auth-bridge` 的部分：
  - `wecom_checked` 逻辑
  - 现有 `/login`、`/api/auth/wecom-login` 兼容跳转
  - `accountUrl` 旧入口拼接

结论：

- 未来 adapter 应提供通用 middleware factory
- 旧 `auth.global.ts` 先作为 bridge 保留，再逐步收缩

### 4.2.3 `useCookieOptions.ts`

当前文件：

- `app/composables/useCookieOptions.ts`

当前职责：

- 前后端推断共享 cookie domain
- 输出 `useCookie` 选项

拆分建议：

- 前端 `useCookie` 选项包装进入 adapter
- 纯 domain 推导算法可抽成共享 util

结论：

- 该文件不属于 SDK
- 应并入 adapter 的 cookie policy 层

### 4.2.4 `usePermissions.ts` 的加载侧

当前文件：

- `app/composables/usePermissions.ts`

应留在 adapter 的部分：

- 通过 Nuxt fetch 调接口
- 将结果注入 Vue 响应式状态
- 暴露 composable 形式 API

结论：

- 未来 adapter 应提供新的 `useAuthorization()` / `usePermission()`
- 旧 `usePermissions()` 先桥接新实现

### 4.2.5 `useHeartbeat.ts` 的前端调度侧

应留在 adapter 的部分：

- 生命周期挂载
- DOM activity 监听
- route path 注入
- auth composable 消费

---

## 4.3 应进入 `legacy-auth-bridge` 的能力

原则：

- 明显依赖旧 `account`
- 明显依赖 CAS 现有接口
- 明显依赖旧 Cookie 名和旧登录链路

### 4.3.1 `casAuth.ts`

当前文件：

- `server/utils/casAuth.ts`

当前职责：

- 处理 CAS login / callback
- 验证 ticket
- 写入现有 `token` / `auth_user` / `auth_email` / `auth_realname` 等 Cookie
- 调用 `getUserByUid`
- 调用 `reportLoginAudit`

这是典型的旧系统桥接逻辑，不应直接进入新 SDK。

建议：

- 整体先归入 `legacy-auth-bridge`
- 作为“旧 account / CAS 登录桥”保留
- 后续由 `hzy_platform` Identity Plane 替代

### 4.3.2 `server/api/auth/cas-login.get.ts`

### 4.3.3 `server/api/auth/cas-callback.get.ts`

这两个入口本质上只是 `casAuth.ts` 的 API 包装。

建议：

- 一并归入 `legacy-auth-bridge`
- 新平台稳定前保留
- 不再新增更多 app 对其直接依赖

### 4.3.4 `accountApi.ts`

当前文件：

- `server/utils/accountApi.ts`

该文件里以下能力明确属于旧桥接：

- `getUserByUid`
- `reportOperationAudit`
- `reportLoginAudit`

建议：

- 保留在 `legacy-auth-bridge`
- 未来逐步被 `hzy_platform` API client 替换

### 4.3.5 `cookie-domain.ts`

当前文件：

- `server/utils/cookie-domain.ts`

该文件本身是 util，但当前直接服务于旧 `casAuth.ts` Cookie 写入链路。

建议：

- 短期保留在 `legacy-auth-bridge`
- 后续若新 adapter 仍需共用 cookie domain 规则，再抽成共享 util

---

## 4.4 暂时不动、保留在 UI/应用层的文件

当前这次拆分不建议优先处理：

- `app/components/UserMenu.vue`
- `app/components/LayoutSidebar.vue`
- workflow/approval/dashboard 相关 composables

原因：

- 它们消费 auth/permission 能力，但不属于平台协议 core
- 先改它们收益不大，且容易扩大范围

原则是：

- 先拆底层 auth/permission 入口
- 再回头清 UI 消费点

---

## 5. 推荐拆分顺序

结合当前代码，建议按以下顺序推进。

### Step 1：先抽 `usePermissions.ts`

原因：

- 这是当前最接近平台授权消费层的文件
- 最容易拆成“SDK 核心判断 + adapter composable”

输出：

- `platform-sdk` 的 permission helper
- `platform-adapter-nuxt` 的 `useAuthorization()` / `usePermission()`
- 兼容版 `usePermissions()` facade

### Step 2：再拆 `useAuth.ts`

原因：

- 当前 `useAuth.ts` 把 Cookie、logout、CAS 跳转、localStorage 清理混在一起
- 很适合拆成“新 auth facade + 旧 bridge”

### Step 3：再拆 `auth.global.ts`

原因：

- 这是 app 统一登录入口
- 必须在新 adapter auth facade 稳定后再切

### Step 4：把 `casAuth.ts` 与 CAS API 入口整体封存为 bridge

原因：

- 这块不是未来方向
- 但短期必须保留，不能贸然删

### Step 5：再处理 `useHeartbeat.ts`

原因：

- 它依赖 auth 状态
- 适合在 adapter request/auth context 稳定后再收口

### Step 6：最后回头清理 UI 消费点

例如：

- `UserMenu.vue`
- 菜单过滤使用点
- layout 中的登录态消费

---

## 6. 文件迁移矩阵

建议直接按下面的归类推进：

### 6.1 先拆

- `app/composables/usePermissions.ts`
- `app/composables/useAuth.ts`
- `app/middleware/auth.global.ts`

### 6.2 作为旧桥保留

- `server/utils/casAuth.ts`
- `server/api/auth/cas-login.get.ts`
- `server/api/auth/cas-callback.get.ts`
- `server/utils/accountApi.ts`

### 6.3 作为 adapter 配套处理

- `app/composables/useCookieOptions.ts`
- `app/composables/useHeartbeat.ts`

### 6.4 暂缓

- `app/components/UserMenu.vue`
- 其他 UI/layout 页面消费点

---

## 7. 推荐输出物

基于本清单，下一步建议直接输出两份更执行化的材料：

1. `foundation` 文件迁移任务清单  
   形式：文件 -> 目标 package -> 改造动作 -> 风险

2. `AIMS` 首批接入改造点  
   形式：当前依赖 -> 新 adapter 接入点 -> 替换顺序

---

## 8. 结论

当前 `foundation` 的鉴权代码已经足够说明问题：

- `usePermissions.ts` 更像“权限消费入口”
- `useAuth.ts` / `auth.global.ts` 更像“Nuxt 适配层”
- `casAuth.ts` / `accountApi.ts` 更像“旧系统桥接层”

因此，最合适的拆分路径不是大面积重写，而是：

- 先把权限消费和 auth facade 抽出来
- 再把 CAS/account 逻辑整体封存成 bridge
- 最后再清 UI 层消费点

只要按这个顺序推进，`foundation` 的拆分会非常稳，且能直接为 `AIMS` 接入新平台服务。
