# 修改与迭代注意事项（生产运营不中断）

本文用于指导在生产环境持续迭代本项目时，如何避免“设置/数据被重置”、如何安全发布与回滚，以及常见故障排查路径。

## 1. 先明确：什么会导致“看起来像重置”

本项目的“隐藏发布者”“内容保护”“排行开放”等配置，存储在数据库 `TenantSetting` 表中，并按 `tenantId` 隔离。出现“迭代后设置全没了/恢复默认”的常见原因只有两类：

- 连接到了空库/新库（例如 Docker volume 变了、容器磁盘是临时的、DATABASE_URL 指向了新的实例）
- `PROJECT_CODE` 变了（或丢失/被覆盖；未设置时会回退到 legacy `TENANT_CODE`），应用创建了一个新的租户，于是读取到“新租户的空设置”

结论：绝大多数“重置”并不是代码清空了设置，而是租户或数据库发生了切换。

## 2. 生产环境必配的租户保护开关

在生产环境，为了“宁可启动失败，也不要悄悄写入新租户/新库”，建议长期固定以下环境变量：

- `PROJECT_CODE`：生产 project code（必须稳定；若未设置则回退到 legacy `TENANT_CODE`）
- `PROJECT_NAME`：project 名称（可改，但不建议频繁改；若未设置则回退到 legacy `TENANT_NAME`）
- `EXPECTED_TENANT_CODE`：期望的租户 code（用于防止配置漂移）
- `REQUIRE_EXISTING_TENANT=1`：要求数据库中必须已经存在租户数据，否则阻止启动（防止连到空库/新库）
- `ALLOW_TENANT_CODE_MISMATCH=`：生产环境不要开启（仅在“明确要创建新租户”的那一次临时设为 `1`）

配套说明：

- 应用启动会校验 `PROJECT_CODE`（或 legacy `TENANT_CODE`）与 `EXPECTED_TENANT_CODE` 一致，否则直接报错退出。
- 当数据库里还没有任何租户记录时，若 `REQUIRE_EXISTING_TENANT=1`，将直接阻止启动，避免在“空库”上自动创建租户导致“统计归零/设置丢失”的错觉。

## 3. 新库/灾备恢复时的“设置自举”（可选）

某些场景你可能需要从空库启动（例如灾备演练、首次部署），此时你可以选择：

- 临时关闭 `REQUIRE_EXISTING_TENANT` 或开启 `ALLOW_TENANT_CODE_MISMATCH=1` 放行创建租户
- 同时用以下变量为新租户“补默认设置”（仅补缺，不覆盖你已配置过的值）

可选变量（设为 `1/true/yes/on` 任一即可；优先使用 `PROJECT_BOOTSTRAP_*`，并兼容 legacy `TENANT_BOOTSTRAP_*`）：

- `PROJECT_BOOTSTRAP_HIDE_PUBLISHER_ENABLED`
- `PROJECT_BOOTSTRAP_PROTECT_CONTENT_ENABLED`
- `PROJECT_BOOTSTRAP_PUBLIC_RANKING_ENABLED`
- `PROJECT_BOOTSTRAP_AUTO_CATEGORIZE_ENABLED`
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
  - `PROJECT_CODE`（或 legacy `TENANT_CODE`）与 `EXPECTED_TENANT_CODE` 一致
  - `REQUIRE_EXISTING_TENANT=1`（长期保持）
  - `ALLOW_TENANT_CODE_MISMATCH` 未开启
- 在目标环境运行租户预检（推荐）：
  - `npm run preflight:tenant`
- 确认数据库可备份：
  - 至少做一次逻辑备份（SQL dump）或快照备份

### 5.2 发布时

- 使用不可变版本的镜像或 tag（避免“latest 漂移”导致不可控）
- 确保 `app` 与 `worker` 使用同一份环境变量（尤其是 PROJECT_CODE/TENANT_CODE/DATABASE_URL）
- 迁移策略：
  - 容器入口会执行 `prisma migrate deploy`（需要 `DATABASE_URL`）
  - 生产环境不要使用 `prisma migrate dev`（它是开发用途）

### 5.3 发布后（必须）

- 健康检查：
  - `/health/ready` 返回 ok
- 租户检查（推荐开启 `OPS_TOKEN` 后使用）：
  - `/ops/tenant-check` 确认当前 `PROJECT_CODE`（或 legacy `TENANT_CODE`）命中数据库中的同名租户，且数据量不是 0
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
- `PROJECT_CODE`（或 legacy `TENANT_CODE`）是否变化/为空/拼写不一致
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

## 2026-04-19 - 统计与排行接口 project 化

### 本轮目标

- 选择阶段 2 的低风险小步长，先收口统计与排行接口的外层语义
- 避开 `src/bot/tenant/*` 中与本轮无关的未提交改动，只处理可独立验收的统计入口
- 保留历史 `tenant-*` 兼容路径，不做 schema 迁移、不改生产配置

### 实际改动

- 梳理了本轮涉及模块与原因：
  - `src/services/use-cases/delivery-stats.ts`：统计/排行实现较封闭，适合先引入 `project` 主入口
  - `src/services/use-cases/delivery.ts`：统一补齐 `DeliveryStatsService` 的 `project-*` 对外接口
  - `src/bot/tenant/renderers.ts`：将统计页、排行页、设置页中的统计读取切换到 `project-*` 接口，减少上层继续扩散 `tenant` 语义
  - `src/tests/run.ts`：补齐渲染器测试桩，覆盖新的 `project` 统计入口
- 在 `delivery-stats.ts` 中新增以下 `project` 主入口，并保留同名 `tenant` 兼容别名：
  - `getProjectHomeStats`
  - `getProjectStats`
  - `getProjectRanking`
  - `getProjectLikeRanking`
  - `getProjectVisitRanking`
  - `getProjectCommentRanking`
- 在 `delivery.ts` 中将统计服务类型改为 `project` 优先、`tenant` 兼容并存，并补充复用的统计类型定义，减少重复声明
- 在 `renderers.ts` 中将以下调用切到 `project` 语义：
  - `getProjectStats`
  - `getProjectRanking`
  - `getProjectLikeRanking`
  - `getProjectVisitRanking`
  - `getProjectCommentRanking`
  - `getProjectHomeStats`

### 已验证内容

- `npm run test` 通过：`63/63 passed`
- `npm run build` 通过：`tsc -p tsconfig.json`
- 验证结论：
  - 统计与排行的对外调用已可优先使用 `project-*`
  - 历史 `tenant-*` 接口仍保留，兼容路径未删除
  - 本轮未触碰 schema、迁移脚本、生产环境配置

### 未解决问题

- `delivery` 服务层仍有大量 `tenant-*` 接口残留，尤其是 admin、vault、discovery、social 等模块
- 运行时核心上下文仍以 `getTenantId()` 为底层命中方式，尚未形成统一 `project context`
- `src/bot/tenant/*` 目录命名仍是历史兼容形态，本轮未处理目录级收缩

### 风险与观察

- 本轮改动面集中在服务接口与渲染调用，风险较低，适合作为阶段 2 的独立验收步长
- `src/bot/tenant/renderers.ts` 存在用户未提交改动，但与本轮统计接口切换区域不冲突；已在不回退现有改动的前提下增量处理
- 目前最稳妥的推进方式仍是“上层先切 `project-*`，底层继续保留 `tenantId` 命中逻辑”，避免过早触碰 schema 与迁移

### 下一轮建议

- 继续选择单模块、小范围的服务层接口收口，优先处理同样封闭且易验收的 `preferences` 或 `stats/discovery` 相邻接口
- 在不改变数据库结构的前提下，逐步让 Bot/UI 新增调用默认只依赖 `project-*`
- 如进入阶段 1 收口，可单独评估是否为 `getTenantId()` 增加更明确的 `project context` 包装层，但不要与大规模命名调整混在同一轮

## 2026-04-19 - 历史列表 discovery project 化

### 本轮目标

- 选择阶段 2 的低风险小步长，先收口社区历史列表使用的 discovery 批次查询入口
- 保留 `tenant-*` 兼容路径，只为上层新增 `project-*` 主入口，不触碰 schema、迁移脚本和生产配置
- 避开 `src/bot/tenant/*` 中与本轮无关的未提交改动，仅处理历史列表渲染链路

### 实际改动

- 梳理了本轮涉及模块与原因：
  - `src/services/use-cases/delivery-discovery.ts`：社区历史列表依赖的批次列表查询较封闭，适合新增 `project` 主入口并保留 `tenant` 别名
  - `src/services/use-cases/delivery.ts`：为 `DeliveryDiscoveryService` 补齐 `listProjectBatches` 类型与聚合导出，避免上层继续显式依赖 `tenant` 语义
  - `src/bot/tenant/history.ts`：将“社区发布”历史列表调用切到 `listProjectBatches`
  - `src/tests/run.ts`：将对应 discovery 用例切到 `project` 主入口，验证公开访客过滤逻辑不变
- 在 `delivery-discovery.ts` 中新增 `listProjectBatches`，实现上直接复用现有 `listTenantBatches`，维持兼容路径不变
- 在 `delivery.ts` 中为 discovery 服务暴露 `listProjectBatches`，让上层可以默认按 `project-*` 语义接入
- 在 `history.ts` 中仅将社区历史列表分支改为调用 `listProjectBatches`；“我的发布”仍继续使用原有 `listUserBatches`

### 已验证内容

- `npm run test` 通过：`63/63 passed`
- `npm run build` 通过：`tsc -p tsconfig.json`
- 验证结论：
  - 社区历史列表的上层调用已可优先使用 `project-*`
  - 历史 `listTenantBatches` 兼容入口仍保留，行为未删除
  - 本轮未触碰 schema、迁移脚本、生产环境配置和底层 `tenantId` 命中逻辑

### 未解决问题

- `delivery` 服务层仍存在其他 discovery/admin/core 接口直接暴露 `tenant-*` 语义
- `src/bot/tenant/history.ts` 文件所在目录仍是历史兼容命名，本轮未处理目录级收缩
- 运行时核心上下文仍依赖 `getTenantId()`，尚未形成统一 `project context`

### 风险与观察

- 本轮仅增加别名并切换单一调用点，改动面较小，适合作为阶段 2 的独立验收步长
- `src/bot/tenant/*`、`src/services/use-cases/delivery.ts` 当前存在既有未提交改动；本轮仅在相关区域增量修改，未回退其他变更
- 继续沿用“上层优先切 `project-*`、底层保留 `tenantId` 兼容实现”的策略，仍是当前最稳妥路线

### 下一轮建议

- 继续在 discovery 相邻接口中收口 `tenant-*` 命名，优先评估 `getTenantSearchMode` 的上层调用切换或批次相关剩余调用点
- 若继续处理 Bot/UI，优先选择单页面、单调用链的 `project-*` 替换，避免与目录命名调整混在同一轮
- 在进入阶段 1 前，可单独评估是否为运行时上下文提供 `project context` 包装，但不要与服务层收口并行推进

## 2026-04-19 - 标签旧入口去重

### 本轮目标

- 选择阶段 2 的低风险小步长，清理 Bot 上层标签链路中未使用的旧实现，减少 `tenant` 语义残留
- 不修改活跃标签模块的行为，不触碰 schema、迁移脚本、生产配置和运行时上下文
- 避开当前工作区中与本轮无关的既有改动，只处理可独立验收的标签入口收口

### 实际改动

- 梳理了本轮涉及模块与原因：
  - `src/bot/tenant/index.ts`：保留了一组本地标签渲染旧实现，但实际装配已经改走 `src/bot/tenant/tags.ts`；继续留着会让上层残留死代码和旧 `tenant` 读取
  - `src/tests/run.ts`：补一个针对活跃标签渲染器的小测试，锁定它优先读取 `getProjectSearchMode`
- 在 `index.ts` 中删除未使用的旧标签实现：
  - `buildTagAssetsKeyboard`
  - `buildTagIndexKeyboard`
  - 本地 `renderTagIndex`
  - 本地 `renderTagAssets`
- 保持 `createTagRenderers()` 作为标签页唯一上层入口，不改变当前回调装配和实际用户路径
- 在 `run.ts` 中新增 `tags: renderTagIndex prefers project search mode` 测试，若误回退到 `getTenantSearchMode` 会直接失败

### 已验证内容

- `npm run test` 通过：`64/64 passed`
- `npm run build` 通过：`tsc -p tsconfig.json`
- 验证结论：
  - 标签链路的活跃上层入口仍为 `project-*` 语义
  - 本轮仅删除未使用旧实现，未影响现有兼容路径与主业务链路
  - 本轮未触碰 schema、迁移脚本、生产环境配置和底层 `tenantId` 命中逻辑

### 未解决问题

- `delivery` 服务层与其他 Bot 模块仍有 `tenant-*` 接口和命名残留，尤其是 admin、vault、social 等区域
- 运行时核心上下文仍依赖 `getTenantId()`，尚未形成统一 `project context`
- `src/bot/tenant/*` 目录命名仍是历史兼容形态，本轮未处理目录级收缩

### 风险与观察

- 本轮改动属于死代码清理加单测补强，风险低，适合作为阶段 2 的独立验收步长
- 当前工作区仍有既有未提交改动（如 `src/bot/tenant/*`、`src/services/use-cases/delivery*.ts` 等）；本轮未回退这些改动，只在标签旧入口相关区域增量处理
- 对去租户化来说，先清掉上层未使用旧入口，再继续收口活跃调用链，比直接做大范围目录或 schema 调整更稳妥

### 下一轮建议

- 继续优先处理上层单链路、可独立验收的 `project-*` 收口，避免与运行时上下文改造并行推进
- 重点盘点其他是否仍存在“模块已迁出，但 `index.ts`/聚合层还保留旧实现”的重复代码，再做同类低风险清理
- 若继续做活跃调用链替换，可回到 `preferences`、`admin settings` 或其它尚未切完的单页面入口，但保持一次只动一个窄面

## 2026-04-19 - delivery-admin project 主入口收口

### 本轮目标

- 选择阶段 2 的低风险小步长，把 `delivery-admin` 模块里的设置读写能力改为 `project-*` 主入口
- 保留现有 `tenant-*` 兼容方法，不触碰 schema、迁移脚本、生产环境配置和运行时 `getTenantId()` 主链路
- 将改动限制在服务层和测试，避免与 `src/bot/tenant/*` 中其他未提交改动发生冲突

### 实际改动

