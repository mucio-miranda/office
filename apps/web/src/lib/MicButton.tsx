import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Square } from 'lucide-react';
import { getToken } from './api';

/**
 * Microfone do chat: clica, fala e clica de novo. O áudio é transcrito no próprio computador (whisper.cpp) e o texto entra
 * na caixa de mensagem para conferir antes de enviar. Nada é enviado sozinho.
 */
export function MicButton({ officeId, onText, onError }: { officeId: string; onText: (t: string) => void; onError: (m: string) => void }) {
  const [state, setState] = useState<'parado' | 'gravando' | 'transcrevendo'>('parado');
  const [secs, setSecs] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { stopTracks(); if (timer.current) clearInterval(timer.current); }, []);
  const stopTracks = () => rec.current?.stream.getTracks().forEach((t) => t.stop());

  const start = async () => {
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { onError('Não consegui abrir o microfone. Confira se ele está conectado e liberado no Windows (Privacidade > Microfone).'); return; }
    const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    r.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
      setState('transcrevendo');
      try {
        const token = getToken();
        const res = await fetch(`/api/offices/${officeId}/transcrever`, {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: blob,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
        if (data.texto) onText(data.texto); else onError('Não entendi nada no áudio. Tente falar mais perto do microfone.');
      } catch (e) { onError((e as Error).message); }
      setState('parado');
    };
    rec.current = r;
    r.start();
    setSecs(0);
    timer.current = window.setInterval(() => setSecs((s) => {
      // limite de 5 min por gravação
      if (s + 1 >= 300) r.state === 'recording' && r.stop();
      return s + 1;
    }), 1000);
    setState('gravando');
  };

  const stop = () => { if (rec.current?.state === 'recording') rec.current.stop(); };

  if (state === 'transcrevendo') return <button type="button" className="small icon-only" disabled aria-label="Transcrevendo o áudio"><Loader2 size={14} className="spin" /></button>;
  if (state === 'gravando') {
    return (
      <button type="button" className="small mic-on" onClick={stop} aria-label="Parar a gravação e transcrever">
        <Square size={12} /> {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
      </button>
    );
  }
  return <button type="button" className="small icon-only" onClick={start} aria-label="Falar o pedido" title="Falar o pedido (o texto entra na caixa para conferir)"><Mic size={14} /></button>;
}
