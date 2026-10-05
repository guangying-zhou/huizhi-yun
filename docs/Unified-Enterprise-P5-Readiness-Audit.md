# ADR-018 P5 联合验收与逐租户发布就绪审计

核对日期：2026-09-15。范围：实施计划的 INT-501～INT-507。本审计只读取当前源码、自动化测试、已提交的脱敏回执和测试环境部署记录；没有访问外部系统、真实租户或敏感配置，也没有执行部署、迁移、切换或写入。

`强证据` 是可定位到当前代码/测试或带 tenant、环境、时间和边界的脱敏回执；`弱证据` 是候选构件、单次检查、静态配置或历史观察。弱证据不能替代当前环境回读。P5 的七项均保持未完成，本文件不修改实施计划复选框。

## 1. 先决事实与结论

- `C000001 / test` 的 150 张 Aims/Assets 业务表已经在专用测试统一库激活为 generation=1，源端 fenced，目标运行账号只有目标库四种 DML 和 55 个兼容视图的 `SHOW VIEW` 权限；证据见[统一库激活回执](../deploy/test-env/artifacts/C000001.unified-database-activation.json)和[试点数据清单](./Unified-Enterprise-Pilot-Data-Inventory.md)。这证明的是指定测试租户的已激活数据试点，不能外推到生产、其他租户或完整业务验收。
- 当前 Host、Aims 和 Assets 新页面能力没有同一版本的发布证明。[部署与路由清单](./Unified-Enterprise-Deployment-and-Routing-Inventory.md)记录的 Host/Gateway 回读时间为 2026-09-14，并明确当前 HEAD 后续页面不能据此声称已发布；[Host 候选回执](../deploy/test-env/artifacts/C000001.enterprise-host-full-candidate-20260914.json)也明确 `candidateOnly=true`、`deployed=false`。
- Gateway/统一 drain 的代码、签名状态和 generation=1 回执存在，但 P3 审计已经记录测试包装器的 `scheduled()` 只触发 policy sync，与通用 Gateway 的 integration drain 分派不一致。因此新 Gateway drain trigger 没有当前已部署且已执行的强证据，不能作为切换条件。
- Free 测试档的 Console policy 定时同步曾命中 10ms CPU 限制，且提高 CPU 限额被平台以 Free plan 不支持拒绝；后续两次成功续期不能证明持续可靠。详见[CPU 阻塞回执](../deploy/test-env/artifacts/C000001.console-cpu-limit-blocker-20260914.json)、[恢复观察](../deploy/test-env/artifacts/C000001.console-policy-cpu-recovery-20260914.json)和[间歇失败观察](../deploy/test-env/artifacts/C000001.console-policy-intermittent-cpu-failure-20260914.json)。在此约束解除或以实测证明稳定前，不应开始 P5 切换观察期。

## 2. 逐项审计

