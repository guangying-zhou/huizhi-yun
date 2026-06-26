# App Manifest 规范 v1

状态：Draft  
日期：2026-06-15
定位：目标设计，作为 `Huizhi-yun-Platform-Target-Architecture.md`、`Control-Plane-API-Contract.md` 与 `Foundation-SDK-Contract.md` 的配套文档

---

## 0. 文档目标

本文档定义业务应用向 `Control Plane` 注册时使用的 `App Manifest` 结构与约束，重点回答：

- app 需要声明哪些元数据
- 资源、动作、推荐角色、支持 scope 如何表达
- capability 依赖如何表达
- 哪些字段由 app 声明，哪些字段由平台治理

本文档不展开：

- manifest 的完整 OpenAPI
- app 上架、审核、发布流程
- 第三方应用市场治理细节

---

## 1. 设计目标

`App Manifest` 的作用不是让业务应用自己管理 IAM，  
而是让业务应用向平台声明：

1. 我是什么应用
2. 我有哪些资源和动作
3. 我支持哪些 scope 语义
4. 我依赖哪些 capability
5. 我建议平台如何初始化角色目录

一句话：

**Manifest 负责声明能力边界，不负责最终授权分配。**

---

## 2. 设计原则

| # | 原则 |
|---|------|
| M1 | Manifest 是 app 对平台的声明，不是平台对 app 的配置 |
| M2 | Manifest 可声明推荐角色，但不直接授予角色 |
| M3 | Manifest 可声明支持的 scope，但不解释 scope 语义 |
| M4 | Manifest 内容由平台版本化管理，允许向后兼容新增字段 |
| M5 | Manifest 应足够通用，既适用于平台自带 app，也适用于未来第三方 app |
| M6 | Manifest 注册发生在发布/治理阶段，不在 tenant runtime 启动时重复执行 |

---

## 3. Manifest 顶层结构

第一版建议结构如下：

```json
{
  "appCode": "aims",
  "appName": "研发项目管理",
  "appType": "internal",
  "serviceRole": "business_app",
  "description": "研发项目、需求、任务与成员协作管理",
  "icon": "i-lucide-kanban",
  "entry": {
    "web": "/aims",
    "apiBase": "/api/v1"
  },
  "resources": [],
  "recommendedRoles": [],
  "supportedScopes": [],
  "capabilitiesRequired": [],
  "runtimeRequirements": {},
  "compatibility": {}
}
```

---

## 4. 顶层字段说明

### 4.1 基础字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `appCode` | 是 | 应用唯一编码，全平台唯一 |
| `appName` | 是 | 应用名称 |
| `appType` | 是 | 平台应用部署类型：`internal / external / system`。汇智云自研业务应用通常使用 `internal` |
| `serviceRole` | 否 | 应用服务定位：`business_app / directory_runtime / workflow_runtime / supporting_service`。缺省按业务应用 `business_app` 处理 |
| `version` | 否 | 已废弃；平台注册版本统一来自 GitLab release/tag |
| `displayVersion` | 否 | 已废弃；UI 展示版本统一使用平台注册版本 |
| `description` | 否 | 应用说明 |
| `icon` | 否 | 应用入口图标，优先使用 Iconify / Nuxt UI 图标名（如 `i-lucide-kanban`），也可使用图标资源 URL；不建议放品牌 logo |

`icon` 用于 Console / Foundation 的 AppRail、AppLauncher 等应用切换入口；当前应用自身侧边栏品牌位仍由各应用运行时 `appLogo` 控制。修改 `icon` 后，需要随 GitLab release/tag 重新导入 manifest，生成/刷新 policy bundle，并让业务应用刷新本地 bundle 后才会在入口中生效。

### 4.2 入口字段

```json
{
  "entry": {
    "web": "/aims",
    "apiBase": "/api/v1"
  }
}
```

说明：

- `web`：应用源码声明的默认前端入口，可为相对路径；不表示某个客户环境的最终访问地址
- `apiBase`：应用服务端 API 根路径

运行态地址由 Platform 应用台账、租户部署站点和租户 deployment 路由配置决定：

- `platform_applications.home_url`：应用默认访问地址，适合全局单实例或开发默认值。
- `deployment_sites.public_url`：租户企业端统一部署 URL，例如 `https://hzy.wiztek.cn`。
- `deployments.base_path`：应用挂载路径，例如 `/admin/`、`/aims/` 或根应用 `/`；生成 policy bundle 时与 `public_url` 拼成 `applications.homeUrl`。
- `deployments.api_base`：应用对外 API 根路径，默认 `/api/v1/{appCode}`。
- `platform_applications.callback_url`：应用默认 OIDC callback 覆盖项；为空时由最终 `homeUrl + /api/auth/oidc-callback` 自动生成。

因此，manifest 应随 GitLab release 提交和发布；Platform 按 release/tag 导入 manifest 并物化资源、动作、角色建议。不要把客户域名、localhost 端口等环境地址写入通用 manifest。

### 4.3 运行约束字段

