# Aims 独立进程下线方案

> 只读现场盘点日期：2026-10-07，现场比对代码基线：`66400997f`。范围修订已 rebase 至集成 `4f7b43ad`；现场记录不视为再次环境核验。本次未停服、未修改环境、未执行数据库或 grant 写入。下文执行步骤仅为候选方案，不构成执行授权。

## 1. 结论与用户裁定

**现在不能直接下线 Aims 进程。** 大部分用户页面已由 Enterprise Host 承接，但生产 Gateway 仍将 Aims 列为可靠命令的签名唤醒目标；Aims 进程执行跨模块网络投递、死信通知、到期通知和周期里程碑续期编排。Runtime 中 `read/write/scheduler=unified` 表示数据所有权和代次约束已统一，不等于网络执行器已迁入 Enterprise。

必须先完成：迁移签名 wake 和保留的三类可靠命令执行器；停止六类已舍弃 operation 的生产并按原键收尾存量；核对仍直连 Aims 的模块服务调用；迁移启动时审批动作同步；完成旧通知/回调兼容的闭环；让 hzy0 启动工具真正支持不启动 Aims；在 hzy0 停 Aims 验证后再批准生产停用。不能只删除 Gateway drain.apps 中的 aims，也不能把 scheduler 关闭来制造“无依赖”。

用户裁定（2026-10-07）：旧管理员入口的**强制修改项目状态、任意状态彻底删除项目不迁移**。下线时随旧入口移除，旧命令须失败关闭；生命周期仍走审批。项目集删除与受约束的草稿项目删除不能与这两项混同，不因本裁定自动删除。旧 `PATCH/DELETE /api/v1/admin/projects/:id` 文件及其 Runtime 代理仍在源码中；Host 未登记这两个 method，生产 scheduler-only 不提供。后续退役需确保任何遗留接收通道不会重新暴露，不能仅移除按钮。

### 1.1 可靠命令范围裁定（2026-10-07）

APF 已整合进统一企业应用，跨域协同按 ADR-018a D11 改为进程内机制。停止产生以下六类 Aims operation，不迁移其执行器：

- `aims.finance.product-cost.rules.replace.v1`
- `aims.altoc.product-feedback.update-progress.v1`
- `aims.altoc.product-feedback.update-status.v1`
- `aims.work-item.ticket-result.v1`
- `aims.milestone.receivable-billable.v1`
- `aims.people-contributions.replace-scope.v1`

仅原样迁移 `aims.work-item.completion.workflow-submit.v1`、`aims.codocs.product-document.create.v1`、`aims.company-weekly-summary.codocs-publish.v1`。同时迁移 due notifications、milestones rollover、dead-letter notification、approval action-defs 同步。原键、冻结 payload、receipt 和 CAS 语义不变。

停止新增在先，存量聚合在后：逐类读取 pending/processing/locked/retry/dead-letter 及租约，在旧执行器仍可安全运行的窗口按原键完成、明确失败或人工批准收口；不能删除记录、换键、把非终态直接标成功，不能让 Host 新执行器消费已舍弃类别。2026-10-07 的生产瞬时空队列不替代切换当时核对。

## 2. 运行环境只读回读

| 环境 | Aims | Enterprise / Gateway | 观察结果 |
| --- | --- | --- | --- |
| 生产 `100.64.72.59` | `hzy-aims` active；`/home/hzy/apps/aims/current` → `s4-rc27`；监听 `127.0.0.1:31004` | Enterprise 监听 31002；实际 Gateway unit 为 `hzy-tenant-gateway` | Aims env 为 `HZY_AIMS_SCHEDULER_ONLY=true`、`HZY_APP_RUN_MODE=prod`、`HZY_AIMS_DATA_ACCESS_MODE=tenant-runtime` |
| hzy0 | `hzy0-aims` online；profile 监听 `127.0.0.1:23141` | Enterprise 23110、Workflow 23140；Gateway online | PM2 中 Aims/Enterprise/Workflow/Codocs 的工作目录观察为 `hzy-notify-prefix-66400997`，Gateway 为 `hzy-console-sync-7352e88e`；不假定全部同 SHA |

生产实时核对：Gateway `/etc/hzy-gateway/gateway.json` 中 aims origin 为 `http://127.0.0.1:31004`、deployment 为 `C000001-aims`；drain enabled，apps 为 console/workflow/aims。Runtime 的 Aims 域 read/write/scheduler 均为 unified，ownerDeployment 为 `C000001-prod-enterprise`。Enterprise、Workflow、Codocs 的 service origin 目录仍保留 aims → 31004。

生产应用在本次观察期间有已授权热更新；Enterprise 观察到 `enterprise-share-8ae458f9`。上述为分时观察，不是整个栈的一次原子快照。

hzy0 profile 已开启 workflowLocal 和 Collab 两项开关；未声明 `aimsRetired` 及三项 legacy 关闭标志。未修改 profile、PM2、Runtime 或 Collab。

证据边界：生产 SSH 仅读取 unit、选定 env 字段、配置结构和监听信息，未输出凭据。数据库使用既有 `hzy_ro_audit`、临时 SSH 隧道和 `START TRANSACTION READ ONLY`，仅读取表结构与状态聚合，结束 ROLLBACK、关闭连接与自建隧道。首轮隧道尚未就绪导致 ECONNREFUSED；等待就绪后读取成功，没有换账号或写数据。

生产统一库的瞬时聚合：`aims_integration_operation` 为 0 行，attempt 与 dead-letter actionable 均为 0，`aims_service_command_receipt` 有 1 条 succeeded。这只证明观察时队列为空，**不证明未来没有新命令，也不证明旧 scope 使用为零**。Console integration_operation 有 415 succeeded、4 dead_letter，未读取业务内容，不能将其归为 Aims 或作为 Aims 退役阻塞事实。只读账号授权库不含独立 Workflow owning 库，本次没有读取其 callback/outbox，也未绕过授权。私有证据位于主仓 `.git/aims-retirement-evidence/`，不纳入提交。

## 3. 页面入口与兼容边界

Host 的事实源是 `aims/layer/entry.mjs`，本基线有 **69 个页面注册记录（包含布局壳）**。Aims 源页面有 **116 个 Vue 文件**。附录 A 列出所有源页面是否原文件复用，附录 B 列出所有 Host 注册及实际组合文件。源文件没有直接复用不等于缺功能：管理员页、项目文档、项目编辑等由 enterprise-* 页面替代；反之同名路由不证明全部动作等价。

| 页面族 / 旧入口 | Host 替代与结论 | 仍需处理 |
| --- | --- | --- |
| `/projects`、项目概览、计划、工作项、看板、工时、周报、风险、度量、成员、版本、需求、产出 | Host `/aims/projects/**` 原生组合，BFF + Runtime；保留路由前缀并不保留 Aims 进程 | 用普通成员/项目经理实测所有按钮；未注册页不能继续落到 Aims |
| 项目设置 / 新建 / 项目集 | Host 项目编辑、新建与项目集树已承接；仓库 list/link/unlink、生命周期申请走新合同 | 不恢复强制状态或任意彻底删除；不承诺旧仓库创建等未迁动作 |
| `/admin/projects` | Host `/aims/admin/projects` 已有项目集树、编辑、成员、登记等受约束操作 | 两项旧强制动作已舍弃；其余差异按页面按钮逐项验收 |
| 产品与产品空间下功能、规划、需求、版本、模型、视图 | entry 已注册的页面通过 Host 组合；附录 B 为精确清单 | 附录 A 的未复用文件逐项判定别名/替代/不再提供，禁止泛化重定向掩盖 404 |
| `/work-items`、`/timesheet`、`/weekly-reports`、公司周报 | Host 已有对应入口 | 验证周提交、审核、公司周报投递及调度；页面成功不等于后台投递成功 |
| 项目文档总览与单项目文档 | Host 原生组合；服务实现由 `aims/layer/server/index.ts` 导出并打包进 Enterprise | 保留项目 ACL、文档写入/内容/文件/来源的精确路径；不能因 import Aims 源码误判为 HTTP 依赖 |
| Aims 首页、独立设置、管理员模板/产品等其他源页 | 不能仅按页面文件认为生产还在使用；生产 scheduler-only 已拒绝此类请求 | 按附录清单核查导航及旧书签；有替代的精确重定向，无替代的明确退役说明 |
| 项目成员独立详情 `/projects/:id/members/:uid` | entry 明列 deferred：源应用没有稳定独立成员详情接口 | 不创建虚假等价页；使用已存在成员列表与目录详情 |

生产 `00-scheduler-only.ts` 在所有非精确 POST wake 请求上返回 404。因此生产旧独立页面/普通 API **源码存在但当前模式不提供**，不能把 313 个处理器全部当作生产可达路由。hzy0 是否具有相同编译/运行守卫必须在停服候选中单独核对；PM2 env 没出现该字段不能推断为 true。

## 4. API 与服务调用清单

本基线 Aims 自有 `server/api` 有 **313 个处理器文件**；Host 注册 **252 条 `/aims/` API**。附录 C 列出全部源处理器与同 method/path 的 Host 注册比对。此比对只用于定位，不能代替权限、响应形状和幂等合同验证。除此之外，`tenant-runtime.ts` 在 middleware 内拦截虚拟服务路径，Foundation 还继承 auth、directory、notifications、heartbeat、runtime 等处理器；只扫描文件会漏掉它们。

### 4.1 `/api/v1/service/**` 完整服务族

下表路径相对 `/api/v1/service`；动态段保持精确模板。Runtime 有领域实现也不意味着停掉 Aims 后原 HTTP 接收地址仍可用。

