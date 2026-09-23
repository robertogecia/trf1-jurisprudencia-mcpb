# Jurisprudência TRF1 e TNU no Claude

[![test](https://github.com/robertogecia/trf1-jurisprudencia-mcpb/actions/workflows/test.yml/badge.svg)](https://github.com/robertogecia/trf1-jurisprudencia-mcpb/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Pesquise a jurisprudência do **Tribunal Regional Federal da 1ª Região** (TRF1 e Turmas
Recursais/JEF1) e da **Turma Nacional de Uniformização** (TNU) dentro da conversa com o Claude,
sem abrir o portal do CJF, sem login e sem mexer em código. Feito para advogados **sem
conhecimento nenhum de informática**. Comece pela instalação, logo abaixo.

## Instalar (3 passos, uns 2 minutos)

**Você precisa do "Claude Desktop"** — o *programa* do Claude instalado no computador (Mac ou
Windows), não o site no navegador nem o aplicativo do celular. Se você usa o Claude num
aplicativo separado, já tem. Se usa só pelo navegador, baixe primeiro o programa em
**[claude.com/download](https://claude.com/download)**, instale, entre com a sua conta e volte
aqui.

### Passo 1 — Baixe o arquivo

### ⬇️ [CLIQUE AQUI PARA BAIXAR (`Jurisprudencia-TRF1.mcpb`)](https://github.com/robertogecia/trf1-jurisprudencia-mcpb/releases/latest/download/Jurisprudencia-TRF1.mcpb)

Um arquivo chamado `Jurisprudencia-TRF1.mcpb` (uns 4 MB) vai para a pasta **Downloads** (ou
"Transferências") do seu computador — o mesmo lugar onde caem os PDFs que você baixa da internet.
Você não precisa abri-lo agora, só saber onde ele está.

> **⚠️ Atenção a um erro comum:** se em vez de clicar no botão acima você navegou até a página
> principal do projeto no GitHub e clicou no botão verde **"Code" → "Download ZIP"**, isso baixou
> o arquivo errado (o código-fonte do programa, que não serve para instalar). Apague esse zip e
> use só o link do botão acima.

### Passo 2 — Abra o arquivo baixado

1. Abra a pasta **Downloads** do seu computador (no Mac, o ícone de seta para baixo na barra de
   baixo da tela costuma abrir direto nela; no Windows, é "Este Computador" → "Downloads").
2. Procure o arquivo **`Jurisprudencia-TRF1.mcpb`** e **dê dois cliques** nele, como faria para
   abrir uma foto ou um PDF.
3. O Claude Desktop deve abrir sozinho, numa tela perguntando se você quer instalar a extensão
   "Jurisprudência TRF1". Clique em **Instalar** (ou "Install").

   *Se nada abrir:* abra você mesmo o Claude Desktop, vá em **Configurações** (o ícone de
   engrenagem) → **Extensões**, e arraste o arquivo `Jurisprudencia-TRF1.mcpb` para dentro dessa
   janela com o mouse.

### Passo 3 — Confirme e teste

1. Se o Claude Desktop pedir para **reiniciar**, feche e abra o programa de novo.
2. Comece uma **conversa nova** (importante: conversa aberta antes da instalação não enxerga a
   extensão).
3. Digite algo como:
   > *pesquise no TRF1 acórdãos sobre benefício por incapacidade e incapacidade preexistente*
4. O Claude vai perguntar se pode usar a ferramenta de pesquisa do TRF1 — é sinal de que
   funcionou. Autorize, e a busca aparece na conversa.

**Pronto.** Você não precisa instalar mais nada: o Claude Desktop já traz tudo o que a extensão
precisa para rodar. Funciona em computador **Mac ou Windows**. Em celular ou tablet, e no Claude
pelo site (sem o programa), esta pesquisa não funciona.

## Como vai funcionar no dia a dia

Você pede em português, como pediria a um estagiário, e o Claude usa a extensão por conta própria:

> "Pesquise no TRF1 acórdãos sobre desapropriação e juros compensatórios, mais recentes primeiro."
>
> "Traga todas as decisões do processo 1002249-04.2026.4.01.9999."
>
> "Na TNU, o inteiro teor do PUIL 0011441-43.2015.4.03.6301."
>
> "Esse trecho que você citou está mesmo no acórdão? Confira."

O que você recebe de volta:

- **Citação pronta** (sigla, número, relator, órgão, data), já com **link direto** para o inteiro
  teor quando o portal deu um link específico daquele documento (arquivo do TRF1 ou eproc da
  TNU) — nunca o link genérico do PJe, que não aponta para o julgado certo.
- **Todos os documentos sob um número** (acórdão, embargos, decisão monocrática): a extensão
  avisa quando há mais de um e quando dois deles declaram resultado oposto (provável voto
  vencido).
- **O inteiro teor da TNU**, não só a ementa: relatório e voto completos, com o órgão, o relator
  e a data lidos do **fecho do acórdão** — mais confiável que o cadastro do portal.
- **Conferência antes das aspas.** Peça para conferir um trecho e a extensão diz se ele está
  literalmente na ementa, no dispositivo ou (na TNU) no inteiro teor. Se está, ainda avisa **de
  quem é a frase**: o voto pode transcrever ementa de outro tribunal, relatar o que uma parte
  alegou, ou ser o próprio voto vencido.
- **Um recibo guardado no seu computador** com o texto que o tribunal entregou, toda vez que uma
  decisão é aberta — serve para provar depois que a citação da peça veio do documento, não da
  imaginação da IA.

## O que ela NÃO faz (leia antes de confiar)

- **Na base do TRF1, o portal nunca expõe o voto** — só ementa e dispositivo. O inteiro teor dos
  casos antigos fica atrás de verificação anti-robô que esta extensão não contorna; o link fica
  na citação para você abrir no navegador. A conferência de citação cobre o que o portal expõe e
  diz, na própria resposta, que a atribuição da frase não foi analisada.
- **Zero resultado não é "não existe no TRF1"** — o motor casa palavras, não conceitos. Palavras
  da conclusão que você espera ("não afasta", "é inócua") costumam zerar a busca.
- **Não substitui a leitura do acórdão.** Confirme número, relator, órgão, data e o sentido do
  julgado antes de levar para a peça.
- **Não dá parecer.** Toda saída é rascunho para a sua revisão.

## Algo deu errado? Veja aqui antes de pedir ajuda

| O que aconteceu | O que fazer |
|---|---|
| Baixei um arquivo, mas quando abro vira uma **pasta cheia de arquivos**, e não a tela de instalação | Você baixou o arquivo errado (o código-fonte, não o instalador). Volte ao topo e use o botão **"CLIQUE AQUI PARA BAIXAR"**. |
| Dei dois cliques no `.mcpb` e **não abriu nada** | Use o caminho alternativo do Passo 2: Claude Desktop → Configurações → Extensões, e arraste o arquivo para essa janela. |
| Instalei, mas o Claude diz que **não tem essa ferramenta** | Abra uma **conversa nova**. Confira também se a extensão aparece **ativada** em Configurações → Extensões. |
| A resposta veio como `[PESQUISA NÃO REALIZADA — …]` | Não é "não localizado" — é "não perguntei". A própria mensagem diz o motivo (ritmo, bloqueio, rede) e quando tentar de novo; peça ao Claude "rode o diagnóstico do TRF1". |
| Erro de rede em toda busca, mas o portal abre no navegador | Veja se há [versão nova](https://github.com/robertogecia/trf1-jurisprudencia-mcpb/releases/latest) (a própria mensagem de erro avisa quando há) e, se não houver, [relate o problema](../../issues). |
| Não tenho o Claude Desktop, só uso pelo site ou pelo celular | A pesquisa **não funciona** nesses casos — precisa do programa instalado no computador. |
| Nenhuma linha acima resolveu | Peça ajuda a alguém do escritório com mais prática em informática mostrando esta tabela — ou [abra uma issue](../../issues) descrevendo o que aconteceu (sem número de processo: a página é pública). |

## Atualizar e desinstalar

- **Atualizar:** quando sair versão nova, a primeira resposta da conversa avisa. Baixe o arquivo
  novo pelo mesmo botão do Passo 1 e instale por cima; a versão antiga é substituída.
- **Desinstalar:** Claude Desktop → Configurações → Extensões → "Jurisprudência TRF1" →
  Remover. Se quiser, apague também a pasta de recibos `.trf1-jurisprudencia-recibos` na sua
  pasta de usuário.

## Reportar erro, pedir melhoria

- **Erro**: a própria mensagem de erro traz um link que abre o formulário de relato no GitHub já
  preenchido com os dados técnicos (versão, sistema, tipo do erro). **Nada da sua pesquisa vai
  junto**, e você revisa antes de enviar. Ou [abra uma issue](../../issues/new) à mão.
- **Sugestão**: [issue](../../issues/new) também. Diga o que tentou pesquisar (em abstrato — sem
  número de processo, as issues são públicas) e o que esperava.
- Precisa de conta gratuita no GitHub. O autor mantém isto no tempo livre; a resposta pode
  demorar.

## Apoie o projeto

A extensão é gratuita e de código aberto, e é mantida no tempo livre de um advogado: cada
mudança do portal do CJF exige diagnóstico, correção, testes e versão nova. Se ela economiza o
seu tempo, você pode apoiar a continuidade do trabalho com qualquer valor, por **Pix**:

> **Chave Pix (e-mail):** `robertogrecia@hotmail.com`

O apoio é voluntário e não muda nada no uso: a extensão continua igual para todos.

## Autor

**Roberto Grécia Bessa** — OAB/RO 7865-A
Instagram: [@robertogrecia](https://instagram.com/robertogrecia)

Irmã das extensões de jurisprudência do [TJRO](https://github.com/robertogecia/tjro-jurisprudencia-mcp),
do [TCE-RO](https://github.com/robertogecia/tcero-jurisprudencia-mcp) e do
[TJSE](https://github.com/robertogecia/mcp-tjse-jurisprudencia), do mesmo autor. Licença MIT —
veja [LICENSE](LICENSE).

---

# Para quem programa (ou quer entender por dentro)

Daqui para baixo o texto é técnico. Um advogado que só quer usar a extensão não precisa ler nada
disto.

## O que é este repositório

Porte em **Node.js** do servidor Python
[`trf1-jurisprudencia-mcp`](https://github.com/robertogecia/trf1-jurisprudencia-mcp) (fonte de
verdade: mudança de comportamento entra primeiro lá, com selftest e red team, depois aqui, com o
teste de paridade), empacotado como extensão `.mcpb` de um clique para o Claude Desktop — mesmo
padrão de [`tjro-jurisprudencia-mcp`](https://github.com/robertogecia/tjro-jurisprudencia-mcp) e
[`tcero-jurisprudencia-mcpb`](https://github.com/robertogecia/tcero-jurisprudencia-mcpb).

## Ferramentas

Mesmas quatro do servidor Python: `buscar_jurisprudencia_trf1`, `obter_decisao_trf1`,
`verificar_citacao_trf1`, `diagnostico_ritmo_trf1`. Descrições completas em
[`server/index.js`](server/index.js).

## Instalar o servidor Node (desenvolvimento / Claude Code)

```bash
git clone https://github.com/robertogecia/trf1-jurisprudencia-mcpb.git
cd trf1-jurisprudencia-mcpb
npm install
npm test                      # 28 testes de paridade, sobre os mesmos fixtures do servidor Python
node --check server/index.js
```

No **Claude Code**:

```bash
claude mcp add trf1_jurisprudencia -- node /caminho/para/trf1-jurisprudencia-mcpb/server/index.js
```

Empacotar o `.mcpb`:

```bash
npx @anthropic-ai/mcpb@latest pack . Jurisprudencia-TRF1.mcpb
```

## Diferenças conhecidas frente ao servidor Python

- **Decodificação de charset.** `Response.text()` do WHATWG fetch decodifica sempre como UTF-8,
  ignorando o charset do `Content-Type` — o eproc da TNU declara `ISO-8859-1`. Corrigido lendo o
  corpo como bytes e decodificando pelo charset declarado no cabeçalho (com fallback para UTF-8).
  O servidor Python (httpx) já fazia isso corretamente.
- **Cookie jar manual.** `fetch` do Node não persiste cookies entre requisições como o `httpx.AsyncClient`
  do Python faz automaticamente; este porte implementa um jar simples por sessão
  (`CookieJar` em `server/lib.js`), lendo `Set-Cookie` via `Headers.getSetCookie()` (Node ≥18.14).
- **Estado do disjuntor é um arquivo próprio** (`server/.disjuntor_estado_trf1.json`), separado
  do servidor Python — não compartilham orçamento de ritmo entre si, mesmo instalados na mesma
  máquina.
- Fonte de verdade é sempre o servidor Python: mudança de comportamento entra lá primeiro.

## Testes

`npm test` roda 28 casos, muitos contra os **mesmos fixtures reais** (respostas capturadas do
portal do CJF) usados no `--selftest` do servidor Python — parsing de busca TRF1/TNU/colegiado,
texto do inteiro teor, atribuição da frase (TRANSCRIÇÃO/VOTO DIVERGENTE/ALEGAÇÃO DA
PARTE/ENTRE ASPAS/NEGAÇÃO), fecho da TNU com casos de divergência, recibos em disco (grava, lê,
sha256 divergente é posto de lado), citação com hiperlink, formatação de busca/decisão, e o
disjuntor (fail-closed em estado ilegível, escada só com rajada). Testado ao vivo contra o portal
real do CJF antes da publicação: TNU (fecho, recibo, verificação com alerta de atribuição real —
"ALEGAÇÃO DA PARTE" no PUIL 0011441-43.2015.4.03.6301) e TRF1 (busca, painel avançado com filtro
por número, múltiplos julgamentos sob o mesmo número).

## Licença

MIT.
