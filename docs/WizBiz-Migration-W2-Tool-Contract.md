# WizBiz → Enterprise APF：W2 迁移工具合同（plan / apply / verify / rollback）

日期：2026-10-04。状态：**已审合同（协调者决定见 §16），待实现；未写代码、未连接任何数据库。**

依据：[W1 模型设计](./WizBiz-Migration-W1-Model-Design.md)（下称 W1）、[W0 基线](./WizBiz-Migration-W0-Baseline.md)（下称 W0）、[差距分析](./WizBiz-Enterprise-Gap-Analysis.md)。已就绪的前置：安装器列增量子集（`domaininstall/columns.go`，`hzy-enterprise-add-apf --subset`）、负责人指派校验与 `system:unassigned`（`enterpriseapf/owner_guard.go`）、受保护 profile（`internal/migrations/cutoverprofile`）。

本文规定工具**必须做到什么、必须拒绝什么、怎样证明做对了**；不规定代码结构。凡写“阻断”，指该模式以非零退出、不写任何目标、并在报告中给出固定错误码。

## 1. 范围

### 1.1 一期迁入领域表的数据族

| 族 | 源表（封存快照行数） | 目标 | 备注 |
| --- | --- | --- | --- |
| identity | `wb_employee`（138）、`sys_user`（17） | `mig_identity_map` | 只建映射，不写 Directory |
| legal-entity | `wb_organization` 中 `org_type=0`（5） | `finance_legal_entity` | W1 §2 |
| customer | `wb_organization` 中 `org_type=1`（757） | `altoc_customer`（含 W1 新列）+ `altoc_customer_migration_snapshot` | 两遍：建行 → 回填父链 |
| contact | `wb_contactman`（1,594） | `altoc_contact`（含 `star_level`）；无客户的 721 行只入台账与队列 | W1 §6.2 |
| bank-account | `wb_bank_account`（22） | Console 保险箱密钥 + `finance_bank_account`（含 W1 新列） | 保险箱先行，W1 §3.3 |
| balance | `wb_account_balance`（2,754） | `finance_account_balance_entry`（2,627）+ `finance_account_balance_snapshot`（2,263）；`ba_id=0` 的 127 行只入台账与队列 | W1 §4 |
| contract | `wb_contract`（1,595） | `altoc_contract`（含 W1 新列）+ `altoc_contract_party` + `altoc_contract_migration_snapshot` | 历史导入 lane，W1 §5 |
| opening-receivable | 由 `wb_contract` 与 W0 §4.3 对账结果派生 | `altoc_billing_schedule`（`plan_type='opening_balance'`） | **单独的受审阶段**，见 §9 |

### 1.2 一期只保全（preserve-only）的数据族

下列源表一期**全部行、全部列**写入 `mig_source_row`，在 `mig_object_map` 中记 `disposition='preserved_only'`，不写任何领域表：

`wb_invoice`、`wb_project_income`、`wb_project_payment`、`wb_payment_plan`、`wb_system`、`wb_project`、`wb_product`、`wb_archives`、`wb_archives_page`、`wb_archives_list`、`wb_organization_info`、`wb_contactman_info`。

由此带来的一期限制，工具必须如实体现而不是绕过：合同的 `project_id` / `impl_project_id`、`system_id`、`archives_id`、`old_id` 只在台账保全（项目与系统的目标映射属于二期），不建 `altoc_contract_project_link`。

### 1.3 不在本工具范围

封存快照另有约 55 张表（薪资、考勤、项目贡献、周报、系统菜单与日志、定时任务等）。它们不属于 Altoc/Finance 的迁移范围，本工具**不读取、不入台账**；它们的保全依靠封存快照文件本身。工具对范围外的表不得静默忽略“新出现的业务表”：plan 把快照中存在、但既不在 §1.1/§1.2 也不在“已知范围外清单”里的表列为阻断项。

## 2. 命令形态与输入

单一命令（建议名 `hzy-wizbiz-migrate`），模式固定：

| 模式 | 写目标 | 作用 |
| --- | --- | --- |
| `stage-verify` | 否 | 核对暂存源库与封存快照清单一致，产出源绑定回执 |
| `plan` | 否 | 计算全部将要发生的写入与异常，产出受审 plan 与覆盖矩阵报告 |
| `apply` | 是 | 按已审 plan 分阶段写入；可断点续行 |
| `verify` | 否 | 独立重算并核对源、台账、目标三者 |
| `rollback` | 是 | 按批次撤回本批新建且未被使用的对象 |
| `status` | 否 | 输出批次与各阶段进度（只含计数） |

固定输入（全部是受保护文件：属主为执行用户、模式 0600、大小有上限；任何不满足即拒绝，错误信息不回显路径以外的内容）：

- `--profile`：目标 profile（§4）。
- `--snapshot-manifest`：封存快照清单（§3.1）。
- `--stage-receipt`：`stage-verify` 的回执（`plan` 起必需）。
- `--identity-confirmed`：已确认的人员映射（§7；可为空集）。
- `--plan` / `--review-hash`：`apply`、`verify`、`rollback` 必需。
- `--opening-confirmation`：期初应收的受保护确认文件（人工财务确认或用户裁定的封存快照派生类型，仅 §9 使用）。

不接受：任何自由 SQL、表名或列名参数；任何用于跳过检查的开关；从环境变量读取数据库口令或密钥。`plan`、`verify`、`status` 默认即只读；`apply`、`rollback` 必须显式给出模式与已审 hash。

## 3. 源只读与快照绑定

### 3.1 快照清单

W0 的封存快照是 OA 主机上的加密 SQL 文件。工具**从不连接在线的 OA 数据库**。源是把封存快照恢复出来的一个暂存库。清单文件（由产生快照的同一流程给出）至少包含：

```json
{
  "snapshotId": "20261004T173356Z",
  "sourceSystem": "wizbiz",
  "sqlSha256": "f3edc77e…e36da",
  "encryptedSha256": "12bcca2f…fdcdb5",
  "mysqlVersion": "8.0.45",
  "timezone": "Asia/Shanghai",
  "tables": { "wb_contract": { "rows": 1595, "primaryKey": ["contract_id"], "insertSequenceSha256": "e074825d…5884" }, "…": {} }
}
```

