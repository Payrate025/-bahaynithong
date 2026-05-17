
// ─── CONFIG ───────────────────────────────────────────────
const AI_SERVER_URL = "http://localhost:3000/chat";

// ─── ELEMENTS ─────────────────────────────────────────────
const toggle   = document.getElementById("aiToggle");
const box      = document.getElementById("aiBox");
const closeBtn = document.getElementById("aiClose");
const minimize = document.getElementById("aiMinimize");
const send     = document.getElementById("aiSend");
const input    = document.getElementById("aiInput");
const messages = document.getElementById("aiMessages");
const badge    = document.getElementById("aiUnreadBadge");
const bfBtn    = document.getElementById("aiBFBtn");
const bfForm   = document.getElementById("aiBookingForm");

// ─── STATE ────────────────────────────────────────────────
let isOpen     = false;
let hasGreeted = false;
let isSending  = false;
let chatHistory = [];
let guestMemory = {}; // remembers name, room preference, etc.

// ─── CHAT LOG (for admin dashboard) ───────────────────────
function logConversation(user, bot) {
  const logs = JSON.parse(localStorage.getItem("chatLogs") || "[]");
  logs.push({ ts: new Date().toISOString(), user, bot, guest: guestMemory.name || "Anonymous" });
  localStorage.setItem("chatLogs", JSON.stringify(logs));
  localStorage.setItem("chatStats", JSON.stringify({
    total: logs.length,
    lastActive: new Date().toISOString(),
    bookingRequests: (JSON.parse(localStorage.getItem("bookingRequests") || "[]")).length
  }));
}

// ─── OPEN / CLOSE ─────────────────────────────────────────
toggle.onclick = () => {
  isOpen = !isOpen;
  box.style.display = isOpen ? "flex" : "none";
  box.style.flexDirection = "column";
  badge.style.display = "none";
  if (isOpen && !hasGreeted) {
    hasGreeted = true;
    setTimeout(() => {
      addMsg("Mabuhay po! 👋 I am Kuya Thong, your dedicated assistant for Bahay ni Thong. I can help you with room inquiries, rates, availability, and reservations. How may I assist you today?", "bot");
    }, 400);
  }
};

closeBtn.onclick = () => { isOpen = false; box.style.display = "none"; };
minimize.onclick = () => { isOpen = false; box.style.display = "none"; };

// ─── ADD MESSAGE ──────────────────────────────────────────
function addMsg(text, type) {
  const msg = document.createElement("div");
  msg.className = "ai-msg " + type;

  // Render line breaks
  text.split("\n").forEach((line, i) => {
    if (i > 0) msg.appendChild(document.createElement("br"));
    msg.appendChild(document.createTextNode(line));
  });

  // Timestamp
  const ts = document.createElement("div");
  ts.className = "ai-msg-time";
  ts.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  msg.appendChild(ts);

  messages.appendChild(msg);
  messages.scrollTop = messages.scrollHeight;
  return msg;
}

// ─── FAQ CHIPS ────────────────────────────────────────────
document.querySelectorAll(".faq-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    input.value = chip.dataset.q;
    sendMessage();
  });
});

// ─── BOOKING FORM ─────────────────────────────────────────
bfBtn.onclick = () => {
  bfForm.style.display = bfForm.style.display === "none" ? "block" : "none";
};
document.getElementById("bf-cancel").onclick = () => {
  bfForm.style.display = "none";
};
document.getElementById("bf-submit").onclick = () => {
  const name     = document.getElementById("bf-name").value.trim();
  const phone    = document.getElementById("bf-phone").value.trim();
  const email    = document.getElementById("bf-email").value.trim();
  const room     = document.getElementById("bf-room").value;
  const checkin  = document.getElementById("bf-checkin").value;
  const checkout = document.getElementById("bf-checkout").value;
  const guests   = document.getElementById("bf-guests").value;
  const notes    = document.getElementById("bf-notes").value.trim();

  if (!name || !phone || !checkin || !checkout) {
    addMsg("Please fill in your name, phone, check-in, and check-out dates po.", "bot");
    return;
  }

  // Save booking request
  const req = { name, phone, email, room, checkin, checkout, guests, notes, ts: new Date().toISOString(), status: "Pending" };
  const reqs = JSON.parse(localStorage.getItem("bookingRequests") || "[]");
  reqs.push(req);
  localStorage.setItem("bookingRequests", JSON.stringify(reqs));

  // Remember guest name
  guestMemory.name = name;
  guestMemory.room = room;

  bfForm.style.display = "none";
  addMsg(`Thank you po, ${name}! ✅ Your booking request for the ${room} (${checkin} → ${checkout}) has been received. Our team will contact you at ${phone} within 24 hours to confirm your reservation.`, "bot");
  logConversation(`[Booking Form] ${room} ${checkin}-${checkout}`, `Booking request received for ${name}`);

  // Reset form
  ["bf-name","bf-phone","bf-email","bf-checkin","bf-checkout","bf-guests","bf-notes"].forEach(id => {
    document.getElementById(id).value = "";
  });
};

