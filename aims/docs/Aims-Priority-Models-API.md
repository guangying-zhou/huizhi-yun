# 优先级模型版本 API

模型版本属于产品，发布后不可改写。创建及草稿周期选用要求 product_priorities/admin；读取要求 product_priorities/view。内置模型单独作为默认选项，原周期和评估的冻结模型不随新版本变化。

## 已接入 Runtime 读取

`POST /v1/aims/internal/products/{code}/priority-models:list` 使用精确 `aims:product-priorities:read`，可信 actor 由服务上下文绑定。body 包含 input.page/input.page_size 和源产品 view authorization。返回 items/total/page/pageSize、product_code、workspace_revision、builtin。

仅计数该产品持久化的版本，builtin 不占分页数量。不接受客户端权重作为评分配置。当前模型创建、周期选用已实现领域命令，Runtime 写接口已接入，浏览器接口已接入，模型列表和发布页面已实现，周期选用页面已接入。RICE 已具备领域评估和 Runtime 提交能力，浏览器评估表单尚待接入。

## Runtime 写入

- `POST .../priority-models:create`：精确 `aims:product-priorities:model-create`，input 为 expected_revision/title/reason/model（version、strategic、user_value、business、risk）。
- `POST .../priority-models:cycle-select`：精确 `aims:product-priorities:cycle-model-select`，input 为周期 biz_id/model_version/expected_revision/expected_cycle_revision/reason。

均要求 body.idempotency_key 和源 priorities/admin permit。actor 绑定可信服务上下文，版本已存在或周期已选相同模型映射 409。新增 grant 已生成并在隔离 MySQL 验证，目标部署未安装。


## 浏览器接口

前缀为 `/api/v1/products/{productCode}/priority-models`，全部响应禁止缓存。

- `GET /list?page=1&pageSize=20`：要求 priorities/view；页码最大 1000000，每页最大 100，拒绝未知查询字段。
- `GET /permissions`：要求 view，返回产品标识、状态、修订和 admin 布尔值。view/admin 授权事实必须来自一致的产品、操作者、成员关系和修订；明确无 admin 返回 false，授权故障不降级为允许。
- `POST /create`：要求 admin，body 为 expectedRevision、title、reason、version、strategic、userValue、business、risk。四项权重以 5% 为步长且合计 100%，内置版本标识不可创建。
- `POST /cycles/{cycleUUID}`：要求 admin，body 为 expectedRevision、expectedCycleRevision、modelVersion、reason。周期身份只取路由，服务端继续检查草稿状态和无评估历史。

写操作必须携带 `Idempotency-Key`，不接受查询参数。未知 body 字段（包括客户端授权、快照、评分结果）拒绝。BFF 从可信权限事实绑定操作者、生成短期 permit 并调用对应精确 Runtime 能力；运行服务不可用返回 503。产品空间通过 /products/{productCode}/models 访问列表和版本详情，/models/new 发布新版本；周期选用入口位于周期详情，路由为 /products/{productCode}/cycles/{cycleId}/model；浏览器验收待完成。

## 自定义模型评估

评估 BFF 接受合法的 model_version 标识，但仍拒绝客户端 weights、model_snapshot、value_score 等规则或结果字段。Runtime 按产品和周期冻结版本校验并计算，不以客户端版本标识作为规则来源。

评估页校验周期返回的冻结量表、权重、置信度、人日及精度是否适用于加权表单，显示该周期实际版本和四项权重。内置版本必须保持默认权重，自定义版本必须提供完整计算规则；不将 RICE 配置当作加权模型使用。

周期选用页要求活动产品的 priorities/admin 权限与草稿状态，显示分页版本和所选权重，记录原因并确认变更。产品/周期修订由读取结果绑定，失败重试复用同载荷幂等键；服务端仍检查没有评估历史。

## 当前实现状态（2026-09-08）

加权与 RICE 的模型发布、周期选用、Reach 记录/分页读取、RICE 评估提交/历史/候选读取已接入对应领域与接口；浏览器评估和模型选择页面已支持 RICE。隔离浏览器已验证 Reach 选择以及未知/完整评分的失败重试，实际数据库已验证 Runtime 评估保存和幂等重放。真实部署令牌、桌面/移动视觉和周期选择浏览器验收尚未完成。

