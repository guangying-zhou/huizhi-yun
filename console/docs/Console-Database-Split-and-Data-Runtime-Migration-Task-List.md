# Console 零直连数据库与 Tenant Runtime 迁移执行计划

状态：Wiztek 生产切换、历史数据处置和 Console DB ACL 收口完成；72 小时观察中

建立日期：2026-07-14  
修订日期：2026-07-19
决策依据：`docs/ADR-017-Console-Tenant-Data-Plane-Separation.md`

## 1. 完成定义

Console 必须收敛为 UI、认证协议门面和薄 BFF。只有客户侧 Tenant Runtime
（当前实现为 Data Runtime）可以连接租户业务数据库。

完成必须同时具备四类证据：

1. **代码证据**：Console DB helper 和静态 DB 调用均为 0，且没有 MySQL driver。
2. **配置证据**：Cloudflare、PM2、Self-hosted Console 均无 DB、Hyperdrive、
   Vault master key 或 OIDC signing private key。
3. **运行证据**：Wiztek Runtime schema/data ready，核心流程和双租户隔离通过。
4. **基础设施证据**：所有 Console/Platform/Worker 身份对 `hzy_console` 的 grant、
   binding 和 secret 已撤销，Tenant Runtime 是唯一可访问身份，观察期无回退。
   数据库监听若仍被其他业务 schema 共用，其全局关闭属于相应模块迁移，不阻塞
   已由 schema grant 强制隔离的 Console 收口。

代码通过不等于生产切换完成；数据库尚可访问时不得把任务标记为最终完成。

## 2. 目标架构

```text
Browser
   |
Tenant Gateway -- verified tenant/deployment --> Console BFF
                                                   |
                                     exact capability + user delegation
                                                   |
                                                   v
                                        Customer Tenant Runtime
                                                   |
                                                   v
                                      customer-owned hzy_console

Platform DB: tenant/subscription/deployment/manifest/policy/runtime registry only
```

强制不变量：

- Runtime 从已验证 token 和本机 enrollment 获取 tenant/deployment，浏览器不能覆盖。
- Mutation 使用幂等键；安全关键写入使用 revision/version、CAS 和事务内 Receipt。
- Secret、DSN、token、原始上游响应不进入日志、错误、通知 metadata 或审计。
- Runtime 不可用时 fail closed；不存在 MySQL、Hyperdrive 或其他租户 Runtime fallback。
- Cloudflare、PM2、Self-hosted 使用同一 Runtime API 和 capability 模型。

## 3. 阶段与当前状态

| 阶段 | 目标 | 代码状态 | 生产状态 |
|---|---|---|---|
| P0 | ADR、表归属、API/Auth 威胁模型、基线 | 完成 | 不适用 |
| P1 | Runtime Core、身份、幂等/CAS、审计、Foundation client | 完成；Schema/切换就绪检查已自动化 | live verifier 已通过 |
| P2 | 组织、设置、区域、日历、日志、通知读状态 | 完成 | Runtime 已切换 |
| P3 | Directory、Connector、People 生命周期 | 完成；未支持 provider 明确 503 | Runtime 已切换 |
| P4 | Vault、Integration、Connector Runtime | 完成 | 密钥 current pointer 门禁通过 |
| P5 | Auth、Session、OIDC、Service Client | 完成 | refresh reuse/撤销门禁通过；待最终浏览器验收 |
| P6 | 通知、actionable、可靠操作、统一审计 | 完成 | 历史记录已受控处置并保留审计 |
| P7 | 删除 Console DB/Hyperdrive/tenant secrets | 完成 | runtime-only Worker 已部署；旧 secret/DB binding 已删除 |
| P8 | Wiztek 切流、ACL 撤销、观察、清理 | 执行中 | ACL 已收口；72 小时观察中 |

### 3.1 2026-07-18 生产基线与发布候选

已核验的生产事实：

- Platform 生产版本 `af267a64-4d65-400b-9962-fe41c684d5dc` 已批准 Data Runtime
  `0.3.126`；企业 Runtime 于 `2026-07-18T07:01:19Z` 回报 `ready`，当前/目标版本
  均为 `0.3.126` 且 `last_error` 为空。Console Vault custody 已显示为
  `tenant_runtime`，临时 OIDC 信任迁移入口已经移除；
- Console Cloudflare 生产版本
  `c2f3cfaa-fc26-42f7-a449-87a7e32de647` 已使用 runtime-only 配置发布，
  Console/Cloudflare 生成配置无 Hyperdrive 或 DB binding；
- `https://tpapi.wiztek.cn/runtime/health` 返回的产品标识是
  `hzy-connector-runtime`，不能作为 Console Tenant Runtime 地址；
