# 平台角色权限设计

本文定义汇智云平台的两层角色模型、应用权限口径、企业角色预置方案和审批权限规则，用于后续数据迁移、种子数据、管理后台和运行时鉴权落地。

本文是业务和技术口径说明；当前配套落地 SQL 见 `docs/HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql`。

## 1. 设计目标

汇智云的权限模型分为两层：

| 层次 | 业务定位 | 示例 | 管理入口 |
| --- | --- | --- | --- |
| 应用角色 | 某个应用内的一组标准能力包 | `codocs:editor`、`aims:pm`、`finance:manager` | 平台应用权限角色 |
| 企业角色 | 企业中的岗位、职责或管理身份 | 系统管理员、总经理、销售总监、项目经理 | 平台企业角色 / 企业自定义角色 |

设计目标：

- 用户主要被授予企业角色，而不是直接面对大量应用角色。
- 应用角色只表达“在某应用里能做什么”，不表达企业岗位。
- 企业角色表达真实企业岗位，并通过映射获得多个应用角色。
- 全员基础权限由平台自动授予有效员工，不要求企业管理员重复配置。
- 审批权限由组织关系、流程节点、专业应用角色共同决定。
- 租户可以继承平台预置企业角色，也可以创建自定义企业角色。

## 2. 核心规则

### 2.1 应用角色

应用角色是应用内权限的最小业务能力包，来源于应用 manifest。

应用角色应满足：

- 编码使用 `app_code:role_key`，例如 `altoc:sales`。
- 只覆盖该应用内资源和动作。
- 不使用“总经理”“销售总监”这类企业岗位命名。
- 可以被多个企业角色复用。
- 应由平台和应用团队维护，租户原则上不修改平台母版。

应用权限使用三元组表达：

```text
app_code : resource_code : action
```

示例：

```text
codocs:reviews:approve
finance:expenses:approve
aims:projects:admin
```

### 2.2 企业角色

企业角色是用户可理解、可分配的业务角色。

企业角色应满足：

- 表达企业岗位或职责，例如“销售总监”“部门经理”“档案管理员”。
- 通过应用角色获得标准应用权限。
- 通过数据范围控制能看哪些部门、项目、人员或业务对象。
- 通过流程规则控制是否进入审批节点。
- 平台预置角色只提供默认模板，企业可以继承后调整。

企业角色不应膨胀为每个应用角色的副本。例如不需要创建“Codocs 编辑员企业角色”，这应保留为应用角色，由企业角色组合引用。

### 2.3 租户自定义

推荐落地边界：

- `platform_app_roles`：平台应用角色母版。
- `platform_system_roles`：平台预置企业角色母版。
- `platform_system_app_role_maps`：平台企业角色默认包含哪些应用角色。
- `tenant_roles`：租户继承的平台企业角色和租户自定义企业角色。
- `tenant_role_app_role_maps`：租户企业角色包含的应用角色。
- `tenant_role_permissions`：租户企业角色的少量补充或例外权限。

原则上，租户角色的常规权限应来自应用角色映射，不应把所有继承权限展开写入 `tenant_role_permissions`。

### 2.4 全员基础权限

全员基础权限是所有有效员工登录后自动具备的最低权限，不属于企业角色，也不应要求企业管理员在角色管理中重复配置。

权限计算顺序：

```text
有效员工登录
  -> 自动获得全员基础权限
  -> 叠加企业角色权限
  -> 叠加显式授权 / 例外权限
```

全员基础权限应满足：

- 只面向租户内有效员工，默认不授予外部协作方、服务账号、停用账号。
- 只覆盖本人、被分配、被分享、被流程节点命中的对象。
- 不授予全公司、部门、项目、财务、合同等管理性范围。
- 不作为 `tenant_roles` 中的普通企业角色暴露。
- 可以进入 policy bundle 的 `baseline` 或等价结构，由运行时统一叠加。

推荐全员基础权限：

