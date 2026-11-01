import { useEffect, useState } from 'react';
import { TAMANHO_MINIMO_FRASE } from '../cofre';
import { sessaoAtual, temSessaoSalva, type Sessao } from '../conta';
import type { Candidato, OrigemDados } from '../domain/migracao';
import { AVISO_COFRE_ANTIGO_PASSAGEIRO, type Contagens, type ResultadoMigracao } from '../migracaoConta';
import type { Sincronizacao } from '../sincronizacao';
import { AVISO_MIGRAR_TODOS } from '../sincronizacaoNucleo';
import { DOIS_SEGREDOS, EntrarNaConta } from './ContaForms';

const ROTULO_ORIGEM: Record<OrigemDados, string> = { navegador: 'Este navegador', 'cofre-antigo': 'Cofre antigo', conta: 'Conta' };
const aportes = (n: number) => `${n} aporte${n === 1 ? '' : 's'}`;

/** Resumo depois da migração: aportes por origem e o arquivo de backup (ternário, nunca `&&` com número). */
export function ResumoMigracao({ contagens, backup, avisos }: { contagens: Contagens | null; backup: string | null; avisos: string[] }) {
  const partes = contagens
    ? (Object.keys(ROTULO_ORIGEM) as OrigemDados[]).map((o) => (contagens[o] === null ? null : `${ROTULO_ORIGEM[o]}: ${aportes(contagens[o] as number)}`)).filter(Boolean)
    : [];
  return (
    <div className="aviso azul">
      Migração para a conta concluída.{partes.length > 0 ? ` ${partes.join(' · ')}.` : ''}
      {backup ? ` Backup salvo como ${backup}.` : ''}
      {avisos.length > 0 ? avisos.map((a) => <div key={a}>{a}</div>) : null}
    </div>
  );
}

/**
 * "Entrar com conta": e-mail e senha, depois a frase-senha, e então a migração (navegador, cofre antigo e conta).
 * O clique em "Sincronizar com a conta" chama a migração direto: o backup é baixado antes de qualquer rede.
 */
export function SecaoConta({
  s,
  aoConcluir,
  repetir = false,
}: {
  s: Sincronizacao;
  aoConcluir: (r: Extract<ResultadoMigracao, { tipo: 'concluida' }>) => void;
  /** Conta já ativa e cofre antigo não lido (erro passageiro): só oferece ler o cofre antigo de novo. */
  repetir?: boolean;
}) {
  const { sync } = s;
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [frase, setFrase] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [escolha, setEscolha] = useState<Extract<ResultadoMigracao, { tipo: 'escolha-pendente' }> | null>(null);

  // sessão já salva neste navegador: pula o e-mail e a senha (só carrega o Supabase se houver)
  useEffect(() => {
    if (!temSessaoSalva()) return;
    let vivo = true;
    sessaoAtual()
      .then((x) => vivo && setSessao(x))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, []);

  const tratar = (r: ResultadoMigracao) => {
    if (r.tipo === 'falhou') setAviso(r.erro);
    else if (r.tipo === 'escolha-pendente') setEscolha(r);
    else {
      setFrase('');
      setEscolha(null);
      aoConcluir(r);
    }
  };

  const migrar = () => {
    setAviso(null);
    setOcupado(true);
    // síncrono até o backup; o resto segue em segundo plano
    s.migrarConta(frase)
      .then(tratar)
      .finally(() => setOcupado(false));
  };

  const lerDeNovo = () => {
    setAviso(null);
    setOcupado(true);
    s.repetirMigracao()
      .then(tratar)
      .finally(() => setOcupado(false));
  };

  const escolher = (c: Candidato) => {
    setOcupado(true);
    s.concluirEscolhaConta(c)
      .then((r) => tratar(r.tipo === 'concluida' ? { ...r, backup: escolha?.backup ?? null, contagens: escolha?.contagens ?? null } : r))
      .finally(() => setOcupado(false));
  };

  if (repetir && !escolha) {
    return (
      <div style={{ marginBottom: 16 }}>
        <div className="aviso amarelo">{AVISO_COFRE_ANTIGO_PASSAGEIRO}.</div>
        {aviso ? <div className="aviso vermelho">{aviso}</div> : null}
        <button className="btn" disabled={ocupado} onClick={lerDeNovo}>
          {ocupado ? 'Lendo…' : 'Ler o cofre antigo de novo'}
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ margin: '4px 0' }}>Entrar com conta</h3>
      <p className="mut" style={{ fontSize: 13, marginTop: 0 }}>
        {DOIS_SEGREDOS}
      </p>
      {sync.cofreAntigoAtivo ? <div className="aviso amarelo">{AVISO_MIGRAR_TODOS}</div> : null}
      {aviso ? <div className="aviso vermelho">{aviso}</div> : null}

      {escolha ? (
        <>
          <div className="aviso amarelo">
            Há versões diferentes dos seus dados. Escolha qual fica na conta e neste aparelho; as outras não são misturadas, e a substituída fica guardada como
            cópia local. Backup salvo como {escolha.backup}.
          </div>
          <div className="acoes">
            {escolha.candidatos.map((c) => (
              <button key={c.origem} className="btn" disabled={ocupado} onClick={() => escolher(c)}>
                Usar: {ROTULO_ORIGEM[c.origem]} ({aportes(c.aportes)})
              </button>
            ))}
          </div>
        </>
      ) : sessao ? (
        <>
          <p style={{ margin: '4px 0 8px' }}>
            Conta: <b>{sessao.email}</b>. Agora a frase-senha que cifra a carteira:
          </p>
          <div className="campos">
            <label className="campo largo">
              <span>Frase-senha (mínimo {TAMANHO_MINIMO_FRASE} caracteres; prefira 4 ou mais palavras)</span>
              <input
                type="password"
                autoComplete="off"
                value={frase}
                onChange={(e) => setFrase(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !ocupado && frase.trim().length >= TAMANHO_MINIMO_FRASE && migrar()}
              />
            </label>
          </div>
          <p className="mut" style={{ fontSize: 13 }}>
            Ao continuar, o app baixa um backup (.json) deste navegador e junta estes dados{sync.cofreAntigoAtivo ? ', os do cofre antigo' : ''} e os da conta, sem
            apagar nada.
          </p>
          <div className="acoes" style={{ marginTop: 8 }}>
            <button className="btn primario" disabled={ocupado || frase.trim().length < TAMANHO_MINIMO_FRASE} onClick={migrar}>
              {ocupado ? 'Migrando…' : 'Sincronizar com a conta'}
            </button>
          </div>
        </>
      ) : (
        <EntrarNaConta aoEntrar={setSessao} />
      )}
    </div>
  );
}
