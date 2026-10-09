# WizBiz 迁移 W2：verify 独立实现的测试规格

日期：2026-10-04。状态：**测试规格草案，供协调者审查；与工具实现并行使用。未写代码。**

依据：[W2 工具合同](./WizBiz-Migration-W2-Tool-Contract.md) §5.2、§7、§12、§15；[W1 模型设计](./WizBiz-Migration-W1-Model-Design.md)；[W0 基线](./WizBiz-Migration-W0-Baseline.md)。

## 1. 目的与独立性要求

合同 §12 要求 verify 不能“用同一段错误代码验证自己”。本规格给出两样东西：

1. **表驱动断言清单**：每一类转换的期望值以数据表的形式固定在测试里，独立于 apply 的写入代码。apply 与 verify 都必须通过同一张表，但两者不得共享实现转换的函数。
2. **变异清单**：对每一类核对，人为制造一个具体错误，verify 必须失败并指出源键。verify 没有因某个变异而失败，即该项核对无效。

独立性的可检查形式（实现方须满足，审查时逐条看）：

- verify 包不得 import apply 包中任何执行转换或写入的符号；二者只共享“声明”（字段覆盖矩阵、枚举表这类纯数据）与规范 JSON 的**规格**，不共享规范 JSON 的实现函数。用源码级测试断言 import 关系。
- 本规格中的黄金向量（§2）以字面量写在 verify 的测试里，不由任何被测代码生成。
- 枚举与状态映射在 verify 侧以本规格的表为准重新写一遍（表驱动），不是引用 apply 用的那张 map。两张表不一致时，测试应当失败——这正是要它发现的情况。

## 2. 规范 JSON 与行摘要：黄金向量

合同 §5.2 的规格在此补全字符串转义（实现最容易分叉的地方）：

- 字符串按 RFC 8259 **最小转义**：只转义 `"`、`\` 与 U+0000–U+001F。其中 `\b \f \n \r \t` 用短形式，其余控制字符用 `\u00xx`（小写十六进制）。
- **不**转义 `/`、`<`、`>`、`&`，不转义 U+2028 / U+2029，不把非 ASCII 转成 `\u`。（Go 的 `encoding/json` 默认会把 `<>&` 与 U+2028/2029 转义，直接使用会得到不同摘要。）
- 键按 UTF-8 字节序升序；键与值之间、成员之间没有空白；对象外没有换行。

黄金向量（输入为“列 → 值”，值除 NULL 外都是文本；期望为规范字节串与其 SHA-256）：

| 编号 | 说明 | 规范字节串 | SHA-256 |
| --- | --- | --- | --- |
| V1 | 普通余额行；`remark` 为 NULL | `{"ab_id":"7","ba_id":"3","balance":"1200.00","check_date":"2024-01-31","operate_time":"2024-02-01 09:15:00","operator_id":"12","remark":null}` | `c6166394d190776d5bb2789583019841640faa8aeb780c0bff262cb0d9e52876` |
| V2 | 负数金额保留标度；`remark` 为空字符串（≠ NULL） | `{"ab_id":"8","ba_id":"3","balance":"-0.50","check_date":"2024-01-31","operate_time":"2024-02-01 09:15:00","operator_id":"12","remark":""}` | `68c38a1aac993526fdc17a51836e5128c023b50ae2fc93acb3a309791b7f1ef7` |
| V3 | 非 ASCII、引号与反斜杠 | `{"ancestors":null,"org_id":"5","org_name":"测试 \"客户\" A\\B","short_name":"","sum_all":"0.00"}` | `94fe4cca3d398952f6b12eb54ef5a6f1db0dc47eaae21906517a46e33105a07d` |
| V4 | 脱敏对象（键同样按字节序：`$redacted` 在 `secretRef` 之前） | `{"account_number":{"$redacted":"vault","secretRef":"hzybase://vault/finance.bank-account.BA-W000002.account-no"},"ba_id":"2","bank_code":null}` | `aa9dcbf6b583a5b518b947542c80c563a1a63f5263940866b70089052d77611f` |
| V5 | 转义边界：值为 `a<b>&c/d` + 换行 + 制表 + U+2028 + `e` + U+0001 | `{"description":"a<b>&c/d\n\t` + U+2028 原字节 + `e\u0001","id":"1"}` | `ac50bea595c1315e8946df96b4d00d18ec396af3fd87c40888b4525815199bb7` |

表级摘要向量：把 V1、V2 的 SHA-256 按主键升序（7、8）用单个 `\n` 连接（末尾无换行）后取 SHA-256 → `6aca58eb14d6401482726d0ee3b482ccd385e2eb95e59d1821ec9059d4c1aab2`。

V4 中 `secretRef` 的格式已对照主线核实：Console 保险箱固定为 `hzybase://vault/<secretCode>`（`vault.go`），`secretCode` 须匹配 `^[A-Za-z0-9][A-Za-z0-9._:-]{1,126}[A-Za-z0-9]$`、区分大小写且不做规范化，因此 `finance.bank-account.<账户 code>.account-no` 原样成立。verify 独立按这一规则由账户 code 推出期望引用，不从 apply 的输出里取。