| 应用 | 默认能力 | 范围 |
| --- | --- | --- |
| `console` | 查看本人资料、本人组织归属、企业基础信息、应用工作台 | 本人 / 当前租户基础信息 |
| `workflow` | 查看本人待办、已办、我发起的流程；处理分配给自己的审批任务 | 本人 / 被分配任务 |
| `codocs` | 创建和编辑个人文档；查看被分享或被授权的文档 | 本人文档 / 被分享文档 |
| `aims` | 查看自己参与的项目、任务和通知 | 本人参与项目 |
| `finance` | 后续 `finance:expense_submitter` 上线后，发起本人报销、费用或付款申请 | 本人申请 |
| `people` | 后续 `people:employee` 或员工自助能力上线后，查看和维护本人信息、发起本人相关人事流程 | 本人信息 |

不建议默认开放：

| 应用 | 原因 |
| --- | --- |
| `altoc` | 客户、商机、报价、合同属于销售或商务职责，应由企业角色授予 |
| `assets` | 实物资产、资源资产和资产操作必须通过显式企业角色、应用角色或授权模板授予 |
| `insights` | 代码和研发效能数据通常按研发、项目或管理职责开放 |
| `finance` 管理视图 | 财务数据敏感，应通过财务角色授予 |

Assets 不进入全员基础权限，避免 scope 尚未在业务 API 中强制解释时把本人资产权限放大为资产台账和资产操作权限。

普通员工企业角色可以保留为平台预置岗位模板，但不承载系统运行必需的基础权限。企业如果不需要额外业务权限，可以不显式给所有人分配“普通员工”企业角色。

## 3. 可配置应用范围

### 3.1 纳入角色权限治理的应用

当前应纳入企业角色配置的应用：

| 应用 | app_code | 说明 |
| --- | --- | --- |
| 汇智云控制台 | `console` | 企业资料、目录、系统参数、集成、凭证、服务配置 |
| 汇智云流程 | `workflow` | 流程定义、表单、路由、审批任务和实例 |
| 汇智云文档 | `codocs` | 协作文档、知识库、审阅、发布、归档 |
| 汇智云项目 | `aims` | 项目、工作项、工时、看板、项目模板 |
| 汇智云经营 | `altoc` | 客户、线索、商机、报价、合同、回款 |
| 汇智云资产 | `assets` | 资产、采购、供应商、入库、领用、报表 |
| 汇智云财务 | `finance` | 发票、收款、费用、核销、项目核算、报表 |
| 汇智云洞察 | `insights` | 代码仓库、采集、研发效能、异常监控 |

### 3.2 不纳入人员角色配置的服务

`collab` 是协作运行时服务，不是企业用户直接操作的业务应用。

当前规则：

- 不在企业角色中配置 `collab:*`。
- 不在租户角色管理页面暴露 `collab` 应用角色。
- 如需服务间调用或运行配置，应通过服务账号、内部 scope、Console runtime 或运维配置处理。
- 只有未来出现独立协作服务管理界面时，才重新定义 `collab:admin`、`collab:operator`、`collab:viewer`。

## 4. 审批权限规则

审批权限不是一个独立角色，而是下面三类规则的组合：

```text
能否审批 = 审批节点命中该用户
        + 节点要求的专业应用角色校验
        + 数据范围 / 金额 / 组织范围校验
```

### 4.1 组织关系授权

审批流中的组织关系节点默认具有该节点赋予的审核权限，不需要额外配置应用角色。

典型节点：

- 部门负责人
- 上级部门负责人
- 分管领导
- 项目负责人

例如流程节点配置为“部门负责人审批”，系统根据组织架构解析出对应负责人。只要该用户被流程节点命中，就可以处理该节点。

当前目录模型支持部门负责人、分管领导和项目负责人，不支持员工级“直接上级”关系。审批流当前不应依赖“直接上级审批”节点；如企业需要直属汇报线审批，应后续在 People 或目录模型中补充 `reports_to` / `supervisor_uid` 一类员工汇报关系。

需要区分企业角色和组织关系：

| 概念 | 类型 | 管理位置 | 用途 |
| --- | --- | --- | --- |
| 部门经理 | 企业角色 | 企业角色管理 / 用户授权 | 授予部门管理相关应用权限，并可绑定部门范围 |
| 部门负责人 | 组织关系 | 组织结构设置中的 `manager_uid` | Workflow 审批节点和组织关系解析 |
| 项目经理 | 企业角色 | 企业角色管理 / 用户授权 | 授予项目管理相关应用权限，并可绑定项目范围 |
| 项目负责人 | 项目关系 | 项目设置中的 `leader_uid` | 项目归属、项目负责人审批节点和项目关系解析 |

