# ADR-015: WebDev 远程开发控制面与 macOS Dev Agent

状态：Accepted / PoC 阶段 1 已落地  
日期：2026-05-26  
决策范围：`webdev.huizhi.yun`、开发机 Dev Agent、Cloudflare Tunnel、本地 Codex 执行、自动测试与 Cloudflare 应用发布

## 1. 背景

当前平台大部分应用已经可以通过标准命令完成 Cloudflare 部署，`hzy-data-runtime` 也具备一键安装和自动更新能力。下一步希望把开发、测试和发布流程进一步平台化：

- 授权用户通过浏览器访问 `webdev.huizhi.yun`。
- 用户在 Web UI 中输入类似 Codex 的开发指令。
- 后台连接到开发者 macOS 电脑，访问本地项目源代码。
- 本地 Codex 完成功能开发、测试和部署。
- 用户远程访问应用页面进行验证。

这个目标不适合让 Cloudflare Worker 直接持有源代码、密钥或开发环境，也不应让 WebDev Worker 直接连接数据库。更合理的模式是：WebDev 作为平台托管控制面，macOS 上的 Dev Agent 作为本地执行面，数据库访问统一走 Data Runtime 模式。

## 2. 决策

建设 `webdev` 应用和 `hzy-dev-agent`：

```text
webdev.huizhi.yun
  -> Platform 登录 / RBAC
  -> WebDev Job API / 日志流 / Diff 查看 / 发布控制
  -> hzy-data-runtime WebDev adapter
       -> WebDev 元数据数据库
  -> dev-agent-<owner>.huizhi.yun
       -> Cloudflare Tunnel
       -> macOS hzy-dev-agent
       -> 本地 repo / codex / git / pnpm / wrangler
       -> Cloudflare 应用发布
```

第一版使用 Cloudflare Tunnel 暴露开发机 Dev Agent：

- Dev Agent 只监听 `127.0.0.1`。
- `cloudflared` 提供 outbound-only tunnel、HTTPS 和域名。
- WebDev 通过受控 HTTPS 调用 Dev Agent。
- WebDev 运行在 Cloudflare Workers 时不绑定 Hyperdrive，不直连 MySQL；任务、日志、项目和发布元数据通过 `hzy-data-runtime` 的 WebDev adapter 读写。

后续再评估 `platform_relay` 模式：Dev Agent 主动建立长连接到平台，WebDev 不直接调用开发机域名。

## 3. 设计原则

- WebDev 不保存源码、`.env`、Cloudflare API token、SSH key 或本地凭据。
- WebDev 不直连数据库，所有数据库读写都通过 Data Runtime 业务 API。
- 源码、开发工具链、发布凭据留在 macOS 开发机本地。
- Dev Agent 不暴露任意 shell API，只接受结构化任务。
- 每个项目必须配置 repo 白名单和命令模板白名单。
- 所有任务必须记录操作者、输入、命令、日志、diff、测试结果和部署结果。
- Preview / staging 可以自动部署；production 默认必须人工确认。
- 默认在任务分支工作，不直接修改或发布 `main`。

## 4. 核心组件

### 4.1 WebDev 应用

`webdev` 是部署到 Cloudflare Workers 的 Web 应用，提供：

- 项目列表。
- 开发机在线状态。
- 会话和任务列表。
- 指令输入框。
- 实时日志。
- Diff 查看。
- 测试结果。
- 部署目标选择。
- Preview / staging / production 发布记录。

WebDev 复用 Platform 登录和 RBAC。用户必须被授权到具体项目和环境后，才可以创建任务或触发部署。

WebDev 的数据库访问遵循 `managed-cloud-agent` 主线：Worker 通过 Data Runtime Client 调用 `hzy-data-runtime` 的 WebDev adapter。Platform 控制面仍只负责租户、应用、授权和 Agent endpoint 解析，不把 WebDev 业务表纳入 Platform 热路径。

### 4.2 hzy-dev-agent

`hzy-dev-agent` 部署在 macOS 开发机，建议使用 Go 实现为单二进制。职责：

- 管理本机可操作项目。
- 校验 WebDev 下发的任务 token。
- 在白名单 repo 内执行任务。
- 调用本机 `codex` CLI。
- 执行允许的 `git` / `pnpm` / `go` / `wrangler` 命令模板。
- 回传日志、任务状态、diff、测试结果和部署信息。
- 支持取消任务。

Agent 不应直接提供通用命令执行接口，例如：

```text
POST /shell
{ "command": "..." }
```

必须使用结构化任务：

```json
{
  "type": "deploy_module",
  "projectId": "huizhi-yun",
  "module": "finance",
  "target": "staging"
}
```

### 4.3 Cloudflare Tunnel

第一版每台开发机一个 Tunnel 域名：

