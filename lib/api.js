// Funções comuns às rotas da API.

export const DIAS_GUARDADOS = 90;
export const LIMITE_POR_HORA = 12;      // envios por origem por hora
export const TAMANHO_MAXIMO = 300_000;  // bytes do corpo da requisição

export function json(dados, status = 200, extra = {}) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

export function erro(mensagem, status = 400) {
  return json({ ok: false, erro: mensagem }, status);
}

export async function sha256(texto) {
  const dados = new TextEncoder().encode(texto);
  const h = await crypto.subtle.digest('SHA-256', dados);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function aleatorio(bytes = 24) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Protocolo curto, sem letras que se confundem (0/O, 1/I/L).
export function protocolo() {
  const letras = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const a = crypto.getRandomValues(new Uint8Array(8));
  let s = '';
  for (const b of a) s += letras[b % letras.length];
  return s.slice(0, 4) + '-' + s.slice(4);
}

export function agora() {
  return new Date().toISOString();
}

export async function lerCorpo(request) {
  const tamanho = Number(request.headers.get('content-length') || 0);
  if (tamanho > TAMANHO_MAXIMO) return { erro: 'As respostas ficaram grandes demais para enviar.' };
  const texto = await request.text();
  if (texto.length > TAMANHO_MAXIMO) return { erro: 'As respostas ficaram grandes demais para enviar.' };
  try {
    return { corpo: JSON.parse(texto) };
  } catch {
    return { erro: 'Não foi possível ler as respostas enviadas.' };
  }
}

// Confere o mínimo para o plano poder ser montado. O resto o motor confere depois.
export function validarRespostas(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'Respostas em formato inválido.';
  if (r.consent !== true) return 'Falta a concordância com o uso das respostas.';
  if (typeof r.nome !== 'string' || !r.nome.trim() || r.nome.length > 120) return 'Confira o seu nome.';
  if (typeof r.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r.email) || r.email.length > 200) return 'Confira o seu e-mail.';
  if (!Array.isArray(r.dividas) || r.dividas.length === 0 || r.dividas.length > 60) return 'Adicione pelo menos uma dívida.';
  if (typeof r.renda !== 'number' || !(r.renda >= 0)) return 'Confira a sua renda.';
  return null;
}

// Apaga o que passou do prazo prometido na política de privacidade.
// Avaliações: as que a pessoa não autorizou publicar somem no mesmo prazo. As autorizadas ficam (a política diz isso).
export async function limparAntigas(db) {
  const limite = new Date(Date.now() - DIAS_GUARDADOS * 864e5).toISOString();
  await db.prepare('DELETE FROM respostas WHERE criado_em < ?').bind(limite).run();
  try { await db.prepare("DELETE FROM avaliacoes WHERE criado_em < ? AND (autoriza = 'nao' OR status = 'recusada')").bind(limite).run(); } catch {}
}

// Cria a tabela de avaliações e as colunas novas na primeira vez (sem precisar rodar nada no console do D1).
let tabelasOk = false;
export async function garantirTabelas(db) {
  if (tabelasOk) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS avaliacoes (
    id TEXT PRIMARY KEY, resposta_id TEXT NOT NULL, protocolo TEXT, momento TEXT NOT NULL,
    criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL,
    nota INTEGER, acao TEXT, texto TEXT, autoriza TEXT NOT NULL DEFAULT 'nao',
    primeiro_nome TEXT, cidade TEXT, contexto TEXT,
    status TEXT NOT NULL DEFAULT 'nova', texto_publicado TEXT, aprovado_em TEXT,
    UNIQUE (resposta_id, momento))`).run();
  await db.prepare('CREATE TABLE IF NOT EXISTS eventos (dia TEXT NOT NULL, evento TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (dia, evento))').run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS acompanhamento (
    resposta_id TEXT PRIMARY KEY, primeiro_nome TEXT, email TEXT NOT NULL, objetivo TEXT, meses TEXT NOT NULL,
    dia_envio INTEGER NOT NULL, ultimo_mes TEXT, criado_em TEXT NOT NULL)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS convites (
    codigo TEXT PRIMARY KEY, para TEXT, usos_max INTEGER NOT NULL DEFAULT 1, usos INTEGER NOT NULL DEFAULT 0,
    ativo INTEGER NOT NULL DEFAULT 1, criado_em TEXT NOT NULL)`).run();
  await db.prepare('CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT)').run();
  for (const col of ['origem TEXT', 'convite TEXT', 'aval_2d_em TEXT', 'aval_30d_em TEXT', 'sem_emails INTEGER NOT NULL DEFAULT 0',
    'pag_id TEXT', 'pag_status TEXT', 'pag_qr TEXT', 'pag_qr_img TEXT', 'pag_expira TEXT', 'pago_em TEXT', 'pago_valor REAL',
    'devolvido_em TEXT', 'aviso_data_em TEXT', 'lembrete_pagto_em TEXT', 'estimativa TEXT', 'completado_em TEXT', 'completar_lembrete_em TEXT']) {
    try { await db.prepare(`ALTER TABLE respostas ADD COLUMN ${col}`).run(); } catch {}  // já existe
  }
  tabelasOk = true;
}

