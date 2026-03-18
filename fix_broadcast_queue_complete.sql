-- HamsterBot broadcast_queue 表结构修复脚本
-- 将数据库表结构与代码模型同步

-- 1. 添加缺失的列
ALTER TABLE broadcast_queue 
ADD COLUMN chat_id BIGINT NOT NULL DEFAULT 0 AFTER user_id,
ADD COLUMN available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER chat_id,
ADD COLUMN is_sent BOOLEAN NOT NULL DEFAULT FALSE AFTER available_at,
ADD COLUMN last_error TEXT NULL AFTER sent_at,
ADD COLUMN message_ids_json TEXT NULL AFTER last_error,
ADD COLUMN button_message_id INT NULL AFTER message_ids_json;

-- 2. 迁移现有数据
-- 将 status 转换为 is_sent
UPDATE broadcast_queue 
SET is_sent = CASE 
    WHEN status IN ('sent', 'completed') THEN TRUE 
    ELSE FALSE 
END;

-- 将 error_message 复制到 last_error
UPDATE broadcast_queue 
SET last_error = error_message 
WHERE error_message IS NOT NULL;

-- 将单个 message_id 转换为 JSON 数组格式
UPDATE broadcast_queue 
SET message_ids_json = CONCAT('[', message_id, ']')
WHERE message_id IS NOT NULL;

-- 3. 添加索引
ALTER TABLE broadcast_queue 
ADD INDEX idx_chat_id (chat_id),
ADD INDEX idx_available_at (available_at),
ADD INDEX idx_is_sent (is_sent);

-- 4. 验证修改
DESCRIBE broadcast_queue;

-- 5. 显示统计信息
SELECT 
    COUNT(*) as total_records,
    COUNT(user_id) as with_user_id,
    COUNT(chat_id) as with_chat_id,
    SUM(is_sent) as sent_count,
    COUNT(*) - SUM(is_sent) as pending_count
FROM broadcast_queue;

-- 6. 显示示例数据
SELECT id, campaign_id, user_id, telegram_id, chat_id, is_sent, status 
FROM broadcast_queue 
LIMIT 5;

