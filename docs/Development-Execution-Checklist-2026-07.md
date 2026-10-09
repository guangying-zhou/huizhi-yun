# 汇智云后续开发执行任务清单（2026-07）

状态：执行中（G3 可靠性 P0；G1/G2 真实环境验收待外部窗口）

## 当前推进所需协作输入

离线实现、测试、契约审计和文档收口可继续执行，无需项目负责人立即提供额外输入。进入真实环境阶段前，由项目负责人一次性确认以下事项；未确认前不得以本地通过替代生产验收，也不得执行部署、迁移、seed、live probe 或 secret 写入：

- [ ] 指定目标环境（preview/staging/production）、tenant code、deployment/environment 标识，以及 Platform、Console、Tenant Gateway 的目标 base URL。
- [ ] 明确授权范围和变更窗口：Cloudflare 部署、数据库 migration、Console grant/seed、R2/runtime 发布、真实验收、回滚演练分别勾选，不以“继续”概括授权高风险操作。
- [ ] 决定执行方式：由 Codex 在受控终端运行版本化命令，或只生成命令/journal 由运维负责人执行。
- [ ] 在本机以环境变量或既有登录态提供验收身份，不在聊天或仓库粘贴明文凭据；至少包含 owner、普通授权用户和拒绝对照用户会话。
- [ ] 正式发布前锁定 clean candidate commits、release manifest、生产 signing key ID，并确认回滚责任人与验收留档位置。

当前建议：继续完成不依赖真实环境的剩余 P0/P1；待上述输入齐备后，将真实发布拆成“只读预检 → 迁移/seed → 版本化 Cloudflare 部署 → live acceptance → 回滚/前滚验证”五个独立确认点。Insights/Align 继续排除在本轮实现范围之外。

## 企业连接运行时（方案 B，批准于 2026-07-14）

- [x] Phase 0：冻结 provider/capability、错误、scope、ledger、固定 endpoint 与显式迁移/回滚契约。
- [x] Phase 1 离线实现：独立 `hzy-connector-runtime`、一次性 enrollment、Console 管理页、企业微信通知兼容、显式启用与旧通道回退。
- [x] Phase 1 真实环境：Console migration/seed、独立 data-runtime HTTPS 目标、Connector 0.4.5 R2 签名发布、Console Cloudflare 部署、wiztek 独立服务器安装、Notification Runtime 账本保留迁移、真实企业微信发送及失败恢复均已验收。
- [x] Phase 2 离线实现：企业微信 authorization code 交换、Console/Foundation 登录入口、state/nonce、Directory 账号绑定及禁用用户失败关闭。
- [x] Phase 2 真实环境：migration/seed 与 Connector/Console/Platform 已发布；wiztek 已通过租户专属 `wecom-api.wiztek.cn` 回调域完成企业微信真实登录、Directory identity binding 与 Console session 验收。该域名属于当前租户，不能作为所有租户共用回调域；付费租户仍需各自配置可由企业微信验证的专属域名。自动化已覆盖禁用用户失败关闭；项目负责人明确不执行对应生产账号演练。
- [x] Phase 3 离线实现：钉钉身份与消息 adapter、固定官方出口、Vault 凭证边界、精确 capability/scope 与错误映射。
- [x] Phase 4 离线实现：People 钉钉显式异步同步、watermark、RSA-PSS data-runtime 固定 origin 调用、持久任务进度、幂等批次与失败重试；分机强制 HTTPS，同机才允许 loopback HTTP，不跟随重定向。
- [x] Phase 3/4 真实环境：v1.72/v1.73/v1.77、People schema/receipt migration、Connector `0.4.18`、Console 和 Platform 已发布；data-runtime `0.3.110` 在线且与独立 Connector 分机部署。生产 `dingtalk.default` 已完成真实机器人通知与 durable replay，`dingtalk.identity` 已完成真实组织选择、callback、Directory identity binding 和 Console session；钉钉 People 真实任务读取 10 个部门、79 名用户，写入 77、跳过 2，data-runtime 三批 receipt 与 People 实际行数一致，失败重试链保留。Console 当前 Worker 为 `0c91e252-60a3-4554-a7df-5852f1d06f15`；凭证仅在 Vault，运行时固定官方出口且不提供通用 HTTP 代理。自动化已覆盖禁用账号失败关闭，项目负责人明确不执行对应生产账号演练。
- [x] Phase 5 离线实现：设备心跳与绑定、吊销/单次 enrollment 轮换、脱敏诊断、聚合计量、独立 Ed25519 发布信任链、内部 SLO 与发布顺序。
- [x] Phase 5 真实环境：签名发行链、生产 migration、Cloudflare 管理页、一次性安装指令、3 分钟 stale、凭证轮换、吊销停止、状态 78 防重启风暴、重新登记、诊断脱敏、usage 聚合、本机结构化 SLO 快照、生产同键 live replay 与 43 分钟容量趋势均已验收。

Phase 0–5 自动化证据：Notification/Connector Runtime 与 data-runtime Go 全量测试、Console 341 项测试（340 pass、1 项环境 skip）、Platform 与 Tenant Gateway 契约测试通过；Console typecheck/lint、Cloudflare build/dry-run、R2 签名发布与分机安装验收通过。2026-07-14 至 2026-07-16 已在生产执行并重复验证 Console v1.68–v1.77 与 People receipt migration，发布签名 Connector `0.4.18` 与 data-runtime `0.3.110`，当前 Console Worker 为 `0c91e252-60a3-4554-a7df-5852f1d06f15`。独立 Connector 已完成 systemd、SQLite、租户/部署、精确 capability、固定供应商出口、远端 data-runtime 签名边界、本机结构化 SLO、生产同键 replay 与 43 分钟窗口验收；旧 Notification Runtime 已停用但保留账本。企业微信/钉钉真实通知、企业微信/钉钉真实登录、钉钉 People 同步、stale、轮换、吊销、无重启风暴和重新登记均已验证。身份开关在 Runtime capability 校验前执行 integration/provider/公开配置以及集成→绑定→Vault secret→固定版本的 active 链路门禁。禁用用户失败关闭由自动化覆盖，项目负责人明确不执行生产账号演练；详细证据见 `docs/release/Enterprise-Connector-Runtime-wiztek-2026-07-14.md`。

基线日期：2026-07-09
最后核对：2026-07-11
适用范围：除 legacy `account/` 外的当前活跃模块  
当前事实源：根 `CLAUDE.md`、`docs/Huizhi-yun-Integrated-Operations-Roadmap.md`、`docs/P3-P4-Release-Readiness-and-E2E-Acceptance.md`、`docs/release/P3-P4-2026-07.release.json`、`docs/MODULE_CONTRACTS.md`

## 1. 目标与执行原则

本清单用于把当前项目从“Phase 1–4 主要能力已落地”推进到“质量基线稳定、真实租户可验收、生产问题可追踪、后续指标可扩展”的状态。

执行原则：

- 先恢复全仓绿色基线，再继续新增业务功能。
- 先完成 P3 / P4 真实环境验收，再启动 Phase 5 经营驾驶舱和 AI。
- 每项任务保持单一模块或单一契约边界；跨模块变更在一个 monorepo 提交中保持可审阅。
- 使用根仓统一提交，提交前按受影响模块执行路径级检查和对应契约测试。
- 已迁入 tenant-runtime 的模块不得恢复本地数据库主路径或 DB fallback。
- 跨模块调用必须使用 Console service token、细粒度 capability 和稳定幂等键。
- 涉及跨模块 API、schema、manifest 或授权语义时，同步更新对应契约文档和测试。

任务状态约定：

- `[ ]` 未开始
- `[~]` 进行中（执行时手工修改）
- `[x]` 已完成并通过验收
- `[!]` 阻塞（注明阻塞原因、责任人和下一步）

## 2. 当前基线记录

以下结果只用于说明任务来源，不代表后续执行时可以跳过验证：

- `data-runtime`：`go test ./...` 通过。
- `notification-runtime`：`go test ./...` 通过。
- Platform：157 / 158 个测试通过，权限管理 UI 契约测试 1 项失败。
- Altoc：93 / 94 个测试通过，服务工单转 Aims 的 scoped 项目解析测试 1 项失败。
- Codocs：手工执行 61 个测试全部通过，但 `pnpm --dir codocs typecheck` 失败。
- People：手工执行 30 个测试全部通过，但 `package.json` 未配置 `test` 脚本，根级测试会跳过。
- Insights：测试因 Vitest 依赖链接缺失无法启动，且未纳入 pnpm workspace。
- Console：类型检查通过，但存在授权 helper 重复自动导入警告。
- 当前根仓和 Platform 存在未提交的权限基线相关改动，执行时不得覆盖或混入无关修复。

## 3. 里程碑总览

| 里程碑 | 优先级 | 目标 | 建议周期 | 启动条件 | 完成条件 |
| --- | --- | --- | --- | --- | --- |
| G0 绿色基线 | P0 | 测试、类型、依赖和 CI 可稳定执行 | 1–2 周 | 立即开始 | active 模块门禁全绿且不跳过已有测试 |
| G1 授权模型收口 | P0 | Platform → Console → Foundation → App 授权链路稳定 | 1–2 周 | G0 可并行局部推进 | 真实授权环境验收留档，重复实现与导入消除 |
| G2 P3/P4 发布验收 | P0 | People、项目成本、服务运营链路生产可用 | 2–4 周 | G0 完成，G1 主路径稳定 | 验收清单全部通过，有演示数据与回滚记录 |
| G3 跨模块可靠性 | P1 | 同步失败可追踪、重试和重放 | 2–4 周 | G2 主链路可重复执行 | 关键写链路有持久化操作记录和重放能力 |
| G4 统一待办通知 | P1 | Console 成为员工统一行动入口 | 2–3 周 | G1、G2 完成 | 核心应用待办/通知统一聚合，无空实现主路径 |
| G5 指标驾驶舱 | P2 | 建立可追溯经营指标快照 | 3–6 周 | G2、G3 完成 | 首批指标可追溯、可重算、不跨库查询 |
| G6 架构债治理 | P2 | 降低大型文件、legacy 岛和文档漂移风险 | 持续 | 对应模块行为测试完备 | 专项逐模块完成，不影响主交付节奏 |

## 4. G0：恢复绿色开发基线

### G0-1 修复 Altoc scoped 数据范围回归

- [x] 确认 `altoc/server/api/v1/service-tickets/[ticketCode]/aims-work-item.post.ts` 中 `customerCode`、`contractCode`、`maintenanceContractCode` 的可信来源。
- [x] 禁止浏览器请求体覆盖已按 `service_ticket:edit` 数据范围读取的工单事实。
- [x] 保留显式项目选择能力时，验证项目仍属于工单可访问范围。
- [x] 修复并通过 `altoc/test/altocServiceTicketWorkItemScope.test.ts`。
- [x] 增加“请求体伪造 customer/contract/project 不得扩大候选范围”的负向测试。
- [x] 运行 `pnpm --dir altoc test`、`pnpm --dir altoc typecheck`。

完成标准：Altoc 测试全绿，工单到 Aims 的项目解析只消费服务端可信事实。

### G0-2 修复 Codocs 依赖和类型检查

- [x] 盘点编辑器代码直接导入的 `@milkdown/prose/*`、`@milkdown/utils`、`y-protocols`、`lib0`、`@vueuse/core`。
- [x] 将实际直接使用的包声明为 Codocs 直接依赖，避免依赖 pnpm 偶然提升或传递依赖。
- [x] 处理依赖恢复后仍存在的隐式 `any`，不使用大范围 `any` 或关闭严格检查规避。
- [x] 核对 Milkdown、Yjs、Hocuspocus 依赖版本兼容性。
- [x] 运行 `pnpm --dir codocs typecheck`。
- [x] 手工执行并保持现有 61 个 Codocs 测试通过。
- [!] 在 1440px 和 390px 视口验证编辑器打开、表格编辑、协作、预览和下载。（阻塞原因：当前应用内浏览器安全策略拒绝继续访问本地 Codocs；下一步：由用户本机浏览器接入完整 Console/runtime 开发栈后执行并留档。）

完成标准：Codocs 类型检查和现有测试全部通过，编辑器核心流程无浏览器错误。

### G0-3 收口 Platform 当前权限管理改动

- [x] 先保存并核对当前 Platform 与根仓未提交改动范围，避免覆盖用户工作。
- [x] 修复 `authorizationManagerInstanceConflictUi.test.ts` 与当前权限页面实现的契约失配。
- [~] schema、migration、policy bundle、API、UI、测试主实现已由用户保存为 Platform 提交 `fa79f71`；本轮跟进修复保持独立 diff，待用户按仓提交后完成最终边界确认，不改写既有历史。
- [x] 将 baseline 权限编辑器抽为 `app/components/admin/BaselinePermissionEditor.vue`；`enterprise-roles.vue` 从 1525 行降至 1173 行，并增加组件边界契约测试。
- [x] 运行 `pnpm --dir platform test`、`pnpm --dir platform typecheck`、`pnpm --dir platform lint`。
- [x] 执行 `git diff --check`，确认无意外格式或冲突标记。

完成标准：Platform 现有测试全绿，权限改动可按明确提交顺序落地和回滚。

### G0-4 把 People、Codocs 测试接入根级门禁

- [x] 在 `people/package.json` 增加与现有 Node test 文件匹配的 `test` 脚本。
- [x] 在 `codocs/package.json` 增加与现有 Node test 文件匹配的 `test` 脚本。
- [x] 确认 `pnpm test:active` 会实际执行 People 和 Codocs 测试。
- [x] 在根级测试输出中记录各模块实际执行数量，防止静默跳过。
- [x] 增加双向脚本检查：全包存在测试但缺少 `test` script，或存在 `test` script 但测试数为 0 时直接失败；支持独立仓 `--package-dir`。

完成标准：People 30 个、Codocs 61 个现有测试均由 `pnpm test:active` 自动执行。

### G0-5 修复 Insights 独立测试环境

- [x] 清理或重建 Insights 的 pnpm 依赖链接，恢复 Vitest 可执行模块。
- [x] 运行 `pnpm --dir insights test`、`lint`、`typecheck`。
- [x] 明确 Insights 继续独立于 workspace，并在根级新增 `pnpm validate:insights` 显式验证命令。
- [x] 不纳入 root workspace；独立锁文件和依赖边界不污染主工作区锁文件。

完成标准：Insights 测试可重复启动，根级或独立 CI 有明确入口。

### G0-6 统一本地和 CI 工具链

- [x] 根仓和独立模块统一使用 `pnpm@11.10.0`。
- [x] Node 固定为 `24.18.0`，支持范围为 `>=24.18.0 <25`；根与 Insights 已写入 `.nvmrc`、`.node-version`，各活跃顶层模块已声明 `engines.node`。
- [x] 14 个顶层模块的 `packageManager` 已统一为 `pnpm@11.10.0`，不再混用 pnpm 10。
- [x] 用 Node 24.18.0 / pnpm 11.10.0 执行 `pnpm install --frozen-lockfile`；根 workspace 与 Insights 独立 workspace 均通过，安装未改写锁文件。
- [x] frozen install 后主工作区 `lint:active`、`typecheck:active`、`test:active` 全部通过；Insights lint/typecheck 和生产构建通过，当前独立业务角色契约测试差异见下方升级复核。

完成标准：新环境无需手工修复依赖即可得到一致验证结果。

工具链决策（2026-07-09）：pnpm 11 的非鉴权配置统一迁入 `pnpm-workspace.yaml`；根 workspace 显式启用 `shamefullyHoist`。Insights 保持独立 workspace，并通过本仓 `allowBuilds` 白名单审查依赖构建脚本；CI 必须将 Insights 放在无父级 `node_modules` 的独立目录，仅挂载其跨仓契约测试需要的受控文档。`.npmrc` 清理作为后续独立机械批次处理。

工具链升级复核（2026-07-20）：活跃 Nuxt 应用统一固定到 `~4.4.8`，暂不引入 Nuxt 4.5 / Vite 8；Account 按仓库边界继续独立维护。Node 24.18.0 / pnpm 11.10.0 下，根 workspace 与 Insights 的 frozen install 均通过；主工作区 lint/typecheck/test 全部通过（352 个测试文件），Console、Aims、Assets、Codocs、Finance、Insights 生产构建通过。Insights lint/typecheck 通过，测试 41/42 通过；唯一失败是既有 `project_director` SQL seed 未包含测试所期望的 `insights:analyst`，属于角色契约不一致，不是 Node/Nuxt 升级回归。

### G0-7 建立版本化发布门禁

- [x] 明确不再使用 GitLab Runner；质量门禁由仓库内版本化命令执行，生产发布通过受控 Cloudflare 指令完成。
- [x] 根仓 `release:check` 覆盖 Foundation、活跃模块、Go runtimes、根脚本、Cloudflare 配置和契约检查。
- [x] 各 Cloudflare 部署模块在 `wrangler deploy` 前强制执行 lint、typecheck、test、配置渲染、构建和 Wrangler dry-run。
- [x] tenant-runtime/schema/API 变更增加 Go 测试和契约文档一致性检查。
- [x] 增加静态发布命令守卫，阻止模块绕过质量门禁直接执行 `wrangler deploy`。
- [x] 阻止测试文件存在但脚本缺失、测试脚本存在但测试数为 0 的情况，并覆盖 `src/**/*.test.*`。

完成标准：正式 Cloudflare 发布命令与本地质量门禁使用同一套版本化入口；失败可定位到具体模块，门禁失败时不会执行部署。

发布边界决策（2026-07-09）：不新增 GitLab CI YAML，也不依赖 GitLab Runner。根仓维护全量 `release:check`；Platform、Console 和业务 Worker 在各自 `deploy:cloudflare` 中显式串联模块级 preflight、配置渲染、Cloudflare 构建和 `wrangler deploy`。直接调用 Wrangler 视为非标准运维操作，不作为项目发布入口。

2026-07-09 发布门禁验收：Node 22.19.0、pnpm 11.10.0、Go 1.26.3 下，`release:check --allow-dirty` 端到端通过；严格模式会按设计拒绝当前 15 个 dirty 仓库。静态门禁覆盖 10 个 Cloudflare 部署模块，runtime/schema/API 守卫 8 组正负夹具全部通过。Finance `verify:cloudflare-deploy` 已实际完成 lint、typecheck、32 项测试、配置渲染、Cloudflare 构建及 Wrangler 4.110.0 dry-run，并以 `--dry-run: exiting now` 结束，未执行真实部署。dry-run 暴露的 activation 状态对象重复键 warning 留待后续质量项处理。

### G0 总验收

- [x] `pnpm lint:active`
- [x] `pnpm typecheck:active`
- [x] `pnpm test:active`
- [x] `cd data-runtime && go test ./...`
- [x] `cd notification-runtime && go test ./...`
- [x] `pnpm --dir insights test`
- [x] `git diff --check`

2026-07-09 验收记录：增强后的根级门禁发现 18 个活跃包、13 个含测试包和 120 个唯一测试文件；People 30 / 30、Codocs 61 / 61；Insights 41 / 41。Insights lint 以 0 error、166 个既有 warning 通过，warning 作为后续 legacy 专项处理。

## 5. G1：授权模型与运行时消费收口

### G1-1 完成默认登录基线权限能力

- [x] 完成 Platform 默认登录基线权限 schema 和 migration。
- [x] 完成基线权限管理 API、权限页 UI 和 policy bundle 输出。
- [x] 验证排除用户、租户覆盖、角色授权与 baseline 授权不会错误拼接 scope。
- [x] 验证 baseline 不会隐式授予 `approve`、`confirm`、`export`、`close`、`deploy` 等敏感动作。
- [x] 同步更新授权模型、DDL、迁移说明和 `MODULE_CONTRACTS.md`。

2026-07-09 G1-1 验收记录：Platform 基线权限写入改为只接受当前 app manifest 中存在的 action，并持久化明确的 manifest action id；默认种子与 `authz-core` golden tests 明确拒绝从 `edit` / `admin` 推导 `approve`、`confirm`、`export`、`close`、`deploy`。Console flat permission 路径与 Foundation scoped 路径统一应用 baseline exclusion，新增组合回归验证 baseline、直接角色 scope 与 template override 不能跨授权单元拼接。Platform 158 项、Console 100 项、Foundation 73 项测试全绿，相关 lint、typecheck 与 `git diff --check` 通过；授权模型文档明确 baseline 是 Platform 全局配置、按租户 bundle 投影，租户差异必须通过角色或模板 override 表达。

### G1-2 消除 Console 与 Foundation 授权实现重叠

- [x] 处理 `normalizeAuthorizationResources`、`RuntimePermissionInput` 重复自动导入警告；Console 删除同名副本并显式消费 Foundation helper，增加禁止重新定义的契约测试。
- [x] 明确 Platform 生成、Console 消费、Foundation 适配、业务模块调用的单向边界。
- [x] 业务模块不得复制 policy bundle 解析、动作蕴含或角色选择算法。
- [x] 对 Console 本地实现与 Foundation 共享实现补一致性测试。

2026-07-09 G1-2 验收记录：`@hzy/authz-core` 保持动作蕴含唯一事实源，Foundation 新增 client/server 共用的资源快照薄适配器，Aims、Altoc、Assets、Codocs、Finance、People、Workflow、WebDev 及暂缓模块 Align 均移除本地 `view/edit/admin` 层级。Platform 支持从应用 manifest 物化资源级 `actionImplications`，Console 普通/scoped 快照下发 `actionPolicies`，Foundation 白名单归一化并透传，WebDev 删除本地 `execute` 兼容表且 `admin` 仍不会隐式获得 `deploy`。根级 `validate:authorization-boundaries` 以 5 组正负夹具阻止业务模块重新解析 bundle、选择角色或复制动作蕴含，并已接入 `release:check`。Core、Console、Foundation 共用 12 组黄金动作契约；Core 16、Platform 160、Console 101、Foundation 78 项测试，以及 8 个活跃业务模块合计 404 项测试全部通过。

### G1-3 执行真实授权环境验收

- [ ] 执行 `accept:platform-policy-roles`。
- [ ] 执行 `accept:console-policy-consumption`。
- [ ] 覆盖普通合并授权、角色模拟、用户模拟、自定义企业角色、过期授权。
- [ ] 覆盖部门、项目、客户、对象指派和环境 scope。
- [ ] 覆盖职责冲突 warning/enforce、自审批、付款制单与确认等高风险场景。
- [ ] 按 runbook 保存租户、bundle revision、执行时间、结果和回滚点。

2026-07-09 G1-3 前置检查：两个验收脚本的 `--help` 与参数解析正常，Console 验收脚本已改为消费快照 `actionPolicies` 和 Foundation 统一动作 helper；当前工作环境未设置 `PLATFORM_ACCEPT_EMAIL` / `PLATFORM_ACCEPT_PASSWORD` / `PLATFORM_ACCEPT_COOKIE` / `CONSOLE_ACCEPT_COOKIE` / `CONSOLE_ACCEPT_DENIED_COOKIE`，本地 3011/3000 端口也未监听，因此未向真实环境发起请求。继续执行需要目标 Platform/Console base URL、tenant code、测试 subject uid，以及 owner/授权用户/对照用户会话；凭证只通过环境变量传入，不写入仓库。Cloudflare 部署本身仍使用各模块 `deploy:cloudflare`，不通过 GitLab Runner。

### G1 总验收

- [x] Platform、Console、Foundation 授权测试全绿。
- [ ] 真实环境验收留档可复现。
- [x] Console 类型检查无重复授权 helper 导入警告。
- [x] 业务模块普通运行不依赖客户端角色切换。

## 6. G2：P3 / P4 发布收口与端到端验收

详细步骤以 `docs/P3-P4-Release-Readiness-and-E2E-Acceptance.md` 为准，本节用于跟踪执行结果。

### G2-1 发布准备

- [ ] 确认 People、Altoc、Aims、Finance、Codocs、Assets 目标版本和提交边界。
- [ ] 确认 data-runtime 目标版本、升级脚本和回滚二进制。
- [ ] 执行目标租户 People、Altoc P4 和相关增量 schema。
- [ ] 验证 Platform app manifest、角色、policy bundle 和订阅包含 People/P4 能力。
- [ ] 验证 Console service clients/grants 已包含所需细粒度 capability。
- [ ] 验证 Tenant Gateway 路由、内部 token、tenant/deployment/environment 上下文。
- [x] 准备一组可重复初始化、验证和清理的生产等价演示数据；六库独立事务和连接，由根编排器按 manifest 执行。

2026-07-09 G2-1 离线收口记录：新增 `docs/release/P3-P4-2026-07.release.json`，以机读形式记录六个业务模块和 data-runtime 的候选提交、runtime 版本、People / Finance / Altoc schema 顺序与 SHA-256、应用 manifest 资源动作、Platform 订阅、Console service grant、Tenant Gateway 和演示数据合同；新增 `validate:p3-p4-release-contract` 并接入根 `release:check`。正式模式会拒绝 draft、dirty、提交漂移、schema 校验和漂移和合同缺失，开发模式 `validate:p3-p4-release-contract:dev` 只把尚未完成的发布输入列为警告。Platform v2.3 应用目录和 advanced 计划已补入 People、Finance；Tenant Gateway 新增 People 路由、内部头防伪、tenant/deployment/environment 和 data-runtime 上下文行为测试，连同原缓存测试共 6 项通过。`release:check --allow-dirty` 已连同全仓 lint、typecheck、121 个测试文件、Insights 41 项测试及两个 Go runtime 测试完整通过。当前正式门禁仍按预期拒绝 draft/dirty 候选；本节涉及真实租户和最终提交边界的项目仍不提前勾选，也未执行 schema、发布或 Cloudflare 部署。

2026-07-09 G2-1 演示数据记录：已建立 `docs/demo/p3-p4/`，包含 People、Aims、Finance、Altoc、Codocs、Assets 各自独立的 seed / verify / cleanup、机读 manifest 和操作说明。根 `run-p3-p4-demo-data.mjs` 默认 plan-only，按模块独立 MySQL 凭据执行并写无凭据 journal，seed 失败默认逆序清理已完成模块；`validate:p3-p4-demo-data` 禁止跨库 `USE`、关闭外键、清表/删表、无条件删除和预埋 People 贡献、Finance 成本汇总、Aims 工单、Codocs 关系、Assets 文档关系等 API 派生结果。发布 schema 计划同时改为 bootstrap / upgrade 分离，避免把会删表的完整 Finance schema 用于已有租户。三类 plan-only 编排及包含新静态门禁的完整 `release:check --allow-dirty` 已通过；尚未连接真实数据库，实际执行与 API 闭环结果在 G2-2～G2-5 留档。

### G2-2 People 最小事实源

- [ ] 验证员工、任职、职级、成本快照、绩效周期读取。
- [ ] 验证 People 写入后投影 Console Directory employment。
- [ ] 验证离职后账号停用、session 撤销和 Platform 授权回收。
- [ ] 验证 Platform 同步失败不回滚 People/Directory 事实，并产生可重试通知。

2026-07-09 G2-2 离线行为记录：Console 已把任职与离职生命周期编排提取为可注入、可测试的 orchestration；行为测试覆盖 Directory 投影或账号停用先落地、session 撤销、Platform 调用失败不回滚本地事实、失败通知、操作日志和最终状态读取的顺序。失败通知优先投递 active 操作人；操作人缺失、无效或等于目标员工时，改用系统参数 `notification.authorizationLifecycleRecipients` 配置的 active Directory 用户；无有效收件人时返回 `operation_log_only`，配置读取、收件人解析或通知发布失败返回 `failed`，均不向生命周期编排抛出。Console seed v1.35 和发布合同已登记该参数。以上只证明离线失败语义，真实 People/Console/Platform 环境的读取、投影、会话撤销、授权回收和站内通知仍须逐项验收，因此本节暂不勾选。

2026-07-09 G2-2 读取验收工具记录：新增 `accept:people-g2-2-reads`，通过已评审的 `https://wiztek.huizhi.yun/people` Tenant Gateway 和仅由环境变量提供的 Console session，严格执行员工、任职、职级、成本快照、绩效周期五类 GET；脚本拒绝其他生产主机/端口、生产 HTTP、重定向、非 JSON、异常 envelope、重复/缺失演示事实和跨对象键不一致，只输出包含请求模板、业务键哈希和事实投影哈希的 0600 脱敏证据文件，不保存 Cookie、响应正文或人员标识。另修复数据库 demo verifier 假阳性：每个模块在 manifest 声明固定 `expectedCheckCodes`，runner 解析 MySQL TSV，任一 `FAIL`、缺失、重复、消失或意外检查项都使执行失败，9 项离线 runner 行为测试与 8 项 People HTTP 验收脚本测试通过。当前没有目标 Cloudflare URL 对应的有效 HR 会话，也未在真实数据库执行 seed，因此第一项仍等待部署态证据，不提前勾选。

2026-07-09 G2-2 任职/成本事实加固：data-runtime 新增统一有效主任职 selector，只选择查询日期有效、`is_primary=1` 且 `approval_status` 为 `none/approved` 的记录；Finance 标准成本解析、月度成本快照生成和 dashboard 当前任职复用同一口径，较新的 pending/rejected 记录不再覆盖已批准任职。成本快照以月份末日解析主任职并固化 assignment、部门、岗位、职级字段；generic POST、PATCH/PUT 和 Workflow 批准会拒绝主任职区间重叠，用户读取缺少显式 scope 时失败关闭。Schema、幂等增量迁移、People API spec、模块/跨模块契约和发布 SHA 已同步。Directory bootstrap 批量 upsert 与并发排他仍需后续单事务 assignment transition action 收口，已作为真实验收前风险保留。

本批次完整 `release:check --allow-dirty` 已通过，包含发布契约、Cloudflare 指令门禁、演示数据静态/行为门禁、People 读取验收工具行为、全仓 lint/typecheck/123 个测试文件、Insights 41 项测试以及 data-runtime/notification-runtime Go 测试；仅有既有 Insights lint warnings。该结果是离线开发证据，不等同于真实 Cloudflare/数据库验收，也未执行部署、迁移、live probe 或 secret 操作。

### G2-3 Aims → People → Finance 人力成本闭环

- [ ] Aims 准备项目成员、任务和期间工时。
- [ ] Aims 同步贡献快照到 People。
- [ ] 重放同一周期，确认不重复生成贡献记录。
- [ ] Finance 获取 People 标准成本并结合 Aims 工时计算项目人力成本。
- [ ] Finance 项目成本分摊和项目财务摘要正确重算。
- [ ] 缺少职级、工作日历或成本参数时显示“未就绪”，不得输出虚假完整毛利。

G2-3 实施任务拆解（2026-07-09）：

- [x] Aims 演示前置补齐独立源里程碑、源任务和挂接到同一任务的 10 条 / 80 小时期间工时；静态校验继续禁止预埋 Altoc 回流工作项等 API 派生结果。
- [x] Aims → People 同步使用路由项目 ID、周期和期间生成稳定幂等键；聚合测试锁定 40 + 40 = 80 小时、工时 ID 和任务键追溯。
- [x] Aims 用户态同步入口增加 `projects/edit` 权限；People data-runtime 在事务内锁定绩效周期，只允许 `collecting`，并校验周期项目、起止日期和完整自然来源键，已确认/关闭周期不可覆盖。
- [x] People 贡献自然键重放行为测试覆盖两次相同 `cycle + employee + source` upsert，以及缺失来源键和关闭周期失败关闭。
- [x] Finance 抽取纯计算计划，锁定月标准成本公式、Console 标准工时分母和精确金额；分摊编码由 data-runtime 基于规范化领域输入生成，缺 Aims 工时、People 职级成本、Console 日历或 Finance 参数时生成结构化 `not_ready` 完整集合命令。
- [x] Finance 项目列表在当前没有人力成本时隐藏毛利和毛利率，不再把只有旧财务摘要的项目展示为完整成本核算。
- [x] 将 Finance 人力成本同步收敛为 data-runtime 单事务领域动作：批量 upsert 当前 employee snapshot / allocation，反转本次集合中已消失的旧 labor allocation，并在同一事务内重算摘要。
- [x] 为 `project_finance_summary` 增加持久化 readiness、missing inputs、input hash 和最后同步时间；同步失败或源事实删除时使旧毛利失效，列表和详情只在 readiness=ready 时返回毛利。
- [x] 将 People 贡献同步升级为完整快照替换：在 collecting 周期内收敛已删除工时/退出成员，允许空集合清理当前项目来源；confirmed/closed 周期保持不可变。
- [x] 增加默认只读 preview、摘要二次确认、两项 POST 白名单和双重重放检查的 Cloudflare G2-3 验收工具；Cookie 只允许环境变量输入，写入异常不得盲重试或宣称自动回滚。
- [ ] 在真实六库执行 demo seed，使用受控管理员会话经 `https://wiztek.huizhi.yun` 完成两次贡献同步和两次 Finance 同步，再执行严格 verifier 与显式 cleanup；证据中不得保存 Cookie、人员明文或下游原始响应。

2026-07-09 G2-3 第一批离线收口记录：新增 Aims 贡献聚合/幂等 helper 与 4 项测试，修复 fallback 幂等键错误引用可选请求体项目 ID；Aims 同步入口在任何跨应用读取前要求项目编辑权限。People contribution sync 新增事务内周期锁、状态/项目/期间/来源自然键校验和 3 项 SQLMock 行为测试，避免普通项目可见用户借 Aims 覆盖任意或已关闭绩效周期。Finance 新增人力成本纯计划和 readiness 投影，37 项模块测试覆盖 80/160 小时、14360 月成本、7180 分摊、稳定编码和四类缺输入失败关闭；当前没有人力成本时列表会把 gross profit / margin 置空。演示 Aims seed/verify 已补 1 个源任务并要求 10 条工时全部挂接该任务，六库静态校验通过。Aims 119 项、Finance 37 项、People data-runtime 测试均通过。

本批次仍不勾选上方六项验收：尚未连接真实数据库或 Cloudflare 会话，也未执行部署。第一批结束时遗留的逐项非事务写入、旧 allocation 反转和持久化 readiness 已在第二批代码中收口，但仍需真实 MySQL 行锁/重放证据和 Cloudflare 部署态负向验收后才能关闭。

本批次完整 `release:check --allow-dirty` 已通过：Cloudflare 指令门禁、发布契约、演示数据静态/行为校验、全仓 lint/typecheck、125 个测试文件、Insights 41 项测试以及 data-runtime / notification-runtime Go 测试全部通过；仅保留既有 Insights lint warnings。该结果不包含部署、live probe、线上验收或 secret 操作。

2026-07-09 G2-3 第二批事务/readiness 收口记录：新增 data-runtime `POST /v1/finance/project-accounting/labor-costs:sync`，runtime 自行规范化完整 labor 集合并计算 SHA-256 稳定输入哈希，使用 `expectedInputHash` 和 `project_code + period_month` summary 行锁处理并发；一个事务内完成 employee snapshot upsert、SHA-256 稳定 allocation upsert、消失 managed labor 反转、Finance 收支/成本聚合和 summary 更新。BFF 改为先读当前 input hash，再以一次 runtime POST 写入；Aims / People / Console / Finance 参数不可用也会归一为 missing input 并持久化 `not_ready`，不再因外部依赖异常绕过旧毛利失效。普通项目重算锁定同一 summary 行并保留 readiness，非 ready 永远写 NULL 毛利；项目列表、详情 totals、月报、看板和维保摘要均按持久化 readiness 失败关闭。

Finance bootstrap schema 和 `20260709_project_finance_readiness.sql` 增量迁移新增 readiness/reasons/input hash/checked time 以及 allocation source refs；历史无法证明完整的摘要统一迁为 not_ready 并清空毛利，发布合同固定参数迁移 sequence=10、readiness 迁移 sequence=20。Go SQLMock 覆盖 ready 原子提交、not-ready 反转并清毛利、expected hash 冲突、summary 失败全事务回滚、输入顺序哈希稳定和普通重算不复活毛利；通用重算使用稳定 summary 锁顺序，看板在任一项目未就绪或无摘要时整体隐藏项目毛利，维保摘要无项目成本事实时同样失败关闭。Finance 40 项测试、typecheck、lint、release contract 开发门禁、六库 demo 静态/9 项行为校验及根级 `release:check --allow-dirty`（125 个测试文件、全量 Go 测试、Cloudflare 静态/dry-run 门禁）通过。真实 MySQL 并发与部署态证据仍留在后续验收任务。

