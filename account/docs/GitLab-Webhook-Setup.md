# GitLab Webhook 配置指南

## 📋 概述

本文档说明如何配置GitLab Webhook，实现GitLab推送事件自动触发文档同步。

## 🔧 配置步骤

### 1. 在GitLab项目中配置Webhook

1. 进入GitLab项目页面
2. 左侧菜单: **Settings** → **Webhooks**
3. 填写配置:

```
URL: https://your-domain.com/api/v1/gitlab/webhook/push
Secret Token: (可选，用于验证请求来源)
Trigger: ✓ Push events
SSL verification: ✓ Enable SSL verification (生产环境推荐)
```

4. 点击 **Add webhook**

### 2. 测试Webhook

在Webhook列表中找到刚添加的webhook，点击 **Test** → **Push events**

查看服务器日志，应该看到：
```
[GitLab Webhook] Received push event
```

## 📡 Webhook工作流程

```
┌────────────────────────────────────────────────────────┐
│ 1. 开发者推送到GitLab                                   │
│    git push origin main                                 │
└────────────────────────────────────────────────────────┘
                         ↓
┌────────────────────────────────────────────────────────┐
│ 2. GitLab触发Webhook                                    │
│    POST /api/v1/gitlab/webhook/push                     │
│    {                                                    │
│      "object_kind": "push",                             │
│      "commits": [...],                                  │
│      "project": {...}                                   │
│    }                                                    │
└────────────────────────────────────────────────────────┘
                         ↓
┌────────────────────────────────────────────────────────┐
│ 3. 服务器处理                                           │
│    - 识别变更的markdown文件                             │
│    - 检查OSS中的对应文件                                │
│    - 判断是否需要更新/冲突                              │
└────────────────────────────────────────────────────────┘
                         ↓
┌────────────────────────────────────────────────────────┐
│ 4. 更新OSS元数据                                        │
│    无冲突: 自动覆盖OSS文件                              │
│    有冲突: 保存到temp目录 + 生成diff文件                │
└────────────────────────────────────────────────────────┘
                         ↓
┌────────────────────────────────────────────────────────┐
│ 5. 文档系统读取元数据                                   │
│    检测到冲突时显示提示和操作按钮                       │
└────────────────────────────────────────────────────────┘
```

## 🏷️ 元数据说明

### OSS文件元数据结构

每个文档文件在OSS中保存以下元数据：

```typescript
meta: {
  // 当前OSS文件对应的GitLab commit
  'gitlab-commit-id': 'abc123...',

  // GitLab仓库最新commit (🆕 Webhook更新)
  'gitlab-latest-commit-id': 'def456...',

  // GitLab最新版本的文件大小 (🆕 Webhook更新)
  'gitlab-latest-size': '2048',

  // OSS上传时的lastModified
  'oss-last-modified': 'Fri, 24 Jan 2026...',

  // 同步时间
  'synced-at': '2026-01-24T17:12:00Z'
}
```

### 冲突检测逻辑

```javascript
// 文档系统读取元数据
const hasConflict =
  meta['gitlab-commit-id'] !== meta['gitlab-latest-commit-id']

if (hasConflict) {
  // 显示冲突提示
  console.log('GitLab有更新:', meta['gitlab-latest-size'], 'bytes')

  // 可以读取diff文件查看差异
  const diffPath = `${ossPath}.diff` // temp目录下
}
```

## 📁 文件组织结构

### 无冲突时（自动更新）

```
{project_code}/
├── README.md                    # 已自动更新为GitLab最新版本
└── docs/
    └── api.md                   # 已自动更新为GitLab最新版本
```

元数据:
```javascript
meta: {
  'gitlab-commit-id': 'def456',        // 已更新
  'gitlab-latest-commit-id': 'def456',  // 一致
  'oss-last-modified': 'Fri, 24 Jan...'
}
```

### 有冲突时

```
{project_code}/
├── README.md                    # 当前OSS版本（用户可能编辑过）
├── docs/
│   └── api.md                   # 当前OSS版本（用户可能编辑过）
└── temp/
    ├── README.md                # GitLab最新版本
    ├── README.md.diff           # 🆕 diff文件
    ├── docs/
    │   ├── api.md               # GitLab最新版本
    │   └── api.md.diff          # 🆕 diff文件
```

主文件元数据:
```javascript
meta: {
  'gitlab-commit-id': 'abc123',        // 旧版本
  'gitlab-latest-commit-id': 'def456',  // 🔴 不一致 - 有冲突！
  'gitlab-latest-size': '2048',
  'oss-last-modified': 'Fri, 24 Jan...'
}
```

