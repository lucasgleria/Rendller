import { useEffect, useState } from 'react';
import { baixarArquivo } from '../armazenamento';
import type { EstadoCdi } from '../cdiOnline';
import { CampoCheck, CampoData, CampoNumero, CampoTexto } from '../components/campos';
import { ultimoCdi } from '../domain/cdi';
import { isISODate } from '../domain/datas';
import { CALENDARIO_ANBIMA } from '../domain/feriadosAnbima';
import { importarAportes, importarCdi, paraISO, validarBackup } from '../domain/importacao';
import { dadosVazios, normalizarParametros } from '../domain/padroes';
import type { Dados, ISODate, Parametros as P } from '../domain/types';
import { data, moeda, pct } from '../formato';
import { baixarCalendarioAnbima, lerArquivoAnbima, versaoAnbimaPublicada } from '../servicos';

interface Props {
  dados: Dados;
  atualizar: (f: (d: Dados) => Dados) => void;
  substituir: (d: Dados) => void;
  hoje: ISODate;
  estadoCdi: EstadoCdi;
  atualizarCdi: () => Promise<void>;
}

export default function Parametros({ dados, atualizar, substituir, hoje, estadoCdi, atualizarCdi }: Props) {
  const p = dados.parametros;
  const setP = (parcial: Partial<P>) => atualizar((d) => ({ ...d, parametros: { ...d.parametros, ...parcial } }));
  const [msg, setMsg] = useState<{ tipo: 'azul' | 'vermelho'; texto: string } | null>(null);
  const [feriadosTexto, setFeriadosTexto] = useState(() => p.feriados.map(data).join('\n'));
  const cdiReal = ultimoCdi(p.cdiDiario);
  // Conferência do calendário ANBIMA: compara a data do arquivo publicado com a da lista em uso.
  const [anbimaPublicada, setAnbimaPublicada] = useState<ISODate | null | undefined>(undefined);
  useEffect(() => {
    let vivo = true;
    versaoAnbimaPublicada().then((v) => vivo && setAnbimaPublicada(v));
    return () => {
      vivo = false;
    };
  }, []);
  const anbimaNova = !!anbimaPublicada && (!p.feriadosVersao || anbimaPublicada > p.feriadosVersao);

  const aplicarFeriados = (lista: ISODate[], fonte: string, versao: ISODate | '') => {
    setP({ feriados: lista, feriadosFonte: fonte, feriadosVersao: versao });
    setFeriadosTexto(lista.map(data).join('\n'));
  };

  const importarAnbima = async (origem: 'site' | File) => {
    try {
      const lista = origem === 'site' ? await baixarCalendarioAnbima() : await lerArquivoAnbima(origem);
      const versao = origem === 'site' && anbimaPublicada ? anbimaPublicada : hoje;
      const anos = `${lista[0].slice(0, 4)} a ${lista[lista.length - 1].slice(0, 4)}`;
      if (!confirm(`Substituir os ${p.feriados.length} feriados em uso pelos ${lista.length} do calendário ANBIMA (${anos})?`)) return;
      aplicarFeriados(lista, `ANBIMA, feriados nacionais (arquivo de ${data(versao)})`, versao);
      setMsg({ tipo: 'azul', texto: `Calendário ANBIMA aplicado: ${lista.length} feriados.` });
    } catch (e) {
      setMsg({ tipo: 'vermelho', texto: (e as Error).message });
    }
  };

  const importarPlanilha = async (arquivo: File) => {
    try {
      // carregado sob demanda: o leitor de .xlsx só é baixado quando o usuário importa
      const { readSheet } = await import('read-excel-file/browser');
      const linhas = await readSheet(arquivo, 'Aportes');
      const { aportes, ignoradas } = importarAportes(linhas);
      let cdi: number | null = null;
      try {
        cdi = importarCdi(await readSheet(arquivo, 'Config'));
      } catch {
        /* planilha sem aba Config: mantém o CDI atual */
      }
      const substituirTudo = dados.aportes.length === 0 || confirm(`Você já tem ${dados.aportes.length} aporte(s). OK substitui todos; Cancelar adiciona os ${aportes.length} importados.`);
      atualizar((d) => ({
        ...d,
        aportes: substituirTudo ? aportes : [...d.aportes, ...aportes],
        parametros: cdi != null ? { ...d.parametros, cdiAnual: cdi, cdiData: '', cdiFonte: 'Importado da planilha (Config!B4); confirmar valor vigente' } : d.parametros,
      }));
      setMsg({
        tipo: 'azul',
        texto: `${aportes.length} aporte(s) importado(s)${ignoradas ? `, ${ignoradas} linha(s) incompleta(s) ignorada(s)` : ''}${cdi != null ? `. CDI da planilha: ${pct(cdi)}` : ''}. Revise conglomerado e tipo em cada aporte.`,
      });
    } catch (e) {
      setMsg({ tipo: 'vermelho', texto: `Não consegui ler a planilha: ${(e as Error).message}` });
    }
  };

  const importarBackup = async (arquivo: File) => {
    try {
      const d = validarBackup(JSON.parse(await arquivo.text()));
      if (!confirm(`Substituir os dados atuais por ${d.aportes.length} aporte(s) do backup?`)) return;
      const parametros = normalizarParametros(d.parametros);
      substituir({ ...d, parametros });
      setFeriadosTexto(parametros.feriados.map(data).join('\n'));
      setMsg({ tipo: 'azul', texto: 'Backup restaurado.' });
    } catch (e) {
      setMsg({ tipo: 'vermelho', texto: (e as Error).message });
    }
  };

  const salvarFeriados = () => {
    const lista = feriadosTexto
      .split(/[\n,;]+/)
      .map((s) => paraISO(s.trim()))
      .filter((s) => isISODate(s));
    setP({ feriados: [...new Set(lista)].sort(), feriadosFonte: 'Lista editada pelo usuário', feriadosVersao: '' });
    setMsg({ tipo: 'azul', texto: `${new Set(lista).size} feriado(s) salvos.` });
  };

  return (
    <>
      <h1>Parâmetros</h1>
      <p className="sub">Toda conta do app lê daqui. Nada de taxa escrita dentro do cálculo. Premissas tributárias: {p.premissasVersao}.</p>
      {msg && <div className={`aviso ${msg.tipo}`}>{msg.texto}</div>}

      <div className="grade metade" style={{ marginBottom: 12 }}>
        <div className="card">
          <h2>CDI e IPCA</h2>
          <p className="mut" style={{ fontSize: 13, marginTop: 0 }}>
            <b>CDI realizado</b> (fato):{' '}
            {cdiReal ? (
              <>
                último {pct(cdiReal.anual)} a.a. em {data(cdiReal.data)}, {p.cdiDiario.length} dias úteis desde {data(p.cdiDiario[0].data)}
              </>
            ) : (
              'ainda não consultado'
            )}
            . Fonte: Banco Central (SGS 4389).{p.cdiAtualizadoEm && <> Consultado em {data(p.cdiAtualizadoEm)}.</>} O rendimento já decorrido usa o CDI de
            cada dia; o futuro usa o CDI de projeção abaixo (<b>estimativa</b>).
          </p>
          {estadoCdi.erro && <div className="aviso amarelo">{estadoCdi.erro}</div>}
          <div className="acoes" style={{ marginBottom: 8 }}>
            <button className="btn" disabled={estadoCdi.carregando} onClick={() => void atualizarCdi()}>
              {estadoCdi.carregando ? 'Consultando…' : 'Atualizar CDI agora'}
            </button>
          </div>
          {!p.cdiData && <div className="aviso amarelo">Informe a data e a fonte do CDI de projeção. Projeções dependem dele e são estimativas.</div>}
          <div className="campos">
            <CampoCheck rotulo="Projeção acompanha o último CDI do Banco Central" valor={p.cdiAutomatico} onChange={(x) => setP({ cdiAutomatico: x })} />
            <CampoNumero
              rotulo="CDI de projeção a.a."
              sufixo="%"
              escala={100}
              valor={p.cdiAnual}
              onChange={(x) => x != null && setP({ cdiAnual: x, cdiAutomatico: false })}
              dica={p.cdiAutomatico ? 'Automático; editar desliga o automático' : 'Manual (ex.: se você espera queda dos juros)'}
            />
            <CampoData rotulo="Data do CDI" valor={p.cdiData} onChange={(x) => setP({ cdiData: x, cdiAutomatico: false })} />
            <CampoTexto rotulo="Fonte do CDI" valor={p.cdiFonte} onChange={(x) => setP({ cdiFonte: x, cdiAutomatico: false })} largo />
            <CampoNumero rotulo="IPCA projetado a.a." sufixo="%" escala={100} valor={p.ipcaProjetado} onChange={(x) => setP({ ipcaProjetado: x })} dica="Usado só em aportes IPCA+" />
            <CampoData rotulo="Data do IPCA" valor={p.ipcaData} onChange={(x) => setP({ ipcaData: x })} />
            <CampoTexto rotulo="Fonte do IPCA" valor={p.ipcaFonte} onChange={(x) => setP({ ipcaFonte: x })} largo />
            <CampoNumero rotulo="Dias úteis por ano" casas={0} valor={p.diasUteisAno} onChange={(x) => x && setP({ diasUteisAno: x })} />
          </div>
        </div>

        <div className="card">
          <h2>FGC e alertas</h2>
          <div className="campos">
            <CampoNumero rotulo="Limite por instituição (R$)" valor={p.fgcLimitePorInstituicao} onChange={(x) => x && setP({ fgcLimitePorInstituicao: x })} />
            <CampoNumero rotulo="Limite global em 4 anos (R$)" valor={p.fgcLimiteGlobal4Anos} onChange={(x) => x && setP({ fgcLimiteGlobal4Anos: x })} />
            <CampoNumero rotulo="Alertar concentração a partir de" sufixo="%" escala={100} casas={0} valor={p.fgcAlertaFracao} onChange={(x) => x && setP({ fgcAlertaFracao: x })} />
            <CampoNumero rotulo="Alerta de vencimento 1" sufixo="dias" casas={0} valor={p.alertaVencimentoDias[0]} onChange={(x) => x && setP({ alertaVencimentoDias: [x, p.alertaVencimentoDias[1]] })} />
            <CampoNumero rotulo="Alerta de vencimento 2" sufixo="dias" casas={0} valor={p.alertaVencimentoDias[1]} onChange={(x) => x && setP({ alertaVencimentoDias: [p.alertaVencimentoDias[0], x] })} />
          </div>
          <p className="mut" style={{ fontSize: 13 }}>
            Cobertura ordinária: {moeda(p.fgcLimitePorInstituicao)} por CPF por conglomerado, principal + rendimentos. Fonte: {p.premissasFonte}.
          </p>
        </div>
      </div>

      <div className="grade metade" style={{ marginBottom: 12 }}>
        <div className="card">
          <h2>Imposto de Renda (regressivo)</h2>
          <table>
            <thead>
              <tr>
                <th>A partir de (dias corridos)</th>
                <th>Alíquota</th>
              </tr>
            </thead>
            <tbody>
              {p.tabelaIR.map((f, i) => (
                <tr key={i}>
                  <td>
                    <CampoNumero
                      rotulo=""
                      casas={0}
                      valor={f.aPartirDeDias}
                      onChange={(x) => x != null && setP({ tabelaIR: p.tabelaIR.map((g, j) => (j === i ? { ...g, aPartirDeDias: x } : g)) })}
                    />
                  </td>
                  <td>
                    <CampoNumero
                      rotulo=""
                      sufixo="%"
                      escala={100}
                      valor={f.aliquota}
                      onChange={(x) => x != null && setP({ tabelaIR: p.tabelaIR.map((g, j) => (j === i ? { ...g, aliquota: x } : g)) })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>IOF (resgates antes de 30 dias)</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 6 }}>
            {p.tabelaIOF.map((v, i) => (
              <CampoNumero
                key={i}
                rotulo={`Dia ${i + 1}${i === 29 ? '+' : ''}`}
                sufixo="%"
                escala={100}
                casas={0}
                valor={v}
                onChange={(x) => x != null && setP({ tabelaIOF: p.tabelaIOF.map((w, j) => (j === i ? x : w)) })}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="grade metade">
        <div className="card">
          <h2>Feriados</h2>
          <p className="mut" style={{ fontSize: 13, marginTop: 0 }}>
            Usados na contagem de dias úteis do rendimento. Em uso: <b>{p.feriadosFonte || 'lista sem origem informada'}</b>. Uma data por linha.
          </p>
          {anbimaPublicada === undefined ? null : anbimaPublicada === null ? (
            <p className="mut" style={{ fontSize: 13 }}>Não consegui conferir o site da ANBIMA agora. Você pode importar o arquivo baixado manualmente.</p>
          ) : anbimaNova ? (
            <div className="aviso amarelo">
              A ANBIMA publicou um calendário em {data(anbimaPublicada)}, diferente da lista em uso.{' '}
              <button className="btn pequeno" onClick={() => void importarAnbima('site')}>
                Aplicar calendário novo
              </button>
            </div>
          ) : (
            <p className="mut" style={{ fontSize: 13 }}>Conferido: a lista em uso corresponde ao arquivo da ANBIMA de {data(anbimaPublicada)}.</p>
          )}
          <textarea rows={8} value={feriadosTexto} onChange={(e) => setFeriadosTexto(e.target.value)} />
          <div className="acoes" style={{ marginTop: 8 }}>
            <button className="btn" onClick={salvarFeriados}>
              Salvar feriados
            </button>
            <button
              className="btn"
              onClick={() =>
                confirm('Voltar para o calendário ANBIMA embutido no app? Feriados adicionados à mão serão removidos.') &&
                aplicarFeriados([...CALENDARIO_ANBIMA.feriados], CALENDARIO_ANBIMA.fonte, CALENDARIO_ANBIMA.versao)
              }
            >
              Restaurar calendário ANBIMA
            </button>
            <span className="mut" style={{ fontSize: 13, alignSelf: 'center' }}>
              {p.feriados.length} datas em uso
            </span>
          </div>
          <label className="campo" style={{ marginTop: 8 }}>
            <span>Importar arquivo da ANBIMA (feriados_nacionais.xls)</span>
            <input type="file" accept=".xls,.xlsx" onChange={(e) => e.target.files?.[0] && void importarAnbima(e.target.files[0])} />
          </label>
        </div>

        <div className="card">
          <h2>Dados</h2>
          <p className="mut" style={{ fontSize: 13, marginTop: 0 }}>
            Seus dados ficam só neste navegador. Exporte um backup para guardar ou levar a outro aparelho.
          </p>
          <div className="campos">
            <label className="campo">
              <span>Importar planilha (.xlsx)</span>
              <input type="file" accept=".xlsx" onChange={(e) => e.target.files?.[0] && importarPlanilha(e.target.files[0])} />
            </label>
            <label className="campo">
              <span>Restaurar backup (.json)</span>
              <input type="file" accept=".json,application/json" onChange={(e) => e.target.files?.[0] && importarBackup(e.target.files[0])} />
            </label>
          </div>
          <p className="mut" style={{ fontSize: 13 }}>
            No Google Sheets: Arquivo → Fazer download → Microsoft Excel (.xlsx). O app lê as abas Aportes e Config.
          </p>
          <div className="acoes">
            <button className="btn primario" onClick={() => baixarArquivo(`rendller-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(dados, null, 2))}>
              Exportar backup
            </button>
            <button
              className="btn perigo"
              onClick={() => {
                if (confirm('Apagar todos os aportes e parâmetros deste navegador? Exporte um backup antes.')) {
                  const vazio = dadosVazios();
                  substituir({ ...vazio, parametros: { ...vazio.parametros, cdiDiario: p.cdiDiario, cdiAtualizadoEm: p.cdiAtualizadoEm } });
                  setFeriadosTexto(dadosVazios().parametros.feriados.map(data).join('\n'));
                }
              }}
            >
              Apagar tudo
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