// ─── SEND MESSAGE ─────────────────────────────────────────
send.onclick = sendMessage;
input.addEventListener("keypress", e => { if (e.key === "Enter") sendMessage(); });

async function sendMessage() {
  const text = input.value.trim();
  if (!text || isSending) return;

  // Extract guest name from intro messages
  const nameMatch = text.match(/(?:i(?:'| a)m|my name is|ako si|ito si)\s+([A-Z][a-z]+)/i);
  if (nameMatch) guestMemory.name = nameMatch[1];

  isSending = true;
  send.disabled = true;
  input.disabled = true;
  document.getElementById("aiFAQ").style.display = "none";

  addMsg(text, "user");
  input.value = "";

  const typingMsg = addMsg("Typing…", "bot");

  try {
    // Inject memory context into first message if we know the guest
    const memoryNote = guestMemory.name
      ? `\n\n[Guest info remembered: Name = ${guestMemory.name}${guestMemory.room ? ", Interested room = " + guestMemory.room : ""}. Address them by name when appropriate.]`
      : "";

    const res = await fetch(AI_SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        history: chatHistory,
        memoryNote
      })
    });

    if (!res.ok) throw new Error("Server error " + res.status);
    const data = await res.json();
    const reply = data.reply || "I apologize, I was unable to process your request. Please try again or contact us directly.";

    typingMsg.remove();
    addMsg(reply, "bot");
    chatHistory.push([text, reply]);
    logConversation(text, reply);

  } catch (err) {
    typingMsg.remove();
    addMsg("⚠️ I am unable to connect at the moment. Please reach us via WhatsApp at +63 917 123 4567 or email stay@bahayniThong.com.", "bot");
    console.error("Chat error:", err);
  } finally {
    isSending = false;
    send.disabled = false;
    input.disabled = false;
    input.focus();
  }
}

// ─── SHOW UNREAD BADGE after 8s if not opened ─────────────
setTimeout(() => {
  if (!isOpen) {
    badge.style.display = "flex";
  }
}, 8000);
// === CHATBOT END ===
// ═══ INIT ═══
window.addEventListener('load',()=>{
  setTimeout(()=>{
    document.getElementById('loader').classList.add('hidden');
  },2200);
  setMinDates();
  renderCalendar();
  setupReveal();
  animateStats();
});

// ═══ NAVBAR SCROLL ═══
window.addEventListener('scroll',()=>{
  const nav=document.getElementById('mainNav');
  if(window.scrollY>60) nav.classList.add('scrolled');
  else nav.classList.remove('scrolled');
  const st=document.getElementById('scrollTop');
  if(window.scrollY>400) st.classList.add('visible');
  else st.classList.remove('visible');
  updateNavSpy();
});

function updateNavSpy(){
  const sections=['about','rooms','amenities','availability','gallery','contact'];
  const links=document.querySelectorAll('.nav-link');
  let cur='';
  sections.forEach(id=>{
    const el=document.getElementById(id);
    if(el && window.scrollY>=el.offsetTop-120) cur=id;
  });
  links.forEach(l=>{
    l.classList.remove('active');
    if(l.getAttribute('href')==='#'+cur) l.classList.add('active');
  });
}

// ═══ MOBILE MENU ═══
document.getElementById('hamburger').addEventListener('click',()=>{
  document.getElementById('mobileMenu').classList.add('open');
  document.body.style.overflow='hidden';
});
document.getElementById('mobileClose').addEventListener('click',closeMobile);
function closeMobile(){
  document.getElementById('mobileMenu').classList.remove('open');
  document.body.style.overflow='';
}

// ═══ DARK MODE ═══
const darkBtn=document.getElementById('darkToggle');
darkBtn.addEventListener('click',()=>{
  document.body.classList.toggle('dark-mode');
  darkBtn.textContent=document.body.classList.contains('dark-mode')?'☀️':'🌙';
});

// ═══ REVEAL ON SCROLL ═══
function setupReveal(){
  const els=document.querySelectorAll('.reveal');
  const obs=new IntersectionObserver((entries)=>{
    entries.forEach(e=>{if(e.isIntersecting) e.target.classList.add('visible')});
  },{threshold:0.1});
  els.forEach(el=>obs.observe(el));
}

