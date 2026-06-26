# Codocs Cloudflare 托管、协同服务与对象存储迁移落地计划

状态：Draft  
日期：2026-05-24  
定位：Codocs 从自有服务器运行形态迁向 Cloudflare 托管形态的实施路线，覆盖 Codocs Nuxt、Collab Runtime、对象存储抽象和 Console/Platform 配置边界。

## 0. 文档目的

本文回答三个问题：

1. `Codocs` 是否可以像 `finance`、`altoc` 一样迁到 Cloudflare。
2. 基于 Cloudflare 能力如何实现通用协同服务，替代或并行现有 Hocuspocus。
3. 阿里 OSS / Cloudflare R2 / MinIO 等对象存储能力应如何进入 Foundation layer，而不是散落在业务应用 env 和 SDK 里。

结论：

- `Codocs` 可以迁移，但不能按普通 CRUD 应用一次性直接搬迁。
- `Codocs Nuxt`、`Collab Runtime`、对象存储访问必须拆成三条迁移线。
- 协同服务目标 provider 应基于 Cloudflare Durable Objects + WebSocket Hibernation。
- 对象存储应先进入 Foundation 的通用 `ObjectStorage` adapter，再由 Codocs 和 Collab 消费。
- 阿里 OSS 可通过 S3-compatible API 接入，但需要 provider 处理 virtual-hosted-style、ACL、ETag、`x-oss-process` 等差异。

相关文档：

- `docs/Huizhi-yun-SaaS-Product-Shape-and-Implementation-Path.md`
- `docs/Codocs-Compatibility-Integration-Plan.md`
- `docs/Collab-Runtime-Architecture.md`
- `docs/ENV_SIMPLIFICATION_PLAN.md`
- `docs/FOUNDATION_CAPABILITIES.md`
- `deploy/cloudflare/tenant-gateway/README.md`

Cloudflare / OSS 官方能力参考：

- Durable Objects WebSockets: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Durable Objects Storage: https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/
- Durable Objects Alarms: https://developers.cloudflare.com/durable-objects/api/alarms/
- Cloudflare R2 Workers API: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- Cloudflare R2 S3 API: https://developers.cloudflare.com/r2/get-started/s3/
- 阿里 OSS S3 兼容差异: https://help.aliyun.com/zh/oss/developer-reference/compatibility-with-amazon-s3

## 1. 目标形态

最终访问形态仍保持租户子域名 + path 聚合：

```text
https://wiztek.huizhi.yun/
https://wiztek.huizhi.yun/codocs/
https://wiztek.huizhi.yun/codocs/ws
https://wiztek.huizhi.yun/collab/
```

目标运行时：

```text
Browser
  -> Tenant Gateway Worker
     /codocs/*    -> Codocs Worker
     /codocs/ws   -> Collab Gateway Worker
     /collab/*    -> Collab management routes
     /api/*       -> Console Worker

Codocs Worker
  -> Console OIDC / JWKS
  -> Hyperdrive -> customer hzy_codocs MySQL
  -> Foundation ObjectStorage adapter

Collab Gateway Worker
  -> Durable Object room by tenant + doc id
  -> Foundation-compatible token verification
  -> ObjectStorage snapshot/update persistence
```

产品边界：

| 模块 | 目标职责 |
| --- | --- |
| Platform Dashboard | 管 Codocs 部署、数据库、对象存储集成、Cloudflare 资源、健康状态 |
| Console | 管租户登录、OIDC token、应用入口、service client、integration/vault |
| Foundation | 提供 OIDC、service token、directory、object storage、integration adapter |
| Codocs | 文档业务、目录、分享、审阅、对象级权限、协作 token 签发 |
| Collab Runtime | WebSocket 同步、Yjs update、presence、snapshot/update 持久化 |
| Object Storage | 持久化 Markdown、Yjs snapshot、附件、图片、版本、回收站对象 |

## 2. 为什么 Codocs 不能直接按 Finance/Altoc 方式迁

`finance`、`altoc` 已验证的模式是：

