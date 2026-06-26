# WebDev Issue 收件箱设计

> 状态：阶段 1–4 已实现。阶段 1 收件箱后端；阶段 2 上报入口/service 鉴权/自动领取；阶段 3 Foundation `<IssueReporter>`（codocs 已接入，截图采集待补）；阶段 4 自动领取规则表化 + 项目设置 UI + 状态变更接统一消息中心。剩余增强：截图采集、规则多条化、消息中心事件契约对齐。
> 关联：ADR-015（WebDev 远程开发 Agent）、`docs/MODULE_CONTRACTS.md`、`docs/FOUNDATION_CAPABILITIES.md`
> 范围：WebDev（Nuxt）+ Data Runtime（Go）+ Foundation（共享报告组件与代理）

## 1. 背景与目标

WebDev 控制台已具备「Issue 收件箱」前端原型（`app/pages/issues.vue`，当前为示例数据）。本设计把它落地为真实能力：

1. 业务应用（codocs / finance / workflow 等）内嵌 **Foundation 通用报告组件**，用户一键反馈，自动采集页面上下文、控制台错误、截图与环境信息。
2. 报告进入 WebDev **Issue 收件箱**，可筛选、查看详情、指派、关闭。
3. 满足规则的 Issue **自动领取**：创建 Agent 任务（codex_task）并回填关联，形成「Issue → 任务 → Diff → 部署」闭环。

设计目标：与现有 jobs 链路一致（Data Runtime 落库、WebDev 瘦代理、Dev Agent 执行），并把跨应用入口收敛到 Console service token；不新增业务应用持有的 WebDev secret；最小侵入业务应用。

## 2. 范围与非目标

**本设计涵盖**：数据模型、API 契约、入口数据流、鉴权、状态机、自动领取规则、Foundation 报告组件、前端接入点、分阶段实施计划。

**非目标**：
- 不实现通用工单/客服系统；Issue 聚焦「研发可处理的缺陷/建议」。
- 截图与大附件不入库，仅存 OSS/对象存储 URI（复用现有 attachments 上传路径）。
- 自动领取规则首版用配置常量，不做规则编辑 UI（预留表结构演进）。

## 3. 架构与数据流

### 3.1 上报入口（业务应用 → WebDev）

```
[业务应用页面]
  └─ Foundation <IssueReporter/> 组件（客户端）
       · 采集：脱敏后的路由/URL、console 错误缓冲、可选截图、UA/版本
       · 截图经业务应用既有 OSS 适配上传，得到 URI；提交前可移除
  └─ POST /api/webdev-report/issues   （业务应用本地 Foundation server route）
       └─ Foundation server util:
          · 从 runtime config / service token claim 派生 source appCode
          · 用 resolveServiceAppBaseUrl('webdev') 解析 WebDev 服务端 base URL
          · 用 requestServiceAccessToken({ audience:'webdev', scope:'webdev:issue:write' })
          取 Console 签发的 token_use=service JWT
          └─ POST {webdev service base}/api/webdev/issues/intake   （带 service JWT）
                └─ WebDev 校验 Console JWKS / aud=webdev / token_use=service / scope=webdev:issue:write
                   · 来源 appCode 只信任 token hzy.appCode，客户端传值仅作显示 hint
                   · project_id / repo_id 由 WebDev 服务端映射表决定
                   · scope/page_key：客户端传 routePattern + scope，服务端拼 page_key = appCode:routePattern（见 §4.2）
                   · tenant 只从 token claim 或受信 Tenant Gateway header 派生
                   └─ dataRuntimeFetch → POST /v1/webdev/issues   （写 hzy_webdev.webdev_issues）
                      └─ 命中自动领取规则 → 幂等 claim → CreateJob（codex_task）→ 回填 linked_job_id
```

要点：
- 业务应用前端**不直连** WebDev，也不持有 WebDev 凭证；统一走 Foundation server proxy + Console service token（对齐根 `CLAUDE.md` 跨模块规则）。
- WebDev 不信任客户端传入的 `app_code`、`repo_id`、`tenant`、`reporter_uid`。这些字段由服务端从 token、会话和 allowlist/映射表生成或校验。
- 截图/console 错误在客户端采集，但必须执行客户端预览脱敏和 WebDev 服务端二次脱敏（见 §9）。

