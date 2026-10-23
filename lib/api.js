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
export async function limparAntigas(db) {
  const limite = new Date(Date.now() - DIAS_GUARDADOS * 864e5).toISOString();
  await db.prepare('DELETE FROM respostas WHERE criado_em < ?').bind(limite).run();
}

// Aviso por e-mail (opcional). Só funciona se RESEND_API_KEY estiver configurada.
export async function enviarEmail(env, { para, assunto, texto, html }) {
  if (!env.RESEND_API_KEY || !para) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_REMETENTE || 'Desaperto <contato@desaperto.com>', to: [para], subject: assunto, text: texto, html }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export function escapar(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
