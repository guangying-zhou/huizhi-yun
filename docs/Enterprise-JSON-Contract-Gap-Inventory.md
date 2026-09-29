# Enterprise JSON 契约缺口盘点（S3 M3b H0 的 11 项冲突）

日期：2026-09-29。来源：S3 演练 `hzy-enterprise-migrate --profile P --plan`（`blocking_conflicts=11`，review hash `54781eb0…4e35`，tables=153，rows=6121）。冲突类型均为 `json_field_contract_unregistered`：`data-runtime/internal/migrations/unified/json_contract_registry.go` 的 `registeredJSONFields` 只放行有可执行校验的列，其余有数据的 JSON 列一律阻断。决定（协调者，2026-09-29）：**为这 11 列补可执行校验器并注册，不走 allowlist、不放宽 gate**。

方法与边界：只读，在新主机演练副本 `s3r1_hzy_aims`/`s3r1_hzy_assets` 上用 `hzy_cutover` 查询，没有访问日本生产库。下文只含结构与计数，不含任何值内容（uid、客户名、文件名等）；`schema`、`stage`、`documentSource` 这类枚举标识符按代码常量口径给出。计数是 S3 副本快照（源库持续写入，正式迁移前须重跑）。实现校验器时，先以代码路径确认“允许形状”，再用本盘点确认存量数据全部通过。

## 状态（2026-09-29）：11 项校验器已在代码中实现并注册

实现位置：`data-runtime/internal/jsoncontract`（共享形状，写入方与 gate 共用）、`internal/migrations/unified/value_json_contract.go` 与 `json_contract_registry.go`（注册），规则摘要见 [Unified-Enterprise-Cutover-Protocol.md](./Unified-Enterprise-Cutover-Protocol.md) §10。未新增 allowlist，gate 未放宽。仅有本地单元测试与隔离 MySQL 证据，S3 副本重跑 `--plan` 尚未执行。

产品语义决策（协调者）：
- #1 `access_whitelist`：uid 字符串数组，非空、已 trim、无重复，每个 ≤128 字符，≤1000 项；创建路径（`product_versions.go`、`service_contract_bridge.go`）写入前校验，非法返回 400 `project_whitelist_invalid`。其他 `bodyJSONText` 调用方未改动。
- #2 `module_config`：封闭键集。除盘点到的 `legacyProjectType/legacySource`（字符串 ≤64）与 7 个布尔开关外，代码实际读取的还有旧别名 `milestonesEnabled/processAuditEnabled`（`aims/app/utils/projectModuleConfig.ts` 的 `pickModuleConfig`），因此一并允许；SQL 迁移只读 `$.requirements`。**命名漂移仅记录在此**：`aims_schema.sql:131` 的注释写 `milestones_enabled/process_audit_enabled`，与存量及代码使用的键名不一致，未在代码中放行。
- #8 `event_data`：开放事件载荷，仅做结构校验（顶层对象、键非空 ≤64、深度 ≤8、≤64 KiB、数字有限）。`summary`/`status` 的类型未强制，因为读取方（`runtime_reads.go:585-586`）按 JSON_EXTRACT 取值且历史事件类型键集开放。
- #3 `snapshot_json`：除结构校验外，规划阶段复算 `snapshot_sha256`。存量 `workItems` 项按盘点为 7 键，写入方当前还会产生 `updated_at`，因此该键可选。`deliverables` 项的值可能是数字或字符串（驱动返回文本协议时），校验器同时接受。
- #4/#5/#6/#7/#9/#10/#11 按“建议校验族”实现；#7 要求非空（写入方本来就拒绝空数组），未复算 `items_sha256`；#11 键集封闭为 `{name,url}`。

Schema 文档漂移（#10）：`20260909_product_master_runtime_fields.sql` **没有**转换 `customer_domain`（它只补 `build_stage` 等列以及 `supported_terminals/covered_legacy_systems` 的 JSON 列），仓库内没有任何迁移把该列从 `VARCHAR(64)` 改成 JSON。S3/生产副本里它已经是 JSON（该转换来自仓库外的手工变更），而 `C000001` 测试迁移计划里它仍是 `varchar(64)`。`assets_schema.sql` 已按 S3 事实改为 `JSON NOT NULL`；仍缺一份可回滚的 `VARCHAR -> JSON` 迁移脚本供其他环境使用，属后续事项，未在本次范围内添加。写入侧 `jsonStringListOrFallback` 写入的是 JSON 文本，两种列类型都能接收。

