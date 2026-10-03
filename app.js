import { api } from "./api.js";
import { FEDA_CONFIG } from "./config.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { user: null, profile: null, feedMode: "for-you", videos: [], liked: new Set(), following: new Set(), activeVideo: null, installPrompt: null, previewUrl: null };
const VIDEO_MIME_BY_EXTENSION = Object.freeze({ mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" });

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function toast(message, error = false) {
  const el = $("#toast");
  el.textContent = message;
  el.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.className = "toast"; }, 3600);
}

function formatCount(value = 0) {
  return new Intl.NumberFormat("fr-FR", { notation: value > 999 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function relativeDate(value) {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  const units = [[31536000, "an"], [2592000, "mois"], [86400, "j"], [3600, "h"], [60, "min"]];
  for (const [size, label] of units) if (seconds >= size) return `il y a ${Math.floor(seconds / size)} ${label}`;
  return "à l’instant";
}

function videoMimeType(file) {
  const declared = (file.type || "").toLowerCase().split(";")[0];
  if (Object.values(VIDEO_MIME_BY_EXTENSION).includes(declared)) return declared;
  const extension = (file.name.split(".").pop() || "").toLowerCase();
  if (VIDEO_MIME_BY_EXTENSION[extension]) return VIDEO_MIME_BY_EXTENSION[extension];
  throw new Error("Choisissez une vidéo MP4, WebM ou MOV.");
}

function normalizedVideoFile(file) {
  const type = videoMimeType(file);
  return file.type === type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
}

function videoExtension(type) {
  return type === "video/webm" ? "webm" : type === "video/quicktime" ? "mov" : "mp4";
}

function formatMegabytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

function showAuth() {
  $("#auth-screen").classList.remove("hidden");
  $("#app").classList.add("hidden");
}

function showApp() {
  $("#auth-screen").classList.add("hidden");
  $("#app").classList.remove("hidden");
}

async function bootstrap() {
  bindEvents();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  if (!api.session) return showAuth();
  try {
    state.user = await api.getUser();
    state.profile = await api.ensureProfile(state.user);
    showApp();
    updateProfileUi();
    await Promise.all([loadSocialState(), loadFeed(), loadNotificationsCount()]);
  } catch (error) {
    api.saveSession(null);
    showAuth();
    toast(error.message, true);
  }
}

function bindEvents() {
  $$("[data-auth-mode]").forEach(button => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));
  $("#auth-form").addEventListener("submit", handleAuth);
  $$('[data-view]').forEach(button => button.addEventListener("click", () => navigate(button.dataset.view)));
  $("#brand-button").addEventListener("click", () => navigate("feed"));
  $$(".feed-tab").forEach(button => button.addEventListener("click", () => changeFeed(button.dataset.feed)));
  $("#feed").addEventListener("click", handleFeedAction);
  $("#video-file").addEventListener("change", previewVideo);
  $("#publish-form").addEventListener("submit", publishVideo);
  $("#search-form").addEventListener("submit", searchVideos);
  $("#comment-form").addEventListener("submit", submitComment);
  $("#mark-read").addEventListener("click", markAllRead);
  $("#profile-form").addEventListener("submit", saveProfile);
  $("#logout-button").addEventListener("click", logout);
  $$("[data-close-dialog]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
  $$("[data-gift]").forEach(button => button.addEventListener("click", () => sendGift(button)));
  $$("[data-pack]").forEach(button => button.addEventListener("click", () => selectCoinPack(button)));
  $("#coin-order-form").addEventListener("submit", createCoinOrder);
  $("#payout-form").addEventListener("submit", requestPayout);
  $("#view-admin").addEventListener("click", handleAdminAction);
  window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); state.installPrompt = event; $("#install-button").classList.remove("hidden"); });
  $("#install-button").addEventListener("click", installApp);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) playVisibleVideo(); });
}

function setAuthMode(mode) {
  const signup = mode === "signup";
  $$("[data-auth-mode]").forEach(button => button.classList.toggle("active", button.dataset.authMode === mode));
  $("#name-field").classList.toggle("hidden", !signup);
  $("#auth-name").required = signup;
  $("#auth-password").autocomplete = signup ? "new-password" : "current-password";
  $("#auth-submit").textContent = signup ? "Créer mon compte" : "Se connecter";
  $("#auth-form").dataset.mode = mode;
}

