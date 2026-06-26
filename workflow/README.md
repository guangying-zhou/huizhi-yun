# Workflow - 汇智云统一流程引擎

汇智云（huizhi-yun）平台的统一审批流程引擎模块，为各业务模块（文档发文、合同审核、费用报销等）提供通用的审批流程能力。

## 核心特性

- **资源驱动** - 与 Platform manifest / policy bundle 权限体系对齐，通过「资源:动作」发起流程
- **表单动态化** - 申请表单通过 JSON Schema 配置，前端统一渲染
- **流程可复用** - 同一审批流程可被不同业务的不同动作共享
- **条件路由** - 根据部门类型、发起人角色、表单数据等上下文自动匹配流程
- **零代码接入** - 新业务只需在管理端配置资源动作和路由规则

## 技术栈

- **框架**: [Nuxt 4](https://nuxt.com/) + [Vue 3](https://vuejs.org/)
- **UI**: [Nuxt UI V4](https://ui.nuxt.com/) + [Tailwind CSS](https://tailwindcss.com/)
- **状态管理**: [Pinia](https://pinia.vuejs.org/)
- **数据运行时**: tenant-runtime/data-runtime 统一访问 `hzy_workflow`
- **认证**: Console OIDC 单点登录（企业微信 OAuth 仅作兼容入口）
- **工具库**: [VueUse](https://vueuse.org/)、[date-fns](https://date-fns.org/)、[Zod](https://zod.dev/)

## 架构定位

```
console / platform       workflow（流程引擎）      codocs / 合同 / 财务...
┌────────────────┐      ┌──────────────┐         ┌──────────────┐
│ SSO / 用户目录  │      │ 流程定义      │         │ 业务数据      │
│ manifest / 权限 │◄─── │ 表单定义      │────────▶│ 发起/回调     │
│ 应用入口        │      │ 路由匹配      │         │ 展示审批状态   │
└────────────────┘      │ 任务/审批     │         └──────────────┘
  控制「谁能发起」         └──────────────┘
                          控制「怎么流转」
```

- **Console / Platform** 负责：SSO、用户/部门目录、manifest 导入、角色权限物化与 bundle 下发
- **workflow** 负责：发起后走什么流程、谁审批、怎么流转
- **业务模块** 负责：发起流程、接收回调、展示审批状态

## 数据模型

| 表 | 说明 |
|----|------|
| `flow_schemas` | 审批流程定义（节点、审批人规则、流程配置） |
| `form_schemas` | 动态表单定义（字段类型、校验规则） |
| `flow_action_defs` | 资源动作定义（资源:动作 → 表单） |
| `flow_routes` | 路由规则（资源:动作 + 条件 → 流程） |
| `flow_instances` | 流程实例（业务数据、表单数据、附件、审批快照） |
| `flow_tasks` | 待办任务（审批人、节点、状态） |
| `flow_actions` | 操作记录（审批日志） |

## 环境要求

- Node.js 18+
- pnpm 10+
- tenant-runtime/data-runtime（runtime 侧连接 MySQL 8.0+）

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 初始化 runtime 数据库

```bash
# 在 tenant-runtime/data-runtime 侧初始化 hzy_workflow schema
mysql -u root -p hzy_workflow < docs/workflow_schema.sql
```

### 3. 配置环境变量

修改 `.env.dev`：

| 变量 | 说明 |
|------|------|
| `HZY_TENANT_RUNTIME_URL` | tenant-runtime/data-runtime endpoint |
| `HZY_WORKFLOW_DATA_ACCESS_MODE` | 数据访问模式，默认 `tenant-runtime` |
| `HZY_APP_CODE` | 应用编码，默认 `workflow` |
| `HZY_APP_BASE_PATH` / `NUXT_APP_BASE_URL` | 统一网关路径，默认 `/workflow/` |
| `HZY_DEPLOYMENT_PUBLIC_URL` | 统一网关外部地址，本地默认 `http://localhost:3080` |
Console OIDC issuer、目录运行时、Workflow 自调用地址、企业微信通知等平台级配置由 Console runtime / integration / vault 提供，不在 Workflow env 中重复配置。业务应用不再保留 `HZY_PLATFORM_URL` / `HZY_PLATFORM_TENANT_CODE` / `HZY_PLATFORM_RUNTIME_TOKEN` 这类 Platform runtime 授权回退。

### 4. 在 Platform 中注册应用

将 `app.manifest.json` 提交、发布版本，并在 Platform 从发布版本导入 manifest。Platform 会物化资源、推荐角色和应用展示元数据，再生成 policy bundle 下发给 workflow。

### 5. 启动开发服务

```bash
pnpm dev
```

访问 http://localhost:3020

### 6. 生产构建

```bash
pnpm build
pnpm preview
```

### 7. 代码检查

```bash
pnpm lint       # ESLint 检查
pnpm typecheck  # TypeScript 类型检查
```

## 项目结构

```
workflow/
├── app/
│   ├── components/          # 通用组件（UserMenu、AppLauncher、部门树）
│   ├── composables/         # 组合式函数（认证、权限、头像）
│   ├── config/              # 权限与菜单配置
│   ├── layouts/             # 仪表盘布局
│   ├── middleware/          # 全局中间件（认证 + 权限）
│   ├── pages/
│   │   ├── index.vue        # 工作台（统计 + 最近待办）
│   │   ├── tasks/           # 我的任务（待办/已办）
│   │   │   ├── index.vue    # 任务列表
│   │   │   └── [id].vue     # 审批详情（通过/驳回）
│   │   ├── instances/       # 我发起的
│   │   │   ├── index.vue    # 流程列表
│   │   │   └── [id].vue     # 流程详情
│   │   └── admin/           # 管理端
│   │       ├── flows.vue    # 流程定义管理
│   │       ├── forms.vue    # 表单定义管理
│   │       ├── actions.vue  # 资源动作管理
│   │       └── routes.vue   # 路由规则管理
│   ├── stores/              # Pinia 状态管理
│   └── types/               # TypeScript 类型定义
├── server/
│   ├── api/
│   │   └── v1/
│   │       ├── actions/     # 资源动作查询
│   │       ├── instances/   # 流程实例（发起/查询/撤回/重新提交）
│   │       ├── tasks/       # 任务（待办/已办/审批/驳回/委托）
│   │       └── admin/       # 管理端 CRUD
│   │           ├── flow-schemas/
│   │           ├── form-schemas/
│   │           ├── action-defs/
│   │           └── routes/
│   └── utils/
│       ├── db.ts            # MySQL 连接池
│       ├── flowEngine.ts    # 流程引擎核心（审批人解析、节点跳转、流程推进）
│       ├── routeMatcher.ts  # 路由匹配引擎（条件评估、优先级排序）
│       ├── callbackService.ts  # 回调业务模块
│       ├── directoryRuntimeClient.ts # Console Directory Runtime 客户端
│       └── notify.ts        # 企业微信通知
├── docs/
│   └── workflow_schema.sql  # 数据库建表脚本（含种子数据）
└── nuxt.config.ts           # Nuxt 配置（端口 3020）
```

## API 概览

### 业务接口（`/api/v1/`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/actions?resource_code=xxx` | 查询资源可用动作 |
| POST | `/instances/prepare` | 准备发起（匹配流程、返回表单） |
| POST | `/instances` | 正式发起流程 |
| GET | `/instances/:id` | 流程实例详情 |
| GET | `/instances/by-biz?resource_code=xxx&biz_id=xxx` | 按业务主键查询 |
| POST | `/instances/:id/cancel` | 撤回流程 |
| POST | `/instances/:id/resubmit` | 驳回后重新提交 |
| GET | `/tasks/pending` | 我的待办 |
| GET | `/tasks/done` | 我的已办 |
| GET | `/tasks/initiated` | 我发起的 |
| POST | `/tasks/:id/approve` | 审批通过 |
| POST | `/tasks/:id/reject` | 驳回 |
| POST | `/tasks/:id/delegate` | 委托 |

### 管理接口（`/api/v1/admin/`）

| 资源 | 说明 |
|------|------|
| `flow-schemas` | 流程定义 CRUD |
| `form-schemas` | 表单定义 CRUD |
| `action-defs` | 资源动作 CRUD |
| `routes` | 路由规则 CRUD |

## 业务模块接入指南

新业务接入 workflow 只需 3 步配置，零代码：

1. **Platform 注册资源** - 业务模块通过 `app.manifest.json` 声明资源和权限，发布后由 Platform 导入物化
2. **Workflow 配置** - 在管理端配置资源动作 + 路由规则（可复用已有流程和表单）
3. **业务模块调用** - 调用 `/api/v1/instances/prepare` 和 `/api/v1/instances` 发起流程，接收回调处理审批结果

## 相关文档

- [Workflow 设计方案](../docs/workflow_design.md)
- [App Manifest 规范](../docs/App-Manifest-Spec.md)
- [Nuxt 文档](https://nuxt.com/docs)
- [Nuxt UI V4 组件库](https://ui.nuxt.com)

## 许可证

Proprietary - 汇智云