```text
dev-agent-1.huizhi.yun -> http://127.0.0.1:19090
```

示例配置：

```yaml
tunnel: hzy-dev-agent-1
credentials-file: /etc/cloudflared/hzy-dev-agent-1.json

ingress:
  - hostname: dev-agent-1.huizhi.yun
    service: http://127.0.0.1:19090
  - service: http_status:404
```

启动命令：

```bash
cloudflared tunnel create hzy-dev-agent-1
cloudflared tunnel route dns hzy-dev-agent-1 dev-agent-1.huizhi.yun
cloudflared tunnel run hzy-dev-agent-1
```

生产化后应改为系统服务或 macOS LaunchAgent。

### 4.4 WebDev Data Runtime Adapter

`hzy-data-runtime` 需要增加 WebDev adapter，用于承载 WebDev 元数据读写。它和 Finance/Workflow adapter 一样，只暴露固定业务 API，不暴露 SQL over REST。

建议 API：

```text
GET  /v1/webdev/projects
GET  /v1/webdev/agents
GET  /v1/webdev/jobs?page=1&pageSize=20&status=running&keyword=...
POST /v1/webdev/jobs
GET  /v1/webdev/jobs/:id
PATCH /v1/webdev/jobs/:id
POST /v1/webdev/jobs/:id/events
GET  /v1/webdev/jobs/:id/events
POST /v1/webdev/jobs/:id/artifacts
POST /v1/webdev/deployments
```

WebDev Worker 面向浏览器暴露 `/api/webdev/*`，内部再转发到 Data Runtime `/v1/webdev/*`。这样 WebDev 应用部署到 Cloudflare 后，不需要 Hyperdrive 绑定，也不需要数据库公网可达。

该 adapter 的数据库可以是：

- 开发测试期：开发机或测试服务器上的 MySQL。
- 平台内部正式环境：平台托管的 WebDev 元数据库，但仍通过 Data Runtime API 访问。
- 后续轻量环境：再评估 D1，但不作为第一版目标。

强约束：

- 不提供 `/query`。
- 不返回数据库连接信息。
- 不保存本地源码内容。
- Diff 和日志作为 job artifact/event 保存，需做敏感信息脱敏。

### 4.5 数据访问链路

```text
Browser
  -> WebDev Worker
  -> Data Runtime Client
  -> hzy-data-runtime /v1/webdev/*
  -> WebDev metadata DB

WebDev Worker
  -> Dev Agent HTTPS endpoint
  -> macOS repo / codex / deploy tools
```

WebDev 有两条明确链路：

- 元数据链路：走 Data Runtime。
- 本地执行链路：走 Dev Agent。

两条链路不能混用。Dev Agent 不承担 WebDev 元数据数据库读写；Data Runtime 不执行 Codex 和本地命令。

## 5. 任务模型

第一版支持以下任务类型：

| 类型 | 说明 | 默认权限 |
| --- | --- | --- |
| `codex_task` | 根据用户指令调用 Codex 修改代码 | 项目开发者 |
| `git_diff` | 查看当前任务分支 diff | 项目开发者 |
| `test` | 执行 typecheck / unit test / build check | 项目开发者 |
| `deploy_preview` | 部署 preview 或 staging | 项目开发者 |
| `deploy_production` | 部署 production | 项目负责人或审批通过 |
| `git_commit` | 提交当前任务分支 | 项目负责人或授权开发者 |
| `cancel` | 取消运行中任务 | 任务创建者或管理员 |

任务状态：

```text
queued
  -> accepted
  -> running
  -> needs_approval
  -> deploying
  -> succeeded
  -> failed
  -> canceled
```

## 6. 命令模板

命令必须通过模板配置，不能由用户直接输入 shell。

示例模板：

```json
{
  "id": "finance.typecheck",
  "repoId": "huizhi-yun",
  "cwd": "finance",
  "command": ["pnpm", "run", "typecheck"]
}
```

```json
{
  "id": "finance.deploy.cloudflare",
  "repoId": "huizhi-yun",
  "cwd": "finance",
  "command": ["pnpm", "run", "deploy:cloudflare"]
}
```

允许的命令范围第一版建议限制为：

- `codex`
- `git status`
- `git diff`
- `git branch`
- `git checkout -b`
- `git add`
- `git commit`
- `pnpm run typecheck`
- `pnpm run build`
- `pnpm run deploy:cloudflare`
- `go test ./...`

后续再按项目需要扩展。

## 7. 安全边界

### 7.1 身份与授权

WebDev 调用 Dev Agent 时必须携带 Platform 签发的短期 token。Token 至少包含：

```text
aud=dev-agent
agentId
projectId
repoId
userId
jobId
scope
exp
```

Dev Agent 校验：

