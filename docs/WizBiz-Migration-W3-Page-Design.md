# WizBiz → Enterprise APF：W3 页面设计说明

状态：设计稿（2026-10-04），待协调者与用户审阅；W2-tool 进入演练后再实现。

依据：[W1 模型设计](./WizBiz-Migration-W1-Model-Design.md)（下称 W1）、[W2 工具合同](./WizBiz-Migration-W2-Tool-Contract.md)、[差距分析](./WizBiz-Enterprise-Gap-Analysis.md)、MODULE_CONTRACTS“历史导入合同的操作护栏”与“Altoc 负责人指派校验与‘未分配’保留主体”、根 `CLAUDE.md` 前端规范与 `docs/UI_UX_SPEC.md`、`docs/STANDARD_LIST_PAGE.md`。

## 0. 范围与原则

W3 要让迁入的数据**看得见、看得懂、能处理遗留事项**，共五块：

| 块 | 页面 | 节 |
| --- | --- | --- |
| A | 客户：层级树、“含下属”汇总、主联系人与联系人星级、迁移快照 | 2 |
| B | 合同：三种金额、历史导入标识、迁移快照对照、历史合同的后续命令 | 3 |
| C | 银行账户：资料、法人主体、完整账号查看、余额登记与当日展示值 | 4 |
| D | 两个队列：待归属联系人、人员匹配（及其它迁移遗留事项） | 5 |
| E | 法人主体目录 | 4.5 |

原则：

1. **老 OA 是数据下限，不是设计上限。** 页面按目标用户（中小软件企业的销售、销售管理、财务）的工作方式组织，不复刻老页面；老系统的缓存数字只作为带日期的“迁移快照”出现，不冒充现值。
2. **现值从事实派生，快照只读并排展示。** 任何“合计/汇总”由服务端按事实计算并返回；快照来自类型化快照表（W1 §5.2、§6.2），不读台账 JSON。
3. **页面不是安全边界。** 每个新接口单独做服务端权限与数据范围检查；按钮隐藏只是体验。
4. **不为迁移单独建一套页面。** 新能力落在既有的客户、合同、账户页面上；只有两个队列和法人主体目录是新页面。
5. **不新增跨应用调用。** 全部走既有 Enterprise Host → Runtime 用户委托通道（`<domain>:enterprise-host:execute`），Altoc 与 Finance 同进程内的读取走 typed 入口（ADR-018a D11）。

不在 W3：应收账龄与收款分配（P1）、合同金额事实表（W1 §7A）、发票/支出/档案的页面（二期）、补录历史合同的页面入口。

## 1. 贯穿各页的约定

### 1.1 “迁移快照”的呈现

统一一个只读展示块（Enterprise 内的局部组件，暂不进 Foundation——只有 Altoc 两处使用）：

- 标题“原系统数据（截至 <snapshot_at 日期>）”，`neutral` 色调的次级卡片，位于现值之后。
- 每个数字旁给出现值对照；两者不等时用 `warning` 色的“与现值不同”标记，并提供一句解释（来自 `source_note`，例：“原系统缓存，口径不保证一致”）。相等时不加标记。
- 值为 NULL 显示“—”，不显示 0。
- 没有快照行的对象（迁移后新建的）不渲染这个块。

### 1.2 “待匹配”负责人

`owner_uid='system:unassigned'` 时，列表与详情显示“待匹配”；详情在其后补“（原负责人：<显示名>）”。显示名由详情接口经 `mig_object_map → mig_identity_map` 取得（W1 §6.3 允许的受控台账读取），只返回这一个字符串；列表不取显示名（避免逐行读台账），只显示“待匹配”并可按它筛选。

对这类客户，“新建合同”等需要范围的入口在无权时给出明确提示“该客户尚未匹配负责人，请先在‘人员匹配’中处理或联系销售管理员”，不显示笼统的无权限。

指派边界：用户写入不能把保留主体或非有效目录用户作为新负责人；`ValidateMigrationOwner` 仅供迁移通道使用。第 3 批已补 Finance 开票/核销责任人的 Runtime 校验，以及销售任务、跟进活动和线索转化继承负责人的校验。历史原值可读，不产生新指派的更新保留；客户、联系人、银行账号及结算计划的实际写入面核查见 [MODULE_CONTRACTS](./MODULE_CONTRACTS.md)“Altoc 负责人指派校验与‘未分配’保留主体”。结算计划催收指派仍未提供 Enterprise 写入口，不在本批新增。

### 1.3 列表通用

全部列表遵循 `STANDARD_LIST_PAGE`：`useDebouncedSearch()`、真实分页（`page`/`pageSize` + `UPagination` + “共 N 条”）、筛选变化重置页码、`UTable :loading`、`#empty` 用 `CommonEmptyState`。单元格没有值时显式渲染“—”（Nuxt UI v4 的 cell slot 不渲染内容会回落到原始值）。金额右对齐、千分位、两位小数；日期按 `UI_UX_SPEC` 格式化。危险操作用 `useConfirm()`。

### 1.4 来源信息

客户、联系人、合同、账户详情底部的“记录信息”区增加一行“来源：WizBiz <对象类型> #<源主键>，批次 <batch_code>，导入于 <时间>”，由所属域详情接口返回最小字段（W1 §1.5），权限沿用对象 `view`。非迁移对象不显示。

## 2. 客户

### 2.1 列表（`/altoc/customers`）

信息层级：搜索与筛选 → 视图切换 → 结果。

