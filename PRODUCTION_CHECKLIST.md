# 生产环境部署检查清单

## 部署前检查

### 1. 环境准备
- [ ] 服务器已安装 Docker (>= 20.x)
- [ ] 服务器已安装 Docker Compose (>= 2.x)
- [ ] 服务器有足够的磁盘空间（建议 >= 20GB）
- [ ] 服务器有足够的内存（建议 >= 2GB）

### 2. Telegram Bot 配置
- [ ] 已从 @BotFather 创建 Bot 并获取 BOT_TOKEN
- [ ] （可选）已创建备用 Bot 并获取备用 BOT_TOKEN（主/备 Bot 共享同一后端数据库）
- [ ] 已创建 Telegram 群组或频道用于存储媒体
- [ ] 已将 Bot（主/备）添加到所有存储群组并设为管理员（能发消息/复制消息/创建话题）
- [ ] 已获取 VAULT_CHAT_ID（群组 ID）
- [ ] 如果使用话题功能，已获取 VAULT_THREAD_ID

### 3. 环境变量配置
- [ ] 已复制 .env.example 到 .env
- [ ] 已配置 BOT_TOKEN
- [ ] 已配置 VAULT_CHAT_ID
- [ ] 已配置 TENANT_CODE 和 TENANT_NAME
- [ ] 已设置 .env 文件权限为 600

### 4. 网络配置（如果使用 Webhook）
- [ ] 已配置域名和 DNS
- [ ] 已配置 SSL/TLS 证书
- [ ] 已配置反向代理（Nginx/Caddy）
- [ ] 已配置 WEBHOOK_BASE_URL
- [ ] 已配置 WEBHOOK_SECRET

## 部署步骤

### 1. 克隆代码
```bash
cd /home/ubuntu
git clone https://github.com/DiDuMi/vaultbot.git
cd vaultbot
```

### 2. 配置环境变量
```bash
cp .env.example .env
chmod 600 .env
nano .env  # 或使用 vim
```

### 3. 启动服务
```bash
# 方式 1: 使用快速部署脚本
./QUICK_DEPLOY.sh

# 方式 2: 使用 docker-compose
docker compose up -d --build
```

### 4. 验证部署
```bash
# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f app
docker compose logs -f worker

# 检查数据库连接
docker compose exec app npx prisma db pull
```

## 部署后检查

### 1. 服务健康检查
- [ ] app 容器运行正常
- [ ] worker 容器运行正常
- [ ] postgres 容器运行正常
- [ ] redis 容器运行正常
- [ ] 无错误日志

### 2. 功能测试
- [ ] Bot 可以响应 /start 命令
- [ ] 可以上传媒体文件
- [ ] 可以搜索和浏览内容
- [ ] 权限控制正常工作
- [ ] 租户可进入 `⚙️ 设置` → `🗄 存储群` 配置主/备群与 `minReplicas`
- [ ] 新增备份存储群后，Worker 会自动补副本（等待一段时间后可正常交付）

### 3. 性能检查
- [ ] 响应时间正常（< 1s）
- [ ] 内存使用正常
- [ ] CPU 使用正常
- [ ] 磁盘空间充足

## 监控和维护

### 1. 日志管理
```bash
# 查看实时日志
docker compose logs -f

# 查看特定服务日志
docker compose logs -f app
docker compose logs -f worker

# 查看最近 100 行日志
docker compose logs --tail=100
```

### 2. 数据备份
```bash
# 备份 PostgreSQL
docker compose exec postgres pg_dump -U vaultbot vaultbot > backup_$(date +%Y%m%d).sql

# 备份 Redis
docker compose exec redis redis-cli SAVE
docker compose cp redis:/data/dump.rdb ./backup_redis_$(date +%Y%m%d).rdb
```

### 3. 更新部署
```bash
# 拉取最新代码
git pull

# 重新构建并启动
docker compose up -d --build

# 查看日志确认更新成功
docker compose logs -f
```

### 4. 故障排查
```bash
# 重启服务
docker compose restart

# 重启特定服务
docker compose restart app
docker compose restart worker

# 查看容器详细信息
docker compose ps -a
docker inspect <container_id>

# 进入容器调试
docker compose exec app sh
docker compose exec postgres psql -U vaultbot
docker compose exec redis redis-cli
```

## 安全加固

### 1. 系统安全
- [ ] 配置防火墙规则
- [ ] 禁用不必要的端口
- [ ] 配置 SSH 密钥认证
- [ ] 定期更新系统补丁

### 2. 应用安全
- [ ] 使用强密码
- [ ] 定期更新依赖包
- [ ] 配置 WEBHOOK_SECRET
- [ ] 限制 API 访问

### 3. 数据安全
- [ ] 定期备份数据库
- [ ] 加密敏感数据
- [ ] 配置数据保留策略
- [ ] 监控异常访问

## 性能优化

### 1. 数据库优化
- [ ] 配置连接池
- [ ] 添加必要的索引
- [ ] 定期清理过期数据
- [ ] 监控慢查询

### 2. 缓存优化
- [ ] 配置 Redis 最大内存
- [ ] 配置淘汰策略
- [ ] 监控缓存命中率

### 3. 应用优化
- [ ] 配置 Node.js 内存限制
- [ ] 启用 PM2 或集群模式（如需要）
- [ ] 配置日志轮转

## 监控指标

### 关键指标
- 服务可用性 (uptime)
- 响应时间 (response time)
- 错误率 (error rate)
- 内存使用率 (memory usage)
- CPU 使用率 (cpu usage)
- 磁盘使用率 (disk usage)
- 数据库连接数 (db connections)
- Redis 内存使用 (redis memory)

### 告警设置
- 服务宕机告警
- 错误率超过阈值
- 内存使用超过 80%
- 磁盘使用超过 80%
- 数据库连接池耗尽

## 常见问题

### Q: Bot 无法响应
A: 检查 BOT_TOKEN 是否正确，查看 app 日志

### Q: 无法连接数据库
A: 检查 postgres 容器是否运行，查看 DATABASE_URL 配置

### Q: 上传失败
A: 检查 VAULT_CHAT_ID 是否正确，Bot 是否有管理员权限

### Q: Worker 不工作
A: 检查 Redis 连接，查看 worker 日志

### Q: 内存占用过高
A: 检查是否有内存泄漏，考虑增加服务器内存或优化代码

## 联系支持

如遇到问题，请查看：
- 项目文档：README.md
- 部署检查报告：DEPLOYMENT_CHECK.md
- GitHub Issues：https://github.com/DiDuMi/vaultbot/issues

