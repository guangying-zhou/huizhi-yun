# P3 / P4 发布收口与端到端验收清单

> 状态：发布收口清单  
> 日期：2026-06-16  
> 范围：People / Phase 3 项目人力成本闭环、Phase 4 运维服务与客户成功闭环，以及支撑这些闭环的 data-runtime、Platform / Console、Cloudflare 网关和文档变更。

## 1. 收口目标

本轮发布不继续扩展新业务功能，目标是把已经落地的 P3 / P4 能力整理成可验证、可部署、可回滚的版本：

1. People 应用作为人员事实、任职、成本快照和绩效贡献的最小事实源可访问。
2. Aims 能把项目工时 / 贡献同步到 People。
3. Finance 能从 People 读取项目人力成本，并纳入项目核算。
4. Altoc 能维护维保合同、SLA、服务工单和续约机会。
5. Altoc 服务工单能回流到 Aims 工作项，并接收处理结果。
6. Codocs 能把运维知识文档关联到客户、合同、项目、交付实例和服务工单上下文。
7. Finance 能按客户 / 维保范围读取维保收入、到账、核销、成本和毛利摘要。
8. Platform / Console / Cloudflare 配置能让 People 和 P4 跨模块接口在生产租户路径下正常工作。

## 2. 发布批次建议

| 批次 | 范围 | 主要内容 | 发布前置 |
| --- | --- | --- | --- |
| R0 文档与契约 | 根仓 docs、模块 CLAUDE、API spec | 固化 P3 / P4 边界、跨模块 service API、验收清单 | 无 |
| R1 运行时能力 | `data-runtime/` | People adapter、Aims / Altoc / Codocs / Finance 跨模块 service endpoint、runtime 配置与安装脚本 | R0 契约确认 |
| R2 控制面与网关 | `platform/`、`console/`、`deploy/cloudflare/tenant-gateway/`、`foundation/` | 应用导入修复、data-runtime 管理、People 路由、service app URL 解析、网关放行 | R1 可部署 |
| R3 People 应用 | `people/` | People UI、权限拦截、Cloudflare 部署配置、API spec | R1 / R2 完成 |
| R4 业务应用桥接 | `aims/`、`finance/`、`altoc/`、`codocs/` | P3 同步入口、P4 客户服务运营页、运维知识关联、维保财务摘要 | R1 / R2 / R3 完成 |
| R5 生产验收 | 目标租户环境 | 按本清单执行端到端验收并记录结果 | R1-R4 已部署 |

批次可以合并部署，但提交和回滚说明建议按上表拆分，避免 People、runtime、网关和业务桥接互相掩盖问题。

## 3. 当前变更归属

截至 2026-06-16，当前工作区未提交变更可按以下归属整理：

| 归属 | 目录 / 模块 | 说明 |
| --- | --- | --- |
| People MVP | `people/`、`data-runtime/internal/apps/people/`、`docs/People-Module-Design-and-Implementation-Plan.md` | People 应用、权限、API、runtime adapter 和设计文档 |
| P3 人力成本闭环 | `aims/`、`finance/`、`data-runtime/internal/apps/finance/` | Aims 贡献同步、Finance 读取 People 成本并写入项目核算 |
| P4 运维服务闭环 | `altoc/`、`aims/`、`codocs/`、`finance/`、`data-runtime/internal/apps/altoc|aims|codocs|finance/` | 维保合同、服务工单、工单回流、运维知识、维保财务摘要 |
| 控制面 / 网关 | `platform/`、`console/`、`deploy/cloudflare/tenant-gateway/`、`foundation/` | 应用导入、data-runtime 管理、People 域名和 service URL 解析 |
| 总体契约 | `docs/MODULE_CONTRACTS.md`、`docs/Huizhi-yun-Integrated-Operations-Roadmap.md`、模块 `CLAUDE.md` | Roadmap、跨模块契约、模块边界和状态收敛 |

`assets/` 当前无未提交变更；P4 复用其 Phase 2 已落地的交付资产包和文档关联接口。

## 4. 提交拆分建议

建议提交顺序如下：

