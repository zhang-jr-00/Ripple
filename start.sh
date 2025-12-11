#!/bin/bash
# RippleNote 启动脚本

# 设置颜色
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 启动 RippleNote...${NC}"

# 激活虚拟环境
source .venv/bin/activate

# 显式设置使用 3B 模型（更快）
export OLLAMA_MODEL=qwen2.5:3b-instruct
echo -e "${GREEN}✓ 使用模型: ${OLLAMA_MODEL}${NC}"

# 设置 Ollama 服务地址
export OLLAMA_URL=http://localhost:11434
echo -e "${GREEN}✓ Ollama 地址: ${OLLAMA_URL}${NC}"

# 检查 Ollama 是否运行
if ! curl -s http://localhost:11434/api/version > /dev/null 2>&1; then
    echo -e "${BLUE}⚠️  Ollama 服务未运行，正在启动...${NC}"
    ollama serve > /dev/null 2>&1 &
    sleep 2
fi

echo -e "${GREEN}✓ Ollama 服务正常${NC}"

# 启动服务
echo -e "${BLUE}📡 启动 FastAPI 服务...${NC}"
echo -e "${GREEN}访问地址: http://127.0.0.1:8000${NC}"
echo ""
uvicorn app:app --host 127.0.0.1 --port 8000 --reload

