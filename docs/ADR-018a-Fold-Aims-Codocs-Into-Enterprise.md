# ADR-018a：Aims 完全并入 Enterprise，Codocs 撤销独立应用层

状态：**已批准（切换后实施）**。用户 2026-09-30 判断“Aims 和 Codocs 没有单独保留的必要了，应该完全整合进 Enterprise”，并同意本文所依据的建议；同日对 §6.2 的待决项 D1–D7 答复“同意按你的建议”，决定见 §6.2。本文只规划 **10-02 生产切换之后**的工作；10-02 切换保持现有结构，冻结在 `s4-rc2`，本文不改变该切换的范围、制品或验收。批准的是方向与规则，不表示任何阶段已实施或在环境生效。

日期：2026-09-30。版本：1.2（1.0 起草；1.1 记录用户对 D1–D7 的决定并起草进程内调度规则；1.2 D11 整合后服务授权收敛定稿，2026-10-01）。起草：Claude（Fable）。

补充对象：[ADR-018](./ADR-018-Unified-Enterprise-Application-and-Data.md)（统一企业应用与租户业务库）、[ADR-019](./ADR-019-Enterprise-Business-Frontend-Integration.md)（企业侧前端整合）。实施进度仍只在 [统一企业应用实施计划](./Unified-Enterprise-Implementation-Plan.md) 维护；本文不声明任何路径已切换、已发布或已在环境生效。

## 1. 决策

1. **Aims 完全并入。** Aims 不再作为独立应用或独立进程存在。自托管后 Aims 进程只剩后台任务，这些任务迁入客户侧 Runtime 的 `internal/enterprisescheduler`，在 Runtime 进程内执行（D1）。此后撤掉 `hzy-aims` 进程、`aims.runtime` 服务客户端及其全部 grant。Aims 调 Codocs 的 Service API 改为 Runtime 内的领域服务调用。尚未迁入 Host 的 Aims 深层页面直接做成 Enterprise 原生页面，不再经过 Aims 应用层。
2. **Codocs 撤销应用层，保留文档领域。** 普通页面（团队汇报、发文、项目组文档、知识库、部门/公司/个人空间等）与文档编辑页全部原生进入 Enterprise。文件转换与预览（处理不可信的上传文件）保留为**无界面、不对公网暴露**的隔离服务。Collab 维持独立长连接服务（与 [ADR-020](./ADR-020-Ygo-Collab-Connector-Runtime-Integration.md) 的延期路线一致）。“文档”作为业务领域继续存在：它的数据、授权资源和 Runtime 域都保留，撤掉的只是独立的 Nuxt 应用、它的服务身份和对外 Service API。
3. **顺序：** Aims 调度迁移 → Aims 残余页面与进程退役 → Codocs 页面与编辑页原生化 → Workflow 并入统一库与 Runtime 域的**评估**（本文不做决定）→ 旧路径退役（INT-701～705）。
4. **不变的部分：** 人员权限模型、manifest 作为资源与动作的唯一事实源、对象范围在 Runtime 复核、每租户每环境独立业务库、Host 不持有数据库凭据、Platform 独立。

### 1.1 理由

- **Aims 进程已经空心化。** 自托管生产里 Aims 的页面已由 Enterprise Host 承载，`hzy-aims` 只跑 `aims/server/tasks/` 下的三个任务：集成操作投递（`integration-operations/drain.ts`，含公司周报发布到 Codocs）、到期通知（`notifications/due.ts`）、里程碑滚转（`milestones/rollover.ts`）。而这三类任务在 Runtime 里已有统一路径（`enterprisescheduler` 的 `completion.go`、`due_notifications.go`、`milestone_rollover.go`、`company_weekly_summary_content.go`）。Aims 进程只是在“唤醒 → 拿 token → 调 Runtime → 再调 Codocs”，多出来的是一个进程、一个服务身份和三到四组 grant。
- **复杂度的实际代价。** 2026-09-29 的 W40 公司周报发布验收里，为了一次投递前后修了十余轮：JWKS 超时、Codocs 目标签名、回执误判 409、OSS 提交号超长、跨 Worker 会话校验等。几乎全部出在“Aims 进程 → Codocs Service API → Codocs 自己的 Runtime 身份”这条跨进程、跨身份的链路上，而不是业务逻辑本身。
- **Codocs 双前端已经没有用户价值。** ADR-019 早已确定 Codocs 不长期保留双前端；hzy0 上部门、公司、个人文档页都已在 Host 原生运行。继续保留 Codocs 应用层，意味着两套页面、两套 BFF、一个额外的服务身份，以及 Host 与 Codocs 之间的委托链。
- **不可信文件的隔离仍然必要。** Office 转换（`codocs/server/utils/officeConverter.ts`）和文本预览会解析用户上传的任意文件，不能与持有会话和业务权限的 Host 同进程。这是保留独立服务的唯一硬理由，而它不需要界面，也不需要业务数据库。

## 2. 与既有文档的关系及需修订的文字

本文**补充**而不推翻 ADR-018/019：统一 Host、统一业务库、Runtime 承担写入与调度、Collab 等真实运行边界可保留，这些都不变。改变的是：ADR-018 §2 表格与 §4.6 把 Codocs、Aims 调度写成“首轮保留现有运行边界 / 原独立服务”，本文把它们的**终态**定为并入。

以下修订在对应阶段的交付物落地时，随代码同一批合入（修订本身不先于事实）：

### 2.1 根 `CLAUDE.md`（Cross-Module Rules 第 3 条）

现文：

