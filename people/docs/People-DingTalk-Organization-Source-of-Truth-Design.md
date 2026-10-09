# People 钉钉组织事实源与 Console Directory 投影设计

> 状态：代码与契约已实现；真实租户迁移、服务授权安装和部署验收待执行
> 决策日期：2026-08-27
> 方案：B — 独立外部部门身份映射 + People 人员事实 + 可靠生命周期投影
> 边界：外部部门 identity/alias、双树归并、People 管理入口、部门名称/父级/排序/负责人采集、完整快照证明、缺失差异冻结与人工停用确认、人员/任职/姓名同步、LDAP 字段保护和可靠生命周期链路均已实现。首版对所有缺失正式部门都要求 `people:hr_source_sync:admin` 逐项确认；超过租户数量/比例阈值或根部门变化时升级为高风险提示。首版有意不开放权威字段应急 override，避免形成第二条事实写入通道；真实租户数据库迁移、服务授权安装、应用 manifest 发布和部署仍需按发布流程执行。
> 关联事实源：`people/CLAUDE.md`、`console/CLAUDE.md`、`platform/CLAUDE.md`、`docs/MODULE_CONTRACTS.md`

## 1. 决策摘要

钉钉作为正式行政组织的人力事实源，接管：

- 正式行政部门的名称、父子关系、排序、负责人和启停状态；
- 员工的正式主部门归属；
- 员工的在职、待离职、离职状态及最后工作日；
- 经明确配置允许同步的 HR 档案字段，例如真实姓名、显示名称、职位名称、邮箱和手机号。

汇智云继续维护：

- 稳定的 `dept_code` 和 `uid`；
- 委员会、虚拟组织、项目组及其成员关系；
- Console 登录账号、认证方式、会话和外部登录身份；
- People 中不由钉钉提供的岗位、职级、成本、绩效及历史业务事实；
- Platform 中的角色、授权关系、策略包和 revocation。

目标主链路为：

```text
People 管理员
  -> People 发起钉钉 HR 同步
  -> Console 校验技术集成并创建 Connector Runtime 任务
  -> Connector Runtime 拉取并规范化钉钉快照
  -> Data Runtime 解析外部身份并写入 People 人员/任职事实
  -> People 冻结可靠 Directory lifecycle operation
  -> Console 更新目录、账号、会话和最小 subject 投影
  -> Console 冻结可靠 Platform authorization operation
  -> Platform 撤销或更新授权并生成新的策略状态
```

People 是入转调离业务事实源，Console 是目录、账号和运行时鉴权事实源，Platform 是授权治理和策略包事实源。Connector Runtime 只负责供应商访问、分页、规范化和可靠传输，不拥有业务事实。

## 2. 背景与当前问题

现有钉钉部门同步根据钉钉部门 ID 生成新的 `DT-*` 部门编码，再写入 `directory_departments`。当 Console 已经存在人工或其他来源创建的正式部门时，该行为会创建第二棵部门树。

人员同步随后只按 `source_provider=dingtalk + external_ref` 解析部门，因此员工被分配到新建的 `DT-*` 部门，而不是原有 canonical 部门。以原有 `dept_code` 共享的文档、策略范围和业务数据不会自动跟随，最终表现为调动后的员工看不到部门共享文档。

当前 Console 中的“同步钉钉”同时承担技术集成和 HR 业务动作，权限属于 Console `directory_sync`。这与 People 已确定的“正常运营期入转调离先写 People”边界不一致。

People 当前的“同步目录”是生产切换期从 Console Directory 初始化 People 的迁移入口，方向是 `Console -> People`。它不能改名后直接复用为钉钉 HR 同步，否则会形成两个语义不同但名称相近的双向同步入口。

## 3. 目标与非目标

### 3.1 目标

1. 一个钉钉正式部门只对应一个汇智云 canonical `dept_code`。
2. 钉钉部门改名、移动或停用时保留原 `dept_code`，不破坏业务引用。
3. 人员主部门与在离职状态先在 People 形成事实，再可靠投影到 Console 和 Platform。
4. LDAP 等认证目录不得覆盖钉钉 HR 管理的姓名、正式部门和人员状态。
5. 离职事实生效后，Console 优先关闭访问并撤销会话；Platform 不可用不得回滚账号停用。
6. 同步具备预览、冲突处理、幂等、审计、失败重试和可回滚迁移能力。
7. 无损合并现有两套部门树，并保留历史追溯。

