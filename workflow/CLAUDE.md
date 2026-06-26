# Workflow 模块

> 平台服务 — 通用审批流程引擎 | 端口 3020 | 状态：开发中 | 数据库：tenant-runtime 托管（默认 hzy_workflow）
>
> 📖 涉及 Foundation 管理台布局、认证、目录或共享组件时，按需查 [`docs/FOUNDATION_CAPABILITIES.md`](../docs/FOUNDATION_CAPABILITIES.md)；简单局部改动不需要预读。

## 职责边界

**负责**：流程定义（JSON Schema 表单、条件路由）、审批实例创建/流转、待办任务分配、审批动作执行（同意/拒绝/委托）、审批完成回调

**不负责**：业务对象状态管理（由各业务模块自己管理）、用户/权限主数据（→ Console Directory + Platform policy bundle）

## 零代码接入

业务模块接入审批不需要修改 Workflow 代码：
1. 在 Workflow 管理后台配置资源动作 + 路由规则
2. 业务模块启动时调用 `POST /api/v1/action-defs/sync` 同步动作定义
3. 发起审批：`POST /api/v1/instances/prepare` → `POST /api/v1/instances`
4. 审批完成后 Workflow 通过签名 webhook 回调业务模块

## 核心引擎

- `server/utils/flowEngine.ts` — 审批流转核心逻辑
- `server/utils/routeMatcher.ts` — 条件路由匹配（按 dept_code、发起人角色、表单数据、优先级排序）
- `server/utils/callbackService.ts` — 审批完成后回调业务模块

## 依赖的模块

- **Console**：SSO、目录运行时（用户/部门查询）
- **Platform**：应用 manifest 导入、角色/权限 bundle 下发
- **Foundation**：继承 @hzy/foundation Layer（认证、布局、组件、应用入口）

## 被依赖

- **Aims**：项目立项/暂停/恢复/结项审批
- **Codocs**：文档审批
- **Altoc**：报价/合同审批（计划中）
- **Assets**：采购/分配/退回审批（计划中）

## 一体化运营闭环 Phase 0 契约

首条闭环按 `docs/Huizhi-yun-Integrated-Operations-Roadmap.md` 与 `docs/MODULE_CONTRACTS.md` 执行：Workflow 是审批动作、审批实例、任务和终态回调的事实源，但不保存业务终态。报价、合同、开票、项目立项/验收、资产采购/分配等业务状态仍由来源业务模块维护。

Phase 1 需要统一的动作定义：
- Altoc：`quotation.approve`、`contract.approve`
- Finance：`invoice_request.approve`
- Aims：`project.initiate`、`milestone.acceptance`
- Assets：`purchase_order.approve`、`asset_assignment.approve`

业务模块通过 `POST /api/v1/action-defs/sync` 同步动作定义；Workflow 终态回调业务模块时必须使用 Console service token，`aud=<业务appCode>`、`scope=workflow:callback`，payload 必须包含 `instance_no`、`app_code`、`resource_code`、`action_code`、`biz_id`、`status`、`completed_at`、`idempotencyKey`，审批通过/驳回类回调还必须携带 `approval_actor_uids`、`approval_operator_uid` 和 `non_self_approval_actor_uids`，供业务模块执行自审批拦截。

## 数据库

Schema 定义：`docs/workflow_schema.sql`

核心表（7）：flow_schemas、form_schemas、flow_action_defs、flow_routes、flow_instances、flow_tasks、flow_actions

## 开发注意

- 登录使用 Foundation Console OIDC；应用地址配置后 callback URL 默认为 `{应用URL}/api/auth/oidc-callback`
- 用户/部门查询通过 Console directory-runtime；旧 `/api/account/*` 路由仅作为迁移期兼容路径保留
- 审批同意/驳回/委托必须同时满足任务分配关系与 `workflow_tasks:approve|reject|delegate` 精确动作；实例撤回/重新提交必须同时满足发起人关系与 `workflow_instances:cancel|resubmit` 精确动作，不得只用 `edit/admin` 泛化授权。
- Workflow 向业务模块发送终态回调时使用 Console service token（`aud=<业务appCode>`、`scope=workflow:callback`），业务模块负责校验 `token_use=service`、`aud`、`scope` 和来源应用；不要新增共享 webhook secret。
- Workflow 应用自身不得直连 MySQL，也不再配置 `DB_*` / `runtimeConfig.db` / Hyperdrive。所有 `/api/v1/**` 业务数据读写必须通过 tenant-runtime/data-runtime，由 runtime 侧执行数据库操作。
- Workflow 的 tenant-runtime 主路径集中在 `server/middleware/data-runtime.ts` 和 `server/utils/dataRuntime.ts`；旧 `maybeCallWorkflowDataRuntime` 命名保留为兼容层，内部通过 Foundation `tenantRuntimeClient` 转发实例、任务和管理配置 API。`/api/v1/action-defs/sync` 在 Nuxt server 校验调用方 service token 后转发 tenant-runtime。
- `server/utils/db.ts` 仅保留为迁移期防误用桩，任何新增代码不得导入或调用它；如业务接口缺失，应先补 tenant-runtime adapter，而不是恢复本地 repository、DB fallback 或 Cloudflare Hyperdrive。
- 权限来自 Console/Foundation 授权快照和 scoped authorization；Platform 仍生成 policy bundle，但 Workflow 不得直接读取业务应用本地 bundle。角色型审批人解析需要 Console 授权目录 API，未接入前不得恢复旧 bundle 查人。
- 所有 API 调用通过 Foundation 代理（`/api/workflow-proxy/`），自动注入 `request_app_code`
- 表单定义使用 JSON Schema，前端动态渲染
- 流程模板可跨业务复用（如"两级审批"可同时用于立项和采购）
- 接入指南：`../foundation/docs/Workflow-Integration-Guide.md`
