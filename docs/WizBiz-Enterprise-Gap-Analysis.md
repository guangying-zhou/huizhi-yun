# WizBiz → Enterprise APF 差距分析

日期：2026-10-04。状态：只读分析，供产品负责人和协调者审阅；生产发布暂缓。

## 1. 发布底线与结论

现有 Enterprise 不能直接接收并完整保留 WizBiz 的客户、合同、银行账号资料。主要阻断不是所有功能都缺失，而是：**旧迁移器目标模型不兼容统一表；部分历史字段无承载；原始账号只有掩码会丢失；关联和历史缺正式迁移链；页面不能完整展示既有关系与金额口径。**

至少先完成客户/联系人、合同及其客户/项目/主体/账户关系、资金账户和全部余额历史的无损承载、迁移与验收，再讨论生产发布。“迁移成功”不应仅按HTTP200或新增行数判断，而应逐源行字段与关系可追溯，金额/余额对账，账号可经授权恢复且不泄露。

已存在的结构不能误报为缺表：`altoc_customer.parent_customer_id`、`altoc_contract.parent_contract_id`、`finance_account_balance_snapshot` 已有；缺的是可靠导入、必要历史字段及页面呈现。联系人子表、合同多项目关系、正式发票和收款也已有模型，仍需适配。

## A. 迁移底线：逐字段无损承载

以下第 2–7 节讨论现有数据的承载与迁移。第 B 层另列目标模型建议；建议尚未成为已批准的 schema 或功能。

## 2. 依据及可信度

- 源DDL：`etc/wizbizdb.sql`、`align/docs/wizbizdb20260418.sql`，均76张表；逐表字段/类型/注释比对，业务表结构一致。两份均无INSERT语句，不能推导行数或空值率；AUTO_INCREMENT只是序号水位，不是行数。
- 源业务菜单和现场字段：本任务书由协调者取得的WizBiz菜单；本轮未登录OA。销售合同/合同台账/维保合同菜单不代表三张独立表。两份DDL只有`wb_contract`主合同表；维护关系由`contract_type`、`wb_system.maint_ids`等参与，菜单具体筛选规则待核查。`ancestors`存在客户组织表，**不在wb_contract**，合同树用parent_id。
- 目标：`docs/Enterprise-APF-Domain-Design.sql`；安装清单`data-runtime/internal/enterprise/domaininstall/apf_*.json`、`altoc_*.json`、`finance_*.json`；当前Host组件和固定操作。只分析仓库实现，不声明生产已安装全部子集。
- 历史方案：`altoc/docs/OA-WizBizDB-Marketing-Migration-Plan.md`（2026-05-15）和`altoc/docs/migrations/002_wizbizdb_marketing_compat.sql`，目标是旧独立库，不能视为本次统一表迁移设计。
- 源业务代码：只读检查 `/Users/gavinzhou/Dev/Wiztek/WizBiz` 中相关 Controller、Mapper 与调度方法；不读取本地配置、证书或私钥。计算证据见第 3.2 节。
- 当前迁移代码：`data-runtime/internal/migrations/wizbiz/incremental.go/config.go`；Finance import/status路由与Runtime handler。

### 2.1 实体与菜单归属

| WizBiz对象 | 源表 | Enterprise归属与主要差距 |
| --- | --- | --- |
| 客户/集团/公司资料 | wb_organization、wb_organization_info | altoc_customer；公司法人资料不能与客户/部门混为一谈，历史变更表缺对应 |
| 联系人及历史 | wb_contactman、wb_contactman_info | altoc_contact；备用手机已有，星级/档案/历史缺承载 |
| 销售合同/合同台账/子合同 | wb_contract | altoc_contract、party、project_link；parent结构已有，三种金额和账户/系统引用不完整 |
| 维保合同/运行系统 | wb_contract(type=5候选)、wb_system | altoc_maintenance_contract/服务协议有新模型，但旧系统台账与多合同列表不等价；需确认菜单筛选 |
| 项目 | wb_project | Aims owning项目和Altoc关联，不能把旧项目统计列全塞APF合同 |
| 资金账户/余额 | wb_bank_account、wb_account_balance | finance_bank_account、balance_snapshot；原始账户须保险箱；法人/简称/行号缺字段 |
| 发票 | wb_invoice | finance_invoice；公司/档案页/历史来源、旧正式票迁入条件需补 |
| 收款/收入 | wb_project_income | finance_receipt、reconciliation、unclassified_income；跨支出引用/非合同分流缺迁移 |
| 支出 | wb_project_payment | 未发现完整的Finance费用/付款主账模型；当前expense_type只是字典，不是支出表 |
| 付款计划 | wb_payment_plan | 无组织级对外付款计划对应；Altoc billing_schedule是经营结算计划，不能替代 |
| 档案/附件 | wb_archives、wb_archives_page、wb_archives_list | Codocs/Assets文件引用需另定；只有关联引用不代表文件已迁 |
| 产品关联 | wb_product | 关联Assets/Aims产品；不复用旧数值ID，保留来源关系 |

## 3. 逐字段映射的读法

附录A每行列源字段、SQL类型、DDL含义、目标及差距。`能映射`指结构有相应字段，**不代表已有可执行统一表导入**。`需转换`必须解决编码、枚举、金额语义、日期/身份/关系；`缺失`指没有等价字段或历史对象。

源ID必须通过稳定的(source_system, source_table, source_id)映射到目标ID/code，不能与当前目标主键混用。APF的service_command_receipt、integration_operation等共享账本不等价迁移映射表。建议新增受控迁移来源台账/历史扩展；下文提及的承载方案均是建议，未实施。

全部有值的缺失源字段均列为**迁移必需**，不得用“暂时页面不用”作为丢弃理由。页面筛选、统计重算、可视化可另列功能增强；源汇总历史仍要保存并标注日期，即使未来展示派生值。

### 3.1 五个必须明确的转换

1. 客户层级：先导入客户、后回填parent，检查循环/孤儿/跨租户；ancestors从目标层级派生，但保存原祖链用于对账。org_type 的非客户记录不能被默认筛选静默丢掉，公司资料单独归类。
2. 合同树：保留原合同号和源ID，parent按映射回填；不能把主合同和子合同金额相加造成重复收入。is_master_contract需据源业务规则确认，不能只见子节点就自动指定。
3. 金额：total_amount 是合同总额；prime_amount 的 DDL 含义为有效金额，不能当作未税额。源码确认 invoice_amount 是剩余未开票金额，exec_amount 是剩余应收/应付金额，DDL 的「已开/已执行」注释具有误导性；两列均不得直接映射成新 Finance 的已开票额或核销额。源币种未声明，不能仅凭工具默认CNY认定。目标amount_tax_inclusive由合同行维护，历史合同无行时需要受控历史导入合同，禁止伪造商品行或审批使金额凑平。
4. 账号：account_number必须完整迁入受保护存储，统一表只留secret_ref和掩码；不在日志/报告/普通列表输出。银行行号、账户简称、法人所属、序号不得丢；org_id不是owner_dept_code。
5. 身份与日期：旧employee_id/operator_id通过核对映射到当前Directory UID，失效/缺映射留异常队列，不默认负责人；原DATETIME转DATE会丢时间须额外保留。不为历史导入伪造Workflow批准记录、当前经理关系或人员授权。

### 3.2 业务源码核实后的金额和余额口径

路径均相对于旧 OA 源码根目录；本轮只读源码和数据库统计，不调用会写缓存的旧 OA 页面接口。

| 对象 | 源码位置 | 实际口径与迁移要求 |
| --- | --- | --- |
| 合同执行余额 | `wb-admin/src/main/java/cn/wiztek/web/controller/pm/ContractController.java:127–136` | GET 详情以总额减支出（type=0）或收入（其他类型）回写 exec_amount。因此是剩余应付/应收，不能称已执行额；保留原缓存值并用对应明细对账。 |
| 合同开票余额 | 同上；创建初始化见 `:288–292` | invoice_amount=total_amount−逐合同发票合计；创建时初始化为总额。新 Finance summary 的 invoice_amount 是已开票额，两者语义相反。不能按同名列迁入。 |
| 客户合同额 | `wb-pm/src/main/resources/mapper/ContractMapper.xml:173–195` | sumContractAmount 汇总 prime_amount。总额与有效额不能合并；有效额具体商业含义仍需产品确认。 |
| 客户直接/汇总应收 | 同文件 `:109–133`；`wb-admin/.../crm/OrganizationController.java:205–273` | 直接应收汇总正常合同的 exec_amount；详情里的 sumAll 又按项目 org_id 取合同 total_amount，并非严格的客户子树汇总。 |
| 客户子树汇总 | `wb-quartz/src/main/java/cn/wiztek/quartz/task/WbTask.java:445–514` | 定时任务递归汇总下属客户的 sumTotal；与详情更新路径不同。同一缓存字段可能由两套算法写入；先保留源快照，目标应将「本客户/含下属」「总额/有效额」「剩余应收」分别命名。 |
| 当前账户余额 | `wb-admin/.../fm/BalanceController.java:83–103`；`wb-fm/src/main/resources/mapper/BalanceMapper.xml:24–36` | 新增先更新银行账户 balance/check_date，再插余额历史；编辑只更新历史，未见同步 bankAccount 的调用。历史最近值按 check_date、operate_time 排序；账户缓存与历史不能假定始终一致。 |