> Codocs 长期保留文档领域职责，不以保留完整独立企业前端为目标：普通页面和自有编辑工作区逐步原生组合到 Enterprise；Collab、文件处理与明确需要隔离的预览可保留专用服务。旧页面/iframe 仅作有退出条件的兼容，不能因页面接入就提前停旧消费者或宣称协作/写入验收通过。

修订为：

> 文档是 Enterprise 内的业务领域，不再有独立 Codocs 应用层（[ADR-018a](./docs/ADR-018a-Fold-Aims-Codocs-Into-Enterprise.md)）：全部文档页面与编辑页原生在 Enterprise，文档写入与跨域调用走 Runtime 文档域；仅保留无界面、不对外暴露的文件转换/预览隔离服务和独立 Collab 服务。旧 Codocs 页面、Service API 与 `codocs.runtime` 仅作有退出条件的兼容，不能因页面接入就提前停旧消费者或宣称协作/写入验收通过。Aims 同样不再是独立应用，其后台任务归 Runtime 调度。

同时：端口表中 `aims/`、`codocs/` 两行标注“ADR-018a 退役中”，完成后删除；`codocs/` 的职责描述改为“文件转换与预览隔离服务”。

### 2.2 ADR-018

- §2 表格 “Codocs、Workflow、Collab、通知及 Connector” 一行，改为：“Workflow、Collab、通知及 Connector：首轮保留现有运行边界。Codocs：按 ADR-018a 撤销应用层，文档领域并入 Enterprise 与 Runtime，仅保留文件转换/预览隔离服务。”
- §2 表格 “Aims、Assets” 一行追加：“Aims 按 ADR-018a 完全并入，不保留独立进程。”
- §4.6 表格 “尚未迁移的 Workflow/Codocs/通知/Connector 等” 一行，删去 Codocs；新增一行：“Aims 集成投递、到期通知、里程碑滚转、公司周报发布 → 客户侧 Runtime `enterprisescheduler`（ADR-018a）”。

### 2.3 ADR-019

§（Platform 管理端保持独立…）一段中 “Codocs 的完整独立前端及编辑器 iframe 可在迁移期保留，但不是长期目标” 改为 “Codocs 独立前端与编辑器 iframe 按 ADR-018a 退役；编辑工作区在 Enterprise 内原生实现”。

### 2.4 `docs/MODULE_CONTRACTS.md`

以下合同在对应阶段退役时改写为“已由 Runtime 域内调用替代”，保留历史说明与退役日期：

- Aims 项目文档访问 → Codocs `project-document-access/execute`（来源 `aims.runtime`）；
- Aims 业务领域字典 → Console `business-domains`（`aims.runtime`，`console:business-domain:view`）；
- Aims 公司周报 → Codocs `codocs:company-weekly-summary:publish`；
- Aims 里程碑滚转、到期通知的统一 owner 段落（`aims:milestone-rollover:execute`、`aims:notifications-due:execute`）。

Altoc、Assets 调用 Codocs Service API 的合同（`altoc-entity-documents`、`product-documents`）在阶段 3 一并处理，见 §4。

## 3. 目标形态

### 3.1 进程清单（自托管单站点）

| 进程（systemd 单元） | 现状（S4） | 目标 | 说明 |
| --- | --- | --- | --- |
| `hzy-tenant-gateway` | 保留 | 保留 | 去掉 `/aims/`、`/codocs/` 应用路由，改为旧 URL 兼容重定向到 Enterprise |
| `hzy-data-runtime` | 保留 | 保留 | 新增 Aims 调度的进程内执行与文档域写入能力 |
| `hzy-console` | 保留 | 保留 | 不变 |
| `hzy-enterprise` | 保留 | 保留 | 承载全部 Aims、文档页面与编辑页 |
| `hzy-workflow` | 保留 | 保留（阶段 4 评估） | 本文不决定 |
| `hzy-collab` | 保留 | 保留 | 长连接，独立扩容与故障隔离 |
| `hzy-aims` | 保留（仅后台任务） | **撤销** | 任务迁 Runtime |
| `hzy-codocs` | 保留（页面、编辑器、Service API、文件处理） | **替换为 `hzy-codocs-file`** | 仅文件转换与预览，无界面，仅监听回环地址，不经 Gateway 暴露 |
| `hzy-platform` | 独立 | 独立 | 不变 |

结果：业务相关进程从 8 个减为 7 个（Aims 撤销，Codocs 缩为无界面服务），对外路由从 5 组应用前缀收敛为 Enterprise 一组加 Collab 长连接。

### 3.2 服务客户端与 grant

| 服务客户端 | 变化 | 撤销的 grant（按现合同） |
| --- | --- | --- |
| `aims.runtime` | **撤销** | `aims:integration_operation:execute`、`aims:milestone-rollover:execute`、`aims:notifications-due:execute`（`aims`/`data-runtime`/`tenant-runtime` 三个 audience）；`console:business-domain:view`（aud=console）；`codocs:company-weekly-summary:publish`、`codocs:project-document-access:{read,manage,create}`（aud=codocs） |
| `codocs.runtime` | **撤销** | Codocs 访问自身 Runtime 的全部精确 capability；Codocs Service API 的入站 grant（Aims、Altoc、Assets 调 Codocs 的 `codocs:*` 条目）随调用方迁移逐条撤销 |
| `hzy-codocs-file` | **不设服务客户端**（首选） | 文件服务无状态：由 Enterprise 通过回环地址把字节流和受限参数交给它，它只返回转换结果，不访问数据库、OSS 或 Console。若确需自取 OSS 对象，改为 Enterprise 签发的一次性、单对象、只读 URL，而不是给文件服务长期凭据 |
| `enterprise.runtime` | 保留，**不扩大** | 文档页面沿用现有 `codocs:*` 域能力（Host 通道按 `<domain>:enterprise-host:execute` 例外，域为 `codocs`）；不因并入而给 Host 新增宽 scope |
| Runtime 调度 | **进程内，不签发服务令牌** | 见 §3.3 |