2026-07-09 G2-3 受控 Cloudflare 验收工具记录：新增 `accept:g2-3-labor-cost-loop`，默认只输出零网络 preview 和当前参数对应的 SHA-256 确认摘要；执行模式必须同时提供 `--execute`、完全一致的 `--confirm` 和环境变量 Cookie。工具只允许经 `https://wiztek.huizhi.yun` 向 Aims 贡献同步和 Finance 人力成本同步两个固定端点发 POST，严格按 Aims 首次/重放、Finance 首次/重放执行，第二次 Finance 必须返回 `idempotentReplay=true` 且两次脱敏事实投影一致。任一 POST 结果无法验证会立即停止并以 `partial_or_unknown` 留档，不自动重试、回滚或 cleanup；0600 原子证据不保存 Cookie、人员字段、响应正文或下游原始对象。7 项行为测试覆盖零网络 preview、目标与凭据约束、确认摘要、四次固定 POST、第三路径拒绝、失败停止和非幂等重放拒绝；尚未提供真实会话执行，因此上方六项业务验收继续保持未勾选。

2026-07-09 G2-3 People 完整快照收口记录：`contributions:sync` 新增显式 `replace_scope + snapshot_complete=true` 语义，严格解析最多 2000 个 item，锁定顶层周期并校验 collecting、项目、期间、item cycle、来源范围、自然键重复和 schema 长度；同一事务先 upsert 当前集合，再只删除 `cycle + locked project + source_app + source_biz_type` 中未出现的 `(employee_uid, source_biz_id)`，空集合会清理该来源，旧未声明模式继续仅 upsert。People/Aims 两条 BFF 均移除空集合早退，校验 Aims `total/page/pageSize` 与完整 items、项目归属和工时数值后才声明 snapshot complete；Aims 从受信项目对象取得 project code，默认幂等键加入规范化集合哈希。通用 contribution CRUD 已封为只读；confirm、close 和 Workflow 批准改为同一周期 `FOR UPDATE` 事务，周期确认与贡献冻结任一步失败均回滚，Workflow 不能撤销 confirmed/closed。Aims 120 项、People 32 项、People data-runtime 56 项测试以及模块 typecheck/lint 均通过；根级 `release:check --allow-dirty` 也已通过 126 个测试文件、全量 Go 测试及 Cloudflare 静态/dry-run 门禁。SQLMock 可证明锁序、作用域 SQL 和回滚调用，但真实 MySQL 的并发最终集合、唯一键行数与锁等待仍须在六库验收中证明；当前并发 replace 采用周期锁下的原子 last-writer-wins，不宣称具备旧快照水位冲突检测。

### G2-4 Altoc 服务工单 → Aims → Altoc 闭环

- [ ] 创建包含客户、合同、交付资产、环境、SLA 的服务工单。
- [ ] 按显式项目、服务协议默认项目或唯一合同项目解析 Aims 项目。
- [ ] 多候选时返回明确冲突，不得任选第一个项目。
- [ ] Aims 创建或复用工作项，重放不产生重复工作项。
- [ ] Aims 回写首次响应、解决、关闭、文档 UUID 和最终项目编码。
- [ ] Altoc 正确更新 SLA 和服务权益消耗。

实现与验证子任务：

- [x] 增加受 `service_ticket:view` 和数据范围保护的 `dispatch-context` 领域读，通过 JOIN 返回可信客户、合同、维保合同、服务协议和交付编码；派发 BFF 不再从通用工单行或浏览器请求体猜测边界事实。
- [x] 合同兜底改为 Aims `contract_match=exact&limit=2` 的严格候选查询；一个 maintenance 加一个 delivery 仍判定多候选，不再按类别偏选，也不受客户前 50 条截断影响。
- [x] Aims 在创建前按 `work_item_service_ext.source_ticket_code` 全局锁定自然绑定；同项目重放返回既有工作项，不同项目返回 `service_ticket_project_conflict`，扩展表插入不再用 upsert 改绑旧工作项。
- [x] Aims 单条工作项 PUT 由本地 BFF 在 runtime 更新成功后编排结果回写：runtime 从受信项目、工单扩展、工时和唯一关联文档生成 payload，`todo/planning → accepted`、`in_progress → processing`、`in_review → resolved`、`completed → closed`，并冻结首响和解决时间。
- [x] Altoc delivery-result 拒绝项目/工作项换绑并忽略终态回退；同步写 `project_code/aims_project_code`，关闭时补齐解决时间；正式 coverage 按资产/环境 pair 精确匹配，不再把 delivery plan code 当正式资产。
- [x] 服务协议在额度检查和消费期间使用 `FOR UPDATE`；ticket/case 按累计 1 幂等扣减，hour/hours 按 Aims 受信累计工时减去工单已消费值只扣差额；迟到首次响应即使已解决也保持 `breached`。
- [x] 补齐 dispatch context、严格合同查询、Aims 全局绑定、状态 payload、普通工作项跳过、Altoc 绑定冲突/状态回退、小时差额和迟到 SLA 的 Go/Node 行为测试；Aims 120 项、Altoc 96 项及两模块 typecheck 通过。
- [x] 为单条和批量服务工单工作项状态修改增加持久化 outbox/重放命令；批量仅在 `changes.status` 且命中服务工单时按工作项在同一事务冻结 operation，保留现有本地 `updated` API 响应，不在请求内 N 次外呼。既有 Aims claim/drain、Altoc receipt、失败 checkpoint、dead-letter 诊断与受控 replay 负责网络失败恢复；非服务工单及非状态批改不创建 operation。
- [ ] 在真实六库和 Cloudflare 部署态执行显式/默认/唯一/多候选、首响/解决/关闭、唯一文档、小时额度和重放验收，留存脱敏证据后再勾选上方六项业务验收。

2026-07-09 G2-4 第一批闭环收口记录：完成可信派发上下文、严格合同唯一性、Aims 全局自然绑定、单条工作项状态回写编排、Altoc 绑定与状态单调保护、正式资产环境覆盖匹配、协议行锁、小时额度差额扣减和迟到首响 SLA 修复。所有跨模块调用继续使用 Console service token；初次派发只回写 `accepted`，首次进入执行态才冻结 `firstRespondedAt`。Aims payload 的项目、工作项、工时和 Codocs UUID 均来自 data-runtime，多个关联文档时失败关闭而不任选。根级 `release:check --allow-dirty` 已通过 126 个测试文件、全量 Go 测试、lint、typecheck、Cloudflare 静态/dry-run 门禁；仅保留 166 条既有 Insights warning。当前没有部署或真实数据库写入；批量更新/outbox 属 G3 可靠性任务，真实业务验收保持未勾选。

2026-07-11 G2-4/G3 批量服务工单状态可靠化：`PATCH /api/v1/work-items/batch` 现与单条 PUT 对齐，先在现有 Aims 事务内写工作项与 changelog；当 `changes.status` 命中带 `work_item_service_ext.source_ticket_code` 的行时，逐项冻结既有 `aims.work-item.ticket-result.v1` caller-owned operation。operation 的目标、capability、业务键、阶段、文档、工时、tenant/deployment 与 actor 均继续由 runtime 受信上下文/数据库生成，浏览器不能覆盖；任一 command/outbox 插入失败会回滚整个 batch。接口仍只返回本地 `updated`，不即时 N 次调用 Altoc，原有 claim/drain、receipt checkpoint、退避、dead-letter 和受控 replay 负责网络失败恢复；非服务工单或非状态批改不产生命令。批量端同时补齐 `work_items:edit` 服务端检查，不能仅凭项目成员关系写入。无需 schema、migration、manifest、Console grant 或调度配置变更。SQLMock 与 Aims 路由契约已覆盖状态 outbox、非状态无 outbox、outbox 失败回滚、权限在 runtime/body 前拒绝和正常 runtime 转发；真实数据库、Cloudflare、迁移/seed、服务调用和租户验收均未执行。

### G2-5 运维知识、交付资产和维保财务

- [ ] Codocs 运维文档关联客户、合同、项目、交付资产、环境和服务工单。
- [ ] Altoc/Assets 只保存文档 UUID 和必要快照，不复制正文。
- [ ] Assets 交付资产包按客户、合同、项目返回产品、环境和文档。
- [ ] Altoc 先解析维保范围，再调用 Finance 维保财务摘要。
- [ ] Finance 不把同一客户的非维保项目计入维保摘要。

G2-5 实现与验证子任务（2026-07-09）：

- [x] Codocs 将运维知识关系收敛为客户、合同、项目、正式交付资产、环境、服务工单六类；使用稳定 service principal 且三个 `can_*` 全为 false，调用者不能借上下文关系获得文档权限。
- [x] Codocs 强制 `sourceApp=altoc`、要求完整六类上下文和 `document_relations` schema，并在一个事务内 upsert 全部关系；中途失败全量回滚，同文档由不同操作人重放不新增关系。
- [x] Altoc 新增用户态 `service-tickets/{ticketCode}/ops-knowledge` 编排，浏览器只提交文档 UUID；客户、合同、项目、交付视图、正式资产、环境和工单全部从 scoped dispatch context 解析，绑定冲突和缺上下文失败关闭。
- [x] Altoc 在任何下游写入前用工单行锁预留 UUID；不同 UUID 并发或半成功后的换绑会冲突，同 UUID可继续修复重放。随后使用同一稳定幂等键调用 Codocs 与 Assets并 complete `codocs_document_uuid`；Assets service capability 明确允许 Altoc。
- [x] Assets 把文档 UUID upsert 与首次 `document_linked` 事件放入同一事务，重放不重复事件；来源客户/合同/项目优先使用 Assets 交付视图事实，缺 artifact/source schema 时 503。
- [x] Assets 交付包强制 `customer_code`，客户/合同/项目使用精确 AND，除交付视图的产品/环境/UUID 文档外返回正式 `customer_delivery_assets` 及正式环境关系；响应不读取或返回 Codocs 正文。
- [x] Altoc 显式维保过滤不再用未请求的另一维全量补齐；Finance 要求至少一个维保合同或项目编码，并按 `customer AND (contract OR project)` 汇总，项目授权另作 AND 约束；只带合同和只带项目的合法事实均保留，同客户非维保事实被排除。
- [x] Assets/Finance 404 不再伪装为 code=0 空数据；模块 Go/Node 行为测试和 Altoc/Assets/Codocs typecheck 已通过。
- [x] 增加 Codocs v1.3 升级迁移：历史 `ops_knowledge` 用户 principal 关系归零 ACL 并停用，稳定 principal 关系强制三个 `can_*` 为 false；增加 Altoc 038 迁移和 bootstrap 字段保存 pending UUID/status/idempotency key。
- [ ] 完成持久化跨应用 outbox 的 claim/失败 checkpoint/scheduled drain/诊断与受控重放，覆盖 Codocs 成功而 Assets/Altoc 暂时失败后的自动恢复。调用方 Altoc 已在 UUID reservation 同一事务写入 Codocs、Assets 两条单目标 `integration_operation`，Codocs 成功可单独确认，Assets 成功确认与工单 linked 同事务；Aims/Altoc 已提供租户范围化诊断、受控重放 API、共享请求/后台 executor 和有界 drain task。显式绑定单一 tenant/deployment 的专属 Worker 可启用 Cloudflare cron；共享多租户 Worker 仍需补可信 registry 调度，且失败通知和目标 receipt 尚未完成，因此本组合项保持未勾选。
- [ ] 在真实六库执行 demo seed，经 Cloudflare 指令部署后以受控会话完成两次运维知识关联、Assets 包和 Finance 摘要读取，再运行严格 verifier/cleanup 并保存脱敏证据；未提供会话和部署授权前不执行 live 写入。

2026-07-09 G2-5 第一批离线收口记录：Terra 领域审计发现并推动关闭 Codocs ACL 越权/部分提交/假成功、Finance 空范围全客户聚合和 404 成功空值等 P0；Luna 测试审计推动补齐受信上下文、正式资产环境、负向范围和行为级 SQLMock。当前实现证明六类关系原子且不授权、Altoc 只信 runtime 上下文、Assets 文档与事件原子、交付包精确范围以及 Finance 空范围失败关闭/维保 OR 口径。尚未部署到 Cloudflare 或连接真实数据库，上方五项仍作为业务验收项保持未勾选。

2026-07-09 G2-5 第二批升级/并发收口记录：Luna 对最新树复核后发现旧版本已写用户 ACL 关系不会被稳定 principal upsert 覆盖，以及 bind-last 允许两个 UUID 并发产生孤儿下游关系。Codocs 新增 v1.3 升级迁移，停用旧用户 principal 并将所有 ops context ACL 归零；demo verifier 额外要求全库 0 条 active ACL-granting ops relation。Altoc bootstrap 和 038 迁移新增 pending UUID/status/idempotency key，编排在任何下游写入前先锁工单预留 UUID，失败保留 pending 且只允许同 UUID修复重放，成功后 complete；Assets 对 ops knowledge 强制校验正式资产—环境 active 关系和交付客户/合同/项目一致性，并把两项 code 写入 UUID source context。Finance demo 增加同客户 900000 非维保发票负样本，真实摘要必须仍只有 100000 维保发票。最终 `release:check --allow-dirty` 通过 Cloudflare 指令门禁、发布/迁移 SHA、六库 demo 静态和行为校验、全仓 lint/typecheck/128 个测试文件、Insights 41 项测试及全部 Go 测试；仅有 166 条既有 Insights warning。没有执行部署、live probe、数据库迁移、真实验收或 secret 操作。

### G2-6 发布与回滚演练

- [ ] 按 runtime → Platform/Console/Gateway → People → 业务桥接顺序部署。
- [ ] 记录每一步版本、时间、执行人和验证结果。
- [ ] 演练 data-runtime 回滚，确认业务主档不需要回滚。
- [ ] 演练 gateway 回滚，确认旧应用路径仍可用。
- [ ] 演练 service grant 修复和 bundle 刷新。

G2-6 实现与验证子任务（2026-07-10）：

- [x] 发布合同升级为 schema v2，纳入 Platform / Console commit，机器锁定 `schema 前置 → runtime → Platform/Console → grant/bundle → Gateway → People → Assets/Codocs/Finance → Aims/Altoc → 验收 → 回滚演练` 顺序。
- [x] 增加离线 `plan:g2-6-release`：默认零网络、零数据库、零部署，拒绝 credential/execute 参数；绑定合同、源码、seed、远端 snapshot 和执行人/change ID，输出稳定确认 SHA；计划文件原子写入且权限为 `0600`。
- [x] 增加 data-runtime 守卫回滚 CLI：默认只校验 current/previous 二进制并输出 SHA-256；仅 `--execute --confirm hzy-data-runtime.previous --change-id <change-id>` 交换，执行前自动 pin 并获取共享锁，重启失败时恢复原 binary 并显式报告二次重启错误。
- [x] 增加 Tenant Gateway `gateway:release` 守卫入口：deploy 固定 tests → dry-run → pre-ID → deploy → post-ID，rollback 绑定精确 version ID；真实执行要求 locked 合同和确认 SHA，失败停止且 0600 证据不保存完整 stdout/stderr。
- [x] 修复 Altoc → Assets 文档写入的 v1.32 service grant 元数据，并在发布合同中锁定 endpoint marker。
- [x] 增加 G2-6 发布/回滚手册，明确不使用 GitLab Runner，Cloudflare 固定 `wrangler@4.110.0`，wiztek Platform 默认发布到 Cloudflare、PM2/Nginx 仅保留为固定 IP 可选 profile，grant repair 与 policy bundle refresh 分开验收。
- [x] data-runtime 版本目录改为原子、不可变发布，固化 exact-version installer、双架构 artifact SHA manifest 和全文件 `release.sha256`；R2 拆为默认零网络 preview 的 stage/promote，精确摘要确认、远端同版本异 hash 拒绝、`latest/version.txt` 最后激活。
- [x] `/runtime/update` 只接受精确版本，HTTP 不得覆盖 source/install/service/force/no-restart；可信 HTTPS allowlist、最小原子 request env、跨进程 0600 journal、共享 execution lock、tracking/pinned/disabled policy 和 stale `partial_or_unknown` 已实现。
- [x] updater 在下载 archive 前读取版本 manifest，并校验身份、架构、文件名和 artifact SHA；binary current/previous 均改为 fsync 后原子替换，timer/API/manual/installer/rollback 共用同一锁。
- [x] 增加独立于 R2 的 Ed25519 detached signature：manifest、双架构 archive 和 exact-version installer 均签名；package 无私钥拒绝，updater 与 installer 使用外部预置公钥验签并校验 key ID，私钥不进入 package/R2。
- [ ] 由发布负责人离线生成/托管正式签名密钥，向目标服务器独立下发 public key，并把 64 位 signing key ID 与目标 artifact SHA 锁入 release contract/snapshot；仓库不生成或保存生产私钥。
- [ ] 在已批准变更窗口采集远端只读 snapshot，锁定发布合同并通过 clean `release:check`；随后由负责人执行真实 Cloudflare/PM2、生产 grant/bundle 和两项 rollback/roll-forward，归档脱敏 journal 后再勾选上方五项。

2026-07-10 G2-6 第一批离线收口记录：Terra/Luna 审计确认现有 10 个应用 Cloudflare 模块门禁和 Gateway 6 项测试可复用，但发现 Platform/Console 未锁入合同、Gateway 无精确版本回滚流程、data-runtime 无人工安全回滚、service grant 与 policy bundle 被概念混用且没有 0600 发布事实记录。本批已关闭合同顺序、离线计划、runtime 二进制回滚、Gateway 守卫发布/回滚入口和 Altoc Assets grant 元数据缺口；新增 G2-6 planner 7 项、Gateway release 6 项与 updater 7 类行为测试均通过并纳入 `release:check`。最终 `release:check --allow-dirty` 通过发布合同、Cloudflare 指令门禁、全仓 lint/typecheck/128 个测试文件、Insights 41 项和全部 Go 测试，仅保留 166 条既有 Insights warning。发布合同仍为 draft，所有真实部署、生产 SQL、bundle 切换、R2 发布、runtime 更新和回滚均未执行，上方五项保持未勾选。

2026-07-10 G2-6 第二批 data-runtime 供应链收口记录：Terra 完成不可变 package 与 R2 stage/promote；扩展后的 11 项 fake Go/Wrangler/OpenSSL 测试证明无私钥拒绝、preview 零调用、远端篡改首写前拒绝、失败不提前切换 latest 指针，以及 installer 强制验签。Luna 用安全测试固化官方/显式 HTTPS allowlist、危险 URL/特权字段/非精确版本拒绝和 0600 原子 request。主任务进一步统一 external oneshot、持久 journal、共享 flock、policy-aware timer、rollback 自动 pin、installer 原子 previous/new 切换、manifest artifact SHA 与 detached Ed25519 验签；新 Server 实例可读取 queued/succeeded，损坏或 stale running journal 返回 `partial_or_unknown`。最终 `release:check --allow-dirty` 通过发布合同、Cloudflare 指令门禁、G2-6 planner 7 项、Gateway release 6 项、data-runtime 发布链 11 项、全仓 lint/typecheck/128 个测试文件、Insights 41 项与全部 Go 测试，仅保留 166 条既有 Insights warning。生产 signing key/kid 尚待发布负责人离线生成和独立下发；未执行任何真实 R2、runtime、Cloudflare、数据库或 bundle 写入。

### G2 总验收

- [ ] P3/P4 清单所有 AC 项通过。
- [ ] 至少一组完整演示数据可重复构造。
- [ ] 所有跨模块写操作验证幂等重放。
- [ ] 所有关键状态变更可通过 request ID 和业务键追踪。
- [ ] 发布和回滚记录已归档。

## 7. G3：跨模块可靠性与可运维性

### G3-1 统一跨模块操作记录模型

- [x] 设计统一字段：source/target app、operation、source biz、target biz、idempotency key、request ID、actor、service client、tenant、deployment、status、attempt count、last error、next retry、timestamps。
- [x] 明确该模型属于调用方 BFF、目标应用还是独立 runtime；避免多处重复记录同一事实。
- [x] 区分业务审计、集成操作记录和领域事件 outbox，不混为一张万能表。
- [x] 更新 `MODULE_CONTRACTS.md` 和相关 schema 文档。

2026-07-10 G3-1 P0 冻结记录：Terra 审计并冻结 caller-owned operation / target receipt 模型；`CROSS_MODULE_OPERATION_MODEL.md` 明确 operation 必须由调用方 data-runtime 在本地 mutation 同一事务写入，业务审计、定向集成命令和 domain event outbox 分离。共享 Go 内核已覆盖 8 状态、401/403/契约/冲突/瞬态分类、409 existing/in-progress、30 秒指数退避、8 次/24 小时阈值、1 小时 Retry-After 上限、lease `partial_unknown`、不可变身份、UUIDv4 和敏感内容拒绝。Luna 完成 Altoc `integration_operation`、append-only attempt、`service_command_receipt` 三表；初版 migration 039 已在临时 MySQL 8.4 连续执行两次并校验 CHECK，最终版补充 `processing` attempt 状态后已锁定新 SHA 并通过仓库发布合同检查，仍需在真实发布前置数据库复跑 migration 验收。data-runtime 增加不可伪造的 tenant/deployment/source app/service client/request ID 注入；Altoc 运维知识 reservation 与 Codocs/Assets 两条 operation 原子提交，outbox 插入失败整体回滚。领取操作、依赖阻塞、成功/失败检查点、401/403 终态、5xx 退避、timeout `partial_unknown`、租约过期 attempt 终结以及 Assets 成功+工单 linked 的同事务围栏收口均已有自动化测试。尚未宣称具备 scheduled drain、管理员诊断/重放、失败通知或目标 receipt 执行器。

### G3-2 首批接入关键写链路

- [x] Altoc 工单运维知识 → Codocs 文档关联 → Assets 交付文档绑定（首条可靠投递纵切）。
- [x] Altoc 合同激活 → Aims 项目/里程碑。
- [x] Aims 验收 → Altoc 回款计划可开票。
- [x] Altoc 开票申请 → Finance/Workflow。
- [x] Finance 核销 → Altoc 财务摘要。
- [x] Assets 状态 → Altoc 服务覆盖/义务。
- [x] Aims 工时贡献 → People。
- [x] People employment/offboarding → Console/Platform。
- [x] Aims 单条工作项结果 → Altoc 工单状态可靠回写。
- [x] Altoc 服务工单 → Aims 及结果回写。

2026-07-10 G3-2 Aims 工时贡献→People 可靠化记录：Aims 新增项目/周期/来源 scope 的单调快照 revision 账本，在锁定项目与期间工时的 `REPEATABLE READ` 事务内聚合完整集合、计算规范化 content hash，并与 caller-owned `aims.people-contributions.replace-scope.v1` operation 同事务冻结；operation key 使用原始 scope 的 SHA-256，避免字符替换碰撞和超长键。People 在锁定 collecting 周期的同一事务重算 content hash，按 `cycle + locked project + source` 完整替换、推进目标水位并写 succeeded receipt；B→A 乱序低版本为零 mutation 的成功 `staleSkipped`，同版本同 hash 幂等、同版本异 hash 409，空集合可作为新版本清理旧贡献，confirmed/closed 周期先行拒绝。Aims BFF 已移除 People 直连和浏览器路由选择，固定 dispatcher 支持即时 202、5xx/ack 丢失恢复及既有 Cloudflare 定时有界 drain。新增迁移与基准 schema 仅形成文件，本轮未执行 DDL、seed 或部署；Insights/Align 未触碰。

2026-07-10 G3-2 People 生命周期→Console/Platform 可靠化记录：People data-runtime 不再根据浏览器 body 或 BFF 成功回调直连 Console，而是在 employee 或已批准且已生效 assignment POST/PUT/PATCH 的同一事务重读 canonical facts、锁定 employee、递增单调 revision 并冻结 caller-owned operation；旧 admin Directory disable 旁路返回 410。未来生效 assignment 不提前停用或改岗；默认关闭的 scheduled task 使用固定 RFC3339 `asOf`、opaque cursor 和有界分页先调用 `directory-lifecycle:prepare-due`，保留 25 秒余量后再 drain，同页失败明确记录且不伪报成功。family selector 可接管过期 processing lease，旧 attempt 关闭为 `partial_unknown`，新 claim 使用递增 fencing，旧 checkpoint 失败关闭。People→Console HMAC 绑定 path/tenant、header=envelope=service actor 的 source deployment、显式 `HZY_CONSOLE_TARGET_DEPLOYMENT`=Console 本地 binding、capability/hash/original actor/timestamp；Directory flag 开启时 Cloudflare renderer 才要求目标部署并写入 Worker vars，旧通知/Assets 单独开启不回归。Console 用精确 `console:directory-employment:sync` / `console:directory-offboarding:disable`，在同一事务完成 Directory 用户、People 来源唯一主部门、离职 session/refresh token 回收、applied watermark、succeeded receipt 和 Console-owned Platform operation。下一跳同样绑定 Console source 与固定 Platform target deployment；Platform 在同一事务完成 authorization mutation、applied watermark 与 receipt。低版本 stale-skip、同版本异 hash 409，active→left→active 与迟到旧任职不会回退；Console receipt 在 Platform pending 时使 People 保持 retry，Platform 成功后同键重放动态返回 succeeded，Directory mutation 仅一次。People/Console drain 默认关闭，最多 20 条、45 秒且剩余不足 25 秒停止。行为测试覆盖 pending→retry→replay success、source/target/tenant/path/capability/hash/actor/timestamp/token 篡改在事务前 403、renderer 默认/显式/缺绑定/旧任务回归和 Platform revision 状态机。People 56/56、Console 226/227（1 条条件 MySQL skip）、Platform 166/166 测试，以及三模块 lint/typecheck、data-runtime 全量 Go test/vet 均通过。新增 schema/migration/grant 只形成文件并登记 release hash；未执行 DDL/seed、未部署、未 live probe，Insights/Align 未触碰。

### G3-3 重试、重放与诊断

- [x] 为可重试错误定义退避、最大次数和终态。
- [x] 401/403 不自动重试；保留真实错误，不转换为泛化 502。
- [x] 幂等冲突返回已有目标业务键，不重复创建。
- [x] 提供管理员只读诊断和受控重放入口。
- [x] 重放不得允许修改原 tenant、source app、target app 或稳定业务键。
- [x] 失败达到阈值时发布 Console 站内通知。

2026-07-10 G3-2/G3-3 首条纵切记录：Altoc BFF 不再直接把一次请求当作跨应用事务，而是领取数据库冻结的 Codocs/Assets 命令；目标调用失败写 attempt 和安全摘要后返回 `202 accepted`，客户端重试可从已成功的 Codocs 步骤继续领取 Assets，不重复创建前置对象。dispatcher worker、tenant、deployment、source app、service client 和 request ID 全部来自 data-runtime 注入的可信上下文，浏览器不能覆盖 worker、lease、目标应用、capability 或 payload。Codocs 成功检查点与 Assets 最终绑定均校验 operation ID、worker、未过期 lease 和 fencing token；旧 worker 回写会被拒绝。当前只有请求驱动领取和通用 `claim-next` runtime API，尚未接入 Cloudflare 定时 drain、管理员 UI、Console 通知或目标端 receipt，因此相应条目保持未完成。部署仍按 G0-7/G2-6 的版本化 Cloudflare 指令执行，不引入 GitLab Runner。

2026-07-10 G3-2 Finance 核销纵切：选择单目标的 `Finance reconciliation → Altoc finance summary` 先闭合。两种核销入口均由 Finance runtime 从锁定的发票/到账关联和事务内重算摘要生成最小 `finance.reconciliation.altoc-summary.v1` command，并与核销事实同事务写 caller-owned `integration_operation`；浏览器 body 不选择可靠命令的合同、计划、target 或 capability。Finance 即时/定时 executor 使用固定映射投递，Altoc 回款计划更新与 succeeded `service_command_receipt` 同事务；source 仅在精确 receipt 校验后 checkpoint，同键异 hash 409，ack 丢失可按原幂等身份恢复。已提交但待投递的 HTTP 编排响应明确返回 202；后台 drain 由 `HZY_FINANCE_INTEGRATION_OPERATIONS_ENABLED` 默认关闭并在 runtime binding/token/network 前短路，单次最多 20 条/45 秒且仅在剩余至少 25 秒时继续 claim。增量 migration 尚未执行。此批没有为 Finance 增加管理员诊断、dead-letter 通知或受控 replay，G3-3 总验收不据此关闭；未部署、未执行 migration/seed、未触碰 Insights/Align。

2026-07-10 G3-2 Assets 状态纵切：`customer-delivery-assets/{code}/activate` 的 Assets 状态事实与 caller-owned `integration_operation` 已同事务。为避免 online→suspended→online 重复状态和乱序回调，Assets 只在正式 delivery asset、environment、status、来源关系及生命周期时间等目标事实变化时递增单调 `sourceRevision`，冻结 occurredAt；同事实重放复用原 operation。Altoc 在 receipt 事务锁定 applied watermark，低 revision 返回 succeeded `staleSkipped` 且零业务 mutation，同 revision 同 hash 幂等、异 hash 409，高 revision 才推进计划资产、服务覆盖、履约义务和结算并更新水位。即时 pending 返回 202；`HZY_ASSETS_STATUS_OPERATIONS_ENABLED` 默认关闭并在 binding/token/network 前短路，drain 为 20条/45秒/剩余25秒。DDL 未执行，未部署、未执行 seed、未触碰 Insights/Align；Assets 管理诊断/dead-letter/replay 不因此计为完成。

2026-07-10 G3 首条纵切离线门禁：Node 22.19.0 / pnpm 11.10.0 / Go 1.26.3 下，`release:check --allow-dirty` 通过 10 个 Cloudflare 部署入口与配置守卫、129 个测试文件、全部活跃模块 lint/typecheck/test、Insights 41 项以及 data-runtime/notification-runtime 全部 Go 测试；仅保留 166 条既有 Insights warning。该命令明确未执行部署、live probe、真实验收或 secret 管理。发布合同仍为 draft、工作区仍 dirty、生产 signing key ID 未锁定，因此不视为生产发布完成。

2026-07-10 G3 第二条纵切记录：Aims 单条工作项 PUT 已从“业务 UPDATE → 独立 prepare → BFF 直接回写”改为 data-runtime 事务 hook。工作项变更、`work_item_service_ext` 首响/解决时间和 `aims.work-item.ticket-result.v1` operation 同事务；operation 插入失败整体回滚。同一阶段复用原 operation 和冻结 command，浏览器伪造 ticket/work item/stage/document/target/route/idempotency/内部 URL 不会进入命令。BFF 按 operation key claim，使用冻结 command 调 Altoc，并以可信 worker、未过期 lease 和 fencing token 写 success/failure attempt；失败返回 202。Aims 三表 migration v5.0 已在 MySQL 8.4 连续执行两次，并验证 attempt 默认 `processing` 与非法状态 CHECK。旧 prepare/direct-sync 入口已删除。Altoc→Aims 创建方向、批量工作项更新、scheduled drain、失败通知和目标 receipt 尚未完成，因此组合条目仍不提前勾选。

2026-07-10 G3 运维入口收口记录：Terra 复核确认现有 claim/recovery/dependency 查询已全程约束可信 tenant、deployment、source app；同时发现共享 Replay 原实现只按 operation ID 与 version 更新。现已把 ReplayInput 和 SQL 收紧为 operation ID + tenant + deployment + source app + version + `failed_permanent|dead_letter`，更新列不包含 command、hash、幂等键或身份字段。共享 Repository 新增状态过滤、1–100 限额和 `updated_at + operation_id` keyset 分页的脱敏诊断查询，不读取 `command_json`。Aims/Altoc 新增 BFF 管理 API 与独立 `integration_operations:view/replay` 权限，浏览器提交的 tenant/source/actor 不参与范围选择；Aims 角色 seed 与两应用 manifest 已同步。Luna 测试覆盖缺租户触库前拒绝、claim/recovery/list/replay SQL 范围、游标分页、非法状态/限额、不可变字段及非失败状态重放拒绝。最终 `release:check --allow-dirty` 通过 Cloudflare 指令门禁、130 个测试文件、全部活跃工作区 lint/typecheck/test、Insights 41 项和两个 runtime 的全部 Go 测试，仅保留 166 条既有 Insights warning；未执行部署、live probe、真实验收或 secret 操作。Cloudflare scheduled drain、可视化 UI、失败通知、attempt 详情和目标 receipt 仍未完成。

2026-07-10 G3 有界 drain 收口记录：Aims 工作项结果和 Altoc 运维知识两条链路已把即时请求与后台执行统一到同一个冻结命令 executor；后台不读取命令内的 URL、tenant、deployment、target 或 capability，也不向目标应用转发 runtime URL/token。Aims/Altoc 新增 `integration-operations:drain` Nitro task，单次默认最多领取 20 条、总墙钟 45 秒，仅在至少剩余 25 秒时继续领取；每轮使用稳定 request ID 串联 claim/checkpoint，逐条校验返回 operation 的 tenant/deployment/source binding，空队列正常结束。409 由 Foundation 按稳定错误码保守区分幂等成功、处理中、payload mismatch、binding conflict 和未知永久冲突；Assets 幂等成功仍通过 Altoc `ops-knowledge:complete` 原子收口。Cloudflare cron 只在 `HZY_AIMS_SCHEDULED_DRAIN_ENABLED` / `HZY_ALTOC_SCHEDULED_DRAIN_ENABLED` 显式开启且 runtime endpoint、tenant、deployment 已绑定时生成；managed Cloudflare 必须用专属 Console service client，拒绝静态 runtime token。共享 tenant-neutral Worker 不配置租户 runtime 变量，故本次未默认开启 cron，下一步需由可信 Platform/Tenant Gateway registry 分片唤醒。Foundation 90、Aims 124、Altoc 102 项测试及三模块 typecheck/lint 已通过；最终 `release:check --allow-dirty` 进一步通过 132 个测试文件、Insights 41 项测试、全部活跃工作区 lint/typecheck/test、两个 runtime 的全部 Go 测试及 Cloudflare 配置/指令门禁，仅保留 166 条既有 Insights warning。未执行 Cloudflare 部署、live probe、secret 写入或真实 operation 消费。

下一执行批次（按优先级）：

- [x] P0：冻结共享多租户 scheduler 契约，由 Platform/Tenant Gateway 可信 registry 枚举 tenant/deployment，使用有界游标、分片、并发上限和单租户熔断唤醒 Aims/Altoc；不得把 Runtime URL/token 放入消息或业务 command。
- [ ] P0：专属绑定 Cloudflare 配置行为测试已覆盖默认关闭、缺 binding 拒绝和显式开启；仍需部署态 live acceptance 验证空队列、20/45 秒边界、错误 binding fail closed、5xx 恢复、幂等成功及旧 fencing token 拒绝。
- [x] P1：接入 dead-letter 阈值 Console 站内通知，使用稳定通知幂等键且不包含 command、token、内部 URL或响应正文。
- [x] P1：实现目标端 `service_command_receipt` 执行器与同键同 hash/异 hash 契约，补齐目标业务键返回和 source ack 丢失恢复证据。
- [x] P2（离线实现）：Console 管理员单 operation/attempt 时间线与 People diagnostics 的安全 keyset continuation 已具备；查看、重放继续使用分离权限，默认不返回完整 command/response、hash、worker/lock、correlation/idempotency 或内部 URL。
- [ ] P2（验收证据）：在具备授权会话的目标环境以 1440px 与 390px 验证 Console 时间线/People diagnostics，并留存脱敏的真实 operation 历史与权限拒绝证据。

2026-07-10 G3 共享 scheduler 收口记录：Terra 只读审计确认原 host resolve 会返回静态 Runtime token，且 Foundation service-token / Console-runtime cache key 未绑定 tenant/deployment，存在共享 Worker 串租户风险；Luna 以 fake fetch 固化了分页、分片、并发、墙钟、失败隔离、空 registry、无凭证 URL/body/log 和用户 HTTP 禁入。Platform 新增内部 scheduler page：只查询 active tenant/site/deployment，按 `CRC32(tenant|environment)` 分片，使用时间 slot 旋转固定窗口和绑定 slot/shard/window 的不透明 cursor，仅返回 host、tenant、environment、Aims/Altoc app code。Platform shared resolve 不再读取/返回 bootstrap static token。Tenant Gateway 以版本化 5 分钟 cron 每轮最多 4 页、50 租户、并发 4、45 秒；每租户重新 resolve 后以固定空 body POST 唤醒，Runtime endpoint 只在可信 header，token 不进入 scheduler page、URL、body或日志。Wake 使用 Gateway internal token + 60 秒 HMAC，普通 HTTP 和 `/_nitro/tasks/**` 双层拒绝；Aims/Altoc 用 event-bound IO 执行 10 条/25 秒 drain。Foundation 已将可信 tenant/deployment/environment/app 加入两类 cache key，并让 managed 跨应用调用重新进入 tenant host，由 Gateway 注入目标 deployment。Platform 163、Foundation 93、Aims 125、Altoc 103 和 Gateway 12 项针对性测试及四模块 typecheck/lint 已通过；根级 `release:check --allow-dirty` 进一步通过 134 个测试文件、Insights 41 项测试、全部活跃工作区 lint/typecheck/test、两个 runtime 的全部 Go 测试和 Cloudflare 指令门禁，仅保留 166 条既有 Insights warning。未执行部署、live probe、真实验收或 secret 操作，因此相关部署态条目不提前关闭。

