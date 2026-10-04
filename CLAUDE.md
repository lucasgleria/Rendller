# CLAUDE.md · Rendller (controle de CDB)

Instruções para o Claude Code trabalhar neste repositório. Responda sempre em **português do Brasil**.

O Rendller é um app web pessoal que controla aportes em CDB e renda fixa: rendimento bruto e líquido, IR, IOF, liquidez, vencimentos, concentração por instituição/FGC e simulação de novas ofertas. Ele substitui a planilha `controle_cdb_google_sheets` e segue as mesmas regras de domínio.

**Missão:** mostrar quanto foi investido → por quanto tempo → em que instituição → sob quais condições → quanto rende bruto → quanto se perde em impostos → quanto se recebe líquido → quando o dinheiro fica disponível.

---

## 1. Comandos

```bash
npm install        # dependências
npm run dev        # servidor local em http://localhost:5173
npm test           # testes do motor de cálculo (Vitest)
npm run typecheck  # TypeScript
npm run build      # typecheck + build em dist/
```

Antes de dizer que uma mudança está pronta, rode `npm test` e `npm run build`. Os dois precisam passar.

## 2. Arquitetura

| Caminho | Papel |
|---|---|
| `src/domain/types.ts` | Tipos: `Aporte` (um lote), `Parametros`, `Dados` |
| `src/domain/datas.ts` | Datas ISO sem fuso, `Calendario` (dias úteis com feriados), feriados nacionais |
| `src/domain/calculo.ts` | Motor: fator bruto por indexador, IOF, IR, `avaliar()`, `validarAporte()` |
| `src/domain/carteira.ts` | Linhas com status e alertas, agrupamento por instituição/FGC, resumo, série de projeção |
| `src/domain/padroes.ts` | Parâmetros padrão (tabelas de IR/IOF, FGC, CDI inicial) e listas de opções |
| `src/domain/importacao.ts` | Importação da planilha .xlsx (abas `Aportes` e `Config`) e validação de backup |
| `src/domain/calculo.test.ts` | Testes obrigatórios (seção 6) |
| `src/armazenamento.ts` | Persistência em `localStorage` (chave `rendller:dados:v1`) e download de arquivos |
| `src/pages/*.tsx` | Telas: Painel, Aportes, Instituições, Simulador, Parâmetros |
| `src/components/campos.tsx` | Campos de formulário (números pt-BR, percentuais com `escala={100}`) |
| `src/formato.ts` | Formatação BRL, %, datas `dd/mm/aaaa` |

Regras de arquitetura:

- `src/domain/` é **puro**: sem React, sem DOM, sem `localStorage`. Toda regra financeira mora ali e é testada ali.
- As telas só exibem e editam; não fazem conta financeira própria.
- Datas são strings ISO `aaaa-mm-dd`. Use as funções de `datas.ts`, nunca `new Date()` para aritmética de dias.
- Percentuais e taxas são guardados em decimal (103% do CDI = `1.03`; 12% a.a. = `0.12`).
- Os dados ficam **só no navegador** (decisão do usuário em 04/10/2026). Mudanças no formato de `Dados` precisam continuar lendo backups e dados antigos: `carregar()` mescla parâmetros novos com os padrões.

## 3. Regras de ouro

1. Decida pelo **valor líquido em reais** no período efetivo. O percentual do CDI sozinho não decide nada.
2. **Cada aporte é um lote independente**, com data, taxa, vencimento, IR e IOF próprios. Um novo aporte no mesmo CDB é uma nova linha e não herda data, taxa nem contagem tributária.
3. **Rendimento usa dias úteis; IR e IOF usam dias corridos.** Nunca misture as duas contagens.
4. Produtos com fases (ex.: 130% → 103% do CDI) usam **fatores compostos**. Nunca média simples.
5. Taxas, CDI, IPCA e tabelas de imposto vêm de `Parametros`. **Nada de números mágicos** no código de cálculo.
6. Ofertas, CDI, promoções e situação de bancos são **dados dinâmicos**. Não invente valores e não trate valores antigos como atuais.
7. **Não destrua histórico.** Resgate muda o status para `Resgatado` e guarda os valores recebidos; o aporte original nunca é apagado nem fundido com outro.

## 4. Regras de cálculo (como estão implementadas)

**Dias úteis:** contados no intervalo `[data do aporte, data final)`, descontando sábados, domingos e os feriados de `Parametros.feriados`. Ver `Calendario.diasUteis`.

**Pós-fixado (% do CDI):**
```
taxa_diaria_CDI = (1 + CDI_anual)^(1/252) − 1
fator_fase      = (1 + taxa_diaria_CDI × percentual)^dias_uteis_da_fase
```
A fase promocional vai de `[aporte, aporte + diasPromo)` em dias corridos; a fase padrão vai do fim da promoção até a data final. O fator total é o produto dos fatores.

**Prefixado:** `fator = (1 + taxa_anual)^(dias_uteis / 252)`
**IPCA+:** `fator = (1 + IPCA_projetado)^(du/252) × (1 + spread)^(du/252)`. IPCA futuro é sempre estimativa; sem IPCA informado o lote fica marcado como não calculável.

**Ordem dos impostos:**
1. Rendimento bruto
2. IOF = rendimento × tabela IOF (só do 1º ao 29º dia corrido; zero a partir do 30º)
3. Base do IR = rendimento bruto − IOF
4. IR = base × alíquota da faixa de dias corridos
5. Líquido = bruto − IOF − IR

IR e IOF incidem **sobre o rendimento, nunca sobre o principal**.

**IR regressivo (referência 2026):** até 180 dias 22,5% · 181 a 360 dias 20% · 361 a 720 dias 17,5% · acima de 720 dias 15%.
**IOF:** 96% no dia 1 caindo até 3% no dia 29; 0% do dia 30 em diante (tabela completa em `padroes.ts`).

