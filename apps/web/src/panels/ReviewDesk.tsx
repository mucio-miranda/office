import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Check, CloudUpload, CornerLeftUp, ExternalLink, FileText, FolderOpen, Megaphone, RotateCcw, Trash2, X } from 'lucide-react';
import { NETWORKS, NETWORK_LABEL, STAGE_LABEL, type Demand, type Network, type ReviewMark, type StageLogEntry } from '@office/shared';
import { useStore } from '../lib/store';
import { api, getToken, mediaUrl } from '../lib/api';
import { renderMarkdown } from '../lib/markdown';
import { desktop } from '../lib/desktop';

/**
 * Mesa do diretor de arte: as peças de cada etapa e versão lado a lado com o histórico, prévia de imagem, vídeo e
 * texto, e o pedido de ajuste com áreas marcadas direto na imagem (arraste para marcar e diga o que mudar ali).
 */

const IMG = /\.(png|jpe?g|webp|gif)$/i;
const VID = /\.(mp4|mov|webm)$/i;
const TXT = /\.(md|txt)$/i;
const base = (f: string) => f.split(/[\\/]/).pop() ?? f;

/** Entradas da esteira que produziram peças (cada uma é uma versão daquela etapa). */
export const versionsOf = (d: Demand) => (d.stageLog ?? []).filter((e) => e.result === 'feito' && e.files?.length);

export const openFile = (p: string) => {
  if (!desktop) return useStore.getState().notify(`Arquivo: ${p}`);
  desktop.openPath(p).then((err) => { if (err) useStore.getState().notify(`Não consegui abrir ${base(p)}`); });
};

