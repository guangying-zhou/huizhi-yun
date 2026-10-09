# Altoc / Finance 上线前走查 ISSUE 清单（Stream B · 第一阶段）

> 走查日期：2026-08-26 | 分支：`stream-b-altoc-finance-9-10` | 任务书：[`Altoc-Finance-走查任务书-2026-09.md`](./Altoc-Finance-走查任务书-2026-09.md)
>
> 方式：静态代码走查 + 生产租户 `C000001`（`oa.wiztek.cn`）**只读**数据库核验。本轮未改任何业务代码，未执行任何写操作。
>
> 部分结论依赖业务方与运维确认，已在对应条目内注明确认时间与结论。

---

## 0. 结论摘要

| 级别 | 数量 |
| --- | --- |
| **P0** | **11** |
| P1 | 15 |
| 合计 | 26 |

> **修订记录（2026-08-27）**
>
> - **ISSUE-B-011 升 P0**：原判 P1 并标注「待业务方确认是否为有意配置」，业务方确认**非有意配置**，据此升级（P0 由 6 条增至 7 条）。
> - **ISSUE-B-008 维持 P1 并扩展**：运维确认 `HZY_INTERNAL_KEY`、`SKIP_PERM_CHECK`（altoc）与 `HZY_FINANCE_DEV_PERMISSIONS`（finance）**三个权限旁路开关在生产全部未设置**，无现网暴露面。该条已扩展为覆盖两个模块的三个开关。
> - 两条**待确认项（B-008 / B-011）均已关闭**，所有 ISSUE 的定级不再依赖未知信息。第 3 节列出的未覆盖范围（未做浏览器端到端走查、写操作未实测、分支流程未走查）**仍然有效**。
>
> ISSUE 编号在升降级后保持不变，级别以各条目内标注为准。
>
> **修订记录（2026-08-28）**
>
> - **新增 ISSUE-B-026（P1）**：四个应用缺 `notifications:publish` grant，死信与到期告警静默失效（P1 由 14 条增至 15 条，合计 26）。B-025 端到端复验时从生产 Worker 日志读到，静态走查看不出来。

## 0.1 修复状态（2026-08-27 第二阶段）

**7 条 P0 已全部完成代码修复。** 分布在三个 MR：

| ISSUE | 修复内容 | 归属 MR | 生产动作 |
| --- | --- | --- | --- |
| B-001 | Altoc 半边：投递失败不再吞成绿色成功 | !13 | — |
| B-001 | Console 半边：补 `finance:invoice-request:create` grant + 修复覆盖度校验调用方盲区 | **!14** | ✅ seed 已执行 / ⬜ 令牌签发探测待做 |
| B-002 | 补 `payment_request.reject_reason` 迁移 + 驳回对列漂移失败降级 + 纳入 schema status | !13 | ✅ 迁移已执行 |
| B-003 | 四张审批单据创建只允许 `draft` | !13 | — |
| B-004 | 职责分离只认受信 actor + 制单人以已落库记录为准 + BFF 清洗伪造别名 | !13 | — |
| B-005 | 履约启动交付编排未完成时明确告警 | !13 | — |
| B-006 | 开票申请幂等键按已终结 operation 递进，支持分次开票 | !13 | — |
| B-011 | 配置：移除 4 个非财务岗位的 `finance:viewer` | !13（脚本） | ✅ **已在生产执行并核验** |
| B-011 | 代码：未配置范围时失败关闭 | **!15** | ✅ Seed v2.34 已执行，**可安全部署** |

顺带关闭 P1 两条：**B-016**（`financeSubmitError` 死分支）、**B-017**（取不到开票申请编号）。

### 生产动作执行记录（2026-08-27，获授权后执行）

三项 SQL **均已在生产租户 C000001 执行并核验**，每项都先 dry-run 确认影响面：

| 脚本 | 目标库 | 结果 |
| --- | --- | --- |
| `Console-SQL-Seed-v2.1-altoc-caller-cross-app-grants.sql` | `hzy_console` | 新增 2 条 grant（468 → 470 行）；verify 两条均 `granted=1` |
| `20260827_payment_request_reject_reason.sql` | `hzy_finance` | `payment_request` 补 `reject_reason`；四张审批表现均齐全（该表 0 行，无数据风险） |
| `HZY-Platform-SQL-Seed-v2.34-finance-explicit-tenant-global-scopes.sql` | `hzy_platform` | 新增 46 行 `tenant:global`（0 → 46）；脚本自带核验通过：权限点数与范围行数逐一相等（7/13/6/20） |

**部署 !15 的安全前置已满足。** 独立复核确认：不存在「有持有人 + 有 Finance 应用角色 + 无任何数据范围」的角色。唯一无范围的 `finance:admin`（财务管理员）持有人为 0 且角色本身 disabled。

部署 !15 后的最终形态：

| 角色 | Finance 应用角色 | 持有人 | 数据范围 |
| --- | --- | --- | --- |
| `department_manager` | `finance:expense_approver` | 6 | department（按人） |
| `system_admin` | `finance:admin` | 4 | tenant:global（显式） |
| `deputy_general_manager` | `finance:viewer` | 2 | department（按人） |
| `finance_accountant` | `finance:accountant` | 1 | tenant:global（显式） |
| `finance_director` | `finance:expense_approver` + `finance:manager` | 1 | tenant:global（显式） |
| `general_manager` | `finance:viewer` | 1 | tenant:global（显式） |

**⚠️ 仍未完成的一件事：令牌签发探测。**

Console grant 的 SQL 行已存在且 verify 通过，但按根 `CLAUDE.md` 要求，还必须用实际
service client 对 `finance:invoice-request:create` 做一次真实令牌签发探测：

```bash
curl -sS -X POST https://wiztek.huizhi.yun/oauth/token \
  -H 'content-type: application/json' \
  -d '{"grant_type":"client_credentials","client_id":"altoc.runtime",
       "client_secret":"<Cloudflare Worker secret HZY_SERVICE_CLIENT_SECRET>",
       "audience":"finance","scope":"finance:invoice-request:create",
       "source_binding":"trusted-gateway"}'
```

> **端点路径**：只有 `/oauth/token`（`console/server/routes/oauth/token.post.ts`）。
> 配置里出现的 `/api/v1/console/auth/service-token`、`/api/v1/console/oauth/token`
> 不是真实路由，Foundation 的 `normalizeTokenUrl` 会把它们统一改写成 `/oauth/token`。
>
> **端点 host**：必须走租户网关 `https://wiztek.huizhi.yun`，**不带 `/console` 前缀**。
> 已实测三种写法（2026-08-27，用无效密钥探测）：
>
> | URL | 响应 |
> | --- | --- |
> | `wiztek.huizhi.yun/oauth/token` | ✅ `401 invalid_client`（端点正确） |
> | `console.huizhi.yun/oauth/token` | `503 Console tenant-runtime is required`（该 host 未绑定租户） |
> | `wiztek.huizhi.yun/console/oauth/token` | 返回 SPA HTML（多了前缀，未匹配路由） |
>
> 判读：`access_token` = 打通；`403 insufficient_scope` = grant 未生效；
> `401 invalid_client` = secret 取错，不是授权问题。
>
> `aims:service-ticket:work-item:create` 用同样方式探测（`audience` 改 `aims`）。

拿到 `access_token` 才算授权真正打通。本轮走查的起因（seed v1.43 在仓库里却从未生效）
恰好证明：**只验证 SQL 行存在不足以证明授权完成**。该 secret 存于 Cloudflare Worker，
不在数据库明文中。

修复过程中发现的两处清单误差，已在对应条目内更正：
- **B-003 范围被低估**：`expense_claim` / `project_expense_request` 有同样的白名单，支出侧三条审批链全部可绕过，不只是付款申请。
- **B-004 有一处误判**：内置静态职责冲突规则其实存在（详见该条更正块）。

---



### ISSUE-B-024（P0，**本轮最重要的发现**）：业务应用之间没有 Service Binding，跨应用调用在 Worker 间静默不通

**这是「自动编排从未跑通」的真正根因**，也解释了本清单开头所有「0 行」现象。

**证据链（全部生产实测）**

1. **应用之间没有 Service Binding。** 六个业务应用的 Cloudflare 配置渲染器里，`services` 一律只有一条：

   ```
   altoc / finance / aims / assets / codocs / people
     → HZY_CONSOLE_SERVICE -> hzy-console-prod
   ```

   即只有「业务应用 → Console」有 Service Binding，**应用之间（altoc→finance、altoc→aims、finance→altoc…）一条都没有**。

2. **应用间调用走的是租户公网网关地址。** `foundation/server/utils/serviceAppUrl.ts:223-240`
   在托管云下把目标应用解析为 `https://{租户网关host}/{app}/`，即
   `https://wiztek.huizhi.yun/finance/api/v1/finance/service/invoice-requests/create`。

3. **该地址从外部可达，从 Worker 不可达。**
   - 浏览器 POST 该 URL → `401 Console service token is required`（路由正常）
   - Altoc Worker POST 同一 URL → `wrangler tail hzy-finance` **零入站**

4. **失败完全静默。** `hzy-altoc` tail 显示请求 outcome 为 `Ok`；Altoc 侧 operation 停在
   `processing`、`attempt` 的 `finished_at` 为空、`last_error_code` 为 NULL——
   既没走 `:succeed` 也没走 `:fail`，operation 直接成为孤儿。

5. **旁证：所有应用间 capability 从未被签发过。**
   `altoc.runtime` 的 `finance:read` / `finance:write` / `aims:read` / `aims:write`
   全部 `last_used_at IS NULL`；而经 Service Binding 的 `console:directory-users:read`
   和走 data-runtime 的 `data-runtime:altoc:*` 都有近期使用记录。

**这解释了本清单开头的全部「0 行」**：`contract_orchestration_job`、两侧
`integration_operation`、`finance_reconciliation` 为 0，不是「没人用」，而是
**这条链在 Worker 间根本走不通**。