```text
Nuxt Worker + Hyperdrive + Console OIDC + tenant gateway
```

`Codocs` 多了四类复杂度：

1. **实时协同**：Hocuspocus 是 Node WebSocket 服务，不能直接作为普通 Nuxt Worker 部署。
2. **Yjs 状态恢复**：需要稳定处理 update log、snapshot、Markdown mirror，不能只依赖内存。
3. **对象存储依赖重**：现有 Codocs 大量代码直接使用 `ali-oss` Node SDK；Worker 环境不适合继续依赖该 SDK。
4. **对象级权限复杂**：Platform 只能管应用级能力，文档、文件夹、分享、项目空间等细粒度权限仍由 Codocs 判断。

因此迁移要拆成三层：

```text
Codocs App Shell / API  -> Cloudflare Worker
Collab Runtime          -> Durable Objects provider
Object Storage          -> Foundation adapter
```

## 3. 推荐架构

### 3.1 Tenant Gateway 路由

在 `deploy/cloudflare/tenant-gateway` 增加 Codocs 路由：

```text
/codocs/       -> HZY_CODOCS_ORIGIN
/codocs/api/*  -> HZY_CODOCS_ORIGIN
/codocs/ws     -> HZY_COLLAB_ORIGIN
/collab/*      -> HZY_COLLAB_ORIGIN
```

路由原则：

- 非 API 静态资源请求剥离大 Cookie，避免 header 过大。
- `/codocs/api/*` 保留 Cookie 和 Authorization。
- `/codocs/ws` 必须保留 WebSocket upgrade、Authorization、必要 Cookie。
- Console OIDC redirect URI 由 Platform 生成：

```text
https://wiztek.huizhi.yun/codocs/api/auth/oidc-callback
https://wiztek.huizhi.yun/codocs/api/auth/oidc-post-logout
```

### 3.2 Codocs Worker

Codocs Worker 承载：

- 文档列表、详情、创建、复制、删除、版本、审阅 API。
- Milkdown 编辑器页面和应用壳。
- 协作 token 签发 API。
- 对象级权限判断。
- 与 Aims / Altoc 的 service-token API。

Codocs Worker 不承载：

- Hocuspocus Node Server。
- Redis 扩散。
- 本地文件系统持久化。
- `ali-oss` Node SDK 直连。

运行时依赖：

| 依赖 | Cloudflare 形态 |
| --- | --- |
| MySQL | Hyperdrive -> `hzy_codocs` |
| Auth | Console OIDC/JWKS |
| Directory | Foundation `/api/directory/**` -> Console |
| Workflow | Foundation service token -> Workflow/Console runtime config |
| Object storage | Foundation ObjectStorage adapter |
| Collab | `/codocs/ws` -> Collab Durable Object provider |

### 3.3 Collab Durable Objects Provider

在 `collab` 模块中新增 provider：

```text
collab/src/providers/
  hocuspocus.ts
  cloudflare-durable-object.ts
```

对外仍叫 `Collab Runtime`。`hocuspocus` 和 `cloudflare-durable-object` 都只是 provider。

Durable Object 房间命名：

```text
roomId = sha256(`${tenantCode}:${appCode}:${documentUuid}`)
```

或可读形式：

```text
tenant:C000001:codocs:doc:{uuid}
```

房间负责：

- 校验短期 collaboration token。
- 接受 WebSocket。
- 广播 Yjs sync/update。
- 维护 awareness/presence。
- 批量缓存 update。
- 周期性 flush update log。
- 周期性生成 Yjs snapshot。
- 断线后按 snapshot + update log 恢复。

房间不负责：

- 查询文档标题、目录、分享。
- 判断用户是否拥有文档权限的完整业务规则。
- 作为永久大对象存储。

### 3.4 协作鉴权

Codocs Nuxt API 继续签发短期 collaboration token，但 token 的校验方式要 provider 无关。

建议 token claims：