原则：按调用链逐条撤销，不按模块名批量删除（沿用 INT-702）；每撤一条先证明消费者归零。

### 3.3 Runtime 调度的执行身份

Aims 任务迁入 Runtime 后在进程内执行，不再有“另一个进程拿服务令牌调 Runtime”的信任边界，因此不签发服务令牌，也不需要双 audience grant。替代的约束如下：

- 每个任务在 `enterprisescheduler` 的注册表中登记：tenant/environment、任务代码与版本、固定执行主体（系统调度者，**不是任何人员**）、允许的领域动作白名单、幂等身份、租约与执行代次。现有 `registry SHARE lock` 与 `X-HZY-Scheduler-Generation` 语义改为进程内的代次比较，代次变化立即停止剩余条目。
- 任务只能调用注册的领域动作（例如 `aims.milestone.rollover`、`aims.due-notification.scan`、`aims.company-summary.publish`），不能执行任意 SQL 或借用人员权限。
- 触发源是 Runtime 自身的定时器，或 Gateway 已签名的 drain 唤醒（保留为可选，便于运维手动触发）；唤醒只推进调度，不携带业务参数。

这与根 `CLAUDE.md`“新增 scheduled worker、outbox drain…必须包含 Data Runtime 精确 scope 校验、双 audience grant seed/verify”一条的**前提不同**：该条针对的是进程外 worker 通过服务令牌调用 Runtime。进程内任务适用 §8 的增补规则（D2 已批准，随阶段 1 合入 CLAUDE.md）。

### 3.4 统一库与 Runtime 域边界

- **Aims 域**：已在统一库 `hzy_enterprise`（经兼容视图）。不变。
- **文档域（原 Codocs）**：当前 Codocs 数据在独立的 Codocs 库，由 Runtime 的 Codocs 适配器访问。按 D3，**暂不**把文档表并入统一库；阶段 3 的目标是撤掉 Codocs 应用层，文档域继续由 Runtime 的文档适配器主责。将来如要物理合库，另做容量、备份与迁移评估。
- **跨域调用**：公司周报发布、项目文档访问、Altoc 实体文档、产品文档元数据等，改为 Runtime 内“Aims/Altoc/Assets 域 → 文档域服务”的调用（ADR-018 §4.2 允许的受控跨域服务）。每个调用保留幂等键、调用方域、目标对象与动作，并在文档域内按对象范围复核，不因同进程而放宽。
- **OSS**：文档正文写入目前由 Codocs/Host 的 Node 进程持有 OSS 客户端。调度任务（如公司周报发布）不再经过 Host，需要 Runtime 直接写 OSS：凭据从客户侧 Vault（Runtime 已承载，ADR-017）按 `oss.default` 解析，不进 env。Host 侧页面的 OSS 读写路径保持不变。

## 4. 分阶段计划

生产 Runtime 当前为 `0.3.221`，下一版 `0.3.222` 需走签名离线安装；以下“需发 Runtime 版本”均指走该流程的新版本，并需要用户逐次批准安装。

### 阶段 0：10-02 切换（不在本文范围）

保持 `s4-rc2`。本文任何工作不进入该切换。

### 阶段 1：Aims 调度迁入 Runtime

- **交付物**
  - Runtime：进程内调度器，包括定时器、注册表条目、固定系统主体与动作白名单，覆盖集成投递、到期通知和里程碑滚转；公司周报发布改为调用文档域服务，并由 Runtime 经 Vault 取得 OSS 凭据写入正文；审计事件。
  - 调度 owner 切换沿用现有“统一 owner”机制：新路径接管后，旧 `/v1/aims/service/*` 与 Aims 进程的 drain 返回 409 并记为 skipped（与现有 `aims_milestone_rollover_unified_owner` 同构）。
  - 契约测试：代次抢占、重复唤醒不重复业务效果、动作白名单外调用被拒、OSS 写失败可重试且不重复确认工时。
- **是否需发 Runtime 版本**：**需要**（新代码进入 Runtime）。
- **验收**：hzy0 上连续 ≥7 天，三类任务只由 Runtime 执行、Aims 进程日志只有 skipped；公司周报发布端到端通过（生成、审阅、发布、存档文档可读、PM 职责工时确认）；抓包确认发布链路无跨进程服务令牌签发。
- **回滚**：把调度 owner 切回 legacy（Aims 进程恢复执行），Runtime 新路径返回 409；无数据迁移，可随时回退。

### 阶段 2：Aims 残余页面与进程退役

- **交付物**：盘点并迁完未注册的 Aims 深层页面（Enterprise 原生页面，不经 Aims BFF）；Aims 专属的 Host BFF 逻辑下沉为 Runtime 端点或 Host 服务端代码；业务领域字典改读 Runtime/Console 已有 Host 通道，不再经 `aims.runtime`；Gateway 把 `/aims/*` 旧 URL 重定向到 Enterprise。随后停 `hzy-aims`，撤 `aims.runtime` 客户端和 §3.2 所列 grant（先 verify 消费者归零）。
- **是否需发 Runtime 版本**：仅当页面迁移需要新 Runtime 端点时需要；纯页面与路由改动只需 Enterprise 与 Gateway 发布。
- **验收**：INT-701 形式的消费者清单归零，覆盖旧 API、调度、service client、grant、env 和路由；每个迁移页面在 1440/390 下完成对应业务任务；负向授权（无权账号 403、跨部门/跨项目拒绝）复验。
- **回滚**：`hzy-aims` 的 systemd 单元与制品保留一个发布周期，可重新启动；grant 撤销前做备份，回滚时恢复。

