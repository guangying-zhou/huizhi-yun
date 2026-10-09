# 项目需求 Host API（R1a）

本批只恢复规格书及需求内容的基本读写。基础能力始终为
`aims:enterprise-host:execute`，人员与对象授权另外验证。

| 固定 operation（`aims.` 前缀） | Runtime POST 后缀（`/v1/enterprise/aims/project-requirements:`） | Host API（`/enterprise/aims/api/v1`） |
|---|---|---|
| project-requirement-target-list | targets | GET /projects/:id/requirement-targets |
| project-requirement-spec-view | spec | GET /projects/:id/requirements/spec |
| project-requirement-create | create | POST /projects/:id/requirements |
| project-requirement-content-create | content-create | POST /projects/:id/requirement-contents |
| project-requirement-import | import | POST /projects/:id/requirements/import |
| project-requirement-update | update | PATCH /requirements/:reqId |
| project-requirement-delete | delete | DELETE /requirements/:reqId |
| project-requirement-content-update | content-update | PATCH /requirement-contents/:contentId |
| project-requirement-content-delete | content-delete | DELETE /requirement-contents/:contentId |
| project-requirement-content-restore | content-restore | POST /requirement-contents/:contentId/restore |

既有需求 list/view 固定操作继续使用。本批不开放历史、差异、评审或任务生成写入。

## 输入与回执

写请求必须携带 `Idempotency-Key`。项目路由以 `:id` 为准；全局对象路由的 body 必须
包含 `projectId`，Runtime 在锁内核对其 owning project，不依赖请求自报归属。请求
字段按动作白名单检查；不允许 `status`、`approvedBy`、权限事实或 URL query。普通
需求表单为 title/type/priority/source；章节为 kind/title/parentId/headingDepth/contentMd。

导入使用原 Wizard 形状 source/docName/codocsUuid 或固定 repoProjectCode、repoFilePath、
repoCommitId，以及 mode/headingLevels/items/workItemId/forceOverwrite。每次重放仍
先核来源可读。正文不得进入回执；成功返回稳定 receiptId、idempotent 与紧凑结果。
章节创建返回 childContentCount（独立端原 childContentIds 仍兼容展示）。

## 读取与错误

列表默认排除 deprecated；支持类型、优先级、来源、里程碑、target 和搜索，pageSize
1–100。COUNT、状态统计及当前页使用同一快照。规格书支持 include_deleted=0/1；
超过 10000 章节或 1000 targets 返回 503，不返回部分结果。

400：非法字段/参数/缺幂等键；403：人员或范围/当前关系不符、过期许可；404：对象
不存在；409：非 active、锁定内容、同键不同载荷、覆盖需确认或回执结果不可用。
评审批准/退回不接受浏览器标志，后续 R1c 由正式 Workflow 结果驱动。

## R1b：历史、变更与评审准备

新增固定 U 操作（仍为 `aims:enterprise-host:execute`）：

| operation 后缀（前缀 `aims.project-requirement-`） | Host API（前缀 `/aims/api/v1`） | Runtime 后缀 |
|---|---|---|
| versions | GET /requirements/:reqId/versions | versions |
| change-diff | GET /requirements/:reqId/change-diff | change-diff |
| change-impact | GET /requirements/:reqId/change-impact | change-impact |
| change-create | POST /requirements/:reqId/changes | change-create |
| task-create | POST /requirements/:reqId/create-task | task-create |
| review-list | GET /projects/:id/requirement-reviews | review-list |
| review-create | POST /projects/:id/requirement-reviews | review-create |
| review-resolve | GET /requirement-reviews/:batchId/resolve | review-resolve |
| review-append | POST /requirement-reviews/:batchId/append | review-append |
| review-withdraw | POST /requirement-reviews/:batchId/withdraw | review-withdraw |

Runtime 路径均为 POST `/v1/enterprise/aims/project-requirements:<后缀>`。
全局对象 GET 必须带唯一 `projectId` query；写入通过 body 的 `projectId` 绑定 owning
project。项目级路径不接受矛盾的 projectId；read 不接受其它 query。全部写必须有
稳定 Idempotency-Key。Host 计算 `requirements:edit` scoped permit，Runtime 锁项目、
复核当前管理关系与范围、锁目标及批次全量引用后才读回执。版本/差异/影响与 resolve
先核 project-view 范围及对象归属；历史、内容、批次引用在同一读取快照内取得。
原需求基线、活动里程碑、已有任务、进行中变更、批次未提交 Workflow 等领域门槛保留。

准备批次仅允许创建/追加/撤回，不提供 approve/reject/sync 入站接口。R1c 前提交
Workflow 的按钮保持禁用，现有正式批准结果可以读取，但浏览器不能制造批准结果。
撤回已提交 Workflow 的批次继续 409 `batch_in_workflow`；跨项目引用 403/404；无管理
关系及撤权后的旧键仍 403。项目内已删除的准备批次仅能回放同键既有回执。

回执仍复用 `service_command_receipt`，无新表。R1b 在 target_biz_code 内用 `r2.`
前缀的 raw-DEFLATE/base64url 冻结原结果（ID/编号/状态/计数及实际任务标题），不从
可变行重建结果；解码限制 8192 字节，列编码仍限制 191 字节，超限 409 且整笔回滚。
R1a `r1.` 编码不变；此编码为内部回执格式，不是服务 scope 或新的业务 capability。

