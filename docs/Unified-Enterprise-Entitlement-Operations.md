# 统一企业资格操作手册（INT-407）

面向 Platform 运营与企业管理员。合同与字段定义见[统一企业权益与运行身份转换合同](./Unified-Enterprise-Entitlement-Contract.md)；本文只说明日常判断与操作，不授权对任何实际租户执行。

## 1. 三件事分开判断

一个人能不能使用某项功能，要**同时**满足三件互相独立的事：

| 判断 | 管什么 | 谁维护 | 不满足时用户看到 |
| --- | --- | --- | --- |
| 企业资格 | 这家企业整体是否在有效服务期（`enterprise-full`，状态 active） | Platform 运营 | `enterprise_entitlement_inactive`（403），整体不可用 |
| 岗位权限 | 这个人对这个资源、动作和对象范围有没有授权 | 企业管理员（角色、数据范围） | `permission_denied`（403），只影响此人此操作 |
| 运行状态 | 该能力的组件是否已部署、外部服务是否已配置 | 实施/运维 | 「未部署」「未配置」等明确条件；依赖故障为 503 |

**全量功能不是全员权限。** `enterprise-full` 只表示企业有资格使用全部功能，不给任何人追加权限；新上线的模块也不会自动加进已有角色。员工仍然只能做其角色和数据范围允许的事。该不变量由 `console/test/policyBundleLifecycleAcrossLayers.test.ts`「enterprise-full is not a user grant」与 `platform/test/enterpriseEntitlementBundle.test.ts`「adds qualification without expanding automatic personnel grants」锁定。

因此：

- 不再有「基础版/专业版」或「请升级」提示。某功能不可用时，按上表找原因：企业资格失效、个人缺权、还是组件未部署/未配置。
- 让员工能用新模块，是**给角色授权**，不是改企业资格。
- 模块配置开关只影响运行和导航，不改变企业资格，也不是付费项。

## 2. 常见情形怎么处理

| 情形 | 正确处理 | 不要做 |
| --- | --- | --- |
| 新企业开通 | 按已确认订单期间开通 `enterprise-full`；员工权限由企业管理员另行分配 | 为了「能用」给全员管理员角色 |
| 原不同商业档位企业转换 | 先只读预览；来源期间一致才自动生成候选，期间不一致或缺权威期间标为待核对 | 取最长或最新期间；以迁移日重置起止时间 |
| 企业已到期、停用或撤销 | 转换后保持同样的无效状态 | 借「全量功能」恢复或免费续期 |
| 某组件未部署或外部服务未配置 | 显示真实启用条件，由实施完成部署或配置 | 显示「未购买」；用隐藏导航代替后端拒绝 |
| 员工反馈看不到某功能 | 先确认企业资格有效，再查其角色与数据范围，再查组件状态 | 直接调整企业资格 |

## 3. 暂停、撤销与恢复

使用 `POST /api/platform/ops/subscriptions/enterprise/{tenantCode}/state`，只接受 `action: suspend|revoke|restore`、`operationId`、`expectedRevision`、`reason`。要求 ops 会话且具备 `ops.subscriptions:admin`；普通 view/edit/confirm 或 tenant_admin 不能执行。

- **暂停**：仅针对 active/pending。
- **撤销**：终止状态，不可恢复。
- **恢复**：仅针对 suspended，且租户自身须为 active；**保持原起止日期**，原结束时间已过则恢复后仍是 expired。恢复不续期、不生成订单。
- 先读取当前 revision 再发命令；409 表示 revision 已变化或同一 `operationId` 的内容不同，重新读取后再决定，不要用旧回执覆盖当前状态。

License 撤销与部署隔离独立于企业资格，继续单独生效。

## 4. 转换流程要点

只读预览 → 固定来源快照 hash → 无冲突记录事务写入 → 签名资格输出 → 验证生效 → 切换该租户读路径。写入按 `migration_id + tenant_code` 幂等；来源变化会拒绝并要求重新预览。冲突记录须附依据和决定人，不在文档或工单中编造合同结论。

## 5. 当前验证状态（2026-09-15）

- 代码层授权矩阵回归已通过（见实施计划 INT-406）。
- 在随机端口、全新 datadir 的一次性 MySQL 实例中执行 `platform/scripts/test-enterprise-entitlement-mysql.mjs`，覆盖状态流转、actor 回执、租户隔离、并发重放、漂移、回滚与旧记录保留，以及新企业开通、签名 License、停用、Host 入口与签名边界，全部通过并自动清理。
- **尚未**在隔离测试租户上执行脱敏映射与开通/转换/停用/恢复/独立能力配置的实际入口验证；在此之前不得据本手册宣称任何租户已完成转换。
