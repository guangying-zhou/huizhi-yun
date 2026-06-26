# ADR-014: Managed Cloud Agent 与部署 Profile 收敛

状态：Accepted  
日期：2026-05-24  
决策范围：Cloudflare 托管应用、客户侧 Data Runtime Agent、Self-hosted、Hyperdrive 过渡、D1 后续形态，以及 Platform 数据库边界

## 1. 背景

汇智云的运行形态已经从“企业自行部署完整应用栈”转向“平台方托管应用运行时，企业自管数据面”。`platform`、`console`、`codocs`、`workflow`、`aims` 等模块逐步迁到 Cloudflare Workers 后，原先以每个企业自行部署全部应用为默认路径的假设不再成立。

同时，Cloudflare Hyperdrive 的 configured databases 数量限制不适合作为长期多租户默认模型；如果每个租户、每个应用都创建独立 Hyperdrive config，平台会过早碰到账号配额和配置管理瓶颈。另一方面，部分企业没有公网 IP 或不愿开放数据库端口，要求平台应用不能直接访问企业数据库。

因此需要收敛部署 profile，并明确哪些组件属于租户业务数据面，哪些组件属于平台控制面。

## 2. 决策

采用一套产品内核，多种部署 profile。默认企业 SaaS 交付主线为 `managed-cloud-agent`，高安全客户使用 `self-hosted`，Hyperdrive 作为过渡，D1 作为后续轻量/海外全托管选项。

### 2.1 租户 Workload 部署 Profile

| Profile | 定位 | 应用运行时 | 数据访问路径 | 状态 |
| --- | --- | --- | --- | --- |
| `dev` | 本地开发 | 本地 Nuxt/dev-stack | 本地 MySQL 或 mock runtime | 内部 |
| `managed-cloud-agent` | 默认企业 SaaS 模式 | Cloudflare Workers | Worker -> Data Runtime Agent -> 客户数据库 | 主推 |
| `self-hosted` | 企业全栈私有化 | 客户侧服务器/内网 | 本地应用直连本地数据面 | 主推 |
| `managed-cloud-direct-db` | 早期验证和迁移期 | Cloudflare Workers | Worker -> Hyperdrive -> 客户 MySQL | 过渡 |
| `managed-cloud-d1` | 后续轻量/海外全托管 | Cloudflare Workers | Worker -> D1 | 后续 |

`managed-cloud-agent` 下，Cloudflare 上可以保持“一套 Tenant Gateway + 一套 Console/业务 App Worker 服务多个租户”。租户差异体现在运行时配置、Agent endpoint、policy bundle、service token 和数据面连接上，而不是体现在每个租户单独部署一套应用代码。

### 2.2 Platform 数据库 Profile

`platform` 是平台控制面，不属于租户 workload 数据面，必须从 Data Runtime Agent 覆盖范围中排除。Agent 可覆盖租户侧 `console` supporting runtime 与业务应用的数据访问，但不得覆盖 Platform 控制面数据库。

| Platform DB Profile | 用途 | 说明 |
| --- | --- | --- |
| `platform-cloud-db` | 平台侧托管或混合模式 | Platform 连接平台侧 MySQL/Hyperdrive 等数据库 |
| `platform-self-hosted-db` | 企业独立部署 | Enterprise self-hosted 时 Platform 使用客户本地平台库 |
| `platform-d1` | 后续轻量/海外控制面 | Platform 可独立评估 D1，不影响租户业务 Agent 模式 |

强约束：

- Data Runtime Agent 覆盖租户 workload 数据面，包括租户侧 `console` supporting runtime 与业务应用。
- Platform 不通过 Agent 访问数据库。
- Agent 不承担租户、订阅、license、bundle、Cloudflare 资源、运营账户等 Platform 控制面数据职责。
- Enterprise self-hosted 时，Platform 可随整套系统部署到客户环境，但仍然使用 Platform 自己的数据库 profile，而不是 Agent。

## 3. Data Runtime Agent 定位

Agent 是客户侧轻量数据面服务，不是 SQL 代理。

推荐部署形态：

```text
hzy-data-runtime
  一个二进制
  一个 Docker 镜像
  一个配置文件
  一个 systemd service 或 compose service
```

