import type { Aporte } from './types';

// Carteira fictícia de referência, compartilhada pelos testes do motor e da migração de formato.
// Referências de um laço dia a dia independente do motor (CDI 13,90% a.a., feriados nacionais).
export const HOJE_CARTEIRA_REFERENCIA = '2026-10-04';
export const APORTES_CARTEIRA_REFERENCIA: Partial<Aporte>[] = [
  { dataAporte: '2026-07-15', valor: 1200, pctCdi: 1.02, pctCdiPromo: 1.2, diasPromo: 30, vencimento: '2028-07-14', emissor: 'Banco Exemplo' },
  { dataAporte: '2026-08-26', valor: 800, pctCdi: 1.02, pctCdiPromo: 1.2, diasPromo: 30, vencimento: '2028-07-14', emissor: 'Banco Exemplo' },
  { dataAporte: '2026-09-22', valor: 1500, pctCdi: 1.1, vencimento: '2030-09-23', emissor: 'Banco Exemplo', liquidez: 'No vencimento' },
];
export const LIQUIDO_VENCIMENTO_CARTEIRA_REFERENCIA = [1510.79, 987.52, 2475.27];
export const LIQUIDO_HOJE_CARTEIRA_REFERENCIA = [1230.31, 810.11, 1502.38];
