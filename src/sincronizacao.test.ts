import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tratarCofre, type Armazem, type Registro } from '../netlify/cofre';
import { cifrar, decifrar, derivarCredenciais, gravarCofre, lerCofre, apagarCofre } from './cofre';
import { aplicarConsultaCdi } from './domain/cdi';
import { novoAporte, parametrosPadrao } from './domain/padroes';
import { migrarDados } from './domain/migracao';
import { ajustarImpressaoAposNormalizacao, daNuvem, decidirCiclo, impressao, jsonEstavel, paraNuvem } from './domain/sincronia';
import type { Dados } from './domain/types';

const FRASE = 'cavalo bateria grampo correto';

function dados(n = 1): Dados {
  return {
    versao: 2,
    aportes: Array.from({ length: n }, (_, i) => novoAporte({ id: `a${i}`, emissor: 'PagBank', valor: 500, dataAporte: '2026-08-19', vencimento: '2028-08-10' })),
    parametros: parametrosPadrao(),
  };
}

/** Dados como o app anterior gravava (v1): aportes com `tipo`, parâmetros sem `regimes`. */
function brutoV1(n: number): Record<string, unknown> {
  const { regimes: _, regimesVersao: _v, ...parametros } = parametrosPadrao();
  const aportes = dados(n).aportes.map(({ classe: __, ...a }) => ({ ...a, tipo: 'CDB Pós-fixado' }));
  return JSON.parse(JSON.stringify({ versao: 1, aportes, parametros }));
}

/** Armazém em memória com ETag, como o Netlify Blobs. */
function memoria(): Armazem & { mapa: Map<string, { registro: Registro; etag: string }>; atrapalhar?: () => void } {
  const mapa = new Map<string, { registro: Registro; etag: string }>();
  let n = 0;
  const a = {
    mapa,
    atrapalhar: undefined as undefined | (() => void),
    async ler(id: string) {
      return mapa.get(id) ?? null;
    },
    async criar(id: string, registro: Registro) {
      if (mapa.has(id)) return false;
      mapa.set(id, { registro, etag: `e${++n}` });
      return true;
    },
    async atualizar(id: string, registro: Registro, etag: string | undefined) {
      a.atrapalhar?.();
      if (mapa.get(id)?.etag !== etag) return false;
      mapa.set(id, { registro, etag: `e${++n}` });
      return true;
    },
    async apagar(id: string) {
      mapa.delete(id);
    },
  };
  return a;
}

describe('criptografia do cofre', () => {
  it('deriva sempre as mesmas credenciais da mesma frase', async () => {
    const a = await derivarCredenciais(FRASE);
    const b = await derivarCredenciais(`  ${FRASE} `);
    const c = await derivarCredenciais(`${FRASE}!`);
    expect(a).toEqual(b);
    expect(a.id).toMatch(/^[0-9a-f]{64}$/);
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set([a.id, a.token, a.chave]).size).toBe(3);
    expect(c.id).not.toBe(a.id);
    await expect(derivarCredenciais('curta')).rejects.toThrow(/12 caracteres/);
  });
  it('cifra e decifra; outra frase ou outro cofre não decifram', async () => {
    const a = await derivarCredenciais(FRASE);
    const outra = await derivarCredenciais('outra frase bem diferente');
    const d = dados(2);
    const env = await cifrar(a, d);
    expect(env.cifrado).not.toContain('PagBank');
    expect(await decifrar(a, env)).toEqual(JSON.parse(JSON.stringify(d)));
    await expect(decifrar(outra, env)).rejects.toThrow(/decifrar/);
    await expect(decifrar({ ...a, id: outra.id }, env)).rejects.toThrow(/decifrar/); // id é dado autenticado
    expect((await cifrar(a, d)).iv).not.toBe(env.iv); // IV novo a cada gravação
  });
});

