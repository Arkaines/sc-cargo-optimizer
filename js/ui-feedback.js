"use strict";

// =========================================================================
// Retours d'interface : toasts (non bloquants) et modale de confirmation
// (bloquante, promise).
//
// Remplace alert()/confirm(), qui posaient trois vrais problèmes :
// - ils GÈLENT la page — pendant un alert() la synchro, le rendu 3D et les
//   animations sont figés, et sur certains navigateurs un alert() déclenché
//   depuis un handler asynchrone est purement et simplement ignoré ;
// - ils ne sont pas stylables : boîte système grise au milieu d'un cockpit
//   sombre, et le nom du domaine affiché en en-tête ;
// - confirm() n'a que « OK »/« Annuler », d'où des messages obligés
//   d'expliquer ce que fait OK (voir l'ancien cloudConflictPrompt). Ici les
//   boutons portent le nom de l'action, donc le message n'a plus à le dire.
//
// Chargé AVANT cloud.js et app.js (index.html) : les deux s'en servent.
// =========================================================================

const TOAST_DURATION_MS = { success: 4500, info: 5500, error: 9000 };

function ensureToastContainer() {
  let el = document.getElementById("toast-container");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast-container";
    // polite : un toast ne doit pas couper la lecture en cours d'un lecteur
    // d'écran. Les erreurs, elles, prennent role="alert" individuellement.
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-atomic", "false");
    document.body.appendChild(el);
  }
  return el;
}

function dismissToast(toast) {
  if (toast.dataset.leaving) return;
  toast.dataset.leaving = "1";
  toast.classList.add("toast-leaving");
  // Laisse l'animation de sortie se jouer, mais ne dépend pas d'elle : si
  // les animations sont désactivées (prefers-reduced-motion), transitionend
  // ne se déclenche jamais et le nœud resterait dans le DOM.
  setTimeout(() => toast.remove(), 200);
}

// kind : "success" | "error" | "info" (défaut).
//
// actionLabel/onAction ajoutent un bouton dans le toast. Sert à l'annulation
// d'une action destructrice : plutôt que de barrer la route avec un dialogue
// de confirmation à chaque suppression, on laisse le geste passer et on offre
// le retour en arrière pendant la durée du toast. Moins de friction sur
// l'action courante, et le filet reste là.
function showToast(message, kind = "info", { actionLabel, onAction } = {}) {
  if (!message) return null;
  const container = ensureToastContainer();
  const toast = document.createElement("div");
  toast.className = `toast toast-${kind}`;
  if (kind === "error") toast.setAttribute("role", "alert");

  // Glyphe de sévérité : la couleur seule ne suffit pas (daltonisme), et un
  // liseré coloré n'est que de la couleur déplacée. aria-hidden parce que le
  // message porte déjà l'information, et role="alert" l'urgence.
  const icon = document.createElement("span");
  icon.className = "toast-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = kind === "success" ? "✓" : kind === "error" ? "!" : "i";
  toast.appendChild(icon);

  const text = document.createElement("span");
  text.className = "toast-text";
  text.textContent = message;
  toast.appendChild(text);

  if (actionLabel && typeof onAction === "function") {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "toast-action";
    action.textContent = actionLabel;
    action.addEventListener("click", () => {
      onAction();
      dismissToast(toast);
    });
    toast.appendChild(action);
  }

  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.setAttribute("aria-label", typeof t === "function" ? t("toastDismiss") : "Fermer");
  close.textContent = "×";
  close.addEventListener("click", () => dismissToast(toast));
  toast.appendChild(close);

  container.appendChild(toast);

  // Le compte à rebours se met en pause au survol et au focus clavier : une
  // erreur qui disparaît pendant qu'on la lit est pire qu'un alert().
  let timer = null;
  const start = () => {
    clearTimeout(timer);
    timer = setTimeout(() => dismissToast(toast), TOAST_DURATION_MS[kind] || TOAST_DURATION_MS.info);
  };
  const stop = () => clearTimeout(timer);
  toast.addEventListener("mouseenter", stop);
  toast.addEventListener("mouseleave", start);
  toast.addEventListener("focusin", stop);
  toast.addEventListener("focusout", start);
  start();
  return toast;
}

