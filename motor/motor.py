"""Desaperto — motor v0 (Método v1.1).

Conta é código: todo número do plano sai daqui. A IA só escreve texto a partir do resumo.
Cobre as Etapas 1 a 7 para os casos mais comuns. Ainda não simula L3 (troca por consignado),
L6 a L8: quando se aplicam, viram alerta e ação, não cálculo.
"""
import json, math, sys
from datetime import date

# ---------------- parâmetros (Método: Parâmetros e taxas de referência) ----------------
REF = {
    'rotativo': 0.1522, 'Cheque especial': 0.0792, 'Empréstimo em app ou financeira': 0.0727,
    'Crediário ou carnê de loja': 0.0544, 'Empréstimo pessoal no banco': 0.0402,
    'Consignado': 0.032, 'Financiamento de veículo': 0.0212, 'Financiamento de imóvel': 0.0110,
    'Antecipação do FGTS': 0.0180, 'parcelamento_fatura': 0.0727, 'atraso': 0.01,
}
EXPLOSIVO = 0.08
BARATA = 0.03
COLCHAO_FIXA, COLCHAO_VAR = 0.25, 0.50
DIV_P1, DIV_COLCHAO = 0.80, 0.20
ACORDO = {'3 a 12 meses': (0.50, 0.70), '1 a 3 anos': (0.30, 0.50), '3 a 5 anos': (0.20, 0.35)}
HORIZONTE = 60
PARC_FORMAL_MESES = 12      # L1: parcelamento formal do rotativo e do cheque especial
META_L2 = {'apostas': 1.0, 'delivery': 0.40, 'pessoal': 0.40, 'outros': 0.40, 'assinaturas': 0.50}
ESSENCIAL = ['moradia', 'contas', 'mercado', 'transporte', 'saude', 'educacao']
AJUSTAVEL = ['delivery', 'pessoal', 'assinaturas', 'apostas', 'familia', 'outros']
NOME_GASTO = {'moradia': 'Moradia', 'contas': 'Contas da casa', 'mercado': 'Mercado', 'delivery': 'Delivery, lanches e restaurante',
              'transporte': 'Transporte', 'educacao': 'Educação e filhos', 'saude': 'Saúde', 'pessoal': 'Pessoal e roupas',
              'assinaturas': 'Assinaturas', 'familia': 'Ajuda a familiares', 'apostas': 'Apostas e jogos online', 'outros': 'Outros'}
MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
PARCELADAS = ['Empréstimo pessoal no banco', 'Empréstimo em app ou financeira', 'Consignado', 'Financiamento de veículo',
              'Financiamento de imóvel', 'Crediário ou carnê de loja', 'Antecipação do FGTS']


def pv(P, i, n):
    return P * n if i == 0 else P * (1 - (1 + i) ** -n) / i


def pmt(S, i, n):
    return S / n if i == 0 else S * i / (1 - (1 + i) ** -n)


def taxa_implicita(P, n, S):
    """Resolve S = P·(1 − (1+i)^−n)/i. Devolve None se não houver taxa positiva."""
    if not (P and n and S) or P * n <= S:
        return None
    lo, hi = 1e-7, 1.0
    for _ in range(200):
        m = (lo + hi) / 2
        if pv(P, m, n) > S:
            lo = m
        else:
            hi = m
    return (lo + hi) / 2


def pct(v):
    if v in (None, ''):
        return None
    try:
        x = float(str(v).replace('%', '').replace(',', '.').split()[0])
    except ValueError:
        return None
    return x / 100 if x > 0 else None


def valor_texto(t):
    if not t:
        return None
    import re as _re
    m = _re.search(r'\d[\d\.]*(,\d+)?', str(t))
    if not m:
        return None
    return float(m.group(0).replace('.', '').replace(',', '.'))


def pct0(v):
    if v in (None, ''):
        return None
    try:
        x = float(str(v).replace('%', '').replace(',', '.').split()[0])
    except (ValueError, IndexError):
        return None
    return x / 100 if x >= 0 else None


def fmt_pct(i):
    return f'{i*100:.1f}%'.replace('.', ',')


def brl(v):
    return 'R$ ' + f'{round(v):,}'.replace(',', '.')


def mes_relativo(nome_mes, inicio):
    m = MESES.index(nome_mes) + 1
    a = inicio[0] if m >= inicio[1] else inicio[0] + 1
    return (a, m)


def mes_nome(ano, mes):
    return f'{MESES[mes - 1]} de {ano}'


