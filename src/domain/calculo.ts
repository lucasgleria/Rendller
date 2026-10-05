import { Calendario, diasCorridos, minData, somaDias } from './datas';
import type { Aporte, ISODate, Parametros } from './types';

/**
 * Resultado de um lote avaliado numa data.
 * Ordem dos impostos (CLAUDE.md seção 4): bruto → IOF → base IR = rendimento − IOF → IR → líquido.
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

export type BaseResgate = 'bruto' | 'liquido';

export interface ResgateParcial {
  /** Parte resgatada: mantém o `id` do lote, status `Resgatado` e os valores estimados do resgate. */
  resgatado: Aporte;
  /** Parte que continua aplicada: mesma data de aporte, taxa e vencimento (a contagem de IR/IOF não reinicia). */
  remanescente: Aporte;
  /** Fração do principal do lote que foi resgatada. */
  fracao: number;
  avaliacao: Avaliacao;
}

/**
 * Resgate parcial de um lote em `data`. O banco resgata uma fração proporcional do lote; como bruto,
 * IOF e IR são proporcionais ao principal, dividir o principal na mesma fração preserva os valores totais.
 * O lote original não é apagado: vira a linha resgatada (mesmo `id`) e ganha uma linha remanescente.
 * `valor` é o valor pedido, bruto ou líquido conforme `base`.
 */
export function resgatarParcial(
  a: Aporte,
  data: ISODate,
  valor: number,
  base: BaseResgate,
  p: Parametros,
  cal: Calendario,
  novoId: string,
): ResgateParcial | { erro: string } {
  if (a.status !== 'Ativo') return { erro: 'Só lotes ativos podem ter resgate parcial.' };
  if (validarAporte(a, p).length) return { erro: 'Complete os dados do lote antes do resgate.' };
  if (!data || data < a.dataAporte) return { erro: 'A data do resgate é anterior ao aporte.' };
  if (data >= a.vencimento) return { erro: 'No vencimento ou depois dele, registre o resgate total.' };
  if (!a.permiteResgateAntecipado) return { erro: 'Este lote não permite resgate antecipado.' };
  if (a.carenciaAte && data < a.carenciaAte) return { erro: 'O lote ainda está em carência.' };
  const atual = avaliar(a, data, p, cal);
  if (!atual.calculavel) return { erro: 'Não há como estimar o valor do lote nesta data.' };
  const total = base === 'bruto' ? atual.bruto : atual.liquido;
  if (!(valor > 0)) return { erro: 'Informe o valor do resgate.' };
  if (valor >= total) return { erro: 'O valor cobre o lote inteiro: registre o resgate total.' };

  const fracao = valor / total;
  const valorOriginal = a.divisao?.valorOriginal ?? a.valor;
  const origemId = a.divisao?.origemId ?? a.id;
  const principalResgatado = a.valor * fracao;
  const principalRestante = a.valor - principalResgatado;
  const resgatadoBase: Aporte = { ...a, valor: principalResgatado };
  const r = avaliar(resgatadoBase, data, p, cal);
  return {
    fracao,
    avaliacao: r,
    resgatado: {
      ...resgatadoBase,
      status: 'Resgatado',
      resgate: { data, valorBruto: r.bruto, irRetido: r.ir, iofRetido: r.iof, valorLiquido: r.liquido },
      divisao: { origemId, valorOriginal, data, fracao: principalResgatado / valorOriginal },
    },
    remanescente: {
      ...a,
      id: novoId,
      valor: principalRestante,
      divisao: { origemId, valorOriginal, data, fracao: principalRestante / valorOriginal },
    },
  };
}
