# hzy_platform 绿地建设方案

## 1. 文档目标

本文档用于明确：在现有 `account` 已经承担现网职责、`codocs` 已上线、`AIMS` 正在筹备的背景下，为什么平台控制面应采用绿地建设方式重建，以及第一阶段如何落地。

本方案的核心目标不是“替换全部旧系统”，而是：

- 新建一套面向 SaaS 平台的 `hzy_platform`
- 让 `AIMS` 成为首个接入新平台的应用
- 让 `codocs` 在新平台稳定后再兼容接入
- 让 `account` 停止继续承接新的平台核心能力

---

## 2. 为什么要绿地建设

继续在现有 `account` 上演进平台控制面，存在以下根本问题。

### 2.1 `account` 已经是现网系统

当前 `account` 已经承担：

- 用户与角色管理
- 应用与资源管理
- 部分权限管理能力
- 已上线应用的依赖入口

这意味着它不是一个适合大幅重塑数据模型和协议边界的空白系统。

### 2.2 目标已经不是“账号模块升级”

当前要建设的内容已经超出传统账号系统范围，实际是在构建：

- Identity Plane
- Control Plane
- App Registry
- Role / Template / Scope 授权系统
- License / Capability
- Policy Bundle / Revocation / Heartbeat

这在职责上已经不是 `account`，而是一套平台内核。

### 2.3 继续在 `account` 上改会不断背兼容包袱

如果继续沿着现有库和接口演进，会持续出现：

- 历史表语义与新模型混杂
- 新老接口双语义并存
- 对 `codocs` 等现网模块的回归风险
- 平台命名和职责越来越不清晰

### 2.4 `AIMS` 是理想试点，`Codocs` 不是

`AIMS` 还没有完全固化，适合作为新平台的首个接入应用。  
`Codocs` 已上线，更适合在平台稳定后做兼容接入，而不适合做底层平台模型试验。

---

## 3. 目标判断

建议正式采用以下目标判断：

### 3.1 新建 `hzy_platform`

新建一套新的平台数据库和平台应用，用于承接：

- 平台身份认证
- 应用注册
- 角色、模板、scope
- 平台 token 与 OIDC 能力
- deployment / license / capability
- policy bundle / revocation / heartbeat

### 3.2 `account` 进入冻结态

`account` 后续原则上只做：

- 现网兼容
- 旧后台维持运行
- 必要 bugfix

不再继续承接新的平台控制面模型。

### 3.3 `AIMS` 作为新平台首个接入应用

`AIMS` 第一阶段直接接入 `hzy_platform`，不再以 `account` 作为未来平台能力的宿主。

### 3.4 `Codocs` 作为后续兼容接入对象

待 `hzy_platform + foundation + AIMS` 跑通后，再让 `Codocs` 做协议兼容接入。

---

## 4. 新平台的职责边界

第一阶段的 `hzy_platform` 应明确只做平台底座，不做业务应用本身。

### 4.1 `hzy_platform` 负责

- Identity Plane
- Control Plane API
- 平台管理后台
- 应用注册与 manifest
- 角色/模板/scope
- deployment / license / capability
- policy bundle / revocation / heartbeat

### 4.2 `foundation` 负责

- 平台 SDK / Layer
- token 验签
- bundle 消费
- revocation 校验
- 统一 `checkPermission()`
- 菜单过滤
- 路由守卫
- 服务端鉴权封装

### 4.3 `AIMS` 负责

- 业务功能
- 项目级 scope resolver
- 本地业务规则
- 项目成员角色

### 4.4 `Codocs` 负责

- 现网稳定
- 后续通过 `foundation` 和平台 token 做兼容接入

### 4.5 `account` 负责

- 现有系统兼容
- 旧管理入口过渡
- 不再演进为未来平台主内核

---

## 5. 新平台第一阶段目标

第一阶段的目标不是做完整 SaaS 平台，而是先做出“可用的平台最小内核”。

建议第一阶段只包含以下能力：

### 5.1 身份认证

- 支持上游身份源接入
- 支持平台 token
- 支持 OIDC-first 对下输出

### 5.2 应用注册

- 应用注册
- manifest 存储与版本管理
- 应用 capability 识别

### 5.3 授权系统

- 角色
- 模板
- 模板绑定
- 模板覆盖
- role scopes

### 5.4 runtime 控制链

- deployments
- licenses
- capabilities
- policy bundles
- revocation snapshots
- deployment heartbeats

### 5.5 平台管理后台最小闭环

- 登录后平台管理界面
- 应用管理
- 角色与模板管理
- 基础审计能力

---

## 6. 新平台第一阶段不做什么

为了避免范围失控，第一阶段应明确不做以下内容：

- 不重做 `codocs`
- 不替换所有现网应用
- 不追求复杂计费与运营分析
- 不做全量 BI/报表平台
- 不做多语言 SDK
- 不做浏览器侧完整 identity SDK
- 不做复杂 ABAC / DSL 规则引擎
- 不做完全自动化租户迁移

---

## 7. 推荐系统拆分

建议将绿地建设后的系统拆分为以下几个部分。

## 7.1 `hzy_platform` 数据库

作为平台主库，承载：

- subjects
- subject_identities
- roles
- permission_templates
- template_bindings
- role_scopes
- applications
- app_manifests
- deployments
- licenses
- policy_bundles
- revocation_snapshots
- deployment_heartbeats

## 7.2 `hzy_platform` 应用

作为平台管理应用，承载：

- 平台后台页面
- Control Plane API
- Identity Plane API
- 应用注册 API
- runtime 管理 API

## 7.3 `foundation`

