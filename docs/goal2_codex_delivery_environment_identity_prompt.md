# Codex Goal 2：交付环境身份闭环与服务覆盖收口

你正在修改仓库 `guangying-zhou/huizhi-yun`。Goal 1 已经完成，当前 Goal 2 要在其基础上打通：

```text
Altoc 合同交付计划
→ Assets 正式客户交付资产
→ Aims 项目交付环境
→ Assets 环境长期台账
→ Altoc 服务协议正式覆盖对象
```

请先检查当前 HEAD 的实际代码、迁移编号、接口和 Goal 1 最终实现，再实施本 Goal。不要根据本文假定某个迁移编号或文件仍与旧版本完全一致。

---

## 一、开始前必须阅读和检查

### 仓库规则

1. 根目录：
   - `AGENTS.md`
   - `CLAUDE.md`
   - `README.md`
2. 模块规则：
   - `altoc/CLAUDE.md`
   - `aims/CLAUDE.md`
   - `assets/CLAUDE.md`
   - `data-runtime/CLAUDE.md`
   - 各目录向上继承的其他 `CLAUDE.md` / `AGENTS.md`
3. 跨模块契约：
   - `docs/MODULE_CONTRACTS.md`

### 数据库与现有实现

重点检查当前 HEAD 中：

- `altoc/docs/altoc_schema.sql`
- `altoc/docs/migrations/*`
- `aims/docs/aims_schema.sql`
- `aims/docs/migrations/*`
- `assets/docs/assets_schema.sql`
- `assets/docs/migrations/*`
- `data-runtime/internal/apps/altoc/*`
- `data-runtime/internal/apps/aims/*`
- `data-runtime/internal/apps/assets/*`

重点搜索：

```text
contract_delivery_asset_plan
customer_delivery_assets
asset_environments
asset_delivery_views
asset_delivery_environments
service_agreement_asset
service_agreement_coverage
environment_code
delivery_asset_code
external_asset_code
source_plan_code
activate-delivery
customer-delivery-assets
status:sync
project_environment
project_environments
```

还要检查：

- Goal 1 新增的合同行—项目、服务协议—服务项目关系；
- Altoc 合同激活向 Assets 创建交付计划的当前流程；
- Assets 返回 `delivery_asset_code` 的当前方式；
- Assets 是否已有正式环境业务 API，而不仅是通用 CRUD；
- Aims 项目详情和交付执行页面当前可扩展点；
- Altoc 服务协议覆盖对象的现有读写路径；
- 当前服务到服务鉴权、幂等键、错误 envelope 和 runtime boundary 约定。

先输出一份简短的“当前 HEAD 状态确认”，列明实际采用的表名、接口名和迁移编号，然后直接实施，不要停在分析阶段。

---

## 二、业务边界与唯一真值

必须遵守以下主责边界。

### Altoc

负责：

- 合同和合同行；
- 合同交付资产计划；
- 服务协议和商业服务范围；
- 服务协议覆盖哪些正式交付资产、正式环境或两者组合。

不负责：

- 环境运行台账；
- 项目中的部署、上线和验收过程；
- 环境当前运行事实。

### Aims

负责：

- 项目交付过程；
- 项目与正式环境的执行关系；
- 本次项目的计划上线、实际上线、验收、交接；
- 本次项目的交付版本快照和同步状态。

不负责：

- 环境主档；
- 环境长期当前态；
- 客户交付资产主档。

### Assets

负责：

- 正式 `customer_delivery_asset`；
- 正式 `environment`；
- 交付资产与环境的部署关系；
- 环境和交付资产的长期台账、当前状态；
- 正式 `delivery_asset_code` 和 `environment_code` 的生成与唯一性。

### Console

本 Goal 中：

- 不新增中央关系表；
- 不参与任何运行时关系解析；
- 不成为合同、项目、环境或服务协议流程的必经依赖。

### 标识规则

```text
应用数据库内部关系：本地 id
跨应用对象关系：现有不可变 *_code
```

正式标识必须由主责应用生成：

```text
delivery_asset_code → Assets
environment_code    → Assets
project_code        → Aims
contract_code       → Altoc
service_agreement_code → Altoc
```

