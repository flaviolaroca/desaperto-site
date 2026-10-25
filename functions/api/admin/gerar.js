// POST /api/admin/gerar { id } -> pede ao GitHub para gerar o plano de novo.
import { json, erro, autorizado, negado, pedirPlano } from '../../../lib/api.js';

export async function onRequestPost({ request, env }) {
  if (!autorizado(request, env)) return negado(env);
  let corpo;
  try { corpo = await request.json(); } catch { return erro('Corpo inválido.'); }
  if (!corpo || typeof corpo.id !== 'string') return erro('Falta o id.');
  const l = await env.DB.prepare('SELECT status FROM respostas WHERE id = ?').bind(corpo.id).first();
  if (!l) return erro('Resposta não encontrada.', 404);
  if (l.status === 'rapido') return erro('Esta pessoa só fez a versão rápida. O plano só sai depois das respostas completas.');
  if (!(await pedirPlano(env, corpo.id))) return erro('Não foi possível pedir o plano ao GitHub. Confira o GITHUB_TOKEN.', 502);
  await env.DB.prepare("UPDATE respostas SET status = 'gerando', plano_erro = NULL WHERE id = ?").bind(corpo.id).run();
  return json({ ok: true });
}
