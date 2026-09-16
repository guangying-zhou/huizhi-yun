# Git 提交规范指南 (Git Commit Convention)

> **作者：** 周光营
> **版本：** v1.0
> **创建时间：** 2026-01-18
> **更新时间：** 2026-01-18

**项目地址：** https://gitlab.wiztek.cn/huizhi-yun/codocs

为了保持代码提交记录的清晰、可读性以及确保仓库的安全与整洁，本项目严格执行 **Conventional Commits** 提交规范。

> ⚠️ **注意**：服务端已启用 `pre-receive` 钩子拦截。不符合规范的提交将被拒绝推送 (Push Rejected)。

## 1. 提交格式

每次提交的信息 (Commit Message) 必须符合以下格式：

```text
<type>(<scope>): <subject>
```

- **type**: 提交类型 (必填，见下表)
- **scope**: 作用域 (选填)，用于说明 commit 影响的范围，如 `auth`, `ui`, `database` 等
- **subject**: 简短描述 (必填)，动词开头，使用中文或英文，**冒号后必须有一个空格**

---

## 2. Type 类型速查表

请根据代码变更的实际情况，选择以下类型之一：

| 类型 (Type)  | 含义      | 说明                                                       |
| :----------- | :-------- | :--------------------------------------------------------- |
| **feat**     | ✨ 新功能  | 引入新功能 (Feature)                                       |
| **fix**      | 🐛 Bug修复 | 修复了一个 Bug                                             |
| **docs**     | 📚 文档    | 仅修改了文档 (Documentation)                               |
| **style**    | 💎 格式    | 代码格式调整 (空格、分号等)，**不影响代码运行**            |
| **refactor** | ♻️ 重构    | 代码重构 (既不是新增功能，也不是修改 Bug 的代码变动)       |
| **perf**     | 🚀 性能    | 提升性能的代码更改                                         |
| **test**     | 🚨 测试    | 增加或修改测试用例                                         |
| **build**    | 📦 构建    | 影响构建系统或外部依赖的更改 (如: maven, npm, gulp)        |
| **ci**       | 👷 CI/CD   | 修改 CI 配置文件或脚本 (如: gitlab-ci.yml)                 |
| **chore**    | 🔧 杂项    | 其他不修改 src 或 test 文件的更改 (如: 构建过程、辅助工具) |
| **revert**   | ⏪ 回退    | 回退之前的提交                                             |

---

## 3. 示例 (Examples)

### ✅ 正确示例

```text
feat(auth): 增加CAS单点登录功能
fix(user): 修复用户头像无法上传的问题
docs: 更新API接口文档
style: 删除多余的空行和分号
refactor(core): 重构认证模块逻辑
chore: 升级依赖包版本
```

### ❌ 错误示例

```text
update code                  -> (错误：缺少类型和描述)
feat:add login               -> (错误：冒号后缺少空格)
Fixed bug for login          -> (错误：类型不标准)
优化了数据库查询               -> (错误：缺少类型前缀)
```

---

## 4. 本地开发环境配置 (IDE Setup)

建议在本地 IDE 中配置实时检查，以便在提交前发现问题。

### 🔹 IntelliJ IDEA / WebStorm 配置

1. 打开 **Settings** (Windows/Linux) 或 **Preferences** (macOS)。
2. 导航至 **Editor** -> **Version Control** -> **Commit**。
3. 找到 **Commit Message Inspections**。
4. 勾选 **Match commit message against regex**。
5. **Severity** 选择 `Error`。
6. 在正则输入框中填入以下规则：

```regex
^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?: .+$|^Merge (branch|remote-tracking branch|request) .+
```

### 🔹 VS Code 配置

推荐安装插件：**Conventional Commits** 或 **Commitlint**。
安装后，使用 `Command + Shift + P` (macOS) or `Ctrl + Shift + P` (Windows) 输入 `Conventional Commits` 即可通过向导式界面生成规范的 Commit。

---

## 5. ⛔️ 禁止提交的文件 (Ignored Files)

为了保证仓库的整洁和安全，以下类型的文件/目录 **严禁** 提交到版本库中。请确保它们已被添加到项目的 `.gitignore` 文件中。

| 类别           | 说明                                    | 示例 (禁止提交)                                                       |
| :------------- | :-------------------------------------- | :-------------------------------------------------------------------- |
| 🔐 **敏感信息** | 包含密码、Token、密钥的本地配置文件     | `.env`, `*.key`, `*.pem`, `id_rsa`, `config/local.js`                 |
| 📦 **依赖包**   | 本地安装的第三方库 (体积大且可自动安装) | `node_modules/`, `vendor/`, `jspm_packages/`                          |
| 🏗️ **构建产物** | 编译或打包生成的临时目录/文件           | `dist/`, `build/`, `target/` (Java), `bin/`, `obj/`, `*.jar`, `*.war` |
| 🖥️ **IDE配置**  | 个人开发环境的特定配置文件              | `.idea/` (IntelliJ), `.vscode/`, `*.suo`, `*.ntvs`, `*.iml`           |
| 🗑️ **系统文件** | 操作系统自动生成的缩略图或缓存          | `.DS_Store` (macOS), `Thumbs.db` (Windows)                            |
| 📜 **日志文件** | 运行时生成的日志或调试文件              | `*.log`, `npm-debug.log`, `yarn-error.log`                            |

> **💡 提示**：如果某个文件已经被误提交，请先将其加入 `.gitignore`，然后执行 `git rm --cached <file>` 将其从版本控制中移除（保留本地文件）。

---

## 6. 提交被拒绝怎么办？

如果您在 `git push` 时收到如下错误：

```text
remote: GL-HOOK-ERR: 提交被拒绝! (Commit Rejected)
remote: GL-HOOK-ERR: 您的 Commit Message 不符合规范。
```

请按照以下步骤修改您最近一次的提交信息：

1. **修改最后一次提交的信息**：
   ```bash
   git commit --amend
   ```
   *此时会进入编辑器，请将首行修改为规范格式 (例如: `fix: 修复由校验导致的推送失败`)，保存并退出。*

2. **再次推送**：
   ```bash
   git push
   ```