W0 的快照明确**不是停写水位**。正式迁移使用届时新取的快照及其清单；本合同对任何清单一视同仁，不内置 2026-10-04 的数字。

### 3.2 暂存库与 `stage-verify`

- 暂存库由操作者按受审步骤恢复：校验加密文件与解密流的 SHA-256 与清单一致后，把解密流直接导入一个专用实例/库，不落解密明文。恢复步骤不是本工具的职责，但其结果由 `stage-verify` 核对。
- 工具以**只读账号**连接暂存库：该账号对暂存库仅有 `SELECT`，对任何其它库无权限；工具启动时核对账号权限，发现写权限即阻断（与 `cutoverprofile.CheckAccount` 同一思路）。全程在 `START TRANSACTION READ ONLY` + 一致性快照下读取。
- `stage-verify` 核对：表集合、每表列定义（名称、类型、可空性）与清单一致；每表行数等于清单；并为每张范围内的表计算**规范行摘要**（§5.2 的 `row_sha256` 按主键顺序再做一次汇总）。产出回执：`snapshotId`、`sqlSha256`、暂存实例标识（`@@server_uuid`）、库名、每表行数与规范摘要、执行时间。
- W0 附录 A 的 `insertSequenceSha256` 是 mysqldump 文本行的摘要，无法从恢复后的库稳定重算；它由“加密文件与解密流的 hash 相符”间接保证。工具自己的规范摘要用于此后的全部核对，二者的对应关系记录在回执里。
- `plan`、`apply`、`verify` 每次启动都重新核对暂存库的实例标识、库名与规范摘要等于回执；不等即阻断——防止暂存库被替换或被改动。

## 4. 受保护的目标 profile

沿用 `cutoverprofile` 的形态与校验方式（受保护文件、固定版本号、身份逐项核对、错误不回显连接信息），新增一个版本 `wizbiz-migration-profile.v1`，内容：

- 目标身份：tenant、environment（只允许登记过的环境名）、Runtime 部署编码、统一库实例标识（`@@server_uuid`）与库名、Console 库名。
- 迁移账号：独立于 Runtime 运行账号与 root；对统一库的权限限于本合同涉及的表的 `SELECT/INSERT/UPDATE/DELETE`，无 DDL。
- Runtime 服务标识：用于“已停止”证明（与安装器同一机制）。
- 保险箱：是否允许写入（`vaultWrite: real | synthetic | forbidden`，见 §8）。

`plan` 与 `verify` 可以在 Runtime 运行时执行（只读）。**`apply` 与 `rollback` 必须在 Runtime 已停止的证明下执行**：迁移写入不经过领域写路径的并发控制，不能与用户写入并行；这也使回滚的“未被使用”判定成立。

## 5. 来源台账

### 5.1 写入时机

每个源行**先入台账、再写目标、最后写映射**，三者在同一个目标库事务内（它们都在统一库）。preserve-only 的行只写台账与映射。

### 5.2 规范 JSON 与行摘要

为了让 `row_sha256` 可由任何实现重算，规范如下：

- 一个 JSON 对象，键为源列名，按字节序升序；无多余空白；UTF-8；不转义非 ASCII 字符。
- 值：SQL NULL → `null`；其余一律为 JSON 字符串。整数为十进制文本；DECIMAL 为源的原始文本（保留标度，如 `"1200.00"`）；DATE 为 `YYYY-MM-DD`；DATETIME 为 `YYYY-MM-DD HH:MM:SS`（源本地时间，不换算，不带时区后缀）；字符类型为原字符串（空字符串与 NULL 不同）；二进制为小写十六进制。
- 脱敏列（目前仅 `wb_bank_account.account_number`）的值为对象 `{"$redacted":"vault","secretRef":"<ref>"}`；无账号的账户该列为 `null`。合成模式下 `secretRef` 指向合成密钥。
- 字符串转义为 RFC 8259 最小转义（只转义 `"`、`\\` 与 U+0000–U+001F；不转义 `/ < > &` 与 U+2028/2029）。完整规则与黄金向量见 [verify 测试规格](./WizBiz-Migration-W2-Verify-Test-Spec.md) §2。
- `row_sha256` = 上述字节串的 SHA-256。表级规范摘要 = 按主键升序连接各行 `row_sha256`（十六进制小写，换行分隔）后的 SHA-256。

因为脱敏对象含 `secretRef`，银行账户行的 `row_sha256` 只有在保险箱写入完成后才能确定；`plan` 对这类行输出“除脱敏列外”的摘要，`apply` 写入最终摘要，`verify` 用同一规则重算。

### 5.3 映射

`mig_object_map` 的 `(source_system, source_table, source_pk, target_domain, target_table, map_role)` 唯一。一个源行可有多条映射（例如合同 → `altoc_contract` 的 `primary`、`altoc_contract_party` 的 `derived`、`altoc_contract_migration_snapshot` 的 `snapshot`）。每个范围内的源行至少有一条映射；`verify` 以此证明“没有无去向的源行”。

### 5.4 对 W1 表结构的补充

断点续行需要逐阶段的状态。在 `apf_migration_ledger` 子集内补一张表（W1 §1.2 未列）：

```sql
CREATE TABLE mig_batch_step (
  batch_id     BIGINT UNSIGNED NOT NULL,
  step         VARCHAR(40) NOT NULL,             -- 见 §6.1 的阶段名
  status       VARCHAR(20) NOT NULL,             -- pending/running/done/failed/rolled_back
  planned_rows INT NOT NULL, done_rows INT NOT NULL DEFAULT 0,
  result_sha256 CHAR(64) DEFAULT NULL,           -- 阶段完成时的结果摘要
  started_at DATETIME(3) NULL, finished_at DATETIME(3) NULL,
  PRIMARY KEY (batch_id, step),
  CONSTRAINT fk_mig_batch_step_batch FOREIGN KEY (batch_id) REFERENCES mig_batch(id)
);
```

## 6. plan

### 6.1 阶段与顺序

固定顺序，后一阶段依赖前一阶段的映射：