- 梳理了本轮涉及模块与原因：
  - `src/services/use-cases/delivery-admin.ts`：欢迎词、广告配置、内容保护、隐藏发布者、自动归类、排行开放等设置逻辑集中，适合下压一层做 `project` 主入口
  - `src/services/use-cases/delivery.ts`：聚合层此前通过 `tenant-*` 方法手工映射到 `project-*`，可改为直接接线到 admin 模块的新主入口
  - `src/tests/run.ts`：补一条回归测试，锁定 admin 设置模块同时暴露 `project-*` 和 `tenant-*` 兼容接口
- 在 `delivery-admin.ts` 中将以下能力改为 `project` 主入口实现，并保留 `tenant` 别名：
  - `get/setProjectStartWelcomeHtml`
  - `get/setProjectDeliveryAdConfig`
  - `get/setProjectProtectContentEnabled`
  - `get/setProjectHidePublisherEnabled`
  - `get/setProjectAutoCategorizeEnabled`
  - `get/setProjectAutoCategorizeRules`
  - `get/setProjectPublicRankingEnabled`
- 在 `delivery.ts` 中调整 `createDeliveryAdmin()` 的解构与 `adminService` 组装，改为直接暴露上述 `project-*` 实现，而不是继续用 `tenant-*` 方法做二次映射
- 在 `run.ts` 中新增 `delivery-admin: exposes project settings aliases` 测试，验证 `project-*` 与 `tenant-*` 设置接口都保持可用

### 已验证内容

- `npm run test` 通过：`65/65 passed`
- `npm run build` 通过：`tsc -p tsconfig.json`
- 验证结论：
  - admin 设置模块已在更底层提供 `project-*` 主入口
  - 聚合层不再需要为这组设置接口重复做 `tenant -> project` 手工映射
  - 历史 `tenant-*` 兼容接口仍保留，未删除旧路径
  - 本轮未触碰 schema、迁移脚本、生产环境配置和底层 `tenantId` 命中逻辑

### 未解决问题

- `delivery-core` 里的搜索开放和副本阈值仍以 `tenant-*` 为底层实现名，聚合层继续承担 `project-*` 别名映射
- admin 模块之外，`delivery` 服务层仍有 `tenant-*` 命名残留，尤其是 tenant admin、vault、social 等区域
- 运行时核心上下文仍依赖 `getTenantId()`，尚未形成统一 `project context`

### 风险与观察

- 本轮仅收口封闭的 admin 设置模块，行为逻辑未改，只是把 `project-*` 主语下压到服务实现层，风险较低
- 当前工作区仍存在既有未提交改动；本轮只在 `delivery-admin.ts`、`delivery.ts` 和 `run.ts` 相关区域增量修改，未回退其他变更
- 继续采用“上层先稳定切 `project-*`，底层兼容别名暂存”的方式，仍是当前最稳妥路线

### 下一轮建议

- 继续选择同样封闭的服务模块，优先评估 `delivery-core` 中 `get/setProjectSearchMode` 与 `get/setProjectMinReplicas` 的实现下压
- 若继续做 admin 相关收口，可单独处理 `listTenantAdmins` 等治理接口，但保持与设置接口拆分，避免改动面扩大
- 运行时 `project context` 相关工作仍单独排期，不要与服务层命名收口并行推进

## 2026-04-19 - delivery-core project 主入口下压

### 本轮目标

- 选择阶段 2 的低风险小步长，把 `delivery-core` 中搜索模式与最小副本设置改为 `project-*` 主入口实现
- 保留 `tenant-*` 兼容方法，不触碰 schema、迁移脚本、生产环境配置和运行时 `getTenantId()` 主链路
- 将改动限制在服务层聚合、核心实现、测试与迭代文档，避免与 Bot 目录中的既有改动冲突

### 实际改动

- 梳理了本轮涉及模块与原因：
  - `src/services/use-cases/delivery-core.ts`：搜索开放与最小副本能力实现集中且封闭，适合把 `project` 主语真正下压到实现层
  - `src/services/use-cases/delivery.ts`：聚合层此前仍把 `project-*` 手工映射到 `tenant-*` 核心方法，本轮改为直接接线核心模块的新主入口
  - `src/tests/run.ts`：补一条回归测试，锁定 `delivery-core` 同时暴露 `project-*` 和 `tenant-*` 且行为一致
- 在 `delivery-core.ts` 中新增以下 `project` 主入口实现，并把历史 `tenant` 方法降为兼容别名：
  - `getProjectSearchMode`
  - `setProjectSearchMode`
  - `getProjectMinReplicas`
  - `setProjectMinReplicas`
- 保持底层 `tenantId` 命中、权限判定和设置存储逻辑不变，只调整服务实现的主语归属，避免引入行为变化
- 在 `delivery.ts` 中将 `DeliveryTenantSettingsService` 的 `project-*` 字段改为直接接线 `delivery-core` 的新主入口，而不是继续由聚合层做 `tenant -> project` 二次映射
- 在 `run.ts` 中新增 `delivery-core: exposes project-first search mode and min replica aliases` 测试，验证两套入口读取结果一致，且 `setProjectMinReplicas` 仍写入原有 `min_replicas` 设置键，并继续遵循现有 `normalizeMinReplicas` 上限为 `3` 的业务约束

### 已验证内容

- `npm run test` 通过：`66/66 passed`
- `npm run build` 通过：`tsc -p tsconfig.json`
- 验证结论：
  - `delivery-core` 已具备 `project-*` 主入口实现
  - 历史 `tenant-*` 接口仍保留为兼容别名
  - `project-*` 的最小副本写入行为与既有 `tenant-*` 路径一致，仍会归一化到 `1..3`
  - 本轮未触碰 schema、迁移脚本、生产环境配置和底层 `tenantId` 命中逻辑

### 未解决问题

- `delivery` 服务层中仍有其他模块继续以 `tenant-*` 作为底层实现名，尤其是 tenant admin、vault、social 等区域
- 运行时核心上下文仍依赖 `getTenantId()`，尚未形成统一 `project context`
- `src/bot/tenant/*` 目录命名仍是历史兼容形态，本轮未处理目录级收缩

### 风险与观察

- 本轮只下压封闭的 core 设置能力，逻辑路径未变，理论风险较低，适合作为阶段 2 的独立验收步长
- 当前工作区已有其他去租户化增量改动；本轮仅在 `delivery-core.ts`、`delivery.ts`、`run.ts` 和 `docs/ITERATION_NOTES.md` 相关区域增量处理，未回退其他改动
- 继续采用“先把上层 `project-*` 主语下压到封闭服务实现，再保留 `tenant-*` 兼容别名”的策略，仍符合 KISS/DRY
- 新增测试暴露了 `minReplicas` 会被限制在 `1..3` 的既有约束；这不是本轮回归，而是下轮若继续收口副本治理时需要显式保留的行为边界

### 下一轮建议

- 继续选择封闭且单链路的服务模块，优先评估 `preferences` 或其它仍由聚合层手工映射 `project-*` 的设置能力
- 若要处理运行时 `project context`，应单独开一轮阶段 1 收口，不要与服务层命名下压混做
- Bot/UI 侧仍应保持一次只切一条活跃调用链，避免和底层服务收口并行扩面

## 2026-04-19 - project 管理员入口收口

### 本轮目标

- 选择阶段 2 的低风险小步长，把管理员治理入口从 `tenant admin` 兼容语义补齐为 `project` 主入口
- 保留历史 `tenant-*` 兼容路径，不触碰 schema、迁移脚本、生产环境配置和运行时 `getTenantId()` 主链路
- 只切设置概览与增删管理员两条活跃调用链，避免与其他 Bot/服务层既有改动冲突

### 实际改动

- 梳理了本轮涉及模块与原因：
  - `src/services/use-cases/delivery-tenant-vault.ts`：管理员治理逻辑集中且封闭，适合先补齐 `project` 主入口并保留旧别名
  - `src/services/use-cases/delivery.ts`：聚合层需要对外暴露新的 project 管理接口，减少上层继续直连 `tenant admin` 命名
  - `src/bot/tenant/renderers.ts`：设置页概览仍直接读取 `listTenantAdmins`，适合作为单条可验收调用链切换点
  - `src/bot/tenant/register-messages.ts`、`src/bot/tenant/callbacks/admin-admin-input.ts`：新增/移除管理员的活跃交互入口仍调用旧接口，需要同步切到 `project` 主入口
  - `src/tests/run.ts`：补充别名回归测试，锁定 project 与 tenant 两套入口继续共存
- 在 `delivery-tenant-vault.ts` 中新增以下 `project` 主入口，并把历史 `tenant` 方法保留为兼容别名：
  - `listProjectManagers`
  - `addProjectManager`
  - `removeProjectManager`
- 在 `delivery.ts` 的 `DeliveryAdminService` 与聚合装配中暴露上述 `project-*` 管理接口，保持历史 `listTenantAdmins / addTenantAdmin / removeTenantAdmin` 不删除
- 在 Bot 层仅切换以下活跃调用点到新接口：
  - 设置页概览改为调用 `listProjectManagers`
  - 添加管理员消息流改为调用 `addProjectManager`
  - 管理员列表/移除流程改为调用 `listProjectManagers`、`removeProjectManager`
- 在 `run.ts` 中补充并更新回归测试：
  - `tenant-vault: single owner mode hides extra admins` 同时验证 `listProjectManagers` 与 `listTenantAdmins`
  - `tenant-vault: project manager aliases reuse tenant admin writes` 验证新增别名仍复用原有写路径
  - 设置页单测桩改为提供 `listProjectManagers`，锁定上层已优先依赖 `project` 语义

### 已验证内容

- `npm run test` 通过：`67/67 passed`
- `npm run build` 通过：`tsc -p tsconfig.json`
- 验证结论：
  - 管理员治理链路已具备 `project-*` 主入口，且上层活跃调用点开始优先使用
  - 历史 `tenant-*` 管理接口仍保留，兼容路径未删除
  - 本轮未触碰 schema、迁移脚本、生产环境配置和底层 `tenantId` 命中逻辑

### 未解决问题

- Bot 文案与回调命名仍保留“管理员”表述，尚未进一步收口到更明确的 project/owner 术语
- `delivery` 服务层其他治理与存储接口仍有较多 `tenant-*` 命名残留，尤其是 vault 相关能力
- 运行时核心上下文仍依赖 `getTenantId()`，尚未形成统一 `project context`

### 风险与观察

- 本轮只是在封闭治理模块上补齐 `project` 主入口并切换少量活跃调用点，底层数据读写路径未变，风险较低
- `src/bot/tenant/renderers.ts` 等文件当前已有既有未提交改动；本轮仅在管理员治理相关区域增量修改，未回退其他变更
- 继续采用“先把上层活跃调用切到 `project-*`，底层保留 `tenant-*` 兼容别名”的方式，仍符合 KISS/DRY/YAGNI

### 下一轮建议

- 继续选择封闭的治理/存储接口做同类收口，优先评估 vault group 管理是否需要补齐 `project-*` 主入口
- 若继续处理 Bot/UI，优先改单页面、单回调链上的 project 语义，不要与目录命名调整或运行时上下文收口并行推进
- 如转入阶段 1，应单独评估 `project context` 包装层与诊断入口，不与服务层命名收口混做

## 2026-04-19 - 用户标签 project 主入口收口

### 本轮目标

- 选择阶段 2 的更小低风险步长，把用户标签读取能力从 `tenant` 兼容语义补齐为 `project` 主入口
- 仅切换上层唯一仍显式调用 `getTenantUserLabel` 的 Bot 链路，不触碰 schema、迁移脚本、生产环境配置和运行时 `getTenantId()` 主链路
- 保留历史 `getTenantUserLabel` 兼容路径，避免影响旧分享与主业务链路

### 实际改动

- 梳理了本轮涉及模块与原因：
  - `src/services/use-cases/delivery-tenant-vault.ts`：用户标签读取实现集中且封闭，适合先补齐 `project` 主入口并保留旧别名
  - `src/services/use-cases/delivery-factories.ts` 与 `src/services/use-cases/delivery.ts`：身份服务聚合层需要对外暴露新的 `getProjectUserLabel`
  - `src/bot/tenant/ui-utils.ts`：`resolveUserLabel()` 仍是上层唯一显式调用 `getTenantUserLabel` 的位置，适合作为单条可验收调用链切换点
  - `src/tests/run.ts`：补充回归测试，锁定身份别名与上层调用优先级
- 在 `delivery-tenant-vault.ts` 中新增 `getProjectUserLabel`，并将历史 `getTenantUserLabel` 保留为兼容别名
- 在 `delivery-factories.ts` 与 `delivery.ts` 中补齐 `DeliveryIdentityService` 的 `getProjectUserLabel` 类型与聚合装配
- 在 `ui-utils.ts` 中将 `resolveUserLabel()` 优先切到 `getProjectUserLabel`，并保留运行时对旧 `getTenantUserLabel` 的安全回退，避免与当前工作区中的旧桩对象冲突
- 在 `run.ts` 中补充/更新回归测试：
  - `ui-utils: resolveUserLabel prefers project label alias`
  - `identity-service: exposes project-oriented aliases`

### 已验证内容

- `npm run test` 通过：`68/68 passed`
- `npm run build` 通过：`tsc -p tsconfig.json`
- 验证结论：
  - 上层用户标签读取链路已优先使用 `project-*`
  - 历史 `getTenantUserLabel` 兼容接口仍保留
  - 本轮未触碰 schema、迁移脚本、生产环境配置和底层 `tenantId` 命中逻辑

### 未解决问题

- 身份服务之外，仓库中仍存在大量底层 `getTenantId()` 与其他 `tenant-*` 兼容命名，尚未进入阶段 1 的统一 `project context`
- `src/bot/tenant/*` 目录命名仍是历史兼容形态，本轮未处理目录级收缩
- 用户标签读取之外的部分身份/权限术语仍保留 `tenant` 命名，例如 `getTenantAssetAccess`、`isTenantUser`

### 风险与观察

- 本轮只收口一条读取链路，不改变底层数据结构和查询条件，风险较低，适合作为阶段 2 的独立验收步长
- 当前工作区存在既有未提交改动；本轮仅在身份服务与 `ui-utils` 相关区域增量修改，未回退其他变更
- 为了避免与现有测试桩和未提交代码冲突，`ui-utils.ts` 保留了对旧接口的运行时回退，这符合稳定性优先的约束

### 下一轮建议

- 继续盘点上层残留的单点 `tenant-*` 调用，优先选择像本轮这样只有一条活跃链路的小步长
- 若转入阶段 1，可单独评估是否为 `getTenantId()` 增加 `project context` 包装层，但不要与服务层命名收口混做
- 保持 Bot/UI 一次只切一条明确可回归的调用链，避免与存储治理或目录重命名并行扩面

