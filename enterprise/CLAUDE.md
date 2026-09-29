# Enterprise Host

## 当前状态（2026-09-20）

当前策略只读候选：导航可通过 `HZY_ENTERPRISE_VERIFIED_POLICY_ENABLED` 显式开启
新回执 gate，默认关闭；服务端配置 issuer/kid/publicKey/environment，Host 绑定
来自受信 Gateway，读取保留 enterprise 身份、精确 policy read grant。版本失配
拒绝，既有 Console 权限判定保留。这不是 Console 协议/权限算法迁移完成，
2026-09-21 已在 hzy0 显式启用并验证登录/导航/文档列表；其他环境默认关闭，证据与剩余项见策略验证合同 §12。

2026-09-21 Console 组合准备：先收口策略验证合同，暂不注册 Console 协议模块。
宿主侧策略验证归 Enterprise 内 Console 模块，权威 Auth/秘密仍归 Runtime；
不能复制 Gateway HMAC key、借同进程继承全部 Console 身份或信任未验证版本。
原本地门面 HMAC 不匹配已由完整签名策略链解决，核查与现场切换证据见
`../docs/Console-Enterprise-Policy-Verification-Contract.md`。

9 个非演示 mydocs 页面及工作汇报兼容入口已显式注册，并有非页面回归；不是仍待首次注册。环境全链、真实 DB/OSS/编辑器及业务验收尚未完成。当前主线为 Host 基线收口与试点交付准备，唯一进度见根 `docs/Unified-Enterprise-Implementation-Plan.md` §3.1 / INT-606。下文“目前仅安排”“尚未注册”“新增候选”保留历史实施上下文，不作为当前完成结论。

发布清单必须锁定 Console、Gateway 源码及其外部导入的生成路由/拓扑文件；旧 Shell 普通点击迁移依赖 Console + Gateway，不能只部署 Host。源描述符、构建制品、环境回读和业务验收是不同证据；脏工作区不能生成固定发布候选。

ADR-019 导航引用各领域 manifest 的人员资源/动作，不能引用 Runtime 服务 capability 充当人员权限。`GET /enterprise/api/navigation` 在受信 Enterprise 会话/部署与 Runtime 配置下，通过 Foundation 分别读取逻辑模块权限，只返回可见节点 ID；后台业务 handler 仍承担最终对象/字段授权。导航元数据在构建期校验，修改后运行 `generate:navigation`；浏览器与 Worker 只消费无文件系统依赖的生成值。旧 Shell 的测试兼容映射另由 `deploy/test-env/generate-enterprise-host-routes.mjs` 生成并做漂移检查。ADR-019 总验收状态仍在统一实施计划，不以本地回归替代真实角色/业务链验收。

项目文档页复用 Aims 原页面；`other-documents` multipart 上传限 10 MiB，通过签名 `upload-file` 命令转交 Aims 共享编排。测试 Host 增加 Aims/Codocs Service Binding；服务调用不经过公网自等待。正文/附件/权限完整浏览器验收状态见测试部署记录。

ADR-018 企业宿主，物理身份固定 enterprise，业务前缀包含 /aims、/assets、/codocs；当前 Aims/Assets 显式组合产品链，Codocs 按 INT-606 渐进注册页面与 API。自有完整文档页已作为 Host 原生路由候选接入；本地独立编辑器和 Collab 仍保留兼容/服务运行边界，不是长期双前端目标。共享协作通道、版本及写入恢复仍须分别验收，不能由页面可见推断闭环。C000001 测试环境已接入正式 Enterprise 运行身份并切换统一库 generation=1；Codocs 尚未据此宣称环境启用。业务验收与剩余迁移范围见根测试部署记录。Foundation 是唯一 extends。项目执行约定见根 CLAUDE.md。

## Codocs 迁移顺序

按用户决定，第一批将除演示文稿外的 `mydocs` 页面树及其当前可达动作一并迁移，个人文档先行、部门文档随后；日志/个人周报主入口迁至工作台→我的工作→工作汇报，`mydocs` 仅保留指向同一页面的兼容入口，不做两套实现；收藏/最近、文件柜、共享移交/发布/盖章等不作为后置范围。用户最新决定将 `mydocs/slides.vue` 与演示专用 API/编辑预览导出后续迁移，本轮仅记录、不作为完成门槛；文件柜 PPT/PPTX 既有能力仍在首批。团队汇报后续部门批次，项目周报后续项目管理；旧 Codocs 项目文档不迁入，数据保留并由后续项目管理承接。目前仅安排/盘点，个人或部门文档页尚未注册。迁移保留 Host 唯一会话和显式页面/API 注册，不带入 Codocs 全局插件；编辑器与 Collab 仍保持现有运行边界。菜单、数据、Runtime 及编辑器归属不因本计划改变。