describe('o que sincroniza', () => {
  it('atualização automática do CDI não conta como alteração', () => {
    const d = dados();
    const comCdi = { ...d, parametros: aplicarConsultaCdi(d.parametros, [{ data: '2026-10-01', anual: 0.1365 }], '2026-10-04') };
    expect(paraNuvem(comCdi).parametros).not.toHaveProperty('cdiDiario');
    expect(impressao(comCdi)).toBe(impressao(d));
    expect(impressao({ ...d, aportes: [...d.aportes, novoAporte({ id: 'x' })] })).not.toBe(impressao(d));
    // CDI manual é dado do usuário: sincroniza
    const manual = { ...d, parametros: { ...d.parametros, cdiAutomatico: false, cdiAnual: 0.12 } };
    expect(impressao(manual)).not.toBe(impressao({ ...manual, parametros: { ...manual.parametros, cdiAnual: 0.13 } }));
  });
  it('dados da nuvem mantêm o CDI já baixado neste aparelho', () => {
    const local = { ...dados(), parametros: aplicarConsultaCdi(parametrosPadrao(), [{ data: '2026-10-01', anual: 0.1365 }], '2026-10-04') };
    const remoto = JSON.parse(JSON.stringify(paraNuvem(dados(3))));
    const r = daNuvem(remoto, local);
    expect(r.aportes.length).toBe(3);
    expect(r.parametros.cdiDiario).toEqual(local.parametros.cdiDiario);
    expect(r.parametros.cdiAnual).toBe(0.1365);
    expect(r.parametros.feriados.length).toBeGreaterThan(1000);
    expect(() => daNuvem({ lixo: true }, local)).toThrow();
  });
  it('daNuvem aceita conteúdo v1 do cofre antigo e devolve v2', () => {
    // Conteúdo como o app anterior gravava: versao 1, aportes com `tipo`, parâmetros sem `regimes`.
    const antigo = JSON.parse(JSON.stringify(paraNuvem(dados(2))));
    antigo.versao = 1;
    delete antigo.parametros.regimes;
    delete antigo.parametros.regimesVersao;
    for (const a of antigo.aportes) {
      delete a.classe;
      a.tipo = 'CDB Pós-fixado';
    }
    const r = daNuvem(antigo, dados(0));
    expect(r.versao).toBe(2);
    expect(r.aportes.map((a) => a.id)).toEqual(['a0', 'a1']);
    expect(r.aportes.every((a) => a.classe === 'CDB' && !('tipo' in a))).toBe(true);
    expect(r.parametros.regimes.CDB).toEqual(parametrosPadrao().regimes.CDB);
    expect(paraNuvem(r).versao).toBe(2);
    expect(() => daNuvem({ ...antigo, versao: 3 }, dados(0))).toThrow(/versão mais nova do app/);
  });
  it('JSON estável não depende da ordem das chaves', () => {
    expect(jsonEstavel({ b: 1, a: [{ d: 2, c: undefined, e: null }] })).toBe(jsonEstavel({ a: [{ e: null, d: 2 }], b: 1 }));
  });
});

