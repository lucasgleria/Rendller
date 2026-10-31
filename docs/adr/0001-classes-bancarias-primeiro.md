---
status: accepted
data: 2026-10-31
---

# Primeira expansão: só classes bancárias com FGC

O Rendller deixa de ser só CDB, mas a primeira etapa aceita apenas **CDB, RDB, LC, LCI e LCA**. As cinco cabem no motor atual, que trata um lote com um indexador (CDI, PRE ou IPCA) e paga principal e juros no fim. A única regra nova é o **regime tributário por classe**: isenção de IR, IOF, cobertura do FGC e carência mínima. Esse regime vem de `Parametros`, como as tabelas de IR e IOF, e nunca fica escrito no código de cálculo.

## Considered Options

- **Bancárias + Tesouro sem cupom:** exigiria um indexador Selic (outra série do Banco Central), a taxa de custódia da B3 e lotes sem FGC. Fica para uma **segunda etapa**, que vai reaproveitar o regime tributário criado nesta.
- **Fluxos e fundos (NTN-B/F com cupom, debêntures, CRI/CRA, fundos):** exigem um modelo novo, com fluxo de pagamentos e posição em cotas. Ficam fora até haver um título desses na carteira.
- **Renda variável:** fica fora do Rendller. A missão do app é renda fixa.

## Consequences

- `Aporte` ganha uma `classe` separada do `indexador`. O antigo campo `tipo` (ex.: "CDB Pós-fixado") misturava as duas coisas e passa a ser derivado.
- O formato salvo muda para `Dados` versão 2. Backups e cofres na versão 1 continuam sendo lidos (ver ADR-0004).
- As regras de isenção e carência das letras (LCI/LCA) são dados regulatórios dinâmicos e precisam ser conferidos na fonte oficial antes de entrar em `padroes.ts`, com fonte e data registradas.
