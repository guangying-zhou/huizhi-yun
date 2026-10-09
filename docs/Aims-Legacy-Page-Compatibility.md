# Aims 退役后的旧页面入口

## 精确兼容分类与实现（2026-10-07）

以实际 Host 登记文件为准；同 URL 的原 standalone 源文件不视为 Host 可达。产品 settings 维护按钮受 `canEdit && !hosted` 限制，ProjectNavbar 的环境/服务台与 plan 的旧详情跳转也受非 Host 限制。未把这些原应用写页面接回 Host。

A 为当前生产明确访问的设置 URL，直接复用现有编辑页；B 为正式身份/个人资料等价入口，客户端精确重定向；C 为没有已交付 Host 等价功能的旧页面，精确注册无读取/写入的友好归档页。C 不宣称原业务功能已恢复；可从项目/首页进入已交付功能。

| 旧路径 | 分类 | 处理与依据 |
| --- | --- | --- |
| `/aims/admin` | C | 原文件 aims/app/pages/admin/index.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/admin/products` | C | 原文件 aims/app/pages/admin/products.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/admin/project-templates` | C | 原文件 aims/app/pages/admin/project-templates.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/board` | C | 原文件 aims/app/pages/board.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/embed/project/:bizId` | C | 原文件 aims/app/pages/embed/project/[bizId].vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/help/pivr` | C | 原文件 aims/app/pages/help/pivr.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/integration-operations` | C | 原文件 aims/app/pages/integration-operations.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/login` | B | 客户端 replace 到 /enterprise，复用 Host 正式登录门禁，不继承旧 query |
| `/aims/product-setup` | C | 原文件 aims/app/pages/product-setup.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cost-rules` | C | 原文件 aims/app/pages/products/[productCode]/cost-rules.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cost` | C | 原文件 aims/app/pages/products/[productCode]/cost.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cycles/:cycleId/add-item` | C | 原文件 aims/app/pages/products/[productCode]/cycles/[cycleId]/add-item.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cycles/:cycleId/budget` | C | 原文件 aims/app/pages/products/[productCode]/cycles/[cycleId]/budget.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cycles/:cycleId/capacity` | C | 原文件 aims/app/pages/products/[productCode]/cycles/[cycleId]/capacity.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cycles/:cycleId/close` | C | 原文件 aims/app/pages/products/[productCode]/cycles/[cycleId]/close.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cycles/:cycleId/edit` | C | 原文件 aims/app/pages/products/[productCode]/cycles/[cycleId]/edit.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cycles/:cycleId/items/:itemId/assess` | C | 原文件 aims/app/pages/products/[productCode]/cycles/[cycleId]/items/[itemId]/assess.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cycles/:cycleId/items/:itemId/assessments` | C | 原文件 aims/app/pages/products/[productCode]/cycles/[cycleId]/items/[itemId]/assessments.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cycles/:cycleId/items/:itemId/commit` | C | 原文件 aims/app/pages/products/[productCode]/cycles/[cycleId]/items/[itemId]/commit.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cycles/:cycleId/items/:itemId/consumption` | C | 原文件 aims/app/pages/products/[productCode]/cycles/[cycleId]/items/[itemId]/consumption.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cycles/:cycleId/items/:itemId/move` | C | 原文件 aims/app/pages/products/[productCode]/cycles/[cycleId]/items/[itemId]/move.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cycles/:cycleId/items/:itemId/select` | C | 原文件 aims/app/pages/products/[productCode]/cycles/[cycleId]/items/[itemId]/select.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cycles/:cycleId/items/:itemId/withdraw` | C | 原文件 aims/app/pages/products/[productCode]/cycles/[cycleId]/items/[itemId]/withdraw.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cycles/:cycleId/items` | C | 原文件 aims/app/pages/products/[productCode]/cycles/[cycleId]/items/index.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cycles/:cycleId/matrix` | C | 原文件 aims/app/pages/products/[productCode]/cycles/[cycleId]/matrix.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cycles/:cycleId/model` | C | 原文件 aims/app/pages/products/[productCode]/cycles/[cycleId]/model.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cycles/:cycleId/observations/:observationId/correct` | C | 原文件 aims/app/pages/products/[productCode]/cycles/[cycleId]/observations/[observationId]/correct.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cycles/:cycleId/observations` | C | 原文件 aims/app/pages/products/[productCode]/cycles/[cycleId]/observations/index.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cycles/:cycleId/observe` | C | 原文件 aims/app/pages/products/[productCode]/cycles/[cycleId]/observe.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cycles/:cycleId/open` | C | 原文件 aims/app/pages/products/[productCode]/cycles/[cycleId]/open.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cycles/:cycleId/review` | C | 原文件 aims/app/pages/products/[productCode]/cycles/[cycleId]/review.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cycles/:cycleId/roadmap` | C | 原文件 aims/app/pages/products/[productCode]/cycles/[cycleId]/roadmap.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/cycles/new` | C | 原文件 aims/app/pages/products/[productCode]/cycles/new.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/feature-version-matrix` | C | 原文件 aims/app/pages/products/[productCode]/feature-version-matrix.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/models` | C | 原文件 aims/app/pages/products/[productCode]/models/index.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/models/new` | C | 原文件 aims/app/pages/products/[productCode]/models/new.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/models/rice-new` | C | 原文件 aims/app/pages/products/[productCode]/models/rice-new.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/objectives/:objectiveId` | C | 原文件 aims/app/pages/products/[productCode]/objectives/[objectiveId].vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/objectives` | C | 原文件 aims/app/pages/products/[productCode]/objectives/index.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/objectives/new` | C | 原文件 aims/app/pages/products/[productCode]/objectives/new.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/planning-items/:itemId/commitments` | C | 原文件 aims/app/pages/products/[productCode]/planning-items/[itemId]/commitments.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/planning-items/:itemId/dependencies` | C | 原文件 aims/app/pages/products/[productCode]/planning-items/[itemId]/dependencies.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/planning-items/:itemId/feature` | C | 原文件 aims/app/pages/products/[productCode]/planning-items/[itemId]/feature.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/planning-items/:itemId` | C | 原文件 aims/app/pages/products/[productCode]/planning-items/[itemId]/index.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/planning-items/:itemId/reach-new` | C | 原文件 aims/app/pages/products/[productCode]/planning-items/[itemId]/reach-new.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/planning-items/:itemId/reach` | C | 原文件 aims/app/pages/products/[productCode]/planning-items/[itemId]/reach.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/planning-items/:itemId/roadmap` | C | 原文件 aims/app/pages/products/[productCode]/planning-items/[itemId]/roadmap.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/planning-items/:itemId/version` | C | 原文件 aims/app/pages/products/[productCode]/planning-items/[itemId]/version.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/release-comparison` | C | 原文件 aims/app/pages/products/[productCode]/release-comparison.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/settings` | C | 原文件 aims/app/pages/products/[productCode]/settings.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/products/:productCode/views` | C | 原文件 aims/app/pages/products/[productCode]/views/index.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/project-resources` | C | 原文件 aims/app/pages/project-resources.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/projects/:id/environments` | C | 原文件 aims/app/pages/projects/[id]/environments.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/projects/:id/milestones/:milestoneId` | C | 原文件 aims/app/pages/projects/[id]/milestones/[milestoneId].vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/projects/:id/service-desk` | C | 原文件 aims/app/pages/projects/[id]/service-desk.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/projects/:id/settings` | A | AR09 生产请求；与 /edit 同一 enterprise-project-edit.vue，权限与对象校验不变 |
| `/aims/quality-reviews` | C | 原文件 aims/app/pages/quality-reviews.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/reports` | C | 原文件 aims/app/pages/reports.vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/requirements/batch/:batchId` | C | 原文件 aims/app/pages/requirements/batch/[batchId].vue；未登记为 Host 业务实现，精确归档说明页，不复活其独立接口 |
| `/aims/settings/profile` | B | 客户端 replace 到 /enterprise/profile（enterprise/app/pages/enterprise/profile.vue） |

闭集59条兼容登记加settings1条，所有原116页面文件的源URL都有精确Host路由。兼容页不执行 fetch、不构造actor/permit、不连旧Aims、不接受query重定向。只保留2个固定重定向目标；返回项目仅接受正整数id。已补全量源页面→Host登记测试和无旧API回退测试。部署必须随冻结 SHA 验证生成物与动态模块。
