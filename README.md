# Rendller · Controle de CDB

App web para controlar aportes em CDB e renda fixa: rendimento bruto e líquido, IR e IOF, liquidez, vencimentos, concentração por instituição e FGC, e um simulador para comparar ofertas antes de aportar. É a evolução da planilha `controle_cdb_google_sheets`, com as mesmas regras do `CLAUDE.md` do projeto.

## Telas

- **Painel**: total aportado, saldo bruto, impostos, saldo líquido hoje e no vencimento, evolução estimada da carteira, liquidez, próximos vencimentos e alertas.
- **Aportes**: um lote por linha. Pós-fixado (% do CDI com fase promocional), prefixado e IPCA+. Registro de resgate total ou parcial sem apagar o histórico (o resgate parcial divide o lote em parte resgatada e parte remanescente, mantendo a data do aporte para IR e IOF).
- **Instituições**: consolidação por conglomerado, % da carteira, cobertura e excesso do FGC.
- **Simulador**: até 5 opções lado a lado, com IR, IOF, valor final líquido, ganho por mês e taxa líquida anualizada.
- **Parâmetros**: CDI e IPCA de projeção (com data e fonte), tabelas de IR e IOF, limites do FGC, janelas de alerta, feriados, importação da planilha e backup.

## Regras de cálculo

- Rendimento usa **dias úteis** no intervalo [aporte, data), descontando feriados; IR e IOF usam **dias corridos**.
- Fases de rentabilidade são **fatores compostos**, nunca média.
- IOF só antes do 30º dia; IR sobre (rendimento − IOF); nenhum imposto sobre o principal.
- Nenhuma taxa fica dentro do código de cálculo: tudo vem de Parâmetros.
- Todo valor futuro é **estimativa** e aparece marcado como tal.

O motor fica em `src/domain/` e é testado em `src/domain/calculo.test.ts` (casos da seção 6 do `CLAUDE.md`, conferidos contra um cálculo independente).

## Dados

Os dados ficam **só no navegador** (localStorage). Use *Parâmetros → Exportar backup* para guardar um arquivo `.json` ou levar a outro aparelho.

Para importar a planilha: no Google Sheets, *Arquivo → Fazer download → Microsoft Excel (.xlsx)*, depois *Parâmetros → Importar planilha*.

## Rodar localmente

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # testes do motor de cálculo
npm run build   # gera dist/
```

## Publicar

O workflow `.github/workflows/ci-pages.yml` roda testes e build a cada push e publica no GitHub Pages a partir do branch padrão. Ative uma vez em *Settings → Pages → Source: GitHub Actions*.

> Aviso: ferramenta de controle pessoal. Não é recomendação de investimento.