async function handleAuth(event) {
  event.preventDefault();
  const mode = event.currentTarget.dataset.mode || "login";
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  const button = $("#auth-submit");
  button.disabled = true;
  button.textContent = "Patientez…";
  try {
    if (mode === "signup") {
      const result = await api.signUp(email, password, $("#auth-name").value.trim());
      if (!result.access_token) {
        toast("Compte créé. Vérifiez votre e-mail, puis connectez-vous.");
        setAuthMode("login");
        return;
      }
    } else await api.signIn(email, password);
    state.user = await api.getUser();
    state.profile = await api.ensureProfile(state.user);
    showApp();
    updateProfileUi();
    await Promise.all([loadSocialState(), loadFeed(), loadNotificationsCount()]);
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; button.textContent = mode === "signup" ? "Créer mon compte" : "Se connecter"; }
}

async function navigate(view) {
  $$(".view").forEach(section => section.classList.toggle("active", section.id === `view-${view}`));
  $$(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.view === view));
  if (view === "feed") playVisibleVideo();
  else $$("#feed video").forEach(video => video.pause());
  if (view === "inbox") await loadNotifications();
  if (view === "wallet") await loadWallet();
  if (view === "profile") updateProfileUi();
  if (view === "admin") await loadAdmin();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function loadSocialState() {
  const [likes, following] = await Promise.all([api.getMyLikes(state.user.id), api.getFollowingIds(state.user.id)]);
  state.liked = new Set(likes.map(row => row.video_id));
  state.following = new Set(following);
}

async function changeFeed(mode) {
  state.feedMode = mode;
  $$(".feed-tab").forEach(button => button.classList.toggle("active", button.dataset.feed === mode));
  await loadFeed();
}

async function loadFeed() {
  $("#feed").innerHTML = '<div class="empty"><p>Chargement des vidéos…</p></div>';
  try {
    let rows = await api.getFeed(state.feedMode, state.user.id);
    if (state.feedMode === "following") rows = rows.filter(row => state.following.has(row.user_id));
    if (state.feedMode === "new") rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    state.videos = rows;
    renderFeed(rows);
  } catch (error) { $("#feed").innerHTML = ""; $("#feed-empty").classList.remove("hidden"); toast(error.message, true); }
}

function renderFeed(videos) {
  const feed = $("#feed");
  $("#feed-empty").classList.toggle("hidden", videos.length > 0);
  feed.classList.toggle("hidden", videos.length === 0);
  feed.innerHTML = videos.map(video => {
    const own = video.user_id === state.user.id;
    const name = video.profiles?.display_name || "Créateur FEDA";
    return `<article class="video-card" data-video-id="${video.id}" data-user-id="${video.user_id}" data-storage-path="${escapeHtml(video.storage_path)}">
      <div class="video-loader">Chargement…</div><video loop playsinline preload="metadata"></video>
      <div class="video-info"><div class="video-author"><div class="avatar">${escapeHtml(name[0]?.toUpperCase() || "F")}</div><strong>@${escapeHtml(name)}</strong>${own ? "" : `<button class="follow-button" data-action="follow">${state.following.has(video.user_id) ? "Abonné" : "S’abonner"}</button>`}</div><p class="video-caption">${escapeHtml(video.caption || "")}</p></div>
      <aside class="video-actions">
        <button class="action ${state.liked.has(video.id) ? "liked" : ""}" data-action="like"><span>♥</span><small data-count="likes">${formatCount(video.like_count)}</small></button>
        <button class="action" data-action="comment"><span>●</span><small data-count="comments">${formatCount(video.comment_count)}</small></button>
        <button class="action" data-action="gift"><span>🎁</span><small>Cadeau</small></button>
        <button class="action" data-action="share"><span>↗</span><small data-count="shares">${formatCount(video.share_count)}</small></button>
        <button class="action" data-action="report"><span>⋯</span><small>Signaler</small></button>
      </aside>
    </article>`;
  }).join("");
  observeVideos();
}

