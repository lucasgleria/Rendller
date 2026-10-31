# Classes bancárias e conta com cofre cifrado: plano de implementação

> **Para quem executar:** siga as fases em ordem, uma por vez. Cada fase termina com `npm test` e `npm run build` passando, o app funcionando em produção e um commit. Os passos usam caixas `- [ ]` para acompanhamento. Uma fase pode ser publicada sozinha.

**Objetivo:** aceitar CDB, RDB, LC, LCI e LCA e trocar o "cofre por frase-senha" por uma **conta** (Supabase) com os mesmos dados cifrados em qualquer aparelho, migrando o que já existe sem perder nada.

**Arquitetura:** o motor continua puro em `src/domain/`. A classe de ativo ganha um **regime tributário** vindo de `Parametros`. O formato salvo passa a `Dados` versão 2, e `migrarDados()` lê a v1 para sempre. A sincronização passa a depender de uma interface `Remoto`, com duas implementações: o cofre antigo (Netlify) e o cofre da conta (Supabase). A cifra continua no navegador, com a chave derivada da frase-senha e do id da conta. A migração para a conta roda no navegador, baixa um backup antes de gravar e nunca apaga a origem.

**Stack:** React 19, TypeScript 7, Vite 8, Vitest 5, Web Crypto, `@supabase/supabase-js` (carregado sob demanda), Supabase Auth + Postgres (plano Free), Netlify (hospedagem).

**Decisões que este plano implementa:** [ADR-0001](adr/0001-classes-bancarias-primeiro.md) · [ADR-0002](adr/0002-supabase-auth-e-postgres.md) · [ADR-0003](adr/0003-criptografia-ponta-a-ponta-continua.md) · [ADR-0004](adr/0004-migracao-no-navegador.md) · termos em [GLOSSARY.md](../GLOSSARY.md). Regras do projeto: [CLAUDE.md](../CLAUDE.md).

## Restrições globais

- `src/domain/` fica puro: sem React, sem DOM, sem `localStorage`, sem rede.
- Nenhuma taxa, alíquota, isenção, carência ou limite fica no código de cálculo. Tudo vem de `Parametros` (CLAUDE.md §3.5, §9).
- Rendimento usa dias úteis; IR e IOF usam dias corridos (§3.3).
- Dado do usuário só sai do navegador cifrado com AES-GCM. A frase-senha e a chave derivada nunca são enviadas, registradas nem gravadas no servidor (§9).
- Nenhuma fase apaga dados do usuário. As chaves `rendller:dados:v1` e `rendller:sync:v1` e o cofre antigo continuam intactos até a Fase 7.
- `migrarDados()` aceita `versao: 1` e `versao: 2` para sempre.
- Valores regulatórios novos (isenções e carência de LCI/LCA, cobertura do FGC por classe) só entram depois de conferidos em fonte oficial, com fonte e data no próprio regime (§3.6). Valores esperados nos testes são conferidos por um segundo caminho (§6).
- Interface em pt-BR, valores futuros marcados como **estimativa** (§7).
- Custo zero: Supabase Free, Netlify Free e GitHub Actions em repositório público.
- Todo commit termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Foco da revisão

Situações que nenhuma regra do domínio cobre diretamente, mas que mais podem machucar o usuário. Cada uma ganhou um teste na fase dona do código.

1. **`localStorage` ilegível ou migração com erro na abertura:** hoje `carregar()` devolve dados vazios e o efeito grava esse vazio por cima. O esperado é guardar o conteúdo bruto antes e nunca gravar vazio sobre dados existentes. → Fase 1, `carregarDe()`.
2. **Frase-senha diferente num segundo aparelho, com a conta já preenchida:** a decifração falha. O esperado é mostrar o erro e **nunca** oferecer "enviar meus dados", porque isso apagaria o cofre cifrado com a frase certa. → Fase 4 e Fase 5.
3. **Aparelho novo (vazio) entrando numa conta com dados:** o esperado é baixar da conta. Um navegador vazio nunca sobrescreve a conta. → Fase 5.
4. **Conteúdo com versão futura (`versao: 3`), ou app antigo em cache recebendo v2:** o esperado é recusar com mensagem clara e não gravar nada. → Fase 1.
5. **Projeto Supabase pausado ou sessão expirada com alterações pendentes:** o esperado é o app seguir no `localStorage`, mostrar "nuvem indisponível" (ou "entre de novo") e enviar quando voltar. → Fase 4.

## Boas práticas de React que valem aqui (Vite, sem Next.js)

Da skill *vercel-react-best-practices*, só as regras que se aplicam a um SPA com Vite. As regras `server-*`, RSC, `next/dynamic` e hidratação foram ignoradas.

