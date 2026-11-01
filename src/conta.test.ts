import { describe, expect, it, vi } from 'vitest';
import { derivarChaveDaConta, derivarCredenciais } from './cofre';
import {
  classificarErroRecuperacao,
  contaDisponivel,
  urlBaseSupabase,
  lerCofreDaConta,
  MENSAGEM_LINK_VENCIDO,
  MENSAGEM_RECUPERACAO_SEM_REDE,
  recuperacaoNaUrl,
  remotoDaConta,
  sessaoDeResposta,
  urlSemRecuperacao,
} from './conta';
import { BancoFalso, clienteFalso, novoUid } from './conta.falso';
import { novoAporte, parametrosPadrao } from './domain/padroes';
import { impressao, paraNuvem } from './domain/sincronia';
import type { Dados } from './domain/types';
import { NuvemIndisponivel, SessaoExpirada } from './remoto';
import { contratoRemoto } from './remoto.contrato';
import {
  abrirRemoto,
  contaConfere,
  cicloRemoto,
  classificarFalha,
  escolherConfig,
  lerConfigSalva,
  lerContaSalva,
  MENSAGEM_FRASE_DIFERENTE,
  prepararAtivacao,
  type ConfigSync,
} from './sincronizacaoNucleo';

const FRASE = 'cavalo bateria grampo correto';

function dados(n = 1): Dados {
  return {
    versao: 2,
    aportes: Array.from({ length: n }, (_, i) => novoAporte({ id: `a${i}`, emissor: 'PagBank', valor: 500, dataAporte: '2026-08-19', vencimento: '2028-08-10' })),
    parametros: parametrosPadrao(),
  };
}

/** Chave aleatória (sem PBKDF2, rápida) para o contrato. */
function chaveAleatoria(id: string) {
  return { id, chave: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))) };
}

