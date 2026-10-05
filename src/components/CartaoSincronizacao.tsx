import { useState } from 'react';
import { TAMANHO_MINIMO_FRASE } from '../cofre';
import type { Dados } from '../domain/types';
import { data } from '../formato';
import type { Preparacao, Sincronizacao, StatusSync } from '../sincronizacao';

const ROTULO: Record<StatusSync, string> = {
  desligado: 'Desligada',
  sincronizando: 'Sincronizando…',
  sincronizado: 'Sincronizado',
  pendente: 'Alterações a enviar',
  offline: 'Sem conexão',
  conflito: 'Conflito: escolha uma versão',
  erro: 'Erro',
};

export function rotuloSync(s: StatusSync) {
  return ROTULO[s];
}

function quando(iso: string | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${data(iso.slice(0, 10))} às ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const aportes = (n: number) => `${n} aporte${n === 1 ? '' : 's'}`;

export default function CartaoSincronizacao({ s, dados }: { s: Sincronizacao; dados: Dados }) {
  const { sync } = s;
  const [frase, setFrase] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [prep, setPrep] = useState<Preparacao | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const limpar = () => {
    setFrase('');
    setConfirmacao('');
    setPrep(null);
  };

  const continuar = async () => {
    setAviso(null);
    setOcupado(true);
    try {
      const p = await s.preparar(frase);
      // nuvem vazia de verdade ou nada local a perder: segue direto
      if (p.tipo === 'existente' && dados.aportes.length === 0) {
        if (await s.concluir(p, 'nuvem')) limpar();
      } else setPrep(p);
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const concluir = async (escolha: 'nuvem' | 'local') => {
    if (!prep) return;
    setOcupado(true);
    if (await s.concluir(prep, escolha)) limpar();
    setOcupado(false);
  };

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <h2>Sincronização entre aparelhos</h2>
      <p className="mut" style={{ fontSize: 13, marginTop: 0 }}>
        Seus dados são criptografados neste navegador com uma frase-senha antes de ir para a nuvem; o servidor guarda só o conteúdo ilegível. Em outro
        aparelho, digite a mesma frase. <b>Se esquecer a frase, não há como recuperar os dados da nuvem</b>: mantenha um backup (.json).
      </p>

      {sync.erro && <div className={`aviso ${sync.status === 'offline' ? 'amarelo' : 'vermelho'}`}>{sync.erro}</div>}
      {aviso && <div className="aviso vermelho">{aviso}</div>}

      {sync.ativo ? (
        <>
          <p style={{ margin: '4px 0 10px' }}>
            Estado: <b>{rotuloSync(sync.status)}</b>
            {sync.ultimaSync && <span className="mut"> · última sincronização em {quando(sync.ultimaSync)}</span>}
          </p>
          {sync.conflito && (
            <div className="aviso amarelo">
              Este aparelho e a nuvem foram alterados ao mesmo tempo. Nuvem: {aportes(sync.conflito.remoto.aportes.length)}
              {sync.conflito.atualizadoEm ? `, gravada em ${quando(sync.conflito.atualizadoEm)}` : ''}. Este aparelho: {aportes(dados.aportes.length)}.
              <div className="acoes" style={{ marginTop: 8 }}>
                <button className="btn" onClick={() => void s.resolverConflito('nuvem')}>
                  Usar a versão da nuvem
                </button>
                <button className="btn" onClick={() => void s.resolverConflito('local')}>
                  Manter a deste aparelho
                </button>
              </div>
              <div className="mut" style={{ fontSize: 13, marginTop: 6 }}>
                A versão descartada deste aparelho fica guardada como cópia local.
              </div>
            </div>
          )}
          <div className="acoes">
            <button className="btn" disabled={sync.status === 'sincronizando'} onClick={() => void s.sincronizar()}>
              Sincronizar agora
            </button>
            <button className="btn" onClick={() => confirm('Parar de sincronizar neste aparelho? Os dados continuam aqui e na nuvem.') && s.desativar()}>
              Desativar neste aparelho
            </button>
            <button
              className="btn perigo"
              onClick={() =>
                confirm('Apagar os dados da nuvem? Os outros aparelhos deixam de sincronizar. Os dados deste aparelho continuam aqui.') &&
                void s.apagarDaNuvem()
              }
            >
              Apagar dados da nuvem
            </button>
          </div>
        </>
      ) : prep ? (
        prep.tipo === 'novo' ? (
          <>
            <div className="aviso amarelo">
              Não existe nada na nuvem com essa frase-senha. Se você já ativou em outro aparelho, a frase digitada está diferente: volte e confira.
            </div>
            <p>Para criar um cofre novo com os dados deste aparelho ({aportes(dados.aportes.length)}), digite a frase de novo:</p>
            <div className="campos">
              <label className="campo largo">
                <span>Repita a frase-senha</span>
                <input type="password" autoComplete="new-password" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} />
              </label>
            </div>
            <div className="acoes" style={{ marginTop: 8 }}>
              <button className="btn primario" disabled={ocupado || confirmacao !== frase} onClick={() => void concluir('local')}>
                Criar cofre e enviar
              </button>
              <button className="btn" onClick={limpar}>
                Voltar
              </button>
              {confirmacao && confirmacao !== frase && <span className="mut" style={{ alignSelf: 'center', fontSize: 13 }}>As frases não coincidem.</span>}
            </div>
          </>
        ) : (
          <>
            <div className="aviso azul">
              Encontrei seus dados na nuvem: {aportes(prep.remoto.aportes.length)}
              {prep.atualizadoEm ? `, gravados em ${quando(prep.atualizadoEm)}` : ''}. Este aparelho tem {aportes(dados.aportes.length)}. Qual versão fica?
            </div>
            <div className="acoes">
              <button className="btn primario" disabled={ocupado} onClick={() => void concluir('nuvem')}>
                Usar os dados da nuvem
              </button>
              <button
                className="btn"
                disabled={ocupado}
                onClick={() => confirm('Substituir os dados da nuvem pelos deste aparelho? Os outros aparelhos vão receber esta versão.') && void concluir('local')}
              >
                Enviar os deste aparelho
              </button>
              <button className="btn" onClick={limpar}>
                Cancelar
              </button>
            </div>
          </>
        )
      ) : (
        <>
          <div className="campos">
            <label className="campo largo">
              <span>Frase-senha (mínimo {TAMANHO_MINIMO_FRASE} caracteres; prefira 4 ou mais palavras)</span>
              <input
                type="password"
                autoComplete="current-password"
                value={frase}
                onChange={(e) => setFrase(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && frase.trim().length >= TAMANHO_MINIMO_FRASE && void continuar()}
              />
            </label>
          </div>
          <div className="acoes" style={{ marginTop: 8 }}>
            <button className="btn primario" disabled={ocupado || frase.trim().length < TAMANHO_MINIMO_FRASE} onClick={() => void continuar()}>
              {ocupado ? 'Protegendo a chave…' : 'Ativar sincronização'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
