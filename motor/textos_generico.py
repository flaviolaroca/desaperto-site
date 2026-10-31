"""Textos gerados por regra, para qualquer caso (o papel que a IA vai cumprir na versão automática).

Cada frase sai dos números do motor. Nada aqui decide a ordem ou muda valores: só descreve o que o motor calculou.
"""

CAUSA_FRASE = {
    'Perdi renda ou o emprego': 'a perda de renda',
    'Problema de saúde (meu ou da família)': 'um problema de saúde',
    'Separação ou mudança na família': 'uma separação ou mudança na família',
    'Ajudei alguém da família': 'a ajuda a alguém da família',
    'Emprestei meu nome ou meu cartão': 'o nome ou o cartão emprestado',
    'Apostas ou jogos online': 'as apostas',
    'Fui gastando mais do que ganhava, aos poucos': 'o gasto que foi passando do que entra, aos poucos',
    'Não sei dizer, foi acontecendo': 'uma soma de coisas que foi acontecendo',
}


def textos(c):
    res, r, e, brl, motor, ml = c['res'], c['r'], c['e'], c['brl'], c['motor'], c['mes_longo']
    hoje = c.get('original') or res  # a situação de hoje (antes de qualquer cenário)
    fila, plano, nome_ex = c['fila'], c['plano'], c['nome_exibicao']
    pct = motor.fmt_pct
    cv = c.get('cenario')

    def rotulo(d):
        t, cred = nome_ex(d)
        return f'{t.lower()} {cred}'

    # ---------- primeira semana (Etapa 7) ----------
    cands = []  # (titulo, tempo, texto, exige_negociacao)
    for d in fila:
        if d['banda'] == 'P0' and d['sub'] == 'em_atraso':
            t, cred = nome_ex({**d, 'sub': 'parcelada'})
            m0 = (res['meses'][0]['ano'], res['meses'][0]['mes'])
            confirma = '' if d.get('informado') else ' Antes, confira no app o valor exato: o plano usou uma estimativa.'
            if d.get('quitada_em') == m0:
                txt = f'No app ou site do {e(cred)}, pague as {d["qtd_atr"]} parcelas atrasadas ({brl(d["saldo"])}) e a parcela deste mês. Assim seu nome não vai para o Serasa e a multa para de crescer.{confirma}'
            else:
                txt = f'Pague a parcela deste mês para o atraso não aumentar. As {d["qtd_atr"]} atrasadas ({brl(d["saldo"])}) entram até {ml(d["quitada_em"])}, como mostra a página "Mês a mês". Pague primeiro a mais antiga.{confirma}'
            cands.append((f'Ponha em dia: {t.lower()} ({cred})', 'Esta semana · 15 minutos', txt, False))
            continue
        if d['banda'] == 'P0':
            t, cred = nome_ex(d)
            paga_ja = d.get('quitada_em') == (res['meses'][0]['ano'], res['meses'][0]['mes'])
            cands.append((f'Coloque em dia: {t.lower()} ({cred})', 'Esta semana · 20 minutos',
                          (f'Essa conta vem antes de qualquer outra dívida, até da reserva. Pague os {brl(d["saldo"])} em atraso este mês, pelo app ou site de quem cobra. Assim você evita o corte.' if paga_ja else
                           f'Essa conta vem antes de qualquer outra dívida. Entre no app de quem cobra e peça para parcelar os {brl(d["saldo"])} em atraso: o plano já separa o dinheiro para isso. Assim você evita o corte.'), not paga_ja))
    for d in plano:
        if d.get('prorrogado'):
            t, cred = nome_ex(d)
            cands.append((f'Peça para passar as parcelas atrasadas para o fim ({cred})', 'Esta semana · 30 minutos',
                          f'Hoje não dá para pagar as {d["prorrogado"]} parcelas atrasadas de uma vez. No chat ou telefone do {e(cred)}, diga: "Quero regularizar meu contrato. Não consigo pagar as parcelas atrasadas juntas. Vocês podem passar essas parcelas para o fim do contrato?" Alguns bancos chamam isso de prorrogação ou pausa nas parcelas. Peça a confirmação por escrito e, a partir daí, pague a parcela de {brl(d["parcela"])} todo mês. Se recusarem, peça para parcelar só o atraso.', True))
    if cv:
        cands.append(('Decida sobre o carro', 'Esta semana · 1 hora',
                      f'Veja a página "A decisão do carro". Vendendo, sobram cerca de {brl(cv["liquido"])} depois de quitar o financiamento, e a parcela de {brl(cv["parcela_liberada"])} deixa de existir. A decisão é sua: o plano mostra os dois caminhos.', False))
    ativas = [x for x in (r.get('ainda') or []) if x != 'Nenhuma, já passou']
    if any(x in ativas for x in ('Apostas ou jogos online', 'Fui gastando mais do que ganhava, aos poucos', 'Emprestei meu nome ou meu cartão')):
        cart = next((x for x in (r.get('dividas') or []) if x.get('tipo') == 'Cartão de crédito' and x.get('c_limite')), None)
        if cart:
            alvo = max(300, round(sum((r.get('gastos') or {}).get(k, 0) for k in ['mercado', 'delivery', 'pessoal']) / 100) * 100)
            cands.append((f'Baixe o limite do cartão para {brl(alvo)}', 'Hoje · 5 minutos',
                          f'No app do {e(cart.get("credor") or "cartão")}, procure "ajustar limite". Hoje ele é de {brl(cart["c_limite"])}. Um limite perto do que você gasta no mês evita que a dívida volte a crescer enquanto você paga.', False))
    acordos = [d for d in fila if d.get('acordo_oferta')]
    if acordos:
        cands.append(('Veja as propostas de acordo das dívidas antigas', 'Hoje · 15 minutos',
                      'No app do Serasa e no site de quem cobra, veja se já existe proposta para ' + ', '.join(e(d['credor']) for d in acordos[:3]) + '. Só olhe e anote os valores: o plano diz quanto oferecer e quando.', False))
    rotp = next((d for d in plano if d['sub'] == 'parcelamento_formal'), None)
    if rotp:
        cands.append(('Parcele o que ficou sem pagar da fatura', 'Hoje · 10 minutos',
                      f'No app do {e(rotp["credor"])}, use a opção "parcelar fatura". O valor em aberto deixa de pagar os juros do rotativo e vira {rotp["restam"]} parcelas de {brl(rotp["parcela"])}.', False))
    for d in plano:
        if d.get('parcelamento_oficial'):
            cands.append((f'Parcele o imposto atrasado ({d["credor"].replace(" · parcelado", "")})', 'Esta semana · 30 minutos',
                          f'No portal do Simples Nacional ou da Receita, peça o parcelamento dos {brl(d["saldo"])} em até 60 vezes. A parcela fica perto de {brl(d["parcela"])} e o nome do CNPJ volta a ficar regular.', False))
    dia = r.get('diaPag')
    if dia:
        cedo = [x for x in (r.get('dividas') or []) if (x.get('e_venc') or x.get('c_venc')) and 0 < ((dia - (x.get('e_venc') or x.get('c_venc'))) % 31) <= 7 and x.get('s_status') == 'Em dia']
        if cedo:
            nomes = ', '.join(f'{x.get("credor")} (dia {x.get("e_venc") or x.get("c_venc")})' for x in cedo[:2])
            cands.append((f'Mude {"o vencimento" if len(cedo) == 1 else "vencimentos"} para depois do dia {dia}', 'Hoje · 10 minutos',
                          f'{nomes} {"vence" if len(cedo) == 1 else "vencem"} antes de o salário cair, no dia {dia}. Peça no app ou ao banco para mudar para 2 a 5 dias depois do pagamento. Assim o dinheiro chega antes da conta.', False))
    debitos = [x for x in (r.get('dividas') or []) if (x.get('credor') == r.get('banco')) and (x.get('tipo') == 'Cheque especial' or x.get('e_debito') == 'Sim')]
    if debitos and r.get('banco'):
        cands.append(('Leve seu salário para outra conta', 'Esta semana · 15 minutos',
                      f'Seu salário cai no {e(r["banco"])}, o mesmo banco que cobra {"o cheque especial e " if any(x.get("tipo") == "Cheque especial" for x in debitos) else ""}parcelas no débito automático. Peça a portabilidade de salário em outro banco: é um direito, não custa nada, e você passa a decidir a ordem dos pagamentos.', False))
    for d in fila:
        if d['banda'] == 'P5':
            cands.append((f'Confira a taxa de juros: {rotulo(d)}', 'Hoje · 10 minutos',
                          'No app ou no contrato, procure "taxa de juros" ao mês. Ela decide se vale adiantar essa dívida ou se ela fica por último.', False))
            break
    if (r.get('margem_naoSei') or not r.get('margem')) and r.get('trabalho') in ('Carteira assinada (CLT)', 'Servidor público', 'Aposentado ou pensionista do INSS'):
        cands.append(('Confira quanto do salário pode ter desconto em folha', 'Hoje · 10 minutos',
                      'No app Carteira de Trabalho Digital (ou Meu INSS), veja a "margem consignável". Se houver margem, trocar a dívida mais cara por consignado pode baixar muito os juros.', False))
    rep = c.get('rep')
    if rep:
        # conta não fecha: só o que protege a pessoa e leva à renegociação. Nada de parcelar o rotativo, confirmar taxas ou consignado.
        rc = []
        for x in rep['essenciais']:
            t, cred = nome_ex(x['d'])
            rc.append((f'Parcele a {t.lower()} ({cred})', 'Esta semana · 20 minutos',
                       f'No app ou atendimento de quem cobra, peça para parcelar os {brl(x["saldo"])} em atraso em até 6 vezes, cerca de {brl(x["mensal"])} por mês. Ela vem antes de qualquer dívida: assim você evita o corte.', False))
        rc.append(('Peça a renegociação de todas as dívidas', 'Esta semana · 1 hora',
                   'Leve as páginas "Dossiê" ao Procon, à Defensoria Pública ou ao centro de conciliação (Cejusc) da sua cidade e peça a repactuação pela Lei do Superendividamento. É gratuito. O passo a passo está na página "Como pedir".', False))
        rc += [x for x in cands if x[0] == 'Leve seu salário para outra conta']
        if rep['proposta']:
            rc.append(('Separe o dinheiro da proposta', 'Hoje · 10 minutos',
                       f'Crie uma "caixinha" ou conta separada, sem cartão. A partir do próximo salário, guarde ali {brl(rep["parcela"])} por mês. Esse dinheiro mostra na audiência que a proposta cabe.', False))
        cands = rc
    acoes, neg = [], 0
    for t, tempo, txt, exige in cands:
        if exige and neg:
            continue
        neg += 1 if exige else 0
        acoes.append((tempo, t, txt))
        if len(acoes) == 3:
            break
    if not any(a[0].startswith('Hoje') for a in acoes) and len(cands) > 3:
        rapida = next((x for x in cands if x[1].startswith('Hoje') and (x[1], x[0], x[2]) not in acoes), None)
        if rapida:
            acoes[-1] = (rapida[1], rapida[0], rapida[2])

    # ---------- raio-x ----------
    ds = hoje['dividas_hoje']
    maiores = [d for d in sorted(ds, key=lambda d: -d['saldo'] * d['taxa']) if d['saldo'] * d['taxa'] > 1][:2]
    rx = f'Todo mês, {brl(hoje["J"])} vão embora em juros, cerca de {brl(hoje["J"] / 30)} por dia.'
    if maiores:
        rx += ' O maior pedaço vem ' + ' e '.join(f'do {rotulo(d)} ({brl(d["saldo"] * d["taxa"])} por mês)' for d in maiores) + '.'
    rot = next((d for d in ds if d['sub'] == 'rotativo'), None)
    if rot and rot.get('pago_hoje'):
        j = rot['saldo'] * rot['taxa']
        rx += f' No cartão, pagar {brl(rot["pago_hoje"])} cobre {brl(j)} de juros e abate só {brl(max(0, rot["pago_hoje"] - j))} da dívida.'
    desc = sum(d['parcela'] for d in ds if d.get('descontado'))
    if desc:
        rx += f' E {brl(desc)} de consignado já saem do salário antes de ele cair na conta.'

    # ---------- como chegou ----------
    causas = r.get('causas') or []
    frases = [CAUSA_FRASE.get(x) for x in causas if CAUSA_FRASE.get(x)]
    ativas_txt = [CAUSA_FRASE.get(x) for x in ativas if CAUSA_FRASE.get(x)]
    chegou = []
    if frases:
        chegou.append(f'Você contou que tudo começou com {" e ".join(frases)}. É o caminho de muita gente: a vida aperta e a diferença vai para o crédito.')
    perfis = hoje['perfis']
    if 'A conta não fecha' in perfis:
        chegou.append(f'Hoje, o que entra não cobre as contas da casa e as parcelas ao mesmo tempo: faltam cerca de {brl(hoje["diferenca"])} por mês, mesmo com os ajustes. Por isso o plano começa por uma decisão maior, e não por cortes pequenos.')
    if 'Bola de neve dos juros' in perfis:
        chegou.append('O que fez a dívida crescer foi uma sequência que se repete: falta no fim do mês, entra o cartão ou o cheque especial, e os juros mais caros que existem fazem cada mês começar um pouco pior.')
    if 'Nome sujo antigo' in perfis:
        chegou.append('Parte das dívidas está atrasada e já sujou seu nome. Isso também é uma oportunidade: dívida antiga costuma aceitar acordo com bom desconto.')
    if ativas_txt:
        chegou.append(f'Uma das causas ainda acontece ({", ".join(ativas_txt)}). Por isso o plano começa fechando essa porta, antes de pagar a mais.')
    elif frases and c.get('rep'):
        chegou.append('As causas já passaram, mas deixaram parcelas maiores do que a renda. Cortar mais não fecha essa conta: a saída é renegociar tudo junto, numa parcela que cabe.')
    elif frases:
        chegou.append('As causas já passaram. O plano é de conta: uma dívida de cada vez, na ordem certa, e a parcela que acaba vai para a próxima.')

    # ---------- motivos da ordem ----------
    # Cada item diz quanto cobra (comparado com as outras), quando começa a receber o dinheiro a mais e quando acaba.
    # Assim nenhuma linha se repete, mesmo com várias dívidas parecidas.
    meses_res = res.get('meses') or []
    inicio_plano = (meses_res[0]['ano'], meses_res[0]['mes']) if meses_res else None
    com_juro = [x for x in fila if x['banda'] != 'P5' and (x.get('taxa') or 0) > 0 and not x.get('grupo_atraso')]
    ultima_juro = com_juro[-1]['nome'] if len(com_juro) > 1 else None

    def anterior(d):
        i = next(k for k, x in enumerate(fila) if x['nome'] == d['nome'])
        return fila[i - 1] if i > 0 else None

    def inicio_extra(d):
        return next(((m['ano'], m['mes']) for m in meses_res if (m.get('extras') or {}).get(d['nome'], 0) >= 1), None)

    def juro_comparado(d):
        ant = anterior(d)
        if d['nome'] == ultima_juro:
            return f'Cobra {pct(d["taxa"])} ao mês, a mais barata da lista. Por isso fica por último.'
        if ant is not None and (ant.get('taxa') or 0) > 0 and not ant.get('grupo_atraso') and abs(ant['taxa'] - d['taxa']) < 0.0035:
            return f'Cobra {pct(d["taxa"])} ao mês, quase o mesmo que a anterior.'
        return f'Cobra {pct(d["taxa"])} ao mês.'

    def quando_txt(d):
        ini, fim = inicio_extra(d), d.get('quitada_em')
        ant = anterior(d)
        fim_txt = f' Acaba em {ml(fim)}.' if fim else ''
        if cv:
            return ('Quitada com o dinheiro da venda.' if ini == inicio_plano else '') + ('' if ini == inicio_plano else fim_txt.strip())
        if ini is None:
            return f'Não precisa de dinheiro a mais: só com as parcelas, acaba sozinha em {ml(fim)}.' if fim else 'Segue só com as parcelas normais.'
        if ini == inicio_plano:
            antes = [x for x in fila[:fila.index(d)] if inicio_extra(x) == inicio_plano]
            return ('Também recebe dinheiro a mais já no primeiro mês.' if antes else 'É a primeira a receber o que sobra, já no primeiro mês.') + fim_txt
        if d['nome'] == ultima_juro:
            return f'Até {ml(ini)}, você paga só a parcela normal.' + fim_txt
        if ant is not None and ant.get('quitada_em') == ini:
            return f'Entra em {ml(ini)}, quando a de cima acaba.' + fim_txt
        return f'A partir de {ml(ini)}, o que sobrar vai para ela.' + fim_txt

    motivos = {}
    for d in fila:
        if d['sub'] == 'em_atraso':
            motivos[d['nome']] = f'{d["qtd_atr"]} parcelas atrasadas há pouco tempo. Pôr em dia agora custa {brl(d["saldo"])}, evita que seu nome vá para o Serasa e para a multa de crescer. Depois, sobra só a parcela de todo mês.'
        elif d['banda'] == 'P0':
            motivos[d['nome']] = 'Conta essencial atrasada: vem antes de tudo, para evitar corte, despejo ou cobrança mais dura.'
        elif d.get('grupo_atraso'):
            if d.get('acordo_oferta'):
                motivos[d['nome']] = f'Atrasada. Dívida antiga aceita desconto: a proposta é pagar {brl(d["acordo_oferta"])} de uma vez, em vez de {brl(d["saldo"])}.' + (' Ela limpa seu nome.' if d['negativada'] else '')
            else:
                motivos[d['nome']] = 'Atrasada há pouco tempo. Colocar em dia logo evita que vá para o Serasa e que os encargos cresçam.'
        elif d.get('recente'):
            motivos[d['nome']] = f'Atrasada há pouco tempo: os juros do contrato continuam correndo, mais a multa (cerca de {pct(d["taxa"])} ao mês). Pagar logo evita que seu nome vá para o Serasa.'
        elif d['sub'] == 'parcelamento_formal':
            mais_cara = all((x.get('taxa') or 0) <= d['taxa'] for x in fila if not x.get('grupo_atraso') and x['sub'] != 'em_atraso' and x['banda'] not in ('P0', 'P5'))
            motivos[d['nome']] = f'O que ficou sem pagar da fatura, já parcelado: {pct(d["taxa"])} ao mês.' + (' Entre as que estão em dia, é a mais cara.' if mais_cara else '')
        elif d['sub'] == 'cheque':
            motivos[d['nome']] = f'Cobra {pct(d["taxa"])} ao mês, perto do máximo que a lei permite.'
        elif d['banda'] == 'P5':
            if not any(x['banda'] == 'P5' for x in fila[:fila.index(d)]):
                motivos[d['nome']] = 'Ainda não sabemos quanto você economiza adiantando essa dívida. Ela fica no fim até você confirmar o juro ou o valor para quitar. Se o juro for alto, ela sobe na fila.'
            else:
                motivos[d['nome']] = f'Também falta saber o juro desta. Confira no app do {e(d["credor"])}: se for alto, ela sobe na fila.'
        elif d.get('parcelamento_oficial'):
            motivos[d['nome']] = 'Imposto parcelado em até 60 vezes, com juros perto de 1% ao mês. É a mais barata: fica por último.'
        else:
            motivos[d['nome']] = juro_comparado(d)
        if d['banda'] not in ('P0', 'P5') and not d.get('grupo_atraso') and d['sub'] != 'em_atraso' and not d.get('parcelamento_oficial'):
            motivos[d['nome']] += ' ' + quando_txt(d)
        if d.get('prorrogado'):
            motivos[d['nome']] += f' As {d["prorrogado"]} parcelas atrasadas vão para o fim do contrato, se o banco aceitar.'

    # ---------- direitos que se aplicam ----------
    direitos = []
    if any(d['sub'] in ('parcelada', 'parcelamento', 'parcelamento_formal') and not d.get('parcelamento_oficial') for d in plano):
        direitos.append(('Desconto ao adiantar parcelas', 'Ao pagar parcelas antes do prazo, os juros futuros saem da conta (Código de Defesa do Consumidor, art. 52). É por isso que cada real extra rende mais do que parece.'))
    if rot:
        direitos.append(('O juro do cartão tem limite', 'O valor da fatura que fica sem pagar só pode ficar no rotativo até a fatura seguinte. Depois o banco precisa oferecer parcelamento. E, somando juros e multas, o rotativo nunca pode cobrar mais do que o valor que ficou devendo.'))
    if any(d['sub'] == 'cheque' for d in ds):
        direitos.append(('Cheque especial tem teto', 'Os juros do cheque especial não podem passar de 8% ao mês. Se vier acima disso, reclame no banco e, sem solução, no Banco Central.'))
    if any(d['negativada'] for d in ds):
        direitos.append(('Nome limpo em até 5 dias úteis', 'Depois que você paga um acordo, a empresa tem até 5 dias úteis para tirar seu nome do Serasa e do SPC. Se não tirar, reclame no Procon com o comprovante.'))
    if any(d['banda'] == 'P0' for d in fila):
        direitos.append(('Aviso antes do corte', 'A empresa de luz, água ou gás precisa avisar com antecedência antes de cortar por atraso. Ao receber o aviso, peça o parcelamento: costuma ser aceito.'))
    if hoje.get('superendividamento'):
        direitos.append(('Renegociar todas as dívidas juntas', 'Quando a renda não cobre o básico e as parcelas, a Lei do Superendividamento (Lei 14.181/2021) permite renegociar todas as dívidas de uma vez, preservando o mínimo para viver. O pedido é feito no Procon, na Defensoria Pública ou no centro de conciliação do Tribunal de Justiça.'))
    if debitos:
        direitos.append(('Levar o salário para outro banco', 'Você pode receber o salário em outro banco, sem custo e sem pedir nada à empresa onde trabalha. O pedido é feito no banco novo.'))
    if rep:
        lei = [x for x in direitos if x[0] == 'Renegociar todas as dívidas juntas']
        direitos = lei + [('Credor que falta perde a vez', 'Se um credor faltar à audiência sem justificativa, a cobrança dele fica suspensa, os juros de atraso param e ele só recebe depois dos outros (Código de Defesa do Consumidor, art. 104-A).'),
                          ('O mínimo para viver vem antes', 'Nenhum plano de pagamento pode tirar o que você precisa para moradia, comida e contas básicas. Por isso a proposta parte do seu orçamento, e não do que os credores pedem.')] + [x for x in direitos if x[0] != 'Renegociar todas as dívidas juntas' and x[0] != 'Desconto ao adiantar parcelas']
    direitos = direitos[:4]

    # ---------- regras ----------
    regras = [
        ('Faltou dinheiro num mês', 'Use a reserva para imprevistos, nunca o cheque especial ou o mínimo do cartão. Pague as parcelas e pule o valor extra daquele mês.'),
        ('Entrou um dinheiro a mais', 'Vai inteiro para a dívida que está sendo paga naquele mês, a que aparece na página "Mês a mês". Se a reserva estiver incompleta, complete-a primeiro.'),
        ('O cartão continua ativo', 'Use só para o que já está no orçamento, com limite perto do que você gasta no mês.'),
    ]
    if 'Apostas ou jogos online' in causas:
        regras.append(('Se a vontade de apostar voltar', 'Peça a autoexclusão nas plataformas e procure apoio gratuito, como os Jogadores Anônimos. Não é falha: é proteger o que você já conquistou.'))
    else:
        regras.append(('Ofereceram um empréstimo para "juntar as dívidas"', 'Só vale se os juros forem menores que os das dívidas que ele paga e se você baixar o limite do cartão no mesmo dia.'))

    if rep:
        regras = [
            ('Faltou dinheiro num mês', 'Pague primeiro casa, comida e contas. Use o dinheiro guardado da proposta só em último caso e conte isso no atendimento.'),
            ('Um credor ligou oferecendo acordo', 'Pode ouvir, mas não feche sozinho uma parcela que não cabe. Diga que pediu a renegociação de todas as dívidas e onde.'),
            ('Entrou um dinheiro a mais', 'Guarde junto com o dinheiro da proposta. Na audiência, ele pode virar uma entrada e encurtar o plano.'),
            ('Ofereceram um empréstimo para "juntar as dívidas"', 'Não aceite agora. Dívida nova piora a situação e pode tirar você do acordo.'),
        ]
    n_aj = len(res['ajustes'])
    app = c.get('app')
    out = {
        'acoes': acoes,
        'titulo_semana': 'Três passos para esta semana.' if len(acoes) == 3 else 'Os passos desta semana.',
        'raiox': rx,
        'chegou_titulo': 'O que aconteceu e o que fazer com isso.',
        'chegou': chegou or ['O plano parte dos números que você informou: uma dívida de cada vez, na ordem certa.'],
        'ajustes_ini': {0: 'nenhum ajuste: seus gastos ajustáveis já estão no mínimo.', 1: 'um ajuste pequeno, num gasto que você não marcou como intocável.', 2: 'dois ajustes pequenos, em gastos que você não marcou como intocáveis.'}.get(n_aj, f'{n_aj} ajustes pequenos, em gastos que você não marcou como intocáveis.'),
        'ajustes_fim': ('Ficam como estão: ' + ', '.join(x.lower() for x in (r.get('protegidos') or [])) + ', como você pediu.') if r.get('protegidos') else '',
        'motivos': motivos,
        'direitos': direitos,
        'regras': regras,
    }
    if app:
        quitado = app.get('quitada_em')
        out['negocia_quando'] = f'em {ml(quitado)}, quando você tiver juntado {brl(app["acordo_oferta"])}.' if quitado else 'quando você tiver o valor da proposta.'
        if app.get('proposta_valor'):
            out['negocia_intro'] = f'<p>Eles já ofereceram {brl(app["proposta_valor"])}. Isso mostra que aceitam desconto. Comece abaixo da proposta deles e nunca aceite mais do que ela.</p>'
    return out
