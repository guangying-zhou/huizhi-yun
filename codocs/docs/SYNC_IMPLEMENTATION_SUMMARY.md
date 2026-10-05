# GitLab-OSS 同步功能实现总结

## 📅 更新日期
2026-01-24

## 🎯 实现目标

实现 GitLab 与 OSS 之间的文档同步功能，包括：
1. 从 GitLab 同步文档到 OSS
2. 冲突检测与解决
3. 使用 GitLab 版本覆盖
4. 忽略冲突保留 OSS 版本

## 📊 架构设计

### 数据存储方案

**冲突信息存储位置：OSS 文件元数据**

不再使用数据库字段存储冲突信息，改用 OSS 文件的自定义元数据：

```typescript
meta: {
  'gitlab-commit-id': string,        // OSS当前版本的commit
  'gitlab-latest-commit-id': string, // GitLab最新commit
  'gitlab-latest-size': string,      // GitLab最新版本文件大小
  'synced-last-modified': string,    // 同步时OSS的lastModified
  'synced-at': string,               // 同步时间(UTC)
  'conflict-status': '0' | '1'       // 冲突状态
}
```

**数据库保留字段：**

```sql
-- documents 表核心字段
uuid              CHAR(36)      -- 文档UUID
title             VARCHAR(255)  -- 文档标题
doc_type          ENUM          -- 文档类型
oss_path          VARCHAR(500)  -- OSS存储路径
owner_uid         VARCHAR(64)   -- 所有者
project_code        VARCHAR(64)   -- 项目ID
status            TINYINT       -- 状态
content_size      INT           -- 内容大小
last_editor_uid   VARCHAR(64)   -- 最后编辑者
created_at        DATETIME      -- 创建时间
updated_at        DATETIME      -- 更新时间
```

### API 实现

#### 1. GET /api/project-docs/:projectCode/gitlab-sync

**功能：**从 GitLab 同步文档到 OSS

**实现方式：**
- 调用 Account API 的 4.7 接口 `/api/v1/projects/{project_code}/gitlab-sync-docs`
- Account API 负责访问 GitLab 和 OSS，返回同步结果
- 本地处理数据库操作：新增和更新文档记录

**处理逻辑：**
```typescript
// 1. 新增文件 - 插入数据库
for (const file of syncData.new) {
  await db.execute(`
    INSERT INTO documents (uuid, title, doc_type, oss_path, owner_uid,
                          project_code, status, content_size, last_editor_uid)
    VALUES (?, ?, 'project', ?, ?, ?, 1, ?, ?)
  `, [uuid, title, oss_path, uid, projectCode, content_size, gitlab_committer])
}

// 2. 自动更新的文件 - 更新数据库
for (const file of syncData.updated) {
  await db.execute(`
    UPDATE documents
    SET content_size = ?, last_editor_uid = ?, updated_at = NOW()
    WHERE oss_path = ?
  `, [content_size, gitlab_committer, oss_path])
}

// 3. 冲突文件 - 不操作数据库，冲突信息在OSS元数据中
// 4. 无变化文件 - 不操作
// 5. 删除文件 - 不自动删除，由用户决定
```

**响应格式：**
```json
{
  "code": 0,
  "data": {
    "new": [{ doc_path, oss_path, content_size, gitlab_commit_id, ... }],
    "updated": [{ doc_path, oss_path, content_size, gitlab_commit_id, ... }],
    "nochange": [{ doc_path, oss_path }],
    "conflict": [{ doc_path, oss_path, content_size, gitlab_commit_id, diff, ... }],
    "delete": [{ oss_path, gitlab_commit_id, ... }]
  }
}
```

#### 2. POST /api/project-docs/:projectCode/resolve-conflicts

**功能：**批量解决文档冲突

**实现方式：**本地实现，不调用 Account API

**请求格式：**
```json
{
  "uid": "zhangsan",
  "docs": [
    { "oss_path": "...", "use_gitlab": true },
    { "oss_path": "...", "use_gitlab": false },
    { "oss_path": "...", "delete": true }
  ]
}
```

**处理逻辑：**
```typescript
// use_gitlab: true - 使用GitLab版本
1. 复制 temp/{file} 到主文件位置（覆盖）
2. 更新OSS元数据: conflict-status = '0', gitlab-commit-id = latest
3. 删除 temp/{file} 和 temp/{file}.diff
4. 更新数据库 content_size

// use_gitlab: false - 忽略冲突
1. OSS文件保持不变
2. 更新OSS元数据: conflict-status = '0', gitlab-commit-id = latest
3. 删除 temp/{file} 和 temp/{file}.diff

// delete: true - 删除文件
1. 删除OSS文件
2. 删除数据库记录
```

#### 3. POST /api/project-docs/:projectCode/use-gitlab-version

**功能：**单个文件使用 GitLab 版本

**实现方式：**本地实现，不调用 Account API

**请求格式：**
```json
{
  "uid": "zhangsan",
  "oss_path": "xxx/README.md"
}
```

#### 4. POST /api/project-docs/:projectCode/ignore-conflict

**功能：**单个文件忽略冲突

**实现方式：**本地实现，不调用 Account API

**请求格式：**
```json
{
  "uid": "zhangsan",
  "oss_path": "xxx/README.md"
}
```

#### 5. GET /api/project-docs/:projectCode/files

**功能：**获取项目文档列表

**冲突检测：**
```typescript
// 读取 OSS 元数据
const meta = await getFileMetadata(doc.path)

// 检测冲突
const conflictStatus = meta?.meta?.['conflict-status'] === '1'
const gitlabLatestSize = meta?.meta?.['gitlab-latest-size']
const gitlabLatestCommitId = meta?.meta?.['gitlab-latest-commit-id']

// 返回给前端
return {
  ...doc,
  conflictStatus,
  gitlabLatestSize,
  gitlabLatestCommitId
}
```

