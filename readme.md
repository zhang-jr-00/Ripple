# RippleNote · 单目录最小原型

实时语音转话题笔记：WebSocket 音频流 → Whisper ASR → LangGraph 智能分类 → 话题圆形标签

---

## 🚀 快速开始

### 1. 安装依赖

```bash
cd ripplenote
python -m venv .venv

# Mac/Linux 激活虚拟环境：
source .venv/bin/activate

# Windows 激活虚拟环境：
# .venv\Scripts\activate

# 安装 Python 包
pip install -r requirements.txt
```

### 2. 安装 FFmpeg

音频转码需要 FFmpeg：

```bash
# macOS:
brew install ffmpeg

# Ubuntu/Debian:
sudo apt-get install ffmpeg

# Windows:
# 方法1: choco install ffmpeg
# 方法2: 从 https://ffmpeg.org/download.html 下载并添加到 PATH
```

### 3. 启动 Ollama 并拉取模型

```bash
# 确保 Ollama 已安装并运行
# macOS: brew install ollama && ollama serve

# 拉取 3B 指令模型（推荐，速度快）
ollama pull qwen2.5:3b-instruct

# 或使用 LLaMA（备选）
# ollama pull llama3.2:3b-instruct
```

**性能提示**：
- ✅ **qwen2.5:3b-instruct**（推荐）：推理 2-4 秒/次，速度快，效果好
- ⚠️ **qwen3:8b** 或更大模型：推理 6-10 秒/次，太慢，不推荐
- 💡 如果已安装 8B 但想换 3B：`ollama pull qwen2.5:3b-instruct`

### 4. 启动服务

**方式1：使用启动脚本（推荐）**

```bash
# 在 ripplenote 目录下
./start.sh
```

启动脚本会自动：
- 激活虚拟环境
- 设置使用 3B 模型（更快）
- 检查 Ollama 服务状态
- 启动 FastAPI 服务

**方式2：手动启动**

```bash
# 在 ripplenote 目录下，虚拟环境激活状态
source .venv/bin/activate

# 设置使用 3B 模型（推荐）
export OLLAMA_MODEL=qwen2.5:3b-instruct

# 启动服务
uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```

看到以下输出表示成功：
```
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started reloader process
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

**说明**：
- 默认使用 `qwen2.5:3b-instruct` 模型（推理速度 2-4 秒）
- 如果你有 8B 模型但觉得太慢，显式设置 `export OLLAMA_MODEL=qwen2.5:3b-instruct`
- 使用 `--host 127.0.0.1` 而不是 `0.0.0.0`，浏览器访问更安全

### 5. 浏览器访问

服务启动后，在浏览器中打开：

```
http://127.0.0.1:8000
```

或者：

```
http://localhost:8000
```

**⚠️ 重要**：如果终端输出显示 `http://0.0.0.0:8000`，不要直接复制这个地址！
- **0.0.0.0 是服务器监听地址**，但浏览器访问会被认为不安全
- **必须手动输入** `localhost:8000` 或 `127.0.0.1:8000`
- 否则麦克风会被浏览器安全策略禁止

---

## 🎤 使用步骤

### 方式1：演示模式（推荐先体验）

1. **打开浏览器** → 访问 `http://localhost:8000`
2. **点击"🎬 演示模式"按钮** → 自动播放测试文本
3. **观察 Ripple 涟漪效果**：

#### 🌊 视觉效果说明

**新话题出现**：
- 💫 圆圈从小到大弹出（rippleAppear 动画）
- 🎨 每个话题有不同的颜色（蓝/紫/青色系）
- ⭕ 显示同心圆涟漪效果（2-3 层圆圈）
- 📍 智能布局：第一个随机位置，后续避免重叠

**话题扩展**（内容增加时）：
- 📈 圆圈变大（基于要点数量）
- 💫 脉冲扩张动画（expanding 效果）
- 🔢 中心显示要点数量（大号数字）

**交互操作**：
- 🖱️ **悬停**：圆圈放大 + 涟漪波纹扩散动画
- 🖱️ **点击**：右侧滑出详情面板
- 📋 **详情面板**：显示话题标签、摘要、所有要点
- ↕️ **滚动**：如果话题太多，页面自动扩展，可滚动查看

