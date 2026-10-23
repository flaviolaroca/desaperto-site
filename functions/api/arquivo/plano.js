// GET /api/arquivo/plano?id=...&a=... -> o PDF, por link assinado. Usado pelo Resend para anexar o plano ao e-mail.
import { erro, assinatura } from '../../../lib/api.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';
  const a = url.searchParams.get('a') || '';
  if (!id || !env.PLANOS || !env.ADMIN_TOKEN || a !== (await assinatura(env, id))) return erro('Não encontrado.', 404);
  const pdf = await env.PLANOS.get(id, 'stream');
  if (!pdf) return erro('Não encontrado.', 404);
  return new Response(pdf, { headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}
