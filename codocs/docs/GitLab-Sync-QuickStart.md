# GitLab 同步功能 - 快速开始

> **当前事实边界（2026-07-11 核对）**：本文记录旧版 GitLab 同步流程，不能作为当前可执行手册。当前 GitLab 集成必须经 Foundation Git integration 和 Console 受管 integration-config/credential-vault 消费，业务应用不保存 GitLab Bot 凭据、不直连 Account，也不从本地 env 读取静态 token。Codocs 尚未为本旧同步数据链补齐专用 tenant-runtime 合同的路径应失败关闭（503），不得以本文的 Account API 或本地 MySQL 步骤绕过。以 `codocs/CLAUDE.md`、`docs/MODULE_CONTRACTS.md`、`docs/ENV_SIMPLIFICATION_PLAN.md` 与当前代码为准；执行真实同步、迁移、凭据或外部 GitLab 操作需单独授权。

## 📋 前置条件

1. 数据库迁移
```bash
mysql -u root -p hzy_codocs < sql/migrations/20260124_add_documents_fields.sql
```

2. Account API 已配置 GitLab Bot 凭证
   - `GITLAB_BOT_USERNAME`
   - `GITLAB_BOT_TOKEN`

3. 项目已在 Account 模块配置 GitLab 仓库地址 (`repoUrl`)

## 🚀 功能流程

### 1️⃣ 初次同步

```
项目列表 → 选择项目 → 点击「从 GitLab 同步」
```

**结果：**
- ✅ 新增文件直接导入
- ⚠️ 有冲突显示「解决冲突」按钮

### 2️⃣ 解决冲突

```
点击「解决冲突」→ 选择版本 → 确认解决
```

**选项：**
- 🟢 使用 GitLab 版本 - 覆盖 OSS 文件
- 🔵 保留 OSS 版本 - 丢弃 GitLab 更新
- 🗑️ 删除文件 - 同步 GitLab 的删除操作

### 3️⃣ 编辑与提交

```
在线编辑文档 → 点击「提交到 GitLab」
```

**自动识别：**
- 只提交有变更的文件（基于 `docsCommittedAt` 时间戳）
- 显示待提交文件数量

## 🔧 API 端点

### 后端调用 Account API

```typescript
// 1. 同步
GET /api/v1/projects/{projectCode}/gitlab-sync-docs

// 2. 解决冲突
POST /api/v1/projects/{projectCode}/resolve-conflicts
Body: { uid, docs: [{ oss_path, use_gitlab?, delete? }] }

// 3. 提交
POST /api/v1/projects/{projectCode}/gitlab-submit-docs
Body: { uid, docs: [{ oss_path, gitlab_path }] }
```

### 前端调用 Nuxt API

```typescript
// 1. 同步
GET /api/project-docs/{projectCode}/gitlab-sync

// 2. 解决冲突
POST /api/project-docs/{projectCode}/resolve-conflicts

// 3. 提交
POST /api/project-docs/{projectCode}/gitlab-submit
```

## 📊 数据库字段说明

### `documents` 表（本地 Codocs 数据库）
- `project_code` - 所属项目 ID（引用 Account API 的项目）
- `gitlab_commit_id` - GitLab 提交 ID
- `gitlab_committer` - 提交者
- `gitlab_deleted` - GitLab 删除标志
- `oss_commit_id` - OSS 提交 ID
- `diff` - 冲突时的差异内容
- `committed_at` - 提交时间

### `git_projects` 表（Account 模块管理）
- `docs_synced_at` - 最后同步时间（由 Account API 自动更新）
- `docs_committed_at` - 最后提交时间（由 Account API 自动更新）

## 🎨 UI 说明

### 项目列表
- 已同步项目显示 ✅ "已同步" 标记

### 工具栏
- **从 GitLab 同步** - 拉取最新文档
- **解决冲突** - 有冲突时显示（橙色）
- **提交到 GitLab** - 推送变更（显示文件数）

### 冲突弹窗
- 左侧：冲突文件列表
  - 🟢 已选择 GitLab 版本
  - 🔵 已选择 OSS 版本
  - ⚠️ 未处理
- 右侧：详情和决策按钮

## ⚡ 快速测试

```bash
# 使用测试脚本
./scripts/test-gitlab-sync.sh

# 或手动测试
curl http://localhost:3000/api/project-docs/your-project-id/gitlab-sync
```

## 🐛 故障排除

### 同步按钮不显示
- ✅ 检查项目是否配置了 `repoUrl`
- ✅ 确认当前用户是项目管理者

### 同步失败
- 📝 查看浏览器控制台错误
- 📝 检查服务器日志
- 📝 验证 GitLab Bot 凭证

### 无法提交
- ✅ 确认有待提交的文件（修改时间晚于 `docsCommittedAt`）
- ✅ 检查 GitLab 仓库写权限

## 📚 相关文档

- 详细说明：`docs/GitLab-Sync-Feature.md`
- API 文档：`docs/Account-API.md` (Section 4.7-4.9)
- 数据库 Schema：`docs/codocs_schema.sql`
