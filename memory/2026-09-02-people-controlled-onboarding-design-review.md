# Review: People 受控员工入职编排设计评审

Subject: `memory/2026-09-02-people-controlled-onboarding-design.md`
Round 1: 2026-09-02（对 DRAFT）— 4 阻断 / 2 内部矛盾 / 5 约定偏差 / 3 状态遗漏
Round 2: 2026-09-02（对 REVISED DRAFT）— 第一轮 14 项全部处理；新增 1 阻断 / 3 应明确 / 2 范围风险 / 1 生产缺陷（R7，已写入方案）
Verdict: 方向采纳（方案 B）；修订质量高，但零引用闸门的实现方式必须先定死，否则闸门会静默失效
Scope: 仅评审，未改动任何代码；行号对应本次检查时 `main` 分支的文件状态

## 已核实的代码事实（两轮通用）

| 断言 | 核实结果 | 证据 |
| --- | --- | --- |
| 未命中时生成确定性 `dt-*` UID | 属实，`sha256` 前 16 字节十六进制 | `data-runtime/internal/apps/directory/adapter.go:158,329` |
| 唯一邮箱匹配只在钉钉 identity 不存在时执行 | 属实；且命中 >1 条会整条跳过 | `data-runtime/internal/apps/directory/adapter.go:148-166` |
| 经理未绑定时同样合成 `dt-*` | 属实 | `data-runtime/internal/apps/directory/adapter.go:205` |
| 钉钉无工号时 `employee_no` 退化为 UID | 属实，而 `uk_people_employee_no` 是唯一键 | `adapter.go:175-176`；`people/docs/people_schema.sql:125` |
| `dt-*` 会成为可登录主体 | 属实，`source_provider='people'`、`status='active'` | `data-runtime/internal/apps/directory/console_lifecycle.go:281` |
| Console 已有重复创建检查 | 属实，同时查 `directory_users` 与 pending operation | `console_connector_management.go:162-187` |
| LDAP 创建强制要求调用方传明文密码 | 属实，无自动生成分支 | `console_connector_management.go:437` |
| Connector 成功后才写 Directory 用户 | 属实，`Complete` 收到成功回执才调 `applyUser` | `data-runtime/internal/apps/directory/operations.go:128` |
| 岗位自动授权含按角色名文本匹配 | 属实 | `platform/server/utils/peoplePositionAuthorization.ts:176` |
| 岗位授权闸门有 exact-code 绕过分支 | 属实 | `platform/server/utils/peoplePositionAuthorization.ts:236` |
| `main_position` 是派生分类的**默认值** | 属实，关键字都不命中且 source 非 custom 即为它 | `platform/server/utils/roleCatalogCategory.ts:70` |
| People 全链路依赖非空 `employee_uid` | 属实，`NOT NULL` + `uk_people_employee_uid` | `people/docs/people_schema.sql:98,124` |
| 连接器已正确映射 `mobile` 与 `onboardDate` | 属实，毫秒时间戳已转 `YYYY-MM-DD` | `notification-runtime/internal/providers/dingtalk.go:351,356,632` |
| `people_employees` 没有 `mobile` 列 | 属实，手机号只存活在 `metadata->$.directory_user` | `people/docs/people_schema.sql:96-131` |
| 每次同步全量覆盖 `metadata` | 属实，`metadata = VALUES(metadata)` | `data-runtime/internal/apps/people/sync.go:151` |
| 生命周期命令从该 JSON 路径读手机号/邮箱 | 属实 | `people/directory_lifecycle_operation.go:168-169,213` |
| 空值一律保留旧值，无法纠正或清除 | 属实，两端都用 `COALESCE` | `sync.go:149`；`console_lifecycle.go:281` |
| 各应用使用独立数据库，由同一 data-runtime 持有连接 | 属实，`apps.<app>.db` 逐个配置 | `data-runtime/config.example.json` |

### R7（生产缺陷，已写入方案）钉钉入职日期与手机号静默丢失

用户反馈同步后入职日期不更新、手机号取不到。传输链路是通的——连接器映射正确（`dingtalk.go:351,356`）、Data Runtime 透传（`adapter.go:212,222`）、生命周期命令确实携带 `mobile`（`directory_lifecycle_operation.go:213`）。缺陷在存储归属与可观测性：

1. 手机号在 People 侧无第一类存储。`people_employees` 没有 `mobile` 列，手机号仅以副作用形式存活在 `metadata->$.directory_user`，而每次同步 `metadata = VALUES(metadata)` 全量覆盖（`sync.go:151`）；生命周期命令又恰好从该 JSON 路径读取（`directory_lifecycle_operation.go:168-169`）。任一次快照缺手机号，字段即永久送空。
2. 空值语义等同「不更新」。`onboard_date = COALESCE(VALUES(onboard_date), ...)`（`sync.go:149`）与 `mobile=COALESCE(NULLIF(VALUES(mobile),''),mobile)`（`console_lifecycle.go:281`）都把「未下发」和「下发空值」归并为保留旧值，字段永不写入而同步仍报成功。
3. 无字段级信号。`ResolveDingTalkPeopleBatch` 只统计用户级 `skipped`，无法区分「钉钉没给」和「我们丢了」。

