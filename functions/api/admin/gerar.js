// POST /api/admin/gerar { id } -> pede ao GitHub para gerar o plano de novo.
import { json, erro, autorizado, pedirPlano } from '../../../lib/api.js';

export async function onRequestPost({ request, env }) {
  if (!autorizado(request, env)) return erro('Acesso negado.', 401);
  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo inválido.'); }
  if (!corpo || typeof corpo.id !== 'string') return erro('Falta o id.');
  if (!(await pedirPlano(env, corpo.id))) return erro('Não foi possível pedir o plano ao GitHub. Confira o GITHUB_TOKEN.', 502);
  await env.DB.prepare("UPDATE respostas SET status = 'gerando', plano_erro = NULL WHERE id = ?").bind(corpo.id).run();
  return json({ ok: true });
}
