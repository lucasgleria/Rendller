import { normalizarParametros } from './padroes';
import type { Aporte, Classe, Dados, Parametros } from './types';

/** Versão do formato que este app grava. Versões menores são migradas; maiores são recusadas. */
const VERSAO_ATUAL = 2;

/** Classe de um aporte da versão 1, a partir do antigo `tipo` (que misturava classe e indexador). */
export function classeDoTipoV1(tipo: unknown): Classe {
  return tipo === 'CDB Pós-fixado' || tipo === 'CDB Prefixado' || tipo === 'CDB IPCA+' ? 'CDB' : 'Outro';
}

function migrarAporte(bruto: unknown): Aporte {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) throw new Error('Dados inválidos: aporte em formato desconhecido.');
  const { tipo, ...resto } = bruto as Record<string, unknown>;
  // Classe já gravada (inclusive uma que este app ainda não conhece) é mantida; senão vem do antigo `tipo`.
  const classe = typeof resto.classe === 'string' && resto.classe ? resto.classe : classeDoTipoV1(tipo);
  return { ...resto, classe } as Aporte;
}

/**
 * Lê dados salvos em qualquer formato conhecido (`localStorage`, backup .json ou cofre) e devolve a versão atual.
 * Aceita a versão 1 para sempre (ADR-0004). Lança erro para conteúdo inválido ou de uma versão mais nova do app,
 * para que nada seja gravado por cima.
 */
export function migrarDados(obj: unknown): Dados {
  const d = obj as { versao?: unknown; aportes?: unknown; parametros?: unknown } | null;
  if (!d || typeof d !== 'object') throw new Error('Dados inválidos: formato não reconhecido.');
  if (typeof d.versao === 'number' && d.versao > VERSAO_ATUAL) {
    throw new Error('Estes dados foram gravados por uma versão mais nova do app. Atualize a página (recarregue sem cache) antes de abri-los.');
  }
  if ((d.versao !== 1 && d.versao !== 2) || !Array.isArray(d.aportes) || !d.parametros || typeof d.parametros !== 'object') {
    throw new Error('Dados inválidos: formato não reconhecido.');
  }
  return {
    versao: 2,
    aportes: d.aportes.map(migrarAporte),
    // Parâmetros novos (ex.: regimes por classe) ganham o padrão sem perder o que o usuário configurou.
    parametros: normalizarParametros(d.parametros as Partial<Parametros>),
  };
}
