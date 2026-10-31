import { feriadosNacionais } from './datas';
import { CALENDARIO_ANBIMA } from './feriadosAnbima';
import type { Aporte, Classe, Dados, Parametros, RegimeTributario } from './types';

/** Versão dos regimes padrão abaixo. Mude ao corrigir um regime: regimes salvos sem edição recebem a correção. */
export const REGIMES_VERSAO = '2026-10-31';

const CDB_RDB_LC = 'IR regressivo: Lei 11.033/2004, art. 1º, e Lei 9.779/1999, art. 5º. IOF regressivo: Decreto 6.306/2007, art. 32, §1º, I. Sem carência mínima legal.';

/**
 * Regime tributário de cada classe, conferido em fonte oficial em 31/10/2026 (CLAUDE.md seções 3.6 e 4).
 * Carência em meses contados da data do aporte.
 */
export function regimesPadrao(): Record<Classe, RegimeTributario> {
  const regime = (r: Omit<RegimeTributario, 'carenciaMinimaMeses' | 'carenciaMinimaMesesIndicePrecos'> & Partial<RegimeTributario>): RegimeTributario => ({
    carenciaMinimaMeses: 0,
    carenciaMinimaMesesIndicePrecos: null,
    ...r,
  });
  return {
    CDB: regime({
      ir: 'regressivo',
      iof: true,
      fgc: true,
      fonte: `${CDB_RDB_LC} FGC: Res. CMN 4.222/2013, Anexo II, art. 2º, III (depósito a prazo, com ou sem certificado). Conferido em 31/10/2026.`,
    }),
    RDB: regime({
      ir: 'regressivo',
      iof: true,
      fgc: true,
      fonte: `${CDB_RDB_LC} FGC: Res. CMN 4.222/2013, Anexo II, art. 2º, III (depósito a prazo, com ou sem certificado). Conferido em 31/10/2026.`,
    }),
    LC: regime({
      ir: 'regressivo',
      iof: true,
      fgc: true,
      fonte: `${CDB_RDB_LC} FGC: Res. CMN 4.222/2013, Anexo II, art. 2º, V (letras de câmbio). Conferido em 31/10/2026.`,
    }),
    LCI: regime({
      ir: 'isento',
      iof: true,
      fgc: true,
      carenciaMinimaMeses: 6,
      carenciaMinimaMesesIndicePrecos: 36,
      fonte:
        'IR isento: Lei 11.033/2004, art. 3º, II (a MP 1.303/2025 caducou em 08/10/2025, ADC 67/2025). IOF: fora da alíquota zero do Decreto 6.306/2007, art. 32, §2º (na prática nulo, pela carência). Carência mínima: 6 meses; 36 meses se corrigida mensalmente por índice de preços (Res. CMN 4.410/2015, art. 4º, com redação das Res. CMN 5.119/2024 e 5.215/2025). FGC: sim (Res. CMN 4.222/2013, Anexo II). Conferido em 31/10/2026.',
    }),
    LCA: regime({
      ir: 'isento',
      iof: false,
      fgc: true,
      carenciaMinimaMeses: 6,
      carenciaMinimaMesesIndicePrecos: 12,
      fonte:
        'IR isento: Lei 11.033/2004, art. 3º, IV. IOF: alíquota zero, Decreto 6.306/2007, art. 32, §2º, V. Carência mínima: 6 meses; 12 meses com índice de preços (Res. CMN 5.006/2022, art. 2º, com redação das Res. CMN 5.119/2024 e 5.215/2025). FGC: Res. CMN 4.222/2013, Anexo II, art. 2º, VIII. Conferido em 31/10/2026.',
    }),
    Outro: regime({
      ir: 'regressivo',
      iof: true,
      fgc: true,
      fonte: 'Sem regra própria: segue o CDB, como o app tratava todo lote antes das classes (outubro/2026).',
    }),
  };
}

/**
 * Regimes padrão de versões anteriores, como foram gravados, para reconhecer regimes salvos sem edição.
 * '' = Fase 1 (sem `regimesVersao`, carência em dias).
 */
