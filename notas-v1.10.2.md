Duas mudanças pequenas, motivadas por um relato de falha intermitente na primeira consulta depois de um tempo parada (o portal respondia sem a página do formulário e a busca saía como "pesquisa não realizada"):

- Quando a página inicial do portal vem estranha, a extensão tenta mais uma vez, com sessão nova, antes de desistir. Desafio de navegador, bloqueio e captcha continuam sem repetição.
- O aviso de erro agora diz que página o portal devolveu (tipo de conteúdo, tamanho, título e início da página inicial, nunca texto de busca). Antes o tipo aparecia cortado no diário de erros.

A causa da falha não foi confirmada: não consegui reproduzi-la numa máquina Mac. Se voltar, `diagnostico_erros_trf1` já traz a evidência que faltava. Quem tiver duas ou mais extensões de TRF1 instaladas deve manter só esta: as antigas dividem o mesmo contador e a mesma pasta de registros.

Para atualizar: baixe `Jurisprudencia-TRF1.mcpb`, dê dois cliques e reinicie o Claude.