2026-07-10 G3 P1 receipt/通知收口记录：Terra 审计确认目标业务 mutation 与 receipt 必须同事务、source/target deployment 必须分离、source BFF 不能只靠目标 Runtime bearer 推断调用方身份。Foundation 现以目标短期 Runtime bearer 对 method/path、tenant、source/target deployment、source/target app、operation/code/capability/idempotency/schema/hash/request ID 做 60 秒 HMAC；data-runtime 在业务 SQL 前验证并注入保留上下文。共享 receipt repository 已接入 Altoc 工单回写、Codocs 运维知识关系和 Assets 交付文档关系，目标写入与 succeeded receipt 同事务；同身份同 hash 不重跑 handler并返回原业务键，异 hash/operation/schema/capability 在 SQL 前拒绝，source checkpoint 校验并保存 `target_receipt_id`。Aims/Altoc source runtime 只扫描自身可信范围下的 dead-letter 安全投影，Foundation 以 `aud=notifications`、`notifications:publish` 调 Console 专用入口；Console 精确绑定 token 的 app/tenant/deployment，使用 SHA-256 稳定幂等键，优先 active 原操作人并以 `notification.integrationOperationRecipients` 回退。Console 成功后 source 才 CAS 写 notification ID/time；publish 成功但 ack 丢失会重复取得同一通知再确认。Luna 测试覆盖 receipt 原子性、同键恢复、异 hash 回滚、通知 scoped scan/CAS/idempotent ack；Foundation 额外覆盖 source ack-loss 恢复，Console 覆盖身份绑定和敏感字段拒绝。seed v1.36 已登记通知 grant 与 fallback 参数。所有结果为本地离线验证，Cloudflare 部署、真实 token/租户、数据库 migration 和站内通知 live acceptance 仍未执行。

2026-07-10 G3-2 Altoc 合同激活→Aims 可靠化：Altoc tenant-runtime 现在把合同激活、签约阶段回款计划和每个可信 `project_plan` 的 caller-owned operation 在同一事务提交；每个 plan 固定拆为 project operation 与依赖它的 milestone operation，sequence/depends-on、target=`aims`、capability=`aims:write` 和 endpoint 均由 dispatcher 代码决定。无显式 project code 时 source 使用与 Aims 相同的规范化算法冻结确定 code，并把该 code 同时写入两个不可变 command；前序 response 不会改写后序 payload。原 actor 只留在 operation 审计列，不进入 command hash，因此另一操作者以同 activation key 恢复不会产生假 payload mismatch。Aims 两个 endpoint 支持标准 service-command envelope，分别在项目 mutation/里程碑 mutation 的同一事务写 succeeded receipt；source 精确校验 receipt evidence 后才 checkpoint，timeout、5xx、ack 丢失和进程重启继续复用通用 claim/drain/replay/dead-letter。即时 executor、scheduled drain 和管理员受控重放共用冻结命令；浏览器 body 不能选择 tenant/deployment/target/capability/path。多 plan descriptor 固定回传 project code/role/line/obligation 映射，Assets 只在预期 project 与 milestone operation 都非空且全部成功后继续；缺失、pending 或失败返回 HTTP 202 并保留 activation step。Altoc 全量 132 项、Aims 全量 148 项通过；data-runtime 全量 `go test ./...` 与 `go vet ./...`、两模块 typecheck、相关 ESLint 与 diff-check 已通过。未执行 migration/seed、Cloudflare 部署、真实 operation 消费或 live acceptance，未修改 Insights/Align。

2026-07-10 G3 P2 离线实现记录：data-runtime 新增 tenant/deployment/source/operation 四重约束、1–100 限额和 `attempt_no ASC` 的 attempt 查询；公开 DTO 移除 request/correlation、worker lock、fencing、command、response、hash、URL 和认证材料。Aims/Altoc 增加 attempt BFF，管理调用要求同一授权 grant 为无对象限制或显式 `tenant/global`，查看与重放权限分离，重放原因限制为 1–500 字符。Foundation 新增共享 Nuxt UI 列表、状态过滤、详情 attempt 表和受控重放组件；Aims 使用 `/integration-operations` 避开其 `/admin/**` 平台管理员语义，Altoc 保留 `/admin/integration-operations`。Foundation 105 项测试、三模块 lint/typecheck 和 Aims/Altoc/integrationoperation Go 测试通过；最终 `release:check --allow-dirty` 进一步通过 137 个测试文件、Insights 41 项、全部活跃模块 lint/typecheck/test、两个 runtime 的全部 Go 测试和 Cloudflare 指令门禁，仅保留 166 条既有 Insights warning。Aims 本地 Worker 成功编译并将页面请求重定向至 Console OIDC，但本机 Console 3000 未启动，故无法取得真实登录态完成 1440px/390px 视觉和交互验收。本项保持未勾选，待受控 Cloudflare 租户会话补齐浏览器证据后关闭；本批未执行部署、live probe、真实验收或 secret 操作。

2026-07-10 G3-2 Aims 验收→Altoc 可开票可靠纵切记录：`review-approve` 现在在 Aims data-runtime 内锁定里程碑，把 completed/下一里程碑激活与 `aims.milestone.receivable-billable.v1` operation 同事务提交，operation 插入失败会整体回滚。冻结 target 只来自受信 `milestones.payment_term_id/project_code/contract_code`；浏览器伪造 `receivablePlanCode/paymentTermId/targetApp` 不进入命令。即时请求与既有有界 drain 共用 operation-code dispatcher；Altoc payment-term endpoint 只接受标准 service-command envelope，并在业务 SQL 前绑定 Aims 来源、capability、path、idempotency、command hash 和冻结合同。回款计划 mutation 与 succeeded receipt 同事务，同键同 hash 只 touch 既有 receipt、异 hash 在 mutation 前 409；Aims 精确 receipt checkpoint，5xx 和 source ack 丢失按原键恢复。Aims 148 项、Altoc 132 项 Node 测试及两模块 lint/typecheck 通过；本链路 Aims/Altoc/Finance/integrationoperation Go 包与 vet 通过，最终根级 release gate 由本批统一收口。本批没有新增或执行 migration/seed，没有 Cloudflare 部署、真实 token、live probe 或租户验收，也未触碰 Insights/Align。

2026-07-10 G3-2 Altoc 开票申请→Finance/Workflow 两级可靠纵切：回款计划入口在锁行、范围授权事务中冻结 `altoc.receivable.finance-invoice-request.v1` operation 与审计事实，Altoc executor 以 `aud=finance`、精确 `finance:invoice-request:create` 和冻结 actor 调 Finance；Finance 在同一 target receipt 事务创建/复用 `invoice_request` 并冻结 `finance.invoice-request.workflow-submit.v1`，只向 Workflow 暴露 allowlist 表单字段。Finance executor 再以 `aud=workflow`、精确 `workflow:invoice-request:create` 和受信 actor delegation 创建 Workflow instance；instance mutation 与 succeeded receipt 同事务，Finance 的 `pending_approval`、外部实例投影、attempt 和 source operation checkpoint 也同事务。浏览器 Authorization/Cookie 不再转发到 Workflow；service UID 与业务 actor 分离，header actor 必须等于冻结 command actor。无稳定回款计划身份的合同级旧入口已明确 410 退役。Finance/Workflow receipt DDL 和 bootstrap schema 已生成并登记 release SHA，但未执行 migration、seed 或 Cloudflare 部署；未触碰 Insights/Align。

2026-07-10 G3-2 Altoc 服务工单→Aims→Altoc 可靠纵切：Altoc 在工单行锁和可信 dispatch context 下，把最小业务 command、dispatch 投影、审计与 caller-owned `altoc.service-ticket.aims-work-item.v1` operation 同事务冻结；固定目标为 Aims receipt-only `/work-item/receive` 和 capability `aims:service-ticket:work-item:create`，原 actor 只作为独立 delegation/audit 证据，不进入业务 hash。Aims 以全局 `source_ticket_code` 防改绑，并把工作项创建/复用、初始结果 operation 与 succeeded receipt 同事务提交；旧 raw `/work-item` 已从 middleware 移除且 runtime 返回 410。Altoc 仅在精确 receipt checkpoint 后绑定项目/工作项；succeeded 重放不回退 pending，永久失败同键返回 409，ACK 丢失保留原 operation。Aims 结果回写改用 kebab-case `altoc:service-ticket:delivery-result:sync` 与单调 `g{generation}` key，同状态校验真实 operation status/hash，Altoc 忽略旧 generation 且禁止 resolved/closed/cancelled 被高 generation 非法重开。Aims 154、Altoc 138 项 Node 测试和 typecheck，以及 Aims/Altoc/integrationoperation/server Go tests 与 vet 通过；Aims v5.4、Altoc 043、两端 bootstrap 和 Console v1.44 grant 已登记 release manifest 且哈希匹配。未执行 DDL/seed、Cloudflare 部署、live probe、真实租户或 secret 操作，未修改 Insights/Align。

2026-07-10 G3-2 本批最终门禁：主线程在子任务合并后修复 Altoc/Finance lint、Aims contribution executor 类型收窄，并把 Workflow 纳入 reviewed release manifest、Cloudflare business-bridges 目标优先顺序和 G2-6 离线发布演练；Aims/People、Assets/Altoc、Finance/Workflow 新增 bootstrap 与增量 migration 的 SHA-256/sequence 均已登记。Node 22.19.0、pnpm 11.10.0、Go 1.26.3 下的 `release:check --allow-dirty` 最终通过：18 个 workspace package、188 个测试文件、独立 Insights 42 项及 data-runtime/notification-runtime 全部 Go suites；仅保留既有 166 条 Insights lint warning。发布合同仍为 draft、工作区仍 dirty、生产 signing key ID 尚未锁定；门禁明确未执行 deployment、migration/seed、live probe、acceptance 或 secret-management 命令，也未修改 Insights/Align 实现。

### G3-4 契约测试

- [x] 正确调用。
- [x] 缺 capability。
- [x] 错 audience。
- [x] 错 source app。
- [x] 错 tenant/deployment。
- [x] Token 过期或撤销。
- [x] 幂等重放。
- [x] 下游超时和临时 5xx。
- [x] 本地成功、下游失败后的重试恢复。

2026-07-10 G3-4 第一批离线契约记录：Terra 复核先识别出静态正则测试假覆盖及 4 个 P0：Console 本地 `credentialId=0` 令牌与 introspection 不兼容、introspection 故障被压成永久 401、data-runtime 可用 `client_id` 绕过 app claim 且不拒绝别名冲突、凭据轮换后可靠投递不会刷新缓存 token。现已修正生产路径：Console 本地签发读取 `console.runtime` 真实 current credential 与 active grants；`/oauth/introspect` 只有明确验证 401 才返回 inactive，数据库/网络/5xx 统一失败关闭为可重试 503；Foundation 目标 401 时淘汰缓存、强制刷新并只重试一次；data-runtime 要求 `token_use=service` 和完整 tenant/deployment/app claim，移除 app 的 `client_id` 回退并拒绝兼容别名冲突。Altoc/Codocs 目标服务 guard 已有直接行为测试，Aims executor 直接覆盖首轮 503、仅重试未完成步骤、receipt 幂等成功与 timeout `partial_unknown`；Foundation 覆盖 HMAC 绑定、60 秒边界、receipt mismatch、401/403/503 分类和缓存 token 单次刷新；Go 覆盖 wrong audience/source/tenant/deployment/capability、receipt 原子幂等与 Aims failure checkpoint。`release:check --allow-dirty` 最终通过 142 个测试文件、全部活跃模块 lint/typecheck/test、Insights 41 项及两个 Go runtime 套件，只保留 166 条既有 Insights warning，且未执行部署、live probe、真实验收或 secret 操作。

该阶段当时暂不关闭“正确调用”和“Token 过期或撤销”：前者仍缺 source operation → Foundation → target BFF → target data-runtime → receipt → source checkpoint 的单条纵向执行测试；后者虽已有过期、inactive、credential/grant 轮换和 401/503 分流的分层行为测试，仍需带真实 Console 签名 JWT、真实 current credential/grant 查询和目标 BFF 的纵向用例。后续关闭证据见下方隔离本地纵向验收记录。部署态 Cloudflare acceptance 继续使用版本化命令，不引入 GitLab Runner。

2026-07-10 G3-4 基础设施记录：已新增临时 MySQL 隔离 harness，默认只 preview，执行必须提供 `--execute --confirm <sha256>`，每次创建全新 datadir/socket/端口，按 Console → Aims → Altoc 顺序各导入一次 schema，完成后反向终止并清理；8 项安全行为测试通过。Aims schema 拓扑已修复并锁定 SHA `4f6ffc372303896bfa08ad63a677b134d5ecd2643d12b6385916384084283db6`，三库空库真实导入已成功。另新增本地进程组 supervisor，覆盖无 shell 启动、loopback readiness、HTTPS CA、进程组反向清理、健康退出和敏感输出脱敏；14 项测试通过。该阶段 supervisor/release gate 只做 fake 行为验证，尚未证明六进程真实 HTTP/HTTPS 链路，因此当时两个未勾选项继续等待真实纵向证据；后续关闭证据见下方隔离本地纵向验收记录。

Supervisor 第二轮安全修复已扩大敏感参数/env 名称识别（含 `api-key`、`access-token`、`client-secret`、`*_KEY`），整行遮蔽 Authorization/Cookie/Basic 等输出，并拒绝 readiness query/hash；14 项测试复跑通过。仍保留 P1：确认摘要未绑定 PATH 实际可执行文件及部分动态库环境、callback 取消为协作式、double-fork 孤儿进程组和真实 HTTPS/CA release gate 尚未覆盖；这些不阻塞当前 fake 安全门禁，但在真实六进程 harness 前必须处理或明确隔离边界。

六进程真实 HTTP harness 骨架当时固定 Aims Runtime → Altoc Runtime → Console → Aims → Altoc → HTTPS Tenant Gateway 顺序，所有数据库、service-client、Gateway token、seed receipt、当前源码 runtime 摘要和 TLS 材料都只能通过固定 `HZY_G3_*`/workspace artifact 合同输入；默认 preview 缺输入时不产生确认摘要、不创建进程。静态契约 4 项与 supervisor 14 项通过。该阶段 preview 仍被 fresh runtime、三库 seed/凭据、Console OIDC/current credential/grant、Aims/Altoc service-client、Gateway internal token 和本地 CA 阻塞，且尚未加入 source operation → target BFF → target runtime → receipt → source checkpoint callback，因此当时不勾选“正确调用”或“Token 过期或撤销”；后续关闭证据见下方隔离本地纵向验收记录。

2026-07-10 G3-4 隔离本地纵向验收记录：新增 `test:g3-service-jwt-vertical`，每次以确认摘要启动全新临时 MySQL datadir 和仅监听随机 loopback 端口的 Aims data-runtime、Altoc data-runtime、Console、Altoc BFF 及最小 Platform profile stub；Console/Platform signing key、license、service client secret 和 runtime token 均为进程内随机临时材料，不写仓库、不打印，结束后反向终止进程并删除 datadir/缓存。成功用例真实执行 source operation claim → Foundation service-command envelope → Console `/oauth/token` current credential/active grant 查询与签名 JWT → Altoc BFF JWKS/introspection、scope/source/tenant 校验 → Altoc data-runtime 工单 mutation + succeeded receipt 同事务 → receipt 精确校验 → 使用同一 dispatcher request ID 和 fencing token 完成 Aims source checkpoint；最终 source=`succeeded`、target generation/status 与 receipt 均匹配。失败用例分别证明 JWT expiry、current credential rotation、grant revoke 返回 401，Console introspection 存储故障在 Console 直测与 Altoc BFF 均保持可重试 503；四种失败均先断言 source 仍 pending/无 checkpoint、target 业务未变化、receipt 为 0。真实执行 32.7 秒通过，默认不开启环境变量时测试只 skip，不启动任何进程。

本轮真实链同时发现并修复两个生产可靠性缺口：data-runtime 三处 MySQL 连接此前未启用 `parseTime`，会导致 `integration_operation.created_at` 从 `[]uint8` 扫描到 `time.Time` 失败；现统一 `ParseTime=true`、UTC，并为主 runtime、Wizbiz 增量迁移和应收差异命令增加无真实连接的 DSN 契约测试。Altoc service guard 此前丢失 `service_token_introspection_unavailable` 分类并把控制面故障压成 401；现仅该明确 reason 返回 503，撤销/无效仍为 401，并有 handler 零调用分层回归。只读同类审计发现 Aims、Assets、Codocs、Finance、People 的模块级 service auth helper 也存在“未认证统一 401、未显式保留 introspection reason”的潜在硬化点；本批不跨模块批量修改，后续应逐模块用真实/分层 503 证据验证后再收口。上述证据仅代表隔离本地 MySQL/loopback 验收，不代表 Cloudflare 部署、真实租户、live probe、生产数据库 migration/seed 或 secret 操作；部署继续通过版本化 Cloudflare 指令推进，不使用 GitLab Runner，且本批未修改 Insights/Align。

2026-07-10 G3-4 最终离线门禁：在上述真实 loopback 纵向验收及生产缺口修复合并后，根级 `release:check --allow-dirty` 再次完整通过，覆盖版本化 Cloudflare 指令与配置守卫、18 个 workspace package 的 lint/typecheck/test、独立 Insights 既有测试以及 data-runtime/notification-runtime 全量 Go suites。发布合同仍为 draft、工作区仍 dirty；命令明确未执行 deployment、migration/seed、R2、live probe、真实租户 acceptance 或 secret-management 操作。

2026-07-10 G3-4 service-auth 故障分类硬化：沿隔离纵向验收发现的共性风险，Aims、Assets、Codocs、Finance、People 五个实际模块级 service auth helper 均显式保留 Foundation 的 `service_token_introspection_unavailable`，在任何目标 handler/runtime mutation 前返回可重试 503；明确 invalid/revoked/expired 身份仍为 401，缺 capability 或错 source app 为 403。18 项直接行为测试覆盖上述矩阵和业务调用零次，没有以静态字符串断言冒充执行覆盖，也没有引入测试专用生产包装层。五模块完整 test、lint、typecheck 与 diff-check 通过；tenant/deployment/audience 仍由 Foundation JWT/OIDC 层及上方真实纵向测试负责，不在模块 helper 中复制。未修改 Insights/Align，未执行部署、migration/seed、live probe、真实租户或 secret 操作。

2026-07-11 G3-4 P1 补充审计：复查 Aims、Assets、Codocs、People 的 service middleware，均已实际调用上述分类 guard；Finance 则发现 `/api/v1/finance/service/**` tenant-runtime 转发器仍手工把未认证状态压为 401，绕过了已有 helper。现已改为复用同一可执行 capability guard，保留既有 `finance:*` / `finance:admin` 兼容语义；新增该转发路径的直接行为矩阵，保证 introspection 不可用为 503、明确 invalid/revoked 为 401、缺 capability 或错 source 为 403，且失败时 handler 调用数为零。未执行部署、migration/seed、live probe、真实租户或 secret 操作。

2026-07-11 G3 P0 诊断与生命周期边界收口：Foundation 将 Aims、Altoc、Assets、Finance、People 的 15 个诊断 list/attempt/replay BFF 统一改为浏览器安全投影；仅返回 operation/目标应用与代码、业务类型/编码、状态、尝试计数、稳定错误码/分类和安全时间字段。attempt 同样不再透出 correlation/idempotency、operation key、command/hash、response、worker/lease/fencing、token、内部 URL 或 raw error；replay 回显仅含 operationId、expectedVersion、reason。Console 的 Platform authorization lifecycle failure 改为 durable actionable outbox 后，补强 lifecycle metrics 在查询前要求 `authorization_lifecycle:view + audit_logs:view`，浏览器 retry body 只接受固定 `phase + uid`，服务端仅从 tenant/deployment/phase/uid 范围内唯一、当前 `dead_letter` source 读取冻结事实，并以 exact CAS 取消旧 pending；重复、跨租户/部署或伪造 operation/command/reason 均无法影响重试。通知详情的 fresh eligibility helper 同时调整为由 `notificationDetails` 以静态 source+descriptor registry 先解析固定最低 `resource:view` target，再交由纯 fail-closed gate 判定；这避免 Node TypeScript 测试解析差异，且不允许浏览器或 source verifier 选择权限。新增投影与生命周期行为测试；Console 251 项测试中 250 通过、1 项临时 MySQL skip，Console lint/typecheck 通过。`validate:p3-p4-release-contract:dev` 与根级 Node 22.19.0 `pnpm release:check --allow-dirty` 均通过（18 个 workspace 包、全量 Go suites）；仅有既有 dirty/draft/生产 signing-key 未锁定警告和 Insights 既有 lint warnings。未执行 Cloudflare 部署、迁移/seed、R2、live probe、真实租户或 secret 操作；G3 总验收仍待实环境和完整诊断时间线证据。

2026-07-11 G3 P2 诊断可观测性补齐：People diagnostics 不再在 source allowlist 过滤后丢弃 cursor。runtime 现在以最多 100 条原始 keyset 页有界过取，收集 `limit+1` 条允许 operation；返回页的最后一条允许记录成为 continuation cursor。这样未获批准 family 即使填满原始页，也不会遗漏后续可见记录；tenant/deployment/source、状态过滤、operation allowlist 和浏览器安全投影保持不变。Console 在 `/admin/logs` 的“授权生命周期”页新增只读的 Console→Platform outbox 列表与 operation attempt 弹窗；两条 API 都在查询前要求当前 `authorization_lifecycle:view + audit_logs:view`，仅查询当前 runtime tenant/deployment 下的 employment-sync/offboarding-revoke 两个 Console source operation code。响应严格白名单为 operation ID、生命周期 code、UID、status、attempt count、稳定 error code/class 和时间；attempt 只含编号、status、稳定 error code 和时间，不包含 command/hash、idempotency/correlation、receipt、lease/fencing、raw error/response、token 或内部 URL。People 过取 SQL mock 回归、Console 静态边界/页面契约测试、Console lint/typecheck/255 tests（254 pass/1 temporary MySQL skip）、People Go package 与根级 Node 22.19.0 `release:check --allow-dirty` 均通过；未执行 migration、Cloudflare 部署、live probe、真实租户或 secret 操作。P2 复选项仍保持未完成：尚缺带授权会话的 1440px/390px 浏览器验收和真实环境操作历史证据，G3 总验收不提前勾选。

2026-07-11 G3-4 local process-group supervisor P1 收口：确认摘要现于 preview 阶段绑定 PATH 解析后的 canonical executable 绝对路径及 SHA-256；执行前重新校验 executable 与 CA 文件，替换后的文件在创建临时 HOME 或启动任何子进程前 fail closed。PATH、`DYLD_LIBRARY_PATH` / `DYLD_FALLBACK_LIBRARY_PATH`、`LD_LIBRARY_PATH`、`LD_PRELOAD`、`LIBRARY_PATH` 与必要 locale 的继承快照均进入 confirmation binding，但 plan 输出只显示环境 key/hash、不打印值。`withLocalProcessGroup` 新增外部 `AbortSignal`，已取消的调用不启动进程，运行中取消与总超时都会 abort callback context 并在 finally 反向 TERM/KILL 本 supervisor 创建的 process groups。20 项 fake-process 测试额外覆盖 PATH 可执行文件和动态库环境变更导致摘要不同、preview 后 binary/CA 替换拒绝、外部取消、以及临时 self-signed loopback HTTPS 仅接受 confirmation-bound CA；该 suite 已在 release gate 中运行。Darwin 无可移植 cgroup/subreaper containment，主动 `setsid`/double-fork 脱离 supervisor process group 的 daemon 不能诚实地由此保证清理，因此真实六进程合同明确要求所有命令保持 foreground；该类 daemon 不得接入 harness，不能以现有普通 child 测试冒充覆盖。未把需要 DB/credential/真实六进程输入的 G3 harness 纳入常规 release gate；静态 contract 与本地 TLS/CA 行为测试可离线验证，真实链仍须受控 preview/确认后另行验收。未执行 deployment、migration/seed、R2、live probe、真实租户、外部网络或 secret 操作。

### G3 总验收

- [ ] 关键跨模块写链路可查询完整操作历史。
- [ ] 失败可安全重放，无重复业务对象。
- [ ] 运维人员无需查数据库即可定位失败阶段。

## 8. G4：统一员工待办与通知入口

### G4-1 收口通知 API

- [x] 盘点 Aims、Altoc、Assets、Workflow 等模块空的 `server/api/notifications.ts`。
- [x] 删除、改为兼容代理或明确停用空实现，不保留假成功主路径。
- [x] 所有业务通知通过 Foundation `publishNotification()` 和 Console notifications API。
- [x] 外部通知通过 notification-runtime，不把 WeCom 等凭证下放业务应用。

2026-07-10 G4-1 第一批阶段记录（当时状态）：已删除 Aims、Altoc、Assets、Workflow、Codocs 的空通知 API、重复通知抽屉及 Aims 静态空通知页；Foundation 统一提供用户通知代理，并要求已验证的 user credential，拒绝 service token、未验证 bearer/cookie 和 `@all`。Foundation 双通道编排已固定为站内 `publishNotification()` 成功后才调用 notification-runtime，站内失败跳过外部，外部失败返回部分成功结果；Workflow 运行时通知已统一走该入口并生成稳定幂等键。生产环境在 notification-runtime URL 缺失时现已 fail-closed 为 503；非生产 legacy WeCom fallback 仍须显式治理。Altoc/Codocs/Insights 仍有历史 `sendNotification` 或 Brevo/WeCom 直连点，notification-runtime 的跨实例外部幂等持久化也尚未完成，因此后两项不提前勾选。Codocs 文档中的疑似 corpsecret 已替换为 vault 占位符；是否曾有效及历史轮换需由凭据负责人核验。

2026-07-10 G4-1/G4-3 第二批阶段记录（当时状态）：Notification Runtime 已新增自有 MySQL delivery ledger、唯一身份、request hash、lease/fencing、succeeded replay、known failed retry 与 `partial_unknown` 隔离；缺 store/schema 启动失败关闭，不提供内存 fallback。JWT 额外绑定 tenant/deployment/source app/client/scope，并在本地验签后调用 Console introspection，inactive→401、控制面不可用→503。Foundation 向 runtime 传递解析后的 `sourceAppCode` 和稳定 key；收件人再次规范化去重并拒绝空/@all。企业微信无供应商幂等，因此 provider 成功到 success checkpoint 的崩溃窗口仍只能进入 `partial_unknown`，不宣称 exactly-once。Altoc 4 类历史通知已统一 builder/双通道入口，扫描 key 对周期和排序稳定，通知失败不反转业务事实；lead/opportunity create/assign 已由 data-runtime 返回同事务 audit ID 派生的 `notification_event_version`，同秒 A→B→A 仍可区分且同一已提交事件重试稳定。Codocs 23 个历史点、Insights/Align 直发及所有人工再次提醒的请求级 key 尚未完成，所以 G4-1 后两项和 G4-3 总体验收继续保持未完成。

2026-07-10 G4-1 最终离线收口：Codocs 所有扫描到的历史 Issue、共享、周报、信息推荐和审阅业务通知均统一进入 Foundation builder/双通道入口，人工再次提醒在授权后强制请求级 `Idempotency-Key`；Workflow 使用已提交 task/action 记录生成稳定事件身份；Altoc 4 类历史业务通知已经迁移。Insights Brevo 仅保留登录验证码邮件，Align/Console WeCom 直连仅用于登录或目录同步，均明确排除在业务通知合同之外。Foundation 已删除 legacy WeCom fallback，外部业务通知只允许 notification-runtime；仓库扫描未发现业务模块直接调用 WeCom message send。Console 的 `console.runtime` 现由幂等 bootstrap 建立 active current credential 与精确 `notification-runtime:send` grant，secret 只进入 `db_encrypted` Vault，不写入 seed、日志或响应。由此关闭 G4-1 两项离线代码验收；真实 Cloudflare 部署与凭据轮换仍属于部署验收，不在本批执行。

### G4-2 聚合审批和业务待办

- [ ] Console 聚合 Workflow 待办、跨模块同步失败、临期事项和高风险告警。
- [x] Foundation 顶栏统一展示未读摘要、列表、已读和归档。
- [ ] 每条待办保存目标应用、稳定业务键和可解析跳转 URL。
- [ ] 权限变化后，通知详情和业务目标页都重新执行服务端授权。
- [x] 统一 `project member/owner + value` 的范围语义；优先在 manifest/authz-core 建模明确的 project-code predicate，禁止用伪造成员关系兼容 Aims 历史列表语义。
- [x] Assets B1：补齐资源资产到期与 IP 权利到期生产者、可靠 checkpoint、直接责任人详情重鉴权和默认关闭的 Cloudflare 定时任务。
- [x] Assets B2：补齐客户交付资产 expiry / warranty / support term；已建立显式运营责任人/部门事实、用户详情页、对象级数据范围和来源详情重鉴权。
- [x] People P1：补齐离职工作交接与资产回收协调生产者、独立权限和来源详情授权；不复制 Console Directory offboarding 事实，也不把协调确认解释为资产已归还。
- [x] Assets P3：基于 Assets 当前占用/借用事实补齐“离职员工仍有未归还资产”生产者；不得由 People `asset_recovery_coordination` 状态替代。
- [x] Finance：补齐已批未开票与到账未核销生产者和来源详情授权。
- [x] Altoc：补齐应收计划临期生产者和来源详情授权。
- [x] P0：修复 Aims/Assets 责任人切换时错误沿用旧 UID `previousObjectVersion`，新 UID 首次投影必须无前驱；补 Directory active/fallback 切换契约测试。
- [x] P0：统一 Altoc 应收通知的 `collection_responsible_uid` 与目标业务页对象范围，避免通知可看但 `/payments/{code}` 被 owner scope 拒绝。
- [x] P1：建立 Workflow `targetAppCode → approved origins/path patterns` 注册表；动态 URL 不匹配时只允许安全 fallback。
- [x] P1：为 Assets `asset_item / ip_asset / offboarding_recovery_case` 目标详情补齐与通知 verifier 一致的对象关系过滤和显式 admin 旁路。
- [x] P1：Finance 改用 exact invoice/receipt code 目标页，并让目标读取范围包含对应直接责任人关系。
- [x] P1：责任人配置或统一授权能力校验目标应用最小 view 权限，补“收件人实际可打开目标页”端到端契约。

2026-07-10 G4-2 Finance exact-target P1：通知跳转已改为 `/finance/invoices/requests/{code}` 与 `/finance/receipts/{code}`，新增两个工作型 Nuxt UI 详情页，并保留独立 `invoices:issue` / `reconciliation:confirm` 按钮门禁。Finance BFF 从 Console scoped grant 解析 `all/relation/none`，浏览器 actor/access 字段先剥离再注入可信上下文；data-runtime 对 invoice request / receipt 列表、详情、开票、到账确认和核销统一重验当前直接责任，责任转移后旧责任人失败关闭，受信 global/admin access 可旁路关系但不替代独立敏感 action。独立复核发现核销锁行查询最初漏取 `reconciliation_responsible_uid`，会让合法 relation 用户恒定 403；现已补列，并用完整 SQLMock 事务测试证明当前责任人成功、转交后的旧责任人在任何 INSERT/UPDATE 前 403 回滚。manifest 只声明既有 `tenant:global` / `subject:self`，未新增 grant、schema、migration 或公共 API。Node 22.19.0 下 Finance 54/54 测试、lint、typecheck，以及 data-runtime Finance 包 `go test` / `go vet` 和三处 diff-check 通过。当前本地没有可用的已认证 Finance + tenant-runtime 会话，因此未伪造登录或财务数据做浏览器验收；未修改 Insights/Align，未执行 Cloudflare 部署、数据库迁移、live probe 或 secret 操作。

2026-07-10 G4-2 Assets exact-target P1：Assets BFF 从 Console normal-merged grant 生成浏览器不可覆盖的 `all/relation/none` 与逐 grant 有界 scope unit；tenant-global、无非全局范围 grant 或同 resource 显式 admin 才能得到 all，其他 unit 保留 grant 内 direct/department/project AND、grant 间 OR，unknown 或无法解析的 scope 失败关闭，不再静默变成 direct relation。department tree 通过 Foundation Directory 展开。data-runtime 对 asset item 列表/详情/PATCH 使用当前 owner/custodian/user、`dept_code`、`project_code` 组合谓词；IP 使用当前 IP owner、关联产品 business/technical owner 与关联产品 `project_code`；offboarding recovery 因无部门/项目字段只接受 active 当前 responsible 的纯 direct unit。责任转移后旧 UID 关系立即失效，独立 owner/部门/项目或 tenant-global/admin grant 仍可按自身分支保留；view/通知关系不产生 edit。责任修改成功响应使用已授权 mutation 的非范围化回读，避免更新已提交后因旧责任人即时失权而误报失败，后续读取仍重新授权。未新增 schema、migration、service grant 或公共 API，未修改 Insights/Align，未执行 Cloudflare 部署或提交。Node 22.19.0 下 Assets 54/54 测试、lint、typecheck，data-runtime Assets 包 `go test` / `go vet` 与相关 diff-check 通过。

2026-07-10 G4-2 subject eligibility P1：Console 新增 service-only purpose registry，要求现代 service JWT 的 `source_app + hzy.appCode + target_app + tenant + deployment` 与可信 runtime binding 完整一致；body 只允许 `subjectUid/purpose`，Directory 必须显式 active，并用 fresh normal-merged policy、禁用 simulation、绕过 30 秒 snapshot cache 判定固定 `resource:view`。响应只含 active/allowed/reason/policyRevision；未知 purpose、字段注入、跨 app/tenant/deployment、system/service principal、策略或目录不可用均失败关闭。Foundation 客户端从自身 runtime config 派生 app/tenant/deployment，并拒绝矛盾响应。Aims、Assets、People、Finance、Altoc 在旧 UID closure 后、publish/ack 前按真实 stream 检查；negative/503 不发布、不 ack。Aims 进一步移除无法证明对象可达的 department-manager fallback，assignee 只有 active project member 或 project leader 才可成为候选，随后仍需 `work_items:view`。Workflow 只从可信 event 与 task/instance ID 派生三种 purpose；单 task 落 task 页，并行 task 和状态事件落实例页，全部去重收件人通过才发布，业务 URL 不参与权限选择。Node 22.19.0 独立复核通过 Console 220/221（1 条条件 MySQL skip）、Foundation 140/140、Workflow 37/37、Aims 144/144、Assets 56/56、People 46/46、Finance 58/58、Altoc 127/127，以及这些模块 lint/typecheck、data-runtime Aims `go test/go vet` 和相关 diff-check；最终根目录 `pnpm release:check --allow-dirty` 亦通过（18 个 workspace package、180 个测试文件、data-runtime 与 notification-runtime Go suites），仅保留既有 166 条 Insights lint warning。secret-free v1.42 seed/verify 已生成但未执行；所有 producer 开关仍默认关闭。未修改 Insights/Align，未执行 Cloudflare 部署、数据库 migration、R2、live probe、真实租户或浏览器验收。

### G4-3 通知可靠性

- [x] 通知发布具备幂等键，重试不产生重复通知。
- [x] 站内通知成功与外部渠道投递状态分离。
- [x] 外部渠道失败不影响业务事务提交。
- [x] 提供失败投递记录和受控重试。

第二批补充证据（当时状态）：`foundation/test/notify.test.ts` 覆盖收件人去重、站内先行、站内失败跳过外部、外部失败保留部分成功、可信来源和稳定 `idempotencyKey` 传递；notification-runtime 的 SQLMock/server/provider 测试覆盖同键成功重放、hash 冲突、processing/unknown 零 provider 调用、fencing、schema readiness 和敏感错误脱敏，schema 已在临时 MySQL 9.5 真实导入。由于 Codocs/Insights/Align 和部分人工提醒仍未全部提供稳定 key，“所有通知重试不重复”继续保持未完成。

2026-07-10 G4 当前批次门禁记录：Notification Runtime installer 已收紧为“先安装 schema artifact 和配置、用待安装新二进制执行 store preflight、通过后才替换现有二进制”；迁移未就绪时保留旧二进制且不启动/重启服务。完整 `release:check --allow-dirty` 通过 Cloudflare 指令门禁、148 个测试文件、全部活跃模块 lint/typecheck/test、Insights 41 项测试及 data-runtime/notification-runtime Go 测试；仅保留 166 条既有 Insights warning。本批未执行 Cloudflare 部署、R2 上传、真实数据库迁移、live probe 或 secret 操作。

