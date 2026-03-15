import React, { useState } from 'react';
import { Play, Plus, List, AlertTriangle, GitBranch, Bot, Code2, Zap } from 'lucide-react';
import { useListTasks, useCreateTask, useExecuteTask, getListTasksQueryKey, type Task } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, NeonButton, Input, Textarea, Select, Badge } from './ui-elements';
import { format } from 'date-fns';

const ENGINES = [
  {
    id: 'LangGraph',
    label: 'LangGraph',
    icon: GitBranch,
    color: 'text-cyan-400',
    desc: 'Multi-node pipeline · observe→think→plan→act',
    repo: 'langchain-ai/langgraph',
  },
  {
    id: 'AutoGPT',
    label: 'AutoGPT',
    icon: Bot,
    color: 'text-violet-400',
    desc: 'Goal decomposition · memory · self-critique',
    repo: 'Significant-Gravitas/AutoGPT',
  },
  {
    id: 'OpenInterpreter',
    label: 'Open Interpreter',
    icon: Code2,
    color: 'text-green-400',
    desc: 'Code execution · Python/Shell via Ollama',
    repo: 'OpenInterpreter/open-interpreter',
  },
  {
    id: 'mistralai',
    label: 'Mistral AI',
    icon: Zap,
    color: 'text-orange-400',
    desc: 'Native [INST] format · multilingual & code',
    repo: 'mistralai',
  },
] as const;

type EngineId = typeof ENGINES[number]['id'];

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

  const [desc, setDesc]     = useState('');
  const [type, setType]     = useState<'browser' | 'system' | 'ai' | 'research'>('browser');
  const [url, setUrl]       = useState('');
  const [engine, setEngine] = useState<EngineId>('LangGraph');

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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'success';
      case 'running':   return 'default';
      case 'failed':    return 'error';
      default:          return 'warning';
    }
  };

  return (
    <div className="flex flex-col h-full gap-4">

      {/* Engine Selector */}
      <Card className="p-3 shrink-0">
        <h3 className="font-display font-semibold text-xs text-muted-foreground uppercase tracking-widest mb-2">
          AI Engine
        </h3>
        <div className="grid grid-cols-2 gap-1.5">
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
                  <Icon size={12} className={active ? 'text-primary' : eng.color} />
                  <span className={`text-[11px] font-bold font-mono ${active ? 'text-primary' : 'text-white/80'}`}>
                    {eng.label}
                  </span>
                </div>
                <span className="text-[9px] text-muted-foreground leading-tight">
                  {eng.desc}
                </span>
                <span className="text-[8px] text-white/20 font-mono truncate">
                  {eng.repo}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Create Task Form */}
      <Card className="p-4 shrink-0">
        <h3 className="font-display font-semibold flex items-center gap-2 mb-4 text-primary">
          <Plus size={16} /> NEW DIRECTIVE
        </h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Textarea
            placeholder="Describe the objective..."
            value={desc}
            onChange={e => setDesc(e.target.value)}
            className="min-h-[80px]"
            required
          />
          <div className="flex gap-2">
            <Select value={type} onChange={e => setType(e.target.value as any)}>
              <option value="browser">Browser Automation</option>
              <option value="system">System Command</option>
              <option value="ai">AI Processing</option>
              <option value="research">Deep Research</option>
            </Select>
            <Input
              placeholder="Target URL (opt)"
              value={url}
              onChange={e => setUrl(e.target.value)}
              className="flex-1"
            />
          </div>

          {/* Selected Engine Badge */}
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-black/30 border border-white/5">
            <EngineIcon size={12} className={selectedEngine.color} />
            <span className="text-[10px] text-muted-foreground">Engine:</span>
            <span className="text-[10px] font-mono text-white font-bold">{selectedEngine.label}</span>
            <span className="text-[9px] text-muted-foreground/60 ml-auto">{selectedEngine.repo}</span>
          </div>

          <NeonButton
            type="submit"
            className="w-full"
            loading={createMutation.isPending}
            disabled={!desc.trim()}
          >
            Deploy Directive
          </NeonButton>
        </form>
      </Card>

      {/* Task List */}
      <Card className="flex-1 flex flex-col min-h-0">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0 bg-black/20">
          <h3 className="font-display font-semibold flex items-center gap-2 text-white">
            <List size={16} className="text-secondary" /> ACTIVE QUEUE
          </h3>
          <Badge variant="outline">{tasks.length} Total</Badge>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {isLoading ? (
            <div className="p-4 text-center text-muted-foreground animate-pulse">Loading vectors...</div>
          ) : tasks.length === 0 ? (
            <div className="p-8 text-center flex flex-col items-center gap-2 text-muted-foreground">
              <AlertTriangle size={24} className="opacity-50" />
              <p className="text-sm">No active directives.</p>
            </div>
          ) : (
            tasks.map(task => (
              <div key={task.taskId} className="bg-black/40 border border-white/5 rounded-lg p-3 hover:border-primary/30 transition-colors group">
                <div className="flex justify-between items-start mb-2">
                  <Badge variant={getStatusColor(task.status)}>
                    {task.status.toUpperCase()}
                  </Badge>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {task.createdAt ? format(new Date(task.createdAt), 'HH:mm:ss') : ''}
                  </span>
                </div>

                <p className="text-sm text-foreground/90 line-clamp-2 mb-3 font-medium">
                  {task.description}
                </p>

                <div className="flex items-center justify-between mt-auto">
                  <span className="text-xs text-muted-foreground/70 uppercase tracking-widest font-bold">
                    Type: <span className="text-white">{task.type}</span>
                  </span>

                  {task.status === 'pending' && (
                    <button
                      onClick={() => executeMutation.mutate({ taskId: task.taskId })}
                      disabled={executeMutation.isPending}
                      className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center hover:bg-primary hover:text-black transition-all hover:shadow-[0_0_10px_rgba(0,243,255,0.5)]"
                    >
                      <Play size={14} className="ml-0.5" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
