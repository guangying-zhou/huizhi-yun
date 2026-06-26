# 汇智云 Huizhi Yun

汇智云是面向中小型软件企业的一体化经营与作业管理系统，覆盖平台治理、组织与权限、协作文档、研发项目、销售交付、资产、财务和人员绩效等核心业务链路。

项目采用多应用工作区架构。各业务域可以独立开发、部署和演进，同时通过统一的 Foundation 能力、Console 目录与权限运行时、Platform 策略包和跨应用服务契约保持一致的企业级治理模型。

## 核心能力

- **平台与租户治理**：租户、订阅、部署、License、应用注册、策略包和系统角色治理。
- **企业基础运行时**：统一目录、认证、权限、系统设置、集成配置和凭证治理。
- **研发项目管理**：项目立项、需求管理、版本规划、任务拆解、里程碑、周报、工时和交付物管理。
- **销售与交付经营**：客户、线索、商机、投标、报价、合同、回款、开票和交付联动。
- **协作文档**：文档空间、项目文档、权限控制、实时协同和业务对象关联。
- **审批工作流**：表单、流程模板、审批任务、回调动作和跨应用审批集成。
- **资产与资源管理**：资产台账、资源分配、告警处理、字典配置和生命周期管理。
- **财务经营中台**：费用、项目支出、付款、成本分摊、项目核算、报表和财务绩效。
- **人员与绩效事实**：员工、任职、成本记录、贡献记录、绩效周期和跨模块人员事实。
- **工程与远程开发洞察**：代码仓库分析、开发代理、任务执行和问题流转。

## 架构概览

```text
platform        平台控制面：租户、订阅、部署、License、策略包
console         企业基础运行时：目录、认证、权限、集成配置、凭证治理
foundation      共享 Nuxt Layer：统一认证、目录、权限、审批和 UI 能力
workflow        通用审批流程引擎
collab          实时协作运行时
data-runtime    客户数据库侧业务 API Agent
apps            codocs / aims / altoc / assets / finance / people / align / insights / webdev
```

业务应用默认通过 API、Foundation adapter 或 runtime adapter 协作，避免跨模块直连数据库。跨应用调用使用明确的服务身份、目标应用 audience、细粒度 capability 和幂等键。

## 模块地图

| 模块 | 说明 |
| --- | --- |
| `platform` | 平台控制面，负责租户、订阅、部署、License、策略包和应用治理 |
| `console` | 企业端基础运行服务，负责目录、认证、权限、集成配置和凭证治理 |
| `foundation` | Nuxt Layer 共享层，沉淀认证、目录、权限、审批和通用 UI 能力 |
| `codocs` | 协作文档与项目文档管理 |
| `collab` | 实时协作运行时 |
| `aims` | 研发项目管理、需求、任务、里程碑、周报和交付物 |
| `altoc` | LTC 经营管理，覆盖销售、合同、回款、开票和交付衔接 |
| `assets` | 资产与资源管理 |
| `finance` | 财务经营中台、费用、成本、付款和经营报表 |
| `people` | 人员事实、任职、成本记录和绩效贡献 |
| `align` | 深度组织协同增强模块 |
| `workflow` | 通用审批流程引擎 |
| `insights` | 代码仓库分析与工程洞察 |
| `webdev` | 远程开发代理控制台 |
| `data-runtime` | 面向客户数据库侧部署的业务 API Agent |
| `nuxt-template` | 业务应用模板 |
| `notification-runtime` | 通知运行时 |

## 技术栈

- Nuxt 4 / Vue 3 / Nitro
- Nuxt UI v4
- TypeScript
- pnpm workspace
- Go data-runtime
- 多应用模块化架构

## 快速开始

安装依赖：

```bash
pnpm install
```

复制需要运行的模块环境变量示例：

```bash
cp console/.env.example console/.env.dev
cp platform/.env.example platform/.env.dev
```

启动单个模块：

```bash
pnpm --dir console dev
pnpm --dir platform dev
pnpm --dir aims dev
```

常用验证命令：

```bash
pnpm lint:active
pnpm typecheck:active
pnpm test:active
```

各模块也可以独立运行：

```bash
pnpm --dir <module> lint
pnpm --dir <module> typecheck
pnpm --dir <module> build
```

## 开发约定

- 开发环境使用 `.env.dev`，部署环境使用 `.env`。
- 不提交真实密钥、访问令牌、数据库密码、客户数据或本地运行产物。
- 环境变量示例使用 `.env.example` 或 `.env.*.example` 维护。
- 新增跨应用调用时，需要明确调用方、目标应用、capability、幂等规则和错误映射。
- 共享认证、目录、权限、审批和 UI 能力优先沉淀到 `foundation`。

## 参与贡献

欢迎通过 Issue 和 Pull Request 参与改进。建议提交前先运行相关模块的 lint、typecheck 或测试命令，并在 PR 中说明变更范围、验证方式和可能影响的模块。
