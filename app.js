const KEY = "saep-avaliacao-v2";
const SENHA_KEY = "saep-gabarito-senha";
const SESSAO_KEY = "saep-gabarito-liberado";
const SENHA_PADRAO = "SME2026";
const SENHA_VERSAO_KEY = "saep-gabarito-senha-versao";
const SENHA_VERSAO = "sme2026";
const SENHA_ADMIN_KEY = "saep-admin-senha";
const SESSAO_ADMIN_KEY = "saep-admin-liberado";
const SENHA_ADMIN_PADRAO = "SMEFUND2";
const SENHA_ADMIN_VERSAO_KEY = "saep-admin-senha-versao";
const SENHA_ADMIN_VERSAO = "smefund2";
const ALTS = ["A", "B", "C", "D"];
const DISC = { lp: "Língua Portuguesa", mat: "Matemática" };

const uid = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());

const db = {
  escolas: [],
  turmas: [],
  alunos: [],
  provas: [],
};

function toast(texto, ms) {
  const el = document.getElementById("toast");
  el.hidden = false;
  el.textContent = texto;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, ms || 2200);
}

function salvar() {
  localStorage.setItem(KEY, JSON.stringify(db));
}

async function hashSenha(texto) {
  const dados = new TextEncoder().encode(texto);
  const buf = await crypto.subtle.digest("SHA-256", dados);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function garantirSenhaPadrao() {
  const hashAtual = await hashSenha(SENHA_PADRAO);
  if (localStorage.getItem(SENHA_VERSAO_KEY) !== SENHA_VERSAO) {
    localStorage.setItem(SENHA_KEY, hashAtual);
    localStorage.setItem(SENHA_VERSAO_KEY, SENHA_VERSAO);
    sessionStorage.removeItem(SESSAO_KEY);
    return;
  }
  if (!localStorage.getItem(SENHA_KEY)) {
    localStorage.setItem(SENHA_KEY, hashAtual);
  }
}

async function garantirSenhaAdmin() {
  const hashAtual = await hashSenha(SENHA_ADMIN_PADRAO);
  if (localStorage.getItem(SENHA_ADMIN_VERSAO_KEY) !== SENHA_ADMIN_VERSAO) {
    localStorage.setItem(SENHA_ADMIN_KEY, hashAtual);
    localStorage.setItem(SENHA_ADMIN_VERSAO_KEY, SENHA_ADMIN_VERSAO);
    sessionStorage.removeItem(SESSAO_ADMIN_KEY);
    return;
  }
  if (!localStorage.getItem(SENHA_ADMIN_KEY)) {
    localStorage.setItem(SENHA_ADMIN_KEY, hashAtual);
  }
}

function adminLiberado() {
  return sessionStorage.getItem(SESSAO_ADMIN_KEY) === "1";
}

function mostrarModalAdmin(mostrar) {
  const modal = document.getElementById("modal-admin");
  modal.hidden = !mostrar;
  document.getElementById("senha-admin-erro").hidden = true;
  document.getElementById("senha-admin").value = "";
  if (mostrar) document.getElementById("senha-admin").focus();
}

let abaPendente = "gabarito";

function professorLiberado() {
  return sessionStorage.getItem(SESSAO_KEY) === "1";
}

function gabaritoLiberado() {
  return professorLiberado();
}

function bloquearGabarito(voltarCadastros) {
  sessionStorage.removeItem(SESSAO_KEY);
  document.getElementById("lista-gabarito").innerHTML = "";
  document.getElementById("lista-comparar").innerHTML = "";
  document.getElementById("cmp-resumo").hidden = true;
  document.getElementById("graf-kpis").innerHTML = "";
  document.getElementById("graf-niveis").innerHTML = "";
  document.getElementById("graf-ranking").innerHTML = "";
  document.getElementById("tabela-consolidado").innerHTML = "";
  if (voltarCadastros) abrirAba("cadastros");
}

function mostrarModalSenha(mostrar) {
  const modal = document.getElementById("modal-senha");
  modal.hidden = !mostrar;
  document.getElementById("senha-erro").hidden = true;
  document.getElementById("senha-gabarito").value = "";
  if (mostrar) document.getElementById("senha-gabarito").focus();
}

function abrirAba(nome) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === nome));
  document.querySelectorAll(".painel").forEach((p) => p.classList.remove("is-active"));
  document.getElementById("painel-" + nome).classList.add("is-active");
  if (nome === "gabarito") renderGabarito();
  if (nome === "lancar") renderLancar();
  if (nome === "comparar") renderComparar();
  if (nome === "resultados") renderResultados();
  if (nome === "graficos") renderGraficos();
}

function prova(turmaId, disciplina) {
  let p = db.provas.find((x) => x.turmaId === turmaId && x.disciplina === disciplina);
  if (!p && turmaId) {
    p = {
      turmaId,
      disciplina,
      qtd: 26,
      gabarito: Array(26).fill(""),
      descritores: Array(26).fill(""),
      enunciados: Array(26).fill(""),
      alternativas: Array(26).fill(null).map(() => []),
      apoioBlocos: [],
      respostas: {},
    };
    aplicarCatalogoNaProva(p);
    db.provas.push(p);
    const turma = db.turmas.find((t) => t.id === turmaId);
    const ano = turma ? anoChave(turma.ano || turma.nome) : "";
    if (ano) {
      const oficial = provaAno(ano, disciplina);
      if (oficial && (oficial.gabarito || []).some(Boolean)) copiarOficialParaProva(p, oficial);
    }
  }
  return p;
}

function turmasDoAno(ano) {
  return db.turmas.filter((t) => anoChave(t.ano || t.nome) === ano);
}

function provaAno(ano, disciplina) {
  if (!ano) return null;
  let p = db.provas.find((x) => x.anoKey === ano && x.disciplina === disciplina && !x.turmaId);
  if (!p) {
    const amostra = turmasDoAno(ano)[0];
    const base = amostra ? db.provas.find((x) => x.turmaId === amostra.id && x.disciplina === disciplina) : null;
    p = {
      anoKey: ano,
      turmaId: "",
      disciplina,
      qtd: (base && base.qtd) || 26,
      gabarito: ((base && base.gabarito) || Array(26).fill("")).slice(),
      descritores: ((base && base.descritores) || Array(26).fill("")).slice(),
      enunciados: ((base && base.enunciados) || []).slice(),
      alternativas: ((base && base.alternativas) || []).map((a) => (a || []).slice()),
      apoioBlocos: (base && base.apoioBlocos) ? JSON.parse(JSON.stringify(base.apoioBlocos)) : [],
      tituloProva: (base && base.tituloProva) || "",
      subtituloProva: (base && base.subtituloProva) || "",
      marcas: [],
      respostas: {},
    };
    if (!base) aplicarCatalogoNaProva(p);
    db.provas.push(p);
  }
  return p;
}

function copiarOficialParaProva(destino, origem) {
  if (!destino || !origem) return;
  destino.qtd = origem.qtd;
  destino.gabarito = (origem.gabarito || []).slice();
  destino.descritores = (origem.descritores || []).slice();
  destino.enunciados = (origem.enunciados || []).slice();
  destino.alternativas = (origem.alternativas || []).map((a) => (a || []).slice());
  destino.apoioBlocos = origem.apoioBlocos ? JSON.parse(JSON.stringify(origem.apoioBlocos)) : [];
  destino.tituloProva = origem.tituloProva || "";
  destino.subtituloProva = origem.subtituloProva || "";
  destino.documentoImportado = origem.documentoImportado;
  destino.documentoNome = origem.documentoNome || "";
  destino.marcas = [];
  garantirTamanho(destino);
}

function sincronizarGabaritoAno(ano, disciplina) {
  const oficial = provaAno(ano, disciplina);
  if (!oficial) return;
  turmasDoAno(ano).forEach((t) => {
    copiarOficialParaProva(prova(t.id, disciplina), oficial);
  });
}

function aplicarGabaritoDoAnoNaTurma(p, turmaId, disciplina) {
  const turma = db.turmas.find((t) => t.id === turmaId);
  const ano = turma ? anoChave(turma.ano || turma.nome) : "";
  if (!ano) return;
  const oficial = db.provas.find((x) => x.anoKey === ano && x.disciplina === disciplina && !x.turmaId);
  if (oficial) copiarOficialParaProva(p, oficial);
}

function proficiencia(acertos, qtd) {
  if (!qtd) return null;
  const p1 = Math.max(1, Math.round(10 * qtd / 26));
  const p2 = Math.max(p1 + 1, Math.round(15 * qtd / 26));
  const p3 = Math.max(p2 + 1, Math.round(22 * qtd / 26));
  const p4 = qtd;
  if (acertos <= p1) return acertos * (400 / p1);
  if (acertos <= p2) return 400 + ((acertos - p1) * (180 / (p2 - p1)));
  if (acertos <= p3) return 580 + ((acertos - p2) * (270 / (p3 - p2)));
  if (acertos <= p4) return 850 + ((acertos - p3) * (150 / Math.max(1, p4 - p3)));
  return null;
}

function nivel(prof) {
  if (prof === null || prof === "" || prof === 0) return "";
  if (prof <= 400) return "MUITO CRÍTICO";
  if (prof <= 580) return "CRÍTICO";
  if (prof <= 850) return "INTERMEDIÁRIO";
  if (prof <= 1000) return "ADEQUADO";
  return "Fora da escala";
}

function classeNivel(nome) {
  if (nome === "ADEQUADO") return "ok";
  if (nome === "INTERMEDIÁRIO") return "mid";
  if (nome === "CRÍTICO") return "crit";
  if (nome === "MUITO CRÍTICO") return "bad";
  return "";
}

