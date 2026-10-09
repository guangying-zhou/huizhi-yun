# 生产只读核对清单（10/8 上线前）

本清单供生产只读通道开通后执行，**当前未连接或核实生产库**。执行者先记录 UTC 时间、环境/库名、只读账号标识、查询或控制台视图、结果计数和证据路径；只保存脱敏结果，不保存连接串、令牌、密文、`scope_json` 原文或解密结果。所有 SQL 均只读，建议在目标库使用只读账号及一致性只读事务；若表、列、版本与此处不符，停止并按生产 schema 重新审阅查询，不能把本机测试库结果代入。建议证据目录：`go-live/20261008/prod-readonly/<UTC>/`，按下列编号保存文本/截图，由执行者记录实际库和时间。本文不授权迁移、grant 写入、部署、探测 Worker 出站或其他生产变更。

门禁编号引用 [上线计划 §3](Go-Live-20261008-Plan.md)：G1 制品、G2 授权、G3 CPU、G5 Workflow、G6 故障恢复、G8 备份恢复。批 3 的 74 对资源零行是生产 manifest release 的独立前置门禁 B3；v2.28 撤旧精确 grant 的只读前置为 B4；GitLab 上线链的凭据和出站前置为 GL。生产现状参考 [9/28 只读记录](Wiztek-Production-Read-Only-Check-20260928.md)，其中本机/公开探针并非生产库或 Worker 出站证据。

## 01. 环境与制品基线

- **目的/权限/门禁**：确认只读查询确实落在生产 Console、Platform、Workflow 库，记录现役 Worker/Runtime 版本；生产库只读账号及 Cloudflare 只读；G1、G2、G5。
- **只读命令**：每个目标数据库执行 `SELECT DATABASE() AS db_name, @@hostname AS db_host, UTC_TIMESTAMP() AS checked_at_utc;`。Runtime 使用 `curl -fsS https://wiztek-data-runtime.huizhi.yun/runtime/health`（仅公开健康响应）。Cloudflare 控制台 Workers & Pages → 各 Worker → Deployments 读取活跃版本、发布时间及提交；如生产配置已支持 Wrangler 只读登录，可用 `wrangler deployments list --name <worker-name>`，分别记录 Gateway、Console、Workflow、Host、Assets 的活跃版本。不要使用 deploy、tail、secret put。
- **预期/证据**：库名与运维登记一致；制品为同一已批准干净提交的 manifest/hash，Runtime 无 `-dirty`。9/28 记录的 Runtime `0.3.219`/`c11c7c66-dirty` 仅是当时观察，若仍现役则 G1 不通过。保存 `01-env.txt`、`01-deployments.png`；Worker active 不代表业务健康。

## 02. 批 3：74 对已移除资源的全租户孤儿行

- **目的/权限/门禁**：生产 Platform 正式发布三模块 manifest 前，核对 `tenant_role_permissions`、`tenant_role_scopes`、`platform_app_role_permissions` 对已移除的 74 对 `(app_code,resource_code)` 均为零；生产 Platform 库只读；**B3，非零即停止 release**。
- **只读 SQL**：下列列表来自批 3 审查用 manifest 差异，Aims 61、Assets 3、Codocs 10。`tenant_role_*` 按租户聚合，平台角色表无租户列，记为 `GLOBAL`。只读事务内执行；不查询 scope 值。

