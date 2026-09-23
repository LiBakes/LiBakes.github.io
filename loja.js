/* =========================================================================
   Li Bakes - logica da loja
   Sem dependencias. Conteudo e definicoes vivem em produtos.json.
   ========================================================================= */
"use strict";

/* ------------------------------------------------------------ 1. omissao */
var PADRAO = {
  loja: {
    nome: "Li Bakes",
    lema: "Doçaria feita em casa, entregue ao domingo.",
    sobre: "Faço tudo de raiz, em quantidades pequenas, com manteiga a sério e sem pressa. Há uma fornada por semana, entregue ao domingo, para que nada chegue a ninguém com mais de um dia.",
    zona: "Entrega em Samora Correia, Benavente e arredores, combinada por mensagem.",
    localidade: "Samora Correia",
    whatsapp: "351900000000",
    instagram: "", facebook: "", email: "",
    semanas: 8, diaEntrega: 0, diaFecho: 3, horaFecho: 23,
    diasBloqueados: [], diasCheios: [],
    levantamento: true, entrega: false, moradaLevantamento: "", taxaEntrega: 0, entregaGratisAcima: 0,
    minimoEncomenda: 0,
    pagamentos: "MB WAY, transferência ou numerário na entrega",
    nif: "", livroReclamacoes: "",
    endpoint: "", pin: "", moeda: "EUR"
  },
  produtos: [],
  perguntas: [],
  testemunhos: []
};

var CHAVE_CFG = "libakes-config-v2";
var CHAVE_ENC = "libakes-encomendas-v2";
var CHAVE_CAR = "libakes-carrinho-v2";
var CHAVE_PIN = "libakes-pin-ok";

var CFG = JSON.parse(JSON.stringify(PADRAO));
var ENCOMENDAS = [];
var carrinho = {};
var abertos = {};
var dataEscolhida = null;
var modoEntrega = "levantamento";
var talaoAberto = null;
var ultimaEncomenda = null;
var abaGestao = "encomendas";
var semanaFolha = null;
var porPublicar = false;
var focoAnterior = null;
var semJson = false;

/* --------------------------------------------------------- 2. utilitarios */
function $(s, raiz) { return (raiz || document).querySelector(s); }
function $$(s, raiz) { return Array.prototype.slice.call((raiz || document).querySelectorAll(s)); }
function id() { return Math.random().toString(36).slice(2, 9); }

function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  var x = parseFloat(String(v == null ? "" : v).replace(/\s/g, "").replace(",", "."));
  return isNaN(x) ? 0 : x;
}
var FORMATO_EUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
function eur(v) { return FORMATO_EUR.format(isFinite(v) ? v : 0); }
function fmtNum(v) { return v === null || v === undefined || v === "" ? "" : String(v).replace(".", ","); }
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function lista(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  return String(v || "").split(/[,;]/).map(function (s) { return s.trim(); }).filter(Boolean);
}
function adiar(fn, ms) {
  var t = null;
  return function () {
    var args = arguments, ctx = this;
    clearTimeout(t);
    t = setTimeout(function () { fn.apply(ctx, args); }, ms);
  };
}

/* datas ------------------------------------------------------------------ */
var DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
function masculino(i) { return i === 0 || i === 6; }
function artigoDia(i) { return (masculino(i) ? "o " : "a ") + DIAS[i]; }
function aoDia(i) { return (masculino(i) ? "ao " : "à ") + DIAS[i]; }
function noDia(i) { return (masculino(i) ? "no " : "na ") + DIAS[i]; }

