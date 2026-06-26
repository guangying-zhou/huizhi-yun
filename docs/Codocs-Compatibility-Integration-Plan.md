# Codocs 新架构完全切换计划

> 目标窗口：2 天内完成 `Codocs` 从 legacy Account/CAS 权限链路切换到 `Platform + Console + Foundation` 新架构。  
> 基准日期：2026-05-02。  
> 参考实现：`aims` 当前的新架构接入方式。

## 1. 结论

`Codocs` 不应再按“长期兼容、逐步并存”的路径推进。当前 `platform`、`console`、`foundation` 与 `aims` 已经具备新架构首批闭环能力：

- `platform` 已承接应用注册、manifest 导入、系统角色、policy bundle、runtime token、license、deployment heartbeat。
- `console` 已承接企业基础运行时、OIDC/auth-runtime、directory-runtime、policy bundle 本地授权、service client、vault/integration。
- `foundation` 已提供 Console OIDC、服务端 `event.context.consoleAuth`、目录 adapter、startup activation、bundle cache、应用入口、统一路由鉴权 composable。
- `aims` 已按新路径落地：默认 Console OIDC，服务端通过 `getRequestUid()` 优先取 `consoleAuth.uid`，权限优先读本地 cached policy bundle，再 fallback Platform runtime。

因此 `Codocs` 的迁移目标调整为：

1. 两天内完成应用级、路由级、服务端通用权限切换。
2. 保留文档对象级协作权限、分享权限、文件夹/空间继承规则在 Codocs 内部判断。
3. 不再保留 Account 权限 API 作为默认运行链路。
4. 仅用 `HZY_AUTH_MODE=legacy` / `HZY_LEGACY_AUTH_BRIDGE=true` 作为应急回退开关。

最终权限模型：

```text
Allow = PlatformAppPermission && CodocsObjectPermission
```

平台负责“用户是否拥有 Codocs 某类能力”，Codocs 负责“用户是否能操作某个具体文档/文件夹/分享对象”。

## 2. 当前现状判断

### 2.1 Platform 现状

`platform/CLAUDE.md` 已明确：

- 控制面拥有 app registry、subscriptions、deployments、licenses、policy bundle、role/template governance。
- manifest 资源已物化到 `platform_app_manifest_resources` 与 `platform_app_manifest_resource_actions`。
- runtime 合约走 `/api/v1/runtime/**`、`/api/v1/policy/**`、`/api/v1/registry/**`。
- 业务应用运行时使用 `HZY_PLATFORM_RUNTIME_TOKEN` 拉取 bundle，并通过 foundation 缓存到 `.data/platform-runtime`。

Codocs 迁移不需要改 Platform 架构，只需要：

- 提供 `codocs/app.manifest.json`。
- 在 Platform 中导入并发布 Codocs release。
- 为租户订阅/部署分配 Codocs。
- 生成 Codocs runtime env 与 license。
- 配置 Codocs 系统角色与租户授权。

### 2.2 Console 现状

`console/CLAUDE.md` 已明确：

- Console 是客户侧基础运行服务，承接 `directory-runtime` 与 `auth-runtime`。
- Console 启动消费 `console.env` 与 `license.lic`。
- Console 本地读取已验签 policy bundle，`/api/auth/permissions` 不再代理 Account。
- Console OIDC 负责登录、会话、JWKS、token。
- 业务应用通过 Foundation adapter 读取目录、集成配置与服务凭证。

Codocs 迁移不应直接调用 Console 数据库，也不应直接调用 vault resolve。目录读取必须通过 Foundation 的 `/api/directory/**` 或 server adapter。

### 2.3 Foundation 现状

Foundation 已提供 Codocs 迁移所需的通用能力：