2026-07-10 G4-2/G4-3 第三批离线收口：Console 站内通知以 `sourceAppCode + idempotencyKey` 绑定包含排序收件人/渠道、规范化 metadata 及全部通知语义字段的 canonical SHA-256；同 key 同 hash 零写返回原通知，不再解除归档或重置已读，同 key 异 hash 返回 409，并发 duplicate-key race 以 `FOR UPDATE` 回读获胜记录。增量 migration 已在隔离临时 MySQL 9 连续应用两次，并以双连接验证只落一条通知。Notification Runtime 新增精确 `deliveries:read` / `deliveries:reconcile` scope、租户/部署隔离的脱敏失败列表，以及只允许 `partial_unknown → succeeded|failed` 的证据化 CAS；审计 append-only，known failed 或对账为 failed 后只能由原业务携原 key/同 hash 重试，不提供 reset 或无界管理重发。Codocs review detail 已在 BFF 和 data-runtime 双层执行当前用户授权，撤销共享后返回 403；通知读取本身仍未按来源对象重鉴权，因此 G4-2 第四项保持未完成。Aims/Codocs 的额外共享抽屉挂载已删除，Foundation 契约测试要求每个活跃业务布局不再重复挂载；共享抽屉会按 target/source app 解析相对 URL。Console 首页真实待办投影、Workflow 关闭事件、全部 actionable notification 的 target app/URL 强制合同仍待后续 G4-2 批次。

本批最终 `release:check --allow-dirty` 在 Node 22.19.0、pnpm 11.10.0、Go 1.26.3 下通过：覆盖 18 个包的 153 个测试文件、全仓 lint/typecheck/test、Insights 42 项测试及 data-runtime/notification-runtime 全部 Go 测试；仅保留 166 条既有 Insights warning。未执行 Cloudflare 部署、R2 上传、真实生产数据库 migration、live probe 或 secret 管理。

2026-07-10 G4-2 第四批离线推进：Console 已建立独立于通知已读/归档状态的 actionable projection，并提供生命周期写入、用户待办摘要及首页真实待办数量；pending 更新必须携带 hash 绑定的 `metadata.previousObjectVersion`，只有前驱版本匹配时才能推进，终态不可复活，重复版本、缺少或过期前驱、并发 CAS 失败统一拒绝。重复插入竞争会锁定回读获胜记录后执行同一状态机，临时 MySQL 9 并发用例验证通过。Workflow 已把精确 task generation 身份写入任务，并以事务内 durable outbox 覆盖审批、拒绝回退、转交、撤回和重新提交的 resolved/cancelled 生命周期；BFF 先发布前置通知再调用 Console CAS，失败或 ack 丢失保留待重放。Aims 已完成首响、解决和高风险工作项三类临期扫描，使用固定 `asOf`、`due_at + id` 游标及持久化 condition generation；阶段升级走同代 supersession，日期/状态/风险/责任人变化开启新代并关闭旧代，完成、解决、归档或不再高风险会关闭投影，责任链为经办人 → 负责人 → 在职部门经理且禁止 `@all`。Aims 定时任务默认关闭，仅在显式设置 `HZY_AIMS_DUE_NOTIFICATIONS_ENABLED` 后启用，因此本批不代表生产通知已经启用。

本批迁移前置条件已固化但未执行：先应用 `console/docs/notification_idempotency_hash_incremental.sql`（若目标环境尚未应用），再应用 `console/docs/notification_actionable_projection_incremental.sql`、`workflow/docs/migrations/009_actionable_projection_identity.sql` 和 `aims/docs/migration_v5.2_due_notifications.sql`，随后才可按版本化 Cloudflare 指令部署对应服务。发布合同已登记 Aims v5.2 migration SHA-256 `b5aecbdcb14ec8b0b32c3a2faa50a4a37a1fc58c2e470c67b6405821451b7770` 及更新后的 bootstrap SHA-256 `8e9a3c0ff167951ee094e13b01e95cbde7718bfc33f7ade6b157173a6d87e113`。最新 `release:check --allow-dirty` 在 Node 22.19.0、pnpm 11.10.0、Go 1.26.3 下通过，覆盖 18 个包的 156 个测试文件、全仓 lint/typecheck/test 及两个 Go runtime；仍只有 166 条既有 Insights warning。全程未执行 Cloudflare 部署、R2 上传、真实数据库迁移、live probe 或 secret 操作。

G4-2 尚未关闭的 P0 是通知内容最小化与来源对象重鉴权：通知列表/摘要只能返回安全信封，敏感正文、metadata、业务键和跳转地址必须移入详情接口；详情接口按来源应用调用服务端授权验证，权限撤销、来源不可用或验证失败时不得回退陈旧内容。完成该安全边界后，再按 Assets 资源/IP 与交付质保、People 离职交接、Finance 已批未开票与到账未核销、Altoc 应收计划临期的顺序扩展生产者，并继续保持功能开关默认关闭，直至对应迁移和 Cloudflare 部署验收获准。

2026-07-10 G4-2 第五批安全边界：Console 通知列表与 `summary.latest` 已改为最小安全信封，查询和响应均不再包含来源定义的 title/summary/body、action URL、业务类型/ID、raw metadata、bizKey、idempotencyKey 或 createdBy；Foundation 通知抽屉只显示通用标签，用户点击后才通过新增详情代理读取白名单详情。Console 详情接口先以当前 uid + notification id 验证收件事实，再使用 `console.runtime` 的精确 audience/scope 调用 Workflow/Aims 来源授权端点；请求绑定可信 tenant/deployment、服务端生成的 descriptor 和当前用户，只有 `authorized=true` 且 resource/id 精确回显才返回详情。来源明确 401/403/404 映射为 restricted，合同异常、无验证器、超时、429/5xx 和畸形响应映射为 unavailable；全链路不缓存授权结果，也不回退历史正文或跳转地址。发布与详情返回边界同时拒绝 script/data、协议相对、CRLF、反斜杠及含凭据 URL。`console.runtime` bootstrap 已幂等补齐 `workflow:notification-details:authorize` 与 `aims:notification-details:authorize` grant。

Workflow 使用规范化 instance + 完整排序 task set descriptor，来源 runtime 验证 task 均属于同一实例，并仅对当前 pending assignee 或仍具实例详情关系的用户放行。Aims 使用 work-item descriptor 并复用当前 active 项目成员/负责人规则；对于“非项目成员但可能拥有 scoped-admin”的用户，现有服务令牌链路缺少受 capability 约束的 subject-scoped authorization/delegation，故明确返回 503 `scoped_authorization_required`，不近似授权也不伪装为无权。由于该 Aims 能力以及 Assets/People/Finance/Altoc 等后续来源验证器仍未完成，G4-2“权限变化后重新执行服务端授权”继续保持未勾选；下一步应先在 Console 提供绑定 caller、subject、tenant/deployment、目标 app/resource/action/object 和短 TTL 的服务端 subject-scoped authorization 能力，再补齐 Aims scoped-admin 纵向行为测试。

本批未修改 Insights/Align 的实现。最新 `release:check --allow-dirty` 在 Node 22.19.0、pnpm 11.10.0、Go 1.26.3 下通过：18 个包共 160 个测试文件、全仓 lint/typecheck/test、Insights 42 项既有测试以及 data-runtime/notification-runtime 全部 Go 测试通过；仍只有 166 条既有 Insights warning。未执行 Cloudflare 部署、R2 上传、真实数据库迁移、live probe、真实租户验收或 secret 操作。

2026-07-10 G4-2 第六批 Aims scoped-admin 安全收口：安全复核先发现原 Aims BFF 把 `current_user` 放入普通查询参数，但 data-runtime 会清除该字段并回落到 service subject，导致旧 adapter 单测未覆盖真实身份链路；同时发现 Console 通知发布在现代 token 缺少可信 app identity 时可能接受请求体伪造的 `sourceAppCode`。现已改为受限的 Console service → Aims BFF → data-runtime actor delegation：仅精确 Console service identity、`aims:notification-details:authorize` capability、POST 固定路径及一致 tenant/deployment 可生成 HMAC actor header，签名绑定 purpose，过去有效窗 60 秒、未来容差 5 秒；缺失、篡改、错误路径或过期签名在进入 adapter 前失败关闭，授权 POST 只接受 `aims.read`，write-only token 不足。Console 的 publish、actionable lifecycle 和 integration-operation dead-letter 入口均在读取 body 前要求两个现代 app claim 精确一致，并绑定可信 tenant/deployment，缺失或冲突时不得从请求体恢复来源身份。

Aims 非成员详情授权现采用 prepare/finalize 两阶段：prepare 只返回 project code/id、department code、confidentiality、object revision 和 facts hash，不泄露 actor、owner/member 或关系结果；facts hash 绑定 notification ID、subject、tenant、deployment、descriptor 和数据库事实。Console 对固定 `aims/projects/admin` 执行 normal merged 策略，禁用角色/用户模拟、忽略 simulation session、绕过进程快照；managed-cloud 必须先刷新并精确匹配当前 tenant/deployment 的 policy bundle，失败不得使用旧策略。部门树只读取 Console active Directory，L3 部门范围提前拒绝。finalize 重新读取对象与成员/负责人关系，拒绝事实漂移、关系变化、L3 department 和非成员 member/owner basis，并要求 facts hash、object revision、policy revision、非空 policy bundle hash 和排序去重 scope basis 精确回显。跨 notification ID、subject、tenant、deployment 重放均有失败关闭测试。active member/leader 仍由 Aims runtime 直接授权；`project member/owner + value` 的历史语义分歧暂按保守拒绝处理，不伪造成员、不扩大权限。

第六批模块验证：Console 182 项测试中 181 通过、1 项默认 MySQL 跳过，Foundation 133 项、Aims 140 项测试全部通过；三模块 lint/typecheck、data-runtime `go test ./...` / `go vet ./...` 和相关 diff-check 均通过。根级 `release:check --allow-dirty` 随后在 Node 22.19.0、pnpm 11.10.0、Go 1.26.3 下再次通过：18 个包共 160 个测试文件、Insights 42 项既有测试及两个 Go runtime 全部通过，仍只有 166 条既有 Insights warning。Insights/Align 没有实现修改；通用门禁只做既有代码验证。未执行 Cloudflare 部署、R2 上传、真实数据库迁移、live probe、真实租户验收或 secret 操作。G4-2 第四项仍不勾选，因为 Assets/People/Finance/Altoc 等来源详情授权与业务目标页重鉴权尚未全部完成。

2026-07-10 G4-2 project scope P0 收口：Platform `authz-core` 与 Foundation 统一新增显式 `project:code:<code>`，只有该谓词允许仅凭项目编码匹配；`project:member/owner` 始终要求 actor、关系事实和可选 code 同时匹配，缺 actor、缺/空关系、错 code 均失败关闭。未声明 predicate 的 legacy project scope 继续归一化为 member，不静默升级为 code-only。Aims 删除伪成员 sentinel；列表授权把 valued member/owner 冻结为独立可信参数，data-runtime 生成 `(member/owner relation AND project_code)` 同一 SQL 分支，default wildcard 与 assignment value 正确取交集，浏览器同名参数先清除后由 BFF 重建。Assets、Finance 不再把 member/owner value 降格为 project code；Console 通知详情只把显式 code 记为 `project_code`，并以真实空 `projectMemberUids` 表示无成员事实。authz-core 21/21、Foundation 146/146、Aims 163/163、Assets/Finance 定向测试、Console notification security 32/32、data-runtime Aims Go test/vet，以及六个 Node 模块 typecheck/定向 lint/diff-check 均通过。最终 Node 22.19.0 全仓 `release:check --allow-dirty` 进一步通过 18 个 workspace package、201 个测试文件、Insights 42 项既有测试及 data-runtime/notification-runtime 全量 Go suites；仅保留 166 条既有 Insights lint warning。未修改 Insights/Align，未执行部署、migration、真实租户、live probe 或 secret 操作。

2026-07-10 G4-2 第七批 Assets B1：范围按审计结果收敛为资源资产到期和 IP 权利到期，不提前实现客户交付质保。data-runtime 新增 `resource_expiry / ip_expiry` 两条固定 `asOf` 扫描流，按 `(dueAt,id)` 有界分页，阶段固定为 `D30 / D7 / D1 / expired`；`assets_notification_checkpoint` 保存 condition generation、source/event version、previous recipient、稳定幂等键、通知确认和 lifecycle closure CAS，可从“Console 站内已成功但 source ack 丢失”恢复。责任链只使用当前 Assets 数据库可实时复核的直接关系并去重保序：资源 `owner → custodian → user`，IP `owner → 关联产品 technical owner → business owner`；Assets BFF 还要求 Console Directory 用户当前 active，禁止空值、控制字符和 `@all`。无可验证责任人时保持失败关闭并等待后续扫描，不使用部门、租户全局或配置 fallback 近似授权。

详情访问新增 Assets 专用 `asset_item/ip_asset + asset_code/ip_code` descriptor。Console 只为 `assets` 签发 `aud=assets`、`scope=assets:notification-details:authorize`，并要求通知 metadata 中 exact `authorizationDescriptor` 与顶层 `bizType/bizId` 重复事实一致；generic fallback、额外字段、资源或 ID 漂移均拒绝。Assets service endpoint 只接受 Console service identity、精确 capability 和一致 tenant/deployment，再使用 purpose-bound actor 调 data-runtime 的 `assets.read` 路径；runtime 每次按当前 owner/custodian/user 或 IP/product owner 关系重新查询，只有 exact allow tuple 才释放详情。非直连关系统一 `not_authorized`，对象消失为 `not_found`，未知 reason/响应字段或 runtime 不可用均失败关闭；本批不进入 Console scoped challenge。

Assets Nitro drain 使用稳定 actionable identity 和授权 descriptor 发布，先关闭旧 projection 再确认 source closure；功能开关 `HZY_ASSETS_DUE_NOTIFICATIONS_ENABLED` 默认 `false`，关闭时在 runtime binding 与网络调用前返回。Cloudflare cron 只在显式启用且提供 tenant-runtime URL、tenant、deployment 后渲染，并有 100 条页大小、每流 10 页、45 秒墙钟预算；项目继续使用版本化 `pnpm ... deploy:cloudflare` / Wrangler 指令，不引入 GitLab Runner。发布合同已登记 bootstrap SHA-256 `59b2cc033008d01eaf67d29a1817441e2df7ea02d439e697c291c88f73bc3a52` 与可重复增量 SQL `assets/docs/assets_notification_checkpoint_20260710.sql` SHA-256 `041b3e34e10cbe0b6570073a3199a3dfb1411689450dbd7e5a887b28358f15a2`；部署前还需重新应用 repeatable Console v1.37 seed/verify 以补 `console.runtime` 的 Assets grant，但本批均未执行。

第七批验证：Assets 45/45、Console 185 项中 184 通过且 1 项默认 MySQL 跳过；Assets/Console lint/typecheck、data-runtime `go test ./...` / `go vet ./...`、发布合同开发门禁及相关 diff-check 通过。最终根级 `release:check --allow-dirty` 在 Node 22.19.0、pnpm 11.10.0、Go 1.26.3 下通过 18 个包共 162 个测试文件、Insights 42 项既有测试和两个 Go runtime，仅保留 166 条既有 Insights warning。未修改 Insights/Align 实现，未执行 Cloudflare 部署、R2 上传、真实数据库 migration、live probe、真实租户验收或 secret 操作。G4-2 第四项仍不勾选；下一批先完成 Assets B2 的责任事实/详情页前置设计，再按 People → Finance → Altoc 推进。

2026-07-10 G4-2 第八批 Assets B2：客户交付主档新增 Assets 内显式维护的 `responsible_uid / responsible_dept_code`，二者必须成对存在或成对为空，数据库 check 同时拒绝空白、首尾空格和 `@all`。该责任事实不从 Altoc 合同负责人、Aims 项目成员或交付视图负责人隐式推导，避免跨模块陈旧授权；`responsible_uid` 是通知唯一收件事实，`responsible_dept_code` 只参与用户目标页数据范围，不展开为部门广播。data-runtime 的 `customer-delivery-assets` resource 现使用这两个字段执行 owner/department scope，Assets BFF 把 `/api/v1/customer-delivery-assets/**` 精确映射到 `deliveries:view|edit`，新增 `/customer-delivery-assets/{deliveryAssetCode}` 用户详情及责任/期限维护页；每次读取和修改都重新经过 Console 用户认证、业务 permission 与 runtime 数据范围，不使用通知中的陈旧正文或权限快照。

B2 在既有可靠 checkpoint 上新增 `delivery_expiry / delivery_warranty / delivery_support` 三条固定 `asOf` 流，按精确 DATETIME 与 `(dueAt,id)` 有界分页，沿用 `D30 / D7 / D1 / expired`、generation、source/event version、站内通知 ack-loss recovery 和 lifecycle closure CAS。仅 `delivered / online / accepted / suspended` 对象参与；终止、删除、日期移除/推迟或责任清空会关闭旧 projection。通知 descriptor 固定为 `customer_delivery_asset + delivery_asset_code`，Console exact allowlist、Assets BFF validator 和 data-runtime 均已扩展；详情授权每次重读当前 lifecycle 与当前 `responsible_uid`，责任转移后旧收件人不能读取通知详情。功能仍共用默认关闭的 `HZY_ASSETS_DUE_NOTIFICATIONS_ENABLED`，Cloudflare 定时任务仍为单条版本化指令部署路径，不引入 GitLab Runner。

第八批迁移前置已登记但未执行：先确保 `assets_notification_checkpoint_20260710.sql` 已应用，再应用可重复 `assets_customer_delivery_responsibility_20260710.sql`；bootstrap `assets_schema.sql` SHA-256 为 `fbd61f2240b6db1e9d32d68366cc839d17a51acb35f62436693166eb3f668d78`，B2 upgrade SHA-256 为 `101533a2ddf8863f52936dd007ec62fbb2997b15988dd7ef2ccd7bd48a665853`。Assets 46/46、Console 185 项中 184 通过且 1 项默认 MySQL 跳过；Assets/Console lint/typecheck、data-runtime 全量 `go test ./...` / `go vet ./...`、发布合同开发门禁与相关 diff-check 通过。根级 `release:check --allow-dirty` 再次通过 18 个包共 162 个测试文件、Insights 42 项既有测试和两个 Go runtime，仅保留 166 条既有 Insights warning。因本地没有可用的 Assets 登录与 tenant-runtime 会话，本批未伪造数据做视觉验收；页面已通过 Nuxt typecheck、ESLint 和组件合同测试。未修改 Insights/Align 实现，未执行 Cloudflare 部署、R2 上传、真实数据库 migration、live probe、真实租户验收或 secret 操作。G4-2 第四项仍不勾选；下一批按 People → Finance → Altoc 推进。

2026-07-10 G4-2 第九批 People P1：先把离职任务从员工状态和 Console Directory 生命周期中拆出，新增 `people_offboarding_cases / people_offboarding_tasks / people_offboarding_notification_checkpoint`。事项只允许绑定已批准或无需审批的 `change_type=leave` 任职；`handover` 表示工作交接，`asset_recovery_coordination` 只表示协调工作确认，不声明 Assets 设备、账号或席位已经归还。员工 `left/inactive`、Directory 账号停用、session 撤销或 Platform 授权回收成功均不会自动生成任务。创建按 leave assignment 行锁事务幂等，异载荷冲突；任务责任人必须是明确 UID、不得为离职员工或 `@all`。确认和取消分别使用独立 `offboarding_tasks:confirm / cancel`，不由 edit/admin 隐式推导，并以 `expectedVersion=vN` 原子推进 task/case 版本和终态审计；Platform 敏感权限 allowlist 同步显式登记企业角色展开结果。

到期通知使用 `offboarding_handover_due / offboarding_asset_recovery_due` 两条流、固定 `asOf`、`(dueAt,id)` 游标和 `D30 / D7 / D1 / expired` 阶段。checkpoint 保存 generation、source/event version、previous recipient、幂等/actionable identity、站内通知 ack 和 lifecycle closure CAS，可恢复 publish 成功但 source ack 丢失。候选和 closure 都携带精确 `caseCode/taskCode/taskType`；唯一收件人是 runtime 当前 `responsible_uid` 且必须为 active Directory 用户，不使用经理、部门、管理员、配置或 `@all` fallback。通知 descriptor 固定 `{resource:'offboarding_task',id:taskCode}`，Console 仅为 People 使用 `aud=people`、`scope=people:notification-details:authorize` 的 direct verifier；BFF 在读 body 前校验 Console service capability，再用 purpose-bound actor 调 runtime，runtime 只允许当前 active case 的 pending task 直接责任人。用户列表/详情/confirm/cancel 通过已验签的 route-specific runtime token scope，客户端 query 权限标记会被清除。

People 新增离职事项列表、创建和详情页，并明确展示“协调确认不等于资产已归还”；实际未归还资产生产者另列为 Assets P3 未完成项。`HZY_PEOPLE_OFFBOARDING_NOTIFICATIONS_ENABLED` 默认 `false`，关闭时在 binding/token/network 前短路；只有显式启用且 runtime URL、tenant、deployment 和 People service client ID 完整时才渲染 Cloudflare cron。发布合同已登记 bootstrap SHA-256 `c1c398340b0cea5317e5ffc026986b6b3d5b77eee56491a31ec533eb0f13a544`、repeatable migration SHA-256 `38a636cfc0f7f06f3b928773ba5a6a9c2020363e0eaef729afdd4ab1a1f56515` 和 Console v1.38 secret-free seed/verify；这些迁移和 seed 均未执行。

第九批验证：People 42/42，Console 188 项中 187 通过且 1 项默认 MySQL 跳过；People/Console lint/typecheck、Platform 角色拆分 18/18、data-runtime 全量 `go test ./...` / `go vet ./...`、发布合同开发门禁与相关 diff-check 通过。根级 `release:check --allow-dirty` 在 Node 22.19.0、pnpm 11.10.0、Go 1.26.3 下通过 18 个包共 164 个测试文件、Insights 42 项既有测试及两个 Go runtime，只保留 166 条既有 Insights warning。因本地没有可用的 People 登录和 tenant-runtime 会话，本批未伪造用户/数据做 1440px/390px 浏览器验收；页面已通过 Nuxt typecheck、ESLint 和权限/合同测试。未修改 Insights/Align 实现，未执行 Cloudflare 部署、R2 上传、真实数据库 migration、live probe、真实租户验收或 secret 操作。G4-2 第四项继续不勾选；下一生产者优先级为 Finance，再到 Altoc。

2026-07-10 G4-2 第十批 Finance：审计先确认旧 Workflow approved callback 会直接生成 `finance_invoice` 并把申请置为 `issued`，正常主链路因而不存在“已批未开票”。现已把审批与开票拆成两个事实：Workflow 回调只写 `invoice_request.status=approved / approved_at`，正式开票只能由独立 `invoices:issue` 动作完成；应收会计显式获得 issue，审批人和财务经理不因 approve/admin 自动获得，Finance admin 也需显式 grant。generic create 只允许 draft，issue 只允许 approved，浏览器 `issuedBy/updatedBy` 不再被信任；approved 申请另有 `assign-issuance` 行锁动作，可成对设置、转移或清除 `issuance_responsible_uid / issuance_due_at`，同载荷幂等并写审计。到账事项使用 `reconciliation_responsible_uid / reconciliation_due_at`，实际未核销余额由 active `finance_reconciliation` 聚合判定，不信任可编辑余额快照。

两条通知流固定为 `invoice_issuance_due / receipt_reconciliation_due`，使用固定 `asOf`、`(dueAt,id)` 游标、`D30 / D7 / D1 / expired`、condition generation、publish ack 恢复、owner move 和 closure CAS。唯一收件人是当前显式责任人且必须为 active Directory 用户，不使用申请人、到账经办人、经理、部门、管理员、配置或 `@all` fallback。descriptor 分别固定 `{resource:'invoice_request',id:requestCode}` 与 `{resource:'finance_receipt',id:receiptCode}`，与 `bizType/bizId` 精确镜像；Console 使用 `aud=finance`、`scope=finance:notification-details:authorize` 的 direct verifier，runtime 仅在对象仍可办理且 subject 仍为当前直接责任人时放行。目标 URL 使用现有 `/finance/invoices/requests?keyword=` 与 `/finance/receipts?keyword=`，页面会消费 keyword 并重新走普通用户权限与 runtime 读取。

`HZY_FINANCE_DUE_NOTIFICATIONS_ENABLED` 默认关闭并在 binding/token/network 前短路；managed Cloudflare 任务同时要求 runtime URL、tenant、deployment、service client ID 和 secret，static runtime token 被拒绝。cron 仍只通过版本化 Cloudflare 指令渲染，不新增 GitLab Runner。发布合同已登记 Finance bootstrap SHA-256 `6c739976e559e6224e5a3ad41489e56a15a02004fed5b55a6592c932d7ad8753`、repeatable migration `finance/docs/migrations/20260710_finance_due_notifications.sql` SHA-256 `a92eed306c3e6a99d9ba8f8650e93aa054e189f64f71986b5939f661886e4b1c`，以及 secret-free Console v1.39 seed/verify；均未执行。Finance 49/49、Console 190 项中 189 通过且 1 项默认 MySQL 跳过、Platform 敏感角色 18/18、data-runtime 全量 `go test ./...` / `go vet ./...`、Finance/Console lint/typecheck、发布合同开发门禁和相关 diff-check 已通过。根级 `release:check --allow-dirty` 随后在 Node 22.19.0、pnpm 11.10.0、Go 1.26.3 下通过 18 个包共 166 个测试文件、Insights 42 项既有测试及两个 Go runtime，仍只有 166 条既有 Insights warning。因没有有效 Finance 登录与 tenant-runtime 会话，本批未伪造用户/财务数据做 1440px/390px 浏览器验收。未修改 Insights/Align 实现，未执行 Cloudflare 部署、数据库 migration、R2 上传、live probe、真实租户验收或 secret 操作。G4-2 第四项仍不勾选，下一生产者为 Altoc；Assets P3 仍独立保留。

2026-07-10 G4-2 第十一批 Altoc：两路审计先发现旧 `owner_user_id` 会在合同激活、付款条款生成等路径自动复制合同负责人，因此不能作为“显式应收责任人”；现新增独立 `collection_responsible_uid`，历史与自动生成计划保持 NULL，不从计划 owner、合同负责人、客户经理、部门或配置回填。普通 payments 对象范围继续使用既有 owner，不因通知责任改变；列表和详情新增催收责任人展示/维护，`receivable:edit` 才显示并允许修改，未分配时明确提示“不发送通知”。临期事实按 `planned_payment_date` 与实时 `GREATEST(amount - received_amount, 0)` 判定，不信任可能滞后的 `unreceived_amount`；只覆盖 `to_receive / partially_received / overdue`，排除 `pending / to_invoice / received / bad_debt / deleted`，其中待开票交由 Finance 事项处理。

可靠流固定为 `receivable_plan_due`，事件 `altoc.receivable_plan.due`，按 UTC 日历日使用 `D30 / D7 / D1 / expired`（当天和次日为 D1，早于当天才 expired）、固定 `asOf` 与 `(plannedPaymentDate,id)` 游标。checkpoint 保存 generation、source/event version、previous recipient、幂等/actionable identity、站内 ack 与 lifecycle closure CAS；责任/日期变化关闭旧 generation，余额归零或 received 为 resolved，退出行动状态、删除、坏账、日期/责任清空为 cancelled。唯一收件人是当前 `collection_responsible_uid` 且必须为 active Directory 用户，无任何 fallback。descriptor 固定 `{resource:'receivable_plan',id:planCode}` 并与 `bizType/bizId` 精确镜像；Console 以 `aud=altoc`、`scope=altoc:notification-details:authorize` 调 direct verifier，runtime 只在计划仍可催收且 subject 仍为当前直接责任人时放行。旧 `scan-overdue` 继续更新状态与逾期天数，但已删除按 owner 聚合、合同负责人兜底、`receivable_overdue_scan` descriptor 和通知发布副作用，避免与新生产者双投。

2026-07-10 Altoc 应收目标页 P0 收口：`GET /payments` 与 `GET /payments/{exactCode}` 的读取谓词在原计划 owner、合同 owner、合同部门范围上增加当前 `collection_responsible_uid` 精确 OR 分支，通知责任人可直接打开目标页，且普通 owner 存量访问保持不变。更新、确认到账和手工逾期扫描改用独立的原 owner/合同写谓词，责任关系不自动授予写能力；admin/all 旁路保持显式。通知详情 verifier 仍只检查当前直接责任与可催收事实，不接受无关 owner/admin；换责任人后旧 UID 实时拒绝。

`HZY_ALTOC_RECEIVABLE_DUE_NOTIFICATIONS_ENABLED` 默认关闭并在 binding/token/Directory/network 前短路；managed Cloudflare 要求 runtime URL、tenant、deployment、service client ID 与 secret，拒绝 static runtime token，cron 仅由版本化 Cloudflare 配置命令按显式开关渲染，不使用 GitLab Runner。发布合同已登记 Altoc bootstrap SHA-256 `1cea56929417de8b603d3f1f94a1fd83c2d018438f45b2ee7a1754fe06c6751b`、repeatable migration `altoc/docs/migrations/041_receivable_due_notifications.sql` SHA-256 `d8d15d7232915681540d002df2e80bd534343ad23c504d710947ab6121635b8c` 和 secret-free Console v1.40 seed/verify；均未执行。Altoc 121/121、Console 192 项中 191 通过且 1 项默认 MySQL 跳过、data-runtime 全量 `go test ./...` / `go vet ./...`、Altoc/Console lint/typecheck、发布合同开发门禁和相关 diff-check 已通过。根级 `release:check --allow-dirty` 随后再次通过全部 18 个前端包、Insights 42 项既有测试及两个 Go runtime，仍只有 166 条既有 Insights warning。因没有有效 Altoc 登录与 tenant-runtime 会话，本批未伪造合同/应收数据做 1440px/390px 浏览器验收。未修改 Insights/Align 实现，未执行 Cloudflare 部署、数据库 migration、R2 上传、live probe、真实租户验收或 secret 操作。Finance 与 Altoc 来源生产者已完成；G4-2 第四项仍因 Assets P3“离职员工未归还资产”未完成而不勾选。

2026-07-10 G4-2 第十二批 Assets P3：离职事实来源固定为 People 已提交且已生效的生命周期，不扫描 Console Directory `inactive`，因为管理员停用和目录同步同样会产生 inactive。People runtime 以固定 `asOf` 和 `(effectiveDate,employeeId)` 游标遍历：员工当前为 `left/inactive`，或截至查询时点最新一条已生效、`approval_status IN ('none','approved')` 的任职为 `change_type=leave` 时，才创建 caller-owned `integration_operation`；未来日期、draft/pending/rejected/cancelled leave 均排除，历史 leave 已被后续 onboard/transfer 覆盖时不再投影。People scheduled drain 使用 `aud=assets`、精确 `assets:offboarding-recovery:sync`、稳定 `Idempotency-Key` 与标准签名 service-command envelope；只有 Assets mutation 与 succeeded receipt 在同一事务提交且 receipt identity/hash/目标 case 全部匹配后，People 才以 lease/fencing 确认 source operation 成功。固定页预算和 claim 上限避免老记录饿死后续员工；`HZY_PEOPLE_ASSETS_OFFBOARDING_SYNC_ENABLED` 默认关闭并在 runtime binding/token/network 前短路。

Assets 新增 `asset_offboarding_recovery_cases`，只保存可信 People 来源事件、离职 UID/生效时间、Assets 自定回收期限和显式责任；不复制 People `asset_recovery_coordination` 状态或静态资产清单。未归还事实每次只按 canonical `asset_items.user_uid=departed_employee_uid` 重算，不回放历史 assignment；case `status=active` 仅表示离职投影有效，回收结果以 `outstanding_count` 和 checkpoint closure 表达。责任初始 NULL，工作清单仍展示但不发送；只能由 `offboarding_recoveries:edit` 显式分配非离职 active Directory 用户，不使用 owner/custodian/经理/部门/管理员/配置或 `@all` fallback。`offboarding_unrecovered` 复用可靠 scan/ack/closure，排序 holdings 指纹进入 source/event version，部分归还、新增占用、状态或责任变化都会 supersede 旧证据；全部归还关闭 actionable 为 resolved。descriptor 固定 `{resource:'offboarding_recovery_case',id:caseCode}`，详情仅在 case 投影有效、仍有当前占用且 subject 仍是唯一责任人时放行。新增 `/offboarding-recoveries` 工作清单和详情页，列表/详情使用专用 view，责任分配/清除使用专用 edit，服务端权限和 runtime scope 均独立校验；未分配状态、未归还清单和通知关闭语义有明确展示。

第十二批迁移与授权均只登记未执行：People bootstrap SHA-256 `5a150e234ce35338f76de37fa911c44da0f264b816b9ddf2d78610742233c528`、`people_assets_offboarding_projection_20260710.sql` SHA-256 `a8931b991e6ad9c54a59b886c2d10106bcf5371a4bf51b982837627d5a3722fb`；Assets bootstrap SHA-256 `1ed6678e47fde7dd7746e2639b7eed7e0c242f7ff3b305cefcddd6116fb6e8d5`、`assets_offboarding_recovery_20260710.sql` SHA-256 `ec7739bcdc1464c87cb094006fe9c0eb6b042544a23cfc6427e2f5cb04b32c35`；Console v1.41 secret-free seed/verify SHA-256 分别为 `ed701e3e8d701969a1aee9217b0e15d014a85bc14b5cd5990d3ad392aa1ac336` / `2529b57c1ae9e63b039776d27190db51c66dc3bbaa6495383acbe66f4432fb6d`。People 43/43、Assets 48/48、Console 193 项中 192 通过且 1 项默认 MySQL 跳过、Platform 163/163；People/Assets/Console lint/typecheck、data-runtime 全量 `go test ./...` / `go vet ./...`、发布合同开发门禁和相关 diff-check 均通过。根级 `release:check --allow-dirty` 随后通过全部 18 个活跃前端包、Insights 42 项既有测试及两个 Go runtime，仍只有 166 条既有 Insights warning。因 3004 没有可用的已认证 Assets + tenant-runtime 会话，本批未伪造用户/资产做 1440px/390px 浏览器验收。People correction/rehire 到 Assets case cancellation 尚未冻结为独立生命周期 command，作为后续硬化项保留；它不改变本批“已生效离职 + 当前 Assets 占用”生产者的完成状态。未修改 Insights/Align 实现，未执行 Cloudflare 部署、数据库 migration、R2 上传、live probe、真实租户验收或 secret 操作。至此任务清单列出的 Assets/People/Finance/Altoc 临期来源生产者均已完成；G4-2 聚合入口、全量 target URL 合同和 project scope 语义仍按各自未勾选项继续推进。

2026-07-10 G4-2 Console backend P0：Console 新增独立于通知 read/archive 的 pending actionable 安全信封列表，以当前 UID 强制隔离，支持 bounded limit、`(updated_at,id)` opaque cursor 以及 todo kind/category/source 过滤。列表只返回 notification ID、source/target app、分类/严重度和时间等安全信封，不暴露 action URL、biz type/id、business/actionable key 或 raw metadata；后续点击仍必须用 notification ID 走详情重授权。canonical publish 对所有 pending actionable 强制非空、格式合法的 `targetAppCode`，schema 收紧为 NOT NULL；repeatable migration 对历史 NULL pending 先失败关闭为 cancelled，再仅为 terminal 行写入不可路由的 `unavailable` 占位，不猜测目标应用或 URL。本批只完成 backend 合同；统一待办 UI、目标应用可访问性验证、dead-letter actionable producer 和真实迁移/部署验收仍未完成，因此 G4-2 前两个总项继保持未勾选。

2026-07-10 G4-2 第十三批统一待办入口：Console 新增 `/todos`，按审批、临期、风险和跟进筛选 pending actionable 安全信封；点击时才按 notification ID 获取详情并执行来源实时授权，列表不消费 action URL、业务键或 raw metadata。首页“我的待办/轻量事项”卡片现可进入统一页面，摘要加载失败与真实 0 明确区分。Foundation 抽屉和 Console 待办页共用目标 URL 解析：相对路径按 Directory 登记的应用 home URL 拼接，已含应用 base path 时不再跨域重复前缀；绝对 URL 仅允许位于已登记目标应用的 origin/base path 内。Console 本地任职授权生命周期失败详情也已按当前收件事实和最新 `authorization_lifecycle:view + audit_logs:view` 双权限重验，撤权立即拒绝。本批未进行已认证 1440px/390px 浏览器验收，因此 G4 总验收暂不勾选。

