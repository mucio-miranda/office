import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Vec2 } from '@office/shared';
import { useStore } from '../lib/store';
import { beacon, cam, myDesk, player, recenter } from './World';
import { DESKS, HUMAN_DESKS, deskSeat } from './layout';

/**
 * Tour guiado do primeiro acesso: a gerente (Rafa) apresenta o escritório em poucos passos.
 * A câmera voa até cada ponto (o personagem fica onde está) e um farol pulsa no chão.
 */
interface Step { title: string; body: ReactNode; focus: Vec2; zoom: number; spot?: boolean }

const seenKey = (userId: string) => `office.tour.${userId}`;

/** Já viu (ou pulou) o tour neste computador? */
export function tourSeen(userId: string) {
  try { return localStorage.getItem(seenKey(userId)) === '1'; } catch { return true; }
}

export function startTour() {
  useStore.setState({ panel: null, panelArg: null, tour: 0 });
}

function useSteps(): Step[] {
  const { agents, user, office, members } = useStore();
  const rafa = agents.find((a) => a.slug === 'gerente') ?? agents[0];
  const team = agents.filter((a) => a !== rafa);
  const mine = myDesk();
  const taken = new Set(members.map((m) => m.desk));
  const free = HUMAN_DESKS.find((d) => !taken.has(d.id));
  const desk = mine ?? free;
  return [
    {
      title: `Oi, ${user?.name.split(' ')[0]}! Eu sou ${rafa ? `a ${rafa.name}` : 'a gerente'}.`,
      body: <>Cuido da gerência e das contas do <b>{office?.name}</b>. Em um minuto te mostro onde fica cada coisa.</>,
      focus: rafa ? DESKS[rafa.room] : { x: 0, z: -9 }, zoom: 46, spot: true,
    },
    {
      title: 'O escritório tem 7 salas',
      body: <>Aperte <kbd>1</kbd> a <kbd>7</kbd> para ir direto a qualquer uma, ou clique no mapa do canto. Para andar, use <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> ou clique no chão.</>,
      focus: { x: 0, z: 0 }, zoom: 13,
    },
    {
      title: 'A equipe de IA',
      body: (
        <>
          {team.map((a, i) => <span key={a.id}>{i > 0 && (i === team.length - 1 ? ' e ' : ', ')}<b style={{ color: a.color }}>{a.name}</b> ({a.role.toLowerCase()})</span>)}.
          {' '}O anel no chão mostra o status: azul é trabalhando, amarelo é <b>precisa de você</b>. Chegue perto e aperte <kbd>E</kbd> para conversar.
        </>
      ),
      focus: { x: 4.5, z: 1.5 }, zoom: 16,
    },
    {
      title: mine ? 'Esta é a sua mesa' : 'Escolha a sua mesa',
      body: mine
        ? <>Você sempre entra sentado aqui. De qualquer lugar, <kbd>M</kbd> te traz de volta. Quando você sai, a mesa mostra seu nome e status.</>
        : <>As mesas do espaço aberto são das pessoas. Chegue perto de uma livre e aperte <kbd>E</kbd> para ficar com ela; depois <kbd>M</kbd> te traz de volta de qualquer lugar.</>,
      focus: desk ? deskSeat(desk) : { x: 0, z: 6 }, zoom: 44, spot: !!desk,
    },
    {
      title: 'Atalhos que valem ouro',
      body: (
        <ul className="tour-keys">
          <li><kbd>Ctrl</kbd><kbd>K</kbd> busca tudo: salas, pessoas, demandas e clientes</li>
          <li>Segurar o botão direito (ou <kbd>Espaço</kbd>) e arrastar sobrevoa o escritório sem mexer o avatar</li>
          <li><kbd>B</kbd> demandas · <kbd>C</kbd> calendário · <kbd>F</kbd> financeiro · <kbd>V</kbd> vídeo</li>
          <li><kbd>T</kbd> abre o chat · <kbd>O</kbd> volta para o escritório</li>
        </ul>
      ),
      focus: { x: player.x, z: player.z }, zoom: 38,
    },
    {
      title: 'Como delegar a primeira demanda',
      body: (
        <ol className="tour-keys">
          <li>Crie a demanda no quadro (<kbd>B</kbd>) com cliente, prazo e o que precisa.</li>
          <li>Clique no robô do cartão e escolha o funcionário de IA.</li>
          <li>Ele trabalha sozinho e para nos checkpoints. O aviso "precisa da sua aprovação" te leva até ele.</li>
        </ol>
      ),
      focus: { x: 0, z: -15.3 }, zoom: 40, spot: true,
    },
  ];
}

export function Tour() {
  const step = useStore((s) => s.tour);
  const steps = useSteps();
  const saved = useRef<number | null>(null);
  const s = step === null ? null : steps[step];

  const finish = (then?: () => void) => {
    const uid = useStore.getState().user?.id;
    if (uid) { try { localStorage.setItem(seenKey(uid), '1'); } catch { /* ok */ } }
    useStore.setState({ tour: null });
    then?.();
  };

  // a câmera voa até o ponto do passo; no fim volta para você no zoom de antes
  useEffect(() => {
    if (!s) return;
    if (saved.current === null) saved.current = cam.zoom;
    cam.follow = false;
    // o ponto fica um pouco acima do meio da tela, longe do cartão (≈ 90 px; 0.755 = inclinação da câmera)
    const k = 90 / s.zoom / 0.755;
    cam.tx = s.focus.x + Math.cos(cam.angle) * k; cam.tz = s.focus.z + Math.sin(cam.angle) * k;
    cam.zoom = s.zoom;
    beacon.on = !!s.spot; beacon.x = s.focus.x; beacon.z = s.focus.z;
  }, [step]);
  useEffect(() => {
    if (step !== null) return;
    beacon.on = false;
    if (saved.current !== null) { cam.zoom = saved.current; saved.current = null; recenter(); }
  }, [step]);

  // ← → navegam, Esc pula (antes dos atalhos do escritório)
  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (step + 1 < steps.length) useStore.setState({ tour: step + 1 });
        else finish();
      } else if (e.key === 'ArrowLeft') useStore.setState({ tour: Math.max(0, step - 1) });
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [step, steps.length]);

  if (!s || step === null) return null;
  const rafa = useStore.getState().agents.find((a) => a.slug === 'gerente');
  const last = step === steps.length - 1;
  return (
    <div className="tour" role="dialog" aria-label="Tour do escritório">
      <div className="tour-head">
        <span className="avatar" style={{ background: rafa?.color ?? 'var(--foreground)' }}>{rafa?.name[0] ?? 'R'}</span>
        <b className="truncate">{s.title}</b>
      </div>
      <div className="tour-body">{s.body}</div>
      <div className="tour-foot">
        <span className="tour-dots">{steps.map((_, i) => <i key={i} className={i === step ? 'on' : ''} />)}</span>
        <span className="spacer" />
        {!last && <button className="ghost small" onClick={() => finish()}>Pular</button>}
        {step > 0 && <button className="small" onClick={() => useStore.setState({ tour: step - 1 })}>Voltar</button>}
        {last
          ? <>
              <button className="small" onClick={() => finish()}>Concluir</button>
              <button className="primary small" onClick={() => finish(() => useStore.getState().open('demandas', 'nova'))}>Criar minha primeira demanda</button>
            </>
          : <button className="primary small" onClick={() => useStore.setState({ tour: step + 1 })}>Próximo</button>}
      </div>
    </div>
  );
}
