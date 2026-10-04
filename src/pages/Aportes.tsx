import { useState } from 'react';
import { CampoCheck, CampoData, CampoNumero, CampoSelect, CampoTexto } from '../components/campos';
import { avaliar, validarAporte } from '../domain/calculo';
import type { Linha } from '../domain/carteira';
import { Calendario } from '../domain/datas';
import { INDEXADORES, LIQUIDEZES, STATUS_MANUAIS, TIPOS, novoAporte } from '../domain/padroes';
import type { Aporte, Dados, Parametros, Status } from '../domain/types';
import { data, moeda, pct } from '../formato';

interface Props {
  linhas: Linha[];
  parametros: Parametros;
  hoje: string;
  atualizar: (f: (d: Dados) => Dados) => void;
}

const FILTROS = ['Todos', 'Ativo', 'Vencido', 'Planejado', 'Resgatado'] as const;

export function classeStatus(s: Status) {
  return s === 'Ativo' ? 'b-ok' : s === 'Vencido' ? 'b-aviso' : s === 'Planejado' ? 'b-info' : '';
}

export function descreverTaxa(a: Aporte): string {
  if (a.indexador === 'PRE') return a.taxaPre == null ? '—' : `${pct(a.taxaPre)} a.a.`;
  if (a.indexador === 'IPCA') return a.spreadIpca == null ? '—' : `IPCA + ${pct(a.spreadIpca)}`;
  const base = `${pct(a.pctCdi, a.pctCdi * 100 % 1 ? 1 : 0)} CDI`;
  return a.pctCdiPromo != null && a.diasPromo > 0 ? `${pct(a.pctCdiPromo, 0)} por ${a.diasPromo} d → ${base}` : base;
}

