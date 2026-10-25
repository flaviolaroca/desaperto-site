"""Gera o modelo do plano em PDF a partir do motor (números) e dos textos (papel da IA).

Uso: python3 plano_pdf.py casos/carla.json saida.html
Depois o HTML é impresso em PDF pelo Chromium (ver gerar_pdf.js).
"""
import json, sys, html, re
import motor

import os
AQUI = os.path.dirname(os.path.abspath(__file__))
FONTES = os.path.join(AQUI, 'fontes')
LOGO = open(os.path.join(AQUI, '..', 'src', 'logo.svg')).read().strip()


def brl(v):
    return 'R$ ' + f'{round(v):,}'.replace(',', '.')


def mes_curto(t):
    a, m = t
    return motor.MESES[m - 1][:3] + '/' + str(a)[2:]


def mes_longo(t):
    a, m = t
    return f'{motor.MESES[m - 1]} de {a}'


def nome_exibicao(d):
    if d['sub'] == 'em_atraso':
        t0, c0 = nome_exibicao({**d, 'sub': 'parcelada'})
        return t0 + ' · parcelas atrasadas', c0
    if d['sub'] == 'cheque': return 'Cheque especial', d['credor']
    if d['sub'] == 'parcelamento_formal': return 'Cartão · fatura parcelada', d['credor']
    if d['sub'] == 'parcelamento': return 'Cartão · parcelamento antigo', d['credor']
    if d['sub'] == 'futuro': return 'Cartão · compras parceladas', d['credor']
    if d['sub'] == 'rotativo': return 'Cartão · fatura em aberto', d['credor']
    if d['tipo'] == 'Empréstimo em app ou financeira': return 'Empréstimo em app', d['credor']
    if d['tipo'] == 'Empréstimo pessoal no banco': return 'Empréstimo pessoal', d['credor']
    curtos = {'Conta atrasada (luz, água, gás, aluguel, condomínio)': 'Conta atrasada', 'Impostos (DAS do MEI, IR, IPVA)': 'Imposto',
              'Crediário ou carnê de loja': 'Crediário', 'Pensão alimentícia atrasada': 'Pensão atrasada', 'Dívida com parente ou conhecido': 'Dívida com pessoa',
              'Financiamento de veículo': 'Financiamento do veículo', 'Financiamento de imóvel': 'Financiamento do imóvel'}
    return curtos.get(d['tipo'], d['tipo']), d['credor'].replace(' · parcelado', '')


PAGINAR = r'''<script>
// Paginação: se o conteúdo passar do tamanho da página, os últimos itens da lista vão para uma página "(continua)".
function paginar() {
  const sobra = (p) => p.scrollHeight - p.clientHeight > 1;
  for (let i = 0, guarda = 0; i < document.querySelectorAll('.pag').length && guarda < 300; i++, guarda++) {
    const pag = document.querySelectorAll('.pag')[i];
    if (!sobra(pag)) continue;
    const listas = [...pag.querySelectorAll('[data-flui]')];
    const lista = listas[listas.length - 1];
    if (!lista || lista.children.length < 2) continue;
    const nova = document.createElement('section');
    nova.className = pag.className.replace('capa', '').trim();
    const sec = pag.querySelector('.secao');
    if (sec) { const s2 = document.createElement('p'); s2.className = 'secao'; s2.textContent = sec.textContent.replace(/ \(continua\)$/, '') + ' (continua)'; nova.appendChild(s2); }
    const nl = lista.cloneNode(false);
    nova.appendChild(nl);
    let x = lista.nextElementSibling; const depois = [];
    while (x) { depois.push(x); x = x.nextElementSibling; }
    depois.forEach((y) => nova.appendChild(y));
    pag.after(nova);
    while (sobra(pag) && lista.children.length > 1) nl.prepend(lista.lastElementChild);
    if (lista.tagName === 'OL') nl.start = (lista.start || 1) + lista.children.length;
    if (!nl.children.length) nl.remove();
  }
  document.body.dataset.pronto = '1';
}
(document.fonts ? document.fonts.ready : Promise.resolve()).then(() => setTimeout(paginar, 50));
</script>'''

def nomes_credores(res):
    """A pessoa costuma digitar 'Sicredi 2' para a segunda dívida no mesmo banco. No plano isso vira
    'Sicredi · parcela R$ 547', que ela reconhece no app. Só mexe no nome exibido (credor), nunca no 'nome' interno."""
    itens = {id(x): x for lista in (res['plano'], res['fila'], res.get('dividas_hoje') or []) for x in lista}.values()
    bases = {(x['credor'] or '').strip().lower() for x in itens}
    for x in itens:
        c = (x['credor'] or '').strip()
        m = re.match(r'^(.*\S)\s+\d{1,2}$', c)
        if m and m.group(1).lower() in bases:
            x['credor'] = m.group(1)
    grupos = {}
    for x in itens:
        if x['sub'] == 'futuro': continue
        grupos.setdefault(((x['credor'] or '').lower(), nome_exibicao(x)[0], x['id']), x)
    por_nome = {}
    for (c, t, i), x in grupos.items():
        por_nome.setdefault((c, t), []).append(i)
    for x in itens:
        ids = por_nome.get(((x['credor'] or '').lower(), nome_exibicao(x)[0]), [])
        if len(ids) > 1 and (x.get('parcela') or 0) > 0.5:
            x['credor'] = f'{x["credor"]} · parcela {brl(x["parcela"])}'


def objeto(d):
    """Nome da dívida com artigo, para frases como 'antecipe parcelas do empréstimo'."""
    sub, tipo = d['sub'], d['tipo']
    if sub == 'parcelamento_formal': return 'a fatura parcelada do cartão'
    if sub == 'parcelamento': return 'o parcelamento antigo do cartão'
    if sub == 'futuro': return 'as compras parceladas do cartão'
    if sub == 'rotativo': return 'a fatura do cartão'
    if sub == 'cheque': return 'o cheque especial'
    fixos = {'Empréstimo em app ou financeira': 'o empréstimo', 'Empréstimo pessoal no banco': 'o empréstimo pessoal',
             'Impostos (DAS do MEI, IR, IPVA)': 'o imposto parcelado', 'Conta atrasada (luz, água, gás, aluguel, condomínio)': 'a conta atrasada',
             'Crediário ou carnê de loja': 'o crediário', 'Pensão alimentícia atrasada': 'a pensão atrasada', 'Dívida com parente ou conhecido': 'a dívida',
             'Financiamento de veículo': 'o financiamento do veículo', 'Financiamento de imóvel': 'o financiamento do imóvel'}
    return fixos.get(tipo, 'o ' + nome_exibicao(d)[0].lower())


def de_(obj):
    """'o empréstimo' -> 'do empréstimo'; 'a conta' -> 'da conta'."""
    art, resto = obj.split(' ', 1)
    return {'o': 'do', 'a': 'da', 'os': 'dos', 'as': 'das'}[art] + ' ' + resto


def tem_app(d):
    if d['tipo'] in ('Impostos (DAS do MEI, IR, IPVA)', 'Crediário ou carnê de loja', 'Dívida com parente ou conhecido', 'Pensão alimentícia atrasada',
                     'Conta atrasada (luz, água, gás, aluguel, condomínio)'): return False
    return d['sub'] in ('parcelamento_formal', 'parcelamento', 'rotativo', 'parcelada', 'em_atraso', 'cheque') or d['tipo'] in (
        'Empréstimo em app ou financeira', 'Empréstimo pessoal no banco', 'Financiamento de veículo', 'Financiamento de imóvel') or 'consign' in d['tipo'].lower()


