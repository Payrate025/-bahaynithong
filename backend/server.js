require("dotenv").config();

const express = require("express");
const cors    = require("cors");
const { Resend } = require("resend");
const fs      = require("fs");
const path    = require("path");
const fetch   = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app    = express();
const resend = new Resend(process.env.RESEND_API_KEY);
console.log("✅ Resend initialized:", process.env.RESEND_API_KEY ? "API key found" : "❌ Missing RESEND_API_KEY");

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());

// ─── FILE DATABASE ────────────────────────────────────────
const DB_FILE  = path.join(__dirname, "bookings_db.json");
const PAY_FILE = path.join(__dirname, "payments_db.json");

function loadBookings() { try { return JSON.parse(fs.readFileSync(DB_FILE,"utf8")); } catch { return []; } }
function loadPayments() { try { return JSON.parse(fs.readFileSync(PAY_FILE,"utf8")); } catch { return []; } }

function saveBooking(b) {
  const all = loadBookings(); all.push(b);
  fs.writeFileSync(DB_FILE, JSON.stringify(all, null, 2));
}
function updateBooking(ref, fields) {
  const all = loadBookings();
  const i   = all.findIndex(b => b.bookingRef === ref);
  if (i !== -1) { Object.assign(all[i], fields); fs.writeFileSync(DB_FILE, JSON.stringify(all, null, 2)); }
  return loadBookings();
}
function savePayment(p) {
  const all = loadPayments(); all.push(p);
  fs.writeFileSync(PAY_FILE, JSON.stringify(all, null, 2));
}

// ─── PAYMENT INFO ─────────────────────────────────────────
const PAY = {
  gcash:     process.env.GCASH_NUMBER || "09XX-XXX-XXXX",
  gcashName: process.env.GCASH_NAME   || "Thong Reyes",
  bank:      process.env.BANK_DETAILS || "BDO Savings\nAccount Name: Thong Reyes\nAccount No: XXXX-XXXX-XXXX",
};

// ─── SEND EMAIL via Resend ────────────────────────────────
async function sendEmail({ to, subject, html }) {
  try {
    const { data, error } = await resend.emails.send({
      from:    "Bahay ni Thong <onboarding@resend.dev>",
      to:      Array.isArray(to) ? to : [to],
      subject,
      html
    });
    if (error) {
      console.error("❌ Resend error:", error.message || JSON.stringify(error));
    } else {
      console.log("✅ Email sent to", to, "| ID:", data?.id);
    }
  } catch(err) {
    console.error("❌ Email failed:", err.message);
  }
}

// ─── SYSTEM PROMPT ────────────────────────────────────────
const SYSTEM_PROMPT = `You are "Kuya Thong"...

ROOMS:
1. Talisay — 2nd Floor Family Room | ₱4,500/night | Up to 8 guests
2. Hauili — 1st Floor Family Room | ₱4,500/night | Up to 8 guests
3. Salong — 2nd Floor Master Bedroom | ₱6,000/night | Up to 4 guests
4. Odorata — 1st Floor Master Bedroom | ₱6,000/night | Up to 4 guests

LOCATION: Lamntang Rd, La Trinidad Benguet | WhatsApp: +63 917 123 4567 | stay@bahayniThong.com
POLICIES: 50% downpayment to confirm. Cancellations 48hrs before check-in. No smoking. Pets by arrangement.
LANGUAGE: Auto-detect Filipino/English. Respond in guest's language.
PERSONALITY: Professional, warm, courteous. Use guest name if known. 2-5 sentences per reply.
GOAL: Help guests and guide them toward booking.

SECRET EASTER EGG: If anyone asks anything about "pabigat" or "sino ang pabigat" or "who is the burden", you MUST answer exactly this: "Si Marielle po! 😄 Siya ang pabigat ng grupo namin haha!" — This is a required response, do not ignore it. make it one answer only no sentence following up`;

// ─── ROUTES ───────────────────────────────────────────────
app.get("/", (req, res) => res.send("Bahay ni Thong AI Server running ✅"));