- token 签名。
- `aud=dev-agent`。
- `agentId` 与本机 enrollment 一致。
- `projectId` / `repoId` 已在本机白名单中。
- `scope` 覆盖当前任务类型。
- token 未过期。

PoC 阶段可以先使用静态 token，但必须尽快切到 Platform 签发的短期 token。

### 7.2 源码和密钥

- `.env`、Cloudflare token、SSH key 不回传 WebDev。
- WebDev 只保存日志、diff、测试结果和部署元数据。
- 日志输出需要做敏感值脱敏。
- Agent 禁止读取白名单 repo 以外的路径。

### 7.3 发布控制

- Preview / staging 可由授权开发者触发。
- Production 必须二次确认。
- 生产发布前必须展示 diff、测试结果和即将执行的命令模板。
- 所有发布动作写审计日志。

## 8. 建议数据模型

WebDev 元数据数据库可新增以下表。该数据库由 `hzy-data-runtime` 的 WebDev adapter 访问，WebDev Worker 不直接连接：

```text
webdev_agents
webdev_agent_tokens
webdev_projects
webdev_project_repos
webdev_command_templates
webdev_jobs
webdev_job_events
webdev_job_artifacts
webdev_deployments
```

关键字段：

- `webdev_agents`: `agent_id`, `owner_uid`, `endpoint`, `status`, `last_seen_at`, `version`
- `webdev_project_repos`: `project_id`, `repo_id`, `agent_id`, `local_path`, `default_branch`
- `webdev_command_templates`: `template_id`, `project_id`, `scope`, `cwd`, `argv_json`
- `webdev_jobs`: `job_id`, `project_id`, `repo_id`, `created_by`, `type`, `status`, `prompt`, `branch`
- `webdev_job_events`: `job_id`, `sequence`, `level`, `message`, `created_at`
- `webdev_job_artifacts`: `job_id`, `kind`, `uri`, `summary_json`
- `webdev_deployments`: `job_id`, `module`, `target`, `worker_name`, `version_id`, `url`

第一版可以先复用现有测试 MySQL 实例中的独立 schema，例如 `hzy_webdev`。如果后续 WebDev 独立产品化，再拆成独立数据库或独立 Data Runtime deployment。

## 9. API 草案

WebDev API：

```text
GET  /api/webdev/projects
GET  /api/webdev/agents
POST /api/webdev/jobs
GET  /api/webdev/jobs/:id
GET  /api/webdev/jobs/:id/events
POST /api/webdev/jobs/:id/cancel
POST /api/webdev/jobs/:id/approve
```

WebDev Worker 内部调用 Data Runtime：

```text
GET  /v1/webdev/projects
GET  /v1/webdev/agents
GET  /v1/webdev/jobs?page=1&pageSize=20&status=running&keyword=...
POST /v1/webdev/jobs
GET  /v1/webdev/jobs/:id
PATCH /v1/webdev/jobs/:id
POST /v1/webdev/jobs/:id/events
GET  /v1/webdev/jobs/:id/events
POST /v1/webdev/jobs/:id/artifacts
POST /v1/webdev/deployments
```

Dev Agent API：

```text
GET  /runtime/health
GET  /runtime/enrollment
POST /v1/jobs
GET  /v1/jobs/:id
GET  /v1/jobs/:id/events
POST /v1/jobs/:id/cancel
```

日志流第一版可使用轮询，后续改为 SSE 或 WebSocket。

## 10. 第一版 PoC 范围

第一版只支持一个开发机、一个 repo：

```text
agent: dev-agent-1.huizhi.yun
repo: huizhi-yun (config-relative path: ..)
project: huizhi-yun
```

最小闭环：

```text
登录 webdev.huizhi.yun
  -> 选择 huizhi-yun 项目
  -> 输入开发指令
  -> Mac Agent 调用 Codex 修改代码
  -> WebDev 展示日志和 diff
  -> 用户触发 typecheck
  -> 用户触发 finance/workflow 等模块部署
  -> WebDev 返回访问 URL
  -> 用户远程测试
```

第一版不做：

- 多租户客户侧开放。
- 任意 shell。
- 自动 push main。
- 无确认生产发布。
- 跨多开发机调度。
- 平台 Relay。

## 11. 实施计划

### 阶段 1：Dev Agent PoC

- 新建 `dev-agent` 或 `hzy-dev-agent` 包。
- Go 单二进制。
- 支持配置：
  - `HZY_DEV_AGENT_HOST=127.0.0.1`
  - `HZY_DEV_AGENT_PORT=19090`
  - `HZY_DEV_AGENT_ID`
  - `HZY_DEV_AGENT_TOKEN`
  - repo 白名单配置文件。
- 提供 `/runtime/health`。
- 支持 `git_diff`、`test`、`deploy_preview`。
- 通过 Cloudflare Tunnel 暴露开发机域名。