| Regra | Onde |
|---|---|
| `bundle-conditional` / `bundle-dynamic-imports`: carregar o módulo só quando a função é usada (com `import()`, não `next/dynamic`) | `@supabase/supabase-js` só é importado quando há sessão salva ou o usuário abre "Entrar com conta" (Fase 4). O bundle de quem não usa conta não cresce. |
| `advanced-init-once` | Um único cliente Supabase por carga do app (promessa no módulo) e uma única assinatura de `onAuthStateChange` (Fase 4). |
| `async-parallel` | Ler o cofre antigo e o cofre da conta com `Promise.all` na migração (Fase 5). Derivar a chave (PBKDF2, lento) em paralelo com a leitura remota (Fase 4). |
| `client-localstorage-schema` / `js-cache-storage` | Chaves novas com versão (`rendller:dados:v2`, `rendller:conta:v1`), conteúdo mínimo e `try/catch` em toda leitura e gravação (Fases 1 e 4). |
| `rerender-move-effect-to-event` | A migração roda no tratador do login bem-sucedido, não num `useEffect` que dispara sozinho (Fase 5). |
| `rerender-lazy-state-init` / `rerender-functional-setstate` | Manter `useState(carregar)` e os `setDados(d => …)` atuais ao trocar `carregar` por `carregarDe` (Fase 1). |
| `rerender-derived-state-no-effect` | O rótulo do aporte (classe + indexador) é derivado na renderização, sem estado próprio (Fase 1). |
| `rendering-conditional-render` | Usar ternário, não `&&` com número, nos avisos de contagem ("0 aportes") das telas novas (Fases 4 e 5). |

## Mapa de arquivos

| Arquivo | Fase | Responsabilidade |
|---|---|---|
| `src/domain/types.ts` | 1, 2 | `Classe`, `RegimeTributario`, `Dados.versao: 2` |
| `src/domain/migracao.ts` (novo) | 1, 5 | `migrarDados()` (formato) e `planejarMigracao()` (decisão pura da migração para a conta) |
| `src/domain/migracao.test.ts` (novo) | 1, 5 | Testes de formato e de planejamento |
| `src/domain/padroes.ts` | 1, 2 | Regimes padrão; `normalizarParametros()` completa `regimes` |
| `src/domain/calculo.ts` | 2 | `regimeDe()`, `fimCarencia()`, IR/IOF conforme o regime |
| `src/domain/carteira.ts` | 2 | FGC soma só as classes com FGC |
| `src/armazenamento.ts` (+ `.test.ts`) | 1 | `carregarDe()`: chave v2, leitura da v1, guarda do ilegível |
| `src/remoto.ts` (novo) | 3 | Interfaces `Remoto`, `Cifra`, `RespostaRemota` |
| `src/remoto.contrato.ts` (novo) | 3 | Contrato de teste compartilhado (só importado por testes) |
| `src/cofre.ts` | 3, 4 | Cofre antigo como `Remoto`; `derivarChaveDaConta()` |
| `src/conta.ts` (+ `.test.ts`) | 4 | Cliente Supabase sob demanda, sessão, `remotoDaConta()` |
| `supabase/migrations/20261101000000_cofres.sql` (novo) | 4 | Tabela `cofres`, RLS, `gravar_cofre()`, `ping()` |
| `src/migracaoConta.ts` (+ `.test.ts`) | 5 | Orquestra a migração para a conta (efeitos injetáveis) |
| `src/sincronizacao.ts` | 3, 4 | Hook usa `Remoto & Cifra` em vez de chamar `/api/cofre` direto |
| `src/components/CartaoSincronizacao.tsx`, `src/pages/*.tsx` | 1, 2, 4, 5 | Telas |
| `.github/workflows/manter-supabase.yml` (novo) | 6 | Consulta leve agendada contra a pausa |

---

## Fase 1: formato v2 e migração de formato (sem mudança de comportamento)

Ao final: o app lê v1 de qualquer origem, grava v2 numa chave nova e mostra a classe no lugar do antigo "tipo". Os números da carteira continuam idênticos.

**Arquivos:** criar `src/domain/migracao.ts`, `src/domain/migracao.test.ts`, `src/armazenamento.test.ts`. Modificar `src/domain/types.ts`, `src/domain/padroes.ts`, `src/domain/importacao.ts` (`validarBackup`, `novoAporte` no import), `src/domain/sincronia.ts` (`daNuvem` aceita v1), `src/armazenamento.ts`, `src/pages/Aportes.tsx` (select `TIPOS` → `CLASSES`), `src/formato.ts`.

**Interfaces produzidas:**
```ts
// types.ts
export type Classe = 'CDB' | 'Outro';                 // a Fase 2 amplia
export interface RegimeTributario {
  ir: 'regressivo' | 'isento';
  iof: boolean;
  fgc: boolean;
  carenciaMinimaDias: number;   // dias corridos; 0 = sem mínimo
  fonte: string;                // de onde veio a regra, com data
}
// Aporte: remove `tipo`, ganha `classe: Classe`
// Parametros: ganha `regimes: Record<Classe, RegimeTributario>`
// Dados: `versao: 2`
// migracao.ts
export function migrarDados(obj: unknown): Dados;          // v1|v2 → v2; lança Error para o resto
export function classeDoTipoV1(tipo: unknown): Classe;     // 'CDB Pós-fixado'|'CDB Prefixado'|'CDB IPCA+' → 'CDB'; resto → 'Outro'
// armazenamento.ts
export const CHAVE = 'rendller:dados:v2';
export const CHAVE_V1 = 'rendller:dados:v1';               // só leitura até a Fase 7
export const CHAVE_ILEGIVEL = 'rendller:dados:ilegivel';
export function carregarDe(s: Pick<Storage, 'getItem' | 'setItem'>): { dados: Dados; podeGravar: boolean };
// formato.ts
export function rotuloAporte(a: Aporte): string;           // ex.: "CDB · 103% do CDI", "CDB · Prefixado"
```
Regimes padrão nesta fase (o comportamento atual, sem valor regulatório novo): `CDB` e `Outro` = `{ ir: 'regressivo', iof: true, fgc: true, carenciaMinimaDias: 0 }`. `Outro` mantém `fgc: true` porque hoje todo lote conta no FGC; mudar isso alteraria números sem aviso.

