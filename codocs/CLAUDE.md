# Codocs 模块

> 业务模块 — 协作文档与知识管理 | 端口 3001 | 状态：已上线 | 数据库：hzy_codocs（阶段 3 起逐步迁入 tenant-runtime）
>
> 📖 涉及认证、目录、审批、共享组件或 Server API 复用时，按需查 [`docs/FOUNDATION_CAPABILITIES.md`](../docs/FOUNDATION_CAPABILITIES.md)；简单局部改动不需要预读。

## 职责边界

**负责**：文档创建/编辑/协作、实时多人协同（Y.js CRDT）、文档分类（私人/部门/项目/公司发文/知识库/产品文档）、版本控制、OSS 存储、文档评审、GitLab 同步

**不负责**：用户/权限管理（→ Console Directory / Platform policy / Foundation adapter；Account 仅 legacy 兼容）、审批流程（→ Workflow）、项目管理（→ Aims）。Codocs 不读取本地 policy bundle，业务授权只消费 Foundation/Console 结果。

## 协作运行时架构

1. **Nuxt/Nitro 服务**（端口 3001）：文档 CRUD、元数据、OSS 管理、API
2. **Collab Runtime**（默认端口 3021，可由 Console embedded 启动或 standalone 部署）：提供 WebSocket 实时协作，内部默认 provider 为 Hocuspocus，通过 tenant-runtime/data-runtime 读取 Codocs 文档上下文、权限并写入版本记录

## 关键约束

- 文档使用 `uuid` 作为跨模块标识
- Collab Runtime 认证通过 Codocs 短期协作 token 验证，不共享主会话
- Redis 可通过 `REDIS_DISABLED=true` 关闭（开发环境）
- 所有外部实体引用（project_code、uid）不使用外键约束
- 构建需要增加内存：`NODE_OPTIONS='--max-old-space-size=4096'`

## 依赖的模块

- **Console Directory / Foundation**：用户/部门/项目数据查询；存量未迁移路径可继续通过 Account legacy bridge
- **Workflow**：文档审批流程（通过 Foundation 的 useWorkflow）

## 被依赖

- **Altoc**：调用 Codocs API 创建销售相关文档
- **Aims**：通过 iframe 嵌入 Codocs 编辑器
- **Assets**：只引用 Codocs `uuid` 作为资产、产品和交付成果文档标识

## 一体化运营闭环 Phase 2 契约

Codocs 是文档正文和文档 UUID 的事实源。业务模块创建文档时如果显式传 `doc_type`，以调用方传值为准；如果未传，tenant-runtime 会按业务上下文自动归类：

- Aims 或带 `project_code` 的上下文默认归入 `project`。
- Altoc 或带 `contract_code/customer_code` 的上下文默认归入 `sale`。
- Assets 带 `product_code` 的上下文默认归入 `product`；交付 / 资产上下文有 `project_code` 时归入 `project`，否则归入 `knowledge`。

其他模块不得复制文档正文，只保存 `uuid`、标题快照和业务上下文。

## 运维服务与客户成功 Phase 4 契约

Codocs 是运维知识、SOP、故障复盘正文和协作编辑能力事实源。P4.4 已落地 `POST /api/v1/service/ops-knowledge/link`，Codocs middleware 在转发 tenant-runtime 前校验 Console service token（`aud=codocs`、`scope=codocs:documents:write`、来源 `altoc`），由 tenant-runtime 写入 `document_relations`，把 `document_uuid` 与客户、合同、项目、Assets 交付实例、Altoc 服务工单等上下文关联起来。

该接口只建立文档关系索引，不复制 Altoc 工单正文、Aims 工作项正文、Assets 交付实例主档或 Finance 成本明细。业务模块只能保存 `document_uuid` 和必要标题 / 上下文快照。

## 数据库

Schema 定义：`docs/codocs_schema.sql`

核心表：git_projects、git_project_members、folders、documents

阶段 3 tenant-runtime 迁移约束：

- 协作上下文和版本写入必须通过 Codocs tenant-runtime；`/api/collaboration/token` 不再直连 `documents` / `document_shares`。
- Collab Runtime 不允许直连 Codocs DB，统一通过 `GET /v1/codocs/collaboration/documents/{uuid}/context` 和 `POST /v1/codocs/documents/{uuid}/versions`。
- Codocs Nuxt server 不再新增应用侧直连 DB 主路径；新增文档元数据、分享、文件柜/部门柜、资讯、问题、批注、评审、发布、版本记录相关 DB 能力时，必须先补 `data-runtime/internal/apps/codocs` contract。
- 已收口路径由 `server/middleware/tenant-runtime.ts` 统一转发或拦截：文档/文件夹列表、文档创建/更新/删除/恢复、回收站、重名检查、分享、已读、版本、文件柜、部门柜、部门分享、资讯中心、问题、批注、评审模板、发布申请等数据路径走 tenant-runtime；文档内容读取/写入、资讯 Markdown 正文读取、文件流式预览、下载和上传保留 Nuxt BFF 处理 OSS，但元数据和版本记录必须走 tenant-runtime。
- 工作日志、个人周报、项目周报复用 `/v1/codocs/documents` 元数据合同和 OSS 路径约定，不再新增本地 DB 查询。
- `x-bookmark-fetcher` 不允许直连 Codocs DB；书签导入、processing 查询、资讯条目创建必须通过 `/v1/codocs/info/**` runtime 合同。
- 仍依赖 Workflow 副作用、GitLab 同步、导入导出、通知编排或复杂事务的旧 `/api/**` handler，在补专用 runtime contract 之前必须显式 503，不允许回退本地 DB。
- Codocs Nuxt server 与 Collab Runtime 不保留本地 MySQL 主路径；需要数据库读写时必须先补 `data-runtime/internal/apps/codocs` 合同，并通过 tenant-runtime/data-runtime 调用。

## 开发注意

- 修改 API 后必须更新 `docs/CODOCS_API_SPEC.md`
- Milkdown 编辑器依赖重，保持 iframe 嵌入方式，不放入 Foundation 层
- 用户协作颜色从 uid hash 确定性生成
- Workflow 回调等跨模块服务端写操作必须校验 Console service token：`token_use=service`、目标 `aud=codocs`、所需 `scope`（如 `workflow:callback`）和来源应用 `workflow`；不要新增共享回调密钥。
