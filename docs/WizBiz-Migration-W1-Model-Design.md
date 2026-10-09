# WizBiz → Enterprise APF：W1 无损模型增补设计

日期：2026-10-04（同日修订 r2：按协调者决定改为“APF 表优先受审加列”，并写入只读代码核查结果；r3：补前端显示名核查；r4：按 W0 基线补齐字典、口径与规则；r5：写入用户六项决定并增加合同金额事实表前瞻；r6：按 W0 补充统计修订余额规则、客户等级与主体映射，税费口径已定，列增量不改 Registry）。状态：**设计草案，供协调者审查；未写代码、未执行任何环境操作。** W0 基线见 [`docs/WizBiz-Migration-W0-Baseline.md`](./WizBiz-Migration-W0-Baseline.md)（Codex-sol）；r4 已把其结论并入各节，汇总见 §8.2。正文中个别仍写“待 W0”的地方以 §8.2 的结论为准。

依据：[差距分析](./WizBiz-Enterprise-Gap-Analysis.md)（含 §8.1 七项用户决定）、`docs/Enterprise-APF-Domain-Design.sql`（当前目标结构）、`data-runtime/internal/enterprise/domaininstall/*.json`（安装子集）、`altoc/app.manifest.json` 与 `finance/app.manifest.json`、Runtime Console 保险箱（`data-runtime/internal/apps/console/vault.go`）。本文只对照仓库实现，未连接任何数据库。

## 0. 设计原则与总体结构

1. **来源保全与业务模型分离。** APF 设计文件开头已写明「不含任何 legacy_* / 迁移映射列」。本设计保持这一点：老 OA 的原始行、源 ID、缓存统计、未定字典值全部进入独立的**迁移来源台账**；领域表只增加**今后业务本身需要**的字段（账户简称、行号、法人主体、主联系人、合同签约额/有效额等）。判断标准：一个字段若在没有老 OA 的新租户里也有意义，才进领域表。
2. **目标不受老 OA 局限。** 不照搬 `wb_*` 的缓存列与反向语义（例如 `invoice_amount` 实为“剩余未开票”）。老值作为带日期的“迁移快照”保存和展示，新页面从事实派生（用户决定 2）。
3. **APF 表优先受审加列；新实体与迁移快照用新表。** 协调者核对确认：APF 表（`apf_altoc`/`apf_finance` 等子集）逻辑名与物理名相同、没有兼容视图族，加列不需要重建视图；视图问题只存在于从独立库迁入的 Aims/Assets 存量表。因此属于“该对象本身的业务字段”的增补，一律对 APF 表做受审 `ADD COLUMN`（个别处受审放宽 NULL）。1:1 扩展表不再使用。仍然建新表的只有三类：新实体（法人主体、余额流水）、带日期的迁移快照（独立生命周期，只读）、来源台账。受审加列需要安装器新增“列增量子集”能力，作为 W2 的前置工作包，见 §9.1。
4. **授权不扩大。** 新对象沿用所属域的人员资源；敏感动作单列动作，不靠 `admin` 蕴含（根规则：`admin` 只蕴含同资源的 view/edit/admin）。除第 3 节的保险箱读取说明外，不新增任何服务 capability。
5. **历史不伪造。** 不为历史数据生成 Workflow 实例、审批人、签署/生效事件、集成投递或当前责任人。

### 0.1 新增与变更对象一览

| 子集（建议名） | 类型 | 所属域 | 内容 | 节 |
| --- | --- | --- | --- | --- |
| `apf_migration_ledger` | 新表 | 迁移（Runtime 内独立包） | `mig_batch`、`mig_batch_step`、`mig_source_row`、`mig_object_map`、`mig_identity_map`、`mig_exception` | 1、6 |
| `finance_legal_entity` | 新表 | Finance | `finance_legal_entity` | 2 |
| `finance_bank_account_w1` | **列增量** | Finance | `finance_bank_account` 加 `short_name`、`bank_branch_code`、`legal_entity_code`、`sort_no`、`account_subtype` | 3 |
| `finance_balance_entry` | 新表 + **列增量** | Finance | 新表 `finance_account_balance_entry`；`finance_account_balance_snapshot` 加 `entry_count`、`latest_tie_count`、`distinct_amounts` | 4 |
| `altoc_contract_w1` | **列增量** + 新表 | Altoc | `altoc_contract` 加 `origin_type`、`signed_amount`、`effective_amount`、`contract_category`、`amount_basis`、`receiving_bank_account_code`、`signed_at`、`imported_batch_code`、`imported_at`，并**放宽 `tax_rate` 为可空**；新表 `altoc_contract_migration_snapshot` | 5 |
| `altoc_customer_w1` | **列增量** + 新表 | Altoc | `altoc_customer` 加 `primary_contact_id`、`contact_name_text`、`sort_no`；`altoc_contact` 加 `star_level`；新表 `altoc_customer_migration_snapshot` | 6 |
| （P1，仅设计） | — | Altoc / Finance | `altoc_billing_schedule` 的期初应收用法、`finance_receivable_adjustment` | 7 |

实现后的固定子集名（W2-schema，`hzy-enterprise-add-apf` README 为准）把上表的“新表”与“列增量”拆开：`w1-migration-ledger`、`w1-finance-legal-entity`、`finance-bank-account-columns`、`w1-finance-balance-entry`、`w1-finance-balance-columns`、`w1-altoc-contract-columns`、`w1-altoc-contract-snapshot`、`w1-altoc-customer-columns`、`w1-altoc-contact-columns`、`w1-altoc-customer-snapshot`；对象定义与本文逐字一致，安装顺序仍按 §9.2。

物理库：全部在统一库 `hzy_enterprise`。新表逻辑名与物理名相同、不进入兼容视图族，经域安装子集安装并登记映射；映射缺表时相关入口固定 503，其它功能不受影响。列增量见 §9.1。

## 1. 迁移来源台账

### 1.1 放在哪个域

放在**独立的迁移包**（建议 `data-runtime/internal/migrationledger`），不属于 Altoc、Finance 或 Console 适配器。理由：一行源数据可能落到多个域（`wb_contract` → Altoc 合同 + Finance 摘要；`wb_bank_account` → Finance 账户 + Console 保险箱）；放进任一业务域都会让该域“拥有”别的域的来源。表前缀 `mig_`，由专用迁移工具（W2 的 plan/apply/verify/rollback）写入。

### 1.2 表草案

```sql
-- 一次导入或一次封存快照。只增不改，结束后状态只能前进。
CREATE TABLE mig_batch (
  id               BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  batch_code       VARCHAR(64)  NOT NULL,              -- 例：wizbiz-20261101-01
  source_system    VARCHAR(32)  NOT NULL,              -- 'wizbiz'
  source_snapshot  VARCHAR(128) NOT NULL,              -- 封存快照标识，如 wizbiz/20261004T173356Z，附原始 SQL 的 SHA-256
  scope_json       JSON NOT NULL,                      -- 本批包含的源表与筛选
  plan_sha256      CHAR(64) NOT NULL,                  -- 受审 plan 的 hash
  status           VARCHAR(20) NOT NULL,               -- planned/applying/applied/verified/rolled_back/failed
  started_at       DATETIME(3) NULL, finished_at DATETIME(3) NULL,
  operator         VARCHAR(64) NOT NULL,               -- 执行人（真实 uid；不是服务身份）
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_mig_batch_code (batch_code)
);

-- 源行的原样保全：每个 (系统, 表, 主键, 快照) 一行，内容不可变。
CREATE TABLE mig_source_row (
  id               BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  source_system    VARCHAR(32)  NOT NULL,
  source_table     VARCHAR(64)  NOT NULL,
  source_pk        VARCHAR(128) NOT NULL,              -- 源主键的规范文本（复合主键按固定分隔拼接）
  source_snapshot  VARCHAR(128) NOT NULL,
  first_batch_id   BIGINT UNSIGNED NOT NULL,
  row_json         JSON NOT NULL,                      -- 全部源列，键为源列名；见 1.3 的脱敏规则
  row_sha256       CHAR(64) NOT NULL,                  -- 规范化 JSON 的 SHA-256
  redacted_fields  JSON NULL,                          -- 被脱敏的列名数组
  captured_at      DATETIME(3) NOT NULL,
  UNIQUE KEY uk_mig_source_row (source_system, source_table, source_pk, source_snapshot),
  KEY idx_mig_source_row_table (source_system, source_table, source_pk),
  CONSTRAINT fk_mig_source_row_batch FOREIGN KEY (first_batch_id) REFERENCES mig_batch(id)
);

-- 源对象 → 目标对象。一个源行可以映射到多个目标（多行）；也可以“有意不建目标”。
CREATE TABLE mig_object_map (
  id               BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  source_system    VARCHAR(32)  NOT NULL,
  source_table     VARCHAR(64)  NOT NULL,
  source_pk        VARCHAR(128) NOT NULL,
  target_domain    VARCHAR(32)  NOT NULL,              -- altoc/finance/console-vault/aims/none
  target_table     VARCHAR(64)  NOT NULL,              -- 'none' 时为 ''
  target_key       VARCHAR(128) NOT NULL,              -- 目标稳定键（code 优先；无 code 的表用 id 文本）
  map_role         VARCHAR(32)  NOT NULL DEFAULT 'primary', -- primary/profile/snapshot/secret/derived
  disposition      VARCHAR(20)  NOT NULL,              -- created/matched_existing/preserved_only/pending
  batch_id         BIGINT UNSIGNED NOT NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_mig_object_map (source_system, source_table, source_pk, target_domain, target_table, map_role),
  KEY idx_mig_object_map_target (target_domain, target_table, target_key),
  CONSTRAINT fk_mig_object_map_batch FOREIGN KEY (batch_id) REFERENCES mig_batch(id)
);
```

```sql
-- 批次内各阶段的进度与结果摘要：断点续行与“阶段摘要不符即停”的依据（W2 工具合同 §5.4）。
CREATE TABLE mig_batch_step (
  batch_id      BIGINT UNSIGNED NOT NULL,
  step          VARCHAR(40) NOT NULL,             -- 阶段名，见 W2 工具合同 §6.1
  status        VARCHAR(20) NOT NULL,             -- pending/running/done/failed/rolled_back
  planned_rows  INT NOT NULL, done_rows INT NOT NULL DEFAULT 0,
  result_sha256 CHAR(64) DEFAULT NULL,            -- 阶段完成时的结果摘要
  started_at DATETIME(3) NULL, finished_at DATETIME(3) NULL,
  PRIMARY KEY (batch_id, step),
  CONSTRAINT fk_mig_batch_step_batch FOREIGN KEY (batch_id) REFERENCES mig_batch(id)
);
```

`mig_identity_map` 与 `mig_exception` 见第 6 节。

### 1.3 原始行快照与 hash

- `row_json` 保存该源行的**全部列**（包括目前“无承载”的缓存统计、`ancestors`、`old_id`、`archives_id` 等），值按源类型的规范文本表示：DECIMAL 保留原始小数位的字符串；DATETIME 用 `YYYY-MM-DD HH:MM:SS`（源本地时间 Asia/Shanghai，不做时区换算）；NULL 与空字符串区分。这样“合同签署日期带时间分量的 44 条”等信息不因目标列是 DATE 而丢失。
- `row_sha256` 对“键按字典序、无多余空白”的规范化 JSON 计算。W4 的验收用它证明目标侧保存的就是封存快照里的那一行。
- **脱敏**：`wb_bank_account.account_number` 不进入 `row_json`。该列在 JSON 中写为 `{"$redacted":"vault","secretRef":"<ref>"}`，并记入 `redacted_fields`。**不保存账号的任何无盐哈希**（账号熵低，无盐 hash 可被穷举还原）；账号完整性由保险箱自身的 `content_hash` 与受控核对工具证明。`row_sha256` 对脱敏后的 JSON 计算，并在验收合同中写明。其它是否需要脱敏的列（如联系人手机）结论：它们本来就进入领域表明文列，台账不额外脱敏，但台账的访问面比领域表更窄（见 1.5）。
- 同一源行在后续快照中内容变化时新增一行（`source_snapshot` 不同），不覆盖；增量迁移据此识别差集。

