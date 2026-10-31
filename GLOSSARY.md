# Rendller

Controle pessoal de aportes em renda fixa: quanto foi investido, onde, sob quais condições, quanto rende, quanto se perde em impostos e quando o dinheiro fica disponível.

## Carteira

**Aporte**:
Um lote independente aplicado numa data, com valor, taxa, vencimento e contagem tributária próprios. Um novo aporte no mesmo título é outro aporte.
_Avoid_: investimento, posição, compra

**Classe de ativo**:
A espécie jurídica do título (CDB, RDB, LC, LCI ou LCA), que define o regime tributário e a cobertura do FGC. Não diz como o título rende.
_Avoid_: tipo, produto, categoria

**Indexador**:
A forma como o aporte rende: % do CDI, prefixado ou IPCA + taxa.
_Avoid_: tipo, modalidade

**Regime tributário**:
O conjunto de regras fiscais e de garantia de uma classe de ativo: se paga IR regressivo ou é isenta, se sofre IOF, se tem FGC e qual a carência mínima.
_Avoid_: tributação, isenção (como substantivo genérico)

**Emissor**:
A instituição que emitiu o título e responde por ele.
_Avoid_: banco (sem qualificação), corretora

**Instituição**:
A plataforma ou corretora onde o aporte foi comprado. Não define a cobertura do FGC.
_Avoid_: banco, emissor

**Conglomerado**:
O grupo financeiro ao qual o emissor pertence, usado para somar a exposição ao FGC. Vazio significa o próprio emissor.
_Avoid_: grupo, instituição

**Resgate parcial**:
A divisão de um aporte em uma parte resgatada e uma parte remanescente, ambas com a data, a taxa e o vencimento originais.
_Avoid_: saque, retirada

## Natureza dos números

**Fato**:
Valor publicado ou registrado (CDI de um dia já publicado, valor recebido num resgate).

**Cálculo**:
Valor obtido só a partir de fatos e regras.

**Estimativa**:
Valor que depende de um dado futuro ou ainda não publicado (CDI de projeção, IPCA projetado).
_Avoid_: previsão, projeção (para o valor resultante)

**Hipótese**:
Premissa de cenário escolhida pelo usuário, como reinvestir no vencimento.

## Conta e sincronização

**Conta**:
A identidade com que o usuário entra no Rendller em qualquer aparelho para acessar sua carteira.
_Avoid_: usuário, perfil, login

**Senha da conta**:
O segredo que prova quem é o usuário ao entrar na conta. Pode ser recuperada por e-mail e não cifra nada.
_Avoid_: senha (sem qualificação)

**Frase-senha**:
O segredo que só o usuário conhece e do qual vem a chave que cifra a carteira. Não sai do navegador e não tem recuperação.
_Avoid_: senha, senha mestra, PIN

**Cofre**:
A cópia cifrada da carteira guardada fora do aparelho. Só quem tem a frase-senha consegue ler.
_Avoid_: backup, nuvem (como sinônimo exato)

**Cofre antigo**:
O cofre identificado só pela frase-senha, anterior à conta. É mantido para leitura até a migração e só depois é desligado.
_Avoid_: sincronização antiga

**Backup**:
O arquivo `.json` com a carteira completa, guardado pelo usuário fora do app.
_Avoid_: cópia, exportação

**Migração para a conta**:
A passagem única dos dados de um aparelho (navegador, backup ou cofre antigo) para o cofre da conta, sem apagar a origem.
_Avoid_: importação, sincronização

**Conflito**:
Situação em que este aparelho e o cofre mudaram desde a última sincronização. O usuário escolhe qual versão fica; nada é sobrescrito sozinho.
