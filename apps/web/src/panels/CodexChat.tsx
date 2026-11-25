import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Turn { seq: number; prompt: string; answer: string }
export function CodexChat({ url, writable }: { url: string; writable: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const reload = () => api<Turn[]>(url).then(items => { if (active) setTurns(items); }).catch(e => { if (active) setError(e.message); });
    void reload();
    const timer = setInterval(reload, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [url]);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api(url, { body: { text } });
      setText('');
      setTurns(await api<Turn[]>(url));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="card" style={{ flex: 1, overflow: 'auto', padding: 16 }}>
    <h3>GPT Codex · Consulta</h3>
    <p className="muted small">Consulta o briefing e as skills em modo de leitura. Produção de arquivos e navegador ficam para uma sessão de produção.</p>
    {turns.map(t => <article key={t.seq} style={{ whiteSpace: 'pre-wrap' }}><p><b>Equipe</b> · {t.prompt}</p><p><b>GPT Codex</b> · {t.answer}</p></article>)}
    {writable && <form onSubmit={send}>
      <textarea aria-label="Mensagem para GPT Codex" placeholder="/fluxo-trabalho Onde ficam os temporários?" maxLength={16000}
        value={text} disabled={busy} onChange={e => setText(e.target.value)} />
      <button className="primary" disabled={busy || !text.trim()}>{busy ? 'Consultando…' : 'Enviar'}</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
