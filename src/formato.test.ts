import { describe, expect, it } from 'vitest';
import { CLASSES, novoAporte } from './domain/padroes';
import { rotuloAporte, rotuloClasse } from './formato';

describe('rótulos de exibição', () => {
  it('um rótulo único por classe, o mesmo do select', () => {
    for (const c of CLASSES) expect(rotuloClasse(c.valor)).toBe(c.rotulo);
    expect(rotuloClasse('LCA')).toBe('LCA'); // classe de uma versão mais nova: mostra como veio
  });
  it('% do CDI sem arredondamento enganoso', () => {
    expect(rotuloAporte(novoAporte({ pctCdi: 1.03 }))).toBe('CDB · 103% do CDI');
    expect(rotuloAporte(novoAporte({ pctCdi: 1.085 }))).toBe('CDB · 108,5% do CDI');
    expect(rotuloAporte(novoAporte({ pctCdi: 1.0325 }))).toBe('CDB · 103,25% do CDI');
    expect(rotuloAporte(novoAporte({ classe: 'Outro', indexador: 'PRE' }))).toBe(`${rotuloClasse('Outro')} · Prefixado`);
  });
});
