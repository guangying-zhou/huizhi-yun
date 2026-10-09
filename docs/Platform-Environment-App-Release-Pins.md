# Platform 按环境固定应用版本

状态：已实现候选，未部署 Platform、未执行生产 DDL/初始化、未签 prod 包。用户于 2026-10-07 选择按环境 pin；适用于 manifest/权限目录，不负责切换应用二进制。

## 1. 使用流程

在「租户」详情的「环境应用版本」中选择 prod/test/dev。

1. 已有 prod 从已签基线包初始化。C000001 的现场记录为 bundle 40、revision 39、hash `sha256_f63ae58aec660f29a7e14fb7f4a86d0b7899249790a05afe87d61fbeebbf7c47`，来源见 [生产迁移记录](Go-Live-APF-Migration-Collab-Runbook.md)。界面和服务端不把这些值写死为通用租户默认值。
2. 「只读预览差异」从基线包中的实际 manifest ID 反查 released release。缺失、多义、跨应用、无效状态或摘要不符均停止，不猜版本。首次保存仅允许精确初始化全部有目录的应用，不能顺便升级。
3. 确认完整差异和来源摘要，填写理由，保存选择。保存不物化全局角色，不签包，不改 test。
4. 再单独选择 Console 的公告 release，本次现场目标为 `console/v0.2.5`（release 48、manifest 65）。其余应用保留原 pin。预览全部字段；APF 目录/推荐角色/权限/范围应无增删，其余非目标变化也须说明。
5. 保存后另行批准 prod 签包。既有签包入口使用同一环境解析器；签名前再次核对选择修订及实际解析 release 未变，漂移返回 409。

test/dev 无选择集时保持既有行为；建立选择集后，每应用可选固定 release 或 latest（按 released_at、id 降序解析 released + active manifest）。prod 无选择集时禁止签新包，仍可正常读取/续租既有已签包。首次开通、没有历史包的 prod 可显式选择应用后初始化。

旧包对 Enterprise 等无资源目录的路由应用可能没有 manifest ID；本次保留其路由元数据，不伪造历史 release。它们不会贡献人员权限目录。后续可显式登记 release pin。若有资源目录的应用缺少历史 release，先修复可验证的 release 台账，再初始化。

## 2. 数据与权限

| 表 | 作用 |
| --- | --- |
| tenant_environment_app_release_sets | tenant/environment 唯一，选择 revision、初始化来源包及 hash、操作者 |
| tenant_environment_app_releases | tenant/environment/app 唯一；release_id 非空为 pin，NULL 为 latest |
| platform_environment_app_release_audits | 同事务保存旧/新选择、actor UID、理由、review hash；最近 20 项在管理页显示 |

表之间及与 release/bundle 台账使用受控逻辑引用；写入与解析验证 app/tenant/environment 归属，不新增跨域数据库 FK。迁移脚本为 [候选 DDL](../platform/docs/sql/HZY-Platform-SQL-Migration-environment-app-release-pins.sql)，必须先于新 Platform 代码安装。缺表不静默降级。还依赖 `platform_app_role_scopes.source_type`；现场先核查，缺失时另批执行既有 [范围来源候选迁移](../platform/docs/sql/HZY-Platform-SQL-Migration-finance-manifest-default-scopes-candidate.sql)，只增加来源列、既有行标记 manual，不发布 APF manifest 或新增 APF 授权。缺列返回 503，不把全局最新默认范围当人工授权。

管理接口仅在 `/api/platform/ops/tenants/:tenantCode/app-releases`：

| 方法/路径 | 权限 | 行为 |
| --- | --- | --- |
| GET | ops.deployments:view | 选择、可用 release、审计；不可用 pin 仍可查看和修复 |
| POST /preview | ops.deployments:view | 内存候选与完整差异、reviewHash；零业务写入/零签名 |
| PUT | ops.deployments:deploy | expectedRevision + reviewHash + reason；重新预览、事务 CAS、保存与审计 |
| 既有 POST /bundles | ops.deployments:deploy | 依环境选择集解析并签包，独立于保存 |

预览/保存请求：`environment` 必填；`expectedRevision` 为当前 revision（首次 0）；`pins` 为 `{appCode, releaseId}` 数组；首次从历史初始化可仅填 `sourceBundleId`。保存另需 `reviewHash` 和 1–500 字理由。应用重复、非整数 ID、未知字段返回 400；跨环境/来源不符、release 不可用、并发变化返回 409。入站 actor 从已鉴权 Platform 会话获取，不接受浏览器指定身份。

