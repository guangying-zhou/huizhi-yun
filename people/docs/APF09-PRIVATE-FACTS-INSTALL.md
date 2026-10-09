# APF-09d 私密档案增量安装候选

仅交付制品，本轮不执行环境写入。固定 DDL 在 `apf_private_facts_incremental.sql`，domaininstall 内嵌 `people_private.json` 与它逐列一致；People 基础 10 表安装规格不改。

## 执行前（每个环境均另行批准）

1. 加密备份统一库、当前 Runtime 配置与 Registry 映射，验证可解密；原文不打印。
2. 从可信当前 binding 用 `WithPeoplePrivateFacts` 得到只增一条映射的候选；tenant/environment/ownerDeployment/storage address 均来自受保护配置，不从 HTTP 传入。generation 与 schemaVersion 必须不变。
3. 使用 `ForPeoplePrivateFacts(Expectation{Tenant, Environment, OwnerDeployment, Address})` 调 `PlanInstall`；plan 仅固定 DDL/映射/既有 baseline，reviewHash 经审查。不得直接运行 SQL 绕过工具，不允许覆盖已有表或半装状态。
4. 切换窗口停止 Runtime（其他共用域同时暂停，需告知），停止证明以工具的 `Stopped` 回调校验实际进程为准，不能传空实现。仅隔离测试使用空实现。
5. `Apply(plan, stopped, checkpoint)` 逐项持久化 0600 checkpoint；`Verify` 与 `VerifyReceipt` 成功后，装入审核后的增量映射并恢复 Runtime。只改 People 映射，不改其他域或 grant。
6. 员工范围内 edit 正例、无 edit /范围外反例、私密字段白名单与掩码探测。响应 `private, no-store`，不日志化正文。

## 回滚候选（另行批准）

停止 Runtime，用同 installer、原 checkpoint 调 `Rollback`。仅删摘要仍一致且本批创建的私密表，且必须为空、无外部 FK、其他对象/数据 baseline 未漂移；有私密证据或既有域发生业务写入时拒绝自动回滚，保留候选并人工处理，不删数据。回滚成功才恢复备份的 Runtime 配置/People 映射；其他域、generation/schemaVersion 不回退。

隔离演练包含 plan→apply→verify→rollback→重装，以及非空表拒绝 rollback。生产/本机库没有执行本候选；没有新 capability 或 grant。