// ═══ STATS COUNTER ═══
function animateStats(){
  const nums=document.querySelectorAll('.stat-num');
  const obs=new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      if(e.isIntersecting){
        const target=parseInt(e.target.dataset.count);
        let cur=0;
        const step=target/60;
        const timer=setInterval(()=>{
          cur=Math.min(cur+step,target);
          e.target.textContent=Math.floor(cur)+(e.target.dataset.count=='98'?'%':'+');
          if(cur>=target){clearInterval(timer);e.target.textContent=target+(target==98?'%':'+')}
        },25);
        obs.unobserve(e.target);
      }
    });
  },{threshold:0.5});
  nums.forEach(n=>obs.observe(n));
}

// ═══ IMAGE SLIDER ═══
const sliderState={slider1:{idx:0,total:3},slider2:{idx:0,total:3}};
function slideRoom(id,dir){
  const s=sliderState[id];
  if(dir==='next') s.idx=(s.idx+1)%s.total;
  else s.idx=(s.idx-1+s.total)%s.total;
  document.getElementById(id).style.transform=`translateX(-${s.idx*100}%)`;
  const dotsId=id.replace('slider','dots');
  document.querySelectorAll(`#${dotsId} .slider-dot`).forEach((d,i)=>{
    d.classList.toggle('active',i===s.idx);
  });
}
function goToSlide(sid,did,idx){
  sliderState[sid].idx=idx;
  document.getElementById(sid).style.transform=`translateX(-${idx*100}%)`;
  document.querySelectorAll(`#${did} .slider-dot`).forEach((d,i)=>d.classList.toggle('active',i===idx));
}

// ═══ ENHANCED TESTIMONIAL CAROUSEL ═══
const REVIEWS = [
  { name:"Lebron James",    initials:"LJ", loc:"Manila, Philippines",   room:"Talisay — 2nd Floor Family Room", nights:3, rating:5, text:"Absolutely enchanting stay. The pine-scented air, the warm wooden interiors — we felt like we were in a fairytale cabin. Will definitely come back!" },
  { name:"Kobe Bryant",     initials:"KB", loc:"Quezon City, Philippines",room:"Hauili — 1st Floor Family Room",   nights:4, rating:5, text:"Perfect for our family reunion. The Family Room fit all 8 of us comfortably. The hosts were incredibly responsive and the location is ideal." },
  { name:"Michael Jordan",  initials:"MJ", loc:"Chicago, USA",           room:"Salong — 2nd Floor Master Bedroom",nights:2, rating:5, text:"The Smart Lock Master Room exceeded all expectations. Modern, clean, and the mountain breeze is unbeatable. Highly recommended for couples!" },
  { name:"Adolfo & Cerezo", initials:"AC", loc:"Cebu, Philippines",      room:"Odorata — 1st Floor Master Bedroom",nights:5,rating:5, text:"We celebrated our anniversary here and it was magical. The heritage aesthetic with modern comforts is a perfect balance. Bahay ni Thong is a gem!" },
];

let testiIdx = 0;
let testiTimer = null;

function renderTestimonials(){
  const thumbs = document.getElementById('testiThumbs');
  const dots   = document.getElementById('testiDots');
  if(!thumbs||!dots) return;

  thumbs.innerHTML = REVIEWS.map((r,i)=>`
    <div class="testi-thumb${i===0?' active':''}" onclick="goToTesti(${i})" title="${r.name}">${r.initials}</div>
  `).join('');

  dots.innerHTML = REVIEWS.map((_,i)=>`
    <div class="testi-dot${i===0?' active':''}" onclick="goToTesti(${i})"></div>
  `).join('');

  showTesti(0);
  startTestiAuto();
}

function showTesti(idx){
  const r = REVIEWS[idx];
  const stars = '★'.repeat(r.rating) + '☆'.repeat(5-r.rating);
  const featured = document.getElementById('testiFeatured');
  if(featured) featured.style.opacity='0';

  setTimeout(()=>{
    document.getElementById('testiStars').textContent  = stars;
    document.getElementById('testiText').textContent   = r.text;
    document.getElementById('testiAuthor').textContent = r.name;
    document.getElementById('testiLoc').textContent    = '📍 '+r.loc;
    document.getElementById('testiRoom').textContent   = '🛏️ '+r.room+' · '+r.nights+' nights';
    document.getElementById('testiAvatar').textContent = r.initials;
    if(featured) featured.style.opacity='1';
  }, 250);

  document.querySelectorAll('.testi-thumb').forEach((t,i)=>t.classList.toggle('active',i===idx));
  document.querySelectorAll('.testi-dot').forEach((d,i) =>d.classList.toggle('active',i===idx));
  testiIdx = idx;
}

function goToTesti(idx){ clearTestiAuto(); showTesti(idx); startTestiAuto(); }
function moveTesti(dir){ goToTesti((testiIdx+dir+REVIEWS.length)%REVIEWS.length); }

function startTestiAuto(){
  clearTestiAuto();
  testiTimer = setInterval(()=>showTesti((testiIdx+1)%REVIEWS.length), 5000);
}
function clearTestiAuto(){ if(testiTimer){ clearInterval(testiTimer); testiTimer=null; } }

