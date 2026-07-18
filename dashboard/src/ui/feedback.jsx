// Toasts + in-app dialogs, exposed as an imperative promise-based API so they
// can replace the browser's alert()/prompt()/confirm() with almost no control-
// flow change at the call site:
//
//   toast.success('Machine assigned');
//   if (await dialogs.confirm('Delete this document?')) { ... }
//   const name = await dialogs.prompt({ title: 'Operator name' });
//   const reason = await dialogs.prompt({ title: 'Why lost?', options: LOST_REASONS });
//
// <FeedbackProvider> must wrap the app once; it wires these module singletons.
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './icons';

let _pushToast = null;   // set by provider
let _openDialog = null;  // set by provider

// ---- Public API (callable from anywhere, even non-components) ----
export const toast = {
  push: (o) => (_pushToast ? _pushToast(o) : null),
  success: (msg, opts = {}) => _pushToast && _pushToast({ type: 'success', msg, ...opts }),
  error: (msg, opts = {}) => _pushToast && _pushToast({ type: 'error', msg, ...opts }),
  info: (msg, opts = {}) => _pushToast && _pushToast({ type: 'info', msg, ...opts }),
};

const asOpts = (o) => (typeof o === 'string' ? { message: o } : (o || {}));
export const dialogs = {
  alert: (o) => (_openDialog ? _openDialog({ mode: 'alert', ...asOpts(o) }) : Promise.resolve()),
  confirm: (o) => (_openDialog ? _openDialog({ mode: 'confirm', ...asOpts(o) }) : Promise.resolve(false)),
  prompt: (o) => (_openDialog ? _openDialog({ mode: 'prompt', ...asOpts(o) }) : Promise.resolve(null)),
};

const TOAST_ICON = { success: 'check', error: 'alert', info: 'dot' };

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null); // { ...opts, resolve }
  const idRef = useRef(0);

  const removeToast = useCallback((id) => {
    setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 200);
  }, []);

  const pushToast = useCallback((o) => {
    const id = ++idRef.current;
    const t = { id, type: o.type || 'info', msg: o.msg || '', duration: o.duration ?? 3800 };
    setToasts((ts) => [...ts, t]);
    if (t.duration > 0) setTimeout(() => removeToast(id), t.duration);
    return id;
  }, [removeToast]);

  const openDialog = useCallback((opts) => new Promise((resolve) => {
    setDialog({ ...opts, resolve });
  }), []);

  useEffect(() => {
    _pushToast = pushToast;
    _openDialog = openDialog;
    return () => { _pushToast = null; _openDialog = null; };
  }, [pushToast, openDialog]);

  return (
    <>
      {children}
      {createPortal(
        <div className="toast-stack" role="region" aria-label="Notifications">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.type} ${t.leaving ? 'toast-leaving' : ''}`} role="status">
              <Icon name={TOAST_ICON[t.type] || 'dot'} size={17} className="toast-ic" />
              <div className="toast-msg">{t.msg}</div>
              <button className="toast-close" onClick={() => removeToast(t.id)} aria-label="Dismiss">
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
      {dialog && <DialogModal {...dialog} onClose={() => setDialog(null)} />}
    </>
  );
}

function DialogModal({ mode, title, message, placeholder, defaultValue = '', options,
                       confirmText, cancelText = 'Cancel', danger, resolve, onClose }) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef(null);

  const finish = useCallback((result) => { resolve(result); onClose(); }, [resolve, onClose]);
  const cancel = useCallback(() => finish(mode === 'confirm' ? false : (mode === 'prompt' ? null : undefined)), [finish, mode]);
  const accept = useCallback(() => {
    if (mode === 'confirm') return finish(true);
    if (mode === 'prompt') return finish(value);
    return finish(undefined);
  }, [finish, mode, value]);

  // Autofocus the input (prompt) so typing/Enter works immediately.
  useEffect(() => {
    const el = inputRef.current;
    if (el) { el.focus(); if (el.select) el.select(); }
  }, []);

  // Escape cancels; Enter accepts (except in a multi-line context, which we have none of).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      else if (e.key === 'Enter' && mode !== 'alert') {
        // let a focused select use its own Enter behavior only if closed; simplest: accept
        e.preventDefault(); accept();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancel, accept, mode]);

  const okLabel = confirmText || (mode === 'confirm' ? (danger ? 'Delete' : 'Confirm') : 'OK');
  const normOpts = (options || []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));

  return createPortal(
    <div className="sourcing-modal-overlay" onClick={cancel}>
      <div className="sourcing-modal dialog-body" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {title && <div className="modal-title"><h2>{title}</h2></div>}
        {message && <p className="dialog-message">{message}</p>}

        {mode === 'prompt' && (options ? (
          <select ref={inputRef} className="dialog-select" value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="" disabled>Select…</option>
            {normOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <input
            ref={inputRef}
            className="dialog-input"
            value={value}
            placeholder={placeholder || ''}
            onChange={(e) => setValue(e.target.value)}
          />
        ))}

        <div className="dialog-actions">
          {mode !== 'alert' && (
            <button className="dialog-btn dialog-btn-cancel" onClick={cancel}>{cancelText}</button>
          )}
          <button
            className={`dialog-btn ${danger ? 'dialog-btn-danger' : 'dialog-btn-confirm'}`}
            onClick={accept}
          >
            {okLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
