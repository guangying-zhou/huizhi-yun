# 产品版本多项目协调

Runtime：`POST /v1/aims/internal/products/{code}/versions:execution-coordination`，operation 为 `aims.product-versions.execution-coordination`。

使用精确能力 `aims:product-versions:read`、可信 actor 和 product_versions/view permit；body 的 input 仅含正整数 version_id。复用验收预览的授权事务与执行快照读取，不执行验收、发布或其他业务写入。

响应包含 product_code、version_id、workspace_revision，以及 target_count、incomplete_target_count、open_defect_count、total_weight、completed_weight、no_execution_plan、defect_coverage 和 projects。projects 含相同统计及 project_id；项目按 ID 排序。

目标按稳定 work-item ID 去重，重复但矛盾的事实拒绝；关联缺陷范围沿用 linked-descendants-only，不代表产品所有缺陷。权重不是工时；总权重为零表示无执行计划，不推导完成百分比。统计不推断日期延期或资源过载。

浏览器代理：`GET /api/v1/products/{code}/roadmaps/execution-coordination?versionId=1&page=1&pageSize=20`。仅接受这些参数，页大小上限 100，页码上限 1000000；GET/no-store，可信 actor 与短期产品 view permit。

代理检查每个项目及工作项 view 权限后过滤不可见项目，再对可见项目分页；响应增加 total（可见项目总数）、restricted_project_count、page、pageSize，产品级合计保持全量。不可见项目标识不返回，授权服务故障传播。

页面 `/products/{code}/execution-coordination` 已实现，并从版本列表进入。版本整体统计与可见项目明细分开展示，错误时隐藏旧结果并可刷新；静态检查通过，浏览器与视觉验收待完成。