### 阶段 2：WebDev 应用骨架

- 新建 `webdev` Nuxt/Cloudflare 应用。
- 接入 Platform 登录。
- 接入 Data Runtime Client。
- 项目列表先硬编码或从 Platform 读取。
- 支持创建 job。
- 支持读取 job 状态和日志。
- 支持触发 Dev Agent 任务。

### 阶段 3：Codex 执行闭环

- Agent 调用本机 `codex` CLI。
- 为每个 job 创建任务分支：

```text
webdev/<job-id>
```

- 执行完成后生成 diff summary。
- WebDev 展示 diff 和文件列表。
- 用户确认后再运行测试或部署。

### 阶段 4：部署命令模板

- 固化各模块部署命令：
  - `finance.deploy.cloudflare`
  - `workflow.deploy.cloudflare`
  - `aims.deploy.cloudflare`
  - `assets.deploy.cloudflare`
  - `codocs.deploy.cloudflare`
  - `altoc.deploy.cloudflare`
- WebDev 页面提供目标选择。
- 部署完成后记录 Worker version id 和访问 URL。

### 阶段 5：权限、审计和生产发布

- 接入 Platform RBAC。
- 完成 `hzy-data-runtime` WebDev adapter 的 job/event/artifact/deployment API。
- 增加 production 发布确认。
- 增加审计日志。
- 增加敏感日志脱敏。
- 增加 job artifact 保存。

### 阶段 6：产品化增强

- 多开发机 enrollment。
- Agent 心跳和版本上报。
- Agent 自动更新。
- Dev Agent Tunnel 一键配置。
- 后续评估 `platform_relay`。

## 12. 与现有体系的关系

WebDev 与 Data Runtime Agent 属于同一种架构思想：

```text
平台托管控制面 + 本地/客户侧执行面
```

区别是：

- `hzy-data-runtime` 访问客户数据库，属于数据执行面。
- `hzy-dev-agent` 访问开发机源码和工具链，属于开发执行面。
- WebDev 自身的任务、日志、发布记录等元数据也通过 `hzy-data-runtime` 访问，不在 Cloudflare Worker 中直连数据库。

两者都不应把敏感资源迁入 Cloudflare Worker。Cloudflare 负责控制面、身份、域名、TLS、日志和编排。

## 13. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| prompt 触发危险命令 | 不开放任意 shell，只开放命令模板 |
| WebDev 绕过 Agent 直连数据库 | Cloudflare profile 固定为 `managed-cloud-agent`，不配置 Hyperdrive |
| 泄露本机密钥 | 日志脱敏，禁止回传 `.env` 和凭据文件 |
| 误发布生产 | production 二次确认，审计记录 |
| 本地 dirty worktree 被覆盖 | job 启动前检查工作区；默认任务分支；不自动 reset |
| Dev Agent 被外部调用 | 短期 token、Cloudflare Access、Agent 侧校验 |
| Codex 长时间运行 | job timeout、取消任务、日志流 |
| 多用户冲突 | 第一版单开发机串行执行；后续引入队列和锁 |

## 14. 结论

该方案可行。第一阶段建议先用 Cloudflare Tunnel 打通内部闭环，不引入平台 Relay。只要坚持“WebDev 控制面、Dev Agent 本地执行面、命令模板白名单、生产发布确认”的边界，就可以在不暴露源码和本地密钥的前提下，实现远程驱动 Codex 开发、自动部署和远程测试。

## 15. PoC 当前进展

已新增：

- `dev-agent`：Go 单二进制 Dev Agent PoC，支持 repo 白名单、命令模板、静态 token、任务状态、事件日志、取消任务。
- `webdev`：Nuxt / Cloudflare 应用骨架，提供本地 Web UI 和 `/api/webdev/*` 代理。
- `hzy-data-runtime` WebDev adapter 骨架：提供 `/v1/webdev/projects`、`/v1/webdev/agents`、`/v1/webdev/jobs`、`/v1/webdev/jobs/:id/events` 等固定元数据 API。
- `webdev/docs/webdev_schema.sql`：WebDev 元数据表结构。
- `docs/WebDev-PoC-Runbook.md`：本地启动、Cloudflare Tunnel、Worker 变量和 Data Runtime 边界说明。

当前已验证：

- `go test ./...`。
- `pnpm -C webdev run typecheck`。
- WebDev 页面可加载 Dev Agent enrollment。
- WebDev 可通过代理创建 `root.git-status` job 并展示事件日志。

尚未落地：

- Platform 登录 / RBAC。
- WebDev app 对 Data Runtime adapter 的 job/event/artifact 写入。
- Codex job 分支策略和 diff artifact。
- Cloudflare Worker 正式部署脚本。