**演示内容**：
- 15 句话，逐句处理（每句间隔 1.5 秒）
- 预期产生 4 个话题：云南旅行、预算规划、相机选购、创意记录
- 圆圈大小：120px（1个要点）→ 350px（最多，约15个要点）
- 总时长约 25 秒

**布局算法**：
- ✅ 第一个圆圈：中上随机位置（30%-70% 横向范围）
- ✅ 后续圆圈：智能碰撞检测（200次尝试）
  - 考虑最外层同心圆半径（主圆 + 50px）
  - 确保所有圆圈以最外侧圆环为界，完全不重叠
  - 边距：100px
- ✅ 如果空间不够：放置在下方，页面高度自动扩展（间隔80px）
- ✅ 圆圈大小动态调整：baseSize(120px) + 要点数 × 15px（最大350px）

**显示内容**：
- 🏷️ **话题标签**：显示LLM生成的实际标签（如 "Travel"、"Budget"）
- 🔢 **要点数量**：大号半透明数字作为背景
- 📝 **摘要文字**：不超过8个英文单词的简短描述
  - 优先显示LLM生成的摘要
  - 如果无摘要，显示第一个要点的前8词
  - 最多显示3行，超出部分用省略号

---

### 方式2：真实语音录制

1. **打开浏览器** → 访问 `http://localhost:8000`
2. **点击"开始录音"按钮** → 首次使用会弹出麦克风权限请求，点击"允许"
3. **开始说话** → 每 10 秒自动切片并处理：
   - 实时显示转写文本（字幕）
   - 自动归类到话题（圆形标签）
   - 点击标签查看该话题的要点和摘要
4. **点击"停止录音"** → 结束录制

**💡 使用技巧**：
- 建议持续说话 5-10 秒，不要停顿太久
- 每 10 秒会自动分段并发送，无需手动操作
- 可以连续说话，系统会自动分段处理
- 每个 10 秒切片都是独立的完整音频文件（可单独解码）

---

## 🔍 测试与调试

### 检查各环节是否正常

#### 1. 打开浏览器开发者工具
按 `F12` 或右键 → 检查 → **Console** 标签

#### 2. 点击"开始录音"后，应该看到：

```javascript
[ws] connected                                    // WebSocket 已连接
[start] WebSocket ready                           // 连接就绪
[recorder] started with 10s auto-restart cycle    // 录音器启动（自动重启模式）
[recorder] blob size: 96532 type: audio/webm;codecs=opus ws state: 1  // 第 1 个 10 秒
[recorder] sending 96532 bytes                    // 发送到服务器
[recorder] chunk completed, restarting...         // 自动重启（确保每个切片都有完整头部）
[ui] transcript: 第一段话...                      // 收到转写结果
[ui] topics update: 1 topics                     // 话题更新
[recorder] blob size: 98124 type: audio/webm;codecs=opus ws state: 1  // 第 2 个 10 秒
[recorder] sending 98124 bytes                    // 继续发送
[recorder] chunk completed, restarting...         // 继续重启
[ui] transcript: 第二段话...                      // 第二段转写
[ui] topics update: 1 topics                     // 持续更新
```

#### 3. 后端终端应该显示：

```
[ws] client connected
[ws] received bytes: 96532              // 收到音频（10秒音频约90-100KB）
[ffmpeg] converting /tmp/audio_in_xxx.webm (96532 bytes) -> /tmp/audio_out_xxx.wav
[ffmpeg] conversion success: 320044 bytes WAV
[asr] text: 你好，这是测试，这是一段比较长的转写内容...
[llm] graph done in 3.45s               // LLM 处理完成
```

**重要**：现在使用**自动重启模式**，每 10 秒会停止并重启录音器，确保每个切片都有完整的 WebM 容器头部。这样可以避免 FFmpeg 解码错误。

