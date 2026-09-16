# AIMS 项目仓库文档列表 404 排障报告

## 问题现象

成果文档选择器切换到“项目仓库文档”时，页面报错：

```text
[GET] https://console.huizhi.yun/api/v1/console/directory/projects/huizhi-yun%2Fhuizhiyun: 404 Not Found
```

## 根因

- Aims `aims_project_repos.repo_project_code` 保存的是 GitLab 仓库完整路径，例如 `huizhi-yun/huizhiyun`。
- 文档树和文件读取路由已通过 Aims runtime 验证“用户可访问项目 + 仓库已精确关联”，但随后把这个仓库路径作为 Foundation Git helper 的 `projectCode` 传入。
- `projectCode` 的语义是 Console Directory 项目编码，Foundation 因此向 Directory 查询 `/projects/{projectCode}`，将 GitLab 路径误当企业项目编码，导致 404。

## 修复

- 文档树和文件内容读取在完成 Aims 项目/仓库精确关联校验后，使用 `repoPath` 直接调用 GitLab 固定操作。
- 同步修正了 Aims 的 GitLab 提交同步、Issue 同步和 commit diff 读取，这些路由使用的同一字段同样是 GitLab 仓库路径。
- 保留 Foundation `projectCode` 兼容能力，供确实使用 Console Directory 项目编码的调用方使用。

## 验证

- `pnpm --dir aims test`：244 项通过。
- `pnpm --dir aims lint`：通过。
- `pnpm --dir aims typecheck`：通过。
- 新增契约断言，禁止将已验证的 `repoProjectCode` 再作为 Directory `projectCode` 传入 Git helper。

