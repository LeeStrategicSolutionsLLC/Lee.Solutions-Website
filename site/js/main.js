(function () {
  'use strict';

  /* Mobile / tablet nav panel — opens beneath the header, pushes content down,
     Escape closes and returns focus to the trigger, closes automatically if the
     viewport grows past the desktop breakpoint while open. */
  function initNav() {
    var btn = document.querySelector('.lee-menu-btn');
    var panel = document.getElementById('lee-nav-panel');
    if (!btn || !panel) return;

    function setOpen(open) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Menu');
      panel.setAttribute('data-open', open ? 'true' : 'false');
    }

    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') === 'true';
      setOpen(!open);
    });

    panel.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') setOpen(false);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        btn.focus();
      }
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth >= 1120 && btn.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
      }
    });
  }

  /* Contact form — no backend in this hand-off, so submission shows the same
     confirmation state the prototype used. Replace the fetch stub below with a
     real endpoint (or a form service) when one is wired up. */
  function initContactForm() {
    var form = document.getElementById('contact-form');
    if (!form) return;
    var card = form.closest('.contact-form');
    var confirmation = document.getElementById('contact-confirmation');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      form.hidden = true;
      if (confirmation) confirmation.hidden = false;
      if (confirmation) confirmation.focus();
    });

    var again = document.getElementById('contact-send-another');
    if (again) {
      again.addEventListener('click', function () {
        form.reset();
        form.hidden = false;
        if (confirmation) confirmation.hidden = true;
        var first = form.querySelector('input,textarea');
        if (first) first.focus();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    initNav();
    initContactForm();
  });
})();