- **视图切换**：`列表`（默认）与 `层级`。
  - 列表视图：现有扁平分页列表，新增列“上级客户”（名称，可点击）与“下属数”（直接下属个数）。新增筛选：`仅顶级客户`、`状态`（含已归档）、`负责人 = 待匹配`。
  - 层级视图：第一层为顶级客户（`parent_customer_id IS NULL`），服务端分页；展开某个节点时按需加载其直接下属（同样分页，每页 50，超出显示“加载更多”）。不一次取整棵树。
  - **有搜索词时强制回到列表视图**（树上搜索的结果是散点，没有意义），并在结果行显示其上级路径（“上级 / 上上级”，由服务端返回，最多 10 层）。
- 数据范围：层级视图里，用户无权查看的下属不出现；若某节点有不可见的下属，在该节点下显示一行说明“部分下属不可见”——仅返回 `hasHiddenChildren` 布尔，不给数量或名称。
- 响应式：390px 下层级视图退化为“逐级钻取”（点击节点进入其下属列表，顶部面包屑返回），不做横向缩进树；列表视图隐藏“下属数”“上级客户”列，改在名称下以次要文字显示上级。

### 2.2 详情（`/altoc/customers/:customerId`）

页头：名称、状态、等级（NULL 显示“未定级”，不显示 6）、负责人（§1.2）、上级客户链接。

分区（沿用现有详情的分区/页签模式）：

1. **概览**：基础资料；“联系人（自由文本）” `contact_name_text` 单独一行并标注“原系统手填，未关联联系人档案”；排序号。
2. **层级**：上级链（面包屑）+ 直接下属表（名称、状态、负责人、本客户合同数与合同额）。下属表分页。操作“设置上级客户”：单字段，用 `UModal`；服务端校验不成环、深度 ≤ 10、对目标上级有 `view`。
3. **合同汇总**（新）：两列并排——“本客户”与“含下属”。
   - 指标：合同数、当前合同额合计、有效合同额合计（NULL 不计入并注明“N 份未填有效额”）、近一年/当年签约额。
   - **计算规则**：服务端沿父链逐层取子树（深度上限 10、节点上限 2,000，超限返回 422 并提示缩小范围），只统计**当前用户合同范围内可见**的销售方向合同，排除已删除与 `terminated`（中止的合同数另列一个数字）。接口同时返回布尔 `excluded`（子树中是否存在因范围不可见而未计入的销售合同，不给具体数），页面据此显示“部分下属合同无权查看，未计入”。有效合同额合计依赖 W1 列，演练后那一步再加。
   - 汇总下方渲染 §1.1 的迁移快照块（`altoc_customer_migration_snapshot`），与现值逐项对照。
4. **联系人**：表格列——姓名、部门/职务、手机、主联系人标记、关键联系人标记、星级。
   - “主联系人”与“关键联系人”是两个不同标记（W1 §6.2），分别显示，不合并成一个徽标。
   - 星级：`star_level` 1..6 显示为 2–5 星（半星步进），NULL 显示“—”；编辑时用 6 档选择器，文字标注对应星数。
   - 操作“设为主联系人”：`useConfirm()`（`tone: 'warning'`，文案含联系人姓名与“原主联系人将被替换”）；服务端校验联系人属于该客户。删除主联系人前须先更换或清空主联系人，服务端返回 409 时给出这句提示。
5. **记录信息**：§1.4。

### 2.3 接口（Altoc，Host 委托通道）

| 操作 | 说明 | 权限 |
| --- | --- | --- |
| `customers-page` 扩展 | 增加 `parentId`（层级视图取直接下属）、`rootsOnly`、`ownerUnassigned` 参数；返回 `parent`、`childCount`、搜索时的 `ancestors` | `customer:view` + 范围 |
| 合同汇总（不新增路由） | 用合同列表读取 `contracts:list` 带 `customerId`（“本客户”）或再加 `includeDescendants=true`（“含下属”）。返回 `summary`（整个筛选结果的份数与按币种合计）与 `rollup`（仅销售方向：份数、按币种金额（不含中止）、中止份数、近 12 个月与当年签约额、`excluded` 布尔）。子树深度 ≤ 10、节点 ≤ 2,000，超限 `422 altoc_customer_subtree_too_large`。已实现（Runtime）；快照行随客户详情返回，不在此接口 | `contract:view` + 合同范围；`includeDescendants` 进入读许可签名 |
| `customers-set-parent` | 入参 `parentCustomerId`（可为 null）、`expectedVersion` | `customer:edit` + 对双方的范围 |
| `customers-set-primary-contact` | 入参 `contactId`（可为 null）、`expectedVersion` | `customer:edit` |
| 联系人更新扩展 | 接受 `star_level`（1..6 或 null） | `customer:edit` |

写操作都带 `Idempotency-Key` 与 `expectedVersion`，写审计。实现状态：`customers-set-parent`、`customers-set-primary-contact` 与联系人 `star_level` 的 Runtime 与 Host 已实现；列表的 `parentId`/`rootsOnly`/`ownerUnassigned` 参数、可见 `childCount`、`hasHiddenChildren` 布尔与搜索上级路径已在第一批实现；第五批接入层级视图。合同汇总放在合同读取而不是客户读取下：被汇总的是合同，应按合同范围过滤，且一次读许可只携带一个资源的范围。`rollup` 只含数字与一个布尔标志，不含任何下属客户的 id、编码或名称；子树遍历只在服务端使用客户 id。金额按币种分行返回，页面不得跨币种相加。

## 3. 合同

### 3.1 列表（`/altoc/contracts`）

- 新增列：“来源”（历史导入显示 `neutral` 徽标“历史导入”；原生不显示）、“业务类别”（`contract_category`）。
- 金额列保持“当前合同额”一列，避免三列金额把表撑宽；有效合同额放详情。
- 新增筛选：来源（全部/原生/历史导入）、业务类别、负责人 = 待匹配。
- **合计**：页脚显示“筛选结果合计：N 份，当前合同额 X”，由服务端对**整个筛选结果**计算后随列表返回，不在客户端对当前页求和。

