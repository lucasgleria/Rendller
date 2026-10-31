import type { Aporte } from './types';

// Carteira real da planilha (04/10/2026), compartilhada pelos testes do motor e da migração de formato.
// Referências do script Python independente da auditoria (CDI 13,90% a.a., feriados nacionais).
export const HOJE_CARTEIRA_REAL = '2026-10-04';
export const APORTES_CARTEIRA_REAL: Partial<Aporte>[] = [
  { dataAporte: '2026-08-19', valor: 500, pctCdi: 1.03, pctCdiPromo: 1.3, diasPromo: 30, vencimento: '2028-08-10', emissor: 'PagBank' },
  { dataAporte: '2026-09-02', valor: 500, pctCdi: 1.03, pctCdiPromo: 1.3, diasPromo: 30, vencimento: '2028-08-10', emissor: 'PagBank' },
  { dataAporte: '2026-10-01', valor: 700, pctCdi: 1.085, vencimento: '2030-10-01', emissor: 'PagBank', liquidez: 'No vencimento' },
];
export const LIQUIDO_VENCIMENTO_CARTEIRA_REAL = [629.65, 622.98, 1146.44];
export const LIQUIDO_HOJE_CARTEIRA_REAL = [507.81, 505.71, 700.06];
