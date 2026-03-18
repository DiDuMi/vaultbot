# Delivery 模块职责图

## 装配入口

- `src/services/use-cases/delivery.ts`
  - 负责依赖初始化与模块装配
  - 统一对外导出 `DeliveryService`

## 核心模块

- `delivery-core.ts`
  - 租户上下文初始化
  - 管理员判定
  - 搜索模式与最小副本设置
  - 打开/访问埋点
  - 日期工具函数

- `delivery-storage.ts`
  - 用户偏好与租户配置读写

- `delivery-strategy.ts`
  - 分页、limit、副本数等纯策略归一化

## 业务子域模块

- `delivery-tenant-vault.ts`
  - 租户用户、管理员、存储群、分类、Topic 映射

- `delivery-admin.ts`
  - 欢迎词、广告配置、自动归类配置、排行开关
  - 广播草稿与调度管理

- `delivery-replica-selection.ts`
  - 副本可用性判定
  - 副本写入中提示与心跳文案拼装

- `delivery-discovery.ts`
  - 搜索、标签、历史、收藏列表

- `delivery-social.ts`
  - 评论、点赞、回复线程、评论上下文

- `delivery-stats.ts`
  - 首页统计、租户统计、各维度排行

- `delivery-preferences.ts`
  - 默认分类、历史筛选、关注关键词、通知开关与通知去重

## 依赖关系

- `delivery.ts` 依赖全部子模块
- 其余子模块不相互循环依赖
- 公共能力通过 `delivery-storage.ts`、`delivery-strategy.ts`、`worker-heartbeat.ts` 复用