Altoc 的计划 code 只能代表“计划对象”，不得冒充 Assets 的正式交付资产或环境标识。

---

## 三、当前需要解决的核心问题

实施前请在当前 HEAD 中验证以下问题；若代码已经部分解决，应复用并补齐，不得重复造表。

### 1. 服务协议覆盖字段混用了不同命名空间

现有模型可能把以下值放入同一个字段：

- Altoc 交付计划 code；
- Assets 正式 `delivery_asset_code`；
- 待创建对象 code；
- 历史交付记录 code。

目标是明确区分：

```text
source_plan_code       计划来源
delivery_asset_code    正式客户交付资产
environment_code       正式环境
legacy_reference       无法自动解析的旧引用
```

### 2. 一个交付资产可能部署到多个环境

必须支持：

```text
同一个客户交付资产
├── 测试环境
├── 生产环境
└── 灾备环境
```

现有单一 `customer_delivery_assets.environment_code` 如果存在，只能继续作为兼容性的“主环境快照”，不能再作为完整关系真值。

### 3. 一个环境会跨越多个项目生命周期

必须支持：

```text
初次实施项目
→ 升级项目
→ 迁移项目
→ 维护项目
→ 下线项目
```

因此不能把 Assets 环境表上的单一 `project_code` 理解为环境唯一所属项目。Aims 的项目—环境关系才是项目执行事实；Assets 中既有 `project_code` 可保留为来源/初始项目快照，或按当前兼容策略逐步废弃。

### 4. 服务协议必须覆盖正式对象

正式生效的服务覆盖最终应指向：

- 正式 `delivery_asset_code`；
- 正式 `environment_code`；
- 或某个交付资产在某个环境中的组合。

尚未取得正式标识的计划只能处于：

```text
pending / unresolved / needs_review
```

不能被静默当作正式有效覆盖。

---

## 四、目标数据链

改造完成后，必须形成以下稳定链路：

```text
Altoc contract_delivery_asset_plan.code
    ↓ 创建/同步
Assets customer_delivery_assets.delivery_asset_code
    ↓ 部署关系
Assets asset_environments.environment_code
    ↑
Aims project_environments
    ↓ 正式覆盖
Altoc service_agreement_coverage
```

典型流程：

```text
1. Altoc 合同激活产生交付计划。
2. Assets 幂等创建/更新正式客户交付资产并返回 delivery_asset_code。
3. Aims 项目中规划或登记交付环境。
4. Aims 通过 Assets 业务 API 幂等创建/复用正式环境，取得 environment_code。
5. Aims 保存项目—环境执行关系。
6. Assets 保存交付资产—环境正式部署关系。
7. Aims 推进部署、上线、验收、交接，并同步 Assets 当前台账。
8. Assets/Altoc 回写链保存 source_plan_code、delivery_asset_code、environment_code。
9. Altoc 将 pending 服务覆盖解析为正式覆盖。
10. 后续升级或维护项目复用同一个 environment_code，而不是创建新的环境身份。
```

---

# 五、实施任务

## 任务 1：Assets 建立正式交付资产—环境关系

先检查是否已有等价表；没有时新增下一号迁移，表名可按现有命名规范调整，推荐：

```sql
customer_delivery_asset_environment_rel
```

至少包含：

```text
id
delivery_asset_id
environment_id
relation_type
is_primary
deployment_status
deployed_version
effective_from
effective_to
status
source_project_code
created_at / created_by
updated_at / updated_by
deleted_at
```

建议语义：

```text
relation_type:
  primary
  test
  production
  backup
  disaster_recovery
  training
  other

deployment_status:
  planned
  provisioning
  deployed
  online
  accepted
  suspended
  removed

status:
  active
  ended
  cancelled
```

要求：

1. 同一正式交付资产可以关联多个环境。
2. 同一环境可以承载多个正式交付资产。
3. 同一交付资产只能有一个当前有效的 `is_primary = true` 环境。
4. 为 `delivery_asset_id`、`environment_id`、`source_project_code` 建反向索引。
5. 软删除、审计字段、租户隔离遵循现有 schema。
6. 交付资产和环境必须属于同一租户。
7. 默认要求客户一致；确有代理/最终客户场景时，应沿用仓库已有 party/customer 规则，不得直接忽略冲突。
8. `deployed_version` 表示该交付资产在该环境中的当前部署版本，不要在环境主表增加一个无法表达多产品的单一版本字段。