### 3.2 非目标

- 不把钉钉部门 ID 直接用作 `dept_code`。
- 不把钉钉凭证或 Connector Runtime 运维迁入 People。
- 不让 People 直接写 Console 或 Platform 数据库。
- 不根据通讯录中“本次未返回某人”推断离职。
- 不让钉钉覆盖委员会、虚拟组织、项目组或项目成员关系。
- 不把系统管理员人工重发策略包作为正常离职流程的一部分。
- 不在首期建设通用多 HRIS 主数据平台或完整组织变更审批中心。

## 4. 模块边界

| 模块 | 负责 | 不负责 |
| --- | --- | --- |
| People | HR 来源选择、同步入口、预览与冲突决策、员工与任职事实、离职生效日、Directory lifecycle operation | 钉钉 secret、登录账号、会话、策略包 |
| Console | `dingtalk.default` 技术配置、Vault 凭证、Connector enrollment、canonical Directory、账号与会话、subject export、Platform operation | 员工任职业务事实、HR 离职判断、Platform 授权治理 |
| Connector Runtime | 钉钉 API 调用、分页、完整快照、水位、规范化、重试和签名传输 | canonical `uid/dept_code` 决策、员工状态业务规则、账号停用 |
| Data Runtime | 外部身份解析、事务写入、receipt、operation 冻结与有界 drain | 浏览器权限判断、人工映射决策 |
| Platform | 企业角色、主体授权、policy revision、bundle 和 revocation | 目录 PII、人员任职事实、钉钉集成配置 |

跨模块调用继续遵守 HTTP API、短期 service token、精确 audience/capability、可信 tenant/deployment binding 和幂等 receipt，不新增跨模块数据库直连或共享 secret。

## 5. 字段事实归属

启用 `People HR source = dingtalk` 后，写入路径必须按字段归属失败关闭。

| 对象/字段 | 权威来源 | 规则 |
| --- | --- | --- |
| `dept_code` | 汇智云 Console Directory | 创建后稳定；钉钉改名、移动、换 ID均不得修改 |
| 正式部门名称、父级、排序、状态 | 钉钉 | 仅作用于 `org_type=department` 且已建立钉钉身份映射的部门 |
| 委员会、虚拟组织、项目组 | 汇智云 | 钉钉同步不得创建、覆盖、停用或移除其成员 |
| `uid` | 汇智云 Console Directory | 优先复用钉钉 identity，其次执行受控唯一匹配；不得直接使用钉钉 user ID |
| 员工真实姓名、显示名称 | 钉钉 HR / People | 启用钉钉 HR 源后，LDAP 不得覆盖，避免名称被登录名或拼音回写 |
| 正式主部门、在离职状态、最后工作日 | 钉钉 HR / People | People 先提交 canonical 事实，再投影到 Console |
| 登录名、密码、登录协议、认证 identity | Console / LDAP / OIDC | 不得反向成为 HR 姓名、部门或离职事实 |
| 角色、权限、策略包 | Platform | 由 Console lifecycle operation 可靠驱动，不由 People 或钉钉直接修改 |

根公司负责人补充（2026-09-10）：active 钉钉 identity `external_department_id=1` 对应的 active、无父级正式部门，在 `manager_external_subject` 为空时允许 Console 设置、替换或清空 `managerId`。这是对上游未提供字段的本地补充；其他钉钉权威字段仍禁止普通编辑。根快照未提供负责人时保留本地值，上游后来提供负责人时由原同步及 lifecycle 回填接管，普通子部门仍完全跟随上游。详细写入与同步契约见 `docs/MODULE_CONTRACTS.md`。

Console 人工编辑页面对钉钉权威字段只读。首版不提供应急 override；异常恢复通过修复钉钉事实或映射后按原幂等链路重跑，避免形成未受供应商约束的第二写入口。未来如确需 override，必须另行设计独立审计动作、时效和自动回收机制，并明确提示下一次钉钉同步可能覆盖；不得通过普通用户编辑绕过事实源规则。

## 6. 权限与入口

### 6.1 People 权限

People manifest 新增资源 `hr_source_sync`，至少提供：

