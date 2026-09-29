# Codocs 部门文档 v2 协作：正文消费者盘点（批次 H1 交付物）

日期：2026-09-29。状态：**只读盘点，未改代码、未跑测试、未做任何 DB / 环境 / 网络动作。**
依据：[Host 部门文档实时协作设计](./Codocs-Host-Department-Collaboration-Design.md) §1.3（转换后 `oss_path` 仅为派生镜像）、§2.5（互斥）、§7 批次 H1；[写入协调合同](./Codocs-Document-Write-Coordination.md)。
基线：分支 `feat/adr018-enterprise-integration` @ `b94b39f2`。

证据标记：**[核实]** = 已读源码（`file:line`）；**[推断]** = 由代码结构推断、未运行验证。

## 0. 结论摘要

1. **共盘出 63 条条目**（第 3 节 A 组 18、B 组 13、C 组 19、D 组 13，另有 E 组「已核对、无需改动」）。其中 **35 条需要代码改动或补测试**（A1–A6、A8–A11、A14；B1–B6、B9；C1–C5、C7–C13、C15–C17；D1、D5），其余为只写新文档、只把 `oss_path` 当身份/分类键（路径必须保持稳定）或已就位。
2. **Collab 发布不写 `oss_path`**（`document_snapshot.go:312-330` 只更新 `content_size` 并写 `document_versions`；镜像只由 Host 保存和 Host 读修复写，`enterpriseCodocsSnapshot.ts:153-190`）。因此部门文档一旦 v2 且有人经 Collab 编辑，**所有直读 `oss_path` 的路径都会静默读到旧内容**，无报错。
3. **个人共享文档今天已有同样的缺口**：Host 正文读取、Host 保存、版本查看、项目移交已感知快照；但**发文冻结/归档、独立 Codocs 全部读取、回收站恢复、管理端图片清理、旧 Collab v1 存盘**均不感知。个人协作上线（P0）前这些就是既有风险，H1 一并收敛可两条线共用。
4. **高风险 8 项**（第 4 节）：Host 正文读取门槛仅 `private`（A1）、公司快速发布（A14/B3）、发文冻结与归档（B1/B2/C11/C12）、独立 Codocs `PUT` 先写 OSS 后被 Runtime 拒绝（C5）、旧 Collab v1 房间存盘覆盖镜像与 `.yjs`（D1）、管理端图片清理按旧镜像判断“未引用”后删图（C16）、个人→部门接收不处理头/会话（B5）、读时修复镜像的写放大（A2）。
5. **推荐做法：以“精确快照读取”为权威路径，镜像只作尽力而为的兼容副本，不承担正确性。** 我们自有的消费者（Host、Runtime 计划、发文/快速发布拷贝）一律读发布头指向的精确版本；不能改造或不该改造的直读者（独立 Codocs 部门文档路径、旧 Collab v1）**失败关闭**（v2 文档返回 409 而非读旧镜像）。不建议扩大镜像职责（Collab/Runtime 发布后同步镜像），原因见第 6 节。
6. **工时**：全量（含独立端失败关闭与验证）约 **60–90 人时**，比设计文档 H1 行的 16–24 人时（仅 Host/页面）多出 Runtime 计划、独立 BFF、旧 Collab 三块，见第 5 节。

## 1. 模型回顾：为什么 `oss_path` 不再等于正文

| 事实 | 证据 |
| --- | --- |
| v2 权威正文 = `document_snapshot_heads.objects_json` 指向的精确对象版本（`codocs/snapshots/<h>/<uuid>/<candidate>/…`），带长度与 SHA-256 | `enterpriseCodocsSnapshot.ts:55-96`（读头 + 校验）[核实] |
| `documents.oss_path` 保持原值，语义变为“派生镜像位置”，同时仍是身份/分类键（目录 LIKE、发文记录 by-path、回收站路径） | `document_snapshot.go:321`、`document_queries.go:142-145`、`reviews.go:469` [核实] |
| 镜像写入方只有 Host：保存后 `mirrorSnapshotToLegacyPath`、读时 `repairLegacyMirror`；带 `hzy-snapshot-generation` 元数据 | `enterpriseCodocsSnapshot.ts:149-190` [核实] |
| Collab v2 存盘走 `:prepare → :upload → :publish`，Runtime 事务内推进头、写 `document_versions(object_key, oss_version_id)`，**不触碰 `oss_path`** | `collab/src/utils/v2-snapshots.ts:store`、`document_snapshot.go:312-330` [核实] |
| 写入互斥已就位：`refuseSnapshotV2Document` 按 UUID 判 v2（不看类型）拦住 Runtime 侧 v1 内容保存、旧 Collab 上下文、旧 Collab 版本创建 | `document_snapshot_guard.go:24-48`；调用点 `personal_document_update.go:182,264`、`collaboration.go:28`、`collaboration_versions.go:70`、`document_lifecycle.go:217-221` [核实] |
| 快照读/写的 Runtime 门槛**硬编码 `private`** 与 owner/写分享 | `document_snapshot_read.go:47-59`、`document_snapshot.go:119-131` [核实] |
| 共享写一次命名空间：Foundation 客户端拒绝对 `codocs/snapshots/` 的删除/覆盖/复制目标/元数据重写 | `foundation/server/utils/objectStorage.ts:674-699` [核实] |

**判断规则**（本文表格“必须做什么”一列的取值）：

- **SNAP-READ**：读发布头指向的精确对象版本（校验长度+SHA-256），不读 `oss_path`。
- **SNAP-PUB**：写入必须经快照发布路径（prepare/upload/publish，期望 generation/epoch）。
- **REJ**：对 v2 文档失败关闭（409 `document_on_snapshot_v2` / `document_collaboration_active`），不读不写旧镜像。
- **MIRROR**：需要镜像存在且不陈旧（本文尽量避免依赖）。
- **KEEP-PATH**：只把 `oss_path` 当键，要求路径保持稳定，无需改动。
- **NONE**：不涉及正文或只创建新 v1 文档。