### 兼容既有单环境字段

如果 `customer_delivery_assets.environment_code` 仍存在：

- 保留该字段；
- 将其定义为兼容性的“主环境 code 快照”；
- 新读取优先读取关系表；
- 关系表无数据时才回退旧字段；
- 设置或切换主环境时同步更新旧字段；
- 不从旧字段推导唯一完整关系。

提供幂等回填：

```text
customer_delivery_assets.environment_code
→ customer_delivery_asset_environment_rel
```

回填不得重复创建。

---

## 任务 2：Assets 建立正式环境业务 API

不得让 Aims 或 Altoc 直接使用 Assets 通用 CRUD 作为跨模块业务契约。新增或扩展 Assets 专用服务 API，路径应遵循当前仓库风格。

至少支持：

### 2.1 幂等创建或复用环境

示例语义：

```http
POST /api/v1/service/environments/upsert
```

请求至少支持：

```json
{
  "environmentCode": "可选；仅用于合法的已有对象复用",
  "idempotencyKey": "必填或由标准请求头提供",
  "customerCode": "CUS-...",
  "contractCode": "可选",
  "sourceProjectCode": "PRJ-...",
  "environmentName": "生产环境",
  "environmentType": "customer_prod",
  "status": "planning",
  "deploymentMode": "可选",
  "region": "可选",
  "description": "可选"
}
```

返回正式：

```json
{
  "environmentCode": "ENV-...",
  "created": true,
  "status": "planning"
}
```

要求：

- `environment_code` 由 Assets 生成；
- 同一个幂等键重试必须返回同一对象；
- 不能仅凭名称猜测复用；
- 如果显式传入已有 code，必须校验租户、客户和对象状态；
- 不允许不同客户复用同一环境；
- 不存储密码、密钥、连接串等明文凭据。

### 2.2 交付资产绑定环境

示例：

```http
POST /api/v1/service/customer-delivery-assets/{deliveryAssetCode}/environments:bind
```

支持：

- 新增或幂等更新关系；
- 设置/切换主环境；
- 更新部署状态和部署版本；
- 结束关系；
- 按交付资产查询环境；
- 按环境查询交付资产；
- 批量查询，避免列表页面 N+1。

### 2.3 环境生命周期同步

示例：

```http
POST /api/v1/service/environments/{environmentCode}/lifecycle:sync
```

至少支持：

```text
planning
provisioning
active / online
accepted
frozen
retired
```

以及：

```text
go_live_at
accepted_at
retired_at
source_project_code
```

必须定义状态转换规则；非法回退或越级应返回明确的 409/422，而不是静默覆盖。

### 2.4 正式引用查询

至少支持按 code 获取：

- 正式环境；
- 正式客户交付资产；
- 某交付资产的环境集合；
- 某环境的交付资产集合；
- 按一组 code 批量解析存在性和客户归属。

这些接口用于 Altoc 服务覆盖校验和 Aims 项目环境展示。

### 2.5 runtime 边界

- 所有数据库写入经过现有 `data-runtime`/业务适配器；
- 不允许 Assets Nuxt/BFF 直接访问 MySQL；
- 新增 Assets 专用 adapter/service command，不通过通用 SQL-over-REST 绕过业务校验；
- 使用现有 service token、scope 和 response envelope；
- 必须具备幂等处理。

---

## 任务 3：Aims 增加项目—环境执行关系

先确认当前 HEAD 是否已有等价表。没有时新增下一号迁移，推荐：

```sql
project_environments
```

至少包含：

```text
id
project_id
environment_code
delivery_asset_code
relation_type
delivery_status
is_primary
planned_go_live_at
actual_go_live_at
accepted_at
handover_status
handover_at
delivery_version_snapshot
assets_sync_status
assets_sync_error
assets_synced_at
source_contract_line_code
source_obligation_code
created_at / created_by
updated_at / updated_by
deleted_at
```

