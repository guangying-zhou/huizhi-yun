# 统一域名部署改造方案

状态：Draft  
日期：2026-05-03  
适用范围：Platform / Console / Foundation / Aims / Codocs / 后续企业端业务应用

## 1. 背景与结论

当前企业端应用更接近“一个应用一个域名/子域名”的部署模式：

- `console.wiztek.cn`
- `aims.wiztek.cn`
- `codocs.wiztek.cn`

目标改为“一个企业端部署一个域名，应用挂载在 URL path 下”：

- `https://hzy.wiztek.cn/`
- `https://hzy.wiztek.cn/admin/`
- `https://hzy.wiztek.cn/aims/`
- `https://hzy.wiztek.cn/codocs/`

本项目后续不保留多域名兼容能力。统一域名是企业端唯一正式部署模型。

核心设计：

- Platform 统一维护企业端部署站点 URL，例如 `https://hzy.wiztek.cn`。
- `appCode` 继续作为应用身份，来自 `license.lic` / manifest / Platform 应用台账。
- 应用 `basePath` 默认由 `appCode` 自动生成：`/${appCode}/`。
- Platform 可在控制台配置路由覆盖，例如把 `console` 挂到 `/admin/`，或指定某个应用为根应用 `/`。
- 租户部署时不能修改路由策略。
- 不支持同一租户同一应用多实例部署。

## 2. 目标模型

### 2.1 身份与 URL 解耦

`appCode` 是稳定身份，不等于最终访问路径。

```text
appCode = console
basePath = /admin/
homeUrl = https://hzy.wiztek.cn/admin/

appCode = aims
basePath = /aims/
homeUrl = https://hzy.wiztek.cn/aims/
```

API 命名继续跟随 `appCode`，不跟随前端路由别名：

```text
/api/v1/console/**
/api/v1/aims/**
/api/v1/codocs/**
```

即使 Console 前端挂在 `/admin/`，API 仍然是 `/api/v1/console/**`。

### 2.2 部署站点

新增部署站点概念，表示一个租户企业端 Workload Plane 的统一入口。

建议模型：

```json
{
  "tenantCode": "C000001",
  "siteCode": "C000001-main",
  "publicUrl": "https://hzy.wiztek.cn",
  "rootAppCode": "portal",
  "status": "active"
}
```

当前系统已有 per-app `deployments`。后续保留它作为“应用运行实例”，但完整 URL 不再由每个 deployment 单独手填。

关系：

```text
deployment_site 1 -- n deployments
tenant + appCode 唯一 deployment
```

### 2.3 路由投影

应用路由由 Platform 控制台维护在 `deployments` 的路由字段中，并投影到已签名 bundle。

```json
{
  "deployment": {
    "publicUrl": "https://hzy.wiztek.cn",
    "rootAppCode": "portal"
  },
  "routes": [
    {
      "appCode": "portal",
      "basePath": "/",
      "homeUrl": "https://hzy.wiztek.cn/",
      "apiBase": "/api/v1/portal"
    },
    {
      "appCode": "console",
      "basePath": "/admin/",
      "homeUrl": "https://hzy.wiztek.cn/admin/",
      "apiBase": "/api/v1/console"
    },
    {
      "appCode": "aims",
      "basePath": "/aims/",
      "homeUrl": "https://hzy.wiztek.cn/aims/",
      "apiBase": "/api/v1/aims"
    },
    {
      "appCode": "codocs",
      "basePath": "/codocs/",
      "homeUrl": "https://hzy.wiztek.cn/codocs/",
      "apiBase": "/api/v1/codocs"
    }
  ]
}
```

生成规则：

```ts
basePath = platformRouteOverride[appCode] || `/${appCode}/`
homeUrl = new URL(basePath, deployment.publicUrl).toString()
callbackUrl = new URL('api/auth/oidc-callback', homeUrl).toString()
logoutUrl = new URL('api/auth/logout', homeUrl).toString()
```

根应用规则：

- 每个部署站点最多一个 `basePath = '/'`。
- 若指定 `rootAppCode`，该应用 `basePath` 必须为 `/`。
- 其他应用不得使用 `/`。
- `basePath` 必须唯一。
- `basePath` 必须以 `/` 开头，并且除 `/` 外必须以 `/` 结尾。
- 不允许 `..`、双斜杠、URL 编码绕过、空白字符。

