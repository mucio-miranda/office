/**
 * Fila dos funcionários. Cada cliente tem uma conversa só, então duas tarefas dele nunca rodam juntas. Vídeo disputa a
 * máquina inteira e o tunning disputa o Chrome e a pasta Downloads: cada um desses roda um por vez.
 */
export interface QueueEntry {
  id: string;
  clientId: string | null;
  lane: 'video' | 'navegador' | null;
  /** Menor passa na frente; empate fica por ordem de chegada. */
  rank: number;
}

/** O Claude Code informa o total acumulado da sessão: numa sessão retomada, o custo da rodada é só a diferença. */
export const turnCost = (reported: number, sessionTotal: number) => (reported >= sessionTotal ? reported - sessionTotal : reported);

export const PRIORITY_RANK: Record<string, number> = { urgente: 0, alta: 2, media: 4, baixa: 6 };

/** Quem está esperando resposta sua volta na frente de quem ainda vai começar, dentro da mesma prioridade. */
export const queueRank = (priority: string | undefined, isReply: boolean) => (PRIORITY_RANK[priority ?? 'media'] ?? 4) - (isReply ? 1 : 0);

export function pickRunnable(queued: QueueEntry[], running: Pick<QueueEntry, 'clientId' | 'lane'>[], max: number) {
  const taken = [...running];
  const picked: string[] = [];
  for (const q of queued.map((e, i) => ({ e, i })).sort((a, b) => a.e.rank - b.e.rank || a.i - b.i).map((x) => x.e)) {
    if (taken.length >= max) break;
    if (q.clientId && taken.some((t) => t.clientId === q.clientId)) continue;
    if (q.lane && taken.some((t) => t.lane === q.lane)) continue;
    taken.push(q);
    picked.push(q.id);
  }
  return picked;
}
