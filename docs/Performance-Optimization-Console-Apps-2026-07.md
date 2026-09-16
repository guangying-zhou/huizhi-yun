# Console 与业务应用性能优化分析报告（评审修订与实施记录）

- 日期：2026-07-21
- 修订依据：静态扫描结果复核、关键调用链代码审读、Codocs / Finance Nuxt 构建、模块与 data-runtime 回归测试
- 范围：`console/`、`foundation/`、`aims/`、`altoc/`、`assets/`、`finance/`、`people/`、`workflow/`、`codocs/` 及接入层（nginx / Caddy / Cloudflare）
- 补充抽查：相关 BFF → tenant-runtime / 跨应用调用链，以及 `data-runtime/internal/apps/workflow` 的分页合同
- 明确排除：`platform/`（低频管理台的大页拉取问题另行处理）、`account/`（workspace 规则默认排除）
- 方法与边界：本报告仍以静态分析为主，未做生产流量 profiling、压测或数据库 `EXPLAIN`；因此性能优先级以“已确认的正确性问题和跨网络放大问题优先，缓存与包体优化先测量后实施”为原则。

## 0. 2026-07-21 实施摘要

本报告所列可由本地代码证实的优化已按批次实施；生产运行时指标、真实租户大数据集与 Cloudflare zone 仍需部署后验证。

| 批次 | 实施结果 | 本地验证 |
| --- | --- | --- |
| Workflow 真分页 | flows / actions / forms 改为 20 条服务端分页、300ms 防抖搜索、筛选重置页码并展示 total | Workflow typecheck 与 49 项测试通过 |
| 跨网络 N+1 | Assets 多产品解析由 N 次 runtime 请求改为一次 `product_codes` 批量查询；Aims 来源文档保持逐文档 ACL，并用 4 worker 有界并发替代 2N 次串行调用 | Assets 86 项、Aims 199 项测试通过；data-runtime 对应包测试通过 |
| Codocs Mermaid | 三处静态 runtime 导入收敛到共享异步 loader，复用加载 Promise，并串行隔离不同初始化配置 | Codocs 142 项测试、typecheck、lint、build 通过 |
| Session bridge | 仅在同一 `H3Event` 中 memoize 正在执行的 Promise；独立请求不共享 | Foundation 266 项测试、typecheck、lint；定向测试验证同请求 1 次、不同请求各 1 次 |
| Directory 缓存 | **未实施**。本地无运行服务和 QPS / p95 / 命中率证据，不满足条件项进入标准 | 保留现有逐请求授权语义 |
| Finance 大页 | 银行账户与余额快照改为 20 条真分页；项目核算把 Finance 项目范围下推 Aims 后分页；账户选择器按 100 条逐页取全；余额变化聚合不再发送无效大页参数 | Finance 100 项测试、typecheck、lint、build；data-runtime 全量 Go 测试通过 |
| staging 静态资源 | HTTP/HTTPS nginx `_nuxt` 缓存覆盖 dev-stack 实际暴露的根 Console、Aims、Altoc、Assets、Codocs、Finance、Workflow base path | 静态合同测试通过；本机无 nginx / 运行入口，`nginx -t` 与响应头留待部署验证 |

Codocs 构建对比：全局 entry 约 `698,347 raw / 218,990 gzip`，与优化前基本不变；原约 `2.14 MB raw / 620 KB gzip` 的编辑器共享 chunk 被拆为约 `1,572,062 / 490,157` 的编辑器 chunk 和约 `561,564 / 130,221` 的按需 Mermaid core。收益是无 Mermaid 场景少下载约 130 KB gzip，而不是全局 entry 缩小。

浏览器验证曾启动本地 Finance 并以 1440px 访问银行账户页；应用按预期 302 到 Console 登录，但本地 Console 未运行，最终为连接拒绝，因此没有可用的登录态页面可继续做 1440px / 390px 视觉验收。Node 命令在当前 shell 的 v25.8.1 下执行并产生 engines 警告（仓库要求 `>=24.18.0 <25`）；测试与构建仍通过，CI / 发布应使用仓库固定的 Node 24.18.0。

