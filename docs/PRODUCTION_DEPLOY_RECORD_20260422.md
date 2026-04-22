# 生产发布记录 - 2026-04-22

## 发布目标

- 项目：`vaultbot`
- 仓库：`https://github.com/DiDuMi/vaultbot`
- 生产主机：`72.60.208.20`
- 生产路径：`/root/vaultbot`
- 发布分支：`codex-simplify-single-owner`

## 本次版本信息

- `package.json` 版本：`0.1.0`
- 发布日期：`2026-04-22`
- 发布前本地基线 commit：`97a7bbc`
- 发布后 commit：待填写

## 本次发布范围

- 去租户模式重构继续推进到 `project-first`
- Bot 主入口、共享 core、composition 已迁到 `src/bot/project/*`
- `src/bot/tenant/*` 进一步收缩为兼容层
- worker / admin / discovery / storage / upload 继续补齐 `projectId` 双写与 fallback
- 测试默认主语进一步切到 `project`

## 生产配置留档

发布前需要记录以下文件或内容：

- `/root/vaultbot/.env`
- `/root/vaultbot/docker-compose.yml`
- `git rev-parse HEAD`
- `git branch --show-current`
- `docker compose ps`
- `docker image ls` 中当前项目相关镜像标签

建议把以上信息记录到：

- `/root/vaultbot/backups/deploy_20260422_<timestamp>/`

## 生产配置关注项

重点核对以下环境变量：

- `BOT_TOKEN`
- `TENANT_CODE`
- `TENANT_NAME`
- `SINGLE_OWNER_MODE`
- `SINGLE_OWNER_ALLOW_TENANT_BOOTSTRAP`
- `EXPECTED_TENANT_CODE`
- `REQUIRE_EXISTING_TENANT`
- `ALLOW_TENANT_CODE_MISMATCH`
- `OPS_TOKEN`
- `VAULT_CHAT_ID`
- `VAULT_THREAD_ID`

推荐目标值：

- `SINGLE_OWNER_MODE=1`
- `REQUIRE_EXISTING_TENANT=1`
- `SINGLE_OWNER_ALLOW_TENANT_BOOTSTRAP=` 保持为空
- `ALLOW_TENANT_CODE_MISMATCH=` 保持为空

## 数据备份要求

发布前必须完成：

- 备份生产 `.env`
- 备份生产 `docker-compose.yml`
- 备份 PostgreSQL 数据库
- 记录备份文件名、时间戳、备份路径

推荐备份输出：

- `.env.backup_<timestamp>`
- `docker-compose.yml.backup_<timestamp>`
- `backup_<timestamp>.sql`

## 发布后验证

至少验证：

- `docker compose ps`
- `http://127.0.0.1:3002/health/ready`
- `/ops/project-check`
- Bot `/start`
- 旧 `shareCode` 打开
- 搜索 / 标签 / 列表
- 新上传内容
- worker 正常复制

## 发布结果

- 生产快照状态：已存在
- 配置文件留档：待执行
- 数据备份：待执行
- 代码推送：待执行
- 生产部署：待执行
- 验收结果：待执行
