import { useEffect, useState, type ReactNode } from 'react';
import { lerNumero, mostrarNumero } from '../formato';

interface Base {
  rotulo: string;
  largo?: boolean;
  dica?: string;
}

function Campo({ rotulo, largo, dica, children }: Base & { children: ReactNode }) {
  return (
    <label className={`campo${largo ? ' largo' : ''}`} title={dica}>
      <span>{rotulo}</span>
      {children}
    </label>
  );
}

export function CampoTexto({ valor, onChange, ...b }: Base & { valor: string; onChange: (v: string) => void }) {
  return (
    <Campo {...b}>
      <input value={valor} onChange={(e) => onChange(e.target.value)} />
    </Campo>
  );
}

export function CampoData({ valor, onChange, invalido, ...b }: Base & { valor: string; onChange: (v: string) => void; invalido?: boolean }) {
  return (
    <Campo {...b}>
      <input type="date" value={valor} aria-invalid={invalido} onChange={(e) => onChange(e.target.value)} />
    </Campo>
  );
}

export function CampoSelect<T extends string>({
  valor,
  opcoes,
  onChange,
  ...b
}: Base & { valor: T; opcoes: readonly (T | { valor: T; rotulo: string })[]; onChange: (v: T) => void }) {
  return (
    <Campo {...b}>
      <select value={valor} onChange={(e) => onChange(e.target.value as T)}>
        {opcoes.map((o) => {
          const v = typeof o === 'string' ? o : o.valor;
          return (
            <option key={v} value={v}>
              {typeof o === 'string' ? o : o.rotulo}
            </option>
          );
        })}
      </select>
    </Campo>
  );
}

/**
 * Número digitado em pt-BR. `escala` converte a exibição: 100 para percentuais
 * (o usuário digita 103 e o valor guardado é 1,03).
 */
export function CampoNumero({
  valor,
  onChange,
  sufixo,
  escala = 1,
  casas = 2,
  invalido,
  ...b
}: Base & {
  valor: number | null;
  onChange: (v: number | null) => void;
  sufixo?: string;
  escala?: number;
  casas?: number;
  invalido?: boolean;
}) {
  const exibir = (v: number | null) => (v == null ? '' : mostrarNumero(v * escala, casas));
  const [texto, setTexto] = useState(exibir(valor));
  useEffect(() => {
    const atual = lerNumero(texto);
    const externo = valor == null ? null : valor * escala;
    if (atual == null ? externo != null : externo == null || Math.abs(atual - externo) > 1e-9) setTexto(exibir(valor));
  }, [valor]);
  return (
    <Campo {...b}>
      <div className="sufixo">
        <input
          inputMode="decimal"
          value={texto}
          aria-invalid={invalido}
          onChange={(e) => {
            setTexto(e.target.value);
            const n = lerNumero(e.target.value);
            onChange(n == null ? null : n / escala);
          }}
        />
        {sufixo && <em>{sufixo}</em>}
      </div>
    </Campo>
  );
}

export function CampoCheck({ valor, onChange, rotulo }: { valor: boolean; onChange: (v: boolean) => void; rotulo: string }) {
  return (
    <label className="campo check">
      <input type="checkbox" checked={valor} onChange={(e) => onChange(e.target.checked)} />
      {rotulo}
    </label>
  );
}
