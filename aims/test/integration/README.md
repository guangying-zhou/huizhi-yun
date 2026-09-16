# 产品中心集成检查

## 版本范围页浏览器回归

`product_scope_browser.cjs` 使用真实 `features.vue` 页面和模拟接口，在 1440/390 视口检查不完整成功回执被拒绝、同键重试、公开设置保存、父页刷新、编辑权限撤销及独立交付权限保留。它不证明真实租户授权或跨应用传输。

前置条件：本地隔离 Nuxt 预览已启动，挂载仓库的 `/products/[productCode]/versions/[versionId]/features.vue`、产品组件及 Foundation composable；预览无需登录，也不连接业务服务。需要已安装的 Playwright 与 Chrome。脚本只接受 loopback URL，并拦截未声明的 `/api/` 请求。

```sh
HZY_PRODUCT_UI_PREVIEW_URL=http://127.0.0.1:3317 \
HZY_PLAYWRIGHT_MODULE=/absolute/path/to/node_modules/playwright \
node aims/test/integration/product_scope_browser.cjs
```

如 Node 可直接解析 Playwright，可省略 `HZY_PLAYWRIGHT_MODULE`。该检查需要浏览器和预览服务，未放入普通 Node 单元测试命令。

## 项目版本页关联回归

`project_release_browser.cjs` 使用同一隔离预览与 Playwright 参数，要求 `/projects/[id]/releases` 挂载实际仓库页面，预览提供 projectStore 的 42 号 product_dev 项目。验证已发布隐藏关联、开发中选择工作项、服务失败保留输入及重试，1440/390 视口。API 全部模拟，不能证明真实会话授权或 Shell 深链。执行：`node aims/test/integration/project_release_browser.cjs`。

`product_queue_keyboard_browser.cjs` uses the actual `/products/P1/cycles/C1/items/I1/move` page and Foundation confirmation dialog in the same isolated Nuxt preview. Expose actual product components, utilities (including productQueueReceipt), types and Foundation composables without writing through source symlinks. The script mocks all product API responses and aborts other API calls. With Chrome/Playwright and `/tmp/hzy-product-browser-qa` available, run using the same `HZY_PLAYWRIGHT_MODULE` and `HZY_PRODUCT_UI_PREVIEW_URL` environment variables as the release check. It uses Tab/Enter/text typing only to select a target, preview, confirm, recover from a 503 and retry with the same payload/key at 1440/390 widths. The fixture now has 11 items: it selects the second-page target, returns to the first page and verifies the submitted anchor remains that target. It does not prove live JWT or publication keyboard acceptance.

`product_publish_keyboard_browser.cjs` mounts actual `ProductsVersionPublisher` at `/qa-publisher`, with props `product-code="P1"`, `version-id="9"`, and record `{id:7,version_id:9,scope_revision:3,accepted_by:'owner',exceptions:[]}`. Use the same isolated UApp/actual product components/Foundation composables setup. The preview fixture is test-only and intentionally contains only fields the publisher consumes. The script mocks permissions, acceptance-preview and publish responses, verifies full keyboard entry/check/confirmation at 1440/390, injected 503 recovery and stable payload/idempotency key. It does not create a real release or validate parent acceptance-detail loading or real user permissions.

`product_roadmap_keyboard_browser.cjs` exercises actual `/products/P1/planning-items/I1/roadmap` with the same isolated preview. It starts with September dates, clears them by keyboard, supplies a reason, confirms, receives injected 503, checks the accessible error and retries with unchanged payload/key. It checks empty date fields after successful refresh at 1440/390. All API responses are mocked; it does not prove live permission or database writes, nor date-entry keyboard behavior.

## 产品工作台三视角浏览器回归

`product_workspace_browser.cjs` 使用仓库实际的 `products/[productCode].vue` 外壳、`ProductsNavbar`、产品概览页与设置页，在同一隔离 Nuxt 预览中检查一级工作视角页签、二级入口、「更多」下拉、跨视角 `view` 参数保持来源视角高亮、产品切换器搜索与切换、设置页承接产品信息／归档／成员、需求管理内的建设范围与优先级入口、从单条需求创建范围时的来源与 revision 传递，并在 1440 / 390 视口断言无横向溢出与无 pageerror。全部 `/api/v1` 响应由脚本模拟，未声明的接口一律 abort；它不证明真实 Console 会话、租户授权或后端契约。

预览需要挂载仓库实际页面与组件，且不能出现两份 Vue：

- `extends` 指向仓库 `foundation/`，`dir.pages` 指向 `aims/app/pages`，`components` / `imports.dirs` 指向 `aims/app` 下的组件、composables、utils、stores，`alias` 的 `~` / `@` 指向 `aims/app`。
- 预览自带 `app/composables/useRouteAccess.ts` 空实现关闭路由守卫（预览没有 Console 会话），并自带 CSS 入口 `@import "tailwindcss"; @import "@nuxt/ui";` 加 `@source` 指向 `aims/app` 与 `foundation/app`，否则只被这两个目录使用的工具类（例如 `lg:grid-cols-4`）不会生成，截图不能反映真实布局。
- 若预览复用应用的 `node_modules`，需要 `vite.resolve.dedupe` 与 `vite.resolve.alias.vue` 固定单一 Vue 版本，否则渲染会以 `Cannot read properties of null (reading 'ce')` 失败。

```sh
HZY_PRODUCT_UI_PREVIEW_URL=http://localhost:3317 \
HZY_PLAYWRIGHT_MODULE=/absolute/path/to/node_modules/playwright \
node aims/test/integration/product_workspace_browser.cjs
```

截图默认写入 `/tmp/hzy-product-browser-qa`，可用 `HZY_PRODUCT_UI_SCREENSHOT_DIR` 覆盖。
