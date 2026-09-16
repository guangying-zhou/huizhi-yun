# Codocs 部门开放文档列表为空

日期：2026-07-23

## 现象

- 部门负责人可以把部门目录设置为开放目录。
- `/codocs/departments` 能看到开放标识和目录内文档。
- `/codocs/company/open-department-docs` 却显示“暂无开放文档”。

## 排查结论

生产租户数据库中有 3 个显式开放的部门目录（35、56、91），因此不是数据缺失。

Codocs 旧实现通过普通 `/v1/codocs/folders`、`/v1/codocs/documents` ACL 查询组织级开放文档。普通 ACL 收口后，该页面无法枚举其他部门目录，因此本次改造增加了专用的 `GET /v1/codocs/open-department-documents` 合同。

专用合同首次连接真实租户库时仍返回 `folders=0`、`documents=0`。数据库中的：

- `folders.id`
- `folders.parent_id`

均为 `BIGINT UNSIGNED`。Go MySQL 驱动将其读取为 `uint64`，而 Codocs runtime 的 `int64Value` 只支持有符号整数、浮点数和字符串。开放目录 ID 因此全部被归一化为 `0`，在开放目录构树前被过滤。

## 修复

- `int64Value` 增加 `uint64`、`uint`、`uint32` 支持。
- 超过 `int64` 正数范围的无符号值继续按无效 ID 返回 `0`，避免溢出。
- 增加以 `uint64` 模拟真实 MySQL 返回类型的回归测试，覆盖开放根目录及其后代。
- Data Runtime 版本由已经发布的 `0.3.137` 提升到 `0.3.138`。

## 验证

- 回归测试修复前失败：开放目录集合为空。
- 回归测试修复后通过。
- 本地 Data Runtime 连接现有租户数据库后，同一接口从 `0 folders / 0 documents` 恢复为 `12 folders / 63 documents`（包含显式开放目录及同部门后代）。
- `go test ./...` 通过。
- Codocs 143 个测试、lint、typecheck、Cloudflare production build 全部通过。
- Data Runtime 发布链测试 16 个用例全部通过。

## 发布要求

先发布并在 Platform Admin 批准 Data Runtime `0.3.138`，再让租户运行时更新到 `0.3.138`；同时发布包含专用开放文档 BFF 合同的 Codocs 版本。只发布 Codocs 或只更新到 `0.3.137` 都不能完成修复。