```json
{
  "iss": "https://wiztek.huizhi.yun/codocs",
  "aud": "collab",
  "tenant": "C000001",
  "app": "codocs",
  "doc": "{documentUuid}",
  "uid": "zhouguangying",
  "scope": "collab:read collab:write",
  "readonly": false,
  "exp": 1779486382
}
```

校验要求：

- `aud=collab`
- `tenant` 匹配当前租户
- `doc` 匹配 room
- `uid` 存在
- `scope` 覆盖读写模式
- token 过期时间短，建议 5 到 15 分钟

Provider 不应重新实现 Codocs 文档权限，只信任 Codocs 签发的协作 token。

### 3.5 协作持久化

推荐持久化模型：

```text
ObjectStorage
  codocs/snapshots/{docUuid}/latest.yjs
  codocs/snapshots/{docUuid}/{snapshotId}.yjs
  codocs/markdown/{docPath}.md
  codocs/updates/{docUuid}/{segmentId}.bin

Durable Object SQLite storage
  room metadata
  latest snapshot pointer
  dirty flag
  recent update pointers
  alarm schedule
```

设计原则：

- Durable Object 内存只做在线状态和短期缓冲。
- 大对象写入 ObjectStorage，不长期放 Durable Object storage。
- Yjs update 应批量写入，避免每条消息一次对象存储写。
- Markdown mirror 与 Yjs snapshot 分开保存，避免从 Markdown 反推 Yjs 导致冲突。
- snapshot 生成要有互斥机制，避免多个 flush 并发覆盖。

Flush 策略：

| 触发 | 行为 |
| --- | --- |
| 每 N 秒 dirty | 写 update segment |
| 每 M 个 update segment | compact 成 snapshot |
| 房间空闲 | flush 后 hibernate |
| Durable Object alarm | 兜底 flush/compact |
| 显式保存 | 立即 flush 并返回持久化版本 |

初始建议：

- update flush interval：5 到 10 秒。
- snapshot interval：1 到 5 分钟或 100 到 500 个 update。
- 空闲 flush：最后连接断开后 10 到 30 秒。

## 4. Foundation ObjectStorage Adapter

### 4.1 为什么要放到 Foundation

现状中 Codocs、Collab、头像、资讯、附件等都需要对象存储。若每个模块自己接 `ALIYUN_OSS_*` 和 SDK，会出现：

- Cloudflare Worker 环境不兼容 Node SDK。
- 各模块重复处理 secret。
- Console vault 形同虚设。
- R2、MinIO、阿里 OSS 无法统一切换。
- 业务应用继续膨胀平台级配置。

因此 Foundation 应提供统一对象存储 adapter，Console 负责配置和密钥，业务模块只消费能力。

### 4.2 Adapter 接口

建议新增：

```text
foundation/server/utils/objectStorage.ts
```

核心接口：

```ts
export interface ObjectStorageClient {
  provider: 'aliyun-oss-s3' | 'aliyun-oss-native' | 'cloudflare-r2' | 'minio'
  bucket: string
  getObject(path: string): Promise<ObjectBody>
  putObject(path: string, body: BodyInit, options?: PutObjectOptions): Promise<PutObjectResult>
  headObject(path: string): Promise<ObjectMetadata | null>
  deleteObject(path: string): Promise<void>
  copyObject(sourcePath: string, targetPath: string, options?: CopyObjectOptions): Promise<void>
  listObjects(prefix: string, options?: ListObjectOptions): Promise<ListObjectResult>
  createSignedGetUrl(path: string, options?: SignedUrlOptions): Promise<string>
  createSignedPutUrl(path: string, options?: SignedUrlOptions): Promise<string>
}
```

配置入口：

```ts
getObjectStorage({
  integrationCode: 'oss.default',
  bucketRole: 'default' | 'projects' | 'images' | 'snapshots'
})
```

Codocs 不应直接关心 provider，只关心 bucket role。

### 4.3 Provider 划分