建议语义：

```text
relation_type:
  initial_delivery
  upgrade
  migration
  maintenance
  decommission
  verification
  other

delivery_status:
  planned
  provisioning
  deployed
  online
  accepted
  handed_over
  suspended
  cancelled

handover_status:
  pending
  ready
  completed
  rejected

assets_sync_status:
  pending
  synced
  failed
```

要求：

1. `project_id` 使用 Aims 本地外键。
2. `environment_code`、`delivery_asset_code` 使用 Assets 正式 code。
3. 不保存或依赖 Assets 本地数据库 ID。
4. 一个项目可操作多个环境。
5. 一个环境可被多个项目按不同角色操作。
6. 同一项目、环境、交付资产、relation_type 的有效关系不得重复。
7. 为 `environment_code`、`delivery_asset_code` 建反向索引。
8. `delivery_version_snapshot` 是本次项目历史快照，后续升级不能改写旧项目快照。
9. `assets_sync_status` 必须允许识别并重试跨应用同步失败。

### 不要把环境主档搬到 Aims

Aims 可以保存用于执行和展示的快照，但以下字段以 Assets 为准：

```text
环境名称
环境类型
客户归属
长期生命周期状态
当前交付资产部署关系
正式 environment_code
```

Aims 不应建立第二套环境主表。

---

## 任务 4：实现 Aims 项目环境业务流

在 Aims 的 BFF/service 层实现明确的业务 API，并遵循现有项目 API 风格。

至少支持：

- 查询项目交付环境；
- 新建正式环境并关联项目；
- 关联已有正式环境；
- 关联正式客户交付资产；
- 更新本次项目的部署、上线、验收、交接状态；
- 解除尚未形成正式历史事实的错误关系；
- 按 `environment_code` 反查项目历史；
- 重试 Assets 同步。

### 新建环境的一致性流程

不要尝试跨数据库分布式事务。采用可重试、幂等流程：

```text
1. Aims 接收项目环境创建请求并生成稳定 request/idempotency key。
2. Aims BFF 调用 Assets environments/upsert。
3. Assets 返回正式 environment_code。
4. Aims 通过 data-runtime 幂等写 project_environments。
5. 如果第 4 步失败，重复同一请求时 Assets 返回同一环境，Aims 可继续完成关系写入。
```

禁止：

- Aims 自己生成正式 `environment_code`；
- 先写一个伪环境 code 后永久不解析；
- 仅通过环境名称进行复用。

### 生命周期同步

Aims 推进部署、上线、验收、交接时：

1. 先把 Aims 项目执行事实写为 `assets_sync_status = pending`；
2. 提交本地事务；
3. 调用 Assets 正式业务 API；
4. 成功后标记 `synced`；
5. 失败后标记 `failed`，保存可诊断错误并提供重试；
6. 重试使用稳定幂等键，不能重复创建环境或关系。

不得因 Assets 短暂不可用而丢失 Aims 已发生的执行事实，也不得把失败伪装为同步成功。

### 最小 UI

在 Aims 项目详情中增加或完善“交付环境”区域，至少支持：

- 环境列表；
- 创建或关联环境；
- 展示正式 `environment_code`；
- 展示关联的 `delivery_asset_code`；
- 推进部署/上线/验收/交接；
- 展示 Assets 同步状态和失败原因；
- 手工重试同步。

不要进行无关的全站 UI 重做。

---

## 任务 5：Altoc 新增正式服务覆盖模型

先检查当前 HEAD 是否已经存在 `service_agreement_coverage` 等价结构；若存在，扩展而不是再建重复表。

如不存在，新增推荐表：

```sql
service_agreement_coverage
```

至少包含：

```text
id
coverage_code
service_agreement_id
target_type
source_plan_code
delivery_asset_code
environment_code
legacy_reference
resolution_status
coverage_status
coverage_scope
product_scope_json
effective_from
effective_to
included
exclusion_note
source_type
created_at / created_by
updated_at / updated_by
deleted_at
```

建议枚举：

