# G1 收口跟踪（2026-09-23）

> 本表的状态、并行边界和回执是 **G1 期间的历史记录**，不代表 2026-09-25 的运行制品或当前任务授权。当前组合见[单一状态摘要](../../Current-Running-Combination-20260925.md)；G1 放行结论本身仍按下述原验收记录保留。

**状态：G1 已放行（2026-09-23 用户批准）**，放行判断见验收记录第 6 节。

G1 定义（实施方案 §验收）：LE-A01～16 中适用项，以及 LE-A20/24/25 的基本链通过。本表是收口工作索引，证据仍写入[验收记录](./Local-Enterprise-Test-Acceptance-Record.md)第 3 节对应行；本表只记录状态、负责人和缺口。

分工（2026-09-23 起）：Claude 负责总体安排与授权/策略/跨模块关键项；Codex 负责并行的普通任务；MiMo 负责提交；ChatGPT-6-Pro（网页）负责评审。需要用户操作的浏览器项集中安排一次联合会话。

## 状态

| 项 | 当前状态 | 已有证据 | G1 缺口 | 负责 |
| --- | --- | --- | --- | --- |
| LE-A01 | 通过 | Codex C1 | — | — |
| LE-A02 | 通过 | Codex C1 | — | — |
| LE-A03 | 通过 | Codex C1 | — | — |
| LE-A04 | 通过 | 匿名链全套伪造头矩阵；09-23 登录会话 6 个读取带/不带伪造头状态码与正文摘要一致 | 跨租户正向会话（单租户，不适用） | — |
| LE-A05 | 通过 | Codex C2（Claude 复跑） | — | — |
| LE-A06 | 通过（匿名链） | Codex C2 | — | — |
| LE-A07 | 通过（服务端链） | 09-23 回调负向 400、登出清 22 个 Cookie、外站 redirect 归一 | 多标签退出（归 A10） | — |
| LE-A08 | 通过 | 09-23 issuer/JWKS 一致；浏览器经 SSO 静默登录云端，权限接口返回修订 14 | — | — |
| LE-A09 | 通过 | 09-23 角色矩阵（修订 17～20）：只读/员工/项目经理菜单与服务端 403 一致；Host `projects:view` 门槛与 `checkPermission` 503 语义有测试 | — | — |
| LE-A10 | 通过 | 宽限/拒绝/R1/停用；双标签退出；登录中撤权服务端立即拒绝；策略变更后前端自动续期令牌（修订 22 实测） | — | — |
| LE-A11 | 通过 | Codex C2；探测期望随 C5 改为 307 | 观察：写方法 OPTIONS 503 | — |
| LE-A12 | 通过 | 09-23 `/shell/{app}` 旧书签矩阵：登记页跳转、保留 query/hash、剥离嵌入参数、恶意与未登记目标拒绝 | 308 应对齐云端 307（C5） | Codex C5 |
| LE-A13 | 通过 | 09-23 筛选/分组返回恢复 | 观察：滚动位置不恢复 | — |
| LE-A14 | 通过 | 09-23 跨后台刷新输入与结果保持 | — | — |
| LE-A15 | 通过 | 09-23 390 抽屉、Esc、导航关闭 | 观察：窄屏标题换行 | — |
| LE-A16 | 通过 | 09-23 领域组件与 Foundation 样式 HMR，均已还原 | — | — |
| LE-A20 | 基本链通过 | 已写入验收记录 | — | — |
| LE-A24 | 基本链通过 | 09-23 云端仅每日 16:00 旧表同步，hzy0 为 verified 唯一写者，本机后台任务关闭 | — | — |
| LE-A25 | 基本链通过 | 云端登录、导航正常；test 云端 403 为 09-16 已存在的云端缺陷，hzy0 结果符合策略修订 14 | 云端 403 另行排查 | Claude |

另需（C4，Codex）：开发 Platform 策略接口慢的根因是库在远端 `oa.wiztek.cn`；2026-09-23 已迁到服务器本机容器，修订查询 28 ms、hzy0 同步约 2 秒，角色矩阵解除阻塞。C4 代码（查询只取所需列 + 进程内缓存）已复核通过，待决定是否发布。

