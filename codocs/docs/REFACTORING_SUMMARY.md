# 冲突检测机制重构总结

**日期**: 2026-01-24
**版本**: 2.0
**重构目标**: 将冲突检测从数据库字段改为 OSS 元数据

---

## 🎯 核心变更

### 旧方案 → 新方案

| 方面            | 旧方案              | 新方案                |
| --------------- | ------------------- | --------------------- |
| **冲突存储**    | documents 表字段    | OSS 文件元数据        |
| **冲突检测**    | 查询数据库          | 读取 OSS meta         |
| **diff 存储**   | documents.diff 字段 | temp/{file}.diff 文件 |
| **commit 信息** | 数据库字段          | OSS meta              |

---

## 📝 代码修改清单

### 后端 API (7个文件)

#### 1. ✅ 简化同步逻辑
**server/api/project-docs/[projectCode]/gitlab-sync.get.ts**
```typescript
// 旧：更新 documents 表的冲突字段
for (const file of syncData.conflict) {
  await pool.execute(
    `UPDATE documents SET diff = ?, gitlab_commit_id = ?, ...`
  )
}

// 新：只插入新增文档
for (const file of syncData.new) {
  await pool.execute(
    `INSERT INTO documents (uuid, title, oss_path, owner_uid, ...)`
  )
}
```

**变更内容**:
- ❌ 移除冲突字段更新逻辑
- ❌ 移除删除标记更新逻辑
- ✅ 只处理新增文档插入
- 冲突信息由 Account API 写入 OSS meta

---

#### 2. ❌ 删除旧冲突解决接口
**server/api/project-docs/[projectCode]/resolve-conflicts.post.ts**
- 已删除，功能由 Account API 4.8/4.9 提供

---

#### 3. ✅ 新增代理接口 - 使用 GitLab 版本
**server/api/project-docs/[projectCode]/use-gitlab-version.post.ts** (新建)
```typescript
// 代理 Account API 4.8
const response = await $fetch(
  `${apiBaseUrl}/api/v1/projects/${projectCode}/use-gitlab-version`,
  {
    method: 'POST',
    body: { uid, oss_path }
  }
)

// 更新文档大小
if (response.data?.content_size) {
  await pool.execute(
    `UPDATE documents SET content_size = ? WHERE oss_path = ?`,
    [response.data.content_size, oss_path]
  )
}
```

---

#### 4. ✅ 新增代理接口 - 忽略冲突
**server/api/project-docs/[projectCode]/ignore-conflict.post.ts** (新建)
```typescript
// 代理 Account API 4.9
const response = await $fetch(
  `${apiBaseUrl}/api/v1/projects/${projectCode}/ignore-conflict`,
  {
    method: 'POST',
    body: { uid, oss_path }
  }
)
```

---

#### 4. ✅ 增强文件列表 - 返回冲突状态
**server/api/project-docs/[projectCode]/files.get.ts**
```typescript
// 获取 OSS 元数据以检测冲突
const docsWithMeta = await Promise.all(
  docs.map(async (doc) => {
    const meta = await getFileMetadata(doc.path)
    return {
      ...doc,
      conflictStatus: meta?.meta?.['conflict-status'] === '1',
      gitlabLatestSize: meta?.meta?.['gitlab-latest-size'],
      gitlabLatestCommitId: meta?.meta?.['gitlab-latest-commit-id']
    }
  })
)
```

**返回数据新增字段**:
- `conflictStatus`: boolean
- `gitlabLatestSize`: number | null
- `gitlabLatestCommitId`: string | null

---

#### 5. ✅ 新增 OSS 工具函数
**server/utils/oss.ts**
```typescript
/**
 * 获取文件元数据（包含冲突信息）
 */
export const getFileMetadata = async (ossPath: string) => {
  const client = createOSSClient()
  const result = await client.head(ossPath)

  return {
    size: result.res.headers['content-length'],
    meta: result.meta || {},
    lastModified: result.res.headers['last-modified']
  }
}
```

---

### 前端修改 (2个文件)

#### 1. ✅ 简化冲突检测逻辑
**app/pages/projects/index.vue**
```typescript
// 旧：从数据库字段判断
const hasConflicts = computed(() => {
  const conflictDocs = projectDocsStore.documents.filter(doc =>
    doc.gitlab_commit_id &&
    doc.oss_commit_id &&
    doc.gitlab_commit_id !== doc.oss_commit_id
  )
  return conflictDocs.length > 0
})

// 新：从 OSS meta 判断
const hasConflicts = computed(() => {
  const conflictDocs = projectDocsStore.documents.filter(doc =>
    doc.conflictStatus === true
  )
  return conflictDocs.length > 0
})
```

---

#### 2. ✅ 更新类型定义
**app/types/projectDocs.ts**
```typescript
export interface ProjectFileItem {
  // ... 现有字段

  // 新增：冲突相关字段（从 OSS meta）
  conflictStatus?: boolean
  gitlabLatestSize?: number | null
  gitlabLatestCommitId?: string | null
}
```

