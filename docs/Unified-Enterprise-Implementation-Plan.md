# 统一企业应用实施计划与 TODO

> 以下 2026-09-15～09-24 的“当前状态/当前摘要”段落按写入日期保留为**历史进度**。2026-09-25 的运行制品、开关和近期顺序集中见[当前运行组合](./Current-Running-Combination-20260925.md)与 [NEXT](../NEXT.md)。

日期：2026-09-13。最近安排核对：2026-09-20（文档与本地证据，未重新回读环境）。原始基线：`801b402e`。

**当前摘要（2026-09-22）**：唯一业务主线为 INT-606c，G1 本机环境门槛独立待验；`NEXT.md` 列近期顺序。公开复审快照 `fc41e813` 的 R1/R2 已形成未提交代码候选及定向回归：同上下文导航合并在途请求，旧显示租约到期隐藏菜单但不取消仍有效的新请求；签名策略完整正文先预取、后取 bootstrap，暂存过期失败并整轮重试。本机 Gateway 已载入候选，策略分段计时与 Nitro worker 探测可用；最近读取与少量成功续期不能代替长时稳定、撤权、故障恢复和固定制品验收。测试 Runtime 已最小更新至 `0.3.219-test.codocs-version-read.1`，版本正式账号允许/拒绝证据尚缺。文档 v2 新增未注册的有界字节校验内核并通过假读取器回归；Foundation 原生 OSS/S3 兼容端已补精确版本请求与响应核对，但真实 OSS 联调及版本保留保障、受信路由、全读取消费者、Collab epoch、旧 writer 与 schema/权限组合未闭环，正式写入仍禁止放行。FE-1、FE-2 和 P5 仍未完成真实业务验收；以下历史段落保留时间线，不视为当前制品状态。详情见[本机验收记录](./Huizhi-Yun-Local-Enterprise-Test-Plan-v1.0-20260920/docs/Local-Enterprise-Test-Acceptance-Record.md)。

决策依据：[ADR-018：统一企业应用、租户业务数据库与全量功能交付](./ADR-018-Unified-Enterprise-Application-and-Data.md)。

当前状态（2026-09-15）：实施仅在 `feat/adr018-enterprise-integration` 继续；`main` 已通过 `1cc1ca3d` 恢复为整合前代码，生产环境未切换。测试租户 C000001 的统一业务库已完成围栏、最终复制、55 个兼容视图及 generation=1 激活，Runtime、Enterprise Host 和 Gateway 已承接已登记的产品试点路径。Aims/Assets 当前只组合产品规划与产品主档相关页面，原独立应用的其他业务页面尚未完整迁入，不能把两个模块入口视为完整功能整合。测试策略持久缓存有效期为 26 小时，Gateway 每天北京时间 00:00 自动同步并保留手工触发；次日自动任务尚待实际观察。专项测试、局部浏览器验收或一次部署成功均不等于 P0～P7 完成。

## 1. 交付目标

1. 一个企业使用统一前端与 BFF，内部按业务模块维护；首先完成 Aims + Assets 产品链。
2. 同一租户的业务数据逐步进入统一业务库；当前事实直接引用，必要的跨域操作使用 Runtime 内部服务与事务。
3. 企业统一获得全量功能，不再按商业版本或应用购买；人员权限、数据范围和敏感动作控制保持有效。
4. 保留现有 URL、稳定业务标识、历史快照、审计与外部集成；逐步退役已被替代的同步和部署配置。
5. 用请求次数、同步依赖、配置数量、正确性及性能证据证明复杂度下降。

暂不包含：Account 改造、将 Platform 合入企业业务库、将密钥/会话表开放给普通业务查询、取消外部集成的可靠投递、自动修改既有收费合同。

## 2. 台账规则

### ADR-019 review 核对（2026-09-19，基线 `0ca042dbe721e7ba72a290a7d90a551d561e4d04`）

后续复审 `28609b7` 的 R1–R4 与验证记录见下节；本节保留首轮复核时点，不能视为所有问题已经验收。

整合负责人复核，Luna 子代理分工修正，主代理负责权限过滤与集成。review 原件保留在 `docs/adr019-review/`，不以历史快照替代当前事实。

- F1：当前菜单确实缺运行时人员权限过滤；新增 Host 导航快照、分模块人员权限引用、空父节点裁剪及会话/撤权失效处理。沿用 Foundation 授权判断，不新增角色或放宽后台鉴权。
- F2/F4：`new` 被误认对象、对象名称仅显示 ID、固定返回和折叠时丢项目导航的问题存在；改为正式匹配路由与授权详情上下文，共用展开/折叠/移动模型及分页项目选择。
- F3：旧 Console Shell 会重复包裹 Host；在现有测试 pilot 的受控 Gateway 绑定中按本发布已注册页面兼容跳转。未迁移页面保留旧 Shell，写请求不重定向；不扩大到其他环境。
- F5/5.1：目的地去重与中文状态键妨碍同页多入口；改用稳定 ID、唯一 active 选择及按验证会话隔离的折叠偏好，生成制品与注册表做漂移检查。
- 5.2：People 仅有导航定义，未接入 Host、未进行人事/财务角色分权验收；继续隐藏空入口，不因本 review 扩大迁移范围。
- 5.3：产品目录和规划空间同区不等于完整产品工作台；FE-A05 端到端产品→版本→项目→返回与代表性角色验收仍待完成。FE-1 和 ADR-019 整体验收保持未完成。

本轮是本地代码修正与回归，不代表部署或真实账号验收完成；最终验证证据与限制在交付记录中列明。演示文稿、旧项目文档及其他未接入模块仍按原决定后置。项目总览当前固定最多读取 500 条、没有分页控件：本轮只恢复其已有筛选/搜索/视图，不能声称“第 3 页返回”通过；项目切换器使用每页 20 条的正式分页接口。另发现既有项目计划 handler 检查 `milestones:view`，但当前 Aims manifest 未定义该人员资源：菜单以已存在的 `work_items:view` 粗筛，后台原检查不删除，此历史授权合同漂移须另行核对后修正。

本地回归记录（2026-09-20）：Enterprise 154 项中 153 通过、1 项原有可选性能测试跳过；Gateway/topology 48 项通过；Foundation Shell 13 项通过；Enterprise typecheck 和 Cloudflare Module 构建通过（构建不等于部署）。物理 Enterprise Host 已明确为原生布局入口，逻辑业务应用的旧 Shell 规则不全面豁免。浏览器脚本仅为待完成验收脚手架：本地未签名 OIDC fixture 被服务端校验拒绝，1440/390 桌面/移动验收没有通过证据；需要可验证测试会话后补验，不得用旧截图或单测替代。

### ADR-019 修正复审（2026-09-20，公开基线 `28609b7`）

- R1：详情页将对象模型提升为模板顶层 Ref；真实详情/侧栏 SFC 渲染比较产品与筛选列表来源的返回 href、标签，保持同源模型，不复制返回逻辑。
- R2：Gateway 按生成的迁移页面登记下发受信投影，Foundation 校验 Gateway 凭据与 Console deployment；Console 在创建 iframe 前查询并执行顶层导航。预热不导航，失败显示重试，完成的判定不跨导航缓存，代次与目标校验拒绝迟到激活；未迁移目的地保留旧 Shell。此项未来发布需要同时更新 Gateway 与 Console，只有 Enterprise 更新不足以生效。
- R3：同一验证身份的权限后台刷新保留最长 60 秒的导航展示租约，30 秒更新；失败/到期/撤权及身份切换清理，迟到响应失效。没有改变业务 API 的逐次授权；项目摘要额外要求概览的查看入口仍获授权。
- R4：页面 key 保留身份 scope、路径和已盘点的少量一次性 query 入口模式；普通项目列表筛选、视图、搜索及 hash 不再重建实例。用实际 key helper 与 Vue keyed renderer 验证同页复用、跨身份/对象重建。
- C1：按用户最新决定修改 ADR-019 v1.3 与导航规范 v1.2，一级业务区域不折叠；二级分组继续折叠，当前路由祖先自动展开。本轮不新增一级折叠控件。

验证：Enterprise 162 项通过、1 项原有可选测试跳过，Foundation Shell 18 项、Console Shell 9 项、Gateway/topology 49 项通过；Enterprise 与 Console typecheck 通过，Enterprise 测试 pilot Worker 构建通过，`git diff --check` 通过。以上是本地修正，未提交、未部署。真实登录浏览器的完整路径、1440/390 视口及受限角色/撤权矩阵仍待补验；SFC 渲染、Vue 生命周期与隔离 HTTP 测试不是线上端到端验收。

- `[ ]` 表示未完成，`[x]` 仅表示列明交付物与验收证据齐备；进行中/阻塞原因写在对应项后，不提前勾选。
- 每项有稳定 ID。实施时补“负责人、分支/提交、证据路径、完成日期、遗留项”；可链接下一级专项文档，本文保留唯一总进度。
- 路径、库名和 API 名称标注“拟定”的，在盘点阶段冻结；现有路径可作为检查入口，不代表新增接口已经存在。
- 修改代码前记录当前 Git 状态；共享文件指定一个整合负责人，避免多个 agent 同时修改 Runtime router、配置、Host 入口或 manifest 生成器。
- 实施不自动触发生产发布。各环境写入/切换按已授权范围执行，优先完成可审阅制品与回退准备。

## 3. 阶段、依赖与工作安排

| 阶段 | 工作包 | 前置条件 | 完成标志 |
| --- | --- | --- | --- |
| P0 | 清点现状并冻结试点合同 | 本方案 | 对象、调用、授权、数据迁移和性能基线可核验 |
| P1 | Runtime 上下文、统一连接与内部服务基础 | P0 | 新旧路径兼容，租户/权限/事务边界通过测试 |
| P2 | Aims + Assets 产品数据试点 | P1；P0 迁移映射 | 主档直接读取、单写切换、历史与重放保持正确 |
| P3 | Nuxt Host 与两模块界面/BFF 整合 | P0；最终验收依赖 P1/P2 | 同一会话、旧 URL、实际数据及桌面/手机验收通过 |
| P4 | 全量功能产品资格 | P0；身份改造依赖 P1 | 新旧企业权益兼容，人员权限无扩大 |
| P5 | 联合测试、测试环境切换和试点租户上线 | P2/P3/P4 | 数据恢复、权限、性能、完整业务链及部署证据齐备 |
| P6 | Altoc / Finance / People 分批扩展 | P5 | 每条链分别完成事务/同步调整和回退验收 |
| P7 | 旧路径退役与文档收口 | 对应链路验收与观察完成 | 旧消费者归零，无遗失写入，无过期双路径 |

阶段依赖保持不变；经确认的 INT-606 个人文档及后续部门准备是提前开展的限定批次，不表示 P5 已通过，也不允许据此提前扩大 Altoc/Finance/People。当前顺序：Host 底座收口 → 个人文档及后续部门协作 → 产品工作台闭环 → INT-501～507 联合试点 → INT-601～605 商业履约与成本核算 → 逐项退役旧路径。业务库切换与商业权益转换分开开关、分别演练。

不预设缺乏表量、依赖和资源依据的完成日期。P0 结束时按任务填写工作量区间、可用负责人和目标日期；P5 是试点完成节点，P6/P7 是逐链持续工作，不以试点成功宣称全平台整合完成。

当前按下列责任分配 agent，由整合负责人维护总进度：

| 角色 | 负责范围 | 协作约束 |
| --- | --- | --- |
| 整合负责人 | ADR/合同、阶段依赖、共享文件、最终验收与发布 | 统一接收各工作包，不以单模块测试代替整链验收 |
| Runtime/数据负责人 | 数据清点、连接、查询、领域服务、事务、迁移恢复 | 唯一负责数据库映射及切换制品 |
| Nuxt/体验负责人 | Host、Layers、路径、会话、缓存、响应式 | 不自行改认证和业务写入规则 |
| 认证/授权负责人 | Platform/Console/Runtime 身份、权益、权限兼容 | 与 Runtime 冻结合同后再并行实现 |
| 验证负责人 | 数据对账、真实 MySQL、浏览器、性能与恢复 | 可阶段性由整合负责人承担，结论注明验证环境 |

### 3.1 当前工作包：统一 Host 基线收口与当前试点交付准备

2026-09-20 用户调整当前执行顺序：接手 Copilot 的[本机 Enterprise 环境](./Huizhi-Yun-Local-Enterprise-Test-Plan-v1.0-20260920/docs/Local-Enterprise-Test-Acceptance-Record.md)，原文档快照开发暂停且修改保留。已回读独立 hzy0 PM2/Caddy/Dev、OIDC 两条精确回调 active，补归属/模式门禁、HTTP/WS/HMR 与只读核验修正；14 项隔离回归、2 项 Cookie 测试、真实本机 ingress/HMR 101 通过，两个 hzy0 进程定向重启生效。用户批准后通过控制台仅将 hzy0 回源从 `localhost:19090` 改为 `127.0.0.1:23180`，保存成功且列表回读一致；未修改 Access/其他 ingress/Runtime/DB。Chrome 已显示公网 Enterprise 登录页并进入 Wiztek SSO，等待用户重新登录后验证正式应用会话。CLI Tunnel 只读 API 返回 403，未扩权。G0/G1 部分完成未放行，G2 Node 固定制品/G3 回环分离未实现，禁止把运行脚手架或 HMR 握手当作真实业务验收。

**用户任务**：普通员工能可靠完成文档工作，产品负责人能连续完成产品定义、规划、版本与执行；先固定公共底座及验收输入，不以页面数量交付。本批只收口既定范围，不整包迁入销售、财务、人力或凑齐菜单。

整合负责人统一协调 Host 布局、共享导航、Foundation 身份及 Runtime 路由；GPT-5.6 Luna 可并行完成窄范围测试、映射和证据整理，不另开功能主线。每个工作包顶部记录源码提交、当前结论、证据和阻塞项，历史增量保留但不作为当前结论。

| 产出 | 当前证据与剩余工作 | 归档位置 |
| --- | --- | --- |
| Host 基线 | R1～R4/C1 已有 §2 本地回归；真实普通点击、角色/撤权、宽窄屏链路待验；尚未固定修正后的候选版本 | INT-301～305、INT-501/502/505 |
| 个人文档交付批次 | 9 页已有注册及非页面测试；逐动作对照已有实现，补真实依赖、写入和恢复，不重做页面 | INT-606c；部门准备单列 INT-606d |
| 产品工作台验收输入 | 冻结完整任务脚本、环境前置与已实现/待实现/待环境证明的差距 | FE-2、INT-503；[产品接线清单](./Unified-Enterprise-Product-Page-API-Readiness.md) |

Host 必须保留以下实际组件/路由/异步衔接回归，不只测纯函数：详情正文与侧栏返回同一来源并保留允许的筛选/hash；旧 Console 普通点击先判迁移再导航、不得双 Shell；同身份有效权限刷新保留工作区、失败/过期/撤权清理并拒绝迟到响应；普通 query 更新不重建整页；创建页不进入既有对象模式、对象切换名称和权限正确；宽屏/侧栏收起/窄屏使用同一对象导航模型。一级业务区不折叠，二级可折叠；SFC 与生命周期测试不替代浏览器交互验收。

