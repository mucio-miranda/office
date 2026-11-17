import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, FolderOpen, Play, RotateCcw, Wand2 } from 'lucide-react';
import {
  CHECK_STATE_LABEL, MONTH_STEPS, MONTH_STEP_LABEL, POST_FORMAT_LABEL, canWork,
  type CheckState, type ContentPost, type MonthPiece, type MonthRow, type MonthStep, type RenamePlan,
} from '@office/shared';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { usePersisted } from '../lib/persisted';
import { desktop } from '../lib/desktop';

/**
 * Gestão mensal do squad: cada cliente com as quatro etapas do mês (ensaio, conteúdo feito, aprovado, programado) e,
 * ao abrir um cliente, as peças da pasta do mês para arrastar até os dias do calendário. "Aplicar na pasta" renomeia os
 * arquivos no padrão `NN AAAA-MM-DD Formato – Tema – LL` (com prévia e desfazer).
 */

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ym = (d: Date) => ymd(d).slice(0, 7);
const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const NEXT: Record<CheckState, CheckState> = { pendente: 'andamento', andamento: 'ok', ok: 'na', na: 'pendente' };
const COLOR: Record<CheckState, string> = { pendente: 'var(--muted-foreground)', andamento: 'var(--waiting)', ok: 'var(--done)', na: 'var(--border)' };
const base = (f: string) => f.split(/[\\/]/).pop() ?? f;
const thumbUrl = (officeId: string, file: string, w = 240) => `/api/offices/${officeId}/thumb?w=${w}&path=${encodeURIComponent(file)}`;

/** O que o número automático diz sobre a etapa, para mostrar ao lado do estado marcado à mão. */
function autoText(step: MonthStep, r: MonthRow) {
  const a = r.auto;
  if (step === 'ensaio') return a.fotosEnsaio ? `${a.fotosEnsaio} fotos` : '';
  if (step === 'feito') return a.posts ? `${a.feitos}/${a.posts} posts` : a.pecas ? `${a.pecas} peças na pasta` : '';
  if (step === 'aprovado') return a.posts ? `${a.aprovados}/${a.posts}` : '';
  return a.posts ? `${a.programados}/${a.posts}${a.postados ? ` · ${a.postados} no ar` : ''}` : '';
}
/** Sugestão quando ninguém marcou ainda: tudo do mês feito/aprovado/programado vira "ok" sugerido. */
function suggested(step: MonthStep, r: MonthRow): CheckState | null {
  const a = r.auto;
  if (step === 'ensaio') return a.fotosEnsaio ? 'ok' : null;
  if (!a.posts) return null;
  const n = step === 'feito' ? a.feitos : step === 'aprovado' ? a.aprovados : a.programados;
  return n >= a.posts ? 'ok' : n > 0 ? 'andamento' : null;
}