- `useAuth()`：默认 Console OIDC，legacy bridge 仅由开关启用。
- `server/middleware/console-auth.ts`：验证 Console token 并注入 `event.context.consoleAuth`。
- `useRouteAccess()`：统一 auth 与 permission route guard。
- `usePermissions()` / `usePlatformPermission()`：统一权限快照消费。
- `/api/user/applications`：读取 cached bundle / Platform runtime applications。
- `/api/directory/**`：Console Directory Runtime 代理。
- `platformActivationRuntime.ts`：license 验签、bundle 拉取、heartbeat。

Codocs 当前最大问题不是缺能力，而是本地文件覆盖了 Foundation 的新能力。

### 2.4 Aims 可复用实现

`aims` 的新架构接入方式可直接复用到 Codocs：

- `aims/nuxt.config.ts`
  - 读取 `license.lic` bootstrap 中的 `consoleUrl` / `tokenUrl`。
  - 配置 `hzy.directory.provider=console`。
  - 配置 `hzy.platformBaseUrl`、`hzy.platformRuntimeToken`、`hzy.platformTenantCode`。
  - `public.authMode` 与 `public.legacyAuthBridge` 控制 legacy fallback。

- `aims/server/utils/authIdentity.ts`
  - `getRequestUid(event)` 优先读 `event.context.consoleAuth.uid`。
  - 只有 legacy 开关打开时才读 `auth_user` cookie。

- `aims/server/utils/platformBundleAuthorization.ts`
  - 优先从 Foundation cached policy bundle 解析角色、模板、覆盖与权限。

- `aims/server/utils/checkPermission.ts`
  - 权限优先读 cached bundle。
  - Platform runtime users authorization 仅作为辅助 fallback。

- `aims/app/middleware/auth.global.ts`
  - 通过 `useRouteAccess().createAuthRouteMiddleware()` 统一认证守卫。

- `aims/app/middleware/permission.global.ts`
  - 通过 `useRouteAccess().createPermissionRouteMiddleware()` 统一路由权限守卫。

Codocs 应直接复制这个接入形态，而不是继续维护本地 Account-first 鉴权。

### 2.5 Codocs 当前阻塞点

当前 Codocs 已 `extends: ['@hzy/foundation']`，但仍存在以下 legacy 覆盖：

| 位置 | 当前行为 | 迁移处理 |
| ---- | -------- | -------- |
| `codocs/app/composables/useAuth.ts` | 本地读取 `auth_user` / `token` / CAS logout | 删除或改为 thin wrapper，使用 Foundation `useAuth` |
| `codocs/app/composables/usePermissions.ts` | 调 `/api/auth/permissions`，按 Account 格式判断 | 删除或改为 Foundation `usePermissions` |
| `codocs/app/middleware/permission.global.ts` | 手写权限守卫 | 改成 Aims 同款 `useRouteAccess` |
| `codocs/server/api/auth/permissions.get.ts` | 代理 Account `/users/{uid}/permissions` | 改成 cached policy bundle 授权解析 |
| `codocs/server/utils/checkPermission.ts` | 服务端直连 Account 权限 API | 改成 Aims 同款 bundle-first 权限检查 |
| 大量 `getCookie(event, 'auth_user')` | 服务端身份硬绑旧 cookie | 分两批改为 `getRequestUid(event)` |
| `codocs/server/api/auth/wecom-*` / `/api/wecom/oauth` | 应用内自建企业微信登录 | 默认下线，legacy 模式保留 |
| `codocs/server/api/account/**` | Codocs 本地 Account 代理 | 改为 Console Directory Runtime 兼容代理或停止新增使用 |
| `codocs/nuxt.config.ts` | 缺 Aims 同款 platform / console runtime config | 补齐 |
| 缺 `codocs/app.manifest.json` | Platform 无法导入资源与角色 | 新增 |
| `codocs/hocuspocus` | 协作 token 与主会话脱钩 | 保留 token 机制，但签发 token 的 Nuxt API 要用新身份 |

## 3. 两天切换范围

### 3.1 必须完成