| Provider | 使用场景 | 实现方式 |
| --- | --- | --- |
| `aliyun-oss-native` | Node/self-hosted fallback | `ali-oss` SDK |
| `aliyun-oss-s3` | Cloudflare Worker 访问阿里 OSS | S3-compatible API + signed fetch |
| `cloudflare-r2` | Cloudflare 托管对象存储 | R2 binding 或 S3-compatible API |
| `minio` | 私有化/本地测试 | S3-compatible API |

短期实施建议：

1. 先实现 `aliyun-oss-native`，封装现有 `ali-oss` 行为，替换 Codocs 直接创建 client 的调用点。
2. 再实现 `aliyun-oss-s3`，用于 Codocs Worker / Collab Durable Objects。
3. 最后实现 `cloudflare-r2`，支持新租户选择平台托管对象存储。

### 4.4 阿里 OSS S3 兼容注意事项

阿里 OSS 支持 S3-compatible API，但不是完全等价 AWS S3/R2。

必须处理：

- 只支持 virtual-hosted-style：bucket 必须在 host 中。
- ACL 支持范围有限：`private`、`public-read`、`public-read-write`。
- `ETag` 大小写和 multipart 算法与 S3 不完全一致。
- `x-oss-process` 通过 S3 协议只支持 `image/` 和 `style/`。
- OSS 专有能力仍需 native API 或单独 provider extension。

因此 adapter 不应声称“标准 S3 完全兼容”，而应使用能力标记：

```ts
capabilities: {
  listV2: true,
  multipart: true,
  signedUrl: true,
  nativeImageProcess: 'limited',
  pathStyle: false,
  virtualHostedStyle: true
}
```

### 4.5 Console Integration 配置

`oss.default.config_json` 建议增加 provider 信息：

```json
{
  "provider": "aliyun-oss-s3",
  "bucketName": "wiz-rs",
  "endpoint": "oss-cn-hangzhou.aliyuncs.com",
  "region": "oss-cn-hangzhou",
  "bucketDomain": "cdn.example.com",
  "projectsBucketName": "wiz-rs-projects",
  "projectsEndpoint": "oss-cn-hangzhou.aliyuncs.com",
  "imagesBucketName": "wiz-rs-images",
  "imagesEndpoint": "oss-cn-hangzhou.aliyuncs.com",
  "snapshotsBucketName": "wiz-rs",
  "snapshotsPrefix": "codocs/snapshots",
  "recycleDays": 30
}
```

secret 只保存在 vault：

```text
accessKeySecret -> vault secret
accessKeyId     -> 可放 config_json，也可放 secret payload
```

## 5. Codocs 迁移阶段

### Phase C0：现状保护

目标：Codocs 现网不受影响。

工作：

- 保留现有自有服务器 Codocs + Hocuspocus。
- 保留 `/codocs/` 当前路由。
- 确认 Console OIDC 已能给 Codocs 注册 callback/logout URI。
- 确认 `hzy_codocs` 可通过 Hyperdrive 连接。
- 确认 `oss.default` 已包含 Codocs 默认 bucket、项目 bucket、图片 bucket 配置。

退出条件：

- `finance`、`altoc` Cloudflare 模式稳定。
- Console OIDC 在租户域名下稳定。
- Codocs 未被本轮变更影响。

### Phase C1：对象存储抽象先行

目标：先把存储访问从 Codocs 本地 SDK 中抽出来。

工作：

- 新增 Foundation `ObjectStorage` adapter。
- `foundation/server/utils/ossIntegration.ts` 保留为兼容入口，内部委托新 adapter。
- 将 `codocs/server/utils/oss.ts` 中创建 OSS client 的逻辑改成调用 Foundation adapter。
- 保留 Codocs 的路径规则、docType bucket 选择、元数据语义。
- Collab persistence 也改为同一 adapter。

退出条件：

- Codocs 在 Node/self-hosted 下行为不变。
- `ali-oss` 依赖只出现在 Foundation native provider 或迁移期兼容层。
- Codocs 业务代码不直接读取 `ALIYUN_OSS_*`。

### Phase C2：Codocs OIDC 与 Worker 兼容

