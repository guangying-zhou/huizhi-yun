# Wiztek Console → Tenant Runtime 生产切换 Runbook

状态：生产切换与 Console DB ACL 收口完成；72 小时观察中  
日期：2026-07-18  
适用租户：`wiztek`

本 Runbook 只描述操作顺序。执行人必须使用受审批的生产凭证和变更单。
不得把密码、token、DSN 或私钥粘贴到终端历史、工单正文或聊天记录。

## 1. 角色与停止条件

至少需要：

- 变更负责人：决定继续、暂停或回滚；
- Runtime 负责人：部署、schema 和数据核验；
- Console/Cloudflare 负责人：发布和浏览器验收；
- DBA/安全负责人：备份、grant 和网络 ACL；
- 业务验收人：登录、目录、通知、Vault/Integration 流程。

出现以下任一情况立即停止：

- Runtime schema 不是 ready；
- `mode=cutover` 返回任一 blocker 或 schema revision 与待发布版本不一致；
- tenant/deployment 可被请求覆盖；
- Console 出现 DB fallback、跨租户数据或 secret 泄漏；
- 登录/refresh/离职撤销、幂等或可靠 operation 语义不一致；
- 关键错误率或 P95 超过批准阈值。

## 2. T-7 天：准备

1. 记录待发布的 Console、Foundation、Data Runtime commit/release。
2. 在隔离环境恢复最近备份并运行一致性检查。
3. 创建 Tenant Runtime 专用 DB identity，限制到 Runtime 主机和所需 schema。
   Schema migration 与日常 Runtime 使用不同账号；Runtime 账号不得拥有全局权限、
   `GRANT OPTION` 或永久 DDL 权限。
4. 确认 Console、Platform、Cloudflare env 中没有 DB/Vault/OIDC private 配置。
5. 执行离线门禁：

```bash
pnpm run audit:console-db-boundary
pnpm run validate:console-runtime-schema
pnpm run verify:console-zero-db-cutover
pnpm --dir console run typecheck
pnpm --dir console run test
pnpm --dir foundation run typecheck
pnpm --dir foundation run test
(cd data-runtime && go test ./...)
```

### 2.1 Wiztek 数据库基线与备份门禁

`2026-07-18` 初始只读审计确认：

- MySQL `8.0.45`，56 张业务表全部为 InnoDB，当前数据与索引约 50 MiB；
- binlog 已启用、格式为 ROW，GTID 未启用；一致性备份必须记录 binlog file/position；
- Runtime 当前错误地使用 `root@%`，并拥有全局 `GRANT OPTION`；实际 Runtime
  数据库连接来自 `localhost`。该身份不满足切换条件，迁移完成前必须替换。

维护窗口已完成一致性备份和隔离恢复演练；Console/Directory 当前使用
`hzy_console_runtime@localhost`，只具有 DML 和临时表权限。其他应用的旧本机身份
要在 Aims 启动期 DDL 移出 Runtime 进程后再收口，不能用一次性全局换号破坏启动。

DBA 必须在受控主机和密钥管理会话中完成以下动作：

1. 使用独立备份账号执行 `--single-transaction --quick --no-tablespaces` 的逻辑备份，
   包含 routines、events、triggers 和 hex-blob；记录开始/完成时间、binlog
   file/position、文件大小和 SHA-256，并用企业 KMS 加密后存入受控备份库。
2. 在隔离数据库恢复完整数据；核对表数、逐表行数、关键 current pointer 和备份
   SHA-256，再在恢复副本上应用本 Runbook 的 schema migration。
3. 恢复演练与 migration 均通过后，才在生产维护窗口执行 DDL。结构副本测试、
   未加密本地副本或仅验证 dump 命令成功均不能替代恢复演练。
4. 在生产数据库本机创建专用账号；账号名可按企业规范调整，host 必须是
   `localhost`，密码由 MySQL 随机生成并直接进入企业 secret manager：