- 业务组合入口为 aims/layer/entry.mjs、assets/layer/entry.mjs、codocs/layer/entry.mjs，显式 pages 注册；禁止 extends 完整独立应用 nuxt.config。
- 组合模块文件内的 `app/composables`、`app/utils` 导出由 `composition/business-module-alias.mjs` 按模块作用域注入导入（仅该模块自有文件、且 Host/Foundation 未提供同名符号时）；不使用全局 `imports.dirs`，Codocs 的 useAuth 等同名符号继续解析到 Host 唯一会话。`test/business-module-auto-imports.test.mjs` 扫描全部组合页闭包，store 仍须显式导入。
- app.vue、全局布局、登录、中间件只由 Host 注册一次。业务 API 就绪边界由 `server/routes` 的实际路由文件派生，不再手工维护第二份放行清单：新增或删除路由后运行 `pnpm --dir enterprise generate:api-readiness`，`test/business-api-readiness.test.mjs` 会在清单漂移时失败。就绪只回答“Host 是否提供该 METHOD + 路径”，人员业务授权仍由 handler 判断，已就绪接口返回 401/403/400 属正常。业务模块前缀的未注册路径继续按 `enterprise_module_runtime_not_ready` 拒绝；Host 自有 `/enterprise/api/**` 与根 `/api/**` 未注册路径返回 JSON 404 `enterprise_api_not_found`（`server/routes/api/[...].ts` 兜底不计入就绪清单）；实际支持范围见 `docs/API_SPEC.md` 和根 `docs/Unified-Enterprise-Product-Page-API-Readiness.md`，后台任务尚未迁入。C000001 测试环境已完成 INT-107 身份绑定；其他环境未完成绑定前不得借旧应用身份发布。
- 本地 `pnpm --dir enterprise typecheck`、`test`；Cloudflare `verify:cloudflare` 仅构建及 dry-run，不含 deploy。
- 默认不配 Console URL、客户端 secret、Service Binding、cron 或业务权限；无配置时显示真实登录不可用。运行身份配置不能用客户端请求 Header 覆盖。
- 浏览器验收和真实身份接线完成前，不把占位路由视为 INT-303/304 或业务整合完成。
- 部署拓扑只由显式配置决定，不再以 `HZY0_*` 开关表达生产需要的行为：Host 本机 Workflow 用 `HZY_ENTERPRISE_HOST_WORKFLOW_ENABLED` + `HZY_ENTERPRISE_WORKFLOW_ORIGIN`（严格回环 HTTP 源，启动校验、失败关闭，规则见 `shared/host-workflow-config.mjs` 与根 MODULE_CONTRACTS）。`HZY0_*` 只保留 hzy0 测试专用行为（Vite/Tunnel 开发优化、测试 Gateway egress、本地 Console 门面），不得在生产配置中设置；非 test 构建不再回落到 hzy-test 的 OIDC 回调地址。

## 整合分支新增候选

个人柜转文档已补 Host `/{uuid}/to-document` → Runtime `conversion-plan`/`convert`：documents:view/create 双权限、精确 personal-cabinet:create，先条件存储，再新鲜授权与原 DB Serializable 事务创建文档/owner relation/关联。失败重试同 key、不覆盖后续编辑或重置关联；下列早期“转文档未完成”更新为候选已接线。目录选择已接真实分页；完整页面组合、环境授权和真实 DB/OSS/Worker 验证仍待完成，不代表整个整合已交付。

个人柜上传候选已补 `personal-cabinet:{upload-plan|upload}`/精确 create；Host 只读计划后条件存储，再重新授权提交 Runtime 元数据事务。沿用原 DB/OSS，使用新上传专属稳定 UUID/摘要路径；失败重试、不覆盖既有对象、不复活删除文件。环境启用与转文档链路仍未完成。

个人柜 DELETE 候选已补精确 `codocs:personal-cabinet:delete`，当前 documents:delete、owner 范围与事务幂等回执；保留原 OSS 对象和转换目标，失败重试沿用 key。该项不代表上传/转换、环境 grants 或页面组合完成。

Codocs 个人文档读写、软删除/恢复与文件柜读取已开始以 Host → Runtime 固定用户域命令接线，原 Codocs DB/OSS 保持；个人柜 read/export 使用独立 capability，列表真实分页、转存信息重验目标 ACL、Office 预览隔离不可信 HTML。以上均为未启用环境的候选，mydocs 页面尚未注册，文件柜写链和完整动作尚未完成；以根 MODULE_CONTRACTS、INT-606 增量记录为准，不把路由就绪视为整个整合完成。