继续作为共享层，但从现在开始以“平台 SDK / Layer”作为主方向。

## 7.4 `AIMS`

作为新平台第一个正式接入应用。

## 7.5 `account`

不再作为未来平台内核，仅作为旧系统保留与过渡。

---

## 8. 数据与迁移策略

绿地建设并不等于立即迁移全部历史数据。

第一阶段建议采用：

### 8.1 新平台自建主数据

新平台自己建立：

- 应用注册数据
- 新角色/模板/scope 数据
- deployment / license / bundle 数据

### 8.2 身份侧按需映射

用户和组织数据不要求第一阶段完全迁移。  
可先通过最小主体目录和身份映射承接运行所需数据。

### 8.3 不先迁移旧权限全量数据

`account` 里的旧角色和旧授权，不要求第一阶段完整搬迁到新平台。  
`AIMS` 可以直接使用新平台的新角色字典和新授权模型。

### 8.4 `Codocs` 后续通过兼容方式逐步接入

等 `Codocs` 真正要切平台协议时，再做必要的映射与接入，不提前大迁移。

---

## 9. 与 AIMS 的关系

`AIMS` 是新平台第一阶段是否成立的关键验证对象。

### 9.1 AIMS 第一阶段要验证的不是业务功能，而是平台链路

重点验证：

- 平台 token
- foundation SDK
- app manifest
- 应用级权限
- 项目级 scope resolver
- 服务端统一授权入口

### 9.2 AIMS 成功的意义

只要 `AIMS` 跑通，说明以下链路成立：

- 平台能对 app 输出统一身份协议
- 平台能对 app 输出可消费的授权结果
- foundation 能作为真实接入层使用
- 平台权限与业务上下文可以正常协作

这比在 `account` 上继续抽象讨论更有价值。

---

## 10. 与 Codocs 的关系

`Codocs` 在绿地方案中不承担试验责任，而承担兼容验证责任。

### 10.1 第一阶段不动 Codocs 内部权限核心

不重写其内部协作权限、对象权限、历史文档规则。

### 10.2 第二阶段让 Codocs 兼容平台协议

后续重点是：

- 平台 token
- foundation 最小鉴权接入
- 最小 manifest
- 外层统一授权包装

### 10.3 这样做的好处

- 不影响现网
- 不阻塞平台建设
- 不让平台底座被历史应用拖住

---

## 11. 第一阶段实施步骤

建议按以下顺序推进。

### Step 1：初始化 `hzy_platform` 仓库与数据库

输出：

- 新数据库 schema
- 新平台应用骨架
- 基础部署方式

### Step 2：实现最小 Identity Plane

输出：

- 上游身份接入
- 平台 token
- JWKS
- refresh / logout

### Step 3：实现最小 Control Plane API

输出：

- app registry
- manifest 管理
- policy bundle 查询
- revocation 查询
- heartbeat 上报

### Step 4：实现最小授权模型

输出：

- roles
- templates
- bindings
- overrides
- role scopes

### Step 5：让 foundation 接 hzy_platform

输出：

- token 验签
- bundle 消费
- 统一 `checkPermission()`
- 路由/菜单/服务端鉴权封装

### Step 6：让 AIMS 成为首个接入应用

输出：

- AIMS manifest
- AIMS token 接入
- AIMS app permission
- AIMS project scope resolver

### Step 7：平台稳定后，再规划 Codocs 接入

输出：

- Codocs 兼容接入计划
- 平滑切换策略

---

## 12. 第一阶段验收标准

绿地方案第一阶段完成后，应满足以下标准：

### 12.1 平台侧

- `hzy_platform` 可独立运行
- 平台具备最小 Identity Plane 和 Control Plane API
- 平台具备角色/模板/scope 管理能力

### 12.2 foundation 侧

- foundation 已能稳定消费新平台 token 与 bundle
- foundation 已能为应用提供统一鉴权能力

### 12.3 AIMS 侧

- `AIMS` 已不再依赖旧 `account` 作为未来平台能力宿主
- `AIMS` 已跑通完整登录与授权链路

### 12.4 account / Codocs 侧

- `account` 现网不受影响
- `Codocs` 现网不受影响
- 平台建设不依赖对现网系统做高风险改造

---

## 13. 风险与控制

### 13.1 范围失控

风险：绿地建设容易被理解成“重做整个平台”。  
控制：第一阶段只做平台最小内核 + AIMS 接入。

### 13.2 account 和 hzy_platform 双轨混乱

风险：两边都继续长新能力。  
控制：明确 `account` 冻结，未来平台能力只进 `hzy_platform`。

### 13.3 foundation 没有及时转向平台 SDK

风险：新平台建好了，但应用接不进去。  
控制：foundation 从第一阶段起就同步跟进。

### 13.4 AIMS 没有真正按新平台跑

风险：新平台只停留在后台和文档层。  
控制：AIMS 必须作为第一批真实消费端。

---

## 14. 推荐下一步

如果正式采用绿地方案，建议下一步直接启动以下三项：

1. 输出 `hzy_platform` 第一版 schema 草案  
2. 输出 `hzy_platform` 第一版 API 草案  
3. 输出 `AIMS -> hzy_platform` 的最小接入任务清单

---

## 15. 结论

对于当前阶段，最合理的路径不是继续把 SaaS 平台能力堆进现有 `account`，而是新建一套 `hzy_platform`。

这套新平台应：

- 独立承担平台控制面职责
- 先服务 `AIMS`
- 暂不打扰 `Codocs`
- 让 `foundation` 成为新平台真正的应用接入层

只要 `hzy_platform + foundation + AIMS` 先跑通，后续 `Codocs` 和其他应用接入就会顺很多。