- [ ] **Passo 1: escrever os testes que falham** em `src/domain/migracao.test.ts`:
  - `v1 vira v2 sem perder aporte`: fixture v1 com os 3 aportes da carteira real (tipo `'CDB Pós-fixado'`), um com `resgate` e um com `divisao`. Esperado: `versao === 2`; mesmos `id` na mesma ordem; `classe === 'CDB'`; `'tipo' in a === false`; todos os outros campos de cada aporte iguais (`toEqual` após remover `tipo`).
  - `'Outro renda fixa' vira classe Outro`.
  - `é idempotente`: `migrarDados(migrarDados(v1))` `toEqual` `migrarDados(v1)`.
  - `parâmetros v1 ganham regimes padrão sem perder o que foi configurado`: `cdiAnual`, `feriados` e `tabelaIR` da fixture preservados; `regimes.CDB` presente.
  - `números da carteira real não mudam`: `avaliar()` de cada aporte migrado nas datas de referência de `calculo.test.ts` (bloco "carteira real da planilha") devolve os mesmos `liquido`, `ir` e `iof` do teste existente. Reaproveite as constantes de lá, sem copiar números novos.
  - `rejeita lixo e versão futura`: `null`, `{}`, `{ versao: 3, aportes: [], parametros: {} }` e `{ versao: 1, aportes: 'x' }` lançam `Error`. A mensagem da versão 3 contém `"versão mais nova do app"`.

  Em `src/armazenamento.test.ts`, com um `Storage` em memória:
  - `só v1 salva: migra e não apaga a v1`: depois de `carregarDe`, `dados.versao === 2` e `getItem(CHAVE_V1)` continua igual ao original.
  - `v2 salva tem prioridade sobre v1`.
  - `conteúdo ilegível é guardado e não é sobrescrito`: `CHAVE_V1 = '{quebrado'` → `podeGravar === false` e `getItem(CHAVE_ILEGIVEL) === '{quebrado'`.
  - `navegador vazio`: `dadosVazios()` com `podeGravar === true`.

  Em `src/sincronizacao.test.ts`: `daNuvem aceita conteúdo v1 do cofre antigo e devolve v2`.
- [ ] **Passo 2:** rodar `npx vitest run src/domain/migracao.test.ts src/armazenamento.test.ts`. Esperado: FALHA (`migrarDados` não existe).
- [ ] **Passo 3: implementar.**
  - `migrarDados` substitui o corpo de `validarBackup` (que passa a chamá-la) e é usada por `daNuvem`.
  - `carregarDe` lê `CHAVE`, senão `CHAVE_V1`. Em erro de leitura ou de migração, copia o bruto para `CHAVE_ILEGIVEL` e devolve `podeGravar: false`.
  - `useDados` usa `useState(() => carregarDe(localStorage))` e só grava em `CHAVE` quando `podeGravar` for verdadeiro ou depois da primeira edição do usuário. Sem `podeGravar`, mostra o aviso "Dados salvos ilegíveis; cópia guardada. Restaure um backup."
  - `paraNuvem` passa a emitir `versao: 2`.
- [ ] **Passo 4:** `npm test` e `npm run build`. Esperado: tudo passa, inclusive os testes antigos de `calculo.test.ts`.
- [ ] **Passo 5:** conferência manual com `npm run dev`. Com um `rendller:dados:v1` copiado de um backup real: a carteira aparece igual, a classe aparece como "CDB" e as duas chaves existem no DevTools.
- [ ] **Passo 6:** commit `feat: formato v2 com classe de ativo e leitura permanente da v1`.

## Fase 2: classes RDB, LC, LCI e LCA com regime tributário

Ao final: o usuário cadastra e simula as cinco classes. O IR, o IOF, o FGC e a carência seguem o regime de cada classe, editável em Parâmetros.

**Arquivos:** modificar `src/domain/types.ts`, `src/domain/padroes.ts`, `src/domain/calculo.ts`, `src/domain/carteira.ts`, `src/domain/calculo.test.ts`, `src/pages/Aportes.tsx`, `src/pages/Simulador.tsx`, `src/pages/Parametros.tsx`, `src/pages/Instituicoes.tsx`.