原 OA 的详情 GET 存在写缓存副作用。后续「只读核查」应继续用 SELECT/SHOW，不以访问旧详情接口代替只读。

## 4. 现有迁移工具覆盖及复用边界

| 工具/入口 | 当前事实 | Enterprise复用结论 |
| --- | --- | --- |
| wizbiz增量CLI | config默认源wizbizdb，目标hzy_altoc/hzy_finance；specs为customers/contacts/contracts/bank-accounts/account-balances/invoices/receipts/unclassified-income/expenses，共9族 | 可复用来源ID、批次、日期读取、dry-run对比思路和单元夹具；不能仅改库名直接运行 |
| Altoc旧兼容SQL002 | 对旧customer/contact/contract等表加legacy字段/统计/refs；含旧财务暂存兼容结构 | 不是统一表安装SQL，不应原样装入hzy_enterprise |
| Finance import.post.ts | 委托Runtime；Runtime write_endpoints.go:173对该命令明确unsupportedCommand | **不是现成可用导入通道**；不得看到路由存在就称支持 |
| Finance status.get.ts | Runtime MigrationStatus查询finance_migration_map及批次 | 新APF清单没有该迁移映射表；也不是新模型导入的证明 |

具体损失风险（incremental.go）：customers仅org_type=1；负责人有硬编码fallback和手工映射；contract把direction固定sales/primary_type固定legacy_contract，未恢复父合同；旧表名customer/contact/contract与altoc_*不符。owner_user_id等旧字段与owner_uid不符；filterColumns(:534/:922)会按目标实际列静默过滤，可能丢prime_amount、legacy_refs_json、star_level；preload又假定旧表和legacy/code格式。不能以“列不存在就略过”实现完整迁移。

bank-account只写掩码，不写account_no_secret_ref；balance使用source_type=migration，而现APF页面/合同枚举manual/import/api，应显式转为import。收入channel源DDL为0现金/1银行/2第三方，而旧normalizeReceiptChannel按1现金/2银行/3第三方解释，须按实际源字典核验后修订，不能沿用。expenses目标finance_expense，统一设计未对应；组织付款计划、公司档案、联系人/组织历史、项目、系统不在9族完整覆盖内。

推荐另做 **WizBiz→Enterprise统一表专用plan/apply/verify/rollback工具**：固定来源只读、受保护目标profile、Registry代际/安装子集验证，精确字段覆盖检查（任何有值但无映射的字段使plan阻断），源ID映射+原始历史保全、分批幂等/断点恢复和批次审计；目录身份只读映射，凭据隔离。离线归档与外部账号保险箱写入需独立批准。所有回滚仅按本批新增对象/记录及不可变批次证据，已有数据被引用后不得硬删。

## 5. 获批只读统计与剩余核查

用户授权后，在 oa.wiztek.cn 使用主机已有的 WizBiz 应用账号执行 SELECT/SHOW。凭据仅在主机进程内加载并写入 0600 临时 defaults-extra-file，用后删除；未回显、未复制到本机、未写报告，未读取行级个人资料或银行账号。MySQL 版本为 **8.0.45**，统计记录时刻为 **2026-10-04 17:17:04 UTC**。逐项查询不是同一事务的封存快照，数字用于盘点，不能直接作为正式迁移 checksum。

### 5.1 当前行数

| 源表 | 当前行数 |
| --- | ---: |
| `wb_organization` | 762 |
| `wb_organization_info` | 0 |
| `wb_contactman` | 1,594 |
| `wb_contactman_info` | 0 |
| `wb_contract` | 1,595 |
| `wb_system` | 215 |
| `wb_project` | 255 |
| `wb_bank_account` | 22 |
| `wb_account_balance` | 2,754 |
| `wb_invoice` | 1,944 |
| `wb_project_income` | 3,169 |
| `wb_project_payment` | 4,233 |
| `wb_payment_plan` | 15 |
| `wb_archives` | 1,767 |
| `wb_archives_page` | 9,221 |
| `wb_archives_list` | 30 |
| `wb_product` | 19 |

17 张源表的列名与所读 DDL 清单一致。2026-05-15 历史方案记载客户 751、联系人 1,582、合同 1,530、银行账户 20、余额 2,494，均不能替代本次实测。

### 5.2 关键空值率

NULL 与非 NULL 空白字符串分开统计；百分比以该表全部行为分母，四舍五入到一位。缺关联不等于孤儿：孤儿统计仅对非 NULL、非 0 的外键值执行。

| 表.字段 | NULL 数 / 比例 | 空白字符串数 / 比例 | 对迁移的影响 |
| --- | ---: | ---: | --- |
| `wb_organization.ancestors` | 762 / 100.0% | 0 / 0.0% | 不能据祖链缓存恢复层级，应以 parent_id 为准 |
| `wb_organization.contactman_id` | 8 / 1.0% | 不适用 | 主联系人允许历史缺失 |
| `wb_organization.count_recerivable` | 236 / 31.0% | 不适用 | 保留缺失，不以 0 冒充历史应收 |
| `wb_contactman.org_id` | 721 / 45.2% | 不适用 | 大量联系人未绑定客户，不能全部强制丢弃 |
| `wb_contract.contactman_id` | 227 / 14.2% | 不适用 | 允许历史缺联系人并单列孤儿 |
| `wb_contract.prime_amount` | 130 / 8.2% | 不适用 | 不能将 NULL 等同总额或 0 |
| `wb_contract.ba_id` | 1,586 / 99.4% | 不适用 | 账户关系大多缺失，不自动补账户 |
| `wb_contract.impl_project_id` | 1,591 / 99.7% | 不适用 | 不虚构实施项目 |
| `wb_bank_account.bank_code` | 13 / 59.1% | 0 / 0.0% | 保留缺失及后续补录 |
| `wb_bank_account.balance` | 1 / 4.5% | 不适用 | 不能自动置 0 |
| `wb_invoice.company_id` | 1,944 / 100.0% | 不适用 | 源开票主体均未填写，不伪造公司 |
| `wb_project_income.channel` | 1,408 / 44.4% | 0 / 0.0% | 不自动按银行渠道分类 |
| `wb_project_income.contract_id` | 993 / 31.3% | 不适用 | 需要非合同收入承载 |
| `wb_project_payment.contract_id` | 4,233 / 100.0% | 不适用 | 不能要求全部支出先绑定合同 |
| `wb_archives_page.ap_url` | 6,241 / 67.7% | 0 / 0.0% | 未验证可下载；不能将档案页行数当文件数 |

### 5.3 重复、关系、枚举与金额

- 客户名称、合同编码、银行账号、银行简称：各自重复组数均为 **0**；这不是姓名/账号值的输出。
- 余额同账户同日有 **319** 个重复组，其中 **226** 组金额不同。目标唯一键 `(bank_account_id,snapshot_date,source_type)` 无法直接无损承载全部原始行，须增加来源流水/历史承载，再选定当日展示值；不允许任选一笔覆盖。
- 合同联系人引用有 **29** 条孤儿；客户父节点、联系人客户、合同父节点/客户/项目/账户、余额账户、发票合同的所查非空非 0 引用孤儿数均为 **0**。客户与合同自指父节点均 **0**；未查完所有多层环，不能据此声明无环。
- org_type=1 有 **757** 行，type=0 有 **5** 行；旧迁移器只取 1 会跳过后者。后者是否对应公司资料须与公司页面筛选规则确认，不擅自当作客户。
- contract_type：1/2/3/4/5/6/8/9 分别 **453/185/28/860/2/16/47/4** 行；8/9 超出所读 DDL 注释范围，须确认字典。contract_status=0/1/2 分别 **1,574/1/20** 行。
- 银行类型 0/1/2/3/4 分别 **5/10/2/1/4** 行，状态 0 为 **22** 行；不能仅导入普通银行类型。收入渠道 0/1/2/NULL 分别 **302/1,455/4/1,408** 行，旧工具错位枚举转换不能复用。
- 超过目标 200 字符的客户/合同名称各 **0**；合同签署日期有 **44** 条、发票日期有 **6** 条带非零时间分量。转 DATE 时仍需来源历史保全。
- 非正收入/支出/发票金额分别 **13/41/1** 条；不能靠正数校验直接丢行，需区分冲销、退款、零值历史。

