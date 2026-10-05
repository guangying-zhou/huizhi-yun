# AIMS 产品中心设计与落地计划

> 2026-09-12 流程调整：面向中小软件企业的日常规划改为“模块需求 → 版本草案 → 投入取舍 → 确认计划 → 研发交付”。当前执行范围、接口和验收以[产品轻量规划第一阶段方案](Aims-Lightweight-Product-Planning-Phase1.md)为准。本文原 PC 分期与固定评分／周期必经要求保留为历史实施背景及高级规划路径，不能继续作为轻量版本的强制前置；开发状态以实施证据为准。

> 建立日期：2026-09-07
> 最近修订：2026-09-07，补齐首批优先级、证据、容量取舍与复评，详见第 5.5 节；专项第 8.1 节补充 PC-06A 工作包与容量验收样例。
> 状态：实施中；PC-00／PC-01／PC-06A 已开始，其余按依赖推进。已执行隔离测试库迁移，未执行业务环境迁移、部署或线上验收；实际证据见[实施记录](Aims-Product-Center-Implementation-Status.md)。
> 方案依据：本轮仓库代码、Schema、模块契约，以及用户确认的“AIMS 内建设产品中心，Assets 保留产品主档”方向。
> 文档责任域：AIMS；协作域：Assets、Data Runtime、Foundation、Console / Platform，后续按批次接入 Altoc、Codocs。
> 排期口径：使用依赖与相对工作量，不自动改写公司当前 9–10 月必达任务。实际负责人、启动日期和环境在任务启动时登记。

## 1. 交付目标与边界

在 AIMS 内建设与“项目总览”并列的一级“产品中心”，让产品负责人完成：

**收集问题 → 评估取舍 → 确定功能与路线 → 排入版本 → 交给项目执行 → 验收发布 → 回看结果。**

产品规划可以在项目立项之前开始；功能可以跨版本持续演进；产品和版本可以由多个项目共同实现。项目需求、基线评审、任务、缺陷、工时继续使用现有 AIMS 执行链路。

本次方向决策：

| 决策 | 落地约束 |
| --- | --- |
| 产品中心作为 AIMS 内部业务模块 | 不新增应用代码、独立部署、数据库或登录入口；内部领域命令与 UI 分离，为未来拆分保留条件 |
| Assets 是唯一产品主档事实源 | AIMS 不生成 `product_code`，不维护第二套产品名称、产品线、资产等级与主档负责人 |
| AIMS 是产品规划与研发事实源 | 新增产品需求、长期功能、规划目标和路线；复用版本、项目产品关联与工作项 |
| 产品工作空间独立于项目 | 不创建“虚拟项目”来保存产品需求，不强制先立项才能规划 |
| 产品权限独立于系统管理 | 普通产品负责人按负责产品工作；版本发布单独授权 |
| 第一批就贯通小闭环 | 第一批包含轻量功能目录、规划事项、固定模型评分／人工定序、容量取舍与三列路线；可配置评分、跨产品组合与自动经营分析后置 |

本文定义完整交付目标。实现状态以[实施记录](Aims-Product-Center-Implementation-Status.md)为准；未完成的接口、权限与开关仍为目标设计，不能因 Schema 已存在而视为当前运行时支持。实现时同步实际 Schema、API、manifest 和有效模块契约。

## 2. 已核对的现状与缺口