外部成因：钉钉 `topapi/v2/user/list` 的 `hired_date` 与 `mobile` 依赖应用权限，缺权限时字段被整体省略而接口仍返回 `errcode=0`。

**处理**：已按用户要求写入设计文档新增章节「钉钉字段落地：入职日期与手机号」，含入职候选阶段字段、存量同步的列化与来源优先级、连接器权限探测、字段级回执与验收标准；同步更新了 Domain Model、Success Criteria、Rollout 第 7 步、Dependencies 与 Open Questions。该项不依赖归并闸门，可与 Rollout 第 2、3 步并行。

## 第一轮 14 项处理情况

| # | 问题 | 状态 | 修订做法 |
| --- | --- | --- | --- |
| 01 | 归并范围只覆盖 People/Console/Platform | 已处理 | 改为「全应用引用扫描必须为零」闸门；Recovery 增加第 2 步跨模块扫描；Premise 1 明确归并是唯一例外。选择不引入 `directory_user_aliases`，理由（别名无法修复业务库已持久化的精确 UID，会把双主体永久化）成立 |
| 02 | LDAP 创建强制明文密码 | 已处理 | Console 前置改造升为 Rollout 第 1 步；密码由 Console 生成、内存加密、只存密文与一次性凭据 hash；改造完成前不开放 People 发起 provisioning |
| 03 | `manager_uid` 仍会合成 `dt-*` | 已处理 | 新增 `manager_provider_subject` / `manager_onboarding_code`；步骤 1 写明禁止合成；补入 Success Criteria |
| 04 | 敏感角色闸门有绕过路径 | 已处理 | 从验收标准改为 Rollout 第 4 步的明确改动，并要求契约测试覆盖 exact-code 绕过（但见 R4） |
| 05 | `completed` 三种说法 | 已处理 | Premise 3 / 状态机 / Platform 段 / Success Criteria 统一为 baseline 成功即完成，岗位角色缺失转待办 |
| 06 | 邮箱唯一命中一律转冲突 | 已处理 | 步骤 1 改为五分支，干净命中自动复用，按建议收窄冲突条件 |
| 07 | 权限动作用下划线 | 已处理 | 改为 `onboarding:resolve-conflict` |
| 08 | Operation code 中间段 | 已处理 | 改为 `people.directory.identity-reserve.v1` / `people.directory.user-provision.v1` |
| 09 | schema 未对齐离职单 | 已处理 | `profile_revision` → `object_version`；补终态审计字段与对称 CHECK |
| 10 | capability 未命名 | 已处理 | 固定 `console:directory-identity:reserve` / `console:directory-user:provision`，注明双 audience grant |
| 11 | Rollout 缺契约交付项 | 已处理 | 新增段落列出 MODULE_CONTRACTS、manifest、grant seed/verify 与测试矩阵 |
| 12 | 预留过期无状态 | 已处理 | 新增 `reservation_expired` 状态、失败表行与出口规则 |
| 13 | 异常出口未定义、`cancelled` 分类错误 | 已处理 | 终态与可恢复状态分列；四个异常状态各有确定出口 |
| 14 | `employee_no` 污染 | 已处理 | Recovery 第 5 步纳入工号修复；The Assignment 增加工号与逐模块引用计数两列 |

修订还有两处超出评审要求的改进，值得保留：Rollout 重排为「Console 密码契约先行」，以及 The Assignment 从验证清单升格为归并闸门的输入。

## 本轮新增问题

### R1（阻断）零引用闸门的引用清单不能靠命名约定生成，否则会静默漏判

Recovery 第 2 步是本轮唯一的数据安全保障：闸门判零就放行归并。但 UID 在各库里并非只以 `*_uid` 形式出现——`created_by`、`updated_by`、`confirmed_by`、`calculated_by`、`approved_by` 一类列同样承载 UID。

各模块两类列名种数：aims 22 / 17，assets 15 / 6，codocs 14 / 9，workflow 3 / 1；finance 与 altoc 两类都有（`owner_uid`、`issuance_responsible_uid`、`collection_responsible_uid`、`confirmed_by`、`calculated_by` 等）。

后果是确定的：一个只按 `_uid` 收集列的扫描器，会对 finance 这类模块报「零引用」，闸门放行，归并直接损坏数据。而闸门失效是无声的——没有任何报错。

**建议**：清单从 `information_schema` 列举、配人工确认白名单；扫描结果必须逐列输出「模块 → 表 → 列 → 命中行数」，任何不在白名单内的新列一律 fail-closed（阻断并要求人工确认），绝不按零处理。闸门的正确性必须可复核，不能只给一个总数。

### R2（应明确）扫描能力的归属没写，按字面理解会违反模块边界

Recovery 第 2 步只说「扫描 Aims、Assets、Codocs、Finance、Altoc、Workflow 的精确 UID 引用」，没说这个扫描住在哪。按仓库规则模块间禁止直连数据库，People 不能去连别人的库。