### 3.2 详情（`/altoc/contracts/:contractId`）

1. **金额区**（新，置于页头下方）：三张并排指标卡——
   - 原始签约总额 `signed_amount`：副标题“签约时的合同总额，不随变更改动”。
   - 有效合同额 `effective_amount`：副标题“合同总额去掉外采、转包、代收代付等非本公司收入部分（含税）”；历史合同加注“原系统人工录入”。NULL 显示“未填写”。大于总额的 6 份显示 `warning` 说明“大于合同总额，待业务确认”。
   - 当前合同额 `amount_tax_inclusive`：副标题按 `amount_basis` 显示“由合同行合计”或“直接录入（历史导入）”。
   - `amount_basis='header'` 的合同，不含税额与税率显示“—”，不显示默认税率。
   - 390px 下三张卡纵向堆叠。
2. **历史导入说明条**（仅 `origin_type='historical_import'`）：`info` 色横条——“本合同由原系统导入，未经本系统审批与签署流程。履约与激活状态未在本系统跟踪。”履约状态、激活状态两个字段的值旁标注“历史导入，未跟踪”，不显示为系统核实的状态。合同行、付款条款、履约义务三个区的编辑入口对历史合同**不渲染**，区内给出一句“历史导入合同不维护合同行/付款条款”，不留一个点了就 409 的按钮。
3. **迁移快照块**（§1.1）：剩余未开票额、剩余应收（销售）/应付（采购）。现值对照在一期没有事实来源，对照列显示“一期未跟踪”，不显示 0；P1 期初应收落地后接入现值。
4. **关联**：签约主体（法人主体名称，链接到 §4.5）、约定收款账户（账户编码 + 简称，不含账号）、上级/下级合同、项目关联（既有“关联项目”保留，历史合同可用）。
5. **记录信息**：§1.4；原负责人显示名（§1.2）。

### 3.3 历史合同的后续命令（新）

实现状态：Runtime、Host BFF、manifest 与历史合同页面入口已实现。Altoc manifest 没有“销售管理员”角色，`contract:close` 落在推荐角色 `altoc:admin`（经营管理员）上，合同经理不含。

统一库路径目前对历史合同只放行“关联项目”。W3 增加三条命令，**只对 `origin_type='historical_import'` 开放**；原生合同的完结/中止涉及履约义务与结算计划的收尾校验，另行设计，不借这三条命令实现。

| 命令 | 内容 | 状态前提 | 结果 |
| --- | --- | --- | --- |
| `contracts-annotate` | 修改 `contact_id`（须为该合同客户的联系人，可清空）、`remark`、`content_summary` | `effective`/`completed`/`terminated` 均可 | 仅改这三列；状态不变 |
| `contracts-complete` | 完结；`reason` 选填 | `status='effective'` | `status='completed'`、`legal_status='closed'`、`fulfillment_status='fulfilled'`、`completed_at=now`、`last_status_changed_*` |
| `contracts-terminate` | 中止；`reason` 必填（≤ 500 字） | `status='effective'` | `status='terminated'`、`legal_status='terminated'`、`fulfillment_status='cancelled'`、`terminated_at=now`、`last_status_changed_*` |

- 目标状态与 W1 §5.4 的映射表一致，因此“导入时就是完结/中止”与“导入后在本系统完结/中止”得到同一组状态。`financial_status`、`activation_status` 不变。
- **不产生副作用**：不发 Workflow、不写集成出站、不同步 Finance 摘要、不动 Aims 项目。写一条合同审计（含原因）与版本快照，与既有合同命令相同。
- **权限**：`contracts-annotate` 需要 `contract:edit`。完结与中止是敏感的收尾动作，新增动作 `contract:close`，**不被 `admin`、`edit` 蕴含**，推荐授予销售管理员角色；同时要求对象在范围内。写入 manifest 并补动作蕴含契约测试。
- **护栏调整**：`contractW1Guard` 的放行清单由“仅关联项目”扩为“关联项目 + 这三条命令”；其余命令仍 409。三条命令对非历史合同返回 409 `altoc_contract_operation_not_applicable`。测试覆盖已装/未装 W1 列两态（未装时这三条命令恒为 409，因为不存在历史合同）。
- **幂等与并发**：`Idempotency-Key` + `expectedVersion`；重复完结返回首次结果，不重复写审计。
- **不可撤销**：一期不提供“撤销完结/中止”。页面用 `useConfirm()`，完结 `tone: 'warning'`，中止 `tone: 'danger'`，文案含合同名称与“操作后不可在系统内撤销”。需要恢复的由管理员走另行批准的数据处置。
- **与 P1 的关系**：P1 期初应收落地后，存在未结清应收的历史合同能否完结/中止、应收如何处置，在 P1 一并决定；届时在这两条命令上加校验，不改命令形状。
- **与回滚的关系**：这三条命令都会使 `row_version>1`，对应合同此后不能被迁移回滚删除（W1 §1.6），这是预期行为；页面不需要提示，演练说明里写明“演练期间不要在待回滚批次上执行这些命令”。

入口：详情页头操作区“补充信息”（`USlideover`，三个字段）、“完结”“中止”（确认对话框；中止带原因输入）。按钮仅在历史合同且状态满足、用户具备对应动作时渲染。

### 3.4 接口（Altoc）

