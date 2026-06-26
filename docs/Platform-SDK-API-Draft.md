# platform-sdk API 草案

## 1. 文档目标

本文档用于定义 `platform-sdk` 的第一版 API 边界。

本草案的目标不是给出最终实现细节，而是先把 SDK 的职责、导出接口、输入输出结构、错误模型和缓存边界稳定下来，供以下几方统一依赖：

- `hzy_platform`
- `platform-adapter-nuxt`
- `AIMS`
- 后续 `Codocs`

---

## 2. SDK 定位

`platform-sdk` 是平台协议核心层，负责处理与平台身份和授权运行时相关的通用逻辑。

它必须满足以下约束：

- 不依赖 Vue / Nuxt
- 不依赖 UI 组件
- 不依赖具体业务应用语义
- 可在 Node/Nitro 环境独立运行

它不是：

- 浏览器完整身份 SDK
- Nuxt composables 层
- 业务应用本地 scope resolver

---

## 3. 第一版职责范围

第一版 SDK 只负责以下能力：

### 3.1 Token

- 解析 token
- 验签 token
- 提取标准 claims
- 判断 token 是否过期/吊销

### 3.2 Policy Bundle

- 拉取 bundle 元数据
- 下载 bundle
- 校验 bundle hash / signature
- 读取 bundle 中的授权快照

### 3.3 Revocation

- 拉取 revocation snapshot
- 校验 revocation snapshot
- 判断 token / session / deployment 是否命中吊销

### 3.4 Authorization

- 构建 authorization snapshot
- 执行 `checkPermission()`
- 返回角色、权限、scope、来源

### 3.5 Heartbeat

- 上报 runtime heartbeat
- 查询 license 状态

### 3.6 Manifest

- 解析 app manifest
- 校验 manifest 基础结构

---

## 4. 第一版不负责的事情

第一版 SDK 不负责：

- 登录页跳转 UI
- 浏览器端完整会话管理
- `AIMS` 项目成员判断
- `Codocs` 文档协作权限判断
- 菜单渲染
- 路由守卫实现
- 页面状态管理

这些应由：

- `platform-adapter-nuxt`
- 各 app 本地 resolver
- UI 层

分别承担。

---

## 5. 核心数据类型

第一版建议先稳定以下核心类型。

## 5.1 `PlatformClaims`

```ts
type PlatformClaims = {
  iss: string
  aud: string | string[]
  sub: string
  uid: string
  companyCode?: string
  deploymentId?: string
  sessionId?: string
  capabilityVersion?: string
  bundleVersion?: string
  iat: number
  exp: number
  jti?: string
  raw: Record<string, unknown>
}
```

说明：

- `uid` 是 app 最常用的主体标识
- `raw` 保留原始 claims，便于 adapter 或 app 做必要兼容

## 5.2 `BundleMeta`

```ts
type BundleMeta = {
  deploymentId: string
  bundleVersion: string
  bundleHash: string
  schemaVersion: string
  bundleUri: string
  issuedAt: string
  expiresAt?: string
}
```

## 5.3 `RevocationMeta`

```ts
type RevocationMeta = {
  deploymentId: string
  snapshotVersion: string
  snapshotHash: string
  snapshotUri: string
  issuedAt: string
}
```

## 5.4 `AuthorizationSnapshot`

```ts
type AuthorizationSnapshot = {
  uid: string
  companyCode?: string
  roles: Array<{
    code: string
    type: 'system' | 'base' | 'job' | 'app'
    appCode?: string
    sourceType: string
    sourceId?: string
  }>
  permissions: Array<{
    appCode: string
    resourceCode: string
    action: string
    scopes: Array<{
      scopeType: string
      scopeValue: string
    }>
    sources: Array<{
      sourceType: string
      sourceId?: string
    }>
  }>
  bundleVersion?: string
  generatedAt: string
}
```

## 5.5 `PermissionCheckInput`

```ts
type PermissionCheckInput = {
  appCode: string
  resourceCode: string
  action: string
  context?: Record<string, unknown>
}
```

## 5.6 `PermissionCheckResult`

```ts
type PermissionCheckResult = {
  allow: boolean
  matchedAction?: string
  scopes: Array<{
    scopeType: string
    scopeValue: string
  }>
  sources: Array<{
    sourceType: string
    sourceId?: string
  }>
}
```

---

## 6. SDK 初始化接口

建议统一从 `createPlatformSdk()` 进入。

```ts
type CreatePlatformSdkOptions = {
  issuer: string
  jwksUri: string
  controlPlaneBaseUrl: string
  fetchImpl?: typeof fetch
  cache?: PlatformSdkCache
  logger?: PlatformSdkLogger
  clock?: () => Date
  httpTimeoutMs?: number
}

function createPlatformSdk(options: CreatePlatformSdkOptions): PlatformSdk
```

