# Assets 模块

> 业务模块 — 企业资产与资源管理 | 端口 3004 | 状态：主干已接入 tenant-runtime（Phase 2 交付资产包完成） | 数据库：tenant-runtime 托管（默认 hzy_assets）
>
> 📖 涉及认证、目录、审批、共享组件或 Server API 复用时，按需查 [`docs/FOUNDATION_CAPABILITIES.md`](../docs/FOUNDATION_CAPABILITIES.md)；简单局部改动不需要预读。
>
> 📚 **分类口径** [`docs/ASSET_CLASSIFICATION_GUIDE.md`](./docs/ASSET_CLASSIFICATION_GUIDE.md) — 五大资产分类定义、边界判定、典型对象落类示例。

## 职责边界

**负责**：实物资产（笔记本/服务器）、资源资产（订阅/席位）、环境与交付视图、供应商管理、采购→入库→分配→退回→处置全流程、到期/配额预警、项目/部门/客户成本归因

**不负责**：项目执行（→ Aims）、客户/合同数据（→ Altoc）、文档（→ Codocs）、审批流转（→ Workflow）

## 数据归属原则

- 项目注册表与组织目录走 Console Directory API / Foundation adapter；迁移期 legacy 模块可继续兼容 Account
- 项目执行、版本、任务与交付进度只从 Aims 查询
- 客户/合同数据只从 Altoc 查询
- 审计文档只引用 Codocs 的 document_id，不存储内容
- 所有资产操作（采购→入库→分配→退回→报废）通过 Workflow 审批

## 依赖的模块

- **Console Directory / Foundation**：项目注册表、部门、用户查询和业务授权消费；Account 仅作为 legacy 迁移兼容。Assets 不读取本地 policy bundle，权限快照只经 Foundation/Console。
- **Aims**：项目执行、产品版本、交付进度与里程碑引用
- **Altoc**：客户/合同引用
- **Workflow**：采购/领用/分配/退回/报废审批动作定义与终态同步
- **Codocs**：文档引用（仅存 document_id）

## 一体化运营闭环 Phase 0 契约

首条闭环按 `docs/Huizhi-yun-Integrated-Operations-Roadmap.md` 与 `docs/MODULE_CONTRACTS.md` 执行：Assets 是客户交付视图、环境、资产、资产文档关联和资产成本归因的事实源。Assets 只保存 `customer_code`、`contract_code`、`project_code`、`document_uuid` 等稳定业务键，不复制 Altoc 合同主档、Aims 项目执行事实或 Finance 财务事实。

冻结的 service endpoint 目标：
- `POST /api/v1/service/deliveries/upsert`：按客户、合同、项目创建或更新交付视图。
- `POST /api/v1/service/deliveries/{deliveryCode}/documents`：关联交付文档。

调用方必须使用 Console service token，目标 `aud=assets`、`scope=assets:write`，写操作必须带 `Idempotency-Key`。现有用户侧 `/api/v1/deliveries/**` 可作为实现参考，但 service-only 合同需要独立鉴权和幂等处理。

## 一体化运营闭环 Phase 2 契约

Phase 2 已把交付视图推进为“交付资产包”：

