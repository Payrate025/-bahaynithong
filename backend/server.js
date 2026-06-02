require("dotenv").config();

const express = require("express");
const cors    = require("cors");
const nodemailer = require("nodemailer");
const fs      = require("fs");
const path    = require("path");
const fetch   = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app    = express();
// ─── BREVO SMTP (sends to ANY email, free tier = 300/day) ────
const mailer = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.BREVO_USER,
    pass: process.env.BREVO_PASS
  }
});
mailer.verify(err => {
  if (err) console.error("❌ Brevo SMTP failed:", err.message);
  else     console.log("✅ Brevo SMTP connected");
});

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
    await mailer.sendMail({
      from:    `"Bahay ni Thong" <${process.env.BREVO_USER}>`,
      to,
      subject,
      html
    });
    console.log("✅ Email sent to", to);
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

app.post("/payments/record", async (req, res) => {
  const { bookingRef, amount, method, note, paidBy } = req.body;
  if (!bookingRef || !amount) return res.status(400).json({ ok:false });

  const payment = { bookingRef, amount: Number(amount), method: method||"GCash", note: note||"", paidBy: paidBy||"Guest", ts: new Date().toISOString() };
  savePayment(payment);

  const totalPaid = loadPayments().filter(p => p.bookingRef === bookingRef).reduce((s,p) => s+p.amount, 0);
  const booking   = loadBookings().find(b => b.bookingRef === bookingRef);
  const dp        = booking?.downpayment || 0;
  const payStatus = totalPaid >= dp ? "Downpayment Received ✅" : `Partial Payment (₱${totalPaid.toLocaleString()} / ₱${dp.toLocaleString()})`;

  updateBooking(bookingRef, { status:"Confirmed", paymentStatus: payStatus, amountPaid: totalPaid });

  // Send payment confirmation email to guest
  const booking = loadBookings().find(b => b.bookingRef === bookingRef);
  if (booking?.email) {
    try {
      await sendEmail({
        to:      booking.email,
        subject: `✅ Payment Confirmed — ${bookingRef} | Bahay ni Thong`,
        html: `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:620px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
  <div style="background:linear-gradient(135deg,#1a3a2a,#0d2218);padding:36px;text-align:center">
    <div style="font-family:Georgia,serif;font-size:28px;color:#c9a84c;letter-spacing:2px">🏡 Bahay ni Thong</div>
    <div style="font-size:11px;color:rgba(245,240,232,0.6);letter-spacing:3px;text-transform:uppercase;margin-top:4px">Heritage Transient House · Baguio City</div>
  </div>
  <div style="padding:32px">
    <!-- Success Banner -->
    <div style="background:linear-gradient(135deg,#2ecc71,#27ae60);border-radius:10px;padding:24px;text-align:center;margin-bottom:24px">
      <div style="font-size:40px;margin-bottom:8px">✅</div>
      <div style="font-size:22px;font-weight:800;color:#fff;margin-bottom:4px">Payment Confirmed!</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.85)">Your reservation at Bahay ni Thong is now secured</div>
    </div>

    <p style="font-size:16px;color:#1a3a2a;margin:0 0 8px">Dear <strong>${booking.name}</strong>,</p>
    <p style="color:#666;line-height:1.7;margin:0 0 24px;font-size:14px">
      Great news po! We have received your payment and your booking is now <strong style="color:#27ae60">officially confirmed</strong>. We look forward to welcoming you to Bahay ni Thong! 🎉
    </p>

    <!-- Booking Summary -->
    <div style="background:#f8f9fa;border-radius:10px;padding:20px;margin-bottom:20px;border:1px solid #eee">
      <div style="font-size:12px;font-weight:700;color:#1a3a2a;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px">📋 Confirmed Booking</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #eee;width:140px">Booking Ref</td><td style="padding:8px 0;border-bottom:1px solid #eee"><strong style="color:#c9a84c">${bookingRef}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #eee">Room</td><td style="padding:8px 0;border-bottom:1px solid #eee"><strong>${booking.room}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #eee">Check-in</td><td style="padding:8px 0;border-bottom:1px solid #eee">${booking.checkin}</td></tr>
        <tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #eee">Check-out</td><td style="padding:8px 0;border-bottom:1px solid #eee">${booking.checkout}</td></tr>
        <tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #eee">Nights</td><td style="padding:8px 0;border-bottom:1px solid #eee">${booking.nights} night/s</td></tr>
        <tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #eee">Total Amount</td><td style="padding:8px 0;border-bottom:1px solid #eee"><strong>₱${Number(booking.totalPrice).toLocaleString()}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #eee">Amount Paid</td><td style="padding:8px 0;border-bottom:1px solid #eee"><strong style="color:#27ae60">₱${totalPaid.toLocaleString()}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#888">Payment Status</td><td style="padding:8px 0"><span style="background:#d4edda;color:#155724;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600">${payStatus}</span></td></tr>
      </table>
    </div>

    <!-- What's Next -->
    <div style="background:#e8f5e9;border-radius:10px;padding:20px;margin-bottom:20px">
      <div style="font-size:12px;font-weight:700;color:#1a3a2a;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">📌 What's Next?</div>
      <div style="font-size:13px;color:#444;line-height:1.8">
        • Our team will reach out with your <strong>check-in instructions</strong><br>
        • Please bring a valid ID upon check-in<br>
        • Check-in time is <strong>2:00 PM</strong> | Check-out time is <strong>12:00 PM</strong><br>
        • For questions, contact us on WhatsApp: <strong>+63 917 123 4567</strong>
      </div>
    </div>

    <div style="text-align:center;padding:16px;background:#f8f9fa;border-radius:8px">
      <p style="margin:0;font-size:13px;color:#666">We look forward to your stay!</p>
      <p style="margin:8px 0 0;font-size:14px;color:#1a3a2a">📱 <strong>+63 917 123 4567</strong> &nbsp;·&nbsp; ✉️ <strong>stay@bahayniThong.com</strong></p>
    </div>
  </div>
  <div style="background:#1a3a2a;padding:20px;text-align:center;font-size:11px;color:rgba(245,240,232,0.5);letter-spacing:1px">
    Bahay ni Thong · Lamntang Rd, La Trinidad, Benguet · © 2026
  </div>
</div>`
      });
      console.log(`✅ Payment confirmation sent to ${booking.email}`);
    } catch(emailErr) {
      console.error("Payment confirmation email failed:", emailErr.message);
    }
  }

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
      html: `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:620px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
  <div style="background:linear-gradient(135deg,#1a3a2a,#0d2218);padding:32px;text-align:center">
    <div style="font-family:Georgia,serif;font-size:24px;color:#c9a84c;letter-spacing:2px">🏡 Bahay ni Thong</div>
    <div style="font-size:11px;color:rgba(245,240,232,0.6);letter-spacing:3px;text-transform:uppercase;margin-top:4px">New Booking Request</div>
  </div>
  <div style="padding:28px 32px;background:#f9f9f9">
    <div style="background:#fff;border-radius:10px;padding:20px;border:1px solid #e8e8e8;margin-bottom:16px">
      <div style="font-size:12px;font-weight:700;color:#1a3a2a;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px">📋 Booking Details</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #f5f5f5;width:140px">Booking Ref</td><td style="padding:8px 0;border-bottom:1px solid #f5f5f5"><strong style="color:#c9a84c">${bookingRef}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #f5f5f5">Source</td><td style="padding:8px 0;border-bottom:1px solid #f5f5f5">${source==="ai"?"🤖 AI Chat":source==="modal"?"🌐 Website":"👤 Manual"}</td></tr>
        <tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #f5f5f5">Guest</td><td style="padding:8px 0;border-bottom:1px solid #f5f5f5"><strong>${name}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #f5f5f5">Phone</td><td style="padding:8px 0;border-bottom:1px solid #f5f5f5">${phone}</td></tr>
        <tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #f5f5f5">Email</td><td style="padding:8px 0;border-bottom:1px solid #f5f5f5">${email||"—"}</td></tr>
        <tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #f5f5f5">Room</td><td style="padding:8px 0;border-bottom:1px solid #f5f5f5">${room}</td></tr>
        <tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #f5f5f5">Check-in</td><td style="padding:8px 0;border-bottom:1px solid #f5f5f5">${checkin}</td></tr>
        <tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #f5f5f5">Check-out</td><td style="padding:8px 0;border-bottom:1px solid #f5f5f5">${checkout}</td></tr>
        <tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #f5f5f5">Nights</td><td style="padding:8px 0;border-bottom:1px solid #f5f5f5">${nights}</td></tr>
        <tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #f5f5f5">Total</td><td style="padding:8px 0;border-bottom:1px solid #f5f5f5"><strong>₱${totalPrice.toLocaleString()}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #f5f5f5">Downpayment (50%)</td><td style="padding:8px 0;border-bottom:1px solid #f5f5f5"><strong style="color:#c9a84c">₱${downpayment.toLocaleString()}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#888">Notes</td><td style="padding:8px 0">${notes||"—"}</td></tr>
      </table>
    </div>
    <div style="background:#fff3cd;border-left:4px solid #c9a84c;padding:12px 16px;border-radius:0 8px 8px 0;font-size:13px;color:#856404">
      ⚠️ Contact the guest within 24 hours. Go to your <strong>Admin Dashboard</strong> to confirm and send payment request.
    </div>
  </div>
  <div style="background:#1a3a2a;padding:16px;text-align:center;font-size:11px;color:rgba(245,240,232,0.5);letter-spacing:1px">
    Bahay ni Thong · Lamntang Rd, La Trinidad, Benguet · stay@bahayniThong.com
  </div>
</div>`
    });

    // Guest email
    if (email) {
      await sendEmail({
        to:      email,
        subject: `✅ Booking Received — ${bookingRef} | Bahay ni Thong`,
        html: `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:620px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
  <div style="background:linear-gradient(135deg,#1a3a2a,#0d2218);padding:36px;text-align:center">
    <div style="font-family:Georgia,serif;font-size:28px;color:#c9a84c;letter-spacing:2px;margin-bottom:4px">🏡 Bahay ni Thong</div>
    <div style="font-size:11px;color:rgba(245,240,232,0.6);letter-spacing:3px;text-transform:uppercase">Heritage Transient House · Baguio City</div>
    <div style="margin-top:20px;background:rgba(201,168,76,0.15);border:1px solid rgba(201,168,76,0.3);border-radius:8px;padding:10px 20px;display:inline-block">
      <span style="color:#c9a84c;font-size:13px;font-weight:700;letter-spacing:1px">Booking Reference: ${bookingRef}</span>
    </div>
  </div>
  <div style="padding:32px">
    <p style="font-size:18px;color:#1a3a2a;margin:0 0 8px">Dear <strong>${name}</strong>,</p>
    <p style="color:#666;line-height:1.7;margin:0 0 24px;font-size:14px">
      Thank you po for choosing Bahay ni Thong! We have received your booking request and will contact you at <strong>${phone}</strong> within 24 hours to finalize your reservation.
    </p>

    <!-- Booking Summary -->
    <div style="background:#f8f9fa;border-radius:10px;padding:20px;margin-bottom:20px;border:1px solid #eee">
      <div style="font-size:12px;font-weight:700;color:#1a3a2a;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px">📋 Booking Summary</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #eee;width:130px">Room</td><td style="padding:8px 0;border-bottom:1px solid #eee"><strong>${room}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #eee">Check-in</td><td style="padding:8px 0;border-bottom:1px solid #eee">${checkin}</td></tr>
        <tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #eee">Check-out</td><td style="padding:8px 0;border-bottom:1px solid #eee">${checkout}</td></tr>
        <tr><td style="padding:8px 0;color:#888;border-bottom:1px solid #eee">Nights</td><td style="padding:8px 0;border-bottom:1px solid #eee">${nights} night/s</td></tr>
        <tr><td style="padding:8px 0;color:#888">Total Amount</td><td style="padding:8px 0"><strong>₱${totalPrice.toLocaleString()}</strong></td></tr>
      </table>
    </div>

    <!-- Downpayment Box -->
    <div style="background:linear-gradient(135deg,#c9a84c,#a8872e);border-radius:10px;padding:24px;text-align:center;margin-bottom:20px">
      <div style="font-size:11px;color:rgba(26,58,42,0.8);letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">Downpayment Required (50%)</div>
      <div style="font-size:40px;font-weight:800;color:#1a3a2a;line-height:1">₱${downpayment.toLocaleString()}</div>
      <div style="font-size:12px;color:rgba(26,58,42,0.7);margin-top:6px">Pay within 24 hours to secure your reservation</div>
    </div>

    <!-- Payment Options -->
    <div style="background:#f8f9fa;border-radius:10px;padding:20px;margin-bottom:20px;border:1px solid #eee">
      <div style="font-size:12px;font-weight:700;color:#1a3a2a;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px">💳 How to Pay</div>

      <!-- GCash with QR -->
      <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:16px;margin-bottom:10px">
        <div style="display:flex;gap:16px;align-items:center">
          <div style="flex:1">
            <div style="font-weight:700;color:#0070ba;font-size:14px;margin-bottom:6px">📱 GCash</div>
            <div style="font-size:24px;font-weight:800;letter-spacing:4px;color:#1a1a1a">${PAY.gcash}</div>
            <div style="font-size:12px;color:#888;margin-top:4px">Account Name: <strong>${PAY.gcashName}</strong></div>
          </div>
          <!-- QR Placeholder -->
          <div style="width:100px;height:100px;background:#f5f5f5;border:2px dashed #c9a84c;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0;text-align:center;padding:8px">
            <div style="font-size:28px">📷</div>
            <div style="font-size:9px;color:#aaa;margin-top:4px;line-height:1.3">Scan to pay<br>via GCash</div>
          </div>
        </div>
      </div>

      <!-- Bank Transfer -->
      <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:16px">
        <div style="font-weight:700;color:#1a3a2a;font-size:14px;margin-bottom:8px">🏦 Bank Transfer</div>
        <div style="font-size:13px;color:#444;line-height:1.8;white-space:pre-line">${PAY.bank}</div>
      </div>
    </div>

    <!-- Warning -->
    <div style="background:#fff8e1;border-left:4px solid #c9a84c;padding:14px 16px;border-radius:0 8px 8px 0;margin-bottom:20px">
      <div style="font-size:13px;color:#856404;line-height:1.6">
        ⚠️ <strong>After payment:</strong> Send your proof of payment (screenshot) via WhatsApp <strong>+63 917 123 4567</strong> or reply to this email. Your reservation will be confirmed upon receipt.
      </div>
    </div>

    <!-- Contact -->
    <div style="text-align:center;padding:16px;background:#f8f9fa;border-radius:8px">
      <p style="margin:0;font-size:13px;color:#666">Questions? Contact us anytime</p>
      <p style="margin:8px 0 0;font-size:14px;color:#1a3a2a">📱 <strong>+63 917 123 4567</strong> &nbsp;·&nbsp; ✉️ <strong>stay@bahayniThong.com</strong></p>
    </div>
  </div>
  <div style="background:#1a3a2a;padding:20px;text-align:center;font-size:11px;color:rgba(245,240,232,0.5);letter-spacing:1px">
    Bahay ni Thong · Lamntang Rd, La Trinidad, Benguet · © 2026
  </div>
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