def paginas_repactuacao(rep, res, r, e, T, nome_ex, inicio):
    pags = []
    # O que proteger
    itens = [('Casa, comida e contas do mês', f'{brl(rep["viver"])} por mês, já com os ajustes. É o mínimo para viver, e a lei manda preservar.')]
    for x in rep['essenciais']:
        t, c = nome_ex(x['d'])
        itens.append((f'{t} <small>{e(c)}</small>', f'{brl(x["saldo"])} em atraso. Peça para parcelar com a empresa, cerca de {brl(x["mensal"])} por mês. Evita o corte.'))
    for x in rep['protegidas']:
        t, c = nome_ex(x['d'])
        d = x['d']
        if d.get('descontado'):
            txt = f'Já sai do salário antes de ele cair na conta ({brl(d["parcela"])}). Segue igual. Ele também pode entrar na renegociação: pergunte no atendimento.'
        elif d.get('parcelamento_oficial'):
            txt = f'Imposto não entra na lei. Parcele no portal oficial: cerca de {brl(x["mensal"])} por mês.'
        elif d['tipo'] in ('Financiamento de imóvel', 'Financiamento de veículo'):
            txt = f'Fica fora da renegociação, porque o bem é a garantia. Continue pagando a parcela de {brl(x["mensal"])}.'
        else:
            txt = f'Não entra na lei. Combine com a pessoa um valor que caiba, perto de {brl(x["mensal"])} por mês.'
        itens.append((f'{t} <small>{e(c)}</small>', txt))
    if rep['proposta']:
        itens.append(('Proposta para os credores', f'O que sobra depois disso: {brl(rep["sobra"])} por mês. A proposta usa {brl(rep["parcela"])} e deixa {brl(rep["sobra"] - rep["parcela"])} de folga para imprevistos.'))
    else:
        if rep['sobra'] < 0:
            itens.append(('O que sobra para as dívidas', f'Nada. Mesmo sem pagar nenhuma dívida, o básico passa da renda em {brl(-rep["sobra"])}. Peça a renegociação na Defensoria Pública, com carência para começar a pagar, e procure o CRAS da sua cidade: ele orienta sobre benefícios e sobre a tarifa social de luz e água.'))
        else:
            itens.append(('O que sobra para as dívidas', f'{brl(rep["sobra"])}. É pouco para uma proposta agora: peça a renegociação na Defensoria Pública, com carência para começar a pagar.'))
    pags.append(f'''
<section class="pag">
  <p class="secao">A ordem</p>
  <h2>Primeiro o que garante a sua vida. Depois, as dívidas.</h2>
  <ol class="ordem" data-flui>{''.join(f'<li><span class="pos">{k}</span><div><h3>{a}</h3><p>{b}</p></div></li>' for k, (a, b) in enumerate(itens, 1))}</ol>
</section>''')
    # A proposta
    if rep['proposta']:
        linhas = ''.join(f'<tr><td>{e(c["credor"])}</td><td class="n">{brl(c["saldo"])}</td><td class="n">{brl(c["parcela_hoje"])}</td><td class="n"><b>{brl(c["parcela_proposta"])}</b></td></tr>' for c in rep['credores'])
        tot = f'<tr class="tot"><td>Total</td><td class="n">{brl(rep["total"])}</td><td class="n">{brl(rep["parcela_hoje"])}</td><td class="n"><b>{brl(sum(c["parcela_proposta"] for c in rep["credores"]))}</b></td></tr>'
        if rep['cobertura'] < 0.999:
            cob = f'Em 5 anos, a proposta paga {round(rep["cobertura"] * 100)}% do que é cobrado hoje. Os credores podem aceitar. Sem acordo, o juiz pode impor um plano que garante a eles pelo menos o valor emprestado, corrigido.'
        else:
            cob = 'A proposta paga tudo o que é cobrado hoje e pede que os juros parem de correr. Os credores podem pedir mais.'
        pags.append(f'''
<section class="pag">
  <p class="secao">A proposta</p>
  <h2>Uma proposta, todos os credores.</h2>
  <table class="tab"><thead><tr><th>Credor</th><th class="n">Deve hoje</th><th class="n">Pede hoje por mês</th><th class="n">Proposta</th></tr></thead><tbody>{linhas}{tot}</tbody></table>
  <p class="nota">{rep["meses"]} parcelas de {brl(rep["parcela"])}, de {mes_curto(rep["inicio_pag"])} a {mes_curto(rep["saida"])}. Cada credor recebe na proporção do que cobra hoje. {cob} <b>Não aceite um total acima de {brl(rep["sobra"])} por mês:</b> acima disso, a conta volta a não fechar.</p>
  <div class="caixa"><b>Enquanto a audiência não acontece</b>
    <ul class="enq">
      <li>Pague primeiro o que está na página anterior: casa, comida, contas e o que fica fora da renegociação.</li>
      <li>Guarde {brl(rep["parcela"])} por mês numa conta separada. Isso mostra que a proposta cabe e vira o primeiro pagamento do acordo.</li>
      <li>Não pegue empréstimo novo nem use o limite do cartão para cobrir parcelas.</li>
      <li>As parcelas que não couberem vão atrasar, e isso pode sujar seu nome. Já ia acontecer, porque a conta não fecha: o pedido é o que organiza esse atraso. Por isso, faça o pedido nesta semana.</li>
    </ul></div>
</section>''')
    # Como pedir
    pags.append(f'''
<section class="pag">
  <p class="secao">Como pedir</p>
  <h2>A renegociação, passo a passo.</h2>
  <ol class="passos">
    <li><b>Onde:</b> no Procon da sua cidade, na Defensoria Pública ou no centro de conciliação (Cejusc) do Tribunal de Justiça do seu estado. É gratuito e você não precisa de advogado para começar.</li>
    <li><b>O que levar:</b> documento com foto, comprovante de renda e de residência, os contratos ou extratos das dívidas e as páginas "Dossiê" deste plano, com o orçamento e a proposta prontos.</li>
    <li><b>O que dizer:</b> "Minhas dívidas passaram do que consigo pagar e quero pedir a repactuação pela Lei do Superendividamento. Trouxe a lista das dívidas, meu orçamento e uma proposta."</li>
    <li><b>O que acontece:</b> todos os credores são chamados para uma audiência só. Se um deles faltar sem justificativa, a cobrança dele fica suspensa, os juros de atraso param e ele entra no plano recebendo depois dos outros.</li>
    <li><b>Depois do acordo:</b> ele diz a data em que seu nome sai do Serasa e do SPC. Em troca, você se compromete a não fazer novas dívidas enquanto paga.</li>
  </ol>
  <div class="caixa"><b>Cuidado:</b> ninguém precisa cobrar para "entrar com o pedido da lei do superendividamento" ou para "limpar seu nome". Nos órgãos públicos, o pedido é gratuito.</div>
</section>''')
    return pags


def dossie(rep, res, r, e, nome_ex, inicio):
    g = dict(rep['gastos'])
    for a in res['ajustes']:
        g[a['cat']] = a['para']
    gastos = ''.join(f'<tr><td>{motor.NOME_GASTO[k]}</td><td class="n">{brl(v)}</td></tr>' for k, v in g.items() if v)
    va = r.get('va') or 0
    fora = ''.join(f'<tr><td>{e(nome_ex(x["d"])[0])}<br><small class="cred">{e(x["credor"])}</small></td><td>{e(x["como"][0].upper() + x["como"][1:])}</td><td class="n">{brl(x["saldo"])}</td></tr>' for x in rep['protegidas'] + rep['essenciais'])
    p1 = f'''
<section class="pag">
  <p class="secao">Dossiê para a audiência · 1 de 2</p>
  <h2>Leve estas duas páginas.</h2>
  <dl class="ficha"><dt>Nome</dt><dd>{e(r.get("nome") or "")}</dd><dt>CPF</dt><dd>__________________ (preencha à mão)</dd>
  <dt>Trabalho</dt><dd>{e(r.get("trabalho") or "")}</dd><dt>Renda líquida</dt><dd>{brl(res["R"])} por mês{(" + " + brl(va) + " de vale-alimentação") if va else ""}</dd></dl>
  <h3 class="peq">Gastos do mês, já com cortes</h3>
  <table class="tab"><tbody>{gastos}<tr class="tot"><td>Total para viver{" (o vale paga parte do mercado)" if va else ""}</td><td class="n">{brl(rep["viver"])}</td></tr></tbody></table>
  {('<h3 class="peq">Fica fora da renegociação</h3><table class="tab"><tbody>' + fora + '</tbody></table>') if fora else ''}
</section>'''
    linhas = ''
    for c in rep['credores']:
        for d in c['itens']:
            t, _ = nome_ex(d)
            sit = 'Atrasada' if d['atrasada'] else 'Em dia'
            linhas += f'<tr><td>{e(c["credor"])}</td><td>{e(t)}</td><td>{sit}</td><td class="n">{brl(d["saldo"])}</td></tr>'
    prop = (f'<div class="caixa"><b>Proposta:</b> {brl(rep["parcela"])} por mês, em {rep["meses"]} parcelas, divididas entre os credores na proporção do que cada um cobra hoje. Renda {brl(res["R"])} − gastos {brl(rep["viver"])} − fora da renegociação {brl(rep["mensal_prot"])} = {brl(rep["sobra"])} livres por mês.</div>'
            if rep['proposta'] else f'<div class="caixa"><b>Capacidade de pagamento:</b> renda {brl(res["R"])} − gastos {brl(rep["viver"])} − fora da renegociação {brl(rep["mensal_prot"])} = {brl(rep["sobra"])}. Peço plano com carência para começar a pagar.</div>')
    p2 = f'''
<section class="pag">
  <p class="secao">Dossiê para a audiência · 2 de 2</p>
  <h2>Dívidas para renegociar.</h2>
  <table class="tab"><thead><tr><th>Credor</th><th>O que é</th><th>Situação</th><th class="n">Deve hoje</th></tr></thead><tbody>{linhas}<tr class="tot"><td>Total</td><td></td><td></td><td class="n">{brl(rep["total"])}</td></tr></tbody></table>
  <p class="nota">Valores informados em {mes_longo(mes_respostas(inicio))}. Confira os de hoje no Registrato do Banco Central (gratuito, pelo gov.br): ele lista os empréstimos, cartões e financiamentos de bancos e financeiras no seu CPF.</p>
  {prop}
</section>'''
    return [p1, p2]


def mes_respostas(inicio):
    a, m = inicio
    return (a, m - 1) if m > 1 else (a - 1, 12)


