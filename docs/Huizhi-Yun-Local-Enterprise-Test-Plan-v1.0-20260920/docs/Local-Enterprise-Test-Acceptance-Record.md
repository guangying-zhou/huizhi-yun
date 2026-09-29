# 本机 Enterprise 环境：参数冻结与验收记录

版本：1.1。日期：2026-09-20。Copilot 实施后由 Codex 接手核查；用户已确认 Copilot 停止。本记录区分实际回读、隔离测试与未验收项。

## 当前结论与后续顺序

### 2026-09-23 登出后再次访问 hzy0 显示 Not Found（已修复）

现象：登出后访问 `https://hzy0.isme.dev` 跳到 `/login?logged_out=1&redirect=…/console/oauth/authorize…`，页面 Not Found。原因：登出设置 Console 标记 Cookie `console_logged_out`，之后 `startUpstreamOidcLogin` 发现标记即跳到根相对 `/login`；云端 Console 位于根路径所以正常，hzy0 的 Console 挂在 `/console`，根 `/login` 在 Gateway 未注册（404）。修复：`console/server/utils/upstreamOidc.ts` 的登出标记跳转与登出兜底、`oauth/logout.get.ts` 默认登出去向，以及 WeCom/CAS/DingTalk 登录入口的同类跳转，统一改为按当前挂载前缀解析的 `resolveCurrentAppUrl(event, '/login')`；云端（根路径）结果不变。`console/test/logoutReauthentication.test.ts` 以 `/console` 前缀断言去向、`logged_out` 与 `redirect` 保留；Console 559/559、typecheck、lint 通过。hzy0 Console 已重启，实测带标记 Cookie 请求 `/console/api/auth/oidc-login` 返回 302 到 `/console/login?logged_out=1&redirect=%2Faims%2F`（200）。

随后登录页空白：Console 为 dev 模式，Vite 以百分号编码路径请求 Nuxt 虚拟模块（`/console/_nuxt/@id/virtual:nuxt:%2F…%2Fconsole%2F.nuxt%2F….mjs`），而 hzy0 Console 门面拒绝任何含 `%` 的路径。修复：`console-facade.mjs` 仅对 GET/HEAD 放行解码后落在本检出 `console/.nuxt/` 内、文件名为普通字符且无 `.`/`..` 段的该前缀路径，其余编码路径仍拒绝；测试覆盖穿越、其他应用 `.nuxt`、`/etc/passwd`、其他编码路径与 POST（hzy0 84/84）。用户 2026-09-23 实测登出后再次访问可正常显示登录页并登录。

### 2026-09-23 角色矩阵（LE-A09/A10）与策略变更后自动续期令牌

**角色矩阵**（真实浏览器，`test`，开发 Platform 修订 17～20，每次由用户发布，hzy0 约 1 分钟生效；脚本 `deploy/test-env/platform-test-role-matrix.mjs`，结束时 `restore` 到基线快照）：

| 配置 | 结果 |
| --- | --- |
| 只读（`console.viewer`，修订 17） | 工时、周报、创建工作项隐藏；项目周报服务端 403；公司级项目、工作项、目录按设计可见 |
| 员工（`aims.member`，修订 18） | 工时与创建工作项恢复；周报仍隐藏且服务端 403，与 `aims.member` 授权一致 |
| 项目经理（`aims.member` + `project_manager`，修订 19） | 周报、项目编辑与两个 Assets 入口出现；可读非成员项目周报，因为 `project_manager` 分配没有数据范围，在全租户生效（产品配置事项，非代码缺陷） |
| 登录中撤销全部角色（修订 20） | 服务端**立即**拒绝（旧令牌亦然）；菜单在令牌续期后收缩 |

“完全无 Aims 权限”（排除出租户基线）经用户确认不适用：登录用户都有基线权限；Host 的 `projects:view` 门槛仍作为纵深防御保留（有自动化测试）。目录用户接口（`/api/directory/users`）对登录用户可读，只含 uid、姓名、显示名、部门、职位、头像，无联系方式，属选人组件所需，关闭。

**发现 1 已修复：策略版本变更后客户端不续期令牌。** 原现象：策略变更后导航正确返回 401，但前端只在 `/api/auth/me` 判定未认证时才续期，令牌仍有效只是策略版本旧，于是一直停在“导航权限暂不可用”，刷新页面也无效。修复：
1. `enterprise/server/utils/enterprisePolicyGate.ts`：策略版本不符的 401 带稳定码 `enterprise_policy_version_changed`。
2. `deploy/test-env/local-enterprise/error-contract.mjs`：该码加入白名单（401），不再被改写为 `hzy0_upstream_error`。
3. `enterprise/app/plugins/enterprise-session.client.ts` 提供 `renewToken`（同一会话续期，单飞）；`useEnterpriseNavigationAccess.ts` 仅对该码续期一次并重载导航，60 秒内再次出现则显示原“不可用”状态，不循环；其他 401 仍走会话复核。

验证：Enterprise 188 项（187 通过、1 跳过）、hzy0 本机 83/83；门槛测试与错误表测试断言新码；Enterprise typecheck 通过。真实浏览器（`test` 切到只读，用户发布修订 22）：已打开的 `/aims/projects` 触发焦点刷新，序列为 `navigation 401 enterprise_policy_version_changed` → `POST auth/refresh 200` → `navigation 200`（1.4 秒内），导航由 23 项收缩为 18 项（工时、周报、成员工时等移除），未出现“导航权限暂不可用”，无需手动刷新。之后已 `restore`，待用户再发布一次恢复原角色。

遗留（不阻塞 G1）：项目页正文快捷按钮“查看项目工时/周报”未按权限过滤（UI，拟交 Codex）；写方法 OPTIONS 503（观察）；`project_manager` 是否加数据范围（产品决定）；云端对 `test` 的 403 为既有云端缺陷，`checkPermission` 修复需云端发布后生效；生产 Platform 同样连 `oa.wiztek.cn`（另行决定）。

### 2026-09-23 授权复核：意外修订 15 与两处授权修复

**意外修订 15**：09-23 15:32 UTC 为角色矩阵试图重新生成策略时请求超时并被中止，但服务器端仍在 15:36:56 完成生成，产生修订 15，其中 `test` 仅有 `console.viewer`（当时处于只读配置）。随后已恢复分配，用户 17:30:41 发布的修订 16 恢复了 `test` 的原有角色。hzy0 在约 15:38～17:31 使用修订 15（浏览器验收 A13～A16、A10、A12 均在此窗口内）；云端当日未写入旧表，仍为修订 14，不受影响。教训：中止的发布请求在服务器端仍可能完成。

**复核结论**：修订 15 下 `test` 只有租户基线 `aims:projects:view`（范围：参与项目）加 `console.viewer`，但 hzy0 仍列出全部项目并可打开非成员项目概览。查证后这符合 Aims 既有对象可见性：Runtime `projectVisibilityWhere` 让 `security_level='company'` 且密级 L0/L1 的项目对全体租户用户可见，另有负责人/创建人/成员/白名单/部门/管理员范围；旧 Aims 列表同样不单独检查 `projects:view`。因此不是越权列出，但 Host 在签发 Runtime 读取许可前缺少资源权限门槛：被排除出基线或权限被撤销的用户仍能读取。

**修复**（代码已完成，hzy0 开发模式已生效）：
1. `enterprise/server/utils/enterpriseAimsProjects.ts`：项目列表与详情在签发许可前经 Foundation `loadAuthorizationSnapshotFromConsoleRuntime` + `authorizationResourcesAllow` 要求 `aims:projects:view`，与周报读取一致；缺权 403 且不调用 Runtime，Console 授权不可用为 503。测试 `enterprise/test/aims-projects-bridge.test.mjs` 覆盖空权限、空动作、其他资源、依赖故障与 admin 蕴含 view；去掉门槛的变异会失败。
2. `aims/server/utils/checkPermission.ts`：`checkPermission`/`checkRole` 原先吞掉所有异常返回 false，使 Console 授权服务故障被伪装成 403“权限不足”，违反根规则。现在只有快照请求本身的 401/403 视为无权，其余一律 503。新增 `aims/test/checkPermissionDependency.test.ts`（去掉该区分的变异会失败）。这很可能也解释了云端在 Platform 变慢期间对 `test` 的 403，云端需发布后才生效。

验证：Aims 705/705、Enterprise 186/186 通过，两模块 typecheck 通过，改动文件 lint 无新增问题。LE-A09 的真实角色矩阵仍需执行（含“被排除/无 Aims 权限”配置）。

### 2026-09-23T17:23Z 开发 Platform 数据库迁到服务器本机（用户批准）

原因：开发 Platform（`gitlab.wiztek.cn`）的库 `hzy_platform_dev` 在 `oa.wiztek.cn`（`45.32.20.65`，往返 70～120 ms，实测吞吐约 15～30 KB/s，连接池出现未确认重传）。单条 SQL 不慢，但策略接口 HTTP 为 27～113 秒，hzy0 每轮同步 100～125 秒并常 504，阻塞角色矩阵。Codex C4 证明该路由只读 1 行 payload，排除了“多行读取”假设。

做法：`deploy/test-env/platform-dev-db-localize.mjs`。专用容器 `hzy-platform-dev-mysql`（MySQL 8.0.46，仅 `127.0.0.1:13317`，命名卷，`lower_case_table_names=1`、`utf8mb4_0900_ai_ci`、原 `sql_mode`、`+08:00` 与远端一致；口令随机生成，只存在 root 可读文件中）；不使用服务器上他人的 mysqld 8.0.22，也不用旧的 `hzy-test-mysql`。Platform 在线时全量播种（23.2 MB，17.9 分钟），逐表服务端 `CHECKSUM TABLE` 比对 98/101 一致（其余 3 张为运行中心跳表）。切换时只停 23 秒：重拷 3 张变动表（9.6 MB，19 秒），101 张表校验和全部一致后以仅改连接参数的配置重启，并持久化 PM2。回执 `deploy/test-env/artifacts/C000001.platform-dev-db-localize.json`。

结果：服务器本机修订查询 28/31/27 ms（此前 36～113 秒），信封 72 ms（713 KB，含 R1 服务公钥）；匿名 403 不变；其他进程不变。hzy0 策略同步每轮约 2 秒并 `ready`。

注意：远端 `oa.wiztek.cn` 上的 `hzy_platform_dev` 自 17:23:15 起不再被写入，只作回退与备份；回退（`db-localize.mjs rollback`）会丢失切换后在本地的写入。生产 `hzy-platform-prod` 也连 `oa.wiztek.cn`（另一库），链路相同，可能有同样的延迟问题，本次未改动。**用户决定（2026-09-24）：生产 Platform 为 main 分支版本、部署在 Cloudflare，连接 `oa.wiztek.cn` 不慢，暂不迁移。**过程中误停过 `hzy-test-mysql` 约 1 分钟（按镜像筛选容器时误中），已立即恢复、无连接中断，此后只按容器名操作。

### 2026-09-23T12:43Z 签名停用信封立即生效（开发 Platform，用户批准）

方法：`deploy/test-env/platform-tenant-suspension-probe.mjs` 只把开发 Platform `tenants.status`（C000001）在 `active`↔`suspended` 间切换，`suspend` 同时启动 10 分钟后自动恢复的守护进程（本次手动恢复后已停止）。Enterprise 路径用 Gateway 私有出口的真实令牌交换探测。

| 时间（UTC） | 步骤 | 结果 |
| --- | --- | --- |
| 12:43:34 | 基线 | 租户 active；hzy0 26 小时信封、续签 `ok`；Enterprise 令牌交换 200 |
| 12:43:46 | 停用 | 1 行变更，守护进程已启动 |
| 12:46:12 | hzy0 同步 | 存入签名 `suspended` 信封（仍在 26 小时有效期内）；Enterprise 令牌交换立即 503 `local_console_policy_unavailable`；匿名导航 401 不变 |
| 12:46:22 | 停用期间叠加 `platform-down` | Runtime 拒绝 Console 服务密钥断言 `console_assertion_policy_inactive`（`verdict=inactive`），故障路径不能绕过停用 |
| 12:46:36 | 恢复 active，停止守护 | — |
| 12:51:52 | hzy0 同步 | 新 active 信封写入，续签 `ok`；Enterprise 令牌交换 200；云端 `/aims/api/v1/projects` 401、`/console/login` 200 |

观察：恢复耗时约 5 分钟。其间开发 Platform 经本机链路交付慢（完整信封准备 107～124 秒，一次修订查询与信封 504），启动令牌超时后 Console 改用服务密钥，而库中仍是停用信封，Runtime 按设计拒绝，只能等下一次 Platform 启动令牌成功。这符合“停用不能经密钥自行恢复”的安全要求，但说明停用恢复依赖 Platform 可达，且完整信封（约 727 KB）跨境交付偏慢，列为性能观察项。云端 Console 仍用旧表每日同步，本次未见其受影响（恢复后抽查正常）。

