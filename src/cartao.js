// Cartão para o story (1080 x 1920): a contagem até o desaperto, com barra de progresso. Nunca mostra valores nem nome.
// Uso: DesapertoCartao.gerar({ total, feitos, pagas, dividas, fim_txt, aprox }) -> Promise<Blob>
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

      var fim = feitos >= total;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = COR.verde; ctx.font = fonte(600, 34, 'mono');
      var rotulo = fim ? 'DESAPERTEI' : feitos === 0 ? 'COMECEI O MEU DESAPERTO' : 'MÊS ' + feitos + ' DE ' + total + ' DO MEU DESAPERTO';
      if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '5px';
      ctx.fillText(rotulo, M, 560);
      if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';

      ctx.fillStyle = COR.papel;
      if (fim) {
        ctx.font = fonte(800, 190); ctx.fillText('Saí das', M - 6, 790); ctx.fillText('dívidas.', M - 6, 970);
      } else {
        ctx.font = fonte(800, 72); ctx.fillText(o.aprox ? 'Faltam cerca de' : 'Faltam', M, 680);
        ctx.font = fonte(800, 400); var n = String(faltam); ctx.fillText(n, M - 14, 1010);
        var lnum = ctx.measureText(n).width;
        ctx.font = fonte(800, 110); ctx.fillText(faltam === 1 ? 'mês' : 'meses', M + lnum + 10, 1010);
        ctx.font = fonte(700, 60); ctx.fillStyle = COR.claro; ctx.fillText('para eu sair das dívidas.', M, 1100);
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

      // dívidas pagas
      if (o.dividas > 1) {
        var y = 1560, r = 22, x = M + r;
        for (var k = 0; k < Math.min(o.dividas, 12); k++) {
          ctx.beginPath(); ctx.arc(x + k * 62, y, r, 0, Math.PI * 2);
          if (k < (o.pagas || 0)) { ctx.fillStyle = COR.verde; ctx.fill(); } else { ctx.lineWidth = 4; ctx.strokeStyle = COR.apagado; ctx.stroke(); }
        }
        ctx.font = fonte(700, 44); ctx.fillStyle = COR.papel;
        ctx.fillText(o.pagas ? o.pagas + ' de ' + o.dividas + ' dívidas pagas' : o.dividas + ' dívidas, uma de cada vez', M, y + 90);
      }

      ctx.fillStyle = COR.apagado; ctx.fillRect(M, 1700, bw, 2);
      ctx.font = fonte(500, 36); ctx.fillStyle = COR.cinza; ctx.fillText('Descubra a sua data em 5 minutos:', M, 1772);
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

  // monta a área com a prévia e o botão
  function montar(alvo, o, contar) {
    alvo.innerHTML = '<div class="cartao compartilhar"><h2>' + (o.feitos ? 'Mostre o seu progresso' : 'Conte que você começou') + '</h2>' +
      '<p class="pequeno">Uma imagem para o seu story, sem valores e sem o seu nome. Quem vê descobre a própria data.</p>' +
      '<img class="previa" alt="Prévia da imagem para o story" hidden>' +
      '<button type="button" class="btn">Compartilhar no story</button><p class="pequeno aviso-c" hidden></p></div>';
    var img = alvo.querySelector('.previa'), btn = alvo.querySelector('button'), av = alvo.querySelector('.aviso-c'), blob = null;
    gerar(o).then(function (b) { blob = b; img.src = URL.createObjectURL(b); img.hidden = false; });
    btn.addEventListener('click', function () {
      if (!blob) return;
      if (contar) contar('gerou_cartao');
      compartilhar(blob).then(function (r) {
        if (r === 'compartilhou' && contar) contar('compartilhou');
        if (r === 'baixou') { av.hidden = false; av.textContent = 'A imagem foi salva. Abra o Instagram, crie um story e escolha a imagem da galeria.'; }
      });
    });
  }

  window.DesapertoCartao = { gerar: gerar, compartilhar: compartilhar, montar: montar };
})();