1. `docs: 收敛 P3 P4 发布契约和验收清单`
2. `feat(data-runtime): add people and service ops adapters`
3. `feat(people): add People MVP app and authorization guard`
4. `feat(aims): sync project contributions and service ticket work items`
5. `feat(finance): sync people costs and expose maintenance summary`
6. `feat(altoc): add service ops customer view and maintenance contracts`
7. `feat(codocs): link ops knowledge context`
8. `fix(platform-console): support people import and data-runtime management`
9. `deploy(cloudflare): route people tenant gateway`

若某个模块是独立 Git 仓库，应在对应模块内单独提交；根仓只提交根仓跟踪的文件，不混入模块仓状态。

## 5. 发布前门禁

| 门禁 | 检查项 | 通过标准 |
| --- | --- | --- |
| G1 契约一致 | Roadmap、`MODULE_CONTRACTS.md`、模块 `CLAUDE.md`、API spec | Endpoint、scope、事实源、状态描述一致 |
| G2 Runtime 编译 | `data-runtime` Go 测试 | 相关 adapter 和 server 路由编译通过 |
| G3 前端类型 | People、Altoc、Aims、Finance、Codocs typecheck | 无类型错误 |
| G4 权限策略 | Platform 角色、People 权限、policy bundle | 系统管理员 / HR 角色能看到 People 入口 |
| G5 Cloudflare 路由 | `people.huizhi.yun` / `wiztek.huizhi.yun/people/` | 静态资源、base path、tenant gateway 转发正常 |
| G6 服务认证 | Console service token | `aud`、`scope`、`token_use=service` 校验通过 |
| G7 数据库迁移 | People schema、Altoc P4 schema、runtime schema 初始化 | 目标租户库存在必需表和种子数据 |

建议命令：

```bash
go test ./internal/apps/people ./internal/apps/aims ./internal/apps/altoc ./internal/apps/codocs ./internal/apps/finance ./internal/server
pnpm --dir people typecheck
pnpm --dir aims typecheck
pnpm --dir altoc typecheck
pnpm --dir finance typecheck
pnpm --dir codocs typecheck
git diff --check
```

## 6. 端到端验收清单

### 6.1 基础入口与权限

| 编号 | 操作 | 期望结果 |
| --- | --- | --- |
| AC-BASE-01 | 使用系统管理员登录企业工作台 | 左侧应用入口能看到 People / HR |
| AC-BASE-02 | 使用已授权 HR 角色登录 | 能进入 People 工作台，员工、任职变更、成本快照、绩效周期菜单可见 |
| AC-BASE-03 | 使用无 People 权限角色登录 | 显示无权限页，不泄露 People 数据 |
| AC-BASE-04 | 打开 `wiztek.huizhi.yun/people/` 并刷新 | 页面不空白，静态资源和 runtime API 均正常 |

### 6.2 People 最小事实源

| 编号 | 操作 | 期望结果 |
| --- | --- | --- |
| AC-P3-01 | 查看员工列表 | 能读取 `people_employees`，在职人数与种子数据一致 |
| AC-P3-02 | 打开员工详情 | 能看到任职历史、成本快照、项目参与贡献、绩效周期和关联文档 |
| AC-P3-03 | 查看成本快照 | 标准成本、实际成本、期间和来源字段完整 |
| AC-P3-04 | 查看绩效周期 | 周期状态能覆盖草稿、采集中、计算中、已确认等状态 |

### 6.3 Aims 到 People 贡献同步

| 编号 | 操作 | 期望结果 |
| --- | --- | --- |
| AC-P3-10 | 在 Aims 项目中准备项目成员、工时和任务数据 | 项目存在可归属员工和期间工时 |
| AC-P3-11 | 调用 Aims 贡献同步入口 | People 生成或更新项目贡献快照 |
| AC-P3-12 | 在 People 员工详情查看项目参与 | 能看到来源为 `aims / task` 或 `aims / worklog` 的贡献记录 |
| AC-P3-13 | 重复执行同一周期同步 | 不产生重复贡献快照，幂等键或来源业务键稳定 |

### 6.4 People 到 Finance 项目核算

| 编号 | 操作 | 期望结果 |
| --- | --- | --- |
| AC-P3-20 | 在 Finance 触发项目人力成本同步 | Finance 调 People service API 获取项目人员成本 |
| AC-P3-21 | 查看项目成本分摊 | `project_cost_allocation` 出现 `allocation_type=labor` 记录 |
| AC-P3-22 | 查看项目财务摘要 | 人力成本进入项目总成本，毛利和毛利率重算 |
| AC-P3-23 | 重复同步同一项目和期间 | 不重复累计成本，分摊编码稳定 |

