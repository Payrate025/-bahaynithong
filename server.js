require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const nodemailer = require("nodemailer");
const fs         = require("fs");
const path       = require("path");
const fetch      = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// ─── FILE DATABASE ────────────────────────────────────────
const DB_FILE  = path.join(__dirname, "bookings_db.json");
const PAY_FILE = path.join(__dirname, "payments_db.json");

function loadBookings()  { try { return JSON.parse(fs.readFileSync(DB_FILE,"utf8")); } catch { return []; } }
function loadPayments()  { try { return JSON.parse(fs.readFileSync(PAY_FILE,"utf8")); } catch { return []; } }

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

// ─── PAYMENT INFO (set in .env or edit here directly) ─────
const PAY = {
  gcash:     process.env.GCASH_NUMBER   || "09XX-XXX-XXXX",
  gcashName: process.env.GCASH_NAME     || "Thong Monteflor",
  bank:      process.env.BANK_DETAILS   || "BDO Savings\nAccount Name: Thong Reyes\nAccount No: XXXX-XXXX-XXXX",
  qrImage:   process.env.QR_IMAGE_URL   || "" // optional: link to your GCash QR image
};

// ─── EMAIL SETUP ──────────────────────────────────────────
const mailer = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
});
mailer.verify(err => {
  if (err) console.error("❌ Gmail FAILED:", err.message, "\n   → Check GMAIL_USER + GMAIL_PASS (App Password) in .env");
  else     console.log("✅ Gmail connected:", process.env.GMAIL_USER);
});

// ─── EMAIL TEMPLATES ─────────────────────────────────────
const header = () => `
<div style="background:#1a3a2a;padding:22px 32px">
  <h2 style="color:#c9a84c;margin:0;font-family:Georgia,serif;font-size:22px">🏡 Bahay ni Thong</h2>
  <p style="color:#f5f0e8;margin:4px 0 0;font-size:12px">Heritage Transient House · Baguio City, Philippines</p>
</div>`;

const footer = () => `
<div style="background:#1a3a2a;padding:14px 32px;font-size:12px;color:rgba(245,240,232,0.55);text-align:center">
  Bahay ni Thong · Upper QM, Baguio City · stay@bahayniThong.com · WhatsApp: +63 917 123 4567
</div>`;

const paymentBlock = (downpayment) => `
<div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin:18px 0">
  <p style="margin:0 0 14px;font-weight:700;color:#1a3a2a;font-size:15px">💳 How to Pay Your Downpayment</p>
  <p style="margin:0 0 14px;font-size:13px;color:#555">Please pay <strong style="color:#c9a84c">₱${Number(downpayment).toLocaleString()}</strong> using any of the following:</p>

  <div style="background:#e8f4fd;border-radius:8px;padding:14px;margin-bottom:10px">
    <p style="margin:0;font-weight:700;color:#0070ba;font-size:14px">📱 GCash</p>
    <p style="margin:6px 0 0;font-size:26px;font-weight:800;letter-spacing:3px;color:#333">${PAY.gcash}</p>
    <p style="margin:3px 0 0;font-size:12px;color:#666">Account Name: <strong>${PAY.gcashName}</strong></p>
    ${PAY.qrImage ? `<img src="${PAY.qrImage}" alt="GCash QR" style="width:140px;margin-top:10px;border-radius:6px"/>` : ""}
  </div>

  <div style="background:#f5f5f5;border-radius:8px;padding:14px">
    <p style="margin:0;font-weight:700;color:#333;font-size:14px">🏦 Bank Transfer</p>
    <p style="margin:6px 0 0;font-size:13px;color:#333;white-space:pre-line">${PAY.bank}</p>
  </div>
</div>
<div style="background:#fff3cd;border-radius:8px;padding:13px;font-size:13px;color:#856404;margin-bottom:4px">
  ⚠️ After paying, send your <strong>proof of payment</strong> (screenshot) to our WhatsApp <strong>+63 917 123 4567</strong> or reply to this email to confirm your reservation.
</div>`;

