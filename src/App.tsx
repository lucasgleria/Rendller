import { useMemo, useState } from 'react';
import { useDados } from './armazenamento';
import { montarLinhas } from './domain/carteira';
import { hojeISO } from './domain/datas';
import Aportes from './pages/Aportes';
import Instituicoes from './pages/Instituicoes';
import Painel from './pages/Painel';
import Parametros from './pages/Parametros';
import Simulador from './pages/Simulador';

const PAGINAS = ['Painel', 'Aportes', 'Instituições', 'Simulador', 'Parâmetros'] as const;
export type Pagina = (typeof PAGINAS)[number];

function paginaInicial(): Pagina {
  const h = decodeURIComponent(location.hash.slice(1));
  return (PAGINAS as readonly string[]).includes(h) ? (h as Pagina) : 'Painel';
}

export default function App() {
  const { dados, atualizar, substituir, erroGravacao } = useDados();
  const [pagina, setPagina] = useState<Pagina>(paginaInicial);
  const hoje = hojeISO();
  const linhas = useMemo(() => montarLinhas(dados.aportes, hoje, dados.parametros), [dados, hoje]);

  const ir = (p: Pagina) => {
    setPagina(p);
    history.replaceState(null, '', `#${p}`);
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      <header className="topo">
        <div className="topo-inner">
          <div className="marca">
            <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden>
              <rect width="32" height="32" rx="8" fill="var(--accent)" />
              <path d="M8 22l6-6 4 4 6-8" stroke="var(--accent-text)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Rendller <span>controle de CDB</span>
          </div>
          <nav className="nav">
            {PAGINAS.map((p) => (
              <button key={p} aria-current={p === pagina ? 'page' : undefined} onClick={() => ir(p)}>
                {p}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main>
        {erroGravacao && <div className="aviso vermelho">Não consegui salvar neste navegador (modo privado ou armazenamento cheio). Exporte um backup em Parâmetros.</div>}
        {pagina === 'Painel' && <Painel linhas={linhas} parametros={dados.parametros} hoje={hoje} ir={ir} />}
        {pagina === 'Aportes' && <Aportes linhas={linhas} parametros={dados.parametros} hoje={hoje} atualizar={atualizar} />}
        {pagina === 'Instituições' && <Instituicoes linhas={linhas} parametros={dados.parametros} />}
        {pagina === 'Simulador' && <Simulador parametros={dados.parametros} linhas={linhas} hoje={hoje} />}
        {pagina === 'Parâmetros' && <Parametros dados={dados} atualizar={atualizar} substituir={substituir} />}
        <p className="rodape">
          Valores futuros são estimativas com o CDI de projeção configurado e não garantem rentabilidade. Dados salvos apenas neste navegador.
        </p>
      </main>
    </>
  );
}
