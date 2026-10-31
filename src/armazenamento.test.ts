import { describe, expect, it } from 'vitest';
import { CHAVE, CHAVE_ILEGIVEL, CHAVE_V1, carregarDe } from './armazenamento';
import { dadosVazios, novoAporte, parametrosPadrao } from './domain/padroes';

/** `Storage` em memória (os testes rodam no Node, sem `localStorage`). */
function memoria(inicial: Record<string, string> = {}) {
  const mapa = new Map(Object.entries(inicial));
  return {
    mapa,
    getItem: (k: string) => mapa.get(k) ?? null,
    setItem: (k: string, v: string) => void mapa.set(k, v),
  };
}

function brutoV1(n: number): string {
  const { regimes: _, ...parametros } = parametrosPadrao();
  const aportes = Array.from({ length: n }, (_, i) => {
    const { classe: __, ...a } = novoAporte({ id: `a${i}`, emissor: 'PagBank', valor: 500, dataAporte: '2026-08-19', vencimento: '2028-08-10' });
    return { ...a, tipo: 'CDB Pós-fixado' };
  });
  return JSON.stringify({ versao: 1, aportes, parametros });
}

describe('armazenamento local (carregarDe)', () => {
  it('só v1 salva: migra e não apaga a v1', () => {
    const v1 = brutoV1(3);
    const s = memoria({ [CHAVE_V1]: v1 });
    const { dados, podeGravar } = carregarDe(s);
    expect(dados.versao).toBe(2);
    expect(dados.aportes.map((a) => a.id)).toEqual(['a0', 'a1', 'a2']);
    expect(dados.aportes.every((a) => a.classe === 'CDB')).toBe(true);
    expect(podeGravar).toBe(true);
    expect(s.getItem(CHAVE_V1)).toBe(v1);
  });

  it('v2 salva tem prioridade sobre v1', () => {
    const v2 = { ...dadosVazios(), aportes: [novoAporte({ id: 'novo' })] };
    const s = memoria({ [CHAVE_V1]: brutoV1(3), [CHAVE]: JSON.stringify(v2) });
    const { dados, podeGravar } = carregarDe(s);
    expect(dados.aportes.map((a) => a.id)).toEqual(['novo']);
    expect(podeGravar).toBe(true);
  });

  it('conteúdo ilegível é guardado e não é sobrescrito', () => {
    const s = memoria({ [CHAVE_V1]: '{quebrado' });
    const r = carregarDe(s);
    expect(r.podeGravar).toBe(false);
    expect(s.getItem(CHAVE_ILEGIVEL)).toBe('{quebrado');
    expect(s.getItem(CHAVE_V1)).toBe('{quebrado');
    expect(s.getItem(CHAVE)).toBeNull();
  });

  it('versão futura também é guardada sem gravar por cima', () => {
    const futuro = JSON.stringify({ versao: 3, aportes: [], parametros: {} });
    const s = memoria({ [CHAVE]: futuro });
    expect(carregarDe(s).podeGravar).toBe(false);
    expect(s.getItem(CHAVE_ILEGIVEL)).toBe(futuro);
    expect(s.getItem(CHAVE)).toBe(futuro);
  });

  it('navegador vazio', () => {
    const r = carregarDe(memoria());
    expect(r.dados).toEqual(dadosVazios());
    expect(r.podeGravar).toBe(true);
  });
});
