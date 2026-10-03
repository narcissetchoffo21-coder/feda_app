export const FEDA_CONFIG = Object.freeze({
  supabaseUrl: "https://vrtordouhavvdxjykkuy.supabase.co",
  publishableKey: "sb_publishable_zsOhPpwRq0cSgmntA9Bznw__RyavfxS",
  storageBucket: "videos",
  // Active limit for the current free plan. Raise this to proMaxVideoBytes
  // after the Pro storage plan is enabled, then to futureMaxVideoBytes when
  // the 1 GB tier is released.
  freeMaxVideoBytes: 50 * 1024 * 1024,
  proMaxVideoBytes: 100 * 1024 * 1024,
  futureMaxVideoBytes: 1024 * 1024 * 1024,
  maxVideoBytes: 50 * 1024 * 1024,
  appName: "FEDA"
});
