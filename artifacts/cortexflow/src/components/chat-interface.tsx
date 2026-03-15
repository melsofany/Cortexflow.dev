import React, { useState, useRef, useEffect } from 'react';
import { Bot, User, Send, Zap, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAiChat, type ChatMessage } from '@workspace/api-client-react';
import { NeonButton, Textarea, Card } from './ui-elements';
import { cn } from '@/lib/utils';

export function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: 'CortexFlow System Initialized. How can I assist you today?' }
  ]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const chatMutation = useAiChat({
    mutation: {
      onSuccess: (data) => {
        setMessages(prev => [...prev, { role: 'assistant', content: data.content }]);
      },
      onError: (err) => {
        setMessages(prev => [...prev, { role: 'assistant', content: `[SYSTEM ERROR]: Failed to generate response.` }]);
      }
    }
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, chatMutation.isPending]);

  const handleSend = () => {
    if (!input.trim() || chatMutation.isPending) return;
    
    const newMsg: ChatMessage = { role: 'user', content: input.trim() };
    const newMessages = [...messages, newMsg];
    
    setMessages(newMessages);
    setInput('');
    
    chatMutation.mutate({
      data: { messages: newMessages }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Card className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto p-6 space-y-6" ref={scrollRef}>
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => {
            const isUser = msg.role === 'user';
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className={cn("flex gap-4 max-w-[85%]", isUser ? "ml-auto flex-row-reverse" : "mr-auto")}
              >
                <div className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center shrink-0 border shadow-lg",
                  isUser 
                    ? "bg-primary/10 border-primary/40 text-primary" 
                    : "bg-secondary/10 border-secondary/40 text-secondary"
                )}>
                  {isUser ? <User size={18} /> : <Bot size={18} />}
                </div>
                <div className={cn(
                  "p-4 rounded-2xl relative group",
                  isUser 
                    ? "bg-primary/5 border border-primary/20 text-foreground rounded-tr-none" 
                    : "bg-secondary/5 border border-secondary/20 text-foreground rounded-tl-none"
                )}>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">
                    {msg.content}
                  </div>
                </div>
              </motion.div>
            );
          })}
          
          {chatMutation.isPending && (
             <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-4 max-w-[85%] mr-auto"
           >
             <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 border bg-secondary/10 border-secondary/40 text-secondary shadow-lg">
               <Zap size={18} className="animate-pulse" />
             </div>
             <div className="p-4 rounded-2xl bg-secondary/5 border border-secondary/20 rounded-tl-none flex items-center gap-2">
               <Loader2 size={16} className="text-secondary animate-spin" />
               <span className="text-secondary text-sm font-mono animate-pulse">Generating response...</span>
             </div>
           </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="p-4 bg-black/40 border-t border-white/5 backdrop-blur-sm">
        <div className="relative flex items-end gap-2">
          <Textarea 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Initialize command sequence..."
            className="resize-none min-h-[60px] pb-3"
          />
          <NeonButton 
            onClick={handleSend}
            disabled={!input.trim() || chatMutation.isPending}
            className="h-[60px] px-6"
          >
            <Send size={18} />
          </NeonButton>
        </div>
      </div>
    </Card>
  );
}
