# 统一企业权益与运行身份转换合同

日期：2026-09-13。对应 ADR-018 第 3.2、5 节及 INT-005、INT-401～407。

状态：仓库代码及 schema 清点完成；本文件定义待实现合同，不表示租户权益已转换。未读取生产数据库、未导出签名 token 或凭据、未写库。实际租户历史记录及有效期冲突仍须 dry-run 清点。总进度以 [实施台账](./Unified-Enterprise-Implementation-Plan.md) 为准。

## 1. 当前依赖及处置

| 当前事实及代码入口 | 处置 | 目标及兼容条件 |
| --- | --- | --- |
| `platform_plans`、`platform_plan_apps`、`platform_plan_capabilities`；`platform/server/utils/onboardingFlow.ts` 的 `loadPlanApps/loadPlanCapabilities` | 合并商业资格；过渡保留旧行 | 新企业使用唯一全量产品资格。不能以旧 plan 的 app 列表生成全量目录。商业档位历史不删除；release pin、运行能力和实际配额另行归类，不能全部删除 capability |
| `tenant_subscriptions`；`platform/server/utils/tenantPlanSubscriptions.ts` | 合并为企业整体资格，保留历史 | 保留开通、有效期、整体停用/恢复及订单关联；新资格单独版本化，禁止把旧 `plan_code` 批量覆盖为统一值 |
| `subscriptions`；`platform/server/utils/subscriptions.ts` 的 `subscriptionJoins` | 过渡，最终退役购买门槛 | 当前 `planScoped` 从 plan apps 筛选目录，且部署与 License 仍引用逐应用订阅。先换读合同，再退役逐应用购买判断；旧行作为审计和兼容引用保留 |
| `platform_orders/platform_payments`；`tenant-admin/subscription-plans/subscribe.post.ts`、`ops/subscriptions/orders/[orderNo]/confirm.post.ts` | 保留 | 不改金额、支付状态、合同期间、历史 plan。新购取消档位选择；迁移命令不能伪造支付、创建续期订单或调用支付确认 |
| `licenses/license_capabilities/license_deployments`；`platform/server/utils/licenseArtifacts.ts`、`_handlers/licenses.post.ts` | 保留签名及撤销；逐应用产品资格过渡 | 旧签名凭证不重写。新统一资格签名与技术部署许可分离；License grace 与硬到期不能混为服务合同期间 |
| `deployments`、`target_release_id`、`platform_app_releases`、manifest/release tag | 保留，整合部署映射 | 物理 Host 的技术版本与逻辑模块独立。全量功能不代表每个独立服务已经部署，不自动清空 pin 或重指运行身份 |
| `platform/server/utils/policyBundle.ts` 的 `collectTenantAppCodes/collectApplications/collectCapabilities` | 修改资格投影，保留签名链 | 当前应用集合来自 active 逐应用订阅与 deployment 的并集；capability 来自 active License 绑定。新企业目录由统一 manifest 目录提供，部署状态单独输出 |
| `platform/server/utils/policyBundleV2.ts`、`authorizationSnapshotBuilder.ts`、`appManifestResources.ts`、`appManifestRoles.ts` | 保留 | 资源、动作、角色继续由模块 manifest 导入。稳定 `appCode/resource/action` 不因 Host 合并重命名。不得用统一产品角色替代现有自定义角色 |
| `console/server/utils/platformRuntime.ts`、`bundleCache.ts` | 保留验证，新增合同版本 | shared Cloudflare 使用 internal service token 拉取签名 bundle；PM2/self-hosted 仍消费 Console License。保持签名、tenant/deployment/environment、撤销、缓存新鲜度校验 |
| `console/server/utils/userApplications.ts`、`policyAuthorization.ts`、`policyScopedAuthorization.ts` | 保留人员筛选，分离资格状态 | `buildAllowedAppCodesFromPolicyBundle` 产生人员可访问模块，不能替换为全量目录；另提供企业可配置模块目录，避免用无权菜单枚举泄露敏感信息 |
| `foundation/server/utils/applicationAuthorization.ts`、`platformBundleAuthorization.ts`、`subjectScopedAuthorization.ts`；`@hzy/authz-core` | 保留 | 合并角色、模拟隔离、grant 与 scope 的绑定、动作蕴含和对象关系不变；普通业务入口仍经 Console 取得权限快照 |
| `console/server/utils/serviceClients.ts`、`serviceGrantPolicyBinding.ts`、`serviceTokenSourceBinding.ts`；`data-runtime/internal/apps/console/auth_service_tokens.go` | 保留真实边界；内部调用逐链退役 | 企业拥有全量功能不授予服务 client 全量 scopes。退役 scope 必须证明旧调用消费归零；不得批量删除以模块命名的 grant |
| `data-runtime/internal/auth/auth.go`、`auth_contract_test.go`；`internal/config/config.go` 的 `deployment-bindings.json` | 保留并扩展正式 Host 映射 | Host 到 Runtime 仍验证短期服务 Token、来源/目标、tenant、deployment、撤销和精确 capability。不得以全局 appCode 覆盖实现多模块访问 |
| `foundation/server/utils/licenseBootstrap.ts`、`platformActivationRuntime.ts`；Console legacy bootstrap | 过渡 | 存量 offline/私有部署先保留兼容；新业务模块不再以 app License 换服务身份。不能因清理商业档位删除 Console 激活与签名可信根 |