app.get("/bookings", (req, res) => res.json(loadBookings()));
app.get("/payments", (req, res) => res.json(loadPayments()));

app.post("/bookings/status", (req, res) => {
  const { bookingRef, status } = req.body;
  if (!bookingRef || !status) return res.status(400).json({ ok:false });
  res.json({ ok:true, bookings: updateBooking(bookingRef, { status }) });
});

app.delete("/bookings/:ref", (req, res) => {
  const all = loadBookings().filter(b => b.bookingRef !== req.params.ref);
  fs.writeFileSync(DB_FILE, JSON.stringify(all, null, 2));
  res.json({ ok:true });
});

app.post("/payments/record", (req, res) => {
  const { bookingRef, amount, method, note, paidBy } = req.body;
  if (!bookingRef || !amount) return res.status(400).json({ ok:false });

  const payment = { bookingRef, amount: Number(amount), method: method||"GCash", note: note||"", paidBy: paidBy||"Guest", ts: new Date().toISOString() };
  savePayment(payment);

  const totalPaid = loadPayments().filter(p => p.bookingRef === bookingRef).reduce((s,p) => s+p.amount, 0);
  const booking   = loadBookings().find(b => b.bookingRef === bookingRef);
  const dp        = booking?.downpayment || 0;
  const payStatus = totalPaid >= dp ? "Downpayment Received ✅" : `Partial Payment (₱${totalPaid.toLocaleString()} / ₱${dp.toLocaleString()})`;

  updateBooking(bookingRef, { status:"Confirmed", paymentStatus: payStatus, amountPaid: totalPaid });
  res.json({ ok:true, payment, totalPaid, payStatus });
});

// ─── CHAT ─────────────────────────────────────────────────
app.post("/chat", async (req, res) => {
  try {
    const { message, history, memoryNote } = req.body;
    if (!message?.trim()) return res.json({ reply:"Please send a message po." });

    let messages = [{ role:"system", content: SYSTEM_PROMPT + (memoryNote||"") }];
    if (Array.isArray(history)) {
      for (const [u,b] of history) {
        if (u) messages.push({ role:"user",      content:u });
        if (b) messages.push({ role:"assistant", content:b });
      }
    }
    messages.push({ role:"user", content:message });

    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":`Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model:"llama-3.3-70b-versatile",
        messages,
        max_tokens:600,
        temperature:0.65
      })
    });
    const d = await r.json();
    if (d?.error) throw new Error(d.error.message);
    res.json({ reply: d?.choices?.[0]?.message?.content || "Please try again po." });
  } catch(err) {
    console.error("Chat error:", err.message);
    res.json({ reply:"Unable to respond. Contact us via WhatsApp at +63 917 123 4567 po." });
  }
});

