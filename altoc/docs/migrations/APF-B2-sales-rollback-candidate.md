# Altoc B2 安装候选与回滚

此批不执行环境写入。使用 `domaininstall.ForAltocSales` 的 PlanInstall → 人工核对 reviewHash → Apply → VerifyReceipt；仅 Runtime 停止且迁移锁持有时 apply。Registry 配置通过 `WithAltocSales` 产生新映射，不改变 generation、已有域映射或任何已有表。

回滚使用同一 receipt 的 Rollback，禁止直接执行无条件 DROP：逐表 DDL 摘要一致、无业务行/回执/审计证据、无外部 FK、已有域 baseline 未变才能删除本批八表，并恢复映射配置。已有数据即停止自动回滚，须另行批准保留/处理业务证据。隔离演练覆盖完整安装、verify、rollback；不触碰已安装客户/合同/报价/共享账本。

八表：altoc_opportunity_stage、altoc_lead、altoc_opportunity、altoc_lead_conversion、altoc_opportunity_contact_role、altoc_opportunity_stage_log、altoc_sales_activity、altoc_sales_task。原表均保留；报价/合同不在本段新增外键。

阶段配置沿用 Altoc canonical schema 的 `opportunity_stage` 默认管道与准入条件。安装后的阶段初始化属于另一项待批准环境写入；未初始化时页面写入失败关闭，不猜测目标阶段。
