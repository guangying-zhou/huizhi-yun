# B5-A 应收工作台合同

应收唯一事实源为 `altoc_billing_schedule` 的 receivable 行。Altoc 拥有到期日、催收责任与联系记录；Finance 仍拥有到账与核销。承诺金额不会改变 received_amount，也不生成到账。

## 读操作与范围

Host GET `/altoc/api/v1/receivables`、`/aging`、`/:planId` 分别映射固定 Runtime `receivables:page`、`aging-summary`、`detail`。人员权限均为 manifest 的 receivable:view；服务能力沿用 altoc:enterprise-host:execute。分页与按币种/账龄汇总在同一 Registry 快照事务计算。筛选包括搜索、状态、客户、合同、催收负责人、币种、账龄、法人主体。

权限 scope 在 COUNT/汇总/分页与详情分别执行：all；合同负责人的 self；合同部门的 dept/self_dept；self/self_dept 还可读取本人直接负责或被指派催收的单条款项。此关系不授权读取其它合同、客户或 Finance 私有数据。

法人筛选采用合同约定收款账户的 legal_entity_code，只在当前 Finance bank_accounts:view 授权（可无对象事实完成）的情况下使用。BFF 将当前授权绑定进同一短期签名 permit，限制最早有效期；Runtime 同时取得 Finance/Altoc Registry 快照，读取精确账户归属，不投影账户编号、余额或 Finance 金额。缺字段或映射时失败关闭。未设约定收款账户的合同不猜法人归属。

当前查询日期按 Asia/Shanghai 的业务日固定。账龄：未到期（含当天）、1–30、31–60、61–90、91–180、180 天以上、无到期日。历史 queryDate 返回 receivable_history_not_ready；不能用当前核销构造历史余额。取消、坏账、已结清款项不计当前未收总额。历史导入合同不计入当前汇总，其授权范围内未就绪项数单列；详情明确财务未就绪并禁用写入。

## 写操作与事务

Host POST `/:planId/collection-owner`、`/due-date`、`/followups` 对应固定 `receivables:set-collection-owner`、`set-due-date`、`followup-create`，分别要求 manifest 显式 receivable:assign/set-due-date/followup。admin 不蕴含这些动作。推荐角色 altoc:admin 与 altoc:contract_manager 显式拥有，角色同步与策略重签由协调者另行安排。

每次写携带当前 expectedVersion 和稳定 Idempotency-Key。actor 只取受信会话/Runtime 委托。Registry generation SHARE → contract → billing_schedule → service_command_receipt → collection_event 的锁序固定；对照既有 Finance 共享事务的父合同→计划顺序，不取得 Finance 摘要锁、不调用网络。Scope 在 receipt replay 前复核。请求摘要包含操作、对象、排序后 payload 与 actor；同键同内容重放返回原版本，异内容409，CAS冲突409。失败整笔回滚，UI保留草稿；409刷新资料比较后重确认。

新指派通过 owning OwnerDirectory 校验 active、非保留主体、可用身份；Directory 故障503不写。新增下一次跟进提醒时，预读当前催收负责人并在事务前核验资格，持锁后复核未变。既有责任人历史原值仍可读。联系结果、承诺日/金额、下一次跟进、责任/到期日变更前后值，连同 actor/time、原始幂等键与回执 operation_id 追加至 altoc_collection_event。

## 安装与通知

`hzy-enterprise-add-apf --subset altoc-receivables` 仅安装一张追加事件表，扩展原 binding。复用停止检查、0600 plan/checkpoint、reviewHash、baseline/generation、plan/apply/verify/rollback；不能手工执行 DDL 绕过安装器。原业务表和基础绑定不重装。非空表回滚失败关闭，先由协调者评估业务记录保全。

未安装子集时，当前应收读仍可用，催收写入503并禁用UI。`*_schema.sql` 是设计镜像。hzy0 安装由 Codex-sol 的备份与停止窗口执行；本批不自行写共享环境。

复用 APF-18B billing-due 的现有 scan/published/closure-ack 通道：无责任人不发送，结清/取消/改派/时间变化关闭旧代。本批不启用 scheduler，不新增第二套扫描或 grant。正式启用仍需既有 S/P grant 签发及唯一 owner 证据。