下文阶段性“待接入”说明记录了各接口当时的交付边界，最新状态以本节和实施状态文档为准。价值—投入矩阵仍只绘制加权价值坐标，RICE 项目在列表显示实际影响和推荐分，并明确未绘制原因；RICE 专用矩阵尚未实现。

## RICE 人日模板（领域与 Runtime 评估已接入）

RICE = Reach × Impact × Confidence ÷ Effort。影响系数采用 0.25、0.50、1、2、3，置信度采用 0.50、0.80、1.00，参考 [Intercom 原始说明](https://www.intercom.com/blog/rice-simple-prioritization-for-product-managers/)。本项目投入统一为人日，因此命名为 RICE 人日模板，不直接与人月版分数比较。

模型需明确 Reach 的起止日期、去重单位（用户或客户企业）、去重定义和数据来源定义；时间窗口上限为起止日期相差 366 天。禁止混用客户企业数与用户数。Reach 为 0～1000000000 的整数，未知使用 null，缺失任一维度不产生分数；不伪造加权模型的 0～100 价值分。采用精确整数运算、八位小数和 half-up 舍入。

目前已具备领域计算、模型定义校验、不可变版本发布命令及 Runtime/BFF 创建接口。已接入领域周期选用及持久评估；外部证据来源自动核验尚未实现。来源定义文本不是可信数据已就绪的证明，不能据此宣称 RICE 已启用。

RICE 领域版本发布命令已实现：CreateRICEModelVersion 要求与加权版本相同的 priorities/admin、活动产品、产品修订和幂等身份，保存 method=rice 的不可变规则。同产品版本名在不同方法之间也唯一。RICE Runtime 和 BFF 创建接口见下文；模型列表详情可查看冻结的统计窗口、去重口径、来源定义及人日单位。RICE 评估领域命令与 Runtime 已接入，浏览器提交尚待完成。

### RICE Runtime 发布接口

`POST /v1/aims/internal/products/{code}/priority-models:rice-create` 已接入，要求精确 `aims:product-priorities:model-create` 和 priorities/admin permit，body 包含 idempotency_key、authorization、input。

input 使用 expected_revision、title、reason 和 model；model 字段为 version、reach_unit、reach_definition、reach_starts_on、reach_ends_on、source_definition。加权字段不能传入 RICE 创建接口，RICE 字段不能传入原加权创建接口。operation 为 aims.product-priority-models.rice-create。

此接口仅发布不可变模型定义，不选用周期、不重算评估、不确认 Reach 来源可信。浏览器创建入口已接入，RICE 浏览器周期选用/评估仍待接入；现有模型 grant 数量不变。

### RICE 浏览器创建接口

`POST /api/v1/products/{productCode}/priority-models/rice-create` 已接入。body 为 expectedRevision、title、reason、version、reachUnit、reachDefinition、reachStartsOn、reachEndsOn、sourceDefinition；要求 Idempotency-Key 和管理员权限，不接受查询参数或未知字段。

去重单位仅允许 unique_users / unique_customer_organizations，日期必须真实有效且起止相差不超过 366 天，去重与来源定义均必填。接口不接受 reach、verified、权重、操作者或评分字段。BFF 将命名映射为 Runtime snake_case，并调用 rice-create，复用 model-create 精确能力。RICE 发布表单位于 /products/{productCode}/models/rice-new，列表提供管理员入口；RICE 浏览器选用、评估仍待完成。

## Reach 观测 Runtime 读取

- POST /v1/aims/internal/products/{code}/reach-observations:list：input 为 item_biz_id、page、page_size。
- POST /v1/aims/internal/products/{code}/reach-observations:view：input 为 item_biz_id、biz_id（观测 UUID）。

均要求可信 actor、精确 aims:product-priorities:read 和源产品 priorities/view permit，登记为只读传输。列表与详情返回不可变观测、当前事项/产品修订及 stale 标识；错误不当成空记录。浏览器接口尚待接入。

### Reach 观测 Runtime 写入

POST /v1/aims/internal/products/{code}/reach-observations:record，要求 aims:product-priorities:reach-record 精确能力、priorities/assess permit、可信操作者和 idempotency_key。input 为 item_biz_id、model_version、expected_revision、expected_item_revision、expected_scope_revision、expected_evidence_revision、reach、source_reference、methodology。

服务端绑定模型定义和记录人/时间，原子写入观测、证据与事项修订、产品修订、审计和回执；此为有责任归属的手工观测，不声称自动验证外部来源。现有 manifest 和授权 SQL 已同步，154 条业务 grant /160 项验证要求；目标部署未安装。

## Reach 浏览器接口

前缀 /api/v1/products/{productCode}/reach-observations：

- GET /items/{itemUUID}?page=1&pageSize=20：真实分页列表。
- GET /items/{itemUUID}/{observationUUID}：历史详情，不接受查询参数。
- POST /items/{itemUUID}：记录观测。body 为 expectedRevision、expectedItemRevision、expectedScopeRevision、expectedEvidenceRevision、modelVersion、reach、sourceReference、methodology；必须提供 Idempotency-Key。

读取要求 priorities/view，写入要求 priorities/assess，均禁止缓存。事项及观测身份只取路由；记录人、时间、快照、已验证声明等额外字段拒绝。服务端绑定可信 actor、短期 permit 和精确 Runtime 能力，服务故障不降级为成功。

Reach 历史页面位于 /products/{productCode}/planning-items/{itemUUID}/reach，规划事项详情提供入口。使用每页 20 条真实分页，展示数量/单位、模型、统计窗口、修订一致性和记录时间；详情展开显示来源定义、引用、取数方法、记录人和范围/证据修订。该页面不将修订一致标为外部来源已验证。

GET /api/v1/products/{productCode}/reach-observations/permissions：要求 priorities/view，返回 product_code、status、revision、assess。view 与 assess 校验的操作者、产品修订和关系事实必须一致；无评估权限返回 assess=false，授权故障或上下文变化不会降级成允许。不接受查询参数，仅支持 GET。

Reach 创建页 /products/{productCode}/planning-items/{itemUUID}/reach-new 从历史页的评估权限入口进入。先按真实分页选择 RICE 版本，查看冻结窗口/去重定义/来源定义，再填写实际数量、来源引用和取数方法。提交绑定读取到的产品/事项/范围/证据修订，确认提示旧评估需重新核对；同载荷失败重试复用幂等键。空数量不转为零。

## RICE 周期领域启用条件

周期模型选用和开放命令已支持 RICE 冻结定义，但要求该产品/模型至少存在一条与当前事项范围、证据修订一致且事项仍可评估的 Reach 观测。只有发布定义或仅有过期记录均不足以启用。每次 RICE 评估仍必须单独绑定本事项观测，不能借用其他事项数量。

此条件证明已有可归责、口径一致的手工观测，不代表外部来源自动验证。浏览器周期选用界面当前仍待 RICE 适配；评估 Runtime 与历史读取已接入，浏览器提交 BFF/表单尚待完成。

评估历史读取新增 model_method、rice_impact、reach_observation_biz_id，RICE 的 value_score 为空，加权字段保持原语义。读取服务部署前需应用 v5.29–v5.31 模型/观测/评估迁移；不以缺列回退隐藏未部署迁移。历史接口原有 current/stale、权限和分页规则不变。

## RICE 评估 Runtime 提交

POST `/v1/aims/internal/products/{productCode}/planning-assessments:rice-create`，operation 为 `aims.product-priorities.rice-assess`。要求精确 `aims:product-priorities:rice-assess` 服务能力及可信委托操作者；普通 assess 或 reach-record 服务能力不能替代。业务授权仍为本产品 `product_priorities/assess`。

请求信封包含 `input`、`authorization`、`idempotency_key`。input 为 PlanningRICEAssessmentCreate：周期/事项身份与完整预期修订、模型版本、观测 UUID、影响系数、置信度、人日投入、依据、证据引用和投入确认。Reach 数量从服务端保存的观测读取，不接受客户端覆盖。保存、候选当前评估更新、修订递增、审计与幂等回执在同一事务完成；不会自动移动规划队列。

Console 初始化与核验脚本已包含两个 Runtime audience 的 rice-assess grant，合计 156 条业务 grant /162 项要求；目标环境安装和实际令牌签发仍待验收。此接口尚不能代表浏览器端 RICE 提交流程已完成。

### RICE 浏览器评估提交

POST `/api/v1/products/{productCode}/planning-cycles/{cycleUUID}/items/{itemUUID}/rice-assessments`，要求 `Idempotency-Key`，不接受查询参数。请求使用 expectedRevision、expectedCycleRevision、expectedItemRevision、expectedScopeRevision、expectedEvidenceRevision、assessment、rationale、evidenceReferences、evidence、estimateConfirmed。

assessment 包含 model_version、observation_biz_id、effort_unit=person_day、impact、confidence、effort_person_days。影响系数使用字符串 0.25/0.50/1.00/2.00/3.00；置信度为 0.50/0.80/1.00；投入为最多两位小数的人日字符串。三个评分维度必须显式填写或传 null，未知观测引用使用空字符串。已填写维度必须有依据和有效证据引用，已知投入必须确认。服务端校验观测是否适用于当前事项、修订和冻结模型。

BFF 复用产品 assess 授权与共享证据校验，绑定路径身份和会话 actor，调用 rice-create 精确能力。禁止客户端传 Reach 数量、加权维度、操作者或分数。输入及真实路由 handler 专项通过；浏览器表单仍待接入。

### 候选读取的模型语义

周期候选 assessment 增加 model_method 与 rice_impact。RICE 返回实际 priority_score，同时 value_score 保持 null；列表按模型方法展示影响系数或加权价值。推荐排序仍限同周期、同投入类别、当前有效且未开始事项，按 priority_score 降序，不修改决策队列。现有价值—投入矩阵要求加权 value_score，因此 RICE 暂列入未绘制集合，RICE 矩阵展示仍待适配。

RICE 浏览器模型兼容校验统一于 productRICEModel：验证版本、冻结时间窗口、去重对象/来源定义、人日单位、最小投入、影响/置信度枚举及八位半入精度。Reach 创建页禁用不受支持的版本并在提交前再次检查；该校验仅决定前端能否表达模型，不替代 Runtime 对持久版本和观测当前性的验证。

### RICE 评估表单初步接入

现有事项 assess 页面接受受支持的 RICE 冻结快照，按方法显示影响/置信度/人日投入，复用依据、证据关联、投入确认和幂等重试。RICE 提交至 rice-assessments，过滤掉加权维度；加权提交继续仅包含原维度。

当前 Reach 引用通过填写历史观测 UUID 完成，提供新标签页打开事项 Reach 历史的入口；空引用保持未知，确认摘要包含引用。此为暂时交互，分页观测选择、提交前观测详情展示及浏览器验收仍待完成，不作为最终易用性验收结果。

Reach 评估引用现已改为真实分页观测选择器（每页 20 条），替代手工复制 UUID。列表按当前事项读取，仅允许同模型且 scope/evidence 修订一致、未过期的记录；显示总数、可跨页保留选择、允许清空回到未知。所选详情展示数量、窗口、去重定义、来源定义/引用、取数方法和记录人。读取响应须与评估的产品/事项修订一致，失败清除选择并明确提示重新读取。浏览器交互和 1440/390 视觉验收仍待完成。

周期模型选择页现已允许选用受支持的 RICE 发布版本，展示窗口、去重对象/定义、来源定义和服务端 Reach 就绪条件；加权模型保留权重展示。选用回执按所选方法校验冻结规则，复用草稿/无评估历史限制、产品/周期修订和幂等重试。浏览器完整交互尚待验收。

### 按模型区分矩阵坐标

矩阵响应增加必需 model_method，由周期冻结版本对应的发布方法确定。加权模型保持 X=人日投入、Y=0–100 价值分；RICE 使用 X=人日投入、Y=RICE 人日推荐分，纵轴按返回点集最大值缩放（至少 1），不显示加权价值水平阈值。投入参考线继续沿用周期人日阈值。

完整且当前有效的 RICE 评估进入 points，无需构造 value_score；未知、过期或方法不匹配仍进入 unplotted。保留 200 点上限、截断提示和类别限制。筛选会改变 RICE 显示比例，坐标只辅助比较，不自动修改决定顺序。前端部署需同步此响应字段；浏览器坐标/视觉验收尚待完成。本节取代前文“RICE 不绘制”的阶段状态。

矩阵前端点校验要求八位十进制推荐分、0.5–1000000 人日和固定置信度枚举。推荐分上限按八位整数精确比较，避免 JavaScript 浮点舍入接受越界数据；绘图才转换为 Number。RICE 已知零仍可绘制，null/空字符串不作为零。模型方法不一致或过期数据不能进入有效点集。
