import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { agruparPorInstituicao, type Linha } from '../domain/carteira';
import type { Parametros } from '../domain/types';
import { moeda, moedaCurta, pct } from '../formato';

export default function Instituicoes({ linhas, parametros: p }: { linhas: Linha[]; parametros: Parametros }) {
  const grupos = agruparPorInstituicao(linhas, p);
  const total = (f: (g: (typeof grupos)[number]) => number) => grupos.reduce((s, g) => s + f(g), 0);
  const maiorExposicao = Math.max(0, ...grupos.map((g) => g.exposicaoFgc));

  return (
    <>
      <h1>Instituições</h1>
      <p className="sub">
        Agrupado por conglomerado (ou emissor, quando o conglomerado não foi informado). O FGC cobre até {moeda(p.fgcLimitePorInstituicao)} por CPF e por
        conglomerado, contando principal + rendimentos; o limite global é {moeda(p.fgcLimiteGlobal4Anos)} a cada 4 anos.
      </p>

      {grupos.some((g) => g.alertaFgc !== 'ok') && (
        <div className="aviso vermelho">
          {grupos
            .filter((g) => g.alertaFgc !== 'ok')
            .map((g) => `${g.nome}: ${g.alertaFgc === 'acima' ? `excede o FGC em ${moeda(g.excessoFgc)}` : `${pct(g.exposicaoFgc / p.fgcLimitePorInstituicao, 0)} do limite do FGC`}`)
            .join(' · ')}
        </div>
      )}

      {grupos.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h2>Exposição por instituição</h2>
          <div style={{ height: Math.max(160, grupos.length * 44 + 40) }}>
            <ResponsiveContainer>
              <BarChart data={grupos} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" tickFormatter={moedaCurta} tickLine={false} axisLine={false} domain={[0, Math.max(maiorExposicao * 1.1, 1)]} />
                <YAxis type="category" dataKey="nome" width={150} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => moeda(Number(v))} cursor={{ fill: 'var(--surface-2)' }} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 13 }} />
                <Bar isAnimationActive={false} dataKey="aportado" name="Aportado" fill="var(--chart-2)" radius={[0, 4, 4, 0]} barSize={12} />
                <Bar isAnimationActive={false} dataKey="exposicaoFgc" name="Exposição (principal + rendimento)" fill="var(--chart-1)" radius={[0, 4, 4, 0]} barSize={12} />
                {maiorExposicao >= p.fgcLimitePorInstituicao * 0.5 && <ReferenceLine x={p.fgcLimitePorInstituicao} stroke="var(--neg)" strokeDasharray="4 4" label={{ value: 'limite FGC', position: 'top' }} />}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="card">
        <div className="tabela-wrap">
          <table>
            <thead>
              <tr>
                <th>Instituição</th>
                <th className="num">Aportado</th>
                <th className="num">Saldo bruto</th>
                <th className="num">Rend. bruto</th>
                <th className="num">Impostos</th>
                <th className="num">Rend. líquido</th>
                <th className="num">Saldo líquido</th>
                <th className="num">% carteira</th>
                <th className="num">Cobertura FGC</th>
                <th className="num">Excesso</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <tr key={g.nome}>
                  <td>
                    <b>{g.nome}</b>
                    <div className="linha2">
                      {g.aportes} aporte{g.aportes === 1 ? '' : 's'}
                      {g.emissores.length > 1 || (g.emissores[0] && g.emissores[0] !== g.nome) ? ` · ${g.emissores.join(', ')}` : ''}
                    </div>
                  </td>
                  <td className="num">{moeda(g.aportado)}</td>
                  <td className="num">{moeda(g.brutoHoje)}</td>
                  <td className="num">{moeda(g.rendimentoBrutoHoje)}</td>
                  <td className="num">{moeda(g.impostosHoje)}</td>
                  <td className="num pos">{moeda(g.rendimentoLiquidoHoje)}</td>
                  <td className="num">{moeda(g.liquidoHoje)}</td>
                  <td className="num">{pct(g.percentualCarteira, 1)}</td>
                  <td className="num">{moeda(g.coberturaFgc)}</td>
                  <td className={`num ${g.excessoFgc > 0 ? 'neg' : 'mut'}`}>{moeda(g.excessoFgc)}</td>
                </tr>
              ))}
              {!grupos.length && (
                <tr>
                  <td colSpan={10} className="mut" style={{ textAlign: 'center', padding: 32 }}>
                    Nenhum aporte ativo.
                  </td>
                </tr>
              )}
            </tbody>
            {grupos.length > 1 && (
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="num">{moeda(total((g) => g.aportado))}</td>
                  <td className="num">{moeda(total((g) => g.brutoHoje))}</td>
                  <td className="num">{moeda(total((g) => g.rendimentoBrutoHoje))}</td>
                  <td className="num">{moeda(total((g) => g.impostosHoje))}</td>
                  <td className="num">{moeda(total((g) => g.rendimentoLiquidoHoje))}</td>
                  <td className="num">{moeda(total((g) => g.liquidoHoje))}</td>
                  <td className="num">100%</td>
                  <td className="num">{moeda(total((g) => g.coberturaFgc))}</td>
                  <td className="num">{moeda(total((g) => g.excessoFgc))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <p className="mut" style={{ fontSize: 12, marginBottom: 0 }}>
          Valores de hoje são estimativas de resgate na data, com IR e IOF. Confirme se o emissor é associado ao FGC.
        </p>
      </div>
    </>
  );
}
