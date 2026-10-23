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

## Depois de no ar
- Respostas: desaperto.com/admin, com a `ADMIN_TOKEN`.
- Cada resposta é apagada sozinha 90 dias depois do envio.
- Toda mudança enviada para este repositório é publicada sozinha em cerca de 1 minuto.
