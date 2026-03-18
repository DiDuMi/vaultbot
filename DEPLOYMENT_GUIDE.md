# VaultBot 部署与迭代指南

## 📋 目录

- [首次部署](#首次部署)
- [日常迭代更新](#日常迭代更新)
- [数据持久化说明](#数据持久化说明)
- [注意事项](#注意事项)
- [故障排查](#故障排查)

---

## 🚀 首次部署

### 1. 环境准备

确保服务器已安装：
- Docker (20.10+)
- Docker Compose (v2.0+)
- Git

### 2. 克隆代码

```bash
git clone https://github.com/DiDuMi/vaultbot.git
cd vaultbot
```

### 3. 配置环境变量

```bash
# 复制配置模板
cp .env.example .env

# 编辑配置文件
nano .env
```

必需配置项：
```env
BOT_TOKEN=your_bot_token_here
DATABASE_URL=postgresql://vaultbot:vaultbot@postgres:5432/vaultbot
REDIS_URL=redis://redis:6379
TENANT_CODE=your_tenant_code
TENANT_NAME=Your Tenant Name
VAULT_CHAT_ID=your_vault_group_id
VAULT_THREAD_ID=
WEBHOOK_BASE_URL=
WEBHOOK_PATH=
WEBHOOK_SECRET=
HOST=0.0.0.0
PORT=3000
```

### 4. 启动服务

```bash
# 构建并启动所有服务
docker compose up -d --build

# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f
```

---

## 🔄 日常迭代更新

### ✅ 正确的更新流程

```bash
# 1. 进入项目目录
cd /path/to/vaultbot

# 2. 拉取最新代码
git pull

# 3. 重新构建并启动（保留数据）
docker compose up -d --build

# 4. 查看服务状态
docker compose ps

# 5. 查看日志确认启动成功
docker compose logs -f app
```

### ❌ 错误的更新方式

```bash
# ❌ 永远不要使用 -v 参数！这会删除所有数据！
docker compose down -v

# ❌ 不要删除数据卷
docker volume rm vaultbot_pgdata
```

---

## 💾 数据持久化说明

### 数据存储位置

VaultBot 使用 Docker 数据卷持久化数据：

- **pgdata**: PostgreSQL 数据库数据（用户、资产、事件等）
- **redisdata**: Redis 缓存和队列数据

### 数据卷管理

```bash
# 查看数据卷
docker volume ls | grep vaultbot

# 查看数据卷详情
docker volume inspect vaultbot_pgdata

# 备份数据库
docker compose exec postgres pg_dump -U vaultbot vaultbot > backup_$(date +%Y%m%d_%H%M%S).sql

# 恢复数据库
docker compose exec -T postgres psql -U vaultbot vaultbot < backup_file.sql
```

### 重要数据表

- **TenantUser**: 用户信息（包含 `createdAt` 用于计算激活天数）
- **Event**: 用户行为事件（访问、打开、点赞等）
- **Asset**: 资产数据
- **AssetReplica**: 文件副本信息

---

## ⚠️ 注意事项

### 1. 数据持久化

**关键**：用户的激活天数基于 `TenantUser.createdAt` 字段计算。如果数据库被重置，所有用户的激活天数会重置为 1 天。

**避免数据丢失**：
- ✅ 使用 `docker compose up -d --build` 更新
- ✅ 使用 `docker compose down` 停止服务（不带 -v）
- ❌ 永远不要使用 `docker compose down -v`
- ❌ 不要手动删除数据卷

### 2. 定期备份

建议设置定时任务每天备份数据库：

```bash
# 编辑 crontab
crontab -e

# 添加每天凌晨 2 点备份
0 2 * * * cd /path/to/vaultbot && docker compose exec -T postgres pg_dump -U vaultbot vaultbot > /path/to/backups/vaultbot_$(date +\%Y\%m\%d).sql
```

### 3. 端口配置

确保配置的端口不与其他服务冲突。默认端口：
- HTTP API: 3000（可在 docker-compose.yml 中修改映射）
- PostgreSQL: 5432（仅容器内部）
- Redis: 6379（仅容器内部）

### 4. 环境变量安全

- `.env` 文件包含敏感信息，不要提交到 Git
- 确保 `.env` 文件权限为 600：`chmod 600 .env`
- 定期轮换 Bot Token 和其他密钥

---

## 🔧 故障排查

### 服务无法启动

```bash
# 查看详细日志
docker compose logs app
docker compose logs worker

# 检查配置
docker compose config

# 重启服务
docker compose restart
```

### 数据库连接失败

```bash
# 检查数据库容器状态
docker compose ps postgres

# 进入数据库容器
docker compose exec postgres psql -U vaultbot -d vaultbot

# 查看数据库日志
docker compose logs postgres
```

### Bot 无响应

```bash
# 查看 app 日志
docker compose logs -f app

# 重启 app 服务
docker compose restart app
```

### 检查数据持久化

```bash
# 查看用户数据
docker compose exec postgres psql -U vaultbot -d vaultbot -c "SELECT \"tgUserId\", \"createdAt\", \"lastSeenAt\" FROM \"TenantUser\" LIMIT 10;"
```

---

## 📚 相关文档

- [README.md](./README.md) - 项目介绍
- [docker-compose.yml](./docker-compose.yml) - 服务配置
- [prisma/schema.prisma](./prisma/schema.prisma) - 数据库结构

---

## 🆘 获取帮助

如遇问题，请检查：
1. 服务日志：`docker compose logs -f`
2. 数据卷状态：`docker volume ls`
3. 容器状态：`docker compose ps`

**记住**：更新代码时永远不要使用 `docker compose down -v`！

