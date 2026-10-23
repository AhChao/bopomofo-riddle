// ime-safe-submit — keyboard handling for "Enter submits, Shift+Enter inserts a
// newline" text inputs that stays correct while a CJK IME is composing. The two
// pure predicates are the collectible artifact; `bindEnterSubmit` is a minimal
// vanilla binding you can replace with a framework handler.
//
// The problem it solves: while an input-method editor is composing — Zhuyin
// (注音) candidate selection, Japanese henkan, Korean jamo assembly — the Enter
// key means "commit / choose the highlighted candidate" and Esc means "dismiss
// the candidate list". Both act *inside the IME*, not on the surrounding form. A
// naive `if (e.key === 'Enter') submit()` fires on the very Enter the user
// pressed only to pick a character, sending a half-composed message. A naive Esc
// handler tears down the whole composer while the user only wanted to cancel
// candidates. The guard is to short-circuit every key handler while composing.
//
// Composition is detected by EITHER signal, checked together:
//   - e.isComposing — W3C standard; true for the entire composition session.
//   - e.keyCode === 229 — the placeholder key code a browser reports for a
//     keystroke being consumed by the IME; covers engines/timings where
//     isComposing is briefly stale on the committing keystroke. Belt-and-braces.

/** True when this keyboard event happened during IME composition. */
export function isImeComposing(e) {
    return Boolean(e && (e.isComposing || e.keyCode === 229));
}

/**
 * True when this keydown should be treated as "submit": a bare Enter, no Shift,
 * and NOT mid-composition. Shift+Enter is reserved for inserting a newline. The
 * caller does its own preventDefault + submit when this returns true.
 */
export function isPlainEnterSubmit(e) {
    if (isImeComposing(e)) return false;
    return e.key === 'Enter' && !e.shiftKey;
}

/**
 * Wire Enter-to-submit on a text input / textarea, IME-safe.
 *   - plain Enter (no Shift, not composing) → preventDefault() + onSubmit(e)
 *   - Shift+Enter                           → left alone (native newline in a textarea)
 *   - Esc when NOT composing                → onEscape?.(e)
 *   - any key while composing               → ignored here, handled by the IME
 * Returns an unbind function.
 */
export function bindEnterSubmit(input, onSubmit, { onEscape } = {}) {
    const handler = (e) => {
        if (isImeComposing(e)) return;            // never act on a composing keystroke
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSubmit(e);
        } else if (e.key === 'Escape' && typeof onEscape === 'function') {
            onEscape(e);
        }
    };
    input.addEventListener('keydown', handler);
    return () => input.removeEventListener('keydown', handler);
}