企业可以把同一个人同时设置为“部门负责人”并授予“部门经理”企业角色，但系统不应强制二者总是绑定。项目经理与项目负责人同理。

### 4.2 专业应用角色授权

专业审核需要应用角色支撑。

典型节点：

| 审核类型 | 推荐应用角色 |
| --- | --- |
| 流程任务处理 | `workflow:approver` |
| 流程配置设计 | `workflow:designer` |
| 文档发布审阅 | `codocs:publisher` |
| 费用审批 | `finance:expense_approver` |
| 合同/报价审批 | `altoc:contract_approver` |
| 资产审批 | `assets:asset_approver` |
| 项目审批 | `aims:project_approver` |
| 人事审批 | People 上线后由 `people:admin` 承担首版管理能力；后续可细分 `people:manager` / `people:specialist` / `people:approver` |

拥有专业应用角色不代表可以审核所有单据。流程节点仍然必须命中该用户。

档案管理员与 `codocs:publisher` 是不同职责：`codocs:publisher` 面向文档发布审阅，档案管理员面向企业档案、合同档案、项目档案、人事档案等档案治理。当前不调整 `codocs:publisher` 命名。

### 4.3 流程实例固化

审批实例创建后，应记录当时解析出的审批人、企业角色、组织关系和匹配规则，避免后续角色调整影响历史单据。

## 5. 应用资源与应用角色

### 5.1 Console 控制台

资源范围：

| 资源 | 动作 |
| --- | --- |
| 概览 | `view` |
| 企业资料、目录用户、目录部门、项目注册表、目录源配置、目录同步 | `view`、`edit`、`admin` |
| 系统参数、集成中心、凭证库、服务凭证 | `view`、`edit`、`admin` |
| 协作运行时状态 | `view`、`admin`，仅 Console 管理入口使用 |

应用角色：

| 应用角色 | 说明 |
| --- | --- |
| `console:viewer` | 查看企业控制台配置和状态 |
| `console:operator` | 维护系统参数、集成配置、服务凭证和目录基础数据 |
| `console:directory_manager` | 管理用户、部门、项目、目录源和同步任务 |
| `console:security_admin` | 管理集成、凭证库、服务凭证和安全相关参数 |
| `console:admin` | 管理企业控制台全部资源 |

### 5.2 Workflow 流程

资源范围：

| 资源 | 动作 |
| --- | --- |
| 工作台 | `view` |
| 审批任务、流程实例、流程定义、表单定义、审批业务、路由规则 | `view`、`edit`、`admin` |

应用角色：

| 应用角色 | 说明 |
| --- | --- |
| `workflow:viewer` | 查看审批工作台、任务、实例和流程配置 |
| `workflow:approver` | 处理被流程节点分配给自己的审批任务 |
| `workflow:designer` | 维护流程定义、表单定义、审批业务和路由规则 |
| `workflow:admin` | 管理流程引擎全部资源和审批配置 |

`workflow:operator` 不再作为推荐应用角色使用；历史数据迁移时应拆分为 `workflow:approver` 和 `workflow:designer`，具体归属由原角色使用场景决定。

### 5.3 Codocs 文档

资源范围：

| 资源 | 动作 |
| --- | --- |
| 文档中心 | `view`、`create`、`edit`、`delete`、`admin` |
| 项目文档、部门文档 | `view`、`create`、`edit`、`admin` |
| 组织资产 | `view`、`create`、`edit`、`publish`、`admin` |
| 审阅中心 | `view`、`submit`、`approve`、`archive`、`admin` |
| 资讯中心 | `view`、`edit`、`admin` |
| 系统管理 | `view`、`admin` |

应用角色：

| 应用角色 | 说明 |
| --- | --- |
| `codocs:viewer` | 查看被授权的文档资源 |
| `codocs:editor` | 创建、编辑被授权范围内的文档 |
| `codocs:publisher` | 处理组织资产发布、审阅和归档 |
| `codocs:admin` | 管理 Codocs 配置、模板、发文流程和全局文档能力 |

