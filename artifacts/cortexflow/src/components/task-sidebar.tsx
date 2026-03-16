import React, { useState, useEffect } from 'react';
import { Play, Plus, List, AlertTriangle, GitBranch, Bot, Code2, Zap, Brain, Download, CheckCircle2, Loader2, Wrench, TrendingUp, Cpu } from 'lucide-react';
import { useListTasks, useCreateTask, useExecuteTask, getListTasksQueryKey, type Task } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, NeonButton, Input, Textarea, Select, Badge } from './ui-elements';
import { format } from 'date-fns';

const ENGINES = [
  {
    id: 'auto',
    label: 'Auto (Smart)',
    icon: Brain,
    color: 'text-yellow-400',
    desc: 'اختيار تلقائي للنموذج والمزود',
    repo: 'CortexFlow/auto-router',
  },
  {
    id: 'LangGraph',
    label: 'LangGraph',
    icon: GitBranch,
    color: 'text-cyan-400',
    desc: 'observe→think→plan→act→verify',
    repo: 'langchain-ai/langgraph',
  },
  {
    id: 'AutoGPT',
    label: 'AutoGPT',
    icon: Bot,
    color: 'text-violet-400',
    desc: 'تفكير ذاتي · ذاكرة · تقييم ذاتي',
    repo: 'Significant-Gravitas/AutoGPT',
  },
  {
    id: 'OpenInterpreter',
    label: 'Code Exec',
    icon: Code2,
    color: 'text-green-400',
    desc: 'تنفيذ كود Python/Shell مباشر',
    repo: 'OpenInterpreter/open-interpreter',
  },
  {
    id: 'Mistral',
    label: 'Mistral',
    icon: Zap,
    color: 'text-orange-400',
    desc: 'تخصص في التفكير والبرمجة',
    repo: 'mistralai',
  },
  {
    id: 'OODA',
    label: 'OODA Agent',
    icon: Cpu,
    color: 'text-pink-400',
    desc: 'مراقبة→توجه→قرار→تنفيذ+أدوات',
    repo: 'CortexFlow/ooda',
  },
] as const;

type EngineId = typeof ENGINES[number]['id'];

interface ModelInfo {
  name: string;
  description: string;
  size_mb: number;
  installed: boolean;
}

interface SelfImprovementData {
  report: string;
  stats: {
    total_tasks: number;
    successful_tasks: number;
    success_rate: number;
  };
  suggestions: string[];
}

const API_BASE = `${(import.meta.env.VITE_API_URL as string) || ''}/api`;

async function fetchModels(): Promise<ModelInfo[]> {
  try {
    const r = await fetch(`${API_BASE}/providers/models`);
    const data = await r.json();
    return data.models || [];
  } catch { return []; }
}

async function fetchRecommendedModels(): Promise<ModelInfo[]> {
  try {
    const r = await fetch(`${API_BASE}/providers`);
    const data = await r.json();
    return data.models?.recommended || [];
  } catch { return []; }
}

async function fetchSelfImprovement(): Promise<SelfImprovementData | null> {
  try {
    const r = await fetch(`${API_BASE}/providers/self-improvement`);
    return await r.json();
  } catch { return null; }
}

async function pullModel(model: string): Promise<void> {
  await fetch(`${API_BASE}/providers/pull-model`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  });
}