另需：页面导航遇到上游失败时，hzy0 入口脱敏层（`gateway-transport.mjs` → `error-contract.mjs` 的 `safeError`）把所有错误都输出为 JSON，用户看到原始 `hzy0_upstream_error`。应对文档导航返回最小安全 HTML 错误页（可重试、不泄露诊断），API 请求保持 JSON（关联 LE-A10/A11）——Codex C3。

## 浏览器联合会话方案（LE-A09/A10/A12～A16，A08/A25 云端登录）

账号：hzy0 仅支持 `wiztek` 企业 SSO（生产 LDAP 联邦），不能在测试库新建可登录用户。改为用户在浏览器登录现有 `test` 账号（管理员 zhouguangying 另开窗口作对照），Claude 用 `deploy/test-env/platform-test-role-matrix.mjs` 在开发 Platform 测试数据中切换 `test` 的角色组合（只读 `console.viewer`／员工 `aims.member`／项目经理 `aims.member + project_manager`／无），每次切换重新生成策略修订，hzy0 约 1 分钟内生效；结束执行 `restore` 回到首次改动前的快照（`test` 原有四个角色）。

顺序：①基线（原四角色）菜单与载荷；②只读；③员工；④项目经理；⑤会话保持中切到“无”，验证撤权后菜单/数据失效且迟到响应不恢复旧状态；⑥两个标签页一处退出；⑦ A12～A16 导航、返回、筛选、窄屏（1440/390）、HMR 各一；⑧云端 `hzy-test.huizhi.yun` 登录并打开项目页；⑨ `restore`。预计 60～75 分钟。

## 并行边界

- Codex 可改：`deploy/test-env/local-enterprise.mjs`、`deploy/test-env/local-enterprise/{config,process-ownership,run-process,smoke,probe-*}.mjs` 及其测试、新增探测脚本；C3 时 `deploy/test-env/local-enterprise/{gateway-transport,error-contract}.mjs` 及其测试。
- Codex 不改：`policy-sync.mjs`、`console-facade.mjs`、`console-egress.mjs`、`gateway.mjs`、Foundation/Console/Platform/data-runtime 的授权与策略代码、任何 grant/密钥/迁移。
- 环境动作：Codex 可重启 hzy0 本栈进程并做匿名/只读公网探测；不得改 Runtime LaunchAgent、Caddy/Tunnel、云端 Workers、开发 Platform，不得写业务数据。
- 验收记录第 3 节表格只由 Claude 合并更新；Codex 把证据写在各自任务回执里（本文件末尾“回执”节）。

## 回执

（各任务完成后追加：任务号、提交内容、证据、未完成项。）

### Codex C1（2026-09-23）

- 改动文件：`deploy/test-env/local-enterprise.mjs`、`deploy/test-env/local-enterprise/test/cli-isolation.test.mjs`。`restart` 不带 `--app` 时仅重启本 profile 拥有的四个 hzy0 进程；指定 `--app` 的行为保留。
- LE-A01：对真实 profile 的五种临时副本（未知字段、空服务身份、`environment=prod`、冲突端口、非默认 `gatewayInternal` 端口）实跑 `up`，均在 PM2 前以退出码 1 拒绝，临时副本已清理。自动化测试对每种变体执行 `plan/doctor/up/restart/down/status`：`plan` 只列 blocker，其他命令拒绝；假 PM2 调用标记不存在。未触及真实 profile 或启动外部进程。
- LE-A02：`cli-isolation.test.mjs` 在临时目录构造合成旧 `.env.dev` 与 shell 中的 `DB_*`、主密钥名、四种 bypass=true；假 `pnpm` 作为实际 runner 子进程只回报键名/布尔检查。结果：`--dotenv /dev/null`、无 `DB_*`、无主密钥键、四种 bypass 均为 `false`；无凭据值输出或落盘。
- LE-A03：实跑本机 `down → up → restart` 全栈。down 后 hzy0 PM2 进程数 0；up 与 restart 后四个进程均 `online`。Runtime LaunchAgent PID `60799`、Caddy PID `46631`、其他 PM2 进程清单 `[]` 前后不变；本地/公网 `/runtime/health` 均 200，版本保持 `0.3.219-test.console-steady-identity.1`；Gateway 策略同步恢复并最后报告 `ready: true`。随后加载最终 Gateway 改动的定向 restart 亦成功，四进程在线。
- 命令与结果：`node --test deploy/test-env/local-enterprise/test/*.test.mjs`：83/83 通过；`node deploy/test-env/local-enterprise.mjs status --profile … --mode dev`：四进程 online；CLI 全栈 `down/up/restart` 各退出 0。未完成项：无（本项限于 CLI/进程及环境隔离证据）。

