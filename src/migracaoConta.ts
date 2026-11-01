import { remotoCofreAntigo, type Credenciais } from './cofre';
import { planejarMigracao, type Candidato, type OrigemDados, type PlanoMigracao } from './domain/migracao';
import { daNuvem, paraNuvem } from './domain/sincronia';
import type { Dados } from './domain/types';
import { SessaoExpirada, type Cifra, type Remoto, type RespostaRemota } from './remoto';
import { MENSAGEM_FRASE_DIFERENTE } from './sincronizacaoNucleo';

/**
 * Migração para a conta (ADR-0004), feita no navegador: junta navegador, cofre antigo e conta, baixa um backup
 * antes de tudo e envia, baixa ou pede escolha. Nunca apaga nem funde. Os efeitos são injetados (`DepsMigracao`).
 */

export const CHAVE_SYNC_V1 = 'rendller:sync:v1';
/** A config do cofre antigo vai para cá depois da migração: nada é apagado, mas ela não sincroniza mais. */
export const CHAVE_SYNC_MIGRADO = 'rendller:sync:v1:migrado';
/** Versões substituídas durante a migração (o navegador antes de receber dados, ou a conta antes de ser sobrescrita). */
export const CHAVE_COPIA_CONTA = 'rendller:copia-antes-da-conta';

export const nomeBackup = (agora: string) => `rendller-antes-da-conta-${agora.slice(0, 10)}.json`;

export interface DepsMigracao {
  lerNavegador(): Dados;
  /** null se não havia sincronização antiga; erro (rede, acesso negado) vira aviso e o navegador migra assim mesmo. */
  lerCofreAntigo(): Promise<Dados | null>;
  /** O cofre da conta (ler e gravar não dependem da chave). */
  conta: Remoto;
  /** A cifra da conta; a derivação da chave (lenta) roda em paralelo com as leituras. */
  cifraConta(): Promise<Cifra>;
  /** Download do .json. Chamado de forma síncrona, antes de qualquer acesso à rede. */
  baixarBackup(d: Dados, nome: string): void;
  /** Guarda em `rendller:copia-antes-da-conta` uma versão que vai ser substituída. */
  guardarCopia(d: Dados, origem: OrigemDados): void;
  aplicarLocal(d: Dados): void;
  /** Move `rendller:sync:v1` para `rendller:sync:v1:migrado`; NÃO chama `apagar()`. */
  arquivarCofreAntigo(): void;
  /** Grava a config da conta com `migradoEm`, a versão do cofre e os dados que ficaram nos dois lados. */
  marcarMigrado(em: string, estado: { versao: number; dados: Dados }): void;
  migradoEm(): string | null;
}

export type Contagens = Record<OrigemDados, number | null>;

export type ResultadoMigracao =
  | { tipo: 'concluida'; plano: PlanoMigracao; avisos: string[]; backup: string | null; contagens: Contagens | null }
  | { tipo: 'escolha-pendente'; candidatos: Candidato[]; avisos: string[]; backup: string; contagens: Contagens }
  | { tipo: 'falhou'; erro: string }; // nada local foi alterado; dá para repetir

/** Lê o cofre antigo com as credenciais salvas neste aparelho (a frase não é pedida de novo). */
export async function lerCofreAntigoCom(cred: Credenciais, local: Dados): Promise<Dados | null> {
  const r = remotoCofreAntigo(cred);
  const lido = await r.ler();
  if (lido.tipo === 'inexistente') return null;
  if (lido.tipo !== 'ok') throw new Error('o cofre antigo recusou o acesso');
  return lido.envelope ? daNuvem(await r.decifrar(lido.envelope), local) : null;
}

/** Efeitos locais da migração sobre um `Storage` (testáveis com um em memória). */
export function armazenamentoMigracao(s: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  return {
    guardarCopia(d: Dados, origem: OrigemDados, em: string) {
      let versoes: unknown[] = [];
      try {
        const atual = JSON.parse(s.getItem(CHAVE_COPIA_CONTA) ?? 'null');
        if (Array.isArray(atual?.versoes)) versoes = atual.versoes;
      } catch {
        /* cópia anterior ilegível: começa outra (a anterior não é usada pelo app) */
      }
      s.setItem(CHAVE_COPIA_CONTA, JSON.stringify({ versoes: [...versoes, { em, origem, dados: d }] }));
    },
    arquivarCofreAntigo() {
      const atual = s.getItem(CHAVE_SYNC_V1);
      if (atual == null) return;
      s.setItem(CHAVE_SYNC_MIGRADO, atual);
      s.removeItem(CHAVE_SYNC_V1);
    },
    cofreAntigoArquivado: () => s.getItem(CHAVE_SYNC_MIGRADO) != null,
  };
}

/** Conteúdo atual da conta: null sem cofre. Frase errada vira a mensagem da Fase 4; sem sessão, `SessaoExpirada`. */
async function conteudoDaConta(r: RespostaRemota, cifra: Cifra, local: Dados): Promise<{ dados: Dados | null; base: number }> {
  if (r.tipo === 'inexistente') return { dados: null, base: 0 };
  if (r.tipo === 'negado') throw new SessaoExpirada();
  if (r.tipo !== 'ok') throw new Error('A conta recusou o acesso.');
  if (!r.envelope) return { dados: null, base: r.versao };
  let conteudo: unknown;
  try {
    conteudo = await cifra.decifrar(r.envelope);
  } catch {
    throw new Error(MENSAGEM_FRASE_DIFERENTE);
  }
  return { dados: daNuvem(conteudo, local), base: r.versao };
}

