# Enterprise Host

项目文档页复用 Aims 原页面；`other-documents` multipart 上传限 10 MiB，通过签名 `upload-file` 命令转交 Aims 共享编排。测试 Host 增加 Aims/Codocs Service Binding；服务调用不经过公网自等待。正文/附件/权限完整浏览器验收状态见测试部署记录。

ADR-018 最小企业宿主，物理身份固定 enterprise，业务前缀 /aims、/assets；当前显式组合产品中心和产品台账列表；C000001 测试环境已接入正式 Enterprise 运行身份并切换统一库 generation=1；业务验收与剩余迁移范围见根测试部署记录。Foundation 是唯一 extends。项目执行约定见根 CLAUDE.md。

## Codocs 迁移顺序

按用户决定，第一批将整个 `mydocs` 页面树及其当前可达动作一并迁移，个人文档先行、部门文档随后；日志/个人周报主入口迁至工作台→我的工作→工作汇报，`mydocs` 仅保留指向同一页面的兼容入口，不做两套实现；演示、收藏/最近、文件柜、共享移交/发布/盖章等不作为后置范围。团队汇报后续部门批次，项目周报后续项目管理；旧 Codocs 项目文档不迁入，数据保留并由后续项目管理承接。目前仅安排/盘点，个人或部门文档页尚未注册。迁移保留 Host 唯一会话和显式页面/API 注册，不带入 Codocs 全局插件；编辑器与 Collab 仍保持现有运行边界。菜单、数据、Runtime 及编辑器归属不因本计划改变。

- 业务组合入口为 aims/layer/entry.mjs、assets/layer/entry.mjs，显式 pages 注册；禁止 extends 完整独立应用 nuxt.config。
- app.vue、全局布局、登录、中间件只由 Host 注册一次。业务 API 就绪边界由 `server/routes` 的实际路由文件派生，不再手工维护第二份放行清单：新增或删除路由后运行 `pnpm --dir enterprise generate:api-readiness`，`test/business-api-readiness.test.mjs` 会在清单漂移时失败。就绪只回答“Host 是否提供该 METHOD + 路径”，人员业务授权仍由 handler 判断，已就绪接口返回 401/403/400 属正常。未注册路径继续按 `enterprise_module_runtime_not_ready` 拒绝；实际支持范围见 `docs/API_SPEC.md` 和根 `docs/Unified-Enterprise-Product-Page-API-Readiness.md`，后台任务尚未迁入。C000001 测试环境已完成 INT-107 身份绑定；其他环境未完成绑定前不得借旧应用身份发布。
- 本地 `pnpm --dir enterprise typecheck`、`test`；Cloudflare `verify:cloudflare` 仅构建及 dry-run，不含 deploy。
- 默认不配 Console URL、客户端 secret、Service Binding、cron 或业务权限；无配置时显示真实登录不可用。运行身份配置不能用客户端请求 Header 覆盖。
- 浏览器验收和真实身份接线完成前，不把占位路由视为 INT-303/304 或业务整合完成。

## 整合分支新增候选

Codocs 个人文档读写、软删除/恢复与文件柜读取已开始以 Host → Runtime 固定用户域命令接线，原 Codocs DB/OSS 保持；个人柜 read/export 使用独立 capability，列表真实分页、转存信息重验目标 ACL、Office 预览隔离不可信 HTML。以上均为未启用环境的候选，mydocs 页面尚未注册，文件柜写链和完整动作尚未完成；以根 MODULE_CONTRACTS、INT-606 增量记录为准，不把路由就绪视为整个整合完成。

工作项完成审批/回调/人工 replay、IP 资产 list/detail/create/edit 的本地合同与隔离测试已实现，接口与未启用项见 `docs/API_SPEC.md` 及根 `docs/MODULE_CONTRACTS.md`。候选代码、schema 或 grants 不表示当前环境已部署；后台投递与环境授权必须分别核验，不能借 Host 身份绕过目标 Service API 或入站验签。