Schema 事实入口：`platform/docs/sql/HZY-Platform-SQL-DDL-Draft-v2.sql`。其中 `licenses.subscription_id` 外键指向逐应用 `subscriptions`，`license_deployments` 再指向部署；直接删除逐应用订阅既破坏历史也破坏运行引用。

## 2. 统一资格模型

新增版本化企业资格记录，建议名称 `tenant_enterprise_entitlements`，在 Platform 控制库中维护，不迁入业务库。该名称已落地于控制面迁移；2026-09-14已应用测试库，见[Platform schema执行证据](../deploy/test-env/artifacts/C000001.platform-enterprise-schema-application.json)。建表与代码发布不代表存量企业资格已转换。

最小字段：`id/tenant_code/revision/product_code/status/effective_from/effective_until/source/source_reference/migration_id/created_at`。`product_code=enterprise-full` 是统一产品技术标识，不是新商业档位。状态为 `pending/active/suspended/expired/revoked`；恢复必须引用原资格或新增明确期间，不能恢复时自动延长有效期。时间使用 UTC，期间采用 `[effective_from,effective_until)`；NULL 结束时间仅可来自已证明的无期限源约定，不能把缺失日期推断为永久。

每租户只有一个当前资格指针；历史 revision 不覆盖。迁移、续用和状态变更通过事务锁定租户当前指针并递增 revision；并发冲突返回 409，不以更新时间最近的一行偷偷胜出。企业停用优先于模块可运行状态；license 撤销/部署隔离仍独立生效。

签名 bundle 新增 `enterpriseEntitlement` 与 `moduleAvailability`，保留旧权限字段直至消费者完成版本升级：

```json
{
  "enterpriseEntitlement": {
    "schemaVersion": "enterprise-entitlement.v1",
    "revision": 1,
    "productCode": "enterprise-full",
    "status": "active",
    "effectiveFrom": "2026-09-13T00:00:00Z",
    "effectiveUntil": "2027-09-13T00:00:00Z"
  },
  "moduleAvailability": [
    { "appCode": "aims", "deploymentState": "ready", "configurationState": "ready" },
    { "appCode": "codocs", "deploymentState": "not-deployed", "configurationState": "unknown" }
  ]
}
```

示例期间不是默认服务期。tenant/environment、bundle 签名、issued/expiry/revision 继续由外层合同约束。全量模块来自已发布 manifest 的生成目录，不在权益记录里复制 app 白名单。生成目录须固定 source manifest hash/release，拒绝重复资源动作代码、缺失 manifest 和不受支持版本；构建失败不能静默丢模块。

运行资格、岗位权限、运行状态分别求值：整体资格有效 AND 当前人员满足动作及范围 AND 目标能力已就绪。模块配置开关只影响运行/导航，不改变 `product_code`。人员仍以原 grant 计算权限，新出现的模块不能自动向既有角色追加权限。

错误合同：未认证 401；整体资格无效用明确 `enterprise_entitlement_inactive`，已认证但人员缺权用 `permission_denied`（均可 403）；依赖不可用保持 503；未配置/未部署使用独立机器可读状态，UI 显示配置或部署条件。不能统一文案为“未购买/请升级”，也不能用导航隐藏替代后端拒绝。

## 3. 历史转换规则

转换输入包含：tenant 主状态、所有主订阅与逐应用订阅、订单有效期及支付事实、所有相关 License 的硬到期/grace/撤销、部署绑定与版本。只导出 ID、状态、时间、关系和必要 hash，禁止输出 `signed_token`、runtime token、client secret 或完整 License artifact。

| 输入情形 | 转换决定 |
| --- | --- |
| 唯一有效企业主合同期间明确，子记录仅是同期间展开 | 使用原企业期间，功能范围变为全量；不以迁移日重置起止时间 |
| 全部有效来源期间一致、无冲突且租户正常 | 可自动生成同期间转换候选；仍记录每条来源 ID/hash |
| 主订阅、订单或逐应用 License 有不同期间，或缺少权威企业期间 | `needs-review`，输出每条原期间及差异，不默认取最大值、最小值或最后更新时间；保留 legacy 当前路径，其他租户继续迁移 |
| 只有部分应用仍有效，另一部分已过期 | 不自行推断整体企业资格；需要有依据的统一期间决定，不能借全量功能免费续期，也不能截短已有合法期间 |
| 原企业停用、撤销或已到期 | 新记录保留对应整体无效状态；全量功能不触发恢复。部署/License 单独撤销继续有效 |
| 未支付/pending 订单或 trial | 保留真实来源、状态与原期间；不因转换创建付款事实。已有试用是否有效以原已确认政策及记录为准 |
| 无期限与有限期并存，缺少时区，非法日期或多 active 主记录 | 冲突待决；未知不等于永久、无效也不自动删除 |
| 历史已结束订阅、旧签名、付款记录 | 原样保留并关联迁移回执，不参与当前资格授权 |