## 3. 配置职责边界

### 3.1 Manifest

Manifest 仍然只声明应用能力边界，不承载客户环境地址。

保留：

```json
{
  "appCode": "aims",
  "entry": {
    "web": "/",
    "apiBase": "/api/v1/aims"
  }
}
```

说明：

- `entry.web` 是源码默认入口，不是租户最终访问 URL。
- `entry.apiBase` 是应用 API 逻辑根路径，建议全部按 `/api/v1/{appCode}` 收敛。
- Manifest 不声明 `hzy.wiztek.cn`、`/admin/` 这类部署路由。

### 3.2 License

`license.lic` 继续作为本应用启动身份和授权文件。

应用从 license 中读取：

- `payload.appCode`
- `payload.tenantCode`
- `payload.deploymentCode`
- `bootstrap.consoleUrl` 或后续 replacement 字段

`appCode` 可用于生成默认 `basePath`。但当 Platform 指定根应用或路由覆盖时，仅靠 `appCode` 不够，因此 Platform 生成的部署环境文件必须包含最终 `basePath`。

建议新增或规范化生成字段：

```bash
HZY_DEPLOYMENT_PUBLIC_URL=https://hzy.wiztek.cn
HZY_APP_BASE_PATH=/admin/
NUXT_APP_BASE_URL=/admin/
```

其中：

- `HZY_APP_BASE_PATH` 是汇智云运行时语义。
- `NUXT_APP_BASE_URL` 是 Nuxt 运行所需配置。
- 二者由 Platform 生成，不由租户手工改。

默认生成逻辑：

```ts
const appCode = license.payload.appCode
const basePath = env.HZY_APP_BASE_PATH || `/${appCode}/`
```

### 3.3 Policy Bundle

Bundle 是运行时路由事实源，需要新增部署站点与路由投影。

建议扩展：

```json
{
  "deployment": {
    "tenantCode": "C000001",
    "siteCode": "C000001-main",
    "publicUrl": "https://hzy.wiztek.cn",
    "rootAppCode": "portal"
  },
  "applications": [
    {
      "appCode": "console",
      "appName": "汇智云控制台",
      "basePath": "/admin/",
      "homeUrl": "https://hzy.wiztek.cn/admin/",
      "apiBase": "/api/v1/console",
      "callbackUrl": "https://hzy.wiztek.cn/admin/api/auth/oidc-callback",
      "logoutUrl": "https://hzy.wiztek.cn/admin/api/auth/logout",
      "status": "active"
    }
  ]
}
```

现有 `applications.homeUrl/callbackUrl` 继续保留，但其生成来源改为：

```text
deployment_sites.public_url + deployments.base_path
```

不再使用 per-app `deployments.runtime_endpoint` 作为常规配置口径。

## 4. Platform 改造

### 4.1 数据模型

统一域名部署需要把“租户企业端站点”和“应用运行实例”拆开建模，不再新增独立 `deployment_routes` 表。

现有 `deployments` 表继续表示：

```text
某租户 × 某应用 的运行实例，并承载该应用在统一站点下的路由属性
```

新增 `deployment_sites` 表表示：

```text
某租户企业端 Workload Plane 的统一访问入口
```

关系图：

```text
tenants
  1 └─ n active deployment_sites (按 environment 区分)
          1 └─ n deployments

deployments
  n └─ 1 platform_applications
  n └─ 1 subscriptions
```

#### 4.1.1 `deployment_sites`

`deployment_sites` 是租户企业端站点级配置。`public_url` 只在这里维护，不再分散到每个 app deployment。

建议 DDL：

