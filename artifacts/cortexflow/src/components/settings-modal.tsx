import React, { useState, useEffect } from 'react';
import { X, Key, CheckCircle, XCircle, Loader2, Trash2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

const API_BASE = `${(import.meta.env.VITE_API_URL as string) || ''}/api`;

interface DeepSeekStatus {
  configured: boolean;
  maskedKey: string | null;
  model: string;
}

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [status, setStatus] = useState<DeepSeekStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setFeedback(null);
    setApiKey('');
    fetchStatus();
  }, [open]);

  async function fetchStatus() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/settings/deepseek`);
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({ configured: false, maskedKey: null, model: 'deepseek-chat' });
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!apiKey.trim()) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch(`${API_BASE}/settings/deepseek`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setFeedback({ type: 'success', msg: 'تم حفظ المفتاح والتحقق منه بنجاح ✓' });
        setApiKey('');
        await fetchStatus();
      } else {
        setFeedback({ type: 'error', msg: data.error || 'فشل التحقق من المفتاح' });
      }
    } catch {
      setFeedback({ type: 'error', msg: 'خطأ في الاتصال بالخادم' });
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    setFeedback(null);
    try {
      await fetch(`${API_BASE}/settings/deepseek`, { method: 'DELETE' });
      setFeedback({ type: 'success', msg: 'تم حذف المفتاح' });
      await fetchStatus();
    } catch {
      setFeedback({ type: 'error', msg: 'فشل الحذف' });
    } finally {
      setRemoving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md mx-4 bg-[#0d0d14] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/40">
          <h2 className="text-base font-bold tracking-widest uppercase text-white">الإعدادات</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-6">

          {/* DeepSeek Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#4D6BFE]/20 border border-[#4D6BFE]/30 flex items-center justify-center">
                <Key size={14} className="text-[#4D6BFE]" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">DeepSeek AI</h3>
                <p className="text-[11px] text-muted-foreground">نموذج الذكاء الاصطناعي الرئيسي للوكيل</p>
              </div>
              {!loading && status && (
                <div className={cn(
                  "ml-auto flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                  status.configured
                    ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400"
                    : "bg-white/5 border border-white/10 text-muted-foreground"
                )}>
                  {status.configured ? (
                    <><CheckCircle size={10} /> مفعّل</>
                  ) : (
                    <><XCircle size={10} /> غير مهيأ</>
                  )}
                </div>
              )}
            </div>

            {/* Current key */}
            {!loading && status?.configured && (
              <div className="flex items-center justify-between px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <div>
                  <p className="text-[11px] text-muted-foreground mb-0.5">المفتاح الحالي</p>
                  <p className="text-sm font-mono text-emerald-400">{status.maskedKey}</p>
                </div>
                <button
                  onClick={handleRemove}
                  disabled={removing}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-lg text-[11px] font-medium transition-colors disabled:opacity-50"
                >
                  {removing ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                  حذف
                </button>
              </div>
            )}

            {/* Input new key */}
            <div className="space-y-3">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                {status?.configured ? 'تغيير المفتاح' : 'أدخل مفتاح API'}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                placeholder="sk-..."
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm font-mono text-white placeholder:text-white/20 focus:outline-none focus:border-[#4D6BFE]/60 focus:bg-white/8 transition-all"
                dir="ltr"
              />
              <button
                onClick={handleSave}
                disabled={saving || !apiKey.trim()}
                className="w-full py-3 bg-[#4D6BFE] hover:bg-[#6B87FF] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2"
              >
                {saving ? (
                  <><Loader2 size={14} className="animate-spin" /> جاري التحقق...</>
                ) : (
                  <>حفظ وتفعيل</>
                )}
              </button>

              {/* Feedback */}
              {feedback && (
                <div className={cn(
                  "flex items-center gap-2 px-4 py-3 rounded-xl text-sm",
                  feedback.type === 'success'
                    ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                    : "bg-red-500/10 border border-red-500/20 text-red-400"
                )}>
                  {feedback.type === 'success' ? <CheckCircle size={14} /> : <XCircle size={14} />}
                  {feedback.msg}
                </div>
              )}

              <p className="text-[10px] text-muted-foreground text-center">
                احصل على مفتاح مجاني من{' '}
                <a
                  href="https://platform.deepseek.com/api_keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#4D6BFE] hover:underline inline-flex items-center gap-0.5"
                >
                  platform.deepseek.com <ExternalLink size={9} />
                </a>
              </p>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-white/5" />

          {/* Info */}
          <div className="px-4 py-3 bg-white/3 border border-white/8 rounded-xl">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              يستخدم الوكيل <span className="text-white font-medium">deepseek-chat</span> لتنفيذ المهام والتفكير والتحليل.
              يُحسّن الأداء بشكل كبير مقارنةً بالنماذج المحلية.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
