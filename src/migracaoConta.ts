import { remotoCofreAntigo, type Credenciais } from './cofre';
import { planejarMigracao, type Candidato, type OrigemDados, type PlanoMigracao } from './domain/migracao';
import { impressao } from './domain/impressao';
import { daNuvem, paraNuvem } from './domain/sincronia';
import type { Dados } from './domain/types';
import { SessaoExpirada, type Cifra, type Remoto, type RespostaRemota } from './remoto';
import { CHAVE_CONTA, escolherConfig, lerConfigSalva, lerContaSalva, MENSAGEM_FRASE_DIFERENTE, type ConfigSync } from './sincronizacaoNucleo';

/**
 * Migração para a conta (ADR-0004), feita no navegador: junta navegador, cofre antigo e conta, baixa um backup
 * antes de tudo e envia, baixa ou pede escolha. Nunca apaga nem funde. Os efeitos são injetados (`DepsMigracao`).
 */

export const CHAVE_SYNC_V1 = 'rendller:sync:v1';
/** A config do cofre antigo vai para cá depois da migração: nada é apagado, mas ela não sincroniza mais. */
export const CHAVE_SYNC_MIGRADO = 'rendller:sync:v1:migrado';
/**
 * Migração incompleta (cofre antigo não lido) e o usuário saiu da conta: a config do cofre antigo fica aqui,
 * guardada para a nova tentativa, mas não sincroniza sozinha.
 */
export const CHAVE_SYNC_PENDENTE = 'rendller:sync:v1:migracao-pendente';
/** Versões substituídas durante a migração (o navegador antes de receber dados, ou a conta antes de ser sobrescrita). */
export const CHAVE_COPIA_CONTA = 'rendller:copia-antes-da-conta';

export const nomeBackup = (agora: string) => `rendller-antes-da-conta-${agora.slice(0, 10)}.json`;

/** Quantas versões substituídas ficam guardadas na cópia (as mais recentes). */
const MAXIMO_COPIAS = 3;

export const AVISO_COFRE_ANTIGO_PASSAGEIRO = 'Não consegui ler o cofre antigo; ele continua ativo neste aparelho — tente de novo depois';
export const AVISO_COFRE_ANTIGO_SEM_ACESSO =
  'O cofre antigo recusou o acesso (apagado ou sem permissão); ele foi arquivado neste aparelho, sem apagar nada.';
export const MENSAGEM_JA_MIGROU = 'Este aparelho já migrou para a conta';
export const MENSAGEM_MIGRACAO_INCOMPLETA = 'Migração para a conta incompleta; entre de novo para concluir';

export type ConfigConta = Extract<ConfigSync, { origem: 'conta' }>;

/** O cofre antigo recusou o acesso (403): não adianta tentar de novo; pode arquivar. */
export class CofreAntigoSemAcesso extends Error {
  constructor() {
    super('o cofre antigo recusou o acesso');
    this.name = 'CofreAntigoSemAcesso';
  }
}

/** O cofre antigo não pode ser ativado de novo num aparelho que já migrou para a conta. */
export function recusaCofreAntigo(s: Pick<Storage, 'getItem'>): string | null {
  if (s.getItem(CHAVE_SYNC_MIGRADO) != null) return MENSAGEM_JA_MIGROU;
  return s.getItem(CHAVE_SYNC_PENDENTE) != null ? MENSAGEM_MIGRACAO_INCOMPLETA : null;
}

/** Config do cofre antigo a ler na migração: a ativa ou a guardada de uma migração incompleta. */
export function configCofreAntigoSalva(s: Pick<Storage, 'getItem'>): Extract<ConfigSync, { origem: 'cofre-antigo' }> | null {
  const c = lerConfigSalva(s.getItem(CHAVE_SYNC_V1) ?? s.getItem(CHAVE_SYNC_PENDENTE));
  return c?.origem === 'cofre-antigo' ? c : null;
}

/**
 * Config desta aba: a atual relida (ver `configDaAba`) ou, sem nenhuma, a que estiver salva agora (a conta tem
 * prioridade). Assim uma aba que ficou sem sincronização liga a conta quando outra aba a ativa.
 */
export function configParaAba(atual: ConfigSync | null, s: Pick<Storage, 'getItem'>): ConfigSync | null {
  if (atual) return configDaAba(atual, s);
  return escolherConfig(configDaAba(lerConfigSalva(s.getItem(CHAVE_SYNC_V1)), s), lerContaSalva(s.getItem(CHAVE_CONTA)));
}

