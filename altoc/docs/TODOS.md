# Altoc 工作计划

> 本文件是 altoc 模块的"可追踪"工作清单，按阶段和优先级组织。
>
> **状态标记**：🟢 已完成 / 🟡 进行中 / 🔴 未开始 / ⚪️ 待决策 / ⏸ 已搁置
>
> **更新规则**：每完成一项把状态改成 🟢，并在 `Done` 字段写日期和关键提交。

---

## 🔖 背景

Altoc = 汇智云面向 ToB/ToG 项目型销售的 LTC 经营平台。MVP 主链路：
`线索 → 客户 → 商机 → 报价 → 合同 → 回款`

当前 MVP 一期框架基本搭好（28 页面 + 80 API + 41 张表），本计划聚焦：
1. **MVP 打磨** — 让系统"真正可用"，数据质量 + 合规 + 体验
2. **跨模块集成** — 接通 Workflow / Aims / Assets / Account，让汇智云形成闭环
3. **AI 辅助** — 上 PRD 中规划的 P1 AI 能力
4. **二期深化** — 投标 / 续约 / 维保等

---

## 🅰️ 阶段 P0：MVP 打磨与闭环

> 目标：销售能跑完一天工作、管理层看到真实 pipeline，数据都写得进来、查得出来、改得对、可追溯。

### P0-1 🟡 zod 表单校验（前后端统一 schema）
- **What**：为核心实体（customer / lead / opportunity / quote / contract / receivable）编写共享 zod schema；前端表单 `useForm` 时用，后端 API 入口 `parse` 用
- **Why**：数据质量是一切之本，金额/日期/必填项当前只靠前端零散校验
- **Status**：🟡 基础设施已就位，剩余 handler 待接入
- **本轮完成**：
  - 新增 `shared/schemas/entities.ts` — 6 个核心实体的 zod schema（customer/lead/opportunity/quotation/contract/receivable_plan），含 `*CreateSchema` 和 `*UpdateSchema`
  - 新增 `server/utils/validateBody.ts` — 统一 `validateBody(event, schema)` helper，失败抛 400 并附 `issues[]` 字段错误列表
  - 示例接入 `customers/index.post.ts` — pattern 可复制到其他 handler
  - 规约：手写 `if (!body.xxx)` 校验可逐步删除；type inference 让 handler 业务代码有类型安全
- **待接入剩余 handler**：
  - `leads/index.post.ts` + `leads/[id].put.ts`
  - `opportunities/index.post.ts` + `[id].put.ts`
  - `quotes/index.post.ts` + `[id].put.ts`
  - `contracts/index.post.ts` + `[id].put.ts`
  - `payments/**.post/put`
  - 前端 form 页面接入 zod（下一阶段，可用 `@nuxt/ui` 的 `schema` prop 自动校验）
- **Done**：部分（2026-04-11）

### P0-3 🟢 审计日志业务接入（核心主链路 + tenders 全覆盖）
- **What**：为核心主链路修改类 API 统一接入 `writeAuditLog`，覆盖 create/update/delete/status_change/approve/reject
- **Why**：PRD §14.2 合规要求
- **Status**：🟢 主链路全部接入（原 6/34 → 现 19/34）
- **本次补入**：leads.post/put、leads.convert、customers.put/delete、customers.contacts.post、opportunities.post、opportunities.activities、quotes.post/put、quotes.approve（含 approve/reject 双埋点）、contracts.post、payments.put、teams.post/put、teams.members.post/delete
- **未接入（次要）**：tenders.milestones、tenders.members、tenders.agencies、config 类、attachments、documents（次要，留作后续）
- **Done**：2026-04-11

### P0-3b 🟢 详情页时间线组件
- **What**：可复用 `<AuditTimeline entity-type entity-id />` 组件 + `GET /api/v1/audit-logs` API
- **Status**：🟢 完成
- **实现**：
  - `app/components/AuditTimeline.vue` — 列出操作记录，智能 diff 展示（只显示真正变更的字段）
  - `server/api/v1/audit-logs/index.get.ts` — 查询指定实体的审计历史
  - 已接入客户/商机/合同详情页，作为"操作历史"新 tab
- **Done**：2026-04-11

### P0-6 🔴 批量操作（列表页多选 + 批量改状态/分配/导出）
- **What**：为 customers / leads / opportunities / quotes / contracts 列表页加多选；抽一个 `BulkActionBar` 组件
- **Why**：管理层高频刚需
- **Effort**：M
- **Status**：🔴 未开始