同批全量 producer 审计在排除 Insights/Align 后确认 Workflow、Aims、Assets、People、Finance、Altoc 共 18 类 actionable 事件均具备 target app、稳定业务/actionable key、object version、phase supersession、closure/checkpoint 和 exact detail descriptor；同时把 Aims/Assets 收件人切换 CAS、Altoc 催收责任人与目标页 owner scope 两项列为 P0，并把 Workflow 动态 URL 注册、Assets/Finance 目标页对象范围及目标应用最小 view 能力列为 P1。跨模块 dead-letter 尚无与来源成功事实绑定的可靠 closure，不能提前转成可能长期陈旧的 actionable，故 G4-2 聚合总项和“每条待办目标可解析”总项继续保持未完成。Console 204 项中 203 通过、1 项条件 MySQL 跳过；Foundation 137/137，两模块 lint/typecheck、发布 checksum 合同和 `git diff --check` 均通过。根级 `release:check --allow-dirty` 最终通过 18 个活跃包、171 个测试文件、Insights 42 项既有测试和两个 Go runtime，仍只有 166 条既有 Insights warning。未执行 Cloudflare 部署、数据库 migration、R2 上传、live probe、真实租户验收或 secret 操作。

2026-07-10 G4-2 Aims/Assets 收件人切换 CAS P0：修复 Directory active/fallback 改变最终收件 UID、但 runtime 业务候选列表保持不变时的跨用户 predecessor 泄漏。两个 due drain 现先以旧 UID + 旧版本关闭旧 projection，再把新 UID 视为 first publish，不携带旧 UID `previousObjectVersion`；只有最终 UID 未变化时才执行同用户 supersession CAS。行为测试覆盖旧 UID closure、新 UID first publish、同 UID predecessor 和 ack-loss/idempotent replay。未修改 Insights/Align，未部署、未执行迁移或提交。

2026-07-10 G4-2 目标可达性 P1 审计：Aims、Assets、People、Finance、Altoc 的 due/offboarding 责任人当前普遍只验证 Directory active，没有证明候选人持有目标应用最低 view 权限；Aims 还允许非项目成员 assignee 或仅部门经理 fallback，且旧 active 判断会把缺失 status 当成可确认用户。不得因“被设为责任人”自动授予全应用权限，也不得弱化目标页权限。后续统一方案为 purpose-bound Console service eligibility 检查：调用应用只能校验自身固定 resource/action registry，绑定 subject、tenant/deployment、purpose 与 fresh policy，只返回 active/allowed/reason/policyRevision；配置时不合格返回 422，投递前撤权或停用则失败关闭。目标页仍按普通 permission + 当前对象关系重验。该跨模块能力尚未实现，因此“目标应用最小 view 能力”任务继续未勾选。

2026-07-10 G4-2 Workflow URL 绑定 P1：Foundation 新增共享纯解析器，以签名 policy bundle 的 active `applications[].homeUrl` 作为规范输出，`basePath` 仅作为兼容输入别名；拒绝跨 origin、错应用路径、协议相对、危险协议、userinfo、反斜杠、控制字符、编码斜杠和目录逃逸。Workflow BFF 在统一通知入口前生成 canonical absolute URL，不匹配时改用 Workflow task/instance fallback，保留业务 `targetAppCode` 并只把 `actionTargetAppCode` 设为 workflow；可信目录不可用时保留 outbox/lifecycle 待重试。Console 对 Workflow publish 在入库和幂等 hash 前用本地已验签目录二次校验，目录不可用稳定返回 503，其他 publisher 不加载目录。应用 URL 消费统一改为 record `homeUrl` 优先、deployment public URL 仅回退；企业微信和站内通知复用同一 canonical URL。本地 Node 22.19.0 复核通过 Foundation 139/139、Workflow 31/31、Console 209 通过/1 条件跳过，三模块 lint/typecheck 均通过；无 schema/manifest/grant/migration 变化，未执行部署或真实环境操作，未处理 Insights/Align。

2026-07-11 G4-2 跨模块 dead-letter actionable P0：Aims/Altoc source runtime 现以独立 generation 记录冻结 dead-letter 的安全投影，并提供 pending publish、publish CAS、pending closure 与 closure CAS 四个对称接口。Console 发布成功后由 Foundation 回写实际 `notificationId + recipientUids`；ack 丢失会以同一冻结身份重试。Replay 与 source 成功分别在原事务产生 `cancelled` / `resolved` closure，旧 closure 未被 Console 确认前禁止同一 operation 的新 generation 发布，避免复活已关闭待办。Console 仅在四项冻结身份全量存在时创建 actionable，legacy 全缺仍是普通通知、部分存在失败关闭；浏览器跳转严格绑定签名 application catalog 的 Aims/Altoc 诊断页。Console 在调用 source verifier 前以 active Directory 与 fresh normal-merged `integration_operations:view` 重验当前用户，撤权/停用不调用 source；source 继续精确核验 tenant/deployment/source、current generation、notification ID、recipient 和关闭状态。请求、扫描 DTO 和 metadata 都不允许 operation key、idempotency key、command/hash、raw error/response、token 或内部 URL；Foundation 对 legacy runtime 的额外字段也显式剥离后才转发。data-runtime Aims/Altoc/integrationoperation 定向 `go test`/`go vet`、Foundation 与 Console 定向测试、两模块 lint/typecheck 通过；根级 Node 22.19.0 `pnpm release:check --allow-dirty` 通过。未执行 schema migration、Cloudflare 部署、R2、live probe、真实租户写入或 secret 操作。该批仅关闭 Aims/Altoc dead-letter 缺口，不据此勾选覆盖所有生产者与实环境验收的 G4 总项。

2026-07-11 G4-2 dead-letter source 扩展（Finance / Assets）：Finance 核销→Altoc 摘要与 Assets 交付资产状态→Altoc 两类既有 caller-owned `integration_operation` 已接入同一 source-owned dead-letter lifecycle：安全 candidate 扫描、publish/closure CAS、ack-loss 重放、replay=`cancelled` 与成功=`resolved` transaction closure、当前 notification/recipient/generation/tenant/deployment/source 详情验证。两模块各自新增 tenant-global `integration_operations:view/replay`、最小诊断列表/attempt/replay BFF 和 `/integration-operations` 页面；URL 由 Console 已验签 app catalog 的 home URL 绑定，详情在 source 前 fresh 重验 Directory active 与 `integration_operations:view`。Foundation source allowlist 与 Console contract 只显式扩展 Finance/Assets；`operationKey`、command/hash、raw error/response、token、内部 URL 仍不跨 dead-letter 边界。Finance/Assets 的 repeatable migration、bootstrap schema、release SHA 已登记；新增 v1.46 Console seed/verify 仅给其 runtime client `notifications:publish`，不授予浏览器 role/scope，尚未执行。Finance 71/71、Assets 64/64、Foundation/Console 定向 46 项、Foundation/Console lint/typecheck、data-runtime 全量 `go test ./...`/`go vet ./...`、release-contract dev 与根级 Node 22.19.0 `release:check --allow-dirty` 通过。两模块尝试本地 1440px/390px 浏览器核验，但浏览器网络无法连接隔离的本地 dev process，已停止服务，不伪称视觉验收完成。People source、全部 pending URL 的发布时 catalog 绑定以及所有来源详情的 fresh eligibility 尚未完成，G4 总项继续不勾选；未部署、未执行 migration/seed、R2、live probe、真实租户或 secret 操作。

2026-07-11 G4-2 dead-letter source 扩展（People）：People 仅将三条已冻结的 caller-owned operation 纳入待办：Directory→Console `people.directory.employment-sync.v1` / `people.directory.offboarding-disable.v1`，以及 People→Assets `people.offboarding.assets-recovery-sync.v1`。candidate、closure、publish/ack、replay 与详情 verifier 均在 source runtime 按 operation code、target、capability 和 tenant/deployment/source 精确 allowlist，未来 operation family 不会自动进入该通知或重放边界。该 source 同样提供 generation/CAS、ack-loss、success/replay closure、最小 tenant-global diagnostics/attempt/replay BFF 与 `/people/integration-operations` 页面；Console 先 fresh 重验 active Directory + `people:integration_operations:view`，再调 source verifier。新增 People schema/migration/release hash 与 v1.47 service-only `notifications:publish` seed/verify（未执行，不授予浏览器权限）。People 61/61、Go People package、Foundation/Console 定向 46 项、Foundation/Console lint/typecheck、release-contract dev 与根级 Node 22.19.0 `release:check --allow-dirty` 均通过。浏览器因认证跳转所需本地 Console 未运行而止于连接拒绝，未伪称 1440px/390px 已验收；未部署、未执行 migration/seed、R2、live probe、真实租户或 secret 操作。跨模块 failure source 已覆盖当前五个 caller-owned producer；但全部 pending URL 的发布时 catalog 绑定、普通来源详情的 fresh eligibility 及真实部署验收仍未完成，G4 总项继续不勾选。

2026-07-11 G4-2 横向安全收口：Console 对所有 `metadata.actionableState='pending'` 发布在 canonical request hash/写入前统一执行已验签 application catalog URL binding；target alias 缺失、冲突、未知或 URL 不在登记 origin/base path 内返回 400，catalog 不可用返回 503。Console 写入自身 `actionTargetCatalogBinding='catalog-v1'`，projection 再次要求该标记及 target alias 一致；普通通知和已终态 lifecycle 不触发 catalog。`notification_actionable_catalog_binding_20260711.sql` 只会把历史缺少 catalog-v1 证据的 pending projection 安全关闭，绝不猜测 source/URL/target 或改写 immutable notification/recipient，尚未执行。通知详情同时建立 Console-owned static `source + descriptor resource → resource:view` registry：Workflow、Aims、Assets、People、Finance、Altoc 的 16 个已持久化 descriptor 在调用来源 verifier 前均做 active Directory + fresh normal-merged policy（禁用 simulation/privileged、绕过 snapshot cache）；撤权/停用为 restricted，Directory/Policy/bundle 故障为 unavailable，三者均 source calls=0。Console lifecycle 的 `people_lifecycle_authorization` 保留既有 `authorization_lifecycle:view + audit_logs:view` 双权限路径。Console 249 tests 中 248 通过、1 条环境 MySQL skip，lint/typecheck 通过。

2026-07-11 G4-2 补 People 实际 dead-letter drain 与 Console lifecycle 高风险 actionable：People 新增独立 `integrations:dead-letter-notifications` scheduled task，默认关闭、每 15 分钟、每轮最多 1 个 generation；仅调用 People source 的 publish/closure drain，失败只保留 pending，不触发 Directory/Assets 业务 claim、receipt 或 family 执行路径。Console Platform authorization lifecycle failure 现使用自有 durable outbox，按 operation+generation 冻结 stable actionable/object version、显式 recipients、notification checkpoint 与 closure ACK；dead-letter 发布 pending，成功 resolved，受控 retry cancelled，均使用 exact CAS。目标固定为签名 Console catalog URL，descriptor 保持 `people_lifecycle_authorization`，详情仍按双权限实时重验；command/hash/raw error/token/internal URL 不进入待办。新增 Console schema/migration/release hash，均未执行。People 63/63、Console 249（248 pass/1 skip）、Console/People lint/typecheck、release-contract dev 和根级 Node 22.19.0 `release:check --allow-dirty` 通过；仅保留既有 dirty/draft/signing-key warnings。G4 总项仍不勾选：历史 pending/lifecycle 表需经批准 migration 执行，且尚无覆盖全部来源的“撤权后目标页/API 403”真实会话 E2E 证据；未部署、未迁移/seed、R2、live probe、真实租户或 secret 操作。

### G4 总验收

- [ ] 员工可从 Console 查看并进入核心审批/业务待办。
- [ ] 关键跨模块失败能通知责任人并定位到操作记录。
- [x] 业务模块不再维护重复通知中心。

## 9. G5：经营指标快照与驾驶舱

启动门禁：G2 全部通过，G3 关键链路已经有持久化操作记录。

### G5-1 指标口径冻结

- [ ] 合同到项目启动周期。
- [ ] 验收到开票耗时。
- [ ] 开票、到账、核销和 DSO。
- [ ] 项目收入、资产成本、人力成本、总成本、毛利和毛利率。
- [ ] SLA 首响/解决达成率、工单重开率和续约风险。
- [ ] 每个指标明确事实源、稳定业务键、时间口径、过滤条件和重算规则。

### G5-2 指标快照层

- [ ] 设计跨模块事件/快照模型，不直接跨库查询业务表。
- [ ] 支持按客户、合同、项目、产品、部门、人员和期间聚合。
- [ ] 支持基于稳定业务键重算和修复历史快照。
- [ ] 保存来源对象、来源版本、计算时间和计算规则版本。

### G5-3 驾驶舱 MVP

- [ ] Console 员工/管理驾驶舱与 Platform 租户治理驾驶舱分开。
- [ ] 首版只展示已冻结的少量指标，不新增大而全报表中心。
- [ ] 指标卡可下钻到来源业务对象和 Codocs 文档。
- [ ] 未就绪或数据不完整时明确提示，不用 0 掩盖缺失事实。

### G5-4 AI 试点

- [ ] 只选择一个有明确行动闭环的场景，例如回款风险或 SLA 风险。
- [ ] AI 输入只使用指标快照、业务对象摘要和有权限的 Codocs 文档。
- [ ] 输出展示事实来源、时间和置信/限制说明。
- [ ] AI 建议不得直接执行高风险业务动作。

### G5 总验收

- [ ] 指标不依赖跨业务库 JOIN。
- [ ] 指标可追溯、可重算、可解释。
- [ ] AI 建议可追溯到明确事实并经过权限过滤。

## 10. G6：架构债与文档治理

### G6-1 文档状态同步

- [x] 更新 `Tenant-Runtime-Migration-Boundary-Status.md`；当前 Codocs 代码已无 `server/utils/db.ts`，旧“仍有 7 个本地 DB utils”描述已重新核对。
- [x] 更新 Integrated Operations Roadmap 中已完成、待硬化和真实验收状态。
- [x] 区分“代码已实现”“自动化测试通过”“真实租户验收通过”“生产发布完成”四种状态。
- [ ] 为每个长期计划文档增加最后核对日期和当前事实源链接。

2026-07-11 G6-1 文档事实同步：复核 Codocs 当前 `server/` 已无 `utils/db.ts`、MySQL 或 Hyperdrive Nuxt server 主路径，原“7 个本地 DB utils”描述已从 Tenant-Runtime 边界文档移除；文档改为“代码边界已收口，migration/Cloudflare/真实会话验收待执行”，不将静态搜索结果表述为已上线。Integrated Operations Roadmap 现引入四层状态口径，并把最新 Checklist、P3/P4 验收清单和跨模块契约列为当前事实源：离线代码/自动化门禁均已有证据，真实租户验收和生产发布仍明确未完成。`git diff --check` 通过；未改 Insights/Align，未执行 migration、部署、live probe、真实租户或 secret 操作。长期计划文档的逐份日期/事实源补齐仍未完成，保留未勾选。

2026-07-11 G6-1 第二批计划文档口径：当前执行清单、P3/P4 发布清单、路线图、Tenant-Runtime 边界、Work Calendar、People、Phase4，以及 Codocs Cloudflare、统一域名、Platform/Console prod-dev 隔离、环境变量收敛等仍会影响执行或安全决策的计划，均已补充最后核对日期、当前事实源和外部变更授权边界。ADR、API/schema 契约及已明确为历史实施记录的文档不机械写入实时进度，避免混淆稳定参考与当前排期。仍有早期专项设计文档需要在未来专项启动时统一添加“历史/目标设计参考”横幅；因此“每个长期计划文档”总项继续未勾选。第二批仅修改文档并通过 `git diff --check`，未执行 migration、Cloudflare 部署、live probe、真实租户或 secret 操作。

2026-07-11 G6-1 第三批长期计划横幅：`console/docs/Console-Unified-Employee-Portal-Plan.md`、`altoc/docs/altoc_codex_implementation_plan.md` 已标为“专项设计与实施参考”，补入最后核对日期、当前事实源和真实外部动作须单独授权的边界；另 12 份已不作为当前排期或发布资格来源的 Aims/Codocs/Foundation/Platform 早期计划标为“历史/目标设计参考”，统一指向当前执行清单、运营路线图和跨模块契约，正文保持不改。14 份文档各仅新增一个横幅，`git diff --check` 通过。ACL、认证、目录、Vault、Workflow 与部署安全相关计划仍待逐份事实核对，因此“每个长期计划文档”总项继续未勾选；未执行任何外部操作。

2026-07-11 G6-1 Console Auth/IdP 事实核对与 P1 收口：`console/docs/Console-Auth-Runtime-IdP-Implementation-Plan.md` 已从 2026-04 的 Draft/历史进度更新为当前目标设计跟踪，明确当前事实源以及代码/离线验证不等同于外部验收的边界。审计确认 Console OIDC RP redirect 仍采用 client exact match，但 Console CAS/WeCom 上游 callback 曾把任意 `http(s)` return URL 当作合法值；现仅允许安全相对路径，协议相对、外部 origin、userinfo、控制字符、反斜杠和多层编码的路径逃逸均安全回落 `/`。Codocs 已有 Console OIDC 主路径，但旧 WeCom callback 曾在默认模式写 legacy cookie；现只有显式 `HZY_AUTH_MODE=legacy` 或 `HZY_LEGACY_AUTH_BRIDGE=true` 才可进入，默认在读取 code、调用 WeCom 或写 cookie 前 410。OIDC protocol execution tests、key rotation、session UI、全部 legacy 入口退场、migration/Cloudflare/真实多用户验收仍未完成；未执行真实 OAuth/WeCom、secret、migration、部署或 live probe。

2026-07-11 G6-1 Console Directory Runtime 事实核对与 P1 收口：`console/docs/Console-Directory-Runtime-Integration-Plan.md` 已改为目标/待实施设计，补充当前事实源、当前启动时 `POST /api/v1/runtime/subjects/sync` MVP 与未落地 pull/push worker 的边界，并标记未实现的 `directory.mode`、真实 Account 导入/对账/停机验收及 legacy Account 配置退场条件。审计发现旧 `/api/v1/directory/**` 兼容读路由未执行权限检查，且 Foundation 会在受保护 Console Directory 路由返回 `401/403` 后降级调用它们，可能泄露目录 PII；现兼容路由与正式路由同样要求对应 `directory_*:view` 权限，Foundation 拒绝后不再降级。跨应用无人值守读取尚未具备已实现的 service-token/capability 合同，Basic client secret 不能作为运行时授权；这部分及真实迁移/部署验收仍待后续专项。已新增静态授权回归测试并执行 Console/Foundation lint 与相关测试；未执行 migration、OAuth、secret、Cloudflare 部署或真实租户操作。

2026-07-11 G6-1 Account Directory Refactor 事实核对：经 Luna 只读审计，`Account-Directory-Runtime-Refactor-Plan.md` 仍把 2026-04 的 Account fallback、mirror/shadow compare 设想写成当前迁移主路径，可能诱导恢复授权拒绝后的弱路由读取。现已标为历史/目标迁移参考，补充最后核对日期、当前事实源和外部操作授权边界；明确新 Foundation directory adapter 只调用 Console、`401/403`/配置失败 fail-fast、Basic 不是跨应用目录授权合同，Account 只服务未迁移 legacy 调用而非新 adapter fallback。原 Phase 3/4 改为未完成目标：当前仅有启动时 `POST /api/v1/runtime/subjects/sync` 最小 subject sync，不等于 Account pull/push worker、真实导入/对账、切流或停机验收。仅更新文档并通过 diff-check；未触及 Account 代码、迁移、真实目录数据或部署。本项减少了一个长期计划遗漏，但“每个长期计划文档”总项仍需逐份核对，继续不勾选。

2026-07-11 G6-1 Console Vault 事实核对与 P1 收口：`console/docs/Console-Vault-Credential-Management-Plan.md` 已标为历史/目标设计参考，明确新业务主路径不再使用 app 级 `license.lic` bootstrap。审计发现 Vault resolve 曾接受 service caller 自报的 `secretRef/version/purpose`，仅依赖泛化 `credential_vault:resolve`，可形成跨集成 confused-deputy；现在 endpoint 仅接收 `integrationCode`，服务端同时核验当前 service client/source app、`scope_json.integrationCodes`、active integration→credential→固定 version，以及 `usage_type/owner_type/owner_key` 绑定，并将审计 purpose 固定由服务端派生。服务身份的 integration 配置列表/详情同步按同一 allowlist 过滤，Foundation 不再从可见 secretRef 回传 resolve 请求。新增 Console/Foundation 契约测试并运行 lint/typecheck；真实 seed/migration 覆盖、轮换、secret、部署和租户验收仍未执行。

2026-07-11 G6-1 Workflow 审计首项 P1（callback）收口：Workflow runtime 终态回调不再信任实例中调用方可写的 `callback_url` origin、查询或路径。仅 Codocs、Finance、People 三个已存在的 Service API 回调路径可生成 effect；未知 app、错误路径、userinfo、query 或 fragment 均失败关闭。Workflow BFF 以 effect 的 app code 通过 Foundation `resolveServiceAppBaseUrl()` 取得受信服务 origin 后再组合相对路径并发送 service token，避免任意出站 URL/令牌泄露。新增 Go/Node 契约测试，Workflow lint/typecheck、Workflow data-runtime Go package 与 diff-check 通过；尚未部署、执行真实回调、migration、secret 或租户操作。通用 runtime actor 注入与 by-biz 查询授权仍为后续 P1。

2026-07-11 G6-1 Workflow 审计第二项 P1（签名 actor）收口：data-runtime 的通用 `/v1/workflow/**` 分支现复用其它应用的 runtime query/body 净化与可信上下文注入，浏览器/调用方的 `current_user`、operator、scope、tenant/deployment 等字段会被剥离并由已验证 runtime/签名 actor 重建。实例、任务、动作和管理等用户关系路径必须携带有效签名 actor，缺失时返回 `trusted_workflow_actor_required`；内部 actionable outbox 与已单独校验 `service-command` purpose 的 Finance 专用入口不受此用户会话要求影响。新增 server 路径覆盖测试，Workflow data-runtime server/workflow Go 测试与 diff-check 通过；`by-biz` / history 的调用应用与参与关系收口仍待处理，未执行部署、迁移、真实 token 或租户操作。

2026-07-11 G6-1 Workflow 审计第三项 P1（业务键读取）收口：`instances/by-biz` 与 `by-biz-history` 现要求 `hzy_runtime_actor_delegated=1` 的可信 actor，且 SQL 只允许 instance initiator、任一当前/历史 `flow_tasks.assignee_uid` 参与者或 `flow_actions.actor_uid` 动作执行人读取；不再仅凭 app/resource/biz/action 键返回实例表单、审批人、意见或历史。无可见实例统一返回空集合/空结果，避免泄露未经授权的审批存在性与明细。新增 Workflow Go 契约测试，Workflow data-runtime server/workflow Go 测试和 diff-check 通过。调用方业务 app 绑定仍需在 Foundation Workflow proxy 以可信 app context 完成专项设计，未执行部署、迁移、真实 token 或租户操作。

2026-07-11 G6-1 Workflow proxy source/actor 绑定 P1：专项审计确认 Foundation proxy 虽会写 `request_app_code`，Workflow 先前并未将它同 Console service token 的 `hzy.appCode` 绑定；`workflow:invoice-request:create` 还会被误当作一般浏览器 actor proxy scope。更关键的是，Workflow BFF 从受验证 proxy 取得 actor 后调用自身 tenant-runtime 时不会重签该 actor，导致 runtime 的关系读取无法证明跨跳 actor 连续性；`/v1/workflow/instances/prepare|instances` 还在通用用户路径之外直接消费请求 body 的 `current_user`。现 Foundation 仅在 target=Workflow、精确 `workflow:proxy`、服务 token source app 与 `x-hzy-request-app-code` 一致、tenant/deployment 精确相等时，才把 proxy actor 用 Workflow runtime token 重签；Workflow 缺 app identity、错 source/scope 或 actor 立即失败关闭，Finance receipt-only `workflow:invoice-request:create` 保持独立 service-command 路径。data-runtime prepare/create 现也只接受 HMAC delegated user actor 并覆盖 body 身份，拒绝 service-command/notification purpose。新增 Foundation 实际 HTTP/HMAC 正反例、Workflow source-bound 静态契约及 data-runtime route guard 测试；未执行部署、迁移、真实 token、租户或外部调用。

2026-07-11 G6-1 Console Bootstrap/Rotation 审计 P1 收口：legacy `/api/v1/console/bootstrap/token` 的 `consumeBootstrapAccessKey()` 曾在 `accessKey` 为空时跳过 Vault 比对，仍能按 app/deployment 查 service client 并签发 token；现空值会在 Vault/DB 查询前返回 `401 invalid_bootstrap`，非空 key 必须精确匹配 `bootstrap.{deployment}.access_key`。`console/docs/Console-Bootstrap-and-Rotation-Sequence-v1.md` 已标为历史/目标设计参考，明确新业务不再使用 app-level bootstrap 主路径。新增 Console 回归测试，lint/typecheck 与 diff-check 通过；未执行真实 rotation、secret、migration、部署或租户操作。

2026-07-11 G6-1 Platform/Console 部署隔离只读审计：未发现可由当前代码充分证实的 P1。managed-cloud 仅在 `x-hzy-gateway=tenant-gateway` 且 gateway token 常量时间匹配时信任 tenant/environment/deployment；缓存 scope 固定绑定 environment+tenant，缺 scope 拒绝 DB cache；Cloudflare 配置生成/验证拒绝 file cache、legacy fallback、无 token gateway trust、单租户 runtime/license token 以及 OIDC key 自动生成/轮换。Tenant Gateway 会先剥离外来内部头，再按已解析 tenant 重建。后续可考虑将目前兼容共用的 `HZY_CLOUDFLARE_INTERNAL_TOKEN` 拆成 Platform internal 与 Gateway proof 两枚 audience 绑定 secret，但暂无低权限绕过证据；未执行部署、secret 或真实环境操作。

2026-07-11 G6-1 Codocs Cloudflare 迁移计划事实核对：Luna 审计确认 `codocs/docs/Codocs-Cloudflare-Migration-Plan.md` 仍把业务 Worker→Hyperdrive→`hzy_codocs` 写作当前目标，与 Codocs 固定 `managed-cloud-agent`、禁止 `DB_*`/Hyperdrive/直连 MySQL 的生成器和部署契约冲突。现已标为历史/目标设计参考并将运行图、依赖表、C0/C2/C3/C5、MySQL、风险和验收改为 Worker→Console OIDC→Tenant Gateway 注入的 tenant-runtime/data-runtime Agent→客户库；C3 的已部署/健康/认证握手断言降为仓库代码与路由配置事实，真实状态仅可经获批 live acceptance 证明。所有 curl、双浏览器、Worker tail、Agent enrollment、schema/health 和迁移动作均明确需要目标环境/租户/执行授权；未执行部署、live probe、Cloudflare 资源创建、Vault/secret、迁移或真实租户操作。`git diff --check` 通过；长期计划总项仍需逐份核对，继续不勾选。

### G6-2 大型文件专项拆分

- [ ] Platform 权限管理页面先补行为测试，再拆权限目录、人员授权、冲突解释等子域。
- [ ] Altoc 合同详情先补端到端行为测试，再拆履约、发票、回款、资产和服务运营页签。
- [ ] Aims 项目工作项/需求页面按查询、命令、视图组件和领域 composable 拆分。
- [ ] Codocs Milkdown 编辑器按表格、批注、协作、工具栏和持久化边界拆分。
- [ ] data-runtime 的超大 adapter 文件按业务 command/query 拆分，保持事务边界清晰。

约束：不得为了减少行数引入无业务边界的通用抽象。

2026-07-11 G6-2 拆分前审计与 Altoc P0：只读审计确认 Platform `AuthorizationsManager.vue`、Altoc 合同详情和 Codocs Milkdown 编辑器均需先补行为证据，不能仅按行数移动代码。Altoc 审计同时发现合同详情仍暴露“申请发票”并调用已明确为 410 tombstone 的合同级旧路由；现已删除该 CTA、弹窗、状态和页面调用，保留每条回款计划的可靠开票入口，新增页面契约防止旧路径回归。Altoc 全量 Node 测试 145/145、lint、typecheck 与 diff-check 通过；页面既有确认弹窗改动未回退。该 P0 不替代合同详情的浏览器行为基线，也未开始组件拆分。Platform 应先补人员分配/冲突/诊断的 handler 与 UI 行为测试；Codocs 优先抽离工具栏交互，表格、Yjs 协作和持久化仍待专门测试。未执行 migration、Cloudflare 部署、live probe、真实租户或 secret 操作，未修改 Insights/Align。

2026-07-11 G6-2 Codocs 首个安全拆分单元：`MilkdownEditor.client.vue` 的 AI 菜单和云剪贴板交互已提取到纯注入式 `useEditorToolbarActions`。composable 只接收当前 selection、parser/serializer、clipboard adapter、toast 与 markdown replace callback；Crepe 创建、表格命令/元数据、批注、Yjs collaboration 和持久化仍由主编辑器保留。新增行为测试覆盖空选区不打开 AI、关闭后清除 stale range/text、替换始终使用菜单打开时冻结的精确 range、空选区/未登录不读写云剪贴板，以及粘贴只替换当前选区。Codocs 全量 Node 测试 80/80、lint、typecheck 和 diff-check 通过；未调整依赖、未触碰现有 EditorShare/sidebar 脏改动，也未完成 1440px/390px 的已认证浏览器验收。G6-2 总项仍未勾选，后续先补表格、批注、协作和持久化各自的行为基线，再按领域拆分。

2026-07-11 G6-2 Codocs 表格数据保真 P1：Terra 审计发现 merged table 的 `colwidth` 曾按首行物理 cell 数采集、但在完整 Markdown 序列化后按逻辑列数恢复；`colspan` 会使显式列宽与对齐元数据长度错位，进而退化为 dash fallback，造成用户自定义比例/对齐漂移。现将布局采集、Markdown 分隔行编码、恢复和容器重标尺全部改为以 `TableMap.width` 的逻辑列为唯一计数，并按 merged cell 的 `colwidth[]` 展开/写回；保留合并前多内容 cell 的 fail-closed 检查、焦点定位、codec metadata 和协作/持久化边界。新增真实 ProseMirror 表格回归测试，覆盖 2 列 merged cell `[200,600]` 的逻辑元数据、显式恢复和 `addToHistory=false`，以及损坏 metadata 仅清注释不改正文。Codocs 全量 97 项测试、lint、typecheck 和 diff-check 通过；未执行浏览器、协作服务、真实文档、迁移或部署。表格悬浮控制条拆分已具备审计边界，待在本 P1 证据上继续推进。

2026-07-11 G6-2 Codocs 表格快捷操作领域拆分：表格行/列/表头/删除及合并/拆分的执行、可用性检测、焦点恢复、失败提示和结构变更后的列宽重标尺，已从 `MilkdownEditor.client.vue` 迁至注入式 `useEditorTableQuickActions`；主编辑器继续只保留 GFM 合并前的多内容 fail-closed 检查、命令引用和浮层模板，`useEditorTableUi` 继续只负责 hover/selection 坐标。新契约测试固定该边界与 resize/CellSelection/失败提示/重标尺行为，不改变协作、持久化或 Markdown codec。Codocs 100 项测试、lint、typecheck 与 diff-check 通过。端口 3001 未运行，故本轮无法完成 1440px/390px 已认证浏览器验收；未启动服务、未操作真实文档、协作服务、迁移或部署。

2026-07-11 G6-2 本轮离线门禁：根级 Node 22.19.0 `pnpm release:check --allow-dirty` 已通过，覆盖发布/Cloudflare 静态契约、活跃工作区 lint/typecheck/test、Data Runtime 与 Notification Runtime Go 测试；Insights lint 保持 0 error、166 个既有 warning，未改 Insights/Align。该命令未执行 Cloudflare 部署、数据库 migration/seed、R2、live probe、真实租户写入或 secret 操作，不能替代 G6-2 的浏览器或真实环境验收。

2026-07-11 G6-2 Platform 授权管理行为基线：新增人员角色分配的 materialization/grant 租户参数、warning 与 enforce 拒绝分支、冲突诊断输入清理及 warning/blocking 呈现三项页面契约；同时修复主体角色撤销 API 的 P0 租户边界：读取、撤销更新和响应均以 middleware 已选择的 `platformTenantCode` 绑定，缺失上下文失败关闭，避免仅按 assignment ID 跨租户读写。新增两项 SQL 边界契约；Platform 全量 Node 测试 171/171、lint、typecheck 与 diff-check 通过。该基线尚不覆盖已登录的 1440px/390px 浏览器、多租户真实数据库或 Cloudflare 部署验收，故 Platform 拆分总项仍未勾选。

2026-07-11 G6-2 Platform 首个组件边界：实例职责冲突诊断已从 `AuthorizationsManager.vue` 抽至 `AuthorizationInstanceConflictDiagnostics.vue`。主组件继续独占 tenant context、`/instance-conflict-explain` 请求、optional input 的 trim/undefined 归一化、pending/error 状态和“使用已选员工”动作；新组件只接收表单、结果、选项与状态 props，并通过 `run`、`useSelectedSubject` emits 回调，不改变 API、数据库或授权判定。页面/组件契约覆盖主组件接线、输入、warning/blocking 呈现及 emits；Platform 全量 Node 测试 172/172、lint、typecheck 和 diff-check 通过。尚未在认证本地栈完成 1440px/390px，也未进行真实数据库/Cloudflare 验收，Platform 大文件总项继续未勾选。

2026-07-11 G6-2 Platform 第二个组件边界：权限解释诊断已从 `AuthorizationsManager.vue` 抽至 `AuthorizationPermissionDiagnostics.vue`。主组件继续独占当前 tenant、`/authorization-explain` 请求、所有 optional scope 的 trim/undefined 归一化、pending/error 状态及“使用已选员工”动作；新组件只接收表单、解释结果、员工选项与状态 props，并用 `run`、`useSelectedSubject` emits 回调，负责允许/拒绝、匹配 grant 与范围不匹配的呈现。新增页面/组件契约固定请求所有权、接线、emit 和结果呈现；Platform 全量 173 项测试、lint、typecheck 及 diff-check 通过。未启动认证本地栈，故尚无 1440px/390px 浏览器证据；未执行真实数据库、Cloudflare 或租户验收，Platform 大文件总项继续未勾选。

2026-07-11 G6-2 Platform 职责冲突规则行为基线与 P2 收口：Terra 审计未发现可证实 P1，但确认保存失败仍关闭规则编辑器的 P2。现将规则草稿、API 空值/未知枚举规范化、两侧职责三元组校验、重复编码检查、完整数组替换和状态切换收敛至业务专用 `authorizationConflictRules`；`persistConflictRules()` 只有在 PUT 成功并更新父级 rules 后才返回成功，编辑 modal 仅据此关闭，失败时保留草稿和原列表。新增可执行行为测试覆盖规范化、默认草稿、缺字段/部分三元组/缺职责/重复编码、局部替换/切换及失败不关窗；Platform 全量 177 项测试、lint、typecheck 与 diff-check 通过。没有修改 role-conflict-rules 服务端整租户替换 API、policy bundle、migration 或授权语义；未做认证浏览器、真实数据库或 Cloudflare 验收，下一步才可在该行为基线之上拆分规则 UI 子域。

2026-07-11 G6-2 Platform 职责冲突规则租户切换保护：规则编辑打开时冻结当前 tenant，保存前必须与当前 tenant 一致；切换后旧草稿返回 warning 且不发送 PUT。请求飞行期间发生切换时，不将旧 tenant 的成功响应写入当前 rules 列表。规则行为测试 4/4、Platform lint/typecheck 和 Platform/根目录 diff-check 通过；未执行真实租户写入、部署、迁移或 Cloudflare 操作。

2026-07-11 G6-2 Platform 职责冲突规则 UI 子域拆分：`AuthorizationsManager.vue` 现只保留当前 tenant、规则加载/保存请求、pending、租户切换 fail-closed 检查与通知；规则摘要、空/迁移状态、列表操作和编辑 modal 已整体移至 `AuthorizationConflictRulesPanel.vue`。子组件以已冻结的 tenant 调用父级保存函数，只有成功才关窗；切换企业会关闭旧编辑器并通知，保存失败继续保留草稿。规则纯函数和页面契约覆盖规范化、校验、不可变替换/切换、保存失败不关窗、父级请求所有权及切换关闭行为；Platform 全量 177 项测试、lint、typecheck 与 diff-check 通过。尝试本地浏览器验收时 127.0.0.1:3011 未监听，故尚无已认证 1440px/390px 证据；未执行真实租户写入、迁移、部署或 Cloudflare 操作。

2026-07-11 G6-2 Aims 大页审计与 P1 修复：审计确认 `work-items.vue`（2217 行）存在用户进行中的搜索防抖改动，暂不与拆分混做；`requirements/index.vue`（2214 行）应先固定 target 查询/选择语义，再抽纯 target 决策、请求 composable 和只展示的切换条，规格树和评审命令域后置。审计同时修复独立 P1：页面已传递 bug `severity`，但 `workItem` store 未把它编码到列表请求 URL，导致严重度筛选表面刷新而结果未收缩；现仅在非空时写入 `severity`，新增正反查询序列化测试，未触碰工作项页的既有防抖改动。Aims 全量 Node 测试 169/169、lint、typecheck 和 diff-check 通过。尚无 Vue 渲染、1440px/390px、认证 tenant-runtime/工作流或真实环境验收；未改 Insights/Align，未执行 Cloudflare/DB 操作。