- Codocs 默认登录改为 Console OIDC。
- Codocs 前端应用壳、用户菜单、应用入口读取 Foundation 新 auth state。
- Codocs 前端路由权限读取 Platform policy bundle 权限。
- Codocs 服务端新增统一 `getRequestUid()`。
- 关键服务端接口不再直接读 `auth_user` 作为唯一身份来源。
- 服务端 `checkPermission/requirePermission` 不再调用 Account 权限 API。
- Codocs manifest 可被 Platform 导入、发布、分配角色、生成 policy bundle。
- Hocuspocus 协作 token 签发链路使用新身份。
- Aims iframe 嵌入 Codocs 的链路可在 Console OIDC 下正常跳转或复用 session。

### 3.2 两天内不做

- 不重写 Milkdown/Yjs/Hocuspocus 架构。
- 不把文档对象级 ACL 迁入 Platform。
- 不把分享链接、评论、版本、附件、文件柜所有细粒度动作一次性资源化。
- 不把 Codocs 业务数据迁到 Console 或 Platform。
- 不引入新的 Codocs 权限表。

### 3.3 保留的 legacy 边界

只允许以下 legacy fallback：

- `HZY_AUTH_MODE=legacy` 或 `HZY_LEGACY_AUTH_BRIDGE=true` 时，允许 `auth_user` cookie 继续作为身份来源。
- 企业微信/CAS 本地回调只在 legacy 模式可用。
- `/api/account/**` 只作为目录迁移兼容接口，不能再服务权限治理。

## 4. 目标架构

```text
Platform
  - app registry: codocs manifest / release
  - subscription/deployment/license/runtime token
  - system roles / tenant roles / policy bundle

Console
  - OIDC auth-runtime
  - directory-runtime
  - local policy authorization
  - service client credentials

Foundation
  - Console OIDC client
  - request consoleAuth context
  - platform activation / bundle cache / heartbeat
  - directory adapter
  - route/auth/permission composables

Codocs
  - documents/folders/reviews/collaboration domain
  - object-level document permission
  - hocuspocus collaboration token issuing
```

服务端身份读取顺序：

```text
event.context.consoleAuth.uid
  -> legacy enabled ? auth_user cookie : empty
```

权限读取顺序：

```text
Foundation cached policy bundle
  -> Platform runtime authorization fallback
  -> deny
```

目录读取顺序：

```text
Foundation /api/directory/**
  -> Console /api/v1/console/directory/**
```

## 5. Codocs Manifest 第一版

新增 `codocs/app.manifest.json`，第一版资源保持粗粒度，便于两天内落地。