# ---------------- Etapa 1: limpeza ----------------
def limpar(r, inicio=(2026, 11)):
    alertas, dividas, premissas = [], [], []
    g = {k: (r.get('gastos') or {}).get(k) or 0 for k in NOME_GASTO}
    va = r.get('va') or 0
    abate_mercado = min(va, g['mercado'])
    abate_deliv = min(va - abate_mercado, g['delivery'])
    renda = (r.get('renda') or 0) + ((r.get('contrib') or 0) if r.get('divide') == 'Sim' else 0)

    for k in ['moradia', 'mercado', 'contas']:
        if g[k] == 0:
            alertas.append(('C4', f'{NOME_GASTO[k]} ficou em R$ 0. Se você tem esse gasto, a reserva para imprevistos e a data de saída mudam.'))

    for idx, d in enumerate(r.get('dividas') or []):
        t, nome = d.get('tipo'), d.get('credor') or d.get('tipo')
        base = {'id': idx, 'credor': nome, 'tipo': t, 'atrasada': d.get('s_status') == 'Atrasada',
                'atraso': d.get('s_tempo'), 'negativada': d.get('s_serasa') == 'Sim', 'proposta': d.get('s_propostaTexto'),
                'venc': d.get('e_venc') or d.get('c_venc'), 'debito': d.get('e_debito') == 'Sim', 'origem': d}
        if t == 'Cartão de crédito':
            f = d.get('c_fatura') or 0
            acao = d.get('c_acao')
            aberto = 0 if acao in ('Paguei tudo', 'Parcelei a fatura') else max(0, f - (d.get('c_pago') or 0)) if acao in ('Paguei uma parte', 'Paguei o mínimo') else f
            if aberto:
                tx = pct(d.get('c_taxaRot'))
                fonte = 'informada' if tx else 'referência'
                if not tx:
                    premissas.append(f'Juro do rotativo do cartão {nome}: usada a média de mercado, {fmt_pct(REF["rotativo"])} ao mês.')
                oferta = d.get('c_ofertaParc')
                dividas.append({**base, 'sub': 'rotativo', 'nome': f'{nome} · rotativo', 'saldo': aberto, 'taxa': tx or REF['rotativo'],
                                'fonte_taxa': fonte, 'parcela': 0, 'restam': None, 'caixa': True, 'pago_hoje': d.get('c_pago') or 0, 'oferta_parc': oferta})
            if d.get('c_temParc') == 'Sim' and d.get('c_parcValor') and d.get('c_parcRestam'):
                P, n, Q = d['c_parcValor'], d['c_parcRestam'], d.get('c_parcQuitar')
                reneg = d.get('c_parcReneg') == 'Sim'
                i = taxa_implicita(P, n, Q) if Q else None
                if Q and i is None and Q <= P * n:
                    i = 0.0
                exata = False
                if i is not None and i <= 0.25:
                    saldo, fonte, exata = Q, 'calculada pelo valor para quitar', True
                elif pct0(d.get('c_parcTaxa')) is not None:
                    i = pct0(d.get('c_parcTaxa'))
                    saldo, fonte, exata = pv(P, i, n), 'taxa do parcelamento', True
                elif reneg:
                    i, saldo, fonte = 0.0, P * n, 'renegociação sem valor para quitar'
                    premissas.append(f'Parcelamento do cartão {nome}: é uma renegociação e não sabemos quanto custa quitar. O plano considera que adiantar não dá desconto e deixa para o fim, até você confirmar.')
                else:
                    i, fonte = REF['parcelamento_fatura'], 'média de mercado'
                    saldo = pv(P, i, n)
                    premissas.append(f'Parcelamento do cartão {nome}: sem a taxa e sem o valor para quitar, foi usada a média de mercado ({fmt_pct(i)} ao mês). Fica no fim da lista até você confirmar.')
                dividas.append({**base, 'sub': 'parcelamento', 'nome': f'{nome} · parcelamento da fatura', 'saldo': saldo,
                                'taxa': i, 'fonte_taxa': fonte, 'parcela': P, 'restam': n, 'caixa': True, 'exata': exata, 'reneg': reneg})
            lancado = {}
            for x in d.get('c_futuroLista') or []:
                if x and x.get('valor') and x.get('mes'):
                    lancado[mes_relativo(x['mes'], inicio)] = lancado.get(mes_relativo(x['mes'], inicio), 0) + x['valor']
            # o lançado nas próximas faturas já inclui a parcela do parcelamento de fatura: tirar para não contar duas vezes
            Pp = d.get('c_parcValor') or 0 if d.get('c_temParc') == 'Sim' else 0
            np_ = d.get('c_parcRestam') or 0
            agenda = {}
            for k, mes_ in enumerate(sorted(lancado)):
                liquido = max(0, lancado[mes_] - (Pp if k < np_ else 0))
                if liquido:
                    agenda[mes_] = liquido
            if not agenda and d.get('c_futuro'):
                agenda = {inicio: d['c_futuro']}
                premissas.append(f'Compras parceladas do cartão {nome}: sem o valor de cada fatura, o total foi considerado no primeiro mês.')
            if agenda:
                prim = min(agenda)
                dividas.append({**base, 'sub': 'futuro', 'nome': f'{nome} · compras parceladas', 'saldo': sum(agenda.values()), 'taxa': 0.0,
                                'fonte_taxa': 'sem juros', 'parcela': agenda[prim], 'restam': len(agenda), 'caixa': True, 'agenda': agenda})
        elif t == 'Cheque especial':
            dividas.append({**base, 'sub': 'cheque', 'nome': nome + ' · cheque especial', 'saldo': d.get('ce_usado') or 0, 'taxa': REF['Cheque especial'],
                            'fonte_taxa': 'referência', 'parcela': 0, 'restam': None, 'caixa': True, 'continuo': d.get('ce_tempo') == 'Mais de 3 meses'})
        elif t in PARCELADAS:
            recente_ = base['atrasada'] and d.get('s_tempo') in ('Menos de 30 dias', '1 a 3 meses')
            if recente_ and d.get('a_qtdAtr') and d.get('e_parcelaAtr'):
                P, k = d['e_parcelaAtr'], d['a_qtdAtr']
                ntot = max(d.get('e_restamAtr') or k, k)
                nfut = ntot - k
                tx = pct0(d.get('e_taxa'))
                exata = tx is not None
                if tx is None:
                    tx = REF.get(t, 0.04)
                    premissas.append(f'{nome}: sem a taxa do contrato, foi usada a média de mercado ({fmt_pct(tx)} ao mês) para as parcelas que faltam. A dívida fica no fim da lista até você confirmar.')
                V = d.get('a_porEmDia')
                if not V:
                    V = round(P * k * 1.02 + P * k * (tx + 0.01) * (k + 1) / 2)
                    premissas.append(f'{nome}: sem o valor para pôr em dia, foi estimado {brl(V)}: as {k} parcelas atrasadas, mais multa de 2% e juros de atraso. Confirme no app antes de pagar.')
                if nfut > 0:
                    dividas.append({**base, 'atrasada': False, 'sub': 'parcelada', 'nome': nome, 'saldo': pv(P, tx, nfut), 'taxa': tx,
                                    'fonte_taxa': 'taxa do contrato' if exata else 'média de mercado', 'parcela': P, 'restam': nfut, 'caixa': True,
                                    'exata': exata, 'reneg': False, 'contrato_de_atraso': True})
                dividas.append({**base, 'sub': 'em_atraso', 'nome': nome + ' · parcelas atrasadas', 'saldo': V, 'taxa': tx + 0.01,
                                'fonte_taxa': 'juros do contrato mais juros de atraso', 'parcela': 0, 'restam': None, 'caixa': False, 'recente': True,
                                'qtd_atr': k, 'parcela_atr': P, 'taxa_contrato': tx, 'exata_contrato': exata, 'informado': bool(d.get('a_porEmDia'))})
                continue
            if base['atrasada']:
                cobrado = d.get('a_cobrado') or d.get('e_quitar')
                if not cobrado:
                    P0, n0 = d.get('e_parcelaAtr') or d.get('e_parcela') or 0, d.get('e_restamAtr') or d.get('e_restam') or 0
                    cobrado = P0 * n0 if P0 and n0 else d.get('e_quitar') or 0
                    premissas.append(f'{nome}: sem o valor cobrado hoje, foi usada a soma das parcelas que faltavam. Confirme o valor no Serasa ou com quem cobra.')
                recente = d.get('s_tempo') in ('Menos de 30 dias', '1 a 3 meses')
                tx_atr = (REF.get(t, 0.04) + 0.01) if recente else REF['atraso']
                dividas.append({**base, 'sub': 'atrasada', 'nome': nome, 'saldo': cobrado, 'taxa': tx_atr,
                                'fonte_taxa': 'juros do contrato mais multa de atraso (média de mercado)' if recente else 'multas e juros de atraso',
                                'parcela': 0, 'restam': None, 'caixa': False, 'recente': recente})
                continue
            P, n, N, S, recebido = d.get('e_parcela') or 0, d.get('e_restam') or 0, d.get('e_total'), d.get('e_quitar'), d.get('e_recebido')
            i, fonte, saldo, exata = None, '', None, False
            reneg = d.get('e_reneg') == 'Sim'
            if S:
                i = taxa_implicita(P, n, S)
                if i is not None and i < 0.003 and S <= P * n:
                    i = 0.0
                if i is None or i > 0.25:
                    alertas.append(('C6', f'{nome}: com parcela de {brl(P)}, {n} parcelas e {brl(S)} para quitar, a conta não fecha. Confirmar os dados.'))
                    i = None
                else:
                    fonte, saldo, exata = 'calculada pelo valor para quitar', S, True
            if i is None:
                tx = pct0(d.get('e_taxa'))
                if tx is not None:
                    i, fonte, saldo, exata = tx, 'taxa do contrato', pv(P, tx, n), True
            if i is None and reneg:
                i, fonte, saldo = 0.0, 'renegociação sem valor para quitar', P * n
                premissas.append(f'{nome}: é um acordo ou renegociação e não sabemos quanto custa quitar. O plano considera que adiantar parcelas não dá desconto e deixa essa dívida para o fim, até você confirmar.')
            if i is None and recebido and N:
                i = taxa_implicita(P, N, recebido)
                if i is None or not (0.003 <= i <= 0.25):
                    alertas.append(('C6', f'{nome}: com {brl(recebido)} recebidos, {N} parcelas de {brl(P)}, a conta não fecha. Confirmar os dados.'))
                    i = None
                else:
                    fonte, saldo = 'estimada pelo valor recebido', pv(P, i, n)
                    premissas.append(f'{nome}: sem a taxa do contrato, os juros ({fmt_pct(i)} ao mês) foram estimados pelo valor recebido. Essa conta inclui seguros e tarifas, então a taxa real que o banco usa para dar desconto costuma ser menor. A dívida fica no fim da lista até você confirmar a taxa.')
            if i is None:
                i, fonte = REF.get(t, 0.04), 'média de mercado'
                saldo = pv(P, i, n)
                premissas.append(f'{nome}: sem a taxa do contrato e sem o valor para quitar, o saldo foi estimado com a média de mercado ({fmt_pct(i)} ao mês). A dívida fica no fim da lista até você confirmar.')
            dividas.append({**base, 'sub': 'parcelada', 'nome': nome, 'saldo': saldo, 'taxa': i, 'fonte_taxa': fonte, 'parcela': P, 'restam': n,
                            'caixa': d.get('e_descontado') != 'Sim', 'descontado': d.get('e_descontado') == 'Sim', 'exata': exata, 'reneg': reneg})
        else:
            essencial = t in ('Conta atrasada (luz, água, gás, aluguel, condomínio)', 'Pensão alimentícia atrasada') or (t == 'Dívida com parente ou conhecido' and (d.get('o_pressao') or '').startswith('Sim'))
            dividas.append({**base, 'sub': 'outros', 'nome': nome, 'saldo': d.get('o_total') or 0, 'taxa': REF['atraso'] if base['atrasada'] else (pct0(d.get('o_jurosQuanto')) or 0.0),
                            'fonte_taxa': 'encargos de atraso' if base['atrasada'] else 'sem juros', 'parcela': 0, 'restam': None, 'caixa': False,
                            'essencial': essencial and (base['atrasada'] or t == 'Dívida com parente ou conhecido'), 'imposto': t == 'Impostos (DAS do MEI, IR, IPVA)', 'ameaca': d.get('o_pressao') == 'Sim, com ameaças'})
    return {'renda': renda, 'g': g, 'va_abate': abate_mercado + abate_deliv, 'abate_mercado': abate_mercado, 'abate_deliv': abate_deliv,
            'dividas': dividas, 'alertas': alertas, 'premissas': premissas}


