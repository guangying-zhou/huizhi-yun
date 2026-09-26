# 复现说明

固定提交：`0ca042dbe721e7ba72a290a7d90a551d561e4d04`。

## 内容

- `REVIEW.md`：中文符合性报告。
- `source/`：为本次导航纯函数与源码逻辑验证保留的八个原始文件。不是完整仓库；无部署凭据。
- `tests/observations.mjs`：审查新增的只读观察探针。
- `results/source-integrity.json`：Git blob SHA 比对结果，八项均一致。
- `results/repository-navigation-tests.tap`：原仓库导航测试输出。
- `results/observations.json` 和 `.log`：行为观察结果。

## 执行

在解压目录下使用 Node.js 22（本次为 v22.16.0），不需要安装依赖：

```bash
node --test source/enterprise/test/business-navigation.test.mjs
node tests/observations.mjs
```

原仓库七项测试应通过。观察探针记录并断言当前源码行为，包含报告列出的缺口；它通过不等于 ADR-019 已通过。探针采用的新增第二菜单项是测试 fixture，不是声称真实目录已经包含第二项。

抽取 Vue 的 objectMode 函数仅验证字符串匹配逻辑，不加载 Vue、Nuxt 或浏览器。因此不能据此声称完整界面、权限、接口、数据库和线上部署已验证。

源码字节来自固定提交的 GitHub 连接器读取，按 Git blob SHA 校验。可独立以 `git hash-object <文件路径>` 比较 `source-integrity.json`，或使用 SHA-1 对 `blob <字节数>\0<原始字节>` 计算。

本包不包含补丁，不改变任何业务或部署。执行原测试与观察探针仅加载文件并写本地观察结果，不连接业务环境。