**如果看到 FFmpeg 错误**（如 `Invalid data found`），说明 WebM 数据格式有问题，请：
- 检查前端是否显示 `[recorder] chunk completed, restarting...`（应该每 10 秒一次）
- 确保前端 Console 的 `blob type` 是 `audio/webm` 或 `audio/webm;codecs=opus`
- 尝试使用最新版 Chrome 浏览器（建议 Chrome 120+）

### 常见问题排查

#### ❌ 问题1：Console 显示 "ws state: 0" 或无法发送

**原因**：WebSocket 未连接完成就开始录音

**解决**：刷新页面重试（已优化：代码会自动等待连接）

---

#### ❌ 问题2：点击按钮后无反应，没有弹出权限请求

**可能原因**：
1. 使用了非安全地址（如局域网IP）
2. 浏览器不支持
3. 系统/浏览器权限被禁用

**解决步骤**：

1️⃣ **确认地址**：Console 输入 `location.href`，必须是 `localhost` 或 `127.0.0.1`

2️⃣ **检查浏览器支持**：Console 输入
```javascript
navigator.mediaDevices  // 应该是对象，不是 undefined
window.MediaRecorder    // 应该是函数
```

3️⃣ **Chrome 站点权限**：
- 地址栏左侧点击 🔒 或 ⓘ → 站点设置 → 麦克风：**允许**
- 或访问：`chrome://settings/content/siteDetails?site=http://localhost:8000`

4️⃣ **macOS 系统权限**：
- 系统设置 → 隐私与安全性 → **麦克风**
- 确保 **Google Chrome** 已勾选
- 修改后建议重启 Chrome

---

#### ❌ 问题3：能录音，但只显示第一段，后续卡住

**原因**：LLM 推理慢，导致队列积压（已修复）

**验证**：看后端日志 `[llm] graph done in X.XXs`，如果 >6 秒说明模型太慢

**解决**：
```bash
# 1. 下载 3B 模型（如果还没有）
ollama pull qwen2.5:3b-instruct

# 2. 使用启动脚本（自动使用 3B）
./start.sh

# 或手动设置并启动
export OLLAMA_MODEL=qwen2.5:3b-instruct
uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```

---

#### ❌ 问题4：只有第一个 10 秒能转写，后续一直显示 (empty)

**症状**：
- 第一个 10 秒正常工作，有转写结果
- 后续的 10 秒切片后端报错：`Error opening input: Invalid data found`
- 前端 Console 显示发送了数据，但转写结果是 `(empty)`

**原因**：MediaRecorder 的 `timeslice` 模式下，只有第一个切片包含完整的 WebM 容器头部，后续切片只有媒体数据

**✅ 已修复**：现在改用**自动重启模式**
- 每 10 秒自动停止并重启 MediaRecorder
- 每个切片都是独立的完整 WebM 文件
- 前端 Console 应该看到：`[recorder] chunk completed, restarting...`

如果问题仍然存在：
- 刷新页面（`Cmd+Shift+R`）确保加载了新代码
- 检查前端是否显示 `started with 10s auto-restart cycle`
- 如果还是有问题，把前端和后端的完整日志发给开发者

---

#### ❌ 问题5：转写结果为空，后端显示 FFmpeg 错误（Invalid data）

**症状**：
- 前端 Console 显示 `[recorder] sending X bytes`
- 后端显示 `[ffmpeg] conversion failed: Invalid data found`
- 所有切片的转写结果都是 `(empty)`

**原因**：浏览器生成的 WebM 音频数据不完整或格式异常

**解决步骤**：

1️⃣ **检查音频格式**：前端 Console 查看 `blob type`
```javascript
[recorder] blob size: 48316 type: audio/webm;codecs=opus
// 应该是 audio/webm 或 audio/webm;codecs=opus
// 如果是其他格式（如 audio/mp4），可能不兼容
```

2️⃣ **确保说话时长足够**：持续说话 **5-10 秒**
- WebM 容器需要一定时长才能生成完整的文件头
- 10 秒的切片间隔已经足够长，可以确保格式完整
- 如果说话中有长时间停顿（>3秒），可能导致某些切片静音

3️⃣ **检查数据大小**：如果 `blob size < 1000`，说明录制有问题
- 麦克风音量太小
- 录音器配置错误

