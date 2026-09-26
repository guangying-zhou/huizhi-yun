# 0082b56 复审证据包

本包为审查与隔离复现材料，不是修复patch，也不是部署工具。

- `REVIEW.md`：主要结论、调用链、权限问题及建议。
- `source/`：4个从GitHub读取并核验Git blob SHA的原始文件，均对应0082b56固定提交。
- `tests/authorization-probes.mjs`：审查新增探针，真实本地出口＋伪Console；不接入用户环境。
- `results/`：本次实际执行结果，Node v22.16.0。
- `SHA256SUMS.txt`：包内文件摘要。

在包根目录运行：

```sh
node --test source/deploy/test-env/local-enterprise/test/console-egress.test.mjs source/deploy/test-env/local-enterprise/test/error-contract.test.mjs
node tests/authorization-probes.mjs
```

scope探针中的200意味着测试替身返回成功，不代表真实服务grant已安装或真实人员有权限。使用的凭据是固定测试字符串。没有真实Token、Cookie、OSS秘密或数据库数据。

原仓库要求Node24，应在该工具链重新执行后再纳入正式验收。本次没有完整构建、真实浏览器、Runtime、MySQL、Cloudflare或本机运维验证。
