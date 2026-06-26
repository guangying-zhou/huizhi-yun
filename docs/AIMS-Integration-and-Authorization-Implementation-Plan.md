# AIMS 接入与授权落地方案

## 1. 文档目标

本文档用于定义 `AIMS` 如何作为首个业务应用接入新的平台认证与授权体系。

本方案不讨论平台总体理想架构，而是聚焦以下问题：

- `AIMS` 如何接入平台 token 与 `foundation` SDK
- `AIMS` 的应用级权限与项目级数据范围如何拆分
- `AIMS` 的前端、服务端、资源定义、项目成员模型如何收口
- `AIMS` 如何作为首个样板，验证平台协议、SDK 和授权模型是否可用

---

## 2. AIMS 在整体路径中的定位

`AIMS` 是首个完整接入新平台模型的业务应用，但它不是现网兼容压力最大的模块。

因此，`AIMS` 的角色不是“兼容桥”，而是“首个完整试点”。

这意味着：

- `AIMS` 应优先使用新 token、新 SDK、新 manifest、新授权判断链路
- `AIMS` 不再继续扩展旧式 CAS 直连和旧权限判断写法
- `AIMS` 应优先验证“平台权限 + 本地项目上下文”两段式授权是否可跑通

在实施顺序上，`AIMS` 位于：

1. 平台协议冻结之后
2. `account` 增量模型初步可用之后
3. `foundation` 最小 SDK 能力可用之后

---

## 3. AIMS 当前问题概述

结合现状，`AIMS` 当前权限与接入问题主要有以下几类：

### 3.1 登录与权限消费逻辑尚未完全平台化

当前应用侧更接近“拿到登录用户后自行判断”，而不是标准化消费平台侧下发的授权结果。

这会导致：

- 登录态和权限态耦合不清
- 前端和服务端对权限的理解不一致
- app 对上游身份协议产生直接耦合

### 3.2 应用级权限与项目级权限混在一起

`AIMS` 天然存在两类授权：

- 应用级：用户是否能进入 `AIMS`、是否拥有某类功能权限
- 项目级：用户能访问哪些项目、是否能编辑当前项目、是否能管理成员

当前最容易出现的问题，是把这两类逻辑混在同一个判断里，导致：

- 路由可进但接口失败
- 菜单可见但数据越权
- 某些地方按平台角色判断，某些地方按项目成员判断

### 3.3 项目内角色语义可能继续发散

`AIMS` 内部已有项目成员、项目负责人、创建者、leader 等概念。如果不尽快统一，后面会出现：

- 前端和服务端判断标准不一致
- 平台角色与项目角色重复表达
- 项目经理、成员、观察者等角色在多个页面和接口里各自解释

### 3.4 服务端鉴权入口未完全收口

如果继续由各接口各写一套成员/管理员判断，会导致：

- 授权逻辑不可审计
- 新模型接入成本高
- 未来 scope 扩展时需要逐接口返工

---

## 4. AIMS 目标授权模型

`AIMS` 的授权应统一表达为：

`Allow = AppPermission && ProjectScopeMatch && BusinessRuleMatch`

其中三部分分别表示：

### 4.1 AppPermission

由平台提供的应用级权限，回答：

- 用户是否可访问 `AIMS`
- 用户是否具备 `projects:view`、`projects:edit`、`members:manage` 等能力

这一层由平台侧资源、角色、模板、scope 规则统一下发。

### 4.2 ProjectScopeMatch

由 `AIMS` 自己解释的项目级范围，回答：

- 当前项目是否属于允许访问范围
- 当前用户是否为项目成员
- 当前用户是否为该项目的 manager / owner / participant

这一层由 `AIMS` 本地 `ScopeResolver` 负责。

### 4.3 BusinessRuleMatch

由具体业务规则决定的额外限制，回答：

- 当前对象是否处于可编辑状态
- 当前操作是否需要额外审批、锁定、版本状态检查
- 当前资源是否对外部成员只读

这一层不属于平台 IAM，而属于 `AIMS` 自己的业务规则。

---

## 5. 接入边界

### 5.1 平台负责什么

平台负责：

- 登录后签发平台 token
- 向 `AIMS` 提供标准 claims
- 下发 `AIMS` 的 app manifest、资源权限与 scope 规则
- 提供 revocation、bundle、heartbeat 所需接口

### 5.2 foundation 负责什么

`foundation` 负责：

- 验签 token
- 拉取并缓存 policy bundle
- 加载权限快照
- 提供统一 `checkPermission()`
- 提供前端菜单过滤、路由守卫
- 提供服务端鉴权工具

### 5.3 AIMS 自己负责什么

`AIMS` 负责：

- 解释项目级关系语义
- 实现本地 `ScopeResolver`
- 维护项目成员模型
- 将平台级权限判断与项目级上下文判断组合起来
- 在服务端统一收口接口授权

---

## 6. 推荐资源模型

第一版建议先把 `AIMS` 的资源按稳定业务面拆成以下几类。

### 6.1 应用入口与总览

- `aims:dashboard:view`

