# Platform 控制台分层与入口方案

## 1. 背景

补充说明：

- 本文主要解决 `landing / admin / dashboard` 的产品边界与入口问题
- 更贴近真实 SaaS 运营链路的前端产品方案，见：
  - `Platform-Frontend-Product-Plan.md`
  - `Platform-Frontend-Implementation-Suggestions.md`

当前 `platform` 已经有了第一批控制面接口和若干最小管理页，但页面形态仍然是“一个后台壳子”。  
如果目标是让 `platform` 向真正的 SaaS 平台靠拢，这种形态不够。

后续产品需要同时满足三类诉求：

- 平台对外要有正式的品牌首页、注册、登录入口
- 平台管理员要有跨租户、跨 deployment 的控制台
- 租户管理员要有只面向本租户的管理台

因此，`platform` 不应再被理解成“只有一个后台”，而应明确拆成三层：

1. `Landing`
2. `Admin Console`
3. `Tenant Dashboard`

---

## 2. 目标结论

`platform` 的产品结构调整为：

- `/`
  平台 Landing Page
- `/login`
  登录入口
- `/register`
  注册入口
- `/admin`
  平台控制台，仅平台管理员可见
- `/dashboard`
  租户管理台，仅租户管理员和租户内部授权用户可见

其中：

- `admin` 面向平台运营方
- `dashboard` 面向租户侧管理员
- 两者都使用 `foundation` 提供的菜单和壳层能力
- `landing` 不使用后台壳子，不混入后台导航语义

---

## 3. 三层产品面定义

### 3.1 Landing

`Landing` 是对外产品入口，不是后台。

目标：

- 展示平台定位、能力、方案与接入方式
- 提供注册、登录、预约演示、文档入口
- 承担品牌首页与 SaaS 转化入口

建议入口：

- `/`
- `/pricing`
- `/docs`
- `/login`
- `/register`

特点：

- 不显示后台菜单
- 不暴露租户内部资源
- 不依赖租户上下文
- 更接近产品官网 + 认证入口

### 3.2 Admin Console

`Admin Console` 是平台侧的控制面后台。

建议入口：

- `/admin`

面向角色：

- `super_admin`
- `platform:admin`
- 后续可细分 `platform:operator`

职责：

- 租户开通、冻结、停用
- deployment / license 管理
- 平台级应用注册与 manifest 审核
- 系统角色、系统模板、系统资源管理
- 上游身份源策略管理
- bundle / revocation / heartbeat / audit 运营

### 3.3 Tenant Dashboard

`Tenant Dashboard` 是租户内管理台。

建议入口：

- `/dashboard`

面向角色：

- `tenant:admin`
- `tenant:iam_admin`
- 后续也可承载 `tenant:operator`

职责：

- 本租户用户与主体目录
- 本租户角色、模板、绑定、覆盖
- 本租户应用启用与配置
- 本租户 deployment 视图
- 本租户 identity 绑定
- 本租户管理员委派

---

## 4. 为什么必须拆成 admin 和 dashboard

这不是纯 UI 优化，而是控制面边界问题。

如果不拆，会出现 3 个后果：

1. 平台管理员与租户管理员边界混乱
2. 页面通过“隐藏按钮”做权限隔离，长期不可维护
3. API 和路由语义会越来越脏，最终所有页面都要带 `tenantCode` 手工切换

正确方向是：

- 平台管理员工作在 `admin`
- 租户管理员工作在 `dashboard`
- 两者共享基础壳层能力，但不共享管理域

---

## 5. 路由与信息架构建议

### 5.1 Landing 路由

- `/`
- `/login`
- `/register`
- `/about`
- `/pricing`
- `/contact`

### 5.2 Admin 路由

- `/admin`
- `/admin/tenants`
- `/admin/deployments`
- `/admin/licenses`
- `/admin/applications`
- `/admin/system-roles`
- `/admin/system-templates`
- `/admin/audit`
- `/admin/runtime`

### 5.3 Dashboard 路由

- `/dashboard`
- `/dashboard/users`
- `/dashboard/subjects`
- `/dashboard/roles`
- `/dashboard/templates`
- `/dashboard/template-bindings`
- `/dashboard/applications`
- `/dashboard/deployments`
- `/dashboard/settings`

建议：

- `admin` 页面默认具备跨租户切换能力
- `dashboard` 页面默认锁定当前租户上下文，不要求手输 `tenantCode`

---

## 6. 角色与访问边界

建议从第一版就明确两套后台角色：

### 6.1 平台后台角色

- `super_admin`
  全平台最高权限
- `platform:admin`
  平台控制台管理权限
- `platform:operator`
  平台运营与只读运维权限

### 6.2 租户后台角色

- `tenant:admin`
  本租户管理台最高权限
- `tenant:iam_admin`
  本租户 IAM 管理权限
- `tenant:operator`
  本租户运营或只读权限

访问规则建议：

- 只有平台后台角色可进入 `/admin`
- 只有租户后台角色可进入 `/dashboard`
- 两类角色可并存，但仍按入口分域

---

## 7. foundation 在其中的角色

`foundation` 不应该只提供一套“通用后台菜单”，而应提供：

1. 共享壳层能力
2. 多套菜单注册能力
3. 路由权限过滤能力
4. 用户上下文与租户上下文能力

### 7.1 foundation 应提供的共享能力

- 顶部导航壳层
- 左侧菜单容器
- 当前用户信息区
- 当前租户切换区
- 权限过滤后的菜单输出
- 页面标题、面包屑、通知入口
- 登录态与跳转能力

### 7.2 foundation 菜单模型建议

建议把菜单抽象成：

