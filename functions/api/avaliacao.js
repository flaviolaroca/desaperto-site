// Página /avaliar, por link assinado.
// GET  /api/avaliacao?id=&a=&m=   -> primeiro nome e o que a pessoa já respondeu neste momento
// POST /api/avaliacao             -> { id, a, m, nota, acao, texto, autoriza, cidade } grava (ou atualiza)
// POST /api/avaliacao             -> { id, a, parar: true } para de mandar os e-mails de avaliação
import { json, erro, agora, aleatorio, assinaturaAval, garantirTabelas, contextoDepoimento, enviarEmail, escapar } from '../../lib/api.js';

const MOMENTOS = ['plano', '2d', '30d'];
const ACOES = ['sim', 'ainda_nao', 'nao_vou'];
const AUTORIZA = ['nao', 'primeiro_nome', 'anonimo'];

async function conferir(env, id, a) {
  if (!env.DB || !env.ADMIN_TOKEN || typeof id !== 'string' || typeof a !== 'string' || !id) return null;
  if (a !== (await assinaturaAval(env, id))) return null;
  return env.DB.prepare('SELECT id, protocolo, nome, email, dados, plano_resumo FROM respostas WHERE id = ?').bind(id).first();
}

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const id = u.searchParams.get('id') || '', a = u.searchParams.get('a') || '';
  const m = MOMENTOS.includes(u.searchParams.get('m')) ? u.searchParams.get('m') : 'plano';
  await garantirTabelas(env.DB);
  const l = await conferir(env, id, a);
  if (!l) return erro('Este link não é válido ou o plano já foi apagado (as respostas ficam guardadas por 90 dias).', 404);
  const ja = await env.DB.prepare('SELECT nota, acao, texto, autoriza, cidade FROM avaliacoes WHERE resposta_id = ? AND momento = ?').bind(id, m).first();
  return json({ ok: true, primeiro_nome: (l.nome || '').trim().split(/\s+/)[0] || '', momento: m, ja: ja || null });
}

export async function onRequestPost({ request, env }) {
  let c;
  try { c = await request.json(); } catch { return erro('Não foi possível ler a avaliação.'); }
  await garantirTabelas(env.DB);
  const l = await conferir(env, c && c.id, c && c.a);
  if (!l) return erro('Este link não é válido ou o plano já foi apagado.', 404);

  if (c.parar === true) {
    await env.DB.prepare('UPDATE respostas SET sem_emails = 1 WHERE id = ?').bind(l.id).run();
    return json({ ok: true });
  }

  const m = MOMENTOS.includes(c.m) ? c.m : 'plano';
  const nota = Number.isInteger(c.nota) && c.nota >= 1 && c.nota <= 5 ? c.nota : null;
  const acao = ACOES.includes(c.acao) ? c.acao : null;
  const texto = typeof c.texto === 'string' ? c.texto.trim().slice(0, 1500) : '';
  const autoriza = AUTORIZA.includes(c.autoriza) ? c.autoriza : 'nao';
  const cidade = typeof c.cidade === 'string' ? c.cidade.trim().slice(0, 60) : '';
  if (!nota && !texto) return erro('Escolha uma nota ou escreva alguma coisa.');
  const primeiro = (l.nome || '').trim().split(/\s+/)[0].slice(0, 40) || '';
  const t = agora();
  // Se a pessoa mudar a resposta, volta para "nova": você aprova de novo o que vai para o site.
  await env.DB.prepare(`INSERT INTO avaliacoes (id, resposta_id, protocolo, momento, criado_em, atualizado_em, nota, acao, texto, autoriza, primeiro_nome, cidade, contexto, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'nova')
    ON CONFLICT (resposta_id, momento) DO UPDATE SET atualizado_em = excluded.atualizado_em, nota = excluded.nota, acao = excluded.acao, texto = excluded.texto,
      autoriza = excluded.autoriza, cidade = excluded.cidade, status = 'nova', texto_publicado = NULL, aprovado_em = NULL`)
    .bind(aleatorio(12), l.id, l.protocolo, m, t, t, nota, acao, texto, autoriza, primeiro, cidade, contextoDepoimento(l)).run();

  if (env.EMAIL_AVISO) {
    const estrelas = nota ? '★'.repeat(nota) + '☆'.repeat(5 - nota) : 'sem nota';
    await enviarEmail(env, {
      para: env.EMAIL_AVISO, assunto: `Nova avaliação ${l.protocolo}: ${estrelas}`,
      texto: `${estrelas}\nPrimeira ação: ${acao || '-'}\nPublicar: ${autoriza}\n\n${texto || '(sem texto)'}\n\nAprovar em ${new URL(request.url).origin}/admin`,
      html: `<p><b>${estrelas}</b> · primeira ação: ${escapar(acao || '-')} · publicar: ${escapar(autoriza)}</p><p>${escapar(texto || '(sem texto)')}</p><p><a href="${new URL(request.url).origin}/admin">Abrir a área interna</a></p>`,
    });
  }
  return json({ ok: true });
}
