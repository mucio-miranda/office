import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { Check, ChevronDown, ChevronUp, Copy, Paintbrush, Redo2, RotateCcw, RotateCw, Search, Trash2, Undo2 } from 'lucide-react';
import { useTheme, useWorldStyle, usePixel } from '../../lib/theme';
import { useStore } from '../../lib/store';
import { CATALOG, CATEGORIES, DEF, type DecorCat } from './catalog';
import { floorMaterialTexture } from '../pixel/floors';
import { ROOMS } from '../layout';
import { WALL_LABEL, WALL_OPTIONS, applyWall, saveWalls, useWallTool, wallsOfRoom } from './walls';
import {
  canDecorate, duplicateSelected, redo, removeSelected, restoreDefault, rotateSelected, setEditing, startPlacing, undo, updateItem, useDecor,
} from './state';

/** Entra no modo Decorar (no tema Pixel, onde as peças aparecem com todos os detalhes). */
export function enterDecorate() {
  if (!canDecorate()) return useStore.getState().notify('Convidados não mudam a decoração.');
  if (useWorldStyle.getState().style !== 'pixel') useWorldStyle.getState().toggle();
  setEditing(true);
}

const typing = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

// ---------------------------------------------------------------- miniaturas do catálogo

const THUMB = 64;

/** Fotografa uma peça por vez num canvas fora da tela, no mesmo ângulo isométrico do mapa. */
function Shooter({ kinds, theme }: { kinds: string[]; theme: string }) {
  const { gl, camera, scene } = useThree();
  const p = usePixel();
  const [i, setI] = useState(0);
  const group = useRef<THREE.Group>(null);
  const frame = useRef(0);
  const kind = kinds[i];
  const d = kind ? DEF[kind] : undefined;

  useFrame(() => {
    if (!d || !group.current) return;
    frame.current++;
    if (frame.current === 2) {
      const box = new THREE.Box3().setFromObject(group.current);
      const c = box.getCenter(new THREE.Vector3());
      const r = Math.max(0.35, box.getBoundingSphere(new THREE.Sphere()).radius);
      const ortho = camera as THREE.OrthographicCamera;
      ortho.position.set(c.x + 20, c.y + 20 * Math.tan(Math.PI / 6) * Math.SQRT2, c.z + 20);
      ortho.lookAt(c);
      ortho.zoom = (THUMB / (2 * r)) * 1.08;
      ortho.updateProjectionMatrix();
    }
    if (frame.current === 4) {
      gl.render(scene, camera);
      const url = gl.domElement.toDataURL('image/png');
      useDecor.setState((s) => ({ thumbs: { ...s.thumbs, [`${theme}:${kind}`]: url } }));
      frame.current = 0;
      setI((x) => x + 1);
    }
  });
  if (!d) return null;
  return <group ref={group} key={kind}>{d.render(p, undefined)}</group>;
}

function ThumbStudio() {
  const theme = useTheme((s) => s.theme);
  const thumbs = useDecor((s) => s.thumbs);
  // os pisos usam a própria textura como miniatura (ver Thumb)
  const missing = useMemo(() => CATALOG.filter((d) => d.place !== 'sala').map((d) => d.kind).filter((k) => !thumbs[`${theme}:${k}`]), [theme]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!missing.length) return null;
  return (
    <div className="decor-studio" aria-hidden>
      <Canvas key={theme} flat dpr={1} style={{ width: THUMB, height: THUMB }} gl={{ antialias: false, preserveDrawingBuffer: true, alpha: true }}>
        <OrthographicCamera makeDefault zoom={30} near={-100} far={200} position={[20, 16, 20]} />
        <ambientLight intensity={1.1} />
        <directionalLight position={[-10, 26, 14]} intensity={1.6} />
        <Shooter kinds={missing} theme={theme} />
      </Canvas>
    </div>
  );
}

/** Miniatura de piso: a amostra de 2 m do material, direto do canvas da textura. */
const floorThumb = (kind: string) => {
  if (kind === 'piso-original') return null;
  const img = floorMaterialTexture(kind.slice('piso-'.length))?.image as HTMLCanvasElement | undefined;
  return img?.toDataURL?.() ?? null;
};

