# Tenant-Runtime 迁移边界现状与下一波规划

> 最后核对：2026-07-19。当前事实源：各模块 `CLAUDE.md`、模块 `server/` 边界、
> `data-runtime/internal/apps/*` contract、`docs/MODULE_CONTRACTS.md`。对应 ADR-016 / ADR-014。本文档回答两个问题：
> 各模块残留的本地 DB 代码是「兼容期有意保留」还是「待清理」；下一波迁移做什么。

## 1. 各模块边界现状

| 模块 | 本地 `db.ts` 形态 | 真实 DB 调用残留 | 收口方式 | 结论 |
| --- | --- | --- | --- | --- |
| `finance/` | 抛错桩 | 0（仅死代码内） | middleware 全量代理 `/api/v1/finance/**`，未处理路径 503 | 已收口 |
| `workflow/` | 抛错桩 | 0 | handler 直接调用 `server/utils/dataRuntime.ts` 客户端（无代理 middleware） | 已收口 |
| `assets/` | 抛错桩（CLAUDE.md 明确的防误用桩） | 0 | middleware 代理 `/api/v1/**`，未启用 runtime 显式报错 | 已收口 |
| `altoc/` | 抛错桩 | 0（11 处导入均为类型导入） | middleware 代理 | 已收口 |
| `aims/` | 抛错桩 | 0 可达调用（见 2.1 的死代码说明） | middleware 选择性代理 + Nuxt-only 白名单 + 503 兜底 | 已收口 |
| `codocs/` | 无本地 `server/utils/db.ts` | 0（Nuxt server 未发现 MySQL / Hyperdrive 调用） | tenant-runtime/data-runtime 负责元数据、ACL、关系和版本；Nuxt 仅保留 OSS、格式转换、外部集成与受控编排 BFF | 代码边界已收口；真实环境验收待执行 |
| `collab/` | 无 | 0 | 已改走 Codocs runtime API，移除 MySQL 依赖 | 已收口 |
| `align/` / `insights/` | 本地 DB 自管 | — | 未迁入 tenant-runtime（align 脚手架暂缓；insights 独立 MySQL） | 不在本轮迁移范围 |

`platform/` 和 `account/` 仍不属于本轮业务 adapter 迁移对象。`console/` 的旧结论已被
`ADR-017-Console-Tenant-Data-Plane-Separation.md` 替代：Cloudflare、PM2 和
Self-hosted Console 最终均不得直连 `hzy_console`，全部租户持久化域迁入
tenant-runtime Console/Auth/Directory/Vault/Audit adapters。执行顺序与门禁见
`console/docs/Console-Database-Split-and-Data-Runtime-Migration-Task-List.md`。截至
2026-07-17，Console 生产代码的 DB helper 导入和静态调用均已降为 0，
`server/utils/db.ts`、直接 `mysql2` 依赖、Nuxt DB config 和 Cloudflare Hyperdrive
binding 已删除。Wiztek 生产切换与 Console DB ACL 撤销已经完成。生产当前为
Data Runtime `0.3.133`、Console Worker
`b98ca02b-d38e-4eb6-bed9-97b4b0c9c9a2`（version 236）；可靠操作增量迁移后
schema revision 为
`sha256:3f65861f15afa34691b4f9751751f984afd2f82716dc876203f19133843fbcc3`，
`mode=cutover=ready`。最终 72 小时观察从唯一生产 Connector 首个恢复心跳
`2026-07-19T23:15:50.641Z` 起算，最早关闭时间为
`2026-07-22T23:15:50.641Z`；隔离、无 DB 配置的
`console-test` 写链路和最终生产认证浏览器 7/7 smoke 均已完成，最终关闭仍须等待
观察期届满。最终关闭门禁已实现：届满后还必须核验覆盖完整窗口的零异常运营汇总、
最终观察、严格验收快照和实际加密备份，门禁通过才会独占生成受保护关闭报告。
CTR-801/816 已按试运行阶段变更负责人授权记录批准例外，未补造冻结记录或冒充
四方角色。

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