## 2. 个人共享文档（已具备 v2）现状：哪些消费者已感知快照

| 消费者 | 已感知？ | 复用价值 |
| --- | --- | --- |
| Host 正文读取 `enterpriseCodocsDocumentContent.ts:17-28` | 是，仅 `type==='private'` 且双开关 | 把 `readSnapshotHead/readSnapshotMarkdown` 泛化到部门是最小改动；**读取入口是单一瓶颈**（下载、复制、开放部门文档、产品文档、`documents/:uuid` 都经它） |
| Host 保存 `enterpriseCodocsDocumentUpdate.ts:39-47,83-121` | 是（private）：v2 保存 + 镜像 | 部门无 HTTP 保存（设计 §2.5）；旧 v1 分支对 v2 部门文档由 Runtime 计划拒绝（`personal_document_update.go:264`），需补部门用例 |
| Host 版本查看 `enterpriseCodocsVersions.ts:106-162` | 是：按 `object_key`+`oss_version_id` 读精确对象 | 可直接复用；但操作族与 permit 是 `personal-documents`（`:8-13`），**部门文档当前没有版本历史入口** |
| Host 项目移交 `enterpriseCodocsDocumentTransfer.ts:117-146` | 是：读头取精确字节拷贝，不拷 `.yjs`，随后 Runtime 退役头 | 可作为“转出类操作”的参照；仅支持 `private`（`:122`） |
| Runtime 写入互斥 `document_snapshot_guard.go` | 是，类型无关 | 已覆盖部门文档，补用例即可 |
| Runtime 项目移交退役头 `personal_document_project_transfer.go:86-93` | 是（同事务 `invalidateCollaboration` + `retireSnapshotHead`） | 部门接收缺同类处理，见 B5 |
| Collab v2 admit/load/store/lease | 是 | 与文档类型无关，仅授权层需部门化（R1/C1，非本文范围） |
| Foundation 写一次命名空间 | 是 | 挡住 `cleanup-yjs` 之类批量删除，见 C17 |
| 回收站恢复 Host/Runtime、发文冻结/归档、公司快速发布、独立 Codocs 全部读路径、管理端图片清理、旧 Collab v1 | **否** | 第 3 节逐项列出；**个人 v2 文档今天同样受影响** |

## 3. 消费者清单

列含义：R/W = 读/写；类型 = 该路径可命中的 `documents.doc_type`（`private`、`department`、`project`、`company`、`knowledge`、`product`、`slide` 等）。“必须做什么”取第 1 节规则。风险 = 不改的后果。

### A 组：Enterprise Host（`enterprise/server`）

