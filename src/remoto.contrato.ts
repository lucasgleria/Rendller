import { describe, expect, it } from 'vitest';
import type { Cifra, Remoto } from './remoto';

/**
 * Contrato compartilhado: roda os mesmos casos contra qualquer implementação de `Remoto & Cifra`.
 * Só é importado por testes (importa o Vitest; nunca entra no app).
 * Cada chamada de `fabrica` deve criar um cofre novo e vazio, com chave própria.
 */
export function contratoRemoto(nome: string, fabrica: () => Promise<Remoto & Cifra>): void {
  describe(`contrato Remoto: ${nome}`, () => {
    it('ler num cofre vazio dá inexistente', async () => {
      const r = await fabrica();
      expect(await r.ler()).toEqual({ tipo: 'inexistente' });
    });

    it('gravar sobre a versão 0 cria a versão 1; repetir dá conflito', async () => {
      const r = await fabrica();
      const e = await r.cifrar({ n: 1 });
      expect(await r.gravar(0, e)).toMatchObject({ tipo: 'ok', versao: 1 });
      expect(await r.gravar(0, e)).toEqual({ tipo: 'conflito', versao: 1 });
    });

    it('gravar sobre a versão 1 cria a 2 e ler devolve o último envelope', async () => {
      const r = await fabrica();
      await r.gravar(0, await r.cifrar({ n: 1 }));
      const e2 = await r.cifrar({ n: 2 });
      expect(await r.gravar(1, e2)).toMatchObject({ tipo: 'ok', versao: 2 });
      const lido = await r.ler();
      expect(lido).toMatchObject({ tipo: 'ok', versao: 2, envelope: e2 });
      if (lido.tipo !== 'ok' || !lido.envelope) throw new Error('esperava ok com envelope');
      expect(await r.decifrar(lido.envelope)).toEqual({ n: 2 });
    });

    it('cifrar e decifrar fazem a ida e volta sem expor o conteúdo', async () => {
      const r = await fabrica();
      const dados = { aportes: [{ emissor: 'Banco Secreto', valor: 500 }] };
      const e = await r.cifrar(dados);
      expect(JSON.stringify(e)).not.toContain('Banco Secreto');
      expect(await r.decifrar(e)).toEqual(dados);
    });

    it('um envelope de outra chave não decifra', async () => {
      const a = await fabrica();
      const b = await fabrica();
      await expect(b.decifrar(await a.cifrar({ n: 1 }))).rejects.toThrow();
    });

    it('apagar volta o cofre a inexistente', async () => {
      const r = await fabrica();
      await r.gravar(0, await r.cifrar({ n: 1 }));
      await r.apagar();
      expect(await r.ler()).toEqual({ tipo: 'inexistente' });
    });
  });
}
