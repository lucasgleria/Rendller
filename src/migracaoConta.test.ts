import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tratarCofre } from '../netlify/cofre';
import { cifrar, remotoCofreAntigo, type Credenciais } from './cofre';
import { memoria } from './cofre.memoria';
import { remotoDaConta } from './conta';
import { BancoFalso, clienteFalso, novoUid } from './conta.falso';
import type { Candidato } from './domain/migracao';
import { novoAporte, parametrosPadrao } from './domain/padroes';
import { paraNuvem } from './domain/sincronia';
import type { Dados } from './domain/types';
import {
  armazenamentoMigracao,
  CHAVE_COPIA_CONTA,
  CHAVE_SYNC_MIGRADO,
  CHAVE_SYNC_V1,
  concluirEscolha,
  lerCofreAntigoCom,
  migrarParaConta,
  nomeBackup,
  type DepsMigracao,
} from './migracaoConta';
import type { Remoto } from './remoto';
import { escolherConfig, lerConfigSalva, lerContaSalva, MENSAGEM_FRASE_DIFERENTE } from './sincronizacaoNucleo';

const AGORA = '2026-11-01T12:00:00.000Z';

function com(...ids: string[]): Dados {
  return {
    versao: 2,
    aportes: ids.map((id, i) => novoAporte({ id, emissor: 'PagBank', valor: 100 * (i + 1), dataAporte: '2026-08-19', vencimento: '2028-08-10' })),
    parametros: parametrosPadrao(),
  };
}

function credAleatoria(): Credenciais {
  const hexa = () => [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, '0')).join('');
  return { id: hexa(), token: hexa(), chave: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))) };
}

/** `Storage` em memória (com removeItem). */
function storage(inicial: Record<string, string> = {}) {
  const mapa = new Map(Object.entries(inicial));
  return {
    mapa,
    getItem: (k: string) => mapa.get(k) ?? null,
    setItem: (k: string, v: string) => void mapa.set(k, v),
    removeItem: (k: string) => void mapa.delete(k),
  };
}

let arm: ReturnType<typeof memoria>;
beforeEach(() => {
  arm = memoria();
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => tratarCofre(new Request(`https://rendller.test${url}`, init), arm));
});
afterEach(() => vi.unstubAllGlobals());

/** Grava `d` no cofre antigo de `cred`, como um aparelho com a sincronização antiga faria. */
async function noCofreAntigo(cred: Credenciais, d: Dados, base = 0) {
  const r = remotoCofreAntigo(cred);
  expect(await r.gravar(base, await cifrar(cred, paraNuvem(d)))).toMatchObject({ tipo: 'ok' });
}

/** Um aparelho: navegador, cofre antigo (opcional), conta no falso, storage em memória e registro da ordem. */
function aparelho(o: { local: Dados; cred?: Credenciais; banco: BancoFalso; uid: string; chave?: { id: string; chave: string }; s?: ReturnType<typeof storage> }) {
  const s = o.s ?? storage(o.cred ? { [CHAVE_SYNC_V1]: JSON.stringify({ cred: o.cred, versao: 1, impressao: '', ultimaSync: '' }) } : {});
  const chave = o.chave ?? { id: o.uid, chave: credAleatoria().chave };
  const contaReal = remotoDaConta(clienteFalso(o.banco, () => o.uid), chave);
  const ordem: string[] = [];
  const estado = { local: o.local, migrado: null as string | null, backups: [] as { nome: string; dados: Dados }[], marcado: null as null | { versao: number; dados: Dados } };
  const armz = armazenamentoMigracao(s);
  const conta: Remoto = {
    ler: async () => (ordem.push('conta.ler'), contaReal.ler()),
    gravar: async (b, e) => (ordem.push('conta.gravar'), contaReal.gravar(b, e)),
    apagar: async () => (ordem.push('conta.apagar'), contaReal.apagar()),
  };
  const deps: DepsMigracao = {
    lerNavegador: () => (ordem.push('lerNavegador'), estado.local),
    lerCofreAntigo: async () => {
      ordem.push('lerCofreAntigo');
      const c = lerConfigSalva(s.getItem(CHAVE_SYNC_V1));
      return c && c.origem === 'cofre-antigo' ? lerCofreAntigoCom(c.cred, estado.local) : null;
    },
    conta,
    cifraConta: async () => contaReal,
    baixarBackup: (d, nome) => (ordem.push('baixarBackup'), estado.backups.push({ nome, dados: d })),
    guardarCopia: (d, origem) => (ordem.push('guardarCopia'), armz.guardarCopia(d, origem, AGORA)),
    aplicarLocal: (d) => (ordem.push('aplicarLocal'), (estado.local = d)),
    arquivarCofreAntigo: () => (ordem.push('arquivarCofreAntigo'), armz.arquivarCofreAntigo()),
    marcarMigrado: (em, e) => (ordem.push('marcarMigrado'), (estado.migrado = em), (estado.marcado = e)),
    migradoEm: () => estado.migrado,
  };
  return { deps, ordem, estado, s, contaReal };
}

