# Collab Runtime Architecture

状态：Draft implementation  
日期：2026-05-16

## 定位

Collab Runtime 是汇智云的平台级实时协作运行时，负责多人协同编辑的数据面能力。它逻辑上由 Console 管理，默认随 Console 进程以内嵌模式启动；需要独立扩容或隔离时，也可以保留为独立服务运行。默认监听端口仍为 `3021`，用于统一网关转发 `/codocs/ws` 与 `/collab/`。

## 职责边界

Collab Runtime 负责：

- WebSocket 实时协作连接
- Yjs sync 与 awareness/presence
- 短期协作 token 校验
- Yjs snapshot 与 Markdown mirror 持久化
- 协作运行时健康检查和 provider 状态暴露

Collab Runtime 不负责：

- 文档目录、标题、正文业务查询
- 文档分享、发布、审核、模板、全文检索
- 用户登录态、组织权限主数据

这些业务能力仍由 Codocs、Console、Platform、Workflow 分别负责。

## 当前实现

`collab` 模块是可复用 Node/TypeScript runtime 包，同时支持 Console embedded 与 standalone 两种运行方式：

```text
collab/
├── src/index.ts
├── src/runtime.ts
├── src/server.ts
├── src/config.ts
├── src/providers/
│   ├── index.ts
│   ├── types.ts
│   └── hocuspocus.ts
├── src/extensions/
│   ├── authentication.ts
│   ├── persistence.ts
│   └── runtime-http.ts
└── src/utils/
```

当前默认 provider 是 `hocuspocus`，但 Hocuspocus 只作为内部 provider，不再作为平台模块边界暴露。后续增加 Cloudflare Durable Objects 或 Y-Sweet 时只需要新增 provider 实现。Codocs 迁移到 Cloudflare 的协同服务、对象存储与灰度路线见 `docs/Codocs-Cloudflare-Migration-Plan.md`。

## 运行模式

| 模式 | 启动方式 | 用途 |
| --- | --- | --- |
| `embedded` | Console `server/plugins/collab-runtime.ts` 默认启动 | Starter、小客户私有化、开发环境；少一个独立进程 |
| `external` | Console 不启动内嵌 runtime，只记录外部状态 | 已有独立 Collab 服务或迁移期并行部署 |
| `disabled` | Console 不启动也不管理 Collab | 临时关闭协作运行时 |
| `standalone` | `pnpm --filter collab dev/start` | 高并发协作、大客户、故障隔离或独立扩容 |

Console 侧通过 `CONSOLE_COLLAB_MODE=embedded|external|disabled` 控制。`standalone` 是 `collab` 包自己的运行模式；在 Console 中设置 `standalone` 会被解释为 `external`。

Console 状态接口：

```bash
GET /api/v1/console/runtime/collab
```

返回当前 mode、provider、端口、Codocs tenant-runtime 连接目标、Redis 状态和持久化配置摘要。

Console embedded 模式下，Collab 启动时从 Console `oss.default` 集成配置 resolve OSS 运行参数：

| Console config | 用途 |
| --- | --- |
| `bucketName` / `endpoint` / `bucketDomain` | 普通 Codocs 文档持久化 |
| `projectsBucketName` / `projectsEndpoint` / `projectsBucketDomain` | `doc_type = git-project` 的项目文档持久化 |
| `imagesBucketName` / `imagesEndpoint` / `imagesBucketDomain` | Codocs 图片 bucket 配置，由 Codocs Nuxt 服务消费，Collab 状态中仅作为配置摘要展示 |
| `recycleDays` | Codocs 回收站保留策略 |

`ALIYUN_OSS_PROJECTS_*`、`ALIYUN_OSS_IMAGES_*` 等 legacy env 不再直接放在 Codocs env 中，统一迁入 `oss.default.config_json`。Collab standalone 模式仍可用 `COLLAB_OSS_*` 作为迁移期或独立部署配置。

## 路由约定

统一网关：

| 路径 | 目标 |
| --- | --- |
| `/codocs/ws` | Codocs 编辑器协作 WebSocket |
| `/collab/` | Collab Runtime 管理/健康接口 |

本地服务：

| 服务 | 端口 |
| --- | --- |
| Workflow | 3020 |
| Collab Runtime | 3021（默认由 Console 进程内嵌启动；standalone 时由 `collab` 进程启动） |

## 健康接口

```bash
GET /healthz
GET /api/v1/collab/health
GET /api/v1/collab/runtime
GET /api/v1/collab/providers
```

## 后续迁移

1. 将协作鉴权 secret、Redis 配置迁到 Console integration/vault。
2. 为 Console 管理的 Collab Runtime 增加 managed-secret bootstrap，避免直接读取 Redis 或协作鉴权明文 env。
3. Codocs 只负责签发短期 document collaboration token，不再关心底层 provider。
4. PoC `cloudflare-durable-object` provider，验证 WebSocket hibernation、Yjs update 广播、snapshot、S3/OSS/R2 兼容、权限 token、恢复能力和性能。
5. 需要第三方托管协同能力时，再评估 `y-sweet` provider，保持 `collab` 外部接口不变。
