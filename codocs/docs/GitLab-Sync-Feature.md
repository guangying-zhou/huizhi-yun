# GitLab 项目文档同步功能

## 功能概述

实现项目文档在 GitLab（版本控制）和 OSS（协作编辑）之间的双向同步。

### 三个核心 API

1. **4.7 从 GitLab 同步到 OSS** - `GET /api/v1/projects/{project_code}/gitlab-sync-docs`
   - 读取 GitLab 仓库的 README.md 和 /docs/*.md 文件
   - 同步到 OSS `{project_code}/` 目录
   - 智能检测冲突和删除

2. **4.8 解决冲突** - `POST /api/v1/projects/{project_code}/resolve-conflicts`
   - 处理同步时发现的冲突文件
   - 支持选择 GitLab 版本或 OSS 版本
   - 处理已删除文件

3. **4.9 提交到 GitLab** - `POST /api/v1/projects/{project_code}/gitlab-submit-docs`
   - 将 OSS 中编辑的文档提交回 GitLab 仓库
   - 记录提交信息和提交者

## 数据库变更

### 执行迁移

```bash
mysql -u root -p hzy_codocs < sql/migrations/20260124_add_documents_fields.sql
```

### 新增字段

**documents 表**（本地 Codocs 数据库）
- `project_code` - 所属项目 ID（VARCHAR，匹配 Account API）
- `gitlab_commit_id` - GitLab 提交 ID
- `gitlab_committer` - GitLab 提交者
- `gitlab_deleted` - GitLab 删除标志
- `oss_commit_id` - OSS 提交 ID
- `diff` - 差异内容（用于冲突展示）
- `committed_at` - 提交时间

**git_projects 表**（Account 模块管理，无需本地修改）
- `docs_synced_at` - 文档最后同步时间（由 Account API 维护）
- `docs_committed_at` - 文档最后提交时间（由 Account API 维护）

## 前端实现

### 新增文件

1. **API 路由**
   - `server/api/project-docs/[projectCode]/gitlab-sync.get.ts` - 同步接口
   - `server/api/project-docs/[projectCode]/resolve-conflicts.post.ts` - 解决冲突
   - `server/api/project-docs/[projectCode]/gitlab-submit.post.ts` - 提交接口

2. **组件**
   - `app/components/projects/ConflictResolveModal.vue` - 冲突解决弹窗

3. **更新文件**
   - `app/types/projectDocs.ts` - 类型定义
   - `app/stores/projectDocs.ts` - 状态管理
   - `app/pages/projects/index.vue` - 项目文档页面

## 使用流程

### 1. 初次同步

1. 在项目列表选择一个配置了 GitLab 仓库的项目
2. 点击「从 GitLab 同步」按钮
3. 系统自动从 GitLab 拉取文档到 OSS

### 2. 处理冲突

如果同步时发现冲突：
1. 系统显示「解决冲突」按钮
2. 点击后弹出冲突解决弹窗
3. 逐个文件选择使用 GitLab 版本或 OSS 版本
4. 对于已删除的文件，选择是否同步删除
5. 点击「确认解决」完成

### 3. 编辑和提交

1. 在 OSS 中编辑文档
2. 修改后的文件会显示「变更」标记
3. 点击「提交到 GitLab」按钮
4. 系统将变更的文件推送回 GitLab 仓库

## 同步逻辑说明

### 从 GitLab 同步到 OSS

- **new[]** - GitLab 有，OSS 没有 → 直接创建
- **nochange[]** - 两边一致（MD5 匹配）→ 跳过
- **conflict[]** - 两边都有但内容不同 → 需要解决
- **delete[]** - OSS 有，GitLab 没有 → 标记待删除

### 文件匹配规则

- 通过文件路径匹配
- GitLab 路径：`README.md`, `docs/xxx.md`
- OSS 路径：`{project_code}/README.md`, `{project_code}/docs/xxx.md`

### 冲突检测

- 使用文件 MD5 与 OSS ETag 比较
- 不同则判定为冲突
- 冲突文件暂存到 `{project_code}/temp/`

## 注意事项

1. **权限要求**
   - 同步和提交操作仅对项目管理者开放
   - 项目成员只能查看文档

2. **必要配置**
   - 项目必须配置 `repoUrl`（GitLab 仓库地址）
   - Account API 需要配置 `GITLAB_BOT_USERNAME` 和 `GITLAB_BOT_TOKEN`

3. **提交限制**
   - 只提交相对于上次提交有变更的文件
   - 基于 `docsCommittedAt` 时间戳判断

4. **数据一致性**
   - 同步后自动更新 `docs_synced_at`
   - 提交后自动更新 `docs_committed_at`
   - 记录每个文档的 GitLab commit 信息

## 故障排除

### 同步失败

- 检查项目的 `repoUrl` 是否正确
- 确认 Account API 的 GitLab 凭证是否有效
- 查看服务器日志获取详细错误

### 冲突无法解决

- 确保选择了所有冲突文件的处理方式
- 检查网络连接和 OSS 访问权限

### 提交失败

- 确认当前用户是项目管理者
- 检查是否有待提交的文件（`docsCommittedAt` 之后修改的）
- 验证 GitLab 仓库写权限
