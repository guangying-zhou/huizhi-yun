# Stream A 跨应用阻断修复任务书

> 来源：Stream B 上线前走查（[`Altoc-Finance-走查ISSUE清单-2026-09.md`](./Altoc-Finance-走查ISSUE清单-2026-09.md)）
> 提出：2026-08-28 | 涉及 ISSUE：**B-023**、**B-024**（均 P0）
> 影响：不做这两项，Aims 与其他应用之间的跨应用调用在生产**全部不可用**

---

## 0. 为什么这是 Stream A 的事

Stream B 在生产做端到端验证时定位到两个平台级 P0。修复方式已在 Stream B 侧验证有效，
但同型问题在 `aims/` 与 `data-runtime/internal/apps/aims/` 里同样存在，按并行协作约束
（双月计划 §7.2）Stream B 不跨界改动，需 Stream A 自行修复。

**最直接的业务后果**：`altoc:receivable:mark-billable` 是回款计划推进到「可开票」的
**唯一**路径，由 Aims 里程碑验收触发。这条不通，Altoc 的开票申请永远不可达 ——
即使 Stream B 侧全部修好也没用。

---

## 任务一（B-023）：integration_operation 冻结时必须显式写 UTC `next_attempt_at`

### 问题

`integration_operation.next_attempt_at` 的列默认值是 `CURRENT_TIMESTAMP(3)`，
MySQL 按**会话时区**求值。生产 `session_tz=SYSTEM=CST(UTC+8)`，于是新冻结的 operation
拿到本地墙钟值；而 claim 的判据是 `next_attempt_at <= ?`，参数来自 Go 的
`time.Now().UTC()`。两者差 8 小时，条件恒为假。

生产实测（Stream B 侧）：

```
next_attempt_at            = 2026-08-28 06:32:35   (CST 值)
UTC_TIMESTAMP(3)           = 2026-08-27 22:32:35
claimable_with_local_clock = 1
claimable_with_utc_clock   = 0   ← claim 用的就是这个
```

**后果**：每条新建 operation 在 8 小时内都领不到，即时投递永远不发生。

> 代码其余位置写 `next_attempt_at` 一律用 `UTC_TIMESTAMP(6)`，UTC 才是约定域，
> 列默认值是那个异类。

### 需要改的文件（3 个）

```
data-runtime/internal/apps/aims/milestone_receivable_operation.go
data-runtime/internal/apps/aims/people_contribution_operation.go
data-runtime/internal/apps/aims/service_ticket_operation.go
```

（`company_weekly_summary_governance.go` 已正确写 `UTC_TIMESTAMP`，无需改动。）

### 改法

在 `INSERT INTO integration_operation (...) VALUES (...)` 的列表末尾加上
`next_attempt_at`，值写 `UTC_TIMESTAMP(3)`。参考 Stream B 已合并的实现：
`data-runtime/internal/apps/altoc/receivable_invoice_operation.go`。

### 回归测试

抄 `data-runtime/internal/apps/altoc/integration_operation_clock_domain_test.go`，
把扫描目录换成 aims。该测试做两件事：

1. 所有 `INSERT INTO integration_operation` 必须显式含 `next_attempt_at` 且用 `UTC_TIMESTAMP`
2. 禁止任何位置用会话本地时钟（`CURRENT_TIMESTAMP` / `NOW(`）写该列

**务必验证守卫真的会失败**：临时去掉一处 `next_attempt_at` 跑一次，确认精确报错。

### 存量数据修复

生产已有卡住的 operation 需要一次性校正（Stream B 已对 altoc 做过）：

```sql
UPDATE hzy_aims.integration_operation
SET next_attempt_at = UTC_TIMESTAMP(3)
WHERE status IN ('pending','retry_wait','partial_unknown')
  AND next_attempt_at > UTC_TIMESTAMP(3);
```

执行前先用 `SELECT` 看影响行数。

---

## 任务二（B-024）：应用间跨应用调用改走 Service Binding

### 问题

每个业务 Worker 此前只有 `HZY_CONSOLE_SERVICE` 一条 Service Binding，**应用之间一条都没有**，
跨应用调用一律走 `https://{租户网关}/{app}/` 公网地址。

生产实测（Stream B 侧，altoc → finance）：

| 发起方 | 结果 |
| --- | --- |
| 浏览器 POST 该 URL | ✅ `401`（路由正常，要求服务令牌） |
| Altoc Worker POST 同一 URL | ❌ `wrangler tail hzy-finance` **零入站**，且**不报错** |

失败完全静默：Worker outcome 是 `Ok`，operation 停在 `processing`、
`attempt.finished_at` 为空、`last_error_code` 为 NULL，成为孤儿。

### 根因

`foundation/server/utils/consoleServiceBinding.ts` 的注释早已写明：托管云 Worker 用公网地址
会重新进入公共边缘和 WAF，生产 zone `huizhi.yun` 的 `CN_CA_JP` 规则 block 掉
`country ∉ {CA,CN,JP}` 的请求，而 Worker 子请求无访客上下文、被归属为 `country=US`。
该规则的 bypass 例外只覆盖 `wiztek-data-runtime.huizhi.yun`（所以调 data-runtime 正常）。