## 1. 总体结论

基础健康面总体良好：认证相关缓存链已存在，轮询多数具备可见性或次数约束，Finance 主列表已有防抖与分页，Caddy staging 已启用压缩。原报告中的部分结论需要撤回或降级：

- **没有证据支持把服务端缓存列为性能 P0。** `defineCachedEventHandler` 若直接包裹受保护的 Directory handler，会在缓存命中时跳过 handler 内的权限或 service-token 校验，存在数据泄露风险。
- **不得对 `/auth/me` 做跨请求缓存。** 该端点承担 session 有效性、撤销和 touch 语义；只允许在单个 `H3Event` 内合并重复调用。
- **Finance“无防抖、无分页”不成立。** 已确认的常规列表正确性问题集中在 Workflow 三个管理页；Finance 的特殊大页场景已经逐项收口。
- **`server/utils/db.ts` 不是 HTTP SQL 代理。** Aims、Altoc、Assets、Finance 中这些文件是直接抛错的防误用桩；真正需要度量的是 BFF 每次请求产生的 runtime/service API 调用数，以及 data-runtime 内部 SQL。
- **Codocs 的 Mermaid 不在全局 entry 中。** 动态导入仍可能改善编辑器和评审路由，但必须以路由级冷缓存传输量验收，不能预设 entry 减少 30%。
- **nginx 优化前的 30 天 `_nuxt` 缓存只覆盖 Finance 和 Altoc。** 现已扩展到 staging dev-stack 实际暴露的根 Console 与六个业务 base path；仍需部署后验证响应头和真实命中。

修订后的实施前优先级如下；当前完成状态以第 0 节为准：

| 优先级 | 问题 | 一句话方案 | 工作量 |
| --- | --- | --- | --- |
| P1 | Workflow 三个管理页固定拉 100 条、无翻页，超过上限静默截断 | 接入标准搜索与真分页，消费 runtime 已返回的 total | M |
| P1 | 已存在跨网络 N+1：Assets 按产品编码逐次调 runtime，Aims 按文档逐次调 Codocs | 优先补批量合同；无法批量时使用有界并发 | M |
| P1（需基线确认） | Codocs 编辑器 / 评审路由的 Mermaid 与大型共享 chunk 耦合 | 先做路由级 bundle 基线，再按需动态导入 | S–M |
| P2 | 同一服务端请求树可能重复执行 Console session bridge | 仅在 `event.context` 内 memoize Promise | S |
| P2（条件项） | Directory 展示型读可能存在高重复率 | 授权后缓存纯展示投影；先证明 QPS、延迟和复用率 | M |
| P2 | Finance 少数页面使用 500 / 1000 的大页参数 | 分场景核验是否截断、是否依赖全量汇总，再决定分页方式 | S–M |
| P2 | 各部署入口的静态缓存与压缩覆盖不一致 | 分 PM2/nginx、Caddy、Cloudflare 实测响应头 | S |

目前没有已证实的性能 P0。若生产 profiling 显示 Console/Directory 已成为全线 p95/p99 瓶颈，再将安全的纯数据缓存实现升级为 P0。

## 2. 已验证的健康面

| 项 | 证据与边界 |
| --- | --- |
| service token 缓存 + 30s 过期缓冲 | `foundation/server/utils/serviceOidc.ts:359-427` |
| JWKS 按 issuer + JWKS URL 缓存 resolver | `foundation/server/utils/consoleOidc.ts:719-741` |
| policy bundle / activation 已有缓存能力 | `foundation/server/utils/platformActivationCache.ts` 等；不代表所有运行模式均命中 |
| 通知铃铛 120s 轮询，页面隐藏时停止 | `foundation/app/components/NotificationBell.vue:5,19-55` |
| 心跳 120s + 空闲检测 | `foundation/app/composables/useHeartbeat.ts:55-95` |
| data-runtime 更新轮询 3s、最多 20 次，仅更新期间启用 | `console/app/pages/data-runtime.vue:280-289` |
| 在线用户 30s 轮询，仅 online tab 请求 | `console/app/pages/admin/logs.vue:698-715` |
| Finance 主列表使用 300ms 防抖 | `finance/app/pages/[...slug].vue:354-357` |
| Finance 常规列表有服务端分页、总数与 `UPagination` | `finance/app/pages/[...slug].vue:214-239,1351-1358` |
| aims 的 ECharts 已动态导入 | `aims/app/pages/weekly-reports.vue:131` |
| Caddy staging 已启用 zstd/gzip | `deploy/dev-stack/Caddyfile.staging:5` |
| nginx 对 dev-stack 暴露应用的 `_nuxt` 资源启用 30 天代理缓存 + cache lock | HTTP / HTTPS 配置同时覆盖根 Console 与 Aims、Altoc、Assets、Codocs、Finance、Workflow；People 未在该 staging Caddyfile 暴露 |
| Node 24 升级已完成 | `.nvmrc`、`.node-version` 与各模块 `engines` 均固定 `24.18.0` / `>=24.18.0 <25` |

