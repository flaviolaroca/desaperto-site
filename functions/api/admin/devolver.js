// POST /api/admin/devolver { id } -> devolve o pagamento pelo Mercado Pago (garantia de 7 dias).
import { json, erro, autorizado, negado, garantirTabelas, devolverPagamento } from '../../../lib/api.js';

export async function onRequestPost({ request, env }) {
  if (!autorizado(request, env)) return negado(env);
  let c;
  try { c = await request.json(); } catch { return erro('Corpo inválido.'); }
  if (!c || typeof c.id !== 'string') return erro('Falta o id.');
  await garantirTabelas(env.DB);
  const r = await devolverPagamento(env, c.id);
  return r.ok ? json({ ok: true }) : erro(r.erro, 400);
}