### Codex C2（2026-09-23）

- 改动文件：`deploy/test-env/local-enterprise/probe-exposure.mjs`、`deploy/test-env/local-enterprise/test/probe-exposure.test.mjs`；内部路径 404 与兼容重定向方法收紧在 C3 的 `gateway-transport.mjs`。探测脚本默认只发送匿名 GET/HEAD/OPTIONS 和 WS GET 握手，不跟随跳转、不输出响应正文/凭据；方法注册与生成清单有漂移断言。
- LE-A05/A06：`node deploy/test-env/local-enterprise/probe-exposure.mjs --summary` 退出 0、告警 0。Console 23100、Gateway 私有出口 23121、Enterprise 23110、Codocs 编辑器 23130、Runtime 18084：公网与本机非回环地址各 5/5 不可连，回环各 5/5 可连（设计如此）。六条 internal/drain/devtools 公网路径均为 Cloudflare Access 登录重定向 302，回环 Gateway 均为 404。三条静态资源公网均为 Access 302，HMR WS 公网为 Access 302；回环静态资源可达，独立匿名登录边界 `/enterprise/api/navigation` 与 `/console/oauth/userinfo` 均为 401 JSON。公网 Access 结果不替代应用登录判断。
- LE-A11：从 Host 页面注册表枚举 68 页，从 `business-api-surface.mjs` 枚举 270 个 API（其中 130 GET），与生成方法/路径清单一致；338 条安全 HTTP 路由探测中页面 HEAD 为 68×200，API 为 45×400、85×401、1×404、139×503，未出现 API 200 HTML。未注册路径为 404；旧 Shell 兼容路径 GET/HEAD 为 308、OPTIONS 为 405。
- 未完成项：按禁写要求，140 个已注册写方法只核对静态 method/path 并发送安全 OPTIONS，未发真实写方法；其中 139 条 OPTIONS 返回 503，原因未在本次只读探测中确认，不能据此宣称写方法的实时路由验收。匿名公网只能观测 Access 层，未以登录会话验证静态资源或 WS；这属于后续联合会话范围。

### Codex C3（2026-09-23）

- 改动文件：`deploy/test-env/local-enterprise/error-contract.mjs`、`deploy/test-env/local-enterprise/gateway-transport.mjs`、对应 `test/error-contract.test.mjs` 与 `test/gateway-transport.test.mjs`。文档导航失败按 401/403/409/503/其他显示固定中文静态 HTML；重试、首页、合法 correlationId、暗色样式均无外部资源。API/资源仍按原安全 JSON 合同；状态码、`Retry-After`、合规清 Cookie、`no-store` 保留。内部路径及编码形式统一 404；兼容重定向仅 GET/HEAD。
- 命令与结果：`node --test deploy/test-env/local-enterprise/test/*.test.mjs`：83/83 通过，覆盖导航 HTML、API JSON、未知码、诊断隔离、HEAD 空正文、暗色样式和编辑器失败状态。使用受控回环测试服务器执行 `curl -H 'Sec-Fetch-Mode: navigate' -H 'Accept: text/html'`：文档导航 401 `text/html` 且含重试按钮；同样请求 API 为 401 `application/json`，均无原始上游诊断。最终 Gateway 定向 restart 退出 0，回环页面 200、匿名导航 API 401，策略同步最后为 `ready: true`。
- 未完成项：真实公网 hzy0 的匿名请求先被 Access 302 拦截，当前无可安全制造的实际失败页面；HTML 错误页的公网呈现尚需在自然故障或独立隔离故障演练中验证。本次未创建故障开关，也未制造真实故障。

### Codex C5（2026-09-23）

