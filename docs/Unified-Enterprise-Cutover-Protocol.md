# ADR-018 源端写栅栏与最终复制协议

日期：2026-09-13。适用 INT-206/207 的同实例 Aims/Assets 切换基础；代码为 `data-runtime/internal/migrations/unified/fence.go`。本协议尚未在真实业务库安装或执行，不表示试点租户已经切换。

前置事实、表映射和完整影子复制见 [数据合同](./Unified-Enterprise-Data-Contract.md) 第 11 节。迁移总进度仅在 [实施计划](./Unified-Enterprise-Implementation-Plan.md) 管理。

## 1. 要解决的问题与保证

仅切换新 Runtime 内存 registry 或 Gateway 路由，不能阻止旧 Worker、后台任务、已有连接继续写旧库。本实现将 DML 拦截放在数据库：每张源业务表的 INSERT/UPDATE/DELETE 都执行 guard trigger，在原业务事务内对持久 fence 行执行 `FOR SHARE`。事务提交/回滚前共享锁不释放。

切换事务按稳定顺序锁定两源库的 fence 行 `FOR UPDATE`，因此等待已经开始的旧业务事务完成；取得两把独占锁后，禁止新的 DML 越过切换点。两源状态在一个 InnoDB 事务内从 legacy 变为 fenced：全部提交或全部回滚。guard 使用锁定当前读，旧 REPEATABLE READ 快照也不能继续读取旧 legacy 状态绕过栅栏。

该协议不声称能防御拥有任意 DDL/管理员权限的操作者。业务运行账号应只有所需业务表权限，不能删除 guard/修改 fence 控制行或执行 TRUNCATE；同时间段应禁止来源 schema/trigger 维护。MySQL 没有对 schema 级宽授权的表级 DENY：若当前账号有宽授权，需先制定并验证最小权限转换，不能只追加一个表级 GRANT 就宣称控制表被隔离。真实环境上线前必须核实这些条件，不能以隔离测试使用 root 为权限部署证据。

## 2. 持久状态

每个源库新增 `enterprise_source_fence`，包含：

- id=1、tenant_code、contract_hash；绑定租户、源实例/库、目标库、schema/generation 和完整表/触发器合同。
- state：legacy / fenced / active。源只由本流程 legacy → fenced；复制到目标的同一记录经激活事务 fenced → active。
- transition_key：稳定切换命令身份，重复同键幂等，不同键冲突。
- changed_at：UTC 时间。

每张业务表新增 3 个稳定命名 BEFORE guard，保留全部既有业务 trigger。guard 只读取 fence；legacy/active 允许 DML，fenced、缺行或未知状态都失败。fence 控制表本身不递归安装 guard，应由独立受控维护身份管理。

`FenceSpec` 从已审阅的完整迁移 Plan 生成。它冻结全部源业务表、稳定 DDL 摘要和原业务 trigger 定义；表级 AUTO_INCREMENT 水位不会被误认为 DDL 变化，但列/索引/约束变化会拒绝。安装/切换检查真实 information_schema，新增、缺失表或 guard/业务 trigger 漂移都不允许切换。

## 3. 执行阶段

### A. 保持 legacy，安装并核验 guard

`BuildFenceSpec(reviewedPlan)` → `InstallSourceFence(ctx, db, spec)`。

安装 DDL 不可能跨两库原子提交，因此安装期间 fence 保持 legacy，旧业务仍可写。全部 guard 安装完并核验前，`FenceSources` 明确拒绝。进程在安装中断后，可按同一合同补齐缺失 guard，不覆盖已存在但定义不匹配的 trigger。

当前 Go API 没有 HTTP 入口，也没有把 `--apply` 影子复制参数扩展成自动关闭源写的隐式行为。实际调度方应先形成可审阅计划与维护窗口，再显式调用下列阶段。

### B. 排空可靠任务，再原子关闭源写

`FenceSources(ctx, db, spec, cutoverKey)`。

取得两库 fence 独占锁后，代码检查已登记 `integration_operation`：只接受 succeeded/cancelled；其他状态（含 processing、partial_unknown、dead_letter 等）拒绝，并回滚独占锁，让旧路径继续处理 receipt/ACK、租约与必要的受控取消。不能先关闭源写再期待旧 outbox ACK 能写回。

这只是库内条件。外部任务、回调、独立通知、文件系统和没有本地 outbox 表的消费方仍需独立排空证据。暂停/撤销调度注册与确认租约归属的流程应先在真实运行环境完成。不能把库内 operation 为 0 等同于没有外部副作用。

事务取消、连接丢失或死锁发生在提交前，源保持 legacy；提交结果丢失时，同键重试读取持久 fenced 状态返回。不同切换键或双源状态异常时拒绝，不自动修复成“看似一致”。

### C. 最终追平采用完整重复制

