# Huizhi-yun 平台部署指南

状态更新：2026-05-25

本文档说明汇智云当前推荐部署方式。平台已从“企业自行部署完整应用栈”调整为“一套平台托管应用运行时 + 企业自管数据面”的主线：`platform`、`console`、`codocs`、`workflow`、`aims`、`finance` 等应用逐步运行在 Cloudflare Workers，企业数据库默认通过客户侧 `hzy-data-runtime` Agent 访问；Hyperdrive/Direct DB 只作为历史迁移和应急回退路径。

详细架构决策见 [ADR-014: Managed Cloud Agent 与部署 Profile 收敛](./ADR-014-Managed-Cloud-Agent-and-Deployment-Profiles.md)。

---

## 1. 部署形态总览

### 1.1 租户 Workload Profile

| Profile | 定位 | 应用运行时 | 数据访问路径 | 当前建议 |
| --- | --- | --- | --- | --- |
| `managed-cloud-agent` | 默认企业 SaaS 模式 | Cloudflare Workers | Worker -> Data Runtime Agent -> 企业数据库 | 主推 |
| `self-hosted` | 企业全栈私有化 | 企业服务器/内网 | 应用直连本地数据库 | 主推 |
| `managed-cloud-direct-db` | 历史迁移/应急回退 | Cloudflare Workers | Worker -> Hyperdrive -> 企业 MySQL | 不作为新租户默认 |
| `managed-cloud-d1` | 轻量/海外全托管 | Cloudflare Workers | Worker -> D1 | 后续 |
| `dev` | 本地开发 | 本地 Nuxt/dev-stack | 本地 MySQL 或 mock runtime | 内部 |

### 1.2 Platform 数据库 Profile

`platform` 是平台控制面，不纳入 Data Runtime Agent 覆盖范围。

| Platform DB Profile | 用途 |
| --- | --- |
| `platform-cloud-db` | 平台侧托管或混合模式，Platform 连接平台侧数据库 |
| `platform-self-hosted-db` | Enterprise self-hosted 时，Platform 使用客户本地平台库 |
| `platform-d1` | 后续轻量/海外控制面评估 |

强约束：

- Data Runtime Agent 只覆盖租户 workload 数据面，例如 `console` supporting runtime 和业务应用数据。
- Platform 不通过 Agent 访问数据库。
- Agent 不承担租户、订阅、license、Cloudflare 资源、运营账号等平台控制面职责。

---

## 2. 推荐架构

### 2.1 Managed Cloud Agent 主线

```mermaid
flowchart LR
    Browser["浏览器"]
    Gateway["Tenant Gateway Worker"]
    App["Console / 业务 App Worker"]
    Agent["hzy-data-runtime Agent"]
    DB["企业自管 MySQL / libSQL / 后续数据源"]
    Platform["Platform 控制面"]

    Browser --> Gateway
    Gateway --> App
    Gateway -->|"按域名解析 tenant/deployment/Agent"| Platform
    Gateway -->|"注入运行时头"| App
    App -->|"业务 API + service token"| Agent
    Agent --> DB
    Platform -. "租户维护的域名 / Agent endpoint / token" .-> Gateway
```

该模式下，Cloudflare 上可以只部署一套 Tenant Gateway 和一套应用 Worker 来服务多个租户。租户差异体现在租户 Dashboard 的 `/dashboard/deployments` 中维护的企业子域名、后续自定义域名、企业默认 Agent endpoint，以及平台生成的 deployment、policy bundle、service token 和数据面连接上，而不是每个租户单独部署一份应用代码。业务应用 Worker 不再把租户级 `HZY_DATA_RUNTIME_URL` / token 固化为全局配置；`hzy-tenant-gateway` 按请求域名解析后注入内部运行时头。应用 deployment 可以设置 Agent endpoint 覆盖值，但默认继承企业级 endpoint。

### 2.2 Self-hosted 主线

```mermaid
flowchart LR
    Browser["浏览器"]
    Nginx["客户侧 Nginx / 网关"]
    Apps["Platform / Console / 业务应用"]
    DB["客户侧数据库"]
    OSS["客户侧对象存储或 S3 兼容存储"]

    Browser --> Nginx
    Nginx --> Apps
    Apps --> DB
    Apps --> OSS
```

Self-hosted 用于对数据安全和内网隔离要求更高的企业。应用、数据库、对象存储和认证集成都在客户环境内运行；此时不需要 Data Runtime Agent 作为中间层。

---

## 3. Cloudflare 应用部署

### 3.1 通用前置

每个 Nuxt 业务应用通过模块内脚本生成 `.wrangler.generated.jsonc`，再执行 Cloudflare build/deploy。

通用环境变量：

```bash
export HZY_DEPLOYMENT_PROFILE=managed-cloud-agent
```