| # | file:line | 操作 | R/W | 类型 | v2 转换后必须 | 不改的风险 |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | `utils/enterpriseCodocsDocumentContent.ts:17-33`（调用方 `enterpriseCodocsDocumentReads.ts:77`） | **正文读取瓶颈**：打开编辑器 / 预览 / 下载 / 复制 / 开放部门文档 / 产品文档都经此 | R | 全类型；v2 分支仅 `private`（`:17`），其余走 `downloadDocument(oss_path)`（`:31`） | SNAP-READ：门槛放开到 `department`（`headers` 存在即用快照），并返回 `snapshot_generation/epoch`（设计 2.1 “可能已过期”提示）。Runtime 需部门版 `snapshot-read` | **高**。部门读者/下载/复制读到镜像旧内容且无任何告警；旧镜像还会被当作“空内容→尝试 Yjs 恢复”（`:33`）掩盖问题 |
| A2 | `utils/enterpriseCodocsDocumentContent.ts:25` → `enterpriseCodocsSnapshot.ts:176-190` | 读时修复镜像：HEAD 镜像 → 必要时 PUT 精确字节 | W（读请求触发 OSS 写） | 目前 private | 对部门**不要照搬**：每次 Collab 发布都使镜像失配，每个读者的下一次读都触发一次 PUT（写放大），且只读成员也在写存储。改为不修复，或单次飞行/限频，或删掉镜像依赖（见第 6 节） | **中高**。放大存储写与延迟；与 Collab 存盘并发时靠 `mirrorSnapshotToLegacyPath` 的 3 轮重读收敛，热点文档反复抖动 |
| A3 | `utils/enterpriseCodocsDocumentDownload.ts:9-17` | 个人路由下载（`documents/:uuid/download`） | R（经 A1） | 全类型 | 随 A1；`:11` 仅校验 `oss_path` 非空，需改为“有头或有路径” | 中。同 A1 |
| A4 | `utils/enterpriseCodocsDepartmentDocuments.ts:91-113` | 部门下载（`departments/documents/:uuid/download`） | R（经 A1，`:104`） | `department` | SNAP-READ；`:106` 的 `oss_path` 判空同上 | 高。下载的文件是旧内容，用户拿去外发 |
| A5 | `utils/enterpriseCodocsDepartmentDocuments.ts:259-315`（`:282` 读元数据要求 `oss_path`，`:300` 经 A1，`:305` 写暂存） | 部门复制：暂存源正文 → 新建 v1 部门文档 | R + W（新文档，v1） | `department`（源）；目标为新 `department` | SNAP-READ（经 A1）；暂存意图摘要 `intentDigest`（`:290`）应纳入源 `generation`，否则同一幂等键重试会复用生成于旧代的暂存 | 高。复制出的新文档缺最新协作内容，用户不易察觉 |
| A6 | `utils/enterpriseCodocsCompanyOpenDocs.ts:77` | 开放部门文档预览/读取（跨部门读者） | R（经 A1） | `department`（开放） | SNAP-READ，但**授权不同**：读者不是该部门 R，`department-documents:snapshot-read` 不适用；需 `open-department-documents` 资源下的读快照操作，或让 Runtime 在既有 open-department 视图里回传头引用 | 高。跨部门读者看旧稿；若误复用部门 R 校验则新增越权面 |
| A7 | `utils/enterpriseProductDocuments.ts:76` | 产品文档读取 | R（经 A1） | `product` | NONE（不转 v2；A1 类型门槛保证不受影响） | 低 |
| A8 | `utils/enterpriseCodocsDocumentUpdate.ts:39-47,51-75`（v1 写在 `:70`） | Host `PUT documents/:uuid` 保存 | W | 任何 owner/写分享可编辑的类型；v2 仅 `private`（`:83`） | REJ：v2 部门文档必须被 Runtime 计划拒绝（`personal_document_update.go:264`）且**拒绝发生在 OSS PUT 之前**（现顺序正确：先计划后写）。补部门 v2 用例；设计已决定部门无 HTTP 保存 | 中。缺用例则回归时可能被改成先写后拒 |
| A9 | `utils/enterpriseCodocsDocumentRestore.ts:45-90` | 个人回收站恢复：`head/get/put` 源路径（及 `.yjs`）→ 目标 | R + W（存储） | `private`（个人路径） | 对 v2 文档：恢复只需翻状态，不应因镜像缺失返回 404；从 `recycle.bin/` 恢复应从快照重建镜像，不复制旧镜像 | 中。镜像缺失→“可恢复的正文与快照均不存在”误报；`recycle.bin/` 情形把旧镜像固化到新 `oss_path` |
| A10 | `utils/enterpriseCodocsDepartmentWrites.ts:155-185`（计划 `enterprise_department_document_restore.go:70-100`） | 部门回收站恢复：同上 | R + W | `department` | 同 A9；且 `state_sha256` 含 `oss_path`/`updated_at`，Collab 发布更新 `updated_at`（`document_snapshot.go:312`），恢复计划与提交之间发布会触发 409 重试，需确认对活动会话文档语义（回收已撤销会话，理论上无发布） | 中 |
| A11 | `utils/enterpriseCodocsVersions.ts:106-162` | 版本列表/查看 | R | 目前仅 `personal-documents` 资源 | 已 SNAP-READ（按 `object_key`）。**部门文档无版本入口**（`:8-13` 全是 personal 操作）；是否新增部门版本历史是产品决定（Q3）。若上线协作而无历史，无法回看/回滚 | 中（功能缺口而非错误数据） |
| A12 | `utils/enterpriseCodocsDocumentTransfer.ts:117-146` | 个人→项目移交：拷贝正文到项目桶、删源镜像与 `.yjs` | R + W | 仅 `private`（`:122`） | 已 SNAP-READ 且 Runtime 退役头。部门→项目不支持；维持 | 低 |
| A13 | `utils/enterpriseCodocsDocumentTransfer.ts:93-107` | 个人→部门移交发起（创建待接收记录） | W（元数据） | `private` | 发起时若文档有活动协作，接收才是关键点（见 B5）；发起处可加提示 | 低 |
| A14 | `utils/enterpriseCodocsCompanyQuickPublish.ts:74-76`（拷贝在 `codocs/server/utils/companyAssetQuickPublish.ts:44`，计划在 B3） | 部门文档快速发布到公司资产：`client.get(item.sourcePath)` 拷贝到公司路径 | R + W（新公司文档） | `department`（`status=1`） | SNAP-READ：计划项需携带快照引用（key/version/size/sha256/generation），拷贝按精确版本；证据回执记录源 generation | **高**。把旧稿发布到全公司可见的组织资产，难以撤回 |
| A15 | `utils/enterpriseCodocsDepartmentCabinetConvert.ts:56-95`（Go `department_cabinet_conversion.go:88-184`） | 部门文件柜 DOCX → 新建部门文档；重放校验 `oss_path` 前缀 | R（柜文件，非文档正文）+ W（新 v1 文档） | 源为 `cabinet_files`；目标 `department` | NONE：写新 v1 文档；重放只比前缀，v2 转换后仍成立。补“转换后文档再转 v2”用例即可 | 低 |
| A16 | `utils/enterpriseCodocsDepartmentAssets.ts:106,151,181` | 部门资产列表/预览/导出 DOCX（OSS 前缀浏览的**发布归档物**） | R | 归档文档 `status=2`（`publishedDocumentType`） | KEEP-PATH：归档物不可变、永不转 v2。硬性规则：转换入口必须拒绝 `status<>1` 与归档路径文档 | 低 |
| A17 | `utils/enterpriseCodocsDocumentCreation.ts:56-79`；`enterpriseCodocsDepartmentDocuments.ts:223-258` | 创建文档写初始正文到新 `oss_path` | W（新文档） | `private`、`department` | NONE；转换是后续点击时的独立事件 | 低 |
| A18 | `utils/enterpriseCodocsReviewHistory.ts:14`（Go `reviews.go:459-475`） | 按 `oss_path` 查发文记录 | R（元数据键） | 归档/只读文档 | KEEP-PATH | 低 |

### B 组：Data Runtime（`data-runtime/internal/apps/codocs`，Runtime 本身不读 OSS，只把路径/计划交给 BFF）

