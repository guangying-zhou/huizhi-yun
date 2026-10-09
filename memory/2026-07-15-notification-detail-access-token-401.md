# 通知中心消息详情弹窗与通知详情 401 排障报告

## Symptom

- 通知中心列表和汇总可以正常读取。
- 点击 Console 发布的通知时，业务应用调用继承的未版本化
  `/api/notifications/{id}/detail`，请求在 Console 自代理链路返回 401。
- 修复旧 action URL 后，点击通知仍会切换到 Console 统一消息页，打断当前业务应用的使用上下文。

## Root cause

Foundation 通知抽屉把“打开通知”与“执行通知动作”合并成了同一步：

1. 点击时先由当前业务应用读取通知详情。
2. 详情返回 action URL 后立即跳转到来源页面。
3. Console 自身通过未版本化继承路由访问详情时形成 Console 自代理，用户会话无法稳定穿透该链路，最终返回 401。
4. 即使授权成功，消息阅读仍然要求切换应用，通知抽屉无法在当前页面承载完整消息内容。

Cloudflare 生产 tail 的直接证据为：

`GET /api/notifications/notif_.../detail -> 401`

列表与汇总接口在同一会话中均返回 200，说明问题集中在详情自代理和导航设计，而不是通知列表授权。

## Fix

- Foundation 通知抽屉新增统一消息详情弹窗，点击消息后直接在当前应用上层展示标题、摘要、完整正文、来源应用、业务类型、时间和消息编号，不再切换到 Console。
- Console 中的弹窗直接调用原生版本化接口
  `/api/v1/console/notifications/{id}/detail` 和 `/read`，绕开未版本化 Console 自代理。
- 业务应用中的弹窗继续调用 Foundation BFF 路由
  `/api/notifications/{id}/detail` 和 `/read`，由当前应用完成来源授权代理。
- 弹窗实时读取当前用户授权；403、404 和暂不可用均有明确失败状态。
- 详情加载成功后标记已读，并在通知列表中立即更新状态。
- 通知动作与阅读解耦：只有授权详情返回可用 action URL 时才显示“前往处理”，用户先阅读，再自行决定是否跳转。
- 只有点击“前往处理”才会关闭弹窗和通知抽屉并导航到业务目标。
- Console 新增面向所有已登录用户的完整消息中心 `/notifications`，并在工作台菜单提供“消息中心”入口；该入口及其详情深链始终使用工作台布局，不进入 Console 管理区，也不依赖管理员资源权限。
- `/notifications/{notificationId}` 与消息中心共用同一页面能力，外部企业微信、钉钉或邮件深链在登录后直接选中目标消息，不再跳转通知运行时配置页。
- 桌面端采用消息列表与详情双栏布局；移动端采用列表、详情分层布局，并提供“返回消息列表”。
- 通知 ID 经过长度、控制字符、斜杠和反斜杠校验，并在构造 URL 时编码。
- 消息正文按纯文本显示，不解释为 HTML 或 Markdown。

## Evidence

- Foundation 聚焦测试、typecheck 和相关 ESLint 通过。
- Foundation 全量测试通过。
- Console 全量测试：340 项，339 通过、1 跳过、0 失败；lint 和 typecheck 通过。
- Console 统一消息中心生产 Worker：`cbed1755-a03c-4902-a0aa-30e21df18964`。
- 共享通知抽屉已随以下生产 Worker 发布：
  - Aims：`b83db039-42b9-478e-9d96-a5a458208d8d`
  - Assets：`5c1453d9-8645-4548-8e75-cf5cb98f54e3`
  - Codocs：`f8324530-9627-4057-b1e2-20b3b7dc65ca`
  - People：`93f5583b-6e91-461c-8c3b-d3170428b0aa`
  - Finance：`acaa7e6f-e8f2-4d7d-a764-76ef52d51652`
  - Workflow：`e5cde0fe-e1d0-456b-8f04-2b2e5dd567b8`
  - Altoc：`4e37dae0-984e-4b0b-afeb-145d736265bd`
- WebDev 按当前约定未部署。
- 已登录应用内浏览器从 Console 和 Assets 通知抽屉分别点击 `07/15 03:42` 系统通知，均在原页面打开“消息详情”弹窗。
- Assets URL 保持 `https://wiztek.huizhi.yun/assets/overview`；Console URL 保持 `https://wiztek.huizhi.yun/notification-runtime`。
- 生产弹窗正确显示“企业微信测试消息发送成功”、完整消息内容和“前往处理”，浏览器控制台无错误。
- 1440×900 桌面验收：弹窗宽 768px，完整位于视口内，无横向溢出。
- 390×844 移动验收：弹窗左右各保留 16px，宽 358px，“关闭”和“前往处理”均完整可见，无横向溢出。
- 统一消息中心 1440×900 桌面验收：菜单入口、20 条首屏消息、列表/详情双栏、未读计数、完整正文和“前往处理”均正常；直接刷新企业微信深链仍能选中同一消息，页面无横向溢出，控制台无错误。
- 统一消息中心 390×844 移动验收：深链仅显示消息详情并提供“返回消息列表”，返回后仅显示消息列表；两种状态均无横向溢出，控制台无错误。
- 工作台路由验收：`/notifications` 与 `/notifications/{notificationId}` 均保持工作台侧栏；Console 应用入口不记录消息中心为后台最近路由，仍指向 `/admin`。

## Regression tests

- `foundation/test/notificationActionUrl.test.ts`
- `foundation/test/notificationsProxyContract.test.ts`
- `console/test/notificationDetailPageContract.test.ts`

## Status

`DONE`：通知中心消息详情弹窗、统一消息中心、外部深链自动选中、自动化验证、Console 与业务应用生产部署及桌面/移动真实点击验收均已完成。
