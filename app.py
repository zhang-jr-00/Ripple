# -*- coding: utf-8 -*-
# 单文件后端：FastAPI + LangGraph + Whisper(ASR) + Ollama(LLM)
# 功能：WebSocket 接收 10s 音频 → Whisper 转写 → LangGraph 路由/总结 → 推送话题

import os, json, time, uuid, tempfile, asyncio
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field
from datetime import datetime

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

import httpx
from faster_whisper import WhisperModel
import ffmpeg

from langgraph.graph import StateGraph, START, END

# ---------------------
# 配置与全局对象
# ---------------------
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b-instruct")
MAX_POINTS_PER_TOPIC = int(os.getenv("MAX_POINTS_PER_TOPIC", "8"))
STATIC_INDEX_PATH = os.path.join(os.path.dirname(__file__), "static", "index.html")  # Main SPA entry
CANVAS_STORAGE_PATH = os.path.join(os.path.dirname(__file__), "canvas_history.json")  # Canvas history file

# Whisper 模型（延迟加载）
_ASR = None
def load_asr():
    global _ASR
    if _ASR is None:
        # base 对原型足够；可改 small/medium 提升质量
        _ASR = WhisperModel("base", compute_type="int8")
    return _ASR

# ---------------------
# 数据模型（UI 返回）
# ---------------------
class Point(BaseModel):
    text: str

class TopicPayload(BaseModel):
    id: str
    label: str
    summary: str
    keyphrases: List[str] = []
    points: List[Point]

class TopicsEnvelope(BaseModel):
    event: str = "topics"
    topics: List[TopicPayload]

class TranscriptEnvelope(BaseModel):
    event: str = "transcript"
    text: str

# ---------------------
# 内存话题结构（极简）
# ---------------------
@dataclass
class Topic:
    id: str
    label: str = "Topic"              # 一词标签（前端圆形chip显示）
    keyphrases: List[str] = field(default_factory=list)  # 3~5关键词，给路由参考
    points: List[str] = field(default_factory=list)      # 要点（短句）
    summary: str = ""                                    # ≤25词总结
    last_updated: float = field(default_factory=lambda: time.time())

@dataclass
class MemoryStore:
    topics: Dict[str, Topic] = field(default_factory=dict)
    def as_payload(self, max_points=8) -> List[TopicPayload]:
        items = []
        for t in self.topics.values():
            items.append(TopicPayload(
                id=t.id, label=t.label, summary=t.summary, keyphrases=t.keyphrases[:5],
                points=[Point(text=p) for p in t.points[-max_points:]]
            ))
        # 新的在前
        items.sort(key=lambda x: self.topics[x.id].last_updated, reverse=True)
        return items

store = MemoryStore()

# ---------------------
# Canvas Storage (for history feature)
# ---------------------
@dataclass
class Canvas:
    id: str
    title: str
    summary: str
    topics: Dict[str, Topic]
    created_at: str
    
