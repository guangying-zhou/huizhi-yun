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
- v2 快照文档（写入协调合同阶段 B）走独立路径：`COLLAB_V2_ENABLED=true` 时，连接 token 为 Host 签发的一次性票据 `v2.<hex>`，以 `collab.runtime` 服务身份（Foundation `createStandaloneServiceTokenClient`）兑换后才加载；Collab 不持有 OSS 凭据，快照字节经 Runtime `/v1/codocs/collaboration-snapshots:upload|download`，再以精确版本配对发布；租约续租失败即断开。旧 v1 文档路径与 HMAC token 不变。见 `docs/Codocs-Document-Write-Coordination.md`。