`ledger-preserve`（§1.2 的全部表）→ `identity` → `legal-entity` → `customer` → `customer-hierarchy` → `contact` → `bank-account` → `balance` → `contract` → `contract-relations`（签约主体、第三方、联系人回填）→ `snapshots`（客户与合同的迁移快照）→ `exceptions`（汇总写入异常队列）。

`opening-receivable` 不在这条链里，是独立批次（§9）。

### 6.2 前置检查（任一不满足即阻断）

1. profile 身份与目标库实际身份一致；账号权限符合 §4。
2. Registry：目标的 generation 非零，Altoc 与 Finance 域为统一读写模式，绑定与 profile 一致。
3. **依赖子集已安装且定义相符**。工具内置一份依赖清单，逐项检查目标表/列/索引存在且定义摘要等于编译进工具的预期（不信任“看起来有这个列”）：
   - 新表子集：`apf_migration_ledger`（含 §5.4 的 `mig_batch_step`）、`finance_legal_entity`、`finance_balance_entry`（流水表）、两张迁移快照表。
   - 列增量子集：`finance-bank-account-columns`（已交付）、余额快照三列、合同新列与 `tax_rate` 放宽、客户新列、联系人 `star_level`。
   除 `finance-bank-account-columns` 外，这些子集**尚未实现**，是本工具之前的交付项（§15）。
4. 负责人保留值：目标 Runtime 版本包含负责人校验（`ReservedUnassignedOwner` 存在）；否则迁移写入的保留值会被后续用户写路径误改。以工具与 Runtime 同一构建版本的方式保证，plan 记录该版本。
5. 源绑定：暂存库与回执一致（§3.2）。
6. 币种声明：plan 输入含“本快照统一币种 = CNY，用户确认，确认人与日期”，缺失即阻断（W1 §5.3）。
7. 目标既有数据冲突（§6.4）。

### 6.3 字段覆盖矩阵

工具内置一份**编译进二进制的声明**，对 §1.1 与 §1.2 每张源表的每一列给出且仅给出一种处置：

| 处置 | 含义 |
| --- | --- |
| `map` | 写入指定目标列，附转换规则名（枚举映射、ID 重映射、时间换算、截断检查等） |
| `snapshot` | 写入迁移快照表的指定列 |
| `identity` | 经 `mig_identity_map` 转为 uid；未确认时按 §7 处理 |
| `vault` | 进入保险箱，台账脱敏 |
| `ledger_only` | 只在台账保全，附固定原因码（如 `phase2_family`、`derived_cache`、`no_target_semantics`、`all_null`） |

plan 对每一列统计：总行数、NULL 数、空白数、不同值数，并执行：

- 快照中存在而声明中没有的列，或声明中有而快照中没有的列 → **阻断**（结构漂移）。
- 任一列在声明中没有处置 → 构建期测试即失败；运行期再次检查。
- `map` 列出现转换规则无法处理的值（未知枚举、超长、非法日期、外键目标不存在且规则未声明如何处理）→ 逐值列出；属于“应入异常队列”的类型（§10）计入异常，其余 **阻断**。
- `ledger_only` 不是逃生口：原因码是封闭集合，每个 `ledger_only` 列在报告中单列，供审阅者确认“有值但不进领域表”是有意为之。差距分析附录 A 中标为“缺失”且 W1 未给出承载的列，必须在声明里逐列对上 W1 的处置；对不上的列 plan 阻断。

覆盖矩阵报告是 plan 产物的一部分，进入 `plan_sha256`。

### 6.4 目标既有数据

目标库可能已有业务数据（测试环境的夹具，或生产上线后的新数据）。规则：

- 幂等匹配只认来源键：`mig_object_map` 中已有映射的源行视为已迁移（核对目标仍存在且未被本工具以外的途径删除）。客户另核对 `altoc_customer(source_system='import:wizbiz', external_ref=<org_id>)`。
- **不按名称、编号或账号自动合并**。若目标中存在与某源对象“同名客户 / 同合同号 / 同简称或同户名账户 / 同名法人主体”但没有来源映射的行，plan 把它列为冲突并**阻断**，由人决定（改名、手工建立映射、或排除该源行）。决定以 plan 输入中的显式条目表达，不由工具猜测。
- 唯一键预检：对所有会触发目标唯一键的值（客户 code/external_ref、合同 code、账户 code/short_name、法人主体 code/name、保险箱 secretCode）预先检查，冲突即阻断，不留到 apply 中途才失败。

### 6.5 plan 产物

- `plan.json`：批次编码、profile 摘要、源绑定、依赖检查结果、各阶段的预期行数与预期结果摘要、目标编码分配表（见下）、异常清单的计数（按 kind）、币种声明。**不含**客户名称、联系人、账号等业务内容；对象以源表 + 源主键标识。
- `coverage.json`：§6.3 的矩阵。
- `review.txt`：给审阅者的摘要（只有计数与差异）。
- `ReviewHash`：对 plan 规范化内容的 SHA-256。apply 必须显式提供，且工具重算一致才执行。

**目标编码分配**：目标对象的稳定编码在 plan 阶段确定并写入 plan：按“源表 + 源主键”确定性派生，格式 `前缀-W<源主键十进制，不足 6 位左补零>`，前缀为客户 `CU`、联系人 `CN`、合同 `CT`、账户 `BA`、法人主体 `ENT`（如 `CU-W000123`；不用 `LE`，它已是 Altoc 线索的编码前缀），不调用运行时的编号发生器。运行时编码在前缀后是十六进制串，不含 `W`，两者不会相撞。理由：重放与断点续行得到同一编码；与日后人工新建的编号天然不冲突；一眼可辨来源。若所属域对编码格式有校验，按该域规则调整前缀，但必须保持确定性。

## 7. 目录身份只读映射

