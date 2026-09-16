# Collab Runtime

Collab Runtime 是汇智云的平台级实时协作运行时。它承接 Codocs 的 WebSocket 协作能力，但不把 Hocuspocus 作为对外模块名暴露。

默认部署形态是 Console embedded：Console 进程启动时加载 `collab` runtime 包，并在 `3021` 暴露协作 WebSocket/健康接口。独立 `collab` 进程仍保留，适用于高并发协作、故障隔离或独立扩容。

## 本地启动

Console 内嵌模式：

```bash
pnpm --filter console dev
curl http://localhost:3000/api/v1/console/runtime/collab
curl http://localhost:3021/api/v1/collab/runtime
```

独立运行模式：

```bash
pnpm install
pnpm --filter collab dev
```

默认监听：

```text
http://localhost:3021
```

健康检查：

```bash
curl http://localhost:3021/healthz
curl http://localhost:3021/api/v1/collab/runtime
```

Codocs WebSocket 仍通过统一网关暴露为：

```text
/codocs/ws
```

## Provider

当前默认 provider：

```text
COLLAB_PROVIDER=hocuspocus
```

`hocuspocus` 只是内部 provider。后续可增加 `y-sweet` provider，保持外部 `collab` 模块边界稳定。

## 配置

Console embedded 模式下，Console 自身的 `DB_*` 仍指向 `hzy_console`；Collab 不再读取 Codocs 数据库，文档上下文、分享权限与版本写入都通过 Codocs tenant-runtime API 完成：

```text
HZY_TENANT_RUNTIME_URL=http://127.0.0.1:18080
HZY_TENANT_RUNTIME_TOKEN=
```

需要独立灰度 Codocs runtime 时可使用 `COLLAB_CODOCS_RUNTIME_URL` / `COLLAB_CODOCS_RUNTIME_TOKEN` 覆盖统一配置。

OSS 持久化默认由 Console 解析 `oss.default` 集成配置和 vault secret 后注入 Collab，不再要求在 Collab/ Codocs env 中重复配置 `ALIYUN_OSS_*`。旧参数按以下字段进入 Console 集成配置：

| 旧 env | Console config |
| --- | --- |
| `ALIYUN_OSS_BUCKET_NAME` | `bucketName` |
| `ALIYUN_OSS_ENDPOINT` | `endpoint` |
| `ALIYUN_OSS_BUCKET_DOMAIN` | `bucketDomain` |
| `ALIYUN_OSS_PROJECTS_BUCKET_NAME` | `projectsBucketName` |
| `ALIYUN_OSS_PROJECTS_ENDPOINT` | `projectsEndpoint` |
| `ALIYUN_OSS_PROJECTS_BUCKET_DOMAIN` | `projectsBucketDomain` |
| `ALIYUN_OSS_IMAGES_BUCKET_NAME` | `imagesBucketName` |
| `ALIYUN_OSS_IMAGES_ENDPOINT` | `imagesEndpoint` |
| `ALIYUN_OSS_IMAGES_BUCKET_DOMAIN` | `imagesBucketDomain` |

standalone 模式仍可使用 `COLLAB_REDIS_*`、`COLLAB_OSS_*` 作为迁移期或独立部署配置。

## Cloudflare Durable Objects POC

Codocs 迁移期间保留 Hocuspocus 作为可回滚 provider。Cloudflare Durable Objects provider 先作为 POC 独立部署，用于验证 `/codocs/ws` 网关路由、房间命名、协作鉴权、Yjs 同步和 Durable Object snapshot。

```bash
cd /Users/gavin/Dev/huizhi-yun/collab
pnpm run deploy:cloudflare:poc
```

当前 POC 已实现：

- `COLLAB_ROOM` Durable Object 房间路由，房间名按 `tenant:app:doc:{uuid}` 归一。
- Hocuspocus-compatible auth frame，使用 Codocs 短期 collaboration token 校验。
- Yjs sync message、awareness message 的房间内广播。
- WebSocket Hibernation 下的 socket attachment 恢复。
- Durable Object storage 内的 `snapshot` / `snapshotMeta` 最小持久化。

仍需在生产切换前补齐：

- ObjectStorage update log 与 snapshot compact。
- 双浏览器编辑、断线重连、readonly token 写入拒绝的端到端测试。
- Console/Platform runtime config 灰度开关和回滚路径。
