import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tratarCofre } from '../netlify/cofre';
import { cifrar, remotoCofreAntigo, type Credenciais } from './cofre';
import { memoria } from './cofre.memoria';
import { remotoDaConta } from './conta';
import { BancoFalso, clienteFalso, novoUid } from './conta.falso';
import type { Candidato } from './domain/migracao';
import { novoAporte, parametrosPadrao } from './domain/padroes';
import { impressao, paraNuvem, planejarCiclo } from './domain/sincronia';
import type { Dados } from './domain/types';
import {
  adocaoDeConfig,
  armazenamentoMigracao,
  CHAVE_COPIA_CONTA,
  CHAVE_SYNC_MIGRADO,
  CHAVE_SYNC_V1,
  concluirEscolha,
  CHAVE_SYNC_PENDENTE,
  configCofreAntigoSalva,
  configDaAba,
  configParaAba,
  criarDepsMigracao,
  depoisDeDesativar,
  outraAbaMigrou,
  lerCofreAntigoCom,
  migrarParaConta,
  nomeBackup,
  podeGravarCofreAntigo,
  recusaCofreAntigo,
  type ConfigConta,
  type DepsMigracao,
  type FontesMigracao,
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
      const c = configCofreAntigoSalva(s);
      return c ? lerCofreAntigoCom(c.cred, estado.local) : null;
    },
    conta,
    cifraConta: async () => contaReal,
    baixarBackup: (d, nome) => (ordem.push('baixarBackup'), estado.backups.push({ nome, dados: d })),
    guardarCopia: (d, origem) => (ordem.push('guardarCopia'), armz.guardarCopia(d, origem, AGORA)),
    aplicarLocal: (d) => (ordem.push('aplicarLocal'), (estado.local = d)),
    arquivarCofreAntigo: () => (ordem.push('arquivarCofreAntigo'), armz.arquivarCofreAntigo()),
    marcarMigrado: (em, e) => {
      ordem.push('marcarMigrado');
      estado.migrado = em;
      estado.marcado = e;
    },
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

