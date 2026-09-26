# ADR-018 产品试点数据清单

核对日期：2026-09-15。任务：INT-003。范围：测试租户 `C000001` 的 Aims/Assets 试点业务数据；不包含 Platform、Console、认证、Vault 或生产数据。

本清单以当前脱敏迁移计划 [`C000001.enterprise-migration-plan.json`](../deploy/test-env/artifacts/C000001.enterprise-migration-plan.json) 为逐表权威证据，以 [`C000001.enterprise-rehearsal-150-copy-20260914b.json`](../deploy/test-env/artifacts/C000001.enterprise-rehearsal-150-copy-20260914b.json) 和 [`C000001.unified-database-activation.json`](../deploy/test-env/artifacts/C000001.unified-database-activation.json) 为复制及测试激活证据。计划逐表保存 source domain/schema/table、target table、完整 `SHOW CREATE TABLE`、列、主键、行数、内容 hash 和 trigger；因此主外键、字符集、collation、索引及引擎的逐表细节不在本文复制第二份。

## 1. 当前 150 表基线

此节描述已应用的历史试点基线，不等同于整合分支新增 schema 的完整迁移闭包。工作项完成审批新增 `work_item_completion_requests`，目前仅有 canonical/additive candidate，未包含在上述环境回执中。启用前须重新生成并审阅逐表映射及 JSON 合同：复合 FK `(project_id, work_item_id)`、活跃申请生成列/唯一约束、冻结 `snapshot_json`（item/children）及其 hash、操作键、Workflow 外部实例和回执身份都不能遗漏；外部 Workflow ID 不得当作本地 Aims ID 重写。候选登记见 [`enterprise-work-item-completion-additive.json`](../deploy/test-env/enterprise-work-item-completion-additive.json)。 当前唯一候选 registry 已扩展为 152 表（115 Aims / 37 Assets），提交 `873f39f2` 验证公开审批请求入口生成的冻结 snapshot/owner receipt/outbox 哈希，以及真实 rewriteDDL/copyTable 影子复制的生成列、唯一约束、复合 FK 与外部 Workflow 身份保留。该证据仅来自可丢弃隔离 MySQL，不改变下面已应用的 150 表历史基线；终态与人工 replay 历史审计仍待验证。

| 域 | 业务表 | 行数 | 引擎 | 默认字符集 / collation | 实例位置类别 | 统一库物理命名 |
| --- | ---: | ---: | --- | --- | --- | --- |
| Aims | 113 | 414 | 113 张均为 InnoDB | 113 张均为 utf8mb4；70 张 `utf8mb4_unicode_ci`，43 张 `utf8mb4_bin` | 与 Assets 同一台测试 MySQL 实例中的独立源 schema | `aims_<source-table>` |
| Assets | 37 | 64 | 37 张均为 InnoDB | 37 张均为 utf8mb4；36 张 `utf8mb4_unicode_ci`，1 张 `utf8mb4_0900_ai_ci` | 与 Aims 同一台测试 MySQL 实例中的独立源 schema | `assets_<source-table>` |
| 合计 | **150** | **478** | **150 张均为 InnoDB** | **150 张均为 utf8mb4** | 同实例、不同源 schema；统一目标是同实例专用测试 schema | 域前缀消除同名表冲突 |

当前计划版本为 `enterprise-shadow-copy.v1`，review hash 为 `5404dd29e3374a66cb7180670a2850ade0e61414ae250464775e58c16c5eda97`。150 张业务表已逐表 count/hash/FK/trigger 校验；演练目标另有 3 张迁移控制表，因此演练回执记录 `153 base tables / 150 business tables`。38 个业务 trigger 和 55 个兼容视图均已核验。测试激活回执记录 generation=1、源围栏已启用、目标最小账号只有目标库 DML 与 55 个视图的 `SHOW VIEW`，无全局、DDL 或源库授权。

旧演练回执 [`C000001.enterprise-rehearsal-copy.json`](../deploy/test-env/artifacts/C000001.enterprise-rehearsal-copy.json) 的 `147 verified checkpoints / 150 target base tables` 是较早批次：147 张业务表加 3 张迁移控制表。Assets 后续补入三张空 outbox 表 `integration_operation`、`integration_operation_attempt`、`integration_operation_dead_letter_actionable`，形成当前 150 张业务表闭包；其应用回执见 [`C000001.assets-outbox-schema-application.json`](../deploy/test-env/artifacts/C000001.assets-outbox-schema-application.json)。旧数字仅作历史追溯，不再作为当前基线。