### P0-7 🟢 设置页基础配置可编辑（行业/区域走 account + 本地字典完整 CRUD）
- **What**：行业 / 区域 / 客户等级 / 客户类型 / 商机阶段 / 付款条款模板的 CRUD UI；后端 POST/PUT/DELETE 补齐
- **Why**：当前是只读（只有 GET + 部分 PUT），无法客户化
- **Effort**：M
- **Status**：🔴 未开始

### P0-8 🟢 逾期自动标记（Nitro scheduledTasks 每日 02:00）
- **What**：每日扫 `receivable_plan`，更新状态和 `overdue_days`
- **Status**：🟢 tenant-runtime 命令、手动触发 API 和 Nitro task 已完成
- **实现**：
  - data-runtime `POST /v1/altoc/payments/scan-overdue` — 扫描、标记逾期、刷新 `overdue_days`
  - `server/api/v1/payments/scan-overdue.post.ts` — 用户态手动触发，Nuxt 侧只做权限校验和通知编排
  - `server/tasks/overdue/scan.ts` — Nitro task 通过 service 身份调用 tenant-runtime
- **Done**：2026-04-11（初版）；2026-06-20（迁入 tenant-runtime）

### P0-9 🟢 经营看板 KPI 补齐到 8 个
- **What**：核对 Design Doc §5 的 8 个 KPI 目前 dashboard 覆盖情况，补齐缺失的 API 和前端卡片
- **Why**：管理层核心诉求
- **Status**：🟢 完成
- **实现**：
  - 新增 `server/api/v1/dashboard/kpis.get.ts` 综合 API，一次返回 8 张卡片所需数据
  - 每张卡片带 `{ key, label, value, unit, health, sub }`：
    - `unit`: percent / amount / days
    - `health`: good / warning / bad / null — 供前端高亮异常（Design Doc 要求）
    - `sub`: 辅助文本（如 "赢 N / 输 M"）
  - 8 个 KPI：商机赢单率 / 平均销售周期 / 漏斗金额 / 加权预测 / 回款达成率 / 逾期应收 / DSO / 报价转化率
  - `?period=month|quarter|year` 切换窗口（默认 year YTD）
  - 前端 `pages/dashboard/index.vue` 改为 `v-for` 循环单一 `kpis` 数据源渲染卡片，代码行数减半
  - DSO 公式：应收余额 × 365 / 年度已签合同收入
  - 报价转化率：`accepted / (非 draft 总数)`
- **Done**：2026-04-11

### P0-10 🟢 权限埋点补全
- **What**：每个 API 入口 `requirePermission(event, 'resource', 'action')` 检查覆盖率
- **Why**：RBAC 已经接好了但盘点发现所有业务 API **0 个**做了权限拦截
- **Status**：🟢 完成
- **盘点**：85 个 API 文件
  - 业务 API（`/api/v1/**`）52 个 → 全部补 `requirePermission(resource, view|edit|admin)`
  - 通用 API（账号查询/附件/字典/文档）19 个 → 补 `requireAuth` 登录即可访问
  - 公开 API（auth 回调/心跳/config-check）7 个 → 保持公开
  - 已有鉴权 7 个 → 不变
- **实现**：
  - 重写 `server/utils/checkPermission.ts`：
    - 单请求内缓存（`event.context.__altocPermissions`）避免同 handler 多次检查时重复调 Account API
    - **`super_admin` 角色自动放行**所有权限
    - **`SKIP_PERM_CHECK=1`** 环境变量全局跳过（dev 初始化使用）
    - **`x-internal-api-key` header** 内部调用放行（workflow 回调 / 定时任务）
    - 403 错误 message 带上所需权限名（`需要 altoc:customer.edit`）方便调试
  - 用 Python 脚本批量改写 71 个文件，一次过 typecheck
  - Resource 映射：customer / lead / opportunity / quotation(quotes+tenders) / contract / receivable(payments) / analytics(dashboard) / admin(teams)
- **Done**：2026-04-11

### ✅ 已完成（无须再做）
- 🟢 **Kanban 拖拽改阶段** — `opportunities/index.vue` 已实现
- 🟢 **客户 360 视图** — 客户详情页已有真实关联数据
- 🟢 **销售活动记录 API + UI tab** — `/opportunities/[id]/activities.post.ts` + 详情页 activities tab
- 🟢 **Codocs 文档集成** — `Altoc_Codocs_Integration.md` 已实施
- 🟢 **团队管理 CRUD** — `settings/teams.vue` + teams API 7 个
- 🟢 **RBAC 权限中间件** — `checkPermission.ts` + menus 过滤

