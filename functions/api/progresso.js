// GET /api/progresso?id=&a= -> em que mês do plano a pessoa está (para o cartão do story). Link nos e-mails do plano e do mês.
import { json, erro, assinaturaAcomp, garantirTabelas, diaBrasil } from '../../lib/api.js';

const M = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const id = u.searchParams.get('id') || '', a = u.searchParams.get('a') || '';
  if (!env.DB || !env.ADMIN_TOKEN || !id || a !== (await assinaturaAcomp(env, id))) return erro('Este link não é válido.', 404);
  await garantirTabelas(env.DB);
  let meses = null, nome = '';
  const ac = await env.DB.prepare('SELECT meses, primeiro_nome FROM acompanhamento WHERE resposta_id = ?').bind(id).first();
  if (ac) { meses = JSON.parse(ac.meses); nome = ac.primeiro_nome; }
  else {
    const l = await env.DB.prepare('SELECT nome, plano_resumo FROM respostas WHERE id = ?').bind(id).first();
    if (l && l.plano_resumo) { meses = JSON.parse(l.plano_resumo).acoes_mensais || null; nome = (l.nome || '').trim().split(/\s+/)[0]; }
  }
  if (!meses || !meses.length) return erro('Não encontramos o seu plano. As respostas podem ter sido apagadas.', 404);
  const hoje = diaBrasil().slice(0, 7);
  const chave = (m) => `${m.mes[0]}-${String(m.mes[1]).padStart(2, '0')}`;
  let feitos = meses.filter((m) => chave(m) < hoje).length;   // meses que já passaram
  const atual = meses.find((m) => chave(m) === hoje) || (feitos ? meses[feitos - 1] : meses[0]);
  const ult = meses[meses.length - 1];
  const pagas = feitos ? (meses[feitos - 1].pagas || 0) : 0;
  return json({ ok: true, primeiro_nome: nome, total: meses.length, feitos, pagas, dividas: atual.total || 0,
    fim_txt: `${M[ult.mes[1] - 1]}/${String(ult.mes[0]).slice(2)}` });
}