### 2026-09-23T03:00Z Console 稳态服务身份（R1）实际验收（hzy0 + 开发 Platform，用户批准）

准备：开发 Platform 发布 `console-service-key-20260923`（含 `console_service_keys` 迁移，回执 `deploy/test-env/artifacts/C000001.platform-console-service-key-deployment.json`）；本机 Runtime `0.3.219-test.console-steady-identity.1`，本机 Console 库新增 `console_service_assertion_replay`；Console 密钥 `csk_c81f518610829a5c`（0600，profile 旁）。新故障开关值 `platform-down`：hzy0 对 Platform 的全部调用（启动令牌、策略信封、修订查询、公钥登记）都失败；hzy0 只有这四类 Platform 调用。Enterprise 路径用 Gateway 私有出口的真实令牌交换探测（`enterprise.runtime` → Console → Runtime，`aims:projects:view`），只输出状态与声明结构。

| 时间（UTC） | 步骤 | 结果 |
| --- | --- | --- |
| 03:00 | Console 自动登记公钥 | Platform 200；首轮同步因预取信封不含新公钥未送达，修正 Console/Gateway 协调后（见下）03:12 信封正文含 `serviceKeys`（仅 `wiztek-test-console`） |
| 03:04–03:06 | `platform-down`，信封有效 | Console 记录 `console-steady-identity`，Runtime `console_service_assertion accepted verdict=valid`；Console 仍能把 `platform_unavailable` 写入 Runtime |
| 03:17 | 恢复并临时把测试信封有效期改为 20 分钟 | 取得 20 分钟信封（仍含公钥） |
| 03:18 | `platform-down`，信封有效 | Enterprise 令牌交换 200，声明绑定正确，`verdict=valid` |
| 03:38 | 信封 03:37:28 过期后仍 `platform-down` | Enterprise 令牌交换 200，`verdict=grace` |
| 03:38 | `refused` 一轮后再 `platform-down` | 续签状态 `refused`；断言被拒 `console_assertion_policy_inactive`（`verdict=expired`），Enterprise 403；下一轮故障同步未覆盖 `refused`，Enterprise 503 `local_console_policy_unavailable` |
| 03:40 | 清除开关 | 新信封写入，续签状态 `ok`；Enterprise 200 且无断言（回到 Platform 启动令牌） |
| 03:42 | 开发 Platform 恢复 26 小时测试有效期 | 进程在线；持久化配置本来就是 26 小时 |

验收中修正：①登记成功后 Console 在 15 分钟内持续尝试取回含新公钥的完整信封（取回失败不算故障证据）；②Console 取信封而该轮 Gateway 未预取时，下一轮 Gateway 预取完整信封。两项均有测试。

结论与限制：hzy0 已证明 Platform 整体不可用时 Console 在策略有效期和宽限期内持续服务，拒绝与过期后失败关闭，恢复后回到启动令牌。未做浏览器页面实测（本轮无用户会话流量落在故障窗口）；云端 Gateway 的租户注册表解析仍依赖 Platform，云端 Worker Secret 与演练属 R1-6，生产另行批准。停用信封立即生效仍未实测。**G1 仍待其余项目。**

### 2026-09-22T21:19Z 故障宽限实际验收（hzy0，用户批准）

方法：开发环境 Platform 用 `deploy/test-env/platform-policy-test-lease.mjs` 临时把 hzy0 测试信封有效期改为 20 分钟（未持久化，验完已改回 26 小时）；本机 Gateway 新增只在验收时使用的故障开关（profile 旁的 `policy-sync-fault` 文件，取值 `unavailable` 或 `refused`；打开后不连 Platform，直接返回 503 或 403），本机环境 69 项测试通过。

| 时间（UTC） | 步骤 | 结果 |
| --- | --- | --- |
| 20:45:29 | 自然续签拿到 20 分钟信封 | 到期时间 21:05:29 |
| 20:46:00 | 打开 `unavailable` | 20:46:52 `renewal_state=platform_unavailable`，失败后持续按退避重试，尝试时间不断刷新 |
| 21:05:29 | 信封过期 | Console 记录 `console-policy-outage-grace`（宽限截止时间为尝试时间加 30 分钟）；Runtime `/v1/enterprise/console-policy` 返回 200 共 3 次，Enterprise 记录 3 条 `enterprise-policy-outage-grace`；用户确认项目列表正常 |
| 21:16:56 | 切换为 `refused` | 21:17:34 `renewal_state=refused`（403 原样传给 Console）；Runtime 读取接口 `503 policy_reader_unavailable`，Console `verified-policy-invalid` 503；用户刷新页面得到 503，失败关闭 |
| 21:18:10 | 删除开关 | 21:18:37 拉到新信封，`renewal_state=ok`，`mode=renewed` |
| 21:19:02 | Platform 恢复 26 小时有效期 | 其他进程未变 |

发现和遗留：①失败关闭时整个 Enterprise 页面直接返回原始 JSON（`hzy0_upstream_error`），而不是在页面内提示“导航权限暂不可用”，用户体验有待改进；②hzy0 的 Gateway 只开放 Console 的认证页面，Console 管理首页的宽限提示无法在 hzy0 查看，经用户决定留到云端测试环境做视觉验收；③停用信封立即生效仍未做实际验收（需要真正停用测试租户）；④本次故障开关只模拟策略接口不可用，Console 启动令牌仍由 Platform 正常签发，因此验收结论限于“策略接口故障宽限”，不代表 Platform 整体故障时可继续服务（评审 R1）。**G1 仍不放行。**

### 2026-09-22T20:23Z Codocs 个人文档保存 500 修复（Runtime `policy-renewal.2`）

19:14–19:19Z 的 5 次 `POST /v1/enterprise/codocs/personal-documents:update` 都返回 500，Runtime 日志为 `Error 1406: Data too long for column 'command_schema_version'`。原因：Codocs 有 5 个写入回执的 schema 标识超过各模块统一的 `VARCHAR(30)` 列宽，保存用的 `codocs-personal-document-update.v1` 是 34 个字符。这个问题与 `policy-renewal.1` 替换无关（旧二进制包含同样的代码，只是此前没人调用过）。按 Aims 已有惯例把 5 个标识缩短到 30 字符以内，并新增守护测试；标识不参与命令摘要，统一库回执表为空，没有兼容问题。经用户同意，只替换本机 Runtime 并重启。替换后保存变为 503，Runtime 报 `Error 3819: Check constraint 'chk_scr_cross_app'`：Codocs 全部 8 个自有命令写的都是 `codocs→codocs` 回执，而 Codocs 与 Aims 的表结构都只允许跨应用回执（这些命令的测试使用 sqlmock，所以一直没发现）。按 Assets `20260914_assets_owned_product_link_receipts.sql` 的先例，新增 `codocs/docs/migrations/20260922_codocs_owned_command_receipts.sql`：只额外放行这 8 个精确的“操作码/权限/schema”组合，并要求同一部署、有发起人；同步更新 `codocs_schema.sql`，新增守护测试 `TestOwnedReceiptCheckCoversCodocsCommands`（变异检查能抓到遗漏）。备份表定义后，把迁移应用到本机 `hzy_codocs`（表为空），并在回滚事务中验证：保存和批注放行；错误权限、未登记操作、缺少发起人、跨部署都拒绝；普通跨应用回执不受影响。尚需在浏览器里实际保存一次文档来验收；Codocs 前端和 Enterprise 由外部工具（ChatGPT）另行修改，本会话没有改动这两部分。

### 2026-09-22T19:37Z 另一台电脑首次打开页面报 500（useHead 缺少上下文）

现象：从另一台电脑访问 hzy0 时，页面报 500 `useHead() was called without provide context`，本机浏览器正常。原因：Enterprise dev 模式下 `date-fns`、`date-fns/locale`、`marked`（Aims 页面引用）没有预构建，每次都要等浏览器首次请求时才被 Vite 发现（日志中已出现 5 次），随后重新优化依赖并强制重载，浏览器没有缓存时会混入两份 vue/@unhead 模块。19:19–19:21Z 有外部工具在同一工作区修改 Codocs/Enterprise 文件，热更新编译失败、Nuxt 自动重启也失败，可能加重了这个问题。处理：把这 3 个依赖加入 `enterprise/nuxt.config.ts` 的 hzy0 本地预构建清单，并通过 CLI 只重启 `hzy0-enterprise`；Vite/Nitro 编译成功，重启后没有新的错误日志；本机环境 68 项通过，Enterprise 测试失败项与基线一致。用户在另一台电脑强制刷新后确认恢复正常。同时确认文档保存的 `PUT /codocs/api/documents/*` 由 hzy0 Gateway 按设计拒绝（`/codocs/` 只开放编辑器页面和静态资源的 GET/HEAD），与访问来自哪台电脑无关；这部分由外部工具另行处理，本会话未修改 Codocs。

### 2026-09-22T18:48Z 策略故障宽限：hzy0 本机切换（阶段 F 第 1、2 项，已观察）

用户批准后完成：①本机 Console 测试库执行续签状态迁移，只加两个可空列，执行前备份了表；②构建 `0.3.219-test.policy-renewal.1` 并用 LaunchAgent 全部环境变量做启动探测，备份旧二进制后替换，只重启 Runtime；③Gateway 已按新同步逻辑运行，修订查询关闭（开发环境 Platform 尚未部署阶段 C）。回读：本机和公网 health 都是新版本；匿名和伪造令牌返回 401；替换后第一轮同步 `ready=true`，数据库 `renewal_state=ok`，尝试时间等于接收时间；Enterprise 导航读取、Console 读写都返回 200；Console、Enterprise worker healthy。18:47Z 起后台观察，每分钟记录一次。**截至 20:31Z（103 分钟）的结论**：同步没有失败；`renewal_state` 始终为 `ok`；18:58Z 开发环境 Platform 发布阶段 C 后，本机打开了修订查询，并修正为由 Console 回报 `renewAfter`，此后多数分钟只做修订查询（Console `mode=unchanged`，同步约 110ms），信封签发满 15 分钟时按时续签（信封最长存活 960 秒）；20:23Z Runtime 换成 `policy-renewal.2` 后同步不中断。有 10 分钟出现非 ok 的 Runtime 请求，全部是当时 Codocs 保存的 500（Error 1406/3819），已修复，用户确认可以保存。

**尚未验证**：①信封过期后进入宽限，以及管理首页提示（hzy0 用开发环境 Platform 签发的 26 小时测试信封，需要缩短测试有效期或部署阶段 C，属于第 2 项）；②明确拒绝后失败关闭、停用信封立即生效（需要 Platform 阶段 C）；③角色变更在导航中生效的时间（需要在开发环境 Platform 上实际修改角色，并在登录的浏览器里观察）。**G1 仍不放行。**

### 2026-09-22T17:38Z 已验证策略跨请求复用（方案 3，用户已批准）

用户选择方案 3，并确认撤权时效要求不高。新增 `console/server/utils/verifiedPolicyReadCache.ts`，`readVerifiedConsolePolicy` 通过它在进程内跨请求复用已验证的策略结果。复用时长取现有的 `HZY_PLATFORM_BUNDLE_MEMORY_TTL_MS`，默认 30 秒，不超过策略最大有效期；按信任密钥和绑定上下文分别缓存，且不越过签名截止时间。同一时刻的并发读取合并为一次 Runtime 读取；失败和缺失不缓存。`writeVerifiedConsolePolicy` 同步成功后立即替换缓存，更早发起的读取不能覆盖它。服务令牌按请求签发的逻辑没动。

验证：新增 6 项缓存测试（TTL、签名截止时间、失败不缓存、TTL 为 0 时关闭、按绑定区分与并发合并、同步替换与旧读取不回写），Console 全量 544 项和 Console typecheck 通过，本机环境 65 项通过。经 CLI 只重启 `hzy0-console`，worker healthy。用户同样做了两次项目页加载（首次进入加一次刷新），反馈“快了不少”。同口径对比 Runtime 日志：`console:policy-bundle:read` 从 208 次降到 3 次，`service_token.issue` 从 391 次降到 190 次。重启后 Console 没有新的慢审计或依赖失败事件，Enterprise 也没有新增失败日志。改动未提交，也未部署 Cloudflare。每次请求仍要现签服务令牌，这是剩余的主要调用放大来源。**G1 仍不放行**，还需在多个策略刷新窗口下观察稳定性。

### 2026-09-22T17:31Z 首屏慢定位：Console 请求内策略读取与服务令牌签发放大

经用户同意，临时给本机 Console 开启仅监听回环的 inspector，在用户做两次项目页加载（首次进入加一次刷新）期间，对 Nitro worker 抓了 CPU profile（17:28:57–17:30:37Z）。完成后已恢复 runner、重启 Console，并回读确认没有进程再带 `--inspect`；worker 探测 healthy，本机环境 65 项测试通过。

