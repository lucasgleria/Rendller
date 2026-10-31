import type { ClienteCofre } from './conta';

/**
 * `ClienteCofre` falso em memória, só para testes. Reproduz a semântica de
 * `supabase/migrations/20261101000000_cofres.sql`:
 * - `gravar_cofre` com base 0 faz insert com `on conflict do nothing`; com base > 0, update só onde `versao = base`;
 *   se nada mudou, devolve a versão atual (0 sem linha) com `conflito = true`;
 * - RLS por `auth.uid()`: cada sessão só lê e apaga a própria linha;
 * - sem sessão (papel `anon`, sem grant): erro 42501 com HTTP 401.
 */
export interface Linha {
  versao: number;
  iv: string;
  cifrado: string;
  atualizado_em: string;
}

export class BancoFalso {
  linhas = new Map<string, Linha>();
  /** Toda chamada feita ao cliente, com os argumentos (para conferir o que sai do navegador). */
  chamadas: { metodo: string; args: unknown[] }[] = [];
  rpcs = () => this.chamadas.filter((c) => c.metodo === 'rpc').length;
}

type Erro = { message: string; code?: string };
const SEM_SESSAO = { error: { message: 'permission denied for table cofres', code: '42501' } as Erro, status: 401 };

export function clienteFalso(banco: BancoFalso, sessao: () => string | null, falha?: { status: number; error: Erro }): ClienteCofre {
  const registrar = (metodo: string, ...args: unknown[]) => banco.chamadas.push({ metodo, args: JSON.parse(JSON.stringify(args)) });
  return {
    async rpc(fn, args) {
      registrar('rpc', fn, args);
      if (falha) return { data: null, ...falha };
      const uid = sessao();
      if (!uid) return { data: null, ...SEM_SESSAO };
      if (args.p_cifrado.length > 4_000_000) return { data: null, error: { message: 'check constraint', code: '23514' }, status: 400 };
      const atual = banco.linhas.get(uid);
      const agora = new Date().toISOString();
      if (args.base === 0) {
        if (atual) return { data: [{ versao: atual.versao, conflito: true }], error: null, status: 200 }; // on conflict do nothing
        banco.linhas.set(uid, { versao: 1, iv: args.p_iv, cifrado: args.p_cifrado, atualizado_em: agora });
        return { data: [{ versao: 1, conflito: false }], error: null, status: 200 };
      }
      if (atual && atual.versao === args.base) {
        banco.linhas.set(uid, { versao: args.base + 1, iv: args.p_iv, cifrado: args.p_cifrado, atualizado_em: agora });
        return { data: [{ versao: args.base + 1, conflito: false }], error: null, status: 200 };
      }
      return { data: [{ versao: atual?.versao ?? 0, conflito: true }], error: null, status: 200 };
    },
    from(tabela) {
      return {
        select(colunas) {
          return {
            async maybeSingle() {
              registrar('select', tabela, colunas);
              if (falha) return { data: null, ...falha };
              const uid = sessao();
              if (!uid) return { data: null, ...SEM_SESSAO };
              const l = banco.linhas.get(uid); // a RLS deixa ver só a própria linha
              return { data: l ? { ...l } : null, error: null, status: l ? 200 : 406 };
            },
          };
        },
        delete() {
          return {
            async eq(coluna, valor) {
              registrar('delete', tabela, coluna, valor);
              if (falha) return { ...falha };
              const uid = sessao();
              if (!uid) return { ...SEM_SESSAO };
              if (valor === uid) banco.linhas.delete(uid); // linha de outra conta: a RLS não deixa apagar
              return { error: null, status: 204 };
            },
          };
        },
      };
    },
  };
}

/** Id de conta aleatório (uuid). */
export const novoUid = () => crypto.randomUUID();