- 输入 `--identity-confirmed`：一个只含 `sourceUserId → directoryUid, confirmedBy, confirmedAt` 的受保护文件，由用户本人或人事负责人确认后生成（W1 §8.4-4；核对表本身只留在 OA 主机）。工具不接受 W0 的“候选”作为映射。
- 对每个已确认的 uid，工具通过 Directory 的只读入口核对存在与当前状态，把状态快照写入 `mig_identity_map.directory_status`。**不写 Directory，不创建、不启用、不修改任何用户**。
- 写入规则：
  - 负责人列（`owner_uid` 等）：已确认且 Directory 状态为有效 → 该 uid；否则 → `system:unassigned`（经 `ValidateMigrationOwner`），`owner_dept_code` 置 NULL，并对在办对象生成 `owner_unmatched` 异常。已确认但已非有效用户的，不作为在办对象的负责人。
  - 操作人/登记人列（`created_by`、`updated_by`、`recorded_by` 等）：已确认 → uid（不要求有效）；否则 → NULL，显示名保留在专门的显示名列（如余额流水的 `recorded_by_name`）或仅在台账。
  - 源 ID 不存在于源人员表 → `source_missing`，同“未确认”处理。
- 部门：一期不迁移任何部门归属（源组织没有部门字段）；`owner_dept_code` 仅在负责人为有效用户时按 Directory 主部门填写，由同一次只读查询取得，否则为 NULL。

## 8. 保险箱写入

- 顺序固定（W1 §3.3）：对每个有账号的账户，先 `CreateVaultSecret`（`secretCode = finance.bank-account.<code>.account-no`，`usageType=custody`），取得 `secretRef`，再在统一库事务中写台账、账户行与映射。保险箱在 Console 库，不与统一库同事务。
- 幂等：`secretCode` 已存在时，核对其 `ownerType/ownerKey` 属于同一账户且内容摘要相同 → 复用；内容不同 → 阻断（不新增版本、不覆盖）。
- 工具在 Runtime 主机上用 Runtime 的受保护配置构造 Console 保险箱适配器（主密钥只在该处），**进程内调用**，不经 HTTP、不签服务令牌。
- 账号明文只存在于进程内存：不写 plan、报告、日志、台账、临时文件；异常信息中不得出现。工具的日志与报告由测试以“不含连续 8 位以上数字的源账号片段”扫描。
- profile 的 `vaultWrite`：
  - `real`：写入真实账号。属于凭证写入，须按环境单独批准：profile 必须带用户批准记录 `approval { approver, date, scope, note }`（§16-4），缺失或范围不符即阻断；记录写入 `mig_batch` 与回执。
  - `synthetic`：不读取源账号列；为每个账户生成确定性的合成值（由账户源主键派生，带明显的测试前缀）写入保险箱。用于 hzy0 等演练环境。
  - `forbidden`：不写保险箱；`bank-account` 阶段把有账号的账户全部列为阻断项。用于只做 plan 的环境。
- 现金户等无账号的账户不建密钥。
- 回滚不删除密钥：停用并保留（W1 §3.5）。`verify` 列出“存在密钥但无账户引用”的条目。

## 9. 期初应收（独立批次）

- 前提：主批次已 `verified`。
- 输入：`--opening-confirmation`，由财务确认的清单文件，逐合同给出取值。工具先自行计算候选（用户决定，W1 §8.4-3）：
  - 缓存与明细重算一致的合同：候选值 = 重算值。
  - 不一致的合同（封存快照为 20 个）：候选值 = 源缓存值，同时生成 `contract_balance_mismatch` 异常（含缓存值、重算值、差额）。
  - 重算需要 `wb_project_income` 等明细：这些行在一期是 preserve-only，但已在台账中；工具从暂存源库读取，不依赖领域表。
- 只为“销售方向、剩余应收 > 0”的历史合同生成，每合同至多一行：`plan_type='opening_balance'`、`source_type='historical_import'`、`trigger_type='manual'`、`amount=确认值`、`received_amount=0`、`due_date=NULL`（除非确认文件给出）、`collection_responsible_uid=NULL`。
- 确认文件与候选不一致的合同，以确认文件为准并在 plan 中逐条列出差异；确认文件缺少的合同不生成（不默认）。
- 采购合同的剩余应付不在一期（W1 §7.2-2）。
- 该批次有自己的 plan / review hash / verify / rollback；回滚条件：该行没有任何核销、发票或调整引用。

## 10. 异常队列

异常是**计划内的结果**，不是失败。plan 列出全部异常的计数，apply 的 `exceptions` 阶段写入 `mig_exception`。封闭的 `kind` 集合及其触发条件：

| kind | 触发 | 一期预期（封存快照） |
| --- | --- | --- |
| `owner_unmatched` | 在办客户/合同的负责人未确认映射或已非有效用户 | 取决于确认结果 |
| `contact_without_customer` | 联系人 `org_id` 为 NULL | 721 |
| `contact_orphan` | 合同引用的联系人不存在 | 29 |
| `contract_contact_mismatch` | 联系人存在但客户与合同客户不同；合同关联置NULL | 16 |
| `primary_contact_mismatch` | 客户主联系人不属于该客户 | 待 plan 统计 |
| `balance_without_account` | 余额 `ba_id=0` | 57 组（127 行） |
| `balance_latest_conflict` | 真实账户当日最新并列且金额不同 | 0 |
| `contract_balance_mismatch` | 合同余额缓存与明细重算不符 | 20 |
| `effective_amount_exceeds_total` | 有效额大于总额 | 6 |
| `identity_source_missing` | 业务表引用的人员 ID 不在源人员表 | 16 个 ID |

不在集合内的情况一律是阻断，不新造 kind。`detail_json` 只含处理所需的最小结构化信息（源键、金额、枚举值），不含姓名、电话、账号。唯一例外是 W1 §6.2 规定的“待归属联系人”检索字段，它们在读取时取自台账，不复制进异常行。

### 10.1 异常行的键与 `detail_json` 形状（工具写、队列读的共同合同）

迁移工具写入、W3 队列页面读取，两边按下表实现；队列接口按 `kind` 的白名单逐键投影，表外的键不会被返回。全部值为字符串或字符串数组（金额保留源标度），不含姓名、电话、账号。`source_pk` 一律是文本。

