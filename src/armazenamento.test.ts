import { describe, expect, it } from 'vitest';
import { CHAVE, CHAVE_ILEGIVEL, CHAVE_V1, avisoCarga, carregarDe } from './armazenamento';
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
  const { regimes: _, regimesVersao: _v, ...parametros } = parametrosPadrao();
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

  it('v1 salva informa a origem e devolve o bruto (para ajustar a impressão da sincronização)', () => {
    const v1 = brutoV1(2);
    const r = carregarDe(memoria({ [CHAVE_V1]: v1 }));
    expect(r.origem).toBe('v1');
    expect(r.bruto).toEqual(JSON.parse(v1));
    const v2 = carregarDe(memoria({ [CHAVE]: JSON.stringify(dadosVazios()) }));
    expect(v2.origem).toBe('v2');
    expect(v2.bruto).toEqual(JSON.parse(JSON.stringify(dadosVazios())));
    expect(carregarDe(memoria()).origem).toBe('vazio');
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
    expect(r.origem).toBe('ilegivel');
    expect(r.motivo).toBe('ilegivel');
    expect(avisoCarga(r)).toContain('cópia guardada');
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

  it('v2 corrompida com v1 boa: não recorre à v1 e avisa que ela existe', () => {
    const v1 = brutoV1(3);
    const s = memoria({ [CHAVE_V1]: v1, [CHAVE]: '{quebrado' });
    const r = carregarDe(s);
    expect(r.podeGravar).toBe(false);
    expect(r.origem).toBe('ilegivel');
    expect(r.dados.aportes).toEqual([]);
    expect(r.temV1).toBe(true);
    expect(avisoCarga(r)).toMatch(/versão antiga/);
    expect(s.getItem(CHAVE_V1)).toBe(v1);
    expect(s.getItem(CHAVE)).toBe('{quebrado');
    // só a v1 ilegível não é "versão antiga intacta"
    const so = carregarDe(memoria({ [CHAVE_V1]: '{quebrado' }));
    expect(so.temV1).toBe(false);
    expect(avisoCarga(so)).not.toMatch(/versão antiga/);
  });

  it('não sobrescreve uma cópia ilegível diferente já guardada', () => {
    const s = memoria({ [CHAVE_ILEGIVEL]: 'cópia anterior', [CHAVE]: '{quebrado' });
    carregarDe(s);
    expect(s.getItem(CHAVE_ILEGIVEL)).toBe('cópia anterior');
    const extras = [...s.mapa.keys()].filter((k) => k.startsWith(`${CHAVE_ILEGIVEL}:`));
    expect(extras.length).toBe(1);
    expect(s.getItem(extras[0])).toBe('{quebrado');
    // mesma cópia de novo: nada a acrescentar
    const t = memoria({ [CHAVE_ILEGIVEL]: '{quebrado', [CHAVE]: '{quebrado' });
    carregarDe(t);
    expect([...t.mapa.keys()].filter((k) => k.startsWith(`${CHAVE_ILEGIVEL}:`))).toEqual([]);
  });

  it('armazenamento bloqueado não é chamado de ilegível', () => {
    const bloqueado = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    const r = carregarDe(bloqueado);
    expect(r.podeGravar).toBe(false);
    expect(r.motivo).toBe('bloqueado');
    expect(avisoCarga(r)).not.toContain('cópia guardada');
    expect(avisoCarga(r)).toMatch(/bloqueado/);
    expect(avisoCarga(carregarDe(memoria()))).toBeNull();
  });

  it('navegador vazio', () => {
    const r = carregarDe(memoria());
    expect(r.dados).toEqual(dadosVazios());
    expect(r.podeGravar).toBe(true);
  });
});