> 根 `CLAUDE.md` 其实已经写明这个约束，但只针对 Console：
> 「托管云业务 Worker 访问 Console token/runtime/service API 必须通过
> `HZY_CONSOLE_SERVICE -> hzy-console-prod` Service Binding……不得经租户公网地址
> 形成跨 Worker 自等待。」
>
> **同一约束对应用之间同样成立，但既没有实现也没有写进规则。**

**期望**：应用间调用改用 Service Binding（与 Console 同一模式），或改由 data-runtime
侧中转；无论哪种，跨 Worker 调用失败都必须显式报错，不能静默丢弃。

**修复面（超出 Stream B 边界，需单独立项）**
- `foundation/server/utils/serviceAppUrl.ts` + `callServiceApp` 系列 helper
- 六个应用的 `render-cloudflare-config.mjs` 增加应用间 `services` 绑定
- 属 `foundation/` 归属，按协作约束不进本分支

**本条未修复前，Altoc/Finance 的跨应用主线（开票申请、合同激活建项目、核销回写、
工单派发）在生产全部不可用**，与 grant、schema、时区三类问题相互独立。



### ISSUE-B-025（P0）：入站服务令牌 introspection 打向不带租户上下文的 Console host，恒返回 503

**这是 B-024 修好之后暴露的下一块多米诺**，此前从未被触发——因为根本没有请求能到达业务应用的 service 端点。

**现象**（B-024 与前缀修正部署后，`wrangler tail hzy-finance` 实测）

```
URL:     https://wiztek.huizhi.yun/finance/api/v1/finance/service/invoice-requests/create
method:  POST        outcome: ok (15ms)
log:     [console-auth] service token introspection request failed
         { statusCode: 503, summary: 'Service token introspection unavailable' }
```

Finance 在 `requireForwardedServiceCapability` → `ensureFinanceConsoleAuth` 阶段
向 Console 做服务令牌 introspection 拿到 503，整条调用失败。Altoc 侧 operation
停在 `processing`，租约到期后转 `partial_unknown`（`error_code: lease_expired`）。

**根因（生产直接对照实测）**

```
POST https://console.huizhi.yun/oauth/introspect   -> 503 service_token_introspection_unavailable
POST https://wiztek.huizhi.yun/oauth/introspect    -> 200 {"active":false}
```

`console.huizhi.yun` **不携带租户上下文**，Console 无法解析租户运行时，该 host 上的
introspect（以及 `/oauth/token`）一律 503；租户网关 host `wiztek.huizhi.yun` 带上下文，
同一端点正常。

Finance Worker 的 `HZY_CONSOLE_RUNTIME_API_URL` 正是 `https://console.huizhi.yun`
（见 `wrangler deploy` 输出的 vars），而 `resolveConsoleOidcEndpointBaseUrl`
（`foundation/server/utils/consoleOidc.ts:349-372`）按
`HZY_CONSOLE_OIDC_API_URL || HZY_CONSOLE_RUNTIME_API_URL` 取值，于是 introspection
被打向了那个不带租户上下文的 host。

> **走 Service Binding 解决不了这一点。** Binding 只是绕过公网边缘，Console 仍按
> 请求的 Host / 上下文解析租户；用 `console.huizhi.yun` 作 URL 依然拿不到租户。

**影响面**：不限于 Finance。任何业务应用校验入站服务令牌都走同一条 Foundation 路径，
**B-024 修好后，所有跨应用调用都会卡在这一层。**

**期望**：introspection 打向带租户上下文的端点（租户网关 host），或由 Console 在
Service Binding / 无 Host 上下文时从受信 header（`x-hzy-tenant` / `x-hzy-deployment`）
解析租户。二者选一，需与 Console 侧一并设计。

**归属**：`foundation/` + `console/` 共享层，超出 Stream B 边界，需单独立项。

**逐层推进对照**（同一个「申请开票」动作）

| 阶段 | Finance 侧入站 | 失败点 | operation 终态 |
| --- | --- | --- | --- |
| 走查发现时 | 零 | 无（完全静默） | 孤儿 `processing` |
| 补 grant 后 | 零 | 无（仍静默） | 孤儿 `processing` |
| B-024 部署后 | ✅ 收到 | `403 Unsupported capability`（前缀被误剥） | `failed_permanent` |
| 前缀修正后 | ✅ 收到 | **`503` introspection 不可用** | `partial_unknown` |

每一层都是真实推进：从「请求消失」到「明确报错」，现在卡在最后一层认证上。

### B-024 的生产验证与实现坑（2026-08-28）

MR !21 合并并部署 `hzy-altoc` / `hzy-finance` 后做了端到端复验，结论分两半。

**① 机制确实是对的。** Service Binding 打通后，同一个「申请开票」动作的表现：

| 观测点 | 修复前 | 部署后 |
| --- | --- | --- |
| Finance 侧入站 | **零**（`wrangler tail hzy-finance` 全空） | ✅ 收到请求 |
| `integration_operation_attempt.finished_at` | 空 | ✅ 已填 |
| operation 终态 | 孤儿卡在 `processing` | ✅ `failed_permanent` |
| 错误信息 | 无（完全静默） | ✅ `http_403` + 明确消息 |

从「静默黑洞」变成「真实往返 + 明确报错 + 正确落终态」。附带验证了
`serviceAppFetch` 的错误形状设计有效——`classifyServiceOperationFailure`
能正常把 403 判为确定性失败并落终态，而不是又一次降级成 pending。

**② 但首版实现有一个错，只有真跑才会暴露。**

首版 `normalizeAppServiceBindingUrl` 无条件剥掉 `/{app}` 网关前缀，照抄了
`normalizeConsoleServiceBindingUrl`。这是**把特例当成了通例**：

- Console Worker 的 `HZY_APP_BASE_PATH` 是 `/`，自身路由不含 `/console`，所以要剥
- 业务应用的 base path 就是 `/{app}/`，Worker 期望收到带前缀的路径

生产实测（直连 workers.dev，等价于 Service Binding 路径）：

```
POST /api/v1/finance/service/invoice-requests/create          -> 302（未匹配路由）
POST /finance/api/v1/finance/service/invoice-requests/create  -> 401（正确匹配，要求令牌）
```

已在 MR !25 改为默认不剥，只有调用方通过 `targetBasePath` 显式声明目标挂在
根路径时才剥。

> **给后续做同类改造的人**：这个错误 lint、typecheck、单测**全都发现不了**——
> 静态检查只能证明代码自洽，证明不了它和目标 Worker 的路由约定一致。
> 跨应用改造必须以「目标 Worker 实际收到什么路径」作为验收，不能只看本地绿。
> 直连 `workers.dev` 地址做对照是最省事的判别手段（绕过网关，等价于 binding 路径）。

**③ 排查过程中纠正的两个误判**，一并记下避免重复踩：

- `service_client_grants.last_used_at` **不能**用来判断跨应用调用是否成功。
  它是 Console **签发令牌**时打的点，不是目标应用收到时。实测：
  `finance:invoice-request:create` 有签发记录（22:46:11），但 Finance 侧零入站零记录。
- 部署前担心的「路由和 cron 会被 wrangler 清掉」是**误判**。altoc/finance 上次实际
  部署的配置里 `routes` 与 `triggers` 两个键**本就不存在**（`routeConfig()` 在缺变量时
  返回 `{}`，键被省略），wrangler 不管理未声明的项。`HZY_<APP>_ROUTE_PATTERN` /
  `ZONE_NAME` 对这两个应用从来没设过，也不需要建 `.env.cloudflare`。
  判别方法：把新生成的配置与主检出里上次部署留下的 `.wrangler.generated.jsonc` 逐键 diff。

### 第二阶段端到端验证追加的两条（后追加至三条） P0（2026-08-27）

在生产用诊断数据（`C-QA0901`）真实点击「申请开票」时新发现，**静态走查看不出来**：

| ID | 问题 | 状态 |
| --- | --- | --- |
| **B-022** | `audit_log.action` 是 `VARCHAR(20)`，代码写入 22–23 字符的语义动作名 → MySQL 1406 → 未映射 500 | ✅ 已修 + 生产迁移已执行并验证 |
| **B-023** | `integration_operation.next_attempt_at` 列默认值按会话时区（CST）写入，claim 用 Go 的 UTC 比较 → 新 operation 8 小时内不可领取 | ✅ altoc、aims 侧已修；**people/directory 待 Stream C 修复** |

**ISSUE-B-022**：三条流程在生产必然失败——`invoice_request_freeze`(22)、`aims_work_item_dispatch`(23)、`create_from_quotation`(21)。不是 schema 漂移，`altoc_schema.sql` 声明的也是 `VARCHAR(20)`，是代码写入值超出自身 schema 契约。迁移 `045_audit_log_action_width.sql` 加宽到 64，已在生产执行（2569 行数据完好，最长既有动作名 14 字符）。

**ISSUE-B-023**：这是 B-001「前端绿色但什么都没发生」的**真正机制**。生产实测：

```
next_attempt_at            = 2026-08-28 06:32:35   (CST 值，来自列默认 CURRENT_TIMESTAMP)
UTC_TIMESTAMP(3)           = 2026-08-27 22:32:35
claimable_with_local_clock = 1
claimable_with_utc_clock   = 0   ← claim 用的就是这个
```

即时投递永远不发生，而 scheduled drain 默认关闭 ⇒ operation 永久卡在 `pending`。影响**整个跨应用可靠命令基础设施**（开票申请、合同激活建项目、工单派发、核销回写、dead-letter）。

### B-025 的完整因果链与逐层剥开记录（2026-08-28）

同一个「申请开票」动作，反复复验共剥开 **五层**，每层都由生产日志/数据库确认，
不是推断。这一节值得完整保留，因为它是「跨应用主线为何从未跑通」的完整答案。

