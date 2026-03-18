import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GitBranch, Cpu, Globe, Code2, Search, BookOpen, CheckCircle2, Loader2, Clock, AlertCircle, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DAGNode {
  id: string;
  title: string;
  description: string;
  agent: string;
  status: string;
  dependencies: string[];
  isParallel?: boolean;
  result?: string;
}

interface DAGViewProps {
  nodes: DAGNode[];
  category?: string;
  goal?: string;
  isActive?: boolean;
}

const AGENT_META: Record<string, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  researcher: { icon: Search,       color: 'text-blue-400',    bg: 'bg-blue-500/15',    label: 'باحث' },
  coder:      { icon: Code2,        color: 'text-green-400',   bg: 'bg-green-500/15',   label: 'مبرمج' },
  browser:    { icon: Globe,        color: 'text-cyan-400',    bg: 'bg-cyan-500/15',    label: 'متصفح' },
  reviewer:   { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/15', label: 'مراجع' },
  executor:   { icon: Zap,          color: 'text-amber-400',   bg: 'bg-amber-500/15',   label: 'منفذ' },
  planner:    { icon: GitBranch,    color: 'text-violet-400',  bg: 'bg-violet-500/15',  label: 'مخطط' },
  general:    { icon: Cpu,          color: 'text-pink-400',    bg: 'bg-pink-500/15',    label: 'عام' },
};

const STATUS_META: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  pending:   { icon: Clock,        color: 'text-gray-400',    label: 'انتظار' },
  ready:     { icon: Zap,          color: 'text-yellow-400',  label: 'جاهز' },
  running:   { icon: Loader2,      color: 'text-blue-400',    label: 'يعمل' },
  done:      { icon: CheckCircle2, color: 'text-emerald-400', label: 'مكتمل' },
  failed:    { icon: AlertCircle,  color: 'text-red-400',     label: 'فشل' },
  skipped:   { icon: Clock,        color: 'text-gray-600',    label: 'تخطي' },
};

function buildLevels(nodes: DAGNode[]): DAGNode[][] {
  if (!nodes.length) return [];
  const levels: DAGNode[][] = [];
  const placed = new Set<string>();
  const remaining = new Set(nodes.map(n => n.id));

  let iters = 0;
  while (remaining.size > 0 && iters < 20) {
    iters++;
    const level: DAGNode[] = [];
    for (const n of nodes) {
      if (!remaining.has(n.id)) continue;
      const depsOk = n.dependencies.every(d => placed.has(d));
      if (depsOk) level.push(n);
    }
    if (level.length === 0) {
      remaining.forEach(id => {
        const node = nodes.find(n => n.id === id);
        if (node) level.push(node);
      });
    }
    level.forEach(n => { placed.add(n.id); remaining.delete(n.id); });
    levels.push(level);
  }
  return levels;
}

function NodeCard({ node, isLast }: { node: DAGNode; isLast: boolean }) {
  const agentMeta = AGENT_META[node.agent] || AGENT_META.general;
  const statusMeta = STATUS_META[node.status] || STATUS_META.pending;
  const AgentIcon = agentMeta.icon;
  const StatusIcon = statusMeta.icon;

  const isRunning = node.status === 'running';
  const isDone = node.status === 'done';
  const isFailed = node.status === 'failed';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "relative flex flex-col gap-1.5 p-2.5 rounded-xl border transition-all duration-300 min-w-[140px] max-w-[170px]",
        isRunning && "border-blue-500/60 bg-blue-500/10 shadow-[0_0_15px_rgba(59,130,246,0.2)]",
        isDone && "border-emerald-500/40 bg-emerald-500/8",
        isFailed && "border-red-500/40 bg-red-500/8",
        !isRunning && !isDone && !isFailed && "border-white/10 bg-white/3"
      )}
    >
      {/* Pulse effect for running */}
      {isRunning && (
        <span className="absolute -top-1 -right-1 flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
        </span>
      )}

      {/* Agent badge */}
      <div className="flex items-center justify-between gap-1">
        <div className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold", agentMeta.bg)}>
          <AgentIcon size={10} className={agentMeta.color} />
          <span className={agentMeta.color}>{agentMeta.label}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <StatusIcon size={11} className={cn(statusMeta.color, isRunning && "animate-spin")} />
        </div>
      </div>

      {/* Title */}
      <p className="text-[11px] font-semibold text-white leading-tight line-clamp-2" dir="rtl">
        {node.title}
      </p>

      {/* Result snippet */}
      {isDone && node.result && (
        <p className="text-[9px] text-emerald-300/70 line-clamp-1" dir="rtl">
          ✓ {node.result.substring(0, 50)}
        </p>
      )}

      {isFailed && (
        <p className="text-[9px] text-red-400/70" dir="rtl">✗ فشل</p>
      )}
    </motion.div>
  );
}

function Arrow({ horizontal = false }: { horizontal?: boolean }) {
  return (
    <div className={cn("flex items-center justify-center", horizontal ? "mx-0.5" : "my-0.5")}>
      <div className={cn(
        "flex items-center justify-center text-white/20",
        horizontal ? "w-4" : "h-3",
      )}>
        {horizontal ? (
          <svg width="16" height="10" viewBox="0 0 16 10" fill="none">
            <path d="M0 5H14M14 5L10 1M14 5L10 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        ) : (
          <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
            <path d="M5 0V10M5 10L1 6M5 10L9 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        )}
      </div>
    </div>
  );
}

export function DAGView({ nodes, category, goal, isActive }: DAGViewProps) {
  const levels = useMemo(() => buildLevels(nodes), [nodes]);

  const doneCount = nodes.filter(n => n.status === 'done').length;
  const runningCount = nodes.filter(n => n.status === 'running').length;
  const progress = nodes.length > 0 ? (doneCount / nodes.length) * 100 : 0;

  if (!nodes.length) return null;

  return (
    <div className="flex flex-col gap-3 p-3 bg-black/40 border border-white/10 rounded-xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch size={14} className="text-violet-400" />
          <span className="text-[11px] font-bold text-white tracking-wide">EXECUTION DAG</span>
          {category && (
            <span className="text-[9px] px-1.5 py-0.5 bg-violet-500/20 text-violet-300 rounded-full border border-violet-500/30 uppercase font-mono">
              {category}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {runningCount > 0 && (
            <span className="flex items-center gap-1 text-[9px] text-blue-400">
              <Loader2 size={9} className="animate-spin" />
              {runningCount} نشط
            </span>
          )}
          <span className="text-[9px] text-muted-foreground font-mono">
            {doneCount}/{nodes.length}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-white/5 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-violet-500 to-cyan-500 rounded-full"
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>

      {/* DAG Levels */}
      <div className="flex flex-col items-center gap-1 overflow-x-auto">
        <AnimatePresence>
          {levels.map((level, levelIdx) => (
            <React.Fragment key={levelIdx}>
              {levelIdx > 0 && <Arrow />}
              <div className={cn(
                "flex gap-2 items-start",
                level.length > 1 && "relative"
              )}>
                {level.length > 1 && (
                  <div className="absolute -top-0.5 left-0 right-0 h-px bg-white/10" />
                )}
                {level.map((node, idx) => (
                  <React.Fragment key={node.id}>
                    {idx > 0 && <div className="mt-5"><Arrow horizontal /></div>}
                    <NodeCard node={node} isLast={levelIdx === levels.length - 1} />
                  </React.Fragment>
                ))}
              </div>
              {level.length > 1 && (
                <span className="text-[8px] text-white/30 font-mono">⚡ متوازي</span>
              )}
            </React.Fragment>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