```sql
CREATE TABLE deployment_sites (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_code VARCHAR(64) NOT NULL,
  site_code VARCHAR(128) NOT NULL,
  site_name VARCHAR(255) NOT NULL,
  public_url VARCHAR(512) NOT NULL,
  root_app_code VARCHAR(64) DEFAULT NULL,
  environment VARCHAR(32) NOT NULL DEFAULT 'prod',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  active_tenant_environment_key VARCHAR(160)
    GENERATED ALWAYS AS (
      CASE WHEN status = 'active' THEN CONCAT(tenant_code, ':', environment) ELSE NULL END
    ) STORED,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  created_by_account_id BIGINT DEFAULT NULL,
  updated_by_account_id BIGINT DEFAULT NULL,
  UNIQUE KEY uk_deployment_sites_site_code (site_code),
  UNIQUE KEY uk_deployment_sites_tenant_site (tenant_code, site_code),
  UNIQUE KEY uk_deployment_sites_active_tenant_env (active_tenant_environment_key),
  KEY idx_deployment_sites_tenant_env_status (tenant_code, environment, status)
);
```

字段说明：

| 字段 | 说明 |
|---|---|
| `tenant_code` | 租户编码 |
| `site_code` | 站点编码，建议默认 `${tenantCode}-main` |
| `site_name` | 站点显示名，例如“C000001 企业端” |
| `public_url` | 企业端统一外部访问地址，例如 `https://hzy.wiztek.cn`，不带末尾 `/` 存储 |
| `root_app_code` | 根应用 appCode，可为空；非空时该应用 deployment 必须有 `base_path='/'` |
| `environment` | 部署环境，例如 `prod`、`test` |
| `status` | `active / inactive / archived` |
| `active_tenant_environment_key` | MySQL 生成列，用唯一键保证每个租户每个环境最多一个 active site；多个 inactive 记录生成 `NULL`，不会互相冲突 |

约束：

- `public_url` 必须是绝对 `http` 或 `https` URL。
- 生产环境要求 `https`。
- `public_url` 存储时去掉末尾 `/`。
- 同一租户每个 `environment` 最多一个 `active` site。
- `root_app_code` 只能指向该租户已订阅且有 active deployment 的应用。

#### 4.1.2 `deployments` 路由字段

在当前产品约束下，路由就是 deployment 的部署属性：

- 不允许同一环境内多实例部署。
- 同一租户、同一 `appCode`、同一 `environment` 只有一个 active deployment。
- 一个应用只挂一个 `basePath`。
- 不支持一个应用多个 URL alias。

因此直接扩展现有 `deployments` 表即可：

```sql
ALTER TABLE deployments
  ADD COLUMN site_id BIGINT NULL,
  ADD COLUMN base_path VARCHAR(255) NULL,
  ADD COLUMN api_base VARCHAR(255) NULL,
  ADD COLUMN route_source VARCHAR(32) NOT NULL DEFAULT 'default',
  ADD COLUMN active_site_path_key VARCHAR(255)
    GENERATED ALWAYS AS (
      CASE
        WHEN status = 'active' AND site_id IS NOT NULL AND base_path IS NOT NULL
        THEN CONCAT(site_id, ':', base_path)
        ELSE NULL
      END
    ) STORED,
  ADD KEY idx_deployments_site_status (site_id, status),
  ADD UNIQUE KEY uk_deployments_active_site_path (active_site_path_key),
  ADD CONSTRAINT fk_deployments_site
    FOREIGN KEY (site_id) REFERENCES deployment_sites (id);
```

如果实施时不便用 `ALTER TABLE ... ADD COLUMN generated` 一次完成，可拆成迁移脚本分步执行。

字段说明：

| 字段 | 说明 |
|---|---|
| `site_id` | 所属企业端站点；active 企业端 deployment 必须有值 |
| `base_path` | 前端挂载路径，例如 `/admin/`、`/aims/`、`/` |
| `api_base` | 对外 API base，默认 `/api/v1/{appCode}` |
| `route_source` | `default / platform_override / root_app` |
| `active_site_path_key` | MySQL 生成列，用于保证同一 active site 内 `base_path` 唯一 |

保留现有 active deployment 唯一约束：

```text
tenant_code + app_code + active_unique_key
```

它继续保证：

```text
同一租户 + 同一 appCode + 同一 environment 最多一个 active deployment
```

新增 `active_site_path_key` 保证：

```text
同一 active site 内，一个 base_path 最多对应一个 active deployment
```

#### 4.1.3 `deployments` 字段职责

`deployments` 继续表示租户应用运行实例，同时承载该实例在所属站点下的唯一挂载路径。

保留：