| 任务 | 当前判断 | 强证据 | 弱证据或不能证明的事项 | 完成缺口 |
| --- | --- | --- | --- | --- |
| INT-501 测试证据汇总 | 未就绪 | [P0–P2 审计](./Unified-Enterprise-P0-P2-Evidence-Audit.md)已区分隔离 MySQL、迁移与恢复边界；[P3 审计](./Unified-Enterprise-P3-Readiness-Audit.md)记录 31 项静态拓扑/会话/路由测试；[性能基线](./Unified-Enterprise-Performance-Baseline.md)冻结了两租户四主体、指标和阈值 | 150 表影子演练、Host dry-run、单次页面/登录观察和 fixture bridge 都不是同一制品的完整验收；当前页面集也没有部署回读 | 对固定制品汇总真实隔离 MySQL、API/OIDC、迁移、权限矩阵、1440/390、性能和恢复结果；逐项标注 mock、fixture、隔离 test 与真实租户边界 |
| INT-502 测试环境模板与预检 | 部分就绪 | [测试就绪模板](../deploy/test-env/enterprise-readiness.template.json)覆盖 Host/Gateway 前缀、Runtime schema、bindings、逻辑模块能力及外部 provider 禁用；[Runtime candidate 7 回执](../deploy/test-env/artifacts/C000001.runtime-candidate7-deployment.json)记录 test Runtime 健康、schema-ready bindings 与已批准 stable release | 模板和静态检查不等于当前 secret、跨信任边界 grant 或所有 scope 已实际签发；`enterprise-preparation.manifest.json` 明确 `businessMigrationApplied=false` | 对固定 Host/Gateway/Runtime 版本重新运行预检；逐 capability 以实际 service client 探测 token 签发和目标拒绝路径；回读 secret 引用而非 secret 值，并记录任务 owner/generation |
| INT-503 测试租户完整业务链 | 未就绪 | 统一库激活回执记录 150 表、generation=1、源 fence、最小权限和写入回滚验证；产品页面台账列出若干 Aims/Assets BFF 的真实 HTTP/MySQL 合同 | 这些是领域/HTTP 演练或代码登记；[页面 API 台账](./Unified-Enterprise-Product-Page-API-Readiness.md)明确“代码登记，不代表环境已上线”，且仍有待接接口 | 用获授权的隔离测试主体依次完成产品主档、接入、需求入版本、计划确认、项目承接和适用验收；为每次写入记录脱敏对象标识、结果、重放结果与清理/保留策略 |
| INT-504 真实故障恢复 | 未就绪 | [切换协议](./Unified-Enterprise-Cutover-Protocol.md)及临时 MySQL 测试覆盖 fence、事务回滚、幂等 receipt、恢复 owner、竞争和反向恢复；drain wrapper 回执记录 control-boundary 活动为 settled | 临时 MySQL 和 coordinator fixture 不证明测试环境的 Runtime 离线、会话过期、权限撤回、响应丢失、旧 outbox 或真实任务租约；该回执也明确不证明外部 provider drain | 在隔离测试环境逐一注入 Runtime 离线、会话失效、授权撤回、事务中断、目标已提交响应丢失、旧 outbox 重放和 lease 交接；以行级 receipt/水位和读回证明零重复写、零丢失更新 |
| INT-505 固定试点制品与运行手册 | 未就绪 | [切换协议](./Unified-Enterprise-Cutover-Protocol.md)定义 source fence、最终复制、外部 drain、回退和新写入后的恢复；Host 候选回执保存输出摘要、route artifact 计数和观察到的 rollback version | 候选回执明确未部署；已有协议没有把当前 Host/Gateway/Runtime/schema/权限目录固化为同一可发布制品，也没有获授权的操作窗口/责任人/观察指标回执 | 固定不可变版本、构件 hash、schema/registry generation、权限目录和回退制品；补齐备份恢复验证、写入暂停范围、窗口、责任人、指标、触发阈值及新写入后恢复演练 |
| INT-506 获授权的试点切换 | 未就绪 | [统一 Gateway release 回执](../deploy/test-env/artifacts/C000001.unified-gateway-release.json)曾记录 Aims `storage=unified`、generation=1、签名 activation 和 open drain；统一库激活回执记录 generation=1、源 fence 和备份 hash | 这些是 2026-09-14 的指定回执，不是当前全路由/全页面流量；Host 候选未部署，新 Gateway drain trigger 未证明已运行，Free CPU 也不能保证观察期策略刷新 | 获得逐租户授权后，先回读唯一写入方、数据/权限/任务水位、实际版本、流量和 drain；仅在完整业务操作及至少一个相关后台周期均可观测后，按冻结观察期进行切换 |
| INT-507 试点验收报告 | 未就绪 | [性能基线](./Unified-Enterprise-Performance-Baseline.md)已定义与 INT-006 对比的调用、同步、配置、CPU、内存、启动、页面和 SQL 指标；[部署清单](./Unified-Enterprise-Deployment-and-Routing-Inventory.md)列出独立应用和未启用模块边界 | 当前只存在历史/候选/单次指标，缺少固定制品下的旧新配对 P50/P95、真实 CPU/内存/启动、完整业务和恢复观察 | 在 INT-501～506 证据完成后出具报告：逐项对比 INT-006，列出未迁移模块、保留独立路径、风险、回退证据和进入 P6 的准入条件 |