```json
{
  "appCode": "codocs",
  "appName": "汇智云文档",
  "appType": "business",
  "description": "协作文档、知识库、项目文档、部门文档、文档审阅与发布。",
  "icon": "i-lucide-files",
  "entry": {
    "web": "/",
    "apiBase": "/api/v1/codocs"
  },
  "runtimeRequirements": {
    "requiresSdk": true,
    "supportsCustomerHosted": true,
    "supportsManagedControlPlane": false
  },
  "compatibility": {
    "minControlPlaneVersion": "0.1.0",
    "minSdkVersion": "0.1.0"
  },
  "resources": [
    {
      "code": "documents",
      "name": "文档中心",
      "description": "个人文档、共享文档、收藏、回收站与通用文档操作",
      "actions": ["view", "create", "edit", "delete", "admin"],
      "sortOrder": 10
    },
    {
      "code": "projects",
      "name": "项目文档",
      "description": "项目组文档、代码库文档、需求与缺陷关联文档",
      "actions": ["view", "create", "edit", "admin"],
      "sortOrder": 20
    },
    {
      "code": "departments",
      "name": "部门文档",
      "description": "部门协同文档、会议记录、周报、部门文件柜",
      "actions": ["view", "create", "edit", "admin"],
      "sortOrder": 30
    },
    {
      "code": "company",
      "name": "组织资产",
      "description": "公司制度、公告、法务合规、技术规范、产品资料与知识库",
      "actions": ["view", "create", "edit", "publish", "admin"],
      "sortOrder": 40
    },
    {
      "code": "reviews",
      "name": "审阅中心",
      "description": "文档审阅、审批、归档与盖章流程",
      "actions": ["view", "submit", "approve", "archive", "admin"],
      "sortOrder": 50
    },
    {
      "code": "info",
      "name": "资讯中心",
      "description": "前沿资讯、推荐文章、资讯书签管理",
      "actions": ["view", "edit", "admin"],
      "sortOrder": 60
    },
    {
      "code": "admin",
      "name": "系统管理",
      "description": "模板、发文流程、图片清理、归档管理等应用后台能力",
      "actions": ["view", "admin"],
      "sortOrder": 90
    }
  ],
  "recommendedRoles": [
    {
      "code": "codocs:viewer",
      "name": "Codocs 只读",
      "description": "可进入 Codocs 并查看被授权的文档资源",
      "suggestedPermissions": [
        "codocs:documents:view",
        "codocs:projects:view",
        "codocs:departments:view",
        "codocs:company:view",
        "codocs:reviews:view",
        "codocs:info:view"
      ]
    },
    {
      "code": "codocs:editor",
      "name": "Codocs 编辑",
      "description": "可创建、编辑被授权范围内的文档",
      "suggestedPermissions": [
        "codocs:documents:create",
        "codocs:documents:edit",
        "codocs:projects:create",
        "codocs:projects:edit",
        "codocs:departments:create",
        "codocs:departments:edit",
        "codocs:company:edit",
        "codocs:reviews:submit"
      ]
    },
    {
      "code": "codocs:publisher",
      "name": "Codocs 发布审阅",
      "description": "可处理组织资产发布与审阅归档流程",
      "suggestedPermissions": [
        "codocs:company:publish",
        "codocs:reviews:approve",
        "codocs:reviews:archive"
      ]
    },
    {
      "code": "codocs:admin",
      "name": "Codocs 管理员",
      "description": "管理 Codocs 应用配置、模板、发文流程与全局文档能力",
      "suggestedPermissions": [
        "codocs:documents:admin",
        "codocs:projects:admin",
        "codocs:departments:admin",
        "codocs:company:admin",
        "codocs:reviews:admin",
        "codocs:info:admin",
        "codocs:admin:admin"
      ]
    }
  ],
  "supportedScopes": [
    "tenant:global",
    "department:tree",
    "project:member",
    "subject:self"
  ],
  "capabilitiesRequired": [
    "platform:app-registry"
  ]
}
```

注意：

- `documents:view` 只表示可进入文档中心，不代表可读取任意具体文档。
- 具体文档读写仍由 Codocs `documentAccess` / share / owner / department / project 逻辑判断。
- `company:publish`、`reviews:approve`、`reviews:archive` 是两天内建议纳入的少量关键动作，因为它们影响发布与审阅链路。

## 6. 文件级改造清单

### 6.1 配置层

改造 `codocs/nuxt.config.ts`：

- 补齐 Aims 同款 `readLicenseBootstrapConfig()`。
- `hzy.directory.provider` 默认在 license 中存在 consoleUrl 时设为 `console`。
- 增加：
  - `hzy.directory.consoleApiUrl`
  - `hzy.integration.consoleApiUrl`
  - `hzy.serviceClient`
  - `hzy.platformBaseUrl`
  - `hzy.platformRuntimeToken`
  - `hzy.platformTenantCode`
  - `public.authMode`
  - `public.legacyAuthBridge`
  - `public.appCode='codocs'`
  - `public.consoleUrl`
  - `public.appDisplayName`
  - `public.appIcon`
- 保留 Codocs 私有配置：DB、collaboration、OSS、Slidev、FastAPI。
- `HZY_ACCOUNT_API_*` 仅保留给 legacy bridge 与尚未改完的目录兼容，不作为默认权限链路。

### 6.2 前端认证

处理 `codocs/app/composables/useAuth.ts`：