| 轮次 | Finance 入站 | 失败点 | operation 终态 |
| --- | --- | --- | --- |
| 走查发现时 | **零** | 无（完全静默） | 孤儿 `processing` |
| 补 Console grant 后 | 零 | 无（仍静默） | 孤儿 `processing` |
| B-024 Service Binding 部署后 | ✅ 收到 | `403 Unsupported capability`（剥前缀实现错误） | `failed_permanent` |
| 前缀修复后 | ✅ 收到 | `503` introspection 不可用 | `partial_unknown` |
| B-025 转发头修复后 | ✅ 收到，introspection **通过** | `503 tenant-runtime is required` | `processing` |
| 目标上下文三字段改写后 | ✅ 收到 | `403 insufficient_scope`（网关层粗 scope） | `retry_wait` |
| 双 scope 修复后 | ✅ 收到，**认证+授权全通过** | `400 integration_operation_identity_invalid` | — |
| 可信上下文注入修复后 | 待复验 | — | — |

**B-025 的真正根因（第五层）**：目标应用向 Console 换取自身 runtime 令牌的唯一途径是
`runtimeAppIdentity`——受信网关上下文里的 `appCode` 等于自身 appCode（`serviceOidc.ts`）。
业务 Worker 没有 service client secret（`wrangler secret list` 确认只有两个 gateway token），
因此转发链缺 `x-hzy-app-code` 时该判据恒为 false，一律 503。

这正是根 `CLAUDE.md` 早已写明、而首版实现走反了的约束：跨 Worker 直达必须**原子改写**
`x-hzy-app-code` / `x-hzy-deployment` / `x-forwarded-prefix` 三字段到目标应用。
首版「刻意不转发 app-code」方向错了——不是不转发，是必须改写。
目标上下文来自网关注入的 `x-hzy-service-routes` 受信目录，Foundation 早有
`resolveTrustedServiceAppRoute` 可解析，此前在 altoc/finance 一次都没被用过。

**第六层（scope）**：data-runtime 网关层对 finance mutation 按粗 scope `finance.write`
一刀切收口，`hasScope` 的蕴含规则只接受两段尾（`<app>:<action>`），三段细 capability
够不到。仓库既定模式是双 scope 并列（对照 altoc 各 handler 的 `'altoc.write altoc:...'`），
该 handler 漏了粗的那半。

**第七层（可信上下文）**：data-runtime 中 7 处需要可信 service-command 上下文的入口，
`financeRuntimeMutationRequest` 是唯一漏调 `injectTrustedServiceCommandContext` 的。
Altoc 冻结命令带着 `X-HZY-Service-Command-*` 签名头到达后，可信键从未写入 body，
`TrustedServiceCommandContextFromMap` 拿到空 `tenant_code`/`source_app` → `ErrInvalidIdentity`。
**与 2026-08-23 people claim/succeed/fail 漏映射是同一类缺陷**：跨应用可靠命令的公共步骤
在各应用入口逐个手写，漏一个就静默失效。

> **方法论教训（三次实现错误的共同点）**：三次都是「架构里已有答案、实现时没先去找」。
> 剥前缀抄了 Console 特例、不转发 app-code 违背了 CLAUDE.md 明文、注入漏了一处而其余
> 6 处都有。**跨应用改造前必须先搜既有 helper 与既有调用点，把「其他应用怎么做的」
> 作为第一手依据**，而不是照着最近读到的一个实现推广。

### ISSUE-B-026 四个应用缺 `notifications:publish` grant，死信与到期告警静默失效

- **级别**：P1
- **发现方式**：B-025 复验时从 `wrangler tail hzy-altoc` 日志中读到

生产日志（Altoc dead-letter 路径）：

```
[serviceOidc] Console service token request failed:
  { statusCode: 403, audience: 'notifications', scope: 'notifications:publish',
    appCode: 'altoc', message: 'insufficient_scope: notifications:publish' }
[altoc] Integration operation dead-letter notification remains pending.
```

生产库 `hzy_console.service_client_grants` 核验，7 个 runtime client 的覆盖情况：

| client | `notifications:publish` |
| --- | --- |
| `aims.runtime` / `codocs.runtime` / `workflow.runtime` | ✅ active |
| **`altoc.runtime` / `finance.runtime` / `assets.runtime` / `people.runtime`** | **无** |

**影响**：这四个应用发不出任何通知。对 Altoc 至少影响两条已上线路径——
integration operation 进入 dead-letter 时的告警（实测正在失败），以及
`altoc/CLAUDE.md` 记录的回款计划到期通知 `altoc.receivable_plan.due`
（该功能由 `HZY_ALTOC_RECEIVABLE_DUE_NOTIFICATIONS_ENABLED` 开关控制，默认关闭，
一旦启用会立刻撞上同一堵墙）。

**为什么算 P1 而不是 P0**：不阻断业务主链路，但它让**可靠命令基础设施失去最后一道
可观测性**——命令死信了却没人知道，正是本轮走查里「静默黑洞」的同一种形态。

**修复方式**：为四个 client 补 `notifications:publish` grant（Console seed）。
**未执行**——补授权涉及 4 个应用的通知发布权限，属于授权面扩大，需单独明确授权。

### B-001 的生产端到端验证结果

| 检查项 | 修复前 | 校正时钟域后 |
| --- | --- | --- |
| Console 签发 `finance:invoice-request:create` | 从未（`last_used_at` NULL） | ✅ **2026-08-27 22:46:11 UTC** |
| operation | `pending` / `attempt_count 0` / `version_no 1` | `processing` / `attempt_count 1` / `version_no 2` |
| 前端提示 | 绿色「开票申请已创建」 | 同上（旧代码，!13 已修） |

⇒ **B-001 的 Console grant 修复（!14）已验证生效**：令牌确实签发出来了。

**仍未闭环的一段（待跟进）**：投递发起后 attempt 的 `finished_at` 为空、租约过期、Finance 侧零 receipt，且 BFF 既没调 `:succeed` 也没调 `:fail` ⇒ Worker 在往返中被中断，operation 成为孤儿。根因未定位，需要 Cloudflare Worker 日志。这是 B-001 之后的下一段，不影响上述结论。

**遗留诊断数据**（按任务书 §7 使用可识别编码，未清理）：`hzy_altoc` 客户 `C-QA0901`、合同 `C-QA0901-CT`、回款计划 `C-QA0901-RP`，以及一条卡在 `processing` 的 `integration_operation`。

**最关键的背景事实（决定了 10 月 W2 的排期判断）：**

生产租户 C000001 的这几张表**全部是 0 行**：

| 表 | 行数 | 含义 |
| --- | --- | --- |
| `hzy_altoc.contract_orchestration_job` | 0 | **履约启动从未执行过一次** |
| `hzy_altoc.integration_operation` | 0 | Altoc 侧可靠命令从未产生过一条 |
| `hzy_finance.integration_operation` | 0 | Finance 侧同上 |
| `hzy_finance.finance_reconciliation` | 0 | **核销从未做过一次** |
| `hzy_finance.payment_request` | 0 | **付款申请从未用过** |
| `hzy_finance.expense_claim` | 0 | **费用报销从未用过** |
| `hzy_finance.project_expense_request` | 0 | **项目支出从未用过** |

对照有数据的表：`contract` 1549、`receivable_plan` 2065、`finance_invoice` 1956、`finance_receipt` 2107、`customer` 756。

⇒ 这些是**历史数据直接迁入**的结果，不是走主链路产生的。`invoice_request` 全库只有 1 条（2026-06-20，走的是现已退役返回 410 的合同级路由）。

**结论：任务书要重点验证的「自动编排是否真的自动」，答案是——这条链在生产从未被端到端执行过，因此从未被验证过。** 本轮静态走查已证明它至少在两处必然失败（ISSUE-B-001、B-006）。

另一个直接影响可测性的事实：`receivable_plan` 2065 条的状态只有 `received`(2061) 和 `bad_debt`(4)，**没有任何一条处于 `to_invoice` / `to_receive` / `partially_received`**。也就是说今天在生产上点不出「申请开票」按钮，问题要等 10 月新签合同走履约启动之后才会第一次暴露——正好在上线窗口内。

---

## 0.2 终局：主链路已在生产端到端跑通（2026-08-29）

走查任务书要重点验证的问题是「自动编排是否真的自动」。

- **走查开始时的答案**：这条链**从未被端到端执行过**——`contract_orchestration_job`、
  两侧 `integration_operation`、`finance_reconciliation`、`payment_request`、
  `expense_claim`、`project_expense_request` 在生产**全部 0 行**。
- **2026-08-29 的答案**：**通了。**

### 最终验收（清空全部中间产物后从零重跑）

| 环节 | 结果 |
| --- | --- |
| ① Altoc operation | `succeeded` → `IR202608292035253C7C` |
| ② `hzy_finance.invoice_request` | 落库，`pending_approval`，¥1,000.00 |
| ③ Finance `service_command_receipt` | `succeeded` |
| ④ Finance→Workflow operation | `succeeded` → `WF202608300001` |
| ⑤ `hzy_workflow.flow_instances` | `running`，`biz_id` 与发票编码一致 |

两跳 `attempt_count` 均为 1，**零重试**。验收在 Console 重新部署、
全部业务模块与 main 对齐之后完成。

### 这条链一共剥开十三层

每一层都由生产日志或数据库确认，不是推断。**前十二层没有任何一层能被
lint、typecheck 或既有单测发现**——它们全部只在真实跨应用往返时才暴露。

| 层 | 问题 | MR |
| --- | --- | --- |
| 1 | 跨应用调用未走 Service Binding，Worker 子请求被 WAF 拦成静默黑洞 | !21 |
| 2 | Service Binding URL 前缀剥离照抄了 Console 特例 | !25 |
| 3 | 跨应用转发丢失受信上下文头 | !29 |
| 4 | 未原子改写目标上下文三字段（`app-code`/`deployment`/`forwarded-prefix`） | !31 |
| 5 | Finance handler 缺 data-runtime 网关层粗 scope | !32 |
| 6 | Finance mutation 路由是 7 处入口中唯一漏注入可信 service-command 上下文的 | !33 |
| 7 | Finance→Workflow 冻结命令带 `bizUrl`，触发安全持久化校验死锁 | !36 |
| 8 | 网关 scheduler wake 不注入受信服务路由目录，**所有应用**重试 100% 失败 | !37 |
| 9 | Finance 两处 operation INSERT 漏写 UTC `next_attempt_at` | !38 |
| 10 | Finance 机器态跃迁被 actor 强制挡住（完整 10 条路径） | !41 / !44 |
| 11 | Finance 无任何重试兜底（不在网关唤醒清单、无 drain endpoint） | !42 |
| 12 | Platform 调度注册表不上报 finance，与网关取交集后被过滤 | !43 |
| 13 | Console Directory API 走公网被 WAF 拦 | !45 |

