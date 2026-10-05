# Console 数据表归属与迁移清单

状态：CTR-002 表归属与 CTR-003 直接调用基线已完成

基线日期：2026-07-14

修订日期：2026-07-17

Schema 来源：`console/docs/hzy_console_schema.sql`、Console 增量 SQL、`console/deploy/cloudflare/001_runtime_cache.sql`

决策依据：`docs/ADR-017-Console-Tenant-Data-Plane-Separation.md`

## 1. 归属结论

不存在平台托管 `hzy_console_control`。除可重建的 Platform 签名缓存和公开 JWKS 缓存外，当前 `hzy_console` 的持久化表全部属于客户侧 Tenant Runtime。

这意味着：

- Cloudflare、PM2、Self-hosted Console 都不直接访问这些表；
- 表可以在第一阶段继续位于现有 `hzy_console`，访问路径先统一到 Tenant Runtime；
- 如果现有物理数据库由平台托管，访问路径迁移后还必须执行客户侧物理搬迁；
- Platform 只保存自己生成的控制面事实、Runtime 注册和必要脱敏主体投影；
- Platform/边缘缓存不得成为 Session、Directory、Vault、通知或审计的第二事实源。

## 2. 判定规则

- **租户核心事实**：只存客户数据库，只能由 Tenant Runtime 领域 adapter 使用。
- **Runtime 私密安全事实**：Session、Token、Signing Key、Vault、Service Credential 等同样属于客户侧；平台只见公钥、指纹和健康摘要。
- **可重建控制缓存**：源数据本来就由 Platform 生成且不含租户私有明细时，可迁到边缘缓存；缓存不可作为授权或业务事实。
- **临时用户数据**：Presence、Clipboard 等即使有 TTL，仍是租户用户数据，默认留客户侧。
- **隐式单租户**：当前多数表依靠“一库一租户”隔离。Runtime enrollment 必须校验库内 `org_profiles.tenant_code` 与 Token tenant 一致。
- **保留期**：按数据类别表达；具体天数由安全、审计和客户合同确定。

## 3. 企业配置与日历

| 表 | 领域/事务组 | 敏感度 | 目标与迁移要求 |
| --- | --- | --- | --- |
| `org_profiles` | 企业资料 singleton | 中 | Tenant Runtime；校验库内 tenant 与 enrollment 一致；`revision` 用于 CAS |
| `console_mutation_receipts` | Console 用户写操作幂等账本 | 高 | Tenant Runtime；与领域 mutation、`operation_logs` 同事务；不得与跨应用 `service_command_receipt` 混用 |
| `org_business_domains` | 业务领域树 | 低 | Tenant Runtime；保留本地层级事务 |
| `regions` | 区域根 | 低 | Tenant Runtime |
| `region_divisions` | 区域明细 | 低 | Tenant Runtime；与 `regions` 同事务 |
| `setting_catalogs` | 参数目录 | 中 | Tenant Runtime；不得保存 Secret |
| `setting_values` | 参数值 | 中 | Tenant Runtime；写入带 revision 和审计 |
| `work_calendars` | 日历根 | 低 | Tenant Runtime |
| `work_calendar_days` | 日级事实 | 低 | Tenant Runtime；批量计算在客户侧 |
| `work_calendar_months` | 月汇总投影 | 低 | Tenant Runtime；与日级更新同事务或 Receipt 重算 |
| `work_calendar_import_jobs` | 导入 Job | 中 | Tenant Runtime；网络拉取与批量写由客户侧执行 |
| `dictionaries` | 字典根 | 低 | Tenant Runtime |
| `dictionary_items` | 字典项 | 低 | Tenant Runtime；与字典根同事务 |

## 4. Directory 与 Connector

