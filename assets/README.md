# Assets - 汇智云企业资产管理模块

Assets 是汇智云平台的企业资产管理模块，负责统一维护实物资产、资源资产、环境视图、客户交付视图，以及围绕采购、入库、分配、归还、释放、报废、预警、成本归因形成管理闭环。

## 技术栈

- **框架**: [Nuxt 4](https://nuxt.com/) + [Vue 3](https://vuejs.org/)
- **UI**: [Nuxt UI V4](https://ui.nuxt.com/) + [Tailwind CSS](https://tailwindcss.com/)
- **状态管理**: [Pinia](https://pinia.vuejs.org/)
- **数据访问**: tenant-runtime/data-runtime 托管业务数据库访问
- **认证**: CAS 单点登录 / 企业微信 OAuth
- **存储**: 阿里云 OSS
- **工具库**: [VueUse](https://vueuse.org/)、[date-fns](https://date-fns.org/)、[Zod](https://zod.dev/)

## 模块定位

Assets 在平台中的职责：

- 管理实物资产与资源资产台账
- 建立环境视图与客户交付视图
- 管理供应商、采购单、入库/激活、分配/归还/释放/报废
- 提供到期、配额、席位、回收等预警
- 提供项目、部门、客户、环境维度的基础成本归因

Assets 不负责：

- 项目主数据，项目注册表来自 `Account`
- 客户与合同主数据，来自 `Altoc`
- 文档正文，来自 `Codocs`
- 审批引擎，来自 `Workflow`
- 研发执行状态，来自 `Aims`

## 当前建设范围

当前设计重点为 P0：

- 实物资产台账
- 资源资产台账
- 环境视图
- 客户交付视图
- 供应商基础台账
- 采购申请、审批、入库/激活
- 资产分配、领用、转移、归还、释放、报废
- 预警中心
- 基础报表

延后到后续阶段：

- 产品资产
- 数字资产
- 知识产权资产
- 安全视图
- 自动账单同步
- 入转调离自动联动

## 环境要求

- Node.js 18+
- pnpm 10+
- 已启用 Assets adapter 的 tenant-runtime/data-runtime

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
| `HZY_APP_CODE` | 当前应用编码，默认 `assets` |
| `HZY_TENANT_RUNTIME_URL` / `HZY_ASSETS_TENANT_RUNTIME_URL` | tenant-runtime/data-runtime 地址 |
| `HZY_TENANT_RUNTIME_TOKEN` / `HZY_ASSETS_TENANT_RUNTIME_TOKEN` | 迁移期静态 token；托管部署优先由 Platform 注入 |
| `HZY_APP_BASE_PATH` / `NUXT_APP_BASE_URL` | 统一网关挂载路径 |
| `HZY_DEPLOYMENT_PUBLIC_URL` | 统一网关公开地址 |
| `HZY_AUTH_MODE` / `HZY_LEGACY_AUTH_BRIDGE` | 默认使用 Foundation OIDC；仅兼容旧 CAS/企微入口时启用 legacy |

### 3. 启动开发服务

```bash
pnpm dev
```

默认使用 Nuxt 开发端口，正式模块端口待平台统一分配。

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
assets/
├── app/
│   ├── assets/css/          # 全局样式
│   ├── components/          # 通用组件
│   ├── composables/         # 业务状态与交互；认证、权限由 Foundation 提供
│   ├── config/              # 权限配置
│   ├── layouts/             # 布局
│   ├── middleware/          # 业务权限中间件
│   ├── pages/               # 页面路由
│   ├── plugins/             # 客户端插件
│   ├── stores/              # Pinia 状态
│   ├── types/               # 类型定义
│   └── utils/               # 前端工具函数
├── server/
│   ├── api/
│   │   ├── auth/            # 认证端点
│   │   ├── account/         # 兼容旧路径，数据来自 Console Directory
│   │   ├── oss/             # OSS 文件操作
│   │   └── ...              # 资产模块业务接口
│   └── utils/               # 权限、外部服务工具；DB 访问由 data-runtime 执行
├── docs/
│   ├── 企业资产管理系统-PRD-V1.0.md
│   ├── Assets-Design.md
│   ├── assets_schema.sql
│   └── template_schema.sql
├── nuxt.config.ts
└── package.json
```

## 设计文档

- [企业资产管理系统-PRD-V1.0.md](/Users/gavin/Dev/huizhi-yun/assets/docs/%E4%BC%81%E4%B8%9A%E8%B5%84%E4%BA%A7%E7%AE%A1%E7%90%86%E7%B3%BB%E7%BB%9F-PRD-V1.0.md)
- [Assets-Design.md](/Users/gavin/Dev/huizhi-yun/assets/docs/Assets-Design.md)
- [assets_schema.sql](/Users/gavin/Dev/huizhi-yun/assets/docs/assets_schema.sql)

## 跨模块依赖

- `Foundation`：OIDC 登录、应用入口、共享布局和通用运行时
- `Console Directory`：用户、部门、项目与组织数据
- `Platform`：app manifest 注册、policy bundle 与 runtime 权限
- `Altoc`：客户、合同
- `Aims`：项目执行摘要、工时、风险
- `Codocs`：文档引用
- `Workflow`：采购与资产操作审批

## 开发约束

- 前端不直接调用其他模块 API，统一经由 Assets 后端聚合
- 不允许跨模块数据库直连实现在线业务
- 跨模块关联统一使用业务键，例如 `project_code`、`contract_code`、`document_id`
- 敏感凭证类字段必须加密存储、脱敏展示

## 相关文档

- [Nuxt 文档](https://nuxt.com/docs)
- [Nuxt UI V4 组件库](https://ui.nuxt.com)
- [汇智云平台整体架构文档](/Users/gavin/Dev/huizhi-yun/Huizhi-yun-Architecture.md)
- [跨模块 API 合约](/Users/gavin/Dev/huizhi-yun/docs/MODULE_CONTRACTS.md)

## 许可证

Proprietary - 汇智云