---

## 🅱️ 阶段 P1：跨模块集成（平台一体化）

> 目标：实现 PRD §13 的集成需求，让汇智云真正形成闭环。

### P1-3 🟢 Workflow 审批集成（报价 / 合同 — usePageWorkflow + WorkflowPanel）⭐️
- **What**：
  1. `app/config/permissions.ts` 新增 `approvalActions`（quotation.submit、contract.submit、contract.terminate 等）
  2. `server/plugins/sync-approval-actions.ts`（参考 aims 实现）启动时推送到 workflow
  3. 报价"提交审批"按钮 → 调 `workflow:/api/v1/tasks` 创建任务；本地 status 改为 `pending_approval`
  4. workflow 审批完成回调 altoc → 更新本地 status
  5. 报价/合同详情页加"审批记录" tab，拉 workflow 任务列表
  6. `.env.dev` 加 `HZY_WORKFLOW_API_URL=http://localhost:3009`；`nuxt.config.ts` 加 `workflowApiUrl` runtimeConfig
- **Why**：PRD §13.1 核心集成；aims 已验证可行
- **Status**：🟢 完成
- **实现**：
  - `app/config/permissions.ts` 声明 `approvalActions`；`server/plugins/sync-approval-actions.ts` 启动 5s 后推送到 workflow
  - `quotes/[id].vue` / `contracts/[id].vue` 接入 `useApprovalMode` + `usePageWorkflow` + `usePageWorkflowState`
  - `workflowActions` 按状态动态返回（draft/rejected → approve 动作，其他 → 空由 WorkflowPanel 自动识别已有实例）
  - `approvalIssues` 完整性检查（报价：金额+明细+有效期；合同：金额+客户+签约日期）
  - `onSubmitted/onApproved/onRejected` 回调本地同步 status 字段
  - 详情页 body 改为 flex 两栏：左侧主内容 + 右侧 `<WorkflowPanel>` 嵌入
  - 保留业务流转按钮（标记发送 / 客户接受 / 转合同），`isApprovalMode` 时隐藏防误操作
- **设计决策**：没切 foundation `LayoutSidebar`（altoc 的 `UDashboardSidebar` 有 preview 逻辑，迁移成本高），改为在详情页显式嵌入 `<WorkflowPanel>`，效果一致、改动收敛
- **Done**：2026-04-11

### P1-4 🟢 Account 审计日志回传
- **What**：`writeAuditLog` 本地写入后异步回传到 Account `/api/v1/operation-logs`；失败不影响本地
- **Why**：平台统一审计视图
- **Status**：🟢 完成
- **实现**：
  - `foundation/server/utils/accountApi.ts` 新增 `reportOperationAudit(payload)` helper（含 `OperationAuditPayload` 接口）；所有模块通过 layer auto-import 共享
  - `altoc/server/utils/auditLog.ts` 改为双写：先本地 INSERT（强一致），成功后 fire-and-forget 调 `reportOperationAudit`
  - action 命名规约：`altoc.<entityType>.<action>`（如 `altoc.customer.create`）
  - detail 带上 operatorName / remark / oldValue / newValue
  - 未配 Account API Key 时静默跳过（dev 环境）；调用失败只打 warn 不抛异常
  - 清理 altoc 本地重复的 `reportOperationAudit`（原从 nuxt-template 历史遗留）
- **Done**：2026-04-11

### P1-5 🟢 企微通知接入业务事件（含商机超期扫描）
- **What**：在以下事件调用 `sendNotification`：
  1. 商机分配给我（opportunities.post / put owner 变化）
  2. 报价/合同待我审批（P1-3 后由 workflow 触发）
  3. 商机超期未跟进（定时任务）
  4. 回款逾期（P0-8 定时任务触发）
  5. 线索分配给我（leads.post / put）
- **Why**：被动提醒驱动销售行动，PRD §13 集成
- **Effort**：M
- **Depends on**：P0-8（逾期任务）
- **Status**：🔴 未开始

