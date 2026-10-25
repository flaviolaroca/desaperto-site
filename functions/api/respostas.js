// POST /api/respostas  -> guarda as respostas do questionário e devolve um protocolo.
// PUT  /api/respostas  -> a própria pessoa corrige as respostas já enviadas (precisa do id e da chave).
import { json, erro, sha256, aleatorio, protocolo, agora, lerCorpo, validarRespostas, limparAntigas, enviarEmail, escapar, pedirPlano, LIMITE_POR_HORA,
  garantirTabelas, evento, cobrancaAtiva, assinaturaPagar, enviarDataGratis, limparCodigo, conviteValido, usarConvite, enviarCompletar } from '../../lib/api.js';

function rapido0(corpo, r) { return corpo.rapido === true && r.rapido === true && !corpo.teste; }

async function origem(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'sem-ip';
  return sha256(ip + '|' + (env.SAL_ORIGEM || 'desaperto'));
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return erro('O site ainda está sendo configurado. Tente de novo mais tarde.', 503);
  const { corpo, erro: e } = await lerCorpo(request);
  if (e) return erro(e, 413);
  const r = corpo && corpo.respostas;
  const problema = validarRespostas(r);
  if (problema) return erro(problema);

  const org = await origem(request, env);
  const umaHora = new Date(Date.now() - 3600e3).toISOString();
  const recentes = await env.DB.prepare('SELECT COUNT(*) AS n FROM respostas WHERE origem_hash = ? AND criado_em > ?').bind(org, umaHora).first();
  if (recentes && recentes.n >= LIMITE_POR_HORA) return erro('Muitos envios seguidos deste aparelho. Espere um pouco e tente de novo.', 429);

  // Link de teste grátis: confere antes de guardar, para avisar logo se já foi usado
  try { await garantirTabelas(env.DB); } catch {}
  const convite = rapido0(corpo, r) ? limparCodigo(corpo.convite) : '';
  if (convite && !(await conviteValido(env.DB, convite)))
    return erro('Este link de teste já foi usado ou foi desativado. Peça um link novo para quem te mandou.', 409);

  const id = crypto.randomUUID();
  const chave = aleatorio(24);
  const quando = agora();
  const teste = corpo.teste ? 1 : 0;
  const rapido = corpo.rapido === true && r.rapido === true;
  let estimativa = null;
  if (rapido) {
    if (!corpo.estimativa || typeof corpo.estimativa !== 'object') return erro('Falta a estimativa.');
    estimativa = JSON.stringify(corpo.estimativa);
    if (estimativa.length > 4000) return erro('Estimativa inválida.');
  }
  let prot = protocolo();
  for (let i = 0; i < 3; i++) {
    try {
      await env.DB.prepare(
        'INSERT INTO respostas (id, protocolo, chave_hash, criado_em, atualizado_em, nome, email, teste, origem_hash, dados) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(id, prot, await sha256(chave), quando, quando, r.nome.trim(), r.email.trim().toLowerCase(), teste, org, JSON.stringify(r)).run();
      break;
    } catch (err) {
      if (i === 2 || !String(err).includes('UNIQUE')) return erro('Não conseguimos guardar as respostas agora. Tente de novo em alguns minutos.', 500);
      prot = protocolo();
    }
  }
  try { await limparAntigas(env.DB); } catch {}
  try { await garantirTabelas(env.DB); } catch {}
  const pagar = `/pagar?id=${encodeURIComponent(id)}&a=${await assinaturaPagar(env, id)}`;
  if (rapido) {
    // Versão rápida: não roda o motor. A data aproximada já veio calculada; o plano exato vem depois das respostas completas.
    await env.DB.prepare("UPDATE respostas SET status = 'rapido', estimativa = ? WHERE id = ?").bind(estimativa, id).run();
    const primeiro = r.nome.trim().split(/\s+/)[0];
    if (convite) {
      // Teste grátis: fica como pago com valor zero e pula direto para completar as respostas.
      const usou = await usarConvite(env.DB, convite);
      if (usou) {
        await env.DB.prepare("UPDATE respostas SET pago_em = ?, pago_valor = 0, pag_status = 'convite', convite = ? WHERE id = ?").bind(agora(), convite, id).run();
        await evento(env.DB, 'convite_usou');
        await enviarEmail(env, { para: env.EMAIL_AVISO, assunto: `Teste grátis: ${primeiro} · ${prot}`, texto: `Alguém entrou pelo link de teste ${convite}.\nProtocolo: ${prot}\nDívidas: ${r.dividas.length}\nVeja em https://desaperto.com/admin` });
        await enviarCompletar(env, { id, nome: r.nome, email: r.email.trim(), pag_status: 'convite' }, new URL(request.url).origin);
        return json({ ok: true, id, chave, protocolo: prot, pagar }, 201);
      }
    }
    if (!teste) await evento(env.DB, 'rapido_enviou');
    await enviarEmail(env, { para: env.EMAIL_AVISO, assunto: `${teste ? '[teste] ' : ''}Data rápida: ${primeiro} · ${prot}`, texto: `Alguém fez a versão rápida.\nProtocolo: ${prot}\nDívidas: ${r.dividas.length}\nVeja em https://desaperto.com/admin` });
    if (!teste && cobrancaAtiva(env)) {
      const origemUrl = new URL(request.url).origin;
      const l = { id, nome: r.nome, email: r.email.trim(), status: 'rapido', estimativa };
      if (await enviarDataGratis(env, l, origemUrl)) await env.DB.prepare('UPDATE respostas SET aviso_data_em = ? WHERE id = ?').bind(agora(), id).run();
    }
    return json({ ok: true, id, chave, protocolo: prot, pagar }, 201);
  }
  if (!teste) await evento(env.DB, 'enviou');
  if (await pedirPlano(env, id)) {
    try { await env.DB.prepare("UPDATE respostas SET status = 'gerando' WHERE id = ?").bind(id).run(); } catch {}
  }

  // Avisos por e-mail: só se o envio estiver configurado. A falha aqui não impede o recebimento.
  const primeiroNome = r.nome.trim().split(/\s+/)[0];
  await enviarEmail(env, {
    para: env.EMAIL_AVISO,
    assunto: `${teste ? '[teste] ' : ''}Nova resposta: ${primeiroNome} · ${prot}`,
    texto: `Chegou uma resposta nova.\nProtocolo: ${prot}\nNome: ${r.nome}\nDívidas: ${r.dividas.length}\nVeja em https://desaperto.com/admin`,
  });
  if (!teste && !cobrancaAtiva(env)) {  // com cobrança, o primeiro e-mail é o da data grátis, quando o plano fica pronto
    await enviarEmail(env, {
      para: r.email.trim(),
      assunto: 'Recebemos suas respostas',
      texto: `${primeiroNome}, recebemos suas respostas.\n\nSeu plano de desaperto está sendo montado e chega neste e-mail em poucos minutos.\nProtocolo: ${prot}\n\nO Desaperto nunca pede senha, nunca manda boleto e nunca cobra para limpar nome.\n\nDesaperto · desaperto.com`,
      html: `<p>${escapar(primeiroNome)}, recebemos suas respostas.</p><p>Seu plano de desaperto está sendo montado e chega neste e-mail em poucos minutos.<br>Protocolo: <b>${prot}</b></p><p style="color:#555D58;font-size:13px">O Desaperto nunca pede senha, nunca manda boleto e nunca cobra para limpar nome.</p><p><b>desaperto</b> · desaperto.com</p>`,
    });
  }
  return json({ ok: true, id, chave, protocolo: prot, pagar }, 201);
}

export async function onRequestPut({ request, env }) {
  if (!env.DB) return erro('O site ainda está sendo configurado. Tente de novo mais tarde.', 503);
  const { corpo, erro: e } = await lerCorpo(request);
  if (e) return erro(e, 413);
  const { id, chave, a, respostas: r } = corpo || {};
  if (typeof id !== 'string' || (typeof chave !== 'string' && typeof a !== 'string')) return erro('Envio sem identificação.');
  const problema = validarRespostas(r);
  if (problema) return erro(problema);
  if (r.rapido) return erro('Faltam as respostas completas.');
  try { await garantirTabelas(env.DB); } catch {}
  const linha = await env.DB.prepare('SELECT chave_hash, protocolo, status, teste, pag_status FROM respostas WHERE id = ?').bind(id).first();
  const valido = linha && (typeof chave === 'string' ? linha.chave_hash === (await sha256(chave)) : a === (await assinaturaPagar(env, id)));
  if (!valido) return erro('Não encontramos esse envio. Envie de novo como novo.', 404);
  if (linha.status === 'rapido') {
    await env.DB.prepare('UPDATE respostas SET completado_em = ? WHERE id = ?').bind(agora(), id).run();
    if (!linha.teste) await evento(env.DB, linha.pag_status === 'convite' ? 'convite_completou' : 'completou');
  }
  await env.DB.prepare("UPDATE respostas SET dados = ?, nome = ?, email = ?, atualizado_em = ?, status = 'recebido', plano_resumo = NULL, plano_erro = NULL, aviso_data_em = NULL WHERE id = ?")
    .bind(JSON.stringify(r), r.nome.trim(), r.email.trim().toLowerCase(), agora(), id).run();
  if (await pedirPlano(env, id)) {
    try { await env.DB.prepare("UPDATE respostas SET status = 'gerando' WHERE id = ?").bind(id).run(); } catch {}
  }
  return json({ ok: true, id, protocolo: linha.protocolo, pagar: `/pagar?id=${encodeURIComponent(id)}&a=${await assinaturaPagar(env, id)}` });
}

export async function onRequest() {
  return erro('Método não permitido.', 405);
}