当前代码的迁移禁用入口：`activateTenantPlanSubscription` 对同 plan 续用加一年，首次及部分切换加 30 天加一年；`onboardingFlow.ensureTenantSubscription` 更新现有主订阅时设置 `ended_at=NULL`。因此历史转换必须实现独立命令，不能复用这些 helper 作为“便捷开通”。新产品续用也必须从明确订单期间取得日期，而不是把迁移或状态恢复当成续期。

转换流程：只读 dry-run → 固定源快照 hash 与确定的映射 → 对无冲突记录事务 apply → 生成签名资格及兼容 bundle → 验证生效 → 切换该租户目录读路径。apply 按 `migration_id + tenant_code` 幂等，源 hash/revision 改变时返回冲突并要求重新 dry-run；事务包含新资格、当前指针与审计回执，不包含网络调用。签名输出失败时保留待发布状态，不能宣称已切换。

映射文件最小列：`tenant_code/source_ids/source_hash/source_periods/source_statuses/decision/target_status/target_from/target_until/reason/evidence_reference/expected_revision/migration_id/result_revision`。冲突解决记录依据和决定人，不在文档中虚构实际企业的数据或合同决定。

回退：切换前保留 legacy 资格路径；新资格已变更后不得恢复过时 bundle 或无视撤销。回退 UI/消费代码仍使用当前企业资格 revision，兼容输出由当前事实生成。已过期、停用、撤销状态不得因回退变有效。

## 4. P4 可执行工作包与证明标准

| 工作包 | 文件/交付物 | 验收 |
| --- | --- | --- |
| INT-401 模型与纯函数 | Platform 新增权益 schema、领域类型、期间/状态计算 helper；本合同转为最终字段定义 | 半开期间边界、时区、NULL 与未知区分、停用优先、过期与恢复不续期；当前指针并发唯一 |
| INT-402 转换 | 独立 dry-run/apply 工具与 schema migration；来源映射及审计 receipt | 等期自动、异期冲突、源漂移、重放一次生效、回滚无半写；原订单/签名/日期保持不变 |
| INT-403 Platform 接入 | `onboardingFlow.ts`、新购/续用 API、`subscriptions.ts`、`policyBundle.ts`、Console 激活兼容输出 | 新企业无需选档即全量；老企业按明确 migration 状态读取；未转换仍走旧路径；企业及部署撤销有效 |
| INT-404 消费与提示 | Console `userApplications.ts`、Foundation 授权客户端及 Host 入口 | 全量目录与人员允许目录分离；未配置、未部署、缺权、依赖失败、整体过期有独立状态；旧 UI URL 兼容 |
| INT-405 manifest 目录 | 现有 manifest importer/资源角色 helper 的构建出口、bundle schema 兼容测试 | 每个模块资源动作与源 manifest 一致；稳定代码和自定义角色不变；不使用 Host 手写全权限清单 |
| INT-406 权限回归 | 扩展已有 Platform/Console/Foundation/Authz Core/Runtime 测试 | 同一人员前后权限集合无自动扩大；新模块无授权则不可写；合并角色、模拟、scope、敏感动作、离职过期和职责冲突矩阵通过 |
| INT-407 演练 | 隔离测试租户的脱敏映射、开通/转换/停用/恢复/独立能力配置操作回执 | 新企业、旧不同档位、日期冲突、已失效/停用、未部署组件均有实际入口验证；保留签名验证及部署精确身份 |

可复用测试入口：`platform/test/policyBundleSchemaVersion.test.ts`、`policyBundleV2Compat.test.ts`、`authorizationGrants.test.ts`、`authorizationSnapshotBuilder.test.ts`；`console/test/policyAuthorizationGrantPath.test.ts`、`authorizationSimulationRestrictions.test.ts`、`subjectScopedAuthorization.test.ts`；`foundation/test/applicationAuthorization.test.ts`、`authorizationActions.test.ts`、`subjectScopedAuthorization.test.ts`；`data-runtime/internal/auth/auth_contract_test.go`。这些是已有测试入口，不代表已覆盖新增企业权益；实施后须核对新增用例覆盖再报告通过。

工作顺序：模型与转换纯逻辑可立即实施；真实租户转换依赖脱敏源清点，Host 运行身份依赖 INT-101/107 正式合同。不同工作包可以并行，但 `policyBundle.ts`、订阅 schema 和共享授权文件指定单一写入负责人。没有实际环境证据时不勾选 INT-407，也不以代码盘点替代实际有效期映射。

## 5. 首批纯逻辑实施证据