**2026-09-20 本批执行增量（未提交工作区）**：已补发布输入漏项：`enterprise/scripts/manifest-artifacts.mjs` 与测试环境源描述符统一锁定 Console、Gateway，以及 Gateway 导入的 `enterprise-host-routes.mjs` / `enterprise-topology.mjs`；漏项、篡改或工作区变脏均拒绝。源描述符仍只证明源码固定，不能代替构建摘要或部署回读；现有旧描述符需在新提交的干净工作区重新生成，不更新历史记录冒充当前制品。定向导航/真实 SFC/Vue 生命周期/本地 HTTP/Gateway 回归 48 项通过；发布清单/源描述符/preflight 14 项、预检策略与历史发布发现 16 项通过。未执行浏览器或外部环境写入，固定候选仍待提交及同基线构建。

  新增 `navigation-sections-sfc.test.mjs` 编译并渲染真实 `HostNavSections.vue` 与递归 `HostNavTree.vue`，证明主/辅一级区域是非折叠标题、当前二级祖先展开并有真实叶子链接、非当前二级可收起（1 项通过）。这是模板接线证据，不是 1440/390 视觉验收。实际工作区调用固定源描述符生成器返回预期 `WORKTREE_DIRTY`，未写出制品。

  会话衔接补核：初始导航已有 `session.global.ts` 调用服务端验证，不新增重复初始化请求；插件监听补齐本地 user/subjectCode 变化并同步失效旧 scope，这些字段只触发失效、不作为可信身份。`session-plugin.test.mjs` 编译真实插件和中间件，证明初始已填身份仍经服务端确认、主体变化立即清空、旧响应不能恢复，以及同 scope focus 验证期间保留当前 scope；连同原 coordinator 回归 11 项通过，Enterprise typecheck 通过。没有改动 Foundation 授权算法或增加授权。

  本批合并后最终回归：Enterprise 168 项中 167 通过、1 项原有可选性能测试跳过、0 失败；上述定向测试属于其中的覆盖补充，不将数量相加冒充独立证据。发布/预检定向 30 项通过，`git diff --check` 与文档链接检查通过。曾在子代理新测试尚未完成时的并行运行出现夹具 500，完成夹具并补元数据路径断言后已由最终全量重新验证；没有以该失败轮作通过证据。代码验证不等于新构建、固定提交或环境联调。

**候选版本记录要求（尚待形成，不以旧部署冒充）**：同一发布清单记录私有源码提交与公开快照对应、Host 构建摘要/版本、Console 构建/版本、Gateway 路由投影摘要/版本、Runtime 镜像摘要/版本、schema 迁移及权威数据代次、权限目录摘要与实际安装 grants、binding/编辑器/存储等配置引用（不含密钥）、后台任务 owner 与旧静态资源兼容窗口。R2 依赖 Console + Gateway，不能只发布 Host。环境证据要在同一观测窗口回读，后续改动导致相关证据失效时重新验证。

| 阶段结论 | 证据要求 | 当前安排 |
| --- | --- | --- |
| 代码验证完成 | 对应提交的类型、构建、组件/HTTP/契约测试通过，列出跳过项 | 可继续下一批准备/开发，不等于环境可用 |
| 环境联调完成 | 目标身份、精确 grants、路由、数据库、编辑器、存储真实协同及恢复记录 | 本轮整体仍待补齐；不能用源码 capability 或 SQLmock 替代 |
| 业务验收完成 | 普通岗位从正常入口完成任务、权限隔离及失败恢复通过 | 浏览器验收暂缓；FE-1、FE-2、试点放行保持待验 |

联合验收复用 INT-501～507：普通员工/产品负责人/项目经理/只读/管理员；两租户同 ID、迟到响应、多标签退出与撤权；响应丢失后的重试、依赖/存储故障、后台任务重复唤醒；固定制品与发布恢复。观察覆盖至少一次相关后台任务周期及完整业务操作，长度按真实业务周期定。UI 回退后仍访问当前权威数据，不能把连接改回迁移前旧库；ADR-017 的认证和凭据边界独立满足放行条件。

试点通过后按合同到交付、结算到到账、人员投入到合同成本逐链落实 INT-601～605，而非整包搬应用。成本批次先冻结人员成本与已确认工时输入契约，再做归集、快照和调整；不把缺成本基础的数据称为准确利润。保留人力资源独立入口及已批准兼容能力，不顺带纳入招聘/考勤/培训/发薪。

## 4. P0 — 现状清点与试点合同

责任：整合负责人牵头，各模块负责人提供证据。

- [x] **INT-001** 清点部署与路由：[同一代码基线的部署与路由清单](./Unified-Enterprise-Deployment-and-Routing-Inventory.md)覆盖 Worker/Host、Nuxt base path、服务身份、真实调用路径、cron、outbox 消费者、会话初始化、保留服务和环境，并区分源码声明与运行回读。2026-09-15T14:12:51Z–14:13:01Z 同一观测窗口补齐三项缺口（[回执](../deploy/test-env/artifacts/C000001.int-001-observation-window.json)）：五个 Worker 的活动版本/流量/Service Binding 与 Data Runtime `0.3.219-test.adr018-candidate.7` 同时回读；trigger 回读证明全环境只有 Gateway 的 `0 16 * * *`，且其值等于包装器的 `TEST_POLICY_SYNC_CRON`，**因此当前没有任何定时触发器执行 integration drain**（只剩请求驱动路径，恢复定时 drain 归 INT-305）；Enterprise OIDC client、`enterprise.runtime` 服务客户端、38 条全 active 的精确 grant 与 deployment binding 均已回读。只覆盖 C000001/test，生产仍为待环境核验。（2026-09-15）
- [x] **INT-002** 冻结 Host 组合合同：已由[统一 Host 合同](./Unified-Enterprise-Host-Contract.md)冻结包名、目录、页面/API 前缀、兼容 URL、资源命名、release tag、兼容矩阵、冲突清单和责任边界。（2026-09-15 证据复核）
- [x] **INT-003** 清点试点数据：[产品试点数据清单](./Unified-Enterprise-Pilot-Data-Inventory.md)已统一 Aims 113 + Assets 37 = 150 表、478 行的当前基线，覆盖产品/产品线、空间/模块、功能/需求/版本、采用关系、projection、receipt/outbox；逐表计划保存主外键、字符集、索引、引擎、位置类别和目标映射，清单补齐写入方及消费者。（2026-09-15 证据复核）
- [x] **INT-004** 冻结产品事实与权限合同：已由[统一数据合同](./Unified-Enterprise-Data-Contract.md)及产品目录/接入专项合同确定权威表、当前事实、历史快照、接入水位、稳定标识、可见性和投影保留边界。（2026-09-15 证据复核）
- [x] **INT-005** 清点权益与身份依赖：已由[统一权益合同](./Unified-Enterprise-Entitlement-Contract.md)逐项分类订阅、License、模块可用性、manifest、bundle、client/grant 和部署绑定；资源权限继续独立保留。（2026-09-15 证据复核）
- [ ] **INT-006** 记录基线与排期：[构建基线](./Unified-Enterprise-Build-Baseline.md)和[性能基线](./Unified-Enterprise-Performance-Baseline.md)已记录历史构件、当前配置/同步任务数，并冻结两租户四权限主体、30次分组采样方法、验收阈值、负责人和日期。固定提交暖依赖三轮分段 dry-run 已通过 3 GiB 构建 RSS 门禁，上传约 6069 KiB，BigInt 警告已消除；冷依赖三轮、旧新 P50/P95、实际 CPU/并发内存/startup、Runtime SQL/慢查询仍缺，暂不勾选。（2026-09-15）

  2026-09-15 复核把三项缺口落成可执行前置条件，未改变阈值：(1) **startup 无法事后回读**——Cloudflare version 接口不返回 `startup_time_ms`，该值只在上传响应中出现，因此第 5 条的 30 次 isolate 采样必须在专门的测量流程中即时采集，不能靠已部署版本补取；(2) **SQL 口径缺测量级数据库配置**——本机测量实例 `performance_schema=ON` 但 `long_query_time=10`、`slow_query_log=OFF`，且 runtime 账号按最小权限没有 `performance_schema` 读权限，要满足冻结的 500 ms 阈值需在测量实例上单独设定阈值并提供只读特权账号，且不得开启会记录明文参数的通用日志；(3) **冷依赖三轮**需要独立克隆或专用构建机，不能在当前工作区清空依赖缓存。`perf-tenant-b` fixture 与两租户四主体的登录会话仍未具备，浏览器 30 次配对采样因此无法开始。

P0 交付物：部署/调用清单、数据映射与责任表、Host/API/身份合同、权益转换表、基线报告及排期。具体生产数据只在受保护环境取证，文档不保存密钥或业务导出。

## 5. P1 — Runtime 内部协作基础

责任：Runtime/数据负责人，认证/授权负责人；依赖 INT-001～INT-006。

- [x] **INT-101** 建立经过验证的统一请求上下文：`data-runtime/internal/server/enterprise_context.go` 及对应 HTTP/上下文测试已覆盖宿主与逻辑模块身份、tenant/environment/deployment、签名 actor、动作和 trace，拒绝未验证覆盖。（2026-09-15 证据复核）
- [x] **INT-102** 实现租户连接绑定与迁移路径登记：Runtime registry/transaction/config 已实现实例 UUID、同连接池、schema 映射、读写调度模式、版本和持久 generation guard，覆盖错租户、缺映射和版本拒绝并保留旧模式。（2026-09-15 证据复核）
- [x] **INT-103** 提取产品目录与产品规划领域服务：[产品试点 API 领域复用审计](./Unified-Enterprise-Pilot-API-Domain-Reuse-Audit.md)已固定当前 Aims 63、Assets 18 个 Host API：51 个 Aims 路由直接复用旧 handler，需求创建新旧 BFF 已合并为同一 handler，其余 29 个路由逐 utility 固定旧入口、Foundation operation 和 Runtime adapter/领域文件；旧 Assets 数据 API 与 Enterprise 的产品 create/edit 共用 `ExecuteProductMasterInTransaction` 和 owning receipt。[隔离 MySQL 回执](../deploy/test-env/artifacts/C000001.assets-product-master-cross-entry-isolated-mysql-verification.json)已在当前 `client:<client_id>` 身份合同下验证双向跨入口同键重放、异 payload 拒绝、单业务行/receipt、授权/credential 拒绝及晚失败回滚。（2026-09-15 证据复核）
- [x] **INT-104** 建立跨域查询入口：`ProductDirectoryService` 的授权后关联查询与分页已在 INT-103 落地，本轮补齐批量名称与聚合：新增 `Resolve`（`data-runtime/internal/enterprise/product_directory.go`）与 Runtime 路由 `POST /v1/enterprise/assets/product-directory:resolve`、Foundation operation `assets.product-directory-resolve`、Host `POST /assets/api/v1/products/resolve-codes`。批量上限 200 且要求唯一合法编码；名称、按状态与按产品线的聚合全部复用 list 的同一 grant 谓词、目录 readiness 与事务，不为被请求编码放宽谓词；返回字段仍只有编码/名称/产品线/标签/来源状态，不含敏感列。**不可读编码与不存在编码一律归入 `unresolved`，不可区分**。
  证据：隔离 MySQL `TestDirectoryIsolatedMySQL` 新增断言——越权编码不返回名称、隐藏产品线标签与状态不进入聚合、跨租户以 all-products grant 也只看到本租户事实、Aims 授权拒绝与目录未就绪均失败关闭；`TestDirectoryResolveRejectsUnboundedOrMalformedBatches` 覆盖空/超限/重复/空串/控制字符与外来 source domain。Host 契约测试断言 scope 派生、200 上限与 operation 声明一致。`go test ./...`（含隔离 MySQL）31 包通过，enterprise 82 项、foundation 493 项、enterprise typecheck 通过。
  同时修复该隔离用例在分支上无法运行的问题：fixture 从 `@@port` 构造绑定地址，而此前的演练实例以 `--skip-networking` 启动导致 `@@port=0`、`Register` 返回 `invalid binding`；演练需使用绑定 127.0.0.1 且有真实端口的隔离实例（用例默认 skip，此前未暴露）。（2026-09-15）
- [x] **INT-105** 实现事务协调：`data-runtime/internal/enterprise/transaction.go` 及产品规划/调度专项 MySQL 测试已覆盖共享事务、锁与修订、唯一约束、audit/receipt/outbox 原子提交和晚失败回滚；网络投递保持事务外。（2026-09-15 证据复核）
- [x] **INT-106** 定义共享幂等与兼容命令身份：旧 Aims 与 Enterprise 版本创建入口复用同一 handler、`Idempotency-Key` 和领域命令身份（[源码合同测试](../enterprise/test/version-command-identity.test.mjs)）；[版本命令隔离 MySQL 回执](../deploy/test-env/artifacts/C000001.product-version-idempotency-isolated-mysql-verification.json)证明提交后丢失响应时同键同载荷返回原 receipt/结果且仅一行业务事实，同键异载荷拒绝；[外部 ACK 恢复回执](../deploy/test-env/artifacts/C000001.external-ack-recovery-isolated-mysql-verification.json)与[旧在途任务接管回执](../deploy/test-env/artifacts/C000001.old-inflight-operation-isolated-mysql-verification.json)证明 fake provider 已提交但响应丢失后，新 worker 以冻结命令身份查询目标 receipt、避免重复副作用并完成 source ACK，同时覆盖 pending、未过期旧 lease 防抢占、过期 lease 的 `partial_unknown/lease_expired` 分类及 version/fence 递增；不可识别旧格式在调用 provider 前 fail closed 并生成待人工记录。（2026-09-15 隔离证据复核；未调用真实外部 provider，也不声明生产环境已验证）
- [x] **INT-107** 落地宿主→Runtime 身份合同和迁移兼容：`authenticateEnterpriseRequest`（`data-runtime/internal/server/enterprise_context.go`）要求真实边界 JWT（`StrictServiceClaims`、`AppCode/SourceAppCode=enterprise`）、精确 capability（拒绝通配与 `data-runtime:` 前缀的 legacy 写法）、与服务主体不同的签名 actor，并在每次请求前用 `verify` 回读凭证/能力撤销状态；状态不可用返回 503、已撤销返回 403。
  负面覆盖：`TestEnterpriseContextRejectsIdentityAndDelegationViolations` 覆盖未登记绑定、错租户、错 audience、错部署、错来源应用、错 client、错 subject、legacy 前缀 capability、宽 scope `*`、过期、缺 `exp`、未签名 actor、篡改 actor 与篡改路径共 14 例，且任一非法身份都不会到达凭证校验器；`TestEnterpriseContextRequiresLiveCredentialState` 覆盖撤销与状态不可用。用户级越权由各路由的 permit 再次判定（工作项 permit、目录 grant），见 INT-104 与 INT-304 证据。
  迁移兼容：`TestResolveKeepsPerOperationMigrationModes` 证明同一已验证身份下，读/写/调度各自遵循注册的路径模式——仍由旧注册表服务的 `legacy` 域不解析、统一读不会附带开启写或调度、未知操作失败关闭；`TestSchedulerTransactionRequiresOwnAuthorityAndCurrentGeneration` 另覆盖三种模式与代次校验。Runtime 路由把 `ErrPathDisabled` 归入不泄漏的 503。`go test ./...`（含隔离 MySQL）31 包通过。（2026-09-15）
- [x] **INT-108** 更新 Runtime API、`MODULE_CONTRACTS.md`、Foundation 能力及适用模块说明；完成真实隔离 MySQL 的查询/事务/并发/授权回归，记录迁移路径登记的唯一事实源。
  文档：`docs/MODULE_CONTRACTS.md` 新增跨域批量名称/聚合链路（Host `POST /assets/api/v1/products/resolve-codes` → `assets.product-directory-resolve` → Runtime `:resolve`，含 200 上限、同 grant 谓词与 `unresolved` 不可区分规则）与工作项状态/删除链路（删除要求独立 `work_items:delete` 与 `aims:work-item-delete:execute`）；`docs/FOUNDATION_CAPABILITIES.md` 在 `callEnterpriseRuntime` 条目登记当前操作表并要求新增操作必须先登记路径与精确 capability；`enterprise/docs/API_SPEC.md` 补状态流转与删除契约。迁移路径登记的唯一事实源仍是 Registry binding（`Read/Write/Scheduler` 三个模式各自判定，见 INT-107）。
  回归：隔离 MySQL 全量 `-run MySQL` 共 **189 通过 / 3 跳过 / 2 例 harness 限制**，`internal/enterprise`、`internal/server`、`internal/apps/aims/...`、`internal/apps/assets/...` 另以 `-race` 通过；证据与逐项说明见[隔离 MySQL 回归回执](../deploy/test-env/artifacts/C000001.int-108-isolated-mysql-regression.json)。本轮修复四处此前因默认 skip 而未暴露的漂移：能力复核守卫仍冻结 32（模板已 64，且缺本批 4 个工作项能力，现为 68）、资产产品 HTTP 夹具未应用 `20260917` IP 关联 receipt 迁移、planning 夹具视图清单落后 `PlanningViewNames()` 三个视图、企业主体 claim 仍用未加前缀的 `enterprise.runtime`。
  遗留：服务主体存在两套约定——企业上下文与 scheduler 路由要求 `sub=client:<client_id>`，而 `enterprise_milestone_receivable.go` 仍要求未加前缀的 `aims.runtime`；统一它属于修改安全校验，需要显式合同决定，暂记为 INT-107/INT-108 后续项。（2026-09-15）