说明：

- `fetchImpl` 允许在不同 runtime 注入 fetch
- `cache` 由调用方提供，便于 Node/Nitro 环境接 Redis/LRU
- `logger` 由调用方接入，不在 SDK 内硬编码日志实现

---

## 7. 顶层导出接口

第一版建议统一导出以下顶层方法。

## 7.1 `verifyToken`

```ts
async function verifyToken(token: string): Promise<PlatformClaims>
```

职责：

- 解析 JWT
- 拉取或读取缓存中的 JWKS
- 验签
- 检查过期时间

不负责：

- 从 HTTP 请求里取 token
- 自动刷新 token

## 7.2 `loadBundleMeta`

```ts
async function loadBundleMeta(deploymentId: string): Promise<BundleMeta>
```

职责：

- 读取某 deployment 最新 bundle 元信息

## 7.3 `loadBundle`

```ts
async function loadBundle(meta: BundleMeta): Promise<PolicyBundle>
```

职责：

- 下载 bundle
- 校验 hash
- 解析 JSON

## 7.4 `loadRevocationMeta`

```ts
async function loadRevocationMeta(deploymentId: string): Promise<RevocationMeta>
```

## 7.5 `loadRevocationSnapshot`

```ts
async function loadRevocationSnapshot(meta: RevocationMeta): Promise<RevocationSnapshot>
```

## 7.6 `isRevoked`

```ts
function isRevoked(input: {
  claims: PlatformClaims
  revocation: RevocationSnapshot
}): boolean
```

职责：

- 根据 `jti` / `sessionId` / `deploymentId` 等字段判断是否命中吊销

## 7.7 `buildAuthorizationSnapshot`

```ts
function buildAuthorizationSnapshot(input: {
  claims: PlatformClaims
  bundle: PolicyBundle
}): AuthorizationSnapshot
```

职责：

- 从 bundle 中提取当前用户有效角色、权限、scope、来源

## 7.8 `checkPermission`

```ts
function checkPermission(
  snapshot: AuthorizationSnapshot,
  input: PermissionCheckInput
): PermissionCheckResult
```

职责：

- 仅判断平台级 permission
- 支持动作继承，如 `admin -> edit -> view`

不负责：

- 业务上下文 resolver
- 数据库查询过滤

## 7.9 `loadLicenseStatus`

```ts
async function loadLicenseStatus(deploymentId: string): Promise<{
  status: string
  capabilities: Record<string, string | boolean | number>
}>
```

## 7.10 `createHeartbeatClient`

```ts
function createHeartbeatClient(input: {
  deploymentId: string
  runtimeId: string
  sdkVersion: string
}): {
  send(payload: {
    bundleVersion?: string
    licenseStatusSeen?: string
    extra?: Record<string, unknown>
  }): Promise<void>
}
```

## 7.11 `parseManifest`

```ts
function parseManifest(input: unknown): AppManifest
```

## 7.12 `validateManifest`

```ts
function validateManifest(manifest: AppManifest): ManifestValidationResult
```

---

## 8. 推荐对象结构

除函数式导出外，也建议提供统一对象接口。

```ts
type PlatformSdk = {
  verifyToken(token: string): Promise<PlatformClaims>
  loadBundleMeta(deploymentId: string): Promise<BundleMeta>
  loadBundle(meta: BundleMeta): Promise<PolicyBundle>
  loadRevocationMeta(deploymentId: string): Promise<RevocationMeta>
  loadRevocationSnapshot(meta: RevocationMeta): Promise<RevocationSnapshot>
  isRevoked(input: { claims: PlatformClaims; revocation: RevocationSnapshot }): boolean
  buildAuthorizationSnapshot(input: {
    claims: PlatformClaims
    bundle: PolicyBundle
  }): AuthorizationSnapshot
  checkPermission(snapshot: AuthorizationSnapshot, input: PermissionCheckInput): PermissionCheckResult
  loadLicenseStatus(deploymentId: string): Promise<LicenseStatus>
  createHeartbeatClient(input: HeartbeatClientInput): HeartbeatClient
  parseManifest(input: unknown): AppManifest
  validateManifest(manifest: AppManifest): ManifestValidationResult
}
```

这样 `platform-adapter-nuxt` 和测试代码都更容易注入和 mock。

---

## 9. 动作继承规则

第一版 SDK 应内置动作继承规则，但只处理平台级继承。

建议固定为：

- `admin` 隐含 `edit`
- `edit` 隐含 `view`

