# 文档系统集成指南

本文档说明文档系统如何与GitLab文档同步功能集成。

## 📋 快速开始

### 1. 打开文档时检测冲突

```typescript
async function openDocument(ossPath: string) {
  // 获取文件和元数据
  const file = await ossClient.head(ossPath)
  const content = await ossClient.get(ossPath)
  const meta = file.meta

  // 检测冲突
  if (meta['conflict-status'] === '1') {
    showConflictBanner({
      gitlabSize: meta['gitlab-latest-size'],
      actions: ['查看差异', '使用GitLab版本', '忽略', '稍后']
    })
  }

  // 渲染文档
  renderDocument(content)
}
```

### 2. 查看差异

```typescript
async function viewDiff(ossPath: string) {
  // diff文件路径：temp目录 + .diff后缀
  const diffPath = ossPath.replace(
    /^codocs\/git-projects\/([^\/]+)\//,
    '$1/temp/'
  ) + '.diff'

  const diffContent = await ossClient.get(diffPath)
  showDiffModal(diffContent.toString())
}
```

### 3. 使用GitLab版本

```typescript
async function useGitLabVersion(ossPath: string, projectCode: string) {
  const response = await fetch(
    `/api/v1/projects/${projectCode}/use-gitlab-version`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify({
        uid: currentUser,
        oss_path: ossPath
      })
    }
  )

  const result = await response.json()

  if (result.code === 0) {
    showToast('已更新为GitLab版本')
    reloadDocument()  // 重新加载文档（内容已改变）
  }
}
```

**说明**：此操作会覆盖OSS文件内容，适用于GitLab版本更优的情况。

---

### 4. 忽略冲突

```typescript
async function ignoreConflict(ossPath: string, projectCode: string) {
  const response = await fetch(
    `/api/v1/projects/${projectCode}/ignore-conflict`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify({
        uid: currentUser,
        oss_path: ossPath
      })
    }
  )

  const result = await response.json()

  if (result.code === 0) {
    showToast('已忽略此次更新')
    hideConflictBanner()  // 隐藏冲突提示
    // 注意：文档内容未改变，无需重新加载
  }
}
```

**说明**：此操作保留OSS文件内容，适用于OSS版本更优的情况。

---

## 💡 操作选择建议

### 何时使用GitLab版本？

- ✅ GitLab版本包含重要更新
- ✅ OSS的修改是临时性的
- ✅ 团队协作时，需要统一到GitLab版本
- ✅ OSS修改有误，需要回退

**示例场景**：
```
开发者在GitLab修复了文档中的错误
→ OSS编辑只是添加了一些注释
→ 应该使用GitLab版本，然后重新添加注释
```

### 何时忽略冲突？

- ✅ OSS版本包含重要的编辑改进
- ✅ GitLab的更新不重要或可以稍后合并
- ✅ 编辑工作尚未完成
- ✅ 需要保留OSS的修改

**示例场景**：
```
编辑在OSS上重新组织了文档结构
→ GitLab只是修改了一个链接
→ 应该忽略GitLab更新，稍后手动合并链接修改
```

### 何时手动合并？

- ✅ 双方都有重要修改
- ✅ 需要综合两边的优点
- ✅ 修改内容较复杂

**操作流程**：
```typescript
// 1. 查看差异
const diff = await viewDiff(ossPath)

// 2. 在OSS中手动修改，合并GitLab的改动

// 3. 保存后，提交到GitLab
await submitToGitLab(ossPath, projectCode, '合并GitLab更新')

// 4. 系统会自动：
//    - 更新GitLab仓库
//    - 更新OSS元数据
//    - conflict-status → '0'
```

---

## 🎨 UI设计建议

### 冲突提示横幅

```html
<div class="conflict-banner">
  <div class="icon">⚠️</div>
  <div class="message">
    <strong>GitLab有更新</strong>
    <span>GitLab版本大小: 2048 bytes</span>
  </div>
  <div class="actions">
    <button onclick="viewDiff()">查看差异</button>
    <button onclick="useGitLabVersion()">使用GitLab版本</button>
    <button onclick="ignoreConflict()">忽略</button>
    <button onclick="hideBanner()">稍后处理</button>
  </div>
</div>
```

### Diff查看器

