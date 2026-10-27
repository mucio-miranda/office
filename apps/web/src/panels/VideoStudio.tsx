import { useEffect, useMemo, useRef, useState } from 'react';
import { TRANSITIONS, CAPTION_STYLES, Timeline as TimelineSchema, layout, clipDuration, type TimelineInput } from '@office/video-engine/schema';
import { useStore } from '../lib/store';
import { api, mediaUrl } from '../lib/api';
import { BrowseDialog } from '../lib/PathPicker';
import { desktop } from '../lib/desktop';
import { Captions, Clapperboard, FileJson, Film, Image, Music, Plus, Radio, Type, X, Zap } from 'lucide-react';
import { LiveMirror } from './Tools';

/** Formatos de exportação da engine (mesmos ids de EXPORT_FORMATS). */
const EXPORTS = [
  ['otio', 'OpenTimelineIO (Kdenlive, DaVinci)'],
  ['fcp7', 'XML (Premiere, DaVinci)'],
  ['mlt', 'Shotcut (MLT)'],
  ['srt', 'Legendas SRT (CapCut)'],
] as const;
/** Apps que aparecem na ilha de edição. */
const ISLAND_TOOLS = new Set(['filmcraft', 'effectcraft', 'soundcraft']);

type TL = TimelineInput & { video: any[]; audio?: any[]; overlays?: any[]; captions?: any };
type Sel = { lane: 'video' | 'audio' | 'captions' | 'overlays'; index: number } | null;

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const rid = () => Math.random().toString(36).slice(2, 8);
const r2 = (n: number) => Math.round(n * 100) / 100;

export function VideoStudio() {
  const { office, timelines, live, agents, panelArg } = useStore();
  const [openId, setOpenId] = useState<string | null>(timelines[0]?.id ?? null);
  // a TV da ilha no mapa abre o estúdio já no app ao vivo (panelArg = live:<id>)
  const [liveId, setLiveId] = useState<string | null>(panelArg?.startsWith('live:') ? panelArg.slice(5) : null);
  useEffect(() => { if (panelArg?.startsWith('live:')) setLiveId(panelArg.slice(5)); }, [panelArg]);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const island = live.filter((s) => ISLAND_TOOLS.has(s.toolId) && s.status !== 'erro');
  const watching = island.find((s) => s.id === liveId);
  return (
    <div className="studio">
      <aside className="studio-list">
        <button className="primary" onClick={() => setCreating(true)}><Plus size={14} /> Nova timeline</button>
        <button className="ghost" onClick={() => setImporting(true)}><FileJson size={14} /> Importar timeline.json</button>
        {island.length > 0 && <div className="section-label" style={{ marginTop: 12 }}>Na ilha agora</div>}
        {island.map((s) => (
          <button key={s.id} className={`tl-item ${s.id === liveId ? 'active' : ''}`} onClick={() => setLiveId(s.id)}>
            <b className="row gap"><Radio size={13} /> {s.toolName}</b>
            <small className={s.status === 'ativa' ? 'st-rodando' : 'st-aguardando'}><span className="status-dot" />{agents.find((a) => a.id === s.agentId)?.name} · {s.status === 'ativa' ? 'editando ao vivo' : s.status === 'abrindo' ? 'abrindo' : 'esperando revisão'}</small>
          </button>
        ))}
        <div className="section-label" style={{ marginTop: 12 }}>Timelines</div>
        {timelines.map((t) => (
          <button key={t.id} className={`tl-item ${t.id === openId && !watching ? 'active' : ''}`} onClick={() => { setOpenId(t.id); setLiveId(null); }}>
            <b>{t.name}</b>
            <small className={`st-${t.renderStatus === 'concluido' ? 'concluido' : t.renderStatus === 'rodando' ? 'rodando' : t.renderStatus === 'erro' ? 'erro' : 'livre'}`}><span className="status-dot" />{t.renderStatus === 'concluido' ? 'renderizado' : t.renderStatus === 'rodando' ? 'renderizando' : t.renderStatus === 'erro' ? 'erro' : 'rascunho'}</small>
          </button>
        ))}
      </aside>
      {watching ? <div className="studio-live"><LiveMirror s={watching} big /></div>
        : openId ? <Editor key={openId} id={openId} /> : <div className="studio-empty"><div className="stack" style={{ alignItems: 'center' }}><Clapperboard size={28} /><span>Crie uma timeline ou importe o <code>timeline.json</code> que a Vic deixou na pasta do cliente.</span></div></div>}
      {creating && (
        <NewTimeline onClose={() => setCreating(false)}
          onPick={async (dir, name) => {
            const row = await api(`/api/offices/${office!.id}/timelines`, { body: { name: name || 'nova edição', baseDir: dir, json: { name, width: 1080, height: 1920, fps: 30, video: [] } } });
            setCreating(false);
            setOpenId(row.id);
          }} />
      )}
      {importing && (
        <BrowseDialog title="Escolha o timeline.json" scope="office" officeId={office!.id} pick="file" filter={/\.json$/i} onClose={() => setImporting(false)}
          onPick={async (file) => {
            const row = await api(`/api/offices/${office!.id}/timelines/import`, { body: { path: file } });
            setImporting(false);
            setOpenId(row.id);
          }} />
      )}
    </div>
  );
}

