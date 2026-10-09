# Host 部门文档实时协作：准入合同与实施计划

日期：2026-09-29。状态：**阶段 1 设计稿，待用户审批第 3、4 节所列事项；未改代码、未部署、未改 DB / grant / 环境。**
依据：用户决定（2026-09-29，见[选项文档](./Codocs-Host-Department-Collaboration-Options.md)末节）——部门文档正文编辑选 B（实时协作）；共享个人文档协作上线启用。
相关：[写入协调合同](./Codocs-Document-Write-Coordination.md)（v2 快照 / 阶段 B）、[部门迁入合同](./Codocs-Host-Department-Company-Migration.md) §5（关系 R）、[MODULE_CONTRACTS](./MODULE_CONTRACTS.md)「Enterprise Host → Codocs v2 协作会话」。

证据标记：**[核实]** = 已读源码（`文件`）；**[设计]** = 本文提出、尚未实现；**[待批]** = 需用户批准。

## 0. 结论摘要

1. **数据模型已基本可用，授权层不能复用。** 快照头、候选、会话、票据、参与者四类表都以文档 UUID 为键、不含文档类型，部门文档可以直接落行；但 `lockSnapshotDocument` 硬编码 `doc_type='private'` 与 owner/share 写检查（`data-runtime/internal/apps/codocs/document_snapshot.go:106-131`），且会话写入以**会话发起人**的写权限为准（`collaboration_session.go:172-186`）。部门授权取决于 Directory 中随时会变的关系 R，**不会像分享变更那样在 Codocs 事务内推进 epoch**，所以部门版必须在准入、续租、发布三个点重验 R，并对**每位参与者**分别判断，不能沿用“发起人代表整个会话”。
2. **不新增服务 capability，也不新增 grant。** Host→Runtime 复用 `codocs:enterprise-host:execute`；Collab→Runtime 复用 `collab.runtime` 的 `codocs:collaboration-snapshots:read/publish`（按会话绑定文档，不按文档类型授权）。新增内容是 Runtime API 合同里的固定操作、permit 资源动作、schema 列、以及部署/环境事项（第 3、4 节逐项列出，均待批）。
3. **只有可写者获得会话。** R∈{leader, member, manager} 且满足本文正文文档状态限制才签写票据（不要求 owner 或写分享）。parent / 无写权限者**不开会话**，通过 HTTP 读取最新已发布正文（首版；只读实时旁观列为可选增量，见 Q2）。
4. **撤权语义分两类。** 文档状态变化（只读、回收、移交、分享变更、部门变更）在 Codocs 事务内同步推进 epoch 并撤销会话——与现有个人路径一致；Directory 关系变化（移出部门、经理变更）无法同步推送，改为 Collab 每 ≤30 秒续租、Runtime 在续租中重验每位参与者，**最大暴露窗口 = 续租周期 + 网络往返，租期缩短到 90 秒兜底**。
5. **v1→v2 转换在“点击编辑”时发生，不在打开阅读时发生。** 阅读不产生写副作用；首次点击“协作编辑”时由 Host 以 CAS（期望 generation=0）把 v1 正文发布为 generation 1，随后开会话。
6. **共享个人文档协作代码已具备**，上线还差环境（独立 Collab 进程、`collab.runtime` 生产注册与 grant 核验、Runtime 双开关与 schema 安装、WS 路由/nginx）与双人验收；这些环境项与部门协作**共用**，应先做（第 5、7 节）。

## 1. 现状：个人共享文档 v2 协作链路

### 1.1 端到端流程 [核实]

| 步骤 | 组件与文件 | 行为 |
| --- | --- | --- |
| 页面门槛 | `codocs/app/pages/documents/[uuid].vue:24,514-529,1590-1608` | 仅 `hosted && codocsCollaborationV2`；`shouldLoadFromCollaboration` 要求 `doc_type==='private'` 且**已核验有共享成员**（未共享私人文档走 HTTP，避免无意开会话）；`isEditingDisabled` 要求已连接、已同步、`scope==='read-write'` |
| 领票 | `POST /codocs/api/documents/{uuid}/collaboration` → `enterprise/server/utils/enterpriseCodocsCollaboration.ts:47-72` | 双开关 `HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2` + `..._COLLABORATION_V2`；无请求体；`requireEnterpriseUser` → Console 权限快照要求 `documents:edit` → permit（`personal-documents` / `edit`）→ Foundation `codocs.personal-document-collaboration-open` |
| 会话+票据 | `data-runtime/internal/server/enterprise_codocs_document_snapshots.go:38-44,174`；`apps/codocs/collaboration_session.go:OpenCollaborationSession` | 文档行锁 → 头行锁；`generation<1` 返回 409 `document_not_on_snapshot_v2`（D5）；同 epoch 复用活动会话，否则新建（租期 5 分钟）；同事务签 256 位随机票据，只存 SHA-256，60 秒，单次 |
| 连接 | `collab/src/extensions/authentication.ts`；`collab/src/utils/v2-snapshots.ts:admit` | 浏览器经 `/codocs/ws` 带 `v2.<票据>`；Collab 以 `collab.runtime` 身份调用 `:admit` 兑换，核对文档一致，兑换成功前不加载；写入参与者记录；`readOnly = access!=='write'` |
| 加载 | `v2-snapshots.ts:load` | `:read` 取已发布头 → `:download` 精确版本字节，核对长度与 SHA-256；有 Yjs 载入，否则由 Markdown 建**新** CRDT 历史 |
| 保存 | `v2-snapshots.ts:store` | 同一 Y.Doc 生成 Markdown+Yjs → `:prepare`（确定性幂等键）→ `:upload`×2（写一次，随机 attempt 目录，Runtime 持 OSS 凭据，Collab 不持）→ `:publish`（配对，期望 generation/epoch）→ Runtime 事务内记参与者集合与历史行 |
| 租约 | `v2-snapshots.ts:startLease` | 间隔 ≤60 秒（默认 45 秒）`:renew`；401/403/404/409 立即关房，暂时性故障只在最后确认的 `expiresAt` 前重试 |
| 互斥 | `collaboration_session.go:refuseActiveCollaboration`；`document_snapshot_guard.go` | 会话活动期间 Host v1/v2 保存 409 `document_collaboration_active`；generation>0 后 v1 写入口 409 `document_on_snapshot_v2` |
| 撤销 | `document_shares.go:188,219`；`personal_document_project_transfer.go:90` | 分享变更/项目移交在同事务调 `invalidateCollaboration`：epoch+1、会话置 `revoked`，迟到发布被拒 |

### 1.2 其中哪些是个人文档专属 [核实]