| method / 路径 | 调用方 / 权限事实 | 替代与最小迁移 |
| --- | --- | --- |
| GET `/products/:productCode/version-summaries`、GET `/products/:productCode/versions` | Assets；分别 `aims:product-version-summary:read` / `aims:read` | Assets 源服务还解析 aimsBaseUrl。迁到 Host 精确服务入口或既有 Runtime 服务操作，保持签名、来源、租户、部署限制 |
| GET/POST `/projects/:projectCode/environments`；POST `/projects/:projectCode/environments/:environmentCode:status/:assets-sync/:remove`（三个独立后缀）；GET `/environments/:environmentCode/projects` | Assets/Altoc/Finance/Aims 的读写白名单；aims:read/write | 逐路径核查现有调用，不能用宽 service 代理替代 |
| GET `/projects/:projectCode/cost-summary`；POST 同路径 `:recalculate` | Finance/People；aims:read/write | 新项目成本已在 Runtime；旧服务入口需显式迁移或退役，不把 Finance 的 appCode=aims Runtime 调用当作 Aims HTTP |
| POST `/projects/from-contract`、`/projects/from-opportunity` | Altoc；aims:write / aims:project:create-from-opportunity | 新 Host Altoc 固定操作与旧 activation executor 分别核查；保留原键和 receipt，禁止重复创建项目 |
| GET `/projects/eligible-for-contract`、`/projects/by-contract/:contractCode` | Altoc/Aims；aims:read | 旧 Altoc 服务处理器仍可能直连 Aims；需显式 Host/Runtime 替代 |
| GET `/project-management-facts` | People；aims:project-management-facts:read | 当前 People 工时收集代码使用 Runtime，并非 Aims HTTP；原服务消费者仍须核对 |
| GET `/tasks` | Orca/WebDev 等服务消费者；aims:tasks:read | 2026-10-07 Console 只读核查 hzy0/生产均无 active 持有者，按用户裁定退役：旧 Aims、Host 拒绝边界及 Runtime 返回 410；不新增 Host tuple |
| POST `/projects/:projectCode/payment-milestones:sync` | Altoc/Aims；aims:write | 迁 exact 命令，沿用幂等键；保留里程碑审批与财务边界 |
| POST `/projects/:projectCode/people-contributions:freeze`；POST `/projects/:projectCode/milestones/:milestoneId:rollover`；POST `/milestones:rollover-due` | Aims；aims:write | Runtime 已有固定操作；仍须迁移 wake 编排与调用身份 |
| POST `/product-requests/from-feedback` | Altoc 产品反馈签名服务入口 | middleware 单独处理；核对新 Host 固定操作和回执路径，禁止漏算 |
| POST `/service-tickets/:ticketCode/work-item/receive` | Altoc；aims:service-ticket:work-item:create | Runtime 有受控接收；旧 Altoc receive 服务调用需迁移 |
| POST `/workflow/callback`、`/work-item-completion/workflow-callback` | Workflow；workflow:callback | 当前 callbackTarget 已映射 Enterprise；Host 精确 `/enterprise/api/v1/service/...` 已注册。保持 app_code=aims 和业务元组，不改成宽通配 |
| POST `/notification-details/authorize`、`/notification-details/authorize/finalize` | Console；旧 aims:notification-details:authorize | Console 当前把 aims/assets/enterprise 来源映射 audience=enterprise、scope=enterprise:notification-detail:authorize；Host 两阶段入口已存在。旧来源事实不能直接删 |
| POST `/enterprise/project-document-access/execute`、`/project-document-writes/execute` | 签名项目文档命令 | owning 实现在 Aims layer server 中已可打包进 Host；必须迁精确服务入口/调用 catalog，不靠源码导出假定 HTTP 兼容 |
| POST `/enterprise/project-documents/read`、`/project-document-files/read`、`/project-document-sources/read`、`/accessible-project-documents/read` | 签名项目文档读取 | 同上；内容、文件、来源、访问策略分别保留范围检查，不能把项目许可升级为 Codocs 全局许可 |

环境变更三个后缀的准确完整模板为 `.../:environmentCode:status`、`.../:environmentCode:assets-sync`、`.../:environmentCode:remove`；不得按表中的排版合成一个多段路径。

### 4.2 调用方核查

| 调用方 | 已查代码 / 实际责任 | 进程依赖判定 |
| --- | --- | --- |
| Gateway | `wakeTenantApp`、self-hosted gateway config/server；live drain.apps 含 aims | **明确依赖 Aims wake**，首要阻塞 |
| Enterprise | Aims layer owning helpers、Host BFF 和 Runtime channels；共享源码直接 import | 打包依赖不等于进程依赖；service catalog 仍含 Aims，需审核 residual HTTP callers |
| Workflow | `callbackTarget.ts`、`dataRuntime.ts` 精确 target/deliveryPath；当前 Aims 回调到 Enterprise | 当前映射已有替代；历史 outbox 原键恢复及所有 callback path 仍需现场聚合/反例测试 |
| Console | `notificationDetailContract.ts`、`notificationDetails.ts` 两阶段来源授权 | 当前授权目标 Enterprise；保留旧 aims 来源消息事实与新鲜权限校验 |
| Codocs | `projectDocumentAccessService.ts`、`serviceAuthPolicy.ts` 接收 Aims/Enterprise 服务身份 | 多数方向是 Aims → Codocs；停止进程不能顺带撤销执行器仍需要的 aims.runtime 来源。Legacy 关闭须在替代执行器验证后进行 |
| Assets | `products/[id]/versions.get.ts` 直接请求 Aims version-summaries | **源码存在直接 HTTP 依赖**；生产是否有流量未证实，必须迁移或明确退役该旧入口 |
| Altoc | eligible-aims-projects、service-ticket receive、contractActivationOperation、productFeedbackTransport | **旧 HTTP 服务路径仍存在**；与新 Host Runtime 路径分开核对，按原键收尾 |
| Finance | `project-accounting/aims-projects`、`sync-people-costs` 调用 maybeCallTenantRuntime | appCode=aims 表示 Runtime 域，不是独立进程；保留 Runtime binding，不可一起删除 |
| People | performance-cycle collect 的项目/工时读取调用 maybeCallTenantRuntime | 同上；project-management-facts 服务合同消费者另核 |
| Orca/WebDev/其他外部集成 | `/service/tasks` 等已注册合同 | `aims:tasks:read` 2026-10-07 hzy0/生产 active 持有者均为 0，按裁定退役；不以页面流量推断服务合同 |

### 4.3 Foundation 继承入口

Aims 继承 `foundation/server/api/**` 的认证回调/退出/权限、Directory 用户/部门/项目、通知读取/授权、heartbeat 和 Runtime 反馈读取。Host 有 `/enterprise/api/auth/**`、`/enterprise/api/foundation/**` 等替代，但 cookie base、OIDC callback URI、旧书签/通知链接必须逐项核对。生产 scheduler-only 在进入这些继承处理器前已拒绝请求；停止时不要注销整套 aims 业务 app/Runtime deploymentBinding，进程与领域身份是不同对象。

## 5. 后台任务与启动行为

| 入口 | 当前行为 | Host / Runtime 替代及缺口 |
| --- | --- | --- |
| POST `/api/internal/integration-operations/drain`，兼容 `/aims/api/internal/integration-operations/drain` | scheduler-only 唯一允许入口；requireTenantGatewaySchedulerRequest(event,'aims')；bounded claim、fencing、checkpoint | Host 仅发现 APF scheduler-inspect，**不是** Aims 网络 drain 等价物。需精确迁移 signed wake 与 IO executor |
| Nitro `*/5 * * * *` integration-operations:drain | 可靠命令执行，预算限制 | 迁后只能有一个执行所有者，保留 scheduler generation，不能并行启动两套 cron |
| Nitro `*/15 * * * *` notifications:due | 到期通知，统一所有者模式有跳过/签名 wake 路径 | 保留 feature flag、分页预算、投递幂等和死信；需验证提醒仍到达 |
| Nitro `15 2 * * *` milestones:rollover | 周期里程碑续期；统一 wake 也执行并识别 Runtime 自有 owner | 不得让停服漏掉周期或让两种 owner 双跑 |
| `sync-approval-actions.ts` 启动后延迟同步 | 对 Workflow action-defs/sync 写入，除非云构建或 HZY_SYNC_APPROVAL_ACTIONS_ON_STARTUP=false | 改成显式、可审计发布动作或 Host 注册机制；本次不启动来试验，也未写 Workflow |
| `local-workflow-console-egress.ts` | 本机 Workflow/Console egress 兼容初始化 | 核对生成白名单/可信目录是否已独立承接；避免停 Aims 意外失去启动 patch |

`claimedAimsOperationExecutor.ts` 当前仍登记九类 operationCode；下表按裁定分流（代码尚未变更）：

| operationCode | 退役处理 |
| --- | --- |
| `aims.work-item.completion.workflow-submit.v1` | 原样迁移到 Host |
| `aims.finance.product-cost.rules.replace.v1` | 停产、存量收尾，不迁执行器 |
| `aims.altoc.product-feedback.update-progress.v1` | 停产、存量收尾，不迁执行器 |
| `aims.altoc.product-feedback.update-status.v1` | 停产、存量收尾，不迁执行器 |
| `aims.codocs.product-document.create.v1` | 原样迁移到 Host |
| `aims.work-item.ticket-result.v1` | 停产、存量收尾，不迁执行器 |
| `aims.milestone.receivable-billable.v1` | 停产、存量收尾，不迁执行器 |
| `aims.people-contributions.replace-scope.v1` | 停产、存量收尾，不迁执行器 |
| `aims.company-weekly-summary.codocs-publish.v1` | 原样迁移到 Host |

另外同一 drain 包含 integration dead-letter notification、统一里程碑 rollover、due notification。这些不在上述 operationCode switch 中，但也属于退役验收范围。

## 6. 配置与凭据依赖

| 配置类 | 当前责任 | 退役处理 |
| --- | --- | --- |
| Aims 服务客户端与 Console token endpoint | HZY_AIMS_SERVICE_CLIENT_ID/SECRET、Console API/token URL；本次只读取键名 | 不输出或复制秘密；先明确替代执行器物理身份和精确 grant，必要变更另批。禁止将 aims.runtime 与业务域一并删除 |
| Runtime endpoint/tenant/deployment、signed wake secret、scheduler generation | 校验租户/环境/绑定及代次、执行限额 | 保留领域 binding 和统一库，替代进程沿现有精确合同取身份；不能绕过 verified snapshot/exchange |
| Workflow/Codocs origin 与目标 deployment | 审批创建、文档投递 | 更新精确 trusted catalog；保留 app_code 与业务元组，不改宽前缀，不新建审批实例恢复旧请求 |
| Gateway aims origin/service binding/drain.apps | 生产 31004 仍为 wake 目标 | 先支持目标 Enterprise 的精确 wake，再移除旧物理 origin；保留 /aims Host 页面路由 |
| hzy0 workflowLocal / aimsRetired / legacy flags | config 有 aimsRetired 校验，要求 allowLegacyAimsCallbacks、allowLegacyNotificationDetails、codocsLegacyAimsServiceEnabled 明确 false | 启动器仍有 workflowLocal → 启动/doctor Aims 的逻辑，单改 flag 不足。先修启动/doctor/健康/smoke 与 profile schema |
| Aims unit/PM2 启动定义、监听和登录回调 | standalone process 生命周期 | hzy0 先停单进程，生产再 disable；保留受保护可恢复定义，不停 Runtime 或全部应用 |

