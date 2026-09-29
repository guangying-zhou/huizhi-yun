# 统一企业应用性能与界面基线

采样日期：2026-09-13。对应 INT-006；本文件是初步证据，不是性能验收结论。

## 旧路径浏览器样本

环境：Chrome 当前已登录测试租户，`hzy-test.huizhi.yun` 的 Aims 产品需求页面；Console Shell 与 Aims iframe 分别加载。正常刷新，未清缓存、未禁用缓存，不作为冷启动样本。下表来自浏览器 Navigation/Resource Timing；不采集 Cookie、Token 或业务内容。

| 指标 | 样本 1 | 样本 2 |
| --- | ---: | ---: |
| Shell navigation duration（ms） | 3066 | 3464 |
| Shell resource 条数 | 46 | 47 |
| Shell transferSize 汇总（bytes） | 364369 | 364972 |
| iframe navigation duration（ms） | 253 | 211 |
| iframe resource 条数 | 110 | 111 |
| iframe transferSize 汇总（bytes） | 567960 | 568397 |
| Shell auth/me（ms） | 230 | 161 |
| iframe auth/me（ms） | 460 | 710 |
| iframe 首次 auth/permissions（ms） | 1271 | 4260 |
| requests 列表（ms） | 6978 | 2119 |
| requests/permissions（ms） | 1645 | 1506 |
| planning-items/permissions（ms） | 2709 | 2705 |
| planning-items/permissions responseEnd（ms） | 13774 | 11924 |
| iframe 第二次 auth/permissions（ms） | 861 | 736 |

`responseEnd` 相对该 frame 的 navigation origin。导航事件完成不等于业务可操作；重复会话/权限加载及业务接口延迟是后续比较对象。两个样本不足以形成有代表性的 P50/P95，不以最大值代替正式 P95。

## 本机构建基线

Aims `pnpm --dir aims typecheck` 通过，`/usr/bin/time -l` 输出 wall 22.44s、user 31.54s、sys 2.31s、maximum resident set size 2407038976 bytes。原日志：`/tmp/hzy-adr018-baseline-20260913/aims-typecheck.log`（临时本地证据）。这是本机构建进程指标，不是 Cloudflare Worker 内存或 CPU。

Worker 上传、版本与 dry-run 证据见[构建基线](./Unified-Enterprise-Build-Baseline.md)。正式比较仍需同提交构件、同数据/账号、足够样本，以及实际 Worker startup/CPU/内存与 Runtime SQL 计数。

## Host 初步浏览器验证

本地 `http://localhost:3010/login`，真实浏览器分别在 1440×900、390×844 下验证：登录标题、未配置提示、禁用的企业登录按钮均可见，无水平截断；验收后恢复默认视口。旧 `/aims/login?returnTo=/aims/products` 使用统一登录组件并保留内部 returnTo。

这仅证明未配置登录状态的布局与旧入口兼容；未注册正式 OIDC，不能据此宣称登录后产品流程、跨租户切换或完整 INT-306 已完成。

## 2026-09-13 测试站会话复核

在用户已有 Chrome 测试站产品需求标签页执行正常刷新，Console Shell 与旧 Aims iframe 最终完整加载，需求列表显示 10 条记录；本次未重新输入凭据。顶层页面 HEAD 返回 200，测试环境标识为 C000001。

本次仅复核当前会话与旧入口可用性，未采集 Navigation Timing、未更改业务数据，不新增性能样本。页面仍采用独立 Aims iframe，不作为统一 Enterprise Host 的 OIDC、导航性能或业务端到端验收证据。

## 可复用的测量汇总

`node enterprise/scripts/summarize-performance.mjs <samples.json>` 只读取测量文件，不连接服务、登录或执行业务操作。输入为对象数组，每项固定字段：

```json
{"variant":"enterprise","scenario":"product-list","cache":"warm","metric":"ready","unit":"ms","environment":"test","role":"product-manager","datasetRevision":"data-v1","artifact":"sha256:release-digest","value":1200}
```

上述数值仅演示格式，不是实际观测。variant 为 legacy/enterprise，cache 为 cold/warm，unit 为 ms/bytes/count；其余标签使用不含个人信息的稳定标识。禁止输入 Header、Cookie、Token、请求体或业务内容。

工具按全部标签分组，不把不同构件、权限角色、数据版本或冷热缓存的数值混成一个总体。使用 nearest-rank 分位数；每组至少 20 项才输出 P50/P95，较少样本只报告数量和范围。20 项是本工具的最低汇总门槛，不证明样本有代表性；正式验收仍需固定采样条件、足够重复及明确目标阈值。工具不自动判定发布就绪。三项行为测试覆盖分位数、分组隔离和非法输入，通过；当前未补充真实浏览器或 Worker 性能数据。