## 2026-04-19 - social asset access project 主语收口
### 本轮目标

- 选择阶段 2 的低风险小步长，把社交服务依赖的内容访问辅助接口从 `tenant` 主语收口为 `project` 主语
- 仅调整服务工厂、社交服务和聚合装配三处内部边界，保留旧 `tenant-*` 兼容别名，不触碰 schema、迁移脚本、生产配置和 Bot 目录结构
- 用回归测试锁定 `project` 新入口与 `tenant` 兼容入口共存的行为

### 实际改动

- 梳理了本轮涉及模块与原因：
  - `src/services/use-cases/delivery-factories.ts`：集中承载身份服务和内容访问辅助逻辑，适合作为内部主语切换入口
  - `src/services/use-cases/delivery-social.ts`：直接消费内容访问辅助接口，改动面封闭且可独立验证
  - `src/services/use-cases/delivery.ts`：负责聚合装配，需要把 `project` 主入口接到社交服务和身份服务工厂
  - `src/tests/run.ts`：补充回归测试，锁定 `project` 主入口和 `tenant` 兼容别名
- 在 `delivery-factories.ts` 中新增 `createGetProjectAssetAccess`，并将历史 `createGetTenantAssetAccess` 保留为兼容别名
- 在 `delivery-factories.ts` 中把 `buildIdentityService()` 的依赖主语切到 `isProjectMember` / `canManageProject`，同时继续对外提供 `isTenantUser` / `canManageAdmins` 兼容能力
- 在 `delivery-social.ts` 中将内部依赖改为 `isProjectMemberSafe` 与 `getProjectAssetAccess`，减少社交服务内部继续扩散 `tenant` 术语
- 在 `delivery.ts` 中把社交服务和身份工厂的装配切换到新的 `project` 主入口，同时保留 discovery/stats/replica 等未在本轮处理模块的原状
- 在 `run.ts` 中补充/更新回归测试：
  - `identity-service: exposes project-oriented aliases`
  - `access: protected asset is allowed for public viewer`
  - `access: tenant helper remains a compatibility alias of project asset access`
  - `social: public viewer comments history excludes only restricted assets`

### 已验证内容

- `npm run test` 通过：`69/69 passed`
- `npm run build` 通过：`tsc -p tsconfig.json`
- 验证结论：
  - 社交服务依赖的内容访问辅助逻辑已可优先按 `project` 主语装配
  - 历史 `createGetTenantAssetAccess` 兼容入口仍保留，且与 `project` 新入口行为一致
  - 本轮未触碰 schema、迁移脚本、生产环境配置和底层 `tenantId` 命中逻辑

### 未解决问题

- `delivery-discovery.ts`、`delivery-stats.ts`、`delivery-replica-selection.ts` 等模块内部仍保留较多 `tenant` 语义辅助依赖
- 运行时核心上下文仍以 `getTenantId()` 为命中方式，尚未进入阶段 1 的统一 `project context`
- `src/bot/tenant/*` 目录和部分 Bot/UI 文案仍是历史兼容形态，本轮未处理

### 风险与观察

- 本轮仅调整服务内部辅助接口与聚合装配，不改动业务查询条件和数据结构，风险较低，适合作为阶段 2 的独立验收步长
- 当前工作区仍有既有未提交改动；本轮只在 `delivery-factories.ts`、`delivery-social.ts`、`delivery.ts` 和 `run.ts` 相关区域增量修改，未回退其他变更
- 继续采用“先把内部新代码接到 `project-*`，再保留 `tenant-*` 兼容别名”的方式，仍符合 KISS、DRY、YAGNI 和稳定性优先约束

### 下一轮建议

- 继续挑选封闭的服务内部辅助接口做同类收口，优先评估 `delivery-discovery.ts` 或 `delivery-replica-selection.ts` 相邻的访问判断入口
- 若转入阶段 1，应单独开一轮处理 `project context` 与 `getTenantId()` 包装层，不与服务层命名收口并行推进
- Bot/UI 侧继续保持一次只切一条活跃调用链，避免与目录命名调整或 schema 评估混在同一轮

## 2026-04-19 - Bot stats/history project 涓昏楠屾敹
### 鏈疆鐩爣

- 閫夋嫨闃舵 2 鐨勪綆椋庨櫓灏忔闀匡紝鍦ㄥ綋鍓嶅伐浣滃尯宸插瓨鍦ㄧ殑 `project-*` stats/discovery/admin alias 鍩虹涓婏紝鍙皢 Bot 涓婂眰鈥滅粺璁?鎺掕 / 绀惧尯鍘嗗彶 / 璁剧疆姒傝鈥濊繖鏉¤皟鐢ㄩ摼浣滀负鐙珛楠屾敹姝ラ暱
- 涓嶅啀鎵╁ぇ搴曞眰鏈嶅姟瀹炵幇鏀瑰姩锛屼繚鐣?`tenant-*` 鍏煎璺緞锛屼笉瑙︾ schema銆佽縼绉昏剼鏈€佽繍琛屾椂 `project context` 鍜岀敓浜ч厤缃?
- 鐢ㄥ洖褰掓祴璇曢攣瀹氫笂灞傛椿璺冭皟鐢ㄥ凡浼樺厛渚濊禆 `project-*`锛岄伩鍏嶅悗缁洖閫€鍒?`tenant-*`

### 瀹為檯鏀瑰姩

