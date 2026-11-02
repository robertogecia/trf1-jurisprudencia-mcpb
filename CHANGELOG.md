# Novidades

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