### 2.2 codocs：Nuxt 本地 DB 边界已收口，保留 runtime 与实环境验收

2026-07-11 复核确认 `codocs/server/utils/db.ts` 已不存在，`codocs/server/` 也无
MySQL、Hyperdrive 或应用侧 query/execute 主路径。此前列出的
`documentAccess` / `documentSchema` / `documentRelations` / `folder` /
`reviewExecution` / `reviewSchema` / `workingDays` 已不再作为 Codocs Nuxt
server 本地 DB utils 存在。文档元数据、ACL、关系和版本必须经
`data-runtime/internal/apps/codocs`；Nuxt BFF 只处理 OSS 文件流、格式转换、
外部集成和已经明确的受控编排。

这项结论只证明当前代码边界，**不代表**既有租户数据已迁移、Cloudflare runtime
已发布，或已在真实会话验证全部 Codocs/Collab 流程。新增能力仍须先补 runtime
contract；暂时没有 contract 的旧复杂 handler 必须显式 503，不得恢复本地 DB。

## 3. 下一波迁移规划

按优先级：

1. **Console 租户数据面迁移（代码与生产切换完成、观察中）**：Runtime Console Core、
   组织/设置/日历/审计/通知、Directory/Connector、Vault/Integration、
   Auth/OIDC/Session/Service Client、可靠 operation/actionable 和兼容运行态均已
   迁入客户侧 Runtime。静态边界由 51 个生产文件、522 个调用点降为 0/0。
   Console 部署模板会剥离 DB、Vault master key 和 OIDC private key，Cloudflare
   不再生成 Hyperdrive。未支持的外部 provider 明确 503，不允许回退 SQL。
   Wiztek schema/data、双租户/断网、无 DB `console-test` 写链路、Cloudflare
   切流、最终认证浏览器 smoke 和数据库 grant/ACL 撤销均已通过；下一步只按
   Runbook 完成逐班观察，并在 `2026-07-22T23:15:50.641Z` 后生成最终观察与真实
   运营汇总，执行关闭门禁后归档 CTR-834/835。
2. **Codocs 真实环境迁移验收**：在批准窗口按目标 tenant 执行 schema/data
   migration、版本化 Cloudflare 发布与已认证浏览器验收；验证 Collab、OSS 文档流、
   ACL、版本记录和 runtime tenant/deployment 隔离。不得把当前代码边界结论当作
   已上线或数据迁移完成。
3. **aims 业务语义验证**（已完成，2026-06-11）：已在
   `data-runtime/internal/apps/aims/project_deletion.go` 补专用删除实现，
   恢复旧语义：成员入口仅草稿可物理删除、仅项目经理或全局项目管理员可操作；
   管理员入口任意状态彻底删除并需 confirmText 二次确认；级联清理覆盖旧逻辑
   全部表并新增周报与项目级工时表。aims 中间件对 DELETE 项目路径注入
   `current_user_is_project_admin` 上下文。
4. **aims Nuxt-only 调桩断点收口**（2026-06-11 盘点，**已完成**）：db.ts 禁用后，
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
5. **finance / aims 死代码树专项清理**（低优先）：按 2.1 的两个方案择一，
   在独立 PR 中整模块处理，并跑全量 typecheck + 冒烟。

## 4. 验证手段

- 各模块「未启用 runtime 显式报错」行为可用 `pnpm run smoke:console-dev-runtime-disabled`
  与各模块 middleware 的 503 兜底自验。
- runtime 业务 API 覆盖以 `data-runtime/README.md` 的 endpoint 清单为准；
  发现缺口先补 contract，不回退本地 DB（各模块 CLAUDE.md 同款约束）。
- 本文档的“已收口”仅表示静态代码边界与离线自动化证据；migration、Cloudflare
  发布、真实租户/会话和 live probe 必须在对应 runbook 留档后另记为“真实环境验收”
  或“生产发布完成”。