```sql
CREATE USER 'hzy_console_runtime'@'localhost' IDENTIFIED BY RANDOM PASSWORD;
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE TEMPORARY TABLES
  ON hzy_console.* TO 'hzy_console_runtime'@'localhost';
```

若账号已存在则停止并审计，不能用 `IF NOT EXISTS` 掩盖旧 grant。Runtime 专用账号
不得获得 `CREATE`、`ALTER`、`DROP`、`INDEX`、`FILE`、`PROCESS`、`SUPER`、
`CREATE USER`、`GRANT OPTION` 或任何全局权限。密码不得出现在 shell history、
源码、普通工单或聊天中。

5. 将专用账号通过受控 secret 注入到 `HZY_CONSOLE_DB_USER/PASSWORD`；重启后先验证
   Runtime health 和临时表目录同步，再撤销旧 root 凭据。旧 root 账号的最终锁定、
   host 收口与网络 ACL 撤销仍在 P8-D 执行。

## 3. T-1 天：预发布

1. 部署 Data Runtime 到测试/影子实例。
2. 应用 Console adapter schema migration：

   - 文件：`console/docs/console_tenant_runtime_cutover_20260718.sql`
   - SHA-256：
     `9a2fbb01c4edb1d745fc350138dc1186d22c5359bdbe82c8054e99965d93411e`
   - 当前目标 Runtime schema revision：
     `sha256:3f65861f15afa34691b4f9751751f984afd2f82716dc876203f19133843fbcc3`
   - `0.3.132` 还要求执行两份可重复、纯增量的可靠操作迁移：
     `directory_lifecycle_outbox_audit_20260718.sql`（SHA-256
     `ace4b321aad74e6477a1935f2c85b73edb57860af81049805bca6a450946bb78`）
     和 `service_command_receipt_reliability_20260718.sql`（SHA-256
     `a537f0176f2ddb909e0c83fc9e7dd1078d09e1f7d80b090f2cc60156a720911d`）。

   执行前必须先验证文件哈希。该迁移只允许在一致性备份和隔离恢复演练通过后
   执行；任一 DDL 失败即停止，不允许跳过约束或临时关闭外键检查。
3. 在生产 Runtime 主机上先备份 `/etc/hzy-data-runtime/.env`，再通过受控 secret
   注入工具写入以下配置；不得在 shell history 或工单中直接写入密钥值：

   - `HZY_CONSOLE_RUNTIME_ENABLED=true`
   - `HZY_CONSOLE_DB_NAME=hzy_console`
   - `HZY_CONSOLE_VAULT_MASTER_KEY=<客户现有 Console Vault 主密钥>`
   - 如 Console 使用独立数据库身份，同时写入 `HZY_CONSOLE_DB_HOST/PORT/USER/PASSWORD`。

   配置文件及备份必须为 `0600`，属主为 Runtime systemd 用户；先在影子实例验证
   现有 Vault credential、OIDC signing key 和 service credential 均可解密。

4. T0 固定版本 `0.3.129` 已签名上传，并通过 Platform 控制心跳完成生产升级：
   当时 Runtime 与 Platform 均显示 `current=desired=0.3.129`、`status=ready`、
   `last_error` 为空。release inventory SHA-256 为
   `a21970c07bddc40055e8538595cfbc91662fdb08ad12de2e1a5e1bcf01f8fc93`。
   后续为修复 Connector enrollment credential 校验和无 enrollment code 的升级
   安装路径，生产升级到 `0.3.131`。为修复跨应用 service token deployment 绑定
   和服务令牌验签链路，生产已进一步升级到 `0.3.132`；release inventory SHA-256
   为 `7686b836008847598d226024a31a78468b25a059901194530e4831d5cf53a927`。
   `2026-07-19` 生产 Runtime 已升级到签名版本 `0.3.133`。检查发现 systemd
   自动更新单元仍固定请求 `0.3.132`，会周期性拒绝降级；已使用现有发布公钥执行
   `0.3.133` 精确重装并同步更新目标版本。`release.sha256` 文件 SHA-256 为
   `6e1e958bf2931e11593bfc0cf8f48b5b0da058f403885eb95ce9fcf4d514b37c`。

   以下命令仅用于新装、受控重装或回滚演练；已升级主机不得无故重复执行：