// Agrandit une image par-dessus la page, sur un fond assombri. Sert à l'exemple
// de capture OCR : dans le panneau latéral il fait 280 px de large, illisible
// alors que c'est précisément le détail (récompense, proposeur, objectifs) que
// le joueur doit reconnaître pour cadrer sa propre capture.
//
// Volontairement sans dépendance à confirmDialog : pas de décision à prendre
// ici, donc pas de boutons — on ferme au clic n'importe où, à Échap, ou via la
// croix. Même piège à focus et même restitution du focus que la modale.
function showImageLightbox(src, alt) {
  if (!src) return;
  const previouslyFocused = document.activeElement;

  const overlay = document.createElement("div");
  overlay.className = "lightbox-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  if (alt) overlay.setAttribute("aria-label", alt);

  const img = document.createElement("img");
  img.className = "lightbox-image";
  img.src = src;
  img.alt = alt || "";
  overlay.appendChild(img);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "lightbox-close";
  close.setAttribute("aria-label", typeof t === "function" ? t("lightboxClose") : "Fermer");
  close.textContent = "×";
  overlay.appendChild(close);

  let done = false;
  const dismiss = () => {
    if (done) return;
    done = true;
    document.removeEventListener("keydown", onKeydown, true);
    overlay.remove();
    if (previouslyFocused && typeof previouslyFocused.focus === "function") previouslyFocused.focus();
  };

  // La croix est le seul élément focalisable : Tab y reste, on ne peut pas
  // tabuler dans la page masquée derrière.
  const onKeydown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      dismiss();
    } else if (e.key === "Tab") {
      e.preventDefault();
      close.focus();
    }
  };
  document.addEventListener("keydown", onKeydown, true);

  close.addEventListener("click", dismiss);
  overlay.addEventListener("click", dismiss);
  // Un clic SUR l'image ne ferme pas : on vient de l'agrandir pour la lire,
  // la refermer au premier clic dessus serait hostile.
  img.addEventListener("click", (e) => e.stopPropagation());

  document.body.appendChild(overlay);
  close.focus();
}

// Rend une image agrandissable au clic ET au clavier. Un <img> n'est pas
// interactif par défaut : sans role ni gestion des touches, la fonction
// n'existerait tout simplement pas pour qui n'utilise pas la souris.
function makeImageZoomable(img, label) {
  if (!img) return;
  img.setAttribute("role", "button");
  img.setAttribute("tabindex", "0");
  if (label) img.setAttribute("aria-label", label);
  const open = () => {
    // Focalise l'image AVANT d'ouvrir : showImageLightbox mémorise l'élément
    // actif pour lui rendre le focus à la fermeture. Un clic souris ne
    // focalise pas toujours un <img>, et le focus repartirait alors au début
    // du document — la navigation clavier perdrait sa place.
    img.focus();
    showImageLightbox(img.currentSrc || img.src, img.alt);
  };
  img.addEventListener("click", open);
  img.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault(); // Espace ferait défiler la page
      open();
    }
  });
}

// Modale de confirmation. Renvoie une Promise<boolean> : true si l'action est
// confirmée, false si annulée (bouton Annuler, Échap, ou clic hors modale).
//
// danger:true met le bouton de confirmation en rouge ET déplace le focus
// initial sur Annuler : pour une action irréversible, la touche Entrée
// réflexe ne doit pas déclencher la destruction.
//
// dismissible:false retire les sorties implicites (Échap, clic hors modale).
// Réservé aux choix dont AUCUNE des deux branches n'est neutre — le conflit
// de synchronisation cloud, où fermer d'un geste distrait écraserait des
// données d'un côté ou de l'autre.
function confirmDialog({ message, confirmLabel, cancelLabel, danger = false, dismissible = true }) {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement;

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const dialog = document.createElement("div");
    dialog.className = "modal-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");

    const text = document.createElement("p");
    text.className = "modal-message";
    text.id = "modal-message-" + Date.now();
    text.textContent = message;
    dialog.setAttribute("aria-describedby", text.id);
    dialog.appendChild(text);

    const actions = document.createElement("div");
    actions.className = "modal-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn-secondary";
    cancelBtn.textContent = cancelLabel || (typeof t === "function" ? t("dialogCancel") : "Annuler");

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = danger ? "btn-danger" : "btn-primary";
    confirmBtn.textContent = confirmLabel || (typeof t === "function" ? t("dialogConfirm") : "Confirmer");

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);

    let done = false;
    const close = (result) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKeydown, true);
      overlay.remove();
      // Rendre le focus à l'élément qui a ouvert la modale : sans ça, il
      // repart au début du document et la navigation clavier perd sa place.
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
      resolve(result);
    };

    // Piège à focus : deux boutons seulement, donc Tab boucle de l'un à
    // l'autre sans jamais ressortir vers la page derrière la modale.
    const onKeydown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (dismissible) close(false);
      } else if (e.key === "Tab") {
        e.preventDefault();
        (document.activeElement === confirmBtn ? cancelBtn : confirmBtn).focus();
      }
    };
    document.addEventListener("keydown", onKeydown, true);

    cancelBtn.addEventListener("click", () => close(false));
    confirmBtn.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (e) => {
      if (dismissible && e.target === overlay) close(false);
    });

    document.body.appendChild(overlay);
    (danger ? cancelBtn : confirmBtn).focus();
  });
}