describe('conta no Supabase (ClienteCofre falso)', () => {
  contratoRemoto(
    'conta',
    async () => {
      const uid = novoUid();
      return remotoDaConta(clienteFalso(new BancoFalso(), () => uid), chaveAleatoria(uid));
    },
    async () => {
      const banco = new BancoFalso();
      const uid = novoUid();
      const chave = chaveAleatoria(uid);
      return { certo: remotoDaConta(clienteFalso(banco, () => uid), chave), errado: remotoDaConta(clienteFalso(banco, () => null), chave) };
    },
  );

  it('RLS do falso: outra conta não lê nem apaga a linha', async () => {
    const banco = new BancoFalso();
    const [a, b] = [novoUid(), novoUid()];
    const ra = remotoDaConta(clienteFalso(banco, () => a), chaveAleatoria(a));
    await ra.gravar(0, await ra.cifrar({ n: 1 }));
    const rb = remotoDaConta(clienteFalso(banco, () => b), chaveAleatoria(b));
    expect(await rb.ler()).toEqual({ tipo: 'inexistente' });
    await rb.apagar();
    expect(await ra.ler()).toMatchObject({ tipo: 'ok', versao: 1 });
  });

  it('mesma frase em contas diferentes gera chaves diferentes e não decifra cruzado', async () => {
    const [a, b] = [novoUid(), novoUid()];
    const [ka, kb] = await Promise.all([derivarChaveDaConta(FRASE, a), derivarChaveDaConta(FRASE, b)]);
    expect(ka.id).toBe(a);
    expect(ka.chave).not.toBe(kb.chave);
    const banco = new BancoFalso();
    const ra = remotoDaConta(clienteFalso(banco, () => a), ka);
    const rb = remotoDaConta(clienteFalso(banco, () => b), kb);
    const e = await ra.cifrar(dados(2));
    expect(await ra.decifrar(e)).toEqual(JSON.parse(JSON.stringify(dados(2))));
    await expect(rb.decifrar(e)).rejects.toThrow();
    // mesma chave com outro id (dado autenticado) também não decifra
    await expect(remotoDaConta(clienteFalso(banco, () => b), { id: b, chave: ka.chave }).decifrar(e)).rejects.toThrow();
  });

  it('chave da conta difere da chave do cofre antigo para a mesma frase', async () => {
    const [antiga, conta] = await Promise.all([derivarCredenciais(FRASE), derivarChaveDaConta(FRASE, novoUid())]);
    expect(conta.chave).not.toBe(antiga.chave);
    await expect(derivarChaveDaConta('curta', novoUid())).rejects.toThrow(/12 caracteres/);
  });

  it('frase errada numa conta com dados: erro de decifração e nenhuma gravação', async () => {
    const banco = new BancoFalso();
    const uid = novoUid();
    const cliente = clienteFalso(banco, () => uid);
    const certa = remotoDaConta(cliente, chaveAleatoria(uid));
    await certa.gravar(0, await certa.cifrar(paraNuvem(dados(3))));
    banco.chamadas = [];
    const [r, errada] = await Promise.all([lerCofreDaConta(cliente), Promise.resolve(remotoDaConta(cliente, chaveAleatoria(uid)))]);
    await expect(prepararAtivacao(r, errada, dados(1), 'conta')).rejects.toThrow(MENSAGEM_FRASE_DIFERENTE);
    expect(MENSAGEM_FRASE_DIFERENTE).toBe('Frase-senha diferente da usada nesta conta');
    expect(banco.rpcs()).toBe(0);
    // a frase certa encontra os dados
    expect(await prepararAtivacao(r, certa, dados(1), 'conta')).toMatchObject({ tipo: 'existente', versao: 1 });
  });

  it("projeto pausado ou erro 5xx vira status 'offline' com a mensagem 'Nuvem indisponível'", async () => {
    const banco = new BancoFalso();
    const uid = novoUid();
    const r = remotoDaConta(clienteFalso(banco, () => uid, { status: 503, error: { message: 'Service Unavailable', code: 'PGRST' } }), chaveAleatoria(uid));
    await expect(r.ler()).rejects.toBeInstanceOf(NuvemIndisponivel);
    await expect(r.gravar(0, await r.cifrar({}))).rejects.toBeInstanceOf(NuvemIndisponivel);
    await expect(r.apagar()).rejects.toBeInstanceOf(NuvemIndisponivel);
    const falha = await cicloRemoto({ origem: 'conta', versao: 1, impressao: 'x' }, r, { local: () => dados(1), aguardandoCofre: () => false, podeGravar: () => true }).catch((e) => e);
    expect(classificarFalha(falha, true)).toEqual({ status: 'offline', erro: 'Nuvem indisponível (o projeto pode estar pausado).', precisaEntrar: false });
    // rede, CORS ou projeto pausado: fetch rejeitado vira status 0 e code '' no supabase-js
    const semRede = remotoDaConta(clienteFalso(banco, () => uid, { status: 0, error: { message: 'TypeError: Failed to fetch', code: '' } }), chaveAleatoria(uid));
    await expect(semRede.ler()).rejects.toBeInstanceOf(NuvemIndisponivel);
    await expect(semRede.gravar(1, await semRede.cifrar({}))).rejects.toBeInstanceOf(NuvemIndisponivel);
    await expect(semRede.apagar()).rejects.toBeInstanceOf(NuvemIndisponivel);
    const f0 = await cicloRemoto({ origem: 'conta', versao: 1, impressao: 'x' }, semRede, { local: () => dados(1), aguardandoCofre: () => false, podeGravar: () => true }).catch((e) => e);
    expect(classificarFalha(f0, true).erro).toBe('Nuvem indisponível (o projeto pode estar pausado).');
  });

  it("sessão expirada (401) com alteração pendente: status 'erro' com 'Entre na conta de novo' e os dados locais intactos", async () => {
    const banco = new BancoFalso();
    const uid = novoUid();
    const certo = remotoDaConta(clienteFalso(banco, () => uid), chaveAleatoria(uid));
    await certo.gravar(0, await certo.cifrar(paraNuvem(dados(1))));
    banco.chamadas = [];
    const local = dados(2); // editado aqui: pendente
    const copia = JSON.parse(JSON.stringify(local));
    const expirado = remotoDaConta(clienteFalso(banco, () => null), chaveAleatoria(uid));
    const falha = await cicloRemoto({ origem: 'conta', versao: 1, impressao: impressao(dados(1)) }, expirado, {
      local: () => local,
      aguardandoCofre: () => false,
      podeGravar: () => true,
    }).catch((e) => e);
    expect(falha).toBeInstanceOf(SessaoExpirada);
    const c = classificarFalha(falha, true);
    expect(c.status).toBe('erro');
    expect(c.erro).toContain('Entre na conta de novo');
    expect(c.precisaEntrar).toBe(true);
    expect(banco.rpcs()).toBe(0);
    expect(local).toEqual(copia);
    expect(await certo.ler()).toMatchObject({ tipo: 'ok', versao: 1 });
  });

  it('frase-senha e chave nunca aparecem nas chamadas ao ClienteCofre', async () => {
    const banco = new BancoFalso();
    const uid = novoUid();
    const cliente = clienteFalso(banco, () => uid);
    const chave = await derivarChaveDaConta(FRASE, uid);
    const r = remotoDaConta(cliente, chave);
    await r.gravar(0, await r.cifrar(paraNuvem(dados(2))));
    const lido = await lerCofreDaConta(cliente);
    await prepararAtivacao(lido, r, dados(0), 'conta');
    await cicloRemoto({ origem: 'conta', versao: 0, impressao: '' }, r, { local: () => dados(1), aguardandoCofre: () => false, podeGravar: () => true });
    await r.gravar(1, await r.cifrar(paraNuvem(dados(5))));
    await r.apagar();
    expect(banco.chamadas.length).toBeGreaterThan(4);
    const tudo = JSON.stringify(banco.chamadas);
    for (const segredo of [FRASE, chave.chave, FRASE.normalize('NFKC')]) expect(tudo).not.toContain(segredo);
    expect(tudo).not.toContain('PagBank'); // só conteúdo cifrado sai
  });

  it('ciclo relê podeGravar depois de decifrar (edição durante o download vira conflito)', async () => {
    const banco = new BancoFalso();
    const uid = novoUid();
    const r0 = remotoDaConta(clienteFalso(banco, () => uid), chaveAleatoria(uid));
    await r0.gravar(0, await r0.cifrar(paraNuvem(dados(3))));
    let editou = false;
    const r = { ...r0, decifrar: async (e: Parameters<typeof r0.decifrar>[0]) => ((editou = true), r0.decifrar(e)) };
    const passo = await cicloRemoto({ origem: 'conta', versao: 1, impressao: 'outra' }, r, {
      local: () => dados(editou ? 2 : 0),
      aguardandoCofre: () => true, // dados locais ilegíveis ao abrir
      podeGravar: () => editou,
    });
    expect(passo.acao).toBe('conflito');
  });
});