| 操作 | 说明 | 权限 |
| --- | --- | --- |
| `contracts:list` 扩展 | 返回整个筛选结果的 `summary{count, amounts[{currency_code,count,amount}]}`（已实现）；增加 `origin`、`category`、`ownerUnassigned` 筛选并返回 `origin_type`、`contract_category`（已实现；未装 W1 时不投影新增字段） | `contract:view` + 范围 |
| 合同详情扩展 | 返回 W1 新列、快照行、签约主体、收款账户编码与简称、来源信息、原负责人显示名 | `contract:view` + 范围 |
| `contracts-annotate` / `contracts-complete` / `contracts-terminate` | §3.3 | `contract:edit` / `contract:close` |

## 4. 银行账户

### 4.1 列表（`/finance/bank-accounts`）

- 按法人主体分组展示（主体 5 个、账户 22 个，属于小字典规模）：每个主体一个分组标题（名称 + 账户数 + 该主体最近余额合计），组内按 `sort_no`。这是纯展示分组，仍由服务端一次返回当前筛选的全部账户；**账户数超过 200 时退回标准分页列表**，接口从一开始就带分页参数。
- 列：简称、账户名称、开户行、账号（掩码）、类型与子类型（“银行账户 · 基本户”，现金户只显示“现金”）、最近余额与其日期、状态。
- 余额合计由服务端返回（按主体、按币种），不在客户端 `reduce()`。
- 筛选：法人主体、类型、状态、关键字（简称/名称/开户行；不支持按账号搜索）。
- 没有任何余额记录的账户显示“无余额记录”，不显示 0。

### 4.2 详情（`/finance/bank-accounts/:code`）

- 资料：简称、名称、开户行、行号（NULL 显示“—”）、法人主体（链接）、类型/子类型、币种、状态、排序号。编辑用 `USlideover`（8 个字段以内，单步）。
- **账号**：默认只显示掩码。具备 `bank_accounts:reveal-account-no` 的用户看到“查看完整账号”按钮：
  1. 点击打开 `UModal`，必填“查看原因”（≥ 4 字，≤ 200 字）。
  2. 提交后显示完整账号，带“复制”按钮与 60 秒倒计时；倒计时结束、关闭对话框或离开页面即从内存清除。不写入任何 store、不进 URL、不进缓存。
  3. 失败分别提示：403“没有查看完整账号的权限”、404“该账户没有保存完整账号”、503“保险箱暂不可用，请稍后重试”。
  - 没有该动作的用户不渲染按钮。现金户等无账号的账户显示“无账号”，不渲染按钮。
  - 页面注明“每次查看都会被记录”。
  - 实现状态：Runtime、Host、manifest 与页面入口已实现，完整账号仅在组件本地状态显示；关闭、路由/身份切换、到期即清除，迟到响应丢弃。每人每小时最多查看 20 次，超限 429，页面提示“查看次数过多，请稍后再试”。合同见 MODULE_CONTRACTS“Finance 查看完整银行账号”。
- **余额**：见 4.3。

### 4.3 余额登记与当日展示值（`/finance/bank-accounts/balances` 与详情内）

模型见 W1 §4.2：每次登记一行流水，当日展示值取登记时间最晚的金额。

- **余额总览页**：筛选（法人主体、账户、日期区间，默认近 30 天）→ 每个（账户, 日期）一行的快照表：日期、账户简称、余额、登记条数、标记。分页。
  - 标记：`distinct_amounts > 1` 显示“当日改过数”；`latest_tie_count > 1` 显示“同时刻多条（金额一致）”。
  - 点击一行在 `USlideover` 展开当日全部登记流水：登记时间、金额、登记人（未映射显示历史显示名并标注“原系统人员”）、备注、是否为当日展示值来源。只读。
- **登记余额**：按钮“登记余额”打开 `UModal`（账户、对账日期、金额、备注，4 个字段）。提交后先写流水、再按规则维护当日快照；同一天再次登记不覆盖历史，页面提示“已有 N 条登记，本次将成为当日展示值”。
- **冲突**：同一时刻金额不同的并列不会由页面登记产生（服务器时间到毫秒，且同账户同日的登记在行锁内串行），只可能来自导入；它们在 5.3 的队列里处理。
- 趋势图不在 W3（数据点已具备，等财务确认需要再做）。

### 4.4 接口（Finance）

| 操作 | 说明 | 权限 |
| --- | --- | --- |
| 账户列表/详情扩展 | 返回新增五列、法人主体名称、最近余额与日期、按主体/币种的合计 | `bank_accounts:view` |
| 账户编辑扩展 | 接受新增五列；`legal_entity_code` 校验存在且启用；`short_name` 唯一冲突 409；未装列时写这些字段 409（已实现） | `bank_accounts:admin`（沿用既有口径，不是 `edit`） |
| `bank-accounts-reveal-account-no` | 入参 `reason`；经 Console 保险箱揭示；双重审计；`Cache-Control: no-store` | `bank_accounts:reveal-account-no`（不被 `admin` 蕴含） |
| `balance-entries-page` | 某（账户, 日期）的流水 | `bank_accounts:view` |
| `balance-entries-create` | 登记一条；维护快照与 `is_day_latest`（已实现） | `bank_accounts:edit`（出纳推荐角色已加） |
| 余额快照列表扩展 | 返回 `entry_count`、`latest_tie_count`、`distinct_amounts` | `bank_accounts:view` |

### 4.5 法人主体目录（`/finance/legal-entities`，新页面）

小字典（5 行）：纯客户端过滤，不分页、不防抖。列：编码、名称、简称、统一社会信用代码、开票抬头、状态、账户数。新建/编辑用 `UModal`（≤ 6 个主要字段，其余收在“更多”折叠里）。停用（不删除）用 `useConfirm()`（`tone: 'warning'`，文案说明“已关联的账户与合同不受影响，但不能再被新对象选择”）；仍被启用账户引用时允许停用，页面提示受影响账户数。