4️⃣ **使用最新版 Chrome**：
```bash
# 检查 Chrome 版本
chrome://version
# 建议使用 Chrome 120+ 或 Edge 120+
```

5️⃣ **临时禁用音频压缩**（测试用）：
- 检查前端 `pickType()` 返回的格式
- 可以尝试其他格式（如不指定 mimeType）

---

#### ❌ 问题6：转写结果为空或乱码（非 FFmpeg 错误）

**可能原因**：
1. 麦克风音量太小
2. 环境噪音太大
3. 说话不清晰

**解决**：
- 检查系统麦克风音量设置
- 靠近麦克风清晰说话
- 在安静环境下测试

---

## 🧪 测试话题分类功能

如果想单独测试话题分类（不涉及语音识别），可以运行测试脚本：

```bash
# 确保虚拟环境已激活，并且 Ollama 正在运行
source .venv/bin/activate  # Mac/Linux
# .venv\Scripts\activate   # Windows

# 运行测试
python test_classification.py
```

**测试内容**：
- 模拟 15 个语音识别结果（每句约 20 字）
- 内容包含：云南旅行计划、预算规划、相机选购、创意记录项目
- 预期生成 3-4 个独立话题
- 测试 LangGraph 的路由和压缩能力

**测试输出示例**：
```
📊 最终结果统计
================================================================================

🎯 共生成 4 个话题：

【话题 1】 Travel (ID: a1b2c3d4)
  📝 摘要: Planning a trip to Yunnan, visiting Dali and Lijiang
  🔑 关键词: 云南, 大理, 丽江, 洱海, 民宿
  📌 要点数量: 5
  💬 要点列表:
     1. 最近我在计划一次去云南的旅行，主要是想放松一下
     2. 这趟旅行最吸引我的是大理的洱海和丽江的古城
     ...

【话题 2】 Budget (ID: e5f6g7h8)
  📝 摘要: Budgeting and cost-saving strategies for the trip
  🔑 关键词: 预算, 积分, 住宿, 省钱
  ...
```

---

## 🛠️ 进阶配置

### 环境变量（可选）

```bash
# 自定义 Ollama 地址
export OLLAMA_URL=http://localhost:11434

# 切换模型（默认：qwen2.5:3b-instruct）
export OLLAMA_MODEL=qwen2.5:3b-instruct
# 或使用其他模型：
# export OLLAMA_MODEL=llama3.2:3b-instruct
# export OLLAMA_MODEL=qwen3:8b  # 不推荐，太慢

# 每个话题最多显示的要点数
export MAX_POINTS_PER_TOPIC=10

# 启动服务
uvicorn app:app --host 127.0.0.1 --port 8000 --reload

# 或使用启动脚本（自动配置）
./start.sh
```

### 查看话题 API

```bash
# 直接访问 API 查看所有话题（绕开前端）
curl http://localhost:8000/topics | python -m json.tool

# 健康检查
curl http://localhost:8000/health
# 应返回：{"ok":true}
```

---

## 📋 技术栈

- **后端**：FastAPI + Uvicorn
- **ASR**：faster-whisper (Whisper base 模型)
- **LLM**：Ollama (qwen2.5:3b / llama3.2:3b)
- **决策流程**：LangGraph
- **前端**：原生 React (无打包)
- **音频**：MediaRecorder API (WebM/Opus) + FFmpeg

---

## 📝 注意事项

1. **首次运行**：Whisper 模型会自动下载（约 150MB），需要等待几分钟
2. **性能要求**：推荐 16GB 内存，SSD 存储
3. **浏览器**：Chrome/Edge 最新版，Safari 对 MediaRecorder 支持不稳定
4. **网络**：首次下载模型需要联网，之后可离线运行
5. **数据持久化**：当前版本仅保存在内存中，重启服务后数据清空

---

## 🆘 获取帮助

如果仍有问题，请提供以下信息：
1. 浏览器 Console 的完整输出
2. 后端终端的日志（从启动到问题出现）
3. 操作系统版本
4. Python 版本 (`python --version`)
5. Ollama 版本 (`ollama --version`)