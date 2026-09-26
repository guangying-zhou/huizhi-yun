# Enterprise Host

## 当前状态（2026-09-20）

当前策略只读候选：导航可通过 `HZY_ENTERPRISE_VERIFIED_POLICY_ENABLED` 显式开启
新回执 gate，默认关闭；服务端配置 issuer/kid/publicKey/environment，Host 绑定
来自受信 Gateway，读取保留 enterprise 身份、精确 policy read grant。版本失配
拒绝，既有 Console 权限判定保留。这不是 Console 协议/权限算法迁移完成，
2026-09-21 已在 hzy0 显式启用并验证登录/导航/文档列表；其他环境默认关闭，证据与剩余项见策略验证合同 §12。

2026-09-21 Console 组合准备：先收口策略验证合同，暂不注册 Console 协议模块。
宿主侧策略验证归 Enterprise 内 Console 模块，权威 Auth/秘密仍归 Runtime；
不能复制 Gateway HMAC key、借同进程继承全部 Console 身份或信任未验证版本。
原本地门面 HMAC 不匹配已由完整签名策略链解决，核查与现场切换证据见
`../docs/Console-Enterprise-Policy-Verification-Contract.md`。

9 个非演示 mydocs 页面及工作汇报兼容入口已显式注册，并有非页面回归；不是仍待首次注册。环境全链、真实 DB/OSS/编辑器及业务验收尚未完成。当前主线为 Host 基线收口与试点交付准备，唯一进度见根 `docs/Unified-Enterprise-Implementation-Plan.md` §3.1 / INT-606。下文“目前仅安排”“尚未注册”“新增候选”保留历史实施上下文，不作为当前完成结论。

发布清单必须锁定 Console、Gateway 源码及其外部导入的生成路由/拓扑文件；旧 Shell 普通点击迁移依赖 Console + Gateway，不能只部署 Host。源描述符、构建制品、环境回读和业务验收是不同证据；脏工作区不能生成固定发布候选。

ADR-019 导航引用各领域 manifest 的人员资源/动作，不能引用 Runtime 服务 capability 充当人员权限。`GET /enterprise/api/navigation` 在受信 Enterprise 会话/部署与 Runtime 配置下，通过 Foundation 分别读取逻辑模块权限，只返回可见节点 ID；后台业务 handler 仍承担最终对象/字段授权。导航元数据在构建期校验，修改后运行 `generate:navigation`；浏览器与 Worker 只消费无文件系统依赖的生成值。旧 Shell 的测试兼容映射另由 `deploy/test-env/generate-enterprise-host-routes.mjs` 生成并做漂移检查。ADR-019 总验收状态仍在统一实施计划，不以本地回归替代真实角色/业务链验收。

项目文档页复用 Aims 原页面；`other-documents` multipart 上传限 10 MiB，通过签名 `upload-file` 命令转交 Aims 共享编排。测试 Host 增加 Aims/Codocs Service Binding；服务调用不经过公网自等待。正文/附件/权限完整浏览器验收状态见测试部署记录。

ADR-018 企业宿主，物理身份固定 enterprise，业务前缀包含 /aims、/assets、/codocs；当前 Aims/Assets 显式组合产品链，Codocs 按 INT-606 渐进注册页面与 API。自有完整文档页已作为 Host 原生路由候选接入；本地独立编辑器和 Collab 仍保留兼容/服务运行边界，不是长期双前端目标。共享协作通道、版本及写入恢复仍须分别验收，不能由页面可见推断闭环。C000001 测试环境已接入正式 Enterprise 运行身份并切换统一库 generation=1；Codocs 尚未据此宣称环境启用。业务验收与剩余迁移范围见根测试部署记录。Foundation 是唯一 extends。项目执行约定见根 CLAUDE.md。

## Codocs 迁移顺序