function correcao(provaItem, alunoId) {
  const qtd = provaItem.qtd;
  const lanc = provaItem.respostas[alunoId] || { falta: false, respostas: Array(qtd).fill("") };
  if (lanc.falta) {
    return { falta: true, acertos: 0, porc: 0, prof: null, nivel: "" };
  }
  let acertos = 0;
  let validas = 0;
  for (let i = 0; i < qtd; i++) {
    if (!provaItem.gabarito[i]) continue;
    validas += 1;
    if (lanc.respostas[i] === provaItem.gabarito[i]) acertos += 1;
  }
  const porc = validas ? Math.round((acertos / validas) * 100) : 0;
  const prof = validas ? proficiencia(acertos, validas) : null;
  return { falta: false, acertos, porc, prof, nivel: nivel(prof) };
}

function fillSelect(el, items, getLabel, selected) {
  if (!el) return;
  const atual = selected ?? el.value;
  el.innerHTML = items.length
    ? items.map((item) => `<option value="${item.id}">${getLabel(item)}</option>`).join("")
    : `<option value="">Nenhuma opção</option>`;
  if (atual && [...el.options].some((o) => o.value === atual)) el.value = atual;
}

const FILTROS_ESCOLA_TURMA = [
  { escola: "aluno-escola", turma: "aluno-turma" },
  { escola: "lan-escola", turma: "lan-turma" },
  { escola: "cmp-escola", turma: "cmp-turma" },
  { escola: "res-escola", turma: "res-turma" },
];

function escolasOptions() {
  fillSelect(document.getElementById("turma-escola"), db.escolas, (e) => e.nome);
  FILTROS_ESCOLA_TURMA.forEach(({ escola }) => {
    fillSelect(document.getElementById(escola), db.escolas, (e) => e.nome);
  });
}

function turmasDaEscola(escolaId) {
  return db.turmas.filter((t) => !escolaId || t.escolaId === escolaId);
}

function turmasOptions() {
  const label = (t) => `${t.ano} ${t.nome}`;
  FILTROS_ESCOLA_TURMA.forEach(({ escola, turma }) => {
    const escolaId = document.getElementById(escola).value;
    fillSelect(document.getElementById(turma), turmasDaEscola(escolaId), label);
  });
}

function renderListasCadastro() {
  document.getElementById("lista-escolas").innerHTML = db.escolas.map((e) =>
    `<li><span>${e.nome}<br><small>${e.etapa}</small></span><button class="link" data-del-escola="${e.id}">excluir</button></li>`
  ).join("") || "<li>Nenhuma escola cadastrada.</li>";

  document.getElementById("lista-turmas").innerHTML = db.turmas.map((t) => {
    const escola = db.escolas.find((e) => e.id === t.escolaId);
    return `<li><span>${t.nome} (${t.ano})<br><small>${escola ? escola.nome : ""}</small></span><button class="link" data-del-turma="${t.id}">excluir</button></li>`;
  }).join("") || "<li>Nenhuma turma cadastrada.</li>";

  const turmaAluno = document.getElementById("aluno-turma").value;
  const alunos = db.alunos.filter((a) => !turmaAluno || a.turmaId === turmaAluno);
  document.getElementById("lista-alunos").innerHTML = alunos.map((a, i) =>
    `<li><span>${i + 1}. ${a.nome}${a.nee ? " · NEE" : ""}</span><button class="link" data-del-aluno="${a.id}">excluir</button></li>`
  ).join("") || "<li>Nenhum aluno nesta turma.</li>";
}

function itemQuestaoVazio(valor) {
  if (valor == null) return true;
  if (Array.isArray(valor)) return !valor.some((x) => !itemQuestaoVazio(x));
  return String(valor).trim() === "";
}

function clonarLista(lista) {
  return Array.isArray(lista) ? lista.slice() : [];
}

function contarPreenchidos(lista) {
  return (lista || []).filter((x) => !itemQuestaoVazio(x)).length;
}

function padSomente(lista, qtd, vazio) {
  const out = Array.isArray(lista) ? lista : [];
  while (out.length < qtd) out.push(typeof vazio === "function" ? vazio() : vazio);
  return out;
}

function snapshotQuestoes(p) {
  return {
    qtd: Math.max(Number(p.qtd) || 0, (p.enunciados || []).length),
    enunciados: clonarLista(p.enunciados),
    alternativas: (p.alternativas || []).map((a) => (a || []).slice()),
    gabarito: clonarLista(p.gabarito),
    descritores: clonarLista(p.descritores),
    apoioBlocos: JSON.parse(JSON.stringify(p.apoioBlocos || [])),
  };
}

function guardarReservaQuestoes(p) {
  if (!p) return;
  const snap = snapshotQuestoes(p);
  const atual = p.reservaQuestoes;
  if (!atual
    || contarPreenchidos(snap.enunciados) >= contarPreenchidos(atual.enunciados)
    || snap.enunciados.length > (atual.enunciados || []).length) {
    p.reservaQuestoes = snap;
  }
}

function mesclarLista(dest, fonte) {
  const out = Array.isArray(dest) ? dest : [];
  if (!Array.isArray(fonte)) return out;
  for (let i = 0; i < fonte.length; i += 1) {
    if (itemQuestaoVazio(out[i]) && !itemQuestaoVazio(fonte[i])) {
      out[i] = Array.isArray(fonte[i]) ? fonte[i].slice() : fonte[i];
    } else if (out[i] === undefined) {
      out[i] = Array.isArray(fonte[i]) ? fonte[i].slice() : (fonte[i] ?? "");
    }
  }
  return out;
}

function mesclarApoio(dest, fonte) {
  if (!fonte || !fonte.length) return dest || [];
  if (!dest || !dest.length) return JSON.parse(JSON.stringify(fonte));
  const byDe = new Map(dest.map((b) => [b.de, b]));
  fonte.forEach((b) => {
    if (!byDe.has(b.de)) dest.push(JSON.parse(JSON.stringify(b)));
  });
  dest.sort((a, b) => (a.de || 0) - (b.de || 0));
  return dest;
}

function provaCompativelComCatalogo(p) {
  if (!p || p.disciplina !== "lp") return false;
  const titulo = `${p.tituloProva || ""} ${p.documentoNome || ""} ${p.subtituloProva || ""}`;
  if (/1[ªa]\s*a\.?d|avalia[cç][aã]o diagn[oó]stica|9[ºo].*port/i.test(titulo)) return true;
  const turma = db.turmas.find((t) => t.id === p.turmaId);
  return !turma || turmaEhNono(turma);
}

function fontesRecuperacao(p) {
  const fontes = [];
  if (p.reservaQuestoes) fontes.push(p.reservaQuestoes);
  if (catalogoProva && provaCompativelComCatalogo(p)) fontes.push(catalogoProva);
  if (sementeProva && sementeProva.lp && provaCompativelComCatalogo(p)) fontes.push(sementeProva.lp);
  return fontes;
}

function recuperarConteudoProva(p) {
  if (!p) return;
  fontesRecuperacao(p).forEach((fonte) => {
    p.enunciados = mesclarLista(p.enunciados, fonte.enunciados);
    p.alternativas = mesclarLista(p.alternativas, fonte.alternativas);
    p.gabarito = mesclarLista(p.gabarito, fonte.gabarito);
    p.descritores = mesclarLista(p.descritores, fonte.descritores);
    p.apoioBlocos = mesclarApoio(p.apoioBlocos, fonte.apoioBlocos);
    if (!p.tituloProva && (fonte.titulo || fonte.tituloProva)) p.tituloProva = fonte.titulo || fonte.tituloProva;
    if (!p.subtituloProva && (fonte.subtitulo || fonte.subtituloProva)) {
      p.subtituloProva = fonte.subtitulo || fonte.subtituloProva;
    }
  });
}

function garantirTamanho(provaItem) {
  const qtd = Math.min(52, Math.max(1, Number(provaItem.qtd) || 26));
  provaItem.qtd = qtd;
  provaItem.gabarito = padSomente(provaItem.gabarito, qtd, "");
  provaItem.descritores = padSomente(provaItem.descritores, qtd, "");
  provaItem.enunciados = padSomente(provaItem.enunciados, qtd, "");
  provaItem.alternativas = padSomente(provaItem.alternativas, qtd, () => []);
  if (!Array.isArray(provaItem.apoioBlocos)) provaItem.apoioBlocos = [];
  recuperarConteudoProva(provaItem);
  provaItem.gabarito = padSomente(provaItem.gabarito, qtd, "");
  provaItem.descritores = padSomente(provaItem.descritores, qtd, "");
  provaItem.enunciados = padSomente(provaItem.enunciados, qtd, "");
  provaItem.alternativas = padSomente(provaItem.alternativas, qtd, () => []);
  const nPreenchidos = Math.max(
    contarPreenchidos(provaItem.enunciados),
    contarPreenchidos((provaItem.reservaQuestoes || {}).enunciados)
  );
  if (!provaItem.qtdReduzidaConfirmada && nPreenchidos > provaItem.qtd) {
    provaItem.qtd = Math.min(52, nPreenchidos);
  }
  guardarReservaQuestoes(provaItem);
  limparLogosCabecalhoProva(provaItem);
}

function aplicarQuantidadeProva(p, raw) {
  if (!p) return false;
  const nova = Math.min(52, Math.max(1, Number(raw) || p.qtd || 26));
  const nGuardado = Math.max(
    (p.enunciados || []).length,
    ((p.reservaQuestoes || {}).enunciados || []).length,
    contarPreenchidos(p.enunciados),
    p.qtd || 0
  );
  if (nova < nGuardado) {
    const ok = window.confirm(
      `A prova tem ${nGuardado} questões. Reduzir para ${nova} esconde as questões ${nova + 1} a ${nGuardado}, mas os enunciados ficam guardados. Continuar?`
    );
    if (!ok) return false;
    p.qtdReduzidaConfirmada = true;
  } else {
    p.qtdReduzidaConfirmada = false;
  }
  p.qtd = nova;
  garantirTamanho(p);
  return true;
}

let catalogoProva = null;
let sementeProva = null;

function turmaEhNono(turma) {
  if (!turma) return false;
  return /9/.test(String(turma.ano || "") + " " + String(turma.nome || ""));
}