class CanvasStore:
    def __init__(self, storage_path: str):
        self.storage_path = storage_path
        self.canvases: List[Canvas] = []
        self._load()
    
    def _load(self):
        """Load canvases from file"""
        if os.path.exists(self.storage_path):
            try:
                with open(self.storage_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.canvases = []
                    for item in data:
                        topics = {}
                        for tid, t in item.get('topics', {}).items():
                            topics[tid] = Topic(
                                id=t['id'],
                                label=t.get('label', 'Topic'),
                                keyphrases=t.get('keyphrases', []),
                                points=t.get('points', []),
                                summary=t.get('summary', ''),
                                last_updated=t.get('last_updated', time.time())
                            )
                        self.canvases.append(Canvas(
                            id=item['id'],
                            title=item['title'],
                            summary=item['summary'],
                            topics=topics,
                            created_at=item['created_at']
                        ))
            except Exception as e:
                print(f"[canvas] load error: {e}")
                self.canvases = []
    
    def _save(self):
        """Save canvases to file"""
        try:
            data = []
            for canvas in self.canvases:
                topics_data = {}
                for tid, t in canvas.topics.items():
                    topics_data[tid] = {
                        'id': t.id,
                        'label': t.label,
                        'keyphrases': t.keyphrases,
                        'points': t.points,
                        'summary': t.summary,
                        'last_updated': t.last_updated
                    }
                data.append({
                    'id': canvas.id,
                    'title': canvas.title,
                    'summary': canvas.summary,
                    'topics': topics_data,
                    'created_at': canvas.created_at
                })
            with open(self.storage_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[canvas] save error: {e}")
    
    def add(self, canvas: Canvas):
        """Add a canvas to history"""
        self.canvases.insert(0, canvas)  # Most recent first
        self._save()
    
    def get_list(self) -> List[dict]:
        """Get list of canvases (id, title, summary, created_at)"""
        return [{
            'id': c.id,
            'title': c.title,
            'summary': c.summary,
            'created_at': c.created_at,
            'topic_count': len(c.topics)
        } for c in self.canvases]
    
    def get_by_id(self, canvas_id: str) -> Optional[Canvas]:
        """Get a specific canvas by ID"""
        for c in self.canvases:
            if c.id == canvas_id:
                return c
        return None

canvas_store = CanvasStore(CANVAS_STORAGE_PATH)

# ---------------------
# 工具函数
# ---------------------
def to_point(text: str, max_len: int = 120) -> str:
    # 压缩为短要点（去多余空白，限制长度）
    t = " ".join(text.split()).strip()
    return (t[:max_len] + "…") if len(t) > max_len else t

def normalize_label(raw: str, max_words: int = 3) -> str:
    """将模型输出的标签标准化为 Title Case，多词可读"""
    if not raw:
        return "Topic"
    separators = raw.replace("-", " ").replace("_", " ")
    words = [w for w in separators.split() if w.strip()]
    if not words:
        return "Topic"
    trimmed = words[:max_words]
    return " ".join(w.capitalize() for w in trimmed)

def one_line_json(s: str) -> str:
    # 从模型输出中提取第一段 JSON
    import re
    m = re.search(r"\{.*\}", s, re.S)
    return m.group(0) if m else "{}"

# ---------------------
# ASR：webm/opus → wav → Whisper
# ---------------------
def webm_to_wav_bytes(webm_bytes: bytes, target_sr: int = 16000) -> bytes:
    """将 WebM 音频转换为 WAV 格式"""
    # 检查输入数据
    if not webm_bytes or len(webm_bytes) < 100:
        raise Exception(f"WebM data too small: {len(webm_bytes)} bytes")
    
    # 检查 WebM 魔术字节（应该以 0x1A 0x45 0xDF 0xA3 开头）
    if len(webm_bytes) >= 4:
        header = webm_bytes[:4]
        if header != b'\x1a\x45\xdf\xa3':
            print(f"[webm] Warning: invalid WebM header: {header.hex()}")
    
    # 使用更安全的临时文件命名，避免并发冲突
    in_fd, in_path = tempfile.mkstemp(suffix=".webm", prefix="audio_in_")
    out_fd, out_path = tempfile.mkstemp(suffix=".wav", prefix="audio_out_")
    
    try:
        # 写入输入文件
        os.write(in_fd, webm_bytes)
        os.close(in_fd)
        os.close(out_fd)
        
        print(f"[ffmpeg] converting {in_path} ({len(webm_bytes)} bytes) -> {out_path}")
        
        # FFmpeg 转码
        (ffmpeg
         .input(in_path)
         .output(out_path, ac=1, ar=target_sr, format="wav")
         .overwrite_output()
         .run(capture_stdout=True, capture_stderr=True))
        
        # 读取输出文件
        with open(out_path, "rb") as f:
            wav_data = f.read()
            print(f"[ffmpeg] conversion success: {len(wav_data)} bytes WAV")
            return wav_data
    except ffmpeg.Error as e:
        stderr = e.stderr.decode('utf-8', errors='ignore') if e.stderr else "Unknown error"
        # 只打印关键错误信息，不打印整个 stderr
        error_lines = [line for line in stderr.split('\n') if 'Error' in line or 'Invalid' in line]
        print(f"[ffmpeg] conversion failed: {'; '.join(error_lines[:3])}")
        raise Exception(f"FFmpeg conversion failed")
    finally:
        # 清理临时文件
        for p in (in_path, out_path):
            try: 
                os.remove(p)
            except: 
                pass

def transcribe_chunk(webm_bytes: bytes) -> str:
    """转写音频块"""
    try:
        # 转换格式
        wav_bytes = webm_to_wav_bytes(webm_bytes)
        
        # 写入临时文件供 Whisper 使用
        wav_fd, wav_path = tempfile.mkstemp(suffix=".wav", prefix="whisper_")
        try:
            os.write(wav_fd, wav_bytes)
            os.close(wav_fd)
            
            # Whisper 转写
            model = load_asr()
            segments, _ = model.transcribe(
                wav_path, vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=500)
            )
            text = " ".join(s.text.strip() for s in segments)
            return text.strip()
        finally:
            try: 
                os.remove(wav_path)
            except: 
                pass
    except Exception as e:
        print(f"[asr] transcription error: {e}")
        return ""

# ---------------------
# LLM（Ollama）与提示词
# ---------------------
async def ollama_generate(prompt: str, temperature: float = 0.1, max_tokens: int = 128) -> str:
    async with httpx.AsyncClient(timeout=40) as client:
        r = await client.post(f"{OLLAMA_URL}/api/generate", json={
            "model": OLLAMA_MODEL, "prompt": prompt, "stream": False,
            "options": {"temperature": temperature, "num_predict": max_tokens}
        })
        r.raise_for_status()
        return r.json().get("response", "").strip()

def router_prompt(utter: str, snapshot: str) -> str:
    # 话题路由 agent：平衡模式（智能分类）
    return f"""
You are a smart Topic Router. 
Decide if the utterance belongs to an existing topic or starts a NEW one.

Snapshot(existing_topics): {snapshot}

Utterance: \"\"\"{utter}\"\"\"

RULES:
1. **MERGE** if the utterance continues the same general theme or adds detail to an existing topic.
   - Example: "Visiting Dali" -> merges into "Travel Plan".
   - Example: "Ticket prices are high" -> merges into "Travel Plan" (related aspect).

2. **CREATE NEW** if the utterance shifts to a DISTINCTLY DIFFERENT subject or a new standalone idea.
   - Example: "By the way, I'm buying a new camera" -> NEW topic "Photography Gear".
   - Example: "This reminds me of a writing project" -> NEW topic "Creative Writing".

3. **LABELING**:
   - New labels MUST be specific English phrases (1-3 words) such as "Travel Plan", "Camera Gear", "Creative Project".
   - NEVER use generic names like "Topic" or "General".

Return ONE JSON object:
- To append: {{"action":"append_point","topic_id":"<id>","text":"<short point>"}}
- To create: {{"action":"create_topic","text":"<short point>"}}
"""

def compress_prompt(points: str, cur_label: str) -> str:
    # 话题压缩：关键词 + ≤25词总结 + 修正单词标签
    return f"""
Compress topic info from recent points.

Recent points:
{points}

Current label: {cur_label}

Return JSON:
{{
  "keyphrases": ["k1","k2","k3"],
  "summary": "<Short English summary, max 15 words>",
  "label": "<SpecificEnglishLabel (1-3 words)>"
}}

IMPORTANT:
- Label MUST be specific English (e.g. "Travel Plan", "Photography"), NOT "Topic".
- Summary MUST be in English.
- Only JSON.
"""

def canvas_summary_prompt(topics_info: str) -> str:
    """Generate a title and summary for the entire canvas"""
    return f"""
You are summarizing a brainstorming session. Given the topics discussed, create a title and brief summary.

Topics in this session:
{topics_info}

Return JSON:
{{
  "title": "<Short descriptive title, 2-5 words>",
  "summary": "<Brief summary of main themes, max 20 words>"
}}

IMPORTANT:
- Title should capture the main theme(s)
- Be specific and descriptive
- English only
- Only JSON output
"""

# ---------------------
# LangGraph（LLM-only 决策，不用 embedding）
# ---------------------
def router_snapshot(max_topics: int = 6) -> str:
    topics = list(store.topics.values())
    topics.sort(key=lambda t: t.last_updated, reverse=True)
    rows = []
    for t in topics[:max_topics]:
        rows.append({
            "id": t.id, 
            "label": t.label,
            "summary": t.summary,  # 加入摘要，帮助理解话题内涵
            "keyphrases": t.keyphrases[:5]
        })
    return json.dumps(rows, ensure_ascii=False)

def build_graph():
    g = StateGraph(dict)

    # 节点1：路由
    async def route_node(state: Dict[str, Any]):
        utter = to_point(state["utterance"])
        snap = router_snapshot()
        resp = await ollama_generate(router_prompt(utter, snap), temperature=0.1, max_tokens=200)
        dec = json.loads(one_line_json(resp))
        dec["utterance"] = utter
        return {"decision": dec}

    # 节点2：执行（修改内存）
    async def exec_node(state: Dict[str, Any]):
        dec = state["decision"]; now = time.time()
        action = dec.get("action", "")
        if action == "create_topic":
            tid = str(uuid.uuid4())[:8]
            p = to_point(dec.get("text", state["decision"].get("utterance","")))
            store.topics[tid] = Topic(id=tid, points=[p], last_updated=now)
            return {"topic_id": tid, "changed": True}
        elif action == "append_point":
            tid = dec.get("topic_id","")
            if tid in store.topics:
                p = to_point(dec.get("text", state["decision"].get("utterance","")))
                if not store.topics[tid].points or store.topics[tid].points[-1] != p:
                    store.topics[tid].points.append(p)
                store.topics[tid].last_updated = now
                return {"topic_id": tid, "changed": True}
            # 若 ID 不存在，退化为新建
            tid = str(uuid.uuid4())[:8]
            store.topics[tid] = Topic(id=tid, points=[to_point(state["decision"].get("utterance",""))], last_updated=now)
            return {"topic_id": tid, "changed": True}
        elif action == "relabel_topic":
            tid = dec.get("topic_id",""); new_label = (dec.get("new_label","") or "").strip()
            if tid in store.topics and new_label:
                store.topics[tid].label = normalize_label(new_label)
                store.topics[tid].last_updated = now
                return {"topic_id": tid, "changed": True}
        # 默认新建
        tid = str(uuid.uuid4())[:8]
        store.topics[tid] = Topic(id=tid, points=[to_point(state["decision"].get("utterance",""))], last_updated=now)
        return {"topic_id": tid, "changed": True}

    # 节点3：压缩（关键词/总结/修正标签）
    async def compress_node(state: Dict[str, Any]):
        tid = state.get("topic_id")
        if not tid or tid not in store.topics:
            return {}
        t = store.topics[tid]
        recent = "\n- " + "\n- ".join(t.points[-MAX_POINTS_PER_TOPIC:])
        resp = await ollama_generate(compress_prompt(recent, t.label), temperature=0.2, max_tokens=220)
        try:
            data = json.loads(one_line_json(resp))
            if isinstance(data.get("keyphrases"), list) and data["keyphrases"]:
                t.keyphrases = [str(k)[:30] for k in data["keyphrases"]][:5]
            if isinstance(data.get("summary"), str):
                t.summary = data["summary"].strip()
            if isinstance(data.get("label"), str) and data["label"].strip():
                t.label = normalize_label(data["label"])
            t.last_updated = time.time()
        except Exception:
            pass
        return {"changed": True}

    g.add_node("router", route_node)
    g.add_node("exec", exec_node)
    g.add_node("compress", compress_node)
    g.add_edge(START, "router")
    g.add_edge("router", "exec")
    g.add_edge("exec", "compress")
    g.add_edge("compress", END)
    return g.compile()

graph = build_graph()

# ---------------------
# FastAPI
# ---------------------
app = FastAPI(title="RippleNote (single-folder)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"]
)