- 首选方案：删除本地文件，让 Nuxt Layer 使用 Foundation `useAuth()`。
- 若页面存在 Codocs 特有字段依赖，则改为 thin wrapper：
  - 内部调用 Foundation auth。
  - 不再直接读 `auth_user` / `token` 作为主身份。
  - logout 调 Foundation `/api/auth/logout`，不再拼 CAS logout。

处理 `codocs/app/pages/login.vue`：

- 默认进入 `/api/auth/oidc-login`。
- legacy 模式下才展示或触发 CAS/企业微信本地登录。
- 登录页不要自行写旧 cookie。

### 6.3 前端权限

处理 `codocs/app/composables/usePermissions.ts`：

- 首选方案：删除本地文件，让 Foundation `usePermissions()` 生效。
- 如需保留菜单过滤类型，则只做类型适配，不保留 Account 格式判断。

处理 `codocs/app/middleware/permission.global.ts`：

- 改为 Aims 同款：
  - `useRouteAccess().createPermissionRouteMiddleware()`
  - `resolveRule()` 读取 `codocs/app/config/permissions.ts`
  - 未授权跳转首页或专用无权限页。

处理 `codocs/app/config/permissions.ts`：

- 保留 `menus` 与 `routeRules`。
- 将注释从“同步到 Account”改为“与 app.manifest.json 对齐”。
- route rule 的资源必须与 manifest resource code 一致。

### 6.4 服务端身份

新增 `codocs/server/utils/authIdentity.ts`，直接采用 Aims 模式：

```ts
export function getRequestUid(event: H3Event) {
  const consoleAuth = event.context.consoleAuth as ConsoleAuthContext | undefined
  const verifiedUid = String(consoleAuth?.uid || '').trim()

  if (consoleAuth?.authenticated && verifiedUid) {
    return verifiedUid
  }

  if (isLegacyAuthEnabled(event)) {
    return String(getCookie(event, 'auth_user') || '').trim()
  }

  return ''
}
```

同时提供：

- `getCodocsConsoleAuth(event)`
- `isLegacyAuthEnabled(event)`
- `requireRequestUid(event, message?)`

替换策略：

- 第一天替换所有写操作、协作 token、文档读写核心 API。
- 第二天替换审阅、周报、资讯、文件柜、项目文档等剩余 API。
- 如果时间紧，低风险只读接口可先通过兼容 helper 间接 fallback，但不允许继续散落 `getCookie(event, 'auth_user')`。

### 6.5 服务端权限

新增或改造：

- `codocs/server/utils/platformBundleAuthorization.ts`
- `codocs/server/utils/checkPermission.ts`
- `codocs/server/api/auth/permissions.get.ts`

实现方式与 Aims 保持一致：

- `platformBundleAuthorization.ts` 读取 Foundation cached policy bundle。
- `checkPermission.ts` 优先 cached bundle，失败再用 Platform runtime authorization fallback。
- `/api/auth/permissions` 返回 Foundation 期望的 `{ code: 0, data: { uid, roles, resources } }`。
- bundle 缺失时默认 deny，开发环境可通过明确 env 放宽，但生产不放宽。

保留 Codocs 内部对象级权限：

- `documentAccess.ts`
- `departmentAccess.ts`
- `departmentShares.ts`
- folder/document owner/member/share 判断

外层 app permission 不替代这些对象级判断。

### 6.6 Account 目录代理

处理 `codocs/server/api/account/**`：

- 目录读取改用 Foundation `/api/directory/**` 或 server `directoryApi.ts`。
- 对旧前端调用路径可保留兼容 API，但内部应委托 Console Directory Runtime。
- 权限相关调用禁止再走 Account。
- `accountLookup.ts`、`accountPermissions.ts` 只允许 legacy auth/wecom fallback 使用。

建议优先替换：

- `department-members.get.ts`
- `departments.get.ts`
- `user-departments.get.ts`
- `users/[uid].get.ts`
- `users/batch.post.ts`
- `projects/**`

### 6.7 企业微信/CAS

Codocs 不再作为企业微信/CAS 协议终点。

