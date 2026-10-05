import { describe, expect, it } from 'vitest';
import { aliquotaIR, avaliar, percentualIOF, resgatarParcial, type ResgateParcial } from './calculo';
import { agruparPorInstituicao, montarLinhas, resumir } from './carteira';
import { inicioConsulta, lerSerieBcb, mesclarCdi, ultimoCdi } from './cdi';
import { Calendario, feriadosNacionais, somaDias } from './datas';
import { CALENDARIO_ANBIMA } from './feriadosAnbima';
import { lerFeriadosAnbima } from './importacao';
import { normalizarParametros, novoAporte, parametrosPadrao } from './padroes';
import type { Aporte, CdiDia, Parametros } from './types';

// Valores de referência calculados de forma independente (script Python da auditoria de 04/10/2026),
// com CDI 13,90% a.a., 252 dias úteis e feriados nacionais.
const p = { ...parametrosPadrao(), cdiAnual: 0.139 };
const cal = new Calendario(p.feriados);

function cdb(parcial: Partial<Aporte>): Aporte {
  return novoAporte({ emissor: 'Banco X', valor: 1000, dataAporte: '2026-10-05', pctCdi: 1, ...parcial });
}
const venc = (dias: number) => somaDias('2026-10-05', dias);

describe('dias úteis', () => {
  it('conta [início, fim) e desconta feriados', () => {
    // 07/09/2026 (segunda) é feriado: semana de 07 a 11/09 tem 4 dias úteis.
    expect(cal.diasUteis('2026-09-07', '2026-09-14')).toBe(4);
    expect(cal.diasUteis('2026-09-08', '2026-09-08')).toBe(0);
    expect(cal.diasUteis('2026-10-02', '2026-10-05')).toBe(1); // sexta → segunda
  });
  it('gera Carnaval, Sexta-feira Santa e Corpus Christi de 2026', () => {
    const f = feriadosNacionais(2026, 2026);
    expect(f).toEqual(expect.arrayContaining(['2026-02-16', '2026-02-17', '2026-04-03', '2026-06-04', '2026-11-20']));
  });
});

describe('impostos', () => {
  it('IR por faixa de dias corridos', () => {
    expect(aliquotaIR(180, p)).toBe(0.225);
    expect(aliquotaIR(181, p)).toBe(0.2);
    expect(aliquotaIR(360, p)).toBe(0.2);
    expect(aliquotaIR(361, p)).toBe(0.175);
    expect(aliquotaIR(720, p)).toBe(0.175);
    expect(aliquotaIR(721, p)).toBe(0.15);
  });
  it('IOF só antes do 30º dia', () => {
    expect(percentualIOF(1, p)).toBe(0.96);
    expect(percentualIOF(20, p)).toBe(0.33);
    expect(percentualIOF(29, p)).toBe(0.03);
    expect(percentualIOF(30, p)).toBe(0);
    expect(percentualIOF(400, p)).toBe(0);
  });
});

