# Stream C 跨应用阻断修复任务书

> 来源：Stream B 上线前走查（[`Altoc-Finance-走查ISSUE清单-2026-09.md`](./Altoc-Finance-走查ISSUE清单-2026-09.md)）
> 提出：2026-08-28 | 涉及 ISSUE：**B-023**、**B-024**（均 P0）
> 姊妹任务书：[`Stream-A-跨应用阻断修复任务书-2026-08.md`](./Stream-A-跨应用阻断修复任务书-2026-08.md)

比 Stream A 那份小很多：Stream C 的 B-023 只有 1 处，B-024 只有 2 处。

---

## 任务一（B-023）：`people` 的 operation 冻结缺 UTC `next_attempt_at`

### 问题

`integration_operation.next_attempt_at` 的列默认值 `CURRENT_TIMESTAMP(3)` 按**会话时区**求值
（生产 `session_tz=SYSTEM=CST`），而 claim 的判据 `next_attempt_at <= ?` 传的是 Go 的
`time.Now().UTC()`。两者差 8 小时，条件恒为假 —— **新冻结的 operation 在 8 小时内领不到，
即时投递永远不发生**。

Stream B 侧生产实测：

```
next_attempt_at            = 2026-08-28 06:32:35   (CST 值)
UTC_TIMESTAMP(3)           = 2026-08-27 22:32:35
claimable_with_utc_clock   = 0   ← claim 用的就是这个
```

### 需要改的文件（1 个）

```
data-runtime/internal/apps/people/directory_lifecycle_operation.go
```

`data-runtime/internal/apps/directory/console_connector_management.go` 已正确写
`next_attempt_at`，**无需改动**（确认一下它用的是 `UTC_TIMESTAMP` 即可）。

### 改法

`INSERT INTO integration_operation (...) VALUES (...)` 的列表末尾加 `next_attempt_at`，
值写 `UTC_TIMESTAMP(3)`。参考已合并的
`data-runtime/internal/apps/altoc/receivable_invoice_operation.go`。

### 回归测试

抄 `data-runtime/internal/apps/altoc/integration_operation_clock_domain_test.go`，
扫描目录换成 people。**务必验证守卫真会失败**：临时去掉那处 `next_attempt_at` 跑一次，
确认精确报错，否则等于没有防线。

### 存量数据校正

```sql
-- 先看影响行数
SELECT COUNT(*) FROM hzy_people.integration_operation
WHERE status IN ('pending','retry_wait','partial_unknown')
  AND next_attempt_at > UTC_TIMESTAMP(3);

-- 确认后再执行
UPDATE hzy_people.integration_operation
SET next_attempt_at = UTC_TIMESTAMP(3)
WHERE status IN ('pending','retry_wait','partial_unknown')
  AND next_attempt_at > UTC_TIMESTAMP(3);
```

---

## 任务二（B-024）：`people → finance` 的两处调用改走 Service Binding

### 问题

业务 Worker 此前只有 `HZY_CONSOLE_SERVICE` 一条 Service Binding，应用之间走
`https://{租户网关}/{app}/` 公网地址。托管云 Worker 用公网地址会重新进入公共边缘和 WAF，
生产 zone `huizhi.yun` 的 `CN_CA_JP` 规则 block 掉 `country ∉ {CA,CN,JP}` 的请求，
而 Worker 子请求无访客上下文、被归属为 `country=US`。

Stream B 侧实测（altoc → finance）：浏览器打该 URL 正常返回 401，
Altoc Worker 打同一 URL 则目标 Worker **零入站且不报错**。

### 前置依赖

Stream B 已提供机制（MR !21，已合并）：`foundation/server/utils/appServiceBinding.ts`，
统一入口 `serviceAppFetch`。直接复用，不要另起一套。

### 2.1 配置增加绑定

`people/scripts/render-cloudflare-config.mjs` 的 `services` 补上：

```js
{ binding: 'HZY_FINANCE_SERVICE', service: value('HZY_FINANCE_WORKER_NAME', 'hzy-finance') },
```

> worker 命名已核对：默认 `hzy-<app>`，只有 Console 因显式设了
> `HZY_CONSOLE_WORKER_NAME` 才叫 `hzy-console-prod`。`hzy-finance` 已确认存在。

### 2.2 出站调用切换（2 处）

| 文件 | 目标 |
| --- | --- |
| `people/server/utils/financePerformanceAmounts.ts:83` | finance |
| `people/server/utils/financeCostParameters.ts:69` | finance |

改法：`$fetch<T>(url, opts)` → `serviceAppFetch<T>(event, 'finance', url, opts)`。

### 明确不在本次范围

`people/server/utils/` 里目标为 **`console`** 的调用（`dingTalkHRSource.ts`、
`consoleRankSettings.ts`、`consoleDirectoryProjection.ts` ×2、`directoryLifecycleOperation.ts`）
**不要动**。它们应走既有的 `HZY_CONSOLE_SERVICE` 绑定，属另一件事；
其中两处已用 `directTarget: true`，语义不同，改前需单独评估。

---

## 验收标准

### 提交前

```bash
cd people && pnpm lint && pnpm typecheck && pnpm test
cd data-runtime && go build ./... && go vet ./internal/apps/people/ && go test ./internal/apps/people/
```

> **`pnpm lint` 一定要跑。** Stream B 有两个 MR 因为只跑了 test 和 typecheck、
> 漏了 lint，`release_check` 挂掉返工。

### 两个 Stream B 踩过的坑

1. **不要用正则批量替换调用点** —— 调用形状不一致（`appendPath(...)`、模板字符串、多行），
   正则会漏改或改错。逐个读了再改。
2. **注意 `event` 是否在作用域内。** Stream B 在 `codocsApi.ts` 遇到函数签名不含 `event`，
   改造需连带调整调用方签名，当时选择不改并记为后续项。宁可不改也别硬塞，
   typecheck 会挡住半吊子改法。

### 部署后端到端复验

⚠️ **不要用 `service_client_grants.last_used_at` 判断调用是否成功。**
该字段是 Console **签发令牌**时打的点，不是目标应用收到时。Stream B 实测：
`finance:invoice-request:create` 有签发记录，但 Finance 侧零入站、零记录。

正确做法：

1. 开两个 tail：`wrangler tail hzy-people` 与 `wrangler tail hzy-finance`
2. 触发一次绩效金额或人力成本参数读取
3. 确认 `hzy-finance` tail **有入站**（此前是零入站）
