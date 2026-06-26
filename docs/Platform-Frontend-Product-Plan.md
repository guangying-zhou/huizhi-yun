# Platform 前端产品方案（面向真实应用场景）

> **实施状态（2026-06）**：Dashboard 端整套 UI 重设计已落地，呈现层规范、关键决策与已知偏差以 [`Platform-UIUX-Redesign-v2.md`](./Platform-UIUX-Redesign-v2.md) §11 为准。

## 1. 背景

当前 `platform` 控制台已经有了：

- 平台管理员入口：`/admin`
- 租户管理台入口：`/dashboard`
- 若干最小管理页：租户、应用、部署、许可证、角色、模板、用户、主体

但这些页面目前更像“后台 CRUD 壳子”，还没有真正围绕 SaaS 平台的业务闭环来组织。

从真实业务场景看，平台前期不是简单地“把表都做成页面”，而是要先跑通这条链路：

1. 平台管理员建立应用台账
2. 平台完成应用资源发现与平台级角色/模板铺底
3. 用户注册并创建租户
4. 租户完善组织与登录模式
5. 租户选择启用的应用
6. 租户完成订阅/授权关系
7. 租户完善部署信息并测试连通性
8. 应用正式启用并进入租户管理台

也就是说：

- **应用管理的第一目标是建立“应用台账”**
- **租户与应用的关系不应该直接挂在应用管理里**
- **租户与应用的关联应该落在订阅/授权管理中**
- **前端页面要围绕“铺底 -> 开通 -> 配置 -> 启用”来组织**

---

## 2. 产品目标

前端控制台需要支撑三类目标：

### 2.1 平台侧目标

- 建立平台级应用台账
- 统一管理应用资源、manifest、版本、接入信息
- 配置平台级角色、权限矩阵、模板
- 为租户开通提供标准化底座

### 2.2 租户侧目标

- 让新租户可以完成自助开通
- 配置租户信息、登录模式、组织与管理员
- 选择要启用的应用
- 查看并完成订阅/授权
- 补齐部署与连接信息
- 进入正式使用状态

### 2.3 产品侧目标

- 管理台不是一堆分散页面，而是清晰的业务闭环
- 前端信息架构要先区分“平台治理”和“租户启用”
- 让平台能够逐步承接 `AIMS`，再承接 `Codocs` 和后续应用

---

## 3. 产品角色

建议前端明确区分以下角色：

### 3.1 平台管理员

职责：

- 建立应用台账
- 完成应用接入审核
- 维护平台级资源发现
- 维护平台级角色与模板
- 开通/冻结租户
- 查看租户订阅与部署状态

入口：

- `/admin`

### 3.2 租户所有者

职责：

- 注册并创建租户
- 选择登录模式
- 选择启用应用
- 补充付款与商务信息（第一版占位）
- 确认部署与连通性
- 正式启用应用

入口：

- `/dashboard/onboarding`

### 3.3 租户管理员

职责：

- 维护用户与主体目录
- 维护租户内角色、模板、绑定、覆盖
- 维护已启用应用的配置
- 管理部署信息和运行状态

入口：

- `/dashboard`

---

## 4. 核心产品原则

### 4.1 应用管理先做“台账”，不直接做“租户启用”

平台控制台里的应用管理，本质上是：

- 应用台账
- 应用元数据
- manifest / 资源发现
- 平台级角色
- 平台级模板
- 接入状态

它回答的是：

- 这个应用是什么
- 它如何接平台
- 它暴露了什么资源
- 平台如何对它进行标准授权建模

它**不回答**：

- 哪个租户用了它
- 哪个租户订阅了什么版本
- 哪个租户是否已经部署完成

这些应该放到“订阅/授权”与“租户启用”里。

### 4.2 租户与应用的关系通过订阅/授权建立

建议把“租户启用某应用”统一抽象为一条 `subscription / entitlement` 关系。

前端上表现为：

- 租户选择应用
- 系统创建订阅记录
- 订阅记录再关联：
  - 商务状态
  - license / capability
  - deployment
  - 启用状态

而不是直接在 `applications` 表意上打补丁。

### 4.3 先铺底，再开通

平台侧先完成：

- 应用台账
- 应用资源发现
- 平台级角色
- 平台级模板

只有这些铺底完成，租户侧的启用才能标准化。

---

## 5. 前端总体结构

建议把 `platform` 前端拆成四个产品面：

