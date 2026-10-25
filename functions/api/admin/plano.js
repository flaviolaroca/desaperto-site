// O gerador de planos (GitHub) usa estas rotas, com a chave ADMIN_TOKEN.
// PUT  /api/admin/plano?id=...  corpo: o PDF          -> guarda o arquivo (apagado sozinho em 90 dias)
// POST /api/admin/plano?id=...  { resumo } ou { erro } -> marca o plano como pronto ou com erro
// GET  /api/admin/plano?id=...                         -> devolve o PDF (para ver na área interna)
import { json, erro, agora, autorizado, negado, enviarPlano, enviarEmail, DIAS_GUARDADOS, garantirTabelas, cobrancaAtiva, liberarPlano,
  enviarDataGratis, evento } from '../../../lib/api.js';

const PDF_MAXIMO = 8_000_000;

export async function onRequest({ request, env }) {
  if (!autorizado(request, env)) return negado(env);
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
    await garantirTabelas(env.DB);
    if (!linha.teste) await evento(env.DB, 'plano_pronto');
    // Com cobrança: se já pagou, libera o plano; se não, manda a data grátis com o link para pagar.
    if (cobrancaAtiva(env)) {
      const l = await env.DB.prepare('SELECT id, nome, email, protocolo, plano_resumo, pago_em, aviso_data_em, teste FROM respostas WHERE id = ?').bind(id).first();
      if (l.pago_em) return json({ ok: true, liberado: await liberarPlano(env, id, url.origin) });
      if (corpo.resumo.dados_graves) {
        await enviarEmail(env, { para: env.EMAIL_AVISO, assunto: `Conferir respostas antes da data: ${(l.nome || '').split(' ')[0]} · ${l.protocolo}`,
          texto: `As respostas têm dados que não batem. A pessoa vê "estamos conferindo" e espera um e-mail seu em até 24 horas:\n\n${(corpo.resumo.alertas || []).map((a) => '- ' + a.texto).join('\n')}\n\nVeja em ${url.origin}/admin` });
        return json({ ok: true, revisao: true });
      }
      if (!l.aviso_data_em && !l.teste) {
        if (await enviarDataGratis(env, l, url.origin)) await env.DB.prepare('UPDATE respostas SET aviso_data_em = ? WHERE id = ?').bind(agora(), id).run();
      }
      return json({ ok: true, aguardando_pagamento: true });
    }
    // Envio direto, a menos que ENVIO_AUTOMATICO = nao. Plano que pede revisão fica parado e avisa o Flávio.
    if (env.ENVIO_AUTOMATICO !== 'nao' && !corpo.resumo.precisa_revisao) {
      const r = await enviarPlano(env, id, url.origin);
      if (r.ok) return json({ ok: true, enviado: true });
      await enviarEmail(env, { para: env.EMAIL_AVISO, assunto: `Plano não foi enviado: ${id.slice(0, 8)}`, texto: `O envio automático falhou: ${r.erro}\nVeja em ${url.origin}/admin` });
      return json({ ok: true, enviado: false, erro_envio: r.erro });
    }
    const l = await env.DB.prepare('SELECT nome, protocolo FROM respostas WHERE id = ?').bind(id).first();
    await enviarEmail(env, {
      para: env.EMAIL_AVISO,
      assunto: `Revisar plano: ${(l && l.nome || '').split(' ')[0]} · ${l && l.protocolo}`,
      texto: `Um plano ficou pronto, mas tem aviso que pede revisão antes de enviar:\n\n${(corpo.resumo.alertas || []).map((a) => '- ' + a.texto).join('\n') || '- A conta não fecha.'}\n\nConfira e envie em ${url.origin}/admin`,
    });
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