| # | file:line | 操作 | R/W | 类型 | v2 转换后必须 | 不改的风险 |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | `publish_execution.go:89-91,227-231` | 发文归档计划：`SourceOSSPath = review_oss_path，缺则 documents.oss_path`，交 BFF 拷到归档路径 | R（路径提供） | `department`、`private`、任何被申请发布的文档 | SNAP-READ：计划返回 `bodyRef`（`snapshot` 或 `legacy`）；冻结副本（`review_oss_path`）必须由精确快照生成 | **高**。归档到部门/公司的发文内容≠审批通过内容 |
| B2 | `publish_requests.go:87-96,146-155`（冻结副本生成在 C11） | 记录审批冻结副本路径 | W（元数据） | 同 B1 | 顺序纠正：先设只读并撤销会话（`invalidateCollaboration`），再读精确快照冻结；当前 BFF 是先拷贝后设只读（C11），且拷贝失败仅 `console.warn`（无冻结副本时 B1 退回读活文档） | **高** |
| B3 | `enterprise_company_quick_publish.go:49-63`；`company_asset_quick_publish.go:124-146` | 快速发布计划：`SELECT title,oss_path… FOR UPDATE` 写入 `plan_json.sourcePath` | R（路径提供） | `department`（`status=1`） | SNAP-READ：计划项携带快照引用；计划 JSON 与回执模式需版本化（旧计划仍可重放） | **高**（同 A14） |
| B4 | `enterprise_department_document_restore.go:70-100`；`personal_document_restore.go:47-70`；`document_lifecycle.go:371-375` | 恢复计划/提交读写 `oss_path` | R + W | `department`、`private` | 同 A9/A10：v2 文档计划标记 `snapshot_backed`，Host 不拷贝旧镜像 | 中 |
| B5 | `department_shares_enterprise.go:164` | 个人→部门**接收**：`UPDATE documents SET doc_type='department',dept_code=…` | W | `private`→`department` | 同事务 `invalidateCollaboration`（epoch+1、会话 `revoked`），并清理个人分享写授权对协作的残留；头保留（v2 继续）。设计 §1.3、§2.5、T-M6 已要求；此处是代码落点 | **高**。私人协作会话在文档变为部门文档后继续存活，会话内参与者授权与新类型不匹配 |
| B6 | `document_lifecycle.go:211-223`；`personal_document_update.go:182,264`；`collaboration.go:28`；`collaboration_versions.go:70` | 已有 v2 互斥守卫（内容保存、旧 Collab 上下文、旧 Collab 版本创建） | W（拒绝） | 全类型（按 UUID） | REJ 已就位；**补部门 v2 用例**。`document_lifecycle.go:215-217` 注释承认旧保存“不在行锁下”，竞态只污染镜像 | 低（补测试） |
| B7 | `document_lifecycle.go:352-358` | 独立端删除：改写 `oss_path` 为 `recycle.bin/…` | W | 全类型 | 镜像随路径移动，快照不动；恢复后 Host 读修复才补齐镜像。路径漂移后目录 LIKE 分类（B8）不受影响，因为 `recycle.bin/` 文档不在列表 | 低 |
| B8 | `document_queries.go:53,120,142-145,449`；`open_department_documents.go:57,70`；`reviews.go:108,297,446,469`；`collaboration.go:161-275`；`private_folder_pages.go:70` | `oss_path` 作过滤/身份/分类（排除 worklogs/周报、by-path 查发文记录、位置标签） | R（元数据） | 全类型 | KEEP-PATH：**转换与协作发布不得改写 `oss_path`**；设计中如要把 `oss_path` 指向快照将破坏这些查询 | 低（只要不改路径） |
| B9 | `product_document_service.go:39`；`altoc_entity_document_service.go:80`；`project_document_service.go:92`；`project_document_quality_service.go:199` | 服务内容授权：返回 `ossPath` 给 BFF 读取 | R（路径提供） | 名义上 product/altoc/project，但按 UUID + ACL，**Runtime 未按类型收窄**（`altoc`/`project` 两处仅查 `status=1` 与 ACL）[推断] | 核实是否可命中 `department`；若可，返回 `bodyRef`，否则在 Runtime 加类型断言。转换名单不含这些类型，风险仅在跨类型 UUID | 中（待核实） |
| B10 | `company_weekly_summary_service.go:96-157`（BFF 写 `utils/companyWeeklySummaryService.ts:140`） | Aims 公司周报汇总：BFF 写固定路径 `codocs/publish/company/<period>/…`，Runtime 落 `company` 文档 | W | `company` | NONE；规则：`company`/`knowledge` 永不转 v2（转换入口按类型白名单，仅 `department`） | 低 |
| B11 | `enterprise_department_document_create.go:115-152`；`document_lifecycle.go:40-140`；`department_cabinet_conversion.go:170-184` | 创建文档并绑定初始 `oss_path` | W | `private/department` | NONE | 低 |
| B12 | `personal_document_project_transfer.go:64-108` | 个人→项目：改 `oss_path`、退役头、撤销会话 | W | `private` | 已就位；可作为 B5 的写法模板 | 低 |
| B13 | `document_snapshot_read.go:47-59`；`document_snapshot.go:119-131` | 快照读/发布的类型与授权门槛（**使能改动，非消费者**） | R/W | 仅 `private` | 参数化为部门策略（设计 R1）；本清单的所有 SNAP-READ 行依赖它 | — |

### C 组：独立 Codocs BFF（`codocs/server`，含 `/api/v1` 服务接口）

独立 Codocs 是迁移期存量服务；这些路径**没有任何快照感知**（`snapshot` 字样只出现在 Yjs 恢复与审批流程快照上）。设计 §1.3 已确认转换后 v2 文档的旧 PUT/旧 Collab 会 409，因此建议：**能失败关闭的一律失败关闭，只有 Host 尚无等价能力的少数路径才改造**。