- 改动文件：`deploy/test-env/local-enterprise/gateway-transport.mjs`、`deploy/test-env/local-enterprise/test/gateway-transport.test.mjs`。仅 `/shell/{app}` 旧书签 redirect 改为 307；Location 与 `Cache-Control: no-store` 保持，其他跳转不变。
- 命令与结果：`node --test deploy/test-env/local-enterprise/test/gateway-transport.test.mjs`：15/15 通过；`node --test deploy/test-env/local-enterprise/test/*.test.mjs`：83/83 通过；Gateway 定向 `restart` 退出 0，四个 hzy0 进程 online。回环入口 GET/HEAD `/shell/aims?target=%2Faims%2Fprojects` 均为 307、Location `/aims/projects`、`Cache-Control: no-store`；GET `/` 与 `/enterprise/` 均保持 302、Location `/enterprise`。
- 未完成项：无。

### Codex C4 续查（2026-09-23，未部署）

- 改动文件：`platform/server/utils/policyBundle.ts`、`platform/server/utils/policyEnvelopeDelivery.ts`、`platform/test/policyEnvelopeDelivery.test.ts`。当前 bundle 元数据查询只选择所需列并加 `LIMIT 1`；完整 JSON 仅缓存缺失或数据库存储指纹变化时按 bundle id 取一行并校验 `bundle_hash`。进程缓存按 id + hash 有界保存，指纹变化失效。500 KB 合成载荷测试证明规范化载荷、修订响应、签名信封与原实现逐字节相同；拒绝码与鉴权路径未改。
- 定位：只读检查线上候选源码与调用链，signed GET 依次执行部署定位 SQL、当前 bundle SQL；envelope 另执行最多 4 行的 service key SQL。internal 中间件验证 token 后直接返回，没有 DB 查询；signed 分支先于 legacy `findOrGeneratePolicyBundleForDeployment`。线上原 `findCurrentPolicyEnvelopeRow` SQL 用 `MAX(latest.id)` 选当前行，实测结果 **1 行**，没有路由内多行 payload 查询。用同机 mysql2 新连接、同库同参数逐条复现：部署定位 1 行/209 B/121 ms；原当前整行查询 1 行/526,510 B/1,617 ms；新元数据投影 1 行/382 B/452 ms；envelope service key 1 行/133 B/127 ms。**15 行/6,023,120 B/2,452 ms** 是另行主动执行的全表 payload 对照查询，不属于该路由。
- 前后对比：原当前行结果 526,510 B，对照新元数据结果 382 B（缓存命中时减少约 99.93% 返回字节）；单次直接 SQL 时间 1,617→452 ms。缓存缺失仍需额外按 id 取一行 JSON 并完整验哈希，不能把这一投影差值当作真实 HTTP 加速。520,463 B 合成载荷在本机重复解析/规范化/哈希为 4.49 ms/次，缓存命中/哈希为 0.81 ms/次；发布生成的 120 秒不在这几毫秒计算中。
- 线上只读 HTTP 基线（**仍为未部署的原版本**）：本机直连 revision 两次 41.6、69.1 秒，envelope 27.4 秒，另一次 revision 90.6 秒；同机新建连接执行对应 SQL 均远低于 HTTP。请求期间只读网络采样见 Platform→DB 10 条连接，其中一条有未确认重传、RTO 3.24 秒，另一条 5 秒仅收约 33 KB；这提示连接池/网络等待，尚未证明唯一根因。未更改线上进程、配置或数据，未打印凭据。
- 命令与结果：`node --test --experimental-strip-types platform/test/policyEnvelope*.test.ts platform/test/consoleServiceKeys.test.ts`：21/21 通过；Platform 改动文件 ESLint 通过；`pnpm --dir platform typecheck` 通过；`git diff --check` 通过。此前全量 Platform 测试 327/328，唯一失败为未改动的 scheduler 应用列表缺少 `assets`。
- 未完成项：新代码尚未发布，无法给出线上 HTTP 后测或宣称 59～113 秒根因已消除。已排除“此 signed 路由主动读取多行 payload”假设；连接池/网络问题可能涉及 C4 授权文件之外的 `platform/server/utils/db.ts` 与运行环境，交 Claude 另行评估。`generatePolicyBundle` 的 >120 秒实际瓶颈仍需独立 SQL/网络剖析。