describe('sincronização depois da migração para v2', () => {
  const pend = (d: Dados, c: { impressao: string }) => impressao(d) !== c.impressao;

  it('paraNuvem sobre o bruto v1 reproduz o texto que o app antigo assinava', () => {
    // O app antigo assinava { versao: 1, aportes, parametros sem o CDI público }, exatamente como gravado.
    const bruto = brutoV1(2);
    const { cdiDiario: _h, cdiAtualizadoEm: _a, cdiAnual: _c, cdiData: _d, cdiFonte: _f, ...parametros } = bruto.parametros as Record<string, unknown>;
    expect(jsonEstavel(paraNuvem(bruto as unknown as Dados))).toBe(jsonEstavel({ versao: 1, aportes: bruto.aportes, parametros }));
  });

  it('aparelho com config v1 sem edição não fica pendente depois da migração', () => {
    const bruto = brutoV1(2);
    const config = { versao: 5, impressao: impressao(bruto as unknown as Dados), outro: 'x' };
    const migrados = migrarDados(bruto);
    expect(pend(migrados, config)).toBe(true); // sem o ajuste, o formato novo pareceria uma edição
    const c = ajustarImpressaoAposNormalizacao(config, bruto, migrados);
    expect(c).toEqual({ ...config, impressao: impressao(migrados) });
    expect(decidirCiclo({ versaoLocal: 5, versaoRemota: 5, pendente: pend(migrados, c), ilegivel: false, editadoDesdeIlegivel: false })).toBe('nada');
  });

  it('aparelho atrasado sem edição baixa o remoto sem conflito', () => {
    const bruto = brutoV1(2);
    const migrados = migrarDados(bruto);
    const c = ajustarImpressaoAposNormalizacao({ versao: 5, impressao: impressao(bruto as unknown as Dados) }, bruto, migrados);
    expect(decidirCiclo({ versaoLocal: 5, versaoRemota: 7, pendente: pend(migrados, c), ilegivel: false, editadoDesdeIlegivel: false })).toBe('aplicar');
  });

  it('edição real continua pendente', () => {
    const bruto = brutoV1(2);
    const migrados = migrarDados(bruto);
    // edição feita no app antigo e ainda não enviada: a config assinou outro conteúdo
    const antiga = { versao: 5, impressao: impressao(brutoV1(1) as unknown as Dados) };
    const c = ajustarImpressaoAposNormalizacao(antiga, bruto, migrados);
    expect(c).toBe(antiga);
    expect(pend(migrados, c)).toBe(true);
    expect(decidirCiclo({ versaoLocal: 5, versaoRemota: 5, pendente: true, ilegivel: false, editadoDesdeIlegivel: false })).toBe('enviar');
    // edição depois da migração
    const c2 = ajustarImpressaoAposNormalizacao({ versao: 5, impressao: impressao(bruto as unknown as Dados) }, bruto, migrados);
    const editado = { ...migrados, aportes: [...migrados.aportes, novoAporte({ id: 'novo' })] };
    expect(pend(editado, c2)).toBe(true);
  });
});

describe('sincronização depois da normalização dos regimes', () => {
  const pend = (d: Dados, c: { impressao: string }) => impressao(d) !== c.impressao;
  // v2 como a Fase 1 gravava: regimes CDB/Outro com a carência em dias, sem `regimesVersao`.
  function brutoFase1(): Record<string, unknown> {
    const { regimes: _, regimesVersao: _v, ...parametros } = parametrosPadrao();
    const r = { ir: 'regressivo', iof: true, fgc: true, carenciaMinimaDias: 0 };
    const regimes = { CDB: { ...r, fonte: 'Receita Federal (IR renda fixa 2026), Portal do Investidor/CVM (IOF), FGC (garantia ordinária); revisado em outubro/2026' }, Outro: { ...r, fonte: 'Sem regra própria' } };
    return JSON.parse(JSON.stringify({ versao: 2, aportes: dados(2).aportes, parametros: { ...parametros, regimes } }));
  }

  it('dados da Fase 1 sem edição não ficam pendentes depois de normalizados', () => {
    const bruto = brutoFase1();
    const config = { versao: 4, impressao: impressao(bruto as unknown as Dados) };
    const normalizados = migrarDados(bruto);
    expect(pend(normalizados, config)).toBe(true); // só a normalização mudou
    const c = ajustarImpressaoAposNormalizacao(config, bruto, normalizados);
    expect(decidirCiclo({ versaoLocal: 4, versaoRemota: 4, pendente: pend(normalizados, c), ilegivel: false, editadoDesdeIlegivel: false })).toBe('nada');
  });

  it('aumento de REGIMES_VERSAO com regimes antigos sem edição: o aparelho atrasado aplica o remoto', () => {
    // regimes de uma versão anterior (outra fonte, outra versão), sem marcador de edição
    const atual = parametrosPadrao();
    const antigos = Object.fromEntries(Object.entries(atual.regimes).map(([c, r]) => [c, { ...r, fonte: 'padrão antigo' }]));
    const bruto = JSON.parse(JSON.stringify({ versao: 2, aportes: dados(1).aportes, parametros: { ...atual, regimes: antigos, regimesVersao: '2020-01-01' } }));
    const normalizados = migrarDados(bruto);
    expect(normalizados.parametros.regimes).toEqual(atual.regimes);
    const c = ajustarImpressaoAposNormalizacao({ versao: 4, impressao: impressao(bruto) }, bruto, normalizados);
    expect(decidirCiclo({ versaoLocal: 4, versaoRemota: 6, pendente: pend(normalizados, c), ilegivel: false, editadoDesdeIlegivel: false })).toBe('aplicar');
  });

  it('edição real continua pendente depois da normalização', () => {
    const bruto = brutoFase1();
    const normalizados = migrarDados(bruto);
    const outra = { versao: 4, impressao: impressao({ ...(bruto as unknown as Dados), aportes: [] }) }; // assinou outro conteúdo
    const c = ajustarImpressaoAposNormalizacao(outra, bruto, normalizados);
    expect(c).toBe(outra);
    expect(decidirCiclo({ versaoLocal: 4, versaoRemota: 6, pendente: pend(normalizados, c), ilegivel: false, editadoDesdeIlegivel: false })).toBe('conflito');
  });
});