### 1.4 如何不变成第二事实源

1. **业务路径不读台账。** 页面、列表、统计、授权、导出的任何查询都不得 JOIN `mig_*`。用源码级测试强制（与文档目录登记表同一手法）：`mig_` 表名只允许出现在迁移包、迁移工具和第 6 节的人工匹配入口中。
2. **领域表不回指台账。** 领域表不加指向 `mig_*` 的外键或 ID 列；“这条记录来自哪里”只从 `mig_object_map` 正向查。唯一例外是 `altoc_customer` 既有的 `source_system/external_ref`（APF 设计已预留的导入幂等键），按原定义填写 `import:wizbiz` 与源 `org_id`。
3. **台账只增不改。** `mig_source_row` 无 UPDATE 路径；`mig_object_map` 只有 `pending → created/matched_existing/preserved_only` 的前进。业务侧之后怎么修改目标对象，都不回写台账。
4. **展示“迁移快照”的数据不取自台账。** 需要在页面上展示的老缓存值（合同剩余应收、客户合同额等）另存为领域内的**类型化快照表**（第 5、6 节），有明确列定义、日期与只读语义；台账里的 JSON 只用于追溯与核对，不用于展示。
5. **保留期**：用户决定——至少保留到二期迁移完成后一年，届时再评估；归档/清理需单独批准。

### 1.5 访问权限

- 写入分两类（协调者决定，2026-10-04，修订本条原“仅迁移工具可写”的表述）：
  - **来源证据**——`mig_source_row`、`mig_object_map`、`mig_batch`、`mig_batch_step`：仅迁移工具可写，使用独立的迁移数据库账号（不是 Runtime 运行账号），plan/apply/verify/rollback 均绑定受审 `plan_sha256`。
  - **待人处理的工作状态**——`mig_exception`、`mig_identity_map`：行由迁移工具插入；此后 Runtime 可以在所属域（Altoc/Finance）的写事务内**只做 UPDATE、只改固定列**（`mig_exception`：`status`、`resolution_json`、`resolved_by`、`resolved_at`、`row_version`；`mig_identity_map`：`directory_uid`、`match_status`、`match_basis`、`directory_status`、`matched_by`、`matched_at`），与对应的业务写入同事务。Runtime 不 INSERT、不 DELETE 这两张表，也不写其余列。Registry 层 `migration` 域保持不可写，不提供通用写入；全仓对 `mig_` 表的写语句由源码级测试锁定为这两条 UPDATE。
  - **数据库权限不是这条边界的一部分**（协调者已只读核实，2026-10-04）：hzy0 与生产的 Runtime 账号对统一库都是库级 `SELECT/INSERT/UPDATE/DELETE`，本来就能写任何表。因此不新增也不依赖任何授权；“Runtime 只能改这两张表的固定列”完全由代码闭集与源码级测试 `TestMigrationLedgerWritesAreClosed` 保证。改动那两条语句或让别的文件提到 `mig_` 表，测试即失败。
- 读取：不提供通用浏览接口。W3 只需要两个受控读取：① 某个目标对象的来源（“来自 WizBiz 合同 #123，批次 X”）——在对象详情中由所属域的 Host 路由返回最小字段（源系统、源表、源主键、批次、导入时间），**不返回 `row_json`**，权限沿用该对象的 `view`；② 人工匹配队列（第 6 节）。
- 原始行 JSON 的查看限于迁移工具的 verify 报告与数据库层面的受控查询；如确需页面查看，另行设计并单独授权，不在 W1 范围。

### 1.6 回滚

按批次：仅删除本批 `disposition='created'` 且自创建后未被业务修改、未被引用的目标对象（判定：`row_version=1`、无子记录、无核销/发票/项目关联；任一不满足即停止并报告，不强删），随后把对应 `mig_object_map` 标记为回滚（通过 `mig_batch.status='rolled_back'`，映射行保留作证据）。`mig_source_row` 不删除。保险箱中的账号密文不随回滚自动删除（见 3.5）。

## 2. 业务法人主体目录

用户决定 3：建立 Enterprise 内独立的业务法人主体目录，不写 Console 企业/控制面。一个业务租户可有多个法人主体（汇智、汇房等）；部门、产品线不是法人主体。

### 2.1 表

```sql
CREATE TABLE finance_legal_entity (
  id                         BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code                       VARCHAR(64)  NOT NULL,          -- 跨域稳定键；迁移写入为 ENT-W<源主键>（LE- 已是 Altoc 线索前缀，不复用）
  name                       VARCHAR(200) NOT NULL,          -- 法定全称
  short_name                 VARCHAR(100) DEFAULT NULL,
  unified_social_credit_code VARCHAR(50)  DEFAULT NULL,
  entity_type                VARCHAR(30)  NOT NULL DEFAULT 'company', -- company/branch/other
  registered_address         VARCHAR(500) DEFAULT NULL,
  invoice_title              VARCHAR(200) DEFAULT NULL,      -- 开票抬头（缺省同 name）
  invoice_tax_no             VARCHAR(50)  DEFAULT NULL,
  status                     VARCHAR(20)  NOT NULL DEFAULT 'active', -- active/inactive
  sort_no                    INT NOT NULL DEFAULT 0,
  remark                     VARCHAR(500) DEFAULT NULL,
  row_version                INT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NULL, updated_by VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_finance_legal_entity_code (code),
  UNIQUE KEY uk_finance_legal_entity_name (name),
  KEY idx_finance_legal_entity_status (status, sort_no)
);
```

归属 Finance：开票主体与资金账户主体是财务事实，签约主体由 Altoc 按编码引用。不做停用即删除；被引用的主体只能停用。

### 2.2 关联

| 关系 | 承载 | 说明 |
| --- | --- | --- |
| 合同签约主体 | 既有 `altoc_contract_party`：`party_type='legal_entity'`（新增取值）、`party_ref_code=<LE code>`、`role_code='seller'`（销售合同）或 `'buyer'`（采购合同）、`is_primary=1` | 不新增表。`party_type` 是 VARCHAR，新增取值不改结构；`party_name_snapshot` 保存签约时名称。同库内由 Altoc 经 Finance 的 typed 入口校验编码存在且有效（ADR-018a D11，同进程同租户，不签服务令牌）。 |
| 开票主体 | `finance_invoice` 需要一个主体引用。本批不动：在第二期做发票迁移时与发票模型一并确定（届时受审加列 `legal_entity_code`）（源 `wb_invoice.company_id` 实测 100% 为 NULL，一期没有数据压力）。 | 本批只定规则：发票的开票主体**缺省取所属合同的主签约主体**，可覆盖；无合同发票必须显式选择。 |
| 资金账户主体 | `finance_bank_account.legal_entity_code`（第 3 节，受审加列） | 源 `wb_bank_account.org_id`。 |

### 2.3 来源与迁移

源 `wb_organization` 中 `org_type=0` 的 5 行，W0 已由老 OA 的公司列表查询（专取 0）确认为本公司资料。迁移时这 5 行不进入 `altoc_customer`，映射到 `finance_legal_entity`；5 行是否都是独立法人（而非分支机构等）由财务在 plan 审阅时确认 `entity_type`。W0 补充统计确认：合同 `company_id`（1,595 行）与账户 `org_id`（22 行）**全部指向这 5 行**，没有 NULL、占位或指向客户的情况；合同实际用到其中 4 个，账户用到全部 5 个。因此签约主体与账户主体共用同一份“源组织 ID → 法人主体编码”映射，一期不需要主体类的异常处理。规则保留：正式快照中若出现指向这 5 行之外的引用，plan 阻断，不自动把客户升格为法人主体。

### 2.4 授权

Finance manifest 新增资源 `legal_entities`，动作 `view/edit/admin`。读取（供合同、账户、发票选择器）要求 `finance:legal_entities:view`；Altoc 页面里选择签约主体时，由 Enterprise Host 以当前用户的该权限调用，无权时选择器明确提示，不回落为自由文本。不新增服务 capability。

## 3. 银行账户补字段与原账号保险箱存储

### 3.1 受审加列

```sql
ALTER TABLE finance_bank_account
  ADD COLUMN short_name        VARCHAR(50) DEFAULT NULL COMMENT '账户简称',
  ADD COLUMN bank_branch_code  VARCHAR(30) DEFAULT NULL COMMENT '银行行号/联行号',
  ADD COLUMN legal_entity_code VARCHAR(64) DEFAULT NULL COMMENT 'finance_legal_entity.code',
  ADD COLUMN sort_no           INT NOT NULL DEFAULT 0 COMMENT '显示顺序',
  ADD COLUMN account_subtype   VARCHAR(30) DEFAULT NULL COMMENT '银行账户子类型：basic/general/special/loan；非银行账户为 NULL',
  ADD UNIQUE KEY uk_finance_bank_account_short_name (short_name),
  ADD KEY idx_finance_bank_account_entity (legal_entity_code, sort_no);
```

- 全部可空或带默认值，对既有行与既有写路径无影响；既有读路径按显式列清单取数的地方需要在 W3 把新列加入白名单才会返回。
- `short_name` 唯一：实测源简称重复组为 0；NULL 不参与唯一。`bank_branch_code` 源 59.1% 为 NULL，保留缺失，不校验格式到拒绝导入的程度（格式校验只对新录入生效）。`legal_entity_code` 不建外键（与 `party_ref_code` 等跨表编码引用同一做法），由 Finance 写路径校验存在且有效。
- `account_sn` → `sort_no`：2026-10-05 用户批准源 NULL 映射为目标 0（默认显示顺序）；非 NULL 原值保留，源 NULL 仍完整保存在 `mig_source_row`，verify 独立复核。
- `finance_bank_account.owner_dept_code` 不承载 `org_id`（法人不是部门），保持原义。
- 账户类型（W0 字典已核定）：

  | 源 `ba_type` | 含义（行数） | `account_type` | `account_subtype` |
  | --- | --- | --- | --- |
  | 0 | 基本户（5） | `bank` | `basic` |
  | 1 | 一般户（10） | `bank` | `general` |
  | 2 | 专户（2） | `bank` | `special` |
  | 3 | 现金户（1） | `cash` | NULL |
  | 4 | 贷款户（4） | `bank` | `loan` |

  贷款户只是账户用途，不因余额正负自动生成借款或收入。现金户可以没有账号：此时不建保险箱密钥，`account_no_secret_ref` 与掩码均为 NULL，不为凑格式补号码。源 `ba_status` 实测全部为 0（正常）→ `active`；字典中 1=停用 → `inactive`（停用不等于销户，不写 `closed`）。

### 3.2 原账号保险箱存储：复用 Console credential-vault

复用，不另建。Runtime 的 Console 保险箱已具备本需求需要的三个特性：按密钥码/引用存取密文并做版本化；`usage_type='custody'` 的密钥**不能被程序化解析**（`ResolveVaultSecret` 对 custody 固定 403），只能经 `RevealVaultSecret` 揭示；每次揭示/解析写访问日志（操作者、应用、IP、UA、原因、审批码、结果）。主密钥只在客户侧 Runtime，不经 Platform。

**secret_ref 合同**

| 项 | 约定 |
| --- | --- |
| 密钥码 `secretCode` | `finance.bank-account.<bank_account_code>.account-no`（符合保险箱码格式；与账户稳定编码绑定，不含账号任何片段） |
| `secretType` | `bank_account_number`（新增类型值；仅分类用途） |
| `usageType` | `custody` —— 账号只供授权人员查看，不供程序使用。将来若有程序化用途（如银企直连）必须另建 `usage_type` 不同的密钥并单独授权，不放宽本密钥 |
| `ownerType` / `ownerKey` | `finance_bank_account` / `<bank_account_code>` |
| `revealPolicy` | 用户决定：一期为财务管理员单人权限 + 原因必填 + 双重审计，不做二人审批；`ApprovalCode` 留空，不引入新的策略取值 |
| `maskedPreview` | 与 `finance_bank_account.account_no_masked` 相同的掩码（规则：仅保留后 4 位，其余以 `*` 表示，不保留长度以外的信息） |
| 统一表保存 | `finance_bank_account.account_no_secret_ref` = 保险箱返回的 `secretRef`；`account_no_masked` = 掩码。明文不落任何业务表、台账、日志、报告或接口响应（揭示接口除外） |
| 变更账号 | `AddVaultSecretVersion` 新增版本，不覆盖；`secret_ref` 不变，掩码同步更新 |

