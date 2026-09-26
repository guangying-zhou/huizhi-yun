# 统一企业迁移分波计划（2026-09-23）

状态：用户已同意（2026-09-23）。本文件是 [统一企业应用实施台账](./Unified-Enterprise-Implementation-Plan.md) 在 G1 之后的执行排期，不替代台账条目；各项验收仍以台账 `[x]` 与证据为准。

## 1. 决策

1. **Console 页面最后迁移。** Console 是身份与策略权威，ADR-019 定为“控制台”辅助入口，且 ADR-017 规定未经凭据边界验收的 Console/Auth 路径不能因前端迁移放行。Console 页面迁入 Host 排在第 4 波，前置条件是 ADR-017 验收。
2. **页面与数据按业务链一起迁移（纵向切片）。** 测试租户业务数据已在统一库（兼容视图 + generation=1）；剩余的数据整合是按领域把跨模块 outbox 改为本地事务、收敛权威写入方和退役旧路径，只有和使用它的页面一起做才有收益。不做“先迁全部页面”或“先整合全部数据库”的横向批次。
3. **当前主线不变。** INT-606c（Codocs 我的文档）继续收口，G1 收尾测试优先完成。

## 2. 分波

| 波次 | 内容 | 进入条件 | 退出条件 | 负责 |
| --- | --- | --- | --- | --- |
| 0 | G1 收口（角色矩阵、C1～C3 复核）；INT-606c 收口 | — | G1 放行记录；INT-606c 台账证据齐备 | Claude + 用户 |
| 1 | 在现有 Aims/Assets 页面上完成 P3（INT-302/303/304/306），形成**页面迁移模板**；按批迁移未登记页面 | 波次 0 的 G1 放行 | 每批：页面注册、BFF、Runtime 操作、manifest 导航、测试与 1440/390 检查齐备；模板写入本文件 §4 | Codex 实施；Claude 定模板与复核 |
| 2 | P5 试点联合验收（INT-501～507） | 波次 1 覆盖试点业务链所需页面 | 试点验收报告（INT-507） | Claude（切换与验收）+ Codex（证据与脚本） |
| 3 | P6 按业务链扩展：Altoc↔Aims（合同到交付）→ Finance（开票到到账）→ People（投入到成本） | 波次 2 通过 | 每条链：合同复审、页面迁移、共享事务替代 outbox、旧路径退役清单 | Claude 定链合同、事务与切换；Codex 做页面与常规映射；ChatGPT-6-Pro 评审合同 |
| 4 | Console 页面迁入 Host | ADR-017 凭据边界验收 | 无双 Shell、无重复公共导航；Console 仍为身份/策略权威 | 待排 |

## 3. 当前缺口（2026-09-23 盘点）

Host 已登记：Aims 47、Assets 11、Codocs 10 个页面路由（`deploy/test-env/enterprise-host-routes.mjs`）。Aims `app/pages` 中另有 74 个未登记页面，按域分组：

| 组 | 页面 | 归属波次 |
| --- | --- | --- |
| 项目子页 | `projects/[id]/` 下 environments、metrics、risks（均为约 50 行的占位页）、output（交付物，约 1100 行）、releases（约 700 行）、settings（约 2000 行，项目管理配置）、milestones/[milestoneId]、service-desk | 1（service-desk 属 Altoc 链，归 3） |
| 产品规划 | `products/[productCode]/` 下 cycles、objectives、planning-items 子页、models、cost、cost-rules、components、adoption、features、views、documents、settings、release-comparison、feature-version-matrix | 1（分多批） |
| 管理与报表 | admin/*、integration-operations、quality-reviews、reports、portfolios/[id]、project-templates、project-resources、project-documents、requirements/batch | 1 后段或 3 |
| 其他 | login、embed、help、settings/profile、product-setup、board、根入口 | 逐项判断：Host 已有统一登录与布局的不迁，兼容入口按 ADR-019 规则处理 |

## 4. 页面迁移模板（第 1 波首批完成后固化）

每个页面迁移交付：
1. **盘点**：页面实际调用的每个 METHOD + 路径、所需人员权限（manifest resource/action）、对应 Runtime 操作与 capability；列出可达写动作。
2. **路由**：Host 页面注册（`enterprise-host-routes.mjs` / registry 生成源）与业务 API 注册（`composition/business-api-*`，运行 `pnpm --dir enterprise generate:api-readiness`）。
3. **BFF**：薄路由 + `enterprise/server/utils/*`；签发 Runtime 许可前经 Foundation `loadAuthorizationSnapshotFromConsoleRuntime` + `authorizationResourcesAllow` 检查资源权限（参照 `enterpriseAimsProjects.ts`、`enterpriseAimsWeeklyReports.ts`）；依赖不可用为 503，不伪装 403。
4. **Runtime**：操作登记于 `foundation/server/utils/enterpriseRuntimeClient.ts`（精确 path + capability）；Runtime 路由校验签名 actor 与许可；需要新 capability 时，manifest、Console grant seed/verify 与契约测试同批交付。
5. **导航**：manifest 业务导航声明，不在 Host/Platform/Console 手写权限表。
6. **测试**：桥接测试（actor 绑定、缺权 403 不调用 Runtime、依赖 503、输入校验）；写动作加幂等重放；readiness 清单不漂移。
7. **验收**：真实浏览器 1440/390（由 Claude 或用户会话执行），空/加载/失败/只读状态。
8. **文档**：台账对应条目、API 文档、`MODULE_CONTRACTS.md`（有跨模块调用变化时）。

## 5. 协作规则

- Codex 通过 Orca 终端接收任务书，证据写回任务书指定的回执位置；共享文件（Runtime router、Host 入口、manifest 生成器、Foundation 身份代码）改动前由 Claude 指定唯一负责人。
- 授权、capability、grant、数据迁移与切换由 Claude 负责；任何环境写入、部署、grant 变更按根 `CLAUDE.md` 单独批准。
- MiMo 按文件清单提交；ChatGPT-6-Pro 评审每条业务链合同与关键授权改动。

## 6. 第 1 波首批任务

见 [W1-A 任务书](./Unified-Enterprise-Migration-W1A-Codex-Brief.md)：项目子页盘点，并迁移只读/占位页与交付物、发布的读取路径；写动作待 Claude 复核合同后另批。
