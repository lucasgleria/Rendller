import { useCallback, useEffect, useRef, useState } from 'react';
import { apagarCofre, cifrar, decifrar, derivarCredenciais, gravarCofre, lerCofre, type Credenciais } from './cofre';
import { daNuvem, impressao, paraNuvem } from './domain/sincronia';
import type { Dados } from './domain/types';

const CHAVE_CONFIG = 'rendller:sync:v1';
/** Cópia dos dados locais antes de serem trocados pelos da nuvem (para não perder nada num engano). */
export const CHAVE_COPIA = 'rendller:copia-antes-da-nuvem';
const ESPERA_ENVIO_MS = 1500;
const INTERVALO_MS = 120_000;

interface ConfigSync {
  cred: Credenciais;
  versao: number; // última versão do cofre que este aparelho conhece
  impressao: string; // impressão dos dados nessa versão (diferente da atual = há alteração a enviar)
  ultimaSync: string; // ISO 8601
}

export type StatusSync = 'desligado' | 'sincronizando' | 'sincronizado' | 'pendente' | 'offline' | 'conflito' | 'erro';

export interface Conflito {
  remoto: Dados;
  versao: number;
  atualizadoEm?: string;
}

export type Preparacao =
  | { tipo: 'novo'; cred: Credenciais }
  | { tipo: 'existente'; cred: Credenciais; remoto: Dados; versao: number; atualizadoEm?: string };

function lerConfig(): ConfigSync | null {
  try {
    const c = JSON.parse(localStorage.getItem(CHAVE_CONFIG) ?? 'null');
    return c?.cred?.id ? c : null;
  } catch {
    return null;
  }
}

function gravarConfig(c: ConfigSync | null) {
  try {
    if (c) localStorage.setItem(CHAVE_CONFIG, JSON.stringify(c));
    else localStorage.removeItem(CHAVE_CONFIG);
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

function semRede(e: unknown): boolean {
  return !navigator.onLine || (e as Error)?.name === 'AbortError' || e instanceof TypeError;
}

/**
 * Sincroniza os dados entre aparelhos por um cofre cifrado (ver `cofre.ts`). Busca a versão da nuvem ao abrir,
 * ao voltar para a aba, ao reconectar e a cada 2 minutos; envia as alterações locais 1,5 s depois da última edição.
 * Se os dois lados mudaram, nada é sobrescrito: o usuário escolhe qual versão fica.
 */
export function useSincronizacao(dados: Dados, substituir: (d: Dados) => void) {
  const [config, setConfigEstado] = useState<ConfigSync | null>(lerConfig);
  const [status, setStatus] = useState<StatusSync>(() => (lerConfig() ? 'sincronizando' : 'desligado'));
  const [erro, setErro] = useState<string | null>(null);
  const [conflito, setConflito] = useState<Conflito | null>(null);

  const configRef = useRef(config);
  const dadosRef = useRef(dados);
  dadosRef.current = dados;
  const fila = useRef<Promise<void>>(Promise.resolve());
  const conflitoRef = useRef(conflito);
  conflitoRef.current = conflito;

  const salvarConfig = useCallback((c: ConfigSync | null) => {
    configRef.current = c;
    gravarConfig(c);
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
    if (semRede(e)) {
      setStatus('offline');
      setErro('Sem conexão. As alterações ficam neste aparelho e são enviadas quando a internet voltar.');
    } else {
      setStatus('erro');
      setErro((e as Error).message || 'Falha na sincronização.');
    }
  }, []);

  const aplicarRemoto = useCallback(
    (c: ConfigSync, remoto: Dados, versao: number) => {
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
      const r = await gravarCofre(c.cred, base, await cifrar(c.cred, paraNuvem(d)));
      if (r.tipo === 'conflito') return false;
      if (r.tipo !== 'ok') throw new Error('O servidor recusou a gravação.');
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
      const r = await lerCofre(c.cred);
      if (r.tipo === 'negado') throw new Error('A nuvem recusou o acesso deste aparelho. Desative e ative a sincronização de novo.');
      if (r.tipo === 'inexistente') throw new Error('Os dados não existem mais na nuvem (foram apagados em outro aparelho?). Desative e ative de novo para recriar.');
      if (r.tipo !== 'ok') return;
      const pendente = impressao(dadosRef.current) !== c.impressao;
      if (r.versao !== c.versao && r.envelope) {
        const remoto = daNuvem(await decifrar(c.cred, r.envelope), dadosRef.current);
        if (!pendente || impressao(remoto) === impressao(dadosRef.current)) {
          aplicarRemoto(c, remoto, r.versao);
        } else {
          setConflito({ remoto, versao: r.versao, atualizadoEm: r.atualizadoEm });
          setStatus('conflito');
          return;
        }
      } else if (pendente && !(await enviar(c, c.versao))) {
        if (tentativa < 1) return ciclo(tentativa + 1); // alguém gravou entre a leitura e a escrita
        throw new Error('Outro aparelho está gravando ao mesmo tempo. Tente de novo.');
      }
      setErro(null);
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
  useEffect(() => {
    if (!config) return;
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
  }, [config?.cred.id, sincronizar]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Primeiro passo da ativação: deriva as credenciais e vê se já existe cofre para esta frase. */
  const preparar = useCallback(async (frase: string): Promise<Preparacao> => {
    const cred = await derivarCredenciais(frase);
    const r = await lerCofre(cred);
    if (r.tipo === 'inexistente') return { tipo: 'novo', cred };
    if (r.tipo !== 'ok' || !r.envelope) throw new Error('A nuvem recusou o acesso.');
    const remoto = daNuvem(await decifrar(cred, r.envelope), dadosRef.current);
    return { tipo: 'existente', cred, remoto, versao: r.versao, atualizadoEm: r.atualizadoEm };
  }, []);

  /** Segundo passo: `nuvem` traz os dados da nuvem para cá; `local` envia os daqui para a nuvem. */
  const concluir = useCallback(
    (prep: Preparacao, escolha: 'nuvem' | 'local'): Promise<boolean> =>
      enfileirar(async () => {
        setConflito(null);
        setStatus('sincronizando');
        try {
          const c: ConfigSync = { cred: prep.cred, versao: prep.tipo === 'existente' ? prep.versao : 0, impressao: '', ultimaSync: '' };
          if (prep.tipo === 'existente' && escolha === 'nuvem') aplicarRemoto(c, prep.remoto, prep.versao);
          else if (!(await enviar(c, c.versao))) throw new Error('Outro aparelho gravou neste instante. Tente ativar de novo.');
          setErro(null);
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

  const desativar = useCallback(() => {
    salvarConfig(null);
    setConflito(null);
    setErro(null);
    setStatus('desligado');
  }, [salvarConfig]);

  const apagarDaNuvem = useCallback(
    () =>
      enfileirar(async () => {
        const c = configRef.current;
        if (!c) return;
        try {
          await apagarCofre(c.cred);
          desativar();
        } catch (e) {
          falhou(e);
        }
      }),
    [desativar, enfileirar, falhou],
  );

  return {
    sync: { ativo: !!config, status, erro, conflito, ultimaSync: config?.ultimaSync ?? '' },
    preparar,
    concluir,
    resolverConflito,
    sincronizar,
    desativar,
    apagarDaNuvem,
  };
}

export type Sincronizacao = ReturnType<typeof useSincronizacao>;
