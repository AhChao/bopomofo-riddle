// modal-shell — vanilla ES module: open/close/focus mechanics for the
// overlay + panel structure in modal-shell.css. The shell is a dumb
// structural frame: it owns layering, dismissal, scroll lock, and focus;
// everything rendered inside header/body/footer (and all page logic)
// stays in the page. Nested shells (e.g. a small destructive confirm
// opened from inside a content modal) are independent instances stacked
// by DOM order on the same --ui-z-modal layer.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Where an opener "lives": when the dialog's own outcome removes the opener
// (an "Update 3 selected" button gone once the selection clears, an "Approve"
// button gone once the row is approved), focus falls back to the first
// focusable control still inside this container. Override per shell with
// the homeSelector option.
const DEFAULT_HOME = '[role="dialog"], td, tr, [role="toolbar"], form, main';

// Leave duration — coupled to --ui-dur-base (200ms). If a target repo's
// base duration differs, update both together.
const LEAVE_MS = 200;

// Body scroll lock is refcounted so nested modals (and rapid close/open
// sequences) never unlock the page while any shell is still open.
let lockCount = 0;
function lockScroll() {
  if (++lockCount === 1) document.body.style.overflow = 'hidden';
}
function unlockScroll() {
  if (lockCount > 0 && --lockCount === 0) document.body.style.overflow = '';
}

/** Focus has fallen to nothing: no element, or the document itself. */
function focusIsLost() {
  const a = document.activeElement;
  return !a || a === document.body || a === document.documentElement;
}

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Wire modal behavior onto an authored overlay element. Expected markup:
 *
 *   <div class="ui-modal-overlay" hidden>
 *     <div class="ui-modal ui-modal--lg" aria-labelledby="my-title">
 *       <header class="ui-modal__header">
 *         <h3 class="ui-modal__title" id="my-title">…</h3>
 *         <button class="ui-modal__close" data-modal-close aria-label="Close">✕</button>
 *       </header>
 *       <div class="ui-modal__body">…</div>
 *       <footer class="ui-modal__footer">…</footer>
 *     </div>
 *   </div>
 *
 * options:
 *   closeOnOverlay  clicking the backdrop requests close (true)
 *   closeOnEsc      Esc requests close (true)
 *   initialFocus    selector or element focused on open; falls back to the
 *                   first [autofocus] inside the panel, then the panel (null)
 *   onRequestClose  (reason) => boolean — called before any dismiss
 *                   ('overlay' | 'esc' | 'close-button' | 'api');
 *                   return false to veto, e.g. for a dirty-guard that opens
 *                   a nested confirm instead (null)
 *   onClose         (reason) => void — called once per close, after the
 *                   close has been committed (null)
 *   homeSelector    containers an opener can live in; used when the opener
 *                   itself is gone by the time focus is restored
 *                   (DEFAULT_HOME)
 *
 * Returns { overlay, panel, open, close, isOpen, destroy }.
 */
