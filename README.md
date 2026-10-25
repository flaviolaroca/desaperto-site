# desaperto.com

Site do Desaperto, publicado pela Cloudflare Pages a partir deste repositório.

## O que tem aqui
- `public/`: o site pronto (gerado por `python3 build.py`). É esta pasta que a Cloudflare publica.
- `functions/api/respostas.js`: recebe as respostas do questionário e guarda no banco (D1).
- `functions/api/admin/respostas.js`: lista, mostra, marca e apaga respostas. Protegida pela chave `ADMIN_TOKEN`.
- `lib/api.js`: funções comuns (validação, limite de envios, limpeza de 90 dias, e-mail opcional).
- `schema.sql`: a tabela do banco. Rodar uma vez no console do D1.
- `src/`: termos, privacidade, área interna e o estilo dessas páginas.
- Para mudar o site: edite os arquivos de `src/`, rode `python3 build.py` e envie as mudanças (inclusive `public/`).

## Configuração na Cloudflare (uma vez)
1. Workers & Pages → Create → Pages → Connect to Git → este repositório.
   - Framework preset: None. Build command: vazio. Build output directory: `public`.
2. Storage & Databases → D1 → Create database → nome `desaperto`.
   - Abra o banco → Console → cole `schema.sql` → Execute.
3. No projeto Pages → Settings → Bindings → Add → D1 database → nome da variável `DB` → banco `desaperto`.
4. Settings → Variables and Secrets:
   - `ADMIN_TOKEN` (Secret): uma chave longa e aleatória. É a senha da página /admin.
   - `SAL_ORIGEM` (Secret): outro texto aleatório (usado só para limitar envios repetidos).
   - Opcional, para e-mails automáticos: `RESEND_API_KEY` (Secret), `EMAIL_AVISO` = contato@desaperto.com, `EMAIL_REMETENTE` = `Desaperto <contato@desaperto.com>`.
5. Custom domains → Set up a domain → `desaperto.com` (e depois `www.desaperto.com`).
6. Deployments → Retry deployment, para as configurações valerem.

## Geração automática do plano
- Quando chega uma resposta, o site pede ao GitHub para rodar `.github/workflows/gerar-plano.yml`.
- O workflow busca as respostas, roda o motor (`motor/`), gera o PDF e devolve ao site. A resposta fica como "Plano pronto" no /admin.
- Na /admin: "Ver plano" abre o PDF; "Enviar plano" manda por e-mail com o PDF anexo.
- Envio sem revisão: variável `ENVIO_AUTOMATICO` = `sim` na Cloudflare. Mesmo assim, planos com aviso grave ficam para revisão.

Configuração extra:
- Cloudflare → KV → criar namespace `desaperto-planos` → no projeto Pages, ligação KV com nome `PLANOS`.
- Cloudflare, segredos: `GITHUB_TOKEN` (token do GitHub com permissão de Contents: Read and write só neste repositório) e `RESEND_API_KEY`.
- GitHub → Settings → Secrets and variables → Actions → `ADMIN_TOKEN` (a mesma da Cloudflare).
- Banco criado antes: rodar os três `ALTER TABLE` do fim de `schema.sql`.

## Depois de no ar
- Respostas: desaperto.com/admin, com a `ADMIN_TOKEN`.
- Cada resposta é apagada sozinha 90 dias depois do envio.
- Toda mudança enviada para este repositório é publicada sozinha em cerca de 1 minuto.

## Avaliações
- O PDF traz, na última página, um link assinado para a pessoa avaliar. Dois dias depois do plano (se ela ainda não avaliou) e 30 dias depois, o site manda um e-mail pedindo a avaliação.
- Os e-mails saem pelo workflow `.github/workflows/lembretes.yml`, uma vez por dia (8h47 de Brasília), no máximo 40 por dia.
- Na /admin, seção Avaliações: "Pôr no site" publica o comentário (só os autorizados). "Corrigir e pôr" permite arrumar erro de digitação.
- A página inicial mostra a seção "Quem já recebeu o plano" sozinha quando houver 3 ou mais comentários publicados.
- A tabela `avaliacoes` e as colunas novas são criadas sozinhas pelo site na primeira vez.

## Cobrança (Pix pelo Mercado Pago)
- Liga sozinha quando existe o segredo `MP_ACCESS_TOKEN` na Cloudflare (Access Token de produção do Mercado Pago). Sem ele, o plano continua grátis e é enviado direto.
- Preço: R$ 34,90 (dá para mudar com a variável `PRECO`, ex.: `29.90`).
- Fluxo: a pessoa responde → vai para /pagar → vê a data grátis → paga o Pix → o Mercado Pago avisa `/api/mp/notificacao` → o site confere o pagamento direto no Mercado Pago e manda o plano.
- Quem saiu antes de pagar recebe a data por e-mail e, 24 horas depois, um lembrete (uma vez só).
- Devolução (garantia de 7 dias): botão "Devolver" no /admin.
- "Enviar sem cobrar" no /admin manda o plano de graça (testadores, cortesias).

## E-mail do mês
- Quem marca "Sim, quero" no questionário recebe, entre os dias 3 e 7 de cada mês, o que fazer naquele mês. Sai pelo mesmo workflow diário dos pedidos de avaliação.
- Os dados ficam na tabela `acompanhamento` só até o plano acabar.

## Funil
- O site conta, por dia, quantas vezes cada passo acontece (sem cookie, sem nome). O resumo fica no topo do /admin.

## Versão rápida (data aproximada)
- A página inicial leva para /rapido: 4 telas, de cabeça (renda, 4 gastos, dívidas com valor aproximado, dinheiro guardado). A data é calculada no navegador, com os juros médios de referência do motor, e mostrada em /pagar como "aproximada".
- Depois do pagamento, a pessoa completa o questionário em /comecar?continuar=... (link no e-mail e na página). Só então o motor roda e o plano exato é enviado.
- Quem pagou e não completou recebe um lembrete 2 dias depois. No /admin aparece como "Data rápida · falta completar".

## Cartão para o story
- /cartao.js desenha a imagem (1080 x 1920) com a contagem e a barra de progresso, sem valores e sem nome.
- Aparece na página /pagar (depois da data e depois do pagamento) e em /progresso, que tem link no e-mail do plano e no e-mail de cada mês.
- Opcional: variável `PIX_RECEBEDOR` com o nome exato que aparece como recebedor no app do banco (veja no seu pagamento de teste). A tela do Pix passa a mostrar esse nome. Sem ela, mostra "o nome do responsável pelo Desaperto".
