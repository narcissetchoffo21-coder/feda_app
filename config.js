export const FEDA_CONFIG = Object.freeze({
  supabaseUrl: "https://vrtordouhavvdxjykkuy.supabase.co",
  publishableKey: "sb_publishable_zsOhPpwRq0cSgmntA9Bznw__RyavfxS",
  storageBucket: "videos",
  // Active limit for the current Supabase Free plan. The 200 MB target can
  // only be activated after both the global and bucket limits are raised.
  freeMaxVideoBytes: 50 * 1024 * 1024,
  targetMaxVideoBytes: 200 * 1024 * 1024,
  futureMaxVideoBytes: 1024 * 1024 * 1024,
  maxVideoBytes: 50 * 1024 * 1024,
  appName: "FEDA"
});
