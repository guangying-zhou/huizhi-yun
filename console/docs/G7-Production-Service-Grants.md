# G-7 生产服务授权制品（候选，尚未执行）

入口：`console/scripts/g7-prod-grants.mjs`；SQL 是 `sql/Console-SQL-{Seed,Repair,Verify,Rollback}-v2.33-prod-service-grants.sql`。配置形状见 `G7-Production-Service-Grants.config.example.json`；示例只有占位值。工具只从权限为 0600 的 JSON 配置读取目标数据库与显式 `tenant`、`deployments.enterprise/workflow/aims/codocs/console`，不提供隐式测试部署编码，也不打印连接信息或凭据。

部署编码须与已登记的生产事实一致：`${tenant}-prod-enterprise` 为新增 Enterprise；`${tenant}-workflow`、`${tenant}-aims`、`${tenant}-codocs`、`${tenant}-console` 沿用现有部署。工具拒绝把后四者误写成 `${tenant}-prod-*`。

顺序：加密备份并验证可解密 → `--plan <config>`，逐 ID 审阅 `before/after` 与 reviewHash → `--apply <config> <reviewHash> <new-0600-receipt-path>` → `--verify <config>` → 另经正式凭据签发流程登记 service client secret，再运行参数化签发探测。任何真实环境执行都需要另行批准；本文档和隔离 MySQL 演练不构成批准。

回滚：在新凭据登记前执行 `--rollback <config> <receipt-path> <reviewHash>`；工具先校验已改目标行与全部非目标 grant 的全字段哈希，再删本次新行、恢复原行。若企业客户端已获凭据或出现数据漂移则拒绝自动回滚，须审阅新的逐行计划。回执文件含 grant 元数据而无秘密，仍须 0600 保护。

`enterprise.runtime` 新增 20 项：五域 Host 执行（`data-runtime`）、策略读取（`data-runtime`）、Workflow proxy（`workflow`）、通知发布（`notifications`），以及 `deploy/test-env/enterprise-readiness.template.json` 中 Aims 6、Codocs 2、Console 3 项外部服务 scope。另有 `console:authorization-role-holders:read`（audience `console`，`roleCodes` 严格为 `["project_director"]`），用于周报治理查询；verify 拒绝更宽的角色集合。`workflow.runtime` 两个 audience 各一项；`aims.runtime` 两个 audience 各两项，另加 `aud=codocs` 的 `codocs:company-weekly-summary:publish`；`codocs.runtime` 增补或规范化既有 `data-runtime:codocs/write`（semanticScope=`codocs.write`），用于 Codocs 回写自身 Runtime。六条既有 OSS grant（旧生产 ID 439/440/628435/628436/628447/628448）仅补缺失的 audience、semanticScope、tenantCode 与 deploymentCode；保留原 integrationCodes、usageTypes、source、status 等字段。前缀行 semanticScope 保留自身前缀，避免 policy conflict；缺行、revoked 或已有冲突绑定均停止，不自动补建或复活。旧复数形式撤销，旧单数形式绑定或与重复匹配项冲突撤销；`notifications-due` 不授予。除六条保留原 source 的 OSS 旧行外，其余新增/修复行写入 tenant、来源部署、audience、semanticScope 与独立来源 `seed:g7-prod-service-grants`；不复活 revoked。

`console.runtime` 的策略存储读写由 Runtime 自有 bootstrap 与既有 `Console-SQL-Seed-policy-bundle-grants.sql` 管理，原 seed 没有部署常量，故无需参数化改写；G-7 verify 对 read/write 各要求一条 active，签发探测增加其 data-runtime read 正例。该特殊 issuer 路径允许 data-runtime/tenant-runtime，仍需在目标环境用真实客户端确认。

**可选 `collab.runtime`（共享个人文档协作，2026-09-29）：** 配置的 `bindings.deployments.collab`（必须为 `${tenant}-collab`）存在时，目录增加 2 项 `collab.runtime` → `aud=data-runtime`、`codocs:collaboration-snapshots:read|publish`（物理 `data-runtime:codocs:collaboration-snapshots` + `read|publish`），共 36 项；缺省时仍是 34 项且 reviewHash 不变。缺失的 `collab.runtime` client 由 `collab-service-client` 语句创建（无凭据指针、无秘密；回滚仅在仍无凭据时删除），同名但 `app_code` 不是 `collab` 或非 active 的记录一律拒绝。这两项能力取自 `collab/src/utils/v2-snapshots.ts` 实际请求值，并由 Runtime `codocs_collaboration_snapshots.go` 与 codocs manifest 交叉断言（`console/test/collabRuntimeGrantContract.test.ts`），不新增 capability。仅注册 Collab、不动其它 client 时用 `console/scripts/collab-prod-registration.mjs`（配置形状见 `Collab-Production-Registration.config.example.json`；`--plan` / `--apply <hash> <receipt>` / `--verify` / `--rollback <receipt> <hash>`）：同一清单、独立 reviewHash 与回执，拒绝额外的 active grant、已吊销行和外部绑定。隔离演练：`node console/scripts/test-collab-prod-registration-mysql.mjs`、`test-g7-prod-grants-mysql.mjs`（含 collab 段）。

探测脚本：`deploy/self-hosted/probe-prod-service-tokens.mjs`。21 个成功项（含 role-holders、Aims→Codocs、Codocs→Runtime 与六条 OSS grant）、`notifications-due` 1 个 403，以及缺能力、错 audience/source/tenant/deployment 、周报专属四项及 Codocs OSS 六项反例和 v2.28 旧 scope 的拒绝项。逐个校验成功 Token 的 aud/scope/source_app/tenant/deployment/exp；输出只含 case、client、audience、scope、HTTP 状态。`expiredTokenProbe` 从 0600 文件读取事先准备的已过期服务 Token，对指定 HTTPS 只读端点要求 401；脚本不生成或打印 Token。
探测配置形状见 `deploy/self-hosted/probe-prod-service-tokens.config.example.json`（仅占位值）。

## 生产 seed v1.92 别名（P0-12，2026-09-30）

R3 彩排在恢复的生产 `hzy_console` 副本上发现：`aims.runtime` 的 `data-runtime:aims:integration_operation` 与 `tenant-runtime:aims:integration_operation`（`execute`，seed v1.92，行 12921045/12921046）的 `scope_json` 没有 `audience` 键，`semanticScope` 是带 audience 前缀的物理形式（如 `tenant-runtime:aims:integration_operation:execute`）。签发映射（`mapServiceAudienceScopes`）不授权未绑定 audience 的 grant，所以这两行无论请求短形式还是物理形式都签发不出来；旧版 `--plan` 则以 `G7_SEMANTIC_CONFLICT` 拒绝。

修复：`--plan` 只接受两种既有 `semanticScope`：与短形式完全相等，或恰为“本行自身 audience + `:` + 短形式”（行绑定了 audience 用该值；未绑定则取其物理 `resource_code` 的 audience 前缀，且必须等于目录 audience）。别的前缀、大小写差异、多段前缀、前缀与本行 audience 不一致仍报 `G7_SEMANTIC_CONFLICT`。别名行走 `bind`：写入短形式 `semanticScope`、`audience`、租户与部署绑定，其余字段保留；原值记录在计划的 `before`（进入 reviewHash）和回执的 `restoredRows`，`--rollback` 逐字还原。签发侧：改写前两行都签发不出；改写后请求短形式或物理形式均签发同一 grant，请求其它 audience 被拒（Go 回归测试 `TestProductionAimsWorkerGrantsAreOnlyIssuableAfterG7Binding`）。
