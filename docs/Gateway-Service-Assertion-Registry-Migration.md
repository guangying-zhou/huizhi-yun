# Gateway 断言登记与 replay：第一批迁移

第一批仅迁移代码与隔离测试，未应用任何环境；第一批不包含登记 API 或 keyset。
第二批的登记命令与签名下发见 [keyset 合同](Gateway-Service-Assertion-Keyset.md)。
私钥生成/写入、exchange 路由与开关启用仍属后批，按批审查。

## 控制通道前置结论

`platform/server/api/v1/runtime/agent-heartbeat.post.ts` 调用 `exportPubkey()`，
返回 `data.platformSigningKey` 公钥元数据与 `deploymentBindings`，不调用签名函数，
响应没有签名。`data-runtime/cmd/hzy-data-runtime/control_heartbeat.go` 以控制 token
经 HTTPS 接收，再用 `json.Unmarshal` 解码、持久化；没有验响应签名。
因此该通道不能直接承载可信 Gateway 授权 keyset。

旧实现（提交 `519885357`）及当前实现均用普通 `json.Unmarshal`，忽略未知字段，
没有 `DisallowUnknownFields`；`TestControlHeartbeatToleratesUnknownResponseFields`
覆盖外层和 data 内未知字段并保留已知字段。这种兼容性不赋予新字段可信性。
按裁决，下一批使用独立 Platform Ed25519 签名 keyset 端点和新持久化文件；
验签根必须预先固定，不能采信同次未签名 heartbeat 下发的新根。

## 数据模型

- Platform：`platform_gateway_keysets` 每个 deployment site 一条持久 revision；
  `platform_gateway_service_keys` 保留公钥、状态、有效期、员工 uid 与撤销时间。
  管理端按 **BINARY 精确 site_code** 查 active `deployment_sites`，用其 id（site_id）关联，
  tenant/environment 从该站点取。FK RESTRICT 防止站点删除后留下孤儿密钥；
  冻结 site_code/tenant/environment，员工命令和签名读取均与当前站点逐项复核。
  不新增 app、subscription 或 deployment，故不进入目录、权益或策略包。
  线上 gatewayDeployment/gateway_deployment 等既有字段承载 site_code，不是应用部署代码。
  90 天有效期上限、两个 `next/active` 轮换槽位由 CHECK/唯一键约束；撤销历史保留。
  `kid` 为原始 32-byte Ed25519 公钥的 SHA256 小写 hex，公钥为规范 base64url。
  表不存私钥。后续员工管理命令还须验证 canonical 公钥与 kid、一经登记公钥不可替换、
  revoked kid 不可复活，并在同一事务更新 revision/审计。本批没有该命令，不能宣称
  单靠表约束已实现上述状态迁移规则。
- Runtime Console 库：可选 `gateway_service_assertion_replay`，主键
  `(gateway_deployment_code,jti)`；jti/kid 使用 ascii_bin，绑定字段 utf8mb4_bin。
  存 tenant/environment、kid、expires_at、created_at；时间为 Unix 毫秒。
  后续 exchange 在**签发/审计同一事务**插入，重复拒绝，失败回滚。
  不复用 Console assertion 表，不加入 legacy schema 必备表清单。
  清理仅限过期且超过时钟容差的记录，清理后时间窗检查仍必须拒绝旧断言。

## 迁移、备份与 verify

SQL：

- [Platform 迁移](../platform/docs/sql/migrations/20260926-gateway-service-keys.sql)
- [Runtime replay 迁移](../console/docs/sql/Console-SQL-Migration-gateway-service-assertion-replay.sql)

两份 canonical DDL 同步包含这些可选表。迁移只 CREATE IF NOT EXISTS，零 seed、
零 grant、零现有行修改；旧 Runtime/Console 不读取这些表。缺迁移时，后续新路径
应 503，原路径保持不变；本批尚无新路径。

Console 的生成器以 `console/docs/hzy_console_schema.sql` 为实际 schema 输入，
该文件也同步 replay 表。生成器明确排除新 replay 表，并修复其此前遗漏
`console_service_assertion_replay` 排除项的问题（现有生成制品已排除该旧表，但
脚本再生成会错误地重新要求它）。新制品的必备 66 表内容不变，只更新源 hash
与 optional 表列表；`TestVerifiedPolicySchemaIsOptIn` 保护两种 assertion 表。

`node scripts/gateway-assertion-migration.mjs --plan platform|runtime <private-config>`
默认只读；`--verify` 只读核对精确 schema 指纹。配置文件不得入 Git，字段形状：
`connection`（数据库连接凭据）、`binding`（database/serverUuid/tenant/environment，
Platform 加 gatewayDeployment；Runtime 加 runtimeCode/consoleDeployment）、
`expectedSchemaHashes`、`backupDirectory`。仅允许 test/dev；database 与 MySQL
server_uuid 必须匹配，Platform 还核对 active deployment 的精确 tenant/environment。
Runtime binding 是部署运维输入，apply 前须另核对私有 Runtime 配置，不能把它当
认证/授权事实。工具只输出绑定与哈希，不输出连接凭据或表数据。

参考 schema 指纹必须在**相同 MySQL 版本的 /tmp 一次性库**由已审 SQL 生成，
使用导出的 `migrationSource`/`inspectGatewaySchema`/`schemaHashes`；按表核对
列类型/default/collation/generated、索引、ENFORCED CHECK、FK、engine。
不得用环境里可能漂移的表反向生成参考 hash。plan hash 绑定 SQL、目标和迁移前
精确状态；`--apply ... <reviewHash>` 在 migration lock 内重做 plan，任何差异拒绝。
先在 0700 目录写 0600 的 before.json（原 DDL 或 absent），再应用、verify、写回执。
既有表漂移直接拒绝，IF NOT EXISTS 不能掩盖漂移。

**DDL 非事务。**环境 apply 前仍需完整加密库备份（独立迁移账号与部署授权由后续
关口提供），工具的 DDL 备份不能替代数据备份。中断后重新 plan：已建立表必须
与参考完全一致；可重跑 additive SQL 建剩余表，不删除/覆盖旧表。出现异常漂移则
停止并按完整备份恢复方案处理，不自动 DROP。所有环境写入目前未经批准。

## 已有验证与待后批验证

`node scripts/test-gateway-assertion-migrations-mysql.mjs` 仅启动 /tmp 一次性 MySQL：
plan 零写入、错误 hash/目标拒绝、备份权限、重复 apply、canonical DDL 一致、FK、
双槽位/有效期/撤销状态约束、binary jti、跨部署隔离、并发仅一行、回滚后重试、
schema 漂移失败及业务哨兵不变。它不访问现有 C000001 或 Platform。

验签、完整时间窗、keyset revision、防 kid 复活、grant/审计失败关闭与 Worker 签名
属于后续批次，当前不能宣称 Gateway exchange 可用。Gateway Worker 部署、secret、
开发 Platform schema/写入、开关启用必须另获用户批准。