**Interfaces:**
- Consome: `RegimeTributario`, `Parametros.regimes` (Fase 1).
- Produz:
```ts
export type Classe = 'CDB' | 'RDB' | 'LC' | 'LCI' | 'LCA' | 'Outro';
export function regimeDe(a: Aporte, p: Parametros): RegimeTributario;   // p.regimes[a.classe] ?? p.regimes.Outro
export function fimCarencia(a: Aporte, p: Parametros): ISODate | '';   // a maior entre a.carenciaAte e dataAporte + carenciaMinimaDias
// GrupoInstituicao (carteira.ts) ganha: exposicaoSemFgc: number
```

- [ ] **Passo 1: conferir os fatos regulatórios na fonte oficial e registrar.** Para cada classe nova, anotar no `fonte` do regime a fonte e a data da consulta. Não use valores de memória.
  - IR para pessoa física: LCI e LCA (Receita Federal; verificar se houve mudança legal em 2025–2026).
  - IOF sobre LCI e LCA.
  - Carência mínima de LCI e LCA (resoluções do CMN vigentes).
  - Cobertura do FGC para RDB, LC, LCI e LCA (site do FGC).

  RDB e LC seguem o regime do CDB se as fontes confirmarem. Atualize `premissasVersao` e `premissasFonte`. Se algum fato não puder ser confirmado, pare e pergunte ao usuário antes de seguir.
- [ ] **Passo 2: escrever os testes que falham** em `calculo.test.ts`. Use um `Parametros` montado no próprio teste, com regimes explícitos, para que os testes não dependam dos valores regulatórios padrão:
  - `classe isenta: IR zero e IOF conforme o regime`: LCA, 95% do CDI, 400 dias, regime `{ ir: 'isento', iof: false, … }` → `ir === 0`, `iof === 0`, `liquido` `toBeCloseTo(bruto, 10)`.
  - `compara CDB e LCA pelo líquido, não pelo % do CDI`: CDB 110% e LCA 95% no mesmo período. `cdb.ir` `toBeCloseTo(cdb.rendimentoBruto * 0.175, 10)` (365 dias corridos). Os líquidos esperados vêm de um cálculo independente (planilha ou script separado) anotado no comentário do teste.
  - `carência mínima da classe bloqueia resgate parcial`: regime com `carenciaMinimaDias: 90`, `carenciaAte: ''`, resgate no dia 60 → `{ erro: 'O lote ainda está em carência.' }`; no dia 91, permitido.
  - `validarAporte acusa carência menor que a mínima`: `carenciaAte` antes de `dataAporte + 90` → contém `'Carência menor que a mínima da classe'`.
  - `FGC soma só classes com FGC`: dois lotes no mesmo conglomerado, um com regime `fgc: false` → `exposicaoFgc` conta só o outro; `exposicaoSemFgc` conta o lote sem FGC.
  - `classe sem regime cai em Outro e não quebra`.
  - Sanidade: rendimento ≥ 0 e líquido ≤ bruto em todas as classes.

  Em `padroes.ts`, adicione o teste `regimes padrão vêm com fonte` (todo regime com `fonte` não vazia).
- [ ] **Passo 3:** rodar `npx vitest run src/domain/calculo.test.ts`. Esperado: FALHA.
- [ ] **Passo 4: implementar.**
  - `avaliar`: `pctIof = regime.iof ? percentualIOF(dc, p) : 0`; `aliquotaIr = regime.ir === 'isento' ? 0 : aliquotaIR(dc, p)`. A ordem dos impostos não muda.
  - `resgatarParcial` usa `fimCarencia`.
  - Telas: select de classe em Aportes e no Simulador; a tabela de regimes é editável em Parâmetros; Instituições mostra "sem FGC" quando `exposicaoSemFgc > 0`.
  - `normalizarParametros` completa as classes que faltarem com os padrões.
- [ ] **Passo 5:** `npm test` e `npm run build`. Esperado: tudo passa.
- [ ] **Passo 6:** atualizar o CLAUDE.md: §4 (regime por classe), §5 (FGC por classe) e §6 (novos itens obrigatórios: classe isenta, carência mínima, FGC por classe).
- [ ] **Passo 7:** commit `feat: classes RDB, LC, LCI e LCA com regime tributário em Parametros`.

## Fase 3: sincronização sobre a interface `Remoto` (sem mudança de comportamento)

Ao final: o hook de sincronização não conhece mais `/api/cofre`. O cofre antigo é só uma implementação de `Remoto`. O usuário não vê diferença.

**Arquivos:** criar `src/remoto.ts` e `src/remoto.contrato.ts`. Modificar `src/cofre.ts`, `src/sincronizacao.ts`, `src/sincronizacao.test.ts`.

