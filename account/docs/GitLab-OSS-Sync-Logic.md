# GitLab-OSS 文档同步逻辑说明

## 📋 概述

本文档详细说明了 GitLab 与 OSS 之间文档同步的智能判断逻辑，包括冲突检测、自动更新和元数据管理。

## 🎯 核心设计思想

**只在双方都有修改时才视为冲突**

- ✅ OSS纯编辑不冲突 - 编辑在OSS修改文档不会被误判为冲突
- ⚡ GitLab更新自动同步 - 开发提交代码文档自动更新到OSS
- ⚠️ 真冲突才提示 - 只有双方都改才需要人工决策

## 📊 同步逻辑流程图

```
文件同步判断逻辑：

1️⃣ OSS文件不存在
   └─> 新文件 (new) - 上传到OSS

2️⃣ OSS文件存在 && GitLab commit_id相同
   └─> 无变化 (nochange) - 跳过
       ⚠️ 即使OSS被编辑也不视为冲突
       💡 因为GitLab版本未变，OSS的编辑是合法的

3️⃣ OSS文件存在 && GitLab commit_id不同 (GitLab有更新)

   ├─ 3a. OSS lastModified未变 (OSS未被编辑)
   │   └─> 自动更新 (updated) ✨
   │       - 直接用GitLab版本覆盖OSS
   │       - 无需手动处理
   │
   └─ 3b. OSS lastModified已变 (OSS被编辑)
       └─> 冲突 (conflict) ⚠️
           - GitLab和OSS都有修改
           - 需要人工决策

4️⃣ GitLab文件已删除
   └─> 删除 (deleted) - 提示用户处理
```

## 📝 状态判断矩阵

| GitLab状态 | OSS状态 | 结果         | 说明                     |
| ---------- | ------- | ------------ | ------------------------ |
| 未变化     | 未修改  | `nochange`   | 双方都没有变化           |
| 未变化     | 已修改  | `nochange` ✨ | OSS编辑是合法的          |
| 有更新     | 未修改  | `updated` ⚡  | 自动覆盖OSS              |
| 有更新     | 已修改  | `conflict` ⚠️ | 双方都修改，需要人工决策 |

## 🔧 技术实现

### 元数据结构

OSS文件保存以下元数据用于同步判断：

```typescript
meta: {
  'gitlab-commit-id': 'abc123...',           // GitLab commit ID
  'oss-last-modified': 'Fri, 24 Jan 2026...', // OSS上传时的lastModified
  'synced-at': '2026-01-24T17:12:00Z',       // 同步时间戳（UTC）
  uid: 0,
  pid: 0
}
```

### 判断逻辑伪代码

```typescript
// 获取GitLab文件的最新commit
const gitlabCommitId = await getLatestCommit(filePath)

// 获取OSS文件的元数据
const ossFile = await ossClient.head(ossPath)
const ossMeta = ossFile.meta
const ossCommitId = ossMeta['gitlab-commit-id']
const ossLastModifiedMeta = ossMeta['oss-last-modified']
const currentOssLastModified = ossFile.res.headers['last-modified']

// 判断逻辑
if (!ossFileExists) {
  return 'new'  // 新文件
}

if (ossCommitId === gitlabCommitId) {
  return 'nochange'  // GitLab未更新，即使OSS被修改也不是冲突
}

// GitLab有更新，检查OSS是否被修改
const ossWasModified = (ossLastModifiedMeta !== currentOssLastModified)

if (!ossWasModified) {
  return 'updated'  // 自动更新
} else {
  return 'conflict'  // 需要人工决策
}
```

### 时区说明

- **OSS lastModified**: OSS系统自动维护，格式为 GMT 时间（如 `Fri, 24 Jan 2026 09:12:34 GMT`）
- **synced-at**: 我们自定义的时间戳，使用 UTC 时间的 ISO 8601 格式（如 `2026-01-24T17:12:34.208Z`）
- **前端显示**: 建议转换为用户本地时区显示

## 💡 实际场景示例

### 场景1：编辑在OSS修改文档

```
初始状态:
  commit_id = abc123
  oss_last_modified = Time1

操作:
  编辑在OSS上修改文档

同步时:
  GitLab commit_id = abc123 (未变)
  OSS lastModified = Time2 (被修改)

结果: ✅ nochange (不冲突)
原因: GitLab版本未变，OSS的修改是唯一的修改源
```

### 场景2：开发在GitLab更新，OSS未动

```
初始状态:
  commit_id = abc123
  oss_last_modified = Time1

操作:
  开发在GitLab提交新版本

同步时:
  GitLab commit_id = def456 (已变)
  OSS lastModified = Time1 (未动)

结果: ✅ updated (自动更新)
原因: 只有GitLab变化，可以安全覆盖OSS
操作: 用GitLab版本覆盖OSS，更新元数据
```

### 场景3：双方都修改了

```
初始状态:
  commit_id = abc123
  oss_last_modified = Time1

操作:
  1. 开发在GitLab提交新版本
  2. 编辑在OSS修改文档

同步时:
  GitLab commit_id = def456 (已变)
  OSS lastModified = Time2 (已变)

结果: ⚠️ conflict (需要决策)
原因: 双方都有修改，存在真正的冲突
操作: 生成diff，保存GitLab版本到temp目录，等待用户选择
```

