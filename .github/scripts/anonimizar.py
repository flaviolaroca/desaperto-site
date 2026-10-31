# Lê as respostas baixadas do painel e tira tudo o que identifica a pessoa:
# nome, e-mail, banco, nome do credor e textos livres. Ficam só números e escolhas.
import json, sys, os
TIRAR = {'nome', 'email', 'banco', 'objetivo', 's_propostaTexto', 'causaOutro', 'consent', 'credor', 'oque', 'ip', 'origem_hash', 'chave_hash'}
def limpar(x):
    if isinstance(x, dict): return {k: limpar(v) for k, v in x.items() if k not in TIRAR}
    if isinstance(x, list): return [limpar(v) for v in x]
    return x
lista = json.load(open(sys.argv[1]))['respostas']
saida = []
for i, r in enumerate(sorted(lista, key=lambda r: r['criado_em'])):
    if r.get('teste'): continue
    f = os.path.join(sys.argv[2], r['id'] + '.json')
    dados = json.load(open(f))['resposta'].get('dados') if os.path.exists(f) else None
    saida.append({'n': len(saida) + 1, 'dia': r['criado_em'][:10], 'status': r.get('status'), 'pag_status': r.get('pag_status'),
                  'origem': (r.get('origem') or '').split(':')[0], 'convite': bool(r.get('convite')),
                  'estimativa': limpar(r.get('estimativa')), 'plano': limpar(r.get('plano_resumo')), 'plano_erro': (r.get('plano_erro') or '')[:200],
                  'dados': limpar(dados)})
json.dump(saida, open(sys.argv[3], 'w'), ensure_ascii=False)
print(len(saida), 'respostas')