2026-09-13：`platform/server/utils/enterpriseEntitlement.ts` 已实现 `enterprise-entitlement.v1` / `enterprise-full` 类型、严格 UTC 及半开期间、显式无期限证据、状态计算、无续期恢复、迁移候选生成与来源 hash/revision 前置条件断言。`platform/test/enterpriseEntitlement.test.ts` 的 10 项测试通过，局部 ESLint 与独立 TypeScript strict 检查通过。

运行入口：`node --test --experimental-strip-types platform/test/enterpriseEntitlement.test.ts`。纯规划器输入是当前资格候选；数据库适配器必须另外保存已结束历史记录引用，不把历史旧期间当作当前冲突。整体停用状态由受信数据库映射取得，不能接受用户提交的 `tenantStatus` 或 `authoritativeEnterprisePeriod`。

恢复纯函数不写 revision，持久化状态变更命令须以 CAS 递增并记录审计。纯函数本身不提供数据库原子性或重放去重。

## 6. 持久化转换实施证据

新增独立迁移 `platform/docs/sql/migrations/20260913-enterprise-entitlements.sql`：版本化资格表、每租户当前 revision 指针、唯一 `(tenant_code,migration_id)` 的迁移回执，保留外键及期间/状态约束。不修改共享 DDL 和现有订阅/订单/License。

`platform/server/utils/enterpriseEntitlementRepository.ts` 通过现有 `db.withTransaction` 接线，默认 `dry-run`。apply 先锁租户行，再锁源记录/当前指针/回执；复核来源 hash 与 expectedRevision，同事务写入资格、指针和回执。同 ID 同请求重放原结果，异请求冲突。调用者不得将重放的历史结果作为当前资格快照，当前状态应从当前指针读取。此入口没有暴露为公开 HTTP API，未来路由必须先做 Platform 租户及操作权限校验。

来源 adapter 显式读取主/子订阅、订单、License 和部署绑定的非敏感字段；原签名、token、secret 均不查询。NULL 结束日期不推断永久。已结束记录作为历史 ID 保存；订单、License 历史事实也参与快照 hash，来源漂移必须重新预览。多份当前主订阅、日期缺失/异期、无明确证据的 License 期间差异返回待核对，不使用旧续期 helper。未提供人工冲突解决的写入口，避免客户端自称权威合同。

验证：纯逻辑和仓库适配测试共 15 项通过，局部 ESLint 通过。执行 `node --experimental-strip-types platform/scripts/test-enterprise-entitlement-mysql.mjs` 使用既有临时 MySQL harness，在随机 loopback 端口、全新 datadir、`--no-defaults` 隔离实例中验证 schema、并发同键只写一次、异 payload 拒绝、源漂移、receipt 写失败全事务回滚及旧订阅不变；执行通过并自动清理。临时库名 `hzy_console` 仅为 harness 测试容器，无业务库连接，测试凭据只在内存使用。

仍待实现：有依据的冲突解决/无期限源凭证映射、新企业开通与续用接线、签名输出及消费者切换、真实租户 dry-run/apply 和完整操作手册。这些基础设施证据不代表 INT-401/402 或 P4 全部完成，也不代表迁移已应用到测试/生产 Platform。

## 7. 管理状态命令

新增 `POST /api/platform/ops/subscriptions/enterprise/{tenantCode}/state`，请求字段限定为 `action: suspend|revoke|restore`、`operationId`、整数 `expectedRevision`、`reason`。主体来自现有 `platform-access` 中间件验证的 ops 会话，不接受 body/header 提供的 actor、租户覆盖或起止日期。中间件现有订阅 POST 权限之外，端点通过 `buildOpsAuthorizationSnapshot` 额外要求已有 `ops.subscriptions:admin`，普通 view/edit/confirm 或 tenant_admin 不可停服、撤销、恢复。不新增角色权限、不授予任何业务人员权限。

`enterpriseEntitlementState.ts` 在租户锁和当前 revision CAS 下创建新资格版本、移动当前指针、记录含 actor/reason 的状态回执；同 operationId 同请求重放，异请求返回 409。部署前需顺序应用两个独立 migration，第二个为 `20260913-enterprise-entitlement-state.sql`。暂停只允许当前 active/pending；撤销是终止状态；恢复只针对 suspended，租户自身必须 active，并保持原起止日期：原结束时间已到则恢复结果仍为 expired。恢复不更新旧订阅、不生成订单、不续期。receipt 失败回滚全部三步。

管理调用示例（仅请求形态，不表示对实际租户执行）：

```json
{ "action": "suspend", "operationId": "operator-command-unique-id", "expectedRevision": 1, "reason": "经核实暂停企业整体服务" }
```

返回 `success/data.replayed/data.entitlement`。未认证为 401；身份已验证但非 ops 或缺订阅 admin 为 403；无租户/资格为 404；CAS、幂等内容或状态不允许为 409；存储依赖失败为去敏 503。重放回执用于确认原操作，不作为实时当前资格。管理端应取得当前 revision 再发新的命令，不用重放结果覆盖当前状态。