| 个人专属点 | 位置 | 部门版处理 |
| --- | --- | --- |
| 文档必须 `doc_type='private'` | `document_snapshot.go:119` | 需要按文档类型的授权策略，见 2.1 |
| 写权限 = owner 或 `document_shares.permission='write'`，检查对象是**会话发起人** | `document_snapshot.go:120-131`、`collaboration_session.go:requireCollaborationSession/ResolveCollaborationSession` | 部门用“每位参与者的 R + 编辑规则”，见 2.4 |
| Host 权限 `documents:edit`；permit 资源 `personal-documents` | `enterpriseCodocsCollaboration.ts` | 部门用 `departments:edit` 与 `department-documents` |
| 撤权靠分享变更时同步推 epoch | `document_shares.go` | Directory 关系变化不在 Codocs 事务内，部门必须主动重验 |
| 页面仅对“有共享成员的私人文档”启用 | `[uuid].vue:529` | 部门文档以“点击协作编辑”启用 |
| 生成/头行创建仅由 Host 私人保存流程触发（首次保存建头） | `enterpriseCodocsSnapshot.ts`（仅 private） | 部门需要转换入口，见 1.3 |

会话、票据、参与者、发布记录表本身**与类型无关**：`codocs/docs/migrations/20260924_document_collaboration_sessions.sql`、`20260920_document_snapshots.sql` 中均无 `doc_type` 列。

### 1.3 部门文档是否已有 v2 数据、如何转换 [核实]

- **没有。** Host v2 保存/读取仅对 `private` 文档开启（`enterpriseCodocsSnapshot.ts`），部门文档不发 token、不建头。所有存量部门文档（生产 193 篇有效）为 v1：正文在 `documents.oss_path` 的 Markdown，旧独立 Collab 可能另有同目录 `.yjs`。
- generation / epoch：头行 `document_snapshot_heads(generation, collaboration_epoch)`，无头行或 generation=0 即 v1。`document_snapshot_guard.go` 按 UUID 判 v2，对类型无假设：**部门文档一旦有 generation>0 的头，旧 Codocs PUT、Host v1 保存、旧 Collab 版本创建都会 409**（这也是互斥的基础，同时意味着转换后旧独立 Codocs 协作编辑该文档会被拒）。
- 现有转换路径**只有“私人文档首次 HTTP 保存”这一条**（阶段 A：prepare → 上传候选 → publish，期望 generation=0）。D5 明确把 v1→v2 转换列为“阶段 C”，**没有部门版**。
- 部门→其他 / 其他→部门的类型变化：个人→部门移交“接收”会把 `doc_type` 改成 `department`（迁入合同 §5.6）；若源文档已是 v2（有头），转换后**头行仍在**。项目移交显式删除头行（退出 v2），部门接收没有对应处理——**须在本设计中补齐**（接收事务内 `invalidateCollaboration`，并令旧会话失效；见 2.5 与测试 T-M6）。

**部门 v1→v2 转换设计 [设计]：**

1. 触发：用户点击“协作编辑”（不是打开页面）；Host 取到 `generation=0`。
2. Host 读取当前权威正文（部门正文读取，已有“空内容时尝试 Yjs 恢复”逻辑）并计算 SHA-256；以 `department-documents:snapshot-prepare` → 请求级 OSS 客户端写候选（写一次、随机 attempt）→ `department-documents:snapshot-publish`（期望 generation=0、epoch=0）→ 发布 generation 1（仅 Markdown，无 Yjs）。三步都走与 `collaboration-open` 同款的 R 重验，见 2.3。
3. 幂等键由 `(文档 UUID, 期望 generation=0, 正文 SHA-256)` 稳定派生；两名成员同时点击时 CAS 仅一人成功，另一人收到 409 `snapshot_generation_conflict` 后**重读头**（已是 generation 1）继续开会话，不重复转换。
4. 转换前后旧 `.yjs` 均不读取；会话首次加载由发布的 Markdown 建立新 CRDT 历史（与个人路径一致）。
5. 派生镜像：转换与后续协作发布后，`oss_path` 的 Markdown 为**非权威派生副本**，由 Host 读取修复（阶段 A 第 5 点）。Collab 发布本身**不触发镜像**，因此所有直接读 `oss_path` 的部门文档消费者（下载、发文/发布执行、部门柜转换、周报汇总、旧 Codocs 预览等）在会话后可能读到旧内容。**实施前必须做消费者盘点**（批次 H1 交付物），至少让 Host 部门正文读取、下载、发布执行走精确版本读取。
6. 风险：转换与旧独立 Codocs 的 v1 编辑竞争（旧 PUT 无行锁）只会改派生副本，权威内容以 head 为准（同阶段 A 结论）；转换前**正在旧协作房间内的用户**可能有未落盘的更改，转换点之后其保存会被 409。上线前须确认旧独立 Codocs 对部门文档的编辑入口已退出或用户接受。

## 2. 部门协作准入合同

### 2.1 谁可以打开可写会话

2026-10-07 用户裁定：部门正文协作按当前直接负责人/成员/经理默认可写，不再要求owner或写分享。标题/移动/回收等管理操作仍沿原规则。

```
可写 = R ∈ {leader, member, manager}                       # Directory 现算，CanWrite()
   ∧ doc_type='department' ∧ dept_code = 路由 dept ∧ project_code=''
   ∧ status = 1（未回收、未删除） ∧ readonly_flag = 0
   # 不要求 owner 或写分享；分享不替代当前部门关系
```

- **本部门 leader：可写会话**；parent / none 不可写。leader 优先级不变，即使同时是 manager，CanManage 仍为 false；不扩大管理权限。
- **当前成员**（R=member）：默认可协作编辑他人文档，包含无分享或仅只读分享。
- **owner 已离开部门**：R 不再是 leader/member/manager，无会话（与 D4 一致）。
- **manager 编辑他人部门文档**：允许（与 `edit-metadata` 的“经理可管理本部门任何文档”一致）。
- **只读文档**：manager 也不能开写会话，须先取消只读（与 `edit-metadata` 拒绝一致）。
- **只读实时旁观**：首版不做。`document_collaboration_tickets.access` 已有 `read`，Collab 端 `readOnly` 已支持，增量成本小；是否上线由 Q2 决定。读者通过 `department-documents:view` 读取最新发布版本（需 H1 使部门正文读取按精确快照版本返回，并给出 generation 供“可能已过期”提示）。

### 2.2 Host 人员权限

- 开会话（含转换）要求 `codocs:departments:edit`（Host 读取 Console 权限快照，`authorizationResourcesAllow`，依赖不可用返回 503 而非 403）。该权限与部门文档 `edit-metadata` 相同，普通成员基线含 `departments:edit`（范围 `relation=member_department`，迁入合同 §5.2）。**不使用 `documents:edit`**（避免拼接不同授权单元的权限与范围，原理同迁入合同 §5.2）。
- Host 结果只是快速拒绝，**Runtime 的 R 判定是最终门槛**；Host 不传关系、角色或对象类型，只传路由里的 `dept_code` 与文档 UUID，Runtime 校验文档自身的 `dept_code` 必须等于路由值，不符 403（不泄露文档是否存在于其他部门）。
- 只读查看者需要 `departments:view`，不领票。
- 不要求也不接受 body/query 里的 actor、role、`dept_code` 角色断言。

### 2.3 Runtime 操作与 R 重验位置

**新增固定操作（Runtime API 合同，均在 `codocs` 域 `/v1/enterprise/codocs/`，待批 A-3）：**

