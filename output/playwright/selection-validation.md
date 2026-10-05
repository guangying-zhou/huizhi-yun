# 已发布 Markdown 禁止选择浏览器验收

真实运行 PublishedAssetDocument → DocLazyPreview → MilkdownEditor；Crepe、CodeMirror、ProseMirror 与 Nuxt UI 均为实际组件。视口：1440×900 与 390×900。

发现并修复后复测的问题：CSS/selectstart 不足以阻止 CodeMirror 双击选区与 body 发起全页 Cmd+A/Cmd+C；初版可真实复制代码块。主代理补 document selectionchange/copy 保护后下述检查通过。

- 正文、代码、表格拖选/双击/Cmd+A 均无残留内容选区。
- 真剪贴板验证正文/代码 Cmd+A 后 Cmd+C 不复制内容，代码块无选区时 Cmd+C 也不复制当前行。
- 发布代码复制按钮隐藏。
- 文档纵向滚动、390 视口表格横向滚动、正文链接和页面短链接按钮可用。
- 手动短链接输入框可正常全选和复制完整链接。
- 普通编辑可选择、复制与全选改写；启用 readonly + disableSelection 时清除已有选区。

截图：selection-1440.png、selection-390.png、selection-normal-editor.png、selection-manual-link.png，均人工检查。临时样本文档有刻意加长的表格单元格，便于验收滚动。

Mock：preview/短链接/查看记录 API、当前用户与权限、水印值、AI调用。正文 renderer 已从上轮 stub 替换为真实 Milkdown；未连接生产 OSS、Console 或 Runtime。最初 fixture 缺 mermaid alias/useAi 的启动错误均在 fixture 修复；最终正常页面无产品异常。PDF由其他代理验收。