> 前次口头评审曾把若干 `setInterval` 直接列为问题。复核后确认多数已有可见性、active tab、空闲状态或次数上限约束，不再仅凭存在定时器判定为性能缺陷。

## 3. 批次 0 — 先建立可比较的运行时基线

### 3.1 为什么必须先测量

“代码中没有缓存”不能证明存在性能瓶颈，也不能证明跨请求缓存有足够复用率。缓存可能降低上游 QPS，也可能引入授权绕过、过期数据、内存膨胀和多实例不一致。实施任何跨请求缓存前，至少需要回答：

1. 一个代表性页面从进入到表格可用，产生多少次 `/auth/me`、Directory、tenant-runtime 和跨应用请求？
2. 各调用的 p50 / p95 / p99、错误率和超时占比是多少？
3. 重复请求是否发生在同一个请求树、同一用户的短时间窗口，还是不同用户恰好请求同一路径？
4. 候选缓存 key 的基数、预期命中率、单项大小和进程内存上限是多少？

### 3.2 基线指标

- BFF API：请求量、p50 / p95 / p99、错误率、time-to-first-byte。
- SPA 页面：导航开始到列表数据可用的时间、请求瀑布、下载 JS 总量、主线程长任务；不能只看 HTML TTFB。
- Console：按端点拆分 `/api/v1/console/auth/me`、用户态 Directory、service Directory 的调用量和延迟。
- Runtime：每个 BFF request ID 对应的 tenant-runtime / service API 调用次数和累计耗时。
- 数据库：对真实慢查询做 `EXPLAIN ANALYZE`、索引命中和扫描行数分析；该工作必须在 `data-runtime` 侧进行。

建议沿现有 `x-request-id` / correlation ID 贯穿 BFF、Console 和 runtime，先用结构化日志完成低成本观测，再决定是否引入完整 tracing。

## 4. P1 — Workflow 管理页真分页改造

**实施状态：已完成。** 三个页面现统一使用 `useListPage({ pageSize: 20 })` 与 `useDebouncedSearch()`，请求携带页码、消费 total 并渲染 `UPagination`。

### 4.1 已确认现状

以下页面只在回车时执行搜索，不会逐字符发请求：

- `workflow/app/pages/admin/flows.vue:5-11`
- `workflow/app/pages/admin/actions.vue:5-11`
- `workflow/app/pages/admin/forms.vue:5-11`

但三者都固定请求 `page_size: 100`，没有页码和翻页控件，并且前端响应类型只消费 `items`：

- `flows.vue:320-326`
- `actions.vue:438-444`
- `forms.vue:347-357`

Workflow runtime 已返回 `items`、`total`、`page`、`page_size`，见 `data-runtime/internal/apps/workflow/runtime_admin.go:552-554`。因此数据超过 100 条后，UI 会静默隐藏后续数据，这是已确认的正确性问题。

### 4.2 方案

按 `docs/STANDARD_LIST_PAGE.md` 改造三页：

1. 使用 `useDebouncedSearch()`；输入绑定 `search`，请求绑定 `debounced`，回车调用 `flush`。
2. 使用 `useListPage()` 管理 `page`、`pageSize` 和筛选重置。
3. 请求携带 `page`、`pageSize`，响应消费 `total`。
4. 增加“共 N 条”与 `UPagination`，筛选变化回到第 1 页。
5. 保留现有 `UTable :loading` 和 `CommonEmptyState`。

