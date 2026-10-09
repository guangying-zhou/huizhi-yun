# Host 线索与商机主链（APF-07a）

本批新增 15 个固定 U 操作。服务能力仅 `altoc:enterprise-host:execute`，不新增 grant。每次命令都带经 Foundation 唯一 scoped helper 计算的短期许可，绑定 actor/tenant/Host deployment、操作、对象 ID、完整意图、策略版本和 fresh token HMAC。Runtime 对 source 与 target 当前 owner/dept 事实重新求值，读取旧 receipt 前也必须复核。

| Host 方法与路径 | 固定操作后缀 | 人员门槛 |
|---|---|---|
| POST /altoc/api/v1/leads | leads-create | lead:edit |
| PATCH /altoc/api/v1/leads/:leadId | leads-update | lead:edit |
| POST /altoc/api/v1/leads/:leadId/assign | leads-assign | lead:assign |
| POST /altoc/api/v1/leads/:leadId/disqualify | leads-disqualify | lead:disqualify |
| POST /altoc/api/v1/leads/:leadId/convert | leads-convert | lead:convert |
| POST /altoc/api/v1/leads/:leadId/activity | lead-activities-create | lead:activity |
| POST /altoc/api/v1/opportunities | opportunities-create | opportunity:edit |
| PATCH /altoc/api/v1/opportunities/:opportunityId | opportunities-update | opportunity:edit |
| POST /altoc/api/v1/opportunities/:opportunityId/assign | opportunities-assign | opportunity:assign |
| POST /altoc/api/v1/opportunities/:opportunityId/transition | opportunities-transition | opportunity:transition |
| POST /altoc/api/v1/opportunities/:opportunityId/close-won | opportunities-close-won | opportunity:transition |
| POST /altoc/api/v1/opportunities/:opportunityId/close-lost | opportunities-close-lost | opportunity:transition |
| POST /altoc/api/v1/opportunities/:opportunityId/pause | opportunities-pause | opportunity:transition |
| POST /altoc/api/v1/opportunities/:opportunityId/reopen | opportunities-reopen | opportunity:transition |
| POST /altoc/api/v1/opportunities/:opportunityId/activity | opportunity-activities-create | opportunity:activity |

Foundation 名称为 `altoc.apf07-<后缀>`。所有 Runtime 路由仅 POST，路径 `/v1/enterprise/altoc/<实体>:<动作>`，正文 `{sales:{id,payload},authorization}`。create 的 id 为空；其余要求正整数 ID、payload.expectedVersion 当前 row_version。稳定 Idempotency-Key 必须存在，同键同意图回放原版本快照，改意图 409；写入、审计、receipt 在同一 caller-Tx。预检失败不留下 receipt。列表和详情复用既有固定读取操作；B2 投影增加 row_version、owner_uid 及白名单业务字段，COUNT/分页同 snapshot，详情的阶段选项限当前管道、最多 100 项。

## 转化与锁序

全局域锁序 People→Altoc→Aims→Assets→Finance→Workflow；本段只写 Altoc。Altoc 命令先锁同一阶段 gate，后锁源和目标行，避免两路反向转化的锁序倒置。Registry generation 的共享栅栏保持不变，不升级独占。

线索 convert 不接受 caller 提供的“已存在/已授权”事实。当前源范围、资格、目标负责人/部门、已有客户、客户下联系人、已有商机均在事务内复核。未指定客户时按标准化名称匹配；匹配后的范围也必须满足，不可因缺权限新建同名绕过。客户/联系人/商机/联系人角色/转化记录/源线索/跟进任务/审计/receipt 同事务。已有进行中商机要求明确 ack_similar_opportunity。重放前再验源、已转化目标及联系人是否存在，不靠旧回执恢复已撤权对象。

## 状态与错误

浏览器不得传 status、actor、审核结果、赢单时间或源部署事实。阶段推进核对当前/目标同管道、目标可用、required_fields 与退出条件；关闭理由不可缺失，重新打开仅针对关闭对象。服务端维护状态/版本/时间、阶段日志和跟进任务。已转化/已作废线索禁止追加修改。400 输入或版本形状无效；403 人员范围/动作拒绝；404 源/目标不存在或不可见；409 CAS、意图冲突或领域门槛；503 依赖不可用。DB 错误不得作为页面原始消息。