```text
target_type:
  delivery_asset
  environment
  delivery_asset_environment
  pending_plan
  legacy

resolution_status:
  pending
  resolved
  needs_review

coverage_status:
  planned
  active
  suspended
  ended
  cancelled

source_type:
  activation
  migration
  manual
  renewal
  callback
```

### 字段约束

```text
target_type = delivery_asset
→ delivery_asset_code 必填

target_type = environment
→ environment_code 必填

target_type = delivery_asset_environment
→ delivery_asset_code 和 environment_code 都必填

target_type = pending_plan
→ source_plan_code 必填
→ resolution_status 不能是 resolved
→ coverage_status 不能是 active

target_type = legacy
→ legacy_reference 必填
→ 默认 resolution_status = needs_review
```

正式 `active` 覆盖必须满足：

```text
resolution_status = resolved
并且正式目标 code 完整
```

要求：

- 同一服务协议、同一正式目标、同一有效期不能出现重复有效覆盖；
- 使用当前 MySQL 和软删除约定可可靠支持的唯一约束；无法完全用索引表达时，必须在事务中锁定校验并增加并发测试；
- `coverage_code` 是 Altoc 内部业务关系 code，不代替正式目标 code；
- 不允许将计划 code 写入 `delivery_asset_code` 或 `environment_code`。

---

## 任务 6：迁移现有 `service_agreement_asset`

保留旧表，禁止本 Goal 直接 drop。

提供幂等迁移/回填逻辑，根据旧记录的 `coverage_type` 和当前实际字段语义做明确转换。迁移前必须检查当前 HEAD 中实际枚举和数据写法，不要仅按本文猜测。

建议转换原则：

### `customer_delivery_asset`

旧引用若能在 Assets/Altoc 已同步数据中确认是正式 `delivery_asset_code`：

```text
target_type = delivery_asset
resolution_status = resolved
```

若同时已有正式 `environment_code`，根据原业务范围可升级为：

```text
target_type = delivery_asset_environment
```

### `planned_asset` / `pending_asset`

把旧引用作为：

```text
source_plan_code
target_type = pending_plan
resolution_status = pending
```

然后尝试通过：

```text
contract_delivery_asset_plan
→ formal delivery_asset_code / external_asset_code
→ formal environment_code
```

解析。解析成功才变成正式目标。

### `legacy_delivery`

不得静默认定为正式 code：

```text
target_type = legacy
resolution_status = needs_review
legacy_reference = 旧值
```

### 回填要求

- 幂等；
- 不删除旧记录；
- 不伪造环境；
- 不按名称模糊匹配；
- 不跨租户或跨客户匹配；
- 对一对多歧义标记 `needs_review`；
- 输出可审计核对报告。

至少报告：

```text
旧覆盖总数
成功解析为 delivery_asset 的数量
成功解析为 environment 的数量
成功解析为 pair 的数量
仍为 pending_plan 的数量
needs_review 数量
未匹配正式对象数量
跨客户冲突数量
重复/合并数量
孤儿 service_agreement 数量
```

---

## 任务 7：正式标识回写与 pending 覆盖解析

扩展现有 Altoc 与 Assets 的状态同步/回调，不要另建重复流程。

回写 payload 应至少能够携带：

```json
{
  "sourcePlanCode": "DAP-...",
  "deliveryAssetCode": "DA-...",
  "environmentCode": "ENV-...",
  "projectCode": "PRJ-...",
  "status": "accepted",
  "occurredAt": "..."
}
```

要求：

1. Altoc 用 `source_plan_code` 定位计划，而不是依赖 Assets 本地 ID。
2. 保存正式 `delivery_asset_code`。
3. 保存正式 `environment_code`。
4. 找到该计划关联的 pending 服务覆盖。
5. 验证正式交付资产和环境属于同一客户，且 pair 在 Assets 中真实存在。
6. 原子地将覆盖从 pending 解析为正式目标。
7. 重复回调幂等。
8. code 冲突或客户不一致返回明确 409，并保留待处理状态。
9. 不用计划 code 覆盖正式字段。
10. Altoc/Assets 任一侧暂时失败时，提供可重试机制和可观察状态。