**Interfaces produzidas:**
```ts
// remoto.ts
export type RespostaRemota =
  | { tipo: 'ok'; versao: number; envelope?: Envelope; atualizadoEm?: string }
  | { tipo: 'conflito'; versao: number }
  | { tipo: 'inexistente' }
  | { tipo: 'negado' };
export interface Remoto {
  ler(): Promise<RespostaRemota>;
  gravar(base: number, e: Envelope): Promise<RespostaRemota>;
  apagar(): Promise<void>;
}
export interface Cifra {
  cifrar(dados: unknown): Promise<Envelope>;
  decifrar(e: Envelope): Promise<unknown>;
}
// remoto.contrato.ts (importa vitest; nunca importado pelo app)
/** Contrato compartilhado: roda os mesmos casos contra qualquer implementação. */
export function contratoRemoto(nome: string, fabrica: () => Promise<Remoto & Cifra>): void; // registra describe/it do Vitest
// cofre.ts
export function remotoCofreAntigo(c: Credenciais): Remoto & Cifra;
// cifrar/decifrar passam a aceitar Pick<Credenciais, 'id' | 'chave'> (o id é o dado autenticado)
```
`ConfigSync` ganha `origem: 'cofre-antigo'`. Uma config v1 sem `origem` é lida como `'cofre-antigo'`.

- [ ] **Passo 1: escrever o contrato** em `src/remoto.contrato.ts`, com estes casos:
  - `ler` num cofre vazio dá `inexistente`;
  - `gravar(0, e)` dá `ok` com `versao` 1;
  - `gravar(0, e)` de novo dá `conflito` com `versao` 1;
  - `gravar(1, e2)` dá `versao` 2 e `ler` devolve `e2`;
  - `cifrar`→`decifrar` faz a ida e volta;
  - um envelope de outra chave não decifra.
- [ ] **Passo 2:** em `sincronizacao.test.ts`, rodar `contratoRemoto('cofre antigo', …)` com o `fetch` desviado para `tratarCofre` + `memoria()` (padrão já usado no arquivo). Rodar `npx vitest run src/sincronizacao.test.ts`. Esperado: FALHA (`remotoCofreAntigo` não existe).
- [ ] **Passo 3: implementar** `remotoCofreAntigo` sobre `lerCofre`, `gravarCofre`, `apagarCofre`, `cifrar` e `decifrar`. Trocar no hook as chamadas diretas por `abrirRemoto(config): Remoto & Cifra`.
- [ ] **Passo 4:** `npm test` e `npm run build`. Esperado: os testes antigos de "dois aparelhos" e o contrato passam.
- [ ] **Passo 5:** commit `refactor: sincronização sobre a interface Remoto`.

## Fase 4: conta no Supabase com cofre cifrado (convive com o cofre antigo)

Ao final: em Parâmetros → Sincronização existe "Entrar com conta". Depois do login, o usuário digita a frase-senha e passa a sincronizar pela conta. O cofre antigo continua funcionando para quem não entrou. Sem as variáveis do Supabase no build, a opção não aparece e o app segue como antes.

**Arquivos:** criar `supabase/migrations/20261101000000_cofres.sql`, `src/conta.ts`, `src/conta.test.ts`, `.env.example`. Modificar `src/cofre.ts`, `src/sincronizacao.ts`, `src/components/CartaoSincronizacao.tsx`, `package.json` (dependência `@supabase/supabase-js`).

**Interfaces:**
- Consome: `Remoto`, `Cifra`, `contratoRemoto` (Fase 3).
- Produz:
```ts
// cofre.ts
export async function derivarChaveDaConta(frase: string, userId: string): Promise<{ id: string; chave: string }>;
//   PBKDF2-SHA256, 600_000 iterações, sal `rendller:conta:v1:${userId}` → HKDF info 'aes-gcm' → AES-GCM 256; id = userId (dado autenticado)
// conta.ts
export function contaDisponivel(): boolean;                     // import.meta.env.VITE_SUPABASE_URL && VITE_SUPABASE_PUBLISHABLE_KEY
export async function sessaoAtual(): Promise<{ userId: string; email: string } | null>;
export async function entrar(email: string, senha: string): Promise<{ userId: string; email: string }>;
export async function criarConta(email: string, senha: string): Promise<void>;   // pede confirmação por e-mail
export async function sair(): Promise<void>;
export function remotoDaConta(cliente: ClienteCofre, chave: { id: string; chave: string }): Remoto & Cifra;
export interface ClienteCofre {   // o recorte do SupabaseClient que usamos; facilita o falso nos testes
  rpc(fn: 'gravar_cofre', args: { base: number; p_iv: string; p_cifrado: string }): Promise<{ data: { versao: number; conflito: boolean }[] | null; error: { message: string; code?: string } | null }>;
  from(t: 'cofres'): { select(c: string): { maybeSingle(): Promise<{ data: { versao: number; iv: string; cifrado: string; atualizado_em: string } | null; error: { message: string; code?: string } | null }> }; delete(): { eq(c: 'user_id', v: string): Promise<{ error: unknown }> } };
}
// ConfigSync: origem: 'cofre-antigo' | 'conta'; com 'conta', guarda { userId, chave } em vez das credenciais do cofre antigo
// nova chave localStorage: 'rendller:conta:v1' = { userId, chave, versao, impressao, ultimaSync, migradoEm?: string }
```