# API 路由（必须在静态文件挂载之前定义）
@app.get("/health")
def health():
    return {"ok": True}

@app.get("/topics")
def get_topics():
    env = TopicsEnvelope(topics=store.as_payload(MAX_POINTS_PER_TOPIC))
    return json.loads(env.model_dump_json())

@app.post("/demo/clear")
async def demo_clear():
    """清空所有话题（用于演示）"""
    store.topics.clear()
    return {"ok": True}

# ---------------------
# Canvas API Endpoints
# ---------------------
@app.get("/canvas/history")
def get_canvas_history():
    """Get list of saved canvases"""
    return {"canvases": canvas_store.get_list()}

@app.get("/canvas/{canvas_id}")
def get_canvas(canvas_id: str):
    """Get a specific canvas by ID"""
    canvas = canvas_store.get_by_id(canvas_id)
    if not canvas:
        return {"error": "Canvas not found"}
    
    # Convert to payload format
    topics_payload = []
    for t in canvas.topics.values():
        topics_payload.append({
            "id": t.id,
            "label": t.label,
            "summary": t.summary,
            "keyphrases": t.keyphrases[:5],
            "points": [{"text": p} for p in t.points[-MAX_POINTS_PER_TOPIC:]]
        })
    topics_payload.sort(key=lambda x: canvas.topics[x['id']].last_updated, reverse=True)
    
    return {
        "id": canvas.id,
        "title": canvas.title,
        "summary": canvas.summary,
        "created_at": canvas.created_at,
        "topics": topics_payload
    }

