# Aims 系统管理删除项目返回 500

日期：2026-08-23

## DEBUG REPORT

- Status: RESOLVED（2026-08-23 用户部署 aims Worker 后确认删除恢复正常）
- Symptom:
  - 系统管理员在 Aims「系统管理 / 项目管理」删除项目时，`DELETE /aims/api/v1/admin/projects/{id}` 返回 500。
  - Cloudflare 判定 Worker 代码永久挂起并取消请求；Data Runtime 从未收到 `/v1/aims/admin/projects/36`。

### 第一轮（结论有误，已纠正）

第一轮把故障归因为 Foundation 跨请求 Promise、Tenant Gateway schema gate 和 Go 删除事务外键顺序，
修复后 Worker `f5c33cf4`、Data Runtime `0.3.165` 均已上线，但**删除仍然 500**。
那三项都是真实缺陷，但都不是本故障的原因。

### 第二轮（确认根因）

生产实时 tail 抓到的失败事件：

```
DELETE https://aims.huizhi.yun/aims/api/v1/admin/projects/36 -> 500
wallTime 10901ms / cpuTime 4ms / logs: []
EXC: The Workers runtime canceled this request because it detected that
     your Worker's code had hung and would never generate a response.
```

根因在依赖链本身，与业务代码无关：

1. Nitro 的 Cloudflare 入口 `_module-handler.mjs` 只在 `requestHasBody(request)` 为真时缓冲请求体；
   `nitropack/runtime/internal/utils.mjs` 里 `const METHOD_WITH_BODY_RE = /post|put|patch/i` —— **不包含 DELETE**。
2. 因此带 body 的 DELETE 进入 Worker 后 `node-mock-http` 把 `req.body` 置为 `null`，而 `content-length: 23` 仍在。
3. h3 `readRawBody` 的 `_rawBody` 全部取空，又因为 content-length 存在而不会走「无 body」早退，
   于是退回 Node 流事件：`req.on('end', () => resolve(...))`。
4. `node-mock-http` 的 mock Readable 永远不会 emit `'data'` / `'end'`，Promise 永不 settle。
   Worker 挂死 → Cloudflare 约 10s 后取消 → 500。**无任何日志，`.catch()` 也捕获不到。**

这解释了全部现象：只有带 body 的 DELETE 会挂（POST/PUT/PATCH 正常）、零日志、cpuTime 极低、
Data Runtime 收不到请求、入口权限校验先成功（在 `readBody` 之前）、未登录 DELETE 仍稳定 401。

- Fix:
  - 新增 `foundation/server/utils/requestBody.ts` 的 `readRequestBodyCompat(event)`：
    对 Nitro 未缓冲的方法从 `event.context._platform.cloudflare.request` 取回 body，
    预置到 h3 优先读取的 `event._requestBody` 后再交给 `readBody`，保持 content-type 解析语义一致；
    拿不到原始 Request 且识别出 mock 流时直接返回 undefined，宁可缺 body 也不挂死。
  - 四个转发点改用该 helper：`tenantRuntimeProxy.ts`、`tenantRuntimeClient.ts`、
    `dataRuntimeClient.ts`、`server/api/workflow-proxy/[...path].ts`。
- Regression tests:
  - `foundation/test/requestBodyCloudflareDelete.test.ts`（精确复刻 node-mock-http 行为，
    带 2s 超时守卫，回归时会失败而不是挂起）
  - `foundation/test/tenantRuntimeProxy.test.ts` 增加 `assert.doesNotMatch(/\bawait readBody\(event\)/)`
- Verification: foundation 286/286、aims 235/235、两边 lint + typecheck 全绿；aims Worker 已部署，用户确认线上删除恢复正常。
- Residual risk:
  - **同一缺陷影响所有模块的「带 body 的 DELETE」**。修复在 Foundation layer，各模块 Worker
    必须各自重新部署才会生效；当前只部署了 aims，其余模块仍会挂死。

## 附带发现：drain 403（根因已确认并修复）

`POST /aims/api/internal/integration-operations/drain` 每次 cron 都 503。

### 根因：Cloudflare WAF 地理规则

zone `huizhi.yun` 上的 firewall rule `CN_CA_JP`（id `99f690b5f43141f5b5e8c5c481a369de`）：

```
block if  ip.src.country ∉ {CA, CN, JP}
      AND NOT (http.host eq "wiztek-data-runtime.huizhi.yun"
               and starts_with(http.request.uri.path, "/v1/")
               and http.user_agent eq "HZY-Cloudflare-Worker/1.0")
```