## 7. 最小迁移批次与批准边界

| 批次 | 最小交付 | 完成条件 |
| --- | --- | --- |
| R1 后台执行器 | 在 Enterprise 原生 owning 层复用现有 Aims drain/IO，登记精确 signed wake，Gateway dispatch 定向；保留 sourceApp、代次、claim fencing、receipt | 三类保留执行器与通知/续期全套正反例；Runtime 固定操作不扩大；Host 目标身份/grant 有变化先报告批准 |
| R2 服务合同 | 按 4.1 逐条处理旧直连；迁移精确来源/audience/cap/target，或有证据后明确退役 | 缺 cap、错 source/aud/tenant/env/deployment、过期、写重放均拒绝；旧请求原键续行，不双写 |
| R3 兼容收尾 | 验证历史 callback/通知来源、行动定义同步；有替代后关闭三项 legacy 标志 | 原 outbox 续投成功，旧 scope 观察为零；角色权限不被隐式放宽 |
| R4 进程退役工具 | hzy0 与 self-hosted 启动器/doctor/smoke/健康去除物理 Aims 要求，保持 Aims 业务路由 | 独立进程不启动仍通过全量员工/经理路径和可靠命令验证 |

首轮盘点只交付方案。现已获准开始 R1 代码实施，但 Host 目标身份/grant 改变须先报告；hzy0 停 Aims 验证和生产停用仍须另行安排。不得借退役写数据库、改迁移数据、重签策略或撤销 grant；确有需要时逐项申请。用户已舍弃的两项旧管理员动作无需新增 Runtime 合同或 manifest 权限。


### 7.1 R1 开始前的身份/grant 影响报告

2026-10-07 协调者已审定以下身份/grant 口径，R1 按该口径实现。seed/verify 仅交付候选；未操作任何环境。

| 位置 | 现有闭集 | Host 接管所需差异 |
| --- | --- | --- |
| Foundation `UNIFIED_SCHEDULER_ROUTES`、`maybeCallTenantRuntime` | Aims 三组 route 要求 appCode=aims、serviceClientId=aims.runtime、签名 Aims wake | 新 Host 精确 wake：区分 owning domain=aims 与 physical executor=enterprise；只接受 enterprise.runtime、已登记 Host deployment 和新精确 wakePath，不放宽成任意 client |
| Runtime `enterprise_scheduler_context.go` | App 同时是 owning domain/worker source，WorkerClient 必须 `<App>.runtime` | 分离领域 binding 与执行身份；Host 来源只接受 enterprise/enterprise.runtime 和 Enterprise binding，保留原 Aims domain generation/registry 锁；旧来源在明确过渡选择下保留，不允许两个所有者同时消费 |
| Runtime 三项能力 | `aims:integration_operation:execute`、`aims:milestone-rollover:execute`、`aims:notifications-due:execute` | 建议能力名不变，给 enterprise.runtime 增加精确 Runtime audience grants，双 audience 按实际运行合同列 seed/verify 候选；不能用 aims:scheduler:execute 总包替代 |
| Workflow / Codocs / Console 出站 | 部分 executor 硬编码 aims/aims.runtime 和旧 deployment | 物理来源 enterprise/enterprise.runtime；业务 source_app=aims、operation/key/schema 不变。复用已有 P1 精确配对策略，逐项核对 scope 是否已登记/已授权，不重复或泛化 grant |
| approval action-defs 同步 | Aims client 请求 `workflow:action_defs:sync` | Host 显式发布/同步用 Enterprise 服务身份；先确认已有 grant 覆盖，无则只交付候选并另批执行 |
| Gateway | 逻辑 Aims wake 指向 Aims 物理 origin | 精确 Host wakePath 与 Host target deployment 进入签名；保留领域 aims、storage/generation，旧 worker 在切换后不能继续领取 |

建议保持三项能力分离，不新增人员权限、不扩大 manifest 的 admin 蕴含，也不让 Host 使用 Aims secret。grant 变化仅为候选文件交付，环境安装/签发/停服另批。现有 P1 `aims:scheduler:execute` 用于回调，不能证明已经授权以上三项能力。协调者已批准代码与候选交付；生产 grant 写入仍待另行批准。

R1 测试矩阵：正确 Host signed wake；缺签名/错物理 target/path/tenant/environment/deployment/来源/能力/过期；只持有回调能力拒绝；代次变化停止；单一 owner 防旧 wake；claim fencing、原键 receipt、部分成功恢复；三类保留投递正反例；六类停产不进入新 executor；due/rollover/dead-letter/action-defs 同步及配置关闭行为。Runtime 隔离 MySQL 验证代次锁和 CAS，不能用静态文本计数代替。

## 8. hzy0 先停验证（2026-10-07 已批准，R2–R4 回归后执行）

1. 冻结已审 R1–R4 同一 SHA，完整回归与隔离 MySQL；备份 PM2 定义、profile、Runtime config/plist、Gateway 路由/白名单，私有加密并验证可恢复。保留 Collab、迁移、opening、真实 Vault、grant 和 scheduler 原有业务开关。
2. 先在**不停止 Aims**时切换新精确 wake target 和服务调用，确认同一代次/同一 owner，不启动第二套无栅栏执行器；对原键命令做读回核对。
3. 读取聚合：各 Aims integration_operation/receipt/outbox 在途、租约、失败状态；历史 Workflow callback；旧物理 Aims 路径与 scope 的使用。未知/未收尾不能算零；长周期动作需合成数据补测。
4. 停止**仅 hzy0-aims**，不停止 Runtime、不重启其他进程以掩盖错误。观察旧端口无监听，新 wake 成功；全部其他健康、Gateway、Collab 双人协作和动态模块正常。
5. 普通员工/成员/经理/管理员在 1440/390 验证项目/项目集/文档/成员/工时审核/周期计划/审批回调/通知详情。对三类保留执行器使用隔离或明确批准的合成业务意图；迁移真实数据只读。
6. 验证旧管理员强制状态/彻底删除入口不可达，旧服务身份不能通过新的宽路径调用；其余旧书签按精确重定向或友好退役处理。
7. 连续观察包含调度周期并记录 bounded drain 结果、无重复 receipt/无跨租户领取、dead-letter、重连和撤权行为。用户确认后才把进程从启动清单移除；运行一次 doctor/重启演练证明不会复活。

失败立即恢复受保护定义与旧物理 wake 目录/对应配置，按同一 scheduler generation 和原键续行；新旧执行器不得并跑。**不回退统一库/迁移数据，不重建实例，不 SQL 改状态**。若 owner/代次已变，走既有批准的 binding 迁移流程，不手改 generation。

## 9. 生产停用与回滚（待另行授权执行）

前置：hzy0 全部验证和观察完成；生产逐路径用量已回读；管理员裁定已落实；仍需保留的旧域服务已迁完；冻结 Linux 构建产物/hash，同 SHA prepare/动态模块/可信 catalog/verified policy/grant 核对。

1. 单列生产批准动作：备份 unit/env/Gateway/Runtime 配置；发布新 Enterprise/Gateway 执行器；改变精确 wake 目标；停止 hzy-aims；观察通过后 disable 旧 unit。涉及策略/grant/overlay 的动作另列，不借本方案授权执行。
2. 备份受保护配置和原应用发布 symlink，不输出凭据；如不写库，无需用数据库回退来停止进程。生产遗留在途事实只聚合读取。
3. 新 Enterprise 执行器就绪后切换精确 target，确认签名/绑定/代次，不同时消费。停止 hzy-aims 后逐个验证 Enterprise、Console、Workflow、Codocs、Gateway、Runtime、Collab；Gateway 最后做外部端到端核验。
4. 验证员工原书签 /aims 仍由 Host 响应，文档分享/协作、项目 ACL、审批回调及所有后台投递可用。删除的是物理 Aims 进程，不是 Aims manifest 或 Runtime 数据域。
5. **停机影响**：仅停 Aims 本应只影响尚未迁移的后台 wake/旧独立入口；若操作需要停止 Runtime，会连带 Gateway 与全部应用，必须另批完整停机窗口，不能作为本任务隐含动作。
6. 回滚触发：新 wake/授权/claim/回执异常、后台积压、业务功能退化、Collab 或共享受影响。恢复先前 Enterprise/Gateway 配置与 Aims unit/二进制，逐个确认服务，Gateway 最后验证；回滚保留新业务数据，原键恢复，禁止新建重复外部效果。

## 10. 验证矩阵与未取到的现场证据

| 类别 | 必须覆盖 |
| --- | --- |
| signed wake | 正确签名/代次；缺签名、错 app/tenant/env/deployment、过期、重放、旧代次拒绝；bounded 预算 |
| 可靠命令 | 三类保留 operationCode（另覆盖六类停产与存量收尾）；timeout/部分成功/进程退出恢复；CAS/fencing/receipt；死信；原键不重复 |
| 回调与通知 | Aims 业务元组仍精确闭集；旧/新 deliveryPath；撤权后拒绝；Console 两阶段 source authorization |
| 用户页面 | 无显式角色/普通成员/经理/管理员；403/404 友好；隐藏他人项目；1440/390；所有按钮不是 SPA 或未注册 API |
| 文档 | 内容/文件/来源/协作；只读/共享写/撤权；目录选择；Collab 会话不因 Aims 停服丢失 |
| 退役工具 | 启动/doctor/restart 不再要求 Aims；保留 /aims Host 前缀；旧强制动作明确移除 |

本次完成代码/配置/监听只读盘点和注册表比对；未执行停服验收、未做真实登录操作、已取得 Aims 统一表瞬时聚合，未取得独立 Workflow outbox 与旧 scope 流量聚合。不能将这些写成通过。文档提交不改变运行行为。

## 附录 A：全部源页面文件与原文件复用比对

“无直接复用”需结合第 3 节的替代页判定，不代表生产可达或必迁。