工作项完成审批/回调/人工 replay、IP 资产 list/detail/create/edit 的本地合同与隔离测试已实现，接口与未启用项见 `docs/API_SPEC.md` 及根 `docs/MODULE_CONTRACTS.md`。候选代码、schema 或 grants 不表示当前环境已部署；后台投递与环境授权必须分别核验，不能借 Host 身份绕过目标 Service API 或入站验签。

## Console 批次 A 用户页面（2026-09-26）

Host 自有页面 `/enterprise/notifications`、`/enterprise/notifications/:notificationId`、`/enterprise/todos` 显式导入 Foundation NotificationCenter/TodoList，共用 ContentPageHeader，旧 Console 页继续工作。通知读写沿用 Foundation 用户代理；待办仅新建 GET `/enterprise/api/notifications/todos`，验证已验证 user 凭据并严格限制 todoKind/cursor/limit（1–50），复用 Console binding，不新增 capability/grant/Runtime 操作。来源实时授权、自动已读和幂等键保持；详情点击/已读/归档是环境写入，不在只读浏览器检查中执行。匿名 curl 的 302 是 Cloudflare Access 登录，不能据此判断重定向循环；真实页面/1440/390 验收由 Claude/Codex-sol 在登录态完成，实现和隔离测试不表示环境验收通过。

Step 3 企业资料已接 `/enterprise/org-profile` 与无 query GET `/enterprise/api/org-profile`：复用 Foundation `OrgProfileDetails` 及已登记 `org-profile.read` 用户 API；403 显示无权限，编辑链接 `/console/org-profile`。原 Console 编辑继续使用同一展示组件。浏览器登录态验收由 Codex-sol 执行，不以隔离测试代替。

B1 `/enterprise/directory/users` 已登记，只读列表/单用户 GET 经 Foundation 精确 route registry 转发已验证用户，Console `directory_users:view` 保持权威；只读组件共用用户表格，管理在 `/console/directory/users`，无状态修改、凭据或 LDAP 建号。profile 仍单独等待 /api/directory/me 登录态探针。

B1 `/enterprise/directory/departments` 只读完整组织树与部门详情 GET 已登记；Console `directory_departments:view` 保持权威，源 Console 共用树表格/筛选函数并保留原写流程。


### B1 项目只读迁移

`/enterprise/directory/projects` 使用 Foundation 共享只读列表/资料/成员表；精确 GET BFF 登记于 consoleUserApiRoutes.ts，写操作链接回 Console。


### B1 委员会只读迁移

`/enterprise/directory/committees` 共享只读列表、列表记录资料及成员分页/角色筛选。只登记已有列表和成员 GET，不登记委员会单条 GET。


### 本人资料只读页

`/enterprise/profile` 仅用 Foundation `/api/directory/me`（pilot 经 `sharedApiPath` 为 `/enterprise/api/foundation/directory/me`）展示本人目录记录；头像/密码通过 `/console/profile` 修改，403/401/依赖故障分别展示，不以会话缓存替代目录记录。


### Host 导航贡献

Console 仅为 manifest 导航贡献者，navigationContributors 与安装 businessModules 分离。工作台→我的工作显示通知/待办（服务端 gate 后 authenticated-self）；控制台→企业与组织五个管理页读取 Console 授权快照。原生 SFC navigationOwner 与真实 Nuxt 页面投影双校验；顶部个人资料指 /enterprise/profile；composition.modules 不变。


### 工作日历只读迁移

工作日历只读页在console.config，由Console manifest贡献system_settings:view；Foundation共享月度和逐日视图，写入口回Console。

目录同步的 Host 原生页为 `/enterprise/directory/sync` 与 `/enterprise/directory/sync/:jobCode`；三个 BFF GET 转发 Console `directory_sync:view` 并在服务端白名单投影。禁止透传原始任务/事件错误文本；未知失败只能固定降级。Console manifest 贡献导航至“控制台 → 集成与运行”，同步触发留 Console。

B2 部门首组复用 Foundation DirectoryDepartmentEditor，精确 POST 列表、PATCH/DELETE 单条 BFF 与用户路由登记。列表附加服务端 Console edit 可见性，无新权限端点；Console handler 每次仍判权。MVP 无 CAS、差量 PATCH、稳定同意图 key 重试，保存与刷新失败分离；页面路径不变。

B2 项目组复用 Foundation DirectoryProjectEditor，四条精确 POST 列表、PATCH/DELETE 单条、POST members 用户写路由；列表 canEdit 使用 gated Console directory_projects:edit 快照，最终 handler 判权。差量修改、danger 删除、完整成员读回后的 warning 全量替换（包括空列表）；稳定同意图 key 与独立刷新失败，MVP 无 CAS。项目路径未新增，members 为静态保留路径，不开放该路径的 PATCH/DELETE。