export function TextPreview({ officeId, file }: { officeId: string; file: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const token = getToken();
    fetch(mediaUrl(officeId, file), { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => alive && setText(t))
      .catch(() => alive && setText('(não consegui abrir o arquivo)'));
    return () => { alive = false; };
  }, [officeId, file]);
  return text === null ? <p className="muted small">Carregando…</p> : <div className="review-text md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}

/** Imagem com as áreas marcadas; quando `onMark` existe, arrastar desenha uma área nova. */
function MarkableImage({ src, marks, onMark, offset = 0 }: { src: string; marks: ReviewMark[]; onMark?: (r: Omit<ReviewMark, 'file' | 'note'>) => void; offset?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const at = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const rect = (d: NonNullable<typeof draft>) => ({ x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) });
  return (
    <div ref={box} className={`review-img ${onMark ? 'markable' : ''}`}
      onPointerDown={(e) => { if (!onMark || e.button !== 0) return; e.preventDefault(); (e.target as Element).setPointerCapture(e.pointerId); const p = at(e); setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }}
      onPointerMove={(e) => { if (draft) { const p = at(e); setDraft({ ...draft, x1: p.x, y1: p.y }); } }}
      onPointerUp={() => { if (!draft) return; const r = rect(draft); setDraft(null); if (r.w > 0.02 && r.h > 0.02) onMark?.(r); }}>
      <img src={src} alt="" draggable={false} />
      {marks.map((m, i) => (
        <span key={i} className="review-mark" style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` }}><b>{i + 1 + offset}</b></span>
      ))}
      {draft && (() => { const r = rect(draft); return <span className="review-mark draft" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />; })()}
    </div>
  );
}

export function ReviewDesk({ d, onClose }: { d: Demand; onClose: () => void }) {
  const { office, agents, members, jobs, notify } = useStore();
  const versions = useMemo(() => versionsOf(d), [d]);
  const [sel, setSel] = useState(Math.max(0, versions.length - 1));
  const [marks, setMarks] = useState<ReviewMark[]>([]);
  const [pending, setPending] = useState<Omit<ReviewMark, 'note'> | null>(null);
  const [note, setNote] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setSel(Math.max(0, versions.length - 1)); }, [versions.length]);

  const v: StageLogEntry | undefined = versions[sel];
  const active = jobs.find((j) => j.demandId === d.id && ['fila', 'rodando', 'aguardando'].includes(j.status));
  const waiting = d.stage === 'aprovacao' && d.status === 'aprovacao' && !active;
  // ajustes pedidos antes, com as áreas que marcaram nesta versão
  const past = (d.stageLog ?? []).filter((e) => e.result === 'ajustes' || e.result === 'aprovado');
  const pastMarks = (file: string) => past.flatMap((e) => e.marks ?? []).filter((m) => m.file === file);
  const who = (by: string) => {
    const [k, id] = by.split(':');
    return k === 'agent' ? agents.find((a) => a.id === id)?.name : k === 'user' ? members.find((m) => m.id === id)?.name : 'Office';
  };

  const act = async (name: string, body: object = {}) => {
    setBusy(true);
    try { await api(`/api/offices/${office!.id}/demands/${d.id}/${name}`, { body }); return true; } catch (e) { notify((e as Error).message); return false; } finally { setBusy(false); }
  };
  const sendChanges = async () => {
    const ok = await act('ajustes', { text: text.trim() || 'Ajustes nas áreas marcadas.', marks });
    if (ok) { setMarks([]); setText(''); notify('Ajustes enviados: a equipe vai fazer uma versão nova'); onClose(); }
  };

  return (
    <div className="modal-bg top" onClick={onClose}>
      <div className="modal review" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h3>Mesa do diretor de arte · {d.title}</h3>
          <button type="button" className="icon" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="review-body">
          <div className="review-stage">
            {versions.length > 0 && (
              <div className="review-tabs">
                {versions.map((e, i) => (
                  <button key={i} type="button" className={i === sel ? 'on' : ''} onClick={() => { setSel(i); setPending(null); }}>
                    {STAGE_LABEL[e.stage]} v{e.version ?? 1}
                  </button>
                ))}
              </div>
            )}
            {!v && <p className="muted">Nenhuma peça registrada ainda. Elas aparecem aqui quando um funcionário termina uma etapa.</p>}
            {v && (
              <div className="review-files">
                {v.files!.map((f) => (
                  <figure key={f} className="review-file">
                    {IMG.test(f) ? (
                      <MarkableImage src={mediaUrl(office!.id, f)} offset={0}
                        marks={[...pastMarks(f), ...marks.filter((m) => m.file === f)]}
                        onMark={waiting && sel === versions.length - 1 ? (r) => { setPending({ ...r, file: f }); setNote(''); } : undefined} />
                    ) : VID.test(f) ? (
                      <video src={mediaUrl(office!.id, f)} controls preload="metadata" />
                    ) : TXT.test(f) ? (
                      <TextPreview officeId={office!.id} file={f} />
                    ) : (
                      <div className="review-other"><FileText size={28} /><span>{base(f)}</span></div>
                    )}
                    <figcaption>
                      <span className="truncate" title={f}>{base(f)}</span>
                      <button type="button" className="icon" title="Abrir no app" onClick={() => openFile(f)}><ExternalLink size={13} /></button>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>
          <aside className="review-side">
            {v && <p className="review-summary">{v.text}</p>}
            {waiting ? (
              <div className="col gap-s">
                <b>Sua revisão</b>
                {versions.some((e) => e.files!.some((f) => IMG.test(f))) && <p className="muted small" style={{ margin: 0 }}>Arraste sobre a imagem para marcar uma área e diga o que mudar ali.</p>}
                {pending && (
                  <div className="review-pending">
                    <input autoFocus placeholder="O que mudar nesta área?" value={note} onChange={(e) => setNote(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); if (e.key === 'Enter' && note.trim()) { setMarks([...marks, { ...pending, note: note.trim() }]); setPending(null); } if (e.key === 'Escape') setPending(null); }} />
                    <button type="button" className="primary small" disabled={!note.trim()} onClick={() => { setMarks([...marks, { ...pending, note: note.trim() }]); setPending(null); }}>Marcar</button>
                  </div>
                )}
                {marks.length > 0 && (
                  <ol className="review-marks">
                    {marks.map((m, i) => (
                      <li key={i}><span><b>{pastMarks(m.file).length + marks.filter((x, k) => x.file === m.file && k < i).length + 1}</b> {base(m.file)}: {m.note}</span>
                        <button type="button" className="icon" title="Tirar" onClick={() => setMarks(marks.filter((_, k) => k !== i))}><Trash2 size={12} /></button></li>
                    ))}
                  </ol>
                )}
                <textarea rows={3} placeholder="Comentário geral (opcional se marcou áreas)" value={text} onChange={(e) => setText(e.target.value)} />
                <div className="row gap end">
                  <button type="button" className="ghost small" disabled={busy || (!marks.length && text.trim().length < 3)} onClick={sendChanges}><RotateCcw size={13} /> Pedir ajustes</button>
                  <button type="button" className="primary small" disabled={busy || marks.length > 0} title={marks.length ? 'Há áreas marcadas: mande os ajustes ou tire as marcas' : undefined}
                    onClick={async () => { if (await act('aprovar')) { notify('Aprovado'); onClose(); } }}><Check size={13} /> Aprovar</button>
                </div>
              </div>
            ) : (
              <p className="muted small">{active ? 'Um funcionário está trabalhando nesta demanda.' : d.stage === 'agendado' ? 'Aprovada. Agende a publicação na demanda.' : 'A revisão abre quando a demanda chegar na aprovação.'}</p>
            )}
            {past.length > 0 && (
              <ol className="stage-log">
                {[...past].reverse().map((e, i) => (
                  <li key={i} className={`r-${e.result}`}><b>{e.result === 'aprovado' ? 'Aprovado' : 'Ajustes'} · {who(e.by) ?? '—'}</b><p>{e.text}</p></li>
                ))}
              </ol>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const localInput = (t: Date) => `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;

/** Agendamento da publicação de uma demanda aprovada, e o "publicado" depois de postar. */
export function PublishBox({ d }: { d: Demand }) {
  const { office, notify } = useStore();
  const [form, setForm] = useState<{ at: string; networks: Network[]; caption: string; files: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const p = d.publish;
  const url = `/api/offices/${office!.id}/demands/${d.id}`;

  const openForm = async () => {
    const draft = await api<{ files: string[]; caption: string }>(`${url}/pacote`).catch(() => ({ files: [], caption: '' }));
    const t = new Date(Date.now() + 24 * 3600_000);
    t.setHours(18, 0, 0, 0);
    setForm({
      at: p?.at ?? localInput(t), networks: p?.networks ?? [d.kind === 'video' ? 'instagram-reels' : 'instagram-feed'],
      caption: draft.caption, files: p?.files ?? draft.files,
    });
  };
  const act = async (name: string, body: object = {}) => {
    setBusy(true);
    try { await api(`${url}/${name}`, { body }); return true; } catch (e) { notify((e as Error).message); return false; } finally { setBusy(false); }
  };

  if (form) {
    return (
      <div className="publish col gap-s">
        <b className="row gap"><CalendarClock size={14} /> Agendar publicação</b>
        <label>Quando<input type="datetime-local" onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} value={form.at} onChange={(e) => setForm({ ...form, at: e.target.value })} /></label>
        <div className="publish-nets">
          {NETWORKS.map((n) => (
            <label key={n} className="check"><input type="checkbox" checked={form.networks.includes(n)}
              onChange={(e) => setForm({ ...form, networks: e.target.checked ? [...form.networks, n] : form.networks.filter((x) => x !== n) })} />{NETWORK_LABEL[n]}</label>
          ))}
        </div>
        <label>Legenda<textarea rows={5} value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} /></label>
        <div className="muted small">{form.files.length ? <>Peças: {form.files.map(base).join(', ')}</> : 'Nenhuma peça registrada: o pacote sai só com a legenda.'}</div>
        <div className="row gap end">
          <button type="button" className="ghost small" onClick={() => setForm(null)}>Cancelar</button>
          <button type="button" className="primary small" disabled={busy || !form.networks.length || !form.at}
            onClick={async () => { if (await act('agendar', form)) { setForm(null); notify('Publicação agendada no calendário'); } }}><CalendarClock size={13} /> Agendar</button>
        </div>
      </div>
    );
  }
  if (!p) {
    return (
      <div className="approval">
        <span>Aprovada. Falta agendar a publicação.</span>
        <button type="button" className="primary small" onClick={openForm}><CalendarClock size={13} /> Agendar publicação</button>
      </div>
    );
  }
  const when = new Date(p.at).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return (
    <div className={`approval ${p.status === 'publicado' ? 'done' : ''}`}>
      <span>
        {p.status === 'publicado'
          ? <>Publicado em {new Date(p.publishedAt!).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.</>
          : <>Agendada para {when} · {p.networks.map((n) => NETWORK_LABEL[n]).join(', ')}</>}
      </span>
      <div className="row gap">
        {p.folder && desktop && <button type="button" className="ghost small" title={p.folder} onClick={() => openFile(p.folder!)}><FolderOpen size={13} /> Pacote</button>}
        {p.status !== 'publicado' && <button type="button" className="ghost small" onClick={openForm}>Reagendar</button>}
        {p.status !== 'publicado' && <button type="button" className="primary small" disabled={busy} onClick={() => act('publicado')}><Megaphone size={13} /> Marcar como publicado</button>}
      </div>
    </div>
  );
}

const gb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} GB` : `${Math.max(1, Math.round(n / 1024 ** 2))} MB`);

interface DriveDraft { ok: boolean; root: string | null; free: number; folder: string; files: { file: string; sub: string; size: number }[] }
interface DriveResult { sent: unknown[]; skipped: unknown[]; failed: { file: string; error: string }[] }

/** Botão que manda o trabalho aprovado para o Drive: a pessoa escolhe a pasta do cliente e as peças. Só copia. */
export function DriveBox({ d }: { d: Demand }) {
  const { office, notify } = useStore();
  const [draft, setDraft] = useState<DriveDraft | null>(null);
  const [folder, setFolder] = useState('');
  const [items, setItems] = useState<{ file: string; sub: string; size: number; on: boolean }[]>([]);
  const [dirs, setDirs] = useState<{ parent: string | null; dirs: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const url = `/api/offices/${office!.id}`;
  const last = [...(d.stageLog ?? [])].reverse().find((e) => e.drive);

  const open = async () => {
    try {
      const r = await api<DriveDraft>(`${url}/demands/${d.id}/drive`);
      setDraft(r);
      setFolder(r.folder);
      // PSD fica de fora por padrão: pesa e a equipe só precisa dele para editar
      setItems(r.files.map((f) => ({ ...f, on: !/\.psd$/i.test(f.file) })));
    } catch (e) { notify((e as Error).message); }
  };
  useEffect(() => {
    if (!draft?.ok) return;
    let alive = true;
    api<{ parent: string | null; dirs: string[] }>(`${url}/drive/pastas?rel=${encodeURIComponent(folder)}`).then((r) => alive && setDirs(r)).catch(() => alive && setDirs(null));
    return () => { alive = false; };
  }, [draft?.ok, folder, url]);

  const chosen = items.filter((i) => i.on);
  const size = chosen.reduce((n, i) => n + i.size, 0);
  const send = async () => {
    setBusy(true);
    try {
      const r = await api<DriveResult>(`${url}/demands/${d.id}/drive`, { body: { folder, items: chosen.map(({ file, sub }) => ({ file, sub })) } });
      notify(r.failed.length ? `${r.sent.length} enviado(s), ${r.failed.length} com erro: ${r.failed[0].error}` : r.sent.length ? `${r.sent.length} arquivo(s) no Drive` : 'Esses arquivos já estavam no Drive');
      if (!r.failed.length) setDraft(null);
    } catch (e) { notify((e as Error).message); } finally { setBusy(false); }
  };

  if (!draft) {
    return (
      <div className={`approval ${last ? 'done' : ''}`}>
        <span>{last ? last.text : 'Envie as peças aprovadas para a equipe no Drive.'}</span>
        <button type="button" className={last ? 'ghost small' : 'primary small'} onClick={open}><CloudUpload size={13} /> Enviar ao Drive</button>
      </div>
    );
  }
  if (!draft.ok) {
    return (
      <div className="approval">
        <span>{draft.root ? `Não encontrei a pasta do Drive (${draft.root}). O Google Drive para computador está aberto?` : 'Defina a pasta do Drive em Equipe > Pastas do escritório.'}</span>
        <button type="button" className="ghost small" onClick={() => setDraft(null)}>Fechar</button>
      </div>
    );
  }
  const go = (name: string) => setFolder(folder ? `${folder}/${name}` : name);
  return (
    <div className="publish col gap-s">
      <b className="row gap"><CloudUpload size={14} /> Enviar ao Drive</b>
      <label>Pasta do cliente no Drive<input className="mono" value={folder} spellCheck={false} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} onChange={(e) => setFolder(e.target.value)} /></label>
      {dirs && (dirs.parent !== null || dirs.dirs.length > 0) && (
        <div className="drive-dirs">
          {dirs.parent !== null && <button type="button" className="chip" onClick={() => setFolder(dirs.parent!)}><CornerLeftUp size={12} /> Voltar</button>}
          {dirs.dirs.map((n) => <button type="button" key={n} className="chip" onClick={() => go(n)}>{n}</button>)}
        </div>
      )}
      {dirs && !dirs.dirs.length && dirs.parent !== null && <p className="muted small" style={{ margin: 0 }}>Se esta pasta ainda não existir, ela é criada no envio.</p>}
      {items.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nenhuma peça registrada nesta demanda.</p>}
      {items.map((it, i) => (
        <div key={it.file} className="drive-file">
          <label className="check"><input type="checkbox" checked={it.on} onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, on: e.target.checked } : x)))} /><span className="truncate" title={it.file}>{base(it.file)}</span></label>
          <input className="mono" aria-label={`Subpasta de ${base(it.file)}`} value={it.sub} spellCheck={false} disabled={!it.on} onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, sub: e.target.value } : x)))} />
        </div>
      ))}
      <div className={`small ${size > draft.free ? 'st-erro' : 'muted'}`}>{gb(size)} no envio · {gb(draft.free)} livres no Drive. Nada é apagado nem sobrescrito lá.</div>
      <div className="row gap end">
        <button type="button" className="ghost small" onClick={() => setDraft(null)}>Cancelar</button>
        <button type="button" className="primary small" disabled={busy || !chosen.length || !folder.trim() || size > draft.free} onClick={send}><CloudUpload size={13} /> {busy ? 'Enviando…' : `Enviar ${chosen.length} arquivo(s)`}</button>
      </div>
    </div>
  );
}