| # | file:line | 操作 | R/W | 类型 | v2 转换后必须 | 不改的风险 |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | `api/documents/[uuid]/index.get.ts:72-75` | 独立端打开文档读正文（含 Yjs 恢复） | R | 全类型 | REJ 或 SNAP-READ（Runtime 元数据行带 `snapshot_generation`，v2 时 409 提示“请在企业端打开”） | 中高。旧镜像被当成当前稿 |
| C2 | `api/documents/[uuid]/download.get.ts:28-30` | 独立端下载 | R | 全类型 | 同 C1 | 中高 |
| C3 | `api/documents/download-content.post.ts:136-141` | 批量取正文 | R | 全类型（含 git-project） | 同 C1，仅对解析出的文档 UUID 判 v2 | 中 |
| C4 | `api/documents/[uuid]/copy.post.ts:69-86` | 独立端复制 | R + W | 全类型 | 同 C1 | 中 |
| C5 | `api/documents/[uuid]/index.put.ts:63-79` | 独立端保存：**先** `uploadDocument(oss_path)`，**后**调 Runtime 更新（此时才被 `document_on_snapshot_v2` 拒绝） | W | 全类型 | REJ 且必须前置：先调 Runtime 校验（或先读 `snapshot_generation`）再写 OSS。当前顺序下 409 返回时**镜像已被旧内容覆盖** | **高**。每次旧端误保存都破坏镜像；与依赖镜像的一切路径叠加 |
| C6 | `api/documents/[uuid]/index.delete.ts:39-43`；`restore.post.ts:66` | 独立端回收/恢复：移动 OSS 对象、改 `oss_path` | W | 全类型 | 镜像移动无害；恢复后以快照为准。可保持，Host 读修复补镜像 | 低 |
| C7 | `api/documents/[uuid]/versions/[versionId].get.ts:47-58` | 独立端版本查看：`client.get(doc.oss_path,{versionId})` | R | 全类型 | v2 版本行的 `oss_version_id` 属于快照对象，配 `oss_path` 必 404；改为按 `object_key` 读或对 v2 文档 REJ | 中（功能失效为主） |
| C8 | `api/open-department-docs/[uuid].get.ts:21-23` | 独立端开放部门文档读取 | R | `department` | 同 C1；Host 侧对应 A6 | 中高 |
| C9 | `api/v1/documents/[uuid]/content.get.ts:26-28` | 服务接口（`codocs:documents:read`）按 UUID 取任意文档正文，**不限类型** | R | 全类型 | 对 v2 文档 REJ 或 SNAP-READ；当前 Aims 侧无调用方（`getCodocsDocumentContent` 无引用）[核实]，但接口仍开放 | 中 |
| C10 | `api/v1/service/project-documents/[uuid]/content.post.ts:181`；`…/altoc-entity-documents/[uuid]/content.post.ts:44`；`utils/productDocumentContentService.ts:38`；`utils/productDocumentCreateService.ts:42` | 服务内容读取：按 B9 授权路径下载 | R | project/altoc/product（B9 待核实是否可达 department） | 随 B9：加类型断言或 bodyRef | 中（待核实） |
| C11 | `api/reviews/publish-requests/index.post.ts:191-193`（只读标记在其后 `:209` 附近） | **发文申请冻结副本**：读 `document.oss_path` 拷到 `review_oss_path`，随后才置只读 | R + W | `department`、`private` | SNAP-READ（精确快照）；顺序改为先置只读并撤销会话再冻结；拷贝失败不得静默 | **高**。审批的“冻结稿”是旧镜像；协作期间的最新编辑在审批与归档中丢失 |
| C12 | `api/reviews/[id]/archive.post.ts:66-70` | 发文归档：读 `plan.sourceOssPath`（冻结副本或活文档）写归档路径 | R + W | 同 C11 | 随 B1 的 `bodyRef`；冻结副本存在时读冻结副本即可 | **高**（无冻结副本时读活文档旧镜像） |
| C13 | `api/weekly-reports/revise.post.ts:73-88`；`create.post.ts:164` | 部门周报修订：读 `oss_path` 生成归档版、写回 | R + W | `department`（`…/weekly-reports/…`） | 周报不应进入协作转换（Q4）；否则 REJ | 中。Host 无部门周报入口，仅独立端可达 |
| C14 | `api/dept-cabinet/[id]/to-document.post.ts:63`；`api/cabinet/[id]/to-document.post.ts:63` | 文件柜转文档（写新文档正文） | W（新 v1 文档） | `department`/`private` | NONE | 低 |
| C15 | `api/company-assets/import-documents.post.ts:30`（拷贝 `utils/companyAssetQuickPublish.ts`） | 独立端快速发布 | R + W | `department` | 同 A14 | **高**（独立端仍可达则同 A14） |
| C16 | `api/admin/images.delete.ts:52`；`images.get.ts:69`；`images/doc-content.get.ts:41` | 管理端图片清理：下载文档正文，`content.includes(图片名)` 判“被引用” | R | 全类型 | SNAP-READ；否则以旧镜像判“未引用”，**据此删除仍被 v2 正文引用的图片** | **高**（数据损毁；管理员操作） |
| C17 | `api/admin/cleanup-yjs.delete.ts:63,97` | 批量删除 `codocs/` 下全部 `.yjs`（含快照 `.yjs`） | W（删除） | 存储层 | 已被 Foundation 写一次命名空间挡住（`objectStorage.ts:698` 对含快照键的批次整体拒绝），但会使**整批失败**；应排除 `codocs/snapshots/` 前缀 | 低（无数据损失，但清理任务对含快照的桶恒失败） |
| C18 | `api/dept-assets/preview.get.ts:14`；`export-docx.post.ts:50` | 部门归档物预览/导出 DOCX | R | 归档 `status=2` | KEEP-PATH（同 A16） | 低 |
| C19 | `api/worklogs/create.post.ts:108`；`personal-weekly-reports/create.post.ts:155`；`weekly-reports/create.post.ts:164`；`documents/index.post.ts:41`；`documents/upload.post.ts:79` | 创建/上传写新文档正文 | W（新文档） | `private/department` | NONE | 低 |

### D 组：Collab、Foundation、Aims、Workflow、前端

