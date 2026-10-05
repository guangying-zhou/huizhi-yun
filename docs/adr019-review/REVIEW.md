# ADR-019 符合性审查：企业统一导航与对象工作台

审查日期：2026-09-19  
仓库：`guangying-zhou/huizhi-yun`  
分支：`feat/adr018-enterprise-integration`  
固定提交：`0ca042dbe721e7ba72a290a7d90a551d561e4d04`  
父提交 / 当前对照 main：`baa0bfaa605a723ff5dabc6e946a825ee624f917`

## 1. 结论

**部分符合，技术与视觉方向正确，但不能据此通过 ADR-019 的 FE-1 阶段验收，更不能宣布整份 ADR 已完成。建议修复本报告列出的当前路径问题后继续试点。**

本次已经不再是上一轮的“三个横向按钮”。统一顶部栏、单一业务侧栏、业务分区声明、页面注册、移动抽屉和项目对象导航已进入 Host 代码。需要继续解决的是：菜单缺少用户权限与运行可用性的过滤；创建项目页被错误识别为项目对象；旧 Console Shell 的兼容链路仍允许重复外壳；对象返回与切换未形成闭环；导航去重规则与多入口发现同一对象的原则存在冲突。[S1–S9]

**销售、人员、文档没有全部迁入，不应单独作为产品试点失败的理由。** ADR 允许分阶段建设，也不允许用空菜单伪装完成。但已存在的正式能力必须按当前批次登记 Host 或受控兼容入口；“目录定义中有人力资源”不等于“人力入口已可用”。[D1–D2]

## 2. 基准、证据与范围

基准为当前分支的 `docs/ADR-019-Enterprise-Business-Frontend-Integration.md` v1.2，以及配套 `docs/Enterprise-Business-Navigation-and-Interaction-Spec.md` v1.1；同时与上一轮交付的人力独立版本核对。当前分支将显示名称细化为“交付与服务、人力资源、协同文档”，代码与分支文档在这些标签上一致，本报告不把它们判为偏离。[D1–D2]

本次是风险导向的源码与调用链审查，不是整个分支的逐行安全审计。实际执行了原仓库的导航纯函数测试，以及基于同一提交精确源码的行为探针；没有执行完整 Nuxt 构建、真实浏览器、真实用户会话、数据库或生产部署验收。

本次固定提交的父提交已经是 main，不能沿用上一轮公开快照“无共同祖先”的说明。下载包中的 `source/` 只是为复现准备的八个源码/测试文件，不是仓库完整副本。所有八个文件均按 Git blob SHA 验证与固定提交一致，见 `results/source-integrity.json`。

## 3. 当前真正生成的菜单

执行 `buildBusinessNavigation(businessModules, businessAreas, auxiliaryAreas)` 得到以下四个实际分区、十二个叶节点。[S1–S4；本地结果见 `results/observations.json`]

| 一级区域 | 二级分组 | 三级项 | 当前目的地 |
| --- | --- | --- | --- |
| 产品 | 产品目录 | 全部产品 | `/assets/products` |
| 产品 | 产品规划 | 产品管理空间 | `/aims/products` |
| 产品 | 产品资产 | 知识产权 | `/assets/ip-assets` |
| 产品 | 产品资产 | 数字资产 | `/assets/digital-assets` |
| 交付与服务 | 项目管理 | 项目总览 | `/aims/projects` |
| 交付与服务 | 执行协同 | 任务中心 | `/aims/work-items` |
| 交付与服务 | 执行协同 | 工时日历 | `/aims/timesheet` |
| 交付与服务 | 执行协同 | 周报汇总 | `/aims/weekly-reports` |
| 经营 | 企业资源 | 自用资产 | `/assets/physical` |
| 经营 | 企业资源 | 资源台账 | `/assets/resources` |
| 控制台 | 业务配置 | 产品字典 | `/assets/admin/asset-categories` |
| 控制台 | 业务配置 | 资产字典 | `/assets/admin/dictionaries` |

`businessModules` 仍然只有 Aims、Assets。“工作台、销售、人力资源、协同文档”虽然在分区目录中声明，但没有贡献的页面，生成器会将其删除。

人力资源的“组织与岗位、员工管理、人员成本、绩效管理”四个二级分组在定义中已经与经营分离，方向符合要求；尚无独立可用入口，不能标记 FE-A19 完成。测试 Gateway 源码还显式拒绝 `/people/**`，因此不能简单加一个指向该路径的链接来宣称接入。应先验证对应环境的正式业务实现或批准兼容去向，再开放菜单。[S2、S13]

