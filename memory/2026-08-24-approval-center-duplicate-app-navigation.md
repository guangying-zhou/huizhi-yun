# 审批中心进入业务详情后应用菜单重复

- 日期：2026-08-24
- 状态：DONE（本地修复与验证完成；2026-08-26 完成生产发布与浏览器终验）
- 复现场景：AIMS `/approval/tasks` 点击项目立项待办 `WF202608240001`

## 现象

企业 Shell 已经在最左侧渲染一套应用导航；从审批中心点击项目立项待办后，业务详情
iframe 又渲染了一套相同的 AppRail，页面出现两列“工作台/文档/项目/经营/HR/资产/财务/流程”等入口。
外层地址仍停留在 `/aims/approval/tasks`，内层已经进入项目 257 设置页的审批模式。

## 根因

Foundation 审批中心把 Workflow `biz_url` 的同源绝对地址统一交给
`navigateTo(target, { external: true })`。该调用在企业 Shell 的 iframe 内触发整页加载，目标 URL
只包含审批模式参数，没有 `hzy_embed=1`。重新加载后的 AIMS 因此按独立应用渲染 AppRail；其
Shell bridge 也不会启动，导致外层 Shell 地址无法同步。

## 修复

- Shell 内打开当前应用业务详情时，将绝对业务 URL 转为 Nuxt 应用内路由，保留现有嵌入状态；
- Shell 内打开其他应用业务详情时，通过 `applicationShellEntryUrl()` 切换父级企业 Shell；
- 独立应用模式继续保留原来的 external 导航；
- 待办、已办和我发起的三个入口统一传递任务所属 `app_code`。

## 验证

- 生产环境修复前真实点击已稳定复现双 AppRail；
- Foundation 全量测试：280/280 通过；
- Foundation lint、Foundation/AIMS Nuxt typecheck 通过；
- AIMS 生产构建通过，仅有既有 sourcemap、chunk size 与 scheduled task 警告；
- 新增回归测试：`foundation/test/applicationShell.test.ts`；
- 2026-08-26：已发布到生产并完成浏览器终验，审批中心跳转不再出现双 AppRail。（由维护者在生产环境确认）