function aplicarCatalogoNaProva(p) {
  if (!p || p.disciplina !== "lp" || p.documentoImportado || !catalogoProva) return;
  const turma = db.turmas.find((t) => t.id === p.turmaId);
  if (turma && !turmaEhNono(turma)) return;
  p.tituloProva = catalogoProva.titulo || p.tituloProva;
  p.subtituloProva = catalogoProva.subtitulo || p.subtituloProva;
  p.marcas = [];
  p.apoioBlocos = catalogoProva.apoioBlocos || [];
  p.enunciados = (catalogoProva.enunciados || []).slice();
  p.alternativas = (catalogoProva.alternativas || []).map((a) => (a || []).slice());
}

function ehFiguraQuestao(src) {
  return /texto-2-peanuts|texto-boco|quadrinho|tirinha|peanuts|boco|snoopy/i.test(String(src || ""));
}

function ehImagemLogoCabecalho(src) {
  const n = String(src || "").toLowerCase();
  if (ehFiguraQuestao(n)) return false;
  return /marca-|warles|caed|saego|letterhead|brasao|eixo-marca|blog.?do.?prof|etapa.?diagn|logo/.test(n);
}

function parteSoImagem(parte) {
  return !String(parte.texto || "").trim() && (parte.imagens || []).length > 0;
}

function limparPartesCabecalho(partes) {
  const lista = (partes || []).map((parte) => ({
    texto: parte.texto || "",
    imagens: (parte.imagens || []).filter((src) => !ehImagemLogoCabecalho(src)),
  }));
  const out = [];
  let viuTextoApoio = false;
  lista.forEach((parte) => {
    const texto = String(parte.texto || "").trim();
    if (/^texto\s+\d/i.test(texto) || texto.length > 70) viuTextoApoio = true;
    if (/^leia\b|avalia[cç][aã]o diagn|saego|caed|warles/i.test(texto)) {
      parte.imagens = [];
    }
    if (!viuTextoApoio && parteSoImagem(parte)) return;
    if (!texto && !parte.imagens.length) return;
    out.push(parte);
  });
  return out;
}

function limparLogosCabecalhoProva(p) {
  if (!p) return;
  p.marcas = [];
  (p.apoioBlocos || []).forEach((bloco, idx) => {
    if (!Array.isArray(bloco.partes)) return;
    bloco.partes.forEach((parte) => {
      if (!Array.isArray(parte.imagens)) return;
      parte.imagens = parte.imagens.filter((src) => !ehImagemLogoCabecalho(src));
    });
    if (idx === 0 || bloco.de === 1) bloco.partes = limparPartesCabecalho(bloco.partes);
    bloco.partes = (bloco.partes || []).filter((parte) => {
      return String(parte.texto || "").trim() || (parte.imagens || []).length;
    });
  });
  p.apoioBlocos = (p.apoioBlocos || []).filter((bloco) => (bloco.partes || []).length);
}

function aplicarCatalogoEmProvas() {
  (db.provas || []).forEach((p) => {
    aplicarCatalogoNaProva(p);
    limparLogosCabecalhoProva(p);
  });
}

function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function classeParteApoio(texto, anterior) {
  if (/^Texto\s+\d/i.test(texto)) return "rotulo";
  if (/^Leia /i.test(texto)) return "instrucao";
  if (/Disponível em:|Acesso em:|Fragmento/i.test(texto)) return "fonte";
  if (anterior && /^Texto\s+\d/i.test(anterior) && texto.length < 90) return "titulo-texto";
  return "";
}

function htmlApoioPartes(partes, primeiroBloco) {
  const lista = primeiroBloco ? limparPartesCabecalho(partes) : (partes || []).map((parte) => ({
    texto: parte.texto || "",
    imagens: (parte.imagens || []).filter((src) => !ehImagemLogoCabecalho(src)),
  }));
  let prev = "";
  return lista.map((parte) => {
    const cls = classeParteApoio(parte.texto || "", prev);
    if (parte.texto) prev = parte.texto;
    const p = parte.texto ? `<p class="${cls}">${escHtml(parte.texto)}</p>` : "";
    const imgs = (parte.imagens || [])
      .filter((src) => !ehImagemLogoCabecalho(src))
      .map((src) => `<img src="${escHtml(src)}" alt="Texto de apoio da prova" />`).join("");
    return p + imgs;
  }).join("");
}

function ehLogoPorTamanho(img) {
  if (!img || !img.naturalWidth || !img.naturalHeight) return false;
  const ratio = img.naturalWidth / img.naturalHeight;
  return ratio >= 2.1 && img.naturalHeight <= 240;
}

function ocultarLogosRenderizados(container) {
  if (!container) return;
  container.querySelectorAll(".prova-cabecalho img, .prova-marcas").forEach((el) => el.remove());
  const limparVazios = () => {
    container.querySelectorAll(".prova-apoio").forEach((sec) => {
      if (!sec.textContent.trim() && !sec.querySelector("img")) sec.remove();
    });
  };
  const imgs = [...container.querySelectorAll(".prova-apoio img")];
  imgs.forEach((img, i) => {
    const esconder = () => {
      if (ehFiguraQuestao(img.getAttribute("src") || img.src)) return;
      if (i < 3 && ehLogoPorTamanho(img)) img.remove();
      limparVazios();
    };
    if (img.complete) esconder();
    else img.addEventListener("load", esconder, { once: true });
  });
  limparVazios();
}

function blocoApoioDaQuestao(p, indice) {
  return (p.apoioBlocos || []).find((b) => b.de === indice + 1);
}

function montarCabecalhoProva(p) {
  if (!p.tituloProva && !p.subtituloProva && !p.documentoNome) return "";
  return `<header class="prova-cabecalho">
    <div>
      <h3>${escHtml(p.tituloProva || "Prova")}</h3>
      <p class="hint">${escHtml(p.subtituloProva || p.documentoNome || "")}</p>
    </div>
  </header>`;
}

function renderGabarito() {
  const box = document.getElementById("lista-gabarito");
  if (!gabaritoLiberado()) {
    box.innerHTML = "";
    return;
  }
  const ano = document.getElementById("gab-ano").value;
  const disciplina = document.getElementById("gab-disciplina").value;
  if (!ano) {
    box.innerHTML = "<p class='hint'>Selecione o ano para montar o gabarito.</p>";
    return;
  }
  const p = provaAno(ano, disciplina);
  garantirTamanho(p);
  document.getElementById("gab-qtd").value = p.qtd;
  box.innerHTML = "";
  for (let i = 0; i < p.qtd; i++) {
    const art = document.createElement("article");
    const enunciado = (p.enunciados && p.enunciados[i]) || "";
    art.className = "questao" + (enunciado ? " questao-com-texto" : "");
    art.innerHTML = `<div class="num">Questão ${i + 1}</div>`;
    const alts = document.createElement("div");
    alts.className = "alts";
    ALTS.forEach((letra) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "alt" + (p.gabarito[i] === letra ? " is-on" : "");
      btn.textContent = letra;
      btn.addEventListener("click", () => {
        p.gabarito[i] = p.gabarito[i] === letra ? "" : letra;
        sincronizarGabaritoAno(ano, disciplina);
        salvar();
        renderGabarito();
      });
      alts.appendChild(btn);
    });
    const input = document.createElement("input");
    input.className = "descritor";
    input.placeholder = "Descritor";
    input.value = p.descritores[i] || "";
    input.addEventListener("change", () => {
      p.descritores[i] = input.value.trim();
      sincronizarGabaritoAno(ano, disciplina);
      salvar();
    });
    art.appendChild(alts);
    art.appendChild(input);
    if (enunciado) {
      const en = document.createElement("p");
      en.className = "enunciado-mini";
      en.textContent = enunciado;
      art.appendChild(en);
    }
    box.appendChild(art);
  }
  sincronizarGabaritoAno(ano, disciplina);
  salvar();
}

let alunoAtual = "";
let alunoComparar = "";

function lancamentoDoAluno(turmaId, disciplina, alunoId) {
  const p = db.provas.find((x) => x.turmaId === turmaId && x.disciplina === disciplina);
  return (p && p.respostas[alunoId]) || null;
}

function alunoFinalizadoNaProva(turmaId, disciplina, alunoId) {
  const lanc = lancamentoDoAluno(turmaId, disciplina, alunoId);
  return !!(lanc && lanc.finalizado);
}

function renderLancarLista() {
  const turmaId = document.getElementById("lan-turma").value;
  const disciplina = document.getElementById("lan-disciplina").value;
  const daTurma = db.alunos.filter((a) => a.turmaId === turmaId);
  const alunos = daTurma.filter((a) => !alunoFinalizadoNaProva(turmaId, disciplina, a.id));
  const vazio = !daTurma.length
    ? "Nenhum aluno nesta turma."
    : "Todos os alunos desta turma já finalizaram o lançamento.";
  document.getElementById("lista-alunos-lancar").innerHTML = alunos.map((a) => {
    const extra = a.nee ? " · NEE" : "";
    return `<li class="${a.id === alunoAtual ? "is-on" : ""}" data-aluno="${a.id}">${a.nome}${extra}</li>`;
  }).join("") || `<li>${vazio}</li>`;
}

