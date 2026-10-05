# Rendller · Controle de CDB

App web para controlar aportes em CDB e renda fixa: rendimento bruto e líquido, IR e IOF, liquidez, vencimentos, concentração por instituição e FGC, e um simulador para comparar ofertas antes de aportar. É a evolução da planilha `controle_cdb_google_sheets`, com as mesmas regras do `CLAUDE.md` do projeto.

## Telas

- **Painel**: total aportado, saldo bruto, impostos, saldo líquido hoje e no vencimento, evolução estimada da carteira, liquidez, próximos vencimentos e alertas.
- **Aportes**: um lote por linha. Pós-fixado (% do CDI com fase promocional), prefixado e IPCA+. Registro de resgate total ou parcial sem apagar o histórico (o resgate parcial divide o lote em parte resgatada e parte remanescente, mantendo a data do aporte para IR e IOF).
- **Instituições**: consolidação por conglomerado, % da carteira, cobertura e excesso do FGC.
- **Simulador**: até 5 opções lado a lado, com IR, IOF, valor final líquido, ganho por mês e taxa líquida anualizada.
- **Parâmetros**: CDI realizado (Banco Central) e CDI/IPCA de projeção, tabelas de IR e IOF, limites do FGC, janelas de alerta, calendário ANBIMA, importação da planilha e backup.

## Regras de cálculo

- Rendimento usa **dias úteis** no intervalo [aporte, data), descontando os feriados do calendário ANBIMA; IR e IOF usam **dias corridos**.
- Pós-fixado usa o **CDI realizado de cada dia** (Banco Central, série SGS 4389) no período já decorrido e o CDI de projeção só nos dias sem dado publicado. O app consulta o Banco Central ao abrir (uma vez por dia); sem internet, usa o último histórico salvo.
- Fases de rentabilidade são **fatores compostos**, nunca média.
- IOF só antes do 30º dia; IR sobre (rendimento − IOF); nenhum imposto sobre o principal.
- Nenhuma taxa fica dentro do código de cálculo: tudo vem de Parâmetros.
- Todo valor futuro é **estimativa** e aparece marcado como tal; valores de hoje só são marcados quando algum dia decorrido ficou sem CDI publicado.

O motor fica em `src/domain/` e é testado em `src/domain/calculo.test.ts` (casos da seção 6 do `CLAUDE.md`, conferidos contra um cálculo independente).

## Dados

Os dados ficam **só no navegador** (localStorage). Use *Parâmetros → Exportar backup* para guardar um arquivo `.json` ou levar a outro aparelho.

O app só faz duas consultas externas, ambas a dados públicos e sem enviar nada seu: o CDI na API do Banco Central (`api.bcb.gov.br`) e a data do calendário de feriados da ANBIMA (por um proxy do próprio domínio, porque o site da ANBIMA não aceita acesso direto do navegador).

Para importar a planilha: no Google Sheets, *Arquivo → Fazer download → Microsoft Excel (.xlsx)*, depois *Parâmetros → Importar planilha*.

## Rodar localmente

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # testes do motor de cálculo
npm run build   # gera dist/
```

## Publicar

Publicado no **Netlify** (`netlify.toml`): o build roda os testes do motor, gera `dist/` e configura o proxy `/anbima/*`. O workflow `.github/workflows/ci.yml` roda testes e build a cada push no GitHub.

Para publicar uma versão a partir do computador: `npx netlify-cli deploy --build --prod`. Com o repositório conectado ao Netlify (*Add new site → Import an existing project → GitHub*), cada push publica sozinho.

> Aviso: ferramenta de controle pessoal. Não é recomendação de investimento.
