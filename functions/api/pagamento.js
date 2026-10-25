// Página /pagar (link assinado). Mostra a data grátis e cobra o plano completo por Pix.
// GET  /api/pagamento?id=&a=        -> em que pé está: gerando, revisão, oferta, pix, pago, enviado
// POST /api/pagamento { id, a }     -> gera (ou devolve) o Pix
import { json, erro, agora, assinaturaPagar, garantirTabelas, cobrancaAtiva, preco, reaisCentavos, dataGratis, dataDaLinha, mascararEmail,
  criarPix, confirmarPagamento, evento } from '../../lib/api.js';

async function buscar(env, id, a) {
  if (!env.DB || !env.ADMIN_TOKEN || !id || !a || a !== (await assinaturaPagar(env, id))) return null;
  await garantirTabelas(env.DB);
  return env.DB.prepare("SELECT json_extract(dados, '$.objetivo') AS objetivo, id, nome, email, protocolo, status, plano_resumo, estimativa, teste, pag_id, pag_status, pag_qr, pag_qr_img, pag_expira, pago_em, devolvido_em FROM respostas WHERE id = ?").bind(id).first();
}

function situacao(env, l, a) {
  const base = { primeiro_nome: (l.nome || '').trim().split(/\s+/)[0] || '', email: mascararEmail(l.email), protocolo: l.protocolo,
    preco: preco(env), preco_txt: reaisCentavos(preco(env)), cobrar: cobrancaAtiva(env), pago: !!l.pago_em,
    recebedor: String(env.PIX_RECEBEDOR || '').trim().slice(0, 80), objetivo: String(l.objetivo || '').trim().slice(0, 140) };
  if (l.status === 'rapido') {
    const data = dataDaLinha(l);
    if (l.devolvido_em) return { ...base, estado: 'devolvido', data };
    const continuar = `/comecar?continuar=${encodeURIComponent(l.id)}&a=${a}`;
    if (l.pago_em || !base.cobrar) return { ...base, estado: 'completar', data, continuar, gratis: !base.cobrar };
    if (l.pag_id && l.pag_status === 'pending' && l.pag_expira && new Date(l.pag_expira).getTime() > Date.now() + 60e3)
      return { ...base, estado: 'pix', data, pix: { qr: l.pag_qr, img: l.pag_qr_img, expira: l.pag_expira } };
    return { ...base, estado: 'oferta', data };
  }
  if (['recebido', 'gerando'].includes(l.status)) return { ...base, estado: 'gerando' };
  if (l.status === 'erro_plano') return { ...base, estado: 'erro' };
  const resumo = l.plano_resumo ? JSON.parse(l.plano_resumo) : {};
  const data = dataGratis(resumo);
  if (l.devolvido_em) return { ...base, estado: 'devolvido', data };
  if (resumo.dados_graves && !l.pago_em && l.status !== 'plano_enviado') return { ...base, estado: 'revisao' };
  if (l.status === 'plano_enviado') return { ...base, estado: 'enviado', data };
  if (l.pago_em || !base.cobrar) return { ...base, estado: 'pago', data, revisao: !!resumo.precisa_revisao, gratis: !base.cobrar };
  if (l.pag_id && l.pag_status === 'pending' && l.pag_expira && new Date(l.pag_expira).getTime() > Date.now() + 60e3)
    return { ...base, estado: 'pix', data, pix: { qr: l.pag_qr, img: l.pag_qr_img, expira: l.pag_expira } };
  return { ...base, estado: 'oferta', data };
}

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  let l = await buscar(env, u.searchParams.get('id') || '', u.searchParams.get('a') || '');
  if (!l) return erro('Este link não é válido ou as respostas já foram apagadas.', 404);
  // Pix em aberto: confere direto no Mercado Pago, caso o aviso automático atrase
  if (cobrancaAtiva(env) && l.pag_id && l.pag_status === 'pending' && !l.pago_em) {
    const c = await confirmarPagamento(env, l.pag_id, u.origin);
    if (c.ok && (c.pago || c.status !== 'pending')) l = await buscar(env, l.id, u.searchParams.get('a'));
  }
  return json({ ok: true, ...situacao(env, l, u.searchParams.get('a')) });
}

export async function onRequestPost({ request, env }) {
  let c;
  try { c = await request.json(); } catch { return erro('Pedido inválido.'); }
  const l = await buscar(env, c && c.id, c && c.a);
  if (!l) return erro('Este link não é válido ou as respostas já foram apagadas.', 404);
  if (!cobrancaAtiva(env)) return erro('O pagamento ainda não está disponível.', 503);
  const s = situacao(env, l, c.a);
  if (s.estado === 'pix') return json({ ok: true, ...s });
  if (s.estado !== 'oferta') return json({ ok: true, ...s });
  const r = await criarPix(env, l, new URL(request.url).origin);
  if (!r.ok) return erro('Não conseguimos gerar o Pix agora. Tente de novo em alguns minutos. (' + r.erro + ')', 502);
  await evento(env.DB, 'pix_gerado');
  return json({ ok: true, ...s, estado: 'pix', pix: { qr: r.pix.qr, img: r.pix.img, expira: r.pix.expira } });
}