describe('casos obrigatórios (CLAUDE.md seção 6)', () => {
  it('CDB taxa única 110% por 365 dias', () => {
    const r = avaliar(cdb({ pctCdi: 1.1, vencimento: venc(365) }), venc(365), p, cal);
    expect(r.bruto).toBeCloseTo(1152.61, 2);
    expect(r.aliquotaIr).toBe(0.175);
    expect(r.liquido).toBeCloseTo(1125.9, 1);
  });
  it('CDB duas fases 130% por 30 dias e 103% depois', () => {
    const a = cdb({ pctCdi: 1.03, pctCdiPromo: 1.3, diasPromo: 30, vencimento: venc(365) });
    const r = avaliar(a, venc(365), p, cal);
    expect(r.bruto).toBeCloseTo(1145.43, 2);
    expect(r.liquido).toBeCloseTo(1119.98, 2);
    // composição de fatores, nunca média: difere de aplicar a média simples das taxas
    const media = avaliar({ ...a, pctCdi: (1.3 + 1.03) / 2, pctCdiPromo: null, diasPromo: 0 }, venc(365), p, cal);
    expect(Math.abs(media.bruto - r.bruto)).toBeGreaterThan(10);
    expect(avaliar(a, venc(10), p, cal).fase).toBe('Promocional');
    expect(avaliar(a, venc(40), p, cal).fase).toBe('Padrão');
  });
  it('resgate com menos de 30 dias (IOF)', () => {
    const r = avaliar(cdb({ vencimento: venc(400) }), venc(20), p, cal);
    expect(r.bruto).toBeCloseTo(1007.26, 2);
    expect(r.pctIof).toBe(0.33);
    expect(r.iof).toBeCloseTo((r.bruto - 1000) * 0.33, 10);
    expect(r.ir).toBeCloseTo((r.bruto - 1000 - r.iof) * 0.225, 10);
    expect(r.liquido).toBeCloseTo(1003.77, 2);
  });
  it.each([
    [200, 0.2, 1072.21, 1057.77],
    [500, 0.175, 1194.43, 1160.4],
    [800, 0.15, 1326.45, 1277.49],
  ])('prazo de %i dias', (dias, aliq, bruto, liquido) => {
    const r = avaliar(cdb({ vencimento: venc(dias) }), venc(dias), p, cal);
    expect(r.aliquotaIr).toBe(aliq);
    expect(r.iof).toBe(0);
    expect(r.bruto).toBeCloseTo(bruto, 2);
    expect(r.liquido).toBeCloseTo(liquido, 2);
  });
  it('agrupa por conglomerado e calcula FGC com rendimentos', () => {
    const aportes = [
      cdb({ emissor: 'Banco A', conglomerado: 'Grupo A', valor: 200_000, vencimento: venc(800), dataAporte: '2025-01-02' }),
      cdb({ emissor: 'Financeira A', conglomerado: 'Grupo A', valor: 40_000, vencimento: venc(800), dataAporte: '2025-01-02' }),
      cdb({ emissor: 'Banco B', valor: 1000, vencimento: venc(800) }),
    ];
    const linhas = montarLinhas(aportes, '2026-10-05', p);
    const grupos = agruparPorInstituicao(linhas, p);
    const a = grupos.find((g) => g.nome === 'Grupo A')!;
    expect(a.aportes).toBe(2);
    expect(a.emissores).toEqual(['Banco A', 'Financeira A']);
    expect(a.exposicaoFgc).toBeGreaterThan(250_000); // 240 mil aportados + rendimentos passam do limite
    expect(a.excessoFgc).toBeCloseTo(a.exposicaoFgc - 250_000, 6);
    expect(a.alertaFgc).toBe('acima');
    expect(grupos.find((g) => g.nome === 'Banco B')!.alertaFgc).toBe('ok');
    expect(linhas[0].alertas).toContain('Concentração FGC');
  });
});

describe('carteira real da planilha (04/10/2026)', () => {
  const aportes = [
    cdb({ dataAporte: '2026-08-19', valor: 500, pctCdi: 1.03, pctCdiPromo: 1.3, diasPromo: 30, vencimento: '2028-08-10', emissor: 'PagBank' }),
    cdb({ dataAporte: '2026-09-02', valor: 500, pctCdi: 1.03, pctCdiPromo: 1.3, diasPromo: 30, vencimento: '2028-08-10', emissor: 'PagBank' }),
    cdb({ dataAporte: '2026-10-01', valor: 700, pctCdi: 1.085, vencimento: '2030-10-01', emissor: 'PagBank', liquidez: 'No vencimento' }),
  ];
  const linhas = montarLinhas(aportes, '2026-10-04', p);
  it('bate com a referência no vencimento', () => {
    expect(linhas.map((l) => +l.vencimento.liquido.toFixed(2))).toEqual([629.65, 622.98, 1146.44]);
    expect(resumir(linhas, p).liquidoVencimento).toBeCloseTo(2399.07, 2);
  });
  it('bate com a referência hoje', () => {
    expect(linhas.map((l) => +l.hoje.liquido.toFixed(2))).toEqual([507.81, 505.71, 700.06]);
    expect(linhas[2].alertas).toContain('IOF ativo');
  });
});