`actions.vue` 中供选择器使用的 form / flow schema 当前分别拉 200 条。这不是主列表分页问题，但若实际规模可能超过 200，应改成可搜索远程选择器，不能继续提高固定上限。

### 4.3 验收

- 数据量 101 条时可以访问第 101 条，total 和页码正确。
- 输入连续字符时，每轮稳定输入只产生一次搜索请求；回车立即刷新。
- 搜索、状态等筛选变化后页码重置为 1。
- 1440px 与 390px 下分页、总数和表格不溢出。

## 5. P1 — 修复已存在的跨网络 N+1

**实施状态：已完成。** Assets 使用一次精确 `product_codes IN (...)` runtime 查询并按调用方编码顺序返回；Aims 因 Codocs 合同要求逐文档一次性命令与 ACL，未恢复不安全的通用批量正文接口，而是采用 4 worker 有界并发，并继续对 UUID 去重。

### 5.1 架构修正

`aims / altoc / assets / finance/server/utils/db.ts` 都是直接抛错的迁移期防误用桩，不会代理 SQL。业务 BFF 通过 Foundation tenant-runtime client 调用 runtime API，SQL 在 `data-runtime` 内执行。

因此需要分别治理两类问题：

- **BFF / 跨应用层：** 单次用户请求产生多少次 runtime 或 service API 网络调用。
- **data-runtime 层：** 单个 runtime API 内执行多少条 SQL、是否存在逐行查询、全表扫描或缺失索引。

### 5.2 已确认实例

#### Assets 产品批量解析

`assets/server/utils/serviceProducts.ts:84-94` 在传入多个产品编码时，对每个 code 串行调用一次 `/v1/assets/products`。调用数随 code 数量线性增长。

优先方案：给 runtime 列表合同增加批量 `product_codes` 查询，一次返回全部结果。若受兼容约束暂时无法增加合同，可使用小并发上限作为过渡，但仍应保留请求数量和超时保护。

#### Aims 来源章节读取

`aims/server/api/v1/work-items/[id]/source-sections.get.ts:94-122` 已按文档 UUID 做请求内去重，但仍会对每个不同文档串行执行 Codocs 权限校验和正文读取。不同文档数增加时，延迟线性上升。

优先方案：补 Codocs 批量授权/批量内容合同，或提供按 Aims 项目和 UUID 集合读取的最小 service API。批量合同必须保持逐文档授权结果，不能用一次项目级判断扩大文档 ACL。无法批量时，只能采用有界并发并保留失败隔离。

### 5.3 Review 纪律

- 记录“本接口最多产生几次 runtime / service API 调用”，不要写成“产生几条 SQL”。
- 优先补批量业务合同；不要把无界 `Promise.all` 当作通用修复。
- 涉及事务一致性的操作必须合并到同一个 runtime 命令，而不是在 BFF 并行拆分。
- 后台 drain 的分页和逐候选投递通常有顺序、幂等或失败隔离要求，应单独度量，不与页面 N+1 一概处理。

### 5.4 验收

- Assets 解析 N 个产品编码时，runtime 调用数从 N 次降为 1 次。
- Aims 读取 N 个不同来源文档时，不再产生 2N 次串行跨应用调用。
- 保留错 tenant、错项目、无文档访问权限和部分文档不存在的安全/错误语义。

## 6. P1（基线确认后实施）— Codocs 路由级 Bundle 优化

**实施状态：已完成。** 共享 loader 动态导入 Mermaid、复用单一加载 Promise，并通过串行 operation queue 避免编辑器与评审图的不同 `initialize` 配置互相污染。构建结果见“实施摘要”。真实浏览器路由 transferred JS 仍需有可登录环境后复测。

### 6.1 优化前已确认现状

Mermaid 有三处静态导入：

- `codocs/app/components/review/ReviewFlowChart.vue:8`
- `codocs/app/components/editor/editorMermaid.ts:2`
- `codocs/app/components/editor/MilkdownEditor.client.vue:15`

