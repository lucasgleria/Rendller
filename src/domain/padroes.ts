import { feriadosNacionais } from './datas';
import { CALENDARIO_ANBIMA } from './feriadosAnbima';
import type { Aporte, Classe, Dados, Parametros, RegimeTributario } from './types';

/**
 * Regimes por classe. Nesta etapa só repetem o comportamento anterior (todo lote com IR regressivo, IOF e FGC);
 * regras novas de outras classes só entram depois de conferidas na fonte oficial.
 */
export function regimesPadrao(): Record<Classe, RegimeTributario> {
  return {
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
  };
}

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
    fgcLimitePorInstituicao: 250_000,
    fgcLimiteGlobal4Anos: 1_000_000,
    fgcAlertaFracao: 0.8,
    alertaVencimentoDias: [30, 90],
    feriados: [...CALENDARIO_ANBIMA.feriados],
    feriadosFonte: CALENDARIO_ANBIMA.fonte,
    feriadosVersao: CALENDARIO_ANBIMA.versao,
    premissasVersao: 'outubro/2026',
    premissasFonte: 'Receita Federal (IR renda fixa 2026), Portal do Investidor/CVM (IOF), FGC (garantia ordinária)',
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
  p.regimes = normalizarRegimes(salvo?.regimes);
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

/** Completa cada classe com o regime padrão; classes desconhecidas (de uma versão mais nova) são mantidas. */
function normalizarRegimes(salvo: unknown): Record<Classe, RegimeTributario> {
  const padrao = regimesPadrao();
  const r = salvo && typeof salvo === 'object' ? (salvo as Partial<Record<Classe, Partial<RegimeTributario>>>) : {};
  const out = { ...r } as Record<Classe, RegimeTributario>;
  for (const c of Object.keys(padrao) as Classe[]) {
    out[c] = r[c] && typeof r[c] === 'object' ? { ...padrao[c], ...r[c] } : padrao[c];
  }
  return out;
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
  { valor: 'Outro', rotulo: 'Outra renda fixa' },
] as const;
export const LIQUIDEZES = ['Diária', 'No vencimento', 'Após carência', 'Outra'] as const;
export const STATUS_MANUAIS = ['Ativo', 'Planejado', 'Resgatado'] as const;
export const INDEXADORES = [
  { valor: 'CDI', rotulo: '% do CDI' },
  { valor: 'PRE', rotulo: 'Prefixado' },
  { valor: 'IPCA', rotulo: 'IPCA + taxa' },
] as const;