- Wiztek Data Runtime 公开入口已确认为
  `https://wiztek-data-runtime.huizhi.yun`；当前版本为 `0.3.126`，health 为 `ok`，
  `runtimeProduct=hzy-data-runtime`，tenant/deployment 分别为
  `C000001` / `c000001-prod-tenant-runtime`，`apps.console` 已启用且 DB ping 为
  `ok`、Vault key 已配置；公开 health 的 `builtAt=2026-07-18T06:55:58Z`，
  commit 标记为 `49add54-dirty`；
- Platform Runtime bootstrap、Console 短期 service token、租户 issuer/JWKS 和
  Tenant Gateway 信任链已经通过。认证浏览器于 `2026-07-18T06:17:12Z` 重试
  Console 激活时仍返回 `Internal server error`；独立
  `/v1/console/profile` 探测同样在完成鉴权后返回 500，故当前 blocker 位于
  Runtime Console adapter 的 schema/数据访问，而不是登录态、kid、issuer 或 scope；
- `mode=cutover` 原先错误地使用 Runtime 实例部署
  `c000001-prod-tenant-runtime` 校验 Console 业务表，导致正确绑定到
  `C000001-console` 的 71 条数据被误报。Data Runtime `0.3.126` 已改为
  `DeploymentForApp("console")` 并加入 DB 最小权限强制门禁；固定版本已完成
  Ed25519 签名和
  R2 不可变目录上传，release inventory SHA-256 为
  `7c9f55c0646133896ad16690b4a99ed028e8ae22a6909e0ca8872272ebd773ba`。
  Platform 生产批准版本已更新为 `0.3.126`，并通过五分钟控制心跳完成签名更新；
  全局 `latest` 仍为 `0.3.115`。固定目录 `0.3.124` 使用了不同信任锚，已被
  Platform 的签名锚门禁拒绝且未下发，先由 `0.3.125` 取代，当前生产已继续升级
  到 `0.3.126`；
- Runtime Cloudflare Tunnel 源站已定位到 `149.248.50.209`，但当前操作环境的
  SSH 公钥未获该主机授权，仍未取得受控主机入口、只读 schema token、数据库备份
  记录或 DBA 维护窗口权限。因此不得执行生产 DDL、数据修复、ACL 撤销或把 live
  schema/cutover 门禁标为通过；
- 使用 Runtime 现有数据库身份完成了只读 `information_schema` 漂移检查：生产
  `hzy_console` 相对当前 manifest 缺少 3 张表、42 个列、7 个索引和 3 个约束；
  `org_profiles.revision` 缺失与 `/v1/console/profile` 当前 500 的查询路径精确
  对应。已新增统一、可重复、仅增量的迁移
  `console/docs/console_tenant_runtime_cutover_20260718.sql`，SHA-256 为
  `9a2fbb01c4edb1d745fc350138dc1186d22c5359bdbe82c8054e99965d93411e`；
  它已在生产 Schema 的隔离结构副本上连续执行两次，执行后当前 manifest 的
  missing table/column/index/constraint 均为 0。该结构副本不含业务行，不能替代
  CTR-802 要求的一致性数据备份和恢复演练，生产迁移仍未执行；
- 生产 Runtime 当前数据库身份为 `root@%`，拥有全局 `GRANT OPTION`；56 张表均为
  InnoDB、约 50 MiB，binlog=ROW 且已启用，GTID 未启用。实际 Runtime 数据库连接
  来自 `localhost`，因此 CTR-803 必须替换为仅限 `localhost`、只具备 Console
  DML 与临时表权限的专用账号。`mode=cutover` 已新增
  `runtime_database_identity`、`runtime_database_global_privileges` 和
  `runtime_database_schema_privileges` 三项强制门禁；
- `0.3.126` 固定版本 manifest 已通过公开下载、Ed25519 签名、信任锚和双架构
  SHA-256 复核；生产自动升级已验证，但 schema migration、cutover data verifier
  和业务 smoke 尚未执行，因此不能把 Runtime 发布等同于 P8 放行。

这一基线是 P8-A 的当前检查点。只有 Runtime 源站日志、生产备份/恢复演练和
live `mode=cutover` verifier 全部通过后，才允许继续业务 smoke、旧 DB identity
与 ACL 撤销；当前的 500 不得靠恢复 Console DB 直连绕过。

### 3.2 2026-07-18 Wiztek 维护窗口执行事实

- SSH 密钥通道已恢复；此前的端口拒绝由主机 Fail2ban 规则导致，规则修正后
  `root@dev.quantics.ca` 的批处理密钥登录通过；