function Thumb({ kind }: { kind: string }) {
  const theme = useTheme((s) => s.theme);
  const shot = useDecor((s) => s.thumbs[`${theme}:${kind}`]);
  const floor = useMemo(() => (DEF[kind]?.place === 'sala' ? floorThumb(kind) : null), [kind]);
  if (DEF[kind]?.place === 'sala') {
    return floor ? <img className="decor-thumb floor" src={floor} alt="" /> : <span className="decor-thumb floor original">↺</span>;
  }
  const url = shot;
  return url ? <img className="decor-thumb" src={url} alt="" /> : <span className="decor-thumb loading" />;
}

// ---------------------------------------------------------------- painéis

function Catalog() {
  const open = useDecor((s) => s.catalogOpen);
  const placing = useDecor((s) => s.placing);
  const [cat, setCat] = useState<DecorCat>('escritorio');
  const [q, setQ] = useState('');
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const list = q ? CATALOG.filter((d) => norm(d.name).includes(norm(q))) : CATALOG.filter((d) => d.cat === cat);
  return (
    <div className={`decor-catalog ${open ? '' : 'closed'}`}>
      <div className="decor-tabs">
        <button className="icon" onClick={() => useDecor.setState({ catalogOpen: !open })} title={open ? 'Recolher o catálogo' : 'Abrir o catálogo'}>
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
        <b className="decor-title">Catálogo</b>
        {CATEGORIES.map((c) => (
          <button key={c.id} className={`decor-tab ${!q && cat === c.id ? 'on' : ''}`} onClick={() => { setCat(c.id); setQ(''); useDecor.setState({ catalogOpen: true }); }}>
            <span>{c.emoji}</span> {c.label}
          </button>
        ))}
        <span className="spacer" />
        <label className="decor-search">
          <Search size={13} />
          <input value={q} placeholder="Buscar peça" onChange={(e) => { setQ(e.target.value); useDecor.setState({ catalogOpen: true }); }} />
        </label>
      </div>
      {open && (
        <div className="decor-grid">
          {list.map((d) => (
            <button key={d.kind} className={`decor-card ${placing?.kind === d.kind ? 'on' : ''}`} onClick={() => startPlacing(d.kind)} title={d.name}>
              <Thumb kind={d.kind} />
              <span>{d.name}</span>
            </button>
          ))}
          {list.length === 0 && <div className="empty small">Nenhuma peça com esse nome</div>}
        </div>
      )}
    </div>
  );
}

function Inspector() {
  const sel = useDecor((s) => s.items.find((i) => i.id === s.sel));
  const placing = useDecor((s) => s.placing);
  if (placing) {
    const d = DEF[placing.kind];
    return (
      <div className="decor-inspector">
        <Thumb kind={placing.kind} />
        <div className="decor-info">
          <b>{d?.name}</b>
          <span className="muted">{d?.place === 'sala'
            ? <>Clique numa sala para trocar o piso · dá para aplicar em várias · <kbd>Esc</kbd> termina</>
            : <>Clique para colocar · <kbd>R</kbd> gira · <kbd>Shift</kbd>+clique põe outra · <kbd>Esc</kbd> cancela</>}</span>
        </div>
      </div>
    );
  }
  if (!sel) return null;
  const d = DEF[sel.kind];
  if (!d) return null;
  const color = sel.color ?? d.colors?.[0];
  return (
    <div className="decor-inspector">
      <Thumb kind={sel.kind} />
      <div className="decor-info">
        <b>{d.name}</b>
        <span className="muted">Arraste para mover</span>
        {d.colors && (
          <div className="decor-swatches">
            {d.colors.map((c) => (
              <button key={c} className={`swatch ${c === color ? 'on' : ''} ${c === 'multi' ? 'multi' : ''}`} style={c === 'multi' ? undefined : { background: c }}
                title={c === 'multi' ? 'Colorido' : c} onClick={() => updateItem(sel.id, { color: c })} />
            ))}
          </div>
        )}
      </div>
      <div className="decor-actions">
        {d.place !== 'parede' && <button className="ghost small" onClick={rotateSelected} title="Girar (R)"><RotateCw size={14} /> Girar</button>}
        <button className="ghost small" onClick={duplicateSelected} title="Duplicar (Ctrl D)"><Copy size={14} /> Duplicar</button>
        <button className="ghost small danger" onClick={removeSelected} title="Remover (Delete)"><Trash2 size={14} /> Remover</button>
      </div>
    </div>
  );
}

