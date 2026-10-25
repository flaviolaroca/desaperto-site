// Cartão para o story (1080 x 1920): a contagem até o fim do plano, com barra de progresso.
// Não fala de dívida, não mostra valores nem nome: a pessoa pode postar sem se expor.
// Uso: DesapertoCartao.gerar({ total, feitos, pagas, dividas, fim_txt, aprox, objetivo, variante: 'meta' | 'contagem' }) -> Promise<Blob>
//      DesapertoCartao.compartilhar(blob) -> Promise<'compartilhou' | 'baixou'>
(function () {
  'use strict';
  var COR = { fundo: '#16211C', papel: '#F3EFE6', verde: '#9FD1B6', claro: '#DCEBE1', apagado: 'rgba(243, 239, 230, .16)', cinza: '#9AA59F' };
  var W = 1080, H = 1920, M = 96;

  function logo() {
    var svg = document.querySelector('#logo-cartao svg');
    if (!svg) return Promise.resolve(null);
    var txt = new XMLSerializer().serializeToString(svg).replace(/currentColor/g, COR.papel);
    if (txt.indexOf('xmlns=') < 0) txt = txt.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    return new Promise(function (ok) {
      var img = new Image();
      img.onload = function () { ok(img); };
      img.onerror = function () { ok(null); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(txt);
    });
  }
  function fonte(peso, tam, fam) { return peso + ' ' + tam + 'px ' + (fam === 'mono' ? '"IBM Plex Mono", ui-monospace, monospace' : 'Archivo, "Arial Narrow", Arial, sans-serif'); }
  function minusc(t) { return t.charAt(0).toLowerCase() + t.slice(1); }
  function quebrar(ctx, txt, x, y, larg, alt, maxl) {
    var pal = txt.split(/\s+/), linha = '', n = 0;
    for (var i = 0; i < pal.length; i++) {
      var t = linha ? linha + ' ' + pal[i] : pal[i];
      if (ctx.measureText(t).width > larg && linha) {
        if (n === maxl - 1) { ctx.fillText(linha + '…', x, y + n * alt); return; }
        ctx.fillText(linha, x, y + n * alt); n++; linha = pal[i];
      } else linha = t;
    }
    ctx.fillText(linha, x, y + n * alt);
  }
  function redondo(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  function gerar(o) {
    var total = Math.max(1, o.total || 1), feitos = Math.max(0, Math.min(total, o.feitos || 0)), faltam = total - feitos;
    var prontos = document.fonts && document.fonts.load ? Promise.all([document.fonts.load(fonte(800, 100)), document.fonts.load(fonte(600, 40, 'mono'))]).catch(function () {}) : Promise.resolve();
    return prontos.then(logo).then(function (img) {
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      var ctx = c.getContext('2d');
      ctx.fillStyle = COR.fundo; ctx.fillRect(0, 0, W, H);
      // brilho suave no topo
      var g = ctx.createRadialGradient(W * 0.85, 0, 0, W * 0.85, 0, 900); g.addColorStop(0, 'rgba(22, 112, 74, .55)'); g.addColorStop(1, 'rgba(22, 112, 74, 0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      if (img) { var lw = 380, lh = lw * img.height / img.width; ctx.drawImage(img, M, 150, lw, lh); }

      var fim = feitos >= total, meta = o.variante === 'meta' && o.objetivo;
      var objetivo = meta ? String(o.objetivo).trim().replace(/\.$/, '') : '';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = COR.verde; ctx.font = fonte(600, 34, 'mono');
      var rotulo = meta ? 'MINHA META' : fim ? 'MEU PLANO' : feitos === 0 ? 'COMECEI O MEU PLANO' : 'MÊS ' + feitos + ' DE ' + total;
      if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '5px';
      ctx.fillText(rotulo, M, 560);
      if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';

      ctx.fillStyle = COR.papel;
      if (fim) {
        ctx.font = fonte(800, 200); ctx.fillText('Cheguei.', M - 8, 860);
        if (objetivo) { ctx.font = fonte(700, 56); ctx.fillStyle = COR.claro; quebrar(ctx, 'Agora é a vez de: ' + minusc(objetivo) + '.', M, 970, W - 2 * M, 70, 3); }
        else { ctx.font = fonte(700, 60); ctx.fillStyle = COR.claro; ctx.fillText('Um passo de cada vez.', M, 970); }
      } else {
        ctx.font = fonte(800, 72); ctx.fillText(o.aprox ? 'Faltam cerca de' : 'Faltam', M, 680);
        ctx.font = fonte(800, 400); var n = String(faltam); ctx.fillText(n, M - 14, 1010);
        var lnum = ctx.measureText(n).width;
        ctx.font = fonte(800, 110); ctx.fillText(faltam === 1 ? 'mês' : 'meses', M + lnum + 10, 1010);
        ctx.fillStyle = COR.claro;
        if (objetivo) { ctx.font = fonte(700, 58); quebrar(ctx, objetivo.charAt(0).toUpperCase() + objetivo.slice(1) + '.', M, 1100, W - 2 * M, 70, 2); }
        else { ctx.font = fonte(700, 60); ctx.fillText('Um passo de cada vez.', M, 1100); }
      }

      // barra de progresso: um pedaço por mês (contínua quando são muitos meses)
      var by = 1250, bh = 34, bw = W - 2 * M;
      if (total <= 36) {
        var gap = total > 24 ? 6 : 10, sw = (bw - gap * (total - 1)) / total;
        for (var i = 0; i < total; i++) {
          ctx.fillStyle = i < feitos ? COR.verde : COR.apagado;
          redondo(ctx, M + i * (sw + gap), by, sw, bh, Math.min(10, sw / 2)); ctx.fill();
        }
      } else {
        ctx.fillStyle = COR.apagado; redondo(ctx, M, by, bw, bh, bh / 2); ctx.fill();
        if (feitos) { ctx.fillStyle = COR.verde; redondo(ctx, M, by, Math.max(bh, bw * feitos / total), bh, bh / 2); ctx.fill(); }
      }
      // ponta: bandeira de chegada
      ctx.fillStyle = COR.papel; ctx.fillRect(W - M - 4, by - 70, 5, 70 + bh);
      ctx.beginPath(); ctx.moveTo(W - M + 1, by - 70); ctx.lineTo(W - M + 1 - 48, by - 56); ctx.lineTo(W - M + 1, by - 42); ctx.closePath(); ctx.fill();
      ctx.font = fonte(600, 36, 'mono'); ctx.fillStyle = COR.cinza;
      ctx.textAlign = 'left'; ctx.fillText(fim ? 'começo' : 'hoje', M, by + bh + 64);
      ctx.textAlign = 'right'; ctx.fillStyle = COR.papel; ctx.fillText(o.fim_txt || '', W - M, by + bh + 64);
      ctx.textAlign = 'left';
      var pct = Math.round(100 * feitos / total);
      ctx.font = fonte(800, 46); ctx.fillStyle = COR.verde;
      ctx.fillText(fim ? '100% do caminho' : feitos === 0 ? 'O primeiro passo é esta semana.' : pct + '% do caminho', M, by + bh + 150);
      if (meta && !fim && feitos > 0) { ctx.font = fonte(600, 34, 'mono'); ctx.fillStyle = COR.cinza; ctx.fillText('mês ' + feitos + ' de ' + total, M, by + bh + 210); }

      // dívidas pagas
      if (o.dividas > 1) {
        var y = 1560, r = 22, x = M + r;
        for (var k = 0; k < Math.min(o.dividas, 12); k++) {
          ctx.beginPath(); ctx.arc(x + k * 62, y, r, 0, Math.PI * 2);
          if (k < (o.pagas || 0)) { ctx.fillStyle = COR.verde; ctx.fill(); } else { ctx.lineWidth = 4; ctx.strokeStyle = COR.apagado; ctx.stroke(); }
        }
        ctx.font = fonte(700, 44); ctx.fillStyle = COR.papel;
        ctx.fillText(o.pagas ? o.pagas + ' de ' + o.dividas + ' etapas concluídas' : o.dividas + ' etapas, uma de cada vez', M, y + 90);
      }

      ctx.fillStyle = COR.apagado; ctx.fillRect(M, 1700, bw, 2);
      ctx.font = fonte(500, 36); ctx.fillStyle = COR.cinza; ctx.fillText('Faça o seu plano em 5 minutos:', M, 1772);
      ctx.font = fonte(800, 60); ctx.fillStyle = COR.papel; ctx.fillText('desaperto.com', M, 1846);
      return new Promise(function (ok) { c.toBlob(function (b) { ok(b); }, 'image/png'); });
    });
  }

  function compartilhar(blob) {
    var arq = new File([blob], 'meu-desaperto.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [arq] })) {
      return navigator.share({ files: [arq], title: 'Meu desaperto', text: 'Descubra a sua data em desaperto.com' }).then(function () { return 'compartilhou'; }, function () { return 'cancelou'; });
    }
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'meu-desaperto.png'; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return Promise.resolve('baixou');
  }

  // Mandar para alguém: mensagem discreta, de pessoa para pessoa (ninguém se expõe).
  var MSG_INDICAR = 'Achei isso e lembrei de você: em 5 minutos mostra em que mês dá para sair do aperto. É grátis: https://desaperto.com/?utm_source=whatsapp';
  function linkIndicar() { return 'https://wa.me/?text=' + encodeURIComponent(MSG_INDICAR); }

  // monta a área com a prévia, a escolha do texto e os botões
  function montar(alvo, o, contar) {
    var temMeta = !!(o.objetivo && String(o.objetivo).trim());
    o.variante = temMeta ? 'meta' : 'contagem';
    alvo.innerHTML = '<div class="cartao compartilhar"><h2>Conte para quem você quiser</h2>' +
      '<p class="pequeno">Uma imagem para o story ou o status. Não fala de dívida, não mostra valores nem o seu nome.</p>' +
      (temMeta ? '<div class="versoes" role="radiogroup" aria-label="Texto da imagem"><button type="button" class="versao" aria-pressed="true" data-v="meta">Com a minha meta</button><button type="button" class="versao" aria-pressed="false" data-v="contagem">Só a contagem</button></div>' : '') +
      '<img class="previa" alt="Prévia da imagem para o story" hidden>' +
      '<button type="button" class="btn" data-acao="story">Compartilhar a imagem</button><p class="pequeno aviso-c" hidden></p>' +
      '<a class="btn btn-zap" data-acao="indicar" href="' + linkIndicar() + '" target="_blank" rel="noopener">Mandar para alguém que precisa</a>' +
      '<p class="pequeno">Abre o WhatsApp com uma mensagem discreta. Você escolhe para quem.</p></div>';
    var img = alvo.querySelector('.previa'), av = alvo.querySelector('.aviso-c'), blob = null;
    function previa() { blob = null; gerar(o).then(function (b) { blob = b; if (img.src) URL.revokeObjectURL(img.src); img.src = URL.createObjectURL(b); img.hidden = false; }); }
    previa();
    alvo.querySelectorAll('.versao').forEach(function (b) {
      b.addEventListener('click', function () {
        alvo.querySelectorAll('.versao').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        o.variante = b.getAttribute('data-v'); previa();
      });
    });
    alvo.querySelector('[data-acao="story"]').addEventListener('click', function () {
      if (!blob) return;
      if (contar) contar('gerou_cartao');
      compartilhar(blob).then(function (r) {
        if (r === 'compartilhou' && contar) contar('compartilhou');
        if (r === 'baixou') { av.hidden = false; av.textContent = 'A imagem foi salva. Abra o Instagram ou o WhatsApp, crie um story ou status e escolha a imagem da galeria.'; }
      });
    });
    alvo.querySelector('[data-acao="indicar"]').addEventListener('click', function () { if (contar) contar('indicou'); });
  }

  window.DesapertoCartao = { gerar: gerar, compartilhar: compartilhar, montar: montar, linkIndicar: linkIndicar };
})();