function observeVideos() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(async entry => {
      const card = entry.target;
      const video = $("video", card);
      if (entry.isIntersecting && entry.intersectionRatio > .65) {
        if (!video.src) {
          try { video.src = await api.signedVideoUrl(card.dataset.storagePath); $(".video-loader", card).remove(); }
          catch { $(".video-loader", card).textContent = "Vidéo indisponible"; }
        }
        $$("#feed video").forEach(other => { if (other !== video) other.pause(); });
        video.play().catch(() => {});
      } else video.pause();
    });
  }, { threshold: [.15, .65] });
  $$(".video-card").forEach(card => observer.observe(card));
}

function playVisibleVideo() {
  const card = $$(".video-card").find(el => { const rect = el.getBoundingClientRect(); return rect.top < innerHeight * .35 && rect.bottom > innerHeight * .65; });
  if (card) $("video", card)?.play().catch(() => {});
}

async function handleFeedAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const card = button.closest(".video-card");
  const video = state.videos.find(item => item.id === card.dataset.videoId);
  try {
    if (button.dataset.action === "like") await toggleLike(video, button);
    if (button.dataset.action === "comment") await openComments(video);
    if (button.dataset.action === "share") await shareVideo(video, button);
    if (button.dataset.action === "follow") await toggleFollow(video.user_id, button);
    if (button.dataset.action === "gift") { state.activeVideo = video; $("#gift-dialog").showModal(); }
    if (button.dataset.action === "report") await reportVideo(video);
  } catch (error) { toast(error.message, true); }
}

async function toggleLike(video, button) {
  const liked = state.liked.has(video.id);
  liked ? await api.unlike(video.id, state.user.id) : await api.like(video.id, state.user.id);
  liked ? state.liked.delete(video.id) : state.liked.add(video.id);
  video.like_count = Math.max(0, video.like_count + (liked ? -1 : 1));
  button.classList.toggle("liked", !liked);
  $("[data-count=likes]", button).textContent = formatCount(video.like_count);
}

async function toggleFollow(creatorId, button) {
  const following = state.following.has(creatorId);
  following ? await api.unfollow(creatorId, state.user.id) : await api.follow(creatorId, state.user.id);
  following ? state.following.delete(creatorId) : state.following.add(creatorId);
  button.textContent = following ? "S’abonner" : "Abonné";
  toast(following ? "Abonnement retiré" : "Vous suivez ce créateur");
}

async function openComments(video) {
  state.activeVideo = video;
  $("#comments-list").innerHTML = "<p class='muted'>Chargement…</p>";
  $("#comments-dialog").showModal();
  const rows = await api.getComments(video.id);
  $("#comments-list").innerHTML = rows.length ? rows.map(row => `<div class="comment"><strong>${escapeHtml(row.profiles?.display_name || "Membre FEDA")}</strong><p>${escapeHtml(row.body)}</p><small>${relativeDate(row.created_at)}</small></div>`).join("") : "<p class='muted'>Aucun commentaire. Commencez la discussion.</p>";
}

async function submitComment(event) {
  event.preventDefault();
  const input = $("#comment-input");
  const body = input.value.trim();
  if (!body || !state.activeVideo) return;
  try {
    await api.addComment(state.activeVideo.id, state.user.id, body);
    input.value = "";
    state.activeVideo.comment_count += 1;
    const card = $(`[data-video-id="${state.activeVideo.id}"]`);
    if (card) $("[data-count=comments]", card).textContent = formatCount(state.activeVideo.comment_count);
    await openComments(state.activeVideo);
  } catch (error) { toast(error.message, true); }
}

async function shareVideo(video, button) {
  const url = `${location.origin}${location.pathname}#video=${video.id}`;
  await api.addShare(video.id, state.user.id);
  video.share_count += 1;
  $("[data-count=shares]", button).textContent = formatCount(video.share_count);
  if (navigator.share) await navigator.share({ title: "Vidéo FEDA", text: video.caption, url });
  else { await navigator.clipboard.writeText(url); toast("Lien copié"); }
}

async function reportVideo(video) {
  const reason = prompt("Pourquoi signalez-vous cette vidéo ?\nExemples : violence, nudité, harcèlement, spam");
  if (!reason?.trim()) return;
  await api.reportVideo(video.id, state.user.id, reason.trim());
  toast("Signalement envoyé. Merci.");
}