- `POST /api/v1/service/deliveries/upsert` 已落地到 tenant-runtime，按 `delivery_code` 或 `contract_code + project_code` 幂等 upsert，保存 Altoc `customer_code/contract_code` 和 Aims `project_code` 稳定键。
- `POST /api/v1/service/deliveries/{deliveryCode}/documents` 已落地，允许 Aims / Altoc service caller；交付成果只保存 Codocs `document_uuid`，并用 `artifact_type` 标识九类成果：`solution`、`requirement`、`design`、`test_report`、`deployment_manual`、`acceptance_report`、`training_material`、`ops_knowledge`、`customer_environment_record`。UUID upsert 与首次 `document_linked` 事件在同一事务内提交，重放不重复事件；客户 / 合同 / 项目 source context 优先使用 Assets 交付视图事实。`ops_knowledge` 必须携带正式交付资产和环境，Assets 会校验 active `customer_delivery_asset_environment_rel` 及客户/合同/项目一致性，并把两项 code 写入 source context。
- `GET /api/v1/service/deliveries/package?customer_code=&contract_code=&project_code=` 返回客户 / 合同 / 项目交付资产包，`customer_code` 必填且三个维度精确 AND；除交付视图、产品、环境和 UUID 文档外，还返回正式 `customer_delivery_assets` 及 `customer_delivery_asset_environment_rel` 环境关系。接口绝不读取 Codocs 正文，缺 `artifact_type/source_context` schema 时失败关闭。
- `GET /api/v1/service/projects/{projectCode}/cost-summary?period_month=` 输出资产采购、资源订阅、环境投入和月度成本归集，供 Finance 项目核算写入成本分摊。
- 上述 `/api/v1/service/**` 入口在 Nuxt middleware 转发 tenant-runtime 前校验 Console service token；未登记 capability 的 service 后缀会在代理前拒绝，不得落到通用 runtime 转发。Assets 用户界面关联交付文档走 `/api/v1/deliveries/{deliveryCode}/documents` 用户路径，不调用 service-only endpoint。
- 服务令牌 introspection 只有明确 inactive/revoked/invalid 才返回 401；Console introspection 网络、5xx 或存储故障必须在读取业务 body、调用 handler 或 tenant-runtime mutation 前返回可重试 503。
- 采购单和资产操作均以 Workflow 为审批事实源：采购 submit 后进入 `pending_approval`；资产领用 / 分配 / 退回 / 报废操作默认 `pending`，只有 Workflow 同步为 approved 后才联动资产主档。
- 普通资产使用人的操作入口使用独立 `assignments:request`，不再复用 `assignments:edit`。自助请求只允许 `claim / return / release`：领用目标由 runtime 强制为当前用户，归还只允许本人当前使用的实物资产，释放只允许本人当前使用的资源资产；浏览器不能指定流程实例、操作编号、生效时间、审批人、终态或他人目标。分配、转移、续费、维修、回收权限、轮换密钥和报废继续要求管理侧 `assignments:edit`，审批终态要求 `assignments:approve`。

## 一体化运营闭环 P1 客户交付资产契约

P1 已新增 Assets 侧 `customer_delivery_assets` 主档，用于承接 Altoc 合同行生成的客户交付资产。该主档允许 `project_code` 为空，覆盖软件许可 / SaaS 等不需要 Aims 项目的销售合同；它只保存 Altoc `customer_code/contract_code/contract_line_code`、产品和生命周期状态等稳定引用，不复制合同商业条款。

已落地 service endpoint：
- `POST /api/v1/service/customer-delivery-assets/plans`：Altoc 履约启动时按计划资产批量 upsert 客户交付资产，返回 `delivery_asset_code` 供 Altoc 回填。
- `GET /api/v1/service/customer-delivery-assets/by-customer?customer_code=&contract_code=&project_code=` 和 `GET /api/v1/service/customer-delivery-assets/by-contract/{contractCode}`：按客户 / 合同 / 项目读取交付资产主档。
- `POST /api/v1/service/customer-delivery-assets/{deliveryAssetCode}/activate`：推进 delivered / online / accepted / suspended 等生命周期状态，并在同一 Assets 事务按目标相关事实 fingerprint 分配单调 `sourceRevision`、冻结 `occurredAt`、写 caller-owned `integration_operation`。同事实重放复用原 operation；online→suspended→online 会得到连续 revision。即时请求与默认关闭的 bounded drain 只按固定映射调用 Altoc `status:sync`；pending 返回 202。Altoc 业务更新和 succeeded receipt 同事务，并以正式 delivery asset 的 applied watermark 跳过乱序低 revision、拒绝同 revision 异 hash。

### Integration operation dead-letter actionable lifecycle