| 源页面 | Host 原文件复用路径 |
| --- | --- |
| `app/pages/admin/index.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/admin/products.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/admin/project-templates.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/admin/projects.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/admin/weekly-reporting-settings.vue` | `/aims/admin/weekly-reporting-settings` |
| `app/pages/board.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/embed/project/[bizId].vue` | 无直接复用；见替代/退役核对 |
| `app/pages/help/pivr.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/index.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/integration-operations.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/login.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/portfolios/[id].vue` | 无直接复用；见替代/退役核对 |
| `app/pages/product-setup.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/adoption.vue` | `/aims/products/:productCode/adoption` |
| `app/pages/products/[productCode]/components.vue` | `/aims/products/:productCode/components` |
| `app/pages/products/[productCode]/cost-rules.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cost.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cycles/[cycleId]/add-item.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cycles/[cycleId]/budget.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cycles/[cycleId]/capacity.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cycles/[cycleId]/close.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cycles/[cycleId]/edit.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cycles/[cycleId]/items/[itemId]/assess.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cycles/[cycleId]/items/[itemId]/assessments.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cycles/[cycleId]/items/[itemId]/commit.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cycles/[cycleId]/items/[itemId]/consumption.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cycles/[cycleId]/items/[itemId]/move.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cycles/[cycleId]/items/[itemId]/select.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cycles/[cycleId]/items/[itemId]/withdraw.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cycles/[cycleId]/items/index.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cycles/[cycleId]/matrix.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cycles/[cycleId]/model.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cycles/[cycleId]/observations/[observationId]/correct.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cycles/[cycleId]/observations/index.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cycles/[cycleId]/observe.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cycles/[cycleId]/open.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cycles/[cycleId]/review.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cycles/[cycleId]/roadmap.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cycles/index.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/cycles/new.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/documents.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/execution-coordination.vue` | `/aims/products/:productCode/execution-coordination` |
| `app/pages/products/[productCode]/feature-version-matrix.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/features/[featureId]/index.vue` | `/aims/products/:productCode/features/:featureId` |
| `app/pages/products/[productCode]/features/[featureId]/lifecycle.vue` | `/aims/products/:productCode/features/:featureId/lifecycle` |
| `app/pages/products/[productCode]/features/[featureId]/requests.vue` | `/aims/products/:productCode/features/:featureId/requests` |
| `app/pages/products/[productCode]/features/[featureId]/roadmap.vue` | `/aims/products/:productCode/features/:featureId/roadmap` |
| `app/pages/products/[productCode]/features/index.vue` | `/aims/products/:productCode/features` |
| `app/pages/products/[productCode]/index.vue` | `/aims/products/:productCode` |
| `app/pages/products/[productCode]/models/index.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/models/new.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/models/rice-new.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/objectives/[objectiveId].vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/objectives/index.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/objectives/new.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/planning-items/[itemId]/commitments.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/planning-items/[itemId]/dependencies.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/planning-items/[itemId]/feature.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/planning-items/[itemId]/handoff.vue` | `/aims/products/:productCode/planning-items/:itemId/handoff` |
| `app/pages/products/[productCode]/planning-items/[itemId]/index.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/planning-items/[itemId]/reach-new.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/planning-items/[itemId]/reach.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/planning-items/[itemId]/roadmap.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/planning-items/[itemId]/version.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/planning.vue` | `/aims/products/:productCode/planning` |
| `app/pages/products/[productCode]/release-comparison.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/requests.vue` | `/aims/products/:productCode/requests` |
| `app/pages/products/[productCode]/settings.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/structure.vue` | `/aims/products/:productCode/structure` |
| `app/pages/products/[productCode]/versions/[versionId]/acceptance.vue` | `/aims/products/:productCode/versions/:versionId/acceptance` |
| `app/pages/products/[productCode]/versions/[versionId]/acceptances/[acceptanceId].vue` | `/aims/products/:productCode/versions/:versionId/acceptances/:acceptanceId` |
| `app/pages/products/[productCode]/versions/[versionId]/acceptances/index.vue` | `/aims/products/:productCode/versions/:versionId/acceptances` |
| `app/pages/products/[productCode]/versions/[versionId]/features.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode]/versions/[versionId]/index.vue` | `/aims/products/:productCode/versions/:versionId` |
| `app/pages/products/[productCode]/versions/[versionId]/plan.vue` | `/aims/products/:productCode/versions/:versionId/plan` |
| `app/pages/products/[productCode]/versions/[versionId]/releases/[recordId].vue` | `/aims/products/:productCode/versions/:versionId/releases/:recordId` |
| `app/pages/products/[productCode]/versions/[versionId]/releases/index.vue` | `/aims/products/:productCode/versions/:versionId/releases` |
| `app/pages/products/[productCode]/versions/[versionId].vue` | `/aims/products/:productCode/versions/:versionId` |
| `app/pages/products/[productCode]/versions/index.vue` | `/aims/products/:productCode/versions` |
| `app/pages/products/[productCode]/views/index.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/products/[productCode].vue` | `/aims/products/:productCode` |
| `app/pages/products/index.vue` | `/aims/products` |
| `app/pages/products.vue` | `/aims/products` |
| `app/pages/project-documents.vue` | `/aims/project-documents` |
| `app/pages/project-resources.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/projects/[id]/board/[workItemId]/execution.vue` | `/aims/projects/:id/board/:workItemId/execution` |
| `app/pages/projects/[id]/board.vue` | `/aims/projects/:id/board` |
| `app/pages/projects/[id]/documents.vue` | `/aims/projects/:id/documents` |
| `app/pages/projects/[id]/environments.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/projects/[id]/index.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/projects/[id]/members.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/projects/[id]/metrics.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/projects/[id]/milestones/[milestoneId].vue` | 无直接复用；见替代/退役核对 |
| `app/pages/projects/[id]/output.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/projects/[id]/plan.vue` | `/aims/projects/:id/plan` |
| `app/pages/projects/[id]/releases.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/projects/[id]/requirements/index.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/projects/[id]/requirements.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/projects/[id]/risks.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/projects/[id]/service-desk.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/projects/[id]/settings.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/projects/[id]/timesheet.vue` | `/aims/projects/:id/timesheet` |
| `app/pages/projects/[id]/weekly-reports.vue` | `/aims/projects/:id/weekly-reports` |
| `app/pages/projects/[id]/work-items/[workItemId]/append.vue` | `/aims/projects/:id/work-items/:workItemId/append` |
| `app/pages/projects/[id]/work-items/[workItemId]/breakdown.vue` | `/aims/projects/:id/work-items/:workItemId/breakdown` |
| `app/pages/projects/[id]/work-items/[workItemId]/decompose.vue` | `/aims/projects/:id/work-items/:workItemId/decompose` |
| `app/pages/projects/[id]/work-items.vue` | `/aims/projects/:id/work-items` |
| `app/pages/projects/index.vue` | `/aims/projects` |
| `app/pages/projects/new.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/quality-reviews.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/reports.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/requirements/batch/[batchId].vue` | 无直接复用；见替代/退役核对 |
| `app/pages/settings/profile.vue` | 无直接复用；见替代/退役核对 |
| `app/pages/timesheet.vue` | `/aims/timesheet` |
| `app/pages/weekly-reports.vue` | `/aims/weekly-reports` |
| `app/pages/work-items.vue` | `/aims/work-items` |

## 附录 B：全部 Host 页面注册

