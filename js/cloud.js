"use strict";

// =========================================================================
// Sauvegarde cloud optionnelle (connexion Discord via Supabase Auth).
// L'appli reste 100% fonctionnelle hors-ligne (localStorage) sans connexion
// — ce fichier ajoute juste une synchronisation par-dessus quand l'utilisateur
// se connecte. Nommé "sb" (pas "supabase") pour ne pas écraser l'espace de
// nom global exposé par le SDK CDN.
// =========================================================================

// À remplacer par les vraies valeurs du projet Supabase (Settings > API).
// La clé "anon" est conçue pour être publique côté client : elle ne donne
// aucun accès en dehors de ce que les règles RLS de la table autorisent.
const SUPABASE_URL = "https://shccecsoeeetrubeajco.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNoY2NlY3NvZWVldHJ1YmVhamNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMzk4NzIsImV4cCI6MjA5OTYxNTg3Mn0.5eQdh0mVom5zjsAYJMSfGmJODL6DfBDfqO1g7o8z_Tc";

const CLOUD_LINKED_FLAG = "sc-cargo-optimizer-cloud-linked";
const CLOUD_SYNCED_KEYS = [
  "missions",
  "customLocations",
  "distances",
  "nextMissionId",
  "selectedShip",
  "customShipCapacity",
  "reputationOverrides",
  "cargoViewerOrientation",
  "cargoViewerMirror",
  "cargoViewerLayout",
  "cargoReservations",
];
const CLOUD_SYNC_DEBOUNCE_MS = 1500;

const sb =
  typeof window !== "undefined" && window.supabase
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

let cloudUserId = null;
let cloudSyncTimer = null;
let cloudSyncPendingState = null;

// Ne garde que les champs "données joueur" (missions, lieux perso,
// distances, vaisseau) — pas les caches du catalogue UEX/SC Wiki
// (uexLocations/uexCommodities/uexCompanies/uexShips/scwikiLocations),
// re-téléchargeables et inutiles à stocker par joueur.
function cloudPayload(state) {
  const payload = {};
  CLOUD_SYNCED_KEYS.forEach((key) => {
    payload[key] = state[key];
  });
  return payload;
}

function isLocalEmpty(state) {
  return (
    (!state.missions || state.missions.length === 0) &&
    (!state.customLocations || state.customLocations.length === 0) &&
    (!state.distances || Object.keys(state.distances).length === 0) &&
    !state.selectedShip &&
    (state.nextMissionId || 1) === 1
  );
}

function setCloudStatus(text) {
  const el = document.getElementById("cloud-sync-status");
  if (el) el.textContent = text;
}

async function pushStateToCloud(state) {
  if (!sb || !cloudUserId) return;
  setCloudStatus(t("cloudSyncing"));
  try {
    const { error } = await sb
      .from("player_state")
      .upsert({ user_id: cloudUserId, state: cloudPayload(state) }, { onConflict: "user_id" });
    if (error) throw error;
    setCloudStatus(t("cloudSynced"));
  } catch (err) {
    setCloudStatus("");
    alert(t("cloudSyncFailed", { msg: err.message }));
  }
}

async function pullStateFromCloud() {
  if (!sb || !cloudUserId) return null;
  const { data, error } = await sb.from("player_state").select("state").eq("user_id", cloudUserId).maybeSingle();
  if (error) {
    alert(t("cloudSyncFailed", { msg: error.message }));
    return null;
  }
  return data ? data.state : null;
}

// Point d'entrée unique appelé depuis saveState() (app.js) : debounce les
// écritures rapprochées (édition de quantité, etc.) pour ne pousser vers
// Supabase qu'une fois l'utilisateur "posé", avec un flush immédiat si
// l'onglet se ferme/se cache avant la fin du délai.
function scheduleCloudSync(state) {
  if (!sb || !cloudUserId) return;
  cloudSyncPendingState = state;
  if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(() => {
    cloudSyncTimer = null;
    const s = cloudSyncPendingState;
    cloudSyncPendingState = null;
    pushStateToCloud(s);
  }, CLOUD_SYNC_DEBOUNCE_MS);
}