建议使用现成的diff库：
- [vue-diff](https://github.com/hoiheart/vue-diff)
- 或直接显示unified diff格式

## 📡 API接口汇总

### 检测冲突（无需调用接口）

直接读取OSS文件元数据即可：

```typescript
const file = await ossClient.head(ossPath)
const hasConflict = file.meta['conflict-status'] === '1'
```

### 查看差异（无需调用接口）

直接读取diff文件：

```typescript
const diffPath = `${tempPath}.diff`
const diffContent = await ossClient.get(diffPath)
```

### 使用GitLab版本

```typescript
POST /api/v1/projects/{project_code}/use-gitlab-version
{
  "uid": "zhangsan",
  "oss_path": "xxx/README.md"
}
```

### 忽略冲突

```typescript
POST /api/v1/projects/{project_code}/ignore-conflict
{
  "uid": "zhangsan",
  "oss_path": "xxx/README.md"
}
```

### 手动同步（可选）

```typescript
GET /api/v1/projects/{project_code}/gitlab-sync-docs
```

### 提交到GitLab

```typescript
POST /api/v1/projects/{project_code}/gitlab-submit-docs
{
  "uid": "zhangsan",
  "message": "更新文档",
  "docs": [
    {
      "oss_path": "xxx/README.md",
      "gitlab_path": "README.md"
    }
  ]
}
```

## 🔄 完整流程示例

### 场景1：文档有冲突

```typescript
// 1. 打开文档
const doc = await openDocument('xxx/README.md')

// 2. 检测到冲突
if (doc.meta['conflict-status'] === '1') {
  // 3. 显示提示
  showConflictBanner()

  // 4. 用户点击"查看差异"
  const diff = await viewDiff(doc.path)
  showDiffModal(diff)

  // 5. 用户决策
  // 选项A: 使用GitLab版本
  await useGitLabVersion(doc.path, projectCode)
  // → OSS文件被覆盖
  // → 需要重新加载文档
  reloadDocument()

  // 选项B: 忽略
  await ignoreConflict(doc.path, projectCode)
  // → OSS文件不变
  // → 只需隐藏提示
  hideConflictBanner()

  // 选项C: 手动合并后提交到GitLab
  // ... 用户手动编辑合并 ...
  await submitToGitLab(doc.path, projectCode, '合并GitLab更新')
}
```

### 场景2：正常编辑文档

```typescript
// 1. 打开文档
const doc = await openDocument('xxx/README.md')

// 2. 无冲突，正常编辑
if (doc.meta['conflict-status'] === '0') {
  // 编辑...

  // 3. 保存到OSS
  await ossClient.put(doc.path, newContent)

  // 4. (可选) 提交到GitLab
  await submitToGitLab(doc.path, projectCode)
}
```

## 🏷️ 元数据字段参考

| 字段                      | 类型   | 说明                 | 示例                   |
| ------------------------- | ------ | -------------------- | ---------------------- |
| `gitlab-commit-id`        | string | OSS当前版本的commit  | `abc123...`            |
| `gitlab-latest-commit-id` | string | GitLab最新commit     | `def456...`            |
| `gitlab-latest-size`      | string | GitLab版本大小(字节) | `2048`                 |
| `oss-last-modified`       | string | OSS上传时间          | `Fri, 24 Jan 2026...`  |
| `synced-at`               | string | 同步时间(UTC)        | `2026-01-24T18:00:00Z` |
| `conflict-status`         | string | 冲突状态             | `'0'` 或 `'1'`         |

## ⚠️ 注意事项

### 1. 冲突检测时机

推荐在以下时机检测冲突：
- 打开文档时
- 保存文档前
- 用户点击"检查更新"时

### 2. 性能优化

```typescript
// 批量检测多个文档
async function checkMultipleDocuments(paths: string[]) {
  const results = await Promise.all(
    paths.map(path => ossClient.head(path))
  )

  return results.filter(
    file => file.meta['conflict-status'] === '1'
  )
}
```

### 3. 错误处理

```typescript
try {
  await useGitLabVersion(ossPath, projectCode)
} catch (error) {
  if (error.status === 404) {
    showError('临时文件不存在，可能已被处理')
  } else {
    showError('操作失败: ' + error.message)
  }
}
```

### 4. 用户体验建议

- ✅ 冲突提示应醒目但不打断编辑
- ✅ 提供"稍后处理"选项
- ✅ 差异显示应清晰易读
- ✅ 操作后给予明确反馈
- ✅ 支持键盘快捷键操作

## 🔗 相关文档

- [GitLab-OSS-Sync-Logic.md](./GitLab-OSS-Sync-Logic.md) - 同步逻辑详解
- [GitLab-Webhook-Setup.md](./GitLab-Webhook-Setup.md) - Webhook配置
- [Conflict-Ignore-Feature.md](./Conflict-Ignore-Feature.md) - 冲突忽略功能
- [API.md](./API.md) - 完整API文档

---

**文档版本**: 1.0
**最后更新**: 2026-01-24
**维护者**: 开发团队
