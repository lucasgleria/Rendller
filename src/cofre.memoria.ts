import type { Armazem, Registro } from '../netlify/cofre';

// Só testes importam este arquivo.

/** Armazém em memória com ETag, como o Netlify Blobs. */
export function memoria(): Armazem & { mapa: Map<string, { registro: Registro; etag: string }>; atrapalhar?: () => void } {
  const mapa = new Map<string, { registro: Registro; etag: string }>();
  let n = 0;
  const a = {
    mapa,
    atrapalhar: undefined as undefined | (() => void),
    async ler(id: string) {
      return mapa.get(id) ?? null;
    },
    async criar(id: string, registro: Registro) {
      if (mapa.has(id)) return false;
      mapa.set(id, { registro, etag: `e${++n}` });
      return true;
    },
    async atualizar(id: string, registro: Registro, etag: string | undefined) {
      a.atrapalhar?.();
      if (mapa.get(id)?.etag !== etag) return false;
      mapa.set(id, { registro, etag: `e${++n}` });
      return true;
    },
    async apagar(id: string) {
      mapa.delete(id);
    },
  };
  return a;
}
