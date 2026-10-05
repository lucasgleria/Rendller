import { deDiaNum, isISODate } from './datas';
import { novoAporte } from './padroes';
import type { Aporte, Dados, ISODate, Liquidez } from './types';

type Celula = unknown;

/** Converte uma célula de data (Date, ISO ou dd/mm/aaaa) em ISO. */
export function paraISO(v: Celula): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'string') {
    const s = v.trim();
    if (isISODate(s)) return s;
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return '';
}

function numero(v: Celula): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/[R$\s%.]/g, '').replace(',', '.'));
    if (Number.isFinite(n)) return v.includes('%') ? n / 100 : n;
  }
  return null;
}

function texto(v: Celula): string {
  return v == null ? '' : String(v).trim();
}

function liquidez(v: string): Liquidez {
  const s = v.toLowerCase();
  if (s.startsWith('diária') || s.startsWith('diaria')) return 'Diária';
  if (s.includes('vencimento')) return 'No vencimento';
  if (s.includes('carência') || s.includes('carencia')) return 'Após carência';
  return 'Outra';
}

const COLUNAS = {
  data: 'Data do aporte',
  plataforma: 'Plataforma / Corretora',
  emissor: 'Banco emissor',
  produto: 'CDB / Identificação',
  valor: 'Valor do aporte (R$)',
  pct: '% CDI padrão',
  pctPromo: '% CDI promocional',
  dias: 'Dias promoção',
  venc: 'Vencimento',
  liquidez: 'Liquidez',
  obs: 'Observações',
} as const;

/**
 * Lê as linhas da aba `Aportes` da planilha controle_cdb_google_sheets (cabeçalho na linha com
 * "Data do aporte"). Cada linha preenchida vira um lote; linhas sem data ou valor são ignoradas.
 */
export function importarAportes(linhas: Celula[][]): { aportes: Aporte[]; ignoradas: number } {
  const iCab = linhas.findIndex((l) => l.some((c) => texto(c) === COLUNAS.data));
  if (iCab < 0) throw new Error('Não encontrei o cabeçalho "Data do aporte" na aba Aportes.');
  const cab = linhas[iCab].map(texto);
  const col = Object.fromEntries(Object.entries(COLUNAS).map(([k, nome]) => [k, cab.indexOf(nome)])) as Record<keyof typeof COLUNAS, number>;
  for (const k of ['data', 'emissor', 'valor', 'pct', 'venc'] as const) {
    if (col[k] < 0) throw new Error(`Coluna "${COLUNAS[k]}" não encontrada na aba Aportes.`);
  }
  const get = (l: Celula[], k: keyof typeof COLUNAS) => (col[k] >= 0 ? l[col[k]] : null);
  const aportes: Aporte[] = [];
  let ignoradas = 0;
  for (const l of linhas.slice(iCab + 1)) {
    const data = paraISO(get(l, 'data'));
    const valor = numero(get(l, 'valor'));
    if (!data && valor == null) continue; // linha vazia
    if (!data || valor == null) {
      ignoradas++;
      continue;
    }
    const pctPromo = numero(get(l, 'pctPromo'));
    const dias = numero(get(l, 'dias')) ?? 0;
    const liq = liquidez(texto(get(l, 'liquidez')));
    const plataforma = texto(get(l, 'plataforma'));
    const emissor = texto(get(l, 'emissor'));
    aportes.push(
      novoAporte({
        dataAporte: data,
        valor,
        instituicao: plataforma,
        emissor,
        conglomerado: emissor,
        produto: texto(get(l, 'produto')),
        pctCdi: numero(get(l, 'pct')) ?? 1,
        pctCdiPromo: pctPromo != null && dias > 0 ? pctPromo : null,
        diasPromo: pctPromo != null && dias > 0 ? dias : 0,
        regraPromocional: pctPromo != null && dias > 0 ? `${Math.round(pctPromo * 100)}% do CDI nos primeiros ${dias} dias` : '',
        vencimento: paraISO(get(l, 'venc')),
        liquidez: liq,
        permiteResgateAntecipado: liq === 'Diária',
        observacoes: [texto(get(l, 'obs')), `Liquidez na planilha: ${texto(get(l, 'liquidez'))}`].filter(Boolean).join(' · '),
      }),
    );
  }
  return { aportes, ignoradas };
}

/** Lê o CDI de `Config!B4` (linha "CDI anual estimado"). */
export function importarCdi(linhas: Celula[][]): number | null {
  for (const l of linhas) {
    if (texto(l[0]).toLowerCase().startsWith('cdi anual')) return numero(l[1]);
  }
  return null;
}

/** Dias entre 1899-12-30 (dia 0 das datas seriais do Excel) e 1970-01-01. */
const EXCEL_EPOCA = 25569;

/**
 * Lê o arquivo `feriados_nacionais.xls` da ANBIMA (colunas Data · Dia da Semana · Feriado).
 * Aceita datas como número serial do Excel, Date ou texto dd/mm/aaaa; rodapé e linhas sem data são ignorados.
 */
export function lerFeriadosAnbima(linhas: Celula[][]): ISODate[] {
  const iCab = linhas.findIndex((l) => texto(l[0]).toLowerCase() === 'data' && l.some((c) => texto(c).toLowerCase() === 'feriado'));
  if (iCab < 0) throw new Error('Arquivo não parece ser o calendário da ANBIMA (cabeçalho "Data" e "Feriado" não encontrado).');
  const datas = new Set<ISODate>();
  for (const l of linhas.slice(iCab + 1)) {
    const c = l[0];
    const d = typeof c === 'number' && Number.isInteger(c) && c > 0 ? deDiaNum(c - EXCEL_EPOCA) : paraISO(c);
    if (isISODate(d) && texto(l[2])) datas.add(d);
  }
  if (datas.size < 100) throw new Error(`Só ${datas.size} feriado(s) encontrados: o arquivo parece incompleto.`);
  return [...datas].sort();
}

export function validarBackup(obj: unknown): Dados {
  const d = obj as Dados;
  if (!d || d.versao !== 1 || !Array.isArray(d.aportes) || typeof d.parametros !== 'object') {
    throw new Error('Arquivo de backup inválido.');
  }
  return d;
}
