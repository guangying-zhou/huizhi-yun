# Account 模块

> Legacy 目录与身份兼容 facade / 迁移源 | 端口 3000 | 状态：已上线 | 数据库：hzy_account
>
> 📖 仅在用户明确要求处理 `account/` 时使用本文件；新增多模块复用 API 时，按需查 [`docs/FOUNDATION_CAPABILITIES.md`](../docs/FOUNDATION_CAPABILITIES.md) 并考虑 Foundation 代理。
>
> 目标口径：新增目录、身份、权限、服务认证和平台治理主路径默认走 `console/` Directory Runtime、Console OIDC、Platform policy bundle 与 Foundation adapter；Account 不再承接新平台底座能力。

## 职责边界

**负责**：legacy 用户、部门、角色、权限、应用管理、项目注册表、API Key 管理、LDAP 同步、CAS SSO、企业微信集成、AI 网关、审计日志，以及为未迁移模块提供兼容读取

**不负责**：新增目录/身份/权限主路径（→ Console / Platform / Foundation）、业务审批流程（→ Workflow）、文档内容（→ Codocs）、项目执行（→ Aims）、经营数据（→ Altoc / Finance）

## 关键约束

- `dept_code` 是部门唯一标识，所有模块引用此值（VARCHAR）
- `uid` 是用户唯一标识，跨模块引用
- `project_code` 是平台项目唯一标识；新路径目标由 Console Directory Runtime 维护，Account 仅保留 legacy 注册表和迁移兼容
- OpenAPI 文档仅暴露 `/api/v1/**` 端点，内部 `/api/` 端点不对外
- 多租户设计：所有表含 `company_code` 字段

## API 结构

- **管理后台 API**：`/api/` — 应用、部门、角色、LDAP、GitLab 项目等（仅内部使用）
- **平台 API**：`/api/v1/` — 用户、权限、项目、AI 网关等（对外服务，有 OpenAPI 文档）
- **OpenAPI**：`/openapi.json`（首选）、`/scalar`（人类浏览）、`/swagger`（调试）

## 数据库

Schema 定义：`docs/account_schema.sql`

核心表：companies、platform_users、departments、users、roles、permissions、resources、login_logs、operation_logs、ai_providers

## 开发注意

- AI 网关集成阿里云通义千问，兼容 OpenAI API 格式
- GitLab 文档同步和冲突解决逻辑在 server/api/ 下
- OSS 分桶存储：头像和应用 Logo 使用独立 bucket
- 修改接口后必须更新 `docs/ACCOUNT_API_SPEC.md`