### 3.2 控制台读写（WebDev 用户 → WebDev → Data Runtime）

```
[WebDev 控制台 issues.vue]
  └─ GET/PATCH /api/webdev/issues[/...]   （Console OIDC 用户会话，webdev-auth 中间件）
       └─ dataRuntimeFetch → /v1/webdev/issues[...]   （Data Runtime 鉴权 + tenant 强制过滤）
```

与 jobs 完全相同的瘦代理形态。

### 3.3 运行时鉴权兼容性前置

现有 WebDev PoC 的 `dataRuntimeFetch` 仍读取 `HZY_WEBDEV_DATA_RUNTIME_TOKEN` 或受信 Tenant Gateway 注入 token；这与“完全使用 Console service token、不新增共享 secret”的目标态不同。落地时按以下顺序收敛：

1. 阶段 0 保留 PoC static token 兼容路径，但新 issue API 的设计和测试必须同时覆盖 Console service token 目标路径。
2. WebDev → Data Runtime 目标路径改为 Foundation Data Runtime client 或等价 helper，优先通过 `requestServiceAccessToken()` 获取短期 token。
3. Console service-client scope 的规范是 `resource:action`（如 `webdev:write`）；Data Runtime 当前 WebDev 路径要求 legacy dot scope（`webdev.write`）。在替换 static token 前，必须完成兼容层：Data Runtime 接受 `webdev:read` / `webdev:write` 与 `webdev.read` / `webdev.write`，或 Console 能为 Data Runtime 签发 legacy dot scope。
4. 兼容完成前，文档、README 和部署说明不得宣称 WebDev → Data Runtime 已完全摆脱 static token。

## 4. 数据模型

新增表，追加到 `webdev/docs/webdev_schema.sql` 与 Data Runtime `requiredTables`。命名/风格对齐既有 `webdev_jobs`（VARCHAR 主键、字符串时间戳、JSON 列、snake_case）。

```sql
CREATE TABLE IF NOT EXISTS webdev_issues (
  issue_id        VARCHAR(64) PRIMARY KEY,
  display_no      BIGINT UNSIGNED NOT NULL DEFAULT 0,              -- 租户内展示短号 #NNNN（按 tenant 分配，见 §4.1）
  project_id      VARCHAR(64)  NOT NULL DEFAULT '',
  app_code        VARCHAR(64)  NOT NULL DEFAULT '',                -- 来源业务应用（codocs/finance...）
  scope           VARCHAR(16)  NOT NULL DEFAULT 'page',            -- page | app（层级，默认页面级，见 §4.2）
  page_key        VARCHAR(256) NOT NULL DEFAULT '',                -- 归一化页面标识 app_code:routePattern（page 级必填，app 级为空）
  page_url        VARCHAR(1024) NOT NULL DEFAULT '',               -- 脱敏后的页面 URL（展示用，详情仍以 context_json 为准）
  repo_id         VARCHAR(64)  NOT NULL DEFAULT '',                -- 目标仓库（建任务用）
  tenant          VARCHAR(64)  NOT NULL DEFAULT '',
  fingerprint     VARCHAR(128) NOT NULL DEFAULT '',                -- 脱敏上下文指纹（去重/运营分析预留）
  severity        VARCHAR(16)  NOT NULL DEFAULT 'mid',             -- high | mid | low
  kind            VARCHAR(16)  NOT NULL DEFAULT 'bug',             -- bug | feature | question
  state           VARCHAR(24)  NOT NULL DEFAULT 'open',            -- 见 §7 状态机
  title           VARCHAR(256) NOT NULL,
  description     TEXT NULL,
  reporter_uid    VARCHAR(128) NOT NULL DEFAULT '',
  reporter_name   VARCHAR(128) NOT NULL DEFAULT '',
  assignee_uid    VARCHAR(128) NOT NULL DEFAULT '',
  context_json    JSON NULL,                                       -- 自动采集上下文（§9）
  linked_job_id   VARCHAR(64)  NOT NULL DEFAULT '',                -- 关联 Agent 任务
  claim_token     VARCHAR(128) NOT NULL DEFAULT '',                -- 幂等领取 token / clientRequestId
  source          VARCHAR(24)  NOT NULL DEFAULT 'reporter',        -- reporter | manual
  auto_claimed    TINYINT(1)   NOT NULL DEFAULT 0,
  claimed_at      VARCHAR(64) NULL,
  created_at      VARCHAR(64)  NOT NULL,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_webdev_issues_tenant_no (tenant, display_no),
  KEY idx_webdev_issues_tenant_state (tenant, state, created_at),
  KEY idx_webdev_issues_tenant_app (tenant, app_code, created_at),
  KEY idx_webdev_issues_tenant_page (tenant, app_code, page_key, created_at),
  KEY idx_webdev_issues_reporter_page (tenant, reporter_uid, page_key, created_at),
  KEY idx_webdev_issues_fingerprint (tenant, fingerprint, created_at),
  KEY idx_webdev_issues_job (linked_job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Issue 操作流水（指派/状态变更/领取，供详情时间线与审计）
CREATE TABLE IF NOT EXISTS webdev_issue_events (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant      VARCHAR(64) NOT NULL DEFAULT '',
  issue_id    VARCHAR(64) NOT NULL,
  actor       VARCHAR(128) NOT NULL DEFAULT '',        -- uid 或 'system'
  action      VARCHAR(48)  NOT NULL,                   -- created|claimed|assigned|state_changed|commented|closed
  detail_json JSON NULL,
  created_at  VARCHAR(64)  NOT NULL,
  KEY idx_webdev_issue_events_issue (issue_id, id),
  KEY idx_webdev_issue_events_tenant (tenant, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 租户内短号计数器（display_no 按 tenant 分配，见 §4.1）
CREATE TABLE IF NOT EXISTS webdev_issue_counters (
  tenant     VARCHAR(64) PRIMARY KEY,
  next_no    BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 4.1 短号分配（按租户）

`display_no` 是租户内自增的展示短号（`#NNNN`），与全局 `issue_id` 解耦，满足租户隔离。分配在 Data Runtime 创建 Issue 的同一事务内完成：