/** Outra aba concluiu a migração? Devolve a config da conta (com `migradoEm`) para esta aba adotar. */
export function outraAbaMigrou(s: Pick<Storage, 'getItem'>): ConfigConta | null {
  const c = lerContaSalva(s.getItem(CHAVE_CONTA));
  return c?.origem === 'conta' && c.migradoEm ? c : null;
}

/**
 * O que fazer ao desativar a config `ativa` neste aparelho. Saindo da conta com a migração incompleta (cofre antigo
 * ainda guardado, sem `migradoEm`), nada volta a sincronizar: o cofre antigo é pausado e o usuário é avisado.
 */
export function depoisDeDesativar(
  ativa: ConfigSync | null,
  s: Pick<Storage, 'getItem'>,
): { proxima: ConfigSync | null; pausarCofreAntigo: boolean; aviso: string | null } {
  if (ativa?.origem === 'conta') {
    const incompleta = !ativa.migradoEm && (s.getItem(CHAVE_SYNC_V1) != null || s.getItem(CHAVE_SYNC_PENDENTE) != null);
    return incompleta ? { proxima: null, pausarCofreAntigo: true, aviso: MENSAGEM_MIGRACAO_INCOMPLETA } : { proxima: null, pausarCofreAntigo: false, aviso: null };
  }
  return { proxima: lerContaSalva(s.getItem(CHAVE_CONTA)), pausarCofreAntigo: false, aviso: null };
}

/** `rendller:sync:v1` nunca é regravado depois do arquivamento (uma aba antiga não desarquiva o cofre). */
export function podeGravarCofreAntigo(s: Pick<Storage, 'getItem'>): boolean {
  return s.getItem(CHAVE_SYNC_MIGRADO) == null;
}

/**
 * Config que esta aba deve usar, relida do `localStorage`: se outra aba migrou (sync:v1 sumiu e há :migrado),
 * o cofre antigo é desligado aqui e vale a conta, se houver.
 */
export function configDaAba(c: ConfigSync | null, s: Pick<Storage, 'getItem'>): ConfigSync | null {
  if (c?.origem === 'cofre-antigo' && s.getItem(CHAVE_SYNC_V1) == null && s.getItem(CHAVE_SYNC_MIGRADO) != null) {
    return lerContaSalva(s.getItem(CHAVE_CONTA));
  }
  return c;
}

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
  /**
   * Grava a config da conta com a versão do cofre e os dados que ficaram nos dois lados. `em` é null quando o
   * cofre antigo não pôde ser lido (erro passageiro): sem `migradoEm`, uma nova tentativa roda de novo.
   */
  marcarMigrado(em: string | null, estado: { versao: number; dados: Dados }): void | Promise<void>;
  migradoEm(): string | null;
}

export type Contagens = Record<OrigemDados, number | null>;

export type ResultadoMigracao =
  | { tipo: 'concluida'; plano: PlanoMigracao; avisos: string[]; backup: string | null; contagens: Contagens | null }
  | { tipo: 'escolha-pendente'; candidatos: Candidato[]; avisos: string[]; backup: string; contagens: Contagens; manterCofreAntigo: boolean }
  | { tipo: 'falhou'; erro: string }; // nada local foi alterado; dá para repetir

/** Lê o cofre antigo com as credenciais salvas neste aparelho (a frase não é pedida de novo). */
export async function lerCofreAntigoCom(cred: Credenciais, local: Dados): Promise<Dados | null> {
  const r = remotoCofreAntigo(cred);
  const lido = await r.ler();
  if (lido.tipo === 'inexistente') return null;
  if (lido.tipo === 'negado') throw new CofreAntigoSemAcesso();
  if (lido.tipo !== 'ok') throw new Error('resposta inesperada do cofre antigo');
  return lido.envelope ? daNuvem(await r.decifrar(lido.envelope), local) : null;
}

