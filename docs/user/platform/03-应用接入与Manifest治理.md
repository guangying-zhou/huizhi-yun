# 03 应用接入与 Manifest 治理

页面：`/admin/applications`

## 3.1 为什么要治理 Manifest

Manifest 是应用向平台申报的"我有哪些资源、每个资源支持哪些动作、推荐哪些角色"的清单，也是平台生成策略包（Policy Bundle）的输入。

**Manifest 是权限的唯一技术事实源。** 审核 Manifest 就是在审核这个应用能对租户数据做什么。

## 3.2 应用台账

`/admin/applications` 列出全部已接入应用。新增应用走 `/admin/applications/new`，需要填：

- 应用编码 `appCode`（小写、kebab-case，如 `finance`）——**一旦发布不可改**
- 应用名称、图标、描述
- 应用类型、入口地址
- Manifest 路径与 Release Tag 前缀（平台据此从仓库拉取 manifest 与版本）

应用详情页分页签：

| 页签 | 路径 | 内容 |
| --- | --- | --- |
| 概览 | `/overview` | 状态、最新 Manifest / Release、健康度 |
| Manifest | `/manifests` | 注册请求列表与审核 |
| 资源 | `/resources` | 当前 Manifest 解析出的资源与动作快照 |
| 版本 | `/releases` | Release 台账 |
| 设置 | `/settings` | 接入参数、支持的 scope |

## 3.3 Manifest 审核流程

```
应用发布流程 / CLI 提交注册请求  →  received
                                      │
                          你在 /admin/applications/{code}/manifests 审核
                                      │
                    ┌─────────────────┴─────────────────┐
                approved                             rejected
                    │
        物化为正式 Manifest，解析 resources / actions 快照
                    │
        创建或更新 Release，更新应用的"最新版本"指针
```

**审核时逐项检查：**

1. **新增资源**是否有对应的业务说明？平白多出来的资源要问清楚。
2. **动作蕴含**是否合理？`admin` 只应蕴含同资源的 `view/edit/admin`。如果 Manifest 声明了 `admin -> approve` 或 `admin -> export`，必须在申报里写明理由并有契约测试，否则打回。
3. **推荐角色**的职责描述是否与动作集合一致？例如"只读"角色不应带写动作。
4. **跨应用 capability** 是否用 `<target-app>:<resource>:<action>` 格式（全小写、kebab-case）？出现 `assets.read`、`finance.contracts.read` 这类点号格式要打回。
5. **权限覆盖 warning**：审核页会提示"某资源动作在角色中无人覆盖"或"角色引用了不存在的资源"，两类都要在通过前解决。

**打回时**在拒绝原因里写清楚具体是哪个资源/动作/角色不合格，方便研发一次改对。

## 3.4 资源快照怎么用

`/admin/applications/{code}/resources` 展示当前生效 Manifest 解析出的资源树，是你回答客户"这个应用到底能配哪些权限"的权威依据。

以 Aims 为例，资源包括：工作台、项目组合、项目、工作项、看板、工时、报表、项目周报、项目文档质量检查、通知、项目模板、跨应用操作、系统管理。

企业侧配角色时看到的可选项就是这份清单，所以资源命名要业务化、可读，技术味太重的命名在审核阶段就要求改。

## 3.5 应用与订阅计划的关系

审核通过只是"平台承认这个应用存在"。要让客户买得到，还要：

1. 在 `/admin/plans` 把应用挂进某个订阅计划（见 [05](./05-订阅计划与角色目录.md)）。
2. 在 `/admin/subscriptions` 给目标租户开通（见 [06](./06-租户管理与开通编排.md)）。

## 3.6 常见问题

**Q：应用启动后会不会自动注册 Manifest？**
不会。应用启动只做版本报到和心跳上报，不触发新的 Manifest 注册。注册必须走发布流程或专用 CLI/API。

**Q：Manifest 改了但客户侧权限没变？**
检查三步：注册请求是否已 approved → 是否已物化并更新应用的最新 Manifest 指针 → 租户的策略包是否已重新下发（看 `/admin/deployments` 的策略包版本）。

**Q：能直接改数据库里的资源清单吗？**
不能。改了会与 Manifest 不一致，下次注册会被覆盖，而且业务代码只认 Manifest。