function iso(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function deIso(s) { var p = String(s).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
function maisDias(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
function hojeZero() { var h = new Date(); return new Date(h.getFullYear(), h.getMonth(), h.getDate()); }
function porExtenso(d, comAno) {
  return d.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long", year: comAno ? "numeric" : undefined });
}
function curta(d) { return d.toLocaleDateString("pt-PT", { day: "numeric", month: "short" }).replace(".", ""); }
function diasEntre(a, b) { return Math.round((b - a) / 86400000); }

function diaEntrega() { var d = Math.round(num(CFG.loja.diaEntrega)); return d >= 0 && d <= 6 ? d : 0; }
function diaFecho() { var d = Math.round(num(CFG.loja.diaFecho)); return d >= 0 && d <= 6 ? d : 3; }
function horaFecho() { var h = Math.round(num(CFG.loja.horaFecho)); return h >= 0 && h <= 23 ? h : 23; }
function diasAntes() { return ((diaEntrega() - diaFecho() + 7) % 7) || 7; }

function fecho(entrega) {
  var q = maisDias(entrega, -diasAntes());
  q.setHours(horaFecho(), 59, 59, 999);
  return q;
}
function proximasDatas(quantas) {
  var d = hojeZero(), alvo = diaEntrega(), saida = [];
  d.setDate(d.getDate() + (((alvo - d.getDay() + 7) % 7) || 7));
  for (var i = 0; i < quantas; i++) { saida.push(new Date(d.getTime())); d = maisDias(d, 7); }
  return saida;
}
/* Datas que ainda aceitam encomenda. As "fornadas cheias" continuam a
   aparecer, marcadas como esgotadas, para o cliente perceber porque nao pode. */
function datasAbertas() {
  var agora = new Date();
  var limite = Math.max(1, Math.round(num(CFG.loja.semanas)) || 8);
  var bloqueados = CFG.loja.diasBloqueados || [];
  return proximasDatas(limite + 16).filter(function (d) {
    return agora <= fecho(d) && bloqueados.indexOf(iso(d)) < 0;
  }).slice(0, limite);
}
function estaCheia(chave) { return (CFG.loja.diasCheios || []).indexOf(chave) >= 0; }
function datasSelecionaveis() { return datasAbertas().filter(function (d) { return !estaCheia(iso(d)); }); }

/* prazo minimo de cada produto -------------------------------------------- */
function prazoProduto(p) { return Math.max(0, Math.round(num(p.prazo))); }
function servePara(p, chave) {
  if (!chave) return true;
  if (Array.isArray(p.datas) && p.datas.length && p.datas.indexOf(chave) < 0) return false;
  return diasEntre(hojeZero(), deIso(chave)) >= prazoProduto(p);
}

/* ------------------------------------------------------ 3. carregar/guardar */
function aplicar(cfg) {
  var l = Object.assign({}, PADRAO.loja, (cfg && cfg.loja) || {});
  CFG = {
    loja: l,
    produtos: (cfg && Array.isArray(cfg.produtos) ? cfg.produtos : PADRAO.produtos).filter(function (p) { return p && p.id; }),
    perguntas: (cfg && Array.isArray(cfg.perguntas)) ? cfg.perguntas : [],
    testemunhos: (cfg && Array.isArray(cfg.testemunhos)) ? cfg.testemunhos : []
  };
}
function paraPublicar() {
  return { loja: CFG.loja, produtos: CFG.produtos, perguntas: CFG.perguntas, testemunhos: CFG.testemunhos };
}
function guardar(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); return true; }
  catch (e) { return false; }
}
var escreverCfg = adiar(function () {
  if (!guardar(CHAVE_CFG, { alterado: true, dados: CFG })) {
    avisar("Não consegui guardar: o armazenamento do navegador está cheio. Publique e retire fotografias pesadas.");
  }
}, 350);
function guardarCfg() { porPublicar = true; escreverCfg(); }
function guardarEnc() { guardar(CHAVE_ENC, ENCOMENDAS); }
var guardarCarrinho = adiar(function () {
  guardar(CHAVE_CAR, { itens: carrinho, data: dataEscolhida, modo: modoEntrega });
}, 250);

function arrancar() {
  var local = null;
  try {
    local = JSON.parse(localStorage.getItem(CHAVE_CFG) || "null");
    ENCOMENDAS = JSON.parse(localStorage.getItem(CHAVE_ENC) || "[]");
    var c = JSON.parse(localStorage.getItem(CHAVE_CAR) || "null");
    if (c && c.itens) { carrinho = c.itens; dataEscolhida = c.data || null; modoEntrega = c.modo || modoEntrega; }
  } catch (e) { ENCOMENDAS = []; }

  function pronto() {
    modoEntrega = modoPermitido(modoEntrega);
    desenharSite();
    ligarRevelacao();
    if (location.hash === "#gestao") abrirGestao();
    else verLigacaoTalao();
  }
  if (local && local.alterado && local.dados) { aplicar(local.dados); porPublicar = true; return pronto(); }
  fetch("produtos.json", { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error("sem ficheiro"); return r.json(); })
    .then(function (j) { aplicar(j); pronto(); })
    .catch(function () {
      semJson = !(local && local.dados);
      aplicar(local && local.dados ? local.dados : PADRAO);
      pronto();
    });
}

/* Formas de recolha activas. A loja pode ter so levantamento, so entrega
   ao domicilio, ou as duas. */
function haLevantamento() { return CFG.loja.levantamento !== false; }
function haEntrega() { return CFG.loja.entrega === true; }
function modoPermitido(m) {
  if (m === "entrega" && haEntrega()) return "entrega";
  if (m === "levantamento" && haLevantamento()) return "levantamento";
  return haLevantamento() ? "levantamento" : "entrega";
}
/* Palavra a usar no site: com entrega ao domicilio fala-se de entrega,
   so com levantamento seria enganador. */
function palavraRecolha(maiuscula) {
  var p = haEntrega() ? "entrega" : "levantamento";
  return maiuscula ? p.charAt(0).toUpperCase() + p.slice(1) : p;
}

/* ------------------------------------------------------- 4. site publico */
function ativos() { return CFG.produtos.filter(function (p) { return p.ativo !== false; }); }
function variantes(p) { return (p.variantes || []).filter(function (v) { return v.ativo !== false; }); }
function precoVar(p, v) {
  return v.preco === "" || v.preco === null || v.preco === undefined ? num(p.preco) : num(v.preco);
}
function faixaPreco(p) {
  var vs = variantes(p);
  if (!vs.length) return { min: num(p.preco), varios: false };
  var precos = vs.map(function (v) { return precoVar(p, v); });
  var mi = Math.min.apply(null, precos), ma = Math.max.apply(null, precos);
  return { min: mi, varios: ma > mi };
}

function desenharSite() {
  var L = CFG.loja;
  document.title = L.nome + " · Doçaria caseira" + (L.localidade ? " em " + L.localidade : "") + ", por encomenda";
  $("#nav-nome").textContent = L.nome;
  $("#rodape-nome").textContent = L.nome;
  $("#lema").textContent = L.lema || "";
  $("#assinatura").textContent = [L.localidade, palavraRecolha() + " " + aoDia(diaEntrega())].filter(Boolean).join(" · ");
  $("#sobre-texto").textContent = L.sobre || "";
  $("#sobre-titulo").textContent = "Feito de raiz, sem pressa";
  $("#rodape-entrega").textContent = L.zona || "";
  $("#nota-produtos").textContent = "Os preços são por " +
    "peça inteira, salvo indicação em contrário. Tudo é feito na véspera da entrega.";
  $("#nota-alergenios").innerHTML = "Todos os produtos são preparados na mesma cozinha, onde se usam " +
    "cereais com glúten, ovos, leite e frutos de casca rija. " +
    '<a href="#alergenios" data-acao="ver-alergenios">Informação sobre alergénios</a>.';

  $("#passo-1").textContent = "Escolhe o que quer e " + artigoDia(diaEntrega()) + " em que prefere " +
    (haEntrega() ? "receber" : "levantar") + ". Pode encomendar com semanas de antecedência.";
  $("#passo-2").textContent = "As encomendas de cada " + DIAS[diaEntrega()] + " fecham " +
    noDia(diaFecho()) + " anterior, às " + horaFecho() + "h59, para dar tempo de comprar tudo fresco.";
  $("#passo-3").textContent = "Envia o pedido, eu confirmo por mensagem e combinamos " +
    (haEntrega() ? "a entrega" : "o levantamento") + " e o pagamento" +
    (L.pagamentos ? " (" + L.pagamentos + ")" : "") + ".";
  $("#titulo-data").textContent = "Para que " + DIAS[diaEntrega()] + "?";

  desenharPilares();
  desenharRedes();
  desenharLegal();
  desenharProdutos();
  desenharVitrine();
  desenharDatas();
  desenharOpcoesEntrega();
  desenharResumo();
  desenharFaixa();
  desenharPerguntas();
  desenharTestemunhos();
  dadosEstruturados();
}

function desenharPilares() {
  var L = CFG.loja;
  var pilares = [
    ["Uma fornada por semana", "Tudo é feito de raiz na véspera da entrega, em quantidades pequenas."],
    ["Só por encomenda", "Nada fica em montra à espera de comprador. Faz-se o que foi pedido."],
    [palavraRecolha(true) + " " + aoDia(diaEntrega()), L.zona || ""]
  ];
  $("#pilares").innerHTML = pilares.map(function (p) {
    return '<div class="pilar"><h3>' + esc(p[0]) + "</h3><p>" + esc(p[1]) + "</p></div>";
  }).join("");
}

function rede(url, nome, simbolo) {
  return '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" aria-label="' + esc(nome) +
    '"><svg aria-hidden="true"><use href="#' + simbolo + '"/></svg></a>';
}
function telefoneVisivel(w) {
  var s = String(w || "").replace(/\D/g, "");
  if (s.indexOf("351") === 0) s = s.slice(3);
  return s.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
}
function temWhatsapp() {
  var w = String(CFG.loja.whatsapp || "").replace(/\D/g, "");
  return w && w !== "351900000000" ? w : "";
}
function desenharRedes() {
  var L = CFG.loja, h = "";
  if (L.instagram) h += rede(L.instagram, "Instagram", "s-instagram");
  if (L.facebook) h += rede(L.facebook, "Facebook", "s-facebook");
  if (temWhatsapp()) h += rede("https://wa.me/" + temWhatsapp(), "WhatsApp", "s-whatsapp");
  if (L.email) h += rede("mailto:" + L.email, "Email", "s-email");
  $("#redes").innerHTML = h;
  var contactos = [];
  if (temWhatsapp()) contactos.push(telefoneVisivel(L.whatsapp));
  if (L.email) contactos.push(L.email);
  $("#rodape-contacto").textContent = contactos.join("  ·  ");
}
function desenharLegal() {
  var L = CFG.loja, h = "";
  h += '<a href="#privacidade" data-acao="ver-privacidade">Privacidade</a>';
  h += '<a href="#alergenios" data-acao="ver-alergenios">Alergénios</a>';
  if (L.livroReclamacoes) {
    h += '<a href="' + esc(L.livroReclamacoes) + '" target="_blank" rel="noopener noreferrer">Livro de reclamações</a>';
  }
  if (L.nif) h += "<span>NIF " + esc(L.nif) + "</span>";
  h += "<span>© " + new Date().getFullYear() + " " + esc(L.nome) + "</span>";
  $("#legal").innerHTML = h;
}

function desenharFaixa() {
  var abertas = datasAbertas(), alvo = $("#faixa-fornada");
  if (!abertas.length) {
    alvo.innerHTML = '<span class="conta">Encomendas temporariamente fechadas. Escreva-me pelas redes sociais.</span>';
    return;
  }
  var proxima = abertas[0], q = fecho(proxima);
  var cheia = estaCheia(iso(proxima));
  var restam = Math.ceil((q - new Date()) / 3600000);
  var contagem = cheia ? "fornada completa"
    : restam <= 24 ? "faltam " + Math.max(1, restam) + (restam === 1 ? " hora" : " horas")
      : "faltam " + Math.ceil(restam / 24) + " dias";
  alvo.innerHTML =
    '<div class="peca"><span class="chave">Próxima fornada</span><b>' + esc(porExtenso(proxima)) + "</b></div>" +
    '<div class="peca"><span class="chave">Encomendas até</span><span class="conta">' +
    esc(porExtenso(q)) + ", " + horaFecho() + "h59 <b class='urgente' style='font-size:13px'>(" + contagem + ")</b></span></div>";
}

function qtdProduto(p) {
  var t = carrinho[p.id] || 0;
  variantes(p).forEach(function (v) { t += carrinho[p.id + "|" + v.id] || 0; });
  return t;
}
function marcas(o) {
  return (o.novo ? '<span class="etiqueta nova">nova fornada</span>' : "") +
    (o.destaque ? '<span class="etiqueta dest">mais pedido</span>' : "");
}
function caixaFoto(o, classe, alt) {
  var h = '<div class="' + classe + (o.imagem ? '" data-lupa="' + esc(o.imagem) + '" title="Ver maior' : "") + '">';
  h += '<svg class="selo-vazio" aria-hidden="true"><use href="#s-marca"/></svg>';
  if (o.imagem) {
    h += '<img src="' + esc(o.imagem) + '" alt="' + esc(alt || o.nome) +
      '" loading="lazy" decoding="async" onerror="this.remove()">';
  }
  return h + "</div>";
}
function passo(chave, permitido) {
  var q = carrinho[chave] || 0;
  return '<div class="passo' + (q ? "" : " zero") + '">' +
    '<button type="button" data-menos="' + chave + '" aria-label="Menos"' + (q ? "" : " disabled") + ">&minus;</button>" +
    "<b>" + q + "</b>" +
    '<button type="button" data-mais="' + chave + '" aria-label="Mais"' + (permitido ? "" : " disabled") + ">+</button></div>";
}

function desenharProdutos() {
  var lista = ativos();
  if (!lista.length) {
    $("#lista-produtos").innerHTML = '<p class="mini">' + (semJson
      ? "Não consegui ler o ficheiro produtos.json. A abrir o site directamente do disco isto é normal: " +
        "os navegadores bloqueiam a leitura de ficheiros locais. Publique no GitHub, ou use um servidor local, " +
        "e a montra aparece."
      : "Ainda não há produtos publicados.") + "</p>";
    return;
  }
  var comFotos = lista.some(function (p) {
    return p.imagem || variantes(p).some(function (v) { return v.imagem; });
  });
  $("#lista-produtos").className = "lista" + (comFotos ? "" : " sem-fotos");
  $("#lista-produtos").innerHTML = lista.map(function (p) {
    var vs = variantes(p), pr = faixaPreco(p), q = qtdProduto(p), aberto = !!abertos[p.id];
    var disponivel = p.esgotado !== true && servePara(p, dataEscolhida);
    var h = '<div class="produto' + (aberto ? " aberto" : "") + (disponivel ? "" : " indisponivel") + '">' +
      '<div class="item">' + (comFotos ? caixaFoto(p, "foto") : "") +
      '<div class="item-txt"><h3><button type="button" data-ficha="' + p.id +
      '" title="Ver ficha, ingredientes e alergénios">' + esc(p.nome) + "</button>" +
      marcas(p) + (prazoProduto(p) ? '<span class="etiqueta prazo">' + prazoProduto(p) + " dias de aviso</span>" : "") + "</h3>" +
      (p.descricao ? "<p>" + esc(p.descricao) + "</p>" : "") + "</div>" +
      '<div class="item-dir"><div class="preco">' + (pr.varios ? "<small>desde </small>" : "") + eur(pr.min) +
      (p.unidade ? " <small>/ " + esc(p.unidade) + "</small>" : "") + "</div>";
    if (p.esgotado === true) {
      h += '<span class="esgotado-txt">Esgotado</span>';
    } else if (!servePara(p, dataEscolhida)) {
      h += '<span class="esgotado-txt">' + (prazoProduto(p) ? "Precisa de " + prazoProduto(p) + " dias" : "Noutra data") + "</span>";
    } else if (vs.length) {
      h += '<button type="button" class="ver" data-abrir="' + p.id + '" aria-expanded="' + (aberto ? "true" : "false") + '">' +
        (aberto ? "Fechar" : (q ? q + (q > 1 ? " escolhidos" : " escolhido") : "Ver sabores")) + "</button>";
    } else {
      h += passo(p.id, true);
    }
    h += "</div></div>";
    if (vs.length) {
      h += '<div class="sub">' + vs.map(function (v) {
        return '<div class="sub-linha">' +
          (comFotos && v.imagem ? caixaFoto(v, "sub-foto", p.nome + " " + v.nome) : "") +
          '<div class="sub-txt"><b>' + esc(v.nome) + "</b>" + marcas(v) +
          (v.descricao ? "<small>" + esc(v.descricao) + "</small>" : "") + "</div>" +
          '<div class="sub-preco">' + eur(precoVar(p, v)) + "</div>" +
          passo(p.id + "|" + v.id, disponivel) + "</div>";
      }).join("") + "</div>";
    }
    return h + "</div>";
  }).join("");
}

function desenharVitrine() {
  var fotos = [];
  ativos().forEach(function (p) {
    if (p.imagem) fotos.push({ src: p.imagem, alt: p.nome });
    variantes(p).forEach(function (v) { if (v.imagem) fotos.push({ src: v.imagem, alt: p.nome + " " + v.nome }); });
  });
  var sec = $("#vitrine");
  if (fotos.length < 4) { sec.hidden = true; return; }
  sec.hidden = false;
  $("#grelha-vitrine").innerHTML = fotos.slice(0, 12).map(function (f) {
    return '<button type="button" data-lupa="' + esc(f.src) + '" aria-label="Ver ' + esc(f.alt) + '">' +
      '<img src="' + esc(f.src) + '" alt="' + esc(f.alt) + '" loading="lazy" decoding="async"></button>';
  }).join("");
}

function desenharDatas() {
  var abertas = datasAbertas(), alvo = $("#datas");
  if (!abertas.length) {
    alvo.innerHTML = '<p class="mini">De momento não há datas abertas. Escreva-me pelas redes sociais.</p>';
    dataEscolhida = null;
    return;
  }
  var validas = datasSelecionaveis().map(iso);
  if (!dataEscolhida || validas.indexOf(dataEscolhida) < 0) dataEscolhida = validas[0] || null;
  alvo.innerHTML = abertas.map(function (d) {
    var k = iso(d), cheia = estaCheia(k);
    return '<button type="button" class="data" data-data="' + k + '"' +
      ' aria-pressed="' + (k === dataEscolhida ? "true" : "false") + '"' + (cheia ? " disabled" : "") + ">" +
      '<span class="semana">' + esc(d.toLocaleDateString("pt-PT", { weekday: "short" }).replace(".", "")) + "</span>" +
      '<span class="dia">' + esc(curta(d)) + "</span>" +
      '<span class="fecha">' + (cheia ? "fornada cheia" : "fecha " + esc(curta(fecho(d)))) + "</span></button>";
  }).join("");
}

function desenharOpcoesEntrega() {
  var L = CFG.loja, alvo = $("#opcoes-entrega");
  modoEntrega = modoPermitido(modoEntrega);
  if (!haLevantamento() || !haEntrega()) {
    alvo.innerHTML = "";
    $("#campo-morada").hidden = modoEntrega !== "entrega";
    return;
  }
  var taxa = num(L.taxaEntrega);
  var opcoes = [
    ["levantamento", "Levantamento", L.moradaLevantamento || "Combinado por mensagem"],
    ["entrega", "Entrega", taxa > 0 ? eur(taxa) + (num(L.entregaGratisAcima) > 0 ? ", grátis acima de " + eur(num(L.entregaGratisAcima)) : "") : "Sem custo"]
  ];
  alvo.innerHTML = opcoes.map(function (o) {
    return '<button type="button" class="opcao" data-modo="' + o[0] + '" aria-pressed="' +
      (modoEntrega === o[0] ? "true" : "false") + '"><b>' + esc(o[1]) + "</b><small>" + esc(o[2]) + "</small></button>";
  }).join("");
  $("#campo-morada").hidden = modoEntrega !== "entrega";
}

/* carrinho --------------------------------------------------------------- */
function itensCarrinho() {
  var saida = [];
  ativos().forEach(function (p) {
    if ((carrinho[p.id] || 0) > 0) {
      saida.push({ chave: p.id, produto: p, nome: p.nome, preco: num(p.preco), qtd: carrinho[p.id], serve: servePara(p, dataEscolhida) });
    }
    variantes(p).forEach(function (v) {
      var k = p.id + "|" + v.id;
      if ((carrinho[k] || 0) > 0) {
        saida.push({ chave: k, produto: p, nome: p.nome + " · " + v.nome, preco: precoVar(p, v), qtd: carrinho[k], serve: servePara(p, dataEscolhida) });
      }
    });
  });
  return saida;
}
function subtotal() {
  return itensCarrinho().reduce(function (s, i) { return s + i.preco * i.qtd; }, 0);
}
function taxaAplicada() {
  var L = CFG.loja;
  if (modoEntrega !== "entrega") return 0;
  var taxa = num(L.taxaEntrega), gratis = num(L.entregaGratisAcima);
  if (!taxa) return 0;
  if (gratis > 0 && subtotal() >= gratis) return 0;
  return taxa;
}
function total() { return subtotal() + taxaAplicada(); }

function desenharResumo() {
  var itens = itensCarrinho(), L = CFG.loja, h = "<h3>A sua encomenda</h3>";
  if (!itens.length) {
    h += '<p class="vazio-resumo">Ainda não escolheu nada. Use o mais junto a cada produto.</p>';
  } else {
    h += "<ul>" + itens.map(function (i) {
      return "<li><span>" + i.qtd + " &times; " + esc(i.nome) +
        (i.serve ? "" : '<br><small style="color:var(--tijolo)">precisa de ' + prazoProduto(i.produto) + " dias de aviso</small>") +
        "</span><b>" + eur(i.preco * i.qtd) + "</b></li>";
    }).join("") + "</ul>";
    if (taxaAplicada() > 0) {
      h += '<div class="linha-extra"><span>Entrega</span><span>' + eur(taxaAplicada()) + "</span></div>";
    } else if (modoEntrega === "entrega" && num(L.taxaEntrega) > 0) {
      h += '<div class="linha-extra"><span>Entrega</span><span>grátis</span></div>';
    }
  }
  var d = dataEscolhida ? deIso(dataEscolhida) : null;
  h += '<div class="total"><span>' + (d ? palavraRecolha(true) + " " + esc(porExtenso(d)) : "Escolha a data") +
    "</span><b>" + eur(total()) + "</b></div>";
  var minimo = num(L.minimoEncomenda);
  if (minimo > 0 && subtotal() > 0 && subtotal() < minimo) {
    h += '<p class="mini" style="margin-top:8px;color:var(--tijolo)">Encomenda mínima de ' + eur(minimo) +
      ". Faltam " + eur(minimo - subtotal()) + ".</p>";
  }
  h += '<button type="button" class="botao" data-acao="enviar">' +
    '<svg aria-hidden="true"><use href="#s-whatsapp"/></svg>Enviar pelo WhatsApp</button>';
  h += '<button type="button" class="botao linha" data-acao="copiar">Copiar a encomenda</button>';
  h += '<p class="erro" id="erro-form" role="alert"></p><div id="pos-envio"></div>';
  $("#resumo").innerHTML = h;
  desenharBarra();
}

var MEDIA_ESTREITA = window.matchMedia ? window.matchMedia("(max-width: 940px)") : { matches: false };
function desenharBarra() {
  var barra = $("#barra-carrinho"), itens = itensCarrinho();
  var n = itens.reduce(function (s, i) { return s + i.qtd; }, 0);
  /* no ecra largo o resumo fixo ja mostra o total, a barra so estorvaria */
  var mostrar = n > 0 && MEDIA_ESTREITA.matches;
  barra.hidden = !mostrar;
  barra.classList.toggle("visivel", mostrar);
  document.body.classList.toggle("tem-barra", mostrar);
  $("#barra-total").textContent = eur(total());
  $("#barra-detalhe").textContent = n ? n + (n === 1 ? " artigo" : " artigos") +
    (dataEscolhida ? " · " + curta(deIso(dataEscolhida)) : "") : "sem artigos";
  $("#estado-carrinho").textContent = n
    ? "Encomenda: " + n + (n === 1 ? " artigo" : " artigos") + ", total " + eur(total()) + "."
    : "Encomenda vazia.";
}

function desenharPerguntas() {
  var sec = $("#perguntas"), qs = (CFG.perguntas || []).filter(function (q) { return q && q.p; });
  if (!qs.length) { sec.hidden = true; return; }
  sec.hidden = false;
  $("#lista-perguntas").innerHTML = qs.map(function (q) {
    return "<details><summary>" + esc(q.p) + '</summary><div class="resposta">' + esc(q.r || "") + "</div></details>";
  }).join("");
}
function desenharTestemunhos() {
  var sec = $("#testemunhos"), ts = (CFG.testemunhos || []).filter(function (t) { return t && t.texto; });
  if (!ts.length) { sec.hidden = true; return; }
  sec.hidden = false;
  $("#lista-testemunhos").innerHTML = ts.slice(0, 3).map(function (t) {
    return '<div class="testemunho"><p>' + esc(t.texto) + "</p>" +
      (t.autor ? "<cite>" + esc(t.autor) + "</cite>" : "") + "</div>";
  }).join("");
}

function dadosEstruturados() {
  var L = CFG.loja;
  var dados = {
    "@context": "https://schema.org",
    "@type": "Bakery",
    name: L.nome,
    description: L.sobre,
    image: location.origin + location.pathname.replace(/index\.html$/, "") + "partilha.jpg",
    address: { "@type": "PostalAddress", addressLocality: L.localidade || "Samora Correia", addressCountry: "PT" },
    areaServed: L.zona,
    currenciesAccepted: "EUR",
    priceRange: "€€",
    makesOffer: ativos().slice(0, 12).map(function (p) {
      return {
        "@type": "Offer",
        itemOffered: { "@type": "Product", name: p.nome, description: p.descricao || "" },
        price: faixaPreco(p).min.toFixed(2),
        priceCurrency: "EUR",
        availability: p.esgotado ? "https://schema.org/OutOfStock" : "https://schema.org/PreOrder"
      };
    })
  };
  if (temWhatsapp()) dados.telephone = "+" + temWhatsapp();
  if (L.email) dados.email = L.email;
  var perfis = [L.instagram, L.facebook].filter(Boolean);
  if (perfis.length) dados.sameAs = perfis;
  $("#dados-estruturados").textContent = JSON.stringify(dados);
}

/* ---------------------------------------------------------- 5. dialogos */
function focaveis(raiz) {
  return $$('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])', raiz)
    .filter(function (e) { return e.offsetParent !== null; });
}
function abrirDialogo(elem) {
  focoAnterior = document.activeElement;
  elem.hidden = false;
  elem.classList.add("aberto");
  document.body.classList.add("travado");
  var alvos = focaveis(elem);
  if (alvos.length) alvos[0].focus();
}
function fecharDialogo(elem) {
  elem.classList.remove("aberto");
  elem.hidden = true;
  if (!$$(".velo.aberto,.painel.aberto,.lupa.aberto").length) document.body.classList.remove("travado");
  if (focoAnterior && focoAnterior.focus) { focoAnterior.focus(); focoAnterior = null; }
}
function fecharTodosDialogos() {
  $$(".velo.aberto").forEach(fecharDialogo);
  var lupa = $("#lupa");
  if (lupa.classList.contains("aberto")) fecharDialogo(lupa);
}
var temporizadorAviso = null;
function avisar(texto) {
  var el = $("#aviso");
  el.textContent = texto;
  el.classList.add("visivel");
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(function () { el.classList.remove("visivel"); }, 4200);
}
function dialogoTexto(titulo, html) {
  $("#texto-titulo").textContent = titulo;
  $("#texto-corpo").innerHTML = html;
  abrirDialogo($("#velo-texto"));
}
function abrirLupa(src, alt) {
  $("#lupa-img").src = src;
  $("#lupa-img").alt = alt || "";
  abrirDialogo($("#lupa"));
}

function abrirFicha(idProduto) {
  var p = CFG.produtos.filter(function (x) { return x.id === idProduto; })[0];
  if (!p) return;
  var vs = variantes(p), pr = faixaPreco(p), al = lista(p.alergenios);
  var h = "";
  if (p.imagem) h += '<img class="ficha-foto" src="' + esc(p.imagem) + '" alt="' + esc(p.nome) + '">';
  h += '<p class="lede" style="font-size:19px">' + esc(p.descricao || "") + "</p>";
  h += '<div class="ficha-bloco"><h4>Preço</h4><p>' + (pr.varios ? "desde " : "") + eur(pr.min) +
    (p.unidade ? " por " + esc(p.unidade) : "") + "</p></div>";
  if (p.ingredientes) h += '<div class="ficha-bloco"><h4>Ingredientes</h4><p>' + esc(p.ingredientes) + "</p></div>";
  h += '<div class="ficha-bloco"><h4>Alergénios</h4>' +
    (al.length ? '<div class="alergenios"><span class="alergenio">' + al.map(esc).join('</span><span class="alergenio">') + "</span></div>"
      : '<p class="mini">Ainda não indicado. Pergunte antes de encomendar.</p>') +
    '<p class="mini" style="margin-top:8px">Preparado numa cozinha onde se usam cereais com glúten, ovos, leite e frutos de casca rija.</p></div>';
  if (p.conservacao) h += '<div class="ficha-bloco"><h4>Conservação</h4><p>' + esc(p.conservacao) + "</p></div>";
  if (prazoProduto(p)) {
    h += '<div class="ficha-bloco"><h4>Aviso prévio</h4><p>Este produto precisa de ' + prazoProduto(p) +
      " dias de antecedência.</p></div>";
  }
  if (vs.length) {
    h += '<div class="ficha-bloco"><h4>Sabores</h4><ul style="margin:0;padding-left:18px">' +
      vs.map(function (v) {
        return "<li>" + esc(v.nome) + (v.descricao ? " — " + esc(v.descricao) : "") + " · " + eur(precoVar(p, v)) + "</li>";
      }).join("") + "</ul></div>";
  }
  h += '<button type="button" class="botao" data-acao="fechar-dialogo">Voltar à montra</button>';
  $("#ficha-titulo").textContent = p.nome;
  $("#ficha-corpo").innerHTML = h;
  abrirDialogo($("#velo-ficha"));
}

function textoPrivacidade() {
  var L = CFG.loja;
  return "<p>Quando envia uma encomenda, " + esc(L.nome) + " recebe o seu nome, o seu contacto telefónico, " +
    "a data escolhida e as notas que escrever. Esses dados servem apenas para preparar e entregar a encomenda " +
    "e para falar consigo sobre ela.</p>" +
    "<p>A mensagem é enviada pela aplicação que escolher (por exemplo o WhatsApp) e fica guardada nessa aplicação " +
    "e no equipamento de quem gere a loja. Não há registo nem conta neste site e nada é partilhado com terceiros " +
    "para fins comerciais.</p>" +
    "<p>Pode pedir a qualquer momento que os seus dados sejam apagados" +
    (L.email ? ", escrevendo para " + esc(L.email) : ", pelo mesmo contacto onde encomendou") + ".</p>" +
    '<button type="button" class="botao" data-acao="fechar-dialogo">Percebi</button>';
}
function textoAlergenios() {
  var linhas = ativos().map(function (p) {
    var al = lista(p.alergenios);
    return "<tr><td style='padding:7px 0;border-bottom:1px dotted var(--linha)'>" + esc(p.nome) +
      "</td><td style='padding:7px 0;border-bottom:1px dotted var(--linha);color:var(--nevoa)'>" +
      (al.length ? esc(al.join(", ")) : "a confirmar") + "</td></tr>";
  }).join("");
  return "<p>A lei obriga a informar sobre alergénios antes da compra, mesmo à distância. " +
    "Esta é a informação disponível para cada produto.</p>" +
    "<table style='width:100%;border-collapse:collapse;font-size:14px'>" + linhas + "</table>" +
    "<p class='mini' style='margin-top:14px'>Tudo é feito na mesma cozinha doméstica, onde se manuseiam cereais com " +
    "glúten, ovos, leite, frutos de casca rija, soja e sementes de sésamo. Não é possível garantir ausência de " +
    "vestígios. Em caso de alergia grave, fale comigo antes de encomendar.</p>" +
    '<button type="button" class="botao" data-acao="fechar-dialogo">Fechar</button>';
}

/* ------------------------------------------------------- 6. encomendar */
function validar() {
  var L = CFG.loja;
  if (!dataEscolhida) return "Escolha " + artigoDia(diaEntrega()) + " da entrega.";
  var itens = itensCarrinho();
  if (!itens.length) return "Escolha pelo menos um produto.";
  var fora = itens.filter(function (i) { return !i.serve; });
  if (fora.length) return "“" + fora[0].nome + "” precisa de mais dias de aviso. Escolha outra data ou retire-o.";
  var minimo = num(L.minimoEncomenda);
  if (minimo > 0 && subtotal() < minimo) return "A encomenda mínima é de " + eur(minimo) + ".";
  if (!$("#f-nome").value.trim()) return "Falta o nome.";
  if ($("#f-tel").value.replace(/\D/g, "").length < 9) return "O telemóvel parece incompleto.";
  if (modoEntrega === "entrega" && !$("#f-morada").value.trim()) return "Falta a morada de entrega.";
  if (!$("#f-consente").checked) return "Precisa de autorizar o uso do nome e contacto para tratar da encomenda.";
  return "";
}
function marcarInvalidos(erro) {
  $$("#form-encomenda input,#form-encomenda textarea").forEach(function (e) { e.removeAttribute("aria-invalid"); });
  if (/nome/i.test(erro)) $("#f-nome").setAttribute("aria-invalid", "true");
  if (/telem/i.test(erro)) $("#f-tel").setAttribute("aria-invalid", "true");
  if (/morada/i.test(erro)) $("#f-morada").setAttribute("aria-invalid", "true");
}

function construirEncomenda() {
  var itens = itensCarrinho().map(function (i) {
    return { id: i.chave, nome: i.nome, preco: i.preco, qtd: i.qtd };
  });
  var base = {
    nome: $("#f-nome").value.trim(),
    telefone: $("#f-tel").value.trim(),
    data: dataEscolhida,
    modo: modoEntrega,
    morada: modoEntrega === "entrega" ? $("#f-morada").value.trim() : "",
    notas: $("#f-notas").value.trim(),
    itens: itens,
    taxa: taxaAplicada()
  };
  var codigo = codificar(paraCompacto(base));
  return Object.assign({}, base, {
    id: hashCurto(codigo), codigo: codigo, total: total(),
    estado: "nova", criado: new Date().toISOString()
  });
}
function textoEncomenda(e) {
  var L = CFG.loja, t = "Encomenda " + L.nome + "\n";
  t += "Nome: " + e.nome + "\n";
  t += "Telefone: " + e.telefone + "\n";
  t += palavraRecolha(true) + ": " + porExtenso(deIso(e.data), true) + " [" + e.data + "]\n";
  t += "Recolha: " + (e.modo === "entrega" ? "entrega em " + (e.morada || "morada a combinar") : "levantamento") + "\n";
  t += "Itens:\n";
  e.itens.forEach(function (i) { t += "- " + i.qtd + " x " + i.nome + " (" + eur(i.preco) + ")\n"; });
  if (num(e.taxa) > 0) t += "Entrega: " + eur(num(e.taxa)) + "\n";
  t += "Total: " + eur(num(e.total)) + "\n";
  t += "Notas: " + (e.notas || "-") + "\n";
  t += "Talão: " + enderecoBase() + "#enc=" + e.codigo + "\n";
  return t;
}

function enviarEncomenda(acao) {
  var erro = validar();
  $("#erro-form").textContent = erro;
  marcarInvalidos(erro);
  if (erro) { avisar(erro); return; }

  var e = construirEncomenda();
  ultimaEncomenda = e;
  var texto = textoEncomenda(e);
  publicarNoEndpoint(e, texto);

  if (acao === "copiar") {
    copiar(texto);
    mostrarPosEnvio("Encomenda copiada. Pode colar numa mensagem para a " + esc(CFG.loja.nome) + ".");
    return;
  }
  var w = temWhatsapp();
  if (!w) {
    copiar(texto);
    mostrarPosEnvio("Ainda não há número de WhatsApp configurado. A encomenda foi copiada para poder ser enviada por mensagem.");
    return;
  }
  window.open("https://wa.me/" + w + "?text=" + encodeURIComponent(texto), "_blank", "noopener");
  mostrarPosEnvio("Abri o WhatsApp com a encomenda escrita. É só carregar em enviar. " +
    "A encomenda só fica confirmada depois da minha resposta.");
}
function mostrarPosEnvio(msg) {
  $("#pos-envio").innerHTML = '<div class="ok-envio">' + msg + "</div>" +
    '<button type="button" class="botao linha" data-acao="talao-cliente">Ver o meu talão</button>' +
    '<button type="button" class="botao linha" data-acao="calendario">Juntar ao calendário</button>';
}
/* Envio opcional para um endpoint (Formspree, Apps Script, etc.). Se o campo
   estiver vazio o site comporta-se exactamente como antes. */
function publicarNoEndpoint(e, texto) {
  var url = String(CFG.loja.endpoint || "").trim();
  if (!url || !window.fetch) return;
  try {
    fetch(url, {
      method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ origem: "site", encomenda: e, texto: texto })
    }).catch(function () {});
  } catch (err) {}
}
function ficheiroCalendario(e) {
  var d = deIso(e.data), fim = maisDias(d, 1);
  function z(x) { return iso(x).replace(/-/g, ""); }
  var linhas = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Li Bakes//PT", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT", "UID:" + e.id + "@libakes", "DTSTAMP:" + z(new Date()) + "T090000Z",
    "DTSTART;VALUE=DATE:" + z(d), "DTEND;VALUE=DATE:" + z(fim),
    "SUMMARY:Encomenda " + CFG.loja.nome,
    "DESCRIPTION:" + e.itens.map(function (i) { return i.qtd + "x " + i.nome; }).join(", ").replace(/,/g, "\\,"),
    "END:VEVENT", "END:VCALENDAR"
  ];
  descarregar(linhas.join("\r\n"), "entrega-" + e.data + ".ics", "text/calendar");
}