- 已用临时最小权限备份账号执行一致性逻辑备份并在传输过程中加密，未在主机或
  本机落地明文 dump。备份 binlog 点为 `binlog.000007:1012524663`，明文
  SHA-256 为
  `e5ba804ad366e23445b39f39176c2640539f6e3496cae3516336e4d78d314cef`，
  密文 SHA-256 为
  `edd723430899a84708039070038c03b53477c27471cfbbc95784d49964fe225e`；
- 完整备份已恢复到隔离数据库，56/56 张表及四组关键 current pointer 哈希一致。
  `vault_access_logs` 的行数差异全部来自备份快照之后的在线追加写，不是恢复丢失；
- migration 已在隔离恢复库连续执行两次，再应用到生产；当前 schema revision 为
  `sha256:4a6009caf824db4d2dbd268468e5a04671f85f703100b4f09443fac4056ba0fa`，
  table/column/index/constraint 缺口均为 0；
- Console 与 Directory 已切换到
  `hzy_console_runtime@localhost`，仅具
  `SELECT, INSERT, UPDATE, DELETE, CREATE TEMPORARY TABLES`；Runtime health
  的全部 10 个应用数据库均为 `ok`。其他应用仍暂用本机旧身份，原因是 Aims
  当前启动代码仍执行 DDL，不能在未完成 Aims schema 启动迁移前强行共用 DML-only
  身份；
- Data Runtime `0.3.127` 补齐正式 cutover schema-token 授权，但 live 调用发现
  点分 capability `console.schema.read` 无法往返旧的冒号授权存储。`0.3.128`
  已增加显式映射和全量 scope 往返回归测试；签名不可变包 inventory SHA-256 为
  `16a984d72e959475feb1fd5b0bdd2ba30c519ef9af6ce0e5839ad6ee2e0b9ead`。
  Platform 的 42 个 Worker binding 已逐项继承校验，批准版本与企业 Runtime
  当时 `current/desired` 均为 `0.3.128`、状态为 `ready`；T0 已继续升级到
  `0.3.129`；
- 正式信任链
  `Platform bootstrap JWT -> Console Runtime 5 分钟 console.schema.read token
  -> mode=cutover` 已通过。Runtime 请求 ID 为
  `9278007495d153efdc1f0ecce71ce9cf`（颁发）和
  `1660403bf5268a8024d37f9418a8c02d`（verifier）；
- live verifier 的 schema、数据库身份/权限、租户/部署、Vault、Integration
  credential、OIDC、Receipt 和 Directory 投影检查均通过；剩余 blocker 为：
  `service_client_credential_integrity=1`（历史 Aims client 无 current
  credential）、`failed_integration_operations=1`、`failed_notification_deliveries=23`
  和 `incomplete_directory_sync_jobs=176`。这些失败/部分成功记录包含 4 月至
  7 月的历史结果，必须保留审计语义并通过受控应用处置或显式 disposition，
  不能为了让计数归零而删除或伪造为成功。

### 3.3 2026-07-18 T0 切换、历史处置与 ACL 事实

- Data Runtime 的初始 T0 基线为 `0.3.129`，生产随后升级到 `0.3.131`。
  `2026-07-18T20:30:20Z` 已发布并安装 `0.3.132`，不可变 release inventory
  SHA-256 为
  `7686b836008847598d226024a31a78468b25a059901194530e4831d5cf53a927`。
  本版修复跨应用 service token 的 canonical deployment 绑定，并将服务令牌验签
  收口到 Console introspection；schema manifest 覆盖 58 张表，revision 更新为
  `sha256:3f65861f15afa34691b4f9751751f984afd2f82716dc876203f19133843fbcc3`。
  生产补执行 `directory_lifecycle_outbox_audit_20260718.sql` 与
  `service_command_receipt_reliability_20260718.sql` 两份可重复增量迁移后，
  missing table/column/index/constraint 均为 0，受影响表行数保持 8/5；
  migration SHA-256 为
  `9a2fbb01c4edb1d745fc350138dc1186d22c5359bdbe82c8054e99965d93411e`；
- 旧 Aims 无 credential service client 已通过受控替代身份校验后停用；1 条历史
  dead-letter、23 条历史通知失败和 176 条历史目录 job 已写入指纹绑定、可失效、
  append-only 的 disposition，原业务记录未删除或伪造。处置证据 SHA-256 为
  `e5ab57d9de8e895b79074609deb6f56f0565b367835b008e651470f8c58a9bb3`；
- disposition 后正式 `mode=cutover` 为 `ready`、`blockers=[]`；同一幂等键重放
  返回 `replayed=true`，源事实变化会自动使 disposition stale 并重新阻断；
