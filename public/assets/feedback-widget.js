// EventSnapAI Feedback Widget — include on every portal
// Reads authToken from sessionStorage if available (managers/clients/admin)
// Sends feedback to POST /feedback

(function() {
  // Inject CSS
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = '/assets/feedback-widget.css';
  document.head.appendChild(link);

  // Inject HTML
  document.body.insertAdjacentHTML('beforeend', `
    <button id="ef-btn" title="Send Feedback" aria-label="Open feedback form">💬</button>
    <div id="ef-modal-overlay" role="dialog" aria-modal="true">
      <div id="ef-modal">
        <h3>Send Feedback</h3>
        <p>Share your thoughts, suggestions, or report an issue. We read every message.</p>
        <div id="ef-form-body">
          <label for="ef-name">Your name</label>
          <input id="ef-name" type="text" placeholder="Your name" maxlength="100">
          <label for="ef-contact">Phone or email (optional)</label>
          <input id="ef-contact" type="text" placeholder="How can we reach you?" maxlength="200">
          <label for="ef-message">Message <span style="color:var(--err,#ef4444)">*</span></label>
          <textarea id="ef-msg" placeholder="What's on your mind?" maxlength="2000"></textarea>
        </div>
        <div id="ef-success">
          <div class="ef-tick">✅</div>
          <p>Thank you! Your feedback has been received.</p>
        </div>
        <div id="ef-modal-footer">
          <button id="ef-cancel-btn">Cancel</button>
          <button id="ef-submit-btn">Send Feedback</button>
        </div>
      </div>
    </div>
  `);

  const btn     = document.getElementById('ef-btn');
  const overlay = document.getElementById('ef-modal-overlay');
  const cancelBtn  = document.getElementById('ef-cancel-btn');
  const submitBtn  = document.getElementById('ef-submit-btn');
  const nameInput  = document.getElementById('ef-name');
  const contactInput = document.getElementById('ef-contact');
  const msgInput   = document.getElementById('ef-msg');
  const formBody   = document.getElementById('ef-form-body');
  const successDiv = document.getElementById('ef-success');

  // Pre-fill name from stored user info
  function prefillUser() {
    try {
      const userStr = sessionStorage.getItem('authUser');
      const user = userStr ? JSON.parse(userStr) : null;
      if (user && user.displayName) {
        nameInput.value = user.displayName;
        nameInput.readOnly = true;
        nameInput.style.opacity = '0.6';
      }
    } catch(_) {}
  }

  function openModal() {
    prefillUser();
    overlay.classList.add('open');
    formBody.style.display = 'block';
    successDiv.style.display = 'none';
    msgInput.focus();
  }

  function closeModal() {
    overlay.classList.remove('open');
    msgInput.value = '';
    contactInput.value = '';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send Feedback';
  }

  btn.addEventListener('click', openModal);
  cancelBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  submitBtn.addEventListener('click', async () => {
    const message = msgInput.value.trim();
    if (!message) { msgInput.style.border = '1px solid var(--err,#ef4444)'; return; }
    msgInput.style.border = '';

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    const token = sessionStorage.getItem('authToken');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Get current event context if available (visitor has it in URL hash)
    const eventId = (() => {
      const hash = window.location.hash.replace('#', '');
      // If hash looks like a UUID, use it
      if (/^[0-9a-f-]{36}$/.test(hash)) return hash;
      // Or check global currentEvent variable
      try { return window.currentEvent?.id || null; } catch(_) { return null; }
    })();

    try {
      const r = await fetch('/feedback', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message,
          displayName: nameInput.value.trim() || undefined,
          contactInfo: contactInput.value.trim() || undefined,
          eventId: eventId || undefined,
        }),
      });
      if (r.ok) {
        formBody.style.display = 'none';
        document.getElementById('ef-modal-footer').style.display = 'none';
        successDiv.style.display = 'block';
        setTimeout(() => {
          document.getElementById('ef-modal-footer').style.display = 'flex';
          closeModal();
        }, 2500);
      } else {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Feedback';
        alert('Failed to send feedback. Please try again.');
      }
    } catch(_) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Feedback';
      alert('Network error. Please check your connection and try again.');
    }
  });
})();