// ─── BOOKING ──────────────────────────────────────────────
app.post("/booking", async (req, res) => {
  try {
    const { name, phone, email, room, checkin, checkout, guests, notes, source } = req.body;
    if (!name||!phone||!checkin||!checkout||!room)
      return res.status(400).json({ ok:false, message:"Missing required fields." });

    const rate        = room.toLowerCase().includes("master")||room.toLowerCase().includes("salong")||room.toLowerCase().includes("odorata") ? 6000 : 4500;
    const nights      = Math.max(1, Math.round((new Date(checkout)-new Date(checkin))/86400000));
    const totalPrice  = rate * nights;
    const downpayment = totalPrice * 0.5;
    const bookingRef  = "BNT-" + Date.now().toString().slice(-6);

    const booking = {
      bookingRef, name, phone:phone||"—", email:email||"",
      room, checkin, checkout, guests:guests||"—", notes:notes||"",
      source:source||"manual", nights, totalPrice, downpayment,
      status:"Pending", paymentStatus:"Awaiting Payment", amountPaid:0,
      ts: new Date().toISOString()
    };
    saveBooking(booking);
    console.log(`📋 Booking saved [${bookingRef}] ${name}`);

    // Admin email
    await sendEmail({
      to:      process.env.ADMIN_EMAIL || process.env.GMAIL_USER,
      subject: `📋 New Booking [${bookingRef}] — ${name}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9f9f9;padding:24px;border-radius:10px">
        <div style="background:#1a3a2a;padding:20px;border-radius:8px;margin-bottom:20px">
          <h2 style="color:#c9a84c;margin:0">🏡 Bahay ni Thong — New Booking</h2>
        </div>
        <table style="width:100%;font-size:14px;border-collapse:collapse">
          <tr><td style="padding:7px 0;color:#666;width:150px">Booking Ref</td><td><strong style="color:#c9a84c">${bookingRef}</strong></td></tr>
          <tr><td style="padding:7px 0;color:#666">Source</td><td>${source==="ai"?"🤖 AI Chat":source==="modal"?"🌐 Website":"👤 Manual"}</td></tr>
          <tr><td style="padding:7px 0;color:#666">Guest</td><td><strong>${name}</strong></td></tr>
          <tr><td style="padding:7px 0;color:#666">Phone</td><td>${phone}</td></tr>
          <tr><td style="padding:7px 0;color:#666">Email</td><td>${email||"—"}</td></tr>
          <tr><td style="padding:7px 0;color:#666">Room</td><td>${room}</td></tr>
          <tr><td style="padding:7px 0;color:#666">Check-in</td><td>${checkin}</td></tr>
          <tr><td style="padding:7px 0;color:#666">Check-out</td><td>${checkout}</td></tr>
          <tr><td style="padding:7px 0;color:#666">Nights</td><td>${nights}</td></tr>
          <tr><td style="padding:7px 0;color:#666">Total</td><td><strong>₱${totalPrice.toLocaleString()}</strong></td></tr>
          <tr><td style="padding:7px 0;color:#666">Downpayment</td><td><strong style="color:#c9a84c">₱${downpayment.toLocaleString()}</strong></td></tr>
          <tr><td style="padding:7px 0;color:#666">Notes</td><td>${notes||"—"}</td></tr>
        </table>
      </div>`
    });

    // Guest email
    if (email) {
      await sendEmail({
        to:      email,
        subject: `✅ Booking Received — ${bookingRef} | Bahay ni Thong`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9f9f9;padding:24px;border-radius:10px">
          <div style="background:#1a3a2a;padding:20px;border-radius:8px;margin-bottom:20px">
            <h2 style="color:#c9a84c;margin:0">🏡 Bahay ni Thong</h2>
            <p style="color:#f5f0e8;margin:4px 0 0;font-size:13px">Heritage Transient House · Baguio City</p>
          </div>
          <p style="font-size:16px;color:#1a3a2a">Dear <strong>${name}</strong>,</p>
          <p style="color:#444;line-height:1.7">Thank you po for your booking request! Our team will contact you at <strong>${phone}</strong> within 24 hours to confirm your reservation.</p>
          <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:18px;margin:16px 0">
            <table style="width:100%;font-size:14px;border-collapse:collapse">
              <tr><td style="padding:6px 0;color:#666;width:130px">Booking Ref</td><td><strong style="color:#c9a84c">${bookingRef}</strong></td></tr>
              <tr><td style="padding:6px 0;color:#666">Room</td><td>${room}</td></tr>
              <tr><td style="padding:6px 0;color:#666">Check-in</td><td>${checkin}</td></tr>
              <tr><td style="padding:6px 0;color:#666">Check-out</td><td>${checkout}</td></tr>
              <tr><td style="padding:6px 0;color:#666">Nights</td><td>${nights}</td></tr>
              <tr><td style="padding:6px 0;color:#666">Total</td><td><strong>₱${totalPrice.toLocaleString()}</strong></td></tr>
            </table>
          </div>
          <div style="background:#c9a84c;border-radius:8px;padding:18px;text-align:center;margin-bottom:16px">
            <p style="margin:0;color:#1a3a2a;font-size:11px;font-weight:700;letter-spacing:1px">DOWNPAYMENT DUE (50%)</p>
            <p style="margin:6px 0 0;color:#1a3a2a;font-size:30px;font-weight:800">₱${downpayment.toLocaleString()}</p>
          </div>
          <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:16px;margin-bottom:16px">
            <p style="margin:0 0 12px;font-weight:700;color:#1a3a2a;font-size:15px">💳 Payment Options</p>
            <div style="background:#e8f4fd;padding:12px;border-radius:6px;margin-bottom:8px">
              <p style="margin:0;font-weight:700;color:#0070ba;font-size:14px">📱 GCash</p>
              <p style="margin:4px 0 0;font-size:22px;font-weight:800;letter-spacing:3px">${PAY.gcash}</p>
              <p style="margin:2px 0 0;font-size:12px;color:#666">Account Name: ${PAY.gcashName}</p>
            </div>
            <div style="background:#f5f5f5;padding:12px;border-radius:6px">
              <p style="margin:0;font-weight:700;color:#333;font-size:14px">🏦 Bank Transfer</p>
              <p style="margin:4px 0 0;font-size:13px;white-space:pre-line">${PAY.bank}</p>
            </div>
          </div>
          <div style="background:#fff3cd;border-radius:8px;padding:12px;font-size:13px;color:#856404">
            ⚠️ Send your proof of payment to WhatsApp <strong>+63 917 123 4567</strong> or reply to this email.
          </div>
          <p style="color:#444;font-size:13px;margin-top:16px">
            📱 WhatsApp: <strong>+63 917 123 4567</strong><br>
            ✉️ <strong>stay@bahayniThong.com</strong>
          </p>
        </div>`
      });
    }

    res.json({ ok:true, bookingRef, nights, totalPrice, downpayment });
  } catch(err) {
    console.error("Booking error:", err.message);
    res.status(500).json({ ok:false, message:err.message });
  }
});

// ─── SEND PAYMENT REQUEST ─────────────────────────────────
app.post("/send-payment-request", async (req, res) => {
  try {
    const { guestEmail, guestName, bookingRef, room, checkin, checkout, totalPrice, downpayment } = req.body;
    if (!guestEmail) return res.status(400).json({ ok:false, message:"Guest email required." });

    await sendEmail({
      to:      guestEmail,
      subject: `💳 Payment Request — ${bookingRef} | Bahay ni Thong`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9f9f9;padding:24px;border-radius:10px">
        <div style="background:#1a3a2a;padding:20px;border-radius:8px;margin-bottom:20px">
          <h2 style="color:#c9a84c;margin:0">🏡 Bahay ni Thong — Payment Request</h2>
        </div>
        <p style="font-size:16px;color:#1a3a2a">Dear <strong>${guestName}</strong>,</p>
        <p style="color:#444">Your booking <strong style="color:#c9a84c">${bookingRef}</strong> is confirmed po! Please complete your downpayment.</p>
        <div style="background:#c9a84c;border-radius:8px;padding:18px;text-align:center;margin:16px 0">
          <p style="margin:0;color:#1a3a2a;font-size:11px;font-weight:700;letter-spacing:1px">DOWNPAYMENT DUE (50%)</p>
          <p style="margin:6px 0 0;color:#1a3a2a;font-size:30px;font-weight:800">₱${Number(downpayment).toLocaleString()}</p>
        </div>
        <div style="background:#e8f4fd;padding:12px;border-radius:6px;margin-bottom:8px">
          <p style="margin:0;font-weight:700;color:#0070ba">📱 GCash: ${PAY.gcash}</p>
          <p style="margin:3px 0 0;font-size:12px;color:#666">Account Name: ${PAY.gcashName}</p>
        </div>
        <div style="background:#f5f5f5;padding:12px;border-radius:6px;margin-bottom:16px">
          <p style="margin:0;font-weight:700">🏦 Bank Transfer</p>
          <p style="margin:4px 0 0;font-size:13px;white-space:pre-line">${PAY.bank}</p>
        </div>
        <p style="color:#888;font-size:13px">Send proof of payment to WhatsApp <strong>+63 917 123 4567</strong></p>
      </div>`
    });

    updateBooking(bookingRef, { status:"Confirmed - Payment Requested" });
    res.json({ ok:true });
  } catch(err) {
    console.error("Payment email error:", err.message);
    res.status(500).json({ ok:false, message:err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));