# Foundation SDK 契约 v1

状态：Draft  
日期：2026-04-21  
定位：目标设计，作为 `Huizhi-yun-Platform-Target-Architecture.md`、`Identity-Plane-Design.md` 与 `Control-Plane-API-Contract.md` 的配套文档

---

## 0. 文档目标

本文档定义 `Foundation SDK` 在客户侧运行时中的职责、接口、缓存策略和错误处理约定，重点回答：

- SDK 到底负责什么，不负责什么
- 业务应用如何接入 SDK
- Token / Policy Bundle / Revocation 如何在本地验证
- Heartbeat 如何上报
- `aims` / `codocs` 这类 app 需要实现什么契约

本文档不展开：

- SDK 的具体代码组织
- 不同语言实现细节
- UI 组件与 Nuxt Layer 的前端能力

---

## 1. 定位

`Foundation SDK` 是业务应用运行时与平台 `Control Plane / Identity Plane` 之间的统一适配层。

它在客户侧承担三类职责：

1. 信任校验  
2. 授权消费  
3. 平台同步

一句话：

**SDK 负责“信任和授权通用能力”，业务应用负责“业务关系和业务规则”。**

---

## 2. 设计原则

| # | 原则 |
|---|------|
| S1 | SDK 不承载业务规则 |
| S2 | SDK 默认本地执行，不逐请求回源平台 |
| S3 | SDK 只消费平台签名对象，不信任未签名数据 |
| S4 | SDK 应支持无 Nuxt 运行时的服务端环境 |
| S5 | SDK 对业务应用暴露稳定接口，不暴露平台内部实现细节 |
| S6 | Token、Bundle、Revocation、License 四类对象使用统一缓存与校验框架 |

---

## 3. SDK 的职责边界

### 3.1 负责

- 验证 access token
- 拉取并验证 policy bundle
- 拉取并验证 revocation list
- 缓存 bundle / revocation / registry 元数据
- 解释动作继承（`admin -> edit -> view`）
- 解析权限与 scope
- 对接 Heartbeat 接口
- 暴露统一错误码与诊断信息

### 3.2 不负责

- 解释项目成员、协作者、负责人等业务关系
- 查询业务数据库
- 拼业务 SQL where 条件
- 决定页面布局或业务交互
- 管理平台侧用户密码或登录流程

### 3.3 业务应用必须自己负责

- `scope resolver`
- 业务对象访问控制
- 本地用户显示信息获取
- 业务审计日志

---

## 4. SDK 输入与依赖

### 4.1 必要配置

```ts
type FoundationSdkConfig = {
  deploymentId: string
  tenantCode: string
  appCode: string
  controlPlaneBaseUrl: string
  runtimeCredential: string
  publicKeys: {
    tokenIssuer: string
    licenseIssuer?: string
  }
  cache: CacheAdapter
  http: HttpAdapter
  clock?: ClockAdapter
  logger?: LoggerAdapter
}
```

### 4.2 可插拔依赖

SDK 至少允许注入以下 adapter：

- `CacheAdapter`
- `HttpAdapter`
- `LoggerAdapter`
- `ClockAdapter`

这样可适配：

- Node/Nitro
- 独立服务进程
- 客户侧边车进程

---

## 5. 核心对象模型

### 5.1 Verified Token

```ts
type VerifiedToken = {
  iss: string
  sub: string
  tenant: string
  sid: string
  policyVer: string
  caps: string
  iat: number
  exp: number
}
```

### 5.2 Verified Policy Bundle

```ts
type VerifiedPolicyBundle = {
  tenantCode: string
  bundleVersion: string
  bundleHash: string
  bundle: {
    applications: unknown[]
    resources: unknown[]
    roles: unknown[]
    rolePermissions: unknown[]
    templates: unknown[]
    templateBindings: unknown[]
    templateOverrides: unknown[]
    roleScopes: unknown[]
    capabilities: string[]
  }
  generatedAt: string
}
```

### 5.3 Verified Revocation List

```ts
type VerifiedRevocationList = {
  revocationVersion: string
  entries: Array<{
    targetType: 'session' | 'bundle' | 'license' | 'deployment'
    targetId: string
    reason?: string
    revokedAt: string
  }>
}
```

### 5.4 Authorization Snapshot

```ts
type AuthorizationSnapshot = {
  subjectId: string
  tenantCode: string
  appCode?: string
  bundleVersion: string
  roles: EffectiveRole[]
  permissions: EffectivePermission[]
  scopes: EffectiveScope[]
}
```

---

## 6. SDK 对业务应用暴露的接口

### 6.1 初始化

```ts
function createFoundationSdk(config: FoundationSdkConfig): FoundationSdk
```

### 6.2 鉴权相关