2026-09-15 后续写链审计：协调器本身与已采用该协调器的产品规划路径已有证据，但新增 Aims 项目创建/编辑/成员、工作项写入曾直接 `DB.BeginTx`，尚未采用 persistent generation/schema/owner fence；新增数字资产写链同样必须补接。身份认证与本地 Enabled 标志不能替代 Registry writer 登记。该缺口归入 INT-108/P3 后续接线验收，修复与 stale-generation/只读域负向测试通过前，不宣称这些新链路可启用；不因此否定 INT-105 已实现的协调器。

同轮发现人员校验的数据库边界缺口：`config.EnterpriseBinding` 只接受业务域，不接受 Console；项目负责人、成员与工作项受派人员不能通过业务库中的 `directory_users` 查询验证。应使用独立 Console 正式人员 API 与短期、对象绑定的授权证据，Runtime 保留本地项目成员范围及事务锁；不能为通过夹具测试而把 Console/Auth 库并入业务 registry。此合同修复及人员依赖失败/停用/证据绑定负向测试也是新写链启用前条件。

后续代码验证：Aims 项目创建/编辑/成员及工作项写入已统一采用 Registry writer 事务围栏；人员校验改用 Foundation `fetchDirectoryActiveStatuses` 的独立 Console service hop，已删除业务库目录查询。隔离 MySQL race 验证缺失 writer、只读域、持久代际不匹配拒绝及事务回滚；人员证据的 actor/tenant/对象/操作/有效期负向合同、组合 Go 回归、Foundation 与 Enterprise 类型检查通过。此为代码验证，仍需固定制品、目标环境精确授权及浏览器验收；不整体勾选 INT-108/P3。

P1 完成条件：旧业务路径仍可用；新内部查询/写入具有实际运行的授权与事务边界。基础接口存在但返回占位成功不算完成。

## 6. P2 — 产品主档与产品规划数据试点

责任：Runtime/数据负责人；依赖 P1 与 INT-003/INT-004。

- [x] **INT-201** 形成统一库迁移脚本：`data-runtime/cmd/hzy-enterprise-migrate` 默认 dry-run（写入需 `--apply` 且必须带已复核的 `--review-hash`），`unified.validate` 精确校验目标，`internal/migrationlock` 提供迁移锁，`enterprise_migration_checkpoint` 支持中断续跑，`stableName`/`mapping`/`rewriteDDL`/`rewriteTrigger` 处理表名与内部 ID 冲突。2026-09-15 对当前源基线重跑 dry-run：152 表 / 480 行、**0 阻塞冲突**、review hash `b431b3aa2817ae88…`（[回执](../deploy/test-env/artifacts/C000001.int-201-202-plan-rehearsal.json)）。`~line-` 保留空间标识本轮专门修复：missing-master 规则改为「`~line-` 空间必须能在 `product_line_workspaces` 找到对应行」，是收紧而非豁免。（2026-09-15）
- [x] **INT-202** 完整迁移映射：计划覆盖 FK、触发器、逻辑引用、JSON 内引用、revision、历史快照、审计、receipt 与 outbox/水位；冲突只进入待处理报告，`Apply` 在存在未解决阻塞冲突时直接拒绝，不静默覆盖。本轮把初始 14 个阻塞冲突逐族收敛到 0，且每一项都是登记或收紧规则，没有放宽或覆盖数据：4 个纯值 JSON 字段补可执行校验（`value_json_contract.go`，拒绝未知快照版本）、产品空间接入族补 `workspace_onboard_json_contract.go`（校验工作区行、`~line-` 命名空间与产品线行）、版本变更审计规则收敛到 `object_type=version`、`onboard-line` 审计同时接受产品选择改动前后的两种冻结形态（历史审计不改写）。基线随 v5.37 由 150 表/478 行变为 152 表/480 行，已记录原因。（2026-09-15）
- [x] **INT-203** 做初始复制与只读影子对比：以已复核 hash 执行 `--apply`，写入独立影子库 `hzy_enterprise_shadow_review_int201_rehearsal`（generation=0、未激活、未改任何路由或凭证）。对比结果（[回执](../deploy/test-env/artifacts/C000001.int-203-shadow-comparison.json)）：152 张业务表逐表行数**全部一致、0 处不一致**（目标另含 3 张迁移控制表），外键 225、触发器 488 已复制；Assets `product_code` 与 Aims `product_workspaces.biz_id` 集合完全一致；产品线空间与模块来源的孤儿引用均为 0；**同一权限主体**的查询结果哈希在源与影子完全一致——受限主体（2 个产品）与产品经理主体（53 个产品）分别核对，不是只用管理员全量读取。
  限制：该对比在数据层以两侧同谓词执行，不替代经 Host BFF 真实会话的端到端授权对比，后者仍属 INT-306/INT-503 验收。（2026-09-15）
- [x] **INT-204** 将产品/产品线当前信息改为统一权威读取：产品列表/搜索经 `enterpriseplanning.CatalogService` 直读权威 `product_assets`（非旧投影），空间详情/标题、接入候选（`product-candidates`）、产品线下拉与批量名称（INT-104 的 `product-directory` 与 `:resolve`）均走统一授权读取。本轮补齐最后一项**采用查询**：新增 Runtime `POST /v1/enterprise/assets/product-adoption:read`（capability `assets:product-adoption:read`）、Foundation operation `assets.product-adoption-read`、Host `GET /aims/api/v1/products/:productCode/adoption`（保留旧 URL 形态）。交付资产与环境两个对象族各自携带绑定 permit，任一族被拒即返回 `assets_object_scope_denied`；统一读取在单一 snapshot 事务内完成，替代原先到独立 Assets Worker 的签名跨应用命令。
  接入证据与历史快照保留：`product_catalog_refreshes`/`product_catalog_projection`/`page_receipts` 仍作为接入水位与冻结名称的证据源，不参与当前信息读取；INT-202 已为其 JSON 载荷补可执行校验。目录同步交互的评估结论：当前信息读取已不依赖目录刷新，刷新仅保留为接入证据与历史快照生成路径，其退役条件记入[试点退役清单](./Unified-Enterprise-Pilot-Retirement-Inventory.md)。
  采用查询所需的 `customer_delivery_assets`、`asset_environments`、`customer_delivery_asset_environment_rel` 兼容视图使用独立清单 `EnterpriseProductAdoptionViewNames()`：未安装时只让该入口返回 503，不影响其他 Assets 服务启动；视图安装仍由既有 compatibility-rehearsal 工具按 runbook 执行。测试：enterprise 83 项、foundation 493 项通过，Go 全量 28 包通过（3 例 harness 限制见 INT-108）。（2026-09-15）
- [ ] **INT-205** 实现产品接入、统一管理和规划写入的新路径：单一权威写入方，事务复用 P1；保留来源产品唯一归属、模块移动/删除约束、计划确认与交付规则。
  2026-09-15 复核当前覆盖：单产品接入、整线统一接入（含按选择接入与 `~line-` 唯一归属）、模块创建/编辑/移动/删除、需求创建/编辑/决策/合并、版本完整生命周期（create/edit/delete/transition/accept/publish/archive/reopen 及 plan 编辑/条目/确认）与项目承接均已接入 Runtime 与 Host 路由，写入复用 P1 的 Registry 写事务与 owning receipt。**仍未完成**：产品中心页面已由 `aims/layer/entry.mjs` 以文件引用方式登记进 Host（结构、功能、需求、规划、承接、版本等），但登录后的真实页面验收尚未进行（归 INT-306），外部交付完整链（反馈接收与可靠投递的定时所有权）仍依赖 INT-305。按台账规则不提前勾选。
- [x] **INT-206** 编写切换/恢复 runbook：[切换与恢复 Runbook](./Unified-Enterprise-Cutover-Runbook.md) 按执行顺序给出前置条件、快照、写入暂停与 drain 排空、单向追平、最终对账、写入 fencing 与激活、路由切换与恢复开放、回退路径、中止条件和验证命令；合同推导仍以[切换协议](./Unified-Enterprise-Cutover-Protocol.md)为准。
  两处按本轮实测补入判据：drain 排空**不能假设定时任务会自行清空**（INT-001 回读证明当前唯一 cron 只跑 policy sync，环境处于「零定时 owner」），必须显式触发；最终对账固定为逐表行数、业务键集合、孤儿引用、**同一权限主体结果哈希**与结构对象五项，任一不一致即不激活（方法与一次实跑见 INT-203 回执）。回退按「目标是否已有新写入」分两条路径，已有新写入时必须走 `enterprise-recovery.v1` 反向恢复，不得直接切回旧库。本项交付的是手册，实际执行属 INT-506。（2026-09-15）
- [x] **INT-207** 隔离 MySQL 全过程演练：八类场景全部在专用隔离实例实跑通过，逐项映射到可重复执行的用例，证据见[演练矩阵](../deploy/test-env/artifacts/C000001.int-207-isolated-rehearsal-matrix.json)——改名立即可读、部分产品线接入（含绕开已管理与不可接入产品）、需求→版本→确认/转交、并发编辑、唯一归属冲突（整线与单产品竞争恰好一个成功）、重复提交（同键同载荷重放原结果、异载荷拒绝）、迁移中断（已提交前缀 + checkpoint 续跑 + 触发器重装 + 守卫式最终复制与激活）、新旧命令跨入口重放。同批隔离 MySQL 全量为 189 通过 / 3 跳过 / 2 例 harness 限制，并以 `-race` 复跑核心包。证据只记录用例名、计数与结论，不保存业务行、凭证或 SQL 参数。（2026-09-15）
- [x] **INT-208** 建立试点迁移清单与退役候选：[试点退役清单](./Unified-Enterprise-Pilot-Retirement-Inventory.md)逐项记录旧表/投影/任务/接口/配置的源码消费者、替代路径、退役条件与观察指标，并明确本阶段不删除任何仍在使用的历史证据。2026-09-15 补齐该清单执行顺序第 1 步要求的环境实例证据（与 INT-001 同一观测窗口）：Aims/Assets/drain coordinator 在测试环境均无 cron，唯一 cron 只执行 policy sync，因此当前是「零定时 owner」而非「已切换 owner」，调度所有权仍按 INT-305 处理；`enterprise.runtime` 38 条 grant 全 active；五个 Worker 与 Runtime 版本同时回读。生产与其他租户仍为待环境核验。（2026-09-15）

P2 完成条件：新数据路径不依赖手动同步当前主档；快照与授权语义无损；迁移前后以及新增写入后的恢复均有演练证据。

## 7. P3 — Nuxt Host、Aims 与 Assets 整合

责任：Nuxt/体验负责人。INT-301～INT-303 可在 P0 后启动；其余与 P1/P2 联调。

- [x] **INT-301** 创建最小 Host：`enterprise/` 已只复用 Foundation，具备唯一 app/layout、统一 OIDC 登录、首页、配置生成、Cloudflare dry-run 模板和 Gateway 精确绑定；入口、前缀、身份边界、会话及构建测试已验证，不复制 Console/Foundation 实现。证据见[P3 就绪审计](./Unified-Enterprise-P3-Readiness-Audit.md)。（2026-09-15）
- [ ] **INT-302** 提取 Aims/Assets 可组合 Layer：已建立显式 Layer、路由命名空间、模块路径和 Host-ready 边界，独立 typecheck 与 Host build 可通过。见[P3 就绪审计](./Unified-Enterprise-P3-Readiness-Audit.md)。
  **仍不勾选**：审计要求每个页面都有「迁入/保留独立/退役」登记，2026-09-15 实测 Aims 115 个页面中已登记 44、Assets 34 个中已登记 11，其余 **Aims 93、Assets 23 个页面既未登记也无书面决定**（原 `deferredPages` 清单已不存在）；这些页面迁入后还需在同一提交复验两个独立构建与 Host 构建。已关闭的是下列冲突类别。
  2026-09-15 冲突逐项收口为可执行守卫（`enterprise/test/registry.test.mjs`，Host 测试 85 项 0 失败）：页面/路由重名与越界前缀直接失败；与 Host 共享依赖的版本一致；两模块 auto-import composable 文件名无重名；已注册页面不声明 `layout` 或具名 middleware（`requests.vue` 的内联查询规范化函数随页面走，不依赖 Host，允许）；Host 只组合页面不组合模块配置，因此模块 `public/` 与全局 CSS 不被服务，守卫断言 Host 只有唯一 `main.css` 且模块代码对根路径 public 资源和 CSS import 的依赖为 0；`handlers/tasks` 保持为空且 Host 不注册 scheduled tasks，后台任务所有权归 INT-305。登录后的真实页面与视觉验收仍归 INT-306。（2026-09-15）
- [ ] **INT-303** 统一会话与缓存：可信会话 scope、并发重验、登出竞态和安全深链已有测试。2026-09-15 复核：**当前全部 Host-ready 页面与 composable 的缓存 key 都已由会话 scope 派生，未纳入 scope 的调用为 0**，并新增可执行守卫 `enterprise/test/registry.test.mjs`：文件清单**直接由注册表推导**（含以文件引用方式从独立应用挂载的产品中心页面），按括号配对解析首个参数，出现未由 `cacheKey(` 派生的 `useState/useAsyncData` 即失败，防止回退。
  仍不勾选的原因：会话 scope 的静态不变量已收口，但完整旧 URL、刷新与跨模块返回仍需登录后的真实浏览器验证（归 INT-306）；INT-302 的组合冲突已由守卫关闭，不再是本项阻塞。（2026-09-15）

  提交 `1c9daa47` 为五个已挂载 Assets 页面（physical/resources/items detail/digital list/detail）补 useAssetsModule session-scoped key；专项契约及 Assets typecheck 通过。此覆盖当前挂载页面，不证明未迁页面或真实双租户/主体浏览器切换完成。
