import { useCallback, useEffect, useState } from 'react';
import { migrarDados } from './domain/migracao';
import { dadosVazios } from './domain/padroes';
import type { Dados } from './domain/types';

export const CHAVE = 'rendller:dados:v2';
/** Formato antigo: só leitura. Nunca é apagado nem alterado (vale até a Fase 7 do plano). */
export const CHAVE_V1 = 'rendller:dados:v1';
/** Cópia do conteúdo salvo que não pôde ser lido, para não perdê-lo. */
export const CHAVE_ILEGIVEL = 'rendller:dados:ilegivel';

export type OrigemCarga = 'v2' | 'v1' | 'vazio' | 'ilegivel';

/** Resultado da leitura do `localStorage` ao abrir o app. */
export interface Carga {
  dados: Dados;
  podeGravar: boolean;
  origem: OrigemCarga;
  /** Objeto v1 como estava salvo (só com origem `v1`), para ajustar a impressão da sincronização. */
  brutoV1?: unknown;
  /** Por que não dá para gravar: conteúdo ilegível (cópia guardada) ou armazenamento bloqueado. */
  motivo?: 'ilegivel' | 'bloqueado';
  /** Com a v2 ilegível: existe uma v1 salva, intacta (nunca usada automaticamente). */
  temV1?: boolean;
}

/** Guarda o bruto ilegível sem apagar uma cópia anterior diferente. */
function guardarIlegivel(s: Pick<Storage, 'getItem' | 'setItem'>, bruto: string) {
  try {
    const anterior = s.getItem(CHAVE_ILEGIVEL);
    if (anterior === bruto) return;
    s.setItem(anterior == null ? CHAVE_ILEGIVEL : `${CHAVE_ILEGIVEL}:${new Date().toISOString()}`, bruto);
  } catch {
    /* sem espaço: o bruto continua na chave de origem, que não é gravada */
  }
}

/**
 * Lê os dados salvos: a chave v2 e, sem ela, a v1 (migrada para v2). Se o conteúdo não puder ser lido,
 * guarda o bruto em `CHAVE_ILEGIVEL` e devolve `podeGravar: false`, para que o vazio não seja gravado por cima.
 * Uma v2 ilegível não cai na v1: a v1 pode estar desatualizada; o usuário decide restaurando um backup.
 */
export function carregarDe(s: Pick<Storage, 'getItem' | 'setItem'>): Carga {
  let bruto: string | null = null;
  let daV1 = false;
  try {
    bruto = s.getItem(CHAVE);
    if (bruto == null) {
      bruto = s.getItem(CHAVE_V1);
      daV1 = bruto != null;
    }
  } catch {
    return { dados: dadosVazios(), podeGravar: false, origem: 'ilegivel', motivo: 'bloqueado' };
  }
  if (bruto == null) return { dados: dadosVazios(), podeGravar: true, origem: 'vazio' };
  try {
    const obj: unknown = JSON.parse(bruto);
    const dados = migrarDados(obj);
    return daV1 ? { dados, podeGravar: true, origem: 'v1', brutoV1: obj } : { dados, podeGravar: true, origem: 'v2' };
  } catch {
    guardarIlegivel(s, bruto);
    let temV1 = false;
    try {
      temV1 = !daV1 && s.getItem(CHAVE_V1) != null;
    } catch {
      /* sem acesso: não afirma nada */
    }
    return { dados: dadosVazios(), podeGravar: false, origem: 'ilegivel', motivo: 'ilegivel', temV1 };
  }
}

/** Aviso a mostrar quando os dados salvos não puderam ser usados; null quando está tudo certo. */
export function avisoCarga(c: Pick<Carga, 'podeGravar' | 'motivo' | 'temV1'>): string | null {
  if (c.podeGravar) return null;
  if (c.motivo === 'bloqueado') {
    return 'O armazenamento deste navegador está bloqueado (modo privado ou permissão do site). Nada será salvo aqui; use um backup em Parâmetros.';
  }
  return `Dados salvos ilegíveis; cópia guardada. Restaure um backup.${c.temV1 ? ' Há também uma versão antiga dos dados intacta neste navegador (rendller:dados:v1).' : ''}`;
}

function carregarLocal(): Carga {
  try {
    return carregarDe(localStorage);
  } catch {
    // `localStorage` inacessível: não dá para saber o que há salvo, então não grava.
    return { dados: dadosVazios(), podeGravar: false, origem: 'ilegivel', motivo: 'bloqueado' };
  }
}

/**
 * Dados guardados neste navegador. Se o que estava salvo não pôde ser lido, nada é gravado até o usuário
 * editar ou restaurar dados (`atualizar` / `substituir`). Atualizações automáticas (CDI) usam
 * `atualizarAuto`, que não libera a gravação. `carga` descreve a leitura feita ao abrir.
 */
export function useDados() {
  const [carga] = useState(carregarLocal);
  const [estado, setEstado] = useState(() => ({ dados: carga.dados, podeGravar: carga.podeGravar }));
  const [erroGravacao, setErro] = useState(false);

  useEffect(() => {
    if (!estado.podeGravar) return;
    try {
      localStorage.setItem(CHAVE, JSON.stringify(estado.dados));
      setErro(false);
    } catch {
      setErro(true);
    }
  }, [estado]);

  const atualizar = useCallback((f: (d: Dados) => Dados) => setEstado((e) => ({ dados: f(e.dados), podeGravar: true })), []);
  const atualizarAuto = useCallback((f: (d: Dados) => Dados) => setEstado((e) => ({ ...e, dados: f(e.dados) })), []);
  const substituir = useCallback((d: Dados) => setEstado({ dados: d, podeGravar: true }), []);
  const aviso = estado.podeGravar ? null : avisoCarga(carga);
  return { dados: estado.dados, atualizar, atualizarAuto, substituir, erroGravacao, podeGravar: estado.podeGravar, carga, aviso };
}

export function baixarArquivo(nome: string, conteudo: string, tipo = 'application/json') {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
