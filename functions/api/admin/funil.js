// GET /api/admin/funil?dias=30 -> soma de cada passo no período, e por dia.
import { json, erro, autorizado, negado, garantirTabelas, diaBrasil } from '../../../lib/api.js';

export async function onRequestGet({ request, env }) {
  if (!autorizado(request, env)) return negado(env);
  if (!env.DB) return erro('Banco de dados não configurado.', 503);
  await garantirTabelas(env.DB);
  const dias = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get('dias')) || 30));
  const desde = diaBrasil(Date.now() - (dias - 1) * 864e5);
  const { results } = await env.DB.prepare('SELECT evento, SUM(n) AS n FROM eventos WHERE dia >= ? GROUP BY evento').bind(desde).all();
  const total = Object.fromEntries(results.map((x) => [x.evento, x.n]));
  const v = await env.DB.prepare('SELECT COUNT(*) AS n, SUM(pago_valor) AS soma FROM respostas WHERE pago_em >= ? AND devolvido_em IS NULL').bind(desde).first();
  return json({ ok: true, dias, desde, total, vendas: v ? v.n : 0, receita: v && v.soma ? v.soma : 0 });
}