如果当前架构采用 Aims 主动调用 Altoc，而不是 Assets 回调，应沿用现有可靠模式；关键是结果和幂等性，不强制改变调用方向。

---

## 任务 8：更新 Altoc 服务协议读写

所有新业务写入应使用 `service_agreement_coverage`。

读取策略：

```text
优先读取新 coverage 表
只有尚未迁移的旧记录才回退 service_agreement_asset
```

不得在同一响应中无去重地返回新旧两套相同覆盖。

新增或扩展业务 API：

- 列出服务协议覆盖；
- 绑定正式交付资产；
- 绑定正式环境；
- 绑定正式交付资产—环境组合；
- 创建 pending plan 覆盖；
- 解析/重试 pending 覆盖；
- 标记 legacy 记录已人工确认；
- 暂停/结束覆盖；
- 按 `environment_code` 反查有效服务协议；
- 按 `delivery_asset_code` 反查有效服务协议；
- 批量查询覆盖状态。

正式绑定前，Altoc BFF 必须调用 Assets 专用 API 验证：

- 对象存在；
- 租户正确；
- 客户正确；
- delivery asset 与 environment 组合真实存在。

Altoc data-runtime 仍负责本地事务和唯一约束；不得直接访问 Assets 数据库。

### 最小 UI

在服务协议详情中至少展示：

- 正式交付资产；
- 正式环境；
- 覆盖类型；
- 覆盖有效期；
- `resolved / pending / needs_review`；
- 旧引用待人工处理提示。

只实现本 Goal 所需最小维护能力，不重做整个合同页面。

---

## 任务 9：历史字段兼容与语义收口

必须明确并记录以下既有字段的后续语义：

### `contract_delivery_asset_plan.code`

- 只表示 Altoc 计划标识；
- 永远不能当作正式 `delivery_asset_code` 或 `environment_code`。

### `contract_delivery_asset_plan.external_asset_code`

如果当前仍存在：

- 保持兼容；
- 明确其值只能是 Assets 返回的正式 `delivery_asset_code`；
- 如果决定新增更明确的 `delivery_asset_code` 字段，必须回填、双写、兼容读取，不得直接破坏旧 API；
- 不要求在本 Goal 中做大范围字段重命名。

### `contract_delivery_asset_plan.environment_code`

- 只能保存 Assets 返回的正式 `environment_code`；
- 计划阶段未知时应为空；
- 不得预先生成伪正式 code。

### `customer_delivery_assets.environment_code`

- 作为兼容主环境快照；
- 完整事实以交付资产—环境关系表为准。

### `asset_environments.project_code`

- 不得继续解释为环境唯一所属项目；
- 可保留为初始/来源项目快照；
- 项目历史以 Aims `project_environments` 为准；
- 如果当前 schema 强制非空且影响新流程，采用最小兼容迁移，不做破坏性重命名。

---

# 六、错误处理与数据完整性

至少定义并透传以下稳定错误 code，名称可按仓库规范调整：

```text
environment_not_found
delivery_asset_not_found
environment_customer_conflict
delivery_asset_customer_conflict
delivery_asset_environment_conflict
environment_reference_ambiguous
coverage_target_unresolved
coverage_target_conflict
coverage_already_active
invalid_environment_transition
assets_sync_failed
multiple_primary_environments
legacy_coverage_needs_review
```

要求：

- data-runtime 错误不得被 BFF 全部包装成泛化 502；
- 400/404/409/422 应按业务含义透传；
- 日志包含 tenant、customer、contract、project、delivery asset、environment、service agreement code；
- 不记录凭据或其他敏感信息。

---

# 七、测试要求

必须增加真实业务层和数据库层测试，不能只增加纯函数测试。

## 1. Assets

覆盖：

- 幂等创建环境；
- 不同客户不能复用同一环境；
- 同一交付资产绑定测试、生产、灾备多个环境；
- 一个环境绑定多个交付资产；
- 设置和切换唯一主环境；
- 重复 bind 不产生重复关系；
- 不存在或跨客户的 delivery asset/environment 原子失败；
- 旧单环境字段回填；
- 新读优先关系表、旧数据回退；
- 生命周期合法与非法转换；
- 批量查询避免 N+1。