describe('migração com as dependências reais (criarDepsMigracao)', () => {
  /** Fontes como o hook monta, com a conta no falso e registro da ordem. */
  function fontes(o: { local: Dados; banco: BancoFalso; uid: string; chave: { id: string; chave: string }; s: ReturnType<typeof storage> }) {
    const ordem: string[] = [];
    const estado = { local: o.local, config: null as null | ConfigConta };
    const contaReal = remotoDaConta(clienteFalso(o.banco, () => o.uid), o.chave);
    const f: FontesMigracao = {
      agora: AGORA,
      armazenamento: o.s,
      lerDados: () => (ordem.push('lerDados'), estado.local),
      baixarArquivo: (nome) => ordem.push(`baixarArquivo:${nome}`),
      abrirConta: () => {
        ordem.push('abrirConta');
        const sessao = Promise.resolve().then(() => (ordem.push('sessao'), { userId: o.uid, email: 'a@exemplo.com' }));
        return {
          remoto: {
            ler: async () => (await sessao, ordem.push('conta.ler'), contaReal.ler()),
            gravar: async (b, e) => contaReal.gravar(b, e),
            apagar: () => contaReal.apagar(),
          },
          cifra: sessao.then(() => contaReal),
          identidade: sessao.then((s) => ({ ...s, chave: o.chave.chave })),
        };
      },
      lerCofreAntigo: async (cred, local) => (ordem.push('lerCofreAntigo'), lerCofreAntigoCom(cred, local)),
      aplicarLocal: (d) => (estado.local = d),
      aoMigrar: (c) => (estado.config = c),
    };
    return { f, ordem, estado, contaReal };
  }

  it('o backup sai antes de qualquer rede; migradoEm vem da config real', async () => {
    const cred = credAleatoria();
    await noCofreAntigo(cred, com('a'));
    const s = storage({ [CHAVE_SYNC_V1]: JSON.stringify({ cred, versao: 1, impressao: '', ultimaSync: '' }) });
    const uid = novoUid();
    const x = fontes({ local: com('a'), banco: new BancoFalso(), uid, chave: { id: uid, chave: credAleatoria().chave }, s });
    const deps = criarDepsMigracao(x.f);
    expect(x.ordem).toEqual(['lerDados', `baixarArquivo:${nomeBackup(AGORA)}`, 'abrirConta']); // síncrono, antes de qualquer await
    expect(await migrarParaConta(deps, AGORA)).toMatchObject({ tipo: 'concluida' });
    const primeiraRede = Math.min(...['sessao', 'conta.ler', 'lerCofreAntigo'].map((p) => x.ordem.indexOf(p)).filter((i) => i >= 0));
    expect(x.ordem.indexOf(`baixarArquivo:${nomeBackup(AGORA)}`)).toBeLessThan(primeiraRede);
    expect(x.estado.config).toMatchObject({ origem: 'conta', userId: uid, migradoEm: AGORA, versao: 1 });
    // com a config da conta gravada com migradoEm, nada é refeito
    s.setItem('rendller:conta:v1', JSON.stringify(x.estado.config));
    const de2 = criarDepsMigracao(x.f);
    expect(de2.migradoEm()).toBe(AGORA);
    expect(await migrarParaConta(de2, AGORA)).toMatchObject({ tipo: 'concluida', plano: { acao: 'nada' } });
  });

  it('edição feita durante a escolha não some (vai para a cópia ou para a conta)', async () => {
    const banco = new BancoFalso();
    const uid = novoUid();
    const chave = { id: uid, chave: credAleatoria().chave };
    const outro = remotoDaConta(clienteFalso(banco, () => uid), chave);
    await outro.gravar(0, await outro.cifrar(paraNuvem(com('c'))));
    // escolhendo a conta: a versão ATUAL do navegador (com a edição) vai para a cópia
    const s = storage();
    const x = fontes({ local: com('a'), banco, uid, chave, s });
    const deps = criarDepsMigracao(x.f);
    const r = await migrarParaConta(deps, AGORA);
    if (r.tipo !== 'escolha-pendente') throw new Error('esperava escolha');
    x.estado.local = com('a', 'editado-durante-a-escolha');
    await concluirEscolha(deps, r.candidatos.find((c) => c.origem === 'conta')!, AGORA);
    const copia = JSON.parse(s.getItem(CHAVE_COPIA_CONTA)!);
    expect(copia.versoes.map((v: { dados: Dados }) => v.dados.aportes.map((a) => a.id))).toContainEqual(['a', 'editado-durante-a-escolha']);
    expect(x.estado.local.aportes.map((a) => a.id)).toEqual(['c']);
    // escolhendo o navegador: vai para a conta a versão atual, com a edição
    const s2 = storage();
    const y = fontes({ local: com('b'), banco, uid, chave, s: s2 });
    const deps2 = criarDepsMigracao(y.f);
    const r2 = await migrarParaConta(deps2, AGORA);
    if (r2.tipo !== 'escolha-pendente') throw new Error('esperava escolha');
    y.estado.local = com('b', 'editado');
    await concluirEscolha(deps2, r2.candidatos.find((c) => c.origem === 'navegador')!, AGORA);
    expect((await lerConta(banco, uid, outro))!.aportes.map((a) => a.id)).toEqual(['b', 'editado']);
  });

  it('cofre antigo com erro passageiro: migra o navegador, avisa e não arquiva; 403 arquiva', async () => {
    const cred = credAleatoria();
    await noCofreAntigo(cred, com('x'));
    const syncV1 = JSON.stringify({ cred, versao: 1, impressao: '', ultimaSync: '' });
    const uid = novoUid();
    const s = storage({ [CHAVE_SYNC_V1]: syncV1 });
    const x = fontes({ local: com('a'), banco: new BancoFalso(), uid, chave: { id: uid, chave: credAleatoria().chave }, s });
    x.f.lerCofreAntigo = async () => {
      throw new TypeError('Failed to fetch');
    };
    const r = await migrarParaConta(criarDepsMigracao(x.f), AGORA);
    expect(r).toMatchObject({ tipo: 'concluida', plano: { acao: 'enviar', origem: 'navegador' } });
    if (r.tipo === 'concluida') expect(r.avisos).toEqual(['Não consegui ler o cofre antigo; ele continua ativo neste aparelho — tente de novo depois']);
    expect(s.getItem(CHAVE_SYNC_V1)).toBe(syncV1); // intacto para a próxima tentativa
    expect(s.getItem(CHAVE_SYNC_MIGRADO)).toBeNull();
    expect(x.estado.config?.migradoEm).toBeUndefined(); // a próxima tentativa roda de novo
    // com as duas configs, a conta sincroniza e o cofre antigo não
    expect(escolherConfig(lerConfigSalva(s.getItem(CHAVE_SYNC_V1)), x.estado.config)).toBe(x.estado.config);
    // erro 5xx do servidor antigo também é passageiro
    const s5 = storage({ [CHAVE_SYNC_V1]: syncV1 });
    const y = fontes({ local: com('a'), banco: new BancoFalso(), uid, chave: { id: uid, chave: credAleatoria().chave }, s: s5 });
    y.f.lerCofreAntigo = async () => {
      throw new Error('Servidor respondeu 503.');
    };
    await migrarParaConta(criarDepsMigracao(y.f), AGORA);
    expect(s5.getItem(CHAVE_SYNC_V1)).toBe(syncV1);
    // 403: cofre sem acesso, arquiva com aviso
    const s403 = storage({ [CHAVE_SYNC_V1]: JSON.stringify({ cred: { ...cred, token: credAleatoria().token }, versao: 1, impressao: '', ultimaSync: '' }) });
    const z = fontes({ local: com('a'), banco: new BancoFalso(), uid, chave: { id: uid, chave: credAleatoria().chave }, s: s403 });
    const r3 = await migrarParaConta(criarDepsMigracao(z.f), AGORA);
    if (r3.tipo === 'concluida') expect(r3.avisos.join(' ')).toMatch(/recusou o acesso/);
    expect(s403.getItem(CHAVE_SYNC_V1)).toBeNull();
    expect(s403.getItem(CHAVE_SYNC_MIGRADO)).not.toBeNull();
    expect(z.estado.config?.migradoEm).toBe(AGORA);
  });

  it('antes de sobrescrever a conta, guarda a cópia dela mesmo sem aportes (os parâmetros também são dados)', async () => {
    const banco = new BancoFalso();
    const uid = novoUid();
    const chave = { id: uid, chave: credAleatoria().chave };
    const outro = remotoDaConta(clienteFalso(banco, () => uid), chave);
    const semAportes = { ...com(), parametros: { ...parametrosPadrao(), cdiAutomatico: false, cdiAnual: 0.1234 } };
    await outro.gravar(0, await outro.cifrar(paraNuvem(semAportes)));
    const s = storage();
    const x = fontes({ local: com('a'), banco, uid, chave, s });
    expect(await migrarParaConta(criarDepsMigracao(x.f), AGORA)).toMatchObject({ tipo: 'concluida', plano: { acao: 'enviar' } });
    const copia = JSON.parse(s.getItem(CHAVE_COPIA_CONTA)!);
    const daConta = copia.versoes.find((v: { origem: string }) => v.origem === 'conta');
    expect(daConta.dados.parametros.cdiAnual).toBe(0.1234);
  });
});