权限：新增 Finance 资源 `legal_entities`（`view`、`edit`、`admin`）。Runtime、Host、manifest 与页面已实现；目录未安装时接口返回 503，页面显示“法人主体目录尚未启用”，不显示空列表。Altoc 合同详情显示签约主体名称时经 Finance typed 入口读取，不需要用户具备该资源（只返回名称）。

## 5. 队列

入口：Altoc 导航“迁移事项”（`/altoc/migration`）与 Finance 导航“迁移事项”（`/finance/migration`），仅对具备对应 `migration_exceptions:view` 的用户显示。每个入口是一个带页签的页面，页签后显示未处理数。全部事项处理完后入口保留（可查看已处理记录），不自动消失。

### 5.1 待归属联系人（Altoc，`kind='contact_without_customer'`，721 条）

- 列表：姓名、手机、部门/职务、原业务员（显示名）、状态（待处理/已归属/保持不归属）。字段取自台账行的**服务端白名单**（W1 §6.2），接口不返回整行 JSON。
- 搜索：姓名、手机、原业务员；服务端搜索 + 防抖 + 分页。
- 处理：
  - “归属到客户”：`USlideover`——上方是该联系人的只读资料，下方搜索并选择客户（复用客户搜索接口，受当前用户客户范围约束），可选“设为该客户主联系人”。提交后走**正常的联系人创建写路径**（带审计、查重），成功后事项标记 `resolved`，并记录生成的联系人。
  - 查重：若目标客户下已有同名同手机联系人，返回 409 并展示已有联系人，由用户选择“关联到已有联系人”（事项 `resolved`，不新建）或取消。
  - “保持不归属”：`useConfirm()`（`tone: 'warning'`），事项标记 `accepted`，资料继续只留在台账；可在已处理列表里“重新打开”。
  - 批量：勾选多条 → “归属到同一客户”。上限 100 条/次，服务端逐条处理并返回每条结果；页面显示成功/失败计数与失败原因，不因一条失败整体回滚。
- 权限：`altoc:migration_exceptions:view` 查看；处理需要 `altoc:migration_exceptions:resolve` **并且**对目标客户有 `customer:edit` 与范围。

### 5.2 人员匹配（Altoc 为主，`mig_identity_map` 与 `kind='owner_unmatched'`）

两个视图，页签内用分段控件切换：

- **按源人员**（默认）：每个源人员一行——显示名、源状态、名下在办对象数（客户/合同）、候选目录用户（若有）、匹配状态。
  - “确认匹配”：`UModal`——上方源人员显示名与名下对象数，下方 `UserTreeSelector` 选择目录用户（候选者预选但必须人工点确认；保留主体不出现在选择器里）。目标用户非在职时提示“该账号非在职，只能用于历史记录显示，名下在办对象仍需另行改派”，并仍允许确认。
  - 确认后弹出第二步“应用到名下对象”：列出将被改派的在办对象数，确认后**逐个走正常的‘变更负责人’写路径**（带审计、负责人校验）；每 100 个一批，页面显示进度与失败项。可以只确认匹配、暂不应用。
  - “标记无对应人员”：`rejected`，名下对象留在队列里等待逐个改派。
- **按对象**：`owner_unmatched` 事项列表——对象类型、名称、原负责人显示名、状态。操作“改派负责人”（单个或批量 ≤ 100），同样走正常写路径。
- 源人员表里不存在的 ID 显示“未知（源 ID 已保全）”，不可“确认匹配”，只能按对象改派。
- 权限：查看 `altoc:migration_exceptions:view`；确认匹配与应用需要 `altoc:migration_exceptions:resolve` 并且对被改派对象有 `edit` 与范围（实际上要求 `all` 范围，因为这些对象只对 `all` 范围可见）。**职责分离**：不能把源人员匹配到自己再批量应用——匹配目标等于当前操作者时服务端拒绝（409），由另一名有权用户处理。
- 隐私：页面只显示显示名与目录用户的姓名/部门；W0 的人员核对表不进入系统（用户决定）。

### 5.3 其它迁移事项

同一页面的第三个页签“其它事项”，按 `kind` 分组的通用列表（Altoc 与 Finance 各看各的 `owning_domain`）：

| kind | 域 | 页面处理 |
| --- | --- | --- |
| `effective_amount_exceeds_total`（6） | Altoc | 链接到合同；“已确认无误”→ `accepted`（原因必填） |
| `primary_contact_mismatch`、`contact_orphan` | Altoc | 链接到客户/合同；在对象上修正后“标记已处理” |
| `contract_balance_mismatch`（20） | Finance | 一期只读列出（合同、重算值、原缓存值、差额）；确认在 W4/P1 进行，不在一期提供处理按钮 |
| `balance_without_account`（57 组） | Finance | 展开查看当日各条登记；“认领到账户”→ `record_balance`：选账户并从事项列出的候选金额里选一个，以一条人工登记落账（已实现）；“接受现状”→ `accepted` |
| `balance_latest_conflict` | Finance | 财务从候选金额里指定取值 → `record_balance`，以一条人工登记落账（已实现） |
| 其它/未知 kind | — | 只读显示类型与对象，不提供处理按钮（新增 kind 须先补设计） |

通用规则：`resolve`/`accepted` 都带 `expectedVersion`、写 `resolution_json`（处理人、时间、方式、原因）；事项只前进不删除；已处理列表可查。`detail_json` 按 kind 的服务端白名单投影返回，页面不直接渲染原始 JSON。

### 5.4 接口

