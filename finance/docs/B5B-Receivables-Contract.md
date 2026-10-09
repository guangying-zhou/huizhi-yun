# B5-B 净期初接续与原子分配

本合同为开发候选，未执行环境安装、历史合同激活或 Platform 清单导入。历史销售合同采用净期初，不启用全历史重建。

## 操作、授权与页面

复用 `finance:enterprise-host:execute`，不新增 service capability 或 grant。Host 按当前主体的 Finance scoped permission 判权，Runtime 校验服务身份、租户、部署、签名许可及每个目标的现时范围。

| 固定操作 | 人员资源/动作 | 页面或用途 |
| --- | --- | --- |
| historical-finance-preview / historical-finance-history-page | historical_finance:view | /finance/historical-finance |
| historical-finance-activate | historical_finance:activate | 受审预览后激活 |
| allocation-candidates | reconciliation:view | /finance/receipts/:code/allocate |
| allocation-batches-page / allocation-batches-detail | reconciliation:view | /finance/allocation-batches、/:code |
| reconciliation-allocate-batch / allocation-batches-reverse | reconciliation:confirm | 全量提交、整组撤销 |
| receivable-adjustments-page / receivable-adjustments-detail | receivable_adjustments:view | /finance/receivable-adjustments、/:code |
| receivable-adjustments-create | receivable_adjustments:edit | /finance/receivable-adjustments/new |
| receivable-adjustments-confirm | receivable_adjustments:confirm | 草稿确认 |
| receivable-adjustments-reverse | receivable_adjustments:reverse | 已确认调整撤销 |

新增 Runtime 固定操作共 13 个，Host、Foundation 与 Runtime 精确闭集逐项对应。列表 page/pageSize/total 由服务端同事务计算；详情独立校验对象范围。历史接续与调整办理要求 global 范围；分配和批次读取可按既有到账责任关系 self 范围办理。无 scope 不视为 all。

Finance manifest 新增 `historical_finance:{view,activate}`、`receivable_adjustments:{view,edit,confirm,reverse}`，无动作删除。finance:admin 显式获得查看与调整录入；finance:manager 显式获得查看、激活、调整确认与撤销。敏感动作不从 admin 推导。即使同一人拥有多个角色，Runtime 仍拒绝自录自确认、自录自撤销；到账确认人与核销人分离沿用原合同。

## 净期初与历史证据

激活依次核验 Registry 登记的 W1 迁移表、applied opening 批次、review hash、confirmation 对应的批次/主迁移 hash/快照/确认人/T0、逐合同确认金额与到期日、完成行数、opening 映射、当前结算计划全行 seal，以及不存在已进入 Finance 的该合同事实。缺 T0、证据变化或版本过期拒绝，不删除历史 origin 护栏。

`ConfirmationSHA256` 是原安装器审核的受保护文件摘要引用；Runtime 不读取用户文件或源库，也不将 typed JSON 重新序列化摘要冒充原文件摘要。激活将当前迁移 scope 的 evidence hash、review hash、confirmation 文件 hash 引用、T0、金额、actor 与时刻冻结。只读 wire 解码包通过跨包序列化测试对齐原工具，Runtime 不反向 import 迁移引擎。不写 mig_batch/mig_object_map，不改变已导入数据。

余额公式：净期初金额 − T0 后有效核销 − 已确认调整。T0 当日及之前的到账/开票不能作为新接续业务。旧 `wb_project_income/wb_invoice/wb_project_payment` 从保全台账返回限定字段，仅用于查询；不生成新 Finance 事实。旧金额无论大小、正负均不进入公式，未核实发票不自动转为正式票。关闭/中止合同的未结余额仍可办理。

## 分配、调整与并发

一笔已确认到账可分配至同客户、同币种、同法人主体的多个销售结算计划；本批目标为结算计划，不提供发票目标分配。缺合同收款账户或法人归属时失败关闭，不能猜值。最多 100 行，重复目标拒绝；服务端重新计算容量。到账与各计划的当前版本必须一致，全部行与余额/摘要/审计同事务提交。100 分配 60+40 成功，60+50 整批拒绝。

整组撤销保留原核销事实，记录撤销 actor/时刻/原因。组内子核销不能单独撤销。调整采用独立不可变事实与状态推进，不以修改计划 status 代替坏账；确认与撤销具有 CAS、职责分离与审计。折让/坏账/尾差为正数扣减，correction 可正负；导致负未结的确认或撤销拒绝。

锁序：Registry 栅栏 → 客户 ID 升序 → 合同 ID 升序 → 结算计划 ID 升序 → 接续证据/发票 → 到账 → 核销/分配组/调整 → 合同摘要/项目成本财务目标 → receipt 与审计。先发现、后锁定并复核。Altoc/Finance 写域在同一 caller-Tx 内；迁移域仅按同一注册表代次解析只读映射，不获得迁移写权限。历史摘要通过 owning Altoc 的窄事务接口写入，只接受持久激活证据，原 native 护栏不放宽。

写入使用稳定 Idempotency-Key，payload 包括当前版本；同键同意图重放原回执，同键变更拒绝。UI 409 保留金额、选择、原因并刷新比较，不自动重建意图或重试写入。

## 安装与上线清单（由部署协调者执行）

新增固定 domaininstall 子集 `finance-receivables`：

- finance_historical_readiness
- finance_allocation_batch
- finance_receivable_adjustment

依赖既有 Finance B3 和 W1 迁移台账 binding；不重装基础、opening 或 B5-A。缺子集时新入口返回不可用，现有业务读取不受影响；部分映射拒绝启动，禁止静默补齐。

停写、加密备份并解密核验后，用新候选构建 `hzy-enterprise-add-apf`，复用真实停止检查与 0600 plan/checkpoint：

```sh
common=(--subset finance-receivables --config "$source0600" \
  --migration-db-config "$migration0600" --proposed-config "$stage/proposed.json" \
  --plan "$stage/plan.json")
"$installer" --mode plan "${common[@]}"
# 审查实际 reviewHash，不能用 DDL 文件摘要替代。
"$installer" --mode apply "${common[@]}" --review-hash "$approved_hash" --receipt "$stage/receipt.json"
"$installer" --mode verify "${common[@]}" --review-hash "$approved_hash" --receipt "$stage/receipt.json"
# 仅无业务行且原 baseline/checkpoint 一致时可逆序回滚：
"$installer" --mode rollback "${common[@]}" --review-hash "$approved_hash" --receipt "$stage/receipt.json"
```

子集任一表已有业务事实时 rollback 拒绝；activation FK 同时阻止原 opening 批次回滚。不能直接 mysql < DDL。schema 定义同步于 finance_schema.sql，隔离测试覆盖安装、verify、空表回滚与非空拒绝。

必须配套 Runtime 与 Host 候选。Platform 需导入本批 Finance manifest、核对角色差异并重签指定 test 环境；由协调者取得用户批准后执行，本批不发布、不重签，不改生产。新敏感动作未进入策略前继续无权限。安装完成不等于逐合同激活；历史激活与逐合同/币种核对须独立验收。hzy0 原 139 笔 opening、real Vault、Collab、grant 与 scheduler 均保持。
