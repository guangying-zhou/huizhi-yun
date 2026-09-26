# W1-C 任务书：项目交付物与版本列表服务端分页（Codex）

派发：Claude，2026-09-23。来源：[项目子页盘点](./Unified-Enterprise-Project-Subpages-Inventory.md)“后批分页”。不部署、不写环境、不改 grant。

## 背景

W1-A 的 Host 页 `aims/layer/pages/enterprise-project-output.vue`、`enterprise-project-releases.vue` 按项目一次拉全量；Runtime `aims.project-deliverable-list`（`data-runtime/internal/apps/aims/deliverables.go`）与 `aims.project-release-list`（`product_versions.go` 的 `listProjectReleases`）也不分页。根 `CLAUDE.md` 列表规范要求服务端真实分页、`UPagination` + “共 N 条”。

## 范围

1. **Runtime（本任务明确授权修改以下两处）**：两个列表增加可选 `page` / `pageSize`（正整数，`pageSize` ≤ 100），带分页参数时返回 `{ items, total, page, pageSize }`，`total` 为同一过滤与可见性条件下的计数；**不带分页参数时行为与响应形状完全不变**（旧 Aims 页面与其他调用方依赖全量）。排序须稳定（补主键作最终排序键）。分页必须在项目可见性/范围过滤之后计算，不得先分页再过滤。
2. **BFF**：`enterprise/server/utils/enterpriseAimsDeliverables.ts` 的交付物列表与项目版本列表严格校验 `page`/`pageSize`（非法 400），其他 query 仍拒绝；详情 BFF（W1-A 新增的两条）继续按精确 ID 查询，不依赖列表当前页。
3. **Host 页面**：两页接 `UPagination`（`v-model:page` + `:items-per-page` + `:total`）与“共 N 条”，`page`/`pageSize` 进请求参数，刷新保持当前页；最后一页删空时回退一页的逻辑本批不涉及（无写动作）。
4. **测试**：Go 单测覆盖带/不带分页的形状、total 与可见性一致、越界页返回空 items 但 total 正确、非法参数；Enterprise 桥接测试覆盖参数校验与透传；Host SFC 或现有页面测试覆盖分页参数进入请求。

## 不做

- 不改 Runtime 路由登记、capability、grant、授权核心、`enterprise_context.go`；不改 Codocs 相关文件（Claude 在做 INT-606c）。
- 不改其他列表。顺手修正所改文件中的机械性 lint 错误。
- 不做浏览器视觉验收。

## 交付与回执

- `go test ./...`（data-runtime）、`node --test enterprise/test/*.test.mjs`、`pnpm --dir aims test`、两模块 typecheck、改动文件 eslint 全部通过。
- 回执写在本文件末尾“回执”节：改动文件、命令与结果、兼容性说明（不带分页时的调用方清单与未变证明）、交 MiMo 的文件清单。
- 完成后在 Orca 终端回复“W1-C 完成”。

## 回执

### Codex 回执（2026-09-23）

**实现**：交付物和项目版本 Runtime 列表增加可选 `page` / `pageSize`，请求携带任一参数时默认另一项为 `1` / `20`，只接受正整数且 `pageSize ≤ 100`；越界页返回空 `items`，`total` 保持过滤后总数。交付物计数与列表共用项目、状态、对象筛选及 `projectVisibilityWhere`，排序补 `d.id` 最终键；项目版本先经 `requireProjectReadable`，计数与列表共用项目关联 `EXISTS`、产品/状态过滤及同一联接，原排序已有 `pv.id` 最终键。现有 Enterprise 两个 `list` 委托动作仅放行新增 query 键，未改路径、capability、permit/授权核心或 grant。

BFF 对两条列表严格校验分页参数并原样透传，未知 query 仍拒绝；两条详情 BFF 继续以精确 ID 发无分页查询。Host 项目产出/版本两页传 `page`、`pageSize`，展示“共 N 条”和 `UPagination`，刷新保留当前页，切换项目重置为第 1 页。没有写动作或最后一页删除回退逻辑。

**无分页兼容性**：未传 `page`/`pageSize` 时 Runtime 不运行新增计数 SQL，交付物仍返回数组，项目版本仍只返回 `{items}`；现有 Go 单测以实际类型、map 键和 SQL 期望验证。未改参数的调用方包括 Aims 原 `projects/[id]/output.vue`、`plan.vue`、`work-items.vue`、`releases.vue`，`TargetEditModal` / `TargetInfoModal`，项目文档/交付物服务读取，以及 Enterprise 的交付物详情、版本摘要详情 BFF。Host 两个列表是新增分页参数的调用方。

**验证**：

- `cd data-runtime && go test ./...`：通过；新增 Go 单测覆盖旧/新形状、同筛选及可见性计数、越界页、无权项目先拒绝、非法值，以及现有 Enterprise 委托白名单透传。
- `node --test enterprise/test/*.test.mjs`：189 项，188 通过、1 跳过、0 失败；桥接测试增加分页透传、非法参数 400、详情保持无分页断言。
- `pnpm --dir aims test`：708 项全过；新增 Host SFC 契约测试检查请求参数、总数和分页控件。
- `pnpm --dir aims typecheck`、`pnpm --dir enterprise typecheck`：通过；改动 TS/Vue/测试文件 ESLint 0 错误；Go 文件已 `gofmt`；`git diff --check` 通过。
- 未部署、未写环境、未做浏览器视觉验收。

**交 MiMo 文件清单（12 个）**：

1. `aims/layer/pages/enterprise-project-output.vue`
2. `aims/layer/pages/enterprise-project-releases.vue`
3. `aims/test/enterpriseProjectPagination.test.ts`
4. `data-runtime/internal/apps/aims/deliverables.go`
5. `data-runtime/internal/apps/aims/deliverables_test.go`
6. `data-runtime/internal/apps/aims/product_versions.go`
7. `data-runtime/internal/apps/aims/product_versions_test.go`
8. `data-runtime/internal/server/enterprise_project_deliverables.go`
9. `data-runtime/internal/server/enterprise_project_deliverables_test.go`
10. `docs/Unified-Enterprise-Migration-W1C-Codex-Brief.md`
11. `enterprise/server/utils/enterpriseAimsDeliverables.ts`
12. `enterprise/test/aims-project-subpages-w1a-bridge.test.mjs`

工作区其他 Platform/Codocs 改动不属于 W1-C，不在提交清单中。

## Claude 复核（2026-09-23）

通过：交付物计数与列表共用同一 `whereClause`（含项目可见性），分页在过滤之后；无分页参数时不执行计数、响应形状不变；项目版本先 `requireProjectReadable`。复跑 `go test ./internal/apps/aims ./internal/server` 通过。浏览器检查随下次联合会话。

**浏览器检查（2026-09-24，Orca 内嵌浏览器，`test`）**：项目 33 的项目产出（列表/详情）、项目版本在 1440 与 390 下无横向溢出，交付物类型/提交/质量状态均为中文标签与语义色，版本页空状态与“共 0 条”+分页正常；项目概览快捷按钮与侧栏权限一致。发现：项目概览“状态/项目分类/所属部门”仍显示原始码（`active`、`product_dev`、`SDC`），交 Codex 修正。产品采用、规划周期两页未检查：`test` 可见产品数为 0。

