import { describe, expect, it } from 'vitest';
import { aliquotaIR, avaliar, percentualIOF } from './calculo';
import { agruparPorInstituicao, montarLinhas, resumir } from './carteira';
import { Calendario, feriadosNacionais, somaDias } from './datas';
import { novoAporte, parametrosPadrao } from './padroes';
import type { Aporte } from './types';

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

describe('casos obrigatórios (CLAUDE.md 10.3)', () => {
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