配套的生产配置修复（非代码）：

| 项 | 内容 |
| --- | --- |
| Console grant | `workflow:invoice-request:create` 双 audience（482→484 行） |
| Console grant | 四个应用补 `notifications:publish`（478→482 行，见 ISSUE-B-026） |
| Schema | `audit_log.action` VARCHAR(20)→(64) |
| Schema | `payment_request.reject_reason` |
| 审批配置 | `flow_action_defs` id=18 / `flow_routes` id=19（详见配置建议文档） |

### 方法论结论

1. **静态检查证明不了跨应用链路。** 十三层里前十二层 lint / typecheck / 单测
   全部无感。唯一可靠的验收是双侧 `wrangler tail` 抓包 + 数据库确认业务行落库。
2. **`service_client_grants.last_used_at` 不是成功证据。** 它在 Console 签发令牌时
   打点，不是目标应用收到时。实测出现过「有签发记录但目标应用零入站」。
3. **修复要穷举调用方，不能按当时看到的调用点改。** 本轮有两次「修了但没修全」
   （!31 的三字段、!41 的豁免表只列了 4/10 条），共同原因都是没先穷举。
   因此后续护栏一律改为**扫描调用方源码**，而不是重复维护清单。
4. **同一份清单不要多处维护。** 网关唤醒清单曾在 platform SQL、网关常量、
   binding 映射、wrangler 配置四处各存一份，改一处无效且不报错。现已加跨文件
   同步断言。
5. **线上版本会悄悄漂移。** 全模块盘点发现 aims 落后 foundation 19 小时、
   assets 落后 119 小时，其中 aims 的「跨应用投递阻断修复」已合并但从未部署。
   本轮已全部对齐，建议把「foundation 变更后重部署全部消费方」纳入固定动作。

## 1. P0 ISSUE

### ISSUE-B-001 开票申请在生产必然 403，且失败被吞成绿色「已创建」

- **级别**：P0
- **模块**：altoc → finance
- **路径**：`POST /api/v1/receivable-plans/{code}/invoice-request` → Console token → `POST /api/v1/finance/service/invoice-requests/create`
- **初判类别**：跨应用授权 + 错误映射（AIMS「立项 401 + 错误吞成 null」的精确复刻）

**现象**（两个缺陷叠加，缺一不可）：

1. **授权缺失**：Altoc 用 `audience=finance`、`scope=finance:invoice-request:create` 向 Console 换服务令牌。生产 `hzy_console.service_client_grants` 中，`altoc.runtime` 只有 `finance:read` 和 `finance:write` 两条 grant，**没有 `finance:invoice-request:create`**。

   Console 的匹配逻辑（`data-runtime/internal/apps/console/auth_service_tokens.go:326-331`）：请求 scope 以 `audience+":"` 开头时**只走精确匹配**，不回落 semanticScope。因此必然返回：

   ```
   403 insufficient_scope: finance:invoice-request:create
   ```

   > 补充：`altoc.runtime` 现有的 `finance:write` grant，其 `scope_json.endpoints` 指向 `/api/v1/finance/invoice-requests` 和 `/api/v1/finance/invoice-requests/{code}/submit`——这两个是**已退役的旧路由**。属于根 `CLAUDE.md` 明令的「未被签发流程实际执行的 `scope_json.endpoints` 不得作为安全边界」。

2. **失败被静默**：`altoc/server/utils/receivableInvoiceOperation.ts:78-80` 的 catch 捕获**全部**异常（含 401/403），返回 `{ succeeded: false, pending: true }`。BFF（`invoice-request.post.ts:50`）据此设 HTTP 202，但响应体仍是 `{ code: 0, message: 'ok' }`。前端（`altoc/app/pages/payments/[id].vue:153-159`、`contracts/[id].vue:942-948`）不判断 `delivery.succeeded`，**无条件弹绿色 toast「开票申请已创建」**。

**期望**：授权侧——`altoc.runtime` 应有精确且 active 的 `finance:invoice-request:create` grant。错误侧——投递失败必须让用户看到失败，401/403 属确定性失败不应伪装成 pending。

**复现**：

1. 生产库执行（只读）：

   ```sql
   SELECT sc.client_code, CONCAT(g.resource_code,':',g.action) cap, g.status
   FROM hzy_console.service_clients sc
   JOIN hzy_console.service_client_grants g ON g.service_client_id = sc.id
   WHERE sc.client_code = 'altoc.runtime'
     AND CONCAT(g.resource_code,':',g.action) = 'finance:invoice-request:create';
   -- 实际返回 0 行
   ```

2. 让一条回款计划进入 `to_invoice`，在回款计划详情页点「申请开票」。
3. 观察：前端绿色成功；`hzy_finance.invoice_request` 无新行；`hzy_altoc.integration_operation` 该行 `status` 停在 `pending`/`failed`。

**证据**：
- 生产 grant 查询结果（上）；对照 `finance.runtime` **有** `tenant-runtime:finance:invoice-request:create`（`semanticScope=finance:invoice-request:create`），说明 seed 只给了目标应用自己，漏了调用方 Altoc。
- `data-runtime/internal/apps/console/auth_service_tokens.go:326-331`
- `altoc/server/utils/receivableInvoiceOperation.ts:52-84`
- `altoc/server/api/v1/receivable-plans/[code]/invoice-request.post.ts:50`
- `finance/server/middleware/tenant-runtime.ts:88-90`（目标端要求 `finance:invoice-request:create`，`allowFinanceWideScopes` 只放行 `finance:*` / `finance:admin`，Altoc 两者都没有）

---

### ISSUE-B-002 付款申请驳回必然 500，且被标记为可重试导致 Workflow 回调无限重试

- **级别**：P0
- **模块**：finance
- **路径**：`POST /api/v1/finance/workflow/callback`（result=rejected）→ `applyApprovalResultTx`
- **初判类别**：schema 漂移 + 错误映射（AIMS「`work_item_service_ext` 缺列」+「1062 没映射」两个原型同时命中）

**现象**：

`data-runtime/internal/apps/finance/write_approval.go:277-288` 的驳回分支对 `invoice_request` / `expense_claim` / `project_expense_request` / `payment_request` **四张表用同一段硬编码 SQL**：

```sql
UPDATE <table> SET status='rejected', workflow_instance_id=COALESCE(?,workflow_instance_id),
  rejected_at=NOW(), reject_reason=?, updated_by=COALESCE(?,updated_by), updated_at=CURRENT_TIMESTAMP
WHERE id=?
```

生产库核验结果：

| 表 | `reject_reason` | `rejected_at` | `workflow_instance_id` |
| --- | --- | --- | --- |
| `invoice_request` | ✅ | ✅ | ✅ |
| `expense_claim` | ✅ | ✅ | ✅ |
| `project_expense_request` | ✅ | ✅ | ✅ |
| **`payment_request`** | ❌ **缺失** | ✅ | ✅ |

`finance/docs/finance_schema.sql:316` 明确声明了该列，`finance/docs/migrations/` 下没有任何补列迁移 ⇒ 生产库建库时用的是更早版本的 schema，之后再未补齐。

放大后果：`data-runtime/internal/server/server.go:4620-4642` 的 `writeError` 对未识别错误兜底成 **500 `internal_error`**，而 `retryableHTTPStatus(500)` 为 **true**。该文件自己的注释记录过同型事故（「attempt_count 冲到 5261，max_attempts=8 完全失效」）。因此付款申请驳回不只是失败，而是**失败 + 被判定可重试 + Workflow 回调持续重投**。

**期望**：驳回成功；或者至少映射为明确的非可重试错误。

**复现**：

```sql
SELECT COUNT(*) FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='hzy_finance' AND TABLE_NAME='payment_request' AND COLUMN_NAME='reject_reason';
-- 实际返回 0
```

然后走一条付款申请到审批节点并驳回。

**证据**：
- `data-runtime/internal/apps/finance/write_approval.go:277-288`
- `data-runtime/internal/server/server.go:4620-4642`
- `finance/docs/finance_schema.sql:316`
- 生产 `information_schema.COLUMNS` 查询

> 对照参考：Altoc 侧对同类风险做了防护——`altocInsertRecordTx`（`command_helpers.go:615-625`）和 `existingContractColumns`（`contract_lines.go:221`）都会先探测实际列再拼 SQL，所以 `hzy_altoc.contract` 缺 14 个 legacy 列也不会炸（见 ISSUE-B-013）。**Finance 的审批路径缺这层防护**。

---

### ISSUE-B-003 付款申请可以带 `status=paid` 直接创建，完整跳过申请—审批—付款链

- **级别**：P0
- **模块**：finance
- **路径**：`POST /api/v1/finance/payment-requests`
- **初判类别**：业务逻辑 / 授权

**现象**：

`data-runtime/internal/apps/finance/write_endpoints.go:489`（`paymentRequestCreateSpec`）中 `status` 字段的允许值为：

```go
allowedDefaultField("status", []string{"draft","pending_approval","approved","rejected","paid","canceled"}, "draft", "status")
```

创建接口直接接受 `status: "paid"`。一次 POST 就能落地一条「已付款」的付款申请，不产生 `workflow_instance_id`、不经过任何审批节点、不留审批痕迹。

前置条件：调用者需持有 `expenses:confirm`（`finance/server/utils/financePermissionRoutes.ts:20-23`：body `status=paid` → `sensitiveStatusAction` → `confirm`）。生产上 `finance:cashier`（出纳）和 `finance:admin` 都有该权限，`system_admin` 有 4 人持有 `finance:admin`。