**读取路径（不新增服务 capability）**

浏览器 → Enterprise Host（人员权限）→ Runtime Finance 固定用户操作 → **进程内 typed 调用** Console 保险箱的 `RevealVaultSecret`（ADR-018a D11：同进程同租户，不签服务令牌、不登记 grant）。Finance 适配器不直连 Console 库表，只调保险箱的公开方法；保险箱按 `ownerType/ownerKey` 复核该密钥确属所请求的账户，不接受调用方传任意 `secretCode`。Host 通道沿用 `finance:enterprise-host:execute`。

**人员权限**：Finance manifest 在 `bank_accounts` 资源下新增动作 `reveal-account-no`。它是敏感动作，**不被 `admin` 蕴含**，只授予“财务管理员”企业角色（用户决定 5）；`bank_accounts:view/edit/admin` 都只能看到掩码。

**审计**：两处都记。① 保险箱访问日志（`reveal`，含操作者 uid、应用 `finance`、请求 IP/UA、必填原因、成功/失败）；② Finance 侧业务审计一行（谁、何时、哪个账户、原因），用于财务自查，不含账号。揭示响应 `Cache-Control: no-store`，不进入任何列表/导出/搜索；前端默认不展示，点击“查看完整账号”并填写原因后显示，离开页面即清除。失败（无权、密钥不存在、保险箱不可用）分别为 403/404/503，不把 503 伪装成无权。

### 3.3 写入顺序与一致性

保险箱在 Console 库（`hzy_console`），账户在统一库，不能同事务。顺序固定为：先建保险箱密钥（幂等键 = `secretCode`）→ 取得 `secretRef` → 写账户行（含新列）。写账户行失败会留下一个未被引用的密钥：它不含可被枚举的信息、不可被程序解析，由迁移工具的 verify 阶段列出“无引用密钥”，经批准后停用（不物理删除，保留访问日志）。反向顺序（先写账户后写密钥）会出现“有账户无账号”的窗口，不采用。

### 3.4 迁移导入合同（W2 实施）

- 迁移工具读取源账号后**只在内存中**交给保险箱写入函数；不写 plan 文件、不写 `row_json`、不进任何日志或报告（报告只出现掩码与 `secretRef`）。
- 写保险箱属于“凭证写入”，须按环境单独批准；hzy0 演练使用伪造账号夹具，不使用真实账号。
- 核对：verify 阶段由具备 `reveal-account-no` 的财务管理员在页面上抽样揭示并与原 OA 对照；全量核对用保险箱 `content_hash` 与迁移工具在内存中重算的同算法 hash 比对（待确认保险箱 hash 是否带租户级盐；若不带，则只做抽样人工核对，不输出逐账号 hash）。
- 重复账号：实测源账号重复组为 0；导入时仍按“同一法人主体 + 同一账号”检测重复并停止，不合并。

### 3.5 回滚

账户行按批次回滚（未被余额、收款、合同引用时）。保险箱密钥不随回滚删除：停用并保留，避免“回滚一次就永久丢失唯一一份账号密文”的风险；再次导入同一账户时复用同一 `secretCode` 并新增版本。

## 4. 余额历史无损

### 4.1 问题

源 `wb_account_balance` 2,754 行（`operate_time` 无 NULL）。W0 补充统计（同一封存快照）：

- **127 行的 `ba_id=0`**，覆盖 57 个（账户, 日期）分组——0 不是任何存在的账户，是占位。其余 2,627 行属于 22 个真实账户，构成 2,263 个（账户, 日期）分组。
- 真实账户的 2,263 个分组中，2,241 个的当日最新登记唯一；**22 个在最新时刻上有多条并列，但并列各行金额相同**；没有一个真实账户分组的当日最新金额存在冲突。
- 全库“当日最新金额冲突”的 45 组**全部落在 `ba_id=0` 的占位分组里**。

目标 `finance_account_balance_snapshot` 的唯一键 `(bank_account_id, snapshot_date, source_type)` 表达“每账户每日每来源一个期末余额事实”，它是对的，不为迁移放宽。

### 4.2 方案：来源流水表 + 当日展示值规则

```sql
-- 余额登记流水：每一次登记一行，只增不改。属于真实账户的老 OA 登记都在这里。
CREATE TABLE finance_account_balance_entry (
  id                 BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  bank_account_id    BIGINT UNSIGNED NOT NULL,
  balance_date       DATE NOT NULL,                       -- 对账日期（源 check_date）
  balance_amount     DECIMAL(18,2) NOT NULL,
  currency_code      CHAR(3) NOT NULL DEFAULT 'CNY',
  entry_source       VARCHAR(30) NOT NULL,                -- manual/import/api（与快照 source_type 同一取值集）
  recorded_at        DATETIME(3) NOT NULL,                -- 登记时间（源 operate_time；新登记为服务器时间）
  recorded_by        VARCHAR(64) DEFAULT NULL,            -- 已确认映射的 uid；未映射为 NULL
  recorded_by_name   VARCHAR(100) DEFAULT NULL,           -- 历史显示名（未映射人员保留，用户决定 6）
  note               VARCHAR(500) DEFAULT NULL,
  entry_ref          BIGINT UNSIGNED NOT NULL,            -- 同账户同日内的稳定标识（导入：源 ab_id；新登记：自增）。只是身份，不参与取值排序
  is_day_latest      TINYINT(1) NOT NULL DEFAULT 0,       -- 是否为当日展示值的来源行；并列时多行同时为 1
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_finance_balance_entry_ref (bank_account_id, balance_date, entry_source, entry_ref),
  KEY idx_finance_balance_entry_account_date (bank_account_id, balance_date, recorded_at),
  KEY idx_finance_balance_entry_latest (bank_account_id, balance_date, is_day_latest),
  CONSTRAINT fk_finance_balance_entry_account FOREIGN KEY (bank_account_id) REFERENCES finance_bank_account(id)
);

-- 快照行记录当日登记情况（受审加列）。来源行通过流水表的 is_day_latest 取得，可以是多行。
ALTER TABLE finance_account_balance_snapshot
  ADD COLUMN entry_count      INT DEFAULT NULL COMMENT '当日同来源登记条数；本设计之前的既有快照为 NULL',
  ADD COLUMN latest_tie_count INT DEFAULT NULL COMMENT '在最新登记时刻上并列的条数（1 = 唯一）',
  ADD COLUMN distinct_amounts INT DEFAULT NULL COMMENT '当日不同金额的个数（>1 表示当日改过数）';
```

**当日展示值规则（`latest_recorded`）**：同账户、同日、同来源的登记中，取 `recorded_at` 最晚的登记的金额。与老 OA 自己的取数一致（按 `check_date`、`operate_time` 排序）。**不引入源 ID 作为隐式决胜键**（W0 的要求：源系统没有这个语义，加了就是我们替业务做了选择）：

- 最新时刻只有一条：该行 `is_day_latest=1`，`latest_tie_count=1`。
- 最新时刻多条并列且**金额相同**：金额是确定的，不需要选一条——并列各行全部 `is_day_latest=1`，`latest_tie_count` 记并列条数。封存快照中有 22 组。
- 最新时刻多条并列且**金额不同**：金额无法确定，**不生成快照**，进入异常队列（`kind='balance_latest_conflict'`），由财务指定取值后以一条人工登记落账。封存快照中真实账户没有这种情况；规则保留是为了正式快照与今后的导入。

**与现唯一键的关系**：`finance_account_balance_snapshot` 的唯一键**不变**（只加上面三列）。迁移时先写真实账户的 2,627 行流水，再按规则为每个（账户, 日期）生成一行快照，`source_type='import'`（不使用旧工具的 `migration`，与页面枚举 `manual/import/api` 一致）。按封存快照，预期生成 **2,263 行快照**（2,241 行唯一来源 + 22 行同额并列），0 个冲突；正式迁移时以届时快照重算，数字不符即 plan 阻断复核。

**`ba_id=0` 的 127 行**：不是任何账户的余额，**不建“账户 0”、不进流水、不生成快照**。只在来源台账保全，并按（日期）分组进入异常队列（`kind='balance_without_account'`，57 组；其中 45 组当日最新金额互相冲突，这一事实写入条目）。财务可在队列里把某一组认领到真实账户（之后按正常登记落账）或标记为“接受现状”（保持只在台账）。

**今后的手工登记**同样先写流水、再按同一规则维护当日快照与 `is_day_latest`。这样“改错一个数”不再覆盖历史，页面可以展开某日的全部登记。该行为调整属于 W3 页面与写路径的工作；W1 只定表与规则。

**账户缓存余额**（W0 已核）：源 `wb_bank_account.balance/check_date` 是另一份缓存。22 个账户中 21 个有历史登记，其缓存与按规则取的最近一条**全部相等**（每账户全历史的最终一条没有并列），因此缓存不带来额外信息，不进入流水、不生成快照，只保存在 `mig_source_row`。**1 个账户没有任何历史登记**：若其缓存 `balance` 与 `check_date` 均非 NULL，则据此生成一条流水（`entry_source='import'`、`note='源账户缓存值，无历史登记'`、`recorded_at` 取账户 `operate_time`）并生成当日快照，否则不生成、页面显示“无余额记录”；该账户在迁移 plan 中单列，由财务确认。目标侧“当前余额”一律从最近快照派生，不再保存第二份缓存。

### 4.3 授权、迁移与回滚

- 授权：流水表沿用 `finance:bank_accounts:view`（读）与 `edit`（登记）；不新增动作。余额金额对无权用户不返回，汇总数量同样不返回。
- 迁移：流水按 (账户, 日期, entry_ref=ab_id) 幂等；快照按唯一键幂等。验收：流水行数 = 真实账户的源行数（封存快照为 2,627），`ba_id=0` 的行数 = 台账中 `preserved_only` 的余额行数（127），两者之和 = 源行数（2,754）；每个源 `ab_id` 在 `mig_object_map` 中有且仅有一个去向；每个（账户, 日期）的展示值等于按规则重算的结果；真实账户的金额合计在流水层与源完全相等。
- 回滚：先删本批生成的快照行，再删流水行；若其间已有新的手工登记落在同账户同日，停止并报告（不删人工数据）。

## 5. 历史合同导入 lane

用户决定 4：受审“历史导入”通道，保留原状态与金额，不触发签署/生效副作用，不伪造 Workflow 记录。

### 5.1 为什么需要专门通道

正常合同的金额由合同行合计维护（`amount_tax_inclusive` 由 `recalculateContractLineTotalsTx` 写），状态经审批、签署、生效推进，生效会触发交付激活与 Finance 摘要同步。历史合同没有合同行、没有审批记录，1,595 行中 1,574 行是“正常”（履行中）——如果走正常通道，要么伪造合同行和审批，要么全部停在草稿。

### 5.2 受审加列与快照表