### 阶段 3：Codocs 页面与编辑页原生化，文件服务独立

- **交付物**
  - 剩余 Codocs 页面（团队汇报、发文、项目组文档、知识库、模板等）原生进入 Enterprise。
  - 编辑页原生化（D6）：Milkdown/Yjs 编辑器以路由级按需加载并入 Enterprise 主构建，不进入首屏公共包；阶段开始时记录主构建时间与首屏体积基线并确定阈值，CI 检查体积预算；超过阈值再改为 Enterprise 名下的独立静态入口。
  - `hzy-codocs-file`：从 Codocs 抽出 Office 转换与预览，无界面，只监听回环地址，运行在低权限用户与资源限制（CPU、内存、超时、临时目录隔离）下。
  - Altoc/Assets 调 Codocs Service API 的链路改为 Runtime 文档域服务调用。
  - Collab 鉴权改由 Enterprise 签发协作票据（现有 `hostCollaborationTicketRequest` 路径），不再依赖 Codocs 应用。
- **是否需发 Runtime 版本**：**需要**（文档域服务接口、跨域调用、可能新增的文档写端点）。
- **验收**：INT-701c 全项，包括保存、版本、批注、附件/图片、协作、撤权、切换对象、未保存退出、失败恢复及性能记录；恶意文件样本（宏、超大、畸形压缩包、路径穿越）只影响 `hzy-codocs-file`，不影响 Host；Enterprise 首屏体积与时间在预算内。
- **回滚**：`hzy-codocs` 全量应用保留一个发布周期，Gateway 可把 `/codocs/*` 切回旧应用；Service API 在消费者迁完之前保持可用。

### 阶段 4：Workflow 并入评估（只评估）

产出评估报告：Workflow 进入统一库与 Runtime 域的收益、审批状态机与回调合同的迁移代价、与 Console 的关系。**是否迁移由用户另行决定**，不在本文授权范围内。

### 阶段 5：旧路径退役（INT-701～705）

按实施计划执行：消费者归零证明、关闭执行路径（先停写入与调度，再撤路由，再处理身份与配置）、归档历史数据与回执、更新维护体系（CLAUDE.md、MODULE_CONTRACTS、API/schema、部署与恢复、release tag）、复盘复杂度指标。`aims/v*`、`codocs/v*` 组件发布 tag 停止新增；Platform 应用注册表中 aims/codocs 条目按控制面合同处理（见 D5）。

## 5. 安全与授权影响

- **人员权限不变。** manifest 中 `aims`、`codocs` 的资源、动作与应用角色保留原 app code 命名空间，Policy Bundle 结构不变；并入改变的是运行单元，不是权限模型。不得借并入之机把两个应用的角色合并成更宽的角色。
- **对象范围继续在 Runtime 复核。** 页面迁入 Enterprise 后，列表、详情、写入、批量、导出分别做服务端范围检查。部门文档、项目文档、分享等对象关系仍按动态关系授权（ADR-018/根 CLAUDE.md），同进程调用不跳过复核。2026-09-29 验收中发现的“同部门成员能列出但打不开”一类问题，说明列表与详情要用同一判权来源。
- **调度 worker 的范围。** 进程内调度只能执行注册表白名单中的领域动作，以固定系统主体身份写入，并带任务代码、代次与幂等键；它没有人员权限，不能读取任意对象，不能被浏览器或 Host 请求直接触发业务动作。审计记录包括任务、代次、动作、对象与结果。
- **服务身份减少。** 撤掉 `aims.runtime`、`codocs.runtime` 后，攻击面减少两个长期服务凭据和它们的全部 grant；`hzy-codocs-file` 不持有任何凭据。必须防止的回退是：为了图方便让 Host 或 Runtime 获得宽 scope，或让文件服务获得数据库或 OSS 长期凭据。
- **职责冲突。** 公司周报发布会“随汇总确认项目经理本人的职责工时”。当发布者（项目总监）同时是被确认工时的项目经理时，构成自审批。2026-09-29 的测试数据中就是同一个人。按 D4：周报照常发布；发布者本人作为项目经理的职责工时**不随发布自动确认**，改为待第二人确认（该项目的其他审核人或项目总监角色的其他持有人），其余项目经理的职责工时照常确认。判定在人员发起“发布”时由 Foundation 统一授权与职责冲突检查完成，并把“需第二人确认的工时集合”冻结进发布命令；进程内调度只按冻结结果执行，不自行判定、不事后放行。若找不到可确认的第二人，这些工时保持待确认并在工作台提示，不因此阻塞发布。该规则须在阶段 1 上线前实现，并有契约测试覆盖“发布者即项目经理”“发布者非项目经理”“无第二人”三种情形。
- **不可信文件隔离。** `hzy-codocs-file` 使用独立系统用户、只读根文件系统或受限目录、禁止外联网络、严格超时与资源上限；Enterprise 只传入字节与白名单参数，并校验输出类型与大小。

## 6. 风险与未决问题