describe('decisão do ciclo de sincronização', () => {
  const base = { versaoLocal: 3, versaoRemota: 3, pendente: false, ilegivel: false, editadoDesdeIlegivel: false };
  it('mesma versão: envia só se houver alteração', () => {
    expect(decidirCiclo(base)).toBe('nada');
    expect(decidirCiclo({ ...base, pendente: true })).toBe('enviar');
  });
  it('nuvem mais nova: aplica, ou conflito se os dois lados mudaram', () => {
    expect(decidirCiclo({ ...base, versaoRemota: 4 })).toBe('aplicar');
    expect(decidirCiclo({ ...base, versaoRemota: 4, pendente: true })).toBe('conflito');
    expect(decidirCiclo({ ...base, versaoRemota: 4, pendente: true, remotoIgualLocal: true })).toBe('aplicar');
  });
  it('dados locais ilegíveis: baixa o cofre mesmo na mesma versão e nunca envia', () => {
    expect(decidirCiclo({ ...base, ilegivel: true, pendente: true })).toBe('aplicar');
    expect(decidirCiclo({ ...base, ilegivel: true, versaoRemota: 4 })).toBe('aplicar');
    // editou antes do download (ex.: sem rede): o usuário escolhe
    expect(decidirCiclo({ ...base, ilegivel: true, pendente: true, editadoDesdeIlegivel: true })).toBe('conflito');
    expect(decidirCiclo({ ...base, ilegivel: true, pendente: true, editadoDesdeIlegivel: true, remotoIgualLocal: true })).toBe('aplicar');
  });
});