async function sendGift(button) {
  if (!state.activeVideo) return;
  try {
    await api.sendGift(state.activeVideo.id, button.dataset.gift, Number(button.dataset.cost));
    $("#gift-dialog").close();
    toast(`Cadeau ${button.dataset.gift} envoyé !`);
  } catch (error) { toast(error.message, true); }
}

function previewVideo() {
  const input = $("#video-file");
  const file = input.files[0];
  const preview = $("#video-preview");
  const details = $("#video-details");
  const status = $("#preview-status");
  input.dataset.uploadPath = "";
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
  if (!file) {
    preview.removeAttribute("src");
    preview.classList.add("hidden");
    details.classList.add("hidden");
    status.classList.add("hidden");
    return;
  }
  if (file.size > FEDA_CONFIG.maxVideoBytes) {
    input.value = "";
    details.classList.add("hidden");
    status.classList.add("hidden");
    return toast(`La vidéo dépasse ${formatBytes(FEDA_CONFIG.maxVideoBytes)}`, true);
  }
  try { videoMimeType(file); }
  catch (error) { input.value = ""; return toast(error.message, true); }

  details.textContent = `${file.name} · ${formatMegabytes(file.size)}`;
  details.classList.remove("hidden");
  status.textContent = "Préparation de l’aperçu…";
  status.classList.remove("hidden", "error");
  state.previewUrl = URL.createObjectURL(file);
  preview.src = state.previewUrl;
  preview.onloadedmetadata = () => {
    const duration = Number.isFinite(preview.duration) ? ` · ${Math.ceil(preview.duration)} s` : "";
    status.textContent = `Vidéo prête${duration}`;
  };
  preview.onerror = () => {
    status.textContent = "Aperçu indisponible sur ce téléphone. La vidéo peut quand même être publiée.";
  };
  preview.classList.remove("hidden");
  preview.load();
}

async function publishVideo(event) {
  event.preventDefault();
  const input = $("#video-file");
  const selectedFile = input.files[0];
  if (!selectedFile) return toast("Choisissez d’abord une vidéo.", true);
  let file;
  try { file = normalizedVideoFile(selectedFile); }
  catch (error) { return toast(error.message, true); }
  if (file.size > FEDA_CONFIG.maxVideoBytes) return toast(`La vidéo dépasse ${formatBytes(FEDA_CONFIG.maxVideoBytes)}`, true);
  const button = $("#publish-button");
  const progress = $("#upload-progress");
  const progressBar = $("#upload-progress-bar");
  const uploadStatus = $("#upload-status");
  button.disabled = true;
  button.textContent = "Préparation…";
  progress.classList.remove("hidden", "error");
  progressBar.style.width = "0%";
  progress.setAttribute("aria-valuenow", "0");
  uploadStatus.textContent = "Préparation de l’envoi sécurisé…";
  uploadStatus.classList.remove("hidden", "error");
  try {
    const path = input.dataset.uploadPath || `${state.user.id}/${crypto.randomUUID()}.${videoExtension(file.type)}`;
    input.dataset.uploadPath = path;
    await api.uploadVideo(file, path, ({ bytesUploaded, bytesTotal, percent }) => {
      progressBar.style.width = `${percent}%`;
      progress.setAttribute("aria-valuenow", String(percent));
      button.textContent = `Envoi… ${percent} %`;
      uploadStatus.textContent = `${formatMegabytes(bytesUploaded)} sur ${formatMegabytes(bytesTotal)} envoyés`;
    });
    button.textContent = "Finalisation…";
    uploadStatus.textContent = "Enregistrement de la publication…";
    await api.createVideo({ user_id: state.user.id, storage_path: path, caption: $("#video-caption").value.trim(), mime_type: file.type, size_bytes: file.size });
    event.currentTarget.reset();
    input.dataset.uploadPath = "";
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
    $("#video-preview").removeAttribute("src");
    $("#video-preview").classList.add("hidden");
    $("#video-details").classList.add("hidden");
    $("#preview-status").classList.add("hidden");
    toast("Vidéo publiée sur FEDA !");
    await changeFeed("new"); navigate("feed");
  } catch (error) {
    progress.classList.add("error");
    uploadStatus.textContent = error.message;
    uploadStatus.classList.add("error");
    toast(error.message, true);
  }
  finally {
    button.disabled = false;
    button.textContent = "Publier maintenant";
  }
}

