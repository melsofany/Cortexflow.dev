import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Send, Bot, User, Brain, Info, CheckCircle2,
  Loader2, RefreshCw, History, Monitor,
  Terminal, AlertTriangle, X, Check, Globe,
  Eye, Zap, Play, Layers, Clock, Activity,
  ArrowLeft, ArrowRight, RotateCcw, Keyboard
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Message {
  id: string;
  type: 'user' | 'agent' | 'thinking' | 'system';
  text: string;
  timestamp: Date;
  status?: 'pending'|'running'|'completed'|'failed'|'info'|'warning'|'awaiting_user';
  level?: 'info'|'error'|'warning'|'success';
  step?: string;
  data?: any;
}
interface Task { taskId: string; description: string; status: string; createdAt: string; }
type ActiveTab = 'chat' | 'browser';

// ─── Step meta ────────────────────────────────────────────────────────────────
const STEP_META: Record<string, { icon: any; color: string; label: string }> = {
  OBSERVE:  { icon: Eye,          color: 'text-blue-400',    label: 'مراقبة'  },
  THINK:    { icon: Brain,        color: 'text-violet-400',  label: 'تفكير'   },
  PLAN:     { icon: Layers,       color: 'text-indigo-400',  label: 'تخطيط'   },
  ACT:      { icon: Zap,          color: 'text-amber-400',   label: 'تنفيذ'   },
  VERIFY:   { icon: CheckCircle2, color: 'text-emerald-400', label: 'تحقق'    },
  MEMORY:   { icon: Clock,        color: 'text-pink-400',    label: 'ذاكرة'   },
  PLANNING: { icon: Activity,     color: 'text-cyan-400',    label: 'وضع خطة' },
};
const STEP_ORDER = ['OBSERVE','THINK','PLAN','ACT','VERIFY'];
const uid = () => Math.random().toString(36).slice(2, 11);

// ─── StepBadge (stable) ──────────────────────────────────────────────────────
const StepBadge = memo(({ step }: { step?: string }) => {
  if (!step || !STEP_META[step]) return null;
  const { icon: Icon, color, label } = STEP_META[step];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${color} mb-1`}>
      <Icon size={10} /> {label}
    </span>
  );
});

// ─── MessageItem (stable, never re-mounts) ───────────────────────────────────
const MessageItem = memo(({ msg, tasks, onResume }: {
  msg: Message;
  tasks: Task[];
  onResume: (id: string) => void;
}) => {
  if (msg.type === 'system') {
    const c: Record<string, string> = {
      error:   'bg-red-500/10 border-red-500/20 text-red-400',
      warning: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400',
      success: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
      info:    'bg-slate-800/40 border-slate-700/30 text-slate-500',
    };
    return (
      <div className="flex justify-center my-2 px-4">
        <div className={`px-3 py-1 rounded-full text-[11px] flex items-center gap-1.5 border ${c[msg.level||'info']}`}>
          {msg.level === 'success' ? <Check size={11}/> : <Info size={11}/>}
          {msg.text}
        </div>
      </div>
    );
  }

  const isUser     = msg.type === 'user';
  const isThinking = msg.type === 'thinking';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4 px-4`}
    >
      {!isUser && (
        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mr-3 mt-0.5 ${
          isThinking ? 'bg-violet-500/20 border border-violet-500/30' : 'bg-indigo-500/20 border border-indigo-500/30'
        }`}>
          {isThinking ? <Brain size={15} className="text-violet-400"/> : <Bot size={15} className="text-indigo-400"/>}
        </div>
      )}

      <div className={`flex flex-col max-w-[82%] ${isUser ? 'items-end' : 'items-start'}`}>
        {isThinking && <StepBadge step={msg.step}/>}
        <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
          isUser      ? 'bg-indigo-600 text-white rounded-tr-none'
          : isThinking? 'bg-[#1a1a24] border border-slate-700/50 text-slate-400 italic text-xs rounded-tl-none'
                      : 'bg-[#1c1c28] border border-slate-700/40 text-slate-200 rounded-tl-none'
        }`}>
          {isThinking && (
            <div className="flex items-center gap-1.5 mb-1.5 text-[10px] text-slate-600 font-semibold uppercase">
              <Loader2 size={9} className="animate-spin"/> يفكر الوكيل...
            </div>
          )}
          <div className="whitespace-pre-wrap">{msg.text}</div>
          {msg.status === 'running' && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-indigo-400">
              <Loader2 size={11} className="animate-spin"/> جارٍ التنفيذ...
            </div>
          )}
          {msg.status === 'awaiting_user' && (
            <button
              onClick={() => { const t = tasks[tasks.length-1]; if(t) onResume(t.taskId); }}
              className="mt-3 px-4 py-2 bg-orange-600/80 hover:bg-orange-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-all"
            >
              <Play size={12}/> استئناف المهمة
            </button>
          )}
        </div>
        <span className="text-[10px] text-slate-600 mt-1 px-1">
          {new Date(msg.timestamp).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})}
        </span>
      </div>

      {isUser && (
        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0 ml-3 mt-0.5">
          <User size={15} className="text-slate-300"/>
        </div>
      )}
    </motion.div>
  );
});