def montar(r, textos, inicio=(2026, 11), link_avaliar=None):
    res = motor.rodar(r, inicio)
    original = res
    cenario = None
    if not res['conta_fecha'] and res.get('cenario_veiculo'):
        cenario = res['cenario_veiculo']
        r = cenario['r']
        res = cenario['res']
    rep = res.get('repactuacao') if not cenario else None
    cons = motor.conservador(r, inicio)
    nome = r.get('nome') or 'você'
    fila = res['fila']
    plano = res['plano']
    e = html.escape
    nomes_credores(res)

    # compras parceladas que acabam em até 3 meses não entram no retrato do mês (somem logo)
    fut_curto = all(len(d.get('agenda') or {}) <= 3 for d in plano if d['sub'] == 'futuro')
    parcelas_plano = sum(d['parcela'] for d in plano if d['caixa'] and d['sub'] in ('parcelada', 'parcelamento', 'parcelamento_formal') + (() if fut_curto else ('futuro',)))
    sobra_plano = res['R'] - res['E'] - res['A2'] - parcelas_plano
    hoje = {d['nome']: d for d in res['dividas_hoje']}
    rot = next((d for d in res['dividas_hoje'] if d['sub'] == 'rotativo'), None)
    rotp = next((d for d in plano if d['sub'] == 'parcelamento_formal'), None)
    cheque = next((d for d in plano if d['sub'] == 'cheque'), None)
    app = next((d for d in res['fila'] if d['sub'] == 'atrasada' and d.get('acordo_oferta')), None)
    emp = next((d for d in plano if d['sub'] == 'parcelada'), None)
    extra13 = next((x for x in r.get('extrasLista') or []), None)
    pct_div = round(res['D'] / res['R'] * 100)
    juros_dia = res['J'] / 30

    # -------- páginas --------
    pags = []

    # 1. Sua rota
    ctx = dict(res=res, cons=cons, r=r, e=e, brl=brl, mes_longo=mes_longo, mes_curto=mes_curto, nome_exibicao=nome_exibicao, motor=motor,
               fila=fila, plano=plano, cenario=cenario, rep=rep, original=original, rot=rot, rotp=rotp, cheque=cheque, app=app, emp=emp, parcelas_plano=parcelas_plano, sobra_plano=sobra_plano)
    T = textos(ctx)
    if sobra_plano >= 0:
        capa_sobra = f'<div><span class="rot">Depois de pagar as contas e as parcelas, sobram</span><b>{brl(sobra_plano)}</b><small>Esse dinheiro não fica parado: vai para pagar as dívidas, uma por vez. A página "Mês a mês" mostra quanto vai para qual.</small></div>'
    else:
        falta = -sobra_plano
        m1 = res['meses'][0] if res['meses'] else None
        prox_pos = next((m for m in res['meses'] if (m['sobra'] - m.get('do_guardado', 0) - sum(v for _, v in m.get('extras_entrada', []))) > 0), None)
        # o motivo do aperto: o pagamento que mais cai entre este mês e o mês em que volta a sobrar
        motivo, queda = '', ''
        if m1 and prox_pos and prox_pos is not m1:
            quedas = []
            for nome_p, v1 in m1.get('pagamentos', {}).items():
                v2 = prox_pos.get('pagamentos', {}).get(nome_p, 0)
                if v1 - v2 > 0.5:
                    dd = next((x for x in plano if x['nome'] == nome_p), None)
                    if dd: quedas.append((v1 - v2, v1, v2, dd))
            if quedas:
                _, v1, v2, dd = max(quedas, key=lambda q: q[0])
                obj = objeto(dd)
                plural = obj.split(' ', 1)[0] in ('os', 'as')
                motivo = f' O motivo: {e(obj)} {e(dd["credor"])} ainda {"somam" if plural else "custa"} {brl(v1)} neste mês.'
                queda = (f'{"elas caem" if plural else "cai"} para {brl(v2)} e ' if v2 > 0.5 else f'{"elas acabam" if plural else "acaba"} e ')
        cobre = ' Use o dinheiro que você tem guardado para cobrir.' if (r.get('guardado') or 0) >= falta else ' Essa diferença precisa ser resolvida antes de tudo: a página "Mês a mês" mostra como.'
        depois = f' Em {mes_longo((prox_pos["ano"], prox_pos["mes"]))}, {queda}volta a sobrar. Essa sobra vai para pagar as dívidas, uma por vez.' if prox_pos else ''
        capa_sobra = (f'<div><span class="rot">Neste primeiro mês, falta dinheiro</span><b class="falta">faltam {brl(falta)}</b>'
                      f'<small>As contas e as parcelas deste mês somam {brl(falta)} a mais do que você recebe.{motivo}{cobre}{depois}</small></div>')
    fora_txt = ''
    for d in plano:
        if d['banda'] == 'fora' and d['sub'] == 'parcelada' and d.get('restam'):
            fim = (inicio[0] + (inicio[1] - 1 + d['restam'] - 1) // 12, (inicio[1] - 1 + d['restam'] - 1) % 12 + 1)
            t_, c_ = nome_exibicao(d)
            fora_txt += f' O {t_.lower()} {e(c_)}, que cobra menos juros, segue normal até {mes_longo(fim)}.'
    acoes = T['acoes']
    qs = [d['quitada_em'] for d in plano if d.get('quitada_em') and d['sub'] != 'futuro']
    primeira_txt = ''
    if qs and min(qs) != res.get('saida') and not cenario:
        n_ate = 1 + (min(qs)[0] * 12 + min(qs)[1]) - (inicio[0] * 12 + inicio[1])
        primeira_txt = f'A primeira dívida acaba já em {mes_longo(min(qs))}, {"no primeiro mês" if n_ate == 1 else f"daqui a {n_ate} meses"}. '
    if rep:
        if rep['proposta']:
            capa_h1 = 'A conta não fecha. <em>A saída é renegociar tudo junto.</em>'
            capa_claro = (f'<div><span class="rot">Proposta para os credores</span><b>{brl(rep["parcela"])} por mês</b><small>em {rep["meses"]} parcelas, no lugar dos {brl(rep["parcela_hoje"])} que as dívidas pedem por mês hoje</small></div>'
                          f'<div><span class="rot">Se a proposta for aceita, você sai das dívidas em</span><b>{mes_longo(rep["saida"])}</b><small>Contando cerca de {rep["meses_ate_audiencia"]} meses até a audiência. A data final depende do acordo.</small></div>')
        else:
            capa_h1 = 'A conta não fecha. <em>O caminho é pedir ajuda pela lei</em>, já nesta semana.'
            capa_claro = (f'<div><span class="rot">Depois do básico para viver, sobra para as dívidas</span><b>{brl(max(0, rep["sobra"]))}</b><small>O pedido ainda vale: a lei permite que a primeira parcela do plano comece em até 180 dias. A Defensoria Pública pode fazer o pedido por você.</small></div>')
            if rep['sobra'] < 0:
                capa_claro = capa_claro.replace('sobra para as dívidas</span><b>R$ 0</b>', f'o básico já passa da renda em</span><b>{brl(-rep["sobra"])}</b>')
        pags.append(f'''
<section class="pag capa">
  <div class="topo">{LOGO}<span class="selo-doc">Plano de desaperto</span></div>
  <p class="olho">{e(nome)}, este é o seu caminho.</p>
  <h1 class="data">{capa_h1}</h1>
  <p class="sub">Mesmo com os ajustes, faltam {brl(res['diferenca'])} por mês. A Lei do Superendividamento permite juntar as dívidas numa proposta única, em até 5 anos, sem tirar o que você precisa para viver.</p>
  <div class="claro">{capa_claro}</div>
  <h2 class="peq">Esta semana</h2>
  <ol class="acoes-resumo">{''.join(f'<li><span>{e(a[1])}</span><small>{e(a[0])}</small></li>' for a in acoes)}</ol>
  <p class="rodape">Passo a passo das ações: página 3. A proposta e o dossiê para levar à audiência: páginas finais.</p>
</section>''')
    else:
      pags.append(f'''
<section class="pag capa">
  <div class="topo">{LOGO}<span class="selo-doc">Plano de desaperto</span></div>
  <p class="olho">{e(nome)}, este é o seu caminho.</p>
  <h1 class="data">{('Vendendo o carro, você <em>quita todas as dívidas</em> no mês da venda.' if (cenario and res['saida'] == inicio) else (('Vendendo o carro, você' if cenario else 'Você') + ' sai das dívidas em <em>' + mes_longo(res['saida']) + '</em>.'))}</h1>
  <p class="sub">{('Sem vender, a conta não fecha: faltam ' + brl(original['diferenca']) + ' por mês. A página "A decisão do carro" mostra os dois caminhos. ') if cenario else ''}{primeira_txt}{('Se o mês apertar além do previsto, a data pode ir até ' + mes_longo(cons["saida"]) + '. Nada além disso.') if cons["saida"] != res["saida"] else 'Mesmo se o mês apertar um pouco, a data se mantém.'}{fora_txt}</p>
  <div class="claro">
    <div><span class="rot">Todo mês, você paga em parcelas</span><b>{brl(parcelas_plano)}</b></div>
    {capa_sobra}
  </div>
  <h2 class="peq">Esta semana</h2>
  <ol class="acoes-resumo">{''.join(f'<li><span>{e(a[1])}</span><small>{e(a[0])}</small></li>' for a in acoes)}</ol>
  <p class="rodape">Passo a passo das ações: página 3. Quanto pagar em cada mês: página "Mês a mês".</p>
</section>''')

    # 2. Raio-X
    pags.append(f'''
<section class="pag">
  <p class="secao">Raio-X</p>
  <h2>O problema não é você. É o juro.</h2>
  <div class="tres">
    <div class="n"><span class="rot">Entra por mês</span><b>{brl(original["R"])}</b><small>mais {brl(r.get("va") or 0)} de vale-alimentação</small></div>
    <div class="n"><span class="rot">Vai para dívidas</span><b>{brl(original["D"])}</b><small>{(str(round(original["D"] / original["R"] * 100)) + ' de cada 100 reais do salário') if original["D"] > 0.5 else 'nenhuma parcela em dia: as dívidas estão atrasadas, sem pagamento'}</small></div>
    <div class="n destaque"><span class="rot">Só de juros</span><b>{brl(original["J"])}</b><small>por mês, sem abater nada da dívida</small></div>
  </div>
  <p>{T['raiox']}</p>
  {'' if rep else f'''<div class="compara">
    <div><span class="rot">Juros nos próximos 12 meses, se nada mudar</span><b class="cinza">{brl(original["juros_sem_12"])}</b></div>
    <div><span class="rot">Com este plano</span><b>{brl(res["juros_com_12"])}</b></div>
  </div>
  <p class="nota">A diferença, {brl(original["juros_sem_12"] - res["juros_com_12"])}, fica com você em vez de ir para os bancos e financeiras.</p>'''}
</section>''')

    # 3. Primeira semana
    pags.append(f'''
<section class="pag">
  <p class="secao">Sua primeira semana</p>
  <h2>{T['titulo_semana']}</h2>
  <ol class="acoes">{''.join(f'<li><small>{e(a[0])}</small><h3>{e(a[1])}</h3><p>{a[2]}</p></li>' for a in acoes)}</ol>
  {T.get('caixa_semana', '')}
</section>''')

    if cenario:
        po = original
        pags.append(f'''
<section class="pag">
  <p class="secao">A decisão do carro</p>
  <h2>Do jeito que está, a conta não fecha. Há dois caminhos.</h2>
  <p>Mesmo com os ajustes, as contas da casa e as parcelas passam do que entra em <b>{brl(po["diferenca"])} por mês</b>. Cortar mais nos gastos pequenos não resolve uma diferença desse tamanho.</p>
  <div class="caixa"><b>Caminho 1: vender o carro.</b> Pela tabela FIPE ele vale {brl(cenario["fipe"])}. Quitando o financiamento ({brl(cenario["saldo_financiamento"])}, estimado), sobram cerca de <b>{brl(cenario["liquido"])}</b>. Esse dinheiro quita as outras dívidas, a parcela de {brl(cenario["parcela_liberada"])} deixa de existir, e o que restar vira sua reserva. É o caminho que este plano detalha.</div>
  <div class="caixa" style="background: var(--areia)"><b>Caminho 2: manter o carro.</b> Aí a saída é renegociar todas as dívidas juntas pela Lei do Superendividamento, que garante o mínimo para viver. O pedido é gratuito, no Procon, na Defensoria Pública ou no centro de conciliação do Tribunal de Justiça. Leve este plano: ele já tem a lista de dívidas e o seu orçamento.</div>
  <p class="nota">A decisão é sua. O plano não considera o que você economizaria em combustível, seguro e manutenção sem o carro: se vender, sobra ainda mais. Se precisar de outro carro, o valor da venda pode pagar um mais barato à vista.</p>
</section>''')

    # 4. Por que você chegou aqui
    pags.append(f'''
<section class="pag">
  <p class="secao">Como você chegou aqui</p>
  <h2>{T['chegou_titulo']}</h2>
  {''.join('<p>' + x + '</p>' for x in T['chegou'])}
  <div class="caixa"><b>O que muda no seu mês:</b> {T['ajustes_ini']}
    <ul class="ajustes">{''.join(f'<li><span>{e(a["nome"])}</span><span>{brl(a["de"])} → {brl(a["para"])}</span></li>' for a in res["ajustes"])}</ul>
    {"Ele libera" if len(res["ajustes"]) == 1 else "Juntos, liberam"} {brl(res["economia_l2"])} por mês. {T['ajustes_fim']}</div>
</section>''')

    # 5. Ordem de ataque
    idx_a = len(pags)
    motivos = T['motivos']
    itens = []
    for d in fila:
        t, cred = nome_exibicao(d)
        mot = motivos.get(d['nome'], '')
        if d['banda'] == 'P5' and not mot:
            mot = 'Ainda não sabemos quanto você economiza adiantando essa dívida. Ela fica no fim até você confirmar a taxa ou o valor para quitar.'
        itens.append(f'<li><span class="pos">{d["ordem"]}</span><div><h3>{e(t)} <small>{e(cred)}</small></h3><p>{mot}</p>{'<p class="quando">A confirmar</p>' if d["banda"] == "P5" else ''}</div></li>')
    blocos = [itens[i:i + 5] for i in range(0, len(itens), 5)] if len(itens) > 6 else [itens]
    for bi, bloco in enumerate(blocos[:-1]):
        pags.append(f'''
<section class="pag">
  <p class="secao">A ordem{' (continua)' if bi else ''}</p>
  {'<h2>Uma dívida de cada vez, começando pela que cobra mais juros.</h2>' if bi == 0 else ''}
  <ol class="ordem" data-flui>{''.join(bloco)}</ol>
</section>''')
    pags.append(f'''
<section class="pag">
  <p class="secao">A ordem{' (continua)' if len(blocos) > 1 else ''}</p>
  {'' if len(blocos) > 1 else '<h2>Uma dívida de cada vez, começando pela que cobra mais juros.</h2>'}
  <ol class="ordem" data-flui start="{len(itens) - len(blocos[-1]) + 1}">{''.join(blocos[-1])}</ol>
</section>''')

    # 6. Calendário (gráfico de barras do saldo total)
    meses = res['meses']
    maxv = max(res['T'], max(m['saldo_total'] for m in meses))
    W, H, top, base = 300, 150, 10, 130
    bw = W / (len(meses) + 1)
    barras = []
    pts = [('hoje', res['T'])] + [(mes_curto((m['ano'], m['mes'])), m['saldo_total']) for m in meses]
    for k, (lab, v) in enumerate(pts):
        h = (base - top) * v / maxv
        x = k * bw + bw * 0.18
        cor = 'var(--areia-esc)' if k == 0 else 'var(--verde)'
        barras.append(f'<rect x="{x:.1f}" y="{base - h:.1f}" width="{bw*0.64:.1f}" height="{max(h, 0.8):.1f}" rx="1.5" fill="{cor}"/>')
        ultimo = len(pts) - 1
        if k == 0 or (k % 2 == 0 and not (ultimo % 2 == 1 and k == ultimo - 1)) or k == ultimo:
            barras.append(f'<text x="{(x + bw*0.64) if k == ultimo else (x + bw*0.32):.1f}" y="{base + 11}" text-anchor="{"end" if k == ultimo else "middle"}" class="eixo">{lab}</text>')
    barras.append(f'<text x="{bw*0.5:.1f}" y="{base - (base-top) - 2:.1f}" class="valor">{brl(res["T"])}</text>')
    marcos_txt = []
    marcos_mes = {}
    vistos = set()
    rot_marco = {
        'Juro explosivo zerado': 'Fim dos juros mais caros', 'Colchão completo': f'Reserva para imprevistos de {brl(res["meta_colchao"])} pronta',
    }
    for (a, m), t in res['marcos']:
        if t in vistos: continue
        vistos.add(t)
        if 'compras parceladas' in t: continue
        if t.startswith('Acordo de '):
            d_ac = next(x for x in plano if t == f"Acordo de {x['nome']} pago à vista")
            texto = f'Acordo do {d_ac["credor"]} pago' + (' · nome limpo' if d_ac['negativada'] else '')
        elif t in rot_marco: texto = rot_marco[t]
        else:
            d = next(d for d in plano if t == d['nome'] + ' quitada')
            tt, cc = nome_exibicao(d)
            texto = f'{nome_exibicao({**d, "sub": "parcelada"})[0]} {cc} em dia' if d['sub'] == 'em_atraso' else (lambda o: f'{o.split(" ",1)[1][0].upper()}{o.split(" ",1)[1][1:]} {cc} ' + {'o': 'quitado', 'a': 'quitada', 'os': 'quitados', 'as': 'quitadas'}[o.split(" ",1)[0]])(objeto(d))
        marcos_txt.append(f'<li><span>{mes_curto((a, m))}</span>{e(texto)}</li>')
        marcos_mes.setdefault((a, m), []).append(texto)
    grafico_html = f'<svg class="grafico" viewBox="0 0 {W} {H}" role="img" aria-label="Dívida total caindo de {brl(res['T'])} hoje{(' até zero em ' + mes_longo(res['saida'])) if res['saida'] else ''}">{"".join(barras)}</svg>'

    # 6b. Mês a mês: o que pagar
    def mes_ant(m):
        return (m['ano'], m['mes'] - 1) if m['mes'] > 1 else (m['ano'] - 1, 12)

    foco_visto = set()
    ultimo_mes = res['meses'][-1] if res['meses'] else None
    # progresso: quantas dívidas (como a pessoa contou no questionário) já acabaram
    ids_div = {}
    for x in plano:
        if x['sub'] != 'futuro' and x['banda'] != 'fora': ids_div.setdefault(x['id'], []).append(x)
    n_div = len(ids_div)

    def pagas_ate(t):
        return sum(1 for xs in ids_div.values() if all(y.get('quitada_em') and y['quitada_em'] <= t for y in xs))

    def meses_ate(t, fim):
        return (fim[0] * 12 + fim[1]) - (t[0] * 12 + t[1])

    saida_t = res.get('saida')
    metade_t = next(((mm['ano'], mm['mes']) for mm in res['meses'] if mm['saldo_total'] <= res['T'] / 2), None)
    primeira_t = next(((mm['ano'], mm['mes']) for mm in res['meses'] if pagas_ate((mm['ano'], mm['mes'])) >= 1), None)
    if metade_t and metade_t in (primeira_t, saida_t): metade_t = None

    def linha_mes(m):
        """Devolve (rótulo, linhas de 'de onde vem', ações) — cada ação é (texto fixo, nome da dívida ou None)."""
        de = []
        sobra_mes = m['sobra'] - m.get('do_guardado', 0) - sum(v for _, v in m.get('extras_entrada', []))
        if sobra_mes > 0.5: de.append(f'sobra do salário {brl(sobra_mes)}')
        if m.get('do_guardado'): de.append(f'{brl(m["do_guardado"])} do dinheiro guardado')
        for nome_x, v in m.get('extras_entrada', []): de.append(f'{e(nome_x)} {brl(v)}')
        # o dinheiro que sobra cresce quando uma dívida acaba: a parcela dela passa a trabalhar nas outras
        liberadas = [x for x in plano if x.get('quitada_em') == mes_ant(m) and x.get('caixa') and (x.get('parcela') or 0) > 0.5
                     and x['sub'] in ('parcelada', 'parcelamento', 'parcelamento_formal')]
        subiu = ''
        if liberadas and not m.get('deficit'):
            nomes = ' e '.join(f'{brl(x["parcela"])} do {e(nome_exibicao(x)[1])}' for x in liberadas)
            if len(liberadas) == 1:
                subiu = f'O valor subiu: a parcela de {nomes} acabou, e esse dinheiro agora vai para a próxima dívida.'
            else:
                subiu = f'O valor subiu: as parcelas de {nomes} acabaram, e esse dinheiro agora vai para a próxima dívida.'
        acoes_m = []
        if sobra_mes < -0.5:
            fonte = (f'o {e(m["extras_entrada"][0][0])}' if m.get('extras_entrada') else 'o dinheiro guardado' if m.get('do_guardado') else 'cortes no que não for essencial')
            acoes_m.append((f'As contas e as parcelas passam do salário em <b>{brl(-sobra_mes)}</b>: cubra com {fonte}', None))
        for nome_d, v in m.get('extras', {}).items():
            if v < 1: continue
            d = next(x for x in plano if x['nome'] == nome_d)
            t_, c_ = nome_exibicao(d)
            fecha = d.get('quitada_em') == (m['ano'], m['mes'])
            if d['sub'] == 'atrasada':
                if d.get('acordo_oferta'):
                    acoes_m.append((f'Feche o acordo do {e(c_)} e pague <b>{brl(d["acordo_oferta"])}</b> de uma vez' if fecha else f'Separe <b>{brl(v)}</b> para o acordo do {e(c_)}, numa conta onde você não mexa', None if fecha else nome_d))
                else:
                    acoes_m.append((f'Quite o {e(t_.lower())} {e(c_)}: pague os <b>{brl(d["saldo"])}</b> cobrados. Peça antes o valor atualizado' if fecha else f'Separe <b>{brl(v)}</b> para quitar o {e(t_.lower())} {e(c_)}', None))
            elif d['sub'] == 'outros':
                acoes_m.append((f'Pague {"o que falta da" if v < d["saldo"] - 0.5 else "a"} {e(t_.lower())} {e(c_)}: <b>{brl(v)}</b>' if fecha else f'Pague <b>{brl(v)}</b> da {e(t_.lower())} {e(c_)}', None))
            elif d['sub'] == 'em_atraso':
                t0 = nome_exibicao({**d, 'sub': 'parcelada'})[0].lower()
                if fecha and v >= d['saldo'] - 0.5:
                    acoes_m.append((f'Ponha em dia o {e(t0)} {e(c_)}: pague as {d["qtd_atr"]} parcelas atrasadas, <b>{brl(v)}</b>, além da parcela do mês', None))
                elif fecha:
                    acoes_m.append((f'Pague o resto das parcelas atrasadas do {e(t0)} {e(c_)}, <b>{brl(v)}</b>. Ele fica em dia', None))
                else:
                    acoes_m.append((f'Pague <b>{brl(v)}</b> das parcelas atrasadas do {e(t0)} {e(c_)}, começando pela mais antiga', None))
            elif d['sub'] == 'cheque':
                acoes_m.append((f'Deposite <b>{brl(v)}</b> na conta do {e(c_)} e saia do cheque especial. Depois, peça para reduzir o limite dele' if fecha else f'Deposite <b>{brl(v)}</b> na conta do {e(c_)} para diminuir o cheque especial', None if fecha else nome_d))
            elif fecha:
                onde = 'no app ou no chat' if tem_app(d) else 'no atendimento'
                acoes_m.append((f'Quite {e(objeto(d))} {e(c_)}: além da parcela, pague <b>{brl(v)}</b>. Antes, peça {onde} o valor exato para quitar hoje', None))
            elif tem_app(d):
                acoes_m.append((f'No app do {e(c_)}, antecipe <b>{brl(v)}</b> em parcelas {e(de_(objeto(d)))}, sempre as últimas', nome_d))
            elif d['tipo'] == 'Impostos (DAS do MEI, IR, IPVA)':
                acoes_m.append((f'Use <b>{brl(v)}</b> para adiantar {e(objeto(d))}, {e(c_)}: pague as últimas parcelas antes. Se o site não deixar, pergunte no atendimento como fazer', nome_d))
            elif d['tipo'] == 'Dívida com parente ou conhecido':
                acoes_m.append((f'Pague <b>{brl(v)}</b> a mais para {e(c_)}, além do combinado. Avise que é para encurtar o prazo', nome_d))
            else:
                acoes_m.append((f'Pague <b>{brl(v)}</b> a mais n{e(objeto(d))} {e(c_)}. Peça no atendimento para descontar das últimas parcelas', nome_d))
        res_tot = (min(r.get('guardado') or 0, res['meta_colchao']) if m is res['meses'][0] else 0) + m.get('para_reserva', 0)
        if res_tot > 0.5:
            if cenario and m is res['meses'][0] and res_tot > 2 * res['meta_colchao']:
                acoes_m.append((f'O resto da venda, <b>{brl(res_tot)}</b>, fica guardado com você: é a sua reserva e pode virar a entrada de um carro mais barato, à vista', None))
            elif m is ultimo_mes and res.get('saida') == (m['ano'], m['mes']) and not m.get('extras'):
                acoes_m.append((f'Pague só a última parcela. Os <b>{brl(res_tot)}</b> que iam para as dívidas ficam com você. Use os primeiros meses para montar uma reserva de 3 meses de contas e, depois, escolha um objetivo seu', None))
            else:
                acoes_m.append((f'Guarde <b>{brl(res_tot)}</b> na reserva para imprevistos', None))
        if m.get('deficit'):
            acoes_m = [('Só as parcelas. Neste mês não sobra nada para adiantar', None)]
        marcos_m = marcos_mes.get((m['ano'], m['mes']), [])
        t = (m['ano'], m['mes'])
        vitoria = None
        if saida_t and t == saida_t and not cenario:
            vitoria = ('Mês do desaperto.', 'A última dívida da lista acaba aqui. A partir de agora, o seu salário volta a ser seu.')
        elif t == primeira_t and n_div > 1 and t != saida_t:
            vitoria = ('Primeira dívida paga.', 'É a prova de que o plano funciona. Agora é repetir o que deu certo, uma de cada vez.')
        elif t == metade_t:
            vitoria = ('Metade do caminho.', f'Você já tirou {brl(res["T"] - m["saldo_total"])} das costas. Falta menos do que você já pagou.')
        return {'m': m, 'de': de, 'subiu': subiu, 'acoes': acoes_m, 'marcos': marcos_m, 'vitoria': vitoria,
                'chave': (tuple(de), tuple(a for a in acoes_m)) if not marcos_m and not subiu and not vitoria else None}

    def complemento(nome, ms, primeiro):
        """Quanto falta da dívida depois do(s) mês(es) e quando ela termina."""
        d = next(x for x in plano if x['nome'] == nome)
        quando = f' Nesse ritmo, acaba em {mes_longo(d["quitada_em"])}.' if (d.get('quitada_em') and primeiro) else ''
        if d['sub'] == 'atrasada' and d.get('acordo_oferta'):
            # para acordo, o que importa é quanto já foi separado, não o saldo cobrado
            juntado = 0
            for mm in res['meses']:
                juntado += mm.get('extras', {}).get(nome, 0)
                if mm is ms[-1]: break
            falta = max(d['acordo_oferta'] - juntado, 0)
            q = f' O acordo sai em {mes_longo(d["quitada_em"])}.' if (d.get('quitada_em') and primeiro) else ''
            se = f' Se pedirem mais de {brl(d["acordo_teto"])}, não feche: continue juntando e tente no mês seguinte.' if (primeiro and d.get('acordo_teto')) else ''
            return (f' Já separados: <b>{brl(juntado)}</b> dos {brl(d["acordo_oferta"])}.{q}' if falta > 0.5 else q) + se
        fim = ms[-1]['saldos'].get(nome, 0)
        if len(ms) == 1:
            return f' Depois disso, faltam <b>{brl(fim)}</b>.{quando}' if fim > 0.5 else ''
        ini = ms[0]['saldos'].get(nome, 0)
        return f' O que falta cai de <b>{brl(ini)}</b> para <b>{brl(fim)}</b>.{quando}'

    def html_linha(itens):
        m0, m1 = itens[0]['m'], itens[-1]['m']
        base = itens[0]
        ms = [x['m'] for x in itens]
        if len(itens) == 1:
            rot_m = 'Na venda' if (cenario and m0 is res['meses'][0]) else mes_curto((m0['ano'], m0['mes']))
            cab = ('Para usar neste mês: ' + ' + '.join(base['de'])) if base['de'] else 'Neste mês, só as parcelas'
        else:
            rot_m = f'{mes_curto((m0["ano"], m0["mes"]))}<br>a {mes_curto((m1["ano"], m1["mes"]))}'
            cab = f'Todo mês, por {len(itens)} meses: ' + ' + '.join(base['de'])
        linhas = []
        for texto, nome in base['acoes']:
            extra = ''
            if nome:
                extra = complemento(nome, ms, nome not in foco_visto)
                foco_visto.add(nome)
            linhas.append(texto + '.' + extra)
        linhas += [f'<span class="marco">Conquista: {e(x)}.</span>' for x in base['marcos']]
        sub = f'<p class="subiu">{base["subiu"]}</p>' if base['subiu'] else ''
        vit = f'<p class="vitoria"><b>{base["vitoria"][0]}</b> {base["vitoria"][1]}</p>' if base['vitoria'] else ''
        t1 = (m1['ano'], m1['mes'])
        pg = pagas_ate(t1)
        if saida_t and not cenario and n_div > 1:
            faltam = meses_ate(t1, saida_t)
            if faltam <= 0 or pg >= n_div:
                txt = f'{n_div} de {n_div} pagas · desapertou'
            else:
                txt = f'{pg} de {n_div} pagas · ' + ('falta 1 mês' if faltam == 1 else f'faltam {faltam} meses')
            prog = f'<p class="prog"><span class="barra"><i style="width:{round(100 * pg / n_div)}%"></i></span><span>{txt}</span></p>'
        else:
            prog = ''
        classe = ' class="alto"' if base['vitoria'] else ''
        peso = 9 + sum(len(re.sub(r'<[^>]+>', '', x)) for x in linhas) / 48 * 3.5 + (4 if sub else 0) + (7 if vit else 0) + (4 if prog else 0)
        return (f'<li{classe}><span class="m">{rot_m}<span class="ck"></span></span><div>{vit}<p class="de">{cab}</p>{sub}'
                f'<ul>{"".join("<li>" + x + "</li>" for x in linhas)}</ul>{prog}</div></li>', peso)

    # meses iguais em sequência viram um bloco só ("fev/27 a mai/27"), mostrando quanto a dívida cai no período
    linhas_mes, grupo = [], []
    for m in res['meses']:
        item = linha_mes(m)
        if grupo and item['chave'] is not None and item['chave'] == grupo[-1]['chave']:
            grupo.append(item)
        else:
            if grupo: linhas_mes.append(html_linha(grupo))
            grupo = [item]
    if grupo: linhas_mes.append(html_linha(grupo))
    # tudo numa página só: o script de paginação (no fim do HTML) mede no navegador e quebra em quantas páginas precisar
    mblocos = [[h for h, _ in linhas_mes]]
    for bi, bloco in enumerate(mblocos):
        pags.append(f'''
<section class="pag">
  <p class="secao">O caminho, mês a mês{' (continua)' if bi else ''}</p>
  {('<h2>O que pagar, quanto e onde.</h2>' + grafico_html + '<p class="nota">Barras: quanto você deve no fim de cada mês. Abaixo, só o que você paga <b>a mais</b>; as parcelas normais continuam todo mês.</p>') if bi == 0 else ''}
  <ol class="mes" data-flui>{''.join(bloco)}</ol>
  {'<div class="caixa"><b>Como adiantar:</b> no app do banco, use "antecipar parcelas" e escolha as últimas do contrato. O desconto nos juros é maior e a dívida acaba antes. Se o desconto mostrado for pequeno, não adiante: passe o dinheiro para a próxima da lista.</div>' if bi == len(mblocos) - 1 else ''}
</section>''')

    # 7. Negociação
    if app:
      pags.append(f'''
<section class="pag">
  <p class="secao">Negociação</p>
  <h2>Acordo do {e(app["credor"])}: o roteiro.</h2>
  {T.get('negocia_intro', '')}
  <div class="tira">
    <div><span class="rot">Cobrado hoje</span><b>{brl(app["saldo"])}</b></div>
    <div><span class="rot">Você oferece</span><b>{brl(app["acordo_oferta"])}</b></div>
    <div><span class="rot">Você aceita até</span><b>{brl(app["acordo_teto"])}</b></div>
  </div>
  <ol class="passos">
    <li><b>Quando:</b> {T['negocia_quando']} Oferecer o pagamento de uma vez consegue mais desconto do que parcelar.</li>
    <li><b>Onde:</b> no próprio app ou site de quem cobra, ou numa plataforma oficial de negociação. Nunca por um link recebido em mensagem.</li>
    <li><b>O que dizer:</b> "Quero quitar essa dívida. Tenho {brl(app["acordo_oferta"])} para pagar à vista hoje. Consegue fechar nesse valor?"</li>
    <li><b>Se recusarem:</b> peça a melhor proposta deles para pagamento de uma vez. Aceite até {brl(app["acordo_teto"])}. Acima disso, agradeça e tente de novo em 30 dias: ofertas melhoram perto do fim do mês.</li>
    <li><b>Antes de pagar:</b> peça o acordo por escrito, com o valor, a data e a frase "quitação total da dívida", que garante que depois disso você não deve mais nada. Pague só pelo boleto ou Pix gerado no canal oficial.</li>
  </ol>
  <div class="caixa"><b>Recuse:</b> parcelar com entrada alta e juros, pagar "taxa para limpar o nome" ou qualquer acordo que não diga quitação total. Depois de pago, a empresa tem até 5 dias úteis para tirar seu nome do Serasa e do SPC.</div>
</section>''')

    idx_b = len(pags)
    if rep:
        pags[idx_a:idx_b] = paginas_repactuacao(rep, res, r, e, T, nome_exibicao, inicio)

    # 8. Direitos
    pags.append(f'''
<section class="pag">
  <p class="secao">Direitos que quase ninguém usa</p>
  <h2>O que a lei já garante a você.</h2>
  <ul class="direitos" data-flui>{''.join(f'<li><h3>{a}</h3><p>{b}</p></li>' for a, b in T['direitos'])}
  </ul>
</section>''')

    # 9. Imprevistos
    pags.append(f'''
<section class="pag">
  <p class="secao">Se algo sair do previsto</p>
  <h2>Regras simples para não sair do caminho.</h2>
  <ul class="regras" data-flui>{''.join(f'<li><h3>{a}</h3><p>{b}</p></li>' for a, b in T['regras'])}
  </ul>
</section>''')

    # 10. Suas dívidas (cartões)
    idx_c = len(pags)
    cards = []
    for d in fila + [x for x in plano if x['banda'] == 'fora']:
        t, cred = nome_exibicao(d)
        if d['sub'] == 'em_atraso':
            linhas = [('Situação', f'{d["qtd_atr"]} atrasadas'), ('Para pôr em dia', brl(d['saldo']) + ('' if d.get('informado') else '*'))]
        elif d['sub'] == 'atrasada':
            linhas = [('Situação', 'Atrasada'), ('Cobrado hoje', brl(d['saldo']))] + ([('Você oferece', brl(d['acordo_oferta']))] if d.get('acordo_oferta') else [])
        elif d['sub'] == 'outros':
            linhas = [('Situação', 'Atrasada' if d['atrasada'] else 'Em dia'), ('Devido hoje', brl(d['saldo']))]
        elif d['sub'] == 'cheque':
            linhas = [('Usado hoje', brl(d['saldo'])), ('Juros', f'{d["taxa"]*100:.1f}% ao mês'.replace('.', ','))]
        else:
            linhas = [('Parcela', brl(d['parcela'])), ('Faltam', f'{d["restam"]}'), ('Para quitar hoje', brl(d['saldo']) + ('*' if (not d.get('exata', True)) or d.get('fonte_taxa') in ('calculada pelo contrato', 'referência', 'referência do parcelamento', 'média de mercado') else '')),
                      ('Juros', 'a confirmar' if d.get('fonte_taxa') == 'renegociação sem valor para quitar' else (f'{d["taxa"]*100:.1f}% ao mês'.replace('.', ',') + ('*' if not d.get('exata', True) else '')) if d['taxa'] else 'sem juros')]
        if d.get('prorrogado'):
            linhas.insert(0, ('Situação', f'{d["prorrogado"]} atrasadas para o fim'))
        ordem = f'<span class="pos">{d["ordem"]}</span>' if d.get('ordem') else '<span class="pos fora">·</span>'
        cards.append(f'''<article class="dcard">{ordem}<div class="dc-corpo"><h3>{e(t)}</h3><p class="cred">{e(cred)}</p>
<dl>{''.join(f'<dt>{a}</dt><dd>{b}</dd>' for a, b in linhas)}<dt>Previsão</dt><dd>{mes_curto(d['quitada_em']) if d['quitada_em'] else (mes_curto((inicio[0] + (inicio[1] + d['restam'] - 2) // 12, (inicio[1] + d['restam'] - 2) % 12 + 1)) if d.get('restam') else '—')}</dd></dl>
<p class="quitada">Quitada em ____ / ____</p></div></article>''')
    cblocos = [cards[i:i + 6] for i in range(0, len(cards), 6)]
    for bi, bloco in enumerate(cblocos[:-1]):
        pags.append(f'''
<section class="pag">
  <p class="secao">Suas dívidas</p>
  <h2>Marque cada uma quando quitar.</h2>
  <div class="dcards" data-flui>{''.join(bloco)}</div>
</section>''')
    pags.append(f'''
<section class="pag">
  <p class="secao">Suas dívidas{' (continua)' if len(cblocos) > 1 else ''}</p>
  {'' if len(cblocos) > 1 else '<h2>Marque cada uma quando quitar.</h2>'}
  <div class="dcards" data-flui>{''.join(cblocos[-1])}</div>
  <p class="nota">Sem número: fica fora da lista e segue só com as parcelas normais. * Valor estimado: confirme com o banco antes de pagar a dívida inteira.{(' As compras parceladas do cartão (' + brl(res['parceladas_cartao']) + ') não cobram juros e ficam fora do total.') if res['parceladas_cartao'] else ''}</p>
  <div class="total"><div><span class="rot">Parcelas do mês</span><b>{brl(parcelas_plano)}</b></div><div><span class="rot">Para quitar tudo hoje</span><b>{brl(res["T"])}</b></div></div>
</section>''')

    if rep:
        pags[idx_c:] = dossie(rep, res, r, e, nome_exibicao, inicio)
    confirmar_html = ('<h3 class="peq">Para confirmar</h3><ul class="golpes premissas">' + ''.join(f'<li>{e(x[1])}</li>' for x in original['alertas']) + '</ul>') if original['alertas'] else ''
    prem = [x for x in res['premissas'] if not (rep and ('fim da lista' in x or 'Parcelamento do rotativo' in x or 'fim do contrato' in x))]
    premissas_html = ('<h3 class="peq">O que foi estimado</h3><ul class="golpes premissas" data-flui>' + ''.join(f'<li>{e(x)}</li>' for x in prem) + '</ul>') if prem else ''
    # 11. Apoio e avisos
    pags.append(f'''
<section class="pag fim">
  <p class="secao">Antes de fechar</p>
  <h2>Você não precisa fazer isso sem apoio.</h2>
  <div class="caixa cvv">Se o peso estiver grande demais, você não precisa carregar isso sem ajuda: <b>CVV, ligue 188</b>, 24 horas, gratuito.</div>
  {f'<div class="caixa avaliar"><b>O plano ficou claro?</b> Conte para a gente em 1 minuto: <a href="{e(link_avaliar)}">avaliar o meu plano</a>. A sua resposta ajuda a melhorar o plano de quem vem depois.</div>' if link_avaliar else ''}
  <h3 class="peq">Cuidado com golpes</h3>
  <ul class="golpes">
    <li>Ninguém precisa de taxa antecipada para "limpar seu nome".</li>
    <li>Não pague boleto recebido por mensagem sem conferir no app ou site oficial do credor.</li>
    <li>Nenhum banco ou empresa séria pede sua senha.</li>
  </ul>
  {confirmar_html}
  {premissas_html}
  <p class="aviso">O Desaperto é uma ferramenta educacional. Este plano foi calculado com as informações que você deu em {mes_longo(mes_respostas(inicio))}. Ele não é consultoria financeira, não indica bancos nem produtos de crédito e não garante aprovação ou desconto. Suas respostas são apagadas em até 90 dias.</p>
  <div class="assina">{LOGO}</div>
</section>''')

    css = f'''
@font-face {{ font-family: Archivo; src: url("file://{FONTES}/Archivo.ttf"); font-weight: 100 900; font-stretch: 62% 125%; }}
@font-face {{ font-family: Plex; src: url("file://{FONTES}/IBMPlexMono-Medium.ttf"); font-weight: 500; }}
@font-face {{ font-family: Plex; src: url("file://{FONTES}/IBMPlexMono-SemiBold.ttf"); font-weight: 600; }}
@page {{ size: 108mm 192mm; margin: 0; }}
:root {{ --papel:#F3EFE6; --tinta:#16211C; --verde:#16704A; --respiro:#DCEBE1; --areia:#E7DFD0; --areia-esc:#CFC4AE; --ambar:#9A5B12; --cinza:#5C625E; --branco:#FFFFFF; }}
* {{ box-sizing: border-box; }}
html, body {{ margin: 0; background: var(--papel); color: var(--tinta); font-family: Archivo, sans-serif; font-size: 9.6pt; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
.pag {{ width: 108mm; height: 192mm; padding: 11mm 9mm 10mm; page-break-after: always; break-after: page; display: flex; flex-direction: column; gap: 3.4mm; overflow: hidden; position: relative; }}
.pag:last-child {{ page-break-after: auto; break-after: auto; }}
svg.logo, .topo svg, .assina svg {{ height: 4.4mm; width: auto; color: var(--tinta); }}
.topo svg path, .assina svg path {{ fill: var(--tinta); }}
.topo {{ display: flex; justify-content: space-between; align-items: center; }}
.selo-doc {{ font-family: Plex; font-weight: 600; font-size: 6.6pt; letter-spacing: .12em; text-transform: uppercase; color: var(--verde); border: 1.2px solid var(--verde); border-radius: 99px; padding: 1mm 2.4mm; }}
.secao {{ margin: 0; font-family: Plex; font-weight: 600; font-size: 6.8pt; letter-spacing: .12em; text-transform: uppercase; color: var(--verde); }}
h1, h2, h3 {{ margin: 0; font-weight: 800; letter-spacing: -0.015em; }}
h2 {{ font-size: 15.5pt; line-height: 1.1; }}
h3 {{ font-size: 10pt; line-height: 1.25; }}
p {{ margin: 0; }}
.peq {{ font-size: 7pt; font-family: Plex; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--cinza); margin-top: 1mm; }}
.capa {{ gap: 2.6mm; }}
.capa .acoes-resumo li {{ padding-top: 1.9mm; padding-bottom: 1.9mm; }}
.capa .acoes-resumo li::before {{ top: 1.8mm; }}
.olho {{ margin-top: 2mm; font-size: 11pt; color: var(--cinza); font-weight: 600; }}
.data {{ font-size: 25pt; line-height: 1.02; letter-spacing: -0.03em; }}
.data em {{ font-style: normal; color: var(--verde); }}
.sub {{ font-size: 9pt; color: var(--cinza); }}
.claro {{ display: flex; flex-direction: column; gap: 1.6mm; }}
.claro > div {{ background: var(--branco); border-radius: 2.6mm; padding: 2.4mm 3mm; display: flex; flex-direction: column; gap: .6mm; }}
.claro .rot {{ font-size: 7.6pt; color: var(--cinza); }}
.claro b {{ font-family: Plex; font-weight: 600; font-size: 14pt; letter-spacing: -0.02em; }}
.caixa.avaliar a {{ color: var(--verde); font-weight: 700; }}
.claro b.falta {{ color: var(--ambar); }}
.claro small {{ font-size: 7.4pt; color: var(--cinza); line-height: 1.35; }}
.mes {{ list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1.6mm; }}
.mes > li {{ background: var(--branco); border-radius: 2.6mm; padding: 2.2mm 3mm; display: grid; grid-template-columns: 11mm 1fr; gap: 0 2.4mm; }}
.mes .m {{ font-family: Plex; font-weight: 600; font-size: 7.6pt; color: var(--verde); padding-top: .4mm; }}
.mes .de {{ font-size: 7.2pt; color: var(--cinza); line-height: 1.35; }}
.mes ul {{ list-style: none; margin: .6mm 0 0; padding: 0; display: flex; flex-direction: column; gap: .4mm; }}
.mes ul li {{ font-size: 8.2pt; line-height: 1.35; }}

.mes .marco {{ color: var(--verde); font-weight: 700; }}
.mes > li.alto {{ background: var(--respiro); }}
.mes .vitoria {{ font-size: 8pt; line-height: 1.35; margin-bottom: .8mm; color: var(--tinta); }}
.mes .vitoria b {{ display: block; font-size: 11pt; font-weight: 800; font-stretch: 80%; letter-spacing: -0.01em; color: var(--verde); }}
.mes .ck {{ display: block; width: 3.4mm; height: 3.4mm; border: 1.2px solid var(--areia-esc); border-radius: .8mm; margin-top: 1.4mm; background: var(--branco); }}
.mes .prog {{ display: flex; align-items: center; gap: 1.8mm; margin-top: 1.2mm; font-family: Plex; font-weight: 500; font-size: 6.2pt; color: var(--cinza); }}
.mes .prog .barra {{ flex: none; width: 13mm; height: 1.4mm; border-radius: 99px; background: var(--areia); overflow: hidden; }}
.mes .prog .barra i {{ display: block; height: 100%; background: var(--verde); border-radius: 99px; }}
.mes .subiu {{ font-size: 7.2pt; color: var(--verde); font-weight: 600; line-height: 1.35; margin-top: .4mm; }}
.mes ul li b {{ font-family: Plex; font-weight: 600; }}
.tira {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.6mm; }}
.tira > div, .tres .n {{ background: var(--branco); border-radius: 2.6mm; padding: 2.4mm 2.6mm; display: flex; flex-direction: column; gap: .6mm; }}
.rot {{ font-size: 6.6pt; color: var(--cinza); font-weight: 600; line-height: 1.2; }}
b {{ font-weight: 800; }}
.tira b, .tres b, .compara b, .total b {{ font-family: Plex; font-weight: 600; font-size: 11pt; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }}
.acoes-resumo {{ list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1.6mm; counter-reset: a; }}
.acoes-resumo li {{ counter-increment: a; background: var(--branco); border-radius: 2.6mm; padding: 2.4mm 3mm 2.4mm 9mm; position: relative; display: flex; flex-direction: column; }}
.acoes-resumo li::before, .acoes li::before {{ content: counter(a); position: absolute; left: 2.6mm; top: 2.3mm; width: 4.4mm; height: 4.4mm; border-radius: 50%; background: var(--verde); color: var(--branco); font-size: 7pt; font-weight: 800; display: flex; align-items: center; justify-content: center; }}
.acoes-resumo span {{ font-weight: 700; font-size: 9.2pt; line-height: 1.25; }}
.acoes-resumo small, .acoes small {{ font-family: Plex; font-size: 6.4pt; color: var(--verde); font-weight: 600; letter-spacing: .04em; }}
.rodape, .nota {{ font-size: 7.6pt; color: var(--cinza); }}
.capa .rodape {{ margin-top: auto; }}
.tres {{ display: flex; flex-direction: column; gap: 1.6mm; }}
.tres .n {{ flex-direction: row; align-items: baseline; flex-wrap: wrap; column-gap: 2mm; }}
.tres .n .rot {{ width: 100%; }}
.tres .n b {{ font-size: 15pt; }}
.tres .n small {{ font-size: 7.4pt; color: var(--cinza); }}
.tres .destaque {{ background: var(--tinta); color: var(--papel); }}
.tres .destaque .rot, .tres .destaque small {{ color: #C9CFC9; }}
.compara {{ display: grid; grid-template-columns: 1fr 1fr; gap: 1.6mm; }}
.compara > div {{ border-radius: 2.6mm; padding: 2.4mm 2.6mm; display: flex; flex-direction: column; gap: .8mm; background: var(--respiro); }}
.compara > div:first-child {{ background: var(--areia); }}
.cinza {{ color: var(--cinza); }}
.acoes {{ list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2.2mm; counter-reset: a; }}
.acoes li {{ counter-increment: a; background: var(--branco); border-radius: 2.6mm; padding: 2.6mm 3mm 3mm 9mm; position: relative; display: flex; flex-direction: column; gap: .8mm; }}
.acoes p {{ font-size: 8.4pt; }}
.caixa {{ background: var(--respiro); border-radius: 2.6mm; padding: 2.8mm 3mm; font-size: 8.4pt; }}
.ajustes {{ list-style: none; margin: 1.6mm 0; padding: 0; display: flex; flex-direction: column; gap: .6mm; }}
.ajustes li {{ display: flex; justify-content: space-between; font-family: Plex; font-size: 7.8pt; font-weight: 500; }}
.ordem {{ list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1.8mm; }}
.ordem li {{ display: flex; gap: 2.6mm; background: var(--branco); border-radius: 2.6mm; padding: 2.4mm 3mm; }}
.pos {{ flex: none; width: 5.4mm; height: 5.4mm; border-radius: 50%; background: var(--tinta); color: var(--papel); font-family: Plex; font-weight: 600; font-size: 7.6pt; display: flex; align-items: center; justify-content: center; }}
.pos.fora {{ background: var(--areia-esc); }}
.ordem h3 small, .cred {{ font-weight: 500; color: var(--cinza); font-size: 7.6pt; }}
.ordem p {{ font-size: 8.1pt; }}
.quando {{ font-family: Plex; font-size: 7pt; font-weight: 600; color: var(--verde); margin-top: .6mm !important; }}
.grafico {{ width: 100%; height: auto; }}
.grafico .eixo {{ font-family: Plex; font-size: 6.4px; fill: var(--cinza); }}
.grafico .valor {{ font-family: Plex; font-size: 7px; font-weight: 600; fill: var(--tinta); }}
.marcos {{ list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }}
.marcos li {{ display: flex; gap: 3mm; padding: 1.5mm 0; border-bottom: 1px solid var(--areia); font-size: 8.4pt; }}
.marcos span {{ font-family: Plex; font-weight: 600; font-size: 7.6pt; color: var(--verde); width: 12mm; flex: none; }}
.passos {{ margin: 0; padding-left: 4.4mm; display: flex; flex-direction: column; gap: 1.6mm; font-size: 8.4pt; }}
.direitos, .regras, .golpes {{ list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2mm; }}
.direitos li, .regras li {{ background: var(--branco); border-radius: 2.6mm; padding: 2.4mm 3mm; display: flex; flex-direction: column; gap: .6mm; }}
.direitos p, .regras p {{ font-size: 8.2pt; }}
.golpes li {{ font-size: 8.4pt; padding-left: 3.4mm; position: relative; }}
.golpes li::before {{ content: ""; position: absolute; left: 0; top: 1.7mm; width: 1.4mm; height: 1.4mm; border-radius: 50%; background: var(--ambar); }}
.dcards {{ display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1.6mm; }}
.dcard {{ background: var(--branco); border-radius: 2.6mm; padding: 2.2mm 2.4mm; display: flex; gap: 1.8mm; }}
.dcard .pos {{ width: 4.6mm; height: 4.6mm; font-size: 6.6pt; }}
.dc-corpo {{ flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .5mm; }}
.dcard h3 {{ font-size: 8pt; line-height: 1.15; }}
.dcard .cred {{ font-size: 6.6pt; }}
.dcard dl {{ margin: .8mm 0 0; display: grid; grid-template-columns: auto 1fr; gap: .3mm 1.6mm; font-size: 6.6pt; }}
.dcard dt {{ color: var(--cinza); }}
.dcard dd {{ margin: 0; text-align: right; font-family: Plex; font-weight: 600; white-space: nowrap; }}
.dcard dt {{ white-space: nowrap; }}
.quitada {{ margin-top: 1mm !important; font-size: 6.4pt; color: var(--cinza); border-top: 1px dashed var(--areia-esc); padding-top: 1mm; }}
.total {{ display: grid; grid-template-columns: 1fr 1fr; gap: 1.6mm; margin-top: auto; }}
.total > div {{ background: var(--tinta); color: var(--papel); border-radius: 2.6mm; padding: 2.4mm 2.6mm; display: flex; flex-direction: column; gap: .6mm; }}
.total .rot {{ color: #C9CFC9; }}
.cvv {{ font-size: 9pt; }}
.aviso {{ font-size: 7pt; color: var(--cinza); margin-top: auto; }}
.assina {{ display: flex; justify-content: flex-start; }}
.tab {{ width: 100%; border-collapse: collapse; font-size: 7.4pt; background: var(--branco); border-radius: 2.6mm; overflow: hidden; }}
.tab th {{ text-align: left; font-weight: 700; font-size: 6.6pt; color: var(--cinza); padding: 1.6mm 2mm; border-bottom: 1px solid var(--areia); }}
.tab td {{ padding: 1.3mm 2mm; border-bottom: 1px solid var(--papel); }}
.tab .n {{ text-align: right; font-family: Plex; font-weight: 500; white-space: nowrap; }}
.tab td {{ vertical-align: top; }}
.tab tr.tot td {{ font-weight: 800; border-bottom: 0; background: var(--respiro); }}
.ficha {{ margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 1mm 3mm; background: var(--branco); border-radius: 2.6mm; padding: 2.4mm 3mm; font-size: 8pt; }}
.ficha dt {{ color: var(--cinza); }}
.ficha dd {{ margin: 0; font-weight: 600; }}
.enq {{ margin: 1.2mm 0 0; padding-left: 4mm; display: flex; flex-direction: column; gap: .8mm; }}
'''
    doc = f'<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Plano de desaperto · {e(nome)}</title><style>{css}</style></head><body>{"".join(pags)}{PAGINAR}</body></html>'
    return doc, res, cons


if __name__ == '__main__':
    import importlib
    r = json.load(open(sys.argv[1]))
    textos = importlib.import_module(sys.argv[3]).textos
    doc, res, cons = montar(r, textos)
    open(sys.argv[2], 'w').write(doc)
    print('ok', res['saida'], cons['saida'])
