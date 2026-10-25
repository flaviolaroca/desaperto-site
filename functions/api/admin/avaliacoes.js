// Área interna: avaliações.
// GET    /api/admin/avaliacoes            -> todas
// POST   /api/admin/avaliacoes            -> { id, status: 'aprovada'|'recusada'|'nova', texto_publicado? }
// DELETE /api/admin/avaliacoes?id=...     -> apaga (pedido da pessoa)
import { json, erro, agora, autorizado, negado, garantirTabelas } from '../../../lib/api.js';

export async function onRequest({ request, env }) {
  if (!autorizado(request, env)) return negado(env);
  if (!env.DB) return erro('Banco de dados não configurado.', 503);
  await garantirTabelas(env.DB);
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM avaliacoes ORDER BY atualizado_em DESC LIMIT 500').all();
    return json({ ok: true, avaliacoes: results });
  }
  if (request.method === 'POST') {
    let c;
    try { c = await request.json(); } catch { return erro('Corpo inválido.'); }
    if (!c || typeof c.id !== 'string' || !['aprovada', 'recusada', 'nova'].includes(c.status)) return erro('Dados inválidos.');
    const l = await env.DB.prepare('SELECT autoriza, texto FROM avaliacoes WHERE id = ?').bind(c.id).first();
    if (!l) return erro('Não encontrada.', 404);
    if (c.status === 'aprovada' && l.autoriza === 'nao') return erro('A pessoa não autorizou publicar esta avaliação.');
    const pub = typeof c.texto_publicado === 'string' && c.texto_publicado.trim() && c.texto_publicado.trim() !== l.texto ? c.texto_publicado.trim().slice(0, 1500) : null;
    await env.DB.prepare('UPDATE avaliacoes SET status = ?, texto_publicado = ?, aprovado_em = ? WHERE id = ?')
      .bind(c.status, pub, c.status === 'aprovada' ? agora() : null, c.id).run();
    return json({ ok: true });
  }
  if (request.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return erro('Falta o id.');
    await env.DB.prepare('DELETE FROM avaliacoes WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }
  return erro('Método não permitido.', 405);
}
