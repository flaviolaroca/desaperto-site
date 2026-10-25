// Aviso do Mercado Pago de que um pagamento mudou. Nunca confia no conteúdo do aviso:
// pega só o número do pedido (ORD...) e confere direto no Mercado Pago (confirmarPagamento).
// Configurado no painel do Mercado Pago: Webhooks, evento "Order (Mercado Pago)", URL https://desaperto.com/api/mp/notificacao
import { json, garantirTabelas, cobrancaAtiva, confirmarPagamento } from '../../../lib/api.js';

export async function onRequest({ request, env }) {
  if (!env.DB || !cobrancaAtiva(env)) return json({ ok: true });
  const u = new URL(request.url);
  let id = u.searchParams.get('data.id') || u.searchParams.get('id') || '';
  let tipo = u.searchParams.get('type') || u.searchParams.get('topic') || '';
  if (request.method === 'POST') {
    try { const b = await request.json(); id = (b && b.data && b.data.id) || id; tipo = (b && (b.type || b.topic)) || tipo; } catch {}
  }
  if (!id || !/^ORD[A-Za-z0-9]{4,60}$/.test(String(id)) || (tipo && !String(tipo).includes('order'))) return json({ ok: true });
  await garantirTabelas(env.DB);
  const r = await confirmarPagamento(env, String(id), u.origin);
  return json({ ok: true, r: r.ok }, r.ok || r.erro === 'Resposta não encontrada.' || r.erro === 'Pagamento sem referência.' ? 200 : 500);
}