好消息是不需要给 6 个应用各加一个 service endpoint：data-runtime 是单进程持有全部应用库连接的（`config.example.json` 的 `apps.<app>.db` 逐个配置），扫描的自然归属就是它，作为一个只读能力实现即可。

**建议**：在设计里写死这一点。不写清楚，Rollout 第 6 步的成本会被按「一个脚本」估算，而实际取决于选哪条路。

### R3（时序漏洞）零引用是时点结论，`dt-*` 在归并完成前仍是可被选中的活跃用户

Recovery 第 4 步只「暂停该员工的新 HR lifecycle operation」。这挡不住其他应用的写入——`dt-*` 是 `status='active'` 的 Directory 用户（`console_lifecycle.go:281`），在扫描通过到第 7 步停用之间，任何人都可能把他加成 Aims 项目成员或 Assets 使用人。

**建议**：调整顺序为「先停用/隐藏 `dt-*` 主体（Directory 置 inactive 或至少从各应用人员选择器排除）→ 扫描 → 归并提交前紧邻重扫一次并比对计数，不一致即中止」。当前顺序下闸门可以被合法业务操作绕过。

### R4（歧义，按字面实现会造成行为破坏）「明确分类为 `main_position`」与派生默认值冲突

Rollout 第 4 步与 Success Criteria 写成「只有明确分类为 `main_position` 的角色可自动授予」「未分类角色不得自动授予」。这两句在代码语义下自相矛盾：`main_position` 恰恰是 `deriveRoleCatalogCategory` 的**默认返回值**（`roleCatalogCategory.ts:70`）——关键字都不命中且 source 非 `custom` 的角色，派生结果就是 `main_position`。「未分类」和「main_position」在现状里是同一批角色。

若按「必须有 `tenant_role_catalog_metadata` 人工分类」实现，所有租户现存岗位角色的自动授权会立刻整体停摆。

**建议**：拆成两条互不依赖的规则——(a) 派生或人工分类为非 `main_position` 的角色一律不得自动授予；(b) 删除 `!manualCategory && exactCodeMatch` 绕过分支（`peoplePositionAuthorization.ts:236`）。这两条即可关闭 R1 轮指出的漏洞。是否额外要求人工分类，作为独立开关另行决策，并给迁移期。

### R5（范围风险）零引用闸门可能让刘凯案例本身落在本轮交付之外

归并能力是这份设计的动因之一，但闸门一旦扫出非零就阻断，而 Rollout 第 7 步「迁移现存异常主体并验证后，移除旧的 unmatched → `dt-*` 路径」默认迁移会成功。若刘凯的 `dt-*` 已被任一模块引用，第 7 步就没有完成条件，本轮既交付不了归并、也移除不掉旧路径。

**建议**：先跑 The Assignment 的清单，用真实结果决定第 6、7 步是否成立；同时为「非零引用」写明替代出路（另立跨应用迁移设计，或旧路径延后移除并保留双写防护），不要让 Rollout 停在一个没有失败分支的步骤上。

### R6（小）存量悬挂 `manager_uid` 没有清理路径

新规则只解决「今后不再合成」。历史上已写入、且指向从未落地为 employee 的经理 `dt-*` 的 `manager_uid`，不属于任何一个待归并主体（那位经理没有 employee 行），归并流程覆盖不到。

**建议**：Rollout 第 2 步附带一次性盘点——把指向不存在 employee 的 `manager_uid` 置空并进待补办清单。

## 下一步

1. 定死 R1 的清单生成方式与 fail-closed 语义，以及 R2 的扫描归属（data-runtime 只读能力）。这两条决定 Rollout 第 6 步能不能写成可验收的任务。
2. 按 R3 调整 Recovery 步骤顺序，补「停用 → 扫描 → 提交前重扫比对」。
3. 按 R4 把岗位闸门拆成两条规则，避免把「未分类」和「非 main_position」混为一谈。
4. 先跑 The Assignment 的刘凯清单（含 R1 要求的逐列口径），用结果回填 R5 的分支。
5. R6 作为 Rollout 第 2 步的附带项。
6. 以上闭环后，设计可进入实现；Console 密码契约（Rollout 第 1 步）与 onboarding schema（第 2 步）之间没有依赖，可并行启动。

## 评审方法

- 逐条核对 `data-runtime/internal/apps/directory/`（adapter、console_lifecycle、console_connector_management、operations、sync）、`platform/server/utils/peoplePositionAuthorization.ts`、`platform/server/utils/roleCatalogCategory.ts`、`platform/server/utils/lifecycleServiceCommand.ts`、`people/docs/people_schema.sql`、`people/app.manifest.json` 及全仓 11 个 manifest 的动作命名。
- 跨模块 UID 列清单分别按 `*_uid` 与 `*_by` 两种命名统计，两者结果不一致正是 R1 的依据。
- 数据库拓扑取自 `data-runtime/config.example.json` 与各模块 `.env.dev`。
- 未执行构建、lint 或测试：本次为纯文档评审，无代码改动。
