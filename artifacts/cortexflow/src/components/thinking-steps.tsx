import React from 'react';
import { Eye, Brain, Layers, Zap, CheckCircle2, Clock, Activity, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

// Maps exactly to the required arabic labels
const STEP_META: Record<string, { icon: any; color: string; bg: string; border: string; label: string }> = {
  OBSERVE:  { icon: Eye,          color: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/30',    label: 'مراقبة'  },
  THINK:    { icon: Brain,        color: 'text-violet-400',  bg: 'bg-violet-500/10',  border: 'border-violet-500/30',  label: 'تفكير'   },
  PLAN:     { icon: Layers,       color: 'text-indigo-400',  bg: 'bg-indigo-500/10',  border: 'border-indigo-500/30',  label: 'تخطيط'   },
  ACT:      { icon: Zap,          color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   label: 'تنفيذ'   },
  VERIFY:   { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', label: 'تحقق'    },
  MEMORY:   { icon: Clock,        color: 'text-pink-400',    bg: 'bg-pink-500/10',    border: 'border-pink-500/30',    label: 'ذاكرة'   },
  PLANNING: { icon: Activity,     color: 'text-cyan-400',    bg: 'bg-cyan-500/10',    border: 'border-cyan-500/30',    label: 'وضع خطة' },
};

const STEP_ORDER = ['OBSERVE', 'THINK', 'PLAN', 'ACT', 'VERIFY'];

export function ThinkingSteps({ activeStep, thinkingStream }: { activeStep: string; thinkingStream: any[] }) {
  
  return (
    <div className="flex flex-col h-full bg-black/30 border border-border rounded-xl overflow-hidden relative">
      <div className="bg-white/5 px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-secondary" />
          <h3 className="font-display font-semibold tracking-wide text-sm text-white">AGENT COGNITION</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary"></span>
          </span>
          <span className="text-[10px] text-muted-foreground font-mono uppercase">Processing</span>
        </div>
      </div>

      <div className="p-4 space-y-3 border-b border-border bg-black/20">
        {STEP_ORDER.map((step) => {
          const meta = STEP_META[step];
          const isActive = activeStep === step;
          const Icon = meta.icon;
          
          return (
            <motion.div 
              key={step}
              initial={false}
              animate={{
                opacity: isActive ? 1 : 0.4,
                scale: isActive ? 1.02 : 1,
                x: isActive ? 5 : 0
              }}
              className={cn(
                "flex items-center justify-between p-2 rounded-lg border transition-all duration-300",
                isActive ? `${meta.bg} ${meta.border} shadow-[0_0_15px_rgba(0,0,0,0.2)]` : "border-transparent bg-transparent"
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn("p-1.5 rounded-md", isActive ? "bg-black/40" : "")}>
                  <Icon size={16} className={meta.color} />
                </div>
                <span className={cn("font-bold tracking-wider text-sm", meta.color)}>{step}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground font-medium text-xs opacity-70" dir="rtl">{meta.label}</span>
                {isActive && <Loader2 size={14} className={cn("animate-spin", meta.color)} />}
              </div>
            </motion.div>
          )
        })}
      </div>

      {/* Stream Viewer */}
      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs flex flex-col gap-3">
        <AnimatePresence>
          {thinkingStream.slice(-10).map((node, i) => (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={i}
              className="flex flex-col gap-1 border-l-2 border-secondary/30 pl-3 py-1"
            >
              {node.step && (
                <span className={cn("text-[10px] font-bold", STEP_META[node.step]?.color || "text-muted-foreground")}>
                  [{node.step}]
                </span>
              )}
              <span className="text-foreground/80 leading-relaxed break-words whitespace-pre-wrap">
                {typeof node === 'string' ? node : node.content || JSON.stringify(node)}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