这正是手册「出纳付款不制单」要防的反面：**出纳可以自己制单并直接标记已付**。唯一拦截是 `requirePaymentConfirmationCreateDutySeparation`，而它可被绕过（见 ISSUE-B-004）。

**期望**：创建接口只接受 `draft` / `pending_approval`；`approved` / `paid` / `rejected` 只能由审批回调和付款确认动作写入。

**复现**：`POST /api/v1/finance/payment-requests`，body `{ "title":"C-QA0901","payeeName":"...","requestedAmount":"1.00","status":"paid","applicantUserId":"<他人uid>","paidBy":"<任意其他uid>" }`。

**证据**：`data-runtime/internal/apps/finance/write_endpoints.go:472-493`、`finance/server/utils/financePermissionRoutes.ts:17-23`

> ⚠️ 未在生产实际执行该请求（写操作，超出本轮只读授权）。定级依据为代码路径与权限映射的静态确证。建议 10 月 W2 在隔离租户实测确认。

---

### ISSUE-B-004 付款确认的职责分离检查可被请求体字段绕过；且生产职责冲突规则表为空

- **级别**：P0
- **模块**：finance
- **路径**：`POST/PATCH /api/v1/finance/payment-requests`、`/api/v1/finance/expenses`
- **初判类别**：标识符语义 / 授权（任务书「必查职责冲突」直接命中项）

**现象**：

服务端确实有硬编码的制单人 ≠ 付款人检查（`payment_confirmation_duty_separation.go`），但取「付款人」的顺序是：

```go
func paymentConfirmationActorUID(body jsonBody) string {
  return firstNonEmpty(
    cleanStringValue(bodyValue(body, "paymentConfirmedBy", "payment_confirmed_by")),  // ← 客户端可传
    cleanStringValue(bodyValue(body, "paidBy", "paid_by")),                            // ← 客户端可传
    cleanStringValue(bodyValue(body, "confirmedBy", "confirmed_by")),                  // ← 客户端可传
    cleanStringValue(bodyValue(body, "operator_uid", "operatorUid")),                  // ← BFF 注入的受信值
    ...
  )
}
```

前三个键**优先于** BFF 注入的受信 `operator_uid`，而 Finance BFF 的 `sanitizeRuntimeRecord`（`finance/server/utils/dataRuntime.ts:240-290`）的 `runtimeAuthKeys` 白名单**只清洗 `current_user` / `operator_uid` 和各类 `current_user_*_access`，不包含 `paidBy` / `paymentConfirmedBy` / `confirmedBy`**。

更隐蔽的是：`hzy_finance.payment_request` **没有** `payment_confirmed_by` / `paid_by` / `confirmed_by` 这些列，而通用写入路径（`write_specs.go:171-179`）只按 `spec.Fields` 白名单拼 SET。所以这些伪造字段**既不会落库、也不会报错**——它们的唯一作用就是让职责分离检查取到一个假的 actor 并放行。

叠加两个现状：

1. `if actor == "" { return nil }`（`payment_confirmation_duty_separation.go:22-24, 42-44`）——actor 取不到时**直接放行不检查**。
2. 生产 `hzy_platform.tenant_role_conflict_rules` **0 行**（无租户自定义规则）。
   > **更正（2026-08-27）**：本条初版写成「没有任何规则可评估，永远显示未发现冲突」，**这是错的**。`platform/server/utils/staticRoleConflicts.ts:97-114` 有两条内置静态规则作为回退——`finance-expense-maker-confirmation`（付款制单与付款确认分离）和 `finance-expense-maker-approval`（费用制单与费用审批分离），且已接入 `policyBundle.ts:827` 与 `instanceConflictExplanation.ts`。表为空只代表没有租户自定义规则，不代表没有规则。
   >
   > 但两条内置规则的 `enforcement` 都是 **`warning`**，描述明写「允许小团队兼任，但付款确认必须由非制单/经办人执行」。也就是说角色层**有意**允许兼任、只告警，**真正的硬拦截只有 runtime 的「制单人 ≠ 付款人」实例级检查**——而那正是本条发现可被请求体绕过的那一个。这反而让本条的 P0 定级更成立：它是唯一的强制防线，且当时是失效的。
3. 生产 4 个 `system_admin` 持有 `finance:admin`，同时拥有 `expenses:admin`(⊇edit)、`expenses:approve`、`expenses:confirm`——制单、审批、付款三权集于一身。按上述内置规则这会产生告警，但不阻断。

⇒ **服务端拦不住。** 这是任务书「验证服务端真拦得住，不只是界面隐藏」的答案。

**期望**：actor 只能来自受信上下文；`paidBy` / `paymentConfirmedBy` / `confirmedBy` 必须在 BFF 层删除；制单人以已落库记录为准，不得被请求体覆盖。

**复现**：`PATCH /api/v1/finance/payment-requests/{code}`，body `{ "status":"paid", "paidBy":"<任意非制单人 uid>" }`，由制单人本人发起。

**证据**：
- `data-runtime/internal/apps/finance/payment_confirmation_duty_separation.go:14-48, 63-72`
- `finance/server/utils/dataRuntime.ts:240-290`
- `data-runtime/internal/apps/finance/write_specs.go:150-179`
- 生产：`SELECT COUNT(*) FROM hzy_platform.tenant_role_conflict_rules;` → 0
- 生产：`system_admin` → `finance:admin` → `expenses:edit/approve/confirm` 全有，4 人持有

---

### ISSUE-B-005 履约启动的 Aims 建项目/里程碑失败时，前端仍显示绿色「履约启动已执行」

- **级别**：P0
- **模块**：altoc → aims
- **路径**：`POST /api/v1/service/contracts/{contractCode}/activate-delivery`
- **初判类别**：错误映射（「自动编排是否真的自动」的核心验证点）

**现象**：

BFF（`altoc/server/api/v1/service/contracts/[contractCode]/activate-delivery.post.ts:445-447`）在 Aims 项目 / 里程碑 operation 未成功时：

```ts
const activationOperationsPending = !aimsOperationsSucceeded
  || activationOperationResults.some(item => item.succeeded !== true)
if (activationOperationsPending) setResponseStatus(event, 202)
return { code: 0, message: 'ok', data: { ... } }
```

只改 HTTP 状态码为 202，业务包封仍是 `code: 0, message: 'ok'`。

前端（`altoc/app/pages/contracts/[id].vue:1104-1123`）：

```ts
await $fetch(`/api/v1/service/contracts/${...}/activate-delivery`, { ... })
toast.add({ title: '履约启动已执行', color: 'success' })
```

`$fetch` 对 202 不抛错，前端也不检查 `data.integrationOperations[].succeeded`。⇒ **Aims 交付项目没建出来、里程碑没同步，用户看到的是绿色成功。**

合同状态和回款计划这时已经在 Altoc 侧提交了（`activateContractDelivery` 的事务先于 operation 投递完成），所以合同显示「已生效」、回款计划已生成，但 Aims 那边什么都没有——**经营侧和交付侧静默脱节**。

**期望**：投递未完成时前端必须显式提示「Aims 交付项目尚未创建，请到履约启动作业查看/重试」，并把 `activationJob` 的失败步骤呈现出来。

**复现**：让 Altoc→Aims 的调用失败（断开 Aims、或临时置 `altoc.runtime` 的 `aims:write` grant 为 inactive），在合同详情页点「履约启动」。

**证据**：
- `altoc/server/api/v1/service/contracts/[contractCode]/activate-delivery.post.ts:445-470`
- `altoc/app/pages/contracts/[id].vue:1104-1123`
- 生产 `contract_orchestration_job` = 0 行 ⇒ 该提示逻辑从未被真实触发验证过

> 注：本条与 ISSUE-B-001 是**同一个反模式的两个实例**——可靠命令投递失败统一被降级成「pending + code:0」，而前端把 `code:0` 当成功。建议一并修，在 Foundation 层给出统一的「未完成投递」响应约定。

---

### ISSUE-B-006 回款计划开票申请使用固定幂等键但金额动态取值，第二次申请必然失败或静默无操作

- **级别**：P0
- **模块**：altoc
- **路径**：`POST /api/v1/receivable-plans/{code}/invoice-request`
- **初判类别**：业务逻辑 / 错误映射

**现象**：

幂等键在 BFF 和 runtime 两处的默认值都是**不含金额、不含序号的每计划固定串**：

```ts
// altoc/server/api/v1/receivable-plans/[code]/invoice-request.post.ts:31
const operationKey = text(getHeader(event,'idempotency-key'))
  || `altoc:receivable:${receivablePlanCode}:invoice-request:v1`
```
```go
// data-runtime/.../service_receivables.go:690-693
idempotencyKey := firstNonEmptyText(
  firstBodyText(body, "idempotencyKey", "idempotency_key"),
  fmt.Sprintf("altoc:receivable:%s:invoice-request:v1", receivablePlanCode))
```

而前端**不传** `Idempotency-Key`（`payments/[id].vue:145-152`、`contracts/[id].vue:934-941` 只传 body），且申请金额取的是**会随到账变化**的 `unreceived_amount`：

```ts
body: { requestedAmount: plan.unreceived_amount || plan.amount, invoiceItem: plan.plan_name, submit: true }
```

`enqueueReceivableInvoiceRequestOperationTx`（`receivable_invoice_operation.go:38-45`）按 `(tenant, deployment, source_app, operation_key)` 查已有 operation，命中后比对 `command_sha256`（command 里包含完整 `invoiceRequest`，含 `requestedAmount`）。于是：

| 场景 | 结果 |
| --- | --- |
| 金额变了（部分到账后开剩余部分 / 改金额重发） | **409 `integration_operation_payload_mismatch`**，前端红字「开票申请失败」，错误原文是 `invoice operation identity was reused with different trusted evidence`——用户完全无法理解 |
| 金额没变（重复点击） | 返回 `created:false, status:succeeded`，BFF `claimOpsKnowledgeOperation` 取不到可领取命令 → `delivery.succeeded=true` → 前端提示「已创建」，但**实际没有创建第二张开票申请** |