目标：Codocs Nuxt 本体具备 Cloudflare Worker 运行条件。

工作：

- 按 `docs/Codocs-Compatibility-Integration-Plan.md` 完成 Console OIDC 主链路。
- 移除或 thin-wrapper Codocs 本地 `useAuth` / `usePermissions` 覆盖。
- 服务端身份读取统一为 `getRequestUid(event)`。
- 业务 API 默认验证 Console JWT。
- 新增 Codocs Cloudflare build config。
- 排查 Node-only 依赖：
  - 文件系统写入
  - native module
  - `ali-oss`
  - long-running task
  - child process
- `/codocs/api/*` 通过 Tenant Gateway 访问 Worker。

退出条件：

- `https://wiztek.huizhi.yun/codocs/` 能加载应用壳。
- OIDC 登录回调成功。
- 文档列表、文档详情、创建、删除、权限检查可用。
- 不开启协作时，普通文档读写可用。

### Phase C3：Collab Durable Objects POC

目标：验证 Cloudflare 协作 provider 可行。

当前状态：

- 已部署 `hzy-collab-codocs-poc` Worker，`/collab/health` 可通过 Tenant Gateway 返回健康状态。
- 已实现 Durable Object room、collaboration token 校验、Yjs sync、awareness 广播和 DO storage 最小 snapshot。
- Tenant Gateway 已对 `/codocs/ws` 做 WebSocket upgrade 直通，避免普通响应重写丢失 `response.webSocket`。
- 已验证 `wss://wiztek.huizhi.yun/codocs/ws` 可完成 Hocuspocus Authenticated 握手。

工作：

- 新建 `collab` Cloudflare Worker package 或 `collab/cloudflare` 子目录。
- 定义 Durable Object namespace/binding：`COLLAB_ROOM`。
- 实现最小 WebSocket room：
  - token 校验
  - WebSocket 接入
  - Yjs update 广播
  - awareness 广播
  - 内存状态恢复
- 接入 ObjectStorage snapshot：
  - load latest snapshot
  - append update segment
  - compact snapshot
- 暂不替换全部 Codocs，只接测试文档。

剩余工作：

- 将当前 DO storage 最小 snapshot 升级为 Foundation ObjectStorage update log + compact snapshot。
- 做双浏览器真实编辑、断线重连、刷新恢复和 readonly 写入拒绝测试。
- 由 Console/Platform runtime config 控制 `hocuspocus` 与 `cloudflare-durable-object` 灰度切换。

退出条件：

- 两个浏览器同时编辑测试文档可同步。
- 刷新页面后可从 snapshot 恢复。
- 房间空闲后不会丢失已保存内容。
- Worker tail/log 可定位 token、room、flush 错误。

### Phase C4：Codocs 协作切流

目标：按租户或文档空间灰度替换 Hocuspocus。

工作：

- Console runtime config 增加：

```json
{
  "collab": {
    "provider": "cloudflare-durable-object",
    "wsUrl": "wss://wiztek.huizhi.yun/codocs/ws"
  }
}
```

- Codocs 编辑器根据 runtime config 选择协作 endpoint。
- Hocuspocus 与 Durable Objects 并行一段时间。
- 新文档优先走 Durable Objects。
- 老文档可按打开时迁移：先从旧 OSS snapshot 读取，再写入新 snapshot 路径。

退出条件：

- 新文档协作默认走 Cloudflare provider。
- 老文档可打开、编辑、保存。
- Hocuspocus 停止后不影响新链路。

### Phase C5：全量托管与产品化

目标：Codocs 成为可由 Platform Dashboard 托管部署的应用。

工作：

- Platform Dashboard 支持：
  - Codocs 数据库连接测试
  - 对象存储连接测试
  - Collab provider 选择
  - Durable Object namespace 状态
  - snapshot 健康检查
  - 文档恢复工具入口
- 租户新开通时自动创建：
  - Hyperdrive
  - Codocs Worker binding
  - Collab Worker binding
  - Durable Object namespace binding
  - ObjectStorage integration