验证：权益系列 22 项测试通过（含权限拒绝、actor/tenant/期间覆盖拒绝）；临时隔离 MySQL 扩展验证暂停/恢复/撤销、并发同键、异 payload、状态回执失败回滚、租户自身暂停禁止恢复及跨租户不写入。尚未接入 bundle 消费，因此这里的状态变更只改变 Platform 权威记录，不能宣称业务访问已即时停用；INT-403/404 必须继续完成签名资格输出、缓存及消费者执行边界。

## 8. Platform bundle 输出与传播

`enterpriseEntitlementBundle.ts` 从 current 指针关联真实版本记录，校验租户、schema/product、revision、期间；无 current 行返回 legacy，缺表、坏指针、非法记录则失败关闭。迁移后 `policyBundle.ts` 在原 `policy-bundle.v2` 签名 payload 顶层加入：

- `enterpriseEntitlement`：第 5 节实现中的原 `status`、`effectiveFrom`、判别联合 `end`、tenant/revision/schema/product，以及生成时计算的 `effectiveStatus`。消费者仍必须在每次授权时判断当前时间，不能把生成时 active 当作无限有效。
- `moduleAvailability`：`{appCode,deploymentState: deployed|not-deployed,configurationState: unknown}`。没有配置就绪事实时不推断 ready。

迁移后技术应用目录从 active 应用与 active manifest 生成，不经过逐应用订阅或商业 plan 筛选，排除 legacy Account 和独立控制面 Platform；未迁移分支保持原应用集合。原角色、主体、scope 和签名算法不变；baseline grants 与 system app-role maps 继续使用原应用集合，避免仅扩展目录就扩大自动人员授权。完整角色回归和后续退役旧集合仍属于 INT-405/406，不能仅凭目录字段输出宣称完成。

传播不依赖运营手工再签：`findOrGeneratePolicyBundleForDeployment` 在每次“最新运行 bundle”读取时比较已存 bundle 与 current 的 revision/effectiveStatus，变化时重新生成签名包，再核对生成期间有无资格变更；竞争变化返回可重试 503。指定旧 version 且资格过时返回 409，不能以固定旧版本绕过撤销。V1 latest 和 legacy bundle-meta 也使用此检查。历史下载仍是审计制品，不能替代当前运行授权来源。

代码上线前必须先应用新增 schema。企业自然到期可由消费者根据签名原期间立即判断；状态变更传播经现有 Console 同步及缓存新鲜度约束，尚不承诺瞬时撤销，离线、缓存截止和 fresh-policy 行为继续沿现有安全合同。状态命令回执表示 Platform 提交成功，不等于所有消费者已经刷新。

验证：新增 6 项 bundle 资格测试与现有 baseline/schema/v2 投影共 17 项测试通过；真实临时 MySQL 验证 current revision 由 1 到 4 的撤销输出、未转换租户 legacy、旧 qualification 不可复用；Platform typecheck 通过。签名算法及签名存储沿用现有路径，尚需联合环境对实际签名包、Console/业务授权、缓存传播延迟完成 INT-403/404/406 的端到端证明。

## 9. 隔离签名与授权链路测试

`platform/scripts/support/enterprise-policy-e2e.mjs` 已接入原临时 MySQL 脚本。使用实际 Platform `platformSigning.sign`（临时实例的 signing key 记录，临时 Ed25519 私钥只在测试进程内）、Console `fetchAndVerifyPolicyBundle`、`writeCachedBundle/readCachedBundle`、`loadPolicyAuthorizationSnapshot/hasPermissionInSnapshot` 及 Foundation `evaluatePolicyBundleScopedAuthorization`。Nuxt 测试宿主仅解析构建别名、提供配置/请求上下文及模拟 Service Binding 传输，不替代签名、验签、缓存或人员授权算法。

资格源由实际迁移/状态仓库与 current 指针读取；人员角色/范围使用固定脱敏 fixture，测试不对任意真实租户拉取权限。测试时钟推进验证 5 分钟新鲜度和结束时刻，不等待真实时间。所有连接来自全新 harness 实例，不接受 ambient 数据库 URL；结束后关闭实际 Platform pool、清理私钥变量、恢复宿主环境并销毁实例。

覆盖：有效全量企业仍只具有明确 view，不能 edit、读取其他部门或写财务；暂停→刷新拒绝、恢复原结束日不变、撤销拒绝、自然到期拒绝；错租户包、篡改签名拒绝；当前 revision 更新后旧缓存触发真实刷新、更低 revision 晚到写入拒绝。依赖失败用精确 503 断言，不能以任意拒绝代替不可用语义。

2026-09-13 最终执行：`node --experimental-strip-types platform/scripts/test-enterprise-entitlement-mysql.mjs` 返回 0，真实签名链路及原 MySQL 状态/并发/回滚测试全部通过；3 个测试脚本 ESLint 通过。严格 outage 断言曾发现 Console 把过期缓存刷新失败返回 403，消费者 agent 已修复为缺包/过期/依赖刷新失败 503，真实企业无效仍 403；修复后重跑上述整个隔离命令通过。临时实例自动清理。