```bash
curl -fsSL \
  https://downloads.huizhi.yun/packages/hzy-data-runtime/0.3.129/install.sh \
  | sudo bash -s -- \
      --version 0.3.129 \
      --update-version 0.3.129
```

安装器必须复用主机已有的
`/etc/hzy-data-runtime/release-signing-public.pem` 验证 Ed25519 签名；缺少该文件即
停止，不临时关闭验签。

5. 使用只读 schema token 运行：

```bash
pnpm run verify:console-zero-db-cutover -- \
  --console-url https://wiztek.huizhi.yun/ \
  --runtime-url http://127.0.0.1:18080 \
  --schema-token-env HZY_CONSOLE_SCHEMA_READ_TOKEN \
  --evidence-file /secure/change-evidence/wiztek-console-cutover-t1.json
```

6. 核验：

   - 顶层 `status=ready` 且 `blockers=[]`；
   - `schema.status=ok`，revision 为待发布 manifest 的 SHA-256；
   - `missingTables/missingColumns/missingIndexes/missingConstraints` 均为空；
   - checks 中数据库身份/全局权限/schema 权限、租户/部署、
     Vault/Integration/Service Client current pointer、OIDC current signing key、
     Receipt、Directory primary department 与 subject export 均为 `pass`；
   - review-required metrics 中可靠 operation、notification delivery 和 Directory
     sync backlog 均为 0；
   - `pending_user_actionables` 仅为业务存量指标，不单独阻断，但必须记录基线。

7. `--evidence-file` 使用 `0600` 创建新文件且拒绝覆盖；将该完整 JSON 保存到受控
   变更证据库，不得放入公开工单或源码仓库。文件不包含 schema token。稳定 blocker 码：

   - `schema`、`runtime_tenant_binding`、`runtime_deployment_binding`；
   - `runtime_database_identity`、`runtime_database_global_privileges`、
     `runtime_database_schema_privileges`；
   - `tenant_profile_binding`、`runtime_data_binding`；
   - `vault_current_version_integrity`、`integration_credential_integrity`、
     `service_client_credential_integrity`、`oidc_current_signing_key`；
   - `stale_mutation_receipts`、`stale_service_command_receipts`、
     `stuck_integration_operations`、`stale_lifecycle_actionables`；
   - `directory_primary_department_integrity`、
     `directory_subject_export_completeness`；
   - 所有 `reviewRequired=true` 且 count 非 0 的 metric code。

8. 用 `console-test` 完成组织、设置、目录、人员离职、登录/refresh、Vault、
   Integration test、通知、actionable 和 operation retry。
9. 运行双租户相同 UID/部门码/幂等键测试及 Runtime 断网 fail-closed 测试。
10. Runtime、Console、DBA/安全、业务验收人四方会签后才进入 T0。

人工见证使用受控目录中的 `pending-change-acceptance-checklist-v2.json`。填录期间
可检查结构但不得将 pending 当作通过：

```bash
pnpm run validate:console-cutover-human-acceptance -- \
  --file /secure/path/pending-change-acceptance-checklist-v2.json \
  --allow-pending
```

只有 CTR-801 冻结记录与 CTR-816 四个角色都提供身份、审批引用、时间、声明并明确
无未接受 blocker 后，才运行不带 `--allow-pending` 的严格校验。机器校验不能代替
责任人真实签署，也不得由实施代理回填身份或决定。