**SQL (`supabase/migrations/20261101000000_cofres.sql`):**
- `create table public.cofres (user_id uuid primary key default auth.uid() references auth.users on delete cascade, versao int not null check (versao > 0), iv text not null, cifrado text not null check (length(cifrado) <= 4000000), atualizado_em timestamptz not null default now());`
- `alter table public.cofres enable row level security;` com políticas `select`, `insert`, `update` e `delete` para `authenticated` usando `user_id = (select auth.uid())`. `revoke all on public.cofres from anon;`
- `gravar_cofre(base int, p_iv text, p_cifrado text) returns table(versao int, conflito boolean)`, `security invoker`, `set search_path = ''`. Com `base = 0`: `insert … on conflict (user_id) do nothing`. Com `base > 0`: `update … set versao = base + 1 … where user_id = auth.uid() and versao = base`. Se nenhuma linha mudou, devolve a versão atual com `conflito = true`. A condição numa única instrução impede duas gravações simultâneas de se sobrescreverem, como o ETag faz hoje.
- `ping() returns int language sql stable as 'select 1'`, com `grant execute` para `anon` (usada pela Fase 6).

- [ ] **Passo 1: configurar o Supabase (manual, feito pelo usuário com o executor guiando).**
  - Criar o projeto Free (região São Paulo).
  - Em Auth: provedor e-mail ligado, "Confirm email" ligado, Site URL `https://rendller.netlify.app` e redirect URLs com `http://localhost:5173`.
  - Criar a própria conta e depois **desligar "Allow new users to sign up"**. O app é de um usuário só, e isso protege a cota.
  - Aplicar o SQL (SQL Editor ou `supabase db push`).
  - Pôr `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` nas variáveis do Netlify e num `.env.local` (nunca commitado; o `.env.example` vai sem valores).
- [ ] **Passo 2: verificar o SQL à mão no SQL Editor**, simulando dois usuários com `set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>"}';`:
  - `gravar_cofre(0, …)` dá `(1, false)`;
  - repetir dá `(1, true)`;
  - `gravar_cofre(1, …)` dá `(2, false)`;
  - o outro `sub` não enxerga a linha no `select`;
  - como `anon`, o `select` em `cofres` falha.

  Anote o resultado no commit.
- [ ] **Passo 3: escrever os testes que falham** em `src/conta.test.ts`:
  - `contratoRemoto('conta', …)` com um `ClienteCofre` falso em memória que reproduz a semântica do SQL acima.
  - `mesma frase em contas diferentes gera chaves diferentes e não decifra cruzado`.
  - `chave da conta difere da chave do cofre antigo para a mesma frase`.
  - `frase errada numa conta com dados: erro de decifração e nenhuma gravação` (Foco 2). O falso registra chamadas a `rpc`; esperado: zero.
  - `projeto pausado ou erro 5xx vira status 'offline' com a mensagem 'Nuvem indisponível'` (Foco 5). O falso devolve `error` com `code: 'PGRST'`/HTTP 503.
  - `sessão expirada (401) com alteração pendente: status 'erro' com 'Entre na conta de novo' e os dados locais intactos` (Foco 5).
- [ ] **Passo 4:** rodar `npx vitest run src/conta.test.ts`. Esperado: FALHA.
- [ ] **Passo 5: implementar.**
  - `conta.ts` guarda numa variável do módulo uma única promessa `const cliente = import('@supabase/supabase-js').then(m => m.createClient(url, chave))`, criada só na primeira chamada (`bundle-conditional`, `advanced-init-once`).
  - O cartão de sincronização ganha o fluxo: e-mail + senha da conta → frase-senha → ativa. Explique na tela que **senha da conta** e **frase-senha** são segredos diferentes.
  - Ao ativar, `derivarChaveDaConta` e `remoto.ler()` rodam em `Promise.all` (`async-parallel`).
  - Se a conta já tiver um cofre e a decifração falhar, mostre "Frase-senha diferente da usada nesta conta" e não ofereça envio.
- [ ] **Passo 6:** `npm test` e `npm run build`. Conferir que o bundle inicial não inclui o Supabase (`npx vite build` e procurar `supabase` só num chunk separado em `dist/assets`).
- [ ] **Passo 7:** conferência manual em dois navegadores com a mesma conta: editar num, ver no outro; editar nos dois offline e ver a tela de conflito.
- [ ] **Passo 8:** commit `feat: conta no Supabase com cofre cifrado de ponta a ponta`.

## Fase 5: migração dos dados existentes para a conta

Ao final: no primeiro login de cada aparelho, o app junta o navegador, o cofre antigo (se ativo) e a conta. Baixa um backup `.json` antes de gravar qualquer coisa e envia, baixa ou pede escolha. Nunca apaga nem funde. Backups `.json` v1 importados depois também vão para a conta como v2.

**Arquivos:** criar `src/migracaoConta.ts`, `src/migracaoConta.test.ts`. Modificar `src/domain/migracao.ts`, `src/domain/migracao.test.ts`, `src/components/CartaoSincronizacao.tsx`, `src/sincronizacao.ts`.

