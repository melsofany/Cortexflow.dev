import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Send, Bot, User, Brain, Info, CheckCircle2,
  Loader2, RefreshCw, History, Monitor,
  Terminal, AlertTriangle, X, Check, Globe,
  Eye, Zap, Play, Layers, Clock, Activity,
  ArrowLeft, ArrowRight, RotateCcw, Keyboard,
  Search, Code2, ListChecks, ChevronRight, Sparkles,
  Network, BookOpen, FlaskConical, LayoutDashboard
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

interface PlanStep {
  id: number;
  title: string;
  description: string;
  agent: 'browser' | 'coder' | 'researcher' | 'reviewer' | 'general' | 'planner';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: string;
}

interface TaskPlan {
  goal: string;
  steps: PlanStep[];
  category: string;
  estimatedTime: string;
  createdAt: Date;
}

interface AgentActivity {
  agentRole: string;
  stepId: number;
  status: 'idle' | 'thinking' | 'acting' | 'done' | 'failed';
  message: string;
  timestamp: Date;
}

type ActiveTab = 'chat' | 'browser' | 'plan';
interface InputRequest { taskId: string; question: string; }

// ─── Constants ────────────────────────────────────────────────────────────────
const STEP_META: Record<string, { icon: any; color: string; label: string }> = {
  OBSERVE:  { icon: Eye,          color: 'text-blue-400',    label: 'مراقبة'    },
  THINK:    { icon: Brain,        color: 'text-violet-400',  label: 'تفكير'     },
  PLAN:     { icon: Layers,       color: 'text-indigo-400',  label: 'تخطيط'     },
  PLANNING: { icon: Activity,     color: 'text-cyan-400',    label: 'وضع خطة'   },
  ACT:      { icon: Zap,          color: 'text-amber-400',   label: 'تنفيذ'     },
  VERIFY:   { icon: CheckCircle2, color: 'text-emerald-400', label: 'تحقق'      },
  MEMORY:   { icon: Clock,        color: 'text-pink-400',    label: 'ذاكرة'     },
  ASK:      { icon: User,         color: 'text-yellow-400',  label: 'طلب بيانات'},
  ERR:      { icon: AlertTriangle,color: 'text-red-400',     label: 'خطأ'       },
  MODEL:    { icon: Brain,        color: 'text-slate-400',   label: 'نموذج'     },
};
const STEP_ORDER = ['OBSERVE','THINK','PLAN','ACT','VERIFY'];