describe('conta ativa conferida contra a sessão', () => {
  const contaA = (uid: string) => ({ origem: 'conta' as const, userId: uid, email: 'a@exemplo.com', chave: chaveAleatoria(uid).chave, versao: 1, impressao: '', ultimaSync: '' });

  it('sessão de B com a config de A: zero rpc e zero delete', async () => {
    const banco = new BancoFalso();
    const [a, b] = [novoUid(), novoUid()];
    const certo = remotoDaConta(clienteFalso(banco, () => a), chaveAleatoria(a));
    await certo.gravar(0, await certo.cifrar({ n: 1 }));
    banco.chamadas = [];
    const r = await abrirRemoto(contaA(a), { sessao: async () => ({ userId: b, email: 'b@exemplo.com' }), cliente: async () => clienteFalso(banco, () => b) });
    const msg = 'Conta diferente da ativada neste aparelho; entre com a@exemplo.com';
    await expect(r.ler()).rejects.toThrow(msg);
    await expect(r.gravar(1, await r.cifrar({ n: 2 }))).rejects.toBeInstanceOf(SessaoExpirada);
    await expect(r.apagar()).rejects.toThrow(msg);
    const falha = await cicloRemoto(contaA(a), r, { local: () => dados(1), aguardandoCofre: () => false, podeGravar: () => true }).catch((e) => e);
    expect(classificarFalha(falha, true)).toMatchObject({ status: 'erro', precisaEntrar: true, erro: msg });
    expect(banco.chamadas.filter((c) => c.metodo === 'rpc' || c.metodo === 'delete')).toEqual([]);
    expect(banco.chamadas).toEqual([]); // nem leitura
    expect(await certo.ler()).toMatchObject({ tipo: 'ok', versao: 1 });
  });

  it('sem sessão: entre na conta de novo; com a mesma conta, segue normal', async () => {
    const banco = new BancoFalso();
    const a = novoUid();
    const sem = await abrirRemoto(contaA(a), { sessao: async () => null, cliente: async () => clienteFalso(banco, () => a) });
    await expect(sem.ler()).rejects.toBeInstanceOf(SessaoExpirada);
    const mesma = await abrirRemoto(contaA(a), { sessao: async () => ({ userId: a, email: 'a@exemplo.com' }), cliente: async () => clienteFalso(banco, () => a) });
    expect(await mesma.ler()).toEqual({ tipo: 'inexistente' });
  });

  it('"Entrar de novo" recusa outro e-mail ou outro usuário', () => {
    const c = contaA('uid-a');
    expect(contaConfere(c, { userId: 'uid-a', email: 'A@Exemplo.com ' })).toBeNull();
    expect(contaConfere(c, { userId: 'uid-b', email: 'a@exemplo.com' })).toBe('Conta diferente da ativada neste aparelho; entre com a@exemplo.com');
    expect(contaConfere(c, { email: 'b@exemplo.com' })).toBe('Conta diferente da ativada neste aparelho; entre com a@exemplo.com');
    expect(contaConfere(c, { email: 'a@exemplo.com' })).toBeNull(); // antes de entrar, só o e-mail
  });
});