| 操作 | 域 | 权限 |
| --- | --- | --- |
| `migration-exceptions-page`（`kind`、`status`、搜索、分页；返回各 kind 未处理数） | Altoc / Finance 各一 | `<domain>:migration_exceptions:view` |
| `migration-exceptions-resolve`（方式：`assign_customer`/`link_existing`/`accept`/`reopen`/`mark_done`） | 同上 | `…:resolve` + 目标对象 `edit` 与范围 |
| `migration-identities-page` / `migration-identities-confirm` / `migration-identities-reject` | Altoc | `view` / `resolve` |
| `migration-identities-apply`（按源人员批量改派，分批） | Altoc | `resolve` + 对象 `edit` 与 `all` 范围 |

这些是除“对象来源信息”外仅有的台账读取入口；`mig_` 源码级测试的允许清单相应增加这一个包，不扩大到业务查询。

### 5.5 队列状态由谁写（已决定：方案 A）

协调者决定采用方案 A（2026-10-04），W1 §1.5 已相应修订。数据库层面：先核实统一库的 Runtime 账号对这两张表是否已有 DML 权限——已有则只靠代码与测试约束，并在合同中写明；需要新增列级授权时按环境批准后执行。下面保留两个方案的对比作为决策记录。

原问题：

W1 有两处说法互相抵触：§1.5 写的是“台账写入仅迁移工具，使用独立的迁移数据库账号”，§6.3 又让队列在页面上把事项标记为已处理、把人员映射从候选改为已确认。W2-schema 按前者把 `migration` 域配置成 Runtime 不可写。队列要能用，必须二选一：

| 方案 | 做法 | 代价 |
| --- | --- | --- |
| **A（建议）：把两张队列表视为“工作状态”，允许 Runtime 做受限更新** | `mig_source_row`、`mig_object_map`、`mig_batch`、`mig_batch_step` 仍只由工具写，Runtime 账号对它们无写权限。`mig_exception` 与 `mig_identity_map` 允许 Runtime **只做 UPDATE**，且只更新固定列（`mig_exception`：`status`、`resolution_json`、`resolved_by`、`resolved_at`、`row_version`；`mig_identity_map`：`directory_uid`、`match_status`、`match_basis`、`directory_status`、`matched_by`、`matched_at`），不 INSERT、不 DELETE。更新在所属域（Altoc/Finance）的写事务内完成，与业务写入同事务；`migration` 域在 Registry 层保持“不可写”，不开放通用写入。源码级测试把全仓对 `mig_` 表的写语句锁定为这两条 UPDATE。数据库层给 Runtime 账号这两张表的列级 UPDATE 权限 | 改变 W2-schema“仅工具可写”的表述；需要一次数据库授权（环境写入，按环境批准） |
| B：台账完全只读，处理状态另存领域表 | 新增 `altoc_migration_task`、`finance_migration_task`、`altoc_migration_identity_decision` 三张领域表保存处理状态与人员匹配结论；Runtime 对 `mig_*` 只读 | 新增一个 W1 安装子集（schema 评审与安装）；同一事项的事实分在两处，verify 与页面都要联表；人员映射的“确认”结论与工具写入的候选分离后，后续批次导入要读领域表才能知道哪些已确认 |

选 A 的理由：这两张表本来就是“待人处理的事项”，不是来源证据；证据（原始行与映射）仍然只有工具能写。

实现状态：只读接口与第一步写操作（状态流转、归属到客户、关联已有联系人、人员匹配确认/拒绝）已实现，合同见 MODULE_CONTRACTS“迁移事项队列的处理”。与本节前文设计的差异：① 归属时联系人内容全部由服务端从台账取，页面不提交；“设为主联系人”未随归属一起做，归属后在客户页单独设置；② 人员匹配一期只接受在职目录用户；③ 批量归属（一次多条）未做，页面逐条提交；④ 按源人员批量改派负责人已实现（先补了合同的“变更负责人”命令）：一次最多 100 条、逐条一个事务、可重复执行；改派不自动填写负责人部门，需要时在对象上单独设置。

## 6. Manifest 与授权变更汇总

| 应用 | 变更 | 备注 |
| --- | --- | --- |
| Altoc | `contract` 增加动作 `close` | 不被 `admin`/`edit` 蕴含；契约测试 |
| Altoc | 新资源 `migration_exceptions`（`view`、`resolve`） | W1 §6.3 已定 |
| Finance | `bank_accounts` 增加动作 `reveal-account-no` | W1 §3.2 已定；不被 `admin` 蕴含 |
| Finance | 新资源 `legal_entities`（`view`、`edit`、`admin`） | |
| Finance | 新资源 `migration_exceptions`（`view`、`resolve`） | |

推荐角色以各域 manifest 为技术事实源：经营管理员 `altoc:admin` 显式持有 `contract:close` 及迁移事项的 `view/resolve`；财务管理员 `finance:admin` 显式持有 `bank_accounts:reveal-account-no`、`legal_entities:admin` 及迁移事项的 `view/resolve`。法人主体目录属于基础资料维护，财务负责人 `finance:manager` 同样持有 `legal_entities:admin`，出纳 `finance:cashier` 和财务会计 `finance:accountant` 仅持有 `legal_entities:view`；这是来源提交 `d1d0ef9f` 已登记的角色分工。

`legal_entities:admin` 只蕴含同资源的 `view/edit`，不授予其他资源权限，也不蕴含 `approve/confirm/issue/reveal-account-no/resolve` 等敏感动作。默认企业角色 `finance_director` 通过既有 seed 组合 `finance:manager` 获得法人主体维护权限，审批权限来自另行组合的审批角色；不需要把该企业角色改映射到 `finance:admin`。Platform 的两处角色白名单测试登记这一精确授权，不从白名单反向生成 manifest 或 seed 权限。

角色变更后每个环境分别签发策略包。不新增服务 capability；Host 通道的操作表按新增路由逐条登记。本次白名单补登记未变更 manifest、seed 或环境策略包。

