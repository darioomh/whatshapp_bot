const express = require("express");
const axios = require("axios");
const Groq = require("groq-sdk");
const nodemailer = require("nodemailer");
const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");
require("dotenv").config();

// Configuración de Base de Datos Local
const adapter = new FileSync("db.json");
const db = low(adapter);

// Inicializar DB con valores por defecto
db.defaults({ sessions: {}, processedMessages: {} }).write();

const app = express();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(express.json());

const VERIFY_TOKEN = "midas_verify";
const HUMAN_KEYWORDS = [
  "humano", "persona", "hablar", "agente", "atencion", "atencion",
  "operador", "ayuda", "real", "persona real", "hablar contigo",
  "no es un bot", "quiero hablar", "me atiende alguien", "asesor",
  "que me ayude", "hablar con alguien", "quiero que me ayude",
  "no entiendo", "no me sirve", "queja", "reclamacion",
];

const PAUSE_DURATION = 24 * 60 * 60 * 1000;

function isPaused(from) {
  const session = db.get(`sessions.${from}`).value();
  if (!session || !session.pausedAt) return false;
  
  if (Date.now() - session.pausedAt > PAUSE_DURATION) {
    db.set(`sessions.${from}.pausedAt`, null).write();
    return false;
  }
  return true;
}

const CATALOGO = {
  general:     "https://midasgold.es/es/catalogo",
  tienda:      "https://midasgold.es/es/tienda",
  contacto:    "https://midasgold.es/es/contacto",
  quienesSomos:"https://midasgold.es/es/midas/quienes-somos",
  damasquinado:"https://midasgold.es/es/midas/el-damasquinado",
  mujer: {
    base:       "https://midasgold.es/es/catalogo/mujer",
    pendientes: "https://midasgold.es/es/catalogo/mujer/pendientes",
    brazaletes: "https://midasgold.es/es/catalogo/mujer/brazaletes",
    colgantes:  "https://midasgold.es/es/catalogo/mujer/colgantes",
    pulseras:   "https://midasgold.es/es/catalogo/mujer/pulseras",
    relojes:    "https://midasgold.es/es/catalogo/mujer/relojes",
    anillos:    "https://midasgold.es/es/catalogo/mujer/anillos",
  },
  hombre: {
    base:       "https://midasgold.es/es/catalogo/hombre",
    gemelos:    "https://midasgold.es/es/catalogo/hombre/handbags",
    zippos:     "https://midasgold.es/es/catalogo/hombre/clothing",
    corbateros: "https://midasgold.es/es/catalogo/hombre/shoes",
    pulseras:   "https://midasgold.es/es/catalogo/hombre/jeans",
    llaveros:   "https://midasgold.es/es/catalogo/hombre/t-shirts",
    billeteros: "https://midasgold.es/es/catalogo/hombre/billeteros",
  },
  home: {
    base:       "https://midasgold.es/es/catalogo/home-coleccion",
    abrecartas: "https://midasgold.es/es/catalogo/home-coleccion/abrecartas",
    joyeros:    "https://midasgold.es/es/catalogo/home-coleccion/joyeros",
    platos:     "https://midasgold.es/es/catalogo/home-coleccion/platos-damasquinados",
  },
};

const SYSTEM_PROMPT = `Eres el asistente oficial de *MIDAS Gold* ✨, una joyería artesanal especializada en piezas únicas de oro, plata y el arte del damasquinado toledano.

INSTRUCCIONES DE FORMATO:
- Usa emojis relevantes.
- Usa *negrita* para destacar productos y precios.
- Usa listas con viñetas (-).
- Tono elegante, cálido y profesional.
- No uses markdown con # o ##.

CATÁLOGO:
• General: ${CATALOGO.general}
• Tienda: ${CATALOGO.tienda}

💎 MUJER: Pendientes (${CATALOGO.mujer.pendientes}), Brazaletes (${CATALOGO.mujer.brazaletes}), Colgantes (${CATALOGO.mujer.colgantes}).
👔 HOMBRE: Gemelos (${CATALOGO.hombre.gemelos}), Zippos (${CATALOGO.hombre.zippos}), Relojes (${CATALOGO.mujer.relojes}).
🏠 HOME: Abrecartas (${CATALOGO.home.abrecartas}), Joyeros (${CATALOGO.home.joyeros}).

CONTACTO:
📞 +34 925 504 699 / +34 917 692 759
📧 comercial@midasgold.es`;

function wantsHumanAgent(message) {
  const lower = message.toLowerCase();
  return HUMAN_KEYWORDS.some(k => lower.includes(k));
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false, // false para puerto 587 (STARTTLS)
  pool: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 30000,
  tls: {
    rejectUnauthorized: false // Ayuda con problemas de red en algunos entornos
  }
});

transporter.verify().catch(err => console.error("Error SMTP:", err.message));