`PrepareFinalCopy(ctx, db, spec, cutoverKey)` → 人工/调用方核对新的 review hash → `Apply(ctx, db, finalPlan, reviewHash)`。

首版采用源写停止后的最终完整复制到**新的独立目标库**，不实现 CDC，不覆盖早先影子目标。首次影子 Plan 与最终 Plan 的数据 hash 必然可能不同；不得复用旧 review 摘要忽略变化。

最终复制包含两个 source fence 表（当前 150 张业务表 + 2 张 fence 表），以及改写至目标物理表的 guard/business trigger。目标 fence 为 fenced，schema generation=0，因此 Runtime 和目标底层 DML 两层都不能提前启用新写。所有原业务 ID、JSON、receipt、outbox 和审计仍使用完整复制规则。当前表闭包见[产品试点数据清单](./Unified-Enterprise-Pilot-Data-Inventory.md)。

最终停写窗口包含完整复制和验证时间，必须通过实际数据量演练估算。不能用当前测试的几百行耗时预测大租户停写窗口；若不能接受该窗口，应先实现有水位的增量复制，再设计同一 fence 下的最终追平。

### D. 同事务激活目标并持久回执

`ActivateFinalCopy(ctx, db, spec, cutoverKey, finalPlan, externalDrainVerifier)`。

要求：

1. 相同 instance、完整合同和切换键；两源仍持久 fenced，guard/schema 完整。
2. 目标属于该 review hash 的 verified-shadow，逐表 count/hash 与最终 Plan 一致。
3. 源 outbox 已排空；必需的 `ExternalDrainVerifier` 提供绑定该合同/命令的耐久 SHA-256 证据标识。它必须复用已经取得的真实、受信 worker/副作用证据，在事务中核验有效性，不能在事务内发网络请求。
4. 两目标 fence 行与合同/切换键完全匹配，当前仍 fenced；目标 registry 身份相符且 generation=0。

满足后，在同一个目标事务内把两目标 fence 改为 active、registry generation 改为明确登记的值、迁移 ledger 改为 active，并写入 `enterprise_cutover_receipt`。源 fence 始终保持 fenced。

激活响应丢失时，同键同 review/generation 返回原回执；即使目标已经出现新业务写入，也不能重复初始复制或覆盖新事实。相同命令身份但不同 review/generation 冲突。随后由受控部署编排刷新相应 Runtime registry/路由；库状态与 HTTP 发布的联动仍需上层验收。

## 4. 回退与恢复边界

没有直接“解除源 fence / 回 legacy”的 API。切换后优先让兼容旧 UI/BFF 访问新权威存储。需要回旧物理库时，必须另行暂停目标写、捕获并反向迁移新增事实、receipt/outbox/水位、核对一致并形成新的切换合同，不能恢复早前备份或单纯把源 fence 改回 legacy。

现有反向复制与恢复激活接口见第 7 节；仍没有真实环境 external drain/owner verifier 或路由发布 adapter，不得把这些缺口描述为已完成。`isolatedDrains` 仅是测试文件中明确的 fixture，不存在生产默认批准实现。

## 5. 真实隔离验证

实例：`/tmp/hzy-product-center.fence.rrumv5ec/mysql.sock`，独立 MySQL PID 54504。没有对实际 Aims/Assets 业务库创建 fence 或 trigger。

```sh
HZY_ENTERPRISE_TEST_SOCKET=/tmp/hzy-product-center.fence.rrumv5ec/mysql.sock \
HZY_ENTERPRISE_SCHEMA_PLAN=/tmp/hzy-migration-source-plan.json \
  go test -race -v ./internal/migrations/unified
```

覆盖：

- pending/processing outbox 阻止 fence，失败后旧路径仍能完成状态写回。
- 缺少一个 guard 时拒绝切换，同合同安装重试补齐。
- 通过 performance_schema.data_lock_waits 观察真实 InnoDB 等待，证明切换确实等待旧写事务提交。
- 协调事务取消后两源仍 legacy；已打开的旧连接、旧 RR 快照在切换后 INSERT/UPDATE 被拒绝。
- 两源原子切换、重复同键/冲突键、fenced 最终复制、未激活目标写入拒绝。
- 外部 drain verifier 缺失或报告在途任务时拒绝激活；激活回执重放保持新目标事实。
- 原业务 trigger 继续在目标产生正确记录，不回写源；源旧写路径在目标有新事实后仍被拒绝。
- 当时使用实际完整 147 张源表 DDL 与合成数据，安装完整 guard 闭包，最终复制 149 张表并激活；这是补入 Assets 三张 outbox 表前的历史协议测试。当前 150 表闭包的最终复制与恢复贯穿验收仍归 INT-207，不能由该历史测试代替。

这些证据属于隔离 MySQL 的 SQL/事务/恢复协议，不等于实际 Worker 停止、租约转交、Runtime 路由切换或真实外部副作用验收。

