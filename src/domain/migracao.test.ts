import { describe, expect, it } from 'vitest';
import { avaliar } from './calculo';
import { APORTES_CARTEIRA_REAL, HOJE_CARTEIRA_REAL, LIQUIDO_HOJE_CARTEIRA_REAL, LIQUIDO_VENCIMENTO_CARTEIRA_REAL } from './carteiraReal.fixture';
import { Calendario } from './datas';
import { classeDoTipoV1, migrarDados } from './migracao';
import { normalizarParametros, novoAporte, parametrosPadrao } from './padroes';

/** Parâmetros como eram gravados na versão 1 (sem `regimes`). */
function parametrosV1(extra: Record<string, unknown> = {}) {
  const { regimes: _, regimesVersao: __, ...v1 } = { ...parametrosPadrao(), cdiAnual: 0.139 };
  return { ...v1, ...extra };
}

/** Aporte como era gravado na versão 1: com `tipo`, sem `classe`. */
function aporteV1(parcial: Record<string, unknown>, tipo = 'CDB Pós-fixado') {
  const { classe: _, ...v1 } = novoAporte({ instituicao: 'PagBank', emissor: 'Banco X', valor: 1000, dataAporte: '2026-10-05', pctCdi: 1, ...parcial });
  return { ...v1, tipo };
}

/** Os 3 aportes da carteira real em v1: o 1º com resgate registrado, o 2º vindo de um resgate parcial. */
function dadosV1(): unknown {
  const aportes = APORTES_CARTEIRA_REAL.map((x, i) => aporteV1({ ...x, id: `real-${i}` }));
  aportes[0].resgate = { data: '2026-10-04', valorBruto: 508.1, irRetido: 0.29, iofRetido: 0, valorLiquido: 507.81 };
  aportes[1].divisao = { origemId: 'lote-antigo', valorOriginal: 1000, data: '2026-09-20', fracao: 0.5 };
  return JSON.parse(JSON.stringify({ versao: 1, aportes, parametros: parametrosV1() }));
}

describe('migração de formato (v1 → v2)', () => {
  it('v1 vira v2 sem perder aporte', () => {
    const v1 = dadosV1() as { aportes: Record<string, unknown>[] };
    const d = migrarDados(v1);
    expect(d.versao).toBe(2);
    expect(d.aportes.map((a) => a.id)).toEqual(v1.aportes.map((a) => a.id));
    for (const [i, a] of d.aportes.entries()) {
      expect(a.classe).toBe('CDB');
      expect('tipo' in a).toBe(false);
      const { tipo: _, ...original } = v1.aportes[i];
      const { classe: __, ...migrado } = a;
      expect(migrado).toEqual(original);
    }
    expect(d.aportes[0].resgate).toEqual(v1.aportes[0].resgate);
    expect(d.aportes[1].divisao).toEqual(v1.aportes[1].divisao);
  });

  it("'Outro renda fixa' vira classe Outro", () => {
    expect(classeDoTipoV1('Outro renda fixa')).toBe('Outro');
    expect(classeDoTipoV1('CDB Prefixado')).toBe('CDB');
    expect(classeDoTipoV1('CDB IPCA+')).toBe('CDB');
    expect(classeDoTipoV1(undefined)).toBe('Outro');
    const d = migrarDados({ versao: 1, aportes: [aporteV1({ id: 'x' }, 'Outro renda fixa')], parametros: parametrosV1() });
    expect(d.aportes[0].classe).toBe('Outro');
  });

  it('é idempotente', () => {
    const uma = migrarDados(dadosV1());
    expect(migrarDados(uma)).toEqual(uma);
    expect(migrarDados(JSON.parse(JSON.stringify(uma)))).toEqual(uma);
  });

  it('parâmetros v1 ganham regimes padrão sem perder o que foi configurado', () => {
    const tabelaIR = [
      { aPartirDeDias: 0, aliquota: 0.2 },
      { aPartirDeDias: 400, aliquota: 0.1 },
    ];
    const feriados = ['2026-11-20', '2026-12-25'];
    const d = migrarDados({ versao: 1, aportes: [], parametros: parametrosV1({ cdiAnual: 0.1365, cdiAutomatico: false, feriados, tabelaIR }) });
    expect(d.parametros.cdiAnual).toBe(0.1365);
    expect(d.parametros.feriados).toEqual(feriados);
    expect(d.parametros.tabelaIR).toEqual(tabelaIR);
    expect(d.parametros.regimes.CDB).toEqual(parametrosPadrao().regimes.CDB);
    expect(d.parametros.regimes.Outro).toEqual(parametrosPadrao().regimes.Outro);
  });

  it('números da carteira real não mudam', () => {
    const v1 = dadosV1() as { aportes: Parameters<typeof avaliar>[0][]; parametros: Parameters<typeof avaliar>[2] };
    const d = migrarDados(v1);
    const cal = new Calendario(d.parametros.feriados);
    const p1 = { ...parametrosPadrao(), ...v1.parametros }; // o motor sobre os dados como eram antes
    const aval = (dataRef: (i: number) => string) =>
      d.aportes.map((a, i) => {
        const novo = avaliar(a, dataRef(i), d.parametros, cal);
        const antigo = avaliar(v1.aportes[i], dataRef(i), p1, cal);
        expect([novo.liquido, novo.ir, novo.iof]).toEqual([antigo.liquido, antigo.ir, antigo.iof]);
        return +novo.liquido.toFixed(2);
      });
    expect(aval(() => HOJE_CARTEIRA_REAL)).toEqual(LIQUIDO_HOJE_CARTEIRA_REAL);
    expect(aval((i) => d.aportes[i].vencimento)).toEqual(LIQUIDO_VENCIMENTO_CARTEIRA_REAL);
  });

  it('rejeita lixo e versão futura', () => {
    expect(() => migrarDados(null)).toThrow(Error);
    expect(() => migrarDados({})).toThrow(Error);
    expect(() => migrarDados({ versao: 1, aportes: 'x' })).toThrow(Error);
    expect(() => migrarDados({ versao: 1, aportes: [], parametros: null })).toThrow(Error);
    expect(() => migrarDados({ versao: 1, aportes: [null], parametros: {} })).toThrow(Error);
    expect(() => migrarDados({ versao: 3, aportes: [], parametros: {} })).toThrow(/versão mais nova do app/);
  });
});