function renderLancar() {
  const turmaId = document.getElementById("lan-turma").value;
  const disciplina = document.getElementById("lan-disciplina").value;
  if (alunoAtual && alunoFinalizadoNaProva(turmaId, disciplina, alunoAtual)) alunoAtual = "";
  renderLancarLista();
  const box = document.getElementById("lista-respostas");
  const resumo = document.getElementById("lan-resumo");
  const faltaWrap = document.getElementById("lan-falta-wrap");
  const finWrap = document.getElementById("lan-finalizar-wrap");
  const finMsg = document.getElementById("lan-finalizado-msg");
  const aluno = db.alunos.find((a) => a.id === alunoAtual);
  if (!turmaId || !aluno) {
    document.getElementById("lan-titulo").textContent = "Selecione um aluno";
    box.className = "questoes";
    box.innerHTML = "";
    resumo.hidden = true;
    faltaWrap.hidden = true;
    finWrap.hidden = true;
    return;
  }
  const p = prova(turmaId, disciplina);
  aplicarGabaritoDoAnoNaTurma(p, turmaId, disciplina);
  garantirTamanho(p);
  if (!p.respostas[aluno.id]) {
    p.respostas[aluno.id] = { falta: false, finalizado: false, respostas: Array(p.qtd).fill("") };
  }
  const lanc = p.respostas[aluno.id];
  if (lanc.finalizado === undefined) lanc.finalizado = false;
  while (lanc.respostas.length < p.qtd) lanc.respostas.push("");
  const travado = !!lanc.finalizado;

  document.getElementById("lan-titulo").textContent = aluno.nome;
  document.getElementById("lan-sub").textContent = travado
    ? `${DISC[disciplina]} · lançamento finalizado.`
    : `${DISC[disciplina]} · ${p.qtd} questões. Leia o enunciado e marque A, B, C ou D.`;
  faltaWrap.hidden = false;
  document.getElementById("lan-falta").checked = !!lanc.falta;
  document.getElementById("lan-falta").disabled = travado;
  finWrap.hidden = false;
  document.getElementById("btn-finalizar").hidden = travado;
  finMsg.hidden = !travado;

  box.className = "questoes questoes-prova";
  box.innerHTML = montarCabecalhoProva(p);
  let preenchidas = 0;
  for (let i = 0; i < p.qtd; i++) {
    const apoio = blocoApoioDaQuestao(p, i);
    if (apoio) {
      const htmlApoio = htmlApoioPartes(apoio.partes, apoio.de === 1 || i === 0);
      if (htmlApoio.trim()) {
        const sec = document.createElement("section");
        sec.className = "prova-apoio";
        sec.innerHTML = htmlApoio;
        box.appendChild(sec);
      }
    }
    const art = document.createElement("article");
    art.className = "questao questao-prova";
    const val = lanc.respostas[i];
    if (val) preenchidas += 1;
    const enunciado = (p.enunciados && p.enunciados[i]) || "";
    const altsTxt = (p.alternativas && p.alternativas[i]) || [];
    const corpo = document.createElement("div");
    corpo.innerHTML = `<div class="num">Questão ${i + 1}</div>`
      + (enunciado ? `<p class="enunciado">${escHtml(enunciado)}</p>` : "")
      + (altsTxt.some(Boolean)
        ? `<ol class="alts-texto">${altsTxt.map((t, k) => `<li><strong>${ALTS[k]})</strong> ${escHtml(t)}</li>`).join("")}</ol>`
        : "");
    const acoes = document.createElement("div");
    acoes.className = "questao-acoes";
    const alts = document.createElement("div");
    alts.className = "alts";
    ALTS.forEach((letra) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "alt" + (val === letra ? " is-on" : "");
      btn.textContent = letra;
      btn.disabled = !!lanc.falta || travado;
      btn.addEventListener("click", () => {
        if (lanc.finalizado) return;
        lanc.respostas[i] = lanc.respostas[i] === letra ? "" : letra;
        salvar();
        renderLancar();
      });
      alts.appendChild(btn);
    });
    acoes.appendChild(alts);
    art.appendChild(corpo);
    art.appendChild(acoes);
    box.appendChild(art);
  }

  resumo.hidden = false;
  resumo.classList.toggle("is-lock", travado);
  if (travado) {
    resumo.innerHTML = "<div><strong>Lançamento finalizado</strong><p>As respostas desta prova não podem mais ser alteradas.</p></div>";
  } else if (lanc.falta) {
    resumo.innerHTML = "<div><strong>Falta registrada</strong><p>Esta prova não será corrigida. Finalize para travar o lançamento.</p></div>";
  } else {
    resumo.innerHTML = `<div><strong>${preenchidas} de ${p.qtd} respondidas</strong><p>Ao terminar, clique em Finalizar lançamento. O gabarito e a nota não aparecem nesta tela.</p></div>`;
  }
  ocultarLogosRenderizados(box);
}

function renderComparar() {
  const lista = document.getElementById("lista-alunos-comparar");
  const box = document.getElementById("lista-comparar");
  const resumo = document.getElementById("cmp-resumo");
  if (!professorLiberado()) {
    lista.innerHTML = "";
    box.innerHTML = "";
    resumo.hidden = true;
    return;
  }
  const turmaId = document.getElementById("cmp-turma").value;
  const disciplina = document.getElementById("cmp-disciplina").value;
  const alunos = db.alunos.filter((a) => a.turmaId === turmaId);
  lista.innerHTML = alunos.map((a) => {
    const extra = a.nee ? " · NEE" : "";
    const lock = alunoFinalizadoNaProva(turmaId, disciplina, a.id) ? " · finalizado" : "";
    return `<li class="${a.id === alunoComparar ? "is-on" : ""}" data-aluno-cmp="${a.id}">${a.nome}${extra}${lock}</li>`;
  }).join("") || "<li>Nenhum aluno nesta turma.</li>";

  const aluno = db.alunos.find((a) => a.id === alunoComparar);
  if (!turmaId || !aluno) {
    document.getElementById("cmp-titulo").textContent = "Selecione um aluno";
    document.getElementById("cmp-sub").textContent = "Área do professor: compara cada resposta com o gabarito oficial.";
    box.innerHTML = "";
    resumo.hidden = true;
    return;
  }

  const p = prova(turmaId, disciplina);
  aplicarGabaritoDoAnoNaTurma(p, turmaId, disciplina);
  garantirTamanho(p);
  const lanc = p.respostas[aluno.id] || { falta: false, respostas: Array(p.qtd).fill("") };
  document.getElementById("cmp-titulo").textContent = aluno.nome;
  document.getElementById("cmp-sub").textContent = `${DISC[disciplina]} · comparação com o gabarito`;

  box.innerHTML = "";
  if (lanc.falta) {
    resumo.hidden = false;
    resumo.innerHTML = "<div><strong>Falta registrada</strong><p>Esta prova não entra no cálculo de proficiência.</p></div>";
    return;
  }

  for (let i = 0; i < p.qtd; i++) {
    const art = document.createElement("article");
    art.className = "questao";
    const gab = p.gabarito[i] || "";
    const val = lanc.respostas[i] || "";
    const enunciado = (p.enunciados && p.enunciados[i]) || "";
    art.innerHTML = `<div class="num">Questão ${i + 1}</div>`;
    if (enunciado) art.classList.add("questao-com-texto");
    const alts = document.createElement("div");
    alts.className = "alts";
    ALTS.forEach((letra) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "alt";
      btn.textContent = letra;
      btn.disabled = true;
      if (val === letra && gab && val === gab) btn.classList.add("is-ok");
      else if (val === letra && gab && val !== gab) btn.classList.add("is-bad");
      else if (val === letra) btn.classList.add("is-on");
      else if (gab && letra === gab && val && val !== gab) btn.classList.add("is-ok");
      else if (gab && letra === gab && !val) btn.classList.add("is-ok");
      alts.appendChild(btn);
    });
    const desc = document.createElement("small");
    desc.style.color = "#5b6b86";
    desc.textContent = p.descritores[i] ? `Desc. ${p.descritores[i]}` : "";
    if (enunciado) {
      const en = document.createElement("p");
      en.className = "enunciado-mini";
      en.textContent = enunciado;
      art.appendChild(en);
    }
    const estado = document.createElement("div");
    estado.className = "estado";
    if (!gab) estado.textContent = "Sem gabarito";
    else if (!val) estado.textContent = "Em branco";
    else if (val === gab) {
      estado.textContent = "Certa";
      estado.classList.add("ok");
    } else {
      estado.textContent = `Errada (gabarito ${gab})`;
      estado.classList.add("bad");
    }
    art.appendChild(alts);
    art.appendChild(desc);
    art.appendChild(estado);
    box.appendChild(art);
  }

  const c = correcao(p, aluno.id);
  const nv = c.nivel ? `<span class="pill ${classeNivel(c.nivel)}">${c.nivel}</span>` : "";
  resumo.hidden = false;
  resumo.innerHTML = `<div><strong>Acertos: ${c.acertos} · ${c.porc}%</strong><p>Proficiência ${c.prof === null ? "—" : c.prof.toFixed(1).replace(".", ",")} ${nv}</p></div>`;
}

function renderResultados() {
  const turmaId = document.getElementById("res-turma").value;
  const disciplina = document.getElementById("res-disciplina").value;
  const tbody = document.getElementById("tabela-resultados");
  const resumo = document.getElementById("resumo-turma");
  if (!turmaId) {
    tbody.innerHTML = "";
    resumo.innerHTML = "";
    return;
  }
  const p = prova(turmaId, disciplina);
  garantirTamanho(p);
  const alunos = db.alunos.filter((a) => a.turmaId === turmaId);
  const contagem = { ADEQUADO: 0, INTERMEDIÁRIO: 0, CRÍTICO: 0, "MUITO CRÍTICO": 0, FALTA: 0 };
  let somaProf = 0;
  let nProf = 0;
  tbody.innerHTML = alunos.map((a, i) => {
    const c = correcao(p, a.id);
    if (c.falta) contagem.FALTA += 1;
    else if (c.nivel && contagem[c.nivel] !== undefined) {
      contagem[c.nivel] += 1;
      if (c.prof !== null) {
        somaProf += c.prof;
        nProf += 1;
      }
    }
    return `<tr>
      <td>${i + 1}</td>
      <td>${a.nome}</td>
      <td>${a.nee ? "X" : ""}</td>
      <td>${c.falta ? "X" : ""}</td>
      <td>${c.falta ? "—" : c.acertos}</td>
      <td>${c.falta ? "—" : c.porc + "%"}</td>
      <td>${c.falta || c.prof === null ? "—" : c.prof.toFixed(1).replace(".", ",")}</td>
      <td>${c.nivel ? `<span class="pill ${classeNivel(c.nivel)}">${c.nivel}</span>` : "—"}</td>
    </tr>`;
  }).join("");
  resumo.innerHTML = `
    <span>Alunos: ${alunos.length}</span>
    <span>Média de proficiência: ${nProf ? (somaProf / nProf).toFixed(1).replace(".", ",") : "—"}</span>
    <span>Adequado: ${contagem.ADEQUADO}</span>
    <span>Intermediário: ${contagem.INTERMEDIÁRIO}</span>
    <span>Crítico: ${contagem.CRÍTICO}</span>
    <span>Muito crítico: ${contagem["MUITO CRÍTICO"]}</span>
    <span>Faltas: ${contagem.FALTA}</span>
  `;
}