const AGENT_META: Record<string, { icon: any; color: string; bg: string; label: string }> = {
  planner:    { icon: Brain,          color: 'text-violet-400',  bg: 'bg-violet-500/15 border-violet-500/30',  label: 'وكيل التخطيط'  },
  browser:    { icon: Globe,          color: 'text-blue-400',    bg: 'bg-blue-500/15 border-blue-500/30',      label: 'وكيل المتصفح'  },
  coder:      { icon: Code2,          color: 'text-amber-400',   bg: 'bg-amber-500/15 border-amber-500/30',    label: 'وكيل البرمجة'  },
  researcher: { icon: Search,         color: 'text-cyan-400',    bg: 'bg-cyan-500/15 border-cyan-500/30',      label: 'وكيل البحث'    },
  reviewer:   { icon: CheckCircle2,   color: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-500/30',label: 'وكيل المراجعة' },
  general:    { icon: Zap,            color: 'text-indigo-400',  bg: 'bg-indigo-500/15 border-indigo-500/30',  label: 'الوكيل العام'  },
};

const uid = () => Math.random().toString(36).slice(2, 11);

// ─── StepBadge ────────────────────────────────────────────────────────────────
const StepBadge = memo(({ step }: { step?: string }) => {
  if (!step || !STEP_META[step]) return null;
  const { icon: Icon, color, label } = STEP_META[step];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${color} mb-1`}>
      <Icon size={10}/> {label}
    </span>
  );
});

// ─── MessageItem ──────────────────────────────────────────────────────────────
const MessageItem = memo(({ msg, tasks, onResume }: {
  msg: Message; tasks: Task[]; onResume: (id: string) => void;
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
          {msg.level==='success' ? <Check size={11}/> : <Info size={11}/>}
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

// ─── InputRequestBanner ───────────────────────────────────────────────────────
const InputRequestBanner = memo(({ req, onAnswer }: { req: InputRequest; onAnswer: (ans: string) => void }) => {
  const [val, setVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const submit = () => { if (val.trim()) { onAnswer(val.trim()); setVal(''); } };
  return (
    <div className="mb-3 p-3 bg-yellow-900/20 border border-yellow-500/40 rounded-xl">
      <div className="flex items-center gap-2 mb-2">
        <User size={14} className="text-yellow-400 flex-shrink-0"/>
        <span className="text-yellow-300 text-xs font-semibold">الوكيل يطلب بيانات</span>
      </div>
      <p className="text-yellow-100 text-sm mb-2 leading-relaxed">{req.question}</p>
      <div className="flex gap-2">
        <input
          ref={inputRef} type="text" value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          placeholder="اكتب الإجابة هنا..."
          className="flex-1 bg-slate-800/70 border border-slate-600/50 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 outline-none focus:border-yellow-500/60"
          dir="auto"
        />
        <button onClick={submit} disabled={!val.trim()}
          className="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-white text-xs font-bold transition-colors">
          إرسال
        </button>
      </div>
    </div>
  );
});

// ─── PlanPanel ────────────────────────────────────────────────────────────────
const PlanPanel = memo(({ plan, agentActivity, isAgentBusy }: {
  plan: TaskPlan | null;
  agentActivity: AgentActivity | null;
  isAgentBusy: boolean;
}) => {
  if (!plan && !isAgentBusy) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600/20 to-indigo-600/20 border border-violet-500/20 flex items-center justify-center mb-4">
          <Network size={28} className="text-violet-400"/>
        </div>
        <h3 className="text-white font-semibold mb-2">نظام الوكلاء المتعددين</h3>
        <p className="text-slate-500 text-sm leading-relaxed max-w-xs">
          عند إرسال مهمة، يقوم وكيل التخطيط بتحليلها وتوزيعها على الوكلاء المتخصصين تلقائياً
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3 w-full max-w-sm">
          {Object.entries(AGENT_META).map(([role, meta]) => (
            <div key={role} className={`p-3 rounded-xl border ${meta.bg} flex items-center gap-2`}>
              <meta.icon size={14} className={meta.color}/>
              <span className="text-xs text-slate-400">{meta.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!plan && isAgentBusy) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="w-14 h-14 rounded-full border-2 border-slate-800 border-t-violet-500 animate-spin"/>
        <p className="text-slate-400 text-sm">وكيل التخطيط يحلل المهمة...</p>
        {agentActivity && (
          <motion.div
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            className={`px-4 py-2.5 rounded-xl border flex items-center gap-2 ${AGENT_META[agentActivity.agentRole]?.bg || 'bg-slate-800 border-slate-700'}`}
          >
            {React.createElement(AGENT_META[agentActivity.agentRole]?.icon || Zap, {
              size: 14,
              className: AGENT_META[agentActivity.agentRole]?.color || 'text-slate-400',
            })}
            <span className="text-xs text-slate-300">{agentActivity.message}</span>
          </motion.div>
        )}
      </div>
    );
  }

  if (!plan) return null;

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 gap-4">
      {/* Header */}
      <div className="bg-gradient-to-br from-violet-900/20 to-indigo-900/20 border border-violet-500/20 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-7 h-7 rounded-lg bg-violet-500/20 flex items-center justify-center">
            <ListChecks size={14} className="text-violet-400"/>
          </div>
          <span className="text-violet-300 text-xs font-bold uppercase tracking-wider">خطة التنفيذ</span>
          <span className="ml-auto text-[10px] text-slate-500 flex items-center gap-1">
            <Clock size={10}/> {plan.estimatedTime}
          </span>
        </div>
        <p className="text-white text-sm font-medium leading-relaxed">{plan.goal}</p>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] px-2 py-0.5 bg-indigo-500/20 text-indigo-300 rounded-full">
            {plan.category}
          </span>
          <span className="text-[10px] text-slate-500">{plan.steps.length} خطوات</span>
        </div>
      </div>

      {/* Active agent banner */}
      <AnimatePresence>
        {agentActivity && agentActivity.status !== 'done' && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className={`p-3 rounded-xl border flex items-center gap-3 ${AGENT_META[agentActivity.agentRole]?.bg || 'bg-slate-800 border-slate-700'}`}
          >
            <div className="relative flex-shrink-0">
              {React.createElement(AGENT_META[agentActivity.agentRole]?.icon || Zap, {
                size: 16,
                className: AGENT_META[agentActivity.agentRole]?.color || 'text-slate-400',
              })}
              {agentActivity.status === 'thinking' && (
                <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-violet-500 animate-pulse"/>
              )}
              {agentActivity.status === 'acting' && (
                <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500 animate-pulse"/>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-200 truncate">{agentActivity.message}</p>
              <p className={`text-[10px] ${AGENT_META[agentActivity.agentRole]?.color || 'text-slate-400'}`}>
                {AGENT_META[agentActivity.agentRole]?.label}
                {agentActivity.status === 'thinking' ? ' — يفكر...' : agentActivity.status === 'acting' ? ' — يُنفّذ...' : ''}
              </p>
            </div>
            <Loader2 size={14} className="text-slate-500 animate-spin flex-shrink-0"/>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Steps */}
      <div className="flex flex-col gap-2">
        {plan.steps.map((step, idx) => {
          const meta = AGENT_META[step.agent] || AGENT_META.general;
          const isActive = agentActivity?.stepId === step.id && agentActivity.status !== 'done';
          const isDone = agentActivity ? agentActivity.stepId > step.id || (agentActivity.stepId === step.id && agentActivity.status === 'done') : false;

          return (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.08 }}
              className={`relative p-3.5 rounded-xl border transition-all ${
                isActive
                  ? `${meta.bg} shadow-sm`
                  : isDone
                  ? 'bg-emerald-500/5 border-emerald-500/20'
                  : 'bg-slate-900/60 border-slate-800/60'
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Step number / status icon */}
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                  isDone      ? 'bg-emerald-500/20 text-emerald-400'
                  : isActive  ? `${meta.bg} ${meta.color}`
                              : 'bg-slate-800 text-slate-500'
                }`}>
                  {isDone ? <Check size={13}/> : isActive ? <Loader2 size={13} className="animate-spin"/> : step.id}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`text-sm font-medium ${isDone ? 'text-emerald-300' : isActive ? 'text-white' : 'text-slate-400'}`}>
                      {step.title}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${meta.bg} ${meta.color} flex items-center gap-1 ml-auto flex-shrink-0`}>
                      <meta.icon size={9}/> {meta.label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">{step.description}</p>
                </div>
              </div>

              {/* Connector line */}
              {idx < plan.steps.length - 1 && (
                <div className={`absolute left-[27px] bottom-[-9px] w-0.5 h-2 ${isDone ? 'bg-emerald-500/40' : 'bg-slate-700/60'}`}/>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Memory indicator */}
      <div className="p-3 bg-pink-500/5 border border-pink-500/15 rounded-xl flex items-center gap-2">
        <Clock size={13} className="text-pink-400 flex-shrink-0"/>
        <div>
          <p className="text-xs text-slate-400">نظام الذاكرة نشط</p>
          <p className="text-[10px] text-slate-600">تحفظ السياق والنتائج عبر الخطوات</p>
        </div>
      </div>
    </div>
  );
});