### 6.1 风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 编辑器依赖重（Milkdown/Yjs/ProseMirror 等） | Enterprise 构建时间与首屏体积上升 | 路由级按需加载、独立 chunk、CI 体积预算；必要时编辑页单独入口 |
| OSS 读取慢（hzy0 实测 2–10 秒，偶发 503 靠重试） | 文档页与调度发布体验差、超时 | 阶段 1 前测生产内网 OSS 时延；Runtime OSS 客户端设超时与重试；失败保持可重试 |
| hzy0 与生产共用 OSS 桶 `wiz-rs` | 测试写入可能覆盖生产对象 | 维持“只写 CLAUDE-FIXTURE 前缀对象”的约束；阶段 3 验收前重新评估是否给测试环境独立桶 |
| Runtime 进程内调度增加 Runtime 故障面 | 调度 bug 影响主进程 | 任务在独立 goroutine 与事务中执行，panic 隔离，可按任务开关停用 |
| 调度迁移期间双执行 | 重复通知、重复确认 | 统一 owner + 代次 + 幂等键；legacy 路径 409 |
| Altoc/Assets 仍依赖 Codocs Service API | Codocs 无法按期退役 | 阶段 3 逐条迁移，未迁完前保留 Service API |
| 根 CLAUDE.md 调度规则与进程内模型不一致 | 规则冲突、评审无据 | 规则已起草（§8，D2 已批准），随阶段 1 代码同批合入 CLAUDE.md |

### 6.2 用户决定（2026-09-30，“同意按你的建议”）

- **D1 调度执行位置：Runtime 进程内。** 不放 Enterprise 服务端任务运行器（需要保留服务令牌与 grant，收益小）。用户还问过是否放 Console 更合适，结论仍是 Runtime：① 调度写入需要与业务数据**同事务**，并受注册表代次锁约束，这些只在 Runtime 内成立；② Nuxt 进程（Console、Enterprise）不持有数据库凭据（ADR-018），放在 Console 就要么给它数据库凭据，要么又回到“进程外 worker 拿服务令牌调 Runtime”；③ Console 是身份与 Vault 的核心，应保持最小职责，不承担业务调度。用户同意。
- **D2 规则增补：同意。** 为“Runtime 进程内调度任务”增补专门规则，与现有进程外 worker 规则并列。规则文字见 §8；**暂不改根 CLAUDE.md**，在阶段 1 的代码落地时与之同批合入。
- **D3 文档库：暂不物理并入统一库。** 阶段 3 只撤应用层，文档域继续由 Runtime 文档适配器访问现有文档库；将来如要合库，另立迁移评估（容量、备份、回滚、Collab 快照）。
- **D4 职责冲突：转第二人确认。** 公司周报的发布者如果就是被确认工时的项目经理，**本人的职责工时不自动确认**，改为待第二人确认；周报本身照常发布，其他项目经理的职责工时照常随发布确认。实现要求见 §5“职责冲突”。
- **D5 Platform 应用治理：保留为功能模块标识。** Platform 应用注册、订阅与 manifest 中的 `aims`、`codocs` 条目保留，作为 Enterprise 内的功能模块标识；权限命名空间（资源、动作、应用角色的 app code）不变，不合并为单一 `enterprise` 应用。
- **D6 编辑页交付：并入 Enterprise 主构建，按需加载。** 编辑器以路由级动态导入进入主构建；如果主构建时间明显变长（阈值在阶段 3 开始时依基线确定并记录），再改为 Enterprise 名下的独立静态入口（同源、同会话、单独构建）。
- **D7 退役节奏：接受。** 阶段 1、2 在 hzy0 连续 ≥7 天、生产连续 ≥14 天无 legacy 执行后，才停对应进程、撤对应身份与 grant。
- **D8 Console 保持独立管理控制台（2026-10-01）。** 用户切换后决定：“倒是可以单独一套控制台，毕竟只有管理员用”，并要求去掉此前迁入 Enterprise 的 Console 管理页，改在 Enterprise 右上角个人菜单为系统管理员提供“控制台”入口（新标签页打开 `/console/`）。据此：
  - Console manifest `hostNavigation` 只保留个人类页面（通知、通知详情、我的待办）；企业资料、用户、部门、项目注册表、委员会、节假日、业务领域、区域、数据运行、运行应用、目录同步的 Host 页面、`/enterprise/api/{directory,organization,runtime-status,work-calendars,org-profile}` BFF、Gateway 登记与仅为其服务的 Foundation 组件已删除；Foundation `consoleUserApiRoutes` 只保留待办读取。
  - “控制台”入口以 Console 快照的 `console_overview:view` 判定（Console 管理首页的进入权限，不按角色名判断），只是 UI 提示；Console 每个页面仍由自身路由守卫判权。快照不可用时隐藏（失败关闭）。
  - Aims、Assets 等业务模块自己的管理页（如“项目管理（管理员）”“周报设置”“产品/资产字典”）不属于 Console，仍留在 Enterprise 侧栏的“控制台 → 业务配置”分组。
  - 同日补充：Console 首页为 `/console/admin`（`/console/` 跳转），去掉 Console 左侧应用栏（含工作台）与个人区“工作台”入口，Console 404 改为“返回控制台首页”；“控制台”入口直达 `/console/admin`。Enterprise 增加 Host 404 页（单一“回到工作台”按钮），Gateway 把未登记的 `/enterprise/*` 页面路径（仅 GET/HEAD、安全字符、非 API）交给 Host 渲染 404，写方法、API 与非常规路径仍返回 unavailable。