Cloudflare 托管的一套业务应用 Worker 是租户无关的，不应在应用部署参数中写入
`wiztek.huizhi.yun` 这类租户入口域名。业务应用的外部访问 URL、OIDC callback
和业务链接默认由请求 Host / `x-forwarded-host` 推导；`HZY_DEPLOYMENT_PUBLIC_URL`
仅用于 self-hosted 或单租户独立部署。`HZY_CONSOLE_URL` / `HZY_CONSOLE_API_URL`
默认指向 `https://console.huizhi.yun`，通常也不需要在业务应用中单独配置。

常用 profile 差异：

- `managed-cloud-agent`：不需要 Hyperdrive 绑定；数据库访问由 `hzy-tenant-gateway` 按域名解析到租户 Agent。`HZY_DATA_RUNTIME_URL` 仅作为本地调试或单租户直连 fallback。
- `managed-cloud-direct-db`：需要 `HZY_<APP>_HYPERDRIVE_ID`，仅作为历史迁移和应急回退。
- `managed-cloud-d1`：后续单独评估，不作为当前默认路径。
- 企业微信通知需要固定出口 IP 时，在国内服务器部署 `notification-runtime`，并在 Console `通知运行时` 页面生成一键安装指令、配置 `notification.runtimeApiUrl`；生成的指令会包含 tenant、deployment、Console OAuth client secret 等运行参数。Cloudflare 业务应用通过 Foundation `sendNotification()` 调用该 runtime，不直接访问企业微信 API。

### 3.2 业务应用 Cloudflare 部署示例

Finance 是首个完整 Agent 试点应用。Workflow 的核心数据库运行时已在 `0.2.6` 接入 Agent；Cloudflare 托管侧由 Tenant Gateway 解析租户运行时配置。
Finance 和 Workflow 的 Cloudflare 配置生成脚本默认使用 `managed-cloud-agent`，不会生成 Hyperdrive 绑定。尚未完成 Agent adapter 覆盖的应用仍需先完成迁移，再切换默认 profile。

```bash
cd /Users/gavin/Dev/huizhi-yun/finance

export HZY_DEPLOYMENT_PROFILE=managed-cloud-agent
export HZY_APP_BASE_PATH=/finance/
export HZY_DATA_RUNTIME_AUDIENCE=data-runtime
export HZY_NOTIFICATION_RUNTIME_AUDIENCE=notification-runtime

pnpm run cloudflare:config
pnpm run build:cloudflare
pnpm dlx wrangler@4 deploy --config .wrangler.generated.jsonc
```

Tenant Gateway 推荐通过 Platform 内部 API 解析域名：

```bash
pnpm dlx wrangler@4 secret put HZY_CLOUDFLARE_INTERNAL_TOKEN \
  --config deploy/cloudflare/tenant-gateway/wrangler.jsonc
```

`HZY_TENANT_GATEWAY_REGISTRY_URL` 指向 Platform 内部接口，例如：

```text
https://platform.example.com/api/platform/internal/tenant-gateway/resolve
```

如果 Tenant Gateway 使用 `*.huizhi.yun/*` 这类通配 route，必须避免把应用域名和平台保留域名当作租户子域名。Gateway 内置保留列表会跳过
`aims/assets/altoc/codocs/align/workflow/collab/finance/hrm/insights` 等应用前缀，以及 `admin/www/platform/dashboard/console/downloads` 等平台和基础设施前缀；可通过 `HZY_TENANT_GATEWAY_RESERVED_SUBDOMAINS` 扩展。被跳过的保留域名请求会剥离内部 `x-hzy-*` 头后直接 passthrough，由对应应用 Worker custom domain 或 DNS origin 处理。

Platform 侧同样使用内置保留列表，并可通过
`tenant_reserved_subdomains` 表扩展；企业在 `/dashboard/deployments` 注册子域名时会合并“内置列表 + 表内 active 记录”进行校验。

如果暂时不启用 Platform 实时解析，也可以由 Platform 导出 `HZY_TENANT_GATEWAY_REGISTRY_JSON` 给 gateway，格式示例：

```json
{
  "domains": {
    "wiztek.huizhi.yun": {
      "tenantCode": "wiztek",
      "deploymentCode": "wiztek-console",
      "dataRuntime": {
        "endpoint": "https://oa.wiztek.cn:18080",
        "staticToken": "platform-generated-token"
      },
      "apps": {
        "finance": { "deploymentCode": "wiztek-finance" },
        "workflow": { "deploymentCode": "wiztek-workflow" }
      }
    }
  }
}
```

注意：