**Taxa líquida anualizada:** `(valor_liquido / aporte)^(252 / dias_uteis) − 1`.

**Arredondamento:** só na exibição. Cálculos intermediários mantêm precisão total.

**Status:** `Ativo`, `Planejado` e `Resgatado` são informados pelo usuário; `Ativo` vira `Vencido` automaticamente na data de vencimento. O saldo da carteira soma `Ativo` e `Vencido` (vencido ainda sem resgate registrado).

## 5. FGC e concentração

- Cobertura ordinária: até **R$ 250.000 por CPF por instituição ou conglomerado**.
- Limite global: **R$ 1.000.000** em garantias a cada **quatro anos**.
- A exposição considera **principal + rendimentos**.
- A cobertura é por **emissor/conglomerado**, não pela corretora onde o título foi comprado. No app: `instituicao` = plataforma/corretora, `emissor` = banco emissor, `conglomerado` = grupo para o FGC (vazio usa o emissor).
- Confirme se o emissor é associado ao FGC quando isso for relevante.

## 6. Testes obrigatórios

Qualquer mudança no motor precisa manter (e, se for regra nova, ganhar) testes em `src/domain/calculo.test.ts` para:

- [ ] CDB com taxa única
- [ ] CDB com duas fases
- [ ] Resgate com menos de 30 dias (IOF)
- [ ] Prazo de 181 a 360 dias
- [ ] Prazo de 361 a 720 dias
- [ ] Prazo acima de 720 dias
- [ ] Agrupamento por banco/conglomerado e FGC
- [ ] Linha vazia ou com dado faltando (não pode quebrar)

Os valores esperados foram conferidos por um cálculo independente (CDI 13,90% a.a., feriados nacionais). Valide valores novos por um segundo caminho antes de gravá-los no teste; não ajuste o esperado só para o teste passar. Checagens de sanidade: rendimento ≥ 0, líquido < bruto, IR na faixa certa, IOF zero a partir de 30 dias.

## 7. Interface

- Valores em `R$ 1.234,56`, percentuais com vírgula decimal, datas em `dd/mm/aaaa`.
- Todo valor futuro aparece marcado como **estimativa**.
- Separe claramente capital aportado, rendimento, impostos e saldo.
- Comparações (Simulador) mostram: emissor · aporte · taxa · prazo · vencimento · rendimento bruto · IOF · IR · rendimento líquido · valor final · taxa líquida anualizada · liquidez. Indique o maior ganho absoluto e o melhor retorno proporcional; com prazos diferentes, reinvestimento é **hipótese**.
- Visual sóbrio: sem excesso de cores ou gráficos decorativos. Funciona no celular e no modo escuro (tokens CSS em `src/estilo.css`).

## 8. Comunicação com o usuário

- Comece pela resposta. Mostre os números que a sustentam.
- Distinga sempre: **fato · cálculo · estimativa · hipótese**.
- Declare premissas de forma curta (ex.: "CDI de projeção 13,90% a.a., da planilha, sem data").
- Se faltar um dado essencial, faça uma pergunta objetiva; se for secundário, siga com premissa declarada.
- Ferramenta de controle pessoal: não apresente análises como recomendação certificada nem prometa rentabilidade.

## 9. O que nunca fazer

- Escolher investimento pelo maior percentual do CDI.
- Inventar CDI, Selic, IPCA, taxas de oferta ou disponibilidade de produto.
- Escrever taxas, alíquotas ou limites dentro do código de cálculo.
- Misturar dias úteis e corridos.
- Aplicar IR sobre o principal ou IOF a partir do 30º dia.
- Fazer média simples entre fases de rentabilidade.
- Fundir aportes de datas diferentes.
- Apagar dados do usuário ou mudar o formato salvo sem manter compatibilidade com backups antigos.
- Confundir corretora distribuidora com emissor do título.
- Pedir senhas, tokens ou dados de acesso bancário.

## 10. Contexto do projeto (histórico, não regra)

- Carteira em 04/10/2026: 3 aportes no PagBank (emissor BancoSeguro/PagBank): R$ 500 em 19/08/2026 e R$ 500 em 02/09/2026, ambos 130% do CDI nos 30 primeiros dias e 103% depois, vencendo em 10/08/2028, liquidez diária; R$ 700 em 01/10/2026 a 108,5% do CDI, vencendo em 01/10/2030, sem liquidez diária.
- Instituições já consideradas: PagBank (em uso), Banco BV (conta em espera), Banco BMG (conta não aprovada), Sofisa Direto (receio por reclamações online), Neon (alternativa). Nenhuma está excluída; verifique a situação atual antes de analisar.
- Cenários discutidos: aporte inicial de R$ 500 com aportes mensais de cerca de R$ 400; aporte de R$ 700 sem intenção de resgate antecipado.
- A planilha original foi auditada em 04/10/2026; a contagem de dias sem feriados e o IR fixo nas fórmulas eram os principais problemas, e o app já nasce corrigido.
- Premissas tributárias e de FGC revisadas em **outubro/2026**. Se o uso for depois de mudança regulatória, revise a seção 4 e `padroes.ts`.

## 11. Pendências conhecidas

- Deploy: o repositório é privado; GitHub Pages exige plano pago para repositório privado. Alternativas: repositório público, GitHub Pro, Vercel ou Netlify.
- O CDI padrão (13,90%) veio da planilha e está sem data e fonte; o usuário precisa confirmar o valor vigente em Parâmetros.
- Ainda não implementado: aba de CDI histórico diário (modo histórico da seção 5.4 do planejamento), resgate parcial com lote remanescente, conferência automática do calendário ANBIMA.