| Host 路径 | 组合源文件 |
| --- | --- |
| `/aims/products` | `aims/app/pages/products.vue` |
| `/aims/products` | `aims/app/pages/products/index.vue` |
| `/aims/products/:productCode` | `aims/app/pages/products/[productCode].vue` |
| `/aims/products/:productCode` | `aims/app/pages/products/[productCode]/index.vue` |
| `/aims/products/:productCode/structure` | `aims/app/pages/products/[productCode]/structure.vue` |
| `/aims/products/:productCode/features` | `aims/app/pages/products/[productCode]/features/index.vue` |
| `/aims/products/:productCode/components` | `aims/app/pages/products/[productCode]/components.vue` |
| `/aims/products/:productCode/adoption` | `aims/app/pages/products/[productCode]/adoption.vue` |
| `/aims/products/:productCode/documents` | `aims/layer/pages/enterprise-product-documents.vue` |
| `/aims/products/:productCode/cycles` | `aims/layer/pages/enterprise-product-cycles.vue` |
| `/aims/products/:productCode/features/:featureId` | `aims/app/pages/products/[productCode]/features/[featureId]/index.vue` |
| `/aims/products/:productCode/features/:featureId/requests` | `aims/app/pages/products/[productCode]/features/[featureId]/requests.vue` |
| `/aims/products/:productCode/features/:featureId/lifecycle` | `aims/app/pages/products/[productCode]/features/[featureId]/lifecycle.vue` |
| `/aims/products/:productCode/features/:featureId/roadmap` | `aims/app/pages/products/[productCode]/features/[featureId]/roadmap.vue` |
| `/aims/products/:productCode/requests` | `aims/app/pages/products/[productCode]/requests.vue` |
| `/aims/products/:productCode/planning-items/:itemId/handoff` | `aims/app/pages/products/[productCode]/planning-items/[itemId]/handoff.vue` |
| `/aims/products/:productCode/execution-coordination` | `aims/app/pages/products/[productCode]/execution-coordination.vue` |
| `/aims/products/:productCode/planning` | `aims/app/pages/products/[productCode]/planning.vue` |
| `/aims/products/:productCode/versions` | `aims/app/pages/products/[productCode]/versions/index.vue` |
| `/aims/products/:productCode/versions/:versionId` | `aims/app/pages/products/[productCode]/versions/[versionId].vue` |
| `/aims/products/:productCode/versions/:versionId` | `aims/app/pages/products/[productCode]/versions/[versionId]/index.vue` |
| `/aims/products/:productCode/versions/:versionId/acceptance` | `aims/app/pages/products/[productCode]/versions/[versionId]/acceptance.vue` |
| `/aims/products/:productCode/versions/:versionId/acceptances` | `aims/app/pages/products/[productCode]/versions/[versionId]/acceptances/index.vue` |
| `/aims/products/:productCode/versions/:versionId/acceptances/:acceptanceId` | `aims/app/pages/products/[productCode]/versions/[versionId]/acceptances/[acceptanceId].vue` |
| `/aims/products/:productCode/versions/:versionId/releases` | `aims/app/pages/products/[productCode]/versions/[versionId]/releases/index.vue` |
| `/aims/products/:productCode/versions/:versionId/releases/:recordId` | `aims/app/pages/products/[productCode]/versions/[versionId]/releases/[recordId].vue` |
| `/aims/products/:productCode/versions/:versionId/plan` | `aims/app/pages/products/[productCode]/versions/[versionId]/plan.vue` |
| `/aims/products/:productCode/versions/:versionId/features` | `aims/layer/pages/enterprise-product-version-features.vue` |
| `/aims/projects` | `aims/app/pages/projects/index.vue` |
| `/aims/portfolios/:id` | `aims/layer/pages/enterprise-portfolio-detail.vue` |
| `/aims/portfolios/:id/documents/:docId` | `aims/layer/pages/enterprise-portfolio-document-open.vue` |
| `/aims/project-documents` | `aims/app/pages/project-documents.vue` |
| `/aims/admin/projects` | `aims/layer/pages/enterprise-admin-projects.vue` |
| `/aims/admin/projects/:id/edit` | `aims/layer/pages/enterprise-admin-project-edit.vue` |
| `/aims/portfolios/new` | `aims/layer/pages/enterprise-portfolio-new.vue` |
| `/aims/admin/weekly-reporting-settings` | `aims/app/pages/admin/weekly-reporting-settings.vue` |
| `/aims/projects/new` | `aims/layer/pages/enterprise-project-new.vue` |
| `/aims/projects/:id` | `aims/layer/pages/enterprise-project-detail.vue` |
| `/aims/projects/:id/edit` | `aims/layer/pages/enterprise-project-edit.vue` |
| `/aims/projects/:projectId/work-items/new` | `aims/layer/pages/enterprise-work-item-form.vue` |
| `/aims/work-items/:id/edit` | `aims/layer/pages/enterprise-work-item-form.vue` |
| `/aims/work-items/:id/association` | `aims/layer/pages/enterprise-work-item-association.vue` |
| `/aims/projects/:id/timesheet` | `aims/app/pages/projects/[id]/timesheet.vue` |
| `/aims/projects/:id/timesheet/:entryId` | `aims/layer/pages/enterprise-project-time-entry-detail.vue` |
| `/aims/projects/:id/weekly-reports` | `aims/app/pages/projects/[id]/weekly-reports.vue` |
| `/aims/projects/:id/weekly-reports/:periodKey` | `aims/layer/pages/enterprise-project-weekly-report-detail.vue` |
| `/aims/projects/:id/members` | `aims/layer/pages/enterprise-project-members.vue` |
| `/aims/projects/:id/documents` | `aims/app/pages/projects/[id]/documents.vue` |
| `/aims/projects/:id/documents/:documentId` | `aims/layer/pages/enterprise-project-document-detail.vue` |
| `/aims/projects/:id/documents/:documentId/open` | `aims/layer/pages/enterprise-project-document-open.vue` |
| `/aims/projects/:id/requirements` | `aims/layer/pages/enterprise-project-requirements.vue` |
| `/aims/projects/:id/requirements/:requirementId` | `aims/layer/pages/enterprise-project-requirement-detail.vue` |
| `/aims/projects/:id/metrics` | `aims/layer/pages/enterprise-project-metrics.vue` |
| `/aims/projects/:id/risks` | `aims/layer/pages/enterprise-project-risks.vue` |
| `/aims/projects/:id/output` | `aims/layer/pages/enterprise-project-output.vue` |
| `/aims/projects/:id/output/:deliverableId` | `aims/layer/pages/enterprise-project-output-detail.vue` |
| `/aims/projects/:id/releases` | `aims/layer/pages/enterprise-project-releases.vue` |
| `/aims/projects/:id/releases/:releaseId` | `aims/layer/pages/enterprise-project-release-detail.vue` |
| `/aims/projects/:id/plan` | `aims/app/pages/projects/[id]/plan.vue` |
| `/aims/projects/:id/board` | `aims/app/pages/projects/[id]/board.vue` |
| `/aims/projects/:id/board/:workItemId/execution` | `aims/app/pages/projects/[id]/board/[workItemId]/execution.vue` |
| `/aims/timesheet` | `aims/app/pages/timesheet.vue` |
| `/aims/weekly-reports` | `aims/app/pages/weekly-reports.vue` |
| `/aims/projects/:id/work-items` | `aims/app/pages/projects/[id]/work-items.vue` |
| `/aims/projects/:id/work-items/:workItemId/append` | `aims/app/pages/projects/[id]/work-items/[workItemId]/append.vue` |
| `/aims/projects/:id/work-items/:workItemId/breakdown` | `aims/app/pages/projects/[id]/work-items/[workItemId]/breakdown.vue` |
| `/aims/projects/:id/work-items/:workItemId/decompose` | `aims/app/pages/projects/[id]/work-items/[workItemId]/decompose.vue` |
| `/aims/work-items` | `aims/app/pages/work-items.vue` |
| `/aims/work-items/:id` | `aims/layer/pages/enterprise-work-item-detail.vue` |

## 附录 C：全部自有 API 处理器与 Host 同路径登记

以下路径相对 Aims app 的 `/api`，旧 app base 通常为 `/aims`。同路径登记只表示 Host 有 exact method/path，并非合同自动等价。动态参数名按位置归一化；middleware 虚拟服务见 4.1；Foundation 继承见 4.3。