- `people:hr_source_sync:view`：查看来源状态、同步记录和差异；
- `people:hr_source_sync:execute`：创建预览、应用无冲突同步、重试；
- `people:hr_source_sync:admin`：确认首次映射、处理冲突和执行迁移切换。

`people:admin` 建议获得以上权限。服务端按 manifest resource/action 鉴权，不直接判断角色名称。后续可给 HR 操作员仅授予 `view + execute`，不给映射和切换权限。

### 6.2 Console 权限

Console 保留钉钉连接配置、凭证更新、连接测试、Connector enrollment 和运行诊断入口。这些动作继续要求 Console integration/vault/connector 相应权限。

Console 原“同步钉钉”业务按钮在切换后移除或只显示跳转到 People 的说明。Console 不再接受浏览器以 `directory_sync:edit` 直接创建钉钉 People 同步。

People 发起任务时调用 Console 的窄 service API。Console 只接受：

- `aud=console`；
- 固定 People service client 和 source deployment；
- 精确 capability：`console:hr-source-sync:view|execute|admin`；
- 签名原始操作人、tenant、source/target deployment、请求 hash 和幂等键。

Console 校验技术集成已就绪后代为创建 Connector Runtime 任务，但不把该动作解释为 Console Directory 同步。

### 6.3 迁移入口命名

People 现有 `POST /api/admin/directory-sync/import` 保留为切换工具，并改为清晰名称，例如“从 Console 初始化 People”。启用钉钉 HR 事实源并完成切换后默认隐藏，避免正常运营期误用反向导入覆盖 People 事实。

## 7. 数据模型

### 7.1 部门外部身份映射

新增 `directory_department_identities`，不再把 `directory_departments.source_provider/external_ref` 当作唯一外部身份容器。

建议字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 内部主键 |
| `provider_code` | 首期固定 `dingtalk` |
| `external_department_id` | 钉钉部门稳定 ID |
| `dept_code` | canonical Directory 部门编码 |
| `mapping_origin` | `migration_confirmed` / `source_created` / `admin_bound` |
| `status` | `active` / `inactive` |
| `first_seen_at` / `last_seen_at` | 首次、最近完整快照出现时间 |
| `last_snapshot_revision` | 最近供应商快照版本 |
| `source_payload_hash` | 规范化部门字段摘要 |
| `created_by_uid` / `updated_by_uid` | 人工决策审计 |
| `created_at` / `updated_at` | 审计时间 |

约束：

- 唯一键 `(provider_code, external_department_id)`；
- 同一 provider 下，一个正式 canonical 部门最多一个 active 外部身份；
- `dept_code` 必须引用非 deleted 的 `org_type=department`；
- 重绑必须通过显式管理动作并写审计，普通同步不得静默改绑；
- 供应商 ID 变化视为待确认重绑，不根据名称自动替换旧身份。

### 7.2 重复部门别名

迁移期新增或等价实现 `directory_department_aliases`：

```text
alias_dept_code -> canonical_dept_code
```

它用于记录历史 `DT-*` 重复部门的归并关系、迁移引用和回滚证据。新写入必须使用 canonical code；旧部门在 Directory 中软停用，但首个兼容周期继续把 alias subject 和原成员的非主归属投影为 active，使 Codocs 等模块中尚未迁移的旧 `dept_code` 引用仍可授权。只有跨模块引用清单验证归零后，后续独立迁移才能停用该兼容投影；首个版本不硬删除重复部门。

### 7.3 同步运行与决策

首期不复制钉钉 secret 或完整同步任务：

- Connector Runtime 持久化 provider job、规范化请求 hash、单调 watermark、原始操作人、取消审计、状态与计数；同一 provider/integration 单活，People UI 通过窄 Console service API 查询；
- `directory_department_identities` 与 Console mutation receipt 保存映射结果、决策人、幂等键和审计；
- `directory_department_aliases` 保存旧 `DT-*` 归并证据；
- 既有 `people_connector_sync_receipts` 继续保证批次 hash、重放和冲突语义。

如后续需要跨浏览器运行历史报表，再增量引入 `people_hr_sync_runs` 只保存脱敏摘要；不得因此复制供应商 payload。首期状态页以当前 job ID 为运行上下文。

完整人员快照只保存在客户侧受保护 Runtime 的必要生命周期内，并按既定 retention 清理；People UI 只读取规范化差异和脱敏错误。