| 表 | 领域/事务组 | 敏感度 | 目标与迁移要求 |
| --- | --- | --- | --- |
| `directory_users` | 用户主数据 | 极高 PII | Tenant Runtime；mutation 与 subject outbox/revision 同事务 |
| `directory_departments` | 部门树 | 高 PII | Tenant Runtime |
| `directory_user_departments` | 用户部门 membership | 高 PII | Tenant Runtime；Platform 只接收授权所需脱敏投影 |
| `directory_projects` | 项目注册表 | 中 | Tenant Runtime；后续评估与 Aims 的唯一事实源边界 |
| `directory_project_members` | 项目 membership | 高 PII | Tenant Runtime |
| `directory_identities` | 外部身份映射 | 极高身份数据 | Tenant Runtime；Platform 不保存完整 identity 明细 |
| `directory_subject_exports` | 脱敏授权主体投影源 | 高 | Tenant Runtime；分块、单调 revision、snapshot hash |
| `directory_sync_jobs` | 显式同步 Job | 高 | Tenant Runtime；不由 Cloudflare 周期全量扫描 |
| `directory_sync_events` | 同步事件 | 高 | Tenant Runtime；与 Job/result 同事务 |
| `directory_lifecycle_scope_versions` | People 生命周期水位 | 高 | Tenant Runtime；状态 mutation 同事务推进 revision |
| `directory_connector_enrollments` | Connector enrollment | 极高 | Tenant Runtime；Platform 只保存 Runtime 注册摘要/公钥指纹 |
| `directory_connectors` | Connector 配置、身份和命令状态 | 极高 | Tenant Runtime；Connector 通过签名 loopback，不持 DB 账号 |
| `connector_runtime_enrollments` | 企业连接运行时 enrollment | 极高 | Tenant Runtime；一次性 token 只存 hash |
| `connector_runtime_instances` | 企业连接运行时状态 | 高 | Tenant Runtime；Platform 只看脱敏健康摘要 |

## 5. Vault、Integration 与 Service Identity

| 表 | 领域/事务组 | 敏感度 | 目标与迁移要求 |
| --- | --- | --- | --- |
| `vault_secrets` | Secret metadata/current | 极高 | Tenant Runtime；客户侧密钥/KMS |
| `vault_secret_versions` | Secret 版本链 | 极高 | Tenant Runtime；密文不返回 Console/Platform |
| `vault_access_logs` | reveal/resolve/rotate 审计 | 极高 | Tenant Runtime；追加写和归档 |
| `integrations` | Integration 配置 | 高 | Tenant Runtime；含上游登录 IdP 配置 |
| `integration_credentials` | Integration 与 Vault 版本绑定 | 极高 | Tenant Runtime；不返回浏览器或 BFF |
| `integration_check_logs` | 连通性检查 | 高 | Tenant Runtime；测试由客户侧执行 |
| `service_clients` | Workload/Service 身份元数据 | 高 | Tenant Runtime；按 tenant/deployment/source/target 绑定 |
| `service_client_credentials` | Service credential hash/current | 极高 | Tenant Runtime；平台不保存可恢复凭证 |
| `service_client_grants` | Service capability | 高 | Tenant Runtime 消费 Platform/Manifest 治理结果；精确 capability |

说明：

- Platform 可以治理“哪个 deployment/app 应拥有哪个 capability”，但客户侧 Runtime 是 credential 校验、Token 签发和执行时授权边界。
- Platform 不保存 Service Client Secret；如果托管应用需要 workload credential，使用 enrollment/attestation 生成的部署绑定身份，不能形成通用租户管理员身份。

## 6. Auth Runtime 与企业用户 Session

| 表 | 领域/事务组 | 敏感度 | 目标与迁移要求 |
| --- | --- | --- | --- |
| `local_sessions` | 企业用户 Session | 极高 | Tenant Runtime；Console Cookie 只是传输句柄 |
| `auth_login_events` | 登录/失败/登出审计 | 高 | Tenant Runtime；统一审计投影 |
| `auth_identity_providers` | 上游 IdP 配置 | 极高 | Tenant Runtime；Secret 绑定 Vault |
| `auth_external_login_transactions` | OAuth state/browser binding | 极高短期 | Tenant Runtime；单次消费、严格 TTL |
| `auth_clients` | 下游 OIDC client | 高 | Tenant Runtime；默认从签名 Bundle 投影物化 |
| `auth_client_redirect_uris` | Redirect/logout 白名单 | 高 | Tenant Runtime；exact match |
| `auth_authorization_codes` | Authorization Code | 极高短期 | Tenant Runtime；只存 hash、单次消费 |
| `auth_refresh_tokens` | Refresh family/reuse/revoke | 极高 | Tenant Runtime；只存 hash、rotation/reuse detection |
| `auth_token_events` | Token issue/refresh/revoke | 高 | Tenant Runtime；统一审计投影 |
| `auth_signing_keys` | OIDC/JWT key metadata | 极高 | Tenant Runtime；私钥客户侧生成且不可导出，Platform 只见公钥/指纹 |

迁移约束：