下表为全表 Decimal 原始合计，混合类型、状态和父子合同，**不是经营 KPI，也不是余额对账通过的证明**。单位与币种仍需业务确认；不能把合同余额缓存和跨合同明细总额直接相减。

| 汇总列 | 原始合计 |
| --- | ---: |
| `wb_contract.total_amount` | 230175363.73 |
| `wb_contract.prime_amount` | 213141774.92 |
| `wb_contract.invoice_amount` | 30404350.12 |
| `wb_contract.exec_amount` | 19908784.22 |
| `wb_invoice.amount` | 192625792.51 |
| `wb_project_income.amount` | 205533558.21 |
| `wb_project_payment.amount` | 22370130.39 |
| `wb_project_payment.charge` | 0.00 |

### 5.4 尚未核查的门禁

1. 账户缓存与最近余额行的差异；合同余额逐合同对账，父子合同去重的经营统计口径。
2. 客户/合同多层环、主体/系统/档案引用、组合字符串关系格式、原始文件存在性与 hash；未获取文件内容。
3. 全部旧员工与 Directory UID 的映射率和失效状态；本轮没有查询其他业务库的个人记录。
4. 公司页面、type=8/9 与银行类型的实际字典；币种、时区、prime_amount 定义。
5. 正式迁移前冻结同一来源快照，并重新统计；迁移阶段的账号、附件、目标写入、保险箱写入均须另行授权。

## 6. 页面与操作差距

| 场景 | 已有Enterprise能力 | 未达到原OA的部分 | 性质 |
| --- | --- | --- | --- |
| 客户 | 列表/详情、新建编辑、负责人/联系人 | 集团树、直接/含下属合同和应收统计、主联系人、信息完整度、历史版本呈现 | 层级/历史与迁移展示必需；评分算法增强 |
| 合同 | 多合同行、条款/履约、签署生效、项目关联、Finance摘要 | 合同台账树、有效/执行金额区别、公司/开户账户/系统引用、旧档案、历史合同不经重新审批展示 | 迁移必需 |
| 维保 | 服务协议/覆盖/工单/续约，旧维保只读 | 原系统台账、旧多维保合同关系、历史统计/到期条件与新权益模型一致性 | 关系保全必需；新流程增强 |
| 资金台账 | 银行账户、余额历史列表；Finance正式发票/收款核销 | 账户法人、简称/行号/顺序，原账号授权可用性，账户余额核对/现金流/支出付款计划 | 资料/余额必需；分析页面可后续 |
| 项目台账 | Aims项目和Altoc合同关联 | 旧项目树及财务/成本/合同汇总口径，实施与销售项目双关联 | 关系/历史必需；新派生报表增强 |
| 公司/档案 | Console组织/企业、Codocs与附件引用 | 无同等旧公司资料/档案历史迁移方案；不应自动写Console身份 | 资料保全必需 |

页面未发现父客户/父合同树编辑展示，不等于schema不存在。资金余额已有分页读取，不能称完全没余额功能；缺原账户核对操作和完整资料。菜单行为来自任务书而非本轮交互验收，主要金额公式已按第 3.2 节核实；完整按钮交互仍需原页面验收，本文不声明逐按钮实测。

## 7. 达到底线的工作包与估算

估算为熟悉仓库的一名工程师人日区间，包含隔离测试与审查修订，不包含用户决策、数据清理等待、生产窗口。需要实际数量/字典核查后复估，不能当作上线承诺。

| 顺序 | 工作包 | 交付及门禁 | 估算 |
| --- | --- | --- | ---: |
| W0 | 源数据/字典/公式冻结 | 当前只读统计、关系与异常清单；确定公司/合同金额/账号存储 | 2–4 |
| W1 | 无损模型增补 | 独立历史/来源映射、缺字段/关系、公司/银行资料、金额快照；仅增不删安装/verify/rollback | 4–7 |
| W2 | 核心三类专用迁移 | 客户+联系人+层级，合同+父链+关联，账号+余额；plan/幂等/范围/批次/异常/回滚，受控vault接线 | 8–12 |
| W3 | 核心页面补齐 | 客户层级/联系人、合同树与金额/主体/账户、账户资料与历史对账，权限与字段白名单 | 5–8 |
| W4 | 演练与切换验收 | 同一封存快照全量迁移，字段/关系/金额/hash比对，失败恢复、增量差集、回滚演练 | 3–5 |
| 后续 | 发票/收入/支出/计划/系统/档案完整运营迁移 | 费用付款模型、非合同收入、附件、历史不伪造审批，新旧对账 | 另10–18 |

核心底线约22–36人日；可并行schema与UI，但W0口径必须先冻结，不能先做导入再决定丢哪些字段。若用户要求所有OA财务操作同时替代，须把后续包纳入发布范围，不以三个主档导入冒充完整OA替代。

发布验收：所有源客户/合同/银行账户逐ID可追溯（包括归档对象）；联系人/层级/子合同/项目/账户关系不丢；账号完整受保护可用且普通接口不泄露；余额每笔历史不丢，重复冲突均有决定；源金额和新派生汇总差异可解释；未知枚举/负责人未映射不默认放行；重复apply无重复，失败可恢复，回滚不删既有记录。

## 8. 需要用户决定的问题

1. 发布底线包括全部组织（客户/经销商/供应商/本公司）、联系人变更历史与档案文件，还是先只保证核心主档？未选范围的有值字段不能静默删除。
2. prime_amount 的有效金额定义、客户详情与定时任务两套汇总中哪套应成为目标口径？exec_amount 已核实为剩余应收/应付，不再按已执行额解释。以源历史快照保全后另派生，还是要求新页面立即重算一致？
3. 公司主体/银行所属org应存独立业务公司目录还是引用Console企业？后一方案涉及控制面写入，须另定授权。
4. 历史合同如何绕开“重新签署生效”副作用而保存真实原状态、金额？需要受审历史导入lane，不允许伪造Workflow结果。
5. 银行原账号通过何种受保护存储迁入，谁可查看/使用，账户类型与余额同日冲突如何保留？现有secret_ref字段不代表已有导入合同。
6. 旧有效人员缺Directory UID时保留历史显示还是要求人工匹配？不能以默认管理员接管客户/合同责任。
7. 是否一期替代发票、收入、支出、付款计划和维保系统全操作？这些明显超出“客户/合同/银行账号完整迁移”主档底线。

### 8.1 用户决定（2026-10-04，按协调者建议）

1. 范围：全部组织（客户/经销商/供应商/本公司）、联系人与组织历史、档案引用等**有值字段全部保全来源记录、零丢失**；一期页面只覆盖核心主档（客户/联系人/合同/银行账号与余额）。
2. 金额口径：源汇总与金额缓存作为“迁移快照”原样保存并标注日期；新页面按新口径从事实派生，与快照差异须可解释。prime_amount 业务含义在 W0 由源码/样本核定后写入合同。
3. 本公司主体：建立独立的业务法人主体目录（Enterprise 内），不写 Console 企业/控制面。
4. 历史合同：建设受审“历史导入”通道，保留原状态与金额，不触发签署/生效副作用，不伪造 Workflow 记录。
5. 银行原账号：完整存入受保护凭证存储（vault），统一表只存 secret_ref 与掩码；仅财务管理员可查看。
6. 未映射人员：保留历史显示名；仍在负责的客户/合同进入人工匹配队列，不默认转给管理员。
7. 一期范围：核心主档无损迁移 + P1 中的应收账龄与收款分配；发票/收入/支出/付款计划/维保系统完整运营迁移排第二期（但其源数据一期即全部保全来源记录）。

## B. 目标模型建议：面向中小型软件企业的经营闭环

本层是建议，不是本轮实施授权。老 OA 提供汇智现有用法与数据底线，目标模型应复用 Enterprise 已有的合同行、履约、核销、caller-Tx 和可靠投递，不照搬旧缓存，也不另建一套大型 ERP。P0 为迁移与发布必需，P1 为近期经营闭环，P2 为有实际需求后再做。

### B.1 推荐模型与当前 APF 的调整点

