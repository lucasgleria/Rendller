/** Datas sempre em ISO `aaaa-mm-dd` (sem fuso). */
export type ISODate = string;

export type Tipo = 'CDB Pós-fixado' | 'CDB Prefixado' | 'CDB IPCA+' | 'Outro renda fixa';
export type Indexador = 'CDI' | 'PRE' | 'IPCA';
export type Liquidez = 'Diária' | 'No vencimento' | 'Após carência' | 'Outra';
/** Status informado pelo usuário. `Ativo` vira `Vencido` automaticamente após o vencimento. */
export type StatusManual = 'Ativo' | 'Planejado' | 'Resgatado';
export type Status = StatusManual | 'Vencido';

export interface Resgate {
  data: ISODate;
  valorBruto: number;
  irRetido: number;
  iofRetido: number;
  valorLiquido: number;
}

/**
 * Rastro de um resgate parcial: o lote original vira duas linhas com a mesma data de aporte.
 * A parte resgatada mantém o `id` original; a remanescente ganha `id` novo e `origemId` aponta para o original.
 */
export interface Divisao {
  origemId: string;
  valorOriginal: number; // principal do lote antes da divisão
  data: ISODate; // data do resgate parcial
  fracao: number; // fração do principal original que ficou nesta linha
}

/** Um aporte = um lote independente (CLAUDE.md seção 3, regra 2). */
export interface Aporte {
  id: string;
  // Identificação
  instituicao: string; // plataforma / corretora onde foi comprado
  emissor: string; // banco emissor do título
  conglomerado: string; // para FGC; vazio = usa o emissor
  produto: string;
  tipo: Tipo;
  observacoes: string;
  // Aporte
  dataAporte: ISODate;
  valor: number;
  vencimento: ISODate;
  status: StatusManual;
  // Liquidez
  liquidez: Liquidez;
  permiteResgateAntecipado: boolean;
  carenciaAte: ISODate | '';
  // Rentabilidade (percentuais e taxas em decimal: 103% = 1.03; 12% a.a. = 0.12)
  indexador: Indexador;
  pctCdi: number; // % do CDI da fase padrão (fase 2, ou única)
  pctCdiPromo: number | null; // % do CDI da fase 1 (promocional)
  diasPromo: number; // duração da fase 1 em dias corridos
  taxaPre: number | null; // prefixado a.a.
  spreadIpca: number | null; // IPCA + spread a.a.
  regraPromocional: string;
  cdiProjecao: number | null; // sobrescreve o CDI de Parametros só nesta linha
  // Resgate (preenchido quando status = Resgatado)
  resgate: Resgate | null;
  /** Só em linhas criadas por resgate parcial; ausente em dados antigos. */
  divisao?: Divisao | null;
}

export interface FaixaIR {
  aPartirDeDias: number; // dias corridos
  aliquota: number;
}

export interface Parametros {
  cdiAnual: number;
  cdiData: ISODate | '';
  cdiFonte: string;
  /** null = não informado; aportes IPCA+ ficam sem projeção até ser preenchido. */
  ipcaProjetado: number | null;
  ipcaData: ISODate | '';
  ipcaFonte: string;
  diasUteisAno: number;
  tabelaIR: FaixaIR[];
  /** índice 0 = dia 1 … índice 29 = dia 30 (0%). */
  tabelaIOF: number[];
  fgcLimitePorInstituicao: number;
  fgcLimiteGlobal4Anos: number;
  /** fração do limite do FGC a partir da qual o alerta de concentração dispara */
  fgcAlertaFracao: number;
  alertaVencimentoDias: [number, number];
  feriados: ISODate[];
  premissasVersao: string;
  premissasFonte: string;
}

export interface Dados {
  versao: 1;
  aportes: Aporte[];
  parametros: Parametros;
}