**断言**

- 上述向量逐字节相等；V1 与 V2 的差别（NULL vs 空字符串、正负号、标度）必须产生不同摘要。
- 改变成员顺序、加入空白、把 `"1200.00"` 写成 `"1200"` 或数字 `1200.00`、把 NULL 写成 `""`，摘要都必须不同于黄金值（反向向量）。
- DECIMAL 取源文本：`0.00`、`-0.50`、`12345678.90` 原样；不得规范化为 `0`、`-0.5`。
- DATETIME 取源本地时间文本，不带时区、不带小数秒；`0000-00-00` 之类的非法值若出现，plan 阻断（不进入规范化）。

## 3. 枚举与状态映射表

verify 侧逐表断言“源值 → 目标值”，表外的源值必须得到“阻断”，不得落入任何默认值。

### 3.1 组织

| 源列 | 源值 | 期望 |
| --- | --- | --- |
| `org_type` | `0` | 进入 `finance_legal_entity`；不出现在 `altoc_customer` |
| `org_type` | `1` | `altoc_customer`，`is_partner=0` |
| `org_type` | `2` | `altoc_customer`，`is_partner=1` |
| `org_type` | `3` | 阻断（一期无供应商主档） |
| `org_type` | 其它 / NULL | 阻断 |
| `org_status` | `0` | `status='active'` |
| `org_status` | `1` | `status='archived'` |
| `level` | 任意 | `customer_level_id IS NULL`（源值只在台账） |

### 3.2 合同

| `contract_type` | `direction` | `primary_type` | `contract_category` |
| --- | --- | --- | --- |
| `0` | `purchase` | `standard` | `purchase` |
| `1` | `sales` | `software` | `software_sales` |
| `2` | `sales` | `implementation` | `software_development` |
| `3` | `sales` | `service` | `tech_data_service` |
| `4` | `sales` | `maintenance` | `system_maintenance` |
| `5` | `sales` | `standard` | `saas` |
| `6` | `sales` | `service` | `platform_operation` |
| `8` | `sales` | `standard` | `hardware_integration` |
| `9` | `sales` | `standard` | `other` |
| `7` / 其它 / NULL | 阻断 | | |

| `contract_status` | `status` | `legal_status` | `fulfillment_status` | `financial_status` | `activation_status` |
| --- | --- | --- | --- | --- | --- |
| `0` | `effective` | `effective` | `in_progress` | `unplanned` | `not_planned` |
| `1` | `completed` | `closed` | `fulfilled` | `unplanned` | `not_planned` |
| `2` | `terminated` | `terminated` | `cancelled` | `unplanned` | `not_planned` |
| 其它 / NULL | 阻断 | | | | |