- `cf_app@%` 对 `hzy_console` 的四项 DML 已撤销，撤权后 privilege count 为 0；
  `hzy_console_runtime@localhost` 的五项最小权限未变。`cf_app` 仍因其他七个旧
  schema 被保留，不能将 Console 变更误写成全局账号删除；
- Platform 身份 `hzy_platform_cf@%` 只拥有 `hzy_platform`；生产 Console Worker
  无数据库绑定或租户私钥。当前 Worker version 为
  `b98ca02b-d38e-4eb6-bed9-97b4b0c9c9a2`（version 236），44 个 binding 中没有
  Hyperdrive、D1、`DB_*`、Vault master key、OIDC signing private key 或废弃
  signing automation flag；Workflow 当前版本为
  `aaa8f741-1425-4abb-ac33-6b252d8e6f78`；
- 伪造 `x-hzy-tenant=C000002` 的生产读探针仍返回可信租户 `C000001`；隔离恢复库
  的错误 Runtime tenant 绑定返回 403。另以两份独立恢复库克隆完成
  `C000001`/`C000002` 双正向实测：相同 UID、部门码、payload 和幂等键分别首次
  成功、分别重放，且回执互不相同；未创建第二个生产租户；
- Foundation 的 Runtime 网络失败原先错误映射为 502，已修正为明确 503 并以真实
  未监听端口验证没有 DB fallback；修复已随上述 Worker version 发布；
- 隔离恢复库已验证 refresh token 首次消费后再次使用会撤销整个 family、记录
  `reuse_detected`；离职 session/refresh 撤销、幂等 replay 和 service credential
  revoke 测试均通过；
- 由于 `0.3.132`、最终 Console/Workflow 发布和可靠操作 schema 增量迁移均发生在
  初始窗口之后，当时的观察窗口曾重置为 `2026-07-18T20:40:20.525Z` 至
  `2026-07-21T20:40:20.525Z`。该 T0 时 Runtime 无 warning、无重启，
  review-required blocker count 均为 0；后续 `0.3.133` 生产变更已使该窗口仅作为
  历史轨迹保留。当前任务继续使用观察心跳 `wiztek-console-72h`，每次只归档脱敏结果。
- `2026-07-19` 复核发现生产已运行签名版本 `0.3.133`，但 systemd 自动更新单元
  仍固定请求 `0.3.132`，每五分钟拒绝一次降级。已使用现有发布公钥执行
  `0.3.133` 精确重装、同步更新目标并验证手动更新成功；Runtime、更新 timer 和
  请求路径均为 enabled/active。唯一生产 Connector 随后从此前的 fail-closed 停机
  状态恢复；其首个新心跳为 `2026-07-19T23:15:50.641Z`。这些均属于观察期内生产
  变更，最终窗口已重置为该心跳至 `2026-07-22T23:15:50.641Z`。

## 4. 已完成的代码任务

### P0：边界与基线

- [x] CTR-001：接受 ADR-017；不建立平台托管 `hzy_console_control`。
- [x] CTR-002：租户表归属 Tenant Runtime，Platform 只保留控制面事实。
- [x] CTR-003：冻结初始基线 51 个生产文件、522 个 DB helper 调用点。
- [x] CTR-004：冻结 `/v1/console/**` 领域 API、错误、分页、capability 和 token 约束。
- [x] CTR-005：冻结 Auth/OIDC/Session/Service Token/轮换威胁模型。
- [x] CTR-006：定义 fail-closed、版本/schema readiness 与人工回滚边界。

### P1：Runtime Core

- [x] CTR-101：建立 `data-runtime/internal/apps/console` 和 schema/health 支持。
- [x] CTR-102：建立独立 Console adapter 配置和客户侧连接池。
- [x] CTR-103：实现 tenant/deployment/source app/audience 精确绑定。
- [x] CTR-104：实现标准错误、请求 ID、有界分页与输入限制。
- [x] CTR-105：实现用户委托和精确 service capability 校验。
- [x] CTR-106：实现幂等 Receipt、CAS/revision 和 fencing。
- [x] CTR-107：实现事务内审计、可靠 operation/outbox 和敏感字段过滤。
- [x] CTR-108：Foundation 提供唯一 Console Tenant Runtime client。

### P2～P4：租户领域迁移

