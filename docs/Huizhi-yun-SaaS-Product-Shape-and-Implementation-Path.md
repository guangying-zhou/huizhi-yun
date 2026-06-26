# 汇智云最终产品形态与实现路径指引

状态：Draft  
日期：2026-05-23  
定位：产品形态与落地路线指引，作为 Platform / Console / Cloudflare 托管应用改造的上层决策文档

## 0. 文档目的

本文回答一个问题：

**汇智云如果走向真正的 SaaS 产品形态，应该如何组织域名、控制面、租户运行时、业务应用和客户数据面。**

本文定义：

- 最终用户访问形态
- Platform / Dashboard / Console / 业务应用的职责边界
- Cloudflare 托管应用的推荐落地路径
- 客户自有 MySQL 数据面的接入原则
- 协同服务、Workers for Platforms、Cloudflare for SaaS 的引入时机
- 从当前自有服务器 + PM2 部署向目标形态迁移的阶段路线

本文不定义：

- 完整 DDL
- 完整 API OpenAPI 规范
- 具体 Cloudflare 账号、Zone、Worker 名称
- 单个模块的页面和交互细节

相关文档：

- `docs/ADR-014-Managed-Cloud-Agent-and-Deployment-Profiles.md`
- `docs/Huizhi-yun-Platform-Target-Architecture.md`
- `docs/Unified-Domain-Deployment-Plan.md`
- `docs/Platform-Console-Boundary-and-Entry-Plan.md`
- `docs/Control-Plane-API-Contract.md`
- `docs/Collab-Runtime-Architecture.md`
- `docs/Codocs-Cloudflare-Migration-Plan.md`

## 1. 核心结论

汇智云的目标形态应从“多个应用部署在一台自有服务器上”演进为：

```text
Platform Control Plane
  管租户、订阅、应用、部署、域名、数据库连接、Cloudflare 资源和运维状态

Tenant Console
  管企业内部用户、权限、登录、应用入口、服务授权和租户运行时

Business Apps
  尽量作为轻量运行时部署到 Cloudflare Workers

Customer Data Plane
  默认由客户侧 Data Runtime Agent 访问租户 workload 的 MySQL / OSS / Git / 其他数据资源
```

产品访问形态：

```text
平台官网和平台后台：
https://huizhi.yun/
https://huizhi.yun/admin
https://huizhi.yun/dashboard

租户统一入口：
https://wiztek.huizhi.yun/

租户应用：
https://wiztek.huizhi.yun/finance/
https://wiztek.huizhi.yun/altoc/
https://wiztek.huizhi.yun/assets/
https://wiztek.huizhi.yun/aims/
https://wiztek.huizhi.yun/codocs/
```

第一阶段不要求每个租户独立自定义域名。先使用 `{tenantSlug}.huizhi.yun` 作为标准租户空间。后续再支持客户自有域名：

```text
https://cloud.wiztek.cn/ -> https://wiztek.huizhi.yun/
```

## 2. 产品域名模型

### 2.1 平台域名

`huizhi.yun` 是平台自身域名，承载产品官网、注册、登录、平台控制台和租户管理台。

建议入口：

| URL | 角色 | 职责 |
| --- | --- | --- |
| `https://huizhi.yun/` | 访客 | 产品官网、介绍、转化入口 |
| `https://huizhi.yun/login` | 平台用户 | 平台控制面登录 |
| `https://huizhi.yun/admin` | 平台运营方 | 跨租户、跨部署、跨应用治理 |
| `https://huizhi.yun/dashboard` | 租户管理员 | 本租户资源、应用、部署、数据源管理 |

### 2.2 租户域名

每个租户有一个标准子域名：

```text
https://{tenantSlug}.huizhi.yun/
```

示例：

```text
https://wiztek.huizhi.yun/
```

该域名是租户工作空间的唯一正式入口。租户内应用通过 path 挂载：

