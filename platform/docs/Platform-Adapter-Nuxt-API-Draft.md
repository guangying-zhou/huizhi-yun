# platform-adapter-nuxt API 草案

## 1. 文档目标

本文档用于定义 `platform-adapter-nuxt` 的第一版 API 边界。

本草案聚焦以下目标：

- 定义 `platform-sdk` 如何接入 Nuxt/Nitro
- 定义 request context、route middleware、composables 的统一入口
- 明确 adapter 与 UI、业务 app、SDK 之间的边界
- 为 `AIMS` 提供首个标准接入路径

---

## 2. Adapter 定位

`platform-adapter-nuxt` 位于：

`platform-sdk <- platform-adapter-nuxt <- foundation-ui / apps`

它的角色不是重新实现 SDK，而是把 SDK 适配到 Nuxt/Nitro 运行时。

它负责：

- 从 HTTP 请求提取 token
- 调用 `platform-sdk` 完成 token / bundle / permission 相关逻辑
- 将结果注入 Nuxt request context
- 向页面与组件暴露 composables
- 向服务端暴露 auth helper
- 提供 route middleware 工具

它不负责：

- UI 组件
- 业务项目 resolver
- 具体页面权限展示样式

---

## 3. 第一版职责范围

第一版 adapter 只负责以下几类能力：

### 3.1 服务端上下文注入

- 从 request 中读取 token
- 调用 SDK 验签
- 装载 claims
- 装载 bundle / revocation / authorization snapshot
- 注入 server context

### 3.2 服务端鉴权辅助

- 获取当前用户 claims
- 获取 authorization snapshot
- 提供平台级 `checkPermission()`
- 提供标准错误转换

### 3.3 前端 composables

- `useAuth()`
- `useAuthorization()`
- `usePermission()`
- `useCapabilities()`

### 3.4 路由守卫

- 登录校验
- app permission 校验
- capability 校验

### 3.5 菜单与导航辅助

- 基于资源权限过滤菜单
- 基于 capability 过滤入口

---

## 4. 第一版不负责的事情

第一版 adapter 不负责：

- 页面布局
- 登录页 UI
- 用户信息页 UI
- `AIMS` 项目范围判断
- `Codocs` 文档对象权限判断
- 业务数据查询过滤

这些应分别由：

- `foundation-ui`
- 业务 app
- 服务端业务层

承担。

---

## 5. 初始化接口

建议统一通过 Nuxt module/plugin 方式初始化。

```ts
type PlatformAdapterNuxtOptions = {
  sdk: PlatformSdk
  tokenResolver?: TokenResolver
  cacheUserContext?: boolean
  publicAuthRoutes?: string[]
  loginRoute?: string
  unauthorizedRoute?: string
  capabilityResolver?: CapabilityResolver
}
```

建议提供：

```ts
function definePlatformNuxtAdapter(options: PlatformAdapterNuxtOptions): PlatformNuxtAdapter
```

说明：

- `sdk` 由外部注入，adapter 不自己创建 SDK
- `tokenResolver` 允许不同应用定制 token 提取方式
- `capabilityResolver` 允许按 app 自己的 UI 语义包装 capability 判断

---

## 6. Token 解析边界

adapter 负责从 Nuxt request 中取 token，但不负责 token 校验规则本身。

推荐接口：

```ts
type TokenResolver = (input: {
  event?: H3Event
  request?: Request
}) => string | null | Promise<string | null>
```

默认解析顺序建议：

1. `Authorization: Bearer <token>`
2. 指定 cookie
3. SSR 注入上下文

注意：

- token 提取失败不是异常，应返回 `null`
- 是否允许匿名访问，由 middleware 或 route policy 决定

---

## 7. Server Context 模型

第一版建议在服务端注入统一上下文对象。

```ts
type PlatformRequestContext = {
  token?: string | null
  claims?: PlatformClaims | null
  authorization?: AuthorizationSnapshot | null
  capabilities?: Record<string, string | boolean | number>
  bundleVersion?: string | null
  authenticated: boolean
}
```

