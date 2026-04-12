# 修改与迭代注意事项（生产运营不中断）

本文用于指导在生产环境持续迭代本项目时，如何避免“设置/数据被重置”、如何安全发布与回滚，以及常见故障排查路径。

## 1. 先明确：什么会导致“看起来像重置”

本项目的“隐藏发布者”“内容保护”“排行开放”等配置，存储在数据库 `TenantSetting` 表中，并按 `tenantId` 隔离。出现“迭代后设置全没了/恢复默认”的常见原因只有两类：

- 连接到了空库/新库（例如 Docker volume 变了、容器磁盘是临时的、DATABASE_URL 指向了新的实例）
- `TENANT_CODE` 变了（或丢失/被覆盖），应用创建了一个新的租户，于是读取到“新租户的空设置”

结论：绝大多数“重置”并不是代码清空了设置，而是租户或数据库发生了切换。

## 2. 生产环境必配的租户保护开关

在生产环境，为了“宁可启动失败，也不要悄悄写入新租户/新库”，建议长期固定以下环境变量：

- `TENANT_CODE`：生产租户 code（必须稳定）
- `TENANT_NAME`：租户名称（可改，但不建议频繁改）
- `EXPECTED_TENANT_CODE`：期望的租户 code（用于防止配置漂移）
- `REQUIRE_EXISTING_TENANT=1`：要求数据库中必须已经存在租户数据，否则阻止启动（防止连到空库/新库）
- `ALLOW_TENANT_CODE_MISMATCH=`：生产环境不要开启（仅在“明确要创建新租户”的那一次临时设为 `1`）

配套说明：

- 应用启动会校验 `TENANT_CODE` 与 `EXPECTED_TENANT_CODE` 一致，否则直接报错退出。
- 当数据库里还没有任何租户记录时，若 `REQUIRE_EXISTING_TENANT=1`，将直接阻止启动，避免在“空库”上自动创建租户导致“统计归零/设置丢失”的错觉。

## 3. 新库/灾备恢复时的“设置自举”（可选）

某些场景你可能需要从空库启动（例如灾备演练、首次部署），此时你可以选择：

- 临时关闭 `REQUIRE_EXISTING_TENANT` 或开启 `ALLOW_TENANT_CODE_MISMATCH=1` 放行创建租户
- 同时用以下变量为新租户“补默认设置”（仅补缺，不覆盖你已配置过的值）

可选变量（设为 `1/true/yes/on` 任一即可）：

- `TENANT_BOOTSTRAP_HIDE_PUBLISHER_ENABLED`
- `TENANT_BOOTSTRAP_PROTECT_CONTENT_ENABLED`
- `TENANT_BOOTSTRAP_PUBLIC_RANKING_ENABLED`
- `TENANT_BOOTSTRAP_AUTO_CATEGORIZE_ENABLED`

建议策略：

- 生产长期不启用自举变量；只有在“明确从空库恢复/首次初始化”时临时使用。

## 4. Docker/数据卷注意事项（最容易踩坑）

如果你是用 `docker compose` 部署：

- 不要执行 `docker compose down -v`（会删除 PostgreSQL 的持久化 volume，等价于换新库）
- 不要在不同目录反复启动同一套服务（volume 名常与 compose project name 相关，目录变化可能导致 volume 变化）
- 建议固定 project name，例如使用 `docker compose -p vaultbot up -d`，确保 volume 恒定
- 生产数据库务必使用持久化磁盘（云平台要确认卷不随容器重建而丢失）

## 5. 迭代发布流程（建议 SOP）

### 5.1 发布前（必须）

- 确认 `.env`/环境变量未漂移：
  - `TENANT_CODE` 与 `EXPECTED_TENANT_CODE` 一致
  - `REQUIRE_EXISTING_TENANT=1`（长期保持）
  - `ALLOW_TENANT_CODE_MISMATCH` 未开启
- 在目标环境运行租户预检（推荐）：
  - `npm run preflight:tenant`
- 确认数据库可备份：
  - 至少做一次逻辑备份（SQL dump）或快照备份

### 5.2 发布时

- 使用不可变版本的镜像或 tag（避免“latest 漂移”导致不可控）
- 确保 `app` 与 `worker` 使用同一份环境变量（尤其是 TENANT_CODE/DATABASE_URL）
- 迁移策略：
  - 容器入口会执行 `prisma migrate deploy`（需要 `DATABASE_URL`）
  - 生产环境不要使用 `prisma migrate dev`（它是开发用途）

### 5.3 发布后（必须）

- 健康检查：
  - `/health/ready` 返回 ok
- 租户检查（推荐开启 `OPS_TOKEN` 后使用）：
  - `/ops/tenant-check` 确认当前 `TENANT_CODE` 命中数据库中的同名租户，且数据量不是 0
- 抽检关键设置是否仍然生效：
  - “隐藏发布者”“内容保护”等页面/交付行为符合预期

## 6. 回滚策略

建议按“数据库迁移是否可逆”分两类：

- 仅代码变更（无迁移 / 向后兼容迁移）
  - 直接回滚到上一个镜像版本即可
- 含破坏性迁移（字段删除/重命名、约束大改）
  - 不建议在未设计回滚脚本的情况下直接回滚代码
  - 建议先做“兼容性迁移”（新增字段/双写/灰度），确认稳定后再清理旧字段

最低要求：

- 生产发布前保留上一版本镜像与配置快照
- 生产发布前做数据库备份/快照

## 7. 常见问题排查（按优先级）

### 7.1 设置又“重置”了

按顺序检查：

- 是否连到了同一个数据库（DATABASE_URL 是否变化、Postgres 是否被重建、volume 是否变化）
- `TENANT_CODE` 是否变化/为空/拼写不一致
- 是否误开了 `ALLOW_TENANT_CODE_MISMATCH=1`
- 是否触发了“新租户创建”
  - 若开启了 `OPS_TOKEN`，用 `/ops/tenant-check` 查看库里租户列表与当前命中情况

### 7.2 交付提示副本写入中/一直 pending

- 确认 worker 是否在运行（生产必须运行 worker）
- 确认 Redis 可用（或本地测试才用 `REDIS_URL=memory`）
- 检查存储群数量与 `minReplicas` 的关系

## 8. 修改代码时的约束（避免引入跨租户/数据灾难）

- 所有业务表基本都带 `tenantId`：新增查询/统计时，默认必须带 `tenantId` 过滤
- 改动 `TENANT_CODE`/租户创建逻辑属于高风险变更：生产环境不要默认放行新租户
- 涉及 Prisma schema 变更：
  - 必须生成迁移并在测试库跑通
  - 尽量采用向后兼容迁移策略（先加字段再切流再删旧字段）

## 9. 下一步开发建议

- 增加“租户设置导出/导入”运维命令（TenantSetting JSON），用于迁移与灾备恢复
- 增加“启动时打印关键配置摘要（脱敏）”与“租户命中信息”，降低排障成本
- 生产发布流程固化为脚本：预检 → 备份 → 发布 → 健康检查 → 租户检查 → 抽检设置

