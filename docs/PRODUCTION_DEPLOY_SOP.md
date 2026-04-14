# 生产部署 SOP

## 目标

这份 SOP 用于固化生产环境部署流程，避免在发布过程中：

- 覆盖生产机自定义 `docker-compose.yml`
- 忘记备份 `.env`
- 忘记备份数据库
- 直接在脏工作区上拉代码
- 发布后不做健康检查

## 推荐脚本

使用：

```bash
chmod +x scripts/deploy-production.sh
./scripts/deploy-production.sh /root/vaultbot origin/codex-simplify-single-owner
```

## 脚本行为

脚本会按顺序执行：

1. 备份 `.env`
2. 备份 `docker-compose.yml`
3. 备份 PostgreSQL
4. 执行 tenant 预检
5. 拉取目标分支
6. 默认恢复生产机原有 `docker-compose.yml`
7. `docker compose up -d --build`
8. 对 `/health/ready` 做健康检查

## 默认参数

- 目标目录：`/root/vaultbot`
- 目标代码：`origin/main`
- 健康检查地址：`http://127.0.0.1:3002/health/ready`
- 默认保留生产 `docker-compose.yml`

## 可用环境变量

- `KEEP_COMPOSE=1`
  - 默认值
  - 表示部署后恢复生产机原有 `docker-compose.yml`

- `KEEP_COMPOSE=0`
  - 表示使用仓库中的 `docker-compose.yml`
  - 只有在你明确想覆盖生产 compose 时才使用

- `HEALTH_URL`
  - 自定义健康检查地址

- `BACKUP_DIR`
  - 自定义备份目录

- `POSTGRES_CONTAINER`
  - 自定义 Postgres 容器名

- `POSTGRES_USER`
  - 自定义数据库用户

- `POSTGRES_DB`
  - 自定义数据库名

## 生产建议

- `.env` 权限建议 `600`
- 不要把 `.env` 设成 `777`
- 保持：
  - `SINGLE_OWNER_MODE=1`
  - `EXPECTED_TENANT_CODE=<生产 tenant code>`
  - `REQUIRE_EXISTING_TENANT=1`
  - `ALLOW_TENANT_CODE_MISMATCH=`
  - `SINGLE_OWNER_ALLOW_TENANT_BOOTSTRAP=`

## 发布后检查

至少检查：

1. `docker compose ps`
2. `/health/ready`
3. 旧 `shareCode` 打开
4. 新上传作品
5. 搜索
6. 标签
7. 推送

## 回滚建议

如果新版本异常：

1. 保留当前日志
2. 用备份的 `.env` 恢复配置
3. 用备份的 `docker-compose.yml` 恢复生产定制
4. 回退到上一个稳定 commit
5. 如有必要，用 SQL 备份回滚数据库