function copiar(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(function () { avisar("Copiado."); }).catch(function () {});
    return;
  }
  var ta = document.createElement("textarea");
  ta.value = t; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); avisar("Copiado."); } catch (e) {}
  ta.remove();
}
function guardarFicheiro(blob, nome) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
}
/* No site publicado no GitHub corre o caminho normal. Dentro de uma pagina
   alojada no claude.ai a descarga directa e inerte, e ha uma via propria. */
function descarregar(texto, nome, tipo) {
  var blob = texto instanceof Blob ? texto : new Blob([texto], { type: tipo || "application/json" });
  if (window.claude && typeof window.claude.use === "function") {
    window.claude.use("downloads").then(function (d) {
      if (!d) return guardarFicheiro(blob, nome);
      d.save({ filename: nome, data: blob }).catch(function (e) {
        if (e && e.code === "declined") return;
        avisar("Não consegui entregar o ficheiro " + nome + " nesta pré-visualização.");
      });
    }).catch(function () { guardarFicheiro(blob, nome); });
    return;
  }
  guardarFicheiro(blob, nome);
}

/* --------------------------------------------------------------- 7. talao */
function hashCurto(s) {
  var h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return "e" + h.toString(36);
}
function codificar(o) {
  var txt = JSON.stringify(o);
  var bin = typeof TextEncoder !== "undefined"
    ? Array.prototype.map.call(new TextEncoder().encode(txt), function (b) { return String.fromCharCode(b); }).join("")
    : unescape(encodeURIComponent(txt));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function descodificar(s) {
  try {
    var b = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    var bin = atob(b), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var txt = typeof TextDecoder !== "undefined" ? new TextDecoder().decode(bytes) : decodeURIComponent(escape(bin));
    return JSON.parse(txt);
  } catch (e) { return null; }
}
function paraCompacto(e) {
  return {
    n: e.nome, t: e.telefone, d: e.data, m: e.modo, a: e.morada || "", o: e.notas || "",
    x: num(e.taxa) || 0,
    i: e.itens.map(function (i) { return [i.nome, i.qtd, i.preco]; })
  };
}
function deCompacto(c, chave) {
  if (!c || !c.n || !Array.isArray(c.i)) return null;
  var itens = c.i.map(function (x) { return { id: "", nome: String(x[0]), qtd: num(x[1]), preco: num(x[2]) }; });
  var soma = itens.reduce(function (s, i) { return s + i.preco * i.qtd; }, 0);
  return {
    id: hashCurto(chave || JSON.stringify(c)), codigo: chave || "", nome: c.n, telefone: c.t || "",
    data: c.d || "", modo: c.m || "levantamento", morada: c.a || "", notas: c.o || "",
    itens: itens, taxa: num(c.x), total: soma + num(c.x), estado: "nova", criado: new Date().toISOString()
  };
}
function enderecoBase() { return location.origin + location.pathname; }

function talaoHTML(e) {
  var sub = e.itens.reduce(function (s, i) { return s + num(i.preco) * num(i.qtd); }, 0);
  var L = CFG.loja;
  var h = '<div class="tal"><div class="tal-topo"><span>talão de encomenda</span><span>' +
    esc(String(e.id || "").slice(1, 6).toUpperCase()) + "</span></div>" +
    '<div class="tal-marca">' + esc(L.nome) + "</div>" +
    '<div class="tal-sub">' + (e.data ? "entrega " + esc(porExtenso(deIso(e.data))) : "") + "</div>" +
    '<div class="tal-info"><b>' + esc(e.nome) + "</b></div>" +
    (e.telefone ? '<div class="tal-info">' + esc(e.telefone) + "</div>" : "") +
    (e.modo === "entrega" ? '<div class="tal-info">Entrega: ' + esc(e.morada || "morada a combinar") + "</div>"
      : '<div class="tal-info">Levantamento' + (L.moradaLevantamento ? ": " + esc(L.moradaLevantamento) : "") + "</div>") +
    '<table class="tal-tab">';
  e.itens.forEach(function (i) {
    h += "<tr><td>" + num(i.qtd) + " &times; " + esc(i.nome) + "<small>" + eur(num(i.preco)) + " cada</small></td>" +
      "<td>" + eur(num(i.preco) * num(i.qtd)) + "</td></tr>";
  });
  h += "</table>" + '<div class="tal-soma"><span>Subtotal</span><b>' + eur(sub) + "</b></div>";
  if (num(e.taxa) > 0) h += '<div class="tal-soma"><span>Entrega</span><b>' + eur(num(e.taxa)) + "</b></div>";
  h += '<div class="tal-soma total"><span>Total</span><b>' + eur(num(e.total) || sub + num(e.taxa)) + "</b></div>";
  if (e.notas && e.notas !== "-") h += '<div class="tal-notas">' + esc(e.notas) + "</div>";
  h += '<div class="tal-rodape">' + esc(L.nome) + (L.zona ? "<br>" + esc(L.zona) : "") +
    (L.pagamentos ? "<br>" + esc(L.pagamentos) : "") + "<br>obrigado pela encomenda</div></div>";
  return h;
}
function abrirTalao(e, dono) {
  if (!e) return;
  var jaTem = ENCOMENDAS.some(function (x) { return x.id === e.id; });
  var h = talaoHTML(e) + '<div class="tal-bts">' +
    '<button type="button" class="bt forte" data-acao="imprimir-talao">Imprimir talão</button>' +
    '<button type="button" class="bt" data-acao="copiar-ligacao">Copiar ligação</button>';
  if (dono) {
    h += jaTem ? '<span class="bt" style="opacity:.6">Já está registada</span>'
      : '<button type="button" class="bt" data-acao="registar-enc">Registar na gestão</button>';
  }
  h += "</div>";
  talaoAberto = e;
  $("#conteudo-talao").innerHTML = h;
  abrirDialogo($("#painel-talao"));
}
function fecharTalao() {
  fecharDialogo($("#painel-talao"));
  talaoAberto = null;
  if (location.hash.indexOf("#enc=") === 0) history.replaceState(null, "", location.pathname + location.search);
}
function verLigacaoTalao() {
  if (location.hash.indexOf("#enc=") !== 0) return;
  var bruto = location.hash.slice(5);
  var e = deCompacto(descodificar(bruto), bruto);
  if (!e) { avisar("Este link de encomenda não é válido."); return; }
  abrirTalao(e, true);
}

/* -------------------------------------------------------------- 8. gestao */
function abrirGestao() {
  if (!desbloqueado()) { pedirPin(); return; }
  abrirDialogo($("#painel-gestao"));
  desenharGestao();
}
function fecharGestao() {
  fecharDialogo($("#painel-gestao"));
  if (location.hash === "#gestao") history.replaceState(null, "", location.pathname + location.search);
}
function desbloqueado() {
  if (!String(CFG.loja.pin || "").trim()) return true;
  try { return sessionStorage.getItem(CHAVE_PIN) === String(CFG.loja.pin); } catch (e) { return false; }
}
function digerir(texto) {
  if (window.crypto && crypto.subtle && window.isSecureContext) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode("libakes:" + texto)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return x.toString(16).padStart(2, "0"); }).join("").slice(0, 32);
    });
  }
  return Promise.resolve(hashCurto("libakes:" + texto));
}
function pedirPin() {
  var v = window.prompt("Código de acesso à gestão");
  if (v === null) { if (location.hash === "#gestao") history.replaceState(null, "", location.pathname); return; }
  digerir(v).then(function (h) {
    if (h === String(CFG.loja.pin)) {
      try { sessionStorage.setItem(CHAVE_PIN, h); } catch (e) {}
      abrirGestao();
    } else { avisar("Código errado."); }
  });
}