| method | 源 API 路径 | Host 同路径登记 |
| --- | --- | --- |
| GET | `/api/account/accessible-departments` | 有；仍需合同核验 |
| GET | `/api/account/business-domains` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/account/config-check` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/account/departments` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/account/projects/doc/:projectCode` | 有；仍需合同核验 |
| GET | `/api/account/projects/docs-tree/:projectCode` | 有；仍需合同核验 |
| GET | `/api/account/projects` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/account/projects` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/account/user-departments` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/account/users/:uid/projects` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/account/users/:uid` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/account/users/batch` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/account/users` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/auth/permissions` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/auth/wecom-callback` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/auth/wecom-login` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/internal/integration-operations/drain` | 无；替代路径/退役/虚拟合同需单独核对 |
| ANY | `/api/oss/ali-oss.d` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/admin/products/:productCode/versions` | 无；替代路径/退役/虚拟合同需单独核对 |
| DELETE | `/api/v1/admin/projects/:id` | 无；替代路径/退役/虚拟合同需单独核对 |
| PATCH | `/api/v1/admin/projects/:id` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/admin/projects/batch-create-routine` | 有；仍需合同核验 |
| GET | `/api/v1/admin/projects` | 有；仍需合同核验 |
| ANY | `/api/v1/aims/:...path` | 无；替代路径/退役/虚拟合同需单独核对 |
| PUT | `/api/v1/approvals/:id` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/approvals` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/approvals` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/authorization/instance-conflict-explain` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/codocs/department-documents` | 有；仍需合同核验 |
| GET | `/api/v1/codocs/documents/:uuid/content` | 有；仍需合同核验 |
| POST | `/api/v1/codocs/documents/:uuid/preview-access` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/codocs/documents/:uuid/section` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/codocs/documents/:uuid/summary` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/codocs/project-documents` | 有；仍需合同核验 |
| POST | `/api/v1/company-weekly-summaries/:summaryCommand` | 有；仍需合同核验 |
| POST | `/api/v1/deliverables/:deliverableId/submissions` | 无；替代路径/退役/虚拟合同需单独核对 |
| DELETE | `/api/v1/deliverables/:id` | 有；仍需合同核验 |
| PUT | `/api/v1/deliverables/:id` | 有；仍需合同核验 |
| POST | `/api/v1/deliverables/batch` | 有；仍需合同核验 |
| GET | `/api/v1/deliverables` | 有；仍需合同核验 |
| DELETE | `/api/v1/documents/:id` | 有；仍需合同核验 |
| PUT | `/api/v1/documents/:id` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/documents` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/documents` | 有；仍需合同核验 |
| DELETE | `/api/v1/favorites` | 有；仍需合同核验 |
| GET | `/api/v1/favorites` | 有；仍需合同核验 |
| POST | `/api/v1/favorites` | 有；仍需合同核验 |
| GET | `/api/v1/integration-operations/:operationId/attempts` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/integration-operations/:operationId/replay` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/integration-operations` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/milestone-completion-requests/:requestId/bind-workflow` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/milestones/:id/completion-requests` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/milestones/:id/detail` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/milestones/:id/review-approve` | 无；替代路径/退役/虚拟合同需单独核对 |
| DELETE | `/api/v1/milestones/:id` | 有；仍需合同核验 |
| GET | `/api/v1/milestones/:id` | 无；替代路径/退役/虚拟合同需单独核对 |
| PUT | `/api/v1/milestones/:id` | 有；仍需合同核验 |
| GET | `/api/v1/my-board` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/my-work-items` | 有；仍需合同核验 |
| DELETE | `/api/v1/portfolios/:id` | 有；仍需合同核验 |
| GET | `/api/v1/portfolios/:id` | 无；替代路径/退役/虚拟合同需单独核对 |
| PUT | `/api/v1/portfolios/:id` | 有；仍需合同核验 |
| GET | `/api/v1/portfolios` | 有；仍需合同核验 |
| POST | `/api/v1/portfolios` | 有；仍需合同核验 |
| GET | `/api/v1/product-assets` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/product-candidates` | 有；仍需合同核验 |
| GET | `/api/v1/product-permissions` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/archive` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/components/:componentId/edit` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/components/:componentId/move` | 有；仍需合同核验 |
| DELETE | `/api/v1/products/:productCode/components/:componentId` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/components` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/components` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/components/permissions` | 有；仍需合同核验 |
| ANY | `/api/v1/products/:productCode/cross-dependencies/:...crossPath` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/features/:featureId/component` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/features/:featureId/lifecycle` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/features/:featureId/requests` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/features/:featureId/requests` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/features/:featureId/roadmap` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/features/:featureId/unscheduled` | 有；仍需合同核验 |
| DELETE | `/api/v1/products/:productCode/features/:featureId` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/features/:featureId` | 有；仍需合同核验 |
| PATCH | `/api/v1/products/:productCode/features/:featureId` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/features` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/features` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/features/permissions` | 有；仍需合同核验 |
| DELETE | `/api/v1/products/:productCode/members/:memberId` | 无；替代路径/退役/虚拟合同需单独核对 |
| PATCH | `/api/v1/products/:productCode/members/:memberId` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/products/:productCode/members` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/members` | 无；替代路径/退役/虚拟合同需单独核对 |
| ANY | `/api/v1/products/:productCode/objectives/:...objectivePath` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/products/:productCode/objectives` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/objectives` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/products/:productCode/permissions` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/planning-cycles/:cycleId/budget-preview` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/planning-cycles/:cycleId/budget` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/products/:productCode/planning-cycles/:cycleId/capacity` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/planning-cycles/:cycleId/close` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/products/:productCode/planning-cycles/:cycleId/items/:itemId/assessments` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/planning-cycles/:cycleId/items/:itemId/assessments` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/products/:productCode/planning-cycles/:cycleId/items/:itemId/consumption` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/planning-cycles/:cycleId/items/:itemId/consumption` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/planning-cycles/:cycleId/items/:itemId/rice-assessments` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/planning-cycles/:cycleId/items/:itemId/select` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/planning-cycles/:cycleId/items/:itemId/selection-preview` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/planning-cycles/:cycleId/items/:itemId/withdraw` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/planning-cycles/:cycleId/items/:itemId/withdrawal-preview` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/products/:productCode/planning-cycles/:cycleId/items` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/planning-cycles/:cycleId/items` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/products/:productCode/planning-cycles/:cycleId/matrix` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/planning-cycles/:cycleId/move-preview` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/planning-cycles/:cycleId/move` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/products/:productCode/planning-cycles/:cycleId/observations/:observationId` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/products/:productCode/planning-cycles/:cycleId/observations` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/planning-cycles/:cycleId/observations` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/planning-cycles/:cycleId/open` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/planning-cycles/:cycleId/review` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/products/:productCode/planning-cycles/:cycleId/reviews` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/products/:productCode/planning-cycles/:cycleId` | 无；替代路径/退役/虚拟合同需单独核对 |
| PATCH | `/api/v1/products/:productCode/planning-cycles/:cycleId` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/products/:productCode/planning-cycles` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/planning-cycles` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/products/:productCode/planning-cycles/permissions` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/products/:productCode/planning-items/:itemId/comments/:commentId/history` | 无；替代路径/退役/虚拟合同需单独核对 |
| DELETE | `/api/v1/products/:productCode/planning-items/:itemId/comments/:commentId` | 无；替代路径/退役/虚拟合同需单独核对 |
| PATCH | `/api/v1/products/:productCode/planning-items/:itemId/comments/:commentId` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/products/:productCode/planning-items/:itemId/comments` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/planning-items/:itemId/comments` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/products/:productCode/planning-items/:itemId/dependencies` | 无；替代路径/退役/虚拟合同需单独核对 |
| PUT | `/api/v1/products/:productCode/planning-items/:itemId/dependencies` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/products/:productCode/planning-items/:itemId/feature` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/planning-items/:itemId/feature` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/planning-items/:itemId/handoffs` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/planning-items/:itemId` | 有；仍需合同核验 |
| PATCH | `/api/v1/products/:productCode/planning-items/:itemId` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/products/:productCode/planning-items` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/planning-items` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/products/:productCode/planning-items/permissions` | 有；仍需合同核验 |
| ANY | `/api/v1/products/:productCode/priority-models/:...modelPath` | 无；替代路径/退役/虚拟合同需单独核对 |
| ANY | `/api/v1/products/:productCode/reach-observations/:...reachPath` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/:productCode/requests/:requestId/decision` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/requests/:requestId/handoffs` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/requests/:requestId/merge` | 有；仍需合同核验 |
| DELETE | `/api/v1/products/:productCode/requests/:requestId/sources/:sourceId` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/requests/:requestId/sources` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/requests/:requestId/sources` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/requests/:requestId` | 有；仍需合同核验 |
| PATCH | `/api/v1/products/:productCode/requests/:requestId` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/requests` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/requests` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/requests/permissions` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/restore` | 无；替代路径/退役/虚拟合同需单独核对 |
| ANY | `/api/v1/products/:productCode/roadmaps/:...roadmapPath` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/products/:productCode/versions/:versionId/acceptance-preview` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/versions/:versionId/acceptances/:acceptanceId` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/versions/:versionId/acceptances` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/versions/:versionId/acceptances` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/versions/:versionId/archive` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/versions/:versionId/features/:scopeId/deliver` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/versions/:versionId/features/:scopeId/history` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/versions/:versionId/features/:scopeId/legacy-criteria` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/versions/:versionId/features/:scopeId/reopen` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/versions/:versionId/features/:scopeId/visibility` | 有；仍需合同核验 |
| PATCH | `/api/v1/products/:productCode/versions/:versionId/features/:scopeId` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/versions/:versionId/features` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/versions/:versionId/features` | 无；替代路径/退役/虚拟合同需单独核对 |
| DELETE | `/api/v1/products/:productCode/versions/:versionId` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/versions/:versionId/plan/confirm` | 有；仍需合同核验 |
| DELETE | `/api/v1/products/:productCode/versions/:versionId/plan/items/:scopeId` | 有；仍需合同核验 |
| PATCH | `/api/v1/products/:productCode/versions/:versionId/plan/items/:scopeId` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/versions/:versionId/plan/items` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/versions/:versionId/plan/items` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/versions/:versionId/plan` | 有；仍需合同核验 |
| PATCH | `/api/v1/products/:productCode/versions/:versionId/plan` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/versions/:versionId/publish` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/versions/:versionId/releases/:recordId` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/versions/:versionId/releases` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/versions/:versionId/reopen` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/versions/:versionId/transition` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/versions/:versionId` | 有；仍需合同核验 |
| PATCH | `/api/v1/products/:productCode/versions/:versionId` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/versions` | 有；仍需合同核验 |
| POST | `/api/v1/products/:productCode/versions` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode/versions/permissions` | 有；仍需合同核验 |
| GET | `/api/v1/products/:productCode` | 有；仍需合同核验 |
| PATCH | `/api/v1/products/:productCode` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/products/catalog-refresh` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/products` | 有；仍需合同核验 |
| POST | `/api/v1/products` | 有；仍需合同核验 |
| GET | `/api/v1/project-documents/accessible` | 有；仍需合同核验 |
| POST | `/api/v1/project-template-versions/:id/transition` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/project-template-versions/:id` | 有；仍需合同核验 |
| PUT | `/api/v1/project-template-versions/:id` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/project-template-versions` | 有；仍需合同核验 |
| POST | `/api/v1/project-template-versions` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/projects/:id/documents/:documentId/access-audit` | 有；仍需合同核验 |
| POST | `/api/v1/projects/:id/documents/:documentId/access-check` | 原生 Host → Runtime 精确 access-check；复用 Codocs typed ACL，无物理 Aims 依赖 |
| GET | `/api/v1/projects/:id/documents/:documentId/access-policy` | 有；仍需合同核验 |
| PUT | `/api/v1/projects/:id/documents/:documentId/access-policy` | 有；仍需合同核验 |
| GET | `/api/v1/projects/:id/documents/:documentId/download` | 有；仍需合同核验 |
| GET | `/api/v1/projects/:id/documents/:documentId/preview` | 有；仍需合同核验 |
| GET | `/api/v1/projects/:id/documents` | 有；仍需合同核验 |
| POST | `/api/v1/projects/:id/documents` | 无；替代路径/退役/虚拟合同需单独核对 |
| PUT | `/api/v1/projects/:id/documents` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/projects/:id/environments/:environmentCommand` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/projects/:id/environments/upsert` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/projects/:id/gitlab-commits` | 有；仍需合同核验 |
| POST | `/api/v1/projects/:id/markdown-documents` | 有；仍需合同核验 |
| DELETE | `/api/v1/projects/:id/members` | 有；仍需合同核验 |
| GET | `/api/v1/projects/:id/members` | 有；仍需合同核验 |
| POST | `/api/v1/projects/:id/members` | 有；仍需合同核验 |
| POST | `/api/v1/projects/:id/milestones/:milestoneId/rollover` | 有；仍需合同核验 |
| GET | `/api/v1/projects/:id/milestones` | 有；仍需合同核验 |
| POST | `/api/v1/projects/:id/milestones` | 有；仍需合同核验 |
| POST | `/api/v1/projects/:id/other-documents` | 有；仍需合同核验 |
| POST | `/api/v1/projects/:id/people-contributions/sync` | 无；替代路径/退役/虚拟合同需单独核对 |
| DELETE | `/api/v1/projects/:id/repos` | 有；仍需合同核验 |
| GET | `/api/v1/projects/:id/repos` | 有；仍需合同核验 |
| POST | `/api/v1/projects/:id/repos` | 有；仍需合同核验 |
| POST | `/api/v1/projects/:id/requirement-contents` | 有；仍需合同核验 |
| GET | `/api/v1/projects/:id/requirement-reviews` | 有；仍需合同核验 |
| POST | `/api/v1/projects/:id/requirement-reviews` | 有；仍需合同核验 |
| GET | `/api/v1/projects/:id/requirement-targets` | 有；仍需合同核验 |
| POST | `/api/v1/projects/:id/requirement-targets` | 有；仍需合同核验 |
| GET | `/api/v1/projects/:id/requirements/codocs-candidates` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/projects/:id/requirements/export` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/projects/:id/requirements/import` | 有；仍需合同核验 |
| GET | `/api/v1/projects/:id/requirements` | 有；仍需合同核验 |
| POST | `/api/v1/projects/:id/requirements` | 有；仍需合同核验 |
| GET | `/api/v1/projects/:id/requirements/spec` | 有；仍需合同核验 |
| POST | `/api/v1/projects/:id/sync-gitlab-issues` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/projects/:id/sync-gitlab` | 有；仍需合同核验 |
| GET | `/api/v1/projects/:id/time-entries` | 有；仍需合同核验 |
| GET | `/api/v1/projects/:id/work-items` | 有；仍需合同核验 |
| POST | `/api/v1/projects/:id/work-items` | 有；仍需合同核验 |
| DELETE | `/api/v1/projects/:id` | 有；仍需合同核验 |
| GET | `/api/v1/projects/:id` | 有；仍需合同核验 |
| PUT | `/api/v1/projects/:id` | 有；仍需合同核验 |
| GET | `/api/v1/projects/check-duplicate` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/projects` | 有；仍需合同核验 |
| POST | `/api/v1/projects` | 有；仍需合同核验 |
| GET | `/api/v1/quality-reviews/:submissionId/content` | 无；替代路径/退役/虚拟合同需单独核对 |
| DELETE | `/api/v1/requirement-contents/:contentId` | 有；仍需合同核验 |
| PATCH | `/api/v1/requirement-contents/:contentId` | 有；仍需合同核验 |
| POST | `/api/v1/requirement-contents/:contentId/restore` | 有；仍需合同核验 |
| POST | `/api/v1/requirement-reviews/:batchId/append-requirements` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/requirement-reviews/:batchId/approve` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/requirement-reviews/:batchId/create-tasks` | 有；仍需合同核验 |
| POST | `/api/v1/requirement-reviews/:batchId/reject` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/requirement-reviews/:batchId/resolve` | 有；仍需合同核验 |
| POST | `/api/v1/requirement-reviews/:batchId/sync-workflow` | 有；仍需合同核验 |
| POST | `/api/v1/requirement-reviews/:batchId/withdraw` | 有；仍需合同核验 |
| GET | `/api/v1/requirements/:reqId/change-diff` | 有；仍需合同核验 |
| GET | `/api/v1/requirements/:reqId/change-impact` | 有；仍需合同核验 |
| POST | `/api/v1/requirements/:reqId/changes` | 有；仍需合同核验 |
| POST | `/api/v1/requirements/:reqId/create-task` | 有；仍需合同核验 |
| DELETE | `/api/v1/requirements/:reqId` | 有；仍需合同核验 |
| GET | `/api/v1/requirements/:reqId` | 无；替代路径/退役/虚拟合同需单独核对 |
| PATCH | `/api/v1/requirements/:reqId` | 有；仍需合同核验 |
| GET | `/api/v1/requirements/:reqId/versions` | 有；仍需合同核验 |
| POST | `/api/v1/service/enterprise/accessible-project-documents/read` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/service/enterprise/project-document-access/execute` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/service/enterprise/project-document-files/read` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/service/enterprise/project-document-sources/read` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/service/enterprise/project-document-writes/execute` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/service/enterprise/project-documents/read` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/service/notification-details/authorize/finalize` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/service/notification-details/authorize` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/service/products/:productCode/versions` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/service/service-tickets/:ticketCode/work-item/receive` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/service/work-item-completion/workflow-callback` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/service/workflow/callback` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/users/:uid/time-entries` | 有；仍需合同核验 |
| GET | `/api/v1/weekly-reports/export` | 无；替代路径/退役/虚拟合同需单独核对 |
| POST | `/api/v1/work-items/:id/append-tasks` | 有；仍需合同核验 |
| PATCH | `/api/v1/work-items/:id/approval-status` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/v1/work-items/:id/breakdown-context` | 有；仍需合同核验 |
| PUT | `/api/v1/work-items/:id/breakdown` | 有；仍需合同核验 |
| GET | `/api/v1/work-items/:id/children` | 有；仍需合同核验 |
| POST | `/api/v1/work-items/:id/clone-from-template` | 有；仍需合同核验 |
| GET | `/api/v1/work-items/:id/comments` | 有；仍需合同核验 |
| POST | `/api/v1/work-items/:id/comments` | 有；仍需合同核验 |
| GET | `/api/v1/work-items/:id/commits/:commitId/diff` | 有；仍需合同核验 |
| DELETE | `/api/v1/work-items/:id/commits/:commitId` | 有；仍需合同核验 |
| GET | `/api/v1/work-items/:id/commits` | 有；仍需合同核验 |
| POST | `/api/v1/work-items/:id/commits` | 有；仍需合同核验 |
| POST | `/api/v1/work-items/:id/confirm-append` | 有；仍需合同核验 |
| POST | `/api/v1/work-items/:id/confirm-distribute` | 有；仍需合同核验 |
| GET | `/api/v1/work-items/:id/decompose-context` | 有；仍需合同核验 |
| POST | `/api/v1/work-items/:id/decompose-submit` | 有；仍需合同核验 |
| PATCH | `/api/v1/work-items/:id/deliverables/:deliverableId` | 有；仍需合同核验 |
| DELETE | `/api/v1/work-items/:id/documents/:documentId` | 有；仍需合同核验 |
| DELETE | `/api/v1/work-items/:id/documents` | 有；仍需合同核验 |
| GET | `/api/v1/work-items/:id/documents` | 有；仍需合同核验 |
| POST | `/api/v1/work-items/:id/documents` | 有；仍需合同核验 |
| GET | `/api/v1/work-items/:id/execution-context` | 有；仍需合同核验 |
| POST | `/api/v1/work-items/:id/reject-append` | 有；仍需合同核验 |
| POST | `/api/v1/work-items/:id/revoke-distribute` | 有；仍需合同核验 |
| GET | `/api/v1/work-items/:id/source-sections` | 有；仍需合同核验 |
| POST | `/api/v1/work-items/:id/submit` | 无；替代路径/退役/虚拟合同需单独核对 |
| DELETE | `/api/v1/work-items/:id/time-entries/:entryId` | 有；仍需合同核验 |
| PATCH | `/api/v1/work-items/:id/time-entries/:entryId` | 有；仍需合同核验 |
| GET | `/api/v1/work-items/:id/time-entries` | 有；仍需合同核验 |
| POST | `/api/v1/work-items/:id/time-entries` | 有；仍需合同核验 |
| GET | `/api/v1/work-items/:id/transitions` | 有；仍需合同核验 |
| POST | `/api/v1/work-items/:id/withdraw` | 无；替代路径/退役/虚拟合同需单独核对 |
| DELETE | `/api/v1/work-items/:id` | 有；仍需合同核验 |
| GET | `/api/v1/work-items/:id` | 有；仍需合同核验 |
| PUT | `/api/v1/work-items/:id` | 有；仍需合同核验 |
| PATCH | `/api/v1/work-items/batch` | 有；仍需合同核验 |
| GET | `/api/v1/workspace` | 无；替代路径/退役/虚拟合同需单独核对 |
| GET | `/api/work-calendars/:calendarCode/days` | 有；仍需合同核验 |