试运行阶段允许变更负责人明确批准流程例外，但必须把真实授权记录为
`exception_approved`，保留原冻结/四方字段为空，禁止补造时间或冒充角色。当前
变更负责人已于 `2026-07-18T19:41:43.422Z` 授权直接迁移；v2 清单严格校验通过，
SHA-256 为
`65b19530b6f82b51cdcc7631690eb0589cbed866552a83d70505b0cb024a2aeb`。
该例外只替代 CTR-801/816 的签署仪式，不豁免技术证据或 72 小时观察。

## 4. T0：切换

1. 宣布维护开始，冻结高风险管理写入。
2. 做一致性备份，记录备份 ID、时间点和校验值。
3. 发布 Data Runtime，确认 health 为 `ok`，再次运行 live verifier 并保存
   `mode=cutover` 结果；与 T-1 证据比较，出现新 blocker 即停止。
4. 发布 PM2 Console；进程环境由 `console/ecosystem.config.cjs` 剥离 DB 和租户密钥。
5. 执行登录、目录、授权模拟、通知和 Vault/Integration smoke。
6. 观察批准的短窗口；通过后生成并发布 Cloudflare Console：

```bash
pnpm run validate:console-cloudflare -- \
  --env-file console/.env.cloudflare \
  --strict-env
pnpm --dir console run deploy:cloudflare
```

7. 确认生成配置无 `hyperdrive`、无 `DB_*`，并完成认证浏览器验收。
8. 记录 PM2 release、Runtime schema revision、Cloudflare version、smoke request ID、
   开始/结束时间和每位放行人。

全局 `latest` 已提升到 `0.3.133`。由于 Runtime 精确重装和自动更新目标修复发生在
原观察窗口内，且唯一生产 Connector 随后从此前的安全停机状态恢复，72 小时观察已从
首个恢复心跳重新起算；每个班次必须锁定并核验当前 Runtime/Worker/Connector 精确版本。

## 5. ACL 撤销

业务 smoke、隔离和 fail-closed 门禁通过后，DBA 已执行：

1. 已导出旧身份 `cf_app@%` 的 grant；撤权前它对 `hzy_console` 具有四项 DML。
2. 已撤销其对 `hzy_console` 的全部 grant；撤权后 schema privilege count 为 0。
3. 该身份仍服务七个尚未迁移的业务 schema，因此没有伪装成已删除或锁定；Console
   收口不改变其他应用的既有访问。
4. Worker 已无 Hyperdrive/D1/DB binding、Vault 主密钥、OIDC 私钥或签名自动化
   开关；Platform DB 身份只拥有 `hzy_platform`，没有 `hzy_console` 权限。
5. 数据库监听端口仍被其他旧应用使用，不能按 Console 变更全局关闭；对
   `hzy_console` 的数据库授权是当前可执行的 schema 级强制边界。
6. `hzy_console_runtime@localhost` 仍只具有 DML 和临时表权限；撤权后的
   `mode=cutover` 继续为 `ready` 且 `blockers=[]`。

具体 SQL 由 DBA 根据实际用户名/host 生成并双人复核，本仓库不保存生产用户名或密码。

## 6. 回滚

在 ACL 撤销前：

- 可回滚 Console/Runtime release 或 Runtime route；
- 不允许把 DB 配置重新写回 Console。

在 ACL 撤销后：

- 优先回滚 Runtime release；
- 如需恢复数据库访问，只能恢复给 Tenant Runtime identity；
- 不恢复旧 Console/Cloudflare DB user。

## 7. 观察与关闭

至少观察 72 小时。本次最终窗口从唯一生产 Connector 首个恢复心跳
`2026-07-19T23:15:50.641Z` 起算，最早关闭时间为
`2026-07-22T23:15:50.641Z`：

- 登录/refresh 成功率和撤销延迟；
- Runtime 5xx、timeout、P95/P99；
- receipt replay/conflict；
- outbox、operation、notification/actionable backlog；
- Vault/Integration test 失败率；
- 跨租户与 secret canary 告警。