```sql
INSERT INTO webdev_issue_counters (tenant, next_no) VALUES (?, 2)
  ON DUPLICATE KEY UPDATE next_no = next_no + 1;
-- 取回本次分配值（next_no - 1），写入 webdev_issues.display_no
```

要点：必须与 Issue 插入在同一事务（`SELECT ... FOR UPDATE` 或上述原子自增），保证同租户并发上报不重号；`uk_webdev_issues_tenant_no` 作为兜底唯一约束。跨租户互不影响。

### 4.2 层级（全局 / 页面）

Issue 分两个层级，由 `scope` 区分：

- **页面级 `page`（默认）**：绑定具体页面，用 `page_key` 标识。报告组件从当前页面提交时默认页面级。
- **全局级 `app`**：与具体页面无关的应用级反馈（如整体功能建议），`page_key` 为空。报告组件提供「与当前页面无关」选项切到全局级。

`page_key` 归一化规则（关键：用路由模式而非原始 URL，保证同一页面在不同实例/参数下聚合，且不含 PII）：

```
page_key = app_code + ':' + matchedRoutePattern
# 例：codocs:/share/:uuid  （而非 /share/dQk3f8）
```

- 客户端只传 `routePattern`（Vue Router 匹配到的 route record path，不含动态参数实际值）；`app_code` 由 WebDev 服务端从 token 派生，`page_key` 由服务端拼装与归一化，不信任客户端直传的完整 `page_key`。
- 原始访问 URL 经脱敏后存 `page_url`（展示）与 `context_json.url`（详情）。

`context_json` 结构：

```jsonc
{
  "url": "https://wiztek.huizhi.yun/codocs/share/dQk3f8",
  "urlRedacted": true,
  "route": "codocs › share-uuid",
  "appVersion": "v2.8.3 (build 51a9f2e)",
  "env": { "ua": "Chrome 137", "os": "macOS", "stage": "production" },
  "consoleErrors": [
    { "level": "error", "message": "GET /api/codocs/share/dQk3f8 → 404", "at": "ShareView.vue:84" }
  ],
  "screenshotUri": "oss://codocs/issues/2026/06/xxx.png",
  "network": [{ "method": "GET", "path": "/api/codocs/share/:uuid", "status": 404 }],
  "redaction": { "client": true, "server": true }
}
```