- **D9 Workflow 并入统一库（2026-10-01）。** 用户决定：“Workflow 也可以整合到统一的数据库中”。原阶段 4“Workflow 并入评估”改为实施：Workflow 表迁入每租户统一库（沿用 Aims/Assets 的兼容视图、K2 演练与代次切换工具链），Runtime Workflow 域改走统一路径；Workflow Node 进程是否保留另行评估（本决定只涉及数据层）。据此，阶段 1 的工作项完成审批往返（Aims 域提交 → Workflow 域创建审批 → 审批结束回调 Aims 域）设计为 Runtime 内同库事务，不再需要跨库 outbox 与服务令牌；迁移完成前的过渡方式在实施设计中给出。
- **D10 数据库布局（2026-10-01，用户同意）。** 每租户业务库的目标布局：
  - **统一库 `hzy_enterprise`**：Aims、Assets（已并入），Workflow（D9 并入）。
  - **Console 库长期独立**：目录、身份认证、凭证库与系统设置是安全核心，单独成库便于权限与备份隔离。库体积主要来自日志（凭证库访问日志、变更回执、令牌事件），日志归档与保留策略另立事项，不以并库解决。
  - **文档库暂时独立**（同 D3），在 Codocs 整合阶段再评估是否并库。
  - **Finance、Altoc、People、Webdev**：当前未部署、Runtime 适配器关闭；将来启用时**直接以统一库为目标**，不再先以独立库启用后再迁移。
  - **清理**：`hzy_aims_src`、`hzy_assets_src` 为并库前的回滚依据，稳定运行一段时间后归档清理；新机上的 `hzy_platform` 是 Platform 库副本（生产 Platform 库在 gitlab 主机），确认无用后删除（沿用切换收尾清理项）。删除任何库前须备份并取得用户逐项批准。

- **D11 整合后服务授权收敛（2026-10-01 定稿：用户同意原则，条文经 Fable 评审修订后用户确认“同意，定稿吧”，并接受 §9.3 的残余风险）。** 用户提出：“之前应用是分开的，独立授权是有必要的，现在进行了整合，应该把授权这块放一下”。确定原则：**进程内不做服务间授权，跨进程与跨系统边界仍鉴权，人员授权一律不放。** 条文见 §9；首个落地对象是 `hzy-aims` 剩余入口平移进 Enterprise（§9.5）。

## 7. 验收总则

每个阶段按“功能可用、权限不扩大、旧路径可回退、消费者归零有证据”四项验收，不以“进程少了”或“页面进了 Host”单独验收（延续 ADR-018 §10）。环境生效前须完成该环境的 grant verify 与实际令牌签发探测；撤销 grant 前须证明没有调用方仍在使用。

## 8. 进程内调度规则（D2 起草稿，随阶段 1 合入根 CLAUDE.md）

以下文字拟加入根 `CLAUDE.md`“内部服务认证与授权”一节，放在现有“新增 scheduled worker、outbox drain 或可靠集成任务…”一条之后。现有条目的适用范围同时改为“**进程外** worker”。本节在阶段 1 代码落地前只作为设计约束，不改 `CLAUDE.md`。

> - **Runtime 进程内调度任务**（[ADR-018a](./docs/ADR-018a-Fold-Aims-Codocs-Into-Enterprise.md)）：在客户侧 Runtime 进程内执行的定时、outbox drain 与集成投递任务不签发服务令牌，也不需要 service grant；它们的授权边界改由以下约束承担，缺一不可：
>   - 每个任务在调度注册表登记 tenant/environment、任务代码与版本、固定系统执行主体、允许的领域动作白名单、幂等身份、租约与执行代次；未登记的任务不得运行。
>   - 系统执行主体不是任何人员，不继承人员权限；任务只能调用白名单内的领域动作，不得执行任意 SQL、跨域直接写表或借用人员会话。
>   - 每个业务事务都在注册表共享锁内复核当前代次，代次变化立即停止剩余条目；重复唤醒、重放与并发实例不得产生重复的业务效果。
>   - 触发源只能是 Runtime 自身定时器或已签名的运维唤醒；唤醒只推进调度，不携带业务参数。浏览器、Enterprise Host 与其他进程不得直接触发业务动作。
>   - 需要人员判断的规则（授权、对象范围、职责冲突）必须在人员发起命令时由 Foundation 统一授权完成，并把结果冻结进命令；任务只按冻结结果执行，不自行判定或事后放行。
>   - 访问外部资源（OSS、Codocs 文件服务等）所需凭据只从客户侧 Vault 按 integrationCode 解析，不进 env，不写日志。
>   - 每次执行记录任务、代次、动作、对象、结果与失败原因的审计事件；失败保持可重试，并有明确的停用开关。
>   - 代码交付必须包含注册表条目、白名单、代次抢占与重复唤醒的契约测试；从进程外 worker 迁入时，还要验证统一 owner 切换（legacy 路径返回 409）及回退路径。

## 9. 整合后服务授权收敛（D11，2026-10-01 定稿）

### 9.1 背景

服务间授权（Console 签发 `token_use=service` 令牌、目标端精确 capability、逐条 service grant）是为“各应用独立部署、互不信任”设计的。整合后，Aims、文档、Assets、Altoc 等已是 Enterprise 进程内的逻辑模块，业务数据在 Runtime 统一库内由同一进程访问。同一进程内的不同服务凭据不构成隔离：进程被攻破时这些凭据都在同一内存里；它们只增加签发、grant、缓存、核验与排障成本。上线期间生产有效 grant 488 条，B17 阶段的主要工作量是修 grant 漂移；W40 公司周报验收的十余轮返工也几乎全部出在跨进程、跨身份链路上。收敛后 grant 数量的预期值在首批实施设计中按调用链清点给出，作为 §7 验收的比对基线。

### 9.2 原则与适用范围

**适用前提：** D11 适用于**同一信任单元**内的调用：同一操作系统进程或同一 Worker 脚本，并且属于同一租户。目前包括自托管的 `hzy-enterprise`、`hzy-data-runtime` 进程内，以及将来托管云把业务 Worker 合并后的单个 Enterprise Worker 内。凡是跨进程、跨 Worker 的调用，包括托管云合并前仍分开的业务 Worker 之间，都继续适用原有规则。托管云合并后，根 `CLAUDE.md` 中业务 Worker 之间的受信 route 改写规则改为“已由 Enterprise Worker 进程内调用替代”；访问 Console 的 Service Binding、授权依赖 503、`validate:business-cloudflare` 校验，以及 Enterprise 调 Workflow、Console 等独立 Worker 的规则继续保留（用户 2026-10-01 确认：“托管云的多个业务 Worker 也会整合到一个 Enterprise 中”）。