内部按应用拆分 adapter，但客户只部署一个 package：

```text
cmd/hzy-data-runtime/
internal/server/
internal/auth/
internal/config/
internal/db/
internal/health/
internal/apps/console/
internal/apps/finance/
internal/apps/assets/
internal/apps/aims/
internal/apps/codocs/
internal/apps/workflow/
```

Agent 对外只暴露业务 API，例如：

```text
/v1/finance/invoices
/v1/console/directory/users
/v1/assets/assets
/v1/aims/projects
/v1/codocs/documents
/runtime/health
/runtime/schema/status
```

不得暴露通用 SQL 接口，例如：

```text
/query
{ "sql": "select ..." }
```

原因：

- SQL over REST 会破坏权限、审计、事务和 schema 版本边界。
- 业务 API 才能承载稳定契约、批量查询、分页、权限语义和错误码。
- Agent 需要贴近数据库执行事务、migration 和最小权限检查，而不是成为透明数据库转发器。

## 4. 网络模式

Agent 支持三种网络模式，按以下优先级实施：

| 模式 | 说明 | 阶段 |
| --- | --- | --- |
| `cloudflare_tunnel` | Agent 所在服务器运行 `cloudflared`，主动建立 outbound-only tunnel | 第一版主推 |
| `direct_https` | 客户已有公网域名/API 网关，Worker 直接 HTTPS 调用 Agent | 第一版支持 |
| `platform_relay` | Agent 主动建立 WebSocket/HTTP2 长连接到平台 Relay | 后续增强 |

第一版主推 `cloudflare_tunnel`，因为它可以覆盖客户没有公网 IP、不能开放入站端口、只有内网服务器的场景。

约束：

- 一个租户最多一个 Agent endpoint。
- 不按应用创建 Tunnel 或 Agent endpoint。
- 应用维度在 Agent API path、service token scope 和内部 adapter 中隔离。
- Cloudflare Tunnel 默认账号限制接近阈值时，再评估购买额度、账号分片或自研 `platform_relay`。

## 5. 运行时调用链路

`managed-cloud-agent` 的典型链路：

```text
Browser
  -> Tenant Gateway Worker
     -> 解析租户域名或客户自定义域名
     -> 注入已签名租户上下文
  -> Console/Business App Worker
     -> 读取 tenant + app runtime config
     -> 获取短期 service token
  -> hzy-data-runtime Agent
     -> 校验 token/JWKS/tenant/app/scope
     -> 调用对应 app adapter
     -> 访问客户本地数据库
```

Platform 不应进入业务请求热路径。Gateway 和 Console/Business App Worker 读取路由、Agent endpoint、policy bundle 和 JWKS 时，应优先使用边缘缓存或本地缓存；Platform 负责配置发布、签名、同步和审计。

## 6. 认证与授权

Console/Business App Worker 调用 Agent 必须使用短期 service token。

Token 至少包含：

```text
tenant
deployment
appCode
aud=data-runtime
scope
policyVersion
exp
```

Agent 必须校验：

- Console/Platform JWKS。
- `aud=data-runtime`。
- `tenant` 与 Agent enrollment 绑定租户一致。
- `appCode` 已在本 Agent 启用。
- `scope` 覆盖对应业务 API。
- token 未过期，且 policy/bundle 版本在兼容窗口内。

Gateway 注入的租户上下文必须签名；Console/Business App Worker 不得信任未经签名或未经校验的 `x-hzy-tenant`。

## 7. Schema 与版本兼容

Agent 是客户数据库 schema migration 的执行点。

Agent 至少提供：

```text
/runtime/schema/status
/runtime/schema/dry-run
/runtime/schema/migrate
```

约束：

- Platform 可以触发 migration 任务，但不得直接连接客户租户 workload 数据库执行 migration。
- Agent 执行 migration 前必须检查数据库类型、当前 schema version、权限、备份提示和 dry-run 结果。
- Console/Business App Worker 与 Agent 必须保留兼容窗口，推荐支持当前版本和前两个 minor 版本。
- 不兼容时应阻止应用升级或降级功能，而不是让请求在运行期随机失败。

## 8. 失败模式与审计

系统必须能区分以下失败：