- 默认入口：Console OIDC。
- CAS、企业微信、LDAP、钉钉等上游身份源由 Console 承接。
- `codocs/server/api/auth/wecom-*` 与 `codocs/server/api/wecom/oauth.get.ts` 仅在 legacy 模式可用。
- 迁移完成后页面不得主动跳 Codocs 本地企业微信登录。

### 6.8 Hocuspocus 协作

保留 Hocuspocus 独立 token 模型，但调整签发来源：

- `codocs/server/api/collaboration/token.get.ts` 使用 `getRequestUid(event)`。
- token payload 继续包含 `uid`、`documentUuid`、权限上下文。
- `codocs/hocuspocus/src/extensions/authentication.ts` 不需要理解 Console OIDC。
- Hocuspocus 服务只验证 Codocs 签发的 collaboration token。

这样可以避免把 Console OIDC/JWKS 直接扩散到协作服务。

### 6.9 Aims 嵌入 Codocs

Aims 通过 iframe 嵌入 Codocs，切换后要求：

- Aims 与 Codocs 都默认走 Console OIDC。
- 用户未登录 Codocs 时，Codocs iframe 内触发 OIDC login。
- Console session 已存在时应静默或快速完成回调，不应要求重复登录。
- Aims 后端代理 Codocs API 时，短期仍可用 `auth_user={uid}` cookie 兼容，但目标应切为 Console service token / app-to-app token。

两天目标：

- 保证 iframe 编辑打开、保存、协作 token 签发正常。
- Aims 到 Codocs 的后端桥接可保留兼容 cookie，但必须记录为后续服务凭证切换项。

## 7. 48 小时执行排期

### Day 0 准备，0.5 天内完成

负责人：控制面/运行时配置。

1. 在 Codocs repo 增加 `app.manifest.json`。
2. Platform 导入 Codocs manifest，创建 release，并发布。
3. 配置 `codocs:viewer/editor/publisher/admin` 系统角色权限。
4. 给测试租户订阅 Codocs，生成 Codocs deployment、runtime token、license。
5. 准备 Codocs `.env.dev` / `.env`：
   - `HZY_PLATFORM_URL`
   - `HZY_PLATFORM_TENANT_CODE`
   - `HZY_PLATFORM_DEPLOYMENT_CODE`
   - `HZY_PLATFORM_RUNTIME_TOKEN`
   - `HZY_PLATFORM_SIGNING_KID`
   - `HZY_PLATFORM_SIGNING_PUBKEY`
   - `HZY_PLATFORM_LICENSE_PATH`
   - `HZY_CONSOLE_URL`
   - `HZY_CONSOLE_API_URL`
   - `HZY_AUTH_MODE` 留空或非 `legacy`

完成标志：

- Platform 可看到 Codocs release/resources/roles。
- Codocs 启动时 Foundation platform activation 能拉取 bundle。

### Day 1 上午：认证切换

负责人：Codocs 前端/服务端入口。

1. 改造 `codocs/nuxt.config.ts` 到 Aims 同款 runtime config。
2. 删除或改造 `codocs/app/composables/useAuth.ts`。
3. 改造 `codocs/app/pages/login.vue`，默认跳 Console OIDC。
4. 新增 `codocs/server/utils/authIdentity.ts`。
5. 改造核心 API 的身份读取：
   - `/api/documents/index.get`
   - `/api/documents/index.post`
   - `/api/documents/[uuid]/index.get`
   - `/api/documents/[uuid]/index.put`
   - `/api/documents/[uuid]/index.patch`
   - `/api/documents/[uuid]/index.delete`
   - `/api/collaboration/token.get`
   - `/api/heartbeat.post`

完成标志：

- 新浏览器会话进入 Codocs 会走 Console OIDC。
- `/api/auth/me` 返回 Console auth context。
- 创建、打开、保存文档可拿到正确 uid。
- Hocuspocus token 可签发。

### Day 1 下午：权限切换

负责人：Codocs 权限与 Platform 授权。