- `deployment_code`
- `tenant_code`
- `app_code`
- `subscription_id`
- `deployment_mode`
- `environment`
- `region`
- `status`
- `license_status`
- `connectivity_status`
- `version_status`
- heartbeat / reported version / signing key 摘要字段
- `site_id`
- `base_path`
- `api_base`
- `route_source`

新增路由字段后，`deployments` 的职责变成：

```text
应用运行实例 + 在所属 deployment_site 下的唯一挂载路径
```

弱化或废弃：

- `runtime_endpoint`
- `callback_url`

处理方式：

- 第一阶段可保留字段，避免一次性大迁移。
- Platform bundle 生成不再读取它们作为常规来源。
- UI 中不再把它们作为可编辑主入口。
- 迁移完成后可标记 deprecated，后续 DDL 再删除。

#### 4.1.4 路由约束

路由字段必须满足：

- active 企业端 deployment 必须绑定一个 active `deployment_sites.id`。
- active deployment 的 `base_path` 必须非空。
- 同一 active site 内，一个 `base_path` 最多对应一个 active deployment。
- 一个 active site 最多一条 `base_path='/'` 的 active deployment。
- `base_path='/'` 的 deployment 必须匹配 `deployment_sites.root_app_code`。
- 非根 `base_path` 必须形如 `/{segment}/`，例如 `/aims/`。
- `base_path` 禁止包含空白、`..`、`//`、URL scheme、query、hash。
- `api_base` 必须形如 `/api/v1/{appCode}`，除非 Platform 明确允许兼容路径。

`route_source` 语义：

| 值 | 说明 |
|---|---|
| `default` | 由 `appCode` 自动生成，例如 `/aims/` |
| `platform_override` | Platform 运维显式覆盖，例如 `console -> /admin/` |
| `root_app` | Platform 指定根应用，`base_path='/'` |

#### 4.1.5 生成 homeUrl / callbackUrl

生成 bundle 时不再使用：

```text
COALESCE(deployments.runtime_endpoint, platform_applications.home_url)
```

改为：

```text
homeUrl = deployment_sites.public_url + deployments.base_path
callbackUrl = homeUrl + 'api/auth/oidc-callback'
logoutUrl = homeUrl + 'api/auth/logout'
apiBase = deployments.api_base
```

查询来源：

```sql
SELECT
  pa.app_code,
  pa.app_name,
  pa.description,
  pa.icon,
  ds.public_url,
  ds.root_app_code,
  d.base_path,
  d.api_base,
  d.deployment_code,
  d.status AS deployment_status
FROM deployments d
JOIN deployment_sites ds ON ds.id = d.site_id
JOIN platform_applications pa ON pa.app_code = d.app_code
WHERE ds.tenant_code = ?
  AND ds.status = 'active'
  AND d.status = 'active';
```

#### 4.1.6 路由默认生成

新增订阅或 deployment 时，如果 active site 已存在，Platform 自动填充路由字段：

```ts
function defaultBasePath(appCode: string) {
  return `/${appCode}/`
}

function defaultApiBase(appCode: string) {
  return `/api/v1/${appCode}`
}
```

如果 Platform 控制台指定：

```text
rootAppCode = portal
console -> /admin/
```

则 deployment 字段变为：

```text
portal.base_path = /
portal.route_source = root_app

console.base_path = /admin/
console.route_source = platform_override

aims.base_path = /aims/
aims.route_source = default

codocs.base_path = /codocs/
codocs.route_source = default
```

#### 4.1.7 迁移策略

从现有模型迁移：

1. 为每个已有 tenant 创建一个 `deployment_sites`。
2. `public_url` 从运维输入，不从现有 `runtime_endpoint` 自动推断，避免把旧多域名带入新模型。
3. 为每个 active deployment 设置 `site_id`。
4. 默认填充 `base_path = /{appCode}/`。
5. 默认填充 `api_base = /api/v1/{appCode}`。
6. 若当前决定 Console 是根应用，则把 `console.base_path` 改成 `/`，`route_source='root_app'`，`root_app_code='console'`。
7. 若当前决定新增 Portal 为根应用，则把 `console.base_path` 改成 `/admin/`，`route_source='platform_override'`，`root_app_code='portal'`。
8. 重新生成 policy bundle。
9. Onboarding/env 产物改为从 `deployments.base_path` 生成 `HZY_APP_BASE_PATH` 和 `NUXT_APP_BASE_URL`。

