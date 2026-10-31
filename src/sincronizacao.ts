import { useCallback, useEffect, useRef, useState } from 'react';
import type { Carga } from './armazenamento';
import { derivarCredenciais, remotoCofreAntigo, type Credenciais } from './cofre';
import { aguardandoDepois, ajustarImpressaoAposNormalizacao, daNuvem, impressao, paraNuvem, planejarCiclo } from './domain/sincronia';
import type { Dados } from './domain/types';
import type { Cifra, Remoto } from './remoto';

const CHAVE_CONFIG = 'rendller:sync:v1';
/** Cópia dos dados locais antes de serem trocados pelos da nuvem (para não perder nada num engano). */
export const CHAVE_COPIA = 'rendller:copia-antes-da-nuvem';
const ESPERA_ENVIO_MS = 1500;
const INTERVALO_MS = 120_000;

export interface ConfigSync {
  /** Onde fica o cofre. Config gravada antes deste campo é do cofre antigo. */
  origem: 'cofre-antigo';
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

/** Lê a config salva em `rendller:sync:v1`; a gravada sem `origem` é do cofre antigo. Origem desconhecida não liga nada. */
export function lerConfigSalva(bruto: string | null): ConfigSync | null {
  try {
    const c = JSON.parse(bruto ?? 'null');
    if (!c?.cred?.id) return null;
    if (c.origem !== undefined && c.origem !== 'cofre-antigo') return null;
    return { ...c, origem: 'cofre-antigo' };
  } catch {
    return null;
  }
}

function lerConfig(): ConfigSync | null {
  try {
    return lerConfigSalva(localStorage.getItem(CHAVE_CONFIG));
  } catch {
    return null;
  }
}

/** O cofre onde esta config sincroniza. */
export function abrirRemoto(c: ConfigSync): Remoto & Cifra {
  return remotoCofreAntigo(c.cred);
}

/** Config salva; depois da migração e da normalização a impressão passa a assinar os dados normalizados (sem falso "pendente"). */
function configInicial(dados: Dados, carga: Pick<Carga, 'origem' | 'bruto'>): ConfigSync | null {
  const c = lerConfig();
  if (!c || (carga.origem !== 'v1' && carga.origem !== 'v2')) return c;
  const ajustada = ajustarImpressaoAposNormalizacao(c, carga.bruto, dados);
  if (ajustada !== c) gravarConfig(ajustada);
  return ajustada;
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
 * Se os dados locais estavam ilegíveis ao abrir, o cofre é baixado e aplicado mesmo na mesma versão; nada local
 * vai por cima dele (uma edição feita antes do download vira conflito). `podeGravar` vem de `useDados`.
 */
export function useSincronizacao(dados: Dados, substituir: (d: Dados) => void, carga: Pick<Carga, 'origem' | 'bruto'>, podeGravar: boolean) {
  const [config, setConfigEstado] = useState<ConfigSync | null>(() => configInicial(dados, carga));
  const [status, setStatus] = useState<StatusSync>(() => (lerConfig() ? 'sincronizando' : 'desligado'));
  const [erro, setErro] = useState<string | null>(null);
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
      // a nuvem sempre recebe versao 2 (a impressão de dados legados continua usando a versão do objeto)
      const remoto = abrirRemoto(c);
      const r = await remoto.gravar(base, await remoto.cifrar({ ...paraNuvem(d), versao: 2 }));
      if (r.tipo === 'conflito') return false;
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
      const cofre = abrirRemoto(c);
      const r = await cofre.ler();
      if (r.tipo === 'negado') throw new Error('A nuvem recusou o acesso deste aparelho. Desative e ative a sincronização de novo.');
      if (r.tipo === 'inexistente') throw new Error('Os dados não existem mais na nuvem (foram apagados em outro aparelho?). Desative e ative de novo para recriar.');
      if (r.tipo !== 'ok') return;
      const local = dadosRef.current;
      const entrada = {
        versaoLocal: c.versao,
        versaoRemota: r.versao,
        temEnvelope: !!r.envelope,
        impressaoConfig: c.impressao,
        impressaoLocal: impressao(local),
        impressaoRemota: null as string | null,
        aguardandoCofre: aguardandoCofre.current,
        podeGravar: podeGravarRef.current,
      };
      const remoto = planejarCiclo(entrada).precisaRemoto && r.envelope ? daNuvem(await cofre.decifrar(r.envelope), local) : null;
      const { decisao } = planejarCiclo({ ...entrada, impressaoRemota: remoto ? impressao(remoto) : null });
      if (decisao === 'aplicar' && remoto) aplicarRemoto(c, remoto, r.versao);
      else if (decisao === 'conflito' && remoto) {
        setConflito({ remoto, versao: r.versao, atualizadoEm: r.atualizadoEm });
        setStatus('conflito');
        return;
      } else if (decisao === 'enviar' && !(await enviar(c, c.versao))) {
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
    const cofre = abrirRemoto({ origem: 'cofre-antigo', cred, versao: 0, impressao: '', ultimaSync: '' });
    const r = await cofre.ler();
    if (r.tipo === 'inexistente') return { tipo: 'novo', cred };
    if (r.tipo !== 'ok' || !r.envelope) throw new Error('A nuvem recusou o acesso.');
    const remoto = daNuvem(await cofre.decifrar(r.envelope), dadosRef.current);
    return { tipo: 'existente', cred, remoto, versao: r.versao, atualizadoEm: r.atualizadoEm };
  }, []);

  /** Segundo passo: `nuvem` traz os dados da nuvem para cá; `local` envia os daqui para a nuvem. */
  const concluir = useCallback(
    (prep: Preparacao, escolha: 'nuvem' | 'local'): Promise<boolean> =>
      enfileirar(async () => {
        setConflito(null);
        setStatus('sincronizando');
        try {
          const c: ConfigSync = { origem: 'cofre-antigo', cred: prep.cred, versao: prep.tipo === 'existente' ? prep.versao : 0, impressao: '', ultimaSync: '' };
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
          await abrirRemoto(c).apagar();
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