1. 增加 `platformBundleAuthorization.ts`。
2. 改造 `checkPermission.ts`。
3. 改造 `/api/auth/permissions.get.ts`。
4. 删除或改造本地 `usePermissions.ts`。
5. 改造 `permission.global.ts` 为 Aims 同款 `useRouteAccess`。
6. 校准 `config/permissions.ts` 与 manifest resource code。
7. 改造管理、发布、归档相关权限调用：
   - `company-assets/*.post`
   - `dept-assets/*.post`
   - `admin/**`
   - `reviews/**` 中涉及审批/归档/盖章的接口

完成标志：

- 无 `HZY_ACCOUNT_API_*` 时，菜单和路由权限仍可由 bundle 正常判断。
- 没有授权 `admin` 的用户看不到/进不去后台。
- 有 `codocs:admin` 的用户可进入后台。
- 文档对象级权限仍独立生效。

### Day 2 上午：目录与业务 API 收口

负责人：Codocs 业务接口。

1. 将 `/api/account/**` 内部改为 Console Directory adapter。
2. 扫描并替换剩余 `getCookie(event, 'auth_user')`：
   - reviews
   - weekly reports
   - info
   - cabinet
   - project-docs
   - issues
   - AI/upload/OSS
3. 保留 `getCookie(event, 'token')` 仅作为旧审计 sessionId 字段，不能作为认证依据。
4. 确认 `useAccount` / `useDirectory` 前端调用可从 Foundation 目录代理取数。

完成标志：

- `rg "getCookie\\(event, 'auth_user'" codocs/server` 只剩 legacy-only 文件，或全部通过 `authIdentity.ts`。
- Codocs 不配置 Account API 时，核心页面目录信息仍能展示。

### Day 2 下午：联调、验收、切换

负责人：全链路验证。

1. 启动 Console、Platform、Codocs、Aims。
2. 验证 Console 应用入口能展示 Codocs。
3. 从 Console 跳转 Codocs，完成 OIDC。
4. 验证 Codocs：
   - 文档列表
   - 新建文档
   - 编辑保存
   - 协作连接
   - 分享/只读
   - 部门/项目/组织资产文档
   - 审阅/发布/归档
   - 后台管理
5. 验证 Aims iframe 嵌入 Codocs：
   - 打开项目文档
   - 编辑保存
   - iframe 内无重复登录死循环
6. 关闭 `HZY_ACCOUNT_API_*` 做一次 smoke test。
7. legacy fallback 演练：
   - 设置 `HZY_AUTH_MODE=legacy`。
   - 确认旧 cookie 登录仍可应急使用。

完成标志：

- 默认模式无需 Account 权限 API。
- Codocs 可从 Console OIDC 登录进入。
- Platform 授权变更后刷新 bundle 能影响 Codocs 菜单/路由/服务端权限。
- 关键文档操作无回归。

## 8. 验收标准

### 8.1 架构验收

- Codocs manifest 已在 Platform 发布。
- Codocs deployment 已有 runtime token、license、policy bundle。
- Codocs 启动日志出现 Foundation platform activation 成功记录。
- Codocs 默认认证来自 Console OIDC。
- 服务端 API 可读取 `event.context.consoleAuth.uid`。
- `HZY_AUTH_MODE=legacy` 未开启时，Codocs 不依赖 `auth_user` cookie 完成主链路认证。

### 8.2 权限验收

- `codocs:viewer` 可进入文档中心但不能进入后台。
- `codocs:editor` 可创建/编辑自己有对象权限的文档。
- `codocs:publisher` 可执行发布/审阅相关动作。
- `codocs:admin` 可进入后台和管理入口。
- 未授权用户无法从菜单、路由、服务端 API 绕过进入管理能力。
- 具体文档 ACL 不因平台授权而放大权限。

### 8.3 业务验收