建议暴露：

```ts
async function getPlatformRequestContext(event: H3Event): Promise<PlatformRequestContext>
```

行为建议：

- 首次调用时构建 context
- 同一请求周期内复用
- 构建失败时返回结构化错误或匿名 context

---

## 8. 服务端导出接口

第一版建议导出以下服务端工具。

## 8.1 `getPlatformRequestContext`

```ts
async function getPlatformRequestContext(event: H3Event): Promise<PlatformRequestContext>
```

## 8.2 `requireAuthenticated`

```ts
async function requireAuthenticated(event: H3Event): Promise<PlatformRequestContext>
```

职责：

- 要求请求必须带有效 token
- 否则抛出标准 401 错误

## 8.3 `getClaims`

```ts
async function getClaims(event: H3Event): Promise<PlatformClaims | null>
```

## 8.4 `getAuthorizationSnapshot`

```ts
async function getAuthorizationSnapshot(event: H3Event): Promise<AuthorizationSnapshot | null>
```

## 8.5 `checkPlatformPermission`

```ts
async function checkPlatformPermission(
  event: H3Event,
  input: PermissionCheckInput
): Promise<PermissionCheckResult>
```

职责：

- 从 request context 取 authorization snapshot
- 调用 SDK 的 `checkPermission()`
- 返回结构化结果

## 8.6 `requirePlatformPermission`

```ts
async function requirePlatformPermission(
  event: H3Event,
  input: PermissionCheckInput
): Promise<PermissionCheckResult>
```

职责：

- 无权限时抛标准 403 错误

## 8.7 `getCapabilities`

```ts
async function getCapabilities(event: H3Event): Promise<Record<string, string | boolean | number>>
```

---

## 9. 错误映射

adapter 应负责把 SDK 错误转成 Nuxt/Nitro 可消费错误。

建议统一映射：

- `TOKEN_INVALID` -> `401 Unauthorized`
- `TOKEN_EXPIRED` -> `401 Unauthorized`
- `TOKEN_REVOKED` -> `401 Unauthorized`
- `JWKS_LOAD_FAILED` -> `503 Service Unavailable`
- `BUNDLE_LOAD_FAILED` -> `503 Service Unavailable`
- `REVOCATION_LOAD_FAILED` -> `503 Service Unavailable`
- `LICENSE_LOAD_FAILED` -> `503 Service Unavailable`
- `MANIFEST_INVALID` -> `500 Internal Server Error`

建议导出：

```ts
function toNuxtError(error: unknown): Error
```

---

## 10. 前端 composables 草案

第一版建议至少暴露以下 composables。

## 10.1 `useAuth`

```ts
function useAuth(): {
  authenticated: ComputedRef<boolean>
  claims: ComputedRef<PlatformClaims | null>
}
```

## 10.2 `useAuthorization`

```ts
function useAuthorization(): {
  snapshot: ComputedRef<AuthorizationSnapshot | null>
  roles: ComputedRef<AuthorizationSnapshot['roles']>
  permissions: ComputedRef<AuthorizationSnapshot['permissions']>
}
```

## 10.3 `usePermission`

```ts
function usePermission(): {
  check(input: PermissionCheckInput): PermissionCheckResult
  has(input: PermissionCheckInput): boolean
}
```

## 10.4 `useCapabilities`

```ts
function useCapabilities(): {
  capabilities: ComputedRef<Record<string, string | boolean | number>>
  has(code: string): boolean
  get(code: string): string | boolean | number | undefined
}
```

## 10.5 `usePlatformContext`

```ts
function usePlatformContext(): {
  authenticated: ComputedRef<boolean>
  claims: ComputedRef<PlatformClaims | null>
  authorization: ComputedRef<AuthorizationSnapshot | null>
  capabilities: ComputedRef<Record<string, string | boolean | number>>
}
```

---

## 11. Route Middleware 草案

第一版建议提供可组合的 middleware factory。

## 11.1 `defineAuthMiddleware`