此隔离测试不代表 Cloudflare 实网部署、真实岗位全集或真实租户转换验收；Platform catalog/角色输入使用固定 fixture，不声明覆盖所有实际 manifest 组合。跨进程重启的长期 revision 水位及持久缓存回放仍需单独演练。

## 10. 已确认新购/续用订单接线

`enterpriseOrderFulfillment.ts` 与独立 `20260913-enterprise-order-fulfillments.sql` 为新购/续用提供单独履约链路，不复用历史转换 migration receipt。权威输入是锁定的 `platform_orders`：`plan_code=enterprise-full`、`status=paid`、明确 UTC `effective_from/effective_until`，以及同租户/币种的 succeeded 付款事实；金额覆盖使用数据库 DECIMAL 比较。缺期间、负/未知订单金额、缺付款/不足额、其他产品、现存 legacy 资格尚未转换均拒绝，不把未确定期限解释为永久。

幂等单位是 `(tenant_code,order_id)`，source hash 包含批准订单期间/金额/状态及付款证据。重复同订单返回原回执；已履约后的源变化待核对。事务锁租户→订单/付款→资格指针，生成一个新资格 revision 与履约审计回执，不更新旧订阅、License 或既有订单期间。尚有效且连续/重叠的续用合并覆盖区间，结束点严格取新订单批准日期；不加试用期或自然年，不补空档，不缩短已有覆盖。原资格已到期时按新订单原期间开通，不填过去空档。暂停/撤销保持，付费不会自动恢复；人员角色/范围不修改。

已接入管理路径：

- 原 `POST /api/platform/ops/subscriptions/orders/{orderNo}/confirm` 对统一产品订单使用新分支：保留已批准金额和期间，记录银行到账并同事务履约；失败时付款记录/paid 状态/资格均回滚，重复确认只重放。原 legacy 订单维持既有兼容行为。
- 新 `POST /api/platform/ops/subscriptions/orders/{orderNo}/enterprise-fulfillment` 为已有 paid 订单触发/恢复履约，沿用 ops 会话并显式要求 `ops.subscriptions:admin`。从数据库取租户/订单、从会话取 actor，不接受请求重写期间。
- 原自助 `subscription-plans/subscribe` 对统一产品拒绝旧自动期限算法。`startOnboarding` 已新增第 11 节统一技术分支；统一报价/批准订单创建 UI 尚待接线。

验证：4 项期间单元测试通过；`node --experimental-strip-types platform/scripts/test-enterprise-entitlement-mysql.mjs --orders-only` 在专属临时 MySQL 验证新购精确期间、并发重放一次、暂停中续用不恢复、确认到账不改合同日期/金额、缺日期/不足付款/来源漂移拒绝、履约回执故障时整单事务回滚，执行通过。该命令仍运行原资格/状态持久化测试，但不重复签名/Console 持久后端测试；默认命令继续包含跨边界签名及新订单测试。无真实订单动作。


## 11. INT-403 统一技术开通分支（2026-09-13）

`enterpriseProvisioning.ts` 接入既有 `startOnboarding(planCode=enterprise-full)`。只接受已经存在、企业状态 active、current 指针对应有效资格的企业；资格可来自已确认订单或已批准历史转换。开通不创建商业订单、不更改付款、不触发旧计划激活器。技术订阅期间及新 Console License 结束时间严格取资格记录，无输入期限覆盖、默认加年或清空结束时间。

- active 主订阅及 console/enterprise 技术订阅存在时借用且不更新原日期；缺失时追加 `source=enterprise_technical` 记录。只创建 console 和 enterprise 两个物理部署，沿现有站点路由规则，不把逻辑模块伪造成独立服务。
- Host active composition、内嵌 manifest 哈希、每个逻辑应用 active/latest snapshot 及实际 resource/action 登记必须一致；缺失立即回滚，不能把空 Host resources 当成全量权限已注册。保持逻辑应用旧 release 绑定，不自动复制人员角色或 scope。
- 新 Console License 使用现有 Platform Ed25519 签名及 Vault 指纹规范，以企业 revision 为幂等身份追加；重试复用相同 token。旧 License、绑定、订阅、订单及付款保留。资格新 revision 需要新的 License 时也追加，不覆盖旧 token。
- `issueInitialRuntimeToken` 在租户锁下只首次生成凭据。重试不旋转 hash，不恢复已撤销或过期凭据；已存在的明文不可恢复，因此重复响应 runtimeToken=null，env 保留占位符。统一 finalize 禁止用 onboarding 的 rotate 开关绕过专门凭据管理。
- 暂停/撤销/到期、停用的租户或已有 deployment/License/runtime credential 均不由开通恢复。统一 finalize 不把企业状态写回 active；恢复操作仍走带 CAS 和审计的企业状态命令，不延长资格。

