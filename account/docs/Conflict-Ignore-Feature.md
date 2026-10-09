# 冲突忽略功能说明

## 📋 概述

当GitLab有更新且OSS文件被修改时会产生冲突。用户可以选择"忽略"此次冲突，系统会标记该冲突已处理，不再提示。

## 🔄 状态流转

```
┌─────────────────────────────────────────────┐
│ 正常状态                                     │
│ conflict-status: 0                           │
│ gitlab-commit-id == gitlab-latest-commit-id  │
└─────────────────────────────────────────────┘
                   ↓
        GitLab有新提交 + OSS被修改
                   ↓
┌─────────────────────────────────────────────┐
│ 冲突状态                                     │
│ conflict-status: 1                           │
│ gitlab-commit-id != gitlab-latest-commit-id  │
│ ├─ temp/{file} (GitLab版本)                 │
│ └─ temp/{file}.diff (差异文件)              │
└─────────────────────────────────────────────┘
                   ↓
              用户操作
                   ↓
      ┌────────────┴────────────┐
      │                         │
  [使用GitLab]            [忽略冲突]
      │                         │
      ↓                         ↓
  覆盖OSS文件           保留OSS文件
  status → 0            status → 0
  删除temp              删除temp
      │                         │
      └────────────┬────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│ 已处理状态                                   │
│ conflict-status: 0                           │
│ gitlab-commit-id: 当前版本                   │
│ gitlab-latest-commit-id: 当前版本            │
└─────────────────────────────────────────────┘
                   ↓
        GitLab再次有新提交
                   ↓
        重新检测 → conflict-status: 1
```

## 🏷️ 元数据字段说明

### conflict-status

```typescript
'conflict-status': '0' | '1'

// 0 - 无冲突或已处理
//   - 正常状态
//   - 用户选择"使用GitLab版本"
//   - 用户选择"忽略冲突"

// 1 - 存在未处理的冲突
//   - GitLab有新提交
//   - OSS文件被修改
//   - 需要用户决策
```

### 完整元数据示例

```typescript
// 冲突状态
meta: {
  'gitlab-commit-id': 'abc123',        // OSS当前版本
  'gitlab-latest-commit-id': 'def456',  // GitLab最新版本
  'gitlab-latest-size': '2048',
  'oss-last-modified': 'Fri, 24 Jan...',
  'synced-at': '2026-01-24T18:00:00Z',
  'conflict-status': '1'  // ⚠️ 存在冲突
}

// 忽略后的状态
meta: {
  'gitlab-commit-id': 'abc123',        // 保持不变
  'gitlab-latest-commit-id': 'abc123',  // ✅ 设置为当前版本
  'gitlab-latest-size': '1024',
  'oss-last-modified': 'Fri, 24 Jan...',
  'synced-at': '2026-01-24T18:05:00Z',
  'conflict-status': '0'  // ✅ 已忽略
}
```

## 📡 API接口

### POST /api/v1/projects/{project_code}/ignore-conflict

忽略指定文件的冲突。

**请求体：**

```json
{
  "uid": "zhangsan",
  "oss_path": "xxx/README.md"
}
```

**响应：**

```json
{
  "code": 0,
  "message": "Conflict ignored successfully",
  "data": {
    "oss_path": "xxx/README.md",
    "conflict_status": "0"
  }
}
```

**操作效果：**

1. 更新元数据：
   - `gitlab-latest-commit-id` = `gitlab-commit-id`
   - `conflict-status` = '0'

2. 删除临时文件：
   - `temp/{file}`
   - `temp/{file}.diff`

## 💻 文档系统集成

### 检测冲突状态

```typescript
async function checkConflict(ossPath: string) {
  const file = await ossClient.head(ossPath)
  const meta = file.meta

  // 方法1：通过conflict-status判断
  if (meta['conflict-status'] === '1') {
    showConflictAlert()
    return
  }

  // 方法2：通过commit-id判断（兼容旧数据）
  const hasConflict =
    meta['gitlab-commit-id'] !== meta['gitlab-latest-commit-id']

  if (hasConflict) {
    showConflictAlert()
  }
}
```

### 用户操作示例

