const express = require("express");
const axios = require("axios");
const Groq = require("groq-sdk");
require("dotenv").config();

const app = express();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(express.json());

const VERIFY_TOKEN = "midas_verify";

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

    if (message && message.type === "text" && message.text?.body) {
      const from = message.from;
      const text = message.text.body;

      console.log("Mensaje recibido:", text);

      const completion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user",   content: text },
        ],
        model:       "llama-3.1-8b-instant",
        temperature: 0.7,
        max_tokens:  800,
      });

      const reply =
        completion.choices[0]?.message?.content ||
        "Lo siento, no pude procesar tu mensaje. Por favor contáctanos en comercial@midasgold.es";

      await axios.post(
        `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to:   from,
          type: "text",
          text: { body: reply },
        },
        {
          headers: {
            Authorization:  `Bearer ${process.env.WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Error:", err.response?.data || err.message);
    res.sendStatus(500);
  }
});

app.listen(3000, () => {
  console.log("Servidor MIDAS Gold corriendo en puerto 3000");
});