// ─── REVIEW FORM ─────────────────────────────────────────
let selectedRating = 0;

document.addEventListener('DOMContentLoaded',()=>{
  renderTestimonials();

  // Star selector
  const stars = document.querySelectorAll('.star-pick');
  stars.forEach(s=>{
    s.addEventListener('mouseover',()=>{
      const v=parseInt(s.dataset.val);
      stars.forEach((x,i)=>x.classList.toggle('active',i<v));
    });
    s.addEventListener('mouseout',()=>{
      stars.forEach((x,i)=>x.classList.toggle('active',i<selectedRating));
    });
    s.addEventListener('click',()=>{
      selectedRating=parseInt(s.dataset.val);
      document.getElementById('rv-rating').value=selectedRating;
      stars.forEach((x,i)=>x.classList.toggle('active',i<selectedRating));
      updatePreview();
    });
  });
});

function updatePreview(){
  const name   = document.getElementById('rv-name')?.value.trim()||'';
  const text   = document.getElementById('rv-review')?.value.trim()||'';
  const preview= document.getElementById('reviewPreview');
  if(!preview) return;
  if(!name&&!text){ preview.style.display='none'; return; }
  preview.style.display='block';
  document.getElementById('previewStars').textContent = '★'.repeat(selectedRating||5)+'☆'.repeat(5-(selectedRating||5));
  document.getElementById('previewText').textContent  = text||'Your review will appear here...';
  document.getElementById('previewAuthor').textContent= '— '+(name||'Your Name');
}

function handleFileUpload(input){
  const label = document.getElementById('fileLabel');
  if(input.files&&input.files[0]) label.textContent='📷 '+input.files[0].name;
}

function submitReview(e){
  e.preventDefault();
  const name   = document.getElementById('rv-name').value.trim();
  const rating = parseInt(document.getElementById('rv-rating').value)||0;
  if(rating===0){ alert('Please select a star rating po.'); return; }

  // Save to localStorage
  const reviews = JSON.parse(localStorage.getItem('guestReviews')||'[]');
  reviews.push({
    name, rating,
    email:    document.getElementById('rv-email').value,
    room:     document.getElementById('rv-room').value,
    loc:      document.getElementById('rv-loc').value,
    checkin:  document.getElementById('rv-checkin').value,
    checkout: document.getElementById('rv-checkout').value,
    text:     document.getElementById('rv-review').value.trim(),
    ts:       new Date().toISOString()
  });
  localStorage.setItem('guestReviews', JSON.stringify(reviews));

  document.getElementById('reviewForm').style.display='none';
  document.getElementById('reviewSuccess').style.display='block';
  document.getElementById('reviewPreview').style.display='none';
}

function resetReviewForm(){
  document.getElementById('reviewForm').style.display='block';
  document.getElementById('reviewForm').reset();
  document.getElementById('reviewSuccess').style.display='none';
  selectedRating=0;
  document.querySelectorAll('.star-pick').forEach(s=>s.classList.remove('active'));
}

// ═══ ENHANCED CALENDAR WITH ROOM COLORS ═══
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth();
let calFilter= 'all';
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ── Room definitions ─────────────────────────────────────
const ROOMS = {
  talisay: { name:'Talisay',  label:'2nd Floor Family Room',   color:'#5C8A5C', guests:8,  price:'₱4,500' },
  hauili:  { name:'Hauili',   label:'1st Floor Family Room',   color:'#4A7A8A', guests:8,  price:'₱4,500' },
  salong:  { name:'Salong',   label:'2nd Floor Master Bedroom', color:'#8A6A3A', guests:4,  price:'₱6,000' },
  odorata: { name:'Odorata',  label:'1st Floor Master Bedroom', color:'#8A4A6A', guests:4,  price:'₱6,000' },
};

// ── Demo booking data per room ────────────────────────────
const roomBookings = {
  talisay: {
    booked:  ['2026-05-15','2026-05-16','2026-05-17','2026-05-18','2026-06-10','2026-06-11'],
    pending: ['2026-05-22','2026-05-23','2026-06-20'],
    maintenance: []
  },
  hauili: {
    booked:  ['2026-05-10','2026-05-11','2026-05-12','2026-06-05','2026-06-06','2026-06-07'],
    pending: ['2026-05-25','2026-06-15'],
    maintenance: ['2026-05-20']
  },
  salong: {
    booked:  ['2026-05-14','2026-05-15','2026-05-16','2026-06-08','2026-06-09'],
    pending: ['2026-05-28','2026-05-29','2026-06-22'],
    maintenance: []
  },
  odorata: {
    booked:  ['2026-05-18','2026-05-19','2026-05-20','2026-06-12','2026-06-13'],
    pending: ['2026-05-30','2026-06-18','2026-06-19'],
    maintenance: ['2026-06-01']
  }
};

