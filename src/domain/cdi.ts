import { Calendario, diaNum, indiceInferior, isISODate, somaDias } from './datas';
import type { CdiDia, ISODate, Parametros } from './types';

/**
 * CDI realizado dia a dia. Cada dia útil d em [início, fim) rende (1 + taxa_diária(d) × percentual),
 * onde taxa_diária(d) = (1 + CDI anual publicado para d)^(1/252) − 1. Dias úteis sem CDI publicado
 * (o futuro, ou uma lacuna) usam a taxa de projeção.
 */
export class HistoricoCdi {
  private dias: number[] = [];
  private taxas: number[] = [];

  constructor(serie: CdiDia[], cal: Calendario, p: Parametros) {
    const porDia = new Map<number, number>();
    for (const c of serie) {
      if (!isISODate(c.data) || !Number.isFinite(c.anual) || c.anual <= -1 || !cal.ehDiaUtil(c.data)) continue;
      porDia.set(diaNum(c.data), taxaDiaria(c.anual, p));
    }
    this.dias = [...porDia.keys()].sort((a, b) => a - b);
    this.taxas = this.dias.map((d) => porDia.get(d) as number);
  }

  /** Dias úteis de [inicio, fim) com CDI realizado. */
  diasReais(inicio: ISODate, fim: ISODate): number {
    return Math.max(0, indiceInferior(this.dias, diaNum(fim)) - indiceInferior(this.dias, diaNum(inicio)));
  }

  /** Produto de (1 + taxa_diária × percentual) nos dias de [inicio, fim) com CDI realizado. */
  fatorReal(inicio: ISODate, fim: ISODate, percentual: number): number {
    const i0 = indiceInferior(this.dias, diaNum(inicio));
    const i1 = indiceInferior(this.dias, diaNum(fim));
    let f = 1;
    for (let i = i0; i < i1; i++) f *= 1 + this.taxas[i] * percentual;
    return f;
  }
}

export function taxaDiaria(cdiAnual: number, p: Parametros): number {
  return Math.pow(1 + cdiAnual, 1 / p.diasUteisAno) - 1;
}

const cache = new WeakMap<CdiDia[], WeakMap<Calendario, HistoricoCdi>>();

/** Histórico do CDI de `p` para o calendário `cal` (construído uma vez por par). */
export function historicoCdi(p: Parametros, cal: Calendario): HistoricoCdi {
  const serie = Array.isArray(p.cdiDiario) ? p.cdiDiario : [];
  let porCal = cache.get(serie);
  if (!porCal) cache.set(serie, (porCal = new WeakMap()));
  let h = porCal.get(cal);
  if (!h) porCal.set(cal, (h = new HistoricoCdi(serie, cal, p)));
  return h;
}

/**
 * Lê a resposta JSON do SGS do Banco Central (`[{ data: 'dd/mm/aaaa', valor: '13.65' }]`, % a.a.).
 * Linhas inválidas são ignoradas.
 */
export function lerSerieBcb(json: unknown): CdiDia[] {
  if (!Array.isArray(json)) throw new Error('Resposta inesperada do Banco Central.');
  const out: CdiDia[] = [];
  for (const item of json) {
    const m = typeof item?.data === 'string' ? item.data.match(/^(\d{2})\/(\d{2})\/(\d{4})$/) : null;
    const v = Number(String(item?.valor ?? '').replace(',', '.'));
    if (!m || !String(item?.valor ?? '').trim() || !Number.isFinite(v)) continue;
    const data = `${m[3]}-${m[2]}-${m[1]}`;
    if (isISODate(data)) out.push({ data, anual: v / 100 });
  }
  return out;
}

/** Junta séries: o valor novo de uma data substitui o antigo (o BCB pode revisar). Saída ordenada. */
export function mesclarCdi(atual: CdiDia[], novos: CdiDia[]): CdiDia[] {
  const m = new Map<ISODate, number>();
  for (const c of [...atual, ...novos]) m.set(c.data, c.anual);
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([data, anual]) => ({ data, anual }));
}

export function ultimoCdi(serie: CdiDia[]): CdiDia | null {
  return serie.length ? serie.reduce((u, c) => (c.data > u.data ? c : u)) : null;
}

/**
 * Data a partir da qual consultar o Banco Central: desde o aporte mais antigo quando o histórico ainda
 * não o cobre; senão, só os últimos dias (com folga para revisões).
 */
export function inicioConsulta(serie: CdiDia[], aporteMaisAntigo: ISODate | null, hoje: ISODate, folgaDias: number): ISODate {
  const alvo = aporteMaisAntigo && aporteMaisAntigo < hoje ? aporteMaisAntigo : somaDias(hoje, -folgaDias);
  if (!serie.length) return alvo;
  const primeiro = serie.reduce((m, c) => (c.data < m ? c.data : m), serie[0].data);
  if (alvo < primeiro) return alvo;
  const ultimo = ultimoCdi(serie)!.data;
  const recente = somaDias(ultimo, -folgaDias);
  return recente < alvo ? alvo : recente;
}

export const FONTE_CDI_BCB = 'Banco Central do Brasil, SGS 4389 (CDI anualizado, base 252)';

/**
 * Aplica uma consulta ao Banco Central: mescla o histórico e, com `cdiAutomatico`, faz o CDI de projeção
 * acompanhar o último CDI publicado.
 */
export function aplicarConsultaCdi(p: Parametros, novos: CdiDia[], hoje: ISODate): Parametros {
  const cdiDiario = mesclarCdi(p.cdiDiario ?? [], novos);
  const u = ultimoCdi(cdiDiario);
  const out: Parametros = { ...p, cdiDiario, cdiAtualizadoEm: hoje };
  if (p.cdiAutomatico && u) Object.assign(out, { cdiAnual: u.anual, cdiData: u.data, cdiFonte: FONTE_CDI_BCB });
  return out;
}