## 5. API 契约

### 5.1 Data Runtime（Go，`/v1/webdev/issues`）

加到 `internal/apps/webdev/adapter.go` 的 `HandleRuntime` switch。鉴权目标态使用 Console service token，scope 采用 `webdev:read` / `webdev:write`；迁移期兼容现有 Data Runtime legacy scope `webdev.read` / `webdev.write`。

Data Runtime 必须执行 tenant 级强制过滤：
- `tenant` 由已验证 token claim 或受信 Tenant Gateway header 派生，不接受请求 body/query 覆盖。
- 列表、详情、更新、events 都必须限制在当前 tenant。
- 当前 `HandleRuntime` 未向 WebDev adapter 传递 auth context；实现时需扩展 adapter 入参，或由 server 层在鉴权后注入可信 tenant/actor，并禁止客户端覆盖。

| Method | Path | 说明 | operation |
| --- | --- | --- | --- |
| GET | `/v1/webdev/issues` | 列表，query: `page,pageSize,state,appCode,scope,pageKey,severity,keyword`，强制 tenant 过滤 | `webdev.issues.list` |
| POST | `/v1/webdev/issues` | 创建（intake 与 manual 共用），tenant/server fields 服务端写入 | `webdev.issues.create` |
| GET | `/v1/webdev/issues/:id` | 详情（含 events） | `webdev.issues.get` |
| PATCH | `/v1/webdev/issues/:id` | 改 state/assignee/linked_job_id | `webdev.issues.update` |
| POST | `/v1/webdev/issues/:id/events` | 追加流水 | `webdev.issue_events.create` |

返回沿用 `DataResult[T]` / `IssueList{items,total,page,pageSize}`，与 `Job`/`JobList` 一致。

### 5.2 WebDev（Nuxt，`/api/webdev/issues`）

瘦代理 + 业务编排，文件镜像 jobs 目录结构：

| Method | Path | 行为 |
| --- | --- | --- |
| GET | `/api/webdev/issues` | `dataRuntimeFetch` 列表，归一化分页 |
| GET | `/api/webdev/issues/:id` | 详情 |
| POST | `/api/webdev/issues` | 控制台手动创建（用户态） |
| PATCH | `/api/webdev/issues/:id` | 状态/指派/关闭，写 issue_events |
| POST | `/api/webdev/issues/:id/claim` | 幂等创建 Agent 任务（复用 `devAgentFetch /v1/jobs` + `persistJobSnapshot`），回填 `linked_job_id`、state→`in_progress`；已有 job 时返回现有关联 |
| POST | `/api/webdev/issues/intake` | **报告组件入口**，service token 鉴权，服务端派生 app/repo/tenant，写库 + 自动领取 |
| GET | `/api/webdev/issues/mine` | **报告组件用**，service token 鉴权，按 `reporter_uid + tenant + app_code` 返回该提交者近期已提报 Issue；支持 `scope`（默认 `page`）+ `pageKey` 按层级过滤（供提交前自行判断是否重复，替代自动去重） |

### 5.3 Foundation（业务应用侧）

- 客户端组件：`<IssueReporter />`（见 §9）。不允许客户端指定可信 `app_code` / `repo_id`；最多传 `source-label` 这类展示 hint。
- Server util：`reportWebDevIssue(event, payload)` — 内部用 `requestServiceAccessToken({ audience: 'webdev', scope: 'webdev:issue:write' })`，并通过 `resolveServiceAppBaseUrl(event, 'webdev')` POST 到 WebDev intake。`listMyWebDevIssues(event)` 同理走 service token 调 `/api/webdev/issues/mine`。
- Server route：`/api/webdev-report/issues`（业务应用 server 端）：POST 转发上报；GET 返回当前用户已提报列表。`reporter_uid`/`reporter_name` 由业务应用**服务端会话**派生后注入，不接受客户端传值。
- 同步更新 `docs/FOUNDATION_CAPABILITIES.md` 与 `docs/MODULE_CONTRACTS.md`（新增「业务应用 → WebDev Issue 上报」调用关系）。

## 6. 鉴权