- 租户 Dashboard 的 `/dashboard/deployments` 是企业子域名、后续自定义域名和企业默认 Agent endpoint 的维护入口；平台运营侧只维护 deployment/profile/code 等平台治理字段。
- Data Runtime static token 由 Platform 生成，企业可在 `/dashboard/deployments` 生成或轮换一键安装指令。指令会包含 `HZY_DATA_RUNTIME_TENANT`、`HZY_DATA_RUNTIME_DEPLOYMENT`、`HZY_DATA_RUNTIME_STATIC_TOKEN` 和当前环境 active deployment 对应的 `HZY_<APP>_AGENT_ENABLED` 标记，同时 token 会保存到 Platform bootstrap secret，供 gateway 内部解析接口读取。平台运维侧可通过 ops 同名接口做应急处理。
- Agent 服务器侧变量名是 `HZY_DATA_RUNTIME_STATIC_TOKEN`。
- gateway 注入给业务 Worker 的内部头包括 `x-hzy-tenant`、`x-hzy-deployment`、`x-hzy-data-runtime-url` 和静态 token PoC 阶段的 `x-hzy-data-runtime-token`。
- `HZY_TENANT_GATEWAY_TOKEN` 已退场；gateway 仅作为路由和运行时 header 注入边界，业务 Worker 的跨应用信任由 Console service token 承担。
- `HZY_DATA_RUNTIME_TOKEN` 不再作为多租户 Cloudflare 部署的全局 Worker secret。
- 租户不需要、也不应该自行配置 Cloudflare secret。

### 3.3 Finance 当前 Agent 覆盖范围

`managed-cloud-agent` 下，Finance 业务数据库访问已优先走 Agent。覆盖范围包括：

- dashboard summary
- contracts summaries / contract summary
- bank accounts、balance snapshots、balance changes
- invoices、receipts、expenses、expense claims
- invoice requests、project expense requests、payment requests
- settings、reports、project accounting、performance
- audit logs、approval instances、reconciliation、migration status
- `POST` / `PATCH` / `DELETE` 写接口
- workflow callback、approval submit
- recalculate、classify、void 等事务命令

审批提交的职责拆分为：Finance Worker 先通过 Agent 读取单据详情并向 Workflow 创建审批实例，再把 `workflowInstanceId` 交给 Agent 完成业务库状态更新。这样 `managed-cloud-agent` 下 Worker 仍不直连业务数据库，同时保留 Workflow 审批链路。

例外：

- `workflow/actions/sync` 只同步 Workflow 动作定义，不访问 Finance 数据库；在 Workflow 启用 Agent 覆盖后，该调用由 Workflow Worker 转发到 Agent。
- `migrations/wizbizdb/import` 是一次性迁移工具，不作为常规业务运行时能力；`managed-cloud-agent` 下不建议从 Cloudflare Worker 发起导入，应在客户侧或运维侧执行受控迁移。

因此当前纯 `managed-cloud-agent` 已可覆盖 Finance 常规业务页面的读写运行。升级时必须先升级客户侧 Agent，再部署 Finance Worker，否则新 Worker 调用旧 Agent 时会出现 `404 Route not found` 或 `502 Data Runtime Agent request failed`。

### 3.4 Workflow 当前 Agent 覆盖范围

Workflow 从 `0.2.6` 开始已完成核心数据库运行时迁移：

- `POST /api/v1/action-defs/sync` -> Agent `/v1/workflow/action-defs/sync`
- `GET /api/v1/actions` -> Agent `/v1/workflow/actions`
- `POST /api/v1/instances/prepare` -> Agent `/v1/workflow/instances/prepare`
- `POST /api/v1/instances` -> Agent `/v1/workflow/instances`
- `GET /api/v1/instances/:id`、`by-biz`、`by-biz-history`
- `POST /api/v1/instances/:id/cancel`、`resubmit`
- `GET /api/v1/tasks/pending`、`done`、`initiated`、`:id`
- `POST /api/v1/tasks/:id/approve`、`reject`、`delegate`
- 管理端 `action-defs`、`flow-schemas`、`form-schemas`、`routes` 的列表、详情、创建、更新、删除
- `/runtime/schema/status?app=workflow`

Workflow Worker 仍负责登录态校验、Console 目录上下文收集、企业微信通知和跨模块 callback 的外部 HTTP 调用；Agent 负责 Workflow 数据库查询、路由匹配、流程状态机推进、任务写入和管理端配置写入。因此业务模块不能绕过 Workflow 侧授权，Agent 也不需要直接访问 Console/Directory。

### 3.5 其他模块迁移状态

- `align` 当前没有活跃业务数据 API，仅保留未使用的系统参数 DB 工具；暂不需要 Agent 覆盖，等出现明确业务对象后再接入。
- `assets` 的数据访问集中在大型 repository 中，适合在 Workflow 核心链路稳定后迁移。
- `aims`、`codocs`、`console` 的 API 和写入面更广，后续应优先迁移被 Finance/Workflow 运行时依赖的 supporting runtime 接口，再迁移管理端或低频功能。

---

## 4. Data Runtime Agent 部署

`hzy-data-runtime` 是客户侧轻量数据面服务。它不是 SQL-over-REST 代理，不暴露 `/query`，只暴露固定业务 API、健康检查和 schema 状态接口。

### 4.1 推荐：一键安装与升级

推荐从租户 Dashboard `/dashboard/deployments` 复制平台生成的一键安装指令完成首次安装。该指令会把平台侧 tenant、deployment、static token 和当前环境启用的 Agent app 列表注入安装脚本；数据库地址、端口、账号和密码仍由安装脚本在服务器本地交互输入并测试。