- [x] CTR-201：企业资料、业务领域、行政区域、设置、工作日历迁入 Runtime。
- [x] CTR-202：operation/login/lifecycle 审计查询与写入迁入 Runtime。
- [x] CTR-203：用户通知 read/archive/read-all 迁入 Runtime。
- [x] CTR-301：用户、部门、项目、委员会、membership、subject export 迁入 Directory adapter。
- [x] CTR-302：目录 mutation、People employment/offboarding、同步 job/event 和 Receipt 迁入 Runtime。
- [x] CTR-303：Directory Connector enrollment/config/lease/complete/sync 使用本机签名合同。
- [x] CTR-304：`pageSize=500` 在 SQL 前拒绝；批量/游标均有上限。
- [x] CTR-305：尚未落地的外部 provider 返回明确 503，不回退 Console SQL。
- [x] CTR-401：Vault create/version/rotate/reveal 与 access audit 迁入 Runtime。
- [x] CTR-402：Integration metadata、credential binding、connectivity check 迁入 Runtime。
- [x] CTR-403：GitLab、WeCom、OSS 等业务操作使用固定 operation，不向 Console 返回 secret。
- [x] CTR-404：Enterprise Connector Runtime enrollment/heartbeat/revoke 和 hash-only credential 迁入 Runtime。

### P5～P6：Auth、可靠操作与统一审计

- [x] CTR-501：Session、authorization code、refresh family、external login state 迁入 Runtime。
- [x] CTR-502：OIDC signing key/bootstrap/JWKS/token 签发由 Runtime 持有。
- [x] CTR-503：Service client/credential/grant/token introspection 迁入 Runtime。
- [x] CTR-504：token scope 使用 exact allowlist；禁止前缀/通用管理员推导。
- [x] CTR-601：canonical notification/todo/delivery/actionable projection 迁入 Runtime。
- [x] CTR-602：授权生命周期 operation/attempt/claim/checkpoint/retry 迁入 Runtime。
- [x] CTR-603：clipboard/presence 等兼容运行态迁入 Runtime。
- [x] CTR-604：Console BFF 不再尽力写本地日志，统一经 Runtime 事务/outbox。

### P7：删除直连能力

- [x] CTR-701：删除 `console/server/utils/db.ts`。
- [x] CTR-702：删除 Console 对 `mysql2` 的直接依赖。
- [x] CTR-703：删除 Nuxt `runtimeConfig.db` 与 Console env example 的 `DB_*`。
- [x] CTR-704：Cloudflare renderer 删除 Hyperdrive binding 和 `DB_NAME`，策略 cache 改为 isolate memory。
- [x] CTR-705：PM2 和 dev-stack 在启动 Console 前强制剥离 DB 和租户密钥变量。
- [x] CTR-706：Console 删除 Vault master key 和 OIDC private key 读取/生成路径。
- [x] CTR-707：静态门禁结果为 0 个 DB 文件、0 个调用点。
- [x] CTR-708：新增 `verify:console-zero-db-cutover`，组合代码、依赖、PM2、Cloudflare 与可选 live Runtime 校验。
- [x] CTR-709：从权威 SQL 生成 58 表 Runtime schema manifest，发布门禁检查表、列、索引、命名约束和 SHA-256 revision 漂移。
- [x] CTR-710：新增 `mode=cutover` 数据就绪检查，阻断租户/部署错绑、credential/OIDC pointer 断裂、陈旧 Receipt、可靠操作/通知积压和 Directory 投影缺口。

## 5. P8：Wiztek 生产落地任务

以下任务必须在批准的维护窗口按
`Console-Tenant-Runtime-Wiztek-Cutover-Runbook.md` 执行。

### P8-A：准备与备份

- [x] CTR-800：确认 Wiztek Data Runtime 的实际管理地址、主机责任人和受控访问路径；
  health 必须返回 `runtimeProduct=hzy-data-runtime`，不得使用 Connector Runtime 地址。
- [x] CTR-801：原计划要求冻结 Console 租户写入并记录 release、schema version、
  bundle hash 和负责人。由于系统处于试运行阶段，变更负责人于
  `2026-07-18T19:41:43.422Z` 明确授权直接迁移并批准该流程例外；清单保留空的
  历史冻结字段，未补造时间或冒充见证人。该例外不豁免备份、零 DB、ACL、隔离或
  72 小时技术观察门禁。
- [x] CTR-802：完成 `hzy_console` 一致性备份并演练只恢复到隔离环境。
- [x] CTR-803：创建仅供 Tenant Runtime 的最小权限 DB identity；凭证不进入 Console/Platform。
- [x] CTR-804：应用 Runtime schema migration，确认普通 schema probe 为 `ok`，revision 与发布 manifest 一致。
- [x] CTR-805：运行 `mode=cutover`，确认 `status=ready`、`blockers=[]`；checks/metrics
  已以 `0600` 归档，T0 证据 SHA-256 为
  `9eb09a3c72b790361045dc2f6898480636f15b81d0bb7f92da6f11694d4f7f5d`。