现有 2026-07-20 构建产物显示：

- 全局 entry `CG5ku9NO.js`：约 698 KB raw / 219 KB gzip。
- Milkdown/Mermaid 共享 chunk `BVbSlzYS.js`：约 2.14 MB raw / 620 KB gzip。
- `ReviewFlowChart` 所在 chunk 会导入上述大型共享 chunk。

这说明问题是**编辑器和评审路由的共享 chunk 耦合**，而不是 Mermaid 已进入全局 entry。Codocs 构建需要 4 GB 内存也不能单独证明浏览器首屏包体过大。

### 6.2 方案

1. 先运行 bundle analyze，并记录以下路由冷缓存下的实际传输量：
   - Codocs 首页。
   - 不含 Mermaid 的文档编辑页。
   - 含 Mermaid 的文档编辑页。
   - 评审详情页。
2. 若不含 Mermaid 的编辑页或评审页仍提前下载 Mermaid，再把三处加载收敛为共享的异步 loader：`const mermaid = (await import('mermaid')).default`。
3. loader 应复用同一个加载 Promise，避免并发重复初始化；同时验证编辑器与评审图表不同 `initialize` 配置不会互相污染。
4. 不以构建内存变化作为浏览器性能验收指标。

### 6.3 验收

- 首页不因本次调整增加 JS 请求或传输量。
- 不含 Mermaid 的文档页不下载 Mermaid 实现 chunk。
- 含 Mermaid 的文档和评审图表首次显示正常，主题切换、重复渲染和错误图表处理无回归。
- 比较路由级 transferred JS、解析/执行时间和 time-to-editor-ready；目标值在基线完成后设定，不预设 entry 减少 30%。

## 7. P2 — Console Session Bridge 仅做请求内合并

**实施状态：已完成。** 缓存值挂在当前 `event.context` 的私有 Symbol 上，保存的是同一个 Promise；没有进程级、Nitro storage 或 cookie-key 跨请求缓存。

### 7.1 现状

`foundation/server/utils/consoleSessionBridge.ts:129-160` 每次调用会向 Console `/api/v1/console/auth/me` 发请求。部分请求路径已经通过 middleware 写入 `event.context.consoleAuth`，但仍应观测是否存在同一 H3 请求树内的重复解析。

`/auth/me` 调用 `resolveOptionalConsoleSession()`，默认 `touch: true`；同时 `console/server/middleware/auth-cache-control.ts` 明确把 `/api/v1/console/auth/**` 标为 `no-store`。它承担 session 撤销、过期、用户状态和 last-seen 语义。

### 7.2 安全方案

- 只在单个 `H3Event` 的 `event.context` 中缓存正在执行的 Promise；同一请求树内后续调用 await 同一结果。
- 请求结束后自然释放，不进入进程级 LRU、Nitro storage 或边缘缓存。
- 不按 session cookie 哈希做 10–30 秒跨请求缓存。
- 保留 Console 不可用、401、撤销、过期和用户停用的现有失败语义。

### 7.3 验收

- 单个 BFF 请求内多次解析只产生一次 `/auth/me` 请求。
- 两个独立浏览器请求仍分别校验 session。
- 注销、管理员撤销、用户停用和 session 过期后，下一个请求立即失败。
- `lastSeenAt` / idle expiry 行为不因 memoize 改变。

## 8. P2（条件项）— Directory 只缓存授权后的展示投影

**实施状态：条件未满足，未实施。** 当前本地端口无代表性服务运行，无法取得 Directory QPS、p95/p99、候选 key 命中率与内存基数；在没有证据时引入跨请求缓存的安全与一致性风险高于已证明收益。

### 8.1 禁止的实现

不得直接把以下受保护 handler 改成 `defineCachedEventHandler`：

- 用户态 `/api/v1/directory/**`、`/api/v1/console/directory/**`：权限校验在 handler 内执行。
- `/api/v1/console/service/directory/**`：service-token capability、source app 和 tenant binding 在 handler 内执行。