// ─── ChatPanel (stable component outside App) ─────────────────────────────────
interface ChatPanelProps {
  messages: Message[];
  tasks: Task[];
  isConnected: boolean;
  isAgentBusy: boolean;
  currentStep: string | null;
  inputValue: string;
  setInputValue: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onResume: (id: string) => void;
}
const ChatPanel = memo(({
  messages, tasks, isConnected, isAgentBusy, currentStep,
  inputValue, setInputValue, onSubmit, onStop, onResume
}: ChatPanelProps) => {
  const endRef  = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isAgentBusy && !inputValue.trim()) onStop();
      else onSubmit();
    }
  }, [onSubmit, onStop, isAgentBusy, inputValue]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
  }, [setInputValue]);

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4" style={{ overscrollBehavior: 'contain' }}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-6 py-16 text-center">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-600/30 to-violet-600/30 border border-indigo-500/20 flex items-center justify-center mb-6">
              <Bot size={36} className="text-indigo-400"/>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">كيف يمكنني مساعدتك؟</h2>
            <p className="text-slate-500 text-sm max-w-xs leading-relaxed mb-10">
              يمكنني تصفح الإنترنت، إنشاء الحسابات، والبحث عن المعلومات تلقائياً
            </p>
            <div className="grid grid-cols-1 gap-3 w-full max-w-sm">
              {[
                'ابحث عن آخر أخبار الذكاء الاصطناعي',
                'افتح موقع الجزيرة وأظهر آخر الأخبار',
                'ابحث عن أفضل مطاعم في الرياض',
                'اذهب إلى يوتيوب وشغّل أغنية هادئة',
              ].map((s, i) => (
                <button key={i} onClick={() => setInputValue(s)}
                  className="p-4 bg-slate-800/40 border border-slate-700/40 rounded-2xl text-right text-sm text-slate-400 hover:text-slate-200 hover:border-indigo-500/30 hover:bg-slate-800/70 transition-all active:scale-95 touch-manipulation">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map(m => <MessageItem key={m.id} msg={m} tasks={tasks} onResume={onResume}/>)}
            <div ref={endRef}/>
          </>
        )}
      </div>

      {/* Input area */}
      <div className="p-4 border-t border-slate-800/50 bg-[#0d0d15] flex-shrink-0">
        {/* Step progress bar */}
        {isAgentBusy && currentStep && STEP_META[currentStep] && (
          <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-slate-800/50 rounded-xl border border-slate-700/30">
            {React.createElement(STEP_META[currentStep].icon, { size: 14, className: STEP_META[currentStep].color })}
            <span className={`text-xs font-semibold ${STEP_META[currentStep].color}`}>{STEP_META[currentStep].label}</span>
            <div className="flex gap-1 ml-auto">
              {STEP_ORDER.map(s => (
                <div key={s} className={`h-1.5 w-6 rounded-full transition-all ${
                  s === currentStep ? 'bg-indigo-500'
                  : STEP_ORDER.indexOf(s) < STEP_ORDER.indexOf(currentStep) ? 'bg-indigo-800'
                  : 'bg-slate-700'
                }`}/>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-end gap-3">
          <textarea
            ref={textRef}
            value={inputValue}
            onChange={handleChange}
            onKeyDown={handleKey}
            placeholder={isAgentBusy ? 'أرسل مهمة جديدة أو اضغط إيقاف...' : 'أرسل مهمة للوكيل...'}
            rows={1}
            className="flex-1 bg-slate-800/60 border border-slate-700/50 rounded-2xl px-4 py-3 text-slate-200 placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/40 resize-none min-h-[48px] max-h-[120px] text-sm transition-all"
            style={{ direction: 'rtl' }}
          />
          {/* Stop button — shown when agent is busy AND input is empty */}
          {isAgentBusy && !inputValue.trim() ? (
            <button
              onClick={onStop}
              className="w-12 h-12 bg-red-600 hover:bg-red-500 text-white rounded-2xl flex items-center justify-center flex-shrink-0 transition-all shadow-lg shadow-red-500/20 active:scale-95 touch-manipulation"
              title="إيقاف المهمة"
            >
              <X size={18}/>
            </button>
          ) : (
            <button
              onClick={onSubmit}
              disabled={!inputValue.trim() || !isConnected}
              className="w-12 h-12 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-2xl flex items-center justify-center flex-shrink-0 transition-all shadow-lg shadow-indigo-500/20 active:scale-95 touch-manipulation"
              title={isAgentBusy ? 'أضف إلى قائمة الانتظار' : 'إرسال'}
            >
              {isAgentBusy ? <Loader2 size={18} className="animate-spin"/> : <Send size={18}/>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

// ─── BrowserPanel (stable component outside App) ──────────────────────────────
interface BrowserPanelProps {
  browserImgRef: React.RefObject<HTMLImageElement | null>;
  browserHasFrame: boolean;
  isAgentBusy: boolean;
  onEmit: (type: string, params: any) => void;
}
const BrowserPanel = memo(({ browserImgRef, browserHasFrame, isAgentBusy, onEmit }: BrowserPanelProps) => {
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [keyboardText, setKeyboardText] = useState('');
  const [urlBarValue, setUrlBarValue]   = useState('');

  // Touch state
  const touchStartRef  = useRef<{ x: number; y: number; time: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef     = useRef<{ x: number; y: number; time: number } | null>(null);

  const getBrowserCoords = useCallback((clientX: number, clientY: number) => {
    const img = browserImgRef.current;
    if (!img) return { x: 0, y: 0 };
    const r = img.getBoundingClientRect();
    return {
      x: Math.round(((clientX - r.left) / r.width)  * 1280),
      y: Math.round(((clientY - r.top)  / r.height) * 720),
    };
  }, [browserImgRef]);

  // ── Touch handlers ────────────────────────────────────────────────────────
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };

    // Long-press → right click (500ms)
    longPressTimer.current = setTimeout(() => {
      const coords = getBrowserCoords(t.clientX, t.clientY);
      onEmit('contextmenu', { ...coords, button: 'right' });
      touchStartRef.current = null; // prevent tap fire
    }, 500);
  }, [getBrowserCoords, onEmit]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1 && touchStartRef.current) {
      const t = e.touches[0];
      const dy = touchStartRef.current.y - t.clientY;
      const dx = touchStartRef.current.x - t.clientX;
      if (Math.abs(dy) > 4 || Math.abs(dx) > 4) {
        // Cancel long-press if moved
        if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
        onEmit('scroll', { deltaX: dx * 1.5, deltaY: dy * 1.5 });
        touchStartRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
      }
    }
  }, [onEmit]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    if (!touchStartRef.current) return;

    const touch = e.changedTouches[0];
    const start = touchStartRef.current;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const dt = Date.now() - start.time;
    touchStartRef.current = null;

    if (dist > 10 || dt > 500) return; // moved or long press

    const coords = getBrowserCoords(touch.clientX, touch.clientY);

    // Double-tap detection (within 300ms of last tap in same area)
    const now = Date.now();
    if (lastTapRef.current) {
      const lt = lastTapRef.current;
      const tapDist = Math.sqrt((touch.clientX - lt.x)**2 + (touch.clientY - lt.y)**2);
      if (now - lt.time < 300 && tapDist < 30) {
        onEmit('dblclick', coords);
        lastTapRef.current = null;
        return;
      }
    }
    lastTapRef.current = { x: touch.clientX, y: touch.clientY, time: now };

    // Single tap → click
    onEmit('click', { ...coords, button: 'left' });
  }, [getBrowserCoords, onEmit]);

  // ── Mouse handlers ────────────────────────────────────────────────────────
  const handleMouseEvent = useCallback((e: React.MouseEvent) => {
    const coords = getBrowserCoords(e.clientX, e.clientY);
    onEmit(e.type, { ...coords, button: e.button === 2 ? 'right' : 'left' });
  }, [getBrowserCoords, onEmit]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    onEmit('scroll', { deltaX: e.deltaX, deltaY: e.deltaY });
  }, [onEmit]);

  const handleKeyboard = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    onEmit(e.type, { key: e.key });
  }, [onEmit]);

  const sendKeyboardText = useCallback(() => {
    if (!keyboardText.trim()) return;
    onEmit('type_text', { text: keyboardText });
    setKeyboardText('');
    setShowKeyboard(false);
  }, [keyboardText, onEmit]);

  const navigate = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    let url = urlBarValue.trim();
    if (!url) return;
    if (!url.startsWith('http')) url = 'https://' + url;
    onEmit('navigate', { url });
  }, [urlBarValue, onEmit]);

  return (
    <div className="flex flex-col h-full bg-[#0e0e16]">
      {/* Browser chrome */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#12121c] border-b border-slate-800/60 flex-shrink-0">
        <button onClick={() => onEmit('go_back',{})}
          className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 active:bg-slate-700 transition-all touch-manipulation min-w-[36px]">
          <ArrowLeft size={16}/>
        </button>
        <button onClick={() => onEmit('go_forward',{})}
          className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 active:bg-slate-700 transition-all touch-manipulation min-w-[36px]">
          <ArrowRight size={16}/>
        </button>
        <button onClick={() => onEmit('reload',{})}
          className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 active:bg-slate-700 transition-all touch-manipulation min-w-[36px]">
          <RotateCcw size={15}/>
        </button>

        <form onSubmit={navigate} className="flex-1 flex items-center gap-2 bg-slate-900/60 border border-slate-700/40 rounded-xl px-3 py-1.5">
          <Globe size={13} className="text-slate-500 flex-shrink-0"/>
          <input
            value={urlBarValue}
            onChange={e => setUrlBarValue(e.target.value)}
            placeholder="أدخل الرابط..."
            className="bg-transparent outline-none text-xs text-slate-300 w-full placeholder-slate-600"
          />
        </form>

        <button
          onClick={() => setShowKeyboard(v => !v)}
          className={`p-2 rounded-lg transition-all touch-manipulation min-w-[36px] ${showKeyboard ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-white hover:bg-slate-800'}`}
        >
          <Keyboard size={16}/>
        </button>
      </div>

      {/* Touch keyboard panel */}
      <AnimatePresence>
        {showKeyboard && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="border-b border-slate-800/60 bg-[#12121c] overflow-hidden flex-shrink-0"
          >
            <div className="p-3 flex gap-2">
              <input
                autoFocus
                value={keyboardText}
                onChange={e => setKeyboardText(e.target.value)}
                onKeyDown={e => { if(e.key === 'Enter') sendKeyboardText(); }}
                placeholder="اكتب نصاً لإرساله للمتصفح..."
                className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500"
              />
              <button onClick={sendKeyboardText}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium transition-all touch-manipulation">
                إرسال
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Live browser stream */}
      <div
        className="flex-1 relative bg-black select-none overflow-hidden cursor-crosshair"
        style={{ touchAction: 'none' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={handleWheel}
        onKeyDown={handleKeyboard}
        onKeyUp={handleKeyboard}
        onMouseDown={handleMouseEvent}
        onMouseUp={handleMouseEvent}
        onDoubleClick={handleMouseEvent}
        onContextMenu={e => { e.preventDefault(); handleMouseEvent(e); }}
        tabIndex={0}
      >
        {!browserHasFrame && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600 gap-4 z-10">
            {isAgentBusy ? (
              <>
                <div className="w-14 h-14 rounded-full border-2 border-slate-800 border-t-indigo-500 animate-spin"/>
                <p className="text-sm font-medium text-slate-500">جاري تهيئة المتصفح...</p>
              </>
            ) : (
              <>
                <Monitor size={40} className="text-slate-700"/>
                <p className="text-sm text-slate-600">أرسل مهمة لبدء تشغيل المتصفح</p>
              </>
            )}
          </div>
        )}

        {/* img always in DOM for direct .src updates */}
        <img
          ref={browserImgRef}
          alt="Browser View"
          draggable={false}
          className="w-full h-full object-contain pointer-events-none"
          style={{ display: browserHasFrame ? 'block' : 'none' }}
        />

        {/* Agent busy overlay */}
        {isAgentBusy && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-black/70 backdrop-blur-md border border-white/10 rounded-full flex items-center gap-2 text-xs text-indigo-300 font-medium pointer-events-none z-20">
            <Loader2 size={12} className="animate-spin"/> الوكيل يتحكم في المتصفح
          </div>
        )}

        {/* Hint */}
        {browserHasFrame && (
          <div className="absolute bottom-3 right-3 px-3 py-1 bg-black/50 backdrop-blur-sm border border-white/10 rounded-full text-[10px] text-slate-500 flex items-center gap-1.5 pointer-events-none z-10">
            <Terminal size={10}/> نقر • سحب • ضغط طويل
          </div>
        )}
      </div>
    </div>
  );
});

