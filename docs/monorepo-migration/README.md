# Monorepo 迁移记录

本目录是 2026-08-21 多仓合并的可审计记录。迁移采用 `git-filter-repo v2.47.0`，每个原子仓库被重写到同名顶层目录；原 Tag 统一增加 `<component>/` 前缀。

## 关键约定

- 原仓库 SHA 因路径重写而变化，`commit-maps/*.tsv` 保存 old → new 映射。
- `inventory.json` 固定原 remote、迁移基线 HEAD、tree 和截至该基线的 Tag 数量。验证时只统计可从迁移基线 HEAD 追溯到的 Tag，后续正常发布的新 Tag 不改写这份迁移记录。
- 原仓库 HEAD tree 必须与重写后 commit 的对应子目录 tree 相同。
- `account/` 仅保留 legacy 源码和历史，默认 `lint:active`、`typecheck:active`、`test:active` 继续排除。
- 发布 Tag 使用 `aims/v0.1.2`、`codocs/v0.9.0` 形式；Platform 将其映射为应用版本 `v0.1.2`、`v0.9.0`。
- Platform 完成 v2.31 结构迁移后，执行 [`HZY-Platform-SQL-Migration-v2.32-monorepo-application-cutover.sql`](../../platform/docs/sql/HZY-Platform-SQL-Migration-v2.32-monorepo-application-cutover.sql) 原子切换应用的仓库、Manifest 路径和 Tag 前缀。
- 第一个从 monorepo 创建并推送的正式发布 Tag 是切换不可逆点；之后只允许 revert 或 forward-fix，不承诺自动拆回多仓。

## 本地恢复材料

迁移机器暂存目录：`.tmp-monorepo-migration-20260821/`。

- `bundles/*.bundle`：16 个仓库的完整 Git bundle。
- `nested-git/*.git`：迁移前嵌套 Git 管理目录。
- `filtered/*.git`：路径重写后的临时 mirror。

该目录被根 `.gitignore` 排除，不会推送。确认新 GitLab 仓库、CI、Tag 和发布链稳定之前不要删除。

## 验证

```bash
pnpm validate:monorepo-migration
pnpm worktree:doctor
```

推送前还必须完成：

1. 为新 monorepo 配置独立 GitLab remote，不能误推到原 `foundation.git`。
2. 轮换迁移前仓库中曾被跟踪的 `.env/.env.dev` 候选凭据。
3. 将旧仓库设为只读归档，并保留 old SHA/Tag 查询能力。
4. 在 GitLab 保护 `<component>/v*` Tag，并让各组件发布 Job 只响应自己的前缀。