| 优先级 | 对象 / 闭环 | 当前模型基础 | 建议增补及产品口径 |
| --- | --- | --- | --- |
| P0 | 客户、联系人、集团 | customer.parent、contact 和归属已有 | 保留客户树、主联系人、历史归属与原始来源；将法人主体、客户分组与部门区分。来源台账保全旧字段，不把所有历史缓存变成长期业务列。 |
| P1 | 客户关系图 | 客户父子关系、联系人已有 | 第一阶段只做有类型的客户关联与联系人角色，支持集团、采购方、使用方、付款方；关系不隐式授予访问。先做表格/树，不必先做复杂图谱编辑器。 |
| P0/P1 | 合同金额和补充协议 | parent、多行、付款条款、履约义务已有 | 原始签约总额、有效金额、当前合同额分别存定义；变更用可审计版本/补充协议与生效日期，不覆盖历史。主子合同明确「汇总容器/独立金额」关系，不能默认父子求和。 |
| P1 | 商机→合同→履约→开票→回款 | 主链和 Finance 核销已有 | 沿用共享事务的关联，明确合同条款到里程碑/结算计划的归属。开票和回款分别记录，收款可跨多个应收项分配；剩余款、开票余额由事实派生。 |
| P1 | 应收账龄 | billing_schedule、invoice、receipt、reconciliation 已有 | 应收项需有应付到期日、原金额、已核销、未结余额、币种及来源。账龄按到期日和查询日期计算，不能用合同 due_date（合同到期）替代款项到期，也不能凭已开票就认定所有款项到期。 |
| P0/P1 | 资金账户与银行对账 | account、balance_snapshot、reconciliation 已有 | 原始账户入保险箱，补主体/简称/行号；保全所有余额历史。P1 引入独立银行流水和对账分配，区分账面余额、银行余额、未达项；余额快照不是资金流水，不可据其增减伪造收支。 |
| P0/P1 | 多主体公司 | 业务 party 与 Console 企业不同 | 为本公司法律主体提供业务目录，合同签约主体、开票主体、资金账户主体明确关联。一个业务租户可有多个公司，不能为每个公司自动创建 Console 租户；部门和产品线不等同法律主体。 |
| P1 | 支出、付款与付款计划 | expense_type 不是费用主账，组织付款计划缺对应 | 优先补满足原业务的支出/付款事实及对账引用，规划与实付分开，退款/冲销保留原键。是否引入会计凭证/总账另行决策，不以收入表反向金额替代支出。 |
| P1 | 汇总与看板 | 新摘要、旧缓存并存 | 显式展示口径/币种/统计日期：客户直接与含下属、签约额与有效额、应收与逾期、已开票与未开票；权限不足不能泄露汇总数量或金额。历史缓存标为迁移快照，不能与实时派生值混用。 |
| P2 | 多币种、订阅、自动匹配 | currency 与服务协议可扩展 | 先保留源币种事实；汇率、生效时间、跨币种核销、订阅账单及银行自动匹配仅在业务确需时设计。不在此次主档迁移强行加入完整 CPQ、总账或 MRP。 |

### B.2 成熟产品参考与适用范围