1. `Landing`
2. `Admin Console`
3. `Tenant Onboarding`
4. `Tenant Dashboard`

其中：

- `Landing`：公开站点与注册登录入口
- `Admin Console`：平台治理后台
- `Tenant Onboarding`：新租户开通向导
- `Tenant Dashboard`：租户正式管理台

---

## 6. Landing 设计

### 6.1 目标

- 建立品牌认知
- 介绍平台能力与交付模式
- 触发注册、登录、预约演示

### 6.2 页面

- `/`
  产品首页
- `/pricing`
  套餐与商务模式
- `/docs`
  文档入口
- `/login`
  登录
- `/register`
  注册

### 6.3 首页模块建议

1. Hero
   - 平台定位
   - “注册试用 / 申请演示 / 立即登录”

2. 交付模式
   - 平台控制面 SaaS
   - 应用/数据库客户侧部署
   - 企业私有化可选

3. 核心能力
   - 租户与身份管理
   - 应用接入与资源发现
   - 角色、模板、scope
   - 部署、license、heartbeat

4. 应用生态
   - `AIMS`
   - `Codocs`
   - 后续应用

5. 行动区
   - 注册
   - 联系销售

---

## 7. Admin Console 设计

### 7.1 Admin 的核心使命

平台管理员不应该在 `admin` 里直接帮租户做所有内部管理。  
`admin` 的目标是：

- 建立平台底座
- 维护标准能力
- 查看租户与应用的状态
- 推动租户从“待开通”走到“已启用”

### 7.2 Admin 信息架构

建议菜单结构：

- 概览
- 应用台账
- 平台角色
- 平台模板
- 租户台账
- 订阅与授权
- 部署中心
- License 中心
- 运行监控
- 审计日志

### 7.3 Admin 首页

当前 `/admin` 过于偏“技术模块入口”。  
建议改成“平台运营工作台”，首页只看 4 类卡片：

1. 应用台账
   - 已登记应用数
   - 待完成资源发现的应用
   - 待处理 release / manifest 导入
   - 权限覆盖 warning

2. 租户台账
   - 总租户数
   - 待开通租户
   - 已启用租户

3. 订阅与授权
   - 待确认订阅
   - 待生成 license
   - 即将过期 license

4. 部署与运行
   - 待配置 deployment
   - 连通性异常 deployment
   - heartbeat 异常 deployment

首页不应该只是一排菜单入口，而应该直接反映平台经营状态。

---

## 8. 应用台账（Admin 核心）

### 8.1 页面定位

建议把现在的 `/admin/applications` 正式定义为：

`应用台账`

它不是“租户应用管理”，而是平台的应用主数据中心。

### 8.2 页面结构

应用台账页建议拆成 6 个标签页：

1. 基础信息
2. 应用版本
3. 资源发现
4. 平台角色
5. 模板中心
6. 接入历史

### 8.3 基础信息

字段：

- 应用编码
- 应用名称
- 应用类型
- 主页地址
- 回调地址
- 登出地址
- 运行模式
- 认证模式
- 接入状态
- GitLab 仓库地址
- latest released / latest manifest 摘要

动作：

- 新建应用
- 编辑应用
- 删除应用

应用级全局 secret 不再由 Platform 维护。企业 x 应用当前凭证在订阅/部署链路中通过 `tenant_app_credentials` 管理，升级时就地轮换，历史走审计和 console credential-vault。

### 8.4 应用版本

目标：

- 从 GitLab release/tag 创建或更新应用版本
- 读取 release 对应 commit 的 `app.manifest.json`
- 展示 release 状态流转和 latest released
- 展示 manifest 内容版本 `manifest_seq`
- 显示权限覆盖 warning，但不强制阻断发布

模块：

- release 列表：`release_version / status / source_tag / source_commit_sha / manifest_seq / released_at`
- 状态动作：`draft / permissions_pending / ready / released / deprecated`
- GitLab 导入入口：release/tag、manifest path
- 权限覆盖提示：未被平台系统角色覆盖且 `requires_grant=1` 的 action
- manifest 历史：hash、资源数、动作数、导入时间

### 8.5 资源发现

目标：

- 展示应用当前 released manifest 或最新 manifest 的资源/action 快照
- 支持平台侧从 release 导入 manifest
- 显示版本历史和最近一次注册结果

模块：