1. **进程内不做服务间授权。** 同一进程内的逻辑模块之间直接调用 owning 模块的 typed 服务端接口，不签服务令牌、不登记 grant、不经 HTTP Service API。
   - Enterprise 进程内：Aims、文档、Assets、Altoc、Console 个人页等逻辑模块之间。
   - Runtime 进程内：各业务域之间的受控跨域服务与共享事务（ADR-018 §4.2；B3 完成审批 lane 是样例）。
2. **跨进程与跨系统边界仍鉴权，原条文不变。** 下列边界继续使用各自现有机制：
   - Enterprise → Runtime：Console 签发的服务令牌与精确 capability（Runtime 持有数据库凭据，是独立信任边界），通道划分见 §9.3。
   - **Runtime 签名用户委托**：用户通道的 HMAC 委托、≤15 秒 permit 与 purpose 绑定保留；B3 已落地的“服务 subject 不能充当 actor”“带 purpose 的请求不能走用户路由”继续适用。
   - **Gateway 自身凭证**：Gateway → 应用的签名唤醒与受信上下文（内部 Token/HMAC、时间窗与防重放）保留。drain 唤醒改指 Enterprise 后是新的 Gateway → Enterprise 入站，必须使用同样的签名唤醒凭证与重放窗口，不因同机而省略。
   - 仍为独立进程的服务之间：Workflow Node（并入前）、Console、Platform、Collab、独立 Codocs（阶段 3 前）。
   - 外部系统集成（企业微信、OSS、GitLab 等）凭据继续只在客户侧 Vault，按 integrationCode 解析。
   - 文件转换服务 `hzy-codocs-file` 的口径不变（§3.2）：仅回环地址、无任何凭据、不经 Gateway；它不是“仍需服务令牌的独立进程”，而是由 Enterprise 传入字节与白名单参数的无状态服务。
3. **人员授权一律不放。** manifest、Policy Bundle、Foundation 统一授权 helper、角色合并与模拟隔离、数据范围、对象关系（项目成员、文档分享等）、职责冲突与短期 permit 全部保留；同进程调用不跳过 owning 模块的对象范围复核（§5）。列表、详情、写入、批量、导出仍分别做服务端检查。

### 9.3 身份收敛与通道分离

- Enterprise 进程对外只用一个服务身份 `enterprise.runtime`。§3.2 中“`enterprise.runtime` 保留，不扩大”改为“`enterprise.runtime` 成为整合应用的唯一服务身份，按域、按通道收敛能力；不得授予跨域或跨通道通配（如 `enterprise:*`、`<domain>:*`），也不得授予数据库级能力”。
- **用户通道与系统通道必须显式分离：**
  - 用户动作路由只接受 `<domain>:enterprise-host:execute`，并且必须带有效的签名用户委托与 permit；没有用户委托的请求在用户路由上一律拒绝。
  - 系统任务路由（drain、定时、回调转投）只接受每域一项的系统调度能力（暂名 `<domain>:scheduler:execute`，实施设计定名），**不得携带用户委托**，执行主体固定为 `system:*`，并受 §8 注册表、白名单、代次与租约约束。
  - **purpose 绑定的复核委托**（第三类，2026-10-01 平移计划评审补充）：针对某个人员的只读复核（如通知详情可见性 `/v1/<domain>/notification-details/authorize`），沿用现有签名委托且 `purpose` 固定、actor 取自已验证的上游入站命令；能力 `<domain>:notification-detail:authorize`，只返回 allow/deny、白名单路径、必须带 purpose 委托。它不是用户动作（用户路由拒绝任何非空 purpose），也不并入系统通道（系统通道不得携带任何委托）。
  - 每次申请令牌只请求本通道所需的 scope，不把不同通道的 scope 合并到同一令牌。
- 根 `CLAUDE.md` 中“其它独立服务或调度通道仍可按自身合同保留既有服务资源”“scheduler/worker……继续使用自身精确 capability 与 grant”一句，改写为“每域一项调度能力，加上任务注册表白名单，即为该通道的精确 capability”，与“不再为每个操作新增 grant”一致。
- `aims.runtime`、`codocs.runtime` 在其全部调用方迁入后撤销；`workflow.runtime` 在 Workflow Node 并入前保留。撤销按 §3.2 原则与实施设计 §9 的逐条门执行：先证明零调用，再撤，撤后用真实客户端做反例探测并观察 24 小时；每批取得用户批准。
- **残余风险（用户 2026-10-01 定稿时接受，进入 §7 验收记录）：** 浏览器可达的 Enterprise BFF 持有的服务凭据，从原来的 5 个域的用户通道扩大为再加上全部系统任务通道。缓解：系统通道只能执行注册表白名单动作、不能带用户委托、所有系统任务有审计；Enterprise 进程的凭据保护（受保护配置、无日志输出）按原规则执行。

### 9.4 防护（替代服务令牌承担的约束）