## 4. 发现与建议

### F1 — [P1，阶段验收前必修] 导航仍是静态目录，没有依据当前人员权限和能力状态生成可见菜单

**对应 ADR：** §4.2、§6.3；FE-A15、FE-A18；涉及后续人力 FE-A20。

**代码位置：**

- `enterprise/nuxt.config.ts`：构建时生成 `public.businessNavigation` 和 `public.objectWorkspaces`。
- `enterprise/composition/registry.mjs:63–76`：叶节点最终只保留 `label` 与 `to`。
- `enterprise/app/layouts/default.vue:10–13`：直接读取该目录，`primary`、`auxiliary` 没有加入当前用户的授权过滤。
- `enterprise/app/components/HostNavTree.vue`、`HostObjectNav.vue`：遍历传入项；后者也没有对象权限过滤。[S1、S5–S8]

**观察：**当前生成的每个叶节点属性集合均为 `label,to`，缺少资源/动作引用、稳定叶节点标识和运行可用性信息。只要进入同一 Host，菜单呈现不会随人员权限而改变；例如“产品字典”“资产字典”与项目设置没有在导航层按权限裁剪。

**影响边界：**这是导航可见性与可用性契约未落实，可能导致无权入口、错误的操作预期和点击后的拒绝。它不证明后台已经允许无权读取或写入，本报告没有将其描述为已发生的数据泄漏或鉴权绕过。

**修正：**

在静态目录中保留正式 manifest 的资源/动作引用及目的地、稳定 ID；通过已验证用户/租户/环境上下文和实际能力状态生成运行时可见视图，裁剪不可见叶项与空父分组。父分组只需有一个可见子项；不要要求所有子权限。对象菜单还需执行对象层权限过滤。撤权、切换和策略更新后重新计算，继续保留服务端最终校验。

不要把业务区 code 当作后端 appCode，不要另建一份独立权限算法，也不要全局放开“控制台”来解决显示问题。

**回归建议：**Aims 普通成员、Assets 只读用户、受限管理员分别检查相同菜单；后续财务用户、人事用户分权测试；撤权后菜单与历史收藏均重新过滤；组内一个有权子项即可显示组。

### F2 — [P2，当前功能缺陷] `/aims/projects/new` 被识别为 ID 为 `new` 的既有项目

**对应 ADR：** §4.3、§4.5；FE-A03、FE-A13、FE-A14。

**代码位置：**`enterprise/app/layouts/default.vue:18–26`。

`objectMode` 将工作区 `base` 去掉末尾动态参数后作字符串前缀匹配，再把剩余路径的第一段直接作为对象标识。对 `/aims/projects/new`，得到：

```text
objectPath = /aims/projects/new
项目内链接 = /aims/projects/new/plan
           /aims/projects/new/board
           /aims/projects/new/members
           /aims/projects/new/edit
```

`/aims/projects/new` 是已登记的创建页面，不应出现已经存在的项目上下文。[S3、S5]

**验证方式：**从经 Git blob SHA 验证的 Vue 文件抽取实际 `objectMode` 函数体，使用 Node 执行输入路径。探针没有改写判断逻辑，结果记录在 `results/observations.json`。这验证的是该函数的控制流，不是浏览器页面截图。

**修正：**以已匹配路由的明确元数据/名称和正式 params 决定是否进入对象模式；创建路由显式排除，对象引用按本路由契约校验。真实项目通过授权加载后显示名称，不让不存在的标识形成可操作对象树。不要把所有未来业务 code 都武断限制为数字。

**回归建议：**创建页不进入项目模式；合法项目详情及子页进入；无效、删除、无权对象没有误导菜单；新标签与刷新路径一致。

### F3 — [P2，旧入口兼容问题] 旧 Console Shell 与 Enterprise 的重复外壳链路尚未退出

**对应 ADR：** §4.6、§7.2；FE-A01、FE-A03、FE-A11、FE-A12。

**代码位置：**

- `console/app/pages/shell/[appCode].vue`：仍显示 AppRail、公共页头、通知/个人菜单，并用 iframe 承载应用。
- `foundation/app/utils/applicationShell.ts`：仅 `workspace`、`console` 作为原生例外；Aims、Assets、Enterprise 仍可包装为 `/shell/{appCode}?target=...`。
- `deploy/test-env/enterprise-topology.mjs` 与 `deploy/cloudflare/tenant-gateway/src/index.js`：旧 shell 路径不匹配 Enterprise pilot；内层 `/aims/...`、`/assets/...` 在 pilot 开启时进入 Host。
- `enterprise/app/layouts/default.vue`：常规输出其自己的公共页头与侧栏。[S5、S10–S12]