```sql
WITH removed AS (
  SELECT jt.app_code, jt.resource_code
  FROM JSON_TABLE('[["aims","admin-projects"],["aims","company-weekly-summaries"],["aims","my-work-items"],["aims","project-board"],["aims","project-create"],["aims","project-deletion"],["aims","project-deliverables"],["aims","project-edit"],["aims","project-favorites"],["aims","project-gitlab"],["aims","project-member-add"],["aims","project-member-remove"],["aims","project-member-role"],["aims","project-members"],["aims","project-milestones"],["aims","project-plan"],["aims","project-portfolios"],["aims","project-products"],["aims","project-releases"],["aims","project-repos"],["aims","project-routine-review"],["aims","project-template-versions"],["aims","project-time-entries"],["aims","project-weekly-report-period"],["aims","project-work-items"],["aims","requirement-targets"],["aims","time-entries"],["aims","time-entry-reviews"],["aims","timesheet-overview"],["aims","timesheet-weeks"],["aims","user-time-entries"],["aims","weekly-report-overview"],["aims","weekly-report-review"],["aims","weekly-reporting-periods"],["aims","weekly-reports"],["aims","work-item-append-confirm"],["aims","work-item-append-reject"],["aims","work-item-append-tasks"],["aims","work-item-associate"],["aims","work-item-batch"],["aims","work-item-breakdown"],["aims","work-item-comments"],["aims","work-item-commit-diff"],["aims","work-item-commits"],["aims","work-item-complete"],["aims","work-item-completion-replay"],["aims","work-item-create"],["aims","work-item-decomposition"],["aims","work-item-delete"],["aims","work-item-deliverables"],["aims","work-item-distribute-confirm"],["aims","work-item-distribute-revoke"],["aims","work-item-documents"],["aims","work-item-edit"],["aims","work-item-execution"],["aims","work-item-plan-ready"],["aims","work-item-reopen"],["aims","work-item-reset"],["aims","work-item-start"],["aims","work-item-time-entries"],["aims","work-items"],["assets","asset-item"],["assets","digital-asset"],["assets","ip-asset"],["codocs","collab-documents"],["codocs","document-access-records"],["codocs","document-annotations"],["codocs","document-shares"],["codocs","document-transfer"],["codocs","personal-cabinet"],["codocs","personal-documents"],["codocs","personal-folders"],["codocs","publish-execution"],["codocs","review-history"]]', '$[*]'
    COLUMNS (app_code VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$[0]',
             resource_code VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$[1]')) AS jt
), hits AS (
  SELECT 'tenant_role_permissions' AS table_name, p.tenant_code,
         p.app_code, p.resource_code, COUNT(*) AS row_count
    FROM tenant_role_permissions p JOIN removed r
      ON r.app_code=p.app_code AND r.resource_code=p.resource_code
   GROUP BY p.tenant_code,p.app_code,p.resource_code
  UNION ALL
  SELECT 'tenant_role_scopes', s.tenant_code,
         s.app_code,s.resource_code,COUNT(*)
    FROM tenant_role_scopes s JOIN removed r
      ON r.app_code=s.app_code AND r.resource_code=s.resource_code
   GROUP BY s.tenant_code,s.app_code,s.resource_code
  UNION ALL
  SELECT 'platform_app_role_permissions','GLOBAL',
         p.app_code,p.resource_code,COUNT(*)
    FROM platform_app_role_permissions p JOIN removed r
      ON r.app_code=p.app_code AND r.resource_code=p.resource_code
   GROUP BY p.app_code,p.resource_code
)
SELECT table_name,tenant_code,app_code,resource_code,row_count
  FROM hits ORDER BY table_name,tenant_code,app_code,resource_code;
```

- **预期/证据**：**零行**；保存 `02-orphans.txt`（含查询时间、零行证明）。任一行出现即停止，交付资源/租户/计数，不自行清理或放宽门禁。

## 03. v2.28 旧精确 grant 的实际 audience 与观察窗口

- **目的/权限/门禁**：为生产旧精确能力撤销生成逐 audience、逐 ID 的审阅输入；生产 Console 库只读，加 Cloudflare/Console 安全日志只读；B4、G2。旧 grant 可能在 `data-runtime` 与 `tenant-runtime`，不能从 v2.27 的五条新域 grant 推断。特别核对 D2 `console:directory-self:read` 和 v2.26 ID `13227427/13227428`，只按**实际生产行**判断。
- **只读 SQL**：先列 `enterprise.runtime` 的**全部** grant 元数据，按 `resource_code/action`、派生 audience、`semanticScope`、tenant/deployment、status 分类。`scope_json` 仅在 SQL 内提取限定字段，不输出原文；用已审 v2.28 旧精确能力清单与结果求交，不能只用 `status='active'` 或模糊前缀一键撤销。