- Salesforce 的 Account Hierarchy 采用账户层级作为客户关系的一种呈现方式；HubSpot 允许关联公司、联系人、交易等记录。建议采用「层级 + 有类型的关联」，不把所有关系编码进 parent_id。Enterprise 的字段和访问边界仍按本仓库合同设计。参考：[Salesforce 账户层级](https://help.salesforce.com/s/articleView?id=sf.account_hierarchy_setup.htm&language=en_US&type=5)、[HubSpot 记录关联](https://knowledge.hubspot.com/records/associate-records)。
- Salesforce 的合同修订说明强调修订生效时间及已有修订的顺序。可借鉴可追溯的变更事件；是否禁止追溯生效属于用户业务规则，本报告不直接照搬厂商限制。参考：[Salesforce 合同修订限制](https://help.salesforce.com/s/articleView?id=000380518&language=en_US&type=1)。
- Odoo 的付款条款支持分期到期日，银行对账支持银行交易与会计记录的匹配。对本项目的推论是：应收款项到期与合同到期必须分开，余额快照与逐笔对账必须分开。参考：[Odoo 付款条款](https://www.odoo.com/documentation/18.0/applications/finance/accounting/customer_invoices/payment_terms.html)、[Odoo 银行对账](https://www.odoo.com/documentation/19.0/applications/finance/accounting/bank/reconciliation.html)。
- Odoo 的多公司模型支持同一数据库内多个公司，且不建议仅因新增产品线就创建公司。这支持本报告区分法律主体与部门/产品线的建议；不是对 Enterprise 控制面做任何变更的授权。参考：[Odoo 多公司](https://www.odoo.com/documentation/19.0/applications/general/companies/multi_company.html)。

本轮未逐项核查纷享销客、销售易、用友/金蝶的当前产品合同，不据品牌名称声称功能等价。上述建议同时来自已核实的 APF 结构与汇智旧 OA 用法；厂商材料只为模式参考。

### B.3 建议决策顺序

1. 先批准 A 层字段保全和金额口径，关闭会静默丢字段的迁移路线；正式导入前演练同一封存快照。
2. P0 优先补来源台账、余额重复历史、账号保险箱、公司主体与历史合同导入，不以大量新增业务字段取代来源保全。
3. P1 按「合同金额变更 → 应收到期/账龄 → 收款分配 → 银行流水对账 → 经营汇总」逐包实施；每包先明确单一事实源、负数/冲销、重放和权限矩阵。
4. B 层估算独立于第 7 节的迁移底线人日；用户选择具体 P1 包后再估算，避免把建议范围混入迁移工期。

## 附录 A. 源字段清单与逐字段映射

共 17 张表、314 个源字段；末两列为本轮实测 NULL/空白统计，零行表不计算比例。SQL类型和含义从两份相同源DDL提取；未注释字段标明待确认，不猜测业务。所有缺失均为迁移必需的保全缺口；保全台账不是现有表。目标枚举/关系须按第3节转换，源主键不得直接占用目标主键。Aims/Assets/Codocs关联是跨域建议，需 owning 合同核对，非APF已有导入。

### wb_organization

| 字段 | SQL类型 | 含义（源DDL） | 目标/承载 | 分类 | 处理与缺口等级 | NULL 数 / 比例 | 空白数 / 比例 |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| `org_id` | bigint | 组织ID | altoc_customer.id | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 0 / 0.0% | 不适用 |
| `parent_id` | bigint | 父组织ID | altoc_customer.parent_customer_id | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 0 / 0.0% | 不适用 |
| `ancestors` | varchar(50) | 祖级列表 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 762 / 100.0% | 0 / 0.0% |
| `order_num` | int | 显示顺序 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `org_name` | varchar(255) | 名称 | altoc_customer.name | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 0 / 0.0% |
| `short_name` | varchar(30) | 简称 | altoc_customer.short_name | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 0 / 0.0% |
| `org_type` | char(1) | 类型（1客户 2经销商 3供应商)；实测含0 | 客户分类映射；type=0 的主体另定 | 需转换 | 不直接将0/1写为目标类型ID；非客户5行不能丢弃。 | 0 / 0.0% | 0 / 0.0% |
| `employee_id` | bigint | DDL 未注明；业务含义待确认 | altoc_customer.owner_uid | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 0 / 0.0% | 不适用 |
| `contactman_id` | bigint | 联系人ID | altoc_contact.customer_id（反向关系）；无主联系人引用 | 需转换 | 联系人子表可迁，但客户主联系人指定关系另补；不能只反向挂客户就称无损。 | 8 / 1.0% | 不适用 |
| `contactman` | varchar(30) | 联系人 | 无客户联系人文本快照 | 缺失 | 与正式联系人ID并存，应保留原自由文本而非擅自合并。 | 8 / 1.0% | 0 / 0.0% |
| `telephone` | varchar(20) | 联系电话 | altoc_customer.telephone | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 8 / 1.0% | 0 / 0.0% |
| `level` | int | 等级 | altoc_customer.customer_level_id | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 不适用 |
| `province` | varchar(20) | 省/直辖市 | altoc_customer.province | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 0 / 0.0% |
| `city` | varchar(20) | 地市 | altoc_customer.city | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 0 / 0.0% |
| `web_site` | varchar(255) | 网址 | altoc_customer.website | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 754 / 99.0% | 0 / 0.0% |
| `weixin_number` | varchar(255) | 微信公众号 | altoc_customer.wechat_official_account | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 760 / 99.7% | 1 / 0.1% |
| `description` | varchar(255) | 单位简介 | altoc_customer.description | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 761 / 99.9% | 0 / 0.0% |
| `org_status` | char(1) | 状态（0正常 1删除) | altoc_customer.status | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 0 / 0.0% | 0 / 0.0% |
| `start_date` | date | 起始日期 | altoc_customer.started_at | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 8 / 1.0% | 不适用 |
| `count_all` | int | 总合同数（含下属单位） | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `sum_all` | decimal(12,2) | 全部合同额（含下属单位） | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `count_total` | int | 总合同数 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `sum_total` | decimal(12,2) | 总合同额 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `count_three` | int | 近三年合同数 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 5 / 0.7% | 不适用 |
| `sum_three` | decimal(12,2) | 近三年合同额 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `count_year` | int | 一年内合同数 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 5 / 0.7% | 不适用 |
| `sum_year` | decimal(12,2) | 近一年合同额 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `count_current_year` | int | 当年合同额 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 5 / 0.7% | 不适用 |
| `sum_current_year` | decimal(12,2) | 当年合同额 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `count_recerivable` | int | 应收款合同数 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 236 / 31.0% | 不适用 |
| `sum_all_receivable` | decimal(12,2) | 总应收款 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `sum_receivable` | decimal(12,2) | 应收款 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `archives_id` | varchar(36) | 档案ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 737 / 96.7% | 0 / 0.0% |
| `operator_id` | bigint | 用户ID | altoc_customer.updated_by | 需转换 | 保留原操作者ID/时间；历史人员映射，不伪造当前操作审计 | 0 / 0.0% | 不适用 |
| `operate_time` | datetime | 操作时间 | altoc_customer.updated_at | 需转换 | 保留原操作者ID/时间；历史人员映射，不伪造当前操作审计 | 0 / 0.0% | 不适用 |

### wb_organization_info

| 字段 | SQL类型 | 含义（源DDL） | 目标/承载 | 分类 | 处理与缺口等级 | NULL 数 / 比例 | 空白数 / 比例 |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| `org_info_id` | bigint | 组织信息ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 不适用 |
| `org_id` | bigint | 组织ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 不适用 |
| `up_org_id` | bigint | 上级组织ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 不适用 |
| `name` | varchar(255) | 名称 | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 无行 |
| `short_name` | varchar(30) | 简称 | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 无行 |
| `type` | char(1) | 类型（1客户 2经销商 3供应商) | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 无行 |
| `web_site` | varchar(255) | 网址 | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 无行 |
| `weixin_number` | varchar(255) | 微信公众号 | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 无行 |
| `description` | varchar(255) | 单位简介 | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 无行 |
| `archives_id` | bigint | 档案ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 不适用 |
| `employee_id` | bigint | 业务员ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 不适用 |
| `operator_id` | bigint | DDL 未注明；业务含义待确认 | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 不适用 |
| `operate_time` | datetime | 操作时间 | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 不适用 |
| `change_time` | datetime | 变更时间 | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 不适用 |
| `change_note` | varchar(255) | 变更说明 | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 无行 |

### wb_contactman

| 字段 | SQL类型 | 含义（源DDL） | 目标/承载 | 分类 | 处理与缺口等级 | NULL 数 / 比例 | 空白数 / 比例 |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| `contactman_id` | bigint | 联系人ID | altoc_contact.id | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 0 / 0.0% | 不适用 |
| `org_id` | bigint | 组织ID | altoc_contact.customer_id | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 721 / 45.2% | 不适用 |
| `cm_name` | varchar(255) | 姓名 | altoc_contact.name | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 0 / 0.0% |
| `department` | varchar(50) | 部门 | altoc_contact.dept_name | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 1,381 / 86.6% | 3 / 0.2% |
| `post` | varchar(20) | 职务 | altoc_contact.job_title | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 1,518 / 95.2% | 2 / 0.1% |
| `phone` | varchar(255) | 办公电话 | altoc_contact.phone | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 5 / 0.3% | 0 / 0.0% |
| `mobile` | varchar(255) | 手机号码 | altoc_contact.mobile | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 1,558 / 97.7% | 6 / 0.4% |
| `mobile2` | varchar(255) | 备用手机号码 | altoc_contact.alternate_mobile | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 1,594 / 100.0% | 0 / 0.0% |
| `address` | varchar(255) | 快递信息 | altoc_contact.mailing_address | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 1,574 / 98.7% | 0 / 0.0% |
| `weixin_number` | varchar(255) | 微信号 | altoc_contact.wechat | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 1,587 / 99.6% | 3 / 0.2% |
| `stars` | int | 星级（1-2星，2-3星，3-3.5星，4-4星，5-4.5星，6-5星） | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `chief` | char(1) | DDL 未注明；业务含义待确认 | altoc_contact.is_key_contact | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 0 / 0.0% |
| `remarks` | varchar(255) | 备注 | altoc_contact.remark | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 1,591 / 99.8% | 2 / 0.1% |
| `archives_id` | varchar(36) | 档案ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 1,594 / 100.0% | 0 / 0.0% |
| `employee_id` | bigint | 业务员ID | altoc_contact.owner_uid | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 0 / 0.0% | 不适用 |
| `operator_id` | bigint | 用户ID | altoc_contact.updated_by | 需转换 | 保留原操作者ID/时间；历史人员映射，不伪造当前操作审计 | 0 / 0.0% | 不适用 |
| `operate_time` | datetime | 操作时间 | altoc_contact.updated_at | 需转换 | 保留原操作者ID/时间；历史人员映射，不伪造当前操作审计 | 0 / 0.0% | 不适用 |

### wb_contactman_info

| 字段 | SQL类型 | 含义（源DDL） | 目标/承载 | 分类 | 处理与缺口等级 | NULL 数 / 比例 | 空白数 / 比例 |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| `contactman_info_id` | bigint | 联系人信息ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 不适用 |
| `contactman_id` | bigint | 联系人ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 不适用 |
| `org_id` | bigint | 组织ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 不适用 |
| `cm_name` | varchar(255) | 姓名 | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 无行 |
| `post` | varchar(20) | 职务 | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 无行 |
| `phone` | varchar(255) | 办公电话 | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 无行 |
| `mobile` | varchar(255) | 手机号码 | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 无行 |
| `mobile2` | varchar(255) | 备用手机号码 | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 无行 |
| `weixin_number` | varchar(255) | 微信号 | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 无行 |
| `stars` | char(1) | 星级（1-2星，2-3星，3-3.5星，4-4星，5-4.5星，6-5星） | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 无行 |
| `description` | varchar(255) | 简介 | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 无行 |
| `archives_id` | bigint | 档案ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 不适用 |
| `employee_id` | bigint | 业务员ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 不适用 |
| `operator_id` | bigint | DDL 未注明；业务含义待确认 | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 不适用 |
| `operate_time` | datetime | 操作时间 | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 不适用 |
| `change_time` | datetime | 变更时间 | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 不适用 |
| `change_note` | varchar(255) | 变更说明 | 无等价统一字段/历史表 | 缺失 | 迁移必需：历史版本不等于当前主档；须保留变更记录/原引用 | 无行 | 无行 |

### wb_contract

| 字段 | SQL类型 | 含义（源DDL） | 目标/承载 | 分类 | 处理与缺口等级 | NULL 数 / 比例 | 空白数 / 比例 |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| `contract_id` | bigint | 合同ID | altoc_contract.id | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 0 / 0.0% | 不适用 |
| `parent_id` | bigint | 关联合同 | altoc_contract.parent_contract_id | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 14 / 0.9% | 不适用 |
| `contract_code` | varchar(20) | 合同编码 | altoc_contract.contract_no | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 0 / 0.0% |
| `contract_name` | varchar(255) | 名称 | altoc_contract.name | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 0 / 0.0% |
| `project_id` | bigint | 项目 | altoc_contract_project_link.project_code | 需转换 | 源ID映射Aims稳定code，冻结sales/实施角色；不能直接复制数字ID。 | 0 / 0.0% | 不适用 |
| `impl_project_id` | bigint | 实施项目ID | altoc_contract_project_link.project_code/project_role | 需转换 | 实施项目独立关联，原ID也须可追溯；空值保持空。 | 1,591 / 99.7% | 不适用 |
| `company_id` | bigint | 公司 | altoc_contract_party.party_ref_code | 需转换 | 公司资料主数据及主体编码尚未定稿；该列只存引用，不保存完整公司档案。 | 0 / 0.0% | 不适用 |
| `ba_id` | bigint | DDL 未注明；业务含义待确认 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 1,586 / 99.4% | 不适用 |
| `customer_id` | bigint | 客户 | altoc_contract.customer_id | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 0 / 0.0% | 不适用 |
| `contactman_id` | bigint | 客户联系人ID | altoc_contract.contact_id | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 227 / 14.2% | 不适用 |
| `employee_id` | bigint | 销售经理 | altoc_contract.owner_uid | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 0 / 0.0% | 不适用 |
| `system_id` | bigint | 系统ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 1,144 / 71.7% | 不适用 |
| `contract_type` | char(1) | 类型（0采购 1产品销售 2软件开发 3技术与数据服务 4设备与系统集成 5系统维护 6其他) | altoc_contract.direction/primary_type | 需转换 | 0采购，1产品销售，2软件开发，3技术与数据服务，4设备集成，5维护，6其他；映射方案待业务确认，不能统一legacy_contract。 | 0 / 0.0% | 0 / 0.0% |
| `is_third_party` | char(1) | 是否三方 | altoc_contract.is_third_party | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 0 / 0.0% | 0 / 0.0% |
| `third_party_id` | bigint | 第三方 | altoc_contract.third_party_customer_id | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 1,593 / 99.9% | 不适用 |
| `total_amount` | decimal(10,2) | 合同总金额 | altoc_contract.amount_tax_inclusive | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 不适用 |
| `prime_amount` | decimal(10,2) | 有效金额 | 无合同有效金额独立字段 | 缺失 | 绝不能映射amount_tax_exclusive；有效额不是未税额。 | 130 / 8.2% | 不适用 |
| `invoice_amount` | decimal(10,2) | DDL 写已开发票；源码实际为剩余未开票 | 无等价原缓存字段；新 summary.invoice_amount 为已开票额 | 需转换 | 必须保留原余额快照；新已开票额由发票事实派生，不直接复制同名列。 | 0 / 0.0% | 不适用 |
| `exec_amount` | decimal(10,2) | DDL 写已执行；源码实际为剩余应收/应付 | 无等价原余额缓存字段 | 缺失 | 按方向保留源剩余金额；逐合同收入/支出对账，不等同核销额或履约完成额。 | 0 / 0.0% | 不适用 |
| `description` | varchar(255) | 主要内容 | altoc_contract.content_summary | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 1,593 / 99.9% | 1 / 0.1% |
| `payment` | varchar(255) | 付款方式 | altoc_contract.payment_term_summary | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 18 / 1.1% | 2 / 0.1% |
| `tos` | varchar(255) | 服务条款 | altoc_contract.service_terms | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 140 / 8.8% | 252 / 15.8% |
| `service_period` | int | 服务周期(月) | altoc_contract.service_period_months | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 1,183 / 74.2% | 不适用 |
| `contract_period` | int | 合同周期(月) | altoc_contract.contract_period_months | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 1,547 / 97.0% | 不适用 |
| `contract_status` | char(1) | 状态（0正常 1完结 2中止） | altoc_contract.status | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 0 / 0.0% | 0 / 0.0% |
| `sign_date` | datetime | 签订日期 | altoc_contract.sign_date | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 0 / 0.0% | 不适用 |
| `due_date` | date | 到期日 | altoc_contract.end_date | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 不适用 |
| `archives_id` | varchar(36) | 档案ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 0 / 0.0% |
| `operator_id` | bigint | 操作员ID | altoc_contract.updated_by | 需转换 | 保留原操作者ID/时间；历史人员映射，不伪造当前操作审计 | 0 / 0.0% | 不适用 |
| `operate_time` | datetime | 操作时间 | altoc_contract.updated_at | 需转换 | 保留原操作者ID/时间；历史人员映射，不伪造当前操作审计 | 0 / 0.0% | 不适用 |
| `old_id` | bigint | 老合同ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 470 / 29.5% | 不适用 |