// ─── App ──────────────────────────────────────────────────────────────────────
const App: React.FC = () => {
  const [messages, setMessages]           = useState<Message[]>([]);
  const [inputValue, setInputValue]       = useState('');
  const [isConnected, setIsConnected]     = useState(false);
  const [tasks, setTasks]                 = useState<Task[]>([]);
  const [browserHasFrame, setBrowserHasFrame] = useState(false);
  const [currentStep, setCurrentStep]     = useState<string | null>(null);
  const [activeTab, setActiveTab]         = useState<ActiveTab>('chat');
  const [sidebarOpen, setSidebarOpen]     = useState(false);
  const [isAgentBusy, setIsAgentBusy]     = useState(false);

  const socketRef     = useRef<Socket | null>(null);
  const browserImgRef = useRef<HTMLImageElement>(null);

  // Stable emit callback — never changes reference
  const emitBrowser = useCallback((type: string, params: any) => {
    socketRef.current?.emit('browserEvent', { type, pageId: 'default', params });
  }, []);

  const handleResume = useCallback((taskId: string) => {
    socketRef.current?.emit('resumeTask', taskId);
  }, []);

  // ── Message helpers ─────────────────────────────────────────────────────
  const addSystem  = useCallback((text: string, level: Message['level'] = 'info') =>
    setMessages(p => [...p, { id: uid(), type: 'system', text, timestamp: new Date(), level }]), []);

  const addAgent   = useCallback((text: string, status: Message['status'] = 'completed', data?: any) =>
    setMessages(p => {
      const last = p[p.length-1];
      if (last?.type==='agent' && last.text===text && last.status===status) return p;
      return [...p, { id: uid(), type: 'agent', text, timestamp: new Date(), status, data }];
    }), []);

  const addThinking = useCallback((text: string, step?: string) =>
    setMessages(p => {
      const last = p[p.length-1];
      if (last?.type==='thinking' && last.step===step)
        return [...p.slice(0,-1), { ...last, text: last.text+'\n'+text }];
      return [...p, { id: uid(), type: 'thinking', text, timestamp: new Date(), step }];
    }), []);

  // ── Auto-classify task type from description ────────────────────────────
  const autoClassifyType = useCallback((text: string): string => {
    const t = text.toLowerCase();
    const browserKw = ['افتح','تصفح','انتقل','موقع','اذهب','سجل','تسجيل','facebook','twitter','instagram','youtube','google','يوتيوب','ويب','web','url','http','احجز','اشتر'];
    const codeKw    = ['اكتب كود','برمجة','كود','script','python','javascript','برنامج','function','api','class','debug','typescript','sql','ابرمج'];
    const researchKw= ['ابحث','اشرح','ما هو','ما هي','كيف','لماذا','معلومات','تحليل','قارن','تقرير','ملخص','explain','research','analyze'];

    if (browserKw.some(k => t.includes(k))) return 'browser';
    if (codeKw.some(k => t.includes(k)))    return 'system';
    if (researchKw.some(k => t.includes(k))) return 'research';
    return 'ai';
  }, []);

  // ── Submit ──────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(() => {
    const text = inputValue.trim();
    if (!text || !socketRef.current || !isConnected) return;
    setMessages(p => [...p, { id: uid(), type: 'user', text, timestamp: new Date() }]);
    const taskType = autoClassifyType(text);
    socketRef.current.emit('submitTask', { description: text, type: taskType, priority: 'normal' });
    setInputValue('');
  }, [inputValue, isConnected, autoClassifyType]);

  // ── Socket.io ───────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io({ path: '/api/socket' });
    socketRef.current = socket;

    socket.on('connect', () => { setIsConnected(true); addSystem('متصل بالخادم بنجاح', 'success'); socket.emit('getStatus'); });
    socket.on('disconnect', () => { setIsConnected(false); addSystem('انقطع الاتصال', 'error'); });
    socket.on('status', (d: { tasks: Task[] }) => setTasks(d.tasks || []));

    socket.on('taskUpdate', (d: any) => {
      socket.emit('getStatus');
      if (d.type === 'status_change') {
        if      (d.status === 'completed')     { addAgent('اكتملت المهمة بنجاح', 'completed'); setIsAgentBusy(false); }
        else if (d.status === 'failed')        { addAgent(`فشلت المهمة: ${d.error}`, 'failed'); setIsAgentBusy(false); }
        else if (d.status === 'awaiting_user') { addAgent('الوكيل ينتظر تدخلك', 'awaiting_user'); }
      }
    });

    socket.on('taskStart', (d: any) => {
      addSystem(`بدأت المهمة: ${d.description}`, 'info');
      setIsAgentBusy(true);
      setActiveTab('browser');
    });
    socket.on('taskSuccess', () => setIsAgentBusy(false));
    socket.on('taskFail',    () => setIsAgentBusy(false));

    socket.on('thinking', (d: { content: string }) => {
      const match = d.content.match(/^\[(\w+)\]/);
      if (match) setCurrentStep(match[1]);
      addThinking(d.content, match?.[1]);
    });

    socket.on('browserStream', (d: { image: string }) => {
      if (d.image && browserImgRef.current) {
        browserImgRef.current.src = `data:image/jpeg;base64,${d.image}`;
        setBrowserHasFrame(prev => prev || true);
      }
    });

    socket.on('log', (log: { level: string; message: string }) => {
      if (log.level === 'error') addSystem(log.message, 'error');
    });

    return () => { socket.disconnect(); };
  }, [addSystem, addAgent, addThinking]);

  // ── Sidebar ─────────────────────────────────────────────────────────────
  const Sidebar = (
    <AnimatePresence>
      {sidebarOpen && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-40" onClick={() => setSidebarOpen(false)}/>
          <motion.aside
            initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
            className="fixed left-0 top-0 bottom-0 w-72 bg-[#0e0e18] border-r border-slate-800/60 flex flex-col z-50"
          >
            <div className="flex items-center justify-between p-5 border-b border-slate-800/50">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
                  <Bot size={20} className="text-white"/>
                </div>
                <div>
                  <h1 className="font-bold text-white text-base leading-none">CortexFlow</h1>
                  <p className="text-[11px] text-slate-500 mt-0.5">وكيل تصفح ذكي</p>
                </div>
              </div>
              <button onClick={() => setSidebarOpen(false)} className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-xl transition-all touch-manipulation">
                <X size={18}/>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <p className="text-[11px] uppercase tracking-widest font-bold text-slate-600 px-2 mb-3 flex items-center gap-2">
                <History size={12}/> المهام الأخيرة
              </p>
              {tasks.length === 0 ? (
                <p className="text-center py-10 text-slate-600 text-xs italic">لا توجد مهام بعد</p>
              ) : tasks.map(t => (
                <button key={t.taskId}
                  className="w-full text-right p-3 rounded-xl hover:bg-slate-800/60 transition-all flex items-center gap-3 border border-transparent hover:border-slate-700/40 touch-manipulation">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${t.status==='completed'?'bg-emerald-500':t.status==='failed'?'bg-red-500':'bg-indigo-500 animate-pulse'}`}/>
                  <span className="truncate text-sm text-slate-400">{t.description}</span>
                </button>
              ))}
            </div>

            <div className="p-4 border-t border-slate-800/50">
              <div className="flex items-center gap-2 px-2 mb-4">
                <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 'bg-red-500'}`}/>
                <span className="text-xs text-slate-500">{isConnected ? 'متصل' : 'غير متصل'}</span>
              </div>
              <button onClick={() => setMessages([])}
                className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 border border-slate-700/40 touch-manipulation">
                <RefreshCw size={14}/> مسح المحادثة
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );

  return (
    <div className="flex h-screen bg-[#0b0b12] text-slate-200 font-sans overflow-hidden select-none">
      {Sidebar}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 bg-[#0d0d15]/90 backdrop-blur-md border-b border-slate-800/50 flex items-center px-4 gap-3 flex-shrink-0 z-30">
          <button onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all touch-manipulation">
            ☰
          </button>
          <div className="flex items-center gap-2 flex-1">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center">
              <Bot size={15} className="text-white"/>
            </div>
            <span className="font-bold text-white text-sm">CortexFlow</span>
            {isAgentBusy && currentStep && STEP_META[currentStep] && (
              <span className="flex items-center gap-1 px-2.5 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-full text-[11px] text-indigo-400 font-medium">
                <Loader2 size={10} className="animate-spin"/>
                {STEP_META[currentStep].label}
              </span>
            )}
          </div>
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500'}`}/>
        </header>

        {/* Content */}
        <div className="flex-1 flex min-h-0">
          {/* Desktop: split */}
          <div className="hidden lg:flex flex-1 min-h-0">
            <div className="w-[42%] border-r border-slate-800/50 flex flex-col min-h-0">
              <ChatPanel
                messages={messages} tasks={tasks} isConnected={isConnected}
                isAgentBusy={isAgentBusy} currentStep={currentStep}
                inputValue={inputValue} setInputValue={setInputValue}
                onSubmit={handleSubmit} onResume={handleResume}
              />
            </div>
            <div className="flex-1 flex flex-col min-h-0">
              <BrowserPanel
                browserImgRef={browserImgRef} browserHasFrame={browserHasFrame}
                isAgentBusy={isAgentBusy} onEmit={emitBrowser}
              />
            </div>
          </div>

          {/* Mobile/Tablet: tabs */}
          <div className="flex lg:hidden flex-col flex-1 min-h-0">
            <div className="flex-1 min-h-0">
              {activeTab === 'chat'
                ? <ChatPanel
                    messages={messages} tasks={tasks} isConnected={isConnected}
                    isAgentBusy={isAgentBusy} currentStep={currentStep}
                    inputValue={inputValue} setInputValue={setInputValue}
                    onSubmit={handleSubmit} onResume={handleResume}
                  />
                : <BrowserPanel
                    browserImgRef={browserImgRef} browserHasFrame={browserHasFrame}
                    isAgentBusy={isAgentBusy} onEmit={emitBrowser}
                  />
              }
            </div>
            <div className="flex border-t border-slate-800/50 bg-[#0d0d15] flex-shrink-0">
              {([['chat','المحادثة',Bot],['browser','المتصفح',Monitor]] as const).map(([id, label, Icon]) => (
                <button key={id} onClick={() => setActiveTab(id as ActiveTab)}
                  className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-all touch-manipulation relative ${
                    activeTab === id ? 'text-indigo-400 border-t-2 border-indigo-500' : 'text-slate-500 border-t-2 border-transparent'
                  }`}>
                  <Icon size={20}/>
                  <span className="text-[11px] font-medium">{label}</span>
                  {id==='browser' && isAgentBusy && (
                    <div className="absolute top-2 right-1/3 w-2 h-2 rounded-full bg-indigo-500 animate-pulse"/>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
