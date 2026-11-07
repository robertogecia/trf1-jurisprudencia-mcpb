Correções de um teste ao vivo, ferramenta por ferramenta (07/11/2026), e quatro portes da extensão do TJRO.

**Correções**
- A relatora da TNU não some mais: o portal rotula "RELATORA" para juíza e a extensão só lia "RELATOR".
- A "Fonte" da TNU vinha do primeiro "D.E." do texto, que podia ser o de um julgado citado na ementa; agora vem só da referência final.
- "TURMA 4.0 - ADJUNTA A TR-xx" recebe o aviso de Turma Recursal.
- O aviso 🆕 não diz mais "pode não ter sido publicado" ao lado da data de publicação.
- "VOTO-EMENTADIREITO" e "improcedente.2. O autor" (quebra de linha perdida no PJe) saem separados.
- Linha 🚩 de sinal de situação da tese (Questão de Ordem, tema representativo, afetação, desafetação, sobrestamento, súmula cancelada, revisão, superação, modulação): sinal lexical, só para escolher o que abrir; a situação se confere no BNP ou na página oficial de Temas Representativos da TNU.
- Diário de erros: período fora do acervo e zero resultado deixam de contar como erro do autor; o motivo completo é gravado.

**Portes do TJRO**
- `verificar_citacao_trf1`: alerta NEGAÇÃO OMITIDA NO CORTE (negativa escondida pelo `[...]`); regra portada, sem medição própria neste acervo.
- HTTP 500 da TNU ou do DJEN é repetido uma vez, dentro do ritmo (`TRF1_MCP_SEM_RETRY_500=1` desliga).
- Data impossível (30/02) é erro de parâmetro antes de consultar.
- `linha_do_tempo_trf1` aceita `base="tnu"`: uma consulta por ano no portal da TNU, atualizado.

Para atualizar: baixe `Jurisprudencia-TRF1.mcpb`, dê dois cliques e reinicie o Claude.