describe('robustez', () => {
  it('linha com dado faltando não quebra', () => {
    const linhas = montarLinhas([novoAporte()], '2026-10-04', p);
    expect(linhas[0].pendencias.length).toBeGreaterThan(0);
    expect(Number.isFinite(resumir(linhas, p).liquidoHoje)).toBe(true);
  });
  it('prefixado e IPCA+', () => {
    const pre = avaliar(cdb({ indexador: 'PRE', taxaPre: 0.12, vencimento: venc(365) }), venc(365), p, cal);
    expect(pre.bruto).toBeCloseTo(1000 * Math.pow(1.12, pre.diasUteis / 252), 8);
    const ipcaSem = avaliar(cdb({ indexador: 'IPCA', spreadIpca: 0.06, vencimento: venc(365) }), venc(365), p, cal);
    expect(ipcaSem.calculavel).toBe(false);
    const ipca = avaliar(cdb({ indexador: 'IPCA', spreadIpca: 0.06, vencimento: venc(365) }), venc(365), { ...p, ipcaProjetado: 0.04 }, cal);
    const anos = ipca.diasUteis / 252;
    expect(ipca.bruto).toBeCloseTo(1000 * Math.pow(1.04, anos) * Math.pow(1.06, anos), 8);
  });
});

describe('resgate parcial', () => {
  // Referências de um laço dia a dia independente do motor (CDI 13,90%, feriados nacionais).
  const lote = cdb({ id: 'lote-1', dataAporte: '2026-08-19', valor: 500, pctCdi: 1.03, pctCdiPromo: 1.3, diasPromo: 30, vencimento: '2028-08-10' });
  const ok = (r: ResgateParcial | { erro: string }) => {
    if ('erro' in r) throw new Error(r.erro);
    return r;
  };

  it('divide o lote pelo valor bruto e mantém a contagem tributária', () => {
    const r = ok(resgatarParcial(lote, '2026-10-05', 200, 'bruto', p, cal, 'lote-2'));
    expect(r.fracao).toBeCloseTo(0.392099, 6);
    expect(r.resgatado.id).toBe('lote-1');
    expect(r.resgatado.status).toBe('Resgatado');
    expect(r.resgatado.valor).toBeCloseTo(196.05, 2);
    expect(r.resgatado.resgate!.valorBruto).toBeCloseTo(200, 8);
    expect(r.resgatado.resgate!.irRetido).toBeCloseTo(0.89, 2); // 22,5% sobre o rendimento da fração
    expect(r.resgatado.resgate!.iofRetido).toBe(0); // 47 dias corridos
    expect(r.resgatado.resgate!.valorLiquido).toBeCloseTo(199.11, 2);
    expect(r.remanescente.id).toBe('lote-2');
    expect(r.remanescente.status).toBe('Ativo');
    expect(r.remanescente.valor).toBeCloseTo(303.95, 2);
    expect(r.remanescente.dataAporte).toBe('2026-08-19'); // não reinicia IR nem fase promocional
    expect(r.remanescente.divisao).toEqual({ origemId: 'lote-1', valorOriginal: 500, data: '2026-10-05', fracao: expect.closeTo(0.6079, 4) });
    expect(r.resgatado.valor + r.remanescente.valor).toBe(500);
  });

  it('partes somadas reproduzem o lote original em qualquer data', () => {
    const r = ok(resgatarParcial(lote, '2026-10-05', 200, 'bruto', p, cal, 'lote-2'));
    for (const d of ['2026-10-05', '2027-03-01', '2027-09-10', '2028-08-10']) {
      const o = avaliar(lote, d, p, cal);
      const s = avaliar(r.resgatado, d, p, cal);
      const m = avaliar(r.remanescente, d, p, cal);
      expect(s.bruto + m.bruto).toBeCloseTo(o.bruto, 9);
      expect(s.ir + m.ir).toBeCloseTo(o.ir, 9);
      expect(s.liquido + m.liquido).toBeCloseTo(o.liquido, 9);
      expect(m.aliquotaIr).toBe(o.aliquotaIr);
    }
  });

  it('pelo valor líquido, com IOF antes de 30 dias', () => {
    const a = cdb({ id: 'x', dataAporte: '2026-10-01', valor: 700, pctCdi: 1.085, vencimento: '2030-10-01' });
    const r = ok(resgatarParcial(a, '2026-10-15', 300, 'liquido', p, cal, 'y'));
    expect(r.fracao).toBeCloseTo(0.427784, 6);
    expect(r.resgatado.resgate!.valorLiquido).toBeCloseTo(300, 8);
    expect(r.resgatado.resgate!.valorBruto).toBeCloseTo(300.96, 2);
    expect(r.resgatado.resgate!.iofRetido).toBeCloseTo(0.8, 2); // 53% no 14º dia
  });

  it('resgates parciais em cadeia apontam para o lote de origem', () => {
    const r1 = ok(resgatarParcial(lote, '2026-10-05', 200, 'bruto', p, cal, 'lote-2'));
    const r2 = ok(resgatarParcial(r1.remanescente, '2027-01-04', 100, 'bruto', p, cal, 'lote-3'));
    expect(r2.resgatado.id).toBe('lote-2');
    expect(r2.remanescente.divisao!.origemId).toBe('lote-1');
    expect(r1.resgatado.divisao!.fracao + r2.resgatado.divisao!.fracao + r2.remanescente.divisao!.fracao).toBeCloseTo(1, 12);
  });

  it('recusa casos inválidos sem quebrar', () => {
    const erro = (r: ResgateParcial | { erro: string }) => ('erro' in r ? r.erro : '');
    expect(erro(resgatarParcial(lote, '2026-10-05', 600, 'bruto', p, cal, 'n'))).toMatch(/resgate total/);
    expect(erro(resgatarParcial(lote, '2026-10-05', 0, 'bruto', p, cal, 'n'))).toMatch(/valor/);
    expect(erro(resgatarParcial(lote, '2026-08-01', 100, 'bruto', p, cal, 'n'))).toMatch(/anterior/);
    expect(erro(resgatarParcial(lote, '2028-08-10', 100, 'bruto', p, cal, 'n'))).toMatch(/vencimento/);
    expect(erro(resgatarParcial({ ...lote, permiteResgateAntecipado: false }, '2026-10-05', 100, 'bruto', p, cal, 'n'))).toMatch(/antecipado/);
    expect(erro(resgatarParcial({ ...lote, carenciaAte: '2027-01-01' }, '2026-10-05', 100, 'bruto', p, cal, 'n'))).toMatch(/carência/);
    expect(erro(resgatarParcial(novoAporte(), '2026-10-05', 100, 'bruto', p, cal, 'n'))).toMatch(/Complete/);
  });

  it('carteira conta só a parte remanescente', () => {
    const r = ok(resgatarParcial(lote, '2026-10-05', 200, 'bruto', p, cal, 'lote-2'));
    const res = resumir(montarLinhas([r.resgatado, r.remanescente], '2026-10-05', p), p);
    expect(res.aportado).toBeCloseTo(303.95, 2);
    expect(res.resgatadoLiquido).toBeCloseTo(199.11, 2);
  });
});

