# Finance isolated browser checks

`allocation_currency_browser.cjs` checks the actual FinanceEntityFormSlideover and allocation page config at 1440/390 widths. It covers an initially empty currency, preserving input on an injected validation failure, correction and submitted values. Submission is stubbed: this is not a real Finance route, JWT, database or server error-message test.

Mount `fixtures/allocation-form.vue` as `/qa-finance-allocation` in an isolated Nuxt preview with @nuxt/ui and a UApp root. When copying the fixture into a preview, resolve its two relative imports to the repository's actual files; do not write through source directory symlinks. Use the existing application CSS. API requests are aborted by the browser script.

Run with a loopback-only preview URL and installed Playwright/Chrome:

```sh
HZY_PRODUCT_UI_PREVIEW_URL=http://127.0.0.1:3317 HZY_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node finance/test/integration/allocation_currency_browser.cjs
```

Create `/tmp/hzy-product-browser-qa` before running; screenshots are written there. The script closes its browser but does not start or stop the preview server.