**cron 触发的 Worker 子请求没有访客上下文，被 Cloudflare 归属为 `country=US`** → 不在白名单
→ 在到达 Console 之前就被边缘 block 成 403（约 7ms，Console 侧无任何日志）。
浏览器触发的子请求继承访客国家（CA）所以能通过 —— 这解释了"同一 URL 相隔 3 秒一个 200 一个 403"。

bypass 例外只覆盖 `wiztek-data-runtime.huizhi.yun`，不覆盖 `console.huizhi.yun`。
且 `consoleRuntime.ts` 走公网时**没有设置** bypass 规则要求的 `HZY-Cloudflare-Worker/1.0` UA
（`tenantRuntimeClient.ts` 定义了 `workerServiceUserAgent` 但 consoleRuntime 没用）。

Firewall events 铁证（2026-08-23T22:15，每 5 分钟一组）：
```
country=US  console.huizhi.yun  /api/v1/console/runtime/apps/aims/config      ua=(空)
country=US  console.huizhi.yun  /api/v1/console/runtime/apps/altoc/config     ua=(空)
country=US  console.huizhi.yun  /api/v1/console/runtime/apps/people/config    ua=(空)
country=US  console.huizhi.yun  /api/v1/console/runtime/apps/workflow/config  ua=(空)
```
正好是有 drain 端点的四个应用。

失败链路：WAF 403 → `getConsoleRuntimeConfig` 降级 fallback → `console.tokenUrl` 为空
→ `serviceOidc.ts:446` 抛 503 `Console service client is not configured.`

### 修复

- 新增 `foundation/server/utils/consoleServiceBinding.ts`（独立模块，打破
  `serviceOidc.ts` ↔ `consoleRuntime.ts` 的循环依赖）。
- `consoleRuntime.ts` 改为优先经 `HZY_CONSOLE_SERVICE` Service Binding 取 runtime config
  —— Worker 间直连，根本不经过边缘，不受任何 WAF/地理规则影响。这也正是根 CLAUDE.md 的要求。
- 无 binding 的部署（自托管/本地）保留 HTTP 回退，但必须带 `HZY-Cloudflare-Worker/1.0` UA。
- `serviceOidc.ts` 的私有 binding helper 改为复用共享模块，消除重复。
- 回归测试 `foundation/test/consoleRuntimeServiceBinding.test.ts`；
  `consoleRuntimeAuthorizationClient.test.ts` 的 binding 调用断言同步更新（3 → 4）。
- 验证：foundation 288/288、lint、typecheck 全绿。**尚未部署。**

### 部署注意

修复在 Foundation layer，**aims / altoc / people / workflow 四个应用都要重新部署**才生效。

---

## 第三层：data-runtime 缺表（aims / altoc）

WAF 修好后 drain 仍 503，诊断日志显示 `upstreamStatus: 500`。

SSH `root@oa.wiztek.cn` 查 data-runtime 日志：
```
/v1/aims/integration-operations:pending-dead-letter-actionables   500  durationMs=1
/v1/altoc/integration-operations:pending-dead-letter-actionables  500  durationMs=1
```
1ms 立即失败 = MySQL "Table doesn't exist"。

**根因**：`integration_operation_dead_letter_actionable` 表在 `hzy_assets` / `hzy_finance` /
`hzy_people` 存在，但 **`hzy_aims` / `hzy_altoc` 缺失**。
代码层面对应：`data-runtime/internal/apps/{aims,altoc}/adapter.go` 的 `requiredTables`
漏了这张表（people/finance/assets 都有），所以 schema 门禁从不报缺表，迁移也就没人做。
该表是 drain 的**第一步**查询，失败后一条 operation 都领不到。

**修复**：
- `docs/sql/migration_prod_integration_operation_dead_letter_actionable_aims_altoc.sql`（补建表）
- 两个 adapter 的 `requiredTables` 补上该表（go build + test 通过）
- ⚠️ **必须先跑迁移再发 data-runtime** —— 反过来 schema 门禁会判定 aims/altoc 未就绪，全量 503

**影响**：aims/altoc/finance/assets 的 outbox 积压均为 **0 条**，无数据损失。

## People 的严重积压（根因已定位并修复）

`hzy_people.integration_operation` 有 **93 条卡在 2026-07-24**：