```sql
SELECT g.id, sc.client_code, g.resource_code, g.action, g.status,
       JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience')) AS audience,
       JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope')) AS semantic_scope,
       JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode')) AS tenant_code,
       JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode')) AS deployment_code,
       COUNT(*) AS row_count
  FROM service_client_grants g JOIN service_clients sc ON sc.id=g.service_client_id
 WHERE sc.client_code='enterprise.runtime'
 GROUP BY g.id,sc.client_code,g.resource_code,g.action,g.status,
          audience,semantic_scope,tenant_code,deployment_code
 ORDER BY audience,g.resource_code,g.action,g.id;
```

- **只读日志核对**：在 Console **安全签发日志**按已审旧精确 scope 清单过滤 `enterprise.runtime`，按 `audience, semantic_scope, UTC 小时` 汇总请求次数；至少覆盖一个同步周期与一次正常 Host 巡检。只导出 scope 名、时间桶、次数、结果码；不导出 token、请求头或原始 body。若现有日志不能可靠区分调用方/scope，记为“证据不足”，不得推断零请求。
- **预期/证据**：列出各旧精确 grant 真实 audience、状态和 ID；五条 `*:enterprise-host:execute` 域 grant、scheduler/worker、Workflow proxy、policy reader、notification publish、其他 service client、已 revoked 均不进入撤销候选。观察窗旧 scope 请求数 **0**；否则 B4 停止。保存 `03-grants-metadata.txt`、`03-old-scope-hourly-counts.txt` 和审过的候选 ID 清单。此处绝不执行 v2.28。

## 04. Workflow effects 的生产调用方及旧 broad scope

- **目的/权限/门禁**：确认 `workflow.read/write` 目前是否仍被任何生产调用方用于通知、actionable、callback 的 pending/ack/fail 或诊断路由；Cloudflare/Runtime 请求审计**只读**及生产 Console 库只读；G2、G5。源码预期仅 `workflow.runtime` 经受信 Gateway drain 调用这些路由，生产调用方仍待核。
- **只读命令/查询**：在生产 Runtime 或 Cloudflare 的**既有请求审计/分析**按路径 `/v1/workflow/{notification-effects,actionable-lifecycle-effects,callback-effects}/` 与 `/v1/workflow/delivery-effects/status` 过滤切换前至少一个正常调度周期；按 `METHOD、规范化路径、认证 client_code、audience、scope 名、响应码` 聚合计数。只取结构化元数据，不导出 Authorization 头或 token。另在 Console 库运行：

```sql
SELECT sc.client_code,g.resource_code,g.action,g.status,
       JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience')) AS audience,
       JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope')) AS semantic_scope,
       COUNT(*) AS grants
  FROM service_client_grants g JOIN service_clients sc ON sc.id=g.service_client_id
 WHERE g.resource_code IN ('data-runtime:workflow','tenant-runtime:workflow',
        'data-runtime:workflow:integration_operation','tenant-runtime:workflow:integration_operation')
 GROUP BY sc.client_code,g.resource_code,g.action,g.status,audience,semantic_scope;
```

- **预期/证据**：effects 路由无其他 client 使用旧 `workflow.read/write`；发现使用者则先做迁移/兼容裁定，不能直接收紧。grant 查询只证明持有权，**不能证明实际请求量**；若没有含可信 client/scope 的现成请求审计，记“不可判定”并阻断收紧，而非做写入式探针。保存 `04-effects-callers-counts.txt`、`04-workflow-grants.txt`。`workflow:integration_operation:execute` 的新 grant 应与实际 audience 和部署绑定相符。

## 05. GitLab 集成与凭据元数据

- **目的/权限/门禁**：确认生产 GitLab 集成实际凭据来源和当前版本，供只读评审与后续迁移决策；生产 Console 库只读；GL、G2。仓库 seed 的 `env_ref/external_ref` 仅是初始设计，不能当生产事实。
- **只读 SQL**：

