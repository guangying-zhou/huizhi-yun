# Aims GitLab Issue 与外部任务列表契约

## 目标与边界

Aims 保持工作项事实源；GitLab Issue 是受管的外部执行投影，供 Orca、WebDev 等工具发现和处理任务。GitLab 凭证始终由 Console credential-vault 与固定操作边界使用，不进入浏览器、Aims 数据库或 Aims Worker 环境变量。

## Aims → GitLab Issue

`POST /api/v1/projects/{projectId}/sync-gitlab-issues`

请求体：

```json
{
  "repoProjectCode": "huizhi-yun/huizhiyun",
  "workItemIds": [1, 2]
}
```

- 调用者必须是已登录用户，并具有目标项目的项目经理或 scoped project-admin 更新权限。
- 仓库必须已存在于该项目的 `aims_project_repos`；浏览器不能指定任意仓库或 GitLab 凭证。
- `workItemIds` 可省略；单次最多同步 100 条。
- GitLab Issue 以 `<!-- hzy-aims:item-key={itemKey} -->` 作为稳定绑定标记。已有本地 IID 时先复验标记；标记属于其他工作项时返回冲突，不覆盖外部 Issue。
- Aims `completed` 映射 GitLab `closed`，其他状态映射 `opened`。标题、正文、标签和截止日期在重放时更新。
- 每个写请求使用服务端 SHA-256 幂等键。成功后才写入 `gitlab_issue_links`；部分失败会在响应的 `failures` 中逐项返回，失败项不会写本地链接。

## 外部任务列表

`GET /api/v1/service/tasks`

需要 Console service token：`aud=aims`、`token_use=service`、精确 capability `aims:tasks:read`。接口不维护调用方白名单；是否允许 Orca、WebDev 或其他消费者由 Console service grant 决定。

查询参数：

| 参数 | 说明 |
| --- | --- |
| `projectCodes` | 最多 100 个逗号分隔的稳定项目编码 |
| `statuses` / `status` | `planning,todo,in_progress,in_review,completed` 子集 |
| `assigneeUid` | 精确负责人 UID |
| `cursor` | 上一页返回的不透明游标 |
| `limit` | 1–200，默认 100 |

响应按 `updated_at,id` 升序，包含稳定工作项键、项目/里程碑、父子关系、状态、优先级、负责人、日期、Aims 相对路径，以及最近同步的 GitLab Issue 投影。消费者使用 `hasMore` 与 `nextCursor` 增量读取；不得解析或自行构造 cursor。

## 发布顺序

1. 应用 `aims/docs/migration_v5.13_gitlab_issue_links.sql`。
2. 应用 `console/docs/sql/Console-SQL-Seed-v1.94-aims-gitlab-issues-and-task-feed.sql`。
3. 运行对应 Verify SQL，确认 Aims 获得 `gitlab.issue-upsert`，已登记消费者获得 `aims:tasks:read`。
4. 部署 Console/data-runtime、Foundation 与 Aims 后，以真实服务客户端探测 token 签发、任务分页和 Issue 重放。
