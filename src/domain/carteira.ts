import { avaliar, validarAporte, type Avaliacao } from './calculo';
import { Calendario, diasCorridos, diaNum } from './datas';
import type { Aporte, ISODate, Parametros, Status } from './types';

export type Alerta = 'IOF ativo' | 'Vence em breve' | 'Vence em até 90 dias' | 'Vencido sem resgate' | 'Dados faltando' | 'Concentração FGC';

export interface Linha {
  aporte: Aporte;
  status: Status;
  hoje: Avaliacao;
  vencimento: Avaliacao;
  diasParaVencer: number;
  prazoTotal: number; // dias corridos aporte → vencimento
  diasUteisTotais: number;
  grupoFgc: string;
  pendencias: string[];
  alertas: Alerta[];
}

export interface Grupo {
  nome: string; // conglomerado (ou emissor quando não informado)
  emissores: string[];
  aportes: number;
  aportado: number;
  brutoHoje: number;
  rendimentoBrutoHoje: number;
  impostosHoje: number;
  liquidoHoje: number;
  rendimentoLiquidoHoje: number;
  liquidoVencimento: number;
  percentualCarteira: number; // pela exposição (principal + rendimentos)
  exposicaoFgc: number;
  coberturaFgc: number;
  excessoFgc: number;
  alertaFgc: 'ok' | 'próximo' | 'acima';
}

export interface Resumo {
  aportado: number;
  brutoHoje: number;
  rendimentoBrutoHoje: number;
  impostosHoje: number;
  liquidoHoje: number;
  rendimentoLiquidoHoje: number;
  brutoVencimento: number;
  impostosVencimento: number;
  liquidoVencimento: number;
  rendimentoLiquidoVencimento: number;
  ativos: number;
  proximoVencimento: Linha | null;
  liquidoComLiquidezDiaria: number;
  liquidoSemLiquidezDiaria: number;
  vencendoJanela1: number;
  vencendoJanela2: number;
  emIof: Linha[];
  resgatadoLiquido: number;
}

/** Lotes que compõem o saldo atual: ativos e vencidos ainda não marcados como resgatados. */
export function contaNoSaldo(l: Linha): boolean {
  return l.status === 'Ativo' || l.status === 'Vencido';
}

export function statusEfetivo(a: Aporte, hoje: ISODate): Status {
  if (a.status === 'Resgatado' || a.status === 'Planejado') return a.status;
  if (a.dataAporte && hoje < a.dataAporte) return 'Planejado';
  if (a.vencimento && hoje >= a.vencimento) return 'Vencido';
  return 'Ativo';
}

export function grupoFgc(a: Aporte): string {
  return (a.conglomerado || a.emissor || 'Sem emissor').trim();
}

export function montarLinhas(aportes: Aporte[], hoje: ISODate, p: Parametros): Linha[] {
  const cal = new Calendario(p.feriados);
  const linhas: Linha[] = aportes.map((a) => {
    const pendencias = validarAporte(a, p);
    const status = statusEfetivo(a, hoje);
    const okDatas = !!a.dataAporte && !!a.vencimento && a.vencimento > a.dataAporte;
    const venc = okDatas ? avaliar(a, a.vencimento, p, cal) : avaliacaoVazia(a);
    const hojeAval = okDatas ? avaliar(a, hoje, p, cal) : avaliacaoVazia(a);
    const diasParaVencer = a.vencimento ? Math.max(0, diasCorridos(hoje, a.vencimento)) : 0;
    const alertas: Alerta[] = [];
    if (pendencias.length) alertas.push('Dados faltando');
    if (status === 'Ativo') {
      if (hojeAval.diasCorridos < 30) alertas.push('IOF ativo');
      if (diasParaVencer <= p.alertaVencimentoDias[0]) alertas.push('Vence em breve');
      else if (diasParaVencer <= p.alertaVencimentoDias[1]) alertas.push('Vence em até 90 dias');
    }
    if (status === 'Vencido') alertas.push('Vencido sem resgate');
    return {
      aporte: a,
      status,
      hoje: hojeAval,
      vencimento: venc,
      diasParaVencer,
      prazoTotal: okDatas ? diasCorridos(a.dataAporte, a.vencimento) : 0,
      diasUteisTotais: venc.diasUteis,
      grupoFgc: grupoFgc(a),
      pendencias,
      alertas,
    };
  });
  // Concentração: marca as linhas de grupos próximos ou acima do limite do FGC.
  const grupos = agruparPorInstituicao(linhas, p);
  const criticos = new Set(grupos.filter((g) => g.alertaFgc !== 'ok').map((g) => g.nome));
  for (const l of linhas) if (contaNoSaldo(l) && criticos.has(l.grupoFgc)) l.alertas.push('Concentração FGC');
  return linhas;
}

