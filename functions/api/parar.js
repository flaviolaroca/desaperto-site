// GET /api/parar?id=&a= -> para o e-mail mensal do plano (link no fim de cada e-mail).
import { assinaturaAcomp, garantirTabelas } from '../../lib/api.js';

function pagina(titulo, texto) {
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Desaperto</title>
<style>body{margin:0;background:#F3EFE6;color:#16211C;font-family:Arial,Helvetica,sans-serif;line-height:1.55}main{max-width:32rem;margin:0 auto;padding:48px 20px}h1{font-size:1.6rem;line-height:1.15;margin:0 0 12px}a{color:#16704A}</style></head>
<body><main><p><b>desaperto</b></p><h1>${titulo}</h1><p>${texto}</p><p><a href="/">Ir para o site</a></p></main></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const id = u.searchParams.get('id') || '', a = u.searchParams.get('a') || '';
  if (!env.DB || !env.ADMIN_TOKEN || !id || a !== (await assinaturaAcomp(env, id))) return pagina('Este link não funcionou.', 'Se quiser parar de receber os e-mails, responda qualquer um deles ou escreva para contato@desaperto.com.');
  await garantirTabelas(env.DB);
  await env.DB.prepare('DELETE FROM acompanhamento WHERE resposta_id = ?').bind(id).run();
  return pagina('Pronto. Você não vai mais receber o e-mail do mês.', 'O seu plano continua com você, no e-mail em que ele chegou. Se mudar de ideia, escreva para contato@desaperto.com.');
}
