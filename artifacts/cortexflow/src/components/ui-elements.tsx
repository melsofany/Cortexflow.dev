import React from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("glass-panel rounded-xl overflow-hidden flex flex-col", className)}
      {...props}
    />
  )
);
Card.displayName = "Card";

export const NeonButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'destructive', loading?: boolean }>(
  ({ className, variant = 'primary', loading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "relative inline-flex items-center justify-center px-4 py-2.5 text-sm font-bold tracking-widest uppercase transition-all duration-300 rounded-md overflow-hidden group",
          variant === 'primary' && "bg-primary/10 text-primary border border-primary/40 hover:bg-primary/20 hover:shadow-[0_0_20px_rgba(0,243,255,0.3)] hover:border-primary active:scale-[0.98]",
          variant === 'secondary' && "bg-secondary/10 text-secondary border border-secondary/40 hover:bg-secondary/20 hover:shadow-[0_0_20px_rgba(176,38,255,0.3)] hover:border-secondary active:scale-[0.98]",
          variant === 'destructive' && "bg-destructive/10 text-destructive border border-destructive/40 hover:bg-destructive/20 hover:shadow-[0_0_20px_rgba(255,0,0,0.3)] hover:border-destructive active:scale-[0.98]",
          variant === 'ghost' && "bg-transparent text-muted-foreground hover:text-white hover:bg-white/5 active:scale-[0.98]",
          "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:active:scale-100",
          className
        )}
        {...props}
      >
        <span className="relative z-10 flex items-center gap-2">
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {children}
        </span>
      </button>
    );
  }
);
NeonButton.displayName = "NeonButton";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex w-full rounded-md border border-border bg-black/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground",
        "focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-border bg-black/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground",
        "focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all resize-y",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "flex w-full rounded-md border border-border bg-black/50 px-3 py-2 text-sm text-foreground",
        "focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all appearance-none cursor-pointer",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Select.displayName = "Select";

export const Badge = ({ children, variant = 'default', className }: { children: React.ReactNode, variant?: 'default' | 'success' | 'warning' | 'error' | 'outline', className?: string }) => {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors",
      variant === 'default' && "bg-primary/20 text-primary border border-primary/30",
      variant === 'success' && "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
      variant === 'warning' && "bg-amber-500/20 text-amber-400 border border-amber-500/30",
      variant === 'error' && "bg-destructive/20 text-destructive border border-destructive/30",
      variant === 'outline' && "border border-border text-muted-foreground",
      className
    )}>
      {children}
    </span>
  )
};
