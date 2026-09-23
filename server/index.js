#!/usr/bin/env node
/**
 * Servidor MCP — Jurisprudência do TRF1 e da TNU (portal do CJF)
 * Porte Node.js do servidor Python (~/MCP/trf1-jurisprudencia/servidor_trf1.py — fonte de
 * verdade) para empacotamento .mcpb (1 clique no Claude Desktop).
 *
 * Wiring do protocolo MCP e chamada de rede. Toda a lógica pura está em lib.js e é coberta
 * por testes de paridade em test/.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  VERSAO,
  GRUPOS_MAX,
  TERMOS_POR_GRUPO_MAX,
  POR_PAGINA_VALIDOS,
  TIPOS_ACORDAO_TNU,
  buscar,
  obterDecisao,
  verificarCitacao,
  diagnosticoRitmoTexto,
  comAvisos,
  iniciarChecagemVersao,
} from "./lib.js";

const server = new McpServer({ name: "Jurisprudência TRF1", version: VERSAO });
iniciarChecagemVersao();

server.registerTool(
  "buscar_jurisprudencia_trf1",
  {
    title: "Buscar jurisprudência do TRF1/TNU",
    description:
      "Pesquisa jurisprudência do Tribunal Regional Federal da 1ª Região (TRF1 + Turmas Recursais/JEF1) " +
      "e da Turma Nacional de Uniformização (TNU) no portal público do CJF, sem login. " +
      "Bases: 'trf1' (padrão — acórdãos/súmulas/arguições/monocráticas, painel avançado, voto NÃO exposto); " +
      "'tnu' (PUIL etc., tipo_acordao=REPRESENTATIVO/RELEVANTE para precedentes qualificados, " +
      "inteiro teor legível — 'inteiro teor lido' possível); 'colegiado' (decisões administrativas do " +
      "Conselho, raramente serve a litígio). Nas bases tnu/colegiado não há painel avançado: filtro vai " +
      "na sintaxe de campo da consulta (nome[REL]). " +
      "Motor textual tipo BRS: operadores E/OU/NAO/ADJn/PROXn/COM/MESMO, aspas para frase, `$` como " +
      "radical no fim da palavra, `termo[CAMPO]` para restringir a um campo (EMEN/DECI/REL...). Não use " +
      "preposição, artigo nem pontuação — o motor não aceita. `grupos` monta OR dentro do grupo e AND entre " +
      "grupos automaticamente: grupos=[[\"dano moral\"],[\"negativação\",\"inscrição indevida\"]] vira " +
      "'\"dano moral\" E (negativação OU \"inscrição indevida\")'. Cada grupo descreve o FATO ou o assunto — " +
      "NUNCA a conclusão que você espera ('não afasta', 'é inócua'): cada acórdão escreve a conclusão de um " +
      "jeito, e um grupo assim derruba a busca. O portal recusa com erro os caracteres # ! + ' ; _ | - @ — " +
      "esta ferramenta os troca por espaço; hífen dentro de palavra vira frase exata. " +
      "Cada resultado traz tipo, classe, número, id do documento (chave única — sob o mesmo número convivem " +
      "várias decisões), relator, órgão, datas, citação pronta com nível de verificação (\"— verificação: " +
      "…\") e, quando o portal deu link específico do documento (arquivo.trf1.jus.br ou eproc da TNU — nunca " +
      "o link genérico do PJe), a referência inteira já em hiperlink markdown. Sinais do julgado: precedente " +
      "qualificado citado ('Cita: Súmula/Tema/IRDR…'), ⚠️ decisão monocrática, ⚠️ Turma Recursal. Avisa " +
      "'mesmo número, N documentos' e resultados opostos no mesmo julgamento. Com 3+ resultados, resume " +
      "offline quantos julgamentos declaram cada resultado. Antes de citar, use obter_decisao_trf1. " +
      "Falha (ritmo, bloqueio, rede, portal) sai como [PESQUISA NÃO REALIZADA — motivo]: nunca é \"não " +
      "localizado\"; erro de parâmetro sai como \"Erro de parâmetro\".",
    inputSchema: {
      consulta: z.string().default("").describe("Consulta livre na sintaxe do motor (pode ser \"\" quando usar grupos)."),
      tipo: z.array(z.string()).optional().describe("Tipos de documento. Padrão [\"ACORDAO\"]. Depende da base."),
      fonte: z.array(z.enum(["TRF1", "JEF1"])).optional().describe("Só na base 'trf1'. Padrão [\"TRF1\"]."),
      grupos: z
        .array(z.array(z.string()))
        .optional()
        .describe(
          `Grupos de sinônimos: OU dentro do grupo, E entre grupos, até ${GRUPOS_MAX} grupos e ${TERMOS_POR_GRUPO_MAX} termos cada. ` +
            "Expressão com espaço vira frase exata; `$` só no fim de palavra; `termo[EMEN]` no fim de um termo restringe ao campo. " +
            "Cada grupo descreve o FATO julgado, nunca a CONCLUSÃO esperada."
        ),
      relator: z.string().optional().describe("Filtro do painel avançado (só base 'trf1')."),
      orgao_julgador: z.string().optional().describe("Filtro do painel avançado (só base 'trf1')."),
      classe: z.string().optional().describe("Filtro do painel avançado (só base 'trf1')."),
      origem: z.string().optional().describe("Filtro do painel avançado (só base 'trf1')."),
      numero: z.string().optional().describe("Número do processo (CNJ), com ou sem pontuação (só base 'trf1')."),
      ementa_decisao: z.string().optional().describe("Filtro do painel avançado (só base 'trf1')."),
      referencia_legislativa: z.string().optional().describe("Filtro do painel avançado (só base 'trf1')."),
      data_inicio: z.string().optional().describe("AAAA-MM-DD ou DD/MM/AAAA."),
      data_fim: z.string().optional().describe("AAAA-MM-DD ou DD/MM/AAAA."),
      tipo_data: z.enum(["julgamento", "publicacao"]).optional().describe("Padrão 'julgamento'."),
      pagina: z.number().int().optional().describe("Padrão 1."),
      por_pagina: z.number().int().optional().describe(`10, 30 ou 50 (padrão 30). ${POR_PAGINA_VALIDOS.join("/")}.`),
      base: z.enum(["trf1", "tnu", "colegiado"]).optional().describe("Padrão 'trf1'."),
      tipo_acordao: z
        .array(z.enum(Object.keys(TIPOS_ACORDAO_TNU)))
        .optional()
        .describe("Só na base 'tnu': REPRESENTATIVO (Representativo de Controvérsia) e/ou RELEVANTE (Precedente Relevante)."),
    },
  },
  async (a) => ({ content: [{ type: "text", text: await comAvisos(await buscar(a)) }] })
);

server.registerTool(
  "obter_decisao_trf1",
  {
    title: "Obter decisão do TRF1/TNU por número de processo",
    description:
      "Todos os documentos publicados sob um número de processo (acórdão, embargos, decisão monocrática), " +
      "com ementa e dispositivo INTEGRAIS — o substituto do 'inteiro teor' no TRF1. Na base 'tnu' traz também " +
      "o INTEIRO TEOR (relatório + voto) baixado do eproc, até 3 documentos por chamada. Órgão, relator e data " +
      "vêm do FECHO do inteiro teor quando lido (orgao_fonte: 'fecho'), com aviso de DIVERGÊNCIA quando o " +
      "índice discordar; na base 'trf1' o voto não é exposto, então orgao_fonte fica no índice do portal. " +
      "Grava um RECIBO por documento em disco (id, texto, sha256): é contra ele que o lint da peticao-rg e o " +
      "revisor-adversarial conferem a ficha depois, sem gastar o orçamento do portal, e é o que " +
      "verificar_citacao_trf1 usa antes de ir ao portal de novo. Cada citação termina em '— verificação: " +
      "<nível>' (só ementa/índice · inteiro teor lido · inteiro teor lido EM PARTE quando cortado pelo " +
      "orçamento de caracteres — nunca promova EM PARTE a pleno).",
    inputSchema: {
      numero: z.string().describe("Número do processo (CNJ), com ou sem pontuação."),
      base: z.enum(["trf1", "tnu", "colegiado"]).optional().describe("Padrão 'trf1' — a mesma em que o documento foi achado."),
    },
  },
  async (a) => ({ content: [{ type: "text", text: await comAvisos(await obterDecisao(a.numero, a.base)) }] })
);

server.registerTool(
  "verificar_citacao_trf1",
  {
    title: "Verificar citação literal no TRF1/TNU",
    description:
      "Confere se um trecho aparece LITERALMENTE na ementa/dispositivo (e, na TNU, no inteiro teor) do " +
      "julgado, antes de ir entre aspas para a peça — e diz DE QUEM é a frase. USE antes de qualquer citação " +
      "direta. Comparação por palavra inteira, tolerante a caixa, acento e pontuação; mínimo de 4 palavras; " +
      "`[...]` separa fragmentos que devem aparecer em ordem, a no máximo 1.500 caracteres um do outro (não " +
      "costura a abertura da ementa ao fim do dispositivo). Lê primeiro o RECIBO local gravado por " +
      "obter_decisao_trf1 (0 requisições); sem recibo, consulta o portal. " +
      "Na TNU (inteiro teor) o ✅ pode vir com ALERTA DE ATRIBUIÇÃO: TRANSCRIÇÃO (palavra de OUTRO tribunal " +
      "copiada no voto), VOTO DIVERGENTE (pode ser o voto vencido), ENTRE ASPAS (o tribunal citando alguém), " +
      "ALEGAÇÃO DA PARTE (tese da parte relatada, não decisão) e NEGAÇÃO (negativa logo antes: o recorte " +
      "inverte o julgado). Trecho com alerta NÃO entra na ficha como posição do órgão sem resolver a " +
      "atribuição. Na base 'trf1' a atribuição não é analisada porque o voto não é exposto — a resposta diz " +
      "isso. Falha sai como [PESQUISA NÃO REALIZADA — motivo], nunca como ❌.",
    inputSchema: {
      numero: z.string().describe("Número do processo (CNJ), com ou sem pontuação."),
      trecho: z.string().describe("Texto que se pretende citar entre aspas (cortes marcados com [...])."),
      base: z.enum(["trf1", "tnu", "colegiado"]).optional().describe("Padrão 'trf1'."),
    },
  },
  async (a) => ({ content: [{ type: "text", text: await comAvisos(await verificarCitacao(a.numero, a.trecho, a.base)) }] })
);

server.registerTool(
  "diagnostico_ritmo_trf1",
  {
    title: "Diagnóstico do controle de ritmo (TRF1/TNU)",
    description:
      "Mostra por que as buscas do TRF1/TNU podem estar falhando: nível atual do limite de ritmo, orçamento " +
      "consumido, se há bloqueio em curso (e quanto falta para liberar), versão instalada, modo do " +
      "User-Agent e recibos gravados em disco. USE ISTO antes de concluir que 'o portal está fora do ar'. " +
      "Não faz nenhuma requisição.",
    inputSchema: {},
  },
  async () => ({ content: [{ type: "text", text: await comAvisos(diagnosticoRitmoTexto()) }] })
);

const transport = new StdioServerTransport();
await server.connect(transport);