每个观察班次保存时间窗、指标链接、异常单和处置结论。出现跨租户、Secret 泄漏、
撤销失效或 Runtime 以外 DB 可达性，立即按重大事件处理；普通错误预算超限回滚
Console/Runtime release 或 Runtime route，但不得恢复 Console DB identity。

每班次通过 Platform bootstrap 信任链自动签发一次性、短时
`console.schema.read` service token 并执行统一观察脚本；内部 token 只从本机
`0600` 文件读取，短时 token 只保留在进程内存中，证据文件名必须是新的且目录受控：

```bash
pnpm run observe:console-zero-db-cutover -- \
  --console-url https://wiztek.huizhi.yun/ \
  --runtime-url https://wiztek-data-runtime.huizhi.yun \
  --platform-url https://huizhi.yun \
  --platform-internal-token-file /secure/hzy-cloudflare-internal.token \
  --tenant-code C000001 \
  --environment prod \
  --ssh-host root@dev.quantics.ca \
  --connector-ssh-host root@8.130.81.31 \
  --expected-connector-id connector-runtime.C000001-console \
  --expected-connector-version 0.4.22 \
  --max-connector-heartbeat-age-seconds 120 \
  --worker-version-id b98ca02b-d38e-4eb6-bed9-97b4b0c9c9a2 \
  --worker-version-number 236 \
  --expected-worker-binding-count 44 \
  --expected-runtime-version 0.3.133 \
  --expected-schema-revision sha256:3f65861f15afa34691b4f9751751f984afd2f82716dc876203f19133843fbcc3 \
  --observation-start 2026-07-19T23:15:50.641Z \
  --not-before-close 2026-07-22T23:15:50.641Z \
  --evidence-file /secure/change-evidence/wiztek-console-observation-<timestamp>.json
```

脚本会同时检查公开 health/Console profile、正式 `mode=cutover` gate、Cloudflare
Worker 是唯一承载 100% 流量的当前部署且无禁用 binding、Runtime 的真实 active
时间早于观察起点、systemd restart/warning、自动更新 timer/request path 和精确目标
版本，以及 `cf_app`/`hzy_platform_cf`/`hzy_console_runtime` 的 Console schema
grant 数量。它还会核验唯一生产 Connector 的 enabled/active、版本和 active 时间，
Console 数据面的 Connector 状态与心跳新鲜度，并要求 dev 重复 Connector 保持
disabled/inactive。
任一项异常时不生成成功证据；未到 72 小时只标记 `in_progress`，不会提前给出可关闭结论。
也可用 `--schema-token-env` 注入已签发 token，但不得把 token 放入命令参数或证据。

关闭条件：

- 全部指标在预算内；
- Console/Platform/Worker 无 `hzy_console` grant、binding 或 credential 的证据已归档；
- Tenant Runtime 是唯一 DB identity；
- 旧 secret、Hyperdrive 和配置已删除；
- 备份保留/销毁日期已登记。

观察期届满后必须先生成新的最终观察证据，并由值班记录/监控与事件单汇总一份
`console-zero-db-operational-summary`。汇总的时间窗必须覆盖完整 72 小时，且
`blockerEvents`、`crossTenantAlerts`、`secretAlerts`、`rollbackEvents`、
`errorBudgetBreaches`、`connectorHeartbeatIncidents` 均为 0；至少引用基线和最终
观察，并至少再引用一份窗口内中间班次，共不少于三份不同的观察证据及其 SHA-256；
汇总结束时间不得早于最终观察采样时间。不得在观察期届满前预填结论，也不得只因
时间届满自动声明通过。随后执行最终关闭门禁：