| kind | `owning_domain` | `source_table` / `source_pk` | `target_table` / `target_key` | `detail_json` 键 |
| --- | --- | --- | --- | --- |
| `owner_unmatched` | altoc | `wb_organization` 或 `wb_contract` / 源主键 | `altoc_customer` 或 `altoc_contract` / 目标编码 | `sourceUserId`（源业务员 ID） |
| `contact_without_customer` | altoc | `wb_contactman` / 源主键 | NULL | `sourceUserId`（源业务员 ID，可为 `null`） |
| `contact_orphan` | altoc | `wb_contract` / 源主键 | `altoc_contract` / 目标编码 | `sourceContactId` |
| `contract_contact_mismatch` | altoc | `wb_contract` / 源主键 | `altoc_contract` / 目标编码 | `sourceContactId`、`contactSourceOrgId`（可为null） |
| `primary_contact_mismatch` | altoc | `wb_organization` / 源主键 | `altoc_customer` / 目标编码 | `sourceContactId`、`contactSourceOrgId`（该联系人实际所属的源组织，可为 `null`） |
| `effective_amount_exceeds_total` | altoc | `wb_contract` / 源主键 | `altoc_contract` / 目标编码 | `totalAmount`、`effectiveAmount` |
| `contract_balance_mismatch` | finance | `wb_contract` / 源主键 | `altoc_contract` / 目标编码 | `recomputedAmount`、`cachedAmount`、`difference` |
| `balance_without_account` | finance | `wb_account_balance` / `date:<YYYY-MM-DD>`（按日期分组，一组一行） | NULL | `balanceDate`、`entryCount`、`latestAmounts`（当日最新时刻的各不同金额）、`sourceEntryIds` |
| `balance_latest_conflict` | finance | `wb_account_balance` / `account:<源账户 ID>|date:<YYYY-MM-DD>` | `finance_bank_account` / 目标编码 | `balanceDate`、`latestAmounts`、`sourceEntryIds` |
| `identity_source_missing` | altoc | `wb_employee` 或 `sys_user` / 被引用但不存在的源 ID | NULL | `referencedBy`（引用它的源表名数组） |

- “待归属联系人”的检索与展示字段不在 `detail_json` 里，队列读取时从 `mig_source_row.row_json` 取以下**固定白名单**键：`cm_name`、`department`、`post`、`phone`、`mobile`、`mobile2`、`stars`、`chief`；`employee_id` 只用于经 `mig_identity_map` 换成显示名，不直接返回。
- 人员显示名一律取 `mig_identity_map.display_name`，不从其它台账行拼接。**键的对齐**：`mig_identity_map.source_user_id` 是带命名空间的键——`employee:<wb_employee 主键>` 或 `user:<sys_user 主键>`（工具定稿）；异常行 `detail_json.sourceUserId` 是**裸的业务员 ID**（即 `wb_employee` 主键）。队列在查显示名与统计名下事项时统一拼成 `employee:<id>` 再比对；操作账号 `user:<id>` 不会与业务员事项相匹配。队列的人员匹配命令以完整键（如 `employee:7`）标识源人员。
- `status` 初值 `open`；工具只在 apply 的 `exceptions` 阶段插入，此后不再更新这些行（处理状态的写入方见 W3 页面设计 §5.5）。

## 11. apply：分批、幂等与断点续行

- 每个阶段内按源主键升序分块（建议每块 ≤ 200 行）；**每块一个目标库事务**：台账行、目标行、映射行、阶段进度一起提交。
- 幂等：处理每个源行前先查映射；已有 `created/matched_existing/preserved_only` 的行跳过，并核对目标行仍存在。因此同一 plan 的 apply 可以重复执行，结果不变；进程被杀后重跑从未完成的块继续。
- 阶段开始与结束更新 `mig_batch_step`；阶段结束时计算结果摘要并与 plan 中的预期摘要比较，不等即停止在该阶段（不继续后续阶段）。
- 两遍结构（客户父链、合同父链与关系回填）：第一遍建行，第二遍只做回填；回填前全量检查环与缺父（W0：组织无环、最长 3 层；合同目前全部为根）。出现环即阻断。
- 历史合同写入满足 W1 §5.4：`origin_type='historical_import'`、`amount_basis='header'`、四轴状态按映射表、不写 `workflow_instance_id/approved_*`、不产生 `integration_operation`、不触发任何出站或 Finance 摘要同步。工具直接写表，不调用领域的“创建合同”写路径（那条路径会触发副作用），因此必须自行满足该表的全部约束与 W1 的 CHECK。
- 时间：瞬时类列按 Asia/Shanghai → UTC 换算（W1 §8.2-1）；DATE 原样。
- 每次 apply 结束（成功或失败）输出回执：批次、阶段状态、计数、下一步可执行的模式。失败时不自动回滚——已提交的块保留，供续行或显式 rollback。
- 同一 profile 同时只允许一个 apply/rollback 在运行（库级互斥锁）。

## 12. verify：逐对象与逐金额核对

verify **只读源、台账、目标三处的当前内容**，不使用 apply 留下的中间文件；每一类核对都要给出“应有数、实有数、差异清单（以源键标识）”。任何一项不为零差异，verify 即失败。

**完整性**
1. 范围内每张源表：行数 = 台账行数；每行 `row_sha256` 按 §5.2 从暂存源重算后与台账相等。
2. 每个源行在 `mig_object_map` 中有去向；`created` 的目标行存在；`preserved_only` 的源表没有任何领域表映射。
3. 各族计数恒等式，例如余额：流水行数 + `ba_id=0` 行数 = 源行数；快照行数 = 真实账户的（账户, 日期）分组数；联系人：领域行数 + `contact_without_customer` 异常数 = 源行数。

**逐字段**
4. 对每个 `map` / `snapshot` 列：由源行按声明的转换规则重算期望值，与目标列逐行比较。转换规则在 verify 中由独立于 apply 写入代码的函数实现（至少：枚举映射表、ID 重映射查表、时间换算各有一份只供 verify 使用的实现或表驱动断言），避免“同一段错误代码自己验证自己”。
5. NULL 语义：源为 NULL 的列目标也为 NULL（特别是 `prime_amount`、`count_recerivable`、`bank_code`、`customer_level_id` 一律 NULL）。