export function TaskSidebar() {
  const queryClient = useQueryClient();
  const { data: tasks = [], isLoading } = useListTasks();

  const createMutation = useCreateTask({
    mutation: {
      onSuccess: () => {
        setDesc('');
        setUrl('');
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      },
    },
  });

  const executeMutation = useExecuteTask({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      },
    },
  });

  const [desc, setDesc]       = useState('');
  const [type, setType]       = useState<'browser' | 'system' | 'ai' | 'research'>('ai');
  const [url, setUrl]         = useState('');
  const [engine, setEngine]   = useState<EngineId>('auto');
  const [activePanel, setActivePanel] = useState<'task' | 'models' | 'improve'>('task');
  const [models, setModels]   = useState<ModelInfo[]>([]);
  const [pulling, setPulling] = useState<string | null>(null);
  const [improvement, setImprovement] = useState<SelfImprovementData | null>(null);

  useEffect(() => {
    fetchRecommendedModels().then(setModels);
    fetchSelfImprovement().then(setImprovement);
    const interval = setInterval(() => {
      fetchRecommendedModels().then(setModels);
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const selectedEngine = ENGINES.find(e => e.id === engine)!;
  const EngineIcon = selectedEngine.icon;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!desc.trim()) return;
    createMutation.mutate({
      data: {
        description: desc,
        type,
        url: url.trim() || undefined,
        priority: 1,
      },
    });
  };

  const handlePull = async (modelName: string) => {
    setPulling(modelName);
    await pullModel(modelName);
    setTimeout(() => {
      setPulling(null);
      fetchRecommendedModels().then(setModels);
    }, 3000);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'success';
      case 'running':   return 'default';
      case 'failed':    return 'error';
      default:          return 'warning';
    }
  };

  const installedCount = models.filter(m => m.installed).length;
  const totalCount = models.length;

  return (
    <div className="flex flex-col h-full gap-3">

      {/* Panel Switcher */}
      <div className="flex gap-1 p-1 bg-black/40 rounded-lg border border-white/5 shrink-0">
        {[
          { id: 'task',    label: 'المهام',    icon: List },
          { id: 'models',  label: `النماذج (${installedCount}/${totalCount})`, icon: Cpu },
          { id: 'improve', label: 'التطوير',   icon: TrendingUp },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActivePanel(id as any)}
            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all ${
              activePanel === id
                ? 'bg-primary/20 text-primary border border-primary/30'
                : 'text-muted-foreground hover:text-white'
            }`}
          >
            <Icon size={10} />
            {label}
          </button>
        ))}
      </div>

      {/* ── Panel: Tasks ── */}
      {activePanel === 'task' && (
        <>
          {/* Engine Selector */}
          <Card className="p-3 shrink-0">
            <h3 className="font-display font-semibold text-[10px] text-muted-foreground uppercase tracking-widest mb-2">
              محرك الوكيل
            </h3>
            <div className="grid grid-cols-2 gap-1">
              {ENGINES.map(eng => {
                const Icon = eng.icon;
                const active = engine === eng.id;
                return (
                  <button
                    key={eng.id}
                    onClick={() => setEngine(eng.id)}
                    className={`flex flex-col gap-0.5 p-2 rounded-lg border text-left transition-all ${
                      active
                        ? 'border-primary/50 bg-primary/10'
                        : 'border-white/5 bg-black/20 hover:border-white/15'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Icon size={10} className={active ? 'text-primary' : eng.color} />
                      <span className={`text-[10px] font-bold font-mono ${active ? 'text-primary' : 'text-white/80'}`}>
                        {eng.label}
                      </span>
                    </div>
                    <span className="text-[9px] text-muted-foreground leading-tight">
                      {eng.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Create Task Form */}
          <Card className="p-3 shrink-0">
            <h3 className="font-display font-semibold flex items-center gap-2 mb-3 text-primary text-xs">
              <Plus size={14} /> مهمة جديدة
            </h3>
            <form onSubmit={handleSubmit} className="space-y-2">
              <Textarea
                placeholder="اكتب المهمة التي تريد تنفيذها..."
                value={desc}
                onChange={e => setDesc(e.target.value)}
                className="min-h-[70px] text-sm"
                required
              />
              <div className="flex gap-2">
                <Select value={type} onChange={e => setType(e.target.value as any)}>
                  <option value="ai">ذكاء اصطناعي</option>
                  <option value="browser">تصفح الويب</option>
                  <option value="research">بحث ودراسة</option>
                  <option value="system">أوامر النظام</option>
                </Select>
                <Input
                  placeholder="URL (اختياري)"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  className="flex-1 text-xs"
                />
              </div>

              <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-black/30 border border-white/5">
                <EngineIcon size={10} className={selectedEngine.color} />
                <span className="text-[9px] text-muted-foreground">محرك:</span>
                <span className="text-[9px] font-mono text-white font-bold">{selectedEngine.label}</span>
              </div>

              <NeonButton
                type="submit"
                className="w-full text-xs"
                loading={createMutation.isPending}
                disabled={!desc.trim()}
              >
                تشغيل المهمة
              </NeonButton>
            </form>
          </Card>

          {/* Task List */}
          <Card className="flex-1 flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0 bg-black/20">
              <h3 className="font-display font-semibold flex items-center gap-2 text-white text-xs">
                <List size={12} className="text-secondary" /> قائمة المهام
              </h3>
              <Badge variant="outline">{tasks.length}</Badge>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {isLoading ? (
                <div className="p-4 text-center text-muted-foreground animate-pulse text-xs">جاري التحميل...</div>
              ) : tasks.length === 0 ? (
                <div className="p-6 text-center flex flex-col items-center gap-2 text-muted-foreground">
                  <AlertTriangle size={20} className="opacity-50" />
                  <p className="text-xs">لا توجد مهام حالياً.</p>
                </div>
              ) : (
                tasks.slice().reverse().map(task => (
                  <div key={task.taskId} className="bg-black/40 border border-white/5 rounded-lg p-2.5 hover:border-primary/30 transition-colors">
                    <div className="flex justify-between items-start mb-1.5">
                      <Badge variant={getStatusColor(task.status)}>
                        {task.status}
                      </Badge>
                      <span className="text-[9px] font-mono text-muted-foreground">
                        {task.createdAt ? format(new Date(task.createdAt), 'HH:mm') : ''}
                      </span>
                    </div>

                    <p className="text-xs text-foreground/90 line-clamp-2 mb-2">
                      {task.description}
                    </p>

                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-muted-foreground/70 uppercase">
                        {task.type}
                      </span>
                      {task.status === 'pending' && (
                        <button
                          onClick={() => executeMutation.mutate({ taskId: task.taskId })}
                          disabled={executeMutation.isPending}
                          className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center hover:bg-primary hover:text-black transition-all"
                        >
                          <Play size={12} className="ml-0.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </>
      )}

      {/* ── Panel: Models ── */}
      {activePanel === 'models' && (
        <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto">
          <Card className="p-3 shrink-0">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-display font-semibold text-xs text-primary uppercase tracking-widest flex items-center gap-1.5">
                <Cpu size={12} /> النماذج المتاحة
              </h3>
              <span className="text-[10px] text-muted-foreground">{installedCount}/{totalCount} مثبت</span>
            </div>
            <div className="w-full bg-white/5 rounded-full h-1.5 mb-3">
              <div
                className="bg-primary h-1.5 rounded-full transition-all"
                style={{ width: totalCount ? `${(installedCount / totalCount) * 100}%` : '0%' }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              النظام يختار النموذج تلقائياً حسب نوع المهمة. يمكنك تنزيل المزيد لتحسين الأداء.
            </p>
          </Card>

          <div className="space-y-2">
            {models.length === 0 ? (
              <Card className="p-4 text-center">
                <Loader2 size={20} className="animate-spin mx-auto mb-2 text-primary" />
                <p className="text-xs text-muted-foreground">جاري تحميل قائمة النماذج...</p>
              </Card>
            ) : models.map((model) => (
              <Card key={model.name} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {model.installed ? (
                        <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
                      ) : (
                        <div className="w-3 h-3 rounded-full border border-white/20 shrink-0" />
                      )}
                      <span className="text-xs font-mono font-bold text-white truncate">{model.name}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground ml-5">{model.description}</p>
                    <span className="text-[9px] text-white/30 font-mono ml-5">
                      {model.size_mb > 1000 ? `${(model.size_mb / 1000).toFixed(1)} GB` : `${model.size_mb} MB`}
                    </span>
                  </div>
                  {!model.installed && (
                    <button
                      onClick={() => handlePull(model.name)}
                      disabled={pulling === model.name}
                      className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all text-[10px] font-bold"
                    >
                      {pulling === model.name ? (
                        <Loader2 size={10} className="animate-spin" />
                      ) : (
                        <Download size={10} />
                      )}
                      {pulling === model.name ? 'جاري...' : 'تنزيل'}
                    </button>
                  )}
                  {model.installed && (
                    <span className="shrink-0 text-[9px] text-emerald-400 font-bold uppercase">مثبت</span>
                  )}
                </div>
              </Card>
            ))}
          </div>

          <Card className="p-3 shrink-0">
            <h4 className="text-[10px] font-bold text-white/60 uppercase mb-2">توجيه ذكي للنماذج</h4>
            <div className="space-y-1.5 text-[10px] text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="text-yellow-400">⚡</span>
                <span>مهام بسيطة → qwen2 (سريع)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-blue-400">🌐</span>
                <span>تصفح → llama3.2:1b (متوازن)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-green-400">💻</span>
                <span>برمجة → llama3.2:3b أو mistral</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-purple-400">🧠</span>
                <span>تفكير معقد → mistral (أقوى)</span>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ── Panel: Self Improvement ── */}
      {activePanel === 'improve' && (
        <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto">
          {improvement ? (
            <>
              <Card className="p-3 shrink-0">
                <h3 className="font-display font-semibold text-xs text-primary uppercase tracking-widest flex items-center gap-1.5 mb-3">
                  <TrendingUp size={12} /> التطوير الذاتي
                </h3>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="bg-black/40 rounded-lg p-2 text-center">
                    <div className="text-lg font-bold text-primary font-mono">{improvement.stats.total_tasks}</div>
                    <div className="text-[9px] text-muted-foreground">مهام</div>
                  </div>
                  <div className="bg-black/40 rounded-lg p-2 text-center">
                    <div className="text-lg font-bold text-emerald-400 font-mono">{improvement.stats.successful_tasks}</div>
                    <div className="text-[9px] text-muted-foreground">ناجحة</div>
                  </div>
                  <div className="bg-black/40 rounded-lg p-2 text-center">
                    <div className="text-lg font-bold text-yellow-400 font-mono">{improvement.stats.success_rate}%</div>
                    <div className="text-[9px] text-muted-foreground">معدل</div>
                  </div>
                </div>
              </Card>

              <Card className="p-3 shrink-0">
                <h4 className="text-[10px] font-bold text-white/60 uppercase mb-2">تقرير الأداء</h4>
                <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">
                  {improvement.report}
                </pre>
              </Card>

              {improvement.suggestions.length > 0 && (
                <Card className="p-3 shrink-0">
                  <h4 className="text-[10px] font-bold text-yellow-400 uppercase mb-2 flex items-center gap-1">
                    <Wrench size={10} /> اقتراحات التحسين
                  </h4>
                  <ul className="space-y-1.5">
                    {improvement.suggestions.map((s, i) => (
                      <li key={i} className="text-[10px] text-muted-foreground flex items-start gap-2">
                        <span className="text-primary mt-0.5">→</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              <Card className="p-3 shrink-0">
                <h4 className="text-[10px] font-bold text-white/60 uppercase mb-2">كيف يتطور الوكيل؟</h4>
                <div className="space-y-1.5 text-[10px] text-muted-foreground">
                  <p>• يسجّل نتيجة كل مهمة (نجاح/فشل + جودة)</p>
                  <p>• يحدّث نقاط كل نموذج تدريجياً</p>
                  <p>• يفضّل النماذج الأفضل أداءً لكل نوع مهمة</p>
                  <p>• يتكيّف مع تجارب الاستخدام الفعلية</p>
                </div>
              </Card>
            </>
          ) : (
            <Card className="p-6 text-center">
              <Loader2 size={24} className="animate-spin mx-auto mb-3 text-primary" />
              <p className="text-xs text-muted-foreground">جاري تحميل بيانات التطوير الذاتي...</p>
            </Card>
          )}

          <button
            onClick={() => fetchSelfImprovement().then(setImprovement)}
            className="w-full py-2 rounded-lg border border-white/10 text-[10px] text-muted-foreground hover:border-primary/30 hover:text-primary transition-all"
          >
            تحديث التقرير
          </button>
        </div>
      )}
    </div>
  );
}
