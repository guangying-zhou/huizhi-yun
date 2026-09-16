# GitLab 文档同步接口实现说明

## 概述

根据 API.md 文档的 4.7 和 4.8 接口定义，已实现了以下两个接口：

### 4.7 从 GitLab 同步项目文档到 OSS

**接口路径**: `GET /api/v1/projects/{project_code}/gitlab-sync-docs`

**功能描述**:
- 从 GitLab 仓库读取 README.md 和 /docs 目录下的 markdown 文件
- 将文件转存到 OSS 的 `{gitlab_project_path}/` 目录下
  - 例如：`https://gitlab.wiztek.cn/huizhi-yun/account` → `huizhi-yun/account/`
- 检查文件是否已存在，存在则跳过，只上传新文件
- 返回已存在和新增的文件列表
- 成功后更新项目的 `docs_synced_at` 时间戳

**实现文件**: `server/api/v1/projects/[project_code]/gitlab-sync-docs.get.ts`

### 4.8 提交项目文档到 GitLab

**接口路径**: `POST /api/v1/projects/{project_code}/gitlab-submit-docs`

**功能描述**:
- 从 OSS 读取指定的文档文件
- 通过 GitLab API 提交到对应的仓库
- 自动判断文件是创建还是更新操作
- 使用指定用户的真实姓名和邮箱作为提交作者
- 自动生成以 `docs(bot):` 开头的 commit message
- 返回提交的 commit ID 和 revision
- 成功后更新项目的 `docs_committed_at` 时间戳

**实现文件**: `server/api/v1/projects/[project_code]/gitlab-submit-docs.post.ts`

## 技术实现细节

### 依赖配置

接口依赖以下环境变量（在 `.env.dev` 中配置）：
- `GITLAB_BASE_URL`: GitLab 服务器地址
- `GITLAB_BOT_TOKEN`: GitLab Bot 的访问令牌
- `GITLAB_BOT_USERNAME`: GitLab Bot 用户名
- `GITLAB_BOT_EMAIL`: GitLab Bot 邮箱
- `ALIYUN_OSS_*`: 阿里云 OSS 相关配置

### 核心功能

#### 1. GitLab 项目路径提取
从项目的 `repo_url` 字段提取 GitLab 项目路径：
```
http://gitlab.wiztek.cn/group/project.git → group/project
https://gitlab.wiztek.cn/group/project → group/project
```

#### 2. 默认分支检测
在执行任何文件操作前，首先通过 GitLab API 获取项目信息，自动识别默认分支（main 或 master）：
```typescript
GET /api/v4/projects/{project_path}
// 从返回的 default_branch 字段获取分支名
```