验证结束后确认隔离 hzy_ef_*/hzy_em_* 测试库剩余 0，PID 54504 正常 shutdown，PID 文件消失，自建 datadir 已清理。上述 socket 不再运行。

## 6. 受管兼容视图的并发约束

视图安装、影子复制和目标激活现统一复用 `internal/migrationlock`，并由固定 MySQL session 持有 named lock，避免 DDL 隐式提交造成 generation=0 检查与激活竞态。受管视图、已有 productcenter 事务复用和真实 DML/重放证据见 [兼容视图合同](./Unified-Enterprise-Compatibility-Views.md)。生成视图不会替代新请求事务中的 registry generation 行锁；该权限/运行代际接线仍需独立完成。


## 7. 新写入后的反向恢复（enterprise-recovery.v1）

实现位于 `data-runtime/internal/migrations/unified/recovery.go`、`recovery_activation.go`。恢复使用原最终复制计划和源 fence 合同，另加不可复用的 recovery key、两个全新恢复 schema。旧 Aims/Assets 库永不覆盖、永不解除 fence。当前统一库才是恢复数据源；其新主键、JSON 引用、外部命令 receipt、outbox 和业务水位全量复制，不能以最初影子 hash 替代当前事实。

1. `FreezeRecoverySource` 先核对实例 UUID，再创建专用控制表。取得迁移 session lock，在事务中核对原激活 receipt、tenant/environment/runtime/schema/generation、两旧源 fence、统一库 guard/DDL 闭包。锁住两统一 fence 等待已开始的 DML，拒绝非 succeeded/cancelled outbox，并要求实际外部 drain verifier 的持久证据；原子将统一 generation 置 0、两 fence 置 fenced、登记冻结 receipt。同 key 同合同可重放，异合同拒绝。DDL/权限维护同样必须停止。
2. `PrepareRecovery` 只读生成当前冻结统一库完整 count/hash。未冻结、代际/身份漂移、未知源表、DDL/trigger 漂移均拒绝。计划保留原表名、主键、列、DDL、业务 trigger 和 guard 的完整定义。
3. `ApplyRecovery` 必须提供精确 review hash，只创建两个新 schema。复制时暂不安装 trigger，避免重复业务副作用；完成后恢复原约束名称、同域 FK、原 trigger 名称/主体与 guard。跨域无法证明的引用拒绝。复制回执先为 copied-fenced；两库内容、DDL、trigger、FK、完整表闭包全部核验后，才在同一事务中改为 verified-fenced。部分失败不删除证据，也不自动覆盖重试；未完成目标应换新名称。已完成匹配回执可核验重放。
4. `VerifyRecovery` 全程只读；校验两库回执、所有 count/hash、DDL、trigger、FK 和额外未知表。恢复库依然 fenced，不能直接承担请求。

CLI 默认只读；配置中的 `Recovery` 包含上述合同，`Migration` 必须与 `Recovery.Final.Config` 完全一致。连接秘密只放受保护本地配置，不提交仓库。

```sh
cd data-runtime
go run ./cmd/hzy-enterprise-migrate --config /protected/recovery.json --plan /protected/recovery-plan.json --recovery
# 审阅后才显式执行新 schema 复制：
go run ./cmd/hzy-enterprise-migrate --config /protected/recovery.json --plan /protected/recovery-plan.json --recovery --apply --review-hash <reviewed-sha256>
go run ./cmd/hzy-enterprise-migrate --config /protected/recovery.json --plan /protected/recovery-plan.json --verify-recovery
```

冻结和激活没有使用人工填写 hash 自动批准的 CLI；必须接入实际本地事务 verifier。默认 plan 不会冻结、创建 schema 或切换路由。

### 7.1 单一 owner 激活与路由接续

`RecoveryActivation` 冻结恢复计划、activation key、唯一 runtime deployment/worker client、严格大于原代际的新 generation，以及准备状态的 route revision。`ActivateRecovery` 要求精确合同 hash 和 `RecoveryOwnerVerifier`。后者必须在同一事务内从实际持久登记核对：旧 worker/租约已排空；旧凭证不能访问两新 schema；仅声明的 owner 具备精确新库访问权限；入口仍停用且路由 revision 未变化。它返回证据摘要，不能做网络调用，仓库没有生产默认成功实现。

激活先再次完整核验恢复库，并在事务中锁定旧源/统一源以及两新 fence。保持旧源和统一库 fenced、统一 generation=0；只将两新 fence 原子设 active，写唯一 owner activation receipt。单表 id=1 防第二 owner；同合同重放不再覆盖激活后的新事实。外部验证失败回滚两 fence。新 owner 的入口在路由发布之前必须继续停用，不能把数据库 active 当成公开服务已可用。