**同一约束对应用之间同样成立，此前只对 Console 实现。**

> ⚠️ **不要用 `service_client_grants.last_used_at` 判断调用是否成功。**
> 该字段是 Console **签发令牌**时打的点，不是目标应用收到时。Stream B 实测：
> `finance:invoice-request:create` 有签发记录，但 Finance 侧零入站、零记录。
> aims 的 `assets:read` 显示"已使用"同理，不能据此认为 aims→assets 是通的。

### 前置依赖

Stream B 已在 MR **!21** 提供机制：`foundation/server/utils/appServiceBinding.ts`
（`appServiceBinding` / `normalizeAppServiceBindingUrl` / 统一入口 `serviceAppFetch`）。
**本任务需等 !21 合并后再开始**，直接复用该 helper，不要另起一套。

### 2.1 Cloudflare 配置增加应用间 binding

改 `aims/scripts/render-cloudflare-config.mjs` 的 `services`，在现有
`HZY_CONSOLE_SERVICE` 之外补上 Aims 实际调用的目标应用：

```js
{ binding: 'HZY_ALTOC_SERVICE',  service: value('HZY_ALTOC_WORKER_NAME',  'hzy-altoc')  },
{ binding: 'HZY_ASSETS_SERVICE', service: value('HZY_ASSETS_WORKER_NAME', 'hzy-assets') },
{ binding: 'HZY_PEOPLE_SERVICE', service: value('HZY_PEOPLE_WORKER_NAME', 'hzy-people') },
{ binding: 'HZY_CODOCS_SERVICE', service: value('HZY_CODOCS_WORKER_NAME', 'hzy-codocs') },
```

> 生产 worker 命名已核对：默认 `hzy-<app>`，只有 Console 因显式设了
> `HZY_CONSOLE_WORKER_NAME` 才叫 `hzy-console-prod`。

### 2.2 出站调用切到 `serviceAppFetch`

需要改的调用点（`grep -rn "resolveServiceAppBaseUrl(event, '" aims/server`）：

| 文件 | 目标应用 | 备注 |
| --- | --- | --- |
| `utils/serviceTicketDeliveryOperation.ts:73` | altoc | |
| `utils/serviceTicketDeliveryOperation.ts:106` | altoc | |
| `utils/serviceTicketDeliveryOperation.ts:121` | altoc | **`mark-billable`，最关键的一条** |
| `utils/serviceTicketDeliveryOperation.ts:142` | people | |
| `utils/serviceTicketDeliveryOperation.ts:159` | codocs | |
| `utils/projectEnvironmentAssetsSync.ts:105` | assets | |
| `api/v1/projects/[id]/environments/upsert.post.ts:169` | assets | |
| `api/v1/product-assets.get.ts:40` | assets | 用了 `directTarget: true`，改前先确认语义 |

`console` 目标（`projectGovernanceRoleHolder.ts`、`work-calendars/.../days.get.ts`）
**不在本次范围**，它们应改走既有的 `HZY_CONSOLE_SERVICE`，属另一件事。

改法：`$fetch<T>(url, opts)` → `serviceAppFetch<T>(event, '<app>', url, opts)`。

> ⚠️ 有两个坑，Stream B 都踩过：
> 1. **不要用正则批量替换。** 调用形状不一致（`appendPath(...)`、模板字符串、多行），
>    正则会漏改或改错。逐个文件读了再改。
> 2. **注意 `event` 是否在作用域内。** Stream B 在 `codocsApi.ts` 遇到函数签名不含
>    `event`，改造需连带调整调用方签名——当时选择了不改并记为后续项。
>    Aims 若遇到同样情况，宁可暂时不改也别硬塞，typecheck 会挡住半吊子改法。

---

## 验收标准

### 提交前

```bash
cd aims && pnpm lint && pnpm typecheck && pnpm test
cd data-runtime && go build ./... && go vet ./internal/apps/aims/ && go test ./internal/apps/aims/
```

> **`pnpm lint` 一定要跑。** Stream B 有两个 MR 因为只跑了 test 和 typecheck、
> 漏了 lint，`release_check` 挂掉返工。

### 部署后必须做端到端复验

光看 SQL 行和 `last_used_at` **不足以证明打通**。必须：

1. 开两个 tail：`wrangler tail hzy-aims` 与 `wrangler tail hzy-altoc`
2. 触发一次里程碑验收（走 `mark-billable`）
3. 确认：
   - `hzy-altoc` tail **有入站**（这是关键，此前是零入站）
   - `hzy_altoc.receivable_plan` 对应计划 `status` 变成 `to_invoice`
   - Aims 侧 operation 走到 `succeeded`，`attempt.finished_at` 非空

Stream B 侧留了可复用的诊断数据：`hzy_altoc` 的客户 `C-QA0901`、合同 `C-QA0901-CT`、
回款计划 `C-QA0901-RP`，编码带诊断前缀，不影响真实业务。

---

## 与 Stream B 的衔接

- 任务二需等 MR **!21** 合并
- 两条链路**必须两侧都修完**才算通：Altoc→Finance（Stream B 已修）与
  Aims→Altoc（本任务）。任一侧未修，LTC 主线仍然断
- Stream C 的 `people/` 与 `directory/` 有 B-023 同型问题，需另行告知