## 2. 试点对象、表和键/引用

下表覆盖 INT-003 点名的数据。`PK`、FK 和索引来自当前迁移计划中的实际 DDL；逻辑引用没有伪装成数据库 FK。

| 对象 | 表（源域） | 行数 / PK | 关键引用与索引 | 写入方 | 主要消费者 |
| --- | --- | --- | --- | --- | --- |
| 产品 | `product_assets`（Assets） | 53 / `id` | `product_code` 唯一；`product_line,status`、`project_code` 索引；被底座/资源关系表引用 | Assets Runtime 产品主档命令、Enterprise Assets owning command | Assets 产品列表/详情；Enterprise 产品目录；Aims 当前目录与候选 |
| 产品线 | `asset_category_groups`（Assets） | 8 / `id` | `(category_scope,category_value)` 唯一；scope/sort 索引；`product_assets.product_line` 为逻辑引用 | Assets Runtime 分类保存 | Assets 字典/产品筛选；Enterprise 产品线下拉；Aims 当前产品线名称 |
| 产品空间 | `product_workspaces`、`product_members`（Aims） | 3 / `product_code`；3 / `id` | workspace 的 `biz_id` 唯一；member 引用 workspace，含用户、角色和有效期索引 | Aims productcenter workspace/onboard 命令 | Aims/Enterprise 空间列表、详情、对象授权和规划上下文 |
| 产品线空间 | `product_line_workspaces`（Aims） | 2 / `line_code` | `product_code` 唯一并 FK 到 workspace；保留 `~line-` 身份与 source watermark | Aims 整线接入 | 产品线空间详情、当前目录和接入判断 |
| 模块及来源 | `product_components`、`product_component_sources`（Aims） | 43 / `id`；21 / `source_product_code` | component 引用 workspace；source 通过 `(component_id,product_code)` 引用 component，并限制一来源归属一个模块 | Aims 模块和整线接入命令 | 功能归类、结构页、来源产品追踪 |
| 功能 | `product_features`（Aims） | 38 / `id` | `biz_id` 唯一；引用 workspace/component；按产品、模块、状态检索 | Aims feature command | 功能目录、版本范围、规划和发布矩阵 |
| 需求 | `product_requests` 及 `product_request_*`（Aims） | 主表 10 / `id` | 主表 `biz_id` 唯一并引用 workspace/component；关系表保留功能、来源、交付关联 | Aims request command；可信 Altoc 反馈接收 | 需求列表/详情、规划项、版本候选、项目承接 |
| 版本 | `product_versions`、`product_version_features`、`product_version_plans`、`product_version_plan_scopes`、`product_version_plan_confirmations`（Aims） | 主表 4 / `id`；其余当前 0 | 版本引用 workspace；范围连接版本、功能、需求；确认记录保存 revision/hash | Aims version lifecycle/planning command | 版本列表/详情、功能矩阵、计划确认、验收发布 |
| 规划 | `product_planning_cycles`、`product_planning_items` 及 dependency/comment/request 关系（Aims） | cycle 2 / `id`；item 7 / `id` | cycle 引用 workspace；item 引用 workspace/cycle，并以关系表连接需求及依赖 | Aims planning/priorities command | 路线图、优先级、容量、版本规划和项目承接 |
| 采用关系 | `customer_delivery_assets`、`customer_delivery_asset_environment_rel`、`asset_environments`（Assets） | 当前均 0 / `id` | delivery asset 的 `product_code` 逻辑引用产品；rel 以 FK 连接 delivery asset/environment并约束活动关系 | Assets 交付资产/环境领域命令；Altoc 状态同步 | Aims 产品采用查询；Assets 交付/环境详情与汇总 |
| 目录 projection | `product_catalog_control`、`product_catalog_refreshes`、`product_catalog_projection`、`product_catalog_page_receipts`（Aims） | 1、5、212、4 | projection PK `(generation,product_code)`；page receipt PK `(generation,page_number)` | Aims catalog refresh worker | 旧产品列表、空间、候选和接入校验；迁移期继续保留 |
| Assets 水位 projection | `assets_product_catalog_state`（Assets） | 1 / `id` | 单行目录 revision/watermark | Assets 产品主档命令 | Enterprise 当前目录一致性读取 |
| 领域 receipt | `product_command_receipts`（Aims），两域 `service_command_receipt` | 4、0、0 | 领域幂等键/请求 hash；service receipt 两域分别映射为 `aims_` / `assets_` | Aims productcenter 与两域 owning/service command | 新旧入口幂等重放、冲突判定、诊断及恢复 |
| outbox/attempt | 两域 `integration_operation`、`integration_operation_attempt`、`integration_operation_dead_letter_actionable` | 六表均 0 | operation 为稳定主键；attempt FK 到 operation；dead-letter PK `(operation_id,generation_no)` 且 FK 到 operation | 业务 mutation 同事务写 operation；scheduler 更新租约、尝试和结果 | Aims/Assets scheduler、管理诊断/重放、Console 通知投影及外部目标服务 |
| 通知 checkpoint | `aims_notification_checkpoint`、`assets_notification_checkpoint` | 均 0 / `id` | 保存 operation、状态/revision 与通知水位；Aims checkpoint 关联 operation | notification worker | 防止失败/死信通知重复并支持恢复 |