- 当前 release / manifest_seq
- 资源树
- 资源动作统计
- 注册历史
- 手动触发 GitLab release 导入

### 8.6 平台角色

目标：

- 在平台侧为每个应用建立标准角色

例如 `AIMS`：

- `aims:member`
- `aims:pm`
- `aims:admin`

页面上应支持：

- 新建平台级应用角色
- 选择资源动作
- 选择默认 scope

### 8.7 模板中心

目标：

- 建立面向租户复用的标准模板

例如：

- `tpl:aims_basic_member`
- `tpl:aims_pm_standard`

页面上应支持：

- 模板列表
- 模板包含哪些角色
- 模板适用场景说明

### 8.8 接入历史

展示：

- GitLab release 导入历史
- manifest_seq 内容版本历史
- 资源变化差异
- 最近注册时间
- 最近调用/接入测试结果

---

## 9. 租户台账（Admin）

### 9.1 页面定位

现在的 `/admin/tenants` 只是租户 CRUD。  
应该升级成：

`租户台账`

### 9.2 页面分层

列表页展示：

- 租户名称
- 租户编码
- 当前状态
- 默认登录模式
- 已启用应用数
- 当前开通阶段
- 当前 deployment 状态

详情页分标签：

1. 基础信息
2. 登录与身份
3. 应用订阅
4. Deployment
5. License
6. 操作日志

### 9.3 开通阶段字段

建议加一个清晰的开通阶段：

- `draft`
- `profile_completed`
- `apps_selected`
- `license_ready`
- `deployment_configured`
- `connectivity_verified`
- `active`

这样平台管理员和租户都能知道“当前卡在哪一步”。

---

## 10. 订阅与授权中心（Admin）

### 10.1 为什么必须独立出来

租户与应用的关系，不应该藏在应用页或租户页的小字段里。  
必须有独立的：

`订阅与授权中心`

它是连接三者的中枢：

- 租户
- 应用
- license / capability / 启用状态

### 10.2 页面结构

建议一条订阅记录至少包含：

- tenant
- app
- subscription status
- chosen edition / plan
- capability profile
- deployment binding
- enablement status

### 10.3 页面功能

- 为租户选择启用应用
- 查看租户当前启用的应用列表
- 生成或关联 license
- 查看 capability 配置
- 进入部署配置与连通性测试

这个页面本质上是“租户启用应用的总入口”。

---

## 11. Tenant Onboarding 设计

### 11.1 为什么要单独做 Onboarding

用户注册成功后，不应该直接扔进 `/dashboard`。  
因为这时租户通常还没完成：

- 基础资料
- 登录模式
- 应用选择
- 订阅关系
- deployment 配置
- 连通性测试

所以建议单独有：

- `/dashboard/onboarding`

### 11.2 Onboarding 步骤

建议按 6 步走：

1. 创建租户
2. 配置基础信息
3. 配置登录模式
4. 选择启用应用
5. 确认订阅与商务信息
6. 配置 deployment 并测试连通性

完成后才进入正式 dashboard。

### 11.3 每一步页面设计

#### Step 1：创建租户

- 租户名称
- 公司/团队简称
- 联系人
- 联系方式

#### Step 2：基础信息

- 展示名称
- 域名/主域
- 时区
- 地区

#### Step 3：登录模式

- GitLab OIDC
- OIDC
- CAS
- 企业微信
- LDAP（后续）

并根据模式展示对应的配置表单。

#### Step 4：选择应用

展示平台已开放的应用目录：

- `AIMS`
- `Codocs`
- ...

每个应用卡片展示：

- 名称
- 功能简介
- 依赖前提
- 当前状态

用户勾选要启用的应用后，系统创建订阅草稿。

#### Step 5：订阅与商务信息

第一版可以不做支付，但页面要预留：

- 选择方案
- 录入商务联系人
- 录入付款信息（占位）
- 验证完成状态

#### Step 6：Deployment 与测试

每个应用都要展示：

- 部署模式
- deploymentCode
- endpoint
- callback / webhook / client 信息
- heartbeat 状态

动作：

- 保存 deployment 信息
- 发起连通性测试
- 查看测试结果

通过后租户进入 `active`。

---

## 12. Tenant Dashboard 设计

### 12.1 Dashboard 的定位

`dashboard` 应该是“租户已经启用后”的正式管理台，不是开通向导。

### 12.2 Dashboard 信息架构