**触发条件：**当前租户允许相应同源应用、Enterprise pilot 开启、用户打开既有 `/shell/aims?target=/aims/products` 等链接，且没有部署在源码之外的额外重定向。

根据上述源码链路，外层继续是 Console Shell，iframe 内可加载完整 Enterprise Shell。实际执行 resolver 的结果是：`/shell/aims -> null`，`/aims/products -> page`；余下行为来自模板与 Gateway 代码阅读。没有访问实际部署重演该 UI，部署外配置需另验。

**修正：**针对已经迁移的页面，基于租户/环境/发布版本的受控登记，将旧 Shell 入口定向到 Host 正式目的地，保留 target、允许的 query/hash 和登录后返回；未迁移应用继续保留明确的兼容方式。也可采用经批准的无重复 chrome 适配。不能仅在新布局里再加一条侧栏，就将整个旧入口链判为单一 Shell。

不是要求删除所有 iframe；编辑器及未迁移独立能力依旧遵守各自契约。不能把页面兼容重定向用于 OIDC 回调或真实写请求。

**回归建议：**旧书签、应用卡片、通知链接、刷新、新标签，以及显式 Host 入口分别测试；已迁移流程一套公共区域，未迁移明确标识并保留返回。

### F4 — [P2，对象工作流未闭环] 项目返回固定、切换器缺失，折叠时改变了导航语义

**对应 ADR：** §4.5；FE-A14、FE-A17。

**代码位置：**

- `aims/layer/entry.mjs:31–46`：`backTo` 固定为 `/aims/projects`。
- `enterprise/app/components/HostObjectNav.vue:22–32`：直接使用固定返回，并只显示路径最后一段作为对象标题，没有共享项目切换器。
- `enterprise/app/layouts/default.vue:96–108`：先判断 `collapsed` 并渲染全局业务目录，随后才判断 `objectMode`。
- `aims/layer/pages/enterprise-project-detail.vue`：项目根详情仍固定返回项目列表。[S3、S5、S8、S14]

**影响：**从产品上下文进入研发项目后，侧栏的返回不会还原产品来源；从带筛选/分页的列表进入，也不会经这条返回路径带回原列表状态。对象侧栏没有依据授权项目事实显示项目名称与切换器。折叠侧栏后，原项目导航会变成全局业务区目录，改变了“折叠只换呈现”的契约。

本结论指新的共享对象导航及已阅读的根详情，不声称所有旧项目页面中的 ProjectNavbar 或项目树都已被删除。

**修正：**建立有权对象上下文及共享导航模型，包含对象标签、可用动作、项目切换器/按需项目集树、经过验证的来源与默认返回。允许在合法返回 URL 中保留筛选/分页/排序，敏感草稿不入 URL。首次深链接或来源无效时才回到固定默认列表。桌面展开、折叠及移动抽屉都消费当前同一导航模型，而非分别选不同目录。

**回归建议：**产品→研发项目→返回产品；项目列表第3页带过滤→详情→返回恢复；首次打开深链使用安全默认返回；折叠/窄屏保留项目导航；切项目后不残留上个对象状态。

### F5 — [P2，扩展前修订导航契约] 用目的地 URL 全局去重，误将“多入口”当成“重复实现”

**对应 ADR：** §4.1、§6.3、§7.1；FE-A14、FE-A19 相关稳定标识要求。

**代码位置：**`enterprise/composition/registry.mjs:66–76`；`HostNavTree.vue` 的标签 key 与展开状态。

生成器使用全局 `seen` 集合，发现相同 `page.to` 就抛出 `Business menu target appears twice`。ADR 允许同一项目/对象从不同业务入口发现，要求复用正式详情，不要求每条目的地只能出现一个入口。[D1、S1、S7]

**执行的探针：**在测试 fixture 中，为已登记的 `/aims/projects` 加入一个“产品→研发协同”的第二发现入口，同时保留交付的入口。生成器拒绝。当前真实目录没有这条第二贡献，因此本项属于可复现的契约限制，不是声称现有构建因重复项而失败。

**修正：**按稳定导航节点 ID 检查节点冲突，按路由名/handler 注册检查重复实现；允许多个合法快捷节点引用同一正式目的地。当前项定位由来源/业务区上下文与确定性规则决定，不以删除其他入口解决。叶节点不要只留中文标签和 URL，菜单移动或改名不应破坏收藏、展开与迁移映射。