`defineCachedEventHandler` 缓存命中时不会再次运行 handler；仅用 tenant + deployment + query 作为 key，无法保证匿名请求、不同用户、角色模拟或不同 service caller 的隔离。

### 8.2 可考虑的实现

只有在基线证明 Directory 是高占比瓶颈后，才考虑：

1. 每次请求先完成用户 session / service token、permission、simulation 和数据范围校验。
2. 在授权之后调用 `defineCachedFunction` 或受控 LRU，仅缓存纯展示投影。
3. 展示缓存和授权事实分离：姓名、头像可短缓存；active 状态、部门/项目成员关系、审批候选和数据范围不得直接依赖过期展示缓存。
4. key 至少包含 tenant、deployment、projection、完整规范化 query；若结果可能因 caller 或授权变化，必须包含 source app / authorization fingerprint，或明确证明结果与 caller 无关。
5. LRU 必须有容量上限、TTL、命中率和淘汰指标；目录写入、同步、离职和成员关系变更应有失效策略。

### 8.3 必需测试

- 已授权请求填充缓存后，匿名、无权限或缺 capability 请求仍返回 401/403。
- 跨 tenant、deployment、source app、普通模式与角色模拟互不命中。
- 用户离职、停用、部门/项目成员变更后，授权判断不会使用旧缓存。
- 列表与详情分别执行服务端范围校验。

## 9. P2 — Finance 大页场景专项核验

**实施状态：已完成专项收口。** 核验结果如下：

- 银行账户 runtime 原先忽略 page/pageSize 并返回全部明细，现使用 `LIMIT/OFFSET`；summary 仍基于完整筛选集合，主表按 20 条分页。
- 余额快照表原有 runtime 分页但 UI 固定取前 100 条，现按 20 条翻页；趋势图仍使用独立、按日期排序且上限 500 的图表序列。
- 余额变化是按日期窗口计算的聚合序列，pageSize 参数原本不参与 runtime 计算；UI 已停止发送无效的 1000。
- 项目核算不再固定取 Aims 前 500 条后做 Finance scope 过滤。Finance `projects` 范围以精确 `project_codes` 下推 Aims，再由 Aims 计算 total 和分页；当前页只解析当前页项目的财务摘要。
- 两处银行账户选择器不再请求 1000 条；改为每页 100 条、依据 total 有界逐页取全，避免 runtime 的 100 条上限造成静默截断。

优化前 Finance 常规列表已经有 300ms 防抖、20 条分页和总数，但以下特殊场景使用较大 page size：

- `finance/app/pages/[...slug].vue:230-237`：项目核算 500，银行账户 / 余额变动 1000。
- `finance/app/components/bank-accounts/BankAccountBalanceSlideover.vue:46-98`：100。
- `finance/app/components/invoices/InvoiceLifecycleDialogs.vue:82`：1000。

这些不能直接统一分页：余额图表、摘要或客户端计算可能依赖完整集合。应逐页确认：

1. 上限是否会造成静默截断。
2. 页面需要明细分页、服务端摘要，还是一个轻量全量字典。
3. 任何 `reduce()` / 图表统计是否只基于当前页。
4. Runtime 是否已提供 total、summary 或游标能力。

确认后再选择“服务端 summary + 明细分页”“远程搜索选择器”或“有明确上限的全量读取”，避免为遵守形式分页而破坏金额和图表正确性。

## 10. P2 — 接入层缓存与压缩按部署实测

**实施状态：配置已收口，部署验证待执行。** staging Caddyfile 实际暴露根 Console 与六个业务 base path；HTTP 和 HTTPS nginx 配置均已只针对这些路径的 `/_nuxt/` 构建资源扩展 30 天缓存，没有扩大到 HTML 或 API。当前工作区没有运行中的 staging 入口，故不能把静态配置视为 `HIT`、压缩或 Cloudflare 生效证据。

### 10.1 已确认配置