这与业务意图直接冲突：服务端 `prepareReceivablePlanInvoiceRequest`（`service_receivables.go:670-673`）和前端 `canRequestInvoiceForPlan`（`contracts/[id].vue:926-928`）**都明确允许 `partially_received` 状态再次申请开票**——即产品是支持分次开票的，但幂等键设计把它锁死成了每计划一次。

**期望**：幂等键应包含可区分本次申请的成分（申请序号 / 金额 / 客户端生成的 UUID）；或前端按「新建一次申请」生成 `Idempotency-Key`。同时 409 应映射为用户可读的业务提示。

**复现**：对一条 `to_invoice` 回款计划申请开票 → 登记部分到账 → 再次申请开票（UI 允许）→ 观察 409。

**证据**：
- `altoc/server/api/v1/receivable-plans/[code]/invoice-request.post.ts:31`
- `data-runtime/internal/apps/altoc/service_receivables.go:670-693`
- `data-runtime/internal/apps/altoc/receivable_invoice_operation.go:38-45`
- `altoc/app/pages/payments/[id].vue:145-152`、`altoc/app/pages/contracts/[id].vue:926-941`

> 对照：合同履约启动走的是**相反的极端**——前端每次点击都生成随机 UUID 幂等键（`contracts/[id].vue:1109-1113`），而 `contractActivationIdempotencyKey` 直接采信 body 值（`contract_orchestration.go:1232-1236`），因此每次点击都会新建一个 `contract_orchestration_job`，`correlationKey` 随 `jobCode` 变化，进而**每次都生成一组全新的 Aims operation**。两处幂等策略需要一起收敛。

---

### ISSUE-B-011 财务数据范围「无配置即全量」，4 个非财务岗位可读全公司发票、到账、报销与项目毛利

- **级别**：**P0**（原判 P1 待业务确认；2026-08-27 业务方确认**非有意配置**，据此升级） | **模块**：finance | **类别**：授权
- **路径**：`/api/v1/finance/invoices`、`/receipts`、`/expenses`、`/payment-requests`、`/expense-claims`、`/project-expense-requests`、`/project-accounting`、`/reports` 的列表与详情

**现象**：

`finance/server/utils/financeScopedAuthorization.ts` 有**三处**「授权里没有任何非 `tenant:global` 的 scope 就放行全量」：

| 行 | 函数 | 影响资源 |
| --- | --- | --- |
| `:115` | `responsibilityScopeFromGrant` → `return 'all'` | **发票、到账、核销** |
| `:189-191` | `expenseRequestScopeFromGrant` → `{ access: 'all' }` | **费用报销、项目支出、付款申请** |
| `:250-252` | `projectFinanceScopeFromGrant` → `{ access: 'all' }` | **项目核算、合同财务摘要、绩效、看板** |

三处都是先把 `tenant:global` 过滤掉，再判断「剩下为空 ⇒ 全量」。问题在于「**从未配置过范围**」和「**显式授予了全局范围**」被折叠成了同一个结果。

生产核验（`hzy_platform`）：

| 租户角色 | 映射的 finance 应用角色 | 持有人 | 角色级 scope | 人员级 scope | 实际访问面 |
| --- | --- | --- | --- | --- | --- |
| `department_manager` | `finance:expense_approver` | 6 | 0 | ✅ 6 条部门树 | 本部门 ✅ |
| `deputy_general_manager` | `finance:viewer` | 2 | 0 | ✅ 2 条部门树 | 本部门 ✅ |
| **`sales_director`** | `finance:viewer` | 1 | 0 | ❌ 无 | **全公司** ❌ |
| **`project_manager`** | `finance:viewer` | 1 | 0 | ❌ 无 | **全公司** ❌ |
| **`procurement_asset_manager`** | `finance:viewer` | 1 | 0 | ❌ 无 | **全公司** ❌ |
| **`commercial_director`** | `finance:viewer` | 1 | 0 | ❌ 无 | **全公司** ❌ |
| `general_manager` | `finance:viewer` | 1 | 0 | ❌ 无 | 全公司（岗位合理） |
| `finance_accountant` | `finance:accountant` | 1 | 0 | ❌ 无 | 全公司（岗位合理） |
| `system_admin` | `finance:admin` | 4 | 0 | ❌ 无 | 全公司（岗位合理） |

`finance:viewer` = `expenses:view` + `invoices:view` + `receipts:view` + `project_accounting:view` + `reports:view`。

⇒ **销售总监、项目经理、采购与资产管理员、商务总监各 1 人，当前可以读取生产库全部 1956 张发票、2107 条到账记录、全部费用报销明细和全公司项目毛利。** 业务方已确认这不是有意配置。

**期望**：未配置数据范围应当**失败关闭**（`none`），全量访问必须由显式的 `tenant:global` scope 授予。

**复现**：以 `sales_director` 持有人身份登录 Finance，打开发票列表 / 报销列表 / 项目核算，观察返回的是全公司数据而非本人或本部门范围。或直接查生产：

```sql
SELECT tr.role_code, GROUP_CONCAT(DISTINCT m.app_role_code) app_roles,
 (SELECT COUNT(*) FROM hzy_platform.tenant_role_scopes s
   WHERE s.role_id=tr.id AND s.app_code='finance' AND s.status='active') role_scopes,
 (SELECT COUNT(*) FROM hzy_platform.tenant_subject_roles sr
   JOIN hzy_platform.tenant_subject_role_scopes ss ON ss.assignment_id=sr.id
   WHERE sr.role_id=tr.id AND ss.app_code='finance' AND ss.status='active') subject_scopes
FROM hzy_platform.tenant_roles tr
JOIN hzy_platform.tenant_role_app_role_maps m ON m.role_id=tr.id
WHERE m.app_role_code LIKE 'finance%' GROUP BY tr.id;
```

**证据**：`finance/server/utils/financeScopedAuthorization.ts:106-116, 177-191, 241-252`；上表生产查询结果。

> ⚠️ **修复必须代码与配置同步落地，否则会翻转成全面 403。**
>
> 只把默认值从 `all` 改成 `none`，会立刻让 `finance_accountant`(1)、`system_admin`(4)、`general_manager`(1) 这 6 个**本应看全量**的账号全部拿到 `none` → 403。这正是 Altoc 看板 403 的同型事故（本地 bundle 恒得 `none` → 全量 403）。
>
> 因此修复顺序必须是：**先**给这 3 个角色显式配 `tenant:global` scope 并验证生效 → **再**收窄或移除 4 个非财务岗位的 `finance:viewer` → **最后**才改代码默认值。三步之间都要有回归验证。
>
> **跨模块排查结果（已完成）**：同型写法只出现在 Finance 的 3 处和 **People 的 1 处**（`people/server/utils/peopleScopedAuthorization.ts:106`，`employeeScopeFromGrant`，影响员工档案范围）。`aims` / `assets` / `altoc` 的 `*ScopedAuthorization.ts` **均无**此模式，`codocs` 无该文件。
>
> 因此收敛范围是 Finance + People 共 4 处，不需要动 Foundation 抽象，W2 内 Finance 侧 3 处可独立修完。People 那处属 Stream A / People 模块边界，本清单只做记录，建议同步告知对应负责人（本轮未走查 People，不评估其影响面）。
## 2. P1 ISSUE

### ISSUE-B-007 Console 授权不可用被吞成 403，违反「必须保留 503」硬规则

- **级别**：P1 | **模块**：altoc + finance | **类别**：错误映射

`altoc/server/utils/checkPermission.ts:105-109` 与 `finance/server/utils/checkPermission.ts:98-102` 都是：

```ts
} catch (error: unknown) {
  console.error('[checkPermission] Failed:', err.message)
  return false      // ← Console 不可用 == 用户没权限
}
```

`requirePermission` 据此抛 **403「权限不足」**。根 `CLAUDE.md` 明令：「Console 授权依赖不可用必须保留为 `503`，不得在业务应用 `checkPermission` 中吞掉并伪装成用户缺权的 `403`」。

后果：Console 抖动时两个应用全员看到「权限不足」，运维会往权限配置方向排查，而不是往 Console 可用性方向。定 P1 而非 P0 的理由是它只在 Console 故障时触发；但触发时爆炸半径是两个应用的全部用户。

### ISSUE-B-008 Altoc / Finance 各自保留权限旁路开关，生产均未启用但无任何防误开机制

- **级别**：P1（生产环境已全部核验，**三个开关均未设置，无现网暴露面**） | **模块**：altoc + finance | **类别**：授权

三个开关，命中任一即可让权限检查整体失效：

| 开关 | 模块 | 代码位置 | 效果 | 生产取值 |
| --- | --- | --- | --- | --- |
| `HZY_INTERNAL_KEY` + `x-internal-api-key` 头 | altoc | `checkPermission.ts:88-91, 123-126` | 带对头即绕过**全部**权限检查 | **未设置** ✅ |
| `SKIP_PERM_CHECK=1` | altoc | `checkPermission.ts:86, 121` | `checkPermission` 恒 `true`、`requirePermission` 直接 return | **未设置** ✅ |
| `HZY_FINANCE_DEV_PERMISSIONS=true` | finance | `checkPermission.ts:40-48`（用于 :19/:81/:112） | 同上，且 `loadAuthorizationSnapshot` 返回一份写死的全权限快照 | **未设置** ✅ |

```ts
// altoc/server/utils/checkPermission.ts:86-91
if (process.env.SKIP_PERM_CHECK === '1') return
const internalKey = getHeader(event, 'x-internal-api-key')
if (internalKey && process.env.HZY_INTERNAL_KEY && internalKey === process.env.HZY_INTERNAL_KEY) return
```

**生产核验结论（2026-08-27，运维确认）**：Altoc Worker 与 Finance Worker 上述三个变量**全部未设置**。`HZY_INTERNAL_KEY` 的比对要求 `process.env.HZY_INTERNAL_KEY` 非空，因此伪造 `x-internal-api-key` 头不会生效。**当前无现网暴露面**，本条不影响 10 月上线。

