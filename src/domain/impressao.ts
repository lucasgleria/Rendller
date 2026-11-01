import type { Dados, Parametros } from './types';

// O que sincroniza e a impressão digital dos dados. Sem dependências de outros módulos do domínio.

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

