const express = require("express");
const axios = require("axios");
const Groq = require("groq-sdk");
require("dotenv").config();

const app = express();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(express.json());

const VERIFY_TOKEN = "midas_verify";
const SYSTEM_PROMPT =
  "Eres un asistente de MIDAS Gold, una joyería. Responde en español de forma amable y breve. Ayudas con catálogo, precios, regalos, y agendar citas con asesores.";

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("Webhook verificado");
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (message) {
      const from = message.from;
      const text = message.text?.body;

      console.log("Mensaje recibido:", text);

      const completion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
        model: "llama-3.1-8b-instant",
      });

      const reply = completion.choices[0]?.message?.content || "No entendí el mensaje 😅";

      await axios.post(
        `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: from,
          type: "text",
          text: {
            body: reply,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.sendStatus(500);
  }
});

app.listen(3000, () => {
  console.log("Servidor corriendo en puerto 3000");
});