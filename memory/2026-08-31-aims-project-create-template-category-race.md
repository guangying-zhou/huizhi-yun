# DEBUG REPORT — Aims 交付实施项目创建返回 400

日期：2026-08-31
入口：`POST /aims/api/v1/projects`

## Symptom

- 用户在 Aims 创建“交付实施”项目时收到 HTTP 400。
- 前端 `handleSubmit()` 未捕获创建异常，浏览器只显示未处理的 `FetchError`，没有展示
  tenant-runtime 返回的稳定业务错误。

## Root cause

项目创建页会按项目类别异步加载模板列表和模板详情，但原实现没有请求代际或类别绑定：

1. 页面初始加载 `product_dev` 模板；
2. 用户切换到 `delivery` 后又发起新的模板请求；
3. 较旧的列表或详情响应可以晚于新请求返回并覆盖当前选择；
4. 提交逻辑直接发送 `selectedTemplateVersionId`，不核对模板类别；
5. data-runtime 在 `projectTemplateVersionByIDTx()` 中发现模板类别与项目类别不同，按契约返回
   `400 project_template_category_mismatch`。

项目集选择还可能在同一事件循环内把有效类别强制为 `product_dev`，因此提交校验必须使用项目集
规则计算后的有效类别，不能只读取表单字段。

## Fix

- 为模板列表和详情请求分别增加单调 request ID，类别变化时使全部旧请求失效。
- 每次类别变化先清空旧模板状态，只接受与当前有效类别、当前选中 ID 一致的已发布模板。
- 用 `effectiveProjectCategory` 同时驱动模板加载、提交 payload 和提交前校验，覆盖产品线项目集规则。
- 模板未就绪或类别不匹配时禁用创建按钮，并在提交入口再次失败关闭。
- 捕获创建失败，优先显示 Nitro / tenant-runtime 响应中的业务消息，不再产生未处理 Promise。

## Evidence

- 新回归测试在修复前 3/3 失败，证明原页面缺少旧请求失效、模板类别校验和异常反馈。
- 修复后聚焦回归 3/3 通过。
- Aims 全量测试 271/271 通过。
- Aims lint、Nuxt typecheck、`git diff --check` 通过。
- 回归测试同时锁定 data-runtime 的精确 `400 project_template_category_mismatch` 合同。

## Regression test

- `aims/test/projectCreateTemplateRace.test.ts`

## Related

- 竞态自 2026-04 的项目模板选择实现起存在；近期改动未改变该页面逻辑。
- 本次不修改 data-runtime：服务端拒绝跨类别模板是正确的失败关闭边界。

## Status

DONE_WITH_CONCERNS：代码根因已修复且自动化验证通过；本地浏览器因 Console OIDC 服务未启动而
无法进入登录后的创建页，未执行生产项目创建或生产部署，因此仍需在部署后用真实登录会话完成
一次“交付实施”项目创建 E2E。
