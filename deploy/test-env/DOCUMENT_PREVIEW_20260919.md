# 我的文档预览修复记录

## 已验证结果

- 测试 Host `hzy-test-enterprise` 版本：`37885e5a-0258-4ee4-88c9-18ceb1dd0b78`。
- 登录用户在 `/codocs/mydocs` 打开《软件工程的未来两年》，正文、标题及段落实际渲染；新验收标签页无控制台 error。
- 文档 `2f5f6e38-3942-4be7-ba35-4ad37c64fd14` 的详情请求返回 HTTP 200、`success=true`，正文 6,694 字符。

## 代码原因与修复

Foundation Integration adapter 原先将 `integration_config:view` 转成 `data-runtime:integration_config:view`，实际 Worker 令牌签发失败为 `insufficient_scope`。直接按原 scope 探测成功并不能验证 Worker 的 scope 转换。

为该 adapter 增加封闭的 `console-integration` 格式，仅允许 `integration_config:view` 和 `credential_vault:resolve`，且 audience 必须为 `data-runtime` 或 `tenant-runtime`。既有 grant 的 integrationCodes/usageTypes 限制保留。排查期间加入的响应诊断信息已移除。

验证：Foundation 相关 23 项测试通过；Runtime 集成接口能力校验回归通过；测试 Console registration verify 的 missingCapabilities 为空。实际登录浏览器读正文成功覆盖 Worker 令牌获取、Runtime 集成与凭据解析和对象读取。

## 排查期间的配置与数据操作

- 测试 Console `oss.default.config.provider` 设置为 `aliyun-oss-s3`；本地使用相同 Foundation S3 客户端实读成功。
- 原个人 Markdown 路径不存在，先前排查将 `codocs/departments/GMO/docs/测试/软件工程的未来两年.md` 复制至 `codocs/users/zhouguangying/docs/软件工程的未来两年.md`。使用禁止覆盖条件写入并比对字节一致，17,848 字节，源对象保留。
- **该存储桶与生产共享，因此上述复制实际新增了共享桶对象，并非隔离测试桶写入。** 来源是同名部门副本；没有个人旧对象可供比对，不能据此证明它是个人文档最后版本。没有修改生产数据库或发布生产 Worker。
- 排查中曾误用通用构建配置部署，随后已用 `build-enterprise-pilot.mjs` 恢复完整测试 pilot 配置、Service Bindings 和 `/enterprise/_nuxt/` 资源路径；最终浏览器验收使用上述最终版本。

本记录只证明本次文档预览修复；其他文档和全部 mydocs 写入动作不因此视为验收完成。
