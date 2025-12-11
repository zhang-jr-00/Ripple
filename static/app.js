// -*- coding: utf-8 -*-
// 无打包 React 前端：录音 5s 切片 -> WebSocket -> 显示 Circles 与摘要

const { useEffect, useRef, useState, useMemo } = React

function App() {
  const [ws, setWs] = useState(null)
  const [recording, setRecording] = useState(false)
  const mediaRef = useRef(null)
  const recRef = useRef(null)
  const timerRef = useRef(null)

  const [topics, setTopics] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [liveText, setLiveText] = useState('')
  const [demoRunning, setDemoRunning] = useState(false)
  const [newTopicIds, setNewTopicIds] = useState([])
  const [updatedTopicIds, setUpdatedTopicIds] = useState([])
  const [viewMode, setViewMode] = useState('ripple')
  // Flag ensures demo UI only appears when user explicitly visits /demo
  const isDemoPage = typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '') === '/demo'
  
  // History panel state
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyList, setHistoryList] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  
  // Ripple 位置状态
  const [ripplePositions, setRipplePositions] = useState({})
  // 使用 ref 来存储最新的位置信息，避免批量更新时的竞态问题
  const positionsRef = useRef({})
  // Guard to avoid auto-starting the demo multiple times on /demo
  const demoAutoStartedRef = useRef(false)
  const loadDemoCache = () => {
    if (typeof localStorage === 'undefined') return null
    try {
      const raw = localStorage.getItem(DEMO_STORAGE_KEY)
      return raw ? JSON.parse(raw) : null
    } catch (err) {
      console.error('[demo] failed to read cache', err)
      return null
    }
  }
  const saveDemoCache = (payload) => {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(payload))
    } catch (err) {
      console.error('[demo] failed to write cache', err)
    }
  }
  const clearDemoCache = () => {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.removeItem(DEMO_STORAGE_KEY)
    } catch (err) {
      console.error('[demo] failed to clear cache', err)
    }
  }
  
  // 水滴与波纹特效
  const [dropEffects, setDropEffects] = useState([])
  const [waveEffects, setWaveEffects] = useState([])
  const [ambientWaves, setAmbientWaves] = useState([])
  const gradientLayerRef = useRef(null)
  const gradientBaseRef = useRef(null)
  const gradientOverlayRef = useRef(null)
  const gradientBlobRefs = useRef([])
  const nextEffectId = useRef(0)
  const colorMapRef = useRef({})
  const mapPositionsRef = useRef({})
  const keywordOrbitCacheRef = useRef({})
  const mapTopicAnglesRef = useRef({})


  // 测试文本（分成15句，可以产生4个话题）
  const demoSentences = [
    // 话题1：云南旅行计划
    "Recently I've been planning a trip to Yunnan, mainly just to relax,",
    "and take some photos. Actually what attracts me most is Erhai Lake in Dali",
    "and the Ancient Town of Lijiang. Friends told me the sunlight there is soft,",
    "perfect for a slow-paced life. I plan to stay in a homestay by Erhai,",
    "cycling around the lake in the morning, and watching stars at night.",
    
    // 话题2：预算规划（关联但独立）
    "However, during booking I found my budget is tight, so I started replanning costs.",
    "I thought maybe I can use points for flight tickets to save cash.",
    "Also, I might choose apartment-style homestays with kitchens,",
    "so cooking myself can save some money compared to eating out every day.",
    
    // 话题3：相机选购（完全独立）
    "Changing the subject, I am comparing several portable cameras right now.",
    "I'm looking for a lightweight model with good image quality for travel.",
    "The Sony and Fuji models look promising, but I need to check the reviews.",
    
    // 话题4：创意记录（完全独立）
    "Speaking of cameras, I recalled a creative recording project I did before.",
    "That time I used voice to record daily inspirations, then used AI to organize them.",
    "Now I want to integrate that method into daily writing, especially for travel diaries."
  ]

// UI 配色与模式控制（集中管理，便于快速调整）
const TOPIC_COLORS = [
  'rgba(255, 255, 255, 0.95)',
  'rgba(255, 255, 255, 0.8)',
  'rgba(255, 255, 255, 0.7)',
  'rgba(255, 255, 255, 0.6)',
  'rgba(255, 255, 255, 0.5)'
]

// Layout paddings - ripples can appear anywhere on the page
const RIPPLE_LEFT_PADDING = 0
const RIPPLE_RIGHT_PADDING = 0

const iconProps = (extra = {}) => ({
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  ...extra
})

const IconLayers = (props = {}) => React.createElement(
  'svg',
  iconProps(props),
  React.createElement('path', { d: 'M3 7l9-4 9 4-9 4-9-4z' }),
  React.createElement('path', { d: 'M3 12l9 4 9-4' }),
  React.createElement('path', { d: 'M3 17l9 4 9-4' })
)

const IconDroplet = (props = {}) => React.createElement(
  'svg',
  iconProps(props),
  React.createElement('path', { d: 'M12 2s-7 8-7 13a7 7 0 0 0 14 0c0-5-7-13-7-13z' }),
  React.createElement('path', { d: 'M12 22a7 7 0 0 1-7-7' })
)

const IconLayoutList = (props = {}) => React.createElement(
  'svg',
  iconProps(props),
  React.createElement('rect', { x: 4, y: 4, width: 16, height: 16, rx: 3 }),
  React.createElement('line', { x1: 8, y1: 10, x2: 16, y2: 10 }),
  React.createElement('line', { x1: 8, y1: 14, x2: 16, y2: 14 }),
  React.createElement('line', { x1: 8, y1: 18, x2: 16, y2: 18 })
)

const IconNetwork = (props = {}) => React.createElement(
  'svg',
  iconProps(props),
  React.createElement('circle', { cx: 5, cy: 5, r: 2.5 }),
  React.createElement('circle', { cx: 19, cy: 5, r: 2.5 }),
  React.createElement('circle', { cx: 12, cy: 19, r: 3 }),
  React.createElement('line', { x1: 7, y1: 6.5, x2: 17, y2: 6.5 }),
  React.createElement('line', { x1: 6.2, y1: 6.3, x2: 11, y2: 17 }),
  React.createElement('line', { x1: 17.8, y1: 6.3, x2: 13, y2: 17 })
)

const IconMic = (props = {}) => React.createElement(
  'svg',
  iconProps(props),
  React.createElement('path', { d: 'M12 3a4 4 0 0 1 4 4v5a4 4 0 1 1-8 0V7a4 4 0 0 1 4-4z' }),
  React.createElement('path', { d: 'M19 10v2a7 7 0 0 1-7 7 7 7 0 0 1-7-7v-2' }),
  React.createElement('path', { d: 'M12 19v3' }),
  React.createElement('path', { d: 'M8 22h8' })
)

const IconSquare = (props = {}) => React.createElement(
  'svg',
  iconProps(props),
  React.createElement('rect', { x: 6, y: 6, width: 12, height: 12, rx: 2 })
)

const IconPlus = (props = {}) => React.createElement(
  'svg',
  iconProps(props),
  React.createElement('line', { x1: 12, y1: 5, x2: 12, y2: 19 }),
  React.createElement('line', { x1: 5, y1: 12, x2: 19, y2: 12 })
)

const IconHistory = (props = {}) => React.createElement(
  'svg',
  iconProps(props),
  React.createElement('circle', { cx: 12, cy: 12, r: 9 }),
  React.createElement('polyline', { points: '12 7 12 12 15 15' })
)