async function lerConta(banco: BancoFalso, uid: string, r: { decifrar(e: { iv: string; cifrado: string }): Promise<unknown> }) {
  const l = banco.linhas.get(uid);
  return l ? ((await r.decifrar({ iv: l.iv, cifrado: l.cifrado })) as Dados) : null;
}

describe('migração para a conta', () => {
  it('migra navegador + cofre antigo para a conta vazia sem perder nada', async () => {
    const cred = credAleatoria();
    await noCofreAntigo(cred, com('a', 'b'));
    const banco = new BancoFalso();
    const uid = novoUid();
    const ap = aparelho({ local: com('a', 'b'), cred, banco, uid });
    const r = await migrarParaConta(ap.deps, AGORA);
    expect(r).toMatchObject({ tipo: 'concluida', plano: { acao: 'enviar' }, backup: nomeBackup(AGORA), contagens: { navegador: 2, 'cofre-antigo': 2, conta: null } });
    const gravado = (await lerConta(banco, uid, ap.contaReal))!;
    expect(gravado.versao).toBe(2);
    expect(gravado.aportes.map((a) => a.id)).toEqual(['a', 'b']);
    expect(gravado.aportes.reduce((s, a) => s + a.valor, 0)).toBe(300);
    expect(gravado.aportes.every((a) => a.classe === 'CDB')).toBe(true);
    // backup antes de qualquer leitura de rede; cópia local antes do primeiro gravar
    expect(ap.ordem[0]).toBe('lerNavegador');
    expect(ap.ordem[1]).toBe('baixarBackup');
    expect(ap.ordem.indexOf('guardarCopia')).toBeLessThan(ap.ordem.indexOf('conta.gravar'));
    expect(ap.s.getItem(CHAVE_COPIA_CONTA)).not.toBeNull();
    expect(ap.estado.backups).toEqual([{ nome: 'rendller-antes-da-conta-2026-11-01.json', dados: com('a', 'b') }]);
    expect(ap.ordem.slice(-2)).toEqual(['arquivarCofreAntigo', 'marcarMigrado']);
    expect(ap.estado.marcado).toMatchObject({ versao: 1 });
  });

  it('cofre antigo nunca é apagado e para de sincronizar sozinho neste aparelho', async () => {
    const cred = credAleatoria();
    await noCofreAntigo(cred, com('a'));
    const ap = aparelho({ local: com('a'), cred, banco: new BancoFalso(), uid: novoUid() });
    await migrarParaConta(ap.deps, AGORA);
    expect(arm.mapa.has(cred.id)).toBe(true); // o registro continua no servidor
    expect(ap.ordem.filter((x) => x === 'arquivarCofreAntigo')).toHaveLength(1);
    expect(ap.s.getItem(CHAVE_SYNC_V1)).toBeNull();
    expect(lerConfigSalva(ap.s.getItem(CHAVE_SYNC_MIGRADO))).toMatchObject({ cred }); // nada perdido
    // sem config de conta (ex.: depois de sair), o cofre antigo não volta sozinho
    expect(escolherConfig(lerConfigSalva(ap.s.getItem(CHAVE_SYNC_V1)), lerContaSalva(ap.s.getItem('rendller:conta:v1')))).toBeNull();
  });

  it('conflito não grava nada; concluirEscolha grava e guarda a versão descartada', async () => {
    const banco = new BancoFalso();
    const uid = novoUid();
    const chave = { id: uid, chave: credAleatoria().chave };
    const outro = remotoDaConta(clienteFalso(banco, () => uid), chave);
    await outro.gravar(0, await outro.cifrar(paraNuvem(com('c'))));
    banco.chamadas = [];
    const ap = aparelho({ local: com('a'), banco, uid, chave });
    const r = await migrarParaConta(ap.deps, AGORA);
    expect(r.tipo).toBe('escolha-pendente');
    expect(ap.ordem).not.toContain('conta.gravar');
    expect(ap.ordem).not.toContain('aplicarLocal');
    expect(ap.ordem).not.toContain('arquivarCofreAntigo');
    expect(banco.rpcs()).toBe(0);
    if (r.tipo !== 'escolha-pendente') return;
    const navegador = r.candidatos.find((c) => c.origem === 'navegador') as Candidato;
    const fim = await concluirEscolha(ap.deps, navegador, AGORA);
    expect(fim).toMatchObject({ tipo: 'concluida' });
    expect((await lerConta(banco, uid, outro))!.aportes.map((a) => a.id)).toEqual(['a']);
    // a versão da conta que foi substituída fica guardada
    const copia = JSON.parse(ap.s.getItem(CHAVE_COPIA_CONTA)!);
    expect(copia.versoes.map((v: { origem: string; dados: Dados }) => [v.origem, v.dados.aportes.map((a) => a.id)])).toContainEqual(['conta', ['c']]);
  });

  it('escolher a conta aplica aqui e guarda o navegador descartado', async () => {
    const banco = new BancoFalso();
    const uid = novoUid();
    const chave = { id: uid, chave: credAleatoria().chave };
    const outro = remotoDaConta(clienteFalso(banco, () => uid), chave);
    await outro.gravar(0, await outro.cifrar(paraNuvem(com('c'))));
    const ap = aparelho({ local: com('a'), banco, uid, chave });
    const r = await migrarParaConta(ap.deps, AGORA);
    if (r.tipo !== 'escolha-pendente') throw new Error('esperava escolha');
    banco.chamadas = [];
    await concluirEscolha(ap.deps, r.candidatos.find((c) => c.origem === 'conta')!, AGORA);
    expect(banco.rpcs()).toBe(0);
    expect(ap.estado.local.aportes.map((a) => a.id)).toEqual(['c']);
    const copia = JSON.parse(ap.s.getItem(CHAVE_COPIA_CONTA)!);
    expect(copia.versoes.map((v: { origem: string; dados: Dados }) => [v.origem, v.dados.aportes.map((a) => a.id)])).toContainEqual(['navegador', ['a']]);
  });

  it('segundo aparelho ainda no cofre antigo, editado depois que o primeiro migrou: escolha com os três, nada fundido', async () => {
    const cred = credAleatoria();
    const banco = new BancoFalso();
    const uid = novoUid();
    const chave = { id: uid, chave: credAleatoria().chave };
    await noCofreAntigo(cred, com('a'));
    // aparelho 1 migra
    const ap1 = aparelho({ local: com('a'), cred, banco, uid, chave });
    expect(await migrarParaConta(ap1.deps, AGORA)).toMatchObject({ tipo: 'concluida' });
    // aparelho 2 (ainda no cofre antigo) edita e sincroniza; depois edita de novo sem sincronizar
    await noCofreAntigo(cred, com('a', 'b'), 1);
    banco.chamadas = [];
    const ap2 = aparelho({ local: com('a', 'b', 'n'), cred, banco, uid, chave });
    const r = await migrarParaConta(ap2.deps, AGORA);
    expect(r.tipo).toBe('escolha-pendente');
    if (r.tipo !== 'escolha-pendente') return;
    expect(r.candidatos.map((c) => [c.origem, c.dados.aportes.map((a) => a.id)])).toEqual([
      ['navegador', ['a', 'b', 'n']],
      ['cofre-antigo', ['a', 'b']],
      ['conta', ['a']],
    ]);
    expect(banco.rpcs()).toBe(0);
    expect(ap2.ordem).not.toContain('aplicarLocal');
    expect(ap2.s.getItem(CHAVE_SYNC_V1)).not.toBeNull(); // ainda não arquivado
    // escolhe o cofre antigo: vai para a conta e para este navegador; o navegador descartado fica guardado
    await concluirEscolha(ap2.deps, r.candidatos[1], AGORA);
    expect((await lerConta(banco, uid, ap2.contaReal))!.aportes.map((a) => a.id)).toEqual(['a', 'b']);
    expect(ap2.estado.local.aportes.map((a) => a.id)).toEqual(['a', 'b']);
    const copia = JSON.parse(ap2.s.getItem(CHAVE_COPIA_CONTA)!);
    expect(copia.versoes.map((v: { origem: string; dados: Dados }) => [v.origem, v.dados.aportes.map((a) => a.id)])).toContainEqual(['navegador', ['a', 'b', 'n']]);
  });

  it('segunda execução não faz nada (com migradoEm)', async () => {
    const ap = aparelho({ local: com('a'), banco: new BancoFalso(), uid: novoUid() });
    await migrarParaConta(ap.deps, AGORA);
    ap.ordem.length = 0;
    expect(await migrarParaConta(ap.deps, AGORA)).toMatchObject({ tipo: 'concluida', plano: { acao: 'nada' } });
    expect(ap.ordem).toEqual([]);
  });

  it("falha de rede ao gravar: resultado 'falhou', navegador intacto, cofre antigo não arquivado, repetir depois funciona", async () => {
    const cred = credAleatoria();
    await noCofreAntigo(cred, com('a'));
    const banco = new BancoFalso();
    const uid = novoUid();
    const ap = aparelho({ local: com('a'), cred, banco, uid });
    const gravarReal = ap.deps.conta.gravar;
    ap.deps.conta.gravar = async () => {
      throw new TypeError('Failed to fetch');
    };
    const r = await migrarParaConta(ap.deps, AGORA);
    expect(r.tipo).toBe('falhou');
    expect(ap.estado.local).toEqual(com('a'));
    expect(ap.ordem).not.toContain('arquivarCofreAntigo');
    expect(ap.ordem).not.toContain('marcarMigrado');
    expect(ap.s.getItem(CHAVE_SYNC_V1)).not.toBeNull();
    ap.deps.conta.gravar = gravarReal;
    expect(await migrarParaConta(ap.deps, AGORA)).toMatchObject({ tipo: 'concluida', plano: { acao: 'enviar' } });
    expect(banco.linhas.get(uid)?.versao).toBe(1);
  });

  it('cofre antigo inacessível (403/404 ou sem rede): migra o navegador e devolve um aviso', async () => {
    const cred = credAleatoria();
    await noCofreAntigo(cred, com('x'));
    const banco = new BancoFalso();
    const uid = novoUid();
    // token errado: 403
    const ap = aparelho({ local: com('a'), cred: { ...cred, token: credAleatoria().token }, banco, uid });
    const r = await migrarParaConta(ap.deps, AGORA);
    expect(r).toMatchObject({ tipo: 'concluida', plano: { acao: 'enviar', origem: 'navegador' } });
    if (r.tipo === 'concluida') expect(r.avisos.join(' ')).toMatch(/cofre antigo/);
    expect(arm.mapa.has(cred.id)).toBe(true);
    // sem rede
    const ap2 = aparelho({ local: com('a'), cred, banco: new BancoFalso(), uid: novoUid() });
    ap2.deps.lerCofreAntigo = async () => {
      throw new TypeError('Failed to fetch');
    };
    const r2 = await migrarParaConta(ap2.deps, AGORA);
    expect(r2.tipo).toBe('concluida');
    if (r2.tipo === 'concluida') expect(r2.avisos).toHaveLength(1);
  });

  it("frase errada numa conta com dados: 'falhou' com a mensagem de frase diferente, zero gravações", async () => {
    const banco = new BancoFalso();
    const uid = novoUid();
    const certa = remotoDaConta(clienteFalso(banco, () => uid), { id: uid, chave: credAleatoria().chave });
    await certa.gravar(0, await certa.cifrar(paraNuvem(com('c'))));
    banco.chamadas = [];
    const ap = aparelho({ local: com('a'), banco, uid }); // chave aleatória = frase errada
    const r = await migrarParaConta(ap.deps, AGORA);
    expect(r).toEqual({ tipo: 'falhou', erro: MENSAGEM_FRASE_DIFERENTE });
    expect(banco.rpcs()).toBe(0);
    expect(ap.ordem).not.toContain('aplicarLocal');
    expect(ap.ordem).not.toContain('arquivarCofreAntigo');
  });

  it('aparelho novo vazio numa conta com dados: baixa, sem pedir escolha', async () => {
    const banco = new BancoFalso();
    const uid = novoUid();
    const chave = { id: uid, chave: credAleatoria().chave };
    const outro = remotoDaConta(clienteFalso(banco, () => uid), chave);
    await outro.gravar(0, await outro.cifrar(paraNuvem(com('c', 'd'))));
    banco.chamadas = [];
    const ap = aparelho({ local: com(), banco, uid, chave });
    const r = await migrarParaConta(ap.deps, AGORA);
    expect(r).toMatchObject({ tipo: 'concluida', plano: { acao: 'baixar' } });
    expect(ap.estado.local.aportes.map((a) => a.id)).toEqual(['c', 'd']);
    expect(banco.rpcs()).toBe(0);
  });

  it('tudo vazio e conta sem cofre: cria o cofre vazio para a sincronização seguir', async () => {
    const banco = new BancoFalso();
    const uid = novoUid();
    const ap = aparelho({ local: com(), banco, uid });
    const r = await migrarParaConta(ap.deps, AGORA);
    expect(r.tipo).toBe('concluida');
    expect(banco.linhas.get(uid)?.versao).toBe(1);
  });
});