结果：同一时间窗口内，Runtime 日志中 Console 调用了 `console:policy-bundle:read` 208 次、`service_token.issue` 391 次、`session.resolve` 50 次、`token_event.append` 38 次。Runtime 各操作 p95 都在 70 ms 以内，审计写入只要 0–3 ms。Console worker 在 99 秒里只有约 5.8 秒占用 CPU，但约 3.8 秒花在 `readVerifiedConsolePolicy` → `verifiedSnapshotBundle` 上，另有约 0.45 秒是 `destr` 解析响应。平均每次读取约 727 KB 的签名信封要 18–20 ms CPU。原因是 `verifyRuntimePolicySnapshot` 和 `verifiedEnvelopeBundle` 各自做一次完整的 Ed25519 验签、payload 哈希和两层 JSON 解析，相当于同一份信封处理了两遍。按 requestId 对照，一次审计写入要串行调 12 次 Runtime（6 次签令牌、3 次读策略、3 次业务操作），Console 侧合计约 3.6 秒。现有 `coalescePolicyRead` 只合并同一请求内同时发起的调用，依次发起的调用仍会重复读取和验签；并发高峰时单线程上的 CPU 排队又放大了每一步的等待。

候选修复（均未实施）：1）同一次验签只处理一遍信封；2）在单个 HTTP 请求内复用已验签的策略结果，仍保留截止时间检查，不跨请求缓存；3）是否允许以 etag 或短 TTL 跨请求复用，涉及授权新鲜度，需另行决定。服务令牌按请求现签是既有安全设计，本次不动。按根级授权规则，改动需执行角色合并、模拟隔离、自定义角色、动作蕴含、数据范围和过期授权回归。**G1 仍不放行。**

### 2026-09-22T17:20Z 间歇 503 根因复现：Node Happy Eyeballs 250 ms 单次尝试上限

在本机用 Node v24.18.0 做了复现。`hzy-test-runtime.isme.dev` 解析到 1 个 IPv4 和 1 个 IPv6 地址。本机没有 IPv6 路由，15 次 IPv6 建连都立即返回 `EHOSTUNREACH`，因此只有 IPv4 可用。IPv4 TCP/443 建连在低并发时约 40 ms；按 12 路并发连 120 次，p50 41 ms、p95 271 ms，有 8 次超过 250 ms。Node 默认启用 `autoSelectFamily`，每个地址的尝试上限 `autoSelectFamilyAttemptTimeout` 是 250 ms。同样按 12 路并发连 120 次，默认配置复现 `ETIMEDOUT@261ms`，与此前 `service-token-issue-http` 记录的 258/277 ms 吻合。把上限调到 1000 ms，或固定 `family: 4`，均为 0/120 失败。结论：公网拨号只是触发条件，直接原因是 IPv4 握手偶发慢于 250 ms，被 Node 客户端提前中止，再映射为授权依赖 503。回环传输避开了这条路径，所以上一段试运行恢复了。Cloudflare Worker 不是 Node 运行时，不受此问题影响。

处理：`run-process.mjs` 的 `processEnvironment()` 为 Gateway、Console、Enterprise 统一设置 `NODE_OPTIONS=--network-family-autoselection-attempt-timeout=1000`，并在 `enterprise-config.test.mjs` 中加断言；本机环境 65 项测试通过。经 CLI 只重启这三个受管进程后，已回读确认所有 Nitro worker 进程都带该参数；smoke 0 项失败，Enterprise/Console worker 探测 healthy。回环配置保持启用。这样本机其余公网出站（Platform、JWKS）也不会再因 250 ms 上限失败。首屏慢和此前一次导航触及 10 秒上限与本问题无关，仍待单独排查。**G1 仍不放行**，还需在多个策略刷新窗口下观察稳定性。另见：主机数据盘占用约 96%。

### 2026-09-22T17:07Z hzy0 固定 Runtime 回环传输试运行

经用户批准，仅本机 hzy0 Dev stack 的 Runtime HTTP 拨号改用 `http://127.0.0.1:18084`；可信、签名的规范 Runtime 端点仍是 `https://hzy-test-runtime.isme.dev`。Gateway 剥离浏览器伪造的拨号头，只在受管本机入口注入固定拨号头；Foundation 仅在固定 development/租户/部署/来源和可信 Gateway 凭据均成立时接受。Console facade 与签名策略调度同样保留规范端点，未改签名信封、服务令牌、角色或 Runtime 授权，也没有自动公网回退。Gateway 启动前对比本地与公网 `/runtime/healthz` 的身份、版本、提交和构建时间；本次均为 `0.3.219-test.codocs-version-read.1` / `a986750abe79c02b9d22b345e05a499e1fe2acc8`。本机 `127.0.0.1:18084` 由当前用户的既有 Runtime 进程监听；未重启或替换 Runtime。

配置严格校验通过后，只重启受管 `hzy0-gateway`、`hzy0-console`、`hzy0-enterprise` Dev 进程。Enterprise/Console 实际 Nitro 请求 worker 探测均 healthy；登录态 Chrome 中 `/aims/projects` 首次及一次普通刷新最终均有完整菜单和项目卡片，`/aims/products` 最终有完整菜单与 6 条产品线。加载仍有可感知等待，尚未跨多个策略/凭据刷新窗口、故障恢复和撤权场景；本次不能断言间歇 503 已根治，**G1 仍不放行**。回退方法是把本机 profile 的 `transportMode`/`dialEndpoint` 恢复为 `public-https`/`null`，再只重启上述受管进程；不涉及 Runtime、数据库或授权变更。

本机环境 64 项、Tenant Gateway 45 项、Foundation 定向 24 项与 Foundation typecheck 通过；新增超限健康响应回归后还需重跑对应小套。源码和本机 profile 是未提交的试运行状态，未部署 Cloudflare Worker。前一节“回环模式尚未实现”是当时的历史状态，不代表本段试运行的当前配置。

### 2026-09-22T16:52Z Console→Runtime 服务令牌链定向收窄（本机 Dev 试用）

从本机现有脱敏日志按同一 request ID 关联，最近的快速失败依次为 `service-token-local-runtime` 503（约 260–271 毫秒）、`verified-policy-token/store` 503，并可连带 `runtime-jwks` 503；后几项是上游签发失败的传播，不应判为分别独立的权限撤销。现有 Console 警告中，`/v1/console/auth/service-tokens/issue` 近 127 条匹配记录均映射为 503；最近记录没有可解析的 HTTP 响应头/正文形状。此证据倾向于 Console→Runtime 的 HTTP/传输路径，但在未获得原始网络错误分类前，不能把网络或 Runtime 服务端定为唯一根因。无凭据地用 curl 与 Node fetch 各 5 次访问固定 Runtime 公网入口 `/health`，均到达并返回 404；这只证明该短采样中入口可达，不证明带 bootstrap 的签发 POST 健康。

当前工作树只给精确签发路由增加 `service-token-issue-bootstrap`/`service-token-issue-http` 两个脱敏阶段，并允许记录固定枚举的网络错误码；不记录 URL、凭据、响应正文，也未调整签发、权限、超时或重试。Foundation 定向 27 项、日志读取 1 项与 Foundation typecheck 通过，`git diff --check` 通过。经归属校验只重启本机 `hzy0-console` Dev 进程；Enterprise/Console 请求 worker 随后分别返回 200，未触碰 Runtime、数据库、Gateway 或权限配置。随后真实浏览器刷新仍出现产品页部分区块 503、导航加载慢，但六条产品线最终显示。新日志按两个 request ID 捕获 `service-token-issue-http` `FetchError`、`ETIMEDOUT`，约 258/277 毫秒；没有同 ID 的 bootstrap 阶段失败。固定 Runtime 域名解析出 IPv4/IPv6；本机 3 次 IPv4 TCP/443 建连成功、3 次 IPv6 建连立即 `EHOSTUNREACH`，但不能据此断言失败 POST 一定走 IPv6。下一步应有界确认 Runtime 公网出站的连接失败原因，并评估已登记但未实现的本机 loopback transport；该模式目前被 profile 校验明确禁止，不得直接改配置绕过。对签发 POST 不做无条件重试。**G1 仍不放行。**

### 2026-09-22T16:39Z 登录后浏览器复测：可恢复但仍间歇 503

用户重新完成 Cloudflare Access 登录后，在保留的 Chrome 测试标签页复测。首次 `/aims/products` 和 `/enterprise` 页面刷新曾直接返回脱敏 `hzy0_upstream_error` 503；低成本 worker 探针同时显示 Enterprise/Console 请求 worker 均为 200，不能把 PM2/探针健康等同于业务页健康。Gateway 安全日志有一次 `/oauth/userinfo` 上游 503 和一次策略同步 503（策略预取约 13.2 秒、bootstrap 约 3.2 秒、Console 同步约 33.4 秒），之后自动同步 ready=true；Enterprise 安全日志还记录四个 userinfo 调用约 15 秒后为 502。不能仅从这些并发事件推断某一个为全部页面 503 的唯一原因。

重新加载 `/enterprise` 后页面可渲染，但导航初次请求 503，明确显示“导航权限暂不可用”；点击页面的“重新加载导航”后该请求 200，完整侧栏和工作台入口恢复。进入 `/aims/projects`，导航、目录三项、项目和项目集请求最终均为 200，项目卡片可见；进入 `/aims/products`，导航与产品列表均为 200，6 条产品线可见，当前采样只有一条产品列表浏览器请求。产品页再刷新一次，导航及产品请求仍为 200、6 条产品线最终可见，但首屏长时间停留在“正在加载汇智云…”，未达到日常测试性能目标。以上只证明故障后可恢复和本次读路径成功，**间歇 503 未消除，G1 不放行**。Console 本地令牌签发又增加“策略摘要读取”和“Runtime 签发”两个脱敏失败阶段，供下一次 503 定位，未更改签发规则。本机 Runtime 仍保持上节已回滚的原二进制；没有再修改授权、签名有效期或运行进程。

### 2026-09-22T16:27Z Foundation bootstrap 同键合并候选

Runtime 快路径试运行仍复现导航 503 后，继续核查 Host/Console 共用的 `requestPlatformRuntimeBootstrapToken`：原实现仅复用已完成 token，未合并同一受信绑定下的并发 Platform 请求。当前工作树加入在途 Promise 合并，键覆盖固定 Platform 地址、租户、部署、环境、app 及当前内部凭据；失败清理、成功仅按原有效期缓存，轮换凭据不会复用旧令牌。新增隔离 HTTP 测试验证 6 个并发调用仅回源一次、失败后重新取得、完成缓存复用及凭据轮换隔离；`foundation` 定向 23 项测试与 typecheck、脱敏日志测试均通过。增加 `platform-bootstrap-fetch/binding` 安全阶段，仅记录允许列出的状态、类别和耗时，不打印 token、Cookie 或正文。

这是尚未固定/提交的本机 Dev 源码候选，不表示这次 503 已查明唯一根因或通过浏览器回归。后续回归：Foundation 全套、Console 538 项、Gateway/本地出口定向 11 项及 Aims 合并读取 3 项通过；Foundation/Console/Aims typecheck、`git diff --check` 通过。Console 一项源码形状测试原先只识别 `const snapshot = await`，已改为验证实际调用而不依赖变量声明形状。安全日志同时见 Console `verified-policy-token`/`runtime-jwks` 在约 260 ms 返回 503，Enterprise 四项共享导航授权失败；历史样本也有 10 秒超时，不能把两类耗时混为一个故障。测试标签页仍在 Cloudflare Access 登录页，已交还用户完成验证；获登录态后需跨多个凭据和策略刷新窗口再测菜单、项目及产品列表。

### 2026-09-22T16:22Z 导航 503 定向修复试运行与回退

以当前测试 Runtime 二进制的源码基线 `a986750abe79c02b9d22b345e05a499e1fe2acc8` 建立隔离工作树，仅叠加 `console.runtime` 服务令牌身份快路径及其测试；隔离工作树 Go 全量测试通过，完整 LaunchAgent 环境启动探测到达 `127.0.0.1:18084` 监听阶段。用户批准后备份原二进制（SHA-256 `53c0f858938d617acdb5a5babb57437e7c62dde00f411f8d3d99d3ba527471d8`）到本机受保护运行目录 `deployments/console-token-read-20260922T1610Z/hzy-data-runtime.before`，短暂试运行 `0.3.219-test.console-token-read.1`（SHA-256 `b274b65af19ddb1c9056c8bd0d4fc69faaef7c962f09a2b7a8efaec3b9b614b2`）。本机及公网 health 均为新版本 200，匿名策略读取均为 401。

登录态浏览器先观察到项目卡片、业务导航、6 条产品线及相应读请求 200，但重复刷新时仍出现导航 503，产品列表为 200；Console 安全诊断仍有 `verified-policy-token` → `runtime-jwks` 503，以及导航三个模块共享授权调用失败。因此此快路径不构成故障根治证据，已按预案将原二进制恢复并只重启 `cn.wiztek.hzy-test-runtime`；回环与公网 health 均回读原版 `0.3.219-test.codocs-version-read.1` 200。未改数据库、schema、grants、密钥或 Tunnel。随后测试标签页进入 Cloudflare Access 登录页，登录态多窗口验收暂停；G1 仍未放行。源码候选和不含凭据的分阶段日志保留供继续诊断。

