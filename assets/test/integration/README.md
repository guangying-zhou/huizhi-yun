# 产品台账浏览器回归

`product_list_browser.cjs` 在 1440/390 Chrome 上验证实际 ProductAssetsListPage 组件的翻页、搜索重置页码、503 错误提示及保留条件重试。所有 API 被拦截，未登记路径中止；这不是实际租户授权验收。

前置：启动隔离的 Nuxt UI 预览，`/asset-list` 渲染仓库中的 `assets/app/components/assets/ProductAssetsListPage.vue`，使用 Foundation composables、产品工具函数和 SummaryMetricGrid。预览可提供空字典和原值 label adapter，外层提供 UApp/UDashboardGroup。不得使用业务环境运行此脚本。

```sh
HZY_PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
HZY_PRODUCT_UI_PREVIEW_URL=http://127.0.0.1:3317 \
node assets/test/integration/product_list_browser.cjs
```

Playwright 模块和 Chrome 必须已可用；脚本不安装依赖、不启动服务、不改业务数据。创建弹窗、详情深链及真实应用 Shell 不在本脚本范围。
