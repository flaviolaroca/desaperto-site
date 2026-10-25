// POST /api/admin/lembretes -> manda os pedidos de avaliação de 2 e de 30 dias que estão vencidos.
// Chamado uma vez por dia pelo GitHub (.github/workflows/lembretes.yml). ?simular=1 só conta, sem mandar.
// Limite por dia para não estourar o plano grátis do Resend (100 e-mails por dia, contando os planos).
import { json, erro, agora, autorizado, negado, garantirTabelas, enviarPedidoAvaliacao } from '../../../lib/api.js';

const POR_DIA = 40;

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
  if (simular) return json({ ok: true, simulado: true, dois_dias: d2.length, trinta_dias: d30.length });

  let enviados = 0, falhas = 0;
  for (const [lista, m, col] of [[d30, '30d', 'aval_30d_em'], [d2, '2d', 'aval_2d_em']]) {
    for (const l of lista) {
      if (enviados >= POR_DIA) break;
      const ok = await enviarPedidoAvaliacao(env, l, m, origem);
      if (ok) { enviados++; await env.DB.prepare(`UPDATE respostas SET ${col} = ? WHERE id = ?`).bind(agora(), l.id).run(); }
      else falhas++;
    }
  }
  return json({ ok: true, enviados, falhas });
}
