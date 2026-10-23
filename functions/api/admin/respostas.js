// Área do Flávio. Protegida pelo segredo ADMIN_TOKEN (configurado na Cloudflare).
// GET    /api/admin/respostas            -> lista (sem as respostas completas)
// GET    /api/admin/respostas?id=...     -> uma resposta completa
// POST   /api/admin/respostas            -> { id, status: 'plano_enviado' | 'recebido' }
// DELETE /api/admin/respostas?id=...     -> apaga (pedido de exclusão da pessoa)
import { json, erro, agora, limparAntigas } from '../../../lib/api.js';

function autorizado(request, env) {
  const t = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 20) return false;
  if (t.length !== env.ADMIN_TOKEN.length) return false;
  let dif = 0;
  for (let i = 0; i < t.length; i++) dif |= t.charCodeAt(i) ^ env.ADMIN_TOKEN.charCodeAt(i);
  return dif === 0;
}

export async function onRequest({ request, env }) {
  if (!autorizado(request, env)) return erro('Acesso negado.', 401);
  if (!env.DB) return erro('Banco de dados não configurado.', 503);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (request.method === 'GET') {
    try { await limparAntigas(env.DB); } catch {}
    if (id) {
      const l = await env.DB.prepare('SELECT * FROM respostas WHERE id = ?').bind(id).first();
      if (!l) return erro('Não encontrado.', 404);
      return json({ ok: true, resposta: { ...l, chave_hash: undefined, origem_hash: undefined, dados: JSON.parse(l.dados) } });
    }
    const { results } = await env.DB.prepare(
      "SELECT id, protocolo, criado_em, atualizado_em, nome, email, teste, status, plano_enviado_em, json_array_length(dados, '$.dividas') AS n_dividas FROM respostas ORDER BY criado_em DESC LIMIT 500"
    ).all();
    return json({ ok: true, respostas: results });
  }

  if (request.method === 'POST') {
    let corpo;
    try { corpo = await request.json(); } catch { return erro('Corpo inválido.'); }
    if (!corpo || typeof corpo.id !== 'string' || !['plano_enviado', 'recebido'].includes(corpo.status)) return erro('Dados inválidos.');
    await env.DB.prepare('UPDATE respostas SET status = ?, plano_enviado_em = ? WHERE id = ?')
      .bind(corpo.status, corpo.status === 'plano_enviado' ? agora() : null, corpo.id).run();
    return json({ ok: true });
  }

  if (request.method === 'DELETE') {
    if (!id) return erro('Falta o id.');
    await env.DB.prepare('DELETE FROM respostas WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  return erro('Método não permitido.', 405);
}
