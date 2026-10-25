// Links de teste grátis. Quem abre desaperto.com/teste/CODIGO faz a versão rápida e o plano completo sem pagar.
// GET  /api/admin/convites                      -> lista
// POST /api/admin/convites { para, usos }       -> cria
// POST /api/admin/convites { codigo, ativo }    -> liga ou desliga
import { json, erro, agora, autorizado, negado, garantirTabelas, codigoConvite, limparCodigo } from '../../../lib/api.js';

export async function onRequestGet({ request, env }) {
  if (!autorizado(request, env)) return negado(env);
  if (!env.DB) return erro('Banco de dados não configurado.', 503);
  await garantirTabelas(env.DB);
  const { results } = await env.DB.prepare(`SELECT c.codigo, c.para, c.usos, c.usos_max, c.ativo, c.criado_em,
      (SELECT COUNT(*) FROM respostas r WHERE r.convite = c.codigo AND r.status = 'plano_enviado') AS planos
    FROM convites c ORDER BY c.criado_em DESC LIMIT 200`).all();
  return json({ ok: true, convites: results });
}

export async function onRequestPost({ request, env }) {
  if (!autorizado(request, env)) return negado(env);
  if (!env.DB) return erro('Banco de dados não configurado.', 503);
  await garantirTabelas(env.DB);
  let c;
  try { c = await request.json(); } catch { return erro('Pedido inválido.'); }
  if (!c || typeof c !== 'object') return erro('Pedido inválido.');
  if (c.codigo !== undefined) {
    const codigo = limparCodigo(c.codigo);
    await env.DB.prepare('UPDATE convites SET ativo = ? WHERE codigo = ?').bind(c.ativo ? 1 : 0, codigo).run();
    return json({ ok: true });
  }
  const para = String(c.para || '').trim().slice(0, 80);
  const usos = Math.min(100, Math.max(1, Math.round(Number(c.usos) || 1)));
  for (let i = 0; i < 3; i++) {
    const codigo = codigoConvite();
    try {
      await env.DB.prepare('INSERT INTO convites (codigo, para, usos_max, criado_em) VALUES (?, ?, ?, ?)').bind(codigo, para, usos, agora()).run();
      return json({ ok: true, codigo, link: `${new URL(request.url).origin}/teste/${codigo}` }, 201);
    } catch (e) { if (!String(e).includes('UNIQUE')) throw e; }
  }
  return erro('Não foi possível criar o link. Tente de novo.', 500);
}