不做自动迁移：

- 不把 `console.wiztek.cn`、`aims.wiztek.cn` 之类旧域名转换为 `base_path`。
- 不继续生成多域名访问入口。
- 不支持租户部署时覆盖 `base_path`。

#### 4.1.8 删除与变更规则

路由变更是运行时契约变更，必须受控：

- 修改 `public_url`、`root_app_code`、`base_path` 后必须重新生成 bundle。
- 修改后应提示需要重启或重新部署相关 Nuxt 应用，因为 `NUXT_APP_BASE_URL` 需要启动前确定。
- 停用 deployment 时，其 `base_path` 不再占用 active path 唯一约束。
- 已产生的通知/审批历史链接不会自动改写；正式上线前应避免频繁变更 basePath。

#### 4.1.9 为什么不保留独立 `deployment_routes`

当前约束下，不需要独立 route 表：

- 不支持多实例部署。
- 不支持一个 app 多个 URL alias。
- route 生命周期不独立于 deployment。
- route 不需要单独灰度、蓝绿或版本化。
- `deployments` 已经有 active 唯一约束，天然承载“一个租户一个应用一个环境一个运行实例”。

只有未来出现以下需求时，才建议重新拆出 `deployment_routes`：

- 一个 app 同时暴露多个路径。
- 同一 app 支持蓝绿/灰度实例。
- route 需要独立发布、回滚或版本化。
- gateway 配置需要维护独立路由生命周期。

### 4.2 控制台能力

租户 Dashboard 新增“企业信息 / 企业端部署站点”维护能力，由租户 owner 维护：

- `publicUrl`，即各应用运行时使用的 `HZY_DEPLOYMENT_PUBLIC_URL`

Platform Ops 控制台继续治理路由与部署结构：

- `rootAppCode`
- 应用路由覆盖列表
- 路由冲突校验
- 重新生成 bundle
- 生成 Nginx / Gateway 路由配置预览

租户部署侧不能修改 `basePath/apiBase/rootAppCode`，也不允许创建同一应用的多实例部署。

### 4.3 部署环境输出

Admin 侧 Onboarding 废弃。部署环境和 bundle 不再输出 per-app 完整访问 URL，而是输出：

- 站点 URL：`HZY_DEPLOYMENT_PUBLIC_URL`
- 每个应用自己的 `HZY_APP_BASE_PATH`
- 每个应用自己的 `NUXT_APP_BASE_URL`
- license
- runtime token

例如 Console 被 Platform 配到 `/admin/`：

```bash
HZY_PLATFORM_TENANT_CODE=C000001
HZY_PLATFORM_DEPLOYMENT_CODE=C000001-console
HZY_DEPLOYMENT_PUBLIC_URL=https://hzy.wiztek.cn
HZY_APP_BASE_PATH=/admin/
NUXT_APP_BASE_URL=/admin/
```

## 5. Foundation 改造

### 5.1 URL 工具

Foundation 增加统一工具：

- `getConfiguredAppBasePath()`
- `buildAppHomeUrl(publicUrl, basePath)`
- `resolveCurrentAppHomeUrl()`
- `resolveCurrentAppUrl(path?)`
- `deriveOidcCallbackUrl()` / `deriveCasCallbackUrl()` / `deriveWecomCallbackUrl()`

使用优先级：

```text
已验签 bundle applications[].basePath/homeUrl
> HZY_APP_BASE_PATH / NUXT_APP_BASE_URL
> license.payload.appCode 默认 /{appCode}/
```

当前阶段服务端 URL 派生优先使用 `HZY_DEPLOYMENT_PUBLIC_URL + HZY_APP_BASE_PATH`，没有统一部署配置时才退回显式 `appHomeUrl/serviceUrl` 或 request origin。

### 5.2 前端跳转

前端不再直接拼：

```ts
window.location.origin + '/projects/1'
```

改为：

```ts
buildCurrentAppUrl('/projects/1')
```

内部路由跳转可继续使用 `router.push('/projects')`，但必须确认 Nuxt `app.baseURL` 已正确设置。

### 5.3 认证回调

OIDC/CAS/企业微信登录相关 URL 必须全部基于当前应用 `homeUrl` 派生：

