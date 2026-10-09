# X Bookmark Fetcher - Linux 服务器部署指南

## 目录

- [系统要求](#系统要求)
- [环境准备](#环境准备)
- [安装步骤](#安装步骤)
- [配置说明](#配置说明)
- [首次登录 X](#首次登录-x)
- [服务管理](#服务管理)
- [故障排查](#故障排查)
- [生产环境优化](#生产环境优化)

---

## 快速开始

本项目使用 `requirements.txt` 管理所有 Python 依赖，只需一条命令即可完成安装：

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

详细部署步骤请继续阅读下文。

---

## 系统要求

- **操作系统**: Ubuntu 20.04+ / Debian 11+ / CentOS 8+ / RHEL 8+
- **Python**: 3.9 或更高版本
- **内存**: 至少 2GB RAM（推荐 4GB+）
- **磁盘**: 至少 5GB 可用空间
- **网络**: 能够访问 X.com（Twitter）和阿里云 OSS

---

## 环境准备

### 1. 更新系统包

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get upgrade -y

# CentOS/RHEL
sudo yum update -y
```

### 2. 安装 Python 3.9+

```bash
# Ubuntu/Debian
sudo apt-get install -y python3 python3-pip python3-venv

# CentOS/RHEL
sudo yum install -y python39 python39-pip

# 验证版本
python3 --version  # 应该 >= 3.9
```

### 3. 安装浏览器依赖（关键步骤）

Scrapling 使用 Playwright，需要安装 Chromium 浏览器及其依赖：

```bash
# Ubuntu/Debian
sudo apt-get install -y \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libatspi2.0-0 \
    libxshmfence1

# CentOS/RHEL
sudo yum install -y \
    nss \
    nspr \
    atk \
    at-spi2-atk \
    cups-libs \
    libdrm \
    dbus-libs \
    libxkbcommon \
    libXcomposite \
    libXdamage \
    libXfixes \
    libXrandr \
    mesa-libgbm \
    pango \
    cairo \
    alsa-lib
```

### 4. 安装基础构建依赖

```bash
# Ubuntu/Debian
sudo apt-get install -y build-essential

# CentOS/RHEL
sudo yum install -y gcc
```

---

## 安装步骤

### 1. 克隆或上传项目

```bash
# 假设项目已上传到服务器
cd /path/to/codocs/x-bookmark-fetcher
```

### 2. 创建 Python 虚拟环境

```bash
python3 -m venv venv
source venv/bin/activate
```

### 3. 升级 pip

```bash
pip install --upgrade pip
```

### 4. 安装 Python 依赖（一键安装）

使用 `requirements.txt` 批量安装所有必需的 Python 库：

```bash
pip install -r requirements.txt
```

这将自动安装以下依赖：

- `fastapi` - Web 框架
- `uvicorn` - ASGI 服务器
- `scrapling[all]` - 网页抓取库（包含 Playwright）
- `apscheduler` - 定时任务调度
- `oss2` - 阿里云 OSS SDK
- `python-dotenv` - 环境变量管理
- `readability-lxml` - 网页内容提取
- `pydantic` & `pydantic-settings` - 数据验证
- `markdownify` - HTML 转 Markdown
- `beautifulsoup4` - HTML 解析
- `httpx` - HTTP 客户端

**注意**：安装过程可能需要 3-5 分钟，请耐心等待。

### 5. 安装 Playwright 浏览器

```bash
# 安装 Chromium 浏览器
playwright install chromium

# 安装浏览器系统依赖（如果第3步未完全安装）
playwright install-deps chromium
```

验证安装：

```bash
playwright --version
```

---

## 配置说明

### 1. 创建环境配置文件

```bash
cp .env.example .env
nano .env  # 或使用 vim
```

### 2. 配置 `.env` 文件

```env
# tenant-runtime 配置
HZY_TENANT_RUNTIME_URL=http://127.0.0.1:18080
HZY_TENANT_RUNTIME_TOKEN=your_runtime_token

# 阿里云 OSS 配置
OSS_ACCESS_KEY_ID=your_access_key_id
OSS_ACCESS_KEY_SECRET=your_access_key_secret
OSS_ENDPOINT=oss-cn-qingdao.aliyuncs.com
OSS_BUCKET_NAME=your_bucket_name

# 应用配置
API_PORT=8001

# X 账号信息（可选，用于自动登录）
X_USERNAME=your_x_username
X_PASSWORD=your_x_password
```

### 3. 验证 tenant-runtime 连接

```bash
curl -H "Authorization: Bearer $HZY_TENANT_RUNTIME_TOKEN" "$HZY_TENANT_RUNTIME_URL/runtime/health"
```

---

## 首次登录 X

由于 X（Twitter）需要登录才能访问书签，首次部署需要手动登录一次以保存 session。

### 方法一：临时使用非无头模式（推荐用于本地）

如果你在本地开发环境：

1. 临时修改 `app/scraper.py`：

```python
# 将 headless=True 改为 headless=False
async with AsyncStealthySession(
    headless=False,  # 临时改为 False
    ...
```

2. 运行一次抓取：

```bash
python -m app.scraper
```

3. 在弹出的浏览器中手动登录 X
4. 登录成功后，session 会保存到 `./x-session` 目录
5. 改回 `headless=True`

### 方法二：使用 Xvfb（推荐用于服务器）

在 Linux 服务器上使用虚拟显示：

1. 安装 Xvfb：

```bash
sudo apt-get install -y xvfb  # Ubuntu/Debian
sudo yum install -y xorg-x11-server-Xvfb  # CentOS/RHEL
```

2. 临时改为非无头模式（同方法一）

3. 使用 Xvfb 运行：

```bash
xvfb-run -a python -m app.scraper
```

4. 这会在虚拟显示中打开浏览器，你需要通过 VNC 或其他方式连接查看

### 方法三：从本地复制 session（最简单）

1. 在本地电脑运行一次并登录（使用方法一）
2. 将 `x-session` 目录打包：

```bash
tar -czf x-session.tar.gz x-session/
```

3. 上传到服务器：

```bash
scp x-session.tar.gz user@server:/path/to/x-bookmark-fetcher/
```

4. 在服务器解压：

```bash
cd /path/to/x-bookmark-fetcher
tar -xzf x-session.tar.gz
```

### 验证 Session 有效性

```bash
python3 -c "
import asyncio
from app.x_article_scraper import XArticleScraper
scraper = XArticleScraper()
is_valid = asyncio.run(scraper.is_session_valid())
print('✓ Session is valid' if is_valid else '✗ Session expired, need re-login')
"
```

---

## 服务管理

### 启动服务

```bash
./start.sh
```

输出示例：

```
Starting bookmark fetcher service on port 8001...
✓ Service started successfully (took 3s)
Log file: /tmp/fetcher.log
Status: curl http://localhost:8001/status
```

### 查看服务状态

```bash
./status.sh
```

或者：

```bash
curl http://localhost:8001/status
```

### 停止服务

```bash
./stop.sh
```

### 查看日志

```bash
# 实时查看日志
tail -f /tmp/fetcher.log

# 查看最近 100 行
tail -100 /tmp/fetcher.log

# 搜索错误
grep -i error /tmp/fetcher.log
```

### 重启服务

```bash
./stop.sh && ./start.sh
```

---

## 故障排查

### 1. 服务无法启动

**检查端口占用：**

```bash
lsof -i :8001
# 或
netstat -tlnp | grep 8001
```

**解决方法：**

```bash
# 杀死占用进程
kill -9 $(lsof -t -i:8001)
# 或修改 .env 中的 API_PORT
```

### 2. 浏览器启动失败

**错误信息：** `Browser executable not found` 或 `Failed to launch browser`

**解决方法：**

```bash
# 重新安装 Playwright 浏览器
source venv/bin/activate
playwright install chromium
playwright install-deps
```

### 3. 无头模式下浏览器崩溃

**错误信息：** `Browser closed unexpectedly`

**解决方法：**

```bash
# 增加共享内存（Docker 环境常见问题）
sudo mount -o remount,size=2G /dev/shm

# 或在启动参数中添加 --disable-dev-shm-usage（已在代码中配置）
```

### 4. Session 过期

**症状：** 抓取时提示需要登录

**解决方法：**

```bash
# 删除旧 session
rm -rf x-session/

# 重新登录（参考"首次登录 X"章节）
```

### 5. tenant-runtime 连接失败

**检查配置：**

```bash
# 测试 runtime 连接
curl -H "Authorization: Bearer $HZY_TENANT_RUNTIME_TOKEN" "$HZY_TENANT_RUNTIME_URL/runtime/health"
```

**常见问题：**

- data-runtime 未启动或未启用 Codocs adapter。
- `HZY_TENANT_RUNTIME_TOKEN` 与 data-runtime 配置不一致。
- 网络不通：使用 `curl` 或 `nc` 测试 runtime 端口连通性。

### 6. OSS 上传失败

**检查 OSS 配置：**

```bash
python3 -c "
from app.oss_uploader import OSSUploader
uploader = OSSUploader()
result = uploader.upload_markdown('test', 'test/test.md')
print('✓ OSS upload works' if result else '✗ OSS upload failed')
"
```

### 7. 内存不足

**症状：** 服务频繁崩溃，日志显示 `Killed`

**解决方法：**

```bash
# 检查内存使用
free -h

# 增加 swap（临时方案）
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# 或升级服务器内存
```

---

## 生产环境优化

### 1. 使用 Systemd 管理服务

创建服务文件：

```bash
sudo nano /etc/systemd/system/x-bookmark-fetcher.service
```

内容：

```ini
[Unit]
Description=X Bookmark Fetcher Service
After=network.target mysql.service

[Service]
Type=simple
User=your_username
WorkingDirectory=/root/huizhi-yun/codocs/x-bookmark-fetcher
Environment="PATH=/root/huizhi-yun/codocs/x-bookmark-fetcher/venv/bin"
ExecStart=/root/huizhi-yun/codocs/x-bookmark-fetcher/venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8001
Restart=always
RestartSec=10
StandardOutput=append:/var/log/x-bookmark-fetcher.log
StandardError=append:/var/log/x-bookmark-fetcher-error.log

[Install]
WantedBy=multi-user.target
```

启用服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable x-bookmark-fetcher
sudo systemctl start x-bookmark-fetcher
sudo systemctl status x-bookmark-fetcher
```

### 2. 配置 Nginx 反向代理

#### 安装 Nginx

```bash
# Ubuntu/Debian
sudo apt-get install -y nginx

# CentOS/RHEL
sudo yum install -y nginx

# 启动 Nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

#### 基础配置（HTTP）

创建配置文件：

```bash
sudo nano /etc/nginx/conf.d/x-fetcher
```

配置内容：

```nginx
server {
    listen 80;
    server_name xfetcher.wiztek.cn;  # 修改为你的域名或服务器IP

    # 访问日志
    access_log /var/log/nginx/x-bookmark-fetcher-access.log;
    error_log /var/log/nginx/x-bookmark-fetcher-error.log;

    # API 路由
    location /api/bookmarks/ {
        proxy_pass http://127.0.0.1:8001/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 增加超时时间（抓取和处理可能需要较长时间）
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
        proxy_send_timeout 300s;

        # 增加缓冲区大小
        proxy_buffer_size 4k;
        proxy_buffers 4 32k;
        proxy_busy_buffers_size 64k;

        # 禁用缓存（API 响应）
        proxy_no_cache 1;
        proxy_cache_bypass 1;
    }

    # 健康检查端点
    location /api/bookmarks/status {
        proxy_pass http://127.0.0.1:8001/status;
        proxy_set_header Host $host;
        access_log off;  # 不记录健康检查日志
    }
}
```

启用配置：
```bash
# 测试配置
sudo nginx -t

# 重载 Nginx
sudo systemctl reload nginx
```

#### HTTPS 配置（推荐生产环境）

使用 Let's Encrypt 免费 SSL 证书：

```bash
# 安装 Certbot
# Ubuntu/Debian
sudo apt-get install -y certbot python3-certbot-nginx

# CentOS/RHEL
sudo yum install -y certbot python3-certbot-nginx

# 获取证书并自动配置 Nginx
sudo certbot --nginx -d your-domain.com

# 测试自动续期
sudo certbot renew --dry-run
```

或手动配置 HTTPS：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # HTTP 重定向到 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL 证书配置
    ssl_certificate /etc/nginx/ssl/your-domain.crt;
    ssl_certificate_key /etc/nginx/ssl/your-domain.key;

    # SSL 安全配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # 访问日志
    access_log /var/log/nginx/x-bookmark-fetcher-access.log;
    error_log /var/log/nginx/x-bookmark-fetcher-error.log;

    # API 路由
    location /api/bookmarks/ {
        proxy_pass http://127.0.0.1:8001/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 增加超时时间
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
        proxy_send_timeout 300s;

        # 增加缓冲区大小
        proxy_buffer_size 4k;
        proxy_buffers 4 32k;
        proxy_busy_buffers_size 64k;

        # 禁用缓存
        proxy_no_cache 1;
        proxy_cache_bypass 1;
    }

    # 健康检查端点
    location /api/bookmarks/status {
        proxy_pass http://127.0.0.1:8001/status;
        proxy_set_header Host $host;
        access_log off;
    }
}
```

#### 内网访问配置（无域名）

如果只在内网使用，可以直接用 IP：

```nginx
server {
    listen 80;
    server_name _;  # 匹配所有域名/IP

    location /api/bookmarks/ {
        proxy_pass http://127.0.0.1:8001/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # 限制访问来源（可选）
        allow 192.168.0.0/16;  # 允许内网访问
        allow 10.0.0.0/8;      # 允许内网访问
        deny all;              # 拒绝其他来源

        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
```

#### 负载均衡配置（高可用）

如果运行多个实例：

```nginx
upstream x_bookmark_backend {
    least_conn;  # 最少连接负载均衡
    server 127.0.0.1:8001 weight=1 max_fails=3 fail_timeout=30s;
    server 127.0.0.1:8002 weight=1 max_fails=3 fail_timeout=30s;
    server 127.0.0.1:8003 weight=1 max_fails=3 fail_timeout=30s;
}

server {
    listen 80;
    server_name your-domain.com;

    location /api/bookmarks/ {
        proxy_pass http://x_bookmark_backend/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;

        # 健康检查
        proxy_next_upstream error timeout http_500 http_502 http_503;
    }
}
```

#### 验证配置

```bash
# 测试 Nginx 配置语法
sudo nginx -t

# 查看 Nginx 状态
sudo systemctl status nginx

# 测试反向代理
curl http://your-domain.com/api/bookmarks/status

# 查看 Nginx 日志
sudo tail -f /var/log/nginx/x-bookmark-fetcher-access.log
sudo tail -f /var/log/nginx/x-bookmark-fetcher-error.log
```

#### 常见 Nginx 问题

**问题 1：502 Bad Gateway**

```bash
# 检查后端服务是否运行
curl http://127.0.0.1:8001/status

# 检查 SELinux（CentOS/RHEL）
sudo setsebool -P httpd_can_network_connect 1

# 检查防火墙
sudo firewall-cmd --add-service=http --permanent
sudo firewall-cmd --reload
```

**问题 2：504 Gateway Timeout**

```nginx
# 增加超时时间
proxy_read_timeout 600s;
proxy_connect_timeout 600s;
proxy_send_timeout 600s;
```

**问题 3：上传大小限制**

```nginx
# 在 server 或 location 块中添加
client_max_body_size 50M;
```

### 3. 日志轮转

创建日志轮转配置：

```bash
sudo nano /etc/logrotate.d/x-bookmark-fetcher
```

内容：

```
/tmp/fetcher.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0644 your_username your_username
}
```

### 4. 监控和告警

使用 cron 定期检查服务状态：

```bash
crontab -e
```

添加：

```cron
*/5 * * * * curl -f http://localhost:8001/status || echo "X Bookmark Fetcher is down!" | mail -s "Service Alert" your@email.com
```

### 5. 定期清理

```bash
# 清理旧的浏览器缓存
find x-session/ -name "*.log" -mtime +7 -delete

# 清理临时文件
find /tmp -name "playwright-*" -mtime +1 -delete
```

### 6. 性能优化

在 `.env` 中调整并发设置（如果需要）：

```env
# 限制并发请求数
MAX_CONCURRENT_REQUESTS=5

# 调整超时时间
REQUEST_TIMEOUT=60
```

---

## Docker 部署（可选）

如果你更喜欢使用 Docker：

### 1. 创建 Dockerfile

```dockerfile
FROM python:3.11-slim

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libdbus-1-3 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    default-libmysqlclient-dev build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 安装 Python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 安装 Playwright 浏览器
RUN playwright install chromium
RUN playwright install-deps chromium

# 复制应用代码
COPY . .

# 暴露端口
EXPOSE 8001

# 启动命令
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
```

### 2. 构建和运行

```bash
# 构建镜像
docker build -t x-bookmark-fetcher .

# 运行容器
docker run -d \
  --name x-bookmark-fetcher \
  -p 8001:8001 \
  -v $(pwd)/x-session:/app/x-session \
  -v $(pwd)/.env:/app/.env \
  --shm-size=2gb \
  x-bookmark-fetcher

# 查看日志
docker logs -f x-bookmark-fetcher
```

---

## 安全建议

1. **限制端口访问**：使用防火墙限制 8001 端口仅内网访问
2. **定期更新依赖**：`pip list --outdated` 检查过期包
3. **保护敏感信息**：确保 `.env` 文件权限为 600
4. **备份 session**：定期备份 `x-session` 目录
5. **监控异常登录**：关注 X 账号的登录通知

---

## 常用命令速查

```bash
# 启动服务
./start.sh

# 停止服务
./stop.sh

# 查看状态
./status.sh

# 查看日志
tail -f /tmp/fetcher.log

# 测试 API
curl http://localhost:8001/status

# 手动触发同步
curl -X POST http://localhost:8001/sync

# 检查 session 有效性
python3 -c "import asyncio; from app.x_article_scraper import XArticleScraper; print(asyncio.run(XArticleScraper().is_session_valid()))"

# 重启服务（systemd）
sudo systemctl restart x-bookmark-fetcher
```

---

## 技术支持

如遇到问题，请检查：

1. 日志文件：`/tmp/fetcher.log`
2. 系统日志：`journalctl -u x-bookmark-fetcher -f`（如使用 systemd）
3. 浏览器日志：`x-session/Default/chrome_debug.log`

---

**部署完成！** 🎉

服务现在应该在后台运行，每 6 小时自动同步一次书签。你可以通过 Codocs 管理界面查看和处理书签。