```sql
ALTER TABLE altoc_contract
  ADD COLUMN origin_type                 VARCHAR(30) NOT NULL DEFAULT 'native' COMMENT 'native/historical_import',
  ADD COLUMN signed_amount               DECIMAL(18,2) DEFAULT NULL COMMENT '原始签约总额',
  ADD COLUMN effective_amount            DECIMAL(18,2) DEFAULT NULL COMMENT '有效合同额：合同总额去掉第三方等非本公司收入部分；历史值为原系统人工录入',
  ADD COLUMN contract_category           VARCHAR(40) DEFAULT NULL COMMENT '合同业务类别（签约时的经营分类，独立于由合同行推导的 primary_type）',
  ADD COLUMN amount_basis                VARCHAR(30) NOT NULL DEFAULT 'lines' COMMENT 'lines/header：当前合同额取自合同行还是直接录入',
  ADD COLUMN receiving_bank_account_code VARCHAR(50) DEFAULT NULL COMMENT '约定收款账户（finance_bank_account.code）',
  ADD COLUMN signed_at                   DATETIME(3) DEFAULT NULL COMMENT '带时间的签订时刻（sign_date 是 DATE）',
  ADD COLUMN imported_batch_code         VARCHAR(64) DEFAULT NULL COMMENT '仅 historical_import 有值',
  ADD COLUMN imported_at                 DATETIME(3) DEFAULT NULL,
  ADD KEY idx_altoc_contract_origin (origin_type),
  ADD CONSTRAINT ck_altoc_contract_origin CHECK (
    (origin_type = 'native' AND imported_batch_code IS NULL)
    OR (origin_type = 'historical_import' AND imported_batch_code IS NOT NULL AND amount_basis = 'header'));

-- 受审放宽可空：历史合同没有税率来源，写 NULL，而不是带着默认的 6.00。
ALTER TABLE altoc_contract MODIFY COLUMN tax_rate DECIMAL(5,2) DEFAULT 6.00 NULL;

-- 老系统余额缓存的带日期快照：只读展示，不参与任何计算。独立生命周期，保持为单独的表。
CREATE TABLE altoc_contract_migration_snapshot (
  contract_id                  BIGINT UNSIGNED PRIMARY KEY,
  snapshot_at                  DATETIME(3) NOT NULL,        -- 封存快照时刻
  remaining_uninvoiced_amount  DECIMAL(18,2) DEFAULT NULL,  -- 源 invoice_amount：剩余未开票额
  remaining_settlement_amount  DECIMAL(18,2) DEFAULT NULL,  -- 源 exec_amount：剩余应收（销售）/应付（采购）
  settlement_direction         VARCHAR(20) NOT NULL,        -- receivable/payable（由合同方向决定）
  source_note                  VARCHAR(200) DEFAULT NULL,   -- 例：'WizBiz 缓存值，可能与明细不一致'
  batch_code                   VARCHAR(64) NOT NULL,
  CONSTRAINT fk_altoc_contract_migration_snapshot FOREIGN KEY (contract_id) REFERENCES altoc_contract(id)
);
```

- `imported_batch_code` 是文本，不是指向 `mig_batch` 的外键（原则 1.4-2）。
- `tax_rate` 放宽可空属于“修改既有列”，比加列多一个要求：既有写路径对新合同仍须写入税率（默认值保留为 6.00），只有 `amount_basis='header'` 的历史合同允许 NULL；读取 `tax_rate` 做计算的代码需逐处确认对 NULL 的处理（W2 前核实项）。
- `receiving_bank_account_code` 不建外键，由写路径经 Finance typed 入口校验。

### 5.3 三种金额口径

（“有效金额”自 r5 起统一称“有效合同额”。）

| 口径 | 承载 | 定义与来源 |
| --- | --- | --- |
| 原始签约总额 | `altoc_contract.signed_amount` | 签约时的合同总额。历史合同取源 `total_amount`。新合同在签署生效时由系统记录当时的合同行合计，此后不随变更改动。 |
| 有效合同额 | `altoc_contract.effective_amount` | **用户定义（2026-10-04）：合同总额去掉第三方等非本公司收入部分（外采、转包、代收代付等）后的金额。** 历史值取源 `prime_amount` **原样迁入，来源标注为“人工录入（原系统）”**；W0 核定它在老系统里是独立录入的认定额，不由总额按公式推导（1,595 行中 1,444 行等于总额、15 行小于、6 行大于、130 行 NULL；不是除税额）。**NULL 保持 NULL**，不以总额或 0 代替。其中 6 行“有效额大于总额”与定义不符，原样保全并进入异常队列（`kind='effective_amount_exceeds_total'`）由业务说明，不擅自改数。新合同的有效额今后由合同金额事实派生而不是人工填数，见 §7A；在 §7A 实现之前新合同不写该列。 |
| 当前合同额 | `altoc_contract.amount_tax_inclusive` | 既有定义：当前生效的合同金额。`amount_basis='lines'` 时为合同行合计（现状不变）；`amount_basis='header'` 时由导入通道直接写入、等于 `signed_amount`，并且**行合计重算必须跳过** `header` 合同（否则无行合同会被重算成 0 或 NULL）。今后补充协议/变更（P1）改变的是当前合同额，签约总额不变。 |

- 币种：W0 确认源库**没有任何币种字段或字典**，源码也没有强制人民币的写入规则；目标各表 `currency_code` 是 NOT NULL DEFAULT 'CNY'，这个默认值不能反证源数据都是人民币。处理：迁移 plan 必须带一个由用户确认的“本快照统一币种”声明（记录在 `mig_batch.scope_json` 并进入 `plan_sha256`）；没有声明 plan 阻断，不靠列默认值落库。**用户已确认全部历史金额按 CNY**（2026-10-04）；声明中记录确认人与日期。金额原值不做任何换算。
- `amount_tax_exclusive`、`tax_rate` 对历史合同没有来源：两列均为 NULL（`tax_rate` 经 5.2 的受审放宽）；页面对 `amount_basis='header'` 的合同显示“—”，不显示默认税率。
- 主子合同：父子不求和。W0 在封存快照上确认：**全部 1,595 个合同都是根记录，当前没有任何父子合同数据**，也没有环。因此一期 `is_master_contract` 一律导入为 0、`parent_contract_id` 为 NULL，不需要判定规则；父链回填逻辑仍按 5.5 实现（正式迁移前会重新取快照，届时若出现父子数据，plan 阻断并补规则）。

### 5.4 状态与副作用

| 源 `contract_status` | `status` | `legal_status` | `fulfillment_status` | `financial_status` | `activation_status` |
| --- | --- | --- | --- | --- | --- |
| 0 正常（1,574） | `effective` | `effective` | `in_progress` | `unplanned` | `not_planned` |
| 1 完结（1） | `completed` | `closed` | `fulfilled` | `unplanned` | `not_planned` |
| 2 中止（20） | `terminated` | `terminated` | `cancelled` | `unplanned` | `not_planned` |

- 原状态值原样保存在台账；上表是目标侧的正交状态。W0 提醒“正常”不足以证明新的法律/履约/激活各轴都已完成：`fulfillment_status='in_progress'`、`activation_status='not_planned'` 表达的正是“在履行、未经新流程激活”，页面对历史合同把履约与激活状态标注为“历史导入，未跟踪”，不展示为系统已核实的事实。`financial_status` 一律 `unplanned`：历史合同在一期没有结算计划事实，不能写成“已收款/开票中”；它的资金情况由 5.2 的快照展示，P1 由期初应收承接（第 7 节）。`completed_at/terminated_at` 没有来源，保持 NULL，不用 `operate_time` 冒充。
- **不写**：`workflow_instance_id`、`approved_at/approved_by`、任何审批/签署/生效事件、`integration_operation` 出站行、Finance 摘要同步、Aims 项目创建或激活。`source_type='historical_import'`、`source_code=<源合同号>`。
- 合同类型（W0 字典已核定；旧 DDL 注释把 5 当作维保是错的）：

  | 源 `contract_type` | 含义（行数） | `direction` | `primary_type` | `contract_category` |
  | --- | --- | --- | --- | --- |
  | 0 | 采购（0） | `purchase` | `standard` | `purchase` |
  | 1 | 软件产品销售（453） | `sales` | `software` | `software_sales` |
  | 2 | 软件开发服务（185） | `sales` | `implementation` | `software_development` |
  | 3 | 技术与数据服务（28） | `sales` | `service` | `tech_data_service` |
  | 4 | 系统维护服务（860） | `sales` | `maintenance` | `system_maintenance` |
  | 5 | SaaS 销售（2） | `sales` | `standard` | `saas` |
  | 6 | 平台运营服务（16） | `sales` | `service` | `platform_operation` |
  | 8 | 硬件与系统集成（47） | `sales` | `standard` | `hardware_integration` |
  | 9 | 其他（4） | `sales` | `standard` | `other` |

  `primary_type` 对新合同由合同行推导；历史合同没有合同行，按上表写入最接近的既有取值，5/8/9 不为它们新造 `primary_type` 枚举，写 `standard`。原经营分类完整落在新增的 `contract_category` 上——它是签约时的业务分类，对新合同同样有意义（今后可在创建时选择），不是迁移专用列。表外的值使 plan 阻断，不落兜底值。
- **历史合同的后续操作边界**（Runtime 在状态机入口按 `origin_type` 判断）：允许查看、补充联系人/备注、关联项目、完结、中止、登记补充协议（P1）；**不允许**“提交审批”“签署”“生效”“激活交付”——它们对一个已经在履行的合同没有意义，且会触发副作用。需要重新走完整流程的，新建合同并以父子或续签关系关联。
- 导入通道本身是迁移工具（数据库迁移账号 + 受审 plan），不是一个用户可调用的 API；因此不存在“普通用户伪造历史合同”的入口。若将来要提供页面上的“补录历史合同”，需另行设计授权（建议 `contract:import-historical`，不被 `admin` 蕴含）。

### 5.5 父子树与关联

- 两遍导入：第一遍建全部合同（`parent_contract_id=NULL`），第二遍按 `mig_object_map` 回填父链；回填前做全量环检测（实测自指为 0，多层环未查，W0 补），发现环则整批停止。
- 客户、联系人、第三方：按映射回填；`contact_id` 的 29 条孤儿引用置 NULL 并记异常，不建占位联系人。另有16条联系人不属于合同客户：合同照常迁移、关联置 NULL，源 contactman_id 保留台账，进入 `contract_contact_mismatch` 人工事项，不跨客户挂接。
- 项目：`project_id`/`impl_project_id` → `altoc_contract_project_link`（`project_role` 区分销售/实施），项目映射到 Aims 的规则属于项目迁移（第二期），一期只在台账保全并对已存在映射的项目建链。
- 签约主体：`company_id` → `altoc_contract_party`（第 2 节）。
- 收款账户：`ba_id`（仅 9 行非空）→ `receiving_bank_account_code`。
- `system_id`、`old_id`、`archives_id`：一期只在台账保全（维保系统与档案属于第二期）；不为它们加领域列。

### 5.6 授权、迁移与回滚

- 授权：新列与快照随合同 `view` 返回；`receiving_bank_account_code` 只返回账户编码与简称，不涉及账号。无新增动作。
- 回滚：按批次删除快照、party/link 行与合同行；合同一旦被结算计划、发票、收款、项目或工单引用，或 `row_version>1`，即不可回滚，报告后人工处置。

## 6. 客户层级、联系人、主联系人与人员匹配队列

### 6.1 组织分类与层级

| 源 `org_type` | 目标 |
| --- | --- |
| 1 客户（757） | `altoc_customer`。等级：源 `level` 全部 762 行都是 6（列默认值），源系统没有等级字典，也没有 `customer_level_id` —— 这个“6”没有可核定的业务含义。**`customer_level_id` 一律置 NULL**，不写 6、不默认某个等级；源值在台账保全。业务确认等级字典后，由销售管理员在页面上维护或另做一次受审批量映射 |
| 2 代理商 / 3 供应商（封存快照各 0 行） | 2 → `altoc_customer` 且 `is_partner=1`；3 → 一期没有供应商主档模型，出现时 plan 阻断并另定（不冒充客户）。不因“目前没有”而省略规则 |
| 0（5） | 本公司资料（W0 经公司列表 SQL 确认）→ `finance_legal_entity`（第 2 节），不进客户表 |

- 层级：两遍导入回填 `parent_customer_id`；全量环检测；`ancestors` 实测 100% NULL，不恢复、仅台账保全，目标祖链由父链派生。W0：组织无环、无缺父，最长链 3 层。状态 `org_status` 0（754）→`active`、1（8，源语义为“删除”）→`archived`（已删除的组织也导入并标为归档，不丢）。
- 客户名称唯一性：实测重复组为 0；目标 `normalized_name` 按现有规则生成，冲突时停止并列出，不自动合并。

