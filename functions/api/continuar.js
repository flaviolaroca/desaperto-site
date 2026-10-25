// GET /api/continuar?id=&a= -> as respostas da versão rápida, para começar o questionário completo já preenchido.
import { json, erro, assinaturaPagar, garantirTabelas } from '../../lib/api.js';

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const id = u.searchParams.get('id') || '', a = u.searchParams.get('a') || '';
  if (!env.DB || !env.ADMIN_TOKEN || !id || a !== (await assinaturaPagar(env, id))) return erro('Este link não é válido ou as respostas já foram apagadas.', 404);
  await garantirTabelas(env.DB);
  const l = await env.DB.prepare('SELECT status, dados, protocolo, pago_em FROM respostas WHERE id = ?').bind(id).first();
  if (!l) return erro('Este link não é válido ou as respostas já foram apagadas.', 404);
  const d = JSON.parse(l.dados || '{}');
  return json({ ok: true, status: l.status, protocolo: l.protocolo, pago: !!l.pago_em,
    rapido: d.rapido ? { nome: d.nome, email: d.email, renda: d.renda, guardado: d.guardado, gastos: d.gastosR || {}, dividas: d.dividasR || [] } : null });
}
