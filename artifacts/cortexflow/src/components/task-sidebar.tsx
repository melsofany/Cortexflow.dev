import React, { useState } from 'react';
import { Play, Plus, List, AlertTriangle } from 'lucide-react';
import { useListTasks, useCreateTask, useExecuteTask, getListTasksQueryKey, type Task } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, NeonButton, Input, Textarea, Select, Badge } from './ui-elements';
import { format } from 'date-fns';

export function TaskSidebar() {
  const queryClient = useQueryClient();
  const { data: tasks = [], isLoading } = useListTasks();
  
  const createMutation = useCreateTask({
    mutation: {
      onSuccess: () => {
        setDesc('');
        setUrl('');
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      }
    }
  });

  const executeMutation = useExecuteTask({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      }
    }
  });

  const [desc, setDesc] = useState('');
  const [type, setType] = useState<'browser' | 'system' | 'ai' | 'research'>('browser');
  const [url, setUrl] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!desc.trim()) return;
    createMutation.mutate({
      data: {
        description: desc,
        type: type,
        url: url.trim() || undefined,
        priority: 1
      }
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'success';
      case 'running': return 'default'; // Primary/Cyan
      case 'failed': return 'error';
      default: return 'warning'; // Pending
    }
  };

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Create Task Form */}
      <Card className="p-4 shrink-0">
        <h3 className="font-display font-semibold flex items-center gap-2 mb-4 text-primary">
          <Plus size={16} /> NEW DIRECTIVE
        </h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Textarea 
              placeholder="Describe the objective..." 
              value={desc}
              onChange={e => setDesc(e.target.value)}
              className="min-h-[80px]"
              required
            />
          </div>
          <div className="flex gap-2">
            <Select value={type} onChange={(e) => setType(e.target.value as any)}>
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