const NIVEIS_ORDEM = ["ADEQUADO", "INTERMEDIÁRIO", "CRÍTICO", "MUITO CRÍTICO"];
let consolidadoRede = { fonte: "", escolas: [] };

function nomeCurto(nome) {
  return String(nome || "")
    .replace(/^\s*(E\.?\s*E\.?\s*F\.?|E\.?\s*M\.?\s*T\.?\s*I\.?)\s*/i, "")
    .replace(/^\s*(EEF|EMTI)\s+/i, "")
    .replace(/^\.\s*/, "")
    .trim();
}

function normalizarNome(nome) {
  return nomeCurto(nome)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function anoChave(texto) {
  const m = String(texto || "").match(/(\d)/);
  return m ? `${m[1]}º` : "";
}

function vazioDisc() {
  return { alunos: 0, avaliados: 0, faltas: 0, somaProf: 0, niveis: { ADEQUADO: 0, INTERMEDIÁRIO: 0, CRÍTICO: 0, "MUITO CRÍTICO": 0 } };
}

function fecharDisc(b) {
  return {
    alunos: b.alunos,
    avaliados: b.avaliados,
    faltas: b.faltas,
    mediaProf: b.avaliados ? Math.round((b.somaProf / b.avaliados) * 10) / 10 : null,
    niveis: b.niveis,
  };
}

function acumularAlunos(bucket, provaItem, alunos) {
  alunos.forEach((aluno) => {
    bucket.alunos += 1;
    if (!provaItem) return;
    const c = correcao(provaItem, aluno.id);
    if (c.falta) {
      bucket.faltas += 1;
      return;
    }
    if (c.prof === null) return;
    bucket.avaliados += 1;
    bucket.somaProf += c.prof;
    if (bucket.niveis[c.nivel] !== undefined) bucket.niveis[c.nivel] += 1;
  });
}

function consolidadoLocal() {
  const mapa = new Map();
  db.escolas.forEach((escola) => {
    const chave = normalizarNome(escola.nome);
    if (!mapa.has(chave)) mapa.set(chave, { nome: escola.nome, anos: {} });
    const item = mapa.get(chave);
    db.turmas.filter((t) => t.escolaId === escola.id).forEach((turma) => {
      const ano = anoChave(turma.ano || turma.nome);
      if (!ano) return;
      if (!item.anos[ano]) item.anos[ano] = { lp: vazioDisc(), mat: vazioDisc(), turmas: {} };
      if (!item.anos[ano].turmas[turma.nome]) item.anos[ano].turmas[turma.nome] = { lp: vazioDisc(), mat: vazioDisc() };
      const alunos = db.alunos.filter((a) => a.turmaId === turma.id);
      ["lp", "mat"].forEach((disc) => {
        const p = db.provas.find((x) => x.turmaId === turma.id && x.disciplina === disc);
        acumularAlunos(item.anos[ano][disc], p, alunos);
        acumularAlunos(item.anos[ano].turmas[turma.nome][disc], p, alunos);
      });
    });
  });
  return [...mapa.values()].map((item) => ({
    nome: item.nome,
    anos: Object.fromEntries(Object.entries(item.anos).map(([ano, discs]) => [
      ano,
      {
        lp: fecharDisc(discs.lp),
        mat: fecharDisc(discs.mat),
        turmas: Object.entries(discs.turmas).map(([nome, d]) => ({
          nome,
          lp: fecharDisc(d.lp),
          mat: fecharDisc(d.mat),
        })),
      },
    ])),
  }));
}

function escolherDisc(atual, novo) {
  if (!atual) return novo;
  if (!novo) return atual;
  return (novo.avaliados || 0) > (atual.avaliados || 0) ? novo : atual;
}

function mesclarConsolidado() {
  const mapa = new Map();
  const incluir = (lista) => {
    lista.forEach((escola) => {
      const chave = normalizarNome(escola.nome);
      if (!mapa.has(chave)) mapa.set(chave, { nome: escola.nome, anos: {} });
      const atual = mapa.get(chave);
      if (escola.nome) atual.nome = escola.nome;
      Object.entries(escola.anos || {}).forEach(([ano, discs]) => {
        const existente = atual.anos[ano] || { lp: null, mat: null, turmas: [] };
        const turmas = new Map((existente.turmas || []).map((t) => [normalizarNome(t.nome), t]));
        (discs.turmas || []).forEach((t) => {
          const k = normalizarNome(t.nome);
          const velha = turmas.get(k);
          turmas.set(k, {
            nome: t.nome,
            lp: escolherDisc(velha && velha.lp, t.lp) || fecharDisc(vazioDisc()),
            mat: escolherDisc(velha && velha.mat, t.mat) || fecharDisc(vazioDisc()),
          });
        });
        atual.anos[ano] = {
          lp: escolherDisc(existente.lp, discs.lp ? { ...discs.lp } : null) || fecharDisc(vazioDisc()),
          mat: escolherDisc(existente.mat, discs.mat ? { ...discs.mat } : null) || fecharDisc(vazioDisc()),
          turmas: [...turmas.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
        };
      });
    });
  };
  incluir(consolidadoRede.escolas || []);
  incluir(consolidadoLocal());
  return [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

function fmtNum(n, casas = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toFixed(casas).replace(".", ",");
}

function pct(parte, total) {
  return total ? Math.round((parte / total) * 100) : 0;
}

function somarLinhas(linhas) {
  const acc = { alunos: 0, avaliados: 0, faltas: 0, soma: 0, niveis: { ADEQUADO: 0, INTERMEDIÁRIO: 0, CRÍTICO: 0, "MUITO CRÍTICO": 0 } };
  linhas.forEach((e) => {
    acc.alunos += e.alunos || 0;
    acc.avaliados += e.avaliados || 0;
    acc.faltas += e.faltas || 0;
    acc.soma += (e.mediaProf || 0) * (e.avaliados || 0);
    NIVEIS_ORDEM.forEach((n) => { acc.niveis[n] += (e.niveis && e.niveis[n]) || 0; });
  });
  acc.mediaProf = acc.avaliados ? acc.soma / acc.avaliados : null;
  return acc;
}

function linhasEscolasDoAno(escolas, ano, disc) {
  return escolas
    .filter((e) => e.anos[ano] && e.anos[ano][disc] && e.anos[ano][disc].alunos)
    .map((e) => ({ nome: e.nome, ...e.anos[ano][disc] }))
    .sort((a, b) => (b.mediaProf || 0) - (a.mediaProf || 0));
}

function linhasTurmasDoAno(escolas, ano, disc, escolaNome) {
  const out = [];
  escolas.forEach((e) => {
    if (escolaNome && normalizarNome(e.nome) !== normalizarNome(escolaNome)) return;
    const bloco = e.anos[ano];
    if (!bloco) return;
    (bloco.turmas || []).forEach((t) => {
      const d = t[disc];
      if (!d || (!d.alunos && !d.avaliados)) return;
      out.push({ escola: e.nome, nome: t.nome, ...d });
    });
  });
  return out.sort((a, b) => (b.mediaProf || 0) - (a.mediaProf || 0));
}

function baseAlunosExcel() {
  const rows = [];
  db.alunos.forEach((aluno) => {
    const turma = db.turmas.find((t) => t.id === aluno.turmaId);
    const escola = turma ? db.escolas.find((e) => e.id === turma.escolaId) : null;
    ["lp", "mat"].forEach((disc) => {
      const p = db.provas.find((x) => x.turmaId === aluno.turmaId && x.disciplina === disc);
      if (!p) return;
      const lanc = p.respostas[aluno.id];
      if (!lanc) return;
      const c = correcao(p, aluno.id);
      rows.push({
        escola: escola ? nomeCurto(escola.nome) : "",
        turma: turma ? turma.nome : "",
        ano: turma ? (anoChave(turma.ano || turma.nome) || turma.ano) : "",
        disciplina: DISC[disc],
        aluno: aluno.nome,
        nee: !!aluno.nee,
        falta: !!c.falta,
        finalizado: !!lanc.finalizado,
        acertos: c.falta ? "" : c.acertos,
        porc: c.falta ? "" : c.porc,
        prof: c.falta || c.prof === null ? "" : Math.round(c.prof * 10) / 10,
        nivel: c.nivel || "",
      });
    });
  });
  return rows;
}

let ultimoGrafico = null;

function renderGraficos() {
  const kpis = document.getElementById("graf-kpis");
  const niveisBox = document.getElementById("graf-niveis");
  const rankingBox = document.getElementById("graf-ranking");
  const tabela = document.getElementById("tabela-consolidado");
  const turmaWrap = document.getElementById("graf-turma-wrap");
  if (!professorLiberado()) {
    kpis.innerHTML = "";
    niveisBox.innerHTML = "";
    rankingBox.innerHTML = "";
    tabela.innerHTML = "";
    return;
  }
  const escolas = mesclarConsolidado();
  const visao = document.getElementById("graf-visao").value;
  const ano = document.getElementById("graf-ano").value;
  const disc = document.getElementById("graf-disciplina").value;
  const sel = document.getElementById("graf-escola");
  const opcoes = escolas.filter((e) => e.anos[ano] && e.anos[ano][disc] && e.anos[ano][disc].alunos);
  fillSelect(sel, opcoes.map((e) => ({ id: e.nome, nome: e.nome })), (e) => nomeCurto(e.nome));
  const nomeEscola = sel.value;
  const porTurma = visao === "turmas";
  turmaWrap.hidden = !porTurma;
  const escolasLinhas = linhasEscolasDoAno(escolas, ano, disc);
  const turmasTodas = linhasTurmasDoAno(escolas, ano, disc);
  const turmasEscola = linhasTurmasDoAno(escolas, ano, disc, nomeEscola);
  if (porTurma) {
    const items = [{ id: "", nome: "Todas as turmas" }, ...turmasEscola.map((t) => ({ id: t.nome, nome: t.nome }))];
    fillSelect(document.getElementById("graf-turma"), items, (t) => t.nome);
  }
  const turmaSel = document.getElementById("graf-turma").value;
  const linhas = porTurma ? turmasEscola : escolasLinhas;
  const rede = somarLinhas(escolasLinhas);
  const escolaFoco = escolasLinhas.find((e) => e.nome === nomeEscola) || escolasLinhas[0];
  let foco;
  let ref;
  let rotuloFoco;
  let rotuloRef;
  if (porTurma) {
    foco = (turmaSel && turmasEscola.find((t) => t.nome === turmaSel)) || {
      nome: "Todas as turmas",
      ...(escolaFoco || fecharDisc(vazioDisc())),
    };
    ref = escolaFoco || rede;
    rotuloFoco = turmaSel ? `Turma ${foco.nome}` : "Turmas da escola";
    rotuloRef = "Escola";
  } else {
    foco = escolaFoco;
    ref = rede;
    rotuloFoco = "Escola";
    rotuloRef = "Rede";
  }
  const posicao = foco && linhas.length ? linhas.findIndex((e) => e.nome === foco.nome) + 1 : 0;
  document.getElementById("graf-hint").textContent = porTurma
    ? "Compara as turmas da escola selecionada. Use Geral da rede para ver o município."
    : "Consolida os resultados da rede (1º SAEP — Fund. II) e compara a escola com as demais.";
  document.getElementById("graf-niveis-hint").textContent = porTurma
    ? `Distribuição ${turmaSel ? "da turma" : "das turmas"} versus a escola.`
    : "Distribuição da escola em destaque versus a média da rede.";
  document.getElementById("graf-ranking-titulo").textContent = porTurma ? "Comparação entre turmas" : "Comparação entre escolas";
  document.getElementById("graf-ranking-hint").textContent = porTurma
    ? "Média de proficiência das turmas da escola selecionada."
    : "Média de proficiência no ano e na disciplina selecionados.";
  document.getElementById("graf-tabela-titulo").textContent = porTurma ? "Tabela consolidada das turmas" : "Tabela consolidada da rede";
  document.getElementById("graf-col-nome").textContent = porTurma ? "Turma" : "Escola";
  if (!foco || (!linhas.length && !escolaFoco)) {
    kpis.innerHTML = "<p class='hint'>Não há resultados para este recorte. Lance respostas ou escolha outro ano.</p>";
    niveisBox.innerHTML = "";
    rankingBox.innerHTML = "";
    tabela.innerHTML = "";
    ultimoGrafico = null;
    return;
  }
  const delta = (foco.mediaProf || 0) - (ref.mediaProf || 0);
  const niveisFocoPct = {};
  const niveisRefPct = {};
  NIVEIS_ORDEM.forEach((n) => {
    niveisFocoPct[n] = pct(foco.niveis[n], foco.avaliados);
    niveisRefPct[n] = pct(ref.niveis[n], ref.avaliados);
  });
  kpis.innerHTML = `
    <div class="kpi"><small>${porTurma ? "Turma / escola" : "Escola"}</small><strong>${porTurma && turmaSel ? foco.nome : nomeCurto((escolaFoco || foco).nome)}</strong><p>${foco.avaliados || 0} avaliados · ${foco.faltas || 0} faltas</p></div>
    <div class="kpi ${delta >= 0 ? "is-ok" : "is-mid"}"><small>Proficiência</small><strong>${fmtNum(foco.mediaProf)}</strong><p>${delta >= 0 ? "+" : ""}${fmtNum(delta)} vs ${rotuloRef.toLowerCase()}</p></div>
    <div class="kpi"><small>${porTurma ? "Média da escola" : "Média da rede"}</small><strong>${fmtNum(ref.mediaProf)}</strong><p>${porTurma ? `${linhas.length} turmas` : `${escolasLinhas.length} escolas`} · ${ref.avaliados || 0} alunos</p></div>
    <div class="kpi"><small>${porTurma ? "Posição entre turmas" : "Posição na rede"}</small><strong>${posicao > 0 ? posicao + "º" : "—"}</strong><p>${pct((foco.niveis.ADEQUADO || 0) + (foco.niveis.INTERMEDIÁRIO || 0), foco.avaliados)}% no adequado/intermediário</p></div>
  `;
  niveisBox.innerHTML = NIVEIS_ORDEM.map((nome) => {
    const pe = niveisFocoPct[nome];
    const pr = niveisRefPct[nome];
    return `<div class="nivel-row">
      <header><span class="pill ${classeNivel(nome)}">${nome}</span><span>${pe}% ${rotuloFoco.toLowerCase()} · ${pr}% ${rotuloRef.toLowerCase()}</span></header>
      <div class="barra-dupla">
        <div class="barra escola" title="${rotuloFoco}"><span style="width:${pe}%"></span></div>
        <div class="barra rede" title="${rotuloRef}"><span style="width:${pr}%"></span></div>
      </div>
    </div>`;
  }).join("");
  const maxProf = Math.max(1000, ...linhas.map((e) => e.mediaProf || 0));
  rankingBox.innerHTML = linhas.map((e, i) => `
    <div class="rank-row ${e.nome === foco.nome ? "is-on" : ""}">
      <strong>${i + 1}º</strong>
      <span>${porTurma ? e.nome : nomeCurto(e.nome)}</span>
      <div class="rank-bar"><span style="width:${maxProf ? ((e.mediaProf || 0) / maxProf) * 100 : 0}%"></span></div>
      <strong>${fmtNum(e.mediaProf, 0)}</strong>
    </div>
  `).join("") || "<p class='hint'>Não há turmas com resultado neste recorte.</p>";
  tabela.innerHTML = linhas.map((e, i) => `
    <tr class="${e.nome === foco.nome ? "is-on" : ""}">
      <td>${i + 1}º</td>
      <td>${porTurma ? e.nome : nomeCurto(e.nome)}</td>
      <td>${e.alunos}</td>
      <td>${e.avaliados}</td>
      <td>${e.faltas}</td>
      <td>${fmtNum(e.mediaProf)}</td>
      <td>${e.niveis.ADEQUADO}</td>
      <td>${e.niveis.INTERMEDIÁRIO}</td>
      <td>${e.niveis.CRÍTICO}</td>
      <td>${e.niveis["MUITO CRÍTICO"]}</td>
    </tr>
  `).join("");
  ultimoGrafico = {
    visao,
    ano,
    disciplina: DISC[disc],
    escola: nomeCurto(nomeEscola),
    turma: turmaSel || "Todas",
    linhasEscolas: escolasLinhas.map((e) => ({ ...e, nome: nomeCurto(e.nome) })),
    linhasTurmas: turmasTodas.map((e) => ({ ...e, escola: nomeCurto(e.escola) })),
    ranking: linhas.map((e) => ({ nome: porTurma ? e.nome : nomeCurto(e.nome), mediaProf: e.mediaProf })),
    linhasPainel: linhas.map((e) => ({
      nome: porTurma ? e.nome : nomeCurto(e.nome),
      mediaProf: e.mediaProf,
      avaliados: e.avaliados,
      niveis: e.niveis,
    })),
    niveisFoco: niveisFocoPct,
    niveisRef: niveisRefPct,
    rotuloFoco,
    rotuloRef,
    baseAlunos: baseAlunosExcel(),
    arquivo: `saep-pacajus-${ano}-${disc}-${porTurma ? "turmas" : "geral"}.xlsx`,
  };
}

async function carregarConsolidado() {
  try {
    const resp = await fetch("saep-consolidado.json");
    if (!resp.ok) return;
    consolidadoRede = await resp.json();
  } catch (err) {
    console.error(err);
  }
}

function refresh() {
  escolasOptions();
  turmasOptions();
  renderListasCadastro();
  if (gabaritoLiberado()) {
    renderGabarito();
    renderComparar();
    renderGraficos();
  } else {
    document.getElementById("lista-gabarito").innerHTML = "";
    document.getElementById("lista-comparar").innerHTML = "";
    document.getElementById("graf-kpis").innerHTML = "";
    document.getElementById("graf-niveis").innerHTML = "";
    document.getElementById("graf-ranking").innerHTML = "";
    document.getElementById("tabela-consolidado").innerHTML = "";
  }
  renderLancar();
  renderResultados();
}

function abaRestrita(nome) {
  return nome === "gabarito" || nome === "comparar" || nome === "graficos";
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const destino = tab.dataset.tab;
    const atual = document.querySelector(".tab.is-active")?.dataset.tab;
    if (abaRestrita(atual) && !abaRestrita(destino)) {
      bloquearGabarito(false);
    }
    if (abaRestrita(destino) && !professorLiberado()) {
      abaPendente = destino;
      mostrarModalSenha(true);
      return;
    }
    abrirAba(destino);
  });
});

document.getElementById("form-senha").addEventListener("submit", async (e) => {
  e.preventDefault();
  await garantirSenhaPadrao();
  const informada = await hashSenha(document.getElementById("senha-gabarito").value);
  if (informada !== localStorage.getItem(SENHA_KEY)) {
    document.getElementById("senha-erro").hidden = false;
    return;
  }
  sessionStorage.setItem(SESSAO_KEY, "1");
  mostrarModalSenha(false);
  abrirAba(abaPendente || "gabarito");
  toast("Área do professor desbloqueada.");
});

document.getElementById("btn-cancelar-senha").addEventListener("click", () => mostrarModalSenha(false));

document.getElementById("btn-bloquear").addEventListener("click", () => {
  bloquearGabarito(true);
  toast("Área do professor bloqueada.");
});

document.getElementById("btn-salvar-senha").addEventListener("click", async () => {
  const nova = document.getElementById("nova-senha").value;
  const conf = document.getElementById("confirmar-senha").value;
  if (!nova || nova.length < 4) {
    toast("A senha precisa ter pelo menos 4 caracteres.");
    return;
  }
  if (nova !== conf) {
    toast("As senhas não conferem.");
    return;
  }
  localStorage.setItem(SENHA_KEY, await hashSenha(nova));
  document.getElementById("nova-senha").value = "";
  document.getElementById("confirmar-senha").value = "";
  toast("Senha do gabarito alterada.");
});

document.getElementById("btn-importar-cadastros").addEventListener("click", async () => {
  const botao = document.getElementById("btn-importar-cadastros");
  botao.disabled = true;
  try {
    await importarCadastrosSaep();
  } catch (err) {
    console.error(err);
    toast(err.message || "Não foi possível importar os cadastros.");
  } finally {
    botao.disabled = false;
  }
});

document.getElementById("form-escola").addEventListener("submit", (e) => {
  e.preventDefault();
  db.escolas.push({
    id: uid(),
    nome: document.getElementById("escola-nome").value.trim(),
    etapa: document.getElementById("escola-etapa").value,
  });
  e.target.reset();
  salvar();
  refresh();
  toast("Escola cadastrada.");
});

document.getElementById("form-turma").addEventListener("submit", (e) => {
  e.preventDefault();
  db.turmas.push({
    id: uid(),
    escolaId: document.getElementById("turma-escola").value,
    ano: document.getElementById("turma-ano").value.trim(),
    nome: document.getElementById("turma-nome").value.trim(),
  });
  e.target.reset();
  salvar();
  refresh();
  toast("Turma cadastrada.");
});

document.getElementById("form-aluno").addEventListener("submit", (e) => {
  e.preventDefault();
  db.alunos.push({
    id: uid(),
    turmaId: document.getElementById("aluno-turma").value,
    nome: document.getElementById("aluno-nome").value.trim(),
    nee: document.getElementById("aluno-nee").checked,
  });
  e.target.reset();
  salvar();
  refresh();
  toast("Aluno cadastrado.");
});

document.body.addEventListener("click", (e) => {
  const escolaId = e.target.dataset.delEscola;
  const turmaId = e.target.dataset.delTurma;
  const alunoId = e.target.dataset.delAluno;
  const alunoSel = e.target.dataset.aluno;
  const alunoCmp = e.target.dataset.alunoCmp;
  if (escolaId) {
    const turmaIds = db.turmas.filter((t) => t.escolaId === escolaId).map((t) => t.id);
    db.escolas = db.escolas.filter((x) => x.id !== escolaId);
    db.turmas = db.turmas.filter((t) => t.escolaId !== escolaId);
    db.alunos = db.alunos.filter((a) => !turmaIds.includes(a.turmaId));
    db.provas = db.provas.filter((p) => !turmaIds.includes(p.turmaId));
    salvar();
    refresh();
  }
  if (turmaId) {
    db.turmas = db.turmas.filter((x) => x.id !== turmaId);
    db.alunos = db.alunos.filter((a) => a.turmaId !== turmaId);
    db.provas = db.provas.filter((p) => p.turmaId !== turmaId);
    salvar();
    refresh();
  }
  if (alunoId) {
    db.alunos = db.alunos.filter((x) => x.id !== alunoId);
    salvar();
    refresh();
  }
  if (alunoSel) {
    const turmaId = document.getElementById("lan-turma").value;
    const disciplina = document.getElementById("lan-disciplina").value;
    if (alunoFinalizadoNaProva(turmaId, disciplina, alunoSel)) {
      alunoAtual = "";
      renderLancar();
      return;
    }
    alunoAtual = alunoSel;
    renderLancar();
  }
  if (alunoCmp) {
    alunoComparar = alunoCmp;
    renderComparar();
  }
});

document.getElementById("aluno-escola").addEventListener("change", () => {
  turmasOptions();
  renderListasCadastro();
});
document.getElementById("aluno-turma").addEventListener("change", renderListasCadastro);
document.getElementById("lan-escola").addEventListener("change", () => {
  alunoAtual = "";
  turmasOptions();
  renderLancar();
});
document.getElementById("cmp-escola").addEventListener("change", () => {
  alunoComparar = "";
  turmasOptions();
  renderComparar();
});
document.getElementById("res-escola").addEventListener("change", () => {
  turmasOptions();
  renderResultados();
});
function aplicarQtdDaBarra() {
  const ano = document.getElementById("gab-ano").value;
  const disciplina = document.getElementById("gab-disciplina").value;
  const p = provaAno(ano, disciplina);
  const campo = document.getElementById("gab-qtd");
  if (!p) return false;
  if (!aplicarQuantidadeProva(p, campo.value)) {
    campo.value = p.qtd;
    return false;
  }
  campo.value = p.qtd;
  sincronizarGabaritoAno(ano, disciplina);
  salvar();
  renderGabarito();
  return true;
}

document.getElementById("btn-gerar-gab").addEventListener("click", () => {
  if (aplicarQtdDaBarra()) toast("Quantidade atualizada. Os enunciados existentes foram mantidos.");
});
document.getElementById("gab-qtd").addEventListener("change", aplicarQtdDaBarra);
["gab-ano", "gab-disciplina"].forEach((id) => {
  document.getElementById(id).addEventListener("change", () => {
    const p = provaAno(document.getElementById("gab-ano").value, document.getElementById("gab-disciplina").value);
    if (p) document.getElementById("gab-qtd").value = p.qtd;
    renderGabarito();
  });
});
["lan-turma", "lan-disciplina"].forEach((id) => {
  document.getElementById(id).addEventListener("change", () => {
    alunoAtual = "";
    renderLancar();
  });
});
["cmp-turma", "cmp-disciplina"].forEach((id) => {
  document.getElementById(id).addEventListener("change", () => {
    alunoComparar = "";
    renderComparar();
  });
});
["res-turma", "res-disciplina"].forEach((id) => {
  document.getElementById(id).addEventListener("change", renderResultados);
});
["graf-ano", "graf-disciplina", "graf-escola", "graf-visao", "graf-turma"].forEach((id) => {
  document.getElementById(id).addEventListener("change", renderGraficos);
});
document.getElementById("btn-excel").addEventListener("click", () => {
  if (!ultimoGrafico || typeof exportarExcelSaep !== "function") {
    toast("Não há dados para gerar o Excel.");
    return;
  }
  exportarExcelSaep(ultimoGrafico);
  toast("Planilha institucional gerada. Abra a aba Painel.");
});
document.getElementById("btn-finalizar").addEventListener("click", () => {
  const turmaId = document.getElementById("lan-turma").value;
  const disciplina = document.getElementById("lan-disciplina").value;
  const p = prova(turmaId, disciplina);
  const lanc = p && alunoAtual ? p.respostas[alunoAtual] : null;
  if (!lanc || lanc.finalizado) return;
  if (!window.confirm("Depois de finalizar, as respostas não poderão ser alteradas. Deseja continuar?")) return;
  lanc.finalizado = true;
  alunoAtual = "";
  salvar();
  renderLancar();
  toast("Lançamento finalizado. O aluno saiu da lista de lançamento.");
});

const LIMPAR_PREMARCADOS_KEY = "saep-limpar-premarcados-v1";

function limparRespostasNaoFinalizadas() {
  (db.provas || []).forEach((p) => {
    const qtd = p.qtd || 26;
    Object.keys(p.respostas || {}).forEach((id) => {
      const lanc = p.respostas[id];
      if (!lanc || lanc.finalizado) return;
      lanc.respostas = Array(qtd).fill("");
      lanc.falta = false;
    });
  });
}

function reiniciarAvaliacoes() {
  (db.provas || []).forEach((p) => {
    p.respostas = {};
  });
  alunoAtual = "";
  alunoComparar = "";
  salvar();
  refresh();
}

document.querySelectorAll(".btn-reset-avaliacoes").forEach((el) => {
  el.addEventListener("click", () => mostrarModalAdmin(true));
});

document.getElementById("btn-cancelar-admin").addEventListener("click", () => mostrarModalAdmin(false));

document.getElementById("form-admin").addEventListener("submit", async (e) => {
  e.preventDefault();
  await garantirSenhaAdmin();
  const informada = await hashSenha(document.getElementById("senha-admin").value);
  if (informada !== localStorage.getItem(SENHA_ADMIN_KEY)) {
    document.getElementById("senha-admin-erro").hidden = false;
    return;
  }
  sessionStorage.setItem(SESSAO_ADMIN_KEY, "1");
  mostrarModalAdmin(false);
  if (!window.confirm("Isto limpa só as respostas lançadas (incluindo falta e finalizado) de todas as turmas e disciplinas. Gabarito, enunciados, escolas, turmas e alunos permanecem. Deseja continuar?")) {
    return;
  }
  reiniciarAvaliacoes();
  toast("Lançamentos das provas limpos. Os nomes voltaram para Lançar respostas.");
});
document.getElementById("lan-falta").addEventListener("change", (e) => {
  const turmaId = document.getElementById("lan-turma").value;
  const disciplina = document.getElementById("lan-disciplina").value;
  const p = prova(turmaId, disciplina);
  if (!p.respostas[alunoAtual]) p.respostas[alunoAtual] = { falta: false, finalizado: false, respostas: Array(p.qtd).fill("") };
  if (p.respostas[alunoAtual].finalizado) {
    e.target.checked = !!p.respostas[alunoAtual].falta;
    return;
  }
  p.respostas[alunoAtual].falta = e.target.checked;
  salvar();
  renderLancar();
});
document.querySelectorAll(".btn-imprimir").forEach((el) => {
  el.addEventListener("click", () => window.print());
});
document.getElementById("btn-exportar").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "saep-avaliacao.json";
  a.click();
});