| 现状证据 | 本轮判断 | 实施影响 |
| --- | --- | --- |
| [有效产品版本契约](../../docs/MODULE_CONTRACTS.md#aims--assets-产品版本契约有效) | Assets 管产品主档，AIMS 管版本、特性和进度 | 沿现有边界扩展，无需迁移产品主档 |
| [管理员产品页](../app/pages/admin/products.vue)、[导航](../app/config/navigation.ts)、[路由权限](../app/config/permissions.ts) | 已有产品维度版本列表、时间线与特性维护；入口仍在系统管理，要求 `admin:admin` | 不能把“全局版本页”写成从零开发；迁移可复用组件，但业务权限需重做 |
| [产品版本 Schema](aims_schema.sql)、[项目版本 runtime](../../data-runtime/internal/apps/aims/product_versions.go) | 版本按 `product_code` 归属；项目产品 N:M；版本维护仍有 `owner_project_id` 约束 | 保留标识和关联，逐步把版本管理权从项目归属调整为产品范围 |
| [管理员版本 runtime](../../data-runtime/internal/apps/aims/admin_product_versions.go) | 管理员和项目入口存在不同处理函数；当前状态允许已发布版本回到开发中 | 三个入口应调用同一领域规则，发布历史需要不可变记录 |
| [版本特性 Schema](aims_schema.sql) | `product_version_features.version_id` 必填，`work_items.feature_id` 引用版本特性 | 新增长期功能实体；不得直接改写旧 `feature_id` 的含义 |
| [项目需求创建](../../data-runtime/internal/apps/aims/requirement_create.go)、[任务创建](../../data-runtime/internal/apps/aims/requirement_task_create.go) | 项目需求已有独立实体、正文／章节、评审与基线后任务创建逻辑 | 产品需求转入项目应复用领域逻辑；不得绕过基线直接批量造任务 |
| [AIMS 产品查询](../server/api/v1/product-assets.get.ts)、[Assets 产品 service helper](../../assets/server/utils/serviceProducts.ts) | AIMS 查询要求项目查看权限，未完整透传分页；Assets 关键词分支固定读取 100 条 | 新产品目录不能继续使用“拉一批后前端筛选”的方式 |
| [AIMS manifest](../app.manifest.json)、[本地权限配置](../app/config/permissions.ts) | 本地配置含 `requirements`，manifest 当前未列同名资源 | 转入项目链路要补齐所用需求权限的 manifest 事实源，避免继续增加漂移 |
| [Assets 产品详情](../../assets/app/pages/products/[id].vue)、[Assets Schema](../../assets/docs/assets_schema.sql) | 页面／service 有 current/target version 快照字段；基础建表定义未完整体现这些历史扩展 | 迁移前以实际迁移链和目标库核验字段；不从页面字段推断目标库一定存在 |

上述为仓库事实，不证明线上已部署相同版本。[旧版本设计](Aims-Product-Version-Management-Design.md)中的“MVP 不做全局版本页”已落后于当前代码，本文以代码为基线，不重做已具备的能力。

## 3. 各应用的职责

| 对象／能力 | 写入事实源 | 产品中心如何使用 |
| --- | --- | --- |
| 产品编码、名称、产品线、资产分类、主档负责人 | Assets | 查询／展示；通过企业 Shell 跳到 Assets 维护 |
| 产品工作空间、产品团队、定位与目标 | AIMS | 维护工作空间；团队管理职责与 Assets 主档责任字段分别命名，不双向同步 |
| 产品需求池、功能目录、路线安排 | AIMS | 原生维护，允许无项目、无版本 |
| 版本范围、发布记录、项目产品关系 | AIMS | 复用和增强原实体 |
| 项目需求基线、工作项、测试／缺陷／工时 | AIMS | 按关系追溯，执行状态不复制到产品需求状态 |
| 客户、商机、合同、客户工单 | Altoc | 首批允许登记来源说明；后续通过明确契约关联，不把客户工单迁成产品需求 |
| PRD、设计、发布说明等正式文档正文 | Codocs | 保存 UUID 引用；正文访问仍由 Codocs 独立鉴权 |
| 交付资产、客户环境及实际部署关系 | Assets | 发布不等于客户环境已升级；后续读取实际部署信息 |
| 企业身份、角色治理、共享授权适配 | Console / Platform / Foundation | 复用现有链路，不建立 AIMS 自己的角色计算器 |
| 产品投入产出、经营结果 | Finance 等相应事实源 | 第三批按正式口径读取，不在产品中心自算一套财务账 |

Assets 的 `business_owner_uid / technical_owner_uid` 表示主档责任；AIMS 产品成员中的管理关系表示日常规划权限。首次初始化可以展示主档负责人作为候选，需显式分配才生效，后续主档变更不自动增减产品授权。

## 4. 用户工作空间与交互

### 4.1 导航与页面

```text
AIMS
├── 工作台
├── 产品中心 /products
│   └── 产品 /products/:productCode
│       ├── 概览：定位、负责人、近期版本、待决策与阻塞
│       ├── 需求池：收集、评估、采纳、合并、转入项目
│       ├── 功能：长期能力目录、对应需求、历次版本
│       ├── 优先级：事项评估、价值／投入矩阵、决策队列与容量
│       ├── 路线图：近期 / 下一步 / 以后；第二批增加季度视图
│       ├── 版本：范围、执行进度、发布检查、发布记录
│       ├── 研发关联：关联项目与可访问的执行工作项
│       ├── 文档：可访问的关联项目文档；第二批增强产品文档空间
│       └── 设置：产品工作空间成员、归档；主档编辑跳 Assets
├── 项目总览
└── 系统管理：保留诊断和迁移工具，产品日常业务迁出
```

产品列表默认显示“我可访问且已启用工作空间的产品”。拥有初始化权限的人员通过“启用产品工作空间”从 Assets 选择已有产品。尚无主档时跳转 Assets 建档后返回选择；第一批不新增跨应用创建主档的写链路。

旧 `/admin/products` 保留兼容跳转并携带产品／版本定位信息；旧项目版本页继续可用，展示同一版本数据。跨应用入口使用 Foundation `useApplicationShell()`，不拼第二套应用总入口。

### 4.2 首批页面约束

- 列表服务端分页：`page/pageSize`，默认 20、最大 100；筛选变化回到第一页；排序有稳定 ID 次序。
- 需求搜索使用 `useDebouncedSearch()`；列表有加载、空状态、错误重试和明确下一步操作。
- 需求标题和问题说明可轻量录入；评估、来源、功能关联、执行追溯在详情页逐步补充，不要求用户一次填完复杂表单。
- 产品规划先用结构化定位／周期目标摘要、成功指标及手动观测；正式长文档通过 Codocs 管理，不在首批新增编辑器。
- 路线图第一批以三列展示，提供按钮／菜单移动，拖拽属于增强能力；键盘与触屏均能完成排期。
- 1440px 使用列表与详情分层布局；390px 使用卡片、单页详情和可切换路线分组，不依赖横向拖拽完成操作。
- 跨项目执行详情只展示当前用户可访问的记录；产品级整体指标与“我可查看的明细”分别标注范围，不能把部分明细算成全局完成率。
- 删除、归档、合并、发布与撤回用 Foundation 确认交互；冲突保留用户未保存内容并允许刷新比较。
- 业务页面不显示 SQL、runtime 升级命令或 capability 名称。环境缺能力时显示“暂不可用，请联系管理员”，诊断入口提供 request ID。

## 5. 核心业务流程与规则

### 5.1 产品需求进入与决策

1. 成员录入标题、问题说明、来源类型；客户原话可作为来源证据，第一批不要求填写客户编码。
2. 产品负责人补充目标用户与来源证据；P0～P3 仅表达紧急程度。需要投入建设的需求关联规划事项，在第 5.5 节的统一口径下评估、排序和选入周期；第一批即实现固定评分模型。
3. 决策为采纳、暂缓、拒绝或合并；除首次进入评估外，决策变更记录理由、人员与时间。
4. 合并指向同产品另一条需求，禁止自引用、循环和指向已合并项；源记录只读保留，来源证据不删除、不计为两个独立需求。
5. 采纳可关联一个或多个长期功能，但不等于已经承诺版本或已完成研发。

### 5.2 功能、路线与版本

长期功能回答“产品具备或准备具备什么能力”。版本特性回答“本次版本对该能力交付哪些内容”。

示例：产品需求“企业用户希望统一登录”关联长期功能“单点登录”；V2.0 的版本特性为“支持 OIDC”，V2.1 的版本特性为“增加 SAML”。两个版本共享同一长期功能 ID，分别拥有范围说明、验收标准和发布快照。

- 一条功能可关联多个需求、多个版本；一个版本可包含多个功能。
- 首批通过规划事项表达本次范围，例如同一功能的 OIDC 增强与 SAML 增强分别评估；需求是问题来源，长期功能是能力身份，规划事项是比较和取舍单位。
- 未排版本的规划事项进入近期／下一步／以后；已排入版本的交付范围按版本日期展示。两者在 UI 分区，不能让一个日期字段同时表示方向和承诺；功能页汇总这些事项，不维护独立路线顺序。
- 第二批增强同一规划事项的季度／目标与受众视图，不另建第二套规划实体。第一批顺序以当前周期的决定队列为准，三列视图按其派生顺序。
- 新增版本不要求 `owner_project_id`；规划阶段允许无研发项目。已有字段继续保存实施牵头项目，切换完成后不再单独决定版本编辑权。
- 已发布版本的内容通过不可变快照展示；改正错误使用专用撤回／更正动作，不覆盖原发布记录。
- 发布记录属于产品发布事实，不触发自动部署，也不自动把 Assets 中的客户环境标成新版本。

### 5.3 产品需求转入项目

提供“关联已有项目需求”和“创建项目需求草稿”两种操作；第一批先支持已有 active `product_dev` 项目，项目与该产品必须已有合法绑定。交付／维保项目保留当前版本引用能力，客户定制转产品的治理后置。

创建时提交规划事项 ID、来源产品需求 ID（有则必填）、相应 revision、目标项目、范围说明，以及可选的目标版本／版本特性。需求入口须确认该需求与事项关联；无需求来源的工程事项可由规划事项入口转交。事项须已选入当前周期或有已记录的紧急例外，用户须同时拥有来源转交动作、产品范围及目标项目需求编辑权限；具体动作见优先级专项第 7.2 节。

Data Runtime 在同一 AIMS 事务中执行：

1. 重验双方访问权、产品归属、项目状态和版本范围。
2. 复用项目需求创建逻辑，创建 `requirement_items` 草稿及必要章节内容；只冻结本次选定的问题／范围摘要，不复制整个产品规划文档。
3. 保存规划事项／来源产品需求 → 项目需求的稳定关联、来源 revision、范围快照和审计记录。
4. 保存幂等回执；任一步失败全部回滚。

随后仍由项目执行现有评审 → 基线 → 创建任务流程。不得把产品需求“采纳”直接映射为项目需求“已基线”。产品需求后续修改只显示“来源已变更”，不覆盖已评审的项目需求。

一条产品需求可经规划事项分拆到多个项目；同一事项在同一项目内重复创建必须明确标识不同交付切片，默认重放原切片。创建需求与关联不能由 BFF 分两次独立提交，否则会形成孤立需求。

### 5.4 进度与发布

- 沿用 target 层工作项加权完成率：完成 target 权重之和 / 全部关联 target 权重之和；跨功能、项目汇总按工作项 ID 去重，零总权重显示“暂无执行计划”。
- 产品需求的决策状态、长期功能生命周期、研发完成率、版本特性验收状态分别保存／计算，不互相覆盖。
- 发布前列出未完成执行项、未验收范围、阻塞缺陷及例外。所有排入版本的特性必须已交付，或已明确顺延／移出并留痕；不能带着未处理的 planned 特性直接发布。
- 阻塞缺陷与版本关联沿现有工作项关系核验；PC-00 确认无法稳定归集的项采用显式验收清单，不能标为“自动检查通过”。
- 版本负责人记录范围验收；具备 `publish` 的另一主体确认发布，服务端校验不可自审。第一批是本应用显式两步确认；只有后续引入可配置审批流时才接 Workflow。
- 范围、验收条件或阻塞结论变更使旧验收失效；发布命令在锁定版本后重验本次 revision 和验收记录，发布记录、版本状态与日志同事务提交。

### 5.5 优先级、证据与容量取舍（高级周期规划路径）

完整规则见 [产品优先级与决策机制](Aims-Product-Prioritization-Design.md)。该规则继续约束使用周期／评分的高级规划；轻量版本按独立的版本范围、估算、预算和确认快照形成有效决定，不要求创建周期或评分记录。轻量路径的具体实施及兼容约束见[第一阶段方案](Aims-Lightweight-Product-Planning-Phase1.md)。

**评审重点：产品中心必须回答“为什么先做、因此推迟什么”。** P0～P3 只回答紧急程度；首批还必须交付评估列表、价值／投入矩阵、负责人决定的队列，以及容量内选入版本的结果。验收时分别检查这四项，不能用需求表上的 priority 下拉框代替 PC-06A。

本次对照 [Atlassian 产品管理工具文章](https://www.atlassian.com/zh/agile/product-management/product-management-tools)的“产品管理工具应具备的特性”“想法收集与优先级排序”“路线图绘制与规划”和“协作与报告”：评分和矩阵落在本节；反馈证据与评审讨论落在优先级专项第 3、5 节；发现到交付的关联落在本计划第 5.1～5.4 节；多受众路线视图按第二批实施。文章提供能力参考，具体权重、决策权限和容量规则由本方案定义。

落地时按专项第 5.4 节的评审操作清单执行：整理证据 → 产品与研发共同评估 → 核对期限和容量 → 负责人决定顺序与取舍 → 形成版本／项目安排 → 定期回看。PC-12 试点必须演示“高分事项因明确约束顺延”的完整决定，验证系统能解释为什么这样排，而不仅能显示优先级标签。

首批区分紧急程度、推荐分数、决定顺序和交付安排。评分对象是“本次建设范围”的规划事项；采用固定模型：加权价值（战略匹配 30%、用户价值 30%、经营价值 20%、风险降低 20%）× 置信度 / 投入人日。量表、缺失值、示例与口径限制见专项第 4 节；该公式是汇智云试点设计，不是外部文章规定的标准。

产品负责人依据证据、硬期限、依赖和分类容量决定顺序。手工调整保存理由，不修改原分数；模型或范围变化标“需复评”，不自动打乱已决定顺序。周期记录目标、容量与下次复评时间，默认两周复评；首批支持评论／异议、价值／投入矩阵、轻量目标观测，自动外部反馈与经营指标仍按后续批次实施。

本文参考用户指定的 [Atlassian 工具文章](https://www.atlassian.com/zh/agile/product-management/product-management-tools)，补足决策环节；文章对照和来源边界见专项第 1 节。它不改变本项目的应用分工，也不构成购买或接入外部工具的计划。

## 6. 目标数据模型

以下是实施基线，迁移版本号在 PC-00 对齐当前迁移序列后分配。新对象用不可变 `biz_id` 对外引用，内部关系可用 BIGINT 主键；产品始终使用 Assets 的 `product_code`。

### 6.1 第一批增量表

所有可编辑实体具备 `created_by/updated_by`、UTC 时间和 `revision`；更新按 expected revision 做 CAS。外部对象不建跨库外键。

| 实体／拟用表名 | 核心字段与约束 |
| --- | --- |
| 产品空间 `product_workspaces` | `product_code` 唯一、`biz_id` 唯一、定位／用户／价值摘要、`status=active/archived`；产品展示缓存必须有 `source_updated_at/synced_at`，不可编辑 |
| 产品成员 `product_members` | `product_code + uid + relation_type` 唯一；关系包括 manager/contributor/viewer，具备生效／失效时间；关系提供对象范围，动作来自 manifest 授权 |
| 产品需求 `product_requests` | `biz_id/product_code/title/problem_statement/source_type/urgency_level/decision_status/decision_reason/merged_into_id`；紧急程度不等于评分；同产品合并约束与循环检查 |
| 需求来源 `product_request_sources` | `request_id/source_app/source_type/source_biz_id/source_note/verification_status`；正式外部键经目标 API 验证后才标 verified；首批人工说明不冒充已验证引用 |
| 长期功能 `product_features` | `biz_id/product_code/title/description/lifecycle`；首批平铺，生命周期 candidate/active/deprecated；路线从规划事项派生 |
| 需求功能关系 `product_request_features` | `request_id + product_feature_id` 唯一；必须同产品 |
| 需求交付关系 `product_request_delivery_links` | `planning_item_id/request_id/project_id/requirement_id/source_revision/scope_snapshot/delivery_slice_key`，request_id 可空，可选 `planned_version_id/planned_version_feature_id`；以 `planning_item_id + project_id + delivery_slice_key` 唯一，已有项目需求实体保持不变 |
| 版本验收 `product_version_acceptances` | `version_id/scope_revision/accepted_by/accepted_at/checklist/exceptions`；只追加，变更后旧验收仍保留但不再满足发布门禁 |
| 发布记录 `product_release_records` | `version_id + release_seq` 唯一、发布者／时间、完整范围与验收快照、内容 hash、`supersedes_record_id`；创建后不可修改正文 |
| 发布事件 `product_release_events` | `release_record_id/event_type/actor/reason`；撤回／更正只追加事件，原发布内容不变 |
| 产品活动日志 `product_activity_logs` | `product_code/object_type/object_id/action/actor/revision/changes/request_id`；追加记录，不存 Token 或无关个人资料 |
| 产品命令回执 `product_command_receipts` | `product_code/action/actor/idempotency_key` 唯一，保存请求 hash、结果引用与状态；与领域写同事务，供本地重复提交恢复 |
| 产品目录投影 `product_catalog_projection` | `generation + product_code` 唯一、名称／产品线／主档状态／来源更新时间；staging 与 active generation 分离；只接受 BFF 经 Assets 验证的输入 |
| 目录刷新记录 `product_catalog_refreshes` | refresh ID、generation、来源水位、已读游标、状态、行数、发起人、时间；续传幂等，成功后原子切换唯一 active generation |
| 目录提交控制 `product_catalog_control` | 单例根锁；串行化刷新页提交与 active 切换，不锁产品空间或借用伪产品标识 |
| 目录页回执 `product_catalog_page_receipts` | generation＋page 唯一，来源页内容 hash 与冻结结果；同内容重放、异内容拒绝，与暂存和切换同事务 |

首批同时增加规划周期、规划事项、事项需求关系、周期候选／顺序、评分快照、依赖、评论与目标观测实体；字段与约束集中维护在[优先级专项第 7 节](Aims-Product-Prioritization-Design.md#7-数据与命令接口)。PC-01 的基础迁移设计需预留这些关联，PC-06A 负责实现与验收其增量，不在两处重复维护细节。

命令回执优先复用仓库已有可满足同事务要求的公共设施；PC-00 若确认可以复用，移除上述本地拟用表并在任务记录登记实现路径。不能直接拿跨应用 outbox 代替本应用事务边界，也不新造第二套通用集成框架。

转交时选定版本属于交付意图，保存在交付关系上；基线后生成执行 target 时重新校验产品绑定与版本状态，再显式应用到 `work_items.version_id/feature_id`。绑定失效时提示重选，不静默丢弃或改绑。计划意图不计入研发进度，只有真正关联的执行 target 才参与聚合。

### 6.2 保留和扩展存量对象

| 存量对象 | 增量调整 | 兼容规则 |
| --- | --- | --- |
| `product_versions` | 增加 revision、scope_revision、版本业务负责人、当前发布记录引用；复用现有计划日期／状态 | ID、`product_code + version_code`、项目绑定保持不变；`owner_project_id` 留作实施关系 |
| `product_version_features` | 增加可空 `product_feature_id`、唯一可空 `planning_item_id`、`change_type`、范围验收标准及延期来源特性 ID | 保留原主键与 version_id；旧行可以暂未映射长期功能或未评估，页面明确标记 |
| `work_items.version_id / feature_id` | 继续引用版本与版本特性 | 不把 `feature_id` 改为长期功能 ID；新关系通过版本特性追溯 |
| `aims_project_products` | 继续作为项目产品关联事实源 | 保留限定版本／全版本约束；新入口不得绕过已有约束 |
| `requirement_items / requirement_contents` | 复用草稿、章节、评审和基线流程 | 来源追溯放新关系表，不改项目需求主状态机 |

同一版本内新建的同一长期功能默认只有一个版本特性范围条目；数据库对非空 `product_feature_id` 建相应唯一约束。存量同名条目不自动合并，映射前人工确认范围；SQL NULL 兼容未映射历史条目。

版本号沿用现有值作为不透明业务标识，不解析字符串推断先后。当前管理员 UI 只接受 `V数字.一位小数`，而 Schema 允许更一般的版本号：统一前后端校验为 trim 后 1～64 字符、禁止控制字符，同产品唯一；不强制把存量号改为 SemVer。排序使用计划日期、显式顺序和稳定 ID。

归档产品禁止新规划、转交和版本变更，但不终止已关联项目的执行；恢复必须显式记录原因。有引用的需求、功能和版本不物理删除；无引用草稿才可经独立删除权限删除。项目删除造成追溯失效时保留来源快照和“关联已失效”，不得级联删除产品需求或发布事实。

### 6.3 第二、三批扩展

第二批增加 `product_components`（模块树，最大 3 层）、`product_objectives`（完整目标、期间、基线、目标值、负责人）、目标／事项关联与路线基线快照。增强首批 `product_planning_items` 的季度／时间窗口、探索／承诺和跨产品依赖；周期目标摘要可映射到正式目标，保留原快照。不另建 `product_initiatives`，不重复生成版本范围。评分模型配置、按条件启用 RICE、管理／产品／研发视图和保存筛选归第二批。

第三批才增加经契约确认的客户证据关联与经营指标引用。此时再明确每个指标的期间、币种、成本口径、归属规则和来源 revision，不预建财务镜像表。

## 7. 状态、并发与历史

| 对象 | 状态／动作 | 必须执行的规则 |
| --- | --- | --- |
| 产品需求 | submitted → evaluating → accepted / deferred / rejected；deferred 可回 evaluating；merged 为终态 | accepted 改回评估或拒绝需说明影响；有关联执行时不能静默撤销项目工作 |
| 长期功能 | candidate → active → deprecated；恢复需原因 | active 由产品负责人确认，需引用有效发布记录或明确的存量能力证据；后续增强仍由新版本条目表达，不显示成百分比执行状态 |
| 版本特性 | planned → delivered / deferred | delivered 需验收证据；延期保留原条目与后续条目关系，不搬走已发布历史 |
| 版本 | planning → developing → released → archived | 发布走专用命令；通用 PATCH 不得改 status、发布人和发布时间 |
| 已发布版本更正 | 专用 reopen，随后重新验收／发布 | 要求 `reopen` 权限、理由和原记录引用；原记录不可变，撤回事件可追溯；旧 released → developing 路由也必须进入该命令 |
| 发布 | accept → publish | acceptance 绑定当前 scope revision；actor 不同；同幂等键同请求返回同发布记录，异请求 409 |

所有会影响范围、关联或验收的写命令锁定同一版本根记录并递增 scope revision。并发“添加特性与发布”“调整工作项版本与发布”“两人同时发布”只有一个一致结果，不能通过先查后写形成穿透窗口。

新增关联、合并、转交、排序、发布、归档具备同事务审计；回执的唯一键冲突先比较 payload hash 再返回既有结果。鉴权在读取回执前完成，成员失权后不能用旧幂等键读取结果。

## 8. 授权设计

### 8.1 资源与动作（目标 manifest）

以下是待实现清单；实现后 manifest 为唯一技术事实源，前端与测试从其派生，不在其他文件维护第二份动作算法。

| 资源 | 目标动作 | 典型用途 |
| --- | --- | --- |
| `products` | view / edit / onboard / archive / restore / admin | 工作空间读取、定位维护、初始化、归档／恢复、成员管理 |
| `product_requests` | view / create / edit / decide / handoff / delete | 需求收集、决策、转交与无引用草稿删除 |
| `product_features` | view / edit / delete | 长期功能维护与无引用草稿删除 |
| `product_priorities` | view / edit / assess / prioritize / handoff / comment / observe | 规划事项、周期评估、最终顺序／容量、转交、讨论、结果观测，详见优先级专项 |
| `product_roadmaps` | view / edit / commit | 读取路线；edit 用于第二批视图配置，commit 为第二批正式承诺动作；首批事项调序走 product_priorities:prioritize |
| `product_versions` | view / edit / accept / publish / reopen / archive / delete | 版本规划、验收、发布与更正 |

第一批未实现的动作不在 UI 标为可用。角色模板包括产品观察者、产品贡献者、产品经理、版本发布者；模板名字不包含具体产品、部门或项目。

### 8.2 产品范围与项目范围

- 产品成员关系是当前对象范围条件，不能单独替代资源动作授权；所有有效 grant 合并后按同一 grant 的 action + scope 判断。
- 产品授权对象固定为 `{ type: product, product_code }`；request、feature、version 等子对象从 runtime 实际父关系解析，不能信任客户端传的 product_code。
- 当前 Foundation／Console 支持哪些对象关系需在 PC-02 验证。若缺 product 类型，补正式对象描述和统一 adapter，再开放入口；不能将 product_code 塞进 project_code 或用管理员布尔值兜底。
- 初次启用空间要求 tenant-global `products:onboard`，候选查询只返回必要主档字段；初始化事务指定至少一位 active 产品 manager。普通 manager 的授权限其产品，无全租户隐式扩权。
- 产品成员可读取明确授权的产品范围摘要，包括产品版本的整体进度；项目名称、工时、客户信息和工作项正文仍需项目权限。整体产品指标是显式授权的产品事实，不能自动连带授予底层项目明细。
- 项目参与者通过项目页可读取该项目合法关联版本的最小范围、公开特性和本项目执行情况；项目身份不自动授予完整需求池或产品设置权限。
- 项目负责人可维护本项目执行关系；切换后编辑产品版本仍需产品版本动作与产品范围。管理员入口也执行相同发布／更正规则。
- 列表、计数、详情、导出、批量、写入各自执行服务端范围检查；权限过期、成员撤销和模拟模式立即按当前会话重验。
- normal-merged 权限、角色模拟隔离、自定义企业角色、动作蕴含、职责冲突全部复用 Foundation；`admin` 不隐含 publish/reopen/accept 等敏感动作。

## 9. 接口与跨模块契约计划

### 9.1 AIMS 用户接口（目标）

外部 BFF 前缀 `/api/v1`，自身 runtime 路径映射 `/v1/aims`。以下 `p` 表示 `/products/{productCode}`，各子对象 ID 在 runtime 校验真实父产品。

| 接口 | 行为与关键约束 |
| --- | --- |
| `GET /products` | 对已启用空间及生效目录投影执行授权、筛选、排序、分页及 total；返回目录更新时间 |
| `GET /product-candidates` | 仅 onboard 权限可用；Assets 正式分页搜索，返回主档最小字段 |
| `POST /products` | 按经验证 Assets product_code 幂等启用空间，显式分配初始 manager |
| `GET/PATCH p`、`POST p/archive`、`POST p/restore` | 读取／维护产品定位与空间状态；PATCH 不接受 Assets 主档字段。`GET` 另返回只读目录身份 `product_name` / `product_line` / `product_line_label`，取自当前生效目录代次，仅供产品工作台标题展示；目录未刷新或产品不在该代次时为 null，主档仍归 Assets |
| `GET/POST p/members`、`PATCH/DELETE p/members/{id}` | 管理对象关系；不得主动移除最后一位有效 manager，交接与撤权留痕；人员停用／到期导致无 manager 时由显式 tenant-global 产品管理员接管 |
| `GET/POST p/requests`、`GET/PATCH/DELETE p/requests/{id}` | 需求管理；删除仅限无引用、未决策的 submitted 记录 |
| `POST p/requests/{id}/decision`、`POST .../merge` | 决策／合并为显式命令，校验 revision、理由、同产品和环路 |
| `GET/POST/DELETE p/requests/{id}/sources[/{sourceId}]` | 来源说明维护，已 verified 引用的写校验按后续集成契约实现 |
| `GET/PUT p/requests/{id}/features` | 查询／原子替换功能关系，去重并验证同产品 |
| `POST p/requests/{id}/handoffs` | 指定合法 planning_item_id，复用专项规划事项转交命令；双方授权、周期选择、源 revision、切片幂等、同事务提交 |
| `GET/POST p/features`、`GET/PATCH/DELETE p/features/{id}` | 长期功能维护、历史版本和需求追溯；删除受引用约束 |
| `GET p/roadmap`、`POST p/roadmap/reorder` | 返回规划事项有界分组；写入复用当前周期 decisions 命令、prioritize 权限与 queue revision，不维护第二套排序 |
| `GET/POST p/versions`、`GET/PATCH/DELETE p/versions/{id}` | 复用版本实体；只有无引用 planning 版本可物理删除 |
| `GET/POST p/versions/{id}/features`、`PATCH/DELETE .../features/{featureId}` | 管理本次版本范围、长期功能链接与验收标准，发布后锁定 |
| `POST p/versions/{id}/transition` | 仅允许非敏感流转 planning → developing；发布／更正／归档有专用命令 |
| `POST p/versions/{id}/accept`、`.../publish`、`.../reopen`、`.../archive` | 显式动作鉴权、scope revision、职责冲突和幂等回执 |
| `GET p/versions/{id}/release-records`、`GET p/activity` | 读取不可变发布历史和授权范围内活动日志 |
| `GET p/projects`、`GET p/execution` | 产品关联与进度投影；项目明细执行项目授权，不支持跨权限导出 |

通用约定：沿用 `{ code, data, message }` envelope；列表 data 含 `items/total/page/pageSize`。所有写命令带 `Idempotency-Key`，修改带 `expectedRevision`；重复键异 payload／并发版本冲突 409，输入错误 400，未认证 401，资源动作不足 403，不可见对象 404，授权基础设施／依赖不可用 503。服务端字段采用现有 snake_case，BFF 统一类型映射，避免每页兼容两套命名。

规划周期／事项、评分、矩阵、顺序、讨论与结果接口见[优先级专项第 7.2 节](Aims-Product-Prioritization-Design.md#72-权限与接口)。新规划事项正式排入版本需同时通过版本编辑权限和有效周期决定；旧版未评估范围保留历史兼容，不能用旧接口给新范围绕过选择规则。

旧管理员／项目接口保留 URL 兼容，但调用相同版本领域命令；新功能不能另起一个全能 CRUD 绕过版本状态和范围校验。浏览器 actor、角色模拟、runtime 上下文由 Foundation 验证和重建。

### 9.2 目录查询策略

产品中心的列表在 AIMS 将工作空间与生效目录投影关联，先执行范围、名称／产品线筛选，再排序、分页和计数；投影不是主档写入口。详情或引用解析按 product_code 有界批量调用 Assets，不逐行请求，也不把当页新数据混入使用旧 generation 筛选的列表。

第一批提供有权限的显式“刷新产品目录”命令：BFF 从 Assets 分页取得有界主档数据，全部分页成功后按 refresh generation 原子切换目录投影，失败保留原 generation。显示最后刷新时间；不在普通 GET 中偷偷写库，不首批引入 scheduled worker。新增空间时必须实时验证产品存在及可启用状态。

目标接口为 `POST /products/catalog-refresh`，要求 tenant-global `products:onboard`；按单页最多 100 条分批暂存并以服务端 refresh ID 继续，单次请求有界。客户端只能继续已授权 refresh ID，不能提交目录行或任意游标目标。Assets 分页使用稳定 product_code 顺序及游标／读取水位合同；若目标暂不支持一致水位，刷新前后核对主档变更水位，不一致则作废该 generation 重试。不能把边翻页边变化的目录当作完整快照。

完整实现需增加 `product_catalog_projection` 和 refresh generation 元数据（可作为 staging generation 保存于同表）。未完成 generation 不参与搜索；展示字段和筛选使用同一生效 generation。详情允许实时只读补全并标注差异，不能让同一列表混用新旧名称。产品被停用／删除时已有规划保留历史可读，新的启用和引用失败关闭；代码、来源更新时间和展示缓存不得由前端写入。

### 9.3 跨应用能力（目标，第一批仅两条读链路）

| 调用方 → 目标 | 接口／变化 | 精确 capability 与范围 |
| --- | --- | --- |
| AIMS → Assets | 现有 service products 增加真实 page/pageSize、最小投影与批量解析；支持目录刷新与启用校验 | 新增 `assets:product:read`；AIMS BFF 先验证产品业务动作，再申请服务令牌 |
| Assets → AIMS | 现有 product versions 保留；增加读取已发布范围／版本摘要的精简模式 | 新增 `aims:product-version:read`；只输出允许消费的公开特性与产品摘要，不外泄内部需求和项目明细 |

上述 source app / target app、audience、tenant/deployment、撤销、有效期、actor 委托均使用根契约与 Foundation helper。业务 BFF 调目标 Service API，由目标访问自己的 runtime；不得直连其他应用 runtime 或数据库。

精确 capability 在目标 manifest 定义，Console grant 初始化／安装／verify 与实际组合 scope 签发探测配套。旧 `assets:read / aims:read` 的其他调用不全量迁移；本批改造的端点先支持精确授权，逐个迁移现有消费者与验证后再移除旧授权分支，不能扩大旧宽 scope。

第三批 Altoc 写入产品需求时，另定义 `aims:product-request:create-from-feedback`，采用标准 service-command envelope、caller-owned operation 和 target receipt；客户／工单仍留 Altoc。该写链路、通知与 worker 均不在第一批启用。

Codocs 第一批只从 AIMS 中用户可访问的关联项目文档记录汇集 UUID 并跳转到 Codocs 正式页面，不新增产品专属文档创建／绑定 API；关联不会授予正文权限。第二批再增加产品文档关系和 product 对象范围合同，用于正文搜索／嵌入，不能复用“项目文档可读”推导产品成员可读。

## 10. 存量迁移、启用与回退

采用 expand → backfill → switch → retain，首批不删除旧表、旧 ID 或旧字段。

### 10.1 迁移前核验

PC-00 产出只读 precheck，统计并记录：

- 产品 code 唯一性、大小写与排序规则；AIMS 引用在 Assets 是否可解析。
- 已有版本／特性／工作项引用数量，悬挂 owner_project_id、无主版本和跨产品错误关联。
- 发布／归档版本、相同功能在多版本出现的候选；仅输出待人工确认映射，不按标题自动合并。
- 实际字段与迁移版本，特别是 Assets current/target version 历史字段；目标库不可访问时该项标“环境待核验”。
- 管理员、项目负责人、已有产品主档负责人以及可迁移的精确授权；不把所有项目成员升为产品经理。
- 存量版本号规则、公开特性口径与当前 service 消费者。

### 10.2 增量数据迁移

1. 先部署兼容读取的新表／列与 runtime；新入口默认关闭，旧入口继续可读。
2. 按明确产品清单显式启用空间，补 manager 和发布者授权。生成权限差异报告；用户拥有角色模板但无产品关系时不算有效授权。
3. 版本及特性保留原 ID；长期功能默认由人工映射或后续新建，未映射历史特性仍可读。映射不改发布快照。
   历史版本不补造分数、顺序或周期决定，明确显示“历史未评估”；从产品中心新建的规划范围使用新决策合同，兼容标记只能由受控迁移写入，不能从浏览器或旧 CRUD 注入。
4. 为存量已发布版本生成“历史导入”记录：保存当前可证实内容、导入时间、证据等级；缺原始发布人／验收记录保留未知，不能补造过去审批。
5. 主档 current/target version 仅标为历史快照，不反向覆盖 AIMS。Assets 后续以 AIMS 已发布记录／显式计划版本摘要为展示依据；不按版本号字符串取最大值。
6. 新旧界面切同一领域读写；完成两产品试点后移除管理员页面里的日常编辑 UI。后续旧接口只作为相同领域命令的兼容入口，不保留旧授权旁路。

迁移工具默认 dry-run，apply 需显式参数，保存 migration run ID、行数、输入 hash 与映射结果；同输入重跑不重复生成空间、成员、特性、发布记录。映射／迁移失败可分批重试，不跨 AIMS / Assets 数据库开事务。

### 10.3 发布顺序与回退

拟用开关 `productCenterEnabled` 由受信运行配置按租户控制，名称在实现时落到实际配置体系；不得用浏览器参数启用能力。

发布顺序：数据库 expand → runtime 领域命令与合同 → manifest / policy / Console 精确 grant → BFF → AIMS / Assets UI → 迁移核对 → 精确令牌与真实角色验收 → 试点开关。涉及组件间依赖时在发布清单记录兼容最小版本，不能仅看 UI 能打开。

Finance 新 runtime 启用前先执行 [分摊币种扩展迁移](../../finance/docs/migrations/20260909_project_cost_allocation_currency.sql)，确认 `project_cost_allocation.currency_code` 存在；迁移不回填历史币种。新增写入、标准人工同步和产品成本快照读取依赖该列。Finance SchemaStatus 已检查该列，部署验证中 `MissingColumns` 不得包含 `project_cost_allocation.currency_code`；完整 SchemaStatus 仍须无其他结构缺失。

版本写入口启用前，对 AIMS 库执行只读 [product_version_write_postflight.sql](product_version_write_postflight.sql)，结果必须为空；返回行表示关键列或 InnoDB 事务前置不满足。该检查仅覆盖版本工作项写入依赖，不代替完整迁移核对、精确 grant 与真实角色验收。


回退时关闭新入口、停止新批次迁移，保留新增数据与不可变发布记录。旧页面读取原版本表，写路径仍使用已统一规则；不能回退到允许绕过发布门禁的旧 runtime。若必须撤回 runtime，先关闭版本写入口并发布兼容修复，不能删表或丢弃新建需求来“回滚”。

## 11. 实施任务与依赖

任务状态与验证证据集中维护在[实施记录](Aims-Product-Center-Implementation-Status.md)，下表维护工作定义与依赖。角色是责任类型，具体人员由任务启动记录指定；估算是有效工程人日，包含相关自测，不是承诺日期。第一批为 PC-00～PC-12 及新增 PC-06A，第二批 PC-13～PC-16，第三批 PC-17～PC-18；共 20 项，原编号不变。

| ID | 任务与责任角色 | 依赖 | 交付物／主要落点 | 完成证据 | 人日 |
| --- | --- | --- | --- | --- | ---: |
| PC-00 | 基线核验与实施登记；技术负责人 | 无 | precheck、现有端点／消费者清单、版本差异、回执复用判断、迁移编号 | 只读报告；未知项明确绑定后续环境验收 | 1–2 |
| PC-01 | 领域 Schema 与迁移；后端 | PC-00 | 第 6 节第一批表、目录投影、增量列、索引、dry-run/backfill/verify | 空库与存量夹具迁移、重复执行、异常引用报告 | 3–4 |
| PC-02 | 产品范围与 manifest；授权负责人 | PC-00 | AIMS manifest、Foundation/Console 产品对象 adapter、角色模板、requirements 资源对齐 | 合并／模拟／自定义角色／过期／跨产品／发布职责冲突测试 | 3–5 |
| PC-03 | Assets 产品目录合同；集成后端 | PC-00、PC-02 | Assets helper/runtime、精确 capability、Console seed/verify、BFF 分页与批量解析 | 第 101 条可搜索，真实 total，跨租户拒绝，组合 scope 签发清单 | 2–3 |
| PC-04 | 产品空间与目录刷新；AIMS 后端／前端 | PC-01～03 | products API、成员、目录 generation、一级导航、概览、设置 | 无项目可启用和规划，最后 manager 保护，刷新失败保留旧目录 | 3–4 |
| PC-05 | 产品需求池；AIMS 后端／前端 | PC-04 | request/source/decision/merge API 与列表／详情 | 决策历史、循环合并拒绝、分页与跨产品权限测试 | 3–4 |
| PC-06 | 轻量功能目录与路线；AIMS 后端／前端 | PC-05 | 功能 CRUD、需求关联、最小规划事项、三列路线读视图 | 无版本事项可规划；功能汇总无重复路线状态；调序由 PC-06A 提供 | 2–3 |
| PC-06A | 优先级与决策；产品／AIMS 前后端 | PC-01、PC-02、PC-06 | 专项 Schema/API、固定评分、矩阵、周期队列、容量／依赖、评论、复评／观测 | AC-21～28；例子可复算、历史可追溯、并发调序、插单取舍与容量完整 | 8–12 |
| PC-07 | 产品需求交给项目；AIMS 后端 | PC-05、PC-06A | 事务化复用 requirement create、事项／需求关系、切片幂等、UI 操作 | 决策入口一致；注入失败整体回滚；双边权限；基线正文不被来源更新覆盖 | 3–5 |
| PC-08 | 统一版本领域规则；AIMS 后端 | PC-01、PC-02、PC-06A | product_versions 与 admin handler 共用命令、版本号规则、事项选择／工作项关联校验 | 三入口同动作一致；新范围不绕过选择；旧 ID 与历史兼容 | 3–5 |
| PC-09 | 版本页与研发追溯；AIMS 前后端 | PC-07、PC-08 | 产品版版本详情、长期功能范围、项目可见明细、正确聚合 | 一功能跨版本、多项目同版本、受限明细与整体指标区别 | 2–3 |
| PC-10 | 验收、发布与更正；AIMS 后端／前端 | PC-08、PC-09 | acceptance、release records/events、专用发布命令与 UI | 并发发布／范围变更冲突、自审拒绝、历史不可变、幂等重放 | 3–5 |
| PC-11 | Assets 展示与旧入口收敛；集成前端／后端 | PC-03、PC-09、PC-10 | Assets 只读摘要／Shell 深链、AIMS 旧路由兼容 | 无双写、公开字段过滤、项目页存量流程回归 | 1–2 |
| PC-12 | 第一批试点与交付；产品负责人／QA／发布负责人 | PC-04～11（含 PC-06A） | 两产品数据、评分／插单／复评、迁移和权限核对、真实角色验收、回退演练 | 第 12 节 28 个用例通过；证据区分仓库／环境 | 3–5 |
| PC-13 | 功能模块树与产品目标；产品／前后端 | PC-12 | component/objective、功能迁移、目标指标录入与历史 | 平铺功能无损迁移，树无环，目标达成不取任务完成率 | 3–4 |
| PC-14 | 季度路线与承诺基线；产品／前后端 | PC-13 | 扩展 planning_items、跨产品依赖、模型版本配置／受众视图、commit 权限、基线快照 | 保留首批顺序／模型；探索与承诺分开；保存视图不扩大数据权限 | 4–6 |
| PC-15 | 多项目协调和版本对比；AIMS 前后端 | PC-13、PC-14 | 工作量／风险汇总、功能版本矩阵、发布范围 diff | 跨项目去重，顺延追溯，权限过滤，历史对比稳定 | 3–5 |
| PC-16 | 产品文档空间；Codocs／AIMS 集成 | PC-12、产品对象范围合同 | UUID 关联、正文鉴权、产品文档入口／模板 | 产品成员不自动获未分享正文；缺授权不可预览／搜索 | 3–5 |
| PC-17 | 客户反馈闭环；Altoc／AIMS 集成 | PC-12、独立契约确认 | feedback 引用／需求接收、operation/receipt、状态回执 | 来源幂等、客户工单保持原事实源、失败可恢复 | 单独估算 |
| PC-18 | 产品采用与经营结果；产品／Assets／Finance | PC-15、指标口径确认 | 实际部署版本、期间结果与成本引用 | 发布与部署区分；币种／期间／分摊去重可追溯 | 单独估算 |

第一批估算更新为 **40–62 人日**（原 32–50，加 PC-06A 8–12）；第二批暂为 **13–20 人日**，模型配置／受众视图细化后重估。以一位后端／runtime、一位前端持续投入并有共享 QA 支持估算，第一批约 **6–10 周**，第二批约 **3–4 周**；授权 adapter、真实环境和存量迁移问题会影响关键路径，PC-00～02 完成后重估。前后端任务可在接口冻结后分工，不把等待时间简单除以人数。

第一批最早可演示节点：PC-04 完成后展示无项目产品空间；PC-06 完成后展示需求与轻量路线；PC-06A 完成后可评估、定序和容量取舍；PC-10 完成后展示完整闭环。PC-12 之前都不称为试点交付完成。若资源不足，优先顺延第二、三批，不删除第一批的决策闭环、授权、事务、历史与验收任务。

### 11.1 代码与文档落点

- AIMS UI：`app/pages/products/**`、`app/components/products/**`、`app/composables/`；从 `admin/products.vue` 和项目 releases 页提取真正复用的版本展示／表单，不一次重构无关页面。
- AIMS BFF：`server/api/v1/products/**`、`server/middleware/tenant-runtime.ts`、权限／导航 adapter；普通数据转发保持既有 runtime 主路径。
- Runtime：`data-runtime/internal/apps/aims/` 新增按产品业务分组的领域文件；现有 `product_versions.go`、`admin_product_versions.go`、需求创建函数改为共享事务命令。
- Assets：现有 product service helper、对应 runtime 目录分页、产品详情；不扩展到采购和资源资产其他页面。
- 授权：`aims/app.manifest.json`、目标 Assets manifest、Console 安装／grant seed/verify；Foundation 仅补统一产品对象授权能力。
- 文档：实施同步 `aims/docs/aims_schema.sql`、新产品中心 API 文档、旧版本设计当前事实说明、相关模块 `CLAUDE.md`、根 `MODULE_CONTRACTS.md`。有 Foundation 新能力时同步能力索引；只有实际平台架构变化才改根架构说明。

## 12. 验收矩阵与检查范围

### 12.1 第一批必须通过

| 编号 | 场景与预期 | 层次 |
| --- | --- | --- |
| AC-01 | 非管理员产品经理无需切角色，可管理授权产品；无关系产品不可读写 | 授权契约＋浏览器 |
| AC-02 | 多角色正常合并，模拟不继承真实管理员，自定义企业角色有效，过期和撤员立即失效 | 授权契约 |
| AC-03 | 产品尚未立项，仍可记录需求、功能、路线和规划版本 | Runtime＋浏览器 |
| AC-04 | 101 个产品候选／超过一页需求可翻页搜索，total 正确，筛选重置页码 | API＋浏览器 |
| AC-05 | 需求合并保留来源，拒绝自合并、跨产品合并及环路 | Runtime |
| AC-06 | 一条功能跨 V2.0／V2.1 范围不同但 ID 稳定；未映射历史特性仍可读 | Runtime＋迁移 |
| AC-07 | 产品需求拆给两个项目有两条明确范围关系；同切片重试只创建一个草稿 | 真实数据库事务测试 |
| AC-08 | 转交缺任一侧权限、项目未 active、产品绑定不符时无任何残留写入 | 事务＋授权契约 |
| AC-09 | 在草稿创建、关联、日志、回执各点注入失败，所有写入一起回滚 | 真实数据库事务测试 |
| AC-10 | 产品来源修改仅提示差异，不改变项目已基线正文／状态 | Runtime＋浏览器 |
| AC-11 | 多项目 target 去重加权；零计划显示无计划；受限用户看不到未授权项目明细 | 聚合＋授权 |
| AC-12 | 编辑权限不能发布；同人验收发布拒绝；管理员／项目旧入口也不能绕过 | 三入口契约 |
| AC-13 | 发布与新增范围／工作项换版本并发，只能提交一致 revision；双发布无重复记录 | 真实数据库并发测试 |
| AC-14 | 发布同键同 payload 返回原记录，异 payload 409；更正后旧发布范围 hash 不变 | Runtime＋数据库 |
| AC-15 | Assets 只读版本与 AIMS 一致，不把最新发布冒充客户已部署版本 | 跨应用＋浏览器 |
| AC-16 | 错 capability/audience/source/tenant/deployment、过期／撤销 Token 拒绝；依赖不可用 503 | 跨应用契约 |
| AC-17 | 存量导入 dry-run 无写入，apply 重跑不重复，原 version/feature/work_item ID 不变 | 迁移演练 |
| AC-18 | 目录刷新中断保留完整旧 generation；没有先分页后过滤导致的漏项 | Runtime＋集成 |
| AC-19 | 1440px／390px 无阻断性溢出、重叠与控制台错误；键盘完成路线移动与发布确认 | 真实浏览器 |
| AC-20 | 关闭产品中心后存量项目版本可读；新数据保留，写入不会回到旧发布旁路 | 回退演练 |
| AC-21 | 固定评分计算、单位、缺失／越界输入与示例复算正确 | 评分单元＋Runtime |
| AC-22 | 重复反馈不加分，同功能多范围独立评估，多项目投入不重计 | 数据约束＋聚合 |
| AC-23 | 范围／证据／模型变化保留历史并标需复评，不静默调整既有承诺 | Runtime＋浏览器 |
| AC-24 | 最终调序权限、理由、跨页移动、并发 queue revision 正确 | 授权＋事务 |
| AC-25 | 容量、未知估计、依赖与硬期限有明确取舍／例外，不仅凭 P0 放行 | 领域命令 |
| AC-26 | 推荐分与决定顺序分开、矩阵范围完整可解释，键盘／移动端可操作 | API＋浏览器 |
| AC-27 | 评论／证据范围、周期复评与目标结果更正正确，不拿执行进度充当成果 | 授权＋Runtime |
| AC-28 | 历史未评估可兼容，新规划事项在转交／排版本各入口均遵守决策合同 | 新旧入口回归 |

AC-21～28 的具体输入和结果见[优先级专项验收](Aims-Product-Prioritization-Design.md#8-实施与验证)，与本表使用相同编号。

外部写链路在第三批另增加 operation 冻结、目标 receipt、异 hash、重试、乱序／撤销及 worker 精确 grant 验收。第二批增加目标／路线基线不可变、树／依赖无环、正文跨产品拒绝等用例。

### 12.2 工程检查

按实际改动运行相关范围，已有测试优先扩展；事务／并发不能仅用源码字符串断言证明。

```bash
pnpm --dir aims lint
pnpm --dir aims typecheck
pnpm --dir aims test
go -C data-runtime test ./internal/apps/aims
```

改动 Assets 时运行其 lint/typecheck/test 及 `go -C data-runtime test ./internal/apps/assets`；改动 Foundation／Console 授权时补对应统一授权与 service token 合同检查。跨 Worker renderer 改动执行根 `validate:business-cloudflare`。UI 验收按根前端规范实施，不能用静态截图代替创建、转交、发布等交互。

参考回归入口：[版本 runtime 测试](../../data-runtime/internal/apps/aims/product_versions_test.go)、[需求创建测试](../../data-runtime/internal/apps/aims/requirement_create_test.go)、[敏感路由测试](../test/sensitiveRoutePermissions.test.ts)、[跨应用绑定测试](../test/crossAppServiceBinding.test.ts)。

## 13. 试点与实施登记

第一批选择两类产品：一个已有多个历史版本的在研产品，一个尚未建立研发项目的新规划产品。测试准备使用虚构数据；真实业务数据由试点负责人确认后在目标环境使用。

最小样本：每产品至少 8 条需求，覆盖采纳／暂缓／拒绝／合并；至少 3 个长期功能、2 个版本；其中一个版本由 2 个项目共建；包含无项目需求、顺延特性和历史未映射特性。使用产品经理、贡献者、发布者、仅项目成员、无权限用户五类真实授权会话验收。

优先级样本另准备至少 12 个规划事项，覆盖三类投资、未评估、相同分数、重复反馈、期限约束、共同前置与过期评估；完成一次有受影响事项记录的插单和一次周期复评。首批角色用例增加“仅可评论”“可评估但不可定序”，验证协作动作不会放大权限。

试点出口：两产品各完成一次“需求到发布”演练；产品经理全程不依赖系统管理员角色；没有新建重复主档或手工同步执行状态；全部 AC 用例有证据或明确阻断结论。上线后观察 2 周，记录需求转交失败、重复创建、权限异常与人工补录次数，再决定第二批启动。

每个 PC 任务使用以下记录，不以勾选替代证据：

| 字段 | 填写内容 |
| --- | --- |
| 任务与负责人 | PC-ID、实际姓名、开始时间、依赖是否完成 |
| 状态 | 待实施／进行中／代码完成／环境待验／验收通过／阻塞 |
| 实现证据 | commit／PR、涉及路径、Schema 与 API 版本 |
| 仓库验证 | 命令、结果、日期、事务与并发用例 |
| 环境验证 | tenant/deployment、组件版本、迁移／grant verify、实际 Token 签发、会话角色与 AC 编号 |
| 限制与恢复 | 未验证项、具体原因、下一步、回退演练结果 |

业务负责人需在 PC-00 登记两项输入：首批试点产品及各产品 manager／独立发布者，参与试点的研发项目。缺这些输入不阻止 Schema、权限合同和虚构数据实现，但不能完成真实试点验收。

## 14. 后续独立应用的判断条件

满足明确业务需要时再单独评估拆分：产品规划需要独立售卖／订阅；有独立团队与发布节奏；需要同时对接 AIMS 之外多套研发执行工具；或跨产品投资组合成为主要工作场景。

为此当前按产品领域组织表、命令和 API，使用稳定 product_code／biz_id，减少页面直接拼跨域数据。未来拆分必须另做数据归属、兼容接口与迁移设计；本文不预先新增独立应用空壳。

## 15. 参考与文档关系

- [根执行约定](../../CLAUDE.md)、[AIMS 模块约束](../CLAUDE.md)、[Assets 模块约束](../../assets/CLAUDE.md)、[Data Runtime 约束](../../data-runtime/CLAUDE.md)。
- [模块契约](../../docs/MODULE_CONTRACTS.md)、[Foundation 能力](../../docs/FOUNDATION_CAPABILITIES.md)、[UI/UX 规范](../../docs/UI_UX_SPEC.md)、[标准列表页](../../docs/STANDARD_LIST_PAGE.md)。
- [现有版本管理设计](Aims-Product-Version-Management-Design.md)、[项目需求设计](Aims-Requirement-Management-Design.md)；历史设计状态不能替代代码和环境证据。
- [产品优先级与决策机制](Aims-Product-Prioritization-Design.md)：首批评分、定序、证据、容量和复评的专项实施规范，含外部文章对照及来源。
- [当前公司执行台账](../../docs/设计评审与落地执行计划-2026-09-05.md)：本文是产品中心专项实施基线，不自动调整该台账中的公司优先级。

方向已由用户确认；未决事项限于实施登记、实际环境核验和后续批次的业务口径。日常实现按根 Execution Style 推进，不为本文的普通设计细节新增审批流程。