## 3. 策略构建规则

资源、动作、action implications 和推荐角色权限均从选定 release 的同一 manifest 解析；复用现有 recommendedRoles/defaultScopes 解析器。不能使用被 latest 发布覆盖的全局推荐权限物化表作为 pin 的权限来源。已管理环境签包跳过全局 inherited role 物化，以当前有效租户 `roleAppRoleMaps` 为准，在内存中按所选应用角色目录求交集并编译权限。全局 `systemAppRoleMaps` 仅保留模板事实，不覆盖租户映射；当前空映射也不能从模板或历史包恢复。

范围有独立来源：manifest_default 只从所选 manifest 的 defaultScopes 编译；manual 范围及其停用状态继续读取当前人工治理事实，且必须匹配选定 manifest 的有效动作。人工同元组优先，包括 inactive 行对默认范围的否决。旧 manifest 未声明 defaultScopes 时，不从最新 manifest 推断或补全；保留有效人工范围，不凭权限推导 tenant:global。

版本选择必须在当前租户的有效应用目录内，不能借 pin 扩张产品资格。历史包用于 release 来源证明和未变版本的角色元数据，不恢复人员角色分配、人工范围、租户自定义授权或基线授权。当前人工授权若已变化，预览会如实列出，不能以 pin 为由掩盖或恢复。有效 baseline 只与选定动作交集，不从 manifest 自动授予员工新权限。超出所选目录的自定义权限/范围不会签入，差异中可见删除。

签包正文新增 appReleaseSelection（选择 revision、来源 bundle/hash、每应用选择模式与解析出的 release/manifest/hash）。实际签包前持锁重读选择，防止预览期间 pin 或 latest 指向变化。所有字段参与政策事实 hash，环境 revision 仍使用既有双键机制。

## 4. 差异与上线门禁

预览使用签包的 payload builder，排除 generatedAt/policyRevision 造成的时钟噪音，数组按语义排序；完整呈现资源、动作、推荐角色权限/范围、permissionGrants、scopeGrants、assignment、模板、路由与其他正文变化，不只显示新增动作数。预览本身不调用 generatePolicyBundle/sign，不推进任何策略修订，不写角色或选择审计。

本地单测使用合成的历史/最新 release，并复用无人员信息的 prod39 APF 技术切片（Altoc manifest 27、29 动作；Finance manifest 24、34 动作；People manifest 35、39 动作）。该切片不包含完整已签包或 release-ID 台账映射，测试重建的角色解析输入不作为生产 release 证据。测试验证三域 pin + Console 公告升级经过 v2 授权编译不带入 future APF 动作。MySQL 测试在临时 socket/隔离库验证 DDL 重跑、历史反查、读零写、CAS/审计与失败边界。2026-10-08 已使用受保护 prod39 正文、release/资源动作台账及当前治理投影完成离线复算；冻结治理事实时 177 条授权与 76 条范围仅来源编号变化，真实变化为 0。当前治理复算另列主体停用、任职及角色范围变化。私有正文不进入仓库，离线模拟 ID/hash 不能代替现场初始化预览。

待批顺序：Platform 三表 DDL → 部署候选 → 只读预览 prod39 精确初始化 → 批准保存初始化 → Console 单应用升级预览/保存 → 确认 APF 全字段零增删及所有非目标差异 → 单独批准 prod 签包。test 不随 prod 操作变更；不为本批重签 test。

回退先停止新签包，再回退 Platform 代码；保留 pin/audit 与历史包。不能将删除 pin 当回滚，否则可能重新启用全局 latest。应用包回退不撤回已经交付的策略，应通过明确的后续策略变更完成。

## 5. 历史迁移基线 release

当历史已签包所用 manifest 没有唯一真实 released 记录时，可按批准的迁移计划登记 `release_kind=baseline/status=baseline`。基线保持原 manifest ID/hash，`source_tag` 为空，commit、registration、released_at 为 NULL；不代表 Git 发布，不修改原 draft，不更新全局 latest 或物化角色。People/Workflow 等有唯一真实 release 的应用复用原记录。

来源固定为 tenant、environment、bundle ID/hash、manifest ID/hash 六元组。只能在绑定同一原始包的环境选择中显式 pin；跨租户、跨环境、摘要漂移或缺来源返回 409。普通发布和 Git 导入均拒绝修改基线；数据库 CHECK 禁止将 baseline 状态改为 released 或伪造 Git 来源。latest 仍只解析正常 released，基线不会被 test 或全局 latest 自动选择。管理页以「迁移基线」标识。

