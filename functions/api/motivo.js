// GET /api/motivo?id=&a=&m= -> a pessoa conta, com um toque no e-mail, por que não comprou o plano.
// Guarda o motivo na resposta dela e soma 1 em motivo_<m> (aparece nas métricas). Mostra uma resposta curta para cada motivo.
import { assinaturaPagar, garantirTabelas, evento, agora, linkPagar, precoDaLinha, reaisCentavos, MOTIVOS } from '../../lib/api.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function pagina(titulo, paragrafos, botao) {
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Desaperto</title>
<style>body{margin:0;background:#F3EFE6;color:#16211C;font-family:Arial,Helvetica,sans-serif;line-height:1.55}main{max-width:32rem;margin:0 auto;padding:44px 20px}h1{font-size:1.6rem;line-height:1.15;margin:.4em 0 .6em}a{color:#16704A}
.b{display:inline-block;margin:10px 0 6px;background:#16704A;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:999px}.p{font-size:.9rem;color:#5C625E}</style></head>
<body><main><p><b>desaperto</b></p><h1>${titulo}</h1>${paragrafos.map((p) => `<p>${p}</p>`).join('')}${botao ? `<p><a class="b" href="${esc(botao[1])}">${esc(botao[0])}</a></p>` : ''}
<p class="p">O Desaperto nunca pede senha, nunca manda boleto e nunca cobra para limpar nome. Dúvidas: contato@desaperto.com.</p></main></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const id = u.searchParams.get('id') || '', a = u.searchParams.get('a') || '', m = u.searchParams.get('m') || '';
  if (!env.DB || !env.ADMIN_TOKEN || !id || !MOTIVOS[m] || a !== (await assinaturaPagar(env, id))) {
    return pagina('Este link não funcionou.', ['Se quiser contar o que achou, é só responder o e-mail. A gente lê tudo.']);
  }
  await garantirTabelas(env.DB);
  const l = await env.DB.prepare('SELECT id, criado_em, promo_ate, pago_em, teste, motivo FROM respostas WHERE id = ?').bind(id).first();
  if (!l) return pagina('Este link não funcionou.', ['Se quiser contar o que achou, é só responder o e-mail.']);
  if (!l.motivo) await evento(env.DB, 'motivo_' + m);  // conta uma vez por pessoa
  await env.DB.prepare('UPDATE respostas SET motivo = ?, motivo_em = ? WHERE id = ?').bind(m, agora(), id).run();
  const link = await linkPagar(env, new URL(request.url).origin, id);
  const valor = reaisCentavos(precoDaLinha(env, l));
  const botao = l.pago_em ? null : [`Ver o meu plano por ${valor}`, link];
  const obrigado = 'Obrigado por contar. Isso ajuda muito.';
  if (m === 'caro') return pagina(obrigado, [`Por isso o plano está saindo por <b>${esc(valor)}</b> para quem já viu a data. É menos do que muita gente paga de juros numa semana.`, 'E tem garantia de 7 dias: se não ajudar, você pede e devolvemos o valor inteiro.'], botao);
  if (m === 'golpe') return pagina(obrigado, ['Faz sentido desconfiar. Por isso: o Desaperto não pede CPF nem senha de banco, e o único pagamento é o Pix gerado dentro do site, onde aparece quem recebe antes de você confirmar.', 'O plano chega no seu e-mail em poucos minutos. Se não ajudar, você tem 7 dias para pedir o dinheiro de volta.', 'Antes de decidir, veja <a href="/exemplo/plano-exemplo.pdf" target="_blank" rel="noopener">um plano de exemplo</a>, feito para uma pessoa fictícia.'], botao);
  if (m === 'entendi') return pagina(obrigado, ['O plano é um PDF feito com os seus números. Ele mostra:', '1. Qual dívida pagar primeiro e por quê.<br>2. Quanto pedir de desconto nos acordos e até onde aceitar.<br>3. O mês a mês: quanto pagar em cada dívida, até a última, e quando começa a sobrar dinheiro.', 'Veja <a href="/exemplo/plano-exemplo.pdf" target="_blank" rel="noopener">um plano de exemplo</a>, feito para uma pessoa fictícia.'], botao);
  if (m === 'precisa') return pagina(obrigado, ['Se as suas contas já estão organizadas, ótimo. Uma dica que vale para qualquer dívida: nunca aceite a primeira proposta de acordo. Pergunte o valor à vista, anote e peça um desconto maior.', 'Se mudar de ideia, o plano continua aqui.'], botao);
  return pagina(obrigado, ['Sem problema. O seu cálculo fica guardado e você pode voltar quando quiser.', 'Só lembrando: cada mês que passa sem a ordem certa, a dívida mais cara cresce mais rápido.'], botao);
}