所有历史合同另断言：`origin_type='historical_import'`、`amount_basis='header'`、`source_type='historical_import'`、`is_master_contract=0`、`parent_contract_id IS NULL`（封存快照无父子数据；出现父子数据时为阻断）、`tax_rate IS NULL`、`amount_tax_exclusive IS NULL`、`workflow_instance_id IS NULL`、`approved_at IS NULL`、`approved_by IS NULL`、`completed_at IS NULL`、`terminated_at IS NULL`、`currency_code='CNY'`（且批次带币种声明）。

### 3.3 银行账户

| `ba_type` | `account_type` | `account_subtype` | 账号 |
| --- | --- | --- | --- |
| `0` | `bank` | `basic` | 有则入保险箱 |
| `1` | `bank` | `general` | 同上 |
| `2` | `bank` | `special` | 同上 |
| `3` | `cash` | NULL | 可无；无则 `account_no_secret_ref` 与掩码均 NULL |
| `4` | `bank` | `loan` | 有则入保险箱 |
| 其它 / NULL | 阻断 | | |

`ba_status`：`0` → `active`，`1` → `inactive`，其它阻断；任何情况下不得出现 `closed`。

### 3.4 联系人

`chief` → `is_key_contact`（按源字典的真值）；`stars` 0（未评级）→ `star_level` NULL，1..6 → 原值，NULL → NULL，其它值阻断。源0必须在 `mig_source_row.row_json` 中仍为字符串 `"0"`，不得改为源NULL；verify独立计算0↔NULL与1..6逐值对应。`org_id` 为 NULL 的行：不存在对应的 `altoc_contact`，存在一条 `contact_without_customer` 异常。

## 4. ID 重映射与编码派生

| 断言 | 向量 / 规则 |
| --- | --- |
| 编码确定性 | 同一源键两次 plan 得到同一编码。规则（已对照主线核实）：`<前缀>-W<源主键十进制，不足 6 位左补零，超过 6 位不截断>`。固定向量：客户 `org_id=123` → `CU-W000123`；联系人 `contactman_id=45` → `CN-W000045`；合同 `contract_id=7` → `CT-W000007`；账户 `ba_id=2` → `BA-W000002`；法人主体 `org_id=4` → `ENT-W000004`；长主键 `org_id=1234567` → `CU-W1234567` |
| 编码与运行时不冲突 | 运行时生成的编码是 `前缀-` 加十六进制串（字符集 `0-9a-f`），不可能含 `W`；断言每个迁移编码第一个 `-` 之后的字符是 `W`，且长度 ≤ 50。法人主体不使用 `LE-`（Altoc 线索编码已占用该前缀） |
| 编码不依赖顺序 | 打乱源行处理顺序、分块大小改变、断点续行后，编码分配表逐项相同 |
| 外键重映射 | 目标外键 = 映射表中“源被引用键”的目标 id；断言对象：客户父、联系人 → 客户、合同 → 客户/联系人/第三方、余额 → 账户、账户 → 法人主体编码、合同签约主体 → 法人主体编码 |
| 源键与目标主键不混用 | 夹具中故意让源 `org_id` 与某个无关目标 `id` 数值相等；断言引用落在映射目标而不是数值相等的那一行 |
| 孤儿引用 | 合同 `contactman_id` 指向不存在的联系人 → `contact_id IS NULL` + 一条 `contact_orphan`；其它类型的悬空引用 → 阻断 |
| `0` 占位 | 余额 `ba_id=0` → 无流水、无快照、台账 `preserved_only` + `balance_without_account`；其它列上的 `0`（如 `parent_id=0`）按“根/空”解释，逐列在声明里写明，测试覆盖每一个被这样解释的列 |
| 一个源行多目标 | 合同行有且仅有：1 条 `altoc_contract`（primary）、1 条主签约主体 party、1 条迁移快照；映射表 `map_role` 各一条 |
| preserve-only | 12 张 preserve-only 表：台账行数 = 源行数，映射全部 `preserved_only`，任何领域表中没有来自它们的行 |