describe('configs da conta e do cofre antigo', () => {
  const conta: ConfigSync = { origem: 'conta', userId: novoUid(), email: 'eu@exemplo.com', chave: 'Y2hhdmU=', versao: 2, impressao: 'i', ultimaSync: '' };
  const antiga = { cred: { id: 'a'.repeat(64), token: 'b'.repeat(64), chave: 'Y2hhdmU=' }, versao: 1, impressao: 'j', ultimaSync: '' };

  it('a config da conta é lida da própria chave, com origem conta', () => {
    const { origem: _, ...salva } = conta;
    expect(lerContaSalva(JSON.stringify(salva))).toEqual(conta);
    expect(lerContaSalva(null)).toBeNull();
    expect(lerContaSalva('{quebrado')).toBeNull();
    expect(lerContaSalva(JSON.stringify({ userId: 'x' }))).toBeNull();
  });

  it('com as duas presentes, a conta tem prioridade', () => {
    const a = lerConfigSalva(JSON.stringify(antiga));
    expect(escolherConfig(a, conta)).toBe(conta);
    expect(escolherConfig(a, null)).toBe(a);
    expect(escolherConfig(null, null)).toBeNull();
  });

});

describe('cliente da conta', () => {
  it('aceita a URL do projeto com ou sem o sufixo da API REST', () => {
    const base = 'https://abcdef.supabase.co';
    for (const u of [base, `${base}/`, `${base}/rest/v1`, `${base}/rest/v1/`, ` ${base}/REST/V1/ `]) expect(urlBaseSupabase(u)).toBe(base);
  });
  it('sem as variáveis do Supabase a conta não está disponível', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    try {
      expect(contaDisponivel()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('reconhece o link de recuperação (token_hash na query) e o link vencido', () => {
    expect(recuperacaoNaUrl('?token_hash=abc123&type=recovery', '')).toEqual({ tipo: 'token', tokenHash: 'abc123' });
    expect(recuperacaoNaUrl('?type=recovery&token_hash=abc123', '#Painel')).toEqual({ tipo: 'token', tokenHash: 'abc123' });
    expect(recuperacaoNaUrl('?token_hash=abc123&type=signup', '')).toBeNull(); // só recuperação
    expect(recuperacaoNaUrl('', '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid')).toEqual({ tipo: 'erro' });
    expect(recuperacaoNaUrl('?error=access_denied&error_code=otp_expired', '')).toEqual({ tipo: 'erro' });
    expect(recuperacaoNaUrl('', '#Painel')).toBeNull();
    expect(recuperacaoNaUrl('', '')).toBeNull();
    // tokens no fragmento (fluxo implícito antigo) não são mais aceitos
    expect(recuperacaoNaUrl('', '#access_token=x&refresh_token=y&type=recovery')).toEqual({ tipo: 'erro' });
    expect(MENSAGEM_LINK_VENCIDO).toBe('Link de recuperação vencido ou já usado; peça outro');
  });
  it('erro de rede na recuperação não é "link vencido"', () => {
    expect(classificarErroRecuperacao({ name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 })).toBe('rede');
    expect(classificarErroRecuperacao(new TypeError('Failed to fetch'))).toBe('rede');
    expect(classificarErroRecuperacao({ name: 'AuthApiError', message: 'x', status: 0 })).toBe('rede');
    expect(classificarErroRecuperacao({ name: 'AuthApiError', message: 'Token has expired or is invalid', status: 403, code: 'otp_expired' })).toBe('vencido');
    expect(classificarErroRecuperacao({ name: 'AuthApiError', message: 'x', status: 400 })).toBe('vencido');
    expect(MENSAGEM_RECUPERACAO_SEM_REDE).toBe('Sem conexão; abra o link de novo quando a internet voltar');
  });
  it('limpa da URL os parâmetros de recuperação e mantém o resto', () => {
    expect(urlSemRecuperacao('https://rendller.netlify.app/?token_hash=abc&type=recovery')).toBe('/');
    expect(urlSemRecuperacao('https://rendller.netlify.app/?token_hash=abc&type=recovery&x=1#Aportes')).toBe('/?x=1#Aportes');
    expect(urlSemRecuperacao('http://localhost:5173/app/?error=access_denied&error_code=otp_expired&error_description=x')).toBe('/app/');
    expect(urlSemRecuperacao('https://rendller.netlify.app/#error=access_denied&error_code=otp_expired')).toBe('/');
    expect(urlSemRecuperacao('https://rendller.netlify.app/#access_token=x&refresh_token=y&type=recovery')).toBe('/');
    expect(urlSemRecuperacao('https://rendller.netlify.app/#Simulador')).toBe('/#Simulador');
  });
  it('sessão sem rede é "sem conexão", não "entre de novo"', () => {
    const semRede = (() => {
      try {
        sessaoDeResposta({ data: { session: null }, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 } });
      } catch (e) {
        return e;
      }
    })();
    expect(classificarFalha(semRede, true)).toMatchObject({ status: 'offline', precisaEntrar: false });
    expect(classificarFalha(semRede, true).erro).toContain('Sem conexão');
    expect(sessaoDeResposta({ data: { session: null }, error: null })).toBeNull();
    expect(sessaoDeResposta({ data: { session: { user: { id: 'u1', email: 'a@b.c' } } }, error: null })).toEqual({ userId: 'u1', email: 'a@b.c' });
  });
});