| 操作 | 方法 / permit | 用途 |
| --- | --- | --- |
| `department-documents:collaboration-open` | POST / `department-documents` + `edit`；路由 `code`=dept_code、`sub`=文档 UUID；空请求体 | 开/续会话并签票据（要求已 v2） |
| `department-documents:snapshot-read` | GET / `department-documents` + `read` | 读发布头（generation/epoch、精确对象版本），供转换与部门正文读取 |
| `department-documents:snapshot-prepare` / `snapshot-publish` | POST / `department-documents` + `edit`，需 `Idempotency-Key` | **仅用于 v1→v2 转换**（首次发布 generation 0→1）；`publish` 拒绝 generation≥1 的 Host 写入——部门正文变更只经 Collab，无 HTTP 保存 |

Foundation 操作表新增 `codocs.department-documents-collaboration-open|snapshot-read|snapshot-prepare|snapshot-publish`，服务 capability 由路由域推导为 `codocs:enterprise-host:execute`，不增 grant。

**R 重验点（与票据签发同一时点）：** 沿用已合入模式（`server/enterprise_codocs_department_lock.go`、`apps/directory/enterprise_codocs_department_access.go`，提交 `5fd9a5a2`）：

1. Runtime 认证 Enterprise 凭据、签名 actor、permit（`validateEnterpriseDelegatedPermit`）。
2. `lockEnterpriseCodocsDepartment(actor, dept)`：Directory 库只读事务，`FOR SHARE` 锁部门行、父部门行、用户行、成员行，**保持打开**。
3. 开 Codocs 库事务（Serializable 与现有部门写一致）：文档行 `FOR UPDATE`（校验类型/部门/状态/只读）→ 头行锁 → Directory当前member/manager判定 → 会话与票据写入 → 提交。
4. 提交后才释放 Directory 锁。Directory 与 Codocs 位于**不同库/schema**，Codocs 事务内不查询 `directory_*`。
5. 加锁顺序固定为 Directory → Codocs 文档 → 头 → 候选，避免与 `edit-metadata` / `readonly` / `recycle` 互相死锁。

### 2.4 Collab 侧重验（兑换、续租、发布）

会话表加策略列后，Collab 的每个服务调用仍只带 `sessionId`，**Runtime 从会话反查文档与部门，不接受 Collab 传 dept 或 actor**。

| 调用 | 重验内容 | 失败结果 |
| --- | --- | --- |
| `:admit`（兑换票据，绑定用户） | 会话活动且 epoch 一致（现有）；**新增**：Directory 锁下重算该用户 R 与编辑规则、文档状态 | 403 `collaboration_ticket_invalid` / 409；Collab 拒绝连接 |
| `:renew`（≤30 秒；请求体新增 `connectedUids`） | 会话 epoch；文档状态（回收/只读/部门/类型）；对**全部已连接参与者**在**一次批量 Directory 锁**下重算 R 与规则；把未上报的参与者标记 `left` | 文档级失败 409 → Collab 关整间房；参与者级失败 → 响应 `revokedUids`，Collab **只断开这些用户的连接**并把它们从参与者集合摘除 |
| `:publish` | 文档行锁下：会话 epoch、文档状态、`readonly`；批量 Directory 锁重算所有已连接参与者；任一参与者失权 → 拒绝本次发布并返回 `revokedUids`，Collab 断开后**在下一个保存周期**重试 | 409 `collaboration_participant_revoked` / `collaboration_session_invalid` |
| `:read` / `:download` / `:upload` / `:prepare` | 会话活动（现有）+ 文档仍为可写部门文档；不做 Directory 重验（无写入语义） | 409 |
| 断线 / 房间空 | Collab `:close` 会话（现有） | — |

要点：

- **不再以“会话发起人的权限”代表整个会话。** 候选记录的 `actor_uid` 仍写发起人仅作审计；授权来自“已连接参与者集合全部通过”。`collaboration_participants` 增列 `status`（`active/left/revoked`）与 `checked_at`（待批 A-4）。
- **暴露窗口**：Directory 关系变化到 Collab 断开 = 最长一个续租周期（默认 30 秒）+ 请求往返；此期间被撤权者仍可向 Y.Doc 写入，其中已进入文档的内容无法从 CRDT 中剔除，会在下一次成功发布中留存。这是 CRDT 的固有限制，需用户知悉（Q3）。发布不接受“未检出的失权者”的保证是：**发布在提交时刻重验，失权者不会被计入参与者集合，且其后续输入被断开**。
- **租期**：部门会话 `expiresAt = min(now + 90s)`，每次成功续租刷新（个人仍为 5 分钟）。Collab 失联 Runtime 时，房间最多再存活 90 秒。
- **空/迟到发布**：会话被撤销后到达的 `:publish` 因 `status<>'active'` 或 epoch 不符被拒（现有逻辑，`requireCollaborationSession`），Collab 关房；用户浏览器端的未保存内容留在本地 Y.Doc，页面提示“已失去编辑权限，内容未保存，请复制后刷新”。
- Collab 需要维护 `uid → 连接` 映射并支持定向断开（Hocuspocus 的 `connection.close`；实现前在锁定版本上确认 API，见批次 C1）。

### 2.5 与其他写路径的互斥

| 路径 | 与活动会话的关系 | 实现 |
| --- | --- | --- |
| 部门正文 HTTP 保存 | **不存在**。Host 不提供部门 HTTP 正文保存；转换后旧 Codocs PUT 与 Host v1 保存被 `document_on_snapshot_v2` 拒绝 | 现有 guard 已覆盖；补部门用例 |
| Host 转换发布（generation 0→1） | 会话尚未存在；有会话则 generation≥1，转换的 `publish` 拒绝 | `publish` 对 generation≥1 的 Host 调用返回 409 `document_collaboration_active` / 冲突 |
| `edit-metadata`（标题/移动目录） | **允许**，不影响正文，不推 epoch。文档行锁串行。标题不在协作状态中 | 补并发用例 |
| `readonly=true`（经理） | **撤销会话**：同事务 `invalidateCollaboration`（epoch+1、会话 `revoked`）；Collab 在下一次续租（≤30 秒）或发布时关房 | 改 `ManageEnterpriseDepartmentDocument` |
| `recycle`（经理） | 同上 | 同上 |
| `restore`（经理） | 无活动会话；epoch 已前进，新会话从当前头重开 | 无需改动，补断言 |
| 个人→部门移交接收 / 部门→其他移动 / 项目移交 | 同事务 `invalidateCollaboration`；**部门接收补上头与会话处理** | 改 `personal_document_department_transfer.go` |
| 文档分享增删改 | 现有：epoch+1 + 撤销会话；**须验证对 `doc_type='department'` 同样生效** | 补用例 |
| 部门经理变更 / 成员移出 / owner 离部门 | 无 Codocs 事务，靠 2.4 续租/发布重验 | 见 2.4 |

选择“撤销”而不是“被会话阻塞”的理由：经理执行只读/回收的意图就是冻结文档，被在线的一个浏览器标签无限阻塞不可接受；代价是在线用户的未发布片段（≤保存防抖窗口）丢失，页面须给出明确提示，并在经理的确认对话框里显示“正在协作：N 人”（Foundation `useConfirm`，`tone:'warning'`）。若用户更倾向“先阻塞、给强制选项”，见 Q1。

### 2.6 票据声明与 TTL

