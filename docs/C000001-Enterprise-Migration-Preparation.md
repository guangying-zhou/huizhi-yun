# C000001 统一库启用准备

> 状态更新（2026-09-14）：目标统一库已激活 generation=1。下文早期“目标不存在/四项预授权”的段落保留为历史准备快照；当前专用账号事实以“实际目标账号补充核验”小节和对应最新回执为准。

本文件记录实际本机测试库的只读核验及待执行依赖。已于 2026-09-13T20:32:33Z 应用 Assets owned receipt CHECK 前置迁移；没有创建目标库、授权账号、安装源 fence、迁移业务行或切换请求。完整数据计划与候选制品位于 `deploy/test-env/artifacts/`。

## 已核实的现状

- tenant：`C000001`；Runtime deployment：`c000001-test-tenant-runtime`；MySQL instance UUID：`37d8994e-4c12-11ee-afad-8cb2da2e572b`。
- 源：`hzy_aims_test_local_20260910`（113 表）和 `hzy_assets_test_local_20260910`（37 表），合计 150 表、478 行、38 个原 trigger。
- Assets CHECK 与出站表迁移后重新运行 CLI 默认 dry-run，当前 source plan review hash 为 `5404dd29e3374a66cb7180670a2850ade0e61414ae250464775e58c16c5eda97`。150 表 DDL、主键、列、trigger 和数据 count/hash 均在具体计划中，未用新编映射替代。
- 拟定目标 `hzy_enterprise_shadow_review_20260913` 不存在；两源均未安装 `enterprise_source_fence`。它现在只是被保留的目标名称，不是已部署统一数据库。
- Aims `integration_operation`、attempt、dead-letter actionable、product document creation request 以及两域 service command receipt 当前均 0 行。库内待排空 operation=0 **不等于**外部 worker、通知、在途 HTTP/文件副作用已排空。
- 2026-09-13T20:27:30Z 只读复核：当前本地 Runtime `enterprise.enabled=false`，`/runtime/healthz` 为 200，版本 `0.3.219-test.adr018-candidate.2`，二进制 SHA-256 为 `cb5c2d15c2f4c70c0bf47f25ca7c86bd93deed7c5c6980c49b15b583b5659e12`。该制品已更新并验证旧路径，但不包含随后新增的 Assets 主档/分类共享写入、owned receipt 和切换观察入口；不能据健康检查启用这些路径。

## 最小权限用户元数据

用户为 `hzy_enterprise_test_runtime@localhost`，仅用于新统一 schema。此次刷新通过受保护的管理员连接只读查询了账号、全局权限和 schema grant：账号存在，全局仅 `USAGE`，目标 schema grant 元数据为 `SELECT/INSERT/UPDATE/DELETE` 且不可转授。目标 schema 仍不存在，因此这些预授权不计为有效目标 DML，`targetDmlVerified=false`；必须在目标创建后重新做实际连接和表级读写验收。源 Runtime 连接自身没有全局 DML 权限。

`C000001.enterprise-principal.verify.sql` 是管理员连接下的只读账号/权限核验，不查询 authentication_string/password。`C000001.enterprise-principal.candidate.sql` 仅列四项非全局 DML grant，未执行且不创建账号。新密码必须由实际安全配置流程交付；Runtime 配置候选中 password=null，不能直接部署。迁移协调者安装 fence/DDL/view 所需权限与 Runtime 四项 DML 权限分开，不给运行账号 CREATE/ALTER/DROP/TRIGGER/EVENT/FILE/SUPER/GRANT OPTION 或角色继承。

## 可复核制品

| 制品 | 内容与边界 |
| --- | --- |
| `C000001.enterprise-migration-plan.json` | 实际 CLI 输出，150 表、完整 DDL/trigger/count/hash；只含迁移身份，不含连接凭据 |
| `C000001.enterprise-source-readiness.json` | 当前源/目标/异步表计数、权限可见性、实际 Runtime 二进制/健康证据 |
| `C000001.enterprise-runtime.candidate.json` | 精确 113+34 映射、真实既有 deployment bindings、保留 Aims worker；全局 enabled=false，principal/secret 尚未交付 |
| `C000001.enterprise-compatibility-views.candidate.sql` | 55 个候选 Aims 兼容视图，列来自真实计划；SQL SECURITY INVOKER、ALGORITHM=MERGE |
| `C000001.enterprise-compatibility-views.sources.json` | 调用源码 hash、逻辑名清单；排除两域重名 service_command_receipt/system_parameters，后者继续显式映射 |
| `C000001.enterprise-registry.verify.sql` | 最终复制后的只读 registry 身份/generation=0 核对 |
| 两个 `enterprise-principal.*.sql` | 只读管理员核验与尚未执行的最小 grant 候选 |

