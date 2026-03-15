import React, { useRef, useEffect } from 'react';
import { Terminal } from 'lucide-react';
import { format } from 'date-fns';
import type { LogEntry } from '@workspace/api-client-react';

export function TerminalLogs({ logs }: { logs: LogEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="flex flex-col h-full bg-[#0a0a0f] border border-white/10 rounded-xl overflow-hidden font-mono text-xs shadow-xl relative">
      <div className="bg-black/60 px-4 py-2.5 border-b border-white/5 flex items-center gap-3 backdrop-blur-md z-10">
        <Terminal size={14} className="text-primary" />
        <span className="text-white/80 font-bold tracking-widest text-[11px]">SYSTEM_LOGS</span>
        <div className="ml-auto flex gap-1.5">
          <div className="w-2 h-2 rounded-full bg-white/20" />
          <div className="w-2 h-2 rounded-full bg-white/20" />
          <div className="w-2 h-2 rounded-full bg-white/20" />
        </div>
      </div>
      
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-1 scroll-smooth">
        {logs.length === 0 ? (
          <div className="text-muted-foreground/50 animate-pulse">Awaiting system events...</div>
        ) : (
          logs.map((log, i) => (
            <div key={log.id || i} className="flex flex-col gap-0.5 border-l-2 border-primary/20 pl-3 py-1 my-1 hover:bg-white/5 transition-colors rounded-r-md">
              <div className="flex items-center gap-2 text-muted-foreground/60">
                <span className="text-[10px]">[{format(new Date(log.createdAt || Date.now()), 'HH:mm:ss.SSS')}]</span>
                <span className="text-primary/90 font-bold uppercase tracking-wider">{log.action}</span>
                {log.agentType && <span className="text-secondary/80 text-[10px]">&lt;{log.agentType}&gt;</span>}
              </div>
              {log.input && (
                <div className="text-foreground/70 break-words mt-1">
                  <span className="text-primary/50 mr-2">❯</span> 
                  {log.input}
                </div>
              )}
              {log.output && (
                <div className="text-emerald-400/80 break-words mt-1 bg-emerald-500/5 px-2 py-1 rounded">
                  {log.output}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
