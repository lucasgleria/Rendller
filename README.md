# Rendller · Controle de renda fixa

App web para controlar aportes em renda fixa bancária (CDB, RDB, LC, LCI e LCA): rendimento bruto e líquido, IR e IOF, liquidez, carência, vencimentos, concentração por instituição e FGC, e um simulador para comparar ofertas antes de aportar. É a evolução da planilha `controle_cdb_google_sheets`, com as mesmas regras do `CLAUDE.md` do projeto.

## Telas

- **Painel**: total aportado, saldo bruto, impostos, saldo líquido hoje e no vencimento, evolução estimada da carteira, liquidez, próximos vencimentos e alertas.
- **Aportes**: um lote por linha, com classe (CDB, RDB, LC, LCI, LCA ou outra) e indexador. O indexador pode ser pós-fixado (% do CDI com fase promocional), prefixado ou IPCA+. O resgate total ou parcial é registrado sem apagar o histórico: o parcial divide o lote em parte resgatada e parte remanescente, mantendo a data do aporte para IR, IOF e carência.
- **Instituições**: consolidação por conglomerado, % da carteira, cobertura e excesso do FGC (só das classes com FGC).
- **Simulador**: até 5 opções lado a lado, de classes diferentes, com IR, IOF, valor final líquido, ganho por mês e taxa líquida anualizada.
- **Parâmetros**: CDI realizado (Banco Central) e CDI/IPCA de projeção, regime tributário por classe, tabelas de IR e IOF, limites do FGC, janelas de alerta, calendário ANBIMA, sincronização, importação da planilha e backup.

## Classes aceitas

Cada classe tem um regime tributário, mostrado e editável na tabela **Regime tributário por classe** em Parâmetros. Os padrões foram conferidos em fonte oficial em 31/10/2026, e a fonte fica registrada em cada regime.

| Classe | IR | IOF | FGC | Carência mínima |
|---|---|---|---|---|
| CDB, RDB, LC | regressivo | sim (até o 29º dia) | sim | nenhuma |
| LCI | isenta | regra legal, nula na prática pela carência | sim | 6 meses (36 se corrigida mensalmente por índice de preços) |
| LCA | isenta | alíquota zero | sim | 6 meses (12 com índice de preços) |
| Outra renda fixa | regressivo | sim | sim | nenhuma |

Em LCI e LCA corrigidas pelo IPCA, a carência mínima depende da periodicidade da correção, que o app não conhece. Por isso o aporte pede a carência informada no título.

## Regras de cálculo

- O rendimento usa **dias úteis** no intervalo [aporte, data), descontando os feriados do calendário ANBIMA; IR e IOF usam **dias corridos**.
- O pós-fixado usa o **CDI realizado de cada dia** (Banco Central, série SGS 4389) no período já decorrido e o CDI de projeção só nos dias sem dado publicado. O app consulta o Banco Central ao abrir (uma vez por dia); sem internet, usa o último histórico salvo.
- Fases de rentabilidade são **fatores compostos**, nunca média.
- O IOF só incide antes do 30º dia; o IR incide sobre (rendimento − IOF); nenhum imposto incide sobre o principal. Classes isentas não pagam IR.
- Nenhuma taxa fica dentro do código de cálculo: tudo vem de Parâmetros.
- Todo valor futuro é **estimativa** e aparece marcado como tal. Valores de hoje só são marcados quando algum dia decorrido ficou sem CDI publicado.

O motor fica em `src/domain/` e é testado em `src/domain/calculo.test.ts` (casos da seção 6 do `CLAUDE.md`, conferidos contra um cálculo independente).

## Dados e sincronização

Os dados ficam no navegador (`localStorage`). A sincronização entre aparelhos é opcional e sempre **cifrada de ponta a ponta**: a carteira é cifrada no navegador (AES-GCM, chave derivada da frase-senha por PBKDF2 com 600 mil iterações) e o servidor guarda só conteúdo ilegível.

### Conta + frase-senha: dois segredos

Em *Parâmetros → Sincronização → Entrar com conta*, você entra com a **conta** (e-mail e senha, no Supabase) e digita a **frase-senha**:

- A **senha da conta** só identifica você e autoriza o acesso à sua linha no banco. Se esquecê-la, use "Esqueci a senha da conta" (o link chega por e-mail) ou troque a senha pelo painel do Supabase. Os dados não são perdidos.
- A **frase-senha** cifra a carteira e nunca sai do navegador. **Se esquecê-la, os dados da nuvem não podem ser recuperados**, nem por você nem pelo servidor. Só o backup `.json` salva você nesse caso.

A mesma frase gera chaves diferentes em contas diferentes, porque a chave depende do id da conta.

### Migração do cofre antigo

Antes da conta, a sincronização usava só a frase-senha (o "cofre antigo", no Netlify Blobs). Ao entrar com a conta num aparelho, o app:

1. baixa um **backup `.json` automático** do navegador, antes de qualquer acesso à rede;
2. junta os dados do navegador, do cofre antigo e da conta. Se houver versões diferentes, pede para você escolher e nunca mistura versões; a versão substituída fica guardada como cópia local;
3. **mantém o cofre antigo**: ele não é apagado, só deixa de sincronizar neste aparelho.

**Migre todos os seus aparelhos no mesmo dia.** Edições feitas num aparelho ainda não migrado vão só para o cofre antigo e, quando ele migrar, você vai precisar escolher uma versão.

### Se o projeto Supabase pausar

O plano Free do Supabase pausa o projeto depois de 7 dias de pouca atividade. Nesse caso:

- o app **segue funcionando com os dados locais** e mostra "Nuvem indisponível (o projeto pode estar pausado)"; as alterações são enviadas quando a nuvem voltar;
- para despausar, restaure o projeto pelo painel do Supabase (ele fica disponível para restauração por até 1 ano);
- o workflow `.github/workflows/manter-supabase.yml` faz uma consulta leve a cada 3 dias para evitar a pausa. Abrir o app com a conta também conta como atividade;
- o GitHub **desativa workflows agendados de repositórios sem atividade por 60 dias**: se isso acontecer, reative-o em *Actions*;
- o agendamento **só vale a partir do branch padrão do GitHub**. Enquanto o workflow estiver só no branch `feat/conta-e-classes`, ele não roda sozinho.

O plano Free não tem backup automático do banco.

### Backup `.json`

O backup continua essencial, com ou sem conta: *Parâmetros → Exportar backup* guarda um arquivo `.json` com a carteira completa. Backups antigos (formato v1) continuam sendo lidos.

### Rede

O app só acessa a rede para:
- buscar dados públicos, sem enviar nada seu: o CDI na API do Banco Central (`api.bcb.gov.br`) e o calendário de feriados da ANBIMA (por um proxy do próprio domínio, porque o site da ANBIMA não aceita acesso direto do navegador);
- falar com o cofre cifrado, se a sincronização estiver ligada: a conta no Supabase ou o cofre antigo (`/api/cofre`), sempre com conteúdo já cifrado.

Para importar a planilha: no Google Sheets, *Arquivo → Fazer download → Microsoft Excel (.xlsx)*, depois *Parâmetros → Importar planilha*.

## Configurar a conta

O roteiro completo (projeto Supabase, Auth, template do e-mail de recuperação, migração SQL, verificação, chaves e variáveis no Netlify) está em [supabase/README.md](supabase/README.md). Sem as variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` no build, o app não mostra nada de conta e funciona como antes.

## Rodar localmente

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # testes do motor, da migração e da sincronização
npm run build   # gera dist/
```

Para testar a conta localmente, copie `.env.example` para `.env.local` e preencha.

## Publicar

Publicado em **https://rendller.netlify.app/** pelo **Netlify** (`netlify.toml`): o build roda os testes, gera `dist/` e configura o proxy `/anbima/*`. O workflow `.github/workflows/ci.yml` roda testes e build a cada push no GitHub, sem precisar das variáveis do Supabase.

Para publicar uma versão a partir do computador: `npx netlify-cli deploy --build --prod`. Com o repositório conectado ao Netlify (*Add new site → Import an existing project → GitHub*), cada push publica sozinho.

> Aviso: ferramenta de controle pessoal. Não é recomendação de investimento.