async function carregarCatalogoProva() {
  try {
    const resp = await fetch("prova-lp-9.json");
    if (!resp.ok) return;
    catalogoProva = await resp.json();
  } catch (err) {
    console.error(err);
  }
}

function provaDaTelaAtiva() {
  const aba = document.querySelector(".tab.is-active")?.dataset.tab;
  const disciplina = document.getElementById((aba === "lancar" ? "lan" : aba === "comparar" ? "cmp" : "gab") + "-disciplina")?.value;
  if (aba === "gabarito" || !aba) {
    const ano = document.getElementById("gab-ano")?.value;
    return ano ? provaAno(ano, disciplina) : null;
  }
  const prefixo = aba === "lancar" ? "lan" : "cmp";
  const turmaId = document.getElementById(prefixo + "-turma")?.value;
  if (!turmaId) return null;
  return prova(turmaId, disciplina);
}

function substituirProvaPeloDocumento(p, parsed, nomeArquivo) {
  const n = (parsed.enunciados || []).length;
  if (!n) throw new Error("O documento não tem questões.");
  const mesmoTamanho = Number(p.qtd) === n;
  p.qtd = n;
  p.enunciados = parsed.enunciados.slice();
  p.alternativas = (parsed.alternativas || []).map((a) => (a || []).slice());
  p.apoioBlocos = parsed.apoioBlocos || [];
  p.tituloProva = parsed.titulo || p.tituloProva || nomeArquivo;
  p.subtituloProva = parsed.subtitulo || "";
  p.marcas = [];
  p.documentoImportado = true;
  p.documentoNome = nomeArquivo;
  p.qtdReduzidaConfirmada = false;
  if (!mesmoTamanho) {
    p.gabarito = padSomente(p.gabarito, n, "");
    p.descritores = padSomente(p.descritores, n, "");
  }
  garantirTamanho(p);
  guardarReservaQuestoes(p);
  Object.keys(p.respostas || {}).forEach((alunoId) => {
    const lanc = p.respostas[alunoId];
    if (!lanc) return;
    if (!Array.isArray(lanc.respostas)) lanc.respostas = [];
    while (lanc.respostas.length < n) lanc.respostas.push("");
  });
  const gabQtd = document.getElementById("gab-qtd");
  if (gabQtd) gabQtd.value = n;
}

