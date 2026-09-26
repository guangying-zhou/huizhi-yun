# W1-A 任务书：项目子页盘点与读取路径迁移（Codex）

派发：Claude，2026-09-23。计划：[统一企业迁移分波计划](./Unified-Enterprise-Migration-Waves-Plan-20260923.md) 第 1 波首批。不部署、不写环境、不改 grant。

## 背景

Host 已登记项目子页：timesheet、weekly-reports、members、documents、requirements、plan、board、work-items（`deploy/test-env/enterprise-host-routes.mjs`）。未登记：`aims/app/pages/projects/[id]/` 下 environments、metrics、risks、output、releases、settings、milestones/[milestoneId]、service-desk。项目导航里已出现部分入口，打开未登记页是 404。

## 范围

1. **盘点（全部 8 页）**：写 `docs/Unified-Enterprise-Project-Subpages-Inventory.md`，逐页列出：组件与 composable 依赖；每个 METHOD + API 路径；所需人员权限（`aims/app.manifest.json` 的 resource/action）；现有 Runtime 端点与是否已有 Enterprise 操作（`foundation/server/utils/enterpriseRuntimeClient.ts`）；可达写动作；建议批次（本批 / 后批 / 属 Altoc 链的 service-desk 归第 3 波）。
2. **本批实施**：
   - environments、metrics、risks：先确认是否为占位页；若是，按 Host 模式注册并保证空状态与导航一致，不虚构数据接口。
   - output（交付物）与 releases（发布）：只迁**读取**（列表、详情），写动作（提交、审核、发布等）只盘点不实施。
   - settings、milestones/[milestoneId]、service-desk：只盘点，不实施。
3. **遵循模板**：计划文档 §4 第 1～6 项。读取 BFF 在签发 Runtime 许可前必须经 Foundation `loadAuthorizationSnapshotFromConsoleRuntime` + `authorizationResourcesAllow` 检查对应资源 `view` 权限（参照 `enterprise/server/utils/enterpriseAimsProjects.ts`、`enterpriseAimsWeeklyReports.ts`），缺权 403 且不调用 Runtime，依赖故障 503。
4. **需要新 Runtime 操作或 capability 时**：先在盘点文档写出提议（path、capability、Runtime 校验、manifest 变更），在回执中标注“待 Claude 复核”，不要自行新增 grant seed 或修改 Runtime 授权代码。

## 不做

- 不改 `data-runtime/internal/server/enterprise_context.go`、Foundation 身份/授权核心、Console/Platform 代码、任何 grant/SQL seed。
- 不改 Codex 之外正在进行的文件；共享文件（Host 入口、manifest 生成器）改动在回执中逐项列出。
- 不做浏览器视觉验收（由 Claude/用户会话执行），但要保证 `pnpm --dir enterprise typecheck`、相关测试与 readiness 生成无漂移。

## 交付与回执

- 测试：`node --test enterprise/test/*.test.mjs` 全过（当前 186 项）；新增页面桥接测试覆盖 actor 绑定、缺权 403 不调用 Runtime、依赖 503、输入校验。
- 回执写在本文件末尾“回执”节：改动文件、命令与结果、盘点结论、待复核项、未完成项；并给出交 MiMo 的文件清单。
- 完成后在 Orca 终端回复“W1-A 完成”。

## 回执

W1-A 实施回执（Codex，2026-09-23）：

- 八页盘点见 [项目子页盘点](./Unified-Enterprise-Project-Subpages-Inventory.md)。`metrics`、`risks` 为纯占位；`environments` 实际挂载可写 `ProjectEnvironmentPanel`，故按“若是占位页”条件未注册，留后批。`settings`、`milestones/[milestoneId]` 仅盘点；`service-desk` 归第 3 波 Altoc 链。
- Host 已登记 `/aims/projects/:id/metrics`、`risks`、`output`、`output/:deliverableId`、`releases`、`releases/:releaseId`。metrics/risks 保持“即将上线”空状态；output/release 使用独立只读 Host 页面，不暴露原页的提交、审核、关联或发布入口；releases 遵循项目模块开关。交付物详情来自带 `project_id + deliverable_id` 的现有 Runtime 列表；版本详情当前是版本列表的单项摘要，完整特性/工作项/日志所需新 Runtime 操作列在盘点文档，**待 Claude 复核**。
- 新增两条详情 BFF：`GET /aims/api/v1/projects/:id/deliverables/:deliverableId` 与 `GET /aims/api/v1/projects/:id/releases/:releaseId`；复用既有 `aims.project-deliverable-list` / `aims.project-release-list`，无新 capability 或 grant。既有 `enterpriseAimsDeliverables.ts` 在许可签发前检查 Foundation 授权快照中的人员 `projects:view`，无权 403 不调 Runtime，授权依赖故障 503；签名 actor、tenant、deployment 与项目范围保持原链路。新增 BFF 校验 ID、拒绝额外 query，未找到返回 404。
- 测试与生成：`node --test enterprise/test/aims-project-subpages-w1a-bridge.test.mjs` 通过，覆盖 actor、403 无 Runtime 调用、授权与 Runtime 依赖 503、输入 400、不可见 404；`node --test enterprise/test/*.test.mjs` 为 188 项、187 通过、1 跳过、0 失败；`pnpm --dir enterprise typecheck` 通过；`pnpm --dir enterprise generate:api-readiness`、`pnpm --dir enterprise generate:navigation`、`node deploy/test-env/generate-enterprise-host-routes.mjs` 已运行，生成文件只含本批条目；`git diff --check` 通过。未做浏览器视觉验收、部署或环境写入。
- 待复核/未完成：项目版本完整详情和项目产品关联列表的新 Runtime 操作提议见盘点文档，须由 Claude 复核后补 Runtime、BFF、契约测试；本批版本详情只展示摘要。环境页因非占位未实施，后批需连同环境写权限与 Assets 同步合同处理。原 output 的仓库、文档预览、质量流程未迁；写动作均未实施。

