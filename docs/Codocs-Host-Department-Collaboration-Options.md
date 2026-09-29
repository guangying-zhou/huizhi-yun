# Host 部门文档编辑与协作：上线决策选项

2026-09-29 · **待用户决定；本文不批准实施或环境变更。** 现状：Host 编辑器仅对已共享的私人文档尝试 v2 协作，部门文档不发 token/WebSocket 请求并保持只读；hzy0 未启用 Collab。证据见本地诊断 `.git/codex-report-host-collab.md`。现行 [10/8 上线计划](./Go-Live-20261008-Plan.md)把 Codocs Host 迁入与实时 Collab 列为第二窗口；若要 10/8 提供部门正文编辑，须明确改变范围并重做验收门禁。

| 决策 | 做法与验收边界 | 估计增量工作量* | 新能力 / 环境 | 10/8 影响与主要风险 |
| --- | --- | --- | --- | --- |
| **A：先用 HTTP 保存（推荐作为部门编辑首版）** | 在 Host 部门文档编辑器允许有权者按“未共享私人文档”模式保存正文；**新增部门文档专用 Runtime 正文保存操作**，不能把私人文档 PUT 或 `personal-documents:snapshot-*` 放宽到部门类型。Host 先验 `departments:edit`；Runtime 核验 R∈{member,manager} 且 actor 是 owner／有 write share／R=manager，与现有 `department-documents:edit-metadata` 写门槛一致；沿用 Directory 独立事务持关系锁至 Codocs 写事务提交的做法，在读取回执前复核，拒绝只读、已回收、错部门和失权。同一用户意图键重放不重复写，异载荷 409。客户端提交**读取时**的版本/row_version 或内容 hash（优先复用现有 snapshot generation+epoch，若部门类型不兼容则设计并测试等价 CAS），事务内比较，不匹配 409 并保留草稿、提示刷新后人工合并；不得在保存时重取最新版本覆盖预期值。正文/OSS 与回执的分阶段恢复边界需沿既有 v2 快照合同闭合。**无实时共同编辑**，同时编辑者靠冲突提示解决。 | 约 **24–40 工时**：Runtime/存储与 CAS 12–20，Host/UI 6–10，隔离 MySQL、并发/撤权/失败恢复与页面回归 6–10；实际以部门文档 v2 适配评审为准。 | 预计**无需新服务 capability/grant**：沿用 `codocs:enterprise-host:execute`，只新增固定操作、Runtime 路由及 `department-documents:edit` permit；仍须确认 Host 人员 `departments:edit` 与当前 grant 实际签发。无独立 Collab 进程或 WS 部署。 | 比 B 易于在独立小批验证，但仍是 10/8 新范围，须在冻结前完成评审、隔离测试和两用户冲突演练；若赶不上则维持只读。并发覆盖、OSS 成功而 SQL 未完成、旧协作状态混写是关键风险。 |
| **B：部门文档实时协作** | 设计专用部门文档会话准入：Host `departments:edit`，Runtime 复核 R、owner/share-write 或经理、文档/代际/epoch、只读与回收状态，签个人一次性票据；Collab 通过 `collab.runtime` 兑换、载入、续租与发布。授权变化关房间、迟到发布拒绝，HTTP 保存与活跃会话互斥；双人编辑、断线重连、撤权和历史/镜像做端到端验收。不能仅删除前端 `doc_type === 'private'` 条件，也不能借用 `personal-documents:collaboration-open`。 | 约 **64–104 工时**（含部署准备和端到端验收）：专用 Runtime/数据模型 24–40，Host/Collab 接线 16–24，身份及自托管路由/配置 12–20，双人、故障、撤权验收 12–20；存量 v1 文档转换另计。 | Host 委托**优先复用** `codocs:enterprise-host:execute`，新 `department-documents:collaboration-open` 固定操作仍须权限/permit 审查；若 Collab 现有 `codocs:collaboration-snapshots:read/publish` 不覆盖部门对象，必须另报新能力/grant，能力冻结期间不得自行添加。**需用户批准环境变更**：独立 Collab 进程和凭据、`collab.runtime` 注册/精确 grant 核验、Runtime/Host/Collab 开关、Gateway Collab loopback origin 与 `/codocs/ws`、公网 nginx Upgrade/超时、迁移与回滚。 | **建议放第二窗口。** 当前开关默认关、本机无 Collab、生产模板仅有代理示例；10/8 前纳入会扩大制品、授权和现场验收范围。主要风险是授权误开、撤权后仍在线、迟到发布及断线时正文丢失。 |

\* 估计为工程与验证总工时，不含审批等待、生产变更窗口和存量文档迁移；不是交付承诺。

## 独立决定：10/8 是否启用共享个人文档协作

**建议不启用，保持自托管生产默认关闭。** 当前 `enterprise.env.example` 的 `HZY_ENTERPRISE_CODOCS_COLLABORATION_V2=false`，`console.env.example` 的内嵌 Collab 也关闭；已有 Host 私人共享 v2 会话代码，但仍需独立 Collab 服务、服务身份和 grant 核验、Gateway/nginx WebSocket、Runtime 双开关及双人端到端验收。开启会把原本列为第二窗口的实时 Collab 纳入 10/8 关键路径；不开启时共享个人文档在 Host 仍只读，不能以 HTTP 保存绕过协作锁。若用户选择 10/8 启用，须单独批准上述环境动作和扩大的验收范围，不等于同时授权部门文档协作。

## 请用户回复

1. **部门文档正文编辑：**“选 A，作为第二窗口首版”／“选 A，纳入 10/8 并调整门禁”／“选 B，放第二窗口”／“保持 Host 只读”。推荐第一项；若 10/8 范围不调整，继续只读上线。
2. **共享个人文档实时协作：**“10/8 保持关闭”（推荐）或“10/8 启用，并另批批准环境变更及双人验收”。

## 用户决定（2026-09-29）

- **部门文档正文编辑：选 B，实现实时协作。**按专用部门文档会话准入合同实施（Host `departments:edit` + Runtime 同一时点复核 R/写权限/代际/状态，一次性票据，`collab.runtime` 兑换与发布，撤权关房间、迟到发布拒绝、HTTP 保存与会话互斥）；不得放宽前端 `doc_type` 条件或复用 `personal-documents:collaboration-open`。新增 capability/grant 与环境启用（独立 Collab 进程、Gateway `/codocs/ws`、nginx Upgrade、`collab.runtime` grant 核验）仍逐项报审。
- **共享个人文档协作：上线启用。**自托管生产须部署独立 Collab 并完成服务身份、grant、WebSocket 路由与双人端到端验收；环境动作逐项批准。
- 以上扩大 10/8 范围，上线日期按实施与验收进度重新评估。