### 联系人星级迁移口径（2026-10-05 裁定）

| 源 `wb_contactman.stars` | 目标 `altoc_contact.star_level` | 保全与验证 |
| --- | --- | --- |
| 0（未评级） | NULL（未评级） | `mig_source_row.row_json` 保留原始字符串 `"0"`，不可改为源 NULL；独立 verify 重建映射并核对目标 NULL |
| NULL | NULL | 源 NULL 保持 NULL，与源 0 的台账摘要不同 |
| 1..6 | 原值 | verify 逐行检查原值一致 |
| 其它值 | 阻断 | 不自动修正、不删除、不放宽目标枚举；停机前审计汇总字段与类别计数 |

此规则不改变目标星级枚举或 DDL；只变更旧 OA 未评级值的迁移映射。无客户联系人仍按既有合同只进台账与异常队列，原 stars 值完整保留。

### 6.2 受审加列与快照表

```sql
ALTER TABLE altoc_customer
  ADD COLUMN primary_contact_id BIGINT UNSIGNED DEFAULT NULL COMMENT '主联系人',
  ADD COLUMN contact_name_text  VARCHAR(50) DEFAULT NULL COMMENT '自由文本联系人（与正式联系人并存，不合并）',
  ADD COLUMN sort_no            INT NOT NULL DEFAULT 0 COMMENT '显示顺序',
  ADD CONSTRAINT fk_altoc_customer_primary_contact FOREIGN KEY (primary_contact_id) REFERENCES altoc_contact(id);

ALTER TABLE altoc_contact
  ADD COLUMN star_level TINYINT DEFAULT NULL COMMENT '联系人星级 1..6（对应 2~5 星半档）；源字典：1=2 星 … 6=5 星';

-- 老系统客户级缓存统计的带日期快照：只读展示。独立生命周期，保持为单独的表。
CREATE TABLE altoc_customer_migration_snapshot (
  customer_id                 BIGINT UNSIGNED PRIMARY KEY,
  snapshot_at                 DATETIME(3) NOT NULL,
  contract_count_subtree      INT DEFAULT NULL,  contract_amount_subtree     DECIMAL(18,2) DEFAULT NULL, -- count_all / sum_all（含下属）
  contract_count_direct       INT DEFAULT NULL,  contract_amount_direct      DECIMAL(18,2) DEFAULT NULL, -- count_total / sum_total
  contract_count_3y           INT DEFAULT NULL,  contract_amount_3y          DECIMAL(18,2) DEFAULT NULL,
  contract_count_1y           INT DEFAULT NULL,  contract_amount_1y          DECIMAL(18,2) DEFAULT NULL,
  contract_count_ytd          INT DEFAULT NULL,  contract_amount_ytd         DECIMAL(18,2) DEFAULT NULL,
  receivable_contract_count   INT DEFAULT NULL,                                                          -- count_recerivable（31% NULL，保持 NULL）
  receivable_amount_subtree   DECIMAL(18,2) DEFAULT NULL,                                                -- sum_all_receivable
  receivable_amount_direct    DECIMAL(18,2) DEFAULT NULL,                                                -- sum_receivable
  source_note                 VARCHAR(300) DEFAULT NULL,
  batch_code                  VARCHAR(64) NOT NULL,
  CONSTRAINT fk_altoc_customer_migration_snapshot FOREIGN KEY (customer_id) REFERENCES altoc_customer(id)
);
```

客户与联系人之间由此出现双向外键（联系人 → 客户既有；客户 → 主联系人新增）：删除联系人前须先清空指向它的主联系人引用，写路径与回滚都按“先清引用、后删联系人”执行。

- 主联系人：`primary_contact_id` 必须是该客户自己的联系人（Runtime 写入时校验；迁移时源主联系人不属于该客户的进入异常队列）。8 行缺主联系人保持 NULL。既有 `altoc_contact.is_key_contact` 是“关键联系人”标记（源 `chief`），与“主联系人”是两件事，分别保留。
- 客户缓存统计：差距分析 §3.2 已证明同一缓存列可能由两套算法写入（详情更新与定时任务）。快照表的列名按“本客户/含下属”“近三年/近一年/当年”如实命名，`source_note` 写明“原系统缓存，口径不保证一致”；新页面的统计从合同事实派生，两者并排展示时标注日期。
- **未绑定客户的联系人（721 行，45.2%）**（协调者决定）：一期在台账保全，并进入“待归属联系人”队列（`mig_exception.kind='contact_without_customer'`）。销售管理员可在队列里按姓名、手机、原业务员检索，为联系人指派客户后才生成 `altoc_contact`（走正常的联系人创建写路径，带审计）；未归属的长期留在台账。**不建占位客户**，`altoc_contact.customer_id` 保持 NOT NULL。该队列属于一期页面范围（W3）。队列检索需要显示联系人姓名与电话，这些字段取自 `mig_source_row.row_json`——是 1.4 之外的第二处受控台账读取，仅限持 `altoc:migration_exceptions:view` 的用户、仅限这一类异常、服务端按白名单字段返回，不提供整行 JSON。
- 联系人/组织历史表（`wb_contactman_info`、`wb_organization_info`）实测 0 行：一期不建对应的领域历史表，台账按表结构准备好接收（若封存快照时出现数据则原样保全）。今后的变更历史由领域自己的审计承担，不复刻老表。
- `archives_id`：仅台账保全（第二期与档案/附件一并处理）。

### 6.3 人员映射与人工匹配队列

```sql
-- 源系统人员 → Directory uid。一人一行；从不默认到管理员。
CREATE TABLE mig_identity_map (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  source_system     VARCHAR(32) NOT NULL,
  source_user_id    VARCHAR(64) NOT NULL,
  display_name      VARCHAR(100) NOT NULL,              -- 历史显示名（取自封存快照中的源用户表）
  source_status     VARCHAR(20) DEFAULT NULL,           -- 源系统中的在职/停用状态
  directory_uid     VARCHAR(64) DEFAULT NULL,
  match_status      VARCHAR(20) NOT NULL,               -- candidate/confirmed/rejected/unmatched/source_missing
  match_basis       VARCHAR(50) DEFAULT NULL,           -- name_unique / operator_via_employee / manual
  directory_status  VARCHAR(20) DEFAULT NULL,           -- 确认时目标用户的 Directory 状态快照
  matched_by        VARCHAR(64) DEFAULT NULL, matched_at DATETIME(3) DEFAULT NULL,
  UNIQUE KEY uk_mig_identity (source_system, source_user_id),
  KEY idx_mig_identity_status (match_status)
);

-- 异常与人工处理队列：迁移中任何“不能自动决定”的事项。
CREATE TABLE mig_exception (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  batch_id          BIGINT UNSIGNED NOT NULL,
  owning_domain     VARCHAR(32) NOT NULL,               -- altoc/finance：决定谁有权处理
  kind              VARCHAR(50) NOT NULL,               -- owner_unmatched/contact_without_customer/contact_orphan/unknown_enum/balance_without_account/balance_latest_conflict/
                                                        -- contract_balance_mismatch/effective_amount_exceeds_total/
                                                        -- entity_unresolved/currency_unknown/primary_contact_mismatch/...
  source_table      VARCHAR(64) NOT NULL, source_pk VARCHAR(128) NOT NULL,
  target_table      VARCHAR(64) DEFAULT NULL, target_key VARCHAR(128) DEFAULT NULL,
  detail_json       JSON NOT NULL,                      -- 结构化上下文；不含敏感字段
  status            VARCHAR(20) NOT NULL DEFAULT 'open',-- open/resolved/accepted（接受现状）/superseded
  resolution_json   JSON DEFAULT NULL,
  resolved_by       VARCHAR(64) DEFAULT NULL, resolved_at DATETIME(3) DEFAULT NULL,
  row_version       INT UNSIGNED NOT NULL DEFAULT 1,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_mig_exception (batch_id, kind, source_table, source_pk),
  KEY idx_mig_exception_queue (owning_domain, status, kind, id),
  CONSTRAINT fk_mig_exception_batch FOREIGN KEY (batch_id) REFERENCES mig_batch(id)
);
```

**人员映射的现实（W0）**：138 名源员工中只有 90 名有“姓名唯一”的候选（65.22%），**没有任何一条**是姓名与工号双重命中的可靠映射（135 人原工号为空或 0）；90 个候选里目标账号 72 个在职、18 个非在职。因此：

- 没有“自动匹配”。迁移工具只把 W0 的候选写成 `match_status='candidate'`；**只有 `confirmed` 的映射才会被用来写 `owner_uid` 或任何 uid 列**，候选不算。确认是一次性的人工审阅，确认人为用户本人或人事负责人（用户决定）；核对表只留在 OA 主机，确认结果以“源人员 ID → uid、确认人、时间”的最小形式进入 `mig_identity_map`，不带回姓名以外的个人信息。逐条 `candidate → confirmed/rejected`。
- 目标账号非在职的 `confirmed` 映射只用于历史记录的操作人/显示名；在办对象的负责人不能指向非在职账号，这类对象照样进入 `owner_unmatched` 队列。
- 业务表里引用了、但源人员表里不存在的 ID（W0：14 个员工 ID、2 个操作账号 ID）记为 `source_missing`，显示为“未知（源 ID 已保全）”，不猜测。
- W0 的 Directory 对照用的是原 wiztek Console；正式迁入前须对目标环境重新核对这些 uid 仍存在且状态未变，不一致的映射退回 `candidate`。

**未映射负责人的承载**（用户决定 6；协调者倾向采用，只读代码核查结果见 §8.3）。`altoc_customer.owner_uid`、`altoc_contract.owner_uid` 是 NOT NULL，且是对象关系授权的依据。方案：

- 未映射时写入保留值 `system:unassigned`，`owner_dept_code` 写 NULL。`system:` 前缀在平台内已被当作非人员主体拒绝，任何人都无法以它登录或成为它；因此“负责人关系”对所有真实用户都不成立，这些对象不会落到某个管理员名下。
- 可见范围（核查确认）：Altoc 的范围判定只有三种形态——`self`（`owner_uid = 当前用户`）、`dept/self_dept`（`owner_dept_code IN 授权部门`）、`all`。保留值 + 空部门的对象只对 `all` 范围的角色可见、可改派；`self` 与部门范围的用户看不到。这正是“不默认转给管理员、由有全局范围的人处理”的效果，无需改范围判定代码。
- 历史显示名不写进主表：页面在 `owner_uid='system:unassigned'` 时显示“待匹配（原负责人：<显示名>）”，显示名由所属域的详情接口经 `mig_object_map` → `mig_identity_map` 取得（1.4 允许的受控台账读取之一，仅限详情中的这一行说明）。
- 进队列的条件：对象处于在办状态（客户 `active`；合同 `effective`）且负责人未映射 → `mig_exception(kind='owner_unmatched')`。已完结/归档对象只保留显示名，不进队列。
- 处理：有权用户在匹配页面为“源人员”指定 Directory 用户（一次匹配，批量应用到该源人员名下的全部对象），或逐个对象改派负责人。应用时走所属域的正常“变更负责人”写路径（带审计），不直接改库。
- 内置目录用户（协调者决定）：把 `system:unassigned` 登记为 Foundation 内置目录用户，显示名“未分配”，批量查姓名时在 Foundation 侧分出、不送 Console。约束并各有测试：它不能登录、不能成为任何授权主体、不出现在人员选择器与指派候选中；只有迁移通道能把它写入 `owner_uid`。
- 必须同时落实的三条（来自核查）：① 用户写路径（创建、改派负责人）拒绝 `system:` 前缀的 `owner_uid`——现状只做长度校验，不拦会让普通用户把对象“改派”给保留值；② 在保留值客户下新建合同会被范围校验挡住（创建合同要求对客户有范围），只有 `all` 范围的角色能做，这是预期行为，页面需给出“请先匹配负责人”的提示而不是笼统的 403；③ 前端按 uid 取姓名的地方把保留值显示为“待匹配”，不显示原始字符串。