路由提交 adapter 的实际环境接线合同如下（具体软件实现见第 8 节）：输入为已提交 activation receipt、精确 tenant/environment、两个恢复 schema、owner runtime/worker、递增 generation、预期停用 route revision。必须 CAS 发布两个模块到同一声明 owner 的配置，再只读回验 Gateway/Runtime 与任务所有权登记一致，之后启用入口。CAS 失败保持入口停用并保留唯一已激活 owner；不能解除旧库或统一库 fence。需要重试或换 owner 时必须形成新停写/排空/所有权转交合同，禁止覆盖现 receipt。此阶段没有假造可用域名、grant 或生产登记，未完成真实路由切换。

### 7.2 本地演练证据与完成边界

`node data-runtime/scripts/test-enterprise-recovery-mysql.mjs` 使用专属随机端口/datadir/socket、`--no-defaults` 的 temporary MySQL harness，并仅为真实 InnoDB 锁观测显式开启 performance schema；结束自动清理。真实 `go test -race` 覆盖旧事务锁等待、冻结取消、新增事实、JSON/PK、receipt、原业务 trigger 不重复、反向复制/核验重放、额外表拒绝、owner 准备失败回滚、两恢复库激活、重复激活不覆盖新写、第二 owner 拒绝、旧源及统一源继续拒写。

这些是实际 SQL/事务演练。fixture verifier 仅存在测试文件，并不证明真实外部 worker、grant 或路由准备状态。没有实际业务库写入，也没有生产部署。完整 INT-206/308 的环境验收仍需真实外部排空与停用→发布→只读回验→启用的联合演练；owner verifier 和路由 CAS 软件实现见第 8 节，不能仅以复制或数据库激活通过宣告全部完成。


## 8. 可执行恢复 owner 与路由 CAS 接续

第 7 节的接口现在有具体实现，未部署到业务环境：

- `SQLRecoveryOwnerVerifier` 校验固定 Platform Ed25519 公钥下的 route preparation 原文字节签名，并核对 tenant/environment/recovery hash/instance/两个 schema/runtime/worker deployment/client/generation/专用 MySQL principal。实际读取 MySQL 账号和权限：必须为解锁专用账号，两恢复 schema 仅有 SELECT/INSERT/UPDATE/DELETE，禁止角色继承、全局/动态权限、额外表列权限、DDL 和 GRANT OPTION；检查其他解锁账号对目标的 schema/表列/全局/继承权限。仅当前迁移管理员是明确例外，不允许其作为运行账号。没有创建或授予账号的自动动作。
- 两恢复库增加显式允许的 `enterprise_schema_registry` 控制表；复制状态为 generation=0，完整核验纳入身份和额外表闭包。激活两 fence 和 registry owner/generation 在同一事务完成。原逻辑表映射可直接复用现 Registry/compatibility verifier；后者本来就核验 logical=physical 的真实 InnoDB 表，不需伪造视图。
- 新 `20260913-enterprise-recovery-route.sql` 只建持久准备/发布记录及审计 receipt。先部署该 SQL 和此前 scheduler ownership SQL，再部署对应 API；不写入任何租户或任务 owner。
- `POST /api/platform/ops/deployments/recovery-route` 默认 `mode=plan`，要求现有 `ops.deployments:admin`。显式 `prepare` 固定现有 Runtime/部署/停用调度快照和准备 revision，审计 actor 来自认证上下文，并在事务提交之后调用现有 Platform `sign()`。重试读取同请求 receipt；异 payload 或 revision 漂移拒绝。参数包含精确 recoveryReviewHash、新 generation、instanceId、aimsSchema/assetsSchema、databaseUser/databaseHost、runtimeCode、workerDeployment/client；操作者不能用摘要替代实际 SQL owner 核验。
- `POST /api/v1/runtime/recovery-route` 单独验证 tenant/environment/runtime 对应 enrollment 的 `control_token_hash`，不接受普通用户 token，也不签发业务凭证。发布事务比较原准备快照、更新两模块 Runtime endpoint、将 scheduler ownership 设 `recovered` 并推进代际、保存 activation hash 和审计 receipt。绑定漂移或异回执重放拒绝；相同已发布回执不重复改路由。根 Console/业务前缀及原 BFF apiBase 保留。
- Gateway/ Foundation HMAC 允许显式 `recovered`，仍绑定真实 worker deployment、Runtime endpoint、storage、generation。Aims 使用同一企业 scheduler HTTP 适配器和真实 generation guard，不回 legacy API；空对象/null/未知值/非法 uint64 继续拒绝，`disabled` 继续不唤醒。未登记的旧租户原行为不变。

