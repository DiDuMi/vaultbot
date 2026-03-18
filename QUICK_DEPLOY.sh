#!/bin/bash
# VaultBot 快速部署脚本
# 使用方法: ./QUICK_DEPLOY.sh

set -e

echo "=========================================="
echo "VaultBot 生产环境快速部署"
echo "=========================================="
echo ""

# 检查是否在正确的目录
if [ ! -f "package.json" ]; then
    echo "❌ 错误：请在项目根目录运行此脚本"
    exit 1
fi

# 检查 .env 文件
if [ ! -f ".env" ]; then
    echo "⚠️  未找到 .env 文件，正在创建..."
    cp .env.example .env
    chmod 600 .env
    echo "✅ 已创建 .env 文件"
    echo ""
    echo "⚠️  请编辑 .env 文件并配置以下必需项："
    echo "   - BOT_TOKEN (从 @BotFather 获取)"
    echo "   - VAULT_CHAT_ID (Telegram 群组 ID)"
    echo ""
    echo "配置完成后，再次运行此脚本"
    exit 0
fi

# 检查必需的环境变量
echo "🔍 检查环境变量配置..."
source .env

if [ -z "$BOT_TOKEN" ]; then
    echo "❌ 错误：BOT_TOKEN 未配置"
    exit 1
fi

if [ -z "$VAULT_CHAT_ID" ]; then
    echo "❌ 错误：VAULT_CHAT_ID 未配置"
    exit 1
fi

echo "✅ 环境变量检查通过"
echo ""

# 检查 Docker
echo "🔍 检查 Docker 环境..."
if ! command -v docker &> /dev/null; then
    echo "❌ 错误：未安装 Docker"
    exit 1
fi

if ! command -v docker compose &> /dev/null; then
    echo "❌ 错误：未安装 Docker Compose"
    exit 1
fi

echo "✅ Docker 环境检查通过"
echo ""

# 停止旧容器（如果存在）
echo "🛑 停止旧容器..."
docker compose down 2>/dev/null || true
echo ""

# 构建并启动服务
echo "🚀 构建并启动服务..."
docker compose up -d --build

echo ""
echo "⏳ 等待服务启动..."
sleep 5

# 检查服务状态
echo ""
echo "📊 服务状态："
docker compose ps

echo ""
echo "=========================================="
echo "✅ 部署完成！"
echo "=========================================="
echo ""
echo "查看日志："
echo "  docker compose logs -f app"
echo "  docker compose logs -f worker"
echo ""
echo "停止服务："
echo "  docker compose down"
echo ""
echo "重启服务："
echo "  docker compose restart"
echo ""