## 可执行浏览器采集器

`enterprise/scripts/collect-browser-performance.mjs` 输出可在当前 Chrome 页面执行的自包含表达式。它只读 Navigation/Resource Timing 及可访问的同源 frame，不读 Cookie、Storage、Header、DOM 业务内容，不发请求。URL 仅在内存中映射到固定接口类别，输出不含 URL、查询参数或产品编码。

```sh
node enterprise/scripts/collect-browser-performance.mjs --browser-script '{"variant":"legacy","scenario":"product-list-navigation","cache":"warm","environment":"test","role":"current-session-unverified-role","datasetRevision":"unverified-live-data","artifact":"aims:8d573b11-b6cf-4052-a4a0-d0d6bf7b5a41"}' > /tmp/hzy-performance-expression.js
node enterprise/scripts/collect-browser-performance.mjs captures.json
```

第一条仅生成脚本；正常刷新目标页，按固定“列表加载完成”标准执行表达式一次，将每次返回值保存进 JSON 数组 `captures.json`。第二条复用现有 `summarizePerformance`，不连接浏览器或服务。示例未核实的角色/数据标签明确保留 unverified，不能据此做同账号同数据的旧/统一配对结论。配对前应核实同一当前账号的权限角色、数据快照及各链路构件；artifact 示例只标识已查明的旧 Aims Worker，不代表 Console/Gateway/Runtime 同一构件。

每次输出浏览器资源请求条数、fetch/XHR 条数、接口类别耗时、transfer/encoded/decoded 字节数、观察到的 HTTP 错误、状态未知、跨源 frame 不可读及 buffer 可能截断数量。请求数是浏览器 Timing 条目（包含缓存，主导航另计），不是 BFF→Runtime 或 SQL 次数；字节零值可能代表缓存或 Timing 不可用。API 耗时按成功/HTTP 错误/状态未知分组，不混算；每个 API 耗时样本是一次请求，每个导航/汇总指标是一轮捕获，不能把同一轮重复保存当独立样本。少于 20 个同组样本仍不输出 P50/P95。Cold/warm 是操作者声明的浏览器缓存条件；不证明 Worker 冷启动。导航失败、SQL 和 Worker 指标没有真实来源，明确 null。

采集脱敏/不读取 DOM、真实本地 HTTP PerformanceResourceTiming 与现有汇总行为测试共 5 项通过。HTTP fixture 通过 Node WHATWG Timing 实测 200 与 503、字节数，再送入原汇总器（1 个样本仍无 P50/P95）；这是采集链验证，不冒充租户浏览器性能。专用空 profile Chrome 的真实 headless fixture 在本机因 `CVDisplayLinkCreateWithCGDisplay -6670` 超时，未取得样本，已停止；该检查现以 `HZY_PERFORMANCE_HEADLESS_TEST=1` 显式启用，默认跳过，不以跳过当通过。后续主代理已在正常 Chrome 会话取得下节实际样本；headless fixture 的失败不作为浏览器采集失败证据。


## 2026-09-13 当前 Chrome 实际单次采集

原始去敏数据：[C000001.legacy-browser-performance.json](../deploy/test-env/artifacts/C000001.legacy-browser-performance.json)。主代理在旧 Aims 产品列表显示 6 行后，从当前 Chrome Root 与同源 iframe 取得 **1 次 capture**，未读取或导出会话凭据、业务内容。采集文件已实际通过采集器汇总入口（exit 0）；汇总保存于 `/tmp/hzy-legacy-browser-performance-summary.json`。

| 指标 | 本次观察 |
| --- | ---: |
| Root / iframe 资源条目 | 47 / 97 |
| 合计资源条目 / fetch-XHR | 144 / 24 |
| transferSize / encodedBodySize / decodedBodySize（bytes） | 862008 / 819408 / 2536554 |
| 产品接口成功请求耗时（ms，两次请求） | 1808.9 / 1398.8 |
| 观察到的 HTTP 错误 / 状态未知 | 0 / 0 |
| 不可用或零 body size 条目 | 2 |
| 不可读 frame / 可能截断 frame | 0 / 0 |
| Root / iframe 采集时距导航起点（ms） | 66209 / 58030.5 |

采集窗口包含约 66 秒页面停留及背景请求；上述 66209/58030.5 **不是列表 ready 耗时**，144/24 也不是完成首屏所需请求数。两次产品请求来自同一 capture，不是两次独立页面采样；本次各分组不足最低样本门槛，不输出 P50/P95。

cache 标签为操作者声明的 `warm`，不证明 Worker 冷热状态。角色仍为 `current-session-unverified-role`，数据版本仍为 `unverified-live-data`。artifact 仅指已核实的旧 Aims Worker `8d573b11-b6cf-4052-a4a0-d0d6bf7b5a41`，不代表 Console/Gateway/Runtime 整条链同一构件。SQL/Worker 指标仍为 null。此样本证明真实 Chrome 采集→现有汇总可执行，尚不足以建立同账号同数据的旧/统一性能比较或性能提升结论。