可执行 CLI 为 `data-runtime/cmd/hzy-enterprise-recover`。受保护配置须含原 Activation、固定 Platform 公钥（raw Ed25519 base64url）、准备原文和签名、迁移连接、专用账号、实际 replacement Runtime 配置路径、Platform HTTPS URL 和该 Runtime 控制 token。公钥来自已有受信配置，不能信任响应中任意替换的 publicKey。CLI 核对实际本地 Runtime 配置的 tenant/deployment/runtime、schema/instance/generation、Aims 原表映射和 worker 绑定；Aims/Assets 数据库都必须是已核验的新 schema 和专用 principal。

```sh
cd data-runtime
# 默认只输出可审阅 activation hash，不写数据库或网络发布。
go run ./cmd/hzy-enterprise-recover --config /protected/recovery-owner.json
# 本地实际权限/签名/恢复数据检查通过后，激活并提交回执。
go run ./cmd/hzy-enterprise-recover --config /protected/recovery-owner.json --apply --review-hash <activation-sha256> --publish
```

发布发生在 SQL commit 之后，没有跨网络事务；CLI 随后重放同回执进行只读回验，实际两部署 endpoint 或 scheduler owner 漂移均拒绝。HTTPS 重定向拒绝；失败保留唯一 owner 的激活 receipt，可重试同回执，不重拷贝新事实。CLI 的计划必须部署到相同 replacement Runtime 进程后才能发布；配置文件检查不等同远端进程已重启。真实切流仍须只读检查该 Runtime 的实际运行配置/health 和两模块业务行为；未执行这些环境动作，不能声称测试站已恢复或已切流。

验证命令：`node platform/scripts/test-recovery-route-mysql.mjs`（专属 MySQL、实际 Platform signer、真实 HTTP Runtime receipt API、控制凭证拒绝、快照漂移、原子发布和重放）；`node data-runtime/scripts/test-enterprise-recovery-mysql.mjs`（专属 MySQL、实际 Ed25519 verifier/账号权限、竞争账号与篡改拒绝、数据库恢复/激活、真实 registry 调度事务新旧代际）；Gateway scheduler 与 Foundation trust 测试覆盖 recovered 的签名构造/验签。测试使用临时账号/key/控制 token，均不代表任何业务环境凭证或 owner 可用。


## 9. 生产租户参数化（K2 方案 A，`enterprise-cutover-profile.v1`）

**K2-E 精简认可补充**：离线 CLI 从受保护 P 材料与恢复副本 provider 报告生成 HMAC 封存证据包；Platform 在 `ops.deployments` 审阅入口复核原始证据文件 SHA-256、四项 M4 闭包、冷存档人工材料、profile 固定 Platform kid/公钥指纹，并按 tenant/environment/cutoverKey/generation 唯一保存 Ed25519 签名制品，完全相同的请求只返回原制品。Go 的 `VerifyEnvelope` 与激活事务七项闭包保持不变。精简方案不引入双人复核界面、窗口 epoch 或二次签名状态机；S3 必须验证现场采证与 0600/systemd credential，不能用合成材料。


日期：2026-09-29。对应[自托管迁移 Runbook](./Go-Live-Self-Hosted-Data-Migration-Runbook.md) §3 工具缺口 K2，用户选定方案 A。代码：`data-runtime/internal/migrations/cutoverprofile`，各 CLI 的 `profile.go`。**只有本地代码与隔离 MySQL 证据，未在任何真实环境执行。**

生产自托管切换是离线切换：旧 Gateway 与日本 Runtime 的停写由 M4 控制，入口开放由 M8 的 nginx 切换控制。激活只读取 Platform 签发的 `enterprise-external-drain-approval.v1`，由 Go `Profile.VerifyEnvelope` 和激活事务复核；`enterprise-drain-release.v1` 与 `deploy/test-env/drain` JS coordinator 仅用于 C000001/test 托管云测试链路，对生产保持失败关闭。生产排空认可的 sealed 快照和 provider receipt 证据产出链仍须单独补齐并审查，不能把人工停机事实直接当成签名认可。

### 9.1 设计

不新增信任路径，只把第 3 节各阶段里写死的 C000001/test 常量换成一份受保护、经审阅的 profile。每个阶段仍调用原来的 `unified.InstallSourceFence / FenceSources / PrepareFinalCopy / Apply / ActivateFinalCopy`、`enterprise.PlanCompatibilityViews / ApplyCompatibilityViews`、`domaininstall` 与 Runtime 视图校验器。不带 `--profile` 时，各工具的 C000001/test 行为与输出逐字节不变（兼容测试见 9.5）。

阶段顺序（同一 profile、同一 cutover key）：

