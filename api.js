import { FEDA_CONFIG } from "./config.js";

const SESSION_KEY = "feda.session.v1";
const { supabaseUrl, publishableKey, storageBucket } = FEDA_CONFIG;
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const resumableUploadUrl = `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;

function safeJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { message: text }; }
}

function messageFor(payload, fallback = "Une erreur est survenue") {
  return payload?.msg || payload?.message || payload?.error_description || payload?.error || fallback;
}

function uploadErrorMessage(error) {
  const status = error?.originalResponse?.getStatus?.();
  if (status === 400) return "Le format de cette vidéo n’est pas accepté.";
  if (status === 401) return "Votre session a expiré. Reconnectez-vous puis réessayez.";
  if (status === 403) return "FEDA n’a pas l’autorisation d’enregistrer cette vidéo.";
  if (status === 413) return `La vidéo dépasse la taille autorisée de ${Math.round(FEDA_CONFIG.maxVideoBytes / (1024 * 1024))} Mo.`;
  if (status === 429) return "Trop d’envois en même temps. Patientez puis réessayez.";
  if (typeof navigator !== "undefined" && !navigator.onLine) return "Connexion Internet interrompue. L’envoi reprendra dès le retour du réseau.";
  return "L’envoi a été interrompu. Vérifiez votre connexion puis appuyez de nouveau sur Publier.";
}

class FedaApi {
  constructor() {
    this.session = safeJson(localStorage.getItem(SESSION_KEY));
  }

  saveSession(session) {
    this.session = session?.access_token ? session : null;
    if (this.session) localStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
    else localStorage.removeItem(SESSION_KEY);
  }

  async authFetch(path, options = {}) {
    const response = await fetch(`${supabaseUrl}/auth/v1${path}`, {
      ...options,
      headers: { apikey: publishableKey, "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const payload = safeJson(await response.text());
    if (!response.ok) throw new Error(messageFor(payload, `Erreur d’authentification (${response.status})`));
    return payload;
  }

  async signUp(email, password, displayName) {
    const result = await this.authFetch("/signup", {
      method: "POST",
      body: JSON.stringify({ email, password, data: { display_name: displayName } })
    });
    if (result?.access_token) this.saveSession(result);
    return result;
  }

  async signIn(email, password) {
    const result = await this.authFetch("/token?grant_type=password", {
      method: "POST", body: JSON.stringify({ email, password })
    });
    this.saveSession(result);
    return result;
  }

  async refreshSession() {
    if (!this.session?.refresh_token) throw new Error("Session expirée");
    const result = await this.authFetch("/token?grant_type=refresh_token", {
      method: "POST", body: JSON.stringify({ refresh_token: this.session.refresh_token })
    });
    this.saveSession(result);
    return result;
  }

  tokenExpiresSoon() {
    try {
      const body = JSON.parse(atob(this.session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return body.exp * 1000 < Date.now() + 60_000;
    } catch { return true; }
  }

  async ensureSession() {
    if (!this.session?.access_token) throw new Error("Connexion requise");
    if (this.tokenExpiresSoon()) await this.refreshSession();
    return this.session;
  }

  async getUser() {
    await this.ensureSession();
    const result = await this.authFetch("/user", { headers: { Authorization: `Bearer ${this.session.access_token}` } });
    this.session.user = result;
    this.saveSession(this.session);
    return result;
  }

  async signOut() {
    try {
      if (this.session?.access_token) await this.authFetch("/logout", { method: "POST", headers: { Authorization: `Bearer ${this.session.access_token}` } });
    } finally { this.saveSession(null); }
  }

  async request(path, { method = "GET", body, headers = {}, retry = true } = {}) {
    await this.ensureSession();
    const response = await fetch(`${supabaseUrl}${path}`, {
      method,
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${this.session.access_token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (response.status === 401 && retry && this.session?.refresh_token) {
      await this.refreshSession();
      return this.request(path, { method, body, headers, retry: false });
    }
    const payload = safeJson(await response.text());
    if (!response.ok) throw new Error(messageFor(payload, `Erreur serveur (${response.status})`));
    return payload;
  }

  rest(table, query = "", options = {}) {
    const suffix = query ? `?${query}` : "";
    return this.request(`/rest/v1/${table}${suffix}`, options);
  }

  async ensureProfile(user) {
    const existing = await this.rest("profiles", `id=eq.${user.id}&select=*`);
    if (existing?.[0]) return existing[0];
    const displayName = user.user_metadata?.display_name || user.email?.split("@")[0] || "Membre FEDA";
    const created = await this.rest("profiles", "select=*", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: { id: user.id, email: user.email || "", display_name: displayName, role: "user" }
    });
    await this.rest("wallets", "", { method: "POST", headers: { Prefer: "return=minimal" }, body: { user_id: user.id } });
    return created[0];
  }

  getProfile(userId) { return this.rest("profiles", `id=eq.${userId}&select=*`); }
  updateProfile(userId, changes) {
    return this.rest("profiles", `id=eq.${userId}&select=*`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: changes });
  }

  getFeed(mode = "for-you", userId) {
    let query = "select=*,profiles!videos_user_id_fkey(display_name)&status=eq.active";
    query += mode === "for-you" ? "&order=like_count.desc,created_at.desc" : "&order=created_at.desc";
    if (mode === "following") query += "&limit=60";
    else query += "&limit=30";
    return this.rest("videos", query);
  }

  async getFollowingIds(userId) {
    const rows = await this.rest("follows", `follower_id=eq.${userId}&select=creator_id`);
    return rows.map(row => row.creator_id);
  }

  getMyLikes(userId) { return this.rest("likes", `user_id=eq.${userId}&select=video_id`); }

  async signedVideoUrl(path, expiresIn = 3600) {
    const cleanPath = path.split("/").map(encodeURIComponent).join("/");
    const result = await this.request(`/storage/v1/object/sign/${storageBucket}/${cleanPath}`, {
      method: "POST", body: { expiresIn }
    });
    const signed = result?.signedURL || result?.signedUrl || result?.signed_url;
    if (!signed) throw new Error("Impossible de lire cette vidéo");
    return signed.startsWith("http") ? signed : `${supabaseUrl}/storage/v1${signed}`;
  }

  async uploadVideo(file, path, onProgress = () => {}) {
    await this.ensureSession();
    if (!globalThis.tus?.Upload) throw new Error("Le module d’envoi vidéo n’a pas été chargé. Actualisez FEDA puis réessayez.");

    return new Promise((resolve, reject) => {
      const upload = new globalThis.tus.Upload(file, {
        endpoint: resumableUploadUrl,
        retryDelays: [0, 1_000, 3_000, 5_000, 10_000, 20_000],
        chunkSize: 6 * 1024 * 1024,
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        headers: { authorization: `Bearer ${this.session.access_token}` },
        metadata: {
          bucketName: storageBucket,
          objectName: path,
          contentType: file.type,
          cacheControl: "3600"
        },
        onError: error => reject(new Error(uploadErrorMessage(error))),
        onProgress: (bytesUploaded, bytesTotal) => {
          const percent = bytesTotal ? Math.round((bytesUploaded / bytesTotal) * 100) : 0;
          onProgress({ bytesUploaded, bytesTotal, percent });
        },
        onSuccess: () => {
          onProgress({ bytesUploaded: file.size, bytesTotal: file.size, percent: 100 });
          resolve({ path, uploadUrl: upload.url });
        }
      });
      upload.start();
    });
  }

  createVideo(row) {
    return this.rest("videos", "select=*", { method: "POST", headers: { Prefer: "return=representation" }, body: row });
  }

  like(videoId, userId) { return this.rest("likes", "", { method: "POST", body: { video_id: videoId, user_id: userId } }); }
  unlike(videoId, userId) { return this.rest("likes", `video_id=eq.${videoId}&user_id=eq.${userId}`, { method: "DELETE" }); }
  getComments(videoId) { return this.rest("comments", `video_id=eq.${videoId}&status=eq.active&select=*,profiles!comments_user_id_fkey(display_name)&order=created_at.asc`); }
  addComment(videoId, userId, body) { return this.rest("comments", "select=*", { method: "POST", headers: { Prefer: "return=representation" }, body: { video_id: videoId, user_id: userId, body } }); }
  addShare(videoId, userId) { return this.rest("shares", "", { method: "POST", body: { video_id: videoId, user_id: userId } }); }
  follow(creatorId, userId) { return this.rest("follows", "", { method: "POST", body: { creator_id: creatorId, follower_id: userId } }); }
  unfollow(creatorId, userId) { return this.rest("follows", `creator_id=eq.${creatorId}&follower_id=eq.${userId}`, { method: "DELETE" }); }
  reportVideo(videoId, userId, reason, details = "") { return this.rest("reports", "", { method: "POST", body: { video_id: videoId, reporter_user_id: userId, reason, details } }); }

  search(term) {
    const escaped = term.replace(/[%*,()]/g, "").trim();
    if (!escaped) return Promise.resolve([]);
    return this.rest("videos", `select=*,profiles!videos_user_id_fkey(display_name)&status=eq.active&caption=ilike.*${encodeURIComponent(escaped)}*&order=created_at.desc&limit=30`);
  }

  getNotifications(userId) { return this.rest("notifications", `user_id=eq.${userId}&select=*,profiles!notifications_actor_user_id_fkey(display_name)&order=created_at.desc&limit=50`); }
  markNotificationsRead(userId) { return this.rest("notifications", `user_id=eq.${userId}&read_at=is.null`, { method: "PATCH", body: { read_at: new Date().toISOString() } }); }
  getWallet(userId) { return this.rest("wallets", `user_id=eq.${userId}&select=*`); }
  getWalletHistory(userId) { return this.rest("wallet_entries", `user_id=eq.${userId}&select=*&order=created_at.desc&limit=30`); }
  createCoinOrder(row) { return this.rest("coin_orders", "", { method: "POST", body: row }); }

  rpc(name, body) { return this.request(`/rest/v1/rpc/${name}`, { method: "POST", body }); }
  sendGift(videoId, giftType, coinCost) { return this.rpc("send_gift", { p_video_id: videoId, p_gift_type: giftType, p_coin_cost: coinCost }); }
  subscribe(creatorId) { return this.rpc("subscribe_to_creator", { p_creator_user_id: creatorId, p_coin_cost: 1000 }); }
  requestPayout(amount, method, phone) { return this.rpc("request_payout", { p_amount_fcfa: amount, p_method: method, p_phone: phone }); }
  getPendingOrders() { return this.rest("coin_orders", "status=eq.pending&select=*&order=created_at.asc"); }
  getPendingPayouts() { return this.rest("payout_requests", "status=eq.pending&select=*&order=created_at.asc"); }
  getOpenReports() { return this.rest("reports", "status=eq.open&select=*&order=created_at.asc&limit=50"); }
  reviewCoinOrder(orderId, approve) { return this.rpc("review_coin_order", { p_order_id: orderId, p_approve: approve }); }
  reviewPayout(payoutId, approve) { return this.rpc("review_payout", { p_payout_id: payoutId, p_approve: approve }); }
  closeReport(reportId) { return this.rest("reports", `id=eq.${reportId}`, { method: "PATCH", body: { status: "reviewed", reviewed_at: new Date().toISOString() } }); }
}

export const api = new FedaApi();
