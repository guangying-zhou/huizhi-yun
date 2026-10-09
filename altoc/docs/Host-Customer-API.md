# Enterprise Altoc WP4a 客户合同（候选）

基于 APF 新 schema；不迁移旧库。沿用客户列表/详情的 Host 路径 `/altoc/api/v1/customers` 和 `/:customerId`，页为 `/altoc/customers` 与 `/:customerId`。读取人员门槛 customer:view，写入 customer:edit；复用 Altoc 既有 scoped 数据范围编译和 Runtime 权威 owner/dept 匹配，不新增人员资源或 capability。

## 10 个新增固定操作

全部内部 POST、固定前缀 `/v1/enterprise/altoc/`、服务能力 `altoc:enterprise-host:execute`；Host BFF 无 DB 凭据。

|Host 后缀（前缀 /altoc/api/v1/customers）|方法|Runtime 固定操作|
|---|---|---|
|空|POST|customers:create|
|/:customerId|PATCH|customers:update|
|/:customerId/owner|PATCH|customers:set-owner|
|/:customerId/contacts|POST|contacts:create|
|/:customerId/contacts/:childCode|PATCH / DELETE|contacts:update / contacts:delete|
|/:customerId/invoice-profiles|POST|invoice-profiles:create|
|/:customerId/invoice-profiles/:childCode|PATCH / DELETE|invoice-profiles:update / invoice-profiles:delete|
|/:customerId/invoice-profiles/:childCode/default|POST|invoice-profiles:set-default|

JSON 字段采用新 schema snake_case；create 的编码由服务端按 tenant/deployment/actor/operation/key 派生，CU-/CN-/CIP-，不能由调用方提供。非 create 必带 expectedVersion（当前 row_version）；DELETE 也携 JSON body。Idempotency-Key 必需，固定意图重试原键，变意图换键。客户端不提供 approved/status（客户）、workflow事实、外部导入身份、审计或客户父键。联系人与开票资料 active/inactive 可编辑；开票资料可 is_default，专门设默认只接受 expectedVersion。

字段白名单在 enterpriseapf/altoc_customers.go，读取白名单与之对应，明确排除内部 Workflow、审计、外部系统同步列。首批编辑客户基础信息、负责人/部门，联系人基础信息、开票抬头与收件资料；客户类型/等级字典维护、客户审批、客户父子结构、外部客户导入不属于本段，不开放写入入口。仅预留外部导入事实，不导入冷存档。

响应：读保持 `{code:0,data:{items,total,page,pageSize}}` / `{code:0,data:customer}`；详情带 contacts / invoice_profiles 两集合与 row_version。写 `{data:原操作版本快照}`。列表 COUNT/分页在同一快照、范围过滤先于COUNT；详情和子集合在同一快照读取。设置页客户信息表不返回 secret/token/内部context。

## 事务、默认资料与回执

Registry generation → 客户行 FOR UPDATE → 当前客户范围 → 子行及其 owning customer → receipt → 版本校验 → mutation/审计/receipt → commit。子code不能来自其它客户；create/set-owner还核对目标 owner/dept 不越过同一签名范围，旧键重试也重新核对当前客户。负责人调整未传部门时保留原部门。

每客户至多一条 active、未删除的默认资料（schema生成列唯一约束）。设默认会在客户锁内取消此前默认并递增其 row_version；目标须 active。删除为软删除，只删当前客户的联系人/开票资料，审计/回执保留；本段无客户删除。历史快照存既有 altoc_audit_log，receipt绑定版本及摘要，重放返回原快照，不把后来修改的版本当原结果。

400 字段/版本格式/缺键；403 身份、permit、范围或目标负责人越范围；404 客户/子资料不存在或属于另一客户；409 版本冲突、同键变意图、已删除新写/并发冲突；依赖故障503。反例包含大小写精确uid、跨客户、撤权旧键及部门范围。审批不在WP4a，不允许客户PATCH伪造批准状态。

## 验证限制

本段仅代码与自清理隔离库；无真实环境、真实签发、部署和登录浏览器操作。页面以SFC编译、类型检查及契约验证为证据，登录/1440/390视觉与交互验收待另行授权安排。

## W3 第6批：只读扩展

复用既有 `customer:view`、`contract:view`、`bank_accounts:view`、`migration_exceptions:view` 与固定读取操作，不新增 capability/grant/schema。列表、详情分别由服务端授权；来源信息在所属对象通过范围检查后，以 Registry 快照事务读取迁移台账。仅返回 `system/table/pk/batchCode/importedAt`，不返回源 JSON。

- 客户 list/detail 返回 `customer_level_id`（NULL 保持）及已有字典 `customer_level_name`；不与信用等级混用。联系人来源随受控客户详情返回；账户来源仅在账户详情返回。
- `GET /altoc/api/v1/contracts?parentContractId=<id>&page=&pageSize=`：仅当前合同范围内的直接下级合同；W1 列未装时为空，不恢复宽读取。
- 同一合同 list 的 `customerIds=2,3`（最多100个不同正整数，无 customerId/includeDescendants）返回 `customerSummaries`：一次批量分组，各客户的可见销售合同（排除 terminated）count/amounts，按币种分开；只用合同范围，不查询客户名称或存在性，不返回不可见计数。无可见合同与客户不存在都返回零。

Finance 扩展详见 W3 页面设计第6批。


## B2 客户工作区只读扩展

复用 customer:view 许可与原固定读操作，不新增 capability、grant 或 schema。
客户列表可选 ownerUid、industryCode、regionCode、updatedDateFrom/updatedDateTo、customerSort（updated_desc/updated_asc/id_asc）。日期按上海业务日过滤；无 sort 的旧调用保持编号排序。
详情 workspace=true 只读取客户与开票资料，不展开完整联系人集合。
GET /altoc/api/v1/customers/:customerId/contacts 提供 page/pageSize/search/status/decisionRole/primaryOnly/starredOnly，默认主联系人优先（字段已安装时）、星级降序（字段已安装时）、编号升序。先验证拥有客户的范围，再统计和分页；字段未安装时主联系人/星级筛选返回 503。来源信息仅当前页白名单投影。
全部新增参数仅有值时按固定顺序追加到 Go/TS 签名；旧七条金向量不变。合同页签及合同额沿用 contract:view 独立范围，不混用 customer:view；金额是本客户可见销售合同现有分币种汇总，不包含下级客户或新 R3 指标。范围外客户不泄露数量。