const summaryTable = (b) => `
<table style="width:100%;font-size:14px;border-collapse:collapse">
  ${[
    ["Booking Ref",    `<strong style="color:#c9a84c">${b.bookingRef}</strong>`],
    ["Guest Name",     `<strong>${b.name}</strong>`],
    ["Phone",          b.phone||"—"],
    ["Email",          b.email||"—"],
    ["Room",           b.room],
    ["Check-in",       b.checkin],
    ["Check-out",      b.checkout],
    ["No. of Guests",  b.guests||"—"],
    ["Nights",         String(b.nights)],
    ["Total Amount",   `<strong>₱${Number(b.totalPrice).toLocaleString()}</strong>`],
    ["Downpayment (50%)", `<strong style="color:#c9a84c">₱${Number(b.downpayment).toLocaleString()}</strong>`],
    ["Special Notes",  b.notes||"—"],
  ].map(([l,v])=>`<tr><td style="padding:7px 0;color:#666;width:155px;vertical-align:top">${l}</td><td style="padding:7px 0">${v}</td></tr>`).join("")}
</table>`;

// ─── SYSTEM PROMPT ────────────────────────────────────────
const SYSTEM_PROMPT = `You are "Kuya Thong", the professional AI booking assistant for Bahay ni Thong — a premium heritage transient house in Baguio City, Philippines.

ROOMS: Family Room ₱3,500/night (up to 8 guests) | Smart Lock Master Room ₱4,500/night (up to 4 guests)
LOCATION: Upper QM, Baguio City | WhatsApp: +63 917 123 4567 | stay@bahayniThong.com
POLICIES: 50% downpayment to confirm. Cancellations 48hrs before check-in. No smoking. Pets by arrangement.
LANGUAGE: Auto-detect Filipino/English. PERSONALITY: Professional, warm, 2-5 sentences per reply.
GOAL: Help guests and guide them to book. Encourage the booking form or WhatsApp.`;

// ══════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════
app.get("/", (req, res) => res.send("Bahay ni Thong Server ✅"));

// ── GET all bookings (admin dashboard) ───────────────────
app.get("/bookings", (req, res) => res.json(loadBookings()));

// ── GET all payments (admin dashboard) ───────────────────
app.get("/payments", (req, res) => res.json(loadPayments()));

// ── UPDATE booking status (admin) ────────────────────────
app.post("/bookings/status", (req, res) => {
  const { bookingRef, status } = req.body;
  if (!bookingRef || !status) return res.status(400).json({ ok:false, message:"Missing fields" });
  res.json({ ok:true, bookings: updateBooking(bookingRef, { status }) });
});

// ── DELETE booking (admin) ────────────────────────────────
app.delete("/bookings/:ref", (req, res) => {
  const all = loadBookings().filter(b => b.bookingRef !== req.params.ref);
  fs.writeFileSync(DB_FILE, JSON.stringify(all, null, 2));
  res.json({ ok:true, bookings: all });
});

// ── RECORD PAYMENT (prototype: admin marks payment received) ──
app.post("/payments/record", (req, res) => {
  const { bookingRef, amount, method, note, paidBy } = req.body;
  if (!bookingRef || !amount) return res.status(400).json({ ok:false, message:"Missing bookingRef or amount" });

  const payment = { bookingRef, amount: Number(amount), method: method||"GCash", note: note||"", paidBy: paidBy||"Guest", ts: new Date().toISOString() };
  savePayment(payment);

  // Recalculate total paid for this booking
  const totalPaid = loadPayments().filter(p => p.bookingRef === bookingRef).reduce((s,p) => s+p.amount, 0);
  const bookings  = loadBookings();
  const booking   = bookings.find(b => b.bookingRef === bookingRef);
  const dp        = booking?.downpayment || 0;

  let payStatus = totalPaid === 0 ? "Pending" :
                  totalPaid < dp  ? `Partial Payment (₱${totalPaid.toLocaleString()} / ₱${dp.toLocaleString()})` :
                  totalPaid >= dp ? "Downpayment Received ✅" : "Pending";

  updateBooking(bookingRef, { status: "Confirmed", paymentStatus: payStatus, amountPaid: totalPaid });
  res.json({ ok:true, payment, totalPaid, payStatus });
});