## 3. 写入责任与消费者边界

| 数据组 | 唯一写入责任 | 同库/Runtime 消费者 | 独立服务消费者及保留条件 |
| --- | --- | --- | --- |
| 产品主档、产品线字典 | Assets 领域服务；Host 写入仍经 Assets owning receipt | Assets 页面、Enterprise ProductDirectoryQuery、Aims 当前目录查询 | 未迁移的 Aims 候选仍经受权 API；不得创建第二份主档或字典 |
| 空间、模块、功能、需求、版本、规划 | Aims productcenter 领域服务；所有命令在所属事务写 audit/receipt/必要 outbox | Enterprise/Aims BFF、规划查询、授权事实、版本和路线图 | Altoc 反馈、Finance 成本、Codocs 文档链仍按专项合同消费；消费者未归零前不退役 outbox |
| 采用关系 | Assets 交付资产和环境领域服务 | Assets 详情与 ProductAdoption read service | Aims 通过专用采用查询合同读取；关联对象不可见时总数和名称均不得泄漏 |
| 目录 projection | Aims catalog refresh worker（迁移期 owner） | 旧 productcenter 列表/空间/候选/接入校验 | 当前事实查询已可直读 Assets 主档，但旧消费者归零前 projection、refresh、page receipt、水位均保留 |
| service receipt | 对应 Aims/Assets owning 或被调用领域服务 | 同一领域的新旧 API 共享稳定命令身份 | 用于提交后响应丢失恢复；不可合并两域同名物理表或改写历史调用身份 |
| integration operation/attempt/dead-letter/checkpoint | 源业务 mutation 创建；唯一 scheduler owner 领取及更新 | Runtime scheduler 与管理 API | Altoc、Finance、Codocs、People/Console 通知等目标；切换须 generation fencing，不能据当前零行判定无消费者 |

静态源码只能证明已登记的写入方和消费者，不能证明环境中不存在仓库外消费者。实际运行消费者、调度所有权和退役证据由 INT-001、INT-206、INT-208 分别闭环，不重复扩大 INT-003 的完成条件。

## 4. 完整性与边界

- 当前逐表计划覆盖所有 150 张源 `BASE TABLE`，从而保留表级 FK、逻辑/JSON 引用、审计、receipt、outbox 和水位。每张表的 DDL、主键、索引、引擎、charset/collation、行数、内容 hash 与目标映射均可由计划复核。
- 150 张业务表均已复制到测试统一库并逐表校验，38 个 trigger 及 55 个兼容视图已核验；测试激活 generation=1。该证据只适用于 C000001 测试环境，不外推到生产或其他租户。
- JSON/业务语义引用的迁移规则和冲突处置属于 INT-202；同权限主体的旧新查询等价属于 INT-203；最小权限和切换/恢复属于 INT-206/207。INT-003 的数据清点完成不代表这些后续任务完成。
- 本清单及引用回执不包含密码、DSN、原始业务字段或生产连接信息；实例只记录测试/源/统一目标等位置类别和非秘密 instance identity。