服务端记录（浏览器只拿到不透明的 `v2.<64 位十六进制>`，无 JWT，不含可解析声明）：

| 字段 | 值 |
| --- | --- |
| 标识 | `tenant_code`、`deployment_code`（codocs 部署）、`session_id`、绑定文档 UUID（经会话）、`user_uid`（已验证 actor） |
| 访问 | `access='write'`（首版仅写票据） |
| 部门上下文 | 经会话取 `dept_code`（不入票据） |
| 生命周期 | 60 秒有效；单次兑换；只存 SHA-256；兑换即写参与者 |
| 限制 | 同一 (会话, 用户) 的未兑换旧票据在新开时作废；每 (用户, 文档) 每分钟限 6 次开启 |

Collab 兑换响应（新增字段）：`deptCode`、`participantAccess`；Collab 不据此做授权，只用于日志与 UI。

### 2.7 幂等

- `collaboration-open`：会话按 (租户, 部署, 文档, epoch) 唯一，**天然幂等**（现有复用逻辑）；票据是一次性凭据，**故意不可重放**：同一请求重试会作废旧的未兑换票据并签新票据。这与“跨应用写操作须带幂等键”的规则不冲突，因为该操作的业务效果（会话）由稳定业务键决定，票据不属于业务写结果；列为需用户确认的规则解读（Q5）。
- 转换 `snapshot-prepare/publish`：`Idempotency-Key` = 稳定派生（文档 UUID + 期望 generation + 正文 SHA-256），异载荷同键 409，已发布回执重放不再访问存储（现有语义）。
- Collab 写入：沿用 `collab:<session>:<key>` 命名空间与确定性幂等键。

## 3. Capability / Grant / Schema 分析与待批清单

### 3.1 分析

| 通道 | 结论 |
| --- | --- |
| Host → Runtime | **复用** `codocs:enterprise-host:execute`（根 CLAUDE.md “Enterprise Host 用户委托例外”）。新增操作只需要操作表白名单、Runtime 路由与 permit 资源/动作；`department-documents` 资源与 `edit/read` 动作已存在于部门 permit 规格（`enterprise_codocs_department_access.go`）。**无新服务 capability，无新 Console grant。** |
| Collab → Runtime | **复用** `collab.runtime` 的 `codocs:collaboration-snapshots:read/publish`。这两项按会话授权，`ResolveCollaborationSession` 从会话得到文档，能力本身不区分文档类型；部门对象由会话上的策略列约束。**不需要新 capability**。新增/变更的是同一路由集合上的请求/响应字段（`renew` 的 `connectedUids`、`revokedUids`）。 |
| 人员权限 | 复用 manifest `departments:edit`，不新增资源/动作。`collaboration-snapshots` 资源的描述（“发起人写权限”）与部门版不一致，**建议改描述**，属 manifest 变更。 |

### 3.2 待用户批准的事项（不预设、不自行添加）

| 编号 | 事项 | 类别 | 说明 |
| --- | --- | --- | --- |
| **A-1** | 确认**不新增** capability / grant（复用上述两组） | 授权确认 | 若批准，无 Console grant 变更 |
| **A-2** | `codocs/app.manifest.json` 中 `collaboration-snapshots` 资源描述改为覆盖个人与部门会话，并重新生成 Host 组合 manifest | manifest 变更 | 仅描述，动作不变 |
| **A-3** | 新增 Runtime 固定操作 `department-documents:{collaboration-open, snapshot-read, snapshot-prepare, snapshot-publish}` 及 permit（`department-documents` + `edit`/`read`） | Runtime API 合同 | 不改 manifest 资源；需更新 `MODULE_CONTRACTS.md`，Foundation 操作表 |
| **A-4** | Schema：`document_collaboration_sessions` 增 `policy ENUM('private','department')`、`dept_code`；`document_collaboration_participants` 增 `status`、`checked_at`；新增迁移文件并同步 `codocs/docs/*_schema.sql`。**目标库安装为 DDL，不可事务回滚** | schema | 新库/生产须在环境批准后安装（见第 4 节），且生产尚未安装任何快照/协作表 |
| **A-5** | Collab→Runtime 协议变更：`renew` 请求体 `connectedUids`，`renew/publish` 响应/错误 `revokedUids`；部门会话租期 90 秒 | Runtime API 合同 | 同 capability，不改 grant |
| **A-6** | 授权语义：部门会话由“每位已连接参与者的 R 重验”决定；parent/无写权限者不开会话；经理只读/回收撤销活动会话 | 授权语义 | Q1/Q2/Q3 需用户确认 |
| **A-7** | `enterprise_department_document_manage` / `personal_document_department_transfer` 等事务内新增 `invalidateCollaboration` 调用 | 代码变更 | 影响现有部门写路径，需回归 |

`collab.runtime` 在生产环境的**注册与 grant 核验**属于环境动作，见 4.1，不在本表重复。

## 4. 环境工作（hzy0 与自托管生产）

所有条目均为**审批点**（每项写入需逐项批准；本文不执行）。

### 4.1 独立 Collab 进程、身份、凭据、`collab.runtime`

| 项 | hzy0（本机测试） | 自托管生产（wiztek，Anolis） |
| --- | --- | --- |
| 进程 | 已有脚手架：`deploy/test-env/local-enterprise/run-process.mjs:startCollab`，PM2 `hzy0-collab`（`pm2.config.cjs`），`127.0.0.1:23131`；需 `features.codocsCollaborationV2=true` | **无**：`deploy/self-hosted/systemd/` 没有 collab unit，`deploy/self-hosted/build.mjs` / `release*.mjs` 是否打包 `collab` 待核对。需新增 `hzy-collab.service` 模板、打包并纳入 `verify.mjs`/`health.mjs` [待批 E-1] |
| 身份 | 客户端 `collab.runtime`，部署 `C000001-test-collab` | 生产租户的 `collab.runtime` 客户端与部署编码需在 Platform 登记；`deploymentBindings.collab` 写入生产 Runtime 配置 [待批 E-2] |
| 凭据 | `collab-client-secret.json`（0600，仅 `COLLAB_SERVICE_CLIENT_SECRET`），`collab-credentials.mjs` | 新增 root 0600 的 `/etc/hzy/collab.env`（模板 `deploy/self-hosted/env/collab.env.example`，待创建）；Console 只存哈希，明文仅落该文件；Collab 不持有 OSS 或数据库凭据 [待批 E-3] |
| `collab.runtime` 注册与 grant | `deploy/test-env/collab-registration.mjs`（**写死 C000001 与 hzy0 Console 库名**；hzy0 已 apply/verify 过一次，见写入协调合同阶段 B 进展 8） | 需要生产版注册脚本（新文件，参数化租户/部署/库，不复用 hzy0 固定值），只授 `read/publish` 两项，audience `data-runtime`；`--verify` 只读、`--apply` 显式事务、不复活撤销记录 [待批 E-4] |
| 令牌签发探测 | 已做（2026-09-24） | 用实际 `collab.runtime` 客户端对两项 scope 各做一次签发探测并解码校验 `token_use=service`、`source_app=collab`、tenant、deployment、audience、单项 scope；可扩展 `deploy/self-hosted/probe-prod-service-tokens.mjs` 与其 config 示例 [待批 E-5]。按根 CLAUDE.md，SQL 行存在或宽 scope 可签发不算核验完成 |
| 令牌 URL | `COLLAB_CONSOLE_TOKEN_URL=http://127.0.0.1:<gateway>/__hzy0/collab-token`（本机桥） | 生产直接使用本站 Console：`COLLAB_CONSOLE_TOKEN_URL=https://aidcp.wiztek.cn/console/oauth/token`（网关 README：生产 Collab 用自己的凭据向本站 Console 换取服务令牌）；须核对网关对该路径是否需要来源限制，以及 Console 是否接受 `collab.runtime` |
| 双 audience | 现设计仅 `data-runtime` | 核对 Collab 不需要 `tenant-runtime` audience；若 Runtime 实际验签要求双 audience，按根 CLAUDE.md 补 grant [待批，若需要] |