**回归建议：**同一项目列表/详情由不同业务区发现仍是同一实现；重复节点 ID 拒绝；同名不同节点可按身份区分；无权来源不得使目标权限扩大。

## 5. 其他差距与可分期事项

### 5.1 分组交互偏离已确认规则

`HostNavSections.vue` 将所有一级区域固定渲染为普通标题；`HostNavTree.vue` 每次路由改变都把当前项祖先以外的分组重置收起，并用中文标签作为 key。它没有实现 ADR §4.4“当前业务区展开、恢复适用分组状态、其他业务区默认收起”的完整行为。[S7、S9]

当前作为简单试点导航可以继续迭代，但不能当作 FE-A13 已验收。若团队有意改成所有业务标题常驻、仅二级折叠，应明确修订交互契约并确认；否则按既定要求实现稳定 ID 和经过权限过滤的偏好恢复。不能仅因为新的样式更像某个 Dashboard 就忽略原有规则。

### 5.2 人力与旧入口映射

人力已经被放在正确的一级定义，不再归经营，这一点符合方向。只是生成目录及当前测试环境都没有可用人力入口。应在既有实施台账区分“定义已纳入”“正式入口或兼容入口已接通”“真实人事/财务分权验收完成”。

已有正式能力可以先登记受控兼容入口，但不能指向当前被禁用的 `/people/**` 后又将 503 当作暂时正常。对已实现但未迁入的页面，需要逐项映射；不应通过把 sales/people/codocs 全部静默删除来形成目标菜单。[D1–D2、S13]

### 5.3 产品工作台与后续对象整合

当前“全部产品”和“产品管理空间”合到产品业务区，符合入口重组方向，也没有仅凭名称把 Assets 产品主档和 Aims 空间混成一个对象。原 Aims 的部分项目页面开始直接复用，是正确的渐进路线。[S3–S4]

但这尚不足以验证 FE-A05：查产品、选择正确关联空间、进入版本与研发执行、返回原产品，需要真实任务路径测试。不要将“两个菜单放到同一区”作为完整产品工作台验收，也不要求第一期补完所有商业规格及客户功能。

## 6. 符合性矩阵

| ADR 项目 | 本次判断 | 依据或缺口 |
| --- | --- | --- |
| 六主两辅目录、人力独立定位 | 定义符合，实际可达性部分完成 | 八区 shape 已有；实际仅四区12项；HR无页面贡献 |
| 单一 Host 的侧栏与公共布局 | 直接 Host 方向符合，兼容链未通过 | 新布局已有；旧 Shell 组合见 F3 |
| 显式页面与菜单注册 | 基础符合 | 路由检查及原七项纯函数测试通过 |
| 运行时菜单权限与能力过滤 | 不符合当前要求 | F1；静态目录无授权投影 |
| 三级树与折叠/状态恢复 | 部分实现 | 树已有；一级不可折叠、状态重置；对象模式折叠变语义 |
| 对象进入、切换、返回 | 不符合当前要求 | F2、F4 |
| 多入口同一正式实现、稳定叶节点 ID | 契约需修订 | F5；ID和权限引用未贯通 |
| 原菜单与正式深链接映射 | 尚不能验收 | F3以及待接入旧能力；需逐项覆盖确认 |
| Host METHOD + PATH 就绪性 | 已见结构性改进，整链未验收 | 中间件改从路由登记派生，不再手写旧白名单；未跑完整业务HTTP链 |
| 产品试点语义与工作流 | 方向部分符合，验收不足 | 原页面复用、主档与空间分开；完整用户路径未运行 |
| 人事/财务/员工/管理员分权 | 未验收 | 人力尚未接入，且当前菜单过滤缺口需先修 |
| 会话、撤权、多标签、跨租户状态隔离 | 本次未认证通过 | 不能用导航纯函数测试代替 |
| 脏状态、焦点、窄屏真实交互 | 本次未认证通过 | 未运行浏览器用户脚本 |
| 性能、旧静态资源、Host整包回退 | 本次未认证通过 | 未做构建/性能/部署恢复演练 |
| ADR-017/018整体安全与数据验收 | 本次不重新认证 | 本报告聚焦ADR-019；不沿用或关闭旧安全发现而无复核 |

## 7. 已执行测试及局限

环境：Node.js `v22.16.0`。

### 7.1 原仓库测试