### P8-B：预发布验证

- [x] CTR-811：部署 Data Runtime 新版本，健康和 Console schema probe 通过。
  生产已从初始 T0 的 `0.3.129` 升级到 `0.3.133`；公开 `latest` 与 health
  均为 `0.3.133`。可靠操作增量迁移后 Console schema revision 为
  `sha256:3f65861f15afa34691b4f9751751f984afd2f82716dc876203f19133843fbcc3`，
  `mode=cutover` 为 `ready` 且无漂移。自动更新目标已同步为 `0.3.133`，
  不再周期性尝试降级。
- [x] CTR-812：隔离、无 DB 配置的 `console-test` 已完成组织/设置/目录/Auth/Vault/
  Integration/通知、离职撤权、可靠操作死信与人工重试写链路。测试 Console 绑定
  `wiztek-test-console`，隔离 Runtime 为 `0.3.132-ctr812.3` /
  `c000001-ctr812-test-runtime`；未修改生产数据，未向外部通知或供应商发送请求。
  Runtime-issued 隔离管理员会话经 HTTPS Console BFF 完成验收；测试环境上游 OIDC
  配置缺失被如实保留为 `test_upstream_oidc_configuration_missing`，未伪造浏览器
  登录通过。脱敏证据
  `evidence-ctr812-console-test-write-chain-20260718T174600Z.json` 以 `0600`
  归档，SHA-256 为
  `78c0956b68bd0453bc5c54f128222102877d48439421f49fdaa0a5099e4bb260`。
  取证后已停止测试 Console、隔离 Runtime 与两条临时 SSH 隧道；生产服务未重启。
  此外，生产 Runtime 11 个只读端点证据 SHA-256 为
  `10945db4afe79478a550acdd6a797d03a04edabecdbf4499428ef5ee8462f2e8`。
- [x] CTR-813：伪造生产 tenant/deployment header 和隔离恢复库错误租户绑定均已被
  拒绝；另以两份独立恢复库克隆完成双正向租户实测：两库保留相同 UID、部门码和
  幂等键，`C000001`/`C000002` 各自首次提交成功、各自重放，回执互不相同且每库
  仅一条。测试未创建第二个生产租户，临时库和测试二进制已清理；脱敏证据
  `evidence-dual-tenant-isolation-0.3.129.json` SHA-256 为
  `4308d1d161db8fa22fdfd4a4ee1de2808d89fd2eb12b24c4d3d693d3a277f873`。
- [x] CTR-814：以未监听 Runtime endpoint 执行断网测试；Foundation 返回明确 503，
  `handled=false`/DB fallback 均未发生，修复已发布到生产 Worker。
- [x] CTR-815：Worker secret/binding canary、隔离恢复库 OIDC refresh reuse family
  撤销、离职 session/refresh 撤销和幂等重放测试通过。
- [x] CTR-816：原计划要求 Runtime、Console、DBA/安全、业务验收四方会签。
  试运行阶段由变更负责人明确授权直接迁移并批准签署流程例外；四个角色字段保持
  空值，未冒充任何责任人。该例外仅替代签署仪式，不替代已归档的技术验收和
  72 小时观察。
  初始待签项保留为不可变历史证据：
  `pending-change-acceptance-checklist.json`，SHA-256 为
  `57d730d8f61b6c5464a264aefa38a80db7730fcd846a48ec2e8549db57f3d351`；
  接续清单 `pending-change-acceptance-checklist-v2.json` 已固化 CTR-812/823
  技术证据和上述两项批准例外，SHA-256 为
  `65b19530b6f82b51cdcc7631690eb0589cbed866552a83d70505b0cb024a2aeb`；
  严格校验结果为 `complete=true`、`pending=[]`。

### P8-C：生产切流

- [x] CTR-821：生产主机没有 PM2 Console 进程，此步骤按实际 Cloudflare-only 拓扑
  判定不适用；已确认 PM2 仅运行 Platform，且 Platform 身份没有 `hzy_console` grant。
- [x] CTR-822：已发布 Cloudflare Console，策略 cache 为 memory；最终 44 个 binding
  无 Hyperdrive/D1/DB/Vault/OIDC private 配置。最终 Worker 为
  `b98ca02b-d38e-4eb6-bed9-97b4b0c9c9a2`（version 236）。