**Interfaces:**
- Consome: `migrarDados` (Fase 1), `remotoCofreAntigo` (Fase 3), `remotoDaConta` e `derivarChaveDaConta` (Fase 4), `impressao` (`sincronia.ts`).
- Produz:
```ts
// domain/migracao.ts (puro)
export type OrigemDados = 'navegador' | 'cofre-antigo' | 'conta';
export interface Candidato { origem: OrigemDados; dados: Dados; aportes: number }
export type PlanoMigracao =
  | { acao: 'nada' }                                // tudo igual ao que está na conta
  | { acao: 'enviar'; dados: Dados; origem: OrigemDados }
  | { acao: 'baixar'; dados: Dados }                // conta tem dados; aparelho vazio
  | { acao: 'escolher'; candidatos: Candidato[] };  // há mais de uma versão diferente com aportes
export function planejarMigracao(navegador: Dados, cofreAntigo: Dados | null, conta: Dados | null): PlanoMigracao;
// migracaoConta.ts (efeitos injetáveis)
export interface DepsMigracao {
  lerNavegador(): Dados;
  lerCofreAntigo(): Promise<Dados | null>;          // null se não havia sincronização antiga; erro de rede ou acesso negado → null + aviso
  conta: Remoto & Cifra;
  baixarBackup(d: Dados, nome: string): void;       // download .json: `rendller-antes-da-conta-AAAA-MM-DD.json`
  guardarCopia(d: Dados): void;                     // localStorage 'rendller:copia-antes-da-conta'
  aplicarLocal(d: Dados): void;
  arquivarCofreAntigo(): void;                      // move 'rendller:sync:v1' → 'rendller:sync:v1:migrado'; NÃO chama apagar()
  marcarMigrado(em: string): void;                  // grava migradoEm em 'rendller:conta:v1'
}
export type ResultadoMigracao =
  | { tipo: 'concluida'; plano: PlanoMigracao; avisos: string[] }
  | { tipo: 'escolha-pendente'; candidatos: Candidato[] }
  | { tipo: 'falhou'; erro: string };              // nada local foi alterado
export async function migrarParaConta(d: DepsMigracao, agora: string): Promise<ResultadoMigracao>;
export async function concluirEscolha(d: DepsMigracao, escolhido: Candidato, agora: string): Promise<ResultadoMigracao>;
```
**Regras de `planejarMigracao`:** um candidato com `aportes === 0` é "vazio" e nunca vence quem tem aportes. Candidatos com a mesma `impressao` contam como um só. Com um único candidato não vazio: `conta` resulta em `baixar` (ou `nada` se o navegador já for igual); `navegador` ou `cofre-antigo` resultam em `enviar`. Com mais de um candidato diferente: `escolher`. Com todos vazios: `nada`.

**Ordem em `migrarParaConta`:**
1. Leituras em `Promise.all([lerCofreAntigo(), conta.ler()])`.
2. `planejarMigracao`.
3. Se o plano altera algo, **primeiro** `baixarBackup(navegador)` e `guardarCopia(navegador)`.
4. Executar o plano (`gravar(base, cifrar(paraNuvem(d)))` ou `aplicarLocal`).
5. `arquivarCofreAntigo()`.
6. `marcarMigrado(agora)`.

Uma falha em 1–4 devolve `falhou` sem executar 5 e 6, para que dê para repetir. Com `migradoEm` presente, `migrarParaConta` devolve `concluida` com `{ acao: 'nada' }`.

- [ ] **Passo 1: escrever os testes que falham** em `src/domain/migracao.test.ts` (puros):
  - `navegador com aportes e conta vazia: enviar do navegador`.
  - `navegador igual ao cofre antigo: um só candidato, enviar`.
  - `navegador diferente do cofre antigo: escolher entre os dois` (nunca funde: os candidatos trazem os dados inteiros de cada origem).
  - `aparelho novo vazio e conta com dados: baixar` (Foco 3).
  - `navegador com aportes e conta diferente: escolher, sem enviar`.
  - `tudo vazio: nada`.
  - `backup .json v1 importado: migrarDados e depois planejarMigracao com conta vazia dão enviar com versao 2`.

  Em `src/migracaoConta.test.ts`, com `DepsMigracao` falsas que registram a ordem das chamadas, `remotoDaConta` sobre o `ClienteCofre` falso da Fase 4 e o cofre antigo sobre `memoria()`:
  - `migra navegador + cofre antigo para a conta vazia sem perder nada`. Decifrando o que foi gravado na conta: mesmos `id` de aportes, mesma soma de `valor`, `versao === 2`, `classe` presente. `baixarBackup` foi chamado **antes** do primeiro `gravar`.
  - `cofre antigo nunca é apagado`: o armazém `memoria()` ainda contém o registro depois da migração, e `arquivarCofreAntigo` foi chamado uma vez.
  - `conflito não grava nada`: devolve `escolha-pendente` e nem `gravar` nem `aplicarLocal` são chamados. Depois, `concluirEscolha` com o candidato `navegador` grava e a cópia descartada fica em `guardarCopia`.
  - `segunda execução não faz nada` (com `migradoEm`).
  - `falha de rede ao gravar: resultado 'falhou', navegador intacto, cofre antigo não arquivado, repetir depois funciona`.
  - `cofre antigo inacessível (403/404 ou sem rede): migra o navegador e devolve um aviso`.
  - `frase errada numa conta com dados: 'falhou' com a mensagem de frase diferente, zero gravações` (Foco 2).
