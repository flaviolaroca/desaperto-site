// O gerador de planos (GitHub) usa estas rotas, com a chave ADMIN_TOKEN.
// PUT  /api/admin/plano?id=...  corpo: o PDF          -> guarda o arquivo (apagado sozinho em 90 dias)
// POST /api/admin/plano?id=...  { resumo } ou { erro } -> marca o plano como pronto ou com erro
// GET  /api/admin/plano?id=...                         -> devolve o PDF (para ver na área interna)
import { json, erro, agora, autorizado, enviarPlano, DIAS_GUARDADOS } from '../../../lib/api.js';

const PDF_MAXIMO = 8_000_000;

export async function onRequest({ request, env }) {
  if (!autorizado(request, env)) return erro('Acesso negado.', 401);
  if (!env.DB) return erro('Banco de dados não configurado.', 503);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return erro('Falta o id.');
  const linha = await env.DB.prepare('SELECT id, teste FROM respostas WHERE id = ?').bind(id).first();
  if (!linha) return erro('Resposta não encontrada.', 404);

  if (request.method === 'PUT') {
    if (!env.PLANOS) return erro('Armazenamento de planos não configurado (falta a ligação PLANOS).', 503);
    const tamanho = Number(request.headers.get('content-length') || 0);
    if (!tamanho || tamanho > PDF_MAXIMO) return erro('Arquivo vazio ou grande demais.', 413);
    await env.PLANOS.put(id, request.body, { expirationTtl: DIAS_GUARDADOS * 86400, metadata: { criado_em: agora() } });
    return json({ ok: true });
  }

  if (request.method === 'POST') {
    let corpo;
    try { corpo = await request.json(); } catch { return erro('Corpo inválido.'); }
    if (corpo && typeof corpo.erro === 'string') {
      await env.DB.prepare("UPDATE respostas SET status = 'erro_plano', plano_erro = ? WHERE id = ?").bind(corpo.erro.slice(0, 2000), id).run();
      return json({ ok: true });
    }
    if (!corpo || typeof corpo.resumo !== 'object') return erro('Falta o resumo.');
    await env.DB.prepare("UPDATE respostas SET status = 'plano_pronto', plano_resumo = ?, plano_gerado_em = ?, plano_erro = NULL WHERE id = ?")
      .bind(JSON.stringify(corpo.resumo), agora(), id).run();
    // Envio direto só quando ligado de propósito e o plano não tem nada que peça revisão.
    if (env.ENVIO_AUTOMATICO === 'sim' && !corpo.resumo.precisa_revisao && !linha.teste) {
      const r = await enviarPlano(env, id, url.origin);
      return json({ ok: true, enviado: r.ok, erro_envio: r.erro });
    }
    return json({ ok: true, enviado: false });
  }

  if (request.method === 'GET') {
    if (!env.PLANOS) return erro('Armazenamento de planos não configurado.', 503);
    const pdf = await env.PLANOS.get(id, 'stream');
    if (!pdf) return erro('Plano não encontrado.', 404);
    return new Response(pdf, { headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store' } });
  }

  return erro('Método não permitido.', 405);
}
