# ADR-018 统一企业资格消费

Console 只消费已由 Platform 验签的策略包。顶层缺少 enterpriseEntitlement 时保持 legacy 行为；字段存在而 schema、tenant、revision、UTC 时间或 unlimited 证据非法时失败关闭，不回退 legacy。

普通权限 loadPolicyAuthorizationSnapshot 在租户/部署验证后、snapshotCache 命中前检查企业 status/effectiveStatus 及当前时间的 `[effectiveFrom,effectiveUntil)`。共享 scoped authorization 仍通过该入口，再执行原角色合并、模拟、动作蕴含与对象范围算法；企业全量资格不生成或扩大个人 grant。Console 此前没有独立逐应用购买判断，继续使用既有人员 allowedAppCodes；全量目录由 Platform 签名 payload 提供。

目录的企业模式不再被旧 runtime application API 列表覆盖。moduleAvailability 缺失、重复或非 deployed 时返回 `deploymentState=not-deployed`、`configurationState=unknown`、`availabilityReason=未部署`、homeUrl=null；不产生升级购买提示，也不推测外部配置已就绪。缺读取权限的模块仍不出现在该主体目录。

失效传播：已缓存资格的时间到期每次权限请求重验，snapshot TTL 不能延长有效期。管理员停用、撤销或revision变化尚未进入缓存前，消费者最多使用最近签名同步后5分钟的企业包；超过该期限必须刷新，刷新失败则失败关闭。该5分钟与当前POLICY_MAX_AGE_MS一致，不能把memory TTL误称实时撤销。新的包hash改变后旧snapshot不再命中。撤销包即使被缓存也在下一次权限检查拒绝。

验证：enterpriseEntitlement测试覆盖legacy、两租户错配、有限/无限期限、停用、撤销、effective tenant状态、非法输入与未部署；同时运行现有policyAuthorizationGrantPath、V2Projection和ConsolePolicyConsumption回归，保留角色来源、显式敏感动作及共享scoped入口。

剩余控制点：真实Platform签名/缓存刷新/停用端到端验收、持久层同步调度可用性、Gateway/OIDC/Runtime各独立请求边界的统一资格消费、前端目录对新availability字段的呈现。Console改动不能替代这些边界的授权，也不能据局部测试勾选完整INT-406。

## 联合验收前消费者审查修复

直接 `readCachedBundle` 的 enterprise memory/file 分支已同样执行5分钟新鲜度检查，不能通过跳过上层 snapshot 入口获得过旧包。内存仍有同scope当前包时，写入拒绝更低 enterprise revision、更早同步时间、跨tenant及退回legacy，防止并行旧响应覆盖新包；这不是跨重启的持久单调revision水位。持久层继续使用其正式CAS时间顺序，长期防旧包重放还需Platform当前revision校验及正式Runtime持久水位联调证据。

角色持有人服务投影已额外检查企业有效状态。应用runtime配置读取仍属于恢复/基础配置通道，未在此改为企业停用时全局关闭；业务授权端点仍执行统一企业资格门禁。真实签名→缓存→人员scope联合harness由Platform权益工作包维护。

联合真实签名测试发现并修复：企业策略缓存超过新鲜度且Platform返回503时，旧实现把缺包/不可刷新误报403。当前缺包、过期、依赖刷新失败及激活准备未完成返回503；已验证包明确inactive或企业资格无效保持403。资格检查在tenant/deployment绑定验证后、激活就绪判断前执行，避免把真实资格拒绝覆盖成依赖错误。

## 持久 revision 水位

Runtime 后端的 `persistentPolicyBundle.storePolicyBundle` 现在复用原 `policy/v1/<scope-hash>.json` 封存记录作为水位，不增加本地、浏览器或未签名表。每轮ETag/CAS都先验证旧记录HMAC，读取其中已验签的企业revision和Platform DB产生的policyRevision，即使旧记录超过读取TTL也不能丢弃水位。

新企业revision或policyRevision倒退、退回legacy、tenant不一致均拒绝。同企业revision的原始资格内容（排除派生effectiveStatus）必须一致；同policyRevision的完整策略事实（排除重签generatedAt及policyRevision本身）必须一致。自然到期或tenant停用可在同企业revision下改变effectiveStatus，但必须由Platform产生更高policyRevision；不是用签名外的同步时间或客户端时钟当授权序列。

HMAC失败不再允许自动覆盖旧记录，以免密钥轮换洗掉防重放水位。轮换须另行用旧key验证现有封存记录，再按受控过程重封；未提供此过程时失败关闭。legacy正常读写、TTL、同步顺序及CAS不变。

单元/存储契约测试覆盖TTL过期后的新client读写、旧企业和策略revision、同revision资格/内容冲突、CAS竞争后重校验、tenant隔离及错误key不能清空水位。enterprise资格缓存已强制Runtime持久后端；memory/file模式遇到enterprise包返回503（enterprise_policy_persistence_required），legacy正常缓存行为保留。必须配置Runtime持久能力后才能启用统一资格。

真实MySQL联合harness已切Runtime持久模式，并复用实际Foundation createConsolePolicyStore工厂生成scope/幂等/CAS参数。临时MySQL transport fixture保存原封存记录；新建Node子进程从该DB读取原row、无任何Console内存缓存，成功拒绝旧revision。真实Platform签名的同企业revision资格冲突与同policyRevision事实冲突也被拒绝。该证据覆盖Console重启及持久防重放，不把MySQL transport fixture称作真实Runtime HTTP endpoint；后者由独立Go HTTP/MySQL测试覆盖。


真实 Runtime HTTP 补充：`node data-runtime/scripts/test-enterprise-policy-store-mysql.mjs` 已通过隔离 MySQL 与 Go race 检查。测试经 TCP HTTP、真实 Ed25519 JWT、当前 credential/grant 和原 adapter，覆盖 ETag 冲突不覆写、租户/部署隔离、关闭 Server/连接池后重建的持久性及撤销。测试发现政策存储路径将验证依赖故障返回 500，现已修为脱敏 `503 console_policy_state_unavailable`，保留明确 401/403。该验证仍不表示目标环境已配置或切换。
