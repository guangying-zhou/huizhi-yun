# C000001 试点 Aims/Assets 消费者与退役清单

本清单对应实施计划 INT-208。它只记录源码可核验的消费者、替代路径和退役门槛；不表示任何旧路径已经可以删除，也不读取环境配置、凭据或业务导出。目标租户仍保持旧 Aims/Assets 路径和统一库开关关闭。

## 清单

| 旧对象/消费者 | 当前源码消费者 | 替代路径（当前状态） | 退役条件 | 观察指标 |
| --- | --- | --- | --- | --- |
| Aims 产品/规划表及旧产品投影（代表项：`product_workspaces`、`product_requests`、`product_planning_cycles`、`product_planning_items`、`product_catalog_projection`；非穷尽） | Runtime 兼容适配器与产品中心读取：`data-runtime/internal/apps/aims/adapter.go`、`data-runtime/internal/apps/aims/productcenter/`；表定义与投影迁移：`aims/docs/migration_v5.19_product_center.sql`；旧 Aims BFF 页面/API：`aims/server/api/v1/products/`、`aims/app/pages/products/` | Enterprise Host 的 `/aims/**` BFF 与 Runtime enterprise product/workspace/planning 服务：`enterprise/server/routes/aims/`、`enterprise/server/utils/enterpriseProductAuthorization.ts`、`data-runtime/internal/server/enterprise_catalog.go`、`enterprise_workspace.go`、`enterprise_planning.go`。当前仅完成代码/隔离验证，未成为统一库权威路径 | 最终 fenced copy 后完成同权限主体的 count/key/历史/revision 对账；Enterprise 读写和旧 URL 业务验收通过；旧消费者访问量归零并完成观察窗口 | 旧/新 API 请求数、返回 4xx/5xx、产品/需求/版本 revision、迁移对账差异、越权拒绝数 |
| Assets 产品主档、分类与产品关联（代表项：`product_assets`、`asset_category_groups`、`asset_category_items`；非穷尽） | Assets Runtime：`data-runtime/internal/apps/assets/adapter.go`、`data-runtime/internal/apps/assets/product_master_commands.go`、`product_link_reads.go`；表定义：`assets/docs/assets_schema.sql`；Assets BFF：`assets/server/api/`、`assets/server/utils/serviceProducts.ts`、`assets/server/utils/productAdoptionService.ts`；Aims 目录调用：`aims/server/utils/productCatalog.ts` | Enterprise Host Assets routes：`enterprise/server/routes/assets/`、`enterprise/server/utils/enterpriseAssetsProducts.ts`；统一 Runtime 产品/关联服务：`data-runtime/internal/server/enterprise_assets_products.go`、`enterprise_assets_links.go`。Assets receipt CHECK 已有独立迁移，但正式目标尚未安装 | 产品/分类/关联表完整映射及 receipt/outbox 对账；owned receipt 与 product-link schema 在目标实际验证；新旧入口写入幂等、权限和回退演练完成；旧 BFF/目录消费者归零 | 产品主档及分类读写计数、link receipt 状态、旧/新水位、CHECK/schema marker、跨租户/越权拒绝 |
| Aims integration operation/outbox（`integration_operation`、`integration_operation_attempt`、`integration_operation_dead_letter_actionable`、`service_command_receipt`） | 产生方：`data-runtime/internal/apps/aims/productcenter/feedback_*.go`、产品规划/交接命令；旧 drain 与管理 API：`aims/server/utils/integrationOperationDrain.ts`、`aims/server/api/v1/service/`、`data-runtime/internal/apps/aims/integration_operation_runtime.go` | 统一调度入口已实现：`POST /v1/enterprise/aims/integration-operations:claim|succeed|fail`，服务与适配器在 `data-runtime/internal/enterprisescheduler/`、`aims/server/utils/unifiedIntegrationOperationRoute.ts`。通知/死信六操作的隔离 MySQL/HTTP 验证已有收据；仍未完成唯一 worker 所有权切换、真实外部投递和响应丢失恢复 | 明确唯一领取者及 generation/fence；旧租约和 pending/in-flight 完成或转移；统一 claim/ACK、重放、响应丢失和 Altoc 投递证据通过；旧 drain 不再被调度 | pending/claimed/dead-letter 数、租约过期、generation 冲突、receipt 成功/失败、重复/冲突幂等、旧/新 worker 领取者 |
| Assets integration operation/status outbox | Assets status 产生方：`data-runtime/internal/apps/assets/delivery_asset_status_operation.go`；旧任务配置：`assets/nuxt.config.ts`；管理读取/重放：`data-runtime/internal/apps/assets/integration_operation_admin.go`、`assets/server/api/` | Enterprise Assets service routes 与 Runtime `enterprise_assets_*` 服务已具备候选实现；统一 scheduler 适配仍需真实任务所有权和外部投递验收 | owned product/link receipt 迁移后的 outbox 对账完成；Assets status 操作的 claim/ACK/replay 和撤销授权在隔离 MySQL/HTTP 通过；旧任务无重复消费 | status operation pending/failed/ack 数、delivery generation、receipt hash、重放冲突、任务执行 owner |
| Aims 定时任务 | `aims/nuxt.config.ts:155-158` 注册：每 5 分钟 `integration-operations:drain`，每 15 分钟 `notifications:due`，每日 `milestones:rollover`；实际实现分布在 `aims/server/tasks/`、`aims/server/utils/scheduledRuntime.ts` | Enterprise/Runtime scheduler 合同：`docs/Unified-Enterprise-External-Feedback-Boundary.md`、`data-runtime/internal/enterprisescheduler/`；测试配置明确不启用业务 cron | 每个 `(tenant, environment, logicalModule, task)` 只有一个登记 owner；旧任务停止前完成 drain/租约转移；至少覆盖一次完整任务周期并证明无重复/丢失 | task owner、generation、wake 次数、claim 数、lease/retry、旧/新执行重叠窗口 |
| Assets 定时任务 | `assets/nuxt.config.ts:162-163` 注册：每 15 分钟 `notifications:due`、`integration-operations:delivery-asset-status`；实现位于 `assets/server/tasks/` 与对应 Runtime handlers | Enterprise Host/Runtime 仅保留候选 service route；当前 Cloudflare 测试配置不启用业务 cron | 与 Aims 任务相同：唯一 owner、代际 fencing、旧租约排空、外部投递和恢复证据齐备后才能退役 | notification/status operation 数、租约/generation、失败重试、外部投递回执、重复消费 |
| Aims/Assets 用户 API 与服务 grant | Aims 页面与 API：`aims/server/api/v1/`、`aims/app.manifest.json`；Assets 页面与 API：`assets/server/api/v1/`、`assets/app.manifest.json`。Manifest 定义资源、动作和服务能力；Console active service grant 授权具体调用方。`console/docs/sql/Console-SQL-Seed-v1.15-aims-assets-version-grants.sql` 等 SQL 仅用于初始化/验证，不是第二套运行时事实源 | Enterprise manifest 生成：`enterprise/scripts/generate-manifest.mjs`；Host BFF 通过 Foundation helper 调 Runtime，路径实现见 `enterprise/server/routes/`、`foundation/server/utils/enterpriseRuntimeClient.ts` | 组合 manifest、logical module namespace、Host deployment binding 和精确 grant 在目标实际签发/验签；旧 API 的调用/错误/权限语义由新路径覆盖并观察确认；不得以静态 grant 行存在代替实际链路 | 按 endpoint/capability 的签发与调用数、401/403/503、manifest/path registry hash、错误语义、旧 URL 流量 |
| Aims/Assets Cloudflare 与本地配置 | `deploy/test-env/cloudflare-config.mjs`、`deploy/cloudflare/tenant-gateway/src/index.js`、`aims/scripts/render-cloudflare-config.mjs`、`assets/scripts/render-cloudflare-config.mjs`；测试配置当前业务 cron 关闭 | `deploy/test-env/enterprise-preflight.mjs`、`enterprise-pilot-config.mjs`、`build-enterprise-pilot.mjs` 生成候选 Host/配置；仅 dry-run/候选，未部署 | 新旧 binding、origin、OIDC callback、Runtime/schema/path registry、任务 owner 和版本 hash 一致；旧配置消费者归零并有可回退快照；未获授权不得清理变量或 binding | Worker version/route、binding 命中与 503、配置 hash、cron/triggers、Host/Runtime 版本关联、回退可用性 |

