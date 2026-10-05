import { useCallback, useEffect, useRef, useState } from 'react';
import { aplicarConsultaCdi, inicioConsulta } from './domain/cdi';
import { somaDias } from './domain/datas';
import type { Dados, ISODate } from './domain/types';
import { buscarCdiBcb } from './servicos';

/** Dias para trás reconsultados a cada atualização (o Banco Central pode publicar ou revisar com atraso). */
const FOLGA_DIAS = 10;

export interface EstadoCdi {
  carregando: boolean;
  erro: string | null;
}

/**
 * Mantém o CDI realizado em dia: consulta o Banco Central ao abrir o app (uma vez por dia) e sob demanda.
 * Sem internet, o app segue com o último histórico salvo.
 */
export function useCdiOnline(dados: Dados, atualizar: (f: (d: Dados) => Dados) => void, hoje: ISODate) {
  const [estado, setEstado] = useState<EstadoCdi>({ carregando: false, erro: null });
  const emCurso = useRef(false);
  const dadosRef = useRef(dados);
  dadosRef.current = dados;

  const atualizarCdi = useCallback(async () => {
    if (emCurso.current) return;
    emCurso.current = true;
    setEstado({ carregando: true, erro: null });
    try {
      const d = dadosRef.current;
      const datas = d.aportes.map((a) => a.dataAporte).filter(Boolean).sort();
      const desde = inicioConsulta(d.parametros.cdiDiario, datas[0] ?? null, hoje, FOLGA_DIAS);
      const novos = await buscarCdiBcb(desde, hoje);
      atualizar((x) => ({ ...x, parametros: aplicarConsultaCdi(x.parametros, novos, hoje) }));
      setEstado({ carregando: false, erro: null });
    } catch (e) {
      const msg = (e as Error).name === 'AbortError' ? 'O Banco Central não respondeu a tempo.' : (e as Error).message || 'Falha de rede.';
      setEstado({ carregando: false, erro: `Não consegui atualizar o CDI: ${msg} Usando o último histórico salvo.` });
    } finally {
      emCurso.current = false;
    }
  }, [atualizar, hoje]);

  // Consulta uma vez por dia e também quando entra um aporte mais antigo que o histórico salvo.
  const maisAntigo = dados.aportes.reduce<ISODate>((m, a) => (a.dataAporte && (!m || a.dataAporte < m) ? a.dataAporte : m), '');
  useEffect(() => {
    const p = dadosRef.current.parametros;
    const primeiro = p.cdiDiario[0]?.data;
    const descoberto = !!maisAntigo && maisAntigo < hoje && (!primeiro || maisAntigo < somaDias(primeiro, -FOLGA_DIAS));
    if (p.cdiAtualizadoEm !== hoje || descoberto) void atualizarCdi();
  }, [atualizarCdi, hoje, maisAntigo]);

  return { estadoCdi: estado, atualizarCdi };
}