@app.post("/canvas/new")
async def create_new_canvas():
    """Save current topics as a canvas and start fresh"""
    # Filter out empty topics (no points)
    valid_topics = {tid: t for tid, t in store.topics.items() if t.points}
    # If no valid topics, do not save
    if not valid_topics:
        return {"ok": True, "message": "No topics to save"}
    
    # Generate title and summary using LLM
    topics_info = []
    for t in valid_topics.values():
        topics_info.append(f"- {t.label}: {t.summary or ', '.join(t.keyphrases[:3])}")
    topics_str = "\n".join(topics_info)
    
    try:
        resp = await ollama_generate(canvas_summary_prompt(topics_str), temperature=0.3, max_tokens=150)
        data = json.loads(one_line_json(resp))
        title = data.get("title", "Brainstorm Session")
        summary = data.get("summary", "")
    except Exception as e:
        print(f"[canvas] summary generation error: {e}")
        # Fallback: use first topic label as title
        first_topic = list(store.topics.values())[0] if store.topics else None
        title = first_topic.label if first_topic else "Brainstorm Session"
        summary = f"{len(store.topics)} topics discussed"
    
    # Create canvas (deep copy topics so future mutations won't affect history)
    topics_copy = {}
    for tid, t in valid_topics.items():
        topics_copy[tid] = Topic(
            id=t.id,
            label=t.label,
            keyphrases=list(t.keyphrases),
            points=list(t.points),
            summary=t.summary,
            last_updated=t.last_updated
        )

    # Create canvas
    canvas = Canvas(
        id=str(uuid.uuid4())[:8],
        title=title,
        summary=summary,
        topics=topics_copy,
        created_at=datetime.now().isoformat()
    )
    
    # Save to history
    canvas_store.add(canvas)
    
    # Clear current topics
    store.topics.clear()
    
    return {
        "ok": True,
        "canvas_id": canvas.id,
        "title": title,
        "summary": summary
    }