## 环境实例证据（2026-09-15 同一观测窗口）

执行顺序第 1 步要求的非敏感环境证据已由 INT-001 的同一观测窗口取得（14:12:51Z–14:13:01Z，[回执](../deploy/test-env/artifacts/C000001.int-001-observation-window.json)），仅覆盖共享测试租户 `C000001 / test`：

| 消费者类别 | 本次运行回读 | 对退役条件的影响 |
| --- | --- | --- |
| Aims / Assets 定时任务 | `hzy-test-aims`、`hzy-test-assets` 均无 cron trigger；`hzy-test-drain-coordinator` 也无 cron；全环境唯一 cron 是 Gateway 的 `0 16 * * *`，且该值等于测试包装器的 `TEST_POLICY_SYNC_CRON`，只执行 policy sync | 旧应用 Worker 在本环境已无定时消费者，但统一侧也没有定时 drain：drain 仅在请求驱动路径执行。当前是「零定时 owner」，不能据此宣称调度所有权已切换，仍需按 INT-305 注册第二条 cron 并演练租约转移 |
| Aims / Assets 用户 API 与服务 grant | `enterprise.runtime` 服务客户端 active，38 条 grant 全部 active；Enterprise OIDC client active | Enterprise 替代路径的授权侧已具备；旧应用 grant 未回读，退役前需逐个确认无流量 |
| Worker / Host 实例 | Gateway `0866464e`、Enterprise `bcf7157b`、Console `29be09c1`、Aims `b4b4763b`、Assets `7f090cc0` 均 100% 流量；Data Runtime `0.3.219-test.adr018-candidate.7`，六个 adapter `db=ok` | 新旧路径当前并存运行，符合「本阶段不删除任何旧对象」的前提 |

生产与其他租户没有同一时点回读，仍为待环境核验；不得据测试回读推断生产消费者状态。

## 执行顺序

1. 先从上述源码路径生成静态消费者清单，并补充每个真实环境实例的非敏感版本/owner 证据；不把代码中存在的 route 或 grant 当作已部署消费者。
2. 在独立影子库完成表、历史、receipt、outbox 和权限主体对账；正式目标仍使用新的 review hash，不复用旧 147 表演练证据覆盖当前 150 表计划。
3. 对 Aims/Assets 任务分别完成单消费者、generation fencing、租约转移和响应丢失恢复演练，再评估旧任务退役。任何一个消费者仍有流量时，不删除旧表、projection、grant 或配置。

当前明确未完成：统一库正式 fenced copy、Enterprise 业务路由启用、Aims/Assets 真实 Host 页面链、调度所有权切换、外部投递联合验收。上述缺口不因全量 Go race、隔离 MySQL 或 dry-run 构建通过而改变。