- [x] CTR-823：认证内置浏览器和生产 API smoke 已通过。profile、settings、
  directory、Auth、Vault、Integration 等读取链路正常；企业连接运行时页面显示
  唯一生产实例 `connector-runtime.C000001-console` 为 `0.4.22`、心跳正常，
  “检测配置”全部 pass，包括服务令牌签发、Runtime JWT 校验和客户侧供应商接口。
  未发送真实企业微信消息。脱敏证据
  `evidence-connector-runtime-production-20260718T144837Z.json` SHA-256 为
  `61fcb280d537b0aa78b45cc0536f387e173bdbcbffe2f554c0f499bfb395f1fb`。
  `0.3.132` 和最终 Worker 发布后，认证浏览器于
  `2026-07-18T20:41:16.297Z` 再次验证身份、目录、应用、权限、两条通知链路和
  Workflow 待办共 7/7 返回 200；Workflow 返回真实待办数据。脱敏证据
  `evidence-authenticated-smoke-20260718T204116Z.json` SHA-256 为
  `e7cfc08d9094681280d681b7021d6a5a05071c841605e274666fd600e26f549f`。
- [x] CTR-824：Platform 进程和 `hzy_platform_cf@%` 只访问控制面 `hzy_platform`；
  没有 `hzy_console` 权限或 Console DB binding。
- [x] CTR-825：初始 Runtime `0.3.129` / Worker version 216 的 T0 gate 已归档；
  后续发布和 schema 迁移使该锚点失效。当前 T0 已重置到 Runtime `0.3.133`、
  Worker version 236 和 schema revision
  `sha256:3f65861f15afa34691b4f9751751f984afd2f82716dc876203f19133843fbcc3`。

### P8-D：不可逆收口

- [x] CTR-831：已撤销 `cf_app@%` 对 `hzy_console` 的全部 grant，撤权后 count 为 0。
- [x] CTR-832：Console 的旧 grant/binding/secret 已移除；`cf_app` 对
  `hzy_console` 的权限为 0，Platform/Worker 也没有 Console DB transport 或
  credential。共享 `cf_app` 和数据库监听仍服务七个其他业务 schema，其账号锁定
  与全局网络收口转入各模块 Runtime 迁移，不属于 Console 变更的安全回退路径。
- [x] CTR-833：Worker 无 DB transport/credential，Platform 无 `hzy_console` grant；
  `hzy_console_runtime@localhost` 仍可读写且 cutover gate 为 ready。
- [ ] CTR-834：最终 72 小时观察已于 `2026-07-19T23:15:50.641Z` 重新启动，最早
  `2026-07-22T23:15:50.641Z` 才可完成。当前自动化班次已通过正式 Platform
  bootstrap 信任链执行，Runtime 0 warning/0 restart、cutover blocker 0、
  review-required backlog 0、Worker forbidden binding 0、旧身份 Console grant 0；
  最终基线证据
  `evidence-observation-20260719T232430Z-runtime-0.3.133-worker-236-hardened.json`
  SHA-256 为
  `b8cbb8f955d4c749deb7544cf063f26f47506e66e91fca2164c2bd030211392e`，
  `checksPassed=true`、`eligibleToClose=false`。该增强证据同时证明 Worker 236
  是唯一 100% 当前部署、Runtime active 时间早于观察起点、updater 目标和
  timer/request path 正常、生产 Connector 与 Console 心跳 active、dev 重复实例
  disabled/inactive。Worker 216/222/223/228 及 Runtime
  0.3.129/0.3.131/0.3.132 的既有证据仅作为历史轨迹保留，不再作为 72 小时
  关闭锚点。Connector 恢复证据
  `evidence-connector-runtime-recovery-20260719T231658Z.json` SHA-256 为
  `906b59fc3ee6bd2878fb1912edd7486ae82e1c5ac97ecd94393e1309c3a350aa`；
  唯一生产 `0.4.22` 已恢复 enabled/active 和 active 心跳，dev 重复实例保持
  disabled/inactive。最终关闭脚本的 8 项门禁/完整 CLI 链路测试已通过；使用当前
  基线进行预检时，门禁先验证基线文件与固定 SHA-256，再按预期以
  “72-hour observation window has not completed”拒绝同一份早期证据作为最终观察，
  且未生成关闭报告。基线和最终观察均强制包含既定 15 个 cutover check 与六项
  零值 backlog/失败指标；缺项、重复项或 `reviewRequired` 降级都会被拒绝。
  加强后的观察生成器已在生产再次执行，证据
  `evidence-observation-20260719T234258Z-runtime-0.3.133-worker-236-hardened.json`
  SHA-256 为
  `1f57691db5fd1bd27f087113fc491e2aa7d078dd275d40d00e7ee9746efd62da`；
  15 个必备 check、六项零值关闭指标、Runtime 0 warning/0 restart、Connector
  心跳和 Worker 100% 部署均通过，观察仍为 `in_progress`。
  `2026-07-20T20:47:33Z` 后续班次在写证据前失败关闭：当前 100% 部署已变为
  Worker version 242（`0f9b4e72-96a3-4270-a937-1a7a50588d47`），与本窗口锁定的
  Worker version 236 不一致；本次没有生成观察证据。新版本仍为 44 个 binding 且
  无禁止 binding，但不得自动替换关闭锚点。CTR-834 保持未完成，须先由负责人确认
  新部署并重新锁定 Worker，再从新锚点重新开始完整 72 小时窗口。