const IconClose = (props = {}) => React.createElement(
  'svg',
  iconProps(props),
  React.createElement('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
  React.createElement('line', { x1: 6, y1: 6, x2: 18, y2: 18 })
)

const VIEW_OPTIONS = [
  { id: 'lanes', name: 'Lanes', icon: IconLayers },
  { id: 'ripple', name: 'Ripple', icon: IconDroplet },
  { id: 'stacks', name: 'Stacks', icon: IconLayoutList },
  { id: 'map', name: 'Map', icon: IconNetwork }
]

// 动态渐变背景的时间步长与透明覆盖
const BG_OVERLAY_SHADE = 'rgba(2, 4, 12, 0.35)'

const getViewportWidth = () => (typeof window === 'undefined' ? 1400 : window.innerWidth)
const getViewportHeight = () => (typeof window === 'undefined' ? 900 : window.innerHeight)

const pseudoRandom = (seed, salt = 0) => {
  const str = `${seed || 'seed'}-${salt}`
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  const result = Math.sin(hash) * 10000
  return result - Math.floor(result)
}

const MAP_TOPIC_RADIUS = 60
const MAP_KEYWORD_RADIUS = 28
const MAP_MARGIN_X = 220
const MAP_MARGIN_Y = 180
// Extra vertical padding so the map view can scroll past bottom overlays
const MAP_SCROLL_PADDING = 220
const MAX_CIRCLE_ATTEMPTS = 600
const GRADIENT_BLOB_COUNT = 4
const DEMO_STORAGE_KEY = 'ripple-demo-state-v1'

const clampText = (text = '', limit = 20) => {
  const input = (text || '').trim()
  if (!input) return ''
  if (input.length <= limit) return input
  let truncated = input.slice(0, limit)
  const lastSpace = truncated.lastIndexOf(' ')
  if (lastSpace > 8) {
    truncated = truncated.slice(0, lastSpace)
  }
  return `${truncated.trim()}…`
}

const getDynamicFontSize = (text = '', base = 18, min = 12) => {
  const length = Math.max(1, text.length)
  if (length <= 8) return base
  const scaled = base - (length - 8) * 0.8
  return Math.max(min, scaled)
}

const isCircleOverlapping = (x, y, radius, placed = [], padding = 12) => {
  return placed.some(circle => {
    const dx = circle.x - x
    const dy = circle.y - y
    const distance = Math.sqrt(dx * dx + dy * dy)
    return distance < (circle.radius + radius + padding)
  })
}

const findNonOverlappingPosition = (radius, placed, bounds, seed = '') => {
  const { width, height, marginX, marginY } = bounds
  for (let attempt = 0; attempt < MAX_CIRCLE_ATTEMPTS; attempt++) {
    const randX = pseudoRandom(`${seed}-x`, attempt)
    const randY = pseudoRandom(`${seed}-y`, attempt)
    const x = marginX + randX * (width - marginX * 2)
    const y = marginY + randY * (height - marginY * 2)
    if (!isCircleOverlapping(x, y, radius, placed)) {
      return { x, y }
    }
  }
  return {
    x: marginX + Math.random() * (width - marginX * 2),
    y: marginY + Math.random() * (height - marginY * 2)
  }
}

const findKeywordPosition = (topicCenter, radius, placed, bounds, keywordIndex = 0, total = 1, canvasCenter) => {
  const { marginX, marginY, width, height } = bounds
  const cCenter = canvasCenter || { x: width / 2, y: height / 2 }
  // Direction pointing outward from canvas center
  const dirX = topicCenter.x - cCenter.x
  const dirY = topicCenter.y - cCenter.y
  const baseAngle = Math.atan2(dirY, dirX)
  const noiseRange = Math.PI / 3 // +/-60 degrees
  for (let attempt = 0; attempt < MAX_CIRCLE_ATTEMPTS; attempt++) {
    const noise = (Math.random() - 0.5) * noiseRange
    const angle = baseAngle + noise
    const minDistance = 220
    const distance = minDistance + (Math.random() * 140) + (attempt % 10) * 4
    const x = topicCenter.x + Math.cos(angle) * distance
    const y = topicCenter.y + Math.sin(angle) * distance
    const withinX = x > marginX + radius && x < width - marginX - radius
    const withinY = y > marginY + radius && y < height - marginY - radius
    if (!withinX || !withinY) continue
    if (!isCircleOverlapping(x, y, radius, placed)) {
      return { x, y }
    }
  }
  return findNonOverlappingPosition(radius, placed, bounds, `kw-${Date.now()}-${keywordIndex}`)
}

const buildDynamicGradientSnapshot = (time = 0) => {
  const points = [
    {
      x: 50 + Math.sin(time * 0.8) * 35 + Math.cos(time * 0.3) * 15,
      y: 50 + Math.cos(time * 0.7) * 30 + Math.sin(time * 0.5) * 20,
      hue: 180 + Math.sin(time * 0.6) * 30 + Math.cos(time * 0.9) * 15,
      size: 800,
      opacity: 0.35,
      color: (hue) => `hsla(${hue}, 75%, 55%, 0.6)`
    },
    {
      x: 50 + Math.sin(time * 1.2 + 2.5) * 40 + Math.cos(time * 0.4) * 10,
      y: 50 + Math.cos(time * 0.9 + 1.8) * 35 + Math.sin(time * 0.6) * 15,
      hue: 210 + Math.sin(time * 0.8 + 1.5) * 25 + Math.cos(time * 0.4) * 15,
      size: 700,
      opacity: 0.28,
      color: (hue) => `hsla(${hue}, 70%, 53%, 0.5)`
    },
    {
      x: 50 + Math.sin(time * 0.6 + 4.2) * 45 + Math.cos(time * 1.1) * 20,
      y: 50 + Math.cos(time * 1.0 + 3.5) * 40 + Math.sin(time * 0.8) * 10,
      hue: 150 + Math.sin(time * 0.7 + 2.8) * 25 + Math.cos(time * 1.2) * 20,
      size: 750,
      opacity: 0.3,
      color: (hue) => `hsla(${hue}, 80%, 58%, 0.55)`
    },
    {
      x: 50 + Math.sin(time * 0.95 + 5.5) * 30 + Math.cos(time * 0.55) * 25,
      y: 50 + Math.cos(time * 0.85 + 2.2) * 38 + Math.sin(time * 1.15) * 12,
      hue: 130 + Math.sin(time * 1.1 + 4.0) * 20 + Math.cos(time * 0.65) * 15,
      size: 650,
      opacity: 0.32,
      color: (hue) => `hsla(${hue}, 68%, 50%, 0.58)`
    }
  ]

  const baseBackground = `
    radial-gradient(circle at ${points[0].x}% ${points[0].y}%, hsla(${points[0].hue}, 60%, 50%, 0.7), transparent 60%),
    radial-gradient(circle at ${points[1].x}% ${points[1].y}%, hsla(${points[1].hue}, 65%, 48%, 0.6), transparent 60%),
    radial-gradient(circle at ${points[2].x}% ${points[2].y}%, hsla(${points[2].hue}, 70%, 52%, 0.65), transparent 60%),
    radial-gradient(circle at ${points[3].x}% ${points[3].y}%, hsla(${points[3].hue}, 55%, 45%, 0.7), transparent 60%),
    linear-gradient(${time * 30}deg, hsl(236, 92.70%, 21.40%), hsl(179, 82.20%, 19.80%))
  `

  return {
    baseBackground,
    overlay: BG_OVERLAY_SHADE,
    blobs: points.map(point => ({
      ...point,
      colorValue: point.color(point.hue)
    }))
  }
}

  // 触发新话题的水滴 + 波纹
  const triggerTopicRipple = (topicId, pos) => {
    if (!pos) return
    const effectId = `${topicId}-${Date.now()}-${nextEffectId.current++}`
    const drop = { id: effectId, x: pos.x, y: pos.y }
    setDropEffects(prev => [...prev, drop])
    
    // 移除水滴
    setTimeout(() => {
      setDropEffects(prev => prev.filter(d => d.id !== effectId))
    }, 800)
    
    // 延迟生成波纹
    setTimeout(() => {
      setWaveEffects(prev => [...prev, { ...drop }])
      setTimeout(() => {
        setWaveEffects(prev => prev.filter(w => w.id !== effectId))
      }, 4200)
    }, 600)
  }
  
  // 环境慢速波纹，保持页面动态
  useEffect(() => {
    const spawnAmbient = () => {
      const id = `ambient-${Date.now()}-${nextEffectId.current++}`
      const width = window.innerWidth
      const height = Math.max(window.innerHeight, 900)
      const wave = {
        id,
        x: 200 + Math.random() * (width - 400),
        y: 150 + Math.random() * (height - 300)
      }
      setAmbientWaves(prev => [...prev.slice(-4), wave])
      setTimeout(() => {
        setAmbientWaves(prev => prev.filter(w => w.id !== id))
      }, 12000)
    }
    
    spawnAmbient()
    const timer = setInterval(spawnAmbient, 6000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let animationFrame
    const animateGradient = (time) => {
      if (!gradientLayerRef.current || !gradientBaseRef.current) {
        animationFrame = requestAnimationFrame(animateGradient)
        return
      }
      const snapshot = buildDynamicGradientSnapshot(time * 0.0005)
      gradientBaseRef.current.style.background = snapshot.baseBackground
      if (gradientOverlayRef.current) {
        gradientOverlayRef.current.style.background = snapshot.overlay
      }
      const bounds = gradientLayerRef.current.getBoundingClientRect()
      snapshot.blobs.forEach(blob => {
        const el = gradientBlobRefs.current[blob.id]
        if (!el) return
        const centerX = (blob.x / 100) * bounds.width
        const centerY = (blob.y / 100) * bounds.height
        const offsetX = centerX - bounds.width / 2
        const offsetY = centerY - bounds.height / 2
        const scale = blob.size / 800
        el.style.opacity = blob.opacity
        el.style.background = `radial-gradient(circle, ${blob.colorValue}, transparent)`
        el.style.transform = `translate(-50%, -50%) translate(${offsetX}px, ${offsetY}px) scale(${scale})`
      })
      animationFrame = requestAnimationFrame(animateGradient)
    }
    animationFrame = requestAnimationFrame(animateGradient)
    return () => cancelAnimationFrame(animationFrame)
  }, [])

  // 首屏获取话题 - temporarily disabled to start fresh on each page load
  // useEffect(() => {
  //   fetch('/topics').then(r => r.json()).then(d => setTopics(d.topics || []))
  // }, [])
  useEffect(() => {
    if (!isDemoPage || demoRunning) return
    const cached = loadDemoCache()
    if (cached?.topics?.length) {
      setTopics(cached.topics)
      setActiveId(cached.activeId || null)
      demoAutoStartedRef.current = true // prevent auto run when cache is present
      console.log('[demo] restored topics from cache:', cached.topics.length)
    }
  }, [isDemoPage, demoRunning])
  
  useEffect(() => {
    if (!isDemoPage) return
    if (!topics || topics.length === 0) return
    saveDemoCache({ topics, activeId })
  }, [topics, activeId, isDemoPage])
  
  // 新话题触发水滴波纹
  useEffect(() => {
    if (!newTopicIds || newTopicIds.length === 0) return
    newTopicIds.forEach(id => {
      const pos = positionsRef.current[id]
      if (pos) triggerTopicRipple(id, pos)
    })
  }, [newTopicIds])

  // 清除动画class
  useEffect(() => {
    if (newTopicIds.length > 0 || updatedTopicIds.length > 0) {
      const timer = setTimeout(() => {
        setNewTopicIds([])
        setUpdatedTopicIds([])
      }, 600)
      return () => clearTimeout(timer)
    }
  }, [newTopicIds, updatedTopicIds])

  const connect = () => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const sock = new WebSocket(`${proto}//${location.host}/ws`)
    sock.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data)
        if (data.event === 'transcript') {
          console.log('[ui] transcript:', data.text)
          setLiveText(data.text)
        } else if (data.event === 'topics') {
          console.log('[ui] topics update:', data.topics?.length, 'topics')
          setTopics(data.topics || [])
        }
      } catch (e) {}
    }
    sock.onclose = () => {
      console.log('[ws] connection closed')
      setWs(null)
    }
    sock.onerror = () => {
      console.log('[ws] connection error')
      setWs(null)
    }
    sock.onopen = () => console.log('[ws] connected')
    setWs(sock)
  }

  // 兼容不同浏览器的 getUserMedia
  const getUserMediaCompat = (constraints) => {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      return navigator.mediaDevices.getUserMedia(constraints)
    }
    const legacy = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia
    if (legacy) {
      return new Promise((resolve, reject) => legacy.call(navigator, constraints, resolve, reject))
    }
    return Promise.reject(new Error('getUserMedia is not supported in this context.'))
  }

  // 自动选择浏览器支持的音频格式
  const pickType = () => {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',   // Safari 可能支持
      ''
    ]
    for (const t of candidates) {
      if (!t) return {}
      if (window.MediaRecorder && MediaRecorder.isTypeSupported?.(t)) return { mimeType: t }
    }
    return {}
  }

  const start = async () => {
    // 检查是否在安全上下文中
    const isSecure = location.protocol === 'https:' ||
                     location.hostname === 'localhost' ||
                     location.hostname === '127.0.0.1'
    if (!isSecure) {
      alert('Please open http://localhost:8000 or an https origin to use the microphone.\nCurrent: ' + location.href)
      return
    }
    if (!window.MediaRecorder) {
      alert('This browser does not support MediaRecorder. Please update to the latest Chrome.')
      return
    }

    // 确保 WebSocket 连接完成
    if (!ws || ws.readyState !== 1) {
      console.log('[start] waiting for WebSocket connection...')
      connect()
      // 等待连接建立（最多3秒）
      for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 100))
        if (ws && ws.readyState === 1) {
          console.log('[start] WebSocket ready')
          break
        }
      }
      if (!ws || ws.readyState !== 1) {
        alert('WebSocket connection failed. Please refresh the page and try again.')
        return
      }
    }

    try {
      const stream = await getUserMediaCompat({ audio: true })
      mediaRef.current = stream

      const opts = pickType()
      
      // 创建录音循环函数：定时停止并重启，确保每个切片都有完整的 WebM 头部
      const startRecordingCycle = () => {
        if (!mediaRef.current) return
        
        const rec = new MediaRecorder(mediaRef.current, opts)
        
        rec.ondataavailable = e => {
          console.log('[recorder] blob size:', e.data?.size, 'type:', e.data?.type, 'ws state:', ws?.readyState)
          if (ws && ws.readyState === 1 && e.data && e.data.size > 0) {
            // 检查数据大小
            if (e.data.size < 1000) {
              console.warn('[recorder] data too small, skipping:', e.data.size)
              return
            }
            e.data.arrayBuffer().then(buf => {
              console.log('[recorder] sending', buf.byteLength, 'bytes')
              ws.send(buf)
            })
          } else {
            console.warn('[recorder] cannot send: ws not ready or no data')
          }
        }
        
        rec.onerror = (ev) => console.error('[recorder] error:', ev.error)
        
        rec.onstop = () => {
          console.log('[recorder] chunk completed, restarting...')
          // 如果还在录音状态，立即开始下一个循环
          if (recRef.current) {
            startRecordingCycle()
          }
        }
        
        // 不使用 timeslice，直接 start()，然后 10 秒后手动 stop
        rec.start()
        recRef.current = rec
        
        // 10 秒后停止（会触发 onstop，然后自动重启）
        timerRef.current = setTimeout(() => {
          if (rec.state === 'recording') {
            rec.stop()
          }
        }, 10000)
      }
      
      // 开始第一个录音循环
      startRecordingCycle()
      setRecording(true)
      console.log('[recorder] started with 10s auto-restart cycle')
      
    } catch (err) {
      console.error('[mic] getUserMedia failed:', err)
      alert('Could not access the microphone:\n1) Open http://localhost:8000 in Chrome\n2) Allow the microphone permission\n3) System Settings > Privacy & Security > Microphone: allow Chrome')
    }
  }

  const stop = () => {
    // 停止录音器
    if (recRef.current) {
      recRef.current.stop()
      recRef.current = null  // 清空引用，防止 onstop 中自动重启
    }
    // 停止定时器
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    // 停止媒体流
    mediaRef.current?.getTracks().forEach(t => t.stop())
    mediaRef.current = null
    
    setRecording(false)
    setLiveText('')
    console.log('[recorder] stopped')
  }

  // 演示模式：逐句处理测试文本
  // Create new canvas - saves current to history and clears
  const createNewCanvas = async () => {
    if (recording) return
    
    try {
      const response = await fetch('/canvas/new', { method: 'POST' })
      const data = await response.json()
      
      if (data.ok) {
        // Clear current state
        setTopics([])
        setRipplePositions({})
        positionsRef.current = {}
        setActiveId(null)
        console.log('[canvas] New canvas created, previous saved:', data.title)
      }
    } catch (err) {
      console.error('[canvas] Error creating new canvas:', err)
    }
  }
  
  // Load history list
  const loadHistoryList = async () => {
    setLoadingHistory(true)
    try {
      const response = await fetch('/canvas/history')
      const data = await response.json()
      setHistoryList(data.canvases || [])
    } catch (err) {
      console.error('[canvas] Error loading history:', err)
      setHistoryList([])
    }
    setLoadingHistory(false)
  }
  
  // Toggle history panel
  const toggleHistory = () => {
    if (!historyOpen) {
      loadHistoryList()
    }
    setHistoryOpen(!historyOpen)
  }
  
  // Load a specific canvas from history
  const loadCanvas = async (canvasId) => {
    try {
      const response = await fetch(`/canvas/load/${canvasId}`, { method: 'POST' })
      const data = await response.json()
      
      if (data.ok) {
        // Fetch the updated topics
        const topicsResponse = await fetch('/topics')
        const topicsData = await topicsResponse.json()
        setTopics(topicsData.topics || [])
        setRipplePositions({})
        positionsRef.current = {}
        setActiveId(null)
        setHistoryOpen(false)
        console.log('[canvas] Loaded canvas:', canvasId)
      }
    } catch (err) {
      console.error('[canvas] Error loading canvas:', err)
    }
  }

  const runDemo = async () => {
    if (demoRunning) return
    
    setDemoRunning(true)
    clearDemoCache()
    setTopics([]) // 清空现有话题
    setRipplePositions({}) // 清空位置信息
    positionsRef.current = {} // 清空 ref
    setActiveId(null) // 清空选中
    console.log('[demo] starting...')
    
    // 清空后端的话题数据
    try {
      await fetch('/demo/clear', { method: 'POST' })
    } catch (err) {
      console.error('[demo] clear error:', err)
    }
    
    // 等待一下让用户准备
    await new Promise(resolve => setTimeout(resolve, 500))
    
    for (let i = 0; i < demoSentences.length; i++) {
      const sentence = demoSentences[i]
      console.log(`[demo] processing sentence ${i+1}/${demoSentences.length}:`, sentence)
      
      // 显示当前处理的句子
      setLiveText(`[${i+1}/${demoSentences.length}] ${sentence}`)
      
      try {
        // 发送到后端处理
        const response = await fetch('/demo/process', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({text: sentence})
        })
        
        const data = await response.json()
        
        if (data.error) {
          console.error('[demo] error:', data.error)
          continue
        }
        
        // 更新话题列表
        setTopics(data.topics || [])
        
        // 标记新增和更新的话题（用于动画）
        if (data.new_topics && data.new_topics.length > 0) {
          console.log('[demo] new topics:', data.new_topics)
          setNewTopicIds(data.new_topics)
        }
        if (data.updated_topics && data.updated_topics.length > 0) {
          console.log('[demo] updated topics:', data.updated_topics)
          setUpdatedTopicIds(data.updated_topics)
        }
        
        // 等待一下再处理下一句（让用户能看到动画，并确保位置计算完成）
        await new Promise(resolve => setTimeout(resolve, 2000))
        
      } catch (err) {
        console.error('[demo] fetch error:', err)
      }
    }
    
    setDemoRunning(false)
    setLiveText('')
    console.log('[demo] finished!')
  }

  const resetDemoData = () => {
    clearDemoCache()
    setTopics([])
    setRipplePositions({})
    positionsRef.current = {}
    setActiveId(null)
    setLiveText('')
    demoAutoStartedRef.current = false
    console.log('[demo] cache cleared')
  }

  useEffect(() => {
    if (!isDemoPage || demoAutoStartedRef.current) return
    demoAutoStartedRef.current = true
    runDemo()
  }, [isDemoPage])

  const active = topics.find(t => t.id === activeId)

  // 计算圆圈大小（基于标签与关键词的长度，确保可容纳文本）
  const calculateRippleSize = (label, keyphrases = []) => {
    const displayLabel = formatTopicLabel(label)
    const keywordsText = Array.isArray(keyphrases) ? keyphrases.join(' ') : ''
    
    const baseSize = 200
    const labelLines = Math.max(1, Math.ceil(displayLabel.length / 14))
    const keywordLines = Math.max(1, Math.ceil(keywordsText.length / 28))
    
    const estimatedHeight = (labelLines * 18) + (keywordLines * 14) + 50
    const widthScore = baseSize + Math.min(keywordsText.length * 1.2, 160)
    
    const size = Math.max(baseSize, estimatedHeight * 1.3, widthScore)
    return Math.min(size, 420)
  }
  
  // 将驼峰命名转换为带空格的标题（如 "TravelPlan" -> "Travel Plan"）
  const formatTopicLabel = (label) => {
    if (!label) return ''
    return label
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim()
  }
  
  // 检查两个圆圈是否重叠（严格模式，包含外圈和间距）
  const isOverlapping = (x1, y1, r1, x2, y2, r2) => {
    // 两个圆心的距离必须大于：半径1 + 半径2 + 外圈1(50) + 外圈2(50) + 安全间距(20)
    const minDistance = r1 + r2 + 120 // 50+50+20
    const distance = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
    return distance < minDistance
  }
  
  // 为新圆圈找到合适的位置
  const findPosition = (existingRipples, size) => {
    // Full viewport width
    const canvasWidth = getViewportWidth()
    // Full viewport height minus bottom control area (160px)
    const canvasHeight = Math.max(getViewportHeight() - 160, 400)
    const radius = size / 2
    
    console.log(`[findPosition] Called with ${existingRipples.length} existing ripples, size=${size}, canvas: ${canvasWidth}x${canvasHeight}`)
    
    // Small edge margin to prevent circles from being cut off
    const edgeMargin = radius + 40
    
    // 第一个圆圈：随机位置
    if (existingRipples.length === 0) {
      const x = edgeMargin + Math.random() * (canvasWidth - 2 * edgeMargin)
      const y = edgeMargin + Math.random() * (canvasHeight - 2 * edgeMargin)
      console.log(`[findPosition] First circle at (${x.toFixed(0)}, ${y.toFixed(0)})`)
      return { x, y }
    }
    
    // 后续圆圈：随机搜索，严格避让
    const maxAttempts = 300
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // 随机位置，使用全部可用空间
      const x = edgeMargin + Math.random() * (canvasWidth - 2 * edgeMargin)
      const y = edgeMargin + Math.random() * (canvasHeight - 2 * edgeMargin)
      
      let overlapping = false
      let minDistFound = Infinity
      
      for (const existing of existingRipples) {
        // 计算最小安全距离：两个圆的半径 + 外圈 + 间隙
        const r1 = radius + 50 + 30  // 我的半径 + 外圈 + 间隙
        const r2 = (existing.size / 2) + 50 + 30  // 对方的半径 + 外圈 + 间隙
        const minDist = r1 + r2
        
        const dx = x - existing.x
        const dy = y - existing.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        
        minDistFound = Math.min(minDistFound, dist)
        
        if (dist < minDist) {
          overlapping = true
          break
        }
      }
      
      if (!overlapping) {
        console.log(`[findPosition] Found position at (${x.toFixed(0)}, ${y.toFixed(0)}) after ${attempt + 1} attempts`)
        return { x, y }
      }
    }
    
    // 找不到，垂直堆叠到最下方
    console.warn('[findPosition] Could not find non-overlapping position, stacking vertically')
    const maxY = Math.max(...existingRipples.map(r => r.y + r.size/2))
    return {
      x: canvasWidth / 2 + (Math.random() * 200 - 100),
      y: maxY + size/2 + 150
    }
  }
  
  // 对所有圆圈应用"斥力"迭代，避免最外侧重叠
  const relaxPositions = (positions) => {
    const entries = Object.entries(positions).map(([id, pos]) => [id, { ...pos }])
    if (entries.length <= 1) return positions
    
    // Full viewport dimensions
    const width = getViewportWidth()
    const height = Math.max(getViewportHeight() - 160, 400)
    const edgeMargin = 60
    
    for (let iter = 0; iter < 25; iter++) {
      let moved = false
      for (let i = 0; i < entries.length; i++) {
        const [, a] = entries[i]
        for (let j = i + 1; j < entries.length; j++) {
          const [, b] = entries[j]
          const minDist = (a.size / 2) + (b.size / 2) + 140
          let dx = b.x - a.x
          let dy = b.y - a.y
          let dist = Math.sqrt(dx * dx + dy * dy)
          if (dist === 0) {
            dist = 0.01
            dx = 0.01
            dy = 0
          }
          if (dist < minDist) {
            const overlap = (minDist - dist) / 2
            const nx = dx / dist
            const ny = dy / dist
            a.x -= nx * overlap
            a.y -= ny * overlap
            b.x += nx * overlap
            b.y += ny * overlap
            moved = true
          }
        }
      }
      entries.forEach(([, pos]) => {
        const rippleEdge = (pos.size / 2) + 40
        pos.x = Math.min(width - rippleEdge, Math.max(rippleEdge, pos.x))
        pos.y = Math.min(height - rippleEdge, Math.max(rippleEdge, pos.y))
      })
      if (!moved) break
    }
    return Object.fromEntries(entries)
  }
  
   // 为所有话题计算位置
   useEffect(() => {
     // 如果没有话题，清空位置
     if (topics.length === 0) {
        setRipplePositions({})
        positionsRef.current = {}
        return
     }

     const newPositions = {}
     // 关键：使用 ref 中的最新位置来检测碰撞
     const currentPositions = positionsRef.current
     const occupied = [] 
     
     console.log(`[layout] ===== Computing positions for ${topics.length} topics =====`)
     console.log(`[layout] Current positions in ref:`, Object.keys(currentPositions).map(id => `${id.slice(0,8)}: (${currentPositions[id].x.toFixed(0)}, ${currentPositions[id].y.toFixed(0)})`))
     
    topics.forEach((topic, index) => {
      const size = calculateRippleSize(topic.label, topic.keyphrases)
       console.log(`[layout] Processing topic ${index}: ${topic.label} (${topic.id.slice(0,8)}), size=${size}`)
       
       // 1. 如果已有位置
       if (currentPositions[topic.id]) {
         const existingPos = currentPositions[topic.id]
         const oldSize = existingPos.size
         const sizeChanged = Math.abs(size - oldSize) > 10 // 大小变化超过10px
         
         if (sizeChanged) {
           console.log(`[layout]   -> Size changed from ${oldSize} to ${size}, checking overlap...`)
           
           // 检查新大小是否会导致重叠
           let wouldOverlap = false
           for (const occ of occupied) {
             const r1 = size / 2 + 50 + 30
             const r2 = occ.size / 2 + 50 + 30
             const dist = Math.sqrt((existingPos.x - occ.x) ** 2 + (existingPos.y - occ.y) ** 2)
             if (dist < r1 + r2) {
               wouldOverlap = true
               break
             }
           }
           
           if (wouldOverlap) {
             // 需要重新找位置
             console.log(`[layout]   -> Would overlap, finding new position`)
             const pos = findPosition(occupied, size)
             newPositions[topic.id] = { x: pos.x, y: pos.y, size }
             occupied.push({ x: pos.x, y: pos.y, size })
           } else {
             // 可以保留位置，只更新大小
             newPositions[topic.id] = { ...existingPos, size }
             occupied.push({ x: existingPos.x, y: existingPos.y, size })
             console.log(`[layout]   -> Size changed but no overlap, keeping position`)
           }
         } else {
           // 大小没变，直接复用
           newPositions[topic.id] = { ...existingPos, size }
           occupied.push({ x: existingPos.x, y: existingPos.y, size })
           console.log(`[layout]   -> Reusing position (${existingPos.x.toFixed(0)}, ${existingPos.y.toFixed(0)})`)
         }
       } else {
         // 2. 新话题：寻找新的空闲位置
         console.log(`[layout]   -> NEW topic, calling findPosition with ${occupied.length} occupied circles`)
         const pos = findPosition(occupied, size)
         newPositions[topic.id] = { x: pos.x, y: pos.y, size }
         // 立即标记为已占用
         occupied.push({ x: pos.x, y: pos.y, size })
         console.log(`[layout]   -> Placed at (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})`)
       }
     })
     
    console.log(`[layout] ===== Final occupied list: ${occupied.length} circles =====`)
    
    const relaxed = relaxPositions(newPositions)
    
    // 立即更新 ref，确保下次 useEffect 能看到最新值
    positionsRef.current = relaxed
    setRipplePositions(relaxed)
   }, [topics])

  useEffect(() => {
    if (!topics || topics.length === 0) {
      colorMapRef.current = {}
      return
    }
    const nextMap = { ...colorMapRef.current }
    const activeIds = new Set()
    topics.forEach((topic, index) => {
      const topicId = topic.id || `topic-${index}`
      activeIds.add(topicId)
      if (!nextMap[topicId]) {
        nextMap[topicId] = TOPIC_COLORS[index % TOPIC_COLORS.length]
      }
    })
    Object.keys(nextMap).forEach(id => {
      if (!activeIds.has(id)) {
        delete nextMap[id]
      }
    })
    colorMapRef.current = nextMap
  }, [topics])

  useEffect(() => {
    if (!topics || topics.length === 0) {
      mapPositionsRef.current = {}
      return
    }
    const fullWidth = Math.max(getViewportWidth(), 820)
    const fullHeight = Math.max(getViewportHeight(), 640)
    const bounds = {
      width: fullWidth,
      height: fullHeight,
      marginX: 40,
      marginY: 40
    }

    const placed = []
    const nextPositions = {}

    topics.forEach((topic, index) => {
      const topicId = topic.id || `topic-${index}`
      const pos = findNonOverlappingPosition(MAP_TOPIC_RADIUS, placed, bounds, topicId)
      nextPositions[topicId] = { ...pos, radius: MAP_TOPIC_RADIUS }
      placed.push({ ...pos, radius: MAP_TOPIC_RADIUS })
    })

    mapPositionsRef.current = { ...nextPositions, __canvasCenter: { x: fullWidth / 2, y: fullHeight / 2 } }
  }, [topics])
  
  // 生成要展示的关键词文本
  const getKeywordLine = (topic) => {
    if (topic.keyphrases && topic.keyphrases.length > 0) {
      return topic.keyphrases.slice(0, 4).join(' • ')
    }
    if (topic.summary && topic.summary.trim()) {
      return topic.summary
    }
    if (topic.points && topic.points.length > 0) {
      return topic.points[0].text || ''
    }
    return formatTopicLabel(topic.label)
  }

  const getTopicKeywords = (topic) => {
    if (Array.isArray(topic.keyphrases) && topic.keyphrases.length > 0) {
      return topic.keyphrases
    }
    if (Array.isArray(topic.points) && topic.points.length > 0) {
      return topic.points.map(p => p?.text).filter(Boolean)
    }
    if (typeof topic.summary === 'string' && topic.summary.trim().length > 0) {
      return topic.summary
        .split(/[,，。.;]/)
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 4)
    }
    return [formatTopicLabel(topic.label)]
  }

  useEffect(() => {
    if (!topics || topics.length === 0) {
      keywordOrbitCacheRef.current = {}
      return
    }
    const nextCache = {}
    topics.forEach((topic, index) => {
      const topicId = topic.id || `topic-${index}`
      const keywords = getTopicKeywords(topic).slice(0, 6)
      const existing = keywordOrbitCacheRef.current[topicId] || {}
      nextCache[topicId] = {}
      keywords.forEach((keyword, keywordIndex) => {
        const cacheKey = `${keyword}-${keywordIndex}`
        if (existing[cacheKey]) {
          nextCache[topicId][cacheKey] = existing[cacheKey]
        }
      })
    })
    keywordOrbitCacheRef.current = nextCache
  }, [topics])

  const getTopicColor = (topic, index = 0) => {
    const topicId = topic.id || `topic-${index}`
    return colorMapRef.current[topicId] || TOPIC_COLORS[index % TOPIC_COLORS.length]
  }

  const getMapPosition = (topic, index = 0) => {
    const topicId = topic.id || `topic-${index}`
    return mapPositionsRef.current[topicId] || {
      x: 240 + index * 70,
      y: 280 + index * 50,
      radius: MAP_TOPIC_RADIUS
    }
  }

  const getKeywordOrbitPositions = (topic, keywords, index = 0, occupancy = [], bounds) => {
    const center = getMapPosition(topic, index)
    const topicId = topic.id || `topic-${index}`
    if (!keywordOrbitCacheRef.current[topicId]) {
      keywordOrbitCacheRef.current[topicId] = {}
    }
    return keywords.map((keyword, keywordIndex) => {
      const cacheKey = `${keyword}-${keywordIndex}`
      const cached = keywordOrbitCacheRef.current[topicId][cacheKey]
      if (cached) {
        occupancy.push({ x: cached.x, y: cached.y, radius: MAP_KEYWORD_RADIUS })
        return { keyword, ...cached }
      }
      const pos = findKeywordPosition(center, MAP_KEYWORD_RADIUS, occupancy, bounds, keywordIndex, keywords.length, bounds.canvasCenter)
      keywordOrbitCacheRef.current[topicId][cacheKey] = { x: pos.x, y: pos.y }
      occupancy.push({ ...pos, radius: MAP_KEYWORD_RADIUS })
      return { keyword, ...pos }
    })
  }


  const rippleCanvasHeight = useMemo(() => {
    const values = Object.values(ripplePositions || {})
    // Minimum height: full viewport minus bottom controls
    const minHeight = Math.max(getViewportHeight() - 160, 400)
    if (!values.length) return minHeight
    const maxY = Math.max(...values.map(pos => (pos.y || 0) + (pos.size || 0) / 2))
    return Math.max(Math.min(maxY + 80, 3200), minHeight)
  }, [ripplePositions, topics.length])
  
  // 渲染单个 Ripple
  const renderRipple = (topic) => {
    const pos = ripplePositions[topic.id]
    if (!pos) return null
    const topicIndex = topics.findIndex(t => t.id === topic.id)
    const color = getTopicColor(topic, topicIndex >= 0 ? topicIndex : 0)
    
    const isNew = newTopicIds.includes(topic.id)
    const isUpdated = updatedTopicIds.includes(topic.id)
    const isSelected = activeId === topic.id
    
    const className = ['ripple']
    if (isNew) className.push('new')
    if (isUpdated) className.push('expanding')
    if (isSelected) className.push('selected')
    
    const style = {
      left: `${pos.x}px`,
      top: `${pos.y}px`,
      width: `${pos.size}px`,
      height: `${pos.size}px`,
      transform: 'translate(-50%, -50%)',
      borderColor: color,
      '--ripple-color': color
    }
    
    // 摘要：用完整文本，交给 CSS 做多行截断 + 省略号
    const keywordText = getKeywordLine(topic)
    // 标题可以多一点字符，再截断
    const labelText = clampText(formatTopicLabel(topic.label), 40)
    const labelFontSize = getDynamicFontSize(labelText, 18, 12)
    const summaryFontSize = getDynamicFontSize(keywordText, 14, 10)
    
    return React.createElement('div', {
      key: topic.id,
      className: className.join(' '),
      style,
      onClick: () => setActiveId(activeId === topic.id ? null : topic.id)
    },
      React.createElement('div', {
        className: 'ripple-label',
        style: { fontSize: `${labelFontSize}px` }
      }, labelText),
      React.createElement('div', {
        className: 'ripple-summary',
        style: { fontSize: `${summaryFontSize}px` }
      }, keywordText)
    )
  }

  const  renderViewPlaceholder= (title, subtitle) => (
    React.createElement('div', {className: 'view-placeholder'},
      React.createElement('h3', null, title),
      React.createElement('p', null, subtitle)
    )
  )

  const renderRippleView = () => {
    if (!topics || topics.length === 0) {
      return React.createElement('div', {className: 'view-panel ripple-view empty'},
        renderViewPlaceholder('Ripple', 'Ripples are born and growing with topics expanding over time.')
      )
    }
    return React.createElement('div', {className: 'view-panel ripple-view'},
      React.createElement('div', {className: 'panel-bounds'},
        React.createElement('div', {className: 'panel-scroll'},
          React.createElement('div', {
            className: 'panel-stage',
            style: { height: `${rippleCanvasHeight}px` }
          },
            React.createElement('div', {
              className: 'ripple-canvas',
              style: { height: `${rippleCanvasHeight}px` }
            },
              topics.map(renderRipple)
            )
          )
        )
      )
    )
  }

  const renderLanesView = () => {
    if (!topics || topics.length === 0) {
      return React.createElement('div', {className: 'view-panel lanes-view empty'},
        renderViewPlaceholder('Lanes', 'Topics will form horizontal swimlanes and highlight their key terms.')
      )
    }
    return React.createElement('div', {className: 'view-panel lanes-view'},
      topics.map((topic, index) => {
        const color = getTopicColor(topic, index)
        const keywords = getTopicKeywords(topic)
        return React.createElement('div', {
          key: topic.id,
          className: `lane-card ${activeId === topic.id ? 'selected' : ''}`,
          style: { borderColor: color },
          onClick: () => setActiveId(activeId === topic.id ? null : topic.id)
        },
          React.createElement('div', {
            className: 'lane-pulse',
            style: { backgroundColor: `${color}22`, color }
          },
            React.createElement('div', {
              className: 'lane-dot',
              style: { backgroundColor: color }
            })
          ),
          React.createElement('div', {className: 'lane-body'},
            React.createElement('div', {className: 'lane-title-row'},
              React.createElement('h3', {className: 'lane-title'}, formatTopicLabel(topic.label)),
              React.createElement('span', {className: 'lane-count'}, `${keywords.length} tags`)
            ),
            React.createElement('div', {className: 'lane-keywords'},
              keywords.slice(0, 6).map((keyword, idx) =>
                React.createElement('span', {className: 'lane-chip', key: idx}, keyword)
              )
            )
          )
        )
      })
    )
  }

  const renderStacksView = () => {
    if (!topics || topics.length === 0) {
      return React.createElement('div', {className: 'view-panel stacks-view empty'},
        renderViewPlaceholder('Stacks', 'Topics will stack vertically as cards with quick keyword previews.')
      )
    }
    return React.createElement('div', {className: 'view-panel stacks-view'},
      React.createElement('div', {className: 'stack-track'},
        topics.map((topic, index) => {
          const color = getTopicColor(topic, index)
          const keywords = getTopicKeywords(topic)
          return React.createElement('div', {
            key: topic.id,
            className: `stack-card ${activeId === topic.id ? 'selected' : ''}`,
            style: { borderColor: color },
            onClick: () => setActiveId(activeId === topic.id ? null : topic.id)
          },
            React.createElement('div', {className: 'stack-head'},
              React.createElement('div', {className: 'stack-marker', style: { backgroundColor: `${color}4d` }},
                React.createElement('span', {style: { backgroundColor: color }})
              ),
              React.createElement('div', null,
                React.createElement('h3', {className: 'stack-title'}, formatTopicLabel(topic.label)),
                React.createElement('p', {className: 'stack-subtitle'}, `${keywords.length} key terms`)
              )
            ),
            React.createElement('div', {className: 'stack-body'},
              keywords.slice(0, 5).map((keyword, idx) =>
                React.createElement('div', {className: 'stack-chip', key: idx}, keyword)
              )
            )
          )
        })
      )
    )
  }

  const renderMapView = () => {
    if (!topics || topics.length === 0) {
      return React.createElement(
        'div',
        { className: 'view-panel map-view empty' },
        renderViewPlaceholder(
          'Map',
          'Topics and keywords form constellation-style connections.'
        )
      )
    }

    // 和 Ripple 一样：用 rippleCanvasHeight 作为画布高度
    const viewportWidth = getViewportWidth()
    const viewportHeight = rippleCanvasHeight

    const centerX = viewportWidth / 2
    const centerY = viewportHeight / 2

    const topicRadius = MAP_TOPIC_RADIUS
    const keywordRadius = MAP_KEYWORD_RADIUS

    // 在上下左右都预留 MAP_MARGIN_X / MAP_MARGIN_Y 后，画布允许的最大半径
    const availableRadiusX = centerX - MAP_MARGIN_X
    const availableRadiusY = centerY - MAP_MARGIN_Y
    const maxAvailableRadius = Math.max(
      120,
      Math.min(availableRadiusX, availableRadiusY)
    )

    // 最外圈：keyword 圆心能到达的最大半径
    const outerRadius = maxAvailableRadius - keywordRadius - 10

    // topic 在内圈，约等于外圈 60% 的位置
    const topicRingRadius = Math.max(
      topicRadius + 40,
      outerRadius * 0.6
    )

    // keyword 在 topic 外面一圈到 outerRadius 之间
    // —— 比原来再长一点（+50），线更长
    let keywordInnerRadius = topicRingRadius + topicRadius + 50
    let keywordOuterRadius = outerRadius

    // 如果空间太挤，稍微压缩一下
    if (keywordInnerRadius > keywordOuterRadius - 40) {
      keywordInnerRadius = topicRingRadius + topicRadius + 20
      keywordOuterRadius = outerRadius
    }

    const keywordRadialSpan = Math.max(
      keywordOuterRadius - keywordInnerRadius,
      40
    )

    // topics 均匀分布在圆上
    const angleStep = (2 * Math.PI) / topics.length
    // keyword 在该 topic 的径向线 ±30° 内
    const maxAngleOffset = Math.PI / 6

    // 全局已占用的圆，用来轻微推开重叠的 circle
    const globalOccupied = []

    const pushOutIfOverlapping = (x, y, radius) => {
      let nx = x
      let ny = y
      const maxSteps = 6

      for (let step = 0; step < maxSteps; step++) {
        let hasOverlap = false

        for (const occ of globalOccupied) {
          const dx = nx - occ.x
          const dy = ny - occ.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001
          const minDist = radius + occ.radius + 4

          if (dist < minDist) {
            hasOverlap = true
            // 从画布中心向外推（保持整体形状接近圆）
            const dirX = nx - centerX
            const dirY = ny - centerY
            const len = Math.sqrt(dirX * dirX + dirY * dirY) || 1
            const ux = dirX / len
            const uy = dirY / len
            const pushAmount = (minDist - dist) * 0.6

            nx += ux * pushAmount
            ny += uy * pushAmount
          }
        }

        if (!hasOverlap) break
      }

      // 防止被推到画布外面
      const edge = radius + 32
      nx = Math.max(edge, Math.min(viewportWidth - edge, nx))
      ny = Math.max(edge, Math.min(viewportHeight - edge, ny))

      globalOccupied.push({ x: nx, y: ny, radius })
      return { x: nx, y: ny }
    }

    return React.createElement(
      'div',
      { className: 'view-panel map-view' },
      React.createElement(
        'div',
        { className: 'panel-bounds' },
        React.createElement(
          'div',
          {
            className: 'panel-scroll',
            // 和 Ripple 一样在底部多留一点空，避免被录音按钮压住
            style: { paddingBottom: `${MAP_SCROLL_PADDING}px` }
          },
          React.createElement(
            'div',
            {
              className: 'panel-stage',
              // 关键：stage 高度 = rippleCanvasHeight，这样滚动逻辑和 Ripple 一致
              style: { height: `${viewportHeight}px` }
            },
            React.createElement(
              'svg',
              {
                className: 'map-canvas',
                width: viewportWidth,
                height: viewportHeight,
                // SVG 自己再铺满 panel-stage
                style: { width: '100%', height: '100%' }
              },
              // glass blur filter
              React.createElement(
                'defs',
                null,
                React.createElement(
                  'filter',
                  {
                    id: 'glass-blur',
                    x: '-50%',
                    y: '-50%',
                    width: '200%',
                    height: '200%'
                  },
                  React.createElement('feGaussianBlur', {
                    in: 'SourceGraphic',
                    stdDeviation: '8'
                  })
                )
              ),
              topics.map((topic, index) => {
                const color = getTopicColor(topic, index)
                const keywords = getTopicKeywords(topic).slice(0, 6)
                const topicId = topic.id || `topic-${index}`

                // ========= 1) Topic 角度 & 半径：加一点稳定随机性 =========
                const baseAngle = index * angleStep - Math.PI / 2
                const maxJitter = Math.min(angleStep * 0.35, Math.PI / 6)
                const angleJitter =
                  (pseudoRandom(topicId, 'topic-angle') - 0.5) * maxJitter
                const angle = baseAngle + angleJitter

                const radialJitter =
                  (pseudoRandom(topicId, 'topic-radius') - 0.5) * 18
                const topicRadial = Math.max(
                  topicRingRadius - 18,
                  Math.min(topicRingRadius + 18, topicRingRadius + radialJitter)
                )

                let tx = centerX + topicRadial * Math.cos(angle)
                let ty = centerY + topicRadial * Math.sin(angle)

                // 轻微推开彼此（防止 topic 圆互相压得太紧）
                const adjustedTopic = pushOutIfOverlapping(
                  tx,
                  ty,
                  topicRadius + 6
                )
                tx = adjustedTopic.x
                ty = adjustedTopic.y

                const topicText = clampText(formatTopicLabel(topic.label))
                const topicFontSize = getDynamicFontSize(topicText, 16, 11)

                // ========= 2) Keyword 位置：更长的线 + 角度/半径随机 =========
                const keywordNodes = keywords.map((keyword, kIdx) => {
                  const count = keywords.length || 1
                  const t = count === 1 ? 0.5 : kIdx / (count - 1)

                  const baseKwAngle =
                    angle - maxAngleOffset + t * (2 * maxAngleOffset)

                  const noiseKey = `${topicId}-${keyword}-${kIdx}`
                  const angleNoise =
                    (pseudoRandom(noiseKey, 'kw-angle') - 0.5) *
                    (maxAngleOffset * 0.35)
                  const kwAngle = baseKwAngle + angleNoise

                  let radial
                  if (count === 1) {
                    radial = keywordInnerRadius + keywordRadialSpan / 2
                  } else {
                    const localStep = keywordRadialSpan / (count - 1)
                    radial = keywordInnerRadius + kIdx * localStep
                  }

                  // 半径再加一点随机 jitter，让线长短略有变化
                  const radialNoise =
                    (pseudoRandom(noiseKey, 'kw-radius') - 0.5) * 30
                  radial = Math.max(
                    keywordInnerRadius,
                    Math.min(keywordOuterRadius, radial + radialNoise)
                  )

                  let kx = centerX + radial * Math.cos(kwAngle)
                  let ky = centerY + radial * Math.sin(kwAngle)

                  // 轻微推开与其他 topic / keyword 的重叠
                  const adjusted = pushOutIfOverlapping(
                    kx,
                    ky,
                    keywordRadius + 4
                  )
                  kx = adjusted.x
                  ky = adjusted.y

                  return { keyword, x: kx, y: ky }
                })

                return React.createElement(
                  'g',
                  { key: topic.id },
                  // 连接 topic 和每个 keyword 的线（仍然用绝对坐标）
                  keywordNodes.map((pos, idx) =>
                    React.createElement('line', {
                      key: `line-${topic.id}-${idx}`,
                      x1: tx,
                      y1: ty,
                      x2: pos.x,
                      y2: pos.y,
                      stroke: 'rgba(255,255,255,0.3)',
                      strokeWidth: 1.5,
                      opacity: 0.5
                    })
                  ),

                  // ========= 3) Topic 圆：用 <g transform>，可平滑过渡 =========
                  React.createElement(
                    'g',
                    {
                      className: `map-topic ${
                        activeId === topic.id ? 'selected' : ''
                      }`,
                      transform: `translate(${tx}, ${ty})`,
                      onClick: () =>
                        setActiveId(
                          activeId === topic.id ? null : topic.id
                        )
                    },
                    React.createElement('circle', {
                      cx: 0,
                      cy: 0,
                      r: topicRadius,
                      fill: 'rgba(255,255,255,0.08)',
                      stroke: 'rgba(255,255,255,0.3)',
                      strokeWidth: 2,
                      className: 'map-circle-glass'
                    }),
                    React.createElement(
                      'foreignObject',
                      {
                        x: -topicRadius + 4,
                        y: -25,
                        width: topicRadius * 2 - 8,
                        height: 50,
                        className: 'map-topic-label'
                      },
                      React.createElement(
                        'div',
                        {
                          className: 'map-topic-text',
                          style: { fontSize: `${topicFontSize}px` }
                        },
                        topicText
                      )
                    )
                  ),

                  // Keyword 节点：同样用 transform 来做平滑移动
                  keywordNodes.map((pos, idx) => {
                    const keywordText = clampText(pos.keyword)
                    const keywordFontSize = getDynamicFontSize(
                      keywordText,
                      13,
                      10
                    )

                    return React.createElement(
                      'g',
                      {
                        key: `keyword-${topic.id}-${idx}`,
                        className: 'map-keyword',
                        transform: `translate(${pos.x}, ${pos.y})`
                      },
                      React.createElement('circle', {
                        cx: 0,
                        cy: 0,
                        r: keywordRadius,
                        fill: 'rgba(255,255,255,0.06)',
                        stroke: 'rgba(255,255,255,0.25)',
                        strokeWidth: 1,
                        className: 'map-circle-glass'
                      }),
                      React.createElement(
                        'foreignObject',
                        {
                          x: -keywordRadius + 2,
                          y: -18,
                          width: keywordRadius * 2 - 4,
                          height: 36,
                          className: 'map-keyword-label'
                        },
                        React.createElement(
                          'div',
                          {
                            className: 'map-keyword-text',
                            style: { fontSize: `${keywordFontSize}px` }
                          },
                          keywordText
                        )
                      )
                    )
                  })
                )
              })
            )
          )
        )
      )
    )
  }


  

  const renderViewContent = () => {
    if (viewMode === 'lanes') return renderLanesView()
    if (viewMode === 'stacks') return renderStacksView()
    if (viewMode === 'map') return renderMapView()
    return renderRippleView()
  }

  // Left sidebar with New Canvas (+) and History buttons
  const renderLeftSidebar = () => (
    React.createElement('div', {className: 'left-sidebar'},
      React.createElement('button', {
        className: 'sidebar-btn new-canvas-btn',
        onClick: createNewCanvas,
        disabled: recording,
        title: 'New Canvas'
      },
        React.createElement('span', {className: 'sidebar-icon'},
          React.createElement(IconPlus, {className: 'icon'})
        ),
        React.createElement('span', {className: 'sidebar-label'}, 'New')
      ),
      React.createElement('button', {
        className: `sidebar-btn history-btn ${historyOpen ? 'active' : ''}`,
        onClick: toggleHistory,
        title: 'History'
      },
        React.createElement('span', {className: 'sidebar-icon'},
          React.createElement(IconHistory, {className: 'icon'})
        ),
        React.createElement('span', {className: 'sidebar-label'}, 'History')
      )
    )
  )
  
  // History panel
  const renderHistoryPanel = () => (
    historyOpen && React.createElement('div', {className: 'history-panel'},
      React.createElement('div', {className: 'history-header'},
        React.createElement('h3', null, 'Canvas History'),
        React.createElement('button', {
          className: 'history-close-btn',
          onClick: () => setHistoryOpen(false)
        }, React.createElement(IconClose, {className: 'icon'}))
      ),
      React.createElement('div', {className: 'history-list'},
        loadingHistory 
          ? React.createElement('p', {className: 'history-loading'}, 'Loading...')
          : historyList.length === 0
            ? React.createElement('p', {className: 'history-empty'}, 'No saved canvases yet')
            : historyList.map(canvas => 
                React.createElement('div', {
                  key: canvas.id,
                  className: 'history-item',
                  onClick: () => loadCanvas(canvas.id)
                },
                  React.createElement('div', {className: 'history-item-title'}, canvas.title),
                  React.createElement('div', {className: 'history-item-summary'}, canvas.summary),
                  React.createElement('div', {className: 'history-item-meta'},
                    `${canvas.topic_count} topics • ${new Date(canvas.created_at).toLocaleDateString()}`
                  )
                )
              )
      )
    )
  )

  // View switcher (now on right side)
  const renderViewSwitcher = () => (
    React.createElement('div', {className: 'view-switcher'},
      VIEW_OPTIONS.map(option => {
        const Icon = option.icon
        const isActive = viewMode === option.id
        return React.createElement('button', {
          key: option.id,
          className: `view-switcher-btn ${isActive ? 'active' : ''}`,
          onClick: () => setViewMode(option.id)
        },
          React.createElement('span', {className: 'view-switcher-icon'},
            React.createElement(Icon, {className: 'icon'})
          ),
          React.createElement('span', {className: 'view-switcher-label'}, option.name)
        )
      })
    )
  )

  const renderRecordingControl = () => (
    React.createElement('div', {className: 'recording-control'},
      React.createElement('button', {
        className: `recording-button ${recording ? 'active' : ''}`,
        onClick: recording ? stop : start,
        disabled: demoRunning,
        title: recording ? 'Tap to stop recording' : 'Tap to start recording'
      },
        // White pulsing rings when recording
        recording && React.createElement('span', {className: 'recording-ring ring-1'}),
        recording && React.createElement('span', {className: 'recording-ring ring-2'}),
        recording && React.createElement('span', {className: 'recording-ring ring-3'}),
        React.createElement('span', {className: 'recording-icon-wrapper'},
          React.createElement(IconMic, {className: 'recording-icon'})
        )
      ),
      React.createElement('p', {className: 'recording-hint'},
        recording ? 'Listening...' : 'Tap to start brainstorming'
      )
    )
  )

  const renderGradientBlobs = () =>
    Array.from({ length: GRADIENT_BLOB_COUNT }).map((_, index) =>
      React.createElement('div', {
        key: `gradient-blob-${index}`,
        className: 'dynamic-gradient-blob',
        ref: el => { gradientBlobRefs.current[index] = el }
      })
    )

  return (
    React.createElement('div', {className: `app-shell view-${viewMode}`},
      React.createElement('div', {className: 'dynamic-gradient-layer', ref: gradientLayerRef},
        React.createElement('div', {className: 'dynamic-gradient-base', ref: gradientBaseRef}),
        React.createElement('div', {className: 'dynamic-gradient-overlay', ref: gradientOverlayRef}),
        renderGradientBlobs()
      ),
      React.createElement('div', {className: 'app-pattern'}),
      React.createElement('div', {className: 'effect-layer'},
        ambientWaves.map(wave =>
          React.createElement('div', {
            key: wave.id,
            className: 'ambient-wave',
            style: { left: `${wave.x}px`, top: `${wave.y}px` }
          })
        ),
        viewMode === 'ripple' && waveEffects.map(wave =>
          React.createElement('div', {
            key: wave.id,
            className: 'topic-wave-group',
            style: { left: `${wave.x}px`, top: `${wave.y}px` }
          },
            React.createElement('div', {className: 'topic-wave ring-1'}),
            React.createElement('div', {className: 'topic-wave ring-2'}),
            React.createElement('div', {className: 'topic-wave ring-3'}),
            React.createElement('div', {className: 'topic-wave inner-glow'})
          )
        ),
        viewMode === 'ripple' && dropEffects.map(drop =>
          React.createElement('div', {key: drop.id, className: 'drop-wrapper'},
            React.createElement('div', {
              className: 'water-drop',
              style: { left: `${drop.x}px`, top: `${drop.y}px` }
            }),
            React.createElement('div', {
              className: 'impact-splash',
              style: { left: `${drop.x}px`, top: `${drop.y}px` }
            })
          )
        )
      ),
      renderLeftSidebar(),
      renderViewSwitcher(),
      renderHistoryPanel(),
      React.createElement('div', {className: 'app-content'},
        React.createElement('div', {className: 'header enhanced'},
          React.createElement('div', {className: 'brand-cluster'},
            React.createElement('h2', null, 'Ripple')
          ),
          isDemoPage && React.createElement('div', {className: 'header-actions'},
            React.createElement('button', {
              className: 'header-link',
              onClick: resetDemoData,
              disabled: demoRunning || recording
            }, 'Reset demo'),
            React.createElement('button', {
              className: 'header-link demo',
              onClick: runDemo,
              disabled: demoRunning || recording
            }, demoRunning ? 'Demo running...' : 'Demo mode')
          )
        ),
        React.createElement('div', {className: 'view-container'}, renderViewContent()),
        renderRecordingControl()
      ),
      active && React.createElement('div', {className: 'detail-layer open'},
        React.createElement('div', {
          className: 'detail-overlay',
          onClick: () => setActiveId(null)
        }),
        React.createElement('div', {
          className: `detail-panel ${activeId ? 'open' : ''}`,
          onClick: (e) => e.stopPropagation()
        },
          React.createElement('div', {className: 'detail-header'},
            React.createElement('div', {className: 'detail-title'}, active.label),
            React.createElement('button', {
              className: 'close-btn',
              onClick: () => setActiveId(null)
            }, '✕')
          ),
          active.summary && React.createElement('div', {className: 'detail-summary'}, active.summary),
          React.createElement('div', {className: 'detail-points'},
            (active.points || []).map((p, i) =>
              React.createElement('div', {className: 'detail-point', key: i}, p.text)
            )
          )
        )
      ),
      // Transcript text logged to console only, not shown in UI
      liveText && console.log('[transcript]', liveText) && null
    )
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App))