# 产品路线图接口

## 探索时间窗口

`GET /api/v1/products/{productCode}/roadmaps/windows/{itemBizId}` 读取现有规划事项的探索时间窗口。返回 `biz_id`、`product_code`、`title`、`lifecycle`、`starts_on`/`ends_on`（null表示未安排）、事项`revision`与`workspace_revision`。

`PATCH` 同一路径编辑窗口，要求 `Idempotency-Key`。body：

```json
{
  "startsOn": "2026-10-01",
  "endsOn": "2027-03-31",
  "expectedRevision": 5,
  "expectedItemRevision": 2,
  "reason": "季度探索安排"
}
```

两端须同时明确传null以清空，不接受缺省、半窗口、无效日历或结束早于开始。事项biz_id仅取路由，拒绝客户端提交身份、状态或承诺字段；不接受query。产品须active，事项须proposed/in_delivery。

业务授权分别为 `product_roadmaps/view`、`edit`。Runtime POST `/v1/aims/internal/products/{code}/roadmaps:window-view`、`:window-edit`；精确服务能力分别为 `aims:product-roadmaps:read`、`:window-edit`，附现有读写传输权限。使用可信服务操作者及15秒Foundation permit。

窗口表示探索安排。编辑仅更新窗口和事项/产品修订，保存变更原因、前后审计及幂等回执，不改变deadline、范围/证据修订、决定顺序或版本承诺。正式承诺基线独立实现。

当前状态：领域读写、Runtime及BFF已实现；实际Adapter成功链路、页面及季度视图待接入验证。

## 页面权限快照

`GET /api/v1/products/{productCode}/roadmaps/permissions` 要求路线图view，返回product_code/status/revision/edit。view与edit评估的产品、操作者、状态、修订及成员/经理事实必须一致，不一致返回409；不返回操作者身份，禁止query及写方法。该结果只控制界面，写请求仍重新授权。

探索窗口实际Adapter+隔离MySQL已验证初始空值、设置跨年窗口、幂等重放、产品与事项修订冲突、清空及两条成功回执；使用注入服务上下文，非真实JWT验收。

## 季度读取 Runtime（浏览器 BFF 待接入）

`POST /v1/aims/internal/products/{code}/roadmaps:quarter-view` 使用精确 `aims:product-roadmaps:read` 服务能力及只读传输。请求包含 `authorization`（product_roadmaps/view）、`planning_authorization`（product_priorities/view）与 `input`：`cycle_biz_id`、`year`（1000–9999）、`quarter`（1–4）、`unscheduled`、`page`、`page_size`。两个 permit 均须绑定可信操作者和当前产品事实。

指定周期内按日期窗口与季度闭区间重叠筛选；unscheduled=true 时改查双空窗口。结果按原 decision_rank/id 排序，返回 items、total、by_bucket、page/pageSize 和当前产品/周期/队列修订。跨季度事项可出现在多个季度，不复制实体、不改优先级、不表示正式承诺。此接口复用既有 read grant，无新增授权数量。

## 季度浏览器 BFF

`GET /api/v1/products/{code}/roadmaps/quarter` 已接入上述 Runtime。query 仅允许 `cycleId`（规范 UUID）、`year`、`quarter`、`unscheduled`（true/false）、`page`（默认 1）、`pageSize`（默认 20，最大 100）；数字须为规范正整数字符串，拒绝数组、未知字段与客户端身份。请求不使用幂等键，响应 no-store。

BFF 分别请求路线及优先级 view 权限，两次产品/操作者/状态/修订/成员事实须一致，否则返回 409；任一权限拒绝均不调用 Runtime。上游不可用返回 503。季度页面仍待接入。

## 正式承诺写入 BFF

`POST /api/v1/products/{code}/roadmaps/commit/{itemBizId}` 要求 Idempotency-Key、product_roadmaps/commit 业务权限及 aims:product-roadmaps:commit 精确服务能力。body 仅允许 cycleId、expectedRevision、expectedItemRevision、expectedCycleRevision、expectedQueueRevision、expectedPreviousId、reason。首次 expectedPreviousId=0，后续必须引用已查看的最新基线；禁止 query 及客户端日期/快照/身份。日期和快照从服务端当前事实读取。

原基线永不改写，新基线追加并保存前驱 ID；基线变化和无变化重复确认返回 409。历史浏览器接口与页面尚待接入。

## 承诺历史浏览器 BFF

`GET /api/v1/products/{code}/roadmaps/commitments/{itemBizId}` 已接入 Runtime roadmaps:commitments。仅允许 page/pageSize，默认 1/20，最大页大小 100；路由规范 UUID 绑定事项，不接受客户端身份或事项覆盖。路线与优先级 view 双权限及当前事实必须一致，复用精确 read 服务能力，响应 no-store。

返回原始基线分页、全量最新基线 ID、当前产品/事项修订及每条 requires_review/review_reasons。复评提示不自动撤销承诺，旧日期与快照保留。

权限快照 `GET roadmaps/permissions` 现独立返回 edit 和 commit。view 为入口，两个动作各自检查；产品/操作者/状态/修订/成员事实必须一致。edit=true 不推导 commit=true，写入仍重新执行 commit 授权。