function abrirSeletorDocumento() {
  const p = provaDaTelaAtiva();
  if (!p) {
    toast("Selecione o ano e a disciplina.");
    return;
  }
  document.getElementById("file-prova").value = "";
  document.getElementById("file-prova").click();
}

async function aoArquivoProva(file) {
  if (!file) return;
  if (!window.confirm("Isso substitui os enunciados atuais desta disciplina. Continuar?")) return;
  const p = provaDaTelaAtiva();
  if (!p) {
    toast("Selecione o ano e a disciplina.");
    return;
  }
  try {
    const parsed = await parseDocumentoProva(file);
    substituirProvaPeloDocumento(p, parsed, file.name);
    if (p.anoKey) sincronizarGabaritoAno(p.anoKey, p.disciplina);
    salvar();
    refresh();
    toast(`${parsed.enunciados.length} questões importadas. A prova anterior foi substituída.`);
  } catch (err) {
    console.error(err);
    toast(err.message || "Não foi possível ler o documento.");
  }
}

function exportarDocumentoProva() {
  const p = provaDaTelaAtiva();
  if (!p) {
    toast("Selecione o ano e a disciplina.");
    return;
  }
  garantirTamanho(p);
  if (typeof montarHtmlProva !== "function") {
    toast("Exportação indisponível.");
    return;
  }
  const html = montarHtmlProva(p);
  const blob = new Blob(["\ufeff", html], { type: "application/msword" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const disc = p.disciplina === "mat" ? "mat" : "lp";
  a.download = `prova-${disc}.doc`;
  a.click();
}

document.getElementById("file-prova").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  aoArquivoProva(file);
});
["btn-importar-prova", "btn-importar-prova-lan"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("click", abrirSeletorDocumento);
});
["btn-exportar-prova", "btn-exportar-prova-lan"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("click", exportarDocumentoProva);
});