```bash
pnpm run finalize:console-zero-db-cutover -- \
  --baseline-observation-file /secure/change-evidence/evidence-observation-20260719T232430Z-runtime-0.3.133-worker-236-hardened.json \
  --baseline-observation-sha256 b8cbb8f955d4c749deb7544cf063f26f47506e66e91fca2164c2bd030211392e \
  --observation-file /secure/change-evidence/final-observation.json \
  --observation-sha256 <final-observation-sha256> \
  --operational-summary-file /secure/change-evidence/operational-summary.json \
  --operational-summary-sha256 <operational-summary-sha256> \
  --acceptance-file /secure/change-evidence/pending-change-acceptance-checklist-v2.json \
  --acceptance-sha256 65b19530b6f82b51cdcc7631690eb0589cbed866552a83d70505b0cb024a2aeb \
  --backup-retention-file /secure/change-evidence/backup-retention-manifest.json \
  --backup-retention-sha256 ae3fbd6d366bdf0799898aad3572292c3e3d2210dd4a7a37fb97f5a470f83151 \
  --expected-observation-start 2026-07-19T23:15:50.641Z \
  --expected-not-before-close 2026-07-22T23:15:50.641Z \
  --expected-runtime-version 0.3.133 \
  --expected-schema-revision sha256:3f65861f15afa34691b4f9751751f984afd2f82716dc876203f19133843fbcc3 \
  --expected-worker-version-id b98ca02b-d38e-4eb6-bed9-97b4b0c9c9a2 \
  --expected-worker-version-number 236 \
  --expected-worker-binding-count 44 \
  --expected-connector-id connector-runtime.C000001-console \
  --expected-connector-version 0.4.22 \
  --output-file /secure/change-evidence/console-zero-db-closure-<timestamp>.json
```

最终门禁会重新执行不带 `--allow-pending` 的人工验收校验，固定核对 CTR-801/816
的 `exception_approved` 记录，校验验收清单与备份保留清单的已登记 SHA-256，
读取并校验实际加密备份的大小、密文 SHA-256 和 `0600` 权限，同时要求最终
观察证据已越过关闭边界、`eligibleToClose=true`、当前 Worker 是唯一 100% 部署、
Runtime/Updater/Connector/数据库边界全部通过。运营汇总必须精确引用上述基线
文件及固定 SHA-256，并精确引用本次传入的最终观察文件及 SHA-256；同名重复引用、
缺失或哈希不一致均拒绝。所有引用文件必须与运营汇总位于同一受控目录、权限为
`0600`；最终 CLI 会逐一读取并重新计算 SHA-256，中间班次也必须绑定同一观察窗口、
Runtime/schema/Worker 锚点并通过完整技术门禁。基线和最终观察都必须包含 15 个既定 cutover check，
每项恰好一次、`status=pass`、`violations=0`；还必须包含
`unfinished_integration_operations`、`failed_integration_operations`、
`pending_notification_deliveries`、`failed_notification_deliveries`、
`incomplete_directory_sync_jobs`、`pending_user_actionables` 六项零值指标，
每项恰好一次，不能通过删除指标或把 `reviewRequired` 降级来绕过。任何一项失败
都不会生成关闭报告；输出文件使用独占创建和 `0600` 权限，避免覆盖既有证据。

T0 观察证据：

- `evidence-t0-0.3.129.json` SHA-256：
  `9eb09a3c72b790361045dc2f6898480636f15b81d0bb7f92da6f11694d4f7f5d`；
- `evidence-acl-and-observation-t0-0.3.129.json` SHA-256：
  `5ed4b5aa8993c957e2c48188f184cce1ad7a6f8393107cc34326fba32e4d0bbd`；
- `evidence-dual-tenant-isolation-0.3.129.json` SHA-256：
  `4308d1d161db8fa22fdfd4a4ee1de2808d89fd2eb12b24c4d3d693d3a277f873`；
  该证据来自两份独立恢复库克隆，不代表创建了第二个生产租户；相同 UID、部门码和
  幂等键在 `C000001`/`C000002` 中分别提交和重放，临时库在取证后已删除；
- `backup-retention-manifest.json` SHA-256：
  `ae3fbd6d366bdf0799898aad3572292c3e3d2210dd4a7a37fb97f5a470f83151`；
  加密备份至少保留至 `2026-10-16T20:40:20.525Z`，禁止自动删除，销毁必须在观察
  关闭、无事件/回滚 hold 后由 owner 明确批准；