// ─── ChatPanel ────────────────────────────────────────────────────────────────
interface ChatPanelProps {
  messages: Message[]; tasks: Task[]; isConnected: boolean;
  isAgentBusy: boolean; currentStep: string | null;
  inputValue: string; setInputValue: (v: string) => void;
  onSubmit: () => void; onStop: () => void; onResume: (id: string) => void;
  pendingInputRequest: InputRequest | null; onUserAnswer: (ans: string) => void;
}
const ChatPanel = memo(({
  messages, tasks, isConnected, isAgentBusy, currentStep,
  inputValue, setInputValue, onSubmit, onStop, onResume,
  pendingInputRequest, onUserAnswer,
}: ChatPanelProps) => {
  const endRef  = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

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
      <div className="flex-1 overflow-y-auto py-4" style={{ overscrollBehavior: 'contain' }}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-6 py-16 text-center">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-600/30 to-violet-600/30 border border-indigo-500/20 flex items-center justify-center mb-6">
              <Bot size={36} className="text-indigo-400"/>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">CortexFlow</h2>
            <p className="text-slate-500 text-sm max-w-xs leading-relaxed mb-2">
              وكيل ذكاء اصطناعي متكامل بنظام وكلاء متعددين وتخطيط ذكي
            </p>
            <div className="flex items-center gap-3 mb-8 text-[11px] text-slate-600">
              <span className="flex items-center gap-1"><Brain size={10} className="text-violet-400"/> تخطيط</span>
              <span className="flex items-center gap-1"><Globe size={10} className="text-blue-400"/> تصفح</span>
              <span className="flex items-center gap-1"><Code2 size={10} className="text-amber-400"/> برمجة</span>
              <span className="flex items-center gap-1"><Search size={10} className="text-cyan-400"/> بحث</span>
            </div>
            <div className="grid grid-cols-1 gap-3 w-full max-w-sm">
              {[
                'ابحث عن آخر أخبار الذكاء الاصطناعي',
                'افتح يوتيوب وابحث عن موسيقى هادئة',
                'اكتب كود Python لحساب الأعداد الأولية',
                'اشرح لي كيف يعمل نظام GPT-4',
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

      <div className="p-4 border-t border-slate-800/50 bg-[#0d0d15] flex-shrink-0">
        {pendingInputRequest && (
          <InputRequestBanner req={pendingInputRequest} onAnswer={onUserAnswer}/>
        )}
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
          {isAgentBusy && !inputValue.trim() ? (
            <button onClick={onStop}
              className="w-12 h-12 bg-red-600 hover:bg-red-500 text-white rounded-2xl flex items-center justify-center flex-shrink-0 transition-all shadow-lg shadow-red-500/20 active:scale-95 touch-manipulation">
              <X size={18}/>
            </button>
          ) : (
            <button onClick={onSubmit} disabled={!inputValue.trim() || !isConnected}
              className="w-12 h-12 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-2xl flex items-center justify-center flex-shrink-0 transition-all shadow-lg shadow-indigo-500/20 active:scale-95 touch-manipulation">
              {isAgentBusy ? <Loader2 size={18} className="animate-spin"/> : <Send size={18}/>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

// ─── BrowserPanel ─────────────────────────────────────────────────────────────
interface BrowserPanelProps {
  frameSrc: string | null; browserHasFrame: boolean;
  isAgentBusy: boolean; onEmit: (type: string, params: any) => void;
}
const BrowserPanel = memo(({ frameSrc, browserHasFrame, isAgentBusy, onEmit }: BrowserPanelProps) => {
  const browserImgRef = useRef<HTMLImageElement>(null);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [keyboardText, setKeyboardText] = useState('');
  const [urlBarValue, setUrlBarValue]   = useState('');

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
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
    longPressTimer.current = setTimeout(() => {
      const coords = getBrowserCoords(t.clientX, t.clientY);
      onEmit('contextmenu', { ...coords, button: 'right' });
      touchStartRef.current = null;
    }, 500);
  }, [getBrowserCoords, onEmit]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1 && touchStartRef.current) {
      const t = e.touches[0];
      const dy = touchStartRef.current.y - t.clientY;
      const dx = touchStartRef.current.x - t.clientX;
      if (Math.abs(dy) > 4 || Math.abs(dx) > 4) {
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
    if (dist > 10 || dt > 500) return;
    const coords = getBrowserCoords(touch.clientX, touch.clientY);
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
    onEmit('click', { ...coords, button: 'left' });
  }, [getBrowserCoords, onEmit]);

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
          className={`p-2 rounded-lg transition-all touch-manipulation min-w-[36px] ${showKeyboard ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-white hover:bg-slate-800'}`}>
          <Keyboard size={16}/>
        </button>
      </div>

      <AnimatePresence>
        {showKeyboard && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="border-b border-slate-800/60 bg-[#12121c] overflow-hidden flex-shrink-0"
          >
            <div className="p-3 flex gap-2">
              <input
                autoFocus value={keyboardText}
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
        <img
          ref={browserImgRef}
          alt="Browser View"
          draggable={false}
          className="w-full h-full object-contain pointer-events-none"
          src={frameSrc ? `data:image/jpeg;base64,${frameSrc}` : undefined}
          style={{ display: browserHasFrame ? 'block' : 'none' }}
        />
        {isAgentBusy && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-black/70 backdrop-blur-md border border-white/10 rounded-full flex items-center gap-2 text-xs text-indigo-300 font-medium pointer-events-none z-20">
            <Loader2 size={12} className="animate-spin"/> الوكيل يتحكم في المتصفح
          </div>
        )}
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
  const [browserFrameSrc, setBrowserFrameSrc] = useState<string | null>(null);
  const [currentStep, setCurrentStep]     = useState<string | null>(null);
  const [activeTab, setActiveTab]         = useState<ActiveTab>('chat');
  const [sidebarOpen, setSidebarOpen]     = useState(false);
  const [isAgentBusy, setIsAgentBusy]     = useState(false);
  const [pendingInputRequest, setPendingInputRequest] = useState<InputRequest | null>(null);
  const [currentPlan, setCurrentPlan]     = useState<TaskPlan | null>(null);
  const [agentActivity, setAgentActivity] = useState<AgentActivity | null>(null);

  const socketRef = useRef<Socket | null>(null);

  const emitBrowser = useCallback((type: string, params: any) => {
    socketRef.current?.emit('browserEvent', { type, pageId: 'default', params });
  }, []);

  const handleResume = useCallback((taskId: string) => {
    socketRef.current?.emit('resumeTask', taskId);
  }, []);

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

  const handleSubmit = useCallback(() => {
    const text = inputValue.trim();
    if (!text || !socketRef.current || !isConnected) return;
    setMessages(p => [...p, { id: uid(), type: 'user', text, timestamp: new Date() }]);
    setCurrentPlan(null);
    setAgentActivity(null);
    const taskType = autoClassifyType(text);
    socketRef.current.emit('submitTask', { description: text, type: taskType, priority: 'normal' });
    setInputValue('');
  }, [inputValue, isConnected, autoClassifyType]);

  const handleStop = useCallback(() => {
    socketRef.current?.emit('stopTask');
    setIsAgentBusy(false);
    setAgentActivity(null);
    addSystem('تم إيقاف المهمة', 'info');
  }, [addSystem]);

  // ── Socket.io ───────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io({ path: '/api/socket', transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => { setIsConnected(true); addSystem('متصل بالخادم بنجاح', 'success'); socket.emit('getStatus'); });
    socket.on('disconnect', () => { setIsConnected(false); addSystem('انقطع الاتصال', 'error'); });
    socket.on('status', (d: { tasks: Task[] }) => setTasks(d.tasks || []));

    socket.on('taskUpdate', (d: any) => {
      socket.emit('getStatus');
      if (d.type === 'status_change') {
        if      (d.status === 'completed')     { addAgent('اكتملت المهمة بنجاح', 'completed'); setIsAgentBusy(false); setAgentActivity(null); }
        else if (d.status === 'failed')        { addAgent(`فشلت المهمة: ${d.error}`, 'failed'); setIsAgentBusy(false); setAgentActivity(null); }
        else if (d.status === 'awaiting_user') { addAgent('الوكيل ينتظر تدخلك', 'awaiting_user'); }
      }
    });

    socket.on('taskStart', (d: any) => {
      addSystem(`بدأت المهمة`, 'info');
      setIsAgentBusy(true);
    });

    socket.on('taskSuccess', (d: any) => {
      setIsAgentBusy(false);
      setAgentActivity(null);
      if (d?.result) addAgent(d.result, 'completed');
    });

    socket.on('taskFail', () => {
      setIsAgentBusy(false);
      setAgentActivity(null);
    });

    socket.on('thinking', (d: { content: string }) => {
      const match = d.content.match(/^\[(\w+)\]/);
      if (match) setCurrentStep(match[1]);
      addThinking(d.content, match?.[1]);
    });

    // ── أحداث جديدة: خطة ووكلاء متعددين ─────────────────────────────────
    socket.on('taskPlan', (d: { taskId: string; plan: TaskPlan }) => {
      setCurrentPlan(d.plan);
      setActiveTab('plan');
    });

    socket.on('agentActivity', (d: AgentActivity) => {
      setAgentActivity(d);
      // تحديث حالة خطوة الخطة
      setCurrentPlan(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          steps: prev.steps.map(s =>
            s.id === d.stepId
              ? { ...s, status: d.status === 'done' ? 'completed' : d.status === 'failed' ? 'failed' : 'running' }
              : s
          ),
        };
      });
    });

    socket.on('browserStream', (d: { image: string }) => {
      if (d.image) {
        setBrowserFrameSrc(d.image);
        setBrowserHasFrame(true);
      }
    });

    socket.on('log', (log: { level: string; message: string }) => {
      if (log.level === 'error') addSystem(log.message, 'error');
    });

    socket.on('agentNeedsInput', (d: InputRequest) => {
      setPendingInputRequest(d);
      setActiveTab('chat');
    });

    return () => { socket.disconnect(); };
  }, [addSystem, addAgent, addThinking]);

  const handleUserAnswer = useCallback((answer: string) => {
    if (!pendingInputRequest || !socketRef.current) return;
    socketRef.current.emit('userInput', { taskId: pendingInputRequest.taskId, answer });
    addThinking(`[ACT] إجابة المستخدم: ${answer}`, 'ACT');
    setPendingInputRequest(null);
  }, [pendingInputRequest, addThinking]);

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
                  <p className="text-[11px] text-slate-500 mt-0.5">وكيل AI متعدد الأدوار</p>
                </div>
              </div>
              <button onClick={() => setSidebarOpen(false)}
                className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-xl transition-all touch-manipulation">
                <X size={18}/>
              </button>
            </div>

            {/* Agents status */}
            <div className="p-4 border-b border-slate-800/50">
              <p className="text-[11px] uppercase tracking-widest font-bold text-slate-600 px-2 mb-3 flex items-center gap-2">
                <Network size={12}/> الوكلاء المتاحون
              </p>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(AGENT_META).map(([role, meta]) => (
                  <div key={role} className={`p-2 rounded-lg border ${meta.bg} flex items-center gap-1.5`}>
                    <meta.icon size={11} className={meta.color}/>
                    <span className="text-[10px] text-slate-400 truncate">{meta.label}</span>
                  </div>
                ))}
              </div>
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
              <button onClick={() => { setMessages([]); setCurrentPlan(null); setAgentActivity(null); }}
                className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 border border-slate-700/40 touch-manipulation">
                <RefreshCw size={14}/> مسح المحادثة
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );

  const TABS = [
    { id: 'chat'    as ActiveTab, label: 'المحادثة', icon: Bot     },
    { id: 'plan'    as ActiveTab, label: 'الخطة',    icon: ListChecks, badge: !!currentPlan },
    { id: 'browser' as ActiveTab, label: 'المتصفح',  icon: Monitor, badge: isAgentBusy && browserHasFrame },
  ];

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
            {isAgentBusy && agentActivity && (
              <motion.span
                key={agentActivity.agentRole}
                initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border ${AGENT_META[agentActivity.agentRole]?.bg || 'bg-slate-800 border-slate-700'} ${AGENT_META[agentActivity.agentRole]?.color || 'text-slate-400'}`}
              >
                <Loader2 size={9} className="animate-spin"/>
                {AGENT_META[agentActivity.agentRole]?.label || 'يعمل'}
              </motion.span>
            )}
            {isAgentBusy && !agentActivity && currentStep && STEP_META[currentStep] && (
              <span className={`flex items-center gap-1 px-2.5 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-full text-[11px] font-medium ${STEP_META[currentStep].color}`}>
                <Loader2 size={9} className="animate-spin"/>
                {STEP_META[currentStep].label}
              </span>
            )}
          </div>
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500'}`}/>
        </header>

        {/* Desktop layout: 3 columns */}
        <div className="flex-1 flex min-h-0">
          <div className="hidden lg:flex flex-1 min-h-0">
            {/* Chat column */}
            <div className="w-[36%] border-r border-slate-800/50 flex flex-col min-h-0">
              <ChatPanel
                messages={messages} tasks={tasks} isConnected={isConnected}
                isAgentBusy={isAgentBusy} currentStep={currentStep}
                inputValue={inputValue} setInputValue={setInputValue}
                onSubmit={handleSubmit} onStop={handleStop} onResume={handleResume}
                pendingInputRequest={pendingInputRequest} onUserAnswer={handleUserAnswer}
              />
            </div>
            {/* Plan column */}
            <div className="w-[28%] border-r border-slate-800/50 flex flex-col min-h-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800/50 flex items-center gap-2 flex-shrink-0">
                <ListChecks size={14} className="text-violet-400"/>
                <span className="text-xs font-semibold text-slate-300">خطة التنفيذ</span>
                {currentPlan && (
                  <span className="ml-auto text-[10px] text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded-full border border-violet-500/20">
                    {currentPlan.steps.length} خطوات
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-y-auto">
                <PlanPanel plan={currentPlan} agentActivity={agentActivity} isAgentBusy={isAgentBusy}/>
              </div>
            </div>
            {/* Browser column */}
            <div className="flex-1 flex flex-col min-h-0">
              <BrowserPanel
                frameSrc={browserFrameSrc} browserHasFrame={browserHasFrame}
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
                    onSubmit={handleSubmit} onStop={handleStop} onResume={handleResume}
                    pendingInputRequest={pendingInputRequest} onUserAnswer={handleUserAnswer}
                  />
                : activeTab === 'plan'
                ? <div className="h-full overflow-y-auto">
                    <PlanPanel plan={currentPlan} agentActivity={agentActivity} isAgentBusy={isAgentBusy}/>
                  </div>
                : <BrowserPanel
                    frameSrc={browserFrameSrc} browserHasFrame={browserHasFrame}
                    isAgentBusy={isAgentBusy} onEmit={emitBrowser}
                  />
              }
            </div>
            <div className="flex border-t border-slate-800/50 bg-[#0d0d15] flex-shrink-0">
              {TABS.map(({ id, label, icon: Icon, badge }) => (
                <button key={id} onClick={() => setActiveTab(id)}
                  className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-all touch-manipulation relative ${
                    activeTab === id ? 'text-indigo-400 border-t-2 border-indigo-500' : 'text-slate-500 border-t-2 border-transparent'
                  }`}>
                  <Icon size={20}/>
                  <span className="text-[11px] font-medium">{label}</span>
                  {badge && (
                    <div className="absolute top-2 right-1/3 w-2 h-2 rounded-full bg-violet-500 animate-pulse"/>
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