### 5.4 AIMS 项目

资源范围：

| 资源 | 动作 |
| --- | --- |
| 工作台、通知 | `view` |
| 项目组合、项目模板 | `view`、`edit`、`admin` |
| 项目 | `view`、`create`、`edit`、`close`、`admin` |
| 工作项 | `view`、`create`、`edit`、`delete`、`assign` |
| 看板 | `view`、`edit` |
| 工时 | `view`、`submit`、`approve`、`admin` |
| 报表 | `view`、`export` |

应用角色：

| 应用角色 | 说明 |
| --- | --- |
| `aims:viewer` | 查看分配给自己的项目和工作项 |
| `aims:dev` | 执行任务、提交工时、参与看板流转。展示名称建议改为“项目成员” |
| `aims:pm` | 管理项目、迭代、人员和工时审核 |
| `aims:project_approver` | 处理立项、项目变更、验收、重大里程碑等项目审批 |
| `aims:admin` | 管理 AIMS 全局配置和项目模板 |

### 5.5 Altoc 经营

资源范围：

| 资源 | 动作 |
| --- | --- |
| 经营驾驶舱 | `view`、`export` |
| 客户、线索、商机 | `view`、`edit`、`admin` |
| 报价、合同 | `view`、`edit`、`approve`、`admin` |
| 回款 | `view`、`edit`、`confirm`、`admin` |
| 经营设置、系统管理 | `view`、`edit`、`admin` |

应用角色：

| 应用角色 | 说明 |
| --- | --- |
| `altoc:viewer` | 查看与自己相关的客户、商机、合同和回款 |
| `altoc:sales` | 维护客户、线索、商机、报价和招投标过程 |
| `altoc:contract_manager` | 管理合同和回款，推进签订和履约跟踪 |
| `altoc:contract_approver` | 审批报价、合同、折扣、商务条款和关键回款节点 |
| `altoc:admin` | 管理经营模块全部配置和历史数据 |

### 5.6 Assets 资产

资源范围：

| 资源 | 动作 |
| --- | --- |
| 工作台 | `view` |
| 资产台账、产品资产、知识产权资产、数字资产、技术底座、环境视图、客户交付视图、供应商台账、采购单、入库激活、资产操作、预警中心 | `view`、`edit`、`admin` |
| 报表统计、系统管理 | `view`、`admin` |

应用角色：

| 应用角色 | 说明 |
| --- | --- |
| `assets:viewer` | 查看被授权范围内的资产、环境、交付、采购、预警和报表 |
| `assets:employee` | 查看本人相关资产，发起领用、归还、释放等资产操作 |
| `assets:owner` | 管理本部门或项目相关资产、采购申请、环境交付视图和预警闭环 |
| `assets:procurement` | 维护供应商、采购单、入库激活、资产台账和资产操作闭环 |
| `assets:asset_approver` | 审批资产采购、领用、调拨、报废和关键资产变更 |
| `assets:finance` | 查看采购金额、成本归因、客户交付成本和资产报表 |
| `assets:admin` | 管理 Assets 全部资产资源、采购、预警、报表和系统配置 |

### 5.7 Finance 财务

资源范围：

| 资源 | 动作 |
| --- | --- |
| 财务工作台、财务报表 | `view`、`export` |
| 发票、费用支出 | `view`、`edit`、`approve`、`admin` |
| 收款、核销 | `view`、`edit`、`confirm`、`admin` |
| 银行账户、项目核算、绩效金额财务口径、财务设置 | `view`、`edit`、`admin` |

应用角色：

| 应用角色 | 说明 |
| --- | --- |
| `finance:viewer` | 查看被授权范围内的发票、收款、支出、项目核算和报表 |
| `finance:accountant` | 维护发票、收款、核销、支出和银行账户台账 |
| `finance:expense_approver` | 审批费用报销、项目支出和付款申请 |
| `finance:manager` | 管理财务台账、核销、项目核算、绩效金额财务口径和财务报表 |
| `finance:admin` | 管理 Finance 模块全部配置、权限和集成参数 |