```text
{homeUrl}/api/auth/oidc-callback
{homeUrl}/api/auth/cas-callback
{homeUrl}/api/auth/wecom-callback
```

禁止继续用：

```text
{origin}/api/auth/...
```

因为统一域名下不同应用共享 `origin`。

### 5.4 Cookie

统一域名下 Cookie 简化为同站点 Cookie。

要求：

- Cookie `path` 默认继续用 `/`，用于 SSO 共享。
- OIDC token cookie 继续按 `appCode` 分名，例如 `hzy_aims_access_token`。
- Legacy cookie 如 `token`、`auth_user` 后续应逐步减少依赖，避免多个应用覆盖。
- 不再依赖跨子域 cookie domain 推导作为核心能力。

## 6. 应用改造

### 6.1 Nuxt baseURL

所有 Nuxt 应用增加：

```ts
export default defineNuxtConfig({
  app: {
    baseURL: process.env.NUXT_APP_BASE_URL || '/'
  }
})
```

Platform 生成的 env 必须在应用启动前提供 `NUXT_APP_BASE_URL`。

原因：

- 静态资源路径依赖 baseURL。
- 前端 router 依赖 baseURL。
- Nitro API 相对路径需要和反向代理路径一致。
- 登录回调路径必须在首次请求时就正确。

### 6.2 业务链接修正

重点扫描并修正：

- `window.location.origin + '/xxx'`
- `` `${window.location.origin}/xxx` ``
- 硬编码 `https://codocs.wiztek.cn`
- 硬编码 `/api/auth/...` 外部跳转
- 通知、审批、Workflow `biz_url`
- 应用卡片 `homeUrl`

目标：

- 应用内链接使用当前应用 base。
- 跨应用链接使用 bundle 中目标应用 `homeUrl`。
- API 调用使用相对路径或稳定 API gateway 路径。

### 6.3 API 路径收敛

正式目标：

```text
/api/v1/console/**
/api/v1/aims/**
/api/v1/codocs/**
```

当前现状：

- Console 已基本使用 `/api/v1/console/**`。
- Aims manifest 声明 `/api/v1/aims`，但代码中仍大量使用 `/api/v1/projects`、`/api/v1/work-items` 等。
- Codocs manifest 声明 `/api/v1/codocs`，但代码中仍有大量 `/api/**` 旧路径。

实施策略：

1. 先让每个应用在自身 basePath 下正常工作，即 `/aims/api/v1/projects` 经网关转发到 Aims。
2. 再逐步把公开跨应用 API 收敛为 `/api/v1/{appCode}/**`。
3. 内部页面调用可短期保留相对 `/api/**`，但跨应用服务端调用必须使用 appCode API base。

## 7. Gateway / Nginx 改造

统一域名下建议网关规则由 Platform 的部署站点与 `deployments.base_path` 生成或校验。

示例：

```nginx
server {
    listen 443 ssl;
    server_name hzy.wiztek.cn;

    location /admin/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Prefix /admin;
    }

    location /aims/ {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Prefix /aims;
    }

    location /codocs/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Prefix /codocs;
    }
}
```

注意：当应用以 `NUXT_APP_BASE_URL=/aims/` 这类子路径启动时，`proxy_pass` 必须不带尾部 `/`，以保留 `/aims/` 前缀传给 Nuxt。只有应用仍以 `/` 启动时，才使用带尾部 `/` 的 `proxy_pass` 剥离前缀。

根应用 `/` 必须放在最后，避免吞掉其它应用路径。

WebSocket：

- Codocs/Collab Runtime 若挂在统一域名下，默认路由为 `/codocs/ws`，由 Platform 站点路由策略统一生成。
- `NUXT_PUBLIC_COLLABORATION_URL` 可显式覆盖；未设置时 Codocs 按 `HZY_DEPLOYMENT_PUBLIC_URL + HZY_APP_BASE_PATH + /ws` 自动生成，例如 `wss://hzy.wiztek.cn/codocs/ws`。
- 参考模板：[etc/hzy-unified-domain.conf](../etc/hzy-unified-domain.conf)。

本地开发可使用 Caddy 作为统一入口，避免污染 rootApp：

