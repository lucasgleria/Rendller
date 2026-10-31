import { describe, expect, it } from 'vitest';
import type { Cifra, Remoto } from './remoto';

/**
 * Contrato compartilhado: roda os mesmos casos contra qualquer implementação de `Remoto & Cifra`.
 * Só é importado por testes (importa o Vitest; nunca entra no app).
 * Cada chamada de `fabrica` deve criar um cofre novo e vazio, com chave própria.
 * `credencialInvalida` (opcional) cria um cofre novo e um segundo acesso ao MESMO cofre com credencial ou sessão
 * inválida; sem ela, os casos de acesso negado ficam como `skip`.
 */
export function contratoRemoto(
  nome: string,
  fabrica: () => Promise<Remoto & Cifra>,
  credencialInvalida?: () => Promise<{ certo: Remoto & Cifra; errado: Remoto }>,
): void {
  describe(`contrato Remoto: ${nome}`, () => {
    const itNegado = credencialInvalida ? it : it.skip;

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

    it('gravar com base maior que a atual dá conflito com a versão atual', async () => {
      const r = await fabrica();
      await r.gravar(0, await r.cifrar({ n: 1 }));
      expect(await r.gravar(5, await r.cifrar({ n: 5 }))).toEqual({ tipo: 'conflito', versao: 1 });
    });

    it('ler depois de um conflito devolve o envelope anterior', async () => {
      const r = await fabrica();
      const e1 = await r.cifrar({ n: 1 });
      await r.gravar(0, e1);
      expect(await r.gravar(0, await r.cifrar({ n: 2 }))).toMatchObject({ tipo: 'conflito' });
      expect(await r.ler()).toMatchObject({ tipo: 'ok', versao: 1, envelope: e1 });
    });

    itNegado('credencial ou sessão inválida: negado em ler e gravar, erro em apagar, e o cofre fica intacto', async () => {
      const { certo, errado } = await credencialInvalida!();
      const e = await certo.cifrar({ n: 1 });
      await certo.gravar(0, e);
      expect(await errado.ler()).toEqual({ tipo: 'negado' });
      expect(await errado.gravar(1, e)).toEqual({ tipo: 'negado' });
      await expect(errado.apagar()).rejects.toThrow();
      expect(await certo.ler()).toMatchObject({ tipo: 'ok', versao: 1, envelope: e });
    });

    it('apagar volta o cofre a inexistente', async () => {
      const r = await fabrica();
      await r.gravar(0, await r.cifrar({ n: 1 }));
      await r.apagar();
      expect(await r.ler()).toEqual({ tipo: 'inexistente' });
    });
  });
}