后续建议新增 `finance:expense_submitter`，用于普通员工提交费用、报销和付款申请。

### 5.8 Insights 洞察

资源范围：

| 资源 | 动作 |
| --- | --- |
| 工作台、提交、部门视图 | `view` |
| 代码仓库、贡献者、异常监控、Insights 配置 | `view`、`edit`、`admin` 或对应维护动作 |
| 数据采集 | `view`、`trigger`、`admin` |
| 效能看板 | `view`、`export` |

应用角色：

| 应用角色 | 说明 |
| --- | --- |
| `insights:viewer` | 查看研发效能看板和仓库统计 |
| `insights:analyst` | 查看、导出报表，并维护贡献者归并 |
| `insights:admin` | 管理仓库源、采集任务、监控规则和全局配置 |

## 6. 平台预置企业角色

平台预置企业角色建议控制在常见企业岗位范围内。权限边界不清晰的“只读审计员”“外部协作方”不做平台预置，由企业自定义。

| 企业角色 | 定位 | 默认应用角色 |
| --- | --- | --- |
| 系统管理员 | 企业平台最高管理员，具备全部管理权限 | `console:admin`、`workflow:admin`、`codocs:admin`、`aims:admin`、`altoc:admin`、`assets:admin`、`finance:admin`、`insights:admin`、`people:admin` |
| 总经理 | 企业经营决策者，查看全局经营、项目、财务、资产、档案和研发效能 | `console:viewer`、`workflow:viewer`、`codocs:viewer`、`aims:viewer`、`altoc:viewer`、`assets:viewer`、`finance:viewer`、`insights:viewer` |
| 副总经理 | 分管业务线高管，默认具备全局查看，按分管方向叠加管理权限 | 基础同总经理；按销售、项目、财务、运营方向增加对应应用角色 |
| 销售总监 | 销售经营负责人，管理客户、商机、报价和销售过程 | `altoc:admin`、`altoc:contract_approver`、`finance:viewer`、`codocs:viewer`、`workflow:approver` |
| 商务总监 | 商务负责人，管理报价、合同、商务条款、履约和回款协同 | `altoc:contract_manager`、`altoc:contract_approver`、`finance:viewer`、`codocs:viewer`、`workflow:approver` |
| 销售经理 | 销售团队负责人，管理销售过程和合同推进 | `altoc:sales`、`altoc:contract_manager`、`codocs:editor`、`workflow:approver` |
| 销售专员 | 一线销售人员，维护客户、线索、商机和报价 | `altoc:sales`、`codocs:editor`、`workflow:viewer` |
| 项目总监 | 多项目交付负责人，负责项目组合、交付质量、项目审批和资源协调 | `aims:admin`、`aims:project_approver`、`assets:owner`、`finance:viewer`、`codocs:viewer`、`workflow:approver`、`insights:analyst` |
| 项目经理 | 单项目管理负责人，管理项目计划、任务、成员、工时和项目资产 | `aims:pm`、`assets:owner`、`codocs:editor`、`workflow:approver`、`finance:viewer`、`insights:viewer` |
| 项目成员 | 研发、实施、交付成员，执行任务和协作文档 | `aims:dev`、`codocs:editor`、`assets:employee`、`workflow:viewer` |
| 财务总监 | 财务负责人，管理财务台账、预算、费用、核算和报表 | `finance:manager`、`finance:expense_approver`、`altoc:viewer`、`assets:finance`、`workflow:approver`、`codocs:viewer` |
| 财务会计 | 日常财务处理人员，维护发票、收款、核销和支出台账 | `finance:accountant`、`assets:finance`、`altoc:viewer`、`codocs:viewer` |
| 人力资源总监 | 人力资源体系负责人，承接组织查看、人事流程和 People 管理权限 | `console:directory_manager`、`workflow:approver`、`codocs:viewer`、`people:admin` |
| 人事专员 | 日常人事操作人员，维护员工、组织、入转调离材料和人事流程 | `console:directory_manager`、`workflow:approver`、`codocs:editor`、`people:admin` |
| 档案管理员 | 管理企业档案、合同档案、项目档案、人事档案和应用生成档案 | `codocs:admin`、`workflow:approver`；后续叠加各业务应用的档案查看和归档能力 |
| 部门经理 | 部门管理者，负责部门资产、部门费用审批、部门协同和部门范围内的业务管理 | `assets:owner`、`assets:asset_approver`、`finance:expense_approver`、`workflow:approver`、`codocs:publisher` |
| 采购/资产管理员 | 采购、入库、资产台账和供应商维护人员 | `assets:procurement`、`assets:asset_approver`、`assets:viewer`、`workflow:approver`、`finance:viewer` |
| 普通员工 | 企业基础成员的轻量岗位模板；系统必备能力由全员基础权限自动授予 | 默认不作为平台 seed 角色落库；如企业希望显式管理，可自定义角色并参考全员基础权限，后续包含 `finance:expense_submitter`、`people:employee` |