| # | file:line | 操作 | R/W | 类型 | v2 转换后必须 | 不改的风险 |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | `collab/src/extensions/persistence.ts:128-166`（v1 加载）、`:209-241`（v1 存盘：先写 `.yjs` 再写 `oss_path`，最后才创建版本） | 旧 Collab v1 房间读写 `ossPath`/`.yjs` | R + W | 全类型（JWT 模式） | REJ：转换后新连接已被 Runtime 拒绝（`collaboration.go:28`），但**转换时已打开的 v1 房间**继续存盘，覆盖镜像与 `.yjs`（版本创建随后被 `collaboration_versions.go:70` 拒绝，但对象已被写）。转换须先关闭/拒绝 v1 房间，存盘前复核 v2 | **高**。转换瞬间在线用户的 v1 存盘会用旧内容覆盖镜像；设计 §1.3 第 6 点只提了“其保存会被 409”，未提对象已被覆盖 |
| D2 | `collab/src/utils/document-context.ts:38-99`；`utils/collaboration-auth.ts:67-89`；`providers/cloudflare-durable-object.ts:186-208` | v1 认证上下文携带 `ossPath` | R | 全类型 | 随 D1 | 低 |
| D3 | `collab/src/utils/v2-snapshots.ts`（admit/load/store/renew） | v2 路径 | R + W | 类型无关 | 已就位（授权部门化属 R1/C1） | — |
| D4 | `foundation/server/utils/objectStorage.ts:674-699` | 写一次命名空间守卫 | W（拒绝） | `codocs/snapshots/` | 已就位；注意不覆盖 `oss_path` 镜像本身（镜像可被覆盖，这是有意的） | 低 |
| D5 | `foundation/server/utils/enterpriseRuntimeClient.ts:111-116` | 快照/协作操作表（仅 `personal-document-*`） | — | — | 新增 `codocs.department-documents-snapshot-{read,prepare,publish}` 与 `…-collaboration-open`（设计 §2.3）；若增加“开放部门读”与 `bodyRef` 计划变体同样登记 | 中（缺则 A1/A6 无法落地） |
| D6 | `aims/server/utils/codocsApi.ts:895-935`；`aims/server/api/v1/codocs/documents/[uuid]/section.get.ts` | Aims 读 Codocs **项目**文档正文（`getCodocsProjectDocumentContent`） | R | `project` | NONE：项目文档不进入转换白名单，项目移交已退役头 | 低 |
| D7 | `data-runtime/internal/apps/aims/project_documents.go:196-384`；`work_item_documents.go:276-308` | Aims 自有表 `project_documents.oss_path` 保存项目文档/文件柜路径副本 | R/W（Aims 表） | `project`、项目文件柜 | NONE（与 Codocs `documents` 无关联性；仅当未来允许项目文档进入 v2 才需重审） | 低 |
| D8 | `aims/server/utils/codocsApi.ts:687-715`（`department-documents/search` 服务能力） | Aims 检索部门文档**元数据** | R（元数据） | `department` | NONE（不含正文；`search.post.ts:183` 仅 `content_size`） | 低 |
| D9 | `workflow/server/api/v1/service/codocs-publish-approval.post.ts` | 发文审批流程：转发命令，不读正文 | — | — | NONE；审批通过后由 Codocs 发文执行（B1/C12）按冻结副本归档，Workflow 无需改 | 低 |
| D10 | `codocs/app/pages/documents/[uuid].vue:481,808-819` | 前端用 `oss_path` 判公司路径与查发文记录 | R（元数据） | 全类型 | KEEP-PATH | 低 |
| D11 | `codocs/app/composables/useAi.ts`、`server/api/ai/*.ts` | AI 润色/摘要：调用方传入编辑器文本；`abstract` 仅写元数据 | — | — | NONE（服务端不按 `oss_path` 读正文） | 低 |
| D12 | 搜索/索引 | 无全文索引：列表搜索仅 `d.title LIKE`（`document_queries.go:104,207`） | — | — | NONE；若日后加索引，必须从发布头或 `content_size/updated_at` 变更触发 | 低 |
| D13 | Host `dept-shares`、`collab-docs` 列表（`collaboration.go:161-275`） | 元数据 | R | — | NONE | 低 |

### E 组：已核对、无需改动（不计入消费者数）

- Aims 公司周报汇总只在 Codocs 创建 `company` 文档（B10），不读部门文档正文。
- `project_document_quality_service.go` 等按项目文档处理，不含部门类型。
- 文件柜（`cabinet_files`）的预览/下载/发布（`enterpriseCodocsDepartmentCabinet.ts`、`…CabinetPublish.ts`）读的是柜文件对象而非文档正文。
- 公司资产浏览/预览（`company-assets/*`）读 OSS 前缀下的公司/发布物，为不可变或非协作对象。

## 4. 高风险清单与理由

| 排序 | 项 | 一句话 |
| --- | --- | --- |
| 1 | A1 + A4/A5/A6 | 读取瓶颈门槛为 `private`；不改则部门 v2 文档的查看、下载、复制、开放阅读全部读到旧镜像且无告警 |
| 2 | C11/B2/B1/C12 | 发文冻结与归档读旧镜像；顺序问题（先拷贝后只读）让冻结稿可能早于最新编辑 |
| 3 | A14/B3/C15 | 快速发布把旧稿拷成公司资产（全员可见） |
| 4 | C5 | 独立端 PUT 先写 OSS 再被拒，镜像被旧内容覆盖 |
| 5 | D1 | 转换时在线的旧 Collab v1 房间继续存盘，覆盖镜像与 `.yjs` |
| 6 | C16 | 管理端图片清理据旧镜像判“未引用”并删除仍被引用的图片 |
| 7 | B5 | 个人→部门接收不失效私人协作会话/不处理头 |
| 8 | A2 | 读时修复镜像对热点文档造成写放大，且只读用户触发存储写 |

## 5. 按归属模块汇总：必须改什么 + 工时

工时为一名熟悉代码者的净人时，含单测/合同测试，不含 hzy0 端到端验收（V1）和环境工作（P0）。