function Editor({ id }: { id: string }) {
  const { office, renders, previews, notify } = useStore();
  const base = `/api/offices/${office!.id}`;
  const [captioning, setCaptioning] = useState(false);
  const [showPreview, setShowPreview] = useState(0);
  const preview = previews[id];
  const [row, setRow] = useState<any>(null);
  const [tl, setTl] = useState<TL | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [pps, setPps] = useState(40);
  const [picker, setPicker] = useState<null | 'video' | 'audio' | 'overlays'>(null);
  const [view, setView] = useState<'timeline' | 'json'>('timeline');
  const [jsonText, setJsonText] = useState('');
  const [err, setErr] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const render = renders[id];

  useEffect(() => { api(`${base}/timelines/${id}`).then((r) => { setRow(r); setTl(r.json); }); }, [id, base]);
  // quando a prévia termina, ela entra no lugar do player
  useEffect(() => { if (preview?.status === 'concluido') { setSel(null); setShowPreview(Date.now()); } }, [preview?.status]);
  useEffect(() => { if (render?.status === 'concluido') api(`${base}/timelines/${id}`).then(setRow); }, [render?.status]);

  const update = (next: TL) => {
    setTl(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => api(`${base}/timelines/${id}`, { method: 'PUT', body: { json: next } }), 500);
  };

  const parsed = useMemo(() => {
    if (!tl || !tl.video.length) return null;
    const r = TimelineSchema.safeParse(tl);
    return r.success ? r.data : null;
  }, [tl]);
  const lay = parsed ? layout(parsed) : { starts: [], duration: 0 };
  const validation = useMemo(() => {
    if (!tl || !tl.video.length) return 'Adicione pelo menos um clipe de vídeo.';
    const r = TimelineSchema.safeParse(tl);
    return r.success ? '' : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · ');
  }, [tl]);

  if (!tl || !row) return <div className="muted">Carregando…</div>;

  const addMedia = async (file: string, lane: 'video' | 'audio' | 'overlays') => {
    const rel = file.toLowerCase().startsWith(row.baseDir.toLowerCase() + '\\') ? file.slice(row.baseDir.length + 1) : file;
    if (lane === 'overlays') {
      const start = Math.max(0, lay.duration - 2);
      update({ ...tl, overlays: [...(tl.overlays ?? []), { id: rid(), src: rel, start, end: lay.duration || 2, x: 0.5, y: 0.5, width: 0.4, fade: 0.3 }] });
      return;
    }
    const info = await api(`${base}/probe?path=${encodeURIComponent(file)}`);
    if (lane === 'video') {
      const out = r2(Math.min(info.duration || 3, 4));
      update({ ...tl, video: [...tl.video, { id: rid(), src: rel, in: 0, out, speed: 1, keepAudio: info.hasAudio, ...(tl.video.length ? { transition: { type: 'corte', duration: 0.4 } } : {}) }] });
      setSel({ lane: 'video', index: tl.video.length });
    } else {
      update({ ...tl, audio: [...(tl.audio ?? []), { id: rid(), src: rel, start: 0, in: 0, volume: 0.35, fadeIn: 0.5, fadeOut: 1.5 }] });
      setSel({ lane: 'audio', index: (tl.audio ?? []).length });
    }
  };

  const abs = (src: string) => (/^[a-z]:[\\/]/i.test(src) || src.startsWith('\\\\') ? src : `${row.baseDir}\\${src}`);
  const selected = sel ? (sel.lane === 'captions' ? tl.captions?.items?.[sel.index] : (tl as any)[sel.lane]?.[sel.index]) : null;
  const patchSel = (patch: Record<string, unknown>) => {
    if (!sel) return;
    if (sel.lane === 'captions') {
      const items = [...(tl.captions?.items ?? [])];
      items[sel.index] = { ...items[sel.index], ...patch };
      update({ ...tl, captions: { ...(tl.captions ?? {}), items } });
    } else {
      const arr = [...((tl as any)[sel.lane] ?? [])];
      arr[sel.index] = { ...arr[sel.index], ...patch };
      update({ ...tl, [sel.lane]: arr });
    }
  };
  const removeSel = () => {
    if (!sel) return;
    if (sel.lane === 'captions') update({ ...tl, captions: { ...tl.captions, items: tl.captions.items.filter((_: any, i: number) => i !== sel.index) } });
    else update({ ...tl, [sel.lane]: (tl as any)[sel.lane].filter((_: any, i: number) => i !== sel.index) });
    setSel(null);
  };
  const moveClip = (dir: -1 | 1) => {
    if (sel?.lane !== 'video') return;
    const j = sel.index + dir;
    if (j < 0 || j >= tl.video.length) return;
    const v = [...tl.video];
    [v[sel.index], v[j]] = [v[j], v[sel.index]];
    update({ ...tl, video: v });
    setSel({ lane: 'video', index: j });
  };

  /** Grava agora o que ainda está no atraso do salvamento automático (antes de legendar, prever ou exportar). */
  const flush = async () => {
    clearTimeout(saveTimer.current);
    await api(`${base}/timelines/${id}`, { method: 'PUT', body: { json: tl } });
  };

  const doRender = async () => {
    setErr('');
    try { await flush(); await api(`${base}/timelines/${id}/render`, { body: {} }); } catch (x) { setErr((x as Error).message); }
  };

  const doPreview = async () => {
    setErr('');
    try { await flush(); await api(`${base}/timelines/${id}/preview`, { body: {} }); } catch (x) { setErr((x as Error).message); }
  };

  const doCaptions = async () => {
    setErr('');
    setCaptioning(true);
    try {
      await flush();
      const r = await api<{ items: unknown[] }>(`${base}/timelines/${id}/captions`, { body: {} });
      const fresh = await api(`${base}/timelines/${id}`);
      setRow(fresh);
      setTl(fresh.json);
      notify(`${r.items.length} legendas geradas com o Whisper`);
    } catch (x) { setErr((x as Error).message); } finally { setCaptioning(false); }
  };

  const doExport = async (format: string) => {
    setErr('');
    try {
      await flush();
      const r = await api<{ output: string }>(`${base}/timelines/${id}/export`, { body: { format } });
      notify(`Exportado: ${r.output.split(/[\\/]/).pop()}`);
      desktop?.showInFolder(r.output);
    } catch (x) { setErr((x as Error).message); }
  };

  const previewUrl = `${base}/timelines/${id}/preview?t=${showPreview}`;
  const previewSrc = selected && sel?.lane === 'video' ? mediaUrl(office!.id, abs(selected.src)) : showPreview ? previewUrl : row.output ? mediaUrl(office!.id, row.output) : null;

  return (
    <div className="editor">
      <div className="editor-top">
        <input className="title-input" value={tl.name ?? row.name} onChange={(e) => { update({ ...tl, name: e.target.value }); api(`${base}/timelines/${id}`, { method: 'PUT', body: { name: e.target.value } }); }} />
        <select value={`${tl.width ?? 1080}x${tl.height ?? 1920}`} onChange={(e) => { const [w, h] = e.target.value.split('x').map(Number); update({ ...tl, width: w, height: h }); }}>
          <option value="1080x1920">9:16 Reels/Story</option>
          <option value="1080x1350">4:5 Feed</option>
          <option value="1080x1080">1:1</option>
          <option value="1920x1080">16:9</option>
        </select>
        <span className="muted small">{lay.duration.toFixed(1)}s · saída em <code>{row.baseDir}</code></span>
        <span className="spacer" />
        <div className="tabs-line">
          <button className={view === 'timeline' ? 'active' : ''} onClick={() => setView('timeline')}>Timeline</button>
          <button className={view === 'json' ? 'active' : ''} onClick={() => { setJsonText(JSON.stringify(tl, null, 2)); setView('json'); }}>JSON</button>
        </div>
        <button className="ghost" disabled={!!validation || captioning} onClick={doCaptions} title="Transcreve a fala dos clipes com 'manter áudio' (Whisper, nesta máquina)">
          <Captions size={14} /> {captioning ? 'Transcrevendo…' : 'Legendas automáticas'}
        </button>
        <button className="ghost" disabled={!!validation || preview?.status === 'rodando'} onClick={doPreview} title="Render rápido em 540p para conferir a edição">
          <Zap size={14} /> {preview?.status === 'rodando' ? `Prévia ${Math.round(preview.progress * 100)}%` : 'Prévia rápida'}
        </button>
        <select className="export-select" value="" disabled={!!validation} onChange={(e) => e.target.value && doExport(e.target.value)} title="Exportar para outro editor">
          <option value="">Exportar…</option>
          {EXPORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <button className="primary" disabled={!!validation || render?.status === 'rodando'} onClick={doRender}>
          {render?.status === 'rodando' ? `Renderizando ${Math.round(render.progress * 100)}%` : <><Film size={14} /> Renderizar</>}
        </button>
      </div>
      {render?.status === 'rodando' && <div className="progress"><i style={{ width: `${render.progress * 100}%` }} /></div>}
      {(validation || err || render?.error || preview?.error) && <div className="error small">{err || render?.error || preview?.error || validation}</div>}
      {captioning && <p className="muted small" style={{ margin: 0 }}>O Whisper roda nesta máquina: leva por volta de duas vezes a duração da fala.</p>}

      {view === 'json' ? (
        <div className="json-view">
          <textarea spellCheck={false} value={jsonText} onChange={(e) => setJsonText(e.target.value)} />
          <button className="primary" onClick={() => { try { update(JSON.parse(jsonText)); setView('timeline'); } catch (x) { setErr(`JSON inválido: ${(x as Error).message}`); } }}>Aplicar JSON</button>
        </div>
      ) : (
        <>
          <div className="editor-mid">
            <div className="preview">
              {previewSrc ? (
                <ClipPreview src={previewSrc} from={sel?.lane === 'video' ? selected.in : 0} to={sel?.lane === 'video' ? selected.out : undefined} portrait={(tl.height ?? 1920) > (tl.width ?? 1080)} />
              ) : <div className="muted small">Selecione um clipe ou gere uma prévia rápida</div>}
              {showPreview > 0 && !(selected && sel?.lane === 'video') && <span className="muted small">prévia rápida (540p)</span>}
              {row.output && (desktop
                ? <span className="row gap"><a className="small" href="#" onClick={(e) => { e.preventDefault(); desktop?.openPath(row.output); }}>abrir último render</a><a className="small" href="#" onClick={(e) => { e.preventDefault(); desktop?.showInFolder(row.output); }}>mostrar no Explorer</a></span>
                : <a className="small" href={mediaUrl(office!.id, row.output)} target="_blank">abrir último render</a>)}
            </div>
            <div className="inspector">
              {!sel && <p className="muted small">Clique num clipe, trilha ou legenda para editar. Arraste as bordas dos clipes para cortar.</p>}
              {sel?.lane === 'video' && selected && (
                <>
                  <h4>Clipe {sel.index + 1} <small className="muted">{selected.src.split(/[\\/]/).pop()}</small></h4>
                  <div className="grid2">
                    <Num label="Entrada (s)" v={selected.in ?? 0} on={(v) => patchSel({ in: v })} />
                    <Num label="Saída (s)" v={selected.out} on={(v) => patchSel({ out: v })} />
                    <Num label="Velocidade" v={selected.speed ?? 1} step={0.1} on={(v) => patchSel({ speed: v })} />
                    <label className="check"><input type="checkbox" checked={!!selected.reverse} onChange={(e) => patchSel({ reverse: e.target.checked })} /> reverse</label>
                    <label className="check"><input type="checkbox" checked={!!selected.keepAudio} onChange={(e) => patchSel({ keepAudio: e.target.checked })} /> manter áudio</label>
                    <Num label="Volume" v={selected.volume ?? 1} step={0.1} on={(v) => patchSel({ volume: v })} />
                    <Num label="Zoom início" v={selected.zoom?.from ?? 1} step={0.05} on={(v) => patchSel({ zoom: { from: v, to: selected.zoom?.to ?? 1 } })} />
                    <Num label="Zoom fim" v={selected.zoom?.to ?? 1} step={0.05} on={(v) => patchSel({ zoom: { from: selected.zoom?.from ?? 1, to: v } })} />
                  </div>
                  {sel.index > 0 && (
                    <div className="grid2">
                      <label>Transição de entrada
                        <select value={selected.transition?.type ?? 'corte'} onChange={(e) => patchSel({ transition: { type: e.target.value, duration: selected.transition?.duration ?? 0.4 } })}>
                          {TRANSITIONS.map((t) => <option key={t}>{t}</option>)}
                        </select>
                      </label>
                      <Num label="Duração (s)" v={selected.transition?.duration ?? 0.4} step={0.05} on={(v) => patchSel({ transition: { type: selected.transition?.type ?? 'fade', duration: v } })} />
                    </div>
                  )}
                  <h5>Cor</h5>
                  <div className="grid2">
                    <Num label="Brilho" v={selected.color?.brightness ?? 0} step={0.02} on={(v) => patchSel({ color: { ...selected.color, brightness: v } })} />
                    <Num label="Contraste" v={selected.color?.contrast ?? 1} step={0.05} on={(v) => patchSel({ color: { ...selected.color, contrast: v } })} />
                    <Num label="Saturação" v={selected.color?.saturation ?? 1} step={0.05} on={(v) => patchSel({ color: { ...selected.color, saturation: v } })} />
                    <Num label="Gama" v={selected.color?.gamma ?? 1} step={0.05} on={(v) => patchSel({ color: { ...selected.color, gamma: v } })} />
                  </div>
                  <div className="row gap"><button className="ghost" onClick={() => moveClip(-1)}>◀ mover</button><button className="ghost" onClick={() => moveClip(1)}>mover ▶</button><button className="danger" onClick={removeSel}>Remover</button></div>
                </>
              )}
              {sel?.lane === 'audio' && selected && (
                <>
                  <h4>Trilha <small className="muted">{selected.src.split(/[\\/]/).pop()}</small></h4>
                  <div className="grid2">
                    <Num label="Começa em (s)" v={selected.start ?? 0} on={(v) => patchSel({ start: v })} />
                    <Num label="Entrada no arquivo (s)" v={selected.in ?? 0} on={(v) => patchSel({ in: v })} />
                    <Num label="Volume" v={selected.volume ?? 1} step={0.05} on={(v) => patchSel({ volume: v })} />
                    <Num label="Fade in" v={selected.fadeIn ?? 0} step={0.1} on={(v) => patchSel({ fadeIn: v })} />
                    <Num label="Fade out" v={selected.fadeOut ?? 0} step={0.1} on={(v) => patchSel({ fadeOut: v })} />
                  </div>
                  <button className="danger" onClick={removeSel}>Remover</button>
                </>
              )}
              {sel?.lane === 'overlays' && selected && (
                <>
                  <h4>Sobreposição</h4>
                  <div className="grid2">
                    <Num label="Início" v={selected.start} on={(v) => patchSel({ start: v })} />
                    <Num label="Fim" v={selected.end} on={(v) => patchSel({ end: v })} />
                    <Num label="X (0–1)" v={selected.x ?? 0.5} step={0.05} on={(v) => patchSel({ x: v })} />
                    <Num label="Y (0–1)" v={selected.y ?? 0.5} step={0.05} on={(v) => patchSel({ y: v })} />
                    <Num label="Largura (0–1)" v={selected.width ?? 0.4} step={0.05} on={(v) => patchSel({ width: v })} />
                  </div>
                  <button className="danger" onClick={removeSel}>Remover</button>
                </>
              )}
              {sel?.lane === 'captions' && selected && (
                <>
                  <h4>Legenda</h4>
                  <label>Texto<textarea rows={2} value={selected.text} onChange={(e) => patchSel({ text: e.target.value })} /></label>
                  <div className="grid2">
                    <Num label="Início" v={selected.start} on={(v) => patchSel({ start: v })} />
                    <Num label="Fim" v={selected.end} on={(v) => patchSel({ end: v })} />
                  </div>
                  <button className="danger" onClick={removeSel}>Remover</button>
                </>
              )}
              <hr />
              <h5>Estilo das legendas</h5>
              <div className="grid2">
                <label>Estilo<select value={tl.captions?.style ?? 'rezzu'} onChange={(e) => update({ ...tl, captions: { items: [], ...(tl.captions ?? {}), style: e.target.value } })}>
                  {CAPTION_STYLES.map((s) => <option key={s}>{s}</option>)}</select></label>
                <label>Fonte<input value={tl.captions?.font ?? 'Montserrat'} onChange={(e) => update({ ...tl, captions: { items: [], ...(tl.captions ?? {}), font: e.target.value } })} /></label>
                <label>Cor<input type="color" value={tl.captions?.primary ?? '#ffffff'} onChange={(e) => update({ ...tl, captions: { items: [], ...(tl.captions ?? {}), primary: e.target.value } })} /></label>
                <label>Destaque<input type="color" value={tl.captions?.highlight ?? '#ffd400'} onChange={(e) => update({ ...tl, captions: { items: [], ...(tl.captions ?? {}), highlight: e.target.value } })} /></label>
              </div>
            </div>
          </div>

          <div className="lanes-toolbar">
            <button className="small" onClick={() => setPicker('video')}><Film size={13} /> Vídeo</button>
            <button className="small" onClick={() => setPicker('audio')}><Music size={13} /> Áudio</button>
            <button className="small" onClick={() => setPicker('overlays')}><Image size={13} /> Imagem</button>
            <button className="small" onClick={() => {
              const items = [...(tl.captions?.items ?? [])];
              const start = items.length ? items[items.length - 1].end : 0;
              items.push({ start: r2(start), end: r2(start + 1.5), text: 'nova legenda' });
              update({ ...tl, captions: { style: 'rezzu', ...(tl.captions ?? {}), items } });
              setSel({ lane: 'captions', index: items.length - 1 });
            }}><Type size={13} /> Legenda</button>
            <span className="spacer" />
            <label className="small">zoom <input type="range" min={10} max={160} value={pps} onChange={(e) => setPps(Number(e.target.value))} /></label>
          </div>

          <div className="lanes">
            <Ruler duration={Math.max(lay.duration, 5)} pps={pps} />
            <Lane icon={<Film size={13} />} label="Vídeo">
              {tl.video.map((c, i) => {
                const start = lay.starts[i] ?? 0;
                const dur = parsed ? clipDuration(parsed.video[i]) : (c.out - (c.in ?? 0)) / (c.speed ?? 1);
                return (
                  <Block key={c.id ?? i} left={start * pps} width={dur * pps} active={sel?.lane === 'video' && sel.index === i} color="var(--review)"
                    label={`${c.transition && c.transition.type !== 'corte' ? `${c.transition.type} · ` : ''}${c.src.split(/[\\/]/).pop()}${(c.speed ?? 1) !== 1 ? ` · ${c.speed}x` : ''}${c.reverse ? ' · rev' : ''}`}
                    onClick={() => setSel({ lane: 'video', index: i })}
                    onTrim={(edge, dx) => {
                      const ds = (dx / pps) * (c.speed ?? 1);
                      const arr = [...tl.video];
                      if (edge === 'right') arr[i] = { ...c, out: r2(Math.max((c.in ?? 0) + 0.2, c.out + ds)) };
                      else arr[i] = { ...c, in: r2(Math.min(c.out - 0.2, Math.max(0, (c.in ?? 0) + ds))) };
                      update({ ...tl, video: arr });
                    }} />
                );
              })}
            </Lane>
            <Lane icon={<Type size={13} />} label="Legendas">
              {(tl.captions?.items ?? []).map((c: any, i: number) => (
                <Block key={i} left={c.start * pps} width={(c.end - c.start) * pps} color="var(--waiting)" label={c.text} active={sel?.lane === 'captions' && sel.index === i}
                  onClick={() => setSel({ lane: 'captions', index: i })}
                  onMove={(dx) => { const items = [...tl.captions.items]; const d = dx / pps; items[i] = { ...c, start: r2(Math.max(0, c.start + d)), end: r2(Math.max(0.2, c.end + d)) }; update({ ...tl, captions: { ...tl.captions, items } }); }}
                  onTrim={(edge, dx) => { const items = [...tl.captions.items]; const d = dx / pps; items[i] = edge === 'right' ? { ...c, end: r2(Math.max(c.start + 0.2, c.end + d)) } : { ...c, start: r2(Math.min(c.end - 0.2, Math.max(0, c.start + d))) }; update({ ...tl, captions: { ...tl.captions, items } }); }} />
              ))}
            </Lane>
            <Lane icon={<Image size={13} />} label="Imagens">
              {(tl.overlays ?? []).map((o: any, i: number) => (
                <Block key={o.id ?? i} left={o.start * pps} width={(o.end - o.start) * pps} color="var(--done)" label={o.src.split(/[\\/]/).pop()} active={sel?.lane === 'overlays' && sel.index === i}
                  onClick={() => setSel({ lane: 'overlays', index: i })}
                  onMove={(dx) => { const arr = [...tl.overlays!]; const d = dx / pps; arr[i] = { ...o, start: r2(Math.max(0, o.start + d)), end: r2(o.end + d) }; update({ ...tl, overlays: arr }); }} />
              ))}
            </Lane>
            <Lane icon={<Music size={13} />} label="Áudio">
              {(tl.audio ?? []).map((a: any, i: number) => (
                <Block key={a.id ?? i} left={(a.start ?? 0) * pps} width={Math.max(1, ((a.out ?? lay.duration) - (a.in ?? 0))) * pps} color="var(--running)" label={a.src.split(/[\\/]/).pop()} active={sel?.lane === 'audio' && sel.index === i}
                  onClick={() => setSel({ lane: 'audio', index: i })}
                  onMove={(dx) => { const arr = [...tl.audio!]; arr[i] = { ...a, start: r2(Math.max(0, (a.start ?? 0) + dx / pps)) }; update({ ...tl, audio: arr }); }} />
              ))}
            </Lane>
          </div>
        </>
      )}
      {picker && (
        <BrowseDialog title={picker === 'video' ? 'Adicionar vídeo' : picker === 'audio' ? 'Adicionar áudio' : 'Adicionar imagem'} scope="office" officeId={office!.id} pick="file"
          filter={picker === 'video' ? VIDEO_EXT : picker === 'audio' ? AUDIO_EXT : IMAGE_EXT} start={row.baseDir}
          onClose={() => setPicker(null)} onPick={async (file) => { setPicker(null); try { await addMedia(file, picker); } catch (x) { setErr((x as Error).message); } }} />
      )}
    </div>
  );
}

function ClipPreview({ src, from, to, portrait }: { src: string; from: number; to?: number; portrait: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.currentTime = from; }, [src, from]);
  return (
    <video ref={ref} className={portrait ? 'portrait' : ''} src={src} controls muted
      onTimeUpdate={(e) => { if (to !== undefined && e.currentTarget.currentTime >= to) e.currentTarget.currentTime = from; }} />
  );
}

