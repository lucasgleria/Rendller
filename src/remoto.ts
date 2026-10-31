/**
 * Onde a sincronização guarda o cofre cifrado. O hook de sincronização só conhece estas interfaces;
 * cada destino (cofre antigo no Netlify, cofre da conta) é uma implementação. Ver `remoto.contrato.ts`.
 */

/** Conteúdo cifrado com AES-GCM: o servidor só vê isto. */
export interface Envelope {
  iv: string;
  cifrado: string;
}

export type RespostaRemota =
  | { tipo: 'ok'; versao: number; envelope?: Envelope; atualizadoEm?: string }
  | { tipo: 'conflito'; versao: number }
  | { tipo: 'inexistente' }
  | { tipo: 'negado' };

/** Cofre remoto com controle de versão: `gravar` só grava sobre a versão `base`; senão devolve `conflito`. */
export interface Remoto {
  ler(): Promise<RespostaRemota>;
  gravar(base: number, e: Envelope): Promise<RespostaRemota>;
  apagar(): Promise<void>;
}

/** Cifra do lado do navegador: a chave nunca sai daqui. */
export interface Cifra {
  cifrar(dados: unknown): Promise<Envelope>;
  decifrar(e: Envelope): Promise<unknown>;
}
