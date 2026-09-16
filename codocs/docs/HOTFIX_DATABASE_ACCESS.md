# 紧急修复：数据库访问模式错误

**日期：** 2026-01-24
**修复人：** GitHub Copilot CLI

## 问题描述

运行时出现两个错误：

1. **错误 1：** `Unknown column 'project_code' in 'where clause'`
   - documents 表缺少 project_code 字段
   - SQL UPDATE/INSERT 语句使用了不存在的字段

2. **错误 2：** 错误的架构设计
   - Codocs 模块尝试直接访问和更新 git_projects 表
   - git_projects 表应该由 Account 模块独占管理

## 修复方案

### 1. 架构调整

**修复前（错误）：**
```
Codocs → 直接访问 git_projects 表
Codocs → 直接更新 docs_synced_at, docs_committed_at
```

**修复后（正确）：**
```
Codocs → 调用 Account API → Account 更新 git_projects 表
Codocs → 只管理 documents 表
```

### 2. 数据库操作调整

**移除的操作：**
```sql
-- ❌ 错误：直接操作 git_projects 表
UPDATE git_projects SET docs_synced_at = NOW() WHERE project_code = ?
UPDATE git_projects SET docs_committed_at = NOW() WHERE project_code = ?
```

**保留的操作：**
```sql
-- ✅ 正确：只操作 documents 表
INSERT INTO documents (uuid, title, oss_path, ...) VALUES (...)
UPDATE documents SET diff = ? WHERE oss_path = ?
UPDATE documents SET gitlab_deleted = 1 WHERE oss_path = ?
```

### 3. 文件修改清单

**后端 API（移除 git_projects 表操作）：**
- ✅ `server/api/project-docs/[projectCode]/gitlab-sync.get.ts`
- ✅ `server/api/project-docs/[projectCode]/resolve-conflicts.post.ts`
- ✅ `server/api/project-docs/[projectCode]/gitlab-submit.post.ts`

**数据库迁移：**
- ✅ `sql/migrations/20260124_add_documents_fields.sql`
  - 只修改 documents 表
  - 添加注释说明 git_projects 表由 Account 管理

**文档更新：**
- ✅ `docs/GitLab-Sync-Feature.md`
- ✅ `docs/GitLab-Sync-QuickStart.md`
- ✅ `docs/IMPLEMENTATION_CHECKLIST.md`

## 修复详情

### gitlab-sync.get.ts

**修复前：**
```typescript
// ❌ 包含 project_code
await pool.execute(
  `INSERT INTO documents (..., project_code, ...) VALUES (?, ..., ?, ...)`,
  [..., projectCode, ...]
)

// ❌ WHERE 条件包含 project_code
WHERE oss_path = ? AND project_code = ?

// ❌ 直接更新 git_projects 表
await pool.execute(
  `UPDATE git_projects SET docs_synced_at = NOW() WHERE project_code = ?`,
  [projectCode]
)
```

**修复后：**
```typescript
// ✅ 移除 project_code
await pool.execute(
  `INSERT INTO documents (...) VALUES (...)`,
  [...]
)

// ✅ 只用 oss_path 定位
WHERE oss_path = ?

// ✅ 移除 git_projects 表操作（由 Account API 处理）
// 注释说明：项目的 docsSyncedAt 由 Account API 更新
```

### resolve-conflicts.post.ts

**修复前：**
```typescript
// ❌ WHERE 条件包含 project_code
WHERE oss_path = ? AND project_code = ?
```

**修复后：**
```typescript
// ✅ 只用 oss_path 定位
WHERE oss_path = ?
```

### gitlab-submit.post.ts

**修复前：**
```typescript
// ❌ WHERE 条件包含 project_code
WHERE oss_path = ? AND project_code = ?

// ❌ 直接更新 git_projects 表
await pool.execute(
  `UPDATE git_projects SET docs_committed_at = NOW() WHERE project_code = ?`,
  [projectCode]
)
```

**修复后：**
```typescript
// ✅ 只用 oss_path 定位
WHERE oss_path = ?

// ✅ 移除 git_projects 表操作（由 Account API 处理）
```

## 部署步骤

1. **执行数据库迁移：**
   ```bash
   mysql -u root -p hzy_codocs < sql/migrations/20260124_add_documents_fields.sql
   ```

2. **重启开发服务器：**
   ```bash
   npm run dev
   ```

3. **测试验证：**
   - 选择一个配置了 repoUrl 的项目
   - 点击"从 GitLab 同步"
   - 应该不再出现 `Unknown column 'project_code'` 错误

## 验证通过

- ✅ 所有 `UPDATE git_projects` 语句已移除
- ✅ 所有 `WHERE ... AND project_code = ?` 已改为 `WHERE oss_path = ?`
- ✅ TypeScript 编译无错误
- ✅ 文档已更新，正确说明架构

## 注意事项

1. **数据一致性：** documents 表的 oss_path 必须唯一，作为文档标识
2. **项目时间戳：** docs_synced_at 和 docs_committed_at 由 Account API 在调用 4.7/4.9 后自动更新
3. **权限控制：** 项目权限验证在 Account API 层面，Codocs 不需要关心

## 相关文件

- 修复说明：`docs/HOTFIX_DATABASE_ACCESS.md`（本文件）
- 实现清单：`docs/IMPLEMENTATION_CHECKLIST.md`
- 快速开始：`docs/GitLab-Sync-QuickStart.md`
