# VaultBot 生产环境部署指南

## 📋 项目概述

VaultBot 是一个基于 Telegram 的多租户内容存储与交付系统，使用 Telegram 作为媒体存储，PostgreSQL 存储索引和行为数据。

**技术栈：**
- Node.js 20 (TypeScript)
- PostgreSQL 16 (数据库)
- Redis 7 (队列和缓存)
- BullMQ (任务队列)
- Grammy (Telegram Bot 框架)
- Prisma (ORM)
- Fastify (HTTP 服务器)
- Docker & Docker Compose (容器化部署)

**架构：**
- `app` 服务：Telegram Bot 主服务 + HTTP API
- `worker` 服务：后台任务处理器
- `postgres` 服务：数据库
- `redis` 服务：消息队列和缓存

---

## 🚀 快速部署步骤

### 1. 前置准备

#### 1.1 服务器要求
- 操作系统：Ubuntu 20.04+ / Debian 11+
- CPU：2 核心以上
- 内存：2GB 以上
- 磁盘：20GB 以上可用空间
- 已安装 Docker 26.1.3+ 和 Docker Compose 2.24.0+ ✅

#### 1.2 Telegram Bot 配置
在部署前需要准备：

1. **创建 Bot**
   - 访问 [@BotFather](https://t.me/BotFather)
   - 发送 `/newbot` 创建新 Bot
   - 获取 `BOT_TOKEN`（格式：`123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`）

2. **创建存储群组**
   - 创建一个 Telegram 群组或频道用于存储媒体文件
   - 将 Bot 添加到群组并设为管理员
   - 获取 `VAULT_CHAT_ID`（可以使用 [@userinfobot](https://t.me/userinfobot) 获取）

3. **（可选）话题功能**
   - 如果群组启用了话题功能，获取 `VAULT_THREAD_ID`

### 2. 部署操作

#### 2.1 代码已拉取 ✅
```bash
cd /home/ubuntu/vaultbot
git status  # 确认在 main 分支，HEAD 位于 05f521f
```

#### 2.2 配置环境变量
```bash
# 创建 .env 文件
cp .env.example .env
chmod 600 .env

# 编辑配置
nano .env
```

**必填配置项：**
```env
# Telegram Bot Token（从 @BotFather 获取）
BOT_TOKEN=your_bot_token_here

# 存储群组 ID（必须是负数，如 -1001234567890）
VAULT_CHAT_ID=your_chat_id_here

# 租户标识（用于多租户隔离）
TENANT_CODE=production
TENANT_NAME=生产环境

# 以下由 docker-compose.yml 自动配置，无需手动设置
# DATABASE_URL=postgresql://vaultbot:vaultbot@postgres:5432/vaultbot
# REDIS_URL=redis://redis:6379

# 服务配置（可选，已有默认值）
HOST=0.0.0.0
PORT=3000
```

**可选配置项（Webhook 模式）：**
```env
# 如果使用 Webhook 而非 Long Polling
WEBHOOK_BASE_URL=https://your-domain.com
WEBHOOK_PATH=/webhook
WEBHOOK_SECRET=your_random_secret_here
```

#### 2.3 启动服务

**方式 1：使用快速部署脚本（推荐）**
```bash
chmod +x QUICK_DEPLOY.sh
./QUICK_DEPLOY.sh
```

**方式 2：手动使用 Docker Compose**
```bash
# 停止旧容器（如果存在）
docker compose down

# 构建并启动所有服务
docker compose up -d --build

# 等待服务启动
sleep 10

# 查看服务状态
docker compose ps
```

#### 2.4 验证部署

```bash
# 查看所有容器状态（应该都是 Up）
docker compose ps

# 查看 app 日志
docker compose logs -f app

# 查看 worker 日志
docker compose logs -f worker

# 检查数据库连接
docker compose exec app npx prisma db pull
```

**预期输出：**
- 所有容器状态为 `Up`
- app 日志显示 "Bot started successfully"
- worker 日志显示 "Worker started"
- 无错误日志

---

## 🔍 部署验证清单

### 服务健康检查
```bash
# 检查所有容器运行状态
docker compose ps

# 预期输出：
# NAME                  STATUS
# vaultbot-app-1        Up
# vaultbot-worker-1     Up
# vaultbot-postgres-1   Up
# vaultbot-redis-1      Up
```

### 功能测试
1. 在 Telegram 中找到你的 Bot
2. 发送 `/start` 命令，应该收到欢迎消息
3. 尝试上传图片/视频，检查是否正常存储
4. 尝试搜索和浏览功能
5. （租户）进入 `⚙️ 设置` → `🗄 存储群`：
   - 添加备份存储群（发送群/频道 chatId，如 `-100...`）
   - 选择 `minReplicas`（建议主+备都配置好后设为 2）
6. 新增备份存储群后，保持 worker 运行一段时间，系统会自动补副本（历史内容逐步写入备群）

---

## 📊 生产环境监控

### 查看日志
```bash
# 实时查看所有日志
docker compose logs -f

# 查看特定服务日志
docker compose logs -f app
docker compose logs -f worker

# 查看最近 100 行日志
docker compose logs --tail=100 app
```

### 资源监控
```bash
# 查看容器资源使用
docker stats

# 查看磁盘使用
df -h
docker system df
```

---

## 🔄 日常运维

### 更新部署
```bash
cd /home/ubuntu/vaultbot

# 拉取最新代码
git fetch origin
git reset --hard origin/main

# 重新构建并启动
docker compose up -d --build

# 查看日志确认
docker compose logs -f
```

### 重启服务
```bash
# 重启所有服务
docker compose restart

# 重启特定服务
docker compose restart app
docker compose restart worker
```

### 数据备份
```bash
# 备份 PostgreSQL
docker compose exec postgres pg_dump -U vaultbot vaultbot > backup_$(date +%Y%m%d_%H%M%S).sql

# 备份 Redis
docker compose exec redis redis-cli SAVE
docker compose cp redis:/data/dump.rdb ./backup_redis_$(date +%Y%m%d_%H%M%S).rdb
```

### 清理资源
```bash
# 清理未使用的 Docker 资源
docker system prune -a --volumes

# 查看日志文件大小
docker compose logs --tail=0 | wc -l
```

---

## 🛡️ 安全建议

1. **环境变量安全**
   - `.env` 文件权限设为 600
   - 不要将 `.env` 提交到 Git
   - 定期更换 `BOT_TOKEN` 和 `WEBHOOK_SECRET`

2. **网络安全**
   - 配置防火墙，只开放必要端口（3000）
   - 如果使用 Webhook，配置 SSL/TLS 证书
   - 使用反向代理（Nginx/Caddy）

3. **数据安全**
   - 定期备份数据库
   - 配置数据保留策略
   - 监控异常访问

---

## 🐛 故障排查

### Bot 无法响应
```bash
# 检查 app 容器日志
docker compose logs app | grep -i error

# 检查 BOT_TOKEN 是否正确
docker compose exec app sh -c 'echo $BOT_TOKEN'

# 重启 app 服务
docker compose restart app
```

### 数据库连接失败
```bash
# 检查 postgres 容器状态
docker compose ps postgres

# 测试数据库连接
docker compose exec postgres psql -U vaultbot -d vaultbot -c "SELECT 1;"

# 查看数据库日志
docker compose logs postgres
```

### Worker 不工作
```bash
# 检查 worker 日志
docker compose logs worker

# 检查 Redis 连接
docker compose exec redis redis-cli PING

# 重启 worker
docker compose restart worker
```

### 内存占用过高
```bash
# 查看容器内存使用
docker stats --no-stream

# 重启服务释放内存
docker compose restart
```

---

## 📞 支持与文档

- **项目文档**：`README.md`
- **部署检查清单**：`PRODUCTION_CHECKLIST.md`
- **GitHub 仓库**：https://github.com/DiDuMi/vaultbot
- **服务器 IP**：72.60.208.20

---

## ✅ 下一步操作

1. **配置 .env 文件**（必须）
   - 设置 `BOT_TOKEN`
   - 设置 `VAULT_CHAT_ID`
   - 设置 `TENANT_CODE` 和 `TENANT_NAME`

2. **运行部署脚本**
   ```bash
   ./QUICK_DEPLOY.sh
   ```

3. **验证部署**
   - 检查容器状态
   - 测试 Bot 功能
   - 查看日志

4. **配置监控**（可选）
   - 设置日志告警
   - 配置资源监控
   - 设置自动备份

