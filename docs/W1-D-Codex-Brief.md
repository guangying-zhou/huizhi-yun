# W1-D 任务书：项目概览原始码显示（Codex）

派发：Claude，2026-09-24。来源：浏览器检查（见 W1-C 任务书末尾）。

`aims/layer/pages/enterprise-project-detail.vue` 的项目概览卡片直接显示 `status`（如 `active`）、项目分类（如 `product_dev`）与所属部门编码（如 `SDC`）。要求：状态与分类改为中文标签 + 语义色，复用原 Aims 页面已有映射（在 `aims/app/` 中查找项目状态/分类的现有配置，抽到 `aims/app/utils/` 共用，不复制）；部门显示名称，名称来自现有目录数据或 Foundation 目录 helper，取不到时回退编码。只改该页面与共用映射，补 SFC 测试；`pnpm --dir aims test`、`node --test enterprise/test/*.test.mjs`、两模块 typecheck、改动文件 eslint 通过。不改 Runtime/授权/grant。回执写在本文件末尾，给 MiMo 文件清单，完成后回复“W1-D 完成”。

## 回执

2026-09-24：W1-D 已完成。项目概览的状态和分类改用中文语义色 `UBadge`，由 `aims/app/utils/projectOverviewPresentation.ts` 统一读取原 Aims `app/config/project.ts` 的状态/分类映射，未复制标签字典。所属部门经 Foundation `useAccountDepartments()` 目录取名称，目录无匹配或名称为空时回退部门编码。保留 camelCase/snake_case 项目字段兼容，未知状态/分类显示原码并用中性色，避免误标。

验证：定向 SFC 4/4；`pnpm --dir aims test` 708/708；`node --test enterprise/test/*.test.mjs` 196 通过、1 跳过、0 失败；`pnpm --dir aims typecheck`、`pnpm --dir enterprise typecheck` 均通过；改动文件 ESLint 通过。未改 Runtime、授权、grant，未部署。

交 MiMo 文件清单：`aims/layer/pages/enterprise-project-detail.vue`、`aims/app/utils/projectOverviewPresentation.ts`、`enterprise/test/project-detail-sfc.test.mjs`、`docs/W1-D-Codex-Brief.md`。