退出条件：

- 新租户无需 SSH 到自有服务器即可开通 Codocs。
- Platform 可查看 Codocs / Collab / ObjectStorage 健康。
- 自有服务器不再需要常驻 Codocs/Hocuspocus PM2 进程。

## 6. 数据与存储迁移

### 6.1 MySQL

Codocs 业务数据库继续使用 `hzy_codocs`，通过 Hyperdrive 访问。

要求：

- 独立数据库。
- 独立最小权限用户。
- TLS。
- schema 版本检查。
- 大批量迁移任务不要在 Worker request 中执行。

### 6.2 OSS 到 ObjectStorage Adapter

第一阶段不迁移对象数据，只迁移访问方式。

```text
原路径不变：
codocs/users/...
codocs/projects/...
codocs/snapshots/...

访问方式变化：
codocs -> ali-oss SDK
改为：
codocs -> Foundation ObjectStorage -> aliyun-oss-native/s3 provider
```

这样可以避免数据搬迁风险。

### 6.3 OSS 到 R2

R2 是后续选项，不是 Codocs 迁 Cloudflare 的前置条件。

适合迁 R2 的场景：

- 新租户选择平台托管对象存储。
- 客户没有现成 OSS。
- 需要减少跨云对象读取延迟。
- 需要和 Durable Objects 同平台运维。

迁移方式：

```text
阿里 OSS -> 批量复制 -> R2
DB oss_path 不变或加 storageProvider 字段
ObjectStorage adapter 按 integrationCode 指向 R2
```

不建议第一阶段把现有 OSS 数据强制搬到 R2。

## 7. 关键文件改造清单

### 7.1 Foundation

新增：

```text
foundation/server/utils/objectStorage.ts
foundation/server/utils/object-storage/
  types.ts
  registry.ts
  providers/aliyunOssNative.ts
  providers/aliyunOssS3.ts
  providers/cloudflareR2.ts
  providers/minio.ts
```

调整：

```text
foundation/server/utils/ossIntegration.ts
docs/FOUNDATION_CAPABILITIES.md
```

### 7.2 Codocs

调整：

```text
codocs/server/utils/oss.ts
codocs/server/utils/ossRuntime.ts
codocs/server/utils/yjsMarkdownRecovery.ts
codocs/server/api/documents/**
codocs/server/api/company-assets/**
codocs/server/api/dept-assets/**
codocs/server/api/project-docs/**
codocs/app/composables/useCollaboration.ts or editor provider config
```

新增：

```text
codocs/scripts/render-cloudflare-config.mjs
codocs/scripts/build-cloudflare.mjs
codocs/.wrangler.generated.jsonc
```

### 7.3 Collab

新增：

```text
collab/src/providers/cloudflare-durable-object.ts
collab/cloudflare/worker.ts
collab/cloudflare/room.ts
collab/cloudflare/wrangler.jsonc
```

调整：

```text
collab/src/providers/index.ts
collab/src/providers/types.ts
collab/src/extensions/persistence.ts
docs/Collab-Runtime-Architecture.md
```

### 7.4 Tenant Gateway

调整：

```text
deploy/cloudflare/tenant-gateway/src/index.js
deploy/cloudflare/tenant-gateway/wrangler.jsonc
deploy/cloudflare/tenant-gateway/README.md
```

新增 env：

```text
HZY_CODOCS_ORIGIN=https://codocs.isme.dev
HZY_COLLAB_ORIGIN=https://collab.isme.dev
```

## 8. 验证清单

### 8.1 Codocs Worker

```bash
curl -I https://wiztek.huizhi.yun/codocs/
curl -I https://wiztek.huizhi.yun/codocs/api/auth/me
curl -I https://wiztek.huizhi.yun/codocs/api/documents
```

期望：

- 页面 200。
- 未登录 API 401。
- 登录后 `api/auth/me` 返回 Console OIDC 用户。
- 创建文档写入 `hzy_codocs`。
- Markdown 内容写入对象存储。

### 8.2 ObjectStorage

