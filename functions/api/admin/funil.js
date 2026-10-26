// GET  /api/admin/funil?dias=30  -> soma de cada passo no período, e por dia.
// POST /api/admin/funil { zerar: true } -> apaga a contagem de acessos e passa a contar a partir de agora.
import { json, erro, agora, autorizado, negado, garantirTabelas, diaBrasil } from '../../../lib/api.js';

export async function onRequestGet({ request, env }) {
  if (!autorizado(request, env)) return negado(env);
  if (!env.DB) return erro('Banco de dados não configurado.', 503);
  await garantirTabelas(env.DB);
  const dias = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get('dias')) || 30));
  let desde = diaBrasil(Date.now() - (dias - 1) * 864e5);
  let desdeHora = desde + 'T03:00:00.000Z';  // meia-noite em Brasília
  const z = await env.DB.prepare("SELECT valor FROM config WHERE chave = 'funil_desde'").first();
  if (z && z.valor && z.valor > desdeHora) { desdeHora = z.valor; desde = diaBrasil(new Date(z.valor).getTime()); }
  const { results } = await env.DB.prepare('SELECT evento, SUM(n) AS n FROM eventos WHERE dia >= ? GROUP BY evento').bind(desde).all();
  const total = Object.fromEntries(results.map((x) => [x.evento, x.n]));
  const v = await env.DB.prepare('SELECT COUNT(*) AS n, SUM(pago_valor) AS soma FROM respostas WHERE pago_em >= ? AND devolvido_em IS NULL AND pago_valor > 0 AND teste = 0').bind(desdeHora).first();
  const po = (await env.DB.prepare("SELECT COALESCE(origem, 'sem origem') AS origem, COUNT(*) AS datas, SUM(CASE WHEN pago_em IS NOT NULL AND pago_valor > 0 AND devolvido_em IS NULL THEN 1 ELSE 0 END) AS vendas FROM respostas WHERE criado_em >= ? AND teste = 0 AND (pag_status IS NULL OR pag_status != 'convite') GROUP BY 1 ORDER BY 2 DESC LIMIT 20").bind(desdeHora).all()).results;
  return json({ ok: true, dias, desde, zerado_em: z ? z.valor : null, total, vendas: v ? v.n : 0, receita: v && v.soma ? v.soma : 0, por_origem: po });
}

export async function onRequestPost({ request, env }) {
  if (!autorizado(request, env)) return negado(env);
  if (!env.DB) return erro('Banco de dados não configurado.', 503);
  let c;
  try { c = await request.json(); } catch { return erro('Pedido inválido.'); }
  if (!c || c.zerar !== true) return erro('Pedido inválido.');
  await garantirTabelas(env.DB);
  const quando = agora();
  await env.DB.prepare('DELETE FROM eventos').run();
  await env.DB.prepare("INSERT INTO config (chave, valor) VALUES ('funil_desde', ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor").bind(quando).run();
  return json({ ok: true, zerado_em: quando });
}