function TopBar() {
  const saving = useDecor((s) => s.saving);
  const canUndo = useDecor((s) => s.past.length > 0);
  const canRedo = useDecor((s) => s.future.length > 0);
  return (
    <div className="hud-top decor-bar">
      <span className="pill decor-pill"><Paintbrush size={13} /> Decorando</span>
      <span className={`decor-save ${saving}`}>{saving === 'salvando' ? 'Salvando…' : saving === 'erro' ? 'Não salvou' : 'Tudo salvo'}</span>
      <span className="spacer" />
      <button className="ghost small pill" onClick={undo} disabled={!canUndo} title="Desfazer (Ctrl Z)"><Undo2 size={14} /></button>
      <button className="ghost small pill" onClick={redo} disabled={!canRedo} title="Refazer (Ctrl Y)"><Redo2 size={14} /></button>
      <button className="ghost small pill" onClick={() => { if (confirm('Voltar à decoração padrão do Office? Dá para desfazer depois.')) restoreDefault(); }} title="Decoração padrão">
        <RotateCcw size={14} /> Padrão
      </button>
      <WallToolButton />
      <button className="primary small decor-done" onClick={() => setEditing(false)}><Check size={14} /> Concluir <kbd>X</kbd></button>
    </div>
  );
}

const WALL_SWATCH: Record<string, string> = {
  alvenaria: 'linear-gradient(#e7dfd2, #cbbda7)', branca: '#f3f3f1', preta: '#1f2023', concreto: '#a3a29d', madeira: '#99693f',
  vidro: 'linear-gradient(135deg, #e4f6fb 40%, #a9d5e5)', 'vidro-fume': 'linear-gradient(135deg, #5b6c77 40%, #2b3338)', removida: 'repeating-linear-gradient(45deg, #fff 0 4px, #ff5c8a 4px 6px)',
};

/** Paredes: escolha um tipo e clique nas paredes, ou aplique na sala inteira. Parede removida deixa passar. */
function WallToolButton() {
  const { tool, setTool } = useWallTool();
  const [room, setRoom] = useState(ROOMS[0]?.id ?? '');
  useEffect(() => () => setTool(null), [setTool]);
  return (
    <>
      <button className={`ghost small ${tool ? 'on' : ''}`} onClick={() => setTool(tool ? null : 'vidro')}>Paredes</button>
      {tool && (
        <div className="wall-panel">
          <b>Paredes</b>
          <div className="wall-types">
            {WALL_OPTIONS.map((t) => (
              <button key={t} className={tool === t ? 'on' : ''} onClick={() => setTool(t)}><i style={{ background: WALL_SWATCH[t] }} />{WALL_LABEL[t]}</button>
            ))}
          </div>
          <p className="muted small" style={{ margin: 0 }}>Clique numa parede para aplicar {WALL_LABEL[tool].toLowerCase()}. As removidas aparecem em rosa enquanto este painel estiver aberto.</p>
          <label>Sala inteira
            <select value={room} onChange={(e) => setRoom(e.target.value)}>{ROOMS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
          </label>
          <div className="row gap">
            <button className="primary small" onClick={() => applyWall(wallsOfRoom(room), tool)}>Aplicar na sala</button>
            <button className="ghost small" onClick={() => { if (confirm('Voltar todas as paredes ao padrão?')) saveWalls({}); }}>Tudo padrão</button>
          </div>
        </div>
      )}
    </>
  );
}

/** Interface do modo Decorar e os atalhos (X entra e sai). */
export function DecorUI() {
  const editing = useDecor((s) => s.editing);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing()) return;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      const s = useDecor.getState();
      if (!s.editing) {
        if (k === 'x' && !mod && !e.altKey && !useStore.getState().panel) { e.preventDefault(); enterDecorate(); }
        return;
      }
      let handled = true;
      if (k === 'escape') {
        if (s.placing) useDecor.setState({ placing: null, ghost: null });
        else if (s.sel) useDecor.setState({ sel: null });
        else setEditing(false);
      } else if (k === 'x' && !mod) setEditing(false);
      else if (k === 'r' && !mod) rotateSelected();
      else if (k === 'delete' || k === 'backspace') removeSelected();
      else if (mod && k === 'z') (e.shiftKey ? redo : undo)();
      else if (mod && k === 'y') redo();
      else if (mod && k === 'd') duplicateSelected();
      else handled = false;
      if (handled) { e.preventDefault(); e.stopPropagation(); }
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, []);

  if (!editing) return null;
  return (
    <>
      <TopBar />
      <Inspector />
      <Catalog />
      <ThumbStudio />
    </>
  );
}
