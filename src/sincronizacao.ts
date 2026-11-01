import { useCallback, useEffect, useRef, useState } from 'react';
import type { Carga } from './armazenamento';
import { baixarArquivo } from './armazenamento';
import { derivarChaveDaConta, derivarCredenciais, lerCofre, remotoCofreAntigo, type Credenciais } from './cofre';
import { clienteSupabase, lerCofreDaConta, remotoDaConta, sair, sessaoAtual, type ClienteCofre } from './conta';
import type { Candidato } from './domain/migracao';
import {
  armazenamentoMigracao,
  concluirEscolha,
  configDaAba,
  configParaAba,
  criarDepsMigracao,
  depoisDeDesativar,
  outraAbaMigrou,
  migrarParaConta,
  podeGravarCofreAntigo,
  recusaCofreAntigo,
  type ConfigConta,
  type DepsMigracao,
  type ResultadoMigracao,
} from './migracaoConta';
import { aguardandoDepois, ajustarImpressaoAposNormalizacao, impressao, paraNuvem } from './domain/sincronia';
import type { Dados } from './domain/types';
import { SessaoExpirada } from './remoto';
import {
  abrirRemoto,
  CHAVE_CONFIG_ANTIGA,
  CHAVE_CONTA,
  cicloRemoto,
  classificarFalha,
  escolherConfig,
  lerConfigSalva,
  lerContaSalva,
  prepararAtivacao,
  type ConfigSync,
  type Preparacao as PreparacaoNucleo,
} from './sincronizacaoNucleo';

export type { ConfigSync } from './sincronizacaoNucleo';

const CHAVE_CONFIG = CHAVE_CONFIG_ANTIGA; // cofre antigo
/** Cópia dos dados locais antes de serem trocados pelos da nuvem (para não perder nada num engano). */
export const CHAVE_COPIA = 'rendller:copia-antes-da-nuvem';
const ESPERA_ENVIO_MS = 1500;
const INTERVALO_MS = 120_000;

export type StatusSync = 'desligado' | 'sincronizando' | 'sincronizado' | 'pendente' | 'offline' | 'conflito' | 'erro';

export interface Conflito {
  remoto: Dados;
  versao: number;
  atualizadoEm?: string;
}

/** Destino escolhido na ativação, com o que for preciso para gravar a config depois. */
type Destino = { origem: 'cofre-antigo'; cred: Credenciais } | { origem: 'conta'; userId: string; email: string; chave: string };
export type Preparacao = PreparacaoNucleo & { destino: Destino };

function ler(chave: string): string | null {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}

const configAntiga = () => lerConfigSalva(ler(CHAVE_CONFIG));
const configDaConta = () => lerContaSalva(ler(CHAVE_CONTA));
const lerConfig = () => escolherConfig(configAntiga(), configDaConta());

/** Config salva; depois da migração e da normalização a impressão passa a assinar os dados normalizados (sem falso "pendente"). */
function configInicial(dados: Dados, carga: Pick<Carga, 'origem' | 'bruto'>): ConfigSync | null {
  const c = lerConfig();
  if (!c || (carga.origem !== 'v1' && carga.origem !== 'v2')) return c;
  const ajustada = ajustarImpressaoAposNormalizacao(c, carga.bruto, dados);
  if (ajustada !== c) gravarConfig(ajustada);
  return ajustada;
}

/** Grava (ou apaga) só a chave da origem desta config: ativar uma nunca regrava a outra. */
function gravarConfig(c: ConfigSync | null, origem: ConfigSync['origem'] = c?.origem ?? 'cofre-antigo') {
  const chave = origem === 'conta' ? CHAVE_CONTA : CHAVE_CONFIG;
  try {
    // aparelho que migrou: nenhuma aba regrava a config do cofre antigo
    if (c && origem === 'cofre-antigo' && !podeGravarCofreAntigo(localStorage)) return;
    if (c) localStorage.setItem(chave, JSON.stringify(c));
    else localStorage.removeItem(chave);
  } catch {
    /* sem armazenamento: a sincronização vale só nesta aba */
  }
}

function guardarCopia(d: Dados) {
  try {
    localStorage.setItem(CHAVE_COPIA, JSON.stringify({ em: new Date().toISOString(), dados: d }));
  } catch {
    /* sem espaço: segue sem cópia */
  }
}

function configDe(destino: Destino, versao: number): ConfigSync {
  return { ...destino, versao, impressao: '', ultimaSync: '' };
}