## R1c：正式评审与批量生成任务

| 固定 U operation | Runtime POST 后缀 | Host API |
| --- | --- | --- |
| aims.project-requirement-review-sync | review-sync | POST /aims/api/v1/requirement-reviews/:batchId/sync-workflow |
| aims.project-requirement-review-create-tasks | review-create-tasks | POST /aims/api/v1/requirement-reviews/:batchId/create-tasks |

两条只接受 `{projectId}` 的浏览器 body；不得提供实例、结果、操作者或 formData。
Runtime U body input 为 `{}`，requirements:edit 短期范围 permit 绑定项目/批次，当前
负责人/经理/范围管理员门槛保持。只有批次创建人可发起 sync；生成任务需批次已通过。

sync 是幂等对账而非重复提交结果：Registry 栅栏和项目/批次锁内冻结当前需求、关联
章节、变更父项的摘要。既有 VARCHAR(128) workflow_instance_id 存储内部绑定
`rrb:pending:<sha256>` 或 `rrb:<instanceId>:<sha256>`，不新增 DDL；列表只以非空值
表示已准备/已绑定，不能把这个内部值当成 Workflow URL。准备一旦冻结，即不能追加
或直接撤回；创建依赖失败时修复配置后按同一批次重试。历史非 rrb 绑定拒绝自动迁入，
返回 409 review_legacy_workflow_binding，须另行对账，不猜测快照。

Host 用 Runtime 返回的精确 formData 调用既有 Enterprise Workflow prepare/create
通道，requestNo=`RRB-<batchId>-<snapshotHash>`；Workflow 锁 action definition，按
同一业务批次复核全部 form 后返回原实例（包括终态），不复用其它批次的拒绝实例。
响应丢失时 Host 重试 sync，Runtime 通过构造时注入的只读 Workflow owning 接口找到
原实例并绑定；不接受客户端的实例 ID，不签新的桥。

结果仅由 P1 Enterprise `/enterprise/api/v1/service/workflow/callback` 入站校验后走
`aims:scheduler:execute` 系统通道推进。Runtime 再读正式实例，核对 app/resource/action、
业务批次、发起人、实例、完整表单和终态；通过时须有正式审批行动的操作者证据。
回调使用 beginBoundEnterpriseTransaction，锁项目→批次→需求，校验冻结摘要及所有
关联归属后复用领域 approve/reject 核心同事务落批次、章节/需求状态、版本快照。
重复同结果成功但不再写版本，矛盾结果 409；取消按拒绝领域规则回退。浏览器
onApproved 不做状态写入，无用户 approve/reject 固定操作。

create-tasks 同事务全量归属预检，复用既有任务生成规则与 service_command_receipt；
回执冻结 batchId/createdCount/skippedCount 摘要，避免大批次结果超过回执字段上限。
原任务已有或不满足领域条件者沿用原 skipped 规则；权限/跨项目/数据库失败不部分成功。
重放前仍核当前范围/经理关系；无计数行项目沿用 MAX(item_number) 初始化逻辑。

### R1c 评审状态编码与恢复（R2a 补充 S1–S4）

既有 `requirement_review_batches.workflow_instance_id` 的编码固定如下：

| 数据值 | 含义与处理 |
| --- | --- |
| NULL | 尚未冻结；准备事务计算正式快照 |
| rrb:pending:<64位hex SHA-256> | 快照已冻结，实例创建/绑定可能尚未完成；sync 通过固定 requestNo 找回原实例 |
| rrb:<正整数实例ID>:<同一 SHA-256> | 绑定正式实例；不得改ID或重算已冻结摘要 |
| 旧未带rrb的实例值、畸形rrb值 | 历史/无效绑定，自动sync返回409 review_legacy_workflow_binding，不能猜测或覆盖 |

该字段不是审批状态，也不是 outbox 投递状态：即使 Workflow callback 已 abandoned，绑定仍保持原实例与原摘要，Aims 批次/需求仍 pending/in_review。审批结果唯一来源是正式 Workflow 回调及 owning reader 的当前实例；不把 abandoned 当成 rejected/approved。

Runtime 只注入一次 `AimsWorkflowInstanceReader` 接口，含 `ReadProjectLifecycleInstance` 与 `ReadAimsRequirementReviewInstance` 两个窄只读方法；Aims 不反向导入 Workflow。需求 reader 返回的4xx状态及固定机器码原样透传；非4xx依赖故障映射503 requirement_workflow_unavailable，不误报缺权。

需求 update/delete 在锁定领域行后对 in_review/change_pending 固定409 requirement_locked；关联内容编辑/删除仍有 content_requirement_locked 守卫。在审不能通过浏览器标志、sync、修改内容或删除来解除冻结。callback abandoned 后，经受控 Workflow delivery recovery/replay（审批、原 effect ID、expectedVersion、原幂等键，见根 Workflow-Bounded-Delivery-Runbook）恢复原投递，再按原正式结果完成回写；不得重新决策、直接改数据库状态或新建实例来“解锁”。sync只对账创建/绑定，不能代替 abandoned callback 恢复。重投同一正式结果已有 alreadyApplied 幂等检查。
