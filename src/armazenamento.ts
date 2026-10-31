import { useCallback, useEffect, useState } from 'react';
import { migrarDados } from './domain/migracao';
import { dadosVazios } from './domain/padroes';
import type { Dados } from './domain/types';

export const CHAVE = 'rendller:dados:v2';
/** Formato antigo: só leitura. Nunca é apagado nem alterado (vale até a Fase 7 do plano). */
export const CHAVE_V1 = 'rendller:dados:v1';
/** Cópia do conteúdo salvo que não pôde ser lido, para não perdê-lo. */
export const CHAVE_ILEGIVEL = 'rendller:dados:ilegivel';

/**
 * Lê os dados salvos: a chave v2 e, sem ela, a v1 (migrada para v2). Se o conteúdo não puder ser lido,
 * guarda o bruto em `CHAVE_ILEGIVEL` e devolve `podeGravar: false`, para que o vazio não seja gravado por cima.
 */
export function carregarDe(s: Pick<Storage, 'getItem' | 'setItem'>): { dados: Dados; podeGravar: boolean } {
  let bruto: string | null = null;
  try {
    bruto = s.getItem(CHAVE) ?? s.getItem(CHAVE_V1);
    if (bruto == null) return { dados: dadosVazios(), podeGravar: true };
    return { dados: migrarDados(JSON.parse(bruto)), podeGravar: true };
  } catch {
    if (bruto != null) {
      try {
        s.setItem(CHAVE_ILEGIVEL, bruto);
      } catch {
        /* sem espaço: o bruto continua na chave de origem, que não é gravada */
      }
    }
    return { dados: dadosVazios(), podeGravar: false };
  }
}

function carregarLocal(): { dados: Dados; podeGravar: boolean } {
  try {
    return carregarDe(localStorage);
  } catch {
    // `localStorage` bloqueado: não dá para saber o que há salvo, então não grava.
    return { dados: dadosVazios(), podeGravar: false };
  }
}

/**
 * Dados guardados neste navegador. Se o que estava salvo não pôde ser lido, nada é gravado até o usuário
 * editar ou restaurar dados (`atualizar` / `substituir`). Atualizações automáticas (CDI) usam
 * `atualizarAuto`, que não libera a gravação.
 */
export function useDados() {
  const [estado, setEstado] = useState(carregarLocal);
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
  return { dados: estado.dados, atualizar, atualizarAuto, substituir, erroGravacao, ilegivel: !estado.podeGravar };
}

export function baixarArquivo(nome: string, conteudo: string, tipo = 'application/json') {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