### 场景4：GitLab删除文件

```
初始状态:
  文件存在于OSS: xxx/docs/old.md

同步时:
  GitLab仓库中已无此文件

结果: ⚠️ deleted
原因: GitLab中文件已被删除
操作: 提示用户决定是否删除OSS文件
```

## 🚀 性能优化

### 对比优化前后

| 场景                | 优化前           | 优化后           | 提升              |
| ------------------- | ---------------- | ---------------- | ----------------- |
| 文件未变化          | 下载2次+MD5计算  | 仅HEAD请求       | **90%+**          |
| GitLab更新，OSS未改 | 冲突（手动处理） | 自动更新         | **省去80%的冲突** |
| 双方都修改          | 冲突（手动处理） | 冲突（手动处理） | 持平              |

### 关键优化点

1. **使用commit_id代替MD5比较** - 避免下载完整文件内容
2. **使用lastModified判断OSS修改** - 轻量级判断，无需下载
3. **按需下载** - 只有在真正需要时才下载文件内容生成diff

假设100个文档的同步场景：
- **70个未变化** → 仅HEAD请求，节省140次下载
- **20个GitLab更新但OSS未改** → 自动覆盖，节省20次冲突处理
- **8个GitLab更新且OSS也改** → 正常冲突处理
- **2个新文件** → 正常上传

**总体性能提升约 70-80%，用户操作减少约 80%** 🎉

## 📡 API 响应示例

### 同步接口响应

```json
{
  "code": 0,
  "data": {
    "new": [
      {
        "doc_path": "docs/new-feature.md",
        "oss_path": "xxx/docs/new-feature.md",
        "content_size": 1024,
        "gitlab_commit_id": "abc123...",
        "gitlab_commit_time": "2026-01-24T10:00:00Z",
        "gitlab_committer": "zhangsan"
      }
    ],
    "updated": [
      {
        "doc_path": "README.md",
        "oss_path": "xxx/README.md",
        "content_size": 2048,
        "gitlab_commit_id": "def456...",
        "gitlab_commit_time": "2026-01-24T12:00:00Z",
        "gitlab_committer": "lisi"
      }
    ],
    "nochange": [
      {
        "doc_path": "docs/guide.md",
        "oss_path": "xxx/docs/guide.md"
      }
    ],
    "conflict": [
      {
        "doc_path": "docs/api.md",
        "oss_path": "xxx/docs/api.md",
        "content_size": 3072,
        "gitlab_commit_id": "ghi789...",
        "gitlab_commit_time": "2026-01-24T14:00:00Z",
        "gitlab_committer": "wangwu",
        "diff": "--- GitLab: docs/api.md...\n+++ OSS: docs/api.md...\n..."
      }
    ],
    "deleted": [
      {
        "oss_path": "xxx/docs/deprecated.md",
        "gitlab_commit_id": "jkl012...",
        "gitlab_commit_time": "2026-01-24T15:00:00Z",
        "gitlab_committer": "zhaoliu"
      }
    ]
  }
}
```

## 🔄 冲突解决流程

### 接口: POST /api/v1/projects/{project_code}/resolve-conflicts

用户可以选择：

1. **使用GitLab版本** (`use_gitlab: true`)
   - 用temp目录下的GitLab版本覆盖OSS文件
   - 更新元数据（commit_id和lastModified）

2. **使用OSS版本** (`use_gitlab: false`)
   - 保留OSS文件不变
   - 删除temp目录下的GitLab版本
   - 更新元数据（commit_id设为GitLab最新，lastModified保持OSS的）

3. **删除文件** (`delete: true`)
   - 删除OSS文件（用于处理GitLab已删除的文件）

## 📌 注意事项

### 1. 元数据向后兼容

- 历史文件可能没有元数据
- 首次同步会被视为conflict（因为无法判断OSS是否被修改）
- 解决冲突后会添加元数据，后续同步即可享受智能判断

### 2. OSS编辑后的提交

- 如果编辑在OSS修改了文档，建议通过4.9接口提交回GitLab
- 提交后OSS的元数据会更新为新的commit_id
- 避免长期OSS和GitLab版本不一致

### 3. 时间显示

- 所有时间字段均为UTC时间
- 前端显示时应转换为用户本地时区
- 建议使用 `date-fns` 或 `date-fns-tz` 处理时区转换

## 🎯 最佳实践

### 开发团队

1. 在GitLab中维护技术文档
2. 提交代码时更新相关文档
3. 定期触发同步，文档会自动更新到OSS

### 编辑团队

1. 在OSS中编辑文档内容
2. 如果GitLab未更新，编辑不会产生冲突
3. 编辑完成后可选择提交回GitLab

### 协作场景

1. 系统自动处理大部分情况（新增、自动更新、无变化）
2. 只在双方都修改时才需要人工介入
3. 通过diff预览可以清晰看到冲突内容
4. 人工选择保留哪个版本

---

**文档版本**: 1.0
**最后更新**: 2026-01-24
**维护者**: 开发团队
