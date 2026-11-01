// POST /api/admin/campanha { acao: 'simular' | 'enviar', ate: 'AAAA-MM-DD' }
// E-mail do criador com o preço especial para quem já calculou a data e não comprou. Uma vez por pessoa (campanha_em).
// Responde só contagens: o resultado vai para um repositório público.
import { json, erro, agora, autorizado, negado, garantirTabelas, enviarCampanha, precoVolta } from '../../../lib/api.js';

const POR_DIA = 60;

export async function onRequestPost({ request, env }) {
  if (!autorizado(request, env)) return negado(env);
  if (!env.DB) return erro('Banco de dados não configurado.', 503);
  let c; try { c = await request.json(); } catch { return erro('Pedido inválido.'); }
  if (!c || !['simular', 'enviar'].includes(c.acao) || !/^\d{4}-\d{2}-\d{2}$/.test(String(c.ate || ''))) return erro('Pedido inválido.');
  if (!precoVolta(env)) return erro('O preço especial está desligado (PRECO_VOLTA=0).');
  const ateMs = Date.parse(`${c.ate}T23:59:59-03:00`);
  if (!(ateMs > Date.now())) return erro('A data final já passou.');
  await garantirTabelas(env.DB);
  const pagos = new Set((await env.DB.prepare("SELECT lower(email) AS e FROM respostas WHERE pago_em IS NOT NULL AND email IS NOT NULL").all()).results.map((x) => x.e));
  const { results } = await env.DB.prepare(`SELECT id, nome, email, status, estimativa, plano_resumo, criado_em, promo_ate, teste, pago_em FROM respostas
    WHERE teste = 0 AND sem_emails = 0 AND email IS NOT NULL AND pago_em IS NULL AND devolvido_em IS NULL AND campanha_em IS NULL
      AND status IN ('rapido', 'plano_pronto', 'revisao') ORDER BY criado_em DESC`).all();
  const vistos = new Set(), alvo = [];
  for (const l of results) { const e = l.email.trim().toLowerCase(); if (vistos.has(e) || pagos.has(e)) continue; vistos.add(e); alvo.push(l); }
  if (c.acao === 'simular') return json({ ok: true, simulado: true, elegiveis: alvo.length, ate: c.ate });
  let enviados = 0, falhas = 0;
  const origem = new URL(request.url).origin, ateIso = new Date(ateMs).toISOString();
  for (const l of alvo.slice(0, POR_DIA)) {
    await env.DB.prepare('UPDATE respostas SET promo_ate = ? WHERE id = ?').bind(ateIso, l.id).run();
    if (await enviarCampanha(env, { ...l, promo_ate: ateIso }, origem, ateMs)) { enviados++; await env.DB.prepare('UPDATE respostas SET campanha_em = ? WHERE id = ?').bind(agora(), l.id).run(); }
    else falhas++;
  }
  return json({ ok: true, elegiveis: alvo.length, enviados, falhas, ate: c.ate });
}
