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

  /* Contact form — submits to the Formspree endpoint set in the form's
     action attribute. Swapping form services later only means changing
     that action URL, nothing here. */
  function initContactForm() {
    var form = document.getElementById('contact-form');
    if (!form) return;
    var confirmation = document.getElementById('contact-confirmation');
    var errorState = document.getElementById('contact-error');
    var submitButtons = form.querySelectorAll('button[type="submit"]');

    function setSubmitting(isSubmitting) {
      for (var i = 0; i < submitButtons.length; i++) {
        submitButtons[i].disabled = isSubmitting;
      }
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      setSubmitting(true);
      if (errorState) errorState.hidden = true;

      fetch(form.action, {
        method: form.method || 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' }
      }).then(function (response) {
        if (!response.ok) throw new Error('Form submission failed');
        form.hidden = true;
        if (confirmation) {
          confirmation.hidden = false;
          confirmation.focus();
        }
      }).catch(function () {
        setSubmitting(false);
        if (errorState) {
          errorState.hidden = false;
          errorState.focus();
        }
      });
    });

    var again = document.getElementById('contact-send-another');
    if (again) {
      again.addEventListener('click', function () {
        form.reset();
        form.hidden = false;
        setSubmitting(false);
        if (confirmation) confirmation.hidden = true;
        var first = form.querySelector('input,textarea');
        if (first) first.focus();
      });
    }

    var tryAgain = document.getElementById('contact-try-again');
    if (tryAgain) {
      tryAgain.addEventListener('click', function () {
        if (errorState) errorState.hidden = true;
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