**队列授权**：两个域各自新增资源——Altoc manifest `migration_exceptions`（`view`、`resolve`），Finance manifest `migration_exceptions`（`view`、`resolve`）。队列按 `owning_domain` 分域读取；条目只显示处理所需的最小字段；`resolve` 之后的实际业务写入仍要求对应对象的 `edit`（两者同时成立），队列权限本身不赋予修改任何客户/合同的能力。不新增服务 capability。

## 7. P1 前瞻：应收项、账龄、收款多应收分配（本批只设计，不实现）

### 7.1 现有模型已经具备的部分

对照目标结构，三件事的骨架已经存在，不需要另起一套：

| 需求 | 现有承载 | 结论 |
| --- | --- | --- |
| 应收项：到期日、原额、已核销、余额 | `altoc_billing_schedule`（`direction='receivable'`）：`due_date`、`amount`、`received_amount`、生成列 `unreceived_amount`、`currency_code`、`status`、`is_overdue/overdue_days` | **应收项 = 结算计划行**。不新建平行的“应收表”，否则会出现两个余额。 |
| 一笔收款分配到多个应收 | `finance_reconciliation`：一行 = 一笔到账 → 一个目标 → 一个金额，`target_type` 含 `billing_schedule/invoice/contract/advance/unclassified`，带幂等键与原地冲销 | **已支持多应收分配**。`finance_receipt.billing_schedule_code` 只是登记时的预期，最终归属以核销行为准（表注释已如此定义）。 |
| 已核销回写 | 核销事务在同库共享事务内回写 `altoc_billing_schedule.received_amount` 与 `finance_receipt.reconciled_amount` | 保持单一事实：余额只由核销行汇总而来。 |

### 7.2 缺口与设计

1. **账龄是派生，不落库。** 账龄 = 以查询日期（as-of）对未结应收按 `due_date` 分桶：未到期、1–30、31–60、61–90、91–180、180 以上、**无到期日**。输入是 `altoc_billing_schedule` 中 `direction='receivable'`、`status` 不为 `cancelled/bad_debt`、`unreceived_amount>0` 的行。`is_overdue/overdue_days` 是扫描任务维护的提示列，账龄报表不依赖它（as-of 可以是历史日期）。历史 as-of（“上月底的账龄”）需要按核销时间回放：`finance_reconciliation.reconciled_at/reversed_at` 已有，足以重建某一时点的已收金额，不需要每日存账龄快照。
   - 不能用合同 `end_date`（合同到期）当款项到期，也不能因为已开票就认定到期（差距分析 B.1）。
2. **历史合同的期初应收。** 一期历史合同没有结算计划，收款/发票明细在第二期才迁入事实表，因此它们的应收无法“从事实派生”。主流做法是迁移**期初未结项**：为每个有剩余应收的历史合同生成一行结算计划，`plan_type='opening_balance'`（新增取值）、`source_type='historical_import'`、`trigger_type='manual'`、`amount = 源 exec_amount（剩余应收）`、`received_amount=0`、`due_date` 取可得的款项到期信息否则 NULL（落入“无到期日”桶，由财务补录）。此后的收款正常核销到这一行。
   - 这是把“迁移快照”转成“可操作事实”的唯一一步，必须由财务对账确认后才执行，不能在主档迁移时自动生成。W0 的逐合同对账结果：1,595 个合同中 **1,575 个的缓存与明细重算完全相等**，**20 个不相等**（同一组 20 个合同在执行余额与开票余额上都不符，全部为“正常”状态，差额均大于 1,000，没有尾差）。**用户决定的规则**：一致的 1,575 个直接取重算值；不一致的 20 个按源缓存值生成期初项，同时写异常队列条目（`kind='contract_balance_mismatch'`，带缓存值、重算值与差额），W4 演练中由财务逐份确认——确认结果与缓存不同的，以一条调整（§7.2-3）或更正期初项的方式落账并留痕，不静默改数。剩余应收为 0 的合同不生成期初项。
   - 采购合同的剩余应付同理（`direction='payable'`），是否纳入 P1 待定。
   - `uk_altoc_billing_schedule_term_period (payment_term_id, recurrence_period, obligation_id)` 对三者皆 NULL 的行不构成冲突（MySQL 唯一键中 NULL 不相等），每合同一行期初项由 `code` 与“每合同至多一行 opening_balance”的写入校验保证。
3. **非合同应收与调整。** 坏账核销、折让、尾差等不是收款，却要减少应收余额。现模型只有 `status='bad_debt'`（整行）。建议 P1 新增：

   ```sql
   CREATE TABLE finance_receivable_adjustment (
     id                     BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
     code                   VARCHAR(64) NOT NULL,
     billing_schedule_code  VARCHAR(64) NOT NULL,
     adjustment_type        VARCHAR(30) NOT NULL,   -- write_off/discount/rounding/reclass
     amount                 DECIMAL(18,2) NOT NULL, -- 正数表示减少应收
     currency_code          CHAR(3) NOT NULL DEFAULT 'CNY',
     reason                 VARCHAR(500) NOT NULL,
     status                 VARCHAR(20) NOT NULL DEFAULT 'active', -- active/reversed
     approved_by VARCHAR(64) NOT NULL, approved_at DATETIME(3) NOT NULL,
     idempotency_key        VARCHAR(191) NOT NULL,
     created_by VARCHAR(64) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
     UNIQUE KEY uk_finance_receivable_adjustment_code (code),
     UNIQUE KEY uk_finance_receivable_adjustment_idem (idempotency_key),
     KEY idx_finance_receivable_adjustment_schedule (billing_schedule_code, status)
   );
   ```

   引入后，“未结余额” = `amount − received_amount − 有效调整合计`。`unreceived_amount` 是 `amount − received_amount` 的生成列，不能直接表达调整；P1 需要决定是给结算计划加一个由共享事务维护的 `adjusted_amount` 汇总列（涉及改已安装表），还是在读取时合计。这是 P1 的设计点，本批不定。
4. **分配界面与规则（接口层）。** 收款登记后进入“待分配”；分配页面列出该客户（及其集团下属，可选）的未结应收，默认按到期日从早到晚建议分配，允许手工调整；一次提交 = 一组核销行，同一事务内校验“分配合计 ≤ 到账未分配余额、每行 ≤ 该应收未结余额”，重放按幂等键返回原结果；超出部分留作 `advance`（预收）。职责分离沿用现有规则（核销人 ≠ 到账确认人，若启用）。这些都落在既有 `finance_reconciliation` 上，不新增表。
5. **客户级汇总。** “本客户/含下属”的应收与逾期由上述明细按客户树汇总，权限不足时不返回数量与金额。

### 7.3 P1 接口草案（Host → Runtime 固定用户操作，均在既有通道内）

| 操作 | 权限 | 说明 |
| --- | --- | --- |
| 应收明细列表（服务端分页，as-of 可选） | `altoc:receivable:view` | 返回应收项与派生账龄桶；合计由服务端返回（列表有合计，须先由服务端给合计再分页） |
| 账龄汇总（按客户/负责人/法人主体） | `altoc:receivable:view` + 数据范围 | 派生查询，不落库 |
| 生成期初应收（受审） | `altoc:receivable:admin` + 财务确认；迁移工具执行 | 仅 `origin_type='historical_import'` 的合同，每合同至多一行 |
| 收款分配 / 撤销分配 | `finance:reconciliation:edit` / `confirm` | 既有核销写路径的批量形态 |
| 应收调整 / 撤销 | `finance:reconciliation:confirm`（或新增 `receivable-adjust`，待定） | 需审批人，职责分离 |

## 7A. 前瞻：合同金额事实表（本批只设计，不实现）

用户（2026-10-04）：有效合同额 = 合同总额去掉第三方等部分；后续可能实现“合同事实表”。本节给出目标形态，使 W1 的列与迁移口径今后不必返工。

### 7A.1 要解决的问题

老系统的有效额是一个人工填的数：看不出扣了什么、何时变的、依据是什么，也无法与实际外采支出核对。目标是把“合同金额由哪些成分构成、何时因何事件变化”记成事实，有效合同额、当前合同额、未税额都由事实派生。

### 7A.2 表草案

```sql
-- 合同金额构成事实：只增不改；更正用冲销行 + 新行。
CREATE TABLE altoc_contract_amount_fact (
  id               BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code             VARCHAR(64) NOT NULL,                -- CF-xxxxxx
  contract_id      BIGINT UNSIGNED NOT NULL,
  component        VARCHAR(40) NOT NULL,                -- 见 7A.3
  amount           DECIMAL(18,2) NOT NULL,              -- 成分金额，含税口径；变更事件写增量（可为负）
  currency_code    CHAR(3) NOT NULL DEFAULT 'CNY',
  counterparty_ref VARCHAR(100) DEFAULT NULL,           -- 第三方（供应商/分包方/代收对象）的稳定编码或名称快照
  effective_date   DATE NOT NULL,                       -- 该事实生效的业务日期
  event_type       VARCHAR(30) NOT NULL,                -- signing/amendment/correction/opening_import
  event_ref        VARCHAR(100) DEFAULT NULL,           -- 补充协议编码、变更单号等
  source_type      VARCHAR(30) NOT NULL,                -- contract_line/manual/historical_import
  source_ref       VARCHAR(100) DEFAULT NULL,           -- 合同行 id、导入批次等
  basis_note       VARCHAR(500) DEFAULT NULL,           -- 认定依据（manual 必填）
  reverses_fact_id BIGINT UNSIGNED DEFAULT NULL,        -- 冲销所指向的事实行
  status           VARCHAR(20) NOT NULL DEFAULT 'active', -- active/reversed
  idempotency_key  VARCHAR(191) NOT NULL,
  created_by VARCHAR(64) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_altoc_contract_amount_fact_code (code),
  UNIQUE KEY uk_altoc_contract_amount_fact_idem (idempotency_key),
  KEY idx_altoc_contract_amount_fact_contract (contract_id, effective_date, id),
  KEY idx_altoc_contract_amount_fact_component (component, effective_date),
  CONSTRAINT fk_altoc_contract_amount_fact_contract FOREIGN KEY (contract_id) REFERENCES altoc_contract(id),
  CONSTRAINT fk_altoc_contract_amount_fact_reverses FOREIGN KEY (reverses_fact_id) REFERENCES altoc_contract_amount_fact(id)
);
```

### 7A.3 成分与派生口径

| `component` | 含义 | 计入当前合同额 | 从有效合同额中扣除 |
| --- | --- | --- | --- |
| `gross` | 合同（或补充协议）的含税总额 | 是（+） | — |
| `third_party_purchase` | 为履约向第三方外采的软硬件/服务，按合同约定转售部分 | 否（是 gross 的组成说明） | 是 |
| `subcontract` | 转包/分包给第三方执行的部分 | 否 | 是 |
| `pass_through` | 代收代付（代客户支付、代第三方收取，本公司不确认收入） | 否 | 是 |
| `other_non_own` | 其它非本公司收入部分（须写依据） | 否 | 是 |
| `tax` | 税额（含税总额中的税）；仅用于展示与核对 | 否 | **否** |
| `effective_opening` | 历史导入的有效额期初值（人工录入，成分未拆分） | 否 | 特殊，见 7A.5 |

- **当前合同额**（as-of 某日）= 该日及以前生效的 `gross` 事实合计。对有合同行的合同，它应等于合同行合计；两者不等是需要处理的不一致，不是两套真相。
- **有效合同额**（as-of 某日）= 当前合同额 − 四类扣除成分合计。按用户定义扣除的是“第三方等非本公司收入部分”；**税额不扣（用户已确认，2026-10-04）**：有效合同额是含税口径，只扣第三方等。`tax` 成分只用于展示与核对，不参与有效额派生；未税的有效额若有需要，另行派生，不改变本定义。
- 扣除成分合计不得超过当前合同额（写入校验）；历史数据中“有效额大于总额”的 6 行不满足此约束，走 7A.5 的期初特例。
- `altoc_contract.effective_amount`、`amount_tax_inclusive`、`signed_amount` 成为**由事实维护的汇总列**（与现在合同行合计维护 `amount_tax_inclusive` 的做法一致，在同一事务内重算），列表与统计读汇总列，as-of 历史查询读事实表。`signed_amount` = 事件类型为 `signing` 的 `gross`，此后不变。