/**
 * Sincroniza os dados entre aparelhos por um cofre cifrado: o cofre antigo (frase-senha) ou o cofre da conta.
 * Busca a versão da nuvem ao abrir, ao voltar para a aba, ao reconectar e a cada 2 minutos; envia as alterações
 * locais 1,5 s depois da última edição. Se os dois lados mudaram, nada é sobrescrito: o usuário escolhe.
 * Se os dados locais estavam ilegíveis ao abrir, o cofre é baixado e aplicado mesmo na mesma versão; nada local
 * vai por cima dele (uma edição feita antes do download vira conflito). `podeGravar` vem de `useDados`.
 * As decisões ficam em `sincronizacaoNucleo.ts`; aqui só a fila, o estado e os timers.
 */
export function useSincronizacao(dados: Dados, substituir: (d: Dados) => void, carga: Pick<Carga, 'origem' | 'bruto'>, podeGravar: boolean) {
  const [config, setConfigEstado] = useState<ConfigSync | null>(() => configInicial(dados, carga));
  const [status, setStatus] = useState<StatusSync>(() => (lerConfig() ? 'sincronizando' : 'desligado'));
  const [erro, setErro] = useState<string | null>(null);
  const [precisaEntrar, setPrecisaEntrar] = useState(false);
  const [conflito, setConflito] = useState<Conflito | null>(null);
  /** Escolha de versão da migração; enquanto existir, a sincronização fica pausada (e o cartão mostra isso). */
  const [escolha, setEscolha] = useState<Extract<ResultadoMigracao, { tipo: 'escolha-pendente' }> | null>(null);

  const configRef = useRef(config);
  const dadosRef = useRef(dados);
  dadosRef.current = dados;
  const podeGravarRef = useRef(podeGravar);
  podeGravarRef.current = podeGravar;
  /** Dados locais ilegíveis ao abrir e cofre ainda não baixado. */
  const aguardandoCofre = useRef(carga.origem === 'ilegivel');
  const fila = useRef<Promise<void>>(Promise.resolve());
  const conflitoRef = useRef(conflito);
  conflitoRef.current = conflito;

  const salvarConfig = useCallback((c: ConfigSync | null, origem?: ConfigSync['origem']) => {
    // uma aba antiga não desarquiva o cofre antigo: relê o localStorage antes de gravar
    const valida = c ? configDaAba(c, localStorage) : c;
    configRef.current = valida;
    gravarConfig(valida, origem ?? c?.origem);
    setConfigEstado(valida);
  }, []);

  /** Relê a config do `localStorage` (outra aba pode ter migrado). Devolve false se não há o que sincronizar. */
  const revalidar = useCallback((): boolean => {
    // sem config, adota a que estiver salva agora (ex.: outra aba ativou a conta)
    const atual = configParaAba(configRef.current, localStorage);
    if (atual !== configRef.current) {
      configRef.current = atual;
      setConfigEstado(atual);
      setStatus(atual ? 'sincronizando' : 'desligado');
    }
    return !!atual;
  }, []);

  useEffect(() => {
    const aoMudar = (e: StorageEvent) => {
      if (!(e.key === null || e.key === CHAVE_CONFIG || e.key === CHAVE_CONTA || e.key?.startsWith(CHAVE_CONFIG))) return;
      // outra aba concluiu a migração: a escolha pendente aqui perde o sentido; adota a conta
      const migrada = migracao.current ? outraAbaMigrou(localStorage) : null;
      if (migrada) {
        migracao.current = null;
        setEscolha(null);
        configRef.current = migrada;
        setConfigEstado(migrada);
        setStatus('sincronizando');
        return;
      }
      revalidar();
    };
    window.addEventListener('storage', aoMudar);
    return () => window.removeEventListener('storage', aoMudar);
  }, [revalidar]);

  /** Operações em fila: nunca duas conversas com o servidor ao mesmo tempo. */
  const enfileirar = useCallback(<T,>(f: () => Promise<T>): Promise<T> => {
    const p = fila.current.then(f);
    fila.current = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }, []);

  const falhou = useCallback((e: unknown) => {
    const f = classificarFalha(e, navigator.onLine);
    setStatus(f.status);
    setErro(f.erro);
    setPrecisaEntrar(f.precisaEntrar);
  }, []);

  const aplicarRemoto = useCallback(
    (c: ConfigSync, remoto: Dados, versao: number) => {
      aguardandoCofre.current = aguardandoDepois(aguardandoCofre.current, 'aplicou');
      if (impressao(remoto) !== impressao(dadosRef.current)) {
        guardarCopia(dadosRef.current);
        substituir(remoto);
        dadosRef.current = remoto;
      }
      salvarConfig({ ...c, versao, impressao: impressao(remoto), ultimaSync: new Date().toISOString() });
    },
    [salvarConfig, substituir],
  );

  /** Envia os dados locais sobre a versão `base`. Devolve false se outro aparelho gravou antes. */
  const enviar = useCallback(
    async (c: ConfigSync, base: number): Promise<boolean> => {
      const d = dadosRef.current;
      if (d.versao !== 2) throw new Error('Dados locais num formato inesperado; nada foi enviado.');
      const remoto = await abrirRemoto(c);
      // a nuvem sempre recebe versao 2 (a impressão de dados legados continua usando a versão do objeto)
      const r = await remoto.gravar(base, await remoto.cifrar({ ...paraNuvem(d), versao: 2 }));
      if (r.tipo === 'conflito') return false;
      if (r.tipo === 'negado' && c.origem === 'conta') throw new SessaoExpirada();
      if (r.tipo !== 'ok') throw new Error('O servidor recusou a gravação.');
      // envio só acontece por decisão do usuário quando os dados eram ilegíveis
      aguardandoCofre.current = aguardandoDepois(aguardandoCofre.current, 'enviou');
      salvarConfig({ ...c, versao: r.versao, impressao: impressao(d), ultimaSync: new Date().toISOString() });
      return true;
    },
    [salvarConfig],
  );

  const ciclo = useCallback(
    async (tentativa = 0): Promise<void> => {
      if (!revalidar()) return;
      const c = configRef.current;
      if (!c) return;
      setStatus('sincronizando');
      const passo = await cicloRemoto(c, await abrirRemoto(c), {
        local: () => dadosRef.current,
        aguardandoCofre: () => aguardandoCofre.current,
        podeGravar: () => podeGravarRef.current,
      });
      if (passo.acao === 'aplicar') aplicarRemoto(c, passo.remoto, passo.versao);
      else if (passo.acao === 'conflito') {
        setConflito({ remoto: passo.remoto, versao: passo.versao, atualizadoEm: passo.atualizadoEm });
        setStatus('conflito');
        return;
      } else if (passo.acao === 'enviar' && !(await enviar(c, c.versao))) {
        if (tentativa < 1) return ciclo(tentativa + 1); // alguém gravou entre a leitura e a escrita
        throw new Error('Outro aparelho está gravando ao mesmo tempo. Tente de novo.');
      }
      setErro(null);
      setPrecisaEntrar(false);
      setStatus(impressao(dadosRef.current) !== configRef.current?.impressao ? 'pendente' : 'sincronizado');
    },
    [aplicarRemoto, enviar, revalidar],
  );

  /** Dependências da migração em andamento; com escolha pendente, o ciclo fica pausado. */
  const migracao = useRef<{ deps: DepsMigracao; manterCofreAntigo: boolean } | null>(null);

  const sincronizar = useCallback(() => {
    if (!configRef.current || conflitoRef.current || migracao.current) return Promise.resolve();
    return enfileirar(() => ciclo().catch(falhou));
  }, [ciclo, enfileirar, falhou]);
  const sincronizarRef = useRef(sincronizar);
  sincronizarRef.current = sincronizar;

  // Alteração local → envia depois de uma pausa nas edições.
  useEffect(() => {
    const c = configRef.current;
    if (!c || conflitoRef.current || impressao(dados) === c.impressao) return;
    setStatus((s) => (s === 'offline' || s === 'erro' ? s : 'pendente'));
    const t = setTimeout(() => void sincronizar(), ESPERA_ENVIO_MS);
    return () => clearTimeout(t);
  }, [dados, sincronizar]);

  // Ao abrir, ao voltar para a aba, ao reconectar e periodicamente.
  const idConfig = config ? (config.origem === 'conta' ? config.userId : config.cred.id) : null;
  useEffect(() => {
    if (!idConfig) return;
    void sincronizar();
    const visivel = () => document.visibilityState === 'visible' && void sincronizar();
    const t = setInterval(visivel, INTERVALO_MS);
    document.addEventListener('visibilitychange', visivel);
    window.addEventListener('online', visivel);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', visivel);
      window.removeEventListener('online', visivel);
    };
  }, [idConfig, sincronizar]);

  /** Primeiro passo da ativação pelo cofre antigo: deriva as credenciais e vê se já existe cofre para esta frase. */
  const preparar = useCallback(async (frase: string): Promise<Preparacao> => {
    const recusa = recusaCofreAntigo(localStorage);
    if (recusa) throw new Error(recusa);
    const cred = await derivarCredenciais(frase);
    const p = await prepararAtivacao(await lerCofre(cred), remotoCofreAntigo(cred), dadosRef.current, 'cofre-antigo');
    return { ...p, destino: { origem: 'cofre-antigo', cred } };
  }, []);

  /** Fontes comuns da migração (a conta é aberta pela frase ou pela config já ativa). */
  const fontes = useCallback(
    (abrirConta: Parameters<typeof criarDepsMigracao>[0]['abrirConta']) => ({
      agora: new Date().toISOString(),
      armazenamento: localStorage,
      lerDados: () => dadosRef.current, // sempre os dados de agora
      baixarArquivo: (nome: string, conteudo: string) => baixarArquivo(nome, conteudo),
      abrirConta,
      aplicarLocal: (d: Dados) => {
        substituir(d);
        dadosRef.current = d;
      },
      aoMigrar: (c: ConfigConta) => {
        migracao.current = null;
        aguardandoCofre.current = false;
        salvarConfig(c);
        setConflito(null);
        setErro(null);
        setPrecisaEntrar(false);
        setStatus('sincronizado');
      },
    }),
    [salvarConfig, substituir],
  );

  const rodarMigracao = useCallback(
    (deps: DepsMigracao, agora: string): Promise<ResultadoMigracao> =>
      enfileirar(async () => {
        const r = await migrarParaConta(deps, agora);
        migracao.current = r.tipo === 'escolha-pendente' ? { deps, manterCofreAntigo: r.manterCofreAntigo } : null;
        setEscolha(r.tipo === 'escolha-pendente' ? r : null);
        return r;
      }),
    [enfileirar],
  );

  /**
   * Ativação pela conta = migração (Fase 5): junta navegador, cofre antigo (com as credenciais salvas aqui) e conta.
   * Chamar direto do clique: `criarDepsMigracao` baixa o backup de forma síncrona, antes de qualquer await de rede.
   */
  const migrarConta = useCallback(
    (frase: string): Promise<ResultadoMigracao> => {
      const f = fontes(() => {
        const sessao = sessaoAtual().then((x) => {
          if (!x) throw new SessaoExpirada();
          return x;
        });
        const cliente = clienteSupabase().then((c) => c as unknown as ClienteCofre);
        const chave = sessao.then((x) => derivarChaveDaConta(frase, x.userId));
        const remoto = Promise.all([cliente, chave]).then(([c, k]) => remotoDaConta(c, k));
        return {
          remoto: {
            // a leitura não depende da chave: roda em paralelo com a derivação
            ler: async () => (await sessao, lerCofreDaConta(await cliente)),
            gravar: async (b, e) => (await remoto).gravar(b, e),
            apagar: async () => (await remoto).apagar(),
          },
          cifra: remoto,
          identidade: Promise.all([sessao, chave]).then(([x, k]) => ({ userId: x.userId, email: x.email, chave: k.chave })),
        };
      });
      return rodarMigracao(criarDepsMigracao(f), f.agora);
    },
    [fontes, rodarMigracao],
  );

  /** Nova tentativa de ler o cofre antigo (quando falhou por erro passageiro), com a conta já ativa. */
  const repetirMigracao = useCallback((): Promise<ResultadoMigracao> => {
    const c = configRef.current;
    if (!c || c.origem !== 'conta') return Promise.resolve({ tipo: 'falhou', erro: 'Entre na conta antes.' });
    const f = fontes(() => {
      const remoto = abrirRemoto(c);
      return {
        remoto: { ler: async () => (await remoto).ler(), gravar: async (b, e) => (await remoto).gravar(b, e), apagar: async () => (await remoto).apagar() },
        cifra: remoto,
        identidade: Promise.resolve({ userId: c.userId, email: c.email, chave: c.chave }),
      };
    });
    return rodarMigracao(criarDepsMigracao(f), f.agora);
  }, [fontes, rodarMigracao]);

  /** Conclui a migração com a versão escolhida (navegador, cofre antigo ou conta). */
  const concluirEscolhaConta = useCallback(
    (escolhido: Candidato): Promise<ResultadoMigracao> => {
      const m = migracao.current;
      if (!m) return Promise.resolve({ tipo: 'falhou', erro: 'A migração não está mais em andamento; entre na conta de novo.' });
      return enfileirar(async () => {
        const r = await concluirEscolha(m.deps, escolhido, new Date().toISOString(), m.manterCofreAntigo);
        if (r.tipo !== 'falhou') {
          migracao.current = null;
          setEscolha(null);
        }
        return r;
      });
    },
    [enfileirar],
  );

  /** Cancela a escolha pendente: nada é gravado e a sincronização volta. */
  const cancelarEscolha = useCallback(() => {
    migracao.current = null;
    setEscolha(null);
    void sincronizarRef.current?.();
  }, []);

  /** Segundo passo: `nuvem` traz os dados da nuvem para cá; `local` envia os daqui para a nuvem. */
  const concluir = useCallback(
    (prep: Preparacao, escolha: 'nuvem' | 'local'): Promise<boolean> =>
      enfileirar(async () => {
        setConflito(null);
        setStatus('sincronizando');
        try {
          const recusa = prep.destino.origem === 'cofre-antigo' ? recusaCofreAntigo(localStorage) : null;
          if (recusa) throw new Error(recusa);
          const c = configDe(prep.destino, prep.tipo === 'existente' ? prep.versao : 0);
          if (prep.tipo === 'existente' && escolha === 'nuvem') aplicarRemoto(c, prep.remoto, prep.versao);
          else if (!(await enviar(c, c.versao))) throw new Error('Outro aparelho gravou neste instante. Tente ativar de novo.');
          setErro(null);
          setPrecisaEntrar(false);
          setStatus('sincronizado');
          return true;
        } catch (e) {
          falhou(e);
          if (!configRef.current) setStatus('desligado');
          return false;
        }
      }),
    [aplicarRemoto, enfileirar, enviar, falhou],
  );

  const resolverConflito = useCallback(
    (escolha: 'nuvem' | 'local') =>
      enfileirar(async () => {
        const c = configRef.current;
        const k = conflitoRef.current;
        if (!c || !k) return;
        try {
          if (escolha === 'nuvem') aplicarRemoto(c, k.remoto, k.versao);
          else if (!(await enviar(c, k.versao))) {
            setConflito(null);
            conflitoRef.current = null;
            await ciclo();
            return;
          }
          setConflito(null);
          conflitoRef.current = null;
          setErro(null);
          setStatus('sincronizado');
        } catch (e) {
          falhou(e);
        }
      }),
    [aplicarRemoto, ciclo, enfileirar, enviar, falhou],
  );

  /** Para de sincronizar neste aparelho; apaga só a config ativa (a outra, se existir, fica intacta). */
  const desativar = useCallback(() => {
    const ativa = configRef.current;
    const d = depoisDeDesativar(ativa, localStorage);
    salvarConfig(null, ativa?.origem);
    // migração incompleta: o cofre antigo fica guardado, mas não volta a sincronizar sozinho
    if (d.pausarCofreAntigo) armazenamentoMigracao(localStorage).pausarCofreAntigo();
    if (d.proxima) salvarConfig(d.proxima);
    setConflito(null);
    setErro(d.aviso);
    setPrecisaEntrar(false);
    setStatus(d.proxima ? 'sincronizando' : 'desligado');
  }, [salvarConfig]);

  /** Sai da conta neste aparelho: encerra a sessão e para de sincronizar pela conta. Os dados locais ficam. */
  const sairDaConta = useCallback(async () => {
    try {
      await sair();
    } finally {
      if (configRef.current?.origem === 'conta') desativar();
    }
  }, [desativar]);

  const apagarDaNuvem = useCallback(
    () =>
      enfileirar(async () => {
        const c = configRef.current;
        if (!c) return;
        try {
          await (await abrirRemoto(c)).apagar();
          desativar();
        } catch (e) {
          falhou(e);
        }
      }),
    [desativar, enfileirar, falhou],
  );

  return {
    sync: {
      ativo: !!config,
      origem: config?.origem ?? null,
      email: config?.origem === 'conta' ? config.email : '',
      userId: config?.origem === 'conta' ? config.userId : '',
      cofreAntigoAtivo: !!configAntiga(),
      cofreAntigoArquivado: armazenamentoMigracao(localStorage).cofreAntigoArquivado(),
      migracaoPendente: armazenamentoMigracao(localStorage).migracaoPendente(),
      escolha,
      status,
      erro,
      precisaEntrar,
      conflito,
      ultimaSync: config?.ultimaSync ?? '',
    },
    preparar,
    migrarConta,
    repetirMigracao,
    cancelarEscolha,
    concluirEscolhaConta,
    concluir,
    resolverConflito,
    sincronizar,
    desativar,
    sairDaConta,
    apagarDaNuvem,
  };
}

export type Sincronizacao = ReturnType<typeof useSincronizacao>;