// Merge with server bookings
const bookedDates  = { all:[], family:[], master:[], talisay:[], hauili:[], salong:[], odorata:[] };
const pendingDates = { all:[], family:[], master:[], talisay:[], hauili:[], salong:[], odorata:[] };

function setRoomFilter(room, el){
  calFilter = room;
  document.querySelectorAll('.room-tab').forEach(t=>t.classList.remove('active'));
  if(el) el.classList.add('active');

  // Update room info bar
  const bar = document.getElementById('roomInfoContent');
  if(bar){
    if(room==='all'){
      bar.innerHTML='<span class="room-info-name">All Rooms</span><span class="room-info-detail">Showing combined availability for all 4 rooms</span>';
    } else {
      const r = ROOMS[room];
      bar.innerHTML=`
        <div class="room-dot" style="width:12px;height:12px;background:${r.color};border-radius:50%;flex-shrink:0"></div>
        <span class="room-info-name">${r.name}</span>
        <span class="room-info-detail">${r.label} · Up to ${r.guests} guests · ${r.price}/night</span>
        <span class="room-info-badge">Select Room</span>`;
    }
  }
  renderCalendar();
}

function getDateStatus(dateStr, room){
  // Returns: {status, rooms:[]}
  if(room && room!=='all'){
    const d = roomBookings[room];
    if(!d) return { status:'available', rooms:[] };
    if(d.maintenance?.includes(dateStr)) return { status:'maintenance', rooms:[room] };
    if(d.booked?.includes(dateStr))      return { status:'booked',      rooms:[room] };
    if(d.pending?.includes(dateStr))     return { status:'pending',     rooms:[room] };

    // Check server bookings too
    if(bookedDates[room]?.includes(dateStr))  return { status:'booked',  rooms:[room] };
    if(pendingDates[room]?.includes(dateStr)) return { status:'pending', rooms:[room] };
    return { status:'available', rooms:[] };
  }

  // All rooms — collect which rooms are booked on this day
  const bookedRooms=[], pendingRooms=[], maintRooms=[];
  Object.keys(ROOMS).forEach(r=>{
    const d = roomBookings[r];
    if(d?.maintenance?.includes(dateStr)) maintRooms.push(r);
    else if(d?.booked?.includes(dateStr)||bookedDates[r]?.includes(dateStr)||bookedDates.all?.includes(dateStr)) bookedRooms.push(r);
    else if(d?.pending?.includes(dateStr)||pendingDates[r]?.includes(dateStr)||pendingDates.all?.includes(dateStr)) pendingRooms.push(r);
  });

  const totalRooms = Object.keys(ROOMS).length;
  if(maintRooms.length===totalRooms) return { status:'maintenance', rooms:maintRooms };
  if(bookedRooms.length===totalRooms) return { status:'booked', rooms:bookedRooms };
  if(bookedRooms.length>0||pendingRooms.length>0) return { status:'partial', rooms:bookedRooms, pendingRooms };
  return { status:'available', rooms:[] };
}

function renderCalendar(){
  document.getElementById('calMonthLabel').textContent=`${MONTHS[calMonth]} ${calYear}`;
  const body=document.getElementById('calBody');
  body.innerHTML='';

  const firstDay    = new Date(calYear,calMonth,1).getDay();
  const daysInMonth = new Date(calYear,calMonth+1,0).getDate();
  const today       = new Date();
  const todayStr    = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  for(let i=0;i<firstDay;i++){
    const c=document.createElement('div');
    c.className='cal-cell empty';
    body.appendChild(c);
  }

  for(let d=1;d<=daysInMonth;d++){
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const cell    = document.createElement('div');
    const isPast  = new Date(dateStr) < new Date(todayStr);

    const { status, rooms, pendingRooms } = getDateStatus(dateStr, calFilter==='all'?null:calFilter);

    let cls = 'cal-cell';
    if(dateStr===todayStr)  cls+=' today';
    else if(isPast)         cls+=' past';
    else if(status==='booked')      cls+=' booked';
    else if(status==='pending')     cls+=' pending';
    else if(status==='maintenance') cls+=' maintenance';
    else if(status==='partial')     cls+=' partial';
    else                            cls+=' available';

    if(isPast) { cls+=' past'; }
    cell.className=cls;

    // Date number
    const dateEl=document.createElement('div');
    dateEl.className='cal-date';
    dateEl.textContent=d;
    cell.appendChild(dateEl);

    // Status dot
    const dot=document.createElement('div');
    dot.className='cal-dot';
    cell.appendChild(dot);

    // Room color dots (only on "all" view)
    if(calFilter==='all' && !isPast && dateStr!==todayStr){
      const dotsRow = document.createElement('div');
      dotsRow.className='room-dots-row';
      Object.keys(ROOMS).forEach(r=>{
        const d2=roomBookings[r];
        const isBooked = d2?.booked?.includes(dateStr)||bookedDates[r]?.includes(dateStr);
        const isPend   = d2?.pending?.includes(dateStr)||pendingDates[r]?.includes(dateStr);
        if(isBooked||isPend){
          const rd=document.createElement('div');
          rd.className=`room-dot dot-${r}`;
          rd.style.opacity=isBooked?'1':'0.6';
          dotsRow.appendChild(rd);
        }
      });
      if(dotsRow.children.length>0) cell.appendChild(dotsRow);
    }

    // Tooltip
    cell.addEventListener('mouseenter', (e)=>showCalTooltip(e, dateStr, d, status, rooms||[], pendingRooms||[]));
    cell.addEventListener('mousemove',  (e)=>positionTooltip(e));
    cell.addEventListener('mouseleave', hideCalTooltip);

    // Click to book
    if(!isPast && status!=='booked' && status!=='maintenance'){
      cell.addEventListener('click',()=>{
        openBooking();
        const ci=document.getElementById('checkIn');
        if(ci) ci.value=dateStr;
      });
    }

    body.appendChild(cell);
  }
}