## 🖥️ 前端实现

### 冲突检测

```typescript
// 从文档树递归检测冲突
const hasConflicts = computed(() => {
  const checkConflicts = (items: ProjectFileItem[]): boolean => {
    for (const item of items) {
      if (!item.isDirectory && item.conflictStatus === true) {
        return true
      }
      if (item.children && checkConflicts(item.children)) {
        return true
      }
    }
    return false
  }
  return checkConflicts(projectDocsStore.documents)
})
```

### 冲突收集

```typescript
// 点击"解决冲突"按钮时收集冲突文档
const collectConflicts = (items: ProjectFileItem[]): any[] => {
  const conflicts: any[] = []
  for (const item of items) {
    if (!item.isDirectory && item.conflictStatus === true) {
      conflicts.push({
        doc_path: extractDocPath(item.oss_path),
        oss_path: item.oss_path,
        content_size: parseInt(item.gitlabLatestSize || '0'),
        gitlab_commit_id: item.gitlabLatestCommitId || '',
        ...
      })
    }
    if (item.children) {
      conflicts.push(...collectConflicts(item.children))
    }
  }
  return conflicts
}
```

### 冲突解决弹窗

使用 `ConflictResolveModal.vue` 组件：
- 左侧列表显示所有冲突文件
- 右侧显示选中文件的详情和操作选项
- 支持查看 diff
- 支持选择使用 GitLab 版本或保留 OSS 版本

## 📝 数据流程

### 同步流程

```
用户点击"从GitLab同步"
  ↓
前端调用 /api/project-docs/:projectCode/gitlab-sync
  ↓
后端调用 Account API /api/v1/projects/{id}/gitlab-sync-docs
  ↓
Account API 访问 GitLab 和 OSS，返回同步结果
  ↓
后端处理数据库操作：
  - new: 插入新记录
  - updated: 更新 content_size
  - conflict/delete: 不操作数据库（信息在OSS元数据中）
  ↓
返回同步结果给前端
  ↓
前端重新加载文档列表（包含冲突状态）
  ↓
如有冲突，显示"解决冲突"按钮
```

### 冲突解决流程

```
用户点击"解决冲突"
  ↓
弹出 ConflictResolveModal
  ↓
用户对每个冲突做出选择：
  - 使用GitLab版本
  - 保留OSS版本
  - 删除文件
  ↓
点击"确认解决"
  ↓
调用 /api/project-docs/:projectCode/resolve-conflicts
  ↓
后端批量处理：
  - 操作 OSS 文件和元数据
  - 更新数据库
  ↓
返回处理结果
  ↓
前端刷新文档列表
  ↓
冲突解决完成
```

## 🗂️ 文件清单

### 后端文件

```
server/api/project-docs/[projectCode]/
├── gitlab-sync.get.ts          # 同步接口（调用Account API）
├── resolve-conflicts.post.ts   # 批量解决冲突（新建）
├── use-gitlab-version.post.ts  # 使用GitLab版本
├── ignore-conflict.post.ts     # 忽略冲突
└── files.get.ts                # 获取文档列表（读取冲突状态）
```

### 前端文件

```
app/
├── pages/projects/index.vue              # 项目文档管理页面（修改）
├── components/projects/
│   └── ConflictResolveModal.vue         # 冲突解决弹窗（修改）
├── stores/projectDocs.ts                # 项目文档Store
└── types/projectDocs.ts                 # 类型定义（修改）
```

### 数据库迁移

```
sql/migrations/
└── 20260124_remove_conflict_fields.sql  # 删除冲突相关字段
```

## ✅ 实现完成

- [x] 创建 resolve-conflicts 批量接口
- [x] 修复前端冲突检测逻辑（从OSS元数据读取）
- [x] 修复冲突按钮收集逻辑
- [x] 更新类型定义
- [x] 修复模态窗口可访问性警告
- [x] 数据库迁移脚本（删除废弃字段）

## 🧪 测试要点

### 1. 同步测试

- [ ] 新文件能正确插入数据库
- [ ] 更新文件能正确更新 content_size
- [ ] 冲突文件不会插入数据库
- [ ] OSS 元数据正确设置

### 2. 冲突检测测试

- [ ] 文档列表正确显示冲突状态
- [ ] "解决冲突"按钮在有冲突时显示
- [ ] 冲突文档正确收集到弹窗中

### 3. 冲突解决测试

- [ ] 使用GitLab版本：文件内容正确覆盖
- [ ] 忽略冲突：文件内容保持不变
- [ ] 删除文件：文件和数据库记录正确删除
- [ ] 元数据正确更新（conflict-status = '0'）
- [ ] temp 文件正确删除

### 4. UI测试

- [ ] 冲突弹窗正确显示
- [ ] diff 正确显示
- [ ] 操作反馈清晰
- [ ] 无可访问性警告

## 📚 参考文档

- [Account-API.md](./Account-API.md) - Account 模块 API 文档
- [GitLab-OSS-Sync-Logic.md](./GitLab-OSS-Sync-Logic.md) - 同步逻辑详解
- [Conflict-Ignore-Feature.md](./Conflict-Ignore-Feature.md) - 冲突忽略功能
- [Metadata-Structure.md](./Metadata-Structure.md) - 元数据结构
- [Document-System-Integration.md](./Document-System-Integration.md) - 集成指南

## 🐛 已知问题

无

## 🔮 后续优化

1. 添加批量操作进度显示
2. 添加冲突历史记录
3. 优化diff显示效果
4. 添加更多错误处理

---

**维护者**: 开发团队
**版本**: 1.0
**状态**: ✅ 已完成