```ts
function defineAuthMiddleware(): RouteMiddleware
```

职责：

- 要求必须登录
- 未登录则跳转 loginRoute

## 11.2 `definePermissionMiddleware`

```ts
function definePermissionMiddleware(input: PermissionCheckInput): RouteMiddleware
```

职责：

- 基于平台级 permission 判断能否进入页面

## 11.3 `defineCapabilityMiddleware`

```ts
function defineCapabilityMiddleware(capabilityCode: string): RouteMiddleware
```

职责：

- 判断 license/capability 是否允许访问

注意：

- middleware 只处理 app 级入口权限
- 业务对象级权限仍由页面数据和服务端决定

---

## 12. 菜单过滤接口

adapter 应提供平台无关的菜单过滤辅助，而不直接渲染菜单。

```ts
type PlatformMenuItem = {
  key: string
  label: string
  to?: string
  resource?: string
  action?: string
  capabilityCode?: string
  children?: PlatformMenuItem[]
}

function filterMenus(
  items: PlatformMenuItem[],
  input: {
    authorization: AuthorizationSnapshot | null
    capabilities?: Record<string, string | boolean | number>
  }
): PlatformMenuItem[]
```

---

## 13. SSR 与 Hydration 边界

adapter 需要解决 SSR 和客户端 hydration 的一致性问题。

建议原则：

- 服务端先构建 platform context
- 客户端 hydration 时消费序列化后的安全快照
- 不在客户端再次自行解析 token

前端可拿到的内容建议仅限：

- `authenticated`
- 脱敏后的 claims
- authorization snapshot
- capabilities

不应直接暴露：

- 原始 token
- revocation snapshot 原文
- bundle 原文

---

## 14. 与 AIMS 的边界

对于 `AIMS`，adapter 负责：

- 登录态接入
- app permission 判断
- route middleware
- 服务端平台级 permission helper

`AIMS` 自己负责：

- 项目级 scope resolver
- `requireProjectPermission()`
- 页面级项目只读/管理态展示

也就是：

- adapter 解决“是否具备平台能力”
- `AIMS` 解决“对这个项目能做什么”

---

## 15. 与 Codocs 的边界

对于 `Codocs`，第一阶段 adapter 主要承接：

- token 验签
- 登录态上下文注入
- 基础 app permission 判断
- 管理后台入口控制

`Codocs` 旧对象级协作权限逻辑继续保留。

---

## 16. 缓存与性能边界

adapter 不应重复实现 SDK 级缓存，但可以做 request-scope 级缓存。

建议：

- SDK 负责跨请求缓存 JWKS / bundle / revocation 等
- adapter 负责单请求内 context 复用

不建议：

- 每个 composable 单独拉取 bundle
- 每个 middleware 重复做全量鉴权装载

---

## 17. 第一版验收标准

第一版 adapter 可认为稳定，至少要满足：

### 17.1 服务端

- 可稳定装载 request context
- 可稳定完成 `requireAuthenticated`
- 可稳定完成 `requirePlatformPermission`

### 17.2 前端

- composables 可稳定消费 SSR 注入状态
- middleware 可稳定工作
- 菜单过滤能力可复用

### 17.3 应用接入

- `AIMS` 可直接作为首个消费者
- `Codocs` 后续可通过 bridge 逐步接入

---

## 18. 推荐下一步

如果采用本草案，下一步建议继续输出：

1. `foundation` 现有鉴权代码拆分清单
2. `AIMS` 对接 `platform-adapter-nuxt` 的最小改造点
3. `hzy_platform` 第一版 API 与 adapter 的字段对齐表

---

## 19. 结论

`platform-adapter-nuxt` 第一版应只做 Nuxt/Nitro 适配层：

- 接 token
- 接 SDK
- 接 request context
- 接 middleware
- 接 composables

不做 UI，不碰业务 resolver。  
只要这层稳定，`AIMS` 可以直接按新平台方式接入，`Codocs` 也能通过兼容层平滑过渡。
