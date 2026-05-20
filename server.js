const express = require("express");
const axios = require("axios");
const Groq = require("groq-sdk");
const nodemailer = require("nodemailer");
require("dotenv").config();

const processedMessages = new Map();

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

const pausedCustomers = new Map();
const PAUSE_DURATION = 24 * 60 * 60 * 1000;

function isPaused(from) {
  if (!pausedCustomers.has(from)) return false;
  if (Date.now() - pausedCustomers.get(from) > PAUSE_DURATION) {
    pausedCustomers.delete(from);
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

INSTRUCCIONES DE FORMATO (MUY IMPORTANTE):
- Usa emojis relevantes para hacer los mensajes visuales y atractivos.
- Usa *negrita* (asteriscos) para destacar nombres de productos, precios y secciones.
- Usa listas con viñetas (guion) para mostrar categorías o productos.
- Mantén un tono elegante, cálido y profesional.
- Sé conciso pero completo.
- Nunca uses markdown con # o ## (no funciona en WhatsApp).

CATÁLOGO COMPLETO CON URLs:
• Catálogo general: ${CATALOGO.general}
• Tienda online: ${CATALOGO.tienda}

💎 COLECCIÓN MUJER:
- Pendientes → ${CATALOGO.mujer.pendientes}
- Brazaletes → ${CATALOGO.mujer.brazaletes}
- Colgantes → ${CATALOGO.mujer.colgantes}
- Pulseras → ${CATALOGO.mujer.pulseras}
- Relojes → ${CATALOGO.mujer.relojes}
- Anillos → ${CATALOGO.mujer.anillos}

👔 COLECCIÓN HOMBRE:
- Gemelos → ${CATALOGO.hombre.gemelos}
- Zippos → ${CATALOGO.hombre.zippos}
- Corbateros → ${CATALOGO.hombre.corbateros}
- Pulseras → ${CATALOGO.hombre.pulseras}
- Llaveros → ${CATALOGO.hombre.llaveros}
- Billeteros → ${CATALOGO.hombre.billeteros}

🏠 COLECCIÓN HOME:
- Abrecartas → ${CATALOGO.home.abrecartas}
- Joyeros → ${CATALOGO.home.joyeros}
- Platos Damasquinados → ${CATALOGO.home.platos}

PRECIOS DE REFERENCIA (de productos reales en la web):
- Brazalete fino damasquinado plata: 40,00 €
- Pendientes damasquinado y cristal checo: desde 29,00 €
- Pendientes hoja damasquinados plata: 13,00 €
- Pendientes gota damasquinados plata: 16,00 €
- Brazalete damasquinado y cristal checo: desde 78,00 €
- Pendientes diamante damasquinados oro: 21,50 €
- Envío gratuito desde 60€

CONTACTO Y CITAS:
📍 C/ Río Jarama, 132 - Nave 3.05 - 45007 - Toledo, España
📞 +34 925 504 699 / +34 917 692 759
📧 comercial@midasgold.es
🌐 ${CATALOGO.contacto}

Para agendar cita con un asesor, siempre proporciona el teléfono y el correo.

RESPUESTAS ESPECIALES:
- Si piden el catálogo completo → muestra las 3 colecciones con sus URLs y emojis.
- Si piden regalos → sugiere categorías relevantes con URLs directas.
- Si piden precios → menciona el rango y redirige a la URL de la categoría.
- Si saludan → saluda con el nombre MIDAS Gold y ofrece las 3 colecciones como opciones.`;

function wantsHumanAgent(message) {
  const lower = message.toLowerCase();
  return HUMAN_KEYWORDS.some(k => lower.includes(k));
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function notifyByEmail(customerNumber, customerMessage) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_ADMIN) return;

  const text =
    `Solicitud de atención humana\n\n` +
    `Cliente: ${customerNumber}\n` +
    `Mensaje: "${customerMessage}"\n` +
    `Hora: ${new Date().toLocaleString("es-ES")}\n\n` +
    `Responde desde Meta Business Suite → Inbox → WhatsApp`;

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: process.env.EMAIL_ADMIN,
    subject: "🔔 Solicitud de atención humana - MIDAS Gold",
    text,
  });
}

async function sendWhatsAppMessage(to, body) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

app.get("/webhook", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("Webhook verificado");
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;

    if (value?.statuses) {
      return res.sendStatus(200);
    }

    const message = value?.messages?.[0];

    if (!message || message.type !== "text" || !message.text?.body) {
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text.body;
    const messageId = message.id;

    if (from === process.env.PHONE_NUMBER_ID || from === process.env.YOUR_BOT_NUMBER) {
      console.log("Ignorando mensaje del propio bot:", from);
      return res.sendStatus(200);
    }

    if (processedMessages.has(messageId)) {
      console.log("Mensaje ya procesado:", messageId);
      return res.sendStatus(200);
    }
    processedMessages.set(messageId, Date.now());

    const now = Date.now();
    for (const [id, timestamp] of processedMessages) {
      if (now - timestamp > 300000) {
        processedMessages.delete(id);
      }
    }

    console.log("Mensaje nuevo procesado:", { from, text, messageId });

    if (isPaused(from)) {
      return res.sendStatus(200);
    }

    if (wantsHumanAgent(text)) {
      pausedCustomers.set(from, Date.now());
      notifyByEmail(from, text).catch(e => console.error("Error email:", e.message));
      await sendWhatsAppMessage(
        from,
        "✅ *Has sido transferido a un asesor humano.*\n\n" +
        "En breve recibirás atención personalizada. " +
        "Si lo prefieres, contáctanos directamente:\n" +
        "📞 +34 925 504 699\n📧 comercial@midasgold.es"
      );
      console.log("Cliente transferido a humano:", from);
      return res.sendStatus(200);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    let reply;
    try {
      const completion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
        model: "llama-3.1-8b-instant",
        temperature: 0.7,
        max_tokens: 800,
      }, {
        signal: controller.signal
      });

      reply = completion.choices[0]?.message?.content ||
        "Lo siento, no pude procesar tu mensaje. Por favor contáctanos en comercial@midasgold.es";
    } catch (groqError) {
      clearTimeout(timeout);
      console.error("Error en Groq:", groqError.message);
      reply = "Estoy teniendo problemas técnicos. Por favor, intenta de nuevo en un momento o escríbenos a comercial@midasgold.es";
    }
    clearTimeout(timeout);

    await sendWhatsAppMessage(from, reply);
    console.log("Respuesta enviada a:", from);

    res.sendStatus(200);
  } catch (err) {
    console.error("Error crítico en webhook:", err.response?.data || err.message);
    res.sendStatus(500);
  }
});

app.listen(3000, () => {
  console.log("Servidor MIDAS Gold corriendo en puerto 3000");
});