- 姊崇悊浜嗘湰杞秹鍙婃ā鍧椾笌鍘熷洜锛?
  - `src/services/use-cases/delivery-stats.ts`銆乣src/services/use-cases/delivery-discovery.ts`銆乣src/services/use-cases/delivery.ts`锛氬綋鍓嶅伐浣滃尯宸叉湁 `project-*` alias 涓庤仛鍚堟帴绾匡紝閫傚悎浣滀负鏈疆鐨勭ǔ瀹氭€ч獙鏀跺熀绾?
  - `src/bot/tenant/renderers.ts`銆乣src/bot/tenant/history.ts`锛氬凡灏嗙粺璁°€佹帓琛屻€佺ぞ鍖哄巻鍙蹭笌璁剧疆姒傝鍒囧埌 `project-*` 涓诲叆鍙ｏ紝閫傚悎鐢ㄥ皬姝ラ暱缁撴潫涓婂眰璋冪敤閾炬敹鍙?
  - `src/tests/run.ts`锛氭湰杞疄闄呮柊澧?3 鏉″洖褰掓祴璇曪紝鎷撮緳鏈疆鐨勭嫭绔嬮獙鏀舵潯浠?
- 鍦?`src/tests/run.ts` 涓柊澧炰互涓嬪洖褰掓祴璇曪細
  - `renderers: stats prefers project stats alias`
  - `renderers: ranking prefers project ranking aliases`
  - `history: community scope prefers project batch alias`
- 娴嬭瘯鏈韩鍙牎楠屼笂灞傛槸鍚︿紭鍏堣皟鐢?`project-*`锛屼笉寮曞叆鏂扮殑涓氬姟閫昏緫鎴栨暟鎹涓哄彉鏇?

### 宸查獙璇佸唴瀹?
- `npm run test` 閫氳繃锛歚72/72 passed`
- `npm run build` 閫氳繃锛歚tsc -p tsconfig.json`
- 楠岃瘉缁撹锛?
  - Bot 涓婂眰鈥滅粺璁°€佹帓琛屻€佺ぞ鍖哄巻鍙测€濊皟鐢ㄩ摼宸插彲鐢ㄥ洖褰掓祴璇曢攣瀹氫负 `project-*`
  - 璁剧疆姒傝渚濈劧閫氳繃宸叉湁娴嬭瘯瑕嗙洊 `getProjectHomeStats` 鍜?`listProjectManagers` 璋冪敤
  - 鍘嗗彶 `tenant-*` 鍏煎鍏ュ彛浠嶄繚鐣欙紝鏈疆鏈牬鍧忔棫鍒嗕韩鍜屼富涓氬姟閾捐矾

### 鏈В鍐抽棶棰?
- `delivery-replica-selection.ts` 鍜?`delivery-discovery.ts` 鍐呴儴浠嶆湁鏄庢樉 `tenant` 鏈杈呭姪渚濊禆锛屼絾杩樻病鏈夌粍鎴愪笅涓€鏉″畬鏁翠笖灏侀棴鐨勪笂灞傛椿璺冭皟鐢ㄩ摼
- 杩愯鏃舵牳蹇冧笂涓嬫枃浠嶄互 `getTenantId()` 涓哄懡涓柟寮忥紝灏氭湭杩涘叆闃舵 1 鐨?`project context` 鏀跺彛
- `src/bot/tenant/*` 鐩綍鍛藉悕鍜岄儴鍒嗘枃妗堜粛鏄巻鍙插吋瀹瑰舰鎬侊紝鏈疆鏈鐞嗙洰褰曠骇鏀剁缉

### 椋庨櫓涓庤瀵?
- 鏈疆涓嶅啀鎵╁ぇ搴曞眰鏀瑰姩锛屽彧瀵瑰凡鏈夌殑涓婂眰 `project-*` 璋冪敤閾惧仛楠屾敹鍜屽洖褰掗攣瀹氾紝椋庨櫓杈冧綆
- 褰撳墠宸ヤ綔鍖轰粛瀛樺湪鏃㈡湁鏈彁浜ゆ敼鍔紱鏈疆浠呭湪 `src/tests/run.ts` 鍜?`docs/ITERATION_NOTES.md` 澧為噺淇敼锛屾湭鍥為€€鍏朵粬鏀瑰姩
- 缁х画閲囩敤鈥滃厛鍒?Bot/UI 娲昏穬璋冪敤閾撅紝鍐嶉€愭鍚戜笅鏀跺彛鏈嶅姟瀹炵幇鈥濈殑鏂瑰紡锛屼粛绗﹀悎 KISS / DRY / YAGNI

### 涓嬩竴杞缓璁?
- 缁х画閫夋嫨鍙湁涓€鏉℃椿璺冭皟鐢ㄩ摼鐨勬ā鍧楋紝浼樺厛璇勪及 `delivery-replica-selection.ts` 鎴?`delivery-discovery.ts` 鐩搁偦鐨勪笂灞傛秷璐圭偣
- 鑻ヨ浆鍏ラ樁娈?1锛屽簲鍗曠嫭璇勪及 `project context` 灏佽灞傦紝涓嶈涓庢湇鍔″眰 `project-*` 鍛藉悕鏀跺彛骞惰鎺ㄨ繘
- Bot/UI 渚х户缁繚鎸佷竴娆″彧鍒囦竴鏉℃槑纭彲鍥炲綊鐨勮皟鐢ㄩ摼锛岄伩鍏嶅拰鐩綍閲嶅懡鍚嶆垨 schema 璇勪及娣峰湪鍚屼竴杞?

## 2026-04-19 - P0-1-A Project Context 类型与装配入口

### 本轮目标

- 完成矩阵项 `P0-1` 的任务卡 `P0-1-A`
- 仅新增 Project Context 类型与装配入口，不扩面到主进程启动、worker 启动或 `delivery-core` 上下文收口
- 保持历史 `tenantCode / tenantName` 配置路径不变，为后续 `P0-1-B` 提供稳定基础

### 实际改动

- 梳理了本轮涉及模块与原因：
  - `src/project-context.ts`：新增集中 Project Context 类型与装配函数，避免后续继续直接传裸 `{ tenantCode, tenantName }`
  - `src/config.ts`：在保持旧字段兼容的前提下，为配置对象补充 `projectContext`
  - `src/tests/run.ts`：补一条纯测试，锁定从 tenant 配置映射到 project context 的行为
- 新增 `src/project-context.ts`，提供：
  - `ProjectContextConfig`
  - `createProjectContextConfig`
  - `createProjectContextConfigFromTenant`
- 在 `loadConfig()` 中新增 `projectContext` 字段：
  - `config.projectContext.code` 映射自 `TENANT_CODE`
  - `config.projectContext.name` 映射自 `TENANT_NAME`
- 保持 `tenantCode`、`tenantName` 原字段不删除，避免影响当前运行链路和既有未提交改动

### 已验证内容

- `npm run test` 通过：`73/73 passed`
- `npm run build` 通过：`tsc -p tsconfig.json`
- 验证结论：
  - 已具备集中 Project Context 类型与装配入口
  - 新代码可以优先依赖 `config.projectContext`
  - 历史 `tenantCode / tenantName` 兼容路径仍保留

### 未解决问题

- 主进程启动仍直接使用 `config.tenantCode`
- `tenant-guard` 仍未提供 project-oriented 包装
- `delivery-core` 仍以 `getTenantId()` 作为运行时命中主入口
- worker 启动仍未接入 project context

### 风险与观察

- 本轮改动非常克制，只新增类型与装配入口，没有改动实际启动逻辑，风险较低
- 当前工作区存在大量既有未提交改动；本轮仅增量修改 `src/config.ts`、`src/tests/run.ts` 并新增 `src/project-context.ts`，未回退其他变更
- 以 `config.projectContext` 这种并行兼容方式切入，符合 KISS 和稳定性优先，也方便后续逐卡推进

### 下一轮建议

- 严格按任务卡顺序进入 `P0-1-B`
- 让 `src/index.ts` 和 `src/bot.ts` 优先通过 `project context` 装配主进程，但仍保留旧 tenant guard 兼容逻辑
- 不要在 `P0-1-B` 中顺手处理 `server.ts`、`worker/index.ts` 或 `delivery-core.ts`

## 2026-04-19 - P0-1-B 主进程启动 project context 装配

### 本轮目标

- 完成矩阵项 `P0-1` 的任务卡 `P0-1-B`
- 仅处理 `src/index.ts` 与 `src/bot.ts` 的主进程装配，让主流程优先通过 `project context` 取上下文
- 保持旧 tenant guard 和底层 tenant 形状兼容输入不变

### 实际改动

- 梳理了本轮涉及模块与原因：
  - `src/bot.ts`：主进程会通过这里装配 upload 与 delivery 服务，适合作为 `projectContext -> tenantConfig` 兼容映射入口
  - `src/index.ts`：主进程入口，需要优先通过 `projectContext` 触发上下文装配
  - `src/project-context.ts`：补充从 `project context` 回映射到旧 tenant 兼容形状的函数
- 在 `src/project-context.ts` 中新增：
  - `createTenantConfigFromProjectContext`
- 在 `src/bot.ts` 中完成了以下切换：
  - 先从 `config.projectContext` 构造 `tenantConfig`
  - `createUploadService()` 改为消费 `tenantConfig`
  - `createDeliveryService()` 改为消费 `tenantConfig`
- 在 `src/index.ts` 中完成了以下切换：
  - 启动时先从 `config.projectContext` 构造 `tenantConfig`
  - `assertTenantCodeConsistency()` 改为消费由 `projectContext` 回映射出的兼容配置
- 过程中 `src/index.ts` 曾出现两次 `apply_patch` 写入失败，但后续采用更小补丁成功落地；已记录为工具层瞬时阻塞观察，不再视为当前未完成项

### 已验证内容

- `npm run test` 通过：`73/73 passed`
- `npm run build` 通过：`tsc -p tsconfig.json`
- 验证结论：
  - `projectContext -> tenantConfig` 的兼容映射已经可以在 `bot.ts` 中使用
  - 主进程启动链路已在 `index.ts` 和 `bot.ts` 优先通过 `projectContext` 装配
  - 当前增量改动未破坏测试和构建
  - 旧 tenant guard 与底层 tenant 形状兼容路径仍保留

### 未解决问题

- 启动期 tenant guard 仍未通过 `project context` 触发
- `tenant-guard` 本身仍未提供 project-oriented 包装，这属于下一张卡 `P0-1-D`

### 风险与观察

- 本轮没有扩面到 `server.ts`、`tenant-guard.ts`、`worker/index.ts`，风险较低
- `src/index.ts` 曾出现单文件写入阻塞，但最终已通过更小补丁完成，说明后续若再遇到同类问题，优先缩小补丁范围即可
- 以 `projectContext -> tenantConfig` 兼容映射推进主进程装配，符合当前“先收口主语，再保留底层兼容”的策略

### 下一轮建议

- 严格按任务卡顺序进入 `P0-1-D`
- 在 `tenant-guard.ts` 中补齐 project-oriented 包装函数，但不要顺手改 `server.ts` 诊断接口
- 保持 `index.ts` 与 `bot.ts` 当前装配方式不变，避免在 `P0-1-D` 中回头扩大改动面
## 2026-04-19 - P0-1-D tenant-guard project wrappers

### Goal

- Continue phase `P0-1` with a narrow runtime-boundary step.
- Add project-oriented wrappers around `tenant-guard` without removing any tenant compatibility path.
- Switch the main app entry to the new project-oriented guard call.

### Changes

- Added project-oriented wrapper exports in `src/infra/persistence/tenant-guard.ts`:
  - `getProjectDiagnostics`
  - `assertProjectContextConsistency`
  - `ensureRuntimeProjectContext`
- Kept existing tenant-oriented exports unchanged for compatibility.
- Updated `src/index.ts` to call `assertProjectContextConsistency(prisma, config.projectContext)`.
- Added focused tests in `src/tests/run.ts` for:
  - project diagnostics mapping
  - project context consistency guard
  - runtime project context mapping

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`

### Notes

- This round does not touch `worker/*`, schema, or route names like `/ops/tenant-check`.
- The runtime core still resolves the underlying database scope through tenant-compatible storage; this round only moves the entry-point language forward.

## 2026-04-19 - P0-1-C server project diagnostics

### Goal

- Continue phase `P0-1` by adding a project-oriented ops diagnostics entry.
- Keep `/ops/tenant-check` working as a compatibility route.
- Avoid touching worker startup or schema.

### Changes

- Updated `src/server.ts` to support both:
  - `/ops/project-check`
  - `/ops/tenant-check`
- The new project route returns project-oriented diagnostics loaded via `getProjectDiagnostics(...)`.
- The tenant route remains available and keeps tenant-oriented response fields.
- Added a small dependency-injection seam in `createServer(...)` so diagnostics routes can be tested without hitting the real database.
- Added route-level regression tests in `src/tests/run.ts` for both ops endpoints.

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`

### Notes

- This round intentionally leaves env var names like `OPS_TENANT_CHECK_RATE_LIMIT` unchanged to avoid widening scope.
- The next likely step is the worker-side runtime boundary, not further route renaming.

## 2026-04-20 - P0-1-F worker project startup boundary

### Goal

- Continue phase `P0-1` by moving the worker startup boundary to project-oriented wording.
- Keep replication, broadcast, and storage internals unchanged.
- Preserve tenant-compatible helper behavior underneath the new entry-point language.

### Changes

- Updated `src/worker/index.ts` so worker startup now:
  - validates runtime context with `assertProjectContextConsistency(...)`
  - derives tenant-compatible service config from `config.projectContext`
  - resolves the runtime project id via `ensureRuntimeProjectId(...)`
  - uses `backfillProjectUsers(...)` during sync mode
- Added worker helper wrappers in `src/worker/helpers.ts`:
  - `ensureRuntimeProjectId`
  - `backfillProjectUsers`
- Kept existing tenant-compatible helpers intact:
  - `ensureTenantId`
  - `backfillTenantUsers`
- Added focused regression tests in `src/tests/run.ts` for the new worker helper wrappers.

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round intentionally does not rename scheduler internals such as `runtimeTenantId`; the worker entry now maps project wording onto the existing compatibility layer.
- A later round can decide whether worker helper naming should be fully flipped after the internal runtime boundary is more stable.

## 2026-04-20 - P0-1-E delivery-core runtime project wrapper

### Goal

- Continue phase `P0-1` by reducing direct service-assembly dependence on `getTenantId()`.
- Add runtime project wrappers in `delivery-core` while preserving tenant-compatible behavior underneath.
- Keep storage/query logic and child module parameter names unchanged.

### Changes

- Updated `src/services/use-cases/delivery-core.ts` to expose:
  - `getRuntimeProjectContext`
  - `getRuntimeProjectId`
  - existing `getTenantId` now acts as a compatibility alias over the runtime project id
- Switched `delivery-core` runtime resolution to `ensureRuntimeProjectContext(...)`.
- Updated `src/services/use-cases/delivery.ts` so service wiring now prefers `getRuntimeProjectId` when passing the runtime scope into child modules.
- Added regression coverage in `src/tests/run.ts` for the new delivery-core runtime project wrappers.

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round does not rename child module dependency names such as `getTenantId`; it only changes the value source used during top-level service assembly.
- A later round can decide whether the remaining tenant-named dependency signatures are worth flipping, after the runtime boundary is fully stable.

## 2026-04-20 - P0-2 replica selection project boundary

### Goal

- Continue shrinking tenant-oriented service wiring on the asset delivery path.
- Update replica selection to consume project-oriented runtime dependencies.
- Keep return payloads, database access, and storage binding logic unchanged.

### Changes

- Updated `src/services/use-cases/delivery-replica-selection.ts` to consume:
  - `getRuntimeProjectId`
  - `isProjectMemberSafe`
  - `getProjectMinReplicas`
- Updated `src/services/use-cases/delivery.ts` wiring so replica selection now receives project-oriented runtime inputs.
- Added regression coverage in `src/tests/run.ts`:
  - existing replica-selection tests now use the new dependency names
  - added a pending-state test to verify the new project-oriented runtime deps are exercised

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round intentionally does not rename `tenantId` fields in the selection result. The goal here is input-boundary cleanup only.
- A later round can decide whether the selection output contract should also move to project wording.

## 2026-04-20 - P0-2 discovery runtime input boundary

### Goal

- Continue shrinking tenant-oriented input dependencies in the discovery module.
- Move discovery wiring to project-oriented runtime helpers.
- Keep query filters, storage keys, and return payloads unchanged.

### Changes

- Updated `src/services/use-cases/delivery-discovery.ts` to consume:
  - `getRuntimeProjectId`
  - `isProjectMemberSafe`
- Updated `src/services/use-cases/delivery.ts` wiring so discovery now receives project-oriented runtime inputs.
- Updated discovery regression tests in `src/tests/run.ts` to use the new dependency names.
- Added a small search-path regression to verify the new project-oriented runtime deps are exercised.

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round intentionally leaves internal local variable names like `tenantId` unchanged because they still represent the persisted compatibility key.
- A later round can decide whether discovery output contracts or internal terminology should also be flipped after the runtime boundary is stable.

## 2026-04-20 - P0-2 stats runtime input boundary

### Goal

- Continue shrinking tenant-oriented input dependencies in the stats module.
- Move stats wiring to project-oriented runtime helpers.
- Keep metrics definitions, ranking logic, and return payloads unchanged.

### Changes

- Updated `src/services/use-cases/delivery-stats.ts` to consume:
  - `getRuntimeProjectId`
  - `isProjectMemberSafe`
- Updated `src/services/use-cases/delivery.ts` wiring so stats now receives project-oriented runtime inputs.
- Added a focused regression in `src/tests/run.ts` to verify ranking preparation exercises the new project-oriented runtime deps.

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round intentionally leaves local variables like `tenantId` unchanged because they still map to the persisted compatibility key.
- A later round can decide whether stats-facing internal terminology should be flipped after the runtime boundary is stable.

## 2026-04-20 - P0-2 admin runtime input boundary

### Goal

- Continue shrinking tenant-oriented input dependencies in the admin module.
- Move admin wiring to project-oriented runtime helpers.
- Keep settings semantics, broadcast behavior, and storage layout unchanged.

### Changes

- Updated `src/services/use-cases/delivery-admin.ts` to consume `getRuntimeProjectId`.
- Updated `src/services/use-cases/delivery.ts` wiring so admin now receives the project-oriented runtime helper.
- Updated existing admin tests in `src/tests/run.ts` to use the new dependency name.
- Added a focused regression test to verify draft creation exercises `getRuntimeProjectId`.

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round intentionally leaves permission checks on `isTenantAdmin` unchanged. The scope change here is runtime id input only.
- A later round can decide whether admin authorization naming should also be flipped after the runtime boundary is fully stable.

## 2026-04-20 - P0-2 tenant-vault runtime input boundary

### Goal

- Continue shrinking tenant-oriented input dependencies in the tenant-vault module.
- Move vault/configuration wiring to the project-oriented runtime helper.
- Keep permission semantics, table layout, and public return contracts unchanged.

### Changes

- Updated `src/services/use-cases/delivery-tenant-vault.ts` to consume `getRuntimeProjectId`.
- Updated `src/services/use-cases/delivery.ts` wiring so tenant-vault now receives the project-oriented runtime helper.
- Updated existing tenant-vault tests in `src/tests/run.ts` to use the new dependency name.
- Added a focused regression test to verify collection listing exercises `getRuntimeProjectId`.

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round intentionally leaves permission checks on `isTenantAdmin` and method names like `listTenantAdmins` unchanged. The scope change here is runtime id input only.
- A later round can decide whether the remaining authorization and naming compatibility layer should be collapsed.

## 2026-04-20 - P0-2 project permission alias in delivery-core

### Goal

- Start shrinking tenant-oriented permission naming leakage without changing authorization rules.
- Expose a project-oriented manage permission alias from `delivery-core`.
- Update top-level service assembly to prefer the new alias where possible.

### Changes

- Updated `src/services/use-cases/delivery-core.ts` to expose `canManageProject` as a project-oriented alias over the existing admin permission logic.
- Updated `src/services/use-cases/delivery.ts` so:
  - `canManageProjectSafe` now uses `canManageProject`
  - identity service wiring now consumes `canManageProject` directly
- Added a focused regression test in `src/tests/run.ts` to verify the new alias matches current admin behavior.

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round intentionally keeps `isTenantAdmin` in place for compatibility and for modules that still depend on the old input name.
- A later round can decide whether remaining internal consumers should migrate from `isTenantAdmin` to `canManageProject`.

## 2026-04-20 - P0-2 project member alias in tenant-vault

### Goal

- Continue shrinking tenant-oriented identity naming leakage without changing membership rules.
- Expose a project-oriented member alias from `tenant-vault`.
- Update top-level service assembly to prefer the new alias where possible.

### Changes

- Updated `src/services/use-cases/delivery-tenant-vault.ts` to expose `isProjectMember` and keep `isTenantUser` as a compatibility alias.
- Updated `src/services/use-cases/delivery.ts` so:
  - `isProjectMemberSafe` now uses `isProjectMember`
  - identity service wiring now consumes `isProjectMember` directly
- Added a focused regression test in `src/tests/run.ts` to verify the new alias matches the current tenant-user behavior.

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round intentionally keeps `isTenantUser` in place for compatibility and for modules that still depend on the old name.
- A later round can decide whether remaining internal consumers should migrate from `isTenantUser` to `isProjectMember`.

## 2026-04-20 - P0-2 project collection/admin permission aliases

### Goal

- Continue shrinking tenant-oriented permission naming leakage at the identity alias layer.
- Expose project-oriented collection/admin permission aliases without changing any authorization rules.
- Start switching production call sites to the new collection permission alias.

### Changes

- Updated `src/services/use-cases/delivery.ts` type surface to include:
  - `canManageProjectAdmins`
  - `canManageProjectCollections`
- Updated `src/services/use-cases/delivery-factories.ts` so both new aliases map to the existing project manage permission.
- Updated production call sites to use `canManageProjectCollections` in:
  - `src/bot/tenant/index.ts`
  - `src/bot/tenant/renderers.ts`
  - `src/bot/tenant/callbacks/admin-collections.ts`
- Updated tests in `src/tests/run.ts` to cover the new aliases and the adjusted renderers mock shape.

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round intentionally keeps `canManageAdmins` and `canManageCollections` in place for compatibility.
- A later round can decide whether remaining consumers should migrate fully and whether the compatibility names can be collapsed.

## 2026-04-20 - P0-2 admin permission call sites use project alias

### Goal

- Continue reducing ambiguous permission naming at production call sites.
- Switch admin-management call sites from the generic project manage permission to the explicit admin-manage alias.
- Keep compatibility interfaces intact.

### Changes

- Updated production call sites to use `canManageProjectAdmins` in:
  - `src/bot/tenant/register-messages.ts`
  - `src/bot/tenant/renderers.ts`
  - `src/bot/tenant/callbacks/admin-admin-input.ts`
- Updated affected test mocks in `src/tests/run.ts` to match the new production call shape.

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round does not remove `canManageProject` from admin flows everywhere; it only narrows the highest-traffic explicit admin-management call sites.
- Compatibility aliases remain in place.

## 2026-04-20 - P0-2 ui label path prefers project alias explicitly

### Goal

- Make the default UI label-read path explicitly prefer the project-oriented label alias.
- Keep tenant label lookup only as a compatibility fallback.
- Lock the fallback behavior with a regression test.

### Changes

- Updated `src/bot/tenant/ui-utils.ts` so stored user label resolution now goes through an explicit helper that prefers `getProjectUserLabel` and only falls back to `getTenantUserLabel`.
- Added a focused compatibility test in `src/tests/run.ts` to verify the tenant-label fallback remains available.

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round is deliberately small. It does not change the service type surface; it only clarifies the default path at the UI utility layer.

## 2026-04-20 - P0-2 internal social and summary deps use project runtime id

### Goal

- Continue shrinking tenant-oriented naming inside internal service dependencies.
- Align internal modules that already consume the project runtime boundary with project-oriented dependency names.
- Keep all external service contracts unchanged.

### Changes

- Updated `src/services/use-cases/delivery-factories.ts` so `createGetUserProfileSummary(...)` now consumes `getRuntimeProjectId`.
- Updated `src/services/use-cases/delivery-social.ts` so it now consumes `getRuntimeProjectId`.
- Updated `src/services/use-cases/delivery.ts` wiring accordingly.
- Added a focused regression in `src/tests/run.ts` to verify the social module uses the new runtime id dependency.

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round intentionally does not change the public service surface. It only aligns internal dependency field names with the project-oriented runtime boundary already in place.

## 2026-04-20 - P0-2 internal preferences and storage deps use project runtime id

### Goal

- Continue shrinking tenant-oriented naming inside internal preference/storage dependencies.
- Align internal modules that already use the project runtime boundary with project-oriented dependency names.
- Keep public service contracts unchanged.

### Changes

- Updated `src/services/use-cases/delivery-storage.ts` so it now consumes `getRuntimeProjectId`.
- Updated `src/services/use-cases/delivery-preferences.ts` so it now consumes `getRuntimeProjectId`.
- Updated `src/services/use-cases/delivery.ts` wiring accordingly.
- Added a focused regression in `src/tests/run.ts` to verify storage uses the new runtime id dependency.

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round intentionally does not change public preference-related service method names. It only aligns internal dependency field names with the project-oriented runtime boundary.

## 2026-04-20 - P0-2 remove unused tenant-safe helpers in delivery assembly

### Goal

- Remove leftover internal tenant-named helpers that no longer have consumers.
- Reduce internal naming noise without changing any behavior or public surface.

### Changes

- Removed unused local helpers from `src/services/use-cases/delivery.ts`:
  - `isTenantUserSafe`
  - `isTenantAdminSafe`
- Kept active project-oriented helpers unchanged:
  - `isProjectMemberSafe`
  - `canManageProjectSafe`

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round is intentionally small. It only removes dead internal naming residue after previous runtime-boundary refactors.

## 2026-04-20 - P0-2 split identity service type into project-first and compatibility layers

### Goal

- Start separating the public type surface into project-first and compatibility layers.
- Keep runtime behavior unchanged.
- Limit scope to the identity service first.

### Changes

- Updated `src/services/use-cases/delivery.ts` to split identity typing into:
  - `DeliveryProjectIdentityService`
  - `DeliveryIdentityCompatibilityService`
  - `DeliveryIdentityService = DeliveryProjectIdentityService & DeliveryIdentityCompatibilityService`

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round is type-only. It does not change runtime behavior.
- If this structure remains stable, the same split can be applied incrementally to other service areas.

## 2026-04-20 - P0-2 split stats service type into project-first and compatibility layers

### Goal

- Continue separating the public type surface into project-first and compatibility layers.
- Keep runtime behavior unchanged.
- Limit scope to stats typing only.

### Changes

- Updated `src/services/use-cases/delivery.ts` to split stats typing into:
  - `DeliveryProjectStatsService`
  - `DeliveryStatsCompatibilityService`
  - `DeliveryStatsService = DeliveryProjectStatsService & DeliveryStatsCompatibilityService`

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round is type-only. It does not change runtime behavior.
- If the structure holds, the same pattern can be applied to admin/discovery next.

## 2026-04-20 - P0-2 split admin service type into project-first and compatibility layers

### Goal

- Continue separating the public type surface into project-first and compatibility layers.
- Keep runtime behavior unchanged.
- Limit scope to admin typing only.

### Changes

- Updated `src/services/use-cases/delivery.ts` to split admin typing into:
  - `DeliveryProjectAdminService`
  - `DeliveryAdminCompatibilityService`
  - `DeliveryAdminService = DeliveryProjectAdminService & DeliveryAdminCompatibilityService`

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round is type-only. It does not change runtime behavior.
- If the structure remains stable, discovery or tenant settings can be split the same way next.

## 2026-04-21 - P0-2 split tenant settings service type into project-first and compatibility layers

### Goal

- Continue separating the public type surface into project-first and compatibility layers.
- Keep runtime behavior unchanged.
- Limit scope to tenant settings typing only.

### Changes

- Updated `src/services/use-cases/delivery.ts` to split settings typing into:
  - `DeliveryProjectSettingsService`
  - `DeliveryTenantSettingsCompatibilityService`
  - `DeliveryTenantSettingsService = DeliveryProjectSettingsService & DeliveryTenantSettingsCompatibilityService`

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round is type-only. It does not change runtime behavior.
- If the structure remains stable, discovery typing can be split the same way next.

## 2026-04-21 - P0-2 split discovery service type into project-first and compatibility layers

### Goal

- Continue separating the public type surface into project-first and compatibility layers.
- Keep runtime behavior unchanged.
- Limit scope to discovery typing only.

### Changes

- Updated `src/services/use-cases/delivery.ts` to split discovery typing into:
  - `DeliveryProjectDiscoveryService`
  - `DeliveryDiscoveryCompatibilityService`
  - `DeliveryDiscoveryService = DeliveryProjectDiscoveryService & DeliveryDiscoveryCompatibilityService`

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round is type-only. It does not change runtime behavior.
- If the structure remains stable, tenant-vault/admin settings compatibility surfaces can be further normalized the same way.

## 2026-04-21 - P0-2 unify compatibility type naming under Legacy* aliases

### Goal

- Normalize the naming of compatibility-layer service types.
- Keep all existing compatibility names available.
- Limit scope to type/name changes only.

### Changes

- Updated `src/services/use-cases/delivery.ts` to introduce:
  - `LegacyIdentityService`
  - `LegacySettingsService`
  - `LegacyAdminService`
  - `LegacyStatsService`
  - `LegacyDiscoveryService`
- Kept existing `Delivery*CompatibilityService` names as aliases to the new `Legacy*` types.

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round is type/name-only. It does not change runtime behavior.
- The purpose is to make the distinction between project-first types and compatibility-layer types visually consistent.

## 2026-04-21 - P0-2 delivery service compatibility shrink inventory

### Goal

- Stop doing blind compatibility cleanup.
- Record which `tenant-*` members on `DeliveryService` are still used by production code and which are now compatibility-only.
- Use that inventory to drive future removal order.

### Changes

- Added [DELIVERY_SERVICE_COMPAT_SHRINK.md](E:\MU\chucun\docs\DELIVERY_SERVICE_COMPAT_SHRINK.md).
- Grouped compatibility members into:
  - still used in production
  - compatibility-only candidates
- Added a suggested removal order and concrete preconditions before deletion.

### Verification

- No runtime code changed in this round.

### Notes

- This round is documentation-only.
- The intent is to make subsequent compatibility removal deliberate instead of grep-driven.

## 2026-04-21 - P0-2 remove stats compatibility members from delivery service

### Goal

- Start actual compatibility shrink using the documented removal order.
- Remove a low-risk batch with no production callers.
- Keep the project-first stats surface unchanged.

### Changes

- Removed tenant stats compatibility members from:
  - `src/services/use-cases/delivery.ts`
  - `src/services/use-cases/delivery-stats.ts`
- Removed:
  - `getTenantHomeStats`
  - `getTenantStats`
  - `getTenantRanking`
  - `getTenantLikeRanking`
  - `getTenantVisitRanking`
  - `getTenantCommentRanking`
- Updated [DELIVERY_SERVICE_COMPAT_SHRINK.md](E:\MU\chucun\docs\DELIVERY_SERVICE_COMPAT_SHRINK.md) to mark stats compatibility removal as completed.

### Verification

- `npm run test`
- `npm run build`
- `npm run typecheck`

### Notes

- This is the first actual removal from the compatibility surface, not just a naming or typing cleanup.
- The successful validation confirms the stats compatibility members had no remaining production dependency.

## 2026-04-21 - P0-2 introduce neutral settings service type name

### Goal

- Start replacing tenant-named top-level service type names with neutral names.
- Keep compatibility for existing references.
- Limit scope to settings typing only.

### Changes

- Updated `src/services/use-cases/delivery.ts` to introduce:
  - `DeliverySettingsService` as the neutral primary type name
  - `DeliveryTenantSettingsService = DeliverySettingsService` as a compatibility alias
- Updated the top-level `DeliveryService` composition and local assembly variable naming to use `DeliverySettingsService`.

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round is type/name-only. It does not change runtime behavior.
- If this pattern holds, similar neutral renames can be applied to other tenant-named top-level service type aliases.

## 2026-04-21 - P0-2 introduce neutral admin and discovery service type names

### Goal

- Continue replacing tenant- or legacy-shaped top-level service type names with neutral names.
- Keep compatibility aliases for existing references.
- Limit scope to type/name changes only.

### Changes

- Updated `src/services/use-cases/delivery.ts` to introduce:
  - `AdminService` as the neutral primary admin type name
  - `DeliveryAdminService = AdminService` as a compatibility alias
  - `DiscoveryService` as the neutral primary discovery type name
  - `DeliveryDiscoveryService = DiscoveryService` as a compatibility alias
- Updated the top-level `DeliveryService` composition and local assembly typing accordingly.

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round is type/name-only. It does not change runtime behavior.
- If this pattern holds, the remaining tenant/legacy-shaped top-level type names can be normalized the same way.

## 2026-04-21 - P0-2 remove settings compatibility members from delivery service

### Goal

- Continue actual compatibility shrink using the documented removal order.
- Remove another low-risk batch with no production callers.
- Keep the project-first settings surface unchanged.

### Changes

- Removed tenant settings compatibility members from:
  - `src/services/use-cases/delivery.ts`
  - `src/services/use-cases/delivery-core.ts`
- Removed:
  - `getTenantSearchMode`
  - `setTenantSearchMode`
  - `getTenantMinReplicas`
  - `setTenantMinReplicas`
- Updated tests that were still asserting the old aliases.
- Updated [DELIVERY_SERVICE_COMPAT_SHRINK.md](E:\MU\chucun\docs\DELIVERY_SERVICE_COMPAT_SHRINK.md) to mark settings compatibility removal as completed.

### Verification

- `npm run test`
- `npm run build`
- `npm run typecheck`

### Notes

- This is another real compatibility shrink step, not just naming cleanup.
- Validation confirms the removed settings members had no remaining production dependency.

## 2026-04-21 - P0-2 remove admin compatibility members from delivery service

### Goal

- Continue actual compatibility shrink using the documented removal order.
- Remove the next low-risk batch with no production callers.
- Keep the project-first admin surface unchanged.

### Changes

- Removed tenant admin/config compatibility members from:
  - `src/services/use-cases/delivery.ts`
  - `src/services/use-cases/delivery-admin.ts`
  - `src/services/use-cases/delivery-tenant-vault.ts`
- Removed:
  - `getTenantStartWelcomeHtml`
  - `setTenantStartWelcomeHtml`
  - `getTenantDeliveryAdConfig`
  - `setTenantDeliveryAdConfig`
  - `getTenantProtectContentEnabled`
  - `setTenantProtectContentEnabled`
  - `getTenantHidePublisherEnabled`
  - `setTenantHidePublisherEnabled`
  - `getTenantAutoCategorizeEnabled`
  - `setTenantAutoCategorizeEnabled`
  - `getTenantAutoCategorizeRules`
  - `setTenantAutoCategorizeRules`
  - `getTenantPublicRankingEnabled`
  - `setTenantPublicRankingEnabled`
  - `listTenantAdmins`
  - `addTenantAdmin`
  - `removeTenantAdmin`
- Updated tests that were still asserting the old aliases.
- Updated [DELIVERY_SERVICE_COMPAT_SHRINK.md](E:\MU\chucun\docs\DELIVERY_SERVICE_COMPAT_SHRINK.md) to mark admin compatibility removal as completed.

### Verification

- `npm run test`
- `npm run build`
- `npm run typecheck`

### Notes

- This is a real compatibility shrink step, not a naming-only change.
- Validation confirms the removed admin compatibility members had no remaining production dependency.

## 2026-04-21 - P0-2 normalize remaining local admin/collection permission naming

### Goal

- Remove the last production-side local uses of compatibility-shaped permission names.
- Keep service compatibility aliases in place for now.
- Reduce the remaining ambiguity before the next compatibility removal step.

### Changes

- Updated production-side local naming to the project-oriented form in:
  - `src/bot/tenant/keyboards.ts`
  - `src/bot/tenant/renderers.ts`
  - `src/bot/tenant/register-messages.ts`
  - `src/bot/tenant/callbacks/admin-admin-input.ts`
- Updated [DELIVERY_SERVICE_COMPAT_SHRINK.md](E:\MU\chucun\docs\DELIVERY_SERVICE_COMPAT_SHRINK.md) to reflect that these are now compatibility aliases rather than production-side local naming blockers.

### Verification

- `npm run test`
- `npm run build`
- `npm run typecheck`

### Notes

- This round does not remove `canManageAdmins` / `canManageCollections` yet.
- It clears the way for evaluating whether those compatibility aliases can now be dropped safely.

## 2026-04-21 - P0-2 remove discovery batch compatibility member

### Goal

- Continue actual compatibility shrink using the documented removal order.
- Remove the remaining low-risk discovery compatibility member with no production callers.
- Keep the project-first discovery surface unchanged.

### Changes

- Removed `listTenantBatches` from:
  - `src/services/use-cases/delivery.ts`
  - `src/services/use-cases/delivery-discovery.ts`
- Updated the remaining test mock that was still asserting the old alias.
- Updated [DELIVERY_SERVICE_COMPAT_SHRINK.md](E:\MU\chucun\docs\DELIVERY_SERVICE_COMPAT_SHRINK.md) to mark `listTenantBatches` as removed.

### Verification

- `npm run test`
- `npm run build`
- `npm run typecheck`

### Notes

- This is another real compatibility shrink step.
- Validation confirms the removed discovery batch alias had no remaining production dependency.

## 2026-04-21 - P0-1 service assembly consumes project context directly

### Goal

- Continue phase `P0-1` by pushing `projectContext` one layer deeper into top-level service assembly.
- Stop requiring `bot` and `worker` entry wiring to convert `projectContext` back into ad-hoc tenant config first.
- Keep legacy tenant-shaped config accepted inside lower-level modules where tests and compatibility still depend on it.

### Changes

- Updated `src/project-context.ts` to add:
  - `LegacyTenantConfig`
  - `ProjectContextInput`
  - `normalizeProjectContextConfig(...)`
- Updated `src/services/use-cases/delivery-core.ts` to normalize config input through `projectContext` before resolving runtime context.
- Updated `src/services/use-cases/delivery.ts` so `createDeliveryService(...)` now accepts `ProjectContextInput`.
- Updated `src/services/use-cases/upload.ts` so `createUploadService(...)` now receives `projectContext` explicitly and resolves runtime tenant/project context from it.
- Updated top-level wiring to pass `config.projectContext` directly in:
  - `src/bot.ts`
  - `src/worker/index.ts`
- Added focused test coverage in `src/tests/run.ts` for:
  - `normalizeProjectContextConfig(...)`
  - `createDeliveryCore(...)` using project-context shape directly

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round intentionally does not remove legacy tenant-shaped config input from lower-level modules.
- The aim is to make top-level runtime assembly project-first while preserving compatibility underneath.

## 2026-04-21 - P0-2 delivery selection result prefers project id wording

### Goal

- Continue phase `P0-2` on the open-content path with a very small public-surface cleanup.
- Replace `tenantId` with `projectId` on the ready delivery-selection result.
- Keep database fields and persistence logic unchanged underneath.

### Changes

- Updated `DeliverySelection` in:
  - `src/services/use-cases/delivery.ts`
  - `src/services/use-cases/delivery-replica-selection.ts`
- Renamed the ready-selection field from `tenantId` to `projectId`.
- Updated `trackOpen(...)` naming in:
  - `src/services/use-cases/delivery.ts`
  - `src/services/use-cases/delivery-core.ts`
- Updated `src/bot/tenant/open.ts` to consume `selection.projectId`.
- Added a focused regression in `src/tests/run.ts` to verify the open handler now tracks opens using the project id from the selection result.

### Verification

- Planned verification:
  - `npm run test`
  - `npm run build`
  - `npm run typecheck`

### Notes

- This round intentionally does not rename Prisma schema fields or database columns.
- The aim is to move the delivery/open path public surface toward project wording without widening scope.

## 2026-04-21 - P0-3 replication scheduler runtime boundary prefers project wording

### Goal

- Continue phase `P0-3` with a small runtime-boundary step inside the worker scheduler.
- Rename scheduler dependency injection and local heartbeat naming from `tenant` to `project`.
- Keep batch table fields, Prisma queries, and persistence structure unchanged.

### Changes

- Updated `src/worker/replication-scheduler.ts` so:
  - `runtimeTenantId` becomes `runtimeProjectId`
  - heartbeat callback parameters become `projectId`
  - scheduler-level log metadata uses `projectId` for this boundary layer
  - local heartbeat id sets are renamed to project-oriented wording
- Updated `src/worker/index.ts` to pass the new `runtimeProjectId` dependency and project-oriented callback parameter names into `startReplicationScheduler(...)`.

### Verification

- Planned verification:
  - `npm run typecheck`
  - `npm run build`
  - `npm run test`

### Notes

- This round intentionally does not rename `batch.tenantId` or underlying Prisma query fields.
- The aim is to keep moving the worker runtime boundary toward project wording without widening into schema or replication logic changes.

## 2026-04-21 - P0-3 worker replication error logs prefer project id wording

### Goal

- Continue phase `P0-3` by pushing project-oriented wording into worker error-reporting edges.
- Keep persistence, Prisma field names, and replication decisions unchanged.
- Limit scope to error-log metadata and local boundary naming only.

### Changes

- Updated `src/worker/strategy.ts` so worker error metadata now explicitly supports `projectId`.
- Updated `src/worker/replication-worker.ts` to:
  - derive a local `projectId` alias from `batch.tenantId`
  - use `projectId` in worker error log metadata for thread setup and upload item status updates
- Updated `src/worker/index.ts` follow-notify error logging to use `projectId` metadata.

### Verification

- Planned verification:
  - `npm run typecheck`
  - `npm run build`
  - `npm run test`

### Notes

- This round intentionally does not rename Prisma `tenantId` fields or change replication behavior.
- The aim is to keep shrinking worker-facing tenant wording at the runtime boundary while staying low risk.

## 2026-04-21 - P1-1 identity sync path prefers project user upsert alias

### Goal

- Continue phase `P1-1` by giving Telegram user sync a true project-first service entry.
- Make production middleware prefer the project-oriented identity sync method.
- Keep the tenant-named method as a compatibility alias.

### Changes

- Added `upsertProjectUserFromTelegram(...)` to the project identity service surface in:
  - `src/services/use-cases/delivery.ts`
  - `src/services/use-cases/delivery-factories.ts`
- Updated `src/services/use-cases/delivery-tenant-vault.ts` so:
  - `upsertProjectUserFromTelegram(...)` is now the primary implementation
  - `upsertTenantUserFromTelegram` remains as a compatibility alias
- Updated `src/bot/tenant/register-middlewares.ts` to prefer `upsertProjectUserFromTelegram(...)`.
- Extended identity-service regression coverage in `src/tests/run.ts`.

### Verification

- Planned verification:
  - `npm run typecheck`
  - `npm run build`
  - `npm run test`

### Notes

- This round intentionally does not remove `upsertTenantUserFromTelegram`.
- The aim is to make the production identity sync path project-first before shrinking the compatibility surface further.

## 2026-04-21 - P1-1 tenant-vault permission input prefers canManageProject

### Goal

- Continue phase `P1-1` by reducing tenant-named permission wiring inside the tenant-vault module.
- Make the module consume `canManageProject` as its primary management permission dependency.
- Keep behavior unchanged by reusing the existing project-manage logic.

### Changes

- Updated `src/services/use-cases/delivery-tenant-vault.ts` so the module now depends on:
  - `canManageProject(...)`
  instead of:
  - `isTenantAdmin(...)`
- Updated `src/services/use-cases/delivery.ts` wiring to pass `canManageProject`.
- Updated affected tests in `src/tests/run.ts` to match the new dependency name.

### Verification

- Planned verification:
  - `npm run typecheck`
  - `npm run build`
  - `npm run test`

### Notes

- This round intentionally does not change the underlying authorization rules.
- The aim is to shrink tenant-oriented dependency naming inside the service layer while keeping runtime behavior stable.

## 2026-04-21 - P1-1 remove unused identity compatibility aliases from delivery service

### Goal

- Continue compatibility shrink on the identity surface using the existing inventory.
- Remove legacy aliases that no longer have production callers.
- Keep `getTenantUserLabel` because the UI fallback still depends on it.

### Changes

- Removed unused identity compatibility aliases from the delivery-service surface:
  - `isTenantUser`
  - `canManageAdmins`
  - `canManageCollections`
- Updated:
  - `src/services/use-cases/delivery.ts`
  - `src/services/use-cases/delivery-factories.ts`
  - `src/tests/run.ts`
- Updated compatibility inventory in `docs/DELIVERY_SERVICE_COMPAT_SHRINK.md`.

### Verification

- Planned verification:
  - `npm run typecheck`
  - `npm run build`
  - `npm run test`

### Notes

- `getTenantUserLabel` remains intentionally because [ui-utils.ts](E:/MU/chucun/src/bot/tenant/ui-utils.ts) still uses it as a fallback.
- This round only removes aliases with no remaining production dependency under `src/`.

## 2026-04-21 - P1-1 remove tenant user label fallback from production path

### Goal

- Finish the last remaining identity compatibility fallback still used in production code.
- Make UI-side stored label resolution depend only on `getProjectUserLabel`.
- Remove `getTenantUserLabel` from the delivery-service identity surface after production callers are gone.

### Changes

- Updated `src/bot/tenant/ui-utils.ts` so `resolveUserLabel(...)` now reads only from `getProjectUserLabel(...)`.
- Removed `getTenantUserLabel` from:
  - `src/services/use-cases/delivery.ts`
  - `src/services/use-cases/delivery-factories.ts`
  - `src/services/use-cases/delivery-tenant-vault.ts`
- Removed obsolete compatibility assertions from `src/tests/run.ts`.
- Updated `docs/DELIVERY_SERVICE_COMPAT_SHRINK.md` to mark `getTenantUserLabel` as removed.

### Verification

- Planned verification:
  - `npm run typecheck`
  - `npm run build`
  - `npm run test`

### Notes

- This round removes the final identity compatibility member that still had a production caller.
- The production label-resolution path is now fully project-first.

## 2026-04-21 - P0-3 replication worker local naming prefers project wording

### Goal

- Continue phase `P0-3` by shrinking tenant-oriented wording inside the replication worker implementation.
- Keep all Prisma field names and replication decisions unchanged.
- Limit scope to local variable usage and worker log operation names.

### Changes

- Updated `src/worker/replication-worker.ts` so the min-replica setting lookup now uses the local `projectId` alias instead of `batch.tenantId`.
- Renamed the replication worker topic-upsert log op from `tenant_topic_upsert` to `project_topic_upsert`.
- Updated `src/worker/helpers.ts` so Telegram user backfill failures now log under `project_user_upsert` with `projectId` metadata.

### Verification

- Planned verification:
  - `npm run typecheck`
  - `npm run build`
  - `npm run test`

### Notes

- This round intentionally does not rename Prisma schema fields such as `tenantId`.
- The aim is to keep shrinking worker-internal tenant wording without widening into behavior changes.

## 2026-04-21 - P1-3 README and deploy docs prefer project-first ops wording

### Goal

- Continue phase `P1-3` by making public-facing ops/preflight documentation project-first.
- Keep tenant-oriented commands and endpoints documented only as compatibility paths.
- Avoid changing runtime behavior in this round.

### Changes

- Updated `README.md` so:
  - ops auth wording now points to `/ops/project-check`
  - manual preflight now recommends `npm run preflight:project`
  - tenant-named preflight/ops endpoints are documented only as compatibility entries
- Updated `docs/SINGLE_OWNER_STATUS.md` to describe `EXPECTED_TENANT_CODE` as the production project code.

### Verification

- Planned verification:
  - `npm run typecheck`
  - `npm run build`
  - `npm run test`

### Notes

- This round is documentation-only.
- The runtime compatibility paths remain available: `preflight:tenant` and `/ops/tenant-check`.

## 2026-04-21 - P1-1 internal tenant local naming in vault/admin modules continues shrinking

### Goal

- Continue the main code-path cleanup inside `delivery-tenant-vault.ts` and `delivery-admin.ts`.
- Reduce internal tenant-oriented local naming while keeping database fields and behavior unchanged.
- Keep the change scoped to local variables and injected permission dependency wording.

### Changes

- Updated `src/services/use-cases/delivery-tenant-vault.ts`:
  - local runtime ids now consistently use `projectId`
  - `ensureInitialOwner` dependency is named with `projectId`
- Updated `src/services/use-cases/delivery-admin.ts`:
  - injected management dependency is fully `canManageProject`
  - multiple local `tenantId` variables in broadcast-related paths now use `projectId`
- Updated `src/services/use-cases/delivery.ts` wiring to match the new admin/vault dependency wording.
- Updated affected tests in `src/tests/run.ts`.

### Verification

- Planned verification:
  - `npm run typecheck`
  - `npm run build`
  - `npm run test`

### Notes

- This round intentionally does not rename Prisma fields such as `tenantId`.
- The aim is to keep shrinking tenant wording inside implementation modules without widening into schema or behavior changes.

## 2026-04-21 - P1-1 discovery and replica-selection gain project-first entrypoints

### Goal

- Continue the module-level cleanup pattern already applied to vault/admin modules.
- Introduce project-first entrypoint names for discovery and replica-selection modules.
- Switch production service assembly to the new neutral entrypoints while keeping old names as compatibility aliases.

### Changes

- Added `createProjectDiscovery` in `src/services/use-cases/delivery-discovery.ts`.
- Added `createProjectReplicaSelection` in `src/services/use-cases/delivery-replica-selection.ts`.
- Kept:
  - `createDeliveryDiscovery`
  - `createDeliveryReplicaSelection`
  as compatibility aliases.
- Updated `src/services/use-cases/delivery.ts` to assemble production code through:
  - `createProjectDiscovery(...)`
  - `createProjectReplicaSelection(...)`
- Added alias regression coverage in `src/tests/run.ts`.

### Verification

- Planned verification:
  - `npm run typecheck`
  - `npm run build`
  - `npm run test`

### Notes

- This round changes entrypoint naming only.
- No discovery or replica-selection behavior was changed.

## 2026-04-21 - P2-1 delivery core and project vault local/log wording continue shrinking

### Goal

- Continue phase `P2-1` by shrinking the most visible tenant-oriented local names and log metadata in core service modules.
- Keep runtime behavior and Prisma field names unchanged.
- Limit scope to `delivery-core` and `delivery-tenant-vault`.

### Changes

- Updated `src/services/use-cases/delivery-core.ts`:
  - `bootstrapTenantSettings` -> `bootstrapProjectSettings`
  - `ensureTenant` -> `ensureProjectContext`
  - local owner-bootstrap inputs now use `projectId`
  - bootstrap log metadata now uses `projectId`
- Updated `src/services/use-cases/delivery-tenant-vault.ts`:
  - log `component` names for backup-binding and replica-bad paths now use `delivery_project_vault`
  - log metadata remains project-first where already available

### Verification

- Planned verification:
  - `npm run typecheck`
  - `npm run build`
  - `npm run test`

### Notes

- This round intentionally does not rename Prisma fields such as `tenantId`.
- The aim is to make internal code reading and logs feel more consistently project-first.

## 2026-04-21 - P2-1 bot runtime entry uses neutral project wrapper

### Goal

- Start reducing direct production imports from `bot/tenant/*` without renaming the directory itself.
- Add a neutral project-oriented wrapper entry for bot registration.
- Keep the tenant implementation path as the compatibility layer.

### Changes

- Added `src/bot/project/index.ts` with:
  - `registerProjectBot`
  - internally mapped to `registerTenantBot`
- Updated `src/bot.ts` so production bot assembly now imports and uses `registerProjectBot(...)`.

### Verification

- Planned verification:
  - `npm run typecheck`
  - `npm run build`
  - `npm run test`

### Notes

- This round intentionally does not rename `src/bot/tenant/*`.
- The aim is to let production code stop importing the tenant path directly before any future directory-level migration.

## 2026-04-21 - P2-1 bot project wrapper re-exports high-level tenant entrypoints

### Goal

- Continue reducing direct future dependence on `bot/tenant/*` without renaming the directory.
- Expose the main bot high-level entrypoints through `src/bot/project/index.ts`.
- Keep tenant-named entrypoints as compatibility implementations.

### Changes

- Updated `src/bot/project/index.ts` to re-export project-oriented aliases for:
  - renderers
  - commands
  - message handlers
  - middlewares
  - callback routes
- Added a focused alias regression test in `src/tests/run.ts`.

### Verification

- Planned verification:
  - `npm run typecheck`
  - `npm run build`
  - `npm run test`

### Notes

- This round is wrapper-only and does not change bot behavior.
- The goal is to make future production imports able to stay on the neutral `bot/project` path.

## 2026-04-21 - P2-1 bot project wrapper gains per-module neutral entrypoints

### Goal

- Continue the neutral bot-wrapper path without touching `bot/tenant/*` implementation files.
- Expose per-module project-oriented wrapper files so future imports do not need to rely on a single aggregate index.
- Keep tenant-named bot modules as the compatibility implementation layer.

### Changes

- Added:
  - `src/bot/project/renderers.ts`
  - `src/bot/project/commands.ts`
  - `src/bot/project/messages.ts`
  - `src/bot/project/middlewares.ts`
  - `src/bot/project/callbacks.ts`
- Updated `src/bot/project/index.ts` to re-export from the new project wrapper modules.
- Added direct wrapper regression coverage in `src/tests/run.ts`.

### Verification

- Planned verification:
  - `npm run typecheck`
  - `npm run build`
  - `npm run test`

### Notes

- This round is still wrapper-only and does not change bot behavior.
- The goal is to make later import-path cleanup incremental and low risk.

## 2026-04-21 - P2-1 bot high-frequency log components continue moving to project wording

### Goal

- Continue phase `P2-1` by reducing tenant-oriented log context in high-frequency bot paths.
- Keep behavior unchanged and avoid touching directory layout.
- Limit scope to command tracking, message flows, and collection-management callbacks.

### Changes

- Updated log components in:
  - `src/bot/tenant/register-commands.ts`
  - `src/bot/tenant/register-messages.ts`
  - `src/bot/tenant/callbacks/admin-collections.ts`
- Replaced the most visible bot log components with project-oriented names such as:
  - `project_bot`
  - `project_admin`

### Verification

- Planned verification:
  - `npm run typecheck`
  - `npm run build`
  - `npm run test`

### Notes

- This round changes only log `component` metadata.
- No bot behavior or routing logic was changed.

## 2026-04-21 05:49 - 生产人工验收记录

### 结果

- 版本：`99d696514d769d52e221acd59b3ccc22ff8a3ca9`
- 验收人：`didumi`
- 基础可用性：通过
- 旧链接兼容性：通过
- 新上传链路：通过
- 设置读写：通过
- 搜索与标签：通过
- 历史 / 列表：通过
- 推送链路：通过
- Worker / 副本：通过
- 权限边界：通过
- 结论：可以稳定运行
- 备注：可继续执行

### 判断

- 当前版本已满足进入 schema 清理设计阶段的前置条件之一：生产人工验收通过。
- 下一步应优先进行 schema 清理设计与回滚方案设计，暂不直接执行破坏性数据库迁移。

## 2026-04-21 - 阶段 A 三轮复演完成，阶段 B 已开始进入 P0 双写与低风险切读

### 本轮目标

- 把 schema 清理准备从“文档设计”推进到“真实可复演”
- 用生产备份恢复库验证阶段 A 的 P0 方案
- 在此基础上启动阶段 B，但只处理 P0 范围内最集中的双写和低风险切读

### 实际改动

- 完成了阶段 A 的真实落地与复演链：
  - 修改 `prisma/schema.prisma`，为 P0 表加入 nullable `projectId`
  - 生成 `prisma/migrations/20260421090000_add_project_id_phase_a_p0/migration.sql`
  - 新增 `scripts/schema-phase-a-backfill.sql`
  - 新增并补齐阶段 A 文档链
- 完成了三轮阶段 A 复演：
  - 本地当前库
  - 独立 shadow 库
  - 生产备份恢复库
- 通过生产备份恢复库确认了一个关键事实：
  - 当前生产运行命中 `vault`
  - 但数据库内仍存在真实历史 tenant `prod`
- 在此基础上启动了阶段 B 的 P0 双写：
  - `src/services/use-cases/delivery-storage.ts`
  - `src/services/use-cases/delivery-tenant-vault.ts`
  - `src/services/use-cases/delivery-core.ts`
  - `src/services/use-cases/upload.ts`
  - `src/services/use-cases/delivery-admin.ts`
- 启动了阶段 B 的低风险切读，当前已落地：
  - `src/services/use-cases/delivery-storage.ts`
  - `src/services/use-cases/delivery-tenant-vault.ts`
  - `src/services/use-cases/delivery-admin.ts`
  - `src/services/use-cases/delivery-core.ts`
  - `src/services/use-cases/upload.ts`
- 补充并更新了对应测试，确保：
  - 双写入口会同时落 `tenantId/projectId`
  - 切读入口遵循“先 `projectId`，后 `tenantId` 回退”

### 已验证内容

- 阶段 A 三轮复演全部通过
- 生产备份恢复库上的 A1/A2 通过
- 当前代码验证持续通过：
  - `npm run build`
  - `npm run test`

### 未解决问题

- 阶段 B 目前仍只覆盖 P0 和低风险读取入口
- 更高风险的发现链路、内容主链路切读尚未开始
- 当前数据库仍是多 tenant 兼容内核，不能把 `vault` 的当前运行态误当成“库里只剩一个项目”

### 风险与观察

- 阶段 A 已可认为“可重复执行”，但仍不等于可直接生产清理
- 阶段 B 以后最大的风险不是代码本身，而是语义误判：
  - 把“当前运行 tenant = vault”误判成“库里只有 vault”
  - 进而误伤 `prod` 历史数据
- 当前最稳妥路线仍然是：
  - 保持 `tenantId` 兼容路径
  - 局部双写
  - 局部 project-first 读，失败时回退

### 下一轮建议

- 先基于当前状态做一份阶段 B 状态快照
- 再决定是否继续推进更高风险的发现链路切读
- 在真正扩大切读范围前，保持每一轮只处理一个封闭入口并持续验证

## 2026-04-21 - 阶段 B 从 P0 低风险切读推进到 discovery 管理链路

### 本轮目标

- 在不直接碰搜索 / 标签整条链的前提下，开始推进 discovery 的更高风险入口
- 保持“单文件、小步、可验证”的节奏
- 优先处理用户内容管理、回收/恢复、用户/社区列表这类封闭入口

### 实际改动

- 继续推进阶段 B 的低风险切读：
  - `src/services/use-cases/delivery-storage.ts`
    - `getPreference`
    - `getSetting`
    - 已实现“先 `projectId`，后 `tenantId` 回退”
  - `src/services/use-cases/delivery-tenant-vault.ts`
    - `getProjectUserLabel`
    - 已实现“先 `projectId`，后 `tenantId` 回退”
  - `src/services/use-cases/delivery-admin.ts`
    - `listMyBroadcasts`
    - `getBroadcastById`
    - 已实现“先 `projectId`，后 `tenantId` 回退”
  - `src/services/use-cases/delivery-core.ts`
    - `getProjectMinReplicas`
    - 已实现“先 `projectId_key`，后 `tenantId_key` 回退”
  - `src/services/use-cases/upload.ts`
    - `getTenantSetting`
    - `updateAssetCollection`
    - `updateAssetMeta` 中自动分类的 `collection.findMany`
    - 已实现 project-first fallback
- 开始推进 discovery 管理链路：
  - `src/services/use-cases/delivery-discovery.ts`
    - `getUserAssetMeta`
    - `listUserBatches`
    - `listProjectBatches`
    - `listUserRecycledAssets`
    - `deleteUserAsset`
    - `recycleUserAsset`
    - `restoreUserAsset`
  - 上述入口已逐步实现“先 `projectId`，后 `tenantId` 回退”
- 同步补强了 `src/tests/run.ts`：
  - 为每个入口新增或升级了 project-first fallback 断言
  - 为 discovery 的删除 / 回收 / 恢复链路补齐了对应验证

### 已验证内容

- 持续验证通过：
  - `npm run build`
  - `npm run test`
- 当前测试结果已推进到：
  - `123/123 passed`（补强了删除事务内部清理断言）
  - `123/123 passed`（补强了恢复事务内部 key 清理断言）
  - `123/123 passed`（补强了删除事务内评论/点赞/标签清理断言）
  - `124/124 passed`（补强了用户打开历史的 project-first fallback）
  - `125/125 passed`（补强了用户点赞列表的 project-first fallback）
  - `127/127 passed`（补强了 Tag 查询入口的安全回退）
  - `127/127 passed`（batch 列表 where 增加 asset scope 过滤）
  - `128/128 passed`（补齐 listUserBatches collectionId 的 scope 回退验证）
  - `129/129 passed`（补齐 listProjectBatches collectionId 的 scope 回退验证）
  - `130/130 passed`（补齐 listProjectBatches date 的范围与 scope 回退验证）
  - `131/131 passed`（补齐 listUserBatches date 的范围与 scope 回退验证）
  - `132/132 passed`（补齐 listUserLikedAssets since 的范围与 scope 回退验证）
  - `133/133 passed`（补齐 listUserOpenHistory since 的范围与 scope 回退验证）
  - `135/135 passed`（补齐 listTopTags 分页回退边界验证）

### 未解决问题

- 更大范围发现链路仍有空白：例如更复杂的搜索/排序组合、更多 tag 入口（如 `getTagByName` 驱动的链路）
- 当前 discovery 的事务删除/回收逻辑内部仍保留 `tenantId` 兼容条件
- 生产数据库仍是双 tenant 现实，后续切读不能只盯住当前运行 tenant `vault`

### 风险与观察

- 当前 discovery 的推进方式是正确的：
  - 先单点
  - 先封闭入口
  - 每次都补测试
- 当前已开始切 `searchAssets`，后续仍需坚持小步推进与回归测试闭环
- 当前仍应坚持：
  - 新读优先 `projectId`
  - 读不到回退 `tenantId`
  - 不提前删掉兼容条件

### 下一轮建议

- 先基于当前实现做阶段 B 状态快照
- 如果继续推进 discovery，优先保持同样节奏：
  - 一次只处理一个入口
  - 先用户管理/列表，再搜索/标签
- 在进入搜索/标签大范围切读前，继续保持 build/test 每轮闭环

## 2026-04-22 - 生产 backfill 完成，Bot 主入口与测试主语完成收口

### 本轮目标

- 将生产数据库推进到 Phase A backfill 完成态
- 把 Bot 主入口从 `tenant` 兼容层彻底收口到 `project`
- 让测试默认主语切到 `project`
- 为生产观察期准备巡检模板

### 实际改动

- 生产环境：
  - 提交并推送发布版本
  - 记录生产配置留档与备份动作
  - 部署到生产环境并通过健康检查
  - 执行 `scripts/schema-phase-a-backfill.sql`
  - 回填后执行生产一致性巡检
- Bot 架构：
  - `src/bot/project/index.ts` 成为真实主入口
  - 共享 core 迁到 `src/bot/project/register-core.ts`
  - `src/bot/project/composition.ts` 接管大部分装配骨架
  - `src/bot/tenant/index.ts` 退化为兼容壳层
  - `src/bot/tenant/register-core.ts` 退化为兼容 re-export
- 测试主语：
  - 顶部静态导入已全部切离 `bot/tenant/*`
  - 低风险的 renderers / messages / builders / labels / keyboards / open / social / admin-input 测试已转向 `project`
  - tenant 兼容层依赖只保留在少量动态兼容断言里
- 生产观察期：
  - 新增 `scripts/project-observation-audit.sql`
  - 新增 `docs/PRODUCTION_OBSERVATION_RUNBOOK.md`
  - 新增 `docs/PRODUCTION_DEPLOY_RECORD_20260422.md`

### 已验证内容

- 本地：
  - `npm run test`
  - `npm run build`
- 生产：
  - `docker compose ps`
  - `/health/ready`
  - `/ops/project-check`
- 生产回填结果：
  - 目标表 `projectId is null = 0`
  - 目标表 `projectId is distinct from tenantId = 0`

### 未解决问题

- 业务与 schema 仍保留 `Tenant*` 与 `tenantId` 兼容结构
- `src/bot/tenant/*` 目录本身仍然存在，尚未进入目录级重命名
- 部分服务层查询仍可继续推进到更高比例的 project-first
- 生产观察期尚未完成 `24h / 72h / 7d` 的持续验证

### 风险与观察

- 当前已不适合立刻做破坏性 schema 清理
- 当前最重要的不是继续删结构，而是观察新增写入是否持续稳定双写
- `prod` 与 `vault` 两个历史项目仍然同时存在，不能误判成物理单项目态

### 下一轮建议

- 优先执行生产 `24h` 观察期巡检
- 观察稳定后，再推进下一批 production-safe `project-first` 读路径切换
- 持续同步 `DETENANT_EXECUTION_MATRIX.md` 与 `SINGLE_OWNER_STATUS.md`
## 2026-04-23 - Low-risk project-first cleanup continued during observation

### Goal

- Keep the production observation window as the gate for high-risk cleanup only.
- Continue low-risk compatible refactors that do not remove fallback behavior.
- Record concrete evidence that observation is not blocking ongoing detenant progress.

### Changes

- Continued `src/bot/project/*` wrapper consolidation and reduced direct future dependence on tenant-named entrypoints.
- Continued service assembly cleanup by switching more aggregation imports to project wrapper modules.
- Continued implementation-level naming cleanup in:
  - `src/services/use-cases/delivery-core.ts`
  - `src/services/use-cases/upload.ts`
  - `src/services/use-cases/delivery-discovery.ts`
  - `src/services/use-cases/delivery-tenant-vault.ts`
- Moved some old tenant-oriented names into explicit compatibility alias layers instead of leaving them on the primary project path.

### Verification

- Repeated local verification remained green throughout these rounds:
  - `npm run build`
  - `npm run test`
- Current result:
  - `195/195 passed`

### Notes

- Observation still gates:
  - schema cleanup
  - deleting tenant fallback
  - deleting `tenantId` / `Tenant*`
  - other irreversible migration steps
- Observation does not gate:
  - wrapper consolidation
  - naming cleanup
  - compatible service/worker/upload/discovery refactors
  - regression tests and documentation sync

## 2026-04-23 - Production prod -> vault merge completed

### Goal

- Consolidate the historical `prod` business dataset into the active `vault` project.
- Preserve asset ids and share codes instead of deleting the smaller tenant directly.
- Convert production from “two active business tenants” into “one active project + one empty shell tenant”.

### Changes

- Created and validated production pre-merge backups:
  - `/root/vaultbot/backups/prod_to_vault_premerge_20260422_232940.dump`
  - `/root/vaultbot/backups/prod_to_vault_premerge_live_20260422_234235.dump`
- Added merge preparation and execution artifacts:
  - `scripts/prod-to-vault-precheck.sql`
  - `scripts/prod-to-vault-merge.sql`
  - `scripts/prod-to-vault-postcheck.sql`
  - `docs/PROD_TO_VAULT_MERGE_RUNBOOK.md`
- Rehearsed the full merge against a restored backup database.
- Fixed rehearsal-discovered issues in the merge SQL:
  - explicit `Tag.id`
  - corrected `Tag` insert column list
- Executed the production merge inside a maintenance window:
  - stopped `vaultbot-app-1`
  - stopped `vaultbot-worker-1`
  - ran precheck
  - ran merge
  - ran postcheck
  - restarted app and worker

### Verified

- Production postcheck showed `prod` business rows reduced to `0` across the migrated tables.
- `/ops/project-check` now shows:
  - `prod`: `assets=0 events=0 users=0 batches=0`
  - `vault`: inherited the consolidated counts
- Immediate production observation showed:
  - recent writes only distributed to `vault`
  - `recent_project_id_null_rows = 0`
  - `recent_project_tenant_mismatch_rows = 0`

### Remaining Issues

- `prod` still exists as an empty `Tenant` shell.
- `tenantId` / `Tenant*` compatibility structures remain widely used by code and schema.
- This merge solved the data-surface split, not the final schema detenant work.

### Risk And Observation

- The major risk has shifted:
  - from “two business tenants coexist”
  - to “do not prematurely treat the system as fully detenantized”
- Production still requires `24h / 72h` observation before deleting the empty `prod` shell or starting any destructive cleanup.

### Next Suggested Step

- Complete the `24h` observation record first.
- In parallel, prepare the post-merge Phase B execution checklist and project-first ops/script cleanup.

## 2026-04-26 - Post-observation empty prod shell cleanup prepared

### Goal

- Move forward after production observation passed.
- Keep the next step narrow: delete only the empty `prod` shell when production precheck confirms it is still empty.
- Continue project-first ops cleanup without removing tenant schema compatibility.

### Changes

- Strengthened the empty `prod` shell deletion scripts:
  - `scripts/delete-empty-prod-tenant-precheck.sql`
  - `scripts/delete-empty-prod-tenant.sql`
  - `scripts/delete-empty-prod-tenant-postcheck.sql`
- Added missing checks for:
  - `Collection`
  - `PermissionRule`
  - `Broadcast.tenantId`
  - `Collection.projectId`
- Updated `docs/PROD_TO_VAULT_MERGE_RUNBOOK.md` with the production sequence for deleting the empty `prod` shell.
- Added project-first drift-protection env names:
  - `EXPECTED_PROJECT_CODE`
  - `REQUIRE_EXISTING_PROJECT`
  - `ALLOW_PROJECT_CODE_MISMATCH`
- Kept legacy fallback env names working:
  - `EXPECTED_TENANT_CODE`
  - `REQUIRE_EXISTING_TENANT`
  - `ALLOW_TENANT_CODE_MISMATCH`
- Updated `.env.example`, `README.md`, and `docs/PROJECT_FIRST_OPS_ADDENDUM_20260423.md`.
- Narrowed replication scheduler batch scans to the runtime project:
  - `src/worker/replication-scheduler.ts`
  - active `projectId = runtimeProjectId` rows are preferred
  - legacy `projectId is null and tenantId = runtimeProjectId` rows remain readable
- Wrapped replication worker storage-routing calls behind project-named helpers:
  - `listProjectVaultBindings`
  - `ensureProjectPrimaryVaultBinding`
  - `findProjectTopic`
  - `upsertProjectTopicThreadId`
  - these helpers still use existing `TenantVaultBinding` / `TenantTopic` storage internally
- Wrapped replication worker setting reads behind project-named helpers:
  - `getProjectSettingValue`
  - `getProjectMinReplicasSetting`
  - these helpers prefer `projectId_key` and fall back to `tenantId_key`
- Moved worker project routing helpers into `src/worker/project-routing.ts` so `replication-worker.ts` stays focused on replication flow.
- Moved worker project audience/user helpers into `src/worker/project-audience.ts` while keeping compatibility re-exports from `src/worker/helpers.ts`.
- Updated `src/worker/index.ts` and worker tests to import project audience helpers directly from `src/worker/project-audience.ts`.
- Renamed worker audience tests from generic `worker-helper` wording to `worker project-audience` wording.
- Extracted `withProjectTenantFallback` into `src/services/use-cases/project-fallback.ts` so future service cleanup can reuse a single project-first fallback primitive without depending on discovery.
- Extracted discovery project-scope helpers into `src/services/use-cases/delivery-project-scope.ts`:
  - `findOwnedProjectCommittedBatch`
  - `findProjectAssetById`
  - `listProjectHistoryAssetsByIds`
  - `listProjectRecycledAssets`
  - `listProjectCommittedBatches`
  - `listProjectOpenHistory`
  - `listProjectLikedAssets`
  - `searchProjectAssets`
- Extracted command-style asset helpers into `src/services/use-cases/delivery-project-assets.ts`:
  - `getProjectUserAssetMeta`
  - `setProjectUserAssetSearchable`
  - `deleteProjectUserAsset`
  - `recycleProjectUserAsset`
  - `restoreProjectUserAsset`
- Extracted discovery tag helpers into `src/services/use-cases/delivery-project-tags.ts`:
  - `normalizeTagName`
  - `extractHashtags`
  - `findProjectTagById`
  - `findProjectTagByName`
  - `listProjectTopTags`
  - `listProjectAssetsByTagId`
  - `backfillProjectTagsIfEmpty`
- Kept `delivery-discovery.ts` as the public discovery facade while delegating tag lookup, top-tag aggregation, tag asset listing, and project/tenant fallback details to `delivery-project-tags.ts`.

### Verified

- `npm run build`
- `npm run test`
- Current result: `215/215 passed`

### Remaining Issues

- Production execution still needs to run the delete-empty-prod precheck/delete/postcheck sequence.
- `Tenant*` models and `tenantId` columns remain compatibility structures.
- Schema cleanup is still blocked until after the empty shell deletion is verified and a separate destructive cleanup decision is made.

### Next Suggested Step

- Execute the empty `prod` shell deletion sequence in production with a fresh backup.
- After it passes, continue Phase B project-first cleanup in worker/discovery/ops paths.

## 2026-04-27 - Phase B project-first ops cleanup

### Goal

- Continue compatible Phase B cleanup in the ops path.
- Keep `/ops/tenant-check` and legacy precheck entrypoints working, but make the primary implementation project-first.

### Changes

- Updated `src/server.ts` so `/ops/tenant-check` now reuses `getProjectDiagnostics` and converts the result to the legacy tenant-shaped response at the route boundary.
- Removed the server dependency injection path for `getTenantDiagnostics`; tests now only inject project diagnostics.
- Updated `src/scripts/project-precheck.ts` to prefer `EXPECTED_PROJECT_CODE` and fall back to legacy `EXPECTED_TENANT_CODE`.
- Cleaned the project precheck output to use project-first labels.
- Added `withProjectFallback` as the project-first fallback primitive and kept `withProjectTenantFallback` as a compatibility alias.
- Updated discovery project-scope and project-tag modules to use `withProjectFallback` / `queryByFallback` naming.
- Narrowed worker error log metadata typing by removing the unused `tenantId` field from `logWorkerError`.
- Updated `docs/DETENANT_EXECUTION_MATRIX.md` to mark ops diagnostics as mostly complete, with `/ops/tenant-check` explicitly treated as a compatibility route.

### Compatibility Kept

- `/ops/tenant-check` still returns `currentTenantCode` and `tenants` for old callers.
- `src/scripts/tenant-precheck.ts` still imports the project precheck compatibility implementation.
- Legacy `EXPECTED_TENANT_CODE` remains a fallback.
- Existing callers of `withProjectTenantFallback` remain supported through the compatibility alias.

### Verified

- `npm run build`
- `npm run test`
- Current result: `215/215 passed`

### Remaining Issues

- Broader docs still contain historical tenant wording.
- Worker/discovery cleanup can continue in later narrow rounds without schema cleanup.

## 2026-04-27 - Schema cleanup readiness gate

### Goal

- Accept that the next step is readiness assessment, not immediate `Tenant*` / `tenantId` deletion.
- Add a concrete audit path for deciding when destructive schema cleanup can be considered.

### Changes

- Added `scripts/schema-cleanup-readiness-audit.sql`.
  - Checks active `Tenant` rows.
  - Checks existing `projectId` columns for nulls and mismatches.
  - Lists current `tenantId` footprint across business tables.
  - Checks dangling `tenantId` and `projectId` references.
  - Checks recent 24h project dual-write consistency.
- Added `docs/SCHEMA_CLEANUP_READINESS.md`.
  - Defines data, code, and migration gates.
  - Lists current blockers.
  - Documents production execution commands for the audit script.
  - Explicitly forbids destructive cleanup at this stage.
- Linked the readiness doc from `docs/SCHEMA_CLEANUP_DESIGN.md`.
- Updated `docs/DETENANT_EXECUTION_MATRIX.md` so schema cleanup is marked as "准备阶段" rather than executable cleanup.

### Compatibility Kept

- No schema changes.
- No data changes.
- No removal of `Tenant*`, `tenantId`, or compatibility routes.

### Next Suggested Step

- Run the readiness audit against production and paste the output into `docs/SCHEMA_CLEANUP_INVENTORY.md` or a dated production readiness record.

### Production Audit Follow-up

- Synced `scripts/schema-cleanup-readiness-audit.sql` to production.
- Ran the read-only audit against `vaultbot-postgres-1`.
- Saved production output to `/root/vaultbot/backups/schema_cleanup_readiness_20260427_042215.txt`.
- Added `docs/SCHEMA_CLEANUP_PROD_READINESS_20260427.md`.
- Production data gates are green:
  - one `Tenant`: `vault`
  - existing `projectId` columns have `0` null rows
  - existing `projectId` columns have `0` tenant mismatch rows
  - dangling `tenantId` and `projectId` references are `0`
  - recent 24h project dual-write checks are `0`
- Destructive cleanup remains blocked because compatibility tables still carry real state:
  - `TenantMember=2`
  - `TenantSetting=10`
  - `TenantTopic=2`
  - `TenantUser=3356`
  - `TenantVaultBinding=2`
  - `VaultGroup=2`

## 2026-04-27 - Phase C additive projectId migration and code deploy applied to production

### Goal

- Stop waiting on observation-only status and advance the schema toward project-first cleanup.
- Add `projectId` compatibility fields to the remaining tenant-scoped tables without deleting old fields.
- Deploy matching app/worker code so new writes dual-write `tenantId/projectId`.

### Local Changes

- Added migration `prisma/migrations/20260427090000_add_project_id_phase_c_compat/migration.sql`.
- Updated `prisma/schema.prisma` with nullable `projectId` fields and indexes/unique constraints for:
  - `TenantMember`
  - `VaultGroup`
  - `TenantVaultBinding`
  - `TenantTopic`
  - `Tag`
  - `AssetTag`
  - `PermissionRule`
  - `AssetComment`
  - `AssetCommentLike`
  - `AssetLike`
- Updated writes to dual-write `projectId` in:
  - tag sync/backfill
  - social comment/like writes
  - project manager writes
  - vault group / binding / topic writes
  - worker project routing writes
- Updated readiness audit to cover the new Phase C tables.

### Production Changes

- Synced migration and updated readiness audit to `/root/vaultbot`.
- Created backup:
  - `/root/vaultbot/backups/phase_c_project_id_pre_20260427_050603.dump`
- Applied the additive migration via psql.
- Recorded the migration in `_prisma_migrations` because production host does not have `npx` available:
  - `20260427090000_add_project_id_phase_c_compat`
  - checksum `26d8add152ec0f7acde68a9429a956a9cca84010ab0732eda5867cfe530fb964`
- Saved post-migration audit:
  - `/root/vaultbot/backups/schema_cleanup_readiness_after_phase_c_20260427_050603.txt`
- Added deployment record:
  - `docs/PHASE_C_PROJECT_ID_DEPLOY_20260427.md`
- Deployed matching source files to production and rebuilt:
  - `docker compose up -d --build app worker`
  - image `vaultbot:latest f0fd2133370e`
- Confirmed `/health/ready`:
  - `database = true`
  - `redis = true`
- Saved post-code-deploy audit:
  - `/root/vaultbot/backups/schema_cleanup_readiness_after_code_deploy_20260427_073145.txt`

### Production Result

- All 18 audited tenant-scoped tables now have `projectId` populated.
- Post-migration audit showed:
  - `project_id_null_rows = 0`
  - `project_tenant_mismatch_rows = 0`
  - dangling `tenantId` references = `0`
  - dangling `projectId` references = `0`
  - recent 24h project dual-write checks = `0`
- `/ops/project-check` remained healthy:
  - `currentProjectCode = vault`
  - `matched = true`
  - `assets = 952`
  - `events = 133329`
  - `users = 3358`
  - `batches = 952`
- A short rebuild-window drift was found from the old running code:
  - `Tag.projectId is null = 5`
  - `AssetTag.projectId is null = 12`
- Backfilled those rows with `projectId = tenantId`.
- Final post-code-deploy readiness audit showed:
  - all 18 audited tables `project_id_null_rows = 0`
  - all 18 audited tables `project_tenant_mismatch_rows = 0`
  - dangling `tenantId` references = `0`
  - dangling `projectId` references = `0`
  - recent 24h project dual-write checks = `0`

### Verified Locally

- `npx prisma validate`
- `npm run prisma:generate`
- `npm run build`
- `npm run test`
- Current result: `215/215 passed`

### Remaining Work

- Commit/review the local Phase B/C cleanup changes.
- Monitor deployed dual-write paths briefly with the readiness audit.
- Plan destructive `Tenant*` / `tenantId` deletion as Phase D, not as an inline follow-up to Phase C.
