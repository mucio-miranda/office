import { useStore } from '../lib/store';
import { Demands } from './Demands';
import { CalendarPanel } from './CalendarPanel';
import { Finance } from './Finance';
import { AgentPanel } from './AgentPanel';
import { VideoStudio } from './VideoStudio';
import { Team, Activity } from './Team';

const TITLES = {
  demandas: '🗂️ Quadro de demandas',
  calendario: '📅 Calendário',
  financeiro: '💰 Financeiro e métricas',
  video: '🎬 Estúdio de vídeo',
  agente: '🤖 Funcionário de IA',
  equipe: '👥 Equipe e convites',
  atividade: '📰 Mural de atividade',
} as const;

export function Panels() {
  const { panel, open } = useStore();
  if (!panel) return null;
  const wide = panel === 'demandas' || panel === 'video' || panel === 'calendario';
  return (
    <div className="panel-bg" onClick={() => open(null)}>
      <section className={`panel ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <header className="panel-head">
          <h2>{TITLES[panel]}</h2>
          <button className="ghost" onClick={() => open(null)} title="Fechar (Esc)">✕</button>
        </header>
        <div className="panel-body">
          {panel === 'demandas' && <Demands />}
          {panel === 'calendario' && <CalendarPanel />}
          {panel === 'financeiro' && <Finance />}
          {panel === 'agente' && <AgentPanel />}
          {panel === 'video' && <VideoStudio />}
          {panel === 'equipe' && <Team />}
          {panel === 'atividade' && <Activity />}
        </div>
      </section>
    </div>
  );
}