- `menuScope = public | admin | dashboard`

即：

- `public`：Landing 顶部导航
- `admin`：平台控制台菜单
- `dashboard`：租户管理台菜单

每个菜单项至少包含：

- `key`
- `label`
- `to`
- `icon`
- `scope`
- `requiredPermissions`
- `requiredRoles`
- `tenantScoped`

### 7.3 foundation 菜单提供方式

建议由 `foundation` 提供菜单注册器，而不是让每个 app 自己散写。

例如：

- `registerPublicMenus(...)`
- `registerAdminMenus(...)`
- `registerDashboardMenus(...)`

这样 `platform` 只负责声明菜单，不负责重复造壳层逻辑。

---

## 8. platform 的页面结构建议

建议 `platform` 项目内按以下方式重组：

- `app/pages/index.vue`
  Landing 首页
- `app/pages/login.vue`
  登录页
- `app/pages/register.vue`
  注册页
- `app/pages/admin/*.vue`
  平台控制台页面
- `app/pages/dashboard/*.vue`
  租户管理台页面

建议新增两类 layout：

- `app/layouts/public.vue`
- `app/layouts/console.vue`

其中：

- `public.vue` 给 landing / login / register
- `console.vue` 给 `admin` 和 `dashboard`

`console.vue` 内部再通过上下文切换：

- 当前 scope 是 `admin`
- 当前 scope 是 `dashboard`

从而决定使用哪一套菜单和面包屑。

---

## 9. 登录后的跳转规则

登录成功后，不建议统一跳首页。

建议按用户角色决定默认跳转：

1. 有平台后台角色
   跳 `/admin`
2. 只有租户后台角色
   跳 `/dashboard`
3. 只有应用消费角色
   跳用户有权访问的默认应用
4. 未命中有效入口
   跳 `landing` 并提示等待授权

如果用户同时拥有 `admin` 和 `dashboard` 权限：

- 默认跳最近一次使用入口
- 或默认跳 `/admin`，并提供“进入租户管理台”快捷入口

---

## 10. API 边界也应同步拆分

前端入口拆分后，API 语义也要跟着清晰。

建议保留：

- `/api/platform/admin/...`
  平台控制面 API

同时新增：

- `/api/platform/dashboard/...`
  租户内管理台 API

这样可以避免：

- `dashboard` 页面仍然去调用 `admin` API
- 租户管理员对平台级接口做权限拒绝
- 后续所有租户页都带 `tenantCode` 手输参数

第一阶段可以先允许 `dashboard` 复用部分 `admin` 底层实现，但外部路由要先分开。

---

## 11. 对当前 platform 现状的直接调整建议

### 11.1 当前首页

当前 `/` 还是控制台首页。  
建议改成真正的 Landing。

当前已有的：

- `/tenants`
- `/roles`
- `/templates`

不应长期直接挂在根路径下。

建议过渡为：

- `/admin/tenants`
- `/dashboard/roles`
- `/dashboard/templates`

### 11.2 当前租户输入方式

现在很多页面通过手输 `tenantCode` 工作。  
这对平台管理员短期可接受，但对租户管理员不合理。

建议：

- `admin` 保留租户切换能力
- `dashboard` 直接从当前登录上下文读取 `tenantCode`
- `dashboard` 页面对 `tenantCode` 默认隐藏或只读

### 11.3 当前菜单与首页卡片

当前卡片只是开发阶段导航。  
后续应拆成：

- Landing 顶部导航
- Admin 侧边菜单
- Dashboard 侧边菜单

不再让一个页面承载三种入口语义。

---

## 12. 建议的实施顺序

### Phase 1：信息架构定型

- 定义三层产品面：`landing / admin / dashboard`
- 定义两套后台角色：平台管理员 / 租户管理员
- 定义 foundation 菜单 scope

### Phase 2：前端壳层重组

- 新增 `public` 与 `console` layout
- 将当前控制台首页迁到 `/admin`
- 预留 `/dashboard`
- 补 `login / register`

### Phase 3：后台菜单与上下文能力

- foundation 提供多 scope 菜单注册能力
- 增加当前租户上下文能力
- 增加登录后分流跳转能力

### Phase 4：租户台与平台台分流

- 把用户/主体/角色/模板逐步拆到 `/dashboard`
- 把租户、license、deployment、audit 固定到 `/admin`

### Phase 5：API 收口

- 增加 `/api/platform/dashboard/...`
- 将租户管理台 API 从平台 API 中逐步剥离

---

## 13. 第一版落地建议

为了不把当前节奏打断，第一版建议这样做：

1. 保留现有接口实现
2. 先重组前端路由与 layout
3. 先把当前后台首页迁到 `/admin`
4. 新增最小 `/dashboard`
5. 将 `roles / templates / subjects / users` 逐步放到 `/dashboard`
6. 将 `tenants / deployments / licenses` 固定在 `/admin`

这样不会立刻推翻现有代码，但能让结构从现在开始朝正确方向演进。

---

## 14. 结论

`platform` 后续应被定义为：

- 对外是 SaaS 平台入口
- 对内包含两套后台：
  - `Admin Console`
  - `Tenant Dashboard`

最终产品结构应是：

- `landing` 负责获客、注册、登录
- `admin` 负责平台控制面
- `dashboard` 负责租户管理台

`foundation` 负责：

- 公共壳层
- 菜单系统
- 权限过滤
- 用户/租户上下文

`platform` 负责：

- 定义业务页面
- 声明菜单
- 调用控制面与租户面 API

这是 `platform` 向真正 SaaS 控制面演进时，最应该先钉住的一条边界。
