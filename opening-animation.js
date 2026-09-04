/* STATE 3475 — Opening Animation
   2.5 seconds, shown on every page refresh.
   Overlay only: does not alter the original page layout.
*/
(function () {
  "use strict";

  const STYLE_ID = "state-3475-opening-style";
  const OVERLAY_ID = "state-3475-opening";

  function addStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID}{
        position:fixed; inset:0; z-index:2147483647;
        display:flex; align-items:center; justify-content:center;
        overflow:hidden; background:#070707;
        opacity:1; visibility:visible;
        transition:opacity .45s ease, visibility .45s ease;
      }
      #${OVERLAY_ID}.is-hidden{opacity:0;visibility:hidden;pointer-events:none}
      #${OVERLAY_ID} .s3475-glow{
        position:absolute;width:260px;height:260px;border-radius:50%;
        background:radial-gradient(circle,rgba(255,164,45,.28) 0%,rgba(255,102,0,.12) 32%,transparent 70%);
        filter:blur(10px);animation:s3475Pulse 1.7s ease-in-out infinite;
      }
      #${OVERLAY_ID} .s3475-ring{
        position:absolute;width:170px;height:170px;border-radius:50%;
        border:1px solid rgba(255,170,60,.5);
        box-shadow:0 0 30px rgba(255,125,20,.22),inset 0 0 25px rgba(255,125,20,.08);
        animation:s3475Ring 2.2s cubic-bezier(.2,.7,.2,1) forwards;
      }
      #${OVERLAY_ID} .s3475-content{
        position:relative;text-align:center;color:#fff;
        font-family:Arial,Helvetica,sans-serif;
        animation:s3475Content 1.65s cubic-bezier(.2,.75,.2,1) both;
      }
      #${OVERLAY_ID} .s3475-number{
        margin:0; font-size:clamp(64px,16vw,150px); line-height:.85;
        font-weight:900; letter-spacing:.06em;
        color:#fff;
        text-shadow:0 0 7px #fff,0 0 22px rgba(255,174,64,.95),0 0 55px rgba(255,91,0,.75);
      }
      #${OVERLAY_ID} .s3475-title{
        margin-top:18px;font-size:clamp(20px,4vw,38px);
        font-weight:800;letter-spacing:.34em;
        text-indent:.34em;color:#f6f6f6;
        text-shadow:0 0 16px rgba(255,145,40,.65);
      }
      #${OVERLAY_ID} .s3475-line{
        width:0;height:2px;margin:20px auto 0;
        background:linear-gradient(90deg,transparent,#ff9b32,transparent);
        box-shadow:0 0 12px rgba(255,130,20,.8);
        animation:s3475Line 1.35s .35s ease forwards;
      }
      #${OVERLAY_ID} .s3475-particles{position:absolute;inset:0;pointer-events:none}
      #${OVERLAY_ID} .s3475-particle{
        position:absolute;width:3px;height:3px;border-radius:50%;
        background:#ffb24a;box-shadow:0 0 8px #ff7a00;
        animation:s3475Particle 1.8s ease-out forwards;
      }
      @keyframes s3475Pulse{50%{transform:scale(1.18);opacity:.8}}
      @keyframes s3475Ring{0%{transform:scale(.25);opacity:0}35%{opacity:1}100%{transform:scale(1.45);opacity:0}}
      @keyframes s3475Content{0%{opacity:0;transform:scale(.72) translateY(10px);filter:blur(7px)}45%{opacity:1;filter:blur(0)}100%{transform:scale(1);opacity:1}}
      @keyframes s3475Line{to{width:min(360px,58vw)}}
      @keyframes s3475Particle{0%{transform:translate(0,0) scale(.4);opacity:0}20%{opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(0);opacity:0}}
      @media (prefers-reduced-motion:reduce){
        #${OVERLAY_ID} .s3475-content,#${OVERLAY_ID} .s3475-glow,#${OVERLAY_ID} .s3475-ring,#${OVERLAY_ID} .s3475-line{animation:none}
        #${OVERLAY_ID} .s3475-number,#${OVERLAY_ID} .s3475-title{opacity:1}
      }
    `;
    document.head.appendChild(style);
  }

  function createOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("aria-label", "STATE 3475");
    overlay.innerHTML = `
      <div class="s3475-glow"></div>
      <div class="s3475-ring"></div>
      <div class="s3475-particles"></div>
      <div class="s3475-content">
        <div class="s3475-number">3475</div>
        <div class="s3475-title">STATE 3475</div>
        <div class="s3475-line"></div>
      </div>
    `;

    const particles = overlay.querySelector(".s3475-particles");
    for (let i = 0; i < 28; i++) {
      const p = document.createElement("span");
      p.className = "s3475-particle";
      p.style.left = (45 + Math.random() * 10) + "%";
      p.style.top = (45 + Math.random() * 10) + "%";
      p.style.setProperty("--dx", ((Math.random() - .5) * 70) + "vw");
      p.style.setProperty("--dy", ((Math.random() - .5) * 70) + "vh");
      p.style.animationDelay = (Math.random() * .55) + "s";
      particles.appendChild(p);
    }

    document.body.appendChild(overlay);

    // Total opening duration: 2.5 seconds.
    window.setTimeout(function () {
      overlay.classList.add("is-hidden");
      window.setTimeout(function () {
        overlay.remove();
      }, 500);
    }, 2500);
  }

  function start() {
    addStyle();
    createOverlay();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, {once:true});
  } else {
    start();
  }
})();
