# APF12 候选授权文件

本批不新增 capability 或人员 grant，不执行 seed/verify。运行时复用三条现有精确通道；安装前需使用受保护部署事实核验，缺项仅在获批窗口补缺，不恢复已撤销行、不创建凭据。

| 通道 | 精确语义 scope | 现有交付的 seed / verify |
| --- | --- | --- |
| Enterprise → Workflow | workflow:proxy | console/docs/sql/Console-SQL-{Seed,Verify}-v2.12-enterprise-workflow-proxy-grant.sql |
| Workflow → Enterprise | enterprise:workflow-callback:execute | console/docs/sql/Console-SQL-{Seed,Verify}-p1-enterprise-channels-candidate.sql（仅匹配 workflow.runtime 的对应行；不得借本任务执行其它候选行） |
| Enterprise → owning Runtime | altoc:enterprise-host:execute、altoc:scheduler:execute | console/docs/sql/Console-SQL-{Seed,Verify}-v2.34-apf-channels.sql（仅 Altoc 行；实际单一 audience 参数） |

需同时核验当前客户端/credential、tenant、两端 deployment、实际 audience、语义 scope 和物理 grant 唯一性。新增 Workflow 人工定义文件为 APF12-Workflow-Seed-candidate.sql / APF12-Workflow-Verify.sql；审批人须经 Console 目录确认、与申请人职责分离，当前定义或路由冲突先停止。固定相对回调为 /api/v1/service/workflow/callback。

customer/approve 没有本批实现，Runtime 回调闭集拒绝它。历史客户实例需另行盘点，不能把整个 altoc app 指向报价/合同接收器。