### wb_system

| 字段 | SQL类型 | 含义（源DDL） | 目标/承载 | 分类 | 处理与缺口等级 | NULL 数 / 比例 | 空白数 / 比例 |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| `system_id` | bigint | 系统ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `parent_id` | bigint | 关联系统ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `system_name` | varchar(255) | 系统名称 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 0 / 0.0% |
| `quantity` | int | 数量 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `description` | varchar(255) | 系统概述 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 215 / 100.0% | 0 / 0.0% |
| `org_id` | bigint | 最终用户ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `contactman_id` | bigint | 用户联系人ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 203 / 94.4% | 不适用 |
| `contract_id` | bigint | 主合同ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 53 / 24.7% | 不适用 |
| `contract_ids` | varchar(255) | 主合同IDs | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 61 / 28.4% | 26 / 12.1% |
| `maint_ids` | varchar(255) | 维保合同 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 61 / 28.4% | 21 / 9.8% |
| `start_date` | date | 起始日期 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `first_due_date` | date | 免费质保截止日期 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `last_due_date` | date | 付费质保截止日期 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 15 / 7.0% | 不适用 |
| `total_amount` | decimal(12,2) | 合同总额 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `vaild_amount` | decimal(12,2) | 认定合同额 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `maint_amount` | decimal(12,2) | 维保合同额 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 81 / 37.7% | 不适用 |
| `ratio` | decimal(6,2) | 收费比例 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 215 / 100.0% | 不适用 |
| `object_scale` | bigint | 客体规模 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 212 / 98.6% | 不适用 |
| `main_body_scale` | bigint | 主体规模 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 212 / 98.6% | 不适用 |
| `enterprise_scale` | bigint | B端用户数量 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 212 / 98.6% | 不适用 |
| `user_scale` | bigint | 系统用户规模 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 212 / 98.6% | 不适用 |
| `system_status` | char(1) | 系统状态（0交付 1试运行 2正式运行 9停用） | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 0 / 0.0% |
| `archives_id` | char(36) | 档案ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 0 / 0.0% |
| `operator_id` | bigint | 操作员ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `operate_time` | datetime | 操作时间 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |

### wb_project

| 字段 | SQL类型 | 含义（源DDL） | 目标/承载 | 分类 | 处理与缺口等级 | NULL 数 / 比例 | 空白数 / 比例 |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| `project_id` | bigint | 项目ID | aims_projects.id | 需转换 | 源ID重映射；枚举/人员/引用核对后转换；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `parent_id` | bigint | 上级项目ID | aims_projects.parent_id | 需转换 | 源ID重映射；枚举/人员/引用核对后转换；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `org_id` | bigint | 组织ID | altoc_contract_project_link/客户项目关系待定 | 缺失 | Aims项目不等价客户台账，须保留直接项目客户关系。；Aims字段仅建议，须核对当前canonical及owning导入合同 | 99 / 38.8% | 不适用 |
| `dept_id` | bigint | 部门ID | aims_projects.dept_code | 需转换 | 源ID重映射；枚举/人员/引用核对后转换；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `employee_id` | bigint | 项目经理 | aims_projects.leader | 需转换 | 源ID重映射；枚举/人员/引用核对后转换；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `assistant_id` | bigint | 助理ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 240 / 94.1% | 不适用 |
| `assistant_ratio` | int | 助理占比 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `prj_name` | varchar(255) | 名称 | aims_projects.name | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 0 / 0.0% |
| `short_name` | varchar(20) | 简称 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 251 / 98.4% | 2 / 0.8% |
| `prj_type` | char(2) | 类型（0企业管理 1人力资源 2财务 3行政 4企业策划 5市场营销 6销售 7研发 8运维 9运营) | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 0 / 0.0% |
| `prj_code` | varchar(255) | 编码 | aims_projects.project_code | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 0 / 0.0% |
| `prov_rates` | int | 计提比例 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `solution_id` | bigint | 解决方案ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 221 / 86.7% | 不适用 |
| `product_id` | bigint | DDL 未注明；业务含义待确认 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 207 / 81.2% | 不适用 |
| `pm_number` | int | DDL 未注明；业务含义待确认 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 9 / 3.5% | 不适用 |
| `budget` | decimal(12,2) | 预算 | aims_projects.budget | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验；Aims字段仅建议，须核对当前canonical及owning导入合同 | 130 / 51.0% | 不适用 |
| `contracts` | int | 合同数 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `amount` | decimal(12,2) | 金额 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `incomes` | int | 收入笔数 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `income_amount` | decimal(12,2) | 收入金额 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 172 / 67.5% | 不适用 |
| `payments` | int | 支出笔数 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `payment_amount` | decimal(12,2) | 支出金额 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 172 / 67.5% | 不适用 |
| `man_hours` | decimal(8,2) | 工时数 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 172 / 67.5% | 不适用 |
| `hr_cost` | decimal(12,2) | 人力成本 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `year_contracts` | int | 当年合同数 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `year_amount` | decimal(12,2) | 当年合同额 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `year_contract_incomes` | int | 当年合同收入笔数 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 9 / 3.5% | 不适用 |
| `year_contract_income` | decimal(12,2) | 当年合同收入额 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 241 / 94.5% | 不适用 |
| `year_other_incomes` | int | 当年非合同收入笔数 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 9 / 3.5% | 不适用 |
| `year_other_income` | decimal(12,2) | 当年非合同收入额 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 241 / 94.5% | 不适用 |
| `year_incomes` | int | 当年收入笔数 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `year_income` | decimal(12,2) | 当年收入额 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `year_payments` | int | 当年支出笔数 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `year_payment` | decimal(12,2) | 当年支出 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `year_hours` | decimal(8,2) | 当年工时 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `year_cost` | decimal(12,2) | 当年人力成本 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `year_ratio` | int | 当年业绩占比 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `year_strength` | decimal(8,2) | DDL 未注明；业务含义待确认 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 26 / 10.2% | 不适用 |
| `activation` | decimal(14,2) | 活跃度 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `sub_projects` | int | DDL 未注明；业务含义待确认 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `stat_date` | date | 统计日期 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 255 / 100.0% | 不适用 |
| `prj_status` | char(1) | 状态（0正常 1完结 2中止） | aims_projects.status | 需转换 | 原0/1/2语义分别核对，不能自动生成项目生命周期审批。；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 0 / 0.0% |
| `pmw_balance` | decimal(5,2) | DDL 未注明；业务含义待确认 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 255 / 100.0% | 不适用 |
| `amount_balance` | decimal(12,2) | DDL 未注明；业务含义待确认 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `income_balance` | decimal(12,2) | DDL 未注明；业务含义待确认 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `payment_balance` | decimal(12,2) | DDL 未注明；业务含义待确认 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `start_date` | date | 启动日期 | aims_projects.start_date | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `end_date` | date | 结束日期 | aims_projects.end_date | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验；Aims字段仅建议，须核对当前canonical及owning导入合同 | 254 / 99.6% | 不适用 |
| `description` | varchar(255) | 简介 | aims_projects.description | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验；Aims字段仅建议，须核对当前canonical及owning导入合同 | 237 / 92.9% | 0 / 0.0% |
| `archives_id` | varchar(36) | 档案ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 253 / 99.2% | 0 / 0.0% |
| `operator_id` | bigint | 用户ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |
| `operate_time` | datetime | 操作时间 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃；Aims字段仅建议，须核对当前canonical及owning导入合同 | 0 / 0.0% | 不适用 |