- [ ] **INT-304** 挂载业务 BFF 并接入新 Runtime 服务：已接入工作项创建/基本信息编辑/版本关联/状态流转（start、reset、reopen）/删除，以及数字资产列表/详情/创建/编辑和快照分页，复用真实 H3 event、Foundation transport 和 Runtime operation；工作项分解、分发、撤销等结构动作及其他完整 Aims/Assets 页面与接口仍未迁入，bridge fixture 不能替代环境联调，暂不勾选。见[P3 就绪审计](./Unified-Enterprise-P3-Readiness-Audit.md)。（2026-09-15）
  2026-09-15 迁入工作项结构动作的第一部分 **任务分配确认/撤回**：Runtime `work-items:confirm-distribute|revoke-distribute`（各自精确 capability，确认对应显式 `work_items:confirm`，撤回对应 `work_items:edit` 且事务内沿用原项目经理规则（负责人、活跃经理角色成员或受信项目管理员；首版曾遗漏经理角色成员，已修正并由隔离 MySQL 覆盖）），目标与全部子任务、changelog、项目审计、receipt 同一 Registry 写事务；Host 路由、Foundation operation、manifest 资源与就绪模板 capability 已补。Go 单测、Host 合同测试、Foundation 114 项与隔离 MySQL 均通过；隔离演练同时发现并修复 receipt 命令 schema 版本超出 `VARCHAR(30)` 的缺陷（现为 `distribution-confirm.v1` / `distribution-revoke.v1`，并有长度守卫测试）。同日追加 **追加任务确认/拒绝**（`work-items:confirm-append|reject-append`，均为显式 `work_items:confirm`，只作用于执行中追加的规划态任务；拒绝时解除而非删除其承接的目标成果），隔离 MySQL、Go、Host、Foundation 116 项均通过。继而迁入 **追加任务创建**（`work-items:append-tasks`，`work_items:edit` + 事务内项目经理规则，负责人须为项目成员，替换既有规划态草稿后创建任务及自有成果），并与撤回共用项目经理规则 helper；隔离 MySQL、Go、Host、Foundation 117 项均通过。再迁入 **任务分解保存**（`work-items:breakdown`，沿用成果恰好承接一次、工时上限与分配确认后锁定规则，统一路径新增子任务 id 归属校验与负责人成员校验，并与追加任务共用负责人 helper）；隔离 MySQL、Go、Foundation 118 项、Host 合同测试均通过。至此分配页面的写动作（保存分解、确认/撤回分配、追加任务及其确认/拒绝）已全部具备统一路径。随后新增只读 `work-items:breakdown-context`（`aims:work-items:view`，附 `editVersion`）并将分配页面登记进 Host（`/aims/work-items/:id/breakdown`，详情页入口），原前端审批面板改为按 Host 返回的 edit/confirm 权限直接调用写动作；Go、Host 合同测试与隔离 MySQL 只读用例（成员可读/经理才可写的边界、承接映射、文档与待审记录、editVersion 稳定、身份与范围拒绝、读取零副作用）通过，尚未做真实浏览器验收。需求分解提交（依赖 Codocs 文档候选）仍未迁入，INT-304 继续不勾选。

  工作项完成审批的 source、回调、撤回与人工 replay 已在当前整合工作树实现，尚未启用到目标环境。`node data-runtime/scripts/test-enterprise-project-members-mysql.mjs` 的最新隔离 MySQL 演练通过：源端请求与审计事务、幂等/并发、回调早于 ACK、晚到 ACK、撤回、人工 replay，以及同一 Registry snapshot 下 queued/version/canReplay 一致和旧 generation 拒绝；同时执行 Workflow canonical DDL 的实例/receipt 原子性测试。transport 测试已断言冻结 actor header 与签名 command 对齐，Host BFF 测试覆盖独立 replay 权限。实际服务身份签发、候选迁移与 grants 应用、完整页面及目标环境联调仍未完成，不能据隔离测试勾选 INT-304。

  工作项状态流转与删除已在当前工作树接线完成：Runtime 路由按动作分派独立 capability（`aims:work-item-{start|reset|reopen|delete}:execute`），删除使用独立的 `work_items:delete` 人员权限，编辑权限不构成删除授权；Host 侧为薄路由 + 共享 BFF，删除路由保留旧 `DELETE /aims/api/v1/work-items/:id` 形态。新增 Runtime 路由/permit 守卫测试与 Host 删除契约测试；enterprise 81 项、foundation 493 项、`go test ./...` 全通过。Host 详情页目前只有状态流转按钮，删除入口未接入界面，且这批动作尚未做目标环境联调与浏览器验收，因此仍不勾选。

  IP 资产 Runtime list/detail 及 Server 分发已实现。现有 `test-enterprise-assets-products-mysql.mjs` 隔离演练新增 IP 范围测试：同一 Registry snapshot 内读取 total/summary/page，owner relation 与 project 合取，越权详情和旧 generation 拒绝，非法/过大页码拒绝；不返回未授权关联产品计数。Host 只读页面/BFF 已挂载；写入与关联动作仍在实施，因此仍不勾选本项。

  IP Host list/detail 页面与只读 BFF 已挂载，六项 BFF/Layer 契约和两模块 typecheck 通过。根复核发现的 useFetch 缓存缺口已修复：两个页面显式使用 useAssetsModule 的 session-scoped cacheKey，测试已补断言；不能将 moduleUrl 命名空间等同于会话缓存隔离。1440/390 本地验收因 Console runtime 配置接口 500、OIDC 登录失败未完成；写入与关联仍待迁移。

  Workflow 专用隔离脚本现同时执行 canonical DDL 的 `TestAimsCompletionApprovalTransactionMySQL` 和最小主体/恢复查询测试，均已通过 `-race`。真实目标命令验证创建与成功 receipt、响应丢失重放不重复实例、receipt 写失败整体回滚、自动批准路线拒绝后修复配置重试、真实 withdraw 回调及其持久化。此补齐目标事务证据，不证明 Host→Aims→Workflow 的实际服务身份、人工 replay、页面或目标环境授权验收完成。
  当前工作树 IP create/edit 已补 Registry 写事务、receipt 幂等、审计回滚、旧 generation 与写入前后范围检查。实际追加 receipt migration 保留产品/关联/数字资产 CHECK，隔离 MySQL 已验证 IP 错 capability 的 3819 拒绝。根补充真实 H3 POST/PATCH bridge 测试，覆盖会话 UID/tenant/Host permit、编辑授权、非法输入、幂等键、空 ID 与 401/403/409/503 保留；这仍不证明目标环境写入或产品/文档关联完成。

  根复核补齐 Workflow target BFF 入站 command hash 与 Foundation HMAC 验证，必须先于目录查询和 Runtime actor 重签；两项 BFF 适配测试及 Foundation 实际 HMAC 测试通过。event-less scheduled transport 缺少可用 Cloudflare binding/trusted Gateway 上下文，正式路由仍待补齐；当前未启用该 cron，不能将事件驱动 drain 验证推广为后台投递闭环。
- [ ] **INT-305** 统一后台任务注册与迁移开关：Host 不注册业务 cron，Gateway/Aims 已有 generation/storage fencing 与默认关闭机制；Assets、通知、milestone 等任务尚未逐项完成唯一 owner、正式身份、在途 operation、切换/回退及环境回读，暂不勾选。见[P3 就绪审计](./Unified-Enterprise-P3-Readiness-Audit.md)。（2026-09-15）
  2026-09-15 [逐任务所有权清单](./Unified-Enterprise-Task-Ownership-Inventory.md)已记录五个任务的旧 owner、目标路径、开关/generation、capability 与切换/回退证据：**只有 Aims integration drain 具备统一 owner 机制**（unified/generation=1，签名选择与 disabled/非法/恢复选择均有测试）；Aims 通知、milestone rollover（仍用宽 scope `aims.write`）、Assets 交付状态投递与 Assets 通知**均无统一 Runtime 路由**，且 Gateway 的 wake 集合不含 `assets`。环境为「零定时 owner」。关闭所需的最小工作见清单第 3 节。
  2026-09-15 迁移第一项 **Aims milestone rollover**：新增 `POST /v1/enterprise/aims/milestones:rollover-due`（精确 `aims:milestone-rollover:execute`，替代宽 scope `aims.write`；generation 头；扫描与逐条滚动均在 registry SHARE 锁 scheduler 事务内），唯一 owner 为 Gateway 签名 drain 唤醒；Runtime scheduler 为 unified 时 legacy 入口返回 `409 aims_milestone_rollover_unified_owner`，本地 cron 记 skipped。manifest 新增 `milestone-rollover` 资源并重新生成 Host 清单，v2.8 三 audience grant seed/verify 已补。Go 单测、Aims 测试与 typecheck、隔离 MySQL 滚动演练均通过。**同时修复本轮早先引入的缺陷**：`VerifyCompatibilityViewsTx` 以空定义比对视图，对任何真实已安装视图都判为缺失，导致 Assets 统一产品采用读取在真实库上必然 503（其 MySQL 测试只覆盖 legacy 路径未能发现）；现按 binding 计算精确定义比对，由滚动 MySQL 演练覆盖成功与缺视图两条路径。环境未执行 grant verify/签发探测；其余三项任务（Aims 通知、Assets 交付状态、Assets 通知）仍未迁移，本项不勾选。
  2026-09-15 迁移第二项 **Aims due notifications**：Runtime 到期通知 SQL 改经可注入存储（legacy 保持原自动提交语句，统一路径每步在 generation 锁 scheduler 事务内），新增 `POST /v1/enterprise/aims/notifications:scan-due|acknowledge|acknowledge-closure`（精确 `aims:notifications-due:execute`，v2.9 grant），唯一 owner 同为 Gateway 签名唤醒，legacy 入口在 unified 时 409、本地 cron 记 skipped。Go 单测、Aims 测试（13 项）与 typecheck、Host 测试（0 失败）、隔离 MySQL 演练（扫描/检查点/ack/闭环/陈旧 generation/缺视图）均通过。剩余 Assets 交付状态投递（统一写路径尚无生产者，需随客户交付资产写入迁移）与 Assets 到期通知，本项仍不勾选。
  2026-09-15 迁移第三项 **Assets due notifications**：统一调度链路从 Aims 专用扩展到 Assets——Runtime 新增按 app 绑定的 `WorkerSchedulerBinding` 与 `enterprise.assetsDeliveryWorker` 配置，调度鉴权改为 app 感知（客户端须为 `<app>.runtime`，既有 Aims 路由显式 `App: "aims"`）；Assets 到期通知 SQL 改经可注入存储，新增 `POST /v1/enterprise/assets/notifications:*`（精确 `assets:notifications-due:execute`，v2.10 grant），legacy 入口在 unified 时 409；Gateway 仅在持久化 `unified/recovered` 选择时签名唤醒 Assets，Foundation 信任 helper 接受 Assets 选择；新增 Assets 签名唤醒端点，本地 cron 记 skipped。Go 单测、Gateway 40 项、Foundation 信任 4 项、Assets typecheck/lint、隔离 MySQL（五项 scheduler 演练全部通过）均通过。现在仅剩 **Assets 交付状态投递**：统一写路径尚无该 operation 的生产者，须随客户交付资产写入迁入统一路径后再迁移，因此 INT-305 仍不勾选；三项已迁移任务也均未在环境执行 grant verify、签发探测与调度选择写入。
  **本轮修复的缺陷**：前两项（Aims rollover、Aims 到期通知）与 Assets 到期通知的 Worker 侧统一调用最初读取 Worker 静态配置的客户端与 Runtime 端点，而共享多租户 Worker 没有按租户的静态端点，生产中会失败；Aims `unifiedSchedulerWake.test.ts`（此前未纳入本轮回归）暴露了该问题，失败被唤醒处理器的 try/catch 掩盖为 `{failed:true}`。现改为与 drain 相同的事件绑定传输：Foundation `maybeCallTenantRuntime` 的统一调度分支由 Aims 专用改为封闭路由表（Aims outbox、Aims rollover、Aims 到期通知、Assets 到期通知各自固定 app 与精确 scope），选项更名为 `enterpriseScheduler`，签名唤醒按路由所属 app 校验并固定其 Runtime 端点与 generation。Aims 唤醒测试现断言 rollover 调用固定 generation 与精确 scope、到期通知受默认关闭开关约束。
  2026-09-15 依赖核对：Assets 交付状态投递的唯一生产者是 Altoc → Assets 服务命令 `customer-delivery-assets/{code}/activate`，其统一化需要改造 Altoc 调用方，归 INT-601～605，故 INT-305 最后一项按依赖后置而非本阶段强行迁移。另：C000001 激活仅安装 Aims 44 个、Assets 11 个兼容视图，三项已迁移任务所需的视图（如 `aims_notification_checkpoint`、`milestone_cycle_snapshots`、`assets_notification_checkpoint`、`customer_delivery_assets`）尚未安装，环境启用前须经受控视图安装步骤（generation 置 0 期间 plan/apply），否则各入口按设计返回 503。
- [ ] **INT-306** 完成真实页面 1440/390 检查：产品列表/产品线、结构、需求、版本、采用等主流程，以及空、失败、加载、只读状态；修复本次引入的溢出、缓存串用和运行错误。
- [ ] **INT-307** 完成 Host 类型/契约/构建与性能验证：复核套餐限制，记录 Worker 上传量、启动、并发内存、浏览器首次加载、导航和 SQL 指标；依据 INT-006 阈值给出结果。
- [ ] **INT-308** 准备兼容发布与回退制品：技术版本关联 Host/Runtime/schema/权限目录，保留按路由回退与旧应用访问新权威数据的适配；不能以回退 UI 为理由切回过时数据库。
  2026-09-15 复核已具备：`generate-release-manifest.mjs` 要求 Host/Runtime/schema/路径注册表哈希与已提交源码，且在 Host 清单过期时拒绝生成；[候选发布制品](../deploy/test-env/artifacts/C000001.enterprise-release-artifact-candidate.json)关联 Host tree/清单/权限目录、Runtime 版本、迁移计划（哈希对应 `C000001.enterprise-migration-plan.json`）、Gateway 与回退路由回执（哈希对应 `C000001.enterprise-host-full-candidate-20260914.json`）；按操作回退由 Registry 的逐操作 legacy/unified/disabled 模式承担（`TestResolveKeepsPerOperationMigrationModes`），旧应用读新权威数据走 `CREATE ... SQL SECURITY INVOKER VIEW` 兼容视图并在读事务内核验。发布/描述符/清单测试 12 项通过。
  **本轮发现并修复**：Aims 清单新增工作项 delete/start/reset/reopen 四个服务资源后，`enterprise/app.manifest.json` 未重新生成（发布清单生成器会直接拒绝）；已重新生成（permissionCatalogHash `04c72e73…`），并在 `manifest-artifacts.test.mjs` 增加提交清单与源清单一致的守卫。
  **仍不勾选**：候选制品（权限目录 `f4a70f67…`、Runtime `0.3.219`、`not-deployed`）、测试环境技术版本登记（`cc5cb624…`、`candidate.7-g1`）与当前源码（`04c72e73…`）三者权限目录哈希互不相同，**当前没有一个同时覆盖已部署版本与当前源码的固定技术版本**；该登记还是经管理员事务复用既有清单完成（标准导入事务停滞并回滚）。需在提交后以 `generate-release-manifest.mjs` 重新生成候选并登记同一哈希，回退演练随 INT-505/506 执行。

P3 完成条件：浏览器在一个企业会话中完成两个业务域流程，数据来自实际新路径；页面能打开或 mock API 验证不能代替联调完成。

## 8. P4 — 全量功能产品资格

责任：认证/授权负责人。权益清点可与 P1/P3 并行；身份接线依赖 INT-107。

