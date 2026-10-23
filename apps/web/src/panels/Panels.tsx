import { useStore } from '../lib/store';
import { Demands } from './Demands';
import { CalendarPanel } from './CalendarPanel';
import { Finance } from './Finance';
import { AgentPanel } from './AgentPanel';
import { VideoStudio } from './VideoStudio';
import { Team, Activity } from './Team';

export const PAGE_TITLE = {
  escritorio: 'Escritório',
  demandas: 'Demandas',
  calendario: 'Calendário',
  financeiro: 'Financeiro',
  video: 'Estúdio de vídeo',
  agente: 'Funcionário',
  equipe: 'Equipe',
  atividade: 'Atividade',
} as const;

/** Páginas que aparecem no lugar do mundo 3D (o mundo continua montado, pausado, por trás). */
export function Pages() {
  const panel = useStore((s) => s.panel);
  const flush = panel === 'agente' || panel === 'video';
  return (
    <div className={`page-body ${flush ? 'flush' : ''}`} style={{ position: 'absolute', inset: 0 }}>
      {panel === 'demandas' && <Demands />}
      {panel === 'calendario' && <CalendarPanel />}
      {panel === 'financeiro' && <Finance />}
      {panel === 'agente' && <AgentPanel />}
      {panel === 'video' && <VideoStudio />}
      {panel === 'equipe' && <Team />}
      {panel === 'atividade' && <Activity />}
    </div>
  );
}
