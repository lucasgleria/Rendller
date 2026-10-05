import { lerSerieBcb } from './domain/cdi';
import { minData, somaDias } from './domain/datas';
import { lerFeriadosAnbima } from './domain/importacao';
import type { CdiDia, ISODate } from './domain/types';

/** CDI anualizado base 252, um valor por dia útil (Banco Central, SGS 4389). API pública, sem chave. */
const SGS_CDI = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.4389/dados';
/** O SGS limita consultas diárias a 10 anos por requisição. */
const JANELA_DIAS = 3650;
/**
 * Calendário ANBIMA. O site não libera acesso direto do navegador (sem CORS), então o app passa por um
 * proxy do próprio domínio: `netlify.toml` em produção e `vite.config.ts` em desenvolvimento.
 */
export const URL_ANBIMA = '/anbima/feriados_nacionais.xls';

const br = (iso: ISODate) => iso.split('-').reverse().join('/');

async function obter(url: string, init?: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function buscarCdiBcb(desde: ISODate, ate: ISODate): Promise<CdiDia[]> {
  const out: CdiDia[] = [];
  for (let ini = desde; ini <= ate; ini = somaDias(ini, JANELA_DIAS + 1)) {
    const fim = minData(somaDias(ini, JANELA_DIAS), ate);
    const r = await obter(`${SGS_CDI}?formato=json&dataInicial=${br(ini)}&dataFinal=${br(fim)}`);
    if (r.status === 404) continue; // janela sem dados publicados (ex.: só fim de semana)
    if (!r.ok) throw new Error(`Banco Central respondeu ${r.status}.`);
    out.push(...lerSerieBcb(await r.json()));
  }
  return out;
}

/** Data de publicação do arquivo da ANBIMA (cabeçalho Last-Modified), ou null se não der para verificar. */
export async function versaoAnbimaPublicada(): Promise<ISODate | null> {
  try {
    const r = await obter(URL_ANBIMA, { method: 'HEAD', cache: 'no-store' });
    const lm = r.ok ? r.headers.get('last-modified') : null;
    if (!lm || !/excel|octet/.test(r.headers.get('content-type') ?? '')) return null;
    const d = new Date(lm);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

async function lerPlanilha(dados: ArrayBuffer): Promise<ISODate[]> {
  // carregado sob demanda: o leitor de .xls só é baixado quando o usuário importa o calendário
  const XLSX = await import('xlsx');
  const wb = XLSX.read(dados, { type: 'array' });
  const linhas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true });
  return lerFeriadosAnbima(linhas);
}

export async function baixarCalendarioAnbima(): Promise<ISODate[]> {
  const r = await obter(URL_ANBIMA, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Não consegui baixar o calendário da ANBIMA (${r.status}).`);
  return lerPlanilha(await r.arrayBuffer());
}

export async function lerArquivoAnbima(arquivo: File): Promise<ISODate[]> {
  return lerPlanilha(await arquivo.arrayBuffer());
}