## 8. 部门匹配与创建规则

匹配优先级固定如下：

1. 命中 active `directory_department_identities(provider=dingtalk, external_department_id)`：直接使用对应 canonical `dept_code`。
2. 首次迁移模式：同一已映射父级下仅有一个名称精确匹配的未绑定正式部门时可保留其稳定编码并建立 `path_matched` identity；只要同层仍有无法唯一对齐的未绑定正式部门就失败关闭，管理员修正或确认映射后重试，不得在歧义时自动绑定。
3. 稳态下发现钉钉新部门：若其父部门已映射且快照完整，自动分配新的汇智云 opaque `dept_code`、创建 canonical 正式部门并建立身份映射。
4. 父部门未映射、出现重名候选、目标为虚拟组织或映射发生漂移：运行进入 `awaiting_resolution`，不得先写该部门人员事实。

自动生成的 `dept_code` 使用汇智云稳定 ID 分配器，不包含钉钉 ID，也不根据部门名称生成。名称和路径可变，不能成为跨模块业务键。

钉钉部门改名或移动时只更新 canonical 部门可由钉钉管理的字段；身份映射和 `dept_code` 保持不变。

## 9. 同步状态机

```text
created
  -> fetching
  -> preview_ready
  -> awaiting_resolution   (存在首次映射或冲突)
  -> approved
  -> applying
  -> facts_applied         (People 事实与 lifecycle operation 已提交)
  -> projecting            (Console / Platform operation 尚在投递)
  -> succeeded

任意可重试阶段 -> failed -> retrying
显式取消且尚未 apply -> cancelled
可靠 operation 达到阈值 -> dead_letter
```

规则：

- `preview` 不修改部门、人员、账号或授权事实；
- `apply` 必须绑定已批准的 snapshot hash 和 mapping revision；快照变化后必须重新预览；
- 只要存在未解析部门，整个相关人员集合不得部分应用；
- `facts_applied` 表示 People 已接受事实，不代表 Console 或 Platform 已完成；
- UI 分开展示供应商拉取、People 提交、Console 账号投影、Platform 授权投影状态；
- 同一 idempotency key + 同一 hash 返回原运行；同键异 hash 返回 409。

首期可将首次切换和高风险差异设为强制预览。稳态运行在全部身份已映射、快照完整且未触发安全阈值时可以自动 apply。

## 10. 完整快照与删除安全

Connector 必须分别声明组织和人员快照是否完整，并提交供应商 watermark、规范化 snapshot hash、分页计数和结束标记。

- 分页失败、权限范围变化、根部门缺失或未收到 final marker 时，快照不完整；不得停用部门、移除人员或推断离职。
- 钉钉 HR 明确返回 `status + lastWorkDay` 才能生成 `leaving/left` 事实。
- 通讯录缺失不能生成离职事实，也不能直接停用账号。
- 正式部门从完整快照消失时，先进入差异预览；只有通过安全阈值或管理员确认后才停用。
- 大比例部门消失、根节点变化或权限可见范围骤降必须暂停 apply，并产生高优先级告警。
- 停用部门前必须先处理其 active 人员主归属；不得留下指向 inactive/deleted 正式部门的 active 主任职。

安全阈值应配置化并按租户基线计算，不在浏览器请求中接受覆盖。

## 11. 正常写入链路

### 11.1 入职、调动和资料变更

1. Connector Runtime 拉取并提交带完整快照证据的规范化批次。
2. Data Runtime 通过部门和用户外部身份映射解析 canonical `dept_code/uid`。
3. People 在事务中 upsert employee/assignment facts、推进 source revision 并冻结 `people.directory.employment-sync.v1`。
4. Console 接收可靠 lifecycle operation，在事务中更新或创建 Directory user、钉钉 identity、正式主部门 membership、applied revision、receipt，并冻结 Platform employment operation。
5. Platform 更新 People 来源授权关系、policy revision 和 receipt。

LDAP 同步只允许更新登录身份和明确允许的认证属性。启用钉钉 HR 源后，它不能修改真实姓名、显示名称、正式主部门或 employment status。

### 11.2 离职