/** Efeitos locais da migração sobre um `Storage` (testáveis com um em memória). */
export function armazenamentoMigracao(s: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  return {
    /** Acrescenta uma versão (sem repetir a mesma impressão) e mantém só as mais recentes. Sem espaço, lança. */
    guardarCopia(d: Dados, origem: OrigemDados, em: string) {
      let versoes: { em: string; origem: OrigemDados; impressao?: string; dados: Dados }[] = [];
      try {
        const atual = JSON.parse(s.getItem(CHAVE_COPIA_CONTA) ?? 'null');
        if (Array.isArray(atual?.versoes)) versoes = atual.versoes;
      } catch {
        /* cópia anterior ilegível: começa outra (a anterior não é usada pelo app) */
      }
      const marca = impressao(d);
      const outras = versoes.filter((v) => (v.impressao ?? (v.dados ? impressao(v.dados) : '')) !== marca);
      const todas = [...outras, { em, origem, impressao: marca, dados: d }].slice(-MAXIMO_COPIAS);
      s.setItem(CHAVE_COPIA_CONTA, JSON.stringify({ versoes: todas }));
    },
    arquivarCofreAntigo() {
      const atual = s.getItem(CHAVE_SYNC_V1) ?? s.getItem(CHAVE_SYNC_PENDENTE);
      if (atual == null) return;
      s.setItem(CHAVE_SYNC_MIGRADO, atual);
      s.removeItem(CHAVE_SYNC_V1);
      s.removeItem(CHAVE_SYNC_PENDENTE);
    },
    /** Migração incompleta e saída da conta: guarda a config do cofre antigo sem deixá-la sincronizar. */
    pausarCofreAntigo() {
      const atual = s.getItem(CHAVE_SYNC_V1);
      if (atual == null) return;
      s.setItem(CHAVE_SYNC_PENDENTE, atual);
      s.removeItem(CHAVE_SYNC_V1);
    },
    migracaoPendente: () => s.getItem(CHAVE_SYNC_PENDENTE) != null,
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
    // erro passageiro (rede, 5xx) não arquiva: o cofre antigo continua ativo para uma nova tentativa ler de novo
    let manterCofreAntigo = false;
    const [antigo, lidoConta, cifra] = await Promise.all([
      d.lerCofreAntigo().catch((e: unknown) => {
        if (e instanceof CofreAntigoSemAcesso) avisos.push(AVISO_COFRE_ANTIGO_SEM_ACESSO);
        else {
          manterCofreAntigo = true;
          avisos.push(AVISO_COFRE_ANTIGO_PASSAGEIRO);
        }
        return null;
      }),
      d.conta.ler(),
      d.cifraConta(),
    ]);
    const conta = await conteudoDaConta(lidoConta, cifra, navegador);
    const contagens = contar(navegador, antigo, conta.dados);
    let plano = planejarMigracao(navegador, antigo, conta.dados);
    if (plano.acao === 'escolher') return { tipo: 'escolha-pendente', candidatos: plano.candidatos, avisos, backup, contagens, manterCofreAntigo };
    // conta sem cofre e nada a enviar: cria o cofre (vazio) para a sincronização seguir
    if (plano.acao === 'nada' && !conta.dados && lidoConta.tipo === 'inexistente') plano = { acao: 'enviar', dados: navegador, origem: 'navegador' };

    let versao = conta.base;
    let final = navegador;
    if (plano.acao === 'enviar') {
      d.guardarCopia(navegador, 'navegador'); // antes de gravar
      if (conta.dados) d.guardarCopia(conta.dados, 'conta'); // mesmo sem aportes: os parâmetros também são dados
      versao = await gravarNaConta(d, cifra, conta.base, plano.dados);
      final = plano.dados;
      if (plano.origem !== 'navegador') d.aplicarLocal(plano.dados);
    } else if (plano.acao === 'baixar') {
      d.guardarCopia(navegador, 'navegador');
      d.aplicarLocal(plano.dados);
      final = plano.dados;
    }
    if (!manterCofreAntigo) d.arquivarCofreAntigo();
    await d.marcarMigrado(manterCofreAntigo ? null : agora, { versao, dados: final });
    return { tipo: 'concluida', plano, avisos, backup, contagens };
  } catch (e) {
    return { tipo: 'falhou', erro: (e as Error).message || 'Falha na migração.' };
  }
}

/**
 * Conclui a migração com a versão escolhida pelo usuário. A versão que seria perdida (o navegador, quando outra
 * vence, ou o conteúdo da conta, quando ele vai ser sobrescrito) fica em `rendller:copia-antes-da-conta`.
 */