```ts
interface FoundationSdk {
  verifyToken(rawToken: string): Promise<VerifiedToken>
  loadPolicyBundle(force?: boolean): Promise<VerifiedPolicyBundle>
  loadRevocationList(force?: boolean): Promise<VerifiedRevocationList>
  getAuthorizationSnapshot(token: VerifiedToken, options?: { appCode?: string }): Promise<AuthorizationSnapshot>
  hasRole(snapshot: AuthorizationSnapshot, roleCode: string): boolean
  hasPermission(
    snapshot: AuthorizationSnapshot,
    input: { appCode: string; resourceCode: string; action: 'view' | 'edit' | 'admin' }
  ): boolean
  getScopes(
    snapshot: AuthorizationSnapshot,
    input: { appCode: string; resourceCode: string; action: 'view' | 'edit' | 'admin' }
  ): EffectiveScope[]
  checkPermission(
    token: VerifiedToken,
    input: { appCode: string; resourceCode: string; action: 'view' | 'edit' | 'admin' }
  ): Promise<PermissionCheckResult>
  sendHeartbeat(payload?: Partial<HeartbeatPayload>): Promise<HeartbeatResult>
}
```

### 6.3 返回值

```ts
type PermissionCheckResult = {
  allowed: boolean
  matchedAction: 'view' | 'edit' | 'admin' | null
  scopes: EffectiveScope[]
}
```

```ts
type HeartbeatPayload = {
  runtimeVersion: string
  appCodes: string[]
  currentBundleVersion: string
  currentRevocationVersion: string
  licenseFingerprint: string
  coarseMetrics?: Record<string, unknown>
}
```

```ts
type HeartbeatResult = {
  licenseStatus: 'active' | 'grace' | 'expired' | 'revoked'
  graceDeadline?: string
  latestBundleVersion?: string
  latestRevocationVersion?: string
  actions: Array<{
    type: 'download_bundle' | 'download_revocations'
    version: string
  }>
}
```

---

## 7. Token 验证契约

### 7.1 `verifyToken()`

必须执行：

1. 验签
2. 校验 `iss === deploymentId`
3. 校验 `tenant === tenantCode`
4. 校验 `exp`
5. 校验 deployment 未被吊销
6. 校验 session 未被吊销

### 7.2 验证失败的标准错误

应抛出标准错误码：

- `auth_invalid_token`
- `auth_invalid_signature`
- `auth_invalid_issuer`
- `auth_invalid_tenant`
- `auth_expired_token`
- `auth_session_revoked`
- `auth_deployment_disabled`

---

## 8. Bundle 缓存与验证契约

### 8.1 缓存 Key

建议至少按以下维度缓存：

```ts
bundle:${deploymentId}:${tenantCode}
bundle-meta:${deploymentId}:${tenantCode}
revocation:${deploymentId}:${tenantCode}
registry:${deploymentId}:${tenantCode}
```

### 8.2 `loadPolicyBundle()`

流程建议：

```ts
async function loadPolicyBundle(force = false) {
  if (!force) {
    const cached = await cache.get(bundleKey)
    if (cached && !isExpired(cached)) return cached
  }

  const meta = await api.getLatestBundleMeta()
  const local = await cache.get(bundleKey)

  if (local && local.bundleVersion === meta.bundleVersion && !force) {
    return local
  }

  const downloaded = await api.downloadBundle(meta.bundleVersion)
  const verified = verifyPolicyBundle(downloaded)

  await cache.set(bundleKey, verified)
  return verified
}
```

### 8.3 `verifyPolicyBundle()`

必须校验：

1. `tenantCode`
2. `bundleVersion`
3. `bundleHash`
4. `signature`
5. bundle 未被吊销

验证失败错误码建议：

- `policy_bundle_not_found`
- `policy_bundle_signature_invalid`
- `policy_bundle_hash_mismatch`
- `policy_bundle_revoked`

---

## 9. Revocation 缓存与验证契约

### 9.1 `loadRevocationList()`

流程建议：

```ts
async function loadRevocationList(force = false) {
  if (!force) {
    const cached = await cache.get(revocationKey)
    if (cached && !isExpired(cached)) return cached
  }

  const meta = await api.getLatestRevocationMeta()
  const local = await cache.get(revocationKey)

  if (local && local.revocationVersion === meta.revocationVersion && !force) {
    return local
  }

  const downloaded = await api.downloadRevocations(meta.revocationVersion)
  const verified = verifyRevocationList(downloaded)

  await cache.set(revocationKey, verified)
  return verified
}
```

### 9.2 `verifyRevocationList()`

必须校验：

1. 签名
2. 版本号
3. 结构合法性

验证失败错误码建议：

- `revocation_not_found`
- `revocation_signature_invalid`
- `revocation_payload_invalid`

---

## 10. 权限解析契约

### 10.1 `getAuthorizationSnapshot()`

职责：

- 基于已验证 token 和本地 bundle
- 计算当前用户在目标 app 下的：
  - `roles`
  - `permissions`
  - `scopes`

实现要求：

- 复用《授权解析器伪代码》定义的优先级和仲裁逻辑
- 不在 SDK 中解释业务关系

### 10.2 `hasPermission()`

必须支持动作继承：

- `admin -> edit -> view`
- `edit -> view`

伪代码：