按用户决定，第一批将除演示文稿外的 `mydocs` 页面树及其当前可达动作一并迁移，个人文档先行、部门文档随后；日志/个人周报主入口迁至工作台→我的工作→工作汇报，`mydocs` 仅保留指向同一页面的兼容入口，不做两套实现；收藏/最近、文件柜、共享移交/发布/盖章等不作为后置范围。用户最新决定将 `mydocs/slides.vue` 与演示专用 API/编辑预览导出后续迁移，本轮仅记录、不作为完成门槛；文件柜 PPT/PPTX 既有能力仍在首批。团队汇报后续部门批次，项目周报后续项目管理；旧 Codocs 项目文档不迁入，数据保留并由后续项目管理承接。目前仅安排/盘点，个人或部门文档页尚未注册。迁移保留 Host 唯一会话和显式页面/API 注册，不带入 Codocs 全局插件；编辑器与 Collab 仍保持现有运行边界。菜单、数据、Runtime 及编辑器归属不因本计划改变。

- 业务组合入口为 aims/layer/entry.mjs、assets/layer/entry.mjs、codocs/layer/entry.mjs，显式 pages 注册；禁止 extends 完整独立应用 nuxt.config。
- app.vue、全局布局、登录、中间件只由 Host 注册一次。业务 API 就绪边界由 `server/routes` 的实际路由文件派生，不再手工维护第二份放行清单：新增或删除路由后运行 `pnpm --dir enterprise generate:api-readiness`，`test/business-api-readiness.test.mjs` 会在清单漂移时失败。就绪只回答“Host 是否提供该 METHOD + 路径”，人员业务授权仍由 handler 判断，已就绪接口返回 401/403/400 属正常。未注册路径继续按 `enterprise_module_runtime_not_ready` 拒绝；实际支持范围见 `docs/API_SPEC.md` 和根 `docs/Unified-Enterprise-Product-Page-API-Readiness.md`，后台任务尚未迁入。C000001 测试环境已完成 INT-107 身份绑定；其他环境未完成绑定前不得借旧应用身份发布。
- 本地 `pnpm --dir enterprise typecheck`、`test`；Cloudflare `verify:cloudflare` 仅构建及 dry-run，不含 deploy。
- 默认不配 Console URL、客户端 secret、Service Binding、cron 或业务权限；无配置时显示真实登录不可用。运行身份配置不能用客户端请求 Header 覆盖。
- 浏览器验收和真实身份接线完成前，不把占位路由视为 INT-303/304 或业务整合完成。

## 整合分支新增候选

个人柜转文档已补 Host `/{uuid}/to-document` → Runtime `conversion-plan`/`convert`：documents:view/create 双权限、精确 personal-cabinet:create，先条件存储，再新鲜授权与原 DB Serializable 事务创建文档/owner relation/关联。失败重试同 key、不覆盖后续编辑或重置关联；下列早期“转文档未完成”更新为候选已接线。目录选择已接真实分页；完整页面组合、环境授权和真实 DB/OSS/Worker 验证仍待完成，不代表整个整合已交付。

个人柜上传候选已补 `personal-cabinet:{upload-plan|upload}`/精确 create；Host 只读计划后条件存储，再重新授权提交 Runtime 元数据事务。沿用原 DB/OSS，使用新上传专属稳定 UUID/摘要路径；失败重试、不覆盖既有对象、不复活删除文件。环境启用与转文档链路仍未完成。

个人柜 DELETE 候选已补精确 `codocs:personal-cabinet:delete`，当前 documents:delete、owner 范围与事务幂等回执；保留原 OSS 对象和转换目标，失败重试沿用 key。该项不代表上传/转换、环境 grants 或页面组合完成。

Codocs 个人文档读写、软删除/恢复与文件柜读取已开始以 Host → Runtime 固定用户域命令接线，原 Codocs DB/OSS 保持；个人柜 read/export 使用独立 capability，列表真实分页、转存信息重验目标 ACL、Office 预览隔离不可信 HTML。以上均为未启用环境的候选，mydocs 页面尚未注册，文件柜写链和完整动作尚未完成；以根 MODULE_CONTRACTS、INT-606 增量记录为准，不把路由就绪视为整个整合完成。

工作项完成审批/回调/人工 replay、IP 资产 list/detail/create/edit 的本地合同与隔离测试已实现，接口与未启用项见 `docs/API_SPEC.md` 及根 `docs/MODULE_CONTRACTS.md`。候选代码、schema 或 grants 不表示当前环境已部署；后台投递与环境授权必须分别核验，不能借 Host 身份绕过目标 Service API 或入站验签。
