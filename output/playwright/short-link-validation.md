# Codocs 短链接浏览器验收

日期：2026-09-10。隔离 Nuxt fixture，地址 http://localhost:3187/codocs/。

真实产品组件：PublishedAssetDocument、PublishedAssetLinkButton、CompanyAssetAccessRecords，以及 app/pages/s/[token].vue；真实 Nuxt UI。

已通过：
- 1440×1000、390×844 布局及长中文标题，无文档级横向溢出。
- 复制生成 16 字符短 token URL；剪贴板拒绝时手动复制输入框保留完整链接。
- 解析后复用 company-assets/preview，正文与水印传值，地址栏保持 /s/token。
- 查看记录弹窗可打开并显示中文姓名。
- 持续 503 后重试成功；404、403、非法 token 错误文案及重试适用性正确。
- 生成链接期间切换文档不复制旧链接；剪贴板成功/失败延迟期间切换文档，不显示旧成功通知或手动复制弹窗。
- 生成失败后再次点击可恢复。

截图 short-link-desktop.png、short-link-desktop-manual.png、short-link-mobile.png、short-link-mobile-manual.png、short-link-records-mobile.png、short-link-mobile-error.png。弹窗截图已结束动画后重拍并人工检查。

Mock 限制：权限、目录水印值、链接/预览/记录 API、正文 renderer 为 stub。未连接生产环境，不证明真实 OSS、Console 登录/授权、Runtime 持久化或通知。预期 503/404/403 产生资源错误日志；正常最终页面无产品控制台异常。最初 fixture 缺 CommonEmptyState 的警告已通过 fixture 本地注册修复。