- **typed 公共入口：** 每个逻辑模块对其他模块只暴露一个 typed 公共入口（服务端模块的 `index` 导出），不得以 map/body 传入 trusted、verified、internal 等标志；转交给另一模块的用户请求必须携带已验证的用户身份，由 owning 模块按自身规则判权。
- **执行机制：** TypeScript 没有 Go 的 internal 包隔离。用 ESLint `no-restricted-imports` 禁止跨模块深层导入，并配 AST 边界测试（参照 B3 的结构扫描）；Go 侧沿用 internal 包与结构扫描。
- **不开宽入口：** Enterprise → Runtime 仍按域、按动作、按通道分路由；Runtime 仍校验来源部署、tenant、代次与对象范围。Enterprise 仍不持有数据库凭据。
- **审计与可区分标记：** 进程内调用产生的审计行与 receipt 行带固定、可区分的来源标记（B3 lane 回执用 `*.lane` 标识的教训），不得与真实服务调用的行形状相同。
- **幂等分层：** 进程内、同一事务内的 typed 调用不另造幂等键；离开进程的效果（调 Runtime、外部系统、Workflow）仍必须带稳定业务键派生的 Idempotency-Key。
- **错误语义：** 进程内领域错误直接按 owning 模块的状态码返回（401/403/404/409 等），不包装成 502。

### 9.5 首个落地：`hzy-aims` 剩余入口平移进 Enterprise

生产 `hzy-aims` 以 scheduler-only 模式运行，下列入站在生产当前返回 404（2026-10-01 在新机回环探测核实）：Enterprise 项目文档 6 个 Service API、Workflow 回调（工作项完成、项目立项/里程碑完成通用回调）、通知详情授权 2 个、Assets 读取产品版本、Altoc 工单接收；另有 Gateway drain 唤醒。平移后恢复：

- 这些入口作为 Aims 逻辑模块的服务端代码组合进 Enterprise 构建。Host 调项目文档改为进程内调用，原 Aims Service API 删除或固定返回 410（§9.6）。
- 仍需跨进程的调用（Runtime、独立 Codocs、Workflow）按 §9.2 第 2 条，用 `enterprise.runtime` 的相应通道。
- **Workflow 回调：**
  - 通用回调（项目立项、里程碑完成，长期存在）与工作项完成回调（B3 lane 启用后不再离开 Runtime，只剩存量与过渡）分开处理。
  - 回调目标改为 Enterprise，能力命名为 `enterprise:workflow-callback:execute`（受众 `enterprise`），需新增一条 `workflow.runtime` 的 grant。
  - Enterprise 不持有数据库，只是一跳传输：先按原规则完整验签（JWKS、iss、`aud=enterprise`、`token_use=service`、`source_app=workflow`、`target_app`、tenant、deployment、有效期与撤销状态、精确 capability），再按回调类型分派给 owning 模块的 typed 入口，最后用 `enterprise.runtime` 的系统通道转投 Runtime，由 Runtime 落幂等 receipt。**不得转发 Workflow 的入站令牌，不得在 Enterprise 改业务状态。** 这是 confused-deputy 条款允许的唯一形态。
  - Runtime 现有回调合同写死了 `ServiceClientID=aims.runtime`、`source_app=aims`。须逐路由改为接受 `enterprise.runtime`，并补错来源 403 测试；不得放宽为任意 client。在 `hzy-aims` 停机前，设一个同时接受 `aims.runtime` 与 `enterprise.runtime` 的过渡窗口，停机后收回。
  - 切换顺序：先让 Enterprise 回调目标可用并验证，再把 Workflow 的回调目标从 aims 切到 enterprise；写明回退方式（目标切回 aims）。
- Gateway drain 唤醒与 Platform W10 worker 改指 Enterprise 与 `enterprise.runtime`，签名唤醒凭证按 §9.2 保留。
- 完成并验收后停 `hzy-aims`，`aims.runtime` 的 grant 按 §9.3 逐条撤销。原实施设计 B4 中“Aims 后台全部迁入 Runtime”“W10 runtime_inprocess 双模式”不再需要；里程碑滚转已在 Runtime 进程内（D1），保持不变。
- 预告：Workflow Node 将来并入后，回调与审批代理也转为进程内调用，`enterprise:workflow-callback:execute` 随之退役。

### 9.6 规则文本修订（随 §9.5 首批代码合入）

根 `CLAUDE.md`“内部服务认证与授权”一节开头增加：

> 本节约束跨进程与跨系统的服务调用。同一信任单元（同一操作系统进程或同一 Worker 脚本、同一租户）内的逻辑模块之间（自托管 `hzy-enterprise` 进程内各业务模块；`hzy-data-runtime` 进程内各业务域；托管云合并后的单个 Enterprise Worker 内）按 [ADR-018a](./docs/ADR-018a-Fold-Aims-Codocs-Into-Enterprise.md) D11 直接调用 owning 模块的 typed 公共入口，不签服务令牌、不登记 service grant；人员授权、owning 模块的对象范围复核与职责冲突检查不得因同进程而跳过。跨进程、跨 Worker 的调用（包括托管云合并前仍分开的业务 Worker 之间）适用本节全部条款。Enterprise 进程对外只使用 `enterprise.runtime` 一个服务身份，用户通道（`<domain>:enterprise-host:execute` + 签名用户委托）、系统通道（每域一项调度能力 + 任务注册表白名单，不带任何委托）与 purpose 绑定的只读复核委托（`<domain>:notification-detail:authorize`）分开申请与校验。被进程内调用替代的 Service API 路由必须删除或固定返回 410，不得保留放宽鉴权的端点；仍对外暴露的 `/api/v1/service/**` 入站与所有跨进程出站继续适用本节原有条文（Foundation helper、不手工拼装认证 Header、Idempotency-Key、401/403 映射、grant seed/verify 与签发探测）；`source_app` 语义不变，目标端写死来源的合同逐条修改并补测试。

同时把“scheduler/worker……继续使用自身精确 capability 与 grant”一句按 §9.3 改写。`docs/MODULE_CONTRACTS.md` 相应合同在迁移时改写为“已由进程内调用替代”，保留历史说明与退役日期（同 §2.4）。
