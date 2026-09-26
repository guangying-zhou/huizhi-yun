# W1-B 任务书：产品子页盘点与只读页迁移（Codex）

派发：Claude，2026-09-23。计划：[统一企业迁移分波计划](./Unified-Enterprise-Migration-Waves-Plan-20260923.md) 第 1 波第二批；模板 §4；参照已通过复核的 [W1-A](./Unified-Enterprise-Migration-W1A-Codex-Brief.md)（含 W1-A2 标签共用做法）。不部署、不写环境、不改 grant。

## 背景

Host 已登记 `/aims/products/:productCode` 下 planning、requests、structure、execution-coordination、features/:featureId（及 lifecycle/requests/roadmap）、planning-items/:itemId/handoff、versions 系列（`deploy/test-env/enterprise-host-routes.mjs`）。`aims/app/pages/products/[productCode]/` 下其余页面未登记，约 50 个，多数是规划周期（cycles/**）、规划项（planning-items/**）、模型（models/**）、目标（objectives/**）的写入流程页。

产品工作台闭环（FE-2 / INT-503）的任务脚本尚未冻结，所以本批**只迁只读页**，写入流程页只盘点，供 FE-2 使用。

## 范围

1. **盘点（全部未登记产品子页）**：写 `docs/Unified-Enterprise-Product-Subpages-Inventory.md`，格式同项目子页盘点：逐页列组件/composable 依赖、每个 METHOD + API 路径、所需人员权限（`aims/app.manifest.json` resource/action）、现有 Runtime 操作（`foundation/server/utils/enterpriseRuntimeClient.ts`）与缺口、可达写动作、是否纯只读、建议批次。按 cycles / planning-items / models / objectives / 其他 分组。
2. **本批实施（只读页）**：从下列候选中挑出**确认为纯只读或只读为主**的页面迁移：`features/index`、`documents`、`components`、`adoption`、`feature-version-matrix`、`release-comparison`、`objectives/index`、`objectives/[objectiveId]`、`cycles/index`、`models/index`、`cost`。
   - 页面内有写入口的，Host 版本只保留读取部分，不暴露写按钮（同 W1-A output/releases 做法）；写入口列入盘点。
   - 读取所需 Runtime 操作已存在的直接复用；**缺 Runtime 操作的页面不实施**，在盘点中写提议（path、capability、Runtime 校验、manifest 变更），标“待 Claude 复核”。
   - `settings`、`cost-rules`、所有 `new`/`edit`/`assess`/`commit`/`move`/`close` 等写流程页只盘点。
3. **遵循模板**：读取 BFF 签发许可前经 Foundation `loadAuthorizationSnapshotFromConsoleRuntime` + `authorizationResourcesAllow` 检查对应资源 `view`（产品相关资源以 manifest 为准，不要默认用 `projects`），缺权 403 不调 Runtime，依赖故障 503；状态/类型显示用中文标签 + 语义色，映射与原页共用（放 `aims/app/utils/`）；列表若 Runtime 支持分页则接 `UPagination`，不支持则在盘点记为后批。
4. **导航**：通过 manifest 业务导航与生成脚本登记，不手写权限表；生成后 readiness、导航、Host 路由三份生成文件只含本批条目。

## 不做

- 不改 `data-runtime/**`、Foundation 身份/授权核心、Console/Platform、任何 grant/SQL seed。
- 不改 Codocs 前端与 `codocs/**`（Claude 在做 INT-606c）；不改 `enterprise/server/utils/*Codocs*`、`enterprise/server/routes/codocs/**`。
- 不做浏览器视觉验收（由 Claude 执行）。
- 顺手修正所改文件中的机械性 lint 错误（如一行多语句、引号、逗号），不扩到未改文件。

## 交付与回执

- 测试：`node --test enterprise/test/*.test.mjs` 全过（当前 189 项，188 通过、1 跳过）；`pnpm --dir aims test` 全过（当前 707）；两模块 typecheck 通过；改动文件 eslint 无错误；新增桥接测试覆盖 actor 绑定、缺权 403 不调用 Runtime、依赖 503、输入校验、不可见 404。
- 回执写在本文件末尾“回执”节：改动文件、命令与结果、盘点结论、待复核项、未完成项、交 MiMo 的文件清单。
- 完成后在 Orca 终端回复“W1-B 完成”。

## 回执

### Codex 回执（2026-09-23）

**盘点结论**：新增 [产品子页盘点](./Unified-Enterprise-Product-Subpages-Inventory.md)，逐页覆盖 W1-B 开始时未登记的 48 个源页（cycles 23、planning-items 8、models 3、objectives 3、其他 11），列出组件/composable、METHOD + API、人员资源/动作、现有 Runtime 操作/缺口、可达写动作与建议批次。本批确认可用的只有旧书签跳转 `features/index`、`components`，以及有既存精确 Runtime 读取的 `adoption` 和 `cycles/index` 列表。文档、矩阵、发布差异、目标、模型、成本等候选缺必要读取操作，只写 Runtime 提议，均标待 Claude 复核。源模型接口还使用 manifest 未声明的 `product_priorities:admin`，权限契约也需复核。

**实施**：登记 `/aims/products/:productCode/{features,components,adoption,cycles}`；旧书签保留模块 query 并跳 Host 结构页。采用页沿用原版分页与 Assets 双对象范围读取，并与原页共用中文状态标签/语义色；周期 Host 专页仅显示列表、状态、容量和分页，去掉源页的权限探针、详情弹窗与写入口，原周期页也共用状态映射。两条 BFF 在 Runtime 前分别核 Foundation `products:view` / `product_priorities:view`，再核产品对象；缺人员权限 403 且不调用 Runtime，依赖故障 503，不可见对象 404。未增加 Runtime 操作、grant、seed 或授权核心改动。导航由 `aims/layer/entry.mjs` 与产品导航配置派生，生成 Host 路由和 Enterprise 导航；`generate:api-readiness` 无差异。

**验证**：

- `node --test enterprise/test/*.test.mjs`：189 项，188 通过、1 跳过、0 失败。新增桥接覆盖可信 actor、403 无 Runtime、依赖 503、非法分页 400、不可见 404。
- `pnpm --dir aims test`：707 项全过。
- `pnpm --dir enterprise typecheck`、`pnpm --dir aims typecheck`：通过。
- 改动的 Aims 与 Enterprise TS/Vue/测试文件 ESLint：0 错误；`git diff --check`：通过。
- 未做浏览器视觉验收；未部署或写环境。

**待 Claude 复核 / 未完成**：盘点文档末尾 7 组精确 Runtime 提议、模型人员权限动作不一致、读写混合页的后批读取闭包与写流程。上述页面本批未登记，需操作与权限合同通过后再迁。周期详情/复评同样待后批。

**交 MiMo 文件清单（18 个）**：

1. `aims/app/config/productNavigation.ts`
2. `aims/app/pages/products/[productCode]/adoption.vue`
3. `aims/app/pages/products/[productCode]/components.vue`
4. `aims/app/pages/products/[productCode]/cycles/index.vue`
5. `aims/app/pages/products/[productCode]/features/index.vue`
6. `aims/app/utils/productReadLabels.ts`
7. `aims/layer/entry.mjs`
8. `aims/layer/pages/enterprise-product-cycles.vue`
9. `aims/test/productWorkspaceNavigation.test.ts`
10. `deploy/test-env/enterprise-host-routes.mjs`
11. `docs/Unified-Enterprise-Migration-W1B-Codex-Brief.md`
12. `docs/Unified-Enterprise-Product-Subpages-Inventory.md`
13. `enterprise/app/utils/enterprise-navigation.ts`
14. `enterprise/server/routes/aims/api/v1/products/[productCode]/adoption.get.ts`
15. `enterprise/server/routes/aims/api/v1/products/[productCode]/planning-cycles.get.ts`
16. `enterprise/server/utils/enterpriseProductReadGate.ts`
17. `enterprise/test/feature-bridge.test.mjs`
18. `enterprise/test/registry.test.mjs`

工作区内另有 Platform 政策文件的既存改动，不在 W1-B 文件清单中。

## Claude 复核（2026-09-23）

- **通过（代码层）**：`enterpriseProductReadGate.ts` 在签发许可前按 manifest 资源（`products` / `product_priorities`）检查人员 `view`，随后仍经既有 `requireProductPermission` 校验产品对象；采用页输入校验收紧（禁 `/` 与控制字符）。Enterprise 189（188 通过、1 跳过）、Aims 707/707、两模块 typecheck 复跑通过。
- **待做**：1440/390 浏览器检查（需登录会话，下次联合会话执行）；盘点文档末尾 7 组 Runtime 提议与模型接口 `product_priorities:admin` 未声明问题，归入 FE-2 冻结产品任务脚本时一并定合同，本批不实施。
