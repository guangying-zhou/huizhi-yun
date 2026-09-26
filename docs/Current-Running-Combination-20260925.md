# 当前运行组合（2026-09-25）

本页是本机 hzy0 与开发 Platform 的**当前状态入口**。它区分已运行制品、仓库候选和未启用代码；下方历史计划、阶段回执和早期 `NEXT.md` 文字只代表当时状态。版本与开关以本日只读核对和链接回执为准，后续切换须更新本页。

| 组件 | 当前运行状态 | 来源与边界 |
| --- | --- | --- |
| 开发 Platform `hzy-platform-dev` | C4 候选已切换，health 200；最近实测 C000001 修订 27，C000001 目录 11 应用，C000002 修订/目录未变 | 干净提交 `bedb072e` 构建；C4 热路径测量不能外推为全部请求的延迟保证。开发 Platform 与生产分离；本页不授权再次发布。 |
| 本机 Data Runtime | `0.3.236-test.round3-aims-iop.1`（`344d23ff`），`/runtime/health` 只读探测 `ok` | C000001 本机测试运行时。Codocs snapshot v2 开启，collaboration v2 关闭；第二批 N3/N4 所需的 `expiresAt` 响应字段尚未部署。 |
| hzy0 Dev Host/Gateway/Console/Codocs 编辑器/Aims/Workflow | 六个本机 PM2 进程均 online，开发态从工作区运行。Host 在第一批 `6a1c6f62` 后单独重启；其他进程未因该批重启 | 私有 profile：Codocs snapshot v2、仅站内通知、本机 Workflow 均开启；实时 Collab 未开启。Gateway、Console、Aims/Workflow 按本机受信接线，不据此推断云端状态。 |
| 仓库代码 | 第一批 N1/N2/F1/F2/F3 已提交 `6a1c6f62`；第二批 N3/N4 已提交 `a8093f5c` | 已提交代码不等于 Runtime/Platform 已运行；Collab 第二批只有离线测试，未启用。 |

## 已应用的 schema、grant 与 release

- **仅本机 C000001**：统一 Aims 库已安装 V2 `matter/target` workflow 状态与转换（新增 9 状态、13 规则，原 22/28 行与外键不变），见 [迁移计划与工具](./Unified-Enterprise-Aims-Workflow-V2-Migration-Plan.md)。Assets 物理 receipt 表已按 [最终 allowlist 迁移](./Unified-Enterprise-Assets-Receipt-Migration-Plan.md)扩为 11 项，原 6 条 receipt 不变。本机 Workflow 使用**独立新库**及单审批人测试路由，不修改共享 Console 的 `workflow.apiUrl`；仅 hzy0 的 loopback 覆盖指向它。这些均非云端/生产迁移。
- **本轮 Console grant（仅本机 C000001）**：v2.13 [Aims scheduler 原始 scope seed](../console/docs/sql/Console-SQL-Seed-v2.13-aims-unified-scheduler-raw-grant.sql)/[verify](../console/docs/sql/Console-SQL-Verify-v2.13-aims-unified-scheduler-raw-grant.sql)；v2.14 [plan-ready seed](../console/docs/sql/Console-SQL-Seed-v2.14-enterprise-work-item-plan-ready-grant.sql)/[verify](../console/docs/sql/Console-SQL-Verify-v2.14-enterprise-work-item-plan-ready-grant.sql)；v2.15 [版本范围交付 seed](../console/docs/sql/Console-SQL-Seed-v2.15-enterprise-version-scope-delivery-grants.sql)/[verify](../console/docs/sql/Console-SQL-Verify-v2.15-enterprise-version-scope-delivery-grants.sql)；v2.16 [六行绑定修复](../console/docs/sql/Console-SQL-Repair-v2.16-round3-a2-b2-grant-bindings.sql)；v2.17 [completion callback seed](../console/docs/sql/Console-SQL-Seed-v2.17-a2-work-item-completion-callback-grant.sql)/[verify](../console/docs/sql/Console-SQL-Verify-v2.17-a2-work-item-completion-callback-grant.sql)。另有 v2.13 [IP 关联产品 seed](../console/docs/sql/Console-SQL-Seed-v2.13-enterprise-ip-asset-product-link-grant.sql)/[verify](../console/docs/sql/Console-SQL-Verify-v2.13-enterprise-ip-asset-product-link-grant.sql)。均按各自备份、精确差集与签发回执执行；这些 SQL 文件不是其它租户的直接 apply 授权。
- **开发 Platform 正式 release**：Enterprise 35（FE-2 manifest）→36（项目关联）→37（plan-ready）；Workflow 38（`workflow/v0.5.1-test.round3.1`）。C000001 最近记录策略修订 **27**，C000002 未跟随同步；release 发布与策略修订是两步，不把 release 号当作当前租户策略号。