// Link assinado da página de avaliação (só quem recebeu o plano consegue avaliar).
export async function assinaturaAval(env, id) {
  return (await sha256(`avaliar|${id}|${(env.ADMIN_TOKEN || '').trim()}`)).slice(0, 32);
}
export async function linkAvaliar(env, origem, id, momento) {
  return `${origem}/avaliar?id=${encodeURIComponent(id)}&m=${momento}&a=${await assinaturaAval(env, id)}`;
}

// "3 dívidas · sai em mai/28": vai junto do depoimento, sem nada que identifique a pessoa.
export function contextoDepoimento(l) {
  const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  let n = 0, saida = '';
  try { n = (JSON.parse(l.dados).dividas || []).length; } catch {}
  try { const p = JSON.parse(l.plano_resumo || '{}'); if (p.repactuacao) saida = 'renegociação pela lei'; else if (p.saida) saida = `sai das dívidas em ${MES[p.saida[1] - 1]}/${String(p.saida[0]).slice(2)}`; } catch {}
  return [n ? `${n} ${n === 1 ? 'dívida' : 'dívidas'}` : '', saida].filter(Boolean).join(' · ');
}

// E-mails de 2 e 30 dias depois do plano.
export async function enviarPedidoAvaliacao(env, l, momento, origem) {
  const primeiro = (l.nome || '').trim().split(/\s+/)[0] || 'Olá';
  const link = await linkAvaliar(env, origem, l.id, momento);
  const parar = link + '&parar=1';
  const c = momento === '30d' ? {
    assunto: 'Um mês de plano: o que mudou?',
    abre: `${primeiro}, faz um mês que o seu plano de desaperto chegou.`,
    corpo: 'Conta para a gente o que mudou desde então. Pode ser pouco: uma ligação feita, uma parcela adiantada, um mês sem cheque especial. Leva 2 minutos e ajuda a melhorar o plano de quem vem depois.',
    botao: 'Contar o que mudou',
  } : {
    assunto: 'O seu plano ficou claro?',
    abre: `${primeiro}, o seu plano de desaperto chegou há dois dias.`,
    corpo: 'Duas perguntas rápidas: ele ficou claro? Você já conseguiu fazer a primeira ação? Leva 1 minuto. Se alguma coisa travou, responda este e-mail que a gente ajuda.',
    botao: 'Responder em 1 minuto',
  };
  const texto = `${c.abre}\n\n${c.corpo}\n\n${c.botao}: ${link}\n\nNão quer mais receber estes e-mails? ${parar}\n\nDesaperto · desaperto.com`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#16211C;max-width:520px">
<p style="margin:0 0 14px"><b>${escapar(c.abre)}</b></p>
<p style="margin:0 0 20px">${escapar(c.corpo)}</p>
<p style="margin:0 0 22px"><a href="${escapar(link)}" style="display:inline-block;background:#16704A;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:999px">${escapar(c.botao)}</a></p>
<p style="margin:18px 0 0;color:#555D58;font-size:13px">Não quer mais receber estes e-mails? <a href="${escapar(parar)}" style="color:#555D58">Clique aqui</a>.</p>
<p style="margin:14px 0 0;font-weight:800;letter-spacing:-0.02em">desaperto</p></div>`;
  return enviarEmail(env, { para: l.email, assunto: c.assunto, texto, html });
}

// Aviso por e-mail (opcional). Só funciona se RESEND_API_KEY estiver configurada.
export async function enviarEmail(env, { para, assunto, texto, html, anexos }) {
  if (!env.RESEND_API_KEY || !para) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_REMETENTE || 'Desaperto <contato@desaperto.com>',
        reply_to: env.EMAIL_RESPOSTA || 'contato@desaperto.com',
        to: [para], subject: assunto, text: texto, html, attachments: anexos,
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// Área interna: confere a chave ADMIN_TOKEN (comparação em tempo constante, sem espaços nas pontas).
export const TAMANHO_MINIMO_CHAVE = 12;
export function autorizado(request, env) {
  const t = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const certa = (env.ADMIN_TOKEN || '').trim();
  if (certa.length < TAMANHO_MINIMO_CHAVE) return false;
  if (t.length !== certa.length) return false;
  let dif = 0;
  for (let i = 0; i < t.length; i++) dif |= t.charCodeAt(i) ^ certa.charCodeAt(i);
  return dif === 0;
}

// Explica por que o acesso foi negado sem revelar a senha (só se ela existe e se tem o tamanho mínimo).
export function negado(env) {
  const certa = (env.ADMIN_TOKEN || '').trim();
  if (!certa) return erro('A senha ADMIN_TOKEN não está salva na Cloudflare. Salve em Configurações → Variáveis e segredos e publique de novo.', 401);
  if (certa.length < TAMANHO_MINIMO_CHAVE) return erro(`A senha salva na Cloudflare tem só ${certa.length} caracteres. Use uma com pelo menos ${TAMANHO_MINIMO_CHAVE}.`, 401);
  return erro('Acesso negado.', 401);
}

// Pede ao GitHub para gerar o plano dessa resposta (workflow gerar-plano). Sem GITHUB_TOKEN, não faz nada.
export async function pedirPlano(env, id) {
  if (!env.GITHUB_TOKEN) return false;
  try {
    const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO || 'flaviolaroca/desaperto-site'}/dispatches`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'desaperto-site', 'content-type': 'application/json' },
      body: JSON.stringify({ event_type: 'gerar-plano', client_payload: { id } }),
    });
    return r.status === 204;
  } catch {
    return false;
  }
}