只做升级时，也可以直接使用发布到 R2 的安装脚本：

```bash
curl -fsSL https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh | sudo bash
```

安装指定版本：

```bash
curl -fsSL https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh | sudo bash -s -- --version 0.2.8
```

如果自定义域名暂未生效，也可以使用 R2 endpoint 作为下载源：

```bash
curl -fsSL https://6cf3948db481580745329253415d59d3.r2.cloudflarestorage.com/huizhiyun/packages/hzy-data-runtime/install.sh | \
  sudo bash -s -- \
    --base-url https://6cf3948db481580745329253415d59d3.r2.cloudflarestorage.com/huizhiyun/packages/hzy-data-runtime
```

首次安装时，安装脚本会提示输入共享数据库连接参数：数据库地址（默认
`127.0.0.1`）、端口（默认 `3306`）、用户名、密码，并对安装命令中启用的每个
Agent app 逐一询问数据库名。脚本会先用这些参数执行数据库连接测试，通过后才写入
`/etc/hzy-data-runtime/.env`；后续升级会保留该文件，只替换二进制和
systemd unit。`HZY_DATA_RUNTIME_STATIC_TOKEN` 必须由平台生成并包含在安装命令中；如果 `static_token` 模式下未提供 token，安装脚本会停止，不会让租户自行配置 Cloudflare。

安装脚本默认会写入并启用 `hzy-data-runtime-update.timer`，每 5 分钟执行一次：

```bash
/opt/hzy-data-runtime/hzy-data-runtime update --version latest
```

自动更新只检查 R2 上的 `latest/version.txt`。如果存在新版本，Agent 会下载对应 tar 包，校验 `.sha256`，替换二进制并重启 `hzy-data-runtime.service`；如果服务重启失败，会尝试恢复上一版二进制。该机制只更新程序文件，不改写 `/etc/hzy-data-runtime/.env`，也不会执行平台下发的任意 shell 命令。
已安装 `0.2.6` 或更早版本的服务器需要重新执行一次一键安装命令，以写入自动更新 timer；之后才会每 5 分钟自行检查升级。

如需非交互安装，可以通过 `sudo env ... bash` 传入初始化参数：

```bash
curl -fsSL https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh | \
  sudo env \
    HZY_DATA_RUNTIME_PORT=18080 \
    HZY_DATA_RUNTIME_TENANT=tenant-code \
    HZY_DATA_RUNTIME_DEPLOYMENT=deployment-code \
    HZY_DATA_RUNTIME_STATIC_TOKEN='platform-provided-token' \
    HZY_DATA_RUNTIME_DB_HOST=127.0.0.1 \
    HZY_DATA_RUNTIME_DB_USER=cf_app \
    HZY_DATA_RUNTIME_DB_PASSWORD='change-me' \
    HZY_FINANCE_DB_NAME=hzy_finance \
    HZY_WORKFLOW_AGENT_ENABLED=true \
    HZY_WORKFLOW_DB_NAME=hzy_workflow \
    HZY_WEBDEV_AGENT_ENABLED=false \
    HZY_WEBDEV_DB_NAME=hzy_webdev \
    HZY_ASSETS_AGENT_ENABLED=true \
    HZY_ASSETS_DB_NAME=hzy_assets \
    HZY_PEOPLE_AGENT_ENABLED=true \
    HZY_PEOPLE_DB_NAME=hzy_people \
    HZY_ALTOC_AGENT_ENABLED=true \
    HZY_ALTOC_DB_NAME=hzy_altoc \
    HZY_AIMS_AGENT_ENABLED=true \
    HZY_AIMS_DB_NAME=hzy_aims \
    HZY_CODOCS_AGENT_ENABLED=true \
    HZY_CODOCS_DB_NAME=hzy_codocs \
    bash
```

默认情况下，各应用 adapter 共用 `HZY_DATA_RUNTIME_DB_HOST` / `PORT` /
`USER` / `PASSWORD` / `CONNECTION_LIMIT`。只有某个应用需要连接不同的
MySQL 实例或账号时，才额外设置 `HZY_FINANCE_DB_HOST`、
`HZY_WORKFLOW_DB_HOST`、`HZY_AIMS_DB_HOST` 等应用级覆盖变量。

安装脚本默认行为：

- 自动识别 Linux `amd64` / `arm64` 架构并下载对应 tar 包。
- 从 `https://downloads.huizhi.yun/packages/hzy-data-runtime` 下载 `latest` 或指定版本。
- 校验 `.sha256`，除非显式设置 `HZY_DATA_RUNTIME_SKIP_CHECKSUM=1`。
- 创建运行用户 `hzy`、目录 `/opt/hzy-data-runtime` 和 `/etc/hzy-data-runtime`。
- `static_token` 模式下要求平台提供 `HZY_DATA_RUNTIME_STATIC_TOKEN`；升级时保留已有 `.env`。
- 写入并启动 `hzy-data-runtime.service`。
- 写入并启用 `hzy-data-runtime-update.timer`，默认每 5 分钟检查 R2 `latest` 是否有新版本。