安装 [基线迁移 DDL](../platform/docs/sql/HZY-Platform-SQL-Migration-migration-baseline-releases.sql) 后，授权运维人员使用以下工具（不读取默认环境文件、不签包、不保存 pin）：

```sh
# private-db.json 必须为 0600，由运维安全提供；不要把凭据放入命令行。
node --experimental-strip-types platform/scripts/migration-baseline-releases.ts plan \
  --db-config /private/private-db.json --tenant C000001 --environment prod \
  --bundle 40 --output /private/baseline-plan.json
# 单独批准实际 plan 的 reviewHash 后执行；输出路径必须尚不存在。
node --experimental-strip-types platform/scripts/migration-baseline-releases.ts apply \
  --db-config /private/private-db.json --tenant C000001 --environment prod \
  --bundle 40 --review-hash <已审阅hash> --actor <运维UID> --reason <批准依据> \
  --output /private/baseline-receipt.json
```

工具在同一事务锁定租户与来源、重算 reviewHash、登记缺失基线并记录 `platform_migration_baseline_audits`。确定性版本及唯一键保证重放不新增 release，重放审计保留第一次成功操作者。plan/apply 摘要不依赖新分配的 baseline ID；已复用 release 的 ID 参与摘要。提交回执丢失时先重新 plan，再幂等重放。

受保护的 prod39 导出可用 `platform/scripts/preview-migration-baselines-offline.ts <快照目录> <新报告路径>` 离线验证文件 SHA、正文规范摘要，模拟登记并生成完整候选。工具只在内存生成候选，报告只含计数、摘要及技术授权元组，不输出正文、不连接数据库、不签名。当前 DB 角色/范围投影不作为历史事实。离线 reviewHash 标记为 `offline-frozen-prod39`，包含模拟 ID；**不能用于生产保存批准**。实际登记后必须由生产只读预览重新生成差异与 reviewHash。

基线登记仅补 release 台账，不保证已有 pin 编译器对历史正文自动零差异。历史映射、授权来源 ID 或人工治理有漂移时，必须保留差异并停止生产初始化；不能忽略字段或恢复旧授权来伪造零差异。生产 DDL、部署、登记、保存 pin 和签包分别待批，由现场运维执行。

## 6. 路线 A：双层差异审阅

预览响应新增 `review`：`equivalent` 为同一动作与授权上下文的编号等价对，`real` 为其余真实差异，`provenance` 为版本选择来源。等价识别要求两侧均存在 owning 动作或资源、角色/来源/范围/状态等其他字段完全一致，授权 `grantId` 符合既有确定性算法；允许旧范围的空来源 ID 补成有效编号。范围扩大、角色或来源类型变化、动作缺失、未知字段变化不按等价处理。此分类是逐项诊断，不声称整包行为不变。

`real.origin=governance` 表示当前主体、有效分配、租户映射及不由选定 manifest 改变的人工授权事实；界面显示「治理事实变化（非本次版本选择引入）」。其他项标为发布影响或待审变化。Insights 的有效租户映射及授权继续保留；验收角色 132/133 不自动停用，相关范围必须单独审阅。

完整 `diff` 不删字段、不归零；`reviewHash` 同时覆盖完整 diff、分类、选择和候选事实摘要。保存接口只接受服务端重算的审阅证据，将 `diff/review/sensitiveConfigurationChanged` 写入既有审计 JSON 的 `reviewEvidence`；无新 DDL。等价项仍可展开查看前后值，保存选择不等于批准真实授权变化或签包。

离线工具可附加 `--route-a`：仅在冻结历史治理的真实差异为 0 时成功退出，同时完整保留编号 diff。默认模式仍要求完整 diff 为 0。若提供 manifest 声明并通过 SHA 核验的当前治理和基线快照，还生成固定历史 pin、单独升级 Console、相对原包的分阶段比较。治理 DATETIME 必须是 `dateStrings:true` 的原始 DB 字符串；拒绝 ISO 自动换算。

当前基线权限是全租户、prod/test/dev 共享的治理配置，编译时取 active 行并与选定应用及动作求交集，既有包不追改。Console v0.2.5 的员工公告/反馈权限必须有这类显式基线配置，不能仅凭 manifest 新动作推导。离线投影未覆盖当前完整目录关系、模板及运行配置，所有生产保存和签包均需重新进行真实只读预览。