describe('CDI realizado (Banco Central)', () => {
  // Histórico sintético: 13,65% em setembro/2026, 15% de 15 a 18/09, sem 22/09 (lacuna). Projeção 13,90%.
  // Referências de um laço dia a dia independente do motor (datas do JavaScript + arquivo ANBIMA).
  const serie: CdiDia[] = [];
  for (let d = '2026-09-01'; d <= '2026-09-30'; d = somaDias(d, 1)) {
    if (d === '2026-09-22') continue;
    serie.push({ data: d, anual: d >= '2026-09-15' && d <= '2026-09-18' ? 0.15 : 0.1365 });
  }
  const ph = { ...p, cdiDiario: serie };
  const a = cdb({ dataAporte: '2026-09-01', valor: 1000, pctCdi: 1.03, pctCdiPromo: 1.3, diasPromo: 30, vencimento: '2028-08-10' });

  it('usa o CDI de cada dia e projeta só os dias sem dado', () => {
    const r = avaliar(a, '2026-09-30', ph, cal);
    expect(r.diasUteis).toBe(20);
    expect(r.diasUteisEstimados).toBe(1); // a lacuna de 22/09
    expect(r.bruto).toBeCloseTo(1013.546429, 6);
    expect(r.iof).toBeCloseTo(0.406393, 6);
    expect(r.ir).toBeCloseTo(2.956508, 6);
    expect(r.liquido).toBeCloseTo(1010.183528, 6);
  });
  it('depois do último CDI publicado volta à projeção', () => {
    const r = avaliar(a, '2026-10-05', ph, cal);
    expect(r.diasUteisEstimados).toBe(3);
    expect(r.bruto).toBeCloseTo(1015.295238, 6);
    expect(r.liquido).toBeCloseTo(1011.853809, 6);
    const v = avaliar(a, '2028-08-10', ph, cal);
    expect(v.diasUteis).toBe(486);
    expect(v.diasUteisEstimados).toBe(466);
    expect(v.bruto).toBeCloseTo(1298.847559, 6);
    expect(v.liquido).toBeCloseTo(1246.549236, 6);
  });
  it('lote sem fase promocional, com IOF', () => {
    const r = avaliar(cdb({ dataAporte: '2026-09-10', valor: 500, pctCdi: 1.085, vencimento: '2030-10-01' }), '2026-10-01', ph, cal);
    expect(r.diasUteis).toBe(15);
    expect(r.bruto).toBeCloseTo(504.256162, 6);
    expect(r.iof).toBeCloseTo(1.276848, 6);
    expect(r.liquido).toBeCloseTo(502.308968, 6);
  });
  it('ignora fim de semana e feriado no histórico e não mexe em prefixado', () => {
    const extra = { ...ph, cdiDiario: [...serie, { data: '2026-09-05', anual: 0.5 }, { data: '2026-09-07', anual: 0.5 }] };
    expect(avaliar(a, '2026-09-30', extra, cal).bruto).toBeCloseTo(1013.546429, 6);
    const pre = cdb({ indexador: 'PRE', taxaPre: 0.12, vencimento: venc(365) });
    expect(avaliar(pre, venc(365), ph, cal).bruto).toBe(avaliar(pre, venc(365), p, cal).bruto);
    expect(avaliar(pre, venc(365), ph, cal).diasUteisEstimados).toBe(0);
  });
  it('sem histórico tudo é projeção', () => {
    const r = avaliar(a, '2026-09-30', p, cal);
    expect(r.diasUteisEstimados).toBe(r.diasUteis);
  });
  it('resgate parcial com CDI realizado mantém a soma das partes', () => {
    const lote = { ...a, id: 'l1' };
    const r = resgatarParcial(lote, '2026-10-05', 300, 'bruto', ph, cal, 'l2');
    if ('erro' in r) throw new Error(r.erro);
    for (const d of ['2026-10-05', '2027-06-01', '2028-08-10']) {
      const o = avaliar(lote, d, ph, cal);
      expect(avaliar(r.resgatado, d, ph, cal).liquido + avaliar(r.remanescente, d, ph, cal).liquido).toBeCloseTo(o.liquido, 9);
    }
  });
});

