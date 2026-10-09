# APF-16a Enterprise 投标合同（安装候选）

## 授权与固定操作

所有用户动作由 enterprise.runtime U 通道、已验签 actor 和短期 APF permit 承接；服务能力仍为 altoc:enterprise-host:execute。人员资源只有 opportunity：读取 view，写入 edit。手工无商机投标可创建，但仍按其拟建负责人/部门复核 edit 范围，不从请求的成员/角色升级权限。

| Host BFF | 固定 Runtime 操作 |
|---|---|
| GET /altoc/api/v1/tenders | tenders:page |
| GET /altoc/api/v1/tenders/:tenderId | tenders:view |
| POST /altoc/api/v1/tenders | tenders:create |
| PATCH /altoc/api/v1/tenders/:tenderId | tenders:update |
| GET /altoc/api/v1/tenders/agencies | tender-agencies:page |
| POST /altoc/api/v1/tenders/agencies | tender-agencies:create |
| POST /altoc/api/v1/tenders/:tenderId/members | tender-members:add |
| DELETE /altoc/api/v1/tenders/:tenderId/members/:childId | tender-members:remove |
| POST /altoc/api/v1/tenders/:tenderId/milestones | tender-milestones:create |
| PATCH /altoc/api/v1/tenders/:tenderId/milestones/:childId | tender-milestones:update |

Runtime path 为 `/v1/enterprise/altoc/` + 表中操作。不存在 generic action/delete tender/自动审批或新的 Workflow 元组。招标代理是共享选择字典，view/edit 均沿用 opportunity；创建字典不赋予任一投标访问权。

## 输入与重放

创建 name/owner_uid 必填；code 由 actor/操作/原键派生的 operation UUID 稳定生成，初始状态 info_gathering。可不关联 opportunity；customer、opportunity、contact、agency 引用均由 Runtime 查询存在性、范围和客户 pair。更新/团队/节点写入必须携 **父投标** expectedVersion，不是子行版本；路由父子 ID 不可被 body 覆盖。

金额为非负十进制字符串（最多16位整数、2位小数）；日期 YYYY-MM-DD。明确白名单，不接受审核事实、created_by/updated_by、actor、授权或任意 DB 字段。状态与招标方式沿用原投标枚举，无新增自动状态推进。done 节点由服务端记录 completed_at，离开 done 时清空，不接受前端完成时间。

Idempotency-Key 必填且同意图重试，使用现有 service_command_receipt，无新回执表。主写/父版本推进/audit/receipt 在同一 caller-Tx；任何失败整体回滚。重新读取当前范围和关联对象后才读旧回执，复放不以缓存权限复活撤权。团队移除后原键可重放。成员分工不改 Directory 或应用授权。用户/部门选择复用 Foundation 共享目录；没有本批 Directory 写入/新增 grant。

读取 COUNT/分页同一快照、pageSize≤100；详情还核对当前关联客户/商机同一 opportunity 范围，当前不可读关联不会变成空数据。响应由 Host 字段白名单重建，未返回审计内部数据或服务凭据。

## 四表安装与回滚候选

Canonical DDL 在 docs/Enterprise-APF-Domain-Design.sql 的 APF-16a 段；嵌入规格为 domaininstall/altoc_tenders.json。四表是 altoc_tender、altoc_tender_agency、altoc_tender_member、altoc_tender_milestone，无 FK/CASCADE。旧冷库不迁移。

先 WithAltocTenders 纯映射准备，再 ForAltocTenders.PlanInstall → reviewHash → 已批准停止 Runtime → Apply（迁移锁/非零 generation/既有 baseline）→ VerifyReceipt。这里只交付库接口和隔离演练，CLI 入口由安装工具负责人另行衔接，本批不修改 hzy-enterprise-add-apf。真实安装/Registry 配置/启用必须单独批准。

Rollback 只删除 receipt 所记自建且摘要未变、无业务数据及外部 FK 的四表，验证既有域 baseline；已有业务数据时拒绝 DROP，不能假装可无损撤销。整体 Fixture 在隔离数据库由 t.Cleanup DROP 清理，不连接 hzy0/生产。

## 页面

列表遵守页头/描述/新建、显式权限加载及失败提示、debounced 搜索、表加载/中文空态/共N条和真实分页。新建与编辑使用独立内容区，按基本信息、日期金额、联系复盘分组；必填标星，负责人/部门用共享选择组件，姓名由批量目录读取。详情主操作只有编辑，团队/节点用 neutral/outline；移除用 useConfirm danger。390 宽度使用单列、页头动作换行、表格局部横滚；真实浏览器验收待候选部署统一安排。
