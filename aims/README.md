# Aims - 汇智云·项目

目标驱动的研发项目全生命周期管理模块，是汇智云（Huizhi.Yun）企业作业与管理云平台的核心业务模块之一。

## 功能概览

### 项目管理
- 项目立项申请与审批（对接 Align 审批流）
- 项目信息管理（变更/关闭/归档）
- 项目仪表板：进度概览、风险预警
- 版本规划与发布：版本号管理、发布日期、Changelog 自动生成

### 需求管理
- 需求创建与分析（AI 辅助需求拆解）
- 需求评审与变更追踪
- 需求追溯矩阵（需求 → 任务 → 代码 → 测试用例）
- 需求与 Codocs 文档双向关联

### 迭代与任务管理
- **迭代管理：** Sprint/Cycle 规划、迭代评审、回顾
- **看板管理：** Kanban 视图、WIP 限制、泳道
- **任务管理：**
  - 任务层级（Epic → Story → Task → Sub-task）
  - AI 驱动的 WBS 任务分解
  - 工期估算与依赖关系（甘特图）
  - 智能排期与资源分配
  - 任务状态自动流转

### 缺陷管理
- Bug 创建、指派、跟踪
- 缺陷与需求/任务/代码关联
- 缺陷统计与趋势分析

### 代码管理
- GitLab API 深度集成（仓库/分支/MR）
- 代码提交与任务自动关联
- 代码审查流程（MR/PR 评审）
- 代码质量看板（静态分析集成）

### 测试管理
- 测试计划与测试用例管理
- 测试执行与报告
- 缺陷关联与回归追踪

### 报表与度量
- 燃尽图、迭代速度趋势
- 人员工时统计、任务完成率
- 代码贡献分析
- AI 洞察报表

## 技术栈

- **框架**: [Nuxt 4](https://nuxt.com/) + [Vue 3](https://vuejs.org/)
- **UI**: [Nuxt UI V4](https://ui.nuxt.com/) + [Tailwind CSS](https://tailwindcss.com/)
- **状态管理**: [Pinia](https://pinia.vuejs.org/)
- **数据库**: tenant-runtime 托管（默认 `hzy_aims`）
- **认证**: CAS 单点登录 / 企业微信 OAuth
- **存储**: 阿里云 OSS
- **工具库**: [VueUse](https://vueuse.org/)、[date-fns](https://date-fns.org/)、[Zod](https://zod.dev/)

## 模块间关系

- **Account** → 用户/部门/角色/权限、项目成员、任务指派
- **Codocs** ↔ 设计文档关联项目任务、需求文档关联迭代、项目 Wiki/技术规范归档
- **Altoc** ↔ 项目工时数据 → 成本核算、合同交付物 → 项目里程碑、运维工单 → 缺陷/需求
- **Align** ↔ 项目立项审批、OKR 关联项目进度

## 环境要求

- Node.js 18+
- pnpm 10+
- MySQL 8.0+

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

复制 `.env.dev` 并根据实际环境修改：

```bash
cp .env.dev .env
```

主要配置项：

| 变量 | 说明 |
|------|------|
| `HZY_TENANT_RUNTIME_URL` | tenant-runtime/data-runtime endpoint |
| `HZY_AIMS_DATA_ACCESS_MODE` | 数据访问模式，默认 `tenant-runtime` |
| `HZY_APP_CODE` | 当前应用编码，默认 `aims` |
| `HZY_APP_BASE_PATH` / `NUXT_APP_BASE_URL` | 统一网关挂载路径 |
| `HZY_DEPLOYMENT_PUBLIC_URL` | 统一网关公开地址 |
### 3. 启动开发服务

```bash
pnpm dev
```

访问 http://localhost:3002

### 4. 生产构建

```bash
pnpm build
pnpm preview  # 本地预览
```

### 5. 代码检查

```bash
pnpm lint       # ESLint 检查
pnpm typecheck  # TypeScript 类型检查
```

## 项目结构

```
aims/
├── app/
│   ├── assets/css/          # 全局样式
│   ├── components/          # 通用组件
│   ├── composables/         # 组合式函数（认证、权限等）
│   ├── config/              # 权限配置
│   ├── layouts/             # 布局组件
│   ├── middleware/          # 全局中间件（认证 + 权限）
│   ├── pages/               # 文件路由
│   ├── plugins/             # 插件
│   ├── stores/              # Pinia 状态管理
│   ├── types/               # TypeScript 类型定义
│   └── utils/               # 工具函数
├── server/
│   ├── api/                 # Nitro API 路由
│   └── utils/               # 服务端工具（tenant-runtime 代理、权限检查等）
├── docs/                    # 文档（数据库 Schema 等）
├── nuxt.config.ts           # Nuxt 配置
└── package.json
```

## 开发计划

| 里程碑    | 描述                                      | 目标日期 |
| --------- | ----------------------------------------- | -------- |
| Aims MVP  | 项目管理 + 迭代看板 + 任务管理 + Bug 跟踪 | 2026-03  |
| Aims Beta | + 需求管理 + GitLab 集成 + 基础报表       | 2026-04  |
| Aims GA   | + AI WBS 分解 + 智能排期 + 测试管理       | 2026-04  |

## 相关文档

- [Nuxt 文档](https://nuxt.com/docs)
- [Nuxt UI V4 组件库](https://ui.nuxt.com)
- [汇智云 Account API 规范](../account/docs/API_SPEC.md)
- [汇智云产品需求文档](../huizhi-yun-PRD.md)

## 许可证

Proprietary - 汇智云
