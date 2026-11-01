import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import { Dices, X } from 'lucide-react';
import type { AvatarLook } from '@office/shared';
import { PixelAvatar, resolveLook } from '../office/pixel/Avatar';

/** Editor de avatar, com prévia girando: serve para pessoas e funcionários de IA. */

const SKINS = ['#f5d3b3', '#f2c49b', '#e0a878', '#c68a5e', '#8d5a3b', '#5c3a26'];
const HAIRS = ['#1f1a17', '#4a2f1e', '#8a3b1d', '#c98b3c', '#e3c27a', '#5a5a66', '#d9d9dc', '#7c5cff', '#ff5c8a'];
const SHIRTS = ['#ff5c8a', '#7c5cff', '#22c3a6', '#ffb020', '#3fa7ff', '#ff7a45', '#111418', '#f4f4f2', '#7a1f2b', '#1c3b5a'];
const PANTS = ['#2d3142', '#111418', '#54606e', '#6b4a2f', '#c9b48f', '#f4f4f2'];
const SHOES = ['#1d1720', '#f4f4f2', '#7a4a2a', '#c8553d'];
const HAIR_STYLES: [NonNullable<AvatarLook['hairStyle']>, string][] = [['curto', 'Curto'], ['topete', 'Topete'], ['longo', 'Longo'], ['coque', 'Coque'], ['black', 'Black'], ['careca', 'Careca']];
const OUTFITS: [NonNullable<AvatarLook['outfit']>, string][] = [['camiseta', 'Camiseta'], ['blazer', 'Blazer'], ['jaleco', 'Jaleco']];

const pick = <T,>(l: readonly T[]) => l[Math.floor(Math.random() * l.length)];

function Swatches({ list, value, onPick }: { list: string[]; value?: string; onPick: (c: string) => void }) {
  return (
    <div className="av-swatches">
      {list.map((c) => <button type="button" key={c} className={value?.toLowerCase() === c.toLowerCase() ? 'on' : ''} style={{ background: c }} title={c} onClick={() => onPick(c)} />)}
      <input type="color" aria-label="Outra cor" value={value ?? '#888888'} onChange={(e) => onPick(e.target.value)} />
    </div>
  );
}

function Spin({ color, look, seed }: { color: string; look: AvatarLook; seed: string }) {
  const state = useRef({ x: 0, z: 0, dir: 0.5, moving: false });
  useFrame((_, dt) => { state.current.dir += dt * 0.7; });
  return <PixelAvatar anchorId={seed} color={color} look={look} p={null as never} getState={() => state.current} />;
}

export interface AvatarValue { name: string; color: string; look: AvatarLook }

export function AvatarEditor({ title, seed, initial, children, onSave, onClose, note, saveLabel = 'Salvar' }: {
  title: string; seed: string; initial: { name: string; color: string; look?: AvatarLook | null };
  children?: React.ReactNode; note?: string; saveLabel?: string;
  onSave: (v: AvatarValue) => Promise<void> | void; onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  const [look, setLook] = useState<AvatarLook>(() => resolveLook(seed, initial.look));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<AvatarLook>) => setLook((l) => ({ ...l, ...patch }));
  const previewSeed = useMemo(() => `previa:${seed}`, [seed]);
  const random = () => {
    setColor(pick(SHIRTS));
    setLook({ skin: pick(SKINS), hair: pick(HAIRS), hairStyle: pick(HAIR_STYLES)[0], beard: Math.random() < 0.3, glasses: Math.random() < 0.3, outfit: pick(OUTFITS)[0], pants: pick(PANTS), shoes: pick(SHOES) });
  };
  return (
    <div className="modal-bg top" onClick={onClose}>
      <form className="modal av-editor" onClick={(e) => e.stopPropagation()} onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr('');
        try { await onSave({ name: name.trim(), color, look }); onClose(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
      }}>
        <header className="modal-head"><h3>{title}</h3><button type="button" className="icon" onClick={onClose}><X size={16} /></button></header>
        <div className="modal-body av-body">
          <div className="av-preview">
            <Canvas flat dpr={1} gl={{ antialias: false }} className="av-canvas">
              <OrthographicCamera makeDefault position={[6, 5.6, 6]} zoom={78} onUpdate={(c) => c.lookAt(0, 1, 0)} />
              <ambientLight intensity={2.2} />
              <directionalLight position={[3, 6, 4]} intensity={1.4} />
              <Spin color={color} look={look} seed={previewSeed} />
            </Canvas>
            <button type="button" className="ghost small" onClick={random}><Dices size={14} /> Sortear</button>
          </div>
          <div className="stack av-fields">
            <label>Nome<input required minLength={2} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} /></label>
            {note && <p className="muted small" style={{ margin: 0 }}>{note}</p>}
            {children}
            <div><span className="av-label">Pele</span><Swatches list={SKINS} value={look.skin} onPick={(skin) => set({ skin })} /></div>
            <div>
              <span className="av-label">Cabelo</span>
              <div className="chips">{HAIR_STYLES.map(([id, label]) => <button type="button" key={id} className={`chip ${look.hairStyle === id ? 'on' : ''}`} onClick={() => set({ hairStyle: id })}>{label}</button>)}</div>
              {look.hairStyle !== 'careca' && <Swatches list={HAIRS} value={look.hair} onPick={(hair) => set({ hair })} />}
            </div>
            <div className="row gap">
              <label className="check"><input type="checkbox" checked={!!look.beard} onChange={(e) => set({ beard: e.target.checked })} /> Barba</label>
              <label className="check"><input type="checkbox" checked={!!look.glasses} onChange={(e) => set({ glasses: e.target.checked })} /> Óculos</label>
            </div>
            <div>
              <span className="av-label">Roupa</span>
              <div className="chips">{OUTFITS.map(([id, label]) => <button type="button" key={id} className={`chip ${look.outfit === id ? 'on' : ''}`} onClick={() => set({ outfit: id })}>{label}</button>)}</div>
              <Swatches list={SHIRTS} value={color} onPick={setColor} />
            </div>
            <div><span className="av-label">Calça</span><Swatches list={PANTS} value={look.pants} onPick={(pants) => set({ pants })} /></div>
            <div><span className="av-label">Sapato</span><Swatches list={SHOES} value={look.shoes} onPick={(shoes) => set({ shoes })} /></div>
            {err && <div className="error">{err}</div>}
          </div>
        </div>
        <footer className="modal-foot"><span /><div className="row gap"><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Salvando…' : saveLabel}</button></div></footer>
      </form>
    </div>
  );
}
