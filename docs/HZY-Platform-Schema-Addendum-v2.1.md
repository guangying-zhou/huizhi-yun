# hzy_platform Schema v2.1 补遗

状态：Draft v2.1  
日期：2026-04-22  
基线：`HZY-Platform-Schema-Draft-v2.md`  
主线 SQL：`HZY-Platform-SQL-DDL-Draft-v2.sql`（已并入 v2.1 增量）

> 后续约束已并入 `HZY-Platform-Schema-Addendum-v2.4.md`。v2.1 中关于 `platform_app_credentials`、`platform_applications.current_credential_id` 的 app 级凭证模型已废弃；当前口径是 GitLab release/tag 表达应用版本，manifest 内容版本由 `manifest_seq` 表达，企业 x 应用当前凭证落到 `tenant_app_credentials` 并通过审计记录轮换历史。

---

## 1. 文档定位

本文档不是重写 v2，而是在 v2 三域模型保持不变的前提下，对第一阶段平台管理端必须落地的运营能力做增量补齐。

v2.1 只处理四类缺口：

1. 租户开通阶段没有一等模型
2. deployment 配置与连通性测试没有落库
3. 应用 manifest 注册/审核与 app 凭证轮换缺少治理模型
4. revocation 只有快照，没有可追溯源数据；bundle / revocation 缺少签名落点

---

## 2. 设计原则

- 不推翻 v2 的 `platform_* / boundary / tenant_*` 三域分层
- 尽量以增量 patch 方式补表补字段，不重做已有主键/唯一键
- 管理端需要直接查询的状态，必须有一等字段，不再依赖多表推断
- 运行时可下载对象（bundle / revocation）必须有“可签名对象 + 签名结果 + 源数据”三层落点

---

## 3. 变更摘要

### 3.1 Boundary Domain

#### `tenants`

新增：

- `onboarding_stage`
- `onboarding_updated_at`
- `onboarding_completed_at`

目的：

- 支撑 `/admin/tenants` 直接展示“当前开通阶段”
- 支撑 `/dashboard/onboarding` 在租户维度展示当前进度

#### `tenant_onboarding_steps`

新增租户开通步骤表。

最小职责：

- 保存每一步状态
- 保存步骤级配置快照
- 保存阻塞原因

推荐 `step_code`：

- `profile`
- `auth_mode`
- `applications`
- `commercial`
- `deployment`
- `connectivity`

#### `deployments`

新增：

- `connectivity_status`
- `deployment_config_json`
- `callback_url`
- `webhook_url`
- `client_id`
- `client_secret_ref`
- `last_connectivity_check_at`
- `last_connectivity_check_status`
- `last_connectivity_check_summary`
- `connectivity_verified_at`

目的：

- deployment 详情页可以直接展示部署配置摘要
- 管理台可以直接看出“是否已连通 / 最近一次测试结果”

#### `deployment_connectivity_checks`

新增 deployment 连通性检查历史表。

最小职责：

- 保存谁触发了测试
- 保存测试类型
- 保存请求/响应快照
- 保存通过/失败/超时结果

#### `policy_bundles`

新增：

- `bundle_payload_json`
- `signature`
- `signed_by_kid`

目的：

- bundle 不再只是 `uri + hash`
- 管理端和运行时都能回溯“签的到底是什么”

#### `revocation_entries`

新增 revocation 源表。

这是 v2.1 的关键补齐：  
吊销传播不再只依赖 `revocation_snapshots` 这种派生对象，而是先记录可审计、可查询的 entry，再按租户生成 snapshot。

#### `revocation_snapshots`

新增：

- `entries_json`
- `signature`
- `signed_by_kid`

目的：

- 对齐 `Control Plane API` 的下载契约
- 让下载对象和签名对象在库里有明确落点

---

### 3.2 Platform Domain

#### `platform_app_manifest_registrations`

新增 manifest 注册/审核流水表。

它和 `platform_app_manifests` 的职责分离：

- `platform_app_manifest_registrations`：注册申请、待审核、失败原因、审核历史
- `platform_app_manifests`：真正被物化并纳入版本台账的 manifest

这样管理端才能回答：

- 哪些 manifest 待审核
- 最近一次注册是否成功
- 某应用过去都提交过哪些版本

#### `platform_applications`

新增：

- `latest_registration_id`
- `last_manifest_registered_at`
- `last_manifest_review_status`
- `current_credential_id`

目的：

- Admin 首页和应用台账可直接聚合“待审核 / 最近注册结果 / 当前凭证”

#### `platform_app_credentials`

新增 app 级 client/secret 轮换表。

最小职责：

- 保存当前凭证
- 保存轮换链路
- 保留 `last_used_at`
- 永远只保存 `secret_ref`，不保存明文

---

## 4. 与管理端需求的对应关系

| 管理端需求 | v2 的问题 | v2.1 的补法 |
|---|---|---|
| 租户台账展示“当前开通阶段” | 只能从多表推断 | `tenants.onboarding_stage` + `tenant_onboarding_steps` |
| `/dashboard/onboarding` 六步向导 | 没有步骤级状态模型 | `tenant_onboarding_steps` |
| deployment 配置与连通性测试 | 只有 heartbeat，没有测试记录 | `deployments` 扩展 + `deployment_connectivity_checks` |
| manifest 审核与注册历史 | 只有 manifest 版本档案 | `platform_app_manifest_registrations` |
| 生成/重置 app 密钥 | 没有轮换模型 | `platform_app_credentials` |
| bundle/revocation 下载签名对象 | 只有 `uri + hash` | `bundle_payload_json / entries_json + signature` |
| logout / 强制下线 / revocation 运营 | 没有 canonical entry | `revocation_entries` |

---

## 5. 迁移顺序建议

推荐顺序：

1. 执行当前主线 `HZY-Platform-SQL-DDL-Draft-v2.sql`
2. 然后更新 seed / API / admin UI 查询

代码侧优先修改：

1. `/admin/tenants`
2. `/dashboard/onboarding`
3. `/admin/applications`
4. `/admin/subscriptions` 与 deployment 详情
5. runtime 的 bundle / revocation 生成与下载接口

---

## 6. 结论

v2 解决的是“模型分层正确”；  
v2.1 解决的是“第一阶段平台管理端真的能运营起来”。

因此 v2.1 的定位不是架构重做，而是把以下四条运营链路补到可执行：

- 租户开通
- deployment 配置与测试
- 应用接入治理
- revocation / bundle 运行时治理