## 5. 时间换算

规则：DATE 原样；表示瞬时事件的列按 Asia/Shanghai（固定 UTC+8；1992 年起无夏令时，早于该年的值若出现则阻断并人工确认）换算为 UTC；台账中保留源本地文本。

| 源值（本地） | 目标列类型 | 期望 |
| --- | --- | --- |
| `2024-02-01 09:15:00` | 瞬时（UTC 存储） | `2024-02-01 01:15:00.000` |
| `2024-01-01 00:00:00` | 瞬时 | `2023-12-31 16:00:00.000`（跨日、跨年） |
| `2024-03-01 07:59:59` | 瞬时 | `2024-02-29 23:59:59.000`（闰日） |
| `2024-06-30` | DATE | `2024-06-30`（不位移） |
| 合同 `sign_date='2023-05-10 18:30:00'` | `sign_date` DATE + `signed_at` 瞬时 | `sign_date=2023-05-10`（取**本地**日历日，不是 UTC 日）；`signed_at=2023-05-10 10:30:00.000` |
| 合同 `sign_date='2023-05-10 00:00:00'` | 同上 | `sign_date=2023-05-10`；`signed_at=2023-05-09 16:00:00.000`——断言 `sign_date` 没有因换算退到 9 日 |
| NULL | 任意 | NULL |

余额的 `balance_date`（源 `check_date`，DATE）永不位移；`recorded_at` 按上表换算；“当日展示值”的分组键是 `balance_date`，不是 `recorded_at` 的 UTC 日期——用一条 `check_date=2024-01-31`、`operate_time=2024-02-01 02:00:00` 的夹具断言它仍属于 1 月 31 日。

## 6. 金额

| 断言 | 向量 / 规则 |
| --- | --- |
| 原值相等 | 目标 DECIMAL 的文本表示与源文本逐字符相等（同标度）：`0.00`、`1200.00`、`-0.50`、`99999999.99` |
| NULL 保持 | `prime_amount` NULL → `effective_amount` NULL（不是 0，也不是总额）；`count_recerivable` NULL → 快照列 NULL；账户 `balance` NULL → 不生成缓存流水 |
| 不做任何换算 | 不乘除 10,000，不四舍五入，不按税率拆分；`amount_tax_exclusive` 一律 NULL |
| 三种口径互不串写 | 夹具：`total=100.00, prime=80.00, invoice=30.00, exec=20.00` → `signed_amount=100.00`、`amount_tax_inclusive=100.00`、`effective_amount=80.00`、快照 `remaining_uninvoiced_amount=30.00`、`remaining_settlement_amount=20.00`；任何一列写到别的列都要被发现 |
| 语义不反转 | `invoice_amount` 是“剩余未开票”：断言它**没有**被写入任何“已开票额”列（Finance 摘要等） |
| 有效额大于总额 | `total=100.00, prime=120.00` → 原样写入 + `effective_amount_exceeds_total` 异常；不截断、不拒绝 |
| 负数与零 | 负数、零金额的合同与余额照常迁移；不因“非正数”被丢弃 |
| 合计 | 每个金额列：目标逐行相等之外，合计也与源合计相等（Decimal，不用浮点）；合计在 verify 中由源与目标各自独立求和 |
| 方向 | 合同迁移快照 `settlement_direction`：销售 → `receivable`，采购 → `payable` |

## 7. 余额“当日展示值”规则

每个情形给出若干登记行，断言 `is_day_latest`、是否生成快照、快照金额、`entry_count / latest_tie_count / distinct_amounts`：

