import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Pagina } from '../App';
import type { EstadoCdi } from '../cdiOnline';
import { ultimoCdi } from '../domain/cdi';
import { agruparPorInstituicao, contaNoSaldo, resumir, serieProjecao, type Linha } from '../domain/carteira';
import type { Parametros } from '../domain/types';
import { data, mesAno, moeda, moedaCurta, pct } from '../formato';

interface Props {
  linhas: Linha[];
  parametros: Parametros;
  hoje: string;
  ir: (p: Pagina) => void;
  estadoCdi: EstadoCdi;
}

export default function Painel({ linhas, parametros: p, hoje, ir, estadoCdi }: Props) {
  if (!linhas.length) {
    return (
      <div className="card vazio">
        <h2>Nenhum aporte ainda</h2>
        <p>Importe sua planilha controle_cdb_google_sheets ou cadastre o primeiro aporte.</p>
        <div className="acoes" style={{ justifyContent: 'center' }}>
          <button className="btn primario" onClick={() => ir('Parâmetros')}>
            Importar planilha
          </button>
          <button className="btn" onClick={() => ir('Aportes')}>
            Cadastrar aporte
          </button>
        </div>
      </div>
    );
  }

  const r = resumir(linhas, p);
  const grupos = agruparPorInstituicao(linhas, p);
  const serie = serieProjecao(linhas, p, hoje);
  const alertas = linhas.filter((l) => l.alertas.length && l.status !== 'Resgatado');
  const proximos = linhas
    .filter((l) => l.status === 'Ativo')
    .sort((a, b) => (a.aporte.vencimento < b.aporte.vencimento ? -1 : 1))
    .slice(0, 5);
  const [j1, j2] = p.alertaVencimentoDias;
  const semDataCdi = !p.cdiData;
  const cdiReal = ultimoCdi(p.cdiDiario);
  // "hoje" só é estimativa quando algum dia útil decorrido ficou sem CDI realizado (ou o lote é IPCA+)
  const hojeEstimado = linhas.filter(contaNoSaldo).some((l) => l.hoje.diasUteisEstimados > 0);

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Painel da carteira</h1>
          <p className="sub">
            Posição em {data(hoje)} · {cdiReal ? <>CDI realizado até {data(cdiReal.data)} (Banco Central) · </> : null}CDI de projeção {pct(p.cdiAnual)}{' '}
            {p.cdiData ? `(${data(p.cdiData)})` : ''}
          </p>
        </div>
      </div>
      {estadoCdi.erro && <div className="aviso amarelo">{estadoCdi.erro}</div>}
      {semDataCdi && (
        <div className="aviso amarelo">
          O CDI de projeção ({pct(p.cdiAnual)}) está sem data e fonte. Confirme o valor vigente em{' '}
          <a href="#Parâmetros" onClick={() => ir('Parâmetros')}>
            Parâmetros
          </a>
          .
        </div>
      )}

      <div className="grade kpis">
        <Kpi rotulo="Total aportado" valor={moeda(r.aportado)} det={`${r.ativos} aporte${r.ativos === 1 ? '' : 's'} ativo${r.ativos === 1 ? '' : 's'}`} />
        <Kpi rotulo="Saldo bruto hoje" valor={moeda(r.brutoHoje)} det={`Rendimento bruto ${moeda(r.rendimentoBrutoHoje)}`} estimativa={hojeEstimado} />
        <Kpi rotulo="Impostos se resgatar hoje" valor={moeda(r.impostosHoje)} det={hojeEstimado ? 'IR + IOF estimados' : 'IR + IOF calculados com o CDI realizado'} estimativa={hojeEstimado} />
        <Kpi
          rotulo="Saldo líquido hoje"
          valor={moeda(r.liquidoHoje)}
          det={<span>Rendimento líquido {moeda(r.rendimentoLiquidoHoje)}</span>}
          destaque
          estimativa={hojeEstimado}
        />
        <Kpi
          rotulo="Líquido no vencimento"
          valor={moeda(r.liquidoVencimento)}
          det={`Rendimento líquido ${moeda(r.rendimentoLiquidoVencimento)}`}
          estimativa
        />
      </div>

      <div className="grade duas" style={{ marginBottom: 12 }}>
        <div className="card">
          <h2>
            Evolução estimada do saldo líquido <span className="estimativa">estimativa</span>
          </h2>
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <AreaChart data={serie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="data" tickFormatter={mesAno} minTickGap={32} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={moedaCurta} width={70} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                <Tooltip content={<DicaSerie />} />
                <ReferenceLine x={hoje} stroke="var(--muted)" strokeDasharray="4 4" label={{ value: 'hoje', position: 'insideTopRight' }} />
                <Area isAnimationActive={false} type="monotone" dataKey="aportado" name="Aportado" stroke="var(--chart-2)" fill="none" strokeWidth={1.5} strokeDasharray="5 4" />
                <Area isAnimationActive={false} type="monotone" dataKey="liquido" name="Líquido" stroke="var(--chart-1)" fill="url(#g1)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <h2>Liquidez e vencimentos</h2>
          <ul className="lista">
            <li>
              <span>Com liquidez diária</span>
              <b className="num">{moeda(r.liquidoComLiquidezDiaria)}</b>
            </li>
            <li>
              <span>Sem liquidez diária</span>
              <b className="num">{moeda(r.liquidoSemLiquidezDiaria)}</b>
            </li>
            <li>
              <span>Vencendo em {j1} dias</span>
              <b className="num">{moeda(r.vencendoJanela1)}</b>
            </li>
            <li>
              <span>Vencendo em {j2} dias</span>
              <b className="num">{moeda(r.vencendoJanela2)}</b>
            </li>
            <li>
              <span>Próximo vencimento</span>
              <b className="num">{r.proximoVencimento ? data(r.proximoVencimento.aporte.vencimento) : '—'}</b>
            </li>
            <li>
              <span>Ainda no período de IOF</span>
              <b className="num">{r.emIof.length}</b>
            </li>
          </ul>
        </div>
      </div>

      <div className="grade metade">
        <div className="card">
          <h2>Por instituição</h2>
          {grupos.map((g) => (
            <div key={g.nome} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 14 }}>
                <span>
                  <b>{g.nome}</b> <span className="mut">· {pct(g.percentualCarteira, 1)} da carteira</span>
                </span>
                <span className="num">{moeda(g.exposicaoFgc)}</span>
              </div>
              <div className={`barra ${g.alertaFgc === 'acima' ? 'perigo' : g.alertaFgc === 'próximo' ? 'aviso' : ''}`} title="Exposição em relação ao limite do FGC">
                <i style={{ width: `${Math.min(100, (g.exposicaoFgc / p.fgcLimitePorInstituicao) * 100)}%` }} />
              </div>
              <div className="mut" style={{ fontSize: 12 }}>
                {pct(g.exposicaoFgc / p.fgcLimitePorInstituicao, 1)} do limite do FGC ({moeda(p.fgcLimitePorInstituicao)})
              </div>
            </div>
          ))}
        </div>
        <div className="card">
          <h2>Próximos vencimentos</h2>
          <ul className="lista">
            {proximos.map((l) => (
              <li key={l.aporte.id}>
                <span>
                  {l.aporte.produto || l.aporte.emissor}
                  <span className="mut"> · {l.aporte.emissor}</span>
                </span>
                <span className="num">
                  {data(l.aporte.vencimento)} <span className="mut">({l.diasParaVencer} d)</span>
                </span>
              </li>
            ))}
            {!proximos.length && <li className="mut">Nenhum aporte ativo.</li>}
          </ul>
          {alertas.length > 0 && (
            <>
              <h2 style={{ marginTop: 16 }}>Alertas</h2>
              <ul className="lista">
                {alertas.map((l) => (
                  <li key={l.aporte.id}>
                    <span>
                      {l.aporte.produto || l.aporte.emissor} <span className="mut">· {data(l.aporte.dataAporte)}</span>
                    </span>
                    <span className="badges">
                      {l.alertas.map((a) => (
                        <span key={a} className={`badge ${a === 'Dados faltando' || a === 'Concentração FGC' ? 'b-perigo' : 'b-aviso'}`}>
                          {a}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Kpi({ rotulo, valor, det, destaque, estimativa }: { rotulo: string; valor: string; det?: React.ReactNode; destaque?: boolean; estimativa?: boolean }) {
  return (
    <div className={`card kpi${destaque ? ' destaque' : ''}`}>
      <div className="rotulo">
        {rotulo}
        {estimativa && !destaque && <span className="estimativa">est.</span>}
      </div>
      <div className="valor">{valor}</div>
      {det && <div className="det">{det}</div>}
    </div>
  );
}

function DicaSerie({ active, payload }: { active?: boolean; payload?: { payload: { data: string; aportado: number; liquido: number; projetado: boolean } }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="tooltip">
      <b>{data(d.data)}</b> {d.projetado && <span className="estimativa">projeção</span>}
      <div>Líquido: {moeda(d.liquido)}</div>
      <div className="mut">Aportado: {moeda(d.aportado)}</div>
    </div>
  );
}
