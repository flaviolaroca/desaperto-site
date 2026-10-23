"""Monta a pasta public/ que a Cloudflare publica.

Fontes (tudo em src/):
  index.src.html   página inicial
  comecar.html     questionário
  logo.svg         logo
  termos.html, privacidade.html, admin.html, legal.css
Rodar: python3 build.py
"""
import os, re, shutil, json

AQUI = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(AQUI, 'src')
LOGO_SVG = os.path.join(AQUI, 'src', 'logo.svg')
PUB = os.path.join(AQUI, 'public')
URL = 'https://desaperto.com'

FONTES = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=IBM+Plex+Mono:wght@500;600&display=swap">'


def logo():
    s = open(LOGO_SVG).read()
    s = re.sub(r'-?\d+\.\d+', lambda m: ('%.1f' % float(m.group())).rstrip('0').rstrip('.'), s)
    return s.replace('fill="#16211C"', 'fill="currentColor"').replace('role="img" aria-label="desaperto"', 'aria-hidden="true" focusable="false"')


def cabeca(titulo, descricao, caminho, extra='', indexar=True):
    return f'''<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{titulo}</title>
<meta name="description" content="{descricao}">
<meta name="theme-color" content="#F3EFE6">
{'' if indexar else '<meta name="robots" content="noindex, nofollow">'}
<link rel="canonical" href="{URL}{caminho}">
<link rel="icon" href="/img/icone.svg" type="image/svg+xml">
<link rel="icon" href="/img/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:locale" content="pt_BR">
<meta property="og:site_name" content="Desaperto">
<meta property="og:title" content="{titulo}">
<meta property="og:description" content="{descricao}">
<meta property="og:url" content="{URL}{caminho}">
<meta property="og:image" content="{URL}/img/compartilhar.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
{FONTES}
{extra}
</head>
'''


def separar(fonte, marcador):
    """Tudo antes do marcador vai para o <head> (title/meta/style); o resto é o corpo."""
    i = fonte.index(marcador)
    topo, corpo = fonte[:i], fonte[i:]
    topo = re.sub(r'<title>.*?</title>\s*', '', topo, flags=re.S)
    topo = re.sub(r'<meta name="claude:[^>]*>\s*', '', topo)
    topo = re.sub(r'<meta name="description"[^>]*>\s*', '', topo)
    topo = re.sub(r'<link rel="preconnect"[^>]*>\s*', '', topo)
    topo = re.sub(r'<link rel="stylesheet" href="https://fonts.googleapis.com[^>]*>\s*', '', topo)
    return topo, corpo


def pagina_simples(nome, titulo, descricao, caminho, indexar=True):
    css = open(os.path.join(AQUI, 'src', 'legal.css')).read()
    conteudo = open(os.path.join(AQUI, 'src', nome)).read()
    corpo = f'''<body>
<header class="topo"><div class="in"><a class="logo" href="/" aria-label="desaperto, página inicial">{logo()}</a><a class="voltar" href="/comecar">Montar meu plano</a></div></header>
<main><div class="in">
{conteudo}
</div></main>
<footer><div class="in"><span>© 2026 Desaperto</span><a href="/termos">Termos de uso</a><a href="/privacidade">Privacidade</a><span>contato@desaperto.com</span></div></footer>
</body>
</html>
'''
    return cabeca(titulo, descricao, caminho, f'<style>{css}</style>', indexar) + corpo


def main():
    os.makedirs(os.path.join(PUB, 'img'), exist_ok=True)
    L = logo()

    # página inicial
    src = open(os.path.join(SITE, 'index.src.html')).read().replace('{{LOGO}}', L).replace('href="comecar.html"', 'href="/comecar"')
    topo, corpo = separar(src, '<header class="topo')
    desc = 'Responda sobre seu salário, seus gastos e suas dívidas. O Desaperto faz as contas e entrega um plano com a ordem certa de pagar e o mês em que você sai das dívidas.'
    open(os.path.join(PUB, 'index.html'), 'w').write(cabeca('Desaperto: descubra o mês em que você sai das dívidas', desc, '/', topo) + '<body>\n' + corpo + '\n</body>\n</html>\n')

    # questionário
    src = open(os.path.join(SITE, 'comecar.html')).read()
    topo, corpo = separar(src, '<div class="app">')
    open(os.path.join(PUB, 'comecar.html'), 'w').write(cabeca('Montar meu plano · Desaperto', 'Responda o questionário e receba o seu plano de desaperto por e-mail.', '/comecar', topo) + '<body>\n' + corpo + '\n</body>\n</html>\n')

    open(os.path.join(PUB, 'termos.html'), 'w').write(pagina_simples('termos.html', 'Termos de uso · Desaperto', 'O combinado entre você e o Desaperto.', '/termos'))
    open(os.path.join(PUB, 'privacidade.html'), 'w').write(pagina_simples('privacidade.html', 'Privacidade · Desaperto', 'Como o Desaperto cuida das suas respostas.', '/privacidade'))
    open(os.path.join(PUB, 'admin.html'), 'w').write(pagina_simples('admin.html', 'Área interna · Desaperto', 'Área interna.', '/admin', indexar=False))

    nao = '''<p class="rotulo">Página não encontrada</p><h1>Esse endereço não existe.</h1><p>Talvez o link tenha mudado. <a href="/">Voltar para o início</a> ou <a href="/comecar">montar o seu plano</a>.</p>'''
    open(os.path.join(AQUI, 'src', '404.html'), 'w').write(nao)
    open(os.path.join(PUB, '404.html'), 'w').write(pagina_simples('404.html', 'Página não encontrada · Desaperto', 'Página não encontrada.', '/404', indexar=False))

    open(os.path.join(PUB, 'robots.txt'), 'w').write(f'User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: {URL}/sitemap.xml\n')
    urls = ['/', '/comecar', '/termos', '/privacidade']
    open(os.path.join(PUB, 'sitemap.xml'), 'w').write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + ''.join(f'  <url><loc>{URL}{u}</loc></url>\n' for u in urls) + '</urlset>\n')
    csp = ("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
           "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
    open(os.path.join(PUB, '_headers'), 'w').write(f'''/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
  Strict-Transport-Security: max-age=31536000
  Content-Security-Policy: {csp}

/admin
  X-Robots-Tag: noindex, nofollow
  Cache-Control: no-store

/img/*
  Cache-Control: public, max-age=604800
''')
    print('public/ pronto:', sorted(os.listdir(PUB)))


if __name__ == '__main__':
    main()