- Agent offline。
- Tunnel offline。
- DB offline。
- service token 过期或 scope 不足。
- schema version mismatch。
- policy bundle version mismatch。
- permission denied。

Agent 审计日志至少记录：

```text
requestId
tenant
appCode
subject/service client
operation
resource
duration
result
errorCode
```

默认不得记录敏感请求体、数据库密码、Authorization header 或用户输入明文。

## 9. Hyperdrive 与 D1 的定位

`managed-cloud-direct-db` 使用 Hyperdrive 连接客户 MySQL，只作为过渡模式：

- 用于现有 Cloudflare PoC、早期客户和 Agent 尚未稳定前的迁移。
- 不作为长期大规模默认模型，也不作为新租户默认路径。
- Agent 自动更新稳定后，新开发/测试/企业 SaaS 环境应直接使用 `managed-cloud-agent`，避免长期维护 Direct DB 与 Agent 两套数据访问实现。
- 现有 Hyperdrive 配置只作为历史租户迁移和应急回退手段保留；业务模块完成 Agent adapter 覆盖后，再删除对应直接数据库访问代码。

`managed-cloud-d1` 作为后续平台全托管业务数据库模式：

- 主要面向海外客户、低数据安全要求客户、试用版或轻量全托管套餐。
- 不打断当前 MySQL 主线。
- 需要单独处理 SQLite/D1 方言、schema migration 和数据导入导出。

## 10. 技术栈建议

Agent 主栈建议使用 Go：

- 单二进制，客户侧部署和升级简单。
- 资源占用低，适合长期运行。
- `database/sql` 适合抽象 MySQL、Postgres、SQLite/libSQL 等 provider。
- 连接池、超时、并发、健康检查和 Docker 镜像交付成熟。
- 安装器默认写入 systemd timer，每 5 分钟主动检查 R2 `latest` 包；更新过程只下载、校验、替换 Agent 二进制并重启服务，不执行平台下发的任意 shell 命令。

Python 可用于内部工具、导入脚本和 PoC，但不作为 Agent 在线服务的默认主栈。

## 11. 影响

正向影响：

- 一套 Cloudflare Console/业务应用可以服务多个租户。
- 客户数据库不需要公网暴露给 Cloudflare Workers。
- 避免 Hyperdrive configured databases 数量成为长期瓶颈。
- 企业仍可自管数据，平台仍掌握应用运行时和发布节奏。
- Self-hosted 与 Agent 模式共享业务 API 契约和数据 adapter 逻辑。

代价：

- 新增一个客户侧基础设施组件，需要安装、升级、诊断和审计能力。
- App Worker 与 Agent 之间要维护 API 版本兼容；自动更新降低先升级 Agent 再部署 Worker 的人工成本，但不能替代向后兼容窗口。
- 业务 API 需要批量化设计，不能按数据库细粒度调用拆成大量远程请求。
- Platform Dashboard 需要管理 Agent enrollment、Tunnel 状态、schema 状态和健康检查。

## 12. 实施顺序

1. 将部署 profile 写入 Platform / Console / Foundation 运行时契约。
2. 固化 Hyperdrive 路径为 `managed-cloud-direct-db` 过渡 profile。
3. 设计 `hzy-data-runtime` enrollment、配置、健康检查和 service token 校验。
4. 选 `finance` 或 `assets` 做 Agent PoC。
5. 在 Platform Dashboard 增加 Agent enrollment、Tunnel 状态、schema 状态和健康检查。
6. 为 Agent 增加本机自动更新能力，默认每 5 分钟检查 R2 `latest` 包。
7. 支持租户从 Hyperdrive 切换到 Agent。
8. Agent 稳定后，把 `managed-cloud-agent` 设为企业 SaaS 默认模式，并停止为新租户使用 `managed-cloud-direct-db`。
9. 后续再独立评估 `managed-cloud-d1`。

## 13. 不做事项

- 第一版不做自研 `platform_relay`，先用 Cloudflare Tunnel 和 direct HTTPS。
- 第一版不做插件系统，Agent 采用一个 deployable 内置多 app adapter。
- 不把 Platform 数据库纳入 Agent。
- 不暴露 SQL over REST。
- 不把 D1 作为当前国内企业客户的默认数据库模式。