export function MonthPanel() {
  const { office, monthsRev, notify, panelArg } = useStore();
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [data, setData] = useState<{ squads: { id: string; nome: string }[]; rows: MonthRow[] } | null>(null);
  const [squad, setSquad] = usePersisted<string>('office.mes.squad', '');
  const [openId, setOpenId] = useState<string | null>(panelArg);
  const mes = ym(cursor);
  const can = !!office && canWork(office.role);

  useEffect(() => {
    if (!office) return;
    let off = false;
    api(`/api/offices/${office.id}/mes/${mes}`).then((d) => !off && setData(d)).catch((e) => notify((e as Error).message));
    return () => { off = true; };
  }, [office?.id, mes, monthsRev]);

  const rows = useMemo(() => (data?.rows ?? []).filter((r) => !squad || (squad === '-' ? !r.squad : r.squad === squad)), [data, squad]);
  const shift = (n: number) => { const d = new Date(cursor); d.setMonth(d.getMonth() + n); setCursor(d); };
  const label = cursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const setCheck = async (r: MonthRow, step: MonthStep, state: CheckState, note?: string) => {
    if (!office || !can) return;
    try { await api(`/api/offices/${office.id}/clients/${r.client.id}/mes/${mes}`, { method: 'PUT', body: { step, state, ...(note !== undefined ? { note } : {}) } }); }
    catch (e) { notify((e as Error).message); }
  };

  const openRow = rows.find((r) => r.client.id === openId) ?? data?.rows.find((r) => r.client.id === openId);
  if (openRow && office) return <MonthOrganizer row={openRow} mes={mes} label={label} onBack={() => setOpenId(null)} onShift={shift} />;

  const done = (r: MonthRow) => MONTH_STEPS.filter((s) => (r.month.checks[s]?.state ?? suggested(s, r)) === 'ok' || r.month.checks[s]?.state === 'na').length;

  return (
    <div className="month">
      <div className="row between month-top">
        <div className="row gap">
          <button className="icon" onClick={() => shift(-1)} aria-label="Mês anterior"><ChevronLeft size={16} /></button>
          <h3 className="cap">{label}</h3>
          <button className="icon" onClick={() => shift(1)} aria-label="Próximo mês"><ChevronRight size={16} /></button>
        </div>
        <select className="small" value={squad} onChange={(e) => setSquad(e.target.value)} aria-label="Squad">
          <option value="">Todos os squads</option>
          {data?.squads.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          <option value="-">Sem squad</option>
        </select>
      </div>
      <p className="muted small-print">Clique no estado para avançar (pendente → em andamento → ok → não se aplica). Os números ao lado vêm do calendário e da pasta do mês.</p>
      <div className="month-grid" role="table">
        <div className="mg-row mg-head" role="row">
          <span role="columnheader">Cliente</span>
          {MONTH_STEPS.map((s) => <span key={s} role="columnheader">{MONTH_STEP_LABEL[s]}</span>)}
          <span role="columnheader">Mês</span>
        </div>
        {!data && <p className="muted">Carregando…</p>}
        {data && !rows.length && <p className="muted">Nenhum cliente ativo neste filtro.</p>}
        {rows.map((r) => (
          <div className="mg-row" role="row" key={r.client.id}>
            <button className="mg-client" onClick={() => setOpenId(r.client.id)} title="Abrir as peças do mês">
              <i style={{ background: r.client.color }} />
              <span>{r.client.name}</span>
              {!r.auto.pasta && <small className="muted">sem pasta do mês</small>}
            </button>
            {MONTH_STEPS.map((s) => {
              const c = r.month.checks[s];
              const sug = !c ? suggested(s, r) : null;
              const st: CheckState = c?.state ?? sug ?? 'pendente';
              return (
                <div className="mg-cell" key={s} role="cell">
                  <button
                    className={`check-pill ${c ? '' : 'sug'}`} style={{ '--c': COLOR[st] } as React.CSSProperties} disabled={!can}
                    title={c ? `${CHECK_STATE_LABEL[st]}${c.note ? ` · ${c.note}` : ''} (${c.by?.startsWith('user:') ? 'marcado' : 'auto'} ${c.at ? new Date(c.at).toLocaleDateString('pt-BR') : ''})` : sug ? 'Sugestão automática: clique para confirmar' : 'pendente'}
                    onClick={() => setCheck(r, s, c ? NEXT[st] : (sug ?? 'andamento'))}
                    onContextMenu={(e) => { e.preventDefault(); const note = prompt(`Nota para ${MONTH_STEP_LABEL[s]} (${r.client.name})`, c?.note ?? ''); if (note !== null) setCheck(r, s, st, note); }}
                  >
                    <i />{CHECK_STATE_LABEL[st]}
                  </button>
                  <small className="muted">{autoText(s, r)}{c?.note ? ` · ${c.note}` : ''}</small>
                </div>
              );
            })}
            <div className="mg-cell" role="cell"><span className="badge">{done(r)}/4</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface PiecesData { dir: string | null; exists: boolean; pieces: MonthPiece[]; posts: ContentPost[]; postDays: number[]; plan: { plan: RenamePlan[]; skipped: string[] } }

function MonthOrganizer({ row, mes, label, onBack, onShift }: { row: MonthRow; mes: string; label: string; onBack: () => void; onShift: (n: number) => void }) {
  const { office, monthsRev, notify } = useStore();
  const [d, setD] = useState<PiecesData | null>(null);
  const [drag, setDrag] = useState<MonthPiece | null>(null);
  const [preview, setPreview] = useState(false);
  const [lastUndo, setLastUndo] = useState<string | null>(null);
  const can = !!office && canWork(office.role);
  const url = `/api/offices/${office!.id}/clients/${row.client.id}/mes/${mes}`;

  useEffect(() => {
    let off = false;
    setD(null);
    api<PiecesData>(`${url}/pecas`).then((x) => !off && setD(x)).catch((e) => notify((e as Error).message));
    return () => { off = true; };
  }, [url, monthsRev]);

  const first = new Date(`${mes}-01T12:00:00`);
  const start = new Date(first); start.setDate(1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => { const x = new Date(start); x.setDate(start.getDate() + i); return x; });
  const today = ymd(new Date());
  const postDays = d?.postDays ?? [1, 3, 5];

  const assign = async (p: MonthPiece, date: string | null) => {
    if (!can) return;
    try {
      await api(`${url}/atribuir`, { body: { files: p.files, date, format: p.format, theme: p.theme, posted: p.posted } });
    } catch (e) { notify((e as Error).message); }
  };
  const apply = async () => {
    try {
      const r = await api<{ id: string | null; renamed: RenamePlan[]; skipped: string[] }>(`${url}/aplicar`, { body: {} });
      setPreview(false);
      setLastUndo(r.id);
      notify(r.renamed.length ? `${r.renamed.length} arquivos renomeados na pasta do mês.` : 'A pasta já estava no padrão.');
    } catch (e) { notify((e as Error).message); }
  };
  const undo = async () => {
    if (!lastUndo) return;
    try { const r = await api<{ undone: number }>(`/api/offices/${office!.id}/renomeacoes/${lastUndo}/desfazer`, { body: {} }); setLastUndo(null); notify(`${r.undone} nomes voltaram ao que eram.`); }
    catch (e) { notify((e as Error).message); }
  };

  const pieces = d?.pieces ?? [];
  const onDay = (date: string) => pieces.filter((p) => p.date === date && (p.postId || !p.loose));
  const undated = pieces.filter((p) => !p.date || (p.loose && !p.postId));
  const outside = pieces.filter((p) => p.date && p.date.slice(0, 7) !== mes && (p.postId || !p.loose));

  const Piece = ({ p, small }: { p: MonthPiece; small?: boolean }) => {
    const img = p.files.find((f) => /\.(png|jpe?g|webp)$/i.test(f)) ?? p.files[0];
    return (
      <div
        className={`piece ${small ? 'sm' : ''} ${p.posted ? 'posted' : ''} ${p.loose && !p.postId ? 'loose' : ''}`} draggable={can}
        onDragStart={(e) => { setDrag(p); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDrag(null)}
        title={`${p.files.map(base).join('\n')}${p.posted ? '\n(postado)' : ''}`}
      >
        <div className="thumb">
          {img && <img src={thumbUrl(office!.id, img, small ? 120 : 240)} alt="" loading="lazy" />}
          {p.files.some((f) => /\.(mp4|mov)$/i.test(f)) && <Play size={14} className="play" />}
          {p.files.length > 1 && <span className="count">{p.files.length}</span>}
        </div>
        {!small && (
          <div className="meta">
            <b>{p.number ? `${String(p.number).padStart(2, '0')} ` : ''}{p.theme}</b>
            <small className="muted">{p.format ? POST_FORMAT_LABEL[p.format] : 'formato ?'}{p.posted ? ' · postado' : ''}{p.date ? ` · ${p.date.slice(8)}/${p.date.slice(5, 7)}` : ''}</small>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="month organizer">
      <div className="row between month-top">
        <div className="row gap">
          <button className="icon" onClick={onBack} aria-label="Voltar"><ArrowLeft size={16} /></button>
          <i className="dot" style={{ background: row.client.color }} />
          <h3>{row.client.name}</h3>
          <button className="icon" onClick={() => onShift(-1)} aria-label="Mês anterior"><ChevronLeft size={16} /></button>
          <span className="cap">{label}</span>
          <button className="icon" onClick={() => onShift(1)} aria-label="Próximo mês"><ChevronRight size={16} /></button>
        </div>
        <div className="row gap">
          {d?.dir && desktop && <button className="small" onClick={() => desktop!.openPath(d.dir!)}><FolderOpen size={14} /> Abrir pasta</button>}
          {lastUndo && <button className="small" onClick={undo}><RotateCcw size={14} /> Desfazer nomes</button>}
          {can && <button className="small primary" disabled={!d?.plan.plan.length} onClick={() => setPreview(true)} title="Renomeia os arquivos no padrão do squad"><Wand2 size={14} /> Aplicar na pasta{d?.plan.plan.length ? ` (${d.plan.plan.length})` : ''}</button>}
        </div>
      </div>
      {d && !d.exists && <p className="muted">A pasta do mês ainda não existe: {d.dir ?? 'Drive não configurado'}.</p>}

      {preview && d && (
        <div className="card rename-preview">
          <div className="card-head"><h4>Prévia dos nomes ({d.plan.plan.length})</h4><button className="small" onClick={() => setPreview(false)}>Cancelar</button></div>
          <ul>{d.plan.plan.map((r) => <li key={r.from}><s className="muted">{base(r.from)}</s> → {base(r.to)}</li>)}</ul>
          {!!d.plan.skipped.length && <p className="muted">Ficam como estão: {d.plan.skipped.join(' · ')}</p>}
          <p className="muted">Nada é apagado nem muda de pasta. Depois dá para desfazer.</p>
          <button className="primary" onClick={apply}>Renomear {d.plan.plan.length} arquivos</button>
        </div>
      )}

      <div className="org-body">
        <aside
          className={`org-pieces ${drag ? 'drop' : ''}`}
          onDragOver={(e) => drag && e.preventDefault()} onDrop={() => { if (drag?.date) assign(drag, null); setDrag(null); }}
        >
          <h4><CalendarDays size={14} /> Sem data ({undated.length})</h4>
          <p className="muted small-print">Arraste a peça para o dia do post. Arraste de volta para cá para tirar do calendário.</p>
          {!d && <p className="muted">Lendo a pasta…</p>}
          {undated.map((p) => <Piece key={p.key} p={p} />)}
          {!!outside.length && <><h4>Datas de outro mês</h4>{outside.map((p) => <Piece key={p.key} p={p} />)}</>}
        </aside>
        <div className="org-cal">
          <div className="cal-week">{WEEK.map((w, i) => <span key={w} className={postDays.includes(i) ? 'postday' : ''}>{w}</span>)}</div>
          <div className="cal-grid">
            {days.map((x) => {
              const date = ymd(x);
              const inMonth = date.slice(0, 7) === mes;
              const list = onDay(date);
              return (
                <div
                  key={date} className={`cal-day ${inMonth ? '' : 'out'} ${date === today ? 'today' : ''} ${postDays.includes(x.getDay()) && inMonth ? 'postday' : ''} ${drag ? 'droppable' : ''}`}
                  onDragOver={(e) => drag && e.preventDefault()} onDrop={() => { if (drag && drag.date !== date) assign(drag, date); setDrag(null); }}
                >
                  <span className="num">{x.getDate()}</span>
                  {list.map((p) => <Piece key={p.key} p={p} small />)}
                  {!list.length && postDays.includes(x.getDay()) && inMonth && date >= today && <small className="muted free">livre</small>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