function normalizarChave(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[°ºª]/g, "o")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function chaveTurma(ano, nome) {
  return normalizarChave(`${ano} ${nome}`);
}

function ordenarCadastros() {
  db.escolas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  db.turmas.sort((a, b) => {
    const ea = db.escolas.find((e) => e.id === a.escolaId);
    const eb = db.escolas.find((e) => e.id === b.escolaId);
    const escola = (ea?.nome || "").localeCompare(eb?.nome || "", "pt-BR");
    if (escola) return escola;
    const ano = String(a.ano || "").localeCompare(String(b.ano || ""), "pt-BR");
    return ano || String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR");
  });
}

function mesclarCadastrosSeed(seed) {
  const resumo = { escolas: 0, turmas: 0, alunos: 0 };
  (seed.escolas || []).forEach((escolaSeed) => {
    const chaveE = normalizarChave(escolaSeed.nome);
    let escola = db.escolas.find((e) => normalizarChave(e.nome) === chaveE);
    if (!escola) {
      escola = {
        id: uid(),
        nome: escolaSeed.nome,
        etapa: escolaSeed.etapa || "FUND II",
      };
      db.escolas.push(escola);
      resumo.escolas += 1;
    }
    (escolaSeed.turmas || []).forEach((turmaSeed) => {
      const chaveT = chaveTurma(turmaSeed.ano, turmaSeed.nome);
      let turma = db.turmas.find((t) => t.escolaId === escola.id && chaveTurma(t.ano, t.nome) === chaveT);
      if (!turma) {
        turma = {
          id: uid(),
          escolaId: escola.id,
          ano: turmaSeed.ano,
          nome: turmaSeed.nome,
        };
        db.turmas.push(turma);
        resumo.turmas += 1;
      }
      (turmaSeed.alunos || []).forEach((alunoSeed) => {
        const chaveA = normalizarChave(alunoSeed.nome);
        const existente = db.alunos.find((a) => a.turmaId === turma.id && normalizarChave(a.nome) === chaveA);
        if (!existente) {
          db.alunos.push({
            id: uid(),
            turmaId: turma.id,
            nome: alunoSeed.nome,
            nee: !!alunoSeed.nee,
          });
          resumo.alunos += 1;
        } else if (alunoSeed.nee && !existente.nee) {
          existente.nee = true;
        }
      });
    });
  });
  ordenarCadastros();
  return resumo;
}

async function importarCadastrosSaep(opcoes = {}) {
  const automatico = !!opcoes.automatico;
  const resp = await fetch("saep-cadastros.json");
  if (!resp.ok) throw new Error("Não foi possível ler saep-cadastros.json");
  const seed = await resp.json();
  const resumo = mesclarCadastrosSeed(seed);
  salvar();
  refresh();
  const totalE = (seed.escolas || []).length;
  const totalT = (seed.escolas || []).reduce((n, e) => n + (e.turmas || []).length, 0);
  const totalA = (seed.escolas || []).reduce((n, e) => n + (e.turmas || []).reduce((m, t) => m + (t.alunos || []).length, 0), 0);
  if (!automatico || resumo.escolas || resumo.turmas || resumo.alunos) {
    toast(`Cadastros SAEP: ${totalE} escolas, ${totalT} turmas, ${totalA} alunos. Novos: ${resumo.escolas} escolas, ${resumo.turmas} turmas, ${resumo.alunos} alunos.`, 7000);
  }
  return { totalE, totalT, totalA, ...resumo };
}

async function importarSemente() {
  const resp = await fetch("saep-seed.json");
  const seed = await resp.json();
  const escolaId = uid();
  const turmaId = uid();
  db.escolas = [{ id: escolaId, nome: seed.escola.nome, etapa: seed.escola.etapa }];
  db.turmas = [{ id: turmaId, escolaId, nome: seed.turma.nome, ano: seed.turma.ano }];
  db.alunos = seed.alunos.map((a) => ({ id: uid(), turmaId, nome: a.nome, nee: !!a.nee }));
  const lp = {
    turmaId,
    disciplina: "lp",
    qtd: seed.lp.gabarito.length,
    gabarito: seed.lp.gabarito,
    descritores: seed.lp.descritores,
    tituloProva: seed.lp.titulo || "",
    subtituloProva: seed.lp.subtitulo || "",
    marcas: [],
    apoioBlocos: seed.lp.apoioBlocos || [],
    enunciados: (seed.lp.enunciados || []).slice(),
    alternativas: (seed.lp.alternativas || []).map((a) => (a || []).slice()),
    respostas: {},
  };
  const mat = {
    turmaId,
    disciplina: "mat",
    qtd: seed.mat.gabarito.length,
    gabarito: seed.mat.gabarito,
    descritores: seed.mat.descritores,
    respostas: {},
  };
  seed.alunos.forEach((a, i) => {
    const aluno = db.alunos[i];
    lp.respostas[aluno.id] = { falta: false, finalizado: false, respostas: Array(lp.qtd).fill("") };
    mat.respostas[aluno.id] = { falta: false, finalizado: false, respostas: Array(mat.qtd).fill("") };
  });
  db.provas = [lp, mat];
  salvar();
}

async function iniciar() {
  const bruto = localStorage.getItem(KEY);
  if (bruto) {
    try {
      Object.assign(db, JSON.parse(bruto));
    } catch {
      db.escolas = [];
      db.turmas = [];
      db.alunos = [];
      db.provas = [];
    }
  }
  const cadastroIncompleto = (db.escolas || []).length <= 1 || (db.alunos || []).length < 100;
  if (cadastroIncompleto) {
    try {
      if (!(db.escolas || []).length) await importarSemente();
      await importarCadastrosSaep({ automatico: true });
    } catch (err) {
      console.error(err);
    }
  }
  try {
    await garantirSenhaPadrao();
    await garantirSenhaAdmin();
  } catch (err) {
    console.error(err);
  }
  await carregarConsolidado();
  await carregarCatalogoProva();
  try {
    const respSeed = await fetch("saep-seed.json");
    if (respSeed.ok) sementeProva = await respSeed.json();
  } catch (err) {
    console.error(err);
  }
  aplicarCatalogoEmProvas();
  (db.provas || []).forEach((p) => {
    recuperarConteudoProva(p);
    garantirTamanho(p);
  });
  limparRespostasNaoFinalizadas();
  localStorage.setItem(LIMPAR_PREMARCADOS_KEY, "1");
  if (db.escolas.length) salvar();
  refresh();
}

iniciar();
