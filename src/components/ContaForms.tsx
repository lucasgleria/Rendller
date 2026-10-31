import { useState } from 'react';
import { definirNovaSenha, entrar, esqueciSenha, MENSAGEM_LINK_VENCIDO, MENSAGEM_RECUPERACAO_SEM_REDE, sair, type Sessao } from '../conta';

/** Frase curta mostrada sempre que a conta aparece: dois segredos diferentes. */
export const DOIS_SEGREDOS =
  'A senha da conta só serve para entrar e pode ser recuperada por e-mail; a frase-senha cifra os dados, nunca sai deste aparelho e não tem recuperação.';

const siteAtual = () => `${location.origin}${location.pathname}`;

/** Passo 1: e-mail e senha da conta (a senha não é guardada pelo app). */
export function EntrarNaConta({
  emailInicial = '',
  aoEntrar,
  rotulo = 'Entrar',
  conferir,
}: {
  emailInicial?: string;
  aoEntrar: (s: Sessao) => void;
  rotulo?: string;
  /** "Entrar de novo": devolve a mensagem de recusa se a conta (e-mail ou usuário) não for a ativada. */
  conferir?: (s: { userId?: string; email: string }) => string | null;
}) {
  const [email, setEmail] = useState(emailInicial);
  const [senha, setSenha] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'azul' | 'vermelho'; texto: string } | null>(null);

  const enviar = async () => {
    setAviso(null);
    const antes = conferir?.({ email });
    if (antes) return setAviso({ tipo: 'vermelho', texto: antes });
    setOcupado(true);
    try {
      const s = await entrar(email, senha);
      setSenha('');
      const depois = conferir?.(s);
      if (depois) {
        await sair(); // não deixa a sessão da outra conta aberta
        return setAviso({ tipo: 'vermelho', texto: depois });
      }
      aoEntrar(s);
    } catch (e) {
      setAviso({ tipo: 'vermelho', texto: (e as Error).message });
    } finally {
      setOcupado(false);
    }
  };

  const esqueci = async () => {
    if (!email.trim()) return setAviso({ tipo: 'vermelho', texto: 'Digite o e-mail da conta para receber o link.' });
    setOcupado(true);
    try {
      await esqueciSenha(email, siteAtual());
      setAviso({ tipo: 'azul', texto: 'Se o e-mail for de uma conta, chega um link para criar uma nova senha. Abra o link neste navegador ou em outro.' });
    } catch (e) {
      setAviso({ tipo: 'vermelho', texto: (e as Error).message });
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      {aviso && <div className={`aviso ${aviso.tipo}`}>{aviso.texto}</div>}
      <div className="campos">
        <label className="campo">
          <span>E-mail da conta</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="campo">
          <span>Senha da conta</span>
          <input
            type="password"
            autoComplete="current-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && email && senha && void enviar()}
          />
        </label>
      </div>
      <div className="acoes" style={{ marginTop: 8 }}>
        <button className="btn primario" disabled={ocupado || !email.trim() || !senha} onClick={() => void enviar()}>
          {ocupado ? 'Entrando…' : rotulo}
        </button>
        <button className="btn" disabled={ocupado} onClick={() => void esqueci()}>
          Esqueci a senha da conta
        </button>
      </div>
    </>
  );
}

/** Aberta pelo link de recuperação: define a nova senha da conta. Não mexe na frase-senha nem nos dados. */
export function NovaSenhaConta({ aoTerminar, estado }: { aoTerminar: () => void; estado: 'verificando' | 'pronto' | 'erro' | 'sem-rede' }) {
  const [senha, setSenha] = useState('');
  const [repetida, setRepetida] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'azul' | 'vermelho'; texto: string } | null>(null);

  const salvar = async () => {
    setOcupado(true);
    setAviso(null);
    try {
      await definirNovaSenha(senha);
      setSenha('');
      setRepetida('');
      setAviso({ tipo: 'azul', texto: 'Senha da conta alterada.' });
      setTimeout(aoTerminar, 1500);
    } catch (e) {
      setAviso({ tipo: 'vermelho', texto: (e as Error).message });
    } finally {
      setOcupado(false);
    }
  };

  if (estado !== 'pronto') {
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <h2>Nova senha da conta</h2>
        {estado === 'verificando' ? (
          <p className="mut">Conferindo o link de recuperação…</p>
        ) : (
          <>
            <div className={`aviso ${estado === 'sem-rede' ? 'amarelo' : 'vermelho'}`}>{estado === 'sem-rede' ? MENSAGEM_RECUPERACAO_SEM_REDE : MENSAGEM_LINK_VENCIDO}</div>
            <button className="btn" onClick={aoTerminar}>
              Fechar
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <h2>Nova senha da conta</h2>
      <p className="mut" style={{ fontSize: 13, marginTop: 0 }}>
        {DOIS_SEGREDOS}
      </p>
      {aviso && <div className={`aviso ${aviso.tipo}`}>{aviso.texto}</div>}
      <div className="campos">
        <label className="campo">
          <span>Nova senha da conta</span>
          <input type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
        </label>
        <label className="campo">
          <span>Repita a nova senha</span>
          <input type="password" autoComplete="new-password" value={repetida} onChange={(e) => setRepetida(e.target.value)} />
        </label>
      </div>
      <div className="acoes" style={{ marginTop: 8 }}>
        <button className="btn primario" disabled={ocupado || senha.length < 8 || senha !== repetida} onClick={() => void salvar()}>
          Salvar nova senha
        </button>
        <button className="btn" onClick={aoTerminar}>
          Agora não
        </button>
      </div>
    </div>
  );
}
