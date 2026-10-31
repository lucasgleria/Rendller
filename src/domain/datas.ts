import type { ISODate } from './types';

const DIA_MS = 86_400_000;

/** Número de dias desde 1970-01-01 (UTC), para aritmética de datas sem fuso. */
export function diaNum(iso: ISODate): number {
  const [a, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(a, m - 1, d) / DIA_MS);
}

export function deDiaNum(n: number): ISODate {
  return new Date(n * DIA_MS).toISOString().slice(0, 10);
}

export function somaDias(iso: ISODate, dias: number): ISODate {
  return deDiaNum(diaNum(iso) + dias);
}

export function ehBissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

/** Dias no mês (`mes` de 1 a 12). */
export function diasNoMes(ano: number, mes: number): number {
  if (mes === 2) return ehBissexto(ano) ? 29 : 28;
  return mes === 4 || mes === 6 || mes === 9 || mes === 11 ? 30 : 31;
}

/**
 * Soma um número inteiro de meses mantendo o dia do mês; se o dia não existe no mês de destino, usa o último
 * dia (31/08 + 6 = 28/02). Lança erro para meses não inteiros ou data inválida: nunca devolve uma data inválida.
 */
export function somaMeses(iso: ISODate, meses: number): ISODate {
  if (!Number.isInteger(meses)) throw new Error(`Número de meses inválido: ${meses}`);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const [a, mm, d] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  if (!m || mm < 1 || mm > 12 || d < 1 || d > diasNoMes(a, mm)) throw new Error(`Data inválida: ${iso}`);
  const total = a * 12 + (mm - 1) + meses;
  const ano = Math.floor(total / 12);
  const mes = total - ano * 12 + 1;
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(Math.min(d, diasNoMes(ano, mes))).padStart(2, '0')}`;
}

/** Dias corridos de `a` até `b` (b − a). */
export function diasCorridos(a: ISODate, b: ISODate): number {
  return diaNum(b) - diaNum(a);
}

export function hojeISO(): ISODate {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function minData(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}

export function maxData(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

/** Data ISO `aaaa-mm-dd` que existe no calendário (30/02 e mês 00 não passam). */
export function isISODate(s: unknown): boolean {
  if (typeof s !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mes >= 1 && mes <= 12 && d >= 1 && d <= diasNoMes(a, mes);
}

/** Calendário de dias úteis com feriados. */
export class Calendario {
  private feriados: number[];

  constructor(feriados: ISODate[]) {
    this.feriados = [...new Set(feriados.filter(isISODate).map(diaNum))]
      .filter((n) => !ehFimDeSemana(n))
      .sort((x, y) => x - y);
  }

  /** Dias úteis no intervalo [inicio, fim): conta o dia do início, não o do fim. */
  diasUteis(inicio: ISODate, fim: ISODate): number {
    const a = diaNum(inicio);
    const b = diaNum(fim);
    if (b <= a) return 0;
    return diasDeSemana(a, b) - (indiceInferior(this.feriados, b) - indiceInferior(this.feriados, a));
  }

  ehDiaUtil(iso: ISODate): boolean {
    if (!isISODate(iso)) return false;
    const n = diaNum(iso);
    return !ehFimDeSemana(n) && this.feriados[indiceInferior(this.feriados, n)] !== n;
  }
}

// 1970-01-01 foi quinta-feira: (n + 4) % 7 → 0 = domingo … 6 = sábado.
function diaDaSemana(n: number): number {
  return (((n + 4) % 7) + 7) % 7;
}

function ehFimDeSemana(n: number): boolean {
  const d = diaDaSemana(n);
  return d === 0 || d === 6;
}

/** Dias de segunda a sexta em [a, b). */
function diasDeSemana(a: number, b: number): number {
  const total = b - a;
  const semanas = Math.floor(total / 7);
  let n = semanas * 5;
  for (let x = a + semanas * 7; x < b; x++) if (!ehFimDeSemana(x)) n++;
  return n;
}

/** Primeiro índice i com arr[i] >= v. */
export function indiceInferior(arr: number[], v: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] < v) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
export function pascoa(ano: number): ISODate {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Feriados nacionais (fixos + Carnaval, Sexta-feira Santa e Corpus Christi).
 * Serve de conferência do calendário ANBIMA (`feriadosAnbima.ts`): as duas listas coincidem de 2001 a 2099.
 */
export function feriadosNacionais(anoInicial: number, anoFinal: number): ISODate[] {
  const fixos = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];
  const out: ISODate[] = [];
  for (let ano = anoInicial; ano <= anoFinal; ano++) {
    // Consciência Negra é feriado nacional a partir de 2024.
    for (const md of fixos) if (md !== '11-20' || ano >= 2024) out.push(`${ano}-${md}`);
    const p = pascoa(ano);
    out.push(somaDias(p, -48), somaDias(p, -47), somaDias(p, -2), somaDias(p, 60));
  }
  return out.sort();
}
