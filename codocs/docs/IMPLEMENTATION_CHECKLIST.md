# GitLab 同步功能实现清单

## ✅ 已完成任务

### 后端实现
- [x] `gitlab-sync.get.ts` - 调用 Account API 4.7，处理同步结果，更新 documents 表
- [x] `resolve-conflicts.post.ts` - 调用 Account API 4.8，更新 documents 表
- [x] `gitlab-submit.post.ts` - 调用 Account API 4.9，更新 committed_at
- [x] 数据库操作：插入新文档、更新冲突、标记删除、更新时间戳

### 前端实现
- [x] `ConflictResolveModal.vue` - 冲突解决弹窗组件
  - [x] 冲突文件列表（conflict + delete）
  - [x] 逐个选择 GitLab/OSS 版本
  - [x] 删除文件勾选
  - [x] Diff 差异显示
  - [x] 提交解决结果
- [x] 更新 `projectDocs.ts` store
  - [x] `syncDocuments()` - 调用同步 API
  - [x] `resolveConflicts()` - 调用冲突解决 API
  - [x] `submitDocuments()` - 更新提交逻辑（oss_path + gitlab_path）
  - [x] `syncResult` 状态管理
- [x] 更新 `project/index.vue` 页面
  - [x] 同步按钮和逻辑
  - [x] 冲突解决按钮（条件显示）
  - [x] 提交按钮更新文案
  - [x] 冲突弹窗集成

### 类型定义
- [x] `GitlabFileInfo` - GitLab 文件信息
- [x] `GitlabSyncResponse` - 同步响应（new/nochange/conflict/delete）
- [x] `ConflictDoc` - 冲突解决文档
- [x] `ResolveConflictsRequest` - 冲突解决请求
- [x] `GitlabSubmitDoc` - 提交文档（更新为 oss_path + gitlab_path）
- [x] `GitlabSubmitResponse` - 提交响应

### 数据库
- [x] 迁移脚本 `20260124_add_documents_fields.sql`
- [x] documents 表字段：project_code, gitlab_commit_id, gitlab_committer, gitlab_deleted, oss_commit_id, diff, committed_at
- [x] 更新 `codocs_schema.sql` 文档
- [x] 注意：projects 表由 Account 模块管理，不在本地修改

### 文档
- [x] `GitLab-Sync-Feature.md` - 完整功能说明
- [x] `GitLab-Sync-QuickStart.md` - 快速开始指南
- [x] `Account-API.md` - 更新 4.7/4.8/4.9 接口文档
- [x] 测试脚本 `test-gitlab-sync.sh`

## 🔍 实现要点

### 后端逻辑
1. ✅ 调用 Account API，不自己实现 GitLab 交互
2. ✅ 处理 Account API 返回的数据结构（new/nochange/conflict/delete）
3. ✅ 根据同步结果更新 documents 表
   - new → INSERT 新记录
   - conflict → UPDATE diff 字段
   - delete → UPDATE gitlab_deleted 标志
4. ✅ 项目的 docs_synced_at 和 docs_committed_at 由 Account API 自动更新

### 前端逻辑
1. ✅ 同步后检查是否有冲突，自动显示冲突解决弹窗
2. ✅ 冲突弹窗支持逐个文件决策
3. ✅ 提交时计算 oss_path 和 gitlab_path 映射
4. ✅ 基于 docsCommittedAt 识别变更文件

### 数据流
```
GitLab → Account API 4.7 → Nuxt API → DB (documents) → UI
UI → Nuxt API → Account API 4.8 → DB (documents)
UI → Nuxt API → Account API 4.9 → DB (documents + git_projects)
```

## 📦 交付文件

### 新增文件（8个）
1. server/api/project-docs/[projectCode]/gitlab-sync.get.ts
2. server/api/project-docs/[projectCode]/resolve-conflicts.post.ts
3. server/api/project-docs/[projectCode]/gitlab-submit.post.ts
4. app/components/projects/ConflictResolveModal.vue
5. sql/migrations/20260124_add_documents_fields.sql
6. docs/GitLab-Sync-Feature.md
7. docs/GitLab-Sync-QuickStart.md
8. scripts/test-gitlab-sync.sh

### 修改文件（6个）
1. app/types/projectDocs.ts - 更新类型定义
2. app/stores/projectDocs.ts - 新增同步方法
3. app/pages/projects/index.vue - 集成 UI
4. docs/Account-API.md - 更新接口文档
5. docs/codocs_schema.sql - 更新数据库结构
6. server/api/project-docs/[projectCode]/files.get.ts - 微调

## 🚀 部署步骤

1. **数据库迁移**
   ```bash
   mysql -u root -p hzy_codocs < sql/migrations/20260124_add_documents_fields.sql
   ```

2. **验证 Account API 配置**
   - 确认 4.7/4.8/4.9 接口可用
   - 验证 GITLAB_BOT_USERNAME 和 GITLAB_BOT_TOKEN
   - 确保项目在 Account 模块已配置 repoUrl

3. **启动应用测试**
   ```bash
   npm run dev
   ```

4. **功能测试**
   - 选择项目 → 同步
   - 处理冲突（如有）
   - 编辑文档 → 提交

## 📝 注意事项

- ✅ 所有 GitLab 交互由 Account API 完成
- ✅ Nuxt 只负责调用 Account API 和更新本地 documents 表
- ✅ git_projects 表由 Account 模块管理，本地不访问
- ✅ 冲突解决是可选的（无冲突直接成功）
- ✅ 提交只处理有变更的文件
- ✅ 权限检查：只有项目管理者可同步/提交

## 🎯 测试建议

1. 无冲突场景：全新项目首次同步
2. 有冲突场景：OSS 和 GitLab 都修改了同一文件
3. 删除场景：GitLab 删除了文件，OSS 还存在
4. 提交场景：OSS 修改后提交到 GitLab

---

实现完成时间：2026-01-24
实现者：GitHub Copilot CLI