验证入口 `platform/scripts/support/enterprise-provisioning-e2e.mjs` 已接入完整临时 MySQL harness。真实调用 startOnboarding、DB 事务、Platform 签名与凭据实现，验证签名及精确截止、两物理部署、重复调用无重复 License/无凭据轮换、旧 License 不变、暂停拒绝、恢复新增 License 保留原结束日、撤销 License/凭据不被恢复、缺逻辑 action 整体回滚。新表结构从项目 DDL 提取到专属临时库，移除 fixture 外键仅因早期转换 fixture 的 ID 类型简化；生产 DDL 未变，实际业务数据库未连接或写入。

未完成边界：统一报价及有权威期间的订单创建 UI；Host 实际业务 API 全量迁移与环境验收（目录映射见第 12 节）；新环境实际 Worker/Runtime/SSO 交付、subject 同步和管理员授权。当前 fixture 关闭自动 bundle 生成以隔离开通测试，签名 bundle→Console/Runtime 的独立真实链路由第 9 节覆盖；不能据此宣称新企业实际环境全流程已经交付或将 INT-403/407 整项勾选。


## 12. Host 逻辑模块的签名入口映射（2026-09-13）

`enterpriseModuleRoutes.ts` 的真实 DB 查询使用租户/环境隔离，要求 enterprise deployment active、未被 License 状态停用、同租户/同环境 active 站点且 root_app_code=enterprise、base_path=/。必须具有 `reported_manifest_hash` 且与当前已登记 Host snapshot 哈希精确相同；注册完成但未报告运行身份时不推断部署就绪。再复用 `enterpriseCompositionModules` 验证组合目录与哈希、核对 Aims/Assets active/latest snapshot 和实际 resource/action 登记，任一漂移整组不映射。

签名输出新增 `enterpriseHostRoutes`（logical appCode、enterprise hostAppCode、物理 deploymentId/code、Host/模块 manifestHash、basePath、apiBase、homeUrl）。仅映射 aims/assets，保留 `/aims/`、`/assets/`；Host 的实际 BFF API 前缀分别为 `/aims/api/v1`、`/assets/api/v1`，不沿用旧独立 app manifest 的默认 `/api/v1/aims` 元数据。URL 经现有 Platform appUrls 的 HTTP(S)/basePath 规范化，并拒绝带 userinfo URL。回调/退出 URL 从相同可信入口派生，不接受独立应用旧外部 homeUrl 覆盖 Host 地址。

`policyBundle.ts` 将这些路由应用于 signed applications，并以真实 Host 路由补充 moduleAvailability。不会新增逻辑 deployment 行或 subscription，不改变 appCode/resource/action/role/scope。latest bundle 复用还比较当前 Host 路由事实；运行报告、站点、清单或状态改变时重签，新包生成后再次核对，竞争变化返回503。企业未迁移分支保留旧目录；已有独立逻辑部署按原路径正常工作。

Console 原有 `getConsoleUserApplications` 直接消费已验签 applications 与 moduleAvailability，无需另一套路由算法。仍经 Foundation 的 allowedAppCodes 和对象 scope 判断，无 grant 的 Assets 即使 Host 具备路径也不出现在该用户目录。未部署映射 homeUrl=null；configurationState仍unknown。Foundation managed 服务调用仍使用既有租户网关及可信路径记录，不将 UI homeUrl 当成 Runtime Service Binding 授权；Host 保留实际业务 readiness middleware，未迁移接口503，映射目录不意味着所有业务 API 已实现。

真实隔离 MySQL harness 覆盖 Platform 实际路由查询/映射→真实 Ed25519 签名→Console 验签/Runtime 持久缓存→getConsoleUserApplications→Foundation scope 判定。验证已报告匹配 Host 显示 Aims，缺报告/错hash/逻辑catalog漂移/Host停用关闭入口、错租户或环境不能借用Host、非法URL不映射，且无逻辑deployment行、无Assets授权、无跨部门或edit扩大。测试发现并修复同一毫秒更高 signed policyRevision 被 syncedAt 平局吞掉的问题：持久缓存和内存只在平局且策略未推进时保留旧记录，原降级拒绝规则不变。该测试调用生产路由 producer，未宣称整个 buildPolicyBundlePayload 的全部目录查询在该最小fixture中执行。

## 13. 统一下单与权威期间 UI：实施依据

1. `dashboard/subscription-plans.vue` 改为单一 enterprise-full 产品展示；显示当前资格、精确服务期间及待付款订单，移除版本选择和自动加年。普通企业所有者只能选择已经由运营批准的报价/期间，不能在浏览器提交任意已付金额或服务结束日。
2. 新增运营报价/订单创建 API 与 `admin/orders.vue` 表单：仅 ops.subscriptions:admin；请求包含 tenant、requestId、批准依据 reference、精确 UTC effectiveFrom/effectiveUntil、十进制定价及currency。服务端检查严格期间、金额、租户、权威来源，租户锁+幂等receipt同事务创建 pending enterprise-full order。不可借修改既有订单续期，不将页面手动日期本身当作已批准合同。
3. 企业确认/付款只绑定该不可变批准订单；现有 confirm 处理真实成功付款后写资格，页面显示实际 entitlement revision/result及 suspended/revoked，不能把“到账”统一显示为“已恢复”。首次技术开通调用已实现 startOnboarding 分支，重复交付显示凭据不可重显而非旋转。
4. 最小验收：无订单权限403、tenant伪造拒绝、请求幂等/异payload409、缺权威期间拒绝、部分付款不生效、已暂停续用不恢复、历史订单不可覆盖；临时 MySQL 覆盖创建→确认→资格→技术开通，浏览器验证单一产品/期间/待支付/已停用文案。实际收款、合同批准和环境发布不在fixture验收中执行。

