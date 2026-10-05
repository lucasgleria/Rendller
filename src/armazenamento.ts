import { useCallback, useEffect, useState } from 'react';
import { dadosVazios, normalizarParametros } from './domain/padroes';
import type { Dados } from './domain/types';

const CHAVE = 'rendller:dados:v1';

function carregar(): Dados {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return dadosVazios();
    const d = JSON.parse(bruto) as Dados;
    // Parâmetros novos ganham o valor padrão sem perder o que o usuário já configurou.
    return { ...d, parametros: normalizarParametros(d.parametros) };
  } catch {
    return dadosVazios();
  }
}

/** Dados guardados só neste navegador. Exporte um backup para levar a outro aparelho. */
export function useDados() {
  const [dados, setDados] = useState<Dados>(carregar);
  const [erroGravacao, setErro] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(dados));
      setErro(false);
    } catch {
      setErro(true);
    }
  }, [dados]);

  const atualizar = useCallback((f: (d: Dados) => Dados) => setDados((d) => f(d)), []);
  return { dados, atualizar, substituir: setDados, erroGravacao };
}

export function baixarArquivo(nome: string, conteudo: string, tipo = 'application/json') {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