交 MiMo 的**仅本批文件清单**：

1. `docs/Unified-Enterprise-Project-Subpages-Inventory.md`
2. `docs/Unified-Enterprise-Migration-W1A-Codex-Brief.md`（本回执；任务书主体原为 Claude 文件）
3. `aims/layer/entry.mjs`（共享 Host 入口与对象导航）
4. `aims/layer/pages/enterprise-project-metrics.vue`
5. `aims/layer/pages/enterprise-project-risks.vue`
6. `aims/layer/pages/enterprise-project-output.vue`
7. `aims/layer/pages/enterprise-project-output-detail.vue`
8. `aims/layer/pages/enterprise-project-releases.vue`
9. `aims/layer/pages/enterprise-project-release-detail.vue`
10. `enterprise/server/utils/enterpriseAimsDeliverables.ts`
11. `enterprise/server/routes/aims/api/v1/projects/[id]/deliverables/[deliverableId].get.ts`
12. `enterprise/server/routes/aims/api/v1/projects/[id]/releases/[releaseId].get.ts`
13. `enterprise/test/aims-project-subpages-w1a-bridge.test.mjs`
14. `enterprise/composition/business-api-routes.generated.mjs`（共享生成清单）
15. `enterprise/app/utils/enterprise-navigation.ts`（共享生成导航）
16. `deploy/test-env/enterprise-host-routes.mjs`（共享生成 Host 路由）

上述清单不含工作区其他未提交的 G1、C4、Platform、Gateway 或策略改动。

## Claude 复核（2026-09-23）

结论：**W1-A 服务端与注册通过**，页面需小修后收口（W1-A2）。

- 通过：两条详情 BFF 在签发许可前经 `deliverableCall` 检查 `projects:view`（403 不调 Runtime，依赖 503）；`deliverable_id` 在 Runtime 为 `d.id = ?` 精确过滤；版本列表 Runtime 无分页，按项目取全量后选单项正确；六页均无写入口；1440/390 真实浏览器（test，项目 33）交付物列表、详情、版本空状态、度量占位布局正常，无溢出与重叠。
- 需改（W1-A2）：
  1. 交付物列表与详情直接显示原始码（`pending`、`document`）。复用原页 `aims/app/pages/projects/[id]/output.vue` 的 `deliverableStatusConfig`、`qualityStatusConfig` 及类型文案，改为中文标签 + 语义色 `UBadge`；版本页状态同样处理。优先把映射抽到 `aims/app/utils/` 由原页与 Host 页共用，不复制两份。
  2. 发现 2：`aims/layer/pages/enterprise-project-detail.vue` 正文“查看项目工时/周报”按钮未按权限过滤。按与侧栏相同的导航可见性（`useEnterpriseNavigationAccess` 的 `aims.project.timesheet` / `aims.project.weekly-reports`）控制显示，不新增权限表。
  3. 交付物/版本列表无服务端分页：Runtime 与原页均为按项目全量，单项目规模有限，本批不改；在盘点文档记为后批（写动作批次）同时补 Runtime 分页与 `UPagination`。
- 版本完整详情的新 Runtime 操作提议：同意方向，归入后批，与写动作合同一起由 Claude 定 capability 与 grant；本批保持摘要。

## W1-A2 回执（Codex，2026-09-23）

- 将交付物提交状态、质量状态、类型及项目版本状态的中文标签和语义色集中到 `aims/app/utils/projectDeliverablePresentation.ts`。原 `output.vue`、原 `releases.vue` 与 Host 交付物列表/详情、版本列表/摘要共用映射；未知码显示中性中文标签，不在页面直接显示原始码。交付物列表同时展示类型、提交状态和质量状态徽标。
- 项目概览“查看项目工时/周报”按钮现在按 `useEnterpriseNavigationAccess().workspaces` 中 `aims.project.timesheet` / `aims.project.weekly-reports` 的可见 ID 独立显示，沿用布局的导航许可，不新增权限表。SFC 测试覆盖无入口、仅工时、仅周报三种状态。
- 分页只追加到 [项目子页盘点](./Unified-Enterprise-Project-Subpages-Inventory.md) 的“后批分页”节：与写动作批次一起补 Runtime 分页、BFF 参数校验及 `UPagination`。本批未改分页、Runtime、授权核心、grant、部署或环境。
- 验证：`node --test enterprise/test/*.test.mjs` 189 项，188 通过、1 跳过、0 失败；`pnpm --dir enterprise typecheck` 通过；`pnpm --dir aims test` 707/707 通过；`pnpm --dir aims typecheck` 通过；`git diff --check` 通过。未做新的浏览器视觉验收。

交 MiMo 的 **W1-A2 增量文件清单**（不含 W1-A 已列且本批未改的文件）：

1. `aims/app/utils/projectDeliverablePresentation.ts`
2. `aims/app/pages/projects/[id]/output.vue`
3. `aims/app/pages/projects/[id]/releases.vue`
4. `aims/layer/pages/enterprise-project-output.vue`
5. `aims/layer/pages/enterprise-project-output-detail.vue`
6. `aims/layer/pages/enterprise-project-releases.vue`
7. `aims/layer/pages/enterprise-project-release-detail.vue`
8. `aims/layer/pages/enterprise-project-detail.vue`
9. `aims/test/projectDeliverablePresentation.test.ts`
10. `enterprise/test/project-detail-sfc.test.mjs`
11. `docs/Unified-Enterprise-Project-Subpages-Inventory.md`
12. `docs/Unified-Enterprise-Migration-W1A-Codex-Brief.md`
