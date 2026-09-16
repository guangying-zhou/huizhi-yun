# @hzy/authz-core

跨 **Platform 在线鉴权** 与 **Foundation / 业务应用鉴权** 两条路径共用的纯算法授权 core。

零运行时框架依赖（不引 nuxt / h3 / vue），Platform（Node）与 Foundation（Nuxt）两侧都能直接消费。归属 platform 仓导出，方向遵循“Platform 是授权事实源，Foundation 消费”（方案 B）。

## 为什么存在

此前授权判定有三套实现且行为不一致：`platform/server/utils/authorization.ts`（DB 直查）、`console/server/utils/policyAuthorization.ts`（读 bundle）、各业务应用复制的 `platformBundleAuthorization.ts`。三者算法相同、只有数据源不同 —— 正是端口/适配器场景。本包把判定算法收敛为唯一实现，数据获取交给 `GrantSource` 适配器。

## 当前能力

- `actionSatisfies(granted, required, policy?)` —— 动作蕴含单一事实源。方向固定为“持有方蕴含需求方”，钉死 3.3 提权（view 不得通过 admin）。默认层级与 console / `permissionActions.ts` 一致（admin 默认不蕴含 approve），manifest 的 `implies` 可覆盖。
- `evaluate(input)` —— 授权单元遍历：权限取并集，但每个授权各自的范围必须独立成立，不跨授权拼接；`defaultScopes`、`assignmentScopes` 与 `scopes` 分组分别判定，避免同维度角色默认范围和授权关系范围被错误 OR 合并。
- `scopeMatches(scopes, object)` —— 同维度 OR、跨维度 AND；relation 维度由应用先经 resolver 判定后填入 `matchedRelations`。
- `grantScopesMatch(grant, object)` —— 对单个授权单元的角色默认范围、授权关系范围和额外范围分别求交。
- `isEnterpriseRole(role)` —— 仅凭 `app_code 为空 + active + 可分配` 判定，钉死 3.4（纯自定义角色生效）。
- `GrantSource` / `RelationResolver` 端口与全部判定类型。

Platform 的 `DbGrantSource` / `buildDbAuthorizationGrants()` 已覆盖用户 direct 授权、active 部门/职位 membership 继承授权、模板绑定、override grant/exclude、角色默认范围与 assignment scope；Foundation 的 policy-bundle adapter 已消费 v1 `subjectMemberships` 并生成等价 grant。

## 测试

```bash
node --test --experimental-strip-types "src/**/*.test.ts"
```

`src/golden.test.ts` 是黄金 contract test，含 3.3 / 3.4、范围不跨授权拼接、角色默认范围与 assignment 范围分组判定的永久回归。

## 下一步（尚未接入）

1. `platform/server/utils/permissionActions.ts` 收敛为 `actionSatisfies` 的薄包装，消除平行实现。
2. `BundleGrantSource`（foundation）与 `DbGrantSource`（platform）继续收敛为等价输入的同源 contract test。
3. policy bundle 由 `DbGrantSource` 的同一 grant 收集逻辑序列化生成，实现在线鉴权与离线 bundle 同源。
4. 业务应用退化为 `createAppPermissionGuard()` 薄包装，删除本地授权算法。