- Assets 对其 `customer_delivery_asset → Altoc status:sync` caller-owned operation 提供与 Aims/Altoc 相同的 dead-letter actionable source lifecycle：安全候选、publish ACK、closure 候选和 closure ACK 均以 `operation_id + generation`、tenant/deployment/source binding 和冻结 version 作 CAS；Console 实际收件 UID 会在 source 保存，禁止 `@all` 或隐式 fallback。
- `integration_operation_dead_letter_actionable` 是 durable generation 事实。进入 `dead_letter` 后按 operation version materialize；replay 事务写 `cancelled` closure，任何成功（包括幂等成功）事务写 `resolved` closure。旧 generation 未 closure ACK 前不得发布新 generation。
- Assets runtime notification detail descriptor 可为精确 `{resource: "integration_operation", id: UUID}`；仅当前未关闭 dead-letter generation 的 ACK notification 收件人通过，重放/成功、错误 notification、错误 tenant/deployment/source 或非收件人均失败关闭。
- scheduled status drain 在正常 operation claim 前后排空 pending actionable/closure；默认开关仍为 `HZY_ASSETS_STATUS_OPERATIONS_ENABLED=false`。受控诊断/重放入口为 `/integration-operations`，要求 `assets:integration_operations:view/replay` 的 tenant-global grant。

## 交付环境身份闭环 Goal 2 契约

Assets 是正式客户交付资产、正式环境和二者部署关系的事实源。`asset_environments.environment_code` 与 `customer_delivery_assets.delivery_asset_code` 只能由 Assets 生成或复用；Aims/Altoc 只保存这些稳定 code。`customer_delivery_assets.environment_code` 保留为兼容性的主环境快照，完整部署关系以 `customer_delivery_asset_environment_rel` 为准；`asset_environments.project_code` 仅表示初始/来源项目快照，项目历史以 Aims `project_environments` 为准。`asset_environments.status` 不单独区分 `accepted`，`online` / `accepted` 会归一为 `active`；验收完成以 `asset_environments.accepted_at` 或部署关系 `deployment_status = accepted` 为准。

新增 service endpoint：
- `POST /api/v1/service/environments/upsert`：幂等创建或复用正式环境。
- `POST /api/v1/service/customer-delivery-assets/{deliveryAssetCode}/environments:bind`：绑定交付资产与正式环境，支持多环境和唯一主环境。
- `GET /api/v1/service/customer-delivery-assets/{deliveryAssetCode}/environments`、`GET /api/v1/service/environments/{environmentCode}/customer-delivery-assets`：正式关系查询。
- `POST /api/v1/service/environments/{environmentCode}/lifecycle:sync`、`POST /api/v1/service/references:resolve`：环境生命周期与正式引用解析。

## 客户交付资产到期通知契约

- 客户交付资产运营责任必须在 Assets 主档显式维护为 `responsible_uid / responsible_dept_code`；不得从 Altoc 合同负责人、Aims 项目成员或交付视图负责人隐式推导。
- `responsible_uid` 是 `delivery_expiry / delivery_warranty / delivery_support` 三条通知流的唯一收件事实；无明确 active Directory 用户时不发送。`responsible_dept_code` 只用于用户目标页的数据范围，禁止部门广播。
- 通知详情 descriptor 固定为 `customer_delivery_asset + delivery_asset_code`。Assets runtime 每次按当前 active 生命周期和当前 `responsible_uid` 重验；目标页 `/customer-delivery-assets/{deliveryAssetCode}` 还必须经过用户认证、`deliveries` permission 与 runtime owner/department scope。
- B2 与 B1 共用 `assets_notification_checkpoint` 的 generation、幂等、ack-loss recovery 和 lifecycle closure 规则。`HZY_ASSETS_DUE_NOTIFICATIONS_ENABLED` 仍默认关闭；应用迁移并完成 Cloudflare 指令部署验收前不得开启。

## 离职资产未回收通知契约

