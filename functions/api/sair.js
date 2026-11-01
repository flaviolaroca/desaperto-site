// GET /api/sair?id=&a= -> a pessoa não quer mais receber e-mails do Desaperto (link no rodapé dos e-mails de oferta).
import { assinaturaPagar, garantirTabelas } from '../../lib/api.js';

function pagina(titulo, texto) {
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Desaperto</title>
<style>body{margin:0;background:#F3EFE6;color:#16211C;font-family:Arial,Helvetica,sans-serif;line-height:1.55}main{max-width:32rem;margin:0 auto;padding:48px 20px}h1{font-size:1.6rem;line-height:1.15}a{color:#16704A}</style></head>
<body><main><p><b>desaperto</b></p><h1>${titulo}</h1><p>${texto}</p><p><a href="/">Ir para o site</a></p></main></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const id = u.searchParams.get('id') || '', a = u.searchParams.get('a') || '';
  if (!env.DB || !env.ADMIN_TOKEN || !id || a !== (await assinaturaPagar(env, id))) return pagina('Este link não funcionou.', 'Para parar de receber e-mails, responda qualquer um deles ou escreva para contato@desaperto.com.');
  await garantirTabelas(env.DB);
  const l = await env.DB.prepare('SELECT email FROM respostas WHERE id = ?').bind(id).first();
  if (l && l.email) await env.DB.prepare('UPDATE respostas SET sem_emails = 1 WHERE lower(email) = lower(?)').bind(l.email).run();
  return pagina('Pronto. Você não vai mais receber e-mails de oferta do Desaperto.', 'Se já tiver um plano, ele continua com você. Se mudar de ideia, escreva para contato@desaperto.com.');
}
