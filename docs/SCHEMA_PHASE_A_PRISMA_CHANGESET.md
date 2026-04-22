# Schema 阶段 A Prisma 变更清单

## 1. 文档定位

本文档用于把阶段 A 的 A1 部分压缩成 Prisma 侧的真实变更清单。

它承接：

- [SCHEMA_PHASE_A_FIELD_PLAN.md](/E:/MU/chucun/docs/SCHEMA_PHASE_A_FIELD_PLAN.md)
- [SCHEMA_PHASE_A_MIGRATION_DRAFT.md](/E:/MU/chucun/docs/SCHEMA_PHASE_A_MIGRATION_DRAFT.md)
- [SCHEMA_PHASE_A_SHADOW_CHECKLIST.md](/E:/MU/chucun/docs/SCHEMA_PHASE_A_SHADOW_CHECKLIST.md)

目标：

- 明确 `prisma/schema.prisma` 具体改哪些 model
- 给出建议的 migration 命名与拆分方式
- 为真正创建 migration 文件前的评审提供最小清单

它仍然不是已经执行的 schema 变更。

## 2. 当前建议的 migration 拆分

基于当前仓库的 migration 风格，建议阶段 A 继续采用“单一主题、可读命名”的方式。

### 推荐拆分

建议拆成两部分：

1. Prisma migration:
   - 只做 A1 结构变更
   - 只包含新增 `projectId` 字段、索引、唯一约束
2. SQL / runbook:
   - 继续使用 [schema-phase-a-backfill.sql](/E:/MU/chucun/scripts/schema-phase-a-backfill.sql)
   - 继续使用 [SCHEMA_PHASE_A_BACKFILL_RUNBOOK.md](/E:/MU/chucun/docs/SCHEMA_PHASE_A_BACKFILL_RUNBOOK.md)

### 推荐 migration 名

建议真实创建时使用类似名称：

- `20260421_add_project_id_phase_a_p0`

如果你更想按业务拆小，也可以拆成：

- `20260421_add_project_id_settings_and_users`
- `20260421_add_project_id_assets_and_events`
- `20260421_add_project_id_uploads_and_broadcasts`

当前更推荐单个 P0 migration。

原因：

- 阶段 A 仍是影子环境演练期
- P0 表数量可控
- 拆太细会增加 review 噪音

## 3. `schema.prisma` 变更范围

阶段 A 只建议修改以下 8 个 model：

- `TenantUser`
- `Asset`
- `Collection`
- `Event`
- `UploadBatch`
- `UserPreference`
- `TenantSetting`
- `Broadcast`

本轮不动：

- `Tenant`
- `TenantMember`
- `TenantVaultBinding`
- `TenantTopic`
- `PermissionRule`
- `VaultGroup`
- `Tag`
- `AssetTag`
- `AssetReplica`
- `UploadItem`
- `BroadcastRun`
- 互动类表

## 4. Model 级变更清单

以下清单按“最小 Prisma diff”组织。

### 4.1 `TenantUser`

需要新增：

- 字段：`projectId String?`
- 唯一约束：`@@unique([projectId, tgUserId])`
- 索引：`@@index([projectId, tgUserId])`
- 索引：`@@index([projectId, username])`

建议插入位置：

- 把 `projectId` 放在 `tenantId` 下方
- 把新的 `projectId` 约束紧跟旧 `tenantId` 约束

### 4.2 `Asset`

需要新增：

- 字段：`projectId String?`
- 索引：`@@index([projectId, collectionId])`

### 4.3 `Collection`

需要新增：

- 字段：`projectId String?`
- 索引：`@@index([projectId])`

### 4.4 `Event`

需要新增：

- 字段：`projectId String?`
- 索引：`@@index([projectId, userId, type])`

### 4.5 `UploadBatch`

需要新增：

- 字段：`projectId String?`
- 索引：`@@index([projectId, assetId])`

### 4.6 `UserPreference`

需要新增：

- 字段：`projectId String?`
- 唯一约束：`@@unique([projectId, tgUserId, key])`
- 索引：`@@index([projectId, tgUserId])`

### 4.7 `TenantSetting`

需要新增：

- 字段：`projectId String?`
- 唯一约束：`@@unique([projectId, key])`
- 索引：`@@index([projectId])`

### 4.8 `Broadcast`

需要新增：

- 字段：`projectId String?`
- 索引：`@@index([projectId, status, nextRunAt])`

## 5. 建议的 Prisma diff 形态

下面是建议的最小 diff 形态，供真正落地时参考。