async function searchVideos(event) {
  event.preventDefault();
  const term = $("#search-input").value.trim();
  const area = $("#search-results");
  area.innerHTML = "<p class='muted'>Recherche…</p>";
  try {
    const rows = await api.search(term);
    area.innerHTML = rows.length ? rows.map(row => `<article class="result-card"><div class="avatar">${escapeHtml((row.profiles?.display_name || "F")[0].toUpperCase())}</div><div><strong>${escapeHtml(row.profiles?.display_name || "Créateur")}</strong><p>${escapeHtml(row.caption || "Sans légende")}</p></div><button class="secondary" data-open-video="${row.id}">Voir</button></article>`).join("") : "<p class='muted'>Aucun résultat.</p>";
    $$('[data-open-video]', area).forEach(button => button.addEventListener("click", async () => { state.videos = rows; renderFeed(rows); navigate("feed"); setTimeout(() => $(`[data-video-id="${button.dataset.openVideo}"]`)?.scrollIntoView(), 50); }));
  } catch (error) { area.innerHTML = ""; toast(error.message, true); }
}

async function loadNotificationsCount() {
  const rows = await api.getNotifications(state.user.id);
  const unread = rows.filter(row => !row.read_at).length;
  const badge = $("#unread-badge"); badge.textContent = unread; badge.classList.toggle("hidden", !unread);
}

async function loadNotifications() {
  try {
    const rows = await api.getNotifications(state.user.id);
    $("#notifications").innerHTML = rows.length ? rows.map(row => `<div class="list-item ${row.read_at ? "" : "unread"}"><div class="avatar">${escapeHtml((row.profiles?.display_name || "F")[0].toUpperCase())}</div><div class="content"><strong>${escapeHtml(row.profiles?.display_name || "FEDA")}</strong><p>${escapeHtml(row.body)}</p><small>${relativeDate(row.created_at)}</small></div></div>`).join("") : "<p class='muted'>Aucune notification.</p>";
  } catch (error) { toast(error.message, true); }
}

async function markAllRead() { try { await api.markNotificationsRead(state.user.id); await loadNotifications(); await loadNotificationsCount(); } catch (error) { toast(error.message, true); } }

function updateProfileUi() {
  if (!state.profile) return;
  $("#profile-name").textContent = state.profile.display_name;
  $("#profile-email").textContent = state.profile.email;
  $("#profile-avatar").textContent = state.profile.display_name[0]?.toUpperCase() || "F";
  $("#profile-display-name").value = state.profile.display_name;
  $("#profile-bio").value = state.profile.bio || "";
  $("#admin-button").classList.toggle("hidden", state.profile.role !== "admin");
}

async function saveProfile(event) {
  event.preventDefault();
  try {
    const rows = await api.updateProfile(state.user.id, { display_name: $("#profile-display-name").value.trim(), bio: $("#profile-bio").value.trim(), updated_at: new Date().toISOString() });
    state.profile = rows[0]; updateProfileUi(); toast("Profil enregistré");
  } catch (error) { toast(error.message, true); }
}

async function loadWallet() {
  try {
    const [wallets, history] = await Promise.all([api.getWallet(state.user.id), api.getWalletHistory(state.user.id)]);
    const wallet = wallets[0] || { coin_balance: 0, earnings_balance: 0 };
    $("#coin-balance").textContent = formatCount(wallet.coin_balance);
    $("#earnings-balance").textContent = new Intl.NumberFormat("fr-FR").format(wallet.earnings_balance);
    $("#wallet-history").innerHTML = history.length ? history.map(row => `<div class="list-item"><div class="content"><strong>${escapeHtml(row.description)}</strong><small>${relativeDate(row.created_at)}</small></div><strong>${row.amount > 0 ? "+" : ""}${new Intl.NumberFormat("fr-FR").format(row.amount)} ${row.asset === "coins" ? "coins" : "FCFA"}</strong></div>`).join("") : "<p class='muted'>Aucune opération.</p>";
  } catch (error) { toast(error.message, true); }
}