const REGIMES_ANTERIORES: Record<string, Record<string, unknown>> = {
  '': {
    CDB: {
      ir: 'regressivo',
      iof: true,
      fgc: true,
      carenciaMinimaDias: 0,
      fonte: 'Receita Federal (IR renda fixa 2026), Portal do Investidor/CVM (IOF), FGC (garantia ordinária); revisado em outubro/2026',
    },
    Outro: {
      ir: 'regressivo',
      iof: true,
      fgc: true,
      carenciaMinimaDias: 0,
      fonte: 'Sem regra própria: segue o CDB, como o app tratava todo lote até outubro/2026',
    },
  },
};

/**
 * Premissas iniciais (CLAUDE.md seções 4 e 5, revisadas em outubro/2026).
 * CDI inicial = valor que estava na planilha (13,90%), sem data/fonte. Com `cdiAutomatico`, o app o troca
 * pelo último CDI do Banco Central na primeira consulta bem-sucedida.
 * IPCA projetado começa vazio: é estimativa e precisa ser informada.
 */
export function parametrosPadrao(): Parametros {
  return {
    cdiAnual: 0.139,
    cdiData: '',
    cdiFonte: '',
    cdiAutomatico: true,
    cdiDiario: [],
    cdiAtualizadoEm: '',
    ipcaProjetado: null,
    ipcaData: '',
    ipcaFonte: '',
    diasUteisAno: 252,
    tabelaIR: [
      { aPartirDeDias: 0, aliquota: 0.225 },
      { aPartirDeDias: 181, aliquota: 0.2 },
      { aPartirDeDias: 361, aliquota: 0.175 },
      { aPartirDeDias: 721, aliquota: 0.15 },
    ],
    tabelaIOF: [
      0.96, 0.93, 0.9, 0.86, 0.83, 0.8, 0.76, 0.73, 0.7, 0.66, 0.63, 0.6, 0.56, 0.53, 0.5, 0.46, 0.43, 0.4, 0.36,
      0.33, 0.3, 0.26, 0.23, 0.2, 0.16, 0.13, 0.1, 0.06, 0.03, 0,
    ],
    regimes: regimesPadrao(),
    regimesVersao: REGIMES_VERSAO,
    fgcLimitePorInstituicao: 250_000,
    fgcLimiteGlobal4Anos: 1_000_000,
    fgcAlertaFracao: 0.8,
    alertaVencimentoDias: [30, 90],
    feriados: [...CALENDARIO_ANBIMA.feriados],
    feriadosFonte: CALENDARIO_ANBIMA.fonte,
    feriadosVersao: CALENDARIO_ANBIMA.versao,
    premissasVersao: '31/10/2026',
    premissasFonte:
      'Receita Federal (IR renda fixa 2026; Lei 11.033/2004 e Lei 9.779/1999), Decreto 6.306/2007 (IOF), FGC (Res. CMN 4.222/2013), carência de LCI e LCA (Res. CMN 4.410/2015 e 5.006/2022, com redação das Res. CMN 5.119/2024 e 5.215/2025)',
  };
}

/**
 * Parâmetros salvos (localStorage ou backup) completados com os padrões, sem perder o que o usuário configurou.
 * Dados anteriores ao calendário ANBIMA que ainda usam a lista gerada antiga (2020–2040, sem edição) passam
 * para a lista ANBIMA completa; uma lista editada pelo usuário é mantida.
 */
export function normalizarParametros(salvo: Partial<Parametros> | undefined): Parametros {
  const p: Parametros = { ...parametrosPadrao(), ...salvo };
  if (!Array.isArray(p.cdiDiario)) p.cdiDiario = [];
  p.regimes = normalizarRegimes(salvo?.regimes, salvo?.regimesVersao);
  p.regimesVersao = REGIMES_VERSAO;
  if (salvo && salvo.feriadosFonte === undefined) {
    const antiga = feriadosNacionais(2020, 2040);
    const igual = Array.isArray(salvo.feriados) && salvo.feriados.length === antiga.length && salvo.feriados.every((d, i) => d === antiga[i]);
    if (igual) {
      p.feriados = [...CALENDARIO_ANBIMA.feriados];
      p.feriadosFonte = CALENDARIO_ANBIMA.fonte;
      p.feriadosVersao = CALENDARIO_ANBIMA.versao;
    } else {
      p.feriadosFonte = 'Lista editada pelo usuário';
      p.feriadosVersao = '';
    }
  }
  return p;
}