验证：

- `putObject` 写普通文档。
- `headObject` 能读取大小、Last-Modified、自定义 meta。
- `getObject` 能恢复 Markdown。
- `copyObject` 能复制版本或转移目录。
- `listObjects` 能列出公司/部门/项目文件。
- signed URL 可访问图片。

阿里 OSS S3 provider 额外验证：

- virtual-hosted-style endpoint 正确。
- path-style 被禁止或不会生成。
- multipart ETag 不作为内容一致性唯一依据。
- `x-oss-meta-*` 元数据读写正常。

### 8.3 Collab Durable Objects

验证：

- 单用户打开编辑器。
- 双用户实时同步。
- presence 显示。
- 断线重连。
- 页面刷新后恢复。
- 房间空闲后恢复。
- snapshot compact 后恢复。
- token 过期后拒绝新连接。
- readonly token 不能写入。

### 8.4 灰度切换

验证：

- 同一租户可配置 `hocuspocus` 或 `cloudflare-durable-object`。
- 单文档或单空间可定向到新 provider。
- 回滚到 Hocuspocus 时不会丢失最新 snapshot。
- 迁移期间新旧 provider 不同时写同一份活动 update log。

## 9. 风险与控制

| 风险 | 表现 | 控制 |
| --- | --- | --- |
| Yjs update 丢失 | 刷新后内容回退 | update segment + snapshot 双写，flush alarm 兜底 |
| 并发覆盖 Markdown | 协作中旧内容覆盖新内容 | Markdown mirror 只从 Yjs snapshot 派生，不作为实时源 |
| Worker 不兼容 `ali-oss` | 构建或运行失败 | Foundation adapter 中 Worker 使用 S3 signed fetch provider |
| OSS S3 差异 | 签名、ACL、ETag 异常 | provider capabilities + 独立测试 |
| Cookie/header 过大 | 400/502 | Tenant Gateway 对静态资源剥离 Cookie |
| WebSocket 国内质量不稳定 | 协作延迟或断线 | 先灰度、保留 Hocuspocus fallback |
| 数据库延迟 | 文档列表慢 | Hyperdrive + API 缓存 + 分页 |
| 跨 provider 回滚丢数据 | 新旧 runtime 写不同存储 | 切换时锁定文档写入源，先 flush 后切换 |

## 10. 决策记录

| 决策 | 结论 |
| --- | --- |
| Codocs 是否迁 Cloudflare | 可以，但分阶段迁 |
| Codocs Nuxt 与协同是否同 Worker | 不同 Worker/Provider，避免耦合 |
| 协同目标 provider | Cloudflare Durable Objects |
| 是否立即放弃 Hocuspocus | 不立即，先并行 POC |
| 对象存储是否进入 Foundation | 是，做通用 ObjectStorage adapter |
| 阿里 OSS 是否走 S3 API | Worker 环境优先走 S3-compatible provider，Node 环境可保留 native provider |
| 是否立即迁 R2 | 不作为前置条件，后续新租户可选 |
| 文档对象权限是否迁 Platform | 不迁，仍由 Codocs 判断 |

## 11. 近期执行建议

1. 先实现 Foundation `ObjectStorage` native provider，替换 Codocs 直接创建 OSS client 的代码。
2. 补 `aliyun-oss-s3` provider，用 Cloudflare Worker 环境验证 `Get/Put/Head/List/Copy/Delete`。
3. 给 Codocs 增加 Cloudflare build 配置，但先不切生产路由。
4. 新建 Collab Durable Objects POC，只接一个测试文档。
5. Tenant Gateway 增加 `/codocs/` 与 `/codocs/ws` 路由，但先指向 staging origin。
6. Codocs 按 `Codocs-Compatibility-Integration-Plan.md` 完成 Console OIDC 主链路。
7. 做一次端到端灰度：登录 -> 文档列表 -> 打开测试文档 -> 双人协作 -> 保存 -> 刷新恢复。
8. 再决定 Codocs 全量迁 Cloudflare 的窗口。