说明：

- 系统管理员和企业超级管理员合并为一个“系统管理员”。
- 部分管理权限不再预置为独立平台角色，由企业通过自定义角色实现。
- 副总经理建议保留一个基础角色，再由企业按分管方向自定义扩展。
- 部门经理是企业角色，用于授予部门管理相关应用权限；部门负责人是组织结构关系，由部门 `manager_uid` 设置，用于 Workflow 节点解析。
- 分管领导、上级部门负责人、项目负责人在审批节点中由组织关系或项目关系动态解析，不完全依赖应用角色。

## 7. 数据范围

角色只决定能力，数据范围决定对象边界。

数据范围不应主要配置在应用角色上。应用角色表达“能不能做”，数据范围表达“能对哪些对象做”。推荐落点是租户企业角色和用户角色分配上下文。

推荐数据范围：

| 范围 | 含义 | 典型角色 |
| --- | --- | --- |
| 全公司 | 可查看或管理全租户数据 | 系统管理员、总经理、财务总监 |
| 分管范围 | 可查看或管理分管业务线、部门或项目集合 | 副总经理、项目总监、销售总监、商务总监 |
| 部门 | 可查看或管理本部门及下级部门 | 部门经理、人力资源总监 |
| 项目 | 可查看或管理指定项目 | 项目经理、项目成员 |
| 本人 | 只能处理本人相关数据 | 普通员工、项目成员、资产使用人 |
| 指定对象 | 指定文档空间、客户、合同、资产或流程 | 企业自定义角色 |

数据范围不建议编码进角色名。例如不要预置“华东销售总监”，应由租户在角色绑定或 scope 中指定区域/部门范围。

### 7.1 配置边界

| 层次 | 职责 | 是否配置具体范围 |
| --- | --- | --- |
| 应用 manifest | 声明资源动作支持哪些 scope 类型，例如全公司、部门、项目、本人 | 否，只声明能力 |
| 应用角色 | 定义应用内能力包，例如查看、编辑、审批、管理 | 原则上不配置具体范围，可给默认建议 |
| 全员基础权限 | 定义有效员工默认拥有的本人、被分配、被分享能力 | 不配置具体对象，由运行时按本人和业务关系解析 |
| 平台预置企业角色 | 定义平台推荐的默认范围策略 | 只配置抽象策略，不绑定具体租户对象 |
| 租户企业角色 | 定义企业实际使用的数据范围策略 | 是，企业角色管理的主要配置点 |
| 用户角色分配 | 给某个用户绑定具体部门、项目、区域、文档空间等对象 | 是，用于精细授权 |
| Workflow 审批节点 | 根据流程节点、组织关系和业务条件解析审批人 | 运行时解析，不依赖静态角色范围 |

### 7.2 推荐落点

推荐模型：

```text
全员基础权限：自动授予本人 / 被分配 / 被分享能力
应用角色：定义能力
企业角色：定义默认范围策略
用户授权：绑定具体部门 / 项目 / 区域 / 对象
审批流程：运行时解析组织关系和节点权限
```

对应数据边界：

```text
tenant_roles
  -> tenant_role_app_role_maps
  -> tenant_role_scopes
  -> tenant_subject_roles / 角色分配上下文
```

其中：

- `tenant_role_scopes` 保存租户企业角色的默认范围策略。
- 用户获得企业角色时，可以在授权关系上绑定具体 scope 对象。
- 如果用户授权范围比企业角色默认范围更窄，应按更窄范围生效。
- 如果需要放宽范围，应通过企业角色配置或显式授权完成，并进入审计。