**仍建议在 W2 处理，但两类开关的处理方式不同：**

1. **`HZY_INTERNAL_KEY` / `x-internal-api-key` —— 直接删除。** 全仓搜索显示**没有任何代码设置或发送**这个头，是无消费方的历史遗留。它属于根 `CLAUDE.md` 明令禁止的「共享 API Key / 内网默认可信」模式，没有保留理由。改动约 6 行，零回归风险。

2. **`SKIP_PERM_CHECK` / `HZY_FINANCE_DEV_PERMISSIONS` —— 不删，加生产断言。** 根 `CLAUDE.md` 允许「`auth=disabled` 只能用于显式本地开发」，这两个开关有正当的本地开发用途，删掉会影响开发体验。问题在于**代码层没有任何机制阻止它们在生产生效**——目前完全依赖环境配置纪律，而且误开之后没有任何测试、日志或告警会提示。

   建议改为：部署 profile 为生产 / 托管云时**忽略该开关并输出 error 级日志**，只在显式本地开发 profile 下允许生效。

**这条的真实价值不在当前风险，而在于它没有防线。** 三个开关目前靠「没人设置」保证安全；任何一次环境变量误配都是静默的全权限失效，且不会被发现。

### ISSUE-B-009 生产 `service_ticket` 缺 7 列，工单派发到 Aims 必然 500

- **级别**：P1（工单入口按任务书 §2.4 不在本轮范围） | **模块**：altoc | **类别**：schema 漂移

生产 `hzy_altoc.service_ticket` 缺失以下列，对应 migration `038_service_ticket_ops_knowledge_reservation.sql` 与 `043_service_ticket_aims_reliable_dispatch.sql` **未在生产执行**：

`aims_delivery_generation`、`aims_delivery_status`、`aims_dispatch_operation_key`、`aims_dispatch_status`、`ops_knowledge_idempotency_key`、`ops_knowledge_pending_uuid`、`ops_knowledge_status`

这些列被硬编码 SQL 直接读写，**没有列存在性防护**：
- `service_ticket_aims_operation.go:88`：`UPDATE service_ticket SET aims_dispatch_status=?, aims_dispatch_operation_key=? ...`
- `service_ticket_ops_knowledge.go:99, 188, 196`
- `service_maintenance.go:296, 321`

与 AIMS 那轮 `work_item_service_ext` 缺 v5.4 列是同一型故障。

### ISSUE-B-010 缺 grant `altoc.runtime → aims:service-ticket:work-item:create`

- **级别**：P1（同上，工单入口范围外） | **模块**：altoc → aims | **类别**：跨应用授权

生产 grant 表中 `altoc.runtime` 没有该 capability。与 ISSUE-B-001 同型（seed 只给了目标应用，漏了调用方）。与 B-009 叠加意味着服务工单派发链路**两处都断**。

### ISSUE-B-012 Altoc / Finance 完全没有 MySQL 错误码映射

- **级别**：P1 | **模块**：altoc + finance | **类别**：错误映射（AIMS「1062 没映射成 409」原型）

全仓只有 `people`（`offboarding_cases.go:653`）和 `aims`（`portfolios.go:286`）映射了 1062。`data-runtime/internal/apps/altoc/` 和 `.../finance/` **一条都没有**。

后果：任何唯一键冲突 / 缺列 / 外键错误都落到 `writeError` 兜底的 **500 `internal_error` + `retryable: true`**。

用户可撞到的唯一键（生产实测存在）：

| 表 | 唯一键 | 用户可撞场景 |
| --- | --- | --- |
| `opportunity` | `uk_opportunity_lead_id (lead_id)` | **一条线索只能转出一个商机**；重复转换 / 一线索多商机 → 500 |
| `contract` / `customer` / `lead` / `quotation` / `receivable_plan` | `uk_code (code)` | 并发创建时 code 生成竞争 |
| `contract_line` | `uk_contract_line_no (contract_id, line_no)` | 并发加行 |
| `finance_invoice` / `finance_receipt` / `finance_bank_account` | `(legacy_source, legacy_id)` | 迁移重跑 |

线索→商机 是 Altoc 主线的第一段，建议优先补该处映射（应为 409）。

### ISSUE-B-013 生产 Altoc 三张表缺 25 个 legacy 列，`payment_record` 等 3 张表缺失

- **级别**：P1（当前无实际故障） | **模块**：altoc | **类别**：schema 漂移

`002_wizbizdb_marketing_compat.sql` 未在生产执行：

- `contract` 缺 14 列：`contact_id`、`content_summary`、`contract_period_months`、`executed_amount`、`invoiced_amount`、`is_third_party`、`legacy_id`、`legacy_refs_json`、`legacy_source`、`prime_amount`、`service_period_months`、`service_terms`、`source_contract_type`、`third_party_customer_id`
- `invoice` 缺 5 列、`product` 缺 6 列
- 缺表：`payment_record`、`legacy_migration_map`、`legacy_unmapped_income`

**当前不构成故障**，因为 Altoc 的写入路径都做了运行时列探测（`altocInsertRecordTx` / `existingContractColumns`），`payment_record` 的读取实际走的是 Finance 到账（`business_reads.go:425`）。

但 `altoc/docs/altoc_schema.sql` 与生产已经不一致，`altoc/CLAUDE.md` 仍把 `payment_record` 列为核心表。上线前检查若以 schema.sql 为准会得出错误结论。

### ISSUE-B-014 `finance/CLAUDE.md` 声称三份 DDL「未在真实租户执行」，实际生产已执行

- **级别**：P1 | **模块**：finance | **类别**：文档漂移

`finance/CLAUDE.md` 两处写明：

> 可靠 operation DDL 为 `docs/migrations/20260710_finance_integration_operations.sql`，Finance target receipt DDL 为 `docs/migrations/20260710_service_command_receipt.sql`；**均未在本地或真实租户执行**。
>
> DDL 为 `docs/migrations/20260711_finance_dead_letter_actionable_lifecycle.sql`，**未在本地或真实租户执行**。

生产核验：`integration_operation`、`integration_operation_attempt`、`integration_operation_dead_letter_actionable`、`service_command_receipt` **四张表全部存在**，`finance` adapter 的 16 张 `requiredTables` 和 9 个 `requiredColumns` **全部齐全**；`altoc` adapter 的 55 张 `requiredTables` 也全部齐全。

这条陈述会让上线前检查把注意力放错地方——真正漂移的是 `payment_request.reject_reason`（ISSUE-B-002）和 `service_ticket` 的 7 列（ISSUE-B-009），恰恰是文档没提的两处。

### ISSUE-B-015 合同页两处使用浏览器原生 `window.prompt`

- **级别**：P1 | **模块**：altoc | **类别**：前端

- `altoc/app/pages/contracts/[id].vue:1128`：`window.prompt('请输入取消原因')` —— 取消履约启动作业
- `altoc/app/pages/contracts/[id].vue:1171`：`window.prompt('请输入驳回原因')` —— 合同驳回

根 `CLAUDE.md` 明确禁止原生 `confirm` / `alert` / `prompt`。同一文件其他位置（:1258）已正确使用 Foundation `useConfirm()`，说明是遗漏而非设计选择。两处都在合同主线的状态流转上。

### ISSUE-B-016 前端读取 BFF 早已不返回的 `financeSubmitError` 字段（死分支）

- **级别**：P1 | **模块**：altoc | **类别**：前端

`altoc/app/pages/payments/[id].vue:39,154` 与 `contracts/[id].vue:344,943` 声明并读取 `data.financeSubmitError`，据此决定 toast 是 warning 还是 success。

但当前 BFF（`invoice-request.post.ts:52-63`）返回的是 `{ receivablePlan, invoiceRequest, operation, delivery, invoiceRequestCode, workflowOperationKey, idempotencyKey }`——**没有 `financeSubmitError`**。该字段只存在于已退役的 `:record` 路径（`service_receivables.go:787`）。

⇒ warning 分支永远不会走到，是 ISSUE-B-001「永远绿色」的直接成因之一。

### ISSUE-B-017 前端取 `data.invoiceRequest.code`，但该对象是未落库的构造体，永远没有 `code`

- **级别**：P1 | **模块**：altoc | **类别**：前端

`prepareReceivablePlanInvoiceRequest` 返回的 `invoiceRequest` 是 runtime 在内存里拼的 map（`service_receivables.go:707-727`），**不含 `code`**——真正的编号要等 Finance 侧创建成功后由 receipt 返回。

BFF 已经正确地把它放在 `data.invoiceRequestCode`，但前端读的是 `data.invoiceRequest.code`。结果 toast 永远显示「开票申请已创建」而不是「开票申请 IR2026xxxx 已创建」，用户拿不到单号。

### ISSUE-B-018 商机看板一次拉 200 条并在前端 `reduce()` 算金额合计

- **级别**：P1 | **模块**：altoc | **类别**：前端 / 金额口径

`altoc/app/pages/opportunities/index.vue:60-61`：看板模式 `pageSize: 200`；`:96-99` 用客户端 `reduce()` 计算每个阶段列的金额合计。

商机数超过 200 时，看板列头金额会**静默少算**（列表模式分页正确，只有看板有问题）。生产当前 `opportunity` 仅 7 条，暂未暴露；10 月起量后会出现「看板合计 ≠ 列表合计」。

根 `CLAUDE.md` 已明令禁止「给存在客户端 `reduce()` 合计的列表直接加服务端分页」。

### ISSUE-B-019 `finance_invoice.invoice_no` 无唯一约束，开票动作也不校验重复

- **级别**：P1 | **模块**：finance | **类别**：业务逻辑 / 金额口径

`issueInvoiceRequest`（`write_invoice_requests.go:91-131`）直接把用户填的 `invoiceNo` 插入 `finance_invoice`，**不查重**；生产 `finance_invoice` 上也**没有 `invoice_no` 的唯一索引**（只有 `code` 和 `(legacy_source, legacy_id)`）。