| 入口 | 主体 | 校验 |
| --- | --- | --- |
| `/api/webdev/issues*`（控制台） | Console OIDC 用户 | 现有 `webdev-auth` 中间件（用户登录 + app grant / allowlist） |
| `/api/webdev/issues/intake`（上报） | Console service JWT | service-only；要求 `authenticated=true`、`subjectType=service`、`tokenUse=service`、`aud=webdev`、scope 含 `webdev:issue:write`，并校验 token claim `hzy.appCode` ∈ 允许上报应用集合 |
| WebDev → Data Runtime `/v1/webdev/*` | Data Runtime bearer token | 目标态使用 Console service JWT；scope canonical 为 `webdev:read` / `webdev:write`，迁移期兼容 `webdev.read` / `webdev.write` 和 PoC static token |

`webdev-auth.ts` 调整：

- 对 `/api/webdev/issues/intake` 走 `requireWebDevService(event)`，不得再落入 `requireWebDevUser`。
- `requireWebDevService` 复用 Foundation `resolveConsoleAuthContext()` / `event.context.consoleAuth`，但必须显式检查 `aud`、`scope`、`token_use`、`subjectType` 和 `hzy.appCode`。
- 当前 `foundation/server/middleware/console-auth.ts` 只对白名单 Console API path 接受 service bearer；WebDev 自己的中间件需要在本模块完成 service token 解析/验证，或扩展 Foundation 中间件的可配置 service path 白名单。
- `x-hzy-app-code`、请求 body `appCode`、组件 prop 只能用于诊断显示；授权来源只认 token claim。

Console service-client grant 种子需新增：

| 调用方 | audience | scope | 用途 |
| --- | --- | --- | --- |
| codocs.runtime / finance.runtime / workflow.runtime 等 | `webdev` | `webdev:issue:write` | 业务应用上报 Issue 到 WebDev intake |
| webdev.runtime | `data-runtime` 或部署指定 audience | `webdev:read webdev:write`（或兼容 `webdev.read webdev.write`） | WebDev 读写自身元数据 |

## 7. 状态机

```
open(待领取) ──claim lock──▶ claiming(内部态) ──job created──▶ in_progress(修复中) ──任务 succeeded──▶ verifying(待验证)
   │                         │ fail/retry                    │                                      │
   └──────────── close ◀─────┴──────────────────────────────┴──────────── resolve ◀───────────────┘
                  (closed 已关闭)                                             (resolved 已解决)
```

- 用户可见状态码：`open | in_progress | verifying | resolved | closed`。
- 内部瞬态：`claiming`，只用于幂等领取锁；前端可按“领取中”展示，也可归入“修复中”。
- 前端筛选标签：全部 / 待领取(open) / 修复中(in_progress) / 待验证(verifying) / 已解决(resolved)。
- 任务终态联动：首版**手动**置 `verifying` / `resolved`，不做自动联动（评审决定）。
- 通知：状态变更与领取统一写 `webdev_issue_events`；通知由**统一消息中心**消费（当前预留 hook，不在本设计实现具体渠道）。建议实现时在状态变更处发布一个标准事件（如 `webdev.issue.state_changed`），消息中心订阅后决定渠道（站内/钉钉/企微）。

## 8. 自动领取规则

自动领取首版默认只在 intake 路径执行；控制台手动创建 Issue 不自动 claim，除非用户点击“创建 Agent 任务”。规则先用服务端常量配置，环境变量可覆盖：

```
auto_claim = severity == 'high'
          && app_code ∈ AUTO_CLAIM_APPS   (默认 {finance, workflow, codocs})
          && kind == 'bug'
          && repo_id 已通过 WebDev 服务端映射解析
          && linked_job_id == ''
          && state == 'open'
```

领取必须幂等：