export async function concluirEscolha(d: DepsMigracao, escolhido: Candidato, agora: string, manterCofreAntigo = false): Promise<ResultadoMigracao> {
  try {
    const navegador = d.lerNavegador(); // lido agora: edições feitas durante a escolha contam
    const [lidoConta, cifra] = await Promise.all([d.conta.ler(), d.cifraConta()]);
    const conta = await conteudoDaConta(lidoConta, cifra, navegador);
    let versao = conta.base;
    let final: Dados;
    if (escolhido.origem === 'conta') {
      final = conta.dados ?? escolhido.dados;
      d.guardarCopia(navegador, 'navegador');
      d.aplicarLocal(final);
    } else {
      // o navegador escolhido é o de agora, não a foto da escolha
      const dados = escolhido.origem === 'navegador' ? navegador : escolhido.dados;
      if (conta.dados) d.guardarCopia(conta.dados, 'conta'); // a conta vai ser sobrescrita
      if (escolhido.origem !== 'navegador') d.guardarCopia(navegador, 'navegador');
      versao = await gravarNaConta(d, cifra, conta.base, dados);
      final = dados;
      if (escolhido.origem !== 'navegador') d.aplicarLocal(final);
    }
    if (!manterCofreAntigo) d.arquivarCofreAntigo();
    await d.marcarMigrado(manterCofreAntigo ? null : agora, { versao, dados: final });
    const plano: PlanoMigracao = escolhido.origem === 'conta' ? { acao: 'baixar', dados: final } : { acao: 'enviar', dados: final, origem: escolhido.origem };
    return { tipo: 'concluida', plano, avisos: [], backup: null, contagens: null };
  } catch (e) {
    return { tipo: 'falhou', erro: (e as Error).message || 'Falha na migração.' };
  }
}

/** O que o app oferece à migração; `criarDepsMigracao` monta as `DepsMigracao` sobre isto. */
export interface FontesMigracao {
  agora: string;
  armazenamento: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Os dados deste navegador no momento da chamada (nunca uma foto antiga). */
  lerDados(): Dados;
  baixarArquivo(nome: string, conteudo: string): void;
  /** Chamado só depois do backup: começa a rede (sessão, cliente, derivação da chave). */
  abrirConta(): { remoto: Remoto; cifra: Promise<Cifra>; identidade: Promise<{ userId: string; email: string; chave: string }> };
  lerCofreAntigo?(cred: Credenciais, local: Dados): Promise<Dados | null>;
  aplicarLocal(d: Dados): void;
  /** A migração terminou: a config da conta a ativar. */
  aoMigrar(c: ConfigConta): void;
}

/**
 * Monta as dependências da migração. O backup (.json) é gerado aqui, de forma síncrona, antes de abrir a conta:
 * chamada direto do clique, o navegador não bloqueia o download.
 */
export function criarDepsMigracao(f: FontesMigracao): DepsMigracao {
  const s = f.armazenamento;
  const foto = f.lerDados();
  f.baixarArquivo(nomeBackup(f.agora), JSON.stringify(foto, null, 2)); // antes de qualquer rede
  const conta = f.abrirConta();
  const armz = armazenamentoMigracao(s);
  const lerAntigo = f.lerCofreAntigo ?? lerCofreAntigoCom;
  return {
    lerNavegador: () => f.lerDados(),
    lerCofreAntigo: async () => {
      if (s.getItem(CHAVE_SYNC_MIGRADO) != null) return null; // já migrado
      const c = configCofreAntigoSalva(s); // ativo ou guardado de uma migração incompleta
      return c ? lerAntigo(c.cred, f.lerDados()) : null;
    },
    conta: conta.remoto,
    cifraConta: () => conta.cifra,
    baixarBackup: () => undefined, // já baixado acima
    guardarCopia: (d, origem) => {
      try {
        armz.guardarCopia(d, origem, new Date().toISOString());
      } catch {
        throw new Error('Sem espaço para guardar a cópia de segurança neste navegador; nada foi alterado.');
      }
    },
    aplicarLocal: (d) => f.aplicarLocal(d),
    arquivarCofreAntigo: () => armz.arquivarCofreAntigo(),
    marcarMigrado: async (em, estado) => {
      const id = await conta.identidade;
      f.aoMigrar({
        origem: 'conta',
        ...id,
        versao: estado.versao,
        impressao: impressao(estado.dados),
        ultimaSync: new Date().toISOString(),
        ...(em ? { migradoEm: em } : {}),
      });
    },
    migradoEm: () => {
      const c = lerContaSalva(s.getItem(CHAVE_CONTA)); // a config real da conta
      return c?.origem === 'conta' ? (c.migradoEm ?? null) : null;
    },
  };
}
