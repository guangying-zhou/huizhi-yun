# Host 离职事项与资产协调

APF-17b 承接 R17-03/04/05/07。代码、安装候选与隔离测试不表示环境已经启用；本批没有执行安装、授权或配置变更。

## 页面与固定操作

列表 `/people/offboarding`，详情 `/people/offboarding/:id`。所有浏览器接口位于 `/enterprise/api/apf/people/offboarding`，固定 Runtime 路径前缀为 `/v1/enterprise/people/offboarding-cases:`。复用 `people:enterprise-host:execute`，不新增 capability 或 grant。

| 方法与路径 | 固定操作 | 人员资源与动作 |
| --- | --- | --- |
| GET `/` | `offboarding-list` | `offboarding_tasks:view` |
| GET `/:id` | `offboarding-view` | `offboarding_tasks:view` |
| POST `/` | `offboarding-create` | `offboarding_tasks:admin` |
| POST `/:id/arrange` | `offboarding-arrange` | `offboarding_tasks:admin` |
| POST `/:id/confirm` | `offboarding-confirm` | `offboarding_tasks:confirm` |
| POST `/:id/cancel` | `offboarding-cancel` | `offboarding_tasks:cancel` |

`admin` 不蕴含 `confirm` 或 `cancel`。Foundation 读取当前 scoped authorization，签名绑定 actor、tenant、deployment、资源、动作、操作、对象、完整意图与短期有效期。Runtime 复核同一许可并在 Registry generation 栅栏内执行。列表 COUNT、分页和详情使用同一快照；无范围返回 403，不当作全租户范围。

全局与部门范围分别匹配当前员工事实；subject:self 只允许读取本人负责的任务。离职员工 UID 本身不构成责任关系。写入前检查当前范围，原键重放也不绕过撤权。

## 参数与状态

列表参数为 `page`（默认 1）、`pageSize`（默认 20，上限 100）、`search`（不超过 100 字符）。详情只接受路径 ID，不接受浏览器自报员工归属。

创建必须提交 `employeeUid` 与 `leaveAssignmentCode`。Runtime 从已批准或既有无需审批的离职任职事实派生日期，拒绝草稿、待审批、非离职及员工不匹配。稳定事项键取员工 UID 与离职日期；重复创建不产生第二份事项。

安排提交 `employeeUid`、当前 case 的 `expectedVersion`、`handoverResponsibleUid`、`handoverDueAt`、`assetRecoveryResponsibleUid`、`assetRecoveryDueAt`。两个责任人均须为当前 active 的 People 员工，且不能是离职人；期限必须显式提供 RFC3339 秒精度时间。允许提前安排，不提前修改账号或资产事实。界面时间输入明确使用 UTC。

确认提交 `employeeUid`、当前 case 的 `expectedVersion`、`taskType`；取消另需 1–500 字符 `reason`。`taskType` 只能是 `handover` 或 `asset_recovery_coordination`。资产协调完成要求离职已经生效、员工事实为 left，且当前 Assets 未归还集合为空；People 不代替 Assets 办理归还。

case 状态为 `awaiting_arrangement`、`active`、`completed`、`cancelled`。task 状态为 `pending`、`completed`、`cancelled`。首次自动生效只生成待安排 case，不猜测责任人或期限；两类任务在明确安排后建立。已结束的任务不能重新安排。仍有待办时 case 保持 active；全部完成时 completed；全部终态且包含取消时 cancelled。

取消 People 协调事项不会把未回收的 Assets 根事项设为 resolved，不延长登录、不扣薪、不写回钉钉。

## 事务与恢复

锁序：Registry generation SHARE → People 员工 UID 排序 → 任职 → case → task 类型排序 → Assets recovery 根 → asset_items ID 排序 → receipt。跨域写使用同一个 caller-Tx；Assets helper 不自行 Begin/Commit，不接收 trusted/source 标志，也不进行网络调用。

自动事项在现有离职生命周期冻结事务中生成。Console 登录冻结与 Platform 撤权继续使用现有独立可靠链；未归还资产不参与该链的完成条件。LDAP/邮箱独立回执与人工恢复属于 17c，通知 delivery 属于既有 Assets 提醒及后续 bounded 通道，不在本批伪造成功。

所有写入要求 `Idempotency-Key`。case/task、Assets 协调、原意图与 actor 的 `service_command_receipt` 同事务；CAS、业务失败或真实 SQL 故障全部回滚。原键同意图返回原 ID/版本，原键变意图返回 409。响应丢失时沿用同一冻结意图与键；未知效果不换键强制成功。409 后刷新比较并保留界面草稿。

主要错误：400 输入无效；403 身份或范围不符；404 当前范围内无对象；409 版本、状态、责任人、原键意图冲突或仍有未归还资产；503 子集、Registry 或 owning 域未就绪。权限加载失败、无权限、不可用与空数据在界面分别显示。

## 安装候选

`people-offboarding` 依赖 `people-facts`，只新增 `people_offboarding_cases` 与 `people_offboarding_tasks`。DDL 见 `people_enterprise_offboarding_schema.sql`；使用 `hzy-enterprise-add-apf --subset people-offboarding` 的 plan/apply/verify/rollback 分步协议，不能直接导入 SQL。沿用原 binding、reviewHash、真实停止检查、0600 plan/checkpoint、baseline/generation 检查。只交付候选，不执行。

安装前普通 binding 保持原逻辑；子集未安装时 Host 离职入口返回明确不可用。安装后自动 hook 使用映射表；半套映射或已映射表损坏失败关闭，不静默跳过。回滚使用安装器对应 receipt；必须按依赖逆序回滚，不能丢弃仍有业务数据的表。