Runtime 候选已经通过现有 `Config.EnterpriseBinding()` 静态校验；这不证明尚不存在的目标、账号、密码可连接。兼容视图候选不是伪造的正式 `CompatibilityViewPlan`：目标目前不存在，必须在真实最终复制后调用 `PlanCompatibilityViews` 读取目标列/registry、生成新 review hash，再安装并由业务 Service 构造器验证。

## 下一步命令和顺序

当前可重复执行的只读命令（凭据只在内存和随即删除的 0600 临时文件中）：

```sh
node deploy/test-env/enterprise-source-plan.mjs /tmp/C000001.enterprise-current-plan.json
node deploy/test-env/enterprise-source-readiness.mjs /tmp/C000001.enterprise-current-plan.json deploy/test-env/artifacts/C000001.enterprise-source-readiness.json
```

Runtime `0.3.219-test.adr018-candidate.4` 已部署到本机 `darwin/arm64` 测试环境，实际二进制、完整race检查、原配置不变及health证据见[部署回执](../deploy/test-env/artifacts/C000001.runtime-candidate4-deployment.json)。Enterprise及合同开关仍关闭。正式启用前仍须核对最终release/schema/Registry/调度所有权；candidate.4不包含之后新增的AA-04事务核心及入口接线，不能据当前源码推断线上能力。后续新制品继续使用明确测试版本、固定源码摘要与二进制hash，并保留回退。

源库 schema 前置变更：在部署支持 Assets owned receipt 的新制品前，先对精确 Assets 源库应用 `assets/docs/migrations/20260913_assets_owned_product_receipts.sql`，并验证约束处于 ENFORCED 状态。该迁移保留跨应用回执，仅允许受限的 Assets 同域产品/分类命令。应用后必须重新生成源计划及 review hash，不能继续使用本页当前 hash。已有同域回执后不得恢复旧 CHECK 或删除回执来回退；应保留兼容 schema 与命令身份。实际源库已应用此迁移，后续只读观察确认 marker 存在且 ENFORCED。原 DDL 与执行回执保存在受保护 Runtime 目录；脱敏回执见 `deploy/test-env/artifacts/C000001.assets-owned-receipt-migration.json`。执行器 `enterprise-assets-receipt-migration.mjs` 默认只读，`--apply` 要求精确 review hash、实例/库绑定与独占迁移锁，并设置 5 秒元数据锁等待。此执行仅改变 CHECK，不修改业务行或启用路由。后续以错误 review hash 执行负例，得到 `REVIEW_HASH_MISMATCH` 并退出 1；再次只读 plan 确认 DDL hash 仍为迁移后的 `108eda2621bb08c5ed4d439a600d78f9736b59ad1e19fc6218668f47e59bf418`，没有重复执行 DDL。

本次刷新已用当前 source plan hash `5404dd29e3374a66cb7180670a2850ade0e61414ae250464775e58c16c5eda97` 重新生成 source-readiness、候选制品和 preparation manifest；manifest 已包含脱敏 principal provisioning receipt 并完成文件 hash。目标 schema 仍不存在，专用账号的四项 grant 仅为管理员观察到的预授权，不能作为有效目标 DML 通过。

除上述 CHECK 前置迁移外，后续有写入的步骤均未执行：

1. 用批准的本地管理员连接执行只读 principal 核验；交付专用账号/密码，审查源和目标身份。权限候选不是已授权或已验证的事实。
2. 明确实际维护窗口和 cutover key，准备并审阅 `BuildFenceSpec`。若先复制本计划做影子演练，必须为最终复制选择另一个全新目标，并重新冻结对应 fence 合同；不能覆盖影子或旧源库。当前目标仍为空，也可保留它仅供停写后的最终复制使用。
3. 部署并验证实际新 Runtime 制品和冻结配置；保持企业入口/调度停用，独立核实真实外部 worker/通知/在途副作用排空。
4. 显式 `InstallSourceFence` → `FenceSources` → `PrepareFinalCopy`。最终计划包含当前150张业务表和2张fence表（执行时重查），产生新的 review hash，不能拿当前 pre-fence 150 表 hash 直接激活。
5. 审阅最终计划后调用现有 `Apply`，目标保持 generation=0/fenced。执行正式兼容视图 plan/install/verify、最小账号连接验证和 registry 身份核验。
6. 实际外部 drain verifier 通过后显式 `ActivateFinalCopy`，再对齐 Platform scheduler ownership、Gateway/Host 路由及 Runtime generation，进行真实授权、写入、receipt/重放和页面回验。
7. 激活前准备第 7/8 节 Cutover 恢复合同中的两个全新恢复 schema 名、固定 Platform 公钥、真实 Runtime control credential 和安全保存的原最终计划。恢复 CLI 默认 plan，不能以旧备份或解除源 fence 代替反向复制。