1. People 只接受钉钉 HR 离职接口给出的明确状态和最后工作日。
2. 到达生效时间后，People 事务提交离职事实并冻结 `people.directory.offboarding-disable.v1`。
3. Console 在同一事务中将 Directory user 和相关外部身份设为 inactive，撤销本地 session/refresh token，写 receipt，并冻结 `console.platform.offboarding-revoke.v1`。
4. Console 成功后即禁止新登录、刷新和依赖 Console session 的访问，不等待 Platform 成功。
5. Platform 可靠操作撤销 People 来源授权、推进 employee revision watermark，并生成新的策略/bundle/revocation 状态。
6. Platform 暂时不可用时，Console 的账号停用不回滚，operation 保持 pending 并自动重试。
7. 只有 operation 进入 dead-letter 时才通知具备相应 Console 运维权限的管理员；正常路径不要求人工“重新同步目录”或“重新下发策略包”。

## 12. 现有双部门树迁移

迁移必须通过有 dry-run、receipt 和审计的受控任务执行，不使用无报告的一次性 SQL 直接改生产数据。

### 12.1 准备

1. 暂停现有 Console“同步钉钉”写入入口，防止继续生成 `DT-*` 部门。
2. 导出 canonical 部门树、`DT-*` 部门树、钉钉 external ID、人员 membership 和 People assignment。
3. 盘点引用 `dept_code` 的目录、People、Codocs、Platform scope/membership 及其他业务数据。
4. 记录迁移前计数、hash、subject export 和策略版本，生成可恢复快照。

### 12.2 生成映射建议

对每个钉钉部门按以下证据生成建议：

- 已有外部身份映射；
- 完整父级路径与规范化名称；
- 父部门映射关系；
- 当前员工集合交集，仅作为辅助证据；
- 是否存在多个同名、同路径或跨层级候选。

自动建议不等于自动应用。所有歧义、根节点变化、虚拟组织候选和一对多/多对一关系必须由 `people:hr_source_sync:admin` 确认。

### 12.3 应用归并

每个已确认映射执行：

1. 为 canonical 部门写入钉钉部门 identity；
2. 将钉钉来源的 active Directory membership 改写为 canonical `dept_code`；
3. 将钉钉 Connector 来源的 People employee/assignment 部门引用迁到 canonical `dept_code`；
4. 对语义完全相同的重叠任职做受审计合并；时间范围或事实冲突时停止并人工处理；
5. 通过各模块受控 API/迁移 worker 迁移其他业务引用，不跨模块直连数据库；
6. 重建 Directory subject export，并通过 Console 可靠投影更新 Platform membership 和策略状态；
7. 为旧 `DT-*` code 写 alias，确认无 active 引用后将重复部门软停用；
8. 首个发布周期不硬删除旧部门或 alias。

迁移不得自动重新激活已停用用户，也不得因为回滚组织映射而撤销已经生效的离职安全动作。

### 12.4 验证与切换

- 每个钉钉正式部门恰好映射一个 canonical `dept_code`；
- 每个 active 员工恰好一个 active 正式主部门；
- 委员会、虚拟组织和项目组成员关系不变；
- 原 canonical 部门共享文档对迁移后的正确成员可见；
- `DT-*` 重复部门不再接收新写入；
- Directory、People、subject export 和 Platform membership 计数可对账；
- 经过观察窗口后再关闭 alias 读取兼容，不在切换当日删除历史记录。

## 13. 失败处理与恢复

| 失败点 | 行为 |
| --- | --- |
| 钉钉 API/权限/分页失败 | 标记快照不完整，不执行删除、离职或 apply |
| 部门映射冲突 | 进入 `awaiting_resolution`，不部分写入相关人员 |
| People 事务失败 | receipt 记录失败，同内容可重试；不冻结不完整 lifecycle |
| Console 不可用 | People 事实保留，Directory operation pending 并高优先级告警 |
| Platform 不可用 | Console 已停用账号不回滚，Platform operation 自动重试 |
| operation dead-letter | 创建管理员 actionable；修复后按原 operation/idempotency key replay |
| apply 响应丢失 | 按 run/batch hash 读回 receipt，不创建第二次业务写入 |
| 迁移异常 | 停止后续批次，使用快照与 alias 恢复引用；不自动恢复安全停用账号 |

离职从 People 生效到 Console 禁用应定义独立高优先级 SLO，并监控 pending age。该 SLO 不能由“最终策略包已生成”指标替代。

## 14. 可观测性与审计