@app.post("/canvas/load/{canvas_id}")
async def load_canvas(canvas_id: str):
    """Load a canvas from history into current session"""
    canvas = canvas_store.get_by_id(canvas_id)
    if not canvas:
        return {"error": "Canvas not found"}
    
    # Replace current topics with canvas topics
    store.topics.clear()
    for tid, topic in canvas.topics.items():
        store.topics[tid] = Topic(
            id=topic.id,
            label=topic.label,
            keyphrases=list(topic.keyphrases),
            points=list(topic.points),
            summary=topic.summary,
            last_updated=topic.last_updated
        )
    
    return {"ok": True, "loaded": canvas_id}

@app.post("/demo/process")
async def demo_process(request: dict):
    """演示模式：处理单句文本"""
    text = request.get("text", "").strip()
    if not text:
        return {"error": "Empty text"}
    
    try:
        # 记录旧的话题状态
        old_topic_ids = set(store.topics.keys())
        old_topics_snapshot = {
            tid: len(t.points) for tid, t in store.topics.items()
        }
        
        # 处理文本
        await graph.ainvoke({"utterance": text})
        
        # 检测变化
        new_topic_ids = set(store.topics.keys())
        new_topics = list(new_topic_ids - old_topic_ids)
        updated_topics = [
            tid for tid in old_topic_ids
            if tid in store.topics and len(store.topics[tid].points) > old_topics_snapshot.get(tid, 0)
        ]
        
        # 返回结果
        env = TopicsEnvelope(topics=store.as_payload(MAX_POINTS_PER_TOPIC))
        result = json.loads(env.model_dump_json())
        result["new_topics"] = new_topics
        result["updated_topics"] = updated_topics
        return result
    except Exception as e:
        print(f"[demo] error: {e}")
        return {"error": str(e)}

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    print("[ws] client connected")
    
    async def process_audio_chunk(data: bytes):
        """异步处理单个音频块：ASR + LLM"""
        try:
            # 1) ASR 转写（在线程池中执行，避免阻塞事件循环）
            loop = asyncio.get_event_loop()
            text = await loop.run_in_executor(None, transcribe_chunk, data)
            
            print(f"[asr] text: {text[:80] if text else '(empty)'}")
            
            if text:
                # 2) 立即回传转写结果（前端字幕）
                await ws.send_text(TranscriptEnvelope(text=text).model_dump_json())
                
                # 3) 后台异步处理 LLM
                async def run_llm_and_push(t: str):
                    t0 = time.time()
                    try:
                        await graph.ainvoke({"utterance": t})
                        print(f"[llm] graph done in {time.time()-t0:.2f}s")
                        env = TopicsEnvelope(topics=store.as_payload(MAX_POINTS_PER_TOPIC))
                        await ws.send_text(env.model_dump_json())
                    except Exception as e:
                        print(f"[llm] error: {e}")
                
                asyncio.create_task(run_llm_and_push(text))
        except Exception as e:
            print(f"[process_audio] error: {e}")
    
    try:
        while True:
            # 接收音频数据（每10秒一个音频块）
            data = await ws.receive_bytes()
            print(f"[ws] received bytes: {len(data)}")
            
            # 后台异步处理，不阻塞接收下一个音频块
            asyncio.create_task(process_audio_chunk(data))
            
    except WebSocketDisconnect:
        print("[ws] disconnected")

# 专用演示入口，仅在用户直接访问 /demo 时暴露
@app.get("/demo", include_in_schema=False)
def serve_demo_page():
    return FileResponse(STATIC_INDEX_PATH)

# 静态目录（前端）—— 必须放在最后，作为 fallback
app.mount("/", StaticFiles(directory="static", html=True), name="static")