回归：因新增敏感动作与新资源，执行角色合并、模拟隔离、自定义角色、动作蕴含、数据范围、过期授权的回归矩阵中受影响的部分；`close` 与 `reveal-account-no` 的“管理员不自动具备”各有一条负向用例（用对 Altoc 无权的测试账号验证，管理员账号验不出越权）。

## 7. 状态、响应式与验收

关键状态（每个新页面/新区块都要有）：加载中、空（含下一步指引）、无权（403 与 503 区分，503 不显示为无权）、部分不可见（§2.1、§2.2 的说明行）、写入冲突（409 → “数据已被他人修改，请刷新后重试”）。

视口：1440px 与 390px 双视口检查适用于——客户层级视图、合同金额区、账户分组列表、两个队列的列表与处理抽屉。390px 下表格保留 2–3 个关键列，其余进入行展开或详情。

验收清单（实现完成后在 hzy0 用演练数据逐项验证）：

1. 客户层级：三层链路正确展开；搜索时回到列表并显示上级路径；“含下属”汇总与手工按子树统计一致；无权下属不泄露名称。
2. 客户快照：现值与快照并排，差异有标记，NULL 显示“—”。
3. 合同：三种金额与来源说明正确；历史合同无合同行/付款条款编辑入口；补充信息、完结、中止各走通一次并核对状态组合与审计；无 `close` 动作的用户看不到也调不通（接口 403）。
4. 账户：分组与合计正确；无权用户无“查看完整账号”按钮且接口 403；有权用户查看需填原因、两处审计各有一条、60 秒后清除（演练环境为合成账号）。
5. 余额：同日多次登记保留全部流水，当日展示值为最晚一条；标记正确。
6. 队列：归属一个联系人（新建）、一个联系人（关联已有）、一个保持不归属并重新打开；确认一个人员匹配并批量应用，核对对象负责人与审计；匹配到自己被拒。
7. 普通接口、日志与页面源码中检索不到任何完整账号。

## 8. 实现顺序建议

1. Runtime 读接口与详情扩展（客户/合同/账户的新列、快照、来源信息）+ 页面只读部分——让演练数据先“看得见”。
2. 法人主体目录、账户编辑、余额登记流水。
3. 完整账号查看（依赖 Console 保险箱揭示入口与 manifest 动作）。
4. 历史合同三条命令 + `contract:close`。
5. 两个队列与其它事项。
6. 层级视图与“含下属”汇总（递归查询需在演练数据量上测耗时）。

每一步独立可验收；1 之后的步骤互不依赖，可并行分给不同实现者。

### 8.1 页面批次所需读接口

写命令与队列接口已全部实现。以下六项已在 W3 页面第一批实现，按“已装 / 未装 W1 列”两态做隔离 MySQL 测试；客户/合同/账户只读页面已用合成数据验证。真实演练数据、1440/390 浏览器验收待协调者安排，尚未据此宣称验收通过。完整层级视图及后续写入口仍按 §8 分批交付。

| 接口 | 待补内容 | 依赖 |
| --- | --- | --- |
| 客户列表 `customers:list` | 查询参数 `parentId`（取直接下属）、`rootsOnly`、`ownerUnassigned`；每行返回 `childCount`；有搜索词时返回上级路径（最多 10 层）。`childCount` 仅计可见直接下属；范围外下属仅返回 `hasHiddenChildren` 布尔，不返回数量或名称 | 基础列 `parent_customer_id`；`ownerUnassigned` 用保留值 `system:unassigned` |
| 合同列表 `contracts:list` | 查询参数 `origin`、`category`、`ownerUnassigned`；每行返回 `origin_type`、`contract_category`。新查询参数须进入读许可签名（做法同 `includeDescendants`：仅在有值时追加，Go/TS 共享向量） | W1 合同列 |
| 客户详情 | 迁移快照行（`altoc_customer_migration_snapshot`）；来源信息（源表、源主键、批次、导入时间）；原负责人显示名 | 快照表子集；台账（`mig_object_map`、`mig_identity_map`，属于受控台账读取，需加入 `mig_` 边界测试的允许清单） |
| 合同详情 | W1 新列（`signed_amount`、`effective_amount`、`contract_category`、`amount_basis`、`origin_type`、`signed_at`、`receiving_bank_account_code`）；迁移快照行；签约主体名称（经 Finance 进程内入口）；收款账户编码与简称；来源信息；原负责人显示名 | W1 合同列、快照表、台账、Finance 法人主体目录 |
| 合同汇总 `rollup` | 有效合同额合计与“未填有效额”的份数 | W1 合同列 |
| 账户详情 | 法人主体名称（现只返回编码，页面可用主体列表映射） | — |

页面侧另需实现的展示规则：同一账户同一天同时有“人工”与“导入”两条余额快照时，以人工那条作为当日余额。

## 9. 决定记录

以下七项由协调者在用户外出期间代为决定（2026-10-04），**待用户回来确认**；确认前按此实现，用户改变任何一项时以用户决定为准。

| # | 问题 | 决定 |
| --- | --- | --- |
| 1 | “含下属”汇总是否把采购方向合同单列 | 一期只统计销售方向；采购方向出现后再加 |
| 2 | 完结/中止是否允许撤销 | 一期不提供 |
| 3 | `contract:close` 授予哪些角色 | 仅作为销售管理员的推荐角色动作；负责人本人不自动具备；manifest 动作蕴含表明示不被 `admin`/`edit` 蕴含，并有契约测试 |
| 4 | 人员匹配的批量应用是否需要第二人复核 | 只禁止“匹配到自己”；不做二人复核；批量应用逐条留审计 |
| 5 | 完整账号显示时长 | 60 秒 |
| 6 | 余额趋势图是否进 W3 | 不进 |
| 7 | 客户等级批量设置是否进 W3 | 不进；等用户确定等级字典后再做 |


