import { useState } from 'react';
import { baixarArquivo } from '../armazenamento';
import { CampoData, CampoNumero, CampoTexto } from '../components/campos';
import { isISODate } from '../domain/datas';
import { importarAportes, importarCdi, paraISO, validarBackup } from '../domain/importacao';
import { dadosVazios, parametrosPadrao } from '../domain/padroes';
import type { Dados, Parametros as P } from '../domain/types';
import { data, moeda, pct } from '../formato';

interface Props {
  dados: Dados;
  atualizar: (f: (d: Dados) => Dados) => void;
  substituir: (d: Dados) => void;
}

export default function Parametros({ dados, atualizar, substituir }: Props) {
  const p = dados.parametros;
  const setP = (parcial: Partial<P>) => atualizar((d) => ({ ...d, parametros: { ...d.parametros, ...parcial } }));
  const [msg, setMsg] = useState<{ tipo: 'azul' | 'vermelho'; texto: string } | null>(null);
  const [feriadosTexto, setFeriadosTexto] = useState(() => p.feriados.map(data).join('\n'));

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
      substituir({ ...d, parametros: { ...parametrosPadrao(), ...d.parametros } });
      setFeriadosTexto(d.parametros.feriados.map(data).join('\n'));
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
    setP({ feriados: [...new Set(lista)].sort() });
    setMsg({ tipo: 'azul', texto: `${new Set(lista).size} feriado(s) salvos.` });
  };

  return (
    <>
      <h1>Parâmetros</h1>
      <p className="sub">Toda conta do app lê daqui. Nada de taxa escrita dentro do cálculo. Premissas tributárias: {p.premissasVersao}.</p>
      {msg && <div className={`aviso ${msg.tipo}`}>{msg.texto}</div>}

      <div className="grade metade" style={{ marginBottom: 12 }}>
        <div className="card">
          <h2>CDI e IPCA de projeção</h2>
          {!p.cdiData && <div className="aviso amarelo">Informe a data e a fonte do CDI. Projeções dependem dele e são estimativas.</div>}
          <div className="campos">
            <CampoNumero rotulo="CDI anual" sufixo="%" escala={100} valor={p.cdiAnual} onChange={(x) => x != null && setP({ cdiAnual: x })} />
            <CampoData rotulo="Data do CDI" valor={p.cdiData} onChange={(x) => setP({ cdiData: x })} />
            <CampoTexto rotulo="Fonte do CDI" valor={p.cdiFonte} onChange={(x) => setP({ cdiFonte: x })} largo />
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
            Usados na contagem de dias úteis do rendimento. Lista inicial: feriados nacionais de 2020 a 2040 (conferir com o calendário ANBIMA). Uma data por linha.
          </p>
          <textarea rows={8} value={feriadosTexto} onChange={(e) => setFeriadosTexto(e.target.value)} />
          <div className="acoes" style={{ marginTop: 8 }}>
            <button className="btn" onClick={salvarFeriados}>
              Salvar feriados
            </button>
            <span className="mut" style={{ fontSize: 13, alignSelf: 'center' }}>
              {p.feriados.length} datas em uso
            </span>
          </div>
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
                  substituir(dadosVazios());
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
