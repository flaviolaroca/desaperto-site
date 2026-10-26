// POST /api/evento { e } -> soma 1 na contagem do dia daquele passo. Sem cookie, sem nome, sem IP guardado.
import { json, garantirTabelas, evento } from '../../lib/api.js';

const PERMITIDOS = /^(v_inicio|v_rapido|v_comecar|v_progresso|gerou_cartao|compartilhou|indicou|v_pagar_data|clicou_pix|copiou_pix|etapa_[a-z0-9]{2,20}|origem_(instagram|tiktok|whatsapp|google|facebook|youtube|email|anuncio|outro|direto)|anuncio_[a-z0-9]{1,12})$/;

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: true });
  let e = '';
  try { e = JSON.parse(await request.text()).e; } catch {}
  if (typeof e !== 'string' || !PERMITIDOS.test(e)) return json({ ok: false }, 400);
  await garantirTabelas(env.DB);
  await evento(env.DB, e);
  return json({ ok: true });
}