### 2026-09-22 UTC 固定快照 `fc41e813` 审查第 3/4 节收口增量

代码候选（尚未提交）修正了同上下文 30 秒刷新取消慢导航请求的问题：路由、focus 和定时触发合并在途请求；退出、上下文切换与撤权仍立即清理；旧显示租约到期只清空旧菜单，不取消已在途的新验证请求，新响应仅在自身起点绑定的租约仍有效时恢复可见性。策略交付现在在领取短期 bootstrap **之前**有界读取完整原始签名信封，当前调度内单次消费；过期或重复消费失败并从下一轮重新执行预取，不再凭已签发 bootstrap 隐式回源。相关导航 12 项、策略同步 9 项、worker 探测 1 项隔离测试通过，Enterprise/Console/Foundation 类型检查通过。Gateway 已按本机受控 CLI 重启到候选代码；Host Dev 仍为工作树候选，不是固定发布制品。

策略同步新增不含凭据、信封正文的分段计时。最近四轮自动同步均 ready=true，整轮约 24.2/29.6/11.3/9.2 秒，其中策略预取约 20.5/25.3/7.8/6.5 秒，bootstrap 约 0–1.8 秒，Console 同步约 1.9–3.5 秒。仅定位本次样本的主要耗时，尚未覆盖故障恢复与多个完整有效窗口，B1/G1 未放行。低成本 Nitro worker 探针穿过 Enterprise/Console 请求进程；一次实测两者 200、约 23/3 毫秒，RSS 约 1.23/1.17 GB，heap used 约 32/28 MB；进程外壳 online 不作为探针结果。`node deploy/test-env/local-enterprise/probe-worker-health.mjs --probe` 为只读；显式 `--recover=enterprise|console` 需连续两次失败且仅重启有归属的本机对应进程，尚未在真实故障中验证自动恢复，也未确认历史 OOM 根因。

本机 Data Runtime 原先是 `0.3.219-test.verified-policy.1`（`7d42…`）；经全量 Go 测试、完整 LaunchAgent 环境启动探针和备份，仅更新本机 `cn.wiztek.hzy-test-runtime` 为 `0.3.219-test.codocs-version-read.1`（源码 `a986750abe79c02b9d22b345e05a499e1fe2acc8`，2026-09-22T04:15:24Z）。旧二进制备份在 `~/Library/Application Support/HuizhiYun/test-runtime/deployments/codocs-version-read-20260922T0415Z/hzy-data-runtime.before`；本机及公开测试 Runtime health 200、匿名版本请求 401。没有安装新 snapshot schema、扩大 grants 或启用 v2 写入。浏览器同账号能打开该文档正文，版本侧栏显示“暂无版本历史”且未显示 403；该对象没有可验证的历史版本，本次仍未完成版本详情的正式允许/跨文档拒绝验证；页面导航仍曾长时间显示加载，因此 B3 只记“运行版本差已修、业务读取待验”，不写成 403 全面解决。B4 正式写入仍受 [协调合同](../../Codocs-Document-Write-Coordination.md)的 OSS verifier、受信路由、已提交引用读取消费者、Collab epoch 与旧 writer 协调阻塞；本轮重跑隔离 MySQL snapshot 测试的 8 个并发/撤权/回滚/精确引用子场景全部通过，但存储仍为替身。维持失败关闭，不用成功回执重放代替完整写入一致性。

当前组合不是固定候选发布：Host/Console 使用本机 Dev 工作树（基础源码 `a986750a` 加未提交修正），Gateway 已单独重启使用同工作树；Runtime 是上述固定二进制；目标 snapshot schema 未安装，正式权限目录未为 v2 写入扩权。先固定并对齐这些制品，再做 B3 版本正反例与 B4 真存储/多 writer 验收。此增量不改变 G1 状态。

### 2026-09-22 UTC 首页刷新后菜单再次消失：本机策略传输超时复查

用户浏览器记录 `/enterprise/api/navigation` 持续 503，菜单在刷新后为空。
Runtime 只读回读确认签名策略已经过期；同一正式签名同步链路手动触发能够成功，
故不能把一次恢复视为自动续期稳定。为自动任务增加不含凭据、信封或上游正文的
阶段与耗时记录后，实测失败位于 Console 策略同步响应阶段，约 32.5 秒。
使用原受控 Gateway 策略交付凭据连续只读探测同一固定 Platform 地址，前四次
耗时约 8.6/9.4/12.8/18.9 秒，第五次在原 30 秒阈值超时。

仅本机 verified-policy profile 将策略交付、Console 内部读取、Gateway 调度
的超时分层调整为 60/65/75 秒；正式信封仍为五分钟，过期仍拒绝，不做
缓存续龄、签名绕过或权限放宽。失败继续按 15/30/60 秒重试，日志只含固定阶段、
HTTP 状态与耗时。定向本地 12 项测试通过，拥有权校验后仅重启本机 Console
和 Gateway。新配置下自动续期两次成功：交付分别约 50.5/36.7 秒，同步分别
约 56.4/44.6 秒，刷新后当前账号及完整业务导航再次可见。随后第三次同步
仍失败，故上述超时调整不足以单独稳定环境。进一步实测同一固定接口经 curl
返回 200，但首字节约 52.7 秒；慢点不局限于 Node fetch。慢策略请求发生在
90 秒 Runtime bootstrap 签发之后，会挤压令牌余量，日志出现短期 bootstrap
已到期的拒绝。

因此本机 Gateway 改为每次调度**先获取当次签名信封、再获取短期 bootstrap、
立即调用 Console**；信封仅在该次调度的私有出口单次交付，失败清除，30 秒内
未消费也不复用。Console/Runtime 仍按原签名、CAS、有效期和授权规则判定。
新增顺序与单次消费回归，7 项定向测试通过；仅重启 Gateway 后，首轮私有交付
耗时约 0 毫秒，签名同步约 25.5 秒且 ready=true。浏览器刷新最终显示完整菜单，
但加载仍经历约几十秒。后续一次同步仍返回 401；追到 Gateway 通用 bootstrap
缓存只要求剩余 15 秒，慢链路可能复用即将过期的令牌。仅本机 Console 门面将
普通认证请求的最小剩余寿命设为 45 秒、策略调度设为 75 秒；不足时通过原
正式来源重新获取。Gateway 相关 40 项、本机门面/调度 10 项回归通过。

固定策略源又出现超过原 60 秒阈值的失败，本机预取超时设为 90 秒、正常
调度间隔从 120 秒缩为 60 秒；失败退避仍为 15/30/60 秒，签名有效期不变。
拥有权校验后仅重启 hzy0 Gateway。新进程连续两轮正式同步 ready=true，
私有交付约 0 毫秒，整轮分别约 54.3/53.1 秒；浏览器普通刷新显示当前账号、
完整侧栏和工作台入口。继续观察到第三、四轮分别约 57.0/60.4 秒且
ready=true；跨过首轮信封的五分钟窗口后再次普通刷新，当前账号、完整侧栏与
工作台入口最终可见。刷新期间仍曾先显示空入口，约数十秒后加载完成，
故只把“跨窗口功能恢复”记为本次证据；持续性能、长时稳定、完整权限/失败
矩阵及 G1 仍未放行。曾遇 Chrome `ERR_BLOCKED_BY_CLIENT`，普通重载恢复，
未将其归因为服务端 503。最终本机整套 55 项、Gateway 40 项测试通过，
Console/Enterprise 类型检查通过；第五、六轮自动同步继续 ready=true（约
63.1/43.6 秒）。Host 在 `idle/loading` 阶段明确显示导航/入口加载提示，
`error/expired` 与真正无权限仍分别提示，不以空菜单冒充授权结论。

### 2026-09-22 UTC 授权页 503 复发：策略续期调度修正

现场 Console 报 `verified_console_policy_receipt_invalid`，Gateway 连续同步
ready=false，令牌/目录随后 503。原调度成功和失败均在完成后等待 120 秒；
两次 45 秒超时加等待即可超过五分钟签名窗口。修正失败后的非重叠有界退避为
15/30/60 秒，成功恢复 120 秒；不延长信封有效期、不复用过期回执、不改授权。
独立固定策略交付探测返回 200、耗时约 15.5 秒，说明外部交付仍有显著延迟，
重试修正不是对所有网络超时的根治。

本地环境测试 53 项通过，仅经拥有权校验重启 hzy0-gateway；新进程首次正式
签名同步 ready=true。浏览器从根入口新发起事务后进入 Enterprise，当前账号、
完整业务导航和工作台入口均显示，令牌/JWKS/userinfo 回执 200。没有重放旧
授权 URL、修改云端、数据库授权或降低验证要求。长期稳定性和业务响应性能仍
未验收，不能将本次恢复等同于全部 503 已永久消除。

### 2026-09-22 UTC 复查复发与请求放大修正（登录后读取通过，性能未通过）

对上一条“功能恢复”再次检查，实际项目页菜单/数据又缺失，浏览器目录、项目与
图标请求出现 503；不能将先前短暂 200 解释为稳定解决。Runtime 两条 health
读取正常，日志中的服务令牌签发/策略读取密集，并伴随 Console 依赖超时。

本轮修正公开 Nuxt 资源和精确图标 JSON GET/HEAD 不再经过用户会话解析，避免
带 Cookie 的开发资源请求放大认证链；业务 API 和外层保护不变。Console 本地
令牌签发及 verified-policy 读取按单 HTTP event、完整参数/验证绑定合并未完成
请求，完成/失败后移除，未增加跨请求缓存、旧策略 fallback 或撤权宽限。

Console 全量 538 项、Console/Enterprise 类型检查、定向 lint 通过。浏览器刷新
已到 Wiztek SSO，需用户登录后继续页面和网络验收；当前只确认代码验证完成，
尚不能确认本轮修复已消除真实环境的全部 503 或性能问题。未部署云端或修改数据。

用户登录后补验：旧登录事务回调 400，从根入口新发起事务后成功进入 Enterprise，
再进入 `/aims/projects`，完整菜单、项目集及项目卡片最终可见。本次采样 auth/me、
permissions、navigation、directory、projects、portfolios、图标均 200，控制台
未记录新的 error/warn。CDP 响应头等待时间仍很长：导航约 12.9 秒、目录
18.2–19.2 秒、项目 35.6 秒、项目集 40.2 秒；后续两次导航 13.2/6.9 秒。
图标约 1 毫秒。故仅确认本次读取功能恢复，不能标记性能或长期稳定性通过；
认证/策略链整体耗时仍需继续收口，不能由返回 200 掩盖。

### 2026-09-22 UTC 项目页 401 与菜单缺失修正

确认两类接线错误：本地 Nitro 保留 `/console/` 前缀，通用认证中间件未按
服务端 app.baseURL 归一化，导致 userinfo 等自验处理器之前发生错误的通用
audience 校验；Host userinfo/JWKS 与 Console Runtime 会话查询又把依赖异常
误判为会话失效。现已恢复精确处理器边界，并将依赖不可用保持为失败关闭的
503，不再因此清除会话 Cookie；明确会话 401 仍按原规则失效。未增加业务
授权白名单，也未修改 Access、issuer、Runtime、数据库或云端部署。

Console 全量 529 项、Foundation 认证定向 35 项通过，Console/Enterprise
类型检查与定向 lint 通过。新增 29 项覆盖依赖状态分类及带前缀路径；这些
为隔离回归，不替代真实权限验收。

真实浏览器 `/aims/projects` 已显示完整左侧业务导航、项目集与存量项目卡片；
最新 navigation、projects、portfolios、directory 用户/分组/业务域和图标
请求均 200，随后六次导航刷新亦 200。恢复期间仍有短暂 503；Runtime 现场
审计显示近期令牌签发与会话查询成功，尚不足以定位所有偶发超时或前述堆增长。
本次确认功能恢复，不宣称容量、长期稳定性或 G1 完整验收通过。

### 2026-09-22 UTC 授权页 500：本机开发 worker 内存耗尽

用户报告 `/console/oauth/authorize` 返回脱敏 500。经现有受信 Gateway 身份对本机
Console 定向探测，实际错误为 `Worker terminated due to reaching memory limit:
JS heap out of memory`，栈位于 Node worker exit；PM2 外层仍 online，不能据此
判断 Nitro 请求 worker 健康。已安装 Nitro 的 worker 关闭路径记录错误并移除
worker，没有在该分支立即恢复请求服务。尚未定位导致堆增长的具体分配路径，
不能将本次恢复视为内存问题根治或容量验收通过。

