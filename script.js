
// ─── CONFIG ───────────────────────────────────────────────
const AI_SERVER_URL = "https://bahaynithong-production.up.railway.app/chat";

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

// ═══ TESTIMONIAL CAROUSEL ═══
let testiPos=0;
function scrollTesti(dir){
  const track=document.getElementById('testiTrack');
  const cards=track.querySelectorAll('.testi-card');
  const cardW=cards[0].offsetWidth+24;
  const max=cards.length-2;
  testiPos=Math.max(0,Math.min(testiPos+dir,max));
  track.style.transform=`translateX(-${testiPos*cardW}px)`;
}

// ═══ CALENDAR ═══
let calYear=new Date().getFullYear();
let calMonth=new Date().getMonth();
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];

// Demo booked/pending dates
const bookedDates={
  'all':['2026-02-15','2026-02-16','2026-02-17','2026-03-05','2026-03-06'],
  'family':['2026-02-18','2026-02-19','2026-03-10'],
  'master':['2026-02-22','2026-02-23','2026-03-15']
};
const pendingDates={
  'all':['2026-02-25','2026-03-01'],
  'family':['2026-02-27'],
  'master':['2026-02-28']
};

function renderCalendar(){
  document.getElementById('calMonthLabel').textContent=`${MONTHS[calMonth]} ${calYear}`;
  const body=document.getElementById('calBody');
  body.innerHTML='';
  const filter=document.getElementById('roomFilter').value;
  const allBooked=[...(bookedDates['all']||[]),...(bookedDates[filter]||[])];
  const allPending=[...(pendingDates['all']||[]),...(pendingDates[filter]||[])];

  const firstDay=new Date(calYear,calMonth,1).getDay();
  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  const today=new Date();
  const todayStr=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  // Empty cells
  for(let i=0;i<firstDay;i++){
    const cell=document.createElement('div');
    cell.className='cal-cell empty';
    body.appendChild(cell);
  }
  // Day cells
  for(let d=1;d<=daysInMonth;d++){
    const dateStr=`${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const cell=document.createElement('div');
    let cls='cal-cell';
    if(dateStr===todayStr) cls+=' today';
    else if(allBooked.includes(dateStr)) cls+=' booked';
    else if(allPending.includes(dateStr)) cls+=' pending';
    else cls+=' available';
    cell.className=cls;

    const dateEl=document.createElement('div');
    dateEl.className='cal-date';
    dateEl.textContent=d;
    cell.appendChild(dateEl);

    if(!cell.classList.contains('empty')){
      const dot=document.createElement('div');
      dot.className='cal-dot';
      cell.appendChild(dot);
      cell.title=allBooked.includes(dateStr)?'Booked':allPending.includes(dateStr)?'Pending':'Available';
    }
    body.appendChild(cell);
  }
}
function changeMonth(dir){
  calMonth+=dir;
  if(calMonth>11){calMonth=0;calYear++}
  if(calMonth<0){calMonth=11;calYear--}
  renderCalendar();
}

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

function submitBooking(e){
  e.preventDefault();
  closeBooking();
  document.getElementById('confirmScreen').classList.add('open');
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