async function gravarNaConta(d: DepsMigracao, cifra: Cifra, base: number, dados: Dados): Promise<number> {
  const r = await d.conta.gravar(base, await cifra.cifrar({ ...paraNuvem(dados), versao: 2 }));
  if (r.tipo === 'conflito') throw new Error('A conta mudou durante a migração (outro aparelho?). Tente de novo.');
  if (r.tipo === 'negado') throw new SessaoExpirada();
  if (r.tipo !== 'ok') throw new Error('A conta recusou a gravação.');
  return r.versao;
}

function contar(navegador: Dados, antigo: Dados | null, conta: Dados | null): Contagens {
  return { navegador: navegador.aportes.length, 'cofre-antigo': antigo ? antigo.aportes.length : null, conta: conta ? conta.aportes.length : null };
}

/**
 * Ordem: backup (síncrono) → leituras em paralelo → plano → cópia local → gravar ou aplicar → arquivar o cofre
 * antigo → marcar migrado. Uma falha antes de arquivar devolve `falhou` sem arquivar nem marcar.
 */
export async function migrarParaConta(d: DepsMigracao, agora: string): Promise<ResultadoMigracao> {
  if (d.migradoEm()) return { tipo: 'concluida', plano: { acao: 'nada' }, avisos: [], backup: null, contagens: null };
  const navegador = d.lerNavegador();
  const backup = nomeBackup(agora);
  d.baixarBackup(navegador, backup); // antes do primeiro await de rede
  try {
    const avisos: string[] = [];
    const [antigo, lidoConta, cifra] = await Promise.all([
      d.lerCofreAntigo().catch((e: Error) => {
        avisos.push(`Não consegui ler o cofre antigo (${e.message || 'sem conexão'}); migrei os dados deste navegador. O cofre antigo continua intacto.`);
        return null;
      }),
      d.conta.ler(),
      d.cifraConta(),
    ]);
    const conta = await conteudoDaConta(lidoConta, cifra, navegador);
    const contagens = contar(navegador, antigo, conta.dados);
    let plano = planejarMigracao(navegador, antigo, conta.dados);
    if (plano.acao === 'escolher') return { tipo: 'escolha-pendente', candidatos: plano.candidatos, avisos, backup, contagens };
    // conta sem cofre e nada a enviar: cria o cofre (vazio) para a sincronização seguir
    if (plano.acao === 'nada' && !conta.dados && lidoConta.tipo === 'inexistente') plano = { acao: 'enviar', dados: navegador, origem: 'navegador' };

    let versao = conta.base;
    let final = navegador;
    if (plano.acao === 'enviar') {
      d.guardarCopia(navegador, 'navegador'); // antes de gravar
      versao = await gravarNaConta(d, cifra, conta.base, plano.dados);
      final = plano.dados;
      if (plano.origem !== 'navegador') d.aplicarLocal(plano.dados);
    } else if (plano.acao === 'baixar') {
      d.guardarCopia(navegador, 'navegador');
      d.aplicarLocal(plano.dados);
      final = plano.dados;
    }
    d.arquivarCofreAntigo();
    d.marcarMigrado(agora, { versao, dados: final });
    return { tipo: 'concluida', plano, avisos, backup, contagens };
  } catch (e) {
    return { tipo: 'falhou', erro: (e as Error).message || 'Falha na migração.' };
  }
}

/**
 * Conclui a migração com a versão escolhida pelo usuário. A versão que seria perdida (o navegador, quando outra
 * vence, ou o conteúdo da conta, quando ele vai ser sobrescrito) fica em `rendller:copia-antes-da-conta`.
 */
export async function concluirEscolha(d: DepsMigracao, escolhido: Candidato, agora: string): Promise<ResultadoMigracao> {
  try {
    const navegador = d.lerNavegador();
    const [lidoConta, cifra] = await Promise.all([d.conta.ler(), d.cifraConta()]);
    const conta = await conteudoDaConta(lidoConta, cifra, navegador);
    let versao = conta.base;
    let final: Dados;
    if (escolhido.origem === 'conta') {
      final = conta.dados ?? escolhido.dados;
      d.guardarCopia(navegador, 'navegador');
      d.aplicarLocal(final);
    } else {
      if (conta.dados && conta.dados.aportes.length) d.guardarCopia(conta.dados, 'conta');
      if (escolhido.origem !== 'navegador') d.guardarCopia(navegador, 'navegador');
      versao = await gravarNaConta(d, cifra, conta.base, escolhido.dados);
      final = escolhido.dados;
      if (escolhido.origem !== 'navegador') d.aplicarLocal(final);
    }
    d.arquivarCofreAntigo();
    d.marcarMigrado(agora, { versao, dados: final });
    const plano: PlanoMigracao = escolhido.origem === 'conta' ? { acao: 'baixar', dados: final } : { acao: 'enviar', dados: final, origem: escolhido.origem };
    return { tipo: 'concluida', plano, avisos: [], backup: null, contagens: null };
  } catch (e) {
    return { tipo: 'falhou', erro: (e as Error).message || 'Falha na migração.' };
  }
}