| 情形 | 登记（时间, 金额） | 期望 |
| --- | --- | --- |
| 单条 | (09:00, 100.00) | 快照 100.00；1 / 1 / 1；该行 `is_day_latest=1` |
| 多条不同时刻 | (09:00, 100.00), (17:00, 120.00) | 快照 120.00；2 / 1 / 2；仅 17:00 行为 1 |
| 多条不同时刻、最后改回 | (09:00, 100.00), (10:00, 120.00), (17:00, 100.00) | 快照 100.00；3 / 1 / 2 |
| 最新时刻同额并列 | (17:00, 120.00) ×2 | 快照 120.00；2 / 2 / 1；两行都为 1 |
| 较早并列、最新唯一 | (09:00, 100.00) ×2, (17:00, 120.00) | 快照 120.00；3 / 1 / 2 |
| 最新时刻不同额并列 | (17:00, 100.00), (17:00, 120.00) | **不生成快照**；一条 `balance_latest_conflict`；两行都不为 1 |
| 源 ID 顺序不影响结果 | 上面“同额并列”“不同额并列”两例交换两行的 `ab_id` 大小 | 结果完全相同（证明没有用源 ID 决胜） |
| 跨日登记 | `check_date=01-31`，`operate_time=02-01 02:00` | 归 01-31 |
| `ba_id=0` | 任意 | 无流水、无快照、异常按日期分组 |
| 无历史账户 | 账户缓存 `balance=50.00, check_date=2024-03-01` | 一条 `note` 标注来源的流水 + 快照 50.00 |
| 无历史账户且缓存为 NULL | — | 不生成任何流水与快照 |

## 8. 人员与负责人

对每种情形断言负责人列、操作人列、显示名与异常：

| 情形 | `owner_uid` | `owner_dept_code` | 操作人列 | 异常 |
| --- | --- | --- | --- | --- |
| 已确认且 Directory 有效 | 该 uid | Directory 主部门 | 该 uid | 无 |
| 已确认但已非有效 | `system:unassigned` | NULL | 该 uid | 在办对象 → `owner_unmatched` |
| 仅 W0 候选、未确认 | `system:unassigned` | NULL | NULL | 在办对象 → `owner_unmatched` |
| 未匹配 | 同上 | NULL | NULL | 同上 |
| 源人员表中不存在 | 同上 | NULL | NULL | `identity_source_missing` + 在办对象 `owner_unmatched` |
| 已完结/归档对象、负责人未确认 | `system:unassigned` | NULL | — | **不**生成 `owner_unmatched` |

另断言：整个目标中 `owner_uid` 不存在除 `system:unassigned` 以外的任何保留主体或空值；Directory 中没有任何行被新建或修改（以批次前后的行摘要比较）。

## 9. 账号脱敏与掩码

| 断言 | 向量 / 规则 |
| --- | --- |
| 掩码规则 | 只保留后 4 位：`6222020200112233445` → 掩码末 4 位为 `3445`，其余全为 `*`；长度不足 4 的账号整体掩码；掩码中不出现原账号的任何其它数字 |
| 台账 | 银行账户行的 `row_json.account_number` 是脱敏对象或 `null`；`redacted_fields` 含该列 |
| `synthetic` 模式不读账号 | 夹具中该列放置“读取即失败”的值（例如让只读账号对该列无列级权限，或在测试替身中对该列的读取直接报错）；`synthetic` 下全流程成功，`real` 下才会读取 |
| 全面扫描 | 以夹具中全部真实形态的账号为词典，扫描 plan、覆盖矩阵、回执、stdout/stderr、`mig_*` 全部表、异常 `detail_json`：零命中 |
| 保险箱 | 每个有账号的账户恰有一个密钥：`usageType=custody`、`ownerType=finance_bank_account`、`ownerKey=<账户编码>`；程序化解析该密钥返回 403（保险箱自身行为，测试中确认迁移没有绕过它建成别的类型） |

## 10. 变异清单（verify 必须逐项失败）

在一次干净的 apply 之后，逐个施加下列变异，各运行一次 verify，断言：失败、错误码属于对应类别、报告中出现被改动对象的源键。每个变异之后恢复现场。