如需关闭自动更新：

```bash
curl -fsSL https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh | sudo bash -s -- --no-auto-update
```

如需调整检查间隔：

```bash
curl -fsSL https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh | sudo bash -s -- --update-interval 10min
```

该脚本当前只负责 Agent 安装、升级和本机自动更新，不自动配置 Cloudflare Tunnel。Tunnel 自动化下一阶段再补。

如需在已安装服务器上重新配置数据库连接，使用：

```bash
curl -fsSL https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh | sudo bash -s -- --reconfigure
```

如需覆盖默认路径或服务名：

```bash
curl -fsSL https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh | \
  sudo bash -s -- \
    --version 0.2.8 \
    --install-dir /opt/hzy-data-runtime \
    --config-dir /etc/hzy-data-runtime \
    --service-name hzy-data-runtime
```

### 4.2 发布 R2 安装包

开发方在本机打包并上传到 R2：

```bash
cd /Users/gavin/Dev/huizhi-yun/data-runtime
./scripts/package-release.sh 0.2.8
./scripts/upload-r2.sh 0.2.8
```

发布脚本会生成：

- `build/packages/hzy-data-runtime/install.sh`
- `build/packages/hzy-data-runtime/0.2.8/hzy-data-runtime_0.2.8_linux_amd64.tar.gz`
- `build/packages/hzy-data-runtime/0.2.8/hzy-data-runtime_0.2.8_linux_arm64.tar.gz`
- `build/packages/hzy-data-runtime/latest/hzy-data-runtime_linux_amd64.tar.gz`
- `build/packages/hzy-data-runtime/latest/hzy-data-runtime_linux_arm64.tar.gz`
- 对应 `.sha256`、`manifest.json` 和 `version.txt`

上传目标：

```text
R2 bucket: huizhiyun
R2 prefix: packages/hzy-data-runtime
Public URL: https://downloads.huizhi.yun/packages/hzy-data-runtime
R2 endpoint fallback: https://6cf3948db481580745329253415d59d3.r2.cloudflarestorage.com/huizhiyun/packages/hzy-data-runtime
```

上传前需要在本机完成 Cloudflare Wrangler 登录，并确保账号有 `huizhiyun` R2 bucket 写权限。

### 4.3 手工构建与 scp 备用路径

如果在 macOS 本机编译后上传到 Linux 服务器，必须交叉编译 Linux 版本；直接执行 `go build` 会生成 macOS `Mach-O` 二进制，Linux 上无法运行。

```bash
cd /Users/gavin/Dev/huizhi-yun/data-runtime

# Linux x86_64 / amd64 服务器
GOOS=linux GOARCH=amd64 /usr/local/go/bin/go build -o hzy-data-runtime-linux-amd64 ./cmd/hzy-data-runtime

# 如果服务器是 ARM64 / aarch64，则使用：
# GOOS=linux GOARCH=arm64 /usr/local/go/bin/go build -o hzy-data-runtime-linux-arm64 ./cmd/hzy-data-runtime
```

本机确认产物类型：

```bash
file hzy-data-runtime-linux-amd64
```

部署到服务器：

```bash
# 服务器执行
sudo mkdir -p /opt/hzy-data-runtime /etc/hzy-data-runtime

# 本机执行
scp ./hzy-data-runtime-linux-amd64 root@oa.wiztek.cn:/tmp/hzy-data-runtime

# 服务器执行
sudo systemctl stop hzy-data-runtime
sudo install -m 755 /tmp/hzy-data-runtime /opt/hzy-data-runtime/hzy-data-runtime
sudo systemctl start hzy-data-runtime
sudo systemctl status hzy-data-runtime --no-pager -l
```

如果服务器 SSH 端口不是 22，例如使用 `2222`：

```bash
scp -P 2222 ./hzy-data-runtime-linux-amd64 root@oa.wiztek.cn:/tmp/hzy-data-runtime
```

服务器上可用以下命令确认架构和二进制类型：

```bash
uname -m
file /opt/hzy-data-runtime/hzy-data-runtime
```

### 4.4 `.env` 配置

在服务器创建 `/etc/hzy-data-runtime/.env`：

