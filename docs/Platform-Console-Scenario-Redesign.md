# Platform 控制台场景化重设计

状态：Draft  
日期：2026-04-23

## 1. 结论

`platform` 的管理端不应该继续按数据库对象平铺成“租户、应用、订阅、部署、许可证”的 CRUD 集合。平台运营人员真正要完成的是一组跨对象任务：

1. 把新客户从创建租户推进到可用
2. 把新应用从接入资料推进到可开通
3. 为某个客户编排应用开通、授权、部署和 release gate
4. 发现运行异常并快速定位到租户、应用、deployment、license
5. 保证 manifest、policy bundle、runtime credential、revocation 都在可信边界内流转

因此前端信息架构改为“工作流入口 + 对象详情支撑”，对象 CRUD 只保留在具体任务的高级区和支撑页里。

## 2. 当前主要问题

### 2.1 CRUD 入口过多，用户不知道下一步

旧菜单把租户、应用、订阅、部署、许可证全部并列，要求用户自己理解这些对象之间的先后关系。实际场景中，平台运营只关心“客户还能不能启用应用”，而不是先记住要打开哪张表。

### 2.2 平台侧和租户侧职责仍然混在文案里

`/admin` 应该处理跨租户治理、商务确认、授权下发、运行风险；`/dashboard` 应该处理本租户的组织、访问模型、应用启用和配置。页面文案和入口必须不断强化这个边界，避免以后靠隐藏按钮做权限隔离。

### 2.3 开通链路没有 release gate

`deployment` active、`license` active、连通性通过、policy bundle 下发成功应共同构成正式启用条件。任何单点状态都不应被表达成“开通完成”。

### 2.4 Runtime 信任边界不能靠前端补救

明显的方案错误需要在产品方案里先改正：runtime 启动只能报到版本、拉取签名 bundle、上报 heartbeat；manifest 注册和审核必须是受控的发布或平台动作。runtime API 也应使用 deployment credential 或签名，不能只靠 `deploymentCode + tenantCode`。

## 3. 新的信息架构

### 3.1 Admin Console

| 新入口 | 原对象支撑 | 目标用户任务 |
|---|---|---|
| 运营工作台 | tenants, applications, subscriptions, deployments, licenses | 看今日队列、风险、下一步 |
| 客户开通台 | tenants, onboarding steps, tenant summary | 创建客户、确认登录模式、推进开通阶段 |
| 应用接入工作台 | applications, manifests, roles, templates | 让应用达到可售、可授权、可审计状态 |
| 开通编排 | subscriptions, deployments, licenses | 为一个客户启用一个应用，并推进到 release gate |
| 运行诊断 | deployments, heartbeat, connectivity checks | 查看 deployment 健康、版本漂移和连接问题 |
| 授权风险 | licenses, capabilities, revocation | 处理过期、宽限、吊销和能力边界 |

### 3.2 Tenant Dashboard

| 新入口 | 原对象支撑 | 目标用户任务 |
|---|---|---|
| 租户工作台 | tenant context, subscriptions | 看本租户是否还能继续开通 |
| 开通进度 | onboarding, subscriptions | 按步骤补齐资料、应用、授权、部署 |
| 应用中心 | subscriptions | 选择应用、查看启用状态 |
| 访问模型 | roles, templates | 维护角色、模板、授权范围 |
| 成员与主体 | users, subjects | 管用户、部门、岗位等授权主体 |

## 4. 页面设计原则

1. 每个页面顶部回答“我现在应该处理什么”，而不是只显示对象名。
2. 列表项显示阻塞原因、下一步动作和责任方，不只显示 code 和状态。
3. 内部标识、JSON、密钥、payload hash 默认进入高级区；常规用户先看到业务语义。
4. 开通和接入页面用 stepper / checklist 表达跨对象进度。
5. 部署、许可证独立页降级为诊断和风险支撑页，不作为普通开通的主要路径。
6. 所有关键动作最终要能回到审计时间线。

## 5. 第一阶段落地范围

本阶段不改数据库和 API，只调整前端信息架构和页面表达：

1. 左侧菜单改成场景化命名。
2. `/admin` 改成平台运营工作台。
3. `/dashboard` 改成租户工作台。
4. `/admin/subscriptions` 文案和布局改为开通编排，弱化 raw code/json。
5. 统一控制台卡片、列表、提示和输入的基础样式，减少装饰化渐变和过大圆角。

后续阶段再补专门的运行诊断页、授权风险页、manifest 审核页和 release gate API。
