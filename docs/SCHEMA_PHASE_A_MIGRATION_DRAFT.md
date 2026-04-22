# Schema 阶段 A Migration 草案

## 1. 文档定位

本文档用于把 [SCHEMA_PHASE_A_FIELD_PLAN.md](/E:/MU/chucun/docs/SCHEMA_PHASE_A_FIELD_PLAN.md) 中的 P0 表，收敛成一份可评审的 migration 草案。

它仍然不是执行文件，而是：

- 阶段 A 的具体 DDL 草案
- backfill 草案
- 验证与回滚草案

当前日期基线：`2026-04-21`

## 2. 本轮范围

本草案只覆盖 P0 表：

- `TenantSetting`
- `TenantUser`
- `UserPreference`
- `Asset`
- `Collection`
- `Event`
- `UploadBatch`
- `Broadcast`

本轮不覆盖：

- `Tag`
- `AssetComment`
- `AssetCommentLike`
- `AssetLike`
- `TenantMember`
- `TenantVaultBinding`
- `TenantTopic`
- `PermissionRule`
- `VaultGroup`
- `AssetTag`

## 3. 执行原则

- 只新增 `projectId`，不删除 `tenantId`
- 只新增索引/唯一约束，不删除旧索引/旧约束
- 先 migration，后 backfill
- 先影子环境验证，不进生产
- 默认不加新外键

## 4. Prisma 目标变更草案

以下是阶段 A 完成后，P0 表在 Prisma 层建议达到的最小状态。

### `TenantUser`

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
```

### `Asset`

```prisma
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

  @@index([tenantId, collectionId])
  @@index([projectId, collectionId])
}
```

### `Collection`

```prisma
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

  @@index([projectId])
}
```

### `Event`

```prisma
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

  @@index([tenantId, userId, type])
  @@index([projectId, userId, type])
}
```

### `UploadBatch`

```prisma
model UploadBatch {
  id        String            @id @default(cuid())
  tenantId  String
  projectId String?
  assetId   String
  userId    String
  chatId    String
  status    UploadBatchStatus
  createdAt DateTime          @default(now())
  tenant    Tenant            @relation(fields: [tenantId], references: [id])

  @@index([tenantId, assetId])
  @@index([projectId, assetId])
}
```

### `UserPreference`

```prisma
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
```

### `TenantSetting`

```prisma
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
```

### `Broadcast`

```prisma
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

  @@index([tenantId, status, nextRunAt])
  @@index([projectId, status, nextRunAt])
}
```

## 5. SQL Migration 草案

下面是按 PostgreSQL 语义编排的草案。真正执行前，建议拆成独立 migration 文件并在影子环境验证。

### 5.1 加字段

```sql
alter table "TenantUser" add column "projectId" text;
alter table "Asset" add column "projectId" text;
alter table "Collection" add column "projectId" text;
alter table "Event" add column "projectId" text;
alter table "UploadBatch" add column "projectId" text;
alter table "UserPreference" add column "projectId" text;
alter table "TenantSetting" add column "projectId" text;
alter table "Broadcast" add column "projectId" text;
```

### 5.2 加索引与唯一约束

```sql
create unique index "TenantUser_projectId_tgUserId_key"
  on "TenantUser"("projectId", "tgUserId");
create index "TenantUser_projectId_tgUserId_idx"
  on "TenantUser"("projectId", "tgUserId");
create index "TenantUser_projectId_username_idx"
  on "TenantUser"("projectId", "username");

create unique index "UserPreference_projectId_tgUserId_key_key"
  on "UserPreference"("projectId", "tgUserId", "key");
create index "UserPreference_projectId_tgUserId_idx"
  on "UserPreference"("projectId", "tgUserId");

create unique index "TenantSetting_projectId_key_key"
  on "TenantSetting"("projectId", "key");
create index "TenantSetting_projectId_idx"
  on "TenantSetting"("projectId");

create index "Asset_projectId_collectionId_idx"
  on "Asset"("projectId", "collectionId");

create index "Collection_projectId_idx"
  on "Collection"("projectId");

create index "Event_projectId_userId_type_idx"
  on "Event"("projectId", "userId", "type");

create index "UploadBatch_projectId_assetId_idx"
  on "UploadBatch"("projectId", "assetId");

create index "Broadcast_projectId_status_nextRunAt_idx"
  on "Broadcast"("projectId", "status", "nextRunAt");