## 3. 部署与页面边界

已激活的统一库试点和已发布页面必须分开叙述：

| 事实 | 可说的结论 | 不可说的结论 |
| --- | --- | --- |
| 150 表、38 个 trigger、55 个兼容视图在 `C000001/test` 的统一库演练/激活证据中出现 | 测试统一库和最小运行账号的特定数据试点已被验证 | 所有租户已迁移、生产已切换或业务链验收完成 |
| Aims/Assets 独立 Worker 在 2026-09-14 曾有 `/aims/products`、`/assets/products` 的 200 观察 | 当时的独立兼容入口可达 | 当前 Enterprise Host 的新增 Aims/Assets 页面已发布或已走统一库 |
| 当前源码登记 Aims/Assets Host BFF 和新只读页面 | 路由、授权边界和隔离测试可审查 | 真实登录用户已在 test 环境使用这些页面；完整旧页面/API 已迁移 |
| `enterprise-host-full-candidate` 的 typecheck、完整 Cloudflare build、Wrangler dry-run 通过 | 候选构件可打包 | 可发布制品已部署、当前 bindings/secret/grant 正确或可回退 |

Assets 字典、实物/资源资产只读页，以及当前继续增加的 Aims 项目详情子页，必须以“源码已接线、待同版本发布与登录验收”记录；在相应 Host 版本、Gateway 路由和 Runtime binding 重新回读前，不得作为 INT-503 或 INT-506 的已完成业务能力。

## 4. 安全执行顺序

1. 固定候选的源码提交、Host/Gateway/Runtime 构件 hash、schema、registry generation 和权限目录；只读取并比对，不修改真实租户。
2. 在隔离 test 租户重新运行预检，逐一核验 Host/Gateway 路由、Runtime schema/binding、任务 owner、secret **引用**和所有跨信任边界 capability 的实际签发/拒绝矩阵；任何缺 grant、错 audience、错 tenant/deployment 均失败关闭。
3. 先解决或复现实测证明 Free CPU 下 policy refresh 的持续可靠性。不得缩短资格校验、延长 TTL、关闭签名验证或把手工同步当作观察期保障。
4. 部署经批准的同一不可变候选后，回读当前版本、流量、Gateway 新 drain trigger 和每类任务唯一 owner；确认旧 Worker、Host 和 Gateway 不会形成双消费者。此步之前不得关闭 source fence、开启业务写入或宣布切换。
5. 用隔离测试主体执行 INT-503 主链和 INT-504 故障矩阵，保存脱敏 object/receipt/watermark/hash；真实外部 provider、真实客户数据和密钥始终排除。
6. 获得逐租户明确授权后，按切换协议执行备份、drain、fence、最终复制、激活与观察；任何未解决 activity、版本/水位漂移、scope 探测失败、CPU exceeded 或回读不一致都停止在当前阶段并保持旧路径。
7. 观察期覆盖完整业务操作和相关后台周期后，才写 INT-507 验收报告，并保持新增写入后的恢复路径可执行。

## 5. 当前最小阻塞清单

- 当前 HEAD 的 Host 新页面和 BFF 没有对应的已发布版本/认证业务页面验收。
- Gateway 新 drain trigger 没有当前包装器已部署且已执行的回读；不能用 generation/open snapshot 代替。
- Free CPU 限制下 Console policy 定时刷新仍会间歇 `exceededCpu`，没有连续可靠性保证。
- 完整业务链、真实故障恢复、两租户四主体权限矩阵、桌面/手机验收和配对性能/SQL 采样尚未在同一固定制品完成。
- 试点发布所需的获授权窗口、责任人、唯一 owner 回读、外部 drain 证据和新写入后的恢复演练均未完成。

以上缺口关闭前，P5 只能作为准备状态；不得把统一库 activation、候选构建、独立 Worker 200、空 outbox 或单次手工同步写成试点上线或逐租户切换完成。