| 组 | 模块 | 必须改动 | 覆盖行 | 估时 |
| --- | --- | --- | --- | --- |
| G1 | Host 正文读取泛化 | A1 门槛 `private`→`department`（有头即用快照）；返回 generation/epoch；部门读快照 Runtime 操作（依赖 R1）；A6 开放部门读取的独立授权分支；A2 决定不做读时镜像修复或限频；A3/A4/A5 判空与幂等意图纳入 generation；契约测试（下载/复制/开放部门/元数据只读用户） | A1–A7 | 12–18 h |
| G2 | Host 恢复/移交/版本 | A9/A10 恢复不依赖镜像、v2 计划标记；A11 是否新增部门版本历史（Q3，若做 +8 h）；A13 提示 | A9–A13 | 6–10 h（不含版本历史） |
| G3 | 发文与快速发布（Runtime 计划 + BFF 拷贝） | 定义 `bodyRef`（`snapshot` 或 `legacy`）与计划/回执模式版本化；B1/B3 计划返回引用；B2 顺序（先只读+撤销会话，再冻结）；C11/C12/A14/C15 拷贝按精确版本；Foundation 提供 `readBodyByRef` helper；测试（含重放旧计划） | B1–B3、C11、C12、A14、C15 | 14–20 h |
| G4 | Runtime 其余 | B5 接收事务内失效会话；B4 恢复计划变体；B9 类型断言/核实；B6 部门 v2 守卫用例；D5 Foundation 操作表登记；`document_snapshot_read.go`/`document_snapshot.go` 部门策略（R1 已含，此处只计消费者所需的读变体） | B4–B9、D5 | 10–16 h |
| G5 | 独立 Codocs 失败关闭 | 元数据行带 `snapshot_generation`；C1–C4/C7–C9/C10/C13 对 v2 返回 409 提示；C5 顺序改为先 Runtime 校验；C16 用精确快照或对含 v2 文档跳过；C17 排除 `codocs/snapshots/`；测试 | C1–C10、C13、C16、C17 | 12–18 h（若声明“v2 部门文档不再经独立端访问”并直接由 Runtime 元数据层统一拒绝，可降到 6–8 h） |
| G6 | 旧 Collab v1 | D1 转换前后拒绝/关闭 v1 房间；存盘前复核（读 v2 标记）；`.yjs` 不再写；测试 | D1、D2 | 4–8 h |
| G7 | 无需改动（验证） | B8/A15–A18/D6–D13：补“转换后路径稳定、归档物不转换、company/knowledge/product/project 不进入白名单”的断言测试 | — | 3–5 h |
| 合计 | | | | **61–95 h**（约 8–12 人日），另需 V1 端到端与 P0 环境 |

与设计文档 §7 H1 行（16–24 h）的差异：H1 原文仅覆盖 Host 与页面，未含 G3 Runtime 计划变体、G4、G5、G6。

**依赖关系**：G1/G3/G4 依赖 R1（部门快照读/授权与 `bodyRef` 的 Runtime 出口）；G5/G6 与 R1 无耦合，可立即并行；G7 为收尾。

## 6. 推荐做法：快照读取 vs 镜像

**结论：快照读取为主，镜像仅尽力而为，不承担正确性。**

理由：

1. **镜像无法在 Collab 路径上保持新鲜。** Collab 与 Runtime 不写 `oss_path`（Collab 不持 OSS 凭据，设计 §1.1）。让 Collab 或 Runtime 在发布后同步镜像，等于在每次存盘（数秒级）增加一次 OSS 写和一个新的失败点，并需要新的对象覆盖语义与幂等；失败时仍要有读修复兜底。得不偿失。
2. **读时修复（A2）把写放到读路径**，放大且授权错位。
3. **读者/拷贝者拿到的必须是可校验、可归因的版本。** 精确快照带长度与 SHA-256，回执可记录源 generation，恰好满足发文/快速发布的审计诉求；镜像做不到。
4. **失败关闭比“尽量新”安全。** 无法改造的读者（独立端、旧 Collab）对 v2 文档拒绝，用户得到明确提示，而不是旧稿。

落地要点：

- Runtime 元数据行统一带 `snapshot_generation`（`0`=v1），所有 BFF 据此判断，而不是各自猜测。
- 计划类接口返回 `bodyRef`；Host/BFF 只通过 Foundation 的单一 helper 读取，保证长度+摘要校验（复用 `readSnapshotMarkdown` 的实现）。
- 镜像保留的唯一理由：老旧脚本/人工排查可读、以及独立端在回滚场景下的应急。保留 Host 侧“转换时写一次 + 保存时写”（现有），对部门**不做读时修复**；`oss_path` 值保持不变（B8 依赖）。
- 需要“镜像不陈旧”的唯一场景是回滚到 v1（关闭部门协作开关）：回滚步骤应包含一次“按头重建镜像”的运维脚本，并在回滚前锁定协作。这属发布计划，不是常态依赖。

## 7. 待决问题

| 编号 | 问题 | 建议 |
| --- | --- | --- |
| Q1 | 部门读者、下载、复制、开放部门读取的“读快照”授权：新增 `department-documents:snapshot-read`（部门 R）与 `open-department-documents` 变体，还是在既有 `view/download` 视图里由 Runtime 回传头引用（单一授权点，Host 不再单独调用）？ | 推荐后者：视图/下载响应内含 `bodyRef`，Host 只做取对象，避免第二次授权往返 |
| Q2 | 独立 Codocs 对部门文档是否声明“部门协作上线后不再提供正文读写”，统一由 Runtime 元数据层拒绝？ | 是，可把 G5 降到约一半工时 |
| Q3 | 部门文档是否提供版本历史（A11）？协作产生的每次发布都有 `document_versions` 行 | 首版建议提供只读列表+查看（复用 `object_key` 逻辑），回滚另议 |
| Q4 | 部门周报（`…/weekly-reports/…`）、`status=2` 归档物、`company/knowledge/product/project/slide` 是否明确排除在转换白名单外？ | 是；转换入口仅 `doc_type='department'` 且 `status=1` 且路径不含 `/weekly-reports/` |
| Q5 | 转换时在线的旧 Collab v1 房间处理：拒绝转换直到房间清空，还是强制关闭房间并提示（可能丢失未存盘编辑）？ | 建议先探测（Collab 房间/最近存盘时间），有活动 v1 房间则拒绝转换并提示稍后重试；不强制关 |
| Q6 | 发文申请冻结：是否引入“先只读撤销会话、再冻结”的新顺序（会使正在协作的成员被踢出）？ | 是，与设计 Q1“撤销会话”一致 |
| Q7 | B9/C10 的服务内容接口是否可命中部门文档？需运行时核实或在 Runtime 加类型断言 | 加断言，成本低 |
| Q8 | 是否需要“回滚到 v1”的镜像重建脚本与流程（第 6 节末）？ | 需要，纳入发布计划，不属于 H1 |
| Q9 | Runtime 是否可在 `publish` 事务外做**异步**镜像（有 OSS 凭据）？本文不推荐，若产品要求“独立端可读最新稿”再评估 | 暂不 |

