# Enterprise 合同主链（WP4c）

仅统一 APF Altoc 域；12 个固定 U 操作，服务能力均为 `altoc:enterprise-host:execute`，不新增 grant。Host 当前 Console scoped `contract:view/edit` 签入 ≤15 秒、token-bound APF permit，Runtime 再判 actor/tenant/Host deployment、对象范围、版本和状态。未启用 APF 的独立 Altoc 路径不因此放宽。

## 操作

Host 前缀 `/altoc/api/v1/contracts`；Runtime 前缀 `/v1/enterprise/altoc`，均固定 POST，不能传 SQL、表、目标能力或 actor。

| Host 路径 / method | Runtime 后缀 | 人员动作 |
| --- | --- | --- |
| `/` POST | `contracts:create` | contract:edit |
| `/from-quotation` POST | `contracts-from:quotation` | contract:edit |
| `/:contractId` PATCH | `contracts:update` | contract:edit |
| `/:contractId/lines` PATCH | `contract-lines:replace` | contract:edit |
| `/:contractId/payment-terms` PATCH | `payment-terms:replace` | contract:edit |
| `/:contractId/obligations` PATCH | `obligations:replace` | contract:edit |
| `/:contractId/obligations/transition` POST | `obligations:transition` | contract:edit |
| `/:contractId/billing-schedules` GET | `billing-schedules:list` | contract:view |
| `/:contractId/sign` POST | `contracts:sign` | contract:edit |
| `/:contractId/activate` POST | `contracts:activate` | contract:edit + Aims 对象许可 |
| `/:contractId/projects` POST | `contract-projects:bind` | contract:edit + Aims 对象许可 |
| `/:contractId/projects` GET | `contract-projects:list` | contract:view |

原合同列表/详情 U 读取在 APF 服务存在时读新表，服务端同快照 COUNT/分页，字段白名单；详情单集合最多500行，超限503而非截断成功。两独立子集合读取最多100行/页。

## 输入、状态与派生

创建 `{customerId,name,currency_code,...}` 或由正式 approved/accepted 报价 `{quotationId,name,...}` 转换，合同编码服务端稳定派生。更新/集合替换/状态动作都带 `expectedVersion`。禁止写入 owner/status/approved_by/金额汇总。集合替换以 `rows` 全量表达、已有子行仅可用本合同 id；不能跨合同搬迁。

草稿/rejected 才可修改内容、行、条款和义务；签署仅 approved/effective，可在批准后推进 legal/fulfillment/activation 四轴。**APF12 候选已接正式 Workflow**：独立 POST `/altoc/api/v1/contracts/:contractId/submit` 仅接受 expectedVersion 与 Idempotency-Key，人员条件仍为 contract:edit。草稿/退回可提交；不开放浏览器 approve/reject，不将义务 submit 当作合同审批。

decimal 必须传字符串；数量18,4、金额18,2，税率/比例0–100，精确有理数计算后按金额两位舍入。报价转换保留原折扣后的含税金额。行生成交付义务；需验收时另生成验收义务，默认计划绑定验收。默认行计划与付款条款计划各保留 source 类型（沿用已审设计的两来源派生，不能在财务汇总时把合同金额再次从计划合计覆盖）。行/合同级 ratio 基数分别取对应金额。月/季/年周期最多120期，日期无效或倒序拒绝。条款重算只允许计划尚未实际开票/收款时执行。

义务动作 start/submit/accept/reject 在 effective 合同上按原状态门槛执行；reject 必带原因，履约或验收完成只将匹配义务触发的 planned 计划推进 billable，不伪造 Finance 发票/收款。被计划引用的义务不能换到另一行或删除。

## caller-Tx 项目与里程碑

`projects` 是最多50个计划，含 `projectCode/name/deptCode/create/lineCodes/obligationCodes/billingScheduleCodes`。全部是稳定业务编码，项目 ID/目录事实由 Runtime 权威读取，项目编码遵守现有 Aims uppercase/hyphen 规范。当前阶段 line_rel 的 allocation_method=unallocated，不自动均分、多行多项目成本分摊另走正式核算功能。

Host 使用 Foundation 唯一 `loadProjectCommandAuthorization` 计算 Aims `projects:create`（新建）或 `projects:edit`（关联现有）；生成里程碑另须现有 `projects:edit`，不是不存在的 milestones 权限。Aims 许可完整签入 APF HMAC，不能由 body/query 直接指定。目录子树在开业务锁前由 Runtime Directory 读取，缺事实503。

Registry 多域 Resolve 校验同数据库/非零generation，Altoc caller 创建事务。锁序固定 People→Altoc→Aims→Assets→Finance→Workflow；未参加域跳过。当前 Altoc customer→quotation（转换时）→contract→line→payment_term→obligation→billing_schedule→project_link，再 Aims project（编码排序）→member→milestone。无锁内网络/策略读取，不从 Aims 调回 Altoc。

Aims owning `PrepareContractProjectsTx` 锁内根据成员/leader/creator计算范围，创建前关系全false，不让输入 leader 自授；再由不透明且绑定同tx/actor/合同的 preflight 交给 `ApplyContractProjectsTx`。Aims 操作不开始/提交事务，项目/经理成员/计数行/lifecycle/里程碑及Altoc关联/receipt/audit同事务。新项目为draft/project_team/L1，操作人负责人。已归其它合同或已归档项目拒绝。结算计划只能分配给一个项目的里程碑；本合同 line/obligation/schedule 归属全预检。

D-06：canonical `milestones.billing_schedule_code`；统一库物理 `aims_milestones` 加可空VARCHAR64及索引，并刷新兼容视图。`aims/docs/migration_v6.0_milestone_billing_schedule*.sql` 仅候选，必须批准停Runtime窗口才能执行；有任何绑定时rollback拒绝删列。**AA-04 里程碑到结算自动回写保持关闭**，此批只创建稳定关联，不新增回调能力。

## 幂等与错误

复用APF已有service_command_receipt和audit version快照，无新receipt表。写Idempotency-Key固定ASCII≤100；同意图回放原版本，改变意图409。业务摘要包含完整payload/项目计划，但排除短期Aims许可；HMAC包含这些许可。每次重放先重判当前合同范围/项目许可，撤权不能靠旧receipt绕过。首次业务Mutation与receipt/audit同事务，任何一步失败整笔rollback。

400输入/键非法；403许可/范围/子对象错归属；404不可见对象；409版本/状态/已结算/项目冲突或覆盖不完整；503目录/Registry/数据库依赖不可用。

## 验证与缺口

隔离MySQL临时库自清理，验证多行多项目、两域rollback、反向计划顺序并发、同键/新鲜许可重放无重复、付款比例/周期/义务、批准前签署拒绝、D06物理列与视图。TS/Go共用合同permit黄金夹具，Host malformed/无权限前置拒绝及页面SFC测试。

未做环境切换/DDL/grant写入/浏览器现网验收。生产/本机APF安装与D06迁移须另批准。候选审批接线须另行授权安装并验收，AA04自动回写、分摊编辑不是本批已上线功能。

## APF12 合同审批

新增 U 固定操作 `contract-approval:request/bind`，与报价共用窄的冻结/实例只读核对合同、受信回调闭集及三类幂等回执；参见 Host-Quotation-API.md APF12 节。合同冻结包含表头、行、付款条款和义务；审批结果同步 status/legal_status。系统操作冻结为 approval:pending、approval:bind、approval:callback，总新增7项，未新增 capability 或人员 grant。现有义务 obligations:transition 接口与权限不变。