2026-07-11 G6-2 Aims requirements target 第一安全拆分：`requirements/index.vue` 已抽出纯 `requirementsTargetSelection`，集中 URL `workItemId` 初始选择、有效选择保留、失效后的“当前 active 里程碑 → 首 target → 无 target”回退，以及“全部需求”的空 `work_item_id` 筛选值；页面继续持有请求竞态 token、数据请求、导航与状态，未拆 UI、规格树或评审命令。新增单元测试覆盖 URL 保留、两级回退、无 target 与全量清空；Aims 全量 Node 测试 174/174、lint、typecheck 和 diff-check 通过。下一步才可评估 target request composable；仍未做 Vue 渲染、1440px/390px、认证 tenant-runtime/工作流或真实环境验收。

2026-07-11 G6-2 Aims requirements target 第二安全拆分：target 请求、request-id 旧响应抑制、选择收敛与 `work_item_id` 筛选同步已移入 `useRequirementTargets`；它只接收 project/active milestone/初始 target、可注入 fetcher、选择策略和 filter setter，页面继续持有 API adapter、tabs、导航、规格树与评审命令。可注入行为测试覆盖旧响应不得覆盖新请求、失效 target 向 active milestone 收敛后清空、用户切换和“全部需求”的同步；Aims 全量 Node 测试 177/177、lint、typecheck 和 diff-check 通过。下一步可在有浏览器基线后评估只展示的 target 切换条；规格树与评审命令域仍不提前拆分，且未做真实环境验收。

2026-07-11 G6-2 Aims requirements 评审资格安全拆分：经 Terra 只读审计，评审批次与列表选择中重复的里程碑资格判断已移至纯 `requirementReviewMilestoneValidation`。它只以当前 active milestone、目标 requirement IDs 与已解析行判断缺活动里程碑、空批次、未加载、未绑定、跨里程碑及非活动里程碑，并保留 batch/selection 各自中文提示；页面继续负责批次 requirements fallback、workflow、toast、创建/提交请求和刷新编排。新增 7 个行为测试，覆盖全部 fail-closed 分支、缺里程碑三项样本+计数后缀、跨/非活动里程碑和合法当前里程碑。Aims 全量 184 项测试、lint、typecheck 与 diff-check 通过；这是纯决策拆分，未改变可视 UI，未启动浏览器或真实环境，也未执行 Cloudflare、迁移、租户写入或部署。

2026-07-11 G6-2 本轮最终离线门禁：在上述 Platform 与 Aims 改动之后，根级 Node 22.19.0 `pnpm release:check --allow-dirty` 通过；其验证了发布/Cloudflare/运行时边界契约、18 个活跃包的 lint/typecheck/test（221 个测试文件）、Insights 42 项既有测试与 Data/Notification Runtime Go 测试。Insights lint 仍是 0 error、166 个既有 warning，未改 Insights/Align。该门禁的 draft/dirty/signing-key 提示是开发态预期警告；未执行任何 Cloudflare 部署、数据库 migration/seed、R2、live probe、真实租户写入、真实验收或 secret 操作。

2026-07-11 G6-2 data-runtime Codocs 审计与 P1 撤权修复：审计确认 `internal/apps/codocs/adapter.go`（4543 行）应先按业务 command/query 保持事务边界拆分，首个低耦合候选是资讯/书签域；但先发现文档 share 删除后 `document_relations` 撤销错误被吞掉，会留下可经 relation 回退读取的旧授权。现已将 create/update/delete share 与 relation upsert/deactivate 置于同一事务：任何 relation 或 commit 错误都会回滚 share 写，成功才保留原有响应形状。新增 6 项 SQLMock 行为测试覆盖三条成功路径及 relation 失败回滚；`go test ./internal/apps/codocs`、`go test ./...` 与 diff-check 通过。未改变 BFF/API、schema、迁移或部署；adapter 中既有 review 授权脏改未回退。真实数据库、BFF/浏览器和线上撤权 E2E 仍待验收。

2026-07-11 G6-2 data-runtime Codocs 资讯/书签首拆：在 share 撤权 P1 收口后，`infoList`、`infoDetail`、资讯删除、书签更新/导入/处理及“从书签建资讯”连同专属 helper 已从 `adapter.go` 迁至 `info.go`；`HandleRuntime`、Adapter、endpoint、返回 envelope、BFF 调用面和 schema 均未变，主 adapter 由 4543 降至 4161 行。新增 10 项 SQLMock 行为测试固定列表分页/投影、书签状态白名单、ignore/process、导入与建资讯的 commit/rollback、删除恢复书签和阅读者去重；Codocs package 与 data-runtime 全量 Go 测试、diff-check 通过。接下来的 adapter 改动先处理审计发现的协作版本并发 P1；真实 DB/BFF/E2E 仍未执行。

2026-07-11 G6-2 data-runtime Codocs 协作版本并发 P1：`createCollaborationVersion` 不再以非事务 `MAX(version_num)+1` 直接写入；它现在在同一事务内先以 `FOR UPDATE` 锁住目标 documents 父行，再读取最大版本、插入并 commit，因此同文档创建者串行化、不同文档不互相阻塞，读取/插入/commit 出错均不返回成功包络。新增 SQLMock 覆盖锁→MAX→insert→commit 顺序、读取和插入 rollback、commit error；Codocs package 与 data-runtime 全量 Go 测试、diff-check 通过。尚未在带 `(document_id, version_num)` 唯一键的真实 InnoDB 目标库做并发压测，也未做 BFF/真实环境 E2E。

2026-07-11 G6-2 data-runtime Codocs 协作 actor/版本 ACL P0：Terra 审计发现协作上下文直接读取 query `actorUid`，版本创建只锁定 documents 父行、未验证操作者是否有写文档资格；持有运行时凭证者可伪造 actor 读取他人协作上下文或向任意有效文档追加版本。现在通用 runtime query 会剥离 `actorUid`/`actor_uid`，Codocs 协作上下文只取受 runtime 覆写的 `current_user`；版本写入要求可信 actor，并在锁住父行的同一事务内校验 owner 或精确 `document_shares.permission=write`，readonly/删除/无 share 均在 `MAX` 与 insert 前失败关闭。`editorUid` 不再影响保存者身份；`docId`/`uuid` 两入口均保留父行锁→ACL→MAX→insert→commit 顺序。新增 SQLMock 覆盖缺 actor 无事务、read share 在版本查询前拒绝、uuid 等价入口，runtime auth 测试覆盖伪造 query actor 移除；Tenant Runtime contract 已同步。Codocs/server 定向和 data-runtime 全量 Go 测试、diff-check 通过；未执行真实 DB 并发压测、BFF、协作服务、迁移或部署。

2026-07-11 G6-2 data-runtime Codocs 协作版本命令拆分：已将 `createCollaborationVersion` 迁至专用 `collaboration_versions.go`；`HandleRuntime` 的两条既有版本路由、响应 envelope、父行 `FOR UPDATE`、事务内 ACL、`MAX(version_num)`、insert/commit 及 SQLMock 均未改变。主 adapter 再减少一个独立写模型，不触碰协作上下文、分享/relation 事务、评审或 publish-request 域。Codocs/server 定向和 data-runtime 全量 Go 测试、diff-check 通过；未进行真实 MySQL 并发、BFF、协作服务或部署验收。

2026-07-11 G6-2 data-runtime Codocs 批注 ACL P0：批注/回复链路原先只依赖应用 scope，runtime 不校验文档范围且接受客户端 `author_id`、`resolved_by`、`deleted_by`，可导致跨文档批注读取/修改与冒名。现在读取要求可信 actor 可读目标文档（owner、direct share、有效 read relation 或已验证部门范围）；创建、状态变更、回复和删除要求 owner 或精确 write share，并验证 annotation/reply 与路径 UUID/annotation ID 同属。作者、解决者和删除者均由注入 runtime actor 写入。新增 SQLMock 覆盖仅有客户端 author 而无 trusted actor 时在任何 DB 访问前失败；Codocs/server 定向和 data-runtime 全量 Go 测试、diff-check 通过。未执行真实 DB、BFF、浏览器、迁移或部署。

2026-07-11 G6-2 Codocs 文档写入授权旁路 P0：后续复核发现 `requireDocumentWrite` 曾把请求体 `serverAuthorized` 当作已授权信号；即使通常由 BFF 写入，该字段在 tenant-runtime HTTP body 中仍可能被调用方构造，形成 owner/write-share 检查旁路。现已移除 adapter 的该分支，并将两种字段名纳入 Codocs runtime 的受信身份字段净化；所有文档更新、覆盖保存、删除、恢复、协作版本及批注写入都必须使用 tenant-runtime 注入 actor 通过既有 ACL。Codocs BFF 同时停止向文档与批注端点转发该标记或浏览器 author/resolver 字段。新增跨 BFF/runtime 契约测试，Tenant Runtime 合同已同步；Codocs 100 项测试、lint、typecheck，data-runtime Codocs/server Go 测试和三处 diff-check 均通过。此前根级 `release:check --allow-dirty` 也已通过；未执行真实 DB、部署或用户写入。

2026-07-11 G6-2 Codocs Issue/评论基础授权 P0：Terra 审计确认 Issue 列表、详情、全局待办统计和评论曾可在 BFF/runtime 两侧绕过用户身份；评论还直接写入浏览器 `author`。现 BFF 的列表/详情/待办/评论统一要求会话与 `projects:view`，Issue 图片上传要求 `projects:edit`；runtime 的全部 Issue 读写路由在任一 SQL 前要求 Foundation 签名并经 tenant-runtime 验证的 actor delegation。Issue 创建者与评论作者都由该 actor 固定，客户端 `created_by`/`author` 不再是身份事实，列表最多 100 条。新增 runtime SQLMock 覆盖无 delegation 无 DB 访问及评论作者覆盖，BFF 静态契约覆盖读/评论/上传门禁；Codocs 102 项测试、data-runtime Codocs/server Go 定向与全量测试，以及根级 `release:check --allow-dirty`（18 个活跃包、236 个测试文件、两个 Go runtime）均通过。项目 owner/admin/member/viewer、scoped-admin、评论动作、assignee 与关联文档是否要求同项目等对象范围尚无产品合同，因此本批不把全局 `projects:view/edit` 伪装成项目成员 ACL；该项保持待决，未执行真实 DB、部署或用户写入。

2026-07-11 G6-2 Codocs document-access policy P0：Terra 审计发现 `/document-access/check` 原先信任 body 的 actor、project/dept/role 属性，能以伪造 membership/grant 命中策略；策略与审计 BFF 也缺少会话和权限门禁，过期 grants 仍可命中。现全部 document-access runtime 路由在任一表检查前要求 Foundation 签名 actor delegation，BFF check 要求 `documents:view`，策略/审计要求 `documents:admin`，middleware 同步在代理前执行这些门禁。runtime 净化客户端 actor/project/dept/role 字段，仅消费签名 actor 与签名部门代码；项目/角色 grants 先失败关闭，待 Foundation/Console 增加绑定 data-scope delegation 再恢复，过期 grant 已由 SQL 排除。新增 Go/Node 契约覆盖 unsigned actor、伪造属性净化和 BFF 门禁；Codocs 103 项测试、data-runtime Codocs/server 定向测试通过。未执行真实 DB、策略写入、迁移、部署或用户操作。

2026-07-11 G6-2 Codocs share/version/read P0：后续审计确认 share 列表和版本列表仅凭 UUID 读取，版本删除在 actor 缺失时会跳过 ACL，阅读回执可接受 body `uid`。现 share 列表仅允许受签名 document owner，版本列表先通过文档 owner/share/relation/受信部门读取范围，版本删除要求受签名 actor 再执行 owner/write-share ACL；阅读回执只写受签名 actor 的直接 share。BFF 与 middleware 对 share list、version list/read 分别在转发前要求 `documents:edit` 或 `documents:view`，不再读取或转发浏览器 `uid`。新增 runtime 无 delegation 零 DB 访问与 BFF 门禁契约；Codocs 104 项测试、data-runtime Codocs/server 定向测试通过。未执行真实 DB、部署、迁移或用户写入。

2026-07-11 G6-2 Codocs 批注可信 actor P0：批注 ACL 原已验证文档范围和 author/resolver 归属，但仍会把无签名 query/body actor 作为用户事实，且 BFF 批注路径无显式会话/权限检查。现 runtime 的批注读取、创建、状态变更、回复与删除均在 SQL 前要求 Foundation 签名 actor delegation；写入仍复用 owner/write-share 边界。BFF 与 middleware 对读取要求 `documents:view`，其余批注动作要求 `documents:edit`，并在转发前完成门禁。现有冒名 SQLMock 扩展为无 delegation 场景，新增 BFF actor/权限静态契约；Codocs 105 项测试、data-runtime Codocs/server 定向测试通过。`document_relations.can_comment` 是否应允许只读关系发表评论仍待产品合同，本批继续保守要求 write，不扩大权限。未执行真实 DB、迁移、部署或用户写入。

2026-07-11 G6-2 Codocs 本批离线门禁：在 document-access、share/version/read 与批注 actor P0 收口后，根级 Node 22.19.0 `pnpm release:check --allow-dirty` 通过，覆盖发布/Cloudflare 静态契约、18 个活跃包 lint/typecheck/test（238 个测试文件）、Insights 42 项既有测试、data-runtime 与 notification-runtime 全量 Go 测试。Insights 仍为既有 166 条 warning、0 error；没有修改 Insights/Align，也没有执行 Cloudflare 部署、数据库 migration/seed、R2、live probe、真实租户写入或 secret 操作。

2026-07-11 G6-2 Codocs 文档读取数据范围 P1：审计发现 tenant-runtime 截获的 `/api/documents` 与 `/api/documents/trash` 未用可信 actor 构造范围，客户端可借 owner/无 owner 获得未限定元数据。现将 BFF 与 runtime 收口为纵深边界：BFF 要求当前用户和 `documents:view`，部门读取先经既有部门范围校验，清除浏览器 actor/marker 后才写入受签名的可信 actor 与精确部门 marker；runtime 仅在 HMAC 验证后注入 delegated actor 标记，list/trash 要求该 actor，并以 owner、direct share、有效 `can_read` relation（project preview 保留 12 小时上限）或精确已验证 department 构造 SQL predicate。`project_code` 永不作为放行条件，service-only 文档 summary/content/batch 既有合同未改。文档详情缺 actor 同样失败关闭。另修复读取 BFF 把 401/403 误包装为 500：已验证 H3 error 现原样返回，未知故障才映射 500；测试证明缺 actor、缺 `documents:view`、未授权部门均在 runtime 调用前失败。Codocs Node 85/85、lint/typecheck，data-runtime Codocs/server 定向与全量 Go 测试、三处 diff-check 均通过；`Tenant-Runtime-API-Contract-v1.md` 已记录 fail-closed 范围合同。尚未做真实 MySQL、签名 actor 全链路、多用户浏览器或真实环境 E2E。

2026-07-11 G6-2 data-runtime Codocs 文档 query-only 首拆：在读取 P1 收口后，`documentsList`、`documentsSearch`、`documentsBatchSummary`、`myDocumentStats`、`documentNameExists` 和 `documentsTrash` 已迁至 `document_queries.go`；`HandleRuntime`、可信 actor/可见性 predicate、详情 ACL、分享、评审、写路径和公共 helper 保持在 adapter。主 adapter 从 4260 降至 3866 行。新增 6 项 SQLMock 行为测试固定可信 actor 列表分页/多筛选参数顺序、搜索上限、批量空值/50上限/去重与输出顺序、缺 actor/零分母统计、空 folder/exclude 名称检查和回收站投影；搜索参数由等价固定 filter 列表替代 map 遍历，避免参数顺序不稳定。Codocs package 与 data-runtime 全量 Go 测试、diff-check 通过；未执行真实 DB、BFF、浏览器、E2E、迁移或部署。

2026-07-11 G6-2 Codocs cabinet 审计：个人/部门文件柜当前被 tenant-runtime 通用映射接管，但列表、metadata、预览、文本/Office/PPTX 转换和下载未把可信 actor 或部门范围带入 runtime 查询，浏览器可通过缺省或伪造 `owner_uid` / `dept_code` 读取他人元数据并进一步获得 OSS 内容或签名 URL；download 的 export 权限不能替代对象读取授权。cabinet 还绕过了 documentAccess 的 owner/share/relation/12h preview-relation 事实，`converted_doc_uuid` 是否必须继承关联文档 ACL 尚需产品确认。项目文件柜的既有 service-only API 具备 internal API、project code 和精确路径约束，本批不扩展其范围。下一步先由 Terra 收口个人/部门柜的可信 actor、部门范围和 OSS 前 metadata 授权；待确认 converted document 的继承规则后，再决定是否将其纳入同一 scope helper。未修改代码或执行外部操作。

2026-07-11 G6-2 Codocs cabinet 读取范围 P1：个人/部门柜用户态读取已从 runtime generic ResourceSpec fallback 分离，personal list/detail 强制 Foundation 签名 delegated actor 且 SQL 固定 `owner_uid=actor`、排除 department/project 柜并忽略浏览器 owner；department 由 BFF 先校验当前用户、`documents:view` 与部门读取范围，再通过 request-target 覆盖签名的精确 department marker 约束 runtime SQL。统一 scope-aware metadata/list helper 已在 preview、download、text/HTML、Office/PPTX、converted-info 以及转换/删除/发布等 OSS 副作用前执行；export 权限不再替代对象读取授权。项目 cabinet service API 对外合同不变，历史 department fallback 改为只在原 service token、project code、expected OSS path 绑定通过后使用的内部兼容读。新增 Go SQLMock 与 Node 契约覆盖缺 actor、跨 owner/department、正常允许、generic fallback 阻断、OSS/签名 URL 顺序与 export 非替代关系；Codocs Node 89/89、lint/typecheck、data-runtime 全量 Go 与三处 diff-check 通过。`converted_doc_uuid` 是否强制继承关联文档 ACL 仍待产品确认，已在 CODOCS API spec 标注；未执行真实浏览器、OSS、tenant、迁移或部署。

2026-07-11 G6-2 Codocs review 读取 P1：`by-document`、`by-oss-path` 以及 publish-request list/detail 现均要求当前登录用户与 `reviews:view`，BFF 清除浏览器伪造 actor 后才传递可信 runtime actor。publish-request GET 不再经过无范围 generic ResourceSpec；runtime 专用投影只允许发起人、同 document UUID 的已完成 seal/send 本地参与者，或仍有 owner/share/有效 relation ACL 的用户读取，拒绝路径在 actions、盖章/发送记录（含 receiver phone、备注）投影之前失败。新旧 review 表数值 ID 同时命中时返回 `409 review_source_ambiguous`，不再任意优先新表。Workflow 当前节点审批人无本地快照时的读取承诺仍待 Workflow Service 授权查询契约，未直连 Workflow DB 或猜测实现，已记入 CODOCS API spec。新增 Go SQLMock/Node 契约覆盖匿名、撤销 relation、敏感 enrich 前拒绝、generic bypass 消除及 ID collision；Codocs Node 92/92、lint/typecheck、data-runtime 全量 Go 和两仓 diff-check 通过；未执行部署、迁移、真实 DB 或 Workflow 调用。

2026-07-11 G6-4 活跃模块离线文档收口：已按 `MODULE_CONTRACTS.md` 与 Foundation/业务模块现有实现核对 Aims、Altoc、Codocs、Workflow 的非归档文档。Aims 审批动作同步示例改为 `aud=workflow`、`scope=workflow:action_defs:sync` 的短期 Console service token；Altoc×Codocs 集成不再把 app 级 `license.lic` 作为当前 bootstrap；Workflow 设计不再写 Account 静态 key/CAS 认证。Codocs API 的 401 文案同步为 Console session/service token，保留的 `/api/account/**` store/BFF 指南明确改为 Console Directory adapter 与受验证会话；两份旧审阅指南标注为历史迁移参考并移除 Account API key/secret、数据库口令等示例凭据。资产文档中“API Key”仅为受管资源分类，未误改；历史 TODO/归档事实、Insights、Align、Account 与业务代码均未触碰。仅运行文档 diff-check，未执行部署、迁移、外部访问或真实凭据操作。

2026-07-11 G6-1/G6-4 Aims、Assets、Foundation 活跃设计文档事实同步：核对 `aims/docs/Aims-PRD.md`、`assets/docs/Assets-Design.md`、`foundation/docs/Workflow-Integration-Guide.md` 与当前 Nuxt/ Foundation 实现及 `MODULE_CONTRACTS.md`。三文档均新增最小当前运行契约，保留原产品设计与演进信息；Aims/Assets 的 Account 身份、目录、项目注册表和权限主路径改为 Foundation 接入 Console OIDC、Console Directory、Console 运行时授权与 tenant-runtime，遗留 `/api/account/**` 明确仅是已验证 Console 会话后的兼容命名且无 Account fallback。Aims Git 集成改为 Foundation Git integration + Console 受管集成配置。Workflow 指南移除 `HZY_ACCOUNT_API_*` 与 `Bearer key:secret` 示例，审批动作同步改为 Foundation `syncApprovalActionsToWorkflow()` 的短期 Console service token，审批人部门配置改指 Console Directory。未改业务代码、Account、Insights 或 Align；仅执行三模块与根文档 diff-check，未部署、迁移、外部访问、真实凭据或提交。

2026-07-11 G6-4 Aims/Finance typed-route 死代码树专项审计：两模块均未发现能安全删除的文件，因此未为了完成清单而制造重构。Aims 未启用 `experimental.typedPages` 或 `unplugin-vue-router`；按 Nuxt 实际文件路由生成器审计，42 个 `app/pages` 文件全部生成路由（遗漏 0），`requirements.vue` 与 `requirements/index.vue` 是父路由/默认子路由，`work-items` 的 append/breakdown/decompose 是保留深链。Finance 的 catch-all 是 `pageConfigs` 菜单入口，发票编辑页、通知详情页、诊断页及 no-access 页面分别有动态路由、运行调用或 middleware/权限测试引用。Finance `nuxi prepare --dotenv .env`、32 项针对性路由/权限/详情测试和 diff-check 通过；Aims 路由生成器审计未改文件。未启动服务或浏览器，未执行部署、迁移、外部访问、真实租户或提交。

2026-07-11 G6-4 legacy 运行文档边界补审：对 Aims、Altoc、Assets、Foundation、Workflow、Codocs 与 Directory Runtime 的非归档设计/测试/集成文档，仅修订可由 `MODULE_CONTRACTS.md`、模块 `CLAUDE.md` 和当前 Foundation/Codocs 实现直接反驳的默认运行描述。早期 Account/CAS、本地 MySQL、静态 API key/secret、业务应用直连 Platform 和 Account API GitLab Bot 前提均标为历史或显式兼容，不得作为新路径；当前基线明确为 Console OIDC、Console Directory + Foundation adapter、短期 Console service JWT、Console 受管 integration/vault 与 tenant-runtime/data-runtime。Assets 测试前提改为已验证 Console 会话/Directory/权限快照；Aims 审批 manifest 的资源发布改为 Platform release/import，授权治理改为 Platform/Console；Directory Runtime 旧 Account mirror/fallback 与 `Bearer {api_key}:{api_secret}` 描述明确降为历史迁移设想。Codocs GitLab 两份旧说明只指向当前受管集成与“未补专用 tenant-runtime 合同必须 fail-closed”的现有约束，未猜测或宣称替代同步路由已落地。未改 API/schema/ADR、历史归档、Insights、Align 或业务代码；各相关模块与根 `git diff --check` 通过，未执行部署、迁移、seed、外部访问、真实凭据或提交。

### G6-3 Insights 现代化决策

- [ ] 决定 Insights 是核心产品模块还是独立工具。
- [ ] 若进入核心产品：接入 app manifest、Foundation/Console OIDC、Directory 和授权快照。
- [ ] GitLab 凭证迁入 Console integration/vault。
- [ ] 移除对 legacy Account API 和本地 cookie 权限主路径的依赖。
- [ ] 明确 Python 分析服务的 service identity、tenant 隔离和审计。

### G6-4 Legacy 收口

- [ ] 保持 `account/` 只作为迁移源和兼容 facade，不新增业务能力。
- [ ] 在 Console Directory 能力覆盖后，逐项移除业务模块 legacy Account 配置。
- [ ] Aims/Finance typed-route 死代码树只在独立专项中清理，并跑全量类型检查。
- [ ] 清理旧文档中的业务应用 `license.lic`、静态 API key 和直连 Platform 描述。

## 11. 明确暂缓事项

- [ ] `Align` 第一阶段继续暂缓，直到 Console 轻量事项演进出独立状态机、SLA 或履约台账。
- [ ] 暂不建设完整 HRM、招聘、考勤、薪酬发放和社保个税。
- [ ] 暂不建设完整总账、税务申报、多账套和银企直连。
- [ ] 暂不扩展 Account 新能力。
- [ ] 暂不启动大范围 AI 助手或自动决策。
- [ ] 暂不在缺少行为测试时进行全模块重写或统一抽象。

这些复选项表示“已确认继续暂缓”，不是开发完成项。

## 12. 建议 Sprint 排期

### Sprint 0：质量止血

- G0-1 Altoc scoped 回归。
- G0-2 Codocs 类型和直接依赖。
- G0-3 Platform 当前权限改动测试收口。
- G0-4 People/Codocs 测试接入。

### Sprint 1：工具链与授权验收

- G0-5 Insights 测试环境。
- G0-6 工具链统一。
- G0-7 CI 门禁。
- G1 授权模型和真实环境验收。

### Sprint 2：P3 生产闭环

- People 入口、Directory 投影和 offboarding。
- Aims → People → Finance 人力成本。
- 幂等重放和错误路径。

### Sprint 3：P4 生产闭环

- Altoc 服务工单 → Aims → Altoc。
- Codocs 运维知识、Assets 交付资产包。
- Finance 维保财务摘要。

### Sprint 4：可靠性与统一入口

- G3 跨模块操作记录、重试和重放。
- G4 Console 待办与通知聚合。

### Sprint 5 及以后：指标与专项治理

- G5 首批指标快照和驾驶舱。
- 单一 AI 场景试点。
- G6 文档、Insights、超大文件和 legacy 专项。

## 13. 单项任务交付模板

执行每个复选项时，应在任务或提交说明中记录：

```text
任务 ID：
责任模块 / Git 仓库：
目标与非目标：
依赖任务：
修改文件：
schema / API / manifest / grant 变化：
验证命令：
浏览器验证：
真实环境验证：
回滚方式：
遗留风险：
文档同步：
```

2026-07-11 G6-2 Codocs Aims preview-access 关系授权 P0：专项审计确认 Aims 项目成员/文档归属校验在本地入口已存在，但 Aims 曾可优先直连 Codocs tenant-runtime，runtime 又会信任 body 中的 actor、来源应用和项目编码创建 `project_preview_access` 读关系；普通 `codocs:documents:write` service token 因此不足以承载该 ACL 写入。本轮已删除 Aims 对该操作的 runtime 直连，Codocs service API 改为仅允许已验证的 AIMS service caller（兼容现有 write scope），并在没有 Foundation 验证的签名 service-command 前返回明确 503；data-runtime 同一路由也 fail-closed，任何裸 body 均不会查询或写入文档关系。新增 Aims 来源 guard、无 body/runtime forwarding 静态回归及 Go fail-closed 测试，更新 MODULE_CONTRACTS 与 Tenant Runtime contract。遗留跨服务合同：专用 preview-grant capability、签名命令的 actor/document/project/tenant/deployment/expiry/idempotency 绑定、项目归属 assertion 的权威来源及关系撤销/续期规则；合同落地前项目 iframe 预览将返回受控错误。未执行真实 tenant、服务调用、迁移或部署。

2026-07-11 G6-2 Codocs folder ACL P0：`/v1/codocs/folders` 曾不要求可信 actor，并把 `owner_uid/dept_code/project_code` 作为浏览器可控过滤条件，任意调用者可枚举目录；部门目录 `/open` 写入也只按 ID 更新。现已强制 Foundation 签名 actor；通用用户列表固定为本人 `private` 与 BFF 精确核验部门的 `department` 目录，客户端范围字段仅能收窄，`project/publish/slide` 因尚无来源域范围断言而 fail-closed。BFF `/api/folders` 读取要求登录和 `documents:view`，重建 actor/部门上下文；部门开放写入在 BFF 完成部门经理校验后传递目标绑定管理标记，runtime 在读取目标目录后比对部门再更新。新增 unsigned actor 无 storage 访问、目标部门 SQL 绑定及 BFF scope 静态回归；Codocs Node 106/106 与 data-runtime Codocs Go 测试通过。遗留：项目/发布/Slide 目录的来源域成员/发布范围 assertion，以及通用 folder detail/普通 mutation 的对象级合同，未执行真实 tenant、迁移或部署。

2026-07-11 G6-2 Codocs document create relation atomicity P1：`createDocument` 曾先提交 documents 行、再忽略 owner `created_by_me` relation 的写入错误，可能产生 owner relation 缺失的孤立文档。本轮将 documents 插入和 relation upsert 收敛到同一 SQL transaction；关系表缺失、relation 写入或 commit 失败均回滚，创建不再返回成功。新增 SQLMock 回归固定“relation 失败 → rollback”，并同步 Tenant Runtime contract；data-runtime Codocs Go 测试通过。未执行真实数据库、迁移或部署。

2026-07-11 G6-2 Codocs folder mutation + project OSS P0：Terra 审计确认 middleware 会抢先把 `POST /api/folders`、`PATCH/DELETE /api/folders/{id}` 转给 runtime，绕过本地 owner/部门经理检查；generic adapter 对 folders 没有 owner/department/project predicate，猜测 ID 可越权读改删。另有项目 GitLab 文件列表和 diff 路由未做登录/项目范围校验，浏览器 `projectCode/ossPath` 可直接驱动 OSS 读取。现已在 data-runtime 禁止 folders detail/create/普通 mutation 回落 generic adapter，仅保留已专门收口的 list 与 department-open；项目 files/diff 路由要求登录与 `projects:view`，并因尚缺签名项目成员/仓库路径范围 assertion 在任何 Directory/runtime/OSS 调用前 fail-closed。Codocs lint/typecheck/106 Node tests 与 data-runtime Codocs Go 测试通过。遗留合同：Aims/Console 需签发绑定 actor、tenant/deployment、project_code、动作、成员/负责人或 scoped grant、repo/document scope 与 expiry 的项目范围 assertion；确定成员可否创建/编辑目录、项目公开性与成员移除撤销语义后，再恢复专用路径。未执行真实 OSS、tenant、迁移或部署。

2026-07-11 G6-2 Codocs review/publish generic fallback P0：Terra 初审确认 reviews、publish-requests、review-actions 仍注册 generic ResourceSpec，专用读取虽有 document ACL，但 POST/PATCH/DELETE 可绕过发起人、文档写权限、workflow 归属与状态迁移；workflow-instance 绑定还可把任意 instance ID 写入任意 publish request。现已在 data-runtime 的专用路由层拒绝这些 generic 路径，已存在的 document-bound 专用读取继续保留，未建专用命令合同的读写返回 503。新增 runtime 无 DB fail-close 回归；data-runtime Codocs Go 测试通过。后续必须建立 review create/cancel/transition、publish request workflow bind 与 review action 的专用 actor/document/workflow 合同后再恢复功能。未执行真实 workflow、数据库、迁移或部署。

2026-07-11 G6-2 Codocs review read boundary P1：Terra 审计确认 review/publish request/by-document/by-OSS/my 等 runtime 读取只检查 actor 值、未要求 tenant-runtime delegated marker；审批模板 GET 也允许匿名访问，归档 review lookup 会以同标题回退，可能关联到无关源文档。现已统一要求 `hzy_runtime_actor_delegated=1`，模板读取要求登录和 `reviews:submit`，`/reviews/my` 要求 `reviews:view`，归档查找仅接受精确 archive path 或 archive UUID 映射、无映射则 404。现有 revoked relation/ID collision SQLMock 更新为可信 actor，Codocs lint/typecheck/107 Node tests 与 data-runtime Codocs Go 测试通过。工作流回调、发布申请创建/状态迁移和 instance 绑定仍等待 Workflow→Codocs 签名 service-command；PII 电话字段投影仍需产品数据分级决定。未执行真实 workflow、数据库、迁移或部署。

2026-07-11 G6-2 Codocs annotation ACL domain split P1：由 Terra 将 annotation 的受信 actor、文档读取/写入 ACL、annotation/reply 路径归属、创建/状态更新/回复/删除实现从主 `adapter.go` 迁至独立 `annotations.go`。`HandleRuntime` 中五条原路由调用、方法签名、SQL、检查顺序和返回 envelope 保持不变，主 adapter 不再持有这 8 个实现。源码复核确认实现只出现于新文件且路由仍调用原方法名；data-runtime 全量 Go 测试与 diff-check 通过。未新增 schema/API、未执行真实数据库、浏览器或部署。

2026-07-11 G6-2 Codocs document-access domain split P1：由 Terra 将 document-access policy/grant/check/audit 领域从主 `adapter.go` 迁至独立 `document_access.go`（693 行），包括 policy/grant/result 类型、受信 delegated actor、默认策略、有效期 grant 查询、审计、access check、读取/事务更新和审计列表。Adapter 仅保留原四条路由调用及仍被其他域使用的通用 helper；方法签名、API 返回、审计/事务语义和 `expires_at IS NULL OR expires_at > NOW()` 过期过滤不变。源码复核与 data-runtime 全量 Go 测试、diff-check 通过；未新增 schema/API、未执行真实数据库或部署。

2026-07-11 G6-2 Platform role-assignment UI split P1：由 Luna 提取 `AuthorizationRoleAssignmentsModal.vue`，承接人员主体树选择、筛选、过期时间、授权结果与撤销展示，只通过 props/emit 与父组件协作；`AuthorizationsManager.vue` 继续独占 tenant context、subjects/assignments 派生、role materialization、load、grant/revoke mutation、冲突处理与全部 API 请求。新增行为回归断言子组件不得含 platformFetchJson/`$fetch`/API path；Platform lint、typecheck、authorizationManagerBehaviorSafety（5）和 platformAuthorizationRoleSplit（18）及 diff-check 通过。未执行浏览器、部署或提交；父组件/测试原有脏改保持不回退。

2026-07-11 G6-2 Codocs Review read domain split P1：由 Luna 将受信 review actor、my/detail/publish-request list/detail、by-document/by-OSS/archive lookup、document ACL/projection 及 action/seal/send records 从 `adapter.go` 迁至 `reviews.go`；runtime 路由分发、SQL、返回 envelope 和既有 shared helper 保持在原边界。新增 `HandleRuntime` 路由回归，确认六条读取路由在缺失 delegated actor 时返回 401，不能跌回 generic ResourceSpec；既有 SQLMock 继续覆盖 ACL 与拒绝路径。源码复核确认迁出的实现只定义于 `reviews.go`；data-runtime Codocs package、全量 Go 测试与 diff-check 通过。未新增 schema/API、未执行真实数据库、Workflow、浏览器或部署。

2026-07-11 G6-2 Codocs table quick-actions presentation split P1：由 Terra 新增 `EditorTableQuickActions.vue`，仅根据 `useEditorTableUi` 的定位 state、只读/源码模式及 merge/split 可用性呈现悬浮操作栏并 emit 十个动作；不依赖 Milkdown、Y.js、网络、协作或持久化。`MilkdownEditor.client.vue` 保留全部 Milkdown command、选区/多内容合并保护、resize/rescale、Markdown codec 和 Y.js 协作，只通过 `handleTableQuickAction` 显式映射组件事件。行为/边界测试覆盖父壳接线、emit、disabled 状态和展示组件不得依赖 Milkdown；Codocs lint、typecheck、108 项测试与 diff-check 通过。未启动认证服务，故尚无 1440px/390px 浏览器验收；未执行真实文档、协作服务、迁移或部署。

2026-07-11 G6-2 Codocs Issues domain split P1：由 Terra 将 Issues 的受信 actor、list/create/detail/update/delete/pending-count/comment 路径从主 `adapter.go` 迁至 `issues.go`，主 adapter 保留原七条 runtime 路由分发。路径、operation、SQL、授权检查顺序和返回 envelope 均不变；扩展 `HandleRuntime` 回归，确认七条路由在未委托 actor 时先返回拒绝且不访问 storage，既有测试继续确认评论 author 不能由浏览器伪造。data-runtime Codocs package、全量 Go 测试和 diff-check 通过。未新增 schema/API、未执行真实数据库、浏览器或部署。

