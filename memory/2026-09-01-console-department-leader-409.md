# DEBUG REPORT — Console 设置部门 Leader 返回 409

日期：2026-09-01
入口：`PATCH /api/v1/console/directory/departments/{deptCode}`

## Symptom

- 在 Console 编辑部门并设置 Leader 时，部门更新接口返回 HTTP 409。
- 打开编辑表单时还可能抛出 `A <SelectItem /> must have a value prop that is not an empty string`。
- 同批浏览器日志中的 Aims `GET /api/v1/projects/258` 404 来自保留的 Aims 页面请求，不在
  Console 部门更新调用链中。

## Root cause

2026-08-28 的钉钉组织事实源保护把 `leaderId` 与名称、父级、钉钉部门负责人等字段一起列为
钉钉权威字段，但钉钉部门投影实际只同步 `manager_uid`，不写 `leader_uid`。同时部门编辑页的
PATCH 总是提交完整表单，因此修改 Leader 时也会附带名称、父级、负责人、排序和组织类型。
对于钉钉映射部门，任一这些字段存在都会触发
`409 dingtalk_department_field_managed`。

页面的“无父级”和“未分类”两个 USelect 选项还使用了空字符串 value；Nuxt UI v4 底层
SelectItem 明确禁止空字符串值，因此编辑弹窗会产生独立的运行时异常。

## Fix

- 保留钉钉对名称、父级、`managerId`、排序、状态和组织类型的权威保护，将 HZY 自有的
  `leaderId` 从钉钉字段列表移除。
- 部门编辑时保存初始规范化快照，PATCH 只发送实际变化字段；仅修改 Leader 时请求体只包含
  `leaderId`，不会夹带钉钉权威字段。
- 用已有 Console 表单模式的非空 sentinel 表示“无父级/未分类”，提交时再规范化为 `null`。
- 没有任何变化时不发送空 PATCH。

## Evidence

- 两项聚焦回归在修复前均失败：字段归属测试识别到 `leaderId` 被误拦截；页面契约测试识别到
  空字符串 SelectItem 与整包 PATCH。
- 修复后两项聚焦回归均通过。
- Console 全量测试 426/426 通过，Nuxt typecheck 和目标文件 ESLint 通过。
- data-runtime `go test ./...` 全量通过，`git diff --check` 通过。

## Regression test

- `console/test/directoryDepartmentEditing.test.ts`
- `data-runtime/internal/apps/directory/hr_source_field_ownership_test.go`

## Related

- 回归由提交 `c932624d feat(people): 建立钉钉组织事实源` 引入。
- `managerId` 仍由钉钉部门快照维护；若需要人工修改钉钉部门负责人，应走 People/钉钉事实源，
  不能从 Console 绕过权威边界。

## Status

DONE_WITH_CONCERNS：根因已修复且自动化回归全部通过；当前环境没有可连接的 Browser/Chrome
实例，未能用真实登录页面点击保存，也未执行生产部署。
