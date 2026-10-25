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
  for (const col of ['aval_2d_em TEXT', 'aval_30d_em TEXT', 'sem_emails INTEGER NOT NULL DEFAULT 0']) {
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

export const STATUS = ['recebido', 'gerando', 'plano_pronto', 'erro_plano', 'plano_enviado'];

export function escapar(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Envia o plano por e-mail, com o PDF anexo. O Resend busca o arquivo pelo link assinado.
export async function enviarPlano(env, id, origem) {
  const l = await env.DB.prepare('SELECT nome, email, protocolo, status, plano_resumo FROM respostas WHERE id = ?').bind(id).first();
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
  const texto = `${primeiro}, o seu plano de desaperto chegou. Ele está em anexo, em PDF.\n\n${frase}\n\nComece pela página 3: são três passos para esta semana, com o tempo que cada um leva.\n\nSe algum número estiver diferente da sua realidade, responda este e-mail. A gente ajusta.\n\nO Desaperto nunca pede senha, nunca manda boleto e nunca cobra para limpar nome.\nProtocolo: ${l.protocolo}\n\nDesaperto · desaperto.com`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#16211C;max-width:520px">
<p style="margin:0 0 14px"><b>${escapar(primeiro)}, o seu plano de desaperto chegou.</b> Ele está em anexo, em PDF.</p>
<p style="margin:0 0 14px">${escapar(frase)}</p>
<p style="margin:0 0 14px">Comece pela página 3: são três passos para esta semana, com o tempo que cada um leva.</p>
<p style="margin:0 0 14px">Se algum número estiver diferente da sua realidade, responda este e-mail. A gente ajusta.</p>
<p style="margin:18px 0 0;color:#555D58;font-size:13px">O Desaperto nunca pede senha, nunca manda boleto e nunca cobra para limpar nome. Protocolo: ${escapar(l.protocolo)}</p>
<p style="margin:14px 0 0;font-weight:800;letter-spacing:-0.02em">desaperto</p></div>`;
  const ok = await enviarEmail(env, { para: l.email, assunto: 'Seu plano de desaperto chegou', texto, html, anexos: [{ filename: `plano-de-desaperto-${l.protocolo}.pdf`, path: link }] });
  if (!ok) return { ok: false, erro: 'O serviço de e-mail recusou o envio. Confira a configuração do Resend.' };
  await env.DB.prepare("UPDATE respostas SET status = 'plano_enviado', plano_enviado_em = ? WHERE id = ?").bind(agora(), id).run();
  return { ok: true };
}