### wb_bank_account

| 字段 | SQL类型 | 含义（源DDL） | 目标/承载 | 分类 | 处理与缺口等级 | NULL 数 / 比例 | 空白数 / 比例 |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| `ba_id` | bigint | 银行账户ID | finance_bank_account.id | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 0 / 0.0% | 不适用 |
| `org_id` | bigint | 机构ID | 无对应公司/法人所属引用 | 缺失 | owner_dept_code是部门，不等价于org_id；迁移必需新增或受控来源关系承载。 | 0 / 0.0% | 不适用 |
| `short_name` | varchar(20) | 简称 | 无账户简称字段 | 缺失 | code与简称业务语义不同；不能把简称无条件当机器编码。 | 0 / 0.0% | 0 / 0.0% |
| `account_name` | varchar(255) | 户名 | finance_bank_account.account_name | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 0 / 0.0% |
| `account_sn` | bigint | 账户序号 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 22 / 100.0% | 不适用 |
| `account_number` | varchar(30) | 账号 | finance_bank_account.account_no_secret_ref + account_no_masked | 需转换 | 明文经受批保险箱写入后只留secret_ref与掩码；现有迁移仅掩码，不能据此称完整迁移。 | 0 / 0.0% | 0 / 0.0% |
| `bank_code` | varchar(30) | 银行行号 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 13 / 59.1% | 0 / 0.0% |
| `bank_name` | varchar(255) | 银行名称 | finance_bank_account.bank_name | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 0 / 0.0% |
| `ba_type` | char(1) | 账户类型(wb_account_type) | finance_bank_account.account_type | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 0 / 0.0% | 0 / 0.0% |
| `ba_status` | char(1) | 账户状态(wb_record_status) | finance_bank_account.status | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 0 / 0.0% | 0 / 0.0% |
| `create_time` | date | 开户日期 | finance_bank_account.opened_at | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 不适用 |
| `check_date` | date | 对账日期 | finance_account_balance_snapshot.snapshot_date | 需转换 | 与账户当前balance成对处理；不是opened_at。 | 1 / 4.5% | 不适用 |
| `balance` | decimal(12,2) | 余额 | finance_account_balance_snapshot.balance_amount | 需转换 | 仅check_date有效时可生成来源明确的快照；不得覆盖历史同日余额，不直接累加。 | 1 / 4.5% | 不适用 |
| `remark` | varchar(255) | 银行账号备注 | finance_bank_account.remark | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 22 / 100.0% | 0 / 0.0% |
| `operator_id` | bigint | 操作员ID | finance_bank_account.updated_by | 需转换 | 保留原操作者ID/时间；历史人员映射，不伪造当前操作审计 | 0 / 0.0% | 不适用 |
| `operate_time` | datetime | 操作时间 | finance_bank_account.updated_at | 需转换 | 保留原操作者ID/时间；历史人员映射，不伪造当前操作审计 | 0 / 0.0% | 不适用 |

### wb_account_balance

| 字段 | SQL类型 | 含义（源DDL） | 目标/承载 | 分类 | 处理与缺口等级 | NULL 数 / 比例 | 空白数 / 比例 |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| `ab_id` | bigint | 银行账户余额ID | finance_account_balance_snapshot.id | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 0 / 0.0% | 不适用 |
| `ba_id` | bigint | 银行账户ID | finance_account_balance_snapshot.bank_account_id | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 0 / 0.0% | 不适用 |
| `check_date` | date | 对账日期 | finance_account_balance_snapshot.snapshot_date | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 不适用 |
| `balance` | decimal(12,2) | 余额 | finance_account_balance_snapshot.balance_amount | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 不适用 |
| `remark` | varchar(255) | 备注 | finance_account_balance_snapshot.note | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 2,685 / 97.5% | 1 / 0.0% |
| `operator_id` | bigint | 操作员ID | finance_account_balance_snapshot.created_by | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 0 / 0.0% | 不适用 |
| `operate_time` | datetime | 操作时间 | finance_account_balance_snapshot.created_at | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 不适用 |

### wb_invoice

| 字段 | SQL类型 | 含义（源DDL） | 目标/承载 | 分类 | 处理与缺口等级 | NULL 数 / 比例 | 空白数 / 比例 |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| `invoice_id` | bigint | 发票ID | finance_invoice.id | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 0 / 0.0% | 不适用 |
| `invoice_code` | varchar(10) | DDL 未注明；业务含义待确认 | finance_invoice.invoice_no | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 0 / 0.0% |
| `project_id` | bigint | 项目ID | finance_invoice.project_code | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 12 / 0.6% | 不适用 |
| `contract_id` | bigint | 合同ID | finance_invoice.contract_code | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 0 / 0.0% | 不适用 |
| `company_id` | bigint | DDL 未注明；业务含义待确认 | 无开票公司编码；taxpayer_name/no不等价 | 缺失 | 开票主体与客户抬头分开保留。 | 1,944 / 100.0% | 不适用 |
| `receiver` | varchar(255) | DDL 未注明；业务含义待确认 | finance_invoice.receiver_name | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 33 / 1.7% | 0 / 0.0% |
| `item` | varchar(255) | 内容 | finance_invoice.invoice_item | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 0 / 0.0% |
| `amount` | decimal(12,2) | 发票金额 | finance_invoice.invoice_amount | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 不适用 |
| `invoice_date` | datetime | 开票日期 | finance_invoice.invoice_date | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 1 / 0.1% | 不适用 |
| `remark` | varchar(255) | 备注 | finance_invoice.remark | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 650 / 33.4% | 1,098 / 56.5% |
| `ap_id` | varchar(36) | 档案页ID | finance_invoice.invoice_file_key 等；缺原档案页引用 | 需转换 | 需解析档案页和受批文件复制、hash/完整性校验；仅URL不算附件迁移。 | 1,269 / 65.3% | 0 / 0.0% |
| `operator_id` | bigint | 操作员ID | finance_invoice.updated_by | 需转换 | 保留原操作者ID/时间；历史人员映射，不伪造当前操作审计 | 0 / 0.0% | 不适用 |
| `operate_time` | datetime | 操作时间 | finance_invoice.updated_at | 需转换 | 保留原操作者ID/时间；历史人员映射，不伪造当前操作审计 | 0 / 0.0% | 不适用 |
| `oldcontract_id` | bigint | 老合同ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 675 / 34.7% | 不适用 |
| `oldinvoice_id` | bigint | DDL 未注明；业务含义待确认 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 675 / 34.7% | 不适用 |

### wb_project_income