```bash
HZY_DATA_RUNTIME_HOST=0.0.0.0
HZY_DATA_RUNTIME_PORT=18080
HZY_DATA_RUNTIME_TENANT=tenant-code
HZY_DATA_RUNTIME_DEPLOYMENT=deployment-code

HZY_DATA_RUNTIME_AUTH_MODE=static_token
HZY_DATA_RUNTIME_STATIC_TOKEN=平台生成并随安装命令下发
HZY_DATA_RUNTIME_JWT_AUDIENCE=data-runtime
# HZY_DATA_RUNTIME_JWKS_URL=https://console.example.com/oauth/jwks

HZY_DATA_RUNTIME_DB_HOST=127.0.0.1
HZY_DATA_RUNTIME_DB_PORT=3306
HZY_DATA_RUNTIME_DB_USER=cf_app
HZY_DATA_RUNTIME_DB_PASSWORD=change-me
HZY_DATA_RUNTIME_DB_CONNECTION_LIMIT=5

HZY_FINANCE_AGENT_ENABLED=true
HZY_FINANCE_DB_NAME=hzy_finance

HZY_WORKFLOW_AGENT_ENABLED=false
HZY_WORKFLOW_DB_NAME=hzy_workflow

HZY_WEBDEV_AGENT_ENABLED=false
HZY_WEBDEV_DB_NAME=hzy_webdev

HZY_ASSETS_AGENT_ENABLED=false
HZY_ASSETS_DB_NAME=hzy_assets

HZY_PEOPLE_AGENT_ENABLED=false
HZY_PEOPLE_DB_NAME=hzy_people

HZY_ALTOC_AGENT_ENABLED=false
HZY_ALTOC_DB_NAME=hzy_altoc

HZY_AIMS_AGENT_ENABLED=false
HZY_AIMS_DB_NAME=hzy_aims

HZY_CODOCS_AGENT_ENABLED=false
HZY_CODOCS_DB_NAME=hzy_codocs
```

生产稳定后应切换为 `jwt` 模式，由 Console/Platform JWKS 校验短期 service token。`static_token` 只适合首期 PoC 或内网受控环境。

### 4.5 systemd

创建 `/etc/systemd/system/hzy-data-runtime.service`：

```ini
[Unit]
Description=Huizhi-yun Data Runtime Agent
After=network.target

[Service]
WorkingDirectory=/opt/hzy-data-runtime
EnvironmentFile=/etc/hzy-data-runtime/.env
ExecStart=/opt/hzy-data-runtime/hzy-data-runtime
Restart=always
RestartSec=5
User=hzy
Group=hzy

[Install]
WantedBy=multi-user.target
```

启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now hzy-data-runtime
sudo systemctl status hzy-data-runtime
```

### 4.6 Docker Compose

也可以使用 Agent 自带示例：

```bash
cd /opt/hzy-data-runtime
docker build -t hzy-data-runtime:0.2.8 /path/to/data-runtime
docker compose -f compose.example.yml up -d
```

示例 compose 默认只把端口绑定到 `127.0.0.1:8080`，适合配合 Cloudflare Tunnel。

### 4.7 健康检查

```bash
curl http://127.0.0.1:18080/runtime/health

curl -H "Authorization: Bearer ${HZY_DATA_RUNTIME_STATIC_TOKEN}" \
  "http://127.0.0.1:18080/runtime/enrollment"

curl -H "Authorization: Bearer ${HZY_DATA_RUNTIME_STATIC_TOKEN}" \
  "http://127.0.0.1:18080/runtime/schema/status?app=finance"

# 如果已启用 Workflow Agent 覆盖：
curl -H "Authorization: Bearer ${HZY_DATA_RUNTIME_STATIC_TOKEN}" \
  "http://127.0.0.1:18080/runtime/schema/status?app=workflow"

curl -H "Authorization: Bearer ${HZY_DATA_RUNTIME_STATIC_TOKEN}" \
  "http://127.0.0.1:18080/v1/finance/dashboard/summary"
```

---

## 5. Agent 网络模式

### 5.1 Cloudflare Tunnel

适用于客户没有公网 IP、不想开放入站端口的场景。客户服务器只需主动连出到 Cloudflare。

示例 `/etc/cloudflared/config.yml`：

```yaml
tunnel: hzy-data-runtime-tenant
credentials-file: /etc/cloudflared/hzy-data-runtime-tenant.json

ingress:
  - hostname: wiztek-data-runtime.huizhi.yun
    service: http://127.0.0.1:18080
  - service: http_status:404
```

启动：

```bash
cloudflared tunnel create hzy-data-runtime-tenant
cloudflared tunnel route dns hzy-data-runtime-tenant agent-tenant.example.com
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

约束：

- 一个租户只需要一个 Agent endpoint，不按应用创建 Tunnel。
- Cloudflare Tunnel 数量接近账号限制前，再考虑购买额度、账号分片或自研 `platform_relay`。

### 5.2 Direct HTTPS

如果客户已有公网域名或 API 网关，也可以直接暴露 Agent：

将 `https://oa.example.com:18080` 登记到租户 Dashboard `/dashboard/deployments`
的企业默认 Agent endpoint。各应用默认继承该地址；只有某个应用确实需要独立 Agent 时，才在应用管理中填写应用级覆盖 endpoint。`hzy-tenant-gateway` 会按访问域名解析后注入业务 Worker。

建议使用 HTTPS、IP allowlist、WAF 或反向代理限流。不要暴露数据库端口。

---

## 6. Hyperdrive 过渡模式

`managed-cloud-direct-db` 仅用于历史租户迁移和应急回退，不再作为新租户默认路径。该模式会为 Worker 绑定 Hyperdrive：