```sql
SELECT i.id AS integration_id,i.integration_code,i.integration_type,i.status AS integration_status,
       i.connectivity_status,i.last_checked_at,i.current_credential_id,
       c.id AS credential_id,c.status AS credential_status,c.version_no AS credential_version,
       c.secret_id,c.secret_version_id,
       s.secret_code,s.owner_type,s.owner_key,s.storage_backend,s.status AS secret_status,
       (s.kms_key_ref IS NOT NULL) AS has_kms_key_ref,s.current_version_id,
       v.version_no AS secret_version,v.encryption_scheme,v.status AS version_status,
       (v.key_fingerprint IS NOT NULL) AS has_key_fingerprint
  FROM integrations i
  LEFT JOIN integration_credentials c ON c.id=i.current_credential_id AND c.integration_id=i.id
  LEFT JOIN vault_secrets s ON s.id=c.secret_id
  LEFT JOIN vault_secret_versions v ON v.id=COALESCE(c.secret_version_id,s.current_version_id)
 WHERE i.integration_code='gitlab.default' OR i.integration_type='gitlab'
 ORDER BY i.integration_code,i.id;
```

- **预期/证据**：当前凭据关联完整、状态符合上线目标，存储后端/加密方案已核清；不输出 `backend_secret_ref`、`ciphertext_blob`、token、`config_json`、错误原文、密钥材料。若实际来源不是这四表，停下并仅用 `information_schema` 定位后另审查询。保存 `05-gitlab-credential-metadata.txt`。私有测试仓库存在性另需 GitLab 命名空间只读权限，不能用公开搜索 0 项代替。

## 06. Workflow 数据库迁移与进行中实例

- **目的/权限/门禁**：确认生产 Workflow 库实际 schema 与待处理审批，避免把 Worker 部署成功误认为 DB 已迁移；生产 Workflow 库只读；G5、G6、G8。
- **只读 SQL**：先执行仓库内 `workflow/docs/migrations/012_durable_notification_outbox_verify.sql`、`013_bounded_delivery_outbox_verify.sql`、`014_delivery_recovery_attribution_verify.sql` 中的 **SELECT 验证语句**，或按上线候选所需版本选对应文件；这些 verify 只查 `information_schema`。再执行：

```sql
SELECT status,app_code,resource_code,action_code,COUNT(*) AS instance_count,
       MIN(created_at) AS oldest_created_at,MAX(updated_at) AS newest_updated_at
  FROM flow_instances
 WHERE status IN ('running','suspended')
 GROUP BY status,app_code,resource_code,action_code
 ORDER BY status,app_code,resource_code,action_code;
```

- **预期/证据**：候选所需迁移 verify **全部 PASS**；进行中/暂停实例按业务分类有完整计数和最早时间，供切换/恢复计划确认，不要求其为零。不读取 `biz_context`、`form_data`、`flow_snapshot`、callback URL 或实例 payload。保存 `06-migrations-verify.txt`、`06-active-instance-counts.txt`。若版本追踪机制另有专表，可额外只读核对版本号，但不能用文件存在代替生产迁移结果。

## 07. Cloudflare 套餐、CPU 能力与 Worker GitLab 出站

- **目的/权限/门禁**：确认账户套餐与现有 Worker 出站配置，识别 G3/GL 风险；Cloudflare **账户只读**；G3、GL。
- **只读操作**：Cloudflare 控制台 Account → Billing/Subscriptions 截图账户当前套餐和 Workers 计费/CPU 限制；Workers & Pages → Host Worker → Settings → Bindings、Routes、Outbound/Network 与 Access 规则，记录非秘密的绑定名、目标域、路由及阻断规则。再看 Cloudflare Analytics/Logs 的既有 Host/Console `exceededCpu` 计数与时间窗（不能用“无日志”代替零）。不得打开 secret **值**、运行 `wrangler secret put` 或部署探针。
- **预期/证据**：套餐和限制与上线 CPU 预算一致；Host Worker 到 `gitlab.wiztek.cn` 的网络/Access/防火墙允许路径有配置依据；记录 `07-plan.png`、`07-worker-egress-config.png`、`07-cpu-counts.txt`。**配置检查不能证明真实出站可达**。Worker 内无凭据 GET 只记录 HTTP 状态/网络错误类别的受控探针属于新增 Worker 执行或部署，需另获用户批准、在预发执行后才能判 GL 出站通过；本只读清单将其标为“待批准/未验证”。本机到 GitLab 的 401 亦不能替代 Worker 证据。

