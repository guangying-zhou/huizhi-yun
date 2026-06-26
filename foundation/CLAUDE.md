# Foundation 共享层

> 平台基础设施 — `@hzy/foundation` Nuxt Layer | 无独立端口
>
> 完整能力清单按需查 [`docs/FOUNDATION_CAPABILITIES.md`](../docs/FOUNDATION_CAPABILITIES.md)。新增或修改 Foundation 能力后同步更新该文档。

## 职责边界

**负责**：统一认证（Console OIDC / auth-runtime，legacy CAS + 企业微信 OAuth 仅作迁移期 fallback）、Console Directory API 封装、Workflow API 代理、Git integration runtime service、权限检查、共享 UI、头像解析、心跳检测、前端 RUM、tenant-runtime/data-runtime 代理 helper。

**不负责**：业务逻辑、业务对象数据库访问、Platform 控制面治理、Codocs Milkdown/Yjs 编辑器实现。

## 使用方式

业务模块在 `nuxt.config.ts` 中 extends Foundation：

```ts
export default defineNuxtConfig({
  extends: ['../foundation']
})
```

## 能力索引

简单局部改动不需要预读完整能力清单。涉及以下内容时再查 `docs/FOUNDATION_CAPABILITIES.md` 或源码：

- Composables：认证、目录、权限、Workflow、头像、应用信息、页面标题/动作、心跳、Dashboard。
- Components：布局、用户菜单、应用启动器、部门/用户/Git 群组选择器、Workflow 面板/时间线/状态、Codocs iframe 封装。
- Server API：`/api/workflow-proxy/**`、`/api/directory/**`、迁移期 Account 兼容入口、Git integration facade、平台激活诊断兼容入口。
- Server utils：Console runtime、Directory、OIDC、service token、integration config/vault adapter、Git/AI/WeCom/OSS integration、tenant runtime client/proxy、app URL、API alias proxy、cookie options、Workflow action sync。
- Stores/types：Directory/Account 兼容 store，以及需要在业务模块重导出的共享类型。

## 开发注意

- Nuxt Layer 的类型不能被子模块直接 auto-import。业务模块需要在本地 `app/types/*.ts` 重导出 Foundation 类型。
- 模块本地文件会覆盖 Layer 同名文件；只在确有模块差异时使用覆盖。
- Codocs 编辑器保持 iframe，不要尝试将 Milkdown/Yjs 编辑器移入 Foundation。
- 目录数据优先通过 `/api/directory/**` 和 Console Directory Runtime 读取；旧 `useAccount*` / `useAccountStore` 只作为兼容命名保留。
- 新平台授权、bundle、deployment heartbeat 等能力只由 Console 对接 Platform；业务应用通过 `platformBundleAuthorization.ts` 调 Console runtime 获取普通权限快照和 scoped authorization，不得读取本地 policy bundle 或恢复业务侧 fallback。
- 业务模块不得直接读取 `integration_credentials` 或调用 Console vault resolve；必须通过 Foundation integration adapter 按 `integrationCode` 消费。
- `tenantRuntimeClient.ts` / `tenantRuntimeProxy.ts` 是 tenant-runtime/data-runtime 代理主路径 helper；迁入 ADR-016 阶段 2 的业务模块不得恢复本地 DB fallback。
