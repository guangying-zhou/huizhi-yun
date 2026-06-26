# Platform 前端改版建议（当前代码到目标形态）

## 1. 目的

本文是 `Platform-Frontend-Product-Plan.md` 的实现补充，目的是把产品方案直接映射到当前已有前端页面。

---

## 2. 当前已有页面如何重定位

### 2.1 `platform/app/pages/admin/index.vue`

当前定位：

- 平台模块入口页

建议重定位：

- 平台运营工作台

需要补的模块：

- 待完成应用资源发现
- 待开通租户
- 待确认订阅
- 待处理 deployment / heartbeat 异常

### 2.2 `platform/app/components/console/ApplicationsManager.vue`

当前定位：

- 应用基础 CRUD + manifest 维护

建议重定位：

- 应用台账详情页的第一版基础信息/资源发现模块

建议后续拆标签：

- 基础信息
- 资源发现
- 平台角色
- 模板中心
- 接入历史

### 2.3 `platform/app/components/console/TenantsManager.vue`

当前定位：

- 企业基础 CRUD

建议重定位：

- 租户台账基础信息页

建议后续补：

- 开通阶段
- 已选应用
- deployment 摘要
- license 摘要

### 2.4 `platform/app/components/console/DeploymentsManager.vue`

当前定位：

- deployment 记录维护

建议重定位：

- 平台部署中心

建议后续补：

- 按租户/应用查看
- 最近 heartbeat
- 连通性测试状态
- 配置完成度

### 2.5 `platform/app/components/console/LicensesManager.vue`

当前定位：

- license 基础编辑

建议重定位：

- license 中心

建议后续补：

- capability profile 视图
- 即将过期提醒
- 与订阅记录联动

### 2.6 `platform/app/components/console/RolesManager.vue`

当前定位：

- 角色元数据 + 权限矩阵 + scope

建议重定位：

- 租户角色中心

后续补：

- 角色来源（平台预置 / 租户自定义）
- 推荐角色套件
- 与模板联动入口

### 2.7 `platform/app/components/console/TemplatesManager.vue`

当前定位：

- 模板元数据 + 模板角色组合

建议重定位：

- 租户模板中心

后续补：

- 模板绑定
- 覆盖与排除
- 生效范围预览

### 2.8 `platform/app/components/console/UsersManager.vue`

当前定位：

- 用户实体 CRUD

建议重定位：

- 租户用户中心

后续补：

- 当前管理员视图
- 未绑定身份用户视图
- 最近登录用户视图

### 2.9 `platform/app/components/console/SubjectsManager.vue`

当前定位：

- 主体目录 + 身份映射

建议重定位：

- 租户主体与身份中心

后续补：

- 部门树
- 岗位主体
- 映射状态筛选

---

## 3. 建议新增的前端页面

### 3.1 Admin 侧

- `app/pages/admin/subscriptions.vue`
- `app/pages/admin/runtime.vue`
- `app/pages/admin/system-roles.vue`
- `app/pages/admin/system-templates.vue`

### 3.2 Dashboard 侧

- `app/pages/dashboard/onboarding.vue`
- `app/pages/dashboard/applications.vue`
- `app/pages/dashboard/subscriptions.vue`
- `app/pages/dashboard/auth-settings.vue`

---

## 4. 优先实现顺序

1. `[x]` `/admin/applications` 升级为应用台账  
   当前已具备基础信息、资源发现、平台角色、模板中心、接入历史五段式视图。
2. `[x]` `/admin/tenants` 升级为租户台账  
   当前已具备租户摘要、开通阶段、核心数量指标和主档编辑能力。
3. `[x]` 新增 `/admin/subscriptions`  
   当前已具备按租户查看应用启用阶段、建立订阅关系、补 deployment 与 license 的第一版能力。
4. `[x]` 新增 `/dashboard/onboarding`  
   当前已具备按租户上下文汇总开通进度、步骤检查和下一步动作导航的第一版向导页。
5. `[x]` 新增 `/dashboard/applications`  
   当前已通过复用订阅中心能力，为租户管理员提供当前租户下的应用启用与授权视图。
6. `[ ]` 再回头继续补用户/主体/模板的场景化视图

---

## 5. 当前 Admin v2 数据接口

Admin v2 页面不再读取前端 mock 数据，统一通过 platform ops API 访问数据库：

- `GET /api/platform/ops/overview`：运营工作台汇总，读取租户、应用、订阅、部署和审计日志。
- `GET /api/platform/ops/applications`：应用台账列表，支持 `appCode`、`serviceRole`、`releaseStatus`、`keyword`、分页；返回最新 release、manifest、订阅、部署和资源动作计数。
- `GET /api/platform/ops/applications/:appCode/releases`：应用 release 历史。
- `GET /api/platform/ops/applications/:appCode/manifests`：应用 manifest 历史，包含关联 release 版本和资源动作计数。
- `GET /api/platform/ops/applications/:appCode/resources`：当前 manifest 的资源/动作树，支持 `requiresGrant=true|false`。