- `offboarding_unrecovered` 按离职回收 case 聚合，不按单资产广播；source 与详情 descriptor 固定为 `offboarding_recovery_case + case_code`。
- 唯一收件事实是 case 当前显式 `recovery_responsible_uid`。未分配 case 保留在 Assets 工作清单但不发布；离职员工、部门、管理员和配置收件人均不得作为 fallback，离职员工本人也不得成为回收责任人。
- case 的 `status=active` 只表示 People 离职生命周期投影仍有效，不代表资产尚未归还；实际回收结果始终以当前 `asset_items.user_uid` 聚合出的 `outstanding_count` 与通知 checkpoint closure 为准。
- 通知详情每次由 Assets runtime 重验 case 仍为 open、仍有未归还项且当前用户仍是责任人；深链目标固定为 `/offboarding-recoveries/{caseCode}`。
- 用户工作台使用 `/offboarding-recoveries` 列表和 `/offboarding-recoveries/{caseCode}` 详情；对应 API 的列表/详情要求 `offboarding_recoveries:view`，责任人分配或清除要求 `offboarding_recoveries:edit`。PATCH 只提交 `recovery_responsible_uid`，不能修改离职事实或资产清单。
- People 同步入口固定为 `POST /api/v1/service/offboarding-recoveries:upsert`，要求 exact capability `assets:offboarding-recovery:sync`；case code、回收期限和初始空责任由 Assets runtime 派生，People 不得传入责任人或资产清单。
- 该流复用现有 scheduled due drain、checkpoint、ack-loss recovery 和 lifecycle closure；`HZY_ASSETS_DUE_NOTIFICATIONS_ENABLED` 默认 `false`，Cloudflare cron 只在指令部署时显式开启并绑定 tenant-runtime 与专用 Console service client。

## 到期通知收件人切换 CAS 契约

- Directory active 状态或候选 fallback 变化导致最终收件 UID 改变时，Assets 先以旧 UID 和旧 `eventVersion` 关闭旧 projection，再对新 UID 执行 first publish；新 UID 不得携带旧 UID 的 `previousObjectVersion`。
- 只有最终收件 UID 与 `previousRecipientUid` 相同时，提醒阶段推进才携带 `previousEventVersion` 做 supersession CAS。owner-move closure、新 UID publish 和 ack-loss 重试必须保持稳定、幂等的 transition。

## 通知目标资格

- `asset_due / asset_warranty / resource_expiry / resource_quota / delivery_expiry / delivery_warranty / delivery_support / offboarding_unrecovered` 均在发布前按受信 stream 映射到固定只读 purpose，并通过 Console subject eligibility 校验当前收件人 active 且具有对应资源读取资格。
- 旧责任人 projection closure 仍先于资格检查；拒绝、inactive 或资格服务不可用时不得发布、不得 ack，保留 checkpoint 重试。资格结果不替代 Assets 当前 owner/custodian/user、交付责任人或离职回收责任人的 exact object relation 重验。

## 通知目标对象范围

- `asset_item / ip_asset / offboarding_recovery_case` 的普通用户列表与精确详情读取必须消费 Console normal-merged scoped grants，并由 Assets BFF 生成不可由浏览器覆盖的 `all / relation / none` 及 grant-unit 证据。`tenant:global`、无非全局范围的独立 grant 或同 resource 显式 `admin` 为 `all`；其余受限 grant 保持“grant 内跨维度 AND、grant 间 OR”，unknown/不可解析范围失败关闭，绝不伪装成 direct relation。
- direct relation 对资源资产只允许当前 `owner_uid / custodian_uid / user_uid`，对知识产权只允许当前 IP owner 或关联产品 business/technical owner，对离职回收只允许 active case 当前 `recovery_responsible_uid`。资源资产另可按 grant-unit 的 `dept_code / project_code`，知识产权可按关联产品 `project_code`；IP 无部门字段、离职回收无部门/项目字段，因此相应 unit 不匹配而不扩大权限。department tree 由 Foundation Directory 展开。责任转移后旧 UID 的 direct relation 分支立即失效；仍持有独立 owner、部门/项目、tenant-global 或同 resource admin grant 时可按独立分支保留访问。
- view/通知关系不产生 edit、approve 或 admin。PATCH 和其他写操作必须重新按目标 action 解析 scoped grant；只有 action-specific relation 或 all 才可写。前端隐藏无 edit 权限的资产/IP 写入口，服务端 BFF 与 tenant-runtime 仍是最终边界。
- 浏览器提交的 `current_user / operator_uid / current_user_assets_object_access` 及 camelCase 变体必须由 Foundation proxy/BFF 删除并用已验证 Console 会话重建；runtime 缺少合法 trusted actor 或 scope 时失败关闭。