- Caddy staging：`encode zstd gzip`。
- nginx staging：根 `/_nuxt/` 及 `/(aims|altoc|assets|codocs|finance|workflow)/_nuxt/` 使用 30 天 `proxy_cache`；其他路径走既有规则。
- Cloudflare 支持对符合条件的文本响应[压缩](https://developers.cloudflare.com/speed/optimization/content/compression/)和[静态资源缓存](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)，但结果仍受 Accept-Encoding、套餐/规则、响应状态、扩展名和源站 Cache-Control 影响，不能只依据“经过 Cloudflare”判定已生效。

### 10.2 验证方式

对每个实际部署入口选取首页 entry 和一个路由 chunk，执行：

```bash
curl -sS --compressed -D - -o /dev/null 'https://<业务域名>/<base>/_nuxt/<chunk>.js'
```

检查：

- `Content-Encoding`
- `Cache-Control`
- `Vary`
- `Age`
- `CF-Cache-Status`（Cloudflare）
- `X-HZY-Proxy-Cache`（当前 nginx 规则）

若 nginx 是实际静态资源入口且其他应用确实缺少缓存，再扩展 `_nuxt` location；扩展前必须确认资源文件名带内容 hash、不会缓存 HTML/API、base path 匹配完整，并执行 `nginx -t` 与真实请求验证。若上游 Caddy 已压缩，不必为了形式在 nginx 重复压缩。

## 11. 实施路线图

| 批次 | 内容 | 进入条件 | 交付结果 |
| --- | --- | --- | --- |
| 批次 0 | 代表性页面基线、调用计数、p50/p95/p99、路由级 bundle 基线 | 部分完成 | 完成静态、测试与 Codocs 构建基线；运行服务不可用，生产 p95/p99 待补 |
| 第一批 | Workflow 真分页；Assets/Aims 已确认跨网络 N+1 | 已完成 | 修复静默截断，降低线性网络调用 |
| 第二批 | Codocs Mermaid 异步拆分 | 已完成 | Mermaid core 从编辑器共享 chunk 拆为按需 chunk |
| 第三批 | Session bridge 请求内 memoize | 已完成 | 不改变 session 语义地消除同请求重复请求 |
| 第四批 | Directory 展示投影缓存 | 未进入 | 缺少瓶颈与复用率证据，保持逐请求授权 |
| 第五批 | Finance 大页与接入层按部署收口 | 代码完成、部署验证待执行 | 无静默截断；staging 缓存覆盖范围清晰 |

Node 24 已完成，不再列入本报告实施项。若后续做统一 CI，可把 bundle analyze 产物和关键路由预算纳入 CI，但应设置可解释的路由级预算，避免只盯全局 entry。

## 12. 度量与回归验证

优化前后使用相同数据规模、相同账号授权、冷/热缓存条件分别对比：

- Workflow：101+ 数据集下的可达性、请求次数、total、页码和响应时间。
- Assets/Aims：单请求的 runtime/service API 调用数、累计网络耗时和失败语义。
- Codocs：各目标路由 transferred JS、请求数、解析/执行时间、time-to-editor-ready。
- Console bridge：每个 BFF 请求对应的 `/auth/me` 次数，以及撤销/停用即时生效。
- Directory 条件缓存：授权校验次数、上游调用量、命中率、p95/p99、key 基数和内存占用。
- 接入层：压缩、缓存响应头，以及第二次请求是否真实命中边缘/代理缓存。

任何缓存优化都必须把安全回归与性能结果同时作为验收条件；仅看到 QPS 下降不足以判定成功。

## 附录：覆盖与局限

- 已覆盖：九个模块的前端列表与轮询模式、Foundation session/directory adapter、Console Directory 用户态与 service 路由、关键 BFF runtime 调用点、Workflow runtime 分页合同、Codocs 现有 Nuxt 构建产物、staging nginx/Caddy 配置。
- 未全面覆盖：`data-runtime` 各应用全部 SQL 与索引、生产数据库执行计划、生产 Cloudflare zone/rules、真实租户数据分布和峰值并发。
- Codocs chunk 文件名来自 2026-07-20 的现有构建产物，后续构建 hash 会变化；应以模块归属和路由传输量为准。
- 本报告不再用“未发现缓存”“依赖体积大”或“存在循环”单独推导性能优先级；需要结合调用边界、数据规模和运行时证据。