具体算法和写入 API 见 [切换与恢复协议](./Unified-Enterprise-Cutover-Protocol.md)。本准备包不能标记实际数据库迁移、调度接管或测试站切换完成。

## 2026-09-14 专用账号交付

用户提供的 Runtime 示例环境管理连接已核对正确实例和建用户/授权能力。
`hzy_enterprise_test_runtime@localhost` 已创建，仅拥有拟定目标库的四项不可转授 DML，
全局仅 USAGE，无表级、继承角色或动态权限；账号登录和实例 UUID 验证通过。
[脱敏回执](../deploy/test-env/artifacts/C000001.enterprise-principal-provisioning.json)。
先前“管理员配置待交付/账号未知”的观察已被本次证据取代。

管理员和新账号连接分别保存在受保护 Runtime 目录的 `enterprise-migration-admin.json`、
`enterprise-principal.json`，权限0600；原 `.env.example` 安全备份后仅清空数据库密码字段。
目标 schema 尚不存在，未验证目标 DML、未修改当前 Runtime 配置或启用统一路径。
后续迁移使用管理员连接，新运行路径只使用专用账号；最终复制后仍需实际表读写权限验收。

## 2026-09-14 实际目标账号补充核验

目标库 `hzy_enterprise_shadow_review_20260913` 已完成统一库激活并登记 generation=1。Runtime 专用账号在该目标库保留四项不可转授 schema 级 DML，并对 55 个受管兼容视图逐个授予不可转授的 TABLE 级 `SHOW VIEW`；这是构造器读取这些视图 `VIEW_DEFINITION` 所需的元数据权限。不授予 schema 级 `SHOW VIEW`，也不授予 CREATE、ALTER、DROP、TRIGGER、EVENT、FILE、SUPER、GRANT OPTION 或角色继承。该授权不扩大源库权限，也不改变业务表写权限。

实际目标权限核验和 55 个兼容视图安装/读取结果记录在[专用账号补充回执](../deploy/test-env/artifacts/C000001.enterprise-principal-provisioning.json)。后续权限变更必须继续以目标库精确授权和只读管理员核验为边界。

## 2026-09-14 实际独立影子复制完成

已按 review hash `6f45f24ffa4c64a4fb8914eea4c76323660d7bdcc1ea05a3dd73a14672817570`
复制到独立演练库 `hzy_enterprise_rehearsal_20260914`：147张业务表、478行、38个触发器，
147个checkpoint全部verified，ledger为verified-shadow。CLI核验逐表count/hash、外键及触发器；
目标登记generation=0，未激活。源fence表仍为0，原正式目标未使用。
[脱敏复制回执](../deploy/test-env/artifacts/C000001.enterprise-rehearsal-copy.json)。
此次演练副本不是正式权威库；最终切换仍需排空/冻结后的新计划、正式复制和业务验收。

影子库随后通过正式视图 plan/apply API 安装并再次核验55个受管视图（Aims44/Assets11），
全部为可更新的 SQL SECURITY INVOKER，逐视图 COUNT 读取成功；150张基础表不变。
[视图回执](../deploy/test-env/artifacts/C000001.enterprise-rehearsal-views.json)。
登记仍为generation=0，所以正式 `VerifyCompatibilityViews` 与产品服务构造器按设计拒绝
generation=1的运行绑定；未绕过激活条件，不能将这些直接视图读取称为实际业务接口验收。

### 2026-09-14 出站表补齐后的计划刷新

测试Assets新增3张空出站表，原147张表的计划内容逐项未变。当前正式复制计划为150张业务表、478行，review hash为 `5404dd29e3374a66cb7180670a2850ade0e61414ae250464775e58c16c5eda97`。source-readiness、55视图候选及preparation manifest已重新生成；正式目标仍不存在、源栅栏未启用。此前独立演练的147表证据是历史快照，不覆盖新增3表，不能直接作为当前最终复制验收。

## 150表完整影子演练（2026-09-14）

新独立演练库 `hzy_enterprise_rehearsal_20260914b` 已完成150张业务表、478行、38个触发器的复制，150/150 checkpoint verified，55个兼容视图安装完成，registry身份匹配且generation=0。该轮覆盖新增3张Assets出站表；旧147表收据保留为历史。

[本轮收据](../deploy/test-env/artifacts/C000001.enterprise-rehearsal-150-copy-20260914b.json)绑定正式源计划hash与独立演练review hash。源fence仍为0，未触及正式目标、Runtime配置或流量。此演练证明复制/映射可执行，不替代最终fenced copy或真实业务权限验收。