function flushPendingCloudSync() {
  if (!cloudSyncTimer) return;
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = null;
  const s = cloudSyncPendingState;
  cloudSyncPendingState = null;
  if (s) pushStateToCloud(s);
}

function signInWithDiscord() {
  if (!sb) return;
  sb.auth.signInWithOAuth({
    provider: "discord",
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
}

function signOut() {
  if (!sb) return;
  sb.auth.signOut();
}

function updateAuthUI(session) {
  const loginBtn = document.getElementById("login-btn");
  const chip = document.getElementById("user-chip");
  const avatar = document.getElementById("user-avatar");
  const nameEl = document.getElementById("user-name");
  if (!loginBtn || !chip) return;

  if (session && session.user) {
    const meta = session.user.user_metadata || {};
    loginBtn.style.display = "none";
    chip.style.display = "";
    if (avatar) avatar.src = meta.avatar_url || "";
    if (nameEl) nameEl.textContent = meta.full_name || meta.user_name || meta.name || t("loggedInAs");
  } else {
    loginBtn.style.display = "";
    chip.style.display = "none";
    setCloudStatus("");
  }
}

// Résout l'écart éventuel entre les données locales et celles déjà en ligne
// lors d'une connexion : pas de fusion intelligente (v1), juste un choix
// simple et un flag pour ne demander qu'une seule fois par appareil.
async function reconcileOnSignIn() {
  const alreadyLinked = localStorage.getItem(CLOUD_LINKED_FLAG) === "1";
  const cloudState = await pullStateFromCloud();

  if (!cloudState) {
    await pushStateToCloud(state);
    localStorage.setItem(CLOUD_LINKED_FLAG, "1");
    return;
  }

  if (alreadyLinked) return;

  if (isLocalEmpty(state)) {
    Object.assign(state, defaultState(), cloudState);
    saveState();
    renderAll();
    localStorage.setItem(CLOUD_LINKED_FLAG, "1");
    return;
  }

  const keepCloud = confirm(t("cloudConflictPrompt"));
  if (keepCloud) {
    Object.assign(state, defaultState(), cloudState);
    saveState();
    renderAll();
  } else {
    await pushStateToCloud(state);
  }
  localStorage.setItem(CLOUD_LINKED_FLAG, "1");
}

function initCloudSync() {
  if (!sb) return;

  const loginBtn = document.getElementById("login-btn");
  const logoutBtn = document.getElementById("logout-btn");
  if (loginBtn) loginBtn.addEventListener("click", signInWithDiscord);
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      signOut();
      localStorage.removeItem(CLOUD_LINKED_FLAG);
    });
  }

  sb.auth.onAuthStateChange((event, session) => {
    updateAuthUI(session);
    cloudUserId = session && session.user ? session.user.id : null;
    if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && cloudUserId) {
      reconcileOnSignIn();
      // cloudUserId n'existe qu'à partir d'ici : fetchIsAdmin() lu plus tôt
      // (ex. depuis runFullSync au chargement) a pu répondre false faute de
      // cloudUserId encore posé. On revérifie donc explicitement à la
      // connexion, sinon un mainteneur qui se connecte après le chargement
      // de la page reste isAdminUser = false jusqu'à la prochaine synchro.
      if (typeof fetchIsAdmin === "function") {
        fetchIsAdmin().then((admin) => {
          isAdminUser = admin;
          if (typeof renderAdminGridEntry === "function") renderAdminGridEntry();
        });
      }
    }
  });

  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPendingCloudSync();
  });
  window.addEventListener("pagehide", flushPendingCloudSync);

  // Un autre onglet du même navigateur a modifié le localStorage partagé :
  // recharge l'état en mémoire pour éviter que ce reste onglet écrase la
  // sauvegarde cloud avec des données périmées à sa prochaine modification.
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
      state = loadState();
      renderAll();
    }
  });
}

// =========================================================================
// Grilles de cargo publiées (table ship_layouts) et statut admin.
// Lecture publique : marche même sans compte. Toute erreur (tables pas
// encore créées, hors-ligne...) est avalée et rend une valeur neutre —
// l'app doit continuer exactement comme avant si Supabase n'est pas là.
// =========================================================================
async function fetchApprovedShipGrids() {
  if (!sb) return {};
  try {
    const { data, error } = await sb.from("ship_layouts").select("ship_name, grid, orientation, mirror");
    if (error) throw error;
    const byShip = {};
    (data || []).forEach((row) => {
      byShip[row.ship_name] = { grid: row.grid, orientation: row.orientation || 0, mirror: !!row.mirror };
    });
    return byShip;
  } catch (err) {
    console.warn("Grilles publiées indisponibles :", err.message);
    return {};
  }
}