#### 3. 文件同步逻辑 (4.7)
1. 查询项目信息获取 `repo_url`
2. 提取 GitLab 项目路径（如 `huizhi-yun/account`）
3. 获取 GitLab 项目的默认分支
4. 调用 GitLab API 获取仓库文件树（递归，支持分页，最多 10 页/1000 项）
5. 筛选 README.md 和 docs/*.md 文件
6. 逐个检查 OSS 中是否存在（路径：`{gitlab_project_path}/{file_path}`）
7. 对不存在的文件，从 GitLab 下载并上传到 OSS
8. 更新项目表的 `docs_synced_at` 字段为当前时间

#### 4. 文档提交逻辑 (4.8)
1. 从请求体中获取 `uid` 参数
2. 查询用户信息获取真实姓名和邮箱
3. 查询项目信息获取 `repo_url`
4. 提取 GitLab 项目路径
5. 获取 GitLab 项目的默认分支
6. 从 OSS 读取要提交的文档内容（路径：`{gitlab_project_path}/{file_path}`）
7. 检查文件在 GitLab 中是否存在，决定是 create 还是 update
8. 构造批量提交（commit）请求，使用用户的真实信息作为作者
9. 生成格式化的 commit message：`docs(bot): Update N file(s)`
10. 通过 GitLab Commits API 一次性提交所有更改
11. 更新项目表的 `docs_committed_at` 字段为当前时间

### API 认证

两个接口都使用标准的 API Key 认证：
```http
Authorization: Bearer {api_key}:{api_secret}
```

### 错误处理

接口实现了完善的错误处理：
- 404: 项目不存在
- 400: 参数错误或配置缺失
- 500: GitLab API 调用失败或 OSS 操作失败

## 使用示例

### 4.7 接口调用

```bash
curl -X GET "https://account.wiztek.cn/api/v1/projects/proj-abc/gitlab-sync-docs" \
  -H "Authorization: Bearer ak_xxx:sk_yyy"
```

**响应示例**:
```json
{
  "code": 0,
  "data": {
    "exists": [
      "README.md",
      "docs/1.md"
    ],
    "new": [
      "docs/2.md"
    ]
  }
}
```

### 4.8 接口调用

```bash
curl -X POST "https://account.wiztek.cn/api/v1/projects/proj-abc/gitlab-submit-docs" \
  -H "Authorization: Bearer ak_xxx:sk_yyy" \
  -H "Content-Type: application/json" \
  -d '{
    "uid": "zhangsan",
    "docs": [
      {
        "name": "README.md",
        "path": "README.md",
        "lastModified": "2022-01-01 00:00:00"
      },
      {
        "name": "docs/1.md",
        "path": "docs/1.md",
        "lastModified": "2022-01-01 00:00:00"
      }
    ]
  }'
```

**响应示例**:
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "revision": "abc1234",
    "commitId": "abc123456789..."
  }
}
```

**Commit Message 格式**:
```
docs(bot): Update 2 file(s)

Files: README.md, docs/1.md

Submitted by: 张三 (zhangsan)
```

## 注意事项

1. **项目必须配置 repo_url**: 接口依赖项目表的 `repo_url` 字段来定位 GitLab 仓库
2. **自动检测默认分支**: 接口会自动获取 GitLab 项目的默认分支（main 或 master），无需手动指定
3. **GitLab API 权限**: Bot Token 需要有仓库的读写权限
4. **OSS 路径规范**:
   - 所有文档存储在 `{gitlab_project_path}/` 目录下
   - 路径基于 GitLab 的项目路径，保持组织结构一致
   - 例如：
     - GitLab 项目：`https://gitlab.wiztek.cn/huizhi-yun/account`
     - GitLab 路径：`huizhi-yun/account`
     - OSS 存储路径：`huizhi-yun/account/README.md`
   - 优势：避免不同组织下同名项目冲突，便于按组织管理文档
5. **批量提交**: 4.8 接口支持一次提交多个文件，通过单个 commit 完成
6. **错误容错**: 如果单个文件处理失败，会继续处理其他文件并记录错误日志
7. **分页处理**: 4.7 接口支持分页获取文件树，最多处理 10 页（1000 个项目），适用于大型仓库
8. **时间戳记录**:
   - 4.7 接口成功后更新项目的 `docs_synced_at` 字段
   - 4.8 接口成功后更新项目的 `docs_committed_at` 字段
   - 方便追踪文档的同步和提交历史
   - 这两个时间戳会在项目查询接口（4.1、4.2）中返回
9. **用户提交模拟**:
   - 4.8 接口使用指定用户的真实姓名和邮箱作为 Git 提交作者
   - 如果用户邮箱为空，自动使用 `{uid}@wiztek.cn` 格式
   - Commit message 自动添加 `docs(bot):` 前缀，便于识别机器人提交

## 测试

已创建测试脚本 `test-gitlab-apis.sh`，可用于本地测试：

```bash
./test-gitlab-apis.sh
```

测试前需要：
1. 在数据库中创建测试项目并设置 repo_url
2. 在 API 管理中创建有效的 API Key
3. 确保 GitLab Bot Token 有效
4. 修改测试脚本中的 API_KEY、API_SECRET 和 project_code

## 文件清单

- `server/api/v1/projects/[project_code]/gitlab-sync-docs.get.ts` - 4.7 接口实现
- `server/api/v1/projects/[project_code]/gitlab-submit-docs.post.ts` - 4.8 接口实现
- `test-gitlab-apis.sh` - 本地测试脚本
- `docs/GitLab-API-Implementation.md` - 本文档
