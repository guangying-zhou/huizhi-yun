# 04 Runtime 发布管理

页面：`/admin/runtime-releases`、`/admin/applications/{code}/releases`

## 4.1 版本从哪来

Release 版本号来自代码仓库的 release / tag，组件发布 Tag 格式为 `<component>/vX.Y.Z`（如 `finance/v0.3.1`）。平台不自己编版本号，只登记和分发。

一个 Release 记录包含：应用编码、版本号、对应的 Manifest 版本与哈希、SDK 版本、兼容范围、发布状态。

## 4.2 发布链路

```
Git tag  →  Manifest 注册（03 章审核通过）  →  创建/更新 Release
                                                    │
                                          客户部署升级并启动
                                                    │
                                    runtime 心跳上报实际版本
                                                    │
                              平台比对：一致 ✅ / 漂移 ⚠️
```

心跳上报的字段：`app_version`、`manifest_version`、`manifest_hash`、`sdk_version`。这四项是判断"客户实际跑的是不是你以为的版本"的唯一依据。

## 4.3 Runtime 发布页在做什么

`/admin/runtime-releases` 汇总全部应用的版本分发情况，回答三个问题：

1. **每个应用的最新可用版本是什么**
2. **哪些租户/部署还停在旧版本**
3. **哪些部署上报的版本与登记的 Release 对不上（版本漂移）**

## 4.4 版本漂移怎么处理

漂移分两类，处理方式不同：

| 现象 | 含义 | 处理 |
| --- | --- | --- |
| `app_version` 落后 | 客户没升级 | 通知客户升级；托管云由运营侧统一推进 |
| `manifest_hash` 不一致 | 跑的代码与登记 Manifest 不符 | **优先处理**，可能是私自改动或发布链断裂，先查发布记录再决定回滚或补注册 |
| `sdk_version` 不兼容 | Foundation SDK 与应用版本不匹配 | 按兼容矩阵确认，必要时同时升级 Foundation 与应用 |

`manifest_hash` 不一致意味着权限清单可能与平台下发的策略包不匹配，属于安全相关问题，不要放着不管。

## 4.5 发布前检查清单

新版本对外发布前逐项确认：

- [ ] Manifest 注册已 approved 并物化
- [ ] Release 已登记，版本号与 Git tag 一致
- [ ] 资源/动作快照无权限覆盖 warning
- [ ] 若涉及跨应用调用，目标租户的服务授权（Console grant）已核验通过
- [ ] 至少一个测试租户完成部署 + 连通性检查 + 心跳版本一致
- [ ] 有回滚方案：上一版本 Release 仍可用

> 关于跨应用授权核验：只确认"数据库里有授权记录"或"页面能打开"都不算数，必须用实际 service client 对全部组合 scope 做一次令牌签发探测。

## 4.6 回滚

回滚就是让部署切回上一个 Release：

1. 在 `/admin/runtime-releases` 找到目标应用的上一个稳定版本。
2. 通知客户或运营侧执行部署回滚。
3. 等心跳上报，确认 `app_version` 与 `manifest_hash` 都回到目标版本。
4. 若新版本引入过 Manifest 变更，检查策略包是否需要一并回退——权限清单缩小时，租户里已配的角色可能引用了不存在的资源，会在企业侧报错。

## 4.7 灰度

`/admin/feature-flags` 可以按租户开关功能。用于：

- 新功能先在试点租户放量
- 出问题时快速关掉单个功能，而不是回滚整个版本

灰度开关不能替代版本管理：功能已经上线并被客户依赖后，长期挂在开关上会让"客户到底能用什么"变得不可追溯，稳定后要及时收敛进正式版本。
