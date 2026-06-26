# Align - 汇智云协同

`Align` 是汇智云未来可选的深度组织协同业务模块。统一员工入口、应用中心、轻量待办、通知公告和简单事项入口已收敛到 `console.employee-portal`；`Align` 仅在协同事项演进出完整生命周期、人员借调、协同 SLA、HR/轻财务台账等深度业务域后启用。

## 技术栈

- **框架**: [Nuxt 4](https://nuxt.com/) + [Vue 3](https://vuejs.org/)
- **UI**: [Nuxt UI V4](https://ui.nuxt.com/) + [Tailwind CSS](https://tailwindcss.com/)
- **状态管理**: [Pinia](https://pinia.vuejs.org/)
- **数据库**: MySQL（[mysql2](https://github.com/sidorares/node-mysql2) 连接池）
- **认证**: CAS 单点登录 / 企业微信 OAuth
- **存储**: 阿里云 OSS
- **工具库**: [VueUse](https://vueuse.org/)、[date-fns](https://date-fns.org/)、[Zod](https://zod.dev/)

## 当前基础能力

- **统一登录入口** - 业务模块未登录统一跳转到 `account` 模块完成认证
- **企业微信免登** - 企业微信内自动授权，普通浏览器走扫码登录
- **RBAC 权限管理** - 对接 Account 模块的角色权限体系
- **用户/部门/项目管理** - 通过 Account API 获取组织架构数据
- **Workflow 集成基础能力** - 通过 Foundation 提供审批代理与应用上下文
- **阿里云 OSS** - 头像上传等文件存储
- **全局认证与权限中间件** - 路由级别的访问控制
- **错误处理** - 客户端全局错误捕获

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
| `DB_HOST` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | MySQL 数据库连接 |
| `CAS_ENABLE` / `CAS_BASE_URL` | CAS 单点登录 |
| `CAS_SERVICE_URL` | 可选，显式指定 CAS 回调 service 地址 |
| `HZY_ACCOUNT_API_URL` / `KEY` / `SECRET` | Account 模块 API |
| `HZY_WORKFLOW_API_URL` | Workflow 服务地址（Foundation 代理使用） |
| `WECOM_CORPID` / `CORPSECRET` / `AGENTID` | 企业微信配置 |
| `NUXT_PUBLIC_APP_DISPLAY_NAME` / `NUXT_PUBLIC_APP_LOGO` | 当前模块展示信息 |
| `ALIYUN_OSS_*` | 阿里云 OSS 存储 |
| `NOTIFY_REDIRECT_TO` | 测试模式：通知重定向到指定用户 |

### 3. 启动开发服务

```bash
pnpm dev
```

默认开发端口固定为 `3006`，直接执行 `pnpm dev` 即可。

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

## 模块定位

- 未来可选的深度组织协同应用，不再承担全平台统一工作入口
- 第一阶段暂缓建设，轻量员工入口能力由 Console 承接
- 不承担通用审批引擎职责，审批统一复用 `Workflow`
- 不维护用户、部门、权限主数据，统一消费 `Account`
- 不复制项目、合同、资产主档，只保存协同过程对象

详细边界见 [docs/ALIGN_BOUNDARIES.md](./docs/ALIGN_BOUNDARIES.md)。
产品定位见 [docs/ALIGN_POSITIONING.md](./docs/ALIGN_POSITIONING.md)。

## 项目结构

```
align/
├── app/
│   ├── assets/css/          # 全局样式
│   ├── components/          # 通用组件（UserMenu、通知侧滑框、部门树选择器）
│   ├── composables/         # 组合式函数（认证、权限、头像、账户等）
│   ├── config/              # 权限配置
│   ├── layouts/             # 布局组件
│   ├── middleware/          # 全局中间件（认证 + 权限）
│   ├── pages/               # 文件路由
│   │   ├── index.vue        # 首页
│   │   ├── login.vue        # 登录页
│   │   ├── settings/        # 用户设置
│   │   └── admin/           # 管理后台
│   ├── plugins/             # 插件（客户端错误处理）
│   ├── stores/              # Pinia 状态（用户/部门/项目缓存）
│   ├── types/               # TypeScript 类型定义
│   └── utils/               # 工具函数
├── server/
│   ├── api/
│   │   ├── auth/            # 认证回调/兼容端点（业务登录入口统一走 account）
│   │   ├── account/         # 用户/部门/项目查询（代理 Account API）
│   │   ├── oss/             # OSS 文件操作
│   │   └── notifications.ts # 企业微信通知
│   └── utils/               # 服务端工具（数据库、权限检查、企业微信等）
├── nuxt.config.ts           # Nuxt 配置
└── package.json
```

## Foundation 接入约定

- `nuxt.config.ts` 必须 `extends: ['@hzy/foundation']`
- `runtimeConfig.public.appCode` 必须与 `app/config/permissions.ts` 中的 `appCode` 一致
- 登录审计、权限校验、审批中心过滤统一使用 `appCode`，不要混用展示名称
- 模块未登录时应统一跳转 `account` 登录页，不要再保留独立登录流程
- 模块自定义 `auth.global.ts` / `permission.global.ts` 时，应保持与 Foundation 的 cookie、SSO、权限加载约定一致

## 相关文档

- [Nuxt 文档](https://nuxt.com/docs)
- [Nuxt UI V4 组件库](https://ui.nuxt.com)
- [Align 职责边界](./docs/ALIGN_BOUNDARIES.md)
- [汇智云 Account API 规范](../account/docs/ACCOUNT_API_SPEC.md)

## 许可证

Proprietary - 汇智云