### W3 页面第二批实现记录

法人主体目录已登记 `/finance/legal-entities`：小字典客户端搜索、新建/编辑、停用确认、可用性与权限分态、390 卡片展示。账户新增五列可编辑，法人主体使用搜索选择器；未装字段且未修改时不补空值，修改未装字段由既有命令拒绝。余额快照默认近 30 天，新增登记余额与当日流水抽屉（服务端分页）；失败保留草稿、同一请求重试沿用原键，账户编辑与主体编辑保留版本比较入口。

本批不含完整账号揭示、历史合同命令、迁移队列、账户列表主体分组或新增主体/类型筛选；后续按 §8 分批交付。合成数据与组件验证已执行，1440/390 真实浏览器验收待协调者安排。

### W3 页面第四批实现记录

历史合同详情提供补充信息、变更负责人、完结、中止入口；关联既有项目入口使用同一套 CAS/原键重试，明细行、付款条款与履约义务仍锁定。完结/中止要求显式 `contract:close`，确认包含合同编号与不可撤销后果；409 保留草稿并刷新比较，响应未确认时沿用原键。

`/altoc/migration` 与 `/finance/migration` 已显式登记：真实分页、允许的搜索、类型未处理数、处理状态和手机卡片；只展示服务端白名单字段。人员匹配候选须人工确认，保留主体不可选，应用最多 100 项并显示逐项失败与剩余数量。Finance 合同余额差异只读；余额认领只选择事项列出的候选金额。

本批仅消费已合并接口，以下设计入口受当前合同限制：联系人没有批量归属或设置主联系人参数，不提供这些控件；人员匹配只接受在职目录用户；按对象通过现有详情页改派，队列原子收尾由已确认人员的 apply 完成，不伪造 resolve 方法。新页面与组件以合成数据测试；真实演练数据及 1440/390 登录态验收另由协调者安排。


### W3 页面第五批实现记录

客户列表新增层级视图：顶级真实分页，下属按需每页50、加载更多；搜索切回列表，390使用逐级钻取与返回路径。只展示当前范围内子节点与 `hasHiddenChildren` 布尔。设置上级、设置或清空主联系人、六档联系人星级使用既有写合同，409保留选择并刷新比较；未确认请求原键重试。联系人表格分别显示主联系人与关键联系人，删除主联系人先提示更换或清空。

账户详情新增近10天快照与当日流水入口；同日人工优先仍由服务端在分页、总数与合计中统一处理。列表明确区分无余额记录与零余额。合同列表补当前合同额列（手机次要金额），签约主体增加目录链接，客户/合同来源信息置于详情底部；人员匹配显示共享目录姓名/部门，确认后提供明确的第二步应用提示，不自动批量写入。

仍需读/写合同的项仅盘点，未实施：下属逐行合同摘要、账户主体分组及主体/类型筛选（当前pageSize上限100）、快照主体筛选、客户等级基础字段投影（不等同信用等级）、联系人和账户来源/原业务员及队列对象名投影、下级合同分页、余额遗留原始流水、批量联系人归属/同时设置主联系人、非在职匹配与按对象原子收尾。§8.1六项读接口均已交付。真实演练数据与1440/390浏览器验收由协调者另行安排，本批不据合成测试宣称真实视觉或性能验收通过。

## W3 第6批：只读扩展

复用既有 `customer:view`、`contract:view`、`bank_accounts:view`、`migration_exceptions:view` 与固定读取操作，不新增 capability/grant/schema。列表、详情分别由服务端授权；来源信息在所属对象通过范围检查后，以 Registry 快照事务读取迁移台账。仅返回 `system/table/pk/batchCode/importedAt`，不返回源 JSON。

- 客户 list/detail 返回 `customer_level_id`（NULL 保持）及已有字典 `customer_level_name`；不与信用等级混用。联系人来源随受控客户详情返回；账户来源仅在账户详情返回。
- `GET /altoc/api/v1/contracts?parentContractId=<id>&page=&pageSize=`：仅当前合同范围内的直接下级合同；W1 列未装时为空，不恢复宽读取。
- 同一合同 list 的 `customerIds=2,3`（最多100个不同正整数，无 customerId/includeDescendants）返回 `customerSummaries`：一次批量分组，各客户的可见销售合同（排除 terminated）count/amounts，按币种分开；只用合同范围，不查询客户名称或存在性，不返回不可见计数。无可见合同与客户不存在都返回零。
- 账户 list 的 `legalEntityCode/accountType` 服务端筛选；`complete=true` 仅 page=1，整个筛选结果≤200才完整返回，响应 `complete=true`；超过200则 `complete=false`、按传入 pageSize（≤100）分页。响应 pageSize 保持请求值，完整模式仅作为有界展示例外；合计仍覆盖整个筛选结果。W1 主体列未装，主体筛选返回空。
- 余额 list 的 `legalEntityCode` 经账户关联筛选，total 与返回记录采用同一条件；同账户同日人工快照优先于导入。
- Finance exceptions 读增加 `exceptionId`，仅 kind=balance_without_account，不接受 status/search；沿用既有签名泛型 ID 和 page/pageSize。详情返回分页白名单流水（sourceEntryId/balanceDate/amount/recordedAt/recordedByName），固定源表与事项冻结快照，匹配原 sourceEntryIds、日期和 ba_id=0；其它批次/日期/关联账户记录不可混入。Ledger 未装仍503。

新增 Altoc/Finance query 在 Go/TS canonical 中仅有值时追加，旧请求字节保持不变，共享金向量覆盖参数删改。exceptionId 使用原有签名 ID 槽位，不改变旧许可格式。