describe('aparelho já migrado', () => {
  it('o cofre antigo recusa ser ativado de novo', () => {
    expect(recusaCofreAntigo(storage({ [CHAVE_SYNC_MIGRADO]: '{}' }))).toBe('Este aparelho já migrou para a conta');
    expect(recusaCofreAntigo(storage())).toBeNull();
  });

  it('aba antiga: com o cofre arquivado por outra aba, desliga o cofre antigo e nunca regrava sync:v1', () => {
    const antiga = lerConfigSalva(JSON.stringify({ cred: credAleatoria(), versao: 1, impressao: '', ultimaSync: '' }));
    const conta = { origem: 'conta', userId: 'u', email: 'a@b.c', chave: 'k', versao: 1, impressao: '', ultimaSync: '' };
    // outra aba migrou: sync:v1 sumiu e há :migrado
    const migrou = storage({ [CHAVE_SYNC_MIGRADO]: '{}' });
    expect(configDaAba(antiga, migrou)).toBeNull();
    expect(podeGravarCofreAntigo(migrou)).toBe(false);
    const comConta = storage({ [CHAVE_SYNC_MIGRADO]: '{}', 'rendller:conta:v1': JSON.stringify(conta) });
    expect(configDaAba(antiga, comConta)).toMatchObject({ origem: 'conta', userId: 'u' });
    // sem migração, nada muda
    const normal = storage({ [CHAVE_SYNC_V1]: '{}' });
    expect(configDaAba(antiga, normal)).toBe(antiga);
    expect(podeGravarCofreAntigo(normal)).toBe(true);
  });

  it('cópias: no máximo as 3 últimas e sem repetir a mesma versão', () => {
    const s = storage();
    const a = armazenamentoMigracao(s);
    a.guardarCopia(com('1'), 'navegador', AGORA);
    a.guardarCopia(com('1'), 'navegador', AGORA); // repetida
    a.guardarCopia(com('2'), 'conta', AGORA);
    a.guardarCopia(com('3'), 'navegador', AGORA);
    a.guardarCopia(com('4'), 'navegador', AGORA);
    const v = JSON.parse(s.getItem(CHAVE_COPIA_CONTA)!).versoes;
    expect(v.map((x: { dados: Dados }) => x.dados.aportes[0].id)).toEqual(['2', '3', '4']);
    // sem espaço: lança (a migração para com 'falhou')
    const cheio = {
      ...storage(),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => armazenamentoMigracao(cheio).guardarCopia(com('x'), 'navegador', AGORA)).toThrow();
  });
});