/** JSON com chaves ordenadas, para comparar regimes sem depender da ordem dos campos. */
function textoEstavel(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(textoEstavel).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${textoEstavel(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** Campos de versões anteriores no formato atual: a Fase 1 guardava a carência em dias. */
function camposAtuais(r: Record<string, unknown>): Partial<RegimeTributario> {
  const { carenciaMinimaDias, ...resto } = r;
  if (typeof carenciaMinimaDias === 'number' && resto.carenciaMinimaMeses === undefined) {
    // Arredonda para cima (meses de 28 dias): a conversão nunca encurta uma carência. A Fase 1 só gravava 0.
    resto.carenciaMinimaMeses = carenciaMinimaDias > 0 ? Math.ceil(carenciaMinimaDias / 28) : 0;
  }
  return resto as Partial<RegimeTributario>;
}

/**
 * Regimes salvos completados com os padrões. Um regime salvo igual ao padrão da versão em que foi gravado
 * (o usuário não editou) recebe o padrão atual; um regime editado é mantido. Classes desconhecidas
 * (de uma versão mais nova do app) são mantidas.
 */
function normalizarRegimes(salvo: unknown, versaoSalva: unknown): Record<Classe, RegimeTributario> {
  const padrao = regimesPadrao();
  if (!salvo || typeof salvo !== 'object') return padrao;
  const r = salvo as Record<string, unknown>;
  const anteriores = versaoSalva === REGIMES_VERSAO ? null : REGIMES_ANTERIORES[typeof versaoSalva === 'string' ? versaoSalva : ''];
  const out: Record<string, RegimeTributario> = {};
  for (const [c, v] of Object.entries(r)) {
    if (v && typeof v === 'object') {
      out[c] = { carenciaMinimaMeses: 0, carenciaMinimaMesesIndicePrecos: null, ...camposAtuais(v as Record<string, unknown>) } as RegimeTributario;
    }
  }
  for (const c of Object.keys(padrao) as Classe[]) {
    const v = r[c];
    const semEdicao = !!anteriores && anteriores[c] !== undefined && textoEstavel(v) === textoEstavel(anteriores[c]);
    out[c] = !v || typeof v !== 'object' || semEdicao ? padrao[c] : { ...padrao[c], ...camposAtuais(v as Record<string, unknown>) };
  }
  return out as Record<Classe, RegimeTributario>;
}

export function dadosVazios(): Dados {
  return { versao: 2, aportes: [], parametros: parametrosPadrao() };
}

export function novoAporte(parcial: Partial<Aporte> = {}): Aporte {
  return {
    id: crypto.randomUUID(),
    instituicao: '',
    emissor: '',
    conglomerado: '',
    produto: '',
    classe: 'CDB',
    observacoes: '',
    dataAporte: '',
    valor: 0,
    vencimento: '',
    status: 'Ativo',
    liquidez: 'Diária',
    permiteResgateAntecipado: true,
    carenciaAte: '',
    indexador: 'CDI',
    pctCdi: 1,
    pctCdiPromo: null,
    diasPromo: 0,
    taxaPre: null,
    spreadIpca: null,
    regraPromocional: '',
    cdiProjecao: null,
    resgate: null,
    ...parcial,
  };
}

export const CLASSES = [
  { valor: 'CDB', rotulo: 'CDB' },
  { valor: 'RDB', rotulo: 'RDB' },
  { valor: 'LC', rotulo: 'LC' },
  { valor: 'LCI', rotulo: 'LCI' },
  { valor: 'LCA', rotulo: 'LCA' },
  { valor: 'Outro', rotulo: 'Outra renda fixa' },
] as const;
export const LIQUIDEZES = ['Diária', 'No vencimento', 'Após carência', 'Outra'] as const;
export const STATUS_MANUAIS = ['Ativo', 'Planejado', 'Resgatado'] as const;
export const INDEXADORES = [
  { valor: 'CDI', rotulo: '% do CDI' },
  { valor: 'PRE', rotulo: 'Prefixado' },
  { valor: 'IPCA', rotulo: 'IPCA + taxa' },
] as const;