### 7A.4 与其它对象的关系

| 对象 | 关系 |
| --- | --- |
| 合同行 | 合同行是“卖什么”，事实是“金额怎么构成”。签署生效时由合同行生成 `gross`（行合计）以及按行标记生成的扣除成分：合同行需要一个“履约来源”标记（自有/外采转售/分包/代收代付），外采与分包行的金额即对应成分。没有行级标记的扣除（例如整体分包比例）用 `manual` 事实加依据录入。合同行此后的修改不直接改事实，只能通过变更事件。 |
| 补充协议 / 变更（P1） | 每次变更是一组增量事实：`event_type='amendment'`、`event_ref`=协议编码、`effective_date`=协议生效日。金额增加、减少、成分调整都是新行，不覆盖旧行；因此任意日期的合同额与有效额都可回放，这也是 §5.3“签约总额不变、当前合同额随变更变化”的实现方式。 |
| Finance 支出 / 成本 | 事实表记的是**合同约定的构成**（计划口径），Finance 支出记的是**实际付给第三方的钱**（实际口径），两者不互相派生。用途是对照：某合同 `third_party_purchase + subcontract` 的约定额 vs 归属该合同的外协/采购实际支出（老系统支出类型“项目采购”“外协支出”等，第二期迁入），差异进入项目核算与毛利分析。不得用实际支出反推并改写有效额。代收代付在 Finance 侧不应计入本公司收入与成本，事实表的 `pass_through` 是这一处理的合同依据。 |
| 结算计划 / 应收（§7） | 应收按**当前合同额**（客户要付的全部钱，含第三方部分与代收款）计划与核销，不按有效额。有效额不参与应收、开票、回款的任何计算。 |
| 经营统计 | 销售业绩、客户合同额、产品线收入贡献等按**有效合同额**统计（老系统的客户合同额汇总用的就是 `prime_amount`）；合同规模、应收、现金流按**当前合同额**。两种口径在页面上分别命名，不混用。父子合同不求和的规则不变。 |
| 授权 | 事实随合同 `view` 可读；签署/变更生成的事实走既有合同审批；人工事实（`manual`）要求 `contract:edit` 且必须填写依据，更正（冲销）建议要求 `contract:approve`，待实现时定。不新增服务 capability。 |

### 7A.5 历史有效额作为期初事实

历史合同只有两个数：总额与人工录入的有效额，成分未知。落入事实表的规则：

1. 每个历史合同一条 `gross`（`event_type='opening_import'`、`amount`=源总额、`effective_date`=签订日期，无签订日期时取快照日期并标注）。
2. 有效额非 NULL 时一条 `effective_opening`（`amount`=源有效额原值、`source_type='historical_import'`、`basis_note='原系统人工录入，成分未拆分'`）。**不**把“总额 − 有效额”伪造成某个具体扣除成分——我们不知道它是外采、分包还是代收代付。
3. 派生规则对历史合同的特例：合同存在 `effective_opening` 且没有任何扣除成分事实时，有效合同额 = `effective_opening` 的值；一旦业务为该合同补录了扣除成分（把差额拆清楚），`effective_opening` 被冲销，此后按通用公式派生。这样历史值先原样可用，之后可以逐步“做实”，每一步都有记录。
4. 有效额为 NULL 的 130 个合同：只有 `gross`，有效合同额为 NULL（未认定），统计中单列“未认定”，不当作等于总额。
5. 有效额大于总额的 6 个合同：`effective_opening` 照原值写入，同时保留 §5.3 的异常队列条目；它们不满足“扣除不超过总额”的通用约束，只能以期初特例存在，直到业务给出解释或更正。
6. 等于总额的 1,444 个合同：`effective_opening` = 总额，含义是“老系统认定无第三方部分”，同样是人工认定，不因相等而省略该事实。

W1 的迁移只写 `altoc_contract.effective_amount` 列与来源台账；上述期初事实在合同事实表实现时由一次受审的回填从台账与合同列生成，不需要重新访问老系统。

### 7A.6 未决

- 合同行“履约来源”标记的取值与录入时机。
- 有效额是否需要按产品线/部门拆分（影响是否给事实加归属维度）。
- 人工事实与更正的审批要求。

## 8. 决定、待定与核查结果

### 8.1 已决定（协调者，2026-10-04）

1. **受审加列采用**：APF 表优先 `ADD COLUMN`，必要时受审放宽 NULL；1:1 扩展表不用；迁移快照保持独立表。安装器“列增量子集”能力是 W2 前置工作包（§9.1）。
2. **未绑定客户的 721 个联系人**：台账保全 + “待归属联系人”队列，销售管理员指派客户后生成联系人；不建占位客户；队列属于一期页面范围。
3. **`system:unassigned`**：倾向采用；核查结果见 8.3，据此可定。
4. **期初未结项的取值来源**：已由用户决定，见 8.4-3。

### 8.2 W0 结论的落实（r4，依据 `docs/WizBiz-Migration-W0-Baseline.md`）

| # | 事项 | W0 结论 | 本设计的处理 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | 封存快照标识与时区 | 快照 `20261004T173356Z`（76 表、122,600 行，原始 SQL SHA-256 `f3edc77e…e36da`，逐表行序列 hash 见 W0 附录 A）；源 DATETIME 是 Asia/Shanghai 本地值 | `mig_batch.source_snapshot` 写快照标识 + SQL hash。台账 `row_json` 保存源本地时间文本，不换算。目标侧：DATE 列保留日历日期；表示瞬时事件的列（余额 `recorded_at`、合同 `signed_at`）按 Asia/Shanghai 换算为库内统一的 UTC 存储，换算规则写入迁移合同并由 verify 逐行反算核对。该快照不是停写水位，正式迁移另取快照并做差集 | 已定 |
| 2 | `org_type=0` 与主体指向 | 5 行确认为本公司资料 | → `finance_legal_entity`（§2.3）。W0 §8.1：合同与账户的主体引用全部指向这 5 行，映射共用 | 已定 |
| 3 | 字典 | 合同类型 4=系统维护、5=SaaS、6=平台运营、8=硬件与系统集成、9=其他；账户 0 基本/1 一般/2 专户/3 现金/4 贷款；组织状态 0 正常/1 删除；收入渠道 0 现金/1 银行/2 第三方/NULL 未登记 | 合同类型映射表与新增列 `contract_category`（§5.4）；账户类型映射与新增列 `account_subtype`（§3.1）；组织状态（§6.1）。收入渠道属于第二期，一期只在台账保全。客户等级：W0 §8.2 确认源全部为默认值 6、无字典 → `customer_level_id` 置 NULL（§6.1） | 已定 |
| 4 | 有效合同额、主合同、环 | `prime_amount` = 源录入的有效（认定）额，非除税、不可推导；合同全部为根、无父子数据；组织最长 3 层；均无环 | `effective_amount` 原样保全、NULL 保持 NULL、页面标注来源（§5.3）；`is_master_contract` 一律 0（§5.3）。长期口径用户已定义为“总额去掉第三方等”，由合同金额事实派生（§7A） | 已定 |
| 5 | 币种 | 源无币种字段，不能证明全为人民币 | plan 必须带用户确认的统一币种声明，否则阻断（§5.3）；用户已确认全部按 CNY | 已定 |
| 6 | 账户缓存 vs 最近历史 | 21 个有历史的账户全部一致、无并列；1 个账户无历史 | 缓存不入流水；无历史账户的处理规则见 §4.2。W0 §8.3：真实账户 2,627 行、快照候选 2,263 行、22 组同额并列、0 冲突；`ba_id=0` 的 127 行只入台账与异常队列（§4） | 已定 |
| 7 | 人员映射 | 90/138 为姓名唯一候选，0 条双证据；18 个候选目标非在职；另有 16 个源 ID 不存在于人员表 | 无自动匹配，候选须人工确认后才生效（§6.3） | 已定（确认人：用户本人或人事负责人） |
| 8 | 合同余额缓存 vs 明细 | 1,575 相等、20 不等（差额均 >1,000） | 期初应收：一致的取重算值，不一致的按源缓存导入并标记、W4 由财务确认（§7.2-2） | 已定 |

W0 还给出两条与本设计直接相关、但不在原 8 项里的结论：

- **客户两套汇总不可调和**：757 个客户中 408 个的“定时任务子树有效额”与“详情项目合同总额”不同（差额全部 >1,000）；缓存 `sum_all` 与任一重算也不完全一致。印证 §6.2 的做法：缓存只进 `altoc_customer_migration_snapshot` 并标注来源；新页面按新口径派生，且“本客户/含下属”“签约额/有效额”分别命名，不追求与任一旧算法相等。
- **发票没有类型字段**（第二期）：源表与字典都没有专票/普票/红字的区分，届时不按内容猜类型。

### 8.3 只读代码核查结果（2026-10-04，对照主线 `97fc28de`）

**A. `owner_uid` 的使用点**（`data-runtime/internal/enterpriseapf` 与 `apps/altoc`，共约 80 处引用，按用途归类）

| 用途 | 位置 | 对 `system:unassigned` 的影响 |
| --- | --- | --- |
| 读取范围 | `service.go` `scopeSQL`：`self` → `owner_uid=actor`；`dept/self_dept` → `owner_dept_code IN (...)`（`self_dept` 再 OR 本人）；`all` → 全部 | 保留值 + 空部门只对 `all` 可见。无需改代码 |
| 写入范围 | `altoc_customers.go` `altocScopeAllows`（同三种形态），用于客户改派、合同创建前锁客户（`lockContractCustomer`）、审批、Finance 来源校验（`finance_source.go`） | 只有 `all` 范围能改派或在其下建合同；其它范围 403。行为正确，页面需给出明确提示 |
| 负责人写入校验 | `altoc_customers.go`：创建/改派只校验“字符串、≤64”；合同创建从报价单继承负责人 | **缺口**：没有拒绝 `system:` 前缀，也没有校验目标是有效 Directory 用户。W2 前补“用户写路径拒绝保留前缀” |
| 到期通知 | `due_notifications.go`：线索/商机用 `owner_uid`，结算计划用 `collection_responsible_uid`，发票申请/收款用各自的责任人列 | 客户与合同的负责人**不参与**任何到期通知；一期不迁线索/商机。期初应收行的 `collection_responsible_uid` 留空即不产生催收通知，需要催收时由财务指定责任人 |
| 审批 | `altoc_approval.go` 只用负责人做范围判定 | 历史合同不进入审批；无影响 |
| 统计/导出 | 在上述两个包内未发现按负责人分组的统计或导出实现 | 无影响（若 W3 新增按负责人的统计，须把保留值单列为“待匹配”） |
| 数据库约束 | 客户、合同表的 `owner_uid` 只有 NOT NULL，没有格式 CHECK；结算计划对 `collection_responsible_uid` 有 CHECK（非空白、非 `@all`、无控制字符），保留值不违反 | 可写入 |
| 前端显示名 | `enterprise/app/composables/useAltocDirectoryLabels.ts`：未知 uid 显示“姓名加载中或不可用”，且任一 uid 未解析即把整页标记为目录错误 | 不报错，但保留值会显示成“不可用”并触发目录错误提示；处理方式见 8.5-4 |

结论：采用 `system:unassigned` 在 Runtime 侧可行，范围语义恰好符合“不转给管理员”；需要补一处写入校验和前端显示处理。改列为可空不必要。

**B. 域安装器对“新表外键指向已安装表”的支持**（`data-runtime/internal/enterprise/domaininstall/install.go`）