1. `hzy-enterprise-migrate --profile P --plan source.json`：源计划 dry-run，得到 source review hash。
2. `hzy-enterprise-test-cutover --profile P --source-plan source.json --source-review-hash H0 --output spec.json [--phase install-fence|fence --apply]`：安装 guard，再原子关闭两源写入。新主机上的源库是无写入者的恢复副本，fence 仍照常执行，作为协议证据，不做特殊跳过。
3. `... --phase prepare-final --apply --output final.json`：得到新的 final review hash H1（与 H0 不同属正常，须现场复核）。
4. `hzy-enterprise-migrate --profile P --plan final.json --apply --review-hash H1`：最终复制到 generation=0 的目标库。
5. `hzy-enterprise-compatibility-rehearsal --profile P --binding-candidate runtime-candidate.json --migration-plan final.json --artifact views.json`：默认只出计划和合并 review hash HV；复核后加 `--apply --review-hash HV` 安装并复验视图，同时确认 generation=0 时 Runtime 校验器与 ProductService 仍然拒绝。
6. `hzy-enterprise-drain --profile P --fence-plan source.json --final-plan final.json --approval approval.json`：默认只读核验，`--mode activate --apply --review-hash H1` 执行激活。
7. `hzy-enterprise-add-altoc --profile P --config runtime.json [--work-item-deletion-evidence] --mode plan|apply|verify|rollback`：需要时安装删除证据表或 Altoc 只读域。`domaininstall` 本来就要求 registry generation 等于绑定 generation（非 0），因此它只能排在第 6 步激活之后执行，并要求 Runtime 仍处于停机状态。
8. `hzy-enterprise-verify-views --profile P --config runtime.json`：以 Runtime 账号只读校验全部视图；一个视图都没有时判为失败。

### 9.2 Profile 结构

所有字段都必填，只有 `runtime.systemdUnit`/`launchdLabel` 二选一，由主机 OS 决定。未知字段一律拒绝。

```json
{
  "version": "enterprise-cutover-profile.v1",
  "tenant": "<租户码>", "environment": "prod",
  "runtimeDeployment": "<runtime deployment>", "enterpriseDeployment": "<enterprise owner deployment>",
  "sourceDeployments": { "aims": "<aims deployment>", "assets": "<assets deployment>" },
  "instanceId": "<@@server_uuid>", "schemaVersion": "<schema version>", "generation": 1,
  "sourceAims": "<aims 源副本库>", "sourceAssets": "<assets 源副本库>", "target": "<统一目标库>",
  "cutoverKey": "<稳定切换键>",
  "connection": { "host": "127.0.0.1", "port": 3306, "user": "hzy_cutover", "password": "<仅在本文件>" },
  "platform": { "keyId": "<生产 Platform 签名 kid>", "publicKey": "<raw Ed25519 base64url>" },
  "runtime": { "listen": "127.0.0.1:<port>", "systemdUnit": "<unit>.service" }
}
```

读取规则：`O_NOFOLLOW` 打开；必须是当前用户拥有的普通文件，且无 group/other 权限位（0600）；profile 不超过 64 KiB，plan/approval/Runtime 配置不超过 32 MiB。profile 模式下，计划、审批信封和 Runtime 配置同样按此规则读取。输出只含租户、环境、部署、库名、generation 和各 hash，不输出 DSN、密码或文件内容；MySQL 错误只报错误码。

### 9.3 护栏

- **环境**：只接受 `prod/test/dev`，与 Platform policy verifier 一致。`staging`、`production` 等值在读取 profile 时即被拒绝。
- **每次写入都需审阅 hash**：默认 dry-run 或 plan；写入必须同时给出 `--apply` 与精确 hash（install-fence/fence/prepare-final 用 H0，apply 与 activate 用 H1，视图用 HV，域安装用 domaininstall plan hash）。`--cutover-key` 只能省略，或与 profile 中的值完全一致。
- **跨租户**：以下几处必须两两一致：plan 的 `unified.Config` 与 profile；Runtime 配置的 tenant/deployment/environment 及 binding（实例、目标库、schemaVersion、generation、aims/assets owner）与 profile；目标库 `enterprise_schema_registry`（tenant/environment/runtime/schemaVersion）与 profile；源 fence 行的 tenant；审批信封签名内的 tenant/environment/runtimeDeployment/instanceId/cutoverKey/generation。任一处不一致即拒绝。
- **目标已激活**：registry generation≠0 或 ledger=`active` 时，install-fence/fence/prepare-final/apply/视图安装全部拒绝，并提示改走第 7、8 节已审阅的恢复路径（`hzy-enterprise-migrate --recovery`、`hzy-enterprise-recover`）。drain 只允许同一 cutover key、同一 H1、同一 generation 的已提交回执重放，用于响应丢失后的幂等重试。
- **最终复制只接受已 fence 的源**：profile 模式的 `migrate --apply` 要求两源 fence 均为 `fenced`，且 transition_key 等于 profile 的 cutover key。
- **激活仍需 Platform 签名**：信封必须满足 `alg=Ed25519`、`kid` 等于配置的 `platform.keyId`，并用固定配置的 `platform.publicKey` 验证签名；信封自带的 `publicKey` 只能为空或与固定公钥一致，否则拒绝。之后仍由原 `SQLApprovedExternalDrains` 在激活事务内复核完整闭包。profile 模式不提供 unsigned、自签或本地批准路径。
- **账号**：拒绝 `root`；`SHOW GRANTS` 中出现 `ON *.*` 的 `ALL PRIVILEGES/SUPER/GRANT OPTION/SYSTEM_USER/SET_USER_ID/CREATE USER` 时拒绝。
- **域安装前 Runtime 必须停机**：Linux 上 systemd unit 须为 `disabled|masked` 且 `inactive|failed`；macOS 上须是显式 disabled 的 launchd 且已 bootout；两者都还要求 listen 地址拒绝连接。任何未知状态都失败关闭，没有覆盖开关。