- `evidence-observation-20260718T1335Z.json` SHA-256：
  `cb562f59abc7019fa0dd4003a7a800a7f4003c94dedaa5be25555e14fd900512`；
  本班次正式 bootstrap、cutover gate、Worker、systemd 和 DB ACL 全部通过，
  `eligibleToClose=false`（尚未达到 72 小时）；
- `evidence-observation-20260718T144742Z-runtime-0.3.131-worker-222.json`
  SHA-256：
  `123109a304b7ded608d5058eed1e79b5a774d3dfa9e661b20f13b96641754b85`；
  Runtime `0.3.131`、Worker version 222、cutover gate、systemd 和 DB ACL
  全部通过，`eligibleToClose=false`；
- `evidence-observation-20260718T1749Z.json` SHA-256：
  `9f5ccf8dbaf0ec274ba747a0287881d94dbe4f9e954c59a9d850cd083e453f5f`；
  `2026-07-18T17:49:10.105Z` 班次再次确认 Runtime `0.3.131`、Worker version
  222、cutover gate、systemd 和 DB ACL 全部通过，且 0 warning/0 restart；
  `eligibleToClose=false`；
- 上述 Worker 216/222/223 与 Runtime 0.3.129/0.3.131 证据均作为历史轨迹保留，
  不再作为最终观察关闭锚点；
- `evidence-observation-20260718T2041Z-runtime-0.3.132-worker-228.json`
  SHA-256：
  `4a093dacd0105047eb9af6da1a12818e626afcbd9425d995bff316ba2c2ea4c7`；
  当时的 Runtime `0.3.132`、Worker version 228、schema revision
  `sha256:3f65861f15afa34691b4f9751751f984afd2f82716dc876203f19133843fbcc3`、
  cutover gate、systemd 与 DB ACL 全部通过，0 warning/0 restart，
  `eligibleToClose=false`；后续 Runtime 升级和自动更新修复使其只作为历史轨迹保留；
- `evidence-observation-20260719T230919Z-runtime-0.3.133-worker-228.json`
  SHA-256：
  `8c3c0006de8db89541205646a62b99aa168f0fbbfb869c1cfc66c56b41b98789`；
- `evidence-observation-20260719T231620Z-runtime-0.3.133-worker-228.json`
  SHA-256：
  `df805925577d30dbad2efc108cfe93e164265f6e91d942836e21f3f7fe580ba7`；
  上述两份确认 Runtime `0.3.133` 和数据库边界通过，但仍引用已被新发布替代的
  Worker version 228，且第一份早于 Connector 恢复，因此只保留为过渡审计轨迹；
- `evidence-observation-20260719T231807Z-runtime-0.3.133-worker-236.json`
  SHA-256：
  `c8e0286b616a1f1c43e238b636cacdd10d696d395d5e4abfd11d029169148563`；
  该证据首次锁定当前 Worker 236，但生成时观察脚本尚未把 100% 当前部署、
  updater 和 Connector 状态设为强制门禁，因此保留为增强前的过渡轨迹；
- `evidence-observation-20260719T232430Z-runtime-0.3.133-worker-236-hardened.json`
  SHA-256：
  `b8cbb8f955d4c749deb7544cf063f26f47506e66e91fca2164c2bd030211392e`；
  当前关闭锚点为 Runtime `0.3.133`、Worker version 236、44 个 binding 和既有
  schema revision；cutover gate、systemd 与 DB ACL 全部通过，0 warning/0 restart，
  `checksPassed=true`、`eligibleToClose=false`。增强证据还证明 Worker version 236
  是唯一 100% 当前部署、updater 目标为 `0.3.133`、timer/request path 正常、唯一
  生产 Connector `0.4.22` 与 Console 心跳 active，且 dev 重复实例 disabled/inactive；