## 08. Gateway scheduler 生产配置与稳定租户数（G3、G5）

- **目的/权限/门禁**：确认五分钟 Workflow drain 的生产租户窗口与 CPU 预算；生产 Platform 库只读账号、Cloudflare 只读。G3 必须按生产实际 shard/wake 配置量测 CPU；G5 才能据此判断审批、通知与待办的唤醒间隔。只看仓库 `wrangler.jsonc` 不能证明现役 deployment 配置。
- **只读 SQL**：以下与 `platform/server/utils/tenantGatewaySchedulerRegistry.ts` 的 eligible 条件一致，覆盖所有 active tenant/site 且至少有一个 active 的七类调度应用部署。先数稳定站点 N，再核 wiztek 生产站点的 shard。这里按推荐的 `SHARD_COUNT=1` 计算；若现役值不是 1，停止按本文预期签收，并用现役值重算 shard/窗口。

```sql
SELECT COUNT(*) AS eligible_site_count
  FROM deployment_sites ds JOIN tenants t ON t.tenant_code=ds.tenant_code
 WHERE ds.status='active' AND t.status='active'
   AND EXISTS (SELECT 1 FROM deployments d
                WHERE d.tenant_code=ds.tenant_code AND d.environment=ds.environment
                  AND d.status='active'
                  AND d.app_code IN ('aims','altoc','assets','console','finance','people','workflow'));

SELECT ds.tenant_code,ds.environment,
       MOD(CRC32(CONCAT(ds.tenant_code,'|',ds.environment)),1) AS shard_index,
       COUNT(*) AS eligible_site_rows
  FROM deployment_sites ds JOIN tenants t ON t.tenant_code=ds.tenant_code
 WHERE ds.tenant_code='wiztek' AND ds.environment='prod'
   AND ds.status='active' AND t.status='active'
   AND EXISTS (SELECT 1 FROM deployments d
                WHERE d.tenant_code=ds.tenant_code AND d.environment=ds.environment
                  AND d.status='active'
                  AND d.app_code IN ('aims','altoc','assets','console','finance','people','workflow'))
 GROUP BY ds.tenant_code,ds.environment,shard_index;
```

- **Cloudflare 只读操作**：在 `hzy-tenant-gateway` 的现役 Deployment 详情核对 cron trigger、非秘密 Vars `HZY_TENANT_GATEWAY_SCHEDULER_SHARD_COUNT`、`HZY_TENANT_GATEWAY_SCHEDULER_MAX_WAKES`（以及若存在的 `...SHARD_INDEX`）；用 `wrangler deployments list --name hzy-tenant-gateway` 对照活跃部署 ID，再在控制台读该版本 Triggers/Variables。只记录变量名与非秘密值，不打开或打印 Secret。`MAX_WAKES` 未配置表示代码默认 8，须对照现役制品版本确认默认值。
- **预期/证据**：现役 cron 为 `*/5 * * * *`。按 [Gateway README](../deploy/cloudflare/tenant-gateway/README.md) 推荐，**N=1** 时 `SHARD_COUNT=1`、wiztek 为 **shard 0（唯一 shard）**、`MAX_WAKES=8`；**N=2** 时仍为 shard 0、`MAX_WAKES=28`。若 N≥3、shard count≠1、cron/预算不同或 wiztek 不在 eligible 集合，G3/G5 不按推荐配置通过，先重新评估公平性、CPU 与五分钟唤醒目标。保存 `08-scheduler-registry-counts.txt`、`08-gateway-deployment.png`，并在 G3 两小时观测中记录同一配置下的 attempted wakes、轮转、backlog 与 `exceededCpu`。

