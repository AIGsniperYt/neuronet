// Shared promise-based modal dialogs (confirm / prompt / alert).
// Replaces native window.confirm / window.prompt / window.alert everywhere.

let root = null;

function ensureRoot() {
  if (root) return root;
  root = document.createElement("div");
  root.id = "nnDialogRoot";
  root.innerHTML =
    `<style>
      #nnDialogRoot{position:fixed;inset:0;z-index:200;display:none;align-items:center;justify-content:center;}
      #nnDialogRoot.open{display:flex;}
      #nnDialogOverlay{position:absolute;inset:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(2px);}
      #nnDialogBox{position:relative;width:min(440px,92%);background:linear-gradient(135deg,var(--panel-strong,#242424),#1a1a1a);border:1px solid var(--glass-border);border-radius:16px;padding:20px;
        box-shadow:0 20px 60px rgba(0,0,0,.5);}
      #nnDialogMsg{font-size:.95rem;color:var(--text-main);margin:0 0 6px;line-height:1.5;white-space:pre-line;}
      #nnDialogInput{width:100%;box-sizing:border-box;margin-top:10px;padding:10px 12px;border-radius:10px;border:1px solid var(--glass-border);
        background:rgba(255,255,255,.05);color:var(--text-main);font:inherit;font-size:.9rem;}
      #nnDialogActions{display:flex;gap:10px;justify-content:flex-end;margin-top:18px;}
      .nn-dialog-btn{border:1px solid var(--glass-border);background:rgba(255,255,255,.06);color:var(--text-main);padding:8px 16px;border-radius:10px;font:inherit;font-size:.85rem;cursor:pointer;}
      .nn-dialog-btn:hover{background:rgba(255,255,255,.12);}
      .nn-dialog-btn.primary{background:var(--accent, #2cffb3);border-color:transparent;color:#06281c;font-weight:600;}
      .nn-dialog-btn.danger{background:#ff8c8c;border-color:transparent;color:#2a0000;font-weight:600;}
    </style>
    <div id="nnDialogOverlay"></div>
    <div id="nnDialogBox">
      <p id="nnDialogMsg"></p>
      <input id="nnDialogInput" type="text" style="display:none;" />
      <div id="nnDialogActions"></div>
    </div>`;
  document.body.appendChild(root);
  return root;
}

function cleanup() { if (root) root.classList.remove("open"); }

function show({ message, prompt, okLabel, okClass, cancel, cancelLabel }) {
  ensureRoot();
  const msg = document.getElementById("nnDialogMsg");
  const input = document.getElementById("nnDialogInput");
  const actions = document.getElementById("nnDialogActions");
  msg.textContent = message;
  input.style.display = prompt ? "" : "none";
  if (prompt) input.value = prompt.initial || "";
  actions.innerHTML = "";
  return new Promise((resolve) => {
    const btnOK = document.createElement("button");
    btnOK.className = "nn-dialog-btn " + (okClass || "primary");
    btnOK.textContent = okLabel || "OK";
    const btnCancel = document.createElement("button");
    btnCancel.className = "nn-dialog-btn";
    btnCancel.textContent = cancelLabel || "Cancel";

    const finalize = (val) => { cleanup(); resolve(val); detach(); };
    const onOK = () => finalize(prompt ? (input.value ?? "") : true);
    const onCancel = () => finalize(prompt ? null : false);
    const onKey = (e) => { if (e.key === "Enter" && prompt) onOK(); else if (e.key === "Escape") onCancel(); };
    const detach = () => {
      btnOK.removeEventListener("click", onOK);
      btnCancel.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onCancel);
      document.removeEventListener("keydown", onKey);
    };

    btnOK.addEventListener("click", onOK);
    if (cancel !== false) { btnCancel.addEventListener("click", onCancel); actions.appendChild(btnCancel); }
    else btnOK.textContent = okLabel || "OK";
    actions.appendChild(btnOK);
    const overlay = document.getElementById("nnDialogOverlay");
    overlay.addEventListener("click", onCancel);
    document.addEventListener("keydown", onKey);

    root.classList.add("open");
    if (prompt) setTimeout(() => { input.focus(); input.select(); }, 0);
    else btnOK.focus();
  });
}

export const dialog = {
  confirm: (message, okLabel = "OK", okClass = "primary", cancelLabel) => show({ message, okLabel, okClass, cancelLabel }),
  prompt: (message, initial = "") => show({ message, prompt: true, initial }),
  alert: (message) => show({ message, cancel: false })
};