### 7.3 示例

企业角色默认范围：

| 企业角色 | 默认范围策略 |
| --- | --- |
| 总经理 | 全公司 |
| 财务总监 | 全公司财务 |
| 销售总监 | 分管销售部门或分管区域 |
| 商务总监 | 分管合同、报价、商务条款和回款协同范围 |
| 项目总监 | 分管项目集合 |
| 项目经理 | 所负责项目 |
| 部门经理 | 本部门及下级部门 |
| 普通员工 | 本人相关 |

用户授权上下文：

```text
张三 -> 项目经理 -> 项目 A、项目 B
李四 -> 部门经理 -> 研发一部
王五 -> 销售总监 -> 华东销售部
赵六 -> 档案管理员 -> 合同档案库、项目档案库
```

这样“项目经理”“部门经理”这类角色不需要拆成多个项目或部门角色，具体管理对象由授权上下文决定。

### 7.4 审批场景

审批流程中的“部门负责人”“上级部门负责人”“分管领导”“项目负责人”属于当前可支持的组织关系节点。它们由 Workflow 在流程运行时根据组织架构和业务对象解析，不要求这些用户额外持有静态数据范围。

“直接上级”属于员工汇报线关系，当前目录模型尚不支持，不作为默认审批节点。后续 People 如果引入员工汇报关系，可以再补充“直接上级审批”。

示例：

```text
员工提交费用报销
  -> 部门负责人审批
  -> 财务审批人审批
  -> 总经理审批
```

其中：

- 部门负责人来自组织关系。
- 财务审批人来自企业角色，例如财务经理或财务总监；`finance:expense_approver` 这类应用角色只作为企业角色背后的权限聚合来源。
- 总经理来自企业角色。
- 金额、部门、项目、业务类型决定流程路由和审批层级。

审批实例创建后，应固化当时解析出的审批人和匹配规则，避免后续组织或角色变化影响历史单据。

## 8. People 权限扩展预留

People 首版已提供 `people:viewer` 与 `people:admin`。后续如果从“人员事实与绩效基础”扩展到更完整的人事业务，可再拆分更细的应用角色：

| 应用角色 | 说明 |
| --- | --- |
| `people:manager` | 人力资源负责人，查看和管理全量人力资源数据 |
| `people:specialist` | 人事专员，处理员工档案、入转调离、合同、考勤等日常事务 |
| `people:department_manager` | 部门经理视角，查看本部门人员和审批相关信息 |
| `people:employee` | 员工自助，查看和维护个人信息、发起本人相关人事流程 |
| `people:approver` | 人事审批能力，如转正、调岗、调薪、离职等专业审批 |

这些细分角色上线后，应调整企业角色默认映射：

- 人力资源总监可由 `people:admin` 收敛为 `people:manager`。
- 人事专员可由 `people:admin` 收敛为 `people:specialist`。
- 部门经理增加 `people:department_manager`。
- 普通员工增加 `people:employee`。

## 9. 推荐落地顺序

1. 先确认当前应用角色清单和 manifest 权限动作。
2. 隐藏 `collab` 可配置角色，仅保留内部服务治理。
3. 更新应用 manifest / 应用角色 seed，补齐 `workflow:approver`、`workflow:designer`、`altoc:contract_approver`、`assets:asset_approver`、`aims:project_approver`。
4. 增加全员基础权限 baseline，并在 policy bundle / 运行时鉴权中自动叠加。
5. 调整平台预置企业角色 seed，以本文第 6 节为准；当前 SQL 文件为 `docs/HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql`。
6. 平台企业角色通过应用角色映射获得默认权限。
7. 租户启用平台企业角色时复制为 `tenant_roles`，并复制应用角色映射。
8. 租户自定义角色优先选择应用角色，只有例外权限写入高级权限。
9. Workflow 审批节点支持组织关系解析和专业应用角色校验。
10. 后续补齐 `finance:expense_submitter` 等普通员工自助类角色。

## 10. 当前落地状态