// ── Tooltip ───────────────────────────────────────────────
function showCalTooltip(e, dateStr, day, status, bookedRooms, pendingRooms){
  const tt = document.getElementById('calTooltip');
  if(!tt) return;

  const date = new Date(dateStr);
  const label= date.toLocaleDateString('en-PH',{weekday:'short',month:'long',day:'numeric'});

  let rows='';
  if(calFilter==='all'){
    Object.keys(ROOMS).forEach(r=>{
      const rm=ROOMS[r];
      const isBooked  = roomBookings[r]?.booked?.includes(dateStr)||bookedDates[r]?.includes(dateStr);
      const isPending = roomBookings[r]?.pending?.includes(dateStr)||pendingDates[r]?.includes(dateStr);
      const isMaint   = roomBookings[r]?.maintenance?.includes(dateStr);
      const st   = isMaint?'maintenance':isBooked?'booked':isPending?'pending':'available';
      const stLbl= isMaint?'Maintenance':isBooked?'Booked':isPending?'Pending':'Available';
      const stCls= `ts-${st==='maintenance'?'booked':st}`;
      rows+=`<div class="tooltip-room">
        <div class="room-dot dot-${r}" style="width:8px;height:8px"></div>
        <span>${rm.name}</span>
        <span class="tooltip-status ${stCls}">${stLbl}</span>
      </div>`;
    });
  } else {
    const rm=ROOMS[calFilter];
    if(rm){
      const stLbl=status==='booked'?'Booked':status==='pending'?'Pending':status==='maintenance'?'Maintenance':'Available';
      const stCls=`ts-${status==='maintenance'?'booked':status}`;
      rows+=`<div class="tooltip-room">
        <div class="room-dot dot-${calFilter}" style="width:8px;height:8px"></div>
        <span>${rm.name} — ${rm.label}</span>
        <span class="tooltip-status ${stCls}">${stLbl}</span>
      </div>`;
      rows+=`<div style="font-size:11px;opacity:.5;margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.07)">${rm.guests} guests max · ${rm.price}/night</div>`;
    }
  }

  tt.innerHTML=`<div class="tooltip-date">${label}</div>${rows}`;
  tt.style.display='block';
  positionTooltip(e);
}

function positionTooltip(e){
  const tt=document.getElementById('calTooltip');
  if(!tt||tt.style.display==='none') return;
  const x=e.clientX+14, y=e.clientY-10;
  const w=tt.offsetWidth, h=tt.offsetHeight;
  tt.style.left=(x+w>window.innerWidth?e.clientX-w-14:x)+'px';
  tt.style.top=(y+h>window.innerHeight?e.clientY-h-10:y)+'px';
}

function hideCalTooltip(){
  const tt=document.getElementById('calTooltip');
  if(tt) tt.style.display='none';
}

function changeMonth(dir){
  calMonth+=dir;
  if(calMonth>11){calMonth=0;calYear++}
  if(calMonth<0){calMonth=11;calYear--}
  renderCalendar();
}

// ── Load from server ──────────────────────────────────────
function getDatesInRange(start,end){
  const dates=[]; let cur=new Date(start); const e2=new Date(end);
  while(cur<e2){ dates.push(cur.toISOString().split('T')[0]); cur.setDate(cur.getDate()+1); }
  return dates;
}