- [ ] **Passo 2:** rodar `npx vitest run src/domain/migracao.test.ts src/migracaoConta.test.ts`. Esperado: FALHA.
- [ ] **Passo 3: implementar** `planejarMigracao`, `migrarParaConta` e `concluirEscolha`. Ligar ao tratador de sucesso da ativação da conta (`rerender-move-effect-to-event`), não a um efeito. Mostrar o resumo: "N aportes enviados para a conta · backup salvo como … · cofre antigo mantido (apague em Parâmetros quando todos os aparelhos tiverem migrado)". A escolha de conflito reaproveita a tela existente, mostrando a origem e a contagem de aportes de cada candidato.
- [ ] **Passo 4:** `npm test` e `npm run build`. Esperado: tudo passa.
- [ ] **Passo 5: ensaio manual com dados reais**, antes de usar em produção:
  1. Exportar o backup atual pelo app publicado.
  2. Em `npm run dev`, restaurar esse backup.
  3. Ativar o cofre antigo com uma frase de teste.
  4. Entrar na conta.
  5. Conferir no Painel os mesmos totais de antes.
  6. Conferir que o arquivo `rendller-antes-da-conta-*.json` foi baixado.
  7. Abrir em outro navegador e entrar: deve **baixar**, não pedir escolha.
- [ ] **Passo 6:** commit `feat: migração para a conta sem perda (navegador, backup e cofre antigo)`.

## Fase 6: operação sem custo (contra a pausa) e documentação

Ao final: o projeto Supabase não pausa por inatividade, e README, CLAUDE.md e a nota do vault descrevem o estado novo.

**Arquivos:** criar `.github/workflows/manter-supabase.yml`. Modificar `README.md`, `CLAUDE.md` (§2 tabela e regras de arquitetura, §6, §11) e `C:\Users\lucas\vault\07-Recursos\Finanças\Rendller — contexto técnico.md` (seção "Estado atual").

- [ ] **Passo 1:** criar o workflow com `on: schedule: - cron: '17 9 */3 * *'` e `workflow_dispatch`. Um passo único: `curl -fsS -X POST "$URL/rest/v1/rpc/ping" -H "apikey: $KEY" -H "content-type: application/json" -d '{}'`, com `URL` e `KEY` vindos dos secrets `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` (o usuário cadastra os dois no GitHub).
- [ ] **Passo 2:** rodar o workflow por `workflow_dispatch` e ver a resposta `1` no log. Registrar no README que o GitHub desativa workflows agendados de repositórios sem atividade por 60 dias, e que reabrir o app com a conta também conta como atividade no Supabase.
- [ ] **Passo 3: atualizar a documentação.**
  - README: classes aceitas; conta + frase-senha (dois segredos); o que acontece se o projeto pausar; backup `.json` continua essencial.
  - CLAUDE.md: `src/conta.ts`, `src/remoto.ts`, `src/migracaoConta.ts`, `supabase/` na tabela; a regra de arquitetura "conta identifica, frase-senha cifra"; os testes obrigatórios novos (migração, contrato do `Remoto`); o título passa a "controle de renda fixa".
  - Vault: atualizar "Estado atual".
- [ ] **Passo 4:** `npm test` e `npm run build`. Commit `docs: conta, classes bancárias e operação do Supabase`.

## Fase 7: desligar o cofre antigo (só com confirmação do usuário)

**Portão:** só comece depois que o usuário confirmar que **todos** os aparelhos migraram (cada um mostra `migradoEm`) e que tem um backup `.json` recente. Sem essa confirmação, a fase não roda.

**Arquivos:** remover `netlify/cofre.ts`, `netlify/functions/cofre.mts`, a dependência `@netlify/blobs`, o fluxo "Sincronizar só com frase-senha" do cartão e `remotoCofreAntigo`. Modificar `src/sincronizacao.test.ts` (sai o contrato do cofre antigo; o da conta fica).

- [ ] **Passo 1:** antes de remover o código, adicionar em Parâmetros o botão "Apagar cofre antigo", que chama `apagarCofre` com as credenciais arquivadas em `rendller:sync:v1:migrado` depois de uma confirmação explícita. Publicar e deixar o usuário apagar o cofre antigo à mão.
- [ ] **Passo 2:** remover os arquivos listados. **Manter** `migrarDados` (leitura v1), a leitura de `rendller:dados:v1` em `carregarDe` e a restauração de backup v1. A migração de formato é permanente (ADR-0004).
- [ ] **Passo 3:** testar que continuam passando `v1 vira v2 sem perder aporte` e `só v1 salva: migra e não apaga a v1`. `npm test` e `npm run build`.
- [ ] **Passo 4:** marcar a ADR-0002 com uma nota "cofre antigo desligado em AAAA-MM-DD" e atualizar o README e a §2 do CLAUDE.md. Commit `chore: remove o cofre antigo depois da migração`.

---

## Fora deste plano (registrado nos ADRs)

- Segunda etapa de classes: Tesouro sem cupom (indexador Selic, custódia B3, sem FGC). Vai reaproveitar `RegimeTributario`.
- Passkeys (no Supabase ainda em beta) e e-mail próprio (SMTP) para mais de um usuário.
- Títulos com cupom, fundos e renda variável.
