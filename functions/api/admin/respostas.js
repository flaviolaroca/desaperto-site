// Área do Flávio. Protegida pelo segredo ADMIN_TOKEN (configurado na Cloudflare).
// GET    /api/admin/respostas            -> lista (sem as respostas completas)
// GET    /api/admin/respostas?id=...     -> uma resposta completa
// POST   /api/admin/respostas            -> { id, status } (muda a situação à mão)
// DELETE /api/admin/respostas?id=...     -> apaga (pedido de exclusão da pessoa)
import { json, erro, agora, limparAntigas, autorizado, negado, STATUS } from '../../../lib/api.js';

export async function onRequest({ request, env }) {
  if (!autorizado(request, env)) return negado(env);
  if (!env.DB) return erro('Banco de dados não configurado.', 503);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (request.method === 'GET') {
    try { await limparAntigas(env.DB); } catch {}
    if (id) {
      const l = await env.DB.prepare('SELECT * FROM respostas WHERE id = ?').bind(id).first();
      if (!l) return erro('Não encontrado.', 404);
      return json({ ok: true, resposta: { ...l, chave_hash: undefined, origem_hash: undefined, dados: JSON.parse(l.dados), plano_resumo: l.plano_resumo ? JSON.parse(l.plano_resumo) : null } });
    }
    const { results } = await env.DB.prepare(
      "SELECT id, protocolo, criado_em, atualizado_em, nome, email, teste, status, plano_enviado_em, plano_gerado_em, plano_resumo, plano_erro, json_array_length(dados, '$.dividas') AS n_dividas FROM respostas ORDER BY criado_em DESC LIMIT 500"
    ).all();
    return json({ ok: true, respostas: results.map((x) => ({ ...x, plano_resumo: x.plano_resumo ? JSON.parse(x.plano_resumo) : null })) });
  }

  if (request.method === 'POST') {
    let corpo;
    try { corpo = await request.json(); } catch { return erro('Corpo inválido.'); }
    if (!corpo || typeof corpo.id !== 'string' || !STATUS.includes(corpo.status)) return erro('Dados inválidos.');
    await env.DB.prepare('UPDATE respostas SET status = ?, plano_enviado_em = ? WHERE id = ?')
      .bind(corpo.status, corpo.status === 'plano_enviado' ? agora() : null, corpo.id).run();
    return json({ ok: true });
  }

  if (request.method === 'DELETE') {
    if (!id) return erro('Falta o id.');
    await env.DB.prepare('DELETE FROM respostas WHERE id = ?').bind(id).run();
    if (env.PLANOS) { try { await env.PLANOS.delete(id); } catch {} }
    return json({ ok: true });
  }

  return erro('Método não permitido.', 405);
}
