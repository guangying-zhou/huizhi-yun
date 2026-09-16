# Account 模块

**作者：** 周光营
**版本：** v1.5
**创建时间：** 2026-01-18
**更新时间：** 2026-03-17

项目地址：<https://gitlab.wiztek.cn/huizhi-yun/account>
管理后台地址：<https://account.wiztek.cn> (<http://localhost:3000>)
用户页面：<https://myaccount.wiztek.cn> (<http://localhost:3001>)

## 概述

Account 模块是 huizhi-yun 平台的统一身份与访问管理模块，同时作为平台级服务网关为其他模块提供共享能力。

**管理后台**主要功能包括：部门管理、用户管理、应用管理、角色管理、权限管理（RBAC）、GitLab 文档同步、API 密钥管理、AI 服务管理、用户登录日志管理、操作审计日志等。

**用户端**主要功能包括：用户登录（CAS SSO / LDAP）、密码修改、用户信息修改、应用入口等。

**平台服务**（供其他模块通过 API 调用）：
- 用户/部门/权限查询
- 企业微信消息发送
- 登录日志与操作日志上报
- AI 网关（对话、补全、流式输出）

## 技术栈

Nuxt 4 + Nuxt UI v4 + MySQL + mysql2 + Vite + TailwindCSS + GitLab API + Pinia

## 接口文档

Account 模块已内置 OpenAPI 文档页面，当前仅展示 `/api/v1/**` 接口。

本地开发环境访问：

- `http://localhost:3000/scalar`：推荐，Scalar 交互式文档
- `http://localhost:3000/swagger`：Swagger UI
- `http://localhost:3000/openapi.json`：OpenAPI JSON 原始文档

生产环境可将域名替换为实际部署地址，例如：

- `https://account.wiztek.cn/scalar`
- `https://account.wiztek.cn/openapi.json`

旧入口 `/_nitro/scalar`、`/_scalar` 等地址已兼容重定向到新路径，后续请统一使用上述新地址。

## AI 网关

Account 模块内置统一 AI 网关，为各业务模块提供 AI 能力，当前默认接入**阿里云通义千问**（兼容 OpenAI API 格式）。

### 架构

```
codocs/其他模块 → Account AI API → AI Provider（通义千问/DeepSeek/OpenAI）
                      ↑
                统一鉴权、配额、审计
```

### API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/v1/ai/chat` | POST | 多轮对话，支持流式（SSE）/非流式 |
| `/api/v1/ai/completions` | POST | 文本补全 |
| `/api/v1/ai/models` | GET | 获取可用模型列表 |
| `/api/v1/ai/usage` | GET | 用量统计 |
| `/api/v1/ai/health` | GET | 健康检查（无需认证） |

### 相关数据表

| 表名 | 用途 |
|------|------|
| `ai_providers` | AI 提供商配置（API 地址、密钥、可用模型） |
| `ai_quotas` | 应用调用配额（日限/月限） |
| `ai_usage_logs` | 调用日志（token 消耗、耗时、状态） |

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AI_ENABLED` | AI 服务总开关 | `true` |
| `AI_API_KEY` | 通义千问 API Key | - |
| `AI_BASE_URL` | API 基础地址 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `AI_REQUEST_TIMEOUT_MS` | 请求超时（毫秒） | `60000` |

详细接口文档参见 [API_SPEC.md](docs/API_SPEC.md)。

## 生产部署

Account 模块现在使用**模块内独立 PM2 配置**，不再依赖工作区根目录的共享 `ecosystem.config.cjs`。

### 部署目录

- 应用目录：`/opt/huizhi-yun/account`
- PM2 配置：`/opt/huizhi-yun/account/deploy/ecosystem.config.cjs`
- 运行时环境变量：`/opt/huizhi-yun/account/.env`
- Secrets 源文件：`/opt/huizhi-yun/secrets/account/.env`

### CI/CD 行为

`account/.gitlab-ci.yml` 当前部署流程如下：

1. 执行 `pnpm build`
2. 打包 `.output/`
3. 将仓库内的 `deploy/ecosystem.config.cjs` 同步到 `/opt/huizhi-yun/account/deploy/ecosystem.config.cjs`
4. 校验 `/opt/huizhi-yun/secrets/account/.env` 存在，并复制到 `/opt/huizhi-yun/account/.env`
5. 通过 PM2 启动 `hzy-account`

### 手工重启

如果需要手工重启，使用：

```bash
sudo -u gitlab-runner -H pm2 delete hzy-account
sudo -u gitlab-runner -H pm2 start /opt/huizhi-yun/account/deploy/ecosystem.config.cjs --only hzy-account
sudo -u gitlab-runner -H pm2 save
```

### 查看状态

```bash
sudo -u gitlab-runner -H pm2 ls
sudo -u gitlab-runner -H pm2 logs hzy-account --lines 20
```
