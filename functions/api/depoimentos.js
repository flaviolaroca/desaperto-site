// GET /api/depoimentos -> avaliações aprovadas e autorizadas, para a página inicial. Sem e-mail, sem sobrenome.
import { json, garantirTabelas } from '../../lib/api.js';

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ ok: true, depoimentos: [] });
  await garantirTabelas(env.DB);
  const { results } = await env.DB.prepare(
    "SELECT texto_publicado, texto, nota, autoriza, primeiro_nome, cidade, contexto, momento, aprovado_em FROM avaliacoes WHERE status = 'aprovada' AND autoriza != 'nao' ORDER BY aprovado_em DESC LIMIT 12"
  ).all();
  const depoimentos = results.map((x) => ({
    texto: x.texto_publicado || x.texto,
    nota: x.nota,
    quem: [x.autoriza === 'primeiro_nome' ? x.primeiro_nome : 'Cliente', x.cidade].filter(Boolean).join(', '),
    contexto: x.contexto || '',
    depois_de_um_mes: x.momento === '30d',
  })).filter((x) => x.texto);
  return json({ ok: true, depoimentos }, 200, { 'cache-control': 'public, max-age=300' });
}