### 9.4 最小权限账号说明

K2 阶段使用专用 `hzy_cutover`（名称可自定），只授 schema 级权限，不授全局权限，不带 GRANT OPTION。库名中的 `_` 在 GRANT 中是通配符，需写成 `\_`：

- 两源副本库：`SELECT, INSERT, UPDATE, CREATE, TRIGGER`。用于 fence 表与 guard 安装、fence 行加锁更新，以及 drain 探针（`FOR SHARE` 需要 SELECT+UPDATE）。
- 统一目标库：`SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX, REFERENCES, TRIGGER, CREATE VIEW, SHOW VIEW`。其中 schema 级 `CREATE` 允许创建该名称的库。
- 需要回滚域安装时，再对目标库临时追加 `DROP`，用完即收回。
- Runtime 业务账号只授目标库的 `SELECT, INSERT, UPDATE, DELETE`，`verify-views` 只需要 `SELECT, SHOW VIEW`。Runtime 业务账号永不执行 DDL。
- 恢复 dump 使用的 `hzy_migrator` 若带全局权限，会被 profile 工具拒绝，这是有意为之，K2 阶段须换用上述专用账号。guard trigger 的 DEFINER 为 `hzy_cutover`，因此切换完成前不得删除该账号；业务运行账号不得获得 fence 表写权限或 TRIGGER/DROP 权限（见第 1 节）。

### 9.5 验证

`node data-runtime/scripts/test-enterprise-cutover-profile-mysql.mjs` 使用专属临时 MySQL（随机端口/datadir），执行 `go test -race ./internal/migrations/cutoverprofile`，覆盖以下三部分：

- **合成生产租户 `T900001/prod`（非 C000001）的完整流程**：实际构建并调用上述 6 个 CLI，使用无全局权限的专用账号。流程为源计划 → install-fence → fence（旧写被拒）→ prepare-final → final apply → 57 个兼容视图 → 签名信封 verify/activate/重放 → 删除证据域安装 → verify-views 58/58。随后确认源库保持 fenced、目标库业务 trigger 保留。
- **拒绝项**：未知环境、root、非 0600 profile；缺失或错误的 review hash、缺 `--apply`、cutover key 不符；跨租户的 plan、registry、Runtime 配置与信封；已激活 generation 后的重复写入；unsigned、他人私钥签名、自带公钥的自签、错误 kid 的信封；Runtime 未证明停机时的域安装 apply；陈旧 generation 的 verify-views。
- **C000001/test 兼容**：沿用原 config 形态和固定库名，跑完 migrate/plan/install-fence/fence/prepare-final/apply，成功时 stdout 仍为空；固定 final-test hash 门禁仍拒绝其他 hash。

另有单元测试：profile 校验、文件保护、信封、plan/binding 绑定、停机解析、`domaininstall.Expectation`。`go test ./...` 全部通过。域安装 happy path 中，停机证明使用测试 fixture，因为本机不能停用真实 service；CLI 的停机拒绝路径另有覆盖。

### 9.6 仍需完成（不属于本实现）

- **新生产 Platform 的签名端**：`platform/server/utils/enterpriseExternalDrainApproval.ts` 已改为在审批事务中核对 active 租户、ready Runtime 与同租户同环境 active 的来源及服务部署；输入报告不得自行指定未登记的部署。签名沿用当前 active Platform Ed25519 key，信封返回 `kid` 与 raw 公钥（base64url），与 profile 固定值逐字段匹配。`instanceId` 不在 Platform Runtime 登记表内，仍由来源报告提供并由 Runtime profile 固定值及目标库校验。代码只经隔离测试；新生产 Platform 发布、实际签名及 profile 公钥登记另行批准。审批仍以 seal、证据分类和人工决策闭包为前提，不得降级。**现有 sealed 快照只由 test coordinator 生成，provider collector 仅有测试脚本调用；生产离线证据包的正式产出步骤仍缺失。**
- **S3 演练**：在新主机恢复副本上用真实 150 表闭包跑两轮，记录每阶段耗时，核实 `hzy_cutover` 授权；确认生产 Aims/Assets 源副本（补齐 v5.x 迁移后）的 final plan 无 blocking conflicts，并确认 Runtime 候选配置的域映射与视图清单一致。真实 external drain 的 seal/证据由新 Platform 产出。
- 激活后的路由发布、Gateway 读回与业务验收，仍按 Runbook §6 的 C8–C10 执行；数据库 active 不等于入口可用。