- [x] **INT-401** 定义统一企业权益模型：保留整体开通、有效期、停用/恢复和实际运行状态；删除新购流程中的商业档位/按应用购买差异，明确技术版本仍保留。代码证据：[enterpriseEntitlement.ts](../platform/server/utils/enterpriseEntitlement.ts)、[enterpriseEntitlementState.ts](../platform/server/utils/enterpriseEntitlementState.ts)；隔离测试覆盖半开区间、未知/失效状态、停用优先级与不可续期恢复：[enterpriseEntitlement.test.ts](../platform/test/enterpriseEntitlement.test.ts)、[enterpriseEntitlementState.test.ts](../platform/test/enterpriseEntitlementState.test.ts)。
- [x] **INT-402** 制定历史权益转换规则：识别不同订阅有效期、订单和历史 License，输出可核对映射及待决冲突；保留原凭证和账务，不自动修改合同、续期或收费。代码证据：[enterpriseEntitlementRepository.ts](../platform/server/utils/enterpriseEntitlementRepository.ts) 的默认只读 `preview` 与显式 `apply` 分支；隔离测试保留来源事实并覆盖期间、订单、License 与绑定冲突：[enterpriseEntitlementRepository.test.ts](../platform/test/enterpriseEntitlementRepository.test.ts)，MySQL 演练覆盖漂移、重放与回滚：[test-enterprise-entitlement-mysql.mjs](../platform/scripts/test-enterprise-entitlement-mysql.mjs)。
- [x] **INT-403** 调整 Platform 开通、续用、模块目录和签名资格输出：新企业默认全量功能资格；老企业按迁移状态兼容，保留许可/部署撤销及恢复能力。代码证据：[enterpriseProvisioning.ts](../platform/server/utils/enterpriseProvisioning.ts) 仅接受当前有效 `enterprise-full` 资格并拒绝已撤销部署/许可/凭证，[policyBundle.ts](../platform/server/utils/policyBundle.ts) 按企业资格生成全量模块目录且保留 legacy 分支，[enterpriseManifestAccess.ts](../platform/server/utils/enterpriseManifestAccess.ts) 统一目录读取；隔离测试：[enterpriseEntitlementBundle.test.ts](../platform/test/enterpriseEntitlementBundle.test.ts)、[enterpriseManifestAccess.test.ts](../platform/test/enterpriseManifestAccess.test.ts)、[enterpriseOrderFulfillment.test.ts](../platform/test/enterpriseOrderFulfillment.test.ts)。
- [x] **INT-404** 调整 Console、Foundation、Host 的资格判断与提示：已移除逐应用购买门槛，区分人员缺权、未配置、未部署、服务不可用；模块配置开关不作为付费权益。代码证据：[enterpriseEntitlement.ts](../console/server/utils/enterpriseEntitlement.ts) 将模块配置/部署状态映射为独立 availability，Foundation/Host 共享的 [useApiErrorAlert.ts](../foundation/app/composables/useApiErrorAlert.ts) 与 [useUserApplications.ts](../foundation/app/composables/useUserApplications.ts) 保持人员、配置、部署和服务错误分开呈现；[enterpriseAssetsRead.ts](../enterprise/server/utils/enterpriseAssetsRead.ts) 保留精确人员读权限。隔离测试：[enterpriseEntitlement.test.ts](../console/test/enterpriseEntitlement.test.ts)、[consoleApplicationEntry.test.ts](../console/test/consoleApplicationEntry.test.ts)、[uiListAndFormatting.test.ts](../foundation/test/uiListAndFormatting.test.ts)。（2026-09-15 代码/测试证据复核）
- [x] **INT-405** 生成统一资源/动作/角色目录：已从模块 manifest 生成稳定 `permissionCodes`、资源和独立角色投影，保留原 manifest 以维持逻辑命名空间；顶层不生成企业默认角色，纯租户自定义角色只按其显式稳定权限校验。代码证据：[manifest-artifacts.mjs](../enterprise/scripts/manifest-artifacts.mjs) 和 [enterpriseComposition.ts](../platform/server/utils/enterpriseComposition.ts)；篡改、未知权限、重复角色/权限、自定义角色及 Platform 组合兼容回归见 [manifest-artifacts.test.mjs](../enterprise/test/manifest-artifacts.test.mjs) 与 [enterpriseComposition.test.ts](../platform/test/enterpriseComposition.test.ts)。（2026-09-15 代码/测试证据复核）
- [x] **INT-406** 运行授权矩阵回归：全量企业不自动授予全员权限；覆盖合并角色、模拟隔离、自定义角色、动作蕴含、部门/项目范围、敏感字段、过期主体及职责冲突。
  2026-09-15 按维度运行代码/测试矩阵（与 INT-404/405 同一证据口径），全部通过：Foundation 12 个文件 85 项、Console 11 个文件 82 项、Platform 9 个文件 47 项、统一 Runtime 企业 permit/scope/凭证/委托测试 30 项（1 项 `TestEnterpriseDirectoryHTTPMySQL` 因需专用临时 MySQL harness 跳过）。逐维度证据：全量资格不是人员授权——`console/test/policyBundleLifecycleAcrossLayers.test.ts`「enterprise-full is not a user grant」与 `platform/test/enterpriseEntitlementBundle.test.ts`「adds qualification without expanding automatic personnel grants」；合并角色——`applicationAuthorization`、`subjectScopedAuthorization`、`authorizationSnapshotBuilder`；模拟隔离——`authorizationSimulationRestrictions`、`scopedAuthorizationApi`、`consoleRuntimeAuthorizationClient`；自定义角色——`productScopeAuthorization`、`tenantRoleCopy`、`roleCatalogCategory`、`manifest-artifacts`；动作蕴含——`authorizationActions`、`scopeEvaluator`、`policyBundleV2Compat`；部门/项目范围——`dataAccessScope`、`projectScopeSemantics`、`scopeEvaluator` 及 Runtime 企业 permit 绑定；敏感字段——`integrationOperationDiagnosticProjection`、`notificationDetailSecurity`、`defaultLoginBaselinePermissions`「never grants sensitive actions implicitly」；过期主体——`subjectEligibility`「current or expired/missing grants」；职责冲突——`staticRoleConflicts`、`instanceConflictExplanation`、`platformInstanceConflictExplanation`。
  边界：这是代码层回归，不替代固定制品下两租户四主体经真实会话的权限矩阵（归 INT-501/503）。
- [ ] **INT-407** 迁移演练并核对业务入口：验证新企业、原不同商业档位企业、失效/停用企业、未配置独立能力；更新操作手册，说明全量功能与岗位权限的区别。
  2026-09-15 已完成：[统一企业资格操作手册](./Unified-Enterprise-Entitlement-Operations.md)说明企业资格、岗位权限、运行状态三者分别判断，以及新企业、旧档位转换、失效/停用、未部署/未配置的处理与暂停/撤销/恢复规则；一次性 MySQL 演练 `platform/scripts/test-enterprise-entitlement-mysql.mjs` 通过（状态流转、租户隔离、并发重放、漂移、回滚、旧记录保留、新企业开通、签名 License、停用、Host 入口与签名边界）；场景代码测试覆盖旧档位预览保留、异期待核对、停用/撤销/过期失败关闭、未配置不制造就绪或升级门槛。
  **仍不勾选**：[权益合同](./Unified-Enterprise-Entitlement-Contract.md)第 4 节要求隔离测试租户的脱敏映射及开通/转换/停用/恢复/独立能力配置的实际入口回执，并明确「没有实际环境证据时不勾选 INT-407」；该环境演练尚未执行。

P4 完成条件：新旧企业不再因为缺单应用购买资格而受限；人员权限不扩大，旧签名资格和技术版本仍可被正确识别。历史资格存在实质合同冲突时单独处理，不阻塞无冲突企业的代码与演练准备。

## 9. P5 — 联合验收与逐租户发布

责任：整合/验证负责人。依赖 P2/P3/P4 完成；测试环境可以提前部署独立可验收制品，不提前关闭旧路径。

- [ ] **INT-501** 汇总测试证据：真实隔离 MySQL、API/身份合同、数据迁移、权限矩阵、桌面/手机、性能和回退；列明 mock、隔离环境与真实租户验证的边界。
- [ ] **INT-502** 更新测试环境部署模板及预检：Host/Gateway 路由、Runtime schema、bindings、secret 引用、任务所有权和技术版本一致；实际签发并核验仍跨信任边界的全部所需 scope 组合。
- [ ] **INT-503** 在明确的测试租户执行完整业务链：产品主档维护、接入管理、需求入版本、确认计划、项目承接与适用的验收流程；记录实际写入对象、结果、重复操作和清理策略。
- [ ] **INT-504** 测试真实故障恢复：Runtime 离线、会话失效、权限撤回、事务中断、目标已提交但响应丢失、旧 outbox 重放、任务租约交接；恢复后无重复写入和丢失更新。
- [ ] **INT-505** 固定试点上线制品与运行手册：备份恢复验证、写入暂停范围、操作窗口、责任人、观察指标、回退触发条件及新写入后的恢复方法齐备；按当前授权完成相应环境的发布准备。
- [ ] **INT-506** 执行获授权的试点租户切换：确认唯一写入方、数据/权限/任务水位、实际版本与流量；观察期长度依据业务周期确定，至少覆盖一次相关后台任务周期和完整业务操作。
- [ ] **INT-507** 出具试点验收报告：对比 INT-006 的调用、同步和配置数量以及性能；列明保留边界、未迁移模块、遗留风险和进入 P6 的条件。

P5 完成条件：实际租户可用且数据恢复可靠；不以一次构建成功、页面 200 或授权 SQL 行存在代替完整验收。

## 10. P6 — 按业务链扩展

责任：整合负责人按链路组织模块负责人；依赖 P5。每条链重复 P0 的映射和 P2/P5 的迁移/验收，不复制不适用的实现。

