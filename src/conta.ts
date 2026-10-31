import type { SupabaseClient } from '@supabase/supabase-js';
import { cifrar, decifrar } from './cofre';
import { NuvemIndisponivel, type Cifra, type Remoto, type RespostaRemota } from './remoto';

/**
 * Conta no Supabase (ADR-0002): a conta só identifica; a frase-senha cifra (ADR-0003).
 * O `@supabase/supabase-js` só é baixado quando a conta é usada (`import()` numa promessa única do módulo).
 * Sem `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` no build, nada de conta aparece.
 * A senha da conta nunca é guardada pelo app: a sessão fica com o supabase-js.
 */

const URL_SUPABASE = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const CHAVE_PUBLICAVEL = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export function contaDisponivel(): boolean {
  return !!(URL_SUPABASE && CHAVE_PUBLICAVEL);
}

let cliente: Promise<SupabaseClient> | null = null;

/** Um único cliente por carga do app, criado só na primeira chamada. */
export function clienteSupabase(): Promise<SupabaseClient> {
  if (!contaDisponivel()) return Promise.reject(new Error('A conta não está configurada nesta versão do app.'));
  cliente ??= import('@supabase/supabase-js').then((m) =>
    // implicit: o link de recuperação de senha funciona mesmo aberto em outro aparelho
    m.createClient(URL_SUPABASE!, CHAVE_PUBLICAVEL!, { auth: { flowType: 'implicit', persistSession: true, detectSessionInUrl: true, autoRefreshToken: true } }),
  );
  return cliente;
}

export interface Sessao {
  userId: string;
  email: string;
}

export async function sessaoAtual(): Promise<Sessao | null> {
  if (!contaDisponivel()) return null;
  const { data } = await (await clienteSupabase()).auth.getSession();
  const u = data.session?.user;
  return u ? { userId: u.id, email: u.email ?? '' } : null;
}

function mensagemAuth(e: { message?: string; status?: number } | null): string {
  const m = e?.message ?? '';
  if (/invalid login credentials/i.test(m)) return 'E-mail ou senha da conta incorretos.';
  if (/email not confirmed/i.test(m)) return 'Confirme o e-mail da conta antes de entrar.';
  if (e?.status === 429 || /rate limit/i.test(m)) return 'Muitas tentativas. Espere alguns minutos e tente de novo.';
  if (!e?.status || e.status >= 500) return 'Nuvem indisponível (o projeto pode estar pausado).';
  return m || 'Não consegui entrar na conta.';
}

/** Entra com e-mail e senha da conta (criada pelo próprio usuário no painel do Supabase). */
export async function entrar(email: string, senha: string): Promise<Sessao> {
  const { data, error } = await (await clienteSupabase()).auth.signInWithPassword({ email: email.trim(), password: senha });
  if (error || !data.user) throw new Error(mensagemAuth(error));
  return { userId: data.user.id, email: data.user.email ?? email.trim() };
}

export async function sair(): Promise<void> {
  if (!contaDisponivel()) return;
  await (await clienteSupabase()).auth.signOut({ scope: 'local' });
}

/** Envia o link de "esqueci a senha"; o link volta para `redirectTo` (o próprio site). */
export async function esqueciSenha(email: string, redirectTo: string): Promise<void> {
  const { error } = await (await clienteSupabase()).auth.resetPasswordForEmail(email.trim(), { redirectTo });
  if (error) throw new Error(mensagemAuth(error));
}

/** Define a nova senha da conta depois que o link de recuperação abriu o app (sessão de recuperação ativa). */
export async function definirNovaSenha(senha: string): Promise<void> {
  const { error } = await (await clienteSupabase()).auth.updateUser({ password: senha });
  if (error) throw new Error(mensagemAuth(error));
}

