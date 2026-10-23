// POST /api/respostas  -> guarda as respostas do questionário e devolve um protocolo.
// PUT  /api/respostas  -> a própria pessoa corrige as respostas já enviadas (precisa do id e da chave).
import { json, erro, sha256, aleatorio, protocolo, agora, lerCorpo, validarRespostas, limparAntigas, enviarEmail, escapar, LIMITE_POR_HORA } from '../../lib/api.js';

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

  const id = crypto.randomUUID();
  const chave = aleatorio(24);
  const quando = agora();
  const teste = corpo.teste ? 1 : 0;
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

  // Avisos por e-mail: só se o envio estiver configurado. A falha aqui não impede o recebimento.
  const primeiroNome = r.nome.trim().split(/\s+/)[0];
  await enviarEmail(env, {
    para: env.EMAIL_AVISO,
    assunto: `${teste ? '[teste] ' : ''}Nova resposta: ${primeiroNome} · ${prot}`,
    texto: `Chegou uma resposta nova.\nProtocolo: ${prot}\nNome: ${r.nome}\nDívidas: ${r.dividas.length}\nVeja em https://desaperto.com/admin`,
  });
  if (!teste) {
    await enviarEmail(env, {
      para: r.email.trim(),
      assunto: 'Recebemos suas respostas',
      texto: `${primeiroNome}, recebemos suas respostas.\n\nSeu plano de desaperto chega neste e-mail em até 3 dias úteis.\nProtocolo: ${prot}\n\nO Desaperto nunca pede senha, nunca manda boleto e nunca cobra para limpar nome.\n\nDesaperto · desaperto.com`,
      html: `<p>${escapar(primeiroNome)}, recebemos suas respostas.</p><p>Seu plano de desaperto chega neste e-mail em até 3 dias úteis.<br>Protocolo: <b>${prot}</b></p><p style="color:#555D58;font-size:13px">O Desaperto nunca pede senha, nunca manda boleto e nunca cobra para limpar nome.</p><p><b>desaperto</b> · desaperto.com</p>`,
    });
  }
  return json({ ok: true, id, chave, protocolo: prot }, 201);
}

export async function onRequestPut({ request, env }) {
  if (!env.DB) return erro('O site ainda está sendo configurado. Tente de novo mais tarde.', 503);
  const { corpo, erro: e } = await lerCorpo(request);
  if (e) return erro(e, 413);
  const { id, chave, respostas: r } = corpo || {};
  if (typeof id !== 'string' || typeof chave !== 'string') return erro('Envio sem identificação.');
  const problema = validarRespostas(r);
  if (problema) return erro(problema);
  const linha = await env.DB.prepare('SELECT chave_hash, protocolo FROM respostas WHERE id = ?').bind(id).first();
  if (!linha || linha.chave_hash !== (await sha256(chave))) return erro('Não encontramos esse envio. Envie de novo como novo.', 404);
  await env.DB.prepare("UPDATE respostas SET dados = ?, nome = ?, email = ?, atualizado_em = ?, status = 'recebido' WHERE id = ?")
    .bind(JSON.stringify(r), r.nome.trim(), r.email.trim().toLowerCase(), agora(), id).run();
  return json({ ok: true, id, protocolo: linha.protocolo });
}

export async function onRequest() {
  return erro('Método não permitido.', 405);
}