## 10. JSON 列可执行契约（`json_field_contract_unregistered`）

日期：2026-09-29。不变量：被复制的每一个有数据的 JSON 列都必须有可执行校验器，没有 allowlist，也不放宽 gate。规划阶段依次执行三项检查，任一项非空即写入 `blocking_conflicts`：

1. `inspectUnregisteredJSON`：`information_schema` 中 `DATA_TYPE='json'` 且非空的列，若不在 `registeredJSONFields` 则报 `json_field_contract_unregistered`。
2. `inspectValueOnlyJSON`：对 `valueOnlyJSONFields` 里登记的列逐行运行校验器，失败报 `json_value_payload_invalid`。
3. `inspectSnapshotHashes`：`aims.approval_records` 的 `snapshot_json` 用 `jsoncontract.CanonicalSHA256`（紧凑、按键排序的 JSON）复算并与 `snapshot_sha256` 比较，不符报 `json_snapshot_hash_mismatch`；SQL NULL 快照为旧流程，不检查。

共享形状放在 `data-runtime/internal/jsoncontract`，写入方与 gate 使用同一个函数，因此“写入被拒绝的 payload 恰好是 gate 会阻断的 payload”。S3 演练的 11 项缺口已全部补齐（明细与决策见 [Enterprise-JSON-Contract-Gap-Inventory.md](./Enterprise-JSON-Contract-Gap-Inventory.md)）：

| 列 | 校验（`jsoncontract`） |
| --- | --- |
| `aims_projects.access_whitelist` | `AccessWhitelist`：非空、已 trim、无重复的 uid 字符串数组，uid ≤128 字符，≤1000 项 |
| `aims_projects.module_config` | `ProjectModuleConfig`：封闭键集。布尔开关 `decomposition/environments/milestones/releases/requirements/service_desk/workflows`，以及前端仍读取的旧别名 `milestonesEnabled/processAuditEnabled`；字符串 `legacyProjectType/legacySource`（≤64）。未知键与错误类型一律拒绝 |
| `approval_records.snapshot_json` | `ApprovalSnapshot`：`aims.milestone-completion-request.v1` 键集与类型，加 SHA-256 复算 |
| `deliverable_quality_reviews.checklist_result_json` | `QualityReviewResult`：`aims.deliverable-quality-review.v1`，`stage` 枚举，64 位小写十六进制 |
| `deliverable_submissions.evidence_snapshot_json` | `SubmissionEvidence`：`...evidence.v2`，按 `documentSource`（`codocs`/`repo`）区分必需键集 |
| `project_template_versions.definition_json` | `TemplateDefinition`：里程碑 → 工作项 → 交付物，封闭键集，允许 `description`、`workItems`、`deliverables` 为 null |
| `qa_checklist_versions.items_json` | `QAChecklistItems`：非空 `{code,label,required}` 数组，`code` 唯一 |
| `asset_events.event_data` | `EventData`：开放事件载荷，顶层对象、键非空 ≤64 字符、嵌套深度 ≤8、序列化 ≤64 KiB、数字有限；各事件类型的键集保持开放 |
| `asset_items.tags`、`product_assets.customer_domain` | `StringList`（与 `supported_terminals` 同族） |
| `purchase_orders.attachments` | `Attachments`：≤50 项 `{name,url}`，均为非空字符串（name ≤255，url ≤2048） |

写入侧加固：`aims_projects.access_whitelist` 的两条创建路径（`product_versions.go`、`service_contract_bridge.go`）改用 `accessWhitelistJSONText`，`asset_items.tags` 与 `purchase_orders.attachments` 的创建/更新改用 `contractJSONOrNil`，不合规形状返回 400。`helpers.go` 的 `parseJSONList` 读取时仍对坏数据返回空数组（避免一条历史坏行拖垮列表接口），已在注释中说明其依赖写入校验与 gate。`asset_events.event_data` 只由服务端 `insertEvent` 以 map 构造。

验证：`node data-runtime/scripts/test-enterprise-migration-conflicts-mysql.mjs`（隔离 MySQL）中的 `TestJSONContractGapMySQL` 用盘点得到的全部形状规划得到 0 条阻断，并对每列的破坏性变体各产出阻断。**本节仅有本地代码与隔离 MySQL 证据；在 S3 副本重跑 `--plan` 并确认 `blocking_conflicts=0` 尚未执行，正式 M6 前须对最终快照重新盘点。**
