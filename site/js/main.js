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
    var requestTimeout = 15000;
    var isSubmitting = false;

    /* Keep the form progressively enhanced: if the request APIs or the status
       UI are unavailable, let the browser submit to Formspree normally. */
    if (typeof window.fetch !== 'function' ||
        typeof window.FormData !== 'function' ||
        typeof window.AbortController !== 'function' ||
        !confirmation || !errorState) return;

    function setSubmitting(submitting) {
      isSubmitting = submitting;
      form.setAttribute('aria-busy', submitting ? 'true' : 'false');
      for (var i = 0; i < submitButtons.length; i++) {
        submitButtons[i].disabled = submitting;
      }
    }

    form.addEventListener('submit', function (e) {
      if (isSubmitting) {
        e.preventDefault();
        return;
      }

      var formData;
      var controller;
      try {
        formData = new window.FormData(form);
        controller = new window.AbortController();
      } catch (error) {
        /* Creating the request failed before we intercepted the submission,
           so the browser can still perform the form's native POST. */
        return;
      }

      e.preventDefault();
      setSubmitting(true);
      errorState.hidden = true;

      var timeoutId = window.setTimeout(function () {
        controller.abort();
      }, requestTimeout);

      function showError() {
        window.clearTimeout(timeoutId);
        setSubmitting(false);
        errorState.hidden = false;
        errorState.focus();
      }

      var request;
      try {
        request = window.fetch(form.action, {
          method: form.method || 'POST',
          body: formData,
          headers: { Accept: 'application/json' },
          signal: controller.signal
        });
      } catch (error) {
        showError();
        return;
      }

      request.then(function (response) {
        if (!response.ok) {
          showError();
          return;
        }
        window.clearTimeout(timeoutId);
        setSubmitting(false);
        form.hidden = true;
        confirmation.hidden = false;
        confirmation.focus();
      }, showError);
    });

    var again = document.getElementById('contact-send-another');
    if (again) {
      again.addEventListener('click', function () {
        form.reset();
        form.hidden = false;
        setSubmitting(false);
        confirmation.hidden = true;
        errorState.hidden = true;
        var first = form.querySelector('input,textarea');
        if (first) first.focus();
      });
    }

    var tryAgain = document.getElementById('contact-try-again');
    if (tryAgain) {
      tryAgain.addEventListener('click', function () {
        errorState.hidden = true;
        if (form.requestSubmit) {
          form.requestSubmit();
        } else if (submitButtons.length) {
          submitButtons[0].click();
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    initNav();
    initContactForm();
  });
})();