### 6.2 项目

- `aims:projects:view`
- `aims:projects:create`
- `aims:projects:edit`
- `aims:projects:archive`
- `aims:projects:admin`

### 6.3 项目成员

- `aims:members:view`
- `aims:members:manage`

### 6.4 需求

- `aims:requirements:view`
- `aims:requirements:create`
- `aims:requirements:edit`
- `aims:requirements:admin`

### 6.5 工作项

- `aims:work_items:view`
- `aims:work_items:create`
- `aims:work_items:edit`
- `aims:work_items:admin`

### 6.6 文档、通知、统计等其他模块

第一版可以按最小可用方式声明，但不要求一次性做细：

- `aims:documents:view`
- `aims:documents:edit`
- `aims:notifications:view`
- `aims:reports:view`

原则是：

- 第一版先覆盖真正有授权差异的核心资源
- 不要一开始把所有页面粒度都切得过细
- 资源粒度优先贴近服务端接口和业务对象，而不是只贴近菜单

---

## 7. 推荐 scope 设计

第一版建议只支持三个稳定范围：

- `all`
- `self`
- `project_member`

其中：

- `all`：适用于平台级管理员或应用管理员
- `self`：适用于仅看自己创建/自己负责对象的能力
- `project_member`：适用于当前用户是项目成员即可访问的能力

第一版不建议在 `AIMS` 里立即落太多复杂关系，例如：

- `participant`
- `project_manager`
- `related_projects`

这些关系后续可以在项目成员模型和 resolver 稳定后再扩。

---

## 8. 项目成员模型建议

为了避免角色语义继续发散，第一版建议 `AIMS` 项目内权限判断统一依赖项目成员表中的标准角色。

推荐项目成员角色先收敛为：

- `manager`
- `member`
- `viewer`

并遵循以下规则：

### 8.1 `manager`

表示项目级管理者，拥有：

- 项目配置修改
- 成员管理
- 关键资源编辑/归档

### 8.2 `member`

表示普通项目成员，拥有：

- 项目内容查看
- 被授权的内容创建/编辑

### 8.3 `viewer`

表示只读成员，拥有：

- 项目内容查看
- 无成员管理权
- 无高风险编辑权

### 8.4 其他业务字段的处理原则

例如：

- `leaderUid`
- `created_by`
- `owner_uid`

这些字段可以保留业务意义，但不应直接作为最终授权依据。  
如果业务上需要它们对应权限，应显式投影到项目成员角色或业务规则中。

---

## 9. 前端接入方案

`AIMS` 前端应全部通过 `foundation` 消费平台权限，不再自己维护一套应用级权限模型。

### 9.1 登录态消费

前端只消费：

- 当前用户身份 claims
- 当前应用权限快照
- 平台下发的可见应用与 capability

前端不再关心上游是 CAS、企业微信还是 GitLab OIDC。

### 9.2 菜单与导航

菜单配置应支持挂载资源标识，例如：

- `resource`
- `action`

然后统一由 `foundation` 的菜单过滤逻辑决定是否展示。

### 9.3 路由守卫

路由守卫统一基于：

- 是否已登录
- 是否具备目标资源权限

但路由守卫只负责应用级权限，不直接承担项目数据范围判断。

### 9.4 页面级项目范围处理

进入项目页后，页面可以先根据项目详情接口返回值或专门的项目授权检查接口决定：

- 是否可查看
- 是否为只读
- 是否具备管理入口

也就是说：

- 路由决定“能不能进这一类页面”
- 页面数据决定“对这个项目能做什么”

---

## 10. 服务端接入方案

服务端是 `AIMS` 授权真正收口的关键点。

### 10.1 禁止继续分散写法

第一版就应明确：

- 不再允许各接口继续各自写一套 `manager/member` 判断
- 新接口必须走统一授权工具
- 老接口逐步迁移到统一授权入口

### 10.2 推荐统一入口

建议在 `AIMS` 服务端提供统一方法，例如：

`requireProjectPermission(projectId, resource, action, options)`

该方法至少完成：

1. 校验平台 token 与用户身份
2. 检查用户是否具备对应 app permission
3. 调用本地 `ScopeResolver` 判断项目范围
4. 根据需要叠加业务规则判断

### 10.3 两类接口处理方式

#### 项目外接口

例如：

- 项目列表
- 创建项目
- 仪表盘

这类接口主要做：

- app permission 判断
- 必要时按 scope 过滤返回结果

#### 项目内接口

例如：

- 项目详情
- 成员管理
- 需求/工作项 CRUD

这类接口必须做：

- app permission 判断
- 当前项目 scope 判断
- 必要的成员角色判断

### 10.4 查询接口与写接口差异

查询接口不只要判断“能不能查”，还要保证“查出来的数据范围正确”。  
写接口不只要判断“能不能写”，还要保证“当前对象确实属于允许写的范围”。

因此，服务端接入不能只停留在控制器入口，还需要收口到 repository / service 层的过滤逻辑。

---

## 11. ScopeResolver 设计