截至 2026-05-20，已完成第一轮角色权限改造落地。

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| 应用角色清单和 manifest 权限动作确认 | 已完成 | 已覆盖 `console`、`workflow`、`codocs`、`aims`、`altoc`、`assets`、`finance`、`insights`，`collab` 定位为支撑服务 |
| `collab` 可配置角色隐藏 | 已完成 | `collab/app.manifest.json` 不再声明推荐角色；平台/租户应用角色接口过滤并拒绝 `collab` 应用角色 |
| Workflow 角色拆分 | 已完成 | `workflow:operator` 已拆为 `workflow:approver` 和 `workflow:designer`；manifest 物化时会将不再声明的历史应用角色置为 inactive |
| 新增专业审批应用角色 | 已完成 | 已新增 `altoc:contract_approver`、`assets:asset_approver`、`aims:project_approver` 及对应 manifest 权限动作 |
| 全员基础权限 baseline | 已完成 | Platform policy bundle 增加 `baselinePermissions`；Codocs 默认包含个人文档、部门文档、组织资料只读、资讯只读、审阅查看/提交，项目文档不进入全员默认权限；Assets 不进入 baseline，必须通过显式企业角色、应用角色或授权模板授予；Console 管理权限不进入 baseline；迁移期遗留 `console.viewer` / `tenant_console_view*` 不再作为 Console 管理入口授权；Console、Foundation 和各业务应用运行时鉴权会对有效员工自动叠加非 Console baseline |
| 平台预置企业角色 seed | 已完成代码和 SQL 文件 | 新增 `docs/HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql`，用于 upsert 平台企业角色和默认应用角色映射 |
| 应用列表可见性 | 已完成 | Console / Foundation 用户应用列表会根据企业角色权限和非 Console baseline 权限共同计算可见应用 |
| 运行时兼容 | 已完成 | 各应用 runtime authorization 已读取 `baselinePermissions`，并继续兼容既有角色权限结构 |
| 验证 | 已完成 | manifest JSON 校验通过；`platform`、`console`、`foundation`、`aims`、`workflow`、`altoc`、`assets`、`finance`、`codocs`、`collab` typecheck 通过 |

### 10.1 数据库执行要求

数据库侧需要按以下顺序执行，才能让本轮改造在实际环境中完全生效：

1. 确认 v2.15 角色拆分迁移已完成，数据库已存在 `platform_app_roles`、`platform_system_roles`、`platform_system_app_role_maps`、`tenant_role_app_role_maps`。
2. 导入并物化最新应用 manifest，确保新增应用角色已写入 `platform_app_roles` 和 `platform_app_role_permissions`。
3. 执行 `docs/HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql`，写入平台预置企业角色和默认应用角色映射。
4. 重新生成或刷新租户 policy bundle，使 `baselinePermissions`、企业角色和应用角色映射下发到运行时。

### 10.2 已知边界

- `baselinePermissions` 已携带 `scopeType` / `scopeValue`，但当前多数运行时授权工具仍按资源和动作聚合；本人、被分配、被分享等对象范围仍需要各业务 API 在查询和写入时做关系校验。
- Assets 默认权限已从 baseline 移除；实物资产、资源资产和资产操作必须来自显式授权。
- Codocs 全员 baseline 不包含 `projects` 资源；项目文档和需求缺陷入口应继续由 AIMS 项目关系或企业角色映射授权。
- 普通员工默认能力不落为平台企业角色 seed；企业如需显式岗位管理，可以在租户侧自定义“普通员工”角色。
- Workflow 组织关系审批节点仍以当前目录和业务对象关系为准；员工级“直接上级”需要 People 或目录模型补充汇报关系后再支持。
- `finance:expense_submitter`、People 细分应用角色、可能的 `codocs:records_manager` 仍属于后续扩展项。

## 11. 后续补充事项

- 后续可评估是否新增专门的 `codocs:records_manager`，用于表达档案管理员的档案治理能力；当前不调整 `codocs:publisher`。
- 后续可新增 `finance:expense_submitter`，用于普通员工提交费用、报销和付款申请。
- 后续可新增租户级开关，允许企业在安全策略中关闭部分全员基础能力，例如默认个人文档编辑。
- People 细分应用角色上线后同步更新企业角色默认映射。