---

## 🗑️ 数据库变更

### 删除的字段 (7个)

执行迁移文件: `sql/migrations/20260124_remove_conflict_fields.sql`

```sql
ALTER TABLE `documents` DROP COLUMN `gitlab_commit_id`;
ALTER TABLE `documents` DROP COLUMN `gitlab_committer`;
ALTER TABLE `documents` DROP COLUMN `gitlab_deleted`;
ALTER TABLE `documents` DROP COLUMN `gitlab_content_size`;
ALTER TABLE `documents` DROP COLUMN `oss_commit_id`;
ALTER TABLE `documents` DROP COLUMN `diff`;
ALTER TABLE `documents` DROP COLUMN `committed_at`;
```

---

## 📊 新数据流

### 1. 同步文档
```
用户触发同步
    ↓
GET /api/project-docs/:projectCode/gitlab-sync
    ↓
Account API 4.7 同步到 OSS
    ├── new[] → 插入 documents 表
    ├── conflict[] → 写入 OSS meta['conflict-status'] = '1'
    ├── delete[] → 写入 OSS meta
    └── nochange[] → 无操作
    ↓
返回同步结果
```

### 2. 检测冲突
```
加载文档列表
    ↓
GET /api/project-docs/:projectCode/files
    ↓
查询 documents 表
    ↓
并发读取每个文件的 OSS meta
    ↓
返回文件列表 + conflictStatus
    ↓
前端过滤 conflictStatus === true
```

### 3. 使用 GitLab 版本
```
用户点击"使用 GitLab 版本"
    ↓
POST /api/project-docs/:projectCode/use-gitlab-version (本地实现)
    ↓
读取 OSS meta['gitlab-latest-commit-id']
    ↓
复制 temp/{file} → 主文件（覆盖）
    ↓
更新 OSS meta:
    ├── gitlab-commit-id = gitlab-latest-commit-id
    └── conflict-status = '0'
    ↓
删除 temp 文件和 diff 文件
    ↓
更新 documents.content_size
    ↓
刷新文件列表
```

### 4. 忽略冲突
```
用户点击"忽略"
    ↓
POST /api/project-docs/:projectCode/ignore-conflict (本地实现)
    ↓
读取 OSS meta['gitlab-commit-id']
    ↓
更新 OSS meta:
    ├── gitlab-latest-commit-id = gitlab-commit-id (标记已忽略)
    └── conflict-status = '0'
    ↓
删除 temp 文件和 diff 文件
    ↓
刷新文件列表
```

---

## 🏷️ OSS 元数据字段

| 字段                      | 类型   | 说明                    |
| ------------------------- | ------ | ----------------------- |
| `conflict-status`         | string | `'0'` 或 `'1'`          |
| `gitlab-commit-id`        | string | OSS 当前版本的 commit   |
| `gitlab-latest-commit-id` | string | GitLab 最新 commit      |
| `gitlab-latest-size`      | string | GitLab 版本大小（字节） |
| `synced-at`               | string | 同步时间 (ISO 8601)     |

---

## ✅ 优势

1. **简化数据库**: 减少 7 个冗余字段
2. **数据一致性**: 冲突信息与文件绑定，无需同步
3. **性能优化**: 减少数据库写入操作
4. **可扩展性**: 新增冲突字段无需修改数据库
5. **离线支持**: 可直接读取 OSS meta

---

## ⚠️ 注意事项

### 性能考虑
- **问题**: 并发读取多个文件的 OSS meta 可能较慢
- **优化**:
  1. 使用 `Promise.all()` 并发请求
  2. 考虑缓存 meta 数据
  3. 只在需要时读取（懒加载）

### 错误处理
```typescript
// OSS meta 读取失败时的降级
const meta = await getFileMetadata(doc.path)
return {
  ...doc,
  conflictStatus: meta?.meta?.['conflict-status'] === '1' || false
}
```

---

## 📚 相关文档

- [Account-API.md](./Account-API.md) - 4.7, 4.8, 4.9 接口说明
- [Document-System-Integration.md](./Document-System-Integration.md) - 集成指南
- [GitLab-OSS-Sync-Logic.md](./GitLab-OSS-Sync-Logic.md) - 同步逻辑详解

---

## 🚀 部署步骤

1. **备份数据库**
   ```bash
   mysqldump -u root -p hzy_codocs documents > backup_20260124.sql
   ```

2. **执行迁移**
   ```bash
   mysql -u root -p hzy_codocs < sql/migrations/20260124_remove_conflict_fields.sql
   ```

3. **更新代码**
   ```bash
   git pull
   pnpm install
   ```

4. **重启服务**
   ```bash
   pnpm run build
   pm2 restart codocs
   ```

5. **验证功能**
   - 同步文档
   - 检测冲突
   - 解决冲突

---

**维护者**: 开发团队
**最后更新**: 2026-01-24