| # | 变异 | 应由哪项核对发现（合同 §12） |
| --- | --- | --- |
| M1 | 删除一条 `mig_source_row` | 完整性 1 |
| M2 | 改一条 `mig_source_row.row_json` 的一个字符（不改 hash） | 完整性 1（重算不等） |
| M3 | 改暂存源库的一行 | 源绑定（启动即阻断） |
| M4 | 删除一条 `mig_object_map` | 完整性 2 |
| M5 | 删除一条 `created` 的目标行 | 完整性 2 |
| M6 | 给 preserve-only 表的某源行补一条领域映射 | 完整性 2 |
| M7 | 把一个合同的 `contract_category` 改成另一个合法值 | 逐字段 4 |
| M8 | 把一个 `effective_amount` 为 NULL 的合同改成等于总额 | 逐字段 5 |
| M9 | 把一个合同的 `signed_amount` 加 0.01 | 逐金额 6 |
| M10 | 交换两个合同迁移快照的 `remaining_uninvoiced_amount` | 逐金额 6（合计不变，逐行必须发现） |
| M11 | 改一条余额快照金额为当日较早一条的金额 | 逐金额 7 |
| M12 | 把一条非最新流水的 `is_day_latest` 置 1 | 逐金额 7 |
| M13 | 把一个客户的父指向另一个客户 | 关系 10 |
| M14 | 制造一个父链环（A→B→A） | 关系 10 |
| M15 | 把一个联系人挂到另一个客户 | 关系 11 |
| M16 | 把客户的主联系人指向别的客户的联系人 | 关系 12 |
| M17 | 把账户的 `account_no_masked` 改成别的掩码 | 安全 13 |
| M18 | 在某条异常的 `detail_json` 里写入一个完整账号 | 安全 13 |
| M19 | 给一个历史合同写入 `workflow_instance_id` | 安全 14 |
| M20 | 在批次期间向 `integration_operation` 插入一行来源为迁移对象的记录 | 安全 14 |
| M21 | 把一个对象的 `owner_uid` 改成 `system:other` | 安全 15 |
| M22 | 修改一条与本批无关的既有客户行 | 安全 16 |
| M23 | 把 `recorded_at` 整体后移 8 小时（模拟忘记换算） | 逐字段 4（时间） |
| M24 | 把一个合同的 `sign_date` 减一天（模拟按 UTC 取日期） | 逐字段 4（时间） |

M10、M23、M24 专门针对“合计相等但逐行错误”与“系统性换算错误”——这两类正是与 apply 共用代码时最容易漏掉的。

## 11. 属性与等价性测试

- **重放等价**：同一 plan apply 两次、以及在每个阶段边界各中断一次后续行，全部目标表与 `mig_*` 表的规范摘要逐表相同。
- **顺序无关**：改变分块大小（1、7、200）与源行读取顺序，结果摘要相同。
- **verify 幂等且只读**：连续两次 verify 结果相同；verify 前后全库行摘要不变（包括 `mig_batch` 的状态仅在首次成功时由 `applied` 变为 `verified` 这一处，单独断言）。
- **plan 只读**：plan 前后全库行摘要不变，保险箱访问日志无新增。
- **恒等式**（封存快照的数字只作为示例，测试用夹具自己的数字）：流水行数 + 占位余额行数 = 源余额行数；领域联系人数 + `contact_without_customer` 数 = 源联系人数；客户数 + 法人主体数 = 源组织数；合同数 = 源合同数。

## 12. 夹具要求