至少提供以下指标和审计字段：

- 同步 run 状态、provider job ID、snapshot revision/hash、原始 actor；
- 部门新增、改名、移动、停用、映射、冲突数量；
- 员工新增、调动、待离职、离职、跳过和失败数量；
- incomplete snapshot、权限范围变化和安全阈值拦截次数；
- People -> Console lifecycle pending age、attempt、dead-letter；
- Console -> Platform operation pending age、attempt、dead-letter；
- mapping revision、人工决策人、前后 canonical code；
- Directory、People 和 Platform 最后成功 revision/watermark。

日志和通知不得包含钉钉 token、Vault secret、完整原始 payload、手机号或不必要的目录 PII。

## 15. 实施阶段

### Phase 1：模型与失败关闭

- 增加部门 identity、alias、HR sync run/decision schema；
- 在 Data Runtime 禁止未知钉钉部门直接生成 `DT-*` code；
- 增加字段来源策略，阻止 LDAP 覆盖钉钉 HR 字段；
- 补齐映射、完整快照和批次 receipt 契约测试。

### Phase 2：People 入口与编排

- 增加 `hr_source_sync` manifest 权限和 People 管理页面；
- 增加 People -> Console 窄 service API 及 Connector job 查询、取消、重试；
- 分开展示 preview、facts、Directory 和 Platform 状态；
- 将旧迁移导入入口改为明确的“从 Console 初始化 People”。

### Phase 3：双树迁移

- 在真实租户运行只读 inventory 和映射 dry-run；
- 人工确认歧义；
- 有界应用 mapping、membership、assignment、alias 和 subject export；
- 验证部门文档访问、调动和离职链路；
- 保留回滚快照和旧部门软停用状态。

### Phase 4：切换与收口

- 启用 `People HR source = dingtalk`；
- 移除 Console 直接同步按钮和旧 `directory_sync:edit` 业务入口；
- 稳态任务在无冲突且通过安全阈值时允许自动 apply；
- 观察期结束后清理旧兼容读取，但不立即硬删除历史数据。

每个阶段必须单独通过 schema、单元/契约测试、模块 typecheck/lint、迁移 dry-run 和目标租户验收。生产迁移、部署和 Cloudflare/Connector Runtime 变更需另行明确授权。

## 16. 验收标准

1. 已有部门绑定钉钉 ID 后，同步不新增 `DT-*` 部门。
2. 钉钉部门改名和移动后 `dept_code` 不变，文档及业务引用不丢失。
3. 钉钉新增正式部门能生成独立 canonical code 并建立 identity；不能把供应商 ID 暴露为业务键。
4. 重名或父级冲突进入待处理状态，People 人员事实不部分提交。
5. LDAP 同步不再把钉钉/People 管理的中文姓名改成登录名或拼音。
6. 员工调动后，Console 主部门、People 主任职和 Platform membership 最终一致，且能访问新部门应共享的文档。
7. 通讯录缺失、分页失败和不完整快照均不会触发离职或账号停用。
8. 明确离职到期后，Console 禁止登录并撤销 session/refresh token；Platform 故障时该结果不回滚。
9. Platform 恢复后相同 operation 幂等完成授权撤销和策略状态更新。
10. 委员会、虚拟组织、项目组及其成员关系在同步和迁移前后保持不变。
11. 双树迁移后所有 active 员工只有一个 active 正式主部门，重复部门无新引用且仅软停用。
12. 同一 snapshot/batch 重放不产生重复部门、人员、任职、operation 或通知。

## 17. 必须同步更新的契约文档

实现时需同步修改：

- `docs/MODULE_CONTRACTS.md`：将“按 `source_provider + external_ref` 生成稳定 Directory 部门编码”改为“先解析独立 department identity，再使用 canonical `dept_code`”；
- `people/CLAUDE.md`：补充 People HR 同步入口、权限和预览/apply 状态；
- `console/CLAUDE.md`：区分技术集成配置与 HR 业务同步入口，补充字段来源失败关闭；
- `platform/CLAUDE.md`：保持 Console-owned lifecycle 唯一写入路径，补充离职投影 SLO；
- Data Runtime README、schema DDL、API 契约及迁移/回滚手册。

代码实现和静态契约以本文为准；在真实租户迁移、授权安装和部署验收完成前，不得把目标环境标记为已切换。