**逐金额（Decimal 精确相等，不允许容差）**
6. 合同：`signed_amount` 合计 = 源 `total_amount` 合计；`effective_amount` 非 NULL 行合计 = 源 `prime_amount` 合计；迁移快照的两列合计 = 源 `invoice_amount`、`exec_amount` 合计。逐合同也逐一相等。（封存快照的参考值见差距分析 §5.3；verify 以当次快照重算，不硬编码。）
7. 余额：流水金额逐行相等；每个（账户, 日期）的快照金额 = 按 W1 §4.2 规则独立重算的值；`latest_tie_count`、`distinct_amounts` 与重算一致。
8. 客户迁移快照各列 = 源缓存列。
9. 期初应收（其批次）：每行金额 = 确认文件；合计 = 确认文件合计；每合同至多一行。

**关系**
10. 客户父链：每个非根客户的父 = 源父经映射后的目标；无环。
11. 联系人 → 客户、合同 → 客户 / 联系人 / 第三方 / 签约主体、账户 → 法人主体、余额 → 账户：逐行等于源引用经映射后的目标；孤儿引用按 §10 处理后的结果一致。
12. 主联系人属于该客户。

**安全与副作用**
13. 保险箱：有账号的账户各有一个 `custody` 密钥且 `ownerKey` 对应；账户行的掩码与保险箱掩码一致；台账、映射、异常、plan、报告与日志中检索不到任何完整账号（按账号长度特征扫描）。`real` 模式下另由财务管理员抽样揭示核对（人工步骤，记录在验收单，不由工具执行）。
14. 历史合同没有 `workflow_instance_id`、`approved_at/approved_by`；本批期间 `integration_operation`、出站投递、Finance 摘要表没有因迁移新增行（以批次开始时的计数/最大 id 为基线比较）。
15. 负责人：所有迁入对象的 `owner_uid` 要么是确认映射中的有效用户，要么是 `system:unassigned`；不存在其它保留主体或空值。
16. 非目标对象不变：本批没有映射的既有目标行，其行摘要与批次开始时记录的基线相同（证明迁移没有碰到别人的数据）。

verify 成功后把批次置为 `verified`。verify 可在任何时候重复执行。

## 13. rollback：边界

- 只针对一个批次；逆阶段顺序执行；Runtime 停止证明与已审 hash 同 apply。
- 只删除本批 `disposition='created'` 的目标行，且逐行满足“未被使用”：`row_version` 仍为迁入值；没有本批之外的任何行引用它（合同被结算计划/发票/收款/项目关联/工单引用，客户被本批之外的合同/报价/商机引用，账户被收款或本批之外的余额引用，联系人被引用，法人主体被本批之外的合同或账户引用）。任一行不满足 → 该行及依赖它的上游全部保留，rollback 以“部分完成”结束并列出保留清单，不强删。
- 双向外键（客户主联系人 ↔ 联系人）：先清主联系人引用，再删联系人，再删客户。
- 不删除：`mig_source_row`（台账保全，按保留期处理）、保险箱密钥（停用保留）、异常行中已被人工处理的条目（保留并标记所属批次已回滚）。`mig_object_map` 行保留，批次状态置 `rolled_back`。
- 期初应收批次必须先于主批次回滚。
- 业务已开放写入并产生对迁入对象的引用后，回滚基本不可行——这是预期的；届时的更正走领域内的正常修改，不走本工具。不提供整库覆盖式的回滚捷径。

## 14. 输出与隐私

- 所有产物文件 0600；stdout 只输出计数、阶段名、错误码与源键。客户名称、联系人姓名与电话、账号、合同名称不出现在任何输出中。
- 固定错误码表（实现时给出完整清单并保持稳定）：身份不符、依赖缺失、源绑定不符、结构漂移、覆盖缺口、目标冲突、币种未声明、保险箱不允许、阶段摘要不符、Runtime 未停止、review hash 不符等。
- 演练环境使用真实封存快照时，客户与联系人的真实信息会进入该环境的领域表；工具提供 `synthetic` 的只有账号，不对客户名称等做脱敏。用户已同意 hzy0 演练使用真实快照，边界见 §16-3。其它环境若要使用真实快照，需另行取得用户确认。

## 15. 实现前置与测试要求

**apply 的运行时前置**：目标环境的 Runtime 必须包含“历史导入合同的操作护栏”（MODULE_CONTRACTS 同名节）；`plan` 的前置检查记录 Runtime 构建版本，不含该护栏的版本阻断历史合同阶段的 apply。

**先于本工具交付的安装子集**（§6.2-3）：`apf_migration_ledger`（含 `mig_batch_step`）、`finance_legal_entity`、`finance_balance_entry`、余额快照三列、合同新列与 `tax_rate` 放宽、客户新列、联系人 `star_level`、两张迁移快照表。注意 W1 的列增量里有外键与 CHECK（客户主联系人外键、合同 `origin_type` CHECK），而已交付的列增量声明（`ColumnDeclaration`）目前只有“加列、加索引、放宽可空”三种元素，**不能表达外键与 CHECK**。已决定扩展列增量声明以支持受审的 `ADD CONSTRAINT`，不降级（§16-5）。

**隔离 MySQL 测试（合成的 WizBiz 夹具，不使用真实数据）至少覆盖**

1. 源绑定：暂存库被改一行 → plan/apply/verify 均阻断。
2. 覆盖矩阵：源多一列、少一列、声明缺处置、未知枚举值 → 阻断并给出对应错误码。
3. 依赖缺失或列定义不符 → 阻断。
4. 幂等：同一 plan 连续 apply 两次，目标与台账无差异；任意阶段中途杀进程后重跑完成，结果与一次跑完相同（比较全部目标表与台账的摘要）。
5. 目标既有冲突（同名客户、同合同号、同简称账户）→ 阻断；带显式决定后按决定执行。
6. 人员：已确认有效、已确认非有效、未确认、源缺失四种情形下负责人列与操作人列的取值；在办对象生成 `owner_unmatched`。
7. 余额：同额并列（多行 `is_day_latest`）、不同额并列（不生成快照、入队）、`ba_id=0`、无历史账户。
8. 合同：四种状态映射、三种金额与 NULL、有效额大于总额入队、不产生任何 Workflow/集成/Finance 摘要行。
9. 保险箱：`forbidden` 阻断；`synthetic` 不读取源账号列（用会在读取该列时失败的夹具证明）；`real` 的顺序与幂等；任何输出中无账号。
10. verify：对每一类核对各造一个错误（改一行金额、删一个映射、改一个父链、改一个既有非目标行），verify 必须失败并指出源键。
11. rollback：干净回滚后目标表与基线摘要相同；被引用对象拒绝删除并报告；保险箱密钥保留并停用；双向外键顺序正确。
12. 期初应收批次：确认文件缺行、与候选不一致、重复 apply、已有核销引用时的回滚拒绝。