async function notifyByEmail(customerNumber, customerMessage) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_ADMIN) return;

  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 20px auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
        .header { background-color: #000; padding: 20px; text-align: center; }
        .header img { max-width: 150px; }
        .content { padding: 30px; }
        .title { color: #d4af37; font-size: 22px; font-weight: bold; text-align: center; border-bottom: 2px solid #d4af37; padding-bottom: 10px; }
        .field { margin-top: 15px; }
        .value { background-color: #f9f9f9; padding: 10px; border-left: 4px solid #d4af37; }
        .button { background-color: #25d366; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header"><img src="cid:logo_midas" alt="MIDAS Gold"></div>
        <div class="content">
          <div class="title">Solicitud de Atención Humana</div>
          <div class="field"><strong>Cliente:</strong> +${customerNumber.replace(/\D/g, '')}</div>
          <div class="field"><strong>Mensaje:</strong> <div class="value">"${customerMessage}"</div></div>
          <div class="field"><strong>Fecha:</strong> ${new Date().toLocaleString("es-ES")}</div>
          <div style="text-align:center"><a href="https://business.facebook.com/latest/inbox/all" class="button">Abrir Meta Business Suite</a></div>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    await transporter.sendMail({
      from: `"Bot MIDAS Gold" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_ADMIN,
      subject: `⚠️ Atención Humana Solicitada: ${customerNumber}`,
      html,
      attachments: [{ filename: 'logo.png', path: './logo.png', cid: 'logo_midas' }]
    });
  } catch (error) {
    console.error("Error al enviar email:", error);
  }
}

async function sendWhatsAppMessage(to, body) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to, type: "text", text: { body } },
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("Error WhatsApp:", e.response?.data || e.message);
  }
}

app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] && req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];

    if (!message || message.type !== "text" || !message.text?.body) return res.sendStatus(200);

    const from = message.from;
    const text = message.text.body;
    const messageId = message.id;

    // Evitar duplicados
    if (db.get(`processedMessages.${messageId}`).value()) return res.sendStatus(200);
    db.set(`processedMessages.${messageId}`, Date.now()).write();

    // Limpiar mensajes antiguos de la DB (más de 1 hora)
    const oldMessages = db.get("processedMessages").value();
    const now = Date.now();
    for (const id in oldMessages) {
      if (now - oldMessages[id] > 3600000) db.unset(`processedMessages.${id}`).write();
    }

    if (isPaused(from)) return res.sendStatus(200);

    let session = db.get(`sessions.${from}`).value() || { history: [], lastActive: 0, waitingForChoice: false };

    // Si el cliente pide ayuda humana
    if (wantsHumanAgent(text)) {
      db.set(`sessions.${from}.pausedAt`, Date.now()).write();
      await notifyByEmail(from, text);
      await sendWhatsAppMessage(from, "✅ *Has sido transferido a un asesor humano.* En breve te atenderemos.\n📞 +34 925 504 699");
      return res.sendStatus(200);
    }

    // Lógica de "Deseas continuar" (si han pasado más de 12 horas)
    const TWELVE_HOURS = 12 * 60 * 60 * 1000;
    if (session.lastActive > 0 && (now - session.lastActive > TWELVE_HOURS) && !session.waitingForChoice) {
      session.waitingForChoice = true;
      db.set(`sessions.${from}`, session).write();
      await sendWhatsAppMessage(from, "✨ *¡Hola de nuevo!* He visto que estuvimos hablando hace un tiempo.\n\n¿Qué prefieres hacer?\n1️⃣ *Continuar* donde lo dejamos.\n2️⃣ Iniciar una *nueva consulta*.");
      return res.sendStatus(200);
    }

    // Manejar la elección del usuario
    if (session.waitingForChoice) {
      if (text.includes("1") || text.toLowerCase().includes("continuar")) {
        session.waitingForChoice = false;
        await sendWhatsAppMessage(from, "¡Perfecto! Continuamos. ¿En qué puedo ayudarte ahora?");
      } else if (text.includes("2") || text.toLowerCase().includes("nueva")) {
        session.history = [];
        session.waitingForChoice = false;
        await sendWhatsAppMessage(from, "Entendido. He reiniciado nuestra conversación. ¿Cómo puedo ayudarte hoy? ✨");
      } else {
        await sendWhatsAppMessage(from, "Por favor, elige una opción:\n1️⃣ Continuar\n2️⃣ Nueva consulta");
      }
      db.set(`sessions.${from}`, session).write();
      return res.sendStatus(200);
    }

    // Construir historial para Groq
    const history = session.history.slice(-10).map(m => ({ role: m.role, content: m.content }));
    history.push({ role: "user", content: text });

    const completion = await groq.chat.completions.create({
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
      model: "llama-3.1-8b-instant",
    });

    const reply = completion.choices[0]?.message?.content || "Lo siento, ¿puedes repetir?";
    
    // Guardar en historial
    session.history.push({ role: "user", content: text, time: now });
    session.history.push({ role: "assistant", content: reply, time: now });
    session.lastActive = now;
    db.set(`sessions.${from}`, session).write();

    await sendWhatsAppMessage(from, reply);
    res.sendStatus(200);
  } catch (err) {
    console.error("Error crítico:", err.message);
    res.sendStatus(500);
  }
});

app.listen(3000, () => console.log("Servidor MIDAS Gold listo en puerto 3000"));