- 全部为合成数据；姓名、电话、账号使用明显的测试形态，账号带固定测试前缀，便于 §9 的词典扫描。
- 最小夹具须同时覆盖：三层客户树；`org_type` 0/1/2；有与无客户的联系人；合同的全部九种类型与三种状态；`prime_amount` 等于/小于/大于/NULL 四种；孤儿联系人引用；五种账户类型含无账号现金户；余额的 §7 全部情形；人员的 §8 全部情形；每张 preserve-only 表至少两行。
- 另备一个“漂移夹具”：多一列、少一列、未知枚举、未知表，用于阻断类断言。
- 夹具以 SQL 文件或构造函数的形式纳入仓库，并附一份与 W0 清单同结构的 `snapshot-manifest`，使 `stage-verify` 能照常运行。

## 13. 审查方式

W2-tool 提交审查时按以下顺序看：独立性的三条（§1）→ 黄金向量是否逐字节通过（§2）→ 各映射表是否由 verify 侧独立持有（§3–§9）→ 变异清单是否 24 项全部各有一个失败用例且指出源键（§10）→ 等价性测试（§11）。任何一项缺失，verify 视为未完成，不以 apply 的测试通过代替。

## 停机前转换审计与未评级向量

`stage-transform-audit` 在源/元数据的只读快照内完成结构核验、覆盖读取和全量转换值审计，不连接目标、Directory、Vault，不要求 Runtime 停止。多个错误必须同时返回；输出只有版本/封存hash/manifest hash、ready及 `table/field/category/count`，不含源主键、值、姓名、客户名、账号或原始驱动错误。每项count为违规行数，各项可重叠，不能求和作为违规总人数。

黄金向量：源 `[NULL,0,1,2,3,4,5,6]` → 目标 `[NULL,NULL,1,2,3,4,5,6]`。源规范字节 `{"stars":"0"}` 与 `{"stars":null}` 的摘要必须不同。隔离MySQL覆盖实际apply/独立verify/源台账保留；突变包括0目标变非NULL、1目标变NULL/6、源NULL目标变0、源变7（全部拒绝）。其它值（-1、7、空串、非字符串等）仍阻断。

审计反例：同一快照并存星级越界、银行类型未知、合同主体缺失、补充合同未支持、余额登记时间缺失时，必须一次返回全部类别与计数；审计不创建批次、不改变目标行。未分类的转换错误不得报告ready=true。审计PASS不能代替运行绑定/授权/目标冲突/停止证明等原有门禁。

### 合同N/Y与联系人错配验证补充

独立verify重建N→0/Y→1；原N/Y、contactman_id与源台账摘要一致。联系人存在且属于合同客户才关联；错配必须NULL并有一条contract_contact_mismatch（altoc/wb_contract/源键→altoc_contract/编码，detail仅sourceContactId/contactSourceOrgId）。

隔离黄金场景包括N/Y各一合同、跨客户联系人仍存在且合同无关联；突变：错配被重新挂接、N目标改1、Y目标改0、删除异常、篡改异常归属、抹掉源contactman_id，全部verify失败。NULL/0/1/小写/未知三方值仍被审计阻断。

### 银行账户排序回归

源 `account_sn` 为 NULL 时目标 `sort_no=0`，其余非 NULL 原值保留；目标排序改为 1 或台账源 NULL 改成字符串 0 均必须被独立 verify 拒绝。NULL 与字符串 0 的 source JSON 黄金文本分别为 `{"account_sn":null}`、`{"account_sn":"0"}`，摘要不得相同。


### 外部数值引用避碰矩阵

- 登记 Aims 旧合同引用、客户/联系人/银行账户/法人引用均高于目标最大值：起点采用引用最大值加一，实际 INSERT 使用 plan ID。
- 同一 plan 重建与同键重放 ID 不变、无重复对象。
- plan 后变更引用，apply 阻断且无 batch；apply 后变更引用，verify 阻断。
- verifier 独立拒绝新 ID 与旧引用相交、非连续排序 ID、实际存储 ID 不符。
- 目标整数类型溢出阻断（包括带显示宽度的旧 MySQL COLUMN_TYPE）。
- 全链 rollback retained=0，旧 Aims 行及引用保持原状。
