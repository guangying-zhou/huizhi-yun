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

Codocs 是运维知识、SOP、故障复盘正文和协作编辑能力事实源。P4.4 已落地 `POST /api/v1/service/ops-knowledge/link`，Codocs middleware 在转发 tenant-runtime 前校验 Console service token（`aud=codocs`、`scope=codocs:documents:write`、来源 `altoc`）并覆盖请求体来源，由 tenant-runtime 在单事务内写入 `document_relations`，把 `document_uuid` 与客户、合同、项目、Assets 正式交付资产、Assets 环境、Altoc 服务工单六类上下文关联起来。上下文关系使用稳定 service principal，`can_read/can_edit/can_comment` 全为 false，绝不能借业务索引授予文档 ACL。
服务令牌 introspection 只有明确 inactive/revoked/invalid 才返回 401；Console introspection 网络、5xx 或存储故障必须在读取业务 body、调用 handler 或 tenant-runtime mutation 前返回可重试 503。

`/api/v1/service/**` 只有已登记 capability 的后缀可以进入 tenant-runtime 转发；未知 service-only 路径必须在本地 BFF/tenant-runtime 处理前直接 403，避免未登记跨应用调用借 Codocs runtime 身份穿透。

该接口只建立文档关系索引，不复制 Altoc 工单正文、Aims 工作项正文、Assets 交付实例主档或 Finance 成本明细。业务模块只能保存 `document_uuid` 和必要标题 / 上下文快照。

Aims 公司周报发布使用 `POST /api/v1/service/company-weekly-summaries/{periodKey}:publish`。Codocs 必须分别绑定 service token 中的 Aims source deployment 与 Tenant Gateway 路由后的 Codocs target deployment，并在 OSS 上传和 runtime mutation 前验证 method/path、request ID、完整 service-command envelope 与 source/target deployment 的短时 HMAC；不得再假设来源、目标 deployment 相同。

Aims 产品文档元数据使用 `POST /api/v1/service/product-documents/{uuid}/metadata`，要求精确 `codocs:product-document:read` 和受信 `aims.runtime` 来源。固定签名载荷绑定 actor、产品和文档 UUID，源/目标 deployment 分别校验；目标使用自身 runtime 身份，按 Codocs 当前 owner/share/relation ACL 返回四个元数据字段，不授予正文或分享权限。接口代码已接入，目标环境 grant 与完整跨服务验收尚未完成，详见 `docs/CODOCS_API_SPEC.md`。

## 数据库

Schema 定义：`docs/codocs_schema.sql`

核心表：git_projects、git_project_members、folders、documents

阶段 3 tenant-runtime 迁移约束：

- 协作上下文和版本写入必须通过 Codocs tenant-runtime；`/api/collaboration/token` 不再直连 `documents` / `document_shares`。
- Collab Runtime 不允许直连 Codocs DB，统一通过 `GET /v1/codocs/collaboration/documents/{uuid}/context` 和 `POST /v1/codocs/documents/{uuid}/versions`。
- Codocs Nuxt server 不再新增应用侧直连 DB 主路径；新增文档元数据、分享、文件柜/部门柜、资讯、问题、批注、评审、发布、版本记录相关 DB 能力时，必须先补 `data-runtime/internal/apps/codocs` contract。
- 已收口路径由 `server/middleware/tenant-runtime.ts` 统一转发或拦截：文档/文件夹列表、文档创建/更新/删除/恢复、回收站、重名检查、分享、已读、版本、文件柜、部门柜、部门分享、资讯中心、问题、批注、发布申请等数据路径走 tenant-runtime；发文流程定义、路由和节点统一由 Workflow 管理。Workflow 审批通过后的归档、盖章、发送、接收使用 `/v1/codocs/reviews/publish-requests/{id}/{archive-plan|archive|seal|send|receive}` 专用合同，只有 OSS 复制、通知和快照清理由 Nuxt BFF 编排，业务状态与记录全部由 runtime 事务写入。
- 工作日志、个人周报、项目周报复用 `/v1/codocs/documents` 元数据合同和 OSS 路径约定，不再新增本地 DB 查询。
- `x-bookmark-fetcher` 不允许直连 Codocs DB；书签导入、processing 查询、资讯条目创建必须通过 `/v1/codocs/info/**` runtime 合同。
- 仍依赖 Workflow 副作用、GitLab 同步、导入导出、通知编排或复杂事务的旧 `/api/**` handler，在补专用 runtime contract 之前必须显式 503，不允许回退本地 DB。
- Codocs Nuxt server 与 Collab Runtime 不保留本地 MySQL 主路径；需要数据库读写时必须先补 `data-runtime/internal/apps/codocs` 合同，并通过 tenant-runtime/data-runtime 调用。

## 开发注意

- 组织资产「快速发布」要求 `admin:admin` + `company:publish`，保留源部门文档，独立生成只读副本；仅通过 runtime prepare/complete 持久化，不走审批、不发送企业微信通知。公司资产发布记录也须服务端校验管理员。
- 组织资产查看记录写入 runtime，读取需 `admin:admin` + `company:admin`，CSV 导出另需显式 `company:export`。查看记录写入失败时预览返回 503；部署须先迁移两张表并更新 runtime，见 [上线说明](docs/Company-Asset-Admin-Publishing.md)。

- 已发布资产“复制链接”通过 `/api/published-asset-links` 按需生成 `/s/{token}`，映射归 tenant-runtime 的 `published_asset_links` 表；必须先建表并更新 runtime。短链接沿用登录权限、预览水印及查看记录，历史 OSS-only 文档无需补建 UUID。原 `/company/document?path=...`、`/departments/document?path=...` 及发布通知长链接继续可用；URL 格式复用 `shared/utils/publishedAssetLink.ts`。

- 只读文档水印使用 Foundation `/api/directory/me` 的本人目录资料与四位 `mobileTail4`；共享用户列表不提供手机字段，不能作为水印来源。
- 已发布正文通过编辑器 `disableSelection` 禁止选择，不能恢复原只读编辑器的 `user-select: text` 行为；普通编辑及非发布预览保持原行为。已发布 PDF 使用无文字选择层的画布阅读器；同源 `/api/company-assets/preview?format=pdf` 鉴权后读取字节并记一次查看记录，元数据响应不重复计数，PDF.js 静态资源须随应用一起发布。

- 修改 API 后必须更新 `docs/CODOCS_API_SPEC.md`
- 发布申请查询目录时显式传入请求 event；提交 Workflow 使用 Foundation `serviceAppFetch` 与 `HZY_WORKFLOW_SERVICE`，通过可信目标路由直达 Workflow 并绑定目标 app/deployment/prefix，禁止重新进入租户公网 Gateway。
- Milkdown 编辑器依赖重，保持 iframe 嵌入方式，不放入 Foundation 层
- 用户协作颜色从 uid hash 确定性生成
- Workflow 回调等跨模块服务端写操作必须校验 Console service token：`token_use=service`、目标 `aud=codocs`、所需 `scope`（如 `workflow:callback`）和来源应用 `workflow`；不要新增共享回调密钥。

Assets 产品文档元数据新增独立 POST `/api/v1/service/assets-product-documents/{uuid}/metadata`：仅接受 assets.runtime、精确 codocs:product-document:read 和签名 assets.codocs.product-document.read.v1；校验 tenant、双 deployment、actor 委托后调用 Codocs 自身同名 Runtime 路径。文档 ACL 仍由 Codocs 重验，返回仅 uuid/title/doc_type/updated_at。调用方传输／grant 尚在接线，未启用真实环境。
