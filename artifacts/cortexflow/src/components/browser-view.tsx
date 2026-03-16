import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Monitor, Globe, ShieldCheck, ArrowLeft, ArrowRight,
  RefreshCw, Hand, Bot, AlertTriangle, Zap, Loader2,
} from 'lucide-react';
import { Card } from './ui-elements';
import { useSocket } from '@/hooks/use-socket';

const BROWSER_W = 1280;
const BROWSER_H = 720;

export function BrowserView() {
  const { socket } = useSocket();
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef      = useRef<HTMLImageElement | null>(null);

  const [hasStream, setHasStream] = useState(false);
  const [currentUrl, setCurrentUrl] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const [captchaMode, setCaptchaMode] = useState(false);
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [debugCoords, setDebugCoords] = useState<{x:number;y:number} | null>(null);
  const [solving, setSolving] = useState(false);

  const lastMoveRef  = useRef<number>(0);
  const lastClickRef = useRef<{x:number;y:number} | null>(null);

  const toBrowserCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const native = e.nativeEvent as MouseEvent;
    const displayW = canvas.offsetWidth  || canvas.clientWidth  || 1;
    const displayH = canvas.offsetHeight || canvas.clientHeight || 1;
    const ox = native.offsetX ?? (native.clientX - canvas.getBoundingClientRect().left);
    const oy = native.offsetY ?? (native.clientY - canvas.getBoundingClientRect().top);
    return {
      x: Math.round(Math.max(0, Math.min(BROWSER_W - 1, (ox / displayW) * BROWSER_W))),
      y: Math.round(Math.max(0, Math.min(BROWSER_H - 1, (oy / displayH) * BROWSER_H))),
    };
  }, []);

  useEffect(() => {
    if (!socket) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const img = new Image();
    imgRef.current = img;

    const drawCrosshair = (bx: number, by: number) => {
      const r = 16;
      ctx.save();
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(bx - r, by); ctx.lineTo(bx + r, by); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx, by - r); ctx.lineTo(bx, by + r); ctx.stroke();
      ctx.beginPath(); ctx.arc(bx, by, r / 2, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    };

    const handleStream = (data: { image: string; url?: string }) => {
      if (!hasStream) setHasStream(true);
      if (data.url && data.url !== currentUrl) {
        setCurrentUrl(data.url);
        setUrlInput(data.url);
      }
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        if (lastClickRef.current) {
          drawCrosshair(lastClickRef.current.x, lastClickRef.current.y);
        }
      };
      img.src = `data:image/jpeg;base64,${data.image}`;
    };

    socket.on('browserStream', handleStream);
    return () => { socket.off('browserStream', handleStream); };
  }, [socket, hasStream, currentUrl]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!socket || !(manualMode || captchaMode)) return;
    const now = Date.now();
    if (now - lastMoveRef.current < 16) return;
    lastMoveRef.current = now;
    const coords = toBrowserCoords(e);
    socket.emit('userMouseMove', coords);
    if (isMouseDown) {
      socket.emit('userMouseDown', coords);
    }
  }, [socket, manualMode, captchaMode, isMouseDown, toBrowserCoords]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!socket || !(manualMode || captchaMode)) return;
    e.preventDefault();
    setIsMouseDown(true);
    const coords = toBrowserCoords(e);
    lastClickRef.current = coords;
    setDebugCoords(coords);
    socket.emit('userMouseDown', coords);
  }, [socket, manualMode, captchaMode, toBrowserCoords]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!socket || !(manualMode || captchaMode)) return;
    e.preventDefault();
    setIsMouseDown(false);
    const coords = toBrowserCoords(e);
    socket.emit('userMouseUp', coords);
  }, [socket, manualMode, captchaMode, toBrowserCoords]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!socket || !(manualMode || captchaMode)) return;
    e.preventDefault();
    const coords = toBrowserCoords(e as any);
    socket.emit('userScroll', { ...coords, deltaX: e.deltaX, deltaY: e.deltaY });
  }, [socket, manualMode, captchaMode, toBrowserCoords]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!socket || !(manualMode || captchaMode)) return;
    if (['F5', 'F12'].includes(e.key)) return;
    e.preventDefault();
    if (e.key.length === 1) {
      socket.emit('userType', { text: e.key });
    } else {
      socket.emit('userKeyDown', { key: e.key });
    }
  }, [socket, manualMode, captchaMode]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!socket || !(manualMode || captchaMode)) return;
    if (e.key.length > 1) {
      socket.emit('userKeyUp', { key: e.key });
    }
  }, [socket, manualMode, captchaMode]);

  const navigateTo = (url: string) => {
    if (!socket || !url) return;
    let target = url;
    if (!target.startsWith('http')) target = 'https://' + target;
    socket.emit('navigateTo', target);
    setCurrentUrl(target);
    setUrlInput(target);
  };

  const handleUrlKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') navigateTo(urlInput);
  };

  const toggleCaptcha = () => {
    setCaptchaMode(p => !p);
    setManualMode(false);
  };

  const toggleManual = () => {
    setManualMode(p => !p);
    setCaptchaMode(false);
  };

  const isInteractive = manualMode || captchaMode;

  return (
    <Card className="h-full flex flex-col relative overflow-hidden">
      {/* Browser Chrome */}
      <div className="h-10 bg-[#111118] border-b border-white/10 flex items-center gap-2 px-2 shrink-0 z-20">
        <button
          className="p-1.5 rounded hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
          onClick={() => socket?.emit('navigateTo', 'back')}
          title="Back"
        >
          <ArrowLeft size={13} />
        </button>
        <button
          className="p-1.5 rounded hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
          onClick={() => socket?.emit('navigateTo', 'forward')}
          title="Forward"
        >
          <ArrowRight size={13} />
        </button>
        <button
          className="p-1.5 rounded hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
          onClick={() => socket?.emit('browserEvent', { type: 'reload', params: {} })}
          title="Reload"
        >
          <RefreshCw size={13} />
        </button>

        <div className="flex-1 bg-black/60 border border-white/10 rounded h-6 flex items-center gap-1.5 px-2">
          <ShieldCheck size={10} className="text-emerald-400 shrink-0" />
          <input
            className="flex-1 bg-transparent text-[11px] font-mono text-white/70 outline-none min-w-0"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={handleUrlKeyDown}
            placeholder="https://"
          />
          <Globe size={10} className="text-primary/50 shrink-0" />
        </div>

        <button
          onClick={toggleCaptcha}
          title="وضع الكابيتشا — تحكم يدوي فوري"
          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all ${
            captchaMode
              ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50'
              : 'bg-white/5 text-muted-foreground hover:text-white border border-white/10'
          }`}
        >
          <AlertTriangle size={11} />
          <span className="hidden sm:inline">Captcha</span>
        </button>

        <button
          onClick={() => {
            if (!socket || solving) return;
            setSolving(true);
            socket.emit('solveCaptchaAuto');
            setTimeout(() => setSolving(false), 30000);
          }}
          disabled={solving || !hasStream}
          title="حل الكابتشا تلقائياً (يتطلب TWO_CAPTCHA_API_KEY أو CAPSOLVER_API_KEY)"
          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all ${
            solving
              ? 'bg-yellow-500/30 text-yellow-300 border border-yellow-500/50 cursor-wait'
              : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30'
          }`}
        >
          {solving ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
          <span className="hidden sm:inline">{solving ? 'حل...' : 'Auto'}</span>
        </button>

        <button
          onClick={toggleManual}
          title="وضع التحكم اليدوي"
          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all ${
            manualMode
              ? 'bg-primary/30 text-primary border border-primary/50'
              : 'bg-white/5 text-muted-foreground hover:text-white border border-white/10'
          }`}
        >
          {manualMode ? <Hand size={11} /> : <Bot size={11} />}
          <span className="hidden sm:inline">{manualMode ? 'Manual' : 'Auto'}</span>
        </button>
      </div>

      {/* Captcha Mode Banner */}
      {captchaMode && (
        <div className="bg-amber-500/20 border-b border-amber-500/40 px-3 py-1.5 flex items-center gap-2 shrink-0">
          <AlertTriangle size={12} className="text-amber-400 shrink-0" />
          <span className="text-[11px] text-amber-300 font-medium">
            وضع الكابيتشا — انقر على الصورة مباشرةً لحلّ التحقق. التحكم فوري.
          </span>
        </div>
      )}
      {manualMode && (
        <div className="bg-primary/10 border-b border-primary/30 px-3 py-1.5 flex items-center gap-2 shrink-0">
          <Hand size={12} className="text-primary shrink-0" />
          <span className="text-[11px] text-primary/80 font-medium">
            التحكم اليدوي — انقر واكتب مباشرة على المتصفح.
          </span>
        </div>
      )}

      {/* Browser Canvas */}
      <div
        ref={containerRef}
        className="flex-1 relative bg-black overflow-hidden"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        style={{ outline: 'none' }}
      >
        {hasStream ? (
          <>
            <canvas
              ref={canvasRef}
              width={BROWSER_W}
              height={BROWSER_H}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                cursor: isInteractive ? 'crosshair' : 'default',
                userSelect: 'none',
                WebkitUserSelect: 'none' as any,
              }}
              onMouseMove={handleMouseMove}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onWheel={handleWheel}
              onContextMenu={e => e.preventDefault()}
            />
            {isInteractive && debugCoords && (
              <div style={{
                position: 'absolute', bottom: 8, left: 8, zIndex: 30,
                background: 'rgba(0,0,0,0.75)', color: '#ff4444',
                fontFamily: 'monospace', fontSize: 11, padding: '3px 8px',
                borderRadius: 4, border: '1px solid #ff4444',
                pointerEvents: 'none',
              }}>
                🖱 {debugCoords.x} , {debugCoords.y}
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8">
            <img
              src={`${import.meta.env.BASE_URL}images/cortex-bg.png`}
              alt=""
              className="absolute inset-0 w-full h-full object-cover opacity-20 mix-blend-screen"
            />
            <div className="relative z-10 flex flex-col items-center gap-4 p-8 bg-black/60 backdrop-blur-md rounded-2xl border border-white/10">
              <div className="relative">
                <div className="absolute inset-0 rounded-full animate-ping bg-primary/20 blur-xl" />
                <div className="w-16 h-16 rounded-full border border-primary/50 bg-primary/10 flex items-center justify-center">
                  <Monitor size={28} className="text-primary" />
                </div>
              </div>
              <h2 className="text-xl font-display font-bold text-white tracking-wide">
                BROWSER <span className="text-primary">IDLE</span>
              </h2>
              <p className="text-muted-foreground text-xs text-center max-w-xs">
                أرسل مهمة متصفح لعرض البث المباشر — أو اكتب رابطاً في شريط العنوان.
              </p>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