function encomendasPorData() {
  var mapa = {};
  ENCOMENDAS.forEach(function (e) { (mapa[e.data] = mapa[e.data] || []).push(e); });
  return mapa;
}
function desenharGestao() {
  $$("#abas-gestao button").forEach(function (b) {
    b.setAttribute("aria-selected", b.dataset.aba === abaGestao ? "true" : "false");
  });
  var h = "";
  if (porPublicar) {
    h += '<div class="aviso">Tem alterações guardadas apenas neste equipamento. ' +
      "Para o site público ficar igual, use <b>Publicar</b> nas Definições.</div>";
  }
  if (abaGestao === "encomendas") h += gestaoEncomendas();
  else if (abaGestao === "semana") h += gestaoSemana();
  else if (abaGestao === "produtos") h += gestaoProdutos();
  else if (abaGestao === "conteudo") h += gestaoConteudo();
  else h += gestaoDefinicoes();
  $("#conteudo-gestao").innerHTML = h;
}

var ESTADOS = ["nova", "confirmada", "paga", "entregue"];
function gestaoEncomendas() {
  var h = '<div class="cartao"><h3>Registar encomenda recebida</h3>' +
    '<p class="mini">Cole aqui a mensagem que o cliente enviou e carregue em juntar. ' +
    "Se a mensagem trouxer a ligação do talão, basta abri-la e registar com um toque.</p>" +
    '<textarea id="colar-enc" rows="5" placeholder="Encomenda Li Bakes&#10;Nome: ...&#10;Telefone: ...&#10;Entrega: ... [2026-09-27]&#10;Itens:&#10;- 2 x Cookies (9,00 €)"></textarea>' +
    '<div class="bts" style="margin-top:10px"><button type="button" class="bt forte" data-acao="importar-enc">Juntar encomenda</button>' +
    '<button type="button" class="bt" data-acao="exportar-csv">Exportar CSV</button></div></div>';

  var mapa = encomendasPorData(), datas = Object.keys(mapa).sort();
  if (!datas.length) return h + '<div class="cartao"><p class="mini">Ainda não há encomendas registadas.</p></div>';

  h += '<div class="cartao"><h3>Encomendas registadas</h3>';
  datas.forEach(function (k) {
    var deste = mapa[k], tot = deste.reduce(function (s, e) { return s + num(e.total); }, 0);
    h += '<div class="etiqueta-data">' + esc(porExtenso(deIso(k))) + " &middot; " + deste.length +
      " encomenda" + (deste.length > 1 ? "s" : "") + " &middot; " + eur(tot) + "</div>";
    deste.forEach(function (e) {
      var est = e.estado || "nova";
      h += '<div class="enc"><div><div class="quem">' + esc(e.nome) +
        ' <span class="estado ' + esc(est) + '">' + esc(est) + "</span></div>" +
        '<div class="det">' + esc(e.telefone) + " &middot; " +
        e.itens.map(function (i) { return i.qtd + " &times; " + esc(i.nome); }).join(", ") +
        (e.modo === "entrega" ? " &middot; entrega" : "") + "</div>" +
        (e.morada ? '<div class="notas">' + esc(e.morada) + "</div>" : "") +
        (e.notas && e.notas !== "-" ? '<div class="notas">' + esc(e.notas) + "</div>" : "") + "</div>" +
        '<div class="dir"><div class="preco" style="font-size:19px">' + eur(num(e.total)) + "</div>" +
        '<div class="bts" style="justify-content:flex-end;margin-top:6px">' +
        '<button type="button" class="bt" data-acao="estado-enc" data-id="' + esc(e.id) + '">Estado</button>' +
        '<button type="button" class="bt" data-acao="ver-talao" data-id="' + esc(e.id) + '">Talão</button>' +
        '<button type="button" class="x" data-acao="apagar-enc" data-id="' + esc(e.id) + '" aria-label="Apagar">&times;</button>' +
        "</div></div></div>";
    });
  });
  return h + "</div>";
}

