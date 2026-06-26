# Nuxt Template - 汇智云 Nuxt 4 项目模板

汇智云（huizhi-yun）平台的标准 Nuxt 4 项目模板，基于 `@hzy/foundation` Nuxt Layer，内置统一认证、权限管理、Console Directory、Workflow 代理等通用能力，可快速创建新的业务模块。

## 技术栈

- **框架**: [Nuxt 4](https://nuxt.com/) + [Vue 3](https://vuejs.org/)
- **UI**: [Nuxt UI V4](https://ui.nuxt.com/) + [Tailwind CSS](https://tailwindcss.com/)
- **状态管理**: [Pinia](https://pinia.vuejs.org/)
- **数据库**: MySQL（[mysql2](https://github.com/sidorares/node-mysql2) 连接池）
- **认证**: Console OIDC / Foundation Auth
- **工具库**: [VueUse](https://vueuse.org/)、[Zod](https://zod.dev/)

## 内置功能

- **统一登录入口** - 业务模块未登录统一跳转到 Console 认证入口
- **RBAC 权限管理** - 对接 Console / Platform 注册的角色权限体系
- **用户/部门/项目管理** - 通过 Console Directory Runtime 获取组织架构数据
- **Workflow 集成基础能力** - 通过 Foundation 提供审批代理与应用上下文
- **Console Runtime** - 启动期获取应用运行配置，避免重复配置平台级参数
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
| `HZY_APP_CODE` | 当前应用编码 |
| `HZY_APP_BASE_PATH` / `NUXT_APP_BASE_URL` | 应用挂载路径 |
| `HZY_DEPLOYMENT_PUBLIC_URL` | 统一网关下的公开访问地址 |
| `NUXT_PUBLIC_APP_DISPLAY_NAME` / `NUXT_PUBLIC_APP_LOGO` | 当前模块展示信息 |

### 3. 启动开发服务

```bash
pnpm dev
```

访问 http://localhost:3000

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
nuxt-template/
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
│   │   ├── auth/            # 认证权限兼容端点
│   │   └── notifications.ts # 通知列表占位端点
│   └── utils/               # 服务端工具（数据库、权限检查等）
├── nuxt.config.ts           # Nuxt 配置
└── package.json
```

## 基于模板创建新模块

1. 复制 `nuxt-template/` 目录并重命名
2. 修改 `package.json` 中的 `name` 字段
3. 同步修改 `app/config/permissions.ts` 中的 `appCode`
4. 修改 `nuxt.config.ts` 中的 `DB_NAME` 默认值和展示元数据默认值
5. 配置 `.env.dev` 环境变量
6. 在 `app/pages/` 下添加业务页面
7. 在 `server/api/` 下添加业务接口

## Foundation 接入约定

- `nuxt.config.ts` 必须 `extends: ['@hzy/foundation']`
- `runtimeConfig.public.appCode` 必须与 `app/config/permissions.ts` 中的 `appCode` 一致
- 登录审计、权限校验、审批中心过滤统一使用 `appCode`，不要混用展示名称
- 模块未登录时应统一跳转 Console 登录页，不要再保留独立登录流程
- 模块自定义 `auth.global.ts` / `permission.global.ts` 时，应保持与 Foundation 的 cookie、SSO、权限加载约定一致

## 相关文档

- [Nuxt 文档](https://nuxt.com/docs)
- [Nuxt UI V4 组件库](https://ui.nuxt.com)
- [平台环境变量收敛方案](../docs/ENV_SIMPLIFICATION_PLAN.md)

## 许可证

Proprietary - 汇智云