## 11. R1 实施交付（2026-10-07）

### 11.1 入口与单一执行所有者

Host 的唯一新入口为 `POST /enterprise/api/internal/aims/drain`。Gateway 公网拒绝此路径；后台调度直接发送精确路径的 HMAC wake，物理 app/deployment 均为 Enterprise，签名同时保留 Aims 的 storage/generation。Gateway 的 `HZY_AIMS_SCHEDULER_EXECUTOR` 默认为 `aims`，显式 `enterprise` 才切换；未知值、Host binding 缺失或 legacy storage 不会回退旧 wake。自托管配置字段为 `scheduler.aimsExecutor`，不改变 cron 是否启用。

Runtime 的 `enterprise.aimsDeliveryWorker` 只能选择一组精确身份：旧 `aims.runtime` 配 Aims deployment，或新 `enterprise.runtime` 配 Enterprise deployment。真实服务身份、凭据实时校验、受众、三项分离能力、注册表 generation 和 claim fencing 均保留；相反 worker 不能领取。同进程 Host→Aims 的 drain 为 owning public typed 入口，不再签一次领域服务令牌。

业务 outbox 的 `source_app=aims` 不变；新生产者使用选定 worker 的 deployment。**已有 outbox 的 deployment、command/key/hash 不得改写。切换前必须冻结并按旧原键收尾全部非终态旧 outbox（不只是六类舍弃项）。**新 Host 不接管旧 deployment 的记录，也不重新生成 operation。未完成收尾时不得停 Aims。

### 11.2 保留与停产

Host 仅登记三个保留 executor。Workflow/Codocs 请求使用真实 Enterprise app/client 与原 operation/key；Console 通知保留 Aims 业务命名空间，同时审计记录仍为 Enterprise client。action-defs 同步仅允许 Enterprise 精确服务身份发布 Aims 定义，不能跨到其他 app；失败可重试。

选择 Host worker 后，六类舍弃命令停止新增：两个产品反馈 outbox 不再创建；旧成本规则冻结、People 贡献冻结返回 `410 aims_operation_retired`；里程碑旧可开票通知与工单旧 outbox 不再创建。工单已存在的 D11 typed owning 调用继续执行。该选择只由 Runtime 构造时的注册 worker 决定，HTTP 字段不能开启或关闭。Host 遇到遗留/未知 operation 时在事务内拒绝，claim 和 attempt 均回滚，不迁移这六类 executor。

due/rollover/dead-letter 复用原 owning 逻辑。Host due 调用复用签名代次 caller，不依赖旧 Aims worker 凭据；原业务开关保留，R1 不启用 scheduler 或通知开关。旧独立进程停止、其他旧入口关闭与调用方切换仍按 R2–R4 执行。

### 11.3 grant 候选与 hzy0 应用步骤（未执行）

候选为 `console/docs/sql/Console-SQL-Seed-aims-host-r1-candidate.sql` 与同名 `Verify` 文件，共 11 个精确 tuple：三项 Runtime 能力各两个 audience；Workflow completion/create 与 action-defs/sync；Codocs product-document/create 与 company-weekly-summary/publish；notifications/publish。无 wildcard、无人员权限/manifest 变化、无新 capability；不冒用 aims.runtime、不恢复停用 client、不覆盖冲突 grant、不轮换凭据。

hzy0 后续批准窗口执行顺序：

1. 从批准 SHA 构建干净候选；备份并解密核验 Console 相关 client/grant 行及 Runtime/profile/Gateway/PM2 配置。记录原 grant 行 ID、worker 与签名 target/generation；保护凭据，不输出正文。
2. 固定 `@r1_tenant` 与 `@r1_enterprise_deployment` 为已登记 hzy0 实际值，先跑 Verify。client 必须唯一且 active；缺 tuple 的 `(0,0)` 可新增，`(0,>0)` 冲突、重复、停用或错绑定一律停止，不能修复覆盖。
3. 执行候选 Seed，记录新增行 ID；复跑 Verify，每个 tuple `(1,1)`、client=1。仅用真实 Enterprise client 做脱敏签发探测，逐项核对 audience/tenant/deployment/source/capability，不输出 token。
4. 保持旧执行所有者，冻结旧 outbox 新增并按原键收尾；回读非终态/租约/回调聚合，未知不算零。准备回滚时仅撤销本次新增且无后续使用的 grant，保留原行。
5. 将 Runtime `enterprise.aimsDeliveryWorker` 设为已登记 Enterprise deployment 与 `serviceClientId=enterprise.runtime`；Gateway 将 `scheduler.aimsExecutor` 设为 `enterprise`。同时加载本批 Host、Console/Workflow 精确配对与生成 egress；签名目录保持真实目标。仅更新所有者，不开启 hzy0 默认关闭的 business cron/consumeBusinessOutbox。
6. 验证精确 Host signed wake、三项 Runtime 能力和原键回执；错/旧 client、错 target、错代次、缺 grant 必须拒绝。验证 due/rollover 原开关行为、action-defs、死信通知；随后才按第 8 节另行批准停 Aims。此处不是停进程授权。
7. 任一步失败恢复原 Runtime/Gateway worker 选择和候选，核验只剩一个 owner；不要修改 outbox deployment/key，也不要通过新增 operation 补救。生产 seed/停服须另行申请，不能复用 hzy0 批准。