## 2. Aims

覆盖：

- 创建正式环境后写入项目关系；
- Assets 成功但 Aims 首次写入失败，重试可恢复且不重复环境；
- 关联已有正式环境；
- 一个环境经历初始实施、升级、维护多个项目；
- 同一项目多个环境；
- 同一环境中多个交付资产；
- 项目验收后保存历史版本快照；
- Assets 同步失败标记 failed；
- 重试后标记 synced；
- 不允许 Aims 生成正式 environment code；
- 交接完成后旧项目快照不被后续升级改写。

## 3. Altoc

覆盖：

- 正式 delivery asset 覆盖；
- 正式 environment 覆盖；
- delivery asset + environment pair 覆盖；
- pending plan 不允许激活；
- Assets 回写后 pending 原子解析；
- 重复回调幂等；
- 旧 `planned_asset` 正确迁移为 pending；
- 旧 `customer_delivery_asset` 正确解析；
- 旧 `legacy_delivery` 标记 needs_review；
- 跨客户正式对象拒绝；
- 同一目标重复有效覆盖拒绝；
- 新读优先、旧表回退不重复；
- 按 environment 反查有效服务协议。

## 4. 跨模块流程测试

至少覆盖以下端到端或契约测试：

### 场景 A：标准实施

```text
合同激活
→ 创建交付资产
→ Aims 创建生产环境
→ 绑定交付资产
→ 上线
→ 验收
→ 服务覆盖解析为正式 pair
```

### 场景 B：多环境

```text
一个交付资产
→ 测试环境
→ 生产环境
→ 灾备环境
```

服务协议只覆盖生产与灾备时，必须能够精确表达。

### 场景 C：升级项目

```text
初次项目交付 ENV-001 版本 1.0
→ 升级项目继续使用 ENV-001，交付 2.0
```

初次项目快照保持 1.0，Assets 当前部署关系更新为 2.0。

### 场景 D：无环境交付

纯许可证、SaaS 租户或不需要客户环境的交付资产可以没有 environment，不得被强制创建伪环境。

### 场景 E：异常恢复

```text
Assets 创建成功
→ Aims 网络失败
→ 使用同一幂等键重试
→ 不重复环境
→ 完成项目关系
```

---

# 八、迁移与核对

每个模块使用当前 HEAD 下一个可用迁移编号，禁止假定固定编号。

要求：

1. 迁移可重复部署或具备标准一次性迁移保护；
2. 回填逻辑幂等；
3. 不 drop 旧表和旧列；
4. 不覆盖无法确定的历史引用；
5. 提供迁移前后核对 SQL 或受控命令；
6. 记录实际执行结果。

至少核对：

```text
Assets：
- 有 environment_code 但没有关系行的交付资产数
- 一个交付资产多个主环境数
- 跨客户关系数
- 孤儿环境关系数

Aims：
- project_environment 总数
- 缺失正式 environment_code 数
- 重复有效关系数
- sync_failed 数

Altoc：
- 旧 service_agreement_asset 总数
- 新 coverage 总数
- resolved / pending / needs_review 数
- active 但未 resolved 数
- 跨客户冲突数
- 重复有效覆盖数
```

任何“active 但 unresolved”的新覆盖都应为零。

---

# 九、文档与契约更新

更新实际受影响的：

- `assets/docs/assets_schema.sql`
- `aims/docs/aims_schema.sql`
- `altoc/docs/altoc_schema.sql`
- 对应迁移说明
- `assets/CLAUDE.md`
- `aims/CLAUDE.md`
- `altoc/CLAUDE.md`
- `docs/MODULE_CONTRACTS.md`
- OpenAPI、类型定义、SDK/adapter 契约（如果存在）

文档必须明确：

```text
Assets 是正式交付资产和环境主账。
Aims 是项目—环境执行关系主账。
Altoc 是合同计划和服务覆盖主账。
Console 不参与本链路。
计划 code 不是正式环境/交付资产 code。
```

还要给出一张简洁的对象关系和时序图。

---

# 十、必须运行的验证

按当前仓库实际脚本执行等价命令，至少包括：

