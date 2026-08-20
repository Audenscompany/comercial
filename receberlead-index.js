import { http } from '@google-cloud/functions-framework';
import admin from 'firebase-admin';
import crypto from 'crypto';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PDFDocument = require('pdfkit');

admin.initializeApp({ databaseURL: "https://audens-crm-default-rtdb.firebaseio.com" });
const db = admin.database();

// ===== Meta Conversions API (CAPI) — envio server-side do evento Lead =====
const META_PIXEL_ID = "288150133971064";
const META_CAPI_TOKEN = process.env.META_CAPI_TOKEN || "";           // gerar no Events Manager > Conversions API
const META_TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || ""; // opcional: cod. de Testar Eventos


const REDIRECT_OK = "https://audenscompany.com.br/obrigado-assessoria-audens-company";
const REDIRECT_ERR = "https://audenscompany.com.br/assessoria-audens-company/";

// Webhook do Make.com (mesma automacao que antes era disparada pelo Sellflux)
const MAKE_WEBHOOK_URL = "https://hook.us2.make.com/5k0ii6irppno9fst3x208d1pjkfbff6u";

// Z-API — primeiro contato automatico via WhatsApp
// Configure essas variaveis de ambiente no Cloud Run (mesmo lugar onde esta o WEBHOOK_SECRET)
const ZAPI_INSTANCE_ID = process.env.ZAPI_INSTANCE_ID || "";
const ZAPI_TOKEN = process.env.ZAPI_TOKEN || "";
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN || "";

// Anthropic Vision API — usado na Fase 2 do Módulo Financeiro
// Configure ANTHROPIC_API_KEY nas variáveis de ambiente do Cloud Run
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

// Número do Lucas (dono da conta Z-API) para filtrar mensagens enviadas por ele
// Configure LUCAS_PHONE nas variáveis de ambiente (ex: 5511999999999)
const LUCAS_PHONE = process.env.LUCAS_PHONE || "";

// ID do grupo do WhatsApp autorizado a registrar lançamentos financeiros.
// Deixe vazio para aceitar qualquer grupo (não recomendado em produção).
// Configure FINANCEIRO_GROUP_ID nas variáveis do Cloud Run (ex: 120363XXXXXXXX@g.us)
const FINANCEIRO_GROUP_ID = process.env.FINANCEIRO_GROUP_ID || "";

// URLs publicas das imagens de resultado (faturamento antes/depois) usadas na
// mensagem de confirmacao de reuniao. Hospedadas no mesmo GitHub Pages do CRM.
const IMG_FATURAMENTO_ANTERIOR = "https://audenscompany.github.io/comercial/assets/faturamento-anterior.jpeg";
const IMG_FATURAMENTO_ATUAL = "https://audenscompany.github.io/comercial/assets/faturamento-atual.jpeg";

// ===== Mensagens =====

// Mensagem de primeiro contato do Joao, enviada automaticamente quando o lead entra
function mensagemPrimeiroContato(nomeCompleto) {
  var primeiroNome = primeiroNomeDe(nomeCompleto);
  return "Olá " + primeiroNome + "!\n" +
    "Me chamo João, sou do time comercial da Audens Company.\n" +
    "Vi aqui que você preencheu o nosso formulário da Assessoria de Marketing.\n" +
    "Somos uma assessoria de marketing especializada em aumentar o faturamento de negócios no setor alimentício. Hoje, gerenciamos projetos em diversos estados do Brasil.\n\n" +
    "Me passa o @ da sua restaurante/delivery pra dar uma olhada pfv";
}

// Mensagem para leads QUALIFICADOS vindos do quiz (LP fv1). Eles já passaram pela
// qualificação e estão prestes a agendar — mensagem diferente do primeiro contato frio.
function mensagemQuizQualificado(nomeCompleto) {
  var primeiroNome = primeiroNomeDe(nomeCompleto);
  return "Oi " + primeiroNome + "! Aqui é o João, do time da Audens 👊\n" +
    "Vi que você fez o Raio-X do seu delivery e tem perfil pra uma Análise Estratégica com a gente.\n" +
    "Você já conseguiu escolher um horário ou ficou com alguma dúvida pra agendar?";
}

// Primeira parte da confirmacao de reuniao (texto antes das imagens)
function mensagemConfirmacaoParte1(nomeCompleto) {
  var primeiroNome = primeiroNomeDe(nomeCompleto);
  return "Perfeito " + primeiroNome + ", nossa conversa está confirmada! 🙌\n" +
    "Enquanto isso, olha esse resultado de um cliente nosso com um delivery parecido com o seu 👇";
}

// Legenda enviada junto com a imagem de faturamento atual (resultado do cliente)
function legendaFaturamentoAtual() {
  return "Hoje eles vendem mais de 140 mil!\n" +
    "Esse crescimento todo não foi atoa, nós aplicamos o Método Audens!\n" +
    "O mesmo método que fiz na minha hamburgueria pra vender hoje mais de 450 mil por mês!\n" +
    "E em breve vou te mostrar como podemos aplicar no seu negócio!\n" +
    "Não deixe de participar do nosso encontro, vai ser um divisor de águas pra você!";
}

// Parte final da confirmacao de reuniao (com data/hora marcada)
function mensagemConfirmacaoParte2(meetingDisplay) {
  return "Falta muito pouco pra nossa reunião, às " + meetingDisplay + " vamos estar juntos para uma análise estratégica do seu negócio.\n" +
    "É muito importante que todos os sócios estejam presentes pra poder entender tudo aquilo que eu vou falar.\n" +
    "Tenho certeza que a nossa análise vai ajudar muito vocês!";
}

// Lembrete enviado ~2 horas antes da reuniao
function mensagemLembrete2h(nomeCompleto) {
  var primeiroNome = primeiroNomeDe(nomeCompleto);
  return "Fala " + primeiroNome + "!\n" +
    "Falta 2 horas pra nossa reunião, passando mais mesmo pra te lembrar.\n" +
    "Pra participar é só entrar no link que te mandei, não precisa baixar nenhum app e pode entrar pelo telefone ou pelo pc.";
}

// Lembrete enviado ~1 hora antes da reuniao
function mensagemLembrete1h(nomeCompleto) {
  var primeiroNome = primeiroNomeDe(nomeCompleto);
  return primeiroNome + "!\n" +
    "Falta apenas 1 hora pra nossa reunião.\n" +
    "Deixa o @ da sua loja por favor, já quero pegar e ir analisando aqui o seu insta e o seu cardápio pra já deixar tudo preparado pra nossa reunião.\n" +
    "Aguardo você daqui a pouco 😀";
}

// Lembrete enviado ~10 minutos antes da reuniao
function mensagemLembrete10min(nomeCompleto) {
  var primeiroNome = primeiroNomeDe(nomeCompleto);
  return "Falta só 10 minutos!\n" +
    "Se possível já chama o seu sócio, pega o papel e caneta que em breve vou trazer muitas informações que vai fazer você crescer e vender muitoooooo!\n" +
    "Tudo que vou te falar na nossa reunião eu já fiz no meu negócio e em mais de 200 negócios do ramo do Food!\n" +
    "É conhecimento na prática! Nada de teoria.\n" +
    "Aguardo você " + primeiroNome + "!";
}

// Resumo de reuniões para Closer (Lucas ou Gustavo) — só as dele
function mensagemEquipeVespera(nomeCloser, reunioes) {
  var total = reunioes.length;
  var lista = reunioes
    .sort(function(a, b){ return (a.dtISO||'').localeCompare(b.dtISO||''); })
    .map(function(m, i){
      var horario = m.dtISO ? m.dtISO.substring(11, 16) : (m.dtDisplay||'').split(' ').pop() || '—';
      return (i+1) + '. ' + (m.nome||'—') + ' · ' + horario;
    }).join('\n');
  return '🗓️ Reuniões de amanhã — ' + nomeCloser + '\n\n' +
    lista + '\n\n' +
    'Total: ' + total + ' reunião' + (total > 1 ? 'ões' : '') + '\nBoa sorte! 💪';
}

// Resumo de todas as reuniões para o SDR (João)
function mensagemEquipeVesperaSDR(reunioes) {
  var total = reunioes.length;
  var lista = reunioes
    .sort(function(a, b){ return (a.dtISO||'').localeCompare(b.dtISO||''); })
    .map(function(m, i){
      var horario = m.dtISO ? m.dtISO.substring(11, 16) : (m.dtDisplay||'').split(' ').pop() || '—';
      var resp = m.responsavel || '—';
      return (i+1) + '. ' + (m.nome||'—') + ' → ' + resp + ' · ' + horario;
    }).join('\n');
  return '📋 Todas as reuniões de amanhã\n\n' +
    lista + '\n\n' +
    'Total: ' + total + ' reunião' + (total > 1 ? 'ões' : '') + ' agendada' + (total > 1 ? 's' : '');
}

// Mensagem enviada quando um retorno e agendado — informa data e horario ao lead
function mensagemRetorno(nomeCompleto, retornoDisplay) {
  var primeiroNome = primeiroNomeDe(nomeCompleto);
  return "Oi " + primeiroNome + "! 😊\n\n" +
    "Tudo certo por aqui! Ficamos felizes que você quer continuar nossa conversa.\n\n" +
    "Ficou marcado para o dia " + retornoDisplay + ".\n\n" +
    "Vou estar te esperando! Qualquer dúvida pode me chamar aqui pelo WhatsApp. 🤝";
}

// Mensagem com o link para o cliente assinar eletronicamente o contrato
function mensagemLinkAssinatura(nomeCompleto, link) {
  var primeiroNome = primeiroNomeDe(nomeCompleto);
  return "Olá " + primeiroNome + "! 📄\n" +
    "Segue o link para você assinar eletronicamente o seu contrato com a Audens Company:\n" +
    link + "\n\n" +
    "É rapidinho: basta abrir o link, conferir o documento, preencher seus dados (nome e CPF) e confirmar a assinatura.";
}

function primeiroNomeDe(nomeCompleto) {
  return String(nomeCompleto || "").trim().split(/\s+/)[0] || "";
}

// Garante que o numero tenha o codigo do pais (55) exigido pela Z-API.
// Para grupos, preserva o formato @g.us (ou converte o sufixo -group do webhook).
function toWhatsappPhone(tel) {
  const s = String(tel || "");
  // Já está no formato de grupo correto
  if (s.includes("@g.us")) return s;
  // Z-API envia body.phone como "XXXXX-group" em webhooks de grupo → converte para @g.us
  if (s.endsWith("-group")) return s.replace("-group", "@g.us");
  var d = s.replace(/\D/g, "");
  if (!d) return "";
  if (!d.startsWith("55") && (d.length === 10 || d.length === 11)) {
    d = "55" + d;
  }
  return d;
}

function zapiHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (ZAPI_CLIENT_TOKEN) headers["Client-Token"] = ZAPI_CLIENT_TOKEN;
  return headers;
}

// Envia uma mensagem de texto via Z-API. Falha silenciosamente (so loga o erro)
// para nao bloquear o fluxo principal caso a Z-API esteja fora ou mal configurada.
async function enviarMensagemWhatsapp(telefone, mensagem) {
  if (!ZAPI_INSTANCE_ID || !ZAPI_TOKEN) {
    console.log("Z-API nao configurada (ZAPI_INSTANCE_ID/ZAPI_TOKEN ausentes), pulando envio de WhatsApp");
    return;
  }
  const phone = toWhatsappPhone(telefone);
  if (!phone) return;
  try {
    const url = `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`;
    const resp = await fetch(url, {
      method: "POST",
      headers: zapiHeaders(),
      body: JSON.stringify({ phone, message: mensagem }),
    });
    const data = await resp.json().catch(() => ({}));
    console.log("Z-API send-text status:", resp.status, JSON.stringify(data));
  } catch (err) {
    console.error("enviarMensagemWhatsapp error:", err);
  }
}

// Envia uma imagem (com legenda opcional) via Z-API.
async function enviarImagemWhatsapp(telefone, imageUrl, caption) {
  if (!ZAPI_INSTANCE_ID || !ZAPI_TOKEN) {
    console.log("Z-API nao configurada (ZAPI_INSTANCE_ID/ZAPI_TOKEN ausentes), pulando envio de imagem WhatsApp");
    return;
  }
  const phone = toWhatsappPhone(telefone);
  if (!phone) return;
  try {
    const url = `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-image`;
    const body = { phone, image: imageUrl };
    if (caption) body.caption = caption;
    const resp = await fetch(url, {
      method: "POST",
      headers: zapiHeaders(),
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    console.log("Z-API send-image status:", resp.status, JSON.stringify(data));
  } catch (err) {
    console.error("enviarImagemWhatsapp error:", err);
  }
}

// Envia um documento PDF (base64) via Z-API.
async function enviarDocumentoWhatsapp(telefone, pdfBase64, fileName, caption) {
  if (!ZAPI_INSTANCE_ID || !ZAPI_TOKEN) return;
  const phone = toWhatsappPhone(telefone);
  if (!phone) return;
  try {
    const url = `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-document/pdf`;
    const resp = await fetch(url, {
      method: "POST",
      headers: zapiHeaders(),
      body: JSON.stringify({ phone, document: pdfBase64, fileName, caption: caption || "" }),
    });
    const data = await resp.json().catch(() => ({}));
    console.log("Z-API send-document status:", resp.status, JSON.stringify(data));
  } catch (err) {
    console.error("enviarDocumentoWhatsapp error:", err);
  }
}

// Gera o extrato mensal em PDF e retorna um Buffer base64.
async function gerarExtratoPDF(mes, ano) {
  const meses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const nomeMes = meses[mes - 1] || String(mes);
  const firstISO = `${ano}-${String(mes).padStart(2,"0")}-01`;
  const lastDay = new Date(ano, mes, 0).getDate();
  const lastISO = `${ano}-${String(mes).padStart(2,"0")}-${String(lastDay).padStart(2,"0")}`;

  const [saidasSnap, entradasSnap] = await Promise.all([
    db.ref("financeiro/saidas").once("value"),
    db.ref("financeiro/entradas_manuais").once("value"),
  ]);

  const saidasRaw = saidasSnap.val() || {};
  const entradasRaw = entradasSnap.val() || {};

  const transactions = [];

  Object.entries(saidasRaw).forEach(([id, s]) => {
    if (s.status === "descartado") return;
    const d = s.data || "";
    if (d < firstISO || d > lastISO) return;
    transactions.push({ data: d, tipo: "saida", descricao: s.descricao || s.fornecedor || "-", categoria: s.categoria || "-", valor: parseFloat(s.valor) || 0 });
  });

  Object.entries(entradasRaw).forEach(([id, e]) => {
    const d = e.data || "";
    if (d < firstISO || d > lastISO) return;
    transactions.push({ data: d, tipo: "entrada", descricao: e.descricao || "-", categoria: e.categoria || "Entrada", valor: parseFloat(e.valor) || 0 });
  });

  transactions.sort((a, b) => a.data.localeCompare(b.data));

  const totalEntradas = transactions.filter(t => t.tipo === "entrada").reduce((s, t) => s + t.valor, 0);
  const totalSaidas = transactions.filter(t => t.tipo === "saida").reduce((s, t) => s + t.valor, 0);
  const saldo = totalEntradas - totalSaidas;

  const fmtVal = (v) => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtData = (iso) => iso ? iso.split("-").reverse().join("/") : "-";

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks).toString("base64")));
    doc.on("error", reject);

    // Cabeçalho
    doc.fontSize(18).font("Helvetica-Bold").text("Extrato Financeiro", { align: "center" });
    doc.fontSize(12).font("Helvetica").text(`${nomeMes} / ${ano}`, { align: "center" });
    doc.moveDown();

    // KPIs
    doc.fontSize(10).font("Helvetica-Bold");
    doc.text(`Entradas: ${fmtVal(totalEntradas)}   |   Saídas: ${fmtVal(totalSaidas)}   |   Saldo: ${fmtVal(saldo)}`);
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.5);

    // Cabeçalho da tabela
    const cols = { data: 40, desc: 110, cat: 310, tipo: 410, valor: 460 };
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("Data", cols.data, doc.y, { width: 65 });
    doc.text("Descrição", cols.desc, doc.y - doc.currentLineHeight(), { width: 195 });
    doc.text("Categoria", cols.cat, doc.y - doc.currentLineHeight(), { width: 95 });
    doc.text("Tipo", cols.tipo, doc.y - doc.currentLineHeight(), { width: 45 });
    doc.text("Valor", cols.valor, doc.y - doc.currentLineHeight(), { width: 90, align: "right" });
    doc.moveDown(0.3);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.3);

    // Linhas
    doc.font("Helvetica").fontSize(8.5);
    transactions.forEach((t) => {
      if (doc.y > 750) { doc.addPage(); }
      const y = doc.y;
      doc.fillColor(t.tipo === "saida" ? "#c0392b" : "#27ae60");
      doc.text(fmtData(t.data), cols.data, y, { width: 65 });
      doc.fillColor("#222222");
      doc.text(t.descricao, cols.desc, y, { width: 195 });
      doc.text(t.categoria, cols.cat, y, { width: 95 });
      doc.fillColor(t.tipo === "saida" ? "#c0392b" : "#27ae60");
      doc.text(t.tipo === "saida" ? "Saída" : "Entrada", cols.tipo, y, { width: 45 });
      doc.text(fmtVal(t.valor), cols.valor, y, { width: 90, align: "right" });
      doc.moveDown(0.5);
    });

    if (transactions.length === 0) {
      doc.fillColor("#888").text("Nenhuma transação encontrada para este período.", { align: "center" });
    }

    // Rodapé
    doc.moveDown();
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.3);
    doc.fillColor("#222").font("Helvetica-Bold").fontSize(9);
    doc.text(`Saldo do mês: ${fmtVal(saldo)}`, { align: "right" });
    doc.fontSize(7).font("Helvetica").fillColor("#aaa").text(`Gerado em ${new Date().toLocaleDateString("pt-BR")} — Audens CRM`, { align: "center" });

    doc.end();
  });
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== "") {
      return obj[k];
    }
  }
  return "";
}

async function notifyMake(payload) {
  try {
    const resp = await fetch(MAKE_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    console.log("Make webhook status:", resp.status);
  } catch (err) {
    console.error("notifyMake error:", err);
  }
}

// Hash SHA-256 exigido pelo Meta para dados pessoais
function capiHash(v){ return crypto.createHash("sha256").update(String(v||"").trim().toLowerCase()).digest("hex"); }
function capiDigits(v){ return String(v||"").replace(/\D/g,""); }

// Envia o evento "Lead" ao Meta pelo servidor (recupera conversoes que o Pixel do navegador perde)
async function enviarMetaCAPI(lead, req){
  if(!META_CAPI_TOKEN) return; // sem token configurado, nao dispara
  try{
    const ud = {};
    if(lead.email) ud.em = [capiHash(lead.email)];
    if(lead.telefone){ let ph = capiDigits(lead.telefone); if(ph && ph.indexOf("55")!==0) ph = "55"+ph; if(ph) ud.ph = [capiHash(ph)]; }
    if(lead.nome){ const parts = String(lead.nome).trim().split(/\s+/); ud.fn = [capiHash(parts[0])]; if(parts.length>1) ud.ln = [capiHash(parts[parts.length-1])]; }
    const ip = String(req.headers["x-forwarded-for"]||"").split(",")[0].trim(); if(ip) ud.client_ip_address = ip;
    const ua = req.headers["user-agent"]; if(ua) ud.client_user_agent = ua;
    const fbc = (req.body && (req.body.fbc || req.body._fbc)) || ""; if(fbc) ud.fbc = fbc;
    const fbp = (req.body && (req.body.fbp || req.body._fbp)) || ""; if(fbp) ud.fbp = fbp;
    const payload = { data: [ {
      event_name: "Lead",
      event_time: Math.floor(Date.now()/1000),
      action_source: "website",
      event_source_url: "https://audenscompany.github.io/audens-lp/",
      user_data: ud,
      custom_data: { faturamento: lead.faturamento||"", campanha: lead.campanha||"", conjunto: lead.conjunto||"", anuncio: lead.ad||"" }
    } ] };
    if(META_TEST_EVENT_CODE) payload.test_event_code = META_TEST_EVENT_CODE;
    const url = "https://graph.facebook.com/v21.0/"+META_PIXEL_ID+"/events?access_token="+encodeURIComponent(META_CAPI_TOKEN);
    const r = await fetch(url, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload) });
    console.log("Meta CAPI status:", r.status);
  }catch(err){ console.error("enviarMetaCAPI error:", err); }
}

// Confere o secret enviado via header X-Webhook-Secret ou query ?secret=
function checaSecret(req) {
  const secret = req.headers["x-webhook-secret"] || req.query.secret;
  return Boolean(process.env.WEBHOOK_SECRET) && secret === process.env.WEBHOOK_SECRET;
}