## 2026-09-14 可核验的制品与配置量

| 指标 | 观测值 | 适用边界 |
| --- | ---: | --- |
| 完整 Enterprise Host `.output` | 374文件 / 8644 KiB | 已构建、typecheck及dry-run通过，尚未部署；不是压缩上传量或Worker内存 |
| Host业务route制品 | Aims 149 / Assets 37 | 构建输出数量，不是已验收业务动作数 |
| Console首次发布候选变量数 | 91 | 被平台限制拒绝的候选，不是旧线上变量数量 |
| Console清理后实际发布变量数 | 57（48普通+9秘密） | 移除34个无当前读取方的旧别名；保留秘密绑定 |
| 完整影子迁移业务表/行 | 150 / 478 | 独立演练目标，未切换业务路径 |

来源：[Host候选](../deploy/test-env/artifacts/C000001.enterprise-host-full-candidate-20260914.json)、[Console实际发布](../deploy/test-env/artifacts/C000001.console-entitlement-release-20260914.json)、[150表复制演练](../deploy/test-env/artifacts/C000001.enterprise-rehearsal-150-copy-20260914b.json)。配置清理降低了本次候选的发布负担，但不能据此宣称应用整合已减少线上Worker数量、SQL次数或页面P95。后者仍需同角色/数据/制品的实际切换前后测量。

## 固定验收样本（2026-09-15）

样本只使用非个人稳定标签；执行时把真实用户映射保存在受保护的测试运行记录中，性能 JSON 不保存 uid、Cookie、Token、URL 查询参数或业务字段。

| 样本 | 租户/数据 | 权限主体 | 必测场景 | 比较方式 |
| --- | --- | --- | --- | --- |
| `tenant-a-manager` | C000001 测试快照 `catalog-150-r1`：150 表/478 行、53 产品、8 产品线分类、3 产品空间、10 需求、4 版本 | 可查看并规划全部试点产品的产品经理 | 冷首次进入产品列表；暖刷新；产品详情；Aims→Assets 跨模块导航；需求和版本列表 | 同一测试账号、同一数据 revision、同一浏览器/profile，依次采 legacy 与 enterprise；每轮顺序交替 |
| `tenant-a-restricted` | 与上一样 | 只允许一个项目/产品范围、无导出和管理权限的受限成员 | 同场景并验证不可见对象、total 和字段不泄漏 | 旧新路径使用同一 subject scope；越权响应不计入成功耗时，单列错误率 |
| `tenant-b-manager` | 隔离测试租户 `perf-tenant-b`，从固定无敏感 fixture 建立与 tenant-a 相同表结构和同数量级数据 | 租户 B 产品经理 | 产品列表/详情/跨模块导航，穿插 tenant-a 请求 | 每轮 A/B 交替并发，核对缓存、连接、actor、数据和统计不串租户 |
| `tenant-b-viewer` | 同 `perf-tenant-b` revision | 只读查看者，无规划写权限 | 列表、详情、拒绝的写入口 | 同一权限主体比较读取；写拒绝仅作隔离正确性门禁 |

`perf-tenant-b` 必须由隔离 fixture 创建，不复制 C000001 业务字段；两租户数据量允许在 ±10% 内，核心产品/空间/需求/版本数量完全一致。若无法建立该样本，INT-006 保持未完成。

## 采样方法与统计口径

1. 固定 Enterprise、旧 Aims/Assets、Gateway、Console、Runtime 的 commit/version、策略 revision、数据库 generation 和 dataset revision；任一值变化即开启新批次，不混算。
2. 每个“租户 × 角色 × variant × 场景 × cache”至少 30 次独立导航。cold 使用新的临时 browser context；warm 在同一 context 完成一次预热后采样。legacy/enterprise 按 ABBA 顺序交替，避免时间漂移。
3. 浏览器以“主要列表/详情数据已返回且 loading 结束”为 ready；同时记录 navigation、API 分组耗时、资源/fetch-XHR 数和传输字节。使用已有 `collect-browser-performance.mjs` 和 `summarize-performance.mjs`，按完整标签以 nearest-rank 计算 P50/P95。
4. 每次浏览器轮次使用同一个 trace id 关联 Gateway、Host、Runtime。服务端记录调用层数、BFF→Runtime 调用次数、SQL statement 数、SQL 总时长/最大时长、Worker CPU time 和 wall time；只保存聚合数字和错误码，不保存 SQL 参数或业务内容。
5. 启动测量在固定构件的新 isolate 上至少 30 次，分别记录 startup 和首请求 CPU/wall。并发内存按 1、5、10 个并发请求各运行 5 轮，记录平台可观测峰值；缺平台数据时明确 null，不以本机 RSS 代替。
6. 构建/typecheck 从干净依赖缓存状态和暖依赖缓存状态各执行 3 次，记录 wall、user/sys、峰值 RSS、成功构件文件/字节和 Wrangler dry-run upload/gzip；失败样本单列，不能进入成功分位数。
7. SQL 慢查询阈值固定为单条 500 ms；记录每场景大于阈值数量和最慢语句 hash。不得开启会记录明文参数的通用查询日志。