export default function Aportes({ linhas, parametros, hoje, atualizar }: Props) {
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]>('Todos');
  const [editando, setEditando] = useState<Aporte | null>(null);
  const visiveis = linhas
    .filter((l) => filtro === 'Todos' || l.status === filtro)
    .sort((a, b) => (a.aporte.dataAporte < b.aporte.dataAporte ? 1 : -1));

  const salvar = (a: Aporte) => {
    atualizar((d) => {
      const existe = d.aportes.some((x) => x.id === a.id);
      return { ...d, aportes: existe ? d.aportes.map((x) => (x.id === a.id ? a : x)) : [...d.aportes, a] };
    });
    setEditando(null);
  };
  const excluir = (a: Aporte) => {
    if (!confirm('Excluir este aporte? Para registrar uma saída, prefira marcar como Resgatado: assim o histórico fica preservado.')) return;
    atualizar((d) => ({ ...d, aportes: d.aportes.filter((x) => x.id !== a.id) }));
    setEditando(null);
  };

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Aportes</h1>
          <p className="sub">Cada aporte é um lote independente, com data, taxa, vencimento e impostos próprios.</p>
        </div>
        <button className="btn primario" onClick={() => setEditando(novoAporte({ dataAporte: hoje }))}>
          Novo aporte
        </button>
      </div>

      <div className="acoes" style={{ marginBottom: 12 }}>
        {FILTROS.map((f) => (
          <button key={f} className={`btn pequeno${f === filtro ? ' primario' : ''}`} onClick={() => setFiltro(f)}>
            {f} ({f === 'Todos' ? linhas.length : linhas.filter((l) => l.status === f).length})
          </button>
        ))}
      </div>

      <div className="card">
        <div className="tabela-wrap">
          <table>
            <thead>
              <tr>
                <th>Aporte</th>
                <th>Emissor</th>
                <th>Taxa</th>
                <th className="num">Valor</th>
                <th className="num">Líquido hoje</th>
                <th className="num">Líquido no venc.</th>
                <th>Vencimento</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => (
                <tr key={l.aporte.id} className="clicavel" onClick={() => setEditando(l.aporte)}>
                  <td>
                    {data(l.aporte.dataAporte)}
                    <div className="linha2">{l.aporte.produto || l.aporte.tipo}</div>
                  </td>
                  <td>
                    {l.aporte.emissor || '—'}
                    {l.aporte.instituicao && l.aporte.instituicao !== l.aporte.emissor && <div className="linha2">via {l.aporte.instituicao}</div>}
                  </td>
                  <td>
                    {descreverTaxa(l.aporte)}
                    <div className="linha2">{l.aporte.liquidez}</div>
                  </td>
                  <td className="num">{moeda(l.aporte.valor)}</td>
                  <td className="num">
                    {l.status === 'Resgatado' && l.aporte.resgate ? moeda(l.aporte.resgate.valorLiquido) : moeda(l.hoje.liquido)}
                    <div className="linha2 pos">{l.status === 'Resgatado' ? 'recebido' : `+${moeda(l.hoje.rendimentoLiquido)}`}</div>
                  </td>
                  <td className="num">
                    {moeda(l.vencimento.liquido)}
                    <div className="linha2">{pct(l.vencimento.taxaLiquidaAnual)} a.a. líq.</div>
                  </td>
                  <td>
                    {data(l.aporte.vencimento)}
                    <div className="linha2">{l.status === 'Ativo' ? `${l.diasParaVencer} dias` : ''}</div>
                  </td>
                  <td>
                    <div className="badges">
                      <span className={`badge ${classeStatus(l.status)}`}>{l.status}</span>
                      {l.alertas.map((a) => (
                        <span key={a} className={`badge ${a === 'Dados faltando' || a === 'Concentração FGC' ? 'b-perigo' : 'b-aviso'}`}>
                          {a}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {!visiveis.length && (
                <tr>
                  <td colSpan={8} className="mut" style={{ textAlign: 'center', padding: 32 }}>
                    Nenhum aporte neste filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editando && (
        <Editor
          key={editando.id}
          inicial={editando}
          novo={!linhas.some((l) => l.aporte.id === editando.id)}
          parametros={parametros}
          hoje={hoje}
          onSalvar={salvar}
          onExcluir={excluir}
          onDuplicar={(a) => setEditando(novoAporte({ ...a, id: crypto.randomUUID(), dataAporte: hoje, status: 'Ativo', resgate: null }))}
          onFechar={() => setEditando(null)}
        />
      )}
    </>
  );
}

function Editor({
  inicial,
  novo,
  parametros: p,
  hoje,
  onSalvar,
  onExcluir,
  onDuplicar,
  onFechar,
}: {
  inicial: Aporte;
  novo: boolean;
  parametros: Parametros;
  hoje: string;
  onSalvar: (a: Aporte) => void;
  onExcluir: (a: Aporte) => void;
  onDuplicar: (a: Aporte) => void;
  onFechar: () => void;
}) {
  const [a, setA] = useState<Aporte>(inicial);
  const set = <K extends keyof Aporte>(k: K, v: Aporte[K]) => setA((x) => ({ ...x, [k]: v }));
  const pend = validarAporte(a, p);
  const cal = new Calendario(p.feriados);
  const datasOk = !!a.dataAporte && !!a.vencimento && a.vencimento > a.dataAporte;
  const h = datasOk ? avaliar(a, a.status === 'Resgatado' && a.resgate?.data ? a.resgate.data : hoje, p, cal) : null;
  const v = datasOk ? avaliar(a, a.vencimento, p, cal) : null;

  const marcarResgate = () => {
    const ref = h ?? null;
    setA((x) => ({
      ...x,
      status: 'Resgatado',
      resgate: x.resgate ?? {
        data: hoje,
        valorBruto: ref?.bruto ?? x.valor,
        irRetido: ref?.ir ?? 0,
        iofRetido: ref?.iof ?? 0,
        valorLiquido: ref?.liquido ?? x.valor,
      },
    }));
  };

  return (
    <div className="fundo" onClick={onFechar}>
      <div className="gaveta" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label="Editar aporte">
        <div className="gaveta-topo">
          <h1>{novo ? 'Novo aporte' : a.produto || 'Aporte'}</h1>
          <button className="btn" onClick={onFechar}>
            Fechar
          </button>
        </div>

        {pend.length > 0 && <div className="aviso amarelo">Falta: {pend.join(', ')}.</div>}

        {h && v && (
          <div className="card" style={{ marginBottom: 20 }}>
            <h3>
              Cálculo <span className="estimativa">estimativa</span>
            </h3>
            <div className="detalhe">
              <div>
                <span>Prazo</span>
                <b>
                  {v.diasCorridos} dias corridos · {v.diasUteis} úteis
                </b>
              </div>
              <div>
                <span>Fase atual</span>
                <b>{h.fase ?? '—'}</b>
              </div>
              <div>
                <span>Bruto hoje</span>
                <b>{moeda(h.bruto)}</b>
              </div>
              <div>
                <span>IOF hoje ({pct(h.pctIof, 0)})</span>
                <b>{moeda(h.iof)}</b>
              </div>
              <div>
                <span>IR hoje ({pct(h.aliquotaIr, 1)})</span>
                <b>{moeda(h.ir)}</b>
              </div>
              <div>
                <span>Líquido hoje</span>
                <b>{moeda(h.liquido)}</b>
              </div>
              <div>
                <span>Bruto no vencimento</span>
                <b>{moeda(v.bruto)}</b>
              </div>
              <div>
                <span>IR no vencimento ({pct(v.aliquotaIr, 1)})</span>
                <b>{moeda(v.ir)}</b>
              </div>
              <div>
                <span>Líquido no vencimento</span>
                <b>{moeda(v.liquido)}</b>
              </div>
              <div>
                <span>Rentabilidade líquida</span>
                <b>
                  {pct(v.rentabilidadeLiquida)} · {pct(v.taxaLiquidaAnual)} a.a.
                </b>
              </div>
            </div>
          </div>
        )}

        <fieldset>
          <legend>Identificação</legend>
          <div className="campos">
            <CampoTexto rotulo="Instituição / corretora" valor={a.instituicao} onChange={(x) => set('instituicao', x)} dica="Onde o título foi comprado" />
            <CampoTexto rotulo="Emissor do título" valor={a.emissor} onChange={(x) => set('emissor', x)} dica="Banco que emitiu o CDB (é o que vale para o FGC)" />
            <CampoTexto rotulo="Conglomerado (FGC)" valor={a.conglomerado} onChange={(x) => set('conglomerado', x)} dica="Vazio = usa o emissor" />
            <CampoTexto rotulo="Produto" valor={a.produto} onChange={(x) => set('produto', x)} />
            <CampoSelect rotulo="Tipo" valor={a.tipo} opcoes={TIPOS} onChange={(x) => set('tipo', x)} />
            <CampoSelect rotulo="Status" valor={a.status} opcoes={STATUS_MANUAIS} onChange={(x) => (x === 'Resgatado' ? marcarResgate() : set('status', x))} />
          </div>
        </fieldset>

        <fieldset>
          <legend>Aporte</legend>
          <div className="campos">
            <CampoData rotulo="Data do aporte" valor={a.dataAporte} onChange={(x) => set('dataAporte', x)} invalido={!a.dataAporte} />
            <CampoNumero rotulo="Valor (R$)" valor={a.valor || null} onChange={(x) => set('valor', x ?? 0)} invalido={!(a.valor > 0)} />
            <CampoData rotulo="Vencimento" valor={a.vencimento} onChange={(x) => set('vencimento', x)} invalido={!a.vencimento || (!!a.dataAporte && a.vencimento <= a.dataAporte)} />
          </div>
        </fieldset>

        <fieldset>
          <legend>Rentabilidade</legend>
          <div className="campos">
            <CampoSelect rotulo="Indexador" valor={a.indexador} opcoes={INDEXADORES} onChange={(x) => set('indexador', x)} />
            {a.indexador === 'CDI' && (
              <>
                <CampoNumero rotulo="% do CDI (padrão)" sufixo="%" escala={100} valor={a.pctCdi} onChange={(x) => set('pctCdi', x ?? 0)} />
                <CampoNumero rotulo="% do CDI promocional" sufixo="%" escala={100} valor={a.pctCdiPromo} onChange={(x) => set('pctCdiPromo', x)} dica="Fase 1. Deixe vazio se a taxa é única." />
                <CampoNumero rotulo="Duração da promoção" sufixo="dias" casas={0} valor={a.diasPromo || null} onChange={(x) => set('diasPromo', x ?? 0)} dica="Dias corridos desde o aporte" />
                <CampoNumero
                  rotulo="CDI só deste aporte"
                  sufixo="%"
                  escala={100}
                  valor={a.cdiProjecao}
                  onChange={(x) => set('cdiProjecao', x)}
                  dica={`Vazio = usa o CDI de Parâmetros (${pct(p.cdiAnual)})`}
                />
              </>
            )}
            {a.indexador === 'PRE' && <CampoNumero rotulo="Taxa prefixada a.a." sufixo="%" escala={100} valor={a.taxaPre} onChange={(x) => set('taxaPre', x)} />}
            {a.indexador === 'IPCA' && <CampoNumero rotulo="IPCA + (a.a.)" sufixo="%" escala={100} valor={a.spreadIpca} onChange={(x) => set('spreadIpca', x)} />}
            <CampoTexto rotulo="Regra promocional" valor={a.regraPromocional} onChange={(x) => set('regraPromocional', x)} largo />
          </div>
        </fieldset>

        <fieldset>
          <legend>Liquidez</legend>
          <div className="campos">
            <CampoSelect rotulo="Liquidez" valor={a.liquidez} opcoes={LIQUIDEZES} onChange={(x) => set('liquidez', x)} />
            <CampoData rotulo="Carência até" valor={a.carenciaAte} onChange={(x) => set('carenciaAte', x)} />
            <CampoCheck rotulo="Permite resgate antecipado" valor={a.permiteResgateAntecipado} onChange={(x) => set('permiteResgateAntecipado', x)} />
          </div>
        </fieldset>

        {a.status === 'Resgatado' && a.resgate && (
          <fieldset>
            <legend>Resgate (valores efetivamente recebidos)</legend>
            <div className="aviso azul">Os campos vêm preenchidos com a estimativa. Corrija com os valores do extrato do banco.</div>
            <div className="campos">
              <CampoData rotulo="Data do resgate" valor={a.resgate.data} onChange={(x) => set('resgate', { ...a.resgate!, data: x })} />
              <CampoNumero rotulo="Valor bruto recebido" valor={a.resgate.valorBruto} onChange={(x) => set('resgate', { ...a.resgate!, valorBruto: x ?? 0 })} />
              <CampoNumero rotulo="IR retido" valor={a.resgate.irRetido} onChange={(x) => set('resgate', { ...a.resgate!, irRetido: x ?? 0 })} />
              <CampoNumero rotulo="IOF retido" valor={a.resgate.iofRetido} onChange={(x) => set('resgate', { ...a.resgate!, iofRetido: x ?? 0 })} />
              <CampoNumero rotulo="Valor líquido recebido" valor={a.resgate.valorLiquido} onChange={(x) => set('resgate', { ...a.resgate!, valorLiquido: x ?? 0 })} />
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend>Observações</legend>
          <textarea rows={3} value={a.observacoes} onChange={(e) => set('observacoes', e.target.value)} />
        </fieldset>

        <div className="acoes" style={{ justifyContent: 'space-between' }}>
          <div className="acoes">
            <button className="btn primario" onClick={() => onSalvar(a)}>
              Salvar
            </button>
            {!novo && a.status !== 'Resgatado' && (
              <button className="btn" onClick={marcarResgate}>
                Registrar resgate
              </button>
            )}
            {!novo && (
              <button className="btn" onClick={() => onDuplicar(a)} title="Cria uma nova linha; o novo aporte não herda data nem contagem de impostos">
                Novo aporte no mesmo CDB
              </button>
            )}
          </div>
          {!novo && (
            <button className="btn perigo" onClick={() => onExcluir(a)}>
              Excluir
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
