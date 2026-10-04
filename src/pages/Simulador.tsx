import { useEffect, useState } from 'react';
import { CampoData, CampoNumero, CampoSelect, CampoTexto } from '../components/campos';
import { avaliar, validarAporte } from '../domain/calculo';
import { agruparPorInstituicao, mesesEntre, type Linha } from '../domain/carteira';
import { Calendario, somaDias } from '../domain/datas';
import { INDEXADORES, LIQUIDEZES, novoAporte } from '../domain/padroes';
import type { Aporte, Parametros } from '../domain/types';
import { data, moeda, pct } from '../formato';
import { descreverTaxa } from './Aportes';

const CHAVE = 'rendller:simulador:v1';

function opcoesIniciais(hoje: string): Aporte[] {
  try {
    const s = localStorage.getItem(CHAVE);
    if (s) return JSON.parse(s) as Aporte[];
  } catch {
    /* sem armazenamento: começa do zero */
  }
  const base = { valor: 1000, dataAporte: hoje, vencimento: somaDias(hoje, 730) };
  return [
    novoAporte({ ...base, produto: 'Opção A' }),
    novoAporte({ ...base, produto: 'Opção B' }),
    novoAporte({ ...base, produto: 'Opção C' }),
  ];
}

export default function Simulador({ parametros: p, linhas, hoje }: { parametros: Parametros; linhas: Linha[]; hoje: string }) {
  const [opcoes, setOpcoes] = useState<Aporte[]>(() => opcoesIniciais(hoje));
  useEffect(() => {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(opcoes));
    } catch {
      /* ignorado: o simulador funciona sem salvar */
    }
  }, [opcoes]);

  const cal = new Calendario(p.feriados);
  const grupos = agruparPorInstituicao(linhas, p);
  const resultados = opcoes.map((a) => {
    const pend = validarAporte({ ...a, emissor: a.emissor || '-' }, p);
    const r = pend.length ? null : avaliar(a, a.vencimento, p, cal);
    const exposAtual = grupos.find((g) => g.nome === (a.conglomerado || a.emissor).trim())?.exposicaoFgc ?? 0;
    return { a, r, pend, meses: r ? mesesEntre(a.dataAporte, a.vencimento) : 0, exposDepois: exposAtual + a.valor };
  });
  const validos = resultados.filter((x) => x.r && x.r.calculavel);
  const maiorGanho = validos.reduce<(typeof validos)[number] | null>((m, x) => (!m || x.r!.rendimentoLiquido > m.r!.rendimentoLiquido ? x : m), null);
  const melhorTaxa = validos.reduce<(typeof validos)[number] | null>(
    (m, x) => (!m || (x.r!.taxaLiquidaAnual ?? -1) > (m.r!.taxaLiquidaAnual ?? -1) ? x : m),
    null,
  );
  const empate = validos.length > 1 && validos.every((x) => Math.abs(x.r!.rendimentoLiquido - validos[0].r!.rendimentoLiquido) < 0.01);
  const prazosDiferentes = new Set(validos.map((x) => x.a.vencimento)).size > 1;

  const set = (i: number, parcial: Partial<Aporte>) => setOpcoes((os) => os.map((o, j) => (j === i ? { ...o, ...parcial } : o)));

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Simulador</h1>
          <p className="sub">Compare opções antes de aportar. A decisão é pelo valor líquido em reais no período, não pelo percentual do CDI.</p>
        </div>
        <div className="acoes">
          {opcoes.length < 5 && (
            <button
              className="btn"
              onClick={() =>
                setOpcoes((os) => [...os, novoAporte({ valor: 1000, dataAporte: hoje, vencimento: somaDias(hoje, 730), produto: `Opção ${String.fromCharCode(65 + os.length)}` })])
              }
            >
              Adicionar opção
            </button>
          )}
        </div>
      </div>

      <div className="sim-grade">
        {opcoes.map((a, i) => (
          <div key={a.id} className={`card${maiorGanho?.a.id === a.id ? ' melhor' : ''}`}>
            <div className="acoes" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <input value={a.produto} onChange={(e) => set(i, { produto: e.target.value })} style={{ fontWeight: 650, maxWidth: 160 }} aria-label="Nome da opção" />
              {opcoes.length > 2 && (
                <button className="btn pequeno" onClick={() => setOpcoes((os) => os.filter((_, j) => j !== i))}>
                  Remover
                </button>
              )}
            </div>
            <div className="campos" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <CampoTexto rotulo="Emissor" valor={a.emissor} onChange={(x) => set(i, { emissor: x })} />
              <CampoNumero rotulo="Valor (R$)" valor={a.valor || null} onChange={(x) => set(i, { valor: x ?? 0 })} />
              <CampoData rotulo="Data do aporte" valor={a.dataAporte} onChange={(x) => set(i, { dataAporte: x })} />
              <CampoData rotulo="Vencimento" valor={a.vencimento} onChange={(x) => set(i, { vencimento: x })} />
              <CampoSelect rotulo="Indexador" valor={a.indexador} opcoes={INDEXADORES} onChange={(x) => set(i, { indexador: x })} />
              {a.indexador === 'CDI' && <CampoNumero rotulo="% do CDI" sufixo="%" escala={100} valor={a.pctCdi} onChange={(x) => set(i, { pctCdi: x ?? 0 })} />}
              {a.indexador === 'PRE' && <CampoNumero rotulo="Taxa a.a." sufixo="%" escala={100} valor={a.taxaPre} onChange={(x) => set(i, { taxaPre: x })} />}
              {a.indexador === 'IPCA' && <CampoNumero rotulo="IPCA +" sufixo="%" escala={100} valor={a.spreadIpca} onChange={(x) => set(i, { spreadIpca: x })} />}
              {a.indexador === 'CDI' && (
                <>
                  <CampoNumero rotulo="% promocional" sufixo="%" escala={100} valor={a.pctCdiPromo} onChange={(x) => set(i, { pctCdiPromo: x })} />
                  <CampoNumero rotulo="Dias de promoção" casas={0} valor={a.diasPromo || null} onChange={(x) => set(i, { diasPromo: x ?? 0 })} />
                </>
              )}
              <CampoSelect rotulo="Liquidez" valor={a.liquidez} opcoes={LIQUIDEZES} onChange={(x) => set(i, { liquidez: x })} />
              <CampoData rotulo="Carência até" valor={a.carenciaAte} onChange={(x) => set(i, { carenciaAte: x })} />
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>
          Resultado no vencimento <span className="estimativa">estimativa · CDI {pct(p.cdiAnual)}</span>
        </h2>
        <div className="tabela-wrap">
          <table>
            <thead>
              <tr>
                <th></th>
                {resultados.map((x) => (
                  <th key={x.a.id} className="num">
                    {x.a.produto}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <Linha rotulo="Emissor" vals={resultados.map((x) => x.a.emissor || '—')} />
              <Linha rotulo="Aporte" vals={resultados.map((x) => moeda(x.a.valor))} />
              <Linha rotulo="Taxa" vals={resultados.map((x) => descreverTaxa(x.a))} />
              <Linha rotulo="Prazo" vals={resultados.map((x) => (x.r ? `${x.r.diasCorridos} d corridos · ${x.r.diasUteis} úteis` : '—'))} />
              <Linha rotulo="Vencimento" vals={resultados.map((x) => data(x.a.vencimento))} />
              <Linha rotulo="Rendimento bruto" vals={resultados.map((x) => (x.r ? moeda(x.r.rendimentoBruto) : '—'))} />
              <Linha rotulo="IOF" vals={resultados.map((x) => (x.r ? moeda(x.r.iof) : '—'))} />
              <Linha rotulo="IR" vals={resultados.map((x) => (x.r ? `${moeda(x.r.ir)} (${pct(x.r.aliquotaIr, 1)})` : '—'))} />
              <Linha rotulo="Rendimento líquido" vals={resultados.map((x) => (x.r ? moeda(x.r.rendimentoLiquido) : '—'))} forte />
              <Linha rotulo="Valor final líquido" vals={resultados.map((x) => (x.r ? moeda(x.r.liquido) : '—'))} forte />
              <Linha rotulo="Retorno líquido no período" vals={resultados.map((x) => (x.r ? pct(x.r.rentabilidadeLiquida) : '—'))} />
              <Linha rotulo="Ganho líquido por mês" vals={resultados.map((x) => (x.r && x.meses > 0 ? moeda(x.r.rendimentoLiquido / x.meses) : '—'))} />
              <Linha rotulo="Taxa líquida anualizada" vals={resultados.map((x) => (x.r ? pct(x.r.taxaLiquidaAnual) : '—'))} forte />
              <Linha rotulo="Liquidez" vals={resultados.map((x) => x.a.liquidez + (x.a.carenciaAte ? ` · carência até ${data(x.a.carenciaAte)}` : ''))} />
              <Linha
                rotulo="Exposição no emissor depois"
                vals={resultados.map((x) => (x.a.emissor ? `${moeda(x.exposDepois)} (${pct(x.exposDepois / p.fgcLimitePorInstituicao, 0)} do FGC)` : '—'))}
              />
              <Linha rotulo="Pendências" vals={resultados.map((x) => (x.pend.length ? x.pend.join(', ') : x.r && !x.r.calculavel ? 'Informe o IPCA projetado' : '—'))} />
            </tbody>
          </table>
        </div>
        {maiorGanho && melhorTaxa && empate && (
          <div className="aviso azul" style={{ marginTop: 12, marginBottom: 0 }}>
            As opções empatam no valor líquido. Desempate por liquidez, prazo adequado ao objetivo, concentração por instituição e clareza das condições.
          </div>
        )}
        {maiorGanho && melhorTaxa && !empate && (
          <div className="aviso azul" style={{ marginTop: 12, marginBottom: 0 }}>
            Maior ganho absoluto: <b>{maiorGanho.a.produto}</b> ({moeda(maiorGanho.r!.rendimentoLiquido)} líquidos). Melhor retorno proporcional:{' '}
            <b>{melhorTaxa.a.produto}</b> ({pct(melhorTaxa.r!.taxaLiquidaAnual)} a.a. líquidos).
            {prazosDiferentes &&
              ' Os vencimentos são diferentes: o ganho absoluto favorece o prazo mais longo, e reinvestir depois de um vencimento antecipado é hipótese, não taxa garantida.'}{' '}
            Considere também liquidez, prazo adequado ao objetivo e concentração por instituição.
          </div>
        )}
      </div>
    </>
  );
}

function Linha({ rotulo, vals, forte }: { rotulo: string; vals: string[]; forte?: boolean }) {
  return (
    <tr>
      <td className="mut">{rotulo}</td>
      {vals.map((v, i) => (
        <td key={i} className="num" style={forte ? { fontWeight: 650 } : undefined}>
          {v}
        </td>
      ))}
    </tr>
  );
}