## 已验证的业务行为

- Codocs 私人文档 snapshot v2 双标签快检：`test` 的既有测试文档中，标签 A 保存成功；标签 B 以旧读取版本保存得到 **409**，页面显示未保存且本地草稿仍在。本机 snapshot v2 已启用，但实时 Collab 仍关闭。
- Aims/Workflow 本机测试链：标记目标 309 的 completion 经本机 Workflow、`test` 待办审批、正式 callback drain，已成为 `completed`；Workflow actionable outbox id1 仍待创建顺序/墓碑设计，未人工重投。
- FE-2 与 D2/D5 的历史验收、环境变更和清理项分别以各自回执为准；“合同已验证”不自动表示“浏览器已验收”。

## 已知风险

- **生产快照桶与精确版本 ID**：测试桶曾验证版本控制和按 `oss_version_id` 精确读取；`codocs/` 非当前版本 30 天清理。生产或共享桶的绑定、生命周期、精确 provider version 响应与删除路径须另行核验；被 head/候选引用的 v2 写一次对象不得覆盖或删除。详见[写入协调合同](./Codocs-Document-Write-Coordination.md)。
- **授权旧数据**：`seed:product-center-20260907` 来源另有 **216 条**缺 `semanticScope` 的旧 grant，另 **5 条**旧 grant 的 tenant/deployment 绑定为空；目前只修了本次精确目标，跨环境清理须单独计划和审查。
- **Workflow actionable**：审批完成后生命周期关闭可能先于站内通知投影创建；现有 `404 actionable_not_found` 保持失败并重试，outbox id1 仍 pending。需要创建先于关闭的依赖，或经审查的墓碑方案。
- **hzy0 本机覆盖**：私有 profile/runner 才能设置 `HZY0_WORKFLOW_LOCAL_ONLY`、`HZY_LOCAL_WORKFLOW_DEPLOYMENT`、`HZY_CONSOLE_LOCAL_WORKFLOW_DEPLOYMENT`、`HZY0_NOTIFICATIONS_IN_APP_ONLY`、`HZY0_LOCAL_CONSOLE_FACADE`，以及 loopback 目标 `HZY_WORKFLOW_API_URL`、`HZY0_LOCAL_AIMS_URL`、`HZY0_CONSOLE_EGRESS_URL`；Codocs Host 另用 `HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2`。这些限定 C000001 的本机接线，不能复制到云端/生产配置。

## 当前待办与限制

1. 第二批 N3/N4 已提交，Collab 保持关闭；将来若启用须让 Runtime 新 `expiresAt` 合同与 Collab 同批部署并单独验收。
2. 本文档状态汇总经审查后，再执行本分支 Console 签发 CPU 整改；不碰 main、生产或云端。其后依次是 matter 完成设计、D4-2 第 3 阶段设计。
3. Workflow actionable 的创建先于生命周期关闭尚未解决；独立的审批/回调成功不代表该通知项完成。

详细历史：[统一企业应用实施台账](./Unified-Enterprise-Implementation-Plan.md)、[G1 收口跟踪](./Huizhi-Yun-Local-Enterprise-Test-Plan-v1.0-20260920/docs/G1-Closeout-Tracker.md)、[文档写入协调](./Codocs-Document-Write-Coordination.md)、[本机运行记录](../deploy/test-env/LOCAL_RUNTIME.md)。