2026-07-11 G6-2 Codocs Issues 单项目范围 P0：专项审计确认原 Issues 只验证 actor delegation 与扁平 `projects:view|edit`，list/pending 可全表枚举，detail/update/delete/comment 仅按 ID，任何有粗粒度权限的用户可跨项目读取或写入。现 BFF 对每次请求要求 target `project_code`，以 verified uid 读取 Console Directory 项目、managed/joined 成员关系及项目部门链，再以 Foundation scoped authorization 在同一 grant 中求值 `codocs/projects:view|edit`；目录/授权不可用为 503，不使用吞错 fallback。成功后才注入 request-target HMAC 覆盖的 `codocs_trusted_issue_project_code`。Runtime 拒绝缺 marker、非 user actor purpose 或未委托 actor；list/count、detail/update/delete/comment 的 SQL 均固定 marker project，comment 为 parent-bound `INSERT … SELECT`，delete 0 affected 为 404。create 与变更 `document_uuid` 在同一 transaction 锁定校验同项目 active `project|git-project` document，跨项目/私有/失效 UUID 零写。调用 UI 与 pending badge 均传当前项目 code；通知 URL 显式带已授权项目 code。新增 BFF 静态、SQLMock 正/负向与 marker 零 DB 回归；无 schema、manifest、grant、migration、seed 或部署。浏览器 1440/390 仍未执行（本地无认证运行环境）。

2026-07-11 G6-2 Codocs collaboration read domain split P1：由 Luna 将协作上下文、协作文档列表及其专属投影/scope helper 迁至 `collaboration.go`，主 adapter 保留原三条协作路由和共享 JSON/review helper（后者仍为 `reviews.go` 复用，避免反向依赖）。路由、operation、envelope、SQL 与现有 ACL 语义保持不变；新增 runtime 嵌套路由/envelope/projection、collab-docs 缺 actor 零查询拒绝和 todo relation 投影测试，部门可信只读覆盖保留。data-runtime Codocs package、全量 Go 测试与 diff-check 通过。未新增 schema/API、未执行真实数据库、协作服务、浏览器或部署。

2026-07-11 G6-2 Codocs project-cabinet domain split P1：由 Terra 将项目文件柜 list/detail/create 从主 `adapter.go` 迁至 `project_cabinet.go`，主 adapter 保留原三条 runtime 路由、operation 与 envelope。`project_code`/folder SQL 谓词、`codocs_project_cabinet_legacy_read` 的受限 OSS 路径兼容及创建后 `projectCabinetFile(ctx, uuid, nil)` 查询均保持不变；共享 columns/body/ID helper 仍留在 adapter。扩展 runtime list/detail/create 测试，覆盖缺 project 在 DB 前拒绝、detail 的 project SQL 谓词与 create 的 insert→detail lookup。data-runtime Codocs package、全量 Go 测试和 diff-check 通过。未新增 schema/API、未执行真实数据库、OSS、浏览器或部署。

2026-07-11 G6-2 Codocs project-cabinet exact service contract：Aims 四个既有项目 ACL 入口在原成员/管理员、文档归属及 access-check 后，分别申请 `codocs:project-cabinet:upload/read/read/delete`，不再使用通用 documents scope。Codocs 以 Foundation 已验证 `aud=codocs` 的 service context 进一步固定 `app=aims`、`client=aims|aims.runtime`、精确 scope 及 tenant/deployment；401（无效/撤销）、403（来源/capability/binding 不符）、503（Console introspection 不可用）保持区分。guard 成功后才清洗浏览器项目字段并写 request-target HMAC 覆盖的 project marker；Runtime GET/POST/DELETE 仅使用 marker 的 exact project SQL，POST/DELETE 严格项目 OSS 前缀，DELETE 对 expected path 做 BFF 读取及锁定行二次比对；PATCH/PUT 继续 503。新增 v1.50 Console service-only seed/verify 文件，不创建浏览器权限、user grant、credential 或 secret，且未执行。未执行 SQL seed、迁移、部署、OSS、真实请求或真实租户验收。

2026-07-11 G6-2 Codocs folders domain split P1：由 Luna 将 trusted document actor、document/folder visibility predicate、folders list 与 department open mutation 迁至 `folders.go`，`adapter.go` 保留 list/open 路由、generic `folders/**` 503 contract block 与调用点。delegate actor、精确 department marker、private owner/department SQL 边界、project/publish/slide 非授权输入、target department read→同 marker update 均不变；扩展测试覆盖 trusted marker 进入 COUNT+SELECT 参数、D2 目标与 D1 marker 返回 `folder_department_scope_mismatch` 且无 update，以及 generic 503/operation。data-runtime Codocs package、全量 Go 测试和 diff-check 通过。项目/发布/Slide 的来源域范围 assertion 仍是待定合同；未新增 schema/API、未执行真实数据库、浏览器或部署。

2026-07-11 G6-2 Codocs document share/version/read domain split P1：由 Terra 将 document ID、share/version list、share create/update/delete、read、version delete 及 share 专属 relation sync/deactivate transaction helper 迁至 `document_shares.go`。主 adapter 的 runtime 路由、operation/envelope、documentAccess/owner 检查和通用 relation helper 保持不变；后者仍为 document 创建与 Ops Knowledge 复用。现有 share+relation 事务回滚 SQLMock 覆盖保留，新增 runtime SQLMock 固定四条未委托 actor 路由在零 DB 前返回 403 及已读成功路径的 SQL/兼容 envelope。data-runtime Codocs package、全量 Go 测试和 diff-check 通过。未新增 schema/API、未执行真实数据库、OSS、浏览器或部署。

2026-07-11 G6-2 Platform role catalog presentation split P1：由 Luna 提取 `AuthorizationRoleCatalog.vue`，承接角色目录的 UCard/UTable、策略状态、用户摘要与授权/权限/差异/同步展示事件；子组件不包含 `platformFetchJson`、`$fetch` 或 API path。`AuthorizationsManager.vue` 继续独占 tenant context、角色/人员数据派生、materialize、授权/撤销、同步、差异、权限及全部 API 请求，并接线 select/assign/show-permissions/show-diff/sync(force) 事件。Platform Node 测试 179 项、lint、typecheck 和 diff-check 通过；未启动认证服务，因此尚无 1440px/390px 浏览器验收，未部署、迁移或提交。

2026-07-11 G6-2 Codocs document lifecycle domain split P1：由 Terra 将 `createDocument`、业务上下文类型推断、update/delete/restore、写入 ACL 和同目录标题唯一性校验从主 `adapter.go` 迁至 `document_lifecycle.go`。`HandleRuntime` 的 documents create/update/delete/restore 路由、operation、兼容 envelope、SQL、UUID/路径生成、owner `created_by_me` relation 同事务及 owner/share/readonly/deleted-state 语义保持不变。既有 SQLMock 继续固定 relation 写入失败即 rollback；新增路由级 SQLMock 确认受信 query actor 覆盖浏览器伪造 owner，且伪造 body actor 不能越权更新或触发 mutation。`documentByUUID`、share permission 和通用 relation helper 保留在 adapter，因为 document access、share、annotation 与 Ops Knowledge 仍复用。data-runtime Codocs package、全量 Go 测试和 diff-check 通过；未新增 schema/API，未执行真实数据库、迁移、部署或提交。

2026-07-11 G6-2 Platform role permission modal presentation split P1：由 Luna 提取 `AuthorizationRolePermissionModal.vue`，承接权限详情的 role summary、来源 badge、错误、加载、空态和按资源分组的 action 展示，仅通过 props 与 `update:open` 协作；组件不含 tenant context、`platformFetchJson`、`$fetch` 或 API path。`AuthorizationsManager.vue` 继续拥有 rolePermission 状态、title/source/groups computed 与 `showRolePermissions` 的两条 tenant-bound API 请求和错误处理。为修复新组件拆分暴露的 TypeScript 隐式 any，catalog 的等价 sync 内联 handler 改为直接接线既有 `enableSystemRole`，未改变授权语义。Platform Node 180 项测试、lint、typecheck 和 diff-check 通过；未启动认证服务，故尚无 1440px/390px 浏览器验收，未部署、迁移或提交。

2026-07-11 G6-2 Platform role diff card presentation split P1：由 Luna 提取 `AuthorizationRoleDiffCard.vue`，仅接收 diff 展示角色标识、覆盖状态和 permission/scope 的六项差异统计；不含 tenant context、API、`platformFetchJson`、`$fetch` 或 mutation emit。父组件仍通过既有 `v-if="activeDiff"` 管理可见性，并独占 activeDiff、`showDiff`、`enableSystemRole` 和 tenant-bound diff API。新增安全边界测试固定父组件接线/请求所有权与子组件六项指标/覆盖状态；Platform Node 181 项测试、lint、typecheck 和 diff-check 通过。未启动认证服务，故尚无 1440px/390px 浏览器验收，未部署、迁移或提交。

2026-07-11 G6-1 Platform/Console/Identity 文档事实核对：由 Terra 对 `Platform-Console-MVP-Integration-Plan.md`、`Identity-Plane-Design.md` 与 `Control-Plane-API-Contract.md` 做仅文档核对。三文档现均标明为历史/目标设计参考、最后核对日期、当前事实源及外部操作须单独授权；明确仓库静态核对不等于 migration、secret、Cloudflare 部署或真实租户验收。依据当前 `platform/server/api/v1/auth/**`，federation/refresh 路由仍明确未实现并交由 Console，Platform 不承担企业应用用户 IdP；依据路由清单，`/api/v1/policy/bundles/current` 仍为目标接口；依据 `runtimeAuth.ts` 和根契约，opaque `hzy_rt_...` 只保留显式离线/兼容路径，新增跨应用调用须使用 Console 短期 service JWT 与细粒度 capability；依据 `platform-access.ts`，退役头只覆盖 legacy runtime/admin，`/api/platform/**` 的 ops/tenant-admin 尚未整体迁移或退役。未执行外部访问、迁移、secret、部署、真实请求或浏览器验收；`git diff --check` 已通过。

2026-07-11 G6-2 Codocs document read authorization domain split P1：由 Terra 将 document detail 读取授权的 `documentAccess`、受信部门精确匹配、document lookup、share permission 与 relation read（含 `project_preview_access` 仅 12 小时有效的 SQL 过滤）从主 `adapter.go` 迁至 `document_read_authorization.go`。`HandleRuntime` 的 `GET /documents/{uuid}` 路由、operation、兼容 envelope 与 preview-access service-command 503 fail-closed 保持不变；owner、read/write share、有效 relation、精确 signed department、deleted/readonly projection、错误码与 SQL 语义未改。annotation、lifecycle、share、review 与 collaboration 仍复用同一组 helper，未复制 ACL。新增 route-level SQLMock 覆盖缺 actor 401 且零 DB、owner 可写投影、write-share、relation readonly、部门精确允许及错部门拒绝，并断言 relation 查询的 preview 12h 谓词。data-runtime Codocs package、全量 Go 测试与 diff-check 通过；未新增 schema/API，未执行真实数据库、OSS、迁移、部署或提交。

2026-07-11 G6-2 Aims requirement target switcher presentation split P1：由 Luna 提取 `RequirementTargetSwitcher.vue`，承接“全部”、baseline/change target、任务/需求计数和目标里程碑/PIVR 的 Nuxt UI 展示，仅通过 `update:activeTargetId` 回传选择。requirements 页面继续独占 `useRequirementTargets`、target 请求与竞态抑制、URL/filter 同步、`activeTargetId` watch、milestone store、规格树和评审命令。新增结构边界测试固定页面请求/composable/filter/event 接线及子组件 all/baseline/change/milestone 呈现、无 API/router/filter/selection 生命周期；Aims Node 187 项测试、lint、typecheck 和 diff-check 通过。未启动认证服务，故尚无 1440px/390px 浏览器验收，未部署、迁移或提交。

2026-07-11 G6-2 Codocs legacy Account-named directory BFF audit P1：Terra 审计确认 `server/api/account/**` 已通过 Foundation `directoryApi` 访问 Console Directory，未发生 Account fallback；但除 clipboard 外，多数兼容读取在应用级 Directory adapter 前未要求已验证会话，`user-departments?uid=` 与 `users/{uid}/projects` 还接受任意浏览器 uid，形成匿名目录代理及跨主体关系读取边界。现统一要求兼容目录/配置路由先取得 verified request uid；`/account/user`、`/account/user-departments` 与 `/account/users/{uid}/projects` 进一步精确绑定请求 uid 到当前会话，其他协作目录展示读取至少不能匿名调用。未新增 Account 能力、未改 Directory provider 或引入回退；CODOCS API spec 明确这些仅为历史 BFF 路径名、Console `401/403` 必须 fail-fast。新增静态契约覆盖所有受保护路由、调用顺序和 self binding；Codocs 110 项 Node tests、lint、typecheck 与根/Codocs diff-check 通过，未执行外部访问、部署、迁移、真实租户或提交。

2026-07-11 G6-2 Aims legacy Account-named Directory/Git BFF P1：Terra 审计确认 Aims 的 `/api/account/**` 未落入仅覆盖 `/api/v1/**` 的 Console 会话中间件；除 `accessible-departments` 外，兼容目录、配置、用户、项目注册表与 Git Markdown 路由均可在未验证会话下触发 Console Directory 或 Foundation Git integration，`user-departments?uid=` 与 `users/{uid}/projects` 还接受任意 UID。现 `requireAimsSessionUid` 在使用应用 Directory/Git 凭证前经 Foundation Console session bridge 建立 verified uid；所有兼容路由均先受此保护，目录关系读取精确 self-bind，用户详情/列表/批量、部门与项目注册表保留为已登录协作目录投影。Git Markdown tree/file 路由新增必填 `aimsProjectId`，以受信 uid + scoped tenant-runtime 验证项目成员/管理员与 `aims_project_repos` 精确关联后才调用 Git 集成；缺项目为 400、错成员/仓库为 403、runtime 不可用为 503 且不触发 Git。前端 picker/preview/import 传递既有项目 ID；未新增 Account 功能、provider 或 fallback，Console 401/403 继续 fail-fast。新增 `aims/docs/Aims-Legacy-Directory-Compatibility-API.md` 与静态契约测试；未执行外部访问、迁移、部署、真实租户或提交。

2026-07-11 G6-2 Altoc legacy Account-named Directory BFF P1：审计确认 Altoc 的八个 `/api/account/**` 兼容路由均经 Foundation Console Directory adapter，未调用 legacy Account 也无 fallback；但此前未经过只覆盖 `/api/v1/**` 的会话 middleware，目录配置、用户、部门、项目和关系读取可匿名触发应用 Directory 凭证，`user-departments?uid=` 与 `users/{uid}/projects` 还可跨主体读取。现 `requireAltocSessionUid` 会在使用配置或 Directory adapter 前通过 Foundation Console session bridge 取得当前 uid，所有八条兼容路由均先受保护；关系读取将 supplied uid 精确绑定到会话 uid，`user-departments` 省略 uid 时也固定读取当前用户，不再发起无范围关系请求。一般用户/部门/项目目录展示保留为已登录协作投影。新增 Altoc 兼容 API 契约与静态测试，未新增 Account 能力、provider、fallback 或外部操作；验证结果在本次任务记录中补充。

2026-07-11 G6-2 Assets legacy Account-named Directory BFF P1：审计确认 Assets 的八个 `/api/account/**` 兼容路由均通过 Foundation Console Directory adapter，未调用 legacy Account 且无 fallback；但这些路径不经过仅覆盖 `/api/v1/**` 的会话中间件，配置、用户、部门和项目目录读取可匿名使用应用 Directory 凭证，`user-departments?uid=` 与 `users/{uid}/projects` 还可由浏览器指定其他 UID。现 `requireAssetsSessionUid` 在读取配置或调用 Directory adapter 前经 Foundation Console session bridge 建立 verified subject；所有兼容路由先受保护。关系读取精确 self-bind，`user-departments` 省略 uid 时也固定为当前用户；一般目录展示继续作为已登录协作投影。新增 `assets/docs/Assets-Legacy-Directory-Compatibility-API.md` 与静态契约测试；Assets lint/typecheck、68 项 Node tests、Assets/根 diff-check 与根 `release:check --allow-dirty` 通过。未新增 Account 功能、provider、fallback 或外部操作，未部署、迁移、真实租户访问或提交。

2026-07-11 G6-2 Workflow legacy Account-named Directory BFF P1：审计确认 Workflow 的六个 `/api/account/**` 兼容路由（配置、部门、用户、用户批量与用户部门关系）均使用 Foundation Console Directory adapter 或其本地组合 helper，未调用 legacy Account、未读取 `HZY_ACCOUNT_*`，也未保留 fallback；但此前不经过仅覆盖 `/api/v1/**` 的会话 middleware，配置和目录读取可在未验证会话下使用应用凭证，`user-departments?uid=` 还允许跨主体关系读取。现 `requireWorkflowSessionUid` 会在读取配置、请求 body 或调用 Directory adapter 前经 Foundation Console session bridge 建立当前 subject；所有六条路由先受保护。`user-departments` 将 supplied uid 精确绑定到当前会话，省略 uid 时固定读取当前用户；通用用户/部门展示保持为已登录协作目录投影。新增 `workflow/docs/Workflow-Legacy-Directory-Compatibility-API.md` 与静态契约测试，明确 Console `401/403` fail-fast、不可用不回退 Account。Workflow lint、typecheck、44 项 Node tests 与根/Workflow diff-check 通过；根级 `release:check --allow-dirty` 也通过（仅保留 draft release、dirty worktree 与 signing key 未锁定警告）。未新增 Account 能力、provider 或外部操作，未部署、迁移、真实租户访问或提交。

2026-07-11 G6-2 Foundation Account/Directory 成员关系 BFF P1：审计确认 Foundation 的 `/api/account/dept-members`、`/api/account/user-departments` 及其 `/api/directory/**` 标准等价路径仅由 `UserTreeSelector` 浏览器 `$fetch` 消费，不是 service/internal 合同；此前入口会直接使用应用的 Console Directory adapter，完全无会话请求可触发成员或全量 `uid↔dept` 关系读取。新增 `requireFoundationSessionUid()`，在所有四条成员关系 BFF 调用 Directory adapter 前只接受已验证的 Console `subjectType=user` 会话（含经 `auth/me` 确认的 legacy session bridge），匿名与 service identity 均返回 401。`deptCode` 是目录树的选择条件；`user-departments` 是已登录协作目录的全量树投影而非 self-service 用户关系接口，故保留其无 uid 全量语义且不把浏览器 uid 当作 actor。未新增 Account 能力、provider、fallback 或服务契约；`FOUNDATION_CAPABILITIES.md` 已同步边界，新增四路径调用顺序与 identity fail-closed 静态回归。Foundation lint、typecheck、164 项 Node tests 与 diff-check 通过；未执行部署、迁移、外部访问、真实租户写入或提交。

2026-07-11 G6-2 Console Account-named Directory compatibility audit P1：审计确认 Console 的 14 条 `/api/account/**` 路由均直接读取 `directoryRuntime` 或 `runtimeCompat`，不再反向代理、调用或降级到 legacy Account；但 Foundation 通用认证中间件对无 token 请求不会拒绝，而这些兼容路由此前没有本地会话或逐资源权限检查，匿名请求可读取 Console 目录，`accessible-departments?uid=` 与 clipboard query/body UID 还可指定其他用户。现目录兼容读取与正式 `/api/v1/directory/**` 保持同一 `directory_users|directory_departments|directory_projects:view` 边界，先建立本地 verified Console session；`config-check` 也要求已登录。`accessible-departments` 与 clipboard 改为精确 self-bind 当前 session UID，clipboard 写入在读 body 后覆盖为可信 UID。新增静态契约回归和 Console 迁移状态文档，未新增 Account 能力、provider、fallback、服务 API 或外部操作；验证结果见本次任务记录。

2026-07-11 G6-4 Console legacy Account env 示例收口 P1：审计 `console/.env.example`、`console/.env.dev.example` 以及 Console 代码、脚本、测试和有效运行文档后，确认 `HZY_ACCOUNT_API_URL`、`HZY_ACCOUNT_API_KEY`、`HZY_ACCOUNT_API_SECRET` 没有任何运行时消费；Console 的 `/api/account/**` 只读取本地 Directory/runtime compatibility 表，不会调用、代理或回退 legacy Account。现从两个示例移除这三项，并在 Console Account 迁移状态与环境变量收敛方案中明确 legacy Account 仅是显式 directory-sync 导入源。未修改真实 env、未新增 Account 能力或 fallback，未部署、迁移、外部访问、真实租户操作或提交；验证结果见本次任务记录。

2026-07-11 G6-1 Altoc/Assets direct WeCom callback 边界 P1：审计确认两模块 `/api/auth/wecom-callback` 在默认 Console OIDC 模式仍会读取浏览器 `code`、调用 Foundation WeCom integration、写 legacy `token/auth_user` cookie 并写旧登录审计。现复用模块既有 `isLegacyAuthEnabled`，仅在显式 `HZY_AUTH_MODE=legacy` 或 `HZY_LEGACY_AUTH_BRIDGE=true` 时保留这些兼容行为；默认模式在 handler 第一项即返回 410，先于 query、WeCom、cookie 和 audit。新增两个静态调用顺序回归，模块认证/API 兼容文档已同步。未执行真实 OAuth/WeCom、凭据操作、部署、迁移、外部访问、真实租户写入或提交；验证结果见本次任务记录。

2026-07-11 G6-1 Foundation CAS legacy bridge 边界 P1：审计确认 Foundation 的 `/api/auth/cas-login` 与 `/api/auth/cas-callback` 此前在默认 Console OIDC 模式仍可读取浏览器 query/ticket、构造 CAS 回调、请求 CAS、查询旧 Account、写 legacy Cookie 并上报登录审计。现复用 Console OIDC 配置中的显式 legacy 事实，仅 `HZY_AUTH_MODE=legacy` 或 `HZY_LEGACY_AUTH_BRIDGE=true` 可继续执行 CAS 兼容链路；默认模式（包括缺少 Console issuer）在 handler 第一项返回 `410`，先于 request 参数、重定向、网络、Account、Cookie 和 audit。新增 Foundation 静态调用顺序回归，更新 Legacy Auth Bridge 与能力文档；未执行真实 CAS/Account、凭据操作、部署、迁移、外部访问、真实租户写入或提交；验证结果见本次任务记录。

2026-07-11 G6-1 Workflow/Codocs direct WeCom legacy login 边界 P1：审计确认 Workflow `/api/auth/wecom-callback` 会读取浏览器 `code`、调用 Foundation WeCom integration 并写 legacy cookie，`/api/auth/wecom-login` 也会读取 query、解析 WeCom integration 后跳转；Workflow 原 `isLegacyAuthEnabled` 还会在缺少 Console issuer 时隐式放行。Codocs 历史 `/api/wecom/oauth` 则会执行 code→WeCom userid/detail→Account/Console Directory 用户匹配→多项 legacy cookie 的完整登录链路且此前无保护。现 Workflow 及 Codocs 直连 WeCom 登录/回调均仅在显式 `HZY_AUTH_MODE=legacy` 或 `HZY_LEGACY_AUTH_BRIDGE=true` 时可用，默认在读取 query、调用 WeCom/Directory、写 cookie 或审计前返回 `410`；Workflow 不再以缺 issuer 作为 legacy 回退。`/api/wecom/verify`（`/WW_verify_*.txt` 代理）只返回可信域名验证文本、不读取 OAuth 参数、不换取身份也不写会话，故保持不受登录开关限制。新增调用顺序和无隐式回退回归，Workflow 47 项、Codocs 111 项 Node tests 以及两模块 lint/typecheck 通过；未执行真实 OAuth/WeCom、凭据操作、部署、迁移、外部访问、真实租户写入或提交。

2026-07-11 G6-1 Aims/Altoc/Assets/Codocs direct WeCom login 发起端边界 P1：审计确认四模块的历史 `GET /api/auth/wecom-login` 虽然 callback 已要求显式 legacy bridge，但发起端在默认 Console OIDC 模式仍会读取浏览器 query、解析应用 WeCom integration 并重定向至企业微信。现四路由均复用模块既有 `isLegacyAuthEnabled(event)`，只有明确 `HZY_AUTH_MODE=legacy` 或 `HZY_LEGACY_AUTH_BRIDGE=true` 时才可保留旧发起链路；默认模式在 handler 第一项即返回 `410`，先于 query、integration、redirect 和任何外部 OAuth 交互。Console OIDC 主登录与显式 legacy flow 不变。新增四模块静态调用顺序回归，并同步各模块兼容/API 文档；未执行真实 OAuth/WeCom、凭据操作、部署、迁移、外部访问、真实租户写入或提交。

2026-07-11 G6-2 Finance tenant-runtime actor/data-scope P1：Terra 审计确认 Finance 未使用通用 runtime router，generic `ListResourceSpec`/`DetailResourceSpec`、项目/费用/绩效读取及普通 mutation 在 Bearer 认证后曾直接消费浏览器 query/body 的 `current_user` 与 `current_user_*_access` 范围；缺范围还能退化为 service/all，持有 runtime bearer 的调用方可伪造项目、部门、责任关系。现 Finance 普通用户路径要求与完整 HTTP request target HMAC 绑定的 actor delegation，只有已验签 BFF 传递的 Finance scope 能保留；无 delegation 在 adapter/SQL 前返回 403。mutation 会删除 body 中同名 actor/范围后仅从受签名 query 重建。`/service/**`、Workflow callback 与 scheduled notification 专用合同继续允许 actorless service/worker 调用，但 runtime 清除伪造 Finance actor/range，绝不把 service client subject 作为用户。新增 server/Finance 契约覆盖未签名拒绝、签名范围保留和 actorless service 清洗；Tenant Runtime、MODULE_CONTRACTS 与 Finance 设计已同步。未执行真实 DB、部署、迁移、外部访问或提交。

2026-07-11 G6-2 WebDev tenant-runtime actor/Issue tenant boundary P1：Terra 审计确认 `isWebDevRuntimePath` 在 Bearer 认证后曾把 raw query/body 直接交给 adapter；jobs 会消费 `createdBy`，Issue 列表/设置/创建会消费浏览器 `tenant`，Issue 创建会消费 `reporterUid`，更新/领取/events 会消费 `actor`，因而持有 runtime bearer 的调用方可伪造审计/创建者并跨 tenant 读取或修改 Issue。现普通 `/v1/webdev/**` 路径均要求与完整 request target 绑定的 HMAC actor delegation；server 在 adapter 前重建 actor、tenant/deployment/source context，覆盖 user-created job 的 `createdBy`、manual Issue 的 reporter/actor 与自报 tenant。Issue 列表、详情（含 events）、创建、更新、领取、events、settings 均只使用注入 tenant。已验证上游 Console service token 的上报/“我已提报”及 intake 自动领取所需 settings/read/claim/patch/job persistence 改为逐条固定的 `/v1/webdev/service/**` bridge；不将 service client subject 当 user actor，亦未开放通用 service allowlist。新增 Go 行为契约与 WebDev Node 路由/签名契约；data-runtime 全量 Go、WebDev lint/typecheck/17 项 tests 通过，Tenant Runtime API、MODULE_CONTRACTS、WebDev Issue design 已同步。WebDev jobs/projects/agents 当前 schema 没有 tenant 列，未伪称其已具备 row-level tenant filter，仍由已验证 WebDev BFF 应用/项目授权边界控制。未执行真实 DB、service、部署、迁移、浏览器或提交。

2026-07-11 G6-2 Finance due-notification scheduled runtime identity P1：Terra 审计确认 `POST /v1/finance/service/notifications:scan-due|acknowledge|acknowledge-closure` 曾绕过 Finance 通用 actor 路由，仅以 `appCode=finance + finance.write` 进入 runtime 和 checkpoint SQL；JWT 的 tenant/deployment/app 校验存在，但持有同租户普通 Finance runtime write token 的调用方仍可触发扫描、确认通知或伪造 closure ack。现三路由只接受 Console 签发的短期 `sub=client:finance.runtime` JWT、精确 `data-runtime:finance:notifications_due:execute` grant、enrollment tenant/deployment 与 request-target HMAC purpose `finance-due-notification-worker`，static/disabled auth、`finance.write`、其他 service client、缺失或错 purpose 均在 adapter/SQL 前拒绝。scan/ack/closure ack 各自实施固定 body allowlist，拒绝 actor、tenant 或其他生命周期字段。Finance Cloudflare task 改为使用专用 caller，拒绝 static runtime token、要求 `HZY_FINANCE_SERVICE_CLIENT_ID=finance.runtime`、申请精确 scope 并生成同一 HMAC；普通 integration-operation scheduler 不受影响。新增 secret-free Console v1.48 grant/verify（仅 `finance.runtime`）及 Go/Node 合同测试，并同步 Finance、MODULE_CONTRACTS 与 Tenant Runtime 文档。未执行 SQL seed、部署、迁移、真实 runtime/tenant、secret 或外部访问。

2026-07-11 G6-2 Aims/Altoc/Assets/People due-notification scheduled runtime identity P1：横向审计确认四模块的 `service/notifications:scan-due|acknowledge|acknowledge-closure` 原先都经过通用 app runtime router，仅要求相应 `*.write`，调用侧同样没有固定 worker identity 或 request-target HMAC；因此持有同租户模块 write token 的其他服务调用方可触发通知 checkpoint 生命周期。现四模块均采用与 Finance 一致但各自独立的封闭 worker 合同：仅 `sub=client:<app>.runtime` 的短期 JWT、精确 `data-runtime:<app>:notifications_due:execute`、tenant/deployment enrollment 与每模块固定 purpose HMAC 可访问；通用 write/static/disabled、错误 client、未签名或错 purpose、body 伪造 actor/tenant/lifecycle 字段均在 adapter/SQL 前拒绝。Cloudflare 渲染只在 due flag 开启时要求 `<app>.runtime`，Node drain 申请精确 scope 并生成 HMAC；Aims、Altoc、Assets、People 的其他 scheduled operation 不被扩大或改动。新增 v1.49 secret-free grant/verify、Go 正反向服务契约、模块静态回归，并同步 MODULE_CONTRACTS；未执行 SQL seed、部署、迁移、真实 runtime/tenant、secret 或外部访问。

2026-07-11 G6-1 长期路线与通知运行手册事实边界：审计 `docs/` 中非历史、非 API/schema/ADR 且未标示证据边界的长期路线/运行文档；除已具等价横幅的计划外，为 `Huizhi-yun-Integrated-Operations-Roadmap.md`、`Huizhi-yun-SaaS-Product-Shape-and-Implementation-Path.md`、`Huizhi-yun角色授权模型改进实施方案.md`、`notification-runtime/docs/Notification-Runtime-Deployment.md` 与 `notification-runtime/docs/Notification-Runtime-Tenant-Runbook.md` 补充最后事实核验日期、当前代码/契约事实源和外部动作逐项授权边界。产品/角色路线明确目标或阶段性代码证据不等于已部署、bundle 物化或真实权限验收；通知文档明确其命令会改变客户服务器、DNS/SSL、数据库、Console grant/service client、企业微信及 Cloudflare/R2 状态，离线文档核对不代表已上线或取得执行授权。未修改正文业务方案、API/schema/ADR、Insights/Align 或业务代码，未启动服务、执行部署、迁移、seed、R2、live probe、真实租户、secret 或 OAuth 操作。

2026-07-11 G6-1 余留执行/部署手册事实边界：补审仍在导航入口或可执行流程中使用、但尚缺完整日期/事实源/逐项授权说明的 `Huizhi-yun-Deployment_Guide.md`、`Huizhi-Yun-Cloudflare部署指南.md`、`webdev/docs/WebDev-PoC-Runbook.md`、`console/docs/Console-Policy-Authorization-Acceptance-Runbook.md` 与 `Implementation-Backlog.md`。横幅分别指向当前 Cloudflare/Tenant Gateway、Data Runtime、WebDev/Dev Agent、验收脚本、主执行清单/路线/契约；统一明确文档、离线核对或历史完成标记不是部署、bundle、会话或真实租户验收证据，Cloudflare/DNS/secret/R2、migration/seed、Agent、角色或 subject 变更、真实会话/live acceptance 和回滚均须按目标环境逐项授权。未改 API/schema/ADR 或业务正文，未触及 Insights/Align，未启动服务、执行部署、迁移、seed、R2、live probe、真实租户、secret 或 OAuth 操作。

2026-07-11 G6-2 Platform enterprise-role permission editor split P1：由 Luna 提取 `EnterpriseRolePermissionEditor.vue`，承接企业角色默认应用权限的按应用分组、角色勾选、权限明细展开及保存意图；组件仅接收显式 `roleCode`、`roleName`、应用角色、baseline 权限和 saving props，并通过具名 `selectedAppRoleCodes` model 与 `save` emit 协作。`enterprise-roles.vue` 继续独占角色筛选/选择、详情加载、选中状态、保存 API、提示和路由，既有 `BaselinePermissionEditor.vue` 仍只管理登录用户 baseline 权限与排除用户，不发生职责重叠。新增页面接线、无 fetch、角色切换清理展开状态及不重叠 baseline editor 的边界回归；Platform Node 184 项测试、lint、typecheck 与 diff-check 通过。未启动认证服务，故尚无 1440px/390px 浏览器验收；未部署、迁移、提交或触及 Insights/Align。

2026-07-11 G6-2 Workflow runtime Admin 配置域拆分 P1：由 Terra 将 `/v1/workflow/admin/**` 的 action-def、flow-schema、form-schema、route 配置路由簇及其仅域内筛选、分页、JSON 更新辅助函数从 `data-runtime/internal/apps/workflow/runtime.go` 提取至 `runtime_admin.go`。审批实例、任务动作、事务、共享 SQL/result helper 与 `HandleRuntime` 的既有分发保持原边界；所有 Admin 路径、SQL、operation 名称、错误 envelope 和 templates 优先于 flow-schema detail 的路由顺序保持不变。新增 SQLMock 路由回归覆盖 action-def list 的兼容分页 envelope/operation、templates 精确优先级和未知 Admin 路径的 not_found。`go test ./internal/apps/workflow`、`go vet ./internal/apps/workflow` 与 `git diff --check` 通过；全量 Go 门禁由主线程统一执行。未新增 schema/API，未执行迁移、部署、真实数据库、服务或提交。

2026-07-11 G6-2 Workflow runtime 实例读取域拆分 P1：将 `GET /v1/workflow/instances/{id}`、`by-biz` 与 `by-biz-history` 的只读路由、参与者可见性和 trusted actor delegation 从 `data-runtime/internal/apps/workflow/runtime.go` 提取至 `runtime_instances.go`；取消/重新提交写事务、流程推进和共享实例投影 helper 保持在原边界。新的实例读取分发保留 business lookup 在通用 detail 前的优先级，因此 `by-biz*` 继续要求 delegated actor，不会被路径 detail 处理绕过；路径、SQL、operation 和错误 envelope 未改。新增 SQLMock 路由回归固定 delegated lookup 的参数/空值 envelope，并覆盖 history 缺 delegated actor 的 403 与未知嵌套路由的 not_found；原有安全静态回归随领域文件移动。`go test ./internal/apps/workflow`、`go vet ./internal/apps/workflow` 与 diff-check 通过。未新增 schema/API，未执行真实 MySQL、BFF、迁移、部署、服务或提交。

2026-07-11 G6-2 Workflow runtime 实例生命周期写入域拆分 P1：将既有实例的发起人写操作 `POST /v1/workflow/instances/{id}/cancel` 与 `resubmit` 从 `data-runtime/internal/apps/workflow/runtime.go` 提取至 `runtime_instance_writes.go`。二者以 `flow_instances` 为事务主语，保留原有行锁、发起人和状态/配置校验、任务取消、`flow_actions` 记录、actionable lifecycle outbox、通知、callback、重建首节点和自动审批调用；任务 approve/reject/delegate、只读实例、服务/通知路由及共享 SQL/流程推进 helper 不跨域移动。`HandleRuntime` 分发、路径、SQL、operation 名称和错误 envelope 均保持不变。新增 SQLMock 路由回归覆盖两条 POST 路由的零 DB 缺 actor 401，以及 cancel 的显式事务入口与 `instance_not_found` envelope。`go test ./internal/apps/workflow`、`go vet ./internal/apps/workflow` 与 diff-check 通过。未新增 schema/API，未执行真实 MySQL、BFF、迁移、部署、服务或提交。