### 4.2 功能开关

| 层 | 键 | 当前 | 目标 |
| --- | --- | --- | --- |
| Runtime | `apps.codocs.snapshotV2Enabled`、`apps.codocs.collaborationV2Enabled`（`data-runtime/internal/config/config.go:161-167`）、`deploymentBindings.collab` | 默认 false / 缺失 | 两个 true + 绑定；`deploy/self-hosted/env/runtime.env.example` 与生产 Runtime 配置需核对承载方式 [待批 E-6] |
| Host | `HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2`（模板已 `true`）、`HZY_ENTERPRISE_CODOCS_COLLABORATION_V2`（模板 `false`）→ `deploy/self-hosted/env/enterprise.env.example:31-32`；页面 public 配置 `codocsCollaborationV2` | 协作关 | 协作 `true` [待批 E-7]。**需要独立的部门子开关**（建议 `HZY_ENTERPRISE_CODOCS_DEPARTMENT_COLLABORATION_V2`，Runtime 侧 `apps.codocs.departmentCollaborationV2Enabled`），使个人协作可先上线、部门协作单独灰度 [待批 E-8] |
| Collab | `COLLAB_V2_ENABLED`、`COLLAB_RUNTIME_MODE=standalone`、`COLLAB_PROVIDER=hocuspocus`、`COLLAB_REDIS_DISABLED`、`COLLAB_PORT`、`COLLAB_ADDRESS`、`COLLAB_PUBLIC_BASE_PATH=/codocs/`、`COLLAB_SERVICE_CLIENT_ID`、`COLLAB_SERVICE_CLIENT_SECRET`、`COLLAB_CONSOLE_TOKEN_URL`、`COLLAB_CODOCS_RUNTIME_URL`、`COLLAB_V2_RENEW_INTERVAL_MS`（部门取 30000） | 关 | 见 `collab/src/config.ts:150-156`、`run-process.mjs:81-101` |
| Console | `CONSOLE_COLLAB_MODE=disabled`（`console.env.example:27`） | 保持 disabled——使用**独立**进程而非内嵌，避免 Console 身份与 `collab.runtime` 混淆 | 不变 |
| hzy0 profile | `features.codocsSnapshotV2`、`features.codocsCollaborationV2`；`listeners.collab`；`config.mjs:55-62,169-171` | 协作 false | 个人协作验收时开；部门另加 profile 键并在 `config.mjs` 校验 [待批 E-9] |

### 4.3 Gateway `/codocs/ws` 与 nginx

- **自托管 Gateway 已支持** WS 透传：`deploy/self-hosted/gateway/http-bridge.mjs:createUpgradeHandler`，仅 `/codocs/ws`、`/collab/*`，校验 `Host`/`Origin`，不转发 Cookie/Authorization/网关 Token。配置：`gateway.json` 的 `apps.collab.origin=http://127.0.0.1:3021`（示例已含）、`limits.maxWebSockets`（512）、`limits.webSocketIdleTimeoutMs`（默认 300000）。需 [待批 E-10]：生产 `gateway.json` 增加 `apps.collab`（回环地址须与 `hzy-collab.service` 一致）。
- **公网 nginx**（gitlab.wiztek.cn，仓库中无 `aidcp.wiztek.cn` 的 nginx 配置，`platform-ingress/nginx.conf.example` 仅是 Platform 的内网段）：需在 `aidcp.wiztek.cn` 的 server 块为 `/codocs/ws` 增加 `proxy_http_version 1.1`、`Upgrade`/`Connection` 头、`proxy_read_timeout`/`proxy_send_timeout` ≥ 网关空闲超时（建议 ≥3600s 或与 Hocuspocus 心跳配合，默认 60s 会在无消息时断线）、不缓冲；内网段 nginx（若有）同理。走 Tailscale 的上游为网关 ingress（100.64.72.59）[待批 E-11，需出示具体配置；改前备份、`nginx -t`、reload，不动其他站点]。
- **hzy0**：本机 Gateway `deploy/test-env/local-enterprise/gateway-transport.mjs:348` 已仅在协作开关开启时放行 `/codocs/ws`；`Caddyfile.local` 无需改动，须核对。

### 4.4 迁移与回滚

- 生产 Codocs 库尚无快照/协作表：迁移 `20260920_document_snapshots.sql`、`20260924_document_collaboration_sessions.sql` 与本设计新增迁移，均含 DDL，不能靠事务回滚；安装前全库备份并核对 MySQL `server_uuid`，失败时保持所有协作开关关闭 [待批 E-12]。
- 专用**快照桶**：写入协调合同要求生产使用从未开启版本控制的专用桶，且“版本 ID 与写一次条件是否可同时成立”**未获实测**（合同末段）。这是协作（含个人）上线的**硬前置**，不属于本设计新增，但会阻塞两者 [待批/待验 E-13]。
- 回滚：关闭 Host/Runtime/Collab 开关；已发布的 generation>0 文档保持 v2（旧 v1 写入口继续被拒），需保证 Host 读取仍走精确快照，不回退到旧覆盖写。

## 5. 共享个人文档协作：上线还需要什么

代码已具备（写入协调合同阶段 B）：Runtime 会话/票据/参与者/发布、Collab v2 加载保存与租约、Host 领票与页面接线、Runtime 字节路由。**缺的都是环境、验证与授权核验：**

| 类别 | 需要 | 状态 |
| --- | --- | --- |
| 环境 | 独立 Collab 进程（systemd 单元、env 模板、打包、健康检查） | 生产无；hzy0 有脚手架 |
| 环境 | 生产 `collab.runtime` 注册、`deploymentBindings.collab`、凭据文件、grant `--verify`、令牌签发探测 | 未做（hzy0 已做且当前 profile 关闭） |
| 环境 | Runtime 双开关、schema 安装（快照两表+`document_versions.object_key`+协作四表）、Host 协作开关、页面 public 配置 | 生产均关 / 未安装 |
| 环境 | `/codocs/ws` 网关配置 + nginx Upgrade/超时 | 网关代码就绪，配置与 nginx 未做 |
| 存储 | 专用快照桶 + “版本 ID 与写一次条件”实测（Collab 存储改线 2026-09-24 的剩余风险） | 未证明，阻塞发布 |
| 云端 | 云端 Collab Durable Object 仍只接受旧 HMAC 准入 | 不影响自托管 |
| 验证 | 双人同时编辑、断线换票重连、撤权踢出、迟到发布拒绝、HTTP 保存 409、历史与镜像；无凭据/正文入日志 | 未做（hzy0 阶段 B 启用顺序第 5 步） |
| 缺口 | Host 共享文档只读回退路径、标题锁定、历史版本页对 v2 协作发布行的展示需在验收中确认；派生镜像修复的消费者盘点 | 待验 |
| 文档 | MODULE_CONTRACTS 更新“上线”状态 | 随验收 |