```typescript
// 文档系统UI
function showConflictAlert() {
  const actions = [
    {
      label: '查看差异',
      onClick: () => viewDiff(ossPath)
    },
    {
      label: '使用GitLab版本',
      onClick: () => useGitLabVersion(ossPath)
    },
    {
      label: '忽略此次冲突',  // 🆕
      onClick: () => ignoreConflict(ossPath)
    },
    {
      label: '稍后处理',
      onClick: () => closeAlert()
    }
  ]

  showAlert({
    title: '文档有冲突',
    message: `GitLab有更新 (${meta['gitlab-latest-size']} bytes)`,
    actions
  })
}

// 忽略冲突
async function ignoreConflict(ossPath: string) {
  await fetch(`/api/v1/projects/${projectCode}/ignore-conflict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uid: currentUser,
      oss_path: ossPath
    })
  })

  showToast('冲突已忽略，保留当前OSS版本')
  hideConflictAlert()
}
```

## 🔄 与其他操作的关系

### 1. 使用GitLab版本

调用 `use-gitlab-version` 接口：

```typescript
{
  uid: "zhangsan",
  oss_path: "..."
}
```

**操作流程**：
1. 从temp目录复制GitLab版本到主文件位置（**覆盖OSS内容**）
2. 更新元数据：
   - `gitlab-commit-id` = `gitlab-latest-commit-id`（更新为GitLab版本）
   - `synced-last-modified` = 新文件的lastModified
   - `conflict-status` = '0'
3. 删除temp文件和diff文件

**结果**：
- ✅ OSS文件内容被GitLab版本覆盖
- ✅ `conflict-status` → '0'
- ✅ 元数据更新为GitLab最新版本

---

### 2. 忽略冲突

调用 `ignore-conflict` 接口：

```typescript
{
  uid: "zhangsan",
  oss_path: "..."
}
```

**操作流程**：
1. **不修改OSS文件内容**（保留用户编辑的版本）
2. 更新元数据：
   - `gitlab-commit-id` = `gitlab-latest-commit-id`（标记为已处理）
   - `synced-last-modified` = 当前的lastModified（保持不变）
   - `conflict-status` = '0'
3. 删除temp文件和diff文件

**结果**：
- ✅ OSS文件内容不变
- ✅ `conflict-status` → '0'
- ✅ 标记为已处理，下次GitLab无新提交时不再提示

---

### 3. 两者对比

| 对比项                   | 使用GitLab版本       | 忽略冲突               |
| ------------------------ | -------------------- | ---------------------- |
| **OSS文件内容**          | 被覆盖为GitLab版本 ✏️ | 保持不变 ✅             |
| **gitlab-commit-id**     | 更新为latest         | 更新为latest           |
| **synced-last-modified** | 新文件的lastModified | 当前文件的lastModified |
| **conflict-status**      | 0                    | 0                      |
| **temp文件**             | 删除                 | 删除                   |
| **适用场景**             | GitLab版本更优       | OSS版本更优            |

**共同点**：
- 都会将 `gitlab-commit-id` 设置为 `gitlab-latest-commit-id`
- 都会将 `conflict-status` 设置为 '0'
- 都会删除temp目录下的临时文件

**核心区别**：
- **使用GitLab版本**：接受GitLab的修改，覆盖OSS
- **忽略冲突**：保留OSS的修改，拒绝GitLab更新

---

### 4. 提交到GitLab

调用 `gitlab-submit-docs` 接口，将OSS版本提交回GitLab

结果：
- GitLab被更新
- 产生新的commit
- `conflict-status` → '0'
- commit-id都更新为新版本

## ⏭️ 后续GitLab提交

### 场景：忽略后再有新提交

```
初始状态:
  gitlab-commit-id: abc123
  gitlab-latest-commit-id: abc123  (已忽略)
  conflict-status: 0

GitLab新提交:
  commit-id: xyz789

Webhook处理:
  检测到 gitlab-commit-id (abc123) != gitlab-latest-commit-id (xyz789)
  → 重新生成冲突
  → conflict-status: 1
  → 生成新的temp文件和diff
```

### 关键逻辑

```typescript
// Webhook中的判断
if (ossCommitId === gitlabLatestCommitId) {
  // 已是最新版本，跳过
  continue
}

// 即使之前被忽略(conflict-status=0)
// 但如果GitLab有新提交，仍然会重新检测冲突
const ossWasModified = ossLastModifiedMeta &&
                        ossLastModifiedMeta !== currentOssLastModified

if (ossWasModified) {
  // 重新标记为冲突
  conflict-status: '1'
}
```

## ✅ 优势

1. **明确的状态管理** - 通过conflict-status字段清晰标记
2. **减少重复提示** - 忽略后不再弹出提示
3. **自动清理** - 删除temp文件节省存储空间
4. **灵活性** - 用户可以稍后再决定是否同步
5. **可追溯** - 通过元数据可以知道文件的处理历史

## ⚠️ 注意事项

### 1. 忽略 ≠ 永久忽略

忽略只是暂时的，下次GitLab有新提交时会重新检测。

### 2. 建议的工作流程

```
发现冲突 → 查看diff → 决策:
  ├─ 差异很小 → 手动合并 → 提交到GitLab
  ├─ GitLab版本更好 → 使用GitLab版本
  ├─ OSS版本更好 → 忽略冲突
  └─ 需要讨论 → 稍后处理（保持冲突状态）
```

### 3. 团队协作建议

- 建立文档修改规范
- GitLab为主要编辑源
- OSS用于临时修改和预览
- 定期将OSS修改提交回GitLab

---

**文档版本**: 1.0
**最后更新**: 2026-01-24
**维护者**: 开发团队