```bash
cd /Users/gavin/Dev/huizhi-yun/finance

pnpm dlx wrangler@4 hyperdrive create hzy-finance-mysql \
  --connection-string="mysql://user:password@host:3306/hzy_finance"

export HZY_DEPLOYMENT_PROFILE=managed-cloud-direct-db
export HZY_FINANCE_HYPERDRIVE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
pnpm run cloudflare:config
pnpm run build:cloudflare
pnpm dlx wrangler@4 deploy --config .wrangler.generated.jsonc
```

注意：

- `managed-cloud-agent` 不会生成 Hyperdrive 绑定。
- Hyperdrive configured databases 有账号数量限制，不适合作为长期多租户默认模型。
- 该模式要求客户数据库可被 Cloudflare 访问，安全和网络条件通常比 Agent 模式更苛刻。
- 业务模块完成 Agent adapter 覆盖后，应删除对应直接数据库访问代码，而不是长期维护 Direct DB 与 Agent 两套实现。

---

## 7. Self-hosted 部署

Self-hosted 用于企业自行托管完整应用栈。此时应用直接连接客户内网数据库，不需要 Data Runtime Agent。

### 7.1 服务器依赖

```bash
sudo apt update && sudo apt install -y curl git nginx build-essential

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20

corepack enable
corepack prepare pnpm@10 --activate
```

### 7.2 数据库

按需创建模块库：

