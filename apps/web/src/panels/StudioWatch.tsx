import { useEffect, useRef, useState } from 'react';
import type { AgentJob } from '@office/shared';
import { MessageSquarePlus, Send, Square } from 'lucide-react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';

/**
 * TV do estúdio: o vídeo que o funcionário está editando, prévia por prévia, assim que cada uma sai do render (ou
 * cada quadro que ele abre para conferir). Quem assiste pausa no ponto, comenta no minuto exato e o comentário entra
 * no próximo passo dele, sem parar o trabalho.
 */

interface Preview { path: string; at: string; kind: 'video' | 'imagem'; size: number; mtime: number }

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const base = (p: string) => p.split(/[\\/]/).pop() ?? p;
const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `há ${s}s` : s < 3600 ? `há ${Math.round(s / 60)} min` : `há ${Math.round(s / 3600)} h`;
};

export function StudioWatch({ job }: { job: AgentJob }) {
  const { office, agents, clients, notify } = useStore();
  const url = `/api/offices/${office!.id}/jobs/${job.id}`;
  const [list, setList] = useState<Preview[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [text, setText] = useState('');
  const [at, setAt] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const agent = agents.find((a) => a.id === job.agentId);
  const client = clients.find((c) => c.id === job.clientId);
  const running = job.status === 'rodando' || job.status === 'fila';

  // a lista chega por consulta curta: barata e só enquanto alguém está olhando
  useEffect(() => {
    let alive = true;
    const load = () => api<Preview[]>(`${url}/previas`).then((l) => { if (alive) setList(l); }).catch(() => {});
    load();
    const t = setInterval(load, running ? 2500 : 10000);
    return () => { alive = false; clearInterval(t); };
  }, [url, running]);

  // seguindo o trabalho: cada prévia nova entra no lugar da anterior (pausar ou escolher uma antiga para de seguir)
  const latest = list[0];
  const shown = (follow ? latest : list.find((p) => p.path === pick)) ?? latest;
  const src = shown ? `${url}/previas/arquivo?path=${encodeURIComponent(shown.path)}&v=${shown.mtime}` : null;

  const choose = (p: Preview) => { setPick(p.path); setFollow(p.path === latest?.path); setAt(null); };
  const markHere = () => {
    const v = video.current;
    if (v) { v.pause(); setAt(v.currentTime); setFollow(false); setPick(shown?.path ?? null); }
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    const where = shown ? (shown.kind === 'video' && at !== null ? `No vídeo ${shown.path}, em ${fmt(at)} (${at.toFixed(1)} s): ` : `Sobre ${shown.path}: `) : '';
    setSending(true);
    try {
      await api(`${url}/comentar`, { body: { text: where + body } });
      setText(''); setAt(null);
      notify(running ? `${agent?.name ?? 'Funcionário'} lê no próximo passo` : 'Enviado');
    } catch (e) { notify((e as Error).message); }
    setSending(false);
  };

  return (
    <div className="watch">
      <div className="watch-head">
        <span className={`live-dot ${running ? 'ativa' : 'livre'}`} />
        <b>{agent?.name ?? 'Funcionário'}</b>
        <span className="muted small">{client?.name ?? 'tarefa avulsa'} · {running ? 'editando agora' : job.status === 'aguardando' ? 'esperando resposta' : job.status}</span>
        <span className="spacer" />
        {shown && <span className="muted small mono" title={shown.path}>{base(shown.path)} · {ago(shown.at)}</span>}
        {!follow && latest && <button className="small ghost" onClick={() => { setFollow(true); setAt(null); }}>Seguir o último</button>}
        {running && <button className="small ghost" title="Parar a tarefa" onClick={() => api(`${url}/cancel`, { body: {} })}><Square size={12} /> Parar</button>}
      </div>
      <div className="watch-screen">
        {!shown ? (
          <div className="muted small watch-empty">
            Nenhuma prévia ainda. Assim que {agent?.name ?? 'ele'} renderizar um trecho ou abrir um quadro para conferir, aparece aqui.
          </div>
        ) : shown.kind === 'video' ? (
          <video key={src} ref={video} src={src!} controls autoPlay muted={follow} playsInline onPause={(e) => { if (follow && !e.currentTarget.ended) { setFollow(false); setPick(shown.path); } }} />
        ) : (
          <img key={src} src={src!} alt={base(shown.path)} />
        )}
      </div>
      {list.length > 1 && (
        <div className="watch-strip">
          {list.map((p) => (
            <button key={p.path + p.mtime} className={`watch-thumb ${p.path === shown?.path ? 'active' : ''}`} title={p.path} onClick={() => choose(p)}>
              {p.kind === 'video'
                ? <video src={`${url}/previas/arquivo?path=${encodeURIComponent(p.path)}&v=${p.mtime}#t=0.5`} preload="metadata" muted />
                : <img src={`${url}/previas/arquivo?path=${encodeURIComponent(p.path)}&v=${p.mtime}`} alt="" loading="lazy" />}
              <small>{base(p.path)}</small>
            </button>
          ))}
        </div>
      )}
      <form className="watch-say" onSubmit={(e) => { e.preventDefault(); send(); }}>
        {shown?.kind === 'video' && (
          <button type="button" className="small ghost" title="Pausa e prende o comentário neste minuto" onClick={markHere}>
            <MessageSquarePlus size={13} /> {at !== null ? `Em ${fmt(at)}` : 'Comentar neste ponto'}
          </button>
        )}
        <input value={text} onChange={(e) => setText(e.target.value)} disabled={job.status !== 'rodando' && job.status !== 'fila' && job.status !== 'aguardando'}
          placeholder={running ? 'Ex.: corta essa pausa, a legenda está atrasada, troca esse b-roll… ele lê no próximo passo' : 'Responder'} />
        <button type="submit" className="primary small" disabled={!text.trim() || sending}><Send size={13} /> Enviar</button>
      </form>
    </div>
  );
}