describe('servidor do cofre', () => {
  const pedir = (arm: Armazem, metodo: string, id: string, token: string, corpo?: unknown) =>
    tratarCofre(
      new Request(`https://x/api/cofre?id=${id}`, {
        method: metodo,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: corpo ? JSON.stringify(corpo) : undefined,
      }),
      arm,
    );
  const ID = 'a'.repeat(64);
  const TOKEN = 'b'.repeat(64);
  const ENV = { iv: 'AAAAAAAAAAAAAAAA', cifrado: 'Y2lmcmFkbw==' };

  it('cria, lê, controla versão e apaga', async () => {
    const arm = memoria();
    expect((await pedir(arm, 'GET', ID, TOKEN)).status).toBe(404);
    expect((await pedir(arm, 'PUT', ID, TOKEN, { base: 1, ...ENV })).status).toBe(409); // não existe versão 1
    const r1 = await pedir(arm, 'PUT', ID, TOKEN, { base: 0, ...ENV });
    expect(await r1.json()).toMatchObject({ versao: 1 });
    expect(arm.mapa.get(ID)!.registro.authHash).not.toContain(TOKEN); // guarda só o hash
    expect(await (await pedir(arm, 'GET', ID, TOKEN)).json()).toMatchObject({ versao: 1, ...ENV });
    expect((await pedir(arm, 'PUT', ID, TOKEN, { base: 0, ...ENV })).status).toBe(409);
    expect((await pedir(arm, 'PUT', ID, TOKEN, { base: 1, ...ENV })).status).toBe(200);
    expect((await pedir(arm, 'DELETE', ID, TOKEN)).status).toBe(200);
    expect((await pedir(arm, 'GET', ID, TOKEN)).status).toBe(404);
  });
  it('recusa token errado e entradas inválidas', async () => {
    const arm = memoria();
    await pedir(arm, 'PUT', ID, TOKEN, { base: 0, ...ENV });
    expect((await pedir(arm, 'GET', ID, 'c'.repeat(64))).status).toBe(403);
    expect((await pedir(arm, 'PUT', ID, 'c'.repeat(64), { base: 1, ...ENV })).status).toBe(403);
    expect((await pedir(arm, 'DELETE', ID, 'c'.repeat(64))).status).toBe(403);
    expect((await pedir(arm, 'GET', 'xyz', TOKEN)).status).toBe(400);
    expect((await pedir(arm, 'PUT', ID, TOKEN, { base: 1, iv: ENV.iv, cifrado: '<script>' })).status).toBe(400);
    expect((await pedir(arm, 'PUT', ID, TOKEN, { base: 1, iv: ENV.iv, cifrado: 'A'.repeat(4_000_004) })).status).toBe(413);
    expect((await pedir(arm, 'POST', ID, TOKEN)).status).toBe(405);
  });
  it('gravação simultânea: a segunda recebe 409 em vez de sobrescrever', async () => {
    const arm = memoria();
    await pedir(arm, 'PUT', ID, TOKEN, { base: 0, ...ENV });
    // outro aparelho grava entre a leitura e a escrita condicional
    arm.atrapalhar = () => {
      arm.atrapalhar = undefined;
      const atual = arm.mapa.get(ID)!;
      arm.mapa.set(ID, { registro: { ...atual.registro, versao: 2 }, etag: 'outro' });
    };
    const r = await pedir(arm, 'PUT', ID, TOKEN, { base: 1, ...ENV });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ versao: 2 });
  });
});

describe('dois aparelhos (cliente + servidor)', () => {
  let arm: ReturnType<typeof memoria>;
  beforeEach(() => {
    arm = memoria();
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => tratarCofre(new Request(`https://rendller.test${url}`, init), arm));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('o que um grava o outro lê com a mesma frase; o servidor só vê conteúdo cifrado', async () => {
    const celular = await derivarCredenciais(FRASE);
    const notebook = await derivarCredenciais(FRASE);
    const d = dados(3);
    expect(await gravarCofre(celular, 0, await cifrar(celular, paraNuvem(d)))).toMatchObject({ tipo: 'ok', versao: 1 });
    expect(JSON.stringify([...arm.mapa.values()])).not.toContain('PagBank');
    const r = await lerCofre(notebook);
    if (r.tipo !== 'ok' || !r.envelope) throw new Error('esperava ok');
    expect(daNuvem(await decifrar(notebook, r.envelope), dados(0)).aportes.length).toBe(3);
    // notebook ainda na versão 1, celular grava a 2: a gravação atrasada do notebook vira conflito
    expect(await gravarCofre(celular, 1, await cifrar(celular, paraNuvem(dados(4))))).toMatchObject({ versao: 2 });
    expect(await gravarCofre(notebook, 1, await cifrar(notebook, paraNuvem(dados(1))))).toEqual({ tipo: 'conflito', versao: 2 });
    expect(await lerCofre(await derivarCredenciais('frase errada qualquer'))).toEqual({ tipo: 'inexistente' });
    expect(await apagarCofre(celular)).toMatchObject({ tipo: 'ok' });
    expect(await lerCofre(notebook)).toEqual({ tipo: 'inexistente' });
  });
});
