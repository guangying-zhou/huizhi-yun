# Goal 2 交付环境身份闭环验证记录

日期：2026-06-25

## 数据库迁移执行

执行目标库：

- Assets：`hzy_assets`
- Aims：`hzy_aims`
- Altoc：`hzy_altoc`

迁移前已用 `mysqldump --single-transaction --no-tablespaces` 备份受影响源表，备份文件位于本地：

- `.codex-goal2-db-backups/20260625-182304-hzy_assets-goal2-source.sql.gz`
- `.codex-goal2-db-backups/20260625-182304-hzy_aims-goal2-source.sql.gz`
- `.codex-goal2-db-backups/20260625-182304-hzy_altoc-goal2-source.sql.gz`

已执行迁移：

- `assets/docs/assets_delivery_environment_identity_20260625.sql`
- `aims/docs/migration_v4.5_project_environments.sql`
- `altoc/docs/migrations/035_service_agreement_coverage_identity.sql`

执行过程中修正了两处迁移兼容问题：

- Assets 迁移 helper 参数名与 `information_schema.COLUMNS` 列名冲突，导致新增列被误判为已存在；已改为 `p_table_name` / `p_column_name`。
- Aims `project_environments` 原生成列唯一键与 `project_id` 外键组合在当前 MySQL 上触发 1215；已改为普通 `active_relation_key` 字段，由 data-runtime 写入和软删除时维护。

## 回填核对结果

Assets：

| 指标 | 结果 |
| --- | ---: |
| legacy_environment_snapshot_count | 0 |
| relation_count | 0 |
| legacy_snapshot_missing_relation_count | 0 |
| multiple_primary_delivery_asset_count | 0 |
| cross_customer_relation_count | 0 |
| orphan_environment_relation_count | 0 |
| active_primary_relation_count | 0 |

Aims：

| 指标 | 结果 |
| --- | ---: |
| project_environment_count | 0 |
| distinct_environment_count | 0 |
| missing_environment_code_count | 0 |
| duplicate_active_relation_count | 0 |
| failed_assets_sync_count | 0 |

Altoc：

| 指标 | 结果 |
| --- | ---: |
| legacy_coverage_total | 0 |
| resolved_delivery_asset_count | 0 |
| resolved_environment_count | 0 |
| resolved_pair_count | 0 |
| pending_plan_count | 0 |
| needs_review_count | 0 |
| active_unresolved_count | 0 |
| formal_target_plan_code_conflict_count | 0 |
| source_plan_customer_conflict_count | 0 |
| duplicate_effective_coverage_count | 0 |
| unmatched_legacy_count | 0 |
| orphan_service_agreement_count | 0 |

## Runtime Schema Status

临时启动 `data-runtime` 后调用 `/runtime/schema/status`，结果：

| App | Database | Status | Missing tables |
| --- | --- | --- | --- |
| assets | `hzy_assets` | `ok` | 0 |
| aims | `hzy_aims` | `ok` | 0 |
| altoc | `hzy_altoc` | `ok` | 0 |

## 验证命令

全部通过：

```bash
pnpm --dir assets lint
pnpm --dir assets typecheck
pnpm --dir assets test
pnpm --dir aims lint
pnpm --dir aims typecheck
pnpm --dir aims test
pnpm --dir altoc lint
pnpm --dir altoc typecheck
pnpm --dir altoc test
pnpm --dir altoc audit:runtime-boundary
pnpm --dir foundation lint
pnpm --dir foundation typecheck
pnpm --dir foundation test
cd data-runtime && go test ./... -count=1
git diff --check
git -C assets diff --check
git -C aims diff --check
git -C altoc diff --check
git -C data-runtime diff --check
```

测试计数：

- Assets：9/9
- Aims：11/11
- Altoc：33/33
- Foundation：23/23

## 2026-06-25 追加核验

继续审计时发现 Assets `references:resolve` 的交付资产 + 环境 pair 查询存在多余占位符，真实数据库执行会导致 pair 校验参数不匹配。已修正为仅使用批量 pair 条件，并补强测试断言查询形态。

同时补充 Altoc `service_agreement_coverage` 读取策略测试：

- 新 coverage 表存在正式覆盖时，读取来源为 `coverage`，不回退旧 `service_agreement_asset`。
- 新 coverage 表为空时，旧 `service_agreement_asset` 仅作为 `legacy / needs_review` 回退返回。

追加执行并通过：

```bash
cd data-runtime && go test ./internal/apps/assets -run 'TestResolveServiceReferencesUsesBatchQueries|TestBindCustomerDeliveryAssetEnvironmentTx' -count=1
cd data-runtime && go test ./internal/apps/altoc -run 'TestListServiceAgreementCoverages|TestSyncServiceAgreementCoverageFromAssetResolvesPendingPlanToFormalPair' -count=1
cd data-runtime && go test ./... -count=1
pnpm --dir assets lint
pnpm --dir assets typecheck
pnpm --dir assets test
pnpm --dir aims lint
pnpm --dir aims typecheck
pnpm --dir aims test
pnpm --dir altoc lint
pnpm --dir altoc typecheck
pnpm --dir altoc test
pnpm --dir altoc audit:runtime-boundary
git diff --check
```