function gestaoSemana() {
  var mapa = encomendasPorData(), datas = Object.keys(mapa).sort();
  var opcoes = datas.slice();
  datasAbertas().map(iso).forEach(function (d) { if (opcoes.indexOf(d) < 0) opcoes.push(d); });
  opcoes.sort();
  if (!semanaFolha || opcoes.indexOf(semanaFolha) < 0) semanaFolha = datas.length ? datas[0] : (opcoes[0] || null);
  if (!semanaFolha) return '<div class="cartao"><p class="mini">Ainda não há datas para preparar.</p></div>';

  var deste = mapa[semanaFolha] || [], totais = {}, valor = 0;
  deste.forEach(function (e) {
    valor += num(e.total);
    e.itens.forEach(function (i) { totais[i.nome] = (totais[i.nome] || 0) + num(i.qtd); });
  });

  var h = '<div class="cartao"><h3>Preparar a fornada</h3>' +
    '<label class="campo" style="max-width:340px"><span>Entrega de</span><select data-sel="semana">' +
    opcoes.map(function (d) {
      return '<option value="' + d + '"' + (d === semanaFolha ? " selected" : "") + ">" +
        esc(porExtenso(deIso(d))) + " (" + ((mapa[d] || []).length) + ")</option>";
    }).join("") + "</select></label>" +
    '<div class="bts"><button type="button" class="bt forte" data-acao="imprimir-semana">Folha de produção</button>' +
    '<button type="button" class="bt" data-acao="imprimir-taloes">Talões (' + deste.length + ")</button>" +
    '<button type="button" class="bt" data-acao="imprimir-etiquetas">Etiquetas das caixas</button>' +
    '<button type="button" class="bt" data-acao="alternar-cheia" data-id="' + esc(semanaFolha) + '">' +
    (estaCheia(semanaFolha) ? "Reabrir esta fornada" : "Marcar fornada cheia") + "</button></div></div>";

  h += '<div class="cartao"><h3>A fazer</h3>';
  var nomes = Object.keys(totais).sort();
  if (!nomes.length) h += '<p class="mini">Sem encomendas para esta data.</p>';
  else h += nomes.map(function (n) {
    return '<div class="enc"><div class="quem">' + esc(n) + '</div><div class="preco" style="font-size:20px">' + totais[n] + "</div></div>";
  }).join("");
  h += '<p class="mini" style="margin-top:12px">' + deste.length + " encomenda" + (deste.length === 1 ? "" : "s") +
    " &middot; " + eur(valor) + "</p></div>";
  return h;
}

function visto(idProd, idVar, campo, ligado, rotulo) {
  return '<label class="visivel"><input type="checkbox" data-sel="marca" data-campo="' + campo +
    '" data-id="' + esc(idProd) + '"' + (idVar ? ' data-var="' + esc(idVar) + '"' : "") +
    (ligado ? " checked" : "") + "> " + rotulo + "</label>";
}
function achar(idProd, idVar) {
  var p = CFG.produtos.filter(function (x) { return x.id === idProd; })[0];
  if (!p) return null;
  if (!idVar) return p;
  return (p.variantes || []).filter(function (x) { return x.id === idVar; })[0] || null;
}
function campoTexto(p, campo, rotulo, marcador, classe) {
  return '<label class="campo-mini ' + (classe || "") + '"><span>' + esc(rotulo) + "</span>" +
    '<input type="text" data-prod="' + esc(p.id) + '" data-campo="' + campo +
    '" value="' + esc(p[campo] == null ? "" : p[campo]) + '" placeholder="' + esc(marcador) + '"></label>';
}
function campoNum(p, campo, rotulo, marcador, classe) {
  return '<label class="campo-mini ' + (classe || "") + '"><span>' + esc(rotulo) + "</span>" +
    '<input type="text" inputmode="decimal" data-prod="' + esc(p.id) + '" data-campo="' + campo +
    '" data-num="1" value="' + esc(fmtNum(p[campo])) + '" placeholder="' + esc(marcador) + '"></label>';
}

function gestaoProdutos() {
  var h = '<div class="cartao"><h3>Produtos</h3>' +
    '<p class="mini">A fotografia é cortada em quadrado e reduzida automaticamente, por isso pode usar a que saiu do ' +
    "telemóvel. Um produto com sabores mostra o preço como “desde”. O campo de dias de aviso serve para bolos que " +
    "precisam de encomenda antecipada.</p>";
  CFG.produtos.forEach(function (p) {
    var ehDados = String(p.imagem || "").indexOf("data:") === 0;
    var vs = p.variantes || [];
    h += '<div class="prod-cartao">' + caixaFoto(p, "prod-foto") + '<div class="prod-campos">' +
      campoTexto(p, "nome", "Nome", "Nome do produto", "largo") +
      campoTexto(p, "descricao", "Descrição", "Uma linha, aparece na montra", "largo") +
      campoTexto(p, "alergenios", "Alergénios", "glúten, ovo, leite, separados por vírgula", "largo") +
      campoTexto(p, "conservacao", "Conservação", "Como guardar e quanto tempo dura", "largo") +
      campoNum(p, "preco", "Preço", "0,00") +
      campoTexto(p, "unidade", "Unidade", "bolo, caixa") +
      campoNum(p, "prazo", "Dias de aviso", "0") +
      '<div class="prod-rodape">' +
      '<label class="bt">' + (p.imagem ? "Trocar foto" : "Escolher foto") +
      '<input type="file" accept="image/*" hidden data-sel="foto" data-id="' + esc(p.id) + '"></label>' +
      (p.imagem ? '<button type="button" class="bt" data-acao="tirar-foto" data-id="' + esc(p.id) + '">Retirar foto</button>' : "") +
      (ehDados ? '<span class="mini">' + Math.round(p.imagem.length * 0.75 / 1024) + " KB</span>" : "") +
      (!ehDados ? '<input type="text" style="flex:1 1 140px;padding:8px 9px;font-size:13px" data-prod="' + esc(p.id) +
        '" data-campo="imagem" value="' + esc(p.imagem || "") + '" placeholder="ou fotos/cookies.jpg">' : "") +
      '<button type="button" class="x" data-acao="apagar-prod" data-id="' + esc(p.id) +
      '" aria-label="Apagar" style="margin-left:auto">&times;</button></div>' +
      '<div class="prod-marcas"><span>Marcadores</span>' +
      visto(p.id, "", "ativo", p.ativo !== false, "visível") +
      visto(p.id, "", "novo", !!p.novo, "nova fornada") +
      visto(p.id, "", "destaque", !!p.destaque, "mais pedido") +
      visto(p.id, "", "esgotado", !!p.esgotado, "esgotado") + "</div>";

    h += '<div class="sabores"><div class="sabores-topo"><span>Sabores' + (vs.length ? " (" + vs.length + ")" : "") + "</span>" +
      '<button type="button" class="bt" data-acao="novo-sabor" data-id="' + esc(p.id) + '">Juntar sabor</button></div>';
    if (!vs.length) h += '<p class="mini" style="margin:0">Sem sabores. O produto é vendido tal como está.</p>';
    vs.forEach(function (v) {
      h += '<div class="var-linha"><label class="var-foto" title="Foto do sabor">' +
        (v.imagem ? '<img src="' + esc(v.imagem) + '" alt="">' : '<span class="mais">+</span>') +
        '<input type="file" accept="image/*" hidden data-sel="foto" data-id="' + esc(p.id) + '" data-var="' + esc(v.id) + '"></label>' +
        '<input class="var-nome" type="text" data-prod="' + esc(p.id) + '" data-var="' + esc(v.id) +
        '" data-campo="nome" value="' + esc(v.nome) + '" placeholder="Nome do sabor">' +
        '<input class="var-preco" type="text" inputmode="decimal" data-prod="' + esc(p.id) + '" data-var="' + esc(v.id) +
        '" data-campo="preco" value="' + esc(fmtNum(v.preco)) + '" placeholder="' + esc(fmtNum(p.preco)) + '">' +
        visto(p.id, v.id, "ativo", v.ativo !== false, "visível") +
        visto(p.id, v.id, "novo", !!v.novo, "nova fornada") +
        (v.imagem ? '<button type="button" class="bt" data-acao="tirar-foto" data-id="' + esc(p.id) +
          '" data-var="' + esc(v.id) + '">Sem foto</button>' : "") +
        '<button type="button" class="x" data-acao="apagar-sabor" data-id="' + esc(p.id) + '" data-var="' + esc(v.id) +
        '" aria-label="Apagar">&times;</button></div>';
    });
    h += "</div></div></div>";
  });
  return h + '<div class="bts" style="margin-top:14px"><button type="button" class="bt forte" data-acao="novo-prod">Juntar produto</button></div></div>';
}