`AIMS` 应实现自己的本地 `ScopeResolver`，由 `foundation` 调用或由 `AIMS` 在授权工具中调用。

### 11.1 第一版最小能力

第一版只需要支持：

- `all`
- `self`
- `project_member`

### 11.2 推荐输入

推荐输入参数至少包括：

- `uid`
- `scope`
- `resource`
- `action`
- `projectId`
- `context`

### 11.3 推荐输出

返回统一结构，例如：

- `allow: boolean`
- `mode: read_only | editable | admin`
- `matchedBy: all | self | project_member | business_rule`

### 11.4 project_member 的解释

`project_member` 不应由前端推断，而应由服务端基于项目成员表判断。

如果某用户对某项目不是成员，即使前端拿到了项目链接，也不应返回完整项目数据。

---

## 12. App Manifest 落地要求

`AIMS` 应成为第一批按 manifest 驱动资源同步的应用。

第一版要求：

- 资源定义改由 manifest 声明
- manifest 中只声明 `recommendedRoles`
- manifest 中声明支持的 `supportedScopes`
- 不再在应用内部单独维护一套与平台脱节的资源清单

平台侧最终基于 manifest：

- 同步资源
- 校验声明合法性
- 生成 bundle 中的 app 资源描述

---

## 13. 推荐角色映射

平台侧建议至少为 `AIMS` 准备以下应用职责角色：

- `aims:member`
- `aims:pm`
- `aims:admin`

推荐语义如下：

### 13.1 `aims:member`

拥有：

- `projects:view`
- `requirements:view`
- `work_items:view`

默认 scope：

- `project_member`

### 13.2 `aims:pm`

拥有：

- `projects:view`
- `projects:edit`
- `members:view`
- `members:manage`
- `requirements:*`
- `work_items:*`

默认 scope：

- 第一版可先按 `project_member`
- 项目管理能力由本地 `manager` 角色再进一步约束

### 13.3 `aims:admin`

拥有：

- 全部 `AIMS` 资源能力

默认 scope：

- `all`

---

## 14. 实施步骤建议

建议按以下顺序推进。

### Step 1：整理 `AIMS` 资源清单

输出：

- 资源列表
- action 列表
- 路由/菜单/接口与资源的映射表

### Step 2：统一项目成员角色模型

输出：

- 标准项目成员角色定义
- 现有字段到成员角色/业务规则的映射

### Step 3：在 `foundation` 接入 `AIMS` 所需最小能力

输出：

- token 验签
- 权限快照
- 前端守卫
- 服务端鉴权工具

### Step 4：在 `AIMS` 服务端收口统一授权入口

输出：

- 项目外接口授权入口
- 项目内接口授权入口
- 基础查询过滤逻辑

### Step 5：前端菜单与路由切到统一权限消费

输出：

- 菜单 resource 绑定
- 路由守卫统一化
- 项目页权限呈现统一化

### Step 6：以一条完整业务链路先试点

建议先选：

- 项目列表
- 项目详情
- 项目成员管理
- 需求列表/详情

先用这一条链路验证：

- 登录
- token
- bundle
- 前端守卫
- 服务端授权
- 项目范围判断

### Step 7：再扩到其他资源

待首条链路稳定后，再逐步扩到：

- 工作项
- 文档
- 通知
- 报表

---

## 15. 验收标准

`AIMS` 完成第一阶段接入后，应满足以下标准：

### 15.1 协议层

- 不再直接依赖 CAS 语义
- 能稳定消费平台 token
- 能通过 `foundation` 使用 bundle 与 revocation

### 15.2 前端层

- 菜单可根据资源权限正确过滤
- 路由守卫不再依赖旧权限写法
- 页面能正确反映当前项目的只读/可编辑/管理态

### 15.3 服务端层

- 核心项目接口已收口到统一授权入口
- 项目查询结果符合 scope 约束
- 非项目成员无法越权访问项目内数据

### 15.4 模型层

- 资源来自 manifest
- 应用级权限与项目级成员权限语义清晰分离
- 项目成员角色模型可稳定复用

---

## 16. 风险与控制

### 16.1 资源粒度切得过细

会导致第一版实现复杂度过高。  
控制方式：先围绕项目、成员、需求、工作项四类核心资源。

### 16.2 项目成员模型不统一

会导致服务端和前端判断标准继续分裂。  
控制方式：第一阶段先收敛角色语义，再扩功能。

### 16.3 只做前端权限，不收口服务端

会导致页面看起来正确，但数据仍可越权。  
控制方式：以服务端收口作为第一优先级。

### 16.4 过早追求复杂 scope

会拖慢首个试点落地。  
控制方式：第一版只落 `all / self / project_member`。

---

## 17. 结论

`AIMS` 的落地重点不是“把所有权限都细化完”，而是先把以下链路完整跑通：

- 平台 token
- foundation SDK
- app manifest
- 应用级权限
- 项目级 scope resolver
- 服务端统一授权入口

只要这条链路跑通，`AIMS` 就能成为平台新模型的首个稳定样板，后续 `codocs` 和其他应用就有了可复用的接入模板。