function avaliacaoVazia(a: Aporte): Avaliacao {
  return {
    data: a.dataAporte,
    diasUteis: 0,
    diasCorridos: 0,
    bruto: a.valor || 0,
    rendimentoBruto: 0,
    pctIof: 0,
    iof: 0,
    aliquotaIr: 0,
    ir: 0,
    liquido: a.valor || 0,
    rendimentoLiquido: 0,
    rentabilidadeLiquida: 0,
    taxaLiquidaAnual: null,
    fase: null,
    calculavel: false,
  };
}

export function agruparPorInstituicao(linhas: Linha[], p: Parametros): Grupo[] {
  const mapa = new Map<string, Grupo>();
  for (const l of linhas.filter(contaNoSaldo)) {
    const g =
      mapa.get(l.grupoFgc) ??
      ({
        nome: l.grupoFgc,
        emissores: [],
        aportes: 0,
        aportado: 0,
        brutoHoje: 0,
        rendimentoBrutoHoje: 0,
        impostosHoje: 0,
        liquidoHoje: 0,
        rendimentoLiquidoHoje: 0,
        liquidoVencimento: 0,
        percentualCarteira: 0,
        exposicaoFgc: 0,
        coberturaFgc: 0,
        excessoFgc: 0,
        alertaFgc: 'ok',
      } as Grupo);
    if (l.aporte.emissor && !g.emissores.includes(l.aporte.emissor)) g.emissores.push(l.aporte.emissor);
    g.aportes += 1;
    g.aportado += l.aporte.valor;
    g.brutoHoje += l.hoje.bruto;
    g.rendimentoBrutoHoje += l.hoje.rendimentoBruto;
    g.impostosHoje += l.hoje.iof + l.hoje.ir;
    g.liquidoHoje += l.hoje.liquido;
    g.rendimentoLiquidoHoje += l.hoje.rendimentoLiquido;
    g.liquidoVencimento += l.vencimento.liquido;
    mapa.set(l.grupoFgc, g);
  }
  const grupos = [...mapa.values()];
  const total = grupos.reduce((s, g) => s + g.brutoHoje, 0);
  for (const g of grupos) {
    // FGC cobre principal + rendimentos, por CPF e por conglomerado (CLAUDE.md seção 5).
    g.exposicaoFgc = g.brutoHoje;
    g.coberturaFgc = Math.min(g.exposicaoFgc, p.fgcLimitePorInstituicao);
    g.excessoFgc = Math.max(0, g.exposicaoFgc - p.fgcLimitePorInstituicao);
    g.alertaFgc = g.excessoFgc > 0 ? 'acima' : g.exposicaoFgc >= p.fgcAlertaFracao * p.fgcLimitePorInstituicao ? 'próximo' : 'ok';
    g.percentualCarteira = total > 0 ? g.brutoHoje / total : 0;
  }
  return grupos.sort((a, b) => b.brutoHoje - a.brutoHoje);
}