| operation | 状态 | 数量 | attempt_count | 上限 |
|---|---|---|---|---|
| employment-sync | pending | 62 | 0 | 8 |
| offboarding-disable | pending | 12 | 0 | 8 |
| employment-sync | retry_wait | 9 | 7 | 8 |
| employment-sync | processing | 7 | **2137** | 8 |
| employment-sync | partial_unknown | 2 | **3309** | 8 |
| offboarding-disable | processing | 1 | **5261** | 8 |

`last_error_code=http_503`（WAF 那层导致），但 **attempt_count 远超 max_attempts 却从不进死信**：
`/v1/people/integration-operations/{key}:fail` 稳定返回 500，导致 operation 永远停在
`processing` 被反复重新领取 —— `version_no` 已到 10522（≈ attempt_count × 2），
`last_attempt_at` 显示现在仍在每 5 分钟跑。

即：**重试上限形同虚设**。`:fail` 为何 500 尚未定位（people 的 actionable 表是存在的），
是下一个要查的线索。这批是员工任职同步和离职停用，卡了一个月未同步到 Console Directory。

### People `:fail` 500 根因

`data-runtime/internal/apps/people/assets_offboarding_projection.go` 的
`claimPeopleIntegrationOperation` / `succeedPeopleIntegrationOperation` /
`failPeopleIntegrationOperation` **没有把 `ErrPersistenceRace` 映射成 409**，
而 aims / altoc 的同名入口都映射了（people 只在 `integration_operation_admin.go`
的 dead-letter ack 路径映射过）。

触发链：
1. claim 接受 `status IN ('pending','retry_wait','partial_unknown')` → 置 `processing`（60 秒租约）
2. 投递失败（当时是 WAF 导致的 http_503）
3. 租约过期，reaper 把 `processing` 翻成 `partial_unknown`
4. `:fail` 的 `recordOperationFailureSQL` 要求 `WHERE status='processing'` → 匹配 0 行
   → `requireOneRow` 返回 `ErrPersistenceRace`
5. people 未映射 → 漏成 **500** → BFF 视为可重试 → 永不 checkpoint
6. 下一轮 claim 再次领取（partial_unknown 可领）→ attempt_count++ → 回到 2

**后果：`max_attempts=8` 完全失效**，单条 operation attempt_count 达 5261、version_no 10522。

**修复**：三个入口补上 `ErrPersistenceRace`/`ErrOperationNotFound` → 409 映射。
回归测试 `data-runtime/internal/apps/people/integration_operation_lease_conflict_test.go`
（修复前该文件 `ErrPersistenceRace` 出现 0 次，测试必然失败）。
`go build` / `go vet` / `go test ./...` 全过。

⚠️ **部署前需业务确认**：修复后那 74 条 `pending`（attempt_count=0，2026-07-24 冻结的
employment-sync / offboarding-disable 命令）会真正投递到 Console Directory。
若这一个月内员工任职/离职状态已变，重放可能用陈旧快照覆盖现状。
需确认 Console 侧是否按 `source_operation_version` / `:r1` revision 做单调守卫。

### 修复不完整 —— 真正的哨兵是 ErrStaleFencing（第二轮）

首轮只映射了 `ErrPersistenceRace` / `ErrOperationNotFound`，部署后 `:fail` **仍然 500**
（已用 `strings` 确认二进制包含新文案，排除部署问题）。

真正漏掉的是 **`ErrStaleFencing`**：`loadAndValidateCompletionState` 在
`!now.Before(state.lockedUntil.Time)`（**租约过期**）时返回它。
全仓库 **没有任何应用**映射过这个哨兵——aims/altoc 也没有，只是队列为空未暴露。

**系统性缺陷**：`server.go` 的 `retryableHTTPStatus` 把 `status >= 500` 判为可重试，
所以任何未映射的哨兵都会变成"可重试的 500" → 调用方永不 checkpoint → 无限重试。

**最终修复（中央兜底）**：在 `data-runtime/internal/server/server.go` 的 `writeError`
增加 `integrationOperationSentinelStatus()`，把 `ErrStaleFencing` / `ErrPersistenceRace` /
`ErrOperationNotFound` 统一映射为 **409**，任何应用再遗漏都不会退化成无限重试。
`ErrCorruptOperation` 刻意保持 500（真实数据损坏应当暴露）。
各应用原有的精确 httperror 保留不变。

回归测试 `data-runtime/internal/server/integration_operation_sentinel_status_test.go`
（覆盖直接返回与 `%w` 包装两种情形，并断言 409 不可重试）。
`go build` / `go vet` / `go test ./...` 全过。**待部署（VERSION 0.3.168）。**