建议菜单：

- 概览
- 应用中心
- 用户管理
- 主体目录
- 角色管理
- 模板管理
- 订阅与授权
- Deployment
- 登录与身份
- 设置

### 12.3 Dashboard 首页

首页要回答 4 个问题：

1. 当前租户已启用哪些应用
2. 哪些应用仍待完成 deployment 或连通性
3. 当前租户 IAM 是否配置完成
4. 是否存在风险项

建议首页卡片：

- 已启用应用
- 待配置应用
- 当前管理员数量
- 角色/模板数量
- 最近连通性结果
- heartbeat 异常

### 12.4 应用中心（租户侧）

租户侧应用中心不应该再管理应用台账，而是管理：

- 当前租户已订阅/已启用哪些应用
- 每个应用的 deployment 状态
- 每个应用的 capability
- 进入该应用的入口

页面建议按“应用卡片 + 状态标签”展示。

每个应用卡片展示：

- 应用名称
- 当前启用状态
- 当前 deployment 状态
- 最近连通性测试结果
- 进入应用
- 进入配置

### 12.5 用户 / 主体 / 角色 / 模板

这部分继续沿用当前已开始落的 `dashboard` 结构，但要从“CRUD 页”升级成“场景页”：

- 用户页：
  - 当前管理员
  - 未完成身份绑定用户
  - 最近登录用户

- 主体页：
  - 用户主体
  - 部门主体
  - 岗位主体
  - 身份映射状态

- 角色页：
  - 角色元数据
  - 权限矩阵
  - scope

- 模板页：
  - 模板元数据
  - 模板角色组合
  - 后续模板绑定与例外覆盖

---

## 13. 先做什么，不做什么

### 13.1 第一阶段必须做

1. Landing 正式化
2. `admin` 从“入口页”升级成平台运营工作台
3. `/admin/applications` 升级成应用台账
4. `/admin/tenants` 升级成租户台账
5. 新增 `订阅与授权中心`
6. 新增 `/dashboard/onboarding`
7. `dashboard` 增加“应用中心”

### 13.2 第一阶段可先占位

- 付款信息
- 正式支付
- 自动部署
- 安装器
- 深度 BI 审计

### 13.3 第一阶段不要继续跑偏的点

- 不要再把“租户启用应用”塞进应用台账页
- 不要再让 `dashboard` 通过手输 `tenantCode` 作为长期方案
- 不要再把 admin 页做成纯技术配置页集合

---

## 14. 对当前前端实现的直接调整建议

### 14.1 `/admin`

当前是“模块卡片入口页”。  
建议改成：

- 平台运营概览
- 待处理事项
- 快速进入台账和订阅中心

### 14.2 `/admin/applications`

当前页面要升级成：

- 应用台账详情页
- 支持 tabs：
  - 基础信息
  - 资源发现
  - 平台角色
  - 模板中心
  - 接入历史

### 14.3 `/admin/tenants`

当前页面要升级成：

- 租户台账
- 支持查看租户当前处于哪个开通阶段
- 能直接看到该租户已选应用与 deployment 状态

### 14.4 `/dashboard`

当前首页仍然偏“请先输入 tenantCode”。  
应该逐步改成：

- 当前租户概览
- 已启用应用
- 待完成配置
- 快捷入口

### 14.5 `/dashboard/users / subjects / roles / templates`

这些页方向没问题，但要统一到“租户启用后正式管理”的语义中，而不是单纯 CRUD。

---

## 15. 建议新增页面清单

### 15.1 Admin 新增

- `/admin/subscriptions`
- `/admin/runtime`
- `/admin/system-roles`
- `/admin/system-templates`

### 15.2 Dashboard 新增

- `/dashboard/onboarding`
- `/dashboard/applications`
- `/dashboard/subscriptions`
- `/dashboard/auth-settings`

---

## 16. 一句话结论

`platform` 前端下一步不应继续围绕“把每张表做成页面”推进，而应转成“围绕应用台账、租户开通、订阅授权、部署启用”四条业务链路重构控制台。`

也就是：

- `admin` 负责平台铺底与台账治理
- `dashboard/onboarding` 负责租户开通
- `dashboard` 负责租户正式管理
- `应用台账` 与 `订阅授权` 明确分离

这才是能真正支撑 `AIMS` 先纳管、再逐步纳管 `Codocs` 和其他应用的产品形态。