function selectCoinPack(button) {
  $$("[data-pack]").forEach(item => item.classList.toggle("selected", item === button));
  $("#coin-amount").value = button.dataset.pack;
  $("#coin-order-form").classList.remove("hidden");
}

async function createCoinOrder(event) {
  event.preventDefault();
  const amount = Number($("#coin-amount").value);
  try {
    await api.createCoinOrder({ user_id: state.user.id, amount_fcfa: amount, coins: amount, method: $("#coin-method").value, phone: $("#coin-phone").value.trim(), payment_reference: $("#coin-reference").value.trim(), status: "pending" });
    event.currentTarget.reset(); event.currentTarget.classList.add("hidden");
    toast("Demande envoyée. Les FedaCoins seront ajoutés après validation.");
  } catch (error) { toast(error.message, true); }
}

async function requestPayout(event) {
  event.preventDefault();
  try {
    await api.requestPayout(Number($("#payout-amount").value), $("#payout-method").value, $("#payout-phone").value.trim());
    event.currentTarget.reset(); toast("Demande de retrait envoyée."); await loadWallet();
  } catch (error) { toast(error.message, true); }
}

async function loadAdmin() {
  if (state.profile?.role !== "admin") return navigate("profile");
  try {
    const [orders, payouts, reports] = await Promise.all([api.getPendingOrders(), api.getPendingPayouts(), api.getOpenReports()]);
    $("#admin-orders").innerHTML = orders.length ? orders.map(row => `<div class="list-item"><div class="content"><strong>${formatCount(row.coins)} coins — ${formatCount(row.amount_fcfa)} FCFA</strong><p>${escapeHtml(row.method)} · ${escapeHtml(row.phone)} · Réf. ${escapeHtml(row.payment_reference)}</p><small>${relativeDate(row.created_at)}</small></div><button class="primary" data-admin="approve-order" data-id="${row.id}">Valider</button><button class="danger" data-admin="reject-order" data-id="${row.id}">Refuser</button></div>`).join("") : "<p class='muted'>Aucun achat en attente.</p>";
    $("#admin-payouts").innerHTML = payouts.length ? payouts.map(row => `<div class="list-item"><div class="content"><strong>${formatCount(row.amount_fcfa)} FCFA</strong><p>${escapeHtml(row.method)} · ${escapeHtml(row.phone)}</p><small>${relativeDate(row.created_at)}</small></div><button class="primary" data-admin="approve-payout" data-id="${row.id}">Payé</button><button class="danger" data-admin="reject-payout" data-id="${row.id}">Refuser</button></div>`).join("") : "<p class='muted'>Aucun retrait en attente.</p>";
    $("#admin-reports").innerHTML = reports.length ? reports.map(row => `<div class="list-item"><div class="content"><strong>${escapeHtml(row.reason)}</strong><p>${escapeHtml(row.details || "Signalement de contenu")}</p><small>${relativeDate(row.created_at)}</small></div><button class="secondary" data-admin="close-report" data-id="${row.id}">Traité</button></div>`).join("") : "<p class='muted'>Aucun signalement ouvert.</p>";
  } catch (error) { toast(error.message, true); }
}

async function handleAdminAction(event) {
  const button = event.target.closest("[data-admin]");
  if (!button) return;
  button.disabled = true;
  try {
    if (button.dataset.admin === "approve-order") await api.reviewCoinOrder(button.dataset.id, true);
    if (button.dataset.admin === "reject-order") await api.reviewCoinOrder(button.dataset.id, false);
    if (button.dataset.admin === "approve-payout") await api.reviewPayout(button.dataset.id, true);
    if (button.dataset.admin === "reject-payout") await api.reviewPayout(button.dataset.id, false);
    if (button.dataset.admin === "close-report") await api.closeReport(button.dataset.id);
    toast("Décision enregistrée"); await loadAdmin();
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
}

async function logout() { await api.signOut(); state.user = null; state.profile = null; showAuth(); toast("Vous êtes déconnecté"); }
async function installApp() { if (!state.installPrompt) return; await state.installPrompt.prompt(); state.installPrompt = null; $("#install-button").classList.add("hidden"); }

bootstrap();