// Le client ne fait que DEMANDER s'il est admin, pour afficher l'éditeur.
// L'autorité est la RLS : un non-admin qui forcerait true côté client se
// ferait refuser toute écriture par la base.
async function fetchIsAdmin() {
  if (!sb || !cloudUserId) return false;
  try {
    const { data, error } = await sb.from("admins").select("user_id").eq("user_id", cloudUserId).maybeSingle();
    if (error) throw error;
    return !!data;
  } catch (err) {
    return false;
  }
}

// Publie la grille d'un vaisseau. La RLS refuse cet upsert à quiconque n'est
// pas dans la table admins — c'est elle qui fait autorité, pas l'interface.
async function publishShipGrid(shipName, grid, orientation, mirror) {
  if (!sb) return false;
  try {
    const { error } = await sb.from("ship_layouts").upsert(
      { ship_name: shipName, grid, orientation: orientation || 0, mirror: !!mirror, updated_at: new Date().toISOString() },
      { onConflict: "ship_name" }
    );
    if (error) throw error;
    return true;
  } catch (err) {
    alert(t("adminGridPublishFailed", { msg: err.message }));
    return false;
  }
}

// =========================================================================
// Propositions communautaires (brique 2b, table layout_submissions).
// Tout dégrade proprement si le SQL de la 2b n'a pas encore été exécuté :
// lister renvoie [], proposer/valider/rejeter renvoient false. L'app marche
// exactement comme avant tant que la table n'existe pas.
// =========================================================================

// Proposer sa disposition. « Remplace » la proposition encore en attente du
// même joueur pour le même vaisseau : on supprime la sienne (la RLS l'autorise
// UNIQUEMENT sur ses propres lignes encore 'pending') puis on insère. On ne
// passe pas par un upsert : la contrainte d'unicité est un index PARTIEL
// (where status='pending') et PostgREST ne sait pas s'appuyer dessus de façon
// fiable pour un on_conflict.
async function submitLayoutProposal(shipName, grid, orientation, mirror, submitterName) {
  if (!sb || !cloudUserId) return false;
  try {
    await sb
      .from("layout_submissions")
      .delete()
      .eq("submitted_by", cloudUserId)
      .eq("ship_name", shipName)
      .eq("status", "pending");
    const { error } = await sb.from("layout_submissions").insert({
      ship_name: shipName,
      grid,
      orientation: orientation || 0,
      mirror: !!mirror,
      submitted_by: cloudUserId,
      submitter_name: submitterName || null,
      status: "pending",
    });
    if (error) throw error;
    return true;
  } catch (err) {
    alert(t("proposalFailed", { msg: err.message }));
    return false;
  }
}

// Propositions en attente (lecture réservée aux admins par la RLS ; un
// non-admin ne verrait que les siennes, ce qui est sans danger).
async function fetchPendingSubmissions() {
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from("layout_submissions")
      .select("id, ship_name, grid, orientation, mirror, submitter_name, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn("Propositions indisponibles :", err.message);
    return [];
  }
}

// Valider : passe par le RPC, qui marque 'approved' ET publie dans
// ship_layouts dans UNE transaction (deux écritures client séparées pourraient
// échouer à moitié). Le RPC revérifie is_admin() côté base.
async function approveSubmission(id) {
  if (!sb) return false;
  try {
    const { error } = await sb.rpc("approve_submission", { submission_id: id });
    if (error) throw error;
    return true;
  } catch (err) {
    alert(t("submissionActionFailed", { msg: err.message }));
    return false;
  }
}

async function rejectSubmission(id) {
  if (!sb) return false;
  try {
    const { error } = await sb.rpc("reject_submission", { submission_id: id });
    if (error) throw error;
    return true;
  } catch (err) {
    alert(t("submissionActionFailed", { msg: err.message }));
    return false;
  }
}