- 本地入口：`http://localhost:3080`
- Caddy 配置：[etc/Caddyfile.local](../etc/Caddyfile.local)
- 启动命令：`caddy run --config etc/Caddyfile.local`
- 应用仍分别运行在自身端口：Console `3000`、Aims `3002`、Codocs `3001`。
- 应用启动时分别设置：
  - Console: `HZY_DEPLOYMENT_PUBLIC_URL=http://localhost:3080 HZY_APP_BASE_PATH=/admin/ NUXT_APP_BASE_URL=/admin/`
  - Aims: `HZY_PLATFORM_ACTIVATION_ENABLED=false HZY_DEPLOYMENT_PUBLIC_URL=http://localhost:3080 HZY_APP_BASE_PATH=/aims/ NUXT_APP_BASE_URL=/aims/ HZY_CONSOLE_URL=http://localhost:3080/admin HZY_CONSOLE_API_URL=http://localhost:3080/admin`
  - Codocs: `HZY_PLATFORM_ACTIVATION_ENABLED=false HZY_DEPLOYMENT_PUBLIC_URL=http://localhost:3080 HZY_APP_BASE_PATH=/codocs/ NUXT_APP_BASE_URL=/codocs/ HZY_CONSOLE_URL=http://localhost:3080/admin HZY_CONSOLE_API_URL=http://localhost:3080/admin`
- 若要测试完整 Platform activation，则不能禁用 `HZY_PLATFORM_ACTIVATION_ENABLED`，必须改用 Platform 生成的完整 env，包括 `HZY_PLATFORM_URL`、`HZY_PLATFORM_TENANT_CODE`、`HZY_PLATFORM_DEPLOYMENT_CODE`、`HZY_PLATFORM_RUNTIME_TOKEN`、`HZY_PLATFORM_SIGNING_KID`、`HZY_PLATFORM_SIGNING_PUBKEY`。

## 8. 实施阶段

### 阶段 1：契约与数据模型

- 新增 `deployment_sites`，并扩展 `deployments` 路由字段。
- Dashboard 企业信息支持租户 owner 维护 `publicUrl`（即 `HZY_DEPLOYMENT_PUBLIC_URL`）；Platform 运营侧只维护 `rootAppCode` 与 route override。
- Policy bundle 增加 `deployment.publicUrl`、`applications[].basePath/apiBase/homeUrl/callbackUrl/logoutUrl`。
- Onboarding env 输出 `HZY_DEPLOYMENT_PUBLIC_URL`、`HZY_APP_BASE_PATH`、`NUXT_APP_BASE_URL`。

### 阶段 2：Foundation 路由能力（已实施）

- 增加统一 URL helper。
- OIDC/CAS/企业微信回调全部改为基于当前应用 `homeUrl`。
- `/api/user/applications` 使用 bundle route 投影生成应用入口。
- Cookie 策略保留 SSO 共享，但优先使用按 appCode 分名的 OIDC cookie。

### 阶段 3：应用可挂载到子路径（已实施）

- Console、Aims、Codocs 添加 `app.baseURL`。
- 修正硬编码 origin/path。
- 通知链接、审批链接、Workflow `biz_url` 改为 Foundation helper。
- 本地分别验证：
  - `/admin/`
  - `/aims/`
  - `/codocs/`

### 阶段 4：网关与端到端联调（已实施配置模板）

- 使用统一域名网关配置。
- 验证静态资源路径：`/admin/_nuxt/**`、`/aims/_nuxt/**`、`/codocs/_nuxt/**`。
- 验证登录、刷新、登出、跨应用跳转。
- 验证通知链接和审批业务链接。
- 验证 Collab Runtime WebSocket。

### 阶段 5：API 收敛（已实施）

- Aims 对外 API 增加 `/api/v1/aims/**` 入口。
- Codocs 对外 API 增加 `/api/v1/codocs/**` 入口。
- 跨应用服务端调用统一使用 bundle 中 `apiBase`。
- 清理不再需要的 per-app `runtime_endpoint/callback_url` 配置入口。

实施说明：