```bash
pnpm --dir assets lint
pnpm --dir assets typecheck
pnpm --dir assets test

pnpm --dir aims lint
pnpm --dir aims typecheck
pnpm --dir aims test

pnpm --dir altoc lint
pnpm --dir altoc typecheck
pnpm --dir altoc test

cd data-runtime && go test ./...
```

如果模块存在 runtime boundary 检查，也必须执行：

```bash
pnpm --dir assets audit:runtime-boundary
pnpm --dir aims audit:runtime-boundary
pnpm --dir altoc audit:runtime-boundary
```

另需执行：

- 所有新迁移的数据库验证；
- 回填核对 SQL；
- 跨模块 API 契约测试；
- 幂等和重试测试；
- 并发设置主环境/正式覆盖唯一性的测试。

如果某命令因仓库既有问题失败，必须：

1. 给出实际失败输出；
2. 区分本次引入和既有失败；
3. 不通过删除测试、放宽断言或跳过检查伪造通过。

---

# 十一、验收标准

满足以下全部条件才可关闭 Goal 2：

1. Assets 生成并主责正式 `delivery_asset_code` 和 `environment_code`。
2. Aims 不再创建伪正式环境 code。
3. Aims 具备结构化项目—环境执行关系。
4. 一个环境可被多个项目按历史关系使用。
5. 一个交付资产可部署到多个环境。
6. 一个环境可承载多个交付资产。
7. 既有单 `environment_code` 字段仅作为兼容主环境快照。
8. Altoc 的正式服务覆盖不再混用计划 code 和正式 code。
9. pending plan 覆盖只有取得正式对象并校验成功后才能激活。
10. 旧覆盖数据被幂等迁移，并明确区分 resolved、pending、needs_review。
11. Aims 的部署、上线、验收和交接能可靠同步 Assets，失败可观察、可重试。
12. 同一请求重试不会重复创建环境、部署关系或服务覆盖。
13. 跨客户、跨租户错误关系被拒绝。
14. Console 不可用时全部流程正常。
15. 各模块不直接访问其他模块数据库。
16. Goal 1 的合同行—项目和服务协议—服务项目能力无回归。
17. 所有必跑测试通过，并提交实际迁移核对结果。

---

# 十二、非目标

本 Goal 不实施：

- Console 关系索引；
- Goal 1 关系模型重做；
- 删除 `service_agreement_asset`；
- 删除旧维保合同/权益表；
- 服务额度 ledger；
- 人员工时成本和实际毛利归集；
- CMDB 全量能力；
- 监控、日志采集、网络拓扑等运维平台能力；
- 环境密码、私钥或连接串管理；
- 全站 UI 重构；
- 全平台 `_code` / `no` 重命名。

---

# 十三、建议提交拆分

可以在一个 Goal 内完成，但建议按三个逻辑 PR 或提交组织：

### PR 1：Assets 正式身份和部署关系

- 交付资产—环境关系表；
- 正式环境业务 API；
- 幂等、回填和兼容读取；
- Assets 测试和文档。

### PR 2：Aims 项目环境执行

- `project_environments`；
- Aims BFF 编排 Assets；
- 状态同步、失败重试；
- 最小项目环境 UI；
- Aims 测试和文档。

### PR 3：Altoc 服务覆盖收口

- `service_agreement_coverage`；
- 旧覆盖回填；
- 正式标识回写和 pending 解析；
- 服务协议最小 UI；
- Altoc 测试和文档。

每个提交都应可构建、可测试，避免把无法运行的中间状态推入主分支。

---

# 十四、最终交付格式

完成后输出：

1. 当前 HEAD 状态确认；
2. 最终对象主责和关系图；
3. 实施摘要；
4. 变更文件清单；
5. 各模块数据库迁移说明；
6. 存量回填和实际核对结果；
7. API/契约变化；
8. 幂等、失败恢复和兼容策略；
9. 测试命令及实际结果；
10. 尚未解决、需进入 Goal 3 或 Goal 4 的事项。

先给出不超过 15 行的实施计划，然后直接编码、迁移、测试和修复，不要停留在设计建议阶段。