1. WebDev 生成稳定 `claim_token = sha256(tenant + issue_id + repo_id)`，并执行条件更新：`WHERE tenant=? AND issue_id=? AND state='open' AND linked_job_id=''`。成功后把 state 置为 `claiming`、写入 `claim_token`、`auto_claimed`。
2. 条件更新影响行数为 0 时，重新读取 Issue：已有 `linked_job_id` 则返回现有关联；仍为 `claiming` 则返回 202；其它状态返回 409。
3. 创建 Dev Agent job 时把稳定的 `claim_token` 作为 **`clientRequestId`（Dev Agent 幂等键）** 传入。Dev Agent 已支持：相同 `clientRequestId` 的重复/并发请求返回同一个 job（HTTP 200），不会重复执行（见 `dev-agent` `POST /v1/jobs`）。因此第 2 步条件更新与 Dev Agent 幂等键形成双保险：即使 WebDev 在 job 创建后丢失响应并重试，也只会拿回同一个 job。
4. job 创建成功后回填 `linked_job_id`、`claimed_at`、state→`in_progress`，并写 `issue_events(action='claimed', actor='system' | uid)`。
5. 注意：Dev Agent 幂等键是**内存态**，agent 重启即清空；`claim_token` 必须是确定性值（`sha256(tenant+issue_id+repo_id)`），并以 WebDev/Data Runtime 持久化的 `linked_job_id` 为最终事实源，重启后用第 2 步的条件更新兜底，不重复建任务。

规则后续可迁到 `webdev_command_templates` 同级的规则表，UI 在「项目设置」维护。迁到规则表前，前端只读展示当前规则，不提供可切换开关。

## 9. Foundation 报告组件

`<IssueReporter>`（客户端，浅色 UI）：

- 悬浮「反馈」按钮 → 弹窗；类型选择（缺陷/功能建议/使用咨询）→ 映射 `kind`。
- 自动采集（提交前可逐项移除）：
  - 当前 route path 与 origin；默认去除 query/hash，必要时只保留脱敏后的白名单 query。
  - 全局 console 错误环形缓冲（plugin 在 app 启动注入，最多 N 条、单条限长、总大小限长）。
  - 同源 network 摘要：只采集 method、脱敏 path、status、duration；不采集 headers、Cookie、Authorization、request/response body。
  - `html2canvas` 截图可选，提交前必须预览；支持 `data-hzy-report-mask` / `data-hzy-report-ignore` 标记敏感区域，默认对 input/textarea/contenteditable 和常见金额/手机号/邮箱文本打码。
  - 环境：UA、应用版本（来自 `useAppInfo`/runtimeConfig）、stage。tenant 不从客户端提交，由服务端派生。
- 层级（§4.2）：默认提交为**页面级**，弹窗采集当前 `routePattern`；提供「与当前页面无关（全局反馈）」开关切到**全局级**。
- 重复判断（替代自动去重）：弹窗打开时调用 `/api/webdev-report/issues`（GET）拉取当前用户已提报列表，**按当前层级过滤**——页面级默认只看本页面（`scope=page&pageKey=<当前页>`），可切「本应用全部」查看全局/其它页面；在提交区上方展示（含状态），由提交者自行判断是否重复后再提交。服务端仍写入 `fingerprint` 供运营分析，但不自动合并。
- 隐私：
  - 客户端做 PII 正则脱敏（手机号/邮箱/身份证/银行卡等）。
  - WebDev intake 服务端二次脱敏，并限制 title、description、consoleErrors、network、context_json 总大小。
  - 截图 URI 只保存对象引用；读取截图时必须通过业务应用或 WebDev 的受控签名 URL，不直接暴露永久公共 URL。
- 截图上传优先复用业务应用既有 OSS 适配（Foundation integration adapter），仅传 URI；若统一 WebDev 桶后续落地，需要额外定义跨租户读取授权。

集成方式：业务应用在 `app.vue`/默认 layout 挂 `<IssueReporter />`；console 错误捕获用 Foundation client plugin。业务应用本地 `/api/webdev-report/issues` 从当前 runtime config 派生 appCode，不接受客户端覆盖。

## 10. 前端接入（issues.vue 改造点）

- 移除示例常量，改 `useFetch`/`$fetch` 拉 `/api/webdev/issues`（列表）与 `/api/webdev/issues/:id`（详情）。
- 筛选标签接 `state` query，数量由列表 API 或统计字段返回；自动领取规则首版只读展示，不放可操作开关。
- 列表展示 `scope` 徽章（页面级/全局级）；支持按 `app_code` 与 `page_key` 过滤（页面级 Issue 可点 `page_key` 聚合查看同页所有反馈）。详情展示 `page_url` 与归一化 `page_key`。
- 「创建/查看 Agent 任务」：无 linked job → `POST /:id/claim`，成功后跳任务页并定位 `linked_job_id`；已有 linked job 则直接跳任务页。
- 详情上下文卡片渲染 `context_json`（页面/路由/环境/console 错误/截图）。
- 报告组件预览弹窗替换为引用真实 `<IssueReporter preview />`。