// ===== Rota principal: recebe lead da LP (Elementor) =====
async function handleReceberLead(req, res) {
  if (req.method !== "POST") {
    res.set("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  if (!checaSecret(req)) {
    return res.status(401).send("Unauthorized");
  }

  const body = req.body || {};

  const nome = pick(body, ["nome", "name", "nome_completo", "full_name"]);
  const telefoneRaw = pick(body, ["telefone", "phone", "whatsapp", "tel", "celular"]);
  const faturamento = pick(body, ["faturamento", "faturamento-atual", "revenue", "faturamento_mensal"]);
  const cidade = pick(body, ["cidade", "city"]);
  const empresa = pick(body, ["nome-da-empresa", "empresa", "company"]);
  const email = pick(body, ["email", "e-mail"]);
  const origem = pick(body, ["origem", "source"]) || "lp-elementor";
  const ad = pick(body, ["ad", "Ad", "AD", "utm_content", "ad_name", "adName", "anuncio"]);
  const campanha = pick(body, ["campanha", "campaign", "utm_campaign", "Campaign"]);
  const conjunto = pick(body, ["conjunto", "adset", "ad_set", "utm_medium", "Conjunto", "posicionamento"]);
  const segmento = pick(body, ["segmento", "segment"]);
  const canal = pick(body, ["canal", "channel"]);
  const desafio = pick(body, ["desafio", "dor", "gargalo", "challenge"]);
  const investimento = pick(body, ["investimento", "disposto_investir"]);
  const jaInvestiu = pick(body, ["ja_investiu", "investiu", "ja_investiu_trafego"]);
  const instagram = pick(body, ["instagram", "insta", "instagram_handle"]);

  const isBrowser = (req.headers.accept || "").includes("text/html");

  if (!nome || !telefoneRaw) {
    if (isBrowser) {
      return res.redirect(302, REDIRECT_ERR);
    }
    return res.status(400).json({
      ok: false,
      error: "Campos obrigatórios ausentes: nome, telefone",
      recebido: body,
    });
  }

  const tel = String(telefoneRaw).replace(/\D/g, "");
  const key = (tel || "lead_" + Date.now()).replace(/[.#$\[\]]/g, "_");

  const faixa = pick(body, ["faixa", "faturamento_faixa"]);
  const leadData = {
    nome: String(nome),
    telefone: tel,
    faturamento: String(faturamento || ""),
    faixa: String(faixa || ""),
    cidade: String(cidade || ""),
    empresa: String(empresa || ""),
    email: String(email || ""),
    ad: String(ad || ""),
    campanha: String(campanha || ""),
    conjunto: String(conjunto || ""),
    segmento: String(segmento || ""),
    canal: String(canal || ""),
    desafio: String(desafio || ""),
    investimento: String(investimento || ""),
    ja_investiu: String(jaInvestiu || ""),
    instagram: String(instagram || ""),
    _source: String(origem),
    _createdAt: Date.now(),
  };

  // Leads vindos do quiz de qualificação (LP fv1): recebem mensagem própria (abaixo)
  // e o board os coloca direto na coluna "Lead Qualificado" pela origem (_source).
  const isQuizQualificado = /quiz/i.test(String(origem));

  await db.ref("leads/" + key).set(leadData);
  // Inicia estado da cadência automática (envio só ocorre se config/cadencia/enabled=true)
  try { await cadStart(key, leadData); } catch (e) { console.error("cadStart intake:", e); }

  // Evento Lead server-side para o Meta (CAPI) — nao bloqueia o fluxo
  try { await enviarMetaCAPI(leadData, req); } catch (e) { console.error("CAPI call error:", e); }

  // Dispara o webhook do Make para salvar o lead na planilha
  await notifyMake({ ...body, ...leadData });

  // Dispara a mensagem inicial via WhatsApp (Z-API).
  // Quiz qualificado recebe a mensagem própria; demais leads, o primeiro contato do João.
  // EXCEÇÃO: leads de faixa baixa (<15k quiz / <20k LP) são direcionados à LP "Vivendo de Delivery"
  // e NÃO recebem mensagem (entram arquivados no board, apenas salvos no banco).
  const _invLC = String(investimento || "").toLowerCase();
  const _naoQuer = _invLC === "nao" || _invLC.indexOf("prioridade") >= 0 || _invLC.indexOf("não pretendo") >= 0 || _invLC.indexOf("nao pretendo") >= 0 || _invLC.indexOf("não consigo") >= 0 || _invLC.indexOf("nao consigo") >= 0;
  const faixaBaixa = ["ate-15", "0-15", "ate-20"].includes(String(faixa || "")) || (_naoQuer && ["15-20", "20-50", "15-30", "30-50"].includes(String(faixa || "")));
  if (!faixaBaixa) {
    await enviarMensagemWhatsapp(tel, isQuizQualificado ? mensagemQuizQualificado(nome) : mensagemPrimeiroContato(nome));
  }

  if (isBrowser) {
    return res.redirect(302, REDIRECT_OK);
  }
  return res.status(200).json({ ok: true, key });
}

// ===== Rota /track: coleta de eventos da LP (analytics proprio, sem plataforma externa) =====
async function handleTrack(req, res) {
  try {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    const sid = String(body.sid || "anon").replace(/[.#$\[\]\/]/g, "_").slice(0, 64);
    const events = Array.isArray(body.events) ? body.events : [];
    const now = Date.now();
    const updates = {};
    let lastSection = "", maxScroll = 0, converted = false, reachedForm = false;
    events.forEach((ev) => {
      const name = String((ev && ev.e) || "").slice(0, 48);
      if (!name) return;
      const k = now + "_" + Math.random().toString(36).slice(2, 10);
      updates["analytics/events/" + sid + "/" + k] = { e: name, p: (ev && ev.p) || {}, t: (ev && ev.t) || now };
      if (name === "section_view" && ev.p && ev.p.secao) lastSection = ev.p.secao;
      if (name === "scroll_depth" && ev.p && ev.p.percent) maxScroll = Math.max(maxScroll, Number(ev.p.percent) || 0);
      if (name === "form_start") reachedForm = true;
      if (name === "lead_submit") converted = true;
    });
    const sessRef = db.ref("analytics/sessions/" + sid);
    await sessRef.update({
      page: body.page || "", device: body.device || "", ref: body.ref || "",
      utm_source: (body.utms && body.utms.source) || "", utm_medium: (body.utms && body.utms.medium) || "",
      utm_campaign: (body.utms && body.utms.campaign) || "", utm_content: (body.utms && body.utms.content) || "",
      lastSeen: now,
    });
    await sessRef.child("firstSeen").transaction((v) => v || now);
    if (lastSection) await sessRef.child("lastSection").set(lastSection);
    if (reachedForm) await sessRef.child("reachedForm").set(true);
    if (maxScroll) await sessRef.child("maxScroll").transaction((v) => Math.max(Number(v) || 0, maxScroll));
    if (converted) await sessRef.child("converted").set(true);
    if (Object.keys(updates).length) await db.ref().update(updates);
    return res.status(204).send("");
  } catch (err) {
    console.error("handleTrack error:", err);
    return res.status(204).send(""); // coleta e best-effort: nunca falha alto
  }
}

// Mensagem de escassez de agenda (enviada logo após a confirmação de reunião)
function mensagemEscassez(nomeCompleto, responsavel) {
  var primeiroNome = primeiroNomeDe(nomeCompleto);
  var closer = responsavel && responsavel.trim() ? responsavel.trim() : "Lucas";
  return "Conto com sua presença, meu amigo! 🤝\n\n" +
    "Abri um horário aqui pra você na agenda do " + closer + ", que cá entre nós, " +
    "tá bem difícil de achar 😂\n\n" +
    "Mas pra nós é um prazer poder ter essa conversa com você!";
}

// ===== Rota /agendar: dispara a confirmacao de reuniao (texto + imagens) =====
async function handleAgendar(req, res) {
  if (req.method !== "POST") {
    res.set("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  if (!checaSecret(req)) {
    return res.status(401).send("Unauthorized");
  }

  const body = req.body || {};
  const telefone = pick(body, ["telefone", "phone", "tel"]);
  const nome = pick(body, ["nome", "name"]);
  const meetingDisplay = pick(body, ["meetingDisplay", "dataHora", "data_hora"]);
  const meetLink = pick(body, ["meetLink", "meet_link", "googleMeet"]);
  const responsavel = pick(body, ["responsavel", "closer", "responsible"]);

  if (!telefone) {
    return res.status(400).json({ ok: false, error: "telefone é obrigatório" });
  }

  // 1. Confirmação + imagens de resultado
  await enviarMensagemWhatsapp(telefone, mensagemConfirmacaoParte1(nome));
  await enviarImagemWhatsapp(telefone, IMG_FATURAMENTO_ANTERIOR, "");
  await enviarImagemWhatsapp(telefone, IMG_FATURAMENTO_ATUAL, legendaFaturamentoAtual());
  if (meetingDisplay) {
    await enviarMensagemWhatsapp(telefone, mensagemConfirmacaoParte2(meetingDisplay));
  }

  // 2. Link do Google Meet (se disponível)
  if (meetLink) {
    await enviarMensagemWhatsapp(telefone, "📅 Aqui está o link da nossa videochamada:\n" + meetLink);
  }

  // 3. Mensagem de escassez de agenda
  await enviarMensagemWhatsapp(telefone, mensagemEscassez(nome, responsavel));

  return res.status(200).json({ ok: true });
}

// ===== Rota /quiz-agendou: chamada pela LP quiz quando o lead marca no Calendly =====
// Move o card para "Reunião Agendada", atribui o closer pelo faturamento e dispara
// a confirmação de reunião no WhatsApp (voz Audens). NÃO cria evento no Google Agenda
// (o Calendly já cria, conectado à agenda) para evitar duplicidade.
function closerPorFaixa(faixa) {
  // Acima de R$ 50 mil -> Lucas | Abaixo de R$ 50 mil (20-50) -> Gustavo
  return (faixa === "50-100" || faixa === "100-300" || faixa === "300+") ? "Lucas" : "Gustavo";
}
async function handleQuizAgendou(req, res) {
  if (req.method !== "POST") { res.set("Allow", "POST"); return res.status(405).send("Method Not Allowed"); }
  if (!checaSecret(req)) { return res.status(401).send("Unauthorized"); }
  const body = req.body || {};
  const nome = pick(body, ["nome", "name"]);
  const telRaw = pick(body, ["telefone", "phone", "whatsapp", "tel"]);
  const faixa = pick(body, ["faixa", "faturamento_faixa"]) || "";
  if (!telRaw) { return res.status(400).json({ ok: false, error: "telefone é obrigatório" }); }
  const tel = String(telRaw).replace(/\D/g, "");
  const key = (tel || "lead_" + Date.now()).replace(/[.#$\[\]]/g, "_");
  const responsavel = closerPorFaixa(faixa);
  // Feedback imediato: move o card p/ "Reunião Agendada" + atribui o closer.
  // O horário exato, os lembretes e a confirmação no WhatsApp vêm pelo webhook do
  // Calendly (/calendly-webhook), que traz a data/hora reais do agendamento.
  try { await db.ref("kanban/" + key).update({ status: "reuniao", statusAt: Date.now(), responsavel: responsavel, _aguardandoWebhook: true }); } catch (e) { console.error("quiz-agendou kanban:", e); }
  try { await cadStop(key, "meeting_scheduled"); } catch (e) {}
  try { await cadNsStop(key, "meeting_scheduled"); } catch (e) {}
  try { await cadReatStop(key, "meeting_scheduled"); } catch (e) {}
  return res.status(200).json({ ok: true, responsavel: responsavel });
}

// ===== Rota /setup-calendly-webhook: registra a assinatura do webhook no Calendly (one-time) =====
// Uso: abrir no navegador
//   https://<cloud-run>/setup-calendly-webhook?secret=<WEBHOOK_SECRET>&token=<PAT_DO_CALENDLY>
// A função (que roda no Cloud Run e alcança o Calendly) cria a assinatura apontando p/ /calendly-webhook.
async function handleSetupCalendlyWebhook(req, res) {
  if (!checaSecret(req)) return res.status(401).send("Unauthorized");
  const token = (req.query && req.query.token) || (req.body && req.body.token) || "";
  if (!token) return res.status(400).json({ ok: false, error: "token do Calendly é obrigatório (?token=...)" });
  try {
    const meR = await fetch("https://api.calendly.com/users/me", { headers: { Authorization: "Bearer " + token } });
    const me = await meR.json();
    const org = me && me.resource && me.resource.current_organization;
    if (!org) return res.status(400).json({ ok: false, error: "não consegui obter a organização do Calendly", detalhe: me });
    const host = req.headers["x-forwarded-host"] || req.headers.host || "receberlead-471063273836.us-central1.run.app";
    const callbackUrl = "https://" + host + "/calendly-webhook";
    // Evita duplicar: lista assinaturas existentes p/ essa organização
    try {
      const listR = await fetch("https://api.calendly.com/webhook_subscriptions?organization=" + encodeURIComponent(org) + "&scope=organization", { headers: { Authorization: "Bearer " + token } });
      const list = await listR.json();
      const jaExiste = (list && list.collection || []).find(function (w) { return w && w.callback_url === callbackUrl; });
      if (jaExiste) return res.status(200).json({ ok: true, jaRegistrado: true, webhook: jaExiste, callback_url: callbackUrl });
    } catch (e) {}
    const subR = await fetch("https://api.calendly.com/webhook_subscriptions", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ url: callbackUrl, events: ["invitee.created", "invitee.canceled"], organization: org, scope: "organization" })
    });
    const sub = await subR.json();
    return res.status(subR.ok ? 200 : 400).json({ ok: subR.ok, http: subR.status, callback_url: callbackUrl, webhook: sub });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}

// ===== Rota /backfill-calendly: importa agendamentos JA existentes do Calendly p/ o CRM =====
// Uso (uma vez, no navegador):
//   /backfill-calendly?secret=<WEBHOOK_SECRET>&token=<PAT_CALENDLY>[&days_back=30&days_ahead=120&notify=0]
// Lista os scheduled_events ativos da organizacao, casa cada convidado com o lead
// (telefone -> email -> nome, mesma logica do webhook) e cria meetings/ + move o card.
// notify=0 (padrao) NAO reenvia WhatsApp, pra nao spammar quem ja foi contatado.
async function handleBackfillCalendly(req, res) {
  if (!checaSecret(req)) return res.status(401).send("Unauthorized");
  const token = (req.query && req.query.token) || (req.body && req.body.token) || "";
  if (!token) return res.status(400).json({ ok: false, error: "token do Calendly e obrigatorio (?token=...)" });
  const daysBack = parseInt(req.query.days_back || "30", 10);
  const daysAhead = parseInt(req.query.days_ahead || "120", 10);
  const notify = String((req.query && req.query.notify) || "0") === "1";
  try {
    const meR = await fetch("https://api.calendly.com/users/me", { headers: { Authorization: "Bearer " + token } });
    const me = await meR.json();
    const org = me && me.resource && me.resource.current_organization;
    if (!org) return res.status(400).json({ ok: false, error: "nao consegui obter a organizacao do Calendly", detalhe: me });

    const now = Date.now();
    const minT = new Date(now - daysBack * 86400000).toISOString();
    const maxT = new Date(now + daysAhead * 86400000).toISOString();

    let url = "https://api.calendly.com/scheduled_events?organization=" + encodeURIComponent(org) +
      "&status=active&min_start_time=" + encodeURIComponent(minT) +
      "&max_start_time=" + encodeURIComponent(maxT) + "&count=100";
    const eventos = [];
    let guard = 0;
    while (url && guard < 20) {
      guard++;
      const evR = await fetch(url, { headers: { Authorization: "Bearer " + token } });
      const evJ = await evR.json();
      if (!evR.ok) return res.status(400).json({ ok: false, step: "scheduled_events", http: evR.status, detalhe: evJ });
      (evJ.collection || []).forEach(function (e) { eventos.push(e); });
      url = (evJ.pagination && evJ.pagination.next_page) || "";
    }

    const out = { total_eventos: eventos.length, criados: 0, ja_existiam: 0, sem_match: 0, ignorados: 0, itens: [] };
    for (let i = 0; i < eventos.length; i++) {
      const se = eventos[i];
      const seUri = se.uri || "";
      let invitees = [];
      try {
        const invR = await fetch(seUri + "/invitees?count=20", { headers: { Authorization: "Bearer " + token } });
        const invJ = await invR.json();
        invitees = (invJ && invJ.collection) || [];
      } catch (e) { invitees = []; }
      for (let j = 0; j < invitees.length; j++) {
        const inv = invitees[j] || {};
        if (inv.status && inv.status !== "active") { out.ignorados++; continue; }
        const pp = {
          name: inv.name || "",
          email: inv.email || "",
          questions_and_answers: inv.questions_and_answers || [],
          text_reminder_number: inv.text_reminder_number || "",
          scheduled_event: { start_time: se.start_time, location: se.location }
        };
        const tel = extrairTelefoneCalendly(pp);
        const m = await acharKeyLead(tel, pp.email, pp.name);
        if (!m) { out.sem_match++; out.itens.push({ start: se.start_time, nome: pp.name, email: pp.email, tel: tel, status: "sem_match" }); continue; }
        const key = m.key;
        const startISO = se.start_time || "";
        let kb = {};
        try { kb = (await db.ref("kanban/" + key).once("value")).val() || {}; } catch (e) {}
        if (kb.meetingISO && kb.meetingISO === startISO) { out.ja_existiam++; out.itens.push({ start: startISO, nome: pp.name, key: key, status: "ja_existia" }); continue; }
        let lead = {};
        try { lead = (await db.ref("leads/" + key).once("value")).val() || {}; } catch (e) {}
        const nome = pp.name || lead.nome || kb.nome || "";
        const telFinal = String(tel || lead.telefone || kb.telefone || "").replace(/\D/g, "");
        const faixa = lead.faixa || kb.faixa || "";
        const responsavel = kb.responsavel || closerPorFaixa(faixa);
        const meetLink = (se.location && (se.location.join_url || se.location.location)) || "";
        const meetingDisplay = startISO ? formatBRT(startISO) : "";
        const mid = "km_" + key + "_bf_" + now + "_" + i + "_" + j;
        try {
          await db.ref("kanban/" + key).update({
            status: "reuniao", statusAt: Date.now(),
            meetingISO: startISO, meetingDisplay: meetingDisplay,
            responsavel: responsavel, meetLink: meetLink, meetingId: mid,
            lembretes: { h2: false, h1: false, m10: false }, _aguardandoWebhook: null
          });
          await db.ref("meetings/" + mid).set({
            id: mid, tel: telFinal, nome: String(nome), dtISO: startISO, dtDisplay: meetingDisplay,
            status: "pending", responsavel: responsavel, guestEmail: pp.email || "",
            faturamentoLead: lead.faturamento || kb.faturamento || "", origem: "Trafego",
            kanbanKey: key, sdrName: "JOAO", meetLink: meetLink, scheduledAt: Date.now(), _viaCalendly: true, _backfill: true
          });
          out.criados++;
          out.itens.push({ start: startISO, nome: nome, key: key, responsavel: responsavel, by: m.by, status: "criado" });
          if (notify && telFinal) {
            try {
              await enviarMensagemWhatsapp(telFinal, mensagemConfirmacaoParte1(nome));
              if (meetingDisplay) await enviarMensagemWhatsapp(telFinal, mensagemConfirmacaoParte2(meetingDisplay));
              if (meetLink) await enviarMensagemWhatsapp(telFinal, "Link da videochamada:\n" + meetLink);
            } catch (e) {}
          }
        } catch (e) {
          out.itens.push({ start: startISO, nome: nome, key: key, status: "erro", erro: String(e) });
        }
      }
    }
    return res.status(200).json({ ok: true, resultado: out });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}

// ===== Rota /calendly-webhook: recebe o evento invitee.created/canceled do Calendly =====
// Traz o horário REAL do agendamento → preenche meetingISO, move o card, atribui closer,
// registra a reunião (com lembretes) e dispara a confirmação no WhatsApp com o horário.
// NÃO cria evento no Google Agenda (o Calendly já cria, conectado à agenda).
function formatBRT(iso) {
  try {
    var d = new Date(iso);
    var data = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    var hora = d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    return data + " " + hora;
  } catch (e) { return ""; }
}
function extrairTelefoneCalendly(p) {
  try {
    if (p.text_reminder_number) { var t = String(p.text_reminder_number).replace(/\D/g, ""); if (t.length >= 10) return t; }
    var qa = p.questions_and_answers || [];
    // 1ª passada: pergunta que menciona whats/telefone/celular
    for (var i = 0; i < qa.length; i++) {
      var q = String((qa[i] && qa[i].question) || "").toLowerCase();
      var d1 = String((qa[i] && qa[i].answer) || "").replace(/\D/g, "");
      if (/whats|telefone|phone|celular|contato|n[uú]mero/.test(q) && d1.length >= 10) return d1;
    }
    // 2ª passada: qualquer resposta que pareça telefone
    for (var j = 0; j < qa.length; j++) {
      var d2 = String((qa[j] && qa[j].answer) || "").replace(/\D/g, "");
      if (d2.length >= 10 && d2.length <= 13) return d2;
    }
  } catch (e) {}
  return "";
}
async function acharKeyPorEmail(email) {
  try {
    var target = String(email || "").trim().toLowerCase();
    if (!target) return "";
    var snap = await db.ref("leads").once("value");
    var all = snap.val() || {};
    var found = "";
    Object.keys(all).forEach(function (k) {
      var l = all[k];
      if (l && String(l.email || "").trim().toLowerCase() === target) found = k;
    });
    return found;
  } catch (e) { return ""; }
}
// Gera variações do telefone p/ casar com a chave do lead (com/sem 55, 9º dígito).
function _telVariants(telRaw) {
  var d = String(telRaw || "").replace(/\D/g, "");
  var set = {};
  function add(x) { if (x && x.length >= 8) set[x] = true; }
  if (!d) return [];
  add(d);
  if (d.indexOf("55") === 0) add(d.slice(2)); else add("55" + d);
  var local = d.indexOf("55") === 0 ? d.slice(2) : d;
  if (local.length === 11 && local[2] === "9") {
    var without9 = local.slice(0, 2) + local.slice(3);
    add(without9); add("55" + without9);
  } else if (local.length === 10) {
    var with9 = local.slice(0, 2) + "9" + local.slice(2);
    add(with9); add("55" + with9);
  }
  return Object.keys(set);
}

// Resolve a chave do lead a partir de telefone -> email -> nome (nesta ordem de confiança).
async function acharKeyLead(tel, email, nome) {
  // 1) telefone (variações)
  var vars = _telVariants(tel);
  for (var i = 0; i < vars.length; i++) {
    var k = vars[i].replace(/[.#$\[\]]/g, "_");
    try {
      var l = (await db.ref("leads/" + k).once("value")).val();
      if (l) return { key: k, by: "telefone", conf: "alta" };
      var kb = (await db.ref("kanban/" + k).once("value")).val();
      if (kb) return { key: k, by: "kanban", conf: "alta" };
    } catch (e) {}
  }
  // 2) email
  if (email) {
    try { var ke = await acharKeyPorEmail(email); if (ke) return { key: ke, by: "email", conf: "alta" }; } catch (e) {}
  }
  // 3) nome (baixa confiança) — só leads que ainda não avançaram (novo/qualificado)
  if (nome) {
    var alvo = String(nome).trim().toLowerCase();
    var alvo1 = alvo.split(" ")[0] || "";
    try {
      var leadsAll = (await db.ref("leads").once("value")).val() || {};
      var kbAll = (await db.ref("kanban").once("value")).val() || {};
      var best = "", bestAt = -1;
      Object.keys(leadsAll).forEach(function (k) {
        var l = leadsAll[k] || {};
        var n = String(l.nome || "").trim().toLowerCase();
        if (!n) return;
        var kb = kbAll[k] || {};
        var st = kb.status || "";
        var okStatus = (st === "" || st === "novo" || st === "qualificado");
        var hit = (n === alvo) || (alvo1.length >= 3 && (n.split(" ")[0] || "") === alvo1);
        if (hit && okStatus) {
          var at = l._createdAt || kb.statusAt || 0;
          if (at >= bestAt) { bestAt = at; best = k; }
        }
      });
      if (best) return { key: best, by: "nome", conf: "baixa" };
    } catch (e) {}
  }
  return null;
}

async function handleCalendlyWebhook(req, res) {
  try {
    var body = req.body || {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    var evt = String(body.event || "");
    var p = body.payload || {};
    var tel = extrairTelefoneCalendly(p);
    var nomeInv = p.name || "";
    var m = await acharKeyLead(tel, p.email, nomeInv);
    if (!m) {
      console.warn("calendly-webhook: SEM MATCH -> tel:" + (tel || "-") + " email:" + (p.email || "-") + " nome:" + nomeInv);
      return res.status(200).json({ ok: true, matched: false, tel: tel || "", email: p.email || "", nome: nomeInv });
    }
    var key = m.key;
    console.log("calendly-webhook: match por " + m.by + " (" + m.conf + ") -> key " + key);

    if (evt === "invitee.canceled") {
      try { await db.ref("kanban/" + key).update({ status: "qualificado", statusAt: Date.now(), meetingCanceladaAt: Date.now() }); } catch (e) {}
      return res.status(200).json({ ok: true, canceled: true });
    }
    if (evt !== "invitee.created") { return res.status(200).json({ ok: true, ignored: evt }); }

    var se = p.scheduled_event || p.calendar_event || p.event || {};
    var startISO = se.start_time || "";
    var meetLink = (se.location && (se.location.join_url || se.location.location)) || "";
    var meetingISO = startISO || "";
    var meetingDisplay = startISO ? formatBRT(startISO) : "";

    var lead = {}, kb = {};
    try { lead = (await db.ref("leads/" + key).once("value")).val() || {}; } catch (e) {}
    try { kb = (await db.ref("kanban/" + key).once("value")).val() || {}; } catch (e) {}
    var nome = p.name || lead.nome || kb.nome || "";
    var telFinal = String(tel || lead.telefone || kb.telefone || "").replace(/\D/g, "");
    var faixa = lead.faixa || kb.faixa || "";
    var responsavel = kb.responsavel || closerPorFaixa(faixa);

    // Espelha o estado que o board cria ao agendar (confirmarAgendamentoReuniao), sem gcal.
    var mid = "km_" + key + "_" + Date.now();
    try {
      await db.ref("kanban/" + key).update({
        status: "reuniao", statusAt: Date.now(),
        meetingISO: meetingISO, meetingDisplay: meetingDisplay,
        responsavel: responsavel, meetLink: meetLink, meetingId: mid,
        lembretes: { h2: false, h1: false, m10: false },
        _aguardandoWebhook: null
      });
    } catch (e) { console.error("calendly-webhook kanban:", e); }
    try {
      await db.ref("meetings/" + mid).set({
        id: mid, tel: telFinal, nome: String(nome), dtISO: meetingISO, dtDisplay: meetingDisplay,
        status: "pending", responsavel: responsavel, guestEmail: p.email || "",
        faturamentoLead: lead.faturamento || kb.faturamento || "", origem: "Tráfego",
        kanbanKey: key, sdrName: "JOÃO", meetLink: meetLink, scheduledAt: Date.now(), _viaCalendly: true
      });
    } catch (e) { console.error("calendly-webhook meeting:", e); }
    try { await cadStop(key, "meeting_scheduled"); } catch (e) {}
  try { await cadNsStop(key, "meeting_scheduled"); } catch (e) {}
  try { await cadReatStop(key, "meeting_scheduled"); } catch (e) {}

    // Confirmação no WhatsApp (com o horário) — mesma sequência da rota /agendar
    try {
      if (telFinal) {
        await enviarMensagemWhatsapp(telFinal, mensagemConfirmacaoParte1(nome));
        await enviarImagemWhatsapp(telFinal, IMG_FATURAMENTO_ANTERIOR, "");
        await enviarImagemWhatsapp(telFinal, IMG_FATURAMENTO_ATUAL, legendaFaturamentoAtual());
        if (meetingDisplay) await enviarMensagemWhatsapp(telFinal, mensagemConfirmacaoParte2(meetingDisplay));
        if (meetLink) await enviarMensagemWhatsapp(telFinal, "📅 Aqui está o link da nossa videochamada:\n" + meetLink);
        await enviarMensagemWhatsapp(telFinal, mensagemEscassez(nome, responsavel));
      }
    } catch (e) { console.error("calendly-webhook WA:", e); }

    return res.status(200).json({ ok: true, key: key, responsavel: responsavel });
  } catch (err) {
    console.error("calendly-webhook error:", err);
    return res.status(200).json({ ok: true }); // sempre 200 pra o Calendly não re-tentar em loop
  }
}

// ===== Rota /reagendar: avisa o cliente que a data/hora foi alterada e reseta flags de lembretes =====
function mensagemReagendamento(nomeCompleto, meetingDisplay) {
  var primeiroNome = primeiroNomeDe(nomeCompleto);
  return "Olá " + primeiroNome + "! 📅\n" +
    "Precisamos reagendar a nossa reunião. O novo horário ficou marcado para:\n\n" +
    "🗓️ *" + meetingDisplay + "*\n\n" +
    "Qualquer dúvida é só chamar aqui. Até lá!";
}

// Mensagem enviada na véspera da reunião (às 21h BRT)
function mensagemLembreteVespera(nomeCompleto) {
  var primeiroNome = primeiroNomeDe(nomeCompleto);
  return "Olá " + primeiroNome + "! 👋\n\n" +
    "Estou aqui estudando sobre o seu negócio para que amanhã possamos fazer uma análise estratégica completa e te ajudar a vender mais! 📊\n\n" +
    "Fico no aguardo da nossa reunião. Até amanhã!";
}

// Endpoint chamado pelo Cloud Scheduler às 21h BRT (0 0 * * * UTC)
// Lê meetings do Firebase com status agendada (pending) para amanhã e envia WA
// Params opcionais:
//   ?data=YYYY-MM-DD  → forçar data alvo (para testes)
//   ?dryrun=1         → não envia mensagens, só retorna o que seria enviado
async function handleLembreteVespera(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }
  if (!checaSecret(req)) return res.status(401).send("Unauthorized");

  try {
    const snap = await db.ref("meetings").once("value");
    const meetings = snap.val() || {};
    const dryrun = req.query.dryrun === '1';

    // Permite forçar a data via ?data=YYYY-MM-DD (útil para teste)
    let amanhaStr = req.query.data || '';
    if (!amanhaStr) {
      // Calcular a data de amanhã no fuso de Brasília (UTC-3)
      // Cloud Run roda em UTC, então "amanhã BRT" = UTC agora + 24h - 3h
      const agora = new Date();
      const amanhaUTC = new Date(agora.getTime() + 24 * 60 * 60 * 1000);
      const amanhaBRT = new Date(amanhaUTC.getTime() - 3 * 60 * 60 * 1000);
      const yyyy = amanhaBRT.getUTCFullYear();
      const mm = String(amanhaBRT.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(amanhaBRT.getUTCDate()).padStart(2, '0');
      amanhaStr = yyyy + '-' + mm + '-' + dd;
    }
    console.log("lembrete-vespera: data alvo =", amanhaStr, dryrun ? "(DRYRUN)" : "");

    // Diagnóstico: listar todos os meetings e por que cada um foi ignorado
    const diagnostico = [];

    const enviados = [];
    const erros = [];
    // Para notificação da equipe: reuniões agrupadas por closer
    const reunioesPorCloser = {}; // { 'lucas': [...], 'gustavo': [...] }
    const todasAmanha = [];

    for (const [mid, m] of Object.entries(meetings)) {
      // Diagnóstico — razão de pular
      let skipReason = null;
      if (m.status && m.status !== 'pending') skipReason = 'status=' + m.status;
      else if (!m.tel) skipReason = 'sem_tel';
      else if (!m.dtISO) skipReason = 'sem_dtISO';
      else if (!m.dtISO.startsWith(amanhaStr)) skipReason = 'data_diferente(' + m.dtISO.substring(0,10) + ')';

      diagnostico.push({ mid, nome: m.nome, dtISO: m.dtISO, tel: m.tel, status: m.status, skip: skipReason });

      if (skipReason) continue;

      // Envia lembrete ao lead
      if (!dryrun) {
        try {
          await enviarMensagemWhatsapp(m.tel, mensagemLembreteVespera(m.nome || ''));
          enviados.push({ mid, nome: m.nome, tel: m.tel });
        } catch (e) {
          console.error("lembrete-vespera erro para", mid, e.message);
          erros.push({ mid, erro: e.message });
        }
      } else {
        enviados.push({ mid, nome: m.nome, tel: m.tel, dryrun: true });
      }

      // Coleta para resumo da equipe
      todasAmanha.push(m);
      const resp = (m.responsavel || '').toLowerCase().trim();
      if (!reunioesPorCloser[resp]) reunioesPorCloser[resp] = [];
      reunioesPorCloser[resp].push(m);
    }

    // Busca contatos da equipe no Firebase
    const contatosSnap = await db.ref("config/contatos_equipe").once("value");
    const contatos = contatosSnap.val() || {};

    // Notifica Lucas com as reuniões dele
    const reunioesLucas = reunioesPorCloser['lucas'] || [];
    if (contatos.lucas && reunioesLucas.length && !dryrun) {
      try {
        await enviarMensagemWhatsapp(contatos.lucas, mensagemEquipeVespera('Lucas', reunioesLucas));
        console.log("Lembrete equipe enviado para Lucas:", reunioesLucas.length, "reuniões");
      } catch(e) { console.error("Erro lembrete Lucas:", e.message); }
    }

    // Notifica Gustavo com as reuniões dele
    const reunioesGustavo = reunioesPorCloser['gustavo'] || [];
    if (contatos.gustavo && reunioesGustavo.length && !dryrun) {
      try {
        await enviarMensagemWhatsapp(contatos.gustavo, mensagemEquipeVespera('Gustavo', reunioesGustavo));
        console.log("Lembrete equipe enviado para Gustavo:", reunioesGustavo.length, "reuniões");
      } catch(e) { console.error("Erro lembrete Gustavo:", e.message); }
    }

    // Notifica João com TODAS as reuniões
    if (contatos.joao && todasAmanha.length && !dryrun) {
      try {
        await enviarMensagemWhatsapp(contatos.joao, mensagemEquipeVesperaSDR(todasAmanha));
        console.log("Lembrete equipe enviado para João:", todasAmanha.length, "reuniões");
      } catch(e) { console.error("Erro lembrete João:", e.message); }
    }

    return res.status(200).json({
      ok: true,
      dryrun,
      dataAlvo: amanhaStr,
      totalMeetingsNoFirebase: Object.keys(meetings).length,
      encontrados: todasAmanha.length,
      enviados: enviados.length,
      erros: erros.length,
      detalhes: enviados,
      equipe: { lucas: reunioesLucas.length, gustavo: reunioesGustavo.length, joao: todasAmanha.length, contatosSalvos: contatos },
      diagnostico  // lista todos meetings e por que cada um foi/não foi processado
    });
  } catch (e) {
    console.error("handleLembreteVespera erro:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

async function handleReagendar(req, res) {
  if (req.method !== "POST") { res.set("Allow", "POST"); return res.status(405).send("Method Not Allowed"); }
  if (!checaSecret(req)) return res.status(401).send("Unauthorized");
  const body = req.body || {};
  const telefone = pick(body, ["telefone", "phone", "tel"]);
  const nome = pick(body, ["nome", "name"]);
  const meetingDisplay = pick(body, ["meetingDisplay", "dataHora", "data_hora"]);
  const meetingId = body.meetingId || '';
  const kanbanKey = pick(body, ["kanbanKey", "key"]);
  const meetingISO = pick(body, ["meetingISO", "dtISO"]);
  const responsavel = body.responsavel || '';
  const forcarNoshow = body.forcarNoshow === true;

  // Busca meeting atual no Firebase para saber quantas vezes já reagendou
  let reagendamentos = 0;
  let oldMeeting = null;
  if (meetingId) {
    try {
      const snap = await db.ref("meetings/" + meetingId).once("value");
      oldMeeting = snap.val();
      if (oldMeeting) reagendamentos = oldMeeting.reagendamentos || 0;
    } catch (e) { console.error("handleReagendar: erro ao buscar meeting:", e); }
  }

  // Busca contatos da equipe
  const contatosSnap = await db.ref("config/contatos_equipe").once("value");
  const contatos = contatosSnap.val() || {};

  // Auto no-show: 3ª tentativa (reagendamentos >= 2) ou forçado
  const autoNoshow = forcarNoshow || reagendamentos >= 2;

  if (autoNoshow) {
    // Marca meeting antigo como noshow
    if (meetingId) {
      try {
        await db.ref("meetings/" + meetingId).update({ status: 'noshow' });
      } catch (e) { console.error("handleReagendar: erro ao marcar noshow:", e); }
    }
    // Notifica equipe do no-show automático
    const msgNoshow =
      "⚠️ *No-Show Automático*\n\n" +
      "Lead: *" + (nome || "—") + "*\n" +
      "Motivo: " + (reagendamentos + 1) + "º tentativa de reagendamento.\n" +
      "Classificado automaticamente como No-Show.";
    if (contatos.lucas) await enviarMensagemWhatsapp(contatos.lucas, msgNoshow).catch(() => {});
    if (contatos.joao) await enviarMensagemWhatsapp(contatos.joao, msgNoshow).catch(() => {});
    console.log("handleReagendar: auto-noshow para", meetingId, "reagendamentos:", reagendamentos);
    return res.status(200).json({ ok: true, autoNoshow: true, reagendamentos });
  }

  // Valida campos necessários para reagendamento real
  if (!telefone || !meetingDisplay) {
    return res.status(400).json({ ok: false, error: "telefone e meetingDisplay são obrigatórios" });
  }

  // Marca meeting antigo como reagendado
  if (meetingId) {
    try {
      await db.ref("meetings/" + meetingId).update({ status: 'reagendado' });
    } catch (e) { console.error("handleReagendar: erro ao marcar reagendado:", e); }
  }

  // Cria novo meeting no Firebase
  const newCount = reagendamentos + 1;
  const newMeetingId = "reagendo_" + (meetingId || "m") + "_" + Date.now();
  const newMeeting = {
    id: newMeetingId,
    nome: nome || (oldMeeting && oldMeeting.nome) || "",
    tel: telefone,
    dtDisplay: meetingDisplay,
    dtISO: meetingISO || "",
    status: "pending",
    responsavel: responsavel || (oldMeeting && oldMeeting.responsavel) || "",
    sdr: (oldMeeting && oldMeeting.sdr) || "",
    origem: (oldMeeting && oldMeeting.origem) || "",
    kanbanKey: kanbanKey || (oldMeeting && oldMeeting.kanbanKey) || "",
    meetLink: (oldMeeting && oldMeeting.meetLink) || "",
    reagendamentos: newCount,
    reagendadoDe: meetingId || "",
    criadoEm: Date.now()
  };
  try {
    await db.ref("meetings/" + newMeetingId).set(newMeeting);
  } catch (e) { console.error("handleReagendar: erro ao criar novo meeting:", e); }

  // Atualiza kanban: nova data + reseta lembretes
  if (kanbanKey && meetingISO) {
    try {
      await db.ref("kanban/" + kanbanKey).update({
        meetingISO: meetingISO,
        lembretes: { h2: false, h1: false, m10: false }
      });
    } catch (e) { console.error("handleReagendar: erro ao atualizar kanban:", e); }
  }

  // Envia mensagem de reagendamento para o lead
  await enviarMensagemWhatsapp(telefone, mensagemReagendamento(nome, meetingDisplay));

  // Notifica equipe (closer + João)
  const msgEquipe =
    "↩️ *Reunião Reagendada* (" + newCount + "/2)\n\n" +
    "Lead: *" + (nome || "—") + "*\n" +
    "Nova data: " + meetingDisplay + "\n" +
    "Closer: " + (responsavel || "—");
  const respLower = responsavel.toLowerCase();
  if (respLower.includes("lucas") && contatos.lucas) await enviarMensagemWhatsapp(contatos.lucas, msgEquipe).catch(() => {});
  if (respLower.includes("gustavo") && contatos.gustavo) await enviarMensagemWhatsapp(contatos.gustavo, msgEquipe).catch(() => {});
  if (contatos.joao) await enviarMensagemWhatsapp(contatos.joao, msgEquipe).catch(() => {});

  console.log("handleReagendar: reagendamento", newCount, "para", nome, "nova data:", meetingDisplay);
  return res.status(200).json({ ok: true, autoNoshow: false, reagendamentos: newCount, newMeeting });
}

// ===== Rota /asaas-webhook: recebe notificações de pagamento do Asaas e grava no Firebase =====
async function handleAsaasWebhook(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  // Valida token de autenticação do Asaas
  const ASAAS_WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN || "";
  if (ASAAS_WEBHOOK_TOKEN) {
    const receivedToken = req.headers["asaas-access-token"] || req.headers["authorization"] || "";
    if (receivedToken !== ASAAS_WEBHOOK_TOKEN) {
      console.warn("asaas-webhook: token inválido recebido");
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }
  try {
    const body = req.body || {};
    const event = body.event || "";
    const payment = body.payment;
    if (!payment || !payment.id) return res.status(200).json({ ok: true, skipped: true });

    const relevantEvents = [
      "PAYMENT_RECEIVED", "PAYMENT_CONFIRMED", "PAYMENT_RECEIVED_IN_CASH",
      "PAYMENT_REFUNDED", "PAYMENT_DELETED", "PAYMENT_OVERDUE", "PAYMENT_UPDATED"
    ];
    if (!relevantEvents.includes(event)) return res.status(200).json({ ok: true, skipped: event });

    const key = payment.id.replace(/[.#$[\]]/g, "_");
    const entry = {
      id: payment.id,
      customerId: payment.customer || "",
      customerName: payment.customerName || "",
      value: payment.value || 0,
      netValue: payment.netValue || payment.value || 0,
      status: payment.status || "",
      paymentDate: payment.paymentDate || payment.confirmedDate || payment.creditDate || "",
      dueDate: payment.dueDate || "",
      description: payment.description || "",
      billingType: payment.billingType || "",
      event,
      source: "asaas",
      syncedAt: Date.now()
    };
    await db.ref("financeiro/recebimentos/" + key).update(entry);
    console.log("asaas-webhook:", event, payment.id, payment.status);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("/asaas-webhook error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ===== Rota /asaas-sync: importa pagamentos do Asaas para o Firebase =====
async function handleAsaasSync(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  if (!checaSecret(req)) return res.status(401).send("Unauthorized");

  const { apiKey, env = "production", period } = req.body || {};
  if (!apiKey) return res.status(400).json({ ok: false, error: "apiKey required" });

  const base = env === "sandbox"
    ? "https://sandbox.asaas.com/api/v3"
    : "https://api.asaas.com/v3";

  const asaasGet = async (endpoint) => {
    try {
      const r = await fetch(base + endpoint, {
        headers: { "access_token": apiKey, "Content-Type": "application/json", "User-Agent": "AudensCRM/1.0" }
      });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  };

  try {
    // Monta mapa customerId → nome
    const custData = await asaasGet("/customers?limit=100");
    const customerMap = {};
    (custData?.data || []).forEach(c => { if (c.id) customerMap[c.id] = c.name || ""; });

    // Períodos a sincronizar
    let dates = [];
    if (period) {
      const [m, y] = period.split("/");
      const firstISO = `${y}-${String(m).padStart(2,"0")}-01`;
      const lastDayNum = new Date(parseInt(y), parseInt(m), 0).getDate();
      const lastISO = `${y}-${String(m).padStart(2,"0")}-${String(lastDayNum).padStart(2,"0")}`;
      dates = [[firstISO, lastISO]];
    } else {
      // Últimos 3 meses
      const now = new Date();
      for (let i = 0; i < 3; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const mon = d.getMonth() + 1;
        const yr = d.getFullYear();
        const firstISO = `${yr}-${String(mon).padStart(2,"0")}-01`;
        const lastDayNum = new Date(yr, mon, 0).getDate();
        const lastISO = `${yr}-${String(mon).padStart(2,"0")}-${String(lastDayNum).padStart(2,"0")}`;
        dates.push([firstISO, lastISO]);
      }
    }

    const statuses = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"];
    const updates = {};

    for (const [firstISO, lastISO] of dates) {
      for (const status of statuses) {
        const data = await asaasGet(
          `/payments?limit=100&status=${status}&paymentDate[ge]=${firstISO}&paymentDate[le]=${lastISO}&sort=paymentDate&order=desc`
        );
        for (const p of (data?.data || [])) {
          if (!p.id) continue;
          const k = p.id.replace(/[.#$[\]]/g, "_");
          updates["financeiro/recebimentos/" + k] = {
            id: p.id,
            customerId: p.customer || "",
            customerName: customerMap[p.customer] || "",
            value: p.value || 0,
            netValue: p.netValue || p.value || 0,
            status: p.status || "",
            paymentDate: p.paymentDate || p.confirmedDate || "",
            dueDate: p.dueDate || "",
            description: p.description || "",
            billingType: p.billingType || "",
            source: "asaas",
            syncedAt: Date.now()
          };
        }
      }
    }

    const total = Object.keys(updates).length;
    if (total > 0) await db.ref().update(updates);

    console.log("asaas-sync: saved", total, "payments to Firebase");
    return res.status(200).json({ ok: true, total, periods: dates.map(d => d[0] + " → " + d[1]) });
  } catch (e) {
    console.error("/asaas-sync error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ===== Rota /asaas: proxy para a API do Asaas (resolve CORS do browser) =====
async function handleAsaasProxy(req, res) {
  if (req.method !== "POST") {
    res.set("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }
  const { endpoint, method = "GET", body: bodyData, apiKey, env = "production" } = req.body || {};
  if (!apiKey || !endpoint) {
    return res.status(400).json({ ok: false, error: "missing apiKey or endpoint" });
  }
  const base = env === "sandbox"
    ? "https://sandbox.asaas.com/api/v3"
    : "https://api.asaas.com/v3";
  try {
    const opts = {
      method,
      headers: { "access_token": apiKey, "Content-Type": "application/json", "User-Agent": "AudensCRM/1.0" }
    };
    if (method !== "GET" && bodyData) opts.body = JSON.stringify(bodyData);
    const r = await fetch(base + endpoint, opts);
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    console.error("Asaas proxy error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ===== Rota /assinatura: envia o link de assinatura eletronica do contrato =====
async function handleEnviarAssinatura(req, res) {
  if (req.method !== "POST") {
    res.set("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  if (!checaSecret(req)) {
    return res.status(401).send("Unauthorized");
  }

  const body = req.body || {};
  const telefone = pick(body, ["telefone", "phone", "tel"]);
  const nome = pick(body, ["nome", "name"]);
  const link = pick(body, ["link", "url", "signLink"]);

  if (!telefone || !link) {
    return res.status(400).json({ ok: false, error: "telefone e link são obrigatórios" });
  }

  await enviarMensagemWhatsapp(telefone, mensagemLinkAssinatura(nome, link));

  return res.status(200).json({ ok: true });
}

// ===== Rota /lembretes: chamada pelo Cloud Scheduler a cada poucos minutos =====
// Varre /kanban procurando reunioes agendadas e dispara os lembretes de
// 2h / 1h / 10min antes do horario marcado, marcando flags para nao duplicar.
// ===== FINANCEIRO — FASE 2: COMPROVANTE VIA WHATSAPP =====

// Chama Claude Vision API para extrair dados estruturados de um comprovante
async function callClaudeVision(imageBase64, mediaType) {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY não configurada");
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType || "image/jpeg", data: imageBase64 }
          },
          {
            type: "text",
            text: `Analise este comprovante/nota fiscal/recibo e extraia os dados em JSON com exatamente estes campos:
{
  "valor": número decimal (sem R$, ex: 350.00),
  "data": "YYYY-MM-DD",
  "fornecedor": "nome do estabelecimento ou fornecedor",
  "categoria": uma de: "Infraestrutura", "Marketing", "Equipe", "Impostos", "Comissoes", "Outros",
  "descricao": "descrição curta do que é a despesa"
}
Se a imagem não for um comprovante válido, retorne: {"erro": "nao e um comprovante"}.
Retorne APENAS o JSON puro, sem markdown, sem explicação extra.`
          }
        ]
      }]
    })
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error("Anthropic API error " + resp.status + ": " + errText);
  }
  const data = await resp.json();
  let text = (data.content?.[0]?.text || "").trim();
  // Strip markdown code fences if Claude wrapped the JSON in ```json ... ```
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(text);
}

// Formata valor em reais para exibição no WhatsApp
function fmtBRL(v) {
  return "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Lê um extrato bancário (PDF) via Claude e retorna array de transações {data, descricao, valor, categoria}
async function callClaudeExtrato(pdfBase64) {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY não configurada");
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "pdfs-2024-09-25",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: pdfBase64 }
          },
          {
            type: "text",
            text: `Analise este extrato bancário/financeiro e extraia TODAS as saídas, débitos ou despesas.
Retorne SOMENTE um JSON array sem markdown. Cada item deve ter:
- "data": string YYYY-MM-DD
- "descricao": string com nome/descrição do lançamento
- "valor": number positivo em reais
- "categoria": uma de: Alimentação, Transporte, Saúde, Moradia, Educação, Lazer, Serviços, Impostos, Fornecedor, Infraestrutura, Outros

Ignore créditos, entradas ou depósitos. Se não houver saídas, retorne [].
Exemplo: [{"data":"2026-06-01","descricao":"Supermercado Extra","valor":350.00,"categoria":"Alimentação"}]`
          }
        ]
      }]
    })
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error("Anthropic API error " + resp.status + ": " + errText);
  }
  const data = await resp.json();
  let text = (data.content?.[0]?.text || "").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(text);
}

// Recebe webhook do Z-API (mensagem com imagem ou texto de confirmação enviado por Lucas)
async function handleFinanceiroWpp(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const body = req.body || {};

  // Debug: log incoming webhook shape
  console.log("financeiro-wpp debug:", JSON.stringify({
    fromMe: body.fromMe,
    type: body.type,
    phone: body.phone,
    isGroup: body.isGroup,
    participantPhone: body.participantPhone,
    sender: body.sender,
    hasImage: !!body.image,
    hasText: !!body.text,
    bodyKeys: Object.keys(body)
  }));

  // Z-API envia fromMe:true quando a mensagem foi enviada pelo dono da instância (Lucas)
  const fromMe = body.fromMe === true;
  // Z-API nem sempre envia isGroup:true — usar o sufixo do phone como fallback
  const isGroup = body.isGroup === true
    || String(body.phone || "").endsWith("-group")
    || String(body.phone || "").includes("@g.us");
  const rawPhone = (body.phone || body.sender || "").replace(/@[^@]+$/, "").replace(/\D/g, "");
  const msgType = (body.type || "").toUpperCase();
  const hasImage = msgType === "IMAGE" || msgType === "STICKER" || !!body.image;
  const hasText = msgType === "TEXT" || !!body.text?.message;
  const hasDocument = msgType === "DOCUMENT" || !!body.document;
  const isPDF = hasDocument && (
    (body.document?.mimeType || "").includes("pdf") ||
    (body.document?.title || body.document?.fileName || "").toLowerCase().endsWith(".pdf")
  );

  // Identifica o remetente real (em grupos, é participantPhone; em mensagens diretas, é phone)
  const senderPhone = isGroup
    ? (body.participantPhone || "").replace(/\D/g, "")
    : (fromMe ? LUCAS_PHONE : rawPhone);
  const senderName = body.senderName || body.pushName || senderPhone;

  // Autorização: aceita (1) Lucas direto, (2) mensagens de grupo autorizado
  const isLucasDirect = fromMe || rawPhone === LUCAS_PHONE;
  const groupPhoneNorm = toWhatsappPhone(body.phone || "");
  const isGroupAllowed = isGroup && (!FINANCEIRO_GROUP_ID || groupPhoneNorm === FINANCEIRO_GROUP_ID);
  // Cadência (Fase 2): resposta de lead (não-Lucas, não-grupo) pausa a cadência dele
  try { if (!fromMe && !isGroup && rawPhone) { await cadHandleInbound(rawPhone, (body.text && body.text.message) || ""); } } catch (e) { console.error("cad inbound(fin):", e); }
  if (!isLucasDirect && !isGroupAllowed) {
    return res.status(200).send("ok");
  }

  // Remetente real da mensagem (para texto/SIM/NÃO, é quem está respondendo)
  const senderPhoneClean = senderPhone.replace(/\D/g, "");
  const lucasPhoneClean = (LUCAS_PHONE || "").replace(/\D/g, "");

  // isOtherGroupMember: mensagem vinda de outra pessoa no grupo (não do próprio Lucas/bot)
  // Comprovantes e extratos SÓ são processados neste caso.
  const isOtherGroupMember = isGroupAllowed && !fromMe
    && (!lucasPhoneClean || senderPhoneClean !== lucasPhoneClean);

  // replyPhone para mensagens de texto (SIM/NÃO/edição): volta para quem enviou
  const replyPhone = fromMe
    ? (LUCAS_PHONE || rawPhone)
    : (rawPhone || senderPhone);
  if (!replyPhone) return res.status(200).send("ok");

  // stateKey: chave do estado de aprovação de quem está respondendo agora
  // Em grupos, rawPhone é o ID do grupo — usar senderPhoneClean para identificar quem responde
  const responderKey = isGroup ? senderPhoneClean : (fromMe ? lucasPhoneClean : rawPhone.replace(/\D/g, ""));
  const stateKey = "financeiro/bot_state/" + (responderKey || lucasPhoneClean || "lucas");

  // ── Texto: SIM/NÃO/edição para confirmar o lançamento pendente ──────────
  if (hasText) {
    const rawMsg = (body.text?.message || "").trim();
    const msgNorm = rawMsg.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

    // ── Passo 1.5: aguardando descrição manual da despesa ──────────────────
    const stateSnapDesc = await db.ref(stateKey).once("value");
    const stateDesc = stateSnapDesc.val();
    if (stateDesc?.awaitingDescription && stateDesc?.pendingKey) {
      const descInput = rawMsg.trim();
      if (!descInput) {
        await enviarMensagemWhatsapp(replyPhone, "📝 Não entendi. Escreva a descrição da despesa:");
        return res.status(200).send("ok");
      }
      await db.ref("financeiro/saidas/" + stateDesc.pendingKey).update({ descricao: descInput });
      const updState = { awaitingDescription: false };
      await db.ref(stateKey).update(updState);
      if (stateDesc.linkedKey) await db.ref(stateDesc.linkedKey).update(updState);
      const entrySnap2 = await db.ref("financeiro/saidas/" + stateDesc.pendingKey).once("value");
      const entry2 = entrySnap2.val() || {};
      const dataBR2 = (entry2.data || "").split("-").reverse().join("/");
      const confirmMsg2 =
        `✅ *Descrição salva!*\n\n` +
        `📅 Data: ${dataBR2}\n` +
        `🏪 Fornecedor: ${entry2.fornecedor || "-"}\n` +
        `💵 Valor: ${fmtBRL(entry2.valor)}\n` +
        `🏷️ Categoria: ${entry2.categoria || "-"}\n` +
        `📝 Desc: ${entry2.descricao}\n\n` +
        `Confirma o lançamento? Responda *SIM* ou *NÃO*\n` +
        `_(ou edite: FORNECEDOR, CATEGORIA, VALOR, DATA)_`;
      await enviarMensagemWhatsapp(replyPhone, confirmMsg2);
      return res.status(200).send("ok");
    }

    const isSim = ["SIM", "S", "CONFIRMAR", "CONFIRMA", "YES", "Y", "OK"].includes(msgNorm);
    const isNao = ["NAO", "N", "CANCELAR", "NEGAR", "NO", "DESCARTAR"].includes(msgNorm);

    // Comandos de edição: FORNECEDOR <valor>, CATEGORIA <valor>, VALOR <numero>, DATA <dd/mm/yyyy>
    // Aceita com ou sem dois-pontos: "CATEGORIA Pro labore" ou "CATEGORIA: Pro labore" ou "Categoria : Pro labore"
    const editMatch = rawMsg.match(/^(FORNECEDOR|CATEGORIA|VALOR|DATA)\s*:?\s*(.+)$/i);

    if (isSim || isNao || editMatch) {
      const stateSnap = await db.ref(stateKey).once("value");
      const state = stateSnap.val();
      if (!state?.pendingKey) {
        await enviarMensagemWhatsapp(replyPhone, "ℹ️ Não há nenhuma despesa aguardando confirmação.");
        return res.status(200).send("ok");
      }

      // Helper: limpa o estado de ambos os aprovadores (remetente + Lucas)
      const clearBothStates = async () => {
        await db.ref(stateKey).remove();
        if (state.linkedKey) await db.ref(state.linkedKey).remove();
      };

      if (isSim) {
        if (state.importIds?.length) {
          // Confirmação em lote (extrato PDF)
          const updates = {};
          state.importIds.forEach(id => { updates[`financeiro/saidas/${id}/status`] = "confirmado"; });
          await db.ref().update(updates);
          await clearBothStates();
          await enviarMensagemWhatsapp(replyPhone, `✅ ${state.importIds.length} lançamento(s) importado(s) para o Financeiro!`);
        } else if (state.pendingKey) {
          await db.ref("financeiro/saidas/" + state.pendingKey).update({ status: "confirmado" });
          await clearBothStates();
          await enviarMensagemWhatsapp(replyPhone, "✅ Despesa confirmada e lançada no Financeiro!");
        }
        return res.status(200).send("ok");
      }

      if (isNao) {
        if (state.importIds?.length) {
          const updates = {};
          state.importIds.forEach(id => { updates[`financeiro/saidas/${id}/status`] = "descartado"; });
          await db.ref().update(updates);
          await clearBothStates();
          await enviarMensagemWhatsapp(replyPhone, "🗑️ Importação descartada.");
        } else if (state.pendingKey) {
          await db.ref("financeiro/saidas/" + state.pendingKey).update({ status: "descartado" });
          await clearBothStates();
          await enviarMensagemWhatsapp(replyPhone, "🗑️ Lançamento descartado.");
        }
        return res.status(200).send("ok");
      }

      // Edição de campo
      if (editMatch) {
        const campo = editMatch[1].toUpperCase();
        const novoValor = editMatch[2].trim();
        const update = {};
        let campoLabel = "";

        if (campo === "FORNECEDOR") {
          update.fornecedor = novoValor;
          update.descricao = novoValor;
          campoLabel = "Fornecedor";
        } else if (campo === "CATEGORIA") {
          update.categoria = novoValor;
          campoLabel = "Categoria";
        } else if (campo === "VALOR") {
          const num = parseFloat(novoValor.replace(",", "."));
          if (isNaN(num)) {
            await enviarMensagemWhatsapp(replyPhone, "⚠️ Valor inválido. Use: VALOR 150,00");
            return res.status(200).send("ok");
          }
          update.valor = num;
          campoLabel = "Valor";
        } else if (campo === "DATA") {
          // aceita dd/mm/yyyy ou yyyy-mm-dd
          let iso = novoValor;
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(novoValor)) {
            const [d, m, y] = novoValor.split("/");
            iso = `${y}-${m}-${d}`;
          }
          update.data = iso;
          campoLabel = "Data";
        }

        await db.ref("financeiro/saidas/" + state.pendingKey).update(update);

        // Relê o registro atualizado e reenvia o resumo
        const entrySnap = await db.ref("financeiro/saidas/" + state.pendingKey).once("value");
        const entry = entrySnap.val() || {};
        const dataBR = (entry.data || "").split("-").reverse().join("/");
        const resumo =
          `✏️ *${campoLabel} atualizado!*\n\n` +
          `📅 Data: ${dataBR}\n` +
          `🏪 Fornecedor: ${entry.fornecedor || entry.descricao || "-"}\n` +
          `💵 Valor: ${fmtBRL(entry.valor)}\n` +
          `🏷️ Categoria: ${entry.categoria || "-"}\n\n` +
          `Confirma? *SIM* ou *NÃO*\n` +
          `_(ou edite: FORNECEDOR, CATEGORIA, VALOR, DATA)_`;
        await enviarMensagemWhatsapp(replyPhone, resumo);
        return res.status(200).send("ok");
      }
    }
    // Comando EXTRATO [mm/yyyy] — gera e envia o PDF do mês
    const extratoMatch = rawMsg.match(/^EXTRATO(?:\s+(\d{1,2})[\/\-](\d{4}))?$/i);
    if (extratoMatch) {
      const now = new Date();
      const mes = extratoMatch[1] ? parseInt(extratoMatch[1]) : (now.getMonth() + 1);
      const ano = extratoMatch[2] ? parseInt(extratoMatch[2]) : now.getFullYear();
      const meses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
      await enviarMensagemWhatsapp(replyPhone, `📊 Gerando extrato de ${meses[mes-1]} ${ano}...`);
      try {
        const pdfBase64 = await gerarExtratoPDF(mes, ano);
        const fileName = `extrato_${String(mes).padStart(2,"0")}_${ano}.pdf`;
        await enviarDocumentoWhatsapp(replyPhone, pdfBase64, fileName, `Extrato Financeiro — ${meses[mes-1]} ${ano}`);
      } catch (e) {
        console.error("gerarExtratoPDF error:", e);
        await enviarMensagemWhatsapp(replyPhone, "❌ Erro ao gerar o extrato: " + e.message);
      }
      return res.status(200).send("ok");
    }

    // Texto não reconhecido — ignora silenciosamente
    return res.status(200).send("ok");
  }

  // ── PDF Extrato: importar lançamentos em lote ─────────────────────────────
  if (isPDF) {
    // Somente aceita PDFs de OUTRAS pessoas enviados no grupo (nunca do próprio Lucas)
    if (!isOtherGroupMember) return res.status(200).send("ok");

    // Ack no grupo
    await enviarMensagemWhatsapp(body.phone,
      `📄 Extrato de *${senderName}* recebido! Processando...`
    );

    // O remetente aprova pelo número pessoal; Lucas também recebe notificação
    const mediaReplyPhone = toWhatsappPhone(senderPhone);
    const senderStateKey = "financeiro/bot_state/" + senderPhoneClean;
    const lucasStateKey  = "financeiro/bot_state/" + (lucasPhoneClean || "lucas");

    try {
      let pdfBase64 = null;
      if (body.document?.base64) {
        pdfBase64 = body.document.base64.replace(/^data:[^;]+;base64,/, "");
      } else {
        const docUrl = body.document?.documentUrl || body.document?.url || body.document?.link || "";
        if (!docUrl) {
          await enviarMensagemWhatsapp(mediaReplyPhone, "⚠️ Não consegui acessar o PDF. Tente reenviar.");
          return res.status(200).send("ok");
        }
        const docResp = await fetch(docUrl);
        if (!docResp.ok) throw new Error("Download do PDF falhou: " + docResp.status);
        pdfBase64 = Buffer.from(await docResp.arrayBuffer()).toString("base64");
      }

      await enviarMensagemWhatsapp(mediaReplyPhone, "📄 Lendo o extrato... pode levar alguns segundos.");

      const transacoes = await callClaudeExtrato(pdfBase64);

      if (!Array.isArray(transacoes) || transacoes.length === 0) {
        await enviarMensagemWhatsapp(mediaReplyPhone, "ℹ️ Não encontrei saídas/despesas neste extrato.");
        return res.status(200).send("ok");
      }

      const today = new Date().toISOString().split("T")[0];
      const importIds = [];
      for (const t of transacoes) {
        const entry = {
          data: t.data || today,
          valor: parseFloat(t.valor) || 0,
          descricao: t.descricao || "Importado do extrato",
          categoria: t.categoria || "Outros",
          fornecedor: t.descricao || "",
          origem: "extrato_pdf",
          status: "pendente",
          criadoPor: "Bot WhatsApp (extrato)",
          registradoPor: senderName,
          createdAt: Date.now()
        };
        const ref = await db.ref("financeiro/saidas").push(entry);
        importIds.push(ref.key);
      }

      // Salva estado para o REMETENTE (aprovador principal) e para Lucas (aprovador secundário)
      const baseState = { importIds, createdAt: Date.now() };
      await db.ref(senderStateKey).set({ ...baseState, phone: mediaReplyPhone, linkedKey: lucasStateKey });
      if (LUCAS_PHONE) {
        await db.ref(lucasStateKey).set({ ...baseState, phone: LUCAS_PHONE, linkedKey: senderStateKey });
      }

      const totalValor = transacoes.reduce((s, t) => s + (parseFloat(t.valor) || 0), 0);
      const fmtTotal = "R$ " + totalValor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      // Preview das primeiras 5
      const preview = transacoes.slice(0, 5).map(t => {
        const d = (t.data || today).split("-").reverse().join("/");
        const v = "R$ " + Number(t.valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
        return `• ${d} — ${t.descricao} (${v})`;
      }).join("\n");

      const msg =
        `📊 *Extrato lido com sucesso!*\n\n` +
        `🧾 ${transacoes.length} saídas encontradas\n` +
        `💸 Total: ${fmtTotal}\n\n` +
        `*Primeiros lançamentos:*\n${preview}` +
        (transacoes.length > 5 ? `\n... e mais ${transacoes.length - 5}` : "") +
        `\n\nConfirma a importação? Responda *SIM* ou *NÃO*`;

      // Manda confirmação para o remetente
      await enviarMensagemWhatsapp(mediaReplyPhone, msg);

      // Notifica Lucas para que ele também possa aprovar se quiser
      if (LUCAS_PHONE && lucasPhoneClean !== senderPhoneClean) {
        await enviarMensagemWhatsapp(LUCAS_PHONE,
          `📄 Extrato de *${senderName}* aguardando aprovação (${transacoes.length} lançamentos, total ${fmtTotal}).\nResponda *SIM* ou *NÃO* para confirmar.`
        );
      }
    } catch (e) {
      console.error("handleFinanceiroWpp extrato error:", e);
      await enviarMensagemWhatsapp(mediaReplyPhone || LUCAS_PHONE, "❌ Erro ao processar o extrato: " + e.message);
    }
    return res.status(200).send("ok");
  }

  // ── Imagem: processar comprovante ──────────────────────────────────────────
  if (!hasImage) return res.status(200).send("ok");

  // Somente aceita imagens de OUTRAS pessoas enviadas no grupo (nunca do próprio Lucas)
  if (!isOtherGroupMember) return res.status(200).send("ok");

  // Ack no grupo
  await enviarMensagemWhatsapp(body.phone,
    `📩 Comprovante de *${senderName}* recebido! Analisando...`
  );

  // O remetente aprova pelo número pessoal; Lucas também recebe notificação
  const mediaReplyPhone = toWhatsappPhone(senderPhone);
  const senderStateKey = "financeiro/bot_state/" + senderPhoneClean;
  const lucasStateKey  = "financeiro/bot_state/" + (lucasPhoneClean || "lucas");

  try {
    let imageBase64 = null;
    let mediaType = "image/jpeg";

    if (body.image?.base64) {
      imageBase64 = body.image.base64.replace(/^data:[^;]+;base64,/, "");
      mediaType = body.image?.mimeType || "image/jpeg";
    } else {
      const imgUrl = body.image?.imageUrl || body.image?.url || body.image?.link || "";
      if (!imgUrl) {
        await enviarMensagemWhatsapp(mediaReplyPhone, "⚠️ Não consegui acessar a imagem. Tente reenviar.");
        return res.status(200).send("ok");
      }
      const imgResp = await fetch(imgUrl);
      if (!imgResp.ok) throw new Error("Download da imagem falhou: " + imgResp.status);
      const buffer = await imgResp.arrayBuffer();
      imageBase64 = Buffer.from(buffer).toString("base64");
      mediaType = body.image?.mimeType || "image/jpeg";
    }

    await enviarMensagemWhatsapp(mediaReplyPhone, "🔍 Analisando comprovante...");

    const extracted = await callClaudeVision(imageBase64, mediaType);

    if (extracted.erro) {
      await enviarMensagemWhatsapp(mediaReplyPhone, "⚠️ Não identifiquei um comprovante nessa imagem.\nEnvie uma foto mais nítida do comprovante/nota fiscal.");
      return res.status(200).send("ok");
    }

    const today = new Date().toISOString().split("T")[0];
    const dataBR = (extracted.data || today).split("-").reverse().join("/");
    const newEntry = {
      data: extracted.data || today,
      valor: parseFloat(extracted.valor) || 0,
      descricao: "",  // será preenchida pelo remetente no próximo passo
      categoria: extracted.categoria || "Outros",
      fornecedor: extracted.fornecedor || "",
      origem: "whatsapp",
      status: "pendente",
      criadoPor: "Bot WhatsApp",
      registradoPor: senderName,
      createdAt: Date.now()
    };

    const newRef = await db.ref("financeiro/saidas").push(newEntry);

    // Salva estado — awaitingDescription: true para aguardar a descrição manual
    const baseState = { pendingKey: newRef.key, createdAt: Date.now(), awaitingDescription: true };
    await db.ref(senderStateKey).set({ ...baseState, phone: mediaReplyPhone, linkedKey: lucasStateKey });
    if (LUCAS_PHONE) {
      await db.ref(lucasStateKey).set({ ...baseState, phone: LUCAS_PHONE, linkedKey: senderStateKey });
    }

    const confirmMsg =
      `💰 *Comprovante identificado:*\n\n` +
      `📅 Data: ${dataBR}\n` +
      `🏪 Fornecedor: ${extracted.fornecedor || "-"}\n` +
      `💵 Valor: ${fmtBRL(newEntry.valor)}\n` +
      `🏷️ Categoria: ${newEntry.categoria}\n\n` +
      `📝 *Qual a descrição desta despesa?*\n_(Ex: "Taxa maquininha", "Compra de embalagens", "Pró-labore")_`;

    // Manda confirmação para o remetente (ele pode aprovar diretamente)
    await enviarMensagemWhatsapp(mediaReplyPhone, confirmMsg);

    // Notifica Lucas para que ele também possa aprovar
    if (LUCAS_PHONE && lucasPhoneClean !== senderPhoneClean) {
      await enviarMensagemWhatsapp(LUCAS_PHONE,
        `💰 *Despesa de ${senderName}:*\n\n` +
        `📅 ${dataBR} · 🏪 ${extracted.fornecedor || "-"} · 💵 ${fmtBRL(newEntry.valor)}\n\n` +
        `Responda *SIM* ou *NÃO* para confirmar.`
      );
    }
  } catch (e) {
    console.error("handleFinanceiroWpp error:", e);
    await enviarMensagemWhatsapp(mediaReplyPhone || LUCAS_PHONE, "❌ Erro ao processar o comprovante: " + e.message);
  }

  return res.status(200).send("ok");
}

async function handleLembretes(req, res) {
  if (!checaSecret(req)) {
    return res.status(401).send("Unauthorized");
  }

  const snap = await db.ref("kanban").once("value");
  const data = snap.val() || {};
  const agora = Date.now();
  const enviados = [];

  for (const [key, entry] of Object.entries(data)) {
    if (!entry || entry.status !== "reuniao" || !entry.meetingISO) continue;

    const diffMin = (new Date(entry.meetingISO).getTime() - agora) / 60000;
    const lembretes = entry.lembretes || {};
    const updates = {};

    if (diffMin <= 120 && diffMin > 0 && !lembretes.h2) {
      await enviarMensagemWhatsapp(entry.telefone, mensagemLembrete2h(entry.nome));
      updates.h2 = true;
      enviados.push(key + ":2h");
    }
    if (diffMin <= 60 && diffMin > 0 && !lembretes.h1) {
      await enviarMensagemWhatsapp(entry.telefone, mensagemLembrete1h(entry.nome));
      updates.h1 = true;
      enviados.push(key + ":1h");
    }
    if (diffMin <= 10 && diffMin > 0 && !lembretes.m10) {
      await enviarMensagemWhatsapp(entry.telefone, mensagemLembrete10min(entry.nome));
      updates.m10 = true;
      enviados.push(key + ":10min");
    }

    if (Object.keys(updates).length > 0) {
      await db.ref("kanban/" + key + "/lembretes").update(updates);
    }
  }

  console.log("Lembretes enviados:", JSON.stringify(enviados));
  return res.status(200).json({ ok: true, enviados });
}

// ===== Roteamento principal =====
// ===== Rota /retorno: avisa o lead que foi agendado um retorno com data e hora =====
async function handleRetorno(req, res) {
  if (!checaSecret(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const body = req.body || {};
  const telefone = pick(body, ["telefone", "tel", "phone"]);
  const nome = pick(body, ["nome", "name"]);
  const retornoDisplay = pick(body, ["retornoDisplay", "display", "data"]);
  if (!telefone || !nome || !retornoDisplay) {
    return res.status(400).json({ ok: false, error: "telefone, nome e retornoDisplay sao obrigatorios" });
  }
  await enviarMensagemWhatsapp(telefone, mensagemRetorno(nome, retornoDisplay));
  return res.json({ ok: true });
}

// ===== Rota /cockpit-venda: proxy server-side p/ enviar a venda ao sistema externo =====
// O navegador (CRM) chama esta rota (mesmo CORS do /agendar) e o servidor repassa
// o POST ao sistema, evitando erro de CORS/mixed-content ("Failed to fetch").
async function handleCockpitProxy(req, res) {
  if (req.method !== "POST") { res.set("Allow", "POST"); return res.status(405).send("Method Not Allowed"); }
  if (!checaSecret(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  var body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  var url = body.url, secret = body.secret, payload = body.payload || {};
  if (!url) return res.status(400).json({ ok: false, error: "url_obrigatoria" });
  try {
    var headers = { "Content-Type": "application/json" };
    if (secret) headers["Authorization"] = "Bearer " + secret;
    var r = await fetch(url, { method: "POST", headers: headers, body: JSON.stringify(payload) });
    var txt = ""; try { txt = await r.text(); } catch (e) {}
    return res.status(200).json({ ok: (r.ok || r.status === 201), status: r.status, body: txt });
  } catch (e) {
    return res.status(200).json({ ok: false, status: 0, error: String((e && e.message) || e) });
  }
}

const CAD_TEMPLATES = {"d1_manha": {"day": 1, "period": "manha", "version": 2, "cond": false, "intake": true, "text": "Oi, {{primeiroNome}}! Tudo bem? 👋\n\nAqui é o João, da Audens 🙂 Vi seu cadastro agora.\n\nEu sou o responsável por fazer esse primeiro contato e tentar conseguir um horário seu com o {{especialistaNome}}, que é um dos nossos especialistas.\n\nQueria entender rapidinho seu momento.\n\nHoje você consegue falar por alguns minutos?", "media": []}, "d1_tarde": {"day": 1, "period": "tarde", "version": 2, "cond": true, "intake": false, "text": "Oi, {{primeiroNome}}! João aqui de novo 👊\n\nDei uma olhada no seu cadastro e, pelo seu momento, quero tentar te colocar para conversar direto com o {{especialistaNome}}.\n\nEle também é dono de operação de delivery e vive isso na prática 🍔\n\nPara você costuma ser melhor falar de manhã ou à tarde?", "media": []}, "d2_manha": {"day": 2, "period": "manha", "version": 2, "cond": false, "intake": false, "text": "Bom dia, {{primeiroNome}}! ☀️\n\nUma pergunta rápida antes de eu olhar a agenda do {{especialistaNome}}:\n\nHoje, qual é o principal ponto que você gostaria de melhorar no seu delivery? 📈\n\nPode me responder bem resumido mesmo.", "media": []}, "d2_tarde": {"day": 2, "period": "tarde", "version": 2, "cond": true, "intake": false, "text": "Oi, {{primeiroNome}}!\n\nTe perguntei porque aqui na Audens quem conversa com você não é alguém que conhece delivery só na teoria.\n\nO {{especialistaNome}} também vive operação no dia a dia 🔥\n\nSe fizer sentido, eu consigo olhar alguns horários na agenda dele para vocês conversarem.\n\nQuer que eu veja? 📅", "media": [{"url": "https://audenscompany.github.io/comercial/assets/faturamento-anterior.jpeg", "caption": ""}, {"url": "https://audenscompany.github.io/comercial/assets/faturamento-atual.jpeg", "caption": "Resultado real de um cliente com um delivery parecido com o seu 🚀 Hoje vende mais de 140 mil/mês com o Método Audens. É esse tipo de virada que o {{especialistaNome}} pode te ajudar a construir."}]}, "d3_manha": {"day": 3, "period": "manha", "version": 2, "cond": false, "intake": false, "text": "Bom dia, {{primeiroNome}}! ☀️\n\nEstou organizando alguns horários com o {{especialistaNome}} e lembrei do seu cadastro.\n\nSe eu conseguir encaixar vocês, qual período seria mais tranquilo para você?\n\nManhã ou tarde? 🕐", "media": []}, "d3_tarde": {"day": 3, "period": "tarde", "version": 2, "cond": true, "intake": false, "text": "Oi, {{primeiroNome}}!\n\nSó para te dar um pouco mais de contexto: a Audens foi criada por gente que também é dona de delivery 🍔\n\nO Lucas e o Gustavo têm operação própria e vivem na prática os desafios de gestão e crescimento desse mercado.\n\nPor isso achei válido tentar colocar você para falar com o {{especialistaNome}}.\n\nQuer que eu procure um horário? 📅", "media": []}, "d4_manha": {"day": 4, "period": "manha", "version": 2, "cond": false, "intake": false, "text": "Bom dia, {{primeiroNome}}! ☀️\n\nQueria só entender uma coisa para eu não ficar te chamando sem necessidade 🙏\n\nVocê ainda quer conversar sobre como melhorar os resultados do seu delivery?\n\nSe sim, eu vejo um horário com o {{especialistaNome}} para você.", "media": []}, "d4_tarde": {"day": 4, "period": "tarde", "version": 2, "cond": true, "intake": false, "text": "Oi, {{primeiroNome}}!\n\nPra facilitar, já olhei a agenda do {{especialistaNome}} e separei alguns horários pra vocês conversarem 👇\n\n{{horarios}}\n\nMe responde qual fica melhor pra você que eu já confirmo com ele 👍", "media": []}, "d5_manha": {"day": 5, "period": "manha", "version": 2, "cond": false, "intake": false, "text": "Bom dia, {{primeiroNome}}! ☀️\n\nEstou fechando meus acompanhamentos e seu contato ainda ficou aqui comigo.\n\nAntes de encerrar, queria tentar uma última vez te colocar para conversar com o {{especialistaNome}}.\n\nSe ainda fizer sentido para você, me responde \"sim\" que eu já olho a agenda dele 👍", "media": []}, "d5_tarde": {"day": 5, "period": "tarde", "version": 2, "cond": false, "intake": false, "text": "Oi, {{primeiroNome}}!\n\nVou encerrar meus contatos por aqui para não ficar insistindo com você 🙂\n\nSe quiser conversar com o {{especialistaNome}} depois, pode responder essa mensagem que eu mesmo vejo um horário para vocês.\n\nAbraço,\nJoão 👊", "media": []}};

// ===================== CADÊNCIA AUTOMÁTICA (Fase 1) =====================
// Nasce DESLIGADA. Ativar em: config/cadencia { enabled:true, testPhone:"55...", intervalSeconds:300 }
// testPhone preenchido = TODAS as mensagens vão para esse número (modo teste).
const CAD_SENDER_ID = "audens_joao";
const CAD_COLUNAS_OK = { "": 1, "novo": 1, "qualificado": 1 };            // só manda nessas colunas
const CAD_TERMINAL = { meeting_scheduled: 1, left_columns: 1, opt_out: 1, not_interested: 1, cadence_stopped: 1, cadence_completed: 1 };
const CAD_NS_TERMINAL = { meeting_scheduled: 1, opt_out: 1, ns_completed: 1, ns_stopped: 1, virou_venda: 1, reuniao_recente: 1 };
const CAD_REAT_TERMINAL = { left_columns: 1, meeting_scheduled: 1, opt_out: 1, reat_completed: 1, reat_stopped: 1 };
const CAD_REAT_ORDER = ["reat_1", "reat_2", "reat_3", "reat_4"];
const CAD_REAT_TEMPLATES = {"reat_1": {"idx": 0, "media": [], "text": "Oi, {{primeiroNome}}! Aqui é o João, da Audens 🙂\n\nFaz um tempo que você se cadastrou pra falar com a gente sobre o seu delivery e acabamos não conseguindo conversar.\n\nIsso ainda é uma prioridade pra você? Se sim, eu remarco um horário com o {{especialistaNome}} 👍"}, "reat_2": {"idx": 1, "media": [], "text": "Oi, {{primeiroNome}}! João aqui de novo 👋\n\nSei que a rotina do delivery é uma correria 🍔\n\nSe você ainda quer entender como a gente pode te ajudar a vender mais, é só responder que eu já olho um horário com o {{especialistaNome}}."}, "reat_3": {"idx": 2, "media": [{"url": "https://audenscompany.github.io/comercial/assets/faturamento-anterior.jpeg", "caption": ""}, {"url": "https://audenscompany.github.io/comercial/assets/faturamento-atual.jpeg", "caption": "Resultado real de um delivery parecido com o seu 🚀 É esse tipo de virada que o {{especialistaNome}} pode te ajudar a construir."}], "text": "Oi, {{primeiroNome}}!\n\nDeixa eu te mostrar rapidinho por que ainda vale a conversa 👇"}, "reat_4": {"idx": 3, "media": [], "text": "Oi, {{primeiroNome}}!\n\nVou encerrar meu contato por aqui pra não ficar te incomodando 🙂\n\nQuando quiser falar sobre o seu delivery, é só responder essa mensagem que eu te retorno.\n\nAbraço,\nJoão 👊"}};
const CAD_NS_TEMPLATES = {"ns_d1_manha": {"day": 1, "period": "manha", "version": 1, "cond": false, "media": [], "text": "Oi, {{primeiroNome}}! Aqui é o João, da Audens 🙂\n\nA gente tinha um horário marcado com o {{especialistaNome}} e acho que não rolou pra você — sem problema nenhum, acontece! 🙌\n\nQuer que eu remarque? Me diz um dia e horário que fica bom pra você que eu já cuido."}, "ns_d1_tarde": {"day": 1, "period": "tarde", "version": 1, "cond": true, "media": [], "text": "Oi, {{primeiroNome}}! João de novo 👊\n\nSei bem como a correria da operação atropela a agenda 🍔\n\nSe quiser, eu já procuro um novo horário com o {{especialistaNome}}. Bora remarcar?"}, "ns_d2_manha": {"day": 2, "period": "manha", "version": 1, "cond": false, "media": [], "text": "Bom dia, {{primeiroNome}}! ☀️\n\nNão quero te perder de vista 🙂\n\nO {{especialistaNome}} separou um tempo pra entender o seu delivery. Ainda faz sentido pra você essa conversa?"}, "ns_d2_tarde": {"day": 2, "period": "tarde", "version": 1, "cond": true, "media": [], "text": "Oi, {{primeiroNome}}! Pra facilitar, já dei uma olhada na agenda do {{especialistaNome}} 👇\n\n{{horarios}}\n\nMe responde qual encaixa melhor que eu confirmo com ele na hora 👍"}, "ns_d3_manha": {"day": 3, "period": "manha", "version": 1, "cond": false, "media": [], "text": "Bom dia, {{primeiroNome}}! ☀️\n\nSó pra você ter contexto: o {{especialistaNome}} também é dono de delivery e vive a operação na prática 🔥\n\nPor isso vale muito a conversa. Quer que eu ache um horário pra remarcar?"}, "ns_d3_tarde": {"day": 3, "period": "tarde", "version": 1, "cond": true, "media": [{"url": "https://audenscompany.github.io/comercial/assets/faturamento-anterior.jpeg", "caption": ""}, {"url": "https://audenscompany.github.io/comercial/assets/faturamento-atual.jpeg", "caption": "Olha o tipo de virada que a gente constrói com um delivery parecido com o seu 🚀 Hoje passa de 140 mil/mês com o Método Audens. É sobre isso que o {{especialistaNome}} quer te ajudar."}], "text": "Oi, {{primeiroNome}}!\n\nDeixa eu te mostrar rapidinho por que vale remarcar 👇"}, "ns_d4_manha": {"day": 4, "period": "manha", "version": 1, "cond": false, "media": [], "text": "Bom dia, {{primeiroNome}}! ☀️\n\nNão quero ficar te chamando à toa 🙏\n\nVocê ainda quer conversar sobre melhorar os resultados do seu delivery? Se sim, eu remarco com o {{especialistaNome}} agora mesmo."}, "ns_d4_tarde": {"day": 4, "period": "tarde", "version": 1, "cond": true, "media": [], "text": "Oi, {{primeiroNome}}!\n\nSe for questão de horário, isso eu resolvo 😉\n\nJá separei umas opções na agenda do {{especialistaNome}} 👇\n\n{{horarios}}\n\nÉ só me dizer qual fica melhor."}, "ns_d5_manha": {"day": 5, "period": "manha", "version": 1, "cond": false, "media": [], "text": "Bom dia, {{primeiroNome}}! ☀️\n\nEstou encerrando meus recontatos e o seu ficou aqui comigo.\n\nÚltima tentativa: quer que eu remarque com o {{especialistaNome}}? Responde \"sim\" que eu já cuido 👍"}, "ns_d5_tarde": {"day": 5, "period": "tarde", "version": 1, "cond": false, "media": [], "text": "Oi, {{primeiroNome}}!\n\nVou encerrar por aqui pra não ficar insistindo 🙂\n\nQuando quiser conversar com o {{especialistaNome}}, é só responder essa mensagem que eu remarco na hora.\n\nAbraço,\nJoão 👊"}};

async function cadCfg() {
  try {
    var v = (await db.ref("config/cadencia").once("value")).val() || {};
    return {
      enabled: v.enabled === true,
      testPhone: (v.testPhone || "").toString().replace(/\D/g, ""),
      intervalSeconds: parseInt(v.intervalSeconds) || 300,
      slotStartHour: parseInt(v.slotStartHour) || 9,
      slotEndHour: parseInt(v.slotEndHour) || 18,
      slotDays: parseInt(v.slotDays) || 6
    };
  } catch (e) { return { enabled: false, testPhone: "", intervalSeconds: 300, slotStartHour: 9, slotEndHour: 18, slotDays: 6 }; }
}
function cadDiaNome(dateStr) {
  var dias = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  var dow = new Date(dateStr + "T12:00:00Z").getUTCDay();
  return dias[dow];
}
// Calcula horários livres do especialista a partir das reuniões do PRÓPRIO CRM (nó meetings)
async function cadCrmSlotsData(especialista, maxN) {
  var out = [];
  try {
    var cfg = await cadCfg();
    var startH = cfg.slotStartHour, endH = cfg.slotEndHour, days = cfg.slotDays;
    var esp = String(especialista || "").trim().toLowerCase();
    var mts = (await db.ref("meetings").once("value")).val() || {};
    var occupied = {};
    Object.keys(mts).forEach(function (k) {
      var m = mts[k]; if (!m || !m.dtISO) return;
      var st = String(m.status || "").toLowerCase();
      if (st === "cancelado" || st === "reagendado" || st === "noshow") return;
      var resp = String(m.responsavel || "").trim().toLowerCase();
      if (esp && resp && resp.indexOf(esp) < 0 && esp.indexOf(resp) < 0) return;
      var b = cadBRT(m.dtISO);
      occupied[b.date + " " + b.hour] = true;
    });
    var now = Date.now();
    var minTs = now + 2 * 3600000;
    for (var dd = 0; dd < days + 3 && out.length < (maxN || 3); dd++) {
      var b = cadBRT(now + dd * 86400000);
      if (b.dow === 0) continue;
      for (var h = startH; h <= endH && out.length < (maxN || 3); h++) {
        if (occupied[b.date + " " + h]) continue;
        var slotIso = b.date + "T" + String(h).padStart(2, "0") + ":00:00-03:00";
        if (new Date(slotIso).getTime() < minTs) continue;
        out.push({ iso: slotIso, hour: h, date: b.date, label: cadDiaNome(b.date) + " " + b.date.slice(8, 10) + "/" + b.date.slice(5, 7) + " às " + h + "h" });
      }
    }
  } catch (e) { console.error("cadCrmSlotsData:", e); }
  return out;
}
async function cadCrmSlots(especialista, maxN) {
  var d = await cadCrmSlotsData(especialista, maxN);
  return d.map(function (x) { return "• " + x.label; }).join("\n");
}
function cadParseFat(str) {
  var s = String(str || "").toLowerCase().replace(/\s/g, "");
  var m = s.match(/[\d.,]+/g); if (!m) return null;
  var n = parseFloat(m[0].replace(/\./g, "").replace(",", ".")); if (isNaN(n)) return null;
  if (s.indexOf("mil") >= 0 && n < 1000) n = n * 1000;
  if (s.indexOf("milh") >= 0) n = n * 1000000;
  // faixas tipo "50-100" (mil): usa o piso da faixa
  if (/^\d+-\d+$/.test((str||"").toString().trim())) { var a=parseInt((str+"").split("-")[0]); n=a*1000; }
  return n;
}
function cadResolveEsp(fat) {
  var v = cadParseFat(fat);
  if (v == null || isNaN(v) || v <= 0) return { nome: null, motivo: "faturamento_invalido" };
  if (v >= 50000) return { nome: "Lucas", motivo: "faturamento_gte_50k" };
  return { nome: "Gustavo", motivo: "faturamento_lt_50k" };
}
function cadBRT(ts) {
  var s = new Date(ts).toLocaleString("en-CA", { timeZone: "America/Sao_Paulo", hour12: false, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
  var m = s.match(/(\d{4})-(\d{2})-(\d{2})[,\s]+(\d{2}):(\d{2})/);
  if (!m) { var d=new Date(ts); return { date: d.toISOString().slice(0,10), hour: d.getHours(), dow: d.getDay() }; }
  var dateStr = m[1] + "-" + m[2] + "-" + m[3];
  var dow = new Date(dateStr + "T12:00:00Z").getUTCDay();
  return { date: dateStr, hour: parseInt(m[4]), dow: dow };
}
function cadAddDaysStr(dateStr, days) {
  var d = new Date(dateStr + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function cadDaysBetween(a, b) {
  return Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 86400000);
}
function cadStartDate(nowTs) {
  var b = cadBRT(nowTs);
  // Se entrou até 12:59 BRT, começa hoje; senão, começa amanhã (para o build das 9h pegar o d1)
  return b.hour < 13 ? b.date : cadAddDaysStr(b.date, 1);
}
function cadPrimeiroNome(n) { return String(n || "").trim().split(/\s+/)[0] || ""; }
function cadRender(tplText, lead) {
  var vars = {
    primeiroNome: cadPrimeiroNome(lead.nome),
    especialistaNome: lead.especialistaNome || "",
    empresa: lead.empresa || "",
    linkAgendamento: lead.linkAgendamento || ""
  };
  vars.horarios = (lead._horarios != null ? lead._horarios : "");
  var required = { primeiroNome: 1, especialistaNome: 1, horarios: 1 };
  var out = String(tplText).replace(/\{\{\s*(\w+)\s*\}\}/g, function (_m, k) {
    var val = vars[k];
    if (val != null && String(val).trim() !== "") return val;
    if (required[k]) return _m; // obrigatória vazia -> vira "faltando"
    return ""; // opcional vazia
  });
  var missing = (out.match(/\{\{\s*\w+\s*\}\}/g) || []);
  return { text: out, missing: missing };
}
function cadMask(p) { p = String(p || ""); return p.length > 4 ? "****" + p.slice(-4) : "****"; }

// Lê o template do Firebase (editável no CRM) com fallback para o hardcode
async function cadGetTemplate(id) {
  try {
    var v = (await db.ref("config/cadencia_templates/" + id).once("value")).val();
    if (v && v.text) {
      var base = CAD_TEMPLATES[id] || {};
      return { text: v.text, version: v.version || 1, cond: (typeof v.cond === "boolean" ? v.cond : base.cond), intake: base.intake, media: (v.media || base.media || []) };
    }
  } catch (e) {}
  return CAD_TEMPLATES[id] || null;
}
// ROTA /cadencia-test-send — envia UM template para UM número (teste manual pelo CRM)
async function handleCadenciaTest(req, res) {
  if (!checaSecret(req)) return res.status(401).send("Unauthorized");
  var b = req.body || {};
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  var id = b.templateId, phone = String(b.phone || "").replace(/\D/g, "");
  if (!id || phone.length < 10) return res.status(400).json({ ok: false, error: "templateId e phone (com DDD) obrigatorios" });
  var tpl = await cadGetTemplate(id);
  if (!tpl) return res.status(404).json({ ok: false, error: "template nao encontrado: " + id });
  var lead = { nome: b.nome || "Fulano", especialistaNome: b.especialista || "Lucas", empresa: b.empresa || "" };
  if (String(tpl.text).indexOf("{{horarios}}") >= 0) { try { lead._horarios = await cadCrmSlots(lead.especialistaNome, 3); } catch (e) { lead._horarios = ""; } }
  var r = cadRender(tpl.text, lead);
  if (r.missing.length) return res.status(200).json({ ok: false, error: "variavel nao resolvida: " + r.missing.join(", "), preview: r.text });
  try {
    await enviarMensagemWhatsapp(phone, "[TESTE] " + r.text);
    if (tpl.media && tpl.media.length) { for (var mi = 0; mi < tpl.media.length; mi++) { var md = tpl.media[mi]; if (!md || !md.url) continue; var cap = cadRender(md.caption || "", lead).text; try { await enviarImagemWhatsapp(phone, md.url, cap); } catch (e) {} } }
    return res.status(200).json({ ok: true, preview: r.text, media: (tpl.media || []).length });
  }
  catch (e) { return res.status(200).json({ ok: false, error: String((e && e.message) || e) }); }
}

// ===== FASE 2: resposta do lead pausa a cadência (+ opt-out automático) =====
async function cadHandleInbound(phone, text) {
  var tel = String(phone || "").replace(/\D/g, "");
  if (!tel) return;
  var m = await acharKeyLead(tel, "", "");
  if (!m) return;
  var leadKey = m.key;
  var lead = (await db.ref("leads/" + leadKey).once("value")).val();
  if (!lead) return;
  var cadStatus = (lead.cadencia && lead.cadencia.status) || "";
  await db.ref("leads/" + leadKey).update({ "whatsapp/lastInboundAt": Date.now(), "whatsapp/humanConversationActive": true });
  var norm = String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, " ");
  var isOptOut = /(para de (me )?(mandar|chamar|enviar)|nao (me )?(mande|manda|chame|chama|envie|envia)( mais)?|nao quero (mais )?(receber|mensagem|mensagens|contato)|remov(er|a) (meu|o) (contato|numero)|descadastr|sair da lista|me tira( da lista)?|opt ?out|^\s*stop\s*$|pare de me)/.test(norm);
  if (isOptOut) {
    await db.ref("whatsapp_optout/" + leadKey).set({ optOut: true, at: Date.now(), reason: "user_request" });
    if (typeof cadStop === "function") await cadStop(leadKey, "opt_out");
    try { await cadNsStop(leadKey, "opt_out"); } catch (e) {}
    try { await cadReatStop(leadKey, "opt_out"); } catch (e) {}
    try { await db.ref("leads/" + leadKey + "/agendamento").remove(); } catch (e) {}
    await db.ref("cadencia_events").push({ type: "opt_out", leadKey: leadKey, at: Date.now() });
    return;
  }
  // NÃO pausa a cadência: ela continua durante os 5 dias mesmo que o lead responda (só para ao sair de Novo/Qualificado, no opt-out ou ao agendar reunião)
  // AGENDAMENTO CONVERSACIONAL: se há horários oferecidos, tenta entender e marcar
  var ag = lead.agendamento;
  if (ag && (ag.status === "options_sent" || ag.status === "awaiting_confirm")) {
    try {
      var handled = await cadTentarAgendar(leadKey, lead, ag, text, tel);
      if (handled) return; // resolvido automaticamente — não passa pro João
    } catch (e) { console.error("cadTentarAgendar:", e); }
  }
  // não deu pra resolver sozinho → passa pro João
  try { await db.ref("leads/" + leadKey).update({ needsHumanAttention: true }); } catch (e) {}
  try {
    await db.ref("sdr_tarefas/" + leadKey + "_resposta").set({ leadKey: leadKey, nome: lead.nome || "", telefone: lead.telefone || tel, empresa: lead.empresa || "", faturamento: lead.faturamento || "", tipo: "⚡ Lead respondeu — assumir", icon: "ti-message-2", dia: 0, periodo: "manha", dataISO: new Date().toISOString().slice(0, 10), done: false, doneAt: null, createdAt: Date.now() });
  } catch (e) {}
  await db.ref("cadencia_events").push({ type: "lead_replied", leadKey: leadKey, cadStatus: cadStatus, at: Date.now() });
}
// ROTA /wa-inbound — webhook de mensagem recebida (Z-API). Pausa a cadência quando o lead responde.
async function handleWaInbound(req, res) {
  try {
    var body = req.body || {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    if (body.fromMe === true) return res.status(200).send("ok");
    var isGroup = body.isGroup === true || String(body.phone || "").includes("@g.us") || String(body.phone || "").endsWith("-group");
    if (isGroup) return res.status(200).send("ok");
    var phone = String(body.phone || body.sender || "").replace(/\D/g, "");
    var text = (body.text && body.text.message) || body.message || "";
    await cadHandleInbound(phone, text);
  } catch (e) { console.error("wa-inbound:", e); }
  return res.status(200).send("ok");
}

// Inicia a cadência no intake (marca d1_manha como já enviado pela msg de primeiro contato do intake)
async function cadStart(leadKey, lead) {
  try {
    var cfg = null; // não bloqueia por enabled aqui: sempre grava o ESTADO; o envio é que respeita enabled
    var esp = cadResolveEsp(lead.faturamento);
    var startedAt = cadStartDate(Date.now());
    var patch = {
      especialistaNome: esp.nome, especialistaMotivo: esp.motivo,
      cadencia: { status: esp.nome ? "active" : "paused", startedAt: startedAt, paused: !esp.nome, stopReason: null, completedAt: null, createdAt: Date.now() },
      whatsapp: { optOut: false, lastInboundAt: null, lastOutboundAt: null, humanConversationActive: false },
      needsHumanAttention: !esp.nome
    };
    await db.ref("leads/" + leadKey).update(patch);
    if (esp.nome) {
      await db.ref("cadencia_ativos/" + leadKey).set({ startedAt: startedAt, especialista: esp.nome, at: Date.now() });
      // d1_manha = a mensagem de primeiro contato do intake; marca como enviada p/ não duplicar
      await db.ref("cadencia_msg/" + leadKey + "/d1_manha").set({ status: "sent", via: "intake", sentAt: Date.now(), templateId: "d1_manha" });
    }
  } catch (e) { console.error("cadStart:", e); }
}

function cadTouchFor(cad, period, todayDate) {
  if (!cad || cad.status !== "active" || !cad.startedAt) return null;
  var day = cadDaysBetween(cad.startedAt, todayDate) + 1;
  if (day < 1 || day > 5) return null;
  var id = "d" + day + "_" + period;
  var tpl = CAD_TEMPLATES[id];
  if (!tpl || tpl.intake) return null; // d1_manha é do intake
  return { templateId: id, day: day, period: period, cond: !!tpl.cond, version: tpl.version };
}

// Valida um candidato para um período. Carrega lead+kanban+optout.
async function cadValidate(leadKey, period, todayDate, fromDrain) {
  var lead = (await db.ref("leads/" + leadKey).once("value")).val();
  if (!lead) return { eligible: false, reason: "lead_not_found" };
  var tel = String(lead.telefone || "").replace(/\D/g, "");
  if (tel.length < 10) return { eligible: false, reason: "invalid_phone", lead: lead };
  var kb = (await db.ref("kanban/" + leadKey).once("value")).val() || {};
  if (!CAD_COLUNAS_OK[kb.status || ""]) return { eligible: false, reason: (kb.status === "reuniao" ? "meeting_scheduled" : "left_columns"), lead: lead };
  var opt = (await db.ref("whatsapp_optout/" + leadKey).once("value")).val();
  if (opt && opt.optOut) return { eligible: false, reason: "opt_out", lead: lead };
  if (lead.cadencia && (lead.cadencia.status === "stopped" || lead.cadencia.status === "completed")) return { eligible: false, reason: "cadence_" + lead.cadencia.status, lead: lead };
  var touch = cadTouchFor(lead.cadencia, period, todayDate);
  if (!touch) return { eligible: false, reason: "outside_cadence", lead: lead };
  // condicional: se respondeu desde o começo do dia, pula
  if (touch.cond && lead.whatsapp && lead.whatsapp.lastInboundAt) return { eligible: false, reason: "skipped_conditional", lead: lead };
  var already = (await db.ref("cadencia_msg/" + leadKey + "/" + touch.templateId).once("value")).val();
  if (already && already.status === "sent") return { eligible: false, reason: "already_sent", lead: lead };
  if (!fromDrain && already && (already.status === "queued" || already.status === "processing")) return { eligible: false, reason: "already_" + already.status, lead: lead };
  if (!lead.especialistaNome) return { eligible: false, reason: "missing_variable", lead: lead };
  return { eligible: true, reason: "eligible", lead: lead, touch: touch };
}

// Reserva de slot (transação) — garante 5 min entre disparos do mesmo número
async function cadReserveSlot(intervalSeconds) {
  var ref = db.ref("whatsapp_senders/" + CAD_SENDER_ID);
  var out = 0;
  await ref.transaction(function (sender) {
    sender = sender || { nextAvailableAt: 0, minimumIntervalSeconds: intervalSeconds };
    var now = Date.now();
    var scheduledAt = Math.max(now, sender.nextAvailableAt || 0);
    sender.nextAvailableAt = scheduledAt + (intervalSeconds * 1000);
    sender.lastReservedAt = scheduledAt;
    out = scheduledAt;
    return sender;
  });
  return out;
}

// ROTA /cadencia-build?secret=...&period=manha|tarde
async function handleCadenciaBuild(req, res) {
  if (!checaSecret(req)) return res.status(401).send("Unauthorized");
  var period = (req.query.period || "").toLowerCase();
  if (period !== "manha" && period !== "tarde") return res.status(400).json({ ok: false, error: "period deve ser manha|tarde" });
  var cfg = await cadCfg();
  var today = cadBRT(Date.now()).date;
  var dow = cadBRT(Date.now()).dow;
  var out = { period: period, today: today, enabled: cfg.enabled, totals: { candidates: 0, eligible: 0, queued: 0 }, skips: {} };
  if (!cfg.enabled) { out.note = "cadencia DESLIGADA (config/cadencia/enabled=false)"; return res.status(200).json(out); }
  if (dow === 0) { out.note = "domingo: sem envio"; return res.status(200).json(out); }
  var ativos = (await db.ref("cadencia_ativos").once("value")).val() || {};
  var keys = Object.keys(ativos);
  out.totals.candidates = keys.length;
  var batchId = "b_" + period + "_" + today.replace(/-/g, "") + "_" + Date.now();
  for (var i = 0; i < keys.length; i++) {
    var leadKey = keys[i];
    var v = await cadValidate(leadKey, period, today);
    if (!v.eligible) { out.skips[v.reason] = (out.skips[v.reason] || 0) + 1; if (CAD_TERMINAL[v.reason]) { try { await cadStop(leadKey, v.reason); } catch (e) {} } continue; }
    out.totals.eligible++;
    // enfileira idempotente
    var itemRef = db.ref("cadencia_fila/" + leadKey + "_" + v.touch.templateId);
    var created = false;
    await itemRef.transaction(function (cur) {
      if (cur) return; // já existe: aborta
      created = true;
      return { leadKey: leadKey, templateId: v.touch.templateId, day: v.touch.day, period: period,
               cond: v.touch.cond, version: v.touch.version, status: "queued", batchId: batchId,
               scheduledAt: 0, createdAt: Date.now() };
    });
    if (!created) { out.skips["already_queued"] = (out.skips["already_queued"] || 0) + 1; continue; }
    var scheduledAt = await cadReserveSlot(cfg.intervalSeconds);
    await itemRef.update({ scheduledAt: scheduledAt });
    await db.ref("cadencia_msg/" + leadKey + "/" + v.touch.templateId).update({ status: "queued", templateId: v.touch.templateId, templateVersion: v.touch.version, scheduledAt: scheduledAt, batchId: batchId });
    out.totals.queued++;
  }
  await db.ref("cadencia_batches/" + batchId).set({ period: period, date: today, createdAt: Date.now(), totals: out.totals, skips: out.skips });
  try { out.noshow = await cadNsBuild(period, cfg, today, dow); } catch (e) { console.error("cadNsBuild:", e); }
  return res.status(200).json(out);
}

// ROTA /cadencia-drain?secret=...
async function handleCadenciaDrain(req, res) {
  if (!checaSecret(req)) return res.status(401).send("Unauthorized");
  var cfg = await cadCfg();
  var out = { enabled: cfg.enabled, processed: 0, sent: 0, cancelled: 0, failed: 0, testPhone: cfg.testPhone ? cadMask(cfg.testPhone) : "" };
  if (!cfg.enabled) { out.note = "cadencia DESLIGADA"; return res.status(200).json(out); }
  var sender = (await db.ref("whatsapp_senders/" + CAD_SENDER_ID).once("value")).val() || {};
  if (sender.pausedUntil && sender.pausedUntil > Date.now()) { out.note = "sender pausado"; return res.status(200).json(out); }
  var fila = (await db.ref("cadencia_fila").once("value")).val() || {};
  var now = Date.now();
  var today = cadBRT(now).date;
  var ids = Object.keys(fila).filter(function (id) { var it = fila[id]; return it && it.status === "queued" && it.scheduledAt && it.scheduledAt <= now; });
  ids.sort(function (a, b) { return (fila[a].scheduledAt || 0) - (fila[b].scheduledAt || 0); });
  ids = ids.slice(0, 15); // no máx. 15 por rodada (worker roda a cada 1 min)
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i]; var itemRef = db.ref("cadencia_fila/" + id);
    // lock queued -> processing
    var locked = false;
    await itemRef.transaction(function (cur) { if (!cur || cur.status !== "queued") return cur; cur.status = "processing"; cur.processingAt = Date.now(); locked = true; return cur; });
    if (!locked) continue;
    out.processed++;
    var item = (await itemRef.once("value")).val();
    var leadKey = item.leadKey;
    // revalida
    var v = await cadValidate(leadKey, item.period, today, true);
    var msgRef = db.ref("cadencia_msg/" + leadKey + "/" + item.templateId);
    if (!v.eligible) {
      await itemRef.update({ status: "cancelled_before_send", cancelReason: v.reason, cancelledAt: Date.now() });
      await msgRef.update({ status: "cancelled_before_send", reason: v.reason });
      if (CAD_TERMINAL[v.reason]) { try { await cadStop(leadKey, v.reason); } catch (e) {} }
      out.cancelled++; continue;
    }
    var tpl = await cadGetTemplate(item.templateId);
    if (!tpl) { await itemRef.update({ status: "failed", reason: "template_missing" }); out.failed++; continue; }
    var lead = v.lead;
    var _opc = null;
    if (String(tpl.text).indexOf("{{horarios}}") >= 0) { try { var _sd = await cadCrmSlotsData(lead.especialistaNome, 3); lead._horarios = _sd.map(function (x) { return "• " + x.label; }).join("\n"); _opc = _sd; } catch (e) { lead._horarios = ""; } }
    if (_opc && _opc.length && !cfg.testPhone) { try { await db.ref("leads/" + leadKey + "/agendamento").set({ status: "options_sent", opcoes: _opc, sentAt: Date.now(), especialista: lead.especialistaNome || "", templateId: item.templateId }); } catch (e) {} }
    var r = cadRender(tpl.text, lead);
    if (r.missing.length) {
      await itemRef.update({ status: "blocked", reason: "missing_template_variable" });
      await msgRef.update({ status: "blocked", reason: "missing_template_variable" });
      out.failed++; continue;
    }
    var leadPhone = String(lead.telefone || "").replace(/\D/g, "");
    var targetPhone = cfg.testPhone ? cfg.testPhone : leadPhone;
    var body = cfg.testPhone ? ("[TESTE cadência → lead " + cadMask(leadPhone) + " · " + item.templateId + "]\n\n" + r.text) : r.text;
    try {
      await enviarMensagemWhatsapp(targetPhone, body);
      if (tpl.media && tpl.media.length) { for (var mi = 0; mi < tpl.media.length; mi++) { var md = tpl.media[mi]; if (!md || !md.url) continue; var cap = cadRender(md.caption || "", lead).text; try { await enviarImagemWhatsapp(targetPhone, md.url, cap); } catch (e) {} } }
      await itemRef.update({ status: "sent", sentAt: Date.now() });
      await msgRef.update({ status: "sent", sentAt: Date.now(), zapiTo: cadMask(targetPhone) });
      await db.ref("leads/" + leadKey + "/whatsapp/lastOutboundAt").set(Date.now());
      await db.ref("cadencia_events").push({ type: "message_sent", leadKey: cadMask(leadPhone), templateId: item.templateId, specialist: lead.especialistaNome || "", at: Date.now() });
      out.sent++;
    } catch (e) {
      var att = (item.attemptCount || 0) + 1;
      if (att >= 3) { await itemRef.update({ status: "failed", attemptCount: att, lastError: String(e && e.message || e) }); await msgRef.update({ status: "failed" }); out.failed++; }
      else { await itemRef.update({ status: "queued", attemptCount: att, lastError: String(e && e.message || e), scheduledAt: Date.now() + 5 * 60000 }); }
    }
  }
  try { out.noshow = await cadNsDrain(cfg, today); } catch (e) { console.error("cadNsDrain:", e); }
  try { out.reativacao = await cadReatDrain(cfg, today); } catch (e) { console.error("cadReatDrain:", e); }
  return res.status(200).json(out);
}

// Para a cadência de um lead (idempotente) — usado ao agendar reunião / opt-out
async function cadStop(leadKey, reason) {
  try {
    var ref = db.ref("leads/" + leadKey + "/cadencia");
    await ref.transaction(function (c) {
      if (c && (c.status === "stopped" || c.status === "completed")) return c;
      c = c || {}; c.status = "stopped"; c.stopReason = reason; c.completedAt = Date.now(); return c;
    });
    await db.ref("cadencia_ativos/" + leadKey).remove();
    // cancela itens de fila ainda não enviados
    var fila = (await db.ref("cadencia_fila").once("value")).val() || {};
    var updates = {};
    Object.keys(fila).forEach(function (id) { var it = fila[id]; if (it && it.leadKey === leadKey && (it.status === "queued")) { updates["cadencia_fila/" + id + "/status"] = "cancelled"; updates["cadencia_fila/" + id + "/cancelReason"] = reason; } });
    if (Object.keys(updates).length) await db.ref().update(updates);
    await db.ref("cadencia_events").push({ type: reason === "meeting_scheduled" ? "meeting_scheduled" : "cadence_stopped", leadKey: leadKey, reason: reason, at: Date.now() });
  } catch (e) { console.error("cadStop:", e); }
}


// ===================== CADÊNCIA DE NO-SHOW (recontato pós-falta) =====================
async function cadNsGetTemplate(id) {
  var base = CAD_NS_TEMPLATES[id]; if (!base) return null;
  var ov = null; try { ov = (await db.ref("config/cadencia_ns_templates/" + id).once("value")).val(); } catch (e) {}
  return { text: (ov && ov.text) || base.text, version: (ov && ov.version) || base.version || 1, cond: (ov && typeof ov.cond === "boolean") ? ov.cond : !!base.cond, media: (ov && ov.media) || base.media || [] };
}
function cadNsTouchFor(cad, period, todayDate) {
  if (!cad || cad.status !== "active" || !cad.startedAt) return null;
  var day = cadDaysBetween(cad.startedAt, todayDate) + 1;
  if (day < 1 || day > 5) return null;
  var id = "ns_d" + day + "_" + period;
  var tpl = CAD_NS_TEMPLATES[id]; if (!tpl) return null;
  return { templateId: id, day: day, period: period, cond: !!tpl.cond, version: tpl.version || 1 };
}
async function cadNsReengajou(leadKey, lead, nsStartedAt) {
  var tel = String(lead.telefone || "").replace(/\D/g, "").slice(-9);
  var startTs = 0; try { startTs = new Date(nsStartedAt + "T00:00:00-03:00").getTime(); } catch (e) {}
  // 1) já virou venda (followup com resultado venda)
  try {
    var fus = (await db.ref("followups").once("value")).val() || {};
    var venda = Object.keys(fus).some(function (k) {
      var fu = fus[k]; if (!fu || fu.resultado !== "venda") return false;
      var ft = String(fu.tel || "").replace(/\D/g, "").slice(-9);
      return ft && ft === tel;
    });
    if (venda) return "virou_venda";
  } catch (e) {}
  // 2) marcou/fez reunião nova depois do no-show
  try {
    var mts = (await db.ref("meetings").once("value")).val() || {};
    var reeng = Object.keys(mts).some(function (k) {
      var m = mts[k]; if (!m) return false;
      var st = String(m.status || "").toLowerCase();
      if (st !== "pending" && st !== "done") return false;
      var mt = String(m.tel || "").replace(/\D/g, "").slice(-9);
      var sameLead = (m.kanbanKey && m.kanbanKey === leadKey) || (mt && mt === tel);
      if (!sameLead) return false;
      var when = m.scheduledAt || (m.dtISO ? new Date(m.dtISO).getTime() : 0);
      return when && when >= startTs;
    });
    if (reeng) return "reuniao_recente";
  } catch (e) {}
  return null;
}
async function cadNsValidate(leadKey, period, todayDate, fromDrain) {
  var lead = (await db.ref("leads/" + leadKey).once("value")).val();
  if (!lead) return { eligible: false, reason: "lead_not_found" };
  var tel = String(lead.telefone || "").replace(/\D/g, "");
  if (tel.length < 10) return { eligible: false, reason: "invalid_phone", lead: lead };
  var opt = (await db.ref("whatsapp_optout/" + leadKey).once("value")).val();
  if (opt && opt.optOut) return { eligible: false, reason: "opt_out", lead: lead };
  var cad = lead.cadenciaNoshow;
  if (!cad) return { eligible: false, reason: "ns_not_active", lead: lead };
  if (cad.status === "stopped" || cad.status === "completed") return { eligible: false, reason: "ns_" + cad.status, lead: lead };
  var day = cad.startedAt ? (cadDaysBetween(cad.startedAt, todayDate) + 1) : 0;
  if (day > 5) return { eligible: false, reason: "ns_completed", lead: lead };
  var _reeng = await cadNsReengajou(leadKey, lead, cad.startedAt);
  if (_reeng) return { eligible: false, reason: _reeng, lead: lead };
  var touch = cadNsTouchFor(cad, period, todayDate);
  if (!touch) return { eligible: false, reason: "outside_cadence", lead: lead };
  if (touch.cond && lead.whatsapp && lead.whatsapp.lastInboundAt) return { eligible: false, reason: "skipped_conditional", lead: lead };
  var already = (await db.ref("cadencia_ns_msg/" + leadKey + "/" + touch.templateId).once("value")).val();
  if (already && already.status === "sent") return { eligible: false, reason: "already_sent", lead: lead };
  if (!fromDrain && already && (already.status === "queued" || already.status === "processing")) return { eligible: false, reason: "already_" + already.status, lead: lead };
  if (!lead.especialistaNome) return { eligible: false, reason: "missing_variable", lead: lead };
  return { eligible: true, reason: "eligible", lead: lead, touch: touch };
}
async function cadNsStop(leadKey, reason) {
  try {
    var st = (reason === "ns_completed") ? "completed" : "stopped";
    var ref = db.ref("leads/" + leadKey + "/cadenciaNoshow");
    await ref.transaction(function (c) { if (c && (c.status === "stopped" || c.status === "completed")) return c; c = c || {}; c.status = st; c.stopReason = reason; c.completedAt = Date.now(); return c; });
    await db.ref("cadencia_ns_ativos/" + leadKey).remove();
    var fila = (await db.ref("cadencia_ns_fila").once("value")).val() || {};
    var updates = {};
    Object.keys(fila).forEach(function (id) { var it = fila[id]; if (it && it.leadKey === leadKey && it.status === "queued") { updates["cadencia_ns_fila/" + id + "/status"] = "cancelled"; updates["cadencia_ns_fila/" + id + "/cancelReason"] = reason; } });
    if (Object.keys(updates).length) await db.ref().update(updates);
    await db.ref("cadencia_events").push({ type: reason === "meeting_scheduled" ? "meeting_scheduled" : "cadence_stopped", track: "noshow", leadKey: leadKey, reason: reason, at: Date.now() });
  } catch (e) { console.error("cadNsStop:", e); }
}
async function cadNsEnqueueOne(leadKey, cfg) {
  var b = cadBRT(Date.now());
  if (b.dow === 0) return;
  if (b.hour < (cfg.slotStartHour || 9) || b.hour > (cfg.slotEndHour || 18)) return; // fora do horário: o build agenda depois
  var period = (b.hour < 13) ? "manha" : "tarde";
  var v = await cadNsValidate(leadKey, period, b.date);
  if (!v.eligible) return;
  var itemRef = db.ref("cadencia_ns_fila/" + leadKey + "_" + v.touch.templateId);
  var created = false;
  await itemRef.transaction(function (cur) { if (cur) return; created = true; return { leadKey: leadKey, templateId: v.touch.templateId, day: v.touch.day, period: period, cond: v.touch.cond, version: v.touch.version, status: "queued", batchId: "immediate", scheduledAt: 0, createdAt: Date.now() }; });
  if (!created) return;
  var scheduledAt = await cadReserveSlot(cfg.intervalSeconds);
  await itemRef.update({ scheduledAt: scheduledAt });
  await db.ref("cadencia_ns_msg/" + leadKey + "/" + v.touch.templateId).update({ status: "queued", templateId: v.touch.templateId, scheduledAt: scheduledAt, batchId: "immediate" });
}
async function cadNsStart(leadKey, phone) {
  try {
    var lead = null;
    if (leadKey) { lead = (await db.ref("leads/" + leadKey).once("value")).val(); }
    if (!lead && phone) { var m = await acharKeyLead(String(phone).replace(/\D/g, ""), "", ""); if (m) { leadKey = m.key; lead = (await db.ref("leads/" + leadKey).once("value")).val(); } }
    if (!lead) return { ok: false, reason: "lead_not_found" };
    var opt = (await db.ref("whatsapp_optout/" + leadKey).once("value")).val();
    if (opt && opt.optOut) return { ok: false, reason: "opt_out" };
    if (lead.cadenciaNoshow && lead.cadenciaNoshow.status === "active") return { ok: true, already: true, leadKey: leadKey };
    var esp = lead.especialistaNome || cadResolveEsp(lead.faturamento).nome;
    var startedAt = cadStartDate(Date.now());
    var patch = { cadenciaNoshow: { status: esp ? "active" : "paused", startedAt: startedAt, paused: !esp, stopReason: null, completedAt: null, createdAt: Date.now() } };
    if (esp && !lead.especialistaNome) patch.especialistaNome = esp;
    if (!esp) patch.needsHumanAttention = true;
    await db.ref("leads/" + leadKey).update(patch);
    if (esp) {
      await db.ref("cadencia_ns_ativos/" + leadKey).set({ startedAt: startedAt, especialista: esp, at: Date.now() });
      await db.ref("cadencia_events").push({ type: "ns_started", track: "noshow", leadKey: leadKey, at: Date.now() });
      var cfg = await cadCfg();
      if (cfg.enabled) { try { await cadNsEnqueueOne(leadKey, cfg); } catch (e) {} }
    }
    return { ok: true, leadKey: leadKey, especialista: esp || null };
  } catch (e) { console.error("cadNsStart:", e); return { ok: false, reason: String(e && e.message || e) }; }
}
async function cadNsBuild(period, cfg, today, dow) {
  var out = { candidates: 0, eligible: 0, queued: 0, skips: {} };
  if (dow === 0) { out.note = "domingo"; return out; }
  var ativos = (await db.ref("cadencia_ns_ativos").once("value")).val() || {};
  var keys = Object.keys(ativos); out.candidates = keys.length;
  var batchId = "bns_" + period + "_" + today.replace(/-/g, "") + "_" + Date.now();
  for (var i = 0; i < keys.length; i++) {
    var leadKey = keys[i];
    var v = await cadNsValidate(leadKey, period, today);
    if (!v.eligible) { out.skips[v.reason] = (out.skips[v.reason] || 0) + 1; if (CAD_NS_TERMINAL[v.reason]) { try { await cadNsStop(leadKey, v.reason); } catch (e) {} } continue; }
    out.eligible++;
    var itemRef = db.ref("cadencia_ns_fila/" + leadKey + "_" + v.touch.templateId);
    var created = false;
    await itemRef.transaction(function (cur) { if (cur) return; created = true; return { leadKey: leadKey, templateId: v.touch.templateId, day: v.touch.day, period: period, cond: v.touch.cond, version: v.touch.version, status: "queued", batchId: batchId, scheduledAt: 0, createdAt: Date.now() }; });
    if (!created) { out.skips["already_queued"] = (out.skips["already_queued"] || 0) + 1; continue; }
    var scheduledAt = await cadReserveSlot(cfg.intervalSeconds);
    await itemRef.update({ scheduledAt: scheduledAt });
    await db.ref("cadencia_ns_msg/" + leadKey + "/" + v.touch.templateId).update({ status: "queued", templateId: v.touch.templateId, scheduledAt: scheduledAt, batchId: batchId });
    out.queued++;
  }
  await db.ref("cadencia_ns_batches/" + batchId).set({ period: period, date: today, createdAt: Date.now(), totals: out });
  return out;
}
async function cadNsDrain(cfg, today) {
  var out = { processed: 0, sent: 0, cancelled: 0, failed: 0 };
  var fila = (await db.ref("cadencia_ns_fila").once("value")).val() || {};
  var now = Date.now();
  var ids = Object.keys(fila).filter(function (id) { var it = fila[id]; return it && it.status === "queued" && it.scheduledAt && it.scheduledAt <= now; });
  ids.sort(function (a, b) { return (fila[a].scheduledAt || 0) - (fila[b].scheduledAt || 0); });
  ids = ids.slice(0, 15);
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i]; var itemRef = db.ref("cadencia_ns_fila/" + id);
    var locked = false;
    await itemRef.transaction(function (cur) { if (!cur || cur.status !== "queued") return cur; cur.status = "processing"; cur.processingAt = Date.now(); locked = true; return cur; });
    if (!locked) continue;
    out.processed++;
    var item = (await itemRef.once("value")).val();
    var leadKey = item.leadKey;
    var v = await cadNsValidate(leadKey, item.period, today, true);
    var msgRef = db.ref("cadencia_ns_msg/" + leadKey + "/" + item.templateId);
    if (!v.eligible) {
      await itemRef.update({ status: "cancelled_before_send", cancelReason: v.reason, cancelledAt: Date.now() });
      await msgRef.update({ status: "cancelled_before_send", reason: v.reason });
      if (CAD_NS_TERMINAL[v.reason]) { try { await cadNsStop(leadKey, v.reason); } catch (e) {} }
      out.cancelled++; continue;
    }
    var tpl = await cadNsGetTemplate(item.templateId);
    if (!tpl) { await itemRef.update({ status: "failed", reason: "template_missing" }); out.failed++; continue; }
    var lead = v.lead;
    var _opc = null;
    if (String(tpl.text).indexOf("{{horarios}}") >= 0) { try { var _sd = await cadCrmSlotsData(lead.especialistaNome, 3); lead._horarios = _sd.map(function (x) { return "• " + x.label; }).join("\n"); _opc = _sd; } catch (e) { lead._horarios = ""; } }
    if (_opc && _opc.length && !cfg.testPhone) { try { await db.ref("leads/" + leadKey + "/agendamento").set({ status: "options_sent", opcoes: _opc, sentAt: Date.now(), especialista: lead.especialistaNome || "", templateId: item.templateId }); } catch (e) {} }
    var r = cadRender(tpl.text, lead);
    if (r.missing.length) { await itemRef.update({ status: "blocked", reason: "missing_template_variable" }); await msgRef.update({ status: "blocked", reason: "missing_template_variable" }); out.failed++; continue; }
    var leadPhone = String(lead.telefone || "").replace(/\D/g, "");
    var targetPhone = cfg.testPhone ? cfg.testPhone : leadPhone;
    var body = cfg.testPhone ? ("[TESTE no-show → lead " + cadMask(leadPhone) + " · " + item.templateId + "]\n\n" + r.text) : r.text;
    try {
      await enviarMensagemWhatsapp(targetPhone, body);
      if (tpl.media && tpl.media.length) { for (var mi = 0; mi < tpl.media.length; mi++) { var md = tpl.media[mi]; if (!md || !md.url) continue; var cap = cadRender(md.caption || "", lead).text; try { await enviarImagemWhatsapp(targetPhone, md.url, cap); } catch (e) {} } }
      await itemRef.update({ status: "sent", sentAt: Date.now() });
      await msgRef.update({ status: "sent", sentAt: Date.now(), zapiTo: cadMask(targetPhone) });
      await db.ref("leads/" + leadKey + "/whatsapp/lastOutboundAt").set(Date.now());
      await db.ref("cadencia_events").push({ type: "message_sent", track: "noshow", leadKey: cadMask(leadPhone), templateId: item.templateId, specialist: lead.especialistaNome || "", at: Date.now() });
      out.sent++;
    } catch (e) {
      var att = (item.attemptCount || 0) + 1;
      if (att >= 3) { await itemRef.update({ status: "failed", attemptCount: att, lastError: String(e && e.message || e) }); await msgRef.update({ status: "failed" }); out.failed++; }
      else { await itemRef.update({ status: "queued", attemptCount: att, lastError: String(e && e.message || e), scheduledAt: Date.now() + 5 * 60000 }); }
    }
  }
  return out;
}
// ROTA /noshow-start?secret=...&lead=<key>&phone=<tel>
async function handleNoshowStart(req, res) {
  if (!checaSecret(req)) return res.status(401).send("Unauthorized");
  var leadKey = (req.query.lead || (req.body && req.body.lead) || "").toString();
  var phone = (req.query.phone || (req.body && req.body.phone) || "").toString();
  if (!leadKey && !phone) return res.status(400).json({ ok: false, error: "lead ou phone obrigatorio" });
  var r = await cadNsStart(leadKey, phone);
  return res.status(200).json(r);
}


// ===================== AGENDAMENTO CONVERSACIONAL (lead escolhe horário no WhatsApp) =====================
function cadPickOrdinal(t, n) {
  if (/\b(primeir|1a|1o|opcao 1|opcao1|numero 1|a 1)\b/.test(t)) return 1;
  if (/\b(segund|2a|2o|opcao 2|opcao2|numero 2|a 2)\b/.test(t)) return 2;
  if (n >= 3 && /\b(terceir|3a|3o|opcao 3|opcao3|numero 3|a 3)\b/.test(t)) return 3;
  return 0;
}
function cadPickByHour(t, opcoes) {
  var found = [];
  for (var i = 0; i < opcoes.length; i++) {
    var h = opcoes[i].hour;
    var re1 = new RegExp("(^|\\D)" + h + "\\s*h", "");
    var re2 = new RegExp("(as|às|as as)\\s*" + h + "(\\D|$)", "");
    if (re1.test(t) || re2.test(t)) found.push(i + 1);
  }
  return (found.length === 1) ? found[0] : 0;
}
async function cadClassifyAI(opcoes, status, texto) {
  var lista = opcoes.map(function (o, i) { return (i + 1) + ") " + o.label; }).join("\n");
  var prompt = "Você interpreta a resposta de um lead a uma oferta de horários para uma reunião.\n\nHorários oferecidos:\n" + lista + "\n\nEstado atual: " + (status === "awaiting_confirm" ? "aguardando o lead CONFIRMAR um horário já escolhido" : "aguardando o lead ESCOLHER um dos horários") + "\n\nMensagem do lead:\n\"" + String(texto || "") + "\"\n\nResponda em JSON puro, sem markdown, com uma destas formas:\n- {\"action\":\"pick\",\"index\":N}  quando o lead escolhe/prefere o horário N da lista\n- {\"action\":\"confirm\"}  quando o lead confirma/aceita (sim, pode, fechado...)\n- {\"action\":\"other\"}  quando pede outro horário, recusa, ou não é sobre escolher horário\n\nApenas o JSON.";
  var resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 60, messages: [{ role: "user", content: prompt }] })
  });
  if (!resp.ok) throw new Error("anthropic " + resp.status);
  var data = await resp.json();
  var txt = ((data.content && data.content[0] && data.content[0].text) || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  var j = JSON.parse(txt);
  if (j.action === "pick") j.index = parseInt(j.index, 10) || 0;
  return j;
}
async function cadInterpretarAgendamento(opcoes, status, texto) {
  var t = String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, " ");
  if (status === "awaiting_confirm") {
    if (/\b(sim|confirmo|confirmado|confirmar|pode|isso|fechad|fechou|perfeito|bora|ok|blz|beleza|combinado|vamos|quero|marca|marcar|certo|show)\b/.test(t) && !/\b(nao|nunca|outro|outra|nenhum|remarca)\b/.test(t)) return { action: "confirm" };
  }
  var po = cadPickOrdinal(t, opcoes.length); if (po) return { action: "pick", index: po };
  var ph = cadPickByHour(t, opcoes); if (ph) return { action: "pick", index: ph };
  if (ANTHROPIC_API_KEY) { try { return await cadClassifyAI(opcoes, status, texto); } catch (e) { console.error("cadClassifyAI:", e); } }
  return { action: "other" };
}
function cadSlotKey(responsavel, slot) {
  return String(responsavel || "esp").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24) + "_" + slot.date + "_" + slot.hour;
}
async function cadSlotLivre(responsavel, esp, slot) {
  try {
    var mts = (await db.ref("meetings").once("value")).val() || {};
    var respN = String(responsavel || "").trim().toLowerCase();
    var espN = String(esp || "").trim().toLowerCase();
    var keys = Object.keys(mts);
    for (var i = 0; i < keys.length; i++) {
      var m = mts[keys[i]]; if (!m || !m.dtISO) continue;
      var st = String(m.status || "").toLowerCase();
      if (st === "cancelado" || st === "reagendado" || st === "noshow") continue;
      var b = cadBRT(m.dtISO);
      if (b.date === slot.date && b.hour === slot.hour) {
        var r = String(m.responsavel || "").trim().toLowerCase();
        if (!r || !respN || r.indexOf(respN) >= 0 || respN.indexOf(r) >= 0 || (espN && (r.indexOf(espN) >= 0 || espN.indexOf(r) >= 0))) return false;
      }
    }
    return true;
  } catch (e) { return true; }
}
async function cadAgendarConversa(leadKey, lead, slot, target) {
  var cfg = await cadCfg();
  var kb = {}; try { kb = (await db.ref("kanban/" + leadKey).once("value")).val() || {}; } catch (e) {}
  var nome = lead.nome || kb.nome || "";
  var telFinal = String(lead.telefone || kb.telefone || "").replace(/\D/g, "");
  var faixa = lead.faixa || kb.faixa || "";
  var responsavel = kb.responsavel || closerPorFaixa(faixa) || lead.especialistaNome || "";
  var esp = lead.especialistaNome || responsavel;
  var to = cfg.testPhone ? cfg.testPhone : (target || telFinal);
  var pn = primeiroNomeDe(lead.nome || "");
  // TRAVA ANTI-DUPLICIDADE: horário ainda livre + reserva atômica por slot
  var lockRef = db.ref("slot_locks/" + cadSlotKey(responsavel, slot));
  var livre = await cadSlotLivre(responsavel, esp, slot);
  var got = false;
  if (livre) {
    await lockRef.transaction(function (cur) { if (cur && cur.leadKey && cur.leadKey !== leadKey) return cur; got = true; return { leadKey: leadKey, at: Date.now() }; });
  }
  if (!livre || !got) {
    var novos = await cadCrmSlotsData(esp, 2);
    if (novos.length) {
      await db.ref("leads/" + leadKey + "/agendamento").set({ status: "options_sent", opcoes: novos, sentAt: Date.now(), especialista: esp });
      if (to) await enviarMensagemWhatsapp(to, "Ihh" + (pn ? ", " + pn : "") + "! Esse horário acabou de ser preenchido 😬 Mas consigo estes aqui:\n\n" + novos.map(function (s) { return "• " + s.label; }).join("\n") + "\n\nQual fica melhor pra você?");
    } else {
      await db.ref("leads/" + leadKey).update({ needsHumanAttention: true });
      try { await db.ref("sdr_tarefas/" + leadKey + "_resposta").set({ leadKey: leadKey, nome: nome, telefone: telFinal, empresa: lead.empresa || "", faturamento: lead.faturamento || "", tipo: "⚡ Horário lotado — reagendar", icon: "ti-calendar-x", dia: 0, periodo: "manha", dataISO: new Date().toISOString().slice(0, 10), done: false, doneAt: null, createdAt: Date.now() }); } catch (e) {}
      if (to) await enviarMensagemWhatsapp(to, "Ihh" + (pn ? ", " + pn : "") + "! Esse horário acabou de ser preenchido 😬 Já te chamo com uma nova opção, tá?");
    }
    await db.ref("cadencia_events").push({ type: "slot_conflict", leadKey: leadKey, at: Date.now() });
    return;
  }
  var meetingISO = slot.iso;
  var meetingDisplay = formatBRT(slot.iso);
  var mid = "km_" + leadKey + "_" + Date.now();
  try { await lockRef.update({ meetingId: mid }); } catch (e) {}
  try {
    await db.ref("kanban/" + leadKey).update({ status: "reuniao", statusAt: Date.now(), meetingISO: meetingISO, meetingDisplay: meetingDisplay, responsavel: responsavel, meetingId: mid, lembretes: { h2: false, h1: false, m10: false }, _aguardandoWebhook: null });
  } catch (e) { console.error("cadAgendarConversa kanban:", e); }
  try {
    await db.ref("meetings/" + mid).set({ id: mid, tel: telFinal, nome: String(nome), dtISO: meetingISO, dtDisplay: meetingDisplay, status: "pending", responsavel: responsavel, guestEmail: lead.email || "", faturamentoLead: lead.faturamento || kb.faturamento || "", origem: "Tráfego", kanbanKey: leadKey, sdrName: "JOÃO", scheduledAt: Date.now(), _viaCadencia: true });
  } catch (e) { console.error("cadAgendarConversa meeting:", e); }
  try { await db.ref("leads/" + leadKey + "/agendamento").set({ status: "booked", meetingId: mid, iso: meetingISO, label: slot.label, bookedAt: Date.now() }); } catch (e) {}
  try { await db.ref("leads/" + leadKey).update({ needsHumanAttention: false }); } catch (e) {}
  try { await cadStop(leadKey, "meeting_scheduled"); } catch (e) {}
  try { await cadNsStop(leadKey, "meeting_scheduled"); } catch (e) {}
  await db.ref("cadencia_events").push({ type: "meeting_scheduled", track: "conversational", leadKey: leadKey, meetingId: mid, at: Date.now() });
  try {
    if (to) {
      await enviarMensagemWhatsapp(to, mensagemConfirmacaoParte1(nome));
      await enviarImagemWhatsapp(to, IMG_FATURAMENTO_ANTERIOR, "");
      await enviarImagemWhatsapp(to, IMG_FATURAMENTO_ATUAL, legendaFaturamentoAtual());
      if (meetingDisplay) await enviarMensagemWhatsapp(to, mensagemConfirmacaoParte2(meetingDisplay));
      await enviarMensagemWhatsapp(to, mensagemEscassez(nome, responsavel));
    }
  } catch (e) { console.error("cadAgendarConversa WA:", e); }
}
async function cadTentarAgendar(leadKey, lead, ag, texto, senderPhone) {
  var opcoes = ag.opcoes || [];
  if (!opcoes.length) return false;
  var esp = lead.especialistaNome || ag.especialista || "o especialista";
  var pn = primeiroNomeDe(lead.nome || "");
  var target = senderPhone;
  var interp = await cadInterpretarAgendamento(opcoes, ag.status, texto);
  if (ag.status === "options_sent") {
    if (interp.action === "pick" && interp.index >= 1 && interp.index <= opcoes.length) {
      var slot = opcoes[interp.index - 1];
      await db.ref("leads/" + leadKey + "/agendamento").update({ status: "awaiting_confirm", escolhido: slot, escolhidoAt: Date.now() });
      await enviarMensagemWhatsapp(target, "Show" + (pn ? ", " + pn : "") + "! 🙌 Fecho então com o " + esp + ":\n\n📅 *" + slot.label + "*\n\nConfirma que eu já marco? É só responder *sim* 👍");
      await db.ref("cadencia_events").push({ type: "agendamento_escolha", leadKey: leadKey, at: Date.now() });
      return true;
    }
    return false;
  }
  if (ag.status === "awaiting_confirm") {
    if (interp.action === "confirm") {
      var slotC = ag.escolhido; if (!slotC) return false;
      await cadAgendarConversa(leadKey, lead, slotC, target);
      return true;
    }
    if (interp.action === "pick" && interp.index >= 1 && interp.index <= opcoes.length) {
      var slot2 = opcoes[interp.index - 1];
      await db.ref("leads/" + leadKey + "/agendamento").update({ status: "awaiting_confirm", escolhido: slot2, escolhidoAt: Date.now() });
      await enviarMensagemWhatsapp(target, "Perfeito! Então fica *" + slot2.label + "*. Confirma? Responde *sim* que eu marco 👍");
      return true;
    }
    return false;
  }
  return false;
}
// ROTA /agendamento-sim?secret=...&phone=...&especialista=Lucas  (teste do fluxo conversacional)
async function handleAgendamentoSim(req, res) {
  if (!checaSecret(req)) return res.status(401).send("Unauthorized");
  var phone = String(req.query.phone || (req.body && req.body.phone) || "").replace(/\D/g, "");
  var esp = String(req.query.especialista || (req.body && req.body.especialista) || "Lucas");
  if (phone.length < 10) return res.status(400).json({ ok: false, error: "phone invalido" });
  var m = await acharKeyLead(phone, "", "");
  var leadKey;
  if (m) { leadKey = m.key; } else {
    leadKey = "teste_" + phone + "_" + Date.now();
    await db.ref("leads/" + leadKey).set({ nome: "Teste Agendamento", telefone: phone, especialistaNome: esp, faturamento: "acima de 50 mil", origem: "Teste", _teste: true, createdAt: Date.now() });
  }
  var lead = (await db.ref("leads/" + leadKey).once("value")).val() || {};
  var esp2 = lead.especialistaNome || esp;
  var slots = await cadCrmSlotsData(esp2, 2);
  if (!slots.length) return res.status(200).json({ ok: false, error: "sem horarios livres na agenda" });
  var pn = primeiroNomeDe(lead.nome || "");
  var msg = "Oi" + (pn ? " " + pn : "") + "! Pra facilitar, já olhei a agenda do " + esp2 + " 👇\n\n" + slots.map(function (s) { return "• " + s.label; }).join("\n") + "\n\nMe responde qual encaixa melhor que eu confirmo 👍";
  await enviarMensagemWhatsapp(phone, msg);
  await db.ref("leads/" + leadKey + "/agendamento").set({ status: "options_sent", opcoes: slots, sentAt: Date.now(), especialista: esp2, _teste: true });
  return res.status(200).json({ ok: true, leadKey: leadKey, opcoes: slots });
}

// ===================== BACKFILL: inscrever leads existentes na cadência =====================
async function cadEnroll(leadKey, lead, startedAt) {
  var esp = lead.especialistaNome || cadResolveEsp(lead.faturamento).nome;
  if (!esp) return false;
  var sa = startedAt || cadStartDate(Date.now());
  var patch = { especialistaNome: esp, needsHumanAttention: false, cadencia: { status: "active", startedAt: sa, paused: false, stopReason: null, completedAt: null, createdAt: Date.now(), viaBackfill: true } };
  if (lead.telefone) patch.telefone = lead.telefone;
  if (lead.nome) patch.nome = lead.nome;
  if (lead.empresa) patch.empresa = lead.empresa;
  if (lead.faturamento) patch.faturamento = lead.faturamento;
  await db.ref("leads/" + leadKey).update(patch);
  await db.ref("cadencia_ativos/" + leadKey).set({ startedAt: sa, especialista: esp, at: Date.now(), viaBackfill: true });
  await db.ref("cadencia_events").push({ type: "cadence_backfill", leadKey: leadKey, at: Date.now() });
  return true;
}
// ROTA /noshow-backfill?secret=...&dryrun=1|0&days=N  — recontata no-shows ja marcados
async function handleNoshowBackfill(req, res) {
  if (!checaSecret(req)) return res.status(401).send("Unauthorized");
  var dryrun = String((req.query.dryrun != null ? req.query.dryrun : "1")) !== "0";
  var days = parseInt(req.query.days || "31", 10) || 31;
  var minTs = Date.now() - days * 86400000;
  var meetings = (await db.ref("meetings").once("value")).val() || {};
  var followups = (await db.ref("followups").once("value")).val() || {};
  var optout = (await db.ref("whatsapp_optout").once("value")).val() || {};
  var leads = (await db.ref("leads").once("value")).val() || {};
  var vendaTels = {};
  Object.keys(followups).forEach(function (k) { var fu = followups[k]; if (fu && fu.resultado === "venda") { var t = String(fu.tel || "").replace(/\D/g, "").slice(-9); if (t) vendaTels[t] = 1; } });
  var meetsByTel = {}, noshowList = [];
  Object.keys(meetings).forEach(function (k) {
    var m = meetings[k]; if (!m || !m.dtISO) return;
    var t = String(m.tel || "").replace(/\D/g, "").slice(-9);
    var when = m.scheduledAt || new Date(m.dtISO).getTime();
    var st = String(m.status || "").toLowerCase();
    if (t) { if (!meetsByTel[t]) meetsByTel[t] = []; meetsByTel[t].push({ status: st, when: when }); }
    if (st === "noshow" && when >= minTs) noshowList.push({ m: m, tel: t, when: when });
  });
  var byTel = {};
  noshowList.forEach(function (ns) { if (!ns.tel) return; if (!byTel[ns.tel] || ns.when > byTel[ns.tel].when) byTel[ns.tel] = ns; });
  var elegiveis = [], skips = {};
  var leadKeys = Object.keys(leads);
  Object.keys(byTel).forEach(function (tel) {
    var ns = byTel[tel];
    var leadKey = ns.m.kanbanKey, lead = leadKey ? leads[leadKey] : null;
    if (!lead) { var fk = leadKeys.find(function (k) { var l = leads[k]; return l && String(l.telefone || "").replace(/\D/g, "").slice(-9) === tel; }); if (fk) { leadKey = fk; lead = leads[fk]; } }
    if (!leadKey || !lead) { skips.lead_nao_encontrado = (skips.lead_nao_encontrado || 0) + 1; return; }
    if (optout[leadKey]) { skips.opt_out = (skips.opt_out || 0) + 1; return; }
    if (lead.cadenciaNoshow && lead.cadenciaNoshow.status === "active") { skips.ja_ativo = (skips.ja_ativo || 0) + 1; return; }
    if (vendaTels[tel]) { skips.virou_venda = (skips.virou_venda || 0) + 1; return; }
    var reeng = (meetsByTel[tel] || []).some(function (x) { return (x.status === "pending" || x.status === "done") && x.when > ns.when; });
    if (reeng) { skips.reuniao_recente = (skips.reuniao_recente || 0) + 1; return; }
    var esp = lead.especialistaNome || cadResolveEsp(lead.faturamento).nome;
    if (!esp) { skips.sem_especialista = (skips.sem_especialista || 0) + 1; return; }
    elegiveis.push({ leadKey: leadKey, tel: tel, nome: lead.nome || ns.m.nome || "" });
  });
  var out = { dryrun: dryrun, total_elegiveis: elegiveis.length, skips: skips, amostra: elegiveis.slice(0, 20).map(function (e) { return { nome: e.nome }; }) };
  if (!dryrun) {
    var inscritos = 0;
    for (var i = 0; i < elegiveis.length; i++) { try { var r = await cadNsStart(elegiveis[i].leadKey, elegiveis[i].tel); if (r && r.ok && !r.already) inscritos++; } catch (e) {} }
    out.inscritos = inscritos;
  }
  return res.status(200).json(out);
}
async function handleCadenciaBackfill(req, res) {
  if (!checaSecret(req)) return res.status(401).send("Unauthorized");
  var dryrun = String((req.query.dryrun != null ? req.query.dryrun : "1")) !== "0";
  var days = parseInt(req.query.days || "0", 10) || 0;
  var limit = parseInt(req.query.limit || "300", 10) || 300;
  var leads = (await db.ref("leads").once("value")).val() || {};
  var kanban = (await db.ref("kanban").once("value")).val() || {};
  var optout = (await db.ref("whatsapp_optout").once("value")).val() || {};
  var minTs = days > 0 ? (Date.now() - days * 86400000) : 0;
  var elegiveis = [], skips = {};
  Object.keys(kanban).forEach(function (k) {
    var kb = kanban[k] || {};
    var stt = kb.status || "";
    if (!CAD_COLUNAS_OK[stt]) { skips.fora_das_colunas = (skips.fora_das_colunas || 0) + 1; return; }
    var l = leads[k] || {};
    var tel = String(l.telefone || kb.telefone || "").replace(/\D/g, "");
    if (tel.length < 10) { skips.invalid_phone = (skips.invalid_phone || 0) + 1; return; }
    if (optout[k]) { skips.opt_out = (skips.opt_out || 0) + 1; return; }
    var cad = l.cadencia;
    if (cad && cad.status === "active" && !cad.paused) { skips.ja_ativo = (skips.ja_ativo || 0) + 1; return; }
    if (cad && (cad.status === "stopped" || cad.status === "completed")) { skips.encerrado = (skips.encerrado || 0) + 1; return; }
    var fat = l.faturamento || kb.faturamento || "";
    var esp = cadResolveEsp(fat).nome;
    if (!esp) { skips.faturamento_invalido = (skips.faturamento_invalido || 0) + 1; return; }
    var entryTs = l._createdAt || kb.statusAt || kb.createdAt || 0;
    if (minTs && entryTs && entryTs < minTs) { skips.fora_da_janela = (skips.fora_da_janela || 0) + 1; return; }
    var startedAt = entryTs ? cadStartDate(entryTs) : cadStartDate(Date.now());
    elegiveis.push({ key: k, dados: { telefone: tel, nome: l.nome || kb.nome || "", empresa: l.empresa || kb.empresa || "", faturamento: fat, especialistaNome: esp }, startedAt: startedAt, nome: l.nome || kb.nome || "", especialista: esp });
  });
  var out = { dryrun: dryrun, total_elegiveis: elegiveis.length, skips: skips, amostra: elegiveis.slice(0, 20).map(function (e) { return { nome: e.nome, esp: e.especialista, inicio: e.startedAt }; }) };
  if (!dryrun) {
    var toEnroll = elegiveis.slice(0, limit);
    var inscritos = 0;
    for (var i = 0; i < toEnroll.length; i++) { try { if (await cadEnroll(toEnroll[i].key, toEnroll[i].dados, toEnroll[i].startedAt)) inscritos++; } catch (e) {} }
    out.inscritos = inscritos;
    out.restantes = Math.max(0, elegiveis.length - toEnroll.length);
  }
  return res.status(200).json(out);
}

// ===================== CADÊNCIA DE REATIVAÇÃO (base fria — 1 msg a cada 15 dias, a partir das 17h, teto/dia) =====================
async function cadReatCfg() {
  try {
    var v = (await db.ref("config/cadencia").once("value")).val() || {};
    return {
      enabled: v.reatEnabled === true,
      testPhone: (v.testPhone || "").toString().replace(/\D/g, ""),
      intervalSeconds: parseInt(v.intervalSeconds) || 300,
      maxPerDay: parseInt(v.reatMaxPerDay) || 15,
      startHour: parseInt(v.reatStartHour) || 17,
      intervalDays: parseInt(v.reatIntervalDays) || 15,
      minIdadeDias: parseInt(v.reatMinIdadeDias) || 30
    };
  } catch (e) { return { enabled: false, testPhone: "", intervalSeconds: 300, maxPerDay: 15, startHour: 17, intervalDays: 15, minIdadeDias: 30 }; }
}
async function cadReatGetTemplate(id) {
  var base = CAD_REAT_TEMPLATES[id]; if (!base) return null;
  var ov = null; try { ov = (await db.ref("config/cadencia_reat_templates/" + id).once("value")).val(); } catch (e) {}
  return { text: (ov && ov.text) || base.text, media: (ov && ov.media) || base.media || [] };
}
async function cadReatValidate(leadKey, intervalDays, fromDrain) {
  var lead = (await db.ref("leads/" + leadKey).once("value")).val();
  if (!lead) return { eligible: false, reason: "lead_not_found" };
  var tel = String(lead.telefone || "").replace(/\D/g, "");
  if (tel.length < 10) return { eligible: false, reason: "invalid_phone", lead: lead };
  var opt = (await db.ref("whatsapp_optout/" + leadKey).once("value")).val();
  if (opt && opt.optOut) return { eligible: false, reason: "opt_out", lead: lead };
  var cad = lead.cadenciaReativacao;
  if (!cad) return { eligible: false, reason: "reat_not_active", lead: lead };
  if (cad.status === "stopped" || cad.status === "completed") return { eligible: false, reason: "reat_" + cad.status, lead: lead };
  var kb = (await db.ref("kanban/" + leadKey).once("value")).val() || {};
  if (!CAD_COLUNAS_OK[kb.status || ""]) return { eligible: false, reason: (kb.status === "reuniao" ? "meeting_scheduled" : "left_columns"), lead: lead };
  if (!lead.especialistaNome) return { eligible: false, reason: "missing_variable", lead: lead };
  var idx = cad.touchIndex || 0;
  if (idx >= CAD_REAT_ORDER.length) return { eligible: false, reason: "reat_completed", lead: lead };
  var touchId = CAD_REAT_ORDER[idx];
  var lastAt = cad.lastTouchAt || 0;
  if (lastAt) { var dias = (Date.now() - lastAt) / 86400000; if (dias < (intervalDays || 15)) return { eligible: false, reason: "nao_venceu_15d", lead: lead }; }
  var already = (await db.ref("cadencia_reat_msg/" + leadKey + "/" + touchId).once("value")).val();
  if (already && already.status === "sent") return { eligible: false, reason: "already_sent", lead: lead };
  if (!fromDrain && already && (already.status === "queued" || already.status === "processing")) return { eligible: false, reason: "already_" + already.status, lead: lead };
  return { eligible: true, reason: "eligible", lead: lead, touch: { id: touchId, index: idx } };
}
async function cadReatStop(leadKey, reason) {
  try {
    var st = (reason === "reat_completed") ? "completed" : "stopped";
    var ref = db.ref("leads/" + leadKey + "/cadenciaReativacao");
    await ref.transaction(function (c) { if (c && (c.status === "stopped" || c.status === "completed")) return c; c = c || {}; c.status = st; c.stopReason = reason; c.completedAt = Date.now(); return c; });
    await db.ref("cadencia_reat_ativos/" + leadKey).remove();
    var fila = (await db.ref("cadencia_reat_fila").once("value")).val() || {};
    var updates = {};
    Object.keys(fila).forEach(function (id) { var it = fila[id]; if (it && it.leadKey === leadKey && it.status === "queued") { updates["cadencia_reat_fila/" + id + "/status"] = "cancelled"; updates["cadencia_reat_fila/" + id + "/cancelReason"] = reason; } });
    if (Object.keys(updates).length) await db.ref().update(updates);
    await db.ref("cadencia_events").push({ type: reason === "meeting_scheduled" ? "meeting_scheduled" : "cadence_stopped", track: "reativacao", leadKey: leadKey, reason: reason, at: Date.now() });
  } catch (e) { console.error("cadReatStop:", e); }
}
// inscreve automaticamente leads antigos (>= minIdadeDias) parados em Novo/Qualificado
async function cadReatAutoEnroll(cfg) {
  var cutoff = Date.now() - (cfg.minIdadeDias || 30) * 86400000;
  var leads = (await db.ref("leads").once("value")).val() || {};
  var kanban = (await db.ref("kanban").once("value")).val() || {};
  var optout = (await db.ref("whatsapp_optout").once("value")).val() || {};
  var count = 0;
  var keys = Object.keys(leads);
  for (var i = 0; i < keys.length && count < 500; i++) {
    var k = keys[i], l = leads[k]; if (!l) continue;
    if (l.cadenciaReativacao) continue;
    var idade = l._createdAt || (kanban[k] && kanban[k].statusAt) || 0;
    if (!idade || idade > cutoff) continue;
    var kb = kanban[k] || {}; if (!CAD_COLUNAS_OK[kb.status || ""]) continue;
    if (optout[k]) continue;
    var tel = String(l.telefone || kb.telefone || "").replace(/\D/g, ""); if (tel.length < 10) continue;
    var esp = l.especialistaNome || cadResolveEsp(l.faturamento || kb.faturamento).nome; if (!esp) continue;
    try {
      await db.ref("leads/" + k).update({ especialistaNome: esp, cadenciaReativacao: { status: "active", startedAt: cadStartDate(Date.now()), touchIndex: 0, lastTouchAt: 0, paused: false, stopReason: null, completedAt: null, createdAt: Date.now() } });
      await db.ref("cadencia_reat_ativos/" + k).set({ at: Date.now(), especialista: esp });
      await db.ref("cadencia_events").push({ type: "reat_started", track: "reativacao", leadKey: k, at: Date.now() });
      count++;
    } catch (e) {}
  }
  return count;
}
// ROTA /reativacao-build?secret=...  (chamar 1x/dia às 17h pelo Scheduler)
async function handleReativacaoBuild(req, res) {
  if (!checaSecret(req)) return res.status(401).send("Unauthorized");
  var cfg = await cadReatCfg();
  var b = cadBRT(Date.now());
  var out = { enabled: cfg.enabled, enrolled: 0, candidates: 0, eligible: 0, queued: 0, skips: {} };
  if (!cfg.enabled) { out.note = "reativacao DESLIGADA (config/cadencia/reatEnabled=false)"; return res.status(200).json(out); }
  if (b.dow === 0) { out.note = "domingo: sem envio"; return res.status(200).json(out); }
  try { out.enrolled = await cadReatAutoEnroll(cfg); } catch (e) { console.error("cadReatAutoEnroll:", e); }
  var today = b.date;
  var dailyRef = db.ref("cadencia_reat_daily/" + today);
  var sentToday = (await dailyRef.once("value")).val() || 0;
  var budget = Math.max(0, (cfg.maxPerDay || 15) - sentToday);
  if (budget <= 0) { out.note = "teto diário atingido (" + (cfg.maxPerDay || 15) + ")"; return res.status(200).json(out); }
  var floor = new Date(today + "T" + String(cfg.startHour || 17).padStart(2, "0") + ":00:00-03:00").getTime();
  var ativos = (await db.ref("cadencia_reat_ativos").once("value")).val() || {};
  var keys = Object.keys(ativos);
  out.candidates = keys.length;
  var n = 0;
  for (var i = 0; i < keys.length && n < budget; i++) {
    var leadKey = keys[i];
    var v = await cadReatValidate(leadKey, cfg.intervalDays);
    if (!v.eligible) { out.skips[v.reason] = (out.skips[v.reason] || 0) + 1; if (CAD_REAT_TERMINAL[v.reason]) { try { await cadReatStop(leadKey, v.reason); } catch (e) {} } continue; }
    out.eligible++;
    var itemRef = db.ref("cadencia_reat_fila/" + leadKey + "_" + v.touch.id);
    var created = false;
    await itemRef.transaction(function (cur) { if (cur) return; created = true; return { leadKey: leadKey, touchId: v.touch.id, touchIndex: v.touch.index, status: "queued", scheduledAt: 0, createdAt: Date.now() }; });
    if (!created) { out.skips.already_queued = (out.skips.already_queued || 0) + 1; continue; }
    var sa = await cadReserveSlot(cfg.intervalSeconds);
    if (sa < floor) sa = floor + n * (cfg.intervalSeconds) * 1000;
    await itemRef.update({ scheduledAt: sa });
    await db.ref("cadencia_reat_msg/" + leadKey + "/" + v.touch.id).update({ status: "queued", scheduledAt: sa });
    n++;
  }
  out.queued = n;
  await dailyRef.set(sentToday + n);
  return res.status(200).json(out);
}
async function cadReatDrain(cfg, today) {
  var out = { processed: 0, sent: 0, cancelled: 0, failed: 0 };
  var reatCfg = await cadReatCfg();
  var fila = (await db.ref("cadencia_reat_fila").once("value")).val() || {};
  var now = Date.now();
  var ids = Object.keys(fila).filter(function (id) { var it = fila[id]; return it && it.status === "queued" && it.scheduledAt && it.scheduledAt <= now; });
  ids.sort(function (a, b2) { return (fila[a].scheduledAt || 0) - (fila[b2].scheduledAt || 0); });
  ids = ids.slice(0, 15);
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i]; var itemRef = db.ref("cadencia_reat_fila/" + id);
    var locked = false;
    await itemRef.transaction(function (cur) { if (!cur || cur.status !== "queued") return cur; cur.status = "processing"; cur.processingAt = Date.now(); locked = true; return cur; });
    if (!locked) continue;
    out.processed++;
    var item = (await itemRef.once("value")).val();
    var leadKey = item.leadKey;
    var v = await cadReatValidate(leadKey, reatCfg.intervalDays, true);
    var msgRef = db.ref("cadencia_reat_msg/" + leadKey + "/" + item.touchId);
    if (!v.eligible) {
      await itemRef.update({ status: "cancelled_before_send", cancelReason: v.reason, cancelledAt: Date.now() });
      await msgRef.update({ status: "cancelled_before_send", reason: v.reason });
      if (CAD_REAT_TERMINAL[v.reason]) { try { await cadReatStop(leadKey, v.reason); } catch (e) {} }
      out.cancelled++; continue;
    }
    var tpl = await cadReatGetTemplate(item.touchId);
    if (!tpl) { await itemRef.update({ status: "failed", reason: "template_missing" }); out.failed++; continue; }
    var lead = v.lead;
    var r = cadRender(tpl.text, lead);
    if (r.missing.length) { await itemRef.update({ status: "blocked", reason: "missing_template_variable" }); await msgRef.update({ status: "blocked", reason: "missing_template_variable" }); out.failed++; continue; }
    var leadPhone = String(lead.telefone || "").replace(/\D/g, "");
    var targetPhone = reatCfg.testPhone ? reatCfg.testPhone : leadPhone;
    var body = reatCfg.testPhone ? ("[TESTE reativação → lead " + cadMask(leadPhone) + " · " + item.touchId + "]\n\n" + r.text) : r.text;
    try {
      await enviarMensagemWhatsapp(targetPhone, body);
      if (tpl.media && tpl.media.length) { for (var mi = 0; mi < tpl.media.length; mi++) { var md = tpl.media[mi]; if (!md || !md.url) continue; var cap = cadRender(md.caption || "", lead).text; try { await enviarImagemWhatsapp(targetPhone, md.url, cap); } catch (e) {} } }
      await itemRef.update({ status: "sent", sentAt: Date.now() });
      await msgRef.update({ status: "sent", sentAt: Date.now(), zapiTo: cadMask(targetPhone) });
      // avança o toque (próximo em +15 dias)
      var nextIdx = (item.touchIndex || 0) + 1;
      var patch = { "cadenciaReativacao/touchIndex": nextIdx, "cadenciaReativacao/lastTouchAt": Date.now() };
      await db.ref("leads/" + leadKey).update(patch);
      if (nextIdx >= CAD_REAT_ORDER.length) { try { await cadReatStop(leadKey, "reat_completed"); } catch (e) {} }
      await db.ref("leads/" + leadKey + "/whatsapp/lastOutboundAt").set(Date.now());
      await db.ref("cadencia_events").push({ type: "message_sent", track: "reativacao", leadKey: cadMask(leadPhone), templateId: item.touchId, at: Date.now() });
      out.sent++;
    } catch (e) {
      var att = (item.attemptCount || 0) + 1;
      if (att >= 3) { await itemRef.update({ status: "failed", attemptCount: att, lastError: String(e && e.message || e) }); await msgRef.update({ status: "failed" }); out.failed++; }
      else { await itemRef.update({ status: "queued", attemptCount: att, lastError: String(e && e.message || e), scheduledAt: Date.now() + 5 * 60000 }); }
    }
  }
  return out;
}

// ROTA /cadencia-stop?secret=...&lead=<key>&reason=<...>
async function handleCadenciaStop(req, res) {
  if (!checaSecret(req)) return res.status(401).send("Unauthorized");
  var leadKey = (req.query.lead || (req.body && req.body.lead) || "").toString();
  var reason = (req.query.reason || (req.body && req.body.reason) || "manual_stop").toString();
  if (!leadKey) return res.status(400).json({ ok: false, error: "lead obrigatório" });
  await cadStop(leadKey, reason);
  return res.status(200).json({ ok: true, lead: leadKey, reason: reason });
}
// =================== FIM CADÊNCIA AUTOMÁTICA ===================

http('receberLead', async (req, res) => {
  // CORS: o CRM (index.html) chama /agendar via fetch POST com
  // Content-Type: application/json, o que faz o navegador disparar um
  // preflight OPTIONS antes do POST. Sem esses headers o preflight volta
  // 405 e o navegador bloqueia o POST real (mensagens de confirmacao +
  // fotos nunca chegam).
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-Webhook-Secret");

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  try {
    const path = (req.path || "/").replace(/\/+$/, "") || "/";

    if (path === "/agendar") {
      return await handleAgendar(req, res);
    }
    if (path === "/quiz-agendou") {
      return await handleQuizAgendou(req, res);
    }
    if (path === "/calendly-webhook") {
      return await handleCalendlyWebhook(req, res);
    }
    if (path === "/setup-calendly-webhook") {
      return await handleSetupCalendlyWebhook(req, res);
    }
    if (path === "/backfill-calendly") {
      return await handleBackfillCalendly(req, res);
    }
    if (path === "/reagendar") {
      return await handleReagendar(req, res);
    }
    if (path === "/retorno") {
      return await handleRetorno(req, res);
    }
    if (path === "/assinatura") {
      return await handleEnviarAssinatura(req, res);
    }
    if (path === "/lembretes") {
      return await handleLembretes(req, res);
    }
    if (path === "/lembrete-vespera") {
      return await handleLembreteVespera(req, res);
    }
    if (path === "/asaas") {
      return await handleAsaasProxy(req, res);
    }
    if (path === "/asaas-webhook") {
      return await handleAsaasWebhook(req, res);
    }
    if (path === "/asaas-sync") {
      return await handleAsaasSync(req, res);
    }
    if (path === "/financeiro-wpp") {
      return await handleFinanceiroWpp(req, res);
    }
    if (path === "/track") {
      return await handleTrack(req, res);
    }
    if (path === "/cadencia-build") {
      return await handleCadenciaBuild(req, res);
    }
    if (path === "/cadencia-drain") {
      return await handleCadenciaDrain(req, res);
    }
    if (path === "/cadencia-stop") {
      return await handleCadenciaStop(req, res);
    }
    if (path === "/cadencia-test-send") {
      return await handleCadenciaTest(req, res);
    }
    if (path === "/noshow-start") {
      return await handleNoshowStart(req, res);
    }
    if (path === "/agendamento-sim") {
      return await handleAgendamentoSim(req, res);
    }
    if (path === "/cadencia-backfill") {
      return await handleCadenciaBackfill(req, res);
    }
    if (path === "/noshow-backfill") {
      return await handleNoshowBackfill(req, res);
    }
    if (path === "/reativacao-build") {
      return await handleReativacaoBuild(req, res);
    }
    if (path === "/wa-inbound") {
      return await handleWaInbound(req, res);
    }
    if (path === "/cockpit-venda") {
      return await handleCockpitProxy(req, res);
    }
    return await handleReceberLead(req, res);
  } catch (err) {
    console.error("receberLead error:", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});