- Aims 的 `/api/v1/aims/**` 是兼容别名，转发到现有 `/api/v1/**` 实现。
- Codocs 的 `/api/v1/codocs/**` 是兼容别名，优先覆盖新 `/api/v1/documents/**` 能力，其他路径转发到旧 `/api/**` 实现。
- Aims 服务端 Codocs client 已优先读取本地已验签 bundle 中 Codocs 的 `homeUrl/apiBase`，调用路径形如 `{codocs.homeUrl}{codocs.apiBase}/documents/...`。
- `runtime_endpoint/callback_url` 字段暂仅保留为 schema 兼容和应用默认值 fallback，不再作为统一域名部署的常规配置口径。

## 9. 验收标准

部署配置：

- 租户 owner 在 Dashboard 按环境维护 `publicUrl`、Platform URL 和登录参数。
- 每个 app 的最终 URL 可由 `publicUrl + basePath` 自动生成。
- 租户部署侧不能覆盖 app route；`basePath/apiBase/rootAppCode` 仍由 Platform 运营侧治理。
- 同一租户同一 app 同一环境不能创建多个 active deployment；生产和测试环境可以并存。

应用访问：

- `/admin/`、`/aims/`、`/codocs/` 页面均可直接刷新。
- 所有静态资源从对应 basePath 加载。
- 根应用 `/` 不影响其它应用路径。

认证：

- 未登录访问任一应用会跳转到正确登录流程。
- 回调地址包含应用 basePath。
- 登录后跨应用跳转无需重复登录。
- 登出行为符合 Console auth-runtime 设计。

运行时：

- 应用卡片入口来自已验签 bundle。
- 通知、审批、Workflow 链接包含正确 basePath。
- Heartbeat、bundle 拉取、license 校验不依赖 per-app 域名。

安全：

- Bundle 签名覆盖 route 投影。
- 客户侧不能通过修改 env 改变 Platform 认可的应用入口；env 只用于应用启动，运行期展示与跳转以已验签 bundle 为准。
- 路由配置变更必须重新生成 bundle。

## 10. 风险与处理

### 10.1 Nuxt baseURL 需要启动前确定

风险：应用不能等启动后远程拉 bundle 再决定 baseURL。

处理：

- Platform onboarding 为每个 app 生成 `NUXT_APP_BASE_URL`。
- 默认 path 可由 license `appCode` 推导。
- root app 或 `/admin/` 这类覆盖必须随 env 一起下发。

### 10.2 旧代码硬编码 origin

风险：统一域名下 `window.location.origin` 只能得到站点根，无法区分当前应用。

处理：

- Foundation 提供 URL helper。
- 全仓扫描并替换业务链接生成点。
- 对审批、通知、文档引用等持久化链接重点回归。

### 10.3 API 路径短期不一致

风险：Aims/Codocs 现有内部 API 未完全按 `/api/v1/{appCode}` 命名。

处理：

- 第一阶段允许应用 basePath 下的内部 `/api/**` 由路径网关转发。
- 跨应用 API 必须按 appCode API base。
- 后续再清理内部旧路径。

### 10.4 Root app 路由吞噬

风险：根应用 `/` 代理规则覆盖 `/aims/`、`/codocs/`。

处理：

- Gateway 生成时强制最长路径优先。
- 根应用规则最后声明。
- CI 或配置校验检查冲突。

## 11. 需要同步更新的文档

实施时同步更新：

- `docs/Huizhi-yun-Platform-Target-Architecture.md`
- `docs/App-Manifest-Spec.md`
- `docs/MODULE_CONTRACTS.md`
- `docs/Control-Plane-API-Contract.md`
- `platform/CLAUDE.md`
- `foundation/CLAUDE.md`
- `console/CLAUDE.md`
- `aims/CLAUDE.md`
- `codocs/CLAUDE.md`

## 12. 推荐首版默认路由

在没有独立 Portal 应用前：

```text
publicUrl = https://hzy.wiztek.cn
rootAppCode = console
console.basePath = /
aims.basePath = /aims/
codocs.basePath = /codocs/
```

如果明确希望 Console 以管理后台形态出现：

```text
publicUrl = https://hzy.wiztek.cn
rootAppCode = portal
portal.basePath = /
console.basePath = /admin/
aims.basePath = /aims/
codocs.basePath = /codocs/
```

建议长期采用第二种，即新增或收敛一个轻量 Portal/员工工作台作为根应用，Console 挂 `/admin/`。
