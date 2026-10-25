"""Gera o plano em PDF a partir das respostas do questionário.

Uso: python3 gerar_plano.py respostas.json AAAA-MM-DD pasta_saida
  - respostas.json: as respostas como o questionário envia (o campo "dados" do /admin)
  - AAAA-MM-DD: data em que a pessoa respondeu. O plano começa no mês seguinte.
Saída: pasta_saida/plano.html, pasta_saida/plano.pdf (pelo gerar_pdf.js) e pasta_saida/resumo.json
"""
import json, os, sys
AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import plano_pdf, textos_generico, motor

GRAVES = {'C6'}  # dados impossíveis: pedem um olhar humano antes do envio (o C1 já vai explicado no próprio plano)


def inicio_do_plano(data):
    a, m = int(data[:4]), int(data[5:7])
    return (a, m + 1) if m < 12 else (a + 1, 1)


def main():
    entrada, data, saida = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(saida, exist_ok=True)
    r = json.load(open(entrada))
    ini = inicio_do_plano(data)
    doc, res, cons = plano_pdf.montar(r, textos_generico.textos, ini, link_avaliar=os.environ.get('AVALIAR_URL') or None)
    open(os.path.join(saida, 'plano.html'), 'w').write(doc)
    original = motor.rodar(r, ini)  # a situação de hoje, antes de qualquer cenário
    alertas = [{'codigo': c, 'texto': t} for c, t in (original.get('alertas') or [])]
    rep = original.get('repactuacao') if not original.get('cenario_veiculo') or not original['cenario_veiculo']['conta_fecha'] else None
    cenario = bool(original.get('cenario_veiculo')) and not original.get('conta_fecha') and not rep
    resumo = {
        'inicio': list(ini),
        'saida': list(rep['saida']) if rep and rep.get('saida') else (None if rep else (list(res['saida']) if res.get('saida') else None)),
        'saida_conservadora': list(cons['saida']) if cons.get('saida') else None,
        'conta_fecha': original.get('conta_fecha'),
        'repactuacao': bool(rep),
        'cenario_carro': cenario,
        'alertas': alertas,
        'premissas': res.get('premissas') or [],
        'precisa_revisao': any(a['codigo'] in GRAVES for a in alertas) or not original.get('conta_fecha'),
        'dividas': len(r.get('dividas') or []),
    }
    json.dump(resumo, open(os.path.join(saida, 'resumo.json'), 'w'), ensure_ascii=False, indent=1)
    print(json.dumps(resumo, ensure_ascii=False))


if __name__ == '__main__':
    main()