本工作包已冻结为“具 ops.subscriptions:admin 的运营明确提交即批准”，不新增多级审批或 CRM 子系统。批准动作记录不可变依据与操作者，普通企业不能提交自己的金额/期间。实现及证据见第 14 节；未自动创建真实商业合同。


## 14. 统一报价创建→企业确认→付款→技术开通（2026-09-13）

新增 `20260913-enterprise-order-approvals.sql`，启用页面/API前须应用。`enterprise_order_approvals` 保存 tenant/requestId 唯一幂等身份、orderId、请求hash、批准reference、approvedByUid及完整 approved_json；`enterprise_order_acceptances` 以 orderId 保存企业所有者确认及批准hash。创建 pending enterprise-full 订单与批准记录同事务；批准记录无更新API，改价/改期间须建立新的批准订单。日期严格UTC、秒精度、半开期间，SQL DATETIME不能保留的非零毫秒直接拒绝；金额使用精确十进制字符串，不经过浮点数决定支付充分性。

- `POST /api/platform/ops/subscriptions/orders/approved` 使用真实现有 ops RBAC，并额外要求 `ops.subscriptions:admin`。只接受 tenantCode/requestId/approvalReference/effectiveFrom/effectiveUntil/amount/currency；actor取已认证上下文，body不能覆盖。运营 UI 明示“创建即批准报价”，记录后企业再确认。
- `GET /api/platform/tenant-admin/enterprise-orders` 按认证tenant返回当前资格与已批准订单，报价金额/期间从不可变 approved_json展示；未转换企业显示历史服务待统一，不冒称旧资格已失效。
- `POST /api/platform/tenant-admin/enterprise-orders/accept` 仅企业所有者，body只含orderNo；验证同tenant订单及批准事实。不能自填金额/期间、不能把确认报价当成已付。重复确认复用原receipt。
- 对新增批准订单，现有实际到账确认及 fulfill 都检查批准hash、原订单金额/期间一致及企业确认receipt；未确认、源漂移均拒绝。历史已确认订单无新增批准记录时保持原合同。统一到账API同样要求 subscription admin。
- `dashboard/subscription-plans.vue` 改为单一全量产品、资格状态和批准报价列表。没有不同档位选择、默认+年或可修改金额/服务期间的企业表单。已暂停企业确认/续用后仍明确显示暂停。
- `admin/orders.vue` 提供批准表单、企业未确认时禁用到账按钮、已付统一订单“技术开通”入口。旧 `/admin/onboarding` 已废弃且重定向，未恢复该旧入口；新增 `/admin/enterprise-provisioning` 直接调用统一 start API，只输入tenant/environment，沿用已登记站点及资格期间，不允许覆盖日期。统一 start 增加 subscription admin校验；材料可由运营主动下载，重复运行凭据不能重新显示明文。

真实验证：完整 `test-enterprise-entitlement-mysql.mjs` 在专属临时 MySQL 中调用实际 H3 approved/accept handlers、真实 ops RBAC与测试角色表；覆盖非ops/无admin/非owner拒绝、企业body改价400、错tenant拒绝、并发创建一次、异payload409、未企业确认不能确认付款、完整创建→确认→付款→资格→真实startOnboarding、批准receipt失败回滚订单、收费源漂移拒绝、暂停企业通过新批准订单续用仍suspended。旧订阅/付款及签名/路由边界测试继续通过。

Chrome 使用临时 Nuxt UI 预览加载实际 Vue页面/组件源码（仅HTTP数据函数替换为固定fixture，未连接任何业务环境）：验证倒置UTC期间提示错误；正确报价提交后弹出“报价已批准，等待企业确认”；订单等待企业确认时到账按钮禁用；企业确认后显示“待确认到账”且原“已暂停”不变。技术开通页验证独立入口与前置条件/主体同步提示。预览为解决本机 pnpm 多版本Vue解析使用临时alias，不修改项目依赖。浏览器证据和真实后端fixture分开，不冒称SSO或实际收款/实际Worker发布已执行。

剩余交付边界：部署新增migration与代码、真实运营批准合同/实际收款、企业环境站点与Runtime配置、主体同步、实际业务链路验收。软件接口和UI已提供明确路径；本轮没有执行任何真实订单、收费、商业批准或环境发布。