describe('regimes salvos (normalizarParametros)', () => {
  // Regimes como a Fase 1 gravava (sem `regimesVersao`, carência em dias).
  const regimesFase1 = () => ({
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
  });
  const padrao = () => parametrosPadrao();

  it('regimes padrão antigos sem edição são atualizados', () => {
    const p = normalizarParametros({ ...parametrosV1(), regimes: regimesFase1() } as never);
    expect(p.regimes).toEqual(padrao().regimes);
    expect(p.regimesVersao).toBe(padrao().regimesVersao);
  });

  it('regimes editados pelo usuário são mantidos', () => {
    const editados = regimesFase1();
    editados.CDB.fgc = false;
    const p = normalizarParametros({ ...parametrosV1(), regimes: editados } as never);
    expect(p.regimes.CDB).toMatchObject({ ir: 'regressivo', iof: true, fgc: false, carenciaMinimaMeses: 0, fonte: editados.CDB.fonte });
    expect(p.regimes.CDB).not.toHaveProperty('carenciaMinimaDias');
    expect(p.regimes.Outro).toEqual(padrao().regimes.Outro); // não editado: recebe o padrão novo
    expect(p.regimes.LCA).toEqual(padrao().regimes.LCA); // classe nova entra com o padrão
    // edição feita já na versão atual também é mantida
    const atual = padrao();
    const lca = { ...atual.regimes.LCA, carenciaMinimaMeses: 9 };
    const q = normalizarParametros({ ...atual, regimes: { ...atual.regimes, LCA: lca } });
    expect(q.regimes.LCA).toEqual(lca);
  });

  it('dados da Fase 1 (CDB/Outro com carenciaMinimaDias) são lidos', () => {
    const fase1 = {
      versao: 2,
      aportes: [{ ...aporteV1({ id: 'f1', vencimento: '2028-10-05' }), tipo: undefined, classe: 'CDB' }, { ...aporteV1({ id: 'f2' }), tipo: undefined, classe: 'Outro' }],
      parametros: { ...parametrosV1(), regimes: regimesFase1() },
    };
    const d = migrarDados(JSON.parse(JSON.stringify(fase1)));
    expect(d.aportes.map((a) => a.classe)).toEqual(['CDB', 'Outro']);
    for (const r of Object.values(d.parametros.regimes)) {
      expect(typeof r.carenciaMinimaMeses).toBe('number');
      expect(r).not.toHaveProperty('carenciaMinimaDias');
    }
    const cal = new Calendario(d.parametros.feriados);
    expect(Number.isFinite(avaliar(d.aportes[0], '2027-10-05', d.parametros, cal).liquido)).toBe(true);
  });
});
