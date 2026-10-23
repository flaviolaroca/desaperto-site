// POST /api/admin/enviar { id } -> envia o plano por e-mail para a pessoa.
import { json, erro, autorizado, negado, enviarPlano } from '../../../lib/api.js';

export async function onRequestPost({ request, env }) {
  if (!autorizado(request, env)) return negado(env);
  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo inválido.'); }
  if (!corpo || typeof corpo.id !== 'string') return erro('Falta o id.');
  const r = await enviarPlano(env, corpo.id, new URL(request.url).origin);
  return r.ok ? json({ ok: true }) : erro(r.erro, 400);
}
