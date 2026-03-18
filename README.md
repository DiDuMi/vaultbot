# vaultbot

Vault 存取：基于 Telegram 的多租户内容存储与交付系统（媒体仅存 Telegram，索引与行为数据落库）。

## 运行依赖
- Node.js 20+
- PostgreSQL 16+
- Redis 7+

## 环境变量
参考 [.env.example](file:///e:/MU/chucun/.env.example)。

必填：
- `BOT_TOKEN`
- `TENANT_CODE`
- `TENANT_NAME`
- `VAULT_CHAT_ID`
- `DATABASE_URL`
- `REDIS_URL`

可选：
- `VAULT_THREAD_ID`
- `WEBHOOK_BASE_URL`
- `WEBHOOK_PATH`
- `WEBHOOK_SECRET`

## 容灾与多副本（主/备存储群）
本项目的媒体文件存储在 Telegram（Vault Group）内，数据库仅保存定位信息。因此容灾核心是：
- 入口容灾：主/备 Bot（不同 BOT_TOKEN）共享同一套后端数据库
- 内容容灾：主/备存储群（Vault Group）多副本写入 + 交付降级

关键说明：
- `VAULT_CHAT_ID` 用作“首次初始化主存储群”的兜底值；后续以数据库里的租户配置为准（可在 Bot 内修改主/备存储群）。
- 必须运行 Worker：副本写入、补副本、推送等后台能力都在 worker 进程执行。

租户侧配置入口：
- 进入 Bot：`⚙️ 设置` → `🗄 存储群`
- 可配置项：
  - 添加/移除备份存储群
  - 切换主存储群
  - 标记存储群状态（正常/降级/封禁）
  - 设置 `minReplicas`（最小成功副本数，1/2/3）

行为策略：
- 多副本写入：新上传会写入主群 + 所有未封禁备群（受限流影响可能需要时间）。
- 自动补副本：新增备群后，worker 会后台扫描历史内容并逐步补齐副本，直到满足 `minReplicas`。
- 交付降级：优先使用 `fileId` 直发；需要 `copyMessage` 且出现永久失败（如 400/403）会把该副本标记为坏副本，后续自动避开。

## Bot 主/备部署建议
若需要 Bot 被封禁时仍可快速恢复入口：
- 准备主/备两套 Bot（两个 `BOT_TOKEN`），分别部署两套 app（或同机不同端口/不同 webhook path）。
- 两套 app 共享同一 `DATABASE_URL/REDIS_URL`（共享租户数据与副本索引）。
- 主/备 Bot 都需要加入所有存储群并授予管理员权限（能发消息/复制消息/创建话题）。

## 本地开发
1) 安装依赖

```bash
npm ci
```

2) 生成 Prisma Client

```bash
npm run prisma:generate
```

3) 迁移数据库（开发环境）

```bash
npm run prisma:migrate
```

4) 启动

```bash
npm run dev
npm run worker
```

## 测试与构建

```bash
npm run test
npm run typecheck
npm run build
```

## Docker 生产部署（/root/vaultbot）
1) 拉取代码

```bash
cd /root
git clone https://github.com/DiDuMi/vaultbot.git
cd /root/vaultbot
```

2) 创建 `/root/vaultbot/.env`（不要提交到仓库）

```bash
cp .env.example .env
chmod 600 .env
```

3) 启动（包含 Postgres/Redis/App/Worker）

```bash
chmod +x scripts/deploy-docker.sh
./scripts/deploy-docker.sh /root/vaultbot
```

4) 查看状态与日志

```bash
docker compose ps
docker compose logs -f app
docker compose logs -f worker
```

说明：
- `scripts/docker-entrypoint.sh` 会在容器启动时执行 `prisma migrate deploy`（需要 `DATABASE_URL`）。
- `docker-compose.yml` 已内置容器内的 `DATABASE_URL/REDIS_URL` 指向，不需要在 `.env` 再设置它们。