| 字段 | SQL类型 | 含义（源DDL） | 目标/承载 | 分类 | 处理与缺口等级 | NULL 数 / 比例 | 空白数 / 比例 |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| `pi_id` | bigint | 项目收入ID | finance_receipt.id | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 0 / 0.0% | 不适用 |
| `pi_code` | varchar(10) | DDL 未注明；业务含义待确认 | finance_receipt.receipt_no | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 0 / 0.0% |
| `project_id` | bigint | 项目ID | finance_receipt.project_code | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 0 / 0.0% | 不适用 |
| `employee_id` | bigint | 经办人 | finance_receipt.handler_uid | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 0 / 0.0% | 不适用 |
| `receipt_date` | date | 到账日期 | finance_receipt.received_at | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 不适用 |
| `amount` | decimal(10,2) | 金额 | finance_receipt.received_amount | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 不适用 |
| `channel` | varchar(1) | 收款渠道(0现金 1银行转账 2第三方支付) | finance_receipt.channel | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 1,408 / 44.4% | 0 / 0.0% |
| `ba_id` | bigint | 收款账户 | finance_receipt.bank_account_id | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 1,411 / 44.5% | 不适用 |
| `income_type` | varchar(2) | 收入类型(00一次性收入 01定金/预付款 02首付款 03阶段付款 04验收付款 05尾款 06维护费 07退款 08退税 09其他业务收入 10利息收入 11补贴 12资产处置 13投资款 14借款 19其他非业务收入) | finance_receipt.income_type_id | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 0 / 0.0% | 0 / 0.0% |
| `payer` | varchar(255) | DDL 未注明；业务含义待确认 | finance_receipt.payer_name | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 1,730 / 54.6% | 0 / 0.0% |
| `matter` | varchar(255) | 事由 | finance_receipt.note | 能映射 | 字段承载已有；仍需专用迁移与长度/NULL校验 | 752 / 23.7% | 1,315 / 41.5% |
| `contract_id` | bigint | 合同Id | finance_receipt.contract_code | 需转换 | 源ID重映射；枚举/人员/引用核对后转换 | 993 / 31.3% | 不适用 |
| `pp_id` | bigint | 对应支出Id | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 3,169 / 100.0% | 不适用 |
| `operator_id` | bigint | 操作员ID | finance_receipt.updated_by | 需转换 | 保留原操作者ID/时间；历史人员映射，不伪造当前操作审计 | 0 / 0.0% | 不适用 |
| `operate_time` | datetime | 操作时间 | finance_receipt.updated_at | 需转换 | 保留原操作者ID/时间；历史人员映射，不伪造当前操作审计 | 0 / 0.0% | 不适用 |
| `oldpayment_id` | bigint | DDL 未注明；业务含义待确认 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 1,765 / 55.7% | 不适用 |

### wb_project_payment

| 字段 | SQL类型 | 含义（源DDL） | 目标/承载 | 分类 | 处理与缺口等级 | NULL 数 / 比例 | 空白数 / 比例 |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| `pp_id` | bigint | 项目支出ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `pp_code` | varchar(10) | DDL 未注明；业务含义待确认 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 0 / 0.0% |
| `project_id` | bigint | 项目ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `employee_id` | bigint | 经办人 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `pay_date` | date | 支付日期 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `amount` | decimal(10,2) | 金额 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `charge` | decimal(10,2) | 手续费 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 4,233 / 100.0% | 不适用 |
| `process_code` | varchar(30) | 审批编号 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 4,233 / 100.0% | 0 / 0.0% |
| `channel` | varchar(1) | 支付渠道(0现金 1银行转账 2第三方支付) | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 0 / 0.0% |
| `ba_id` | bigint | 付款账户 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 23 / 0.5% | 不适用 |
| `payment_type` | varchar(2) | 支出类型(00差旅费 01业务招待费 02销售费用 03项目采购 04人员薪资 05奖励/提成 06税费 07退款 09其他业务支出 10办公费 11固定资产采购 12管理人员薪资 13管理人员奖励 14房租 15车辆费用 19其他管理费 20银行手续费 21利息支出 29其他财务费用) | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 0 / 0.0% |
| `matter` | varchar(255) | 事由 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 1,091 / 25.8% | 9 / 0.2% |
| `contract_id` | bigint | 合同Id | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 4,233 / 100.0% | 不适用 |
| `pi_id` | bigint | 对应收入Id | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 4,233 / 100.0% | 不适用 |
| `receiver` | varchar(50) | 收款人 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 176 / 4.2% | 3 / 0.1% |
| `receiver_acc` | varchar(30) | 收款账号 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 4,233 / 100.0% | 0 / 0.0% |
| `receiver_bank` | varchar(100) | 收款银行 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 4,233 / 100.0% | 0 / 0.0% |
| `operator_id` | bigint | 操作员ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `operate_time` | datetime | 操作时间 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |

### wb_payment_plan

| 字段 | SQL类型 | 含义（源DDL） | 目标/承载 | 分类 | 处理与缺口等级 | NULL 数 / 比例 | 空白数 / 比例 |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| `pp_id` | bigint | 付款计划ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `org_id` | bigint | 公司ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `planned_date` | date | 计划付款日期 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `amount` | decimal(12,0) | 付款金额 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `matter` | varchar(255) | 事由 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 0 / 0.0% |
| `pay_status` | char(1) | 付款状态(0未付 1已付) | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 0 / 0.0% |
| `operator_id` | bigint | 操作员ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `operate_time` | datetime | 操作时间 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |

### wb_archives

| 字段 | SQL类型 | 含义（源DDL） | 目标/承载 | 分类 | 处理与缺口等级 | NULL 数 / 比例 | 空白数 / 比例 |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| `archives_id` | varchar(36) | 档案ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 0 / 0.0% |
| `archives_code` | varchar(20) | 档案编码 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 1,767 / 100.0% | 0 / 0.0% |
| `archives_type` | varchar(20) | 档案类型 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 0 / 0.0% |
| `archives_name` | varchar(100) | 名称 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 0 / 0.0% |
| `position` | varchar(100) | 存放位置 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 1,767 / 100.0% | 0 / 0.0% |
| `level` | char(1) | 密级 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 0 / 0.0% |
| `start_date` | date | 建档日期 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `end_date` | date | 归档日期 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 1,767 / 100.0% | 不适用 |
| `description` | varchar(255) | 描述 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 1,767 / 100.0% | 0 / 0.0% |
| `archives_status` | char(1) | 状态（0正常 1删除 2归档 3封存） | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 0 / 0.0% |
| `operator_id` | bigint | 操作员ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `operate_time` | datetime | 操作时间 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |

### wb_archives_page

| 字段 | SQL类型 | 含义（源DDL） | 目标/承载 | 分类 | 处理与缺口等级 | NULL 数 / 比例 | 空白数 / 比例 |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| `ap_id` | varchar(36) | 档案页ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 0 / 0.0% |
| `archives_id` | varchar(36) | 档案ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 0 / 0.0% |
| `ap_order` | int | 序号 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 156 / 1.7% | 不适用 |
| `ap_type` | varchar(20) | 文件类型 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 6,233 / 67.6% | 0 / 0.0% |
| `ap_name` | varchar(20) | 名称 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 0 / 0.0% |
| `ap_url` | varchar(255) | URL | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 6,241 / 67.7% | 0 / 0.0% |
| `submit_date` | datetime | 提交日期 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 9,221 / 100.0% | 不适用 |
| `description` | varchar(255) | 描述 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 9,221 / 100.0% | 0 / 0.0% |
| `ap_status` | char(1) | 状态（0正常 1删除 2归档 3封存） | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 0 / 0.0% |
| `operator_id` | bigint | 操作员ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `operate_time` | datetime | 操作时间 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |

### wb_archives_list

| 字段 | SQL类型 | 含义（源DDL） | 目标/承载 | 分类 | 处理与缺口等级 | NULL 数 / 比例 | 空白数 / 比例 |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| `al_id` | bigint | 档案模板ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `archives_type` | varchar(20) | 档案类型 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 0 / 0.0% |
| `al_order` | int | 序号 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `al_name` | varchar(20) | 档案名称 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 0 / 0.0% |

### wb_product

| 字段 | SQL类型 | 含义（源DDL） | 目标/承载 | 分类 | 处理与缺口等级 | NULL 数 / 比例 | 空白数 / 比例 |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| `product_id` | bigint | 产品ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `parent_id` | bigint | 父产品ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `product_code` | varchar(20) | 产品编码 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 0 / 0.0% |
| `product_name` | varchar(40) | 名称 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 0 / 0.0% |
| `solution_id` | bigint | 解决方案 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `dept_id` | bigint | 归口部门 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `employee_id` | bigint | 产品经理 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `start_date` | date | 启动日期 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `product_status` | char(1) | 状态（0正常 1停用） | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 0 / 0.0% |
| `completeness` | int | 完成度 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `description` | varchar(255) | 产品描述 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 19 / 100.0% | 0 / 0.0% |
| `archives_id` | varchar(36) | 档案ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 18 / 94.7% | 0 / 0.0% |
| `operator_id` | bigint | 用户ID | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |
| `operate_time` | datetime | 操作时间 | 无等价统一字段/历史表 | 缺失 | 迁移必需：增补领域字段或受控来源历史承载，禁止静默丢弃 | 0 / 0.0% | 不适用 |

## 附录 B. 文档核验与限制

只写本文件。逐源DDL提取17张表全部字段，两份源业务DDL比对无差异；复核目标字段名称与设计SQL，核对安装JSON字段清单、迁移9族及Finance import/status实际handler。未操作运行时或浏览器；数据库只执行获批的 SELECT/SHOW，凭据仅在远端受保护进程与临时文件中使用，未输出或复制。本文不授权schema/保险箱/数据写入；实施方案和生产窗口另审。
