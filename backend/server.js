require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors({
  origin: [
    "https://bahaynithong.netlify.app",
    "https://bahaynithong-production.up.railway.app",
    "http://localhost:5500",
    "http://127.0.0.1:5500"
  ]
}));
app.use(express.json());

// ✅ Health check
app.get("/", (req, res) => {
  res.send("Bahay ni Thong AI Server is running ✅");
});

// ✅ CHAT ENDPOINT (Gemini)
app.post("/chat", async (req, res) => {
  try {
    const { message, history } = req.body;

    // 🔒 Validate input
    if (!message || !message.trim()) {
      return res.json({ reply: "Please send a message." });
    }

    // 🧠 Build Gemini conversation format
    let contents = [];

    if (Array.isArray(history)) {
      for (const [userMsg, botMsg] of history) {
        if (userMsg) {
          contents.push({
            role: "user",
            parts: [{ text: userMsg }]
          });
        }
        if (botMsg) {
          contents.push({
            role: "model",
            parts: [{ text: botMsg }]
          });
        }
      }
    }

    // Add current message
    contents.push({
      role: "user",
      parts: [{ text: message }]
    });

    // 🚀 Call Gemini API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents,
          systemInstruction: {
            role: "system",
            parts: [
              {
                text: `You are "Kuya Thong", a friendly AI booking assistant for Bahay ni Thong in Baguio City.

You help with:
- Room info (Family Room ₱3500, Master Room ₱4500)
- Amenities (WiFi, kitchen, parking, etc.)
- Booking instructions

Keep replies short (2–4 sentences), friendly, and slightly Filipino tone (po/kuya/ate). Encourage booking.`
              }
            ]
          }
        })
      }
    );

    const data = await response.json();

  console.log("Gemini response:", JSON.stringify(data, null, 2));

    const reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Sorry, I couldn’t respond right now.";

    res.json({ reply });

  } catch (err) {
    console.error("Server error:", err);
    res.json({
      reply: "Oops! Something went wrong. Please contact us directly."
    });
  }
});

// ✅ START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});