仅通过拥有权校验的 CLI 重启 hzy0-console，未重启 Runtime、数据库或云端。
崩溃导致周期同步失败、旧信封过期；重启后一度正确失败关闭为 503。通过既有
签名调度合同补一次同步成功后，匿名有效授权请求恢复 302 到本地 OIDC 登录
入口；浏览器从根入口重新发起登录，token 交换 200 并回到 `/enterprise`，
企业工作台、当前账号与完整业务导航均可见。
未复用用户粘贴的旧 state，未延长策略有效期、关闭 Access 或改变认证信任。
后续容量收口须补 worker 健康探测、内存增长复现与有界恢复，不能只看 PM2 online。

### 2026-09-21 23:38 UTC 本机策略链切换与登录/读取通过

仅本机 Runtime 安装固定 `0.3.219-test.verified-policy.1`、独立策略表与 Enterprise
只读 grant/双 audience 映射；保留产品审计修复，不部署未完成 Codocs 改动。
Console `verified-runtime`、Host 独立读取 gate 与两分钟有签名唤醒已显式启用。
实际 Console/Enterprise 签发与读取通过；另一 audience 在固定本实例正确拒绝，
身份串用/Enterprise 写入拒绝。真实策略原信封重放不改变 ETag/acceptedAt。
浏览器正常 hzy0 入口已完成登录，企业工作台、左侧菜单与“我的文档”存量列表可见。

补充验证：23:42 UTC 已观察到同修订的新签名信封被周期同步接纳，未延长原信封
重放的接纳时间。修正 Console 在进程启动、无租户请求上下文时读取持久策略导致
的异常；本机热重启新增日志无该异常。四后端启动回归包含在 Console 全量 500 项
通过记录中，实际请求验签与租户隔离不变。

