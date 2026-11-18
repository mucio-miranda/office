import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Navigation, Video } from 'lucide-react';
import { useStore } from '../lib/store';
import { goToPerson } from '../office/World';
import { ROOMS } from '../office/layout';

/**
 * Conversa direta com uma pessoa da equipe: só as duas leem. A chamada de vídeo entra aqui depois (o botão já tem
 * lugar), como está no roadmap.
 */
export function PersonChat() {
  const { panelArg, members, presences, user, dms, loadDm, sendDm, markDmRead } = useStore();
  const person = members.find((m) => m.id === panelArg);
  const list = dms[panelArg ?? ''];
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (panelArg) loadDm(panelArg); }, [panelArg]); // eslint-disable-line react-hooks/exhaustive-deps
  // aberta, a conversa fica lida: inclusive o que chega enquanto ela está na tela
  useEffect(() => { if (panelArg && list) markDmRead(panelArg); }, [panelArg, list?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { box.current?.scrollTo(0, box.current.scrollHeight); }, [list?.length]);

  if (!person) return <div className="empty"><p>Essa pessoa não está neste escritório.</p></div>;
  const pr = presences[person.id];
  const where = pr ? ROOMS.find((r) => r.id === pr.room)?.label ?? 'no escritório' : 'fora do escritório';
  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    if (await sendDm(person.id, t)) setText('');
    setSending(false);
  };
  const day = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="dm-page">
      <header className="dm-head">
        <span className={`avatar ${pr ? `ps-${pr.status}` : 'ps-ausente'}`} style={{ background: person.color }}>{person.name[0]}<span className="status-dot" /></span>
        <div className="dm-who">
          <b>{person.name} <span className="who-badge human">Humano</span></b>
          <span className="muted small">{where}</span>
        </div>
        <span className="spacer" />
        {pr && <button className="ghost small" onClick={() => goToPerson(pr)}><Navigation size={13} /> Ir até</button>}
        <button className="ghost small" disabled title="Chamada de vídeo: em breve"><Video size={13} /> Vídeo</button>
      </header>
      <div className="dm-list" ref={box}>
        {!list && <p className="muted small">Carregando…</p>}
        {list && list.length === 0 && <p className="muted small dm-empty">Comece a conversa com {person.name}. Só vocês dois veem estas mensagens.</p>}
        {list?.map((m, i) => {
          const mine = m.fromUser === user?.id;
          const newDay = i === 0 || day(list[i - 1].createdAt) !== day(m.createdAt);
          return (
            <div key={m.id} className="dm-item">
              {newDay && <div className="dm-day muted small">{day(m.createdAt)}</div>}
              <div className={`dm-msg ${mine ? 'mine' : ''}`}>
                <div className="dm-bubble">{m.text}</div>
                <span className="dm-time muted">{time(m.createdAt)}{mine && m.readAt ? ' · lida' : ''}</span>
              </div>
            </div>
          );
        })}
      </div>
      <form className="dm-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea rows={2} value={text} placeholder={`Mensagem para ${person.name}`} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="primary small" disabled={!text.trim() || sending}><ArrowUp size={14} /> Enviar</button>
      </form>
    </div>
  );
}