function Num({ label, v, on, step = 0.1 }: { label: string; v: number; on: (v: number) => void; step?: number }) {
  return <label>{label}<input type="number" step={step} value={v} onChange={(e) => on(Number(e.target.value))} /></label>;
}

function Ruler({ duration, pps }: { duration: number; pps: number }) {
  const every = pps < 25 ? 5 : pps < 60 ? 2 : 1;
  return (
    <div className="ruler" style={{ width: duration * pps + 200 }}>
      {Array.from({ length: Math.ceil(duration / every) + 1 }, (_, i) => (
        <span key={i} style={{ left: 90 + i * every * pps }}>{i * every}s</span>
      ))}
    </div>
  );
}

function Lane({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="lane">
      <div className="lane-label">{icon}{label}</div>
      <div className="lane-track">{children}</div>
    </div>
  );
}

function Block({ left, width, label, color, active, onClick, onTrim, onMove }: {
  left: number; width: number; label: string; color: string; active?: boolean; onClick: () => void;
  onTrim?: (edge: 'left' | 'right', dx: number) => void; onMove?: (dx: number) => void;
}) {
  // arrastar: aplica o delta acumulado a cada movimento e "zera" a origem
  const drag = (fn: (dx: number) => void) => (e: React.PointerEvent) => {
    e.stopPropagation();
    let x0 = e.clientX;
    const move = (ev: PointerEvent) => { const dx = ev.clientX - x0; if (Math.abs(dx) >= 2) { fn(dx); x0 = ev.clientX; } };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };
  return (
    <div className={`block ${active ? 'active' : ''}`} style={{ left, width: Math.max(8, width), ['--lane' as any]: color }} onClick={onClick}
      onPointerDown={onMove ? (e) => { onClick(); drag(onMove)(e); } : undefined} title={label}>
      {onTrim && <i className="handle l" onPointerDown={drag((dx) => onTrim('left', dx))} />}
      <span>{label}</span>
      {onTrim && <i className="handle r" onPointerDown={drag((dx) => onTrim('right', dx))} />}
    </div>
  );
}

/** Nova timeline: nome + pasta de saída escolhida navegando nas pastas do escritório. */
function NewTimeline({ onPick, onClose }: { onPick: (dir: string, name: string) => void; onClose: () => void }) {
  const office = useStore((s) => s.office)!;
  const [name, setName] = useState('');
  const [browsing, setBrowsing] = useState(false);
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); setBrowsing(true); }}>
        <header className="modal-head"><h3>Nova timeline</h3><button type="button" className="icon" onClick={onClose}><X size={16} /></button></header>
        <div className="modal-body">
          <label>Nome<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="reels-depoimento-maria" /></label>
          <p className="muted small" style={{ margin: 0 }}>Em seguida, escolha a pasta de saída (ex.: VIDEOS\EDITADOS do cliente). Os brutos podem estar em qualquer pasta do escritório.</p>
        </div>
        <footer className="modal-foot"><span /><div className="row gap"><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button className="primary" disabled={!name.trim()}>Escolher pasta</button></div></footer>
      </form>
      {browsing && <BrowseDialog title="Pasta de saída" scope="office" officeId={office.id} onClose={() => setBrowsing(false)} onPick={(dir) => onPick(dir, name.trim())} />}
    </div>
  );
}
