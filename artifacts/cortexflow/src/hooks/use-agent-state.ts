import { useState, useEffect } from 'react';
import { useSocket } from './use-socket';
import { useQueryClient } from '@tanstack/react-query';
import { getListTasksQueryKey, type LogEntry } from '@workspace/api-client-react';

export function useAgentState() {
  const { socket, connected } = useSocket();
  const queryClient = useQueryClient();
  const [realtimeLogs, setRealtimeLogs] = useState<LogEntry[]>([]);
  const [thinkingStream, setThinkingStream] = useState<any[]>([]);
  const [activeStep, setActiveStep] = useState<string>('OBSERVE');

  useEffect(() => {
    if (!socket) return;

    const handleLog = (log: LogEntry) => {
      setRealtimeLogs(prev => [...prev, log].slice(-150)); // Keep last 150 logs
    };

    const handleThinking = (data: any) => {
      setThinkingStream(prev => [...prev, data].slice(-20)); // Keep last 20 thinking nodes
      if (data.step) {
        setActiveStep(data.step);
      }
    };

    const invalidateTasks = () => {
      // Refresh REST cache whenever a socket event alters task state
      queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
    };

    const handleTaskDone = () => {
      setActiveStep('');
      invalidateTasks();
    };

    socket.on('log', handleLog);
    socket.on('thinking', handleThinking);
    socket.on('taskUpdate', invalidateTasks);
    socket.on('taskStart', (d: any) => { setActiveStep('OBSERVE'); invalidateTasks(); });
    socket.on('taskSuccess', handleTaskDone);
    socket.on('taskFail', handleTaskDone);
    socket.on('taskSubmitted', invalidateTasks);
    socket.on('taskExecuted', invalidateTasks);

    return () => {
      socket.off('log', handleLog);
      socket.off('thinking', handleThinking);
      socket.off('taskUpdate', invalidateTasks);
      socket.off('taskStart', invalidateTasks);
      socket.off('taskSuccess', handleTaskDone);
      socket.off('taskFail', handleTaskDone);
      socket.off('taskSubmitted', invalidateTasks);
      socket.off('taskExecuted', invalidateTasks);
    };
  }, [socket, queryClient]);

  return { connected, realtimeLogs, thinkingStream, activeStep };
}