## 总览

| # | 列 | 非空行 | 顶层 | 存量形状概要 | 建议校验族 |
| --- | --- | --- | --- | --- | --- |
| 1 | `aims.aims_projects.access_whitelist` | 20/142 | array | 20 行全是空数组 | 字符串数组（uid），可空 |
| 2 | `aims.aims_projects.module_config` | 141/142 | object | 键 2–7 个：138 行 `{legacyProjectType,legacySource}`（string），3 行 7 个布尔开关 | 对象；键名白名单 + 值类型 |
| 3 | `aims.approval_records.snapshot_json` | 2/3 | object | `schema=aims.milestone-completion-request.v1` | 已有版本化快照；校验 v1 结构 |
| 4 | `aims.deliverable_quality_reviews.checklist_result_json` | 6/6 | object | `schema=aims.deliverable-quality-review.v1`，`stage∈{pm_completeness,director_quality}` | 版本化对象 |
| 5 | `aims.deliverable_submissions.evidence_snapshot_json` | 3/3 | object | `schema=aims.deliverable-submission.evidence.v2`，`documentSource=repo` | 版本化对象，按 documentSource 分支 |
| 6 | `aims.project_template_versions.definition_json` | 4/4 | object | 里程碑→工作项→交付物三层，深度最大 7 | 嵌套对象校验 |
| 7 | `aims.qa_checklist_versions.items_json` | 3/3 | array | 元素 `{code,label,required}` | 对象数组 |
| 8 | `assets.asset_events.event_data` | 81/81 | object | 键 1–4 个，见下 | 对象；键白名单 + 值类型 |
| 9 | `assets.asset_items.tags` | 9/9 | array | 元素全是字符串，长度 2 | 字符串列表 |
| 10 | `assets.product_assets.customer_domain` | 53/53 | array | 元素全是字符串，长度 1–3 | 字符串列表（与已注册的 `supported_terminals` 同族） |
| 11 | `assets.purchase_orders.attachments` | 3/3 | array | 元素 `{name,url}`，均为字符串，长度 1 | 对象数组 |

所有 11 列：JSON 非法值 0；SQL NULL 仅出现在 `access_whitelist`（122）、`module_config`（1）、`approval_records.snapshot_json`（1）。空数组/空对象：仅 `access_whitelist` 20 个空数组。

## 逐列明细

### 1. `aims_projects.access_whitelist`
- **存量**：20 个非空全是 `[]`，其余 SQL NULL；无字符串元素、无深度。
- **写入**：`data-runtime/internal/apps/aims/product_versions.go:588,606`（`bodyJSONText(body,"access_whitelist","accessWhitelist")` → `nullableText`）、`service_contract_bridge.go:38,347`（同样取原文本，不解析）、`enterprise_project_update.go:32`（更新列映射）。`bodyJSONText`（`product_versions.go:1690`）对字符串入参**原样透传**，对其他类型 `json.Marshal`，因此写入路径本身不保证是 JSON 数组。
- **读取**：`admin_projects.go:41`；Schema 注释 `aims/docs/aims_schema.sql:114` 声明为“项目访问白名单 UID 数组，仅 `security_level=whitelist` 时使用”。
- **期望形状**：uid 字符串数组，可空。校验器须明确：空串、非数组、数组内非字符串如何处理。

### 2. `aims_projects.module_config`
- **存量**：全为对象。138 行键为 `legacyProjectType`、`legacySource`（均 string）；3 行含 `decomposition`、`environments`、`milestones`、`releases`、`requirements`、`service_desk`、`workflows`（均 bool）。没有嵌套。
- **写入**：`projects.go:999`（`"module_config": nullableString(moduleConfig)`）、`product_versions.go:591,619`、`routine_projects_batch.go:399`、`service_contract_bridge.go:39`、`service_opportunity_bridge.go:93`（均经 `bodyJSONText`，不解析）。
- **读取**：`projects.go:132,323`；`aims/docs/migration_v5.12_requirement_baseline_repair.sql:46,115,142` 读 `$.requirements`。Schema 注释 `aims_schema.sql:131` 写的是 `milestones_enabled/process_audit_enabled`，与存量键名不一致，属于历史漂移。
- **期望形状**：对象；至少允许上述 9 个键，其中 `requirements` 已被 SQL 迁移使用。**需要决策**：`legacy*` 键的来源与是否作为正式键；是否拒绝未知键。

