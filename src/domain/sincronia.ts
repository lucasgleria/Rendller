import { migrarDados } from './migracao';
import { normalizarParametros } from './padroes';
import { impressao } from './impressao';
import type { Dados, Parametros } from './types';

// Re-exportados daqui por compatibilidade; moram em `impressao.ts` (sem import circular com `migracao.ts`).
export { impressao, jsonEstavel, paraNuvem } from './impressao';

/**
 * Dados vindos da nuvem aplicados neste aparelho, mantendo o CDI público já baixado aqui.
 * Aceita o formato v1 do cofre antigo; versão mais nova que a deste app lança erro (nada é aplicado).
 */
export function daNuvem(remoto: unknown, local: Dados): Dados {
  const r = migrarDados(remoto);
  const lp = local.parametros;
  const publicos: Partial<Parametros> = { cdiDiario: lp.cdiDiario, cdiAtualizadoEm: lp.cdiAtualizadoEm };
  if (r.parametros.cdiAutomatico !== false) Object.assign(publicos, { cdiAnual: lp.cdiAnual, cdiData: lp.cdiData, cdiFonte: lp.cdiFonte });
  return { ...r, parametros: normalizarParametros({ ...r.parametros, ...publicos }) };
}

/**
 * Ao abrir, a migração de formato (v1 → v2) e a normalização (ex.: regimes padrão novos) mudam a impressão sem
 * edição nenhuma. Se a config assinou exatamente os dados salvos (`bruto`, sem edição pendente), passa a assinar
 * os mesmos dados já normalizados; senão fica como está (a edição segue pendente).
 */
export function ajustarImpressaoAposNormalizacao<C extends { impressao: string }>(config: C, bruto: unknown, normalizados: Dados): C {
  return config.impressao === impressao(bruto as Dados) ? { ...config, impressao: impressao(normalizados) } : config;
}

export interface SituacaoCiclo {
  versaoLocal: number; // última versão do cofre que este aparelho conhece
  versaoRemota: number;
  pendente: boolean; // dados locais mudaram desde a última sincronização
  ilegivel: boolean; // dados locais ilegíveis ao abrir e o cofre ainda não foi baixado
  editadoDesdeIlegivel: boolean;
  remotoIgualLocal?: boolean; // conteúdo da nuvem já decifrado e igual ao local
}

export type DecisaoCiclo = 'aplicar' | 'enviar' | 'conflito' | 'nada';

/** O que fazer num ciclo de sincronização. Nunca envia por cima do cofre quando os dados locais eram ilegíveis. */
export function decidirCiclo(s: SituacaoCiclo): DecisaoCiclo {
  if (s.remotoIgualLocal) return 'aplicar';
  if (s.ilegivel) return s.editadoDesdeIlegivel ? 'conflito' : 'aplicar';
  if (s.versaoRemota !== s.versaoLocal) return s.pendente ? 'conflito' : 'aplicar';
  return s.pendente ? 'enviar' : 'nada';
}

export interface EntradaCiclo {
  versaoLocal: number; // versão do cofre que este aparelho conhece (config)
  versaoRemota: number;
  temEnvelope: boolean; // a leitura trouxe conteúdo
  impressaoConfig: string; // impressão dos dados na última sincronização
  impressaoLocal: string;
  impressaoRemota: string | null; // dos dados remotos já decifrados; null = não baixados
  aguardandoCofre: boolean; // dados locais ilegíveis ao abrir e cofre ainda não baixado
  podeGravar: boolean; // o usuário já editou (ou restaurou) desde que os dados ficaram ilegíveis
}

/**
 * Situação de um ciclo, sem efeitos: se o conteúdo remoto precisa ser decifrado e o que fazer com ele.
 * O hook chama duas vezes: antes de decifrar (`impressaoRemota: null`, só para saber `precisaRemoto`) e depois.
 */
export function planejarCiclo(e: EntradaCiclo): { precisaRemoto: boolean; decisao: DecisaoCiclo } {
  const precisaRemoto = e.aguardandoCofre || e.versaoRemota !== e.versaoLocal;
  // precisa do remoto e não há o que baixar: não faz nada (nunca envia às cegas)
  if (precisaRemoto && (!e.temEnvelope || e.impressaoRemota == null)) return { precisaRemoto, decisao: 'nada' };
  const decisao = decidirCiclo({
    versaoLocal: e.versaoLocal,
    versaoRemota: e.versaoRemota,
    pendente: e.impressaoLocal !== e.impressaoConfig,
    ilegivel: e.aguardandoCofre,
    editadoDesdeIlegivel: e.podeGravar,
    remotoIgualLocal: precisaRemoto ? e.impressaoRemota === e.impressaoLocal : undefined,
  });
  return { precisaRemoto, decisao };
}

/** `aguardandoCofre` desliga quando o cofre foi aplicado aqui ou quando o usuário escolheu enviar os dados locais. */
export function aguardandoDepois(aguardando: boolean, evento: 'aplicou' | 'enviou' | 'conflito' | 'nada'): boolean {
  return evento === 'aplicou' || evento === 'enviou' ? false : aguardando;
}