### 6.5 Altoc 服务运营与工单回流

| 编号 | 操作 | 期望结果 |
| --- | --- | --- |
| AC-P4-01 | 打开 Altoc 客户详情服务运营页签 | 能看到维保合同、SLA、服务工单、续约机会、交付系统和财务摘要 |
| AC-P4-02 | 创建或查看服务工单 | 工单保存客户、合同、交付实例、优先级、SLA 和状态 |
| AC-P4-03 | 将服务工单回流到 Aims | Aims 创建或复用维护工作项 |
| AC-P4-04 | 在 Aims 更新处理结果并回写 Altoc | Altoc 工单更新 Aims 引用、解决状态、解决时间和文档 UUID |
| AC-P4-05 | 重复回流同一工单 | Aims 不重复创建工作项 |

### 6.6 运维知识与交付资产追溯

| 编号 | 操作 | 期望结果 |
| --- | --- | --- |
| AC-P4-10 | 将 Codocs 文档关联为运维知识 | Codocs `document_relations` 记录客户、合同、项目、交付实例和工单上下文 |
| AC-P4-11 | 从 Altoc 客户页查看关联知识 | 能看到文档 UUID / 标题引用，不复制正文 |
| AC-P4-12 | 从 Assets 交付资产包查看交付系统 | 能按客户 / 合同 / 项目返回交付视图、环境和文档 |

### 6.7 维保财务摘要

| 编号 | 操作 | 期望结果 |
| --- | --- | --- |
| AC-P4-20 | 在 Altoc 客户页加载维保财务摘要 | Altoc 先读取维保范围，再以合同 / 项目编码调用 Finance |
| AC-P4-21 | Finance 汇总维保收入 | 返回开票、到账、核销、服务成本、毛利和期间趋势 |
| AC-P4-22 | 检查非维保项目 | 不应因同一客户下其他项目而污染维保摘要 |

## 7. 部署顺序

1. 初始化或升级目标租户 schema：People、Altoc P4、data-runtime adapter 所需表。
2. 部署 data-runtime，并确认 Platform / Console 指向新版本 runtime。
3. 部署 Console / Platform 控制面和 policy bundle。
4. 部署 Cloudflare tenant gateway，确认 People 路由和业务应用路由。
5. 部署 People 应用。
6. 部署 Aims、Altoc、Finance、Codocs 的桥接变更。
7. 在 Platform / Console 刷新应用、角色、权限和订阅继承状态。
8. 执行第 6 节验收清单。

## 8. 回滚与风险

| 风险 | 影响 | 回滚 / 缓解 |
| --- | --- | --- |
| People 入口不可见 | HR 用户无法进入 People | 回滚 policy bundle 或重新授权 People 角色；确认 app manifest `appType`、`appCode`、scope |
| tenant gateway 路由错误 | 应用空白或 API 404 | 回滚 gateway worker 到上一版本，保留 data-runtime |
| data-runtime 新 adapter 异常 | P3 / P4 service API 失败 | 回滚 runtime 二进制或关闭新入口；业务主档不回滚 |
| 跨模块 service token scope 不匹配 | 401 / 403 | 修正 Platform role / app grant / service client scope 后刷新授权 |
| 财务摘要范围过宽 | 维保收入和成本被污染 | Altoc 必须传入维保合同关联的 `contract_codes/project_codes`，Finance 不应只按客户泛化 |
| 重复同步 | 成本或贡献重复累计 | 验证幂等键、来源业务键和 upsert 规则；必要时清理测试数据后重跑 |

## 9. Phase 5 启动前置条件

只有以下条件满足后，才建议进入 Phase 5 统一经营驾驶舱与 AI：

1. 本文第 6 节端到端验收全部通过。
2. P3 / P4 变更已按模块拆分提交并可回滚。
3. 生产租户中 People、P3、P4 至少有一组完整演示数据。
4. 指标快照层设计已明确，不直接跨库查询业务表。
5. AI 场景只基于可追溯的指标快照、业务对象和 Codocs 文档来源。