## 💻 文档系统集成示例

### 打开文档时检查冲突

```typescript
// 文档系统代码示例
async function openDocument(ossPath: string) {
  // 1. 获取文件头信息（包含元数据）
  const file = await ossClient.head(ossPath)
  const meta = file.meta

  // 2. 检查是否有GitLab更新
  const gitlabCommitId = meta['gitlab-commit-id']
  const gitlabLatestCommitId = meta['gitlab-latest-commit-id']
  const hasGitLabUpdate = gitlabCommitId !== gitlabLatestCommitId

  if (hasGitLabUpdate) {
    const latestSize = meta['gitlab-latest-size']

    // 3. 显示冲突提示
    showConflictAlert({
      message: `GitLab有更新 (${latestSize} bytes)`,
      actions: [
        {
          label: '查看差异',
          onClick: () => viewDiff(ossPath)
        },
        {
          label: '使用GitLab版本',
          onClick: () => useGitLabVersion(ossPath)
        },
        {
          label: '保留OSS版本',
          onClick: () => keepOSSVersion()
        }
      ]
    })
  }

  // 4. 加载文档内容
  const content = await ossClient.get(ossPath)
  renderDocument(content)
}

// 查看差异
async function viewDiff(ossPath: string) {
  // temp目录下有对应的diff文件
  const diffPath = ossPath.replace(
    /^codocs\/git-projects\/([^\/]+)\//,
    '$1/temp/'
  ) + '.diff'

  const diffContent = await ossClient.get(diffPath)
  showDiffViewer(diffContent.toString())
}

// 使用GitLab版本
async function useGitLabVersion(ossPath: string) {
  // 调用冲突解决接口
  await fetch(`/api/v1/projects/${projectCode}/resolve-conflicts`, {
    method: 'POST',
    body: JSON.stringify({
      uid: currentUser,
      docs: [{
        oss_path: ossPath,
        use_gitlab: true
      }]
    })
  })

  // 刷新文档
  location.reload()
}
```

## 🔄 兼容性说明

### 与现有接口的关系

1. **Webhook接口** (`POST /api/v1/gitlab/webhook/push`) - 🆕
   - GitLab推送时自动触发
   - 后台异步处理
   - 更新元数据和temp文件

2. **同步接口** (`GET /api/v1/projects/{id}/gitlab-sync-docs`) - 保留
   - 前端手动触发
   - 同步返回结果
   - 兼容旧版行为

3. **冲突解决** (`POST /api/v1/projects/{id}/resolve-conflicts`) - 保留
   - 用户决策后调用
   - 处理冲突文件

### 推荐工作流程

#### 方案A：完全自动化（推荐）

```
GitLab Push → Webhook → 自动处理
                ↓
        文档系统读元数据 → 显示冲突提示
                ↓
        用户查看diff → 决策 → 调用resolve-conflicts
```

#### 方案B：手动触发（兼容模式）

```
用户点击"同步" → 调用gitlab-sync-docs → 返回结果
                ↓
        显示冲突列表 → 用户决策 → 调用resolve-conflicts
```

## ⚠️ 注意事项

### 1. Webhook可靠性

- Webhook可能因网络问题失败
- 建议设置重试机制（GitLab默认支持）
- 可添加定时任务作为兜底（每小时检查一次）

### 2. 大量文件推送

- 一次推送100+文件时，处理可能较慢
- Webhook接口会异步处理，立即返回
- 建议添加处理进度查询接口（可选）

### 3. 安全性

- 生产环境建议配置Secret Token
- 验证请求来源的IP地址
- 使用HTTPS加密传输

### 4. 性能优化

- Webhook处理可以放入消息队列（Redis/RabbitMQ）
- 使用Worker进程并发处理
- 限制并发数量避免OSS API限流

## 🔍 调试

### 查看Webhook日志

服务器日志会输出详细信息：

```
[GitLab Webhook] Received push event
[GitLab Webhook] Changed markdown files: [ 'README.md', 'docs/api.md' ]
[GitLab Webhook] Processing README.md
[GitLab Webhook] Auto updated README.md
[GitLab Webhook] Processing docs/api.md
[GitLab Webhook] Conflict detected for docs/api.md
[GitLab Webhook] Processing complete: { total: 2, updated: 1, conflicts: 1 }
```

### GitLab Webhook日志

在GitLab项目的 **Settings** → **Webhooks** 中，可以查看每次触发的：
- 请求内容
- 响应状态
- 错误信息（如果有）

---

**文档版本**: 1.0
**最后更新**: 2026-01-24
**维护者**: 开发团队