```json
{
  "runtimeRequirements": {
    "requiresSdk": true,
    "supportsCustomerHosted": true,
    "supportsManagedControlPlane": true
  }
}
```

用途：

- 告诉平台该 app 是否符合当前目标架构

### 4.4 兼容性字段

```json
{
  "compatibility": {
    "minControlPlaneVersion": "1.0.0",
    "minSdkVersion": "1.0.0"
  }
}
```

---

## 5. Resource 声明规范

### 5.1 结构

```json
{
  "resources": [
    {
      "code": "projects",
      "name": "项目管理",
      "description": "项目列表、详情、配置、成员",
      "actions": ["view", "edit", "admin"],
      "requiresGrant": true,
      "sortOrder": 1
    }
  ]
}
```

### 5.2 约束

- `code` 在单个 app 内唯一
- `actions` 第一版建议只允许：
  - `view`
  - `edit`
  - `admin`
- `requiresGrant` 可选，默认 `true`；设为 `false` 表示该资源下的 action 暂不需要纳入权限覆盖检测
- 动作继承由平台和 SDK 解释，不在 manifest 中重复表达

### 5.3 设计边界

资源清单由 app 声明，但平台保留最终治理权：

- 平台可拒绝不合法资源编码
- 平台可记录资源历史版本
- 平台可做资源同步审计

---

## 6. Recommended Roles 规范

### 6.1 为什么是 `recommendedRoles`

业务应用可以知道“通常有哪些职责角色”，  
但不能直接在 manifest 中声明“这些角色一定存在且自动授予”。

因此第一版统一使用：

- `recommendedRoles`

而不是：

- `defaultRoles`

### 6.2 结构

```json
{
  "recommendedRoles": [
    {
      "code": "aims:member",
      "name": "项目成员",
      "description": "AIMS 基础使用者",
      "suggestedPermissions": [
        "aims:projects:view",
        "aims:tasks:view"
      ]
    },
    {
      "code": "aims:pm",
      "name": "项目经理",
      "description": "AIMS 项目管理角色",
      "suggestedPermissions": [
        "aims:projects:edit",
        "aims:tasks:edit"
      ]
    }
  ]
}
```

### 6.3 约束

- `recommendedRoles` 是建议目录，不等于运行时授予
- 平台可以采用、调整或忽略这些建议
- 最终角色定义以 `Control Plane` 中的 `roles` 为准

---

## 7. Supported Scopes 规范

### 7.1 结构

```json
{
  "supportedScopes": [
    "all",
    "self",
    "department",
    "member",
    "owner"
  ]
}
```

### 7.2 语义

该字段表示：

- 此 app 的业务模型可以解释哪些 scope

它不表示：

- 当前 tenant 一定启用了这些 scope
- 平台一定会下发这些 scope

### 7.3 第一版约束

第一版建议标准集合包括：

- `all`
- `self`
- `department`
- `member`
- `owner`
- `participant`

若 app 需要扩展 scope，建议走：

- 平台先登记
- 再纳入统一字典

不建议应用各自发明一批不兼容的新 scope 名称。

---

## 8. Capability 依赖规范

### 8.1 结构

```json
{
  "capabilitiesRequired": [
    "workflow_engine",
    "knowledge_enhanced_search"
  ]
}
```

### 8.2 语义

表示：

- 若缺少这些 capability，app 的某些功能或整个 app 不应启用

### 8.3 约束

- capability 名称必须来自《License 与 Capability 清单》
- app 不得自定义未知 capability

---

## 9. Registry 与平台消费规则

平台接收 manifest 后，应做以下处理：

1. 校验 manifest 结构
2. 校验资源编码唯一性
3. 校验 capability 是否存在
4. 校验 recommended role 编码前缀是否与 appCode 一致
5. 记录 manifest 内容版本，生成或复用 `platform_app_manifests.manifest_seq`
6. 将 manifest 顶层展示元数据同步到 `platform_applications.app_name / description / icon`；运行地址、callback、logout 等环境字段仍由 Platform 应用台账和租户 deployment 配置维护
7. 将资源目录同步到 `platform_app_manifest_resources / platform_app_manifest_resource_actions / platform_app_supported_scopes`
8. 将 `recommendedRoles` 物化为 `platform_app_roles` / `platform_app_role_permissions`，作为企业角色可引用的应用权限角色
9. 为每个资源动作生成 `action_code = app_code.resource_code.action`，用于权限覆盖检测和权限表追溯

触发方式建议：

- 由发布流程、管理员或专用 CLI/API 提交 manifest
- tenant runtime 启动时只上报当前 `appVersion / manifestVersion / manifestHash / sdkVersion`
- runtime 报到不得隐式创建新的 manifest registration

平台不应做的事：

- 不应因为 app 上报了 `recommendedRoles` 就直接给用户分配角色
- 不应因为 app 上报了 `supportedScopes` 就默认向所有 tenant 开启这些 scope

---

## 10. 版本策略

### 10.1 Release 版本与 Manifest 内容版本

manifest 文件不再声明自己的版本。应用版本统一来自发布系统：