2026-07-11 G6-2 Codocs generic runtime fallback P0：审计确认 middleware 的 generic 映射会先于本地 BFF 截获 `/api/dept-shares` 的 GET/PATCH、`/api/dept-cabinet/folders` 的 GET 和 `/api/reviews/templates` 的 GET；Go compat adapter 也将这些资源及 `cabinet/folders` 注册为无 actor/owner/部门范围的通用 CRUD，runtime service subject 可成为越权后门。现三类用户态路径均退出 generic 映射：部门柜目录读取在 BFF 先要求 `requireRequestUid`、`documents:view` 与 `requireDepartmentReadAccess`，清除浏览器 actor/owner/dept/marker 后仅以 Foundation request-target 签名的精确部门 marker 查询；部门移交继续本地经理核验与通知编排，runtime 只接受 signed actor，列表/更新按经理核验后的目标部门 marker 收口；审阅模板继续要求登录与 `reviews:submit`，runtime 也要求 signed actor。未证实消费者的个人 `cabinet/folders/**` CRUD，以及尚缺 manager-bound command 的部门柜目录写入，均改为 `503 cabinet_folder_scope_contract_required`，不猜测委托语义。新增 Node/Go 回归覆盖本地 BFF 重新接管、匿名零 SQL、精确部门 SQL、template actor 拒绝、dept-share 更新缺经理 marker 拒绝与 cabinet generic 503；未执行真实数据库、租户、迁移、部署、OSS 或提交。

2026-07-11 G6-2 Codocs generic scope sweep 第一阶段 P0：审计确认 `document-shares`、`document-versions`、`annotations`、`annotation-replies` 与 `issue-comments` 仍注册为 compat generic ResourceSpec，但它们已有文档、批注或问题父对象绑定的专用 runtime/BFF 路由；generic 表路径无法重建父对象 ACL，且当前没有 direct BFF consumer。现从 compat ResourceSpec 移除五类资源，并在 Codocs Adapter 的 generic fallback 前对其全部 list/detail/create/update/delete 直达形态统一返回 `503 scoped_resource_contract_required`，保证零 DB。Codocs middleware 显式固定五类 `/api/**` 前缀不进入 generic runtime mapping；既有嵌套 document/annotation/reply/share/issue 路由不变。新增 Go SQLMock 零 DB 路由回归及 Codocs 静态映射契约，CODOCS API spec/MODULE_CONTRACTS 已同步。未执行真实数据库、租户、迁移、部署、OSS 或提交。

2026-07-11 G6-2 Codocs cabinet scoped mutation P0：个人/部门文件柜原先仍通过兼容 generic `cabinet_files` 写入，runtime 无法将上传人、文件 owner、部门经理或目标部门绑定到 SQL；body 的 `owner_uid/dept_code/project_code/status` 可成为跨范围写入入口。现个人 POST/PATCH/DELETE 统一要求 Foundation 签名 delegated actor，创建强制 actor owner 且 `dept_code/project_code` 均为空；更新只允许 filename/folder，删除以 owner 谓词原子设置 `status=0 + deleted_at`。部门 BFF 保留既有 `requireDepartmentManagerAccess`，核验后清洗浏览器输入并写入 request-target HMAC 覆盖的精确 manager marker；runtime 以该 marker 约束创建/更新/删除，强制 `project_code IS NULL`，不再信任 body 部门、owner 或状态。转文档的 `converted_doc_uuid` 使用独立 owner/manager-bound command，未混入普通 PATCH；folders/publish 不在本次变更范围。个人/部门 OSS 顺序保持原行为（metadata 后 best-effort recycle），不声称跨 OSS/DB 原子性。项目柜尚无 Aims exact source、细 capability 和签名 project assertion，直接 runtime PATCH/PUT/DELETE 与 Codocs DELETE BFF 统一 `503 project_cabinet_mutation_contract_required`，未执行 grant/manifest/seed。新增 Go SQLMock/Node boundary 回归，CODOCS API、MODULE_CONTRACTS 同步；未执行真实 OSS、数据库、迁移、部署或提交。

2026-07-11 G6-2 Codocs generic document service reads P0：审计确认 `GET /api/v1/documents/search` 与 `POST /api/v1/documents/batch-summary` 仅要求宽 `codocs:documents:read`，前者可由空/任意筛选查询全租户文档，后者按调用方 UUID 直接读取；runtime 均无 actor、project marker 或 document ACL 谓词，`/api/v1/codocs/**` alias 同样可达。现 BFF 两端点和 alias 都在读取 query/body、校验普通 service scope 或转发 runtime 前返回 `503 scoped_document_service_contract_required`；data-runtime 的两条 direct 路由亦在 adapter 前置同一错误和 operation，保证不能绕过 BFF。保留的 summary/content/url/create 未在本轮扩大或伪称安全，下一阶段需按 Aims 项目/部门与 Altoc 实体关联事实落地 source-bound signed service-command。新增 Codocs Node 与 Go SQLMock 零 DB 路由回归，`pnpm test`（119 项）、Codocs lint/typecheck、data-runtime `go test ./...` / `go vet ./...` 与各仓 `git diff --check` 均通过；契约/API 文档同步。未执行真实 service、数据库、部署、迁移、OSS 或提交。

2026-07-11 G6-3 Altoc 既有 Codocs UUID 关联 P0：审计确认 `POST /api/v1/documents` 在 `document_uuid` 非空时，曾以宽 `codocs:documents:read` 调摘要接口确认 UUID 存在，再将其写入可编辑 Altoc 实体的 `document_link`；实体预览随后只验证 Altoc link，可能形成对任意已知 Codocs UUID 的 confused-deputy 内容暴露。现该既有 UUID 分支在任何 Codocs 读取或关联写入前返回 `503 scoped_document_attach_contract_required`；新建文档并关联的独立分支未扩大。Altoc 集成文档、跨模块契约与静态回归同步；恢复前必须先明确实体/link/doc 类型语义及 Codocs 原始 ACL，并落地 source-bound signed service-command。未执行真实 service、数据库、部署、迁移、OSS 或提交。

2026-07-12 清单状态复核：排除 Insights/Align、真实部署/迁移/seed/live/secret/OAuth 与仅缺浏览器证据的项后，当前没有尚未实现且可无产品授权直接落地的 P1/P2 代码项。原 G3 P2 已有离线实现（People 安全 keyset continuation、Console 操作时间线与 DTO 白名单/双权限边界），故拆分为已完成的离线实现与待授权会话浏览器/真实操作证据；不以复选框滞后为由重复建设。Codocs 跨模块正文读取与 Altoc 既有 UUID 关联恢复仍需明确来源事实是否构成 Codocs ACL 授权主体，未在缺少该决定时扩展宽 service scope。

2026-07-12 B/D/F/H 授权语义落地记录：B 已将 Aims 项目成员/精确 `project_documents.codocs_uuid` 或文档型 deliverable 关联，与 Codocs active `project|git-project`、精确 project code、原 owner/share/relation ACL 取交集；Aims 首跳使用刚签发的短期 `aud=codocs` token 对 method/path、tenant/deployment、来源/目标、固定 command envelope、hash 与 request ID 做 60 秒 HMAC，Codocs 验证后才以自身 runtime bearer 重签。F 已要求 Altoc 实体 `view`、持久化精确 link 和 Codocs 原 read ACL 三者同时成立；H 已要求 Altoc 实体 `edit` 与 Codocs owner/write-share ACL，并保持同实体/UUID 关联幂等。D 因创建前不存在不可变且可审计的 `project_proposal` 分类事实而保持 `503 department_project_proposal_classification_required`，不读取 Codocs；解除前须完成受控分类迁移及专用双重 ACL 合同。B/F/H 对应的 Console v1.52/v1.53 seed/verify 已写为待批准文件，未执行。离线门禁通过 Foundation 170、Aims 193、Altoc 全量、Codocs 128、相关 Go test/vet、typecheck 与差异检查；Aims Cloudflare `verify:cloudflare-deploy` dry-run 通过。Codocs 同一 dry-run 在既有无关 `reviews/publish-requests/[id]/workflow-instance.post.ts` 两条 ESLint 错误前停止，未部署、未执行 SQL/seed/migration、未触碰 Insights/Align。

2026-07-12 生产授权预检：已在生产 `hzy_console` 应用 v1.52/v1.53 seed 并执行配套 verify。v1.52 已为 active Aims client 写入 `codocs:project-document:content:read`；该 client 尚无 `current_credential_id`，故仍不能签发 token。v1.53 未影响行，因为生产不存在 `app_code=altoc, client_code=altoc` 的 service client；两项 Altoc capability 均未生效。为保护现网，不在缺 credential、缺 Altoc client 或缺 data-runtime 新路由时发布 Worker。已按授权修复 Codocs publish-request 文件的两处 lint 格式问题；Aims、Altoc、Codocs 的 `verify:cloudflare-deploy` 均完成 build 与 Wrangler dry-run。真实发布还需由 Console 受控 secret/bootstrap 建立精确 `aims`、`altoc` service client credential，并先发布 data-runtime 的 Codocs B/F/H 路由到目标 tenant Agent；这些步骤不使用数据库 root 密码替代 Vault/运行时发布权限。

2026-07-12 Cloudflare Console Directory → Platform 主体同步补齐：Platform 新增 tenant-bound internal subject sync 入口，只接受已通过统一内部 token 鉴权的 `console-managed-cloud-worker`，并按可信 tenant/environment/deploymentCode 查找 active Console deployment；body 不能覆盖租户边界。旧 runtime-token 入口与新 managed-cloud 入口复用同一主体/membership 入库事务。Console 的 LDAP/Account/企业微信/钉钉/GitLab 与手工 subject 同步完成后自动推送最小主体投影，目录页提供“同步到 Platform”重试；推送失败会把目录任务标记为 `partial_success` 并记录失败事件，不包含姓名、邮箱、手机等目录 PII。Platform lint、typecheck、192 项 Node tests、prod build，以及 Console lint、typecheck、280 项 Node tests（1 项临时 MySQL 测试按既有规则跳过）、Cloudflare build/Wrangler dry-run 均通过。经用户确认 Platform 已迁到 Cloudflare 并授权一并发布，生产已部署 `hzy-platform` 版本 `dab35a42-398e-4e84-8be2-085f435dcfc0` 与 `hzy-console-prod` 版本 `ecd11d53-a414-4547-b73f-56732e18f997`；`huizhi.yun/api/health`、Console canonical home 与 wiztek tenant home 均返回 200，subject sync internal path 无凭证返回预期 403。生产验收时发现 183 个目录主体推送超过 Console 原 15 秒请求上限，页面任务虽记录 `partial_success`，Platform 事务仍可能继续完成；现已将 managed-cloud/runtime 两条主体同步请求统一放宽到 60 秒，并部署 `hzy-console-prod` 版本 `44cd857e-11a4-4537-add4-a61f127572a6`。Console lint、typecheck、283 项 Node tests（282 通过、1 项临时 MySQL 测试按既有规则跳过）、Cloudflare build/Wrangler dry-run 均通过。新增 LDAP uid `liukai` 已在 Platform 显示为正常用户，membership 为 `MC / member / primary`，“角色授权”对话框可正常打开；当前生效角色为 0，本次验收未代管理员保存任何授权。最终浏览器检查 Console 与 Platform 均无 error 级控制台日志。

2026-07-12 Console 应用入口误回个人资料修复：Console 当前应用目录不再把租户工作台根路径当作控制台入口；`console` 固定使用 `/admin`，仅对有效 `console_overview:view` 用户返回，bundle 不可用时不再把控制台入口作为未授权 fallback。Foundation 上次访问恢复明确隔离 Console 工作台 `/profile`、`/settings/profile`、`/todos`、`/approval/**`，这些页面不能覆盖控制台 `/admin`，目录/运行时/管理深链仍可恢复。Console 全量 lint/typecheck、282/283 Node tests（1 项既有临时 MySQL 测试跳过）、Foundation 定向 lint/typecheck 与 10 项路由记忆测试通过；Cloudflare `hzy-console-prod` 已发布版本 `e66f9993-a9ff-4e76-ae9b-ba0a611832cc`。生产 Chrome 从 `/profile` 打开应用列表时“控制台” href 已为 `/admin`，点击后落到管理概览且浏览器控制台无 error。

2026-07-14 跨应用审批中心首次加载与任务读取 P0：修复共享 Foundation 审批菜单等待待办计数返回后才出现的问题；非 Workflow 应用现在先直接显示“审批中心”，计数异步补充。业务应用的 Workflow proxy 改为解析租户无关的 Workflow service origin，并由可信 gateway 上下文申请目标 Workflow deployment 的短期 service token；`service-client-policy` 允许经过 Console 策略授权的跨 deployment 调用，同时保留 tenant、source app、target app 和 request-target actor 约束。Workflow 的只读 GET 不再触发 actionable lifecycle outbox drain，避免一次成功任务查询被来源应用 deployment 的旧 outbox 身份覆盖为 `deployment_mismatch`；任务接口失败时页面明确显示错误和重试，不再伪装为空列表。Foundation 188 项、Aims 194 项、Workflow 49 项及 Console 300 项 Node tests（1 项既有跳过）通过，相关 lint/typecheck 通过。生产已发布 Aims `971cab73-a7e6-4438-b40b-f113810498af`、Workflow `8649e21b-01a0-47ee-8b68-e30955cb1f82`、Console `4a037a03-6af1-4c0e-98d3-752b5881eb46`、Codocs `3c60e179-5894-49f3-bc09-f86ce4ed6aca`、Altoc `8b443e3c-03ec-4754-b792-5072291e8ae0`、People `41a83ff6-3e24-4654-866e-2a847cc66dd9`、Assets `fb39ef99-1e57-423f-bbad-1acdce1b1f37` 与 Finance `6f064238-c3c1-4e35-8fbd-0d8e547ac086`；按用户要求未处理 WebDev。已登录生产 Chrome 分别验收 Aims 与 Codocs，审批菜单首次页面加载即存在，最近同步不到 1 分钟，真实任务为待办 2/2、已办 10/83、我发起的 10/64，无空列表兜底或加载错误。

2026-07-15 Enterprise Connector Runtime Phase 2（企业登录并行提供方）：Platform 的租户部署设置新增 `consoleLogin.enabledProviders`，以 `mode` 表示默认登录方式、以显式列表表示实际启用的 OIDC/CAS/企业微信/钉钉提供方；缺失该字段时继续按旧语义只启用 `mode`。Tenant Gateway 仅从受信注册表投影提供方列表和公开标识，继续删除客户端伪造头且不投影 CorpSecret/AppSecret；Console 登录页在多个提供方启用时展示选择卡片，在企业微信客户端内优先企业微信，所有 provider start/callback 均再次 fail-closed 校验启用状态。Platform 217/217、Console 329 pass + 1 环境 skip、Tenant Gateway 20/20，双方 lint/typecheck 与 Cloudflare build/dry-run 通过。生产已发布 Platform `bd2b5cce-b343-4da3-a4ab-7d7bf9e02c93`、Console `15494de3-5816-4ab1-92c4-9352ddf5937d`、Tenant Gateway `042413bc-61a7-4d5c-96e6-dd6300b4922a`；Gateway 注册表缓存键提升到 v2，避免旧响应结构在 Cache API 中滞留。wiztek `C000001/prod` 保持 OIDC 默认并启用 OIDC + 企业微信，Corp ID/Agent ID 复用现有 `wecom.default` 非敏感配置，供应商凭证未离开 Vault/Connector Runtime。新策略包 `pv_prod_20260715032650_0077`（policy revision 12，9 targets）已生成；公网 `/api/auth/login-config` 返回双提供方，OIDC 跳转 `sso.wiztek.cn`，企业微信桌面端跳转 `open.work.weixin.qq.com`、企业微信客户端跳转 `open.weixin.qq.com` 的 `snsapi_base`，均携带一次性 state。伪造 callback state 在 Connector 调用前返回 400，并仅写入脱敏失败审计。新增 `accept:enterprise-login` 可重复验收 CLI 与 5 项单元测试，默认只读配置，只有显式 `--probe-starts` 才创建短期登录事务，`--probe-invalid-state` 还需二次显式开启。真实企业微信扫码 callback、外部身份绑定和禁用用户失败关闭仍待人工扫码完成后记录；钉钉生产无 integration/credential，身份开关保持 false，直接登录返回 503。

2026-07-15 Enterprise Connector Runtime 0.4.6 幂等证据升级：Runtime 的通知成功响应新增非敏感 `replayed` 字段，首次供应商投递为 `false`，相同 tenant/deployment/sourceApp/idempotencyKey 且相同 canonical request hash 命中 durable success ledger 时为 `true`；不同 payload 继续返回 409。Console 企业微信测试在 Connector 模式下自动以完全相同请求做第二次调用，只有第二次明确返回 `replayed=true` 才报告“幂等重放已验证”，且证据失败不会把第一次真实成功投递误记成失败。Go 全量测试、Console lint/typecheck、332 项测试（331 pass、1 环境 skip）、Cloudflare build/dry-run 通过；0.4.6 已用既有 Ed25519 key 签名发布到 R2 并升级独立服务器，安装 verifier、service/timer、固定 data-runtime origin 与 `NRestarts=0` 均通过。Console 已发布 `45acaad0-16aa-43f6-a1d6-9fd271f94722`。初次验收因生产页面会话过期而未完成，且 Connector 自身最小权限凭证申请通知发送 scope 被 Console 以 403 拒绝；本轮没有临时扩权。随后已在重新可用的生产 Console 会话中完成同键 live replay，最终证据见下方“生产同键重放验收”记录。

2026-07-15 Enterprise Connector Runtime 0.4.7 本机 SLO 观测：Runtime 复用每分钟心跳已读取的 SQLite 聚合快照，每 5 分钟向本机 journald 写一条 `connector_runtime_slo_snapshot`，并提供 `-slo-snapshot` 即时只读命令；不新增 Cloudflare 调用或第二次 SQLite 扫描。结构严格限制为版本、tenant/deployment/runtime 绑定、采集时间、数据库字节数和通知/People job 状态计数，测试禁止消息正文、收件人、URL、provider subject、幂等键、token、secret 与供应商响应。Go 全量测试和 Connector 13/13 发布/安装脚本测试通过；0.4.7 使用既有 Ed25519 key 签名发布到 R2，stage/promotion 摘要分别为 `bd29008ee402cb41f595e51b9d525af6557b5a2e3b19e9a8a6c41b1e11218fe1` 与 `28bd626f18ca18fd19ca39ed4b5d8f6777aafa893749a35a2db4e99b0a9b7c96`。独立服务器 updater 从 0.4.6 升至 0.4.7，verifier、service/timer、固定 data-runtime origin、release trust、即时快照及间隔约 5 分钟的连续两条 journald 记录全部通过；观测期间无 heartbeat failure 且 `NRestarts=0`。正式不可篡改 usage bucket 仍不在内部验证范围内。

2026-07-15 企业微信登录暂停决策：企业微信后台实测不接受当前 `wiztek.huizhi.yun` 租户网关域名，现有 callback 无法完成供应商侧授权域校验。本阶段停止继续进行企业微信扫码、外部身份绑定及禁用用户失败路径验收，不通过改回 Console 源站绕过 Tenant Gateway 上下文。后续恢复前置条件是 Tenant Gateway 支持企业微信可接受的租户自定义域名，并以新域名重新生成和配置 callback。OIDC 默认登录、Connector Runtime 与企业微信通知不在暂停范围内。Platform 已发布回调配置诊断提示版本 `c099a650-19dc-48b5-a8d5-1a88b2f494ce`；该提示仅用于显示当前系统实际值，不代表企业微信已接受该域名。

2026-07-15 Enterprise Connector Runtime 生产同键重放验收：在生产 Console 通知运行时页面先完成 11 项企业微信配置检测，随后向 `zhouguangying` 执行一次受控测试。Console 返回“幂等重放已验证”，浏览器无 error/warn；Connector journal 仅出现一条 `notification sent provider=wecom integration=wecom.default`，实际发送与随后的 replay 两次 `/v1/notifications/send` 均成功。即时脱敏 SLO 快照的 succeeded 计数由 7 增至 8，而不是 9，证明第二次调用命中 durable ledger、没有再次调用企业微信。服务状态 active/running，`NRestarts=0`；验收过程中未扩大 Connector 自身最小权限凭证。

2026-07-15 Enterprise Connector Runtime 0.4.11 SLO 窗口验收：新增随签名归档安装的只读 `verify-slo-window.sh`，默认检查最近一小时至少 4 个快照、覆盖至少 15 分钟、白名单字段、全部可用、tenant/runtime 绑定稳定、通知与 People job 总量不倒退及 systemd 重启不超限。测试覆盖 RFC3339 纳秒、敏感字段、不可用、绑定漂移、短窗口、计数倒退和重启超限。生产首次部署暴露 updater 只更新二进制/schema 的缺口，0.4.9 增加三个 Connector 运维脚本的完整预检与原子复制，0.4.10 完成两跳自举，0.4.11 证明已运行的新 updater 可直接更新脚本。R2 0.4.11 stage/promotion 确认摘要分别为 `ab60d0caec8ed54a26aed5fae5d7f44ed84ad6361c24d79669bc142294826787` 与 `f0a02811638e178ece142933375c9a91b838fa21a470904eeee820359fbd7e42`；R2 与公网 `latest` 均为 0.4.11。服务器最终版本 0.4.11，安装 verifier 全项通过；窗口验收覆盖 11 个快照、2592 秒，版本 0.4.7→0.4.11，runtimeId/tenant/deployment 稳定，SQLite 65536 字节，delivery 12→13、People job 0、`NRestarts=0`。

2026-07-15 企业微信登录暂停状态复核：公网 `/api/auth/login-config` 仍返回 `mode=oidc`、`enabledProviders=[oidc,wecom]`，因此失败的企业微信入口仍会向用户显示，暂停决策尚未真正落实。Platform 管理员会话已过期，当前停在 `huizhi.yun/dashboard/login`；未绕过认证直接写生产数据库。管理员重新登录后应只把 enabled providers 收敛为 OIDC，保留 `wecom.default` 集成和 Vault CorpSecret，并分别验证公开登录配置不再暴露企业微信、OIDC 302 正常、企业微信通知配置检测与真实发送仍正常。

2026-07-15 Enterprise Connector Runtime 钉钉受控验收入口：Console 新增 `POST /api/v1/console/connector-runtime/dingtalk-test`，先校验集成编辑权限，只允许 `dingtalk.default` 经 Connector Runtime 发送，并以同一 payload/幂等键执行持久账本重放；第二次未明确返回 `replayed=true` 时验收失败。根工作区新增 `accept:dingtalk-connector`，默认仅检查公开登录配置和 Runtime health/capability；Integration 检测、通知/身份启用、登录 start、真实通知与 People 同步均需显式动作、变更号、环境变量会话及预览 SHA-256 确认，输出只保留 hash/聚合投影。集成中心钉钉卡片新增真实接收人和“发送并验证重放”入口，未保存集成或缺少编辑权限时保持禁用；企业微信和钉钉的新建表单默认使用 `db_encrypted`，避免 Cloudflare 多租户误把供应商密钥当环境变量引用，已有 Vault backend 不会被覆盖。6 项 CLI 测试、Console 333 项测试（332 pass、1 环境 skip）、lint、typecheck 和 diff-check 通过。Console Worker `4e6f1d73-933d-43b7-a88b-cecd582a29e0` 已发布；生产无会话 POST 返回 `401 Console login required`，路由存在且在业务逻辑前失败关闭。已登录生产页面确认 `dingtalk.default` 未配置时验收输入和发送按钮禁用，未发生供应商调用；最终资产 `Cf8l-hto.js` 下 Secret Backend 默认显示“数据库加密”、输入提示为“输入明文，保存后加密入库”，浏览器 error/warn 日志为空。原 `simple-icons:dingtalk` 告警已通过统一使用 Lucide 图标消除。发布后零凭证只读运行再次确认 Runtime 0.4.11、JWT/SQLite ready、固定两个钉钉官方 origin、`arbitraryHttpProxy=false` 及三项类型化能力；公开配置仍未启用钉钉，未执行真实钉钉调用。OIDC start 同时回归为 302 到 `sso.wiztek.cn`。发布过程中发现 activation status 通过对象展开覆盖默认值会触发 Nitro 产物重复键告警，现改为对新建默认对象执行显式合并；字段语义不变，lint、typecheck、333 项测试及 Cloudflare build/dry-run 均通过，最终生产构建不再出现 `Duplicate key`。

2026-07-15 Enterprise Connector Runtime 钉钉真实通知验收：生产 `dingtalk.default` 已绑定数据库加密 AppSecret；排查先后确认并修复错误 AppKey/Robot Code、缺少 `qyapi_robot_sendmsg` 权限、未创建机器人能力以及应用版本未发布四项供应商前置条件。钉钉应用新增机器人资料并发布上线，Robot Code 回填 Console 后，从生产集成中心向 `manager1561` 执行“发送并验证重放”成功，页面状态转为“正常”。Connector journal 只记录一条 `notification sent provider=dingtalk integration=dingtalk.default`；两次 `/v1/notifications/send` 分别耗时约 2.5 秒和 0.5 秒，SQLite ledger 仅新增 delivery 23，状态 `succeeded`、`attempt_count=1`、无错误码，证明第二次调用命中 durable replay，没有重复调用钉钉。Console `connectivity_status=healthy`、`last_error_message=NULL`。此前失败记录继续保留为脱敏故障证据，不包含凭证明文、access token 或消息正文。

2026-07-15 Enterprise Connector Runtime Phase 3/4 生产推进：Platform 已在保持 OIDC 默认的前提下启用 OIDC、企业微信与钉钉，生成策略包 `pv_prod_20260715182407_0078`；三种 start 均通过官方 host、redirect 与一次性 state 验收，公开配置不含供应商 secret。Console 已启用钉钉 identity capability，`accept:dingtalk-connector` 验证 Runtime JWT/SQLite、tenant/deployment、`arbitraryHttpProxy=false`、固定 `api.dingtalk.com` / `oapi.dingtalk.com` 及三项类型化能力。修复 Connector 页面固定“反馈”按钮遮挡“开始同步”的底部安全区后，Console lint/typecheck、340 项测试（339 pass、1 skip）、Cloudflare build/dry-run 均通过，并部署 Worker `85dccf9a-6cc4-410a-9f4e-738d44e70275`。生产真实 People 任务和失败重试均成功进入 Runtime SQLite；为避免泛化错误，Connector `0.4.14` 只暴露安全 provider code，Go 全量测试、18 项发布脚本测试、Ed25519 签名 R2 stage/promotion 和服务器自动升级全部通过。重试返回 `provider code 88`；服务器受控诊断确认 App token 正常，钉钉 `subcode=60011` 分别要求 `qyapi_get_department_list` 与 `qyapi_get_department_member`。两项权限开通前，Phase 4 的部门/人员计数、data-runtime 批次写入、skipped/applied 摘要和生产幂等尚未完成。钉钉真实用户 callback/Directory identity binding 也仍需人工登录补证。

2026-07-15 Enterprise Connector Runtime Phase 4 生产完成：钉钉应用开通 `qyapi_get_department_list` 与 `qyapi_get_department_member` 后，真实任务可读取 10 个部门和 79 名用户。首次成功读取暴露 Connector 将 data-runtime 原始 `{applied,skipped}` 回执按旧 `{data:...}` 包装层解析、从而静默记录 `0/0` 的契约缺陷；现已增加原始回执解析、旧包装兼容和缺失计数字段失败关闭测试，并将钉钉权限失败映射到具体权限名。Connector `0.4.15` 通过全量 Go 测试和 18 项发布脚本测试，以既有 Ed25519 key 签名发布；R2 stage/promotion 确认摘要为 `3fda8acd1626010ce6e7a3cd19456aef860ce82481b4496c2293fcd54d45dc9b` / `b4062234d7d233d8844d28a01993072b0cdeff78fe29cb376cb2be04ce8885ec`，独立服务器自动升级后保持 active。生产任务 `crj_hnrybpYTtlYFQ5BxRmAl3O8f` 最终为部门 10、人员 79、写入 77、跳过 2、批次 3；data-runtime 三条 durable receipt 分别为 `0/0`、`77/2`、`0/0 final` 且全部 success，People 中来自 connector-runtime 的实际员工行数为 77。失败任务的 `retryOfJobId` 链保留，未覆盖原失败事实；批次内容重放/冲突由 `job_id + batch_number + batch_hash` 契约和自动化测试保护。Phase 4 已完成，剩余工作是钉钉真实用户登录 callback、身份绑定和停用账号失败关闭补证。

## 14. 完成定义

一个任务只有同时满足以下条件才可标记 `[x]`：

- 代码或文档改动已经落在正确的模块仓库。
- 相关 lint、typecheck、测试和契约测试通过。
- 关键错误路径、权限边界和幂等重放已覆盖。
- 需要浏览器验证的 UI 已检查 1440px 和 390px。
- 涉及 schema/API/manifest/grant 的文档已经同步。
- 提交和回滚边界明确。
- 若要求真实环境验收，已有可定位的执行记录，而不是只在本地通过。

## Tenant Runtime 自助安装方案 B（2026-07-12）

- [x] Platform 生成短期、单次、仅存 hash 的 tenant-runtime enrollment code。
- [x] 复制命令固定批准版本，并在 `sudo` 前校验 release public key 指纹和安装器 Ed25519 签名。
- [x] Agent 在本地数据库连通检查后兑换注册码；数据库凭证不进入 Platform 或复制命令。
- [x] 增加环境级 Runtime instance、应用 deployment bindings、独立 control token 和 Agent heartbeat。
- [x] JWT 按 appCode 校验对应 deployment binding，不再把共享 Agent 任意绑定到一个业务应用。
- [x] Platform 记录 desired/current version；Agent 仅通过既有签名 updater 响应版本分配。
- [x] Gateway 在 Runtime ready 且应用 Schema ready 后才下发 Runtime endpoint。
- [ ] 在目标 Platform DB 应用 `platform/docs/sql/HZY-Platform-SQL-Migration-v2.27-tenant-runtime-enrollment.sql`。
- [ ] 配置生产 `HZY_DATA_RUNTIME_APPROVED_VERSION` 与 `HZY_DATA_RUNTIME_RELEASE_PUBLIC_KEY_PEM`。
- [ ] 发布对应精确版本到 R2，并用真实租户完成首次安装、重复兑换、过期、心跳、Schema 门控和升级验收。

## LDAP 托管读写 / Directory Connector（2026-07-12）

- [x] data-runtime 同一签名包增加独立 `directory-connector` 子进程，并由独立 Linux 用户和 systemd unit 运行。
- [x] Platform 安装命令生成绑定 tenant、Console deployment 与 runtime 的短期单次 Connector enrollment token。
- [x] Console 建立 Connector service client、RSA 公钥注册、短期 service token 与精确 capability。
- [x] LDAP bind password 支持 Console Vault `db_encrypted`，并只以 RSA-OAEP-SHA256 密文下发 Connector。
- [x] Connector 支持 OpenLDAP / Active Directory、LDAPS / StartTLS、用户全量同步和手工立即同步。
- [x] 目录管理用户页支持异步创建 LDAP 用户，保留岗位、主部门、人员类型并同步最小 subject 到 Platform。
- [x] Profile 支持 LDAP 身份用户用当前密码验证后异步修改密码。
- [x] durable operation 使用 lease、attempt、fencing、retry/dead-letter；初始/当前/新密码仅保存密文。
- [x] Go 全量测试、Console/Platform 契约测试、typecheck、安装脚本语法检查通过。
- [x] Console 生产库应用 `console/docs/sql/Console-SQL-Migration-v1.17-directory-connector.sql`，并补齐/验证 reliable operation ledger 依赖。
- [x] 发布 Console、Platform 与新的 data-runtime 精确版本：data-runtime `0.3.99`、Console Worker `1e9e6f6a-cf25-4397-bc19-3ea2d0d5d8dc`、Platform Worker `6b982db8-6b27-428d-b21e-cf93c2c305cf`。
- [x] 修复独立 `hzy-directory` 用户无法穿越 `/etc/hzy-data-runtime` 读取 Connector 私钥的问题；升级时同时校正已有私钥 owner/mode，并增加安装器回归测试。修复版 data-runtime `0.3.100` 已签名发布为 R2 `latest`，Platform Cloudflare 允许版本已更新并部署为 `50a758c5-eb54-483b-ad17-66bea04ab097`。
- [ ] 在目标服务器重新执行 Platform 生成的一键安装命令，完成 Connector enrollment。
- [ ] 在 Console 配置 managed LDAP 和 Vault 绑定密码，验收同步、创建用户与 Profile 改密。
- [ ] 用过期/重复 enrollment、LDAP 不可用、错误当前密码、重复创建与更新响应丢失完成故障验收。

生产浏览器已验证目录源页面包含 Console Vault 密文后端、OpenLDAP/AD 与 managed/readonly 配置；Profile 会在未启用 managed LDAP 时明确显示不可改密原因。用户弹窗桌面与 390px 视口均可打开，修复 Nuxt UI 空字符串 SelectItem 错误后新会话 error 日志为 0。当前生产 LDAP source 尚未配置、Connector 尚未 enrollment，因此未创建真实 LDAP 用户，也未提交真实密码修改。

2026-07-15 钉钉登录 `900103 应用不存在` 追踪：生产已使用同一 AppKey 完成机器人通知与 People 同步，但错误发生在钉钉授权页、Console callback 之前。用户提供的 `UnifiedAppId` 提示明确其逐步替代 AgentId/三方 AppId，未将其当作 OAuth Client ID。已在 Console/Connector 增加显式 `oauthClientId`，使登录 start 和授权码交换使用同一登录标识，通知/People 继续使用 AppKey；回退兼容已有租户。Connector `0.4.16`、Console Worker `bdd39429-e00d-4114-8535-0991dbe191c4`、Platform Worker `33187ae3-df55-4ca0-94a6-5eb20e638b39` 已发布并通过健康检查；真实登录仍需在钉钉后台开通/发布网页登录能力并确认该能力的 OAuth Client ID，因此 Phase 3 保持未完成。

2026-07-15 钉钉登录凭证产品化加固：新增 `dingtalk.identity` 独立集成和 Vault Client Secret，`dingtalk.default` 继续固定服务通知/People并仅作为旧租户登录回退；登录 start 把所选 integration code 写入 tenant/deployment/browser-bound 单次事务，callback 与 Connector 授权码交换不得重新选择凭证。Runtime identity 配置不再要求 Robot Code，同时仍以同一身份应用凭证把 unionId 映射为企业 userid。Console 集成中心明确区分 OAuth Client ID、AgentId、UnifiedAppId，并提示钉钉后台回调修改后必须重新发布应用版本。v1.77 已在生产 `hzy_console` 应用并验证 transaction column 与两个精确 integration grant；Connector 0.4.17 已使用既有 Ed25519 key 签名发布到 R2、独立服务器升级后保持 `active/status=ok`；Console 341 项测试（340 pass、1 环境 skip）、lint、typecheck、build/dry-run 通过并发布 Worker `2c0d2db6-819e-4b89-b8a6-2903fe390ba5`。新增服务端硬校验会拒绝纯数字 AgentId 与 UUID 形式 UnifiedAppId；生产探测已把当前 `AgentId=4782742329` 配置以明确 503 失败关闭，未再跳到供应商无效应用页。真实 callback、Directory identity binding 与停用账号失败关闭仍等待录入“凭证与基础信息”中的 OAuth Client ID/AppKey、匹配 Client Secret并重新发布钉钉应用版本，因此 Phase 3 继续保持未完成。

2026-07-16 Enterprise Connector Runtime 钉钉真实登录验收：钉钉应用完成网页登录配置并重新发布后，生产使用独立 `dingtalk.identity` AppKey/Client Secret 进入真实授权。Connector `0.4.18` 增加只记录稳定安全错误码的身份交换诊断，首先将问题收敛到 `dingtalk_identity_profile_failed`，未记录授权码、token 或供应商正文；Console 随后把授权 scope 修正为 `openid corpid Contact.User.Read`，并以 341 项测试（340 pass、1 环境 skip）、lint、typecheck、build/dry-run 后发布 Worker `0c91e252-60a3-4554-a7df-5852f1d06f15`。真实用户完成企业组织选择与授权后成功返回租户工作台；Connector 的类型化身份交换请求成功且无失败码，Console callback 必须先完成企业 userid 映射、`resolveOrBindDirectoryIdentity` 和 session 创建才允许跳转，因此 callback、Directory identity binding 与 Console session 已有生产证据。`0.4.18` 已用既有 Ed25519 key 签名发布到 R2并升级独立服务器，服务保持 `active`；首次 promotion 在激活指针写入前遇到临时 Cloudflare `520`，同一已校验计划重试后原子完成。自动化测试已覆盖 inactive external identity 和 disabled Directory user 失败关闭；项目负责人明确不执行对应生产账号演练，Phase 3/4 按批准范围完成。

发布前发现 Platform active signing key 已轮换而 Console 环境仍保留上一把 key；Connector enrollment 已改为复用 policy bundle 的按 `kid` active/rotated key resolver，在 managed Cloud 下通过内部端点解析公钥，避免新安装 token 被旧环境 key 硬匹配拒绝。对应 lint、typecheck、3 项 Connector 契约测试、Cloudflare build/dry-run 通过后重新发布 Console。