```text
/            -> Console / Portal
/finance/    -> Finance
/altoc/      -> Altoc
/assets/     -> Assets
/aims/       -> Aims
/codocs/     -> Codocs
/workflow/   -> Workflow runtime or workflow UI
/collab/     -> Collab runtime, if exposed
```

### 2.3 客户自定义域名

客户自定义域名是增强能力，不是第一阶段必需能力。

目标支持：

```text
https://cloud.wiztek.cn/
https://work.customer.com/
```

客户自定义域名接入后仍然映射到同一租户：

```text
cloud.wiztek.cn -> tenantSlug = wiztek
```

接入自定义域名时需要 Cloudflare for SaaS / Custom Hostnames 这类能力处理客户域名、证书、CNAME 验证和 fallback origin。

## 3. 分层职责

### 3.1 Platform / Dashboard

Platform 是平台控制面，Dashboard 是租户管理员面。它们负责“资源和部署”，不负责企业员工日常业务操作。

职责：

- 租户开通、冻结、停用
- 租户子域名和自定义域名管理
- 应用开通、停用、版本选择
- 托管模式选择：Cloudflare 托管、自有服务器、混合模式
- 客户侧 Data Runtime Agent enrollment、Tunnel、健康状态和 schema 状态管理
- 客户数据库连接测试、TLS 校验、最小权限检查的编排与结果展示
- Worker / Durable Object / R2 / Hyperdrive 等 Cloudflare 资源编排，其中 Hyperdrive 仅作为过渡模式
- 部署任务、部署记录、健康检查
- 应用运行时配置下发
- 租户级密钥、连接凭证、轮换记录
- 计费、订阅、能力包、用量粗聚合

不负责：

- 企业内部用户日常登录
- 业务应用逐请求鉴权
- 业务数据读写
- 通过客户侧 Agent 访问 Platform 控制面数据库
- 企业内部组织协作入口

### 3.2 Console

Console 是租户侧运行时控制台和企业工作台。

职责：

- 企业用户登录和 OIDC 签发
- 企业用户、部门、角色、权限
- 应用入口聚合
- 租户内应用运行配置读取
- 服务端 token / service client 授权
- 工作流、协同等平台内置能力入口
- 轻量待办、通知、个人入口

不负责：

- Cloudflare Worker 创建
- Hyperdrive 创建
- 数据库密码编辑
- 租户域名接入
- 应用部署版本管理

Console 可以展示只读状态：

```text
财务应用：已托管到 Cloudflare，数据库连接正常，版本 v2026.05.23
```

但编辑和修复动作应跳转到 Platform Dashboard。

### 3.3 Business Apps

业务应用负责具体业务能力，不直接管理平台资源。

典型应用：

- Finance
- Altoc
- Assets
- Aims
- Codocs
- Insights

业务应用运行时只应消费：

- Console 签发的用户 token
- Console / Platform 下发的 app runtime config
- 本应用数据面访问能力，默认通过客户侧 Data Runtime Agent，过渡期可通过 Hyperdrive 直连客户 MySQL
- 本应用对象存储、外部集成或服务端 token

业务应用不应新增平台级账号、跨模块静态密钥或绕过 Console 的认证逻辑。

### 3.4 Customer Data Plane

客户数据面是客户提供或指定的数据基础设施。

主推模式下，客户侧部署一个 `hzy-data-runtime` Agent，Agent 贴近数据库与对象存储，Cloudflare 上的 Console supporting runtime 与业务应用通过业务 API 调用 Agent。Agent 不是 SQL 代理，不暴露 `/query`，只暴露按应用命名空间划分的业务 API、健康检查和 schema 管理 API。Platform 控制面数据库不纳入 Agent 覆盖范围。

第一阶段重点支持：

- MySQL 8.0+
- TLS 连接
- 每个应用独立数据库
- 每个应用独立最小权限账号
- Cloudflare Tunnel 作为默认无公网入口连接方式

推荐数据库拆分：

```text
hzy_console
hzy_workflow
hzy_finance
hzy_altoc
hzy_assets
hzy_aims
hzy_codocs
```