```

说明：

- PostgreSQL 唯一索引允许多个 `NULL`，因此阶段 A 先加可空 `projectId` 是可行的
- 真正执行时，如需降低锁影响，可评估使用并发建索引方案，但那会影响 migration 组织方式

## 6. Backfill 草案

### 6.1 基础 backfill

```sql
update "TenantUser" set "projectId" = "tenantId" where "projectId" is null;
update "Asset" set "projectId" = "tenantId" where "projectId" is null;
update "Collection" set "projectId" = "tenantId" where "projectId" is null;
update "Event" set "projectId" = "tenantId" where "projectId" is null;
update "UploadBatch" set "projectId" = "tenantId" where "projectId" is null;
update "UserPreference" set "projectId" = "tenantId" where "projectId" is null;
update "TenantSetting" set "projectId" = "tenantId" where "projectId" is null;
update "Broadcast" set "projectId" = "tenantId" where "projectId" is null;
```

### 6.2 backfill 后校验

```sql
select count(*) as missing_project_id from "TenantUser" where "projectId" is null
union all
select count(*) from "Asset" where "projectId" is null
union all
select count(*) from "Collection" where "projectId" is null
union all
select count(*) from "Event" where "projectId" is null
union all
select count(*) from "UploadBatch" where "projectId" is null
union all
select count(*) from "UserPreference" where "projectId" is null
union all
select count(*) from "TenantSetting" where "projectId" is null
union all
select count(*) from "Broadcast" where "projectId" is null;
```

### 6.3 一致性校验

```sql
select count(*) as mismatch_count from "TenantUser" where "projectId" is distinct from "tenantId"
union all
select count(*) from "Asset" where "projectId" is distinct from "tenantId"
union all
select count(*) from "Collection" where "projectId" is distinct from "tenantId"
union all
select count(*) from "Event" where "projectId" is distinct from "tenantId"
union all
select count(*) from "UploadBatch" where "projectId" is distinct from "tenantId"
union all
select count(*) from "UserPreference" where "projectId" is distinct from "tenantId"
union all
select count(*) from "TenantSetting" where "projectId" is distinct from "tenantId"
union all
select count(*) from "Broadcast" where "projectId" is distinct from "tenantId";
```

## 7. 推荐拆分方式

不建议把阶段 A 的全部内容塞进一个大 migration。

建议拆成两步：

### Migration A1

- 给 P0 表加 `projectId`
- 给 P0 表加索引/唯一约束

### Script A2

- backfill `projectId = tenantId`
- 跑一致性校验 SQL
- 输出盘点结果

这样做的好处：

- 结构变更与数据变更分开
- 回滚更容易
- 影子环境定位问题更清晰

## 8. 验证清单

影子环境至少验证这些点：

- migration 可完整执行
- backfill 可重复执行
- 新唯一约束不会报冲突
- 配置读取仍正常
- 用户命中仍正常
- 资产、集合、上传、推送相关查询仍正常
- `npm run test`
- `npm run build`
- `npm run preflight:project`

## 9. 回滚草案

阶段 A 的回滚目标不是“自动抹掉所有新结构”，而是“可以安全停止继续推进”。

推荐回滚方式：

1. 回退应用代码，不读取 `projectId`
2. 停止后续 backfill / 双写设计
3. 保留新增字段和索引
4. 如影子环境确实需要回退结构，再单独 drop 新索引和新字段

影子环境可选回滚 SQL：

```sql
drop index if exists "TenantUser_projectId_tgUserId_key";
drop index if exists "TenantUser_projectId_tgUserId_idx";
drop index if exists "TenantUser_projectId_username_idx";
drop index if exists "UserPreference_projectId_tgUserId_key_key";
drop index if exists "UserPreference_projectId_tgUserId_idx";
drop index if exists "TenantSetting_projectId_key_key";
drop index if exists "TenantSetting_projectId_idx";
drop index if exists "Asset_projectId_collectionId_idx";
drop index if exists "Collection_projectId_idx";
drop index if exists "Event_projectId_userId_type_idx";
drop index if exists "UploadBatch_projectId_assetId_idx";
drop index if exists "Broadcast_projectId_status_nextRunAt_idx";

alter table "TenantUser" drop column if exists "projectId";
alter table "Asset" drop column if exists "projectId";
alter table "Collection" drop column if exists "projectId";
alter table "Event" drop column if exists "projectId";
alter table "UploadBatch" drop column if exists "projectId";
alter table "UserPreference" drop column if exists "projectId";
alter table "TenantSetting" drop column if exists "projectId";
alter table "Broadcast" drop column if exists "projectId";
```

说明：

- 以上只适用于影子环境或明确允许回退的非生产环境
- 生产环境不能把这份 SQL 当成默认回滚手段

## 10. 当前建议的下一步

最合适的后续顺序是：

1. 把这份草案再压缩成真正的 Prisma migration 变更清单
2. 单独写 `A2` backfill 脚本草案
3. 补一份影子环境验证 checklist
4. 确认后再决定是否创建真实 migration 文件

一句话结论：

阶段 A 现在已经可以进入“migration 草案评审”阶段，但还没有到“直接提交 Prisma schema 变更”的阶段。
