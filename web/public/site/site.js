// Links shared by all pages. Change APP_URL when the app moves to its own address (e.g. app.techplugpos.com).
var APP_URL = 'https://web-delta-five-slu2k38rxm.vercel.app/';
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