describe('sair, cancelar e outras abas', () => {
  const cfgAntiga = () => JSON.stringify({ cred: credAleatoria(), versao: 1, impressao: '', ultimaSync: '' });
  const conta = (extra: Record<string, unknown> = {}) =>
    ({ origem: 'conta', userId: 'u', email: 'a@b.c', chave: 'k', versao: 1, impressao: '', ultimaSync: '', ...extra }) as ConfigConta;

  it('sair da conta com a migração incompleta não reativa o cofre antigo', () => {
    const s = storage({ [CHAVE_SYNC_V1]: cfgAntiga() });
    const d = depoisDeDesativar(conta(), s);
    expect(d).toEqual({ proxima: null, pausarCofreAntigo: true, aviso: 'Migração para a conta incompleta; entre de novo para concluir' });
    // efeito: a config do cofre antigo fica guardada, mas não liga sozinha (nem ao recarregar)
    armazenamentoMigracao(s).pausarCofreAntigo();
    expect(s.getItem(CHAVE_SYNC_V1)).toBeNull();
    expect(s.getItem(CHAVE_SYNC_PENDENTE)).not.toBeNull();
    expect(configParaAba(null, s)).toBeNull();
    expect(recusaCofreAntigo(s)).toBe('Migração para a conta incompleta; entre de novo para concluir');
    // migração completa: só desliga
    expect(depoisDeDesativar(conta({ migradoEm: AGORA }), storage())).toEqual({ proxima: null, pausarCofreAntigo: false, aviso: null });
    // saindo do cofre antigo com a conta presente: a conta passa a valer
    const comConta = storage({ 'rendller:conta:v1': JSON.stringify(conta()) });
    expect(depoisDeDesativar(lerConfigSalva(cfgAntiga()), comConta).proxima).toMatchObject({ origem: 'conta' });
  });

  it('nova tentativa lê o cofre antigo pausado e o arquiva ao concluir', async () => {
    const cred = credAleatoria();
    await noCofreAntigo(cred, com('a'));
    const s = storage({ [CHAVE_SYNC_PENDENTE]: JSON.stringify({ cred, versao: 1, impressao: '', ultimaSync: '' }) });
    const ap = aparelho({ local: com('a'), banco: new BancoFalso(), uid: novoUid(), s });
    const r = await migrarParaConta(ap.deps, AGORA);
    expect(r).toMatchObject({ tipo: 'concluida', contagens: { 'cofre-antigo': 1 } });
    expect(s.getItem(CHAVE_SYNC_PENDENTE)).toBeNull();
    expect(s.getItem(CHAVE_SYNC_MIGRADO)).not.toBeNull();
  });

  it('a aba sem sincronização liga a conta quando ela aparece', () => {
    expect(configParaAba(null, storage())).toBeNull();
    expect(configParaAba(null, storage({ 'rendller:conta:v1': JSON.stringify(conta()) }))).toMatchObject({ origem: 'conta', userId: 'u' });
    expect(configParaAba(null, storage({ [CHAVE_SYNC_V1]: cfgAntiga() }))).toMatchObject({ origem: 'cofre-antigo' });
    const atual = lerConfigSalva(cfgAntiga());
    expect(configParaAba(atual, storage({ [CHAVE_SYNC_V1]: '{}' }))).toBe(atual);
  });

  it('outra aba concluiu a migração: esta aba adota a conta', () => {
    expect(outraAbaMigrou(storage({ 'rendller:conta:v1': JSON.stringify(conta({ migradoEm: AGORA })) }))).toMatchObject({ origem: 'conta', migradoEm: AGORA });
    expect(outraAbaMigrou(storage({ 'rendller:conta:v1': JSON.stringify(conta()) }))).toBeNull();
    expect(outraAbaMigrou(storage())).toBeNull();
  });
});