### 3. `approval_records.snapshot_json`
- **存量**：2 行对象；`schema=aims.milestone-completion-request.v1`；键 `schema/project/milestone/deliverables[]/workItems[]`。`project{id,code}`，`milestone{id,name,sortOrder,status}`，`deliverables[]` 每项 10 个键（`id`、`name`、`deliverable_type`、`status`、`quality_status` 为 string 或 int，`required` int，`document_uuid`/`active_waiver_id` null，`current_submission_id`、`effective_milestone_id` int），`workItems[]` 每项 7 个键（`id` int，其余 string，含 `assignee_uid`）。
- **写入**：`milestone_completion_governance.go:271-296`，`canonicalJSON(snapshot)`，快照由 `milestoneCompletionSnapshotTx`（`:327`，`"schema": "aims.milestone-completion-request.v1"` 于 `:390`）构造，同表写 `snapshot_sha256`。
- **读取**：`milestone_completion_governance.go:514,668`（比对 `snapshotSha256`）。
- **期望形状**：版本化快照；校验器应核对 `schema` 常量、必需键与类型，并可复算 `snapshot_sha256`。存量 3 行中 1 行 SQL NULL，这是旧流程，校验器应允许 NULL 而不放行非空异常。

### 4. `deliverable_quality_reviews.checklist_result_json`
- **存量**：6 行对象；`schema=aims.deliverable-quality-review.v1`；`stage` 为 `pm_completeness`（3）/`director_quality`（3）；键 `checklistItemsSha256`（string）、`checklistVersionId`（int）、`results[]`（每项 `code`、`label` string，`passed` bool）、`schema`、`stage`。
- **写入**：`deliverable_quality.go:749-789`（构造于约 `:776-779`，插入 `:789`）。
- **读取**：未逐行核对具体 file:line（`deliverable_quality.go` 内评审读取与 `result_sha256` 核对），实现前需确认。
- **期望形状**：如上；校验器应核对 `schema`、`stage` 枚举、`results` 元素三键、`checklistItemsSha256` 为 64 位十六进制。

### 5. `deliverable_submissions.evidence_snapshot_json`
- **存量**：3 行对象，9 个键：`schema=aims.deliverable-submission.evidence.v2`、`documentSource=repo`、`repoProjectCode`、`repoFilePath`、`repoCommitId`、`contentSha256`、`checklistItemsSha256`（string）、`checklistVersionId`、`deliverableId`（int）。
- **写入**：`deliverable_quality.go:333-396`；`documentSource=repo` 分支写 `repo*` 三键，否则写 `documentUuid`、`documentVersionId`、`documentVersionNum`。
- **读取**：`deliverable_quality.go:439,519-522,1041-1044`（`JSON_EXTRACT` 读 `$.documentSource`、`$.repoProjectCode`、`$.repoFilePath`、`$.repoCommitId`，`documentSource` 缺省视为 `codocs`）。
- **期望形状**：按 `documentSource` 分支的必需键集合；`codocs` 分支存量为 0 行，校验器仍应实现（写入方会产生）。

### 6. `project_template_versions.definition_json`
- **存量**：4 行对象，仅顶层键 `milestones[]`。里程碑 12 个（`key`、`mode`、`name`、`pivrStage` string，`sortOrder` int，`description` 为 null，`workItems` 为 array 或 null）；工作项 31 个（`key`、`title`、`type`、`tier`、`priority`、`description` string，`required` bool，`reviewLevel`、`sortOrder` int，`deliverables[]`）；交付物 26 个（`key`、`name`、`deliverableType`、`acceptanceCriteria` string，`required` bool，`sortOrder` int，`description` null）。深度 2–7。
- **写入**：`project_templates.go:286,335,534,577,761`（含 `:577` 的发布后回写 `UPDATE … SET definition_json`）。
- **读取**：`project_templates.go:415,555,689`（模板展开为项目里程碑/工作项/交付物）。
- **期望形状**：以 `project_templates.go` 中的结构体或规范化函数为准；`workItems` 为 null 与 `description` 为 null 在存量中出现，校验器必须允许。

### 7. `qa_checklist_versions.items_json`
- **存量**：3 行数组，共 12 个元素，均为 `{code,label:string, required:bool}`。
- **写入**：`deliverable_quality.go:189`（同时写 `items_sha256`）。
- **读取**：`deliverable_quality.go:118,527,749`。
- **期望形状**：对象数组；`code` 唯一，`items_sha256` 可复算。