### 11.4 验证边界

本批测试使用本地 HTTP 合成 fixture 与 `/tmp` 隔离 MySQL；未读取或写入 hzy0/生产。隔离证据覆盖旧/新 worker 身份、代次与表映射、claim fencing、拒绝遗留 operation 时零 mutation、receipt/部分成功恢复、周报 checkpoint 原子回滚、due/rollover，以及候选 grant 重复执行与冲突/停用不覆盖。最终计数和提交 SHA 见 `.git/report-aims-retirement-r1.md`。尚不能据此宣布 Aims 进程可停：R2–R4 与真实切换、签发和停进程验证未执行。

### 11.5 v2.28 旧授权与 R1 合同的关系（2026-10-07 裁定）

v2.28 撤销旧 Host 精确能力时，前提是 Host 不承担 Aims 调度。R1 已批准 Enterprise 作为物理执行者，该前提被新的精确系统合同取代。hzy0 的原行7008449（aims:milestone-rollover/execute、data-runtime）获准在完整绑定一致后恢复active并语义复用，不新增重复行、不修改scope_json。Verify仅为R1三项精确能力的枚举闭集接受旧物理编码（aims:<cap>与标准audience前缀写法），且所有语义scope/audience/tenant/deployment/client须相同；其它能力/受众/绑定不得套用。Seed仍不恢复撤销行。生产原行处置须另行批准。


## 12. R2–R4 实施与验证口径（2026-10-07）

### 12.1 tasks 退役事实

只读查询 Console：客户端与 grant 均 active，semanticScope 精确为 `aims:tasks:read`，或 action=read 且 resource 为 `aims:tasks`、`data-runtime:aims:tasks`、`tenant-runtime:aims:tasks` 的闭集。hzy0 与生产结果均为 0 行。生产 grant 表有 last_used_at；hzy0 grant 表没有该列（credential 表有）。不存在 active 持有者，因此无需把 credential 时间冒充 grant 使用事实，亦不对无结果声明“近 30 天访问日志为零”。查询在只读事务内结束并关闭隧道，无授权或业务数据写入。

按用户裁定，该接口不迁 Host、不新增 tuple。Runtime GET 在访问数据库前返回 410，旧 Aims BFF 和 Host 拒绝型兼容 middleware 返回 410，明确迁移说明。Host 不把它登记为可执行业务操作。

### 12.2 物理进程与领域职责

`features.aimsRetired=true` 的 hzy0 必须使用 `scheduler.aimsExecutor=enterprise`，并显式关闭三项 legacy 标志。PM2、up/restart、doctor 和 listener probe 共用应用集合，移除物理 Aims 要求，保留 Workflow/Console/Collab 和逻辑 Aims Runtime 域。显式启动 Aims 被拒绝；旧模式保留恢复能力。

Codocs legacy 来源关闭写入受保护 Worker env 文件，即使公司周报投递未启用也传入。Workflow 的 Aims 回调当前始终投 Enterprise；Console 的 aims 来源通知详情当前始终投 Enterprise：两项 legacy 标志是退役前置断言，不能删除历史业务来源或冻结回调路径。

自托管 Gateway 的 drain.apps 中 aims 表示逻辑领域。只有 aimsExecutor=enterprise 且精确 Enterprise origin 已登记时，才可省略物理 apps.aims；旧 owner 模式仍要求 Aims origin。自托管构建增加 `--aims-retired`，默认包集合排除物理 Aims，拒绝同模式显式打包 Aims；旧包构建保留用于回滚。

hzy0 停进程验证尚未执行，须用已含 S1 的最新集成候选完成回归、备份和 §8 门禁后才能宣布可停。生产停用与生产 grant 写入仍待单独批准。


### 12.3 旧直连逐族边界

| 旧族 | 当前组合替代 / 收尾 | 物理 Aims 是否必须保留 |
| --- | --- | --- |
| 产品版本/摘要 | Host 产品版本页使用已登记 aims.version-list/view；旧 Assets 独立 `products/[id]/versions.get.ts` 是单独应用 BFF，不在 Enterprise 的 assets layer server 导出或 Host route 表中 | 不因未打包的旧独立 Assets BFF 保留进程；重新启用该独立入口需另迁精确合同，不能改用宽代理 |
| 项目环境/环境项目 | Host 只暴露已登记业务面；旧独立 BFF 路径不在当前 Host 编译入站。保留 Runtime owning 领域，停物理进程不删除表或改 grants | 旧独立调用不是当前七应用的进程依赖；不声称未迁的环境管理动作已恢复 |
| 项目成本、管理事实 | 新 Finance 成本固定操作与 People Runtime 事实入口；其 appCode=aims 表示 Runtime owning 域，非 Aims HTTP origin | 否；不能删除逻辑 Aims binding |
| 合同/商机创建项目、关联候选、回款里程碑同步 | Host Altoc contracts-activate-delivery 等固定操作在统一库中调用 owning 项目逻辑；旧 Altoc activation executor 不在 Host 入口打包，已批准舍弃六类旧 Aims 出站命令 | 否；保留原 receipt 与被冻结事实，不重放旧入口制造第二次创建 |
| 产品反馈、工单接收 | APF Host 已使用 owning typed 操作；旧 Aims feedback/status/progress/ticket-result 三类出站已裁定舍弃，R1 拒绝再领取 | 否；不迁旧执行器，不改历史 outbox 正文 |
| 工时冻结、关期与 rollover | Runtime owning 操作保留；R1 Host 精确三能力 + generation/claim fencing | 否；独立调度不再启动第二个 owner |
| tasks | Console active grant 查询为零，旧接口明确 410 | 否；不新增 Host tuple |
| Workflow 回调 | 固定 callbackTarget 映射 Enterprise，原 app_code、资源、动作、原键不变；下游精确 owning 回调 | 否；只观察原 outbox，禁止浏览器提交批准事实 |
| 通知详情 | Console aims 来源详情授权的物理目标为 Enterprise；两阶段 owning 权限复核 | 否；历史 source_app=aims 仍保留 |
| 项目文档六类服务 | Host 注册 project-document-* 固定操作和 layer typed owning 入口，Codocs 原服务命令以 enterprise.runtime 投递 | 否；关闭 codocs legacy Aims 身份后保留 Enterprise 身份校验，不放宽 ACL |

这份矩阵判定的是当前 Enterprise 组合与后台 owner 的物理依赖。未部署的独立 Assets/Altoc 源 API 没有被迁成新 Host 服务入口，不把它们宣称为可继续调用的兼容机器 API；也不以“源码仍在”推导必须继续运行 Aims。生产停用前仍须按 §9 核对生产实际拓扑与旧入口观察证据。


## R2 callback scope 闭集核验（2026-10-07）

核验基线 f0160322；不是凭 scope 名称推断权限。全文检索 Runtime 调用 `authenticateEnterpriseSystem`，Aims owning domain 只有以下两个精确 POST 路径：

| 路径 | 可执行的 owning 回调 |
|---|---|
| `/v1/aims/service/workflow/callback` | 需求基线/变更评审、项目 pause/resume/finish/立项、里程碑完成审批结果 |
| `/v1/aims/service/work-item-completion/workflow-callback` | 工作项完成审批结果 |

证据：`server.go` 的精确路由分派、`enterprise_system_context.go`、`aims_work_item_completion_callback.go`；业务子类闭集见 `milestone_completion_governance.go:applyAimsWorkflowCallback`。receivable coordination 开启时 owning callback 明确 503，不能借此启用跨域 lane。每条回调还必须通过既有实例/业务元组/状态/原键/receipt/事务栅栏校验，scope 不授权任意状态写入。

`enterprise_apf.go` 的 system 操作只使用 altoc/finance/people owning domain，不能用 Aims scope 命中。普通 Aims adapter 要求 aims.read/aims.write，`auth.go:hasScope/runtimeSemanticScope` 只去除两个已知 audience 前缀，不把 scheduler:execute 推导为 read/write。通知详情另要求 purpose 能力。R1 三个入口分别精确要求 integration_operation、milestone-rollover、notifications-due；scheduler:execute 不满足它们，反向三能力也不满足 callback（新增回归用例）。用户委托通道仍要求 enterprise-host 能力和人员 permit。

结论：授予 enterprise.runtime 仅增加上述 owning callback 收尾能力，与 R1 三能力无交叉扩权。按用户本轮条件批准，hzy0 增加 data-runtime/tenant-runtime 两个精确 tuple；生产不执行。候选 `Console-SQL-{Seed,Verify}-aims-host-callback-candidate.sql` 不修复/恢复冲突行，不接受 resource 别名；先备份、Verify、Seed、再真实双 audience 签发逐 claim 探测，失败停止。

计数纠正：当前是 callback **id=28** 一条 failed/due，另有 30 条 success，不是 28 条 failed。历史 last_error 尚未归因，不将当前缺 grant 当作已证实的历史失败原因。迁移后只按冻结原键收尾；失败分类记录，不盲目重试，不写 SQL 改状态。


### R2–R4 部署前置与回滚点

R1 的 11 tuple 与 owning callback 的双 audience 是两个独立集合。callback 候选只新增 `data-runtime:aims:scheduler/execute`、`tenant-runtime:aims:scheduler/execute`，不修改 R1 三能力。启动前先更新 Gateway/Console egress 生成物，再对这两个组合 scope 完成真实签发探测；旧白名单会返回 `hzy0_console_egress_denied`，此时停止，不能绕过出口守卫直连签发来冒充通过。

R3 必须在 Runtime `enterprise` 配置中显式关闭 `allowLegacyAimsCallbacks` 和 `allowLegacyNotificationDetails`（二者默认 true），并保留备份；profile 同名断言不能代替 Runtime 实际关闭。切换失败恢复原 config/profile/binary/PM2；回滚新 grant 时只回滚本轮新行，不删除原 R1 11 tuple。失败 callback 按冻结原键续投，原始失败记录不可 SQL 改为成功。

#### R2 验收补漏：项目文档 access-check

2026-10-07 hzy0 登录会话复现该路径 503 hzy0_upstream_error。原 Host 路由虽已登记，内部仍调用 Codocs 旧 Service API；Host 发出 enterprise.runtime，而该接口明确限定 aims.runtime。此身份冲突不因 Aims 进程在线而消失。补为精确 Runtime 进程内 ACL 判定，旧服务接口不放宽。access-policy/read、access-audit 与 policy-update 的旧 Service 调用仍需单独核验，不能用本项通过宣称这些操作已原生迁完。
