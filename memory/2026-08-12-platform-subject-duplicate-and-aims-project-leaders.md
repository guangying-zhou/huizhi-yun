# Platform 主体目录重复与 Aims 项目负责人缺失

日期：2026-08-12

## DEBUG REPORT

- Status: DONE
- Symptom:
  - Platform 主体目录中 GMO 部门先正常显示成员，随后又以部门主体重复显示在 GMO 下方。
  - Aims 项目立项页选择 GMO 后，负责人候选只有 3 人，而 Platform 目录中 GMO 有 6 名有效成员。
- Root cause:
  - Platform 投影同步把带父节点的所有主体都派生为 membership；主体树又同时渲染结构父子关系和 membership，因此 GMO 部门既按 `parent_subject_id` 出现一次，又按部门 membership 出现一次。
  - Aims 立项页先读取全体用户，再按每个用户返回的单一 `deptCode` 在浏览器内过滤。目录运行时的 `deptCode` 是用户的主/首选部门，不代表其全部有效部门关系，所以非主部门属于 GMO 的成员被错误排除。
- Fix:
  - Platform 只为用户主体派生父级 membership；主体树也只允许用户 membership 生成成员行，结构主体继续完全由 `parent_subject_id` 组织。
  - Aims 在部门变化时通过 `/api/directory/users?dept_code=...` 查询该部门的权威有效成员集合，不再比较用户的单一 `deptCode`；保留部门负责人补充与 UID 去重。
  - Aims 增加请求序号保护，避免快速切换部门时旧请求覆盖新部门候选，并在部门变更时清空旧负责人和立项书选择。
- Evidence:
  - 两条新回归测试在修改前均失败，分别命中非用户 membership 挂载和主部门字段过滤。
  - 修复后 Platform 聚焦测试 5/5、Aims 聚焦测试 1/1 通过。
  - Platform 全量测试通过；Aims 全量测试 228/228 通过。
  - Platform、Aims 类型检查通过；修改文件 ESLint 与 `git diff --check` 通过。
  - Foundation 目录分页聚焦测试 3/3 通过，确认 `dept_code` 在 500 人窗口拆分为多次运行时查询时持续透传。
- Regression test:
  - `platform/test/managedCloudSubjectSyncContract.test.ts` 锁定非用户主体不得被派生或渲染为成员子节点。
  - `aims/test/projectLeaderDirectoryMembership.test.ts` 锁定立项页必须按 `dept_code` 查询权威成员，且不得回退到 `u.deptCode === deptCode`。
- Related issues:
  - 无需数据库迁移。部署后 UI 会立即忽略已有的结构主体 membership；下一次带 `resetMemberships` 的主体投影同步会把旧运行时关系置为 inactive。
  - `ProjectEditModal.vue` 仍有同类主部门字段过滤，但属于项目编辑流程，不影响本次截图中的独立项目立项页；建议后续统一到同一部门成员查询方式。

