import { Calendario, diasCorridos, minData, somaDias } from './datas';
import type { Aporte, ISODate, Parametros } from './types';

/**
 * Resultado de um lote avaliado numa data.
 * Ordem dos impostos (CLAUDE.md 5.5): bruto → IOF → base IR = rendimento − IOF → IR → líquido.
 */
export interface Avaliacao {
  data: ISODate; // data efetiva da avaliação (limitada ao vencimento)
  diasUteis: number; // usados no rendimento
  diasCorridos: number; // usados no IR e IOF
  bruto: number;
  rendimentoBruto: number;
  pctIof: number;
  iof: number;
  aliquotaIr: number;
  ir: number;
  liquido: number;
  rendimentoLiquido: number;
  rentabilidadeLiquida: number; // rendimento líquido / aporte, no período
  taxaLiquidaAnual: number | null; // (líquido/aporte)^(252/du) − 1
  fase: 'Promocional' | 'Padrão' | null;
  /** false quando falta dado para projetar (ex.: IPCA não informado) */
  calculavel: boolean;
}

export function aliquotaIR(diasCorridos: number, p: Parametros): number {
  const faixas = [...p.tabelaIR].sort((a, b) => a.aPartirDeDias - b.aPartirDeDias);
  let aliq = faixas[0]?.aliquota ?? 0;
  for (const f of faixas) if (diasCorridos >= f.aPartirDeDias) aliq = f.aliquota;
  return aliq;
}

/** IOF só do 1º ao 29º dia corrido; a partir do 30º é zero. */
export function percentualIOF(diasCorridos: number, p: Parametros): number {
  if (diasCorridos <= 0 || diasCorridos >= 30) return 0;
  return p.tabelaIOF[diasCorridos - 1] ?? 0;
}

export function taxaDiariaCDI(cdiAnual: number, p: Parametros): number {
  return Math.pow(1 + cdiAnual, 1 / p.diasUteisAno) - 1;
}

/** Fim da fase promocional (exclusivo): início + dias de promoção. */
export function fimPromocao(a: Aporte): ISODate | null {
  if (a.indexador !== 'CDI' || a.pctCdiPromo == null || !(a.diasPromo > 0)) return null;
  return somaDias(a.dataAporte, a.diasPromo);
}

/**
 * Fator de rendimento bruto entre o aporte e `fim`.
 * Pós-fixado com fases: cada fase com seus próprios dias úteis, fatores multiplicados (nunca média).
 */
export function fatorBruto(a: Aporte, fim: ISODate, p: Parametros, cal: Calendario): { fator: number; du: number; ok: boolean } {
  const inicio = a.dataAporte;
  const du = cal.diasUteis(inicio, fim);
  if (du === 0) return { fator: 1, du: 0, ok: true };

  if (a.indexador === 'CDI') {
    const td = taxaDiariaCDI(a.cdiProjecao ?? p.cdiAnual, p);
    const fp = fimPromocao(a);
    const corte = fp ? minData(fim, fp) : inicio;
    const du1 = fp ? cal.diasUteis(inicio, corte) : 0;
    const du2 = cal.diasUteis(corte, fim);
    const f1 = fp ? Math.pow(1 + td * (a.pctCdiPromo as number), du1) : 1;
    const f2 = Math.pow(1 + td * a.pctCdi, du2);
    return { fator: f1 * f2, du, ok: true };
  }
  if (a.indexador === 'PRE') {
    if (a.taxaPre == null) return { fator: 1, du, ok: false };
    return { fator: Math.pow(1 + a.taxaPre, du / p.diasUteisAno), du, ok: true };
  }
  // IPCA + spread: IPCA futuro é sempre estimativa.
  if (a.spreadIpca == null || p.ipcaProjetado == null) return { fator: 1, du, ok: false };
  const anos = du / p.diasUteisAno;
  return { fator: Math.pow(1 + p.ipcaProjetado, anos) * Math.pow(1 + a.spreadIpca, anos), du, ok: true };
}

/** Avalia o lote em `data` (projeção). A data é limitada ao intervalo [aporte, vencimento]. */
export function avaliar(a: Aporte, data: ISODate, p: Parametros, cal: Calendario): Avaliacao {
  const fim = data < a.dataAporte ? a.dataAporte : minData(data, a.vencimento);
  const { fator, du, ok } = fatorBruto(a, fim, p, cal);
  const dc = diasCorridos(a.dataAporte, fim);
  const bruto = a.valor * fator;
  const rendimentoBruto = Math.max(0, bruto - a.valor);
  const pctIof = percentualIOF(dc, p);
  const iof = rendimentoBruto * pctIof;
  const aliquotaIr = aliquotaIR(dc, p);
  const ir = Math.max(0, rendimentoBruto - iof) * aliquotaIr;
  const liquido = bruto - iof - ir;
  const rendimentoLiquido = liquido - a.valor;
  const fp = fimPromocao(a);
  return {
    data: fim,
    diasUteis: du,
    diasCorridos: dc,
    bruto,
    rendimentoBruto,
    pctIof,
    iof,
    aliquotaIr,
    ir,
    liquido,
    rendimentoLiquido,
    rentabilidadeLiquida: a.valor > 0 ? rendimentoLiquido / a.valor : 0,
    taxaLiquidaAnual: du > 0 && a.valor > 0 ? Math.pow(liquido / a.valor, p.diasUteisAno / du) - 1 : null,
    fase: a.indexador !== 'CDI' ? null : fp && fim < fp ? 'Promocional' : 'Padrão',
    calculavel: ok,
  };
}

/** Problemas que impedem ou distorcem o cálculo de um lote. */
export function validarAporte(a: Aporte, p: Parametros): string[] {
  const e: string[] = [];
  if (!a.dataAporte) e.push('Data do aporte');
  if (!(a.valor > 0)) e.push('Valor do aporte');
  if (!a.vencimento) e.push('Vencimento');
  if (a.dataAporte && a.vencimento && a.vencimento <= a.dataAporte) e.push('Vencimento antes do aporte');
  if (!a.emissor.trim()) e.push('Emissor');
  if (a.indexador === 'CDI') {
    if (!(a.pctCdi > 0)) e.push('% do CDI');
    if (a.pctCdiPromo != null && !(a.diasPromo > 0)) e.push('Duração da fase promocional');
  }
  if (a.indexador === 'PRE' && a.taxaPre == null) e.push('Taxa prefixada');
  if (a.indexador === 'IPCA') {
    if (a.spreadIpca == null) e.push('Taxa sobre o IPCA');
    if (p.ipcaProjetado == null) e.push('IPCA projetado em Parâmetros');
  }
  if (a.status === 'Resgatado' && !a.resgate) e.push('Dados do resgate');
  return e;
}