## 09. Aims Worker 的公网入口状态

- **目的/权限/门禁**：核对生产 `hzy-aims` 和预发 `hzy-test-aims` 的现役 route、custom domain、`workers_dev` 状态，确认第六件制品的私有入口前提；Cloudflare 只读；G1、G5。代码内的 scheduler-only 配置不能代替云端现状。
- **只读操作**：Cloudflare Workers & Pages 分别打开两 Worker 的现役 Deployment → Triggers/Routes/Custom Domains/Workers.dev/Preview URLs，逐项截图；核对 Gateway 活跃版本的 `HZY_AIMS_SERVICE` Service Binding 目标名称。可用 `wrangler deployments list --name hzy-aims` 和 `--name hzy-test-aims` 对照部署 ID，但 route 与 workers.dev 以控制台现役配置或同等只读 API 回读为准。**获批部署前和部署后都执行同一回读**；不要在本清单中 deploy、改 route 或打开 Gateway 公网阻断开关。
- **预期/证据**：私有调度目标无公网 route/custom domain，`workers_dev=false` 且 Preview URLs 关闭，生产 Gateway Binding 指向 `hzy-aims`、预发指向 `hzy-test-aims`；不符则先查实际流量和依赖。`route/routes` 从新配置省略不会自动删除 Dashboard 已绑的旧 route；部署后若仍存在，删除属于 [上线计划 §7](Go-Live-20261008-Plan.md) 的独立生产写入批准，删除后再回读。保存 `09-aims-ingress-prod-before/after.png`、`09-aims-ingress-staging-before/after.png`、`09-gateway-aims-binding.png`。现有独立 Aims Worker 的历史配置可能不同，不得用新文件替代其现场回读。

## 10. Aims 近 30 天真实请求来源

- **目的/权限/门禁**：在考虑关闭 Gateway 的公网 `/aims` 代理前找出任何非内部调用方；Cloudflare Analytics/Logpush **只读**；G1、G5。
- **只读操作**：在 `hzy-aims` 及 Gateway 的现有请求分析中取截至查询时刻的连续 30 天，按 UTC 日、`host`、规范化路径组（`/aims/` 页面、`/aims/api/v1/**`、`/aims/api/internal/integration-operations/drain`、其他）、method、来源类型（Service Binding/公网）、状态码聚合 `request_count`；仅保存计数，不导出 URL 查询串、Cookie、Authorization 或请求体。对 Gateway `/aims` 另按人机访问与内部 scheduler wake 分组；若分析系统不能可靠区分内部/外部，记录“证据不足”。
- **预期/证据**：在启用公网阻断前，非内部请求必须为 0，或逐类确认迁移与调用方；**任何非内部流量先上报，不启用开关**。保存 `10-aims-30d-request-counts.txt`（含时间窗与数据源）、`10-aims-traffic-review.md`。本清单不授权更改 Gateway。

## 11. 生产 `aims.runtime` 身份与凭据元数据

- **目的/权限/门禁**：确认 wiztek 生产 Console 中是否已有 Aims 调度服务身份及当前凭据；生产 Console 库只读；G2、G5。只读存在性不等于授权可签发。
- **只读 SQL**：

```sql
SELECT sc.id AS service_client_id,sc.client_code,sc.app_code,sc.status AS client_status,
       sc.current_credential_id,c.id AS credential_id,c.version_no,
       c.status AS credential_status,c.issued_at,c.expires_at,
       s.id AS secret_id,s.secret_code,s.storage_backend,s.status AS secret_status,
       (s.kms_key_ref IS NOT NULL) AS has_kms_key_ref
  FROM service_clients sc
  LEFT JOIN service_client_credentials c
    ON c.id=sc.current_credential_id AND c.service_client_id=sc.id
  LEFT JOIN vault_secrets s ON s.id=c.secret_id
 WHERE sc.client_code='aims.runtime'
 ORDER BY sc.id;
```