## 16. 决定（协调者，2026-10-04）

1. **确定性编码：采用。** 由实现方在 W2-schema 工作包中核实 Altoc/Finance 的 `code` 列没有格式校验或唯一冲突；发现冲突即停下报告，不自行改用其它方案。
2. **apply / rollback 要求 Runtime 停止：接受。** hzy0 演练与将来的生产迁移都按停机窗口安排。
3. **演练可使用真实封存快照（用户决定，2026-10-04，经协调者转达）。** hzy0 演练可以直接使用真实封存快照；银行账号仍用 `synthetic` 模式，工具不读取源账号列。边界：
   - 真实快照只恢复到 **hzy0 本机的暂存库**。加密文件、解密流与暂存库都不得复制到其它主机、云环境或 OSS；解密明文不落盘（§3.2）。
   - 暂存库中仍含真实账号列（它是快照的一部分）：工具在 `synthetic` 模式下不读取该列，但暂存库本身必须按同等敏感度保护（只读账号仅限本机、库不对外监听），并在演练结束后清理。
   - 演练导入的客户、联系人、合同等真实信息会进入 hzy0 的领域表。演练结束后二选一并留记录：按 §13 回滚演练批次并删除暂存库，或保留演练数据——保留须另行记录保留范围、原因与责任人，不默认保留。来源台账（`mig_source_row`）在演练环境同样按此处理，不适用生产的长期保留规则。
   - 报告、日志、plan 与回执仍不输出任何个人信息（§14 不因使用真实快照而放宽）。
   - hzy0 与生产共用 OSS 桶与 Platform：本工具不写 OSS、不调用 Platform，演练不得借此向二者写入任何真实数据。
4. **`real` 保险箱写入的审批：每环境一次的用户批准记录。** profile 中必须带 `approval { approver, date, scope, note }`，其中 `scope` = 环境 + 批次；缺失或与当前环境/批次不符即 apply 阻断。approval 原样写入 `mig_batch` 与 apply 回执。（§8 中“批准引用作为 apply 的必填输入”即指此项，以 profile 为准，不另设命令行参数。）
5. **外键与 CHECK：不降级，扩展列增量子集支持受审的 `ADD CONSTRAINT`。** 外键要求被引用列与引用列各有可用索引（同批新增或既有）；CHECK 在 plan 阶段对存量全表预检是否满足，不满足即阻断；rollback 先删约束、再删列。

`mig_batch_step` 新表已认可，并入 W1 §1.2。

**工作包拆分**：W2-schema（W1 的全部对象作为安装器子集，加上列增量的约束扩展）→ W2-tool（本合同的工具本体）。两者由 Codex 实现；W2-tool 中 verify 的独立实现部分由 fa 审查。

## 停机前源转换值审计（2026-10-05）

新增只读模式 `stage-transform-audit`：先核验结构/清单，再对同一源只读快照收集全部转换值违规，不因第一行失败提前结束。不读真实银行账号（synthetic模式列级拒读沿用），不连接目标/Directory/Vault，不操作 Runtime。成功输出受保护审计JSON；非零违规输出完整计数后exit1。输出含版本、SQL/manifest SHA-256、ready和固定的表/字段/类别/计数；无源值/源主键/个人信息/客户名/完整账号。未知结构或权限依赖失败仍关闭，不伪造审计完整结果。

受审标量检查复用apply校验函数；合同枚举复用同一闭集事实；关系/父链/余额及合同逐行收集。无分类违规时仍调用原 `BuildPrepared` 作最终转换守卫，任何未分类失败按 `transform/result/unclassified` 阻断。审计不替代plan目标唯一性/授权/定义/版本/停止门禁。审计未清零禁止进入维护窗口；未裁定类别报告协调者，不自动修源或变更映射。

联系人stars口径：0=未评级→目标NULL；源NULL→NULL；1..6原值；其它值阻断。源台账保留0原始字符串，源0与源NULL摘要不同；独立verify不调用apply星级函数，分别重建映射核验目标并校验原台账。无客户联系人沿原只进台账/队列规则。

### 合同值裁定补充（2026-10-05）

三方标志严格N→0、Y→1（字典“否/是”）；源原字节留 `mig_source_row`，其它值阻断。联系人错配为计划内异常：不复用“源不存在”的contact_orphan语义，不跨客户挂接，不阻断合同；新增 `contract_contact_mismatch` 闭集kind。队列可接受现状、重新打开、标记处理，均沿用既有审计/版本/人员门槛，不自动改联系人关联。

### 银行账户缺失排序（2026-10-05 用户裁定）

`wb_bank_account.account_sn=NULL` 映射 `finance_bank_account.sort_no=0`；非 NULL 原值不变。源 NULL 与字符串 0 的规范摘要保持不同，台账原样保留，独立 verify 同时检查目标默认值和源值未篡改。真实快照 22 行属于此映射，不改源库。


### 确定性数值 ID 与存量外部引用（2026-10-05 裁定）

存量 Aims 悬空引用不修改、不删除，记为数据质量项。plan 在同一只读快照中扫描 Runtime 登记物理表的数值引用列及声明指向迁移目标 `id` 的外键；至少覆盖 `aims_aims_projects.contract_id`。每个自增数值 ID 目标按 `max(目标既有 MAX(id), 全部外部引用最大值)+1` 开始，按 `source_table/source_pk/map_role` 的字典序分配。目标列类型上界不足时阻断，显式 INSERT ID，不执行 ALTER AUTO_INCREMENT 或其它 DDL（引擎按正常 INSERT 推进计数不属于额外 schema 操作）。