function gestaoConteudo() {
  var h = '<div class="cartao"><h3>Perguntas frequentes</h3>' +
    '<p class="mini">Aparecem no fim do site, em lista que abre e fecha. Deixe vazio para esconder a secção.</p>';
  (CFG.perguntas || []).forEach(function (q, i) {
    h += '<div class="var-linha"><input type="text" style="flex:1 1 220px;width:auto" data-conteudo="perguntas" data-indice="' + i +
      '" data-campo="p" value="' + esc(q.p || "") + '" placeholder="Pergunta">' +
      '<input type="text" style="flex:2 1 300px;width:auto" data-conteudo="perguntas" data-indice="' + i +
      '" data-campo="r" value="' + esc(q.r || "") + '" placeholder="Resposta">' +
      '<button type="button" class="x" data-acao="apagar-conteudo" data-lista="perguntas" data-indice="' + i +
      '" aria-label="Apagar">&times;</button></div>';
  });
  h += '<div class="bts" style="margin-top:10px"><button type="button" class="bt" data-acao="nova-pergunta">Juntar pergunta</button></div></div>';

  h += '<div class="cartao"><h3>Testemunhos</h3><p class="mini">Até três aparecem no site. Use só com autorização de quem escreveu.</p>';
  (CFG.testemunhos || []).forEach(function (t, i) {
    h += '<div class="var-linha"><input type="text" style="flex:2 1 300px;width:auto" data-conteudo="testemunhos" data-indice="' + i +
      '" data-campo="texto" value="' + esc(t.texto || "") + '" placeholder="O que disseram">' +
      '<input type="text" style="flex:1 1 150px;width:auto" data-conteudo="testemunhos" data-indice="' + i +
      '" data-campo="autor" value="' + esc(t.autor || "") + '" placeholder="Quem">' +
      '<button type="button" class="x" data-acao="apagar-conteudo" data-lista="testemunhos" data-indice="' + i +
      '" aria-label="Apagar">&times;</button></div>';
  });
  return h + '<div class="bts" style="margin-top:10px"><button type="button" class="bt" data-acao="novo-testemunho">Juntar testemunho</button></div></div>';
}

function blocoDatas() {
  var fechadas = (CFG.loja.diasBloqueados || []).slice();
  var cheias = (CFG.loja.diasCheios || []).slice();
  var candidatas = proximasDatas(16).map(iso);
  fechadas.concat(cheias).forEach(function (k) { if (candidatas.indexOf(k) < 0) candidatas.push(k); });
  candidatas.sort();
  var hoje = iso(new Date());
  var h = '<div class="bloco-datas"><span>Datas</span>' +
    '<p class="mini" style="margin:0 0 9px">Um toque marca a fornada como cheia (continua visível, mas esgotada). ' +
    "Dois toques fecham a data por completo (desaparece). Três voltam ao início.</p><div class=\"fichas\">";
  h += candidatas.map(function (k) {
    var classe = fechadas.indexOf(k) >= 0 ? " fechada" : (cheias.indexOf(k) >= 0 ? " fechada" : "");
    var estado = fechadas.indexOf(k) >= 0 ? "fechada" : (cheias.indexOf(k) >= 0 ? "cheia" : "aberta");
    return '<button type="button" class="ficha' + classe + (k < hoje ? " passada" : "") +
      '" data-acao="ciclo-data" data-id="' + k + '" title="' + esc(porExtenso(deIso(k), true)) + " · " + estado + '">' +
      esc(curta(deIso(k))) + (estado === "cheia" ? " ·" : "") + "</button>";
  }).join("");
  h += "</div>";
  if (cheias.length || fechadas.length) {
    h += '<p class="mini" style="margin:9px 0 0">' +
      (cheias.length ? "Cheias: " + cheias.sort().map(function (k) { return esc(curta(deIso(k))); }).join(", ") + ". " : "") +
      (fechadas.length ? "Fechadas: " + fechadas.sort().map(function (k) { return esc(curta(deIso(k))); }).join(", ") + "." : "") + "</p>";
  }
  return h + "</div>";
}

function gestaoDefinicoes() {
  var L = CFG.loja;
  function campo(rot, nome, valor, dica, tipo) {
    return '<label class="campo"><span>' + rot + "</span>" +
      (tipo === "area"
        ? '<textarea data-loja="' + nome + '">' + esc(valor || "") + "</textarea>"
        : '<input type="text" data-loja="' + nome + '"' + (tipo === "num" ? ' data-num="1"' : "") +
          ' value="' + esc(tipo === "num" ? fmtNum(valor) : (valor || "")) + '">') +
      (dica ? '<span class="mini" style="text-transform:none;letter-spacing:0;margin-top:4px">' + dica + "</span>" : "") + "</label>";
  }
  var h = '<div class="cartao"><h3>A loja</h3><div class="grelha2">' +
    campo("Nome", "nome", L.nome) + campo("Frase de entrada", "lema", L.lema) +
    campo("Localidade", "localidade", L.localidade) + "</div>" +
    campo("Texto de apresentação", "sobre", L.sobre, "", "area") +
    campo("Zona de entrega", "zona", L.zona) + "</div>";

  h += '<div class="cartao"><h3>Contactos e redes</h3><div class="grelha2">' +
    campo("WhatsApp", "whatsapp", L.whatsapp, "Com indicativo e sem espaços, por exemplo 351912345678") +
    campo("Instagram", "instagram", L.instagram, "Endereço completo") +
    campo("Facebook", "facebook", L.facebook, "Deixe vazio para esconder") +
    campo("Email", "email", L.email, "Opcional") + "</div></div>";

  var opcaoDia = function (nome, atual) {
    return '<select data-sel="dia" data-campo="' + nome + '">' + DIAS.map(function (d, i) {
      return '<option value="' + i + '"' + (i === atual ? " selected" : "") + ">" + d + "</option>";
    }).join("") + "</select>";
  };
  h += '<div class="cartao"><h3>Calendário</h3><div class="grelha2">' +
    '<label class="campo"><span>Dia da entrega</span>' + opcaoDia("diaEntrega", diaEntrega()) + "</label>" +
    '<label class="campo"><span>Encomendas fecham</span>' + opcaoDia("diaFecho", diaFecho()) + "</label>" +
    campo("Hora de fecho", "horaFecho", L.horaFecho, "0 a 23. Fecha a essa hora e 59 minutos", "num") +
    campo("Semanas visíveis", "semanas", L.semanas, "Quantas datas aparecem ao cliente", "num") + "</div>" +
    blocoDatas() +
    '<p class="mini" style="margin:14px 0 0">Regra em uso: entrega ' + aoDia(diaEntrega()) +
    ", encomendas fecham " + noDia(diaFecho()) + " anterior às " + horaFecho() + "h59.</p></div>";

  h += '<div class="cartao"><h3>Recolha e pagamento</h3>' +
    '<div class="bts" style="margin-bottom:12px">' +
    '<label class="visivel"><input type="checkbox" data-sel="booleano" data-campo="levantamento"' +
    (L.levantamento !== false ? " checked" : "") + "> levantamento</label>" +
    '<label class="visivel"><input type="checkbox" data-sel="booleano" data-campo="entrega"' +
    (L.entrega === true ? " checked" : "") + "> entrega ao domicílio</label></div>" +
    '<p class="mini" style="margin:0 0 12px">Com as duas ligadas, o cliente escolhe. Com uma só, o site nem ' +
    "pergunta. Os campos de taxa e de entrega grátis só contam quando a entrega está ligada.</p>" +
    '<div class="grelha2">' +
    campo("Local de levantamento", "moradaLevantamento", L.moradaLevantamento, "Aparece ao cliente e no talão") +
    campo("Taxa de entrega", "taxaEntrega", L.taxaEntrega, "0 para não cobrar", "num") +
    campo("Entrega grátis acima de", "entregaGratisAcima", L.entregaGratisAcima, "0 para desligar", "num") +
    campo("Encomenda mínima", "minimoEncomenda", L.minimoEncomenda, "0 para desligar", "num") + "</div>" +
    campo("Formas de pagamento", "pagamentos", L.pagamentos, "Texto livre, aparece no site e no talão") + "</div>";

  h += '<div class="cartao"><h3>Obrigações legais</h3>' +
    '<p class="mini">Vazio, não aparece no site. Quando a loja estiver registada, a ligação ao livro de reclamações ' +
    "eletrónico passa a ser obrigatória e tem de estar visível para quem vende bens ao público, incluindo por meios " +
    "digitais. Nessa altura cole aqui a ligação da página da loja.</p>" +
    '<div class="grelha2">' +
    campo("Livro de reclamações", "livroReclamacoes", L.livroReclamacoes, "Ligação da plataforma") +
    campo("NIF", "nif", L.nif, "Opcional, aparece no rodapé") + "</div></div>";

  h += '<div class="cartao"><h3>Avançado</h3><div class="grelha2">' +
    campo("Receber cópia das encomendas em", "endpoint", L.endpoint,
      "Opcional. Endereço de um formulário (Formspree, Google Apps Script). Vazio: nada é enviado.") + "</div>" +
    '<div class="bts"><button type="button" class="bt" data-acao="definir-pin">' +
    (L.pin ? "Trocar código de acesso" : "Proteger a gestão com código") + "</button>" +
    (L.pin ? '<button type="button" class="bt" data-acao="tirar-pin">Retirar código</button>' : "") + "</div>" +
    '<p class="mini" style="margin-top:8px">O código só afasta curiosos: num site estático não substitui uma senha a sério.</p></div>';

  var usado = 0;
  try { usado = (localStorage.getItem(CHAVE_CFG) || "").length + (localStorage.getItem(CHAVE_ENC) || "").length; } catch (e) {}
  var porCento = Math.min(100, Math.round(usado / 50000));
  h += '<div class="cartao"><h3>Publicar</h3>' +
    '<p class="mini">As alterações acima ficam só neste equipamento. Para o site público mudar, ' +
    "descarregue o pacote e substitua os ficheiros no GitHub. O pacote guarda as fotografias como ficheiros " +
    "separados, o que deixa o site muito mais leve do que metê-las dentro do produtos.json.</p>" +
    '<div class="medidor"><i style="width:' + porCento + '%"></i></div>' +
    '<p class="mini">Espaço usado neste navegador: cerca de ' + Math.round(usado / 1024) + " KB de 5000 KB.</p>" +
    '<div class="bts" style="margin-top:10px">' +
    '<button type="button" class="bt forte" data-acao="publicar-pacote">Descarregar pacote (zip)</button>' +
    '<button type="button" class="bt" data-acao="publicar-json">Só produtos.json</button>' +
    '<button type="button" class="bt" data-acao="copiar-json">Copiar conteúdo</button>' +
    '<button type="button" class="bt" data-acao="marcar-publicado">Já publiquei</button>' +
    '<button type="button" class="bt perigo" data-acao="descartar-local">Descartar alterações locais</button></div></div>';

  h += '<div class="cartao"><h3>Cópia das encomendas</h3>' +
    '<p class="mini">As encomendas ficam guardadas neste navegador. Guarde uma cópia de vez em quando.</p>' +
    '<div class="bts"><button type="button" class="bt" data-acao="exportar-enc">Guardar cópia</button>' +
    '<label class="bt">Repor cópia<input type="file" accept="application/json,.json" hidden data-sel="importar-enc"></label>' +
    '<button type="button" class="bt perigo" data-acao="limpar-antigas">Apagar encomendas antigas</button></div></div>';
  return h;
}

