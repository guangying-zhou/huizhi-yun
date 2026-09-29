# ADR-018 产品试点数据与权限合同

日期：2026-09-13。最近核对：2026-09-15。负责人：`unified_data_inventory`。范围：INT-003 代码/schema 盘点及 INT-004 设计合同；当前 150 表基线及写入方/消费者映射见[产品试点数据清单](./Unified-Enterprise-Pilot-Data-Inventory.md)。本文后续按时间保留早期 147 表采样事实，不用它覆盖当前基线。本文件不单独证明生产迁移或其他租户验收；总进度维护在[实施 TODO](./Unified-Enterprise-Implementation-Plan.md)。

## 1. 证据与缺口

本轮只读检查工作区代码、DDL、现有测试实现和本机工具，按已确认本机测试配置在内存中使用凭据连接测试库；所有 SQL 均在 READ ONLY transaction 内执行，不输出凭据或业务行、不执行数据库写入。以工作区实际内容为基线；根 Git 仍含架构与指令修改，不能将 HEAD 当成全部交付物。

| 项目 | 已核验事实 | 尚缺证据 |
| --- | --- | --- |
| 表定义数量 | 早期 schema 文件基线为 Aims 113、Assets 34；补入 Assets 三张 outbox 表后，当前实际计划为 Aims 113、Assets 37，共 150 张 | 当前逐表事实及旧 147 表历史边界见[产品试点数据清单](./Unified-Enterprise-Pilot-Data-Inventory.md) |
| 连接 | 原应用分别使用独立 DBConfig/pool；当前测试激活将两域登记到同一个统一目标连接与 generation=1 | 该激活只证明 C000001 测试环境；其他环境必须独立核验 |
| 存储 | 当前计划证明 150 张表均为 InnoDB/utf8mb4，保留两域原 collation、完整 DDL、索引、FK 与 trigger | JSON/逻辑引用和业务冲突处置继续由 INT-202 核验，不能由表级 FK 代替 |
| 隔离测试 | `mysqld`、`mysql` 本机可执行；存在 mysqld 进程 | 未核实该进程用途，不使用其默认 socket；已有 /tmp 目录不证明隔离实例仍运行 |
| 安全测试入口 | `productcenter/mysql_integration_test.go` 仅接受 `HZY_PRODUCT_CENTER_TEST_SOCKET` 且路径必须在 `/tmp/hzy-product-center.*`，新建随机测试库并在 cleanup 删除；Assets 有独立同类 fixture | 本轮未运行测试。P1/P2 应启动专属临时实例并核验进程/socket，不能用 ambient DSN 或业务库运行 fixture |

INT-003 的当前表量、主外键、字符集、索引、引擎、实例位置类别、写入方及消费者已汇总到[产品试点数据清单](./Unified-Enterprise-Pilot-Data-Inventory.md)。运行中外部消费者归零、JSON 语义引用和目标环境漂移分别属于 INT-001/208、INT-202 与切换验收，不据 INT-003 勾选推定完成。INT-004 本文冻结的是实施合同；其他租户环境不得套用 C000001 映射。

## 2. 权威事实与保留语义

| 对象 | 当前事实源与关键关联 | 新路径与历史处理 |
| --- | --- | --- |
| 产品 | Assets `product_assets.product_code` 唯一；内部 id 供资产关联表 FK；product_name/product_line/status 由 Assets 主档写入 | Runtime 查询服务直读，名称不再依赖手动刷新。内部 ID 不可用产品编码替代；映射保留两者 |
| 产品线 | Assets `asset_category_groups` 中 category_scope='product'，category_value 匹配 product_assets.product_line；category_label/sort_order 是当前展示事实 | 当前下拉、列表、标题读取该字典。缺失标签按明确空值/编码降级，不能用历史 label 宣称当前名称已核验 |
| 管理空间 | Aims `product_workspaces`，product_code/biz_id/status/revision；成员在 product_members，带有效期 | 保留规划权限与接入决定。Assets 存在某产品不意味着已开通规划空间 |
| 产品线空间 | `product_line_workspaces.line_code` 主键，product_code 唯一并引用 workspace；line_label/source_watermark 为接入时事实 | 保留 `~line-` 稳定身份和接入水位。当前标题可从权威字典读取；历史 label 不原地覆盖充当最新值 |
| 来源产品与模块 | `product_component_sources.source_product_code` 主键；component_id 唯一；(component_id,product_code) 引用 components | 保留一来源只能归属一个线空间/模块的约束。source_product_name 是接入证据，当前展示另查主档；主档改名不更改模块自定义名称 |
| 目录投影 | product_catalog_refreshes active generation，projection 主键(generation,product_code)，page_receipts 幂等分页，control 全局锁 | 当前展示读模型可被直读替代；接入校验、水位、活动代际及分页重放仍有消费者，首轮不删表。停止刷新须证明全部这些路径已改造 |
| 规划内容 | components/features/requests、planning items/cycles、objectives/roadmap、版本及计划确认 | Aims 是写入责任域；revision、biz_id、actor、来源、依赖和状态规则保留，不与 Assets 主档合表 |
| 采用 | customer_delivery_assets.product_code → product_assets.product_code（逻辑引用）；rel.delivery_asset_id/environment_id → 交付资产与环境 | 属 Assets 实际部署事实。deployed_version 为部署事实，不替换成 product_assets.current_version 或 Aims 最新版本 |
| 发布/验收 | product_release_records/events、version_acceptances、plan_confirmations；快照、scope_revision、hash | 按原合同不可变/版本化保存；改名不能改签署/发布历史。保留旧文档链接与版本 ID |
| 外部文档与反馈 | product_documents / creation_requests / feedback_bindings；Codocs UUID、Altoc ticket/feedback、Finance 分摊命令 | 保留独立服务边界与可靠投递；不能因为产品主档合库就停这些任务 |

现行消费者证据：`assets/product_catalog.go` 在同一只读 REPEATABLE READ 事务读取水位、总数和主档；`aims/productcenter/product_list.go`、`product_line_list.go`、`workspace.go` 仍 JOIN 活动 projection；`line_onboard.go` 写来源关系与接入快照。仅替换首页名称不足以完成 INT-204。

## 3. 写入与读取消费者清单

以下路径均相对仓库；运行中调用量及未登记外部消费者仍需日志盘点，不能据静态搜索认定消费者归零。

| 责任域/入口 | 数据与消费方 | 迁移处置 |
| --- | --- | --- |
| `data-runtime/internal/apps/assets/runtime_writes.go`、`categories.go` | 产品主档/分类写；`product_catalog.go`、`product_list_page.go`、Assets 页面读取 | 留唯一 Assets 写入服务；改名更新同一库的权威事实与必要水位 |
| `aims/server/utils/productCatalog.ts`、`productLineCatalog.ts`、`api/v1/product-candidates.get.ts` | Aims → Assets 目录分页/线接入候选 | 新内部查询替代 HTTP 的候选路径；未迁移调用继续校验现有 service identity |
| `data-runtime/internal/apps/aims/productcenter/catalog_refresh.go` | 写 refresh/projection/page receipts；产品列表、空间、候选、接入校验消费 | 整体完成替代前保留，不能先移除刷新却继续读旧 projection |
| `productcenter/line_onboard.go`、`workspace.go` 及领域 command 文件 | 空间、成员、来源组件、功能需求、版本规划；product_command_receipts 同事务幂等 | 复用领域规则，将 shared transaction 传入，不模拟 H3Event、不在事务内 HTTP |
| `aims/server/utils/productAdoptionAssets.ts` → `assets/server/utils/productAdoptionService.ts` | 采用查询，最终 `assets/product_adoption_read.go` 读取交付资产/环境/关系 | 内部服务仍分别验证产品、交付资产、环境可见性，保留 totals 同一过滤集合 |
| `productcenter/*feedback*`、Aims `product_cost_operation.go` | Altoc 反馈和 Finance 费用规则 outbox | 尚有独立下游，不退役任务；冻结 payload/hash/身份照常保存 |
| Aims/Assets `integration_operation_admin.go`、后台 drain、dead-letter | 领取/续约/重放/确认 operation 与尝试记录 | 新旧消费者共享稳定操作身份；任务所有权 fencing 切换，保留历史诊断 |

## 4. 权限合同（P1/P2 必须执行）

1. tenant/environment/deployment、subject、逻辑 source/target/action 只能从已验证请求上下文构造。Runtime 注册连接与 tenant 绑定，不接受用户指定 schema、table 或 DSN。控制面、Auth/Vault/Session 均不在业务查询连接可见范围。
2. Foundation/Console 继续计算真实人员授权。`productcenter/authorization.go` 只提供主体成员/manager/status/revision 事实，不是授权成功；其有效期采用 UTC 包含起点、不包含终点。写入在同一事务锁定根对象并重新核验 revision/对象事实。
3. 新跨域查询须分别验证 Aims 规划对象与 Assets 目标对象所需权限。规划管理者不是 Assets 全局管理员。候选目录需专用目录读取合同；不能把现有系统目录服务返回的全量结果直接作为任意用户可见列表。
4. 产品采用继续执行 `product_adoption_scope.go` 的交付资产、环境双范围；无权关联不暴露名称、存在性、总数。分页/统计在同一过滤集合内完成；成本敏感字段不因 JOIN 自动公开。
5. Host → Runtime、独立服务保持 JWT、精确 capability、签名 actor、tenant/deployment 绑定与撤销验证。现有 `requireProductCatalogService` 要求 source=assets/client=assets.runtime/`assets:product:read`；在正式宿主身份映射完成前不得放宽该入口。
6. 同进程内部领域调用复用结构化上下文，免去自身 HTTP/JWT 重签，但不能免除 action、数据范围和职责冲突。命令幂等身份仍包括域/动作/actor/业务键，不能以统一库抹去命名空间。

共享服务回执入口为 `ReceiptRepository.ExecuteInTransaction(ctx, tx, input, handler)`：复用原输入校验、payload hash、回执冲突、历史摘要修复与重放逻辑，但不提交或回滚事务；调用方在任一错误时回滚，在领域修改、审计与回执全部成功后提交。原 `Execute` 仍自管事务并调用相同执行核心。 自域命令使用独立类型 `OwnedReceiptCommandInput` 和 `ExecuteOwnedInTransaction`，要求同一所属域、同一来源/目标部署和非空原始 actor；不通过请求开关放宽限制。跨应用两个 Execute 入口与 outbox Identity.Validate 仍拒绝 source_app=target_app，并由回归测试证明。回执表使用所属域的 Registry 映射，新旧入口须保持稳定业务命令身份并分别记录真实调用身份。现有及外层事务边界 race 测试通过；各业务接入仍需真实 MySQL 验证，不能由这项单元测试代替。

## 5. 合库冲突、命令和迁移映射

Aims 与 Assets 至少共享 `service_command_receipt` 表名；Assets 独立 migration 还定义 `integration_operation` / `integration_operation_attempt`，不能直接将两个 DBConfig 指到同一库。建议首个统一库保持域前缀物理表映射（例如 aims_service_command_receipt / assets_service_command_receipt），具体名称在迁移 registry 冻结；所有 SQL 与 FK/触发器必须按映射适配。不得用两个 updatable view 绕过所属域约束。

- 每一映射行至少含 source domain/schema/table/key、target table/key、业务键、schema 版本、迁移批次、水位和校验 hash。自增 ID 默认原样保留于有域前缀的表；发生冲突即报告，不静默重号。
- receipt：保留 receipt_id/execution_id/idempotency_key/request_hash 或 command hash、原 source/target、tenant/deployment、status/result_json 和时间。相同 key/hash 返回原结果，异 hash 拒绝；已提交但 ACK 丢失必须可恢复。
- outbox：operation_id/key、correlation/depends_on、command_json/sha256、target receipt、actor/client、attempt、lease/locked_by/locked_until/fencing_token、next_attempt_at、revision、dead-letter 通知水位必须映射。源业务 mutation 与 operation INSERT 同事务，next_attempt_at 显式 UTC_TIMESTAMP(3)。
- JSON：命令、结果、release/scope/checklist/snapshot、source_refs/外部链接含逻辑引用。按每个 operation/schema version 建解析映射，禁止全局字符串替换数字 ID；不能因表级 FK 校验通过就认定 JSON 引用完整。
- COLLATION：Assets 稳定业务键显式二进制比较，Aims 产品中心多数 bin；同编码大小写、尾空格、Unicode 等冲突应单独报告。数据库默认 collation 不得暗改既有唯一性。
- 时间：Go driver UTC location 只证明解码时区，不能证明 MySQL session time_zone=UTC；迁移预检需读取 session/global 时区和字段类型，对 DATETIME 原历史语义不擅自平移。

INT-202 可执行冲突检查已经进入 `unified.Prepare`：对 `product_workspaces.product_code → product_assets.product_code` 做 binary 精确逻辑引用检查，并识别 Assets 产品编码在 `LOWER(TRIM(...))` 下合并的主档冲突；产品规划首批另检查三种当前实际 operation 与 `command_schema_version` 的固定配对、JSON 有效性、`source_biz_code` 主档及 `requestBizId` 引用，并按活动日志顺序拒绝 revision 回退。计划只记录按冲突类型分域计算的 SHA-256 与行数，不记录原编码、对象 ID 或 JSON；存在任何 blocking conflict 时 `Apply` 在取得连接及创建目标库之前拒绝。随机隔离 MySQL 验证见[产品主档回执](../deploy/test-env/artifacts/INT-202.product-master-conflict-isolated-mysql.json)和[规划 JSON/revision 回执](../deploy/test-env/artifacts/INT-202.planning-json-revision-isolated-mysql.json)。其他 operation/schema、其余逻辑引用以及历史快照、audit、receipt、outbox/水位的业务语义检查仍未齐备，因此 INT-202 保持未完成。

## 6. 最小可执行后续工作包

合法JSON首批闭合合同：[version-create隔离回执](../deploy/test-env/artifacts/INT-202.version-create-json-isolated-mysql.json)以 `productcenter/versions.go` 的持久化 `product_versions:create` 动作与实际result形状为旧版本判别（历史载荷没有schemaVersion，不补写标记）。`product_command_receipts.result_json` 只接受succeeded create、明确字段集合与整数revision、固定初始状态、真实version/product引用及workspace历史revision上界；request_hash必须为64位hex。`product_activity_logs.changes` 只接受对应version/create、同actor/key/object_id与receipt原结果逐JSON快照相等。其他动作、额外schema标记、缺引用或快照变更blocking。结果快照没有独立hash字段，不能用request_hash替代结果摘要，也无法从结果重算未保存的原请求；本合同保留原request_hash并验证其形状和配对快照，未宣称重建原请求。合法create组已解除默认未知JSON阻断，其他动作/删除历史仍需专项合同。

当前151表候选逐表字段与规则状态登记在[语义规则清单](./Unified-Enterprise-151-Semantic-Rule-Registry.md)。新增默认拒绝门禁：未登记且非空的原生JSON字段生成脱敏 `json_field_contract_unregistered`；已登记字段依赖表不齐也不能绕过。已登记的规划命令JSON仅接受当前三种产品规划family，其他family仍blocking。见[未知JSON隔离回执](../deploy/test-env/artifacts/INT-202.unknown-json-contract-isolated-mysql.json)。清单穷尽表名/静态字段候选，但未穷尽源码中的全部业务引用规则，INT-202仍未完成。

INT-202 第三批检查以真实字段语义为限：[隔离回执](../deploy/test-env/artifacts/INT-202.delivery-integrity-isolated-mysql.json)覆盖确认快照 revision 不超过当前版本、交付链接已消费的 planning-item source_revision 不超过当前 revision、同完整租户/部署/应用/operation/幂等身份异 hash、成功 receipt 的目标字段配对/响应摘要，以及 outbox dependency、attempt/fence、dead-letter/version 的父链边界。目录 source_watermark 是不透明值，refresh revision 是每轮独立计数，不能跨轮用数值或字符串排序伪造“水位单调”；此批只校验有明确来源 revision 的交付消费水位。其他历史快照/audit 类型、receipt 目标领域逐对象存在性、attempt 状态序列和全部消费水位规则仍需逐表登记，INT-202 不据此勾选。

