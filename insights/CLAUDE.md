# Insights 模块

> 业务模块 — 代码仓库监测分析平台 | 端口 3009 | 状态：已上线 | 数据库：hzy_repoinsight (MySQL)
>
> 📖 本模块未使用 Foundation Layer；仅在评估共享认证、目录或跨模块适配时按需查 [`docs/FOUNDATION_CAPABILITIES.md`](../docs/FOUNDATION_CAPABILITIES.md)。

## 职责边界

**负责**：Git/SVN 代码贡献分析、代码质量监测、团队开发效能统计、提交历史分析、贡献者统计、部门维度报表

**不负责**：项目管理（→ Aims）、文档（→ Codocs）、用户/权限管理（→ Account API）

## 技术栈

- **前端**：Nuxt 4 + Vue 3 + Nuxt UI（SSR 关闭）
- **数据库**：MySQL（`mysql2/promise` 连接池，db `hzy_repoinsight`），原始 SQL（无 ORM）
- **认证**：本地 cookie（`token`）+ 可选 CAS SSO（`CAS_ENABLE`）
- **后端**：Python FastAPI 服务（端口 8090），通过 `/api/python/**` Nitro 代理
- **代码源**：GitLab 集成（`GITLAB_BASE_URL`、bot token）

> 注意：此模块从独立 SaaS 项目迁移而来，未使用 Foundation Layer（无 `extends`），认证和 Account API 调用为本地实现。

## 依赖的模块

- **Account**：用户查询（`getUserByEmail`/`getUserByUid`）、审计日志上报（login_logs、operation_logs），通过 `HZY_ACCOUNT_API_URL/KEY/SECRET` 配置

## 关键架构

- `/api/python/[...path].ts` — 反向代理到 Python FastAPI 后端（`PYTHON_BACKEND_URL`）
- `/server/utils/db.ts` — MySQL 连接池（`queryRows`/`queryRow`/`execute`）
- `/server/utils/accountApi.ts` — Account API 封装（用户查找 + 审计上报）
- `/app/composables/useRepoInsightAuth.ts` — 本地认证（cookie 方式）

## 页面结构

```
app/pages/
├── index.vue           # 首页
├── login.vue           # 登录（CAS ticket 或本地）
├── commits/            # 提交分析
├── contributors/       # 贡献者统计
├── dashboard/          # 仪表盘
├── departments/        # 部门视图
├── monitoring/         # 监控
├── reports/            # 报表
├── repos/[id]/         # 仓库详情
└── settings/           # 设置
```

## 数据库

Schema 定义：`docs/create_hzy_insights.sql`

## 开发注意

- 多租户功能已移除，`useBusiness` 返回硬编码默认值
- 未使用 Foundation Layer，不要尝试用 `useAuth`/`useAccount` 等共享 composable
- Python 后端负责核心的代码分析逻辑，Nuxt 层主要做代理和前端渲染
- 认证中间件 `auth.global.ts` 检查 `token` cookie，CAS 启用时支持 ticket 重定向