// ── CHAT ─────────────────────────────────────────────────
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

    const r = await fetch("https://api.groq.com/openai/v1/chat/completions",{
      method:"POST",
      headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model:"llama-3.3-70b-versatile", messages, max_tokens:600, temperature:0.65 })
    });
    const d = await r.json();
    if (d?.error) throw new Error(d.error.message);
    res.json({ reply: d?.choices?.[0]?.message?.content || "Please try again po." });
  } catch(err) {
    console.error("Chat:", err.message);
    res.json({ reply:"Unable to respond. Contact us via WhatsApp at +63 917 123 4567 po." });
  }
});

// ── BOOKING (AI + website modal + admin manual) ───────────
app.post("/booking", async (req, res) => {
  try {
    const { name, phone, email, room, checkin, checkout, guests, notes, source } = req.body;
    if (!name||!phone||!checkin||!checkout||!room)
      return res.status(400).json({ ok:false, message:"Missing required fields." });

    const rate        = room.includes("Master") ? 4500 : 3500;
    const nights      = Math.max(1, Math.round((new Date(checkout)-new Date(checkin))/86400000));
    const totalPrice  = rate * nights;
    const downpayment = totalPrice * 0.5;
    const bookingRef  = "BNT-" + Date.now().toString().slice(-6);

    const booking = {
      bookingRef, name, phone:phone||"—", email:email||"", room,
      checkin, checkout, guests:guests||"—", notes:notes||"",
      source:source||"manual", nights, totalPrice, downpayment,
      status:"Pending", paymentStatus:"Awaiting Payment", amountPaid:0,
      ts: new Date().toISOString()
    };
    saveBooking(booking);
    console.log(`📋 Booking saved [${bookingRef}] ${name} via ${source}`);

    // ── Admin email ──
    try {
      await mailer.sendMail({
        from:    `"Bahay ni Thong Bot" <${process.env.GMAIL_USER}>`,
        to:      process.env.GMAIL_USER,
        subject: `📋 New Booking [${bookingRef}] — ${name}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto">
          ${header()}
          <div style="padding:24px 32px;background:#f9f9f9">
            <h3 style="color:#1a3a2a;margin:0 0 16px">New Booking Request — ${source === "ai" ? "🤖 AI Chatbot" : source === "modal" ? "🌐 Website Form" : "👤 Manual"}</h3>
            ${summaryTable(booking)}
            <div style="margin-top:16px;padding:12px 16px;background:#fff3cd;border-radius:6px;font-size:13px;color:#856404">
              ⚠️ Contact the guest within 24 hours. Go to your Admin Dashboard to confirm and send payment request.
            </div>
          </div>
          ${footer()}
        </div>`
      });
      console.log(`✅ Admin email sent [${bookingRef}]`);
    } catch(e) { console.error("⚠️ Admin email failed:", e.message); }

    // ── Guest email (includes payment details) ──
    if (email) {
      try {
        await mailer.sendMail({
          from:    `"Bahay ni Thong" <${process.env.GMAIL_USER}>`,
          to:      email,
          subject: `✅ Booking Received — ${bookingRef} | Bahay ni Thong`,
          html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto">
            ${header()}
            <div style="padding:24px 32px;background:#f9f9f9">
              <p style="font-size:16px;color:#1a3a2a;margin-bottom:4px">Dear <strong>${name}</strong>,</p>
              <p style="color:#444;line-height:1.7;margin-bottom:20px">
                Thank you po for your booking request! We received it and our team will contact you at <strong>${phone}</strong> within 24 hours to finalize your stay.
              </p>

              <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin-bottom:18px">
                <h3 style="color:#1a3a2a;margin:0 0 14px;font-size:15px">📋 Your Booking Summary</h3>
                ${summaryTable(booking)}
              </div>

              <div style="background:#c9a84c;border-radius:8px;padding:20px;text-align:center;margin-bottom:18px">
                <p style="margin:0;color:#1a3a2a;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">Downpayment Required (50% to Confirm)</p>
                <p style="margin:8px 0 0;color:#1a3a2a;font-size:36px;font-weight:800;line-height:1">₱${downpayment.toLocaleString()}</p>
              </div>

              ${paymentBlock(downpayment)}

              <p style="color:#444;font-size:13px;margin-top:16px;line-height:1.8">
                For questions or urgent assistance:<br>
                📱 WhatsApp: <strong>+63 917 123 4567</strong><br>
                ✉️ Email: <strong>stay@bahayniThong.com</strong>
              </p>
            </div>
            ${footer()}
          </div>`
        });
        console.log(`✅ Guest email sent to ${email}`);
      } catch(e) { console.error("⚠️ Guest email failed:", e.message); }
    }

    res.json({ ok:true, bookingRef, nights, totalPrice, downpayment });
  } catch(err) {
    console.error("Booking error:", err.message);
    res.status(500).json({ ok:false, message:err.message });
  }
});

// ── SEND PAYMENT REQUEST (admin → guest) ─────────────────
app.post("/send-payment-request", async (req, res) => {
  try {
    const { guestEmail, guestName, bookingRef, room, checkin, checkout, totalPrice, downpayment } = req.body;
    if (!guestEmail) return res.status(400).json({ ok:false, message:"Guest email required." });

    await mailer.sendMail({
      from:    `"Bahay ni Thong" <${process.env.GMAIL_USER}>`,
      to:      guestEmail,
      subject: `💳 Payment Request — ${bookingRef} | Bahay ni Thong`,
      html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto">
        ${header()}
        <div style="padding:24px 32px;background:#f9f9f9">
          <p style="font-size:16px;color:#1a3a2a">Dear <strong>${guestName}</strong>,</p>
          <p style="color:#444;line-height:1.7;margin-bottom:18px">
            Great news po! Your booking is <strong style="color:#1a3a2a">confirmed</strong>. Please complete your downpayment to fully secure your reservation.
          </p>
          <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:18px;margin-bottom:18px">
            <table style="width:100%;font-size:14px;border-collapse:collapse">
              <tr><td style="padding:6px 0;color:#666;width:140px">Booking Ref</td><td style="font-weight:700;color:#c9a84c">${bookingRef}</td></tr>
              <tr><td style="padding:6px 0;color:#666">Room</td><td>${room}</td></tr>
              <tr><td style="padding:6px 0;color:#666">Check-in</td><td>${checkin}</td></tr>
              <tr><td style="padding:6px 0;color:#666">Check-out</td><td>${checkout}</td></tr>
              <tr><td style="padding:6px 0;color:#666">Total</td><td style="font-weight:700">₱${Number(totalPrice).toLocaleString()}</td></tr>
            </table>
          </div>
          <div style="background:#c9a84c;border-radius:8px;padding:20px;text-align:center;margin-bottom:18px">
            <p style="margin:0;color:#1a3a2a;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">Downpayment Due (50%)</p>
            <p style="margin:8px 0 0;color:#1a3a2a;font-size:36px;font-weight:800">₱${Number(downpayment).toLocaleString()}</p>
          </div>
          ${paymentBlock(downpayment)}
        </div>
        ${footer()}
      </div>`
    });

    updateBooking(bookingRef, { status:"Confirmed - Payment Requested" });
    console.log(`✅ Payment request sent to ${guestEmail} [${bookingRef}]`);
    res.json({ ok:true });
  } catch(err) {
    console.error("Payment email error:", err.message);
    res.status(500).json({ ok:false, message:err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    res.json({ ok: true, token: process.env.ADMIN_TOKEN });
  } else {
    res.status(401).json({ ok: false });
  }
});