describe('série do Banco Central', () => {
  it('lê o JSON do SGS e mescla com revisão', () => {
    const s = lerSerieBcb([
      { data: '30/09/2026', valor: '13.65' },
      { data: '01/10/2026', valor: '13.65' },
      { data: 'x', valor: '1' },
      { data: '02/10/2026', valor: '' },
    ]);
    expect(s).toEqual([
      { data: '2026-09-30', anual: 0.1365 },
      { data: '2026-10-01', anual: 0.1365 },
    ]);
    const m = mesclarCdi(s, [
      { data: '2026-10-01', anual: 0.137 },
      { data: '2026-09-29', anual: 0.1365 },
    ]);
    expect(m.map((c) => c.data)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
    expect(ultimoCdi(m)).toEqual({ data: '2026-10-01', anual: 0.137 });
    expect(() => lerSerieBcb({ erro: 1 })).toThrow();
  });
  it('consulta desde o aporte mais antigo ou só os dias recentes', () => {
    expect(inicioConsulta([], '2026-08-19', '2026-10-04', 10)).toBe('2026-08-19');
    const s = [
      { data: '2026-08-19', anual: 0.1365 },
      { data: '2026-10-01', anual: 0.1365 },
    ];
    expect(inicioConsulta(s, '2026-08-19', '2026-10-04', 10)).toBe('2026-09-21');
    expect(inicioConsulta(s, '2026-01-02', '2026-10-04', 10)).toBe('2026-01-02'); // aporte mais antigo que o histórico
    expect(inicioConsulta([], null, '2026-10-04', 10)).toBe('2026-09-24');
  });
});

describe('calendário ANBIMA', () => {
  it('lista embutida coincide com a regra dos feriados nacionais de 2001 a 2099', () => {
    // em 2079 Tiradentes cai na Sexta-feira Santa: a data aparece uma vez só
    expect(CALENDARIO_ANBIMA.feriados).toEqual([...new Set(feriadosNacionais(2001, 2099))]);
    expect(CALENDARIO_ANBIMA.feriados.length).toBe(1263);
    expect(parametrosPadrao().feriados).toEqual(CALENDARIO_ANBIMA.feriados);
  });
  it('dia útil considera fim de semana e feriado', () => {
    expect(cal.ehDiaUtil('2026-10-12')).toBe(false); // Nossa Senhora Aparecida
    expect(cal.ehDiaUtil('2026-10-10')).toBe(false); // sábado
    expect(cal.ehDiaUtil('2026-10-13')).toBe(true);
    expect(cal.ehDiaUtil('')).toBe(false);
  });
  it('lê o arquivo da ANBIMA com datas seriais do Excel', () => {
    const linhas: unknown[][] = [['Data', 'Dia da Semana', 'Feriado']];
    // 36892 = 01/01/2001 no Excel (primeira linha do arquivo original)
    for (let i = 0; i < 120; i++) linhas.push([36892 + i, '', `Feriado ${i}`]);
    linhas.push(['Fonte: ANBIMA'], [], ['4) Esta listagem não inclui os feriados municipais']);
    const f = lerFeriadosAnbima(linhas);
    expect(f.length).toBe(120);
    expect(f[0]).toBe('2001-01-01');
    expect(f[59]).toBe('2001-03-01');
    expect(() => lerFeriadosAnbima([['qualquer coisa']])).toThrow(/ANBIMA/);
    expect(() => lerFeriadosAnbima([['Data', 'Dia', 'Feriado'], [36892, '', 'x']])).toThrow(/incompleto/);
  });
  it('migra a lista gerada antiga para a ANBIMA e preserva lista editada', () => {
    const antiga: Partial<Parametros> = { ...parametrosPadrao(), feriados: feriadosNacionais(2020, 2040) };
    delete antiga.feriadosFonte;
    delete antiga.feriadosVersao;
    delete antiga.cdiDiario;
    const m = normalizarParametros(antiga);
    expect(m.feriados).toEqual(CALENDARIO_ANBIMA.feriados);
    expect(m.feriadosVersao).toBe(CALENDARIO_ANBIMA.versao);
    expect(m.cdiDiario).toEqual([]);
    const editada = normalizarParametros({ ...antiga, feriados: ['2026-01-01'] });
    expect(editada.feriados).toEqual(['2026-01-01']);
    expect(editada.feriadosVersao).toBe('');
  });
});