### 8. `asset_events.event_data`
- **存量**：81 行对象，键 1–4 个：`summary`（81 行，string）、`excelRow`（50 行，int）、`productCode`（50 行，string）、`source`（50 行，string；内容是导入文件标识，不列出）、`technology_base_id`（1 行，int）。事件类型覆盖 asset/environment/delivery_view/purchase_order/assignment/alert/supplier/product_asset/technology_base/ip_asset/digital_asset，其中 `product_asset.created` 54 行为主。
- **写入**：`data-runtime/internal/apps/assets/helpers.go:550-565`（`insertEvent(..., eventData map[string]any)`，`json.Marshal`，允许 nil）；`service_delivery.go:318`（`jsonOrNil(linkBody["source_context"])`，**调用方传入的任意结构**）。
- **读取**：`runtime_reads.go:585-586`（读 `$.summary`、`$.status`）。
- **期望形状**：对象或 NULL。**需要决策**：`event_data` 是开放事件载荷，键集合因 `event_type` 而异；校验器应至少保证“对象/NULL、无深层嵌套、大小上限、`summary`/`status` 若存在为字符串”，并对 `document_linked` 事件按 `source_context` 校验。是否允许非对象需要审查 `service_delivery.go:318` 上游。

### 9. `asset_items.tags`
- **存量**：9 行数组，共 18 个元素，全是字符串；长度均为 2。
- **写入**：`runtime_writes.go:43,68,208,230`（`jsonOrNil(body["tags"])`，不校验元素类型）。
- **读取**：`runtime_reads.go:318,498`；`helpers.go:524-525`（`parseJSONList`，解析失败返回空数组，**会吞掉坏数据**）。
- **期望形状**：字符串数组。

### 10. `product_assets.customer_domain`
- **存量**：53 行数组，共 84 个元素，全是字符串；长度 1–3。
- **写入**：`product_master_commands.go:28,36,84,106`（`jsonStringListOrFallback` / `jsonStringListOrNil`，写入侧已规范化为字符串列表，默认 `["G"]`）。
- **读取**：`product_master_reads.go:104,135,209`（`CAST(... AS CHAR)`）；`helpers.go:531-534`（`parseJSONStringList`）。
- **期望形状**：字符串数组。已注册的 `supported_terminals` / `covered_legacy_systems` 使用 `value_json_contract.go` 的 `validStringList`，`customer_domain` 应复用同一族并加入 `valueOnlyJSONFields`。
- **注意**：`assets/docs/assets_schema.sql:380` 仍写 `customer_domain VARCHAR(64) NOT NULL`，而 S3 副本中该列已是 JSON。需核对 `20260909_product_master_runtime_fields.sql` 是否负责转换，并同步 schema 文档，否则规范 schema 与迁移结果不一致。

### 11. `purchase_orders.attachments`
- **存量**：3 行数组，各含 1 个 `{name,url}` 对象，值均为 string。
- **写入**：`runtime_writes.go:1005-1024,1066,1081`（`jsonOrNil(body["attachments"])`，不校验）。
- **读取**：未逐行核对具体读取 file:line（`runtime_reads.go` 采购单查询预计整列返回），实现前需确认。
- **期望形状**：对象数组，键 `name`、`url` 字符串。**需要决策**：`url` 的协议/长度约束，是否允许其他附件元数据键。

## 实现建议

1. 复用现有机制：只读值族放 `value_json_contract.go`（`valueOnlyJSONFields`，如 #9、#10、#7、#11），版本化快照与需要交叉核对哈希的放独立族（如 #3、#4、#5）。每个校验器对**每一行**运行，未知版本拒绝。
2. `registeredJSONFields` 的依赖表清单：值型字段依赖自身表；#3、#4、#5、#7 依赖表见其写入流程。避免继承 Aims 规划依赖列表。
3. 契约测试至少覆盖：正确、缺键、错类型、未知键、空值/NULL、超大载荷、以及上表存量形状全部通过。真实副本的结构统计是回归基准。
4. #1、#2、#8 需要产品语义决策（键集合是否封闭），不宜擅自定型。
5. 合入后须在 S3 副本重跑 `--plan`，期望 `blocking_conflicts=0`；再进入 M3b fence。正式 M6 前对最终快照重新盘点。
