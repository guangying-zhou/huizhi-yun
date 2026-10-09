# Slidev 演示文稿服务 — 部署文档

## 1. 架构概览

```
用户浏览器
  │
  ├── https://codocs.wiztek.cn          → Nginx → Nuxt 主应用 (port 3001)
  ├── wss://collab.wiztek.cn            → Nginx → Collab Runtime (port 3021)
  └── https://slidev.wiztek.cn   [新增] → Nginx → Slidev dev server (port 3045)
                                           │
  Nuxt 服务端 ──── 内部调用 ──────────────→ Slidev API (port 3040)
```

| 组件 | 端口 | 说明 | 对外暴露 |
|------|------|------|---------|
| Slidev API | 3040 | Express 服务，接收渲染/导出请求 | 否（仅 Nuxt 内部调用） |
| Slidev Dev Server | 3045 | Vite 开发服务器，渲染幻灯片 | 是（通过 Nginx 反向代理） |

## 2. 服务器准备（首次部署）

### 2.1 创建目录

```bash
mkdir -p /opt/huizhi-yun/slidev
mkdir -p /opt/huizhi-yun/secrets/slidev
mkdir -p /var/log/pm2
```

### 2.2 配置环境变量

创建 `/opt/huizhi-yun/secrets/slidev/.env`：

```bash
cat > /opt/huizhi-yun/secrets/slidev/.env << 'EOF'
# 服务端口
SLIDEV_SERVICE_PORT=3040
SLIDEV_DEV_PORT=3045

# 公网 URL（浏览器通过 iframe 访问 Slidev 渲染结果）
SLIDEV_PUBLIC_URL=https://slidev.wiztek.cn

# 封面图随机 API（codocs 主应用提供）
COVERS_URL=https://codocs.wiztek.cn/api/covers

# CORS 允许的来源（限制为 codocs 域名）
CORS_ORIGIN=https://codocs.wiztek.cn

# Vite Host 白名单（必须设置，否则 Nginx 代理的请求会被 Vite 拒绝）
__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=slidev.wiztek.cn

# Node 环境
NODE_ENV=production
EOF
```

### 2.3 更新 codocs 主应用环境变量

在 `/opt/huizhi-yun/secrets/codocs/.env` 中追加：

```bash
echo 'SLIDEV_SERVICE_URL=http://127.0.0.1:3040' >> /opt/huizhi-yun/secrets/codocs/.env
```

### 2.4 DNS 解析

添加 A 记录：`slidev.wiztek.cn` → 服务器 IP

## 3. Nginx 配置

### 3.1 创建站点配置

创建 `/etc/nginx/conf.d/slidev.wiztek.cn.conf`：

```nginx
server {
    listen 80;
    server_name slidev.wiztek.cn;

    # Slidev dev server 反向代理（含 WebSocket 支持，Vite HMR 需要）
    # 启动参数含 --remote 时监听 0.0.0.0，使用 127.0.0.1 即可
    location / {
        proxy_pass http://127.0.0.1:3045;
        proxy_http_version 1.1;

        # WebSocket 支持（Vite HMR）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # 标准代理头
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 长连接超时（HMR WebSocket）
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

> **排查提示**：如果 Nginx 502，用 `ss -tlnp | grep 3045` 检查监听地址。启动参数含 `--remote` 时监听 `0.0.0.0`，用 `127.0.0.1`；不含时可能只监听 `[::1]`，需改为 `http://[::1]:3045`。

### 3.2 验证并重载

```bash
nginx -t
systemctl reload nginx
```

### 3.3 申请 SSL 证书

```bash
certbot --nginx -d slidev.wiztek.cn
certbot renew --dry-run
```

## 4. 手工部署流程

当前不再通过 CI/CD 自动部署 Slidev Service。需要更新时按下面的构建、同步和 PM2 重启流程手工执行。

### 4.1 构建阶段

手工构建时执行：
1. 复制 `slidev-service` 源码和资源到临时目录
2. `pnpm install --filter ./slidev-service --frozen-lockfile`
3. `pnpm --filter ./slidev-service build`（TypeScript → JavaScript）
4. 将构建产物同步到服务器

### 4.2 部署阶段

手工部署时执行：
1. 解压构建产物到 `/opt/huizhi-yun/slidev/`
2. 复制 `.env` 文件
3. 安装 Playwright Chromium（导出 PDF/PPTX 需要）
4. PM2 启动 `hzy-slidev` 进程

### 4.3 PM2 进程配置

| 参数 | 值 | 说明 |
|------|-----|------|
| name | `hzy-slidev` | 进程名 |
| cwd | `/opt/huizhi-yun/slidev/slidev-service` | 工作目录 |
| script | `dist/server.js` | 入口文件 |
| max_memory_restart | `1G` | 内存上限（Slidev dev server 较大） |
| kill_timeout | `5000` | 优雅退出等待时间（清理子进程） |

## 5. 手动部署示例

如需手动部署，执行以下步骤：

```bash
# 1. 在开发机上构建
cd /path/to/codocs/slidev-service
pnpm install
pnpm build

# 2. 上传到服务器
rsync -avz --exclude node_modules --exclude .env \
  slidev-service/ root@server:/opt/huizhi-yun/slidev/slidev-service/

# 3. 在服务器上安装依赖
ssh root@server
cd /opt/huizhi-yun/slidev/slidev-service
pnpm install --production

# 4. 安装 Playwright（首次）
npx playwright install --with-deps chromium

# 5. 启动
pm2 start /opt/huizhi-yun/codocs/deploy/ecosystem.config.cjs --only hzy-slidev
pm2 save
```