export function resumir(linhas: Linha[], p: Parametros): Resumo {
  const ativas = linhas.filter(contaNoSaldo);
  const soma = (f: (l: Linha) => number, ls = ativas) => ls.reduce((s, l) => s + f(l), 0);
  const futuras = linhas.filter((l) => l.status === 'Ativo').sort((a, b) => (a.aporte.vencimento < b.aporte.vencimento ? -1 : 1));
  const [j1, j2] = p.alertaVencimentoDias;
  return {
    aportado: soma((l) => l.aporte.valor),
    brutoHoje: soma((l) => l.hoje.bruto),
    rendimentoBrutoHoje: soma((l) => l.hoje.rendimentoBruto),
    impostosHoje: soma((l) => l.hoje.iof + l.hoje.ir),
    liquidoHoje: soma((l) => l.hoje.liquido),
    rendimentoLiquidoHoje: soma((l) => l.hoje.rendimentoLiquido),
    brutoVencimento: soma((l) => l.vencimento.bruto),
    impostosVencimento: soma((l) => l.vencimento.iof + l.vencimento.ir),
    liquidoVencimento: soma((l) => l.vencimento.liquido),
    rendimentoLiquidoVencimento: soma((l) => l.vencimento.rendimentoLiquido),
    ativos: linhas.filter((l) => l.status === 'Ativo').length,
    proximoVencimento: futuras[0] ?? null,
    liquidoComLiquidezDiaria: soma((l) => (l.aporte.liquidez === 'Diária' ? l.hoje.liquido : 0)),
    liquidoSemLiquidezDiaria: soma((l) => (l.aporte.liquidez !== 'Diária' ? l.hoje.liquido : 0)),
    vencendoJanela1: soma((l) => (l.status === 'Ativo' && l.diasParaVencer <= j1 ? l.vencimento.liquido : 0)),
    vencendoJanela2: soma((l) => (l.status === 'Ativo' && l.diasParaVencer <= j2 ? l.vencimento.liquido : 0)),
    emIof: ativas.filter((l) => l.alertas.includes('IOF ativo')),
    resgatadoLiquido: linhas.reduce((s, l) => s + (l.status === 'Resgatado' && l.aporte.resgate ? l.aporte.resgate.valorLiquido : 0), 0),
  };
}

/**
 * Evolução estimada da carteira (líquido) do primeiro aporte ao último vencimento, um ponto por mês.
 * Depois do vencimento cada lote fica parado no valor líquido do vencimento.
 */
export function serieProjecao(linhas: Linha[], p: Parametros, hoje: ISODate): { data: ISODate; aportado: number; liquido: number; projetado: boolean }[] {
  const ls = linhas.filter((l) => contaNoSaldo(l) || l.status === 'Planejado').filter((l) => l.prazoTotal > 0);
  if (!ls.length) return [];
  const cal = new Calendario(p.feriados);
  const inicio = ls.reduce((m, l) => (l.aporte.dataAporte < m ? l.aporte.dataAporte : m), ls[0].aporte.dataAporte);
  const fim = ls.reduce((m, l) => (l.aporte.vencimento > m ? l.aporte.vencimento : m), ls[0].aporte.vencimento);
  const pontos: ISODate[] = [];
  const [a0, m0] = inicio.split('-').map(Number);
  for (let i = 0; ; i++) {
    const d = new Date(Date.UTC(a0, m0 - 1 + i, 1)).toISOString().slice(0, 10);
    if (d > fim) break;
    if (d >= inicio) pontos.push(d);
  }
  pontos.unshift(inicio);
  pontos.push(fim);
  if (hoje > inicio && hoje < fim) pontos.push(hoje);
  const unicos = [...new Set(pontos)].sort();
  return unicos.map((d) => {
    let aportado = 0;
    let liquido = 0;
    for (const l of ls) {
      if (d < l.aporte.dataAporte) continue;
      aportado += l.aporte.valor;
      liquido += avaliar(l.aporte, d, p, cal).liquido;
    }
    return { data: d, aportado, liquido, projetado: d > hoje };
  });
}

export function mesesEntre(a: ISODate, b: ISODate): number {
  return (diaNum(b) - diaNum(a)) / (365.25 / 12);
}

