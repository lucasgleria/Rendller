/**
 * Criptografia da sincronização (só no navegador, Web Crypto).
 * frase-senha → PBKDF2-SHA256 (600 mil iterações) → HKDF → três valores independentes:
 *   id (nome do cofre no servidor) · token (autoriza ler/gravar) · chave AES-GCM 256 (cifra os dados).
 * O servidor recebe só id, token e o conteúdo cifrado; sem a frase, não consegue ler nada.
 * Para a sincronização, o cofre antigo é uma implementação de `Remoto & Cifra` (`remotoCofreAntigo`).
 */
import type { Cifra, Envelope, Remoto, RespostaRemota } from './remoto';

export type { Envelope } from './remoto';

const SAL = 'rendller:cofre:v1';
const ITERACOES = 600_000;
export const TAMANHO_MINIMO_FRASE = 12;

export interface Credenciais {
  id: string;
  token: string;
  chave: string; // base64 da chave AES (guardada neste aparelho para não pedir a frase de novo)
}

const enc = new TextEncoder();

function paraBase64(b: ArrayBuffer | Uint8Array): string {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

function deBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/** PBKDF2 da frase com o sal dado, seguido de HKDF: devolve a função que deriva cada subchave por `info`. */
async function derivador(frase: string, sal: string) {
  const normalizada = frase.normalize('NFKC').trim();
  if (normalizada.length < TAMANHO_MINIMO_FRASE) throw new Error(`Use uma frase-senha com pelo menos ${TAMANHO_MINIMO_FRASE} caracteres.`);
  const base = await crypto.subtle.importKey('raw', enc.encode(normalizada), 'PBKDF2', false, ['deriveBits']);
  const mestre = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(sal), iterations: ITERACOES }, base, 256);
  const hk = await crypto.subtle.importKey('raw', mestre, 'HKDF', false, ['deriveBits']);
  return (info: string) => crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) }, hk, 256);
}

export async function derivarCredenciais(frase: string): Promise<Credenciais> {
  const sub = await derivador(frase, SAL);
  const [id, token, chave] = await Promise.all([sub('id'), sub('token'), sub('aes-gcm')]);
  return { id: hex(id), token: hex(token), chave: paraBase64(chave) };
}

/**
 * Chave do cofre da conta (ADR-0003): sal ligado ao id da conta, então a mesma frase gera chaves diferentes em
 * contas diferentes e no cofre antigo. O id da conta é o dado autenticado do AES-GCM. A frase nunca sai daqui.
 */
export async function derivarChaveDaConta(frase: string, userId: string): Promise<{ id: string; chave: string }> {
  const sub = await derivador(frase, `rendller:conta:v1:${userId}`);
  return { id: userId, chave: paraBase64(await sub('aes-gcm')) };
}

/** Só o que a cifra usa: o id (dado autenticado) e a chave. */
type ChaveCofre = Pick<Credenciais, 'id' | 'chave'>;

async function chaveAes(c: ChaveCofre, uso: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', deBase64(c.chave), 'AES-GCM', false, [uso]);
}

export async function cifrar(c: ChaveCofre, dados: unknown): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const corpo = enc.encode(JSON.stringify(dados));
  // o id entra como dado autenticado: um conteúdo copiado de outro cofre não decifra aqui
  const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(c.id) }, await chaveAes(c, 'encrypt'), corpo);
  return { iv: paraBase64(iv), cifrado: paraBase64(cifrado) };
}

export async function decifrar(c: ChaveCofre, e: Envelope): Promise<unknown> {
  try {
    const claro = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: deBase64(e.iv), additionalData: enc.encode(c.id) },
      await chaveAes(c, 'decrypt'),
      deBase64(e.cifrado),
    );
    return JSON.parse(new TextDecoder().decode(claro));
  } catch {
    throw new Error('Não consegui decifrar os dados da nuvem com esta frase-senha.');
  }
}

// ---------- HTTP ----------

/** Mantido como alias: o tipo agora mora em `remoto.ts`. */
export type Resposta = RespostaRemota;

const URL_COFRE = '/api/cofre';

async function chamar(c: Credenciais, metodo: 'GET' | 'PUT' | 'DELETE', corpo?: unknown): Promise<Resposta> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const r = await fetch(`${URL_COFRE}?id=${c.id}`, {
      method: metodo,
      headers: { authorization: `Bearer ${c.token}`, ...(corpo ? { 'content-type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
      cache: 'no-store',
      signal: ctl.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 404) return { tipo: 'inexistente' };
    if (r.status === 403) return { tipo: 'negado' };
    if (r.status === 409) return { tipo: 'conflito', versao: j.versao ?? 0 };
    if (!r.ok) throw new Error(j.erro || `Servidor respondeu ${r.status}.`);
    return { tipo: 'ok', versao: j.versao ?? 0, envelope: j.iv ? { iv: j.iv, cifrado: j.cifrado } : undefined, atualizadoEm: j.atualizadoEm };
  } finally {
    clearTimeout(t);
  }
}

export const lerCofre = (c: Credenciais) => chamar(c, 'GET');
export const gravarCofre = (c: Credenciais, base: number, e: Envelope) => chamar(c, 'PUT', { base, ...e });
export const apagarCofre = (c: Credenciais) => chamar(c, 'DELETE');

/** O cofre antigo (`/api/cofre`, identificado só pela frase-senha) como `Remoto & Cifra`. Protocolo HTTP inalterado. */
export function remotoCofreAntigo(c: Credenciais): Remoto & Cifra {
  return {
    ler: () => lerCofre(c),
    gravar: (base, e) => gravarCofre(c, base, e),
    apagar: async () => {
      const r = await apagarCofre(c);
      if (r.tipo !== 'ok' && r.tipo !== 'inexistente') throw new Error('O servidor recusou apagar o cofre.');
    },
    cifrar: (dados) => cifrar(c, dados),
    decifrar: (e) => decifrar(c, e),
  };
}