## 6. 生产目录结构

```
/opt/huizhi-yun/slidev/
├── .env                         ← 环境变量（从 secrets 复制）
├── node_modules/                ← 根级依赖
└── slidev-service/
    ├── dist/                    ← TypeScript 编译产物
    │   └── server.js
    ├── node_modules/            ← 包级依赖（@slidev/cli 等）
    ├── workspace/               ← Slidev 运行时工作区
    │   ├── slides.md            ← 当前渲染的文稿（运行时写入）
    │   ├── vite.config.ts       ← Vite 配置（运行时自动生成）
    │   ├── global-top.vue       ← 编辑器自动打开组件
    │   ├── snippets/
    │   │   └── external.ts
    │   └── public/
    │       └── covers → ../../covers (symlink)
    ├── covers/                  ← 封面背景图片（29张 webp）
    ├── exports/                 ← 导出文件（运行时生成）
    ├── Demo.md                  ← 示例文稿
    ├── SlideSyntax.md           ← 语法指南文稿
    └── package.json
```

## 7. 运维操作

### 7.1 查看状态

```bash
pm2 status hzy-slidev
pm2 logs hzy-slidev --lines 50
```

### 7.2 重启服务

```bash
pm2 restart hzy-slidev
```

### 7.3 查看 Slidev dev server 是否正常

```bash
# 注意：Slidev 可能只监听 IPv6
curl -s -o /dev/null -w "%{http_code}" http://[::1]:3045/
# 应返回 200

curl -s http://localhost:3040/health
# 应返回 {"status":"ok","devReady":true,"slidevPort":3045}

# 如果 IPv6 不通，试 IPv4
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3045/
```

### 7.4 清理残留进程

如果 Slidev dev server 子进程残留：

```bash
pkill -f "slidev.*3045" || true
pm2 restart hzy-slidev
```

### 7.5 更新封面图片

将新图片放入 `/opt/huizhi-yun/slidev/slidev-service/covers/` 目录，重启服务即可生效（文件名列表在启动时扫描）。

同时需要上传到 OSS（`images.wiztek.cn/slide_covers/`），并更新 codocs 中的 `server/api/covers.get.ts` 文件名列表。

## 8. 验证清单

部署完成后逐项检查：

- [ ] `curl https://slidev.wiztek.cn/` 返回 Slidev 页面 HTML
- [ ] `curl http://localhost:3040/health` 返回 `{"status":"ok","devReady":true}`
- [ ] 在 codocs 中创建新演示文稿，确认 iframe 预览正常加载
- [ ] 在 Slidev 内置编辑器中修改内容，确认 HMR 实时刷新
- [ ] 点击"保存"，确认内容同步到 OSS
- [ ] 切换不同文稿，确认无闪屏、无 Slidev 重启
- [ ] 测试"查看示例"功能
- [ ] 测试 PDF 导出功能（如已安装 Playwright）
- [ ] 检查 `pm2 logs hzy-slidev` 无报错

## 9. 常见问题

### 9.1 Nginx 502 Bad Gateway

Slidev 启动参数含 `--remote` 时监听 `0.0.0.0`，Nginx 用 `127.0.0.1` 即可。如果不含 `--remote`，可能只监听 IPv6（`[::1]`）。

```bash
# 诊断：检查监听地址
ss -tlnp | grep 3045
# 0.0.0.0:3045 → proxy_pass http://127.0.0.1:3045
# [::1]:3045   → proxy_pass http://[::1]:3045
```

### 9.2 Vite "Blocked request. This host is not allowed."

Vite 6+ 的 Host 检查会拒绝非 localhost 的请求。必须在 `.env` 中设置：

```bash
__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=slidev.wiztek.cn
```

注意：`vite.config.ts` 中的 `allowedHosts` 选项可能不生效（被 Slidev 内部配置覆盖），环境变量方式最可靠。

### 9.3 vite.config.ts 报 "Cannot find package 'vite'"

不要在 `vite.config.ts` 中使用 `import { defineConfig } from 'vite'`，直接用 `export default { ... }` 导出普通对象即可。

### 9.4 首次部署或更新后 vite.config.ts 未更新

代码中有 `if (!existsSync)` 判断，已有文件不会被覆盖。如果需要更新配置：

```bash
rm /opt/huizhi-yun/slidev/slidev-service/workspace/vite.config.ts
pm2 restart hzy-slidev
# 服务启动时会自动重新生成
```

## 10. 已知限制

| 限制 | 说明 | 影响 |
|------|------|------|
| 单 workspace | 所有用户共享一个 `slides.md` | 多人同时预览不同文稿会互相覆盖 |
| Vite dev server | 生产环境运行开发模式服务器 | 内存占用较大（~500MB），通过 Nginx 限制来源缓解安全风险 |
| Playwright 体积 | Chromium 二进制约 200MB | 首次部署下载较慢，后续复用 |
| Headmatter 限制 | `theme`/`transition` 等配置被强制覆盖 | 所有文稿使用统一主题（seriph），避免切换时 Slidev 重启 |
| 监听地址 | `--remote` 参数控制监听 `0.0.0.0` 或 `[::1]` | Nginx proxy_pass 需与实际监听地址匹配 |
