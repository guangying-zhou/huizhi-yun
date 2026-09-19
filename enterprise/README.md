# 企业统一宿主

ADR-018 / INT-301 的最小 Host，复用 Foundation。物理身份 `enterprise`，根 base URL `/`；`/aims`、`/assets` 为明确标识尚未启用的业务入口；`/aims/products`、`/assets/products` 已显式挂载原产品中心/台账源码。旧模块 login URL 保留别名。

## 开发与验证

```sh
pnpm --dir enterprise dev
pnpm --dir enterprise test
pnpm --dir enterprise typecheck
pnpm --dir enterprise verify:cloudflare
```

`verify:cloudflare` 只做配置生成、构建和 Wrangler dry-run，无发布命令。模板默认无公网入口、cron、隐含生产服务绑定或权限。实际登录需设置 HZY_CONSOLE_URL，并完成 Console enterprise OIDC 客户端/回调注册；业务 Runtime 身份仍依赖 INT-107。业务页没有 mock API 或 auth bypass。

## 组合约束

`composition/registry.mjs` 显式读取 Aims/Assets 的 `layer/entry.mjs` 描述；页面前缀与 route name 判重，拒绝无命名空间和冲突。描述入口不会自动注册业务 handler、middleware、plugin 或 task。当前 INT-302 已挂载两产品列表及依赖组件，原源码使用显式模块 URL helper 保持独立启动兼容；业务 BFF 尚未迁入，前缀 API 明确返回 503。

页面、BFF、调度和 Runtime 接入分别验收。首屏能构建不能证明统一业务链路或单消费者迁移完成。未来移入页面先改显式模块别名与 API 路径，不允许 extends 整个 aims/assets 应用。

## Host 会话与缓存

`enterprise-session.client.ts` 复用 Foundation `useAuth`，通过真实 `/api/auth/me` 响应形成 tenant、uid/subject、policyVersion、deployment 作用域。完整身份缺失时不沿用旧缓存。每次受保护导航、浏览器重新聚焦及认证 Cookie/Token 变化触发服务端重验；同一批消费者共用一个在途请求。Cookie 仅用于触发失效，不作为缓存身份事实源。

产品列表和 Assets 字典缓存 key 带 `hzy:enterprise:<verified-scope>:<module>:`；身份或策略变化清除该前缀缓存并重挂当前页面。退出先失效，再走 Foundation 服务端 logout。失效后的旧异步会话响应不能重新激活旧身份。独立 Aims/Assets 保持原 key 和 URL 行为。

旧 `/aims/login`、`/assets/login` 是统一登录页 alias，return 参数只允许站内路径，拒绝协议相对 URL、反斜杠、编码控制字符及登录自身循环。服务端 Foundation OIDC 仍负责最终 redirect 和会话验证，客户端过滤不是认证边界。

这些改动及单元测试不替代真实 OIDC 登录/退出、双租户浏览器切换和线上撤销验收。Foundation 共享权限缓存仍须按其自身会话规则运行；本段只覆盖已挂载产品页面使用的模块数据缓存，后续页面接入必须使用相同模块 cacheKey。

## 技术 manifest 与发布输入

`node enterprise/scripts/generate-manifest.mjs` 从 Aims/Assets 原 manifest 生成 `enterprise/app.manifest.json`；`--check` 拒绝陈旧生成物。composition 内保留完整原 manifest、逻辑 appCode、原资源/角色/动作及目录 SHA256，重复资源/动作、跨模块角色引用和未定义权限会被拒绝。顶层 enterprise resources/recommendedRoles 为空，不把业务权限改名成 enterprise。

**Platform 兼容边界**：当前 `appManifestResources.ts` 把资源绑定到注册 appCode，`appManifestPermission.ts` 拒绝角色权限的 appCode 不一致。因此该 composition 技术制品尚不能当作普通单应用 manifest 注册完整业务权限；必须由后续正式组合注册能力按原逻辑模块展开。仅注册顶层空资源不能宣称 Aims/Assets 权限已导入。

发布制品命令：

```sh
node enterprise/scripts/generate-release-manifest.mjs <build-input.json> <release-manifest.json>
```

build-input 必须提供 `hostTag`、`runtime.version/artifactPath`、`schema.version/manifestPath`、`paths.registryVersion/registryPath/generation`、`tasks.ownershipGeneration`。三个 Path 指向真实本地构件，CLI 计算 SHA256；若同时提供 hash 且不匹配则拒绝。CLI 从 Git 读取 Host/Aims/Assets 的实际 HEAD 与目录 tree，拒绝这些目录未提交的改动，校验生成 app manifest 未陈旧，并写真实生成时间。不接受 unknown/pending/latest 等占位版本，不默认填路径或消费权 generation。

构件 version 和 generation 必须来自对应 Runtime/schema/路径及任务登记的正式构建输入，不能凭数字自行推测。CLI 验证本地构件和源码关联，不声称远程环境已经运行该版本。当前工作树未提交且缺完整部署输入，因此未生成或发布正式 release manifest；后续必须补全真实输入再生成。
