import { remotoCofreAntigo, type Credenciais } from './cofre';
import { clienteSupabase, remotoDaConta, sessaoAtual, type ClienteCofre, type Sessao } from './conta';
import { daNuvem, impressao, planejarCiclo } from './domain/sincronia';
import type { Dados } from './domain/types';
import { NuvemIndisponivel, SessaoExpirada, type Cifra, type Remoto, type RespostaRemota } from './remoto';

/**
 * Núcleo da sincronização sem React: configs salvas, abertura do cofre, ciclo (leitura → decisão) e
 * classificação de falhas. O hook (`sincronizacao.ts`) só aplica os efeitos.
 */

interface Comum {
  versao: number; // última versão do cofre que este aparelho conhece
  impressao: string; // impressão dos dados nessa versão (diferente da atual = há alteração a enviar)
  ultimaSync: string; // ISO 8601
}

/** Cofre antigo (`rendller:sync:v1`) ou cofre da conta (`rendller:conta:v1`); cada um na própria chave. */
export type ConfigSync =
  | (Comum & { origem: 'cofre-antigo'; cred: Credenciais })
  | (Comum & { origem: 'conta'; userId: string; email: string; chave: string; migradoEm?: string }); // chave derivada da frase, como no cofre antigo

export const CHAVE_CONFIG_ANTIGA = 'rendller:sync:v1';
export const CHAVE_CONTA = 'rendller:conta:v1';

export const MENSAGEM_FRASE_DIFERENTE = 'Frase-senha diferente da usada nesta conta';
/** Mostrado antes de entrar na conta quando o cofre antigo está ativo neste aparelho. */
export const AVISO_MIGRAR_TODOS =
  'Migre todos os seus aparelhos no mesmo dia. Edições feitas num aparelho ainda não migrado vão só para o cofre antigo e, quando ele migrar, você vai precisar escolher uma versão.';

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

/** Lê a config da conta em `rendller:conta:v1`. */
export function lerContaSalva(bruto: string | null): ConfigSync | null {
  try {
    const c = JSON.parse(bruto ?? 'null');
    if (typeof c?.userId !== 'string' || typeof c?.chave !== 'string' || !c.userId || !c.chave) return null;
    return { email: '', versao: 0, impressao: '', ultimaSync: '', ...c, origem: 'conta' };
  } catch {
    return null;
  }
}

/** Com as duas configs presentes, a conta sincroniza; a do cofre antigo fica intacta. */
export function escolherConfig(antiga: ConfigSync | null, conta: ConfigSync | null): ConfigSync | null {
  return conta ?? antiga;
}

/**
 * A sessão (ou o e-mail digitado, antes de entrar) é da conta ativada neste aparelho? null = confere.
 * Sem `userId`, compara só o e-mail (sem diferença de maiúsculas e espaços).
 */
export function contaConfere(c: { userId: string; email: string }, s: { userId?: string; email: string }): string | null {
  const diferente = s.userId !== undefined ? s.userId !== c.userId : !!c.email && s.email.trim().toLowerCase() !== c.email.trim().toLowerCase();
  return diferente ? `Conta diferente da ativada neste aparelho; entre com ${c.email}` : null;
}

/** Antes de cada leitura, gravação ou remoção, confere a sessão; nada chega ao servidor com a conta errada. */
function remotoConferido(r: Remoto & Cifra, conferir: () => Promise<void>): Remoto & Cifra {
  return {
    ler: async () => (await conferir(), r.ler()),
    gravar: async (base, e) => (await conferir(), r.gravar(base, e)),
    apagar: async () => (await conferir(), r.apagar()),
    cifrar: (d) => r.cifrar(d),
    decifrar: (e) => r.decifrar(e),
  };
}

/** O cofre onde esta config sincroniza. `deps` só existe para os testes. */
export async function abrirRemoto(
  c: ConfigSync,
  deps: { sessao: () => Promise<Sessao | null>; cliente: () => Promise<ClienteCofre> } = {
    sessao: sessaoAtual,
    cliente: async () => (await clienteSupabase()) as unknown as ClienteCofre,
  },
): Promise<Remoto & Cifra> {
  if (c.origem === 'cofre-antigo') return remotoCofreAntigo(c.cred);
  const remoto = remotoDaConta(await deps.cliente(), { id: c.userId, chave: c.chave });
  return remotoConferido(remoto, async () => {
    const s = await deps.sessao(); // sem rede: TypeError ("sem conexão"), não "entre de novo"
    if (!s) throw new SessaoExpirada();
    const diferente = contaConfere(c, s);
    if (diferente) throw new SessaoExpirada(diferente);
  });
}