- 机制上可行：安装器的 baseline 是“本子集以外所有对象的 `SHOW CREATE` + 全表行摘要”的 hash，apply 前后必须相等。外键定义在子表上，被引用表的 `SHOW CREATE` 不变，因此新表引用已安装表不会破坏 baseline。
- 没有先例：现有各增量子集（renewals、tenders、finance_13a、aims_portfolio_members 等）的 DDL 中没有任何跨子集外键；base 子集的外键都在自己的表集合内。本设计的跨子集外键是第一次使用，需要隔离 MySQL 测试覆盖。
- 回滚的连带约束：Rollback 会检查“是否存在来自本子集以外的表指向本子集表的外键”，有则拒绝。因此一旦新子集引用了某个早先子集的表，那个早先子集就不能再单独回滚（必须先回滚新子集）。这是合理的保护，但要写进各子集的回滚顺序。
- baseline 含全库行摘要：plan/apply/rollback 都要全量扫描库内其它表，且 rollback 要求“自 plan 以来库内其它任何行都没变”——只在停机窗口内可行。来源台账与余额流水装入后库更大，安装耗时需在演练中实测。
- 列增量：现安装器只支持“表不存在 → 建表”（`absent` 检查），不支持对已存在表加列或改列。新增能力的要求见 §9.1。

### 8.4 用户决定（2026-10-04，经协调者转达）

1. **有效合同额** = 合同总额去掉第三方等（外采、转包、代收代付等非本公司收入部分）后的金额；历史值原样迁入、标注人工录入；后续可能实现合同金额事实表（§7A）。
2. **币种**：全部历史金额按人民币（CNY）。迁移契约写明这是用户确认的结论，不是工具默认：plan 的币种声明记录“用户确认、日期、确认人”，缺失即阻断（§5.3）。
3. **期初应收**：缓存与明细重算一致的 1,575 个合同直接取重算值；不一致的 20 个按**源缓存值**导入并标记 `contract_balance_mismatch`，W4 演练中由财务逐份确认（§7.2-2）。
4. **人员候选确认人**：用户本人或人事负责人。核对表只留在 OA 主机，不复制到本机、仓库或文档（§6.3）。
5. **银行账号揭示**：一期为财务管理员单人权限 + 双重审计，不做二人审批（§3.2）。
6. **来源台账保留**：至少保留到二期迁移完成后一年，届时再评估（§1.4）。

7. **税费**：有效合同额不扣税费，含税口径，只扣第三方等（§7A.3）。

### 8.5 仍需实现方在 W2 前核实

0. ~~迁移 plan 需补的三个统计~~ 已由 W0 §8 补齐并写入 §2.3、§4、§6.1。

1. 读取 `altoc_contract.tax_rate` 的全部代码对 NULL 的处理。
2. ~~行合计重算、合同状态机、Finance 摘要同步对 `amount_basis='header'` / `origin_type='historical_import'` 的跳过点~~ **已实现（历史合同护栏）**：`header` 合同拒绝改合同行（重算跳过保留为纵深防御）；历史合同在统一库路径上只放行查看与关联项目，其余写命令 409；Finance 对历史合同的开票与收款 409，摘要同步失败关闭。未装 W1 列的环境行为不变。合同见 MODULE_CONTRACTS“历史导入合同的操作护栏”。“补联系人/备注、完结、中止”在统一库路径上尚无对应命令，属于 W3；Finance 侧与付款条款在 P1 期初应收设计时重新放开。
3. Console 保险箱 `content_hash` 是否带盐，决定全量账号核对的方式。
4. ~~保留负责人值的写入校验与前端显示~~ **已实现（W2 前置二）**：用户写路径拒绝保留主体与非有效目录用户；`system:unassigned` 登记为 Foundation 内置目录用户并在选择器、会话、授权与显示名解析中处理。合同见 MODULE_CONTRACTS“Altoc 负责人指派校验与‘未分配’保留主体”。“原负责人：<显示名>”后缀属于 W3（需要台账映射）。Console `users/batch` 对保留值的行为不再相关（保留值不再送达 Console）。
5. 其它“责任人”字段的同机制校验（第 3 批）：共核查 4 个字段。销售任务 `altoc_sales_task.assignee_uid` 的继承指派，以及 Finance 发票 `issuance_responsible_uid`、收款 `reconciliation_responsible_uid` 的显式指派已补 owner-guard；历史值可读，不产生新指派的更新仍可执行。`altoc_billing_schedule.collection_responsible_uid` 尚无 Enterprise 用户指派入口，生成及期初迁移保持 NULL，写入合同拒绝注入该字段。详见 MODULE_CONTRACTS“Altoc 负责人指派校验与‘未分配’保留主体”；后续新增催收指派入口时须接入同一 guard，不能以此核查作为功能已实现的依据。

## 9. 安装、迁移与回滚要点汇总

### 9.1 W2 前置工作包：安装器“列增量子集”

现安装器只能“建不存在的表”。受审加列需要一种新的子集类型，要求与现有护栏同等级：

1. **声明式**：子集清单逐表列出要新增的列、索引、约束的精确定义，以及（如有）放宽可空的列及其前后定义。不接受自由 SQL。
2. **plan / reviewHash**：plan 记录每张目标表的当前 `SHOW CREATE`、行数与“既有列投影”的行摘要，以及其余对象的 baseline；人工审阅后以 reviewHash 确认才能 apply。目标表当前定义与清单预期的“前状态”不一致即拒绝（防止在漂移的表上加列）。
3. **只增**：apply 只执行清单内的 `ADD COLUMN / ADD KEY / ADD CONSTRAINT`；放宽可空作为单独标注的操作类型，逐项列在 plan 中。禁止删除、重命名、收紧、改类型。
4. **verify**：apply 后目标表定义等于“前状态 + 清单”；既有列投影的行摘要与 plan 时相同（证明没有动到任何既有数据）；其余对象 baseline 不变。
4a. **受审约束**（协调者决定）：列增量支持 `ADD CONSTRAINT`。外键要求引用列与被引用列各有可用索引（同批新增或既有）；CHECK 在 plan 阶段对存量全表预检，不满足即阻断；rollback 先删约束、再删列。W1 中的客户主联系人外键与合同 `origin_type` CHECK 按此安装，不降级。
5. **回滚只删本批新增的空列**：新增列全表为 NULL/默认值、新增索引与约束未被其它对象依赖时才允许 `DROP`；任何一列已有业务数据即拒绝并报告。放宽可空的回滚（恢复 NOT NULL）只在该列不存在 NULL 时允许。
6. **新装与增量等价；Registry 与 mapping_hash 不变**（协调者裁定）：全新环境直接按“含新列的基础定义”建表，存量环境走列增量；两条路径 verify 后的表定义必须字节一致，并由测试断言。Runtime Registry 的域绑定没有列清单，`mapping_hash` 只指纹化 Aims/Assets/Workflow 的表映射、明确不含 APF 的列——因此列增量**不改 Registry、不改 `mapping_hash`**（既有合同测试锁定了这一点）。列声明与目标表定义摘要独立绑定到 reviewHash，并写入 receipt，作为“哪些列是哪一批、按什么定义加上的”的唯一凭据。
7. **停机与耗时**：与现有安装同样要求 Runtime 停止证明。大表加列的算法与耗时在隔离库用生产规模数据实测，不假设 INSTANT。
8. 隔离 MySQL 测试覆盖：前状态漂移拒绝、重复 apply 幂等、部分失败后的恢复、回滚护栏（空列可删、非空拒绝）、新装与增量等价、跨子集外键（§8.3-B）。

### 9.2 顺序与验收

- **安装顺序**：`finance_legal_entity`（新表）→ `finance_balance_entry`（新表 + 快照表加列）→ `finance_bank_account_w1`（加列）→ `altoc_customer_w1`（加列 + 快照表）→ `altoc_contract_w1`（加列、放宽可空 + 快照表）→ `apf_migration_ledger`（新表）。每个子集独立 plan/review/apply/verify。回滚按相反顺序；被后装子集以外键引用的子集不能先回滚。
- **迁移顺序（W2）**：批次 → 人员映射 → 法人主体 → 客户（两遍）→ 联系人 → 账户（保险箱先行）→ 余额流水与快照 → 合同（两遍）→ 迁移快照 → 异常队列。每一步先写台账、再写目标、最后写映射；任何“有值但无映射”的源字段使 plan 阻断。
- **验收（W4）**：每个源行在 `mig_source_row` 中 hash 相符；每个源主键在 `mig_object_map` 中有去向（含 `preserved_only`）；金额在流水/合同层与源逐行相等；异常队列中没有未分类条目；普通接口与日志中检索不到任何完整账号。
- **回滚**：按批次、按对象引用状态逐项判断，只删本批新建且未被使用的对象；台账与保险箱密文不随回滚删除。已开放业务写入后的回滚不提供整库覆盖捷径。
- **不在 W1 范围**：发票、收入、支出、付款计划、维保系统、档案文件的目标模型（第二期）；它们的源数据在一期即进入台账保全。

### 合同三方标志与联系人归属裁定（2026-10-05）

| 源字段/值 | 目标 | 保全与验证 |
| --- | --- | --- |
| `wb_contract.is_third_party=N`（否，1,593行） | `altoc_contract.is_third_party=0` | 原字节N留台账，独立verify核对 |
| `wb_contract.is_third_party=Y`（是，2行） | `altoc_contract.is_third_party=1` | 原字节Y留台账，独立verify核对 |
| 其它值（含NULL/0/1/小写） | 阻断 | 不猜测或默认 |
| 联系人存在但所属客户与合同客户不同 | `contact_id=NULL`，合同仍迁移 | 原ID保全；新增闭集事项 `contract_contact_mismatch` |

源码依据：实际本机源码目录为 Wiztek/WizBiz 与 Wiztek/Wizbiz-Vue3（指定 WizOA 目录不存在）。合同页面 index.vue:235–243 使用 sys_yes_no，Y显示第三方，:1174默认N；sql/ry_20220712.sql:502–503 明定Y是/N否；ContractMapper.xml:22/225/257/293 原样读写。未读取配置、凭据、证书文件。


### 数值 ID 避碰补充

存量悬空引用保留为数据质量项。迁移新 ID 显式从目标既有 ID 与登记外部引用值的最大值加一分配，不依赖 AUTO_INCREMENT，不改 schema。起点、引用快照、逐对象 ID 进入 plan/reviewHash；apply 漂移阻断、verify 核对不相交。具体规则见 W2 工具合同“确定性数值 ID 与存量外部引用”。


### 2026-10-06 后续裁定：hzy0 期初应收与账号秘密

本次 hzy0 期初应收由用户裁定替代财务确认：使用 W0 封存快照 `20261004T173356Z`，截至日 `2026-10-04`，裁定日期 `2026-10-06`。既定候选公式不变，缓存/明细不一致时仍用原缓存，不扣税或有效额。新来源类型为闭集 `user_ruling_snapshot`，由只读派生工具完整生成并核对；人工财务确认类型保留。受保护制品记录原始 SQL hash、口径版本、逐合同金额与逐客户计数/金额。

用户另逐环境批准 hzy0 使用真实银行账号。候选升级工具保持现有账户和 secretRef，以 Console 加密版本轮换替换 synthetic 内容，另冻结 reviewHash/回执。明文仅在内存，日志和报告最多显示尾四位；不生成主密钥、不写 OSS、不调 Platform。必须隔离副本全链通过后才进入 hzy0 窗口。迁移后的业务更新原样保留；原全库门禁失败时不得借本裁定静默重置业务行。

2026-10-06 hzy0 真实 Vault 补充裁定：首尾空白按 Console 既有 `TrimSpace` 规范化，内部字符不变，封存加密快照保留原值；台账只记 `trim_applied` 和计数，本次 21 个非现金账户恰 1 例。补充计划用 Runtime 现有密钥派生 HMAC 冻结原始内容，不保存真实账号无盐哈希；独立核验规范化后 Vault 等值和计数。