## 2026-06-25 Altoc 覆盖唯一键刷新

继续审计时发现 `service_agreement_coverage.active_target_key` 的旧定义把 `source_plan_code` 纳入所有目标类型的唯一键。对正式 `delivery_asset` / `environment` / `delivery_asset_environment` 覆盖来说，`source_plan_code` 只是来源，不应让同一正式目标同一有效期出现重复覆盖；对 `legacy` 覆盖则应按 `legacy_reference` 区分。

已更新：

- `altoc/docs/migrations/035_service_agreement_coverage_identity.sql`
- `altoc/docs/altoc_schema.sql`

新的 `active_target_key` 规则：

- `pending_plan` 使用 `source_plan_code`。
- `legacy` 使用 `legacy_reference`。
- 正式覆盖目标不使用 `source_plan_code`，只按正式目标 code 和有效期去重。

已在 `hzy_altoc` 重放 035 迁移刷新生成列定义，输出文件：

- `.codex-goal2-db-backups/20260625-184027-altoc-035-coverage-key-refresh.tsv`

刷新后核对结果：

| 指标 | 结果 |
| --- | ---: |
| legacy_coverage_total | 0 |
| resolved_delivery_asset_count | 0 |
| resolved_environment_count | 0 |
| resolved_pair_count | 0 |
| pending_plan_count | 0 |
| needs_review_count | 0 |
| active_unresolved_count | 0 |
| formal_target_plan_code_conflict_count | 0 |
| source_plan_customer_conflict_count | 0 |
| duplicate_effective_coverage_count | 0 |
| unmatched_legacy_count | 0 |
| orphan_service_agreement_count | 0 |

`information_schema.COLUMNS.GENERATION_EXPRESSION` 已确认包含 `legacy_reference` 分支。

追加执行并通过：

```bash
pnpm --dir altoc test
cd data-runtime && go test ./internal/apps/altoc -count=1
git diff --check
```

## 2026-06-25 输入校验与重复目标回归加固

继续收口时补强三类边界：

- Altoc `service_agreement_coverage` 正式目标重复检查增加测试，确认 `delivery_asset` / `environment` / `delivery_asset_environment` 的重复判断不受 `source_plan_code` 影响，避免同一正式目标同一有效期因来源计划不同而重复生效。
- Aims `project_environments` 显式传入非法 `deliveryStatus` / `assetsSyncStatus` 时改为 400 失败；未传字段仍保留默认 `planned` / `pending`。
- Aims BFF 在调用 Assets 创建正式环境前校验项目环境 `deliveryStatus`，避免状态拼写错误先创建正式 `environment_code` 后再被 Aims runtime 拒绝。
- Assets 交付资产-环境绑定对显式传入的 `relationType`、`deploymentStatus`、`status` 做严格校验；未传字段仍保留默认 `primary` / `planned` / `active`。

追加执行并通过：

```bash
cd data-runtime && go test ./internal/apps/assets ./internal/apps/aims ./internal/apps/altoc -count=1
pnpm --dir aims test
pnpm --dir aims typecheck
```

## 2026-06-26 Goal 2.1 审查修复

根据 Goal 2 审查结果，本轮补强：

- Altoc `customer_delivery_asset.status:sync` 在校验正式 Assets 对象前，先从 Altoc 计划 / 合同 / 服务协议上下文加载期望 `customer_code`，再传入 `references:resolve` 结果校验；跨客户正式交付资产或环境返回 409，且不会写入覆盖关系。
- data-runtime 的状态同步事务增加二次保护：当 payload 或 Assets 回调体携带 `customer_code` 且与 Altoc 计划客户不一致时，返回 `delivery_asset_customer_conflict`。
- Aims `project_environments.relation_type` 和 Assets `asset_environments.environment_type` 改为“未传使用默认，显式非法值 400 失败”，避免拼写错误静默变成默认正式关系。
- Altoc 旧 `service_agreement_asset` 回退响应统一为 `target_type = legacy`。
- Assets 文档明确 `asset_environments.status` 不单独保留 `accepted`；`accepted` 输入归一为 `active`，验收完成以 `accepted_at` 或部署关系 `deployment_status = accepted` 判断。

本轮新增 / 更新测试：

- Altoc status:sync 跨客户正式 pair 校验。
- Altoc status:sync expected customer context runtime 查询。
- Altoc status:sync payload customer 二次校验。
- Aims 无效 `relationType` runtime / BFF helper 校验。
- Assets 无效 `environmentType` runtime 校验。
- Altoc legacy fallback `target_type = legacy` 断言。

本轮重新执行受影响模块验证，全部通过：

```bash
pnpm --dir assets lint
pnpm --dir assets typecheck
pnpm --dir assets test
pnpm --dir aims lint
pnpm --dir aims typecheck
pnpm --dir aims test
pnpm --dir altoc lint
pnpm --dir altoc typecheck
pnpm --dir altoc test
pnpm --dir altoc audit:runtime-boundary
cd data-runtime && go test ./... -count=1
git diff --check
```
