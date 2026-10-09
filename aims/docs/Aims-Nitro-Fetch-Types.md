# Aims Nitro 请求类型修复

日期：2026-09-12。状态：已修复，Aims 全量类型检查通过。无运行时代码、接口或数据库变更。

## 问题与原因

Aims 的 `nuxt typecheck` 在普通 `$fetch<T>(url, options)` 调用处报告 TS2589，并连带产生 TS2345。逐个指定第二个泛型参数只会让首个报错位置转移到其他页面。

本地最小复现保留 Nitro 2.13.4 的请求／路由匹配类型，把所有返回类型简化后仍失败；删除轻量计划的路由也仍失败。原因是默认 `NitroFetchRequest` 包含所有路由键，通用泛型约束触发大量路由匹配计算。Nitro 的[上游问题 #4476](https://github.com/nitrojs/nitro/issues/4476)报告了同类问题并提出显式启用简化请求类型的方案；本仓库使用针对当前版本的本地补丁，不假定该方案已在安装版本中提供。

## 修复范围与取舍

- [pnpm 补丁](../../patches/nitropack@2.13.4.patch)只修改依赖的 `dist/types/index.d.ts`，新增可扩展的 `NitroFetchConfig`；只有 `flatRequest: true` 时将请求约束简化为 ofetch 原有的 `FetchRequest`。
- [Aims 类型声明](../shared/types/nitro-fetch.d.ts)通过 `nitropack/types` 显式启用，在 Aims 的 app、server、shared 类型上下文生效。其他应用没有此声明，保留原有行为。
- [工作区配置](../../pnpm-workspace.yaml)与 [lockfile](../../pnpm-lock.yaml)记录补丁及其 hash，安装时自动应用。没有升级 Nitro 或其他依赖，也不修改生成的 `.nuxt` 文件。
- 取舍是通用请求地址不再提供完整路由键联合的自动补全。具体 URL 仍匹配对应接口，推导返回结构并限制 HTTP 方法；显式响应类型、动态地址、`Request` 对象、`raw`、`create` 和 `event.$fetch` 继续可用。
- 没有使用 `any` 替换响应，没有关闭类型检查、删除路由类型或在业务文件中添加错误忽略。验收后已撤回此前逐页尝试的类型修改。

## 验证

使用 Node 24.18.0：

```sh
pnpm --dir aims typecheck
pnpm --dir aims exec eslint shared/types/nitro-fetch.d.ts test/nitroFetchTypes.test.ts
node --test --experimental-strip-types aims/test/nitroFetchTypes.test.ts
pnpm install --frozen-lockfile --ignore-scripts --offline
```

以上均通过。[类型回归测试](../test/nitroFetchTypes.test.ts)使用实际安装的 Nitro 类型和 TypeScript 编译器，覆盖 600 条附加路由下的类型推导、固定／参数／通配／默认处理器、错误方法拒绝、错误字段拒绝、显式泛型、动态未知响应及派生客户端；另在未启用配置的独立编译上下文验证默认契约。测试中的 `@ts-expect-error` 只用于断言非法调用必须被编译器拒绝，类型保护丢失时测试会失败。

第一阶段的 22 项相关 Node 回归重新运行通过。此前真实 MySQL 和桌面／手机浏览器证据继续有效，本补丁不改变运行时行为。记录位于 `/tmp/hzy-phase1-qa-20260912`：`typecheck-nitro-fix.log`、`nitro-fetch-types.log`、`lint-nitro-fix.log`、`node-after-nitro-fix.log`、`nitro-patch-install.log`。

## 后续维护

升级 Nitro 时核对上游是否已有等效修复，移除本补丁和 Aims 声明后运行类型回归及全量类型检查；两者通过再删除临时兼容措施。不得将类型检查通过等同于目标环境部署或认证链路验收。
