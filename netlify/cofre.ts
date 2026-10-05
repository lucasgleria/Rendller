/**
 * Cofre de sincronização. O servidor guarda só dados já criptografados no navegador (AES-GCM) e nunca vê a
 * frase-senha nem a chave. Cada cofre é identificado por um `id` derivado da frase; escrever e ler exige um
 * `token` também derivado dela, do qual o servidor guarda só o SHA-256.
 *
 * Concorrência: cada gravação informa a `versao` que o aparelho conhecia (`base`). Se outro aparelho gravou
 * antes, a resposta é 409 com a versão atual, e o aparelho decide o que fazer. A escrita é condicional no
 * armazenamento (ETag), então duas gravações simultâneas não se sobrescrevem.
 */

export interface Registro {
  versao: number;
  iv: string; // base64
  cifrado: string; // base64
  authHash: string; // SHA-256 (hex) do token
  atualizadoEm: string; // ISO 8601
}

export interface Armazem {
  ler(id: string): Promise<{ registro: Registro; etag?: string } | null>;
  /** false se já existir. */
  criar(id: string, r: Registro): Promise<boolean>;
  /** false se o registro mudou desde `etag`. */
  atualizar(id: string, r: Registro, etag: string | undefined): Promise<boolean>;
  apagar(id: string): Promise<void>;
}

const HEX64 = /^[0-9a-f]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** Tamanho máximo do conteúdo cifrado (base64). Uma carteira com anos de histórico fica muito abaixo disso. */
export const LIMITE_CIFRADO = 4_000_000;

const json = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function sha256(texto: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Comparação em tempo constante de dois hex de mesmo tamanho. */
function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function tratarCofre(req: Request, armazem: Armazem): Promise<Response> {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!HEX64.test(id) || !HEX64.test(token)) return json(400, { erro: 'Identificação inválida.' });
  const authHash = await sha256(token);

  const atual = await armazem.ler(id);
  if (atual && !iguais(atual.registro.authHash, authHash)) return json(403, { erro: 'Acesso negado.' });

  if (req.method === 'GET') {
    if (!atual) return json(404, { erro: 'Cofre não encontrado.' });
    const { versao, iv, cifrado, atualizadoEm } = atual.registro;
    return json(200, { versao, iv, cifrado, atualizadoEm });
  }

  if (req.method === 'DELETE') {
    if (atual) await armazem.apagar(id);
    return json(200, { ok: true });
  }

  if (req.method === 'PUT') {
    let corpo: { base?: unknown; iv?: unknown; cifrado?: unknown };
    try {
      corpo = await req.json();
    } catch {
      return json(400, { erro: 'Corpo inválido.' });
    }
    const { base, iv, cifrado } = corpo;
    if (!Number.isInteger(base) || (base as number) < 0) return json(400, { erro: 'Versão base inválida.' });
    if (typeof iv !== 'string' || !BASE64.test(iv) || iv.length > 32) return json(400, { erro: 'IV inválido.' });
    if (typeof cifrado !== 'string' || !BASE64.test(cifrado)) return json(400, { erro: 'Conteúdo inválido.' });
    if (cifrado.length > LIMITE_CIFRADO) return json(413, { erro: 'Conteúdo grande demais.' });

    const versaoAtual = atual?.registro.versao ?? 0;
    if (base !== versaoAtual) return json(409, { erro: 'Outro aparelho gravou antes.', versao: versaoAtual });
    const novo: Registro = { versao: versaoAtual + 1, iv, cifrado, authHash, atualizadoEm: new Date().toISOString() };
    const gravou = atual ? await armazem.atualizar(id, novo, atual.etag) : await armazem.criar(id, novo);
    if (!gravou) {
      const agora = await armazem.ler(id);
      return json(409, { erro: 'Outro aparelho gravou antes.', versao: agora?.registro.versao ?? 0 });
    }
    return json(200, { versao: novo.versao, atualizadoEm: novo.atualizadoEm });
  }

  return json(405, { erro: 'Método não permitido.' });
}