/* ------------------------------------------------------ 9. accoes gestao */
function acaoGestao(a, el) {
  var alvo;
  switch (a) {
    case "novo-prod":
      CFG.produtos.push({ id: id(), nome: "Novo produto", descricao: "", preco: 0, unidade: "unidade", imagem: "", ativo: true });
      guardarCfg(); desenharGestao(); desenharSite(); break;

    case "apagar-prod":
      if (!confirm("Apagar este produto?")) return;
      CFG.produtos = CFG.produtos.filter(function (p) { return p.id !== el.dataset.id; });
      guardarCfg(); desenharGestao(); desenharSite(); break;

    case "novo-sabor":
      alvo = achar(el.dataset.id, "");
      if (alvo) {
        alvo.variantes = alvo.variantes || [];
        alvo.variantes.push({ id: id(), nome: "Novo sabor", descricao: "", preco: "", imagem: "", ativo: true, novo: true });
        guardarCfg(); desenharSite(); desenharGestao();
      }
      break;

    case "apagar-sabor":
      alvo = achar(el.dataset.id, "");
      if (alvo && confirm("Apagar este sabor?")) {
        alvo.variantes = (alvo.variantes || []).filter(function (v) { return v.id !== el.dataset.var; });
        guardarCfg(); desenharSite(); desenharGestao();
      }
      break;

    case "tirar-foto":
      alvo = achar(el.dataset.id, el.dataset.var || "");
      if (alvo) { alvo.imagem = ""; guardarCfg(); desenharSite(); desenharGestao(); }
      break;

    case "ciclo-data": {
      var k = el.dataset.id;
      var cheias = (CFG.loja.diasCheios || []).slice();
      var fechadas = (CFG.loja.diasBloqueados || []).slice();
      if (cheias.indexOf(k) < 0 && fechadas.indexOf(k) < 0) cheias.push(k);
      else if (cheias.indexOf(k) >= 0) { cheias.splice(cheias.indexOf(k), 1); fechadas.push(k); }
      else fechadas.splice(fechadas.indexOf(k), 1);
      CFG.loja.diasCheios = cheias; CFG.loja.diasBloqueados = fechadas;
      guardarCfg(); desenharSite(); desenharGestao();
      break;
    }
    case "alternar-cheia": {
      var c = (CFG.loja.diasCheios || []).slice(), ch = el.dataset.id, pos = c.indexOf(ch);
      if (pos >= 0) c.splice(pos, 1); else c.push(ch);
      CFG.loja.diasCheios = c; guardarCfg(); desenharSite(); desenharGestao();
      break;
    }
    case "nova-pergunta":
      CFG.perguntas = (CFG.perguntas || []).concat([{ p: "Nova pergunta", r: "" }]);
      guardarCfg(); desenharSite(); desenharGestao(); break;
    case "novo-testemunho":
      CFG.testemunhos = (CFG.testemunhos || []).concat([{ texto: "", autor: "" }]);
      guardarCfg(); desenharSite(); desenharGestao(); break;
    case "apagar-conteudo": {
      var nome = el.dataset.lista, i = +el.dataset.indice;
      CFG[nome] = (CFG[nome] || []).filter(function (_, j) { return j !== i; });
      guardarCfg(); desenharSite(); desenharGestao(); break;
    }

    case "importar-enc": {
      var e = interpretar($("#colar-enc").value);
      if (!e) { avisar("Não consegui ler essa mensagem. Precisa das linhas Nome, Telefone, Entrega e Itens."); return; }
      ENCOMENDAS.push(e); guardarEnc(); desenharGestao(); avisar("Encomenda registada.");
      break;
    }
    case "estado-enc": {
      var enc = ENCOMENDAS.filter(function (x) { return x.id === el.dataset.id; })[0];
      if (!enc) return;
      enc.estado = ESTADOS[(ESTADOS.indexOf(enc.estado || "nova") + 1) % ESTADOS.length];
      guardarEnc(); desenharGestao(); break;
    }
    case "apagar-enc":
      if (!confirm("Apagar esta encomenda?")) return;
      ENCOMENDAS = ENCOMENDAS.filter(function (x) { return x.id !== el.dataset.id; });
      guardarEnc(); desenharGestao(); break;

    case "ver-talao":
      alvo = ENCOMENDAS.filter(function (x) { return x.id === el.dataset.id; })[0];
      if (alvo) abrirTalao(alvo, false);
      break;

    case "imprimir-semana": montarFolha(); window.print(); break;
    case "imprimir-taloes": {
      var doDia = ENCOMENDAS.filter(function (x) { return x.data === semanaFolha; });
      if (!doDia.length) { avisar("Não há encomendas registadas para esta data."); return; }
      $("#folha").innerHTML = doDia.map(talaoHTML).join("");
      window.print(); break;
    }
    case "imprimir-etiquetas": if (montarEtiquetas()) window.print(); break;
    case "imprimir-talao":
      if (talaoAberto) { $("#folha").innerHTML = talaoHTML(talaoAberto); window.print(); }
      break;
    case "copiar-ligacao":
      if (talaoAberto) copiar(enderecoBase() + "#enc=" + (talaoAberto.codigo || codificar(paraCompacto(talaoAberto))));
      break;
    case "registar-enc":
      if (talaoAberto && !ENCOMENDAS.some(function (x) { return x.id === talaoAberto.id; })) {
        ENCOMENDAS.push(talaoAberto); guardarEnc(); avisar("Encomenda registada.");
      }
      abrirTalao(talaoAberto, true);
      break;
    case "talao-cliente": if (ultimaEncomenda) abrirTalao(ultimaEncomenda, false); break;
    case "calendario": if (ultimaEncomenda) ficheiroCalendario(ultimaEncomenda); break;

    case "publicar-json":
      descarregar(JSON.stringify(paraPublicar(), null, 2), "produtos.json"); break;
    case "publicar-pacote": publicarPacote(); break;
    case "copiar-json":
      copiar(JSON.stringify(paraPublicar(), null, 2));
      avisar("Conteúdo copiado. Cole no produtos.json do GitHub."); break;
    case "marcar-publicado":
      porPublicar = false;
      guardar(CHAVE_CFG, { alterado: false, dados: CFG });
      desenharGestao(); break;
    case "descartar-local":
      if (!confirm("Descartar as alterações locais e voltar ao que está publicado?")) return;
      try { localStorage.removeItem(CHAVE_CFG); } catch (err) {}
      location.reload(); break;

    case "definir-pin": {
      var v = window.prompt("Novo código de acesso (deixe vazio para cancelar)");
      if (!v) return;
      digerir(v).then(function (hh) {
        CFG.loja.pin = hh;
        try { sessionStorage.setItem(CHAVE_PIN, hh); } catch (err) {}
        guardarCfg(); desenharGestao(); avisar("Código definido. Não se esqueça de publicar.");
      });
      break;
    }
    case "tirar-pin":
      CFG.loja.pin = "";
      try { sessionStorage.removeItem(CHAVE_PIN); } catch (err) {}
      guardarCfg(); desenharGestao(); break;

    case "exportar-enc":
      descarregar(JSON.stringify(ENCOMENDAS, null, 2), "encomendas-" + iso(new Date()) + ".json"); break;
    case "exportar-csv": exportarCSV(); break;
    case "limpar-antigas": {
      if (!confirm("Apagar todas as encomendas com entrega anterior a hoje?")) return;
      var limite = iso(new Date());
      ENCOMENDAS = ENCOMENDAS.filter(function (x) { return x.data >= limite; });
      guardarEnc(); desenharGestao(); break;
    }
  }
}

function exportarCSV() {
  var linhas = [["data", "nome", "telefone", "recolha", "morada", "itens", "total", "estado", "notas"]];
  ENCOMENDAS.slice().sort(function (a, b) { return String(a.data).localeCompare(String(b.data)); }).forEach(function (e) {
    linhas.push([e.data, e.nome, e.telefone, e.modo || "", e.morada || "",
      e.itens.map(function (i) { return i.qtd + "x " + i.nome; }).join(" | "),
      String(num(e.total).toFixed(2)).replace(".", ","), e.estado || "nova", e.notas || ""]);
  });
  var csv = "\uFEFF" + linhas.map(function (l) {
    return l.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(";");
  }).join("\r\n");
  descarregar(csv, "encomendas-" + iso(new Date()) + ".csv", "text/csv;charset=utf-8");
}

function interpretar(texto) {
  if (!texto || !texto.trim()) return null;
  var e = { id: id(), nome: "", telefone: "", data: "", modo: "levantamento", morada: "", itens: [],
    total: 0, taxa: 0, notas: "", estado: "nova", criado: new Date().toISOString() };
  texto.split(/\r?\n/).forEach(function (l) {
    var t = l.trim(), m;
    if ((m = t.match(/^nome\s*:\s*(.+)$/i))) e.nome = m[1].trim();
    else if ((m = t.match(/^(?:telefone|telem[óo]vel|contacto)\s*:\s*(.+)$/i))) e.telefone = m[1].trim();
    else if ((m = t.match(/^recolha\s*:\s*(.+)$/i))) {
      e.modo = /entrega/i.test(m[1]) ? "entrega" : "levantamento";
      var mm = m[1].match(/entrega em (.+)$/i);
      if (mm) e.morada = mm[1].trim();
    }
    else if ((m = t.match(/\[(\d{4}-\d{2}-\d{2})\]/))) e.data = m[1];
    else if ((m = t.match(/^notas?\s*:\s*(.+)$/i))) e.notas = m[1].trim() === "-" ? "" : m[1].trim();
    else if ((m = t.match(/^(?:entrega|levantamento)\s*:\s*([\d.,]+)\s*€/i))) e.taxa = num(m[1]);
    else if ((m = t.match(/^[-•*]\s*(\d+)\s*[x×]\s*(.+?)\s*\(([\d.,]+)\s*€?\)/i))) {
      e.itens.push({ id: "", nome: m[2].trim(), preco: num(m[3]), qtd: num(m[1]) });
    } else if ((m = t.match(/^[-•*]\s*(\d+)\s*[x×]\s*(.+)$/i))) {
      var nomeProd = m[2].trim();
      var p = CFG.produtos.filter(function (x) { return String(x.nome).toLowerCase() === nomeProd.toLowerCase(); })[0];
      e.itens.push({ id: p ? p.id : "", nome: nomeProd, preco: p ? num(p.preco) : 0, qtd: num(m[1]) });
    }
  });
  if (!e.nome || !e.itens.length) return null;
  if (!e.data) {
    var abertas = datasSelecionaveis();
    e.data = abertas.length ? iso(abertas[0]) : iso(new Date());
  }
  e.total = e.itens.reduce(function (s, i) { return s + i.preco * i.qtd; }, 0) + num(e.taxa);
  return e;
}

/* ----------------------------------------------------- 10. impressao */
function montarFolha() {
  var deste = ENCOMENDAS.filter(function (e) { return e.data === semanaFolha; });
  var totais = {}, valor = 0;
  deste.forEach(function (e) {
    valor += num(e.total);
    e.itens.forEach(function (i) { totais[i.nome] = (totais[i.nome] || 0) + num(i.qtd); });
  });
  var h = '<div class="f-topo"><span>' + esc(CFG.loja.nome) + " &middot; folha de produção</span><span>" +
    new Date().toLocaleDateString("pt-PT") + "</span></div>";
  h += "<h1>Entrega de " + esc(porExtenso(deIso(semanaFolha), true)) + "</h1>";
  h += '<p style="margin:0 0 4px">' + deste.length + " encomenda" + (deste.length === 1 ? "" : "s") +
    " &middot; " + eur(valor) + "</p>";
  h += '<h2>A fazer</h2><table class="f-tab">';
  var nomes = Object.keys(totais).sort();
  if (!nomes.length) h += "<tr><td>Sem encomendas para esta data.</td><td></td></tr>";
  nomes.forEach(function (n) { h += "<tr><td>" + esc(n) + "</td><td>" + totais[n] + "</td></tr>"; });
  h += "</table><h2>Encomendas</h2>";
  deste.forEach(function (e) {
    h += '<div class="f-enc"><b><span class="f-caixa"></span>' + esc(e.nome) + "</b> &middot; " + esc(e.telefone) +
      '<div class="f-det">' + e.itens.map(function (i) { return i.qtd + " &times; " + esc(i.nome); }).join(" &middot; ") +
      "  &middot;  " + eur(num(e.total)) + (e.modo === "entrega" ? "  &middot;  ENTREGA " + esc(e.morada || "") : "") + "</div>" +
      (e.notas ? '<div class="f-det"><i>' + esc(e.notas) + "</i></div>" : "") + "</div>";
  });
  h += '<p class="f-rodape">Encomendas fecharam ' + noDia(diaFecho()) + ", " +
    esc(porExtenso(fecho(deIso(semanaFolha)))) + ".</p>";
  $("#folha").innerHTML = h;
}
function montarEtiquetas() {
  var deste = ENCOMENDAS.filter(function (e) { return e.data === semanaFolha; });
  if (!deste.length) { avisar("Não há encomendas para esta data."); return false; }
  var cartoes = [];
  deste.forEach(function (e) {
    e.itens.forEach(function (i) {
      var p = CFG.produtos.filter(function (x) { return String(i.nome).indexOf(x.nome) === 0; })[0];
      var al = p ? lista(p.alergenios) : [];
      for (var n = 0; n < num(i.qtd); n++) {
        cartoes.push('<div class="etq"><b>' + esc(CFG.loja.nome) + "</b>" + esc(i.nome) +
          "<br>" + esc(e.nome) + " · " + esc(curta(deIso(e.data))) +
          (al.length ? "<br>contém: " + esc(al.join(", ")) : "") +
          (p && p.conservacao ? "<br>" + esc(p.conservacao) : "") + "</div>");
      }
    });
  });
  $("#folha").innerHTML = '<div class="grelha-etq">' + cartoes.join("") + "</div>";
  return true;
}