## 资产使用人对象范围

- `assets:employee` 的 `dashboard:view / asset_items:view / assignments:view / assignments:request / alerts:view` 默认使用精确 `asset:user`，不能把 user 扩大解释为 owner 或 custodian。`assets:requester` 的 `assignments:view / assignments:request` 默认使用 `subject:self`。
- 资产操作列表只返回当前用户发起、以当前用户为目标，或其精确关系/部门/项目 scope 命中的资产记录；操作详情执行相同谓词。工作台统计、即将到期资产和预警列表使用同一关系 scope，不得泄露全租户汇总。
- 页面只展示当前 permission 对应的快捷入口和动作：request-only 用户不显示分配、转移、续费、维修、报废、流程控制字段或职责冲突解释；前端隐藏只是辅助，BFF 仍派生可信 permission action 和 scope，tenant-runtime 对写入白名单与目标资产重新授权。

## 数据库

Schema 定义：`docs/assets_schema.sql`

统一资产模型：asset_items 主表 + 专用详情表（asset_physical_details、asset_resource_details 等）

Assets 应用自身不得直连 MySQL，也不再配置 `DB_*` / `runtimeConfig.db`。所有 `/api/v1/**` 业务数据读写必须通过 `server/middleware/tenant-runtime.ts` 代理到 tenant-runtime/data-runtime，由 runtime 侧执行数据库操作。`server/utils/db.ts` 仅保留为迁移期防误用桩，任何新增代码不得导入或调用它；如业务接口缺失，应先补 tenant-runtime adapter，而不是恢复本地 repository 或 DB fallback。

## 开发注意

- `asset_purpose` 枚举决定成本归因规则：self_use / project_procurement / sales_stock
- 成本归因三维度：cost_bearer（公司/客户/共享）+ finance_subject + 部门/项目
- 禁止跨模块 DB JOIN，首版只用 API + 异步回调
- ADR-016 阶段 2 起，Assets 通过 `server/middleware/tenant-runtime.ts` 将 `/api/v1/**` 业务路径转发到 tenant-runtime；优先使用统一 `HZY_TENANT_RUNTIME_URL`，`HZY_ASSETS_TENANT_RUNTIME_URL` 仅作为应用级覆盖。未启用 tenant-runtime 时应显式报错，不允许回退本地 repository + DB。

产品台账详情页的“进入产品中心”使用当前用户应用目录中的 AIMS homeUrl/basePath 构造产品深链，并复用 Foundation applicationShellEntryUrl；同源进入 Console Shell，跨源使用目录地址。缺少可信路径配置时不展示入口，跳转不替代 AIMS 产品授权。

产品版本摘要适配器使用 Foundation serviceAppFetch 与 trustedServiceRequestHeaders 访问 AIMS，不转发来源 Runtime 凭据。目标为 `/api/v1/service/products/:productCode/version-summaries`，精确权限 `aims:product-version-summary:read`。返回白名单版本元数据及公开特性计数，不将 AIMS 内部项目、人员、工作量或特性正文透传到 Assets 台账。

产品台账读取范围：用户 products 列表／详情消费 Console 派生对象范围；服务目录通过独立 `/v1/assets/service/products` 和精确 `assets:product:read` 读取，不能用缺少范围的用户列表作为服务旁路。详见根 MODULE_CONTRACTS。产品写入口对象范围仍在补齐，不能把读取完成视为整体验收完成。

产品主档 PATCH 已采用事务内 edit 对象范围检查，修改前锁定并在修改后重新校验；受限范围不能通过修改负责人／项目把主档移出授权范围。创建与关联写入口仍待接入完整范围合同。

产品创建同样要求 edit 对象范围，并在创建事务内对新行校验负责人／项目归属，越界回滚、不产生创建事件；关联写入口仍待完成。

产品主档列表支持 page/pageSize（默认 20、上限 100）、product_line、status、search，以及白名单 sortBy/sortOrder；分页结果与过滤范围汇总在同一只读快照中读取。产品页面已接入，底座标签分页仍待完成；未传分页参数的存量服务目录保持兼容。