同一张发票号被登记两次 → `recalculateContractSummary` 把开票金额重复累加 → 合同财务摘要的「已开票金额」虚高 → 回写 Altoc 后经营侧据此判断「还能开多少票」也跟着错。

生产当前无重复发票号（已核验，0 组）。触发需要人工录入错误，因此定 P1。

### ISSUE-B-020 `allowFinanceWideScopes` 让 `finance:*` / `finance:admin` 绕过精确 capability

- **级别**：P1 | **模块**：finance | **类别**：跨应用授权

`finance/server/middleware/tenant-runtime.ts:122` 对**所有** service 端点统一传 `allowFinanceWideScopes: true`，`requireFinanceServiceCapability`（`serviceAuth.ts:22-24`）据此放行持有 `finance:*` 或 `finance:admin` 的调用方，跳过 `finance:invoice-request:create` 这类精确 capability 检查。

同时 `finance/server/utils/checkPermission.ts:63-71` 的 `hasServicePermission` 让任何持 `finance:read` 的 service token 对**所有资源**获得 `view`、持 `finance:write` 获得 `edit`，且该判断**先于** uid 与数据范围解析执行。

生产当前没有任何客户端持有 `finance:*` / `finance:admin`，所以暂无实际暴露面。但这与根 `CLAUDE.md`「每一个 scope 都必须有独立、精确且 active 的 Console grant」冲突，属于会随时间劣化的旁路。

### ISSUE-B-021 审批职责分离「任一 actor ≠ 申请人即通过」

- **级别**：P1（置信度中） | **模块**：finance | **类别**：授权

`write_approval.go:408-417`：

```go
actors := uniqueCleanStrings(options.ApprovalActorUIDs, options.Operator)
for _, actor := range actors {
    if actor != requester { return nil }   // ← 任意一个不等于申请人就整体放行
}
```

`ApprovalActorUIDs` 来自请求体（`approvalActorUIDsFromBody`，:391-398）。因此只要 actor 列表里出现任何一个非申请人 uid，即使实际操作人就是申请人本人也会通过——自审批可绕过。

缓解因素：该路径是 `/api/v1/finance/workflow/callback`，有 `workflow:callback` service token 与 `allowedApps: ['workflow']` 双重限制，浏览器不可直达，actor 由 Workflow 提供。多节点审批场景下「申请人是其中一个审批人」也可能是合法的。因此定 P1 并标注置信度中——需要与 Workflow 侧确认 actor 语义后再判断是否为真缺陷。

---

## 3. 核验方法与可复核性

所有生产结论均可用以下**只读** SQL 复核（连接参数见 `data-runtime/.env`，租户 `C000001`）。

```sql
-- B-001 / B-010：调用方 grant 缺失
SELECT sc.client_code, CONCAT(g.resource_code,':',g.action) cap, g.status
FROM hzy_console.service_clients sc
JOIN hzy_console.service_client_grants g ON g.service_client_id = sc.id
WHERE sc.client_code IN ('altoc.runtime','finance.runtime')
  AND CONCAT(g.resource_code,':',g.action) IN
      ('finance:invoice-request:create','aims:service-ticket:work-item:create');
-- 期望 2 行，实际 0 行

-- B-002：付款申请缺驳回列
SELECT t.n,
  MAX(c.COLUMN_NAME='reject_reason') has_reject_reason
FROM (SELECT 'invoice_request' n UNION SELECT 'expense_claim'
      UNION SELECT 'project_expense_request' UNION SELECT 'payment_request') t
LEFT JOIN information_schema.COLUMNS c
  ON c.TABLE_SCHEMA='hzy_finance' AND c.TABLE_NAME=t.n
GROUP BY t.n;
-- payment_request 为 0

-- B-004：职责冲突规则为空
SELECT COUNT(*) FROM hzy_platform.tenant_role_conflict_rules;   -- 0

-- B-009 / B-013：列漂移
SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='hzy_altoc' AND TABLE_NAME='service_ticket'
  AND COLUMN_NAME LIKE 'aims_%';    -- 期望 4 个，实际 0

-- B-011：财务角色数据范围
SELECT tr.role_code, GROUP_CONCAT(DISTINCT m.app_role_code) app_roles,
 (SELECT COUNT(*) FROM hzy_platform.tenant_role_scopes s
   WHERE s.role_id=tr.id AND s.app_code='finance' AND s.status='active') role_scopes,
 (SELECT COUNT(*) FROM hzy_platform.tenant_subject_roles sr
   JOIN hzy_platform.tenant_subject_role_scopes ss ON ss.assignment_id=sr.id
   WHERE sr.role_id=tr.id AND ss.app_code='finance' AND ss.status='active') subject_scopes
FROM hzy_platform.tenant_roles tr
JOIN hzy_platform.tenant_role_app_role_maps m ON m.role_id=tr.id
WHERE m.app_role_code LIKE 'finance%'
GROUP BY tr.id;

-- 摘要背景：主链路从未执行
SELECT 'contract_orchestration_job' t, COUNT(*) c FROM hzy_altoc.contract_orchestration_job
UNION ALL SELECT 'altoc integration_operation', COUNT(*) FROM hzy_altoc.integration_operation
UNION ALL SELECT 'finance integration_operation', COUNT(*) FROM hzy_finance.integration_operation
UNION ALL SELECT 'finance_reconciliation', COUNT(*) FROM hzy_finance.finance_reconciliation
UNION ALL SELECT 'payment_request', COUNT(*) FROM hzy_finance.payment_request;
-- 全部 0
```

**本轮未覆盖 / 未验证的部分（诚实声明）：**

1. **未做浏览器端到端走查。** 生产 `receivable_plan` 无任何可开票状态的计划、`contract_orchestration_job` 为 0，主线在当前数据下点不动；走查需要先造数据，超出「只读」授权。所有 P0 均为代码路径 + 生产数据/配置的静态确证。
2. **ISSUE-B-003 / B-004 的绕过未实际发起请求验证**（写操作）。建议 10 月 W2 在隔离租户实测。
3. ~~未核验托管云 Worker 环境变量~~ —— **已关闭**（2026-08-27 运维确认）：`HZY_INTERNAL_KEY`、`SKIP_PERM_CHECK`（altoc）、`HZY_FINANCE_DEV_PERMISSIONS`（finance）三者在生产**全部未设置**，见 ISSUE-B-008。
4. **未走查分支流程**：合同变更、坏账、进销存、DSO——按任务书 §2.4 属 10 月 W2 补走查范围。
5. **Finance 收入侧的到账登记→核销→回写 Altoc 三段**：grant（`finance.runtime → altoc:contract:finance-summary:sync`）已核验为 active，代码路径审阅未发现阻断级问题；但生产 `finance_reconciliation` 为 0 行，该链路同样从未被执行验证过。

---

## 4. 对 10 月 W2 排期的建议

**P0 总数 7 条。** 按修复成本粗估：

| ISSUE | 修复面 | 粗估 |
| --- | --- | --- |
| B-001 | Console grant seed + verify + 失败不再吞（与 B-005 共用改法） | 1 天 |
| B-002 | 一条 ALTER + Finance 审批路径补列防护 | 0.5 天 |
| B-003 | createSpec status 白名单收紧 + 契约测试 | 0.5 天 |
| B-004 | BFF 清洗 actor 字段 + actor 缺失失败关闭 + 生产配冲突规则 | 1 天 |
| B-005 | 与 B-001 同一反模式，建议在 Foundation 统一「未完成投递」响应约定 | 1 天（与 B-001 合并计） |
| B-006 | 幂等键设计调整 + 前端传键 + 409 文案 | 1 天 |
| **B-011** | **三步走：先补 3 个角色的 `tenant:global` scope → 再收窄 4 个非财务岗位授权 → 最后改代码默认值；每步都要回归** | **1.5–2 天** |

合计约 **6–7 人天**。**10 月 W2 一周仍可覆盖全部 P0**，但余量已经不多，不建议再往 W2 塞 P1。B-011 的跨模块排查已完成（见该条尾注）：同型写法只在 Finance 3 处 + People 1 处，`aims`/`assets`/`altoc` 均无，因此不需要动 Foundation 抽象，上述估算不再有扩散风险。据此判断**不需要启用**双月计划 §6 的「砍 10 月 P1」预案。

但有两个前提必须先解决，否则 W2 会空转：

1. **必须先能在生产或准生产造出可走链路的数据**（一条能走到 `to_invoice` 的回款计划、一条能履约启动的合同）。当前 2065 条回款计划全是 `received`，修完也验证不了。
2. **B-001 的 grant 修复必须走 Console seed + verify 双确认**（根 `CLAUDE.md` 要求「用实际 service client 对全部组合 scope 做令牌签发探测」），不能只补 SQL 行。这轮走查已经证明「SQL seed 存在」不等于「调用方拿得到令牌」——`finance.runtime` 有这条 capability，`altoc.runtime` 没有，而两者的 seed 文件都在仓库里。

**B-011 的执行顺序是硬约束，不能压缩。** 直接改代码默认值会让 6 个本应看全量的账号（财务会计 1、系统管理员 4、总经理 1）立刻全面 403——这与 Altoc 看板 403 是同型事故。必须先配 scope、验证生效，再改默认值。

另外建议把 **B-012（错误码映射缺失）** 提到 W2 一起做：它本身是 P1，但 B-002 的爆炸半径（500 + retryable → 无限重试）正是它放大的，只补列不补映射，下一次列漂移还会以同样方式炸。

**B-008 的三个开关已确认生产均未设置，不阻塞上线**，但建议 W2 顺手处理：`x-internal-api-key` 直接删（无消费方，约 6 行）；`SKIP_PERM_CHECK` / `HZY_FINANCE_DEV_PERMISSIONS` 保留本地开发用途但加生产 profile 断言。理由不是当前风险，而是这三个开关目前完全没有防误开机制——误配即静默全权限失效，且没有任何测试或告警会发现。