- GitLab release/tag 名称
- release/tag 解析到的 commit SHA
- `platform_app_releases.release_version`

- `app.manifest.json` 只表达应用能力声明，不表达版本
- Platform 导入时以 release/tag 创建或更新 `platform_app_releases`
- Platform 按 manifest 内容 hash 去重；内容变化时创建新的 `platform_app_manifests.manifest_seq`
- deployment 当前运行的 `appVersion`、`manifestVersion`、`manifestHash` 应通过 runtime 报到上报，而不是再次触发 manifest 注册

### 10.2 权限覆盖检测

manifest 中的资源动作会物化到 `platform_app_manifest_resource_actions`。Platform 通过实时 JOIN 检查需要授权的 action 是否已被平台系统角色覆盖：

```sql
SELECT mra.id, mra.action_code
  FROM platform_app_manifest_resource_actions mra
  LEFT JOIN platform_app_role_permissions srp
    ON srp.manifest_action_id = mra.id
 WHERE mra.manifest_id = :manifest_id
   AND mra.requires_grant = 1
   AND mra.status = 'active'
   AND srp.id IS NULL;
```

结果非空时给运营端 warning，但不阻断 release 发布。资源已声明但暂不启用、无需授权或仅内部使用时，可通过 `requiresGrant=false` 或平台侧 `requires_grant=0` 豁免。

### 10.3 向后兼容

建议：

- 顶层字段只追加，不轻易删除
- `resources`、`recommendedRoles`、`supportedScopes` 内部允许新增字段
- 平台至少兼容最近两个小版本的 manifest
- 旧 manifest 中 `appType=business`、`business_app`、`directory_runtime`、`workflow_runtime`、`supporting_service` 会在导入时兼容映射为当前 `appType + serviceRole`；`builtin / optional / third_party` 会分别映射为 `internal / internal / external`

### 10.4 不兼容变更

以下情况应提升 major 版本：

- 资源编码大规模重命名
- 推荐角色编码体系改变
- scope 语义整体变化

---

## 11. `aims` 示例

```json
{
  "appCode": "aims",
  "appName": "研发项目管理",
  "appType": "internal",
  "serviceRole": "business_app",
  "description": "研发项目、需求、任务与成员协作管理",
  "entry": {
    "web": "/aims",
    "apiBase": "/api/v1"
  },
  "resources": [
    {
      "code": "projects",
      "name": "项目管理",
      "actions": ["view", "edit", "admin"],
      "sortOrder": 1
    },
    {
      "code": "tasks",
      "name": "任务管理",
      "actions": ["view", "edit"],
      "sortOrder": 2
    }
  ],
  "recommendedRoles": [
    {
      "code": "aims:member",
      "name": "项目成员"
    },
    {
      "code": "aims:pm",
      "name": "项目经理"
    }
  ],
  "supportedScopes": ["all", "self", "department", "member", "owner"],
  "capabilitiesRequired": [],
  "runtimeRequirements": {
    "requiresSdk": true,
    "supportsCustomerHosted": true,
    "supportsManagedControlPlane": true
  },
  "compatibility": {
    "minControlPlaneVersion": "1.0.0",
    "minSdkVersion": "1.0.0"
  }
}
```

---

## 12. `codocs` 示例

```json
{
  "appCode": "codocs",
  "appName": "汇智云文档",
  "appType": "internal",
  "serviceRole": "business_app",
  "description": "文档协作、发布与审阅",
  "entry": {
    "web": "/codocs",
    "apiBase": "/api/v1"
  },
  "resources": [
    {
      "code": "documents",
      "name": "文档管理",
      "actions": ["view", "edit", "admin"],
      "sortOrder": 1
    },
    {
      "code": "reviews",
      "name": "审阅中心",
      "actions": ["view", "edit"],
      "sortOrder": 2
    }
  ],
  "recommendedRoles": [
    {
      "code": "codocs:user",
      "name": "文档用户"
    },
    {
      "code": "codocs:editor",
      "name": "文档编辑者"
    },
    {
      "code": "codocs:reviewer",
      "name": "文档审阅者"
    }
  ],
  "supportedScopes": ["all", "self", "department", "participant", "owner"],
  "capabilitiesRequired": [],
  "runtimeRequirements": {
    "requiresSdk": true,
    "supportsCustomerHosted": true,
    "supportsManagedControlPlane": true
  }
}
```

---

## 13. 第一版实现边界

第一版建议只支持：

- 平台自带 app 的 manifest
- tenant 级资源目录同步
- `recommendedRoles`
- 标准 scope 集合
- capability 依赖校验

第一版暂不做：

- 第三方应用市场完整上架流程
- 每个 app 自定义复杂 schema
- 动态 UI 页面描述
- 细粒度路由权限自动生成

---

## 14. 后续建议

基于本文，下一步最适合继续补：

1. 《平台运营后台信息架构》
   把 deployment、license、bundle、heartbeat、manifest、revocation 的运营视图整理出来

2. 《App 接入实施指南》
   把 app 从本地资源定义迁到 manifest 的工程步骤整理出来