- **预期/证据**：确认客户端是否存在、`app_code='aims'`、状态、当前凭据及 Vault 引用是否完整；缺失只记缺口。保存 `11-aims-client-metadata.txt`，不查询 `client_id`、密文、`backend_secret_ref`、token 或 `scope_json` 原文。**创建身份/凭据以及写入 v2.31 等价的 3 个精确 scope × 2 个 audience 的生产 grant，都是生产写入，列入 [上线计划 §7](Go-Live-20261008-Plan.md) 的待批准动作；本清单不执行。**

## 11a. Workflow 在应用目录中的登记（G5）

- 目的：实例级、并行任务与状态类通知的 action 在 Workflow 无可信目标时会回退到 Host `/enterprise/approvals` 列表（10/8 安全回退）；需确认生产现状以评估回退是否会触发。
- 权限：生产 Console 只读（应用目录 / verified policy 元数据）。
- 只读核对：wiztek 应用目录中 `workflow` 是否 `deployed`、是否有可信 `homeUrl`；`/workflow/instances/*` 是否可达（只做无凭据 GET 记状态码）；`enterprise` Host 是否 `deployed` 且 homeUrl 可信。
- 预期：Host deployed 且可信；若 workflow 未部署或无可信 homeUrl，记录“通知将走 Host 列表回退”，不作为 No-Go，但须在 72 小时观察中统计 `workflow_action_target_host_list_fallback`。

## 11b. Workflow 通知详情 verifier 链路与 workflow.read 持有者（G5）

- 目的：Console 通知详情需调用 Workflow verifier，再由 Workflow 以 `workflow.read` 调 Runtime `POST /v1/workflow/notification-details/authorize`（Runtime 仅接受 `workflow.runtime` 固定身份）。
- 权限：Console 只读、Cloudflare 只读。
- 只读核对：托管云 `resolveServiceAppBaseUrl` 解析出的 Workflow 服务地址（`https://workflow.<managed suffix>`，经 Gateway→`hzy-workflow`）可达且受信；Workflow 已注册 `/api/v1/service/notification-details/authorize`；生产 `service_client_grants` 中除 `workflow.runtime` 外是否有 client 持有 `data-runtime`/`tenant-runtime` 的 `workflow` read（或 semanticScope `workflow.read`）——有则列出并评估，修复后这些调用方访问该路由将被 403。
- 预期：地址可达、路由存在、`workflow.read` 仅 `workflow.runtime` 持有。预发 W3/W4 真实点开一次通知详情。

## 11c. 生产库默认排序规则与 LDAP/AD 目录同步（非 10/8 阻断，需核对）

- 目的：MySQL 8 新建库默认 `utf8mb4_0900_ai_ci`，而 Console/目录表列为 `utf8mb4_unicode_ci`；未显式指定排序规则的临时表与业务表比较会 Illegal mix（本机 v2.28 helper 与 LDAP 全量同步临时表均已按此修复）。
- 只读核对：`SELECT schema_name, default_collation_name FROM information_schema.schemata`（Console、Aims 统一库、Workflow 等）；Console 集成配置中是否启用 LDAP/AD `directory-connector`（仅元数据，不读凭据）。
- 预期：若生产启用 LDAP 全量同步，发布制品须包含 LDAP 临时表排序规则修复；未启用则记录为非阻断。

## 12. 签收规则

每项记录“通过 / 不通过 / 证据不足”、执行时间、操作者、生产环境标识、证据文件。B3 任一命中、B4 旧 scope 非零请求、Workflow 旧 broad scope 有未知调用方、迁移 verify 失败或 GitLab 出站缺实际 Worker 证据，均不能标记对应门禁通过。只读核对**不替代** [预发联合验收](Go-Live-Staging-Acceptance-Script.md) 的登录、签发、故障注入、两租户隔离、备份恢复等操作证据；生产读数与预发结论分开归档。