## 预先冻结的通过阈值

| 维度 | 阈值 |
| --- | --- |
| Worker 上传 | Wrangler uncompressed upload ≤ 51.2 MiB（64 MiB 上限保留 20%）；gzip 同时记录，不替代未压缩门禁 |
| 构建/typecheck | 全部成功；Enterprise 干净构建 P95 ≤ 120 s，typecheck P95 ≤ 60 s，构建峰值 RSS ≤ 3 GiB |
| Worker CPU/内存 | Free 测试档每请求 CPU P95 ≤ 8 ms，且无 CPU exceeded；并发峰值内存 ≤ 实际账户限制的 80%，限制值须随回执记录 |
| 启动 | startup P95 ≤ 100 ms，且不高于对应旧路径 P95 的 110% |
| 页面首次进入 | cold ready P95 ≤ 8 s；warm ready P95 ≤ 5 s；两者均不高于同条件 legacy 的 110% |
| 跨模块导航 | warm ready P95 ≤ 2.5 s，且不高于 legacy 的 90% |
| API/调用次数 | 成功 API P95 ≤ legacy 的 110%；浏览器 fetch/XHR、BFF→Runtime 调用数均不得高于 legacy，重复 auth/permission 调用至少减少 1 次 |
| SQL | 每场景 SQL statement P95 不高于 legacy；列表行量翻倍时 statement 数不得增长；单条 >500 ms 为 0，SQL 总时长 P95 ≤ legacy 的 110% |
| 正确性 | 两租户/四主体零串租户、零范围泄漏；成功率 ≥99.5%，401/403/5xx 分开统计；受限主体拒绝行为必须 100% 符合预期 |
| 配置与同步 | Host 组合后的共享配置有唯一 owner；迁移完成的同一业务同步链只允许 1 个 scheduled owner，不以源码声明数相加冒充运行数 |

绝对阈值与相对阈值同时适用，任一失败即不通过。阈值在正式采样前冻结；如因产品目标调整，必须记录变更原因和新批次，不能用采样结果反向放宽。

## 负责人和排期

| 日期 | 负责人 | 工作与交付 |
| --- | --- | --- |
| 2026-09-16 | Runtime/数据负责人 | 建立 `perf-tenant-b` 固定 fixture；接 trace 聚合的 SQL 次数/时长/慢查询，证明不记录参数 |
| 2026-09-16 | Host/构建负责人 | 修复 Assets Layer 共享模块解析；固定 commit 后采集 Enterprise/Aims/Assets 构建、typecheck、upload、startup |
| 2026-09-17 | 认证/授权负责人 | 核验四个测试主体的授权快照、有效期和预期可见范围，产出非个人样本映射 hash |
| 2026-09-17～18 | 性能验收负责人 | 按 ABBA 顺序完成浏览器 cold/warm、跨模块、CPU/内存及调用次数采样并生成 P50/P95 |
| 2026-09-19 | 整合负责人 | 对照冻结阈值出具 INT-006 结论，并把失败项分派到 INT-307/502；证据不足时保持未勾选 |

## 当前完成判断

构建/上传历史值、当前配置与源码任务数量、固定两租户/四权限主体、P50/P95 方法、阈值、负责人和日期已经具备。固定提交 `bc34d112571af3acdb218464d97558ac0e868df4` 的初始三轮暖依赖构建中，RSS P95 为 3,503,898,624 bytes且两轮超门禁。提交 `d658d022` 关闭 Host sourcemap 后，分段三轮确认峰值来自 Nuxt build；Nuxt RSS 为 2,518,499,328 / 3,104,636,928 / 2,005,467,136 bytes，P95 3,104,636,928，三轮均低于 3 GiB。Wrangler RSS 最高 321,617,920 bytes；上传三轮均为 6069.00 KiB，且同源码恢复 sourcemap 的 A/B 对照也是 6069.00 KiB，未增加上传。当前仍缺冷依赖三轮、两租户同条件旧新 30 次配对样本、实际 CPU/并发内存/startup、Runtime SQL 次数与慢查询数据。因此 INT-006 仍为部分完成，详细构件、SHA 和不可逐字节重复原因见[构建基线](./Unified-Enterprise-Build-Baseline.md)。