- [ ] **INT-601** 排定下一批顺序：以用户实际业务和跨模块故障频率确定优先级；建议先评估 Altoc 合同/交付与 Aims 项目，再扩展 Finance、People，不能因同库就扩大可见范围。
- [ ] **INT-602** 整合 Altoc ↔ Aims：客户/合同引用、项目承接、里程碑与服务工单结果；逐项区分可用本地事务替代的内部 outbox 与仍需异步的动作，保留历史回执和命令身份。
- [ ] **INT-603** 整合 Altoc/Aims ↔ Finance：经营回款计划、可开票依据、实际发票/到账/核销保持各自语义；测试金额精度、并发、作废/冲销、历史快照和敏感权限。
- [ ] **INT-604** 整合 People ↔ Aims/Finance：统一人员身份引用、任职与成本快照、工时贡献；当前资料与历史成本分开处理，岗位变更/离职权限撤销继续可靠生效。
- [ ] **INT-605** 迁入对应 Layers 与 BFF：每新增模块复核路由、依赖、缓存、任务、浏览器加载和 Worker 容量；指标不达标时保留独立执行单元，不退回分商业版本授权。
- [ ] **INT-606** 收敛 Codocs/Workflow/Collab 等边界：Codocs 文档领域保留，普通页面与自有完整编辑工作区以 Host 原生组合为目标；协作、转换、隔离预览等按能力保留后台服务，不将完整独立 Codocs 前端列为长期目标。明确长连接、编辑器、导出与后台执行需求；旧页面/iframe 只作有消费者和退出条件的兼容，未迁能力仍按真实配置接入。

  **当前摘要（2026-09-21；原 2026-09-20 `91790e7b` 证据保留，后续 Host 修改在工作区）**：9 个非演示 mydocs 页面、工作汇报同页兼容入口及 Host/Runtime 接线已有非页面验证；原完整 `documents/[uuid].vue` 已作为 Host 路由候选接入，本机 hzy0 可显示正文、工具栏与侧栏。版本 403 已定位到 Runtime 委托路由漏传受信 actor 标记并在源码修正，但 hzy0 当前连接的 Runtime 尚未更新，环境 403 仍在；正式协作 token/WS、共享编辑及写入恢复未验收。目标是原生完整工作区而非长期独立 Codocs 前端；本地独立编辑器进程与旧页面仅为兼容/回退消费者保留。下一步是动作核对和真实依赖/写入恢复取证，不是重新注册页面。INT-606c、d 均不勾选；d 尚未完成，个人/部门各自保留待验收项。下面按日期保留早期“独立编辑器”“未注册”等过程描述，不覆盖本摘要。范围、逐 API 及测试映射见[接入边界](./Codocs-Enterprise-Integration-Scope.md)与[路由盘点](./Codocs-Enterprise-Route-Inventory.md)。

  **2026-09-21 本机文档编辑安全收口（工作区候选）**：发现 Host 共享名单请求失败时，空数组会被误判为“私人未共享”，使页面开放普通 HTTP 编辑；已改为共享状态成功核验前保持只读，并提供重试核验。Host 不再展示会调用未接入 token/WS 的“重连协同”。Enterprise/Codocs typecheck、文档边界及相关 Host 请求测试通过；本机浏览器可重新显示完整正文页。未写入真实文档；版本 403 与正式协作仍待定位/接入，不标记 INT-606c 完成。

  **2026-09-21 版本读取增量（代码已修、环境待更新）**：版本 list/view/delete 的 Enterprise 委托查询已在拒绝调用方自带 query 后，补入仅由已验签路由设置的 `hzy_runtime_actor_delegated=1`；此前缺失此标记会被 Codocs 版本读取适配器在查库前以 403 拒绝。定向 Go server/Codocs 测试、Enterprise/Codocs typecheck 与文档工作区测试通过。侧栏现将 403/503 与真实空版本列表分开显示，并提供重试；hzy0 浏览器已看到完整原文档页及明确的版本 403 提示。当前 hzy0 仍连接未更新的远端 Runtime，本轮未部署或修改云端，不能据源码修正宣称环境版本链已通过；正式协作与写入恢复继续待验。

  **2026-09-21 指定版本读取收敛（代码候选）**：核查确认旧 `queryPaged` 实际返回全部版本，并非第一页遗漏；问题是详情沿用全量列表后在 Host 过滤。现已为 version-view 固定 `/versions/{versionId}`，在 Codocs 当前 ACL 后按版本 ID 与文档 ID 精确读单行；无匹配 404，非法 ID 或未委托 actor 在存储前拒绝。Host 直接校验单行响应，不再取全量列表。Go Codocs/server 定向测试、Enterprise typecheck 和版本桥测试通过；hzy0 尚未更新 Runtime，实际版本内容与 OSS 仍待环境验收。

  | 动作链 | 已有非页面证据 | 待补真实证据 |
  | --- | --- | --- |
  | 基础文档 | 创建/上传/读取/元数据/下载 bridge 与合同测试 | 创建、编辑器保存再读取、重命名、移动、下载；响应丢失重试不重复，存储失败不假成功 |
  | 资料整理 | 最近/收藏读取、回收站删除/恢复测试 | 正确用户与目标范围，恢复后可用，切换会话无迟到污染 |
  | 文件柜 | 读取/上传/删除/转换及下载测试，转换条件写与重放回归 | 真实 OSS/MySQL 并发、PPT/PPTX 预览下载、转换失败恢复；不迁演示专用能力 |
  | 共享协作 | 分享、移交、发布执行及对象范围合同测试 | 授权/调权/撤销/移交与既有发布动作；撤销后详情、正文、下载均拒绝 |
  | 工作汇报 | worklogs、personal-weekly-reports 合同与兼容入口测试 | 创建/提交/修订；主入口和旧入口同记录同页签，不生成第二套系统 |

  **环境阻塞/前置**：核验当前制品正式 grants 的安装与签发、服务身份、编辑器/Collab 地址、数据库与对象存储；记录真实 MySQL 隔离/并发和 OSS 失败恢复，而非用 SQLmock/H3 代替。[9/19 单文档预览记录](../deploy/test-env/DOCUMENT_PREVIEW_20260919.md)只证明当时单次预览；所用桶与生产共享、正文来自部门路径复制，不能证明个人最后版本或全链通过。写入/故障/清理测试前必须落实隔离测试桶或受控前缀、测试对象及清理边界，不对既有生产对象故障注入。

  **2026-09-20 动作取证增量**：新增 `enterprise/test/codocs-document-share-revocation-chain.test.mjs`，通过真实 Host GET（`skip_content=1` 元数据、带正文读取、下载）和真实 DELETE 分享路由串起撤销前后：撤销后三种请求均拒绝、OSS 读取不增加。Runtime ACL 与存储是隔离夹具，只证明 Host 每次取权和拒绝后不读存储，不代表真实 DB 撤权传播通过。创建同 key 重放/失败重试已有 `codocs-document-creation.test.mjs`，不重复开发。编辑器 PUT 响应丢失后的重试是下一项恢复核查：`enterpriseCodocsDocumentUpdate.ts` 当前在 Runtime 回执前重新 PUT OSS，Runtime `personal_document_update.go` 从命令摘要排除 OSS version 并用事务回执去重，因此不能仅凭重复 PUT 推断重复 DB 版本；仍需证明“成功丢响应 → 后续编辑 → 旧请求重试”不会覆盖较新正文，以及保存后正常读取的一致性。该风险尚未关闭，不能标记文档写入闭环验收。

  **2026-09-20 保存重放核查及局部修正（后续增量，未提交/部署）**：新增真实 Host PUT HTTP 回归，先在原代码复现 A 已提交丢响应、B 已提交、重试 A 把当前正文从 B 写回 A。现新增只读 Runtime `personal-documents:update-plan`，先校验当前 owner/write-share/只读/删除及完整回执；同 key 已成功在任何 OSS 调用前返回 replay，异命令冲突在存储前拒绝。计划与 commit 共用原 v1 摘要/namespace，保留历史回执；新写入后重新获取人员授权才提交 Runtime。未增 grant/schema，不更换旧对象路径或编辑器入口。

  证据：`codocs-document-update-replay.test.mjs` 覆盖上述连续链、异内容同 key、撤权/只读分享、依赖故障、存储失败、存储后撤权不提交；Runtime `personal_document_update_test.go` 覆盖只读 plan、回执验证/processing NULL 字段、历史摘要一致、commit 重放不插版本及 ACL，server 新计划路由覆盖 actor/tenant/deployment/action/expiry 与字段边界。Enterprise 全量 169 项中 168 通过、1 项原有可选测试跳过；Foundation Runtime client 196 项通过；Go Codocs/server/integrationoperation 三包通过；Enterprise typecheck 通过。所有存储/业务数据库写入均为隔离夹具，没有访问共享 OSS 或真实业务数据。

  **仍阻塞写入闭环/发布**：只读 plan 不是预占锁；两请求都未完成时的竞争、OSS 成功但 DB 失败或撤权后的恢复、Collab 同路径写及旧 writer 协调未关闭。已核对 [OSS PutObject 文档](https://www.alibabacloud.com/help/en/oss/developer-reference/putobject)：版本控制开启/暂停时防覆盖头无效，文档未承诺 PUT If-Match；未添加虚假的条件头保证。下一步需冻结并验证适配既有编辑器/Collab 的写入协调或不可变版本发布合同，再落实隔离桶验证；不能把本次成功回执重放修复升级为并发安全/真实 DB/OSS 验收通过。创建/文件柜旧“条件写”证据同样须按实际桶版本模式复核。

  2026-09-20 后续内部事务增量（基于 `ddfd84a9`，未提交/未启用）：[写入协调合同](./Codocs-Document-Write-Coordination.md)已核对 Host/旧 Codocs/Collab writer 与正文/Yjs reader。新增 Runtime 候选准备/发布方法及两张表定义，限 private 文档内容；候选命令与发布结果持久化，head generation/epoch、正文/Yjs 精确版本引用、候选发布记录和文档大小/编辑者同事务，存储 verifier 在事务外、ACL 在提交时重验。Luna 补输入边界测试；主线完成独立临时 MySQL 8.0.34 的 7 组实际事务场景（双命令/同命令竞争、迟到重放、校验失败、晚失败回滚、撤权、epoch/配对、schema CHECK/命名空间），`-race` 通过；Go Codocs/server/integrationoperation 三包 race 通过。临时库与 datadir 已清理，未访问真实业务 DB/OSS。无 HTTP 注册、无生产 verifier、无目标 schema 安装，既有保存路径不变；Collab epoch 生命周期、普通覆盖互斥、全部读者/旧 writer 与正式认证接线仍待实现，不能据本增量关闭 INT-606c 或发布门禁。

  **部门独立批次**：主线个人文档代码收口后可准备 INT-606d 的代码及环境，不必等暂缓的浏览器验收，但不能据此标个人或部门业务通过。先固定“员工提交个人汇报 → 获授权主管看团队提交情况 → 打开允许内容 → 按既有流程处理”的权限合同；主管身份不自动获得全部个人文档。部门目录/文件柜与分享范围分别取证；旧项目页面不迁，项目周报后置。

  **2026-09-19 用户调整顺序**：Codocs 先迁整个“我的文档”（全部 mydocs 页面及可达既有动作，包括文件柜、共享/移交、日志/周报、演示等）、再迁部门文档；旧 Codocs 项目页面不迁移，数据保留，后续由项目管理承接。该准备工作按用户当前优先级提前进行，不表示 P5 已通过；保留 Workflow/Collab 运行边界，但 mydocs 动作所需接线在范围内。范围、源文件、耦合及验证输入见 [Codocs 接入边界](./Codocs-Enterprise-Integration-Scope.md)。
  - [ ] **INT-606a 范围与盘点**：两位 GPT-5.6 Luna 已完成全部 10 个 mydocs 页面的初步依赖与测试/注册模式盘点，并更新模块指南；日志/周报、演示及共享副作用已列入。主代理下一步补齐逐 METHOD + API + capability + Runtime 对照，故完整盘点暂不勾选。保留编辑器兼容入口、数据不搬迁和项目功能后置边界。未注册新页面、未新增 API、未发布。（2026-09-19）
  - [ ] **INT-606b 个人文档合同**：主代理定义 Enterprise → Runtime 文档领域的身份、具体 capability、owner/分享范围、存储编排、编辑器与旧 URL 兼容；补齐工作汇报主路由、页签及旧入口到同一实现的对照，菜单归位不变更数据/Runtime 归属。Luna 按固定合同补独立测试/机械注册。不得重建多跳项目文档代理或放宽旧鉴权。
  **2026-09-24 写入协调与协作**：v2 快照保存阶段 A 已在 hzy0 端到端实测（开关默认关闭，仅 hzy0 开启），阶段 B（协作接入 v2）Runtime 侧已实现并默认关闭，详见[写入协调合同](./Codocs-Document-Write-Coordination.md)。协作引擎长期方向见 [ADR-020](./ADR-020-Ygo-Collab-Connector-Runtime-Integration.md)（ygo 并入 Connector Runtime，延期）；阶段 B 仍用现有 Node Collab，其 `collab.runtime` 身份与会话合同与引擎无关，将来复用。
  - [ ] **INT-606c 我的文档闭环（演示后置）**：迁入除 `mydocs/slides.vue` 演示文稿外的 mydocs 页面树及可达既有动作，基础 CRUD、文件柜、最近/收藏/回收站、共享/移交/发文相关动作、日志/工作日志/个人周报仍在首批。工作日志/个人周报主入口改为“工作台 → 我的工作 → 工作汇报”，我的文档仅保留指向同一页面的兼容入口；不是后置该功能或保留两套实现。先基础及编辑器、再工作汇报/共享副作用、最后统一验收；除用户明确后置的演示外不再裁剪范围。逐动作证明 API 与后端权限可用；页面验证仍按用户要求暂缓，不能因此省略页面实现和非页面验证。
  - [ ] **INT-606d 部门文档与团队汇报**：复用已实现且具备相应代码证据的基础能力，环境与业务验收另列，补部门与分享范围、移动/恢复归属；团队汇报目标入口为“工作台 → 团队管理 → 团队汇报”，后续部门批次落实主管可见范围，新增提醒等能力另行明确，不扩大首批。部门发文等额外依赖分别排批，不随整页自动装入。项目周报留在后续项目管理阶段，与个人周报分开建模；不迁旧项目页面。

  - [ ] **INT-606e 演示文稿后续迁移（本轮仅记录）**：按用户最新决定，`mydocs/slides.vue`、演示专用编辑/预览/导出、`/api/slides/**` 接线及验收延后，不再阻塞当前整合目标；后续单独排期。旧功能和数据保留，已实现通用文档合同中的 slide 兼容不回滚。文件柜 PPT/PPTX 上传、预览和下载仍属 INT-606c。

  **2026-09-19 最新范围决定**：用户明确“演示文稿功能可以留在以后迁移，记录下来即可”。本决定覆盖本节早期“演示仍在首批”的历史描述；其余个人文档、工作汇报、共享、文件柜和部门阶段安排不变，不以本次调整标记整体完成。

  **2026-09-19 实施中（页面验证按用户要求暂缓）**：已开始实现 Codocs Host 路径/缓存隔离与个人文档四个读取 BFF → Runtime 候选，保留独立 Codocs DB、精确 capability 和签名 actor；源 API/直接依赖见 [路由盘点](./Codocs-Enterprise-Route-Inventory.md)。Host 已显式注册带 UUID 的独立编辑器兼容路由，编辑器/Collab 仍由 Codocs 运行时承载；在首个 mydocs 列表页完成前不发布虚假的模块首页跳转。这不代表首批完成：共享副作用、日志/周报、完整 mydocs 页面依赖与注册、manifest 组合/grants 和非页面全链验证仍在范围内；演示按 INT-606e 后置。

  文件柜转换新增候选：Host `to-document` 已接固定 conversion-plan/convert；源 owner/个人范围、双业务权限及精确 capability，正文条件 PUT 后重新授权，原 Codocs DB 同事务创建文档、owner relation 与源关联。相同 key 重试不重复创建、不覆盖后续编辑、不重置后来关联；客户端隔离会话/选中文件的迟到响应。演示仍后置；页面/编辑器传递依赖与注册、共享/发布/工作汇报、部门阶段、环境安装与真实 DB/OSS/非页面联调仍未完成。此增量不勾选 INT-606c，不自动提交或发布。

  目录与会话增量：文件柜转换目录按 page/pageSize=20/total 真实分页，支持跨页保留选中目录、错误重试与总数缩小时回退页码；standalone folders BFF 保留分页字段及 401/403/503。文件柜列表与选择按用户/租户/Host cache scope 隔离，同 UID 切换租户立即清空预览，旧删除或转换响应不能污染新会话。实际 Vue setup 与目录 handler 隔离测试覆盖以上行为；没有执行页面验证，仍不注册尚未闭环的 Codocs 页面。

  预览依赖增量：useDocumentPreviewBootstrap 已以 module cache scope + user/tenant 隔离正文，切换同步清理并永久废止旧实例；同一 tick 的 A→B→A、迟到旧 setter、Host 部署单独变化、logout、一次性 consume 与 standalone clear 均有执行测试。Node 24.18.0 下 Codocs typecheck 与全量 253 项测试通过。Host 入口盘点仍缺显式组件/composable 接线、独立编辑器 URL 和共享/工作汇报后端闭环；未引入 Codocs 全局插件/布局/登录，未启用生产或执行页面验证。

  编辑器导航增量：Host 已显式注册 `/codocs/documents/:uuid` 兼容页，独立 Codocs 地址必须由 `HZY_CODOCS_ORIGIN` 显式提供；iframe 消息限定到配置来源并校验消息来源窗口，不再使用 `*` 或 localhost 回退。除后置演示页外，个人文档、收藏、最近、文件柜、日志和个人周报的编辑跳转统一经校验 helper：standalone 保持 `/documents/:uuid`，Host 固定 `/codocs/documents/:uuid`。模块首页在首个 mydocs 列表页闭环前不发布虚假跳转。路由 helper 4 项、Enterprise 注册/导航 17 项及两端 typecheck 通过；共享与工作汇报 API、完整页面依赖/注册、环境地址/grants 及非页面联调仍待完成。

  个人周报增量：Host 已新增年份列表和创建入口，owner 永远取签名会话 actor；列表固定 `weekly-report` 类型，创建复用个人文档条件 OSS 写与持久回执，并将 `weekly-report` 纳入 Runtime 个人创建白名单。两个可达创建页面均按 Host 会话、年份和周次保留稳定 Idempotency-Key，失败重试不换键、成功后才清理。Cloudflare 配置生成器现显式传递公开的 `NUXT_PUBLIC_CODOCS_URL`，编辑器地址仍禁止凭据、路径、查询和 hash。readiness/合同 9 项、编辑器来源/窗口边界 2 项、Codocs/Foundation/Enterprise typecheck 及 Go Codocs/server 包通过；工作日志、共享/发布副作用、页面依赖注册、真实环境地址/grants/DB/OSS 联调仍待完成。

  Manifest 组合增量：Enterprise 的唯一组合生成源、release 新鲜度校验和 release source tree 已纳入 Codocs，不再出现页面/API 已注册但授权目录仍只有 Aims/Assets 的分裂状态；顶层继续不合并默认角色，保留 `codocs:*` 逻辑命名空间。已重新生成 `enterprise/app.manifest.json`，组合/篡改/release 共 7 项测试通过。该清单只提供环境安装输入，不证明 C000001 或生产已安装 Codocs grants；实际 seed/verify、bundle 刷新与签发探测仍必须单独完成。

  工作日志增量：Host 已新增按月列表和创建入口，日期必须是有效公历 `YYYYMMDD`，owner 固定签名 actor；创建使用 `worklog` 类型及个人文档幂等 Runtime/条件 OSS 编排。两个可达页面按 Host 会话与日期保存失败重试键，成功后释放，避免删除后重新创建仍被旧成功回执截获。列表同时窄查新 `worklog` 和旧 `private` 文档，兼容 `YYYYMMDD-*工作日志`、`工作日志_YYYYMMDD` 两种标题；个人周报同样同时读取新类型和旧 private 数据，不迁移原数据。readiness、日志/周报合同和 manifest 共 18 项、两端 typecheck、Go Codocs/server 回归通过；真实 H3 日志/周报请求测试和环境 DB/OSS/grants 联调仍需补齐。

  共享中心读取增量：Host `/codocs/api/collab-docs` 已接签名 actor 与现有 Codocs 协同关系查询；浏览器只能提交 category/scope/keyword/department/owner 筛选，不能注入 current user 或可信执行标记。普通读取使用 `codocs:collab-documents:read`，只有当前 `reviews:admin` 权限成立时 Host 才选择独立 `review-admin` capability，Runtime 才加入待盖章管理员视图。三个执行弹窗的 API 地址已适配 Host 前缀。seal/send/receive 写合同已通过 Host 精确业务权限、签名 Runtime permit 与原状态机接通；弹窗按会话+请求内容保留失败重试键，发送登记分别向发起人回执、向指定发送人提醒待确认接收，两条通知均可幂等重试；表单 8 种发送方式与 Host 校验已对齐。相关 H3/readiness/manifest 16 项、创建尝试 2 项、两个 Go 包及 Codocs/Foundation/Enterprise typecheck 通过；其后的详情页增量见下段。

  文档详情增量：共享列表/授予/调权/撤销、共享已读回执、批注及回复、版本列表/正文/删除、按文档或 OSS 路径查询发文记录已接入 Host 精确路由与签名 Runtime permit，公司资产发布历史另要求 `admin:admin` 与 `company-read`。编辑器正文 `PUT` 已改走 Host，Host 只从 actor-bound 元数据取 OSS key，Runtime 在同一 receipt-backed 事务中重验写 ACL、更新文档元数据并记录 OSS 版本。页面不再提交作者/处理人身份，写操作按会话与 payload 保留重试键。Go Codocs/server、Codocs/Foundation/Enterprise typecheck、readiness/manifest 及 28 项 Host 合同组合测试通过；本段记录时尚待的共享通知、部门/项目移交、批注数据库级 receipt 和页面注册，已由下述第一批非页面收口增量完成。

  第一批非页面收口增量：9 个非演示 mydocs 页面已经显式组合进 Enterprise，旧 Codocs Shell、Store、登录与后台任务未装载；组件和 Tailwind 来源按白名单接入。主菜单落在“文档”，工作日志/个人周报落在“工作台 → 我的工作 → 工作汇报”，两个旧 URL 共用 `journal.vue` 并保持对应页签。部门/项目移交完成 Host 成员校验、Runtime owner/范围重验、跨桶对象编排及持久回执；批注 create/update/reply/delete 也改为 ACL、业务写和回执同事务，消除重试重复。生成 readiness 与组合 manifest 已刷新。Enterprise 生产构建、Enterprise/Codocs/Foundation 全量测试、三端 typecheck、Runtime Codocs/server/integrationoperation 测试均通过；页面验证按用户要求未执行，环境部署和生产数据迁移不在本次代码提交中。

  转换验证证据：真实 H3/Foundation 与真实 DOCX→Markdown 测试覆盖 plan→get→条件 PUT→新鲜授权→commit，存储失败/撤权不提交，409/412 并发赢家摘要及长度核验、成功重放跳过 OSS；SQLmock 覆盖锁查询、owner/scope、源状态变化、重放不重连、文档/关系/关联失败回滚，Go apps/codocs、server、integrationoperation 包通过。SQLmock 不证明真实 MySQL 隔离/并发。Codocs 全量 251 项测试、两端 typecheck、Host Cloudflare 构建通过；仍未部署或执行页面验证。

  早期阶段验证证据（保留历史，不作为当前注册状态）：Codocs 路径 helper 测试 3 项、Enterprise 注册/readiness 18 项、四读取入口真实 H3 HTTP bridge 测试、`go test ./internal/server ./internal/apps/codocs`、Enterprise/Codocs typecheck 通过。前三个源页面当时已适配 API 前缀/会话缓存，但尚未注册到 Host；编辑器当时仍待固定独立 URL/预览合同。四读取入口只证明候选元数据链，不证明正文、写入或环境可用。

  后续增量：全部 10 个 mydocs 源页面已适配本页 API 前缀与缓存；传递组件/composable、编辑器导航和目录替代接口仍待闭合。新增 Host 元数据 PATCH → Runtime 精确 edit-metadata（只改标题/目录/收藏/只读等、保留 OSS key），补 slide 目录个人 owner/父目录隔离。Go server/Codocs 回归与两端 typecheck 通过。发现原 Runtime 目录详情/更新/删除仍是 contract-required，下一步须补专用 owner/部门范围合同，不能靠注册或绕过鉴权解决；全量写入/对象存储/共享等范围继续保留。

  目录合同增量：已实现 scoped GET/PATCH/DELETE folder 路由、Host 三方法接线、精确 capability、事务内 owner/部门与父目录循环/空目录校验；sqlmock 和 Go server/Codocs 回归通过。元数据底层补 readonly-owner 与移动目标 namespace/同名冲突校验。仍需目录创建 Host 接线及真实数据库并发验证，不能把上述局部测试视为完整目录/文档业务验收；首批完整功能与剩余非页面验证继续进行。

  创建/正文增量：Host 目录 POST 已接入精确 create capability 和原 Codocs DB 持久回执；新建/重放/不同 payload/撤权/rollback 的 sqlmock 与 HTTP 测试通过。Host 文档详情开始复用正文/Yjs恢复，OSS 请求级配置隔离并发测试通过；发布文档访问记录、冲突元数据、附件和全量写链仍待补齐，真实数据库/存储联调及环境 grants 不因这些测试而计完成。

  下载/审计增量：Host Markdown 下载采用独立 export 能力；company 正文读取及下载已接内部访问记录合同，记录前重验当前 ACL 和 OSS 路径摘要，使用服务器事件 ID 幂等写原 Codocs 访问表。skip_content/非 company/存储失败不记录；审计失败不交付正文，401/403/409 保留脱敏状态，依赖故障 503。Host HTTP/正文与下载测试、readiness 共 14 项及 Enterprise typecheck 通过；仍未注册页面、安装环境 grants 或完成全量非页面链路，既有完整 mydocs 和部门阶段范围不缩减。

  文档创建增量：新增 Host `POST /codocs/api/documents` 直达 Runtime 精确 create；私人/演示文稿使用稳定 UUID 与请求摘要路径，复用既有文档+owner relation 事务及 UUID 唯一键，同目录重名仍 409。个人目录在创建事务中加锁重验，重复请求不 INSERT，正文 HEAD/条件 PUT 不覆盖后续编辑，存储失败保留同 key 修复。两个源页面的创建请求已保留失败重试键并隔离会话/内容变化。HTTP、路径和 readiness 共 19 项 Node 测试及含事务/sqlmock 的 Go server/Codocs 包通过，两端 typecheck 通过。此证据不包含真实数据库并发与存储联调；上传/正文覆盖、回收恢复、共享/文件柜/工作汇报/演示其余动作、页面依赖注册、环境授权及部门阶段仍在范围内，整合未完成。

  上传增量：Host multipart Markdown 上传已复用同一 create 编排，保留逐文件结果、部分失败重试与条件写防覆盖；批次指纹绑定文件字节/顺序/目录/会话，单项 key 绑定租户/部署/actor/批次/序号。Console best-effort 操作审计增加 event/稳定 key 支持，经 Service Binding 而非 eventless 公网路径；并保留物理 enterprise 身份。HTTP、创建重试/文件指纹、Foundation 审计和 readiness 相关 19 项 Node 测试通过，Enterprise/Codocs/Foundation typecheck 通过。未进行真实存储/环境审计授权验收；正文覆盖、回收恢复和完整 mydocs 其余动作及页面注册仍待继续，不把上传候选视为整体完成。

  回收前置增量：已新增 Host check-name 固定读取合同并绑定个人 actor；trash 支持个人类型筛选且 owner 固定当前用户。useRecycleBin 的三个 URL 适配 Host，名称/列表失败不再伪装无冲突或空列表，弹窗失败时禁止恢复。相关 Node HTTP/composable/readiness 10 项及两端 typecheck 通过。恢复写入尚未接线：核对发现旧 BFF 先 OSS 移动再 DB 更新，必须以预检/绑定提交和重试合同解决，不能以追加后置校验冒充安全恢复；完整首批与部门范围仍保留。

  软删除/恢复增量：Host DELETE 已使用精确 delete，原正文/Yjs key 保留，状态与回执同事务；POST restore 已接只读计划、条件复制、绑定提交。原 codocs/ key 不变，历史 recycle.bin/ 对象复制至 UUID/状态摘要隔离路径，保留源文件；复制缺失/故障不提交数据库，提交前重新取得 edit 权限。Runtime Serializable 事务重验当前文档/分享 ACL、只读状态、原目录归属及同名冲突，回执将用户意图绑定为摘要，迟到重放不重复恢复后来再次删除的文档。HTTP/SQLmock/客户端重试及固定路由测试覆盖失败与重放；这些仍是本地候选证据。完整页面依赖/注册、正文覆盖与附件、共享/移交/发文/文件柜/工作汇报/演示剩余操作、真实 DB/OSS 与环境授权、部门阶段继续实施；回收保留期和物理清理仍须核验，整体目标未完成。

  文件柜读取增量：Host 已新增个人柜列表、文本/直接/Office/PPTX 预览、下载及转存信息入口，固定 Runtime personal-cabinet read/export 精确能力，原 Codocs DB 继续按当前 owner 排除部门/项目柜，转存目标另查当前文档 ACL。存储使用 event 隔离配置，Office HTML sandbox，下载独立 export。源列表接入真实分页/total、错误重试和预览请求隔离，standalone BFF 同步保留分页数据。正文覆盖盘点确认旧 HTTP 仅写 Markdown，无法协调活跃 Collab/Yjs；该写链仍需专用合同，不能直接搬旧 handler。文件柜上传/删除/转换、其余 mydocs/部门功能、页面注册/构建、真实环境授权及非页面联调继续推进，整合目标未完成。

文件柜删除与验证增量：Host DELETE 已使用固定 personal-cabinet:delete、documents:delete 当前授权和 Runtime owner/非部门项目行锁；软删除状态与持久化回执同事务，旧成功重放不再次删除恢复后的记录。同 key 不同文件 409，OSS 原文件及转存文档保留；源页面失败重试键按会话/UUID 隔离。真实 H3/Foundation 请求、SQLmock 事务、Vue setup 重试状态和 readiness 测试已补。此前 Codocs 全量 9 项失败确认为 Node 原生 TS 的无后缀模块解析问题，收敛到仅测试进程的解析 hook 后 251 项全部通过，不修改生产 imports 或扩大 TypeScript 配置；Codocs/Enterprise typecheck、Go Codocs/server/integrationoperation 三包和 Host 文件柜/readiness 10 项请求级测试通过。Mammoth 与现有 xmldom 0.9.10 的 MIME/onError 兼容补丁已通过真实 DOCX 夹具、离线 frozen-lockfile 安装及前一轮 Enterprise Cloudflare 构建。以上不是页面验收或环境启用证据；上传/转换、完整 mydocs 其余操作、页面依赖注册、真实 DB/OSS/授权联调及部门阶段仍继续。

  文件柜上传增量：Host 已接 multipart→只读计划→条件 OSS 写入→重新授权→Runtime 事务提交，精确 personal-cabinet:create，保持原扩展名集合与单文件 100 MiB 合同。稳定 UUID 与完整元数据摘要路径保证重放不重复、不覆盖存储对象，不复活删除文件；目录与文件归属在规划和提交时重验，元数据仅在存储成功后写入。前端逐文件发送、保留部分失败重试键，字节/顺序/会话变化隔离；指纹计算期间防重复提交，同账号切换租户停止后续请求。Go Codocs/server、客户端真实 setup 重试测试、两端 typecheck 和 Enterprise Cloudflare 构建通过；文件柜/readiness 11 项请求测试通过，额外复核了实际 100 MiB 成功提交、上限加 1 字节 413、不匹配对象拒绝提交及 plan→PUT→commit 顺序。真实 DB/OSS/grants 及 Worker 大文件容量尚未验证，不能用 Node 内存服务器测试替代环境验收。下一步转文档链路；完整 mydocs 其余操作、页面依赖注册、正文/协作一致性、部门阶段仍在整体范围内，未完成。

## 11. P7 — 退役与维护收口

责任：整合负责人和运行维护负责人；逐链执行，不必等待全部模块完成。

- [ ] **INT-701** 核对消费者归零：旧 API、目录同步、后台任务、service client/grant、Worker 和环境变量逐项有替代路径、访问/消费证据及清理责任人。
- [ ] **INT-701c Codocs 旧前端退出**：分别清点旧链接、后置演示、旧项目页面、外部嵌入和静态资源消费者；验证 Host 完整文档工作区的保存、版本、批注、附件/图片、协作、撤权、切换对象、未保存退出及失败恢复，并记录性能与回退。只有消费者归零和替代路径通过后才停止旧 Codocs 前端；Collab/文件处理等必要服务可继续运行。
- [ ] **INT-702** 关闭已替代执行路径：先停旧写入和调度、撤对应路由，再处理身份/配置；保留真实外部调用所需 grants，避免按模块名称批量删除。
- [ ] **INT-703** 归档历史数据与回执：按业务保留要求管理旧表、订单/License、审计、receipt 和 outbox；备份恢复演练通过后才执行获授权的删除，不在代码迁移时提前清空。
- [ ] **INT-704** 更新维护体系：根/模块 CLAUDE、MODULE_CONTRACTS、API/schema、部署/恢复、用户手册、CI 和 release tag；明确唯一有效路径，删除已无用途的过渡实现。
- [ ] **INT-705** 复盘复杂度与运行质量：对比独立部署数、配置/同步任务数、调用层数、发布耗时、故障与恢复指标，持续记录统一库/宿主带来的容量和耦合成本。

## 12. 验收清单与证据标准

以下是阶段验收标准，不是第二份进度台账；实际完成状态只勾选上方任务。

| 维度 | 必须证明的结果 | 主要任务 |
| --- | --- | --- |
| 租户隔离 | 两租户交替/并发请求不会混用连接、缓存、actor、身份和数据 | INT-101/102/107/303/406 |
| 人员权限 | 来源对象权限不能扩大到关联对象；列表/总数/详情/导出/字段均正确 | INT-104/406 |
| 数据一致性 | 改名经正常查询即时读取；历史快照不漂移；事务失败无部分提交 | INT-204/205/207 |
| 迁移完整性 | 主键/业务键/引用/revision/audit/receipt/outbox/水位均已核对 | INT-202/203/206 |
| 幂等与并发 | 新旧入口重试一次生效；冲突有明确响应，响应丢失可恢复 | INT-105/106/207/504 |
| 功能资格 | 企业全量功能；人员权限独立；技术版本与签名校验保留 | INT-401～407 |
| 用户体验 | 旧书签、刷新、统一会话、跨模块导航和 1440/390 可用 | INT-303/306 |
| 性能与部署 | 同条件对比达到已冻结阈值，真实套餐限制满足并留余量 | INT-006/307/502 |
| 回退 | 已有新写入时不回到过时数据；旧任务不会重复消费 | INT-206/308/504～506 |

阶段报告模板：

```text
阶段 / 任务 ID：
负责人 / 完成日期：
代码提交及 Host / Runtime / schema / 权限目录版本：
环境、租户与脱敏测试数据规模：
当前权威写入方、读路径、后台任务及消费水位：
验证命令或操作、结果、证据位置：
与基线比较：
遗留项、兼容范围和回退方法：
下一阶段是否满足前置条件及依据：
```

## 13. 当前进度与下一步

### 13.1 当前权威安排（2026-09-20）

以本文顶部摘要、§3.1 和 INT-606 当前摘要为当前执行顺序；本轮仅调整安排，没有新增部署、环境验收或复选框完成声明。Host 修正有本地证据但未形成固定候选；个人文档已有 9 页实现，补真实闭环证据；部门另批准备；产品工作台冻结任务后收口；联合试点通过前不扩大商业模块。各旧任务的证据日期与验证层级仍须保留，不以最新排期覆盖历史缺口。

#### 2026-09-15 阶段快照（历史，以下“当前/下一步”仅指当时）

以下表格及分工保留当时判断，包含已被后续记录取代的进度；不得据此重复迁页或覆盖 §3.1 的当前优先级。任务是否完成以对应复选框和最新证据为准。

| 阶段 | 当前判断 | 下一完成批次 |
| --- | --- | --- |
| P0 | INT-002/003/004/005 已完成；INT-001/006 部分完成 | 闭合同一窗口部署回读与 drain 触发者；补同账号、同数据的配对性能与权限基线 |
| P1 | INT-101/102/103/105/106 已完成；INT-104/107/108 部分完成 | 将受限导出领域合同接到授权后的 Host 路径；闭合当前业务制品的身份/能力环境验收及 API 合同索引 |
| P2 | 测试统一库已激活，但阶段未完成 | 用同一权限主体完成旧/新查询影子对比及迁移→业务写入→恢复贯穿演练 |
| P3 | INT-301 最小 Host 已完成；INT-302～305 为部分，完整 Aims/Assets 功能未迁入 | 关闭 Layer/缓存冲突；逐页迁入 Runtime/BFF；逐任务完成唯一 owner；补 1440/390 和性能验收 |
| P4 | INT-401～405 已由上述代码与隔离测试证明；INT-406/407 和 P4 环境矩阵未闭合 | 完成 INT-406 的真实岗位全集与缓存时序，以及 INT-407 在目标环境中对新企业开通、历史企业只读转换预览、新/旧/停用企业和未配置能力的联合验收；不得将隔离测试推断为真实租户转换或部署完成 |
| P5 | C000001 已完成产品试点切换的部分链路 | 在 P2–P4 闭合后执行完整业务链、故障恢复、固定制品和观察周期 |
| P6 | 仅有 Altoc↔Aims 基础事务提取 | P5 通过后按 Altoc/Aims→Finance→People 顺序扩展 |
| P7 | 未进入退役条件 | 每条链验收且消费者归零后再关闭旧路径；当前不删除历史数据或 grants |

当前执行分工：整合负责人维护本台账与验收；Runtime/数据工作包先补 P0–P2 证据闭包；Aims 和 Assets 工作包分别迁入可真实运行的页面，缺 Runtime route 或精确 capability 时登记为下一依赖，不挂载会稳定失败的假页面。所有实现继续提交到 `feat/adr018-enterprise-integration`，生产与 `main` 保持不变。

2026-09-15 授权核心定向回归：Platform 企业权益/组合、Console 权益/模拟/主体范围、Foundation 应用授权/动作/主体范围及 Platform→Console→Foundation 生命周期组合合同均通过。该代码/隔离测试已证明 INT-404 的资格分类、INT-405 的 manifest 目录兼容，以及 INT-406 中“企业全量资格不自动授予全员”、自定义角色、动作蕴含、项目范围和过期/未生效角色的回归；仍未使用已部署的签名 bundle、真实岗位/部门/项目范围和职责冲突数据，验证合并角色与模拟隔离在缓存刷新、角色到期和撤销传播时的实际时序。因此 INT-406 保持未勾选，也不据此推断 INT-407 或任何环境操作完成。

### 13.2 历史实施记录

以下记录按发生时间保留，其中包含已被后续记录取代的候选版本、表数、开关和阻塞状态。阅读当前状态时以 13.1、任务复选框及链接的最新回执为准。

更新：2026-09-14。负责人：主 agent 负责整合；Runtime/数据、Nuxt/体验、权益 agent 按下表继续实施。本阶段指导、业务源码及部署工具已提交并推送至 `090ba513`；固定提交的 Runtime candidate.5 已部署并通过本地/公网健康验收，完整 Host 候选已构建但未部署；测试 Host/Gateway 仅登录路径已发布，Runtime 已更新至 candidate.5 且 enterprise.enabled=false，业务与调度流量尚未切换，生产未发布。以下为当时状态，不以专项测试通过提前勾选完整阶段。

| 工作项 | 已落地及证据入口 | 尚缺的验收或交付 |
| --- | --- | --- |
| INT-001～006 | [部署与路由基线清单](./Unified-Enterprise-Deployment-and-Routing-Inventory.md)、[Host 合同](./Unified-Enterprise-Host-Contract.md)、[数据合同](./Unified-Enterprise-Data-Contract.md)、[权益合同](./Unified-Enterprise-Entitlement-Contract.md)、[构建基线](./Unified-Enterprise-Build-Baseline.md)、[性能基线](./Unified-Enterprise-Performance-Baseline.md) | 同一窗口全组件/trigger 回读、drain 触发闭环、完整性能样本、两租户岗位样本及有依据的排期；P0 未验收 |
| INT-101/102/107 | 统一连接登记、实际实例/schema/UTC 校验、精确部署绑定、Host 传输身份与签名 actor 校验 | 其余业务命令接线、正式身份/grant 配置及目标环境验收 |
| INT-103～106 | 产品目录查询服务；现有产品命令提取可接受共享事务的入口 | 受管视图跨域回滚/旧Go入口重放首轮 MySQL 验证通过；新增持久 generation 共享锁写事务及复用原需求命令的 enterpriseplanning.RequestService。Runtime 请求创建路由及启动初始化已接线、授权绑定单测通过；真实代际并发与请求创建 HTTP 验证已通过；Host BFF 已复用原对象授权流程接线，授权事实预检真实 HTTP/MySQL 验证已通过，需求列表/详情 Runtime 与 Host BFF 已接线、Host typecheck 通过；读取真实 HTTP/MySQL/race 验证已通过（分页、筛选、跨空间隔离、代际失效、读取不写 receipt/audit）；产品空间/需求/版本权限提示 BFF 已复用原处理函数接入；六个版本规划写入 Runtime 路由已接入原领域服务，新增初始化后需求 HTTP/MySQL 回归通过，规划真实 HTTP/MySQL/race 回归已通过；六个 Host BFF 已复用原校验/权限处理器接线，Host 类型检查和 Foundation 12 项传输测试通过，真实 H3 BFF 请求级验证已通过（远端服务为 fixture，不代表 OIDC 验收），登录后业务验收仍待完成；版本列表/详情及计划详情/范围已提取同事务读取服务，四个读取路由和 Host GET 已接，真实 HTTP/MySQL/race 与 H3 BFF 验证通过；组件列表共享事务服务和 Host GET 已接，类型检查及固定传输测试通过，组件专项 HTTP/H3 验证接续中；产品空间当前目录查询已接，Repeatable Read 范围/总数/分页并发验证与真实 HTTP/MySQL 验证通过；产品空间详情当前名称及产品线已接，真实 MySQL/HTTP 与旧入口回归通过；外部反馈绑定命令尚需唯一调度方及可信来源合同，见[外部反馈边界](./Unified-Enterprise-External-Feedback-Boundary.md) |
| INT-104/107/304 | 首条 Host 目录 BFF→Runtime→统一登记库链；`node data-runtime/scripts/test-enterprise-directory-mysql.mjs` 隔离 MySQL 验证覆盖实际 HTTP 路由、只读 DB 用户、真实服务 JWT、owner 过滤、改名、撤销及依赖故障 | 登录后的完整页面链、其余列表/详情/下拉/写入接口；现有目录 BFF 不代表所有产品页面已可用 |
| INT-204/205/304 | 当前产品候选分页、单产品/整线接入及模块创建/编辑/移动/删除已接领域服务、Runtime 与 Host；真实 MySQL/HTTP/H3 覆盖范围、重放、冲突和晚失败回滚；原结构页面组合、缓存隔离及双应用类型检查通过。当前 Host 集成测试 19 项通过 | 登录后真实页面验收、结构页功能目录、版本编辑/删除与生命周期、项目承接及外部交付完整链仍待完成；不据局部命令通过勾选完整 INT-205 |
| INT-103/105/106（Assets 主档） | `node data-runtime/scripts/test-enterprise-assets-products-mysql.mjs` 真实 MySQL 双 HTTP/race 通过（2.644s）：新旧入口重放、payload 冲突、审计失败回滚、授权撤销及物理表隔离；旧 JWT `assets.write` 保持精确校验，实时 grant 查询按 Console 目录使用 `assets:write` | 正式 receipt CHECK 已于20:32:33Z应用实际测试源并重建计划；NOT ENFORCED 真实反例通过（完整回归2.571s）。单receipt映射已移除3条虚outbox依赖，最新真实plan已生成55个视图候选；尚未安装目标。candidate.4隔离全包race和构建通过，已更新实际测试Runtime，本地/公网health与配置不变核对通过；目标环境完整业务验收仍待完成 |
| INT-105/106/305 | 统一 Scheduler 的领取及成功/失败服务与 HTTP 入口已接；真实 MySQL/JWT/Console grant 验证覆盖领取、失败 ACK、租约、撤销、generation 和回滚；成功/失败 checkpoint 共享事务与 10 张业务受管视图验证通过。通知/死信六操作已提取共享事务并接调度服务，隔离 MySQL/HTTP 验证已通过（见 `deploy/test-env/artifacts/C000001.scheduler-notification-http-mysql-verification.json`） | 完整 worker 所有权切换、真实外部投递与响应丢失恢复；当前未启用调度迁移，见[外部反馈边界](./Unified-Enterprise-External-Feedback-Boundary.md) |
| INT-201/202/206/207 | **历史批次（已被后续 150 表基线取代）**：147 张业务表影子复制、count/hash/FK/trigger/JSON/receipt 与恢复演练；源端持久栅栏和包含迁移控制表的最终复制/激活协议，见[切换协议](./Unified-Enterprise-Cutover-Protocol.md) | **历史记录**：2026-09-14 早期演练回执为147个业务 checkpoint/478行/38触发器，目标总表数另含3张迁移控制表（[回执](../deploy/test-env/artifacts/C000001.enterprise-rehearsal-copy.json)）；当前基线已补齐 Assets 三张 outbox 表并统一为150张业务表，见[产品试点数据清单](./Unified-Enterprise-Pilot-Data-Inventory.md)。本行只作过程追溯，不代表当前迁移/恢复状态 |
| INT-301～306 | Host 显式 Layers、产品目录/接入、需求、结构与功能目录、版本规划及生命周期 BFF 已接；验收/发布真实 HTTP/MySQL 和 H3 回归通过。页面清单与专项证据见[API 就绪台账](./Unified-Enterprise-Product-Page-API-Readiness.md) | 历史验收/发布记录查询及 HTTP/MySQL、H3 回归已通过；真实 Chrome SSO 与 Enterprise authenticated 会话查询已通过。项目承接及执行汇总已完成真实 HTTP/MySQL、H3、权限过滤分页与当前授权事实复核；登录后桌面/移动业务验收、性能比较及其余未注册业务路径仍待完成 |
| INT-401～404 | 资格转换、状态命令、签名 bundle、Console 消费；已确认足额订单按批准期间履约并保留旧历史 | 技术 provisioning 已接线并通过真实 startOnboarding/MySQL 验证；Host 逻辑模块路由映射已按实际组合与部署事实接入签名 bundle，专项验证通过；统一批准订单/企业确认/到账/技术开通界面及实际 H3/MySQL 隔离链路已验证，批准依据等8项SQL已应用测试Platform（13张新表、4项CHECK生效）；对应应用发布与接口验收待完成；目标环境新企业开通仍待完成 |
| INT-405 | `node enterprise/scripts/generate-manifest.mjs --check` 通过，目录由原模块 manifest 生成并保留命名空间 | Platform `registerAppManifest` 已接入组合校验与同事务逻辑模块登记；2 项结构/篡改单测通过，真实 MySQL 整体回滚与物化验收已通过（`node --experimental-strip-types platform/scripts/test-enterprise-composition-mysql.mjs`）；bundle/部署消费仍需联合验收 |
| INT-404/406 | 真实 Platform 签名→Console→Foundation→MySQL 存储 fixture；Runtime 后端持久 revision 水位及全新 Node 进程拒绝旧包；权益合同与 Console 消费文档记录验证范围 | 真实 Runtime HTTP/MySQL 与 race 专项测试已通过，发现并修复依赖故障误报 500；真实岗位全集、Gateway/OIDC 消费和目标环境验收仍缺 |
| INT-107/502 | 实际 C000001 Console 测试库已登记 Enterprise OIDC、回调与退出地址、enterprise.runtime、37 项精确 capability；另已独立登记 Codocs audience 的产品文档读取 grant，并通过实际签发/验签与错 audience、未授权 create 反例（[证据](../deploy/test-env/enterprise-oauth-codocs-evidence.json)）；Runtime capability 为37项。初始 AES-GCM credential 已创建且只读复验通过，见[凭据证据](../deploy/test-env/ENTERPRISE_CREDENTIAL.md) | 实际 JWT 签发/验签已有原32项、项目承接2项、Assets主档/分类2项和合同生效1项独立时间证据；测试 Host/Gateway 登录路由已发布，真实 OIDC 会话通过。统一库绑定、正式技术发布制品及业务/调度路由尚待接通；清单校验通过不代表 deploymentReady |
| INT-601/602 | [Altoc–Aims扩展草案](./Unified-Enterprise-Altoc-Aims-Expansion.md)已按真实调用/权威表列出实施顺序与事务复用点 | AA-02两个Aims合同receipt入口已提取共享事务并通过真实MySQL/race（2.402s）、Aims全包race（3.240s），修复成功receipt错URL重放。Altoc可开票receipt共享入口也已通过真实MySQL/race（2.090s）及全包race（1.575s），旧坏路径仍在Begin前拒绝。Altoc job/step与真正生效/冻结2个operation两段共享入口已提取并通过真实MySQL（2.165s），Aims/Altoc全包race通过；目标receipt消费、Host编排、实际库存及路径切换仍未完成，不能据基础提取视为P6验收 |
| P5～P7 | 尚未达到前置阶段验收条件 | 联合测试、测试环境切换、后续 Altoc/Finance/People 链与旧路径退役 |

### 当前工作分配

1. Runtime/数据：AA-03事务、Registry、实际HTTP双授权边界与Host编译器已实现并通过专项验证；第37项服务授权实际签发/验签通过。合同开关仍关闭，完整业务验收及Altoc UI整合待完成。
2. 部署 agent（GPT-5.6）：排空控制面已实际部署，签名快照revision=2/open，原Gateway入口复验通过（[回执](../deploy/test-env/artifacts/C000001.drain-control-plane-20260914.json)）；Aims/Assets原模块记录wrapper已部署，各入口200且请求记录已结束（[回执](../deploy/test-env/artifacts/C000001.drain-wrapper-deployment-20260914.json)），未close/seal。Platform远端独立构建因Node SIGABRT失败，原PM2服务未替换；改用本机隔离构建并核对Linux依赖兼容性（[失败回执](../deploy/test-env/artifacts/C000001.platform-enterprise-build-candidate.json)）。
3. Console agent（GPT-5.6）：测试 Console `d7456308-bb6a-4aa9-90f3-0268f0087e93`、Gateway `0866464e-ffa4-4de8-a75e-895100a87bfa` 和 Enterprise Host `d6a2d58c-b225-4558-92c7-f1f7cc2095ba` 均为100%流量。已修复独立策略同步的下游30秒超时：测试专用 Console/ Gateway 上界分别为90/100秒，手动同步200，持久快照为活动签名包，两个自然cron续期间隔120206ms、119498ms，均小于300秒；未改TTL、时间戳、验签或绑定。详情见[同步恢复回执](../deploy/test-env/artifacts/C000001.console-policy-sync-recovery-20260914.json)。Host permit时钟余量修复后的冷首访 Assets 三个请求均200，显示53产品与8分类且无重试；其余页面继续按单独浏览器回执验收。跨isolate冷读与线上旧revision拒绝仍未作真实环境验证，旧仅配置候选不作为完整ADR-018验收。
4. **历史记录（已被 13.1 及后续激活回执取代）**：当时 Runtime candidate.4 已部署且 enterprise 关闭；独立演练库为147个业务 checkpoint/478行/38触发器与55视图，generation=0，正式目标未复制。当前 150 表及 generation=1 状态见[产品试点数据清单](./Unified-Enterprise-Pilot-Data-Inventory.md)；本条只说明当时状态。

2026-09-14补充：测试Assets的3张出站任务空表与People接收回执空表已补齐，均先经隔离MySQL验证；原业务行未改写。正式源计划更新为150表/478行（旧147表内容未变），source-readiness、候选与manifest已刷新。实际provider报告现为2项自动、2项不适用、3项待补证、0项blocked，仍未排空或切库。

2026-09-14后续：Platform运维登录已恢复，排空/活动审阅UI已部署并完成认证拒绝、输入状态及双视口验收。仍有41条uncertain活动缺乏完整请求关联；Cloudflare未配置历史日志，当前聚合Runtime读取日志不足以覆盖所有入口，入口保持open，未封存或切库。详见[测试部署最新记录](./Unified-Enterprise-Test-Deployment.md)。


2026-09-14 当前进展（取代上文旧阻塞描述）：用户已授权按测试数据审计结案，41 条 uncertain 已处理，未解决活动为 0。正式统一测试库已完成备份/围栏/最终复制/55 视图及 generation=1 激活；Runtime 统一绑定已启用并健康，完整 Host 已发布。当前继续调度归属、Gateway 业务路由及恢复入口后的认证验收，不再等待此前外部历史日志。详细证据见[测试部署最新记录](./Unified-Enterprise-Test-Deployment.md)。P0～P7 仍按各项实际验收逐项完成，不据本次切库整体勾选。

最终状态（2026-09-14，取代以上阶段性待办描述）：统一测试库 generation=1、调度归属 revision=1、Gateway 路由及排空释放 open/revision=5 已完成，未解决在途活动为 0。Runtime 固定候选 7，Host 已部署。六产品线及筛选、产品详情、需求池、版本计划、产品结构与53项 Assets 主档读取已通过浏览器验收；一条内部测试需求完成新增、读取及评审，最终“已拒绝”。Host将合法 permit 签发窗口收紧到14秒，保留Runtime 15秒上界，最终冷首访Assets三接口均200；时钟偏差仍属于根据时序作出的推断，并未取得Runtime具体拒绝分支证据。

当前剩余环境阻断是自动策略续期：Console在Free计划10ms CPU上限下发生`exceededCpu`，配置1000ms的实际尝试被Cloudflare100328拒绝。手动恢复支持了上述验收，但不能据此宣称测试站持续可用；等待用户套餐决定或后续专项CPU优化。完整生命周期、其他业务域、AA03/AA04及P0～P7仍按各项实际验收推进。见[浏览器回执](../deploy/test-env/artifacts/C000001.browser-acceptance-20260914.json)与[CPU阻断回执](../deploy/test-env/artifacts/C000001.console-cpu-limit-blocker-20260914.json)。