本轮修正实际发现的部署归属与双 audience seed 缺口；没有共享远端密钥、修改
Access/SSO/issuer 或发布其他云端应用。G1 仍待完整岗位、撤权、失败与回退矩阵，
文档编辑/协作验收不由本轮读取替代。下方历史“待切换/登录失败”已不代表当前状态。
详见[合同 §12](../../Console-Enterprise-Policy-Verification-Contract.md#12-本机固定-runtime-与正式策略链切换2026-09-21)。

### 2026-09-21 21:41 UTC 开发 Platform 最小发布完成（hzy0 未切换）

用户另行批准的 `hzy.wiztek.cn` 完整信封/issuer 更新已落地，仅重启
`hzy-platform-dev`；策略行和其他进程不变，生产及其他云端应用未发布。
定向 lint、类型检查、9 项测试、Node 构建通过；公网新格式 200/no-store，既定
公钥验签及 Console/Enterprise 双部署覆盖通过，旧格式 200，历史新格式 400。
本机 Runtime/新表/Enterprise read grant/同步调度尚未切换，登录与 G1 仍未验收。
后续按本机固定制品与正式同步链路推进，不再把“Platform 发布待批准”当作当前阻塞。
下文保留前置记录；固定制品、回退和探针差异见
[合同 §11](../../Console-Enterprise-Policy-Verification-Contract.md#11-获准开发-platform-最小发布2026-09-21)。

### 2026-09-21 hzy0 切换前置现场核验（未切换，控制面发布待批准）

本机 health/公钥 overlay/数据库只读事务已核验：Runtime 仍为 `7d42abd12f04-audit`，
新策略表未装、两个新开关关闭；Console 精确 read/write grant 存在，Enterprise
策略 read grant 不存在。两种 Runtime audience × read/write/组合，共 6 次正式
Console 签发 200。Platform 固定版本无生成兼容探针仍走旧查询，约 38.7 秒返回
旧 404，未命中新格式分支。故不能只改本地开关解除登录阻塞。

需要批准现有 Platform 的最小信封交付/issuer 配置更新，之后再安排本机受控切换；
不擅自发布云端，不复制签名私钥，不缩减校验或延长信封窗口。没有执行 DDL、seed、
运行配置改写、进程重启或部署。预检工具及本地栈 48 项测试通过，详细事实见
[合同 §10](../../Console-Enterprise-Policy-Verification-Contract.md#10-hzy0-切换前置现场核验2026-09-21未发布)。

### 2026-09-21 同步与 Console 消费接线（代码候选，未切换）

显式 `verified-runtime` 后端已串联完整信封请求、受认证 Runtime CAS、当前回执验证，
并阻止无策略版本的会话签发。已覆盖缺行/缺表区别、丢响应重试、并发胜出记录、
过期水位恢复、旧缓存隔离；定向 Node、类型检查、临时 MySQL/race 验证通过。
本地 runner 仍固定旧后端，未改 profile/数据库/grant/进程或云端；登录阻塞仍待现场
验收。下一项是 hzy0 切换前置核验及配置方案，不是直接启用所有开关。详见
[合同 §9](../../Console-Enterprise-Policy-Verification-Contract.md#9-同步与-console-消费者候选接线未切换运行环境)。

### 2026-09-21 Platform 新格式与 Host 读取候选（未启用）

Platform bundle 正式路由新增显式完整信封格式；Runtime 新增 Enterprise 自身
身份的只读投影；Host 导航增加默认关闭的当前策略/会话版本 gate。Node 定向
测试、临时 HTTP/MySQL/race、Platform/Enterprise 类型检查通过。真实 Platform
查询/签名、同步器、环境 grant 和登录尚未闭环；现有环境配置与数据均未改变。
read seed/verify 仅准备，不得据此开启 gate。详细条件见
[合同 §8](../../Console-Enterprise-Policy-Verification-Contract.md#8-platform-交付与-enterprise-只读路径候选接线未启用)。

### 2026-09-21 Runtime 策略持久化/API（真实隔离 MySQL 通过，hzy0 未切换）

新增默认关闭的 `GET/PUT /v1/console/verified-policy` 与独立迁移表，正式 JWT、
精确 capability、部署绑定和即时撤权检查均保留。MySQL 8.0.34 新旧两个 HTTP
集成测试及 race 检测通过，验证 CAS 并发、重放不续鲜、过期水位和恢复、撤权、
错误身份及配置/存储失败；Auth/Config/Console/Server/PolicyEnvelope 五包回归通过。
临时实例已清理；未更改 hzy0 数据库、进程、grant 或云端。尚缺 Platform 正式
交付及 Host 在线读取，登录阻塞仍未解除。详情见
[当前合同](../../Console-Enterprise-Policy-Verification-Contract.md#7-runtime-持久化与接口批次代码验证完成环境未启用)。

### 2026-09-21 完整策略信封代码内核（隔离验证，未接线）

当前未提交工作区新增 Platform 完整信封签发内核、共享/Go 验签、Runtime 接纳
规则与 Foundation Host 验证 helper。Node 9 项、Go 跨语言/篡改/重放/同修订冲突
测试及竞争检测通过，Platform/Enterprise 类型检查通过。未接入正式 Platform
交付路由、Runtime 持久表/CAS/API 或 Host 读取路径；未部署、同步策略或改 grant。
因此本地登录仍失败关闭，不能按代码测试宣布恢复。完整字段、边界与待验项见
[合同实现状态](../../Console-Enterprise-Policy-Verification-Contract.md#6-后续实现批次完整信封与接纳规则内核)。

### 2026-09-21 策略验证第 1 步（原因已证实，运行修复未启用）

真实只读探针：现有策略记录与版本存在，固定 tenant/environment/scope 匹配，
Platform 签名、公钥 kid、payload 哈希及既有密钥 HMAC 全部通过，本地密钥
HMAC 失败；探针时同步年龄约 1511 分钟，尚在已配置的 1560 分钟测试窗口内。
本次没有同步策略或延长有效期，后续会随时间自然失效。正常短期 read token
签发产生认证审计，无业务/策略数据写入。

已确认签名只覆盖 payload，外层版本/状态/到期/同步时间由旧 HMAC 保护；
Runtime 当前只存取 opaque 封包，不替读取方完成这层验证。新增 5 项篡改/
错 key/绑定/时效测试、24 项 Console 回归及 Go 两包 TestPolicy 通过。
修复合同见 [核查结果](../../Console-Enterprise-Policy-Verification-Contract.md)。
后续不建设 Gateway 验证通道，改为完整签名信封与 Runtime 当前状态合同，供
Enterprise 内 Console 模块验证消费；本轮未实现/发布新合同，登录仍失败关闭。
下文“尚需只读完整性通道”的历史描述不得理解为已批准 Gateway 长期承担此职责。

### 2026-09-21 本地 Console 门面实施（已启动，策略验证阻塞）

当前未提交工作区：已启用私有 profile 的 `local-canonical-facade`，增加独立
PM2 Console Dev 23100；Gateway/Enterprise 定向重启。canonical issuer、
签名密钥、Runtime 和数据库配置未变。公开认证路径精确登记，公开 token
端点禁止服务凭据；本地 Console 不持有远端 Gateway/Platform 长期凭据。

用户批准后，SSO `hzy_local_console` 追加两个精确 hzy0 `/console/api/auth/`
登录/退出回调。初次局部 PUT 导致 Keycloak 重置 `frontchannelLogout`，读回
差异检查已发现并受控恢复；最终回读除两项新增回调及数组顺序外无其他差异。
备份留在原服务器保护目录，后续脚本提交完整客户端表示以保留未修改字段。

环境证据：本地 discovery/JWKS/login-config 均 200，issuer 仍为原测试地址；
浏览器授权入口指向 hzy0。用户完成 Wiztek SSO 登录后，授权码交换成功，
Host auth/me 返回 200/authenticated=true，但 `policyVersion=null`；Host 的
正式会话范围校验拒绝进入并返回登录页，不能记作端到端接通。

代码核查：Runtime 持久化策略使用既有 Gateway 密钥校验 HMAC，而本地
Console 使用独立入口密钥，不能直接验证同一封包。尚需受控只读完整性验证
通道及实际错误分支证据；不得复制远端密钥、绕过校验或覆盖共享策略记录。
本地模式现已在缺策略时签发前返回 503，避免生成不完整的成功会话。

验证：本轮 24 项 Gateway/profile/门面/SSO 回归全部通过，Console typecheck
通过；之前 Foundation OIDC 20 项与 Enterprise typecheck 已通过。导航、
文档读取、完整登录返回及退出仍待策略通道收口，不据此放行 G1。未提交或部署云端。

#### 历史：实施前只读核查（下述未启用/待批准状态已被上文替代）

用户已要求核查并接通本地门面，目标是复用既有 canonical issuer、Runtime
签名/会话和业务授权，不再依赖云端 Console Worker 承接本地登录。
本次只读核查确认当前 profile 仍为 `existing-canonical-console`，没有运行
本机 Console（23100 无监听）；CLI/runner/PM2 尚未管理 Console。

接入前必须补齐的代码边界：Console `getOidcIssuer()` 目前优先采用受信
Gateway 的 forwarded host；直接挂到 hzy0 会改变 issuer，不能仅改 URL。
Foundation 服务端已支持部分 endpoint/issuer 分离，但浏览器 authorize/logout
仍由 issuer 拼接，Console discovery 也未分离协议入口。应显式登记本地门面
和固定 canonical identity，保留非本地模式行为及完整验签，禁止自动 fallback。
本机 Console 还需受控 Runtime bootstrap/策略包读取通道，不能把现有远端
Gateway 凭据直接注入 Console，或启用 bootstrap、策略旁路和重复后台任务。

上游 SSO 配置核验：获准测试 Registry 中的客户端是 `hzy_local_console`，
issuer 为 `https://sso.wiztek.cn/realms/wiztek`。对
`https://hzy0.isme.dev/console/api/auth/oidc-callback` 进行不携带用户凭据、
`prompt=none` 且带 S256 参数的授权入口探针，返回 HTTP 400 / 无效
`redirect_uri`。因此需要单独批准在此客户端追加精确登录回调；本地退出
回调计划为 `https://hzy0.isme.dev/console/api/auth/oidc-post-logout`，其登记
状态尚未核验。不能删除旧回调或增加通配符。

当前结论：核查完成，门面尚未接通，等待上游回调配置变更授权后继续实施。
没有修改 SSO/Cloudflare 配置、issuer、密钥、Runtime 或现有运行 profile；
未因本次核查重新启动任何进程，也未将门面列为已验收。

### 2026-09-21 本机 Dev 首屏性能专项（未提交工作区）

本轮只调整 hzy0 本地 Dev 依赖加载、开发资源浏览器缓存与 Host 导航消费。
真实 Chrome 根入口基线：HTML 约 2.5 秒，首个 auth/me 第 21.3 秒发起，
成功导航响应第 28.3 秒结束；963 个资源，传输约 7.30 MB。用户报告的
50 多秒未稳定复现，因此不将 50 秒作为本次量化对照。

最终同浏览器正常缓存根入口：HTML 1.10 秒，首个 auth/me 第 7.68 秒发起，
两个会话校验均 200，导航仅一次且 200，于第 14.79 秒结束；389 个资源，
传输约 1.99 MB。这是单次现场结果，公网传输及 Console 权限请求仍有波动，
不承诺固定首屏时间；两个既有会话校验仍保留，未改认证/刷新规则。

实施：本地 client 显式预构建 Vue runtime/UI/VueUse 等依赖，保留 Nuxt
alias；仅版本化 optimizer JS 可 private immutable 浏览器缓存，源码/虚拟
模块与全部 Dev CDN 缓存继续 no-store；只删除 `?macro=true` 路由元数据的
无关 SFC source map。实际文档元数据响应由 156577 字节降为 546 字节，
metadata 与 HMR 代码均保留。Host layout 的导航 lease 通过 provide/inject
供首页复用；原有身份失效、撤权、租约过期与迟到响应规则不变。

验证：Enterprise typecheck、31 项定向测试（导航组件/路由/租约、项目上下文、
Host page key、网关 HTTP/cache/WS、配置）、7 项本地入口 smoke 通过。
浏览器临时修改首页标题，确认 HMR 更新且 performance.timeOrigin 不变，
随后恢复原文并回读。继续进入文档时 Access 到期，实际显示邮箱登录页。
用户重新登录后，16:21–16:24 UTC 复测已显示个人文档树和完整业务侧栏；
选中文档、点击编辑期间再次出现“导航权限暂不可用”、图标加载警告，
并观察到首次加载编辑器依赖触发开发页重载及 Yjs 重复导入警告，不能据此
声称完整编辑/关闭链通过。随后正常刷新进入既有 Console
`https://hzy-test.huizhi.yun/oauth/authorize`，该认证依赖返回 Cloudflare
1101（Worker threw exception，16:23:39 UTC，Ray `a3ea6a6748132659`）。
当前阻塞不再表述为“等待用户 Access 登录”；文档编辑/关闭验收与依赖
重复导入排查仍待继续。同期 7 项本地入口 smoke 再次全部通过。
本轮未编辑或保存文档正文，未修改云端或 Access 策略，不据本专项放行 G1。

### 既有阶段结论

**当前批次：LET-01～04 本机 Dev 链及获准产品编辑验证。** 基线 GitLab `7d42abd1` / 公开镜像 `d85e3482`，本轮整改未提交。登录、菜单、项目和目录读取、受控首页及一次模板 HMR 已验证。27 项本地回归、1 项 Assets Host bridge 测试通过。用户确认 Runtime 构建基线后，编辑审计修复已部署为 `0.3.219-test.product-edit-audit.1`；完整 Go 测试、隔离 MySQL/race、启动探测、健康/身份拒绝通过。真实产品保存、丢响应同键重试、唯一回执与唯一审计、恢复原备注均已验证。G1 仍缺完整岗位/撤权、云端业务非回归/回退矩阵及固定组合制品证据。G2/G3 未实现，G4 未完成。

审查整改：R2 首页在 HTTP 与 SPA 均注册 `/enterprise`，品牌进入同一授权入口页；本机根和尾斜杠仅 GET/HEAD 302，非读取方法 405。R3 本阶段明确固定 gatewayInternal=23121，非默认端口在 profile 校验即拒绝。R1 开始按已核对 code/status 白名单保留正式错误协议；限定 64 KiB，固定文案、有限数值字段，Retry-After 限 0～3600 秒，入口仅允许已知 host-only 会话 Cookie 的空值 Max-Age=0 清理；出口不向 Host 注入远端 Cookie，未知错误继续脱敏。当前错误表只覆盖已登记读链/认证错误，不宣称未来写链全部错误已注册。

### 获准产品写链准备（2026-09-20）

**当前部署结果：** [制品与现场证据](../../../deploy/test-env/artifacts/C000001.product-edit-audit-deployment-20260920.json)。用户明确确认采用已提交 `7d42abd1` 加审计补丁，不包含未提交 Codocs 文件。构建完整 Go 测试发现旧 SQL mock 漏预期审计 INSERT，已同步该断言后全量通过；隔离 MySQL/race 亦通过。启动探测带齐原 LaunchAgent 六项环境，校验原 binary/hash 与测试身份，备份后原子替换，配置文件哈希保持。仅重启测试 Runtime，未改生产、数据库连接、Tunnel、密钥或 grants。

真实新版本验收：产品 53 初始为空备注，首次保存标记 `LET-G1 audited retry 2026-09-20` 已返回 200 后模拟 ConnectionClosed。数据库只读核验成功回执 `03d2dfca-1b56-4578-95b4-c9e2faa0e478` 与新增审计事件 82（updated，actor 匹配）；再次保存使用相同非空幂等键和相同正文返回 200，回执仍一份、事件仍 82。清除所有临时拦截，普通刷新回读标记，再经正常编辑入口清空保存，数据库确认空备注，恢复操作独立产生事件 83。以下“尚未部署”与缺审计记录为修复前历史，不代表当前状态。

最新重试证据：仅对本页 `Fetch` 类型、精确 `/assets/api/v1/products/53` 响应临时拦截，第一次 PATCH 已返回 200 后以 ConnectionClosed 模拟响应丢失；页面保留编辑内容，再点保存仍使用相同非空幂等键和相同 JSON payload，第二次 PATCH 200。随后清空拦截规则，正常刷新读到标记 `LET-G1 response-loss retry 2026-09-20`，再经正常编辑入口恢复空备注并确认“暂无备注”。匿名 PATCH 本机入口返回 401。未拦截 Document、其他产品、认证或权限请求。

实际测试库只读核验：验证固定 tenant/runtime、数据库名与 server UUID 后以 READ ONLY 事务查询产品 53 的回执。命令命名空间按既有代码使用 Assets deployment（不是物理 Host deployment）；本次幂等键对应唯一 `succeeded` 回执 `f6ea1f91-7302-4609-9776-3040de37971d`，首次与末次接收时间不同。原编辑路径没有写 asset_events，不能将唯一回执当成完整业务审计。

审计修正：`UpdateProductInTransaction` 在对象范围复核后、同一幂等业务事务内追加 `updated` 事件，固定对象和验证 actor，不存任意请求正文。新增真实临时 MySQL 用例先复现“编辑/重放没有恰好一条审计”失败；修复后 `TestEnterpriseAssetsProductsHTTPMySQL`（含 race）通过，验证重放一条事件/回执、actor/object 绑定、审计故障时业务及回执一起回滚。测试使用临时实例并已自动清理，没有在共享库安装故障 trigger。共享测试 Runtime 尚未更新，不能宣称真实审计缺口已关闭。

R1 写链错误表补入已核对的 `idempotency_payload_mismatch` / `assets_product_conflict`（409）及 `enterprise_assets_unavailable`（503），仍固定文案并剔除诊断字段；27 项本机与 1 项 Host bridge 回归通过。还观察到空闲后一次导航权限暂不可用，点击重新加载恢复；未据此推断撤权或放行长时间稳定性验收。

用户已允许测试环境业务数据修改，不再等待提供测试对象。仅增加本机出口 `audience=data-runtime`、`scope=assets:product:edit` 的精确例外；复用既有 active Console grant，不新增或扩展云端授权。正式 OAuth 签发、验签及状态核验通过，两个错误 audience/未知 scope 反例拒绝。该既有 capability 同时覆盖产品创建与关联，不能当作字段级授权；Runtime 用户与对象 permit、幂等、审计仍按正式合同执行。其余写 scope 继续拒绝。

26 项本机回归、7 项入口 smoke 通过，定向重启 hzy0 Gateway。真实浏览器以现有 zhouguangying 会话，从首页→全部产品→汇房智选（测试产品 id=53 / HF-FC-JY-S-001）→编辑，将空备注改为 `LET-G1 hzy0 产品编辑验证 2026-09-20（验证后恢复）`；保存后详情回读到测试值，再通过同一编辑入口清空保存，详情确认恢复“暂无备注”。未修改产品编码、授权或生产数据。1 项 Assets Host bridge 测试验证范围授权和幂等键转发通过。响应丢失重试与正式审计仍待核验，不能据正常保存及恢复放行 G1。

### 历史现场记录（以下按过程保留，不替代第 2、3 节当前状态）

2026-09-20 图标修复：Nuxt Icon 客户端使用 `/api/_nuxt_icon/lucide.json`，原本地 Gateway 正则只允许不带扩展名的 collection；先前 extensionless 200 不足以证明浏览器可用。已仅增加可选 `.json` 后缀，保留 GET 和其他路由限制，定向重启 Gateway。7 项传输测试通过，新增实际 `.json` 地址及 simple-icons 覆盖；6 项 smoke 均通过，图标项同时校验 menu/search SVG body。真实浏览器截图确认品牌、用户、导航、搜索、下拉、复选与视图图标恢复，抽查 DOM 图标 mask 均已加载；未改外部图标回退、权限或云端配置。

18:26 UTC 最终回读：恢复浏览器正常缓存后普通刷新，hzy0 项目页菜单、项目集和项目卡片正常，刷新以来控制台 error 为零；浏览器实际 `/api/directory/projects` 与 `/api/directory/business-domains` 均 200。`useHead()` 初始化错误已解除，临时 Network cacheDisabled 已恢复 false。本结论仅覆盖此次页面读取与缓存故障，不代表全部业务动作验收。

2026-09-20 开发模块缓存修复：进一步读取 Vite 实际转换结果，`@unhead/vue` 虽处于 Vue 3.5.40 peer 目录，实际 import 已统一为 Vue 3.5.31；不能仅凭目录名认定双版本执行。错误堆栈混用 `?v=938dd7e7` 与 `?v=3e5a3be9` 的开发模块。hzy0 Gateway 原样传递 immutable 缓存可能令旧转换结果跨 optimizer 重启继续使用。本次仅在 profile mode=dev 的 `/enterprise/_nuxt/**` 禁缓存并移除条件请求验证头，preview 不变；受保护错误处理、认证和路由范围不变。定向重启 Gateway 后，浏览器临时禁缓存并强制刷新恢复菜单及真实项目卡片，响应确认 `no-store` / CF DYNAMIC；随后恢复正常浏览器缓存继续普通刷新验证。21 项本机回归（含 dev/preview 缓存差异）及 5 项 smoke 通过；未升级依赖或修改 lockfile，未改云端。

17:39 UTC 页面复核结论：定向重启 hzy0 Enterprise 后，五项入口 smoke 仍通过，但浏览器 `useHead()` 初始化错误仍存在（堆栈同时出现 Vue 3.5.31 / 3.5.40 路径，依赖实例一致性待查）。本轮两项 grant 修复与正式目标 Service API 验证完成；hzy0 页面验收未通过，不以授权接口 200 替代。未运行依赖升级、全量重装、云端代码部署或 Git 提交。

2026-09-20 17:37 UTC 授权修复：用户明确批准后，受测试数据库名、server UUID、租户/部署和 active client/current credential 约束的 `enterprise-directory-grants.mjs` 核对两项均缺失，仅新增 `console:directory-project-access:read`（grant 8097783）和 `console:business-domain:view`（grant 8097784）。audience 均为 console，source deployment 为 C000001-test-enterprise。事务内确认其他 grants 不变，独立 verify 确认两项 active；未改凭据、生产或业务数据。回退应在授权管理中仅撤销上述两项精确 ID，不运行全量初始化或删除其他记录。

正式 `verify-enterprise-directory.mjs --execute` 于 17:37:52 UTC 验证两项 token 签发及目标 Service API 各 200；互换 capability 访问均 403，错误 data-runtime audience 均拒绝。Token 仅在内存、不输出或落盘。两项保护脚本测试及四项安装清单生成测试通过，实际安装模板 drift check 通过。Console manifest 补记已有服务能力，安装模板由 Foundation 实际调用及目标契约生成；未发布云端代码。浏览器刷新另遇 Nuxt 开发依赖 `useHead()` context 错误，正在独立恢复，不能把服务 API 成功等同于页面验收。

2026-09-20 目录读链接续：修正 Aims 项目范围对 Console 管理端部门 API 的调用，使用既有部门/用户归属 service projections；归属查询拒绝不再推断主部门。真实 hzy0 浏览器已显示项目卡片与项目集分组，以及项目管理→项目总览菜单，解除原“暂无项目”假象。项目筛选目录也已改为既有精确 `console:directory-project-access:read` 服务契约，环境结果继续单独核验。12 项 Foundation 目录测试、3 项 Aims 范围测试、20 项本机回归、5 项入口 smoke 通过；包含实际 helper 的部门管理后代/个人归属及 403 传播测试。仅重启本机进程，未修改 grants、云端配置、Runtime 或业务数据；业务域签发 403 尚未关闭，不能据项目列表恢复宣称完整业务验收通过。下方条目保留修复前过程记录。

17:20 UTC 浏览器复核：项目列表与分组保持显示；项目目录已从旧管理端 401 转为正式服务签发 403，业务域仍为正式签发 403。两个待核准精确 scope 为 `console:directory-project-access:read` 与 `console:business-domain:view`。尚未新增授权；列表主链恢复不代表这两个辅助目录已通过。

2026-09-20 凭据接通记录：用户明确批准使用现有测试 Gateway 凭据；本机 profile 的 `identity.credentialProviderRef` 已改为 `protected-file:test-gateway`。远端凭据只由 Gateway 从现有权限受限文件读取；Enterprise 经独立本地凭据访问 `127.0.0.1:23121`，转发固定测试 origin 与身份，拒绝重定向、未登记路径、非读取 service scopes、跨 client/tenant 覆盖。启动读取远端 Registry 摘要，不覆盖旧本地 Registry。显式固定 canonical token URL，防止按 hzy0 入口推导签发地址。仅重启两个 hzy0 进程，未改云端配置、grants、Runtime、数据库或业务数据。

证据：正式 OAuth 探针一项读取 scope 签发/验签通过，错误 audience 和未知 scope 两反例拒绝；实际回环通道签发只读 token 成功（未输出 token）。20 项本机回归及 5 项 Foundation transport/OIDC 测试通过。真实浏览器与仅记录路径/状态的服务端诊断确认用户会话、权限查询、Runtime 配置、人员目录 200。部门读取 `/api/v1/directory/departments` 与项目目录 `/api/v1/console/directory/projects` 仍 401；`console:business-domain:view` 的正式签发仍 403。菜单显示，项目列表尚不能取得数据；不得据“暂无项目”宣称业务通过。剩余目录接口迁移和精确 grant 调整分别处理，不采用 401 后弱化路径 fallback。

回退：将上述 profile 引用恢复为 `env:HZY0_GATEWAY_INTERNAL_TOKEN` 并定向重启 Gateway/Enterprise，即关闭 egress 与 Host 适配器；本地轮换凭据仍保留，远端秘密和云端配置没有变化。当前通道刻意不支持业务写 scope，不能宣称完整迁移或写链验收完成。

2026-09-20 身份决定：用户确认 hzy0 作为现有 C000001 测试 Enterprise 部署的获准副本，使用正式 `enterprise.runtime` 服务身份。此批准不延伸为把测试 Gateway 全局凭据注入本机 Host、直接解密 Vault 或修改 grants。`deploy/test-env/ENTERPRISE_CREDENTIAL.md` 记录服务凭据由 Console Vault 托管；旧 OAuth 探针采用测试 Gateway 身份，不能当作 hzy0 专用凭据提供器。尚缺获准的 hzy0 服务凭据引用/领取通道，未读取或导出上述秘密，未执行签发探针或变更外部配置。

2026-09-20 接线修正：本机 runner 补 `HZY_DATA_ACCESS_MODE=tenant-runtime`，Gateway 仅增加三条 Foundation 目录 GET 与图标 GET 路由（不开放根 /api 或写操作）。16 项整体本地回归通过，另新增 runner 模式断言通过；两个 hzy0 进程定向重启，沿用轮换后的凭据。真实本机图标接口 200；浏览器从正常登录入口重新登录成功，显示 C000001/test、当前账号及导航分区/项目总览入口，原空菜单已解除。

剩余阻塞：浏览器项目/项目集与目录请求仍有 502/401，不能把“暂无项目”当作真实空数据。未带 Gateway 身份的本机诊断请求明确返回服务客户端未配置；该诊断不等同于已登录请求的完整失败根因。现有 hzy0 Enterprise PM2 环境无服务客户端凭据变量，runner 也未实现独立服务凭据引用注入；本地 Gateway 凭据仅证明本地来源，不能自行假定被云端 Console 信任。下一步需冻结获准的本机服务身份提供方式（既有部署的获准凭据引用或独立登记方案），再验证真实签发及读链；未复制云端秘密、改 grants/Runtime/Access/业务数据。

2026-09-20 凭据轮换专项：用户批准仅同步轮换 hzy0 Gateway/Enterprise 内部网关凭据。核验两进程 cwd/runner/profile/mode 后，以系统随机源生成新值，仅经进程环境更新指定 PM2 应用并重启；回读确认两者新值一致且不同于旧值。未输出凭据、未写仓库或新增 PM2 dump，未修改云端、Runtime、Access 或业务数据。本机入口/登录页/匿名导航拒绝/内部路径拒绝/HMR 101 共五项 smoke 通过。该证据为进程配置替换及服务恢复，不是旧凭据真实业务请求拒绝矩阵，也不代表业务验收通过。下段“尚未执行轮换”为发现问题时的历史状态，现已完成本次授权轮换。

2026-09-20 登录后追加核验：用户完成 SSO 后返回 `/aims/projects`，页面显示账号及 C000001/test；首次页无响应，Chrome 报 RESULT_CODE_HUNG，结束该测试页并重载后恢复。菜单为空；目录三个请求 404、项目/项目集请求 503（`prepareTenantRuntime` 返回不可用）。未完成业务验收，也不再以“等待用户登录”描述当前阻塞。

安全修正：真实 Nuxt Dev 错误页回显了包含内部凭据的请求头。已在 hzy0 网关阻断所有上游 4xx/5xx 诊断正文与附加响应头，保留状态码并返回固定无敏感信息 JSON；5 项网关隔离测试通过（新增 400/401/403/404/503 泄露反例），仅重启 hzy0-gateway，本机实际 401 响应已确认脱敏。公网错误页重载被 Chrome 以 ERR_BLOCKED_BY_CLIENT 阻止，公网修正回读仍待补。未复制凭据到文件；既有 hzy0 内部凭据应按安全流程轮换，尚未执行轮换。后续优先检查正式 Runtime 配置与目录路由，保留认证及授权边界。

Copilot 已提供 profile/CLI/PM2/Gateway/runner、回调参数化、host-only Cookie 及 OIDC 登记脚本；实际 Dev 栈、Caddy 和公共 Access 入口已存在。原有 5 项测试通过，但主要是配置/源码检查，原记录未同步实施状态，不能据此放行 G1。

接手已修：PM2 同名进程的 cwd/runner/profile/mode 归属校验及脱敏状态输出；启动忽略 dotenv；未知/带凭据 origin、全局 PM2_HOME 拒绝；未实现 Node/回环模式失败关闭；OIDC 回调核验绑定准确 client；HTTP 原始流避免 fetch 解压/响应头不一致，补多 Cookie、取消与头清理；WS 握手保留 Upgrade/Connection 并校验 Origin；HMR 配置真正接入 Nuxt，固定 wss/443。

本机仅重启已核验的两个 `hzy0-*` 前端进程并沿用 PM2 既有凭据；随后按用户专项批准修改 hzy0 单条 Tunnel 回源，没有修改 Access/Caddy/共享 Runtime/数据库。OIDC 脚本只执行 `--verify`，没有重新登记或扩权。临时测试服务已关闭。

回源阻塞已解除：原日志在 16:17:35Z、16:19:44Z 证实 `http://localhost:19090` 连接被拒绝。用户明确批准后，通过 Cloudflare 控制台仅将 hzy-dev0（`cf31c2e6-87f6-40b0-aa42-460b886b826c`）的 hzy0.isme.dev 回源改为 `http://127.0.0.1:23180`；界面提示成功，路由列表回读新值。Access、其他 ingress 与 Runtime 未修改；回退为原 `http://localhost:19090`。既有 CLI 凭据只读 API 返回 403，未扩权。

Chrome 已实际显示公网 `/enterprise/login` 的“登录汇智云/使用企业账号登录”，点击后进入 Wiztek SSO 登录表单，不再为原 502。SSO 当前需要用户重新登录，尚未取得应用会话；不得将 Cloudflare 登录或 SSO 跳转算作正式应用登录通过。

之后验证 Enterprise 正式登录/服务身份/普通权限和一个获准业务任务；补浏览器 HMR；再实现独立 Node 制品及回退，不运行未固定来源的 `.output`。磁盘仅约 11 GiB 可用（`df`，本轮回读），构建前重新核验容量，不自动清理用户数据。原文档保存事务任务本轮暂停，已有修改保留。

## 1. 本次运行身份

| 字段 | 填写值 |
| --- | --- |
| 操作人 / 复核人 / 时间窗口 | Copilot 原实施；Codex 接手回读与修正；2026-09-20 |
| 源码 commit / dirty 状态 | `ddfd84a9` + 未提交改动；不是固定发布候选 |
| Dev 或 Node / preset | Nuxt Dev；Node 尚未实现，CLI 拒绝误启动 |
| profile/路由/权限目录 hash | 待填写 |
| publicOrigin / Host entry | `https://hzy0.isme.dev` / `/enterprise`（按最终批准核对） |
| Runtime canonical endpoint | `https://hzy-test-runtime.isme.dev` |
| Runtime dial endpoint / 网络命名空间 | 本机进程监听 `127.0.0.1:18084`，仅只读盘点；profile 仍使用 public-https，没有切换 dial |
| tenant/environment/runtimeCode/deployment | profile 回读 C000001/test/c000001-test-tenant-runtime；Host C000001-test-enterprise；Console wiztek-test-console，正式组合 token 探测待做 |
| canonical issuer / JWKS / client | profile 为 `https://hzy-test.huizhi.yun`、`/.well-known/jwks.json`、enterprise / enterprise.runtime；未改信任根；准确 client 的两条 hzy0 回调已只读验证 active |
| 本机是现有获准副本还是独立部署 | 用户已确认：现有 C000001 测试 Enterprise 部署的获准副本；服务凭据引用/领取通道仍待提供 |
| 云端与本机并行的 writer/scheduler 约束 | 待填写 |
| 两个域名是否共用 cloudflared / Caddy reload 影响 | hzy0 为既有 remotely managed cloudflared；Runtime 为独立本机配置 `cloudflared.yml`，ingress 仍为 `hzy-test-runtime.isme.dev` → `127.0.0.1:18084`；未 reload 任一 Tunnel/Caddy |
| 测试对象范围与数据清理方案 | 待批准 |
| 外层 Dev 资源访问保护 | 公网匿名入口要求 Cloudflare Access；用户登录及修正回源后可显示应用登录页。资产/WS 的公网未认证矩阵仍待测 |

## 2. 阶段结论

| 阶段 | 结果 | 证据 | 未完成 / 不适用原因 |
| --- | --- | --- | --- |
| G0 盘点与身份冻结 | 部分完成 | 本机监听/PM2/profile/OIDC、获准 Enterprise 副本及正式 service 身份已回读 | 写测试对象、维护窗口及完整资源盘点待冻结 |
| G1 本机 Dev | **已放行**（2026-09-23 用户批准） | 正式登录/目录/模板 HMR；产品保存、同键重试、唯一回执与审计、原备注恢复 | 岗位/撤权、云端业务非回归/回退及固定组合制品仍待验 |
| G2 Node 构建 | 未实现 | 原脚手架会覆盖共享构件且未传完整 profile，已失败关闭 | 需独立制品/版本摘要/模式切换与回退 |
| G3 回环传输 | 未实现 | 原校验允许 loopback 但网关仍使用公网，现明确拒绝 | 需受信 canonical/dial 分离及同一 Runtime 证明 |
| G4 日常默认使用 | 未执行 | | |

## 3. 验收记录

从主方案第 15 节逐项填写，不以本表空白项当作通过。

| 编号 | 结果（通过/失败/未执行/不适用） | 验证类型与测试主体 | 脱敏证据 / 失败原因 |
| --- | --- | --- | --- |
| LE-A01 | 通过 | 2026-09-23 Codex C1：真实 profile 的五种临时副本（未知字段、空服务身份、`environment=prod`、端口冲突、非默认 gatewayInternal）实跑 `up` 均在 PM2 前退出码 1 拒绝；`cli-isolation.test.mjs` 对每种变体覆盖 plan/doctor/up/restart/down/status，未触及真实 profile | — |
| LE-A02 | 通过 | 2026-09-23 Codex C1：合成旧 `.env.dev` 与 shell 中的 `DB_*`、主密钥名、四种 bypass=true，经真实 runner 子进程核对：`--dotenv /dev/null`、无 `DB_*`、无主密钥键、bypass 均为 false；无值输出或落盘 | — |
| LE-A03 | 通过 | 2026-09-23 Codex C1：实跑全栈 down→up→restart，四个 hzy0 进程恢复 online；Runtime LaunchAgent PID 60799、Caddy PID 46631、其他 PM2 进程前后不变；本机/公网 `/runtime/health` 200 且版本不变；策略同步恢复 `ready: true` | — |
| LE-A04 | 通过 | 2026-09-23 经真实本机入口（Caddy 23180，Host=hzy0.isme.dev）一次性伪造 tenant/app/deployment/environment、Gateway 标识与凭据、Runtime URL/令牌/回环拨号、`x-hzy-runtime-bootstrap-unavailable`、服务路由目录、Forwarded/X-Forwarded-*、scheduler 头：OIDC 发现与 login-config 与未伪造响应逐字节一致，issuer 保持 canonical；导航 401 不变；伪造 `enterprise.runtime` client_credentials 403；内部 sync/drain 404；期间 Runtime 无任何服务密钥断言。另有单测覆盖云端 Gateway 剥离新标注头；2026-09-23 登录会话（test，真实浏览器同源 fetch）：导航、`auth/me`、项目列表、项目集、目录用户、项目周报 6 个读取，普通请求与带全套伪造头（上述各项另加 `x-hzy-actor-uid`/`x-hzy-uid`/`x-hzy-subject-code=admin`、伪造策略版本与模拟角色头）的状态码与去除易变字段后的正文摘要逐一相同 | 不同租户正向会话未测（本机只有单租户） |
| LE-A05 | 通过 | 2026-09-23 Codex C2 `probe-exposure.mjs`（Claude 复跑退出 0）：Console 23100、Gateway 私有出口 23121、Enterprise 23110、Codocs 编辑器 23130、Runtime 18084 从公网与本机非回环地址均不可连，仅回环可连（设计如此）；internal/drain/devtools 路径公网为 Access 302，回环入口 404 | — |
| LE-A06 | 通过（匿名链） | 2026-09-23 Codex C2：公网静态资源与 HMR WS 均被 Access 302 拦截；回环静态资源可达，但 `/enterprise/api/navigation`、`/console/oauth/userinfo` 仍为 401，外层保护不替代应用登录 | 登录会话下的资源/WS 已在浏览器会话中间接使用正常；观察：Codocs 不存在的 `_nuxt` 资源在回环返回 200 HTML（SPA 回退） |
| LE-A07 | 通过（服务端链） | 2026-09-20 正式登录回调、userinfo、菜单；2026-09-22 访问令牌到期前主动续期、会话失效跳转登录；2026-09-23 经真实本机入口匿名负向：Enterprise 与 Console 回调缺参、伪造 state、state 与 Cookie 不符、`error=access_denied` 均 400 且不设会话 Cookie；登出 302 到 hzy0 Console 登出并以空值 + `Max-Age=0` 清除 22 个认证 Cookie，post-logout 回 `/login`；登录 `redirect` 为外站或 `//` 时归一为 `/`，站内路径保留，state/nonce/PKCE Cookie 均 HttpOnly | 多标签退出与浏览器端完整登出回环归入 LE-A10 / 联合会话 |
| LE-A08 | 通过 | 2026-09-23 只读：云端 `https://hzy-test.huizhi.yun/.well-known/openid-configuration` 与本机入口发现文档 issuer 相同（canonical `https://hzy-test.huizhi.yun`），JWKS 同一把 kid；本机发现文档的 `jwks_uri` 指向 hzy0 门面，云端未被改写；云端 `/console/login`、`/login`、`/aims/`、`/codocs/` 200 ；2026-09-23 同一浏览器经企业 SSO 静默登录云端 `hzy-test.huizhi.yun`，`/api/auth/permissions` 返回 test、合并模式、`pv_test_20260914161219_0014`（修订 14） | — |
| LE-A09 | 通过 | 2026-09-23 真实浏览器（test）角色矩阵：只读/员工/项目经理三种配置的菜单与服务端 403 均与授权一致，见“角色矩阵”一节 | “完全无 Aims 权限”经用户确认不适用；`project_manager` 无数据范围为产品配置事项 |
| LE-A10 | 通过 | 2026-09-22 故障宽限与拒绝失败关闭；2026-09-23 R1 稳态身份与签名停用信封立即生效（停用期间 Enterprise 失败关闭，服务密钥亦被拒），恢复后正常 ；2026-09-23 双标签：一处退出后另一标签数据接口立即 401，并自动转到 `/enterprise/login?redirect=/aims/projects`，不显示旧数据 2026-09-23 登录中撤销全部角色：服务端立即拒绝（旧令牌亦然）；策略版本变更后前端自动续期令牌并收缩菜单（修复后实测，见“角色矩阵”一节） | 观察：登出停在 SSO“注销”确认页，需再点一次才结束 SSO 会话 |
| LE-A11 | 通过 | 2026-09-23 Codex C2：注册表 68 页、270 个 API 与生成清单一致；338 条安全探测中页面 HEAD 68×200，API 为 400/401/404/503，无 API 返回 200 HTML；未注册路径 404；旧 Shell 仅 GET/HEAD（C5 后为 307） | 观察：140 个写方法仅做静态核对与 OPTIONS，其中 139 条 OPTIONS 为 503（同源应用无预检，不影响 G1；原因待查） |
| LE-A12 | 通过（hzy0 入口） | 2026-09-23 更正：旧书签的真实形态是 `/shell/{app}`（云端 Console 位于根路径），此前测的 `/console/shell/aims` 不是用户会持有的地址（hzy0 只开放 Console 认证页，Console 内部点击在 hzy0 不适用）。真实入口矩阵：`/shell/aims`、`/shell/aims/`、`/shell/AIMS?target=/aims/work-items` 顶层跳到 Host 已登记页；`target` 的 query 与 hash 保留，`hzy_embed`/`standalone` 被剥离、其他参数保留；`/shell/assets`→`/assets/products`，`/shell/codocs`→`/codocs/mydocs`；外站、`//`、API 路径、跨应用、未登记页面、无 Host 的应用（finance）均拒绝（404）；POST 405，HEAD 与 GET 一致；跳转后页面在真实浏览器中正常渲染（A13 同页） | hzy0 用 308 且 `no-store`，云端对 `/shell/` 用 307 `no-store`（试点可回退，不应声明永久）；应对齐为 307（`gateway-transport.mjs`，派 Codex）。拒绝时为裸文本 404 |
| LE-A13 | 通过 | 2026-09-23 真实浏览器（test）：取消“我的项目”→ URL `participatingOnly=false`；打开非成员项目 → 成员子页 → “返回项目总览”，筛选与分组展开状态恢复；侧栏与正文返回一致；非成员项目侧栏自动去掉工时/周报、无“创建工作项” | 观察：列表内容区滚动位置（600px）不恢复；成员页“查询”按钮加载图标常驻 |
| LE-A14 | 通过 | 2026-09-23 输入“汇房”后静置 150 秒（跨过 2 分钟导航权限刷新）：输入值、焦点、筛选、URL 与结果均不变 | — |
| LE-A15 | 通过 | 2026-09-23 390×844：侧栏收为 ☰，抽屉为 dialog“业务导航”，与桌面同一导航树并高亮当前项；Esc 关闭且焦点回到按钮；抽屉内点“任务中心”后抽屉关闭并跳转；恢复 1440 正常 | 观察：窄屏分组标题“智慧不动产（0 个项目）”换行不齐 |
| LE-A16 | 通过 | 2026-09-20 Host 模板一次；2026-09-23 真实浏览器（test）：领域组件 `aims/app/pages/work-items.vue` 文案与 Foundation `common/EmptyState.vue` 样式类各改一次再还原，均在 6～8 秒内生效和撤销，页面标记保持（非整页刷新）；源码已还原（git diff 为空） | Host 的抽屉按钮使用 Enterprise 自己的 `lg:hidden`，Foundation `app.config` 中 `sm:hidden` 不生效（覆盖关系需确认是否有意） |
| LE-A17 | 未执行 | | |
| LE-A18 | 未执行 | | |
| LE-A19 | 未执行 | | |
| LE-A20 | 基本链通过 | 2026-09-20 产品 53 真实保存、响应丢失后同键重试、唯一 succeeded 回执与唯一 `updated` 审计事件、经正常入口恢复（Runtime `product-edit-audit.1`，见“获准产品写链准备”）；2026-09-22 Codocs 个人文档保存修复后实测可保存 | 仅覆盖 Assets 产品编辑与 Codocs 保存；其他写链按各自合同另验 |
| LE-A21 | 未执行 | | |
| LE-A22 | 未执行 | | |
| LE-A23 | 部分通过 | 隔离 HTTP/WS | gzip 字节/多 Cookie/取消/WS 通过；大文件与 SSE 尚待验 |
| LE-A24 | 基本链通过 | 2026-09-23 核对：线上 Gateway 仅 `0 16 * * *` 一条 cron（仓库候选的 `*/2`、`*/5` 未上线），唤醒云端 Console（后端 `runtime`）每日约 16:01 UTC 写旧表 `/v1/console/policy-bundle`（09-17～09-22 各一次，09-21 无）；hzy0 Gateway 是 `verified-policy` 唯一写者，每分钟一轮，本日多次重启后同步均恢复 `ready`；本机 Console 关闭后台任务、生命周期 drain、心跳与启动刷新。两条链写不同表，无重复注册或消费 | 其他业务调度（Aims/Assets drain）不在本机运行，未单独实测 |
| LE-A25 | 基本链通过 | 2026-09-23 只读：云端已注册路由匿名 `/aims/api/v1/projects`、`/enterprise/api/navigation` 401，与本机一致（`/aims/api/projects` 503 是未注册路径的既定行为）；Gateway 启动时对 `__test/registry-digest` 的实时绑定校验在本日多次重启中均通过 ；2026-09-23 登录后云端导航 200，但 test 的 `/aims/api/v1/projects`、`/aims/api/v1/portfolios`、`/api/directory/users|projects|business-domains` 均 403“权限不足”，而 hzy0 同一用户同一修订 200 ；更正：浏览器会话期间 hzy0 实际使用意外修订 15（见“授权复核”），结论改为：hzy0 的项目列表符合 Aims 对象可见性，缺的是 Host 资源门槛（已修复）；云端 403 与 09-16 记录一致，属既有云端缺陷（云端 Enterprise 构建较旧），非本机工作引入的回退 | 云端 403 另行排查；hzy0 Host 在签发 Runtime permit 前未自行校验 `projects:view`，是否存在“无 Aims 权限仍可读”待角色矩阵“无角色”配置验证 |
| LE-A26 | 未执行 | | |
| LE-A27 | 未执行 | | |
| LE-A28 | 未执行 | | |

## 4. 回退准备

| 对象 | 当前状态引用 | 回退目标/操作 | 批准人 | 恢复验证 |
| --- | --- | --- | --- | --- |
| 本机代码与构件 | | | | |
| 本机 Runtime transport 配置 | | | | |
| hzy0 Tunnel 单条规则 | | | | |
| Caddy 站点块 | | | | |
| 本次新增客户端回调/授权 | | | | |

Runtime、数据库、runtime 域名不是本机前端 down 的操作对象。禁止用整库旧备份撤回前端操作产生的新业务事实。

## 5. 实际效率与容量

| 指标 | 旧 Workers 流程 | 本机 Dev | 本机 Node | 测量条件 |
| --- | --- | --- | --- | --- |
| 一次页面修改到可验证时间 | | | | |
| 登录/导航请求数量 | | | | |
| Host/Console/网关 RSS 与 CPU | | | | |
| 本机 Runtime/数据库受影响程度 | | | | |
| 同一正式查询延迟（公网/回环） | | | | |

## 6. 放行判断

G1（本机 Dev）放行：2026-09-23 Claude 起草，**用户已批准（2026-09-23）**。用户发布修订 23 后 hzy0 已加载，`test` 导航恢复为 23 项（含工时、周报）。

本次只批准：hzy0 本机 Dev 栈（Gateway、Enterprise dev、Codocs 编辑器、hzy0 Console 门面，连接本机 Runtime 与开发 Platform）作为 C000001 日常开发与测试入口；G1 范围 LE-A01～A16 与 A20/A24/A25 基本链均有证据（第 3 节）。不含 G2 Node 构建、G3 回环传输、G4 日常默认，不含任何云端或生产发布，不含 C4 发布。
仍依赖云端/独立组件：开发 Platform（`gitlab.wiztek.cn`，库已迁到服务器本机容器）签发策略与服务密钥；本机 Runtime（LaunchAgent）；Cloudflare Access 与企业 SSO；云端 Gateway 每日旧表同步。
未完成项和风险：①项目页正文“查看项目工时/周报”快捷按钮未按权限过滤（仅 UI，服务端已拒绝）；②写方法 OPTIONS 503（同源无预检，观察）；③`project_manager` 无数据范围、全租户生效（产品决定）；④云端 `test` 403 为既有云端缺陷，`checkPermission` 修复待云端发布；⑤生产 Platform 同样连远端 `oa.wiztek.cn`（另行决定）；⑥A04 未测跨租户正向会话；⑦LE-A17～19、21～23、26～28 不属 G1，保持未执行。
是否影响任何既有数据、任务或权限：开发 Platform 的 `test` 角色分配在矩阵后已恢复到基线快照，用户已发布修订 23，hzy0 已回到原角色；意外修订 15 已被取代；开发 Platform 库迁移已逐表校验和一致，远端旧库冻结作回退；无业务数据写入（A20 的产品保存已按原值恢复）。
是否需要继续观察或回退：观察策略变更后的令牌自动续期与导航 2 分钟刷新；远端旧库保留至确认无需回退；本机专用 Chrome 测试窗口在收尾时关闭并删除临时 profile。

不要附上 token、Cookie、数据库密码、完整环境 dump、原始业务正文或未脱敏 storageState。
