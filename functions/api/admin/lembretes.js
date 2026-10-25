// POST /api/admin/lembretes -> e-mails do dia, chamado uma vez por dia pelo GitHub (.github/workflows/lembretes.yml):
//   1. o e-mail do mês (acompanhamento), entre os dias 3 e 7
//   2. um lembrete para quem viu a data e não pagou (24 horas depois, uma vez só)
//   3. os pedidos de avaliação de 2 e de 30 dias
// ?simular=1 só conta, sem mandar. Há um limite por dia para não estourar o plano grátis do Resend
// (100 e-mails por dia, contando os planos e as datas grátis do dia).
import { json, erro, agora, autorizado, negado, garantirTabelas, enviarPedidoAvaliacao, cobrancaAtiva, enviarDataGratis, enviarMes, diaBrasil, enviarCompletar } from '../../../lib/api.js';

const POR_DIA = 25;        // avaliações
const MENSAL_POR_DIA = 40;
const PAGTO_POR_DIA = 15;

export async function onRequestPost({ request, env }) {
  if (!autorizado(request, env)) return negado(env);
  if (!env.DB) return erro('Banco de dados não configurado.', 503);
  await garantirTabelas(env.DB);
  const url = new URL(request.url);
  const simular = url.searchParams.get('simular') === '1';
  const origem = url.origin;
  const dia = 864e5, t = Date.now();
  const base = "SELECT id, nome, email FROM respostas WHERE status = 'plano_enviado' AND teste = 0 AND sem_emails = 0 AND email IS NOT NULL";
  // 2 dias: só para quem ainda não avaliou (nem pelo link do PDF)
  const { results: d2 } = await env.DB.prepare(base + ` AND aval_2d_em IS NULL AND plano_enviado_em <= ? AND plano_enviado_em >= ?
      AND NOT EXISTS (SELECT 1 FROM avaliacoes a WHERE a.resposta_id = respostas.id) ORDER BY plano_enviado_em LIMIT ?`)
    .bind(new Date(t - 2 * dia).toISOString(), new Date(t - 20 * dia).toISOString(), POR_DIA).all();
  // 30 dias: para todos (o que interessa é o que mudou na vida, não a opinião sobre o PDF)
  const { results: d30 } = await env.DB.prepare(base + ` AND aval_30d_em IS NULL AND plano_enviado_em <= ? AND plano_enviado_em >= ?
      AND NOT EXISTS (SELECT 1 FROM avaliacoes a WHERE a.resposta_id = respostas.id AND a.momento = '30d') ORDER BY plano_enviado_em LIMIT ?`)
    .bind(new Date(t - 30 * dia).toISOString(), new Date(t - 80 * dia).toISOString(), POR_DIA).all();
  // lembrete de pagamento
  let pagto = [];
  if (cobrancaAtiva(env)) {
    pagto = (await env.DB.prepare(`SELECT id, nome, email, protocolo, status, plano_resumo, estimativa FROM respostas WHERE status IN ('plano_pronto', 'rapido') AND pago_em IS NULL AND teste = 0 AND sem_emails = 0
      AND aviso_data_em IS NOT NULL AND aviso_data_em <= ? AND aviso_data_em >= ? AND lembrete_pagto_em IS NULL ORDER BY aviso_data_em LIMIT ?`)
      .bind(new Date(t - dia).toISOString(), new Date(t - 7 * dia).toISOString(), PAGTO_POR_DIA).all()).results;
  }
  // pagou a versão rápida e não completou as respostas: lembra uma vez, 2 dias depois
  let completar = [];
  {  // vale para quem pagou e para quem entrou por link de teste grátis
    completar = (await env.DB.prepare(`SELECT id, nome, email, pag_status FROM respostas WHERE status = 'rapido' AND pago_em IS NOT NULL AND devolvido_em IS NULL AND teste = 0
      AND pago_em <= ? AND completar_lembrete_em IS NULL LIMIT ?`).bind(new Date(t - 2 * dia).toISOString(), PAGTO_POR_DIA).all()).results;
  }
  // e-mail do mês
  const hoje = diaBrasil(t), diaMes = Number(hoje.slice(8, 10)), mesAtual = hoje.slice(0, 7);
  let mensal = [];
  if (diaMes >= 3) {
    mensal = (await env.DB.prepare('SELECT * FROM acompanhamento WHERE dia_envio <= ? AND (ultimo_mes IS NULL OR ultimo_mes < ?) LIMIT ?')
      .bind(diaMes, mesAtual, MENSAL_POR_DIA).all()).results;
  }
  if (simular) return json({ ok: true, simulado: true, dois_dias: d2.length, trinta_dias: d30.length, pagamento: pagto.length, completar: completar.length, mensal: mensal.length });

  let mensais = 0, pagtos = 0;
  for (const a of mensal) {
    let meses = [];
    try { meses = JSON.parse(a.meses); } catch {}
    const chave = (m) => `${m.mes[0]}-${String(m.mes[1]).padStart(2, '0')}`;
    const este = meses.find((m) => chave(m) === mesAtual);
    if (!este) {
      // o plano já acabou: apaga (não guardamos nada além do necessário)
      if (!meses.length || chave(meses[meses.length - 1]) < mesAtual) await env.DB.prepare('DELETE FROM acompanhamento WHERE resposta_id = ?').bind(a.resposta_id).run();
      else await env.DB.prepare('UPDATE acompanhamento SET ultimo_mes = ? WHERE resposta_id = ?').bind(mesAtual, a.resposta_id).run();  // ainda não começou
      continue;
    }
    if (await enviarMes(env, a, este, origem)) { mensais++; await env.DB.prepare('UPDATE acompanhamento SET ultimo_mes = ? WHERE resposta_id = ?').bind(mesAtual, a.resposta_id).run(); }
  }
  let completares = 0;
  for (const l of completar) {
    if (await enviarCompletar(env, l, origem, true)) { completares++; await env.DB.prepare('UPDATE respostas SET completar_lembrete_em = ? WHERE id = ?').bind(agora(), l.id).run(); }
  }
  for (const l of pagto) {
    if (await enviarDataGratis(env, l, origem, true)) { pagtos++; await env.DB.prepare('UPDATE respostas SET lembrete_pagto_em = ? WHERE id = ?').bind(agora(), l.id).run(); }
  }

  let enviados = 0, falhas = 0;
  for (const [lista, m, col] of [[d30, '30d', 'aval_30d_em'], [d2, '2d', 'aval_2d_em']]) {
    for (const l of lista) {
      if (enviados >= POR_DIA) break;
      const ok = await enviarPedidoAvaliacao(env, l, m, origem);
      if (ok) { enviados++; await env.DB.prepare(`UPDATE respostas SET ${col} = ? WHERE id = ?`).bind(agora(), l.id).run(); }
      else falhas++;
    }
  }
  return json({ ok: true, enviados, falhas, mensais, lembretes_pagamento: pagtos, lembretes_completar: completares });
}