## 6. 测试与验收矩阵

### 6.1 单元与合同测试（不依赖 MySQL）

| 编号 | 范围 | 用例 |
| --- | --- | --- |
| T-U1 | Go：R×规则矩阵 | leader / manager / member / parent / none × owner / 写分享 / 只读分享 / 无分享 × readonly / recycled / 错部门 / 错类型；leader+manager 同人 → 可写但不可管理 |
| T-U2 | Go：permit | 精确 `department-documents` + `edit`；缺失、错资源、过期、错 actor、含 body 均拒；操作仅在部门开关开启时登记 |
| T-U3 | Go：路由 | `collaboration-open` 严格空体、`dept_code` 与文档不符 403、非法 UUID 400、Directory 不可用 503（非 403） |
| T-U4 | Collab（vitest） | 兑换失败不加载；续租 `revokedUids` 仅断开对应连接；文档级 409 关整房；租期 90 秒过期即关；迟到响应忽略；发布 409 后重试 |
| T-U5 | Host | 开关关 404；缺 `departments:edit` 403；依赖失败 503；权限快照与 permit 精确；响应无票据以外字段；`no-store` |
| T-U6 | 契约 | 正确调用、缺 capability、错 audience（`collab.runtime` 打 tenant-runtime）、错来源应用、错 tenant/deployment、令牌过期、写请求幂等重放（根 CLAUDE.md 完整矩阵）；Foundation 断言 `x-hzy-app-code`/`x-hzy-deployment`/`x-forwarded-prefix` 三个目标上下文头 |

### 6.2 隔离 MySQL（Directory 与 Codocs **分属不同 schema/库**）

沿用 `data-runtime/scripts/test-codocs-snapshots-mysql.mjs` 与 `department_directory_cross_schema_mysql_test.go` 的做法：新建可丢弃 datadir/socket，两个 schema 分别装正式表定义，Runtime 用两条连接。

| 编号 | 用例 |
| --- | --- |
| T-M1 | 转换：两人并发点击，恰一个成功、另一个重读后开会话；同键重放不重传；异载荷同键 409；v1→v2 后旧 PUT / v1 保存 / v1 Collab 版本被拒 |
| T-M2 | 开会话：Directory 锁跨 Codocs 事务持有至提交；并发把成员移出（另一个 Directory 事务）——要么先移出使开会话失败，要么先开会话；不出现“移出后仍签票”；死锁/超时行为 |
| T-M3 | 续租：成员移出 / 经理变更 / owner 离部门 / 用户停用 → 该参与者出现在 `revokedUids`，其他参与者不受影响；全部失权 → 会话终止 |
| T-M4 | 发布：失权参与者存在时拒绝并返回 uid；重试成功且参与者集合不含失权者；会话撤销后迟到发布被拒；epoch 变化后被拒；重复发布同键重放 |
| T-M5 | 互斥：readonly / recycle 撤销活动会话并推 epoch，迟到发布与续租被拒；restore 后新会话可开；edit-metadata 并发不阻塞也不破坏会话；分享撤销对部门文档推 epoch |
| T-M6 | 类型变化：个人 v2 文档被移交接收为部门文档后旧会话作废、头行与 `oss_path` 状态一致；项目移交对照 |
| T-M7 | 租户/部署隔离：另一租户的会话/票据不可兑换；错 `deployment_code` 拒绝 |
| T-M8 | 票据：过期、重放、已作废（重开）、跨用户使用、跨会话使用、哈希存储无明文 |

### 6.3 浏览器端到端（hzy0，真实 Host → Gateway → Collab → Runtime）

需要两个部门成员账号（含一个 owner、一个无写分享成员）、一个经理、一个非成员/parent 账号，参照 C000001 负向授权测试账号的做法（管理员账号验不出越权）。

| 编号 | 场景 | 通过标准 |
| --- | --- | --- |
| E-1 | 两用户同时编辑同一部门文档 | 双方看到对方光标与更改；发布后 generation 递增；参与者集合含两人 |
| E-2 | 断线重连 | 断网/杀 WS 后自动换新票据重连；未发布内容不丢；票据不复用 |
| E-3 | 撤权（Directory）：管理员把成员 B 移出部门 | ≤1 个续租周期内 B 被断开且输入失效；A 不受影响；B 页面提示 |
| E-4 | 撤权（成员离部门 / 用户停用 / 经理失去部门关系） | 同上；分享变更关闭旧会话，但当前成员可重新准入 |
| E-5 | 经理设只读 / 回收 | 房间关闭；迟到发布被拒；恢复后可重开 |
| E-6 | 迟到发布 | 撤权后用旧会话手工调用 `:publish`（服务端夹具）被拒 |
| E-7 | 非授权者 | parent / 非成员点击编辑得到明确 403；只读成员看到最新已发布版本且无编辑入口 |
| E-8 | 版本历史 | 协作发布行进入历史，查看/对比按精确版本核对摘要；未发布候选不可见 |
| E-9 | 镜像与旧读取者 | 下载、发文、部门柜转换等消费者读到最新发布版本（或明确的“同步中”状态）；镜像失败不影响已提交结果 |
| E-10 | 转换 | 首次点击编辑后旧独立 Codocs 对该文档的写入 409，提示文案正确；阅读页打开不改变存储 |
| E-11 | 日志 | 无票据、令牌、正文进入 Host/Runtime/Collab/nginx 日志 |
| E-12 | 桌面 1440px 与移动 390px | 编辑器状态条（协作中/只读/已断开）、失权提示无溢出重叠 |

个人共享文档回归同样使用 E-1..E-4、E-8、E-11。

## 7. 实施批次、估时、文件归属与顺序

估时为工程与验证总工时（不含审批等待），基于选项文档 64–104 工时并按本设计细化；不是交付承诺。