```sql
CREATE DATABASE IF NOT EXISTS hzy_platform CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS hzy_console CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS hzy_codocs CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS hzy_workflow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS hzy_aims CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS hzy_finance CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

各模块 schema 以模块 `docs/*_schema.sql` 为准。

### 7.3 应用环境变量

Self-hosted 业务应用最小保留：

```bash
HZY_DEPLOYMENT_PROFILE=self-hosted
HZY_APP_CODE=finance
HZY_APP_BASE_PATH=/finance/
HZY_DEPLOYMENT_PUBLIC_URL=https://hzy.example.com
HZY_CONSOLE_URL=https://hzy.example.com
HZY_CONSOLE_API_URL=https://hzy.example.com

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=hzy_finance
DB_PASSWORD=change-me
DB_NAME=hzy_finance
DB_CONNECTION_LIMIT=10
```

平台级 OSS、GitLab、企业微信、钉钉、AI 等凭证应逐步收敛到 Console integration-config + credential-vault，不再在每个业务应用重复配置。

### 7.4 PM2 示例

```bash
cd /opt/huizhi-yun/finance
pnpm install --frozen-lockfile
pnpm build

pm2 start .output/server/index.mjs --name hzy-finance --env production
pm2 save
```

Codocs 协作运行时默认由 Console 内嵌启动；需要独立扩容或隔离时，再部署 `collab` standalone 服务并通过 Nginx 代理 WebSocket。

---

## 8. 开发模式

```bash
cd /Users/gavin/Dev/huizhi-yun/finance
cp .env.dev.example .env.dev 2>/dev/null || true
pnpm install
pnpm dev
```

开发模式通常使用：

```bash
HZY_DEPLOYMENT_PROFILE=dev
HZY_CONSOLE_URL=http://localhost:3000
DB_HOST=127.0.0.1
DB_PORT=3306
```

如需本地联调 Agent：

```bash
cd /Users/gavin/Dev/huizhi-yun/data-runtime
cp .env.example .env
/usr/local/go/bin/go run ./cmd/hzy-data-runtime
```

---

## 9. 配置简化原则

Cloudflare 托管部署下，应尽量减少业务应用配置：

必须保留：

- `HZY_DEPLOYMENT_PROFILE`
- `HZY_APP_CODE`
- `HZY_APP_BASE_PATH` / `NUXT_APP_BASE_URL`
- `HZY_DEPLOYMENT_PUBLIC_URL`
- `HZY_CONSOLE_URL` / `HZY_CONSOLE_API_URL`
- Agent 模式下的租户域名、自定义域名和 Agent endpoint 由企业在 Dashboard 维护；static token 由 Platform 生成；最终由 `hzy-tenant-gateway` 注入业务 Worker。
- Direct DB 过渡模式下的 Hyperdrive ID

避免新增：

- 业务应用私有的跨模块 API key/secret。
- 业务应用重复保存 OSS、GitLab、企业微信、钉钉、AI 等平台级凭证。
- 在 Cloudflare `vars` 中保存静态 token、数据库密码等敏感信息。

- Console 使用 Platform 生成的 `HZY_PLATFORM_LICENSE_TOKEN` 启动；业务应用不再下发 `license.lic`。
- `HZY_AUTH_MODE=legacy` / `HZY_LEGACY_AUTH_BRIDGE=true` 仅用于旧认证桥接。

---

## 10. 发布顺序

Agent 模式下建议顺序：

1. 部署或升级客户侧 `hzy-data-runtime`。
2. 验证 `/runtime/health`、`/runtime/enrollment`、`/runtime/schema/status?app=finance`；如果启用 Workflow，则同时验证 `/runtime/schema/status?app=workflow`。
3. 企业在 Dashboard `/dashboard/deployments` 维护企业子域名、后续自定义域名和企业默认 Agent endpoint；Platform 保持 deployment/code/profile 等平台侧治理字段。
4. 企业在 `/dashboard/deployments` 生成或轮换一键安装指令。静态 token PoC 阶段，Platform 会将该 token 保存为 `deployment_bootstrap_secrets.secret_code='data-runtime.static_token'`，仅供 gateway 内部解析接口读取。
5. 部署或更新 `hzy-tenant-gateway`，配置 `HZY_TENANT_GATEWAY_REGISTRY_URL` 和 `HZY_CLOUDFLARE_INTERNAL_TOKEN`，或使用 Platform 导出的 `HZY_TENANT_GATEWAY_REGISTRY_JSON`。
6. 生成并检查业务应用 `.wrangler.generated.jsonc`，确认 profile 为 `managed-cloud-agent` 且没有 Hyperdrive 绑定。
7. 部署业务 Worker。
8. 浏览器验证登录、权限、dashboard、台账列表、写入表单、审批回调和报表。

Finance / Workflow 必须先确保 Agent 已自动更新到包含新 API 的版本，再部署带新 API 转发逻辑的 Worker。否则新 Worker 调用旧 Agent 时会出现 `404 Route not found` 或 `502 Data Runtime Agent request failed`。在默认安装下，可通过 `systemctl status hzy-data-runtime-update.timer` 和 `/opt/hzy-data-runtime/hzy-data-runtime --version` 确认自动更新状态。

---

## 11. 故障排查

### 11.1 Worker 返回 502

常见原因：

- Platform/gateway 未解析到该域名的 Agent endpoint。
- Agent endpoint 不可达。
- Agent 未启动或端口不一致。
- Agent 返回 401/403。
- Agent 缺少新版本路由。

检查：

```bash
curl http://agent-host:18080/runtime/health
curl -H "Authorization: Bearer <token>" \
  http://agent-host:18080/runtime/schema/status?app=finance

curl -H "Authorization: Bearer <token>" \
  http://agent-host:18080/runtime/schema/status?app=workflow
```

### 11.2 Agent 返回 401

错误含义：

- `missing_bearer_token`：Worker 没有发送 Bearer token，通常是 gateway 未注入 `x-hzy-data-runtime-token`，或后续 JWT/service token 获取失败。
- `invalid_static_token`：Platform/gateway 中登记的 Data Runtime static token 与 Agent `.env` 的 `HZY_DATA_RUNTIME_STATIC_TOKEN` 不一致。

### 11.3 页面 API 仍然 401

先确认服务端 API 能直接返回数据：

```bash
curl -I https://wiztek.huizhi.yun/finance/api/v1/finance/dashboard/summary
```

如果直接 API 正常但页面仍报 401，通常是浏览器里旧 Finance app token/cookie 与 Console session 状态不一致。重新登录或清理该域名下旧 cookie 后再试。

### 11.4 Hyperdrive 配置错误

`managed-cloud-agent` 不需要 `HZY_FINANCE_HYPERDRIVE_ID`。只有 `managed-cloud-direct-db` 才需要 Hyperdrive ID。

---

## 12. 部署检查清单

Managed Cloud Agent：

- [ ] 企业 Dashboard 已维护租户域名、自定义域名、应用和 Agent endpoint。
- [ ] `hzy-tenant-gateway` 能按域名解析到正确 `tenantCode`、`deploymentCode`、Agent endpoint 和 token。
- [ ] `hzy-data-runtime` 已部署到客户数据库服务器或同内网服务器。
- [ ] Agent `.env` 中 `tenant`、`deployment` 与平台登记一致。
- [ ] Agent 能访问客户数据库。
- [ ] `/runtime/health` 和 `/runtime/schema/status?app=finance` 正常。
- [ ] 如果启用 Workflow Agent 覆盖，`/runtime/schema/status?app=workflow` 正常。
- [ ] gateway 已配置 Platform 内部解析 token 或 Platform 导出的 registry JSON。
- [ ] `.wrangler.generated.jsonc` 中 profile 为 `managed-cloud-agent`，且没有 Hyperdrive 绑定。
- [ ] Finance GET API、页面、权限 API 均可访问。

Self-hosted：

- [ ] Node.js 20+、pnpm 10+、Nginx、MySQL 已安装。
- [ ] 模块数据库和 schema 已初始化。
- [ ] 每个模块 `.env` 使用 `HZY_DEPLOYMENT_PROFILE=self-hosted`。
- [ ] Platform 使用独立的 platform DB profile，不走 Agent。
- [ ] PM2/Docker 服务已启动并设置开机自启。
- [ ] Nginx HTTPS/WSS 代理正常。

Direct DB 过渡：

- [ ] profile 为 `managed-cloud-direct-db`。
- [ ] Hyperdrive 已创建并绑定到 Worker。
- [ ] 客户 MySQL 网络和账号权限只开放必要范围。
- [ ] 已规划切换到 Agent 的时间点。
