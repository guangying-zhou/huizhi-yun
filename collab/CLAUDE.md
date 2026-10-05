# Collab 模块

> 平台运行时 — 实时协作运行时 | 端口 3021 | 状态：开发中 | 默认 provider：hocuspocus

## 职责边界

**负责**：WebSocket 实时协作、Yjs 同步、presence、协作 token 校验、协作文档快照/派生 Markdown 持久化、协作运行时健康检查。

**不负责**：文档业务、目录、标题、分享权限管理、发布审批、全文检索、模板管理。这些仍属于 Codocs。

## 架构原则

- 对外模块名称是 Collab Runtime，不暴露 Hocuspocus 作为平台模块。
- 当前 provider 使用 Hocuspocus 承接已有 Yjs 能力，provider 边界位于 `src/providers/`。
- 后续接入 Y-Sweet 时新增 provider，不改 Caddy 路径、Codocs 协作 token 或 Console runtime 管理口径。
- 默认部署形态是 Console embedded：`console/server/plugins/collab-runtime.ts` 调用 `collab` 包的 `startCollabRuntime()`，少一个独立进程；`pnpm --filter collab dev/start` 仍作为 standalone 模式保留。
- 配置目标由 Console 管理；当前保留 `.env` 是 standalone 或迁移期启动方式。
- Console embedded 模式下，Console 的 `DB_*` 指向 `hzy_console`；Collab 不允许直连 Codocs DB，必须通过 `HZY_TENANT_RUNTIME_URL` 或 `COLLAB_CODOCS_RUNTIME_URL` 调用 Codocs runtime 获取文档上下文、权限和版本写入能力。
- 旧 v1 文档仍由 Collab 直接使用 OSS；Console embedded 模式可从 Console `oss.default` 解析注入，standalone/迁移期沿用 `COLLAB_OSS_*` / legacy `ALIYUN_OSS_*`。此配置不用于 v2 快照。
- 自托管生产以独立进程运行（`deploy/self-hosted/systemd/hzy-collab.service`，回环 `127.0.0.1:31007`，`env/collab.env.example`）；发布包由 `deploy/self-hosted/bundle-collab.mjs` 用 esbuild 打成单文件。**Hocuspocus 3.4.4 忽略 `address` 配置，实际绑定通配地址**（`lsof` 显示 `*:PORT`）；打包时注入监听补丁把无 host 的 `listen(port)` 固定到 `COLLAB_ADDRESS`，`health.mjs` 在启动后从外部再核验。改用 `tsx`/源码直接运行（如 hzy0 脚手架）不含该补丁，须另行限制监听面。
- v2 快照文档（写入协调合同阶段 B）走独立路径：`COLLAB_V2_ENABLED=true` 时，连接 token 为 Host 签发的一次性票据 `v2.<hex>`，以 `collab.runtime` 服务身份（Foundation `createStandaloneServiceTokenClient`）兑换后才加载；Collab 不持有 OSS 凭据，快照字节经 Runtime `/v1/codocs/collaboration-snapshots:upload|download`，再以精确版本配对发布；租约续租失败即断开。旧 v1 文档路径与 HMAC token 不变。见 `docs/Codocs-Document-Write-Coordination.md`。

## 部门文档协作（C1，设计 `docs/Codocs-Host-Department-Collaboration-Design.md` §2.4）

按兑换响应中的非空 `deptCode` 判定部门会话；其余（个人）路径行为不变。代码在 `src/utils/v2-snapshots.ts`、`extensions/authentication.ts`、`extensions/persistence.ts`。

协议（Collab 侧实现，与 Runtime R1 对齐）：

- `:admit` 响应新增可选 `deptCode`、`participantAccess`；仅用于选择协议和日志，不作授权依据。`deptCode` 缺失即个人会话。
- `:renew`（部门）请求体 `{ sessionId, connectedUids: string[] }`（已连接 + 60 秒内已兑换未连上的用户，去重排序）；响应 `{ expiresAt, revokedUids?: string[] }`。`revokedUids` 中的用户被以 close code 4403、reason `collaboration_access_revoked` 断开，并摘出参与者；该用户之后的消息由 `beforeHandleMessage` 丢弃，直到其再次通过一次新的 Runtime `:admit`。个人 `:renew` 仍只发 `{ sessionId }`。
- 任意 `:renew` 的 401/403/404/409 关整间房（reason `collaboration_session_closed`），不再持久化；暂时性故障仍只在最后确认的 `expiresAt` 前重试。部门续租间隔 = min(`COLLAB_V2_RENEW_INTERVAL_MS`, 30s)，最小 5s。
- 租期：租期由 Runtime 签发（部门 90s）；Collab 额外把部门会话每次听到的 `expiresAt` 限制为不超过 `now+90s`（防御）。
- `:publish` 的 409：`collaboration_participant_revoked` 且响应携带 `revokedUids`（顶层、`error` 或 `data` 内均可）→ 只断开这些用户并抛错，不在本次调用内重试，由下一个保存周期重试；`revokedUids` 缺失，或 `collaboration_session_invalid` / `collaboration_session_expired` → 关整间房，此后同房间的保存直接拒绝、不再访问 Runtime。仅部门会话适用。
- 并发写者上限 20（不同用户；同一用户多标签不重复计数），在 `:admit` 之后检查，超限抛 `collaboration_writer_limit`（409）；仅部门会话。
- 保守解读（请 R1 核对）：(1) 未见 `revokedUids` 的 publish `collaboration_participant_revoked` 视为会话丢失；(2) 部门 renew 的 403 也按整房处理；(3) 已兑换未连接用户计入 `connectedUids`，避免被误标 `left`；(4) 其余 409（如代际冲突）不关房，按原逻辑抛错重试。
- Runtime 错误只保留匹配 `/^[a-z0-9_.:-]{1,64}$/i` 的机器码，其余文本丢弃，避免响应体进入日志或异常。日志只含房间名与人数，不含票据、令牌、正文。

v1 保护：旧 v1 房间每次存盘前用**新读取**的 `/v1/codocs/collaboration/documents/{uuid}/context` 复核；Runtime 返回 409（`document_on_snapshot_v2`）即拒绝写 `.yjs`/镜像/版本、关闭该房间连接并记住（卸载前不再请求）；无法确认（其它错误）同样失败关闭。复核与写入之间仍有毫秒级窗口，最终由 Runtime 侧版本创建拒绝兜底。