export type Preparacao = { tipo: 'novo' } | { tipo: 'existente'; remoto: Dados; versao: number; atualizadoEm?: string };

/**
 * Ativação: com a leitura do cofre já feita, decide entre "cofre novo" e "dados existentes".
 * Na conta, uma frase-senha que não decifra o cofre existente vira erro claro e nada é gravado.
 */
export async function prepararAtivacao(r: RespostaRemota, cifra: Cifra, local: Dados, origem: ConfigSync['origem']): Promise<Preparacao> {
  if (r.tipo === 'inexistente') return { tipo: 'novo' };
  if (r.tipo === 'negado') throw origem === 'conta' ? new SessaoExpirada() : new Error('A nuvem recusou o acesso.');
  if (r.tipo !== 'ok' || !r.envelope) throw new Error('A nuvem recusou o acesso.');
  let conteudo: unknown;
  try {
    conteudo = await cifra.decifrar(r.envelope);
  } catch (e) {
    if (origem === 'conta') throw new Error(MENSAGEM_FRASE_DIFERENTE);
    throw e;
  }
  return { tipo: 'existente', remoto: daNuvem(conteudo, local), versao: r.versao, atualizadoEm: r.atualizadoEm };
}

export type PassoCiclo =
  | { acao: 'aplicar'; remoto: Dados; versao: number }
  | { acao: 'conflito'; remoto: Dados; versao: number; atualizadoEm?: string }
  | { acao: 'enviar' }
  | { acao: 'nada' };

/**
 * Um ciclo sem efeitos: lê o cofre, decifra se preciso e decide. `local`, `aguardandoCofre` e `podeGravar` são
 * relidos depois do `await` da decifração, porque o usuário pode ter editado enquanto isso.
 */
export async function cicloRemoto(
  c: Pick<ConfigSync, 'origem' | 'versao' | 'impressao'>,
  remoto: Remoto & Cifra,
  estado: { local(): Dados; aguardandoCofre(): boolean; podeGravar(): boolean },
): Promise<PassoCiclo> {
  const r = await remoto.ler();
  if (r.tipo === 'negado') {
    if (c.origem === 'conta') throw new SessaoExpirada();
    throw new Error('A nuvem recusou o acesso deste aparelho. Desative e ative a sincronização de novo.');
  }
  if (r.tipo === 'inexistente') throw new Error('Os dados não existem mais na nuvem (foram apagados em outro aparelho?). Desative e ative de novo para recriar.');
  if (r.tipo !== 'ok') return { acao: 'nada' };
  const entrada = () => ({
    versaoLocal: c.versao,
    versaoRemota: r.versao,
    temEnvelope: !!r.envelope,
    impressaoConfig: c.impressao,
    impressaoLocal: impressao(estado.local()),
    impressaoRemota: null as string | null,
    aguardandoCofre: estado.aguardandoCofre(),
    podeGravar: estado.podeGravar(),
  });
  const dados = planejarCiclo(entrada()).precisaRemoto && r.envelope ? daNuvem(await remoto.decifrar(r.envelope), estado.local()) : null;
  // depois do await: relê o estado local antes de decidir
  const { decisao } = planejarCiclo({ ...entrada(), impressaoRemota: dados ? impressao(dados) : null });
  if (decisao === 'aplicar' && dados) return { acao: 'aplicar', remoto: dados, versao: r.versao };
  if (decisao === 'conflito' && dados) return { acao: 'conflito', remoto: dados, versao: r.versao, atualizadoEm: r.atualizadoEm };
  if (decisao === 'enviar') return { acao: 'enviar' };
  return { acao: 'nada' };
}

/** Como mostrar uma falha da sincronização. */
export function classificarFalha(e: unknown, online: boolean): { status: 'offline' | 'erro'; erro: string; precisaEntrar: boolean } {
  if (e instanceof NuvemIndisponivel) return { status: 'offline', erro: e.message, precisaEntrar: false };
  if (!online || (e as Error)?.name === 'AbortError' || e instanceof TypeError) {
    return { status: 'offline', erro: 'Sem conexão. As alterações ficam neste aparelho e são enviadas quando a internet voltar.', precisaEntrar: false };
  }
  if (e instanceof SessaoExpirada) return { status: 'erro', erro: e.message, precisaEntrar: true };
  return { status: 'erro', erro: (e as Error)?.message || 'Falha na sincronização.', precisaEntrar: false };
}