## 11. 分阶段实施计划

0. **阶段 0 — 鉴权与运行时前置**：确认 Console service scope 规范；补 `webdev:issue:write` grant 种子；为 WebDev → Data Runtime 选择并实现 scope 兼容策略；文档同步 README / `MODULE_CONTRACTS` / `FOUNDATION_CAPABILITIES`。
1. **阶段 1 — 收件箱后端打通**：schema + Data Runtime adapter（tenant-scoped issues CRUD + events）+ WebDev `/api/webdev/issues*`（列表/详情/manual 创建/幂等 claim）+ `issues.vue` 接真实数据。可独立验证：控制台手动建 Issue → 手动 claim → 建任务。
2. **阶段 2 — 上报入口**：WebDev `intake` 端点 + service 鉴权 + 来源应用 allowlist + 服务端 app→repo 映射；Foundation server util + 业务应用 proxy route。自动领取先放在功能开关后。
3. **阶段 3 — Foundation 报告组件（已实现，截图待补）**：`<IssueReporter>` 组件 + `issue-console-capture.client.ts`（console/error 环形缓冲）+ `useIssueReporter()`（采集/脱敏/提交/我已提报）+ codocs `app.vue` 接入。截图采集（html2canvas + 涂抹 + OSS 上传）为重依赖，暂未引入，作为后续增强。
4. **阶段 4 — 规则与消息中心对接（已实现）**：自动领取规则迁到 `webdev_issue_settings`（按租户单条配置，env 兜底），Agent/项目设置页可视化编辑，intake 读规则评估；Issue 领取与状态流转到 `verifying/resolved/closed` 时经 Foundation `publishNotification` 通知反馈人（best-effort，`bizType=webdev_issue`）。后续：规则多条化（按 app/page 细分）、与消息中心标准事件 schema 对齐。

## 12. 评审决定与遗留问题

评审已定（已并入正文）：

1. **任务终态联动 → 手动**：首版不自动把 Issue 置 `verifying`，由人工在控制台流转（§7）。
2. **短号 → 按租户分离**：`display_no` 按 tenant 自增分配，新增 `webdev_issue_counters` + 事务内分配（§4.1）。
3. **截图存储 → 业务应用 OSS**：复用业务应用既有 OSS 适配，仅存 URI，读取走受控签名 URL（§9）；不引入 WebDev 统一桶。
4. **去重 → 提交前展示已提报列表**：报告组件提交前通过 `/api/webdev/issues/mine` 拉取该提交者已提报 Issue，由提交者自行判断；不做自动合并（§5.2、§9）。
5. **通知 → 接统一消息中心（预留）**：状态变更写 `webdev_issue_events` 并发布标准事件，由统一消息中心订阅决定渠道；本设计不实现具体渠道（§7）。
6. **层级 → 全局/页面两级，默认页面级**：新增 `scope` + 归一化 `page_key`（`app_code:routePattern`）+ 展示用 `page_url`；「我已提报」与收件箱均按层级过滤（§4.2、§5、§9、§10）。

7. **Dev Agent 幂等键 → 已落地（方案 A）**：Dev Agent `POST /v1/jobs` 已支持 `clientRequestId`，相同 key 返回同一 job、不重复执行；claim 用确定性 `claim_token` 作为 key（§8）。键为内存态，重启后以持久化 `linked_job_id` + 条件更新兜底。

仍需在实现阶段确认：

8. **统一消息中心契约**：标准事件 schema 与订阅方式待消息中心模块定义后对接。
9. **统一引擎层（单独演进项）**：当前 Dev Agent 以「命令模板 + argv」直接 exec（`codex exec` / `claude -p`），无引擎抽象、无结构化输出（plan/tool_call/diff）。引擎 adapter 层（含结构化事件、引擎选择、凭证经 Console vault）建议作为 ADR-015 子项单独立项，不阻塞 Issue 收件箱。