## 7.1 批次 H1b 实现状态（2026-09-29，Runtime / 独立 Codocs / 管理端）

决定：精确快照为权威、镜像仅兼容副本；不能或不宜改造者对 v2 返回 409；Q2 独立端不再读写部门文档正文；Q4 白名单；Q6 先只读并撤销会话再拷贝；Q7 服务内容接口加断言；Q8 回滚脚本入发布计划；Q9 不做异步镜像。合同见 MODULE_CONTRACTS「Codocs v2 快照文档的非 Host 正文消费者」。

- **已改（代码 + 测试）**：B1、B2 顺序、B3（计划返回 `sourceBodyRef`/`bodyRef`）、B5（R1 已实现，隔离 MySQL 用例已存在并保持通过）、B6 部门用例、B9/C10（v2 一律 409；未按类型拒绝，因 Aims 项目可合法引用 v1 部门文档）、C1–C5、C7–C9、C11、C12、C13（revise 拒绝 v2）、C15、C16、C17、D1/D2（Runtime 侧 `collaboration.go`/版本创建守卫对部门 v2 补隔离 MySQL 用例；collab/ 未改）、Q4 白名单。
- **本批次未做（属 Host/Foundation/页面或产品决定）**：A1–A6、A8–A14（`enterprise/**`）；A14 的 Host 侧快速发布复制需消费 `bodyRef`；B4/A9/A10 恢复计划的 `snapshot_backed` 标记（Host 恢复依赖）；A11 部门版本历史（Q3）；D5 操作表登记（`enterpriseRuntimeClient.ts`）；Aims/Workflow 无代码改动（Aims 经 Codocs 服务接口读取，409 已由其调用方原样传递或降级；Workflow 只转发命令）。

### 7.1.1 批次 H1c 收尾（2026-09-29，Runtime / Host / 页面）

不新增 capability、grant 或 schema；hzy0 启用步骤见 [启用计划](./Codocs-Collaboration-hzy0-Enablement-Plan.md)。

- **A6 收尾**：企业 `open-department-documents:view` 由服务端追加 `include_snapshot_ref=1`，转换后的开放部门文档在 Host 可按精确版本读取（授权、范围、permit 动作不变；`list` 与浏览器 `query` 不能索取）。此前“部门协作开关启用前须补齐”的阻塞已解除。
- **A9/A10/B4 已闭合**：个人与部门恢复计划带 `snapshot_backed`，`state_sha256` 绑定快照代际；恢复只翻状态，不复制镜像与 `.yjs`、不动发布头。Host 部门与个人恢复看到该标记即跳过存储阶段。隔离 MySQL 覆盖镜像路径与 `recycle.bin/` 路径两种存量形态、v1 对照、陈旧哈希、非经理与错部门。
- **A11 首版闭合（Q3，只读）**：新增 Runtime 读操作 `department-documents:{versions,version-view}`（复用 `codocs:enterprise-host:execute` 与 `department-documents` 读 permit，随三开关注册）与 Host 路由 `GET …/departments/documents/:uuid/versions[/:versionId]`，Host 复用个人版本历史的 `object_key` 读取与摘要校验（抽为共享函数）；页面对部门文档使用该端点，只读成员可查看，隐藏差异与恢复。回滚/删除版本不在首版。
- **仍未做**：Q8 回滚到 v1 的镜像重建脚本（发布计划）；A13/A15–A18 无需改动的结论不变；D1/D5 及 Collab 侧（C1）已由其他批次合入。所有环境写入与浏览器双人验收仍未执行。

## 8. 证据边界

- 已读：本文所引 Go / TS / Vue 源码（`file:line` 见表）；未运行任何测试或命令写入。
- 推断：B9/C10 是否可命中部门文档；Aims `getCodocsDocumentContent` 无调用方（仅按 `grep` 结果）；C13 部门周报仅独立端可达（按 Host 路由清单）；E 组各项的“无需改动”结论基于阅读入口代码，未逐个跟到底。
- 行号取自 `b94b39f2`，后续改动可能漂移；实施前以符号名复核。

## 9. H1a 处理记录（Host 侧，2026-09-29）

按本清单编号：A1（部门 v2 读取门槛放开，单一读取瓶颈）、A2（取消读时镜像修复，个人与部门）、A3/A4（下载判空改为“有快照或有路径”）、A5（复制源正文经 A1；暂存意图未改，见设计文档 H1a 第 5 点）、A6（开放部门读取：Runtime 标注 `snapshot_generation`，0 读原路径，v2 需 `snapshot_ref`，缺失失败关闭）、A8（部门 v2 文档无 HTTP 保存，入口本就不存在；个人 v2 保存路径未改）、A14（快速发布计划项 `bodyRef` 精确版本校验、暂存后拷贝；`sourcePath` 与 `bodyRef` 皆无则失败关闭）已在 Host 侧处理；A7/A12/A13/A15–A18 无需改动。A9/A10、A11 与企业 `open-department-documents:view` 的 `snapshot_ref` 已由 H1c 处理（见 7.1.1）。B/C/D 组由其他批次负责。