/* --------------------------------------------------------- 11. fotografias */
function escolherFoto(idProduto, idVar, ficheiro) {
  var LADO = 1000;
  function processar(fonte, larg, alt) {
    var lado = Math.min(larg, alt), L = Math.min(LADO, lado);
    var c = document.createElement("canvas");
    c.width = L; c.height = L;
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#FFF8E7"; ctx.fillRect(0, 0, L, L);
    ctx.drawImage(fonte, (larg - lado) / 2, (alt - lado) / 2, lado, lado, 0, 0, L, L);
    var alvo = achar(idProduto, idVar);
    if (!alvo) return;
    alvo.imagem = c.toDataURL("image/jpeg", 0.72);
    guardarCfg(); desenharSite(); desenharGestao();
    avisar("Fotografia actualizada.");
  }
  if (window.createImageBitmap) {
    createImageBitmap(ficheiro, { imageOrientation: "from-image" })
      .then(function (bmp) { processar(bmp, bmp.width, bmp.height); })
      .catch(function () { viaLeitor(); });
  } else { viaLeitor(); }

  function viaLeitor() {
    var leitor = new FileReader();
    leitor.onload = function () {
      var img = new Image();
      img.onload = function () { processar(img, img.width, img.height); };
      img.onerror = function () { avisar("Não consegui ler essa imagem."); };
      img.src = String(leitor.result);
    };
    leitor.readAsDataURL(ficheiro);
  }
}

/* ------------------------------------------------------------ 12. pacote */
var TABELA_CRC = (function () {
  var t = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  var c = 0xFFFFFFFF;
  for (var i = 0; i < u8.length; i++) c = TABELA_CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function bytesDeTexto(s) { return new TextEncoder().encode(s); }
function bytesDeDataURL(url) {
  var bin = atob(String(url).split(",")[1] || "");
  var u = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
/* ZIP sem compressao: as fotografias ja sao JPEG, nao havia nada a ganhar. */
function fazerZip(ficheiros) {
  var partes = [], central = [], deslocamento = 0, agora = new Date();
  var hora = ((agora.getHours() << 11) | (agora.getMinutes() << 5) | Math.floor(agora.getSeconds() / 2)) & 0xFFFF;
  var dia = (((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate()) & 0xFFFF;
  ficheiros.forEach(function (f) {
    var nome = bytesDeTexto(f.nome), crc = crc32(f.dados), tam = f.dados.length;
    var lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, hora, true); lh.setUint16(12, dia, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, tam, true); lh.setUint32(22, tam, true);
    lh.setUint16(26, nome.length, true); lh.setUint16(28, 0, true);
    partes.push(new Uint8Array(lh.buffer), nome, f.dados);

    var ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, hora, true); ch.setUint16(14, dia, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, tam, true); ch.setUint32(24, tam, true);
    ch.setUint16(28, nome.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true);
    ch.setUint32(42, deslocamento, true);
    central.push(new Uint8Array(ch.buffer), nome);
    deslocamento += 30 + nome.length + tam;
  });
  var tamCentral = central.reduce(function (s, p) { return s + p.length; }, 0);
  var fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, ficheiros.length, true); fim.setUint16(10, ficheiros.length, true);
  fim.setUint32(12, tamCentral, true); fim.setUint32(16, deslocamento, true);
  return new Blob(partes.concat(central, [new Uint8Array(fim.buffer)]), { type: "application/zip" });
}
function limpaNome(s) {
  return String(s || "foto").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "foto";
}
function publicarPacote() {
  var copia = JSON.parse(JSON.stringify(paraPublicar()));
  var ficheiros = [], usados = {};
  function tratar(o, rotulo) {
    if (String(o.imagem || "").indexOf("data:") !== 0) return;
    var base = limpaNome(rotulo), nome = base, n = 2;
    while (usados[nome]) nome = base + "-" + n++;
    usados[nome] = true;
    ficheiros.push({ nome: "fotos/" + nome + ".jpg", dados: bytesDeDataURL(o.imagem) });
    o.imagem = "fotos/" + nome + ".jpg";
  }
  copia.produtos.forEach(function (p) {
    tratar(p, p.nome);
    (p.variantes || []).forEach(function (v) { tratar(v, p.nome + "-" + v.nome); });
  });
  ficheiros.unshift({ nome: "produtos.json", dados: bytesDeTexto(JSON.stringify(copia, null, 2)) });
  try {
    descarregar(fazerZip(ficheiros), "li-bakes-" + iso(new Date()) + ".zip", "application/zip");
    avisar("Pacote pronto. Descompacte e envie os ficheiros para o GitHub.");
  } catch (e) {
    avisar("Não consegui criar o pacote. Use a opção só produtos.json.");
  }
}

/* -------------------------------------------------------------- 13. eventos */
function ligarRevelacao() {
  if (!window.IntersectionObserver) { $$(".revela").forEach(function (e) { e.classList.add("vista"); }); return; }
  var obs = new IntersectionObserver(function (entradas) {
    entradas.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add("vista"); obs.unobserve(en.target); }
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: .08 });
  $$(".revela").forEach(function (e) { obs.observe(e); });
}

document.addEventListener("click", function (ev) {
  var lupa = ev.target.closest("[data-lupa]");
  if (lupa) {
    var img = lupa.querySelector("img");
    abrirLupa(lupa.dataset.lupa, img ? img.alt : "");
    return;
  }
  var lig = ev.target.closest('a[href^="#"]');
  if (lig) {
    var alvoHref = lig.getAttribute("href");
    if (alvoHref === "#gestao") { ev.preventDefault(); abrirGestao(); return; }
    if (alvoHref !== "#" && !lig.dataset.acao) {
      var destino = document.querySelector(alvoHref);
      if (destino) { ev.preventDefault(); destino.scrollIntoView({ block: "start" }); return; }
    }
  }
  var el = ev.target.closest("[data-mais],[data-menos],[data-data],[data-abrir],[data-acao],[data-aba],[data-ficha],[data-modo]");
  if (!el) return;

  if (el.dataset.ficha) { abrirFicha(el.dataset.ficha); return; }
  if (el.dataset.abrir) { abertos[el.dataset.abrir] = !abertos[el.dataset.abrir]; desenharProdutos(); return; }
  if (el.dataset.mais) {
    carrinho[el.dataset.mais] = (carrinho[el.dataset.mais] || 0) + 1;
    guardarCarrinho(); desenharProdutos(); desenharResumo(); return;
  }
  if (el.dataset.menos) {
    var k = el.dataset.menos;
    carrinho[k] = Math.max(0, (carrinho[k] || 0) - 1);
    if (!carrinho[k]) delete carrinho[k];
    guardarCarrinho(); desenharProdutos(); desenharResumo(); return;
  }
  if (el.dataset.data) {
    dataEscolhida = el.dataset.data;
    guardarCarrinho(); desenharDatas(); desenharProdutos(); desenharResumo(); return;
  }
  if (el.dataset.modo) {
    modoEntrega = el.dataset.modo;
    guardarCarrinho(); desenharOpcoesEntrega(); desenharResumo(); return;
  }
  if (el.dataset.aba) { abaGestao = el.dataset.aba; desenharGestao(); return; }

  var a = el.dataset.acao;
  switch (a) {
    case "enviar": case "copiar": enviarEncomenda(a); return;
    case "ir-encomendar": {
      var sec = $("#encomendar");
      if (sec) sec.scrollIntoView({ block: "start" });
      return;
    }
    case "ver-privacidade": ev.preventDefault(); dialogoTexto("Os seus dados", textoPrivacidade()); return;
    case "ver-alergenios": ev.preventDefault(); dialogoTexto("Alergénios", textoAlergenios()); return;
    case "fechar-dialogo": fecharTodosDialogos(); return;
    case "fechar-lupa": fecharDialogo($("#lupa")); return;
    case "fechar-gestao": fecharGestao(); return;
    case "fechar-talao": fecharTalao(); return;
  }
  acaoGestao(a, el);
});

document.addEventListener("keydown", function (ev) {
  if (ev.key === "Escape") {
    if ($("#lupa").classList.contains("aberto")) return fecharDialogo($("#lupa"));
    if ($("#painel-talao").classList.contains("aberto")) return fecharTalao();
    if ($("#painel-gestao").classList.contains("aberto")) return fecharGestao();
    if ($$(".velo.aberto").length) return fecharTodosDialogos();
  }
  if (ev.key !== "Tab") return;
  var aberto = $(".velo.aberto") || $(".painel.aberto");
  if (!aberto) return;
  var alvos = focaveis(aberto);
  if (!alvos.length) return;
  var primeiro = alvos[0], ultimo = alvos[alvos.length - 1];
  if (ev.shiftKey && document.activeElement === primeiro) { ev.preventDefault(); ultimo.focus(); }
  else if (!ev.shiftKey && document.activeElement === ultimo) { ev.preventDefault(); primeiro.focus(); }
});

$$(".velo,.lupa").forEach(function (v) {
  v.addEventListener("click", function (ev) { if (ev.target === v) fecharDialogo(v); });
});

var guardarSite = adiar(function () { desenharSite(); }, 400);
document.addEventListener("input", function (ev) {
  var t = ev.target, alvo;
  if (t.dataset.prod) {
    alvo = achar(t.dataset.prod, t.dataset.var || "");
    if (!alvo) return;
    if (t.dataset.campo === "preco" && t.dataset.var) alvo.preco = t.value.trim() === "" ? "" : num(t.value);
    else alvo[t.dataset.campo] = t.dataset.num ? num(t.value) : t.value;
    guardarCfg(); guardarSite();
  } else if (t.dataset.conteudo) {
    var arr = CFG[t.dataset.conteudo] || [];
    if (arr[+t.dataset.indice]) { arr[+t.dataset.indice][t.dataset.campo] = t.value; guardarCfg(); guardarSite(); }
  } else if (t.dataset.loja) {
    CFG.loja[t.dataset.loja] = t.dataset.num ? num(t.value) : t.value;
    guardarCfg(); guardarSite();
  }
});

document.addEventListener("change", function (ev) {
  var t = ev.target, sel = t.dataset.sel, alvo;
  if (!sel) return;
  if (sel === "marca") {
    alvo = achar(t.dataset.id, t.dataset.var || "");
    if (alvo) { alvo[t.dataset.campo] = t.checked; guardarCfg(); desenharSite(); desenharGestao(); }
  } else if (sel === "booleano") {
    CFG.loja[t.dataset.campo] = t.checked;
    guardarCfg(); desenharSite(); desenharGestao();
  } else if (sel === "foto" && t.files && t.files[0]) {
    escolherFoto(t.dataset.id, t.dataset.var || "", t.files[0]);
    t.value = "";
  } else if (sel === "dia") {
    CFG.loja[t.dataset.campo] = num(t.value);
    guardarCfg(); desenharSite(); desenharGestao();
  } else if (sel === "semana") {
    semanaFolha = t.value; desenharGestao();
  } else if (sel === "importar-enc" && t.files && t.files[0]) {
    var leitor = new FileReader();
    leitor.onload = function () {
      try {
        var j = JSON.parse(String(leitor.result));
        if (!Array.isArray(j)) throw new Error("formato");
        ENCOMENDAS = j; guardarEnc(); desenharGestao(); avisar("Cópia reposta.");
      } catch (err) { avisar("Este ficheiro não é uma cópia válida."); }
    };
    leitor.readAsText(t.files[0]);
  }
});

$("#form-encomenda").addEventListener("submit", function (ev) { ev.preventDefault(); enviarEncomenda("enviar"); });

window.addEventListener("hashchange", function () {
  if (location.hash === "#gestao") { fecharTalao(); abrirGestao(); return; }
  if (location.hash.indexOf("#enc=") === 0) { verLigacaoTalao(); return; }
});

if (MEDIA_ESTREITA.addEventListener) MEDIA_ESTREITA.addEventListener("change", desenharBarra);
else if (MEDIA_ESTREITA.addListener) MEDIA_ESTREITA.addListener(desenharBarra);

var ultimoScroll = 0;
window.addEventListener("scroll", function () {
  var y = window.pageYOffset;
  if (Math.abs(y - ultimoScroll) < 8) return;
  ultimoScroll = y;
  $("#nav").classList.toggle("deslocada", y > 12);
}, { passive: true });

/* a meia-noite as datas mudam: refresca sem obrigar a recarregar */
setInterval(function () {
  if ($(".painel.aberto")) return;
  var antes = dataEscolhida;
  desenharDatas();
  if (antes !== dataEscolhida) { desenharProdutos(); desenharResumo(); }
  desenharFaixa();
}, 600000);

arrancar();