也就是：

```ts
admin => ['admin', 'edit', 'view']
edit => ['edit', 'view']
view => ['view']
```

不建议把这个逻辑放到 app 自己实现，否则不同 app 很容易分裂。

---

## 10. Scope 处理边界

SDK 只负责返回平台层 scope，不解释业务语义。

例如：

- `all`
- `self`
- `department`
- `project_member`

SDK 会把这些 scope 返回给调用方，但不会判断：

- 某个用户是不是具体项目成员
- 某篇文档是不是由该用户参与协作

这些由 app 本地 resolver 负责。

---

## 11. 缓存边界

第一版建议 SDK 允许外部注入缓存，但不强制绑定某个缓存实现。

```ts
type PlatformSdkCache = {
  get<T>(key: string): Promise<T | null> | T | null
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> | void
  delete?(key: string): Promise<void> | void
}
```

建议缓存对象：

- JWKS
- BundleMeta
- PolicyBundle
- RevocationMeta
- RevocationSnapshot
- LicenseStatus

不建议缓存对象：

- HTTP Request 本地用户上下文
- app 自己的业务 resolver 结果

---

## 12. 错误模型

建议 SDK 输出结构化错误，而不是只抛普通字符串错误。

```ts
type PlatformSdkErrorCode =
  | 'TOKEN_INVALID'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_REVOKED'
  | 'JWKS_LOAD_FAILED'
  | 'BUNDLE_LOAD_FAILED'
  | 'BUNDLE_INVALID'
  | 'REVOCATION_LOAD_FAILED'
  | 'LICENSE_LOAD_FAILED'
  | 'MANIFEST_INVALID'
  | 'NETWORK_ERROR'

class PlatformSdkError extends Error {
  code: PlatformSdkErrorCode
  details?: Record<string, unknown>
}
```

这样 adapter 层才能稳定映射为：

- 401
- 403
- 503
- 页面降级状态

---

## 13. 日志边界

SDK 不应直接依赖某个日志框架，只接受注入 logger。

```ts
type PlatformSdkLogger = {
  debug?(message: string, meta?: Record<string, unknown>): void
  info?(message: string, meta?: Record<string, unknown>): void
  warn?(message: string, meta?: Record<string, unknown>): void
  error?(message: string, meta?: Record<string, unknown>): void
}
```

日志建议只记录：

- 外部请求失败
- bundle / revocation 校验失败
- token 验签失败
- heartbeat 上报失败

不建议记录：

- 完整 token
- 敏感 claims
- 完整 bundle 内容

---

## 14. 与 adapter 的边界

`platform-sdk` 和 `platform-adapter-nuxt` 的边界要明确：

### SDK 负责

- 协议处理
- 校验
- 权限计算
- 结构化输出

### Adapter 负责

- 从 HTTP 请求取 token
- 注入 request context
- 暴露 composables
- 暴露 route middleware
- 为 UI 提供已加工状态

---

## 15. 与 AIMS / Codocs 的边界

### 15.1 对 AIMS

`AIMS` 应直接使用 SDK 返回的：

- claims
- authorization snapshot
- permission check result

然后再叠加本地项目级 resolver。

### 15.2 对 Codocs

`Codocs` 第一阶段主要使用：

- token 验签
- 基础 permission check

对象级协作权限继续由 `Codocs` 自己解释。

---

## 16. 第一版验收标准

`platform-sdk` 第一版可认为稳定，至少要满足：

### 16.1 独立性

- 可独立构建
- 无 Vue / Nuxt 依赖
- 可在 Node/Nitro 环境运行

### 16.2 核心能力

- 能完成 token 验签
- 能完成 bundle / revocation 加载
- 能完成平台 permission check
- 能支持 heartbeat 上报

### 16.3 可接入性

- `platform-adapter-nuxt` 可直接消费
- `AIMS` 可作为首个真实消费者

### 16.4 可演进性

- 后续可拆成正式 npm 包
- API 不需要因 UI 迁移而大改

---

## 17. 推荐下一步

如果采用本草案，下一步建议继续输出：

1. `platform-adapter-nuxt` API 草案
2. `foundation` 现有鉴权代码拆分清单
3. `AIMS` 对接 `platform-sdk` 的最小代码改造点

---

## 18. 结论

`platform-sdk` 第一版应聚焦平台协议 core，只做：

- token
- bundle
- revocation
- permission
- heartbeat
- manifest

不碰 UI、不碰框架、不碰业务语义。  
只要这层接口稳定，`foundation` 的 adapter、`AIMS` 的首个接入、以及未来 `Codocs` 的兼容接入都会顺很多。