- `evidence-observation-20260719T234258Z-runtime-0.3.133-worker-236-hardened.json`
  SHA-256：
  `1f57691db5fd1bd27f087113fc491e2aa7d078dd275d40d00e7ee9746efd62da`；
  `2026-07-19T23:43:11.932Z` 班次使用加强后的观察生成门禁，真实 Runtime 返回的
  15 个必备 cutover check 和 9 个 metric 全部通过，其中六项关闭指标为 0；
  Runtime 0 warning/0 restart、Connector 心跳年龄 26 秒、Worker 236 承载
  100% 流量，`checksPassed=true`、`eligibleToClose=false`；
- `2026-07-20T20:47:33Z` 自动观察在写证据前失败关闭：生产流量已经 100% 指向
  Worker version 242（`0f9b4e72-96a3-4270-a937-1a7a50588d47`），不再是本窗口
  锁定的 Worker version 236（`b98ca02b-d38e-4eb6-bed9-97b4b0c9c9a2`）。新 Worker
  仍为 44 个 binding 且无禁止 binding，但不得自动替换关闭锚点；本次未生成观察
  证据。须在负责人确认新发布为预期版本后重新锁定 Worker，并从新锚点重新启动
  完整 72 小时窗口；
- `evidence-authenticated-smoke-20260718T204116Z.json` SHA-256：
  `e7cfc08d9094681280d681b7021d6a5a05071c841605e274666fd600e26f549f`；
  最终发布和增量迁移后，已认证浏览器的身份、目录、应用、权限、通知与 Workflow
  待办共 7/7 返回 200，且 Workflow 返回真实待办数据；
- `evidence-connector-runtime-production-20260718T144837Z.json` SHA-256：
  `61fcb280d537b0aa78b45cc0536f387e173bdbcbffe2f554c0f499bfb395f1fb`；
  唯一生产 Connector 为 `8.130.81.31` 上的 `0.4.22`，安装验收、心跳和页面
  “检测配置”全部通过；`dev.quantics.ca` 上的重复 Connector 与两端旧通知服务均
  disabled/inactive，真实消息未发送；
- `evidence-connector-runtime-recovery-20260719T231658Z.json` SHA-256：
  `906b59fc3ee6bd2878fb1912edd7486ae82e1c5ac97ecd94393e1309c3a350aa`；
  唯一生产 Connector 在此前服务令牌验签链异常期间收到 401 后按 fail-closed
  策略停止；复核长期 credential 和精确 grant 均有效、当前短时令牌签发返回 200
  后恢复既有实例。`8.130.81.31` 上 `0.4.22` 为 enabled/active，Console 数据面
  状态与心跳均恢复 active；`dev.quantics.ca` 上重复 Connector 保持 disabled/inactive；
- `evidence-production-runtime-read-chain-0.3.129.json` SHA-256：
  `10945db4afe79478a550acdd6a797d03a04edabecdbf4499428ef5ee8462f2e8`；
  生产 Runtime 11 个只读端点全部返回成功，覆盖 profile、settings、directory、
  Auth、Vault、Integration、审计和 Connector Runtime。该证据不单独替代
  `console-test` 写链路或消息通知测试；认证浏览器验收另见上述 Connector 证据；
- `evidence-ctr812-console-test-write-chain-20260718T174600Z.json` SHA-256：
  `78c0956b68bd0453bc5c54f128222102877d48439421f49fdaa0a5099e4bb260`；
  隔离、无 DB 配置的 `console-test` 经 HTTPS BFF 完成组织/设置/目录/Auth/Vault/
  Integration/通知、离职撤权以及可靠操作死信与人工重试写链路。测试未修改生产
  数据、未发送外部通知或供应商请求；测试环境上游 OIDC 配置缺失作为开放异常保留，
  Runtime-issued 隔离会话用于 BFF 验收；取证后已停止测试 Console、隔离 Runtime
  与临时 SSH 隧道；
- 上述证据均在受控备份目录中以 `0600` 保存，不进入源码仓库。