## 本批边界

不引入审批，不开放支撑与关系/文档剩余 14 个操作。八表安装仅候选；既有 APF 30 表不改。阶段种子沿用 canonical 配置，执行和 Registry 发布另需批准；未安装或未配置失败关闭。所有隔离夹具在测试结束删除整个独立临时数据库。

## APF-07b：支撑、关系与文档（14 个固定 U 操作）

使用 `altoc:enterprise-host:execute`，不是新的能力或 grant。Host REST 位于 `/altoc/api/v1`；Runtime 始终 POST，`/v1/enterprise/altoc/<entity>:<action>`。继续使用签名 `sales: { id, payload }`，其中 id 是 owning 线索/商机 ID，不是关系 ID；所有 payload 字段均参与原 TS/Go canonical HMAC。

|Runtime entity:action|Host 路径/方法|人员门槛|
|---|---|---|
|lead-activities:list|GET leads/:leadId/activities|lead:view|
|opportunity-activities:list|GET opportunities/:opportunityId/activities|opportunity:view|
|opportunity-contact-roles:list/create/update/delete|GET/POST opportunities/:opportunityId/contact-roles；PATCH/DELETE 同路径/:childId|读取 opportunity:view；写 opportunity:edit|
|opportunity-stages:list|GET config/opportunity-stages|purpose=opportunity-view：opportunity:view；purpose=lead-convert：lead:convert|
|opportunity-stage-history:list|GET opportunities/:opportunityId/stage-history|opportunity:view|
|lead-documents:list/create/delete|GET/POST leads/:leadId/documents；DELETE 同路径/:childId|读 lead:view；写 lead:edit|
|opportunity-documents:list/create/delete|GET/POST opportunities/:opportunityId/documents；DELETE 同路径/:childId|读 opportunity:view；写 opportunity:edit|

读取 payload 为 `{page,pageSize}`（1..100），配置读取另带闭集 purpose，仅返回 default pipeline；COUNT 与分页、父对象范围事实使用 Registry generation 栅栏下的同一快照，父对象不可见时先拒绝。写操作必带稳定 `Idempotency-Key` 与父对象的 `expectedVersion`。联系人 create/update 另带 `contactId,role,influence_level,attitude,is_primary,remark?`；更新/删除的 childId 只来自路由。联系人必须是商机当前客户下的未删除联系人；主要联系人切换同事务清除原标记。文档 create 只接受 `document_uuid,link_type`，不接收路径、ACL、来源 app 或外部 URL。

写入锁序与 APF-07a 一致：Registry generation → canonical stage gate → 父对象 → 当前子对象/目标联系人；先复核当前范围与归属，再读旧 receipt。提交前条件核对父版本；主写、父版本递增、审计、回执在同一 caller transaction。一项失败整体回滚；CAS/唯一键冲突 409，依赖失败不当作无权。

文档创建由 Runtime 注入 Codocs owning 当前用户 ACL reader（复用 `ReadProductDocumentForEnterprise(..., false)`），不以 Altoc 范围或关联代替 Codocs view，不增加正文/附件/权限关系。每次包括同键重放都重新核验源 ACL，未知 UUID 404、无权 403、依赖不可用 503。删除只软删 `altoc_document_link` 引用，不要求仍有 Codocs view；同键重放不重复推进父版本。删除后的引用可用新键重新关联（先重验源 ACL，复用原引用行），活跃重复关联 409。

列表返回关联元数据白名单，不提供 Codocs 正文、OSS 路径或独立访问令牌。每页引用按当前 Codocs ACL 复核标题；无权或文档不存在时保留可解绑的引用 ID，但隐藏标题/UUID，标记 readable=false；依赖失败整页 503，不能伪装成无权。COUNT 是当前父对象引用数，不受标题降级影响。目标文档阅读仍走 Codocs 自身读取权限；不会因关联向其他人授予文档访问。联系人和阶段历史返回权威名称，不把内部阶段 ID 作为页面名称。
