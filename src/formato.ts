import type { ISODate } from './domain/types';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlCurto = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
const num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/** Arredonda só na exibição (CLAUDE.md 5.7). */
export const moeda = (v: number) => brl.format(v);
export const moedaCurta = (v: number) => brlCurto.format(v);
export const numero = (v: number) => num.format(v);
export const pct = (v: number | null | undefined, casas = 2) =>
  v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

export function data(iso: ISODate | '' | null | undefined): string {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

export function mesAno(iso: ISODate): string {
  const [a, m] = iso.split('-');
  return `${m}/${a.slice(2)}`;
}

/** Converte texto digitado em pt-BR ("1.234,56") em número. Vazio → null. */
export function lerNumero(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace(/\s|R\$/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function mostrarNumero(v: number | null | undefined, casas = 2): string {
  if (v == null || !Number.isFinite(v)) return '';
  return v.toLocaleString('pt-BR', { maximumFractionDigits: casas, useGrouping: false });
}
