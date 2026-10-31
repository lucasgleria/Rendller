import { useCallback, useEffect, useRef, useState } from 'react';
import type { Carga } from './armazenamento';
import { derivarChaveDaConta, derivarCredenciais, lerCofre, remotoCofreAntigo, type Credenciais } from './cofre';
import { clienteSupabase, lerCofreDaConta, remotoDaConta, sair, sessaoAtual, type ClienteCofre } from './conta';
import { aguardandoDepois, ajustarImpressaoAposNormalizacao, impressao, paraNuvem } from './domain/sincronia';
import type { Dados } from './domain/types';
import { SessaoExpirada } from './remoto';
import {
  abrirRemoto,
  bloqueioDaConta,
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

const CHAVE_CONFIG = 'rendller:sync:v1'; // cofre antigo
const CHAVE_CONTA = 'rendller:conta:v1'; // cofre da conta
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
    configRef.current = c;
    gravarConfig(c, origem);
    setConfigEstado(c);
  }, []);

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
    [aplicarRemoto, enviar],
  );

  const sincronizar = useCallback(() => {
    if (!configRef.current || conflitoRef.current) return Promise.resolve();
    return enfileirar(() => ciclo().catch(falhou));
  }, [ciclo, enfileirar, falhou]);

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
    const cred = await derivarCredenciais(frase);
    const p = await prepararAtivacao(await lerCofre(cred), remotoCofreAntigo(cred), dadosRef.current, 'cofre-antigo');
    return { ...p, destino: { origem: 'cofre-antigo', cred } };
  }, []);

  /**
   * Ativação pela conta (depois de entrar): a chave vem da frase-senha e do id da conta. A derivação (lenta) e a
   * leitura do cofre rodam em paralelo. Frase que não decifra o cofre existente: erro, sem oferecer envio.
   */
  const prepararConta = useCallback(async (frase: string): Promise<Preparacao> => {
    const bloqueio = bloqueioDaConta(configAntiga());
    if (bloqueio) throw new Error(bloqueio);
    const sessao = await sessaoAtual();
    if (!sessao) throw new SessaoExpirada();
    const cliente = (await clienteSupabase()) as unknown as ClienteCofre;
    const [chave, r] = await Promise.all([derivarChaveDaConta(frase, sessao.userId), lerCofreDaConta(cliente)]);
    const p = await prepararAtivacao(r, remotoDaConta(cliente, chave), dadosRef.current, 'conta');
    return { ...p, destino: { origem: 'conta', userId: sessao.userId, email: sessao.email, chave: chave.chave } };
  }, []);

  /** Segundo passo: `nuvem` traz os dados da nuvem para cá; `local` envia os daqui para a nuvem. */
  const concluir = useCallback(
    (prep: Preparacao, escolha: 'nuvem' | 'local'): Promise<boolean> =>
      enfileirar(async () => {
        setConflito(null);
        setStatus('sincronizando');
        try {
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
    const origem = configRef.current?.origem;
    salvarConfig(null, origem);
    const outra = lerConfig(); // a outra config, se houver, passa a valer
    if (outra) salvarConfig(outra);
    setConflito(null);
    setErro(null);
    setPrecisaEntrar(false);
    setStatus(outra ? 'sincronizando' : 'desligado');
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
      cofreAntigoAtivo: !!configAntiga(),
      status,
      erro,
      precisaEntrar,
      conflito,
      ultimaSync: config?.ultimaSync ?? '',
    },
    preparar,
    prepararConta,
    concluir,
    resolverConflito,
    sincronizar,
    desativar,
    sairDaConta,
    apagarDaNuvem,
  };
}

export type Sincronizacao = ReturnType<typeof useSincronizacao>;
