import { describe, expect, it } from 'vitest';
import { avaliar } from './calculo';
import { APORTES_CARTEIRA_REAL, HOJE_CARTEIRA_REAL, LIQUIDO_HOJE_CARTEIRA_REAL, LIQUIDO_VENCIMENTO_CARTEIRA_REAL } from './carteiraReal.fixture';
import { Calendario } from './datas';
import { classeDoTipoV1, migrarDados, planejarMigracao } from './migracao';
import type { Dados } from './types';
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

  it('sem marcador → padrão atual', () => {
    // mesmo diferente do padrão, um regime sem `editado` (ex.: da Fase 1) recebe o padrão da versão atual
    const fase1 = regimesFase1();
    fase1.CDB.fgc = false;
    const p = normalizarParametros({ ...parametrosV1(), regimes: fase1 } as never);
    expect(p.regimes.CDB).toEqual(padrao().regimes.CDB);
    expect(p.regimes.LCA).toEqual(padrao().regimes.LCA); // classe nova entra com o padrão
  });

  it('editado → mantém', () => {
    const atual = padrao();
    const lca = { ...atual.regimes.LCA, carenciaMinimaMeses: 9, editado: true };
    const q = normalizarParametros({ ...atual, regimes: { ...atual.regimes, LCA: lca } });
    expect(q.regimes.LCA).toEqual(lca);
    expect(q.regimes.LCI).toEqual(atual.regimes.LCI);
  });

  it("fonte 'Editado pelo usuário' sem o campo → mantém", () => {
    const atual = padrao();
    const cdb = { ...atual.regimes.CDB, fgc: false, fonte: `Editado pelo usuário (padrão: ${atual.regimes.CDB.fonte})` };
    const q = normalizarParametros({ ...atual, regimes: { ...atual.regimes, CDB: cdb } });
    expect(q.regimes.CDB).toEqual({ ...cdb, editado: true });
  });

  it('regimes da nuvem ou de backup são validados por tipo', () => {
    const atual = padrao();
    const lixo = JSON.parse(
      '{"LCI":{"ir":"xyz","iof":"false","fgc":1,"carenciaMinimaMeses":"6","carenciaMinimaMesesIndicePrecos":-1,"fonte":7,"editado":true},' +
        '"__proto__":{"ir":"isento","poluido":true},"constructor":{"ir":"isento"},"prototype":{"ir":"isento"}}',
    );
    const q = normalizarParametros({ ...atual, regimes: lixo });
    const { editado, ...lci } = q.regimes.LCI;
    expect(editado).toBe(true);
    expect(lci).toEqual(atual.regimes.LCI); // todo campo inválido usa o padrão
    expect(Object.getPrototypeOf(q.regimes)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).poluido).toBeUndefined();
    for (const k of ['__proto__', 'constructor', 'prototype']) expect(Object.prototype.hasOwnProperty.call(q.regimes, k)).toBe(false);
    // meses fracionários não entram
    const r = normalizarParametros({ ...atual, regimes: { ...atual.regimes, LCA: { ...atual.regimes.LCA, carenciaMinimaMeses: 6.5, editado: true } } });
    expect(r.regimes.LCA.carenciaMinimaMeses).toBe(6);
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

describe('planejamento da migração para a conta', () => {
  const com = (...ids: string[]): Dados => ({
    versao: 2,
    aportes: ids.map((id) => novoAporte({ id, emissor: 'Banco X', valor: 500, dataAporte: '2026-08-19', vencimento: '2028-08-10' })),
    parametros: parametrosPadrao(),
  });
  const vazio = () => com();

  it('navegador com aportes e conta vazia: enviar do navegador', () => {
    expect(planejarMigracao(com('a'), null, null)).toEqual({ acao: 'enviar', dados: com('a'), origem: 'navegador' });
    expect(planejarMigracao(com('a'), null, vazio())).toEqual({ acao: 'enviar', dados: com('a'), origem: 'navegador' });
  });

  it('navegador igual ao cofre antigo: um só candidato, enviar', () => {
    const p = planejarMigracao(com('a', 'b'), com('a', 'b'), null);
    expect(p).toMatchObject({ acao: 'enviar', dados: com('a', 'b') });
  });

  it('só o cofre antigo tem aportes: enviar do cofre antigo', () => {
    expect(planejarMigracao(vazio(), com('x'), null)).toEqual({ acao: 'enviar', dados: com('x'), origem: 'cofre-antigo' });
  });

  it('navegador diferente do cofre antigo: escolher entre os dois (nunca funde)', () => {
    const p = planejarMigracao(com('a'), com('b'), null);
    expect(p.acao).toBe('escolher');
    if (p.acao !== 'escolher') return;
    expect(p.candidatos.map((c) => [c.origem, c.aportes])).toEqual([
      ['navegador', 1],
      ['cofre-antigo', 1],
    ]);
    expect(p.candidatos[0].dados).toEqual(com('a')); // os dados inteiros de cada origem
    expect(p.candidatos[1].dados).toEqual(com('b'));
  });

  it('aparelho novo vazio e conta com dados: baixar', () => {
    expect(planejarMigracao(vazio(), null, com('c'))).toEqual({ acao: 'baixar', dados: com('c') });
  });

  it('navegador igual à conta: nada', () => {
    expect(planejarMigracao(com('c'), null, com('c'))).toEqual({ acao: 'nada' });
    expect(planejarMigracao(com('c'), com('c'), com('c'))).toEqual({ acao: 'nada' });
  });

  it('navegador com aportes e conta diferente: escolher, sem enviar', () => {
    const p = planejarMigracao(com('a'), null, com('c'));
    expect(p.acao).toBe('escolher');
    if (p.acao === 'escolher') expect(p.candidatos.map((c) => c.origem)).toEqual(['navegador', 'conta']);
  });

  it('vazio nunca vence quem tem aportes', () => {
    expect(planejarMigracao(vazio(), vazio(), com('c'))).toEqual({ acao: 'baixar', dados: com('c') });
    expect(planejarMigracao(com('a'), vazio(), vazio())).toMatchObject({ acao: 'enviar', origem: 'navegador' });
  });

  it('tudo vazio: nada', () => {
    expect(planejarMigracao(vazio(), null, null)).toEqual({ acao: 'nada' });
    expect(planejarMigracao(vazio(), vazio(), vazio())).toEqual({ acao: 'nada' });
  });

  it('três versões diferentes: os três candidatos, cada um inteiro', () => {
    const p = planejarMigracao(com('a', 'n'), com('a'), com('a', 'c'));
    expect(p.acao).toBe('escolher');
    if (p.acao === 'escolher') expect(p.candidatos.map((c) => [c.origem, c.aportes])).toEqual([['navegador', 2], ['cofre-antigo', 1], ['conta', 2]]);
  });

  it('backup .json v1 importado: migrarDados e depois planejarMigracao com conta vazia dão enviar com versao 2', () => {
    const v1 = { versao: 1, aportes: [aporteV1({ id: 'b1', vencimento: '2028-01-10' })], parametros: parametrosV1() };
    const p = planejarMigracao(migrarDados(JSON.parse(JSON.stringify(v1))), null, null);
    expect(p.acao).toBe('enviar');
    if (p.acao === 'enviar') {
      expect(p.dados.versao).toBe(2);
      expect(p.dados.aportes[0].classe).toBe('CDB');
      expect('tipo' in p.dados.aportes[0]).toBe(false);
    }
  });
});
