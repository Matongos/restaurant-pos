// Links shared by all pages: the app's public address.
var APP_URL = 'https://pos.techplug.co.zw/#/';
var DOWNLOAD_URL = 'https://github.com/Matongos/restaurant-pos/releases/latest/download/TechPlug-POS-Setup.exe';
document.querySelectorAll('[data-app]').forEach(function (a) { a.href = APP_URL; });
document.querySelectorAll('[data-download]').forEach(function (a) { a.href = DOWNLOAD_URL; });
var nav = document.getElementById('nav');
if (nav) addEventListener('scroll', function () { nav.classList.toggle('scrolled', scrollY > 10); });
// Download page: put the right option first for this device.
var ua = navigator.userAgent;
var device = /android/i.test(ua) ? 'android' : /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'ios' : /mac/i.test(navigator.platform) ? 'mac' : /win/i.test(navigator.platform) ? 'windows' : 'other';
document.documentElement.dataset.device = device;
var hint = document.getElementById('device-hint');
if (hint && device !== 'windows' && device !== 'other') {
  hint.hidden = false;
  hint.querySelector('[data-name]').textContent = device === 'android' ? 'an Android phone' : device === 'ios' ? 'an iPhone or iPad' : 'a Mac';
}

// Count visits and download clicks for the TechPlug owner console (no cookies, no personal data).
var EVENTS_URL = 'https://lrgeumaidmfmkszfdqjm.supabase.co/rest/v1/app_events';
var EVENTS_KEY = 'sb_publishable_FCs9Rr3rw75K9sKw1Yh3aA_R1AATemp';
function logEvent(kind) {
  try {
    var src = document.referrer ? new URL(document.referrer).hostname : '';
    if (src === location.hostname) src = '';
    var body = JSON.stringify({ kind: kind, platform: device, source: (src || new URLSearchParams(location.search).get('ref') || '').slice(0, 40) || null });
    fetch(EVENTS_URL, { method: 'POST', keepalive: true, headers: { apikey: EVENTS_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: body }).catch(function () {});
  } catch (e) { /* never break the page */ }
}
try {
  if (!sessionStorage.getItem('tp-visit')) { sessionStorage.setItem('tp-visit', '1'); logEvent('site_visit'); }
} catch (e) { logEvent('site_visit'); }
document.querySelectorAll('[data-download]').forEach(function (a) { a.addEventListener('click', function () { logEvent('download_click'); }); });

// Floating WhatsApp button: TechPlug's number comes from the owner console (TechPlug details), so it can be
// changed without touching the website. Hidden until a number is set.
(function () {
  try {
    fetch('https://lrgeumaidmfmkszfdqjm.supabase.co/rest/v1/platform_settings?select=data&id=eq.1', { headers: { apikey: EVENTS_KEY } })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var n = rows && rows[0] && rows[0].data && String(rows[0].data.whatsapp || '').replace(/\D/g, '');
        if (!n) return;
        var a = document.createElement('a');
        a.className = 'wa-float';
        a.href = 'https://wa.me/' + n + '?text=' + encodeURIComponent('Hi TechPlug, I would like to know more about TechPlug POS.');
        a.target = '_blank';
        a.rel = 'noopener';
        a.setAttribute('aria-label', 'Chat with TechPlug on WhatsApp');
        a.innerHTML = '<svg stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path></svg><span>WhatsApp us</span>';
        document.body.appendChild(a);
      })
      .catch(function () {});
  } catch (e) { /* never break the page */ }
})();