async function loadBookedDatesFromServer(){
  try{
    const res  = await fetch('http://localhost:3000/bookings');
    const data = await res.json();
    data.forEach(b=>{
      if(!b.checkin||!b.checkout) return;
      const dates  = getDatesInRange(b.checkin,b.checkout);
      const status = (b.status||'').toLowerCase();
      const room   = (b.room||'').toLowerCase();
      const roomKey= room.includes('talisay')?'talisay':room.includes('hauili')?'hauili':room.includes('salong')?'salong':room.includes('odorata')?'odorata':room.includes('master')?'salong':'talisay';
      dates.forEach(d=>{
        if(status.includes('confirm')||status.includes('downpayment')){
          if(!bookedDates[roomKey].includes(d)) bookedDates[roomKey].push(d);
          if(!bookedDates.all.includes(d)) bookedDates.all.push(d);
        } else {
          if(!pendingDates[roomKey].includes(d)) pendingDates[roomKey].push(d);
          if(!pendingDates.all.includes(d)) pendingDates.all.push(d);
        }
      });
    });
    renderCalendar();
  } catch(e){ /* server offline */ }
}
loadBookedDatesFromServer();

// Past cell style
const styleTag=document.createElement('style');
styleTag.textContent='.cal-cell.past{opacity:0.3;cursor:default;pointer-events:none}';
document.head.appendChild(styleTag);

// ═══ BOOKING MODAL ═══
function openBooking(room=''){
  document.getElementById('bookingModal').classList.add('open');
  document.body.style.overflow='hidden';
  if(room){
    const sel=document.getElementById('modalRoom');
    for(let i=0;i<sel.options.length;i++){
      if(sel.options[i].value===room){sel.selectedIndex=i;break}
    }
  }
}
function closeBooking(){
  document.getElementById('bookingModal').classList.remove('open');
  document.body.style.overflow='';
}
document.getElementById('bookingModal').addEventListener('click',function(e){
  if(e.target===this) closeBooking();
});

function setMinDates(){
  const today=new Date().toISOString().split('T')[0];
  const ci=document.getElementById('checkIn');
  const co=document.getElementById('checkOut');
  if(ci) ci.min=today;
  if(co) co.min=today;
}

function calcPrice(){
  const room=document.getElementById('modalRoom').value;
  const ci=document.getElementById('checkIn').value;
  const co=document.getElementById('checkOut').value;
  const summary=document.getElementById('priceSummary');
  if(!ci||!co) return;
  const nights=Math.max(0,Math.round((new Date(co)-new Date(ci))/(1000*60*60*24)));
  if(nights<=0){summary.style.display='none';return}
  const rate=room.includes('Master')?4500:3500;
  const sub=rate*nights;
  const down=sub*0.5;
  document.getElementById('priceRate').textContent=`₱${rate.toLocaleString()}/night`;
  document.getElementById('priceNights').textContent=nights;
  document.getElementById('priceSub').textContent=`₱${sub.toLocaleString()}`;
  document.getElementById('priceTotal').textContent=`₱${sub.toLocaleString()}`;
  document.getElementById('priceDown').textContent=`₱${down.toLocaleString()}`;
  summary.style.display='block';
}
document.getElementById('checkIn').addEventListener('change',function(){
  const co=document.getElementById('checkOut');
  if(co.value && co.value<=this.value){
    const next=new Date(this.value);next.setDate(next.getDate()+1);
    co.value=next.toISOString().split('T')[0];
  }
  calcPrice();
});

async function submitBooking(e){
  e.preventDefault();

  const firstname = document.getElementById('bm-firstname')?.value.trim() || '';
  const lastname  = document.getElementById('bm-lastname')?.value.trim()  || '';
  const name      = (firstname + ' ' + lastname).trim();
  const email     = document.getElementById('bm-email')?.value.trim()     || '';
  const phone     = document.getElementById('bm-phone')?.value.trim()     || '';
  const room      = document.getElementById('modalRoom')?.value            || '';
  const checkin   = document.getElementById('checkIn')?.value              || '';
  const checkout  = document.getElementById('checkOut')?.value             || '';
  const guests    = document.getElementById('numGuests')?.value            || '';
  const notes     = document.getElementById('bm-notes')?.value.trim()     || '';

  const btn = document.getElementById('bookingSubmitBtn');
  if(btn){ btn.disabled=true; btn.textContent='Submitting...'; }

  try {
    const res  = await fetch('https://bahaynithong.onrender.com/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, room, checkin, checkout, guests, notes, source:'modal' })
    });
    const data = await res.json();

    if(data.ok){
      // Update calendar
      if(typeof getDatesInRange === 'function'){
        getDatesInRange(checkin, checkout).forEach(d => {
          if(!bookedDates.all.includes(d)) bookedDates.all.push(d);
        });
        if(typeof renderCalendar === 'function') renderCalendar();
      }
      // Update confirm screen
      const confirmMsg = document.getElementById('confirmMsg');
      if(confirmMsg){
        confirmMsg.innerHTML = `Thank you po, <strong>${name}</strong>! Your booking has been received.<br>
          ${email ? `Confirmation email with payment details sent to <strong>${email}</strong>.` : `Our team will contact you at <strong>${phone}</strong> within 24 hours.`}`;
      }
      const confirmDetails = document.getElementById('confirmDetails');
      if(confirmDetails){
        confirmDetails.style.display='block';
        document.getElementById('confirmRef').textContent      = data.bookingRef||'—';
        document.getElementById('confirmRoom').textContent     = room;
        document.getElementById('confirmCheckin').textContent  = checkin;
        document.getElementById('confirmCheckout').textContent = checkout;
        document.getElementById('confirmNights').textContent   = (data.nights||'?')+' night/s';
        document.getElementById('confirmTotal').textContent    = '₱'+Number(data.totalPrice||0).toLocaleString();
        document.getElementById('confirmDP').textContent       = '₱'+Number(data.downpayment||0).toLocaleString()+' (50% required)';
      }
    } else {
      throw new Error(data.message||'Server error');
    }
  } catch(err){
    console.warn('Booking error:', err.message);
  } finally {
    if(btn){ btn.disabled=false; btn.textContent='✦ Confirm Reservation'; }
    closeBooking();
    document.getElementById('confirmScreen').classList.add('open');
  }
}
function closeConfirm(){
  document.getElementById('confirmScreen').classList.remove('open');
}