### P1-2 ⚪️ Aims 合同-项目联动
- **What**：
  1. 合同签署后可选"创建 Aims 项目"，调用 `aims:3002/api/v1/projects`
  2. 商机赢单 → 合同 → Aims 项目贯通（跳转 URL 传入上下文）
  3. 里程碑/验收回传：Aims 完成里程碑 webhook 到 altoc，更新 `contract.execution_status`
  4. 合同详情页加"项目执行" tab 展示 Aims 项目数据
- **Why**：PRD §13.3 核心集成，打通 LTC 下半段
- **Effort**：L
- **Status**：⚪️ 等 Aims 那边接口稳定（用户反馈 Aims 在赶工中）
- **对接契约**：待补充到 `docs/Altoc_Aims_Integration.md`

### P1-1 ⏸ Assets 产品目录对接
- **What**：报价的产品选择器双源（Assets API + 本地 product 缓存降级）
- **Status**：⏸ 搁置 — 用户反馈 Assets 完成度不高，后续再对接

### P1-6 🔴 Codocs 模板化
- **What**：报价单/合同文档从 Codocs 拉模板（`doc_type=template`）→ 填充变量 → 生成新 sale 文档
- **Why**：让销售不用手敲标准文档
- **Effort**：M
- **Status**：🔴 未开始

---

## 🅲️ 阶段 P2：AI 辅助与运营优化

### P2-1 🔴 AI 客户摘要
- **What**：调 Account AI API（参考 `aims/server/utils/accountApi.ts`）汇总客户近期跟进记录 + 商机情况 → 写入 `customer_ai_summary` 表 → 客户详情页头部展示
- **Why**：PRD P1 AI 辅助
- **Effort**：M

### P2-2 🔴 AI 商机风险提示
- **What**：基于阶段停滞天数、金额异常、关键人缺失规则 + LLM 给出风险标签 + 建议下一步 → `opportunity_ai_risk` 表
- **Effort**：M

### P2-3 🔴 AI 销售纪要结构化
- **What**：活动记录新增时提供"粘贴纪要 → AI 抽取下一步/风险/竞品" → `activity_ai_summary`
- **Effort**：M

### P2-4 🔴 Command Palette 快速录入
- **What**：`Cmd+K` 全局呼出，快速创建商机/跟进/报价
- **Effort**：M

### P2-5 🔴 Excel 导入/导出
- **What**：客户/联系人 Excel 导入模板 + 所有列表页 Excel 导出
- **Why**：冷启动必需
- **Effort**：M

---

## 🅳️ 阶段 P3：二期能力深化

### P3-1 🔴 投标管理闭环完善
- tenders 框架已搭，需要完善审批、材料协同、复盘

### P3-2 🔴 续约与维保管理

### P3-3 🔴 客户服务工单与 SLA

### P3-4 🔴 多租户准备
- 加 `tenant_id` 字段 + 数据权限 schema

### P3-5 🔴 单元测试补齐
- vitest + 关键工具函数/金额计算/审批规则

---

## 📊 进度汇总

| 阶段 | 项目数 | 已完成 | 进行中 | 未开始 | 决策中 |
|-----|:----:|:----:|:----:|:----:|:----:|
| P0 MVP 打磨 | 10 | 0 | 2 | 8 | 0 |
| P1 跨模块集成 | 6 | 0 | 0 | 4 | 2 |
| P2 AI 与优化 | 5 | 0 | 0 | 5 | 0 |
| P3 二期 | 5 | 0 | 0 | 5 | 0 |
| **总计** | **26** | **0** | **2** | **22** | **2** |

另有 **6 项** 已在代码中完成（Kanban / 客户 360 / 活动 / Codocs / 团队 / RBAC）。

---

## 📝 执行顺序建议

1. **第一波**：P0-3 审计日志补全 + P0-1 zod 校验 + P0-8 逾期定时任务（基础设施，影响面大）
2. **第二波**：P0-7 设置页可编辑 + P0-6 批量操作 + P0-9 看板 KPI（用户可见价值）
3. **第三波**：P1-3 Workflow 审批（第一个跨模块落地）+ P1-4 审计回传 + P1-5 企微通知
4. **第四波**：P1-6 Codocs 模板 + P2 AI 系列
5. **决策后**：P1-2 Aims 联动（等 Aims 稳定）
6. **长期**：P3 二期能力

---

## 🗓 修改记录

| Date | By | Action |
|------|---|-------|
| 2026-03-21 | gavin | 初始 TODOS 创建（来自 gstack /office-hours） |
| 2026-04-11 | claude | 重写为可追踪计划表，基于实际代码盘点对齐 |