# ---------------- Etapas 2 a 6 ----------------
def rodar(r, inicio, _cenario=False):
    L = limpar(r, inicio)
    g, R = L['g'], L['renda']
    E = sum(g[k] for k in ESSENCIAL) - L['abate_mercado']
    A = sum(g[k] for k in AJUSTAVEL) - L['abate_deliv']
    ds = L['dividas']

    def parcela_mes(d):
        if not d['caixa'] or d.get('contrato_de_atraso'):
            return 0
        if d['sub'] == 'rotativo':
            return d['saldo'] * d['taxa']  # só os juros: as compras do mês já estão nos gastos
        if d['sub'] == 'cheque':
            return d['saldo'] * d['taxa']
        return d['parcela']

    D = sum(parcela_mes(d) for d in ds)
    J = sum(d['saldo'] * d['taxa'] for d in ds)
    S = R - E - A - D
    T = sum(d['saldo'] for d in ds if d['sub'] != 'futuro')  # compras parceladas sem juros ficam fora da dívida
    parceladas_cartao = sum(d['saldo'] for d in ds if d['sub'] == 'futuro')

    # C1: prova real
    disse = (r.get('sobra') or 0) if r.get('fimMes') == 'Sobra dinheiro' else -(r.get('falta') or 0) if r.get('fimMes') == 'Falta dinheiro' else 0
    if abs(S - disse) > max(200, 0.10 * R):
        calc = f'sobram {brl(S)}' if S >= 0 else f'faltam {brl(-S)}'
        dito = f'sobram {brl(disse)}' if disse > 0 else (f'faltam {brl(-disse)}' if disse < 0 else 'fica zerado')
        L['alertas'].append(('C1', f'Antes de qualquer ajuste, as contas que você informou dão: {calc} por mês. Mas você disse que no fim do mês {dito}. Vale conferir os gastos e as parcelas: a data de saída depende disso.'))

    # C7: fatura paga inteira muito maior que os gastos declarados no cartão
    no_cartao = sum(g[k] for k, nome in NOME_GASTO.items() if nome in (r.get('noCartao') or []))
    cartoes = [x for x in (r.get('dividas') or []) if x.get('tipo') == 'Cartão de crédito']
    for c in cartoes:
        if c.get('c_acao') != 'Paguei tudo':
            continue
        parc = c.get('c_parcValor') or 0 if c.get('c_temParc') == 'Sim' else 0
        prox = next((d['parcela'] for d in ds if d['sub'] == 'futuro' and d['origem'] is c), 0)
        esperado = no_cartao / max(1, len(cartoes)) + parc + prox
        fat = c.get('c_fatura') or 0
        if fat > esperado + max(300, 0.15 * fat):
            L['alertas'].append(('C7', f'Cartão {c.get("credor")}: fatura de {brl(fat)} contra {brl(esperado)} de gastos e parcelas declarados. Provável gasto fora da lista.'))

    # Perfil
    causas_ativas = [c for c in (r.get('ainda') or []) if c != 'Nenhuma, já passou']
    perfis = []
    obrig = sum(d['parcela'] for d in ds if d['sub'] in ('parcelada', 'parcelamento') and d['caixa'])
    if R < E + obrig: perfis.append('A conta não fecha')
    if any(c in causas_ativas for c in ['Perdi renda ou o emprego', 'Problema de saúde (meu ou da família)', 'Separação ou mudança na família']): perfis.append('Golpe da vida (ainda acontecendo)')
    if 'Apostas ou jogos online' in causas_ativas or g['apostas'] > 0: perfis.append('Impulso ou apostas')
    if any(d['sub'] == 'rotativo' for d in ds) or any(d.get('continuo') for d in ds) or r.get('emprestPagar') == 'Sim': perfis.append('Bola de neve dos juros')
    if any(d['negativada'] or d['atraso'] in ('1 a 3 anos', '3 a 5 anos', 'Mais de 5 anos') for d in ds): perfis.append('Nome sujo antigo')
    if not perfis: perfis.append('Parcelas demais')

    comprometimento = D / R if R else 0
    if S < 0 or any(d['atrasada'] for d in ds) or comprometimento > 0.5: semaforo = 'Vermelho'
    elif any(d['sub'] in ('rotativo', 'cheque') for d in ds) or comprometimento > 0.3: semaforo = 'Amarelo'
    else: semaforo = 'Verde'

    # L2: ajuste nas 3 maiores categorias ajustáveis com meta, fora das protegidas
    protegidos = set(r.get('protegidos') or [])
    candidatos = sorted([k for k in META_L2 if g[k] > 0 and NOME_GASTO[k] not in protegidos], key=lambda k: -g[k])[:3]
    # A economia só conta o que sai do bolso: se o vale paga parte do gasto, cortar essa parte não libera dinheiro.
    va_total = r.get('va') or 0
    def ajustavel_em_dinheiro(gx):
        ab_m = min(va_total, gx['mercado'])
        ab_d = min(va_total - ab_m, gx['delivery'])
        return sum(gx[k] for k in AJUSTAVEL) - ab_d
    ajustes = []
    g_aj = dict(g)
    for k in candidatos:
        novo_v = round(g[k] * (1 - META_L2[k]))
        teste = dict(g_aj); teste[k] = novo_v
        ganho = ajustavel_em_dinheiro(g_aj) - ajustavel_em_dinheiro(teste)
        if ganho > 0.5:
            ajustes.append({'cat': k, 'nome': NOME_GASTO[k], 'de': g[k], 'para': novo_v, 'economia': round(ganho)})
            g_aj = teste
    A2 = ajustavel_em_dinheiro(g_aj)
    economia_l2 = A - A2

    # L1: parcelamento formal do rotativo e do cheque especial
    plano = []
    acoes_l1 = []
    for d in ds:
        x = dict(d)
        if d['sub'] == 'rotativo':
            oferta = d.get('oferta_parc')
            i = taxa_implicita(oferta, PARC_FORMAL_MESES, d['saldo']) if oferta else None
            if i and 0.003 <= i <= 0.25:
                parc, fonte = oferta, 'oferta do app'
            else:
                i = REF['parcelamento_fatura']
                parc, fonte = round(pmt(d['saldo'], i, PARC_FORMAL_MESES)), 'referência do parcelamento'
                L['premissas'].append(f'Parcelamento do rotativo ({d["credor"]}): o app não mostrou a simulação; foi usada a média de mercado, {fmt_pct(i)} ao mês, em 12 vezes.')
            x.update(sub='parcelamento_formal', nome=d['credor'] + ' · rotativo parcelado', taxa=i, parcela=parc, restam=PARC_FORMAL_MESES, fonte_taxa=fonte)
            acoes_l1.append(('parcelar_rotativo', d))
        if d.get('imposto') and d['atrasada'] and d['saldo'] > 0:
            x.update(sub='parcelada', nome=d['credor'] + ' · parcelado', taxa=0.01, parcela=round(pmt(d['saldo'], 0.01, 60)), restam=60, caixa=True,
                     exata=True, fonte_taxa='parcelamento oficial (cerca de 1% ao mês)', parcelamento_oficial=True)
            acoes_l1.append(('parcelar_imposto', d))
        plano.append(x)

    # Atraso recente: pôr em dia se couber em até 2 meses de sobra (mais o guardado); senão, pedir para jogar as atrasadas para o fim do contrato
    # capacidade nos 2 primeiros meses: sobra de cada mês (com as compras parceladas daquele mês e o dinheiro extra que entra) + guardado
    obrig_pre = sum((d['saldo'] * d['taxa'] if d['sub'] == 'cheque' else d['parcela']) for d in plano if d['caixa'] and d['sub'] not in ('rotativo', 'futuro'))
    cap = max(0, (r.get('guardado') or 0) - sum(d['saldo'] for d in plano if d.get('essencial')))
    a_, m_ = inicio
    for _ in range(2):
        fut = sum((d.get('agenda') or {}).get((a_, m_), 0) for d in plano if d['sub'] == 'futuro')
        ext = sum(x['valor'] for x in (r.get('extrasLista') or []) if x.get('valor') and x.get('mes') == MESES[m_ - 1])
        cap += max(0, R + ext - E - A2 - obrig_pre - fut)
        m_ += 1
        if m_ == 13: a_, m_ = a_ + 1, 1
    for x in list(plano):
        if x['sub'] != 'em_atraso':
            continue
        if x['saldo'] <= cap:
            x['por_em_dia'] = True
            cap -= x['saldo']
        else:
            contrato = next((y for y in plano if y['id'] == x['id'] and y.get('contrato_de_atraso')), None)
            if contrato is None:
                contrato = {**x, 'sub': 'parcelada', 'nome': x['credor'], 'saldo': 0, 'parcela': x['parcela_atr'], 'restam': 0, 'caixa': True,
                            'taxa': x['taxa_contrato'], 'exata': x['exata_contrato'], 'recente': False, 'contrato_de_atraso': True}
                plano.append(contrato)
            contrato['restam'] += x['qtd_atr']
            contrato['saldo'] = pv(contrato['parcela'], contrato['taxa'], contrato['restam'])
            contrato['prorrogado'] = x['qtd_atr']
            plano.remove(x)
            acoes_l1.append(('prorrogar', contrato))
            L['premissas'].append(f'{x["credor"]}: o plano considera que o banco aceita passar as {x["qtd_atr"]} parcelas atrasadas para o fim do contrato. Se não aceitar, peça para parcelar só o atraso e refaça o plano com o valor combinado.')

    # Bandas
    for d in plano:
        if d.get('essencial') or d.get('por_em_dia'):
            d['banda'] = 'P0'
        elif d.get('recente'):
            d['banda'] = 'P1'  # atraso recente: os juros do contrato continuam correndo e o nome ainda pode ser salvo
        elif d['sub'] == 'atrasada' or (d['sub'] == 'outros' and d['atrasada']):
            d['banda'] = 'P1' if d['taxa'] > 0 else 'P4'
            d['grupo_atraso'] = True
            faixa = ACORDO.get(d['atraso'])
            if faixa:
                d['acordo_oferta'], d['acordo_teto'] = round(d['saldo'] * faixa[0]), round(d['saldo'] * faixa[1])
                prop = valor_texto(d.get('proposta'))
                if prop and prop < d['acordo_teto']:
                    d['acordo_teto'] = prop
                    d['acordo_oferta'] = min(d['acordo_oferta'], round(prop * 0.85))
                    d['proposta_valor'] = prop
        elif d['sub'] in ('cheque', 'rotativo') or d['taxa'] > EXPLOSIVO:
            d['banda'] = 'P1'
        elif d['sub'] in ('parcelada', 'parcelamento') and not d.get('exata', True):
            d['banda'] = 'P5'  # a confirmar: sem taxa exata, não entra na ordem pelos juros
        elif d['tipo'] in ('Consignado', 'Financiamento de veículo', 'Financiamento de imóvel') and d['taxa'] < BARATA:
            d['banda'] = 'fora'
        elif d['sub'] == 'futuro':
            d['banda'] = 'fora'
        else:
            d['banda'] = 'P4'
    precisa_nome = (r.get('nomeLimpo') or 'Não') != 'Não'
    if precisa_nome:
        for d in plano:
            if d['negativada'] and d['banda'] not in ('P0', 'P1'):
                d['banda'] = 'P2'

    def chave(d):
        ordem = {'P0': 0, 'P1': 1, 'P2': 2, 'P3': 3, 'P4': 4, 'P5': 5, 'fora': 9}[d['banda']]
        if d['banda'] == 'P0':
            return (0, 0 if d.get('essencial') else 1, -d['taxa'], d['saldo'])  # contas essenciais antes de pôr empréstimo em dia
        if d['banda'] == 'P2':
            return (ordem, 0, 0, d.get('acordo_oferta') or d['saldo'])
        if d.get('grupo_atraso'):
            # atrasadas depois dos juros explosivos: primeiro as que limpam o nome (se precisa), depois o menor valor a pagar
            return (ordem, 1, 0 if (precisa_nome and d['negativada']) else 1, d.get('acordo_oferta') or d['saldo'])
        return (ordem, 0, -d['taxa'], d['saldo'])
    fila = sorted([d for d in plano if d['banda'] != 'fora'], key=chave)
    for pos, d in enumerate(fila, 1):
        d['ordem'] = pos

    tinha_explosivo = any(d['banda'] == 'P1' and not d.get('grupo_atraso') for d in fila)
    meta_colchao = round(E * (COLCHAO_VAR if r.get('rendaTipo', '').startswith('Varia') else COLCHAO_FIXA))
    extras = {}
    for x in r.get('extrasLista') or []:
        if x.get('valor') and x.get('mes'):
            extras.setdefault(MESES.index(x['mes']) + 1, []).append(x)

    # Simulação mês a mês
    ano, mes = inicio
    colchao = r.get('guardado') or 0
    # contas essenciais atrasadas (P0) vêm antes até da reserva: o dinheiro guardado vai primeiro para elas
    p0_total = sum(d['saldo'] for d in fila if d['banda'] == 'P0')
    para_p0 = min(colchao, p0_total)
    excedente = para_p0 + max(0, (colchao - para_p0) - meta_colchao)
    colchao = min(colchao - para_p0, meta_colchao)
    meses, marcos = [], []
    juros_total = 0.0
    ativos = [d for d in plano]
    for d in ativos:
        d['saldo_sim'] = d['saldo']
        d['quitada_em'] = None
    explosivo_zerado = None
    for m in range(1, HORIZONTE + 1):
        entra = R + sum(x['valor'] for x in extras.get(mes, []))
        sai_fixa = E + A2
        juros_mes = 0.0
        pagamentos = {}
        obrigatorio = 0.0
        for d in ativos:
            if d['quitada_em'] or d['saldo_sim'] <= 0.5:
                continue
            j = 0 if (d['sub'] == 'em_atraso' and m == 1) else d['saldo_sim'] * d['taxa']  # o valor para pôr em dia é o de hoje
            juros_mes += j
            if d['sub'] in ('atrasada',) or (d['sub'] == 'outros'):
                d['saldo_sim'] += j if d['sub'] == 'atrasada' else 0
                continue
            if d['sub'] == 'cheque':
                p = j
            elif d.get('agenda') is not None:
                p = min(d['agenda'].get((ano, mes), 0), d['saldo_sim'])
            else:
                p = min(d['parcela'], d['saldo_sim'] + j)
            d['saldo_sim'] = d['saldo_sim'] + j - p
            if d['caixa']:
                obrigatorio += p
            if p > 0.005:
                pagamentos[d['nome']] = pagamentos.get(d['nome'], 0) + p
            if d['saldo_sim'] <= 0.5:
                d['saldo_sim'], d['quitada_em'] = 0, (ano, mes)
                marcos.append(((ano, mes), f"{d['nome']} quitada"))
        juros_total += juros_mes
        sobra = entra - sai_fixa - obrigatorio + excedente
        do_guardado, excedente = excedente, 0
        extras_entrada = [(x.get('oque') or 'extra', x['valor']) for x in extras.get(mes, [])] if m <= 12 else []
        para_reserva = 0.0
        if sobra < 0:
            meses.append({'ano': ano, 'mes': mes, 'entra': entra, 'sobra': sobra, 'pagamentos': pagamentos, 'alvo': None, 'extra': 0,
                          'colchao': colchao, 'saldo_total': sum(d['saldo_sim'] for d in ativos if d['sub'] != 'futuro'), 'juros': juros_mes, 'deficit': True})
        else:
            restante = sobra
            # colchão: depois que o juro explosivo zerar; antes disso, 20% se estancar demorar
            p1_aberto = [d for d in fila if d['banda'] == 'P1' and not d['quitada_em'] and d['saldo_sim'] > 0.5]
            if colchao < meta_colchao:
                if not p1_aberto:
                    c = min(restante, meta_colchao - colchao)
                elif m > 3:
                    c = min(restante * DIV_COLCHAO, meta_colchao - colchao)
                else:
                    c = 0
                colchao += c
                restante -= c
                para_reserva += c
            alvo_nome, extra_pago = None, 0.0
            extras_mes = {}
            for d in fila:
                if restante <= 0.5:
                    break
                if d['quitada_em'] or d['saldo_sim'] <= 0.5:
                    continue
                if d['sub'] == 'atrasada':
                    alvo_valor = d.get('acordo_oferta') or d['saldo_sim']
                    d['reserva'] = d.get('reserva', 0)
                    falta = alvo_valor - d['reserva']
                    usa = min(restante, falta)
                    d['reserva'] += usa
                    restante -= usa
                    extras_mes[d['nome']] = extras_mes.get(d['nome'], 0) + usa
                    extra_pago += usa
                    alvo_nome = alvo_nome or d['nome']
                    if d['reserva'] >= alvo_valor - 0.5:
                        d['pago_acordo'] = alvo_valor
                        d['saldo_sim'], d['quitada_em'] = 0, (ano, mes)
                        marcos.append(((ano, mes), f"Acordo de {d['nome']} pago à vista" if d.get('acordo_oferta') else f"{d['nome']} quitada"))
                        pagamentos[d['nome'] + ' (acordo)'] = alvo_valor
                    continue
                usa = min(restante, d['saldo_sim'])
                d['saldo_sim'] -= usa
                restante -= usa
                extras_mes[d['nome']] = extras_mes.get(d['nome'], 0) + usa
                extra_pago += usa
                pagamentos[d['nome']] = pagamentos.get(d['nome'], 0) + usa
                alvo_nome = alvo_nome or d['nome']
                if d['saldo_sim'] <= 0.5:
                    d['saldo_sim'], d['quitada_em'] = 0, (ano, mes)
                    marcos.append(((ano, mes), f"{d['nome']} quitada"))
            if restante > 0.5:
                colchao += restante
                para_reserva += restante
            meses.append({'ano': ano, 'mes': mes, 'entra': entra, 'sobra': sobra, 'pagamentos': pagamentos, 'alvo': alvo_nome, 'extra': extra_pago,
                          'extras': extras_mes, 'para_reserva': para_reserva, 'do_guardado': do_guardado, 'extras_entrada': extras_entrada, 'colchao': colchao, 'saldo_total': sum(d['saldo_sim'] for d in ativos if d['sub'] != 'futuro'), 'juros': juros_mes, 'deficit': False})
        if explosivo_zerado is None and tinha_explosivo and not [d for d in fila if d['banda'] == 'P1' and not d.get('grupo_atraso') and not d['quitada_em']]:
            explosivo_zerado = (ano, mes)
            marcos.append(((ano, mes), 'Juro explosivo zerado'))
        if colchao >= meta_colchao and not any(t == 'Colchão completo' for _, t in marcos):
            marcos.append(((ano, mes), 'Colchão completo'))
        if all(d['quitada_em'] for d in fila):
            break
        mes += 1
        if mes == 13:
            mes, ano = 1, ano + 1
    saida = (ano, mes) if all(d['quitada_em'] for d in fila) else None

    # Cenário sem plano: 12 meses pagando como hoje (mínimo do cartão, juros do cheque, parcelas)
    juros_sem = 0.0
    for d in ds:
        s = d['saldo']
        for _ in range(12):
            if s <= 0.5: break
            j = s * d['taxa']; juros_sem += j
            if d['sub'] == 'rotativo': s = s + j - (d.get('pago_hoje') or j)
            elif d['sub'] == 'cheque': pass
            elif d['sub'] in ('atrasada', 'outros'): s += j if d['sub'] == 'atrasada' else 0
            else: s = s + j - d['parcela']
    juros_com_12 = sum(x['juros'] for x in meses[:12])

    # Depois de L1 e L2: a conta fecha?
    # compras parceladas sem juros acabam sozinhas: não decidem se a conta fecha
    obrig_plano = sum((d['saldo'] * d['taxa'] if d['sub'] == 'cheque' else d['parcela']) for d in plano if d['caixa'] and d['sub'] not in ('rotativo', 'futuro'))
    S2 = R - E - A2 - obrig_plano
    # a conta fecha se o caminho chega ao fim sem nenhum mês no vermelho (a sobra estrutural S2 pode ficar negativa por juros que somem logo, como o do cheque especial)
    conta_fecha = saida is not None and not any(m.get('deficit') for m in meses)
    superendividamento = (R - E) < obrig_plano
    cenario_veiculo = None
    if not conta_fecha and not _cenario and r.get('veiculo') == 'Sim' and r.get('veiculoTrab') != 'Sim' and r.get('fipe'):
        fin = next((d for d in plano if d['tipo'] == 'Financiamento de veículo' and d['sub'] == 'parcelada'), None)
        saldo_fin = fin['saldo'] if fin else 0
        liquido = (r.get('fipe') or 0) - saldo_fin
        parcela_fin = fin['parcela'] if fin else 0
        p1_total = sum(d['saldo'] for d in fila if d['banda'] == 'P1')
        if (parcela_fin + g['transporte']) > 0.20 * R or liquido >= 0.5 * p1_total:
            r2 = json.loads(json.dumps(r))
            if fin:
                r2['dividas'] = [x for i_x, x in enumerate(r2['dividas']) if i_x != fin['id']]
            r2['guardado'] = (r2.get('guardado') or 0) + max(0, liquido)
            r2['veiculo'] = 'Não'
            res_v = rodar(r2, inicio, _cenario=True)
            cenario_veiculo = {'fipe': r.get('fipe'), 'saldo_financiamento': saldo_fin, 'liquido': liquido, 'parcela_liberada': parcela_fin,
                               'res': res_v, 'r': r2, 'conta_fecha': res_v['conta_fecha']}
    repactuacao = None
    if not conta_fecha and not _cenario and not (cenario_veiculo and cenario_veiculo['conta_fecha']):
        repactuacao = repactuar(r, inicio, L, ds, plano, R, E, A2, g)
    return {
        'repactuacao': repactuacao,
        'conta_fecha': conta_fecha, 'S2': S2, 'diferenca': max(0, -S2), 'superendividamento': superendividamento, 'cenario_veiculo': cenario_veiculo,
        'R': R, 'E': E, 'A': A, 'A2': A2, 'D': D, 'J': J, 'S': S, 'T': T, 'parceladas_cartao': parceladas_cartao, 'comprometimento': comprometimento, 'semaforo': semaforo,
        'perfis': perfis, 'ajustes': ajustes, 'economia_l2': economia_l2, 'acoes_l1': acoes_l1, 'fila': fila, 'plano': plano, 'dividas_hoje': ds,
        'meta_colchao': meta_colchao, 'meses': meses, 'marcos': marcos, 'saida': saida, 'juros_total': juros_total,
        'juros_sem_12': juros_sem, 'juros_com_12': juros_com_12, 'alertas': L['alertas'], 'premissas': L['premissas'], 'va_abate': L['va_abate'], 'g': g,
    }