describe('várias abas', () => {
  const cfgAntiga = () => JSON.stringify({ cred: credAleatoria(), versao: 1, impressao: '', ultimaSync: '' });
  const contaCfg = (extra: Record<string, unknown> = {}) =>
    ({ origem: 'conta', userId: 'u', email: 'a@b.c', chave: 'k', versao: 3, impressao: '', ultimaSync: '', ...extra }) as ConfigConta;

  it('a aba B com o cofre antigo passa a usar a conta quando a aba A a ativa com erro passageiro', () => {
    const syncV1 = cfgAntiga();
    const antigaNaMemoria = lerConfigSalva(syncV1);
    // aba A: migração com erro passageiro, conta ativa e sync:v1 intacto
    const s = storage({ [CHAVE_SYNC_V1]: syncV1, 'rendller:conta:v1': JSON.stringify(contaCfg()) });
    expect(configDaAba(antigaNaMemoria, s)).toMatchObject({ origem: 'conta', userId: 'u' });
    expect(podeGravarCofreAntigo(s)).toBe(false);
    expect(s.getItem(CHAVE_SYNC_V1)).toBe(syncV1); // a aba só deixa de usar; nada é apagado
  });

  it('a aba B não regrava sync:v1 depois de a aba A pausá-lo', () => {
    const antigaNaMemoria = lerConfigSalva(cfgAntiga());
    const s = storage({ [CHAVE_SYNC_PENDENTE]: cfgAntiga() });
    expect(configDaAba(antigaNaMemoria, s)).toBeNull();
    expect(podeGravarCofreAntigo(s)).toBe(false);
  });

  it('a aba que adota a conta recarrega os dados salvos e não envia nada por cima', () => {
    // aba A escolheu "Cofre antigo": dados salvos e config da conta assinada com eles
    const escolhidos = com('a', 'b');
    const contaA = contaCfg({ migradoEm: AGORA, impressao: impressao(escolhidos) });
    // aba B: escolha pendente, cofre antigo na memória e dados antigos
    const antigosDeB = com('velho');
    const d = adocaoDeConfig(lerConfigSalva(cfgAntiga()), contaA, antigosDeB, escolhidos);
    expect(d).toEqual({ adotar: true, dados: escolhidos, guardarCopia: true });
    // depois de adotar, o ciclo não envia: os dados recarregados batem com a assinatura da config
    const plano = planejarCiclo({
      versaoLocal: contaA.versao,
      versaoRemota: contaA.versao,
      temEnvelope: true,
      impressaoConfig: contaA.impressao,
      impressaoLocal: impressao(d.dados),
      impressaoRemota: null,
      aguardandoCofre: false,
      podeGravar: true,
    });
    expect(plano.decisao).toBe('nada');
    // mesma config (mesma conta): não recarrega nada
    expect(adocaoDeConfig(contaA, { ...contaA, versao: 4 }, antigosDeB, escolhidos)).toEqual({ adotar: false, dados: antigosDeB, guardarCopia: false });
    // dados iguais: adota sem cópia
    expect(adocaoDeConfig(null, contaA, escolhidos, escolhidos)).toEqual({ adotar: true, dados: escolhidos, guardarCopia: false });
    // sem config nova: nada a recarregar
    expect(adocaoDeConfig(contaA, null, antigosDeB, escolhidos).adotar).toBe(false);
  });
});