```prisma
model TenantUser {
  id           String   @id @default(cuid())
  tenantId     String
  projectId    String?
  tgUserId     String
  username     String?
  firstName    String?
  lastName     String?
  languageCode String?
  isBot        Boolean  @default(false)
  lastSeenAt   DateTime @default(now())
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  tenant       Tenant   @relation(fields: [tenantId], references: [id])
  @@unique([tenantId, tgUserId])
  @@unique([projectId, tgUserId])
  @@index([tenantId, tgUserId])
  @@index([tenantId, username])
  @@index([projectId, tgUserId])
  @@index([projectId, username])
}

model Asset {
  id           String      @id @default(cuid())
  tenantId     String
  projectId    String?
  collectionId String?
  title        String
  description  String?
  shareCode    String?     @unique
  visibility   Visibility  @default(PROTECTED)
  searchable   Boolean     @default(true)
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt
  tenant       Tenant      @relation(fields: [tenantId], references: [id])
  collection   Collection? @relation(fields: [collectionId], references: [id])
  replicas     AssetReplica[]
  tags         AssetTag[]
  rules        PermissionRule[]
  events       Event[]
  uploadBatches UploadBatch[]
  comments     AssetComment[]
  likes        AssetLike[]
  @@index([tenantId, collectionId])
  @@index([projectId, collectionId])
}

model Collection {
  id         String      @id @default(cuid())
  tenantId   String
  projectId  String?
  title      String
  searchable Boolean     @default(true)
  visibility Visibility  @default(PROTECTED)
  createdAt  DateTime    @default(now())
  updatedAt  DateTime    @updatedAt
  tenant     Tenant      @relation(fields: [tenantId], references: [id])
  assets     Asset[]
  rules      PermissionRule[]
  @@index([projectId])
}

model Event {
  id        String   @id @default(cuid())
  tenantId  String
  projectId String?
  userId    String
  assetId   String?
  type      EventType
  payload   Json?
  createdAt DateTime @default(now())
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  asset     Asset?   @relation(fields: [assetId], references: [id])
  @@index([tenantId, userId, type])
  @@index([projectId, userId, type])
}

model UploadBatch {
  id        String            @id @default(cuid())
  tenantId  String
  projectId String?
  assetId   String
  userId    String
  chatId    String
  status    UploadBatchStatus
  createdAt DateTime          @default(now())
  items     UploadItem[]
  tenant    Tenant            @relation(fields: [tenantId], references: [id])
  asset     Asset             @relation(fields: [assetId], references: [id])
  @@index([tenantId, assetId])
  @@index([projectId, assetId])
}

model UserPreference {
  id        String   @id @default(cuid())
  tenantId  String
  projectId String?
  tgUserId  String
  key       String
  value     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  @@unique([tenantId, tgUserId, key])
  @@unique([projectId, tgUserId, key])
  @@index([tenantId, tgUserId])
  @@index([projectId, tgUserId])
}

model TenantSetting {
  id        String   @id @default(cuid())
  tenantId  String
  projectId String?
  key       String
  value     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  @@unique([tenantId, key])
  @@unique([projectId, key])
  @@index([tenantId])
  @@index([projectId])
}

model Broadcast {
  id            String          @id @default(cuid())
  tenantId      String
  projectId     String?
  creatorUserId String
  creatorChatId String
  status        BroadcastStatus @default(DRAFT)
  contentHtml   String
  mediaKind     String?
  mediaFileId   String?
  buttons       Json?
  nextRunAt     DateTime?
  repeatEveryMs Int?
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt
  tenant        Tenant          @relation(fields: [tenantId], references: [id])
  runs          BroadcastRun[]
  @@index([tenantId, status, nextRunAt])
  @@index([projectId, status, nextRunAt])
}
```

## 6. 生成 migration 前的检查项

在真正运行 `prisma migrate dev` 或生成 migration 之前，建议先人工确认：

- 是否仍只覆盖 P0 表
- 是否没有误把兼容表放进本轮
- 是否没有新增外键
- 是否没有把 `projectId` 设成必填
- 是否没有删除旧索引或旧约束

## 7. 真实创建 migration 时的建议顺序

如果下一步真的要开始创建 migration，建议顺序是：

1. 修改 `prisma/schema.prisma`
2. 生成 migration，但先只用于影子环境
3. 审查 migration.sql
4. 对照 [SCHEMA_PHASE_A_MIGRATION_DRAFT.md](/E:/MU/chucun/docs/SCHEMA_PHASE_A_MIGRATION_DRAFT.md) 检查是否多出意外变更
5. 再决定是否保留该 migration

## 8. 暂不建议直接做的事

- 不直接创建生产 migration
- 不直接执行 `prisma migrate deploy`
- 不顺手把 P1 表一起带上
- 不顺手补外键
- 不顺手改读路径

## 9. 当前建议的下一步

到这一步，最合理的后续路径有两个：

1. 继续保持文档阶段：
   - 停在这里，等待你确认再真正改 `schema.prisma`
2. 开始进入影子环境执行阶段：
   - 我直接创建真实的 `schema.prisma` 变更和 migration 文件，但只用于影子环境演练

一句话结论：

现在已经具备“开始创建真实 Prisma migration”的清晰清单了，但是否真正落文件，应该由你明确确认进入影子环境执行阶段后再做。