// ═══ GALLERY LIGHTBOX ═══
const galleryImgs=[
  'Thong/IMG_20260210_153001.jpg',
  'Thong/IMG_20260210_153537.jpg',
  'Thong/IMG_20260210_153919.jpg',
  'Thong/IMG_20260210_155403.jpg',
  'Thong/IMG_20260210_153406.jpg',
  'Thong/IMG_20260210_153911.jpg'
];
let lbIdx=0;
function openLightbox(idx){
  lbIdx=idx;
  document.getElementById('lbImg').src=galleryImgs[lbIdx];
  document.getElementById('lightbox').classList.add('open');
  document.body.style.overflow='hidden';
}
function closeLightbox(){
  document.getElementById('lightbox').classList.remove('open');
  document.body.style.overflow='';
}
function lbNav(dir){
  lbIdx=(lbIdx+dir+galleryImgs.length)%galleryImgs.length;
  document.getElementById('lbImg').src=galleryImgs[lbIdx];
}
document.getElementById('lightbox').addEventListener('click',function(e){
  if(e.target===this) closeLightbox();
});

// ═══ CONTACT ═══
function copyEmail(){
  navigator.clipboard.writeText('stay@bahayniThong.com').then(()=>{
    const btn=event.target;
    btn.textContent='✓ Copied!';
    setTimeout(()=>btn.textContent='📋 Copy Email',2000);
  });
}
function sendContactForm(e){
  e.preventDefault();
  e.target.reset();
  alert('✅ Message sent! We\'ll get back to you within 24 hours.');
}

// ═══ ADMIN PANEL ═══
function adminLogin(){
  const u=document.getElementById('adminUser').value;
  const p=document.getElementById('adminPass').value;
  if(u==='admin'&&p==='admin123'){
    document.getElementById('adminLogin').style.display='none';
    document.getElementById('adminDash').style.display='block';
  } else {
    alert('❌ Invalid credentials. Try admin / admin123');
  }
}
function adminLogout(){
  document.getElementById('adminLogin').style.display='block';
  document.getElementById('adminDash').style.display='none';
}
function showAdminTab(name,btn){
  ['reservations','rooms','rates','dates'].forEach(t=>{
    const el=document.getElementById('tab-'+t);
    if(el) el.style.display=t===name?'block':'none';
  });
  document.querySelectorAll('.admin-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
}
function downloadCSV(){
  const rows=[['ID','Guest','Room','Check-In','Check-Out','Guests','Total','Status'],
    ['BNT-001','Maria Santos','Family Room','2025-02-20','2025-02-22','6','7000','Confirmed'],
    ['BNT-002','James Reyes','Master Room','2025-02-25','2025-02-27','2','9000','Pending'],
    ['BNT-003','Chloe Tan','Family Room','2025-03-01','2025-03-03','4','7000','Confirmed']
  ];
  const csv=rows.map(r=>r.join(',')).join('\n');
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download='bahay-ni-thong-reservations.csv';
  a.click();
}
function clearAll(){
  if(confirm('Clear all demo reservations?')) document.getElementById('adminTableBody').innerHTML='<tr><td colspan="8" style="text-align:center;padding:2rem;color:rgba(245,241,232,0.3)">No reservations found</td></tr>';
}
function toggleRoom(room,el){
  console.log(`${room} is now ${el.checked?'available':'unavailable'}`);
}

// ═══ KEYBOARD ESCAPE ═══
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    closeBooking();
    closeLightbox();
    closeConfirm();
    closeMobile();
  }
});s