| 批次 | 内容 | 主要文件归属（并行边界） | 估时 | 依赖 |
| --- | --- | --- | --- | --- |
| **P0 个人协作上线准备** | 生产 Collab 单元/env 模板/打包/健康检查；生产版注册脚本与 grant verify、令牌探测；网关 `apps.collab`；nginx 配置草案；schema 安装清单；快照桶实测方案。**先行**，部门批次共用 | `deploy/self-hosted/**`（新增 `systemd/hzy-collab.service`、`env/collab.env.example`，改 `build.mjs`/`release*.mjs`/`verify.mjs`/`health.mjs`、gateway 示例）；`deploy/test-env/collab-registration*.mjs`（生产版另起文件）；`docs/Go-Live-*.md` | 16–24 | 无 |
| **R1 Runtime 授权核心** | 快照/会话授权“策略”抽象（`private`/`department`）；部门 `collaboration-open` / `snapshot-read|prepare|publish`；会话与参与者新增列及迁移；`admit/renew/publish` 部门重验；批量 Directory 锁；readonly/recycle/移交/分享撤销挂钩；开关 | `data-runtime/internal/apps/codocs/{document_snapshot*.go,collaboration_session.go,enterprise_department_document_manage.go,personal_document_department_transfer.go}` 与新增 `enterprise_department_document_collaboration.go`；`internal/apps/directory/` 新增批量锁；`internal/server/{enterprise_codocs_department_access.go,codocs_collaboration_snapshots.go}` 与新增 department collaboration 路由文件；`internal/config`；`codocs/docs/migrations/2026093x_*.sql` 与 `codocs/docs/*_schema.sql` | 36–48 | 用户批准 A-3/A-4/A-5/A-6/A-7 |
| **C1 Collab 服务** | 连接映射与定向断开；`renew` 上报 `connectedUids`、处理 `revokedUids`；部门租期与间隔；文档级 409 关房；日志脱敏 | `collab/src/{utils/v2-snapshots.ts,extensions/authentication.ts,extensions/persistence.ts,providers/hocuspocus.ts}`、`collab/test/**`、`collab/CLAUDE.md` | 12–18 | R1 的协议定稿（可与 R1 并行按契约开发） |
| **H1 Host / Foundation / 页面** | 操作表；Host 部门 `collaboration-open` 与转换编排（`snapshot-prepare/publish` + 请求级 OSS 写候选）；部门正文读取按精确快照返回并给 generation；消费者盘点与改造（下载/发布执行/部门柜转换的精确读取或镜像）；`[uuid].vue` 部门文档“协作编辑”入口、状态条、失权提示；`useCollaboration.ts` 部门场景；路由分派按服务端读取的文档类型 | `foundation/server/utils/enterpriseRuntimeClient.ts`；`enterprise/server/utils/{enterpriseCodocsCollaboration.ts,enterpriseCodocsDepartmentDocuments.ts,enterpriseCodocsSnapshot.ts,enterpriseCodocsDocumentContent.ts,...}`、`enterprise/server/routes/codocs/api/documents/[uuid]/collaboration.post.ts`；`codocs/app/pages/documents/[uuid].vue`、`codocs/app/composables/useCollaboration.ts`；`codocs/layer/**` | 16–24 | R1 路由签名冻结 |
| **V1 验证** | 6.1 单元/合同、6.2 隔离 MySQL（跨 schema）、6.3 hzy0 双人端到端与负向账号；证据回写 `Codocs-Document-Write-Coordination.md` 与 `MODULE_CONTRACTS.md` | 各模块 `test/**`；`data-runtime/scripts/test-codocs-*-mysql.mjs`；`deploy/test-env/**`；文档 | 20–30 | R1/C1/H1 合入；hzy0 环境批准 |
| **E2 部门生产启用** | 生产按第 4 节执行（个人协作验收后再开部门子开关）；生产 Runtime 构建/部署、grant 核验证据、双人验收 | 环境与 `docs/Go-Live-*.md` | 8–12 | P0 与 V1 通过；逐项审批 |

合计约 **108–156 工时**（P0 16–24 与选项文档“身份及自托管路由/配置 12–20”对应，超出选项估算的部分主要来自：每位参与者续租重验与定向断开、消费者盘点、生产版注册与打包缺口）。

**P0 状态（2026-09-29，制品完成、未安装未启用）：** E-1（`hzy-collab.service`、`env/collab.env.example`、打包与 `health.mjs` 回环/101/426 探针）、E-4（`console/scripts/collab-prod-registration.mjs` 与 G-7 目录可选条目）、E-5（探测矩阵 2 正例 + 15 反例）、E-10/E-11 的配置示例与 nginx `/codocs/ws` 示例、schema 安装清单（数据迁移 runbook §3a）、快照桶实测脚本与方案均已交付，全部待环境批准与执行。P0 实施中发现并已在打包层缓解：Hocuspocus 3.4.4 忽略 `COLLAB_ADDRESS`、实际绑定通配地址（见 `collab/CLAUDE.md`）；Gateway 增加对无 `Upgrade` 的 `/codocs/ws` 直接 426（独立 Collab 的 HTTP 根返回 200 欢迎页，不是 426）。发现 Host 页面开关 `codocsCollaborationV2` 由构建期环境派生（`enterprise/nuxt.config.ts`），发布构建不设置，因此启用需运行期 `NUXT_PUBLIC_CODOCS_COLLABORATION_V2`（已写入模板）。

**并行方式：** P0 与 R1 互不共享文件，可立即并行；C1 依 R1 的协议表（本文 2.4）并行；H1 中“消费者盘点”可与 R1 同时启动，UI 与操作表接线在 R1 路由冻结后。R1 内部的 Directory 批量锁、会话/参与者迁移、路由三块可再分给两人。

**与上线顺序：**

1. P0 → hzy0 个人共享文档双人验收（E-1..E-4、E-8、E-11）→ 生产个人协作启用（逐项审批 + 专用桶实测通过）。
2. R1/C1/H1 → V1 → hzy0 部门协作验收 → 生产部门子开关灰度。
3. 若 10/8 前只能完成 P0 与个人协作，部门文档在 Host 继续只读；不为赶期放宽 R 重验、互斥或消费者盘点。上线日期由实施与验收进度重新评估（用户 2026-09-29 已确认扩大范围）。

## 8. 需要用户回复的问题

| 编号 | 问题 | 建议 |
| --- | --- | --- |
| **Q1** | 经理对有活动协作的文档设只读 / 回收：**撤销会话**（推荐，在线用户丢失最多一个保存窗口，页面提示）还是**先被会话阻塞、再提供强制选项** | 撤销，确认框显示在线人数 |
| **Q2** | parent / 无写权限者：首版**不开会话**（推荐）还是同时提供只读实时旁观（读票据，增量约 8–12 工时） | 首版不开，增量另议 |
| **Q3** | 接受 Directory 撤权的暴露窗口（续租周期 ≤30 秒 + 租期兜底 90 秒），及“已进入 Y.Doc 的失权者编辑无法剔除”的 CRDT 固有限制 | 接受；如需更短，可把续租降到 15 秒（Directory 读压力翻倍） |
| **Q4** | 转换时机：**点击“协作编辑”时**转换（推荐，阅读无副作用）；旧独立 Codocs 对该文档的写入随之 409，需确认旧入口对部门文档已退出或接受 | 点击时转换 |
| **Q5** | 规则解读：`collaboration-open` 以“稳定业务键（会话）+ 一次性票据作废重签”满足“跨应用写幂等”，不额外要求 `Idempotency-Key` | 接受该解读 |
| **Q6** | 部门协作是否需要**独立于个人协作的子开关**（推荐，E-8） | 是 |
| **Q7** | 参与者上限（建议每文档 ≤20 位并发写者）；超限拒绝开会话 | 20 |

## 9. 证据边界