```ts
function hasPermission(snapshot, input) {
  const required = expandRequiredActions(input.action)
  return snapshot.permissions.some(p =>
    p.appCode === input.appCode &&
    p.resourceCode === input.resourceCode &&
    required.includes(p.action)
  )
}
```

### 10.3 `getScopes()`

职责：

- 只返回当前 `(appCode, resourceCode, action)` 对应的有效 scope
- 不解释业务语义

---

## 11. 业务应用需实现的契约

SDK 不负责 `member / owner / participant` 这些业务语义。  
业务应用必须实现 `ScopeResolver`。

```ts
type ScopeResolverInput = {
  subjectId: string
  resourceCode: string
  action: 'view' | 'edit' | 'admin'
  scopes: EffectiveScope[]
  context: Record<string, unknown>
}

interface ScopeResolver {
  resolve(input: ScopeResolverInput): Promise<boolean>
}
```

### 11.1 `aims` 典型实现

例如：

- `self`：本人创建 / 本人负责
- `department`：项目归属部门 = 当前用户部门
- `member`：当前用户是项目成员

### 11.2 `codocs` 典型实现

例如：

- `self`：本人创建文档
- `department`：文档归属部门 = 当前用户部门
- `participant`：当前用户在协作者列表中

---

## 12. Heartbeat 契约

### 12.1 `sendHeartbeat()`

职责：

- 周期上报本地状态
- 获取最新 bundle / revocation / license 变化

触发时机建议：

- 定时任务
- 应用启动后延迟执行一次
- 管理员进入平台状态页时允许手动触发

### 12.2 默认行为

建议：

- 若 heartbeat 成功，更新本地状态缓存
- 若返回下载动作，异步拉取并替换缓存
- 若 heartbeat 失败，保留现有 bundle 与 revocation
- 若超过 `grace_days` 未成功，则进入受限模式

### 12.3 受限模式暴露接口

SDK 建议对业务应用暴露：

```ts
function getRuntimeStatus(): {
  licenseStatus: 'active' | 'grace' | 'expired' | 'revoked'
  graceDeadline?: string
  restricted: boolean
}
```

业务应用据此决定：

- 是否只读
- 是否允许新登录
- 是否展示告警横幅

---

## 13. 缓存策略

### 13.1 默认 TTL 建议

第一版建议：

- Token：按 `exp` 自然失效
- Bundle Meta：60 秒
- Bundle：长期缓存，按版本淘汰
- Revocation Meta：60 秒
- Revocation：长期缓存，按版本淘汰
- Registry：5 分钟
- Runtime Status：1 分钟

### 13.2 失效原则

SDK 不自己主动做复杂失效推理。  
第一版依赖：

- 版本比对
- Heartbeat 返回动作
- TTL

---

## 14. 错误模型

### 14.1 标准错误结构

```ts
type FoundationError = {
  code: string
  message: string
  retriable: boolean
  details?: Record<string, unknown>
}
```

### 14.2 错误分类

建议至少支持：

- `auth_invalid_token`
- `auth_invalid_signature`
- `auth_invalid_issuer`
- `auth_invalid_tenant`
- `auth_expired_token`
- `auth_session_revoked`
- `policy_bundle_not_found`
- `policy_bundle_signature_invalid`
- `policy_bundle_hash_mismatch`
- `policy_bundle_revoked`
- `revocation_not_found`
- `revocation_signature_invalid`
- `runtime_heartbeat_failed`
- `license_expired`
- `license_revoked`
- `runtime_restricted_mode`

### 14.3 重试原则

- 签名失败、issuer 错误、tenant 错误：不重试
- 网络失败、平台超时：可重试
- Heartbeat 失败：指数退避
- Bundle 下载失败：保留当前版本，稍后重试

---

## 15. 日志与诊断

SDK 应输出以下日志维度：

- 当前 deployment / tenant / app
- 当前 bundleVersion / revocationVersion
- token 验签结果
- bundle 校验结果
- revocation 校验结果
- heartbeat 成功 / 失败
- 当前运行模式：`active / grace / restricted`

同时建议暴露一个诊断接口：

```ts
function getDiagnostics(): {
  deploymentId: string
  tenantCode: string
  appCode: string
  bundleVersion?: string
  revocationVersion?: string
  runtimeStatus: string
  lastHeartbeatAt?: string
  lastBundleSyncAt?: string
}
```

---

## 16. 第一版实现边界

第一版建议收敛到：

- Node/Nitro 服务端环境可用
- 支持 JWT 验签
- 支持 tenant 级 bundle
- 支持 revocation list
- 支持 heartbeat
- 支持权限解析与 scope 读取
- 支持业务应用注入 `ScopeResolver`

第一版暂不做：

- 浏览器侧完整 SDK
- 多语言 SDK
- 长连接推送
- 用户级 bundle 增量下发
- 复杂离线冲突解决

---

## 17. 后续建议

基于本文，下一步最适合继续补：

1. 《License 与 Capability 清单》
   明确 `grace`、`restricted`、`expired` 三类状态下的功能开关

2. 《App Manifest 规范》
   明确 app 注册资源、推荐角色、支持 scope 的结构约束
