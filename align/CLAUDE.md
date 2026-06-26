# Align 模块

> 可选增强业务模块 — 汇智云深度组织协同 | 开发端口 3008 | 状态：脚手架已创建，第一阶段暂缓 | 数据库：hzy_align
>
> 📖 涉及 Align 职责边界变更时，按需查 [`docs/ALIGN_BOUNDARIES.md`](./docs/ALIGN_BOUNDARIES.md)
>
> 📖 涉及产品定位或范围调整时，按需查 [`docs/ALIGN_POSITIONING.md`](./docs/ALIGN_POSITIONING.md)

## 职责边界

**负责**：当轻量协同超出 Console 边界后，承接跨部门事项协助单、人员借调、协同 SLA、HR 轻流程、财务轻流程等深度组织协同业务对象

**不负责**：统一员工入口、我的应用、轻量待办/通知/公告摘要、最近访问、常用入口、简单事项入口（→ Console employee-portal）、用户/部门/权限主数据（→ Console directory-runtime / 迁移期 Account）、审批流转引擎（→ Console workflow-runtime / 迁移期 Workflow）、研发执行（→ Aims）、经营主数据（→ Altoc）、资产主数据（→ Assets）、文档正文（→ Codocs）

## 依赖的模块

- **Console**：员工入口、轻量待办/通知、目录与认证运行时
- **Account**：迁移期用户、部门、权限、项目注册表
- **Workflow**：迁移期审批动作、审批实例、回调
- **Aims**：项目/任务上下文（计划中）
- **Codocs**：公告、会议纪要、协作文档引用（计划中）
- **Altoc**：客户/合同上下文（计划中）

## 开发注意

- `Align` 存储的是协同过程对象，不复制其他模块主档
- 跨模块关联统一使用 `uid`、`dept_code`、`project_code`、`biz_id`
- 第一阶段不要把统一员工入口或轻量通知/待办重新放回 `Align`
- 只有当 Console 轻量事项演进出完整状态机、SLA、借调履约、HR/财务台账时，才重新启动 `Align`
- 审批统一复用 Foundation + Workflow，不在模块内重复造流程引擎