- [ ] CTR-835：旧 secret/Hyperdrive 配置已移除；加密备份已登记至少保留 90 天至
  `2026-10-16T20:40:20.525Z`，禁止自动删除且销毁须经 owner 明确批准。保留清单
  `backup-retention-manifest.json` SHA-256 为
  `ae3fbd6d366bdf0799898aad3572292c3e3d2210dd4a7a37fb97f5a470f83151`；
  CTR-801/816 批准例外已完成。待 72 小时观察完成后必须生成覆盖完整窗口且所有
  blocker、跨租户、secret、回滚、错误预算和 Connector 心跳事件计数为 0 的运营
  汇总，再由 `pnpm run finalize:console-zero-db-cutover` 校验最终观察、运营汇总、
  严格验收快照和实际加密备份后归档关闭报告。运营汇总必须精确引用当前增强基线
  和最终观察，并至少引用一个窗口内中间班次，合计不少于三份不同文件。最终 CLI
  会从同一受控目录逐份验证 `0600` 权限、实际 SHA-256、时间窗和全部技术锚点，
  不能用未绑定的占位引用代替。

## 6. 阶段依赖、责任人与交付证据

| 阶段 | 前置依赖 | 主责 | 必须归档的证据 | 放行条件 |
|---|---|---|---|---|
| P8-A | 维护窗口、Runtime 管理地址、DBA 访问 | Runtime + DBA | 备份 ID/校验、恢复演练、schema/cutover JSON | `ready` 且无 blocker |
| P8-B | P8-A 通过、`console-test` | Runtime + Console + 业务 | 全链路、隔离、断网、重放、撤销测试报告 | 四方会签 |
| P8-C | P8-B 会签、回滚包可用 | Console + Runtime | PM2/Worker release、浏览器/API smoke request ID、指标快照 | 短观察窗达标 |
| P8-D | P8-C 达标、DBA 双人复核 | DBA + 安全 | grant 前后对比、网络不可达、Runtime 可达、72h 指标 | 无回退且证据齐全 |

证据只保存脱敏结果、版本、时间、request/receipt ID 和校验值。DSN、密码、token、
私钥、原始 credential 或上游敏感响应不得进入源码仓库、聊天或普通工单。

## 7. 发布门禁

离线门禁：

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

维护窗口 live 门禁：

```bash
pnpm run verify:console-zero-db-cutover -- \
  --console-url https://wiztek.huizhi.yun/ \
  --runtime-url http://127.0.0.1:18080 \
  --schema-token-env HZY_CONSOLE_SCHEMA_READ_TOKEN \
  --evidence-file /secure/change-evidence/wiztek-console-cutover-t0.json
```

退出标准：

- 任一 schema、隔离、Auth、Vault、可靠操作或 fail-closed 测试失败即停止切流。
- `mode=cutover` 任一 blocker 非零不得用人工口头确认绕过；必须修复数据或在受审批
  的变更记录中完成数据处置后重新检查。
- 进入 `runtime_only` 后不把 DB credential 加回 Console；回滚只允许回滚
  Console/Runtime release 或 Runtime route。
- ACL 撤销后才可开始最终观察期；观察期通过前不销毁迁移备份。

## 8. 当前下一步

1. 每个观察班次以一次性短时 schema token 执行
   `pnpm run observe:console-zero-db-cutover`，重复 health、`mode=cutover`、Worker
   binding、Runtime warning/restart、DB grant 和 backlog 检查并保存脱敏快照；
2. `2026-07-22T23:15:50.641Z` 之后复核 72 小时指标和异常单，满足
   关闭条件后生成运营汇总和最终观察证据，再执行
   `pnpm run finalize:console-zero-db-cutover`；只在该门禁生成受保护关闭报告后
   完成 CTR-834/835；
3. `cf_app` 的全局锁定与数据库网络收口转交其他七个业务 schema 的 Runtime 迁移，
   不能为完成 Console 清单而破坏现有应用；
4. 任一阶段失败均按 Runbook 停止或回滚，不把 DB credential 恢复给 Console。
