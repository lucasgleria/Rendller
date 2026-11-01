import { normalizarParametros } from './padroes';
import { impressao } from './sincronia';
import type { Aporte, Classe, Dados, Parametros } from './types';

/** Versão do formato que este app grava. Versões menores são migradas; maiores são recusadas. */
const VERSAO_ATUAL = 2;

/** Classe de um aporte da versão 1, a partir do antigo `tipo` (que misturava classe e indexador). */
export function classeDoTipoV1(tipo: unknown): Classe {
  return tipo === 'CDB Pós-fixado' || tipo === 'CDB Prefixado' || tipo === 'CDB IPCA+' ? 'CDB' : 'Outro';
}

/** Um aporte salvo em qualquer versão conhecida (v1 com `tipo` ou v2), no formato atual. */
export function migrarAporte(bruto: unknown): Aporte {
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

// ---------- migração para a conta (Fase 5) ----------

/** De onde vêm os dados na migração para a conta. */
export type OrigemDados = 'navegador' | 'cofre-antigo' | 'conta';

export interface Candidato {
  origem: OrigemDados;
  dados: Dados;
  aportes: number;
}

export type PlanoMigracao =
  | { acao: 'nada' } // tudo igual ao que está na conta (ou tudo vazio)
  | { acao: 'enviar'; dados: Dados; origem: OrigemDados }
  | { acao: 'baixar'; dados: Dados } // a conta tem dados; este aparelho não tem outra versão
  | { acao: 'escolher'; candidatos: Candidato[] }; // há mais de uma versão diferente com aportes

/**
 * Decide a migração sem efeitos. Candidato sem aportes é "vazio" e nunca vence quem tem aportes; candidatos com a
 * mesma impressão contam como um só (a conta prevalece no rótulo). Nunca funde: cada candidato leva os dados
 * inteiros da sua origem.
 */
export function planejarMigracao(navegador: Dados, cofreAntigo: Dados | null, conta: Dados | null): PlanoMigracao {
  const todos: Candidato[] = [
    { origem: 'navegador' as const, dados: navegador },
    ...(cofreAntigo ? [{ origem: 'cofre-antigo' as const, dados: cofreAntigo }] : []),
    ...(conta ? [{ origem: 'conta' as const, dados: conta }] : []),
  ].map((c) => ({ ...c, aportes: c.dados.aportes.length }));

  const grupos = new Map<string, Candidato>();
  for (const c of todos.filter((x) => x.aportes > 0)) {
    const chave = impressao(c.dados);
    const ja = grupos.get(chave);
    if (!ja) grupos.set(chave, c);
    else if (c.origem === 'conta') grupos.set(chave, { ...ja, origem: 'conta', dados: c.dados });
  }
  const distintos = [...grupos.values()];

  if (distintos.length === 0) return { acao: 'nada' };
  if (distintos.length > 1) return { acao: 'escolher', candidatos: distintos };
  const [unico] = distintos;
  if (unico.origem === 'conta') return impressao(navegador) === impressao(unico.dados) ? { acao: 'nada' } : { acao: 'baixar', dados: unico.dados };
  return { acao: 'enviar', dados: unico.dados, origem: unico.origem };
}
