import { migrarDados } from './migracao';
import { normalizarParametros } from './padroes';
import type { Dados, Parametros } from './types';

/**
 * O que vai para a nuvem: os dados do usuário. Ficam de fora os dados públicos que cada aparelho baixa
 * sozinho (histórico do CDI e, com `cdiAutomatico`, o CDI de projeção), para que a atualização diária do
 * CDI não conte como alteração nem gere conflito entre aparelhos.
 */
export function paraNuvem(d: Dados): Dados {
  const { cdiDiario: _h, cdiAtualizadoEm: _a, ...resto } = d.parametros;
  const parametros = { ...resto } as Partial<Parametros>;
  if (d.parametros.cdiAutomatico) {
    delete parametros.cdiAnual;
    delete parametros.cdiData;
    delete parametros.cdiFonte;
  }
  // `versao` vem do próprio objeto: aplicado ao bruto salvo (v1 ou v2), reproduz a impressão que o app antigo assinou.
  return { versao: d.versao, aportes: d.aportes, parametros: parametros as Parametros };
}

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

/** JSON com chaves ordenadas: a mesma informação gera o mesmo texto em qualquer aparelho. */
export function jsonEstavel(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonEstavel).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${jsonEstavel((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** Impressão digital (FNV-1a de 53 bits) da parte sincronizada, para saber se há alteração a enviar. */
export function impressao(d: Dados): string {
  const s = jsonEstavel(paraNuvem(d));
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}:${s.length}`;
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

/** O que fazer num ciclo de sincronização. Nunca envia por cima do cofre quando os dados locais eram ilegíveis. */
export function decidirCiclo(s: SituacaoCiclo): 'aplicar' | 'enviar' | 'conflito' | 'nada' {
  if (s.remotoIgualLocal) return 'aplicar';
  if (s.ilegivel) return s.editadoDesdeIlegivel ? 'conflito' : 'aplicar';
  if (s.versaoRemota !== s.versaoLocal) return s.pendente ? 'conflito' : 'aplicar';
  return s.pendente ? 'enviar' : 'nada';
}