- 已读：本文所引 Go / TS / Vue / 部署文件（`file:line` 见正文）；未运行任何测试或命令写入。
- 推断（未运行验证）：Hocuspocus 定向断开的具体 API、`document_shares.go` 的失效逻辑对 `department` 类型文档同样生效、直接读 `oss_path` 的部门消费者清单、生产 `release*.mjs` 是否已打包 `collab`、生产网关对 Console 令牌路径的来源限制。以上均列入 H1/C1/P0 的首步核对项。
- 未做：任何 DB、环境、部署、grant 或网络动作；本文不代表任何批次已实现、已验收或已获批。

## 10. 用户批准（2026-09-29）

用户原话：“批准协作设计，Q1–Q7 按建议”。据此批准 §3.2 的 A-1…A-7（不新增 capability/grant；`collaboration-snapshots` manifest 描述改写；新增 Runtime 固定操作 `department-documents:{collaboration-open,snapshot-read,snapshot-prepare,snapshot-publish}`；会话/参与者表 schema 变更（代码与迁移文件，生产/本机安装另按环境项逐项批准）；续租协议 `connectedUids`/`revokedUids`；授权语义与部门写路径 `invalidateCollaboration` 挂钩），Q1–Q7 采用本文建议（只读/回收撤销活动会话；只读成员首版不旁观；接受一个续租周期暴露窗口；接受转换后旧独立入口写入被拒；幂等解读成立；独立部门协作子开关；每文档并发写者上限 20）。环境项 E-1…E-13 仍逐项批准执行。

## R1 Runtime 实现状态（2026-09-29）

批次 R1（Runtime 授权核心）已按本文 A-1…A-7 / Q1–Q7 实现，代码与迁移文件就绪、默认关闭、未部署、未安装迁移、未做双人端到端验收。合同见 MODULE_CONTRACTS「Enterprise Host → Codocs 部门文档协作」，迁移 `codocs/docs/migrations/20260929_department_collaboration.sql`，隔离 MySQL 验证 `data-runtime/scripts/test-codocs-department-collaboration-mysql.mjs`。与本文的差异：

1. `edit-metadata` 在活动会话期间**允许**（按 2.5 表，标题/目录不属协作状态）；并发用例已补。部门 HTTP 正文保存本就不存在，转换后由既有 v2 守卫（`document_on_snapshot_v2`）拒绝。
2. 个人→部门移交接收：会话已作废（`invalidateCollaboration`），但**保留快照 head**（退出 v2 会回退到过期的 `oss_path` 镜像而丢失权威正文），与项目移交不同。
3. 转换请求的 `epoch` 取 `snapshot-read` 返回值而非固定 0（head 在 generation 0 时也可能因互斥推进 epoch）；`generation` 必须为 0。
4. 发布失权时 Runtime 在回滚后单独提交 `revoked` 状态，使下一次 renew/publish 不再重复发现同一批用户；发布记录的参与者含 `left` 不含 `revoked`。
5. 参与者集合在 Directory 加锁与 Codocs 事务之间变化时内部重试最多 3 次，仍变化 409 `collaboration_participants_changed`。
6. 索引：迁移额外为 `document_snapshot_heads(document_uuid)` 与会话 `(document_uuid,status)` 加索引，避免 UUID-only 的 `invalidateCollaboration` 在 SERIALIZABLE 部门写路径上全表加锁。

## H1a Host / Foundation / 页面实现状态（2026-09-29）

批次 H1a 已实现，代码与测试就绪、默认关闭、未部署、未做浏览器双人验收。端点与合同见 `enterprise/docs/API_SPEC.md`「部门文档协作」和 MODULE_CONTRACTS「部门文档协作：Host 侧」。与本文的差异或补充：

1. 转换是独立的显式端点 `collaboration/convert`，与领票端点分离：自动重连领票永远不会转换。v1 房间活动检查（Inventory Q5）没有现成的房间在线信号，用“文档 `updated_at` 或 `.yjs` 旁路对象 120 秒内有变化”作代理，无法判定即失败关闭；空闲但仍打开的旧房间不可探测，其转换后的存盘由 Collab v1 存盘前复核（D1，另一批次）拦截。
2. 部门文档此前在 Host 页面没有读取路由（个人视图路由对部门文档要求所有者/分享）。新增 `GET /codocs/api/departments/documents/:uuid` 供文档页读取，并附 `department_collaboration.can_edit` 提示。
3. 读取路径取消镜像读时修复（个人 v2 路径同样取消，`repairLegacyMirror` 已删除）；Host 保存后的 `mirrorSnapshotToLegacyPath` 保留。
4. 正文引用（Q1）：公司快速发布（A14）已按 H1b 计划的 `bodyRef`（`sourcePath` 置空）读精确版本；开放部门读取（A6）依赖 Runtime 标注的 `snapshot_generation`，v2 文档还需要 `snapshot_ref`，而企业 `open-department-documents:view` 尚未放开 `include_snapshot_ref`，转换后的开放部门文档在 Host 暂时失败关闭，需 Runtime 补齐后才能启用部门协作开关。
5. 未纳入本批次：A9/A10（回收站恢复的 `snapshot_backed` 计划变体，依赖 Runtime B4）、A11（部门版本历史）、A5 暂存意图摘要纳入 generation（同键重放复用首次暂存，属幂等语义，未改）。

## H1c 收尾实现状态（2026-09-29）

1. 企业 `open-department-documents:view` 由服务端追加 `include_snapshot_ref=1`，开放部门文档转换后不再失败关闭（H1a 遗留阻塞解除）。
2. 回收站恢复：个人与部门恢复计划新增 `snapshot_backed`（计划哈希绑定快照代际）；Host 跳过存储阶段，Runtime 只翻状态，发布头与 epoch 不动。
3. 部门文档只读版本历史（Q3 首版）：Runtime `department-documents:{versions,version-view}`、Host 路由与页面只读面板；未新增 capability/grant/schema，随三开关注册，hzy0 egress 投影排除。
4. 环境模板：`deploy/self-hosted/env/enterprise.env.example` 增加 `HZY_ENTERPRISE_CODOCS_DEPARTMENT_COLLABORATION_V2` 与 `NUXT_PUBLIC_CODOCS_DEPARTMENT_COLLABORATION_V2`（默认 `false`）；`runtime.env.example` 注释 Runtime `config.json` 中的三个开关；hzy0 运行器增加 profile 键 `features.codocsDepartmentCollaborationV2`（E-9 的代码部分，已交付，默认关闭）。
5. hzy0 启用顺序与双人验收脚本见 [启用计划](./Codocs-Collaboration-hzy0-Enablement-Plan.md)；仍未做任何环境写入或浏览器验收。

分享变更仍按已有机制撤销旧会话与推进epoch；当前同部门成员可重新准入，不把删除写分享视为永久撤销部门成员的默认正文权利。非成员即使持有分享也不能进入部门写会话；个人文档owner/share规则不变。

2026-10-07 补充裁定覆盖本文旧 leader 只读描述：仅直接 active 部门负责人加入 CanWrite；CanManage 仍仅 manager。创建/上传/复制目标准入随 CanWrite 开放，元数据标题仍要求经理、owner 或写分享，移动仍要求经理或 owner；只读、回收、目录管理、恢复等 CanManage 操作不扩大。
