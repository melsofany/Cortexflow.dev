import React, { useState } from 'react';
import { Cpu, Settings, Activity } from 'lucide-react';
import { useHealthCheck } from '@workspace/api-client-react';
import { useAgentState } from '@/hooks/use-agent-state';
import { cn } from '@/lib/utils';
import { TaskSidebar } from '@/components/task-sidebar';
import { ChatInterface } from '@/components/chat-interface';
import { BrowserView } from '@/components/browser-view';
import { ThinkingSteps } from '@/components/thinking-steps';
import { TerminalLogs } from '@/components/terminal-logs';

export default function Dashboard() {
  const { data: health } = useHealthCheck();
  const { connected, realtimeLogs, thinkingStream, activeStep } = useAgentState();
  
  const [activeTab, setActiveTab] = useState<'chat' | 'browser'>('chat');

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background">
      {/* Top Header */}
      <header className="h-16 border-b border-white/5 bg-black/40 backdrop-blur-xl flex items-center justify-between px-6 shrink-0 z-50">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Cpu className="text-primary w-6 h-6" />
            <div className="absolute inset-0 bg-primary blur-md opacity-40 rounded-full" />
          </div>
          <h1 className="text-xl font-display font-bold tracking-widest text-white">
            CORTEX<span className="text-primary neon-text">FLOW</span>
          </h1>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3 px-4 py-1.5 bg-white/5 rounded-full border border-white/10">
            <div className="flex items-center gap-2 border-r border-white/10 pr-3">
              <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Engine</span>
              <span className="text-sm font-mono text-secondary neon-text-secondary">
                {health?.activeModel || 'Offline'}
              </span>
            </div>
            <div className="flex items-center gap-2 pl-1">
              <div className={cn(
                "w-2 h-2 rounded-full shadow-[0_0_8px]",
                connected ? "bg-emerald-400 shadow-emerald-400/50" : "bg-destructive shadow-destructive/50"
              )} />
              <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">
                {connected ? 'Socket Link' : 'Disconnected'}
              </span>
            </div>
          </div>
          
          <button className="text-muted-foreground hover:text-primary transition-colors p-2 hover:bg-white/5 rounded-full">
            <Settings size={18} />
          </button>
        </div>
      </header>

      {/* Main Grid */}
      <main className="flex-1 overflow-hidden p-4 grid grid-cols-12 gap-4">
        
        {/* Left Col: Task Control */}
        <div className="col-span-12 lg:col-span-3 h-full">
          <TaskSidebar />
        </div>

        {/* Center Col: Main Work Area */}
        <div className="col-span-12 lg:col-span-6 flex flex-col h-full bg-black/20 border border-white/5 rounded-xl overflow-hidden glass-panel">
          {/* Tabs */}
          <div className="flex items-center gap-1 px-2 pt-2 bg-black/40 border-b border-white/10">
            <button 
              onClick={() => setActiveTab('chat')} 
              className={cn(
                "px-6 py-3 text-xs font-bold tracking-widest uppercase transition-all border-b-2 rounded-t-lg", 
                activeTab === 'chat' 
                  ? "border-primary text-primary bg-primary/5 neon-text" 
                  : "border-transparent text-muted-foreground hover:text-white hover:bg-white/5"
              )}
            >
              Agent Protocol
            </button>
            <button 
              onClick={() => setActiveTab('browser')} 
              className={cn(
                "px-6 py-3 text-xs font-bold tracking-widest uppercase transition-all border-b-2 rounded-t-lg", 
                activeTab === 'browser' 
                  ? "border-primary text-primary bg-primary/5 neon-text" 
                  : "border-transparent text-muted-foreground hover:text-white hover:bg-white/5"
              )}
            >
              Browser Canvas
            </button>
          </div>
          
          <div className="flex-1 p-4 overflow-hidden relative">
            {activeTab === 'chat' ? <ChatInterface /> : <BrowserView />}
          </div>
        </div>

        {/* Right Col: Telemetry & Logs */}
        <div className="col-span-12 lg:col-span-3 flex flex-col h-full gap-4">
          <div className="flex-none h-2/5">
            <ThinkingSteps activeStep={activeStep} thinkingStream={thinkingStream} />
          </div>
          <div className="flex-1 min-h-0">
            <TerminalLogs logs={realtimeLogs} />
          </div>
        </div>
        
      </main>
    </div>
  );
}