待纳入闭包：Aims 项目编辑/成员写路径新增的追加式 `project_activity_logs` canonical/additive migration 仅形成代码，旧 150 表激活/复制回执不包含该表。后续必须在新源计划中登记其 DDL、业务键、revision/JSON/audit 语义与 count/hash，不能据当前 150 表回执宣称已迁移该审计链。

成员删除 receipt 的候选审计证明已登记并经[隔离 MySQL](../deploy/test-env/artifacts/INT-202.member-delete-audit-isolated-mysql.json)验证：必须有 `member/remove` 事件精确匹配 project/member、original_actor_uid 与 idempotency_key，并且 changes 的 projectId/uid/action 与事件一致、project 仍存在。缺审计、错项目或错操作者 blocking；审计自身也反查 succeeded receipt 与 request_id。该证明依赖新增表，源中没有该表时仍 fail closed。[additive 候选](../deploy/test-env/enterprise-project-activity-additive.json)的代码闭包是 Aims114+Assets37=151 表，既有已激活回执仍是113+37=150表；本次没有应用真实库或生成151表环境迁移回执。

INT-202 第四批[隔离回执](../deploy/test-env/artifacts/INT-202.target-sequence-isolated-mysql.json)增加 operation→TargetBizType 的显式登记与目标对象存在性查询；未知 operation/type、缺失目标表或对象一律 blocking。成员删除是预期目标消失的命令，其追加式 audit/tombstone 合同尚未纳入 150 表，因此不会误作普通 member existence，当前 fail closed 待登记。attempt 按操作验证已知状态、从 1 连续编号、递增 fencing、processing 仅末尾且未完成、其他终态有完成时间、成功后无后续 attempt。目录现行合同为 epoch UUID 与正 revision 拼接，未知形状 blocking；只解析合同形状，不对不透明水位排序。其余历史快照和领域专属消费水位尚未穷尽，INT-202 保持未完成。

1. P1 建立 tenant-bound connection registry + 显式领域表映射和结构化授权上下文；默认旧路径，无配置不得接新库。使用两个隔离租户库测试交替/并发、错 tenant/deployment、空/撤回授权。
2. 提取只读 ProductDirectoryQuery，输入经验证权限上下文和分页条件，输出当前主档、产品线名称及接入关系；先影子读取对比列表/详情/下拉/线标题/候选，同主体检查 count 和字段。该服务不刷新 projection，不伪造 generation。
3. 提取 productcenter command 的事务执行层，复用同一 *sql.Tx 读取 Assets 当前主档并写 Aims 空间/来源/receipt；改造整线接入时保留部分接入、唯一来源、~line-身份、重复提交与并发冲突。命令前后不在事务中等待网络。
4. 编写 dry-run inventory/迁移工具，从目标只读信息读取 schema、列、索引、引擎、行数、触发器、collation 与 source receipt/outbox 状态；输出脱敏报告。apply 必须显式目标绑定、迁移锁和批次水位；演练在专属临时 MySQL 内进行。
5. 全部可达动作切换后再处置“同步目录”UI；保留历史接入快照与旧回执。实际业务库切换、旧任务退役和删除仍须 INT-206/207/208 与 P5/P7 证据。

## 7. 静态 DDL 字段、键与引用附录

以下直接提取仓库 CREATE TABLE 定义，精确字段名称及键/FK 以链接 DDL 为准，不宣称是已部署最终 schema。Aims schema 后续 ALTER TABLE 与独立 migrations 可能增加字段/约束；实施迁移工具必须合并这些变更并对照真实 SHOW CREATE TABLE。完整源码 DDL（含字段类型/default）仍是唯一 schema 定义，不另造第二份 DDL。

### assets.asset_category_groups

