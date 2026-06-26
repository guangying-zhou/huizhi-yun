# Tenant-Runtime 迁移边界现状与下一波规划

> 2026-06-11 核对。对应 ADR-016 / ADR-014。本文档回答两个问题：
> 各模块残留的本地 DB 代码是「兼容期有意保留」还是「待清理」；下一波迁移做什么。

## 1. 各模块边界现状

| 模块 | 本地 `db.ts` 形态 | 真实 DB 调用残留 | 收口方式 | 结论 |
| --- | --- | --- | --- | --- |
| `finance/` | 抛错桩 | 0（仅死代码内） | middleware 全量代理 `/api/v1/finance/**`，未处理路径 503 | 已收口 |
| `workflow/` | 抛错桩 | 0 | handler 直接调用 `server/utils/dataRuntime.ts` 客户端（无代理 middleware） | 已收口 |
| `assets/` | 抛错桩（CLAUDE.md 明确的防误用桩） | 0 | middleware 代理 `/api/v1/**`，未启用 runtime 显式报错 | 已收口 |
| `altoc/` | 抛错桩 | 0（11 处导入均为类型导入） | middleware 代理 | 已收口 |
| `aims/` | 抛错桩 | 0 可达调用（见 2.1 的死代码说明） | middleware 选择性代理 + Nuxt-only 白名单 + 503 兜底 | 已收口 |
| `codocs/` | 真实 MySQL 连接（含 Hyperdrive） | 7 个 server utils 仍走本地 DB | middleware 按路径清单代理；未收口路径仍本地处理 | 迁移中（阶段 3，模块 CLAUDE.md 已记录约束） |
| `collab/` | 无 | 0 | 已改走 Codocs runtime API，移除 MySQL 依赖 | 已收口 |
| `align/` / `insights/` | 本地 DB 自管 | — | 未迁入 tenant-runtime（align 脚手架暂缓；insights 独立 MySQL） | 不在本轮迁移范围 |

`console/`、`platform/`、`account/` 自管数据库，不属于 tenant-runtime 迁移对象。

## 2. 残留处置结论

### 2.1 aims / finance：死代码树是有意保留，不做零散删除

两个模块的 middleware 已把业务数据路径全部收口（代理到 runtime 或显式 503），
本地遗留的旧 handler（finance 约 89 个路由文件；aims 如
`server/api/v1/projects/[id].delete.ts`、`server/utils/projectDeletion.ts`）
均不可达。但这些路由文件同时是 Nuxt typed `$fetch` 的路由类型锚点——
直接删除会导致前端 `method: 'DELETE'` 等调用 typecheck 失败（已实测）。

处置：兼容窗口内整树保留；后续清理须按模块专项进行，方案二选一：

1. 把 handler 替换为不依赖 `db.ts` 的显式 503 薄桩（保留类型锚点）；
2. 整树删除并同步改造前端 `$fetch` 调用的类型策略。

### 2.2 codocs：按模块 CLAUDE.md 的阶段 3 约束推进，不提前清理

`server/utils/db.ts` 仅作为迁移期历史代码依赖保留。仍走本地 DB 的 utils：
`documentAccess` / `documentSchema` / `documentRelations` / `folder` /
`reviewExecution` / `reviewSchema` / `workingDays`。
新增能力必须先补 `data-runtime/internal/apps/codocs` contract，旧路径在补好
contract 前显式 503，不回退本地 DB。

## 3. 下一波迁移规划

按优先级：

1. **codocs 剩余 utils 收口**（主体工作）：为第 2.2 节清单对应的数据路径补
   codocs runtime contract，逐组切换 middleware 清单；全部收口后将 `db.ts`
   降级为与 aims 一致的抛错桩，并移除 `DB_*` / Hyperdrive 配置。
   collab 已不依赖 Codocs DB，无阻塞。
2. **aims 业务语义验证**（已完成，2026-06-11）：已在
   `data-runtime/internal/apps/aims/project_deletion.go` 补专用删除实现，
   恢复旧语义：成员入口仅草稿可物理删除、仅项目经理或全局项目管理员可操作；
   管理员入口任意状态彻底删除并需 confirmText 二次确认；级联清理覆盖旧逻辑
   全部表并新增周报与项目级工时表。aims 中间件对 DELETE 项目路径注入
   `current_user_is_project_admin` 上下文。
3. **aims Nuxt-only 调桩断点收口**（2026-06-11 盘点，**已完成**）：db.ts 禁用后，
   中间件白名单放行的本地 handler 仍调用抛错桩，被调用即 500。共 16 个端点，
   分三组迁移（模式与 decompose-submit 一致：runtime 补业务端点 +
   本地 handler 改 `forwardAimsRuntimePost` 转发）：
   - 第一组「需求评审批次链路」**已完成**：`requirement-reviews/{id}/approve |
     reject | withdraw | create-tasks | append-requirements`，Go 实现见
     `requirement_review_actions.go` + `requirement_task_create.go`。
   - 第二组「拆解追加/分发链路」**已完成**：`work-items/{id}/append-tasks |
     confirm-append | reject-append | confirm-distribute | revoke-distribute |
     breakdown(PUT)`，Go 实现见 `work_item_distribution.go`（含项目生命周期
     校验与 work_items.start_date 列探测两个通用助手）。
   - 第三组「其他」**已完成**：`clone-from-template`、`projects/{id}/requirements/import`
     （含 requireConfirm 覆盖确认的错误还原）、`projects/{id}/requirement-targets(POST)`、
     `milestones/{id}/review-approve`，Go 实现见 `requirement_import_actions.go`。
     `init-decomposition-containers` 无任何调用方，已删除（路径回落 503 兜底）。
   - 原 4 个显式 503 端点**已补 contract**：`requirements/{id}/create-task`、
     `requirements/{id}/changes`、`requirement-contents/{id}/restore`
     （Go 实现见 `requirement_change_actions.go`）；`sync-gitlab` 按职责拆分——
     GitLab API 拉取留在 Nuxt（凭证经 Foundation/Console 集成解析），
     落库/工作项匹配/游标更新走 runtime 新端点
     `GET gitlab-sync-context` + `POST gitlab-commits/ingest`（`gitlab_sync.go`）。
   - 收口后 `server/api/v1` 仅剩 7 个引用 db 桩的本地死代码文件
     （A 类，已被 runtime 通用 CRUD 接管，作为 typed-route 锚点保留，见 2.1）。
4. **finance / aims 死代码树专项清理**（低优先）：按 2.1 的两个方案择一，
   在独立 PR 中整模块处理，并跑全量 typecheck + 冒烟。

## 4. 验证手段

- 各模块「未启用 runtime 显式报错」行为可用 `pnpm run smoke:console-dev-runtime-disabled`
  与各模块 middleware 的 503 兜底自验。
- runtime 业务 API 覆盖以 `data-runtime/README.md` 的 endpoint 清单为准；
  发现缺口先补 contract，不回退本地 DB（各模块 CLAUDE.md 同款约束）。