# ---------------- L8: repactuação pela Lei do Superendividamento ----------------
FORA_DA_LEI = ('Financiamento de imóvel', 'Financiamento de veículo', 'Impostos (DAS do MEI, IR, IPVA)', 'Pensão alimentícia atrasada', 'Dívida com parente ou conhecido')
MESES_ATE_AUDIENCIA = 3
FOLGA_PROPOSTA = 0.90


def repactuar(r, inicio, L, ds, plano, R, E, A2, g):
    """Conta que não fecha: protege o básico, separa o que fica fora da lei e monta a proposta única para os credores."""
    # 1. Proteger: o básico para viver (gastos depois dos ajustes)
    viver = E + A2
    # 2. Fica fora da repactuação e continua sendo pago: garantia real, imóvel, impostos, pensão, pessoas
    protegidas = []
    for d in plano:
        if d['tipo'] in FORA_DA_LEI or d.get('descontado'):
            if d.get('descontado'):
                mensal, como = 0, 'já sai do salário (pode entrar, se você pedir)'
            elif d.get('parcelamento_oficial'):
                mensal, como = d['parcela'], 'parcelamento oficial'
            elif d['sub'] == 'parcelada':
                mensal, como = d['parcela'], 'parcela do contrato'
            else:
                mensal, como = round(d['saldo'] / 12), 'combinar em até 12 vezes'
            protegidas.append({'nome': d['nome'], 'credor': d['credor'], 'tipo': d['tipo'], 'saldo': d['saldo'], 'mensal': mensal, 'como': como, 'd': d})
    # contas essenciais atrasadas (luz, água, aluguel) também são protegidas: parcelar com a empresa
    essenciais = []
    for d in plano:
        if d.get('essencial') and d['tipo'] not in FORA_DA_LEI:
            essenciais.append({'nome': d['nome'], 'credor': d['credor'], 'tipo': d['tipo'], 'saldo': d['saldo'], 'mensal': round(d['saldo'] / 6), 'como': 'parcelar com a empresa em até 6 vezes', 'd': d})
    if essenciais:
        L['premissas'].append('Contas essenciais atrasadas: o plano considera um parcelamento com a empresa em 6 vezes. Peça esse parcelamento logo, antes do aviso de corte.')
    mensal_prot = sum(x['mensal'] for x in protegidas + essenciais)
    # 3. Credores da repactuação: tudo o que é crédito de consumo, pelo valor de hoje, agrupado por credor
    credores = {}
    nomes_ess = {x['nome'] for x in essenciais}
    for d in ds:
        if d['tipo'] in FORA_DA_LEI or d.get('descontado') or d['nome'] in nomes_ess or d['saldo'] <= 0.5:
            continue
        chave = (d['credor'] or '').strip().lower()
        c = credores.setdefault(chave, {'credor': d['credor'], 'saldo': 0.0, 'parcela_hoje': 0.0, 'itens': [], 'atrasada': False})
        c['saldo'] += d['saldo']
        c['parcela_hoje'] += (d['saldo'] * d['taxa']) if d['sub'] in ('rotativo', 'cheque') else (d['parcela'] if d['caixa'] or d.get('contrato_de_atraso') else 0)
        c['itens'].append(d)
        c['atrasada'] = c['atrasada'] or d['atrasada']
    credores = sorted(credores.values(), key=lambda c: -c['saldo'])
    total = sum(c['saldo'] for c in credores)
    sobra = R - viver - mensal_prot
    out = {'viver': viver, 'protegidas': protegidas, 'essenciais': essenciais, 'mensal_prot': mensal_prot, 'credores': credores,
           'total': total, 'sobra': sobra, 'parcela_hoje': sum(c['parcela_hoje'] for c in credores), 'gastos': g, 'ajustes_A2': A2,
           'meses_ate_audiencia': MESES_ATE_AUDIENCIA}
    if sobra <= 0 or total <= 0:
        out.update(proposta=None, parcela=0, meses=None, cobertura=0, inicio_pag=None, saida=None)
        return out
    parcela = math.floor(sobra * FOLGA_PROPOSTA)
    n = math.ceil(total / parcela)
    cobertura = 1.0
    if n > 60:
        n = 60
        cobertura = parcela * 60 / total
    else:
        parcela = math.ceil(total / n)  # mesma duração, parcela justa
    for c in credores:
        c['parcela_proposta'] = round(parcela * c['saldo'] / total)
    credores[0]['parcela_proposta'] += parcela - sum(c['parcela_proposta'] for c in credores)  # arredondamento fica com o maior credor
    for c in credores:
        c['total_proposto'] = c['parcela_proposta'] * n
    ini = inicio[0] * 12 + inicio[1] - 1 + MESES_ATE_AUDIENCIA
    fim = ini + n - 1
    out.update(proposta=True, parcela=parcela, meses=n, cobertura=cobertura,
               inicio_pag=(ini // 12, ini % 12 + 1), saida=(fim // 12, fim % 12 + 1))
    return out


def conservador(r, inicio):
    r2 = json.loads(json.dumps(r))
    r2['extrasLista'] = []
    r2['renda'] = (r2.get('renda') or 0)
    res = rodar(r2, inicio)
    # sobra 10% menor: reduz a renda no valor de 10% da sobra positiva do plano
    s_plano = res['R'] - res['E'] - res['A2'] - sum(d['parcela'] for d in res['plano'] if d['caixa'] and d['sub'] not in ('cheque',))
    if s_plano > 0:
        r2['renda'] = r2['renda'] - 0.10 * s_plano
        res = rodar(r2, inicio)
    return res


if __name__ == '__main__':
    r = json.load(open(sys.argv[1]))
    ini = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (2026, 11)
    res = rodar(r, ini)
    cons = conservador(r, ini)
    print('R E A A2 D J S T', round(res['R']), round(res['E']), round(res['A']), round(res['A2']), round(res['D']), round(res['J']), round(res['S']), round(res['T']))
    print('semáforo', res['semaforo'], 'perfis', res['perfis'], 'compr', round(res['comprometimento'] * 100))
    print('ajustes', res['ajustes'])
    for d in res['fila']:
        print(d['ordem'], d['banda'], d['nome'], round(d['saldo']), f"{d['taxa']*100:.2f}%", d['fonte_taxa'], d.get('parcela'), d.get('restam'), d.get('quitada_em'), d.get('acordo_oferta'))
    for d in res['plano']:
        if d['banda'] == 'fora': print('fora', d['nome'], round(d['saldo']), f"{d['taxa']*100:.2f}%", d.get('quitada_em'))
    for m in res['meses']:
        print(m['ano'], m['mes'], 'sobra', round(m['sobra']), 'alvo', m['alvo'], 'extra', round(m['extra']), 'colchão', round(m['colchao']), 'saldo', round(m['saldo_total']), 'juros', round(m['juros']))
    print('marcos', res['marcos'])
    print('saida', res['saida'], 'conservador', cons['saida'])
    print('juros 12m sem plano', round(res['juros_sem_12']), 'com plano', round(res['juros_com_12']), 'total plano', round(res['juros_total']))
    print('alertas', res['alertas'])