来源：[assets_schema.sql:33](../assets/docs/assets_schema.sql#L33)。

字段：`id`, `category_scope`, `category_value`, `category_label`, `short_code`, `description`, `enabled`, `sort_order`, `created_by`, `updated_by`, `created_at`, `updated_at`。

键与引用：

```sql
PRIMARY KEY (`id`)
UNIQUE KEY `uk_asset_category_scope_value` (`category_scope`, `category_value`)
KEY `idx_asset_category_scope_order` (`category_scope`, `sort_order`)
```

### assets.asset_category_items

来源：[assets_schema.sql:51](../assets/docs/assets_schema.sql#L51)。

字段：`id`, `group_id`, `item_value`, `item_label`, `short_code`, `description`, `enabled`, `sort_order`, `created_by`, `updated_by`, `created_at`, `updated_at`。

键与引用：

```sql
PRIMARY KEY (`id`)
UNIQUE KEY `uk_asset_category_item` (`group_id`, `item_value`)
KEY `idx_asset_category_item_order` (`group_id`, `sort_order`)
CONSTRAINT `fk_asset_category_item_group` FOREIGN KEY (`group_id`) REFERENCES `asset_category_groups` (`id`) ON DELETE CASCADE
```

### assets.asset_environments

来源：[assets_schema.sql:161](../assets/docs/assets_schema.sql#L161)。

字段：`id`, `environment_code`, `environment_name`, `environment_type`, `project_code`, `customer_code`, `contract_code`, `status`, `deployment_mode`, `region`, `idempotency_key`, `go_live_at`, `accepted_at`, `retired_at`, `dept_code`, `owner_uid`, `maintainer_uid`, `topology_summary`, `notes`, `created_by`, `updated_by`, `created_at`, `updated_at`。

键与引用：

```sql
PRIMARY KEY (`id`)
UNIQUE KEY `uk_environment_code` (`environment_code`)
UNIQUE KEY `uk_environment_idempotency` (`idempotency_key`)
KEY `idx_environment_project_status` (`project_code`, `status`)
KEY `idx_environment_contract` (`contract_code`)
KEY `idx_environment_customer` (`customer_code`, `status`)
```

### assets.asset_delivery_products

来源：[assets_schema.sql:242](../assets/docs/assets_schema.sql#L242)。

字段：`id`, `delivery_view_id`, `product_asset_id`, `relation_type`, `created_by`, `created_at`。

键与引用：

```sql
PRIMARY KEY (`id`)
UNIQUE KEY `uk_delivery_product` (`delivery_view_id`, `product_asset_id`, `relation_type`)
KEY `idx_delivery_product_product` (`product_asset_id`)
CONSTRAINT `fk_delivery_products_delivery` FOREIGN KEY (`delivery_view_id`) REFERENCES `asset_delivery_views` (`id`) ON DELETE CASCADE
CONSTRAINT `fk_delivery_products_product` FOREIGN KEY (`product_asset_id`) REFERENCES `product_assets` (`id`) ON DELETE CASCADE
```

### assets.customer_delivery_assets

来源：[assets_schema.sql:256](../assets/docs/assets_schema.sql#L256)。

字段：`id`, `delivery_asset_code`, `customer_code`, `contract_code`, `contract_line_code`, `obligation_code`, `project_code`, `delivery_view_code`, `asset_item_code`, `product_code`, `product_name`, `product_version`, `catalog_item_code`, `product_origin`, `asset_kind`, `deployment_mode`, `instance_key`, `tenant_key`, `environment_code`, `license_model`, `license_quantity`, `capacity`, `unit`, `status`, `planned_delivery_at`, `delivered_at`, `go_live_at`, `accepted_at`, `expired_at`, `terminated_at`, `warranty_start_at`, `warranty_end_at`, `support_expiry_at`, `responsible_uid`, `responsible_dept_code`, `source_app`, `source_biz_code`, `source_plan_code`, `idempotency_key`, `altoc_status_sync_revision`, `altoc_status_sync_fingerprint`, `altoc_status_sync_occurred_at`, `created_by`, `updated_by`, `created_at`, `updated_at`, `deleted_at`。

键与引用：

```sql
PRIMARY KEY (`id`)
UNIQUE KEY `uk_customer_delivery_asset_code` (`delivery_asset_code`)
UNIQUE KEY `uk_customer_delivery_asset_line` (`contract_code`, `contract_line_code`, `instance_key`)
KEY `idx_customer_delivery_asset_customer` (`customer_code`, `status`)
KEY `idx_customer_delivery_asset_contract` (`contract_code`, `status`)
KEY `idx_customer_delivery_asset_project` (`project_code`, `status`)
KEY `idx_customer_delivery_asset_source_plan` (`source_plan_code`)
KEY `idx_customer_delivery_asset_product` (`product_code`)
KEY `idx_customer_delivery_asset_asset_item` (`asset_item_code`)
KEY `idx_customer_delivery_asset_responsibility` (`responsible_uid`, `responsible_dept_code`, `status`)
CONSTRAINT `chk_customer_delivery_asset_responsibility_pair` CHECK (
```

### assets.customer_delivery_asset_environment_rel

来源：[assets_schema.sql:326](../assets/docs/assets_schema.sql#L326)。

字段：`id`, `delivery_asset_id`, `environment_id`, `relation_type`, `is_primary`, `deployment_status`, `deployed_version`, `effective_from`, `effective_to`, `status`, `source_project_code`, `created_by`, `updated_by`, `created_at`, `updated_at`, `deleted_at`, `active_relation_key`, `active_primary_key`。

键与引用：

```sql
PRIMARY KEY (`id`)
UNIQUE KEY `uk_cdaer_active_relation` (`active_relation_key`)
UNIQUE KEY `uk_cdaer_active_primary` (`active_primary_key`)
KEY `idx_cdaer_delivery_asset` (`delivery_asset_id`, `status`)
KEY `idx_cdaer_environment` (`environment_id`, `status`)
KEY `idx_cdaer_source_project` (`source_project_code`, `status`)
KEY `idx_cdaer_status` (`deployment_status`, `status`)
CONSTRAINT `fk_cdaer_delivery_asset` FOREIGN KEY (`delivery_asset_id`) REFERENCES `customer_delivery_assets` (`id`) ON DELETE RESTRICT
CONSTRAINT `fk_cdaer_environment` FOREIGN KEY (`environment_id`) REFERENCES `asset_environments` (`id`) ON DELETE RESTRICT
```

### assets.asset_documents

来源：[assets_schema.sql:360](../assets/docs/assets_schema.sql#L360)。

字段：`id`, `object_type`, `object_id`, `document_id`, `document_type`, `artifact_type`, `source_context`, `remark`, `linked_by`, `linked_at`。

键与引用：

```sql
PRIMARY KEY (`id`)
UNIQUE KEY `uk_object_document` (`object_type`, `object_id`, `document_id`)
```

### assets.product_assets

来源：[assets_schema.sql:375](../assets/docs/assets_schema.sql#L375)。

字段：`id`, `product_code`, `product_name`, `product_line`, `customer_domain`, `business_domain`, `product_level`, `asset_level`, `status`, `build_stage`, `current_version`, `target_version`, `productization_value_level`, `supported_terminals`, `covered_legacy_systems`, `summary`, `built_at`, `business_owner_uid`, `technical_owner_uid`, `project_code`, `notes`, `created_by`, `updated_by`, `created_at`, `updated_at`。

键与引用：

```sql
PRIMARY KEY (`id`)
UNIQUE KEY `uk_product_code` (`product_code`)
KEY `idx_product_line_status` (`product_line`, `status`)
KEY `idx_product_project_code` (`project_code`)
```

### assets.product_asset_bases

来源：[assets_schema.sql:428](../assets/docs/assets_schema.sql#L428)。

字段：`id`, `product_asset_id`, `technology_base_id`, `created_by`, `created_at`。

键与引用：

```sql
PRIMARY KEY (`id`)
UNIQUE KEY `uk_product_base` (`product_asset_id`, `technology_base_id`)
KEY `idx_product_base_base` (`technology_base_id`)
CONSTRAINT `fk_product_asset_bases_product` FOREIGN KEY (`product_asset_id`) REFERENCES `product_assets` (`id`) ON DELETE CASCADE
CONSTRAINT `fk_product_asset_bases_base` FOREIGN KEY (`technology_base_id`) REFERENCES `technology_bases` (`id`) ON DELETE CASCADE
```

### assets.product_asset_resources

来源：[assets_schema.sql:441](../assets/docs/assets_schema.sql#L441)。

字段：`id`, `product_asset_id`, `asset_id`, `relation_type`, `is_primary`, `created_by`, `created_at`。

键与引用：

```sql
PRIMARY KEY (`id`)
UNIQUE KEY `uk_product_asset_resource` (`product_asset_id`, `asset_id`, `relation_type`)
KEY `idx_product_asset_resource_asset` (`asset_id`)
CONSTRAINT `fk_product_asset_resources_product` FOREIGN KEY (`product_asset_id`) REFERENCES `product_assets` (`id`) ON DELETE CASCADE
CONSTRAINT `fk_product_asset_resources_asset` FOREIGN KEY (`asset_id`) REFERENCES `asset_items` (`id`) ON DELETE CASCADE
```

### assets.asset_events

来源：[assets_schema.sql:750](../assets/docs/assets_schema.sql#L750)。

字段：`id`, `object_type`, `object_id`, `event_type`, `event_data`, `operator_uid`, `occurred_at`。

键与引用：

```sql
PRIMARY KEY (`id`)
KEY `idx_event_object` (`object_type`, `object_id`)
KEY `idx_event_type_time` (`event_type`, `occurred_at`)
```

### assets.service_command_receipt

来源：[assets_schema.sql:764](../assets/docs/assets_schema.sql#L764)。

字段：`receipt_id`, `operation_id`, `operation_code`, `tenant_code`, `source_deployment_code`, `deployment_code`, `source_app`, `target_app`, `required_capability`, `idempotency_key`, `command_schema_version`, `command_sha256`, `status`, `locked_by`, `locked_until`, `fencing_token`, `version_no`, `first_request_id`, `last_request_id`, `correlation_id`, `original_actor_uid`, `service_client_id`, `target_biz_type`, `target_biz_code`, `response_http_status`, `response_summary_sha256`, `last_error_code`, `last_error_class`, `last_error_summary`, `received_at`, `last_received_at`, `completed_at`, `created_at`, `updated_at`。

键与引用：

```sql
UNIQUE KEY uk_scr_identity (identity_sha256)
UNIQUE KEY uk_scr_operation_id (operation_id)
CONSTRAINT chk_scr_cross_app CHECK (source_app <> target_app)
CONSTRAINT chk_scr_status CHECK (status IN ('processing', 'succeeded', 'rejected'))
```

### assets.assets_product_catalog_state

来源：[assets_schema.sql:817](../assets/docs/assets_schema.sql#L817)。

字段：`id`, `epoch`, `revision`, `ready`。

### aims.aims_projects

来源：[aims_schema.sql:98](../aims/docs/aims_schema.sql#L98)。

字段：`id`, `project_code`, `name`, `short_name`, `internal_code`, `description`, `category`, `methodology`, `lifecycle_status`, `portfolio_id`, `domain_code`, `dept_code`, `leader_uid`, `security_level`, `confidentiality_level`, `access_whitelist`, `start_date`, `end_date`, `opp_id`, `contract_id`, `customer_code`, `customer_name`, `contract_code`, `service_line_code`, `service_period_seq`, `service_period_start`, `service_period_end`, `service_period_label`, `approval_status`, `workflow_instance_id`, `template_set_id`, `template_version_id`, `module_config`, `board_config`, `workflow_config`, `notification_config`, `created_by`, `created_at`, `updated_at`。

键与引用：

```sql
PRIMARY KEY (`id`)
UNIQUE KEY `uk_project_code` (`project_code`)
UNIQUE KEY `uk_aims_project_opportunity_category` (`opp_id`, `category`)
KEY `idx_category` (`category`)
KEY `idx_lifecycle_status` (`lifecycle_status`)
KEY `idx_portfolio` (`portfolio_id`)
KEY `idx_domain_code` (`domain_code`)
KEY `idx_dept_code` (`dept_code`)
KEY `idx_leader_uid` (`leader_uid`)
KEY `idx_security_level_dept` (`security_level`, `dept_code`)
KEY `idx_confidentiality_security_dept` (`confidentiality_level`, `security_level`, `dept_code`)
KEY `idx_customer_code` (`customer_code`)
KEY `idx_opp_id` (`opp_id`)
KEY `idx_contract_id` (`contract_id`)
KEY `idx_service_line` (`service_line_code`, `service_period_seq`)
KEY `idx_template_set_id` (`template_set_id`)
KEY `idx_template_version_id` (`template_version_id`)
CONSTRAINT `fk_project_portfolio` FOREIGN KEY (`portfolio_id`) REFERENCES `project_portfolios` (`id`) ON DELETE SET NULL
CONSTRAINT `fk_project_template_set` FOREIGN KEY (`template_set_id`) REFERENCES `project_template_sets` (`id`) ON DELETE SET NULL
CONSTRAINT `fk_project_template_version` FOREIGN KEY (`template_version_id`) REFERENCES `project_template_versions` (`id`) ON DELETE SET NULL
```

### aims.product_versions

来源：[aims_schema.sql:430](../aims/docs/aims_schema.sql#L430)。

字段：`id`, `product_code`, `version_code`, `name`, `description`, `status`, `planned_release_date`, `released_at`, `released_by`, `milestone_id`, `owner_project_id`, `sort_order`, `created_by`, `created_at`, `updated_at`, `revision`, `scope_revision`, `planning_mode`, `business_owner_uid`, `current_release_record_id`。

键与引用：

```sql
PRIMARY KEY (`id`)
UNIQUE KEY `uk_product_version` (`product_code`, `version_code`)
KEY `idx_product_status` (`product_code`, `status`)
KEY `idx_version_milestone` (`milestone_id`)
KEY `idx_version_owner_project` (`owner_project_id`)
```

### aims.aims_project_products

来源：[aims_schema.sql:459](../aims/docs/aims_schema.sql#L459)。

字段：`id`, `project_id`, `product_code`, `product_name`, `version_id`, `is_primary`, `created_by`, `created_at`。

键与引用：

```sql
PRIMARY KEY (`id`)
UNIQUE KEY `uk_project_product` (`project_id`, `product_code`)
UNIQUE KEY `uk_project_primary` ((CASE WHEN `is_primary` = 1 THEN `project_id` END))
KEY `idx_project_product_code` (`product_code`)
KEY `idx_project_product_version` (`version_id`)
CONSTRAINT `fk_project_product_project` FOREIGN KEY (`project_id`)
CONSTRAINT `fk_project_product_version` FOREIGN KEY (`version_id`)
```

### aims.product_version_features

来源：[aims_schema.sql:479](../aims/docs/aims_schema.sql#L479)。

字段：`id`, `version_id`, `title`, `description`, `category`, `status`, `is_public`, `sort_order`, `created_by`, `created_at`, `updated_at`, `product_feature_id`, `planning_item_id`, `change_type`, `acceptance_criteria`, `deferred_from_feature_id`。

键与引用：

```sql
UNIQUE KEY `uk_pc_version_feature` (`version_id`,`product_feature_id`)
UNIQUE KEY `uk_pc_version_planning` (`planning_item_id`)
PRIMARY KEY (`id`)
KEY `idx_feature_version` (`version_id`, `sort_order`)
CONSTRAINT `fk_feature_version` FOREIGN KEY (`version_id`)
```

### aims.product_version_logs

来源：[aims_schema.sql:505](../aims/docs/aims_schema.sql#L505)。

字段：`id`, `version_id`, `action`, `old_value`, `new_value`, `operator_uid`, `note`, `created_at`。

键与引用：

```sql
PRIMARY KEY (`id`)
KEY `idx_version_log` (`version_id`, `created_at`)
CONSTRAINT `fk_version_log_version` FOREIGN KEY (`version_id`)
```

### aims.work_items

来源：[aims_schema.sql:530](../aims/docs/aims_schema.sql#L530)。

字段：`id`, `project_id`, `milestone_id`, `version_id`, `feature_id`, `item_number`, `item_key`, `tier`, `type`, `requirement_category`, `requirement_id`, `change_request_of`, `title`, `description`, `start_date`, `status`, `priority`, `severity`, `weight`, `assignee_uid`, `reporter_uid`, `due_date`, `estimated_hours`, `parent_id`, `sort_order`, `approval_status`, `review_level`, `required`, `template_key`, `routine_scope`, `beneficiary_dept_code`, `is_unplanned`, `carryover_origin_item_key`, `carryover_origin_milestone_id`, `carryover_count`, `carryover_governance_abnormal`, `decomposition_source_id`, `workflow_instance_id`, `created_at`, `updated_at`。

键与引用：

```sql
PRIMARY KEY (`id`)
UNIQUE KEY `uk_item_key` (`item_key`)
UNIQUE KEY `uk_project_item_number` (`project_id`, `item_number`)
UNIQUE KEY `uk_work_item_project_id` (`project_id`, `id`)
KEY `idx_project_status` (`project_id`, `status`)
KEY `idx_project_type` (`project_id`, `type`)
KEY `idx_milestone` (`milestone_id`)
KEY `idx_work_item_version` (`version_id`)
KEY `idx_work_item_feature` (`feature_id`)
KEY `idx_assignee` (`assignee_uid`)
KEY `idx_due_date` (`due_date`)
KEY `idx_work_items_due_scan` (`due_date`, `status`, `priority`, `severity`, `id`)
KEY `idx_parent` (`parent_id`)
KEY `idx_project_parent` (`project_id`, `parent_id`)
KEY `idx_work_item_project_required` (`project_id`, `required`)
KEY `idx_work_item_project_template_key` (`project_id`, `template_key`)
KEY `idx_routine_beneficiary` (`beneficiary_dept_code`, `routine_scope`)
KEY `idx_work_item_carryover_governance` (`project_id`, `carryover_governance_abnormal`, `carryover_count`)
KEY `idx_work_items_req_category` (`project_id`, `requirement_category`)
KEY `idx_work_items_decomp_src` (`decomposition_source_id`)
KEY `idx_type_status` (`type`, `status`)
KEY `idx_work_item_requirement` (`requirement_id`)
KEY `idx_work_item_change_request` (`change_request_of`)
CONSTRAINT `fk_item_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE
CONSTRAINT `fk_item_project_milestone` FOREIGN KEY (`project_id`, `milestone_id`) REFERENCES `milestones` (`project_id`, `id`) ON DELETE RESTRICT
CONSTRAINT `fk_item_parent` FOREIGN KEY (`parent_id`) REFERENCES `work_items` (`id`) ON DELETE SET NULL
CONSTRAINT `fk_work_item_change_request` FOREIGN KEY (`change_request_of`) REFERENCES `work_items` (`id`) ON DELETE SET NULL
CONSTRAINT `fk_work_item_version` FOREIGN KEY (`version_id`) REFERENCES `product_versions` (`id`) ON DELETE SET NULL
CONSTRAINT `fk_work_item_feature` FOREIGN KEY (`feature_id`) REFERENCES `product_version_features` (`id`) ON DELETE SET NULL
```

### aims.time_entries

来源：[aims_schema.sql:800](../aims/docs/aims_schema.sql#L800)。

字段：`id`, `project_id`, `work_item_id`, `weekly_report_id`, `uid`, `entry_date`, `hours`, `description`, `review_status`, `review_route`, `reviewer_uid_snapshot`, `locked_report_version_id`, `row_version`, `submitted_at`, `reviewed_by`, `reviewed_at`, `return_reason`, `approved_summary_version_id`, `corrects_entry_id`, `created_at`, `updated_at`。

键与引用：

```sql
PRIMARY KEY (`id`)
KEY `idx_project_date` (`project_id`, `entry_date`)
KEY `idx_work_item` (`work_item_id`)
KEY `idx_weekly_report` (`weekly_report_id`)
KEY `idx_uid_date` (`uid`, `entry_date`)
KEY `idx_time_review_status` (`review_status`, `entry_date`)
KEY `idx_time_corrects_entry` (`corrects_entry_id`)
CONSTRAINT `fk_time_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE
CONSTRAINT `fk_time_item` FOREIGN KEY (`work_item_id`) REFERENCES `work_items` (`id`) ON DELETE CASCADE
CONSTRAINT `fk_time_weekly_report` FOREIGN KEY (`weekly_report_id`) REFERENCES `project_weekly_reports` (`id`) ON DELETE CASCADE
```

### aims.integration_operation

来源：[aims_schema.sql:1394](../aims/docs/aims_schema.sql#L1394)。

字段：`operation_id`, `operation_key`, `correlation_key`, `sequence_no`, `depends_on_operation_key`, `tenant_code`, `deployment_code`, `source_app`, `target_app`, `operation_code`, `required_capability`, `source_biz_type`, `source_biz_code`, `target_receipt_id`, `target_biz_type`, `target_biz_code`, `idempotency_key`, `command_schema_version`, `command_json`, `command_sha256`, `status`, `attempt_count`, `max_attempts`, `next_attempt_at`, `last_attempt_at`, `locked_by`, `locked_until`, `fencing_token`, `version_no`, `original_request_id`, `correlation_id`, `original_actor_uid`, `service_client_id`, `replay_count`, `last_replay_actor_uid`, `last_replay_reason`, `last_replay_at`, `last_http_status`, `last_error_code`, `last_error_class`, `last_error_summary`, `last_error_at`, `response_summary_sha256`, `failure_notified_at`, `failure_notification_id`, `succeeded_at`, `failed_permanent_at`, `dead_lettered_at`, `cancelled_at`, `created_by`, `updated_by`, `created_at`, `updated_at`。

键与引用：

```sql
UNIQUE KEY uk_iop_identity (tenant_code, deployment_code, source_app, target_app, operation_code, idempotency_key)
UNIQUE KEY uk_iop_operation_key (tenant_code, deployment_code, source_app, operation_key)
UNIQUE KEY uk_iop_chain_sequence (tenant_code, deployment_code, source_app, correlation_key, sequence_no)
CONSTRAINT chk_iop_cross_app CHECK (source_app <> target_app)
CONSTRAINT chk_iop_status CHECK (status IN ('pending', 'processing', 'retry_wait', 'partial_unknown', 'succeeded', 'failed_permanent', 'dead_letter', 'cancelled'))
```

### aims.integration_operation_dead_letter_actionable

来源：[aims_schema.sql:1465](../aims/docs/aims_schema.sql#L1465)。

字段：`operation_id`, `generation_no`, `tenant_code`, `deployment_code`, `source_app`, `target_app`, `operation_code`, `source_biz_type`, `source_biz_code`, `attempt_count`, `max_attempts`, `last_error_code`, `last_error_class`, `dead_lettered_at`, `original_actor_uid`, `source_operation_version`, `actionable_key`, `publish_object_version`, `notification_id`, `recipient_uids`, `publish_acked_at`, `closure_state`, `closure_object_version`, `closure_pending_at`, `closure_acked_at`, `created_at`, `updated_at`。

键与引用：

```sql
PRIMARY KEY (operation_id, generation_no)
UNIQUE KEY uk_iopdla_actionable (tenant_code, deployment_code, source_app, actionable_key)
UNIQUE KEY uk_iopdla_notification (tenant_code, deployment_code, source_app, notification_id)
CONSTRAINT fk_iopdla_operation FOREIGN KEY (operation_id) REFERENCES integration_operation(operation_id) ON DELETE RESTRICT
CONSTRAINT chk_iopdla_closure CHECK (closure_state IS NULL OR closure_state IN ('resolved','cancelled'))
CONSTRAINT chk_iopdla_recipient CHECK (recipient_uids IS NULL OR JSON_TYPE(recipient_uids) = 'ARRAY')
```

### aims.integration_operation_attempt

来源：[aims_schema.sql:1503](../aims/docs/aims_schema.sql#L1503)。

字段：`attempt_id`, `operation_id`, `operation_code`, `attempt_no`, `trigger_type`, `request_id`, `correlation_id`, `locked_by`, `fencing_token`, `result_status`, `http_status`, `error_code`, `error_class`, `error_summary`, `target_biz_type`, `target_biz_code`, `response_summary_sha256`, `started_at`, `finished_at`, `duration_ms`, `created_at`。

键与引用：

```sql
UNIQUE KEY uk_ioa_operation_attempt (operation_id, attempt_no)
CONSTRAINT fk_ioa_operation FOREIGN KEY (operation_id) REFERENCES integration_operation(operation_id) ON DELETE RESTRICT
CONSTRAINT chk_ioa_result_status CHECK (result_status IN ('processing', 'succeeded', 'retry_wait', 'partial_unknown', 'failed_permanent', 'dead_letter', 'cancelled'))
```

### aims.service_command_receipt

来源：[aims_schema.sql:1537](../aims/docs/aims_schema.sql#L1537)。

字段：`receipt_id`, `operation_id`, `operation_code`, `tenant_code`, `source_deployment_code`, `deployment_code`, `source_app`, `target_app`, `required_capability`, `idempotency_key`, `command_schema_version`, `command_sha256`, `status`, `locked_by`, `locked_until`, `fencing_token`, `version_no`, `first_request_id`, `last_request_id`, `correlation_id`, `original_actor_uid`, `service_client_id`, `target_biz_type`, `target_biz_code`, `response_http_status`, `response_summary_sha256`, `last_error_code`, `last_error_class`, `last_error_summary`, `received_at`, `last_received_at`, `completed_at`, `created_at`, `updated_at`。

键与引用：

```sql
UNIQUE KEY uk_scr_identity (identity_sha256)
UNIQUE KEY uk_scr_operation_id (operation_id)
CONSTRAINT chk_scr_cross_app CHECK (source_app <> target_app)
CONSTRAINT chk_scr_status CHECK (status IN ('processing', 'succeeded', 'rejected'))
```

### aims.product_workspaces

来源：[aims_schema.sql:2145](../aims/docs/aims_schema.sql#L2145)。

字段：`product_code`, `biz_id`, `positioning`, `target_users`, `value_statement`, `status`, `revision`, `created_by`, `updated_by`, `created_at`, `updated_at`。

键与引用：

```sql
PRIMARY KEY (product_code), UNIQUE KEY uk_pc_workspace_biz (biz_id)
```

### aims.product_members

来源：[aims_schema.sql:2160](../aims/docs/aims_schema.sql#L2160)。

字段：`id`, `product_code`, `uid`, `relation_type`, `status`, `valid_from`, `valid_until`, `revision`, `created_by`, `updated_by`, `created_at`, `updated_at`。

键与引用：

```sql
PRIMARY KEY (id), UNIQUE KEY uk_pc_member (product_code,uid,relation_type)
KEY idx_pc_member_subject (uid,status,product_code)
CONSTRAINT fk_pc_member_product FOREIGN KEY (product_code) REFERENCES product_workspaces(product_code)
CONSTRAINT ck_pc_member_dates CHECK (valid_until IS NULL OR valid_until > valid_from)
```

### aims.product_requests

来源：[aims_schema.sql:2179](../aims/docs/aims_schema.sql#L2179)。

字段：`id`, `biz_id`, `product_code`, `component_id`, `title`, `problem_statement`, `source_type`, `urgency_level`, `decision_status`, `decision_reason`, `decided_by`, `decided_at`, `merged_into_id`, `revision`, `created_by`, `updated_by`, `created_at`, `updated_at`。

键与引用：

```sql
PRIMARY KEY (id), UNIQUE KEY uk_pc_request_biz (biz_id)
UNIQUE KEY uk_pc_request_scope (id,product_code)
KEY idx_pc_request_list (product_code,decision_status,id)
KEY idx_pc_request_component (product_code,component_id,id)
CONSTRAINT fk_pc_request_product FOREIGN KEY (product_code) REFERENCES product_workspaces(product_code)
CONSTRAINT fk_pc_request_merge FOREIGN KEY (merged_into_id,product_code) REFERENCES product_requests(id,product_code)
```

### aims.product_request_sources

来源：[aims_schema.sql:2206](../aims/docs/aims_schema.sql#L2206)。

字段：`id`, `request_id`, `source_app`, `source_type`, `source_biz_id`, `source_note`, `evidence_date`, `evidence_kind`, `direction`, `verification_status`, `revision`, `created_by`, `updated_by`, `created_at`, `updated_at`。

键与引用：

```sql
PRIMARY KEY (id), KEY idx_pc_source_request (request_id,id)
CONSTRAINT fk_pc_source_request FOREIGN KEY (request_id) REFERENCES product_requests(id)
```

### aims.product_components

来源：[aims_schema.sql:2226](../aims/docs/aims_schema.sql#L2226)。

字段：`id`, `biz_id`, `product_code`, `parent_id`, `name`, `description`, `sort_order`, `revision`, `created_by`, `updated_by`, `created_at`, `updated_at`。

键与引用：

```sql
PRIMARY KEY(id)
UNIQUE KEY uk_pc_component_biz(biz_id)
UNIQUE KEY uk_pc_component_scope(id,product_code)
KEY idx_pc_component_tree(product_code,parent_id,sort_order,id)
CONSTRAINT fk_pc_component_product FOREIGN KEY(product_code) REFERENCES product_workspaces(product_code)
CONSTRAINT fk_pc_component_parent FOREIGN KEY(parent_id,product_code) REFERENCES product_components(id,product_code)
```

### aims.product_features

来源：[aims_schema.sql:2247](../aims/docs/aims_schema.sql#L2247)。

字段：`id`, `biz_id`, `product_code`, `component_id`, `title`, `description`, `lifecycle`, `lifecycle_evidence`, `revision`, `created_by`, `updated_by`, `created_at`, `updated_at`。

键与引用：

```sql
PRIMARY KEY (id), UNIQUE KEY uk_pc_feature_biz (biz_id)
UNIQUE KEY uk_pc_feature_scope (id,product_code)
KEY idx_pc_feature_list (product_code,lifecycle,id)
CONSTRAINT fk_pc_feature_component FOREIGN KEY(component_id,product_code) REFERENCES product_components(id,product_code)
CONSTRAINT fk_pc_feature_product FOREIGN KEY (product_code) REFERENCES product_workspaces(product_code)
```

### aims.product_request_features

来源：[aims_schema.sql:2268](../aims/docs/aims_schema.sql#L2268)。

字段：`product_code`, `request_id`, `product_feature_id`, `created_by`, `created_at`。

键与引用：

```sql
PRIMARY KEY (request_id,product_feature_id)
CONSTRAINT fk_pc_rf_request FOREIGN KEY (request_id,product_code) REFERENCES product_requests(id,product_code)
CONSTRAINT fk_pc_rf_feature FOREIGN KEY (product_feature_id,product_code) REFERENCES product_features(id,product_code)
```

### aims.product_planning_cycles

来源：[aims_schema.sql:2279](../aims/docs/aims_schema.sql#L2279)。

字段：`id`, `biz_id`, `product_code`, `title`, `starts_on`, `ends_on`, `goal_summary`, `metric_definition`, `baseline_value`, `target_value`, `total_person_days`, `reserve_person_days`, `reliability_person_days`, `usability_person_days`, `growth_person_days`, `model_version`, `model_snapshot`, `matrix_value_threshold`, `matrix_effort_threshold`, `review_interval_days`, `next_review_at`, `status`, `open_product_code`, `queue_revision`, `revision`, `closed_snapshot`, `created_by`, `updated_by`, `created_at`, `updated_at`。

键与引用：

```sql
PRIMARY KEY (id), UNIQUE KEY uk_pc_cycle_biz (biz_id)
UNIQUE KEY uk_pc_cycle_scope (id,product_code)
UNIQUE KEY uk_pc_cycle_open (open_product_code)
KEY idx_pc_cycle_list (product_code,status,id)
CONSTRAINT fk_pc_cycle_product FOREIGN KEY (product_code) REFERENCES product_workspaces(product_code)
CONSTRAINT ck_pc_cycle_dates CHECK (ends_on >= starts_on)
CONSTRAINT ck_pc_cycle_interval CHECK (review_interval_days BETWEEN 1 AND 366)
CONSTRAINT ck_pc_cycle_nonnegative CHECK (
CONSTRAINT ck_pc_cycle_capacity CHECK (
CONSTRAINT ck_pc_cycle_open_capacity CHECK (status <> 'open' OR (
```

### aims.product_planning_items

来源：[aims_schema.sql:2327](../aims/docs/aims_schema.sql#L2327)。

字段：`id`, `biz_id`, `product_code`, `title`, `scope_summary`, `feature_id`, `derived_from_id`, `merged_into_id`, `urgency_level`, `deadline`, `deadline_evidence`, `investment_category`, `lifecycle`, `scope_revision`, `evidence_revision`, `revision`, `created_by`, `updated_by`, `created_at`, `updated_at`。

键与引用：

```sql
PRIMARY KEY (id), UNIQUE KEY uk_pc_planning_biz (biz_id)
UNIQUE KEY uk_pc_planning_scope (id,product_code)
KEY idx_pc_planning_list (product_code,lifecycle,id)
CONSTRAINT fk_pc_planning_product FOREIGN KEY (product_code) REFERENCES product_workspaces(product_code)
CONSTRAINT fk_pc_planning_feature FOREIGN KEY (feature_id,product_code) REFERENCES product_features(id,product_code)
CONSTRAINT fk_pc_planning_origin FOREIGN KEY (derived_from_id,product_code) REFERENCES product_planning_items(id,product_code)
CONSTRAINT fk_pc_planning_merge FOREIGN KEY (merged_into_id,product_code) REFERENCES product_planning_items(id,product_code)
```

### aims.product_planning_item_requests

来源：[aims_schema.sql:2357](../aims/docs/aims_schema.sql#L2357)。

字段：`product_code`, `planning_item_id`, `request_id`, `created_by`, `created_at`。

键与引用：

```sql
PRIMARY KEY (planning_item_id,request_id)
CONSTRAINT fk_pc_ir_item FOREIGN KEY (planning_item_id,product_code) REFERENCES product_planning_items(id,product_code)
CONSTRAINT fk_pc_ir_request FOREIGN KEY (request_id,product_code) REFERENCES product_requests(id,product_code)
```

### aims.product_planning_cycle_items

来源：[aims_schema.sql:2368](../aims/docs/aims_schema.sql#L2368)。

字段：`cycle_id`, `planning_item_id`, `product_code`, `selection_status`, `decision_rank`, `roadmap_bucket`, `current_assessment_id`, `decision_snapshot`, `decided_by`, `decision_reason`, `decided_at`。

键与引用：

```sql
PRIMARY KEY (cycle_id,planning_item_id)
UNIQUE KEY uk_pc_cycle_rank (cycle_id,decision_rank)
CONSTRAINT fk_pc_ci_cycle FOREIGN KEY (cycle_id,product_code) REFERENCES product_planning_cycles(id,product_code)
CONSTRAINT fk_pc_ci_item FOREIGN KEY (planning_item_id,product_code) REFERENCES product_planning_items(id,product_code)
```

### aims.product_priority_assessments

来源：[aims_schema.sql:2386](../aims/docs/aims_schema.sql#L2386)。

字段：`id`, `cycle_id`, `planning_item_id`, `scope_revision`, `evidence_revision`, `model_version`, `model_snapshot`, `strategic`, `user_value`, `business`, `risk`, `confidence`, `effort_person_days`, `effort_unit`, `value_score`, `priority_score`, `evidence_snapshot`, `rationale`, `assessed_by`, `estimated_by`, `assessed_at`。

键与引用：

```sql
PRIMARY KEY (id), UNIQUE KEY uk_pc_assessment_identity (id,cycle_id,planning_item_id)
KEY idx_pc_assessment_history (cycle_id,planning_item_id,id)
CONSTRAINT fk_pc_assessment_item FOREIGN KEY (cycle_id,planning_item_id) REFERENCES product_planning_cycle_items(cycle_id,planning_item_id)
CONSTRAINT ck_pc_assessment_dimensions CHECK (strategic <= 5 AND user_value <= 5 AND business <= 5 AND risk <= 5)
CONSTRAINT ck_pc_assessment_confidence CHECK (confidence IN (0.50,0.80,1.00))
CONSTRAINT ck_pc_assessment_effort CHECK (effort_person_days BETWEEN 0.50 AND 1000000.00)
CONSTRAINT ck_pc_assessment_unit CHECK (effort_unit='person_day')
CONSTRAINT ck_pc_assessment_value CHECK (value_score <= 100)
CONSTRAINT ck_pc_assessment_score CHECK (priority_score >= 0)
CONSTRAINT ck_pc_assessment_complete CHECK (priority_score IS NULL OR (
```

### aims.product_planning_dependencies

来源：[aims_schema.sql:2422](../aims/docs/aims_schema.sql#L2422)。

字段：`product_code`, `planning_item_id`, `predecessor_id`, `created_by`, `created_at`。

键与引用：

```sql
PRIMARY KEY (planning_item_id,predecessor_id)
CONSTRAINT fk_pc_dep_item FOREIGN KEY (planning_item_id,product_code) REFERENCES product_planning_items(id,product_code)
CONSTRAINT fk_pc_dep_predecessor FOREIGN KEY (predecessor_id,product_code) REFERENCES product_planning_items(id,product_code)
```

### aims.product_planning_comments

来源：[aims_schema.sql:2433](../aims/docs/aims_schema.sql#L2433)。

字段：`id`, `planning_item_id`, `cycle_id`, `author_uid`, `body`, `revision`, `deleted_at`, `created_at`, `updated_at`。

键与引用：

```sql
PRIMARY KEY (id), KEY idx_pc_comment_item (planning_item_id,id)
CONSTRAINT fk_pc_comment_cycle_item FOREIGN KEY (cycle_id,planning_item_id) REFERENCES product_planning_cycle_items(cycle_id,planning_item_id)
CONSTRAINT fk_pc_comment_item FOREIGN KEY (planning_item_id) REFERENCES product_planning_items(id)
```

### aims.product_outcome_observations

来源：[aims_schema.sql:2448](../aims/docs/aims_schema.sql#L2448)。

字段：`id`, `cycle_id`, `metric_snapshot`, `observed_value`, `observed_at`, `evidence`, `conclusion`, `correction_of_id`, `recorded_by`, `recorded_at`。

键与引用：

```sql
PRIMARY KEY (id), UNIQUE KEY uk_pc_observation_scope (id,cycle_id)
KEY idx_pc_observation_cycle (cycle_id,id)
CONSTRAINT fk_pc_observation_cycle FOREIGN KEY (cycle_id) REFERENCES product_planning_cycles(id)
CONSTRAINT fk_pc_observation_correction FOREIGN KEY (correction_of_id,cycle_id) REFERENCES product_outcome_observations(id,cycle_id)
```

### aims.product_request_delivery_links

来源：[aims_schema.sql:2465](../aims/docs/aims_schema.sql#L2465)。

字段：`id`, `product_code`, `planning_item_id`, `request_id`, `project_id`, `requirement_id`, `source_revision`, `scope_snapshot`, `delivery_slice_key`, `planned_version_id`, `planned_version_feature_id`, `created_by`, `created_at`。

键与引用：

```sql
PRIMARY KEY (id)
UNIQUE KEY uk_pc_delivery_slice (planning_item_id,project_id,delivery_slice_key)
UNIQUE KEY uk_pc_delivery_requirement (planning_item_id,requirement_id)
CONSTRAINT fk_pc_delivery_item FOREIGN KEY (planning_item_id,product_code) REFERENCES product_planning_items(id,product_code)
CONSTRAINT fk_pc_delivery_request FOREIGN KEY (request_id,product_code) REFERENCES product_requests(id,product_code)
```

### aims.product_activity_logs

来源：[aims_schema.sql:2488](../aims/docs/aims_schema.sql#L2488)。

字段：`id`, `product_code`, `object_type`, `object_id`, `action`, `actor_uid`, `revision`, `changes`, `request_id`, `created_at`。

键与引用：

```sql
PRIMARY KEY (id), KEY idx_pc_activity_product (product_code,id)
KEY idx_pc_activity_object (product_code,object_type,object_id,id)
```

### aims.product_command_receipts

来源：[aims_schema.sql:2503](../aims/docs/aims_schema.sql#L2503)。

字段：`id`, `product_code`, `action`, `actor_uid`, `idempotency_key`, `execution_id`, `request_hash`, `status`, `result_json`, `created_at`, `completed_at`。

键与引用：

```sql
PRIMARY KEY (id), UNIQUE KEY uk_pc_command (product_code,action,actor_uid,idempotency_key)
```

### aims.product_catalog_control

来源：[aims_schema.sql:2518](../aims/docs/aims_schema.sql#L2518)。

字段：`id`。

键与引用：

```sql
CONSTRAINT ck_pc_catalog_singleton CHECK (id=1)
```

### aims.product_catalog_refreshes

来源：[aims_schema.sql:2524](../aims/docs/aims_schema.sql#L2524)。

字段：`id`, `biz_id`, `status`, `active_slot`, `source_watermark`, `source_cursor`, `row_count`, `revision`, `created_by`, `created_at`, `completed_at`。

键与引用：

```sql
PRIMARY KEY (id), UNIQUE KEY uk_pc_refresh_biz (biz_id), UNIQUE KEY uk_pc_catalog_active (active_slot)
```

### aims.product_catalog_page_receipts

来源：[aims_schema.sql:2539](../aims/docs/aims_schema.sql#L2539)。

字段：`generation`, `page_number`, `request_hash`, `result_json`, `created_at`。

键与引用：

```sql
PRIMARY KEY (generation,page_number)
CONSTRAINT fk_pc_catalog_page_generation FOREIGN KEY (generation) REFERENCES product_catalog_refreshes(id)
```

### aims.product_catalog_projection

来源：[aims_schema.sql:2549](../aims/docs/aims_schema.sql#L2549)。

字段：`generation`, `product_code`, `product_name`, `product_line`, `product_line_label`, `product_line_sort_order`, `source_status`, `business_owner_uid`, `technical_owner_uid`, `source_updated_at`, `synced_at`。

键与引用：

```sql
PRIMARY KEY (generation,product_code)
KEY idx_pc_catalog_line (generation,product_line,product_code)
CONSTRAINT fk_pc_catalog_generation FOREIGN KEY (generation) REFERENCES product_catalog_refreshes(id)
```

### aims.product_version_acceptances

来源：[aims_schema.sql:2566](../aims/docs/aims_schema.sql#L2566)。

字段：`id`, `version_id`, `scope_revision`, `accepted_by`, `accepted_at`, `checklist`, `exceptions`。

键与引用：

```sql
PRIMARY KEY (id), KEY idx_pc_acceptance_version (version_id,scope_revision,id)
CONSTRAINT fk_pc_acceptance_version FOREIGN KEY (version_id) REFERENCES product_versions(id)
```

### aims.product_release_records

来源：[aims_schema.sql:2578](../aims/docs/aims_schema.sql#L2578)。

字段：`id`, `biz_id`, `version_id`, `release_seq`, `scope_revision`, `scope_snapshot`, `acceptance_snapshot`, `content_hash`, `released_by`, `released_at`, `evidence_level`, `supersedes_record_id`, `recorded_at`。

键与引用：

```sql
PRIMARY KEY (id), UNIQUE KEY uk_pc_release_biz (biz_id)
UNIQUE KEY uk_pc_release_seq (version_id,release_seq)
UNIQUE KEY uk_pc_release_scope (id,version_id)
CONSTRAINT fk_pc_release_version FOREIGN KEY (version_id) REFERENCES product_versions(id)
CONSTRAINT fk_pc_release_supersedes FOREIGN KEY (supersedes_record_id,version_id) REFERENCES product_release_records(id,version_id)
```

### aims.product_release_events

来源：[aims_schema.sql:2599](../aims/docs/aims_schema.sql#L2599)。

字段：`id`, `release_record_id`, `event_type`, `actor_uid`, `reason`, `created_at`。

键与引用：

```sql
PRIMARY KEY (id), KEY idx_pc_release_event (release_record_id,id)
CONSTRAINT fk_pc_release_event FOREIGN KEY (release_record_id) REFERENCES product_release_records(id)
```

### aims.product_version_plans

来源：[aims_schema.sql:2620](../aims/docs/aims_schema.sql#L2620)。

字段：`version_id`, `goal`, `revision`, `created_by`。

键与引用：

```sql
PRIMARY KEY(version_id), KEY idx_pc_plan_product(product_code,version_id)
CONSTRAINT fk_pc_plan_version FOREIGN KEY(version_id) REFERENCES product_versions(id) ON DELETE CASCADE
CONSTRAINT fk_pc_plan_product FOREIGN KEY(product_code) REFERENCES product_workspaces(product_code)
CONSTRAINT ck_pc_plan_capacity CHECK(available_person_days IS NULL OR available_person_days>=0), CONSTRAINT ck_pc_plan_reserve CHECK(reserve_person_days IS NULL OR reserve_person_days>=0)
```

### aims.product_version_plan_scopes

来源：[aims_schema.sql:2630](../aims/docs/aims_schema.sql#L2630)。

字段：`version_feature_id`, `request_id`, `revision`。

键与引用：

```sql
PRIMARY KEY(version_feature_id), UNIQUE KEY uk_pc_plan_scope_request(version_id,request_id), UNIQUE KEY uk_pc_plan_scope_item(planning_item_id), KEY idx_pc_plan_scope_version(version_id,version_feature_id)
CONSTRAINT fk_pc_plan_scope_feature FOREIGN KEY(version_feature_id) REFERENCES product_version_features(id) ON DELETE CASCADE
CONSTRAINT fk_pc_plan_scope_version FOREIGN KEY(version_id) REFERENCES product_versions(id) ON DELETE CASCADE
CONSTRAINT fk_pc_plan_scope_request FOREIGN KEY(request_id,product_code) REFERENCES product_requests(id,product_code)
CONSTRAINT fk_pc_plan_scope_item FOREIGN KEY(planning_item_id,product_code) REFERENCES product_planning_items(id,product_code)
CONSTRAINT ck_pc_plan_scope_estimate CHECK(estimate_person_days IS NULL OR estimate_person_days>0)
```

### aims.product_version_plan_confirmations

来源：[aims_schema.sql:2641](../aims/docs/aims_schema.sql#L2641)。

字段：`id`, `snapshot`。

键与引用：

```sql
PRIMARY KEY(id), KEY idx_pc_plan_confirmation(version_id,id), CONSTRAINT fk_pc_plan_confirmation_version FOREIGN KEY(version_id) REFERENCES product_versions(id) ON DELETE CASCADE
CONSTRAINT ck_pc_plan_confirmation_invalidation CHECK((invalidated_at IS NULL AND invalidated_by IS NULL) OR (invalidated_at IS NOT NULL AND invalidated_by IS NOT NULL))
```

### aims.product_objectives

来源：[aims_schema.sql:2713](../aims/docs/aims_schema.sql#L2713)。

字段：`id`, `biz_id`, `product_code`, `title`, `description`, `starts_on`, `ends_on`, `owner_uid`, `metric_name`, `metric_unit`, `measurement_definition`, `direction`, `baseline_value`, `target_value`, `status`, `revision`, `created_by`, `updated_by`, `created_at`, `updated_at`。

键与引用：

```sql
PRIMARY KEY(id)
UNIQUE KEY uk_pc_objective_biz(biz_id)
UNIQUE KEY uk_pc_objective_scope(id,product_code)
KEY idx_pc_objective_period(product_code,status,starts_on,ends_on,id)
CONSTRAINT fk_pc_objective_product FOREIGN KEY(product_code) REFERENCES product_workspaces(product_code)
CONSTRAINT ck_pc_objective_period CHECK(ends_on>=starts_on)
CONSTRAINT ck_pc_objective_direction CHECK(direction IN ('increase','decrease'))
CONSTRAINT ck_pc_objective_target CHECK((direction='increase' AND target_value>baseline_value) OR (direction='decrease' AND target_value<baseline_value))
CONSTRAINT ck_pc_objective_status CHECK(status IN ('draft','active','closed','archived'))
```

### aims.product_objective_items

来源：[aims_schema.sql:2744](../aims/docs/aims_schema.sql#L2744)。

字段：`objective_id`, `planning_item_id`, `product_code`, `contribution_note`, `created_by`, `created_at`。

键与引用：

```sql
PRIMARY KEY(objective_id,planning_item_id)
KEY idx_pc_objective_item_scope(planning_item_id,product_code)
CONSTRAINT fk_pc_objective_item_goal FOREIGN KEY(objective_id,product_code) REFERENCES product_objectives(id,product_code)
CONSTRAINT fk_pc_objective_item_planning FOREIGN KEY(planning_item_id,product_code) REFERENCES product_planning_items(id,product_code)
```

### aims.product_objective_observations

来源：[aims_schema.sql:2756](../aims/docs/aims_schema.sql#L2756)。

字段：`id`, `biz_id`, `objective_id`, `product_code`, `objective_revision`, `metric_snapshot`, `observed_on`, `measured_value`, `evidence`, `note`, `created_by`, `created_at`。

键与引用：

```sql
PRIMARY KEY(id)
UNIQUE KEY uk_pc_objective_observation_biz(biz_id)
KEY idx_pc_objective_observation_date(objective_id,observed_on,id)
CONSTRAINT fk_pc_objective_observation FOREIGN KEY(objective_id,product_code) REFERENCES product_objectives(id,product_code)
```

### aims.product_objective_cycles

来源：[aims_schema.sql:2807](../aims/docs/aims_schema.sql#L2807)。

字段：`id`, `biz_id`, `product_code`, `objective_id`, `cycle_id`, `objective_revision`, `cycle_revision`, `objective_snapshot`, `cycle_snapshot`, `mapping_note`, `created_by`, `created_at`, `revoked_by`, `revoked_at`, `revocation_reason`, `active_cycle_id`。

键与引用：

```sql
PRIMARY KEY(id)
UNIQUE KEY uk_pc_objective_cycle_biz(biz_id)
UNIQUE KEY uk_pc_objective_cycle_active(objective_id,active_cycle_id)
KEY idx_pc_objective_cycle_scope(cycle_id,product_code)
CONSTRAINT fk_pc_objective_cycle_goal FOREIGN KEY(objective_id,product_code) REFERENCES product_objectives(id,product_code)
CONSTRAINT fk_pc_objective_cycle_cycle FOREIGN KEY(cycle_id,product_code) REFERENCES product_planning_cycles(id,product_code)
CONSTRAINT ck_pc_objective_cycle_revision CHECK(objective_revision>0 AND cycle_revision>0)
CONSTRAINT ck_pc_objective_cycle_note CHECK(CHAR_LENGTH(TRIM(mapping_note))>0)
CONSTRAINT ck_pc_objective_cycle_revocation CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND CHAR_LENGTH(TRIM(revoked_by))>0 AND revocation_reason IS NOT NULL AND CHAR_LENGTH(TRIM(revocation_reason))>0))
```

### aims.product_roadmap_commitments

来源：[aims_schema.sql:2867](../aims/docs/aims_schema.sql#L2867)。

字段：`id`, `biz_id`, `product_code`, `planning_item_id`, `cycle_id`, `item_revision`, `scope_revision`, `evidence_revision`, `cycle_revision`, `queue_revision`, `starts_on`, `ends_on`, `item_snapshot`, `decision_snapshot`, `model_snapshot`, `reason`, `created_by`, `created_at`。

键与引用：

```sql
PRIMARY KEY(id)
UNIQUE KEY uk_pc_roadmap_commitment_biz(biz_id)
KEY idx_pc_roadmap_commitment_item(planning_item_id,product_code,id)
KEY idx_pc_roadmap_commitment_cycle(cycle_id,product_code,id)
CONSTRAINT fk_pc_roadmap_commitment_item FOREIGN KEY(planning_item_id,product_code) REFERENCES product_planning_items(id,product_code)
CONSTRAINT fk_pc_roadmap_commitment_cycle FOREIGN KEY(cycle_id,product_code) REFERENCES product_planning_cycles(id,product_code)
CONSTRAINT ck_pc_roadmap_commitment_revisions CHECK(item_revision>0 AND scope_revision>0 AND evidence_revision>0 AND cycle_revision>0 AND queue_revision>0)
CONSTRAINT ck_pc_roadmap_commitment_dates CHECK(ends_on>=starts_on)
CONSTRAINT ck_pc_roadmap_commitment_reason CHECK(CHAR_LENGTH(TRIM(reason))>0 AND CHAR_LENGTH(TRIM(created_by))>0)
CONSTRAINT ck_pc_roadmap_commitment_snapshots CHECK(JSON_TYPE(item_snapshot)='OBJECT' AND JSON_TYPE(decision_snapshot)='OBJECT' AND JSON_TYPE(model_snapshot)='OBJECT')
```

### aims.product_cross_dependencies

来源：[aims_schema.sql:2904](../aims/docs/aims_schema.sql#L2904)。

字段：`id`, `biz_id`, `product_code`, `planning_item_id`, `predecessor_product_code`, `predecessor_id`, `revision`, `reason`, `created_by`, `updated_by`, `created_at`, `updated_at`。

键与引用：

```sql
PRIMARY KEY(id)
UNIQUE KEY uk_pc_cross_dependency_biz(biz_id)
UNIQUE KEY uk_pc_cross_dependency_edge(planning_item_id,predecessor_id)
KEY idx_pc_cross_dependency_source(planning_item_id,product_code)
KEY idx_pc_cross_dependency_target(predecessor_id,predecessor_product_code)
CONSTRAINT fk_pc_cross_dependency_source FOREIGN KEY(planning_item_id,product_code) REFERENCES product_planning_items(id,product_code)
CONSTRAINT fk_pc_cross_dependency_target FOREIGN KEY(predecessor_id,predecessor_product_code) REFERENCES product_planning_items(id,product_code)
CONSTRAINT ck_pc_cross_dependency_products CHECK(BINARY product_code<>BINARY predecessor_product_code AND planning_item_id<>predecessor_id)
CONSTRAINT ck_pc_cross_dependency_revision CHECK(revision>0)
CONSTRAINT ck_pc_cross_dependency_reason CHECK(CHAR_LENGTH(TRIM(reason))>0)
```

### aims.product_dependency_graph_lock

来源：[aims_schema.sql:2929](../aims/docs/aims_schema.sql#L2929)。

字段：`id`, `revision`。

键与引用：

```sql
PRIMARY KEY(id)
CONSTRAINT ck_pc_dependency_graph_singleton CHECK(id=1 AND revision>0)
```

### aims.product_roadmap_cross_dependency_snapshots

来源：[aims_schema.sql:2940](../aims/docs/aims_schema.sql#L2940)。

字段：`id`, `commitment_id`, `dependency_biz_id`, `dependency_revision`, `predecessor_product_code`, `predecessor_biz_id`, `predecessor_revision`, `snapshot`, `created_at`。

键与引用：

```sql
PRIMARY KEY(id)
UNIQUE KEY uk_pc_roadmap_cross_snapshot_edge(commitment_id,dependency_biz_id)
KEY idx_pc_roadmap_cross_snapshot_scope(commitment_id,predecessor_product_code,id)
CONSTRAINT fk_pc_roadmap_cross_snapshot_commitment FOREIGN KEY(commitment_id) REFERENCES product_roadmap_commitments(id)
CONSTRAINT fk_pc_roadmap_cross_snapshot_product FOREIGN KEY(predecessor_product_code) REFERENCES product_workspaces(product_code)
CONSTRAINT ck_pc_roadmap_cross_snapshot_revisions CHECK(dependency_revision>0 AND predecessor_revision>0)
CONSTRAINT ck_pc_roadmap_cross_snapshot_json CHECK(JSON_TYPE(snapshot)='OBJECT')
```

### aims.product_priority_model_versions

来源：[aims_schema.sql:2965](../aims/docs/aims_schema.sql#L2965)。

字段：`id`, `biz_id`, `product_code`, `version`, `title`, `method`, `configuration`, `reason`, `created_by`, `created_at`。

键与引用：

```sql
PRIMARY KEY(id)
UNIQUE KEY uk_pc_priority_model_biz(biz_id)
UNIQUE KEY uk_pc_priority_model_version(product_code,version)
KEY idx_pc_priority_model_list(product_code,id)
CONSTRAINT fk_pc_priority_model_product FOREIGN KEY(product_code) REFERENCES product_workspaces(product_code)
CONSTRAINT ck_pc_priority_model_text CHECK(CHAR_LENGTH(TRIM(version))>0 AND CHAR_LENGTH(TRIM(title))>0 AND CHAR_LENGTH(TRIM(reason))>0 AND CHAR_LENGTH(TRIM(created_by))>0)
CONSTRAINT ck_pc_priority_model_method CHECK(method IN ('weighted-value-effort','rice'))
CONSTRAINT ck_pc_priority_model_config CHECK(JSON_TYPE(configuration)='OBJECT')
```

### aims.product_rice_reach_observations

来源：[aims_schema.sql:2991](../aims/docs/aims_schema.sql#L2991)。

字段：`id`, `biz_id`, `product_code`, `planning_item_id`, `model_version`, `scope_revision`, `evidence_revision`, `reach_count`, `snapshot`, `recorded_by`, `recorded_at`。

键与引用：

```sql
PRIMARY KEY(id)
UNIQUE KEY uk_pc_rice_observation_biz(biz_id)
KEY idx_pc_rice_observation_list(product_code,planning_item_id,id)
CONSTRAINT fk_pc_rice_observation_item FOREIGN KEY(planning_item_id,product_code) REFERENCES product_planning_items(id,product_code)
CONSTRAINT fk_pc_rice_observation_model FOREIGN KEY(product_code,model_version) REFERENCES product_priority_model_versions(product_code,version)
CONSTRAINT ck_pc_rice_observation_revision CHECK(scope_revision>0 AND evidence_revision>0)
CONSTRAINT ck_pc_rice_observation_count CHECK(reach_count<=1000000000)
CONSTRAINT ck_pc_rice_observation_snapshot CHECK(JSON_TYPE(snapshot)='OBJECT')
CONSTRAINT ck_pc_rice_observation_recorder CHECK(CHAR_LENGTH(TRIM(recorded_by))>0)
```

### aims.product_roadmap_saved_views

来源：[aims_schema.sql:3062](../aims/docs/aims_schema.sql#L3062)。

字段：`id`, `biz_id`, `product_code`, `cycle_id`, `owner_uid`, `title`, `audience`, `visibility`, `roadmap_year`, `roadmap_quarter`, `unscheduled`, `revision`, `created_by`, `updated_by`, `created_at`, `updated_at`。

键与引用：

```sql
PRIMARY KEY(id)
UNIQUE KEY uk_pc_saved_view_biz(biz_id)
KEY idx_pc_saved_view_owner(product_code,owner_uid,id)
KEY idx_pc_saved_view_shared(product_code,visibility,id)
CONSTRAINT fk_pc_saved_view_cycle FOREIGN KEY(cycle_id,product_code) REFERENCES product_planning_cycles(id,product_code)
CONSTRAINT ck_pc_saved_view_audience CHECK(audience IN ('planning','delivery','stakeholder'))
CONSTRAINT ck_pc_saved_view_visibility CHECK(visibility IN ('personal','product'))
CONSTRAINT ck_pc_saved_view_window CHECK(roadmap_year BETWEEN 1000 AND 9999 AND roadmap_quarter BETWEEN 1 AND 4)
CONSTRAINT ck_pc_saved_view_unscheduled CHECK(unscheduled IN (0,1))
CONSTRAINT ck_pc_saved_view_revision CHECK(revision>0)
CONSTRAINT ck_pc_saved_view_title CHECK(CHAR_LENGTH(TRIM(title))>0)
CONSTRAINT ck_pc_saved_view_actors CHECK(CHAR_LENGTH(TRIM(owner_uid))>0 AND CHAR_LENGTH(TRIM(created_by))>0 AND CHAR_LENGTH(TRIM(updated_by))>0)
```

### aims.product_documents

来源：[aims_schema.sql:3101](../aims/docs/aims_schema.sql#L3101)。

字段：`id`, `biz_id`, `product_code`, `document_uuid`, `purpose`, `revision`, `removed_at`, `removed_by`, `created_by`, `updated_by`, `created_at`, `updated_at`。

键与引用：

```sql
PRIMARY KEY(id)
UNIQUE KEY uk_pc_document_biz(biz_id)
UNIQUE KEY uk_pc_document_uuid(product_code,document_uuid)
KEY idx_pc_document_list(product_code,removed_at,purpose,id)
CONSTRAINT fk_pc_document_workspace FOREIGN KEY(product_code) REFERENCES product_workspaces(product_code)
CONSTRAINT ck_pc_document_purpose CHECK(purpose IN ('product-overview','requirements','design','release-notes','user-guide','other'))
CONSTRAINT ck_pc_document_revision CHECK(revision>0)
CONSTRAINT ck_pc_document_removed CHECK((removed_at IS NULL AND removed_by IS NULL) OR (removed_at IS NOT NULL AND removed_by IS NOT NULL AND CHAR_LENGTH(TRIM(removed_by))>0))
CONSTRAINT ck_pc_document_actors CHECK(CHAR_LENGTH(TRIM(created_by))>0 AND CHAR_LENGTH(TRIM(updated_by))>0)
```

### aims.product_document_creation_requests

来源：[aims_schema.sql:3128](../aims/docs/aims_schema.sql#L3128)。

字段：`id`, `biz_id`, `product_code`, `operation_id`, `document_uuid`, `purpose`, `relation_biz_id`, `created_by`, `created_at`, `linked_at`。

键与引用：

```sql
PRIMARY KEY(id)
UNIQUE KEY uk_pc_doc_creation_request(biz_id)
UNIQUE KEY uk_pc_doc_creation_operation(operation_id)
UNIQUE KEY uk_pc_doc_creation_target(document_uuid)
UNIQUE KEY uk_pc_doc_creation_relation(relation_biz_id)
KEY idx_pc_doc_creation_product(product_code,id)
CONSTRAINT fk_pc_doc_creation_workspace FOREIGN KEY(product_code) REFERENCES product_workspaces(product_code)
CONSTRAINT fk_pc_doc_creation_operation FOREIGN KEY(operation_id) REFERENCES integration_operation(operation_id)
CONSTRAINT fk_pc_doc_creation_relation FOREIGN KEY(relation_biz_id) REFERENCES product_documents(biz_id)
CONSTRAINT ck_pc_doc_creation_purpose CHECK(purpose IN ('product-overview','requirements','design','release-notes','user-guide','other'))
CONSTRAINT ck_pc_doc_creation_actor CHECK(CHAR_LENGTH(TRIM(created_by))>0)
CONSTRAINT ck_pc_doc_creation_link CHECK((relation_biz_id IS NULL AND linked_at IS NULL) OR (relation_biz_id IS NOT NULL AND linked_at IS NOT NULL))
```

### aims.product_feedback_bindings

来源：[aims_schema.sql:3154](../aims/docs/aims_schema.sql#L3154)。

字段：`id`, `source_app`, `source_type`, `source_biz_id`, `product_code`, `request_id`, `source_id`, `created_by`, `created_at`。

键与引用：

```sql
PRIMARY KEY(id)
UNIQUE KEY uk_pc_feedback_origin(source_app,source_type,source_biz_id)
UNIQUE KEY uk_pc_feedback_source(source_id)
KEY idx_pc_feedback_product(product_code,id)
CONSTRAINT fk_pc_feedback_workspace FOREIGN KEY(product_code) REFERENCES product_workspaces(product_code)
CONSTRAINT fk_pc_feedback_request FOREIGN KEY(request_id) REFERENCES product_requests(id)
CONSTRAINT fk_pc_feedback_source FOREIGN KEY(source_id) REFERENCES product_request_sources(id)
CONSTRAINT ck_pc_feedback_origin CHECK(source_app='altoc' AND source_type='service_ticket' AND CHAR_LENGTH(TRIM(source_biz_id))>0)
CONSTRAINT ck_pc_feedback_actor CHECK(CHAR_LENGTH(TRIM(created_by))>0)
```

### aims.product_line_workspaces

来源：[aims_schema.sql:3175](../aims/docs/aims_schema.sql#L3175)。

字段：`line_code`, `product_code`, `line_label`, `source_watermark`。

键与引用：

```sql
PRIMARY KEY (line_code)
UNIQUE KEY uk_pc_line_workspace (product_code)
CONSTRAINT fk_pc_line_workspace FOREIGN KEY (product_code) REFERENCES product_workspaces(product_code)
```

### aims.product_component_sources

来源：[aims_schema.sql:3184](../aims/docs/aims_schema.sql#L3184)。

字段：`source_product_code`, `product_code`, `component_id`, `source_product_name`。

键与引用：

```sql
PRIMARY KEY (source_product_code)
UNIQUE KEY uk_pc_source_component (component_id)
CONSTRAINT fk_pc_source_workspace FOREIGN KEY (product_code) REFERENCES product_line_workspaces(product_code)
CONSTRAINT fk_pc_source_component FOREIGN KEY (component_id,product_code) REFERENCES product_components(id,product_code)
```

### Assets outbox 补充来源

[20260710_assets_integration_operations.sql](../assets/docs/migrations/20260710_assets_integration_operations.sql) 为 Assets operation/attempt 独立定义，不能仅导入 assets_schema.sql。

`integration_operation` 字段：`operation_id`, `sequence_no`, `tenant_code`, `target_app`, `source_biz_type`, `target_biz_type`, `command_schema_version`, `status`, `next_attempt_at`, `locked_by`, `version_no`, `original_actor_uid`, `last_replay_actor_uid`, `last_http_status`, `last_error_summary`, `failure_notified_at`, `failed_permanent_at`, `created_by`, `created_at`。

`integration_operation_attempt` 字段：`attempt_id`, `attempt_no`, `correlation_id`, `result_status`, `error_code`, `target_biz_type`, `started_at`, `created_at`。


## 8. 本机测试数据库只读实测（历史 147 表采样）

时间：2026-09-13T16:37:56+00:00。该段记录补入 Assets 三张 outbox 表之前的 113 + 34 = 147 表历史快照；当前基线以[产品试点数据清单](./Unified-Enterprise-Pilot-Data-Inventory.md)和其引用的 150 表计划为准。配置来源为 `deploy/test-env/LOCAL_RUNTIME.md` 指向的受保护本机配置。仅连接其 Aims/Assets 库，使用 `START TRANSACTION READ ONLY` / `ROLLBACK`；查询 information_schema 元数据与 COUNT(*)，未返回业务字段值。计数批次在单个只读事务内，各域分别采样，不声称跨库同一快照。

两域均在本机 MySQL 8.0.34；global/session time_zone=SYSTEM，server charset=utf8mb4，server collation=utf8mb4_0900_ai_ci。未据 SYSTEM 推断实际 UTC 偏移。所有实测表均 InnoDB。索引长度/数据长度为 information_schema 元数据估计，行数为实际 COUNT(*)。

### aims: `hzy_aims_test_local_20260910`

实测 113 张表，合计 414 行；513 个索引、244 条 FK 列映射。`integration_operation` 当前无行。本次未据零行认定后台消费者可退役。

| 表 | 实际行数 | Collation | 数据/索引 bytes（估计） |
| --- | ---: | --- | ---: |
| `aims_contribution_snapshot_versions` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `aims_notification_checkpoint` | 0 | utf8mb4_unicode_ci | 16384/114688 |
| `aims_project_members` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `aims_project_products` | 0 | utf8mb4_unicode_ci | 16384/65536 |
| `aims_project_repos` | 0 | utf8mb4_unicode_ci | 16384/16384 |
| `aims_projects` | 0 | utf8mb4_unicode_ci | 16384/262144 |
| `approval_records` | 0 | utf8mb4_unicode_ci | 16384/163840 |
| `company_weekly_summaries` | 0 | utf8mb4_unicode_ci | 16384/16384 |
| `company_weekly_summary_items` | 0 | utf8mb4_unicode_ci | 16384/49152 |
| `company_weekly_summary_recipient_selections` | 0 | utf8mb4_unicode_ci | 16384/16384 |
| `company_weekly_summary_recipient_snapshots` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `company_weekly_summary_versions` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `deliverable_quality_reviews` | 0 | utf8mb4_unicode_ci | 16384/16384 |
| `deliverable_submissions` | 0 | utf8mb4_unicode_ci | 16384/81920 |
| `deliverable_waivers` | 0 | utf8mb4_unicode_ci | 16384/16384 |
| `deliverables` | 0 | utf8mb4_unicode_ci | 16384/163840 |
| `gitlab_commits` | 0 | utf8mb4_unicode_ci | 16384/65536 |
| `gitlab_issue_links` | 0 | utf8mb4_unicode_ci | 16384/65536 |
| `integration_operation` | 0 | utf8mb4_unicode_ci | 16384/196608 |
| `integration_operation_attempt` | 0 | utf8mb4_unicode_ci | 16384/114688 |
| `integration_operation_dead_letter_actionable` | 0 | utf8mb4_unicode_ci | 16384/65536 |
| `milestone_cycle_snapshots` | 0 | utf8mb4_unicode_ci | 16384/65536 |
| `milestones` | 0 | utf8mb4_unicode_ci | 16384/81920 |
| `notification_rules` | 0 | utf8mb4_unicode_ci | 16384/16384 |
| `product_activity_logs` | 4 | utf8mb4_bin | 16384/32768 |
| `product_catalog_control` | 1 | utf8mb4_unicode_ci | 16384/0 |
| `product_catalog_page_receipts` | 4 | utf8mb4_bin | 16384/0 |
| `product_catalog_projection` | 212 | utf8mb4_bin | 49152/16384 |
| `product_catalog_refreshes` | 5 | utf8mb4_bin | 16384/32768 |
| `product_command_receipts` | 4 | utf8mb4_bin | 16384/16384 |
| `product_component_sources` | 21 | utf8mb4_bin | 16384/49152 |
| `product_components` | 43 | utf8mb4_bin | 16384/65536 |
| `product_cross_dependencies` | 0 | utf8mb4_bin | 16384/65536 |
| `product_dependency_graph_lock` | 1 | utf8mb4_bin | 16384/0 |
| `product_document_creation_requests` | 0 | utf8mb4_bin | 16384/81920 |
| `product_documents` | 0 | utf8mb4_bin | 16384/49152 |
| `product_features` | 38 | utf8mb4_bin | 16384/65536 |
| `product_feedback_bindings` | 0 | utf8mb4_bin | 16384/65536 |
| `product_line_workspaces` | 2 | utf8mb4_bin | 16384/16384 |
| `product_members` | 3 | utf8mb4_bin | 16384/32768 |
| `product_objective_cycles` | 0 | utf8mb4_bin | 16384/65536 |
| `product_objective_items` | 0 | utf8mb4_bin | 16384/32768 |
| `product_objective_observations` | 0 | utf8mb4_bin | 16384/98304 |
| `product_objectives` | 0 | utf8mb4_bin | 16384/49152 |
| `product_outcome_observations` | 0 | utf8mb4_bin | 16384/49152 |
| `product_planning_comments` | 0 | utf8mb4_bin | 16384/32768 |
| `product_planning_cycle_items` | 0 | utf8mb4_bin | 16384/65536 |
| `product_planning_cycles` | 2 | utf8mb4_bin | 16384/65536 |
| `product_planning_dependencies` | 0 | utf8mb4_bin | 16384/32768 |
| `product_planning_item_requests` | 0 | utf8mb4_bin | 16384/32768 |
| `product_planning_items` | 7 | utf8mb4_bin | 16384/114688 |
| `product_priority_assessments` | 0 | utf8mb4_bin | 16384/49152 |
| `product_priority_model_versions` | 0 | utf8mb4_bin | 16384/49152 |
| `product_release_events` | 0 | utf8mb4_bin | 16384/16384 |
| `product_release_records` | 0 | utf8mb4_bin | 16384/65536 |
| `product_request_delivery_links` | 0 | utf8mb4_bin | 16384/65536 |
| `product_request_features` | 0 | utf8mb4_bin | 16384/32768 |
| `product_request_sources` | 0 | utf8mb4_bin | 16384/16384 |
| `product_requests` | 10 | utf8mb4_bin | 16384/98304 |
| `product_rice_reach_observations` | 0 | utf8mb4_bin | 16384/81920 |
| `product_roadmap_commitments` | 0 | utf8mb4_bin | 16384/49152 |
| `product_roadmap_cross_dependency_snapshots` | 0 | utf8mb4_bin | 16384/49152 |
| `product_roadmap_saved_views` | 0 | utf8mb4_bin | 16384/65536 |
| `product_version_acceptances` | 0 | utf8mb4_bin | 16384/16384 |
| `product_version_features` | 0 | utf8mb4_unicode_ci | 16384/81920 |
| `product_version_logs` | 0 | utf8mb4_unicode_ci | 16384/16384 |
| `product_version_plan_confirmations` | 0 | utf8mb4_bin | 16384/16384 |
| `product_version_plan_scopes` | 0 | utf8mb4_bin | 16384/81920 |
| `product_version_plans` | 0 | utf8mb4_bin | 16384/16384 |
| `product_versions` | 4 | utf8mb4_unicode_ci | 16384/81920 |
| `product_workspaces` | 3 | utf8mb4_bin | 16384/16384 |
| `project_cost_summary` | 0 | utf8mb4_unicode_ci | 16384/49152 |
| `project_counters` | 0 | utf8mb4_unicode_ci | 16384/16384 |
| `project_documents` | 0 | utf8mb4_unicode_ci | 16384/131072 |
| `project_environments` | 0 | utf8mb4_unicode_ci | 16384/81920 |
| `project_lifecycle_events` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `project_management_fact_snapshots` | 0 | utf8mb4_unicode_ci | 16384/81920 |
| `project_manager_delegations` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `project_portfolios` | 0 | utf8mb4_unicode_ci | 16384/131072 |
| `project_template_sets` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `project_template_versions` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `project_weekly_report_correction_requests` | 0 | utf8mb4_unicode_ci | 16384/49152 |
| `project_weekly_report_entries` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `project_weekly_report_reviews` | 0 | utf8mb4_unicode_ci | 16384/49152 |
| `project_weekly_report_versions` | 0 | utf8mb4_unicode_ci | 16384/49152 |
| `project_weekly_report_work_items` | 0 | utf8mb4_unicode_ci | 16384/65536 |
| `project_weekly_reports` | 0 | utf8mb4_unicode_ci | 16384/147456 |
| `qa_checklist_versions` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `requirement_contents` | 0 | utf8mb4_unicode_ci | 16384/81920 |
| `requirement_item_contents` | 0 | utf8mb4_unicode_ci | 16384/49152 |
| `requirement_items` | 0 | utf8mb4_unicode_ci | 16384/131072 |
| `requirement_review_batches` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `requirement_versions` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `service_command_receipt` | 0 | utf8mb4_unicode_ci | 16384/131072 |
| `system_parameters` | 0 | utf8mb4_unicode_ci | 16384/16384 |
| `time_entries` | 0 | utf8mb4_unicode_ci | 16384/131072 |
| `time_entry_review_events` | 0 | utf8mb4_unicode_ci | 16384/49152 |
| `user_favorite_projects` | 0 | utf8mb4_unicode_ci | 16384/49152 |
| `weekly_report_corrective_action_links` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `weekly_report_obligations` | 0 | utf8mb4_unicode_ci | 16384/49152 |
| `weekly_reporting_periods` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `weekly_reporting_pilot_projects` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `weekly_reporting_settings` | 0 | utf8mb4_unicode_ci | 16384/16384 |
| `work_item_attachments` | 0 | utf8mb4_unicode_ci | 16384/16384 |
| `work_item_changelog` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `work_item_comments` | 0 | utf8mb4_unicode_ci | 16384/16384 |
| `work_item_relations` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `work_item_service_ext` | 0 | utf8mb4_unicode_ci | 16384/81920 |
| `work_item_source_anchors` | 0 | utf8mb4_unicode_ci | 16384/49152 |
| `work_item_status_catalog` | 0 | utf8mb4_unicode_ci | 16384/0 |
| `work_items` | 0 | utf8mb4_unicode_ci | 16384/376832 |
| `workflow_status_catalog` | 22 | utf8mb4_unicode_ci | 16384/0 |
| `workflow_transitions` | 28 | utf8mb4_unicode_ci | 16384/49152 |

实际索引/FK 元数据已在本次只读采样中取得；具体 keys 与第 7 节 DDL 应由迁移预检逐项比对，不以索引数量一致认定一致。
### assets: `hzy_assets_test_local_20260910`

实测 34 张表，合计 64 行；139 个索引、30 条 FK 列映射。本库当前没有 `integration_operation` 表；仓库 migration 的定义不能当作已部署。本次未据零行认定后台消费者可退役。

| 表 | 实际行数 | Collation | 数据/索引 bytes（估计） |
| --- | ---: | --- | ---: |
| `asset_alerts` | 0 | utf8mb4_unicode_ci | 16384/81920 |
| `asset_assignments` | 0 | utf8mb4_unicode_ci | 16384/49152 |
| `asset_category_groups` | 8 | utf8mb4_unicode_ci | 16384/32768 |
| `asset_category_items` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `asset_delivery_environments` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `asset_delivery_products` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `asset_delivery_views` | 0 | utf8mb4_unicode_ci | 16384/49152 |
| `asset_documents` | 0 | utf8mb4_unicode_ci | 16384/16384 |
| `asset_environment_assets` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `asset_environments` | 0 | utf8mb4_unicode_ci | 16384/81920 |
| `asset_events` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `asset_items` | 0 | utf8mb4_unicode_ci | 16384/131072 |
| `asset_monthly_costs` | 0 | utf8mb4_unicode_ci | 16384/49152 |
| `asset_offboarding_recovery_cases` | 0 | utf8mb4_unicode_ci | 16384/81920 |
| `asset_physical_details` | 0 | utf8mb4_unicode_ci | 16384/16384 |
| `asset_receipts` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `asset_resource_details` | 0 | utf8mb4_unicode_ci | 16384/49152 |
| `assets_notification_checkpoint` | 0 | utf8mb4_unicode_ci | 16384/81920 |
| `assets_product_catalog_state` | 1 | utf8mb4_0900_ai_ci | 16384/0 |
| `customer_delivery_asset_environment_rel` | 0 | utf8mb4_unicode_ci | 16384/98304 |
| `customer_delivery_assets` | 0 | utf8mb4_unicode_ci | 16384/147456 |
| `digital_asset_products` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `digital_assets` | 0 | utf8mb4_unicode_ci | 16384/65536 |
| `ip_asset_products` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `ip_assets` | 0 | utf8mb4_unicode_ci | 16384/65536 |
| `product_asset_bases` | 1 | utf8mb4_unicode_ci | 16384/32768 |
| `product_asset_resources` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `product_assets` | 53 | utf8mb4_unicode_ci | 65536/49152 |
| `purchase_order_items` | 0 | utf8mb4_unicode_ci | 16384/16384 |
| `purchase_orders` | 0 | utf8mb4_unicode_ci | 16384/65536 |
| `service_command_receipt` | 0 | utf8mb4_unicode_ci | 16384/81920 |
| `suppliers` | 0 | utf8mb4_unicode_ci | 16384/32768 |
| `system_parameters` | 0 | utf8mb4_unicode_ci | 16384/16384 |
| `technology_bases` | 1 | utf8mb4_unicode_ci | 16384/32768 |

实际索引/FK 元数据已在本次只读采样中取得；具体 keys 与第 7 节 DDL 应由迁移预检逐项比对，不以索引数量一致认定一致。

## 9. INT-102 基础接线与隔离数据库证据

2026-09-13：新增 `data-runtime/internal/enterprise/registry.go`、`config/enterprise.go`、`db/enterprise.go`、`server/enterprise_registry.go`。本地 `enterprise.enabled` 默认 false；新配置明确开启且完整有效时才注册，错误使启动失败，不自动退回禁用。旧 adapter 仍使用旧连接与路由。本次没有修改任何实际测试 Runtime 配置或业务库。

登记键为 tenant/environment/runtimeDeployment，domain owner 明确匹配本地域 deployment binding 或 enterprise binding；兼容选择不允许推断 fallback。schemaVersion/generation 和各域 read/write/scheduler 模式分别固定。Storage 使用已核验 MySQL server UUID + database 判定唯一存储，网络地址别名不能绕过跨租户约束。物理映射只由本地配置进入，不暴露 SQL/配置写入 HTTP 入口。

factory 在连接返回前校验 `@@server_uuid`、`DATABASE()`、session time_zone、全部映射表 InnoDB 与下列登记行。UTC 通过 driver 的 session 参数在每条物理连接建立时设置，不仅设置首次启动连接。登记表由后续迁移工具创建/填充；Runtime 启动不自动建表或修改迁移状态：

```sql
CREATE TABLE enterprise_schema_registry (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  tenant_code VARCHAR(100) NOT NULL,
  environment_code VARCHAR(100) NOT NULL,
  runtime_deployment VARCHAR(100) NOT NULL,
  schema_version VARCHAR(100) NOT NULL,
  generation BIGINT UNSIGNED NOT NULL,
  CONSTRAINT ck_enterprise_schema_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
```

本次隔离实例为 `/tmp/hzy-product-center.enterprise.sw3nejwx/mysql.sock`，PID 20949，独立 datadir，127.0.0.1:52175；不是原业务 MySQL。测试以随机 `hzy_enterprise_test_*` 名新建两租户库，验证并发读取不串租户、同租户两域共享池、同事务两域写入回滚无部分提交、同时持有三条连接均 UTC，以及错 server UUID、错实际库、错 tenant 登记、错 schema version 和 MyISAM 拒绝。

验证：

```sh
# 此 socket 是本次临时实例，已清理；重新运行须先启动新的专属实例。
HZY_ENTERPRISE_TEST_SOCKET=/tmp/hzy-product-center.enterprise.sw3nejwx/mysql.sock \
  go test -race -run 'TestEnterprise(IsolatedMySQL|Configuration|Disabled|Registry)' -v \
  ./internal/db ./internal/config ./internal/server
# registry 并发和生命周期矩阵
 go test -race ./internal/enterprise
```

上述本次负责测试通过；测试库清理后通过 information_schema 确认剩余测试库为 0，随后对该 socket 正常 shutdown，确认 PID 文件消失并删除自建临时 datadir。测试不接受任意 ambient DSN：socket 必须位于 `/tmp/hzy-product-center.*`。

范围限制：这是实际连接登记、池与存储基础证明；尚未切换产品业务路径，没有证明用户权限查询、业务域 schema 全量迁移、生产连接授权或租户切换完成。更早的完整相关包测试通过后，整合负责人新增的 Context 正例曾出现 actor fixture 失败，已单独反馈负责人；不能以本组通过代替整个并行工作区验收。

## 10. 权威产品目录内部服务基础

2026-09-13：`internal/enterprise/product_directory.go` 新增 `ProductDirectoryService.List` 和 `ListForAimsWorkspace`。目录只读映射后的 Assets `product_assets`、`asset_category_groups` 和 `assets_product_catalog_state`；Aims 空间调用同时读取 `product_workspaces` / `product_component_sources`。同一 REPEATABLE READ / READ ONLY 事务涵盖权限回调、当前事实、水位、列表、总数和产品线分组，不写历史 source_product_name/line_label，也不依赖 projection 刷新。

`DirectoryIdentity` 必须来自已验证 Runtime 上下文并指定 SourceDomain。Aims 来源首先调用 `AimsProductsView`（对应既有 products:view 资源及对象范围）；目标独立调用 `AssetsProductsView`。注册 tenant/environment/deployment/schema/generation/owner 均精确匹配，两域必须使用同一注册池。DirectoryGrant 再绑定 actor、登记键、schema/generation 和有效期。全量与编码集合互斥，空集合实际返回空；未知/过期授权失败关闭。scope 表达为参数化产品编码过滤，不接受请求 SQL。

Aims 空间查询保留来源唯一接入语义：一个线空间只能读取已经关联的 source 产品，不能顺带包含整条线未接入产品，且仍与 Assets 目标可见范围取交集。集合入口（workspace 为空）的 source 数据范围必须由实际 Authorizer 实现纳入有效产品集合，或者拒绝非全局范围集合访问；不能仅凭 products:view 资源级成功扩大到全部 Assets 主档。现阶段 Authorizer 是可注入的正式适配点，HTTP/BFF/真实权限绑定由整合负责人接线，不能将 fixture 授权器用于实际环境。

结果字段包含 product_code/product_name、product_line/product_line_code/product_line_label、source_status/status；分页输出 page/pageSize/total、水位及适用 workspace_revision。后续页必须携带初始水位；空间分页还需携带 workspace_revision，变化返回明确冲突。缺字典标签保留 NULL，不编造当前名称。

实测使用专属 `/tmp/hzy-product-center.directory.pl3if2ii/mysql.sock`（PID 32568，127.0.0.1:53444）及两个随机隔离库：

```sh
HZY_ENTERPRISE_TEST_SOCKET=/tmp/hzy-product-center.directory.pl3if2ii/mysql.sock \
  go test -race -run TestDirectory -v ./internal/enterprise
```

通过：两租户并发查询、名称/产品线改名即时可见、历史来源名称未变化、受限产品/产品线/总数一致、部分产品线接入、Aims 拒绝、目标范围不因源权限扩大、错误 tenant/actor/schema/generation/过期 grant、旧水位拒绝。数据库/事务/SQL 为真实 MySQL，权限评估器为显式 fixture；尚不能证明真实岗位策略撤销或 HTTP 入口安全。结束时实测剩余随机测试库为 0，正常关闭专属实例并移除自建 datadir。

## 11. P2 完整闭包影子迁移制品

新增 `data-runtime/cmd/hzy-enterprise-migrate` 和 `internal/migrations/unified`。首版保守纳入指定 Aims/Assets 源库的**所有 BASE TABLE**，而不是仅挑产品主表；这样保留库内 FK、逻辑/JSON 引用、审计、receipt/outbox 与消费水位。稳定 ID 和 JSON 内容原样复制，物理表统一加 `aims_` / `assets_` 前缀，FK 与触发器表引用同步改写，约束/触发器名使用域前缀和稳定摘要防碰撞。复制后按主键顺序做逐表 count/SHA-256 与完整 FK 孤儿核验；哈希使用逐字段 NULL 标志、字节长度和原始值，区分 NULL/空字符串/字段拼接歧义。

限制明确失败关闭：首版仅同一已验证 MySQL server UUID；非 InnoDB、无确定主键、外部 schema FK、未映射表引用、视图及动态/存储过程 trigger 均拒绝，不静默跳过。所有当前名称的跨域查询仍需走第 10 节服务；复制 projection 不代表继续将它作为当前主档事实源。

### 11.1 配置和默认 dry-run

命令仅读取显式本地配置，不继承 ambient DB_*，不提供 HTTP 入口。配置文件包含数据库凭据，必须在受保护目录，不能入 Git；下列是格式示例，值必须从目标环境事实核对：

```json
{
  "Migration": {
    "Tenant": "<tenant>",
    "Environment": "test",
    "RuntimeDeployment": "<registered-runtime-deployment>",
    "InstanceID": "<verified-MySQL-server-uuid>",
    "SchemaVersion": "enterprise.v1",
    "Generation": 1,
    "SourceAims": "<existing-aims-schema>",
    "SourceAssets": "<existing-assets-schema>",
    "Target": "<new-independent-shadow-schema>"
  },
  "Connection": {
    "Host": "127.0.0.1",
    "Port": 3306,
    "User": "<local-migration-user>",
    "Password": "<local-migration-credential>"
  }
}
```

```sh
# 默认只读源数据、写本地 review plan，不创建目标库。
go run ./cmd/hzy-enterprise-migrate --config /protected/migration.json --plan /protected/review.json
# 核对计划的源/目标身份、全部表、DDL、触发器、计数/hash和review摘要后，显式apply。
go run ./cmd/hzy-enterprise-migrate --config /protected/migration.json --plan /protected/review.json \
  --apply --review-hash <exact-review-hash>
```

计划包含 schema 元数据与汇总/hash，不含凭据或业务行。控制台仅输出模式、表数、行数、摘要与目标库；MySQL 错误只显示错误号，不打印可能带业务值的原始 SQL 错误。配置与计划身份不一致、摘要不匹配或源在 review 后变化，apply 都拒绝，要求重新生成并核对计划。

### 11.2 一致性、checkpoint 与 fence

- 源从始至终为旧路径唯一写入方；不执行源业务 UPDATE/DELETE，不暂停整个测试 Runtime。READ ONLY / REPEATABLE READ 事务固定初始影子快照，不能把之后发生的源写入认定为已追平。
- 每个目标持有基于 instance/target 的 MySQL GET_LOCK（立即失败、不无限等待）。只允许全新独立目标库，或具有**完全相同 review hash** 的本工具迁移 ledger；未知既有库和 generation>0 的已启用目标均拒绝。
- `enterprise_migration_ledger` 记录 review hash、copying/verified-shadow、创建时间；`enterprise_migration_checkpoint` 记录每表已提交行数、源 hash 和 copying/verified。每 250 行提交一个目标事务与同批 checkpoint。
- 重入先重新核对整个源快照仍匹配原 review，已完成表复核 hash；未完成表仅在迁移拥有的目标内重建数据并重放。不是把丢失的旧源事务快照伪装成可恢复水位；源变化后需新计划/新影子目标，首版没有增量 CDC。
- 复制期间只在专用目标连接关闭 FK 检查，复制结束执行真实 FK 孤儿核验并恢复检查。触发器在数据/元数据复制后安装，避免复制时改变水位；改写后的触发器只引用目标表。
- 最终写 `enterprise_schema_registry` 单行身份，但 **generation 固定为 0**。这与第 9 节 Runtime 对 generation>0 的要求配合，确保影子库不能因复制成功被误当成已切换的权威库。
- 仍需后续 INT-206 的增量追平、最终暂停源写入、任务租约转移、最后对账和正式激活。当前工具不能完成源已有新写入后的切换或逆迁移；不能将 verified-shadow 当作 INT-201～207 全部完成。

启动阶段尚未建立可信 ledger 就异常中断的空目标，会被后续命令当作未知目标拒绝；应人工核对后重新选择新目标，不冒险自动删除。该行为优先保护现有业务库。

### 11.3 实测证据

对本机现用 Aims/Assets 源库只读运行 dry-run：**147 张表、478 行**，review hash `6ddaec7c0f2ced70c9ddd0dd23efab34ecb57f80e310c4c31b9873ef2b605e65`。没有在本机业务实例创建计划里的目标库，未执行业务库 apply；临时凭据配置已删除。

真实迁移演练使用新建专属 MySQL `/tmp/hzy-product-center.migrate.sottg6xd/mysql.sock`（PID 44119）。将上述完整 147 张真实 SHOW CREATE TABLE 与触发器定义加载到随机隔离源库，**不复制任何真实业务行**；另填 281 个合成产品及稳定 ID、receipt、JSON 样本。测试包括：

- dry-run 不创建目标；无精确 review hash、未知既有目标、源 review 后变化、已启用目标均拒绝。
- 完整 147 表复制，逐表 count/hash 与 FK 对账，稳定 ID/receipt/JSON 不变。
- 超过 250 行的批次、重复 apply、模拟已提交前缀/checkpoint 中断后的恢复。
- 目标 trigger 只更新目标水位，不改源；目标内容漂移被拒绝。
- 目标 schema generation=0，源继续唯一写入。

```sh
HZY_ENTERPRISE_TEST_SOCKET=/tmp/hzy-product-center.migrate.sottg6xd/mysql.sock \
HZY_ENTERPRISE_SCHEMA_PLAN=/tmp/hzy-migration-source-plan.json \
  go test -race -run 'TestFullProduct|TestReview' -v ./internal/migrations/unified ./cmd/hzy-enterprise-migrate
```

上述真实测试通过；计划文件是本次环境生成的只读 schema 证据，复跑需重新生成完整源库计划并启动新的专属隔离实例，缺少时测试明确 skip。验证证明全闭包影子迁移制品，不证明真实租户最终切换、增量追平或外部消费方退役。

清理实测：隔离实例中随机 hzy_em_* 测试库剩余 0；PID 44119 正常 shutdown，PID 文件消失，自建 datadir 已删除。

## 12. 后续单写切换基础

`unified/fence.go` 已补持久源 fence、全表 DML guard、双源原子关闭、最终完整重复制和目标原子激活回执。完整协议、数据库权限前提、外部 drain 证据、不可直接回旧库的约束及隔离 MySQL 证据见 [源端写栅栏与最终复制协议](./Unified-Enterprise-Cutover-Protocol.md)。这使第 11 节的影子制品具备受控后续阶段，但没有在真实业务库执行，也未完成反向迁移和真实外部副作用验收。

## 13. 当前产品中心目录读取

已新增同事务、双域独立授权的 current_catalog 查询与 Runtime `POST /v1/enterprise/aims/product-list`。旧 projection 列表语义继续保留；统一路径不使用历史名称 fallback，也不据部分可见范围推算整线资格。具体字段、作用域、快照/锁读差异和真实 MySQL/HTTP 证据见 [统一产品中心当前目录读取](./Unified-Enterprise-Current-Catalog.md)。这不是接入命令或真实业务库切换的完成声明。

### 统一 Aims 反馈 outbox 的逻辑来源与物理归属（2026-09-13）

统一产品需求决定、合并与轻量版本计划采纳复用原领域事务；反馈状态及进度事件与领域修改、审计、命令回执同事务提交。`integrationoperation.OutboxTables` 是不可变本地映射，四个逻辑表为 `integration_operation`、`integration_operation_attempt`、`service_command_receipt`、`integration_operation_dead_letter_actionable`。构造仅接受 Registry 返回的单表 SQL 标识，拒绝 schema、SQL 片段、缺项和重复表；请求不能提供映射。生产者显式提供无效映射时拒绝，旧 adapter 未提供映射时保留旧单库路径。

统一 Runtime 本地配置可显式声明 `enterprise.aimsDeliveryWorker = {"deployment":"<真实 Aims worker deployment>","serviceClientId":"aims.runtime"}`。deployment 必须精确匹配本地 `deploymentBindings.aims`，不能由 browser、统一 owner deployment 或命名规则推导。来源对象绑定 tenant、environment、runtime deployment、schema、generation、Aims owner 与四张物理表；跨绑定复用拒绝。未配置不会生成假来源：无外部反馈关联的操作保持可用，有 Altoc 反馈关联的操作由领域生产者拒绝并回滚。

事件的 `source_app=aims` 表达逻辑事实所有者；`deployment_code` 是明确登记的真实 Aims 投递 worker。它不把当前 enterprise 服务主体变成 `aims.runtime`：生产者上下文不填写虚假 ServiceClientID，实际 HTTP 身份仍由认证上下文持有，原用户写入 `original_actor_uid`。外发须由真实 worker 独立取得服务凭证并满足 Altoc 原来源校验；这次生产者修复本身不证明 claim/ACK 切换、网络投递或外部 drain 已完成。

轻量计划采纳此前直接改变需求状态而遗漏反馈事件；现于范围、版本和 workspace 修订更新后、最终审计前生成状态和进度快照。沿用原公开进度定义，不把内部计划范围或未公开功能泄漏给 Altoc。命令回执重放不重复生成 outbox。

实测：专用 `/tmp/hzy-product-center.feedback.1srqy9yl` mysqld PID 29337（禁网络）执行 `HZY_PRODUCT_CENTER_TEST_SOCKET=<该目录>/mysql.sock go test -race ./internal/enterpriseplanning -run 'TestMySQLLightweightFeedbackAtomicRegisteredOutbox|TestMySQLPlanningServicesUseOwningProjectHandoff' -count=1 -v`，通过（6.131s）。测试由 canonical Aims schema 建全部隔离表，证明缺 worker 拒绝、最终审计故障回滚需求采纳/计划/outbox、成功两条事件仅写 Aims 登记物理表（故意同名 legacy 表仍零行）、旧入口幂等重放无新增事件；同时原六命令与真实 owning handoff 链通过。进程已 shutdown，实例目录已删除；未操作业务数据库。

补充实测：`TestMySQLRequestDecisionMergeFeedbackAtomic` 经真实 `RequestService.Decide/Merge` 验证有反馈的决定、合并，未配置 worker 拒绝，最终审计失败回滚，原 Go 入口重放无重复；合并保持原语义（改变的来源 1 条 status、两条原始反馈身份各 1 条 canonical progress）。与轻量采纳测试一起 `go test -race ./internal/enterpriseplanning -run 'TestMySQLRequestDecisionMergeFeedbackAtomic|TestMySQLLightweightFeedbackAtomicRegisteredOutbox' -count=1 -v` 通过（6.467s）；专用 `/tmp/hzy-product-center.feedback.hxsqpxxb`、PID 34110 已关闭并删除。

### 产品组件写入的统一事务入口

`enterpriseplanning.ComponentService` 的 Create/Edit/Move/Delete 只解析 Aims Write，通过持久 generation fence 后调用原 `productcenter` 命令新增的 `InTransaction` 入口。四个入口与旧函数共用完整实现，保留 workspace 授权锁、根修订和组件修订、父子归属、循环及深度验证、活动状态、审计、回执重放。创建、编辑和移动的 domain permission 为 `product_components:edit`，删除为 `product_components:delete`；原独立 service capability 仍分别是 `aims:product-components:create|edit|move|delete`，不能用宽泛权限替代。

必要 managed views 为 product_workspaces、product_members、product_command_receipts、product_activity_logs、product_components、product_component_sources、product_features、product_requests。删除继续禁止来源产品绑定、子组件和功能引用，并明确检查需求 component_id 引用，与 canonical schema 的 `fk_pc_request_component` 一致，避免依赖裸 FK 错误作为领域反馈。没有删除、迁移或伪造 Assets 主档来源；来源快照保持原语义。

组件验证：`HZY_PRODUCT_CENTER_TEST_SOCKET=<专用实例>/mysql.sock go test -race ./internal/enterpriseplanning -run TestMySQLComponentCommands -count=1 -v` 通过（3.736s），专用 `/tmp/hzy-product-center.structure.d8rjqn_s`、PID 56126 已关闭并删除。canonical 全表 fixture 显式补装 schema 中独立 ALTER 的 request-component FK；验证四命令最终审计失败事务回滚、旧 Go 回执重放、父子循环与跨产品父节点拒绝、含子节点/需求引用/来源绑定删除拒绝、相同修订并发编辑仅一方成功。原组件 create/delete/move/migration MySQL 回归通过（3.852s，专用 PID 55238 已清理）。

### 共享 Gateway 唤醒的 Aims scheduler 选择

`drainIntegrationOperationsForEvent` 重新验证 Gateway scheduler HMAC，并将传入 binding 的 tenant/deployment/storage/generation 与已验签事实逐项匹配。`unified` 仅替换完整 IO 的 Runtime 调用：claim、成功/失败 ACK、通知列表及其 checkpoint 九个固定路径均经 `unifiedIntegrationOperationRoute` 进入同一统一库、同一 generation。Altoc/Finance/Codocs 等外部投递继续使用原真实 Aims event；不把主体改成 enterprise。不认识的非空选择或 `disabled` 直接失败，不能退回旧存储；合法未登记（storage/generation 均空且签名正确）保留原路径。

Foundation `maybeCallTenantRuntime` 的 `aimsEnterpriseScheduler` 是狭窄内部选项：只允许已签名 Aims wake、上述九路径、POST、精确 `aims:integration_operation:execute`、无浏览器用户代理与 query 覆盖。每次重新验证选择与 generation，强制 service-client-policy 取得服务 token，检查其 aims.runtime/aims/tenant/worker-deployment 元数据绑定后传递 generation header；不读取浏览器原始 header作为选择，不复用静态 token。接收 Runtime 仍负责 JWT 签名、expiry、grant、generation 与 scheduler ownership 的最终验证。现有 business capability 语法仅增加这个历史下划线 capability 的精确允许项。

验证命令：`node --test --experimental-strip-types aims/test/unifiedSchedulerWake.test.ts aims/test/unifiedIntegrationOperationRoute.test.ts aims/test/integrationOperationDrain.test.ts`（7 测试通过）；`pnpm --dir foundation exec tsx --test test/tenantRuntimeClient.test.ts test/policySyncSchedulerTrust.test.ts`（20 测试通过）；Aims `pnpm typecheck` 及修改文件 ESLint 通过。新 H3/HTTP 测试执行真实签名验证、drain、通知 checkpoint、失败 executor、路由映射和 Foundation HTTP IO，九路径同代际，去掉/篡改选择、缺 generation、disabled、错 tenant、enterprise.runtime 或 opaque token 均无 Runtime IO，合法未登记仍旧路径。测试边界是 token issuer、Console 通知发布和接收 Runtime fixture，不将其宣称为真实 Altoc 业务投递或生产 cron 激活证据。

### 版本编辑、删除与生命周期统一入口

`enterpriseplanning.VersionService` 提供 Edit/Delete/Transition/Reopen/Archive，所有方法调用原 owning-domain 命令的 `InTransaction` 变体，共用原实现。构造可接同一已登记 `OutboundSource`，四个原有反馈动作完整透传，缺少真实 worker 绑定时含反馈的命令拒绝并回滚。删除仍仅允许无范围、执行、项目绑定、验收或发布记录的规划版本；不凭空新增外部事件。transition 的 domain permission/capability 沿用 edit；其他动作使用对应 edit/delete/reopen/archive，拒绝借用宽泛写权限。

简单计划版本仍须当前有效确认且当前汇总无阻碍才能进入开发；原版本编辑会使简单确认失效。reopen 仍核对当前发布记录、插入 withdrawn 事件、清除当前发布指针并增加范围修订；archive 保留发布指针及不可变历史记录。服务不创建假发布记录、不修改发布快照或把历史事实当作当前主档。

真实隔离验证：`go test -race ./internal/enterpriseplanning -run TestMySQLVersionLifecycle -count=1 -v` 通过（4.033s），专用 `/tmp/hzy-product-center.version.o7rwxzv2`、PID 75757 已关闭删除。五命令各自最终审计失败时领域状态/回执/outbox/发布事件全部回滚；提交后原 Go 入口重放不新增事实；四个反馈动作正确写登记 Aims 物理 outbox，故意冲突的旧逻辑表零行；缺 worker、未确认简单计划、存在范围引用的删除拒绝。测试明确种入合法 `legacy_import` 历史并验证两个 release hash 不变与一次真实 withdrawn 事件，不伪造 verified publication。

原删除/transition MySQL 回归通过（5.130s）；原真实验收→发布→更正→再发布→归档链 `TestMySQLProductVersionAcceptanceImmutable`（same-key/different-keys）通过（2.851s），专用 `/tmp/hzy-product-center.release.bell_gqg`、PID 76645 已关闭删除。enterpriseplanning、productcenter、Aims race 单测通过；HTTP/BFF 五路径仍由接线工作包完成。

版本五命令 HTTP/BFF 接线已补齐：固定 `/v1/enterprise/aims/product-version:{edit,delete,transition,reopen,archive}`，Host 页面原 PATCH/DELETE 和 transition/reopen/archive POST 路径继续复用原 Aims 输入解析器，保留拒绝未知字段/查询、正整数标识与幂等键要求。Authorization 由当前用户、当前 Runtime 空间事实及精确动作编译，不能使用浏览器传入的 actor/tenant。验收、发布本身未在该桥接中开放。

`node data-runtime/scripts/test-enterprise-version-http-mysql.mjs` 真实 JWT/actor 签名、Console credential/grant、MySQL managed views 与 HTTP 五动作验证通过（3.980s），专用 temporary-mysql-harness 实例已自动关闭并移除。覆盖五动作同键重放、最终审计失败回滚反馈、错误 tenant/权限/过期 permit/缺幂等键、撤销凭据后拒绝重放及 generation 漂移拒绝。`node --test enterprise/test/planning-bridge.test.mjs enterprise/test/version-actions-bridge.test.mjs` 两测试通过；新测试逐项比较原 Aims helper 与 Host 的归一化写入 payload 一致，验证精确 capability、当前 actor、物理 enterprise 绑定及非法输入未发命令。Enterprise `pnpm typecheck` 通过。H3 测试的会话和远程服务为明确 fixture，真实 Runtime 身份验证由上述独立 HTTP/MySQL 测试承担；尚不等同部署后的浏览器验收。

### Assets 产品线分类共享事务

`SaveAssetCategoryInTransaction(ctx,tx,scope,id,body,operatorUID)` 复用原 Assets 分类保存校验与 SQL；原 standalone 保存入口调用同一实现并自行提交。新入口成功保留 caller 事务，失败回滚；返回分类及 items 也在同一事务读取。产品线仍为 `asset_category_groups.category_scope='product'`，管理权限仍是原 API 的 `assets / admin / admin`，不以产品编辑权限替代。原分类 API 没有 receipt 或幂等键，重复创建按唯一 scope/value 拒绝，不宣称旧入口提供幂等重放。

`node data-runtime/scripts/test-assets-category-mysql.mjs` 实际隔离 MySQL/race 通过（1.455s）。使用 canonical group/items/state DDL、统一库物理前缀与简单 INVOKER views，并保留原 line watermark triggers；验证外层 rollback、提交后旧入口读取当前名称、最后 item 插入失败连同 group rename 与 catalog revision 回滚、无效 scope/physical 必填items拒绝、错scope编辑拒绝、并发同值仅一方成功。临时实例已自动清理，未改实际租户数据。统一服务/HTTP 的已验证管理员身份及 registry 绑定由调用层承担。

### Assets 主档双 HTTP 入口真实隔离验证（2026-09-13）

统一 writer 启用后，原 Assets 产品创建/编辑与产品分类保存 HTTP 入口和 Enterprise 对应入口共享 Assets owning receipt；未切换路径不因此视为已迁移。回执仍落注册的 `assets_service_command_receipt`，分类仍落原 `asset_category_groups`，不创建另一产品线权威表。正式 `20260913_assets_owned_product_receipts.sql` 必须在源 Assets 最终复制前应用并重新生成迁移计划/hash：仅允许固定三种 Assets owning 命令、相同部署、非空 actor、精确 capability 和 schema version 的同应用回执。测试从原 cross-app-only CHECK 升级，并重复执行正式迁移，验证未知命令和错误 capability 仍被数据库拒绝。

`node data-runtime/scripts/test-enterprise-assets-products-mysql.mjs` 实际隔离 MySQL + HTTP + race 通过（Go 包 2.644s）。覆盖产品创建两个入口顺序的同键重放、不同 payload 409、产品编辑与分类保存的新→旧重放、真实 Console grant/credential 撤销后拒绝重放、错误 tenant/actor/scope 拒绝、最终 audit 插入失败连同业务与 receipt 回滚、generation 漂移拒绝。原 Assets adapter 指向独立 legacy 库，断言未写入该库；统一 Assets 物理表产生回执和主档，Aims 同名物理 tripwire 表保持空，字典只返回 Assets 注册表内容。Aims tripwire 不是完整 Aims 业务 fixture，测试不据此宣称 Aims 全域验证完成。

旧 HTTP JWT 仍精确要求 `assets.write`；实时 Console grant lookup 使用其正式 `resource:action` 拼接语义 `assets:write`，不放宽 JWT 接受范围。测试令牌由隔离 fixture 密钥签发，经真实 Runtime 验签和当前 Console 数据验证；并非实际租户 OAuth 或部署验收。临时 mysqld、socket 与数据库由 shared harness 自动清理；未读取浏览器凭据或改动实际业务库。