账号授权示例：

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON hzy_finance.* TO 'cf_app'@'%';
```

生产建议：

- 不使用 root
- 不共用全库账号
- 开启 TLS
- 优先要求 `require_secure_transport=ON`
- 通过 Cloudflare Tunnel、direct HTTPS、mTLS、防火墙、访问控制或专线方案限制来源
- 数据库备份、慢查询、容量告警由客户或托管服务承担

部署 profile 以 ADR-014 为准：

| Profile | 定位 | 数据访问路径 |
| --- | --- | --- |
| `managed-cloud-agent` | 默认企业 SaaS 模式 | Worker -> Data Runtime Agent -> 客户租户 workload 数据库 |
| `self-hosted` | 高安全企业版 | 客户侧应用直连客户侧数据面 |
| `managed-cloud-direct-db` | 过渡模式 | Worker -> Hyperdrive -> 客户 MySQL |
| `managed-cloud-d1` | 后续轻量/海外全托管 | Worker -> D1 |

## 4. Cloudflare 实现策略

### 4.1 第一阶段：普通 Workers + 租户网关

第一阶段不需要立即使用 Workers for Platforms。

推荐模型：

```text
*.huizhi.yun/*
  -> Tenant Gateway Worker
  -> 解析 hostname 得到 tenantSlug
  -> 查询 Platform 租户路由配置
  -> 按 path 分发到具体应用 Worker 或自有服务器 origin
```

示例：

```text
wiztek.huizhi.yun/finance/
  -> tenant = wiztek
  -> app = finance
  -> runtime = cloudflare
  -> worker/custom domain = finance runtime
```

这一阶段目标是验证：

- 租户子域名访问模型
- Console 登录闭环
- 应用 path baseURL
- Console token 跨 Cloudflare 应用验证
- Hyperdrive 连接客户 MySQL 的过渡路径
- Data Runtime Agent + Cloudflare Tunnel 的主推路径
- Platform Dashboard 能管理部署参数

### 4.2 第二阶段：Platform 自动编排 Cloudflare

当手工部署 `finance`、`altoc` 跑通后，Platform Dashboard 应提供自动化能力。

核心动作：

1. 创建或选择租户
2. 选择 deployment profile
3. Agent enrollment 或录入过渡期数据库连接
4. 测试 Agent、Tunnel、MySQL TLS、schema 与权限
5. 渲染 Worker 运行时配置
6. 部署应用 Worker 或更新统一 Worker 的租户 runtime config
7. 绑定租户路由
8. 回写应用、Agent、Tunnel、schema 和数据面健康状态

逻辑资源模型：

```text
tenant_sites
tenant_domains
tenant_app_deployments
tenant_data_sources
tenant_data_agents
tenant_runtime_bindings
tenant_deployment_tasks
tenant_connectivity_checks
cloudflare_workers
cloudflare_hyperdrives
cloudflare_tunnels
```

其中数据库密码等敏感字段应优先保留在客户侧 Agent；过渡期 direct-db 模式如需保存，应加密保存，或在创建 Hyperdrive 后只保存引用 ID 和轮换记录。

### 4.3 第三阶段：Workers for Platforms

当出现以下条件时，再引入 Workers for Platforms：

- 租户数量明显增长
- 每个租户需要独立 Worker 实例
- 每个租户有不同应用版本
- 需要 per-tenant CPU / subrequest 限制
- 需要集中管理大量客户 Worker
- 需要按租户导出日志、指标和运行状态
- 未来允许客户自定义扩展代码

Workers for Platforms 的价值是把“每个客户 Worker”放进 dispatch namespace，并通过 dynamic dispatch Worker 做统一入口、鉴权、限流、观测和分发。

不要在第一阶段直接上 Workers for Platforms。第一阶段用普通 Worker 跑通产品闭环，复杂度更低。

### 4.4 第四阶段：Cloudflare for SaaS

当需要支持客户自定义域名时，引入 Cloudflare for SaaS / Custom Hostnames。

示例：

```text
cloud.wiztek.cn CNAME tenant.huizhi.yun
```

Platform Dashboard 负责：

- 创建 custom hostname
- 生成 DNS 指引
- 跟踪证书验证状态
- 显示接入状态
- 允许停用或迁移自定义域名

第一阶段只需要 `*.huizhi.yun`，不必立即引入客户自定义域名。

## 5. 应用迁移分级

### 5.1 优先迁移到 Cloudflare 的应用

适合条件：

- 主要是 Nuxt 页面 + Nitro API
- API 主要访问 MySQL
- 无强实时协同
- 无复杂本地文件系统依赖
- 可通过 Console token 完成认证

优先级：

1. Finance
2. Altoc
3. Assets
4. Aims
5. Insights 前端或轻量 API

### 5.2 暂缓迁移的应用

Codocs / Collab / Workflow 应渐进处理。

Codocs 风险：

- 文档协同
- Yjs / Hocuspocus
- WebSocket 长连接
- OSS 持久化
- 文档快照和权限边界

Workflow 风险：

- 平台基础能力
- 回调和审批动作同步
- 与 Console token、业务模块紧密耦合

建议：

- Workflow 短期继续作为 Console 同源或近源平台能力
- Codocs 短期保留自有服务器
- Collab 单独做 Cloudflare Durable Objects POC

## 6. 协同服务路线

协同服务可以上 Cloudflare，但不应按普通 Nuxt 应用迁移。

目标模型：

```text
Browser
  -> /collab/ws?docId=...
  -> Tenant Gateway Worker
  -> Durable Object by docId
  -> Yjs / Hocuspocus sync
  -> Snapshot / Update log persistence
```

建议阶段：

1. 保留当前 Console 内嵌 Hocuspocus 或 standalone collab runtime
2. 建立 Durable Object 文档房间 POC
3. 验证 Console JWT 鉴权
4. 验证 Yjs update 批量写入和 snapshot
5. 验证国内网络质量和延迟
6. 再决定是否替换当前 Hocuspocus runtime

关键约束：

- Durable Object 内存不是最终存储
- 必须设计 snapshot 和 update log
- 高频消息必须批量处理
- 文档房间生命周期和清理策略要明确

## 7. 认证与 Cookie 策略

### 7.1 租户内统一登录

每个租户子域名下共享登录态：

```text
https://wiztek.huizhi.yun/
https://wiztek.huizhi.yun/finance/
https://wiztek.huizhi.yun/altoc/
```

Console 作为该租户的 OIDC issuer 和 session 管理者。

业务应用只验证 Console JWT，不自行维护独立登录体系。

### 7.2 Cookie 域

Cookie 作用域必须限定在租户子域名：

```text
Domain = wiztek.huizhi.yun
```

不要使用：

```text
Domain = .huizhi.yun
```

原因：

- 避免租户之间 Cookie 污染
- 避免跨租户 session 混淆
- 降低权限错误和调试复杂度

### 7.3 Redirect URI

每个应用的 callback URL 由 Platform 根据租户站点和 app basePath 生成：

```text
https://wiztek.huizhi.yun/finance/api/auth/oidc-callback
https://wiztek.huizhi.yun/altoc/api/auth/oidc-callback
```

业务应用不得手写 `localhost` 或固定域名。

## 8. 数据库接入规范

Platform Dashboard 提供数据库连接配置页。

字段：

```text
host
port
database
username
password
sslEnabled
sslRejectUnauthorized
caCertificate optional
connectionLimit
```

连接测试必须检查：

- DNS 可解析
- TCP 可连接
- MySQL 认证成功
- 当前连接是否使用 TLS
- 用户是否具备目标库最小权限
- 是否误用 root
- 是否错误授权到全库
- 当前应用数据库是否存在
- schema 版本是否满足应用要求

测试结果示例：

```text
连接：通过
TLS：通过，TLSv1.3
账号：通过，cf_app
权限：通过，hzy_finance.* CRUD
风险：require_secure_transport=OFF，建议开启
```

## 9. 部署与发布策略

### 9.1 应用版本

Platform 管理应用版本：

```text
finance@2026.05.23.1
altoc@2026.05.23.1
```

租户部署引用版本：

```text
tenant = wiztek
app = finance
version = 2026.05.23.1
runtime = cloudflare
```

### 9.2 灰度与回滚

每个租户部署应支持：

- 当前版本
- 上一版本
- 部署状态
- 回滚动作
- 部署日志
- 健康检查结果

第一阶段可简化为手工回滚 Worker version。产品化后由 Platform Dashboard 操作。

### 9.3 健康检查

每个应用至少提供：

```text
GET /api/health
GET /api/runtime/config/status
```

健康检查内容：

- Worker 可访问
- Console config 可读取
- DB 可连接
- 当前 appCode / tenantCode 正确
- 当前 policy bundle 版本
- 当前 app version

## 10. 分阶段路线

### Phase 0：现状收敛

目标：减少自有服务器压力，停止无意义 CI/CD 和多余 PM2 进程。

工作：

- 自有服务器默认只保留 Console / Workflow / Codocs / Collab 等必要能力
- Finance / Altoc 继续验证 Cloudflare 托管
- 补齐 staging/local 运维文档
- 明确 Platform / Console 边界

退出条件：

- `finance` 和 `altoc` 在 Cloudflare 上可稳定访问
- Console 登录和业务应用 token 验证可用
- 客户 MySQL + Hyperdrive 过渡路径可用
- Data Runtime Agent 初版契约明确

### Phase 1：租户子域名网关

目标：跑通 `tenant.huizhi.yun/app/`。

工作：

- 配置 `*.huizhi.yun`
- 建立 Tenant Gateway Worker
- Platform 增加 tenant site / domain / route 配置
- Console 支持租户子域名 issuer / callback URL
- Finance / Altoc 迁移到 `wiztek.huizhi.yun/finance/` 和 `/altoc/`

退出条件：

- `wiztek.huizhi.yun/` 能进入 Console
- `wiztek.huizhi.yun/finance/` 能登录并读取数据
- `wiztek.huizhi.yun/altoc/` 能登录并读取数据

### Phase 2：Platform Dashboard 托管配置

目标：不再手工改 wrangler/env/Caddyfile。

工作：

- Dashboard 增加应用部署页
- Dashboard 增加 Agent enrollment、数据库连接和 schema 状态页
- Dashboard 增加 Cloudflare 资源状态页
- 支持 Agent + Cloudflare Tunnel 主路径
- 保留自动创建 Hyperdrive 作为过渡路径
- 自动渲染 Worker config
- 自动部署或触发部署任务
- 回写健康检查状态

退出条件：

- 租户管理员可以在 Dashboard 完成 Finance Agent 接入或 Hyperdrive 过渡接入
- 平台管理员可以一键部署或重部署 Finance / Altoc
- 错误能在 Dashboard 上定位到 Agent / Tunnel / DB / Auth / Worker / Route 层

### Phase 3：业务应用批量迁移

目标：把普通 CRUD 型业务应用迁到 Cloudflare。

顺序：

1. Finance
2. Altoc
3. Assets
4. Aims
5. Insights 轻量部分

退出条件：

- 自有服务器 PM2 业务应用数量明显下降
- 业务应用部署方式统一
- 新租户开通不依赖人工 SSH 到服务器

### Phase 4：协同能力 POC

目标：验证 Codocs / Collab 的 Cloudflare 可行性。

工作：

- Durable Object 文档房间 POC
- Yjs update sync
- snapshot 持久化
- Console JWT 鉴权
- 网络质量评估
- 成本估算

退出条件：

- 明确 Codocs 是否迁 Cloudflare
- 明确 Hocuspocus v4 / 自研 Yjs DO / 保留自有服务器三者取舍

### Phase 5：Workers for Platforms 与客户自定义域名

目标：规模化。

工作：

- 引入 Workers for Platforms dispatch namespace
- Dynamic Dispatch Worker 接管租户分发
- per-tenant Worker 管理
- per-tenant limits
- Cloudflare for SaaS Custom Hostnames
- 客户自定义域名接入流程

退出条件：

- 可支撑大量租户应用实例
- 客户自定义域名可自助接入
- 平台具备完整 SaaS 运维面

## 11. 关键决策记录

| 决策 | 结论 |
| --- | --- |
| 租户入口 | 每个租户一个 `{tenantSlug}.huizhi.yun` |
| 应用入口 | 租户域名下按 path 聚合 |
| Platform 职责 | 管租户、部署、资源、数据库、Cloudflare |
| Console 职责 | 管企业用户、权限、登录、应用入口、运行时授权 |
| 业务应用 | 优先部署到 Cloudflare Workers |
| 数据库 | 主推 Data Runtime Agent 访问客户自有租户 workload MySQL；Hyperdrive 为过渡；D1 为后续轻量/海外全托管 |
| Platform 数据库 | 不纳入 Agent 覆盖范围，使用独立 platform DB profile |
| Workers for Platforms | 不作为第一阶段前提，规模化后引入 |
| Cloudflare for SaaS | 仅在客户自定义域名阶段引入 |
| Codocs / Collab | 渐进 POC，不按普通应用直接迁移 |
| Cookie | 租户子域名级，不使用 `.huizhi.yun` 全局 Cookie |

## 12. 风险与待验证项

### 12.1 网络与区域

Cloudflare 在不同地区访问质量差异明显。必须针对目标客户网络环境验证：

- 页面首屏
- API 延迟
- WebSocket 稳定性
- MySQL 往返延迟
- Cloudflare 到客户数据库链路

### 12.2 数据面连接

`managed-cloud-agent` 下，客户 MySQL 不要求直接暴露给 Cloudflare Workers；默认通过客户侧 Agent 访问。必须提供安全接入指引：

- Agent enrollment
- Cloudflare Tunnel 或 direct HTTPS
- TLS
- 最小权限
- IP / 网络访问控制
- 密码轮换
- 审计
- 备份

### 12.3 运行时限制

Workers 不适合所有 Node 服务。需要逐模块检查：

- Node API 兼容性
- 文件系统依赖
- native module
- 长任务
- 大内存任务
- WebSocket / TCP / stream 行为

### 12.4 成本模型

需要在产品化前估算：

- Workers 请求量
- Hyperdrive 用量
- Cloudflare Tunnel 数量、route 数和账号分片
- Agent 请求量、连接数和部署支持成本
- Durable Objects 连接和存储
- R2 存储
- 自定义域名和证书相关成本
- 日志与观测成本

## 13. 近期建议执行清单

1. 固化 `finance` Cloudflare 部署模板。
2. 固化 `altoc` Cloudflare 部署模板。
3. 新增 Tenant Gateway Worker 原型。
4. 建立 `hzy-data-runtime` Agent ADR-014 PoC，优先选择 `finance` 或 `assets`。
5. 在 Platform Dashboard 增加租户站点、应用路由、Agent enrollment 和健康状态只读页。
6. 在 Platform Dashboard 增加 Agent/Tunnel/数据库/schema 连接测试页。
7. 把 `hzy.wiztek.cn` 试点迁到 `wiztek.huizhi.yun`。
8. 将 `finance.isme.dev` / `altoc.isme.dev` 这类临时域名收敛为平台生成配置。
9. 为 Console 支持租户子域名 callback URL 做一次专项检查。
10. 按 `docs/Codocs-Cloudflare-Migration-Plan.md` 推进 Codocs / Collab Durable Objects POC 与对象存储抽象。

## 14. Cloudflare 能力参考

- Workers Custom Domains: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- Hyperdrive: https://developers.cloudflare.com/hyperdrive/
- Durable Objects: https://developers.cloudflare.com/durable-objects/
- Durable Objects WebSocket Hibernation: https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/
- Workers for Platforms: https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/how-workers-for-platforms-works/
- Cloudflare for SaaS Custom Hostnames: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/
