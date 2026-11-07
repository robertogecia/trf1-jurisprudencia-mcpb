# Novidades

## 1.11.0

Correções achadas em teste ao vivo de 07/11/2026, ferramenta por ferramenta:

- **Relatora da TNU não some mais.** O portal da TNU rotula "RELATORA" quando a relatora é juíza; a extensão só lia "RELATOR", e o campo saía vazio na lista, na triagem e na citação. Agora lê os dois rótulos e, se faltar, pega o nome da referência final do próprio portal.
- **"Fonte" da TNU vinha do julgado errado.** A fonte de publicação era lida do primeiro "D.E." do texto, que podia ser o de um julgado citado na ementa. Agora vem só da referência final do portal.
- **Turma Recursal com nome novo recebe o aviso.** "PRIMEIRA TURMA 4.0 - ADJUNTA A TR-AC" é Turma Recursal e não recebia o aviso de que pesa só em processo de JEF.
- **Julgado recente com data de publicação.** O aviso 🆕 dizia "pode ainda não ter sido publicado" ao lado da data de publicação. Agora, quando há publicação, diz que ainda cabe embargos ou recurso.
- **Texto colado das Turmas Recursais.** "VOTO-EMENTADIREITO" e "improcedente.2. O autor" (quebra de linha perdida no PJe) passam a sair separados, na tela e no recibo.
- **Sinal de situação da tese.** Quando a ementa ou o dispositivo trazem "Questão de Ordem", "tema representativo", "afetação", "sobrestamento", "súmula cancelada", "revisão de tese", "superação" ou "modulação", aparece a linha 🚩. É sinal lexical fraco, só para escolher o que abrir; a situação se confere no BNP.
- **Portes da extensão do TJRO (comparação de 07/11/2026):**
  - `verificar_citacao_trf1` ganha o alerta **NEGAÇÃO OMITIDA NO CORTE**: quando o `[...]` esconde uma negativa que rege o trecho seguinte ("a cobrança [...] é devida" sobre "NÃO é devida"), avisa que o recorte pode inverter o julgado. Regra portada já calibrada no TJRO/TRT14, sem medição própria neste acervo.
  - **HTTP 500 da TNU ou do DJEN é repetido uma vez**, dentro do limite de ritmo, com nota na resposta. No CJF não se repete (a sessão JSF teria de ser refeita). Desliga com `TRF1_MCP_SEM_RETRY_500=1`.
  - **Data impossível é erro de parâmetro** (30/02, 31/04) antes de ir ao portal.
  - **`linha_do_tempo_trf1` aceita `base="tnu"`**: uma consulta por ano no portal da TNU, atualizado. A descrição antiga dizia que o painel de datas não existia na TNU; existe desde que a TNU passou ao eproc (v1.8.0).
- **Diário de erros mais honesto.** Período fora do acervo (TRF1 só até 29/02/2024) e zero resultado deixam de contar como erro que o autor corrige; o motivo completo da falha passa a ser gravado (antes saía só "[PESQUISA NÃO REALIZADA]"), e "respondeu algo inesperado" é classificado como resposta inesperada.

Para atualizar: baixe `Jurisprudencia-TRF1.mcpb`, dê dois cliques e reinicie o Claude.

## 1.10.2

- **Uma segunda tentativa quando a página inicial do portal vem estranha.** Houve relato de falha intermitente, quase sempre na primeira consulta depois de um tempo parada: o portal respondia sem a página do formulário e a busca saía como "pesquisa não realizada". Agora a extensão tenta mais uma vez, com sessão nova, antes de desistir. Desafio de navegador, bloqueio e captcha continuam sem repetição.
- **O erro agora diz que página o portal devolveu.** O aviso passa a trazer o tipo de conteúdo, o tamanho, o título e o início da página recebida (só da página inicial, nunca texto de busca). Antes, o tipo de conteúdo aparecia cortado no diário de erros e não dava para saber se era manutenção, desafio ou sessão expirada.
- **A causa da falha intermitente não foi confirmada.** Não consegui reproduzi-la numa máquina Mac, com três consultas espaçadas. Se o erro voltar, o relatório de `diagnostico_erros_trf1` já traz a evidência que faltava.

Para atualizar: baixe `Jurisprudencia-TRF1.mcpb`, dê dois cliques e reinicie o Claude. Se houver duas ou mais extensões de TRF1 instaladas (versões antigas), desinstale as antigas: elas dividem o mesmo contador de requisições e a mesma pasta de registros.

## 1.10.1

- **O aviso da auditoria para processo ainda não lido agora aponta o caminho certo.** Quando a minuta cita um processo da Justiça Federal da 1ª Região que não foi lido nesta máquina, o aviso 🟡 passa a dizer: até 29/02/2024, abra com `obter_decisao_trf1`; depois dessa data, o acórdão de 2º grau se confere no JusRatio e a sentença ou publicação em `buscar_djen_trf1`. Julgado do JusRatio não deixa registro nesta extensão, então a auditoria continua dando 🟡 para ele, e o aviso agora diz isso.

Para atualizar: baixe `Jurisprudencia-TRF1.mcpb`, dê dois cliques e reinicie o Claude.

## 1.7.5

- **Voto vencido não é mais confundido com o voto condutor da TNU.** Quando o relator vencido e o juiz que conduziu o julgamento tinham o mesmo sobrenome, a extensão podia tratar o voto vencido como se fosse a posição da Turma. Agora ela separa os dois.
- **"nº", "n." e "n.º" na citação não apagam mais os alertas.** Escrever o número do processo com essas abreviações fazia a conferência da citação perder avisos importantes. Os alertas continuam aparecendo, qualquer que seja a grafia.
- **Reticências [...] mais confiáveis.** Citações com trechos omitidos entre colchetes são conferidas com mais precisão contra o texto da decisão.
- **Leitura da posição do julgado bem mais rápida.** A identificação de quem decidiu o quê no acórdão ficou consideravelmente mais ágil.
- **Testes isolados da sua pasta pessoal.** Os testes automáticos da extensão agora rodam numa pasta temporária e nunca tocam nos registros que a extensão guarda no seu computador.

Para atualizar: baixe `Jurisprudencia-TRF1.mcpb`, dê dois cliques e reinicie o Claude.