B2委员会六条精确写路由复用DirectoryCommitteeEditor，权限仍为Console directory_departments:edit（不是directory_committees）。组织差量PATCH、danger删除、UserTreeSelector增量添加、单成员role upsert与warning移除；稳定同意图key、无CAS、保存/刷新失败分离。成员失败保留原角色/候选，成功读回领导指针/计数和末页分页；未加委员会单条GET、导航或页面路径。

### Host 共享用户 API 基址（G-12）

网关把根 `/api/*` 交给 Console，Console 不识别 Host 会话，所以 Host 页面使用的 Foundation 用户 API（Workflow 代理 7 个操作、通知 6 个、应用目录、目录 me/users/users-batch/departments/projects/business-domains）在 `server/routes/enterprise/api/foundation/**` 另行登记：Foundation 处理器原样复用，外层 `enterpriseSharedApi` 先 `requireEnterpriseUser`；Workflow 仍用 `enterpriseWorkflowProxy`。浏览器侧一律用 Foundation `sharedApiPath('/api/…')`，不要在 Host 代码里写根 `/api/` 字面量。pilot 构建 `sharedApiBase=/enterprise/api/foundation`、Nuxt Icon 端点 `/enterprise/_nuxt_icon`。新增使用 Foundation 用户 API 时同时补 Host 路由、`generate:api-readiness` 和 `deploy/test-env/enterprise-topology.mjs`，`test/host-shared-api.test.mjs` 检查三者一致。根路径同名路由保留给 hzy0 兼容与非 pilot 运行。

### Console C1 当前公司配置只读

`/enterprise/admin/business-domains`、`/enterprise/admin/regions` 复用Foundation OrganizationConfigurationReadPage，Console manifest贡献org_profile:view到控制台业务配置组（Console系统管理中的业务配置子项，不是身份/运维）。当前公司在BFF由profile解析，区划目标须存在于当前公司区域列表；三条只读GET精确注册并做白名单响应，创建/编辑/删除/替换区划回Console。

### Console C2 安全运行状态摘要

`/enterprise/data-runtime` 与 `/enterprise/admin/runtime-apps` 使用Foundation RuntimeStatusSummaryPage；Console manifest贡献data_runtime:view、runtime_apps:view到集成与运行组。两条精确BFF GET重建7字段白名单，不披露Runtime路径、安装包URL、端口、进程/应用编码、任意诊断或原始异常。应用页仅已启用应用整体状态，详情/配置/更新/启停留Console。§10要求独立SEC-03/07/08与页面幂等整改先于C2合入；登录/日志/缓存验收由协调者安排。

### Altoc G1 只读 Host 消费候选

六个原生 `/altoc/{customers|contracts|payments}` list/detail页及六GET BFF，经当前Console scoped authorization、Altoc纯scope编译器与当前Directory事实签发≤14s许可；Foundation复用项目文档独立HMAC机制覆盖scope/query/策略字段。只调用基础owning reader，不读Finance、文件、服务/审计诊断或写流程。导航是Altoc manifest贡献至销售已有三组，不安装Altoc composition模块。Gateway六GET逐路径与原子身份转发已接线；三grant seed/verify只交付文件，现时校验按已验证audience复用签发映射，并区分权限拒绝与依赖故障；部署与登录验收另排。

Altoc G2增加leads/opportunities/quotes六个native list/detail与六GET，沿G1当前scoped授权/原scope compiler和独立许可签名；opportunityId固定进入签名，quotation子项父ID与上限重验。仅五表基础读，无联系人/活动/成本毛利或跨应用读取/写。manifest贡献sales.opportunity和sales.quote；环境三grant安装与登录验收由协调者另排，不随提交自动执行。

### 组合页面浏览器权限快照（2026-09-28）

Foundation `useAuthorization` 在 Host 按页面所属模块读取 `GET /enterprise/api/auth/permissions?app=<module>`，每模块独立缓存，不合并同名资源码；归属只来自构建期路由 meta `authorizationApp`（`registerBusinessPages` 与 `annotateHostNativePageAuthorization` 由注册表写入），不取自 URL/query/用户输入。`app` 白名单由生成的 `navigationSources` 派生，服务端复用 `loadAuthorizationSnapshotFromConsoleRuntime` 普通合并快照；依赖失败 503，不回空 200。响应信封不符（如 SPA HTML）记为 error，布局显示“权限信息加载失败”，入口保持禁用。新增组合模块或 Host 原生页贡献者时无需手改白名单，但须重新生成导航。浏览器快照只是 UI 提示，handler 仍逐次判权。合同见根 MODULE_CONTRACTS“Enterprise Host 浏览器权限快照”。
