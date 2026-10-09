# WizBiz 迁移 W0 基线：快照、字典、公式与人员映射

日期：2026-10-04。状态：本轮只读导出及核查完成，未实施迁移、schema 或授权变更；以下剩余口径门禁需在 W1/迁移计划中处理。

依据：[差距分析 §8.1 用户决定](./WizBiz-Enterprise-Gap-Analysis.md#81-用户决定2026-10-04按协调者建议)、任务书 `.git/brief-wizbiz-w0.md`。全部有值源字段保全；一期页面覆盖核心主档、应收账龄与收款分配；历史金额缓存原样保存，新汇总由事实派生。

## 1. 执行边界和结论

- 仅在 OA 主机对 wizbizdb 使用既有应用账号进行 SELECT/SHOW 和一致性 mysqldump。为人员映射额外只读 hzy_console Directory 与 hzy_people 的 employee_no；不导出这些库。
- 数据、个人名单及加密密钥仅留 OA 主机。数据库凭据只在远端进程内加载并使用 0600 临时 defaults-extra-file，用后删除；未打印、未复制到本机或文档。报告不含客户名称、个人信息、银行账号或源行 ID。
- 本机只新增本文件；没有建账号、修改数据库对象、执行迁移/回写、调用具有缓存写副作用的 OA HTTP 接口、切换进程或提交/推送。
- 源快照覆盖 **76 张 InnoDB 表、122,600 行**；全部表有主键。导出、加密、解密哈希校验通过，SQL 明文已删除。
- 当前字典修正了旧 DDL 的解释：合同 **4=系统维护服务、5=SaaS 销售、8=硬件与系统集成、9=其他**；org_type=0 的 5 行经公司列表 SQL 确认为本公司资料。
- 757 个客户的两套合同汇总有 **408 个**结果不同。1,595 个合同的执行余额及开票余额各有 **20 个**与明细重算不符；金额缓存不宜直接当作新经营事实。
- 员工可匹配的姓名唯一候选为 **90/138（65.22%）**，存在工号冲突者已排除。候选匹配不是身份认证或正式 UID 映射，不产生授权。

## 2. 一致性源快照

### 2.1 文件与时间

| 项目 | 记录 |
| --- | --- |
| 主机 / 源库 | oa.wiztek.cn / wizbizdb |
| MySQL | 8.0.45 |
| 导出起止 UTC | 2026-10-04 17:33:56.723664 → 2026-10-04 17:33:58.673083 |
| 快照目录 | `/root/wizbiz-migration-w0/20261004T173356Z`，0700，root 所有 |
| 加密 SQL | `/root/wizbiz-migration-w0/20261004T173356Z/wizbizdb.sql.enc`，0600，root 所有 |
| 密钥（仅路径，不含内容） | `/root/wizbiz-migration-w0-keys/20261004T173356Z.key`；父目录 0700，文件 0600 |
| 聚合证据及逐表清单 | `/root/wizbiz-migration-w0/20261004T173356Z/baseline-aggregate.json`，0600 |
| 人工核对名单 | `/root/wizbiz-migration-w0/20261004T173356Z/personnel-unmatched.json`，0600 |
| SQL 原始大小 | 58,037,313 字节 |
| 加密文件大小 | 58,037,344 字节 |
| 原始 SQL SHA-256 | `f3edc77ee322bf5a6ce169acaa28f21cc3cdb98070957a50fc5fdb7dc61e36da` |
| 加密文件 SHA-256 | `12bcca2f4fe46d6b4aeeae26b89e6d45ee3bd91b34d014ac7d4d22afd6fdcdb5` |
| 校验 | OpenSSL 解密流的字节数及 SHA-256 均与原 SQL 一致；未落解密明文；导出 SQL 已删除 |

### 2.2 导出与校验方法

实际导出使用以下选项；变量代表仅在 OA 主机使用的临时配置和受保护文件路径，不包含任何凭据值。

```sh
mysqldump --defaults-extra-file="$REMOTE_CNF" \
  --single-transaction --skip-lock-tables --no-tablespaces \
  --routines --events --triggers --hex-blob --order-by-primary \
  --skip-extended-insert --complete-insert --skip-add-locks \
  --default-character-set=utf8mb4 --databases wizbizdb > "$REMOTE_SQL"
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
  -pass "file:$REMOTE_KEY" -in "$REMOTE_SQL" -out "$REMOTE_ENCRYPTED"
```

文件在打开时即通过 0600 创建；目录为 0700。导出进程退出码为 0，包含 76 个 CREATE TABLE 定义；源元数据另核实存储过程 1、事件 0、触发器 0，导出包含 routines/events/triggers 选项。没有将导出的 SQL 交给服务端执行。

导出前后比对表列定义，无差异。所有表均为 InnoDB，数据来自同一次 `--single-transaction` 导出；行数、校验和、字典、公式重算和环检查均从这份 SQL 的 INSERT 记录离线读取，不是后续各次 SELECT 的混合时点。人员 Directory 比对另有时刻，见第 5 节。

逐表 checksum 为 **按主键顺序导出的每条完整 INSERT 行（含换行）的 SHA-256**。采用单行单 INSERT、完整列名、hex-blob；空表为 SHA-256 空输入。此值是来源行序列哈希，不是 MySQL `CHECKSUM TABLE`，也不是能直接与新目标表相等的跨模型校验和。迁移工具应分别核对源行序列和字段映射后的目标摘要。

此快照不暂停生产写入、不构成切换时刻的 binlog/GTID 水位。正式迁移前仍须按受审切换方案获取最新快照和增量差集；本轮只建立可重复分析的不可变基准。快照未离开 OA 主机；密钥分目录保管但仍在同主机，不等同异地备份。

## 3. 字典核定与建议目标映射

字典值与标签取自快照中的 `sys_dict_data`；下列相关字典行均 status=0。「建议目标」为下一批导入合同输入，**没有更改 APF 枚举或数据**。旧字典、源值和标签均应随来源记录保存；禁止未知值默认为 active 或任意新类型。

### 3.1 组织与合同

| 字段 / 源值 | 核实含义及数量 | 建议目标 / 限制 |
| --- | --- | --- |
| org_type=0 | 本公司资料，5；`OrganizationMapper.xml:82–86` 的 selectCompanyList 专取 0 | 独立业务法人主体目录，不写 Console 控制面；不是普通客户 |
| org_type=1 | 客户，757；crm_organization_type | altoc_customer；保留原父链和归属 |
| org_type=2 / 3 | 代理商 / 供应商；本快照各 0 | 建议交易主体角色 distributor / supplier，保留来源类型；不强行冒充客户类型字典 ID |
| org_status=0 / 1 | 正常 / 删除（源 DDL）；754 / 8 | 正常候选 active，历史删除候选 archived 或来源归档标记；不丢 8 行，不以停用字典替换删除语义 |
| contract_type=0 | 采购；本快照 0 | direction=purchase；不得自动迁为销售 |
| contract_type=1 | 软件产品销售；453 | direction=sales；建议类型 software，保留旧类别 |
| contract_type=2 | 软件开发服务；185 | sales；建议 implementation，保留旧类别 |
| contract_type=3 | 技术与数据服务；28 | sales；建议 service，保留旧类别 |
| contract_type=4 | 系统维护服务；860 | sales；建议 maintenance；不能使用旧 DDL 将 5 当作维保 |
| contract_type=5 | SaaS 销售；2 | sales；保留 SaaS 来源类别；现 primary_type 不自动新增 subscription 枚举 |
| contract_type=6 | 平台运营服务；16 | sales；建议 service + 原类别保全 |
| contract_type=8 | 硬件与系统集成；47 | sales；保留 integration 来源类别，后续由真实合同行类型推导，不能伪造行 |
| contract_type=9 | 其他；4 | sales；保留 other；不自动猜具体商品/服务类型 |
| contract_status=0 | 正常；1,574；wb_business_status | 历史导入保留 legacy_normal；不足以证明新 legal/activation/fulfillment 轴均已完成 |
| contract_status=1 | 完结；1 | 历史状态建议映射 completed，并保留原值；不伪造批准或履约证据 |
| contract_status=2 | 中止；20 | 历史状态建议映射 terminated，并保留原值；不触发停用/退款等新副作用 |

新合同的 `primary_type` 当前按合同行推导，历史合同不应为适配它而补造合同行、审批、签署或生效操作。受审历史导入 lane 要同时保留原状态与原金额，并独立表达哪些新状态事实未知。

### 3.2 银行、收入、发票、系统

| 字段 / 源值 | 核实含义及数量 | 建议目标 / 限制 |
| --- | --- | --- |
| ba_type=0 | 基本户；5 | account_type=bank；原银行子类型 basic 需保全 |
| ba_type=1 | 一般户；10 | bank；原子类型 general 需保全 |
| ba_type=2 | 专户；2 | bank；原子类型 special 需保全 |
| ba_type=3 | 现金户；1 | cash；不得按银行账号强制补号码 |
| ba_type=4 | 贷款户；4 | 银行账户可关联贷款用途/来源子类型 loan；不凭余额正负自动创借款或改为收入 |
| ba_status=0 / 1 | 正常 / 停用；22 / 0；wb_record_status | active / inactive；停用不等于已销户，不自动用 closed |
| income.channel=0 | 现金；302 | cash |
| income.channel=1 | 银行转账；1,455 | bank；旧工具的 1→cash 是错误映射 |
| income.channel=2 | 第三方支付；4 | third_party；旧工具的 2→bank 是错误映射 |
| income.channel=NULL | 未登记；1,408 | legacy_unknown/原 NULL 来源；不能默认 bank |
| 发票类型 | wb_invoice 和 Invoice.java 没有发票类型列，sys_dict_data 没有对应发票类型字典 | 无从确定专票/普票/红字类型；只保全历史来源，不按 item 文本猜类型，不自动赋 ordinary |
| system_status=0 | 交付中；0 | 旧系统台账交付态，不自动创建新覆盖/工单 |
| system_status=1 | 试运行；0 | 原试运行态保全 |
| system_status=2 | 正式运行；204 | 原运行态保全；不凭此认定全部服务协议有效 |
| system_status=9 | 已停用；11 | 原停用态保全，不删除历史记录 |

`wb_system.contract_ids` 和 `maint_ids` 是合同 ID 的逗号列表，不是状态枚举；`SystemController.java:138–159` 对 maint_ids 引用的正常合同按 prime_amount 求和，并推进 last_due_date。保存原列表，按 ID 映射拆关联；不能把「系统台账维保关系」等同新服务额度和权益。日期与收费比例保留原值，不推导新的 SLA。

收入类型 `wb_income_type` 和支出类型 `wb_payment_type` 的完整标签在附录 B；第二期财务导入需按字典对齐，不从 channel 推断款项性质。

### 3.3 币种与时区

- 源合同、发票、收入、支出、账户和余额模型无币种字段，所读字典无币种定义；源码未发现这些实体强制 CNY 的写入规则。新 APF 的 CNY 默认是目标默认，**不能反证源数据全为人民币**。建议迁移契约由用户确认「此快照统一 CNY」后才能写新币种；在此前保留 legacy_unspecified，不进行汇率转换。金额原值不乘除 10,000。
- MySQL global/session time_zone 均 SYSTEM，system_time_zone 为 CST；实测 NOW−UTC 为 +08:00。WizBiz JDBC 的 serverTimezone 是 Asia/Shanghai；BankAccount 的日期序列化注解包含 GMT+8。未见进程显式 `-Duser.timezone` 或已加载配置的 spring.jackson.time-zone，不能声称每个 JSON 日期都显式绑定时区。
- 建议 DATETIME 保留来源本地值及 Asia/Shanghai 的解释来源，DATE 保留日历日期；只有字段合同确认是瞬时事件才转换 UTC。mysqldump 默认 tz-utc 对 TIMESTAMP 与 DATETIME 的处理不同，逐表哈希以原导出字节为准。不能把日期字段统一移八小时。

## 4. 公式核定与差异量化

以下计算只读快照，不更新源缓存。所有金额使用 Decimal；缺值另计，不以浮点误差放宽一致性。

### 4.1 prime_amount 的可确认含义

确认的技术语义是 **独立录入/维护的有效（认定）合同额，用于经营统计**，而非可由总额统一推导的未税额、利润、已收款或剩余应收：

1. `wb-pm/.../domain/Contract.java:64–66,261–266` 命名和 Excel 标签为有效金额，setter 直接接受值。
2. `wb-admin/.../pm/ContractController.java:285–307` 创建只初始化 exec/invoice 余额，编辑透传领域对象；未见 prime 的统一计算公式。
3. `wb-pm/.../mapper/pm/ContractMapper.xml:100–105,173–206` 对正常合同以 SUM(prime_amount) 做经营/客户统计。
4. `wb-admin/.../pm/SystemController.java:89–113,138–144` 用它初始化系统合同额/认定额或维保合同额；不代表新系统的实际回款。

快照中 1,595 行：**130 行 NULL、1,444 行等于总额、15 行小于总额、6 行大于总额**；18 行有效额为 0（包含总额同为 0 者，与前述分类不互斥）。在 21 行非 NULL 且不同于总额的记录中，按 3%、6%、13% 除税后取两位小数的匹配数分别均为 **0**。这只能排除本样本中的这三种统一除税公式，不能替代商业确认。

W0 核定的是来源用途和「不能自动推导」；无法从源码还原每笔认定理由。后续合同应命名为「历史有效合同额（源录入）」并保全 NULL 与原数。若要把它变成新产品的长期经营指标，仍需确认认定规则，不擅自解释为「扣外包后的金额」。

| 合同类型 | 行数 | prime NULL | 等于总额 | 小于总额 | 大于总额 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 453 | 15 | 428 | 7 | 3 |
| 2 | 185 | 23 | 159 | 3 | 0 |
| 3 | 28 | 5 | 22 | 0 | 1 |
| 4 | 860 | 68 | 786 | 5 | 1 |
| 5 | 2 | 2 | 0 | 0 | 0 |
| 6 | 16 | 11 | 5 | 0 | 0 |
| 8 | 47 | 6 | 41 | 0 | 0 |
| 9 | 4 | 0 | 3 | 0 | 1 |

### 4.2 客户两套汇总

计算覆盖全部 org_type=1 的 757 个客户（包含历史删除者），使用正常合同 contract_status=0。与源码调用一致，未额外增加当前权限或新状态筛选。

| 路径 | 重算公式 / 源码 |
| --- | --- |
| 详情 sum_all | 正常合同 total_amount 合计，条件 project_id 属于 org_id=该客户的项目；`OrganizationController.java:246–247` + `ContractMapper.xml:125–133` |
| 定时任务 sum_all | 该客户正常合同 prime_amount + 所有客户子节点递归同式；`WbTask.java:445–514`。根 parent_id=0 启动递归，本快照全部 757 客户可达 |
| 详情 sum_all_receivable | 同项目条件的 exec_amount 合计 |
| 直接 sum_receivable | customer_id=该客户的正常合同 exec_amount 合计；不递归 |

定时任务只递归更新 sum_all，未见相同递归更新 sum_all_receivable；不能把第三/第四行当成两套完整的应收子树算法。

差值统一为「左列结果 − 右列结果」。下表为逐客户差异分布，跨客户包含子树/项目关系的重复计入，差值合计不是公司的收入或损失。

| 比较 | 相等 | 正差 | 负差 | 不同数量 | 绝对差合计 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 定时子树有效额 − 详情项目合同总额 | 349 | 376 | 32 | 408 | 224851972.42 |
| 缓存 sum_all − 重算定时结果 | 354 | 17 | 386 | 403 | 220752602.33 |
| 缓存 sum_all − 重算详情结果 | 727 | 1 | 29 | 30 | 18587643.07 |
| 详情项目应收 − 直接客户应收 | 641 | 28 | 88 | 116 | 20528282.82 |

两套合同汇总不一致的 408 个客户中，全部绝对差大于 1,000；差异不是几分钱的舍入。源码证明算法差异，数据只说明差异规模，不能据此判定哪套更正确或谁最后更新缓存。依用户决定，两套重算值和原缓存分开呈现，不回写源库。

### 4.3 合同余额逐合同对账

- 执行余额：type=0 为 total−该合同支出合计；其他类型为 total−该合同收入合计。
- 开票余额：total−该合同发票合计。
- 依据 `ContractController.java:127–134`；明细汇总分别见 `PaymentMapper.xml:85–87`、`IncomeMapper.xml:96–98`、`InvoiceMapper.xml:70–71`。源码没有给这些明细再加状态筛选，本轮保持同规则。
- 差值为 **缓存 − 公式重算值**，余额是剩余应收/应付或未开票，不能映射成已收款/已开票额。

| 检查 | 合同数 | 缺金额不能比较 | 完全相等 | 缓存偏高 | 缓存偏低 | 绝对差 >1,000 | 差值合计 | 绝对差合计 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| exec_amount | 1595 | 0 | 1575 | 2 | 18 | 20 | -7145221.10 | 7370374.90 |
| invoice_amount | 1595 | 0 | 1575 | 2 | 18 | 20 | -7145221.10 | 7370374.90 |

两列不一致的是同一组 20 个合同，均为 contract_status=0；所有差异均 >1,000，(0,1] 与 (1,1000] 档均为 0。缓存差异保全并进入对账队列，本轮不纠正。旧详情 GET 会重写这两列，因此不能通过重新打开详情来「修复」基线。

### 4.4 银行余额缓存与最近历史

沿原 `BalanceMapper.xml:24–36` 的顺序，以 check_date DESC、operate_time DESC 选择最近记录。先检查此排序是否有并列；不自行增加 id 作为业务取舍。

- 22 个账户：21 个有历史，1 个无历史；有历史的 21 个缓存与最近余额全部相等，check_date 差异 0，最近排序并列 0。
- 无历史账户不参与一致率分母；「21/21 相等」不能证明无历史账户的余额来源。
- 第一次盘点已经发现的同日多行仍需全部保全；当前缓存相等不表示可以删除历史重复。余额缓存也不是银行流水或对账凭证。

## 5. 人员映射率与人工队列

### 5.1 来源、匹配规则和限制

源人员来自同一快照的 wb_employee、sys_user；目标候选来自 OA 主机 hzy_console.directory_users 和 hzy_people.people_employees。这是原 wiztek Console 的 Directory 对照，不冒充新生产的现场验证；正式迁入目标前应核实该 UID 已沿用且状态未变。

Directory 比对时刻：**2026-10-04 17:40:44.562614 UTC**。员工类型候选共 98，包括 active/inactive/deleted，不给历史离职人员新权限。

规则如下：

1. 姓名在远端去首尾空白，区分大小写；比对 Directory real_name/display_name。同一 UID 的两字段去重；不使用昵称、拼音或模糊匹配。
2. job_number 为 BIGINT，employee_no 为字符；仅两端都是正数字时去无意义前导 0 比较，不剥任意业务前缀。
3. 两项都有候选时必须交集唯一；不同人或歧义则拒绝自动候选。仅姓名唯一只标「候选」，不能当作已批准人员映射。
4. operator 先通过 sys_user.user_id→wb_employee.user_id→员工候选；已有关联员工但无法解歧义时不再以昵称绕过。没有员工关联时才以 nick_name 与 Directory 正式姓名形成唯一候选。
5. 不查询密码、完整手机号、邮箱或证件号，也不据 active 状态升级角色。未映射人员保留来源显示名，由人工处理仍在负责的客户/合同。

### 5.2 数量与比例

| 分母 | 总数 | 可匹配候选 | 比例 | 未映射 / 歧义 |
| --- | ---: | ---: | ---: | ---: |
| 旧员工 | 138 | 90 | 65.22% | 48 |
| 旧操作账号 | 17 | 15 | 88.24% | 2 |
| 九类核心业务表 employee_id 不同引用 | 28 | 20 | 71.43% | 8 |
| 九类核心业务表 operator_id 不同引用 | 17 | 14 | 82.35% | 3 |
| 全部表 employee_id 不同引用（排除人员表本身） | 152 | 90 | 59.21% | 62 |
| 全部表 operator_id 不同引用（排除账号表本身） | 19 | 15 | 78.95% | 4 |

九类核心表是 organization、contract、project、bank_account、account_balance、invoice、project_income、project_payment、system；这里的引用比例按不同来源 ID，不是源业务行加权覆盖率。其他表的同名字段仍需各领域核对命名空间，不能仅凭列名把 ID 赋为新 owner。

员工 138 名中：90 名姓名唯一候选、44 名未找到、1 名姓名/候选歧义、3 名姓名与工号冲突；135 名原工号 NULL 或 0。没有同时姓名与工号命中的可靠双证据映射；全部 90 名均需人工确认后才可应用。90 个候选对应 90 个不同 UID，多个源员工指向同一 UID 的组数为 0；其中目标 active 72、非 active 18。

操作账号 17 个中：11 个经关联员工形成候选，4 个仅姓名候选，1 个关联员工未解决，1 个未找到/歧义。全部业务表另有 14 个 employee_id、2 个 operator_id 在源人员/账号表中不存在。

主机人工文件最终 **66 条核对记录**：员工未匹配/歧义 48、账号未匹配 2、源缺员工 14、源缺操作账号 2。文件只留远端，0600，报告不列姓名、工号、UID 或对象 ID。90 个候选名单亦需正式导入前人工确认，本轮未写任何 UID 映射表或责任归属。

## 6. 多层环与根链检查

对同一快照全部组织和合同，以 source ID→parent_id 在内存逐根递归/迭代，分别检查访问栈重复、缺父节点和根深度。NULL/0 为根，不将 archive/delete 行排除。

| 对象 | 行数 | 环组 | 环节点 | 链末父节点不存在 | 最长根链节点数 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 组织 | 762 | 0 | 0 | 0 | 3 |
| 合同 | 1595 | 0 | 0 | 0 | 1 |

客户存在三层链；本快照合同均为根记录，当前没有实际父子合同数据，不代表未来可以删除合同 parent_id 的承载。没有发现多层环，也没有把自环检查误当成完整递归检查。

## 7. 下一步门禁与交付边界

| 编号 | 状态 | 后续要求 |
| --- | --- | --- |
| W0-01 快照 | 已完成 | W1 plan 引用此路径/哈希；正式迁移另取最新一致性快照与增量，不将本快照视为停写水位 |
| W0-02 字典 | 已核实 | 新旧枚举分层；合同 5/8/9、公司 0、账户子类型、未知渠道保全；历史导入不触发新业务副作用 |
| W0-03 有效额 | 源码用途与分布已核实 | 原录入金额/NULL 保全；长期指标的认定规则待产品合同确认，不自动除税或扣第三方款 |
| W0-04 缓存对账 | 已量化 | 客户两套结果分别命名；20 个合同的原余额和新事实差异进入可解释队列；源库不修数 |
| W0-05 人员 | 候选与歧义已核实 | 人工核对并验证目标 UID/状态；未映射仍负责对象进入匹配队列，不默认管理员接管 |
| W0-06 币种 | 源库未声明 | 必须确认默认 CNY 或提供逐对象币种来源；不得直接沿用旧工具默认 |
| W0-07 发票类型 | 源字段不存在 | 不从内容猜类型；历史来源保全，第二期正式票导入另定缺类型语义 |
| W0-08 应收账龄 | 一期需求已确认，源事实不完整 | 从款项/结算条款明确到期日，不借合同到期日期；不为保全缓存制造应收或已批准票据 |

本轮已完成任务书要求的快照及统计产物，但 **币种默认和 prime_amount 的逐笔商业认定理由不能由现有数据自动证明**。以上如实列为后续门禁，不以推测补齐。源数据保全、安装规格、迁移工具、保险箱写入和生产切换不在本轮执行范围。

## 8. 同一封存快照的补充统计

本节只在 OA 主机离线解密读取 `20261004T173356Z` 的 SQL 快照，解密流 SHA-256 与 §2 原始 SQL 哈希一致；未连接数据库、未落解密明文、未改变快照或人工名单。输出仅为统计与系统字典信息，不含客户名称、人员名单或银行账号。

### 8.1 合同与银行账户的本公司主体引用

两列的全部取值均指向 `wb_organization.org_type=0` 的 5 条本公司资料；没有 NULL、0 占位、指向客户的行或悬空引用。合同实际引用其中 4 个主体，银行账户引用全部 5 个主体。

| 源组织业务 ID | org_type | wb_contract.company_id 行数 | wb_bank_account.org_id 行数 |
| --- | --- | ---: | ---: |
| 4 | 0 | 1,497 | 16 |
| 5 | 0 | 89 | 3 |
| 6 | 0 | 7 | 1 |
| 8 | 0 | 2 | 1 |
| 9 | 0 | 0 | 1 |
| 合计 | — | 1,595 | 22 |
| NULL | — | 0 | 0 |
| 0 占位 | — | 0 | 0 |
| 非本公司 / 无组织引用 | — | 0 | 0 |

迁移对应：按来源组织 ID 建立独立业务法人主体映射，合同签约主体和账户所属主体共用这份映射。不把 org_id 转为部门，不写 Console 企业控制面；原主体资料和源引用仍全部保全。

### 8.2 客户等级 level 与目标 customer_level_id

| 源列 / 范围 | 取值 | 行数 | NULL 数 |
| --- | --- | ---: | ---: |
| wb_organization.level，org_type=1 客户 | 6 | 757 | 0 |
| wb_organization.level，org_type=0 本公司 | 6 | 5 | 0 |
| wb_organization.level，全部组织 | 6 | 762 | 0 |

源 DDL 为 `level INT DEFAULT 6 COMMENT '等级'`；`Organization.java:40–42,304–306` 仅标「等级」并直接赋值。快照的 sys_dict_data 中没有客户/组织等级字典，不能核定「6」对应的业务标签。源组织表也没有 customer_level_id 列。仅有默认值和所有行相等，不能证明「6=普通客户」或某个排名。

目标 APF 的 `altoc_customer.customer_level_id` 是指向 `altoc_customer_level.id` 的外键；字典另有 code/name/sort_no。该表及其数据不在 wizbizdb 封存快照内，本轮没有查询当前目标库，**不能给出已存在目标等级 ID 的命中计数**。旧独立 Altoc schema 的 strategic/key/standard/potential seed 也不是源等级 6 的含义或统一库实际 ID 的证据。

因此本轮能确认的对应关系是：**源 level=6 的客户 757 行 → 目标等级尚未确认的映射 757 行**；已证明可直写某个 customer_level_id 的行数为 0。迁移应保留 source_level=6；业务标签确认后按目标字典 code 查 ID，不直接写 customer_level_id=6，也不自动写 standard。此结论收紧前次逐字段表中「结构能映射」的解释：等级字段必须做字典转换，不能按数值复制。

### 8.3 余额 NULL、排序并列与每日快照数量

check_date 是非 NULL 的 DATE，operate_time 是可 NULL 的 DATETIME。本节按源账户键与日期分组，沿 `check_date DESC, operate_time DESC` 取最晚；NULL 时间按 MySQL 降序排在非 NULL 时间之后，不添加 ab_id 作为隐式决胜规则。

| 检查 | 行数 / 组数 |
| --- | ---: |
| 原始余额行 | 2,754 |
| operate_time 为 NULL | 0 |
| 不同 (ba_id, check_date) 分组 | 2,320 |
| 同账户同日多行的分组 | 319 |
| 完全相同 (ba_id, check_date, operate_time) 的并列组 | 87 |
| 上述并列组包含的源行 | 206 |
| 上述并列组中余额不同 | 46 |
| 上述并列组含 NULL 时间 | 0 |
| 在每日最大 operate_time 上并列的分组 | 78 |
| 每日最新并列包含的源行 | 180 |
| 每日最新并列且余额不同的分组 | 45 |
| 每日最新记录唯一的分组 | 2,242 |
| 每日最新余额值唯一的分组（含同额并列） | 2,275 |

全源记录按「每账户每天一条」计，候选快照数为 **2,320**；但纯粹取 MAX(operate_time) 后回连源行会返回 **2,422 行**（2,242 条唯一最新 + 180 条并列），并非已经生成 2,320 条唯一结果。无第三排序键时，有 78 组无法唯一选定源行，其中 45 组还无法唯一选定余额值。不能任意取一条、认为按时间排序就能消除所有重复。

#### 8.3.1 额外核对：账户 0 占位与有效账户

该快照有 **127 行 ba_id=0**，不是 wb_bank_account 中存在的账户，覆盖 **57 个日期分组**；其他非 0 的悬空账户引用为 0。前次孤儿检查有意排除了 0 占位，因此 §5 早先的「非空非 0 孤儿为 0」与此发现不矛盾。不能为这些记录自动创建「账户 0」。

| 对已存在银行账户的余额检查 | 结果 |
| --- | ---: |
| 源余额行 | 2,627 |
| 不同账户日期分组 / 候选每日快照行数 | 2,263 |
| 每日最新源行唯一 | 2,241 |
| 每日最新源行并列 | 22 |
| 每日最新并列且余额不同 | 0 |
| 每日最新余额值唯一（含同额并列） | 2,263 |

**可引用真实账户的每日金额快照候选为 2,263 条**，金额值均可确定；其中 22 组仍不能按给定两列唯一选定来源记录。其余 57 个占位账户日期分组只保全来源，不计入可直接挂接真实账户的快照；全源 45 组最新余额冲突均位于这些占位分组中。

后续迁移必须保全全部 2,754 行以及并列来源关系。若要以某个具体源行承载每个每日快照，需另行明确同额并列的决胜/溯源方式，不由本轮擅自添加 ID 排序。§4.4 的「最近排序并列 0」检查的是**每个真实账户全历史的最终一条**；本节检查**每账户每天**，22 组有效账户日内并列并不推翻之前的账户缓存对账结果。

补充核验：主体引用计数分别合计 1,595 / 22；客户等级合计 757；2,320=2,263+57；2,754=2,627+127。只更新本文 §8，未提交、未推送。

## 附录 A. 76 张表的快照行数与 checksum

排序：源表名；每表数据行按源主键顺序。SHA-256 口径见 §2.2；主键列仅为元数据，不含主键值。

| 表 | 行数 | 主键列 | INSERT 行序列 SHA-256 |
| --- | ---: | --- | --- |
| `gen_table` | 36 | table_id | `7feb008514a2e9064c206951fd294fa99cafb737117563e40257004548faebe4` |
| `gen_table_column` | 530 | column_id | `44131a64052e86e168bdea8bb291287ba8f42e7231f5d96c882abf71b50c5594` |
| `qrtz_blob_triggers` | 0 | sched_name, trigger_name, trigger_group | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `qrtz_calendars` | 0 | sched_name, calendar_name | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `qrtz_cron_triggers` | 3 | sched_name, trigger_name, trigger_group | `5f785a99c5bfc90feb43c67c295b9fcf6258fdbb4f7293d7b5a3680b937d1032` |
| `qrtz_fired_triggers` | 0 | sched_name, entry_id | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `qrtz_job_details` | 3 | sched_name, job_name, job_group | `168eaff17b672c05a10a2e3b38bd5f2749ed316e2bdd4514b8a6b63013bc9ada` |
| `qrtz_locks` | 2 | sched_name, lock_name | `9763b7123f7f0fe65f24fb8053c78f0916b9989ac3c77345876ea17e70c0c1ce` |
| `qrtz_paused_trigger_grps` | 0 | sched_name, trigger_group | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `qrtz_scheduler_state` | 1 | sched_name, instance_name | `30dbcd3a5cd7d1558047c1dadf4a07403d77c958f5d82c1fd1c9776154bc5d20` |
| `qrtz_simple_triggers` | 0 | sched_name, trigger_name, trigger_group | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `qrtz_simprop_triggers` | 0 | sched_name, trigger_name, trigger_group | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `qrtz_triggers` | 3 | sched_name, trigger_name, trigger_group | `5c117196b8e9b5e818f265a385adaad590b04cd2e6a2230fe65b15b023b2ecff` |
| `sys_config` | 7 | config_id | `da172bba66c592ed77e73ce6a627f66c1235a7d65bac995d687d0857ea9a1482` |
| `sys_dept` | 31 | dept_id | `23615a04db0912b8333e660ff013050dbb79d96317ca66c01171094fb3fdfdd7` |
| `sys_dict_data` | 208 | dict_code | `386a15f3c4297d5ad43785236607c1c818d4e039bdac75bf1594699f6903ebc3` |
| `sys_dict_type` | 39 | dict_id | `55d712c7e07267e5db0a566288254ef20695793f72c30bcd05fe63bf8f42f460` |
| `sys_job` | 11 | job_id, job_name, job_group | `a40f4235e46a22a9fa8fe3d4e99134c2a71dc627904118bd2cbf00659d916fd9` |
| `sys_job_log` | 9 | job_log_id | `7fa2106b91119895afa36fd89be372e39e8758baa2eb5abb60b1e1b362db66b3` |
| `sys_logininfor` | 429 | info_id | `a9f8f4da566a811c1947ae449971925b7400e689abaddd4720b76296ea08b1cd` |
| `sys_menu` | 296 | menu_id | `66fdaac53ee71e3d866204d6b35e5347b9d005839f9b142b314bbc3d0a5015c1` |
| `sys_notice` | 2 | notice_id | `2e9e680d6a32d4992f2d99f60532de74c3915cc4c44a00220acaceb5ffd86277` |
| `sys_oper_log` | 1,476 | oper_id | `74c092149eeeec222a30a641f37c7cd4bee10bd7bd228195ef655a4395fcf368` |
| `sys_role` | 14 | role_id | `58a6b941950f3fc577452dfb5ef8000d733d9a0a6f6dbcea7bc6d563cdecfc3e` |
| `sys_role_dept` | 0 | role_id, dept_id | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `sys_role_menu` | 859 | role_id, menu_id | `fc5c75c8173ccda8a269e0c3633653ef26f9b2385c380c4da9c74dbb46b25039` |
| `sys_user` | 17 | user_id | `a5817c862c97d4b1ed4b235f7247591e2f970825cc98b762c95c7423383a5ad0` |
| `sys_user_post` | 3 | user_id, post_id | `d98f5329a1a6b11392cc3cbcc0def5e14755cd7462fadb7f08010ab4ecf5d570` |
| `sys_user_role` | 28 | user_id, role_id | `92201f9ff3ee443e3898657ea1c8541f5a5bc3294a53a90a2c8c1566e9d8468c` |
| `wb_account_balance` | 2,754 | ab_id | `d9352bea5e95d65d6922ddae6c21999830c81afa1d6f44d24a721a662ea4c3ae` |
| `wb_annual_contribution` | 3 | ac_id | `cf743da204cd9de4e1a9a4ea05c8ad6a96dcff1d71cb21713e9b40f2b9171778` |
| `wb_archives` | 1,767 | archives_id | `efd05f0c8dbcdffedc9d7d80cd320daec81a4568053298e4dba4864df6a726f8` |
| `wb_archives_list` | 30 | al_id | `9c4967cd5689078539a23a2f01d1a96bc197fe408d2ed370528db3709aa4481e` |
| `wb_archives_page` | 9,221 | ap_id | `cbeeb3201cde62c47780bbce0608a1c045de39d490b504937dce6469a1f4914c` |
| `wb_archives_page_copy1` | 8,363 | ap_id | `6c8da940d503261e55605f367da7e191180c46b1927ace3b81c82c213ea4d4b1` |
| `wb_attendance` | 4,883 | attendance_id | `34b32844f2464aaaa4211f239bded488a8b20de8dcb68dc28ede26ec5efab71f` |
| `wb_bank_account` | 22 | ba_id | `85e4d665577235663e2f365d96e8f00b4d463e56f4e0723a24f8326ce6345807` |
| `wb_career` | 213 | career_id | `00c8fe0c61762bfe744a5f0352fdf8fe01377e6f137476e8b0bc0e5d203237c5` |
| `wb_contact_message` | 18 | message_id | `7d2fb4dd4f71ce7d61694ce4b58c29cd70d03afdc2c797e5b9b95a5920a3d6b5` |
| `wb_contactman` | 1,594 | contactman_id | `c33cc6e7e08a5841b6eba6a1ab1c56c52127b233705ac047670aad0a69bcc8c7` |
| `wb_contactman_info` | 0 | contactman_info_id | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `wb_contract` | 1,595 | contract_id | `e074825dd73ed8accb5b07c497f2e00688870b3187ae4bfbfeb31b94dcdc5884` |
| `wb_employee` | 138 | employee_id | `3dde7a506b4248e659f0dbcc4fed3499d0957567238f41b012e9f106a21c5d47` |
| `wb_employee_post` | 169 | employee_id, post_id | `6a98e958aa1c62f6f77ca882d976fa96818d516b18525bdeb6c59b854da3f2af` |
| `wb_invoice` | 1,944 | invoice_id | `95e1c0959f4ceb4e7aa91b976fc008793783f43ac3a4877dd220c0feda0fbb0f` |
| `wb_markdown_file` | 0 | file_id | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `wb_markdown_folder` | 5 | folder_id | `af3a7a88855a4ac67b9d5e1768c6348e7ee9029ed8b2aac54bb606395522745b` |
| `wb_markdown_history` | 0 | history_id | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `wb_markdown_image` | 0 | image_id | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `wb_month` | 45 | month_id | `c640fa40458b1d6e6169a146a7f6177fdda860013657ebfa3755dd2a5020b2a2` |
| `wb_month_state` | 46 | ms_id | `579c617e534d043ea0826f8483c5e392921711959ae8b94b783f104d9288375b` |
| `wb_organization` | 762 | org_id | `91a1743224243545ddf4bf3153882629e0abbe73ddf41e53a66704e3d2e8a66a` |
| `wb_organization_info` | 0 | org_info_id | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `wb_pa_define` | 5 | pd_id | `22925089e841f3e9d5384e970e535459e48b5ec924f6444b8a9cd95eb3446175` |
| `wb_pa_record` | 182 | pr_id | `ff29c0b756904bb4c05bbcaebc2f2167ea4274b84ce781a4de17c6ca48394d3a` |
| `wb_payment_plan` | 15 | pp_id | `b4f5693372db721c44b34ac60bf7f35ef6007b6137ac1cd558131c233e4777d5` |
| `wb_post` | 13 | post_id | `00732445a08e0b7550d356137f7e82be1c78d6cdcab86140f534d808348bb6f5` |
| `wb_product` | 19 | product_id | `16e85a06903f7750eeedfe82859bbdcf480025a89d174851fd9ddd69d042624e` |
| `wb_product_version` | 0 | pv_id | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `wb_project` | 255 | project_id | `6d0ba33e474f9390628a0510e79125e86ab740f0d4ef4680db78a763d3e4e9ef` |
| `wb_project_contribution` | 53,792 | pc_id | `9b9bc9d930eea50647e462ccc8f08717746f4f189fc8eb5f1ad668ed9369fbd3` |
| `wb_project_income` | 3,169 | pi_id | `06392059002b4fdf82fe729a10c12d5b9114c5d78306bd6c792b0677f1d39b36` |
| `wb_project_member` | 1,684 | pm_id | `4d0d627e2a0debfd98f25475d2d3e26a972da5788f5a2d96fe361f0444dba782` |
| `wb_project_payment` | 4,233 | pp_id | `f60ee46b1ebcad69afb85e03b8080cdc8a3cce277debe9dc1f347719a749d849` |
| `wb_project_portion` | 0 | portion_id | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `wb_project_report` | 9,782 | pr_id | `3faf8142f7240c540d59aabe5a29c62d8bf5413e653a5dae413e3d78afcea105` |
| `wb_rank` | 13 | rank_id | `a6ea5c21ebd22f9302e4e23ab2bd9eb0bc3b8fd3fc74036d627fdaa978b88f7a` |
| `wb_repository` | 79 | repos_id | `b12cc57c7890a4f0a586902fc1569d686cd6b39987cfb5d1d098e48622c20293` |
| `wb_salary` | 4,690 | salary_id | `e5050a0e9f8da257605f9cc985e82aad2ef21be35fbf214785de66d3c4c88530` |
| `wb_salary_adjustment` | 0 | sa_id | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `wb_salary_bk_0919` | 3,660 | salary_id | `35bc7edd23c2c5279e9342cf9c07da0f241e47d08065f7a55b5ed949732b368e` |
| `wb_salary_copy1` | 3,166 | salary_id | `512ff344d94b93ca5690d8857f2d1f2a06d7e26d698727cd5392cb2f8d995e71` |
| `wb_salary_import` | 42 | si_id | `f24ced41fa08f663cc167b0a02a4cd9fe7218f50a53fd999fe868b9cc5d17c23` |
| `wb_salary_parameter` | 0 | sp_id | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `wb_solution` | 7 | solution_id | `862d1b1f12c49d47d2cd796edb5f243a07f36d75a5e2766c30bbfe732802bb67` |
| `wb_system` | 215 | system_id | `53cb59a8ec534a71036ab7c85ea55f7efb7f40e0a85783066576c24c9953ef8b` |

## 附录 B. 收支类型源字典

仅列系统字典标签，不含业务明细。目标导入保留 source_type/value/label；这些类型不能由资金 channel 替代。目标费用/收入分类映射在第二期合同冻结时确定。

| 字典 | 源值 | 标签 | 建议目标 |
| --- | --- | --- | --- |
| wb_income_type | `00` | 全款/一次性收入 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_income_type | `01` | 定金/预付款 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_income_type | `02` | 首付款 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_income_type | `03` | 阶段付款 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_income_type | `04` | 验收付款 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_income_type | `05` | 尾款 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_income_type | `06` | 维护费 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_income_type | `07` | 退款收入 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_income_type | `08` | 退税收入 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_income_type | `09` | 其他业务收入 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_income_type | `10` | 利息收入 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_income_type | `11` | 补贴 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_income_type | `12` | 资产处置 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_income_type | `13` | 投资款 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_income_type | `14` | 借款 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_income_type | `19` | 其他非业务收入 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_payment_type | `00` | 差旅费 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_payment_type | `01` | 业务招待费 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_payment_type | `02` | 销售费用 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_payment_type | `03` | 项目采购 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_payment_type | `04` | 人员薪资 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_payment_type | `06` | 奖励/提成 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_payment_type | `07` | 税费 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_payment_type | `09` | 其他业务支出 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_payment_type | `10` | 办公费 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_payment_type | `11` | 固定资产采购 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_payment_type | `12` | 管理人员薪资 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_payment_type | `13` | 管理人员奖励 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_payment_type | `19` | 其他管理费 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_payment_type | `20` | 银行手续费 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_payment_type | `21` | 利息支出 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_payment_type | `29` | 其他财务费用 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_payment_type | `14` | 房租 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_payment_type | `15` | 车辆费用 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_payment_type | `30` | 退款 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_payment_type | `05` | 福利费 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_income_type | `15` | 费用分摊收入 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_payment_type | `22` | 费用分摊支出 | 逐项建立类型映射；先保全原值，不自动并类 |
| wb_payment_type | `31` | 外协支出 | 逐项建立类型映射；先保全原值，不自动并类 |

## 附录 C. 证据索引与核验

旧源码根目录：`/Users/gavinzhou/Dev/Wiztek/WizBiz`；本轮只读相关 Java/Mapper，不读取本地配置、私钥或证书。省略路径均以前述源码根目录为基准。

- 客户/公司筛选与父链：`wb-crm/src/main/resources/mapper/crm/OrganizationMapper.xml:43–86`。
- 两套客户汇总：`wb-admin/src/main/java/cn/wiztek/web/controller/crm/OrganizationController.java:205–273`；`wb-quartz/src/main/java/cn/wiztek/quartz/task/WbTask.java:445–514`。
- 合同模型、金额汇总：`wb-pm/src/main/java/cn/wiztek/pm/domain/Contract.java:64–66,261–266`；`wb-pm/src/main/resources/mapper/pm/ContractMapper.xml:100–133,173–206`。
- 余额、创建/编辑语义：`wb-admin/src/main/java/cn/wiztek/web/controller/pm/ContractController.java:127–134,285–307`。
- 收支/发票合计：`wb-pm/src/main/resources/mapper/pm/IncomeMapper.xml:96–98`、`PaymentMapper.xml:85–87`；`wb-fm/src/main/resources/mapper/InvoiceMapper.xml:70–71`。
- 系统金额/维保关联：`wb-admin/src/main/java/cn/wiztek/web/controller/pm/SystemController.java:89–159`。
- 最近余额与新增/编辑：`wb-fm/src/main/resources/mapper/BalanceMapper.xml:24–36`；`wb-admin/src/main/java/cn/wiztek/web/controller/fm/BalanceController.java:83–103`。
- 当前源字典、全表行数/哈希、对账及环结果：远端 baseline-aggregate.json；敏感人工名单只在另一个 0600 文件。

核验：76 表主键完整、行数由单行 INSERT 累计，总计 122,600；原 SQL 加密后解密字节和哈希一致；再次检查目录/文件权限与明文不存在；公式结果从同一快照重复读取，人员姓名/工号冲突按失败关闭处理。文档检查仅涉及本文件，不执行应用测试或数据库写测试。未提交、未推送。