- 不创建 `control_auth_subjects`、`control_projection_receipts` 或中央 Session 表。
- Tenant Runtime 离线时新登录、refresh 和需要实时撤销检查的操作失败关闭。
- JWKS/discovery 可以边缘缓存，但缓存只包含公开或已签名内容。

## 7. 通知、可靠操作与统一审计

| 表 | 领域/事务组 | 敏感度 | 目标与迁移要求 |
| --- | --- | --- | --- |
| `integration_operation` | caller-owned operation | 高 | Tenant Runtime；与 source mutation 同事务 |
| `integration_operation_attempt` | lease/fencing attempt | 高 | Tenant Runtime；保留本地唯一约束 |
| `service_command_receipt` | target receipt | 高 | Tenant Runtime；与 target mutation 同事务 |
| `console_platform_lifecycle_actionables` | lifecycle 通知/closure | 高 | Tenant Runtime；不跨库外键 |
| `portal_notifications` | 通知根 | 高 PII | Tenant Runtime |
| `portal_notification_recipients` | recipient/read state | 高 PII | Tenant Runtime；当前用户/授权管理 API |
| `portal_notification_deliveries` | 外发 attempt | 高 | Tenant Runtime；客户侧 drain |
| `portal_actionable_projections` | actionable generation/state | 高 | Tenant Runtime；单调版本和 closure receipt |
| `operation_logs` | Console 通用审计 | 高 | Tenant Runtime；作为统一审计查询来源之一 |

统一审计不要求立即把历史表物理合并。Runtime 先统一 audit envelope 和查询投影，领域事务仍可把关键审计写入最适合原子提交的本地表。

## 8. 临时用户数据和缓存

| 表 | 领域/事务组 | 敏感度 | 目标与迁移要求 |
| --- | --- | --- | --- |
| `local_presence_heartbeats` | 在线状态 TTL | 中 PII | Tenant Runtime；强制 TTL，不作为授权事实 |
| `runtime_clipboards` | 用户临时剪贴板 | 高 PII | Tenant Runtime；大小/TTL/用户隔离 |
| `console_runtime_cache` | Policy Bundle/runtime 元数据缓存 | 高但可重建 | 从租户库移除；改为内存或边缘缓存，只保存 Platform 已知签名内容和公开 JWKS |

`console_runtime_cache` 不是新的中央 Console 数据库理由。边缘缓存不可保存 Session、Secret、目录 PII、通知或审计。

## 9. 不创建的旧方案表

以下旧方案对象不再创建：

| 旧对象 | 处理 |
| --- | --- |
| `hzy_console_control` | 取消 |
| `control_auth_subjects` | 取消；企业用户状态由客户侧 Auth/Directory Runtime 管理 |
| `control_projection_receipts` | 取消；控制面投影使用 Platform 现有 Runtime/subject 接口 |
| `tenant_runtime_routes`（Console DB 内） | 取消；Platform Runtime registry 是唯一事实源 |

## 10. 跨域事务处理

| 场景 | 权威事务 | 协调方式 |
| --- | --- | --- |
| 用户禁用并撤销 Session | 同一客户 `hzy_console` | Directory + Auth adapter 共用客户侧事务或可靠本地 Operation |
| IdP 配置与 Vault Secret | 同一客户 `hzy_console` | Integration/Vault 同事务绑定固定 Secret version |
| Service Client 轮换与 Grant | 同一客户 `hzy_console` | Runtime 行锁和 current/version 不变量 |
| Source mutation 与跨应用调用 | Source app 客户库 | caller-owned operation + target Receipt |
| Directory subject 投影到 Platform | 客户库 → Platform DB | outbox、单调 revision、幂等 Platform receipt |
| Runtime 路由 | Platform DB | Tenant Gateway 注入已验证 endpoint；无 DSN |

## 11. 调用清查要求

2026-07-17 基线见 `Console-Direct-DB-Call-Baseline-2026-07-17.md`。可重复脚本
`scripts/audit-console-db-boundary.mjs` 的冻结基线为 51 个生产文件、522 个静态
DB helper 调用点；2026-07-17 当前结果为 0 个文件、0 个调用点。后续变更必须记录：

- 删除/替换的直接 DB 调用数量；
- 剩余数量和所属领域；
- 事务边界是否迁入 Runtime；
- 旧 SQL 是否仍可达；
- 对应 capability、幂等和审计测试；
- DB 用户已撤销的表权限。

完成状态以“可达直接 DB 调用为零、Console 数据库依赖删除、网络 ACL 撤销”为准，而不是仅以页面已改用 API 为准。