export function initModalShell(overlay, {
  closeOnOverlay = true,
  closeOnEsc = true,
  initialFocus = null,
  onRequestClose = null,
  onClose = null,
  homeSelector = DEFAULT_HOME
} = {}) {
  const panel = overlay.querySelector('.ui-modal');
  if (!panel) throw new Error('modal-shell: overlay has no .ui-modal panel');

  // A11y semantics the shell guarantees regardless of authored markup.
  if (!panel.hasAttribute('role')) panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.tabIndex = -1; // fallback focus target

  let openState = false;
  let lastFocused = null;
  let lastHome = null;     // the opener's container, for when the opener is removed
  let leaveTimer = null;
  let overlayArmed = false; // pointerdown started on the backdrop itself

  function focusables() {
    return Array.from(panel.querySelectorAll(FOCUSABLE))
      .filter((el) => el.getClientRects().length > 0);
  }

  function focusHome(home) {
    const visible = (el) => el.getClientRects().length > 0;
    const next = home.matches(FOCUSABLE) && visible(home)
      ? home
      : Array.from(home.querySelectorAll(FOCUSABLE)).find(visible);
    if (next) next.focus({ preventScroll: true });
    else if (home.hasAttribute('tabindex')) home.focus({ preventScroll: true });
  }

  function setInitialFocus() {
    let target = null;
    if (typeof initialFocus === 'string') target = panel.querySelector(initialFocus);
    else if (initialFocus instanceof HTMLElement) target = initialFocus;
    if (!target) target = panel.querySelector('[autofocus]');
    if (!target) target = panel;
    target.focus({ preventScroll: true });
  }

  function requestClose(reason) {
    if (!openState) return;
    if (onRequestClose && onRequestClose(reason) === false) return;
    commitClose(reason);
  }

  function commitClose(reason) {
    openState = false;
    overlayArmed = false;
    // Restore when focus is inside the dialog OR has fallen to nothing (the
    // button that closed it removed itself). Focus the user moved elsewhere
    // on purpose is left where it is.
    const restore = overlay.contains(document.activeElement) || focusIsLost();
    overlay.classList.remove('is-open');
    unlockScroll();
    const finish = () => {
      leaveTimer = null;
      overlay.hidden = true;
    };
    leaveTimer = setTimeout(finish, reducedMotion() ? 0 : LEAVE_MS);
    const opener = lastFocused;
    const home = lastHome;
    lastFocused = null;
    lastHome = null;
    if (restore) {
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
      else if (home && home.isConnected) focusHome(home);
      // The opener is often removed by the reply that closed the dialog, one
      // render AFTER this ran: it was there to focus, then vanished, and the
      // keyboard fell to <body>. Check the landing again once the DOM has
      // settled and let the remembered home catch it.
      setTimeout(() => {
        if (openState || !focusIsLost()) return;
        if (home && home.isConnected) focusHome(home);
      }, 0);
    }
    if (onClose) onClose(reason);
  }

  // ─── Focus stays inside ───────────────────────────────────────────────
  // A control that disappears when pressed (a chip's remove, "Mark blocked",
  // "Send back", "Post") takes focus with it: focusout fires with no
  // relatedTarget and focus lands on <body>, where Tab walks the page under
  // the veil and Esc reaches nobody. Answer it on the next tick, once the
  // DOM has settled: if the dialog is still open and focus is still on
  // nothing, land on the dialog's first control, else the panel itself.
  // Focus that moves to a real element (a popover portaled to <body>, the
  // page behind via a deliberate script) has a relatedTarget and is left
  // alone — recovering it would break every portaled popover.
  function onFocusout(e) {
    if (e.relatedTarget || !openState) return;
    setTimeout(() => {
      if (!openState || !overlay.isConnected || !focusIsLost()) return;
      const first = focusables()[0];
      (first || panel).focus({ preventScroll: true });
    }, 0);
  }

  // ─── Dismissal: backdrop ───────────────────────────────────────────────
  // Close only when the press *started* on the backdrop — a drag that ends
  // over the backdrop (e.g. text selection escaping the panel) never closes.
  // preventDefault keeps focus inside the panel even when the backdrop
  // click does not close (closeOnOverlay: false).
  function onPointerDown(e) {
    overlayArmed = e.target === overlay;
    if (overlayArmed) e.preventDefault();
  }
  function onClick(e) {
    const armed = overlayArmed;
    overlayArmed = false;
    if (armed && e.target === overlay && closeOnOverlay) requestClose('overlay');
  }

  // ─── Dismissal: Esc + focus trap ──────────────────────────────────────
  // Listening on the overlay means only the shell that contains the focused
  // element reacts; stopPropagation keeps an inner (nested) shell's Esc
  // from also dismissing anything behind it.
  function onKeydown(e) {
    if (e.key === 'Escape') {
      if (!closeOnEsc) return;
      e.stopPropagation();
      requestClose('esc');
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusables();
    if (items.length === 0) {
      e.preventDefault();
      panel.focus({ preventScroll: true });
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  // ─── Dismissal: explicit close controls ───────────────────────────────
  function onCloseClick(e) {
    if (e.target.closest('[data-modal-close]')) requestClose('close-button');
  }

  overlay.addEventListener('pointerdown', onPointerDown);
  overlay.addEventListener('click', onClick);
  overlay.addEventListener('keydown', onKeydown);
  overlay.addEventListener('click', onCloseClick);
  panel.addEventListener('focusout', onFocusout);

  const api = {
    overlay,
    panel,

    isOpen: () => openState,

    open() {
      if (openState) return;
      if (leaveTimer !== null) {
        // Reopened mid-leave: cancel the pending hide so the enter
        // transition replays from the current state.
        clearTimeout(leaveTimer);
        leaveTimer = null;
      }
      openState = true;
      lastFocused = document.activeElement;
      lastHome = lastFocused && lastFocused.closest ? lastFocused.closest(homeSelector) : null;
      lockScroll();
      overlay.hidden = false;
      // Force a style flush so the is-open transition actually animates.
      void overlay.offsetHeight;
      overlay.classList.add('is-open');
      setInitialFocus();
    },

    /** Programmatic close — skips onRequestClose (the page already decided). */
    close() {
      if (!openState) return;
      commitClose('api');
    },

    destroy() {
      if (leaveTimer !== null) clearTimeout(leaveTimer);
      if (openState) unlockScroll();
      overlay.removeEventListener('pointerdown', onPointerDown);
      overlay.removeEventListener('click', onClick);
      overlay.removeEventListener('keydown', onKeydown);
      overlay.removeEventListener('click', onCloseClick);
      panel.removeEventListener('focusout', onFocusout);
    }
  };

  return api;
}
