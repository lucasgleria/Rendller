import { getStore } from '@netlify/blobs';
import { tratarCofre, type Armazem, type Registro } from '../cofre';

// Netlify Function (v2): /api/cofre. Guarda os cofres cifrados no Netlify Blobs.
export default async (req: Request) => {
  const store = getStore({ name: 'rendller-cofres', consistency: 'strong' });
  const armazem: Armazem = {
    async ler(id) {
      const r = await store.getWithMetadata(id, { type: 'json' });
      return r ? { registro: r.data as Registro, etag: r.etag } : null;
    },
    async criar(id, registro) {
      return (await store.setJSON(id, registro, { onlyIfNew: true })).modified;
    },
    async atualizar(id, registro, etag) {
      return (await store.setJSON(id, registro, etag ? { onlyIfMatch: etag } : {})).modified;
    },
    async apagar(id) {
      await store.delete(id);
    },
  };
  return tratarCofre(req, armazem);
};

export const config = { path: '/api/cofre' };