```bash
node --test source/enterprise/test/business-navigation.test.mjs
```

结果：**7 passed，0 failed，0 skipped**。原测试及其导入源码未改写，均核对 Git blob SHA。

它们验证的是业务区形状、目标路径已登记、空组删除、非法登记拒绝和对象菜单模式登记等纯函数约束。未加载实际 Vue 页面、Nuxt/BFF 或真实授权。测试全绿与 F1–F5 存在并不矛盾：其中“同 URL 只能出现一次”甚至是当前测试主动要求的规则，需要按 ADR 修订。

### 7.2 新增行为观察探针

```bash
node tests/observations.mjs
```

该探针断言并记录当前实现行为，而非宣称期望规范均已通过。结果包括：实际四区十二项、叶节点只含 label/to、new 创建路径误入对象模式、固定项目返回、第二发现入口被拒绝，以及旧 shell/内层路径的不同路由匹配。

### 7.3 未执行

没有运行完整 Nuxt prepare/build/typecheck、浏览器端到端、真实用户授权、服务端数据读取/写入、跨租户并发、MySQL、Gateway线上发布或回退。没有修改远端源码、权限、数据库或部署。

`source/` 为最小测试材料，而非可运行企业系统；其中有些注册的页面只保留路径声明，页面文件不在此包。因此纯函数测试通过也不代表这些页面依赖闭包已经全部具备。

## 8. 建议收口顺序

**第一批：修复当前 Shell 的确定性问题。** 优先修 F1 和 F2，随后修 F4 的折叠/返回并打通 F3 的旧入口。为这些修复加入真实受限用户和正常业务路径测试，不要先扩展更多前端菜单。

**第二批：把导航契约补完整。** 稳定 ID、正式权限引用、可用性/迁移状态、canonical 目的地和多入口引用贯通；修复 F5，核对旧菜单和通知/书签的映射。

**第三批：按已经批准的阶段接入新业务。** 人力保持独立，能够接入正式能力时先开放有权且可用的入口；产品、项目对象流程通过后再扩展销售、经营和协同文档。不要为凑足6+2显示八个空区域。

完成这些修复后，重跑原单测和新回归，再执行 ADR 的真实岗位脚本与灰度/回退检查。实现台账应区分“代码已有”“测试通过”“当前环境部署”“业务验收完成”，不能只勾选一个“已完成”。

## 9. 源码依据索引

以下路径均在固定提交 `0ca042dbe721e7ba72a290a7d90a551d561e4d04` 阅读；本报告的引用标识对应文件，不指向浮动分支。`source/` 仅包含标注为打包的八项。

| 标识 | 文件 / 关键内容 | 是否打包原文 |
| --- | --- | --- |
| D1 | `docs/ADR-019-Enterprise-Business-Frontend-Integration.md`，v1.2；§4.2–4.7、迁移/验收 | 否 |
| D2 | `docs/Enterprise-Business-Navigation-and-Interaction-Spec.md`，v1.1；完整目录与稳定导航原则 | 否 |
| S1 | `enterprise/composition/registry.mjs` | 是 |
| S2 | `enterprise/composition/business-areas.mjs` | 是 |
| S3 | `aims/layer/entry.mjs` | 是 |
| S4 | `assets/layer/entry.mjs` | 是 |
| S5 | `enterprise/app/layouts/default.vue` | 是 |
| S6 | `enterprise/nuxt.config.ts` | 否 |
| S7 | `enterprise/app/components/HostNavTree.vue` | 否 |
| S8 | `enterprise/app/components/HostObjectNav.vue` | 是 |
| S9 | `enterprise/app/components/HostNavSections.vue` | 否 |
| S10 | `console/app/pages/shell/[appCode].vue`，目标解析、iframe与公共区域 | 否 |
| S11 | `foundation/app/utils/applicationShell.ts`，原生例外及shell包装 | 否 |
| S12 | `deploy/test-env/enterprise-topology.mjs`；`deploy/cloudflare/tenant-gateway/src/index.js` 的路由分发 | 仅前者 |
| S13 | `deploy/test-env/cloudflare-gateway.mjs`，测试环境禁用范围 | 否 |
| S14 | `aims/layer/pages/enterprise-project-detail.vue` | 否 |
| S15 | `enterprise/server/middleware/01-business-api.ts` | 否 |
| T1 | `enterprise/test/business-navigation.test.mjs` | 是 |

本审查结论针对上述固定提交和读取范围。新提交或额外部署重定向可能改变行为，需重新核对；本报告不是线上环境状态证明。