/** O link de recuperação abre o app com `#access_token=…&type=recovery`. */
export function recuperacaoNaUrl(hash: string): boolean {
  return /(^#|&)type=recovery(&|$)/.test(hash);
}

// ---------- cofre da conta ----------

type ErroPostgrest = { message: string; code?: string } | null;

/** O recorte do `SupabaseClient` que o cofre usa; facilita o falso nos testes (`conta.falso.ts`). */
export interface ClienteCofre {
  rpc(
    fn: 'gravar_cofre',
    args: { base: number; p_iv: string; p_cifrado: string },
  ): PromiseLike<{ data: { versao: number; conflito: boolean }[] | null; error: ErroPostgrest; status?: number }>;
  from(t: 'cofres'): {
    select(c: string): {
      maybeSingle(): PromiseLike<{ data: { versao: number; iv: string; cifrado: string; atualizado_em: string } | null; error: ErroPostgrest; status?: number }>;
    };
    delete(): { eq(c: 'user_id', v: string): PromiseLike<{ error: ErroPostgrest; status?: number }> };
  };
}

/** Sem sessão ou sessão expirada: anon sem grant (42501), JWT inválido/expirado (PGRST30x) ou HTTP 401/403. */
function semAcesso(error: ErroPostgrest, status?: number): boolean {
  return status === 401 || status === 403 || error?.code === '42501' || /^PGRST30/.test(error?.code ?? '');
}

/** Projeto pausado, erro 5xx ou sem rede (status 0): a nuvem não respondeu. */
function indisponivel(error: ErroPostgrest, status?: number): boolean {
  return status === undefined || status === 0 || status >= 500 || error?.code === 'PGRST';
}

function falhar(error: ErroPostgrest, status?: number): never {
  if (indisponivel(error, status)) throw new NuvemIndisponivel();
  throw new Error(error?.message || `A nuvem respondeu ${status}.`);
}

/** Lê o cofre da conta. Não depende da chave: roda em paralelo com a derivação dela. */
export async function lerCofreDaConta(c: ClienteCofre): Promise<RespostaRemota> {
  const { data, error, status } = await c.from('cofres').select('versao, iv, cifrado, atualizado_em').maybeSingle();
  if (error) {
    if (semAcesso(error, status)) return { tipo: 'negado' };
    falhar(error, status);
  }
  if (!data) return { tipo: 'inexistente' };
  return { tipo: 'ok', versao: data.versao, envelope: { iv: data.iv, cifrado: data.cifrado }, atualizadoEm: data.atualizado_em };
}

/** O cofre da conta (tabela `cofres`, RLS por `auth.uid()`) como `Remoto & Cifra`. */
export function remotoDaConta(c: ClienteCofre, chave: { id: string; chave: string }): Remoto & Cifra {
  return {
    ler: () => lerCofreDaConta(c),
    async gravar(base, e) {
      const { data, error, status } = await c.rpc('gravar_cofre', { base, p_iv: e.iv, p_cifrado: e.cifrado });
      if (error) {
        if (semAcesso(error, status)) return { tipo: 'negado' };
        falhar(error, status);
      }
      const linha = data?.[0];
      if (!linha) throw new Error('Resposta inesperada da nuvem.');
      return linha.conflito ? { tipo: 'conflito', versao: linha.versao } : { tipo: 'ok', versao: linha.versao };
    },
    async apagar() {
      const { error, status } = await c.from('cofres').delete().eq('user_id', chave.id);
      if (error) {
        if (semAcesso(error, status)) throw new Error('A nuvem recusou apagar o cofre: entre na conta de novo.');
        falhar(error, status);
      }
    },
    cifrar: (dados) => cifrar(chave, dados),
    decifrar: (e) => decifrar(chave, e),
  };
}

/** Há sessão da conta salva neste navegador? Olha só o nome da chave do supabase-js, sem baixar a biblioteca. */
export function temSessaoSalva(): boolean {
  if (!contaDisponivel()) return false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? '';
      if (k.startsWith('sb-') && k.endsWith('-auth-token')) return true;
    }
  } catch {
    /* sem armazenamento */
  }
  return false;
}