- 我的文档：列表、新建、编辑、删除、恢复。
- 共享文档：授权用户可读写，未授权用户不可读。
- 项目文档：Aims iframe 可打开，Codocs 项目文档列表可用。
- 部门文档：部门成员可访问，非成员按原规则拒绝。
- 组织资产：发布、归档、导出链路可用。
- 审阅中心：提交、审批、驳回、归档可用。
- 协作：两浏览器同时编辑同一文档，Hocuspocus 正常同步。

### 8.4 运行验收

- 无 Account API 配置时，默认新链路可启动并完成 smoke test。
- Console 不可用但已有有效本地 session/bundle 时，按 Foundation 设计可维持有限运行。
- bundle 缺失或过期时，生产环境拒绝授权，不静默放行。
- 日志能区分 Console OIDC、legacy fallback、bundle missing、permission denied。

## 9. 回滚策略

只允许配置回滚，不做代码回滚作为第一选择。

### 9.1 快速回滚

设置：

```bash
HZY_AUTH_MODE=legacy
HZY_LEGACY_AUTH_BRIDGE=true
```

效果：

- Foundation `useAuth` 回到 legacy bridge。
- `getRequestUid()` 允许读取 `auth_user` cookie。
- 本地 CAS/企业微信 legacy 入口可恢复。

### 9.2 权限回滚

不建议回滚到 Account 权限 API。若 policy bundle 异常，应优先：

1. 在 Platform 修正 Codocs 角色/权限。
2. 重新发布 bundle。
3. Codocs 手动触发 `/api/platform-activation/retry`。
4. 确认 `.data/platform-runtime` 中 bundle 已更新。

### 9.3 协作回滚

Hocuspocus 不直接接入 OIDC，因此协作层回滚风险低。若协作异常，优先检查：

- `collaboration/token.get.ts` 是否能取到 uid。
- collaboration token secret 是否一致。
- 文档对象权限是否误拒绝。

## 10. 风险与处理

| 风险 | 影响 | 处理 |
| ---- | ---- | ---- |
| Codocs 本地 composable 覆盖 Foundation | 前端仍走旧 cookie/Account | 删除或改为 thin wrapper |
| 大量 API 直接读 `auth_user` | 新 OIDC 下服务端拿不到身份 | 统一 `authIdentity.ts`，分批替换 |
| Platform 权限覆盖文档 ACL | 可能越权读具体文档 | 坚持 `PlatformAppPermission && CodocsObjectPermission` |
| bundle 缺失时错误放行 | 权限失控 | 生产默认 deny |
| iframe 内 OIDC 跳转循环 | Aims 项目文档不可用 | 校验 Console session、callbackUrl、sameSite/cookie domain |
| 本地企业微信登录仍被页面使用 | 绕过 Console auth-runtime | 默认入口下线，legacy-only |
| `/api/account/**` 仍代理 Account | 目录迁移不彻底 | 改为 Console Directory adapter |

## 11. 后续治理项

两天切换完成后，再进入第二阶段治理：

- 将 Aims 调 Codocs 后端桥接从 `auth_user` cookie 切为 Console service token。
- 将 Codocs 资讯、模板、发布流程细化成更完整 manifest resources。
- 将文档空间成员、参与者、owner 等对象关系抽象成可选 scope，但不强行迁入 Platform。
- 清理 legacy CAS/WeCom 本地回调。
- 删除 Account 权限 API 类型与工具。
- 更新 `docs/MODULE_CONTRACTS.md` 中 Codocs 对 Account 的依赖状态。

## 12. 最终判断

Codocs 两天内完全切换是可行的，但前提是目标必须收窄：

- 完全切换认证、应用入口、路由权限、服务端通用权限到新架构。
- 不迁移文档对象级 ACL。
- 不重构协作服务。
- 不继续保留 Account 权限 API 作为默认链路。

这条路径与 Aims 当前实现一致，风险集中在 Codocs 本地覆盖 Foundation 能力与散落的 `auth_user` 读取。只要先完成统一身份 helper、bundle-first 权限 helper、manifest 发布和 OIDC 登录切换，剩余业务接口可以在第二天按风险分层收口。