// Link assinado para o arquivo do plano (o Resend busca o PDF por ele para anexar).
export async function assinatura(env, id) {
  return (await sha256(`plano|${id}|${(env.ADMIN_TOKEN || '').trim()}`)).slice(0, 40);
}

export const STATUS = ['rapido', 'recebido', 'gerando', 'plano_pronto', 'erro_plano', 'plano_enviado'];

export function escapar(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Envia o plano por e-mail, com o PDF anexo. O Resend busca o arquivo pelo link assinado.
export async function enviarPlano(env, id, origem) {
  try { await garantirTabelas(env.DB); } catch {}
  const l = await env.DB.prepare('SELECT id, nome, email, protocolo, status, plano_resumo, dados, pago_em, pago_valor, pag_status FROM respostas WHERE id = ?').bind(id).first();
  if (!l) return { ok: false, erro: 'Resposta não encontrada.' };
  if (!env.PLANOS || !(await env.PLANOS.get(id, 'stream'))) return { ok: false, erro: 'O PDF do plano não foi encontrado. Gere de novo.' };
  if (!env.RESEND_API_KEY) return { ok: false, erro: 'O envio de e-mails ainda não está configurado (falta RESEND_API_KEY).' };
  const primeiro = (l.nome || '').trim().split(/\s+/)[0] || 'Olá';
  const resumo = l.plano_resumo ? JSON.parse(l.plano_resumo) : {};
  const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const saida = resumo.saida && !resumo.repactuacao ? `${meses[resumo.saida[1] - 1]} de ${resumo.saida[0]}` : null;
  const frase = resumo.repactuacao
    ? 'O plano mostra como renegociar todas as dívidas juntas, com a proposta e os papéis prontos para levar.'
    : saida ? `Pelas suas respostas, você sai das dívidas em ${saida}.` : 'O plano mostra a ordem certa de pagar e o que fazer em cada mês.';
  const link = `${origem}/api/arquivo/plano?id=${encodeURIComponent(id)}&a=${await assinatura(env, id)}`;
  let acomp = false;
  try { acomp = await criarAcompanhamento(env, l); } catch {}
  const garantia = l.pago_em && !ehConvite(l) ? `Pagamento confirmado: ${reaisCentavos(l.pago_valor || preco(env))}. Se o plano não te ajudar, responda este e-mail em até 7 dias e devolvemos o valor.` : '';
  const acompTxt = acomp ? 'No começo de cada mês, você recebe um e-mail com o que fazer naquele mês.' : '';
  const linkProg = `${origem}/progresso?id=${encodeURIComponent(id)}&a=${await assinaturaAcomp(env, id)}`;
  const texto = `${primeiro}, o seu plano de desaperto chegou. Ele está em anexo, em PDF.\n\n${frase}\n\nComece pela página 3: são três passos para esta semana, com o tempo que cada um leva.${acompTxt ? '\n\n' + acompTxt : ''}\n\nQuer contar que começou? Gere a imagem para o seu story: ${linkProg}\n\nSe algum número estiver diferente da sua realidade, responda este e-mail. A gente ajusta.${garantia ? '\n\n' + garantia : ''}\n\nO Desaperto nunca pede senha, nunca manda boleto e nunca cobra para limpar nome.\nProtocolo: ${l.protocolo}\n\nDesaperto · desaperto.com`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#16211C;max-width:520px">
<p style="margin:0 0 14px"><b>${escapar(primeiro)}, o seu plano de desaperto chegou.</b> Ele está em anexo, em PDF.</p>
<p style="margin:0 0 14px">${escapar(frase)}</p>
<p style="margin:0 0 14px">Comece pela página 3: são três passos para esta semana, com o tempo que cada um leva.</p>
${acompTxt ? `<p style="margin:0 0 14px">${escapar(acompTxt)}</p>` : ''}
<p style="margin:0 0 14px">Quer contar que começou? <a href="${escapar(linkProg)}" style="color:#16704A;font-weight:700">Gere a imagem para o seu story</a>, sem valores e sem o seu nome.</p>
<p style="margin:0 0 14px">Se algum número estiver diferente da sua realidade, responda este e-mail. A gente ajusta.</p>
${garantia ? `<p style="margin:0 0 14px;color:#16704A">${escapar(garantia)}</p>` : ''}
<p style="margin:18px 0 0;color:#555D58;font-size:13px">O Desaperto nunca pede senha, nunca manda boleto e nunca cobra para limpar nome. Protocolo: ${escapar(l.protocolo)}</p>
<p style="margin:14px 0 0;font-weight:800;letter-spacing:-0.02em">desaperto</p></div>`;
  const ok = await enviarEmail(env, { para: l.email, assunto: 'Seu plano de desaperto chegou', texto, html, anexos: [{ filename: `plano-de-desaperto-${l.protocolo}.pdf`, path: link }] });
  if (!ok) return { ok: false, erro: 'O serviço de e-mail recusou o envio. Confira a configuração do Resend.' };
  await env.DB.prepare("UPDATE respostas SET status = 'plano_enviado', plano_enviado_em = ? WHERE id = ?").bind(agora(), id).run();
  return { ok: true };
}


// ---------- contagem do funil (sem cookie, sem nome: só quantas vezes cada passo aconteceu em cada dia) ----------
export function diaBrasil(t = Date.now()) {
  return new Date(t - 3 * 3600e3).toISOString().slice(0, 10);
}
export async function evento(db, nome) {
  try {
    await db.prepare('INSERT INTO eventos (dia, evento, n) VALUES (?, ?, 1) ON CONFLICT (dia, evento) DO UPDATE SET n = n + 1').bind(diaBrasil(), nome).run();
  } catch {}
}

// ---------- links de teste grátis (convites) ----------
// O Flávio cria no painel; quem abre desaperto.com/teste/CODIGO faz tudo sem pagar.
export function codigoConvite() {
  const L = 'abcdefghjkmnpqrstuvwxyz23456789';  // sem 0/o, 1/l/i para não confundir
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => L[b % L.length]).join('');
}
export function limparCodigo(c) { return typeof c === 'string' ? c.trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) : ''; }
export async function conviteValido(db, codigo) {
  if (!codigo) return false;
  const c = await db.prepare('SELECT usos, usos_max, ativo FROM convites WHERE codigo = ?').bind(codigo).first();
  return !!(c && c.ativo && c.usos < c.usos_max);
}
export async function usarConvite(db, codigo) {
  const r = await db.prepare('UPDATE convites SET usos = usos + 1 WHERE codigo = ? AND ativo = 1 AND usos < usos_max').bind(codigo).run();
  return !!(r && r.meta && r.meta.changes);
}
export function ehConvite(l) { return !!l && l.pag_status === 'convite'; }

// ---------- preço e pagamento (Pix pelo Mercado Pago) ----------
// A cobrança liga sozinha quando o segredo MP_ACCESS_TOKEN existe na Cloudflare. Sem ele, o plano segue grátis como antes.
export function cobrancaAtiva(env) { return !!(env.MP_ACCESS_TOKEN || '').trim(); }
export function preco(env) { const p = Number(env.PRECO); return p > 0 ? Math.round(p * 100) / 100 : 34.9; }
export function reaisCentavos(v) { return 'R$ ' + v.toFixed(2).replace('.', ','); }
export function reais(v) { return 'R$ ' + Math.round(v).toLocaleString('pt-BR'); }

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export function mesLongo(t) { return t ? `${MESES[t[1] - 1]} de ${t[0]}` : ''; }

export async function assinaturaPagar(env, id) {
  return (await sha256(`pagar|${id}|${(env.ADMIN_TOKEN || '').trim()}`)).slice(0, 32);
}
export async function linkPagar(env, origem, id) {
  return `${origem}/pagar?id=${encodeURIComponent(id)}&a=${await assinaturaPagar(env, id)}`;
}

export function mascararEmail(e) {
  const [u, d] = String(e || '').split('@');
  if (!d) return '';
  return (u.length <= 2 ? u[0] + '*' : u.slice(0, 2) + '*'.repeat(Math.min(6, u.length - 2))) + '@' + d;
}

// O que a pessoa vê de graça: a data e o tamanho do que ela ganha seguindo o plano.
export function dataGratis(resumo) {
  const p = resumo || {};
  const t = { tipo: 'data', saida: p.saida || null, saida_txt: mesLongo(p.saida), primeira_txt: p.primeira ? mesLongo(p.primeira) : '',
    economia: p.economia_12 || 0, dividas: p.dividas || 0, total: p.total || 0, carro: !!p.cenario_carro };
  if (p.repactuacao) {
    t.tipo = 'lei';
    t.diferenca = p.diferenca || 0;
    if (p.rep && p.rep.parcela) { t.parcela = p.rep.parcela; t.meses = p.rep.meses; t.saida_txt = mesLongo(p.rep.saida); }
  } else if (!p.saida) t.tipo = 'sem_data';
  return t;
}

// Versão rápida: a data é uma estimativa feita com valores de cabeça (no navegador). Mostra faixa quando há.
export function dataEstimada(est) {
  const e = est || {};
  const t = { tipo: e.tipo || 'data', aprox: true, saida: e.saida || null, saida_txt: mesLongo(e.saida), primeira_txt: e.primeira ? mesLongo(e.primeira) : '',
    juros_mes: e.juros_mes || 0, dividas: e.dividas || 0, total: e.total || 0, diferenca: e.diferenca || 0 };
  if (e.saida && e.saida_max) t.faixa_txt = e.saida[0] === e.saida_max[0] ? `entre ${MESES[e.saida[1] - 1]} e ${mesLongo(e.saida_max)}` : `entre ${mesLongo(e.saida)} e ${mesLongo(e.saida_max)}`;
  return t;
}
export function dataDaLinha(l) {
  if (l.status === 'rapido') { try { return dataEstimada(JSON.parse(l.estimativa || '{}')); } catch { return dataEstimada({}); } }
  try { return dataGratis(JSON.parse(l.plano_resumo || '{}')); } catch { return dataGratis({}); }
}
export async function linkContinuar(env, origem, id, convite = false) {
  return `${origem}/comecar?continuar=${encodeURIComponent(id)}&a=${await assinaturaPagar(env, id)}${convite ? '&t=1' : ''}`;
}

// Depois de pagar a versão rápida: falta completar as respostas para o plano exato.
export async function enviarCompletar(env, l, origem, lembrete = false) {
  const primeiro = (l.nome || '').trim().split(/\s+/)[0] || 'Olá';
  const conv = ehConvite(l);
  const link = await linkContinuar(env, origem, l.id, conv);
  const assunto = lembrete ? 'Falta só um passo para o seu plano' : conv ? 'Seu teste está liberado: falta um passo' : 'Pagamento confirmado: falta um passo';
  const abre = lembrete ? `${primeiro}, o seu plano está esperando as suas respostas completas.` : conv ? `${primeiro}, o seu teste está liberado. Você não paga nada.` : `${primeiro}, pagamento confirmado. Obrigado.`;
  const corpo = 'Para o plano exato, complete as respostas com os valores do app do banco: o que entra, o que sai e cada dívida. Leva uns 15 minutos. Assim que você terminar, o plano chega neste e-mail em poucos minutos.';
  const garantia = conv ? 'Depois, a sua opinião sincera vale muito: o que ajudou e o que ficou confuso. É só responder este e-mail.' : 'Se o plano não te ajudar, responda este e-mail em até 7 dias e devolvemos o valor.';
  const texto = `${abre}\n\n${corpo}\n\nCompletar minhas respostas: ${link}\n\n${garantia}\n\nDesaperto · desaperto.com`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#16211C;max-width:520px">
<p style="margin:0 0 14px"><b>${escapar(abre)}</b></p>
<p style="margin:0 0 20px">${escapar(corpo)}</p>
<p style="margin:0 0 22px"><a href="${escapar(link)}" style="display:inline-block;background:#16704A;color:#fff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:999px">Completar minhas respostas</a></p>
<p style="margin:0 0 12px;color:#555D58;font-size:14px">${escapar(garantia)}</p>
<p style="margin:14px 0 0;font-weight:800;letter-spacing:-0.02em">desaperto</p></div>`;
  return enviarEmail(env, { para: l.email, assunto, texto, html });
}

async function mp(env, metodo, caminho, corpo, idem) {
  const h = { authorization: `Bearer ${(env.MP_ACCESS_TOKEN || '').trim()}`, 'content-type': 'application/json' };
  if (idem) h['x-idempotency-key'] = idem;
  try {
    const r = await fetch('https://api.mercadopago.com' + caminho, { method: metodo, headers: h, body: corpo ? JSON.stringify(corpo) : undefined });
    let j = {};
    try { j = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, j };
  } catch (e) {
    return { ok: false, status: 0, j: { message: String(e) } };
  }
}

// API de Orders do Mercado Pago (a de Payments está sendo descontinuada).
function erroMp(r) {
  const j = r.j || {};
  const e = Array.isArray(j.errors) && j.errors[0];
  return (e && (e.message || e.code)) || j.message || j.error || `Mercado Pago respondeu ${r.status}`;
}
// Traduz a situação do pedido para as palavras que o resto do site usa: pending, approved, refunded, cancelled.
export function situacaoOrdem(o) {
  const pg = (o && o.transactions && o.transactions.payments && o.transactions.payments[0]) || {};
  if (o.status === 'refunded' || pg.status === 'refunded' || o.status_detail === 'refunded') return 'refunded';
  if (o.status === 'processed' && (o.status_detail === 'accredited' || pg.status_detail === 'accredited' || pg.status === 'processed')) return 'approved';
  if (o.status === 'action_required' || o.status === 'created' || o.status === 'processing' || o.status === 'at_terminal') return 'pending';
  if (['canceled', 'cancelled', 'expired', 'failed'].includes(o.status) || o.status_detail === 'expired') return 'cancelled';
  return String(o.status || 'desconhecido');
}

export async function criarPix(env, l, origem) {
  const expira = Date.now() + 60 * 60e3;  // 1 hora para pagar; depois a página gera outro
  const valor = preco(env).toFixed(2);
  const r = await mp(env, 'POST', '/v1/orders', {
    type: 'online',
    processing_mode: 'automatic',
    external_reference: l.id,
    total_amount: valor,
    description: 'Plano de desaperto',
    payer: { email: l.email, first_name: (l.nome || '').trim().split(/\s+/)[0] || undefined },
    transactions: { payments: [{ amount: valor, payment_method: { id: 'pix', type: 'bank_transfer' }, expiration_time: 'PT1H' }] },
  }, crypto.randomUUID());
  const pg = r.j && r.j.transactions && r.j.transactions.payments && r.j.transactions.payments[0];
  const pm = pg && pg.payment_method;
  if (!r.ok || !pm || !pm.qr_code) return { ok: false, erro: erroMp(r) };
  const pix = { id: String(r.j.id), status: situacaoOrdem(r.j), qr: pm.qr_code, img: pm.qr_code_base64 || '', expira: new Date(expira).toISOString() };
  await env.DB.prepare('UPDATE respostas SET pag_id = ?, pag_status = ?, pag_qr = ?, pag_qr_img = ?, pag_expira = ? WHERE id = ?')
    .bind(pix.id, pix.status, pix.qr, pix.img, pix.expira, l.id).run();
  return { ok: true, pix };
}

// Confere no Mercado Pago (nunca confia só no aviso) e, se pago, libera o plano.
export async function confirmarPagamento(env, pagId, origem) {
  const r = await mp(env, 'GET', `/v1/orders/${encodeURIComponent(pagId)}`);
  if (!r.ok) return { ok: false, erro: erroMp(r) };
  const o = r.j, id = o.external_reference, st = situacaoOrdem(o);
  if (!id) return { ok: false, erro: 'Pagamento sem referência.' };
  const l = await env.DB.prepare('SELECT id, pago_em, pag_id, status, plano_resumo, nome, protocolo FROM respostas WHERE id = ?').bind(id).first();
  if (!l) return { ok: false, erro: 'Resposta não encontrada.' };
  if (st !== 'approved') {
    // um Pix antigo que expirou não apaga o Pix novo da mesma pessoa
    if ((!l.pago_em && l.pag_id === String(o.id)) || st === 'refunded') await env.DB.prepare('UPDATE respostas SET pag_status = ? WHERE id = ?').bind(st, id).run();
    return { ok: true, pago: false, status: st };
  }
  if (l.pago_em) return { ok: true, pago: true, ja: true };
  const pago = Number(o.total_paid_amount || o.total_amount);
  if (!(pago + 0.001 >= preco(env))) return { ok: false, erro: 'Valor pago menor que o preço.' };
  await env.DB.prepare("UPDATE respostas SET pago_em = ?, pago_valor = ?, pag_status = 'approved', pag_id = ? WHERE id = ? AND pago_em IS NULL")
    .bind(agora(), pago, String(o.id), id).run();
  await evento(env.DB, 'pagou');
  return { ok: true, pago: true, liberar: await liberarPlano(env, id, origem) };
}

// Depois de pago: manda o plano, a menos que ele precise de uma conferida antes.
export async function liberarPlano(env, id, origem) {
  const l = await env.DB.prepare('SELECT id, nome, email, protocolo, status, plano_resumo, pag_status FROM respostas WHERE id = ?').bind(id).first();
  if (l && l.status === 'rapido') return (await enviarCompletar(env, l, origem)) ? 'pedido para completar' : 'falhou o e-mail para completar';
  if (!l || !['plano_pronto', 'plano_enviado'].includes(l.status)) return 'esperando o plano';
  const resumo = l.plano_resumo ? JSON.parse(l.plano_resumo) : {};
  if (resumo.precisa_revisao) {
    await enviarEmail(env, { para: env.EMAIL_AVISO, assunto: `PAGO, revisar e enviar: ${(l.nome || '').split(' ')[0]} · ${l.protocolo}`,
      texto: `Pagamento confirmado. O plano tem aviso que pede revisão antes de enviar:\n\n${(resumo.alertas || []).map((a) => '- ' + a.texto).join('\n') || '- A conta não fecha.'}\n\nA pessoa foi avisada de que o plano chega em até 24 horas. Confira e envie em ${origem}/admin` });
    return 'revisão';
  }
  const r = await enviarPlano(env, id, origem);
  if (!r.ok) await enviarEmail(env, { para: env.EMAIL_AVISO, assunto: `PAGO, mas o plano não foi enviado: ${l.protocolo}`, texto: `${r.erro}\nEnvie à mão em ${origem}/admin` });
  return r.ok ? 'enviado' : 'falhou';
}

export async function devolverPagamento(env, id) {
  const l = await env.DB.prepare('SELECT pag_id, pago_em, devolvido_em FROM respostas WHERE id = ?').bind(id).first();
  if (!l || !l.pago_em || !l.pag_id) return { ok: false, erro: 'Não há pagamento confirmado para devolver.' };
  if (l.devolvido_em) return { ok: false, erro: 'Esse pagamento já foi devolvido.' };
  const r = await mp(env, 'POST', `/v1/orders/${encodeURIComponent(l.pag_id)}/refund`, null, `devolver-${id}`);
  if (!r.ok) return { ok: false, erro: erroMp(r) };
  await env.DB.prepare("UPDATE respostas SET devolvido_em = ?, pag_status = 'refunded' WHERE id = ?").bind(agora(), id).run();
  await evento(env.DB, 'devolvido');
  return { ok: true };
}

// E-mail com a data grátis, logo que o plano fica pronto (para quem saiu da página antes).
export async function enviarDataGratis(env, l, origem, lembrete = false) {
  const primeiro = (l.nome || '').trim().split(/\s+/)[0] || 'Olá';
  const t = dataDaLinha(l);
  const link = await linkPagar(env, origem, l.id);
  const valor = reaisCentavos(preco(env));
  let assunto, abre, linhas = [];
  if (t.tipo === 'lei') {
    assunto = 'Existe saída para as suas dívidas';
    abre = `${primeiro}, fizemos as contas. Do jeito que está, a conta não fecha. Mas existe saída.`;
    linhas.push('A Lei do Superendividamento permite juntar as dívidas numa proposta só, sem tirar o que você precisa para viver.');
    if (t.parcela) linhas.push(`Pelo cálculo, a proposta seria de ${reais(t.parcela)} por mês, em ${t.meses} parcelas.`);
    else if (t.aprox && t.diferenca) linhas.push(`Pelos valores aproximados, falta cerca de ${reais(t.diferenca)} por mês.`);
  } else if (t.tipo === 'sem_data') {
    assunto = 'O seu resultado chegou';
    abre = `${primeiro}, fizemos as contas com as suas respostas.`;
  } else if (t.aprox) {
    assunto = `Sua data aproximada: ${t.saida_txt}`;
    abre = `${primeiro}, fizemos as contas. Pelos valores aproximados, você sai das dívidas ${t.faixa_txt || 'por volta de ' + t.saida_txt}.`;
    if (t.primeira_txt) linhas.push(`A primeira dívida pode acabar já em ${t.primeira_txt}.`);
    if (t.juros_mes > 20) linhas.push(`Hoje, só de juros, você paga cerca de ${reais(t.juros_mes)} por mês.`);
    linhas.push('O plano exato usa os valores do app do banco e pode mudar essa data.');
  } else {
    assunto = `${t.carro ? 'Vendendo o carro, você' : 'Você'} sai das dívidas em ${t.saida_txt}`;
    abre = `${primeiro}, fizemos as contas. ${t.carro ? 'Vendendo o carro, você' : 'Você'} sai das dívidas em ${t.saida_txt}.`;
    if (t.primeira_txt) linhas.push(`A primeira dívida acaba já em ${t.primeira_txt}.`);
    if (t.economia > 50) linhas.push(`Seguindo a ordem certa, você pode deixar de pagar ${reais(t.economia)} de juros nos próximos 12 meses.`);
  }
  if (lembrete) { assunto = 'O seu plano está pronto, falta só liberar'; }
  const oferta = `O plano completo mostra qual dívida pagar primeiro, quanto pagar em cada mês, o que falar com o banco e os seus direitos. Custa ${valor}, uma vez só, por Pix${t.aprox ? '. Depois de pagar, você completa as respostas com o app do banco (uns 15 minutos) e o plano chega em minutos' : ''}. Se não te ajudar, devolvemos em até 7 dias.`;
  const botao = `Receber o plano completo · ${valor}`;
  const texto = `${abre}\n\n${linhas.join('\n')}\n\n${oferta}\n\n${botao}: ${link}\n\nO Desaperto nunca pede senha e nunca cobra para limpar nome. O único pagamento é este, pelo Pix da página acima.\n\nDesaperto · desaperto.com`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#16211C;max-width:520px">
<p style="margin:0 0 14px"><b>${escapar(abre)}</b></p>
${linhas.map((x) => `<p style="margin:0 0 12px">${escapar(x)}</p>`).join('')}
<p style="margin:16px 0 20px">${escapar(oferta)}</p>
<p style="margin:0 0 22px"><a href="${escapar(link)}" style="display:inline-block;background:#16704A;color:#fff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:999px">${escapar(botao)}</a></p>
<p style="margin:18px 0 0;color:#555D58;font-size:13px">O Desaperto nunca pede senha e nunca cobra para limpar nome. O único pagamento é este, pelo Pix da página acima.</p>
<p style="margin:14px 0 0;font-weight:800;letter-spacing:-0.02em">desaperto</p></div>`;
  return enviarEmail(env, { para: l.email, assunto, texto, html });
}

// ---------- acompanhamento mensal ----------
export async function assinaturaAcomp(env, id) {
  return (await sha256(`acomp|${id}|${(env.ADMIN_TOKEN || '').trim()}`)).slice(0, 32);
}
export async function criarAcompanhamento(env, l) {
  let dados = {}, resumo = {};
  try { dados = JSON.parse(l.dados || '{}'); resumo = JSON.parse(l.plano_resumo || '{}'); } catch {}
  if (dados.acompanhar !== 'Sim, quero' || !(resumo.acoes_mensais || []).length) return false;
  const dia = 3 + (parseInt((await sha256(l.id)).slice(0, 6), 16) % 5);  // espalha os envios entre os dias 3 e 7
  await env.DB.prepare(`INSERT INTO acompanhamento (resposta_id, primeiro_nome, email, objetivo, meses, dia_envio, ultimo_mes, criado_em) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
    ON CONFLICT (resposta_id) DO UPDATE SET email = excluded.email, objetivo = excluded.objetivo, meses = excluded.meses`)
    .bind(l.id, (l.nome || '').trim().split(/\s+/)[0] || '', l.email, String(dados.objetivo || '').trim().slice(0, 140) || null, JSON.stringify(resumo.acoes_mensais), dia, agora()).run();
  return true;
}
export async function enviarMes(env, a, mes, origem) {
  const NOMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const nomeMes = NOMES[mes.mes[1] - 1];
  const assin = await assinaturaAcomp(env, a.resposta_id);
  const parar = `${origem}/api/parar?id=${encodeURIComponent(a.resposta_id)}&a=${assin}`;
  const progresso = `${origem}/progresso?id=${encodeURIComponent(a.resposta_id)}&a=${assin}`;
  const fim = mes.faltam_meses === 0;
  const prog = mes.total > 1 ? (fim ? `${mes.total} de ${mes.total} dívidas pagas.` : `${mes.pagas} de ${mes.total} dívidas pagas · ${mes.faltam_meses === 1 ? 'falta 1 mês' : `faltam ${mes.faltam_meses} meses`} para o desaperto.`) : '';
  const assunto = fim ? `${nomeMes}: o mês do seu desaperto` : `${nomeMes}: o que fazer com as dívidas este mês`;
  const abre = fim ? `${a.primeiro_nome || 'Olá'}, chegou o mês do seu desaperto.` : `${a.primeiro_nome || 'Olá'}, chegou ${nomeMes.toLowerCase()}. Pelo seu plano, este mês:`;
  const objTxt = a.objetivo ? a.objetivo.charAt(0).toLowerCase() + a.objetivo.slice(1) : '';
  const obj = objTxt ? (fim ? `Agora é a vez do que você escolheu: ${objTxt}.` : `Lembra por que você está fazendo isso: ${objTxt}.`) : '';
  const fecho = 'Se a sua vida mudou (salário, uma dívida nova, um gasto que apareceu), responda este e-mail que a gente ajuda a ajustar.';
  const texto = `${abre}\n\n${mes.de ? 'Dinheiro para isso: ' + mes.de + '\n\n' : ''}${mes.acoes.map((x) => '- ' + x).join('\n')}\n\n${prog}\n${obj}\n\nVer o seu progresso e compartilhar: ${progresso}\n\n${fecho}\n\nNão quer mais receber estes e-mails? ${parar}\n\nDesaperto · desaperto.com`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#16211C;max-width:520px">
<p style="margin:0 0 12px"><b>${escapar(abre)}</b></p>
${mes.de ? `<p style="margin:0 0 10px;color:#555D58;font-size:14px">Dinheiro para isso: ${escapar(mes.de)}</p>` : ''}
<ul style="margin:0 0 16px;padding-left:20px">${mes.acoes.map((x) => `<li style="margin:0 0 8px">${escapar(x)}</li>`).join('')}</ul>
${prog ? `<p style="margin:0 0 12px;color:#16704A;font-weight:700">${escapar(prog)}</p>` : ''}
${obj ? `<p style="margin:0 0 12px">${escapar(obj)}</p>` : ''}
<p style="margin:4px 0 18px"><a href="${escapar(progresso)}" style="display:inline-block;background:#16211C;color:#F3EFE6;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:999px">Ver o meu progresso</a></p>
<p style="margin:0 0 12px;color:#555D58;font-size:14px">${escapar(fecho)}</p>
<p style="margin:18px 0 0;color:#555D58;font-size:13px">Não quer mais receber estes e-mails? <a href="${escapar(parar)}" style="color:#555D58">Clique aqui</a>.</p>
<p style="margin:14px 0 0;font-weight:800;letter-spacing:-0.02em">desaperto</p></div>`;
  return enviarEmail(env, { para: a.email, assunto, texto, html });
}