plan 保存列类型、目标最大值、起点、逐对象 ID、引用表/列/主键定义、每行主键摘要与 NULL/数值快照；全部进入 reviewHash。apply 前复核快照，续行仅排除同批已冻结 seal 的自建行；既有或新增外部引用、元数据、目标 MAX 漂移均阻断。旧无分配快照的 plan 不兼容，必须重新生成并审核。

verify 独立重算起点与排序，核对实际存储 ID，并断言全部新 ID 与迁移前外部引用不相交。回滚继续遵守外部引用保留规则，不借避碰放宽删除条件。源业务编码、Vault secretRef 与所有源字段保全规则不变。

引用列闭集：客户 `customer_id/parent_customer_id/third_party_customer_id/converted_customer_id`；联系人 `contact_id/primary_contact_id`；合同 `contract_id/source_contract_id/parent_contract_id`；合同方 `contract_party_id`；银行账户 `bank_account_id/receiving_bank_account_id/paying_bank_account_id/account_id`；法人 `legal_entity_id`；余额流水 `account_balance_entry_id/balance_entry_id`；余额快照 `account_balance_snapshot_id/balance_snapshot_id`。声明外键补充列名不同的引用。`*_code`、uid、客户类型/等级 ID、contract_line_id、contract_project_link_id 属于其它命名空间，不据此引用上述目标 ID。


## 18. hzy0 期初应收与真实账号后续操作（2026-10-06）

### 18.1 确认来源闭集

用户已决定以封存快照替代财务确认文件。保留人工类型 `finance_confirmation`；旧文件未带 `sourceType` 时维持人工类型行为。新增类型仅为 `user_ruling_snapshot`，不得接受任意来源字符串。

`opening-derive` 只读生成确认集，绑定原主批次 reviewHash、manifest SHA-256、原始 SQL SHA-256、口径 `w1-opening-receivable.v1`、用户裁定日期和快照截至日。派生金额仍按 §9 的候选规则：签约总额减收入明细；与缓存不一致时使用缓存，不扣有效额或税额。仅纳入非采购且剩余金额为正的合同，不推断到期日。确认文件包含逐合同金额和按源客户主键汇总的合同数/金额，不包含客户名称。

`user_ruling_snapshot` 必须完整覆盖确定性候选，逐行金额和客户汇总均需与重算结果完全一致；删行、改金额、改截至日、改来源 hash 或增加到期日均拒绝。人工类型的既有缺行/金额差异行为不变。批准记录是操作审批证据，不是认证边界。

### 18.2 synthetic → real 的候选升级工具

追加模式为 `vault-upgrade-plan/apply/verify/rollback`。限既有 `synthetic` 主迁移的 `C000001/test`，另需受保护批准记录，scope 为 `test/<主批次>/vault-real`。原主计划、reviewHash、秘密引用、源台账和对象映射不变，补充计划单独计算 reviewHash。

plan 冻结源账号摘要、脱敏显示、原版本 ID/号、原账户行摘要及配置摘要。账号明文只在进程内存中出现。apply 要求 Runtime 已停止，并取得现有迁移锁。先在主批次 scope 中冻结补充意图，再通过 Console owning 的 `AddVaultSecretVersion` 轮换加密版本，最后在统一库事务内更新脱敏显示、行版本和补充进度。Console 使用补充 reviewHash/action/code 派生的稳定幂等键。轮换成功而领域事务未完成时，同键从既有 Console 回执续行，不重复创建版本。

verify 核对来源摘要、当前秘密版本/摘要/脱敏显示、Console 回执、版本前驱和账户行摘要。rollback 通过新版本恢复确定性的 synthetic 值，保留已加密的真实版本与审计，不删除任何秘密或版本。已发生升级的主批次不允许走旧主迁移 apply/rollback，避免旧工具停用或改写多版本秘密。恢复主批次需先审查补充版本历史，不能把补充 rollback 视为清除历史。

### 18.3 配置证据与执行门禁

原主迁移的配置文件摘要保持有效。若当前配置仅增加 `apps.codocs.collaborationV2Enabled` 和 `departmentCollaborationV2Enabled` 两个布尔键，可通过 `--baseline-runtime-config` 提供原受保护配置作为证据。原文件必须匹配原计划 hash，除这两个原来不存在的键之外，当前配置必须与原文件逐项一致。既有键值变化、未知键、非布尔取值、库/身份/代次/密钥路径变化均拒绝。后续计划另绑定当前完整配置摘要；不改写配置或关闭协作。

执行前仍需主批次独立核验通过、全身份预检、加密备份可解密核验、磁盘门禁，以及同 SHA runner/制品的隔离副本彩排。2026-10-06 已批准将经审计的迁移后业务变更冻结为补充基线：本次仅接受银行账户状态、法人主体状态及其各一条 Finance 审计和成功命令回执造成的四类差异。工具重新核对有效 Directory 操作者、迁移后的时间、精确 operation/client/部署与版本；其它差异仍阻断。补充计划绑定归因证据和当前全量基线摘要，apply 前及 verify 时复核，原主批次 reviewHash 与源台账不变。不恢复旧业务数据；通用的迁移后业务变更分类机制列为后续改进。

### 18.4 真实账号的冻结与空白规范化

2026-10-06 用户批准：仅首尾 `TrimSpace` 后入 Vault，内部字符不变。封存加密快照保留原始值；补充计划及 `mig_batch.scope_json` 记录每行 `trim_applied` 与 `trim_count`，不含账号值。本次快照 21 个非现金账户必须恰好 1 例；runner 在任何写入前核对。verify 同时核对原始内容 HMAC、trim 标记与计数、trim 后 Vault 内容。

补充计划仅保存 Runtime 现有 Vault 密钥派生的域隔离 HMAC（绑定原主批次 reviewHash、账户稳定编码及原始内容），不保存真实账号的无盐 SHA-256。Vault 的既有内容哈希只在进程内读取和比较，不复制到计划、日志或报告。没有新增主密钥、读取密钥文件到制品或扩大揭示权限。
